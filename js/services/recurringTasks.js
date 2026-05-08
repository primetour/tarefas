/**
 * PRIMETOUR — Recurring Tasks Service
 *
 * Templates de tarefas recorrentes. A geração das instâncias concretas é
 * LAZY (sob demanda): sempre que o usuário abre a página de tarefas, o
 * runDueRecurrenceGeneration() verifica quais templates têm instâncias
 * devidas (até hoje) e cria as tarefas que faltam.
 *
 * Estrutura do template (collection `recurring_task_templates`):
 * {
 *   active: boolean,
 *   taskData: { title, description, priority, assignees, projectId,
 *               tags, nucleos, requestingArea, typeId, ... },
 *   frequency: 'daily' | 'weekly' | 'monthly' | 'custom',
 *   // para 'weekly'
 *   weekdays: number[],           // 0=Dom ... 6=Sáb
 *   // para 'monthly'
 *   monthDay: number,             // 1..31 ('L' = último)
 *   // para 'custom'
 *   intervalDays: number,         // a cada N dias
 *   startDate: string (ISO),      // começa a gerar a partir daqui
 *   endDate:   string (ISO)|null, // parar após essa data
 *   lastGeneratedFor: string|null,// última data (ISO) para a qual gerou
 *   dueOffsetDays: number,        // [DEPRECATED 4.32.2] usado apenas como
 *                                 //   FALLBACK quando o tipo da tarefa não tem
 *                                 //   slaDays configurado. Em templates novos
 *                                 //   este campo é sempre 0 — o prazo vem do
 *                                 //   SLA do tipo (calcSla, dias úteis).
 *   createdAt, createdBy, createdByName
 * }
 */

import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, where, limit, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';
import { createTask } from './tasks.js';
import { auditLog } from '../auth/audit.js';

const COL = 'recurring_task_templates';

/* ─── Limites de segurança ───────────────────────────────── */
// Toda recorrência precisa ter endDate. Templates legacy sem endDate ganham
// fallback de 12 meses a partir de startDate. Limite hard cap pro form é 24m.
export const MAX_RECURRENCE_MONTHS = 24;
export const DEFAULT_MAX_RECURRENCE_MONTHS = 12; // fallback p/ templates legacy
// Máximo de instâncias criadas em uma única chamada (proteção contra rodada
// massiva — ex: template muito antigo descongelado depois de meses)
const MAX_INSTANCES_PER_RUN = 30;

/* ─── Utils de data ──────────────────────────────────────── */
// IMPORTANTE: usar timezone LOCAL para toISO, não UTC. Antes (toISOString())
// causava bug de timezone: tarefa de '2026-05-04' criada às 21:30 BRT
// virava '2026-05-05' (porque UTC estava no dia seguinte).
function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function fromISO(s)    { return new Date(s + 'T12:00:00'); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d, n) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }

/**
 * Retorna o endDate efetivo do template. Se não estiver setado (template
 * legacy criado antes do fix de mai/2026), aplica fallback de 12 meses a
 * partir de startDate.
 */
function getEffectiveEndDate(template) {
  if (template.endDate) return fromISO(template.endDate);
  const start = fromISO(template.startDate);
  return addMonths(start, DEFAULT_MAX_RECURRENCE_MONTHS);
}

/** Retorna as datas (ISO) em que o template deveria ter gerado instância,
 *  entre (last+1 ou start) e min(hoje, endDate). Limita a MAX_INSTANCES_PER_RUN
 *  para evitar rodada massiva caso template fique muito tempo dormido. */
