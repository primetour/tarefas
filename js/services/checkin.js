/**
 * PRIMETOUR — Check-in Service (migração de minhamesa)
 *
 * Cobre 3 funcionalidades:
 *  1. RESERVA de estação (collection: desk_reservations)
 *     { data: 'YYYY-MM-DD', userId, userName, sector, area, fileira, assento,
 *       checkinAt: Timestamp|null, items: { caboRede, caboMonitor, cadeira },
 *       speedtest: { download, upload, tipo } }
 *
 *  2. CONFIGURAÇÃO (collection: desk_config, doc: 'global')
 *     { areas: [{ name, capacity, fileiras, assentosPorFileira }],
 *       sectorRules: [{ sector, slots, dias }] }
 *
 *  3. REGISTRO DE PONTO (collection: time_clock)
 *     { userId, date: 'YYYY-MM-DD', in, lunchOut, lunchIn, out } (timestamps)
 *
 * RBAC:
 *  - Qualquer usuário autenticado: cria/lê própria reserva e ponto
 *  - manager+ pode ver tudo + alterar config
 *  - check-in é livre pra qualquer usuário com reserva
 */
import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  getDoc, getDocs, query, where, orderBy, serverTimestamp, limit, onSnapshot,
  Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';

/* ─── Defaults (vêm do app legacy minhamesa) ─────────────────
 * Cada área tem N baias. Cada baia tem 2 fileiras (frente A / fundo B)
 * de 6 assentos cada (numerados 1-6). Total por baia = 12 assentos.
 *  Aquario: 4 baias × 12 = 48
 *  Salao:   3 baias × 12 = 36
 *  Gouvea:  2 baias × 12 = 24
 *  TOTAL = 108 assentos */
export const DEFAULT_AREAS = [
  // `name` é a chave técnica (sem acento, usada no DB e em comparações).
  // `displayName` é como aparece na UI (com acentuação correta).
  { name: 'Aquario', displayName: 'Aquário', baias: 4, assentosPorFileira: 6, capacity: 48 },
  { name: 'Salao',   displayName: 'Salão',   baias: 3, assentosPorFileira: 6, capacity: 36 },
  { name: 'Gouvea',  displayName: 'Gouvêa',  baias: 2, assentosPorFileira: 6, capacity: 24 },
];
/* Defaults usam nomes que JÁ estão cadastrados em REQUESTING_AREAS (tasks.js).
 * Admin pode editar livremente na aba Administração — qualquer setor
 * fora do cadastro fica marcado "fora do cadastro" no select. */
export const DEFAULT_SECTOR_RULES = [
  { sector: 'PTS Bradesco', slots: 15, dias: 'Seg a Sex' },
  { sector: 'Marketing',    slots: 10, dias: 'Ter, Qui'  },
  { sector: 'TI',           slots: 20, dias: 'Seg a Sex' },
  { sector: 'Financeiro',   slots: 8,  dias: 'Seg, Qua'  },
  { sector: 'C&P',          slots: 5,  dias: 'Sex'        },
];

/* ─── Helpers ─────────────────────────────────────────────── */
const todayISO = () => {
  const d = new Date();
  d.setHours(0,0,0,0);
  return d.toISOString().slice(0,10);
};
const ts = (v) => v?.toDate ? v.toDate() : (v ? new Date(v) : null);

/* ─── Configuração ───────────────────────────────────────── */
export async function fetchCheckinConfig() {
  try {
    const snap = await getDoc(doc(db, 'desk_config', 'global'));
    if (snap.exists()) {
      const d = snap.data();
      return {
        areas:        d.areas        || DEFAULT_AREAS,
        sectorRules:  d.sectorRules  || DEFAULT_SECTOR_RULES,
      };
    }
  } catch {}
  return { areas: DEFAULT_AREAS, sectorRules: DEFAULT_SECTOR_RULES };
}
export async function saveCheckinConfig({ areas, sectorRules }) {
  if (!store.isMaster() && !store.can('system_manage_settings')) {
    throw new Error('Permissão negada — só admin pode editar a config.');
  }
  await setDoc(doc(db, 'desk_config', 'global'), {
    areas, sectorRules,
    updatedAt: serverTimestamp(),
    updatedBy: store.get('currentUser')?.uid || null,
  }, { merge: true });
}

