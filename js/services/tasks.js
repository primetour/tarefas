/**
 * PRIMETOUR — Tasks Service
 * CRUD completo de tarefas no Firestore
 */

import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  getDoc, getDocs, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, arrayUnion, arrayRemove,
  writeBatch, increment,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }       from '../firebase.js';
import { store }    from '../store.js';
import { auditLog } from '../auth/audit.js';

/* ─── Constantes ─────────────────────────────────────────── */
export const STATUSES = [
  { value: 'not_started', label: 'Não iniciado',   color: '#38BDF8' },
  { value: 'in_progress', label: 'Em Andamento',   color: '#F59E0B' },
  { value: 'review',      label: 'Em Revisão',     color: '#A78BFA' },
  { value: 'rework',      label: 'Retrabalho',     color: '#F97316' },
  { value: 'done',        label: 'Concluída',      color: '#22C55E' },
  { value: 'cancelled',   label: 'Cancelada',      color: '#EF4444' },
];

// Sub-status para tarefas do tipo Newsletter
export const NEWSLETTER_STATUSES = [
  { value: 'pauta',           label: 'Pauta'            },
  { value: 'conteudo_tecnico',label: 'Conteúdo técnico' },
  { value: 'redacao',         label: 'Redação'          },
  { value: 'design',          label: 'Design'           },
  { value: 'revisao',         label: 'Revisão'          },
  { value: 'tarifa_dispo',    label: 'Tarifa e dispo'   },
  { value: 'agendado',        label: 'Agendado'         },
  { value: 'disparado',       label: 'Disparado'        },
  { value: 'analise_dados',   label: 'Análise de Dados' },
];

// Tipos de tarefa
export const TASK_TYPES = [
  { value: '',            label: '— Padrão —'    },
  { value: 'newsletter',  label: '📧 Newsletter' },
];

// Áreas solicitantes
export const REQUESTING_AREAS = [
  'BTG', 'C&P', 'Célula ICs', 'Centurion', 'CEP',
  'Concierge Bradesco', 'Contabilidade', 'Diretoria',
  'Eventos', 'Financeiro', 'Lazer', 'Marketing',
  'Operadora', 'Programa ICs', 'Projetos',
  'PTS Bradesco', 'Qualidade', 'Suppliers', 'TI',
];

// Núcleos de execução (multi-select)
export const NUCLEOS = [
  { value: 'design',         label: 'Design'         },
  { value: 'comunicacao',    label: 'Comunicação'    },
  { value: 'redes_sociais',  label: 'Redes Sociais'  },
  { value: 'dados',          label: 'Dados'          },
  { value: 'web',            label: 'Web'            },
  { value: 'sistemas',       label: 'Sistemas'       },
  { value: 'ia',             label: 'IA'             },
];

export const PRIORITIES = [
  { value: 'urgent', label: 'Urgente', color: '#EF4444', icon: '🔴' },
  { value: 'high',   label: 'Alta',    color: '#F97316', icon: '🟠' },
  { value: 'medium', label: 'Média',   color: '#F59E0B', icon: '🟡' },
  { value: 'low',    label: 'Baixa',   color: '#6B7280', icon: '⚪' },
];

export const STATUS_MAP    = Object.fromEntries(STATUSES.map(s => [s.value, s]));
export const PRIORITY_MAP  = Object.fromEntries(PRIORITIES.map(p => [p.value, p]));

/* ─── Criar tarefa ───────────────────────────────────────── */
export async function createTask(data) {
  // Validar regras de negócio do tipo de tarefa
  if (data.typeId) {
    const { validateTaskTypeRules, calcSla } = await import('./taskTypes.js');
    const validation = await validateTaskTypeRules(data.typeId, data).catch(() => ({ valid: true }));
    if (!validation.valid) throw new Error(validation.error || 'Regra de negócio violada.');
    // Auto-calcular dueDate via SLA se não fornecido
    if (!data.dueDate && data.startDate) {
      const sla = calcSla(data.typeId, data.startDate);
      if (sla) data.dueDate = sla.dueDate;
    }
  }

  const user = store.get('currentUser');
  const workspace = store.get('currentWorkspace');
  const taskDoc = {
    workspaceId:      data.workspaceId || workspace?.id || null,
    title:            data.title?.trim()        || 'Nova Tarefa',
    description:      data.description?.trim()  || '',
    status:           data.status               || 'not_started',
    priority:         data.priority             || 'medium',
    projectId:        data.projectId            || null,
    assignees:        data.assignees            || [],
    tags:             data.tags                 || [],
    startDate:        data.startDate            || null,
    dueDate:          data.dueDate              || null,
    typeId:           data.typeId             || null,
    customFields:     data.customFields        || {},
    // Legacy fields kept for backward compat and existing queries
    type:             data.type                 || '',
    newsletterStatus: data.newsletterStatus     || '',
    requestingArea:   data.requestingArea       || '',
    clientEmail:      data.clientEmail          || '',
    nucleos:          data.nucleos              || [],
    outOfCalendar:    data.outOfCalendar        || false,
    subtasks:    [],
    comments:    [],
    attachments: [],
    order:       data.order       ?? Date.now(),
    completedAt: null,
    createdAt:   serverTimestamp(),
    createdBy:   user.uid,
    updatedAt:   serverTimestamp(),
    updatedBy:   user.uid,
  };

  const ref = await addDoc(collection(db, 'tasks'), taskDoc);
  await auditLog('tasks.create', 'task', ref.id, { title: taskDoc.title });
  return { id: ref.id, ...taskDoc };
}

