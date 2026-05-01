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
  getDoc, getDocs, query, where, orderBy, serverTimestamp, limit,
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
  { name: 'Aquario', baias: 4, assentosPorFileira: 6, capacity: 48 },
  { name: 'Salao',   baias: 3, assentosPorFileira: 6, capacity: 36 },
  { name: 'Gouvea',  baias: 2, assentosPorFileira: 6, capacity: 24 },
];
export const DEFAULT_SECTOR_RULES = [
  { sector: 'PTS',         slots: 15, dias: 'Seg a Sex' },
  { sector: 'Marketing',   slots: 10, dias: 'Ter, Qui'  },
  { sector: 'TI',          slots: 20, dias: 'Seg a Sex' },
  { sector: 'Financeiro',  slots: 8,  dias: 'Seg, Qua'  },
  { sector: 'RH',          slots: 5,  dias: 'Sex'        },
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
