/**
 * PRIMETOUR — Dev Hours Service
 *
 * Sistema de horas de desenvolvimento. Cada entrada representa OU uma release
 * formal (granularidade fina, post-3.0.0) OU uma fase retrospectiva agregada
 * (1.x/2.x consolidados — sem prompts originais disponíveis).
 *
 * Metodologia:
 *  - Buckets de complexidade (trivial → epic) ancoram a estimativa base
 *  - Multiplicadores aplicam ajustes (migração de dados, PDF/export, etc.)
 *  - Decomposição em 5 categorias (refinamento, desenvolvimento, testes,
 *    documentação, implantação) totaliza o bucket ajustado
 *  - Custo = horas × hourly_rate (default R$ 150/h, configurable)
 *
 * NÃO É CRONOMETRAGEM. É **estimativa equivalente** (sr full-stack dev com
 * conhecimento do codebase). Sempre divulgar isso explicitamente em qualquer
 * UI/PDF que exponha valores.
 *
 * Workflow: draft → approved | rejected. Só 'approved' entra nos totais
 * exibidos por padrão (toggle na UI permite ver drafts).
 */

import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, orderBy, limit, where, serverTimestamp, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase.js';
import { store } from '../store.js';

/* ───────────────────────────────────────────────────────────────────
   Constantes públicas
   ─────────────────────────────────────────────────────────────────── */

export const DEFAULT_HOURLY_RATE = 150; // BRL

export const CATEGORIES = [
  { value: 'refinamento',     label: 'Refinamento',     color: '#8B5CF6', icon: '💭',
    desc: 'Discussão de requisitos, replanejamento, decisões de arquitetura.' },
  { value: 'desenvolvimento', label: 'Desenvolvimento', color: '#3B82F6', icon: '⚙',
    desc: 'Código novo, refactor, fix, migração.' },
  { value: 'testes',          label: 'Testes',          color: '#10B981', icon: '🧪',
    desc: 'Validação in-browser, JS console, verificação E2E em prod.' },
  { value: 'documentacao',    label: 'Documentação',    color: '#F59E0B', icon: '📝',
    desc: 'CHANGELOG, comentários inline, RULES-AND-AUTOMATIONS, helpPanel.' },
  { value: 'implantacao',     label: 'Implantação',     color: '#EF4444', icon: '🚀',
    desc: 'release.sh, commit, push, deploy, verificação em prod.' },
];

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.value, c]));

export const BUCKETS = [
  { value: 'trivial', label: 'Trivial',         range: '0.25–0.5h', min: 0.25, max: 0.5  },
  { value: 'small',   label: 'Pequeno',         range: '0.5–1.5h',  min: 0.5,  max: 1.5  },
  { value: 'medium',  label: 'Médio',           range: '1.5–4h',    min: 1.5,  max: 4    },
  { value: 'large',   label: 'Grande',          range: '4–8h',      min: 4,    max: 8    },
  { value: 'epic',    label: 'Épico',           range: '8–16h',     min: 8,    max: 16   },
  { value: 'mega',    label: 'Mega (1+ sprint)',range: '16–80h',    min: 16,   max: 80   },
];
export const BUCKET_MAP = Object.fromEntries(BUCKETS.map(b => [b.value, b]));

export const STATUSES = [
  { value: 'draft',    label: 'Rascunho',  color: '#6B7280', icon: '✎' },
  { value: 'approved', label: 'Aprovado',  color: '#10B981', icon: '✓' },
  { value: 'rejected', label: 'Rejeitado', color: '#EF4444', icon: '✗' },
];
export const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.value, s]));

export const ENTRY_TYPES = [
  { value: 'release', label: 'Release',           desc: 'Granularidade fina pós-3.0.0' },
  { value: 'phase',   label: 'Fase retroativa',   desc: 'Agregação 1.x/2.x sem prompts originais' },
];

export const DEFAULT_MULTIPLIERS = [
  { id: 'investigation', label: 'Investigação não-trivial',  value: 0.30 },
  { id: 'migration',     label: 'Migração de dados',          value: 0.20 },
  { id: 'pdf',           label: 'PDF/Export',                  value: 0.15 },
  { id: 'integration',   label: 'Integração externa',          value: 0.20 },
  { id: 'security',      label: 'Hardening de segurança',      value: 0.25 },
  { id: 'pure_refactor', label: 'Refactor puro (sem feature)', value: -0.20 },
];
export const MULTIPLIER_MAP = Object.fromEntries(DEFAULT_MULTIPLIERS.map(m => [m.id, m]));

const COLLECTION = 'dev_hours';

/* ───────────────────────────────────────────────────────────────────
   Cálculo — engine transparente
   ─────────────────────────────────────────────────────────────────── */

/**
 * Calcula horas estimadas a partir do bucket + multiplicadores.
 * Retorna número (decimal). Por padrão usa o ponto médio do range do bucket.
 *
 * @param {string} bucketValue
 * @param {string[]} multiplierIds
 * @param {number=} basePoint Override do ponto base (entre min e max do bucket).
 *                            Default = média (min+max)/2.
 */
