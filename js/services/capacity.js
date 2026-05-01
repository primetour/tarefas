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
  if (!isSelf && !(store.can('absence_manage_team') || store.can('system_manage_users'))) {
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

/* ─── Constantes da jornada útil (usadas pra cálculo proporcional) */
const WORK_DAY_START_HR = 9;        // 9h
const WORK_DAY_END_HR   = 18;       // 18h (9h úteis)
const WORK_HOURS_PER_DAY = WORK_DAY_END_HR - WORK_DAY_START_HR;

/* ─── Verificar se usuário tem AUSÊNCIA TOTAL ou PARCIAL na data
 * Retorna boolean (true se houver QUALQUER ausência cobrindo o dia,
 * mesmo que parcial). Usado por flags rápidas (ex: tooltip de
 * disponibilidade). Para cálculo proporcional, usar getDayAbsenceFraction.
 */
export function isUserAvailable(absences, userId, date) {
  return getDayAbsenceFraction(absences, userId, date) <= 0;
}

/* ─── Fração do dia útil que o usuário está ausente (0..1) ──────
 * - Ausência NÃO parcial: 1.0 se o dia está dentro do range, senão 0
 * - Ausência parcial: calcula sobreposição (HH:MM start..end) com a
 *   janela útil padrão (09:00-18:00 = 9h) e devolve fração.
 * Ex: ausência 14:00-16:00 → 2h / 9h = 0.22 (22% do dia)
 */
export function getDayAbsenceFraction(absences, userId, date) {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  d.setHours(0, 0, 0, 0);
  const dayStart = d.getTime();
  const dayEndOfDay = dayStart + 86400000 - 1;

  let absentMs = 0;
  for (const a of absences) {
    if (a.userId !== userId) continue;
    const aStart = a.startDate?.toDate ? a.startDate.toDate() : new Date(a.startDate);
    const aEnd   = a.endDate?.toDate   ? a.endDate.toDate()   : new Date(a.endDate);

    if (!a.partial) {
      // Ausência por dia(s) inteiro(s)
      const aSDay = new Date(aStart); aSDay.setHours(0,0,0,0);
      const aEDay = new Date(aEnd);   aEDay.setHours(23,59,59,999);
      if (d >= aSDay && d <= aEDay) return 1; // dia todo ausente
    } else {
      // Ausência parcial: só conta sobreposição com janela útil
      const workStart = new Date(d); workStart.setHours(WORK_DAY_START_HR, 0, 0, 0);
      const workEnd   = new Date(d); workEnd.setHours(WORK_DAY_END_HR, 0, 0, 0);
      const overlapStart = Math.max(aStart.getTime(), workStart.getTime());
      const overlapEnd   = Math.min(aEnd.getTime(),   workEnd.getTime());
      if (overlapEnd > overlapStart) {
        absentMs += (overlapEnd - overlapStart);
      }
    }
  }
  if (absentMs <= 0) return 0;
  return Math.min(1, absentMs / (WORK_HOURS_PER_DAY * 3600000));
}

/* ─── Calcular dias úteis disponíveis num período ─────────── */
/* Retorna { total, available, absent } onde available e absent podem
 * ter casas decimais (ex: 7.75 dias quando há 1.25 dias de ausência
 * proveniente de ausências parciais). Arredondado pra 0.25 pra UI. */
export function calcAvailableDays(absences, userId, startDate, endDate) {
  const start = new Date(startDate); start.setHours(0,0,0,0);
  const end   = new Date(endDate);   end.setHours(23,59,59,999);
  let total = 0, availableSum = 0;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // pular fins de semana
    total++;
    const frac = getDayAbsenceFraction(absences, userId, d);
    availableSum += (1 - frac);
  }
  // Arredonda pra múltiplos de 0.25 (quartos de dia) — leitura limpa
  const round025 = (n) => Math.round(n * 4) / 4;
  const available = round025(availableSum);
  return { total, available, absent: round025(total - available) };
}

/* ─── Carga de trabalho por usuário (cruzamento com tarefas) */
export function calcUserWorkload(tasks, userId) {
  const assigned = tasks.filter(t => (t.assignees || []).includes(userId));
  const open     = assigned.filter(t => !['done', 'cancelled'].includes(t.status));
  const overdue  = open.filter(t => {
    if (!t.dueDate) return false;
    const d = t.dueDate?.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
    return d < new Date();
  });
  return {
    total:    assigned.length,
    open:     open.length,
    done:     assigned.filter(t => t.status === 'done').length,
    overdue:  overdue.length,
  };
}

/* ─── Resumo de disponibilidade da equipe com carga ──────── */
export async function getTeamCapacityWithWorkload(userIds, tasks, startDate, endDate) {
  const absences = await fetchAllAbsences({ startDate, endDate });
  return userIds.map(uid => {
    const users = store.get('users') || [];
    const user  = users.find(u => u.id === uid);
    const { available, absent, total } = calcAvailableDays(absences, uid, startDate, endDate);
    const workload = calcUserWorkload(tasks, uid);
    return {
      userId: uid,
      name:   user?.name || uid,
      avatarColor: user?.avatarColor || '#6B7280',
      total, available, absent,
      rate: total ? Math.round((available / total) * 100) : 100,
      workload,
      absences: absences.filter(a => a.userId === uid),
    };
  });
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
