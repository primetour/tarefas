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

/**
 * 4.40.28+ MÓDULOS DE PRODUTO
 *
 * Classificação opcional de entries por módulo do produto pra dashboards
 * focados (Portal de Dicas / Banco de Imagens / Gerador de Cotações).
 *
 * Entradas podem ser taggeadas explicitamente via campo `modules: string[]`,
 * mas como a maioria das entries antigas não tem isso, oferecemos também
 * detecção heurística via título/slug/summary — vide `detectEntryModules()`.
 *
 * Esses 3 módulos têm tracking dedicado porque são a frente de produto
 * (cliente-facing/operacional) que o user usa pra reportar avanços executivos.
 * Refactors internos / hardening / outros features ficam no track "Geral".
 */
export const MODULES = [
  { id: 'roteiros', label: 'Gerador de Cotações', color: '#D4A843', icon: '🗺',
    desc: 'Produção de cotações personalizadas (cliente + viajantes + dias + serviços + materiais).' },
  { id: 'portal',   label: 'Portal de Dicas',     color: '#8B5CF6', icon: '💡',
    desc: 'Catálogo editorial de destinos, áreas e dicas reutilizáveis em materiais.' },
  { id: 'images',   label: 'Banco de Imagens',    color: '#3B82F6', icon: '🖼',
    desc: 'Biblioteca categorizada (Hotel, Restaurante, Destino, Trem, etc.) usada em roteiros e portal.' },
  // 4.40.32+ IA Hub entra como 4º módulo da iniciativa de produto.
  // Cobre tudo de plataforma de IA: agents, skills, prompts, multi-provider,
  // governança e cost tracking.
  { id: 'iahub',    label: 'IA Hub',              color: '#10B981', icon: '🤖',
    desc: 'Plataforma de IA (agents, skills, multi-provider, governança e cost tracking).' },
  // v4.50.11+ Banco de Roteiros: curadoria PRIMETOUR (Classic Collection, etc.)
  // que alimenta a IA do gerador. Distinto de "Gerador de Cotações" (cotação
  // de cliente). Inclui import PDF via Anthropic multimodal.
  { id: 'banco-roteiros', label: 'Banco de Roteiros', color: '#0EA5E9', icon: '📚',
    desc: 'Curadoria de roteiros prontos (Classic Collection, etc.) — referência manual + base de conhecimento da IA.' },
];
export const MODULE_MAP = Object.fromEntries(MODULES.map(m => [m.id, m]));

// Padrões pra detecção heurística — somente quando entry não tem `modules`.
// 4.40.28+ INTENCIONALMENTE só miram TÍTULO + SLUG + PHASE LABEL.
// NÃO passamos `summary` pelo regex pq summaries têm muito vocabulário
// genérico ("image", "roteiro" como substring em outros contextos)
// → false positives gritantes (ex: "IA Hub vision" virava "Banco de Imagens").
// Título + slug são curados pelo dev e refletem do que a entry É sobre.
const MODULE_PATTERNS = {
  // \b...s?\b cobre "roteiro" / "roteiros" (sem o `s?` o boundary
  // não fecha quando vem o 's' no plural).
  roteiros: /\b(roteiros?|itinerar|gerador[-_ ]?de[-_ ]?roteiros?)\b/i,
  // Portal de DICAS especificamente (não confundir com "Portal de Solicitações")
  portal:   /\b(portal[-_ ]?de[-_ ]?dicas?|portal[-_ ]?tips?|portal-?tips?)\b/i,
  // Banco de Imagens — pattern restrito pra não pegar "image" genérico em IA Hub
  images:   /\b(banco[-_ ]?de[-_ ]?imagens?|image[-_ ]?bank|portalimages|imagens?[-_ ]?(restaurante|destino|trem|hotel|bank|sticky|categoria)?)\b/i,
  // 4.40.32+ IA Hub — cobre IA Hub, AI Hub, ai-hub, iahub, aihub. NÃO casa
  // mentions soltas de "IA" / "AI" (muito genéricas, gerariam false positive).
  iahub:    /\b((?:ia|ai)[-_ ]?hub|iahub|aihub)\b/i,
  // v4.50.11+ Banco de Roteiros — cobre "banco-roteiros", "banco de roteiros",
  // "roteiro-bank", "roteiroBank". MUITO específico pra não conflitar com
  // "roteiros" (que pertence ao Gerador). Detecta primeiro (ordem dos hits
  // não importa porque retornamos todos os matches; ambos podem aplicar se
  // entry realmente tocar os 2 módulos).
  'banco-roteiros': /\b(banco[-_ ]?de[-_ ]?roteiros?|banco[-_ ]?roteiros?|roteiros?[-_ ]?bank|roteiroBank)\b/i,
};

/**
 * Retorna lista de módulos que uma entry tocou.
 *
 * Ordem de precedência:
 *   1. Campo `modules` PRESENTE (mesmo se array vazio) → respeita literalmente.
 *      Permite admin marcar entry como "explicitamente NÃO é trabalho de
 *      produto" via `modules: []` (ex: phase legacy com palavra "Portal"
 *      que na verdade era "Portal de Solicitações" e não "Portal de Dicas").
 *   2. Sem campo `modules` → fallback pra heurística em
 *      title + slug + phaseLabel (NÃO em summary pra evitar false positives).
 */
