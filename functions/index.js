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
import { onDocumentCreated, onDocumentUpdated }  from 'firebase-functions/v2/firestore';
import { defineSecret }       from 'firebase-functions/params';
import { initializeApp }      from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth }            from 'firebase-admin/auth';
import { GoogleAuth }         from 'google-auth-library';
import { renderEmailTemplate, buildNotificationEmail } from './emailTemplate.js';

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

// v4.63.13+ Security #2/#5 (audit pós-sprint v4.63): allowlist de origins
// pra fileUrl/SSRF defense. R2 bucket público é a única origem aceita.
// Validar ANTES de fetch em extractPlaceholders/renderTemplate/duplicateTemplate.
const R2_PUBLIC_ORIGIN = 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/';
function _validateR2FileUrl(url) {
  if (typeof url !== 'string') return false;
  if (!url.startsWith(R2_PUBLIC_ORIGIN)) return false;
  // Bloquear path traversal (../) e query string suspeita
  if (url.includes('..') || url.includes('@')) return false;
  return true;
}

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
 * hasPermissionUid — checa permissão granular server-side, espelhando o
 * gate da UI. Shape (CLAUDE.md §13.f): users.{uid}.permissionOverrides é
 * objeto {perm:bool}; roles.{roleId}.permissions é objeto {perm:bool}.
 * Master/admin sempre passam.
 */
