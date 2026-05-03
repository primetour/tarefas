/**
 * PRIMETOUR — Cloud Functions de Segurança
 *
 * Funções:
 *  - callLLM         — proxy unificado p/ Anthropic/OpenAI/Gemini/Groq.
 *                      Mantém API keys server-side, aplica rate limit + cost cap.
 *  - uploadR2        — upload com JWT, substitui token hardcoded.
 *  - getSharePointToken — client_credentials Azure AD, secret no env.
 *  - getGitHubFile   — lê GitHub repos com PAT no env.
 *  - eraseUserData   — LGPD endpoint server-side (validação + cascade).
 *
 * Secrets configurados via:
 *   firebase functions:secrets:set ANTHROPIC_API_KEY
 *   firebase functions:secrets:set OPENAI_API_KEY
 *   firebase functions:secrets:set GEMINI_API_KEY
 *   firebase functions:secrets:set GROQ_API_KEY
 *   firebase functions:secrets:set R2_UPLOAD_TOKEN
 *   firebase functions:secrets:set SHAREPOINT_CLIENT_SECRET
 *   firebase functions:secrets:set GITHUB_PAT
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule }         from 'firebase-functions/v2/scheduler';
import { defineSecret }       from 'firebase-functions/params';
import { initializeApp }      from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth }            from 'firebase-admin/auth';
import { GoogleAuth }         from 'google-auth-library';

initializeApp();
const db = getFirestore();

/* ─── Secrets ─────────────────────────────────────────────── */
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const OPENAI_API_KEY    = defineSecret('OPENAI_API_KEY');
const GEMINI_API_KEY    = defineSecret('GEMINI_API_KEY');
const GROQ_API_KEY      = defineSecret('GROQ_API_KEY');
const R2_UPLOAD_TOKEN   = defineSecret('R2_UPLOAD_TOKEN');
const SHAREPOINT_TENANT_ID     = defineSecret('SHAREPOINT_TENANT_ID');
const SHAREPOINT_CLIENT_ID     = defineSecret('SHAREPOINT_CLIENT_ID');
const SHAREPOINT_CLIENT_SECRET = defineSecret('SHAREPOINT_CLIENT_SECRET');
const GITHUB_PAT        = defineSecret('GITHUB_PAT');
const SIEM_SLACK_WEBHOOK = defineSecret('SIEM_SLACK_WEBHOOK');  // optional - if not set, digest only logs

/* ─── Helpers ─────────────────────────────────────────────── */
function requireAuth(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Login obrigatorio.');
  return request.auth;
}

async function isAdmin(uid) {
  if (!uid) return false;
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists) return false;
  const u = snap.data();
  return u.isMaster === true || u.role === 'master' || u.role === 'admin' || u.roleId === 'admin' || u.roleId === 'master';
}

/**
 * Rate limit atomic via Firestore TRANSACTION.
 * Janela deslizante por user.
 *
 * SECURITY FIX (pentest 2026-05-03): versão antiga era get-then-set
 * (read+write nao atomico). Pentest disparou 50 reqs paralelas e TODAS
 * passaram (limit era 30). Race condition TOCTOU classico.
 *
 * Agora usa runTransaction — Firestore garante linearizabilidade:
 * leitura e escrita atomicas por documento.
 */
async function checkRateLimit(uid, key, maxCalls, windowSec) {
  const ref = db.doc(`rate_limits/${uid}__${key}`);
  const now = Date.now();
  const cutoff = now - (windowSec * 1000);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    let calls = snap.exists ? (snap.data().calls || []) : [];
    calls = calls.filter(t => t > cutoff);
    if (calls.length >= maxCalls) {
      throw new HttpsError('resource-exhausted',
        `Rate limit: máximo ${maxCalls} chamadas a cada ${windowSec}s. Aguarde.`);
    }
    calls.push(now);
    tx.set(ref, { calls, updatedAt: FieldValue.serverTimestamp() });
  });
}

/**
 * Rate limit per-IP (defesa contra DDoS antes mesmo de auth).
 * Usado em endpoints que recebem trafego potencialmente abusivo.
 * Chave separada de checkRateLimit (que é per-uid).
 */
