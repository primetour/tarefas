/**
 * PRIMETOUR — Audit Log
 * Registro completo de auditoria de todas as ações do sistema
 */

import {
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  getDocs,
  where,
  startAfter,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db }    from '../firebase.js';
import { store } from '../store.js';

// ─── Mapa de ações legíveis ────────────────────────────────
export const ACTION_LABELS = {
  // Auth
  'auth.login':       'Login realizado',
  'auth.logout':      'Logout realizado',
  'auth.reset_pw':    'Redefinição de senha solicitada',
  // Usuários
  'users.create':     'Usuário criado',
  'users.update':     'Usuário atualizado',
  'users.deactivate': 'Usuário desativado',
  'users.reactivate': 'Usuário reativado',
  'users.delete':     'Usuário excluído',
  // Projetos (Etapa 2+)
  'projects.create':  'Projeto criado',
  'projects.update':  'Projeto atualizado',
  'projects.delete':  'Projeto excluído',
  'projects.archive': 'Projeto arquivado',
  // Tarefas (Etapa 2+)
  'tasks.create':     'Tarefa criada',
  'tasks.update':     'Tarefa atualizada',
  'tasks.complete':   'Tarefa concluída',
  'tasks.delete':     'Tarefa excluída',
  'tasks.assign':     'Tarefa atribuída',
  // CSAT (Etapa 4+)
  'csat.sent':        'CSAT enviado',
  'csat.received':    'Resposta CSAT recebida',
};

/**
 * Registra uma entrada de auditoria no Firestore
 */
export async function auditLog(action, entity, entityId, details = {}) {
  try {
    const user = store.get('currentUser');
    const profile = store.get('userProfile');

    const entry = {
      action,
      entity,
      entityId:   entityId || null,
      details,
      userId:     user?.uid    || 'system',
      userName:   profile?.name  || user?.email || 'Sistema',
      userEmail:  profile?.email || user?.email || '',
      userRole:   profile?.role  || 'unknown',
      timestamp:  serverTimestamp(),
      ip:         null, // IP só acessível via backend; deixar null no client
      userAgent:  navigator.userAgent.slice(0, 200),
    };

    await addDoc(collection(db, 'audit_logs'), entry);
  } catch (err) {
    // Auditoria nunca deve quebrar a operação principal
    console.warn('Audit log failed:', err.message);
  }
}

/**
 * Busca logs de auditoria com filtros e paginação
 */
export async function fetchAuditLogs({
  pageSize   = 50,
  lastDoc    = null,
  filterUser = null,
  filterAction = null,
  startDate  = null,
  endDate    = null,
} = {}) {
  let q = query(
    collection(db, 'audit_logs'),
    orderBy('timestamp', 'desc'),
    limit(pageSize)
  );

  if (filterUser)   q = query(q, where('userId', '==', filterUser));
  if (filterAction) q = query(q, where('action', '==', filterAction));
  if (startDate)    q = query(q, where('timestamp', '>=', startDate));
  if (endDate)      q = query(q, where('timestamp', '<=', endDate));
  if (lastDoc)      q = query(q, startAfter(lastDoc));

  const snap = await getDocs(q);
  return {
    logs:    snap.docs.map(d => ({ id: d.id, ...d.data() })),
    lastDoc: snap.docs[snap.docs.length - 1] || null,
    hasMore: snap.docs.length === pageSize,
  };
}