async function hasPermissionUid(uid, perm) {
  if (!uid) return false;
  const uSnap = await db.doc(`users/${uid}`).get();
  if (!uSnap.exists) return false;
  const u = uSnap.data();
  if (u.isMaster === true || u.role === 'master' || u.roleId === 'master'
      || u.role === 'admin' || u.roleId === 'admin') return true;
  const overrides = u.permissionOverrides || u.permissionOverride || {};
  if (overrides && overrides[perm] === true) return true;
  const roleId = u.roleId || u.role;
  if (roleId) {
    const rSnap = await db.doc(`roles/${roleId}`).get();
    if (rSnap.exists) {
      const rd = rSnap.data();
      const perms = rd.permissions || {};
      // SECURITY (audit 4.63.95): NÃO conceder por rd.isSystem — TODAS as roles
      // (inclusive member/partner) têm isSystem===true. Antes era bypass total:
      // qualquer member passava QUALQUER permissão. master/admin já passam acima.
      if (perms[perm] === true) return true;
    }
  }
  return false;
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
  const auth = requireAuth(request);
  // SECURITY (audit 4.63.95): antes era requireAuth-only — QUALQUER member
  // logado conseguia o status (e o comprimento exato) das chaves de API.
  // Agora exige ai_keys_manage (mesmo gate da aba API Keys em aiHub.js).
  if (!(await hasPermissionUid(auth.uid, 'ai_keys_manage'))) {
    throw new HttpsError('permission-denied',
      'Apenas admin/master ou quem tem ai_keys_manage.');
  }
  const isConfigured = (v) =>
    typeof v === 'string' && v.length > 8 && v !== 'not-configured-yet';
  // SECURITY: não retornar mais o comprimento exato das chaves (shape leak).
  // Boolean "configurado" basta pra UI. Faixa grosseira (curta/ok) pra debug.
  const sizeHint = (v) => {
    const n = (typeof v === 'string' ? v : '').length;
    if (n === 0) return 'empty';
    if (n < 16) return 'short';
    return 'ok';
  };
  return {
    anthropic: isConfigured(ANTHROPIC_API_KEY.value()),
    openai:    isConfigured(OPENAI_API_KEY.value()),
    gemini:    isConfigured(GEMINI_API_KEY.value()),
    groq:      isConfigured(GROQ_API_KEY.value()),
    sizes: {
      anthropic: sizeHint(ANTHROPIC_API_KEY.value()),
      openai:    sizeHint(OPENAI_API_KEY.value()),
      gemini:    sizeHint(GEMINI_API_KEY.value()),
      groq:      sizeHint(GROQ_API_KEY.value()),
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
  // v4.49.80+ 120 → 300s. Agente de roteiros (Sonnet 4.5 + web_search
  // forçado, 5 buscas máx) excedia o timeout antigo. Firebase 2nd gen
  // onCall permite até 540s; deixei 300s pra equilibrar custo/risco.
  timeoutSeconds: 300,
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
    // v4.49.74+ web search restrito por dominio (Virtuoso, FHR, LHW, etc.)
    allowedDomains = null,
    // v4.49.74+ override do max_uses (default 3, agente luxo precisa mais)
    webSearchMaxUses = 3,
  } = data;

  if (!userMessage || typeof userMessage !== 'string') {
    throw new HttpsError('invalid-argument', 'userMessage obrigatório.');
  }

  // ── 4.63.95 (security audit): clamps server-side de custo/recurso ──
  // O cliente envia agentDailyCapUsd e maxTokens. Sem teto, um usuário de
  // baixo privilégio (member) chamando via SDK do console poderia passar
  // agentDailyCapUsd=999999 (anula o cap diário) ou maxTokens gigante
  // (abuso de custo). Aplicamos tetos server-side — o cliente nunca eleva.
  const safeDailyCapUsd = Math.min(Math.max(Number(agentDailyCapUsd) || 5, 0.5), 50);
  const safeMaxTokens   = Math.min(Math.max(parseInt(maxTokens) || 2048, 64), 32768);

  // ── Rate limit por IP (200 req / 60s) — defesa DDoS antes mesmo de auth ──
  await checkRateLimitIP(request, 'callLLM', 200, 60);
  // ── Rate limit por user (60 req / 60s) ──
  await checkRateLimit(uid, 'callLLM', 60, 60);
  // ── Cap de custo por agente (usa o teto server-side, não o valor cru do cliente) ──
  if (agentId) await checkDailyCost(uid, agentId, safeDailyCapUsd);

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
    if (provider === 'anthropic') result = await callAnthropic(apiKey, { model, systemPrompt, userMessage, history, maxTokens: safeMaxTokens, temperature, attachments, webSearch, allowedDomains, webSearchMaxUses });
    else if (provider === 'openai') result = await callOpenAI(apiKey, { model, systemPrompt, userMessage, history, maxTokens: safeMaxTokens, temperature });
    else if (provider === 'gemini') result = await callGemini(apiKey, { model, systemPrompt, userMessage, history, maxTokens: safeMaxTokens, temperature });
    else if (provider === 'groq')   result = await callGroq(apiKey, { model, systemPrompt, userMessage, history, maxTokens: safeMaxTokens, temperature });
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
async function callAnthropic(apiKey, { model, systemPrompt, userMessage, history, maxTokens, temperature, attachments, webSearch, allowedDomains = null, webSearchMaxUses = 3 }) {
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
  // v4.49.74+ allowed_domains restringe a domínios específicos (curadoria do
  // agente, p.ex.: virtuoso.com / americanexpress.com / lhw.com pro agente
  // de roteiros de luxo). max_uses configurável (default 3, luxo precisa 5+).
  const tools = webSearch
    ? [(() => {
        const t = { type: 'web_search_20250305', name: 'web_search', max_uses: Math.max(1, Math.min(10, webSearchMaxUses)) };
        if (Array.isArray(allowedDomains) && allowedDomains.length > 0) {
          t.allowed_domains = allowedDomains
            .map(d => String(d || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
            .filter(Boolean);
        }
        return t;
      })()]
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

  // v4.49.74+ Extrai citações de web_search pra retornar as fontes consultadas
  // ao client (gerador de roteiros precisa pra registrar em "observações").
  //
  // Estrutura conforme docs Anthropic:
  //   server_tool_use      : a query que foi feita
  //   web_search_tool_result: { content: [{ type:'web_search_result', url, title, page_age, encrypted_content }] }
  //   text                 : pode conter citations[] com {url, title, cited_text}
  const searchQueries = webSearches.map(b => b?.input?.query || '').filter(Boolean);
  const searchResults = (d.content || [])
    .filter(b => b.type === 'web_search_tool_result')
    .flatMap(b => Array.isArray(b.content) ? b.content : [])
    .filter(r => r?.type === 'web_search_result')
    .map(r => ({ url: r.url, title: r.title || '', pageAge: r.page_age || '' }));
  // Citações inline em blocos de texto (links que o modelo de fato citou)
  const citations = (d.content || [])
    .filter(b => b.type === 'text' && Array.isArray(b.citations))
    .flatMap(b => b.citations)
    .filter(c => c && c.url)
    .map(c => ({ url: c.url, title: c.title || '', citedText: c.cited_text || '' }));

  return {
    text: textBlocks.join('\n'),
    model: d.model,
    inputTokens:           d.usage?.input_tokens || 0,
    outputTokens:          d.usage?.output_tokens || 0,
    cacheCreationTokens:   d.usage?.cache_creation_input_tokens || 0,
    cacheReadTokens:       d.usage?.cache_read_input_tokens || 0,
    webSearchCount:        webSearches.length,
    webSearchQueries:      searchQueries,
    webSearchResults:      searchResults,
    citations,
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

  // Validação: path precisa começar com pasta whitelisted.
  // 4.35.32+ Adicionado hoteis/ cruzeiros/ trens/ (novas categorias de asset
  // no Banco de Imagens — antes só location-based fotos iam pra continent/...).
  // Casos sem prefixo (location) também são aceitos via fallback abaixo.
  const ALLOWED_PREFIXES = [
    'agents/', 'logos/', 'portal/', 'tasks/',
    'hoteis/', 'cruzeiros/', 'trens/',   // 4.35.32+ novas categorias do banco
    'templates/',                          // v4.63.1+ Biblioteca de Templates upload
  ];
  // Continentes (location-based) começam com letra minúscula sem prefixo fixo:
  // brasil/sao-paulo/sao-paulo/...  →  permitido se NÃO bater em nenhum prefixo
  // proibido (qualquer um começando com /,  .. ou //). Já validado acima.
  const matchedPrefix = ALLOWED_PREFIXES.some(p => path.startsWith(p));
  // Location: aceita se primeiro segmento é um continente conhecido
  const KNOWN_CONTINENTS = ['brasil','africa','america-central','caribe','america-do-norte',
    'america-do-sul','asia','europa','oriente-medio','oceania','antartica'];
  const firstSeg = path.split('/')[0].toLowerCase();
  const isLocationPath = KNOWN_CONTINENTS.includes(firstSeg);
  if (!matchedPrefix && !isLocationPath) {
    throw new HttpsError('permission-denied', `Path "${path}" fora das pastas permitidas.`);
  }
  // Rate limit por IP + por user — apertados após security audit 4.40.21+
  await checkRateLimitIP(request, 'uploadR2', 60, 60);   // antes 100
  await checkRateLimit(auth.uid, 'uploadR2', 20, 60);    // antes 30
  // 4.40.21+ (security audit) — anota intenção de upload em audit_logs ANTES
  // de retornar token. Forensics + correlação com Worker-side acessos.
  await db.collection('audit_logs').add({
    action: 'security.r2_upload_token_issued',
    userId: auth.uid,
    entity: 'r2_upload',
    details: { path, expiresIn: 60 },
    severity: 'info',
    timestamp: FieldValue.serverTimestamp(),
  }).catch(() => {});
  // SECURITY NOTE (audit 2026-05-15): R2_UPLOAD_TOKEN é compartilhado entre
  // requests — token de longa duração validado pelo Worker. Defesas em camadas:
  //   1. App Check valida que vem do app oficial (não Postman/curl)
  //   2. Path whitelist (linha 487-501) limita destinos válidos
  //   3. Rate limit por IP + user (linhas acima)
  //   4. Audit log de cada token emitido (linha acima)
  //   5. expiresIn 60s comunica intenção pro client; Worker pode ser
  //      adaptado pra rejeitar TIMESTAMP_HEADER > 60s no futuro
  // FUTURO (sprint dedicado): JWT efêmero {path, uid, exp} assinado por HMAC
  // do mesmo Worker secret, eliminando token compartilhado.
  return {
    uploadUrl: 'https://primetour-images.rene-castro.workers.dev',
    uploadToken: R2_UPLOAD_TOKEN.value(),
    path,
    expiresIn: 60, // reduzido de 300s → 60s pra comunicar intenção
    issuedAt: Date.now(),
  };
});

/* ═════════════════════════════════════════════════════════
 * deleteR2 — Delete server-side (v4.57.49 fix I1 security)
 *
 * Antes: client chamava worker.dev/delete com X-Upload-Token hardcoded
 * em portal.js (público em GH Pages). Qualquer um inspecionando JS
 * podia deletar qualquer blob.
 *
 * Agora: CF valida auth + permissão + rate limit + path whitelist +
 * audit log, e SÓ ENTÃO chama Worker server-side com token de Secret
 * Manager. Cliente nunca vê o token.
 * ═════════════════════════════════════════════════════════ */
export const deleteR2 = onCall({
  cors: ['https://primetour.github.io', 'http://localhost:5000'],
  secrets: [R2_UPLOAD_TOKEN],
  maxInstances: 10,
}, async (request) => {
  const auth = requireAuth(request);
  const { path } = request.data || {};
  if (!path || typeof path !== 'string') throw new HttpsError('invalid-argument', 'path obrigatório');

  // Mesmas validações de path do getR2UploadUrl (security symmetry)
  if (path.includes('..') || path.includes('//') || path.includes('\\') || path.startsWith('/')) {
    throw new HttpsError('permission-denied', 'Path inválido (traversal/absoluto bloqueado).');
  }
  if (!/^[a-zA-Z0-9_./()-]+$/.test(path)) {
    throw new HttpsError('invalid-argument', 'Path com caracteres inválidos.');
  }
  if (path.length > 200) {
    throw new HttpsError('invalid-argument', 'Path muito longo.');
  }

  // Permission check: requer master OR portal_manage OR portal_images_manage
  // (mesmo de delete client-side em canManageImageBank).
  // SHAPE NOTE (descoberto na validação E2E v4.57.49):
  //  - users/{uid}.role pode ser 'master' (sem flag isMaster boolean no doc)
  //  - roles/{role}.permissions é OBJETO { perm_key: bool }, não array
  //  - roles/{role}.isSystem === true marca roles do sistema (master, admin)
  let canDelete = false;
  try {
    const u = await db.collection('users').doc(auth.uid).get();
    if (u.exists) {
      const data = u.data();
      const role = data?.role || data?.roleId;
      // Detecta master por flag OU por roleId
      if (data?.isMaster === true || role === 'master') {
        canDelete = true;
      } else if (role) {
        const r = await db.collection('roles').doc(role).get();
        if (r.exists) {
          const rd = r.data();
          const perms = rd?.permissions || {};
          // permissions é OBJETO {key:bool}, não array
          // SECURITY (audit 4.63.95): removido `|| rd.isSystem` — TODAS as roles
          // têm isSystem===true, logo era bypass total (member/partner deletavam).
          canDelete = perms.portal_manage === true || perms.portal_images_manage === true;
        }
      }
    }
  } catch (_) { /* default false */ }
  if (!canDelete) {
    throw new HttpsError('permission-denied', 'Sem permissão pra deletar imagens.');
  }

  // Rate limit
  await checkRateLimitIP(request, 'deleteR2', 30, 60);
  await checkRateLimit(auth.uid, 'deleteR2', 15, 60);

  // Audit ANTES do delete (forensics)
  await db.collection('audit_logs').add({
    action: 'security.r2_delete_called',
    userId: auth.uid,
    entity: 'r2_delete',
    details: { path },
    severity: 'info',
    timestamp: FieldValue.serverTimestamp(),
  }).catch(() => {});

  // Chama Worker server-side
  try {
    const workerUrl = `https://primetour-images.rene-castro.workers.dev?path=${encodeURIComponent(path)}`;
    const res = await fetch(workerUrl, {
      method: 'DELETE',
      headers: { 'X-Upload-Token': R2_UPLOAD_TOKEN.value() },
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => res.status);
      throw new HttpsError('internal', `Delete falhou no R2: ${msg}`);
    }
    return { ok: true, path };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('internal', `Delete error: ${e?.message || e}`);
  }
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
  // 4.40.21+ (security audit) — antes: comentário dizia "permite qualquer
  // auth user pq agentes precisam ler" sem enforcement. Agora exige
  // explicitamente admin OU permission `ai_use` no role/profile do user.
  // Sem essa permission, throw permission-denied (rastreado no audit).
  if (!await isAdmin(auth.uid)) {
    const userSnap = await db.collection('users').doc(auth.uid).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const hasAiUse =
      userData?.permissions?.ai_use === true ||
      userData?.permissions?.system_view_all === true;
    if (!hasAiUse) {
      // Log audit antes de rejeitar
      await db.collection('audit_logs').add({
        action: 'security.sharepoint_token_denied',
        userId: auth.uid,
        severity: 'warning',
        details: { reason: 'no_ai_use_permission' },
        timestamp: FieldValue.serverTimestamp(),
      }).catch(() => {});
      throw new HttpsError('permission-denied',
        'Sem permissão pra acessar SharePoint. Precisa de role com ai_use ou system_view_all.');
    }
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
 * uploadTemplate — v4.63.1+ Upload de Templates (HTML/DOCX/PPTX)
 *
 * Sprint v4.63.x: biblioteca de templates uploaded substituível.
 * - Recebe arquivo base64 + metadata
 * - Valida mime/size/extensão
 * - Calcula sha256
 * - Upload server-side pro R2 worker (path: templates/{module}/{templateId}.{ext})
 * - Cria doc em `templates/` via Admin SDK
 * - Retorna { templateId, fileUrl, fileSha256 }
 *
 * Permissão: master OR role.permissions.templates_manage === true.
 * ═════════════════════════════════════════════════════════ */
const TEMPLATE_FORMATS_CF = {
  html: { ext: ['html', 'htm'], maxMB: 5,  mime: 'text/html' },
  docx: { ext: ['docx'],        maxMB: 10, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  pptx: { ext: ['pptx'],        maxMB: 15, mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
};
const TEMPLATE_MODULES_CF = ['cotacoes', 'portal', 'banco-roteiros'];

async function _checkTemplatesPermission(uid) {
  if (!uid) return false;
  const u = await db.collection('users').doc(uid).get();
  if (!u.exists) return false;
  const ud = u.data();
  if (ud?.isMaster === true) return true;
  const role = ud?.role || ud?.roleId;
  if (!role) return false;
  if (role === 'master') return true;
  const r = await db.collection('roles').doc(role).get();
  if (!r.exists) return false;
  const perms = r.data()?.permissions || {};
  // SECURITY (audit 4.63.95): removido `|| isSystem` — TODAS as roles têm
  // isSystem===true, era bypass total. master já passa acima (role/isMaster).
  return perms.templates_manage === true;
}

export const uploadTemplate = onCall({
  cors: ['https://primetour.github.io', 'http://localhost:5000'],
  secrets: [R2_UPLOAD_TOKEN],
  memory: '512MiB',
  timeoutSeconds: 60,
  maxInstances: 10,
}, async (request) => {
  const auth = requireAuth(request);
  const { name, module, format, fileBase64, ownerType = 'area', ownerId = null,
          originalFilename = '', isDefault = false } = request.data || {};

  // Validações iniciais
  if (!name || typeof name !== 'string' || name.length > 120) {
    throw new HttpsError('invalid-argument', 'name obrigatório (string, max 120 chars).');
  }
  if (!TEMPLATE_MODULES_CF.includes(module)) {
    throw new HttpsError('invalid-argument', `module inválido (${module}). Esperado: ${TEMPLATE_MODULES_CF.join('/')}.`);
  }
  const fmtSpec = TEMPLATE_FORMATS_CF[format];
  if (!fmtSpec) {
    throw new HttpsError('invalid-argument', `format inválido (${format}). Esperado: html/docx/pptx.`);
  }
  if (!fileBase64 || typeof fileBase64 !== 'string') {
    throw new HttpsError('invalid-argument', 'fileBase64 obrigatório.');
  }
  if (!['area', 'global'].includes(ownerType)) {
    throw new HttpsError('invalid-argument', 'ownerType deve ser area ou global.');
  }
  if (ownerType === 'area' && !ownerId) {
    throw new HttpsError('invalid-argument', 'ownerId obrigatório quando ownerType=area.');
  }

  // Permission check
  const canManage = await _checkTemplatesPermission(auth.uid);
  if (!canManage) {
    throw new HttpsError('permission-denied', 'Requer permissão templates_manage ou role master.');
  }

  // Decode base64 + size check
  let buf;
  try { buf = Buffer.from(fileBase64, 'base64'); }
  catch { throw new HttpsError('invalid-argument', 'fileBase64 mal formado.'); }
  const sizeBytes = buf.length;
  const maxBytes = fmtSpec.maxMB * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    throw new HttpsError('invalid-argument', `Arquivo ${(sizeBytes / 1024 / 1024).toFixed(1)}MB excede limite ${fmtSpec.maxMB}MB pra ${format}.`);
  }
  if (sizeBytes < 50) {
    throw new HttpsError('invalid-argument', 'Arquivo vazio ou muito pequeno.');
  }

  // sha256 pra integridade + dedup futura
  const crypto = await import('crypto');
  const fileSha256 = crypto.createHash('sha256').update(buf).digest('hex');

  // Validate extension if filename provided (defensive)
  if (originalFilename) {
    const ext = (originalFilename.split('.').pop() || '').toLowerCase();
    if (!fmtSpec.ext.includes(ext)) {
      throw new HttpsError('invalid-argument', `Extensão .${ext} não bate com formato ${format} (esperado: ${fmtSpec.ext.join('/')}).`);
    }
  }

  // Rate limit (mais apertado que R2 — upload de template é evento raro)
  await checkRateLimitIP(request, 'uploadTemplate', 10, 60);
  await checkRateLimit(auth.uid, 'uploadTemplate', 5, 60);

  // templateId pré-gerado (Firestore auto-id format)
  const templateId = db.collection('templates').doc().id;
  const ext = fmtSpec.ext[0];
  const storagePath = `templates/${module}/${templateId}.${ext}`;

  // v4.63.2+ R2 Worker atualizado pra aceitar templates (HTML/DOCX/PPTX)
  // quando path inicia com 'templates/'. Worker valida MIME + tamanho por
  // tipo. Padrão: POST + X-Upload-Token + FormData {file, path}.
  const r2WorkerUrl = 'https://primetour-images.rene-castro.workers.dev';
  const filename = storagePath.split('/').pop();
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: fmtSpec.mime }), filename);
  fd.append('path', storagePath);
  const uploadRes = await fetch(r2WorkerUrl, {
    method: 'POST',
    headers: { 'X-Upload-Token': R2_UPLOAD_TOKEN.value() },
    body: fd,
  });
  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => '');
    throw new HttpsError('internal', `R2 upload falhou (${uploadRes.status}): ${errText.slice(0, 200)}`);
  }
  const fileUrl = `https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/${storagePath}`;

  // Cria doc Firestore (Admin SDK bypassa rules — mesmo padrão de outros uploads)
  const now = FieldValue.serverTimestamp();
  const docData = {
    name,
    module,
    format,
    fileUrl,
    fileStoragePath: storagePath,
    fileStorageProvider: 'cloudflare-r2',
    fileSize: sizeBytes,
    fileSha256,
    fileMime: fmtSpec.mime,
    placeholders: [],      // populado pela CF extractPlaceholders (v4.63.2)
    previewUrl: null,      // populado pela CF generateTemplatePreview (v4.63.5)
    ownerType,
    ownerId,
    isDefault: !!isDefault,
    status: 'active',
    version: 1,
    parentTemplateId: null,
    versionHistory: [{ version: 1, sha: fileSha256, uploadedAt: new Date() }],
    duplicatedFrom: null,
    uploadedAt: now,
    uploadedBy: auth.uid,
    updatedAt: now,
    updatedBy: auth.uid,
  };
  await db.collection('templates').doc(templateId).set(docData);

  // Audit log
  await db.collection('audit_logs').add({
    action: 'templates.create',
    userId: auth.uid,
    entity: 'templates',
    entityId: templateId,
    details: { name, module, format, ownerType, ownerId, sizeBytes, fileSha256: fileSha256.slice(0, 16) },
    severity: 'info',
    timestamp: now,
  }).catch(() => {});

  return {
    templateId,
    fileUrl,
    fileSha256,
    sizeBytes,
  };
});

/* ═════════════════════════════════════════════════════════
 * extractPlaceholders — v4.63.3+ trigger reativo onCreate
 *
 * Quando upload de template entra no Firestore, baixa o arquivo,
 * extrai placeholders Handlebars `{{var.path}}` e popula o campo
 * `placeholders[]` no doc. Permite UI mostrar quais variáveis o
 * template usa antes de atribuir a uma área.
 *
 * Estratégia por formato:
 *   - HTML: regex direto no texto
 *   - DOCX/PPTX: pizzip extrai .xml internos → regex no XML
 *
 * Idempotente. Falhas gravam `placeholdersExtractionError` (não-bloqueante).
 * ═════════════════════════════════════════════════════════ */
function _extractHandlebarsFromText(text) {
  if (!text) return [];
  const re = /\{\{\s*(?:#(?:each|if|unless|with)\s+)?([a-zA-Z_][\w.[\]\-]*)\s*[}~]/g;
  const found = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    const path = m[1];
    if (!path) continue;
    if (path.startsWith('@')) continue;
    if (path === 'this') continue;
    found.add(path);
  }
  return [...found];
}

async function _extractOfficePlaceholders(buf) {
  const { default: PizZip } = await import('pizzip');
  let zip;
  try {
    zip = new PizZip(buf);
  } catch (e) {
    throw new Error(`Arquivo Office mal formado: ${e.message}`);
  }
  const found = new Set();
  for (const filename of Object.keys(zip.files)) {
    if (!filename.endsWith('.xml')) continue;
    if (!filename.startsWith('word/') && !filename.startsWith('ppt/')) continue;
    const content = zip.file(filename)?.asText() || '';
    if (!content) continue;
    // Concatena runs adjacentes pra recuperar placeholders quebrados
    const cleaned = content
      .replace(/<\/w:t><[^>]+><w:t[^>]*>/g, '')
      .replace(/<\/a:t><[^>]+><a:t[^>]*>/g, '');
    for (const p of _extractHandlebarsFromText(cleaned)) found.add(p);
  }
  return [...found];
}

export const extractPlaceholders = onDocumentCreated({
  document: 'templates/{templateId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (event) => {
  const snap = event.data;
  if (!snap) return;
  const tpl = snap.data();
  if (!tpl?.fileUrl || !tpl?.format) {
    console.log('[extractPlaceholders] skip: sem fileUrl ou format');
    return;
  }
  const templateId = event.params.templateId;
  console.log(`[extractPlaceholders] inicio templateId=${templateId} format=${tpl.format}`);

  try {
    // v4.63.13+ Security #5: valida origem do fileUrl antes de fetch
    // (defesa contra admin malicioso editando fileUrl no Firestore pra
    // apontar pra interno/metadata server → SSRF via CF).
    if (!_validateR2FileUrl(tpl.fileUrl)) {
      throw new Error(`fileUrl inválido (origem não-R2): ${tpl.fileUrl?.slice(0,80)}`);
    }
    const res = await fetch(tpl.fileUrl);
    if (!res.ok) throw new Error(`Fetch falhou (${res.status})`);

    let placeholders = [];
    if (tpl.format === 'html') {
      const text = await res.text();
      placeholders = _extractHandlebarsFromText(text);
    } else if (tpl.format === 'docx' || tpl.format === 'pptx') {
      const ab = await res.arrayBuffer();
      placeholders = await _extractOfficePlaceholders(Buffer.from(ab));
    } else {
      throw new Error(`Format desconhecido: ${tpl.format}`);
    }

    placeholders = placeholders.sort().slice(0, 200);

    await snap.ref.update({
      placeholders,
      placeholdersExtractedAt: FieldValue.serverTimestamp(),
      placeholdersExtractionError: null,
    });
    console.log(`[extractPlaceholders] ok templateId=${templateId}: ${placeholders.length}`);
  } catch (e) {
    const errMsg = String(e?.message || e).slice(0, 500);
    console.error(`[extractPlaceholders] FALHOU ${templateId}:`, errMsg);
    try {
      await snap.ref.update({
        placeholders: [],
        placeholdersExtractionError: errMsg,
        placeholdersExtractedAt: FieldValue.serverTimestamp(),
      });
    } catch {}
  }
});

/* ═════════════════════════════════════════════════════════
 * renderTemplate — v4.63.6+ Render engine de templates
 *
 * Recebe { templateId, data } → baixa template do R2 → interpola
 * Handlebars com data → renderiza (HTML→PDF via Puppeteer) → retorna
 * PDF como base64 pro cliente decodificar + baixar.
 *
 * v4.63.6 cobre só HTML→PDF. DOCX/PPTX virão em v4.63.7 (docxtemplater).
 *
 * Limite: response callable ≤10MB → PDFs grandes podem estourar.
 * Pra v4.63.9 considerar fallback: salvar PDF em R2 + retornar URL.
 *
 * Permission: qualquer auth (templates ativos da biblioteca).
 * ═════════════════════════════════════════════════════════ */
/* ═════════════════════════════════════════════════════════
 * _renderTemplateCore — v4.63.87+ núcleo compartilhado de render.
 *
 * Extraído de renderTemplate pra ser reusado pelo endpoint streaming
 * renderTemplateFile (onRequest). Faz: fetch do template doc → baixa
 * arquivo R2 → Handlebars/Puppeteer (HTML→PDF) ou docxtemplater
 * (DOCX/PPTX) → retorna o buffer final + metadata.
 *
 * NÃO faz auth nem rate-limit (responsabilidade do caller). Lança
 * HttpsError com .code semântico (not-found / failed-precondition /
 * invalid-argument / internal) — callers onCall propagam direto;
 * onRequest mapeia .code → HTTP status.
 * ═════════════════════════════════════════════════════════ */
async function _renderTemplateCore(templateId, data = {}) {
  // Fetch template doc
  const snap = await db.collection('templates').doc(templateId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Template não encontrado.');
  const tpl = snap.data();
  if (tpl.status === 'archived') {
    throw new HttpsError('failed-precondition', 'Template arquivado.');
  }
  if (!tpl.fileUrl) {
    throw new HttpsError('failed-precondition', 'Template sem fileUrl.');
  }

  if (!['html', 'docx', 'pptx'].includes(tpl.format)) {
    throw new HttpsError('invalid-argument', `Format ${tpl.format} não suportado.`);
  }

  // v4.63.13+ Security #5: valida origem do fileUrl (mesma defesa de
  // extractPlaceholders contra fileUrl tampered → SSRF).
  if (!_validateR2FileUrl(tpl.fileUrl)) {
    throw new HttpsError('failed-precondition', `Template com fileUrl inválido (não-R2).`);
  }

  // Baixar template do R2 (texto pra HTML, arrayBuffer pra DOCX/PPTX)
  const res = await fetch(tpl.fileUrl);
  if (!res.ok) throw new HttpsError('internal', `Fetch template falhou (${res.status}).`);

  let outputBuf;
  let outputMime;
  let outputExt;

  if (tpl.format === 'html') {
    const htmlRaw = await res.text();

    // Compilar + interpolar Handlebars
    let rendered;
    try {
      const { default: Handlebars } = await import('handlebars');
      const compiled = Handlebars.compile(htmlRaw, { noEscape: false });
      rendered = compiled(data);
    } catch (e) {
      throw new HttpsError('invalid-argument', `Handlebars falhou: ${e?.message || e}`);
    }

    // Puppeteer + Chromium serverless → PDF
    try {
      const { default: puppeteer } = await import('puppeteer-core');
      const { default: chromium } = await import('@sparticuz/chromium');
      const browser = await puppeteer.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: true,
        defaultViewport: { width: 1240, height: 1754 },
      });
      try {
        const page = await browser.newPage();
        // v4.63.13+ Security #2 (audit pós-sprint): SSRF lockdown.
        // Templates HTML são arbitrários (uploader com templates_manage).
        // Sem intercepção, <iframe src="http://169.254.169.254/computeMetadata">
        // ou <img src="http://internal-svc/"> rodam dentro do CF — vazam IP,
        // tokens GCP metadata, expõem rede interna. Allowlist: data: URIs
        // (embedded base64) + R2 origin + Google Fonts (uso comum em templates
        // luxury). Tudo o mais é abortado. networkidle0 ainda funciona porque
        // requests abortadas contam como "concluídas".
        const ALLOWED_FETCH_ORIGINS = [
          'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev',
          'https://fonts.googleapis.com',
          'https://fonts.gstatic.com',
          // v4.63.83+ Capa/dias com foto: CDNs de imagem públicas que o sistema
          // usa pra hero (enrichRoteiroImages / resolveBankHero / Unsplash
          // fallback). Sem isso a foto da capa é abortada pelo SSRF guard e cai
          // pro fundo sólido. São CDNs públicos bem-conhecidos (não-proxy, sem
          // risco de SSRF pra rede interna) — mesma whitelist do img-src CSP.
          'https://images.unsplash.com',
          'https://primetour-images.rene-castro.workers.dev',
          'https://upload.wikimedia.org',
          'https://lh3.googleusercontent.com',
          'https://storage.googleapis.com',
        ];
        await page.setRequestInterception(true);
        page.on('request', req => {
          const url = req.url();
          if (url.startsWith('data:') || url.startsWith('about:')) {
            req.continue(); return;
          }
          const allowed = ALLOWED_FETCH_ORIGINS.some(o => url.startsWith(o + '/') || url === o);
          if (allowed) { req.continue(); return; }
          console.warn(`[renderTemplate SSRF block] ${req.resourceType()} ${url.slice(0,120)}`);
          req.abort('blockedbyresponse');
        });
        await page.setContent(rendered, { waitUntil: 'networkidle0', timeout: 60000 });
        // v4.63.93: margem do PDF = 0 → o CSS @page de cada template controla as
        // margens. Necessário pra (1) capa full-bleed (`@page coverpage{margin:0}`
        // + `.cover{page:coverpage}`) — antes a margem fixa 20mm/15mm enquadrava a
        // capa escura num frame branco ("capa cortada"); e (2) margem de topo
        // CONSISTENTE em TODAS as páginas — a margem do page.pdf só aplicava o top
        // na 1ª página de cada fluxo, então páginas de continuação colavam o texto
        // no limite superior. Com @page{margin:18mm 15mm} no CSS, toda página
        // (inclusive continuação) recebe a margem. Templates HTML que passam por
        // aqui (cotacoes, banco-roteiros) declaram suas próprias @page.
        outputBuf = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
        });
      } finally {
        await browser.close();
      }
    } catch (e) {
      throw new HttpsError('internal', `Puppeteer falhou: ${e?.message || e}`);
    }
    // puppeteer-core 25+ retorna Uint8Array (v4.63.7 fix)
    outputBuf = Buffer.from(outputBuf);
    outputMime = 'application/pdf';
    outputExt = 'pdf';

  } else {
    // v4.63.8+ DOCX/PPTX via docxtemplater. Ambos os formatos são ZIPs
    // de XMLs internos — docxtemplater reusa o mesmo engine pra Mustache
    // {{var}} dentro dos elementos de texto.
    const buf = Buffer.from(await res.arrayBuffer());

    let renderedBuf;
    try {
      const { default: PizZip } = await import('pizzip');
      const { default: Docxtemplater } = await import('docxtemplater');

      const zip = new PizZip(buf);
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        // Não escapar HTML — Office não interpreta
        delimiters: { start: '{{', end: '}}' },
      });

      doc.render(data);
      renderedBuf = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
    } catch (e) {
      // docxtemplater erros vêm com .properties cheios de info
      const detail = e?.properties?.errors
        ? e.properties.errors.map(er => er.properties?.explanation || er.message).join('; ').slice(0, 300)
        : (e?.message || String(e));
      throw new HttpsError('invalid-argument', `Render ${tpl.format} falhou: ${detail}`);
    }
    outputBuf = Buffer.from(renderedBuf);
    if (tpl.format === 'docx') {
      outputMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      outputExt = 'docx';
    } else {
      outputMime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      outputExt = 'pptx';
    }
  }

  const safeName = (tpl.name || 'template').replace(/[^a-zA-Z0-9À-ſ\-_ ]/g, '').slice(0, 60).trim() || 'template';
  const filename = `${safeName}.${outputExt}`;

  return { outputBuf, outputMime, outputExt, filename, format: tpl.format, tplName: tpl.name || '' };
}

