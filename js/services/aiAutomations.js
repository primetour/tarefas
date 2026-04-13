/**
 * PRIMETOUR — AI Automations Service
 * CRUD e execução de automações de IA agendadas
 *
 * Automações são tarefas que rodam periodicamente usando a IA:
 * - Buscar notícias de viagem em sites específicos
 * - Monitorar citações da PRIMETOUR (clipping)
 * - Gerar relatórios automáticos
 * - Executar skills em horários definidos
 */

import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp, Timestamp, increment,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';

const COL = 'ai_automations';

/* ─── Frequências suportadas ────────────────────────────── */
export const FREQUENCIES = [
  { id: 'manual',   label: 'Manual (sob demanda)',   icon: '▶' },
  { id: 'hourly',   label: 'A cada hora',            icon: '⏱' },
  { id: 'daily',    label: 'Diária',                 icon: '◷' },
  { id: 'weekly',   label: 'Semanal',                icon: '◈' },
  { id: 'monthly',  label: 'Mensal',                 icon: '◉' },
];

/* ─── Tipos de automação ────────────────────────────────── */
export const AUTOMATION_TYPES = [
  { id: 'news_search',     label: 'Buscar Notícias',          icon: '◉', module: 'news-monitor',
    desc: 'Vasculha sites de viagem por notícias relevantes e adiciona ao módulo de Notícias.' },
  { id: 'clipping_search', label: 'Monitorar Clipping',       icon: '◎', module: 'news-monitor',
    desc: 'Busca citações sobre a PRIMETOUR na internet e adiciona ao Clipping.' },
  { id: 'skill_execution', label: 'Executar Skill',           icon: '◈', module: 'general',
    desc: 'Executa uma skill de IA em horário agendado com prompt customizado.' },
  { id: 'report_generate', label: 'Gerar Relatório',          icon: '◫', module: 'dashboards',
    desc: 'Gera resumo automático de KPIs e envia para o painel.' },
  { id: 'task_reminder',   label: 'Lembrete Inteligente',     icon: '✓', module: 'tasks',
    desc: 'Analisa tarefas pendentes e gera resumos/alertas via IA.' },
];

/* ─── CRUD ──────────────────────────────────────────────── */

/**
 * Listar todas as automações
 */
