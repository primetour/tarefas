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
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule }         from 'firebase-functions/v2/scheduler';
import { onDocumentCreated }  from 'firebase-functions/v2/firestore';
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
const UNSPLASH_ACCESS_KEY = defineSecret('UNSPLASH_ACCESS_KEY');  // optional - fallback Wikipedia se nao setado
// EmailJS — credenciais movidas do client (config.js) pra cá pra evitar
// abuse via secrets em git público. Função sendCsatEmail valida caller +
// rate limita antes de enviar.
const EMAILJS_SERVICE_ID  = defineSecret('EMAILJS_SERVICE_ID');
const EMAILJS_TEMPLATE_ID = defineSecret('EMAILJS_TEMPLATE_ID');
const EMAILJS_PUBLIC_KEY  = defineSecret('EMAILJS_PUBLIC_KEY');
// 4.34.14+ Microsoft Graph (notificações email — substitui EmailJS)
const GRAPH_TENANT_ID     = defineSecret('GRAPH_TENANT_ID');
const GRAPH_CLIENT_ID     = defineSecret('GRAPH_CLIENT_ID');
const GRAPH_CLIENT_SECRET = defineSecret('GRAPH_CLIENT_SECRET');
const GRAPH_SENDER_EMAIL  = defineSecret('GRAPH_SENDER_EMAIL');
const GRAPH_SENDER_ID     = defineSecret('GRAPH_SENDER_ID');  // 4.34.14+ Object ID do sender (UUID)

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
 * getAISecretsStatus — Lista quais secrets de provider estao
 * configurados (sem expor o valor). Retorna { anthropic: true,
 * openai: false, ... }. Usado pela UI de API Keys.
 * ═════════════════════════════════════════════════════════ */
export const getAISecretsStatus = onCall({
  cors: ['https://primetour.github.io', 'http://localhost:5000'],
  secrets: [ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, GROQ_API_KEY],
  maxInstances: 5,
  timeoutSeconds: 10,
}, async (request) => {
  requireAuth(request);
  const isConfigured = (v) =>
    typeof v === 'string' && v.length > 8 && v !== 'not-configured-yet';
  return {
    anthropic: isConfigured(ANTHROPIC_API_KEY.value()),
    openai:    isConfigured(OPENAI_API_KEY.value()),
    gemini:    isConfigured(GEMINI_API_KEY.value()),
    groq:      isConfigured(GROQ_API_KEY.value()),
    // Tamanho aproximado pra UI confirmar visualmente (sem expor o valor)
    lengths: {
      anthropic: (ANTHROPIC_API_KEY.value() || '').length,
      openai:    (OPENAI_API_KEY.value() || '').length,
      gemini:    (GEMINI_API_KEY.value() || '').length,
      groq:      (GROQ_API_KEY.value() || '').length,
    },
  };
});

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
    // 4.35.23+ multimodal + web search
    attachments = [],
    webSearch = false,
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
    if (provider === 'anthropic') result = await callAnthropic(apiKey, { model, systemPrompt, userMessage, history, maxTokens, temperature, attachments, webSearch });
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

  // ── Calculo de economia por prompt caching (estimativa) ──
  // Multiplicadores aproximados (preco / 1M tokens):
  //   Anthropic Sonnet 4: input $3, cache read $0.30 (90% desconto), cache write $3.75 (1.25x)
  //   OpenAI gpt-4o:      input $2.50, cached $1.25 (50% desconto)
  // Para nao depender de tabela hardcoded por modelo, usamos o desconto
  // medio: cache read = 80% economia ($0.20 por $1.00 normal).
  const cacheCreationTokens = result.cacheCreationTokens || 0;
  const cacheReadTokens     = result.cacheReadTokens || 0;
  // Economia em tokens: cache hit cobra so ~10-50% do input normal.
  // Conservadoramente, cada token cached economiza 0.7x (70% desconto medio).
  const tokensSaved = cacheReadTokens * 0.7;

  // ── Log de uso (com TTL 90d) ──
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90);
  await db.collection('ai_usage_logs').add({
    userId: uid,
    agentId, agentName: data.agentName || null,
    module: data.module || 'general',
    provider, model: result.model || model,
    inputTokens:           result.inputTokens || 0,
    outputTokens:          result.outputTokens || 0,
    cacheCreationTokens,        // novo: tokens escritos no cache (custa 1.25x)
    cacheReadTokens,            // novo: tokens lidos do cache (custa 0.1-0.5x)
    tokensSaved:           Math.round(tokensSaved),  // estimativa de economia
    cacheHit:              cacheReadTokens > 0,      // bool: usou cache?
    timestamp: FieldValue.serverTimestamp(),
    expiresAt,
    source: data.source || 'cloud-function',
  });

  return {
    text:                result.text,
    model:               result.model || model,
    inputTokens:         result.inputTokens || 0,
    outputTokens:        result.outputTokens || 0,
    cacheCreationTokens,
    cacheReadTokens,
    cacheHit:            cacheReadTokens > 0,
  };
});

