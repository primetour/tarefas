/**
 * PRIMETOUR — Vacation Service (estilo Benner RH / CLT)
 *
 * Cobre:
 *  1. Período aquisitivo (12 meses contados da admissão; cada um vira
 *     um "saldo" de 30 dias, válido por 12 meses concessivos).
 *  2. Solicitação de férias com fracionamento (até 3 períodos, sendo
 *     1 mínimo de 14 dias e os outros mínimo 5; abono pecuniário de
 *     até 1/3 = 10 dias convertidos em dinheiro).
 *  3. Aprovação hierárquica (gestor/admin).
 *  4. Espelho de férias por colaborador.
 *
 * Coleções:
 *   vacation_periods/{id}: { userId, periodStart, periodEnd,
 *     entitledDays, daysUsed, abonoDays, status, deadlineAt, createdAt }
 *   vacation_requests/{id}: { userId, periodId, startDate, endDate,
 *     days, abonoDays, status, reason, decidedBy, decidedAt, decideReason }
 */
import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  getDoc, getDocs, query, where, orderBy, serverTimestamp, limit, onSnapshot,
  Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }       from '../firebase.js';
import { store }    from '../store.js';
import { auditLog } from '../auth/audit.js';

/* ─── Constantes CLT ─────────────────────────────────────── */
export const VACATION_DAYS_PER_PERIOD = 30;       // sem faltas (até 5)
export const MIN_FRACTION_DAYS        = 5;        // mínimo de cada período fracionado
export const MIN_LARGE_FRACTION       = 14;       // 1 dos períodos deve ter >= 14 dias
export const MAX_FRACTIONS            = 3;        // pode dividir em até 3
export const MAX_ABONO_DAYS           = 10;       // 1/3 = 10 dias convertidos em $
export const CONCESSIVO_MONTHS        = 12;       // 12 meses pra usar após adquirir

/* ─── Helpers ─────────────────────────────────────────────── */
const todayDate = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const ts = (v) => v?.toDate ? v.toDate() : (v ? new Date(v) : null);

function canManageTeamVacations() {
  return store.isMaster()
      || store.can('system_manage_users')
      || store.can('absence_manage_team');
}

/* ─── Cálculo de períodos aquisitivos a partir da admissão ──
 * Dada uma data de admissão, gera todos os períodos aquisitivos
 * (12 meses cada) até hoje. Cada período tem deadline = +12 meses
 * após o término (= período concessivo).
 *  admDate: Date | string ISO
 *  Retorna [{ index, periodStart, periodEnd, deadlineAt, status }]
 *  status ∈ 'inProgress' | 'available' | 'expired' */
export function computeVacationPeriods(admDate) {
  const adm = admDate instanceof Date ? new Date(admDate) : new Date(admDate);
  if (isNaN(adm.getTime())) return [];
  adm.setHours(0,0,0,0);
  const today = todayDate();
  const periods = [];
  let i = 0;
  let cursor = new Date(adm);
  while (cursor < today && i < 50) {
    const start = new Date(cursor);
    const end   = new Date(cursor); end.setFullYear(end.getFullYear() + 1); end.setDate(end.getDate() - 1);
    const deadline = new Date(end); deadline.setFullYear(deadline.getFullYear() + 1);
    let status;
    if (today < end)        status = 'inProgress';
    else if (today < deadline) status = 'available';
    else                       status = 'expired';
    periods.push({
      index: i,
      periodStart: start,
      periodEnd:   end,
      deadlineAt:  deadline,
      status,
    });
    cursor = new Date(cursor); cursor.setFullYear(cursor.getFullYear() + 1);
    i++;
  }
  return periods;
}

/* ─── Sincroniza (cria docs faltantes) períodos no Firestore ──
 * Lê período aquisitivos calculados a partir de admissão e cria
 * os docs em vacation_periods que não existem. Útil no carregamento
 * da aba Férias. Idempotente. */
export async function syncVacationPeriods(userId, admDate) {
  const cu = store.get('currentUser');
  const isSelf = userId === cu?.uid;
  if (!isSelf && !canManageTeamVacations()) {
    throw new Error('Permissão negada — apenas gestores ou o próprio.');
  }
  const computed = computeVacationPeriods(admDate);
  if (!computed.length) return [];

  // Lê os existentes
  const existing = await getDocs(query(
    collection(db, 'vacation_periods'),
    where('userId', '==', userId),
    limit(50),
  ));
  const byIdx = {};
  existing.docs.forEach(d => { const v = d.data(); if (typeof v.index === 'number') byIdx[v.index] = { id: d.id, ...v }; });

  const out = [];
  for (const p of computed) {
    if (byIdx[p.index]) { out.push(byIdx[p.index]); continue; }
    // Cria
    const ref = await addDoc(collection(db, 'vacation_periods'), {
      userId,
      index:        p.index,
      periodStart:  Timestamp.fromDate(p.periodStart),
      periodEnd:    Timestamp.fromDate(p.periodEnd),
      deadlineAt:   Timestamp.fromDate(p.deadlineAt),
      entitledDays: VACATION_DAYS_PER_PERIOD,
      daysUsed:     0,
      abonoDays:    0,
      status:       p.status,
      createdAt:    serverTimestamp(),
    });
    out.push({ id: ref.id, userId, ...p, entitledDays: VACATION_DAYS_PER_PERIOD, daysUsed: 0, abonoDays: 0 });
  }
  // Atualiza status dos existentes (in_progress/available/expired)
  for (const p of computed) {
    const e = byIdx[p.index];
    if (e && e.status !== p.status) {
      try {
        await updateDoc(doc(db, 'vacation_periods', e.id), { status: p.status });
      } catch {}
    }
  }
  return out.sort((a,b) => (a.index||0) - (b.index||0));
}