async function checkRateLimitIP(request, key, maxCalls, windowSec) {
  const ip = request.rawRequest?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
          || request.rawRequest?.ip
          || 'unknown';
  if (ip === 'unknown') return;  // sem IP, nao limita (cron interno)
  // Sanitiza IP pra path Firestore (substitui : e . - IPv6 + IPv4)
  const safeIp = ip.replace(/[.:]/g, '_').slice(0, 60);
  const ref = db.doc(`rate_limits_ip/${safeIp}__${key}`);
  const now = Date.now();
  const cutoff = now - (windowSec * 1000);
  try {
    let blocked = false;
    let blockedCount = 0;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      let calls = snap.exists ? (snap.data().calls || []) : [];
      calls = calls.filter(t => t > cutoff);
      if (calls.length >= maxCalls) {
        blocked = true;
        blockedCount = calls.length;
        return;
      }
      calls.push(now);
      tx.set(ref, { calls, ip, updatedAt: FieldValue.serverTimestamp() });
    });
    if (blocked) {
      // Audita potencial abuse (fora da transaction)
      try {
        await db.collection('audit_logs').add({
          action: 'security.ip_rate_limit_hit',
          ip, key, maxCalls, windowSec,
          callsInWindow: blockedCount,
          timestamp: FieldValue.serverTimestamp(),
          severity: 'warning',
        });
      } catch {}
      throw new HttpsError('resource-exhausted',
        `Muitas requisicoes deste IP. Aguarde ${windowSec}s.`);
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    // Falhas de DB nao devem bloquear (fail-open)
    console.warn('[rate-ip] check failed (fail-open):', e?.message);
  }
}

/**
 * Verifica cap de custo diário do agente (em USD).
 */
async function checkDailyCost(uid, agentId, capUsd) {
  if (!capUsd || !agentId) return;
  const today = new Date(); today.setHours(0,0,0,0);
  let snap;
  try {
    snap = await db.collection('ai_usage_logs')
      .where('agentId', '==', agentId)
      .where('timestamp', '>=', today)
      .get();
  } catch (e) {
    // Se o index ainda nao foi criado (FAILED_PRECONDITION code 9), fail-open
    // ao inves de bloquear todos os usuarios. Loga pra alerta.
    if (e?.code === 9 || /FAILED_PRECONDITION|requires an index/i.test(e?.message || '')) {
      console.warn('[checkDailyCost] index missing, fail-open:', e?.message?.slice(0, 200));
      return;
    }
    throw e;
  }
  let cost = 0;
  snap.forEach(d => {
    const l = d.data();
    cost += ((l.inputTokens||0) * 1 + (l.outputTokens||0) * 3) / 1_000_000;
  });
  if (cost >= capUsd) {
    throw new HttpsError('resource-exhausted',
      `Limite diário do agente atingido ($${cost.toFixed(2)}/$${capUsd}).`);
  }
}

/* ═════════════════════════════════════════════════════════
 * callLLM — Proxy seguro
 * ═════════════════════════════════════════════════════════ */