export const renderTemplate = onCall({
  cors: ['https://primetour.github.io', 'http://localhost:5000'],
  memory: '1GiB',                  // Chromium precisa
  timeoutSeconds: 90,
  maxInstances: 5,
  secrets: [R2_UPLOAD_TOKEN],      // 4.63.84 — necessário pro R2 fallback (>5MB).
                                   // Sem isso, .value() vinha vazio → upload 401 →
                                   // base64 gigante → "Response size too large" →
                                   // render falhava → cliente caía pro jsPDF.
}, async (request) => {
  const auth = requireAuth(request);
  const { templateId, data = {} } = request.data || {};

  if (!templateId || typeof templateId !== 'string' || templateId.length > 200
      || !/^[\w.\-]+$/.test(templateId)) {
    throw new HttpsError('invalid-argument', 'templateId inválido.');
  }

  // SECURITY (audit 4.63.95): cap no tamanho do payload `data` — sem isso, um
  // member podia mandar um objeto gigante pra forçar OOM/custo no Puppeteer
  // (memory 1GiB). 2MB de JSON cobre qualquer cotação real com folga.
  try {
    const dataBytes = Buffer.byteLength(JSON.stringify(data || {}), 'utf8');
    if (dataBytes > 2 * 1024 * 1024) {
      throw new HttpsError('invalid-argument', 'Payload de dados muito grande (máx 2MB).');
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('invalid-argument', 'Payload de dados inválido (não serializável).');
  }

  // Rate limit
  await checkRateLimit(auth.uid, 'renderTemplate', 30, 60);

  const { outputBuf, outputMime, outputExt, filename } = await _renderTemplateCore(templateId, data);
  const tpl = { format: outputExt === 'pdf' ? 'html' : outputExt, name: filename.replace(/\.[^.]+$/, '') };

  const sizeBytes = outputBuf.length;

  // v4.63.16+ Fix HIGH Perf #2 (audit pós-sprint): callable response limit
  // ~10MB força base64 + JSON overhead. Tudo >5MB sobe pra R2 worker em
  // path renders/{uid}/{ts}-{templateId}.{ext} e retorna {downloadUrl}.
  // Client (templates.js renderTemplate) detecta downloadUrl e fetcha blob
  // via HTTP. Path NÃO tem TTL (manual cleanup via cron futuro).
  const FALLBACK_THRESHOLD = 5 * 1024 * 1024; // 5MB
  let downloadUrl = null;
  if (sizeBytes > FALLBACK_THRESHOLD) {
    try {
      const r2WorkerUrl = 'https://primetour-images.rene-castro.workers.dev';
      const ts = Date.now();
      const r2Path = `renders/${auth.uid}/${ts}-${templateId}.${outputExt}`;
      const fd = new FormData();
      fd.append('file', new Blob([outputBuf], { type: outputMime }), filename);
      fd.append('path', r2Path);
      const uploadRes = await fetch(r2WorkerUrl, {
        method: 'POST',
        headers: { 'X-Upload-Token': R2_UPLOAD_TOKEN.value() },
        body: fd,
      });
      if (uploadRes.ok) {
        downloadUrl = `https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/${r2Path}`;
        console.log(`[renderTemplate] Output ${sizeBytes}B > ${FALLBACK_THRESHOLD}B → R2 fallback ${r2Path}`);
      } else {
        const errText = await uploadRes.text().catch(() => '');
        console.warn(`[renderTemplate] R2 fallback falhou (${uploadRes.status}): ${errText.slice(0,150)}. Tentando base64 ainda.`);
      }
    } catch (e) {
      console.warn(`[renderTemplate] R2 fallback exception: ${e?.message || e}. Tentando base64 ainda.`);
    }
  }

  // Audit
  await db.collection('audit_logs').add({
    action: 'templates.render',
    userId: auth.uid,
    entity: 'templates',
    entityId: templateId,
    details: {
      format: tpl.format, sizeBytes,
      dataKeys: Object.keys(data).slice(0, 20),
      via: downloadUrl ? 'r2-fallback' : 'base64',
    },
    severity: 'info',
    timestamp: FieldValue.serverTimestamp(),
  }).catch(() => {});

  // Se R2 fallback OK, retorna SEM base64 (economiza 10MB de overhead)
  if (downloadUrl) {
    return {
      downloadUrl,
      mime: outputMime,
      filename,
      sizeBytes,
      templateId,
      templateName: tpl.name,
      via: 'r2-fallback',
    };
  }

  // Path base64 normal (output ≤ 5MB OU R2 falhou — graceful degradation)
  return {
    // v4.63.8+ resposta unificada pra 3 formatos
    fileBase64: outputBuf.toString('base64'),
    mime: outputMime,
    filename,
    sizeBytes,
    templateId,
    templateName: tpl.name,
    via: 'base64',
    // Backwards compat (clientes antigos v4.63.6 esperam pdfBase64)
    pdfBase64: tpl.format === 'html' ? outputBuf.toString('base64') : undefined,
  };
});

/* ═════════════════════════════════════════════════════════
 * renderTemplateFile — v4.63.87+ endpoint STREAMING (onRequest).
 *
 * RAIZ DO BUG "internal" (v4.63.84→86): renderTemplate (onCall) tinha
 * limite de resposta ~10MB. PDF de cotação real (>7MB) estourava o
 * base64 → "Response size too large" → cliente caía pro jsPDF. O R2
 * fallback NÃO resolvia porque o worker rejeita PDF em TODO path (415)
 * + a URL pub-*.r2.dev não tem CORS pro fetch do browser.
 *
 * Solução: onRequest (Cloud Run, limite ~32MiB) que renderiza e
 * STREAMA o binário direto, com CORS. Sem worker, sem Storage, sem
 * secret novo. O domínio us-central1-…cloudfunctions.net já está no
 * connect-src do CSP (index.html), então o fetch do browser passa.
 *
 * Auth: Bearer ID token (Authorization header), verificado via Admin
 * SDK. Rate-limit por uid. POST { templateId, data }.
 * ═════════════════════════════════════════════════════════ */
export const renderTemplateFile = onRequest({
  region: 'us-central1',
  memory: '1GiB',          // Chromium precisa
  timeoutSeconds: 90,
  maxInstances: 5,
  cors: true,
}, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Expose-Headers', 'Content-Disposition, X-Template-Name, X-Render-Format');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  if (req.method !== 'POST') {
    res.set('Allow', 'POST, OPTIONS');
    res.status(405).type('text/plain').send('Method Not Allowed');
    return;
  }

  // Auth via Bearer ID token
  const authz = req.get('authorization') || req.get('Authorization') || '';
  const m = authz.match(/^Bearer\s+(.+)$/i);
  if (!m) { res.status(401).type('text/plain').send('Missing Bearer token'); return; }
  let uid;
  try {
    const decoded = await getAuth().verifyIdToken(m[1].trim());
    uid = decoded.uid;
  } catch (e) {
    res.status(401).type('text/plain').send('Invalid token');
    return;
  }

  // Body
  const body = req.body || {};
  const templateId = body.templateId;
  const data = body.data || {};
  if (!templateId || typeof templateId !== 'string') {
    res.status(400).type('text/plain').send('templateId obrigatório');
    return;
  }

  // Rate limit (reusa o mesmo bucket do renderTemplate onCall)
  try {
    await checkRateLimit(uid, 'renderTemplate', 30, 60);
  } catch (e) {
    res.status(429).type('text/plain').send(e?.message || 'Rate limit');
    return;
  }

  try {
    const { outputBuf, outputMime, outputExt, filename, format, tplName } =
      await _renderTemplateCore(templateId, data);

    // Audit fire-and-forget
    db.collection('audit_logs').add({
      action: 'templates.render',
      userId: uid,
      entity: 'templates',
      entityId: templateId,
      details: {
        format, sizeBytes: outputBuf.length,
        dataKeys: Object.keys(data).slice(0, 20),
        via: 'stream',
      },
      severity: 'info',
      timestamp: FieldValue.serverTimestamp(),
    }).catch(() => {});

    res.set('Content-Type', outputMime);
    res.set('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.set('X-Template-Name', encodeURIComponent(tplName || ''));
    res.set('X-Render-Format', outputExt);
    res.status(200).send(outputBuf);
  } catch (e) {
    // Mapeia HttpsError.code → HTTP status
    const codeMap = {
      'not-found': 404,
      'failed-precondition': 412,
      'invalid-argument': 400,
      'unauthenticated': 401,
      'permission-denied': 403,
      'resource-exhausted': 429,
      'internal': 500,
    };
    const status = codeMap[e?.code] || 500;
    console.error(`[renderTemplateFile] ${e?.code || 'error'}: ${e?.message || e}`);
    res.status(status).type('text/plain').send(e?.message || 'Render failed');
  }
});

/* ═════════════════════════════════════════════════════════
 * duplicateTemplate — v4.63.9+ duplica pra outra área
 *
 * Pega template original → baixa arquivo R2 → copia pra novo path
 * (novo templateId) → cria novo doc Firestore com duplicatedFrom +
 * preserva placeholders + metadata. Não compartilha arquivo R2 entre
 * docs pra evitar "alguém deletou original e quebrou 5 áreas".
 *
 * Permission: templates_manage OR isMaster.
 * ═════════════════════════════════════════════════════════ */

/* ═════════════════════════════════════════════════════════
 * getTemplateHtml — v4.63.24+ Proxy GET pra template HTML com CORS.
 *
 * R2 bucket público (pub-...r2.dev) NÃO retorna Access-Control-Allow-Origin
 * → browser bloqueia fetch cross-origin de primetour.github.io. Esta CF
 * proxia o GET, valida template ativo + R2 origin, retorna HTML com
 * Access-Control-Allow-Origin: *.
 *
 * Uso: portal-view-tpl.html chama
 *   `https://us-central1-…/getTemplateHtml?tplId=XXX`
 *
 * Cache: 5min CDN (template muda raramente, web link tem token único).
 * Sem auth — templates ativos são públicos (compartilhamento web link).
 * ═════════════════════════════════════════════════════════ */
// v4.63.25+ Audit Web Link sprint findings:
// - HIGH: Content-Length cap pra evitar DoS amplification (admin malicioso
//   sobe template 50MB → CF OOM + custo egress R2). MAX = TEMPLATE_FORMATS.web.maxMB.
// - HIGH: 405 pra métodos != GET (POST/PUT/DELETE retornavam 200, viola REST).
// - MEDIUM: audit log fire-and-forget pra forense (quem requisitou qual tpl).
const TEMPLATE_WEB_MAX_BYTES = 8 * 1024 * 1024;  // 8MB (TEMPLATE_FORMATS.web.maxMB)

export const getTemplateHtml = onRequest({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 10,
  cors: true,
}, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Cache-Control', 'public, max-age=300, s-maxage=300');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  // v4.63.25 HIGH: rejeitar não-GET (Firebase Functions framework não restringe nativo)
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.set('Allow', 'GET, OPTIONS');
    res.status(405).type('text/plain').send('Method Not Allowed');
    return;
  }

  const tplId = String(req.query.tplId || '').trim();
  if (!tplId || !/^[a-zA-Z0-9_-]+$/.test(tplId)) {
    res.status(400).type('text/plain').send('Invalid tplId');
    return;
  }

  try {
    const snap = await db.collection('templates').doc(tplId).get();
    if (!snap.exists) { res.status(404).type('text/plain').send('Template not found'); return; }
    const tpl = snap.data();
    if (tpl.status !== 'active') { res.status(403).type('text/plain').send('Template not active'); return; }
    if (!_validateR2FileUrl(tpl.fileUrl)) {
      res.status(400).type('text/plain').send('Invalid fileUrl (non-R2)');
      return;
    }

    const r = await fetch(tpl.fileUrl);
    if (!r.ok) { res.status(502).type('text/plain').send(`R2 fetch failed (${r.status})`); return; }

    // v4.63.25 HIGH: Content-Length cap (DoS amplification). Se header faltar,
    // ainda lê e checa tamanho do buffer.
    const declaredLen = parseInt(r.headers.get('content-length') || '0', 10);
    if (declaredLen > TEMPLATE_WEB_MAX_BYTES) {
      console.warn(`[getTemplateHtml] template ${tplId} excede limite: ${declaredLen} bytes`);
      res.status(413).type('text/plain').send(`Template too large (>${TEMPLATE_WEB_MAX_BYTES} bytes)`);
      return;
    }
    const html = await r.text();
    if (html.length > TEMPLATE_WEB_MAX_BYTES) {
      console.warn(`[getTemplateHtml] template ${tplId} excede após download: ${html.length} bytes`);
      res.status(413).type('text/plain').send(`Template too large (>${TEMPLATE_WEB_MAX_BYTES} bytes)`);
      return;
    }

    // v4.63.25 MEDIUM: audit fire-and-forget (não bloqueia resposta).
    db.collection('audit_logs').add({
      action: 'templates.serve_web',
      entityType: 'templates',
      entityId: tplId,
      actorId: 'public',
      details: {
        templateName: tpl.name || '',
        ip: req.ip || req.get('x-forwarded-for') || 'unknown',
        ua: (req.get('user-agent') || '').slice(0, 200),
        bytes: html.length,
      },
      severity: 'info',
      timestamp: FieldValue.serverTimestamp(),
    }).catch(e => console.warn('[getTemplateHtml] audit log falhou:', e?.message));

    res.type('text/html; charset=utf-8').send(html);
  } catch (e) {
    console.error('[getTemplateHtml]', e?.message || e);
    res.status(500).type('text/plain').send(`Error: ${e?.message || 'unknown'}`);
  }
});