/* ─── Atualizar tarefa ───────────────────────────────────── */
export async function updateTask(taskId, data) {
  const user = store.get('currentUser');
  const updates = { ...data, updatedAt: serverTimestamp(), updatedBy: user.uid };

  // Se status mudou para rework, registrar no audit log
  if (data.status === 'rework' && data._prevStatus && data.status !== data._prevStatus) {
    await auditLog('tasks.rework', 'task', taskId, {
      prevStatus: data._prevStatus,
      taskTitle:  updates.title,
    }).catch(() => {});
  }

  // Se status mudou para done, salvar data de conclusão
  if (data.status === 'done' && data.status !== data._prevStatus) {
    updates.completedAt = serverTimestamp();
  } else if (data.status && data.status !== 'done') {
    updates.completedAt = null;
  }
  delete updates._prevStatus;

  await updateDoc(doc(db, 'tasks', taskId), updates);
  await auditLog('tasks.update', 'task', taskId, { fields: Object.keys(data) });
}

/* ─── Completar tarefa (toggle) ──────────────────────────── */
export async function toggleTaskComplete(taskId, isDone) {
  const user = store.get('currentUser');
  await updateDoc(doc(db, 'tasks', taskId), {
    status:      isDone ? 'done' : 'not_started',
    completedAt: isDone ? serverTimestamp() : null,
    updatedAt:   serverTimestamp(),
    updatedBy:   user.uid,
  });
  await auditLog('tasks.complete', 'task', taskId, { done: isDone });
}

/* ─── Excluir tarefa ─────────────────────────────────────── */
export async function deleteTask(taskId) {
  if (!store.can('task_delete')) throw new Error('Permissão negada.');
  await deleteDoc(doc(db, 'tasks', taskId));
  await auditLog('tasks.delete', 'task', taskId, {});
}

/* ─── Buscar tarefa ──────────────────────────────────────── */
export async function getTask(taskId) {
  const snap = await getDoc(doc(db, 'tasks', taskId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/* ─── Listar tarefas (filtros) ───────────────────────────── */
export async function fetchTasks({
  projectId    = null,
  assigneeId   = null,
  status       = null,
  priority     = null,
  workspaceIds = null,   // null = usa activeWorkspaces do store
  limitN       = 500,
} = {}) {
  const q    = query(collection(db, 'tasks'), orderBy('order', 'asc'), limit(limitN));
  const snap = await getDocs(q);
  let tasks  = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Filtro por workspace — documentos sem workspaceId são visíveis para todos
  const activeIds = workspaceIds ?? store.getActiveWorkspaceIds();
  if (activeIds) {
    tasks = tasks.filter(t => !t.workspaceId || activeIds.includes(t.workspaceId));
  }

  if (projectId)  tasks = tasks.filter(t => t.projectId === projectId);
  if (assigneeId) tasks = tasks.filter(t => (t.assignees||[]).includes(assigneeId));
  if (status)     tasks = tasks.filter(t => t.status === status);
  if (priority)   tasks = tasks.filter(t => t.priority === priority);

  return tasks;
}

/* ─── Real-time listener ─────────────────────────────────── */
export function subscribeToTasks(callback, filters = {}) {
  const q = query(collection(db, 'tasks'), orderBy('order', 'asc'), limit(500));

  return onSnapshot(q, (snap) => {
    let tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Filtro por workspace
    const activeIds = store.getActiveWorkspaceIds();
    if (activeIds) {
      tasks = tasks.filter(t => !t.workspaceId || activeIds.includes(t.workspaceId));
    }

    if (filters.projectId) tasks = tasks.filter(t => t.projectId === filters.projectId);
    callback(tasks);
  });
}

/* ─── Mover task no kanban (atualiza order + status) ────── */
export async function moveTaskKanban(taskId, newStatus, newOrder) {
  const user = store.get('currentUser');
  const updates = {
    status:    newStatus,
    order:     newOrder,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  };
  if (newStatus === 'done') updates.completedAt = serverTimestamp();
  else updates.completedAt = null;

  await updateDoc(doc(db, 'tasks', taskId), updates);
}

/* ─── Adicionar subtarefa ────────────────────────────────── */
export async function addSubtask(taskId, title) {
  const user = store.get('currentUser');
  const subtask = {
    id:        `sub_${Date.now()}`,
    title:     title.trim(),
    done:      false,
    createdAt: new Date().toISOString(),
    createdBy: user.uid,
  };
  await updateDoc(doc(db, 'tasks', taskId), {
    subtasks:  arrayUnion(subtask),
    updatedAt: serverTimestamp(),
  });
  return subtask;
}

/* ─── Toggle subtarefa ───────────────────────────────────── */
export async function toggleSubtask(taskId, subtaskId, currentSubtasks) {
  const updated = currentSubtasks.map(s =>
    s.id === subtaskId ? { ...s, done: !s.done } : s
  );
  await updateDoc(doc(db, 'tasks', taskId), {
    subtasks:  updated,
    updatedAt: serverTimestamp(),
  });
  return updated;
}

/* ─── Adicionar comentário ───────────────────────────────── */
export async function addComment(taskId, text) {
  const user    = store.get('currentUser');
  const profile = store.get('userProfile');
  const comment = {
    id:          `cmt_${Date.now()}`,
    text:        text.trim(),
    authorId:    user.uid,
    authorName:  profile?.name  || user.email,
    authorColor: profile?.avatarColor || '#3B82F6',
    createdAt:   new Date().toISOString(),
  };
  await updateDoc(doc(db, 'tasks', taskId), {
    comments:  arrayUnion(comment),
    updatedAt: serverTimestamp(),
  });
  return comment;
}