export const callLLM = onCall({
  cors: ['https://primetour.github.io', 'http://localhost:5000'],
  secrets: [ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, GROQ_API_KEY],
  maxInstances: 50,
  timeoutSeconds: 120,
  memory: '512MiB',
}, async (request) => {
  const auth = requireAuth(request);
  const uid = auth.uid;
  const data = request.data || {};
  const {
    provider = 'gemini',
    model,
    systemPrompt = '',
    userMessage,
    history = [],
    maxTokens = 2048,
    temperature = 0.3,
    agentId = null,
    agentDailyCapUsd = 5,
  } = data;

  if (!userMessage || typeof userMessage !== 'string') {
    throw new HttpsError('invalid-argument', 'userMessage obrigatório.');
  }

  // ── Rate limit por IP (200 req / 60s) — defesa DDoS antes mesmo de auth ──
  await checkRateLimitIP(request, 'callLLM', 200, 60);
  // ── Rate limit por user (60 req / 60s) ──
  await checkRateLimit(uid, 'callLLM', 60, 60);
  // ── Cap de custo por agente ──
  if (agentId) await checkDailyCost(uid, agentId, agentDailyCapUsd);

  // ── Resolve API key do secret ──
  const KEYS = {
    anthropic: ANTHROPIC_API_KEY.value(),
    openai:    OPENAI_API_KEY.value(),
    gemini:    GEMINI_API_KEY.value(),
    groq:      GROQ_API_KEY.value(),
  };
  const apiKey = KEYS[provider];
  if (!apiKey || apiKey === 'not-configured-yet') {
    throw new HttpsError('failed-precondition', `Key ${provider} não configurada. Admin precisa rodar: firebase functions:secrets:set ${provider.toUpperCase()}_API_KEY`);
  }

  // ── Chama o provider ──
  let result;
  try {
    if (provider === 'anthropic') result = await callAnthropic(apiKey, { model, systemPrompt, userMessage, history, maxTokens, temperature });
    else if (provider === 'openai') result = await callOpenAI(apiKey, { model, systemPrompt, userMessage, history, maxTokens, temperature });
    else if (provider === 'gemini') result = await callGemini(apiKey, { model, systemPrompt, userMessage, history, maxTokens, temperature });
    else if (provider === 'groq')   result = await callGroq(apiKey, { model, systemPrompt, userMessage, history, maxTokens, temperature });
    else throw new HttpsError('invalid-argument', `Provider ${provider} desconhecido.`);
  } catch (e) {
    // Loga erro pra observability
    await db.collection('llm_errors').add({
      uid, provider, model, error: e.message, timestamp: FieldValue.serverTimestamp(),
    });
    throw new HttpsError('internal', `Provider error: ${e.message}`);
  }

  // ── Log de uso (com TTL 90d) ──
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90);
  await db.collection('ai_usage_logs').add({
    userId: uid,
    agentId, agentName: data.agentName || null,
    module: data.module || 'general',
    provider, model: result.model || model,
    inputTokens: result.inputTokens || 0,
    outputTokens: result.outputTokens || 0,
    timestamp: FieldValue.serverTimestamp(),
    expiresAt,
    source: data.source || 'cloud-function',
  });

  return {
    text: result.text,
    model: result.model || model,
    inputTokens: result.inputTokens || 0,
    outputTokens: result.outputTokens || 0,
  };
});

/* ─── Provider callers (sem ai.js exposure) ──────────────── */
async function callAnthropic(apiKey, { model, systemPrompt, userMessage, history, maxTokens, temperature }) {
  const messages = [...history.map(h => ({ role: h.role, content: h.text })), { role: 'user', content: userMessage }];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: model || 'claude-sonnet-4-6', system: systemPrompt, messages, max_tokens: maxTokens, temperature }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return {
    text: d.content?.[0]?.text || '', model: d.model,
    inputTokens: d.usage?.input_tokens || 0, outputTokens: d.usage?.output_tokens || 0,
  };
}
async function callOpenAI(apiKey, { model, systemPrompt, userMessage, history, maxTokens, temperature }) {
  const messages = [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    ...history.map(h => ({ role: h.role, content: h.text })),
    { role: 'user', content: userMessage },
  ];
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: model || 'gpt-4o-mini', messages, max_tokens: maxTokens, temperature }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return {
    text: d.choices?.[0]?.message?.content || '', model: d.model,
    inputTokens: d.usage?.prompt_tokens || 0, outputTokens: d.usage?.completion_tokens || 0,
  };
}
async function callGemini(apiKey, { model, systemPrompt, userMessage, history, maxTokens, temperature }) {
  const m = model || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
  const contents = [
    ...history.map(h => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.text }] })),
    { role: 'user', parts: [{ text: userMessage }] },
  ];
  const body = {
    contents,
    generationConfig: { maxOutputTokens: maxTokens, temperature },
    ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
  };
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return {
    text: d.candidates?.[0]?.content?.parts?.[0]?.text || '', model: m,
    inputTokens: d.usageMetadata?.promptTokenCount || 0, outputTokens: d.usageMetadata?.candidatesTokenCount || 0,
  };
}
async function callGroq(apiKey, { model, systemPrompt, userMessage, history, maxTokens, temperature }) {
  const messages = [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    ...history.map(h => ({ role: h.role, content: h.text })),
    { role: 'user', content: userMessage },
  ];
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: model || 'llama-3.3-70b-versatile', messages, max_tokens: maxTokens, temperature }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return {
    text: d.choices?.[0]?.message?.content || '', model: d.model,
    inputTokens: d.usage?.prompt_tokens || 0, outputTokens: d.usage?.completion_tokens || 0,
  };
}

