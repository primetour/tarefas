/**
 * PRIMETOUR — Goals Service (Fase 4 extra)
 * Metas individuais e do núcleo
 *
 * RACIONAL:
 * A meta pertence a uma pessoa ou núcleo e define um critério de progresso.
 * O progresso é calculado automaticamente: o sistema conta tarefas que
 * atendem aos filtros da meta (assignee, nucleo, typeId, período) e estão
 * com status 'done'. Não é necessário vincular tarefa a meta manualmente —
 * basta definir os filtros na meta.
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
  { value: 'personal', label: 'Individual',  icon: '◉', color: '#38BDF8' },
  { value: 'nucleo',   label: 'Do Núcleo',   icon: '◈', color: '#A78BFA' },
  { value: 'team',     label: 'Da Equipe',   icon: '◎', color: '#22C55E' },
];

export const GOAL_PERIODS = [
  { value: 'monthly',   label: 'Mensal'      },
  { value: 'quarterly', label: 'Trimestral'  },
  { value: 'yearly',    label: 'Anual'       },
  { value: 'custom',    label: 'Customizado' },
];

/* ─── Criar meta ─────────────────────────────────────────── */
export async function createGoal({
  title, description, type, period,
  startDate, endDate, target, metric,
  workspaceId,
  // Filtros para cálculo automático de progresso:
  filterAssignees,  // UIDs das pessoas (pessoal/equipe)
  filterNucleo,     // núcleo (meta de núcleo)
  filterTypeId,     // tipo de tarefa específico
}) {
  const user = store.get('currentUser');
  const goalDoc = {
    title:            title.trim(),
    description:      description?.trim() || '',
    type,
    period,
    startDate:        startDate ? new Date(startDate) : null,
    endDate:          endDate   ? new Date(endDate)   : null,
    target:           Number(target) || 0,
    metric:           metric?.trim() || 'tarefas concluídas',
    current:          0,
    progress:         0,
    status:           'active',
    ownerId:          user.uid,
    workspaceId:      workspaceId || store.get('currentWorkspace')?.id || null,
    // Filtros automáticos — o que conta para esta meta
    filterAssignees:  filterAssignees || (type === 'personal' ? [user.uid] : []),
    filterNucleo:     filterNucleo    || null,
    filterTypeId:     filterTypeId    || null,
    createdAt:        serverTimestamp(),
    createdBy:        user.uid,
    updatedAt:        serverTimestamp(),
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

/* ─── Buscar metas ───────────────────────────────────────── */
export async function fetchGoals({ type = null } = {}) {
  const uid  = store.get('currentUser').uid;
  const snap = await getDocs(query(collection(db, 'goals'), orderBy('createdAt', 'desc')));
  let goals  = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (!store.can('system_view_all')) {
    goals = goals.filter(g =>
      g.ownerId === uid ||
      (g.filterAssignees||[]).includes(uid) ||
      g.type !== 'personal'
    );
  }

  if (type) goals = goals.filter(g => g.type === type);
  return goals.filter(g => g.status !== 'archived');
}

/* ─── Recalcular progresso automaticamente ───────────────── */
export function calcGoalProgress(goal, allTasks) {
  // Filtrar tarefas que se encaixam nos critérios da meta
  let relevant = allTasks.filter(t => t.status === 'done');

  // Filtro por período
  if (goal.startDate || goal.endDate) {
    relevant = relevant.filter(t => {
      const completed = t.completedAt?.toDate
        ? t.completedAt.toDate()
        : t.completedAt ? new Date(t.completedAt) : null;
      if (!completed) return false;
      const start = goal.startDate?.toDate ? goal.startDate.toDate() : goal.startDate ? new Date(goal.startDate) : null;
      const end   = goal.endDate?.toDate   ? goal.endDate.toDate()   : goal.endDate   ? new Date(goal.endDate)   : null;
      if (start && completed < start) return false;
      if (end   && completed > end)   return false;
      return true;
    });
  }

  // Filtro por assignees (meta individual ou de equipe)
  if (goal.filterAssignees?.length) {
    relevant = relevant.filter(t =>
      (t.assignees||[]).some(uid => goal.filterAssignees.includes(uid))
    );
  }

  // Filtro por núcleo
  if (goal.filterNucleo) {
    relevant = relevant.filter(t =>
      (t.nucleos||[]).includes(goal.filterNucleo)
    );
  }

  // Filtro por tipo de tarefa
  if (goal.filterTypeId) {
    relevant = relevant.filter(t =>
      t.typeId === goal.filterTypeId || t.type === goal.filterTypeId
    );
  }

  const current  = relevant.length;
  const progress = goal.target > 0 ? Math.min(100, Math.round((current / goal.target) * 100)) : 0;
  return { current, progress, relevant };
}

export async function recalcGoalProgress(goalId, allTasks) {
  const snap = await getDoc(doc(db, 'goals', goalId));
  if (!snap.exists()) return;
  const goal = { id: snap.id, ...snap.data() };
  const { current, progress } = calcGoalProgress(goal, allTasks);
  await updateDoc(doc(db, 'goals', goalId), {
    current, progress,
    status:    progress >= 100 ? 'completed' : 'active',
    updatedAt: serverTimestamp(),
  });
  return { current, progress };
}

