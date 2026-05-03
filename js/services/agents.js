/**
 * PRIMETOUR — Agents Service (IA Hub)
 *
 * Conceito unificado: um Agente combina Skill + Automação + Hint num só
 * lugar. Modelo declarativo, com descoberta dinâmica de tools, knowledge
 * extensível (R2/SharePoint/URLs/web/.md) e múltiplos triggers (botão,
 * agendamento, evento).
 *
 * Collections Firestore:
 *   ai_agents           — agentes ativos (CRUD)
 *   ai_skills_archive   — backup imutável de skills migradas (1 doc por skill)
 *   ai_automations_archive — backup imutável de automações migradas
 *   ai_knowledge        — base RAG (mantém collection existente)
 *   ai_usage_logs       — log de execução (ganha campo agentId)
 *   ai_api_keys         — chaves escopadas (mantém collection existente)
 *
 * Schema do agente:
 *   {
 *     id, name, icon, avatarUrl, description,
 *     module: 'tasks'|'general'|...,
 *     active: bool,
 *
 *     // Modelo
 *     provider: 'anthropic'|'openai'|'gemini'|'groq'|'azure'|'local',
 *     model:    'claude-sonnet-4-6'|...,
 *     apiKeyRef:{ scope:'global'|'workspace'|'sector', scopeId, scopeLabel },
 *
 *     // Comportamento
 *     systemPrompt: string,
 *     fewShotExamples: [{ input, output }],
 *     outputFormat: 'text'|'markdown'|'json'|'html',
 *
 *     // Tools (descoberta dinâmica do módulo)
 *     toolsMode: 'auto'|'manual',         // auto = todas do módulo
 *     enabledTools: ['searchWeb', 'createTask', ...],
 *     allowWebSearch: bool,               // habilita ferramenta de busca web
 *     allowedSites: ['url1','url2'],      // restringe busca a esses sites (vazio = web toda)
 *
 *     // Conhecimento
 *     knowledgeIds: ['kb-1', ...],        // ai_knowledge docs internos
 *     knowledgeSources: [
 *       { type:'r2',         path:'docs/sla/' },
 *       { type:'sharepoint', siteId, libraryId, folder:'...' },
 *       { type:'url',        url:'https://...' },
 *     ],
 *
 *     // Limites operacionais
 *     limits: {
 *       maxTokensPerRun: 2048,
 *       temperature: 0.3,
 *       maxCostPerDayUsd: 5.00,
 *       rateLimit: { window: 60, max: 10 },
 *       timeoutMs: 30000,
 *     },
 *
 *     // Triggers
 *     triggers: {
 *       button:   { enabled: bool, label, position:'header'|'inline' },
 *       context:  { enabled: bool, label },
 *       schedule: { enabled: bool, mode:'preset'|'cron', preset:'daily'|'weekly'|'monthly'|'hourly', cron:'...', timezone, hour, minute, weekday, dayOfMonth },
 *       publicChat:{ enabled: bool, slug },          // permite link externo /agente.html?slug=xxx
 *     },
 *
 *     // RBAC
 *     visibility: { mode:'all'|'admin'|'sector'|'role', value },
 *
 *     // Migração (rastreio)
 *     migratedFrom: { source:'skill'|'automation', sourceId },
 *
 *     createdAt, createdBy, updatedAt, updatedBy
 *   }
 */
import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  getDoc, getDocs, query, where, orderBy, serverTimestamp, limit, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';

const AGENTS_COL                = 'ai_agents';
const SKILLS_ARCHIVE_COL        = 'ai_skills_archive';
const AUTOMATIONS_ARCHIVE_COL   = 'ai_automations_archive';

/* ─── Defaults ──────────────────────────────────────────── */
export const AGENT_DEFAULTS = {
  active: true,
  icon: '◈',
  avatarUrl: '',
  description: '',
  module: 'general',
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  apiKeyRef: { scope: 'global', scopeId: null, scopeLabel: 'Global' },
  systemPrompt: 'Você é um assistente útil. Responda de forma clara e objetiva.',
  fewShotExamples: [],
  outputFormat: 'markdown',
  toolsMode: 'auto',
  enabledTools: [],
  allowWebSearch: false,
  allowedSites: [],
  knowledgeIds: [],
  knowledgeSources: [],
  limits: {
    maxTokensPerRun: 2048,
    temperature: 0.3,
    maxCostPerDayUsd: 5.00,
    rateLimit: { window: 60, max: 10 },
    timeoutMs: 30000,
  },
  triggers: {
    button:    { enabled: true,  label: '✨ IA',  position: 'header' },
    context:   { enabled: false, label: '' },
    schedule:  { enabled: false, mode: 'preset', preset: 'daily', cron: '', timezone: 'America/Sao_Paulo', hour: 9, minute: 0, weekday: 1, dayOfMonth: 1 },
    publicChat:{ enabled: false, slug: '' },
  },
  visibility: { mode: 'all', value: '' },
  // Site público (microsite) — ativo quando triggers.publicChat.enabled
  site: {
    welcomeMessage: '',           // mensagem inicial mostrada antes do chat
    suggestedPrompts: [],         // ["Como faço X?", "Me ajude com Y"]
    brandColor: '#2563EB',        // cor primária (botões, accent)
    tagline: '',                  // subtítulo no hero
    footerText: 'Powered by PRIMETOUR',
    showAvatar: true,
    showBranding: true,
  },
};

/* ─── R2 (avatar upload) ────────────────────────────────── */
const R2_PUBLIC_URL   = 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev';
const R2_WORKER_URL   = 'https://primetour-images.rene-castro.workers.dev';
const R2_UPLOAD_TOKEN = 'primetour2026-imagens-secreto-xk9q';

/**
 * Upload de avatar do agente pro R2. Aceita File/Blob; retorna URL pública.
 * Path: agents/avatar-<agentId>-<timestamp>.<ext>
 */