export const duplicateTemplate = onCall({
  cors: ['https://primetour.github.io', 'http://localhost:5000'],
  secrets: [R2_UPLOAD_TOKEN],
  memory: '512MiB',
  timeoutSeconds: 60,
  maxInstances: 10,
}, async (request) => {
  const auth = requireAuth(request);
  const { sourceTemplateId, targetOwnerType, targetOwnerId, newName, isDefault = false } = request.data || {};

  if (!sourceTemplateId || typeof sourceTemplateId !== 'string') {
    throw new HttpsError('invalid-argument', 'sourceTemplateId obrigatório.');
  }
  if (!['area', 'global'].includes(targetOwnerType)) {
    throw new HttpsError('invalid-argument', 'targetOwnerType deve ser area ou global.');
  }
  if (targetOwnerType === 'area' && !targetOwnerId) {
    throw new HttpsError('invalid-argument', 'targetOwnerId obrigatório quando targetOwnerType=area.');
  }

  // Permission
  const canManage = await _checkTemplatesPermission(auth.uid);
  if (!canManage) {
    throw new HttpsError('permission-denied', 'Requer permissão templates_manage ou role master.');
  }

  // Rate limit
  await checkRateLimit(auth.uid, 'duplicateTemplate', 10, 60);

  // Source template
  const srcSnap = await db.collection('templates').doc(sourceTemplateId).get();
  if (!srcSnap.exists) throw new HttpsError('not-found', 'Template original não encontrado.');
  const src = srcSnap.data();

  // Não duplicar pro mesmo owner
  if (src.ownerType === targetOwnerType && src.ownerId === targetOwnerId) {
    throw new HttpsError('failed-precondition', 'Template já pertence a esse owner — não há o que duplicar.');
  }

  // v4.63.13+ Security #5: valida origem do fileUrl original (defesa cross-CF
  // — admin malicioso poderia editar src.fileUrl pra apontar pra interno).
  if (!_validateR2FileUrl(src.fileUrl)) {
    throw new HttpsError('failed-precondition', `Template original com fileUrl inválido (não-R2).`);
  }
  // Baixar arquivo R2 original
  const fetchRes = await fetch(src.fileUrl);
  if (!fetchRes.ok) throw new HttpsError('internal', `Fetch original falhou (${fetchRes.status}).`);
  const fileBuf = Buffer.from(await fetchRes.arrayBuffer());

  // Gerar novo templateId + path
  const newTemplateId = db.collection('templates').doc().id;
  const ext = src.fileStoragePath.split('.').pop();
  const newR2Path = `templates/${src.module}/${newTemplateId}.${ext}`;

  // Upload pro R2 worker (mesmo padrão de uploadTemplate)
  const r2WorkerUrl = 'https://primetour-images.rene-castro.workers.dev';
  const filename = newR2Path.split('/').pop();
  const fd = new FormData();
  fd.append('file', new Blob([fileBuf], { type: src.fileMime }), filename);
  fd.append('path', newR2Path);
  const uploadRes = await fetch(r2WorkerUrl, {
    method: 'POST',
    headers: { 'X-Upload-Token': R2_UPLOAD_TOKEN.value() },
    body: fd,
  });
  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => '');
    throw new HttpsError('internal', `R2 copy falhou (${uploadRes.status}): ${errText.slice(0, 200)}`);
  }
  const newFileUrl = `https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/${newR2Path}`;

  // Cria novo doc
  const now = FieldValue.serverTimestamp();
  const newDoc = {
    name: newName?.trim() || `${src.name} (cópia)`,
    module: src.module,
    format: src.format,
    fileUrl: newFileUrl,
    fileStoragePath: newR2Path,
    fileSize: src.fileSize,
    fileSha256: src.fileSha256,    // mesmo conteúdo → mesmo hash
    fileMime: src.fileMime,
    fileStorageProvider: 'cloudflare-r2',
    placeholders: src.placeholders || [],   // copia spec já extraída
    placeholdersExtractedAt: src.placeholdersExtractedAt || null,
    previewUrl: null,                       // preview thumb futuro
    ownerType: targetOwnerType,
    ownerId: targetOwnerType === 'global' ? null : targetOwnerId,
    isDefault: !!isDefault,
    status: 'active',
    version: 1,
    parentTemplateId: null,
    versionHistory: [{ version: 1, sha: src.fileSha256, uploadedAt: new Date() }],
    duplicatedFrom: sourceTemplateId,
    uploadedAt: now,
    uploadedBy: auth.uid,
    updatedAt: now,
    updatedBy: auth.uid,
  };
  await db.collection('templates').doc(newTemplateId).set(newDoc);

  // Audit
  await db.collection('audit_logs').add({
    action: 'templates.duplicate',
    userId: auth.uid,
    entity: 'templates',
    entityId: newTemplateId,
    details: {
      sourceTemplateId,
      sourceName: src.name,
      targetOwnerType,
      targetOwnerId,
      newTemplateId,
    },
    severity: 'info',
    timestamp: now,
  }).catch(() => {});

  return {
    templateId: newTemplateId,
    fileUrl: newFileUrl,
    name: newDoc.name,
    duplicatedFrom: sourceTemplateId,
  };
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

  // 4.40.21+ (security audit) — valida email antes de mandar pro Graph.
  // Antes: passava survey.clientEmail direto sem regex → email injection /
  // CRLF possíveis se o doc fosse adulterado client-side antes da rule fechar.
  const RFC5322_LITE = /^[^\s<>"@]{1,64}@[^\s<>"@.]{1,63}(\.[^\s<>"@.]{1,63}){1,8}$/;
  if (!survey.clientEmail || !RFC5322_LITE.test(survey.clientEmail)) {
    throw new HttpsError('invalid-argument',
      `Email do cliente inválido: ${survey.clientEmail || '(vazio)'}`);
  }
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
  const auth = requireAuth(request);
  // SECURITY (audit 4.63.95): antes era requireAuth-only com `repo` arbitrário.
  // Qualquer member logado podia ler QUALQUER repo que o PAT alcança
  // (inclusive privados) via SSRF na api.github.com. Agora:
  //   1) exige admin/master ou system_manage_settings
  //   2) repo precisa estar na allowlist
  //   3) branch/path validados (anti path traversal / query injection)
  //   4) download_url precisa vir de raw.githubusercontent.com
  if (!(await hasPermissionUid(auth.uid, 'system_manage_settings'))) {
    throw new HttpsError('permission-denied',
      'Apenas admin/master ou system_manage_settings.');
  }
  const REPO_ALLOWLIST = new Set(['primetour/tarefas']);
  const { repo, path = '', branch = 'main' } = request.data || {};
  if (!repo || typeof repo !== 'string' || !REPO_ALLOWLIST.has(repo)) {
    throw new HttpsError('permission-denied', 'repo fora da allowlist.');
  }
  if (typeof branch !== 'string' || !/^[\w.\-\/]{1,100}$/.test(branch)) {
    throw new HttpsError('invalid-argument', 'branch inválido.');
  }
  const cleanPath = String(path).replace(/^\/+|\/+$/g, '');
  if (cleanPath.includes('..') || !/^[\w.\-\/ ]{0,300}$/.test(cleanPath)) {
    throw new HttpsError('invalid-argument', 'path inválido.');
  }
  const isRawGh = (u) => typeof u === 'string'
    && /^https:\/\/raw\.githubusercontent\.com\//.test(u);
  const headers = {};
  const pat = GITHUB_PAT.value();
  if (pat) headers.Authorization = `Bearer ${pat}`;
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURI(cleanPath)}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new HttpsError('not-found', `GitHub ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data)) {
    const files = data.filter(f => f.type === 'file' && /\.(md|txt|json|yml|yaml|csv|html)$/i.test(f.name)).slice(0, 5);
    let combined = '';
    for (const f of files) {
      if (!isRawGh(f.download_url)) continue;
      const r = await fetch(f.download_url);
      const t = await r.text();
      combined += `\n--- ${f.name} ---\n${t.slice(0, 4000)}\n`;
    }
    return { type: 'folder', text: combined.trim() };
  } else if (data.type === 'file') {
    if (!isRawGh(data.download_url)) {
      throw new HttpsError('failed-precondition', 'download_url inesperado.');
    }
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
  // 4.63.95 (security audit): valida formato do ID — evita injeção de
  // segmentos no path do db.doc() e escrita em doc arbitrário fora de padrão.
  if (typeof destinationId !== 'string' || !/^[\w-]{1,128}$/.test(destinationId)) {
    console.warn('[fetchPhoto] destinationId inválido, skip cache:', String(destinationId).slice(0, 40));
    return;
  }
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

// 4.40.21+ (security audit) — email do admin de feedbacks vem de env var
// (process.env.FEEDBACK_ADMIN_EMAIL) com fallback ao valor histórico pra
// não quebrar deploy existente. Pra trocar em prod:
//   firebase functions:secrets:set FEEDBACK_ADMIN_EMAIL  (ou via gcloud)
// ou
//   --set-env-vars FEEDBACK_ADMIN_EMAIL=novo@dominio.com (no deploy)
const FEEDBACK_ADMIN_EMAIL = process.env.FEEDBACK_ADMIN_EMAIL || 'rene.castro@primetour.com.br';

function _escFb(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function _buildSystemFeedbackEmailHtml(fb) {
  // 4.35.26+: usa renderEmailTemplate compartilhado (identidade unificada).
  const t = FEEDBACK_TYPE_LABELS[fb.type] || { emoji: '💬', label: 'Feedback', color: '#888' };
  const VARIANT_BY_TYPE = { bug: 'danger', suggestion: 'default', question: 'default', praise: 'success' };
  return renderEmailTemplate({
    preheader:    `${t.label} de ${fb.authorName || 'Usuário'}`,
    overline:     `${t.emoji} ${t.label.toUpperCase()} — SISTEMA`,
    heading:      'Feedback do Sistema PRIMETOUR',
    intro:        '',
    blocks: [
      { type: 'quote', text: fb.message || '' },
      { type: 'data', rows: [
        ['De',         fb.authorName || 'Usuário'],
        ['E-mail',     fb.authorEmail || '—'],
        ['Função',     fb.authorRole || 'member'],
        ['Página',     fb.page || '#'],
        ['Versão',     fb.appVersion || '?'],
      ]},
    ],
    cta:          { url: 'https://primetour.github.io/tarefas/#system-feedback', label: 'Ver no sistema' },
    footerNote:   'Email disparado quando um usuário envia feedback pela Governança ou pelo botão "Enviar Sugestão". Responder em /system-feedback.',
    variant:      VARIANT_BY_TYPE[fb.type] || 'default',
    productLabel: 'Sistema',
  });
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

/* ═══════════════════════════════════════════════════════════════
   onNotificationCreate (4.35.26+) — Firestore trigger que envia
   email pro destinatário quando uma notif é criada, se ele optou
   por receber esse tipo via email em users/{uid}.prefs.emailNotifications.

   Defaults conservadores (se user nunca configurou):
     types[type] === undefined → não envia
     Sempre exige prefs.emailNotifications.enabled === true

   Rate-limit: max 20 emails/hora por user (anti-spam).
   ═══════════════════════════════════════════════════════════════ */
const EMAIL_RATE_LIMIT_PER_HOUR = 20;

export const onNotificationCreate = onDocumentCreated({
  document: 'notifications/{notifId}',
  region:   'us-central1',
  secrets:  [GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_SENDER_ID],
}, async (event) => {
  const notif = event.data?.data();
  if (!notif || !notif.recipientId || !notif.type) return;

  const notifId = event.params?.notifId;

  try {
    // 1) Carrega prefs + email do destinatário
    const userDoc = await db.collection('users').doc(notif.recipientId).get();
    if (!userDoc.exists) {
      console.log(`[onNotifCreate] user ${notif.recipientId} não existe — skip`);
      return;
    }
    const user = userDoc.data();
    const prefs = user.prefs?.emailNotifications;
    if (!prefs || prefs.enabled === false) {
      // Email global desligado
      return;
    }
    const typeEnabled = prefs.types?.[notif.type] === true;
    if (!typeEnabled) {
      console.log(`[onNotifCreate] type ${notif.type} não habilitado pro user ${notif.recipientId}`);
      return;
    }

    const toEmail = user.email || user.userEmail || null;
    if (!toEmail) {
      console.warn(`[onNotifCreate] user ${notif.recipientId} sem email`);
      return;
    }

    // 2) Rate limit (anti-spam)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentSnap = await db.collection('notifications')
      .where('recipientId', '==', notif.recipientId)
      .where('emailSentAt', '>=', oneHourAgo)
      .limit(EMAIL_RATE_LIMIT_PER_HOUR + 1)
      .get()
      .catch(() => ({ size: 0 }));
    if (recentSnap.size >= EMAIL_RATE_LIMIT_PER_HOUR) {
      console.warn(`[onNotifCreate] rate-limit hit pro user ${notif.recipientId} (${recentSnap.size}/${EMAIL_RATE_LIMIT_PER_HOUR}/h)`);
      // 4.40.21+ (security audit) — registra audit log do rate-limit pra
      // SIEM/forensics. Antes: return silencioso → ataque podia gerar 100+
      // notificações/h sem rastro. Agora logged + flag no doc da notif.
      try {
        await db.collection('audit_logs').add({
          action: 'notif.rate_limited',
          userId: 'system',
          entity: 'notification',
          entityId: notifId,
          severity: 'warning',
          details: {
            recipientId: notif.recipientId,
            type: notif.type,
            recentCount: recentSnap.size,
            limit: EMAIL_RATE_LIMIT_PER_HOUR,
          },
          timestamp: FieldValue.serverTimestamp(),
        });
        // Marca no próprio doc da notif pra retornos futuros saberem
        await db.collection('notifications').doc(notifId).update({
          emailSkippedReason: 'rate_limit',
          emailSkippedAt: FieldValue.serverTimestamp(),
        });
      } catch (e) {
        console.warn('[onNotifCreate] failed to log rate-limit:', e.message);
      }
      return;
    }

    // 3) Renderiza email + envia
    const { subject, html } = buildNotificationEmail(notif);
    await sendEmailViaGraph({ to: toEmail, subject, html });

    // 4) Marca emailSentAt no doc (sem retrigger porque é update)
    await db.collection('notifications').doc(notifId).update({
      emailSentAt: FieldValue.serverTimestamp(),
    });

    console.log(`[onNotifCreate] email enviado pra ${toEmail} (type=${notif.type})`);
  } catch (e) {
    console.error('[onNotifCreate] falha:', e?.message || e);
    // Não relança — notif in-app já existe, falha do email não bloqueia
  }
});

/* ═══════════════════════════════════════════════════════════════
   v4.49.109+ ROTEIRO QUEUE — Background worker pra geração IA
   ═══════════════════════════════════════════════════════════════
   Resolve o problema de N usuários gerando roteiros simultaneamente:
   - Cliente cria doc em `roteiro_generations_queue/{id}` com
     { userId, briefingMessage, totalDias, useChunking }
   - Esta function (trigger onCreate) processa em background
   - maxInstances=5 + concurrency=1 → max 5 paralelos globais
   - Resto enfileira no Cloud Run (sem hit em Anthropic rate-limit)
   - Cliente escuta o doc via onSnapshot — vê fase atual, ETA, result.
   ═══════════════════════════════════════════════════════════════ */

export const processRoteiroQueue = onDocumentCreated({
  document: 'roteiro_generations_queue/{queueId}',
  secrets: [ANTHROPIC_API_KEY],
  timeoutSeconds: 540,   // 9min — cabe 3 fases de chunking pra 30 dias
  memory: '512MiB',
  maxInstances: 5,       // máx 5 workers paralelos GLOBAIS
  concurrency: 1,        // cada instance processa 1 doc por vez
  region: 'us-central1',
}, async (event) => {
  const queueId = event.params.queueId;
  const docRef  = db.collection('roteiro_generations_queue').doc(queueId);

  // CLAIM via transaction (idempotência se trigger refire em redeploy)
  const claimed = await db.runTransaction(async tx => {
    const snap = await tx.get(docRef);
    if (!snap.exists) return null;
    const data = snap.data();
    if (data.status !== 'queued') return null; // outro worker já pegou
    tx.update(docRef, {
      status: 'processing',
      claimedAt: FieldValue.serverTimestamp(),
      workerId: 'cf-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    });
    return { id: queueId, ...data };
  });
  if (!claimed) {
    console.log(`[processRoteiroQueue] ${queueId} já claimed/done — skip.`);
    return;
  }

  console.log(`[processRoteiroQueue] ${queueId} claimed (user=${claimed.userId}, dias=${claimed.totalDias}, chunking=${claimed.useChunking})`);

  try {
    const agentSnap = await db.collection('ai_agents').doc('roteiros-luxo-gen').get();
    if (!agentSnap.exists) throw new Error('Agente roteiros-luxo-gen não encontrado');
    const agent = agentSnap.data();
    if (!agent.active) throw new Error('Agente está pausado');

    const apiKey = ANTHROPIC_API_KEY.value();
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');

    const baseParams = {
      model: agent.model || 'claude-sonnet-4-5',
      systemPrompt: agent.systemPrompt,
      maxTokens: agent.limits?.maxTokensPerRun || 16000,
      temperature: agent.limits?.temperature ?? 0.5,
      history: [],
      attachments: [],
      webSearch: agent.allowWebSearch === true,
      allowedDomains: agent.allowedSites || [],
      webSearchMaxUses: agent.webSearchMaxUses || 5,
    };

    let result;
    if (claimed.useChunking && claimed.totalDias > 14) {
      result = await _processChunkedAnthropic(claimed, apiKey, baseParams, docRef);
    } else {
      await docRef.update({ phase: 'single', progress: { current: 1, total: 1 } });
      result = await callAnthropic(apiKey, { ...baseParams, userMessage: claimed.briefingMessage });
    }

    await docRef.update({
      status: 'done',
      phase: null,
      completedAt: FieldValue.serverTimestamp(),
      result: {
        text: result.text,
        inputTokens: result.inputTokens || 0,
        outputTokens: result.outputTokens || 0,
        cacheReadTokens: result.cacheReadTokens || 0,
        cacheCreationTokens: result.cacheCreationTokens || 0,
        webSearchCount: result.webSearchCount || 0,
        webSearchResults: result.webSearchResults || [],
        webSearchQueries: result.webSearchQueries || [],
        citations: result.citations || [],
        phases: result.phases || 1,
      },
    });
    console.log(`[processRoteiroQueue] ${queueId} done (in=${result.inputTokens} out=${result.outputTokens} cacheRead=${result.cacheReadTokens||0})`);

    // v4.50.1+ Registra em ai_usage_logs (mesmo formato do callLLM)
    // pra IA Hub agregar custo + métricas do Gerador de Roteiros.
    try {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 90);
      const cacheReadTokens = result.cacheReadTokens || 0;
      await db.collection('ai_usage_logs').add({
        userId: claimed.userId,
        agentId: 'roteiros-luxo-gen',
        agentName: 'Gerador de Roteiros (Luxo)',
        module: 'roteiros',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        inputTokens:          result.inputTokens || 0,
        outputTokens:         result.outputTokens || 0,
        cacheCreationTokens:  result.cacheCreationTokens || 0,
        cacheReadTokens,
        tokensSaved:          Math.round(cacheReadTokens * 0.7),
        cacheHit:             cacheReadTokens > 0,
        webSearchCount:       result.webSearchCount || 0,
        timestamp: FieldValue.serverTimestamp(),
        expiresAt,
        source: 'cf-processRoteiroQueue',
        queueId,
        roteiroId: claimed.roteiroId || null,  // v4.57.34 R6: rastreabilidade pra cleanup em deleteRoteiro
        phases: result.phases || 1,
      });
    } catch (logErr) { console.warn('[processRoteiroQueue] ai_usage_logs falhou (não bloqueia):', logErr.message); }

    // v4.57.37 R15: notifica user quando geração completa.
    // Antes: se user fecha aba antes do callback do onSnapshot, nunca sabia
    // que terminou. Notif fallback garante visibilidade ao reabrir o app.
    if (claimed.userId) {
      try {
        const expiresAtNotif = Timestamp.fromMillis(Date.now() + 30*24*60*60*1000);
        await db.collection('notifications').add({
          actorId:     'system',
          actorName:   'Sistema PRIMETOUR',
          recipientId: claimed.userId,
          type:        'roteiro.generation_complete',
          entityType:  'roteiro',
          entityId:    claimed.roteiroId || queueId,
          title:       'Geração de roteiro concluída',
          body:        `Seu roteiro foi gerado em ${result.phases || 1} fase(s). Abra o editor pra revisar.`,
          route:       claimed.roteiroId ? `roteiro-editor?id=${encodeURIComponent(claimed.roteiroId)}` : 'roteiros',
          priority:    'normal',
          category:    'roteiro',
          read:        false,
          readAt:      null,
          createdAt:   FieldValue.serverTimestamp(),
          expiresAt:   expiresAtNotif,
        });
      } catch (notifErr) { console.warn('[processRoteiroQueue] notif generation_complete falhou:', notifErr?.message); }
    }

  } catch (err) {
    console.error(`[processRoteiroQueue] ${queueId} failed:`, err?.message || err);
    // v4.57.38 R3: classifica erro pra UI mostrar "Tentar de novo" vs "Editar prompt".
    // Antes: client só via 'failed' + texto livre, sem distinguir transiente vs permanente.
    const errMsg = String(err?.message || err);
    let errorCode = 'unknown';
    let isRetryable = false;
    if (/rate.?limit|429|too many requests/i.test(errMsg)) { errorCode = 'rate_limit'; isRetryable = true; }
    else if (/max.?tokens|token.?limit|context length|exceeds/i.test(errMsg)) { errorCode = 'token_limit'; isRetryable = false; }
    else if (/timeout|deadline.?exceeded|timed out/i.test(errMsg)) { errorCode = 'timeout'; isRetryable = true; }
    else if (/network|fetch failed|ECONN|ENOTFOUND|socket/i.test(errMsg)) { errorCode = 'network'; isRetryable = true; }
    else if (/JSON inválido|JSON parse|Unexpected token/i.test(errMsg)) { errorCode = 'invalid_output'; isRetryable = true; }
    else if (/api.?key|unauthorized|401|403/i.test(errMsg)) { errorCode = 'auth'; isRetryable = false; }
    else if (/agent.*não encontrado|agent.*pausado/i.test(errMsg)) { errorCode = 'agent_config'; isRetryable = false; }
    await docRef.update({
      status: 'failed',
      phase: null,
      completedAt: FieldValue.serverTimestamp(),
      error: errMsg.slice(0, 1000),
      errorCode,
      isRetryable,
    });
  }
});

/** Helper: chunking server-side. */
async function _processChunkedAnthropic(queueData, apiKey, baseParams, docRef) {
  const { briefingMessage, totalDias } = queueData;
  const CHUNK_SIZE = 10;
  const totalChunks = Math.ceil(totalDias / CHUNK_SIZE);
  const totalPhases = 1 + totalChunks;

  await docRef.update({ phase: 'skeleton', progress: { current: 1, total: totalPhases } });
  const skeletonMsg = `${briefingMessage}\n\n## ⚙ MODO CHUNKING — FASE 1 DE ${totalPhases}: ESQUELETO\n\nEste briefing tem ${totalDias} dias. Pra evitar truncamento, gerar em fases.\n\n**NESTA FASE, GERE APENAS o JSON com estes campos (OMITA \`days\`):**\n- title, narrative_overview, destination_suggestions (se modo sugestão), destinations, hotels (lista COMPLETA), includes, excludes, consultant_notes, sources_consulted.\n\n**NÃO inclua \`days\` neste output.** Será gerado em fases separadas. JSON válido. Sem markdown fences.`;
  const skeletonResult = await callAnthropic(apiKey, { ...baseParams, userMessage: skeletonMsg });
  const skeleton = _safeParseJSON(skeletonResult.text);
  if (!skeleton) throw new Error('Fase 1 (esqueleto) — JSON inválido');

  const allDays = [];
  let totalInputTokens = skeletonResult.inputTokens || 0;
  let totalOutputTokens = skeletonResult.outputTokens || 0;
  let totalCacheRead = skeletonResult.cacheReadTokens || 0;
  let totalCacheCreation = skeletonResult.cacheCreationTokens || 0;
  let totalWebSearches = skeletonResult.webSearchCount || 0;
  const allCitations = [...(skeletonResult.citations || [])];
  const allWebResults = [...(skeletonResult.webSearchResults || [])];
  const allWebQueries = [...(skeletonResult.webSearchQueries || [])];

  for (let i = 0; i < totalChunks; i++) {
    const startDay = i * CHUNK_SIZE + 1;
    const endDay = Math.min(startDay + CHUNK_SIZE - 1, totalDias);
    await docRef.update({
      phase: `days_${startDay}_${endDay}`,
      progress: { current: i + 2, total: totalPhases },
    });

    const skeletonRef = {
      title: skeleton.title,
      destinations: skeleton.destinations,
      hotels: (skeleton.hotels || []).map(h => ({
        city: h.city, hotel_name: h.hotel_name,
        check_in_day: h.check_in_day, check_out_day: h.check_out_day, nights: h.nights,
      })),
    };
    const prevDaysRef = allDays.length
      ? `\n\n**Dias já gerados (pra continuidade):**\n${allDays.map(d => `- Dia ${d.day_number} (${d.city}): ${d.title}`).join('\n')}`
      : '';

    const daysMsg = `${briefingMessage}\n\n## ⚙ MODO CHUNKING — FASE ${i + 2} DE ${totalPhases}: DIAS ${startDay}-${endDay}\n\n**Esqueleto do roteiro (referência):**\n\`\`\`json\n${JSON.stringify(skeletonRef, null, 2)}\n\`\`\`${prevDaysRef}\n\n**GERE APENAS os dias ${startDay} a ${endDay}** mantendo coerência com o esqueleto.\n\nRetorne JSON com APENAS:\n\`\`\`json\n{\n  "days": [{"day_number": ${startDay}, "city": "...", "title": "...", "narrative": "...", "overnight_city": "...", "activities": [...]}, ...]\n}\n\`\`\`\n\nSem markdown fences no output. JSON válido. Apenas o array \`days\`.`;

    const chunkResult = await callAnthropic(apiKey, { ...baseParams, userMessage: daysMsg });
    const chunkData = _safeParseJSON(chunkResult.text);
    if (chunkData?.days && Array.isArray(chunkData.days)) {
      allDays.push(...chunkData.days);
    } else {
      console.warn(`[_processChunkedAnthropic] chunk ${i+1} retornou days inválido — fortemente ignorando`);
    }

    totalInputTokens += chunkResult.inputTokens || 0;
    totalOutputTokens += chunkResult.outputTokens || 0;
    totalCacheRead += chunkResult.cacheReadTokens || 0;
    totalCacheCreation += chunkResult.cacheCreationTokens || 0;
    totalWebSearches += chunkResult.webSearchCount || 0;
    allCitations.push(...(chunkResult.citations || []));
    allWebResults.push(...(chunkResult.webSearchResults || []));
    allWebQueries.push(...(chunkResult.webSearchQueries || []));
  }

  const merged = { ...skeleton, days: allDays };
  return {
    text: JSON.stringify(merged),
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    cacheReadTokens: totalCacheRead,
    cacheCreationTokens: totalCacheCreation,
    webSearchCount: totalWebSearches,
    webSearchResults: allWebResults,
    webSearchQueries: allWebQueries,
    citations: allCitations,
    phases: totalPhases,
  };
}

function _safeParseJSON(rawText) {
  try {
    const cleaned = String(rawText || '').replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end < 0) return null;
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    console.warn('[_safeParseJSON] falhou:', e?.message);
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * importRoteiroBankPdf (v4.50.0+) — Banco de Roteiros
 *
 * Recebe um PDF (base64) de um roteiro curado (estilo "Classic Collection")
 * e extrai estrutura JSON via Anthropic Claude multimodal (PDF document
 * content block). Grava em `roteiros_bank` com status='review'.
 *
 * Input  : { pdfBase64: string, filename: string, autoApprove?: boolean }
 * Output : { docId: string, parsed: object, tokensUsed: { input, output } }
 *
 * Permissão: canManageDestinations (mesma regra do banco — coerente).
 * ═══════════════════════════════════════════════════════════════════════ */
export const importRoteiroBankPdf = onCall({
  region: 'us-central1',
  timeoutSeconds: 540,         // 9min — Claude lê PDF inteiro
  memory: '512MiB',
  secrets: [ANTHROPIC_API_KEY],
}, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Login obrigatório.');
  const { pdfBase64, filename, autoApprove = false } = req.data || {};
  if (!pdfBase64) throw new HttpsError('invalid-argument', 'pdfBase64 obrigatório.');
  if (pdfBase64.length > 35_000_000) {
    throw new HttpsError('invalid-argument', 'PDF muito grande (>25MB base64).');
  }

  // v4.57.36 fix integração R9: distributed lock pra evitar import duplo.
  // Cenário antes: UI retry se 1ª chamada demorar (timeout cliente, conexão
  // ruim). 2ª chamada chega na CF, parseia o MESMO PDF e grava 2 docs
  // no banco. Lock: doc em `import_locks/{fileHash}` com TTL 10min.
  // Fingerprint = primeiros + últimos 1024 chars do base64 (estável, cheap).
  const fingerprint = (pdfBase64.slice(0, 1024) + ':' + pdfBase64.slice(-1024)).length > 100
    ? require('crypto').createHash('sha256').update(pdfBase64.slice(0, 2048) + pdfBase64.slice(-2048)).digest('hex').slice(0, 24)
    : 'unknown';
  const lockRef = db.collection('import_locks').doc(`pdf_${fingerprint}`);
  const lockTTLMs = 10 * 60 * 1000;
  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(lockRef);
      if (snap.exists) {
        const lockedAt = snap.data()?.lockedAt?.toMillis?.() || 0;
        if (Date.now() - lockedAt < lockTTLMs) {
          throw new HttpsError('already-exists',
            `Este PDF já está sendo importado (lock ativo). Aguarde ~5min e tente novamente, ou contate suporte se persistir.`);
        }
      }
      tx.set(lockRef, {
        lockedAt: FieldValue.serverTimestamp(),
        lockedBy: req.auth.uid,
        filename: filename || 'unknown',
      });
    });
  } catch (lockErr) {
    if (lockErr instanceof HttpsError) throw lockErr;
    console.warn('[importRoteiroBankPdf] lock fail (best-effort, prosseguindo):', lockErr?.message);
  }

  // Verifica permissão via custom claims OU role doc
  // v4.57.50: permissions é OBJETO {key:bool}, não array (descoberto em E2E)
  const uid = req.auth.uid;
  let canImport = false;
  try {
    const u = await db.collection('users').doc(uid).get();
    if (u.exists) {
      const ud = u.data();
      const role = ud?.role || ud?.roleId;
      if (ud?.isMaster === true || role === 'master') {
        canImport = true;
      } else if (role) {
        const r = await db.collection('roles').doc(role).get();
        if (r.exists) {
          const rd = r.data();
          const perms = rd?.permissions || {};
          // SECURITY (audit 4.63.95): removido `|| rd.isSystem` — TODAS as roles
          // têm isSystem===true, era bypass total. master já passa acima.
          canImport = perms.portal_destinations_manage === true
                   || perms.portal_manage === true;
        }
      }
    }
  } catch (e) { /* default false */ }
  if (!canImport) throw new HttpsError('permission-denied', 'Sem permissão pra importar.');

  const extractPrompt = `
Você é um extrator estruturado de roteiros de viagem curados da PRIMETOUR (agência de luxo brasileira).

O PDF anexado contém UM roteiro completo no formato "Classic Collection" (estrutura típica:
título, narrativa de capa, dia-a-dia, valores parte terrestre com múltiplas categorias de
hospedagem, inclui/não inclui, formas de pagamento, cancelamento, documentação).

Extraia TUDO em JSON estrito, conformando AO SCHEMA ABAIXO. Não invente dados — só inclua
o que estiver explícito no PDF. Use null/array vazio quando não houver informação.

SCHEMA OBRIGATÓRIO:
{
  "title": string,                         // ex: "Classic Collection: China e Tibete"
  "subtitle": string,                      // opcional
  "shortDescription": string,              // narrativa de capa (1-2 parágrafos)
  "longDescription": string,               // opcional, mais detalhada se houver
  "collectionLabel": string,               // ex: "Classic" (deduzir do título/cabeçalho)

  "geo": {
    "continents": [string],                // ex: ["Ásia"]
    "countries":  [string],                // ex: ["China", "Tibete"]
    "cities": [                            // SEQUÊNCIA das cidades no roteiro
      { "city": string, "country": string, "continent": string, "nights": number }
    ]
  },

  "durationDays":   number,                // total (chegada + saída)
  "durationNights": number,                // soma das noites

  "days": [                                // dia-a-dia sugerido
    {
      "dayNumber": number,
      "city": string,                      // cidade principal do dia (ou "X - Y" se trecho)
      "title": string,                     // título curto do dia
      "narrative": string,                 // texto completo do dia
      "overnightCity": string,             // onde pernoita (vazio no último dia se voo de saída)
      "flightLeg": boolean                 // true se há voo interno no dia
    }
  ],

  "categories": [                          // categorias de hospedagem (Sugestão Prime, Luxo, etc.)
    {
      "key": string,                       // slug: 'sugestao-prime', 'luxo', 'luxo-standard', 'luxo-moderado'
      "label": string,                     // como aparece no PDF
      "hotels": [
        { "city": string, "name": string, "roomType": string, "nights": number, "supplierUrl": string }
      ],
      "pricing": [
        {
          "period": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
          "single": number,                // valor single (por pessoa)
          "double": number,                // valor duplo (por pessoa)
          "currency": "USD" | "BRL" | "EUR"
        }
      ],
      "notes": string
    }
  ],

  "includes": {                            // o que ESTÁ incluso (buckets)
    "hospedagem":   [string],
    "traslados":    [string],
    "passeios":     [string],
    "assistencia":  [string],              // recepção em aeroporto, etc.
    "aereoInterno": [string],
    "trem":         [string],
    "outros":       [string]
  },
  "excludes": [string],                    // o que NÃO está incluso

  "payment": {
    "terrestrial": string,                 // forma pagamento parte terrestre
    "aerial":      string,                 // forma pagamento parte aérea
    "deposit":  { "amount": number, "currency": "USD"|"BRL"|"EUR", "perPerson": boolean, "notes": string },
    "settlement":  string                  // prazo final pagamento
  },

  "cancellation": [                        // escala de cancelamento
    { "fromDays": number, "multaPercent": number, "notes": string }
  ],

  "documentation": {
    "passport": string,
    "minors":   string,
    "visas":    [ { "country": string, "required": boolean, "notes": string } ],
    "vaccines": string
  },

  "travelNotes": [string],                 // bullets de notas (clima, altitude, observações)

  "tags": [string]                         // 3-6 tags semânticas (ex: ["cultural", "espiritual", "unesco", "asia"])
}

REGRAS DE OURO:
1. Retorne APENAS JSON válido, sem fences markdown, sem comentários.
2. Datas no formato ISO YYYY-MM-DD. Se o PDF disser "01/01/2020 a 30/04/2020", converta.
3. Valores numéricos sem prefixo de moeda (a moeda fica no campo "currency").
4. "key" das categorias use slug: "sugestao-prime", "luxo", "luxo-standard", "luxo-moderado".
   Se aparecer categoria nova, crie slug equivalente.
5. cities[].nights deve REFLETIR exatamente o que o PDF diz pra cada cidade — soma de nights
   deve bater com durationNights.
6. Tags em português, lowercase, sem espaço.
7. Se um campo não aparecer no PDF, use null (string) / 0 (number) / [] (array). Não pule chaves.
`.trim();

  const apiKey = ANTHROPIC_API_KEY.value();
  if (!apiKey) throw new HttpsError('failed-precondition', 'ANTHROPIC_API_KEY missing.');

  const reqBody = {
    model: 'claude-sonnet-4-5',
    max_tokens: 16000,
    temperature: 0.1,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: extractPrompt },
      ],
    }],
  };

  console.log(`[importRoteiroBankPdf] user=${uid} file=${filename} pdfSizeKB=${Math.round(pdfBase64.length/1024)}`);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(reqBody),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('[importRoteiroBankPdf] Anthropic error:', res.status, err);
    throw new HttpsError('internal', `Anthropic ${res.status}: ${err.slice(0, 300)}`);
  }
  const d = await res.json();
  const text = (d.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('\n');
  const inputTokens  = d.usage?.input_tokens  || 0;
  const outputTokens = d.usage?.output_tokens || 0;

  // Parse JSON defensivo
  let parsed;
  try {
    const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const start = cleaned.indexOf('{');
    const end   = cleaned.lastIndexOf('}');
    if (start < 0 || end < 0) throw new Error('JSON não encontrado no output');
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    console.error('[importRoteiroBankPdf] parse falhou:', e.message, 'raw:', text.slice(0, 500));
    throw new HttpsError('internal', `Falha ao parsear JSON do LLM: ${e.message}`);
  }

  // Monta o doc final pra Firestore (alinhado a emptyRoteiroBank)
  const now = FieldValue.serverTimestamp();
  const finalStatus = autoApprove ? 'approved' : 'review';
  const docData = {
    ...parsed,
    status: finalStatus,
    source: {
      type: 'pdf_import',
      originalFile: filename || 'unknown.pdf',
      importedAt: now,
      importedBy: uid,
      llmTokens: { input: inputTokens, output: outputTokens },
    },
    createdAt: now,
    createdBy: uid,
    updatedAt: now,
    updatedBy: uid,
    ...(finalStatus === 'approved' ? { approvedAt: now, approvedBy: uid } : {}),
  };

  // Gera slug e code se não vieram do LLM
  const slugify = (s) => String(s||'').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  docData.slug = slugify(parsed.title || filename || 'roteiro');
  docData.code = `${(parsed.collectionLabel||'BNK').slice(0,3).toUpperCase()}-${(parsed.title||'NEW').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0,3).map(w=>w.slice(0,3)).join('') || 'NEW'}`;

  const ref = db.collection('roteiros_bank').doc();
  await ref.set(docData);
  console.log(`[importRoteiroBankPdf] doc criado: ${ref.id} status=${finalStatus} tokens in/out=${inputTokens}/${outputTokens}`);

  // v4.50.1+ Registra em ai_usage_logs pra IA Hub agregar custo.
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);
    await db.collection('ai_usage_logs').add({
      userId: uid,
      agentId: 'roteiro-bank-import',
      agentName: 'Import PDF Banco de Roteiros',
      module: 'banco-roteiros',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      inputTokens,
      outputTokens,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      tokensSaved: 0,
      cacheHit: false,
      webSearchCount: 0,
      timestamp: FieldValue.serverTimestamp(),
      expiresAt,
      source: 'cf-importRoteiroBankPdf',
      bankDocId: ref.id,
      filename: filename || 'unknown.pdf',
    });
  } catch (logErr) { console.warn('[importRoteiroBankPdf] ai_usage_logs falhou:', logErr.message); }

  // v4.57.36 R9: libera lock após sucesso (best-effort)
  try {
    await lockRef.delete();
  } catch (lockErr) { console.warn('[importRoteiroBankPdf] lock release falhou:', lockErr?.message); }

  return {
    docId: ref.id,
    parsed,
    tokensUsed: { input: inputTokens, output: outputTokens },
    status: finalStatus,
  };
});