export function calcHoursFromBucket(bucketValue, multiplierIds = [], basePoint = null) {
  const bucket = BUCKET_MAP[bucketValue];
  if (!bucket) return 0;

  const base = basePoint != null
    ? Math.max(bucket.min, Math.min(bucket.max, basePoint))
    : (bucket.min + bucket.max) / 2;

  let factor = 1;
  for (const id of multiplierIds || []) {
    const m = MULTIPLIER_MAP[id];
    if (m) factor += m.value;
  }
  // Floor em 0.25 (15 min) — abaixo disso não faz sentido cobrar
  return Math.max(0.25, +(base * factor).toFixed(2));
}

/** Custo = horas × rate. */
export function calcCost(hours, rate = DEFAULT_HOURLY_RATE) {
  return +(hours * rate).toFixed(2);
}

/**
 * Distribui automaticamente as horas totais nas 5 categorias usando
 * percentuais default por tipo de release. Útil pra "draft auto" inicial
 * no backfill — sempre revisável manualmente.
 */
export function suggestCategoryBreakdown(totalHours, profile = 'feature') {
  const profiles = {
    feature: { refinamento: 0.20, desenvolvimento: 0.50, testes: 0.10, documentacao: 0.15, implantacao: 0.05 },
    bugfix:  { refinamento: 0.30, desenvolvimento: 0.40, testes: 0.15, documentacao: 0.10, implantacao: 0.05 },
    docs:    { refinamento: 0.10, desenvolvimento: 0.05, testes: 0.05, documentacao: 0.75, implantacao: 0.05 },
    refactor:{ refinamento: 0.15, desenvolvimento: 0.65, testes: 0.10, documentacao: 0.05, implantacao: 0.05 },
    phase:   { refinamento: 0.15, desenvolvimento: 0.55, testes: 0.10, documentacao: 0.10, implantacao: 0.10 },
  };
  const ratios = profiles[profile] || profiles.feature;
  const out = {};
  let allocated = 0;
  for (const k of Object.keys(ratios)) {
    out[k] = +(totalHours * ratios[k]).toFixed(2);
    allocated += out[k];
  }
  // Pequeno ajuste pra fechar exatamente o total (corrige rounding)
  const diff = +(totalHours - allocated).toFixed(2);
  if (diff !== 0) out.desenvolvimento = +(out.desenvolvimento + diff).toFixed(2);
  return out;
}

/* ───────────────────────────────────────────────────────────────────
   CRUD
   ─────────────────────────────────────────────────────────────────── */

/** Subscribe real-time. Callback recebe array ordenado por completedAt desc. */
export function subscribeToDevHours(callback) {
  const q = query(collection(db, COLLECTION), orderBy('completedAt', 'desc'), limit(2000));
  return onSnapshot(q, (snap) => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(items);
  }, (err) => {
    console.warn('[devHours] subscribe error:', err.code, err.message);
    callback([]);
  });
}