export async function uploadAgentAvatar(file, agentId = 'new') {
  if (!file) throw new Error('Arquivo vazio.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Avatar deve ter até 2MB.');
  const ext  = (file.name?.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `agents/avatar-${agentId}-${Date.now()}.${ext}`;
  const fd   = new FormData();
  fd.append('file', file, path.split('/').pop());
  fd.append('path', path);
  const res = await fetch(R2_WORKER_URL, {
    method: 'POST',
    headers: { 'X-Upload-Token': R2_UPLOAD_TOKEN },
    body: fd,
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.status);
    throw new Error(`Upload do avatar falhou: ${msg}`);
  }
  return `${R2_PUBLIC_URL}/${path}`;
}

/* ─── CRUD ──────────────────────────────────────────────── */

function deepMerge(target, source) {
  const out = { ...target };
  for (const k in source) {
    if (source[k] && typeof source[k] === 'object' && !Array.isArray(source[k])) {
      out[k] = deepMerge(target[k] || {}, source[k]);
    } else if (source[k] !== undefined) {
      out[k] = source[k];
    }
  }
  return out;
}

function normalizeAgent(data) {
  // Mescla com defaults pra garantir que campos obrigatórios existam
  return deepMerge(AGENT_DEFAULTS, data || {});
}

export async function fetchAgents() {
  const snap = await getDocs(query(collection(db, AGENTS_COL), limit(500)))
    .catch(() => ({ docs: [] }));
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return rows;
}

export function subscribeAgents(callback) {
  return onSnapshot(query(collection(db, AGENTS_COL), limit(500)),
    (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      callback(rows);
    },
    (err) => {
      console.warn('[agents] subscribe err:', err?.message);
      callback([], err);
    });
}

export async function getAgent(id) {
  const snap = await getDoc(doc(db, AGENTS_COL, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function fetchAgentsForModule(module) {
  // Inclui agentes do módulo específico + agentes 'general' que apareçam em qualquer módulo
  const all = await fetchAgents();
  return all.filter(a => a.active && (a.module === module || a.module === 'general'));
}

export async function fetchAgentBySlug(slug) {
  if (!slug) return null;
  const snap = await getDocs(query(
    collection(db, AGENTS_COL),
    where('triggers.publicChat.slug', '==', slug),
    limit(1),
  )).catch(() => ({ docs: [] }));
  if (!snap.docs.length) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function _validateSlugUnique(slug, excludeId = null) {
  if (!slug) return;
  const snap = await getDocs(query(
    collection(db, AGENTS_COL),
    where('triggers.publicChat.slug', '==', slug),
    limit(2),
  ));
  const conflict = snap.docs.find(d => d.id !== excludeId);
  if (conflict) {
    throw new Error(`Slug "${slug}" já está em uso por outro agente. Escolha outro.`);
  }
}

export async function createAgent(data) {
  const payload = normalizeAgent(data);
  // Valida slug único se publicChat habilitado
  if (payload.triggers?.publicChat?.enabled && payload.triggers?.publicChat?.slug) {
    await _validateSlugUnique(payload.triggers.publicChat.slug);
  }
  const cu = store.get('currentUser');
  const ref = await addDoc(collection(db, AGENTS_COL), {
    ...payload,
    createdAt: serverTimestamp(),
    createdBy: cu?.uid || null,
    updatedAt: serverTimestamp(),
    updatedBy: cu?.uid || null,
  });
  return { id: ref.id, ...payload };
}

export async function updateAgent(id, patch) {
  const cu = store.get('currentUser');
  // Deep-merge no client antes de gravar (Firestore updateDoc é shallow)
  const current = await getAgent(id);
  const merged  = deepMerge(current || AGENT_DEFAULTS, patch);
  // Valida slug único se publicChat habilitado e mudou
  if (merged.triggers?.publicChat?.enabled && merged.triggers?.publicChat?.slug
      && merged.triggers.publicChat.slug !== current?.triggers?.publicChat?.slug) {
    await _validateSlugUnique(merged.triggers.publicChat.slug, id);
  }
  // Remove campos meta antes de gravar
  delete merged.id;
  delete merged.createdAt;
  delete merged.createdBy;
  await setDoc(doc(db, AGENTS_COL, id), {
    ...merged,
    updatedAt: serverTimestamp(),
    updatedBy: cu?.uid || null,
  }, { merge: true });
}

export async function deleteAgent(id) {
  await deleteDoc(doc(db, AGENTS_COL, id));
}

export async function toggleAgent(id, active) {
  await updateAgent(id, { active });
}

/* ═══════════════════════════════════════════════════════════
 * MIGRAÇÃO: ai_skills + ai_automations → ai_agents
 *
 * Estratégia anti-perda:
 *  1. Antes de QUALQUER delete, copia integral pro *_archive collection
 *     (1 doc por skill/automação, com timestamp da migração)
 *  2. Cria agent equivalente com migratedFrom = { source, sourceId }
 *  3. Idempotente: se já existe agent com migratedFrom.sourceId == X,
 *     pula (evita duplicar quando rodar 2 vezes)
 *  4. Operações em batch — falha de uma não derruba outras
 *  5. Retorna relatório com sucessos/falhas por item
 *  6. NÃO apaga as collections originais nesta função — apenas migra.
 *     Apagar requer ação manual do admin (botão "limpar antigas").
 * ═══════════════════════════════════════════════════════════ */

function _skillToAgent(skill) {
  return {
    name: skill.name || 'Skill migrada',
    icon: skill.icon || '◈',
    description: skill.description || '',
    module: skill.module || 'general',
    active: skill.active !== false,
    provider: skill.provider || 'gemini',
    model:    skill.model    || 'gemini-2.5-flash',
    apiKeyRef: skill.apiKeyRef || { scope: 'global', scopeId: null, scopeLabel: 'Global' },
    systemPrompt:  skill.prompt || skill.systemPrompt || '',
    outputFormat:  skill.outputFormat || 'markdown',
    knowledgeIds:  skill.knowledgeIds || [],
    limits: {
      maxTokensPerRun: skill.maxTokens || 2048,
      temperature:     skill.temperature ?? 0.3,
      maxCostPerDayUsd: 5.00,
      rateLimit:       { window: 60, max: 10 },
      timeoutMs:       30000,
    },
    triggers: {
      button:    { enabled: true, label: skill.buttonLabel || skill.name || '✨ IA', position: 'header' },
      context:   { enabled: skill.trigger === 'context', label: '' },
      schedule:  { enabled: false, mode: 'preset', preset: 'daily' },
      publicChat:{ enabled: false, slug: '' },
    },
    visibility: { mode: 'all', value: '' },
    migratedFrom: { source: 'skill', sourceId: skill.id, migratedAt: new Date().toISOString() },
  };
}

function _automationToAgent(auto) {
  // Mapeia AUTOMATION_TYPES → módulo + prompt sugerido
  const TYPE_TO_MODULE = {
    news_search:     'news-monitor',
    clipping_search: 'news-monitor',
    skill_execution: auto.targetModule || 'general',
    report_generate: 'dashboards',
    task_reminder:   'tasks',
  };
  const FREQ_TO_PRESET = {
    manual: { enabled: false, mode: 'preset', preset: 'daily' },
    hourly: { enabled: true,  mode: 'preset', preset: 'hourly' },
    daily:  { enabled: true,  mode: 'preset', preset: 'daily' },
    weekly: { enabled: true,  mode: 'preset', preset: 'weekly' },
    monthly:{ enabled: true,  mode: 'preset', preset: 'monthly' },
  };
  const sched = FREQ_TO_PRESET[auto.frequency] || FREQ_TO_PRESET.manual;
  return {
    name: auto.name || 'Automação migrada',
    icon: '⚡',
    description: auto.description || (auto.config?.description || ''),
    module: TYPE_TO_MODULE[auto.type] || 'general',
    active: auto.active !== false,
    provider: auto.provider || 'gemini',
    model: auto.model || 'gemini-2.5-flash',
    apiKeyRef: { scope: 'global', scopeId: null, scopeLabel: 'Global' },
    systemPrompt: auto.config?.prompt || auto.prompt || `Execute a automação ${auto.type}.`,
    outputFormat: 'markdown',
    enabledTools: auto.config?.tools || [],
    allowWebSearch: auto.type === 'news_search' || auto.type === 'clipping_search',
    allowedSites: auto.config?.sources || [],
    limits: {
      maxTokensPerRun: 2048, temperature: 0.5,
      maxCostPerDayUsd: 5.00, rateLimit: { window: 60, max: 10 }, timeoutMs: 30000,
    },
    triggers: {
      button:    { enabled: false, label: '', position: 'header' },
      context:   { enabled: false, label: '' },
      schedule:  { ...sched, hour: 9, minute: 0, timezone: 'America/Sao_Paulo' },
      publicChat:{ enabled: false, slug: '' },
    },
    visibility: { mode: 'all', value: '' },
    migratedFrom: { source: 'automation', sourceId: auto.id, automationType: auto.type, migratedAt: new Date().toISOString() },
  };
}

async function _archiveDoc(collectionName, docId, payload) {
  // Backup imutável — usa setDoc com ID composto pra garantir idempotência
  const archiveId = `${collectionName}__${docId}`;
  await setDoc(doc(db, collectionName, archiveId), {
    ...payload,
    _originalId: docId,
    _archivedAt: serverTimestamp(),
  });
  return archiveId;
}

async function _hasAgentForSource(source, sourceId) {
  const snap = await getDocs(query(
    collection(db, AGENTS_COL),
    where('migratedFrom.source',   '==', source),
    where('migratedFrom.sourceId', '==', sourceId),
    limit(1),
  )).catch(() => ({ docs: [] }));
  return !snap.empty;
}

/**
 * Migra todas as skills + automações pra agents.
 * Idempotente, com backup completo. Retorna relatório.
 */
export async function migrateLegacyToAgents() {
  if (!store.isMaster() && !store.can('system_manage_settings')) {
    throw new Error('Permissão negada — apenas admin/master.');
  }
  const report = {
    skillsTotal: 0, skillsMigrated: 0, skillsSkipped: 0, skillsFailed: 0,
    automationsTotal: 0, automationsMigrated: 0, automationsSkipped: 0, automationsFailed: 0,
    errors: [],
  };

  /* ─── Skills ─── */
  try {
    const sSnap = await getDocs(query(collection(db, 'ai_skills'), limit(500)))
      .catch(() => ({ docs: [] }));
    report.skillsTotal = sSnap.docs.length;
    for (const d of sSnap.docs) {
      try {
        const skill = { id: d.id, ...d.data() };
        // Backup primeiro (sempre, idempotente)
        await _archiveDoc(SKILLS_ARCHIVE_COL, skill.id, skill);
        // Verifica se já foi migrado
        if (await _hasAgentForSource('skill', skill.id)) {
          report.skillsSkipped++;
          continue;
        }
        await createAgent(_skillToAgent(skill));
        report.skillsMigrated++;
      } catch (e) {
        report.skillsFailed++;
        report.errors.push(`skill ${d.id}: ${e.message}`);
      }
    }
  } catch (e) {
    report.errors.push(`fetch skills: ${e.message}`);
  }

  /* ─── Automations ─── */
  try {
    const aSnap = await getDocs(query(collection(db, 'ai_automations'), limit(500)))
      .catch(() => ({ docs: [] }));
    report.automationsTotal = aSnap.docs.length;
    for (const d of aSnap.docs) {
      try {
        const auto = { id: d.id, ...d.data() };
        await _archiveDoc(AUTOMATIONS_ARCHIVE_COL, auto.id, auto);
        if (await _hasAgentForSource('automation', auto.id)) {
          report.automationsSkipped++;
          continue;
        }
        await createAgent(_automationToAgent(auto));
        report.automationsMigrated++;
      } catch (e) {
        report.automationsFailed++;
        report.errors.push(`automation ${d.id}: ${e.message}`);
      }
    }
  } catch (e) {
    report.errors.push(`fetch automations: ${e.message}`);
  }

  return report;
}

/* ═══════════════════════════════════════════════════════════
 * SEED — Agentes pré-configurados que espelham as features inline
 * de IA já existentes no sistema (Roteiros, Portal, Calendário).
 *
 * Idempotente: não cria se já existe agente com mesmo migratedFrom.systemSeed.
 * ═══════════════════════════════════════════════════════════ */
export const SYSTEM_SEED_AGENTS = [
  {
    seedId: 'roteiro-generator',
    name: 'Roteiro de Viagem (gerador)',
    icon: '✈',
    avatarUrl: '',
    description: 'Gera roteiros de viagem completos a partir de uma descrição (destino + perfil + dias).',
    module: 'roteiros',
    provider: 'gemini',
    model:    'gemini-2.5-pro',
    systemPrompt: `Você é o assistente especialista em roteiros de viagem de LUXO da PRIMETOUR.

Sua missão: gerar roteiros completos a partir de uma descrição do cliente, incluindo:
- Hotéis premium (5 estrelas, boutique luxury)
- Experiências exclusivas (gastronomia, cultura, aventura)
- Logística (transfers, voos, transferências privativas)
- Dia-a-dia detalhado com timing realista

ESTILO:
- Linguagem sofisticada porém acessível, em português brasileiro
- Seções claras: Visão Geral, Hotéis, Dia 1, Dia 2, ...
- Sempre inclua URLs reais quando souber
- Personalize tom conforme perfil (lua de mel, família, executivo, casal jovem)

NUNCA invente nomes de hotéis ou restaurantes que não existem. Se não souber, sugira "verificar opções premium em [destino]".`,
    outputFormat: 'markdown',
    allowWebSearch: true,
    allowedSites: [],
    limits: { maxTokensPerRun: 4096, temperature: 0.7, maxCostPerDayUsd: 5, rateLimit: { window: 60, max: 5 }, timeoutMs: 60000 },
    triggers: {
      button: { enabled: true, label: '✈ Gerar Roteiro', position: 'header' },
      context: { enabled: false, label: '' },
      schedule: { enabled: false, mode: 'preset', preset: 'daily' },
      publicChat: { enabled: false, slug: '' },
    },
    visibility: { mode: 'all', value: '' },
    site: {
      welcomeMessage: 'Descreva o roteiro que você quer e eu monto pra você.',
      suggestedPrompts: [
        'Roteiro de 7 dias em Bariloche pra casal em julho',
        'Lua de mel Maldivas 10 dias, all-inclusive',
        'Família com 2 filhos pequenos em Orlando 8 dias',
      ],
      brandColor: '#0EA5E9', tagline: 'Roteiros de luxo personalizados em segundos',
      footerText: 'PRIMETOUR · Roteiros sob medida',
      showAvatar: true, showBranding: true,
    },
  },
  {
    seedId: 'portal-tip-updater',
    name: 'Portal de Dicas (atualizador)',
    icon: '✈',
    avatarUrl: '',
    description: 'Atualiza dicas vencidas do Portal com pesquisa web fresca + reescrita.',
    module: 'portal-tips',
    provider: 'gemini',
    model:    'gemini-2.5-flash',
    systemPrompt: `Você é o curador do Portal de Dicas de viagem da PRIMETOUR.

Tarefa: atualizar conteúdo vencido mantendo o formato e tom originais.

REGRAS:
- Português brasileiro, tom prático e conciso
- Mantenha a estrutura/formato exato do conteúdo original
- Use a pesquisa web fornecida pra trazer dados atuais (preços, horários, links)
- Se a pesquisa não mencionar algo do conteúdo original, mantenha o original
- Cite fonte (link) quando pegar dados externos`,
    outputFormat: 'markdown',
    allowWebSearch: true,
    limits: { maxTokensPerRun: 2048, temperature: 0.3, maxCostPerDayUsd: 3, rateLimit: { window: 60, max: 10 }, timeoutMs: 30000 },
    triggers: {
      button: { enabled: false, label: '', position: 'header' },
      context: { enabled: false, label: '' },
      schedule: { enabled: false, mode: 'preset', preset: 'daily' },
      publicChat: { enabled: false, slug: '' },
    },
    visibility: { mode: 'admin', value: '' },
    site: {
      welcomeMessage: '', suggestedPrompts: [],
      brandColor: '#10B981', tagline: 'Atualização de dicas com pesquisa web',
      footerText: 'PRIMETOUR · Portal de Dicas',
      showAvatar: true, showBranding: true,
    },
  },
  {
    seedId: 'content-week-planner',
    name: 'Calendário Semanal (planejador)',
    icon: '📱',
    avatarUrl: '',
    description: 'Sugere ideias de conteúdo semanal pras redes sociais (Instagram/Facebook).',
    module: 'content-calendar',
    provider: 'gemini',
    model:    'gemini-2.5-flash',
    systemPrompt: `Você é estrategista de conteúdo digital para a PRIMETOUR (agência de viagens de luxo).

Sua missão: sugerir ideias de posts semanais pras contas de Instagram/Facebook.

CONTEXTO PRIMETOUR:
- 2 contas: @primetourviagens (luxury) e @icsbyprimetour (corporate/Bradesco)
- Público @primetourviagens: viajantes de alto poder aquisitivo, casais, lua-de-mel, famílias
- Público @icsbyprimetour: clientes Bradesco, conteúdo institucional + dicas premium
- Tom: aspiracional, sofisticado, prático

FORMATO DE SAÍDA (JSON):
{
  "posts": [
    { "date": "YYYY-MM-DD", "platform": "Instagram", "type": "Carrossel|Reels|Foto",
      "title": "...", "brief": "...", "hashtags": "..." }
  ]
}

Use sempre português brasileiro. Diversifique tipos de post. Considere datas comemorativas e sazonalidade.`,
    outputFormat: 'json',
    allowWebSearch: false,
    limits: { maxTokensPerRun: 3072, temperature: 0.6, maxCostPerDayUsd: 3, rateLimit: { window: 60, max: 5 }, timeoutMs: 30000 },
    triggers: {
      button: { enabled: true, label: '📱 Sugerir Semana', position: 'header' },
      context: { enabled: false, label: '' },
      schedule: { enabled: false, mode: 'preset', preset: 'weekly', hour: 9, weekday: 1 },
      publicChat: { enabled: false, slug: '' },
    },
    visibility: { mode: 'all', value: '' },
    site: {
      welcomeMessage: 'Diga período + conta + tema e eu sugiro a semana.',
      suggestedPrompts: [
        'Próximas 2 semanas, @primetourviagens, foco em Bariloche',
        'Junho inteiro, @icsbyprimetour, datas comemorativas',
      ],
      brandColor: '#EC4899', tagline: 'Planejamento de conteúdo automatizado',
      footerText: 'PRIMETOUR · Marketing',
      showAvatar: true, showBranding: true,
    },
  },
  {
    seedId: 'content-caption',
    name: 'Legenda de Post (copywriter)',
    icon: '✎',
    avatarUrl: '',
    description: 'Gera legenda completa pra um post das redes sociais (com hashtags + CTA).',
    module: 'content-calendar',
    provider: 'gemini',
    model:    'gemini-2.5-flash',
    systemPrompt: `Você é copywriter de redes sociais da PRIMETOUR (agência de viagens de luxo).

Tarefa: escrever legenda completa pra um post a partir do brief, incluindo:
- Hook (primeira linha que para o scroll)
- Corpo (2-4 parágrafos curtos)
- CTA claro
- Hashtags otimizadas (15-20)

ESTILO:
- Português brasileiro
- Tom aspiracional mas acessível
- Use emojis com moderação (1-2 por parágrafo)
- Evite clichês de venda; foque em emoção e benefício

Adapte o tom à conta (@primetourviagens = luxo / @icsbyprimetour = institucional Bradesco).`,
    outputFormat: 'markdown',
    allowWebSearch: false,
    limits: { maxTokensPerRun: 1024, temperature: 0.7, maxCostPerDayUsd: 2, rateLimit: { window: 60, max: 20 }, timeoutMs: 20000 },
    triggers: {
      button: { enabled: false, label: '', position: 'header' },
      context: { enabled: false, label: '' },
      schedule: { enabled: false, mode: 'preset', preset: 'daily' },
      publicChat: { enabled: false, slug: '' },
    },
    visibility: { mode: 'all', value: '' },
    site: {
      welcomeMessage: '', suggestedPrompts: [],
      brandColor: '#A855F7', tagline: 'Legendas que vendem sem parecer venda',
      footerText: 'PRIMETOUR · Marketing',
      showAvatar: true, showBranding: true,
    },
  },
  {
    seedId: 'task-triage',
    name: 'Triagem de Tarefas',
    icon: '✓',
    avatarUrl: '',
    description: 'Analisa lista de tarefas e sugere priorização + alertas (atrasos, sobrecarga).',
    module: 'tasks',
    provider: 'gemini',
    model:    'gemini-2.5-flash',
    systemPrompt: `Você é o gestor de triagem de tarefas da PRIMETOUR.

Tarefa: analisar a lista de tarefas fornecida no contexto e gerar:
1. RANKING de prioridade (com critérios: SLA vencido, urgência, dependências)
2. ALERTAS (sobrecarga de pessoa específica, atrasos críticos)
3. SUGESTÕES (redistribuição, dúvidas pra esclarecer)

FORMATO:
- Markdown com seções claras
- Português brasileiro, conciso
- Cite IDs/nomes específicos quando relevante
- Não invente dados — use APENAS o contexto fornecido`,
    outputFormat: 'markdown',
    allowWebSearch: false,
    limits: { maxTokensPerRun: 2048, temperature: 0.3, maxCostPerDayUsd: 2, rateLimit: { window: 60, max: 15 }, timeoutMs: 30000 },
    triggers: {
      button: { enabled: true, label: '✓ Triar Tarefas', position: 'header' },
      context: { enabled: false, label: '' },
      schedule: { enabled: true, mode: 'preset', preset: 'daily', hour: 9, minute: 0 },
      publicChat: { enabled: false, slug: '' },
    },
    visibility: { mode: 'all', value: '' },
    site: {
      welcomeMessage: 'Cole a lista (ou peça resumo do dia) e eu trago.',
      suggestedPrompts: [
        'Quais tarefas devo priorizar hoje?',
        'Tem alguém sobrecarregado?',
        'Quais SLAs estouraram?',
      ],
      brandColor: '#F59E0B', tagline: 'Priorização inteligente do seu backlog',
      footerText: 'PRIMETOUR · Produtividade',
      showAvatar: true, showBranding: true,
    },
  },
  {
    seedId: 'bi-insights-analyst',
    name: 'Analista de BI (insights de dashboards)',
    icon: '📊',
    avatarUrl: '',
    description: 'Analista sênior de BI que lê snapshots de qualquer dashboard (ou índice/widget específico) e gera insights estruturados — observação, recomendação, tipo, impacto. Usado por todos os dashboards.',
    module: 'general',
    provider: 'gemini',
    model: 'gemini-2.5-pro',
    systemPrompt: `Você é Analista Sênior de Business Intelligence da PRIMETOUR (operadora de viagens de luxo).

Sua missão: ao receber um snapshot de dados de um dashboard (ou de um índice/widget específico), gerar 1 a 5 INSIGHTS estruturados que ajudem a operação a tomar decisão. Não descreva o óbvio — analise, contextualize, recomende.

═══════════════════════════════════════════════════════════
DASHBOARDS DISPONÍVEIS E SEUS ÍNDICES
═══════════════════════════════════════════════════════════

1. produtividade (gestão de tarefas)
   Índices: slaGlobal, slaPorSetor, slaPorPessoa, throughput, backlog, csat, tarefasAtraso, distribuicaoStatus, leadTimeMedio, retrabalho

2. ga (Google Analytics — site primetour.com.br)
   Índices: sessions, users, bounceRate, avgSessionDuration, conversions, topPages, channelBreakdown, deviceBreakdown, geoBreakdown, coreWebVitals

3. nl (Newsletters)
   Índices: openRate, ctr, deliverability, unsubRate, topCampaigns, listGrowth, engagementBySegment

4. meta (Instagram/Facebook)
   Índices: reach, impressions, engagementRate, followerGrowth, topPosts, storyCompletion, reelViews, shareOfVoice

5. portal (Portal de Dicas)
   Índices: views, downloads, topDestinations, conversionToBriefing, avgTimeOnPage, sharesByChannel

6. roteiro (Gerador de Roteiros)
   Índices: geracoes, taxaAprovacao, tempoMedioGeracao, topDestinos, topPerfis, custoMedioIA

═══════════════════════════════════════════════════════════
ESCOPO DA ANÁLISE
═══════════════════════════════════════════════════════════

O payload contém:
{
  "dashboard": "<chave>",
  "scope": "widget" | "dashboard" | "cross-dashboard",
  "indexKey": "<chave do índice ou null>",
  "period": { "from": "...", "to": "...", "label": "..." },
  "snapshot": { /* dados resumidos */ },
  "filters": { /* contexto de filtros aplicados */ },
  "previousPeriod": { /* opcional, comparação */ }
}

REGRAS DE ESCOPO:
- scope=widget: foco TOTAL no índice indicado. Insights específicos àquele número/série.
- scope=dashboard: panorama do dashboard inteiro. Cruze múltiplos índices, identifique tendências, contradições, gargalos.
- scope=cross-dashboard: cruze sinais entre dashboards diferentes (ex: pico GA × queda produtividade).

═══════════════════════════════════════════════════════════
METODOLOGIA BI
═══════════════════════════════════════════════════════════

1. CONTEXTUALIZE: compare período atual vs anterior (se houver), identifique sazonalidade
2. SEGMENTE: olhe breakdowns (por setor, canal, dispositivo) — médias enganam
3. PRIORIZE: foque no que é acionável e impactante. Ignore variações <5% sem padrão
4. CORRELACIONE: identifique relações causa→efeito quando os dados sugerirem
5. RECOMENDE: cada insight relevante deve ter uma ação proposta concreta
6. SEJA HONESTO: se não há sinal claro nos dados, diga "sem alteração relevante" — não invente padrões

═══════════════════════════════════════════════════════════
FORMATO DE SAÍDA (JSON OBRIGATÓRIO)
═══════════════════════════════════════════════════════════

Responda APENAS com um array JSON válido, sem markdown, sem explicação fora do JSON:

[
  {
    "title": "headline curto e factual (max 80 chars)",
    "observation": "o achado, com números específicos do snapshot (max 600 chars)",
    "recommendation": "ação proposta, concreta e acionável (max 600 chars). Pode ser '' se não aplicável.",
    "type": "positive" | "negative" | "warning" | "opportunity" | "neutral",
    "impact": "high" | "medium" | "low",
    "indexKey": "chave do índice ancorado, ou null se for análise geral"
  }
]

REGRAS DE TIPO:
- positive: melhora significativa de KPI relevante
- negative: queda significativa de KPI relevante
- warning: sinal de alerta que pede atenção (mas não é queda confirmada)
- opportunity: padrão sugere ação que pode amplificar resultado
- neutral: observação contextual, sem juízo de valor

REGRAS DE IMPACTO:
- high: afeta receita, SLA crítico, marca, clientes-chave
- medium: afeta operação ou métrica importante mas não crítica
- low: contextual, "vale notar"

═══════════════════════════════════════════════════════════
ESTILO
═══════════════════════════════════════════════════════════

- Português brasileiro, tom técnico mas direto
- SEMPRE cite números específicos do snapshot (não "caiu muito" — diga "caiu 15%")
- Evite jargão desnecessário
- Cada insight é independente — não use "como mencionado acima"
- Seja conciso — analista que respeita o tempo de quem lê

═══════════════════════════════════════════════════════════
QUANTIDADE
═══════════════════════════════════════════════════════════

- scope=widget: 1 a 3 insights
- scope=dashboard: 3 a 5 insights
- scope=cross-dashboard: 2 a 4 insights
- Se não houver achado relevante, retorne [] (array vazio). Não force insights pra ter quantidade.`,
    outputFormat: 'json',
    allowWebSearch: false,
    allowedSites: [],
    knowledgeIds: [],
    knowledgeSources: [],
    limits: {
      maxTokensPerRun: 2048,
      temperature: 0.4,
      maxCostPerDayUsd: 5,
      rateLimit: { window: 60, max: 30 },
      timeoutMs: 45000,
    },
    triggers: {
      button: { enabled: false, label: '🤖 Sugerir Insights', position: 'header' },
      context: { enabled: false, label: '' },
      schedule: { enabled: false, mode: 'preset', preset: 'daily' },
      publicChat: { enabled: false, slug: '' },
    },
    visibility: { mode: 'all', value: '' },
    site: {
      welcomeMessage: 'Cole o snapshot de um dashboard e eu gero insights estruturados.',
      suggestedPrompts: [
        '{"dashboard":"produtividade","scope":"dashboard","snapshot":{...}}',
      ],
      brandColor: '#0EA5E9',
      tagline: 'Insights estruturados pra qualquer dashboard',
      footerText: 'PRIMETOUR · BI',
      showAvatar: true, showBranding: true,
    },
  },
];

export async function seedDefaultAgents() {
  if (!store.isMaster() && !store.can('system_manage_settings')) {
    throw new Error('Permissão negada — apenas admin/master.');
  }
  const report = { created: 0, skipped: 0, errors: [] };
  for (const seed of SYSTEM_SEED_AGENTS) {
    try {
      // Check idempotência
      const existing = await getDocs(query(
        collection(db, AGENTS_COL),
        where('migratedFrom.systemSeed', '==', seed.seedId),
        limit(1),
      ));
      if (!existing.empty) { report.skipped++; continue; }
      // Cria com migratedFrom marcador
      const { seedId, ...agentData } = seed;
      await createAgent({
        ...agentData,
        migratedFrom: { source: 'system-seed', sourceId: seedId, systemSeed: seedId, migratedAt: new Date().toISOString() },
      });
      report.created++;
    } catch (e) {
      report.errors.push(`${seed.seedId}: ${e.message}`);
    }
  }
  return report;
}

/**
 * Apaga collections antigas APÓS migração + arquivamento confirmados.
 * Só o admin master pode chamar. Verifica que existe backup antes de apagar.
 */
export async function purgeLegacyCollections({ confirmText } = {}) {
  if (!store.isMaster()) throw new Error('Apenas o master pode apagar collections legadas.');
  if (confirmText !== 'APAGAR LEGADO') {
    throw new Error('Confirmação incorreta. Digite "APAGAR LEGADO" para prosseguir.');
  }
  const report = { skillsPurged: 0, automationsPurged: 0, errors: [] };

  // Skills
  try {
    const sSnap = await getDocs(query(collection(db, 'ai_skills'), limit(500))).catch(() => ({ docs: [] }));
    for (const d of sSnap.docs) {
      // Verifica que tem backup
      const archiveId = `${SKILLS_ARCHIVE_COL}__${d.id}`;
      const archive = await getDoc(doc(db, SKILLS_ARCHIVE_COL, archiveId));
      if (!archive.exists()) {
        report.errors.push(`skill ${d.id}: SEM BACKUP — não apagado`);
        continue;
      }
      await deleteDoc(doc(db, 'ai_skills', d.id));
      report.skillsPurged++;
    }
  } catch (e) {
    report.errors.push(`purge skills: ${e.message}`);
  }
  // Automations
  try {
    const aSnap = await getDocs(query(collection(db, 'ai_automations'), limit(500))).catch(() => ({ docs: [] }));
    for (const d of aSnap.docs) {
      const archiveId = `${AUTOMATIONS_ARCHIVE_COL}__${d.id}`;
      const archive = await getDoc(doc(db, AUTOMATIONS_ARCHIVE_COL, archiveId));
      if (!archive.exists()) {
        report.errors.push(`automation ${d.id}: SEM BACKUP — não apagado`);
        continue;
      }
      await deleteDoc(doc(db, 'ai_automations', d.id));
      report.automationsPurged++;
    }
  } catch (e) {
    report.errors.push(`purge automations: ${e.message}`);
  }
  return report;
}

/* ═══════════════════════════════════════════════════════════
 * KNOWLEDGE LOADERS (R2 / SharePoint / URL)
 *
 * Cada source.type tem um loader que retorna texto bruto pra entrar
 * no prompt. Caches simples por sessão pra evitar re-fetch.
 * ═══════════════════════════════════════════════════════════ */
const _kbCache = new Map(); // key → { ts, text }
const KB_CACHE_TTL = 10 * 60 * 1000; // 10min

async function _fetchUrl(url) {
  const key = 'url:' + url;
  const c = _kbCache.get(key);
  if (c && (Date.now() - c.ts) < KB_CACHE_TTL) return c.text;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    // Sanitiza HTML (extrai só texto visível, simplificado)
    const stripped = text
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000);
    _kbCache.set(key, { ts: Date.now(), text: stripped });
    return stripped;
  } catch (e) {
    return `[Erro ao buscar ${url}: ${e.message}]`;
  }
}

async function _fetchR2(path) {
  // R2 path = caminho dentro do bucket público (ex: 'docs/sla.txt')
  const url = `https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/${path.replace(/^\//, '')}`;
  return _fetchUrl(url);
}

/* App-only token cache pra SharePoint (service-level, não por usuário)
 * SECURITY: client SDK NÃO consegue ler clientSecret (system_secrets é
 * read:false). Cloud Function `getSharePointToken` (Sprint 1) faz a
 * troca client_credentials e retorna apenas o access_token.
 * Por enquanto, mantém fallback de leitura de system_config/sharepoint-app
 * (legacy) — admin migra manualmente quando Cloud Function for deployed. */
let _spAppToken = null; // { token, expiresAt }
async function _getSharePointAppToken() {
  if (_spAppToken && Date.now() < _spAppToken.expiresAt) return _spAppToken.token;
  // Tenta Cloud Function primeiro (segura)
  try {
    const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
    const fn = httpsCallable(getFunctions(), 'getSharePointToken');
    const result = await fn();
    if (result?.data?.access_token) {
      _spAppToken = { token: result.data.access_token, expiresAt: Date.now() + (result.data.expires_in - 300) * 1000 };
      return _spAppToken.token;
    }
  } catch (e) {
    /* Cloud Function não disponível ainda — fallback legacy */
    console.warn('[sharepoint] Cloud Function indisponível, usando fallback Firestore (INSEGURO):', e?.message);
  }
  // FALLBACK LEGADO (será removido na Sprint 1) — lê do system_config
  const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  const cfgSnap = await getDoc(doc(db, 'system_config', 'sharepoint-app'));
  if (!cfgSnap.exists()) throw new Error('SharePoint app não configurado (admin precisa configurar em IA Hub > Conexões)');
  const cfg = cfgSnap.data();
  if (!cfg.tenantId || !cfg.clientId || !cfg.clientSecret) {
    throw new Error('Credenciais incompletas: precisa tenantId+clientId+clientSecret');
  }
  // OAuth2 client_credentials flow
  const url = `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`MS auth ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  _spAppToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 300) * 1000, // -5min margem
  };
  return _spAppToken.token;
}

async function _fetchSharePoint(source) {
  // SharePoint via Graph API com app-only auth (service-level)
  // Cai no token do USER se app credentials não configuradas (fallback retrocompatível)
  let token;
  try {
    token = await _getSharePointAppToken();
  } catch (e) {
    // Fallback: tenta token do user (SSO)
    const userToken = store.get('msAccessToken');
    if (!userToken) {
      return `[SharePoint: ${e.message}. Configure em IA Hub → Conexões.]`;
    }
    token = userToken;
  }

  try {
    let url;
    if (source.fileId) {
      // Arquivo único (preferido — mais rápido que listar pasta)
      url = `https://graph.microsoft.com/v1.0/drives/${source.driveId}/items/${source.fileId}/content`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`Graph ${r.status}`);
      const t = await r.text();
      return `--- ${source.fileName || source.fileId} ---\n${t.slice(0, 12000)}`;
    } else if (source.siteId && source.driveId && source.folderPath) {
      // Lista pasta
      url = `https://graph.microsoft.com/v1.0/sites/${source.siteId}/drives/${source.driveId}/root:/${encodeURIComponent(source.folderPath)}:/children`;
    } else if (source.driveId && source.folderPath) {
      // OneDrive pessoal
      url = `https://graph.microsoft.com/v1.0/drives/${source.driveId}/root:/${encodeURIComponent(source.folderPath)}:/children`;
    } else {
      return `[SharePoint: configure siteId+driveId+folderPath ou fileId]`;
    }

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) return `[SharePoint: token expirado — faça login novamente]`;
    if (!res.ok) throw new Error(`Graph ${res.status}`);
    const data = await res.json();
    const files = (data.value || []).filter(f => f.file && /\.(txt|md|json|csv|html)$/i.test(f.name)).slice(0, 5);
    if (!files.length) return `[SharePoint: pasta sem arquivos textuais — suporta .txt, .md, .json, .csv, .html]`;
    let combined = '';
    for (const f of files) {
      try {
        const r = await fetch(f['@microsoft.graph.downloadUrl']);
        const t = await r.text();
        combined += `\n--- ${f.name} ---\n${t.slice(0, 4000)}\n`;
      } catch {}
    }
    return combined.trim();
  } catch (e) {
    return `[SharePoint erro: ${e.message}]`;
  }
}