/* ═════════════════════════════════════════════════════════════════
 * recurringTasksDailyCron — gera instâncias de templates recorrentes
 * Roda 06:00 BRT todos os dias. Equivalente server-side do
 * runDueRecurrenceGeneration() em js/services/recurringTasks.js.
 *
 * Motivação: a geração lazy client-side dependia de alguém abrir a
 * página de tarefas. Em finais de semana / férias do power-user o
 * sistema acumulava backlog e gerava tudo de uma vez na próxima
 * visita. Notificações de prazo disparavam tarde. (CLAUDE.md gap #4)
 *
 * Garantias:
 *  - Idempotência hard via ID determinístico `rec_${tplId}_${occISO}`
 *    (mesma estratégia do client; se rodada client gerou primeiro,
 *    CF detecta via getDoc e pula).
 *  - Limite MAX_INSTANCES_PER_RUN_PER_TPL (30) por template — espelha
 *    o cap client pra não criar 6 meses de backlog num único run.
 *  - Atualiza lastGeneratedFor pra avançar o cursor.
 *  - Audit log no fim com stats agregadas.
 *
 * Client-side runDueRecurrenceGeneration continua funcionando como
 * fallback — se CF falhar 1-2 dias, o primeiro user que abrir o app
 * gera o atrasado. Cinto-e-suspensório intencional.
 * ═════════════════════════════════════════════════════════════════ */
