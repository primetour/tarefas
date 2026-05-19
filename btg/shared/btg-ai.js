/**
 * Cliente de IA do BTG — abstrai chamadas pra Claude (via Cloud Function
 * `callLLM` do Gestor PRIMETOUR) com fallback mock pra ambientes onde
 * `callLLM` não está acessível.
 *
 * Arquitetura:
 * - **Em produção** (partners.primetour.com.br, ultrablue.primetour.com.br,
 *   operadora.primetour.com.br): chama `callLLM` via Firebase Functions
 *   apontando pro projeto produção `gestor-de-tarefas-primetour`. Ganha
 *   prompt caching (~70-90% economia), rate limit, cost cap, audit log.
 * - **Em staging** (`*.web.app`): retorna mock text com aviso visível
 *   ("[MOCK STAGING] ..."). `callLLM` não funciona aqui porque:
 *     1. CORS da Cloud Function aceita só primetour.github.io + localhost
 *     2. Function está deployada só no projeto prod (staging é Spark plan)
 *     3. Auth tokens do projeto staging não validam em function de prod
 *
 * Pra plugar produção:
 * - Garantir que CORS de `callLLM` inclui os domínios finais BTG.
 * - User precisa estar autenticado via Firebase Auth do projeto prod
 *   (SSO Microsoft já configurado no Gestor).
 *
 * API pública:
 *   sugerir({ field, context }) → Promise<{ text, mock?, cached? }>
 *   revisar({ text, type })     → Promise<{ text, mock?, cached? }>
 */

import { buildSugerirPrompt, buildRevisarPrompt, buildContextFromStore } from './btg-ai-prompts.js';

const STAGING_HOSTS = ['gestor-btg-lp-builder-staging.web.app', 'localhost', '127.0.0.1'];

function isStaging() {
  return STAGING_HOSTS.some((h) => location.hostname === h || location.hostname.endsWith('.' + h));
}

// ─── Mocks pra staging ─────────────────────────────────────

const MOCK_BY_FIELD = {
  nome_da_oferta: (ctx) => {
    const dest = ctx.destino_rota || 'Destino';
    const dur  = ctx.duracao_noites ? ` · ${ctx.duracao_noites}` : '';
    return `Experiência exclusiva em ${dest}${dur}`;
  },
  descricao: (ctx) => {
    const dest = ctx.destino_rota || 'um destino selecionado';
    return `Roteiro privativo em ${dest} com hospedagem premium, traslados curados e experiências assinadas pelo Concierge BTG. Pensado pra quem busca presença, não pressa.`;
  },
  oferta_especial: () => `EARLY BOOKING`,
  incluso_no_pacote: () =>
    'Hospedagem com café da manhã\n' +
    'Traslados privativos aeroporto-hotel-aeroporto\n' +
    'Experiência exclusiva no destino\n' +
    'Atendimento Concierge 24h durante a estadia',
  beneficios_marca: () =>
    'Welcome drink na chegada\n' +
    'Early check-in e late check-out conforme disponibilidade\n' +
    'Crédito Virtuoso para uso no hotel\n' +
    'Upgrade de categoria conforme disponibilidade',
  condicoes_observacoes: () =>
    'Sujeito a disponibilidade no momento da reserva\n' +
    'Antecedência mínima de 14 dias\n' +
    'Cancelamento gratuito até 30 dias antes do check-in',
};

function mockSugerir(field, context) {
  const fn = MOCK_BY_FIELD[field] || (() => 'Texto sugerido apareceria aqui em produção.');
  return fn(context);
}

function mockRevisar(text, type) {
  // Mock simples: só retorna o texto adicionando uma nota sutil
  if (!text) return '';
  return text.trim();
}

// ─── Cliente real (produção) — chama callLLM ───────────────

async function callLLMReal(prompt, opts = {}) {
  // Lazy import — só carrega Firebase Functions SDK em produção
  const { getApps, initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
  const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');

  // App de produção (diferente do btg-app que aponta pra staging)
  const PROD_CONFIG = {
    // TODO Fase 5: preencher com config do projeto gestor-de-tarefas-primetour
    // (mesmo formato de btg-config.js mas pra projeto produção).
    projectId: 'gestor-de-tarefas-primetour',
  };
  const existing = getApps().find((a) => a.name === 'btg-prod-app');
  const app = existing || initializeApp(PROD_CONFIG, 'btg-prod-app');

  // Region: us-central1 (default das Cloud Functions do Gestor)
  const functions = getFunctions(app, 'us-central1');
  const callLLM = httpsCallable(functions, 'callLLM');

  const result = await callLLM({
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    system: '',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: opts.maxTokens || 600,
    temperature: opts.temperature ?? 0.7,
    // Habilita prompt caching pra economizar tokens em chamadas repetidas
    cacheControl: 'ephemeral',
  });
  return {
    text: result.data?.text || '',
    cached: !!result.data?.cacheRead,
  };
}

// ─── API pública ───────────────────────────────────────────

/**
 * Pede pra IA sugerir conteúdo pra um campo.
 *
 * @param {Object} params
 * @param {string} params.field - chave do campo (ex: 'descricao'). Precisa estar em AI_FIELDS.
 * @param {Object} params.values - valores atuais do form-store (pra contexto).
 * @returns {Promise<{text: string, mock?: boolean, cached?: boolean}>}
 */
export async function sugerir({ field, values }) {
  const context = buildContextFromStore(values || {});
  if (isStaging()) {
    await new Promise((r) => setTimeout(r, 600)); // simula latência de API
    return { text: mockSugerir(field, context), mock: true };
  }
  const prompt = buildSugerirPrompt(field, context);
  try {
    const result = await callLLMReal(prompt, { maxTokens: 600 });
    return result;
  } catch (err) {
    console.error('[btg-ai] sugerir falhou:', err);
    throw new Error(`Falha ao gerar sugestão: ${err.message}`);
  }
}

/**
 * Pede pra IA revisar um texto existente.
 *
 * @param {Object} params
 * @param {string} params.text - texto a revisar.
 * @param {'ortografia'|'padronizacao'|'completo'} [params.type='completo']
 * @returns {Promise<{text: string, mock?: boolean, cached?: boolean}>}
 */
export async function revisar({ text, type = 'completo' }) {
  if (!text?.trim()) return { text: '' };
  if (isStaging()) {
    await new Promise((r) => setTimeout(r, 600));
    return { text: mockRevisar(text, type), mock: true };
  }
  const prompt = buildRevisarPrompt(text, type);
  try {
    const result = await callLLMReal(prompt, { maxTokens: 800 });
    return result;
  } catch (err) {
    console.error('[btg-ai] revisar falhou:', err);
    throw new Error(`Falha ao revisar: ${err.message}`);
  }
}

export { isStaging };