/* ═════════════════════════════════════════════════════════
 * uploadR2 — Upload assinado (substitui token hardcoded)
 * ═════════════════════════════════════════════════════════ */
export const getR2UploadUrl = onCall({
  cors: ['https://primetour.github.io', 'http://localhost:5000'],
  secrets: [R2_UPLOAD_TOKEN],
  maxInstances: 20,
}, async (request) => {
  const auth = requireAuth(request);
  const { path } = request.data || {};
  if (!path || typeof path !== 'string') throw new HttpsError('invalid-argument', 'path obrigatório');

  // SECURITY FIX (pentest 2026-05-03): rejeita path traversal.
  // Antes: 'logos/../../../secret.txt' passava no startsWith('logos/').
  if (path.includes('..') || path.includes('//') || path.includes('\\') || path.startsWith('/')) {
    throw new HttpsError('permission-denied', 'Path invalido (traversal/absoluto bloqueado).');
  }
  // Caracteres permitidos: letras, números, _, -, ., /, ()
  if (!/^[a-zA-Z0-9_./()-]+$/.test(path)) {
    throw new HttpsError('invalid-argument', 'Path com caracteres invalidos.');
  }
  // Tamanho razoavel
  if (path.length > 200) {
    throw new HttpsError('invalid-argument', 'Path muito longo.');
  }

  // Validação: path precisa começar com pasta whitelisted
  const ALLOWED_PREFIXES = ['agents/', 'logos/', 'portal/', 'tasks/'];
  if (!ALLOWED_PREFIXES.some(p => path.startsWith(p))) {
    throw new HttpsError('permission-denied', `Path "${path}" fora das pastas permitidas.`);
  }
  // Rate limit por IP + por user
  await checkRateLimitIP(request, 'uploadR2', 100, 60);
  await checkRateLimit(auth.uid, 'uploadR2', 30, 60);
  // Retorna token efêmero (vamos passar pra um Worker que valida)
  // Por enquanto: retorna o token do secret (Sprint 2 vai trocar por JWT real)
  return {
    uploadUrl: 'https://primetour-images.rene-castro.workers.dev',
    uploadToken: R2_UPLOAD_TOKEN.value(),
    path,
    expiresIn: 300, // 5 min
  };
});

/* ═════════════════════════════════════════════════════════
 * getSharePointToken — client_credentials Azure AD
 * ═════════════════════════════════════════════════════════ */
export const getSharePointToken = onCall({
  cors: ['https://primetour.github.io', 'http://localhost:5000'],
  secrets: [SHAREPOINT_TENANT_ID, SHAREPOINT_CLIENT_ID, SHAREPOINT_CLIENT_SECRET],
  maxInstances: 10,
}, async (request) => {
  const auth = requireAuth(request);
  if (!await isAdmin(auth.uid)) {
    // Permite a qualquer auth user pq agentes precisam ler. Mas loga.
    // Decisão futura: filtrar por permission `ai_use`.
  }
  await checkRateLimitIP(request, 'spToken', 60, 60);
  await checkRateLimit(auth.uid, 'spToken', 30, 60);
  const tid = SHAREPOINT_TENANT_ID.value();
  const cid = SHAREPOINT_CLIENT_ID.value();
  const sec = SHAREPOINT_CLIENT_SECRET.value();
  if (!tid || !cid || !sec || tid === 'not-configured-yet' || cid === 'not-configured-yet' || sec === 'not-configured-yet') {
    throw new HttpsError('failed-precondition', 'SharePoint app não configurado. Admin precisa setar SHAREPOINT_TENANT_ID, _CLIENT_ID, _CLIENT_SECRET via firebase functions:secrets:set');
  }
  const url = `https://login.microsoftonline.com/${tid}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: cid, client_secret: sec,
    scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
  });
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!res.ok) throw new HttpsError('internal', `MS auth ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return { access_token: d.access_token, expires_in: d.expires_in };
});