async function _fetchGitHub(source) {
  // Source: { type:'github', repo:'owner/repo', path:'docs/', branch:'main', token? }
  if (!source.repo) return `[GitHub: configure repo (owner/name)]`;
  const branch = source.branch || 'main';
  const path = (source.path || '').replace(/^\/+|\/+$/g, '');
  const headers = {};
  // Token opcional pra repos privados (lê de system_config/github)
  if (source.token) {
    headers.Authorization = `Bearer ${source.token}`;
  } else {
    try {
      const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const cfgSnap = await getDoc(doc(db, 'system_config', 'github'));
      if (cfgSnap.exists() && cfgSnap.data().token) {
        headers.Authorization = `Bearer ${cfgSnap.data().token}`;
      }
    } catch {}
  }
  try {
    // Lista conteúdo (pasta) ou pega raw (arquivo único)
    const url = `https://api.github.com/repos/${source.repo}/contents/${path}?ref=${branch}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    if (Array.isArray(data)) {
      // Pasta — pega até 5 arquivos textuais
      const files = data.filter(f => f.type === 'file' && /\.(md|txt|json|yml|yaml|csv|html)$/i.test(f.name)).slice(0, 5);
      let combined = '';
      for (const f of files) {
        try {
          const r = await fetch(f.download_url);
          const t = await r.text();
          combined += `\n--- ${f.name} ---\n${t.slice(0, 4000)}\n`;
        } catch {}
      }
      return combined.trim() || `[GitHub: nenhum arquivo .md/.txt/.json em ${source.repo}/${path}]`;
    } else if (data.type === 'file') {
      // Arquivo único
      const r = await fetch(data.download_url);
      const t = await r.text();
      return `--- ${data.name} ---\n${t.slice(0, 12000)}`;
    }
    return `[GitHub: caminho não é arquivo nem pasta]`;
  } catch (e) {
    return `[GitHub erro: ${e.message}]`;
  }
}

async function _fetchWebhook(source) {
  // Source: { type:'webhook', url, method:'GET'|'POST', headers:{}, body:'' }
  if (!source.url) return `[Webhook: configure url]`;
  const method = (source.method || 'GET').toUpperCase();
  const headers = source.headers || {};
  const init = { method, headers };
  if (method === 'POST' && source.body) {
    init.body = source.body;
    if (!headers['Content-Type']) init.headers['Content-Type'] = 'application/json';
  }
  try {
    const res = await fetch(source.url, init);
    if (!res.ok) throw new Error(`${res.status}`);
    const ct = res.headers.get('content-type') || '';
    let text = await res.text();
    // Se JSON, tenta formatar
    if (ct.includes('json')) {
      try { text = JSON.stringify(JSON.parse(text), null, 2); } catch {}
    }
    return text.length > 12000 ? text.slice(0, 12000) + '\n[... truncado ...]' : text;
  } catch (e) {
    return `[Webhook erro: ${e.message}]`;
  }
}

async function _fetchGoogleDrive(source) {
  // Google Drive via Drive API v3. Token via OAuth Google Identity Services
  // (services/googleDrive.js → signInWithGoogle).
  try {
    const gd = await import('./googleDrive.js');
    if (!gd.isGoogleConnected()) {
      return `[Google Drive: não conectado — vá em IA Hub → Conexões e clique "Conectar Google"]`;
    }
    if (source.fileId) {
      const text = await gd.downloadDriveFileContent({ id: source.fileId, mimeType: source.mimeType });
      return `--- ${source.fileName || source.fileId} ---\n${text}`;
    } else if (source.folderId) {
      const files = await gd.listDriveFiles(source.folderId, { limit: 5 });
      const textual = files.filter(f =>
        /\.(txt|md|json|csv|html)$/i.test(f.name) ||
        f.mimeType === 'application/vnd.google-apps.document' ||
        f.mimeType === 'application/vnd.google-apps.spreadsheet'
      ).slice(0, 5);
      if (!textual.length) return `[Google Drive: pasta sem arquivos textuais ou Docs/Sheets]`;
      let combined = '';
      for (const f of textual) {
        try {
          const t = await gd.downloadDriveFileContent(f);
          combined += `\n--- ${f.name} ---\n${t.slice(0, 4000)}\n`;
        } catch {}
      }
      return combined.trim();
    }
    return `[Google Drive: configure fileId ou folderId na fonte]`;
  } catch (e) {
    return `[Google Drive erro: ${e.message}]`;
  }
}

/**
 * Carrega todas as fontes externas de conhecimento do agente
 * Retorna string consolidada pra colocar no system prompt
 */
export async function loadAgentKnowledge(agent) {
  const parts = [];
  // Knowledge interno (Firestore ai_knowledge)
  if (agent.knowledgeIds?.length) {
    const ai = await import('./ai.js');
    const docs = await ai.loadKnowledgeContents(agent.knowledgeIds);
    docs.forEach(d => parts.push(`### ${d.title}\n${d.content}`));
  }
  // Fontes externas
  const sources = agent.knowledgeSources || [];
  for (const s of sources) {
    try {
      let text = '';
      if (s.type === 'url')             text = await _fetchUrl(s.url);
      else if (s.type === 'r2')         text = await _fetchR2(s.path);
      else if (s.type === 'sharepoint') text = await _fetchSharePoint(s);
      else if (s.type === 'gdrive')     text = await _fetchGoogleDrive(s);
      else if (s.type === 'github')     text = await _fetchGitHub(s);
      else if (s.type === 'webhook')    text = await _fetchWebhook(s);
      const label = s.url || s.path || s.folder || s.folderPath || s.fileName || s.fileId || s.repo || '';
      if (text) parts.push(`### ${s.type}: ${label}\n${text}`);
    } catch (e) {
      parts.push(`### ${s.type}: erro\n${e.message}`);
    }
  }
  return parts.length ? '\n\n=== BASE DE CONHECIMENTO ===\n' + parts.join('\n\n') : '';
}