/* ─── Provider callers (sem ai.js exposure) ──────────────── */
async function callAnthropic(apiKey, { model, systemPrompt, userMessage, history, maxTokens, temperature, attachments, webSearch }) {
  // 4.35.23+ MULTIMODAL (vision): se `attachments` é array de imagens
  // (data URLs ou {type:'image', source:{type:'base64', media_type, data}}),
  // monta o content com tipos misturados.
  const buildUserContent = () => {
    const atts = Array.isArray(attachments) ? attachments : [];
    if (!atts.length) return userMessage;
    // Anthropic API: messages[].content pode ser string OU array de blocos
    const blocks = [];
    for (const a of atts) {
      if (a?.type === 'image' && a?.source) {
        blocks.push(a); // já no formato {type:'image', source:{...}}
      } else if (typeof a === 'string' && a.startsWith('data:image')) {
        // data URL → split prefix
        const m = a.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
        if (m) blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: m[1], data: m[2] },
        });
      }
    }
    blocks.push({ type: 'text', text: userMessage });
    return blocks;
  };

  const messages = [
    ...history.map(h => ({ role: h.role, content: h.text })),
    { role: 'user', content: buildUserContent() },
  ];

  // PROMPT CACHING: cacheia system prompt se >= 1024 chars
  const useCache = systemPrompt && systemPrompt.length >= 1024;
  const systemField = useCache
    ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
    : systemPrompt;

  // 4.35.23+ Web search nativo do Anthropic (server-side tool).
  // Quando habilitado, o modelo decide quando fazer busca + cita fontes.
  // Custos: $10 por 1000 buscas (a partir do Claude 3.5 Sonnet).
  const tools = webSearch
    ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]
    : undefined;

  const reqBody = {
    model: model || 'claude-sonnet-4-6',
    system: systemField,
    messages,
    max_tokens: maxTokens,
    temperature,
  };
  if (tools) reqBody.tools = tools;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(reqBody),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const d = await res.json();
  // Extrair texto de TODOS os blocos type=text (web_search retorna múltiplos blocos)
  const textBlocks = (d.content || []).filter(b => b.type === 'text').map(b => b.text || '');
  const webSearches = (d.content || []).filter(b => b.type === 'server_tool_use' && b.name === 'web_search');
  return {
    text: textBlocks.join('\n'),
    model: d.model,
    inputTokens:           d.usage?.input_tokens || 0,
    outputTokens:          d.usage?.output_tokens || 0,
    cacheCreationTokens:   d.usage?.cache_creation_input_tokens || 0,
    cacheReadTokens:       d.usage?.cache_read_input_tokens || 0,
    webSearchCount:        webSearches.length,
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
    inputTokens:     d.usage?.prompt_tokens || 0,
    outputTokens:    d.usage?.completion_tokens || 0,
    // PROMPT CACHING: gpt-4o-2024-12-17+ cacheia automaticamente prompts > 1024 tokens.
    // Sem código adicional necessário — só extrair `cached_tokens` do response.
    // Desconto: 50% no input dos tokens cached.
    cacheReadTokens: d.usage?.prompt_tokens_details?.cached_tokens || 0,
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
/* ═════════════════════════════════════════════════════════
 * migrateUserToSso — apaga credencial Auth de user pré-cadastrado
 * pra liberar SSO Microsoft.
 *
 * CONTEXTO DO BUG: usuários SSO eram cadastrados pelo admin com senha
 * temporária via createUser (auth.js antigo). Isso registrava o email
 * no Firebase Auth com provider 'password'. Quando o user tentava SSO
 * Microsoft, o Firebase detectava colisão e jogava
 * 'auth/account-exists-with-different-credential', forçando a tela de
 * "vincular conta" que pedia a senha original — que o user não sabia.
 *
 * ESTA FUNCTION:
 *   1. Recebe { email } e valida que o admin chamador é mesmo admin.
 *   2. Apaga o user do Firebase Auth (deleteUser) — libera o email.
 *   3. Atualiza o doc Firestore correspondente:
 *      - Move pra um doc novo keyed por pending_email (igual createUser
 *        SSO faz hoje).
 *      - Marca pendingSso: true.
 *   4. Próxima vez que o user clicar "Entrar com Microsoft", o
 *      auto-provision em initAuthObserver detecta o doc pendente,
 *      consolida no UID definitivo do Firebase Auth e apaga o stub.
 *
 * PRESERVA: name, role, sector, núcleos, lastLogin, createdBy.
 * APAGA: nada do Firestore (só do Auth).
 * ═════════════════════════════════════════════════════════ */
export const migrateUserToSso = onCall({
  cors: ['https://primetour.github.io', 'http://localhost:5000'],
  maxInstances: 5,
}, async (request) => {
  const auth = requireAuth(request);
  const adminFlag = await isAdmin(auth.uid);
  if (!adminFlag) throw new HttpsError('permission-denied', 'Só admin pode migrar usuários para SSO.');

  const { email } = request.data || {};
  if (!email || typeof email !== 'string') {
    throw new HttpsError('invalid-argument', 'email obrigatório');
  }
  const cleanEmail = email.trim().toLowerCase();

  // Valida domínio SSO (não faz sentido migrar email externo p/ SSO)
  const SSO_DOMAINS = ['primetour.com.br', 'primetravel.tur.br', 'primetouroperator.com.br'];
  const isSsoDomain = SSO_DOMAINS.some(d => cleanEmail.endsWith('@' + d));
  if (!isSsoDomain) {
    throw new HttpsError('invalid-argument',
      `Email ${cleanEmail} não é de domínio SSO autorizado.`);
  }

  // Busca user no Firebase Auth pelo email
  let authUser = null;
  try {
    authUser = await getAuth().getUserByEmail(cleanEmail);
  } catch (e) {
    // Se não tem credencial Auth, já está OK pra SSO — só precisamos
    // garantir que o doc Firestore esteja em estado "pendente".
    if (e.code !== 'auth/user-not-found') throw new HttpsError('internal', e.message);
  }

  // Localiza doc Firestore atual (pode ser keyed por UID ou pending_)
  let firestoreDoc = null;
  let firestoreId = null;
  if (authUser) {
    const byUid = await db.doc(`users/${authUser.uid}`).get();
    if (byUid.exists) {
      firestoreDoc = byUid.data();
      firestoreId = byUid.id;
    }
  }
  if (!firestoreDoc) {
    // Tenta achar por email (caso o doc tenha UID diferente do Auth — recovery scenario)
    const q = await db.collection('users').where('email', '==', cleanEmail).limit(1).get();
    if (!q.empty) {
      firestoreDoc = q.docs[0].data();
      firestoreId = q.docs[0].id;
    }
  }

  // CRÍTICO: antes de apagar do Auth, capturamos o legacyUid pra fazer
  // o swap em workspaces.members + workspaces.adminIds. Sem isso, o user
  // entra via SSO mas as squads perdem a referência (orphan UID nos arrays)
  // e ele cai na tela "sem workspace". Bug reportado em produção 04/05/26.
  const legacyUid = authUser?.uid || null;

  // Determina o pendingId logo (usado em vários pontos)
  const pendingId = `pending_${cleanEmail.replace(/[@.]/g, '_')}`;

  // ── Swap em workspaces: troca legacyUid por pendingId em members/adminIds ──
  // Isso "preserva o vínculo" durante a janela em que o user está pending.
  // Quando ele logar via SSO, o auto-provision faz outra rodada
  // (pendingId → newUid). Assim o squad nunca fica órfão.
  let workspacesPatched = 0;
  if (legacyUid) {
    try {
      const wsSnap = await db.collection('workspaces')
        .where('members', 'array-contains', legacyUid)
        .get();
      const updates = wsSnap.docs.map(async (wsDoc) => {
        const data = wsDoc.data();
        const patch = {
          members: FieldValue.arrayUnion(pendingId),
          updatedAt: FieldValue.serverTimestamp(),
        };
        // arrayRemove vem em chamada separada (FieldValue.arrayRemove + arrayUnion
        // do mesmo elemento na mesma op pode ser ambíguo)
        await wsDoc.ref.update({ members: FieldValue.arrayRemove(legacyUid) });
        await wsDoc.ref.update(patch);
        // adminIds idem
        if ((data.adminIds || []).includes(legacyUid)) {
          await wsDoc.ref.update({ adminIds: FieldValue.arrayRemove(legacyUid) });
          await wsDoc.ref.update({ adminIds: FieldValue.arrayUnion(pendingId) });
        }
      });
      await Promise.all(updates);
      workspacesPatched = wsSnap.size;
    } catch (wsErr) {
      console.warn('[migrateUserToSso] workspace patch falhou:', wsErr.message);
    }
  }

  // Apaga user do Auth (libera o email pra SSO claim)
  if (authUser) {
    try {
      await getAuth().deleteUser(authUser.uid);
    } catch (e) {
      throw new HttpsError('internal', `Falha ao apagar user do Auth: ${e.message}`);
    }
  }

  // Garante que o doc Firestore esteja em estado "pendente SSO"
  // (preserva role/setor/núcleos pré-configurados)
  if (firestoreDoc) {
    const newDoc = {
      ...firestoreDoc,
      id: pendingId,
      email: cleanEmail,
      pendingSso: true,
      legacyUid: legacyUid, // Preservar pra auditoria + reparos retroativos
      authProvider: 'microsoft.com',
      migratedToSsoAt: FieldValue.serverTimestamp(),
      migratedToSsoBy: auth.uid,
    };
    // Cria novo doc com ID pendente
    await db.doc(`users/${pendingId}`).set(newDoc);
    // Apaga o doc antigo (se ID era diferente do pending)
    if (firestoreId && firestoreId !== pendingId) {
      await db.doc(`users/${firestoreId}`).delete();
    }
  }

  // Audit log
  await db.collection('audit_logs').add({
    action: 'users.migrate_to_sso',
    userId: auth.uid,
    targetEmail: cleanEmail,
    deletedAuth: !!authUser,
    legacyUid,
    pendingId,
    workspacesPatched,
    timestamp: FieldValue.serverTimestamp(),
    severity: 'warning',
  });

  return {
    ok: true,
    deletedFromAuth: !!authUser,
    pendingDocCreated: !!firestoreDoc,
    workspacesPatched,
    message: `${cleanEmail} pronto para SSO. ${workspacesPatched} squads atualizadas.`,
  };
});

/* ═════════════════════════════════════════════════════════
 * migrateUserUidGlobal — migração SISTÊMICA de UID antigo → UID novo
 * em TODAS as coleções que referenciam users.
 *
 * MOTIVAÇÃO: cada user que migrava de Auth password → SSO recebia novo
 * UID. Patches anteriores cuidaram só de workspace.members + adminIds.
 * Mas o sistema referencia user UID em ~50 outros campos (task.assignees,
 * task.createdBy, goal.metaLinks, notification.recipientId, etc).
 *
 * Cenário típico: Renê tinha UID `unDExA*` (Auth password). Migrou pra
 * SSO, recebeu `OvnFxqaU*`. Tasks criadas antes têm createdBy=unDExA*
 * → admin abre task, vê "(usuário)" como criador → bug.
 *
 * Esta function:
 *   1. Detecta automaticamente users que tiveram migração (têm
 *      legacyUid setado OR aparecem em audit_logs.users.create)
 *   2. Pra cada (legacyUid, currentUid):
 *      - Varre TODAS as 50+ coleções+campos da matriz abaixo
 *      - Faz arrayRemove(legacyUid) + arrayUnion(currentUid) em arrays
 *      - Faz update de strings (createdBy, updatedBy, etc)
 *   3. Bulk pra performance: usa BatchedWrite quando possível
 *   4. Idempotente: rodar várias vezes não causa side-effect (lookup
 *      seguro, swap só se ainda referencia o legacyUid)
 *   5. Retorna relatório completo
 *
 * SEGURANÇA: só admin pode chamar. Audit log com severity critical.
 * ═════════════════════════════════════════════════════════ */
export const migrateUserUidGlobal = onCall({
  cors: ['https://primetour.github.io', 'http://localhost:5000'],
  maxInstances: 1, // proteção: roda 1 por vez (writes em massa)
  timeoutSeconds: 540,
  memory: '512MiB',
}, async (request) => {
  const auth = requireAuth(request);
  const adminFlag = await isAdmin(auth.uid);
  if (!adminFlag) throw new HttpsError('permission-denied', 'Só admin.');

  // dryRun (default false): calcula pares e conta docs que SERIAM tocados,
  // sem fazer nenhum write. Útil pra validar antes de aplicar em produção.
  const dryRun = request.data?.dryRun === true;

  // Mapa: collection name → array de campos a migrar
  // Tipo do campo: 'string' (single uid) ou 'array' (array de uids)
  const COLLECTION_FIELD_MAP = {
    workspaces: [
      { field: 'members', type: 'array' },
      { field: 'adminIds', type: 'array' },
      { field: 'createdBy', type: 'string' },
      { field: 'updatedBy', type: 'string' },
      { field: 'ownerId', type: 'string' },
    ],
    workspace_invites: [
      { field: 'createdBy', type: 'string' },
    ],
    tasks: [
      { field: 'assignees', type: 'array' },
      { field: 'observers', type: 'array' },
      { field: 'createdBy', type: 'string' },
      { field: 'updatedBy', type: 'string' },
      { field: 'completedBy', type: 'string' },
    ],
    tasks_archive: [
      { field: 'assignees', type: 'array' },
      { field: 'observers', type: 'array' },
      { field: 'createdBy', type: 'string' },
      { field: 'updatedBy', type: 'string' },
    ],
    projects: [
      { field: 'members', type: 'array' },
      { field: 'createdBy', type: 'string' },
      { field: 'updatedBy', type: 'string' },
    ],
    goals: [
      { field: 'createdBy', type: 'string' },
      { field: 'updatedBy', type: 'string' },
    ],
    goal_evaluations: [
      { field: 'createdBy', type: 'string' },
      { field: 'updatedBy', type: 'string' },
    ],
    notifications: [
      { field: 'recipientId', type: 'string' },
      { field: 'recipientIds', type: 'array' },
      { field: 'actorId', type: 'string' },
      { field: 'userId', type: 'string' },
    ],
    requests: [
      { field: 'assignedTo', type: 'string' },
      { field: 'updatedBy', type: 'string' },
      { field: 'requestedBy', type: 'string' },
    ],
    csat_surveys: [
      { field: 'userId', type: 'string' },
      { field: 'createdBy', type: 'string' },
      { field: 'assignedTo', type: 'string' },
    ],
    feedbacks: [
      { field: 'createdBy', type: 'string' },
      { field: 'updatedBy', type: 'string' },
      { field: 'givenBy', type: 'string' },
      { field: 'receivedBy', type: 'string' },
    ],
    feedback_schedules: [
      { field: 'createdBy', type: 'string' },
    ],
    landing_pages: [
      { field: 'createdBy', type: 'string' },
      { field: 'updatedBy', type: 'string' },
    ],
    roteiros: [
      { field: 'createdBy', type: 'string' },
      { field: 'updatedBy', type: 'string' },
      { field: 'assignees', type: 'array' },
    ],
    portal_areas: [
      { field: 'createdBy', type: 'string' },
      { field: 'updatedBy', type: 'string' },
    ],
    news_monitor: [
      { field: 'createdBy', type: 'string' },
      { field: 'updatedBy', type: 'string' },
    ],
    absences: [
      { field: 'userId', type: 'string' },
      { field: 'createdBy', type: 'string' },
      { field: 'updatedBy', type: 'string' },
    ],
    vacation_requests: [
      { field: 'userId', type: 'string' },
      { field: 'createdBy', type: 'string' },
    ],
    vacation_periods: [
      { field: 'userId', type: 'string' },
    ],
    time_clock: [
      { field: 'userId', type: 'string' },
      { field: 'createdBy', type: 'string' },
      { field: 'updatedBy', type: 'string' },
    ],
    desk_reservations: [
      { field: 'userId', type: 'string' },
    ],
    ai_skills: [
      { field: 'createdBy', type: 'string' },
      { field: 'updatedBy', type: 'string' },
    ],
    ai_automations: [
      { field: 'createdBy', type: 'string' },
      { field: 'updatedBy', type: 'string' },
    ],
    task_categories: [
      { field: 'createdBy', type: 'string' },
    ],
    meta_posts: [
      { field: 'createdBy', type: 'string' },
      { field: 'updatedBy', type: 'string' },
    ],
    roles: [
      { field: 'createdBy', type: 'string' },
      { field: 'updatedBy', type: 'string' },
    ],
    portal_generations: [
      { field: 'generatedBy', type: 'string' },
    ],
  };

  // ── 1. Coletar todos os pares (legacyUid → currentUid) a migrar ──
  // 3 fontes de detecção:
  //   A) audit_logs com action=users.create (cruzando entityId/targetUid com email)
  //   B) users.legacyUid setado explicitamente (de migrateUserToSso ou manual)
  //   C) Slug pending_<email> derivado: detecta refs órfãs em tasks/etc para
  //      users que tinham doc pré-cadastrado (pendingSso) e logaram via SSO,
  //      criando UID real, mas as refs em tasks/projetos não foram migradas
  //      (o consolidation antigo só re-bindava workspaces.members).
  const usersSnap = await db.collection('users').get();
  const emailToCurrent = {};
  // Real-wins-over-pending: se 2 docs têm mesmo email (pending + real durante
  // janela de transição), o doc real ganha. Sem isso, ordem de iteração não
  // determinística poderia eleger o pending como currentUid (= bug).
  usersSnap.docs.forEach(d => {
    const email = (d.data().email || '').toLowerCase();
    if (!email) return;
    const isPending = d.id.startsWith('pending_');
    if (emailToCurrent[email] && isPending) return; // não sobrescreve real com pending
    emailToCurrent[email] = { id: d.id, legacyUid: d.data().legacyUid || null };
  });

  const auditSnap = await db.collection('audit_logs')
    .where('action', '==', 'users.create')
    .limit(1000)
    .get();

  const migrationPairs = []; // [{ legacyUid, currentUid, email, source }]
  const seen = new Set();
  // Fonte A: audit_logs
  auditSnap.docs.forEach(d => {
    const data = d.data();
    const email = (data.details?.email || data.targetEmail || '').toLowerCase();
    const legacyUid = data.entityId || data.targetUid;
    if (!email || !legacyUid) return;
    const current = emailToCurrent[email];
    if (!current || current.id === legacyUid) return; // sem migração necessária
    const key = `${legacyUid}->${current.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    migrationPairs.push({ legacyUid, currentUid: current.id, email, source: 'audit_log' });
  });

  // Fonte B: users.legacyUid (de migrações via migrateUserToSso ou manual)
  usersSnap.docs.forEach(d => {
    const u = d.data();
    if (u.legacyUid && u.legacyUid !== d.id) {
      const key = `${u.legacyUid}->${d.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        migrationPairs.push({ legacyUid: u.legacyUid, currentUid: d.id, email: u.email, source: 'legacyUid_field' });
      }
    }
  });

  // Fonte C: slug pending_<email> automático
  // Pra cada user com ID real (não pending_), gera o slug que teria sido usado
  // como ID temporário pré-cadastro e adiciona como par candidato.
  // Idempotência: se não houver nenhuma referência com esse slug em lugar
  // algum, simplesmente nada migra (queries retornam 0 docs).
  // Regra do slug: precisa bater com o que auth.js usa em pre-cadastro:
  //   `pending_${email.toLowerCase().replace(/[@.]/g, '_')}`
  usersSnap.docs.forEach(d => {
    if (d.id.startsWith('pending_')) return; // só users já consolidados
    const email = (d.data().email || '').toLowerCase();
    if (!email) return;
    const candidateLegacy = `pending_${email.replace(/[@.]/g, '_')}`;
    if (candidateLegacy === d.id) return; // segurança extra
    const key = `${candidateLegacy}->${d.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    migrationPairs.push({ legacyUid: candidateLegacy, currentUid: d.id, email, source: 'pending_slug' });
  });

  // ── 2. Pra cada par, varre coleções e faz swap ──
  const report = {
    dryRun,
    pairsScanned: migrationPairs.length,
    pairsBySource: migrationPairs.reduce((acc, p) => { acc[p.source] = (acc[p.source]||0)+1; return acc; }, {}),
    migrations: [],
    errors: [],
    totalDocsTouched: 0,
  };

  for (const pair of migrationPairs) {
    const { legacyUid, currentUid, email, source } = pair;
    const summary = { email, source, legacyUid: legacyUid.slice(0,12), currentUid: currentUid.slice(0,8), perCollection: {} };

    for (const [colName, fields] of Object.entries(COLLECTION_FIELD_MAP)) {
      let touchedInColl = 0;

      // Pra cada FIELD da coleção, faz uma query separada
      // (não dá pra "OR" entre campos no Firestore)
      for (const { field, type } of fields) {
        try {
          let snap;
          if (type === 'array') {
            snap = await db.collection(colName)
              .where(field, 'array-contains', legacyUid)
              .limit(500)
              .get();
          } else {
            snap = await db.collection(colName)
              .where(field, '==', legacyUid)
              .limit(500)
              .get();
          }

          for (const doc of snap.docs) {
            try {
              if (!dryRun) {
                if (type === 'array') {
                  await doc.ref.update({ [field]: FieldValue.arrayRemove(legacyUid) });
                  await doc.ref.update({ [field]: FieldValue.arrayUnion(currentUid) });
                } else {
                  await doc.ref.update({ [field]: currentUid });
                }
              }
              touchedInColl++;
            } catch (e) {
              report.errors.push({ collection: colName, field, docId: doc.id, error: e.message });
            }
          }
        } catch (queryErr) {
          // Coleção pode não existir, ou não ter index pro field. Não fatal.
          if (!String(queryErr.message || '').includes('no matching index')) {
            console.warn(`[migrateGlobal] query ${colName}.${field} skip: ${queryErr.message}`);
          }
        }
      }

      if (touchedInColl > 0) {
        summary.perCollection[colName] = touchedInColl;
        report.totalDocsTouched += touchedInColl;
      }
    }

    report.migrations.push(summary);
  }

  // ── 3. Tratamento ESPECIAL de campos nested (não cobertos por where) ──
  // tasks.metaLinks[].userId é o caso clássico: array de objetos onde o
  // userId está dentro do obj. Firestore não permite query/index disso,
  // então temos que ler TODOS os tasks e fazer map em memória.
  // Mesma lógica para tasks_archive.
  const NESTED_COLLECTIONS = [
    { col: 'tasks',         field: 'metaLinks', subField: 'userId' },
    { col: 'tasks_archive', field: 'metaLinks', subField: 'userId' },
  ];
  const legacyToCurrent = {};
  migrationPairs.forEach(p => { legacyToCurrent[p.legacyUid] = p.currentUid; });
  const allLegacyUids = new Set(Object.keys(legacyToCurrent));

  let nestedTouched = 0;
  for (const { col, field, subField } of NESTED_COLLECTIONS) {
    try {
      const snap = await db.collection(col).get();
      for (const docSnap of snap.docs) {
        const arr = docSnap.data()[field];
        if (!Array.isArray(arr)) continue;
        let dirty = false;
        const newArr = arr.map(item => {
          if (item && typeof item === 'object' && allLegacyUids.has(item[subField])) {
            dirty = true;
            return { ...item, [subField]: legacyToCurrent[item[subField]] };
          }
          return item;
        });
        if (dirty) {
          try {
            if (!dryRun) await docSnap.ref.update({ [field]: newArr });
            nestedTouched++;
          } catch (e) {
            report.errors.push({ collection: col, field: `${field}[].${subField}`, docId: docSnap.id, error: e.message });
          }
        }
      }
    } catch (e) {
      console.warn(`[migrateGlobal] nested ${col}.${field}.${subField} skip: ${e.message}`);
    }
  }
  report.totalDocsTouched += nestedTouched;
  report.nestedDocsTouched = nestedTouched;

  // Audit log (não loga em dryRun pra não poluir logs com simulações)
  if (!dryRun) {
    await db.collection('audit_logs').add({
      action: 'system.migrate_user_uid_global',
      userId: auth.uid,
      pairsScanned: report.pairsScanned,
      pairsBySource: report.pairsBySource,
      totalDocsTouched: report.totalDocsTouched,
      errorCount: report.errors.length,
      timestamp: FieldValue.serverTimestamp(),
      severity: 'critical',
    });
  }

  return report;
});

/* ═════════════════════════════════════════════════════════
 * auditAndMigrateAllSso — varre TODOS users SSO no Firestore e migra
 * automaticamente quem ainda tem credencial email/senha no Firebase Auth.
 *
 * Bug original: usuários cadastrados com password ANTES do SSO ficavam
 * com credencial 'password' no Auth. Quando tentavam SSO Microsoft,
 * Firebase batia colisão (account-exists-with-different-credential) e
 * pedia a senha original — que ninguém sabia.
 *
 * Esta function:
 *  1. Lista todos users SSO domain no Firestore
 *  2. Pra cada um, busca Auth user pelo email
 *  3. Se encontrar e tiver provider 'password' (não 'microsoft.com'):
 *     - Adiciona à fila de migração
 *  4. Migra cada um chamando a lógica do migrateUserToSso (inline pra
 *     evitar HTTP roundtrip)
 *
 * EXCEÇÕES (não migra):
 *  - Emails na list `keepPasswordEmails` (admin emergencial)
 *  - Users que já só têm provider 'microsoft.com' (já SSO-only)
 *  - Users sem Auth credential (já em pending state)
 *
 * Idempotente: rodar várias vezes não faz mal. Só migra quem precisa.
 * ═════════════════════════════════════════════════════════ */
export const auditAndMigrateAllSso = onCall({
  cors: ['https://primetour.github.io', 'http://localhost:5000'],
  maxInstances: 2,
  timeoutSeconds: 540,
}, async (request) => {
  const auth = requireAuth(request);
  const adminFlag = await isAdmin(auth.uid);
  if (!adminFlag) throw new HttpsError('permission-denied', 'Só admin.');

  // Manter login emergencial: admin@primetour.com.br fica com password
  // pra acesso de recuperação. Outros podem ser opt-in via UI no futuro.
  const keepPasswordEmails = new Set([
    'admin@primetour.com.br',
  ]);

  const ssoDomains = ['primetour.com.br', 'primetravel.tur.br', 'primetouroperator.com.br'];
  const isSsoDomain = e => ssoDomains.some(d => (e||'').toLowerCase().endsWith('@'+d));

  // 1. Lista users SSO no Firestore (skip pendings + skip excluded emails)
  const usersSnap = await db.collection('users').get();
  const candidates = usersSnap.docs
    .map(d => ({ id: d.id, data: d.data() }))
    .filter(u => {
      const email = (u.data.email || '').toLowerCase();
      if (!isSsoDomain(email)) return false;
      if (keepPasswordEmails.has(email)) return false;
      if (u.data.pendingSso === true) return false; // já em estado pending
      return true;
    });

  const report = {
    scanned: candidates.length,
    skippedAlreadySso: 0,
    skippedNoAuth: 0,
    migrated: [],
    errors: [],
  };

  for (const u of candidates) {
    const email = (u.data.email || '').toLowerCase();
    let authUser;
    try {
      authUser = await getAuth().getUserByEmail(email);
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        report.skippedNoAuth++;
        continue;
      }
      report.errors.push({ email, stage: 'getUserByEmail', error: e.message });
      continue;
    }

    // Verifica providers do Auth user
    const providers = (authUser.providerData || []).map(p => p.providerId);
    const hasPassword = providers.includes('password');
    const hasMicrosoft = providers.includes('microsoft.com');

    // Se já é só Microsoft (sem password), pula
    if (!hasPassword) {
      report.skippedAlreadySso++;
      continue;
    }

    // Migra: swap workspaces + delete Auth + move Firestore doc pra pending
    try {
      const legacyUid = authUser.uid;
      const pendingId = `pending_${email.replace(/[@.]/g, '_')}`;

      // Swap em workspaces (members + adminIds)
      const wsSnap = await db.collection('workspaces')
        .where('members', 'array-contains', legacyUid)
        .get();
      let wsPatch = 0;
      for (const wsDoc of wsSnap.docs) {
        const data = wsDoc.data();
        await wsDoc.ref.update({ members: FieldValue.arrayRemove(legacyUid) });
        await wsDoc.ref.update({ members: FieldValue.arrayUnion(pendingId) });
        if ((data.adminIds || []).includes(legacyUid)) {
          await wsDoc.ref.update({ adminIds: FieldValue.arrayRemove(legacyUid) });
          await wsDoc.ref.update({ adminIds: FieldValue.arrayUnion(pendingId) });
        }
        wsPatch++;
      }

      // Delete Auth credential
      await getAuth().deleteUser(legacyUid);

      // Move Firestore doc → pending
      const newDoc = {
        ...u.data,
        id: pendingId,
        email,
        pendingSso: true,
        legacyUid,
        authProvider: 'microsoft.com',
        migratedToSsoAt: FieldValue.serverTimestamp(),
        migratedToSsoBy: auth.uid,
        autoMigrated: true,
      };
      await db.doc(`users/${pendingId}`).set(newDoc);
      if (u.id !== pendingId) {
        await db.doc(`users/${u.id}`).delete();
      }

      report.migrated.push({ email, name: u.data.name, legacyUid: legacyUid.slice(0,8), workspacesPatched: wsPatch });
    } catch (e) {
      report.errors.push({ email, stage: 'migrate', error: e.message });
    }
  }

  // Audit log
  await db.collection('audit_logs').add({
    action: 'system.audit_and_migrate_all_sso',
    userId: auth.uid,
    scanned: report.scanned,
    migrated: report.migrated.length,
    errors: report.errors.length,
    timestamp: FieldValue.serverTimestamp(),
    severity: 'critical',
  });

  return report;
});

/* ═════════════════════════════════════════════════════════
 * repairOrphanSquadMembers — backfill pra usuários migrados ANTES do
 * fix de workspaces.members estar no migrateUserToSso.
 *
 * Como funciona:
 *  1. Lê audit_logs com action='users.create' → mapa email → oldUid.
 *  2. Lê todos users com pendingSso=true (sem legacyUid setado).
 *  3. Pra cada pending, descobre oldUid pelo email no mapa.
 *  4. Atualiza workspaces que continham oldUid: arrayRemove(oldUid)
 *     + arrayUnion(pendingId) em members + adminIds.
 *  5. Backfill o legacyUid no doc pending (pra futuras consolidações).
 *  6. Retorna relatório completo.
 *
 * Chamado pelo botão "Reparar membros órfãos" na UI Users (admin only).
 * ═════════════════════════════════════════════════════════ */
export const repairOrphanSquadMembers = onCall({
  cors: ['https://primetour.github.io', 'http://localhost:5000'],
  maxInstances: 3,
  timeoutSeconds: 180,
}, async (request) => {
  const auth = requireAuth(request);
  const adminFlag = await isAdmin(auth.uid);
  if (!adminFlag) throw new HttpsError('permission-denied', 'Só admin.');

  // ─── ESTRATÉGIA REVISADA ──────────────────────────────────
  // V1 só lidava com pendingSso users. Mas usuários já consolidados
  // (que migraram E entraram via SSO) também ficam com squads
  // referenciando uid ANTIGO. Detectado em prod: Renê (unDExA) e Rafaela
  // (UWY3xa) eram members de squads via uid antigo, mesmo já tendo
  // entrado via SSO com uid novo.
  //
  // V2: varre TODOS os squads, identifica UIDs órfãos (não correspondem
  // a nenhum users/{id} atual), mapeia cada órfão pro email via audit
  // logs, e procura o user atual por email pra fazer o swap.
  // ──────────────────────────────────────────────────────────

  // 1. Snapshot de todos os users (validUids + email → currentUid)
  const usersSnap = await db.collection('users').get();
  const validUids = new Set();
  const emailToCurrentUid = {};
  usersSnap.docs.forEach(d => {
    validUids.add(d.id);
    const email = (d.data().email || '').toLowerCase();
    if (email) emailToCurrentUid[email] = d.id;
  });

  // 2. Audit logs: mapa oldUid → email (todos os users.create)
  const auditSnap = await db.collection('audit_logs')
    .where('action', '==', 'users.create')
    .limit(1000)
    .get();
  const oldUidToEmail = {};
  auditSnap.docs.forEach(d => {
    const data = d.data();
    const email = (data.details?.email || data.targetEmail || '').toLowerCase();
    const oldUid = data.entityId || data.targetUid;
    if (email && oldUid) oldUidToEmail[oldUid] = email;
  });

  // 2b. Pending IDs órfãos: o pattern é pending_local_part_domain_com_br
  // (criados por createUser SSO + posteriormente consolidados+deletados).
  // Audit logs não os indexam por entityId (pending IDs são gerados no
  // momento do createUser, sem passar por users.create com UID Firebase).
  // Heurística: se orphan começa com "pending_", varre users por email
  // e tenta match. Como o slug perde info de pontuação, comparamos slugs.
  // Helper local: gera o slug pendente de um email (mesma lógica do createUser SSO)
  const slugFromEmail = (email) => `pending_${email.replace(/[@.]/g, '_')}`;
  const pendingSlugToEmail = {};
  // Mapeia slugs → emails de TODOS os users atuais (cobre tanto consolidados
  // quanto pendings que ainda existem)
  usersSnap.docs.forEach(d => {
    const email = (d.data().email || '').toLowerCase();
    if (email) pendingSlugToEmail[slugFromEmail(email)] = email;
  });

  // 3. Varre workspaces, identifica órfãos, faz swap
  const wsSnap = await db.collection('workspaces').get();
  const report = [];
  let totalPatched = 0;
  let workspacesPatched = 0;

  for (const wsDoc of wsSnap.docs) {
    const data = wsDoc.data();
    const members = data.members || [];
    const adminIds = data.adminIds || [];
    const orphanMembers = members.filter(uid => !validUids.has(uid));
    const orphanAdmins  = adminIds.filter(uid => !validUids.has(uid));
    const allOrphans = [...new Set([...orphanMembers, ...orphanAdmins])];

    if (!allOrphans.length) continue;

    let wsPatched = 0;
    for (const orphanUid of allOrphans) {
      // Lookup do email: 1º tenta audit_logs, 2º (se for pending_*) tenta
      // resolver via slug (mesma lógica de createUser SSO).
      let email = oldUidToEmail[orphanUid];
      if (!email && orphanUid.startsWith('pending_')) {
        email = pendingSlugToEmail[orphanUid];
      }
      if (!email) {
        report.push({
          workspace: data.name, orphanUid, status: 'sem_email_no_audit',
        });
        continue;
      }
      const currentUid = emailToCurrentUid[email];
      if (!currentUid) {
        report.push({
          workspace: data.name, orphanUid, email, status: 'user_atual_nao_encontrado',
        });
        continue;
      }
      if (currentUid === orphanUid) continue; // já está OK

      try {
        if (orphanMembers.includes(orphanUid)) {
          await wsDoc.ref.update({ members: FieldValue.arrayRemove(orphanUid) });
          await wsDoc.ref.update({ members: FieldValue.arrayUnion(currentUid) });
        }
        if (orphanAdmins.includes(orphanUid)) {
          await wsDoc.ref.update({ adminIds: FieldValue.arrayRemove(orphanUid) });
          await wsDoc.ref.update({ adminIds: FieldValue.arrayUnion(currentUid) });
        }
        wsPatched++;
        totalPatched++;
        report.push({
          workspace: data.name, orphanUid, email, currentUid, status: 'ok',
        });
      } catch (e) {
        report.push({
          workspace: data.name, orphanUid, email, status: 'error', error: e.message,
        });
      }
    }
    if (wsPatched > 0) workspacesPatched++;
  }

  // Audit
  await db.collection('audit_logs').add({
    action: 'system.repair_orphan_squad_members',
    userId: auth.uid,
    totalPatched,
    workspacesPatched,
    workspacesScanned: wsSnap.size,
    timestamp: FieldValue.serverTimestamp(),
    severity: 'warning',
  });

  return {
    ok: true,
    totalPatched,
    workspacesPatched,
    workspacesScanned: wsSnap.size,
    report,
  };
});

/* ═════════════════════════════════════════════════════════
 * sendCsatEmail — proxy server-side pra EmailJS
 *
 * MOTIVAÇÃO: antes os secrets do EmailJS (serviceId, templateId,
 * publicKey) estavam hardcoded em js/config.js no client. Como o repo
 * é público no GitHub, qualquer um podia abusar da conta EmailJS
 * (gastar quota, spam). Movido pra Secret Manager.
 *
 * SEGURANÇA:
 *   1. Auth obrigatório (onCall request.auth).
 *   2. Verifica que survey existe e o caller é quem CRIOU (createdBy).
 *   3. Rate limit: 10 envios / 5 min por user (evita spam burst).
 *   4. Secrets ficam no Secret Manager, nunca no git.
 *
 * Pra deployar (1x admin):
 *   firebase functions:secrets:set EMAILJS_SERVICE_ID  # service_xxxx
 *   firebase functions:secrets:set EMAILJS_TEMPLATE_ID # template_xxxx
 *   firebase functions:secrets:set EMAILJS_PUBLIC_KEY  # publicKey
 *   firebase deploy --only functions:sendCsatEmail
 * ═════════════════════════════════════════════════════════ */
/* ═════════════════════════════════════════════════════════
   Microsoft Graph — envio de emails (4.34.14+)
   Substitui EmailJS. Token via client_credentials, mensagens
   enviadas como sender configurado em GRAPH_SENDER_EMAIL.
   ═════════════════════════════════════════════════════════ */

let _graphTokenCache = null;

async function getGraphAccessToken() {
  // Cache simples: válido enquanto < expiresAt - 60s
  if (_graphTokenCache && Date.now() < _graphTokenCache.expiresAt - 60_000) {
    return _graphTokenCache.token;
  }
  const tenantId     = GRAPH_TENANT_ID.value();
  const clientId     = GRAPH_CLIENT_ID.value();
  const clientSecret = GRAPH_CLIENT_SECRET.value();
  if (!tenantId || !clientId || !clientSecret) {
    throw new HttpsError('failed-precondition',
      'Microsoft Graph não configurado. Admin: rodar `firebase functions:secrets:set GRAPH_*`.');
  }
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         'https://graph.microsoft.com/.default',
    grant_type:    'client_credentials',
  });
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph token fetch ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  _graphTokenCache = {
    token:     json.access_token,
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
  };
  return _graphTokenCache.token;
}

/**
 * Envia email via Microsoft Graph.
 * @param {Object} opts
 * @param {string|string[]} opts.to       — email(s) destinatário
 * @param {string} opts.subject
 * @param {string} opts.html              — corpo HTML
 * @param {string} [opts.replyTo]
 */
async function sendEmailViaGraph({ to, subject, html, replyTo }) {
  const token    = await getGraphAccessToken();
  const senderId = GRAPH_SENDER_ID.value();
  if (!senderId) throw new Error('GRAPH_SENDER_ID não configurado');

  // 4.34.14+ Usa Object ID (UUID) em vez de email no path —
  // evita erro 400 IIS quando email tem múltiplos pontos no domínio
  const recipients = Array.isArray(to) ? to : [to];
  const url = `https://graph.microsoft.com/v1.0/users/${senderId}/sendMail`;

  const message = {
    subject,
    body:          { contentType: 'HTML', content: html },
    toRecipients:  recipients.map(addr => ({ emailAddress: { address: addr } })),
  };
  if (replyTo) {
    message.replyTo = [{ emailAddress: { address: replyTo } }];
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph sendMail ${res.status}: ${text.slice(0, 300)}`);
  }
  // Graph retorna 202 sem corpo em sucesso
  return { ok: true, status: res.status };
}

/* ─── Templates HTML (4.34.14+) ──────────────────────────
 * Templates inline com paleta dourada PRIMETOUR.
 * Variantes: individual / periodic / milestone.
 */

/* 4.34.14+ Layout email — design FLAT que funciona bem em LIGHT e DARK mode.
 * Em vez de tentar forçar light (vários clients ignoram), aceitamos o modo do
 * usuário e usamos cores que ficam ok em ambos:
 *   - Sem fundos brancos sólidos (clients escurecem em dark)
 *   - Sem decoração pesada (gradiente, shadow)
 *   - Apenas linhas finas e blocos simples
 *   - Cores absolutas só em elementos críticos (CTA dourado, header navy)
 *   - Texto neutro adapta ao modo do client
 */
const PRIMETOUR_LOGO = 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/logos/lazer-alt-1777403810065.webp';

function _baseEmailLayout({ heading, intro, body, ctaUrl, ctaLabel, footerNote }) {
  const safeCtaUrl   = (ctaUrl || '').replace(/"/g, '%22');
  const safeCtaLabel = (ctaLabel || 'Avaliar agora').replace(/[<>]/g, '');
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${heading}</title>
  <!--[if mso]><style>body,table,td{font-family:'Segoe UI',Arial,sans-serif!important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;">${heading}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;border-radius:14px;overflow:hidden;border:1px solid rgba(127,127,127,0.2);">

        <!-- HEADER: navy fixo + logo branco -->
        <tr><td bgcolor="#0F172A" style="padding:32px;background-color:#0F172A;text-align:center;border-bottom:3px solid #D4A843;">
          <img src="${PRIMETOUR_LOGO}" alt="PRIMETOUR" width="200" style="display:inline-block;max-width:200px;height:auto;border:0;outline:none;text-decoration:none;">
          <div style="margin-top:14px;font-size:11px;color:#D4A843;letter-spacing:0.22em;text-transform:uppercase;font-weight:700;">Pesquisa de Satisfação</div>
        </td></tr>

        <!-- Conteúdo principal — sem bg forçado, adapta ao client -->
        <tr><td style="padding:36px 32px 28px;">
          <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;line-height:1.35;letter-spacing:-0.01em;">${heading}</h1>
          ${intro ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.65;">${intro}</p>` : ''}
          ${body || ''}
          ${ctaUrl ? `
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto 0;">
              <tr><td align="center" bgcolor="#D4A843" style="border-radius:10px;background-color:#D4A843;">
                <a href="${safeCtaUrl}" target="_blank" style="display:inline-block;padding:14px 36px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:10px;letter-spacing:0.01em;">${safeCtaLabel}</a>
              </td></tr>
            </table>
            <p style="margin:14px 0 0;font-size:11px;text-align:center;line-height:1.55;opacity:0.7;">
              Ou copie este link:<br>
              <a href="${safeCtaUrl}" style="word-break:break-all;font-size:11px;color:#D4A843;text-decoration:none;">${safeCtaUrl}</a>
            </p>
          ` : ''}
        </td></tr>

        <!-- Footer flat -->
        <tr><td style="padding:20px 32px 24px;border-top:1px solid rgba(127,127,127,0.15);">
          <p style="margin:0;font-size:12px;line-height:1.6;opacity:0.85;">
            ${footerNote || 'Email automático gerado após uma entrega concluída. Sua resposta é confidencial e nos ajuda a melhorar.'}
          </p>
          <p style="margin:10px 0 0;font-size:10px;opacity:0.6;letter-spacing:0.02em;">© PRIMETOUR Viagens &amp; Experiências · não responda diretamente</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function _buildCsatEmailHtml({ surveyId, token, taskTitle, taskIds, taskTypeLabel, customMessage, csatMode, taskList }) {
  const baseUrl = 'https://primetour.github.io/tarefas/csat-response.html';
  const ctaUrl  = `${baseUrl}?id=${encodeURIComponent(surveyId)}&token=${encodeURIComponent(token)}`;
  // 4.34.14+ Bloco "entregas neste lote" agora navy + texto branco
  // (cores fixas, alta legibilidade em light E dark mode).
  // Se taskList[] foi passado (com title de cada), lista todas; senão mostra contagem.
  const tasksHtml = Array.isArray(taskIds) && taskIds.length > 1
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0F172A" style="background-color:#0F172A;border-radius:10px;margin:0 0 24px;">
         <tr><td style="padding:18px 20px;">
           <div style="font-size:11px;color:#D4A843;margin-bottom:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;">${taskIds.length} entregas neste lote</div>
           ${Array.isArray(taskList) && taskList.length
             ? `<ul style="margin:0;padding:0 0 0 18px;color:#FFFFFF;font-size:14px;line-height:1.7;">
                  ${taskList.map(t => `<li style="margin:0 0 4px;color:#FFFFFF;">${escHtml(t.title || 'Entrega')}</li>`).join('')}
                </ul>`
             : `<div style="font-size:15px;color:#FFFFFF;font-weight:500;">${escHtml(taskTitle || '')}</div>`
           }
         </td></tr>
       </table>`
    : '';

  const heading = csatMode === 'periodic'
    ? `Como avalia este lote de entregas?`
    : csatMode === 'milestone'
      ? `Como avalia este marco?`
      : `Como avalia esta entrega?`;

  const intro = customMessage
    || (csatMode === 'periodic'
      ? `Recebemos a finalização de algumas entregas relacionadas. Sua avaliação consolidada nos ajuda a entender o atendimento como um todo.`
      : csatMode === 'milestone'
        ? `Concluímos um marco importante do seu projeto. Avalie em conjunto as entregas que fazem parte deste fechamento.`
        : `Concluímos a entrega "<strong>${escHtml(taskTitle || '')}</strong>" e gostaríamos da sua opinião.`);

  return _baseEmailLayout({
    heading,
    intro,
    body: tasksHtml,
    ctaUrl,
    ctaLabel: '⭐ Avaliar agora',
    footerNote: 'Sua avaliação leva menos de 2 minutos. Ela é registrada de forma anônima quando configurado e usada apenas para melhorar nosso serviço.',
  });
}

function escHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

export const sendCsatEmail = onCall({
  cors: ['https://primetour.github.io', 'http://localhost:5000'],
  maxInstances: 5,
  timeoutSeconds: 30,
  // 4.34.14+ Migrou EmailJS → Microsoft Graph
  secrets: [GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_SENDER_EMAIL, GRAPH_SENDER_ID],
}, async (request) => {
  const auth = requireAuth(request);

  // Rate limit: 10 envios / 5 min
  await checkRateLimit(auth.uid, 'csat_email', 10, 300);

  const { surveyId } = request.data || {};
  if (!surveyId) {
    throw new HttpsError('invalid-argument', 'surveyId obrigatório.');
  }

  // Valida que survey existe e caller é quem criou (ou admin/cron)
  const surveyDoc = await db.doc(`csat_surveys/${surveyId}`).get();
  if (!surveyDoc.exists) {
    throw new HttpsError('not-found', 'Survey não encontrada.');
  }
  const survey = surveyDoc.data();
  if (survey.createdBy !== auth.uid
      && survey.createdBy !== 'system-cron'
      && !(await isAdmin(auth.uid))) {
    throw new HttpsError('permission-denied', 'Só o criador da survey ou admin pode enviar.');
  }

  // 4.34.14+ Carrega títulos das tarefas pra mostrar lista no email
  let taskList = [];
  if (Array.isArray(survey.taskIds) && survey.taskIds.length) {
    try {
      const refs = survey.taskIds.map(id => db.doc(`tasks/${id}`));
      const docs = await db.getAll(...refs);
      taskList = docs.map(d => d.exists ? { id: d.id, title: d.data().title || 'Entrega' } : null).filter(Boolean);
    } catch (e) { console.warn('[csat] task list lookup:', e.message); }
  }

  // Monta HTML + envia via Microsoft Graph
  const html = _buildCsatEmailHtml({
    surveyId,
    token:          survey.token,
    taskTitle:      survey.taskTitle,
    taskIds:        survey.taskIds,
    taskList,
    taskTypeLabel:  survey.taskTypeName,
    customMessage:  survey.customMessage,
    csatMode:       survey.csatMode || 'individual',
  });

  const subject = survey.csatMode === 'periodic'
    ? `Avalie suas entregas — ${survey.taskTitle || 'PRIMETOUR'}`
    : survey.csatMode === 'milestone'
      ? `Avalie o marco: ${survey.taskTitle || 'PRIMETOUR'}`
      : `Como foi a entrega: ${survey.taskTitle || 'PRIMETOUR'}?`;

  try {
    await sendEmailViaGraph({
      to:      survey.clientEmail,
      subject,
      html,
    });
  } catch (e) {
    throw new HttpsError('internal', `Microsoft Graph rejeitou: ${e.message}`);
  }

  // Audit
  await db.collection('audit_logs').add({
    action:    'csat.email_sent',
    userId:    auth.uid,
    entityId:  surveyId,
    via:       'graph',
    timestamp: FieldValue.serverTimestamp(),
    severity:  'info',
  });

  return { ok: true };
});

/* ═════════════════════════════════════════════════════════
   CSAT — Cron Periódico (4.34.13+)
   Roda a cada 30min. Para cada tipo com csatConfig.mode=periodic:
     - Verifica se today=dayOfWeek E now>=timeOfDay
     - Cria lock atômico em csat_periodic_runs/{typeId}_{winId}
     - Coleta tarefas com csatPool='pending:periodic:{typeId}:{winId}'
     - Agrupa por clientEmail, cria 1 survey por cliente, dispara emails
     - Marca tarefas: csatPool='sent:periodic:...', csatSurveyId, csatSentAt
   Idempotente via Firestore lock.
   ═════════════════════════════════════════════════════════ */

// Helpers compartilhados com o client (espelhados aqui pra rodar server-side)
function csatPeriodWindowId(period, dayOfWeek = 5) {
  const now = new Date();
  if (period === 'monthly') {
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  }
  if (period === 'biweekly') {
    const half = now.getDate() <= 15 ? 'a' : 'b';
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${half}`;
  }
  // weekly: ISO week
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2,'0')}`;
}

async function fireSurveyForPool(pool, type, cfg, winId) {
  const sentPoolKey = `sent:periodic:${type.id}:${winId}`;
  const labelTpl = cfg.periodLabel || `${type.name} · ${winId}`;
  let surveysCreated = 0;
  let totalTasks = 0;

  for (const [email, tasks] of Object.entries(pool)) {
    try {
      // Cria survey doc
      const surveyRef = db.collection('csat_surveys').doc();
      const taskIds = tasks.map(x => x.id);
      const questions = (cfg.questions || []).map(q => ({
        id: q.id,
        label: q.label,
        type: q.type || 'score',
        required: q.required !== false,
      }));
      const surveyToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const surveyData = {
        taskId: tasks[0].id,
        taskIds,
        taskTypeId: type.id,
        taskTitle: `${labelTpl} (${tasks.length} entrega${tasks.length>1?'s':''})`,
        projectId: tasks[0].projectId || null,
        projectName: tasks[0].projectName || null,
        clientEmail: email,
        clientName: tasks[0].clientName || email.split('@')[0],
        assignedTo: (tasks[0].assignees||[])[0] || null,
        questions,
        responses: {},
        status: 'pending', // será marcado como 'sent' quando email for enviado
        token: surveyToken,
        score: null,
        comment: null,
        customMessage: cfg.customMessage || `Avalie as entregas desta ${cfg.period === 'weekly' ? 'semana' : cfg.period === 'biweekly' ? 'quinzena' : 'período'}.`,
        csatMode: 'periodic',
        createdBy: 'system-cron',
        createdAt: FieldValue.serverTimestamp(),
        // 4.34.14+ Survey expira em 7 dias (mesmo TTL do client manual)
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        sentAt: null,
        respondedAt: null,
      };
      await surveyRef.set(surveyData);

      // 4.34.14+ Envia email via Microsoft Graph (substituiu EmailJS)
      try {
        const html = _buildCsatEmailHtml({
          surveyId:       surveyRef.id,
          token:          surveyData.token,
          taskTitle:      surveyData.taskTitle,
          taskIds:        surveyData.taskIds,
          taskList:       tasks.map(t => ({ id: t.id, title: t.title })),
          taskTypeLabel:  type.name,
          customMessage:  cfg.customMessage,
          csatMode:       'periodic',
        });
        const subject = `Avalie suas entregas — ${surveyData.taskTitle}`;
        await sendEmailViaGraph({
          to:      email,
          subject,
          html,
        });
        // Marca survey como sent
        await surveyRef.update({ status: 'sent', sentAt: FieldValue.serverTimestamp() });
      } catch (e) {
        console.warn(`[csat-cron] sendEmailViaGraph failed for ${email}:`, e.message);
        // Mantém survey criada mas marca status='failed' pra admin reenviar manualmente
        await surveyRef.update({ status: 'failed', sendError: e.message }).catch(() => {});
      }

      // Marca tarefas
      const batch = db.batch();
      tasks.forEach(t => {
        batch.update(db.doc(`tasks/${t.id}`), {
          csatPool: sentPoolKey,
          csatSurveyId: surveyRef.id,
          csatSentAt: FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();

      surveysCreated++;
      totalTasks += tasks.length;
    } catch (e) {
      console.warn(`[csat-cron] failed for ${email} type=${type.id}:`, e.message);
    }
  }
  return { surveysCreated, totalTasks };
}

export const csatPeriodicTrigger = onSchedule({
  schedule: 'every 30 minutes',
  timeZone: 'America/Sao_Paulo',
  timeoutSeconds: 540,
  memory: '512MiB',
  // 4.34.14+ Microsoft Graph pra enviar emails dos surveys criados
  secrets: [GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_SENDER_EMAIL, GRAPH_SENDER_ID],
}, async () => {
  console.log('[csat-cron] starting tick');

  // Pega todos os tipos com csatConfig.mode=periodic
  const typesSnap = await db.collection('task_types').get();
  const periodicTypes = [];
  typesSnap.forEach(doc => {
    const data = doc.data();
    const cfg = data.csatConfig;
    if (cfg?.enabled && cfg.mode === 'periodic') {
      periodicTypes.push({ id: doc.id, ...data });
    }
  });

  if (!periodicTypes.length) {
    console.log('[csat-cron] no periodic types configured');
    return;
  }

  const now = new Date();
  // Brasília agora — onSchedule já roda em America/Sao_Paulo então now já tá no fuso certo
  const todayDow = now.getDay();
  const nowHHMM = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  let totalRuns = 0, totalSurveys = 0;

  for (const type of periodicTypes) {
    const cfg = type.csatConfig;
    // 1) Time gate
    if (cfg.dayOfWeek !== todayDow) continue;
    if (nowHHMM < (cfg.timeOfDay || '09:00')) continue;

    const winId = csatPeriodWindowId(cfg.period, cfg.dayOfWeek);
    const lockId = `${type.id}_${winId}`;
    const lockRef = db.doc(`csat_periodic_runs/${lockId}`);

    // 2) Lock atômico — primeiro a criar wins
    try {
      const existing = await lockRef.get();
      if (existing.exists) {
        // Já rodou nesta janela
        continue;
      }
      await lockRef.create({
        typeId: type.id,
        winId,
        poolKey: `pending:periodic:${type.id}:${winId}`,
        startedAt: FieldValue.serverTimestamp(),
        startedBy: { uid: 'system-cron', name: 'CSAT Cron' },
        status: 'processing',
      });
    } catch (lockErr) {
      // Race condition — outra invocação criou primeiro
      console.log(`[csat-cron] lock race won by other invocation: ${lockId}`);
      continue;
    }

    // 3) Coleta tarefas com csatPool=pending pra este tipo+janela
    const poolKey = `pending:periodic:${type.id}:${winId}`;
    const tasksSnap = await db.collection('tasks')
      .where('csatPool', '==', poolKey)
      .where('status', '==', 'done')
      .get();

    const candidates = [];
    tasksSnap.forEach(doc => {
      const data = doc.data();
      if (!data.clientEmail) return;
      candidates.push({ id: doc.id, ...data });
    });

    if (!candidates.length) {
      await lockRef.update({
        status: 'empty',
        finishedAt: FieldValue.serverTimestamp(),
        surveysCreated: 0,
      });
      continue;
    }

    // 4) Agrupa por clientEmail
    const byClient = {};
    candidates.forEach(task => {
      const email = String(task.clientEmail).toLowerCase();
      if (!byClient[email]) byClient[email] = [];
      byClient[email].push(task);
    });

    // 5) Cria surveys + atualiza tasks
    const result = await fireSurveyForPool(byClient, type, cfg, winId);

    // 6) Finaliza lock
    await lockRef.update({
      status: 'done',
      finishedAt: FieldValue.serverTimestamp(),
      surveysCreated: result.surveysCreated,
      tasksCount: result.totalTasks,
      clientsCount: Object.keys(byClient).length,
    });

    // Audit log
    await db.collection('audit_logs').add({
      action: 'csat.periodic_dispatched',
      userId: 'system-cron',
      entityId: lockId,
      typeId: type.id,
      typeName: type.name,
      winId,
      surveysCreated: result.surveysCreated,
      tasksCount: result.totalTasks,
      timestamp: FieldValue.serverTimestamp(),
      severity: 'info',
    });

    totalRuns++;
    totalSurveys += result.surveysCreated;
  }

  console.log(`[csat-cron] tick done · ${totalRuns} bolsões processados · ${totalSurveys} surveys criadas`);
});

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
 * pruneOldAuditLogs — apaga audit_logs com mais de 90 dias.
 *
 * MOTIVAÇÃO: cada ação no sistema cria 1 doc em audit_logs (login,
 * edit task, etc). Sem TTL, a coleção cresce indefinidamente — em 1
 * ano com 50 users ativos = ~500k docs. Storage cresce, queries lentas,
 * custo em $$ no plano Blaze.
 *
 * RETENÇÃO: 90 dias. Cobre auditoria operacional típica (debug, compli-
 * ance leve). Pra retenção mais longa de eventos críticos (LGPD,
 * deleção de user), considerar export pra Cloud Storage antes de apagar
 * — não implementado nesta v1, vide docs/PERFORMANCE.md.
 *
 * EXCEÇÕES (NÃO apaga, mesmo > 90 dias):
 *   - severity: 'critical' (pentest, segurança, LGPD)
 *   - action começa com 'lgpd.' (compliance)
 *   - action começa com 'security.' (incidentes)
 *
 * BATCH: Firestore deletes em batches de 500 (limite de transação).
 * Idempotente: se rodar 2x no mesmo dia, na segunda não tem o que apagar.
 * Roda 03:30 BRT (06:30 UTC) — 30 min depois do dailyBackup pra não competir.
 * ═════════════════════════════════════════════════════════ */
export const pruneOldAuditLogs = onSchedule({
  schedule: '30 6 * * *',
  timeZone: 'America/Sao_Paulo',
  timeoutSeconds: 540,
  memory: '256MiB',
}, async () => {
  const RETENTION_DAYS = 90;
  const BATCH_SIZE = 500;
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  let totalDeleted = 0;
  let batchCount = 0;
  let preserved = 0; // logs críticos/lgpd/security mantidos

  while (true) {
    // Busca os logs MAIS ANTIGOS que cutoff (limit BATCH_SIZE)
    const snap = await db.collection('audit_logs')
      .where('timestamp', '<', cutoff)
      .orderBy('timestamp', 'asc')
      .limit(BATCH_SIZE)
      .get();

    if (snap.empty) break; // tudo limpo

    const batch = db.batch();
    let deletedInBatch = 0;
    snap.docs.forEach(doc => {
      const data = doc.data();
      const action = data.action || '';
      const severity = data.severity || '';
      // Skip preservation rules:
      // - severity 'critical' (sempre preserva)
      // - lgpd.* (compliance LGPD obrigatório)
      // - security.* (auditoria de segurança)
      // - tasks.urgency_* (override manual de urgência por SLA — accountability
      //   de gestor que removeu a marcação automática; preservar pra disputas)
      if (severity === 'critical'
          || action.startsWith('lgpd.')
          || action.startsWith('security.')
          || action.startsWith('tasks.urgency_')) {
        preserved++;
        return;
      }
      batch.delete(doc.ref);
      deletedInBatch++;
    });

    if (deletedInBatch > 0) {
      await batch.commit();
      totalDeleted += deletedInBatch;
    }
    batchCount++;

    // Se este batch tinha só preservados, próximo loop pegaria os mesmos
    // → break pra evitar loop infinito
    if (deletedInBatch === 0) break;
    // Safety: max 50 batches/run = 25k logs apagados/dia (mais que suficiente)
    if (batchCount >= 50) break;
  }

  // Audit log da operação (irônico mas útil pra ver histórico de prunes)
  await db.collection('audit_logs').add({
    action: 'system.audit_logs_pruned',
    userId: 'system',
    totalDeleted,
    preserved,
    cutoffDate: cutoff.toISOString(),
    retentionDays: RETENTION_DAYS,
    batchesProcessed: batchCount,
    timestamp: FieldValue.serverTimestamp(),
    severity: 'info',
  });

  console.log(`[pruneOldAuditLogs] deleted=${totalDeleted} preserved=${preserved} batches=${batchCount}`);
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
    aiCacheHits: 0,
    aiTokensSaved: 0,
    aiSavingsUsd: 0,
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

  // 2. Custo IA ultimas 24h (ai_usage_logs) + Prompt Caching savings
  try {
    const usageSnap = await db.collection('ai_usage_logs')
      .where('timestamp', '>=', since)
      .limit(10000).get();

    const byUser = {};
    let totalCacheHits = 0;
    let totalTokensSaved = 0;
    usageSnap.forEach(d => {
      const x = d.data();
      const uid = x.userId || 'anon';
      const cost = Number(x.totalCostUsd || x.costUsd || 0);
      stats.aiCostTotal += cost;
      byUser[uid] = (byUser[uid] || 0) + cost;
      if (x.cacheHit) totalCacheHits++;
      totalTokensSaved += Number(x.tokensSaved || 0);
    });
    stats.aiCacheHits = totalCacheHits;
    stats.aiTokensSaved = totalTokensSaved;
    // Estimativa USD economizado: $3/1M tokens medio (Sonnet/4o)
    stats.aiSavingsUsd = +(totalTokensSaved / 1_000_000 * 3).toFixed(4);

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
      aiCacheHits: stats.aiCacheHits,
      aiTokensSaved: stats.aiTokensSaved,
      aiSavingsUsd: stats.aiSavingsUsd,
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
      `> 💾 Prompt Caching: ${stats.aiCacheHits} hits · ${stats.aiTokensSaved.toLocaleString('pt-BR')} tokens economizados (~$${stats.aiSavingsUsd.toFixed(4)})`,
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

/* ═════════════════════════════════════════════════════════
 * fetchDestinationPhoto — Unsplash com fallback Wikipedia
 *
 * Busca foto representativa de um destino pelo nome.
 * Cacheia URL no doc do destination pra nao refetchar.
 *
 * Provider order:
 *   1. Unsplash (se UNSPLASH_ACCESS_KEY configurado) — fotos curadas
 *   2. Wikipedia REST API — sempre disponivel, sem key
 *
 * Returns: { url, source, attribution }
 * ═════════════════════════════════════════════════════════ */
export const fetchDestinationPhoto = onCall({
  cors: ['https://primetour.github.io', 'http://localhost:5000'],
  secrets: [UNSPLASH_ACCESS_KEY],
  maxInstances: 20,
  timeoutSeconds: 30,
}, async (request) => {
  const auth = requireAuth(request);
  const { destinationId, query, force, count = 1 } = request.data || {};
  if (!query || typeof query !== 'string') {
    throw new HttpsError('invalid-argument', 'query (nome do destino) obrigatorio.');
  }
  // Limit count: 1-10 (Unsplash retorna ate 30/page mas 5-10 cobre o uso real)
  const wantCount = Math.min(Math.max(parseInt(count) || 1, 1), 10);

  // ─── Cache 1: por destinationId (cache "rico" do destino) ───
  // So usado quando count=1 (cache do destino retorna foto unica)
  if (wantCount === 1 && destinationId && !force) {
    const ref = db.doc(`destinations/${destinationId}`);
    const snap = await ref.get();
    if (snap.exists) {
      const d = snap.data();
      if (d.defaultPhotoUrl && d.defaultPhotoSource) {
        return {
          url: d.defaultPhotoUrl,
          source: d.defaultPhotoSource,
          attribution: d.defaultPhotoAttribution || '',
          cached: true,
        };
      }
    }
  }

  // ─── Cache 2: por hash da query (compartilhado entre todas geracoes) ───
  const queryKey = normalizeQuery(query);
  if (!force) {
    const cacheRef = db.doc(`photo_cache/${queryKey}`);
    const cacheSnap = await cacheRef.get();
    if (cacheSnap.exists) {
      const c = cacheSnap.data();
      const ageMs = Date.now() - (c.fetchedAt?.toMillis?.() || 0);
      const TTL_MS = 90 * 24 * 60 * 60 * 1000;
      if (ageMs < TTL_MS) {
        // Backward compat: cache antigo so tem .url; novo tem .urls[]
        const cachedUrls = Array.isArray(c.urls) ? c.urls : (c.url ? [c.url] : []);
        if (cachedUrls.length > 0 && (wantCount === 1 || cachedUrls.length >= wantCount)) {
          if (wantCount > 1) {
            return {
              urls: cachedUrls.slice(0, wantCount),
              sources: c.sources || cachedUrls.map(() => c.source),
              attributions: c.attributions || cachedUrls.map(() => c.attribution || ''),
              cached: true,
            };
          }
          const result = {
            url: cachedUrls[0], source: c.source, attribution: c.attribution || '',
            attributionUrl: c.attributionUrl || '', cached: true,
          };
          if (destinationId) await saveDestinationPhoto(destinationId, result);
          return result;
        }
      }
    }
  }

  await checkRateLimit(auth.uid, 'fetchPhoto', 60, 60);

  // ─── Cooldown global: se Unsplash deu rate-limit recente, pula direto pra Wikipedia ───
  let skipUnsplash = false;
  try {
    const cdRef = db.doc('system_state/unsplash_cooldown');
    const cdSnap = await cdRef.get();
    if (cdSnap.exists) {
      const cd = cdSnap.data();
      const ageMs = Date.now() - (cd.hitAt?.toMillis?.() || 0);
      if (ageMs < 60 * 60 * 1000) skipUnsplash = true;  // cooldown 60min
    }
  } catch {}

  // 1. Try Unsplash if key configured + nao em cooldown
  const unsplashKey = UNSPLASH_ACCESS_KEY.value();
  if (!skipUnsplash && unsplashKey && unsplashKey.length > 10 && !unsplashKey.includes('not-configured')) {
    try {
      // per_page sempre busca 5 (cobre cycling) mesmo se o cliente pediu 1.
      // Custa o mesmo de 1 e enche o cache pra reuso futuro.
      const perPage = Math.max(wantCount, 5);
      const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape&content_filter=high`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Client-ID ${unsplashKey}`, 'Accept-Version': 'v1' },
      });
      const remainingHeader = res.headers.get('X-Ratelimit-Remaining');
      const remaining = remainingHeader ? parseInt(remainingHeader, 10) : -1;
      // Só ativa cooldown em RATE LIMIT real, não em 403 por outras causas (key inválida).
      // Detecção: presença do header X-Ratelimit-* + (remaining<=5 OU response body inclui "rate limit").
      const isRateLimit = remaining >= 0 && (remaining <= 5 || (res.status === 403 && remaining === 0));
      if (isRateLimit) {
        await db.doc('system_state/unsplash_cooldown').set({
          hitAt: FieldValue.serverTimestamp(),
          lastQuery: query.slice(0, 80),
          remaining,
        });
        console.warn('[fetchPhoto] Unsplash rate limit (status='+res.status+', remaining='+remaining+'). Cooldown 60min ativado.');
        await db.collection('audit_logs').add({
          action: 'security.unsplash_rate_limit_hit',
          severity: 'warning',
          query: query.slice(0, 80),
          remaining,
          timestamp: FieldValue.serverTimestamp(),
        });
      } else if (res.status === 403 || res.status === 401) {
        // 403/401 SEM header rate limit = key inválida/revogada — NÃO ativar cooldown.
        // Só loga e cai pra Wikipedia.
        console.warn('[fetchPhoto] Unsplash auth failed (status='+res.status+') — chave inválida? Falling back to Wikipedia.');
      } else if (res.ok) {
        const data = await res.json();
        const photos = data.results || [];
        if (photos.length > 0) {
          const urls = photos.map(p => p.urls.regular);
          const sources = photos.map(() => 'unsplash');
          const attributions = photos.map(p => `Foto por ${p.user.name} (Unsplash)`);
          const attributionUrls = photos.map(p => p.user.links.html + '?utm_source=primetour&utm_medium=referral');

          // Cache global multi-foto
          await saveCacheMulti(queryKey, urls, sources, attributions, attributionUrls);

          if (wantCount > 1) {
            return { urls: urls.slice(0, wantCount), sources, attributions, cached: false };
          }
          // Single result (compat)
          const result = {
            url: urls[0], source: 'unsplash',
            attribution: attributions[0], attributionUrl: attributionUrls[0],
          };
          if (destinationId) await saveDestinationPhoto(destinationId, result);
          return result;
        }
      }
    } catch (e) {
      console.warn('[fetchPhoto] Unsplash error:', e?.message);
    }
  }

  // 2. Fallback: Wikipedia REST API (single foto disponivel)
  try {
    for (const lang of ['pt', 'en']) {
      const wikiUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
      const res = await fetch(wikiUrl);
      if (!res.ok) continue;
      const data = await res.json();
      const thumb = data.thumbnail?.source || data.originalimage?.source;
      if (thumb) {
        const photo = data.originalimage?.source || thumb;
        const result = {
          url: photo,
          source: 'wikipedia',
          attribution: `Foto via Wikipedia (${lang}) — ${data.title}`,
          attributionUrl: data.content_urls?.desktop?.page || '',
        };
        await saveCacheAndDestination(queryKey, destinationId, result);
        // Se cliente pediu count>1, retorna array (so 1 foto Wikipedia disponivel)
        if (wantCount > 1) {
          return {
            urls:         [result.url],
            sources:      ['wikipedia'],
            attributions: [result.attribution],
            cached:       false,
          };
        }
        return result;
      }
    }
  } catch (e) {
    console.warn('[fetchPhoto] Wikipedia error:', e?.message);
  }

  throw new HttpsError('not-found', 'Nenhuma foto encontrada para "' + query + '".');
});

/** Normaliza query pra cache key (remove acentos, lowercase, hash curto) */
function normalizeQuery(q) {
  // BUG FIX: usar escape unicode em vez de caracteres combining literais
  // (range ̀-ͯ = Combining Diacritical Marks)
  const norm = String(q || '').toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return norm || 'empty';
}

/** Salva no cache global + opcionalmente no destination (compat 1 foto) */
async function saveCacheAndDestination(queryKey, destinationId, result) {
  await saveCacheMulti(queryKey, [result.url], [result.source], [result.attribution || ''], [result.attributionUrl || '']);
  if (destinationId) await saveDestinationPhoto(destinationId, result);
}

/** Salva múltiplas fotos no cache global (top N do Unsplash) */
async function saveCacheMulti(queryKey, urls, sources, attributions, attributionUrls) {
  if (!urls?.length) return;
  try {
    await db.doc(`photo_cache/${queryKey}`).set({
      url:              urls[0],                       // backward compat (campo legacy)
      source:           sources[0],                    // idem
      attribution:      attributions[0] || '',         // idem
      attributionUrl:   attributionUrls[0] || '',      // idem
      urls,                                            // novo: array completo
      sources,
      attributions,
      attributionUrls,
      count:            urls.length,
      fetchedAt:        FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('[fetchPhoto] cache multi save failed:', e?.message);
  }
}

async function saveDestinationPhoto(destinationId, result) {
  if (!destinationId) return;
  try {
    await db.doc(`destinations/${destinationId}`).set({
      defaultPhotoUrl:         result.url,
      defaultPhotoSource:      result.source,
      defaultPhotoAttribution: result.attribution,
      defaultPhotoAttributionUrl: result.attributionUrl || '',
      defaultPhotoFetchedAt:   FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    console.warn('[fetchPhoto] cache save failed:', e?.message);
  }
}

/* ═════════════════════════════════════════════════════════
 * previewLink — HTTP function pra OG meta dinamica
 *
 * URL: https://us-central1-PROJECT.cloudfunctions.net/previewLink?t=TOKEN
 *
 * Quando usuario compartilha esta URL:
 *   - Crawler (Slackbot, WhatsApp, FB, etc.) vê HTML com og:image, og:title
 *     (foto do destino + nome do cliente/destino)
 *   - User real recebe redirect via JS pra portal-view.html#token
 *
 * Lê portal_web_links/{token} e renderiza HTML mínimo.
 * ═════════════════════════════════════════════════════════ */
export const previewLink = onRequest({
  cors: true,
  maxInstances: 50,
  timeoutSeconds: 15,
  memory: '256MiB',
}, async (req, res) => {
  const token = req.query.t;
  if (!token || typeof token !== 'string' || token.length > 100) {
    res.status(400).send('Token invalido.');
    return;
  }
  // Sanitize: tokens slug-like apenas
  if (!/^[a-z0-9-]+$/i.test(token)) {
    res.status(400).send('Token invalido.');
    return;
  }

  let linkData;
  try {
    const snap = await db.doc(`portal_web_links/${token}`).get();
    if (!snap.exists) {
      res.status(404).send('Link nao encontrado.');
      return;
    }
    linkData = snap.data();
  } catch (e) {
    res.status(500).send('Erro ao carregar link.');
    return;
  }

  // Resolve OG image: 1) hero do primeiro destino, 2) defaultPhotoUrl,
  // 3) logo da area, 4) logo PRIMETOUR fallback
  const firstDestId = linkData.allTips?.[0]?.destId;
  const firstHero = firstDestId && linkData.imagesByDest?.[firstDestId]?.hero;
  const fallbackPhoto = await getFirstDestPhoto(firstDestId);
  const ogImage = firstHero
    || fallbackPhoto
    || linkData.areaLogoUrl
    || 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/logos/lazer-1777390896671.webp';

  const firstDest = linkData.tipData?.[0]?.dest || {};
  const destName = firstDest.city || firstDest.country || linkData.areaName || 'Dicas de Viagem';
  const clientName = linkData.allTips?.length ? '' : '';   // (token slug ja contem clientName)
  const ogTitle = `${destName} · ${linkData.areaName || 'PRIMETOUR'}`;
  const ogDesc = `Material de viagem personalizado preparado pela ${linkData.areaName || 'PRIMETOUR'}.`;

  // Final URL pra redirect
  const finalUrl = `https://primetour.github.io/tarefas/portal-view.html#${token}`;

  // HTML com og: meta + redirect
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(ogTitle)}</title>
<meta name="description" content="${escapeHtml(ogDesc)}">

<!-- Open Graph (Facebook, WhatsApp, LinkedIn, Slack, Telegram) -->
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtml(finalUrl)}">
<meta property="og:title" content="${escapeHtml(ogTitle)}">
<meta property="og:description" content="${escapeHtml(ogDesc)}">
<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="Gestor PRIMETOUR — Portal de Dicas">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(ogTitle)}">
<meta name="twitter:description" content="${escapeHtml(ogDesc)}">
<meta name="twitter:image" content="${escapeHtml(ogImage)}">