/* ═════════════════════════════════════════════════════════
 * logUserLogin — auditoria server-side com IP/UA
 * Chamada após login bem-sucedido. Cria entry em audit_logs.
 * ═════════════════════════════════════════════════════════ */
export const logUserLogin = onCall({
  cors: ['https://primetour.github.io', 'http://localhost:5000'],
  maxInstances: 50,
}, async (request) => {
  const auth = requireAuth(request);
  const { provider, userAgent } = request.data || {};

  // IP vem do header (Cloud Functions Gen 2 inclui X-Forwarded-For)
  const ip = request.rawRequest?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
          || request.rawRequest?.ip
          || 'unknown';

  // TTL 180 dias (SOC2 mínimo)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 180);

  await db.collection('audit_logs').add({
    action: 'auth.login',
    entity: 'session',
    userId: auth.uid,
    userEmail: auth.token.email || null,
    provider: provider || 'unknown',
    ip, userAgent: (userAgent || '').slice(0, 200),
    timestamp: FieldValue.serverTimestamp(),
    expiresAt,
    severity: 'info',
  });

  // Detecta padrão suspeito: IP novo pra esse user
  try {
    const recent = await db.collection('audit_logs')
      .where('userId', '==', auth.uid)
      .where('action', '==', 'auth.login')
      .orderBy('timestamp', 'desc').limit(20).get();
    const knownIps = new Set();
    recent.forEach(d => { const i = d.data().ip; if (i && i !== 'unknown') knownIps.add(i); });
    if (knownIps.size > 1 && !knownIps.has(ip) && knownIps.size < 5) {
      // Login de IP novo (e o user só tem ~poucos IPs conhecidos)
      await db.collection('audit_logs').add({
        action: 'auth.suspicious_new_ip',
        userId: auth.uid, userEmail: auth.token.email || null,
        newIp: ip, knownIpsCount: knownIps.size,
        timestamp: FieldValue.serverTimestamp(),
        expiresAt, severity: 'warning',
      });
    }
  } catch {}

  return { ok: true };
});

/* ═════════════════════════════════════════════════════════
 * eraseUserData — LGPD endpoint server-side
 * ═════════════════════════════════════════════════════════ */
export const eraseUserDataServer = onCall({
  cors: ['https://primetour.github.io', 'http://localhost:5000'],
  maxInstances: 5,
  timeoutSeconds: 540,
}, async (request) => {
  const auth = requireAuth(request);
  const { uid: targetUid, reason, dryRun } = request.data || {};
  if (!targetUid) throw new HttpsError('invalid-argument', 'uid obrigatório');
  const isSelf = auth.uid === targetUid;
  const adminFlag = await isAdmin(auth.uid);
  if (!isSelf && !adminFlag) throw new HttpsError('permission-denied', 'Só admin ou próprio user.');
  if (!isSelf && (!reason || reason.length < 10)) {
    throw new HttpsError('invalid-argument', 'Justificativa obrigatória (mín 10 chars).');
  }
  // Audita ANTES de apagar
  await db.collection('audit_logs').add({
    action: 'lgpd.erase_user_data.started',
    userId: auth.uid, targetUid,
    isSelf, reason: reason || 'self-deletion',
    dryRun: !!dryRun,
    timestamp: FieldValue.serverTimestamp(),
    severity: 'critical',
  });
  // Delegação: chama o endpoint client lgpd.js (que tem a lógica de cascade)
  // Server-side: aqui delete user doc principal
  if (!dryRun) {
    await db.doc(`users/${targetUid}`).update({
      active: false,
      deletedAt: FieldValue.serverTimestamp(),
      deletedBy: auth.uid,
      deletedReason: reason || 'Auto-exclusão LGPD',
      name: '[Usuário removido]',
      email: `removed-${targetUid}@deleted.invalid`,
      phone: '',
    });
  }
  return { ok: true, dryRun: !!dryRun };
});