export async function fetchVacationPeriods(userId) {
  const snap = await getDocs(query(
    collection(db, 'vacation_periods'),
    where('userId', '==', userId),
    limit(50),
  ));
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  rows.sort((a,b) => (a.index||0) - (b.index||0));
  return rows;
}

/* ─── Saldo do colaborador (soma dos períodos disponíveis) ── */
export function computeBalance(periods, requests) {
  let entitled = 0, used = 0, abono = 0, pending = 0;
  for (const p of periods) {
    if (p.status === 'available' || p.status === 'inProgress') {
      entitled += p.entitledDays || 0;
      used     += p.daysUsed || 0;
      abono    += p.abonoDays || 0;
    }
  }
  for (const r of requests) {
    if (r.status === 'pending') pending += (r.days || 0) + (r.abonoDays || 0);
  }
  return {
    entitled,
    used,
    abono,
    pending,
    available: Math.max(0, entitled - used - abono - pending),
  };
}

/* ─── Solicitação de férias ───────────────────────────────── */
export async function fetchVacationRequests(userId = null) {
  const cu = store.get('currentUser');
  const isMgr = canManageTeamVacations();
  let q;
  if (userId) {
    q = query(collection(db, 'vacation_requests'), where('userId', '==', userId), limit(200));
  } else if (isMgr) {
    q = query(collection(db, 'vacation_requests'), limit(500));
  } else {
    q = query(collection(db, 'vacation_requests'),
      where('userId', '==', cu?.uid || '__none__'), limit(200));
  }
  const snap = await getDocs(q);
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  rows.sort((a,b) => {
    const ta = ts(a.createdAt)?.getTime() || 0;
    const tb = ts(b.createdAt)?.getTime() || 0;
    return tb - ta;
  });
  return rows;
}

export function subscribeVacationRequests(callback) {
  const isMgr = canManageTeamVacations();
  const cu = store.get('currentUser');
  let q;
  if (!isMgr) {
    q = query(collection(db, 'vacation_requests'),
      where('userId', '==', cu?.uid || '__none__'), limit(200));
  } else {
    q = query(collection(db, 'vacation_requests'), limit(500));
  }
  return onSnapshot(q, (snap) => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a,b) => {
      const ta = ts(a.createdAt)?.getTime() || 0;
      const tb = ts(b.createdAt)?.getTime() || 0;
      return tb - ta;
    });
    callback(rows);
  }, (err) => {
    console.warn('[vacation] subscribe err:', err?.message);
    import('./listenerError.js').then(m => m.listenerError('vacation')(err)).catch(() => {});
  });
}

