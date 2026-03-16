/**
 * PRIMETOUR — Goals Service (Fase 4 extra)
 * Metas individuais e do núcleo vinculadas a tarefas e projetos
 */

import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  getDoc, getDocs, query, where, orderBy, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }       from '../firebase.js';
import { store }    from '../store.js';
import { auditLog } from '../auth/audit.js';

/* ─── Tipos de meta ──────────────────────────────────────── */
export const GOAL_TYPES = [
  { value: 'personal', label: 'Individual',    icon: '◉', color: '#38BDF8' },
  { value: 'nucleo',   label: 'Do Núcleo',     icon: '◈', color: '#A78BFA' },
  { value: 'team',     label: 'Da Equipe',     icon: '◎', color: '#22C55E' },
];

export const GOAL_PERIODS = [
  { value: 'monthly',   label: 'Mensal'    },
  { value: 'quarterly', label: 'Trimestral' },
  { value: 'yearly',    label: 'Anual'     },
  { value: 'custom',    label: 'Customizado' },
];

/* ─── Criar meta ─────────────────────────────────────────── */
export async function createGoal({ title, description, type, nucleo, period, startDate, endDate, target, metric, workspaceId }) {
  const user = store.get('currentUser');
  const goalDoc = {
    title:       title.trim(),
    description: description?.trim() || '',
    type,
    nucleo:      nucleo || null,
    period,
    startDate:   startDate ? new Date(startDate) : null,
    endDate:     endDate   ? new Date(endDate)   : null,
    target:      Number(target) || 0,
    metric:      metric?.trim() || 'tarefas concluídas',
    current:     0,
    progress:    0,
    status:      'active',
    ownerId:     user.uid,
    workspaceId: workspaceId || store.get('currentWorkspace')?.id || null,
    linkedTaskIds:    [],
    linkedProjectIds: [],
    createdAt:   serverTimestamp(),
    createdBy:   user.uid,
    updatedAt:   serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'goals'), goalDoc);
  await auditLog('goals.create', 'goal', ref.id, { title });
  return { id: ref.id, ...goalDoc };
}

/* ─── Atualizar meta ─────────────────────────────────────── */
export async function updateGoal(goalId, data) {
  const user = store.get('currentUser');
  await updateDoc(doc(db, 'goals', goalId), {
    ...data, updatedAt: serverTimestamp(), updatedBy: user.uid,
  });
}

/* ─── Excluir meta ───────────────────────────────────────── */
export async function deleteGoal(goalId) {
  await deleteDoc(doc(db, 'goals', goalId));
  await auditLog('goals.delete', 'goal', goalId, {});
}

/* ─── Vincular tarefa a uma meta ─────────────────────────── */
export async function linkTaskToGoal(goalId, taskId) {
  const snap = await getDoc(doc(db, 'goals', goalId));
  if (!snap.exists()) return;
  const goal    = snap.data();
  const linked  = [...(goal.linkedTaskIds || [])];
  if (!linked.includes(taskId)) linked.push(taskId);
  await updateDoc(doc(db, 'goals', goalId), { linkedTaskIds: linked });
}

/* ─── Buscar metas do usuário ────────────────────────────── */
export async function fetchGoals({ userId = null, type = null } = {}) {
  const uid  = userId || store.get('currentUser').uid;
  const snap = await getDocs(query(collection(db, 'goals'), orderBy('createdAt', 'desc')));
  let goals  = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Personal: only own goals; nucleo/team: all in workspace
  if (type === 'personal') {
    goals = goals.filter(g => g.ownerId === uid);
  } else if (!store.can('system_view_all')) {
    goals = goals.filter(g => g.ownerId === uid || g.type !== 'personal');
  }

  return goals.filter(g => g.status !== 'archived');
}

/* ─── Recalcular progresso a partir de tarefas vinculadas ── */
export async function recalcGoalProgress(goalId, allTasks) {
  const snap = await getDoc(doc(db, 'goals', goalId));
  if (!snap.exists()) return;
  const goal     = snap.data();
  const linked   = goal.linkedTaskIds || [];
  const relevant = allTasks.filter(t => linked.includes(t.id) && t.status === 'done');
  const current  = relevant.length;
  const progress = goal.target > 0 ? Math.min(100, Math.round((current / goal.target) * 100)) : 0;

  await updateDoc(doc(db, 'goals', goalId), {
    current, progress,
    status: progress >= 100 ? 'completed' : 'active',
    updatedAt: serverTimestamp(),
  });
}
