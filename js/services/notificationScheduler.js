/**
 * PRIMETOUR — Notification Scheduler
 * Verifica periodicamente tarefas atrasadas e com prazo próximo
 * Roda client-side com dedup via localStorage
 */

import { db }    from '../firebase.js';
import { store } from '../store.js';
import {
  collection, getDocs, query, where,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/* ─── Config ─────────────────────────────────────────────── */
const CHECK_INTERVAL   = 30 * 60 * 1000; // 30 minutos
const APPROACHING_HOURS = 48;             // notificar 48h antes do prazo
const DEDUP_KEY         = 'pt_notif_dedup';
const DEDUP_TTL         = 24 * 60 * 60 * 1000; // 24h — não re-notificar no mesmo dia

let _intervalId = null;

/* ─── Dedup helpers (localStorage) ───────────────────────── */
function getDedupMap() {
  try {
    const raw = localStorage.getItem(DEDUP_KEY);
    if (!raw) return {};
    const map = JSON.parse(raw);
    const now = Date.now();
    // Limpar entradas expiradas
    for (const key of Object.keys(map)) {
      if (now - map[key] > DEDUP_TTL) delete map[key];
    }
    return map;
  } catch { return {}; }
}

function markNotified(key) {
  const map = getDedupMap();
  map[key] = Date.now();
  try { localStorage.setItem(DEDUP_KEY, JSON.stringify(map)); } catch {}
}

function wasNotified(key) {
  const map = getDedupMap();
  return !!map[key];
}

/* ─── Core check ─────────────────────────────────────────── */
async function checkDeadlines() {
  const currentUser = store.get('currentUser');
  if (!currentUser?.uid) return;

  // Buscar tarefas ativas (não concluídas/canceladas) com dueDate
  const activeStatuses = ['not_started', 'in_progress', 'review', 'rework'];
  let tasks = [];

  // Firestore 'in' query limited to 10 values — activeStatuses has 4, so it's fine
  try {
    const snap = await getDocs(
      query(collection(db, 'tasks'), where('status', 'in', activeStatuses))
    );
    tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[NotifScheduler] Erro ao buscar tarefas:', e);
    return;
  }

  // Filtrar apenas tarefas com dueDate
  const now = new Date();
  const { notify } = await import('./notifications.js');

  for (const task of tasks) {
    if (!task.dueDate) continue;

    const due = task.dueDate?.toDate?.() || new Date(task.dueDate);
    if (isNaN(due.getTime())) continue;

    const hoursUntilDue = (due - now) / (1000 * 60 * 60);
    const assignees = Array.isArray(task.assignedTo) ? task.assignedTo
                    : task.assignedTo ? [task.assignedTo] : [];
    const recipients = [...new Set([task.createdBy, ...assignees].filter(Boolean))];
    if (!recipients.length) continue;

    const taskTitle = task.title || 'Tarefa sem título';

    // 1) Tarefa atrasada (prazo já passou)
    if (hoursUntilDue < 0) {
      const dedupKey = `overdue_${task.id}_${now.toISOString().slice(0, 10)}`;
      if (!wasNotified(dedupKey)) {
        const daysLate = Math.ceil(Math.abs(hoursUntilDue) / 24);
        notify('task.overdue', {
          entityType: 'task',
          entityId:   task.id,
          recipientIds: recipients,
          title: 'Tarefa atrasada',
          body:  `"${taskTitle}" — ${daysLate} dia${daysLate > 1 ? 's' : ''} de atraso`,
          route: 'tasks',
          priority: 'high',
          category: 'task',
        }).catch(() => {});
        markNotified(dedupKey);
      }
    }
    // 2) Prazo próximo (dentro de APPROACHING_HOURS)
    else if (hoursUntilDue <= APPROACHING_HOURS && hoursUntilDue > 0) {
      const dedupKey = `approaching_${task.id}_${now.toISOString().slice(0, 10)}`;
      if (!wasNotified(dedupKey)) {
        const hoursLeft = Math.round(hoursUntilDue);
        const label = hoursLeft >= 24
          ? `${Math.ceil(hoursLeft / 24)} dia${Math.ceil(hoursLeft / 24) > 1 ? 's' : ''}`
          : `${hoursLeft}h`;
        notify('task.deadline_approaching', {
          entityType: 'task',
          entityId:   task.id,
          recipientIds: recipients,
          title: 'Prazo próximo',
          body:  `"${taskTitle}" — vence em ${label}`,
          route: 'tasks',
          priority: 'normal',
          category: 'task',
        }).catch(() => {});
        markNotified(dedupKey);
      }
    }
  }
}

/* ─── Lifecycle ──────────────────────────────────────────── */

/**
 * Inicia o scheduler. Roda a primeira verificação após 10s (para não bloquear login)
 * e depois a cada CHECK_INTERVAL.
 */
export function startScheduler() {
  stopScheduler();
  // Primeira verificação com delay para não impactar o carregamento
  setTimeout(() => {
    checkDeadlines().catch(e => console.warn('[NotifScheduler]', e));
  }, 10_000);
  _intervalId = setInterval(() => {
    checkDeadlines().catch(e => console.warn('[NotifScheduler]', e));
  }, CHECK_INTERVAL);
}

export function stopScheduler() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
}
