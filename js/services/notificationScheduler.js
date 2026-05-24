/**
 * PRIMETOUR — Notification Scheduler
 * Verifica periodicamente tarefas atrasadas e com prazo próximo.
 * Roda client-side com dedup via localStorage.
 *
 * Otimizações de leituras (free tier):
 *   - Reusa o cache do fetchTasks() em vez de disparar getDocs próprio.
 *     Quando subscribeToTasks() está ativo, o cache já está populado
 *     pelo onSnapshot — checkDeadlines() não cobra read nenhum.
 *   - Pausa quando a aba está hidden (Page Visibility API via pollScheduler).
 *   - Tick a cada 1h em vez de 30min — janelas de 48h tornam isso suficiente.
 */

import { store }       from '../store.js';
import { fetchTasks }  from './tasks.js';
import { startPolling } from './pollScheduler.js';

/* ─── Config ─────────────────────────────────────────────── */
const CHECK_INTERVAL    = 60 * 60 * 1000; // 1 hora
const APPROACHING_HOURS = 48;             // notificar 48h antes do prazo
const DEDUP_KEY         = 'pt_notif_dedup';
const DEDUP_TTL         = 24 * 60 * 60 * 1000; // 24h — não re-notificar no mesmo dia

let _stopFn = null;

/* ─── Dedup helpers (localStorage) ───────────────────────── */
function getDedupMap() {
  try {
    const raw = localStorage.getItem(DEDUP_KEY);
    if (!raw) return {};
    const map = JSON.parse(raw);
    const now = Date.now();
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

  // v4.53.1+ Inclui 'approval' (v4.52.0) e 'validation' (v4.53.0) — esses status
  // são parte do pipeline ativo. Sem isso, deadline alerts paravam de disparar
  // quando task transicionava pra approval/validation.
  const activeSet = new Set(['not_started', 'in_progress', 'review', 'approval', 'validation', 'rework']);

  // Reusa o cache de fetchTasks (TTL 90s + populado pelo onSnapshot do tasks/kanban).
  // Isso elimina o getDocs paralelo que essa função fazia antes.
  let tasks = [];
  try {
    tasks = await fetchTasks();
  } catch (e) {
    console.warn('[NotifScheduler] Erro ao buscar tarefas:', e?.message || e);
    return;
  }

  // Filtra status localmente (sem custo de read extra)
  tasks = tasks.filter(t => activeSet.has(t.status) && t.dueDate);

  // 4.40.12+ Cada user só notifica SUAS PRÓPRIAS tarefas (creator/assignee/observer).
  // Antes: TODO user que abrisse o app iterava TODAS as tarefas visíveis e
  // disparava notify(creator+assignees+observers) — gerando duplicação cross-user.
  // Resultado: a mesma notif chegava ao recipient N vezes (uma por browser ativo
  // no sistema), com actorName diferente, parecendo "notif de todos".
  // Fix: filtra pelas tarefas onde EU sou stakeholder, e notifico apenas a mim.
  const myUid = currentUser.uid;
  tasks = tasks.filter(t => {
    const assignees = Array.isArray(t.assignees) ? t.assignees : (t.assignees ? [t.assignees] : []);
    const observers = Array.isArray(t.observers) ? t.observers : [];
    return t.createdBy === myUid || assignees.includes(myUid) || observers.includes(myUid);
  });

  const now = new Date();
  const { notify } = await import('./notifications.js');

  for (const task of tasks) {
    const due = task.dueDate?.toDate?.() || new Date(task.dueDate);
    if (isNaN(due.getTime())) continue;

    const hoursUntilDue = (due - now) / (1000 * 60 * 60);
    // 4.40.12+ Recipient = APENAS o user atual. Cada user é responsável por
    // notificar a si mesmo sobre tarefas onde ele tem skin in the game.
    // (Filtro já garantiu que myUid é creator/assignee/observer.) Antes era
    // [creator, ...assignees] disparado por todo mundo → duplicação massiva.
    const recipients = [myUid];

    const taskTitle = task.title || 'Tarefa sem título';

    // 1) Tarefa atrasada
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
    // 2) Prazo próximo
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

export function startScheduler() {
  stopScheduler();
  // Delay inicial de 10s para não disputar com o boot do app.
  // O startPolling cuidará dos ticks subsequentes (com pausa em aba hidden).
  setTimeout(() => {
    _stopFn = startPolling(checkDeadlines, {
      intervalMs:      CHECK_INTERVAL,
      immediate:       true,
      pauseWhenHidden: true,
      runOnVisible:    true,
      label:           'notifScheduler',
    });
  }, 10_000);
}

export function stopScheduler() {
  if (_stopFn) { _stopFn(); _stopFn = null; }
}
