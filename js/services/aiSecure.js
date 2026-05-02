/**
 * PRIMETOUR — Secure AI Client
 *
 * Wrapper que chama as Cloud Functions ao invés do client SDK direto.
 * Vantagens:
 *  - API keys NUNCA expostas no client
 *  - Rate limit + cost cap server-side (não bypassable)
 *  - Audit centralizado
 *  - LGPD: anonimização garantida server-side
 *
 * Esta é a interface PREFERIDA pra novos códigos.
 * O legado `chatWithAI` em ai.js fica como fallback durante migração
 * (Sprint 1) e será removido na Sprint 2.
 */
import { app } from '../firebase.js';

let _functions = null;
async function getFunctionsInstance() {
  if (_functions) return _functions;
  const mod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
  _functions = mod.getFunctions(app, 'us-central1');
  return _functions;
}

async function callable(name, data) {
  const functions = await getFunctionsInstance();
  const { httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
  const fn = httpsCallable(functions, name);
  try {
    const result = await fn(data);
    return result.data;
  } catch (e) {
    // Erros HttpsError vêm com .code e .message
    const code = e.code || 'unknown';
    const msg  = e.message || 'erro desconhecido';
    throw new Error(`[${code}] ${msg}`);
  }
}

/**
 * Chama LLM via Cloud Function (segura).
 * Substitui chatWithAI direto.
 */
export async function callLLMSecure({
  provider = 'gemini', model, systemPrompt, userMessage,
  history = [], maxTokens = 2048, temperature = 0.3,
  agentId = null, agentName = null, agentDailyCapUsd = 5,
  module = 'general', source = 'cloud-function',
}) {
  return await callable('callLLM', {
    provider, model, systemPrompt, userMessage, history,
    maxTokens, temperature,
    agentId, agentName, agentDailyCapUsd,
    module, source,
  });
}

/**
 * Pega URL/token pra upload R2.
 */
export async function getR2UploadUrlSecure(path) {
  return await callable('getR2UploadUrl', { path });
}

/**
 * Pega token Graph API SharePoint (client_credentials).
 */
export async function getSharePointTokenSecure() {
  return await callable('getSharePointToken', {});
}

/**
 * Lê arquivo/pasta GitHub.
 */
export async function getGitHubFileSecure({ repo, path = '', branch = 'main' }) {
  return await callable('getGitHubFile', { repo, path, branch });
}

/**
 * Detecta se Cloud Functions estão deployed (probe).
 * Usado pra fallback automático ao client SDK direto durante a migração.
 */
let _functionsAvailable = null;
export async function areFunctionsAvailable() {
  if (_functionsAvailable !== null) return _functionsAvailable;
  try {
    // Fazer chamada inválida mas que NÃO custe nada — o erro vem antes do LLM call
    await callable('callLLM', { /* sem userMessage = HttpsError invalid-argument = function existe */ });
    _functionsAvailable = true;
  } catch (e) {
    // Se erro for "invalid-argument" → função existe e respondeu
    if (/invalid-argument|userMessage/i.test(e.message)) {
      _functionsAvailable = true;
    } else if (/not-found|NOT_FOUND|deadline|404/i.test(e.message)) {
      _functionsAvailable = false;
    } else {
      // Erro de auth ou rede — assume que functions estão lá
      _functionsAvailable = true;
    }
  }
  return _functionsAvailable;
}
