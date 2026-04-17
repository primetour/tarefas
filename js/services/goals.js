/**
 * PRIMETOUR — Goals Service v2
 * Metas por Pilares, Responsáveis e KPIs com Avaliação pelo Gestor
 */

import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  getDoc, getDocs, query, where, orderBy, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }       from '../firebase.js';
import { store }    from '../store.js';
import { auditLog } from '../auth/audit.js';

/* ─── Constantes ──────────────────────────────────────────── */
/**
 * Escopos de uma meta. Cada escopo tem uma hierarquização que controla
 * quais campos (Núcleo, Responsáveis, Setor) ficam visíveis/obrigatórios
 * no form — ver SCOPE_FIELD_RULES.
 */
export const GOAL_SCOPES = [
  { value: 'individual', label: 'Individual', icon: '◉' },
  { value: 'squad',      label: 'Squad',      icon: '◊' },
  { value: 'nucleo',     label: 'Núcleo',     icon: '◈' },
  { value: 'area',       label: 'Área/Setor', icon: '◎' },
  { value: 'global',     label: 'Global',     icon: '✦' },
];

/**
 * Regras por escopo: que campos mostrar no form e em qual modo.
 *   showNucleo       — exibe o select de Núcleo
 *   showResponsaveis — exibe o picker de Responsáveis
 *   respMode         — 'single' (obrigatório 1) | 'multi' (2+) | 'optional' (0+)
 *   hint             — ajuda contextual mostrada abaixo do escopo
 */
export const SCOPE_FIELD_RULES = {
  individual: {
    showNucleo: false, showResponsaveis: true,  respMode: 'single',
    hint: 'Meta atribuída a um único colaborador. Núcleo/Setor são herdados do responsável.',
  },
  squad: {
    showNucleo: true,  showResponsaveis: true,  respMode: 'multi',
    hint: 'Meta compartilhada por um grupo (2+ pessoas). Selecione os integrantes do squad.',
  },
  nucleo: {
    showNucleo: true,  showResponsaveis: true,  respMode: 'optional',
    hint: 'Meta do núcleo inteiro. Responsáveis são opcionais (líderes / pontos focais).',
  },
  area: {
    showNucleo: false, showResponsaveis: false, respMode: 'optional',
    hint: 'Meta da área/setor. Apenas o gestor precisa estar vinculado.',
  },
  global: {
    showNucleo: false, showResponsaveis: false, respMode: 'optional',
    hint: 'Meta corporativa (empresa toda). Apenas o gestor precisa estar vinculado.',
  },
};

export const GOAL_PERIODS = [
  { value: 'monthly',    label: 'Mensal'               },
  { value: 'bimonthly',  label: 'Bimestral'            },
  { value: 'quarterly',  label: 'Trimestral'           },
  { value: 'semiannual', label: 'Semestral'            },
  { value: 'annual',     label: 'Anual'                },
  { value: 'custom',     label: 'Período personalizado'},
];

export const GOAL_TYPES = GOAL_SCOPES; // backward-compat alias

export const GOAL_PRAZO_TYPES = [
  { value: 'monthly',    label: 'Mensal'               },
  { value: 'bimonthly',  label: 'Bimestral'            },
  { value: 'quarterly',  label: 'Trimestral'           },
  { value: 'semiannual', label: 'Semestral'            },
  { value: 'annual',     label: 'Anual'                },
  { value: 'custom',     label: 'Período personalizado'},
];

/* ─── Templates vazios ───────────────────────────────────── */
export function emptyKpi() {
  return { titulo: '', unidade: '', alvo: '', peso: 0 };
}

export function emptyMeta() {
  return {
    titulo: '', descricao: '', ponderacao: 0,
    criterio: '', formato: '', observacoes: '',
    prazoTipo: 'monthly', prazoCustomInicio: '', prazoCustomFim: '',
    periodicidadeTipo: 'monthly', recorrenciaAval: false,
    kpis: [emptyKpi()],
  };
}

export function emptyPilar() {
  return { titulo: '', ponderacao: 0, metas: [emptyMeta()] };
}

