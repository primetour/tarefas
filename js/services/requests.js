/**
 * PRIMETOUR — Requests Service (Fase 4)
 * Solicitações vindas do portal público
 */

import {
  collection, doc, addDoc, updateDoc, getDoc, getDocs,
  query, orderBy, where, limit, serverTimestamp, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }       from '../firebase.js';
import { store }    from '../store.js';
import { auditLog } from '../auth/audit.js';

/* ─── Status de solicitação ──────────────────────────────── */
export const REQUEST_STATUSES = [
  { value: 'pending',   label: 'Aguardando triagem', color: '#F59E0B', icon: '◌' },
  { value: 'in_review', label: 'Em análise',         color: '#38BDF8', icon: '◷' },
  { value: 'converted', label: 'Convertida',         color: '#22C55E', icon: '✓' },
  { value: 'rejected',  label: 'Recusada',           color: '#EF4444', icon: '✕' },
];

export const REQUEST_STATUS_MAP = Object.fromEntries(
  REQUEST_STATUSES.map(s => [s.value, s])
);

/* ─── Criar solicitação (chamado pelo portal público) ────── */
export async function createRequest({
  requesterName, requesterEmail,
  typeId, typeName,
  nucleo, requestingArea,
  description, urgency,
  desiredDate,
}) {
  const reqDoc = {
    requesterName:  requesterName.trim(),
    requesterEmail: requesterEmail.trim().toLowerCase(),
    typeId:         typeId  || null,
    typeName:       typeName || '',
    nucleo:         nucleo  || '',
    requestingArea: requestingArea || '',
    description:    description.trim(),
    urgency:        urgency === true,
    desiredDate:    desiredDate ? new Date(desiredDate) : null,
    status:         'pending',
    taskId:         null,
    workspaceId:    null,
    assignedTo:     null,
    internalNote:   '',
    createdAt:      serverTimestamp(),
    updatedAt:      serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'requests'), reqDoc);
  return { id: ref.id, ...reqDoc };
}

/* ─── Buscar todas as solicitações ───────────────────────── */
export async function fetchRequests({ status = null, limitN = 200 } = {}) {
  let q = query(collection(db, 'requests'), orderBy('createdAt', 'desc'), limit(limitN));
  if (status) q = query(collection(db, 'requests'), where('status', '==', status), orderBy('createdAt', 'desc'), limit(limitN));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ─── Real-time listener ─────────────────────────────────── */
export function subscribeRequests(callback) {
  const q = query(collection(db, 'requests'), orderBy('createdAt', 'desc'), limit(200));
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

/* ─── Atualizar status ───────────────────────────────────── */
export async function updateRequestStatus(reqId, status, extra = {}) {
  const user = store.get('currentUser');
  await updateDoc(doc(db, 'requests', reqId), {
    status,
    ...extra,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
  await auditLog('requests.status', 'request', reqId, { status });
}

/* ─── Converter em tarefa ────────────────────────────────── */
export async function convertToTask(reqId, taskData) {
  const { createTask } = await import('./tasks.js');
  const task = await createTask(taskData);
  await updateRequestStatus(reqId, 'converted', { taskId: task.id });
  await auditLog('requests.convert', 'request', reqId, { taskId: task.id });
  return task;
}

/* ─── Contar pendentes (para badge) ─────────────────────── */
export async function countPendingRequests() {
  const snap = await getDocs(query(
    collection(db, 'requests'),
    where('status', '==', 'pending'),
    limit(99),
  ));
  return snap.size;
}

/* ─── Notificar equipe via EmailJS ───────────────────────── */
export async function notifyTeamByEmail({ requesterName, requesterEmail, typeName, nucleo, urgency, requestId }) {
  const { APP_CONFIG } = await import('../config.js');
  const cfg = APP_CONFIG.emailjs;
  if (!cfg.publicKey || cfg.publicKey === 'SUA_EMAILJS_PUBLIC_KEY') return;
  if (!cfg.templateInternal) return;

  // Load EmailJS
  if (!window.emailjs) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js';
      s.onload = () => { window.emailjs.init(cfg.publicKey); res(); };
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  await window.emailjs.send(cfg.serviceId, cfg.templateInternal, {
    to_email:        cfg.fromEmail,
    subject:         `${urgency ? '🔴 URGENTE — ' : ''}Nova solicitação: ${typeName}`,
    requester_name:  requesterName,
    requester_email: requesterEmail,
    type_name:       typeName,
    nucleo,
    urgency:         urgency ? 'Sim — marcada como urgente' : 'Não',
    request_url:     `${window.location.origin}/tarefas/#requests?id=${requestId}`,
  }).catch(e => console.warn('EmailJS notify error:', e));
}