/* ─── Reservas ───────────────────────────────────────────── */
export async function fetchReservations({ from, to } = {}) {
  // Default: últimos 30 dias até +14 (janela de operação)
  const fromDate = from || (() => { const d = new Date(); d.setDate(d.getDate()-30); return d.toISOString().slice(0,10); })();
  const toDate   = to   || (() => { const d = new Date(); d.setDate(d.getDate()+14); return d.toISOString().slice(0,10); })();
  // Sem range query no servidor (range em data + orderBy exige índice
  // composto). Filtra/ordena no client com limit alto suficiente.
  const snap = await getDocs(query(
    collection(db, 'desk_reservations'),
    where('data', '>=', fromDate),
    where('data', '<=', toDate),
    limit(500),
  ));
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  rows.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  return rows;
}

/* ─── Real-time: assina mudanças nas reservas ────────────────
 * Retorna função de cancelamento (chamada quando der unmount).
 * Anti-corrida por lugares: cada reserva criada por outro user
 * dispara este callback em < 1s, atualizando o mapa instantâneo. */
export function subscribeReservations({ from, to } = {}, callback) {
  const fromDate = from || (() => { const d = new Date(); d.setDate(d.getDate()-30); return d.toISOString().slice(0,10); })();
  const toDate   = to   || (() => { const d = new Date(); d.setDate(d.getDate()+14); return d.toISOString().slice(0,10); })();
  const q = query(
    collection(db, 'desk_reservations'),
    where('data', '>=', fromDate),
    where('data', '<=', toDate),
    limit(500),
  );
  return onSnapshot(q, (snap) => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
    callback(rows);
  }, (err) => {
    console.warn('[checkin] subscribe error:', err?.message);
  });
}