<!-- Redirect (browsers reais) -->
<meta http-equiv="refresh" content="0; url=${escapeHtml(finalUrl)}">
<link rel="canonical" href="${escapeHtml(finalUrl)}">
<style>body{font-family:system-ui;text-align:center;padding:60px 20px;background:#0A1628;color:#E2E8F0;}
a{color:#D4A843;}</style>
</head>
<body>
<p>Carregando material de viagem...</p>
<p>Se nao redirecionar automaticamente, <a href="${escapeHtml(finalUrl)}">clique aqui</a>.</p>
<script>window.location.replace(${JSON.stringify(finalUrl)});</script>
</body>
</html>`;

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600');
  res.status(200).send(html);
});

async function getFirstDestPhoto(destId) {
  if (!destId) return null;
  try {
    const snap = await db.doc(`destinations/${destId}`).get();
    return snap.exists ? snap.data().defaultPhotoUrl : null;
  } catch { return null; }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}


/* ─────────────────────────────────────────────────────────────
   4.35.3+ System Feedback — Firestore trigger envia email pra admin
   ─────────────────────────────────────────────────────────────
   Quando user cria doc em system_feedback/{id}, dispara email via
   Microsoft Graph pro destinatário FEEDBACK_ADMIN_EMAIL com:
   - tipo (bug/sugestão/dúvida/elogio)
   - mensagem
   - autor (nome + email + role)
   - página + versão (debug)
   ───────────────────────────────────────────────────────────── */

const FEEDBACK_TYPE_LABELS = {
  bug:        { emoji: '🐛', label: 'Bug',       color: '#EF4444' },
  suggestion: { emoji: '💡', label: 'Sugestão',  color: '#D4A843' },
  question:   { emoji: '❓', label: 'Dúvida',    color: '#38BDF8' },
  praise:     { emoji: '🌟', label: 'Elogio',    color: '#22C55E' },
};

const FEEDBACK_ADMIN_EMAIL = 'rene.castro@primetour.com.br';

function _escFb(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function _buildSystemFeedbackEmailHtml(fb) {
  const t = FEEDBACK_TYPE_LABELS[fb.type] || { emoji: '💬', label: 'Feedback', color: '#888' };
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:24px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;border-radius:12px;overflow:hidden;border:1px solid rgba(127,127,127,0.2);">

<tr><td bgcolor="#0F172A" style="padding:24px 28px;background-color:#0F172A;border-bottom:3px solid ${t.color};">
  <div style="font-size:11px;color:${t.color};letter-spacing:0.18em;text-transform:uppercase;font-weight:700;">${t.emoji} ${t.label} — Sistema</div>
  <div style="margin-top:6px;color:#FFFFFF;font-size:18px;font-weight:600;line-height:1.3;">Feedback do Sistema PRIMETOUR</div>
</td></tr>

<tr><td style="padding:24px 28px;">
  <div style="background:#F8F9FA;border-left:3px solid ${t.color};padding:14px 16px;border-radius:6px;margin-bottom:18px;white-space:pre-wrap;font-size:14px;line-height:1.6;color:#1F2937;">${_escFb(fb.message || '')}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;line-height:1.7;color:#475569;">
    <tr><td style="padding:3px 0;width:120px;color:#94A3B8;">De:</td><td style="padding:3px 0;color:#1F2937;font-weight:600;">${_escFb(fb.authorName || 'Usuário')}</td></tr>
    <tr><td style="padding:3px 0;color:#94A3B8;">E-mail:</td><td style="padding:3px 0;"><a href="mailto:${_escFb(fb.authorEmail||'')}" style="color:#D4A843;text-decoration:none;">${_escFb(fb.authorEmail || '—')}</a></td></tr>
    <tr><td style="padding:3px 0;color:#94A3B8;">Função:</td><td style="padding:3px 0;">${_escFb(fb.authorRole || 'member')}</td></tr>
    <tr><td style="padding:3px 0;color:#94A3B8;">Página:</td><td style="padding:3px 0;font-family:ui-monospace,Menlo,monospace;font-size:12px;">${_escFb(fb.page || '#')}</td></tr>
    <tr><td style="padding:3px 0;color:#94A3B8;">Versão app:</td><td style="padding:3px 0;font-family:ui-monospace,Menlo,monospace;font-size:12px;">${_escFb(fb.appVersion || '?')}</td></tr>
  </table>

  <div style="margin-top:18px;padding-top:14px;border-top:1px solid #E2E8F0;text-align:center;">
    <a href="https://primetour.github.io/tarefas/#system-feedback" style="display:inline-block;padding:10px 24px;background:#D4A843;color:#FFFFFF;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">Ver no sistema</a>
  </div>
</td></tr>

<tr><td style="padding:14px 28px;border-top:1px solid #E2E8F0;font-size:11px;color:#94A3B8;line-height:1.5;">
  Email automático disparado quando um usuário envia feedback pela página de Governança ou pelo botão "Enviar Sugestão". Para responder, vá em <strong>/system-feedback</strong> no sistema.
</td></tr>

</table></td></tr></table></body></html>`;
}

export const onSystemFeedbackCreate = onDocumentCreated({
  document: 'system_feedback/{feedbackId}',
  region:   'us-central1',
  secrets:  [GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_SENDER_ID],
}, async (event) => {
  const fb = event.data?.data();
  if (!fb) return;

  const t = FEEDBACK_TYPE_LABELS[fb.type] || { emoji: '💬', label: 'Feedback' };
  const subject = `${t.emoji} ${t.label} no Sistema PRIMETOUR — ${fb.authorName || 'Usuário'}`;
  const html = _buildSystemFeedbackEmailHtml(fb);

  try {
    await sendEmailViaGraph({
      to:      FEEDBACK_ADMIN_EMAIL,
      subject,
      html,
      replyTo: fb.authorEmail || undefined,
    });
    console.log(`[system_feedback] email enviado para ${FEEDBACK_ADMIN_EMAIL} (${fb.type})`);
  } catch (e) {
    console.error('[system_feedback] falha ao enviar email:', e?.message || e);
    // Não relança — o doc já foi salvo, admin vê pela UI mesmo sem email
  }
});
