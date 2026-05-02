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

export async function createAgent(data) {
  const payload = normalizeAgent(data);
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
 * EXECUÇÃO DE AGENTE
 * Reusa toda a infra do services/ai.js (chatWithAI, callXxx providers,
 * loadKnowledgeContents, anonimização LGPD) — apenas adiciona overlay
 * de configurações do agente.
 * ═══════════════════════════════════════════════════════════ */
export async function runAgent(agentId, userInput, context = {}) {
  const agent = await getAgent(agentId);
  if (!agent) throw new Error('Agente não encontrado.');
  if (!agent.active) throw new Error('Agente está pausado.');

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

  // Carrega knowledge interno
  if (agent.knowledgeIds?.length) {
    const docs = await ai.loadKnowledgeContents(agent.knowledgeIds);
    if (docs.length) {
      systemParts.push('\n=== BASE DE CONHECIMENTO ===');
      docs.forEach(d => systemParts.push(`### ${d.title}\n${d.content}`));
    }
  }

  // Valida que existe API key (chatWithAI faz a resolução completa,
  // mas pré-valida pra falhar rápido com mensagem clara)
  const resolved = await ai.resolveApiKey(agent.provider);
  if (!resolved?.apiKey && agent.provider !== 'local') {
    throw new Error(`API Key não configurada para ${agent.provider}. Configure em IA Hub → API Keys.`);
  }

  // Reusa chatWithAI passando systemPrompt explícito
  const result = await ai.chatWithAI(userInput, context, {
    moduleId: agent.module,
    provider: agent.provider,
    model:    agent.model,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    systemPromptOverride: systemParts.join('\n\n'),
    webSearch: agent.allowWebSearch,
    allowedSites: agent.allowedSites,
  });

  // Log com agentId
  try {
    const cu = store.get('currentUser');
    await addDoc(collection(db, 'ai_usage_logs'), {
      agentId, agentName: agent.name,
      module: agent.module,
      provider: result.provider || agent.provider,
      model:    result.model    || agent.model,
      inputTokens:  result.inputTokens  || 0,
      outputTokens: result.outputTokens || 0,
      userId:       cu?.uid || null,
      timestamp:    serverTimestamp(),
    });
  } catch (e) { console.warn('[agents] log err:', e?.message); }

  return result;
}
