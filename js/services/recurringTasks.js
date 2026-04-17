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
 *   dueOffsetDays: number,        // prazo = data da ocorrência + offset
 *   createdAt, createdBy, createdByName
 * }
 */

import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, where, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';
import { createTask } from './tasks.js';

const COL = 'recurring_task_templates';

/* ─── Utils de data ──────────────────────────────────────── */
function toISO(d)      { return d.toISOString().slice(0, 10); }
function fromISO(s)    { return new Date(s + 'T12:00:00'); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

/** Retorna as datas (ISO) em que o template deveria ter gerado instância,
 *  entre (last+1 ou start) e hoje. Limita a 60 datas para segurança. */
function computeDueOccurrences(template, todayISO) {
  const start   = fromISO(template.startDate);
  const end     = template.endDate ? fromISO(template.endDate) : null;
  const today   = fromISO(todayISO);
  const lastGen = template.lastGeneratedFor ? fromISO(template.lastGeneratedFor) : null;
  let cursor    = lastGen ? addDays(lastGen, 1) : new Date(start);
  if (cursor < start) cursor = new Date(start);

  const dates = [];
  let safety = 0;
  while (cursor <= today && safety < 90) {
    safety++;
    if (end && cursor > end) break;
    let match = false;
    if (template.frequency === 'daily') {
      match = true;
    } else if (template.frequency === 'weekly') {
      match = Array.isArray(template.weekdays) && template.weekdays.includes(cursor.getDay());
    } else if (template.frequency === 'monthly') {
      const day = Number(template.monthDay) || 1;
      // Suporta 'último dia': usar 0 na clonagem
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

export async function createTemplate(data) {
  if (!_canManageRecurring()) throw new Error('Permissão negada: você não pode criar tarefas recorrentes.');
  const user = store.get('currentUser');
  const profile = store.get('userProfile') || {};
  const ref = await addDoc(collection(db, COL), {
    ...data,
    active: data.active !== false,
    lastGeneratedFor: data.lastGeneratedFor || null,
    dueOffsetDays: Number(data.dueOffsetDays) || 0,
    createdAt:     serverTimestamp(),
    createdBy:     user?.uid || '',
    createdByName: profile.name || user?.email || '',
  });
  return ref.id;
}

export async function updateTemplate(id, patch) {
  if (!_canManageRecurring()) throw new Error('Permissão negada: você não pode editar tarefas recorrentes.');
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

  const report = { templates: 0, created: 0, skipped: 0, errors: 0 };
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
          const occDate = fromISO(occISO);
          const dueDate = addDays(occDate, Number(template.dueOffsetDays) || 0);
          const base = template.taskData || {};
          // Garante arrays defensivos
          const task = {
            ...base,
            title:        base.title || 'Tarefa recorrente',
            assignees:    Array.isArray(base.assignees) ? base.assignees : [],
            tags:         Array.isArray(base.tags)      ? base.tags      : [],
            nucleos:      Array.isArray(base.nucleos)   ? base.nucleos   : [],
            status:       'not_started',
            dueDate:      dueDate,
            startDate:    occDate,
            recurringFromTemplateId: template.id,
            recurringOccurrence: occISO,
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
          await updateTemplate(template.id, { lastGeneratedFor: lastCreatedFor });
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