export function detectEntryModules(entry) {
  // 4.40.30+ Honra `modules` PRESENTE — array vazio = exclusão explícita.
  // (Antes: array vazio caía na heurística, gerando false positives ao
  // tentar excluir entries.)
  if (Array.isArray(entry.modules)) {
    return entry.modules.filter(m => MODULE_MAP[m]);
  }
  const hay = [
    entry.title || '',
    entry.releaseSlug || '',
    entry.phaseLabel || '',
  ].join(' ');
  const hits = [];
  for (const [id, pat] of Object.entries(MODULE_PATTERNS)) {
    if (pat.test(hay)) hits.push(id);
  }
  return hits;
}

/** True se a entry toca algum dos módulos listados (default: todos). */
export function entryMatchesModules(entry, moduleIds = null) {
  const detected = detectEntryModules(entry);
  if (!moduleIds || !moduleIds.length) return detected.length > 0;
  return detected.some(m => moduleIds.includes(m));
}

/** Agrega entries por módulo. Útil pro breakdown card. */
export function aggregateByModule(entries) {
  const acc = {};
  for (const m of MODULES) {
    acc[m.id] = { hours: 0, cost: 0, count: 0, lastDate: null };
  }
  for (const e of entries) {
    const mods = detectEntryModules(e);
    if (!mods.length) continue;
    // Quando entry toca N módulos, divide o crédito (evita inflar totais)
    const share = 1 / mods.length;
    const dt = e.completedAt?.toDate ? e.completedAt.toDate()
             : e.completedAt ? new Date(e.completedAt)
             : null;
    for (const id of mods) {
      const slot = acc[id];
      if (!slot) continue;
      slot.hours += +(e.totalHours || 0) * share;
      slot.cost  += +(e.totalCost  || 0) * share;
      slot.count += share;
      if (dt && (!slot.lastDate || dt > slot.lastDate)) slot.lastDate = dt;
    }
  }
  // Round pra display
  for (const id of Object.keys(acc)) {
    acc[id].hours = +acc[id].hours.toFixed(2);
    acc[id].cost  = +acc[id].cost.toFixed(2);
    acc[id].count = +acc[id].count.toFixed(1);
  }
  return acc;
}

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
 * 4.34.10+ Fator de assistência IA aplicado ao tempo estimado humano puro.
 *
 * Tempo humano puro × AI_ASSISTANCE_MULTIPLIER = tempo equivalente do
 * dev sênior trabalhando ASSISTIDO POR IA (modelo "human-in-the-loop").
 *
 * Calibragem em 0.50 (~2× speedup) — recalibrada em 4.35.0 a partir do
 * 0.40 anterior, alinhada à observação interna real (95 dias de projeto
 * vs estimativa pura humana de ~190 dias). 0.50 reflete melhor o ritmo
 * sustentado, levando em conta:
 *   - Tempo de revisão/decisão/integração que IA não acelera
 *   - Sessões de design/discovery (não é só coding)
 *   - Iteração com user (feedback loops humanos)
 *
 * Referência: documento de horas de desenvolvimento (95 dias × 8h = 760h).
 *
 * Aplicado em createEntry: salvamos humanEquivalentHours (puro) +
 * totalHours (× multiplier). Display público usa totalHours.
 */
export const AI_ASSISTANCE_MULTIPLIER = 0.50;

/**
 * Calcula horas estimadas a partir do bucket + multiplicadores.
 * Retorna o **tempo humano puro** (sem o ajuste de IA — esse é
 * aplicado no createEntry).
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

/**
 * Aplica o fator de assistência IA. humanHours × 0.50.
 * Floor em 0.1 (6min) pra entradas muito pequenas.
 */
export function applyAiAssistance(humanHours) {
  return Math.max(0.1, +(humanHours * AI_ASSISTANCE_MULTIPLIER).toFixed(2));
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
  // 4.34.10+ Aplica fator AI-assistance se data.totalHours veio como tempo
  // humano puro (sem o ajuste). Detectamos pela ausência de humanEquivalentHours
  // no payload — se o caller já calculou, respeita.
  const humanHrs = data.humanEquivalentHours != null
    ? data.humanEquivalentHours
    : (data.totalHours || 0);
  const adjustedHrs = data.humanEquivalentHours != null
    ? (data.totalHours || 0)
    : applyAiAssistance(humanHrs);
  const adjustedCost = +(adjustedHrs * (data.hourlyRate || DEFAULT_HOURLY_RATE)).toFixed(2);

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
    // estimativa — 4.34.10+ guardamos AMBOS os valores pra rastreabilidade.
    bucket:      data.bucket || 'medium',
    basePoint:   data.basePoint != null ? data.basePoint : null,
    multipliers: data.multipliers || [],
    humanEquivalentHours: humanHrs,             // tempo dev solo (referência)
    aiAssistanceMultiplier: AI_ASSISTANCE_MULTIPLIER, // fator aplicado
    totalHours:  adjustedHrs,                    // tempo ajustado (display)
    hourlyRate:  data.hourlyRate || DEFAULT_HOURLY_RATE,
    totalCost:   adjustedCost,
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