export function emptyGoal() {
  return {
    titulo: '', descricao: '', escopo: 'individual',
    responsavelIds: [], gestorId: '', nucleo: '',
    squadId: '', setor: '',
    inicio: '', fim: '',
    periodicidadeAval: 'monthly', recorrenciaAval: false,
    status: 'rascunho',
    pilares: [emptyPilar()],
  };
}

/**
 * Normaliza responsáveis de uma meta: aceita formato novo (`responsavelIds[]`)
 * ou legado (`responsavelId` string). Sempre retorna array de IDs.
 */
export function getResponsavelIds(goal = {}) {
  if (Array.isArray(goal.responsavelIds) && goal.responsavelIds.length) return goal.responsavelIds.filter(Boolean);
  if (goal.responsavelId) return [goal.responsavelId];
  return [];
}

/* ─── Validação de pesos ──────────────────────────────────── */
export function validateGoalWeights(goal) {
  const warnings = [];
  const pilares = goal.pilares || [];
  if (!pilares.length) return warnings;

  const pSum = pilares.reduce((s, p) => s + (Number(p.ponderacao) || 0), 0);
  if (pSum > 0 && Math.abs(pSum - 100) > 0.01) {
    warnings.push(`Ponderação dos pilares soma ${pSum}% (esperado 100%)`);
  }

  pilares.forEach((pilar, pi) => {
    const metas = pilar.metas || [];
    if (!metas.length) return;
    const mSum = metas.reduce((s, m) => s + (Number(m.ponderacao) || 0), 0);
    if (mSum > 0 && Math.abs(mSum - 100) > 0.01) {
      warnings.push(`Pilar "${pilar.titulo || pi + 1}": metas somam ${mSum}% (esperado 100%)`);
    }
    metas.forEach((meta, mi) => {
      const kpis = meta.kpis || [];
      if (!kpis.length) return;
      const kSum = kpis.reduce((s, k) => s + (Number(k.peso) || 0), 0);
      if (kSum > 0 && Math.abs(kSum - 100) > 0.01) {
        warnings.push(`Meta "${meta.titulo || mi + 1}": KPIs somam ${kSum}% (esperado 100%)`);
      }
    });
  });
  return warnings;
}

/* ─── Períodos pendentes de avaliação (por meta) ──────────── */
export function getPendingPeriods(meta, existingEvals = []) {
  const periods = [];
  const tipo = meta.prazoTipo || meta.periodicidadeTipo || 'monthly';
  const step = { monthly: 1, bimonthly: 2, quarterly: 3, semiannual: 6, annual: 12 }[tipo] || 1;

  const startStr = meta.prazoCustomInicio || meta.inicio;
  const endStr   = meta.prazoCustomFim    || meta.fim;
  const start = startStr ? new Date(startStr) : null;
  const end   = endStr   ? new Date(endStr)   : null;
  if (!start) return periods;

  const now = new Date();
  const addMonths = (d, n) => { const r = new Date(d); r.setMonth(r.getMonth() + n); return r; };
  const fmt = d => d.toLocaleDateString('pt-BR');
  const evalKeys = new Set((existingEvals || []).map(e => e.periodoRef));

  let cur = new Date(start);
  while (cur <= (end || now)) {
    const next = addMonths(cur, step);
    const pEnd = end && next > end ? end : new Date(next.getTime() - 1);
    const key  = `${cur.toISOString().slice(0,10)}_${pEnd.toISOString().slice(0,10)}`;
    if (!evalKeys.has(key)) {
      periods.push({ start: new Date(cur), end: pEnd, key, label: `${fmt(cur)} – ${fmt(pEnd)}` });
    }
    if (!meta.recorrenciaAval) break;
    cur = next;
    if (cur > now) break;
  }
  return periods;
}

/* ─── Helpers ─────────────────────────────────────────────── */
const uid = () => store.get('currentUser')?.uid;

