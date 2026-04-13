/**
 * PRIMETOUR — Workflow Engine
 * Regras de transicao de status e auto-avanco
 */
import { store } from '../store.js';

/* ─── Regras de transicao validas ─────────────────────────── */
// Define quais transicoes sao permitidas por default
const DEFAULT_TRANSITIONS = {
  'not_started': ['in_progress', 'cancelled'],
  'in_progress': ['review', 'done', 'cancelled'],
  'review':      ['done', 'rework', 'cancelled'],
  'rework':      ['in_progress', 'review', 'cancelled'],
  'done':        ['rework'],
  'cancelled':   ['not_started'],
};

/**
 * Verifica se uma transicao de status e valida.
 * Admins/masters podem fazer qualquer transicao.
 */
export function isValidTransition(fromStatus, toStatus) {
  if (!fromStatus || !toStatus) return true;
  if (fromStatus === toStatus) return true;
  if (store.isMaster() || store.can('system_manage_settings')) return true;
  const allowed = DEFAULT_TRANSITIONS[fromStatus] || [];
  return allowed.includes(toStatus);
}

/**
 * Retorna as transicoes validas a partir de um status.
 */
export function getValidTransitions(fromStatus) {
  if (store.isMaster() || store.can('system_manage_settings')) {
    return ['not_started', 'in_progress', 'review', 'rework', 'done', 'cancelled'];
  }
  return DEFAULT_TRANSITIONS[fromStatus] || [];
}

/**
 * Verifica se task deve auto-avancar baseado em subtasks.
 * Retorna o novo status sugerido ou null.
 */
export function checkSubtaskAutoAdvance(task) {
  if (!task || !Array.isArray(task.subtasks) || task.subtasks.length === 0) return null;
  if (task.status === 'done' || task.status === 'cancelled') return null;

  const allDone = task.subtasks.every(s => s.done || s.completed);
  if (allDone && task.status !== 'review') {
    return 'review'; // All subtasks done -> suggest moving to review
  }

  // If at least one subtask started and task is not_started, suggest in_progress
  const anyStarted = task.subtasks.some(s => s.done || s.completed);
  if (anyStarted && task.status === 'not_started') {
    return 'in_progress';
  }

  return null;
}

/**
 * Verifica regras de auto-reopen por CSAT baixo.
 * Se CSAT score <= 2, sugere reabrir como rework.
 */
export function checkCsatAutoReopen(task, csatScore) {
  if (!task || task.status !== 'done') return null;
  if (csatScore && csatScore <= 2) return 'rework';
  return null;
}
