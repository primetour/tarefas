/**
 * PRIMETOUR — Presence Usage Service
 *
 * Agrega tempo de uso do sistema por usuário a partir da coleção
 * `presence_daily` (populada por presence.js a cada heartbeat).
 *
 * Modelo dos docs em presence_daily:
 *   { uid, userName, email, sector, nucleos, date: 'YYYY-MM-DD',
 *     activeMs, idleMs, totalMs, lastSeen, updatedAt }
 *
 * Granularidade: 1 doc por (uid, dia). totalMs cresce com cada heartbeat
 * dentro da janela de continuidade (gaps > 10min são ignorados).
 *
 * Esse serviço é usado pelo dashboard de produtividade.
 */

import {
  collection, getDocs, query, where, orderBy,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase.js';

const COL = 'presence_daily';

/** Converte Date pra string YYYY-MM-DD em UTC (consistente com clientes). */
function isoDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10);
}

/**
 * Busca docs do período e agrega por usuário.
 *
 * @param {Object} opts
 * @param {Date|string} opts.from   — data inicial (Date ou 'YYYY-MM-DD')
 * @param {Date|string} opts.to     — data final (inclusiva)
 * @param {string[]}    [opts.userIds]  — filtra apenas estes UIDs
 * @param {string[]}    [opts.sectors]  — filtra por sector/dept
 * @param {string[]}    [opts.nucleos]  — filtra por núcleo (intersecção)
 * @returns {Promise<Array<{uid, userName, email, sector, nucleos[], activeMs, idleMs, totalMs, daysActive, avgMsPerDay}>>}
 */
export async function fetchUsageByPeriod({ from, to, userIds = null, sectors = null, nucleos = null } = {}) {
  const fromStr = typeof from === 'string' ? from : isoDate(from);
  const toStr   = typeof to   === 'string' ? to   : isoDate(to);

  let docs = [];
  try {
    const q = query(
      collection(db, COL),
      where('date', '>=', fromStr),
      where('date', '<=', toStr),
      orderBy('date', 'asc'),
    );
    const snap = await getDocs(q);
    docs = snap.docs.map(d => d.data());
  } catch (e) {
    console.warn('[presenceUsage] fetchUsageByPeriod error:', e?.message);
    return [];
  }

  // Filtros client-side (evita índices compostos)
  if (Array.isArray(userIds) && userIds.length) {
    const set = new Set(userIds);
    docs = docs.filter(d => set.has(d.uid));
  }
  if (Array.isArray(sectors) && sectors.length) {
    const set = new Set(sectors);
    docs = docs.filter(d => set.has(d.sector));
  }
  if (Array.isArray(nucleos) && nucleos.length) {
    const set = new Set(nucleos);
    docs = docs.filter(d => Array.isArray(d.nucleos) && d.nucleos.some(n => set.has(n)));
  }

  // Agrega por usuário
  const byUser = new Map();
  for (const d of docs) {
    if (!byUser.has(d.uid)) {
      byUser.set(d.uid, {
        uid:        d.uid,
        userName:   d.userName || '',
        email:      d.email || '',
        sector:     d.sector || '',
        nucleos:    Array.isArray(d.nucleos) ? [...d.nucleos] : [],
        activeMs:   0,
        idleMs:     0,
        totalMs:    0,
        daysActive: 0,
      });
    }
    const acc = byUser.get(d.uid);
    acc.activeMs += +d.activeMs || 0;
    acc.idleMs   += +d.idleMs   || 0;
    acc.totalMs  += +d.totalMs  || 0;
    acc.daysActive++;
    // Mantém metadados mais recentes (caso user tenha mudado de setor mid-period)
    if (d.userName) acc.userName = d.userName;
    if (d.sector)   acc.sector   = d.sector;
  }

  // Computa derivados
  const results = [...byUser.values()].map(u => ({
    ...u,
    avgMsPerDay: u.daysActive > 0 ? Math.round(u.totalMs / u.daysActive) : 0,
    activePct:   u.totalMs > 0 ? Math.round(u.activeMs / u.totalMs * 100) : 0,
  }));
  results.sort((a, b) => b.totalMs - a.totalMs);
  return results;
}

/**
 * Resumo agregado do período (sem split por usuário).
 *
 * @param {Array} userBreakdown  — saída de fetchUsageByPeriod()
 * @returns {{ users:number, totalMs:number, activeMs:number, idleMs:number, totalH:number, activeH:number, idleH:number, avgMsPerUser:number, activePct:number }}
 */
export function summarizeUsage(userBreakdown) {
  const sum = (k) => (userBreakdown || []).reduce((s, u) => s + (u[k] || 0), 0);
  const totalMs  = sum('totalMs');
  const activeMs = sum('activeMs');
  const idleMs   = sum('idleMs');
  const users    = (userBreakdown || []).length;
  return {
    users,
    totalMs,  activeMs,  idleMs,
    totalH:   +(totalMs  / 3600000).toFixed(1),
    activeH:  +(activeMs / 3600000).toFixed(1),
    idleH:    +(idleMs   / 3600000).toFixed(1),
    avgMsPerUser: users > 0 ? Math.round(totalMs / users) : 0,
    activePct: totalMs > 0 ? Math.round(activeMs / totalMs * 100) : 0,
  };
}

/** Formata duração em ms pra string amigável: "12h 34min" / "45min" / "0min" */
export function formatDuration(ms) {
  if (!ms || ms <= 0) return '0min';
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}