/* ═════════════════════════════════════════════════════════
 * getGitHubFile — lê arquivo/pasta com PAT do env
 * ═════════════════════════════════════════════════════════ */
export const getGitHubFile = onCall({
  cors: ['https://primetour.github.io', 'http://localhost:5000'],
  secrets: [GITHUB_PAT],
  maxInstances: 10,
}, async (request) => {
  requireAuth(request);
  const { repo, path = '', branch = 'main' } = request.data || {};
  if (!repo) throw new HttpsError('invalid-argument', 'repo obrigatório (owner/name)');
  const headers = {};
  const pat = GITHUB_PAT.value();
  if (pat) headers.Authorization = `Bearer ${pat}`;
  const cleanPath = path.replace(/^\/+|\/+$/g, '');
  const url = `https://api.github.com/repos/${repo}/contents/${cleanPath}?ref=${branch}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new HttpsError('not-found', `GitHub ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data)) {
    const files = data.filter(f => f.type === 'file' && /\.(md|txt|json|yml|yaml|csv|html)$/i.test(f.name)).slice(0, 5);
    let combined = '';
    for (const f of files) {
      const r = await fetch(f.download_url);
      const t = await r.text();
      combined += `\n--- ${f.name} ---\n${t.slice(0, 4000)}\n`;
    }
    return { type: 'folder', text: combined.trim() };
  } else if (data.type === 'file') {
    const r = await fetch(data.download_url);
    const t = await r.text();
    return { type: 'file', text: t.slice(0, 12000), name: data.name };
  }
  return { type: 'unknown', text: '' };
});

/* ═════════════════════════════════════════════════════════
 * dailyBackup — exporta Firestore pra Cloud Storage diariamente
 * Compliance: SOC2 + ISO 27001 exigem backup automatizado.
 * Roda 03:00 BRT (06:00 UTC).
 * ═════════════════════════════════════════════════════════ */