/* ─── Real-time: assina meu time_clock do dia atual ──────── */
export function subscribeMyTimeClock(callback) {
  const cu = store.get('currentUser');
  if (!cu?.uid) return () => {};
  const id = timeClockId(cu.uid, todayISO());
  return onSnapshot(doc(db, 'time_clock', id), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}
export async function createReservation({ data, sector, area, baia, fileira, assento, userName }) {
  // Sandbox guard
  const { sandboxGuard } = await import('./sandbox.js');
  if (sandboxGuard('reservar estação')) return { id: '__sandbox', data };

  const cu = store.get('currentUser');
  // Checa duplicata: mesma data + (área+baia+fileira+assento)
  const dupSeat = await getDocs(query(
    collection(db, 'desk_reservations'),
    where('data', '==', data),
    where('area', '==', area),
    where('baia', '==', baia),
    where('fileira', '==', fileira),
    where('assento', '==', assento),
    limit(1),
  ));
  if (!dupSeat.empty) throw new Error('Estação já reservada nesta data.');
  // Checa duplicata: usuário já tem reserva nesta data
  const dupUser = await getDocs(query(
    collection(db, 'desk_reservations'),
    where('data', '==', data),
    where('userName', '==', userName),
    limit(1),
  ));
  if (!dupUser.empty) throw new Error('Você já tem uma reserva nesta data.');
  // Checa regra de setor (capacidade do dia)
  if (sector) {
    const cfg = await fetchCheckinConfig();
    const rule = (cfg.sectorRules || []).find(r => r.sector === sector);
    if (rule?.slots) {
      const sectorReservations = await getDocs(query(
        collection(db, 'desk_reservations'),
        where('data', '==', data),
        where('sector', '==', sector),
      ));
      if (sectorReservations.size >= rule.slots) {
        throw new Error(`Setor ${sector} atingiu o limite (${rule.slots} estações) nesta data.`);
      }
    }
  }

  const docRef = await addDoc(collection(db, 'desk_reservations'), {
    data, sector, area, baia, fileira, assento,
    userName,
    userId:    cu?.uid || null,
    checkinAt: null,
    items:     {},
    speedtest: {},
    createdAt: serverTimestamp(),
    createdBy: cu?.uid || null,
  });
  return { id: docRef.id };
}
export async function deleteReservation(id) {
  const { sandboxGuard } = await import('./sandbox.js');
  if (sandboxGuard('cancelar reserva')) return;
  await deleteDoc(doc(db, 'desk_reservations', id));
}
export async function performCheckin(reservationId, { items, speedtest }) {
  const { sandboxGuard } = await import('./sandbox.js');
  if (sandboxGuard('fazer check-in')) return;
  await updateDoc(doc(db, 'desk_reservations', reservationId), {
    checkinAt: serverTimestamp(),
    items:     items     || {},
    speedtest: speedtest || {},
  });
}

/* ─── Ponto (registro de jornada) ─────────────────────────
 * 1 doc por usuário+data. Campos: in, lunchOut, lunchIn, out.
 * Sequência esperada: in → lunchOut → lunchIn → out.
 * O service NÃO impede fora-de-ordem (admin ajusta), apenas grava timestamp.
 */
function timeClockId(uid, dateISO) { return `${uid}_${dateISO}`; }

export async function fetchMyTimeClock(dateISO = todayISO()) {
  const cu = store.get('currentUser');
  if (!cu?.uid) return null;
  const snap = await getDoc(doc(db, 'time_clock', timeClockId(cu.uid, dateISO)));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function fetchTimeClockRange({ userId, from, to }) {
  // Lista pontos de um usuário (ou todos se userId omitido + admin)
  const cu = store.get('currentUser');
  const ownOnly = !store.isMaster() && !store.can('absence_manage_team') && !store.can('system_manage_users');
  const targetUid = ownOnly ? cu?.uid : (userId || cu?.uid);
  // Sem orderBy no servidor pra evitar exigir índice composto.
  // Como o limit é 200 e ordena no client, performance ok.
  let q = query(
    collection(db, 'time_clock'),
    where('userId', '==', targetUid),
    limit(200),
  );
  const snap = await getDocs(q);
  let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (from) rows = rows.filter(r => r.date >= from);
  if (to)   rows = rows.filter(r => r.date <= to);
  rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return rows;
}

export async function fetchAllTimeClock({ from, to }) {
  // Para gestores: lista de todos no período (sem filtro de uid)
  if (!store.isMaster() && !store.can('absence_manage_team') && !store.can('system_manage_users')) {
    throw new Error('Permissão negada — apenas gestores.');
  }
  let q = query(collection(db, 'time_clock'), limit(2000));
  const snap = await getDocs(q);
  let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (from) rows = rows.filter(r => r.date >= from);
  if (to)   rows = rows.filter(r => r.date <= to);
  rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return rows;
}

export async function clockEvent(eventType /* 'in' | 'lunchOut' | 'lunchIn' | 'out' */) {
  const { sandboxGuard } = await import('./sandbox.js');
  if (sandboxGuard(`registrar ${eventType}`)) return;
  const cu = store.get('currentUser');
  if (!cu?.uid) throw new Error('Não autenticado.');
  const date = todayISO();
  const id   = timeClockId(cu.uid, date);
  const ref  = doc(db, 'time_clock', id);
  const snap = await getDoc(ref);
  const now  = serverTimestamp();

  const allowed = ['in', 'lunchOut', 'lunchIn', 'out'];
  if (!allowed.includes(eventType)) throw new Error('Evento inválido.');

  if (snap.exists()) {
    const data = snap.data();
    if (data[eventType]) throw new Error(`${eventType} já registrado hoje.`);
    await updateDoc(ref, { [eventType]: now, updatedAt: now });
  } else {
    await setDoc(ref, {
      userId:    cu.uid,
      userName:  store.get('userProfile')?.name || cu.uid,
      sector:    store.get('userProfile')?.sector || store.get('userProfile')?.department || '',
      date,
      [eventType]: now,
      createdAt: now,
    });
  }
  return { date, eventType };
}

/* ─── Recusar registro de ponto (decisão consciente) ──────
 * Grava no doc do dia que o usuário recusou bater ponto.
 * Aparece no relatório como "ausente por escolha". */
export async function declineTimeClock(reason = '') {
  const { sandboxGuard } = await import('./sandbox.js');
  if (sandboxGuard('recusar ponto')) return;
  const cu = store.get('currentUser');
  if (!cu?.uid) throw new Error('Não autenticado.');
  const date = todayISO();
  const id   = timeClockId(cu.uid, date);
  const ref  = doc(db, 'time_clock', id);
  const snap = await getDoc(ref);
  if (snap.exists() && snap.data().in) {
    throw new Error('Já existe registro de ponto hoje.');
  }
  await setDoc(ref, {
    userId:    cu.uid,
    userName:  store.get('userProfile')?.name || cu.uid,
    sector:    store.get('userProfile')?.sector || store.get('userProfile')?.department || '',
    date,
    declined:  true,
    declineReason: reason || null,
    declinedAt: serverTimestamp(),
    createdAt:  serverTimestamp(),
  }, { merge: true });
}

/* ─── Speedtest (Cloudflare CDN, mesma lógica do minhamesa) ──
 * Retorna { download: 'X.XX' Mbps, upload: 'X.XX' Mbps, tipo: 'desktop-cabo'|... }
 * Se falhar, devolve 'Erro' nos campos correspondentes. */
export async function runSpeedTest() {
  const result = { download: 'N/A', upload: 'N/A', tipo: detectConnectionType() };

  // Download — 6 streams paralelos de 5MB
  try {
    const STREAMS = 6, SIZE = 5_000_000, ts = Date.now();
    const start = performance.now();
    const blobs = await Promise.all(
      Array.from({ length: STREAMS }, (_, i) =>
        fetch(`https://speed.cloudflare.com/__down?bytes=${SIZE}&r=${ts}${i}`,
          { cache: 'no-store' })
          .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      )
    );
    const elapsed = (performance.now() - start) / 1000;
    const totalBytes = blobs.reduce((s, b) => s + b.size, 0);
    result.download = ((totalBytes * 8) / elapsed / 1e6).toFixed(2);
  } catch (e) { result.download = 'Erro'; }

  // Upload — 4 streams paralelos de 8MB
  try {
    const STREAMS = 4, SIZE = 8_000_000, ts = Date.now();
    const start = performance.now();
    await Promise.all(
      Array.from({ length: STREAMS }, (_, i) => {
        const fd = new FormData();
        fd.append('d', new Blob([new Uint8Array(SIZE)]));
        return fetch(`https://speed.cloudflare.com/__up?r=${ts}${i}`, {
          method: 'POST', body: fd, mode: 'no-cors', cache: 'no-store',
        });
      })
    );
    const elapsed = (performance.now() - start) / 1000;
    result.upload = ((STREAMS * SIZE * 8) / elapsed / 1e6).toFixed(2);
  } catch (e) { result.upload = 'Erro'; }

  return result;
}

function detectConnectionType() {
  const ua = navigator.userAgent;
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  if (isMobile) {
    if (navigator.connection?.type === 'cellular') return 'celular-dados';
    return 'celular-wifi';
  }
  if (navigator.connection?.type === 'ethernet') return 'desktop-cabo';
  if (navigator.connection?.type === 'wifi')     return 'desktop-wifi';
  return 'desktop-cabo';  // assume cabo no desktop como default
}

/* ─── Cálculo de horas trabalhadas (a partir do registro) ─ */
export function calcWorkedHours(rec) {
  if (!rec) return 0;
  const tIn  = ts(rec.in);
  const tOut = ts(rec.out);
  if (!tIn || !tOut) return 0;
  let totalMs = tOut - tIn;
  const tLO = ts(rec.lunchOut), tLI = ts(rec.lunchIn);
  if (tLO && tLI) totalMs -= (tLI - tLO);
  return Math.max(0, totalMs) / 3600000; // horas
}

/* ═════════════════════════════════════════════════════════════
 * EDIÇÃO / EXCLUSÃO DE PONTO (admin / gestor)
 * ═════════════════════════════════════════════════════════════
 * Padrão Benner RH: gestor pode corrigir registro de qualquer
 * colaborador (esquece de bater, esquece almoço etc). Cada
 * alteração gera entry no time_clock_audit (rastreabilidade).
 */
function canManageTimeClocks() {
  return store.isMaster()
      || store.can('system_manage_users')
      || store.can('absence_manage_team');
}

/**
 * Combina date (YYYY-MM-DD) + horário (HH:MM ou HH:MM:SS) em Date local.
 * Devolve null se valor vazio. */
export function combineDateTime(dateISO, timeStr) {
  if (!timeStr) return null;
  const [h, m, s = '0'] = String(timeStr).split(':');
  const [y, mo, d] = String(dateISO).split('-').map(Number);
  return new Date(y, mo - 1, d, parseInt(h)||0, parseInt(m)||0, parseInt(s)||0);
}

/**
 * Cria registro de ponto manualmente (admin lança um ponto que
 * não foi batido). Útil para colaborador esqueceu o dia inteiro.
 *  fields = { in, lunchOut, lunchIn, out } // valores HH:MM ou null */
export async function adminCreateTimeClock({ userId, userName, sector, date, fields, note }) {
  const { sandboxGuard } = await import('./sandbox.js');
  if (sandboxGuard('criar registro de ponto')) return;
  if (!canManageTimeClocks()) throw new Error('Permissão negada — apenas gestores.');
  if (!userId || !date) throw new Error('userId e date são obrigatórios.');

  const id  = timeClockId(userId, date);
  const ref = doc(db, 'time_clock', id);
  const snap = await getDoc(ref);
  if (snap.exists() && (snap.data().in || snap.data().out)) {
    throw new Error('Já existe registro nesta data. Use editar.');
  }
  const cu = store.get('currentUser');
  const payload = {
    userId, userName: userName || '', sector: sector || '',
    date,
    createdAt: serverTimestamp(),
    createdBy: cu?.uid || null,
    manual: true,
    manualNote: note || '',
  };
  ['in','lunchOut','lunchIn','out'].forEach(k => {
    const t = combineDateTime(date, fields?.[k]);
    if (t) payload[k] = Timestamp.fromDate(t);
  });
  await setDoc(ref, payload, { merge: true });

  await addDoc(collection(db, 'time_clock_audit'), {
    recordId: id, userId, date,
    action: 'create',
    actorId: cu?.uid || null,
    actorName: store.get('userProfile')?.name || cu?.uid || '',
    after: { ...fields },
    note: note || '',
    at: serverTimestamp(),
  });
  return { id };
}

/**
 * Edita registro existente. Admin/gestor altera horários de in/lunchOut/lunchIn/out.
 *  fields = { in?, lunchOut?, lunchIn?, out? } strings HH:MM ou null pra apagar */
export async function adminUpdateTimeClock({ recordId, date, fields, note }) {
  const { sandboxGuard } = await import('./sandbox.js');
  if (sandboxGuard('editar registro de ponto')) return;
  if (!canManageTimeClocks()) throw new Error('Permissão negada — apenas gestores.');

  const ref = doc(db, 'time_clock', recordId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Registro não encontrado.');
  const before = snap.data();

  const update = {
    updatedAt: serverTimestamp(),
    updatedBy: store.get('currentUser')?.uid || null,
    manual: true,
    manualNote: note || before.manualNote || '',
  };
  ['in','lunchOut','lunchIn','out'].forEach(k => {
    if (fields && (k in fields)) {
      const v = fields[k];
      if (v === '' || v === null) update[k] = null;
      else {
        const t = combineDateTime(date || before.date, v);
        if (t) update[k] = Timestamp.fromDate(t);
      }
    }
  });
  await updateDoc(ref, update);

  const beforeFmt = {};
  ['in','lunchOut','lunchIn','out'].forEach(k => {
    const v = before[k];
    if (v) {
      const d = v.toDate ? v.toDate() : new Date(v);
      beforeFmt[k] = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }
  });
  const cu = store.get('currentUser');
  await addDoc(collection(db, 'time_clock_audit'), {
    recordId, userId: before.userId, date: before.date,
    action: 'update',
    actorId: cu?.uid || null,
    actorName: store.get('userProfile')?.name || cu?.uid || '',
    before: beforeFmt,
    after: { ...fields },
    note: note || '',
    at: serverTimestamp(),
  });
}

/** Exclui registro (admin only). */
export async function adminDeleteTimeClock(recordId) {
  const { sandboxGuard } = await import('./sandbox.js');
  if (sandboxGuard('excluir registro de ponto')) return;
  if (!store.isMaster() && !store.can('system_manage_users')) {
    throw new Error('Permissão negada — apenas admin.');
  }
  const ref = doc(db, 'time_clock', recordId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Registro não encontrado.');
  const before = snap.data();

  await deleteDoc(ref);
  const cu = store.get('currentUser');
  await addDoc(collection(db, 'time_clock_audit'), {
    recordId, userId: before.userId, date: before.date,
    action: 'delete',
    actorId: cu?.uid || null,
    actorName: store.get('userProfile')?.name || cu?.uid || '',
    before,
    at: serverTimestamp(),
  });
}

/** Busca histórico de auditoria de um registro específico. */
export async function fetchTimeClockAudit(recordId) {
  const snap = await getDocs(query(
    collection(db, 'time_clock_audit'),
    where('recordId', '==', recordId),
    limit(50),
  ));
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  rows.sort((a, b) => {
    const ta = a.at?.toDate ? a.at.toDate().getTime() : 0;
    const tb = b.at?.toDate ? b.at.toDate().getTime() : 0;
    return tb - ta;
  });
  return rows;
}

/* ═════════════════════════════════════════════════════════════
 * SOLICITAÇÕES DE CORREÇÃO (collection: time_clock_requests)
 * ═════════════════════════════════════════════════════════════
 * Quando o colaborador esquece, ele pede ao superior:
 *   { userId, userName, sector, date, proposed: {in, lunchOut, lunchIn, out},
 *     reason, status: 'pending'|'approved'|'rejected',
 *     createdAt, decidedAt, decidedBy, decideReason }
 */
export async function requestTimeClockCorrection({ date, proposed, reason }) {
  const { sandboxGuard } = await import('./sandbox.js');
  if (sandboxGuard('solicitar correção de ponto')) return { id: '__sandbox' };
  const cu = store.get('currentUser');
  if (!cu?.uid) throw new Error('Não autenticado.');
  if (!date) throw new Error('Data é obrigatória.');
  if (!reason || reason.trim().length < 5) throw new Error('Justificativa obrigatória (mínimo 5 caracteres).');

  // Bloqueia duplicatas pendentes pra mesma data
  const dup = await getDocs(query(
    collection(db, 'time_clock_requests'),
    where('userId', '==', cu.uid),
    where('date',   '==', date),
    where('status', '==', 'pending'),
    limit(1),
  ));
  if (!dup.empty) {
    throw new Error('Já existe uma solicitação pendente para esta data.');
  }
  const profile = store.get('userProfile') || {};
  const ref = await addDoc(collection(db, 'time_clock_requests'), {
    userId:    cu.uid,
    userName:  profile.name || cu.uid,
    sector:    profile.sector || profile.department || '',
    date,
    proposed:  proposed || {},
    reason:    reason.trim(),
    status:    'pending',
    createdAt: serverTimestamp(),
  });
  return { id: ref.id };
}

/** Lista correções (admin/gestor → todas; user comum → próprias). */
export async function fetchTimeClockRequests({ status = null, mineOnly = false } = {}) {
  const cu = store.get('currentUser');
  const isMgr = canManageTimeClocks();
  const restrict = mineOnly || !isMgr;
  let q;
  if (restrict) {
    q = query(collection(db, 'time_clock_requests'),
      where('userId', '==', cu?.uid || '__none__'),
      limit(200));
  } else {
    q = query(collection(db, 'time_clock_requests'), limit(500));
  }
  const snap = await getDocs(q);
  let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (status) rows = rows.filter(r => r.status === status);
  rows.sort((a, b) => {
    const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
    const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
    return tb - ta;
  });
  return rows;
}

/** Real-time pra aba Aprovações do gestor. */
export function subscribeTimeClockRequests(callback, { status = 'pending' } = {}) {
  const isMgr = canManageTimeClocks();
  const cu = store.get('currentUser');
  let q;
  if (!isMgr) {
    q = query(collection(db, 'time_clock_requests'),
      where('userId', '==', cu?.uid || '__none__'),
      limit(200));
  } else {
    q = query(collection(db, 'time_clock_requests'), limit(500));
  }
  return onSnapshot(q, (snap) => {
    let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (status) rows = rows.filter(r => r.status === status);
    rows.sort((a, b) => {
      const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
      const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
      return tb - ta;
    });
    callback(rows);
  }, (err) => {
    console.warn('[checkin] subscribe req error:', err?.message);
    // Notifica o callback com array vazio + erro pra UI poder mostrar fallback
    callback([], err);
  });
}

/** Aprova solicitação: aplica fields no time_clock e marca request. */
export async function approveTimeClockRequest(requestId, decideReason = '') {
  const { sandboxGuard } = await import('./sandbox.js');
  if (sandboxGuard('aprovar correção')) return;
  if (!canManageTimeClocks()) throw new Error('Permissão negada — apenas gestores.');

  const reqRef  = doc(db, 'time_clock_requests', requestId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) throw new Error('Solicitação não encontrada.');
  const req = reqSnap.data();
  if (req.status !== 'pending') throw new Error('Solicitação já foi processada.');

  // Aplica no time_clock
  const recId = timeClockId(req.userId, req.date);
  const tcRef = doc(db, 'time_clock', recId);
  const tcSnap = await getDoc(tcRef);

  const update = {};
  ['in','lunchOut','lunchIn','out'].forEach(k => {
    const v = req.proposed?.[k];
    if (v === '' || v === null || v === undefined) return;
    const t = combineDateTime(req.date, v);
    if (t) update[k] = Timestamp.fromDate(t);
  });

  if (tcSnap.exists()) {
    await updateDoc(tcRef, {
      ...update,
      manual: true,
      manualNote: `Correção aprovada (${decideReason || 'sem comentário'})`,
      updatedAt: serverTimestamp(),
      updatedBy: store.get('currentUser')?.uid || null,
    });
  } else {
    await setDoc(tcRef, {
      userId:   req.userId,
      userName: req.userName,
      sector:   req.sector,
      date:     req.date,
      manual:   true,
      manualNote: `Correção aprovada (${decideReason || 'sem comentário'})`,
      createdAt: serverTimestamp(),
      ...update,
    });
  }

  const cu = store.get('currentUser');
  await updateDoc(reqRef, {
    status: 'approved',
    decidedAt: serverTimestamp(),
    decidedBy: cu?.uid || null,
    decidedByName: store.get('userProfile')?.name || cu?.uid || '',
    decideReason: decideReason || '',
  });
  await addDoc(collection(db, 'time_clock_audit'), {
    recordId: recId,
    userId:   req.userId,
    date:     req.date,
    action:   'approve_request',
    requestId,
    actorId:  cu?.uid || null,
    actorName: store.get('userProfile')?.name || cu?.uid || '',
    after:    req.proposed,
    note:     decideReason || '',
    at:       serverTimestamp(),
  });
}

/** Rejeita solicitação. */
export async function rejectTimeClockRequest(requestId, decideReason = '') {
  const { sandboxGuard } = await import('./sandbox.js');
  if (sandboxGuard('rejeitar correção')) return;
  if (!canManageTimeClocks()) throw new Error('Permissão negada — apenas gestores.');
  if (!decideReason || decideReason.trim().length < 3) {
    throw new Error('Justifique a rejeição (mínimo 3 caracteres).');
  }
  const cu = store.get('currentUser');
  await updateDoc(doc(db, 'time_clock_requests', requestId), {
    status: 'rejected',
    decidedAt: serverTimestamp(),
    decidedBy: cu?.uid || null,
    decidedByName: store.get('userProfile')?.name || cu?.uid || '',
    decideReason: decideReason.trim(),
  });
}

/* ═════════════════════════════════════════════════════════════
 * BANCO DE HORAS / JORNADA ESPERADA
 * ═════════════════════════════════════════════════════════════
 * Para cada dia útil (seg-sex), o colaborador deve trabalhar X horas.
 * Saldo = sum(workedHours) - sum(expectedHours) ao longo do período.
 * Configurável via desk_config.workdayHours (default 8h).
 */
export const DEFAULT_WORKDAY_HOURS = 8;

export function isBusinessDay(dateISO) {
  const d = new Date(dateISO + 'T12:00:00');
  const dow = d.getDay();
  return dow !== 0 && dow !== 6;
}

/**
 * Calcula banco de horas a partir de um array de records (time_clock).
 *  records: [{ date, in, out, lunchOut, lunchIn, declined? }]
 *  expectedPerDay: jornada padrão em horas (default 8)
 *  Retorna {
 *    daysWorked, daysExpected, totalWorked, totalExpected,
 *    balance,  // saldo positivo = hora extra; negativo = a compensar
 *    avgPerDay,
 *    overtimeDays, // dias com mais que jornada
 *    deficitDays,  // dias com menos que jornada (excluindo declined)
 *  } */
export function calcBancoHoras(records, expectedPerDay = DEFAULT_WORKDAY_HOURS) {
  let totalWorked = 0, daysWorked = 0;
  let overtime = 0, deficit = 0;
  // Considera apenas dias úteis presentes nos records (não conta finais de semana)
  // E dias que o usuário NÃO recusou ponto.
  const businessRecords = records.filter(r => isBusinessDay(r.date) && !r.declined);
  businessRecords.forEach(r => {
    const w = calcWorkedHours(r);
    if (w > 0) {
      daysWorked++;
      totalWorked += w;
      if (w > expectedPerDay + 0.05) overtime++;
      else if (w < expectedPerDay - 0.05) deficit++;
    } else if (r.in && !r.out) {
      // Dia incompleto — conta como deficit
      deficit++;
    }
  });
  const totalExpected = daysWorked * expectedPerDay;
  return {
    daysWorked,
    totalWorked,
    totalExpected,
    balance: totalWorked - totalExpected,
    avgPerDay: daysWorked ? totalWorked / daysWorked : 0,
    overtimeDays: overtime,
    deficitDays:  deficit,
    expectedPerDay,
  };
}

/**
 * Para o relatório espelho de ponto: gera linha pra cada dia útil
 * num intervalo, mesmo que sem registro. */
export function buildEspelhoPonto(records, fromISO, toISO, expectedPerDay = DEFAULT_WORKDAY_HOURS) {
  const byDate = {};
  records.forEach(r => { byDate[r.date] = r; });
  const rows = [];
  const start = new Date(fromISO + 'T12:00:00');
  const end   = new Date(toISO   + 'T12:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getDay();
    const isWeekend = (dow === 0 || dow === 6);
    const r = byDate[iso] || null;
    const worked = r ? calcWorkedHours(r) : 0;
    const expected = isWeekend ? 0 : expectedPerDay;
    const status = isWeekend ? 'weekend'
      : r?.declined          ? 'declined'
      : !r                   ? 'absent'
      : (r.in && r.out)      ? (worked >= expected ? 'complete' : 'short')
      : (r.in && !r.out)     ? 'incomplete'
      : 'incomplete';
    rows.push({
      date: iso,
      record: r,
      worked,
      expected,
      balance: worked - expected,
      status,
      isWeekend,
    });
  }
  return rows;
}