/** One-shot fetch (pra backfill scripts e PDF export). */
export async function fetchDevHours() {
  const q = query(collection(db, COLLECTION), orderBy('completedAt', 'desc'), limit(2000));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Verifica se já existe entry com esse releaseVersion (evita duplicar no backfill). */
export async function findByVersion(version) {
  if (!version) return null;
  const q = query(collection(db, COLLECTION), where('releaseVersion', '==', version), limit(1));
  const snap = await getDocs(q);
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function createEntry(data) {
  const user = store.get('currentUser') || {};
  const payload = {
    // tipo
    entryType: data.entryType || 'release',     // 'release' | 'phase'
    // identificação
    releaseVersion: data.releaseVersion || null,
    releaseSlug:    data.releaseSlug    || null,
    phaseLabel:     data.phaseLabel     || null,
    title:          data.title          || '',
    summary:        data.summary        || '',
    // commits
    commits:           data.commits || [],
    phaseCommitsCount: data.phaseCommitsCount || null,
    filesChanged:      data.filesChanged || 0,
    linesAdded:        data.linesAdded || 0,
    linesRemoved:      data.linesRemoved || 0,
    // datas
    startedAt:   data.startedAt   || null,
    completedAt: data.completedAt || serverTimestamp(),
    // estimativa
    bucket:      data.bucket || 'medium',
    basePoint:   data.basePoint != null ? data.basePoint : null,
    multipliers: data.multipliers || [],
    totalHours:  data.totalHours || 0,
    hourlyRate:  data.hourlyRate || DEFAULT_HOURLY_RATE,
    totalCost:   data.totalCost  || 0,
    // categorias
    hoursByCategory: data.hoursByCategory || {
      refinamento: 0, desenvolvimento: 0, testes: 0, documentacao: 0, implantacao: 0,
    },
    // metodologia
    notes:           data.notes || '',
    confidenceLevel: data.confidenceLevel || 'medium', // high | medium | low
    profile:         data.profile || 'feature',        // pra suggestCategoryBreakdown
    // workflow
    status:     data.status || 'draft',
    approvedAt: null,
    approvedBy: null,
    rejectedAt: null,
    rejectedBy: null,
    // audit
    createdAt: serverTimestamp(),
    createdBy: user.uid || 'system',
    updatedAt: serverTimestamp(),
    updatedBy: user.uid || 'system',
  };
  const ref = await addDoc(collection(db, COLLECTION), payload);
  return ref.id;
}

export async function updateEntry(id, patch) {
  const user = store.get('currentUser') || {};
  const payload = { ...patch, updatedAt: serverTimestamp(), updatedBy: user.uid || 'system' };
  await updateDoc(doc(db, COLLECTION, id), payload);
}

export async function approveEntry(id) {
  const user = store.get('currentUser') || {};
  await updateDoc(doc(db, COLLECTION, id), {
    status: 'approved',
    approvedAt: serverTimestamp(),
    approvedBy: user.uid || 'system',
    updatedAt: serverTimestamp(),
    updatedBy: user.uid || 'system',
  });
}

export async function rejectEntry(id, reason = '') {
  const user = store.get('currentUser') || {};
  await updateDoc(doc(db, COLLECTION, id), {
    status: 'rejected',
    rejectedAt: serverTimestamp(),
    rejectedBy: user.uid || 'system',
    rejectReason: reason,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid || 'system',
  });
}

export async function reopenEntry(id) {
  const user = store.get('currentUser') || {};
  await updateDoc(doc(db, COLLECTION, id), {
    status: 'draft',
    approvedAt: null, approvedBy: null,
    rejectedAt: null, rejectedBy: null, rejectReason: null,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid || 'system',
  });
}

export async function deleteEntry(id) {
  await deleteDoc(doc(db, COLLECTION, id));
}

/* ───────────────────────────────────────────────────────────────────
   Aggregates / filtros
   ─────────────────────────────────────────────────────────────────── */

/** Soma horas e custo de uma lista de entries (já filtrada). */
export function sumEntries(entries) {
  let hours = 0;
  let cost  = 0;
  const byCategory = { refinamento: 0, desenvolvimento: 0, testes: 0, documentacao: 0, implantacao: 0 };
  for (const e of entries) {
    hours += +(e.totalHours || 0);
    cost  += +(e.totalCost  || 0);
    const hbc = e.hoursByCategory || {};
    for (const k of Object.keys(byCategory)) byCategory[k] += +(hbc[k] || 0);
  }
  return {
    hours: +hours.toFixed(2),
    cost:  +cost.toFixed(2),
    byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, +v.toFixed(2)])),
  };
}

/** Filtra entries por período (Date|null) e status array. */
export function filterEntries(entries, { from = null, to = null, statuses = null, types = null } = {}) {
  return entries.filter(e => {
    const dt = e.completedAt?.toDate ? e.completedAt.toDate() : (e.completedAt ? new Date(e.completedAt) : null);
    if (from && dt && dt < from) return false;
    if (to   && dt && dt > to)   return false;
    if (statuses && statuses.length && !statuses.includes(e.status)) return false;
    if (types    && types.length    && !types.includes(e.entryType)) return false;
    return true;
  });
}

/* ───────────────────────────────────────────────────────────────────
   Helpers de cálculo expostos pra UI (modal "Como cheguei")
   ─────────────────────────────────────────────────────────────────── */

/** Retorna explicação humano-legível da estimativa de uma entry. */
export function explainEntry(entry) {
  const bucket = BUCKET_MAP[entry.bucket] || BUCKET_MAP.medium;
  const baseRaw = entry.basePoint != null ? entry.basePoint : (bucket.min + bucket.max) / 2;
  const base = Math.max(bucket.min, Math.min(bucket.max, baseRaw));

  const mults = (entry.multipliers || []).map(id => MULTIPLIER_MAP[id]).filter(Boolean);
  let factor = 1;
  for (const m of mults) factor += m.value;
  const adjusted = +(base * factor).toFixed(2);

  return {
    bucketLabel: bucket.label,
    bucketRange: bucket.range,
    basePoint: base,
    bucketReason: entry.notes || '—',
    multipliers: mults.map(m => ({
      label: m.label,
      pct: m.value,
      pctLabel: `${m.value >= 0 ? '+' : ''}${(m.value * 100).toFixed(0)}%`,
    })),
    factor,
    adjustedHours: adjusted,
    storedHours: entry.totalHours,
    matches: Math.abs(adjusted - entry.totalHours) < 0.05,
    breakdown: entry.hoursByCategory || {},
    confidence: entry.confidenceLevel || 'medium',
    rate: entry.hourlyRate || DEFAULT_HOURLY_RATE,
    cost: entry.totalCost || 0,
  };
}