const RECUR_MAX_INSTANCES_PER_TPL = 30;
const RECUR_DEFAULT_MAX_MONTHS    = 12;
const RECUR_MAX_MONTHS            = 24;

function _recurToISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function _recurFromISO(s)    { return new Date(s + 'T12:00:00'); }
function _recurAddDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function _recurAddMonths(d, n) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }

function _recurEffectiveEndDate(template) {
  if (template.endDate) return _recurFromISO(template.endDate);
  const start = _recurFromISO(template.startDate);
  return _recurAddMonths(start, RECUR_DEFAULT_MAX_MONTHS);
}

function _recurComputeDueOccurrences(template, todayISO) {
  const start   = _recurFromISO(template.startDate);
  const end     = _recurEffectiveEndDate(template);
  const today   = _recurFromISO(todayISO);
  const lastGen = template.lastGeneratedFor ? _recurFromISO(template.lastGeneratedFor) : null;
  let cursor    = lastGen ? _recurAddDays(lastGen, 1) : new Date(start);
  if (cursor < start) cursor = new Date(start);

  const horizon = today < end ? today : end;

  const dates = [];
  let safety = 0;
  while (cursor <= horizon && safety < 400 && dates.length < RECUR_MAX_INSTANCES_PER_TPL) {
    safety++;
    let match = false;
    if (template.frequency === 'daily') {
      match = true;
    } else if (template.frequency === 'weekly') {
      match = Array.isArray(template.weekdays) && template.weekdays.includes(cursor.getDay());
    } else if (template.frequency === 'monthly') {
      const day = Number(template.monthDay) || 1;
      const lastDayOfMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      const targetDay = Math.min(day, lastDayOfMonth);
      match = cursor.getDate() === targetDay;
    } else if (template.frequency === 'custom') {
      const interval = Math.max(1, Number(template.intervalDays) || 1);
      const diffDays = Math.round((cursor - start) / (1000 * 60 * 60 * 24));
      match = diffDays >= 0 && (diffDays % interval) === 0;
    }
    if (match) dates.push(_recurToISO(cursor));
    cursor = _recurAddDays(cursor, 1);
  }
  return dates;
}

async function _recurInstanceExists(detId) {
  // Quick check via getDoc pelo ID determinístico (1 read).
  // Mais barato que query composta + dispensa índice.
  try {
    const snap = await db.collection('tasks').doc(detId).get();
    return snap.exists;
  } catch (e) {
    console.warn('[recurringTasksDailyCron] instance check failed:', e?.message);
    return false;  // best-effort: deixa create tentar (Firestore vai rejeitar se duplicate via setDoc)
  }
}