/* ═══════════════════════════════════════════════════════════
 * EXECUÇÃO DE AGENTE
 * Reusa toda a infra do services/ai.js (chatWithAI, callXxx providers,
 * loadKnowledgeContents, anonimização LGPD) — apenas adiciona overlay
 * de configurações do agente.
 * ═══════════════════════════════════════════════════════════ */
/* Rate limit local (LocalStorage por agente — janela deslizante) */
function _checkRateLimit(agent) {
  const lim = agent.limits?.rateLimit;
  if (!lim?.max || !lim?.window) return;
  const key = 'agent-rate:' + agent.id;
  const now = Date.now();
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(key) || '[]'); } catch {}
  const cutoff = now - (lim.window * 1000);
  arr = arr.filter(t => t > cutoff);
  if (arr.length >= lim.max) {
    throw new Error(`Rate limit: máximo ${lim.max} chamadas a cada ${lim.window}s. Aguarde.`);
  }
  arr.push(now);
  try { localStorage.setItem(key, JSON.stringify(arr)); } catch {}
}

/* Cost cap diário */
async function _checkDailyCost(agent) {
  const cap = agent.limits?.maxCostPerDayUsd;
  if (!cap) return;
  const { collection, getDocs, query, where, Timestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  const today = new Date(); today.setHours(0,0,0,0);
  try {
    const snap = await getDocs(query(collection(db, 'ai_usage_logs'),
      where('agentId', '==', agent.id),
      where('timestamp', '>=', Timestamp.fromDate(today)),
    ));
    let cost = 0;
    snap.docs.forEach(d => {
      const l = d.data();
      // Usa estimativa conservadora ($1/$3 per 1M se não souber)
      cost += ((l.inputTokens||0) * 1 + (l.outputTokens||0) * 3) / 1_000_000;
    });
    if (cost >= cap) {
      throw new Error(`Limite diário atingido ($${cost.toFixed(2)}/$${cap}). Reset à meia-noite.`);
    }
  } catch (e) {
    if (e.message.startsWith('Limite diário')) throw e;
    /* não bloqueia se falhar a leitura do log */
  }
}

export async function runAgent(agentId, userInput, context = {}) {
  const agent = await getAgent(agentId);
  if (!agent) throw new Error('Agente não encontrado.');
  if (!agent.active) throw new Error('Agente está pausado.');

  // Limites operacionais (Fase 7)
  _checkRateLimit(agent);
  await _checkDailyCost(agent);

  const ai = await import('./ai.js');

  // Monta prompt do sistema (agent.systemPrompt + module hints + few-shots)
  const systemParts = [];
  if (agent.systemPrompt) systemParts.push(agent.systemPrompt);
  if (agent.fewShotExamples?.length) {
    systemParts.push('\n=== EXEMPLOS ===');
    agent.fewShotExamples.forEach((ex, i) => {
      systemParts.push(`Exemplo ${i+1}:\nUsuário: ${ex.input}\nAssistente: ${ex.output}`);
    });
  }

  // Carrega TODA base de conhecimento (interno + R2 + SharePoint + URLs)
  const knowledgeText = await loadAgentKnowledge(agent);
  if (knowledgeText) systemParts.push(knowledgeText);

  // Tools filtradas pelo agente (substituí o catalogo padrão se manual)
  if (agent.toolsMode === 'manual' && agent.enabledTools?.length) {
    try {
      const aiActions = await import('./aiActions.js');
      const toolPrompt = aiActions.formatActionsForAgent(agent);
      if (toolPrompt) systemParts.push(toolPrompt);
    } catch {}
  }

  // Web search (busca prévia + injeta resultado no contexto)
  if (agent.allowWebSearch && userInput?.length > 8) {
    try {
      const aiActions = await import('./aiActions.js');
      // Tenta inferir query da mensagem; senão usa a própria mensagem
      const sites = (agent.allowedSites || []).filter(Boolean);
      const results = await aiActions.searchWeb(userInput.slice(0, 200), sites);
      if (Array.isArray(results) && results.length) {
        const top = results.slice(0, 5)
          .map(r => `• ${r.title} — ${r.snippet || ''}\n  ${r.url}`).join('\n');
        systemParts.push(`\n=== BUSCA WEB (resultados recentes) ===\n${top}\n`);
      }
    } catch (e) { console.warn('[agents] web search err:', e?.message); }
  }

  // Valida que existe API key (chatWithAI faz a resolução completa,
  // mas pré-valida pra falhar rápido com mensagem clara)
  const resolved = await ai.resolveApiKey(agent.provider);
  if (!resolved?.apiKey && agent.provider !== 'local') {
    throw new Error(`API Key não configurada para ${agent.provider}. Configure em IA Hub → API Keys.`);
  }

  // Tenta Cloud Function direto (mais limpo + auditável)
  let result;
  try {
    const { callLLMSecure } = await import('./aiSecure.js');
    result = await callLLMSecure({
      provider: agent.provider, model: agent.model,
      systemPrompt: systemParts.join('\n\n'),
      userMessage: userInput,
      history: context.history || [],
      maxTokens:   agent.limits?.maxTokensPerRun || 2048,
      temperature: agent.limits?.temperature ?? 0.3,
      agentId: agent.id, agentName: agent.name,
      agentDailyCapUsd: agent.limits?.maxCostPerDayUsd || 5,
      module: agent.module,
      source: 'runAgent',
    });
  } catch (e) {
    // Fallback ao chatWithAI legacy
    console.warn('[runAgent] Cloud Function falhou, fallback chatWithAI:', e.message);
    result = await ai.chatWithAI(userInput, context, {
      moduleId: agent.module,
      provider: agent.provider, model: agent.model,
      maxTokens:   agent.limits?.maxTokensPerRun || 2048,
      temperature: agent.limits?.temperature ?? 0.3,
      systemPromptOverride: systemParts.join('\n\n'),
      webSearch: agent.allowWebSearch,
      allowedSites: agent.allowedSites,
      skipLog: true,
    });
  }

  // Log: Cloud Function callLLM já loga (com agentId+agentName+TTL).
  // Só adiciona log local se result veio do fallback legacy (sem secured flag)
  if (!result.secured) {
    try {
      const cu = store.get('currentUser');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 90);
      await addDoc(collection(db, 'ai_usage_logs'), {
        agentId, agentName: agent.name,
        module: agent.module,
        provider: result.provider || agent.provider,
        model:    result.model    || agent.model,
        inputTokens:  result.inputTokens  || 0,
        outputTokens: result.outputTokens || 0,
        userId:       cu?.uid || null,
        timestamp:    serverTimestamp(),
        expiresAt:    Timestamp.fromDate(expiresAt),
        source:       'agents-runAgent-legacy',
      });
    } catch (e) { console.warn('[agents] log err:', e?.message); }
  }

  return result;
}
