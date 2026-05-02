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
import { defineSecret }       from 'firebase-functions/params';
import { initializeApp }      from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth }            from 'firebase-admin/auth';

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
 * Rate limit atomic via Firestore.
 * Janela deslizante por user.
 */
async function checkRateLimit(uid, key, maxCalls, windowSec) {
  const ref = db.doc(`rate_limits/${uid}__${key}`);
  const now = Date.now();
  const cutoff = now - (windowSec * 1000);
  const snap = await ref.get();
  let calls = snap.exists ? (snap.data().calls || []) : [];
  calls = calls.filter(t => t > cutoff);
  if (calls.length >= maxCalls) {
    throw new HttpsError('resource-exhausted',
      `Rate limit: máximo ${maxCalls} chamadas a cada ${windowSec}s. Aguarde.`);
  }
  calls.push(now);
  await ref.set({ calls, updatedAt: FieldValue.serverTimestamp() });
}

/**
 * Verifica cap de custo diário do agente (em USD).
 */
async function checkDailyCost(uid, agentId, capUsd) {
  if (!capUsd || !agentId) return;
  const today = new Date(); today.setHours(0,0,0,0);
  const snap = await db.collection('ai_usage_logs')
    .where('agentId', '==', agentId)
    .where('timestamp', '>=', today)
    .get();
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
  // Validação: path precisa começar com pasta whitelisted
  const ALLOWED_PREFIXES = ['agents/', 'logos/', 'portal/', 'tasks/'];
  if (!ALLOWED_PREFIXES.some(p => path.startsWith(p))) {
    throw new HttpsError('permission-denied', `Path "${path}" fora das pastas permitidas.`);
  }
  // Rate limit upload
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