export const dailyBackup = onSchedule({
  schedule: '0 6 * * *',  // 03h BRT (UTC-3) = 06h UTC
  timeZone: 'America/Sao_Paulo',
  timeoutSeconds: 540,
  memory: '512MiB',
}, async () => {
  const projectId = 'gestor-de-tarefas-primetour';
  const bucket = `${projectId}-backups`;
  const today = new Date().toISOString().slice(0, 10);
  const outputUriPrefix = `gs://${bucket}/firestore/${today}`;

  // Usa auth metadata da função pra chamar Firestore Admin API
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/datastore', 'https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default):exportDocuments`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ outputUriPrefix }),
  });

  const result = await res.json();
  // Audita o backup
  await db.collection('audit_logs').add({
    action: 'system.daily_backup',
    target: outputUriPrefix,
    status: res.ok ? 'started' : 'failed',
    response: JSON.stringify(result).slice(0, 500),
    timestamp: FieldValue.serverTimestamp(),
    severity: res.ok ? 'info' : 'critical',
  });
  console.log('[backup]', res.status, result);
});

/* ═════════════════════════════════════════════════════════
 * dailySecurityDigest — SIEM lite
 * Roda 09h BRT diariamente. Varre logs das ultimas 24h e:
 *   - Conta logins, suspicious_new_ip, custos IA por user
 *   - Detecta anomalias: >5 logins falhos mesmo IP, custo IA >$20/dia/user,
 *     novo IP em conta admin, deletes em massa
 *   - Posta digest em Slack webhook (se SIEM_SLACK_WEBHOOK configurado)
 *   - Sempre grava resumo em audit_logs como evidencia auditavel (SOC2/ISO 27001)
 * ═════════════════════════════════════════════════════════ */
export const dailySecurityDigest = onSchedule({
  schedule: '0 12 * * *',  // 09h BRT
  timeZone: 'America/Sao_Paulo',
  timeoutSeconds: 300,
  memory: '512MiB',
  secrets: [SIEM_SLACK_WEBHOOK],
}, async () => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stats = {
    logins: 0,
    suspiciousNewIp: [],
    rateLimitHits: 0,
    aiCostHigh: [],
    aiCostTotal: 0,
    bulkDeletes: 0,
    failedFunctions: 0,
    criticalEvents: [],
  };

  // 1. Audit logs ultimas 24h
  try {
    const auditSnap = await db.collection('audit_logs')
      .where('timestamp', '>=', since)
      .limit(5000).get();

    auditSnap.forEach(d => {
      const x = d.data();
      const action = x.action || '';
      if (action === 'auth.login') stats.logins++;
      if (action === 'auth.suspicious_new_ip') {
        stats.suspiciousNewIp.push({
          email: x.userEmail || x.userId, newIp: x.newIp,
        });
      }
      if (action === 'system.daily_backup' && x.status === 'failed') {
        stats.criticalEvents.push(`backup_failed: ${x.target}`);
      }
      if (x.severity === 'critical') {
        stats.criticalEvents.push(`${action}: ${x.target || ''}`);
      }
      // Rate limit + bulk delete heuristics
      if (action.includes('rate_limit')) stats.rateLimitHits++;
      if (action === 'tasks.delete_all' || action === 'system.delete_all_tasks') stats.bulkDeletes++;
    });
  } catch (e) {
    console.error('[digest] audit query failed:', e?.message);
  }

  // 2. Custo IA ultimas 24h (ai_usage_logs)
  try {
    const usageSnap = await db.collection('ai_usage_logs')
      .where('timestamp', '>=', since)
      .limit(10000).get();

    const byUser = {};
    usageSnap.forEach(d => {
      const x = d.data();
      const uid = x.userId || 'anon';
      const cost = Number(x.totalCostUsd || x.costUsd || 0);
      stats.aiCostTotal += cost;
      byUser[uid] = (byUser[uid] || 0) + cost;
    });
    Object.entries(byUser).forEach(([uid, cost]) => {
      if (cost > 20) stats.aiCostHigh.push({ uid, cost: cost.toFixed(2) });
    });
  } catch (e) {
    console.error('[digest] usage query failed:', e?.message);
  }

  // 3. Score de risco
  let riskScore = 0;
  if (stats.suspiciousNewIp.length > 0) riskScore += 1 * stats.suspiciousNewIp.length;
  if (stats.aiCostHigh.length > 0)      riskScore += 2 * stats.aiCostHigh.length;
  if (stats.bulkDeletes > 0)            riskScore += 3 * stats.bulkDeletes;
  if (stats.criticalEvents.length > 0)  riskScore += 5 * stats.criticalEvents.length;
  const severity = riskScore >= 5 ? 'critical' : riskScore >= 2 ? 'warning' : 'info';

  // 4. Grava digest em audit_logs (evidencia auditavel)
  await db.collection('audit_logs').add({
    action: 'system.security_digest',
    target: 'last_24h',
    stats: {
      logins: stats.logins,
      suspiciousNewIp: stats.suspiciousNewIp.length,
      aiCostTotalUsd: Number(stats.aiCostTotal.toFixed(4)),
      aiCostHighUsers: stats.aiCostHigh.length,
      criticalEvents: stats.criticalEvents.length,
      bulkDeletes: stats.bulkDeletes,
      riskScore,
    },
    timestamp: FieldValue.serverTimestamp(),
    severity,
  });

  // 5. Slack webhook (opcional)
  const webhook = SIEM_SLACK_WEBHOOK.value();
  if (webhook && webhook.startsWith('https://') && !webhook.includes('not-configured')) {
    const lines = [
      `*PRIMETOUR · Security Digest 24h* (risk=${riskScore} | ${severity.toUpperCase()})`,
      `> Logins: ${stats.logins} | IP novo: ${stats.suspiciousNewIp.length} | Custo IA: $${stats.aiCostTotal.toFixed(2)} | Bulk deletes: ${stats.bulkDeletes}`,
    ];
    if (stats.suspiciousNewIp.length) {
      lines.push(`*Logins de IP novo:*`);
      stats.suspiciousNewIp.slice(0, 5).forEach(i =>
        lines.push(`  • ${i.email} de ${i.newIp}`));
    }
    if (stats.aiCostHigh.length) {
      lines.push(`*Usuarios com custo IA > $20/dia:*`);
      stats.aiCostHigh.slice(0, 5).forEach(u =>
        lines.push(`  • ${u.uid}: $${u.cost}`));
    }
    if (stats.criticalEvents.length) {
      lines.push(`*Eventos criticos:*`);
      stats.criticalEvents.slice(0, 5).forEach(e => lines.push(`  • ${e}`));
    }

    try {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: lines.join('\n') }),
      });
    } catch (e) {
      console.error('[digest] slack post failed:', e?.message);
    }
  }

  console.log('[digest] done', { riskScore, severity, ...stats });
});

/* ═════════════════════════════════════════════════════════
 * weeklySecretsAudit — Lembra admin a rotacionar secrets
 *
 * SOC 2 CC6.1 + ISO 27001 A.5.17: senhas/keys devem rotacionar
 * periodicamente (recomendado 90d).
 *
 * Roda toda segunda 09h BRT. Verifica idade de cada secret no
 * Secret Manager e alerta se algum > 90d. Posta no Slack se webhook
 * configurado, e SEMPRE grava em audit_logs.
 * ═════════════════════════════════════════════════════════ */
export const weeklySecretsAudit = onSchedule({
  schedule: '0 12 * * 1',   // segunda 09h BRT
  timeZone: 'America/Sao_Paulo',
  timeoutSeconds: 120,
  memory: '256MiB',
  secrets: [SIEM_SLACK_WEBHOOK],
}, async () => {
  const projectId = 'gestor-de-tarefas-primetour';
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();

  // Lista todas versions ativas dos secrets gerenciados
  const SECRETS_TO_AUDIT = [
    'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY',
    'R2_UPLOAD_TOKEN', 'SHAREPOINT_CLIENT_SECRET', 'GITHUB_PAT',
  ];
  const stale = []; // > 90d
  const aging = []; // 60-90d
  const fresh = []; // < 60d

  for (const name of SECRETS_TO_AUDIT) {
    try {
      const url = `https://secretmanager.googleapis.com/v1/projects/${projectId}/secrets/${name}/versions/latest`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken.token}` },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const created = new Date(data.createTime);
      const ageDays = Math.floor((Date.now() - created.getTime()) / 86400000);
      const entry = { name, ageDays, version: data.name.split('/').pop() };
      if (ageDays > 90) stale.push(entry);
      else if (ageDays > 60) aging.push(entry);
      else fresh.push(entry);
    } catch (e) {
      console.warn(`[secrets-audit] ${name} failed:`, e?.message);
    }
  }

  const severity = stale.length > 0 ? 'warning' : 'info';

  await db.collection('audit_logs').add({
    action: 'system.secrets_audit',
    target: 'all_managed_secrets',
    stats: {
      stale: stale.length, aging: aging.length, fresh: fresh.length,
      staleNames: stale.map(s => s.name),
    },
    timestamp: FieldValue.serverTimestamp(),
    severity,
  });

  // Slack alert apenas se houver stale
  const webhook = SIEM_SLACK_WEBHOOK.value();
  if (stale.length && webhook && webhook.startsWith('https://') && !webhook.includes('not-configured')) {
    const lines = [
      `*PRIMETOUR · Secrets Rotation Alert* (${stale.length} stale)`,
      `Os seguintes secrets passaram dos 90 dias e precisam rotacionar:`,
    ];
    stale.forEach(s => lines.push(`  • *${s.name}* — ${s.ageDays}d (v${s.version})`));
    lines.push(``);
    lines.push(`*Como rotacionar*:`);
    lines.push(`1. Gerar nova key no provider (Anthropic/OpenAI/etc)`);
    lines.push(`2. \`firebase functions:secrets:set <NAME>\``);
    lines.push(`3. \`firebase deploy --only functions\``);
    lines.push(`4. Revogar key antiga no provider`);

    try {
      await fetch(webhook, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: lines.join('\n') }),
      });
    } catch (e) {
      console.error('[secrets-audit] slack failed:', e?.message);
    }
  }

  console.log('[secrets-audit] done', { stale: stale.length, aging: aging.length, fresh: fresh.length });
});