export const recurringTasksDailyCron = onSchedule({
  schedule: '0 6 * * *',           // 06:00 todos os dias
  timeZone: 'America/Sao_Paulo',
  timeoutSeconds: 540,
  memory: '256MiB',
  retryCount: 2,
}, async () => {
  const report = {
    templatesScanned: 0,
    templatesWithDue: 0,
    tasksCreated:     0,
    tasksSkippedExisting: 0,
    errors:           0,
    errorMessages:    [],
  };

  let templatesSnap;
  try {
    templatesSnap = await db.collection('recurring_task_templates')
      .where('active', '==', true)
      .get();
  } catch (e) {
    console.error('[recurringTasksDailyCron] FATAL: cant fetch templates:', e?.message);
    await db.collection('audit_logs').add({
      action: 'system.recurring_tasks_cron',
      userId: 'system',
      severity: 'critical',
      error: e?.message || String(e),
      timestamp: FieldValue.serverTimestamp(),
    });
    return;
  }

  const today = new Date();
  const todayISO = _recurToISO(today);
  report.templatesScanned = templatesSnap.size;

  for (const docSnap of templatesSnap.docs) {
    const template = { id: docSnap.id, ...docSnap.data() };

    let dates;
    try {
      dates = _recurComputeDueOccurrences(template, todayISO);
    } catch (e) {
      report.errors++;
      report.errorMessages.push(`tpl=${template.id} compute: ${e?.message}`);
      continue;
    }
    if (!dates.length) continue;
    report.templatesWithDue++;

    let lastCreatedFor = template.lastGeneratedFor || null;
    for (const occISO of dates) {
      const detId = `rec_${template.id}_${occISO}`;
      const exists = await _recurInstanceExists(detId);
      if (exists) {
        report.tasksSkippedExisting++;
        if (!lastCreatedFor || occISO > lastCreatedFor) lastCreatedFor = occISO;
        continue;
      }

      const occDate = _recurFromISO(occISO);
      const base = template.taskData || {};
      const offset = Number(template.dueOffsetDays) || 0;
      // SLA do tipo NÃO é resolvido aqui (calcSla é client-side e depende
      // do store de taskTypes). Quando o offset > 0, aplica como fallback;
      // quando offset = 0, deixa dueDate null e cliente recalcula via SLA
      // na primeira renderização (taskTypes carrega async).
      const dueDate = offset > 0 ? _recurAddDays(occDate, offset) : null;

      const taskDoc = {
        // Espelha taskData do template
        title:            base.title || 'Tarefa recorrente',
        description:      base.description || '',
        status:           'not_started',
        priority:         base.priority || 'medium',
        projectId:        base.projectId || null,
        assignees:        Array.isArray(base.assignees) ? base.assignees : [],
        observers:        Array.isArray(base.observers) ? base.observers : [],
        isPartnership:    !!base.isPartnership,
        tags:             Array.isArray(base.tags)    ? base.tags    : [],
        nucleos:          Array.isArray(base.nucleos) ? base.nucleos : [],
        startDate:        occDate,
        dueDate:          dueDate,
        typeId:           base.typeId         || null,
        variationId:      base.variationId    || null,
        variationName:    base.variationName  || '',
        variationSLADays: base.variationSLADays != null ? base.variationSLADays : null,
        sector:           base.sector || null,
        workspaceId:      base.workspaceId || null,
        customFields:     base.customFields || {},
        type:             base.type || '',
        newsletterStatus: '',
        requestingArea:   base.requestingArea || '',
        clientEmail:      base.clientEmail || '',
        outOfCalendar:    !!base.outOfCalendar,
        deliveryLink:     '',
        // Rastreabilidade
        recurringFromTemplateId: template.id,
        recurringOccurrence:     occISO,
        subtasks:    [],
        comments:    [],
        attachments: [],
        order:       Date.now(),
        completedAt: null,
        metaLinks:   Array.isArray(base.metaLinks) ? base.metaLinks : [],
        goalId:      base.goalId || null,
        goalMetaRef: base.goalMetaRef || null,
        periodoRef:  '',
        linkComprovacao: '',
        confirmadaEvidencia: false,
        sourceRequestId:  null,
        sourceNewsId:     null,
        requesterEditFlag: false,
        requesterEditAt:   null,
        requesterEditChanges: '',
        // Atribui criação ao próprio criador do template (preserva accountability)
        createdAt:   FieldValue.serverTimestamp(),
        createdBy:   template.createdBy || 'system',
        updatedAt:   FieldValue.serverTimestamp(),
        updatedBy:   template.createdBy || 'system',
        // Flag de origem pra diferenciar de tasks criadas no client lazy
        recurringSource: 'cf-cron',
      };

      try {
        // setDoc com merge:false — Firestore garante uniqueness por docId.
        // Se outro processo (client lazy concorrente) criou primeiro com o
        // mesmo detId, getDoc anterior teria detectado. Race window pequena.
        await db.collection('tasks').doc(detId).set(taskDoc);
        report.tasksCreated++;
        lastCreatedFor = occISO;

        // Audit log da criação (espelha tasks.create do client)
        await db.collection('audit_logs').add({
          action: 'tasks.create',
          userId: 'system',
          actorName: 'Sistema (recurring cron)',
          entityType: 'task',
          entityId: detId,
          details: { title: taskDoc.title, source: 'cf-recurring-tasks', templateId: template.id, occISO },
          timestamp: FieldValue.serverTimestamp(),
          severity: 'info',
        }).catch(() => {});
      } catch (e) {
        report.errors++;
        report.errorMessages.push(`tpl=${template.id} occ=${occISO}: ${e?.message}`);
      }
    }

    if (lastCreatedFor && lastCreatedFor !== template.lastGeneratedFor) {
      try {
        await db.collection('recurring_task_templates').doc(template.id).update({
          lastGeneratedFor: lastCreatedFor,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } catch (e) {
        console.warn(`[recurringTasksDailyCron] update lastGen failed tpl=${template.id}:`, e?.message);
      }
    }
  }

  await db.collection('audit_logs').add({
    action: 'system.recurring_tasks_cron',
    userId: 'system',
    severity: report.errors > 0 ? 'warning' : 'info',
    ...report,
    errorMessages: report.errorMessages.slice(0, 5),  // cap pra não inchar
    timestamp: FieldValue.serverTimestamp(),
  });

  console.log(`[recurringTasksDailyCron] done:`, JSON.stringify(report));
});

/* ═════════════════════════════════════════════════════════════════
 * scheduledNotificationsCron — gera notifs do sistema (SLA, stale,
 * deadline approaching, daily summary) com actorId='system'.
 *
 * Fecha gap #7 da auditoria de integrações: antes os 4 services
 * (slaAlerts/staleTaskNudge/notificationScheduler/dailySummary)
 * rodavam client-side e atribuíam actorId = user logado primeiro.
 * Resultado: filtro "minhas notifs disparadas" virava lixo + se
 * ninguém abrisse o app, alerta não saía.
 *
 * Roda 7h BRT todo dia. Lê tasks + users uma vez, agrupa por
 * stakeholder, escreve notif batch com Admin SDK (bypassa rule
 * actorId == auth.uid).
 *
 * Client-side wrappers (slaAlerts.js etc.) ficam DESABILITADOS no
 * boot do app (commit junto desta CF). Mantém código pra ressuscitar
 * como fallback se a CF se mostrar instável.
 * ═════════════════════════════════════════════════════════════════ */
const SYSTEM_ACTOR_ID    = 'system';
const SYSTEM_ACTOR_NAME  = 'Sistema PRIMETOUR';
const ACTIVE_STATUSES    = ['not_started', 'in_progress', 'review', 'approval', 'validation', 'rework'];
const STALE_IN_PROGRESS  = 5;   // dias
const STALE_REVIEW       = 3;
const STALE_NOT_STARTED  = 7;
const APPROACHING_HOURS  = 48;
const NOTIF_TTL_DAYS     = 30;

function _notifDueISO(val) {
  if (!val) return '';
  let d;
  if (val?.toDate) d = val.toDate();
  else if (val instanceof Date) d = val;
  else if (typeof val === 'string') {
    const m = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    d = new Date(val);
  } else if (typeof val === 'number') d = new Date(val);
  else return '';
  if (!d || isNaN(d.getTime())) return '';
  const y = d.getFullYear(), mo = String(d.getMonth()+1).padStart(2,'0'), da = String(d.getDate()).padStart(2,'0');
  return `${y}-${mo}-${da}`;
}

function _ymd(d) {
  const y = d.getFullYear(), mo = String(d.getMonth()+1).padStart(2,'0'), da = String(d.getDate()).padStart(2,'0');
  return `${y}-${mo}-${da}`;
}

function _writeNotifBatch(batch, recipientId, payload, now, expiresAt) {
  const docRef = db.collection('notifications').doc();
  batch.set(docRef, {
    actorId:     SYSTEM_ACTOR_ID,
    actorName:   SYSTEM_ACTOR_NAME,
    recipientId,
    read:        false,
    readAt:      null,
    createdAt:   now,
    expiresAt,
    ...payload,
  });
  return docRef.id;
}

export const scheduledNotificationsCron = onSchedule({
  schedule: '0 7 * * *',          // 7h BRT todo dia
  timeZone: 'America/Sao_Paulo',
  timeoutSeconds: 540,
  memory: '512MiB',
  retryCount: 1,
}, async () => {
  const stats = {
    usersScanned: 0,
    tasksScanned: 0,
    notifsCreated: 0,
    notifsByType: {},
    errors: 0,
  };

  // 1) Buscar tasks ativas (uma vez)
  let tasksSnap;
  try {
    tasksSnap = await db.collection('tasks')
      .where('status', 'in', ACTIVE_STATUSES)
      .limit(2000)
      .get();
  } catch (e) {
    console.error('[scheduledNotificationsCron] fail fetch tasks:', e?.message);
    return;
  }
  const tasks = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  stats.tasksScanned = tasks.length;

  // 2) Buscar users ativos (exclui pseudo-user 'system')
  let usersSnap;
  try {
    usersSnap = await db.collection('users').get();
  } catch (e) {
    console.error('[scheduledNotificationsCron] fail fetch users:', e?.message);
    return;
  }
  const users = usersSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(u => u.id !== SYSTEM_ACTOR_ID && u.active !== false);
  stats.usersScanned = users.length;

  const now = new Date();
  const todayStr    = _ymd(now);
  const tomorrowStr = _ymd(new Date(now.getTime() + 24*60*60*1000));
  const tsNow       = FieldValue.serverTimestamp();
  const expiresAt   = Timestamp.fromMillis(now.getTime() + NOTIF_TTL_DAYS*24*60*60*1000);

  let batch = db.batch();
  let batchOps = 0;
  const flushBatch = async () => {
    if (batchOps > 0) { await batch.commit(); batch = db.batch(); batchOps = 0; }
  };
  const trackType = (type) => { stats.notifsByType[type] = (stats.notifsByType[type] || 0) + 1; stats.notifsCreated++; };

  for (const user of users) {
    const uid = user.id;

    // Tasks onde o user é stakeholder
    const myTasks = tasks.filter(t => {
      const assignees = Array.isArray(t.assignees) ? t.assignees : [];
      const observers = Array.isArray(t.observers) ? t.observers : [];
      return t.createdBy === uid || assignees.includes(uid) || observers.includes(uid);
    });
    if (myTasks.length === 0) continue;

    // ── (a) SLA: overdue / today / tomorrow ──
    const overdue = [];
    const dueToday = [];
    const dueTomorrow = [];
    for (const t of myTasks) {
      if (!t.dueDate) continue;
      // Skip validation (SLA congelado v4.53.0)
      if (t.status === 'validation') continue;
      const due = _notifDueISO(t.dueDate);
      if (!due) continue;
      if (due < todayStr) overdue.push(t);
      else if (due === todayStr) dueToday.push(t);
      else if (due === tomorrowStr) dueTomorrow.push(t);
    }

    if (overdue.length > 0) {
      _writeNotifBatch(batch, uid, {
        type:        'task.sla_breach',
        entityType:  'system',
        entityId:    'sla-check',
        title:       `⚠ ${overdue.length} tarefa(s) com prazo vencido`,
        body:        overdue.slice(0,3).map(t => `"${t.title || t.id}"`).join(', ') + (overdue.length>3 ? ` e mais ${overdue.length-3}` : ''),
        route:       'tasks',
        priority:    'high',
        category:    'sla',
      }, tsNow, expiresAt);
      trackType('task.sla_breach'); batchOps++;
    }
    if (dueToday.length > 0) {
      _writeNotifBatch(batch, uid, {
        type:        'task.sla_today',
        entityType:  'system',
        entityId:    'sla-check',
        title:       `📅 ${dueToday.length} tarefa(s) vencem hoje`,
        body:        dueToday.slice(0,3).map(t => `"${t.title || t.id}"`).join(', '),
        route:       'tasks',
        priority:    'normal',
        category:    'sla',
      }, tsNow, expiresAt);
      trackType('task.sla_today'); batchOps++;
    }
    if (dueTomorrow.length > 0) {
      _writeNotifBatch(batch, uid, {
        type:        'task.sla_tomorrow',
        entityType:  'system',
        entityId:    'sla-check',
        title:       `🔔 ${dueTomorrow.length} tarefa(s) vencem amanhã`,
        body:        dueTomorrow.slice(0,3).map(t => `"${t.title || t.id}"`).join(', '),
        route:       'tasks',
        priority:    'normal',
        category:    'sla',
      }, tsNow, expiresAt);
      trackType('task.sla_tomorrow'); batchOps++;
    }

    // ── (b) Stale: tarefas paradas há N dias ──
    const stale = { inProgress: [], inReview: [], notStarted: [] };
    const nowMs = now.getTime();
    for (const t of myTasks) {
      if (!Array.isArray(t.assignees) || !t.assignees.includes(uid)) continue;  // nudge só assignee
      const updTs = t.updatedAt?.toDate?.() || (t.updatedAt?.seconds ? new Date(t.updatedAt.seconds*1000) : null);
      if (!updTs) continue;
      const days = Math.floor((nowMs - updTs.getTime()) / (24*60*60*1000));
      if (t.status === 'in_progress' && days >= STALE_IN_PROGRESS) stale.inProgress.push({...t, daysSince: days});
      else if (t.status === 'review' && days >= STALE_REVIEW)      stale.inReview.push({...t, daysSince: days});
      else if (t.status === 'not_started' && days >= STALE_NOT_STARTED) stale.notStarted.push({...t, daysSince: days});
    }

    if (stale.inProgress.length) {
      _writeNotifBatch(batch, uid, {
        type:        'task.stale',
        entityType:  'system',
        entityId:    'stale-check',
        title:       `${stale.inProgress.length} tarefa(s) parada(s) em "Em Andamento"`,
        body:        stale.inProgress.slice(0,3).map(t => `"${t.title}" (${t.daysSince}d)`).join(', '),
        route:       'tasks',
        category:    'productivity',
      }, tsNow, expiresAt);
      trackType('task.stale'); batchOps++;
    }
    if (stale.inReview.length) {
      _writeNotifBatch(batch, uid, {
        type:        'task.stale_review',
        entityType:  'system',
        entityId:    'stale-check',
        title:       `${stale.inReview.length} tarefa(s) aguardando revisão há dias`,
        body:        stale.inReview.slice(0,3).map(t => `"${t.title}" (${t.daysSince}d)`).join(', '),
        route:       'tasks',
        category:    'productivity',
      }, tsNow, expiresAt);
      trackType('task.stale_review'); batchOps++;
    }
    if (stale.notStarted.length) {
      _writeNotifBatch(batch, uid, {
        type:        'task.stale_not_started',
        entityType:  'system',
        entityId:    'stale-check',
        title:       `${stale.notStarted.length} tarefa(s) não iniciada(s) há ${stale.notStarted[0].daysSince}+ dias`,
        body:        stale.notStarted.slice(0,3).map(t => `"${t.title}"`).join(', '),
        route:       'tasks',
        category:    'productivity',
      }, tsNow, expiresAt);
      trackType('task.stale_not_started'); batchOps++;
    }

    // ── (c) Daily summary ──
    const myAssigneeTasks = myTasks.filter(t => Array.isArray(t.assignees) && t.assignees.includes(uid));
    if (myAssigneeTasks.length > 0) {
      const inProgress = myAssigneeTasks.filter(t => t.status === 'in_progress');
      const inReview   = myAssigneeTasks.filter(t => t.status === 'review');
      const parts = [];
      if (dueToday.length)  parts.push(`${dueToday.length} para hoje`);
      if (overdue.length)   parts.push(`${overdue.length} atrasada(s)`);
      if (inProgress.length) parts.push(`${inProgress.length} em andamento`);
      if (inReview.length)  parts.push(`${inReview.length} em revisão`);
      const body = parts.join(' · ') || `${myAssigneeTasks.length} tarefa(s) ativa(s)`;
      _writeNotifBatch(batch, uid, {
        type:        'system.daily_summary',
        entityType:  'system',
        entityId:    'daily-summary',
        title:       `Bom dia! Seu resumo: ${myAssigneeTasks.length} tarefa(s)`,
        body,
        route:       'dashboard',
        category:    'summary',
      }, tsNow, expiresAt);
      trackType('system.daily_summary'); batchOps++;
    }

    // ── (d) Deadline approaching (próximos 48h, dedup natural por daily run) ──
    for (const t of myTasks) {
      if (t.status === 'validation') continue;
      if (!t.dueDate) continue;
      const due = t.dueDate?.toDate?.() || new Date(t.dueDate);
      if (isNaN(due.getTime())) continue;
      const hoursUntilDue = (due - now) / (1000*60*60);
      // Já cobrimos overdue e sla_today/tomorrow acima. Approaching = 48h-24h window.
      if (hoursUntilDue > 24 && hoursUntilDue <= APPROACHING_HOURS) {
        const hoursLeft = Math.round(hoursUntilDue);
        const label = hoursLeft >= 24 ? `${Math.ceil(hoursLeft/24)} dia(s)` : `${hoursLeft}h`;
        _writeNotifBatch(batch, uid, {
          type:        'task.deadline_approaching',
          entityType:  'task',
          entityId:    t.id,
          title:       'Prazo próximo',
          body:        `"${t.title || t.id}" — vence em ${label}`,
          route:       'tasks',
          priority:    'normal',
          category:    'task',
        }, tsNow, expiresAt);
        trackType('task.deadline_approaching'); batchOps++;
      }
    }

    // Flush por safety a cada ~400 ops (limite Firestore 500/batch)
    if (batchOps >= 400) await flushBatch();
  }

  try {
    await flushBatch();
  } catch (e) {
    stats.errors++;
    console.error('[scheduledNotificationsCron] batch commit failed:', e?.message);
  }

  await db.collection('audit_logs').add({
    action: 'system.scheduled_notifications_cron',
    userId: 'system',
    severity: stats.errors > 0 ? 'warning' : 'info',
    ...stats,
    timestamp: FieldValue.serverTimestamp(),
  });

  console.log('[scheduledNotificationsCron] done:', JSON.stringify(stats));
});

/* ═════════════════════════════════════════════════════════════════
 * roteiroBankValidityCron — alerta curadores de roteiros do banco
 * expirados e arquiva automaticamente após 30d de expiração.
 *
 * Fecha gap R7 da auditoria Roteiros. Antes: roteiros_bank com
 * validity.endDate vencida só mostravam badge "Expirado" no UI mas
 * curador nunca era avisado. Banco enchia de docs stale + clientes
 * recebiam roteiro com hotel/preço desatualizado.
 *
 * Schedule: 0 8 * * * BRT (todo dia 8h).
 * Critério expirado: status='approved' && validity.endDate < hoje
 * Critério arquivar: expirado há > 30 dias E ainda 'approved'
 * ═════════════════════════════════════════════════════════════════ */
export const roteiroBankValidityCron = onSchedule({
  schedule: '0 8 * * *',
  timeZone: 'America/Sao_Paulo',
  timeoutSeconds: 540,
  memory: '256MiB',
  retryCount: 1,
}, async () => {
  const stats = { scanned: 0, expired: 0, autoArchived: 0, notifsSent: 0, errors: 0 };

  const todayISO = (() => {
    const d = new Date();
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), da = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${da}`;
  })();
  const cutoff30dAgo = new Date(Date.now() - 30*24*60*60*1000);
  const cutoff30dISO = (() => {
    const y = cutoff30dAgo.getFullYear(), m = String(cutoff30dAgo.getMonth()+1).padStart(2,'0'), da = String(cutoff30dAgo.getDate()).padStart(2,'0');
    return `${y}-${m}-${da}`;
  })();

  // Buscar aprovados com endDate setada (filtro client-side pra evitar índice composto)
  let snap;
  try {
    snap = await db.collection('roteiros_bank').where('status', '==', 'approved').get();
  } catch (e) {
    console.error('[roteiroBankValidityCron] fetch fail:', e?.message);
    return;
  }
  stats.scanned = snap.size;

  // Listar curadores pra notificar (master + roles com portal_destinations_manage)
  let curators = [];
  try {
    // v4.59.7 (CLAUDE.md §13.f) — filtro real por permissão `portal_destinations_manage`
    // ou `portal_manage`. Antes: `(u.role && true)` listava TODOS users como curators
    // → notif spam. Agora: users.isMaster=true OR role in ADMIN_ROLES OR
    // roles/{role}.permissions[key]=true (shape object {key:bool}, NÃO array — §13.f).
    const ADMIN_ROLES = ['master', 'admin', 'head'];
    const usersSnap = await db.collection('users').get();
    const candidates = usersSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => u.active !== false && u.id !== 'system');
    // Cache de roles pra evitar N reads
    const roleCache = new Map();
    async function userCanCurate(u) {
      if (u.isMaster === true) return true;
      const r = u.role || u.roleId;
      if (!r) return false;
      if (ADMIN_ROLES.includes(r)) return true;
      if (!roleCache.has(r)) {
        try {
          const rd = await db.collection('roles').doc(r).get();
          roleCache.set(r, rd.exists ? (rd.data() || {}) : null);
        } catch { roleCache.set(r, null); }
      }
      const rd = roleCache.get(r);
      if (!rd) return false;
      // SECURITY (audit 4.63.95): removido `if (rd.isSystem) return true` —
      // TODAS as roles têm isSystem===true, logo TODO user virava "curador" e
      // recebia notif de validade. ADMIN_ROLES já cobre master/admin/head acima.
      const perms = rd.permissions || {};   // OBJETO {key:bool}, não Array
      return perms.portal_destinations_manage === true
          || perms.portal_manage === true;
    }
    const filtered = [];
    for (const u of candidates) {
      if (await userCanCurate(u)) filtered.push(u.id);
    }
    curators = [...new Set(filtered)].slice(0, 50);
  } catch (e) {
    console.warn('[roteiroBankValidityCron] users fetch fail:', e?.message);
  }

  let batch = db.batch();
  let ops = 0;
  const flush = async () => { if (ops > 0) { await batch.commit(); batch = db.batch(); ops = 0; } };
  const tsNow = FieldValue.serverTimestamp();
  const expiresAt = Timestamp.fromMillis(Date.now() + 30*24*60*60*1000);

  for (const docSnap of snap.docs) {
    const doc = { id: docSnap.id, ...docSnap.data() };
    const endDate = doc.validity?.endDate;
    if (!endDate || typeof endDate !== 'string') continue;
    if (endDate >= todayISO) continue;  // ainda válido

    stats.expired++;
    const isOldExpired = endDate < cutoff30dISO;

    // Auto-archive se vencido há > 30d
    if (isOldExpired) {
      batch.update(docSnap.ref, {
        status: 'archived',
        archivedAt: tsNow,
        archivedReason: `auto-archive: vencido desde ${endDate} (>30d)`,
      });
      ops++;
      stats.autoArchived++;
    }

    // Notif curadores (dedup: 1 notif/curador/doc/mês via deterministic ID)
    if (curators.length) {
      const monthKey = todayISO.slice(0, 7);  // YYYY-MM
      for (const cid of curators) {
        const notifId = `bank_expired_${docSnap.id}_${cid}_${monthKey}`;
        // setDoc deterministic id evita duplicação cross-runs no mesmo mês
        batch.set(db.collection('notifications').doc(notifId), {
          actorId:     'system',
          actorName:   'Sistema PRIMETOUR',
          recipientId: cid,
          type:        'roteiro.bank_validity_expired',
          entityType:  'roteiro_bank',
          entityId:    docSnap.id,
          title:       isOldExpired ? '🗄 Roteiro do banco arquivado (vencido +30d)' : '⚠ Roteiro do banco vencido',
          body:        `"${doc.title || docSnap.id}" — validade ${endDate}${isOldExpired ? ' (arquivado automaticamente)' : ''}`,
          route:       'roteiro-bank',
          priority:    isOldExpired ? 'normal' : 'high',
          category:    'roteiro',
          read:        false,
          readAt:      null,
          createdAt:   tsNow,
          expiresAt,
        });
        ops++;
        stats.notifsSent++;
      }
    }

    if (ops >= 400) await flush();
  }

  try { await flush(); } catch (e) { stats.errors++; console.error('[roteiroBankValidityCron] commit fail:', e?.message); }

  await db.collection('audit_logs').add({
    action: 'system.roteiro_bank_validity_cron',
    userId: 'system',
    severity: stats.errors > 0 ? 'warning' : 'info',
    ...stats,
    timestamp: FieldValue.serverTimestamp(),
  });

  console.log('[roteiroBankValidityCron] done:', JSON.stringify(stats));
});

/* ═════════════════════════════════════════════════════════════════
 * onPortalTipUpdated — flag roteiros com embeddedTips stale.
 *
 * Fecha gap R13 da auditoria Roteiros. Antes: tips editadas no
 * portal nunca alertavam consultor sobre roteiros que tinham snapshot
 * dessa tip. UI mostra badge "Dica desatualizada" comparando
 * updatedAtSnapshot, mas nenhum painel agregava + nenhuma notif
 * proativa pro consultor.
 *
 * Trigger: portal_tips/{tipId} updated. Query inversa: roteiros com
 * embeddedTips.tipId == tipId. Update flag tipsStaleCount + grava
 * staleTipIds[] no roteiro (lista de tips desatualizadas).
 * ═════════════════════════════════════════════════════════════════ */
export const onPortalTipUpdated = onDocumentUpdated({
  document: 'portal_tips/{tipId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 120,
}, async (event) => {
  const tipId = event.params.tipId;
  const before = event.data?.before?.data?.();
  const after  = event.data?.after?.data?.();
  if (!before || !after) return;
  // Só dispara se conteúdo relevante mudou (não em updatedAt-only ticks)
  const contentFields = ['title', 'content', 'destinationId', 'gallery', 'highlights'];
  const changed = contentFields.some(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (!changed) return;

  // Query roteiros com essa tip embedded.
  // Firestore não suporta array-contains em campo aninhado de array de objetos,
  // então fazemos scan com filtro client-side (cap 500).
  let snap;
  try {
    snap = await db.collection('roteiros').limit(500).get();
  } catch (e) {
    console.error('[onPortalTipUpdated] fetch fail:', e?.message);
    return;
  }

  let batch = db.batch();
  let ops = 0;
  let affected = 0;

  for (const docSnap of snap.docs) {
    const r = docSnap.data();
    const embedded = Array.isArray(r.embeddedTips) ? r.embeddedTips : [];
    if (!embedded.some(t => t && t.tipId === tipId)) continue;

    const currentStale = Array.isArray(r.staleTipIds) ? r.staleTipIds : [];
    if (currentStale.includes(tipId)) continue;  // já marcado, skip

    batch.update(docSnap.ref, {
      staleTipIds: FieldValue.arrayUnion(tipId),
      tipsStaleAt: FieldValue.serverTimestamp(),
    });
    ops++;
    affected++;

    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  if (ops > 0) {
    try { await batch.commit(); } catch (e) {
      console.error('[onPortalTipUpdated] commit fail:', e?.message);
    }
  }

  if (affected > 0) {
    await db.collection('audit_logs').add({
      action: 'system.roteiro_tips_stale_flagged',
      userId: 'system',
      tipId,
      affectedRoteiros: affected,
      severity: 'info',
      timestamp: FieldValue.serverTimestamp(),
    });
  }

  console.log(`[onPortalTipUpdated] tip=${tipId} affected=${affected} roteiros`);
});

/* ═════════════════════════════════════════════════════════════════
 * portalImagesOrphanCleanupCron — detecta + sinaliza imagens não usadas.
 *
 * v4.57.42 (criado): cobria PD10 com auto-delete >30d.
 * v4.57.44 (revertido): REMOVIDO auto-delete. Decisão Renê 2026-05-25:
 *   "Banco de Imagens é repositório, não cache. Arquivos ficam
 *    independente de uso futuro, podem ser re-aproveitados a qualquer
 *    momento. CF apenas SINALIZA, nunca deleta."
 *
 * Schedule: 0 7 * * 1 (segunda 7h BRT, semanal).
 * Política atual:
 *  1. Pre-fetch refs vivas em portal_tips, portal_destinations, roteiros.
 *  2. Scan portal_images (cap 1000).
 *  3. Se imagem NÃO está em refs E ainda não tinha flag → marca
 *     `unused: true, unusedDetectedAt: <ts>`. UI mostra badge "Não
 *     usada atualmente" pro curador decidir manualmente.
 *  4. Se imagem voltou a ser usada (foi re-taggada) → remove flag.
 *  5. JAMAIS deleta doc nem blob R2. Hard-delete é exclusivamente
 *     manual via botão Excluir no card.
 *
 * Conservadorismo: scan cap 1000 por execução. Em produção grande,
 * virar batched (cursor pagination).
 * ═════════════════════════════════════════════════════════════════ */
export const portalImagesOrphanCleanupCron = onSchedule({
  schedule: '0 7 * * 1',           // segunda 7h BRT
  timeZone: 'America/Sao_Paulo',
  timeoutSeconds: 540,
  memory: '512MiB',
  retryCount: 1,
}, async () => {
  // v4.57.44 REVERSÃO: stats e cutoff30d removidos junto com auto-delete.
  // Banco de Imagens é repositório — só detecta+flag, nunca deleta.
  const stats = { scanned: 0, flaggedUnused: 0, errors: 0 };

  // 1. Pre-fetch all reference IDs (3 collections)
  const refs = new Set();
  try {
    const tipsSnap = await db.collection('portal_tips').limit(500).get();
    tipsSnap.forEach(d => {
      const t = d.data();
      const segs = Array.isArray(t.segments) ? t.segments : [];
      segs.forEach(seg => {
        const items = Array.isArray(seg?.items) ? seg.items : [];
        items.forEach(it => { if (it?.image?.imageId) refs.add(it.image.imageId); });
      });
    });
  } catch (e) { console.warn('[portalImagesOrphanCleanupCron] tips fetch fail:', e?.message); }

  try {
    const destSnap = await db.collection('portal_destinations').limit(1000).get();
    destSnap.forEach(d => {
      const dt = d.data();
      if (dt.heroImage?.imageId) refs.add(dt.heroImage.imageId);
    });
  } catch (e) { console.warn('[portalImagesOrphanCleanupCron] destinos fetch fail:', e?.message); }

  try {
    const rotSnap = await db.collection('roteiros').limit(500).get();
    rotSnap.forEach(d => {
      const r = d.data();
      const days = Array.isArray(r.days) ? r.days : [];
      days.forEach(day => {
        const ids = Array.isArray(day.imageIds) ? day.imageIds : [];
        ids.forEach(id => id && refs.add(id));
      });
    });
  } catch (e) { console.warn('[portalImagesOrphanCleanupCron] roteiros fetch fail:', e?.message); }

  // 2. Scan portal_images + classificar
  let imgSnap;
  try {
    imgSnap = await db.collection('portal_images').limit(1000).get();
  } catch (e) {
    console.error('[portalImagesOrphanCleanupCron] portal_images fetch fail:', e?.message);
    return;
  }
  stats.scanned = imgSnap.size;

  let batch = db.batch();
  let ops = 0;
  const flush = async () => { if (ops > 0) { await batch.commit(); batch = db.batch(); ops = 0; } };

  for (const docSnap of imgSnap.docs) {
    const img = docSnap.data();
    const isUsed = refs.has(docSnap.id);

    if (isUsed) {
      // Se estava flagged unused mas foi re-usada (raro), remove a flag
      if (img.unused) {
        batch.update(docSnap.ref, { unused: false, unusedDetectedAt: null });
        ops++;
      }
      continue;
    }

    // Não usada
    // v4.57.44 REVERSÃO: removido auto-delete após 30d. Banco de Imagens é
    // REPOSITÓRIO (não cache) — arquivos ficam independente de uso futuro,
    // podem ser re-aproveitados a qualquer momento. CF agora APENAS detecta
    // + sinaliza via flag `unused`. Curador decide manualmente se quer
    // arquivar/deletar pelo botão Excluir no card.
    // Decisão Renê 2026-05-25 após audit Banco de Imagens.
    if (!img.unused) {
      // Primeira detecção como órfã: flag + timestamp pra UI mostrar contexto
      // (badge "Não usada atualmente" no card)
      batch.update(docSnap.ref, {
        unused: true,
        unusedDetectedAt: FieldValue.serverTimestamp(),
      });
      ops++;
      stats.flaggedUnused++;
    }

    if (ops >= 400) await flush();
  }

  try { await flush(); } catch (e) { stats.errors++; console.error('[portalImagesOrphanCleanupCron] commit fail:', e?.message); }

  await db.collection('audit_logs').add({
    action: 'system.portal_images_orphan_cron',
    userId: 'system',
    severity: stats.errors > 0 ? 'warning' : 'info',
    ...stats,
    timestamp: FieldValue.serverTimestamp(),
  });

  console.log('[portalImagesOrphanCleanupCron] done:', JSON.stringify(stats));
});

/* ═════════════════════════════════════════════════════════════════
 * portalTipsStaleCheckCron — notifica curadores sobre tips sem revisão.
 *
 * Fecha gap PD11. Antes: tips ficavam meses sem revisão e ninguém
 * sabia. Conteúdo antigo desatualizando silenciosamente.
 *
 * Schedule: 0 8 * * 1 (segunda 8h BRT, semanal).
 * Política:
 *  - Tips com `updatedAt < now - 90d` E `status != archived` →
 *    flag `staleSince` + notif sumária semanal pra curadores
 *    (portal_manage OU portal_tips_manage).
 *  - Dedup por semana: deterministic notif ID
 *    `portal_tips_stale_{curatorId}_{YYYY-WW}` — re-runs na mesma
 *    semana não duplicam.
 * ═════════════════════════════════════════════════════════════════ */
export const portalTipsStaleCheckCron = onSchedule({
  schedule: '0 8 * * 1',           // segunda 8h BRT
  timeZone: 'America/Sao_Paulo',
  timeoutSeconds: 300,
  memory: '256MiB',
  retryCount: 1,
}, async () => {
  const stats = { scanned: 0, stale: 0, notifsSent: 0, errors: 0 };
  const cutoff90d = Date.now() - 90 * 24 * 60 * 60 * 1000;

  let tipsSnap;
  try {
    tipsSnap = await db.collection('portal_tips').limit(1000).get();
  } catch (e) {
    console.error('[portalTipsStaleCheckCron] fetch fail:', e?.message);
    return;
  }
  stats.scanned = tipsSnap.size;

  const staleTips = [];
  for (const d of tipsSnap.docs) {
    const t = d.data();
    if (t.status === 'archived') continue;
    const ts = t.updatedAt?.toMillis?.() || 0;
    if (!ts || ts < cutoff90d) {
      staleTips.push({ id: d.id, ref: d.ref, data: t });
    }
  }
  stats.stale = staleTips.length;
  if (staleTips.length === 0) {
    console.log('[portalTipsStaleCheckCron] nenhuma tip stale.');
    return;
  }

  // Flag cada tip + acumula curadores
  let batch = db.batch();
  let ops = 0;
  const flush = async () => { if (ops > 0) { await batch.commit(); batch = db.batch(); ops = 0; } };

  for (const { ref, data } of staleTips) {
    if (!data.staleSince) {
      batch.update(ref, { staleSince: FieldValue.serverTimestamp() });
      ops++;
    }
    if (ops >= 400) await flush();
  }
  try { await flush(); } catch (e) { stats.errors++; console.error('[portalTipsStaleCheckCron] flag commit fail:', e?.message); }

  // Notif sumária semanal pra curadores
  let curators = [];
  try {
    const usersSnap = await db.collection('users').get();
    curators = usersSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => u.active !== false && u.id !== 'system')
      .filter(u =>
           u.isMaster
        || u.roleId === 'master'
        || u.roleId === 'admin'
        || (Array.isArray(u.permissions) && (
             u.permissions.includes('portal_manage')
          || u.permissions.includes('portal_tips_manage')
        ))
      ).map(u => u.id).slice(0, 50);
  } catch (e) { console.warn('[portalTipsStaleCheckCron] users fetch fail:', e?.message); }

  if (curators.length) {
    const now = new Date();
    const weekNum = Math.ceil((((now - new Date(now.getFullYear(), 0, 1)) / 86400000) + new Date(now.getFullYear(), 0, 1).getDay() + 1) / 7);
    const weekKey = `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
    const tsNow = FieldValue.serverTimestamp();
    const expiresAt = Timestamp.fromMillis(Date.now() + 30*24*60*60*1000);

    batch = db.batch();
    ops = 0;
    for (const cid of curators) {
      const notifId = `portal_tips_stale_${cid}_${weekKey}`;
      batch.set(db.collection('notifications').doc(notifId), {
        actorId:     'system',
        actorName:   'Sistema PRIMETOUR',
        recipientId: cid,
        type:        'portal.tips_stale_digest',
        entityType:  'system',
        entityId:    'portal-tips-stale',
        title:       `🕐 ${staleTips.length} dica(s) sem revisão há +90 dias`,
        body:        staleTips.slice(0, 3).map(t => `"${t.data.title || t.data.city || t.id}"`).join(', ') + (staleTips.length > 3 ? ` e mais ${staleTips.length - 3}` : ''),
        route:       'portal-tips',
        priority:    'normal',
        category:    'portal',
        read:        false,
        readAt:      null,
        createdAt:   tsNow,
        expiresAt,
      });
      ops++;
      stats.notifsSent++;
    }
    try { await batch.commit(); } catch (e) { stats.errors++; console.error('[portalTipsStaleCheckCron] notif commit fail:', e?.message); }
  }

  await db.collection('audit_logs').add({
    action: 'system.portal_tips_stale_cron',
    userId: 'system',
    severity: stats.errors > 0 ? 'warning' : 'info',
    ...stats,
    timestamp: FieldValue.serverTimestamp(),
  });

  console.log('[portalTipsStaleCheckCron] done:', JSON.stringify(stats));
});

/* ═══════════════════════════════════════════════════════════════════
 * v4.62.37 — onTaskCreated: safety-net pra notif de assignee/observer.
 *
 * Bug raiz: vários caminhos criam tasks SEM passar pelo service que dispara
 * notify (CLAUDE.md §12.n recidivismo). Casos descobertos na auditoria:
 *   - Portal de Solicitações (portalWizard, portal, portalLegacy) faz
 *     addDoc direto sem notificar.
 *   - recurringTasksDailyCron cria tasks com assignees pré-definidos do
 *     template, sem notif.
 *   - Qualquer caller futuro que esqueça de notify.
 *
 * Solução §12.n option 3: trigger reativo que SEMPRE dispara, independente
 * do caller. Idempotente (skip se já existe notif task.assigned pra
 * recipient+task) pra evitar dobrar quando service também notifica.
 *
 * Garantias:
 *   - Idempotência: query por notification.{entityId,recipientId,type} antes
 *     de criar. Se já existe nos últimos 5min, skip (cobertura do caller UI).
 *   - actorId derivado de task.createdBy. Self-assign não notifica.
 *   - Rules bypassadas via Admin SDK (não passa por settings/global flag).
 *   - Sem dependência de prefs — Cloud Function deve notificar SEMPRE pro
 *     painel do user. Filtros de email/etc. ficam em onNotificationCreate.
 * ═══════════════════════════════════════════════════════════════════ */
export const onTaskCreated = onDocumentCreated({
  document: 'tasks/{taskId}',
  region:   'us-central1',
}, async (event) => {
  const task = event.data?.data();
  const taskId = event.params?.taskId;
  if (!task || !taskId) return;

  const assignees = Array.isArray(task.assignees) ? task.assignees.filter(Boolean) : [];
  const observers = Array.isArray(task.observers) ? task.observers.filter(Boolean) : [];
  if (!assignees.length && !observers.length) {
    console.log(`[onTaskCreated] task=${taskId} sem assignees/observers — skip`);
    return;
  }

  const actorId   = task.createdBy || 'system';
  const actorName = (actorId === 'system' || actorId === 'portal')
    ? 'Sistema PRIMETOUR'
    : (await db.collection('users').doc(actorId).get().catch(() => null))?.data()?.name || 'Sistema PRIMETOUR';

  const title = task.title || 'Tarefa';
  const now = FieldValue.serverTimestamp();

  // Helper: cria notif SE não existe ainda (idempotência cross-caller)
  const createIfMissing = async (recipientId, type, body, priority = 'normal') => {
    if (recipientId === actorId) return; // self-assign: skip
    // Idempotência: skip se já tem notif desse mesmo type+entity pra esse recipient
    // criada nos últimos 5min (caller UI provavelmente já criou).
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const existingSnap = await db.collection('notifications')
      .where('recipientId', '==', recipientId)
      .where('entityType',  '==', 'task')
      .where('entityId',    '==', taskId)
      .where('type',        '==', type)
      .where('createdAt',   '>=', fiveMinAgo)
      .limit(1)
      .get()
      .catch(() => ({ empty: true }));
    if (!existingSnap.empty) {
      console.log(`[onTaskCreated] skip duplicate ${type} pra ${recipientId} (task=${taskId})`);
      return;
    }
    await db.collection('notifications').add({
      type, entityType: 'task', entityId: taskId,
      recipientId, actorId, actorName,
      title, body, route: 'tasks',
      priority, category: 'tasks',
      read: false, dismissed: false,
      createdAt: now,
      // expiresAt: opcional (notificationPanel já faz TTL client-side)
    }).catch(e => console.warn(`[onTaskCreated] add notif fail (${type}/${recipientId}):`, e?.message));
  };

  const ops = [];
  for (const uid of assignees) {
    ops.push(createIfMissing(uid, 'task.assigned', `"${title}" foi atribuída a você`, task.priority === 'urgent' ? 'high' : 'normal'));
  }
  for (const uid of observers) {
    if (assignees.includes(uid)) continue; // assignee já recebeu o principal
    ops.push(createIfMissing(uid, 'task.observing', `Você está acompanhando "${title}"`, 'low'));
  }
  await Promise.all(ops);
  console.log(`[onTaskCreated] task=${taskId} assignees=${assignees.length} observers=${observers.length} actor=${actorId}`);
});

/* ═══════════════════════════════════════════════════════════════════
 * v4.62.37 — onTaskUpdated: safety-net pra notif quando assignees/observers
 * mudam em task EXISTENTE via caminho que bypassa updateTask service.
 *
 * Casos cobertos:
 *   - Admin reatribui via Admin SDK direto.
 *   - Qualquer service novo que mexa em assignees sem chamar notify.
 *   - bulkUpdateTasks v4.62.37 já notifica client-side, mas CF é defesa.
 *
 * Idempotência: mesmo guard de 5min do onTaskCreated.
 * ═══════════════════════════════════════════════════════════════════ */
export const onTaskUpdated = onDocumentUpdated({
  document: 'tasks/{taskId}',
  region:   'us-central1',
}, async (event) => {
  const before = event.data?.before?.data() || {};
  const after  = event.data?.after?.data()  || {};
  const taskId = event.params?.taskId;
  if (!after || !taskId) return;

  const beforeA = Array.isArray(before.assignees) ? before.assignees : [];
  const beforeO = Array.isArray(before.observers) ? before.observers : [];
  const afterA  = Array.isArray(after.assignees)  ? after.assignees  : [];
  const afterO  = Array.isArray(after.observers)  ? after.observers  : [];
  const addedA  = afterA.filter(uid => uid && !beforeA.includes(uid));
  const addedO  = afterO.filter(uid => uid && !beforeO.includes(uid));
  if (!addedA.length && !addedO.length) return; // nada que precise notificar

  const actorId   = after.updatedBy || after.lastEditedBy || after.createdBy || 'system';
  const actorName = (actorId === 'system' || actorId === 'portal')
    ? 'Sistema PRIMETOUR'
    : (await db.collection('users').doc(actorId).get().catch(() => null))?.data()?.name || 'Sistema PRIMETOUR';
  const title = after.title || before.title || 'Tarefa';
  const now = FieldValue.serverTimestamp();

  const createIfMissing = async (recipientId, type, body, priority = 'normal') => {
    if (recipientId === actorId) return;
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const existingSnap = await db.collection('notifications')
      .where('recipientId', '==', recipientId)
      .where('entityType',  '==', 'task')
      .where('entityId',    '==', taskId)
      .where('type',        '==', type)
      .where('createdAt',   '>=', fiveMinAgo)
      .limit(1)
      .get()
      .catch(() => ({ empty: true }));
    if (!existingSnap.empty) return;
    await db.collection('notifications').add({
      type, entityType: 'task', entityId: taskId,
      recipientId, actorId, actorName,
      title, body, route: 'tasks',
      priority, category: 'tasks',
      read: false, dismissed: false,
      createdAt: now,
    }).catch(e => console.warn(`[onTaskUpdated] add notif fail (${type}/${recipientId}):`, e?.message));
  };

  const ops = [];
  for (const uid of addedA) {
    ops.push(createIfMissing(uid, 'task.assigned', `"${title}" foi atribuída a você`, after.priority === 'urgent' ? 'high' : 'normal'));
  }
  for (const uid of addedO) {
    if (addedA.includes(uid)) continue;
    ops.push(createIfMissing(uid, 'task.observing', `Você está acompanhando "${title}"`, 'low'));
  }
  await Promise.all(ops);
  console.log(`[onTaskUpdated] task=${taskId} addedA=${addedA.length} addedO=${addedO.length} actor=${actorId}`);
});