function computeDueOccurrences(template, todayISO) {
  const start   = fromISO(template.startDate);
  const end     = getEffectiveEndDate(template);
  const today   = fromISO(todayISO);
  const lastGen = template.lastGeneratedFor ? fromISO(template.lastGeneratedFor) : null;
  let cursor    = lastGen ? addDays(lastGen, 1) : new Date(start);
  if (cursor < start) cursor = new Date(start);

  // Não passa do endDate em hipótese alguma
  const horizon = today < end ? today : end;

  const dates = [];
  let safety = 0;
  while (cursor <= horizon && safety < 400 && dates.length < MAX_INSTANCES_PER_RUN) {
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
    if (match) dates.push(toISO(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
}

/**
 * Idempotência real: dado um templateId e um occISO, retorna true se já
 * existe alguma task em `tasks` com esses 2 campos. Usado em
 * runDueRecurrenceGeneration ANTES de criar pra prevenir duplicação por
 * race condition (multi-aba/multi-user/dupla-click).
 *
 * Custo: 1 read por occorrência candidata. Aceitável (max 30 por run).
 */
async function instanceAlreadyExists(templateId, occISO) {
  try {
    const q = query(
      collection(db, 'tasks'),
      where('recurringFromTemplateId', '==', templateId),
      where('recurringOccurrence', '==', occISO),
      limit(1),
    );
    const snap = await getDocs(q);
    return !snap.empty;
  } catch (e) {
    // Se a query falhar (ex: índice composto faltando), retornar false
    // pra não bloquear a criação. Pior caso: duplicação isolada (recoverable).
    console.warn('[recurringTasks] instance-exists check fail:', e?.message || e);
    return false;
  }
}

/* ─── CRUD ───────────────────────────────────────────────── */
export async function listTemplates() {
  const snap = await getDocs(collection(db, COL));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getTemplate(id) {
  const snap = await getDoc(doc(db, COL, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Gates: criar/editar exige task_create; excluir exige task_delete OU ser
// o próprio criador. Master sempre pode tudo.
function _canManageRecurring() {
  return store.isMaster() || store.can('task_create');
}

/**
 * Validações comuns para template (criação e edição).
 * - startDate obrigatório
 * - endDate obrigatório (decidido em mai/2026 — recorrência sem fim
 *   gerava tasks pra sempre, enchendo o banco)
 * - endDate >= startDate
 * - endDate dentro do MAX_RECURRENCE_MONTHS (24 meses)
 * - weekly: pelo menos 1 weekday
 */
function validateTemplate(data) {
  if (!data.startDate) throw new Error('Data de início é obrigatória.');
  if (!data.endDate)   throw new Error('Data de encerramento é obrigatória — defina por quanto tempo a recorrência deve gerar tarefas.');
  const start = fromISO(data.startDate);
  const end = fromISO(data.endDate);
  if (end < start) throw new Error('Data de encerramento não pode ser antes da data de início.');
  const maxEnd = addMonths(start, MAX_RECURRENCE_MONTHS);
  if (end > maxEnd) throw new Error(`Recorrência limitada a ${MAX_RECURRENCE_MONTHS} meses. Reduza o período ou crie um novo template depois.`);
  if (data.frequency === 'weekly' && (!Array.isArray(data.weekdays) || data.weekdays.length === 0)) {
    throw new Error('Selecione ao menos um dia da semana.');
  }
}

export async function createTemplate(data) {
  if (!_canManageRecurring()) throw new Error('Permissão negada: você não pode criar tarefas recorrentes.');
  validateTemplate(data);
  const user = store.get('currentUser');
  const profile = store.get('userProfile') || {};
  const ref = await addDoc(collection(db, COL), {
    ...data,
    active: data.active !== false,
    lastGeneratedFor: data.lastGeneratedFor || null,
    // 4.32.2+ Default 0: prazo vem do SLA do tipo. Templates legacy mantêm
    // o valor existente (não sobrescreve em update sem o campo explícito).
    dueOffsetDays: Number(data.dueOffsetDays) || 0,
    createdAt:     serverTimestamp(),
    createdBy:     user?.uid || '',
    createdByName: profile.name || user?.email || '',
  });
  await auditLog('recurring_tasks.create', 'recurring_task_template', ref.id, {
    title: data.taskData?.title || '',
    frequency: data.frequency,
    startDate: data.startDate,
    endDate: data.endDate,
  }).catch(() => {});
  return ref.id;
}

export async function updateTemplate(id, patch) {
  if (!_canManageRecurring()) throw new Error('Permissão negada: você não pode editar tarefas recorrentes.');
  // Se a edição toca em campos de recorrência, re-valida o template como um
  // todo (precisa ler o atual pra mesclar). Edições "técnicas" (lastGeneratedFor,
  // updatedAt) não exigem re-validação.
  const touchesScheduling = ['startDate','endDate','frequency','weekdays','monthDay','intervalDays'].some(k => k in patch);
  if (touchesScheduling) {
    const cur = await getTemplate(id);
    if (!cur) throw new Error('Template não encontrado.');
    validateTemplate({ ...cur, ...patch });
  }
  await updateDoc(doc(db, COL, id), { ...patch, updatedAt: serverTimestamp() });
}

export async function deleteTemplate(id) {
  const tpl = await getTemplate(id);
  const uid = store.get('currentUser')?.uid;
  const isOwner = tpl && tpl.createdBy === uid;
  if (!store.isMaster() && !store.can('task_delete') && !isOwner) {
    throw new Error('Permissão negada: você não pode excluir esta recorrência.');
  }
  await deleteDoc(doc(db, COL, id));
}

/* ─── Geração lazy ───────────────────────────────────────── */
let _running = false;
let _lastRunAt = 0;
const RUN_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutos entre execuções

export async function runDueRecurrenceGeneration({ force = false } = {}) {
  if (_running) return { skipped: 'already-running' };
  if (!force && (Date.now() - _lastRunAt) < RUN_COOLDOWN_MS) return { skipped: 'cooldown' };
  _running = true;
  _lastRunAt = Date.now();

  const report = { templates: 0, created: 0, skipped: 0, alreadyExists: 0, errors: 0 };
  try {
    const snap = await getDocs(query(collection(db, COL), where('active', '==', true)));
    const today = new Date();
    const todayISO = toISO(today);

    for (const d of snap.docs) {
      report.templates++;
      const template = { id: d.id, ...d.data() };
      try {
        const dates = computeDueOccurrences(template, todayISO);
        if (!dates.length) { report.skipped++; continue; }

        let lastCreatedFor = template.lastGeneratedFor || null;
        for (const occISO of dates) {
          // ── IDEMPOTÊNCIA HARD via ID DETERMINÍSTICO ──
          // Antes (mai/2026): 2 abas/users podiam ler lastGeneratedFor=null
          // simultaneamente, ambos computavam mesmas datas, ambos criavam tasks
          // → DUPLICAÇÃO. Cooldown intra-session protegia, mas cross-session
          // (multi-aba/user) não.
          // Agora: ID da task = `rec_${tplId}_${occISO}` (determinístico).
          // 2 sessions concorrentes que tentem criar a mesma instância acabam
          // no MESMO doc — Firestore garante uniqueness por docId. Não
          // duplica nem sobrescreve dados existentes (createTask faz getDoc
          // antes de setDoc; se existir, retorna o existente).
          // Quick check pra otimizar: se já existe, pula sem chamar createTask
          // (evita audit log redundante)
          const detId = `rec_${template.id}_${occISO}`;
          const exists = await instanceAlreadyExists(template.id, occISO);
          if (exists) {
            report.alreadyExists++;
            if (!lastCreatedFor || occISO > lastCreatedFor) lastCreatedFor = occISO;
            continue;
          }

          const occDate = fromISO(occISO);
          const base = template.taskData || {};
          // 4.32.2+ Prazo: deixa createTask() calcular via SLA do tipo (dias úteis).
          // Só seta dueDate manualmente se o template TEM dueOffsetDays > 0
          // (templates legacy criados antes desta versão) E o tipo da tarefa
          // NÃO tem slaDays configurado (fallback de compat).
          let dueDate = null;
          const offset = Number(template.dueOffsetDays) || 0;
          if (offset > 0) {
            // Verifica se o tipo tem SLA — se sim, ignora offset (SLA prevalece)
            const types = store.get('taskTypes') || [];
            const t = types.find(tt => tt.id === base.typeId);
            const hasSla = t && (
              (Array.isArray(t.variations) && t.variations.some(v => Number(v.slaDays) >= 0)) ||
              (t.sla?.days != null)
            );
            if (!hasSla) dueDate = addDays(occDate, offset);
          }
          const task = {
            ...base,
            title:        base.title || 'Tarefa recorrente',
            assignees:    Array.isArray(base.assignees) ? base.assignees : [],
            tags:         Array.isArray(base.tags)      ? base.tags      : [],
            nucleos:      Array.isArray(base.nucleos)   ? base.nucleos   : [],
            status:       'not_started',
            ...(dueDate ? { dueDate } : {}),  // só passa dueDate se tem fallback
            startDate:    occDate,
            recurringFromTemplateId: template.id,
            recurringOccurrence: occISO,
            _deterministicId: detId,  // garantia hard de idempotência
          };
          try {
            await createTask(task);
            report.created++;
            lastCreatedFor = occISO;
          } catch (e) {
            console.warn('[recurringTasks] createTask failed:', e?.message || e);
            report.errors++;
          }
        }
        if (lastCreatedFor && lastCreatedFor !== template.lastGeneratedFor) {
          // Update direto (não passa por validateTemplate — só lastGeneratedFor)
          await updateDoc(doc(db, COL, template.id), {
            lastGeneratedFor: lastCreatedFor,
            updatedAt: serverTimestamp(),
          }).catch(e => console.warn('[recurringTasks] updateLastGen fail:', e?.message));
        }
      } catch (e) {
        console.warn('[recurringTasks] template error:', e?.message || e);
        report.errors++;
      }
    }
  } catch (e) {
    console.warn('[recurringTasks] fatal:', e?.message || e);
  } finally {
    _running = false;
  }
  return report;
}

/** Rótulo humano para a frequência (usado na UI). */
export function describeFrequency(template) {
  if (!template) return '';
  if (template.frequency === 'daily') return 'Diariamente';
  if (template.frequency === 'weekly') {
    const names = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    const days = (template.weekdays || []).map(d => names[d]).join(', ');
    return `Semanal (${days || '—'})`;
  }
  if (template.frequency === 'monthly') return `Mensal (dia ${template.monthDay || 1})`;
  if (template.frequency === 'custom') return `A cada ${template.intervalDays || 1} dia(s)`;
  return template.frequency || '';
}