/** Gera os períodos pendentes de avaliação com base na periodicidade e recorrência */
export function generatePendingPeriods(goal) {
  const periods = [];
  const start  = goal.inicio ? new Date(goal.inicio?.toDate?.() || goal.inicio) : null;
  const end    = goal.fim    ? new Date(goal.fim?.toDate?.()    || goal.fim)    : null;
  if (!start) return periods;

  const now   = new Date();
  const label = (s, e) => `${s.toLocaleDateString('pt-BR')} – ${e.toLocaleDateString('pt-BR')}`;
  const addMonths = (d, n) => { const r = new Date(d); r.setMonth(r.getMonth() + n); return r; };

  const step = {
    monthly:    1, bimonthly: 2, quarterly: 3, semiannual: 6, annual: 12,
  }[goal.periodicidadeAval] || 1;

  let cur = new Date(start);
  while (cur <= (end || now)) {
    const next = addMonths(cur, step);
    const pEnd = end && next > end ? end : new Date(next.getTime() - 1);
    periods.push({ start: new Date(cur), end: pEnd, label: label(cur, pEnd) });
    if (!goal.recorrenciaAval) break;
    cur = next;
    if (cur > now) break;
  }
  return periods;
}

/* ─── CRUD Metas ──────────────────────────────────────────── */
export async function fetchGoals() {
  const snap = await getDocs(query(collection(db, 'goals'), orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchGoal(id) {
  const snap = await getDoc(doc(db, 'goals', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveGoal(id, data) {
  if (!store.can('goals_manage')) throw new Error('Permissão negada.');
  const payload = {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
    ...(id ? {} : { createdAt: serverTimestamp(), createdBy: uid() }),
  };
  if (id) {
    await updateDoc(doc(db, 'goals', id), payload);
    await auditLog('goals.update', 'goal', id, { title: data.titulo });
    return id;
  } else {
    const ref = await addDoc(collection(db, 'goals'), payload);
    await auditLog('goals.create', 'goal', ref.id, { title: data.titulo });
    return ref.id;
  }
}

export async function deleteGoal(id) {
  if (!store.can('goals_manage')) throw new Error('Permissão negada.');
  await deleteDoc(doc(db, 'goals', id));
  await auditLog('goals.delete', 'goal', id, {});
}

export async function publishGoal(id) {
  await updateDoc(doc(db, 'goals', id), {
    status: 'publicada', publishedAt: serverTimestamp(), updatedBy: uid(),
  });

  // Notify responsável about published goal
  try {
    const snap = await getDoc(doc(db, 'goals', id));
    if (snap.exists()) {
      const goal = snap.data();
      const respIds = getResponsavelIds(goal);
      const recipients = [...respIds, goal.gestorId].filter(Boolean);
      if (recipients.length) {
        import('./notifications.js').then(({ notify }) => {
          notify('goal.published', {
            entityType: 'goal', entityId: id,
            recipientIds: recipients,
            title: 'Meta publicada',
            body: goal.titulo || 'Nova meta publicada',
            route: 'goals',
            category: 'goal',
          });
        }).catch(() => {});
      }
    }
  } catch { /* non-blocking */ }
}

/* ─── CRUD Avaliações ──────────────────────────────────────── */
export async function fetchEvaluations(goalId) {
  // No orderBy to avoid composite index requirement — sort client-side
  const snap = await getDocs(
    query(collection(db, 'goal_evaluations'),
      where('goalId', '==', goalId))
  );
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // Sort by createdAt descending (most recent first)
  return docs.sort((a, b) => {
    const ta = a.createdAt?.toDate?.() || (a.createdAt ? new Date(a.createdAt) : new Date(0));
    const tb = b.createdAt?.toDate?.() || (b.createdAt ? new Date(b.createdAt) : new Date(0));
    return tb - ta;
  });
}

export async function saveEvaluation(evalId, data) {
  if (!store.can('goals_evaluate')) throw new Error('Permissão negada.');
  const payload = {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
    ...(evalId ? {} : { createdAt: serverTimestamp(), createdBy: uid() }),
  };
  if (evalId) {
    await updateDoc(doc(db, 'goal_evaluations', evalId), payload);
    return evalId;
  } else {
    const ref = await addDoc(collection(db, 'goal_evaluations'), payload);
    return ref.id;
  }
}

export async function deleteEvaluation(id) {
  if (!store.can('goals_evaluate')) throw new Error('Permissão negada.');
  await deleteDoc(doc(db, 'goal_evaluations', id));
}

/* ─── Cálculo de progresso ─────────────────────────────────── */

/** Conta o total de períodos esperados baseado na configuração da meta */
export function countExpectedPeriods(goal) {
  const toDate = v => v?.toDate?.() || (v ? new Date(v) : null);
  const start  = toDate(goal.inicio);
  const end    = toDate(goal.fim);
  if (!start || !end || !goal.recorrenciaAval) return 1;

  const step = { monthly:1, bimonthly:2, quarterly:3, semiannual:6, annual:12 }[goal.periodicidadeAval] || 1;
  const addM = (d, n) => { const r = new Date(d); r.setMonth(r.getMonth() + n); return r; };

  let count = 0, cur = new Date(start);
  while (cur <= end) { count++; cur = addM(cur, step); }
  return Math.max(1, count);
}

/**
 * Calcula o score de uma avaliação individual (0–100).
 * Usa pesos dos KPIs/metas/pilares com fallback de distribuição igual se não preenchidos.
 */
export function calcEvalScore(goal, evaluation) {
  if (!evaluation?.kpiScores?.length || !goal.pilares?.length) return 0;

  const lookup = {};
  for (const s of evaluation.kpiScores) {
    if (s.score !== null && s.score !== undefined)
      lookup[s.pilarIdx + '_' + s.metaIdx + '_' + s.kpiIdx] = Number(s.score) || 0;
  }

  const pilares  = goal.pilares;
  const pWeights = pilares.map(p => Number(p.ponderacao) || 0);
  const pTotal   = pWeights.reduce((a, b) => a + b, 0);
  const pW       = pTotal > 0 ? pWeights : pilares.map(() => 100 / pilares.length);

  let total = 0;
  for (let pIdx = 0; pIdx < pilares.length; pIdx++) {
    const metas    = pilares[pIdx].metas || [];
    if (!metas.length) continue;
    const mWeights = metas.map(m => Number(m.ponderacao) || 0);
    const mTotal   = mWeights.reduce((a, b) => a + b, 0);
    const mW       = mTotal > 0 ? mWeights : metas.map(() => 100 / metas.length);
    let ps = 0;
    for (let mIdx = 0; mIdx < metas.length; mIdx++) {
      const kpis    = metas[mIdx].kpis || [];
      if (!kpis.length) continue;
      const kWeights = kpis.map(k => Number(k.peso) || 0);
      const kTotal   = kWeights.reduce((a, b) => a + b, 0);
      const kW       = kTotal > 0 ? kWeights : kpis.map(() => 100 / kpis.length);
      let ms = 0;
      for (let kIdx = 0; kIdx < kpis.length; kIdx++) {
        ms += ((lookup[pIdx + '_' + mIdx + '_' + kIdx] ?? 0) * kW[kIdx]) / 100;
      }
      ps += (ms * mW[mIdx]) / 100;
    }
    total += (ps * pW[pIdx]) / 100;
  }
  return Math.round(Math.min(100, total));
}

/**
 * Progresso acumulado da meta = Σ(score de cada período avaliado) / total períodos esperados
 */
export function calcGoalProgress(goal, evaluations = []) {
  if (!goal.pilares?.length || !evaluations.length) return 0;
  const totalPeriods = countExpectedPeriods(goal);
  const sumScores = evaluations.reduce((sum, ev) => sum + calcEvalScore(goal, ev), 0);
  return Math.round(Math.min(100, sumScores / totalPeriods));
}

/** Verifica se há metas publicadas no sistema (para double-check de tarefa) */
export async function hasPublishedGoals() {
  try {
    const snap = await getDocs(query(collection(db, 'goals'), where('status', '==', 'publicada')));
    return !snap.empty;
  } catch { return false; }
}

// backward-compat export used by old goals.js page
export async function createGoal(data) { return saveGoal(null, data); }
export async function updateGoal(id, data) { return saveGoal(id, data); }
export { GOAL_PERIODS as GOAL_PERIOD_OPTS };
