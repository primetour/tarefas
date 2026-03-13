/**
 * PRIMETOUR — Projects Service
 * CRUD completo de projetos no Firestore
 */

import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  getDoc, getDocs, query, orderBy, where,
  serverTimestamp, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }       from '../firebase.js';
import { store }    from '../store.js';
import { auditLog } from '../auth/audit.js';

/* ─── Paleta de cores/ícones ─────────────────────────────── */
export const PROJECT_COLORS = [
  '#D4A843','#38BDF8','#A78BFA','#34D399',
  '#F97316','#EC4899','#6366F1','#14B8A6',
  '#EF4444','#F59E0B','#84CC16','#06B6D4',
];
export const PROJECT_ICONS = [
  '🚀','📦','🎯','💡','🌟','🔧','📊','🎨',
  '🏆','📱','🌐','⚡','🔑','📋','🛠','💼',
];
export const PROJECT_STATUSES = [
  { value: 'planning',    label: 'Planejamento', color: '#38BDF8' },
  { value: 'active',      label: 'Em andamento', color: '#22C55E' },
  { value: 'on_hold',     label: 'Em pausa',     color: '#F59E0B' },
  { value: 'completed',   label: 'Concluído',    color: '#A78BFA' },
  { value: 'cancelled',   label: 'Cancelado',    color: '#EF4444' },
];
export const PROJECT_STATUS_MAP = Object.fromEntries(
  PROJECT_STATUSES.map(s => [s.value, s])
);

/* ─── Criar projeto ──────────────────────────────────────── */
export async function createProject(data) {
  if (!store.isManager()) throw new Error('Permissão negada.');
  const user = store.get('currentUser');

  const projectDoc = {
    name:        data.name?.trim() || 'Novo Projeto',
    description: data.description?.trim() || '',
    color:       data.color || PROJECT_COLORS[0],
    icon:        data.icon  || '📦',
    status:      data.status || 'planning',
    members:     data.members || [user.uid],
    startDate:   data.startDate || null,
    endDate:     data.endDate   || null,
    taskCount:   0,
    doneCount:   0,
    createdAt:   serverTimestamp(),
    createdBy:   user.uid,
    updatedAt:   serverTimestamp(),
    updatedBy:   user.uid,
    archived:    false,
  };

  const ref = await addDoc(collection(db, 'projects'), projectDoc);
  await auditLog('projects.create', 'project', ref.id, { name: projectDoc.name });
  return { id: ref.id, ...projectDoc };
}

/* ─── Atualizar projeto ──────────────────────────────────── */
export async function updateProject(projectId, data) {
  if (!store.isManager()) throw new Error('Permissão negada.');
  const user = store.get('currentUser');
  await updateDoc(doc(db, 'projects', projectId), {
    ...data, updatedAt: serverTimestamp(), updatedBy: user.uid,
  });
  await auditLog('projects.update', 'project', projectId, { fields: Object.keys(data) });
}

/* ─── Excluir projeto ────────────────────────────────────── */
export async function deleteProject(projectId) {
  if (!store.isAdmin()) throw new Error('Permissão negada.');
  await deleteDoc(doc(db, 'projects', projectId));
  await auditLog('projects.delete', 'project', projectId, {});
}

/* ─── Buscar projeto ─────────────────────────────────────── */
export async function getProject(projectId) {
  const snap = await getDoc(doc(db, 'projects', projectId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/* ─── Listar projetos ────────────────────────────────────── */
export async function fetchProjects({ includeArchived = false } = {}) {
  let q = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
  if (!includeArchived) q = query(q, where('archived', '==', false));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ─── Real-time listener ─────────────────────────────────── */
export function subscribeToProjects(callback) {
  const q = query(
    collection(db, 'projects'),
    where('archived', '==', false),
    orderBy('createdAt', 'desc')
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

/* ─── Atualizar contadores ───────────────────────────────── */
export async function recalcProjectStats(projectId, tasks) {
  const projectTasks = tasks.filter(t => t.projectId === projectId);
  await updateDoc(doc(db, 'projects', projectId), {
    taskCount: projectTasks.length,
    doneCount: projectTasks.filter(t => t.status === 'done').length,
  });
}
