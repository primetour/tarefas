/**
 * PRIMETOUR — System Feedback Service
 *
 * Coleção `system_feedback`: bugs, sugestões, dúvidas e elogios sobre o
 * sistema (não confundir com `feedbacks`, que é gestão de pessoas).
 *
 * Cloud Function `onSystemFeedbackCreate` envia email pra admin via Graph
 * quando um doc é criado.
 */

import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs,
  query, where, orderBy, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }       from '../firebase.js';
import { store }    from '../store.js';
import { auditLog } from '../auth/audit.js';

export const FEEDBACK_TYPES = [
  { id: 'bug',        label: '🐛 Bug',        color: '#EF4444', desc: 'Algo está quebrado ou não funciona como esperado' },
  { id: 'suggestion', label: '💡 Sugestão',   color: '#D4A843', desc: 'Ideia de melhoria ou nova funcionalidade' },
  { id: 'question',   label: '❓ Dúvida',     color: '#38BDF8', desc: 'Não entendi como algo funciona' },
  { id: 'praise',     label: '🌟 Elogio',     color: '#22C55E', desc: 'Algo está funcionando muito bem' },
];

export const FEEDBACK_STATUSES = [
  { id: 'new',         label: 'Novo',          color: '#38BDF8' },
  { id: 'analyzing',   label: 'Em análise',    color: '#F59E0B' },
  { id: 'in_progress', label: 'Em desenvolvimento', color: '#A78BFA' },
  { id: 'resolved',    label: 'Resolvido',     color: '#22C55E' },
  { id: 'rejected',    label: 'Não aplicável', color: '#94A3B8' },
];

const TYPE_MAP = Object.fromEntries(FEEDBACK_TYPES.map(t => [t.id, t]));
const STATUS_MAP = Object.fromEntries(FEEDBACK_STATUSES.map(s => [s.id, s]));
export const getFeedbackType = (id) => TYPE_MAP[id] || null;
export const getFeedbackStatus = (id) => STATUS_MAP[id] || null;

/* ─── Criar feedback (qualquer user autenticado) ─────────── */
export async function createSystemFeedback({ type, message }) {
  const user = store.get('currentUser');
  const profile = store.get('userProfile');
  if (!user) throw new Error('Você precisa estar autenticado.');
  if (!FEEDBACK_TYPES.find(t => t.id === type)) throw new Error('Tipo inválido.');
  if (!message || !message.trim()) throw new Error('Escreva uma mensagem.');

  const doc = {
    type,
    message: message.trim().slice(0, 2000), // hard cap
    page: location.hash || '#',
    userAgent: (navigator.userAgent || '').slice(0, 200),
    appVersion: window.__PRIMETOUR_VERSION__?.full || 'desconhecida',
    authorUid:   user.uid,
    authorName:  profile?.name || user.email || 'Usuário',
    authorEmail: user.email || '',
    authorRole:  profile?.role || 'member',
    status: 'new',
    adminResponse: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    resolvedAt: null,
  };

  const ref = await addDoc(collection(db, 'system_feedback'), doc);
  await auditLog('system_feedback.create', 'feedback', ref.id, { type });
  return { id: ref.id, ...doc };
}

/* ─── Listar (admin) ──────────────────────────────────────── */
export async function fetchSystemFeedbacks({ status = null, type = null } = {}) {
  let q = query(collection(db, 'system_feedback'), orderBy('createdAt', 'desc'));
  if (status) q = query(q, where('status', '==', status));
  if (type)   q = query(q, where('type',   '==', type));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ─── Atualizar status / resposta (admin) ─────────────────── */
export async function updateSystemFeedback(id, { status, adminResponse }) {
  if (!store.can('system_manage_settings')) throw new Error('Permissão negada.');
  const patch = { updatedAt: serverTimestamp() };
  if (status) {
    if (!FEEDBACK_STATUSES.find(s => s.id === status)) throw new Error('Status inválido.');
    patch.status = status;
    if (status === 'resolved') patch.resolvedAt = serverTimestamp();
  }
  if (typeof adminResponse === 'string') patch.adminResponse = adminResponse.trim().slice(0, 1000);
  await updateDoc(doc(db, 'system_feedback', id), patch);
  await auditLog('system_feedback.update', 'feedback', id, { status });
}

/* ─── Excluir (master only) ───────────────────────────────── */
export async function deleteSystemFeedback(id) {
  if (!store.isMaster()) throw new Error('Apenas Diretoria.');
  await deleteDoc(doc(db, 'system_feedback', id));
  await auditLog('system_feedback.delete', 'feedback', id, {});
}