export async function fetchAutomations() {
  const snap = await getDocs(query(collection(db, COL), orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Buscar uma automação por ID
 */
export async function fetchAutomation(id) {
  const snap = await getDoc(doc(db, COL, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * Criar automação
 */
export async function createAutomation(data) {
  const user = store.get('currentUser');
  const profile = store.get('userProfile');

  const docData = {
    name:        data.name || 'Nova Automação',
    description: data.description || '',
    type:        data.type || 'skill_execution',
    module:      data.module || 'general',
    frequency:   data.frequency || 'daily',
    active:      data.active !== false,

    // Config específica por tipo
    config: {
      prompt:     data.config?.prompt || '',
      skillId:    data.config?.skillId || '',
      sources:    data.config?.sources || [],     // URLs para news_search / clipping_search
      keywords:   data.config?.keywords || [],    // palavras-chave de busca
      provider:   data.config?.provider || '',    // provider override (vazio = padrão)
      maxResults: data.config?.maxResults || 5,
    },

    // Schedule
    schedule: {
      time:      data.schedule?.time || '08:00',    // HH:mm
      dayOfWeek: data.schedule?.dayOfWeek ?? null,  // 0-6 (para weekly)
      dayOfMonth: data.schedule?.dayOfMonth ?? null, // 1-31 (para monthly)
    },

    // Tracking
    lastRunAt:    null,
    lastRunStatus: null,  // 'success' | 'error'
    lastRunResult: '',
    runCount:     0,
    errorCount:   0,

    createdBy:    user?.uid || null,
    createdByName: profile?.name || '',
    createdAt:    serverTimestamp(),
    updatedAt:    serverTimestamp(),
  };

  const ref = await addDoc(collection(db, COL), docData);
  return ref.id;
}

/**
 * Atualizar automação
 */
export async function updateAutomation(id, data) {
  const updates = { ...data, updatedAt: serverTimestamp() };
  // Remove campos que não devem ser atualizados diretamente
  delete updates.id;
  delete updates.createdAt;
  delete updates.createdBy;
  await updateDoc(doc(db, COL, id), updates);
}

/**
 * Deletar automação
 */
export async function deleteAutomation(id) {
  await deleteDoc(doc(db, COL, id));
}

/**
 * Registrar execução de automação
 */
export async function logAutomationRun(id, success, result = '') {
  const updates = {
    lastRunAt:     serverTimestamp(),
    lastRunStatus: success ? 'success' : 'error',
    lastRunResult: typeof result === 'string' ? result.substring(0, 500) : JSON.stringify(result).substring(0, 500),
    updatedAt:     serverTimestamp(),
  };

  // Use atomic increment — no extra read needed
  updates.runCount   = increment(1);
  updates.errorCount = success ? increment(0) : increment(1);

  await updateDoc(doc(db, COL, id), updates);
}

/* ─── Scheduler (client-side) ───────────────────────────── */

let _automationInterval = null;
const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutos
const DEDUP_KEY = 'pt_automation_dedup';

function getDedupMap() {
  try {
    const raw = localStorage.getItem(DEDUP_KEY);
    if (!raw) return {};
    const map = JSON.parse(raw);
    const now = Date.now();
    for (const key of Object.keys(map)) {
      if (now - map[key] > 24 * 60 * 60 * 1000) delete map[key]; // 24h TTL
    }
    return map;
  } catch { return {}; }
}

function markRun(key) {
  const map = getDedupMap();
  map[key] = Date.now();
  try { localStorage.setItem(DEDUP_KEY, JSON.stringify(map)); } catch {}
}

function wasRunRecently(key) {
  return !!getDedupMap()[key];
}

/**
 * Calcula a chave de dedup baseada na frequência
 */
function dedupKey(automation) {
  const now = new Date();
  const id = automation.id;
  switch (automation.frequency) {
    case 'hourly':
      return `${id}_${now.toISOString().slice(0, 13)}`; // hora
    case 'daily':
      return `${id}_${now.toISOString().slice(0, 10)}`; // dia
    case 'weekly': {
      // Semana ISO (simplificado: usa dia do ano / 7)
      const start = new Date(now.getFullYear(), 0, 1);
      const week = Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000));
      return `${id}_w${week}`;
    }
    case 'monthly':
      return `${id}_${now.toISOString().slice(0, 7)}`; // mês
    default:
      return `${id}_manual`;
  }
}

/**
 * Verifica se é o momento de rodar (baseado no schedule)
 */
function shouldRunNow(automation) {
  if (!automation.active) return false;
  if (automation.frequency === 'manual') return false;

  const now = new Date();
  const [schedHour, schedMin] = (automation.schedule?.time || '08:00').split(':').map(Number);

  // Hourly: roda a cada hora no minuto agendado (±5min)
  if (automation.frequency === 'hourly') {
    return Math.abs(now.getMinutes() - schedMin) <= 5;
  }

  // Daily, weekly, monthly: verificar hora (±5min)
  const currentMins = now.getHours() * 60 + now.getMinutes();
  const schedMins   = schedHour * 60 + schedMin;
  if (Math.abs(currentMins - schedMins) > 5) return false;

  // Weekly: verificar dia da semana
  if (automation.frequency === 'weekly') {
    const dow = automation.schedule?.dayOfWeek;
    if (dow != null && now.getDay() !== dow) return false;
  }

  // Monthly: verificar dia do mês
  if (automation.frequency === 'monthly') {
    const dom = automation.schedule?.dayOfMonth;
    if (dom != null && now.getDate() !== dom) return false;
  }

  return true;
}

/**
 * Executa uma automação individual
 */
export async function executeAutomation(automation) {
  const { chatWithAI } = await import('./ai.js');

  const typeInfo = AUTOMATION_TYPES.find(t => t.id === automation.type) || {};
  let prompt = '';

  switch (automation.type) {
    case 'news_search':
      prompt = `Busque notícias recentes sobre viagens e turismo. ` +
        (automation.config?.keywords?.length
          ? `Foque nos temas: ${automation.config.keywords.join(', ')}. `
          : '') +
        `Para cada notícia encontrada, use a ação create_news para cadastrar no sistema. ` +
        `Limite a ${automation.config?.maxResults || 5} notícias.`;
      break;

    case 'clipping_search':
      prompt = `Busque na internet citações e menções sobre "PRIMETOUR" ou "Prime Tour". ` +
        `Para cada menção encontrada, use a ação create_clipping para cadastrar no sistema. ` +
        `Limite a ${automation.config?.maxResults || 5} resultados.`;
      break;

    case 'skill_execution':
      prompt = automation.config?.prompt || 'Execute a tarefa configurada.';
      break;

    case 'report_generate':
      prompt = `Analise os dados visíveis no dashboard e gere um resumo executivo dos principais KPIs. ` +
        (automation.config?.prompt || '');
      break;

    case 'task_reminder':
      prompt = `Liste as tarefas pendentes que estão próximas do prazo ou atrasadas. ` +
        `Gere um resumo inteligente com recomendações de priorização.`;
      break;

    default:
      prompt = automation.config?.prompt || 'Execute a automação configurada.';
  }

  try {
    const result = await chatWithAI(prompt, {
      module: automation.module || typeInfo.module || 'general',
      skillId: automation.config?.skillId || null,
    });

    await logAutomationRun(automation.id, true, result?.text?.substring(0, 300) || 'OK');
    return { success: true, result: result?.text || '' };
  } catch (err) {
    await logAutomationRun(automation.id, false, err.message || 'Erro desconhecido');
    return { success: false, error: err.message };
  }
}

/**
 * Verifica e executa automações pendentes
 */
async function checkAndRunAutomations() {
  try {
    const automations = await fetchAutomations();
    for (const auto of automations) {
      if (!shouldRunNow(auto)) continue;
      const key = dedupKey(auto);
      if (wasRunRecently(key)) continue;

      markRun(key);
      console.log(`[AIAutomation] Executando: ${auto.name}`);
      executeAutomation(auto).catch(err =>
        console.warn(`[AIAutomation] Erro em "${auto.name}":`, err)
      );
    }
  } catch (err) {
    console.warn('[AIAutomation] Erro ao verificar automações:', err);
  }
}

/**
 * Inicia o scheduler de automações
 */
export function startAutomationScheduler() {
  stopAutomationScheduler();
  // Primeira verificação após 30s
  setTimeout(() => {
    checkAndRunAutomations().catch(() => {});
  }, 30_000);
  _automationInterval = setInterval(() => {
    checkAndRunAutomations().catch(() => {});
  }, CHECK_INTERVAL);
}

/**
 * Para o scheduler
 */
export function stopAutomationScheduler() {
  if (_automationInterval) {
    clearInterval(_automationInterval);
    _automationInterval = null;
  }
}