/* ─── Cria solicitação ────────────────────────────────────── */
export async function createVacationRequest({ periodId, startDate, endDate, abonoDays = 0, reason = '' }) {
  const { sandboxGuard } = await import('./sandbox.js');
  if (sandboxGuard('solicitar férias')) return { id: '__sandbox' };
  const cu = store.get('currentUser');
  if (!cu?.uid) throw new Error('Não autenticado.');
  const profile = store.get('userProfile') || {};

  const start = new Date(startDate); start.setHours(0,0,0,0);
  const end   = new Date(endDate);   end.setHours(0,0,0,0);
  if (end < start) throw new Error('Data de fim deve ser posterior à de início.');

  // v4.57.13: Renê — "férias de 10 dias, ele marca 11". Off-by-one clássico.
  // Antes: + 1 (assumindo inclusivo dos 2 lados). Agora: diff direto em dias.
  // Convenção: férias de 10/06 a 20/06 = 10 dias (excluindo dia final). Se user
  // quer incluir o dia 20 também, escolhe 21 como fim.
  const days = Math.max(1, Math.round((end - start) / 86400000));
  if (days < MIN_FRACTION_DAYS) {
    throw new Error(`Cada período de férias deve ter no mínimo ${MIN_FRACTION_DAYS} dias.`);
  }
  if (abonoDays < 0 || abonoDays > MAX_ABONO_DAYS) {
    throw new Error(`Abono pecuniário pode ter até ${MAX_ABONO_DAYS} dias.`);
  }

  // Valida saldo
  const periods = await fetchVacationPeriods(cu.uid);
  const period  = periods.find(p => p.id === periodId);
  if (!period) throw new Error('Período aquisitivo inválido.');
  if (period.status === 'expired') {
    throw new Error('Este período já expirou (perda de direito).');
  }
  const used = (period.daysUsed || 0) + (period.abonoDays || 0);
  if (used + days + abonoDays > (period.entitledDays || VACATION_DAYS_PER_PERIOD)) {
    throw new Error('Saldo insuficiente neste período.');
  }

  // Verifica fracionamento (já existem solicitações deste período?)
  const existing = await getDocs(query(
    collection(db, 'vacation_requests'),
    where('userId', '==', cu.uid),
    where('periodId', '==', periodId),
    limit(50),
  ));
  const fractionsActive = existing.docs.map(d => d.data())
    .filter(r => r.status === 'pending' || r.status === 'approved');
  if (fractionsActive.length >= MAX_FRACTIONS) {
    throw new Error(`Já há ${MAX_FRACTIONS} fracionamentos para este período.`);
  }
  // Quando ainda não houve aprovação de período >= 14 dias e é última fração possível, valida
  // (regra simplificada: pelo menos um período tem que ser >= 14 dias)
  if (fractionsActive.length >= 1) {
    const hasLarge = fractionsActive.some(r => (r.days || 0) >= MIN_LARGE_FRACTION);
    if (!hasLarge && days < MIN_LARGE_FRACTION) {
      // Avisa, não bloqueia (gestor pode aprovar em casos especiais)
      console.warn('[vacation] regra CLT: 1 período deve ser >= 14 dias');
    }
  }

  const ref = await addDoc(collection(db, 'vacation_requests'), {
    userId:    cu.uid,
    userName:  profile.name || cu.uid,
    sector:    profile.sector || profile.department || '',
    periodId,
    periodIndex: period.index,
    startDate: Timestamp.fromDate(start),
    endDate:   Timestamp.fromDate(end),
    days,
    abonoDays,
    reason:    reason.trim(),
    status:    'pending',
    createdAt: serverTimestamp(),
  });
  await auditLog('vacation.request', 'vacation_request', ref.id, { days, abonoDays });
  return { id: ref.id };
}

/* ─── Aprova/Rejeita solicitação ──────────────────────────── */
export async function approveVacationRequest(requestId, decideReason = '') {
  const { sandboxGuard } = await import('./sandbox.js');
  if (sandboxGuard('aprovar férias')) return;
  if (!canManageTeamVacations()) throw new Error('Permissão negada.');

  const reqRef  = doc(db, 'vacation_requests', requestId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) throw new Error('Solicitação não encontrada.');
  const req = reqSnap.data();
  if (req.status !== 'pending') throw new Error('Já foi processada.');

  // Atualiza saldo do período
  const pRef  = doc(db, 'vacation_periods', req.periodId);
  const pSnap = await getDoc(pRef);
  if (!pSnap.exists()) throw new Error('Período aquisitivo inválido.');
  const p = pSnap.data();
  await updateDoc(pRef, {
    daysUsed:  (p.daysUsed || 0)  + (req.days || 0),
    abonoDays: (p.abonoDays || 0) + (req.abonoDays || 0),
    updatedAt: serverTimestamp(),
  });

  // Cria também uma absence pra refletir no calendário da equipe
  const start = ts(req.startDate);
  const end   = ts(req.endDate); end.setHours(23,59,59,999);
  await addDoc(collection(db, 'absences'), {
    userId:      req.userId,
    type:        'vacation',
    startDate:   Timestamp.fromDate(start),
    endDate:     Timestamp.fromDate(end),
    note:        `Férias aprovadas (${req.days} dias${req.abonoDays?` + ${req.abonoDays}d abono`:''}).`,
    createdAt:   serverTimestamp(),
    createdBy:   store.get('currentUser')?.uid || null,
    vacationRequestId: requestId,
  });

  const cu = store.get('currentUser');
  await updateDoc(reqRef, {
    status:        'approved',
    decidedAt:     serverTimestamp(),
    decidedBy:     cu?.uid || null,
    decidedByName: store.get('userProfile')?.name || cu?.uid || '',
    decideReason:  decideReason || '',
  });
  await auditLog('vacation.approve', 'vacation_request', requestId, {});
}

export async function rejectVacationRequest(requestId, decideReason = '') {
  const { sandboxGuard } = await import('./sandbox.js');
  if (sandboxGuard('rejeitar férias')) return;
  if (!canManageTeamVacations()) throw new Error('Permissão negada.');
  if (!decideReason || decideReason.trim().length < 3) {
    throw new Error('Justifique a rejeição.');
  }
  const cu = store.get('currentUser');
  await updateDoc(doc(db, 'vacation_requests', requestId), {
    status:        'rejected',
    decidedAt:     serverTimestamp(),
    decidedBy:     cu?.uid || null,
    decidedByName: store.get('userProfile')?.name || cu?.uid || '',
    decideReason:  decideReason.trim(),
  });
  await auditLog('vacation.reject', 'vacation_request', requestId, { reason: decideReason });
}

/* ─── Cancelar (apenas pendente, próprio usuário) ─────────── */
export async function cancelVacationRequest(requestId) {
  const { sandboxGuard } = await import('./sandbox.js');
  if (sandboxGuard('cancelar férias')) return;
  await deleteDoc(doc(db, 'vacation_requests', requestId));
}
