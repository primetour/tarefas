/**
 * PRIMETOUR — Capacity Service (Fase 2)
 * Registro de férias, ausências e disponibilidade de usuários
 */

import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  getDocs, query, where, orderBy, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }       from '../firebase.js';
import { store }    from '../store.js';
import { auditLog } from '../auth/audit.js';

/* ─── Tipos de ausência ──────────────────────────────────── */
export const ABSENCE_TYPES = [
  { value: 'vacation',  label: 'Férias',          icon: '🏖', color: '#22C55E' },
  { value: 'sick',      label: 'Licença médica',   icon: '🏥', color: '#EF4444' },
  { value: 'remote',    label: 'Home office',      icon: '🏠', color: '#38BDF8' },
  { value: 'training',  label: 'Treinamento',      icon: '📚', color: '#A78BFA' },
  { value: 'event',     label: 'Evento externo',   icon: '🎤', color: '#F97316' },
  { value: 'other',     label: 'Outro',            icon: '◌',  color: '#6B7280' },
];

/* ─── Criar ausência ─────────────────────────────────────── */
export async function createAbsence({ userId, type, startDate, endDate, note = '', workspaceId = null }) {
  const currentUser = store.get('currentUser');
  const isSelf      = userId === currentUser.uid;

  // Qualquer usuário pode registrar a própria ausência; gestores podem registrar de outros
  if (!isSelf && !store.can('system_manage_users')) {
    throw new Error('Permissão negada. Você só pode registrar suas próprias ausências.');
  }

  const start = startDate instanceof Date ? startDate : new Date(startDate);
  const end   = endDate   instanceof Date ? endDate   : new Date(endDate);
  if (end < start) throw new Error('A data de fim deve ser posterior à data de início.');

  const absenceDoc = {
    userId,
    type,
    startDate:   start,
    endDate:     end,
    note:        note.trim(),
    workspaceId: workspaceId || null,
    createdAt:   serverTimestamp(),
    createdBy:   currentUser.uid,
    updatedAt:   serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'absences'), absenceDoc);
  await auditLog('capacity.create', 'absence', ref.id, { userId, type });
  return { id: ref.id, ...absenceDoc };
}

/* ─── Atualizar ausência ─────────────────────────────────── */
export async function updateAbsence(absenceId, data) {
  const currentUser = store.get('currentUser');
  await updateDoc(doc(db, 'absences', absenceId), {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: currentUser.uid,
  });
  await auditLog('capacity.update', 'absence', absenceId, {});
}

/* ─── Excluir ausência ───────────────────────────────────── */
export async function deleteAbsence(absenceId) {
  await deleteDoc(doc(db, 'absences', absenceId));
  await auditLog('capacity.delete', 'absence', absenceId, {});
}

/* ─── Buscar ausências de um usuário ─────────────────────── */
export async function fetchUserAbsences(userId) {
  const snap = await getDocs(query(
    collection(db, 'absences'),
    where('userId', '==', userId),
    orderBy('startDate', 'asc'),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ─── Buscar ausências de todos (para calendário do workspace) */
export async function fetchAllAbsences({ startDate, endDate } = {}) {
  let q = query(collection(db, 'absences'), orderBy('startDate', 'asc'));
  const snap = await getDocs(q);
  let absences = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Filtrar por período se fornecido
  if (startDate || endDate) {
    absences = absences.filter(a => {
      const aStart = a.startDate?.toDate ? a.startDate.toDate() : new Date(a.startDate);
      const aEnd   = a.endDate?.toDate   ? a.endDate.toDate()   : new Date(a.endDate);
      if (startDate && aEnd   < startDate) return false;
      if (endDate   && aStart > endDate)   return false;
      return true;
    });
  }

  return absences;
}

/* ─── Verificar se usuário está disponível numa data ─────── */
export function isUserAvailable(absences, userId, date) {
  const d = date instanceof Date ? date : new Date(date);
  d.setHours(12, 0, 0, 0); // meio-dia para evitar problemas de timezone
  return !absences.some(a => {
    if (a.userId !== userId) return false;
    const start = a.startDate?.toDate ? a.startDate.toDate() : new Date(a.startDate);
    const end   = a.endDate?.toDate   ? a.endDate.toDate()   : new Date(a.endDate);
    start.setHours(0,0,0,0); end.setHours(23,59,59,999);
    return d >= start && d <= end;
  });
}

/* ─── Calcular dias úteis disponíveis num período ─────────── */
export function calcAvailableDays(absences, userId, startDate, endDate) {
  const start = new Date(startDate); start.setHours(0,0,0,0);
  const end   = new Date(endDate);   end.setHours(23,59,59,999);
  let   total = 0, available = 0;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // pular fins de semana
    total++;
    if (isUserAvailable(absences, userId, d)) available++;
  }
  return { total, available, absent: total - available };
}

/* ─── Resumo de disponibilidade da equipe ────────────────── */
export async function getTeamAvailability(userIds, startDate, endDate) {
  const absences = await fetchAllAbsences({ startDate, endDate });
  return userIds.map(uid => {
    const users = store.get('users') || [];
    const user  = users.find(u => u.id === uid);
    const { available, absent, total } = calcAvailableDays(absences, uid, startDate, endDate);
    return {
      userId:    uid,
      name:      user?.name || uid,
      avatarColor: user?.avatarColor || '#6B7280',
      total, available, absent,
      rate:      total ? Math.round((available / total) * 100) : 100,
      absences:  absences.filter(a => a.userId === uid),
    };
  });
}
