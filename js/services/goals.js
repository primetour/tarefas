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
export const GOAL_SCOPES = [
  { value: 'individual', label: 'Individual', icon: '◉' },
  { value: 'nucleo',     label: 'Núcleo',     icon: '◈' },
  { value: 'area',       label: 'Área/Setor', icon: '◎' },
];

export const GOAL_PERIODS = [
  { value: 'monthly',    label: 'Mensal'               },
  { value: 'bimonthly',  label: 'Bimestral'            },
  { value: 'quarterly',  label: 'Trimestral'           },
  { value: 'semiannual', label: 'Semestral'            },
  { value: 'annual',     label: 'Anual'                },
  { value: 'custom',     label: 'Período personalizado'},
];

export const GOAL_TYPES = GOAL_SCOPES; // backward-compat alias

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
  await deleteDoc(doc(db, 'goals', id));
  await auditLog('goals.delete', 'goal', id, {});
}

export async function publishGoal(id) {
  await updateDoc(doc(db, 'goals', id), {
    status: 'publicada', publishedAt: serverTimestamp(), updatedBy: uid(),
  });
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
  await deleteDoc(doc(db, 'goal_evaluations', id));
}

/* ─── Cálculo de progresso ─────────────────────────────────── */
/**
 * Calcula o progresso de uma meta com base nas avaliações.
 * Modelo: uma avaliação por período, com kpiScores flat: [{pilarIdx, metaIdx, kpiIdx, score}]
 * Fórmula: Σ(score_kpi × peso_kpi / 100) × ponderacao_meta / 100 × ponderacao_pilar / 100
 * Retorna valor 0–100.
 */
export function calcGoalProgress(goal, evaluations = []) {
  if (!goal.pilares?.length || !evaluations.length) return 0;

  // Use the most recent evaluation (by createdAt)
  const latestEval = [...evaluations].sort((a, b) => {
    const ta = a.createdAt?.toDate?.() || (a.createdAt ? new Date(a.createdAt) : new Date(0));
    const tb = b.createdAt?.toDate?.() || (b.createdAt ? new Date(b.createdAt) : new Date(0));
    return tb - ta;
  })[0];

  if (!latestEval?.kpiScores?.length) return 0;

  // Build a lookup: "pIdx_mIdx_kIdx" → score
  const scoreLookup = {};
  for (const s of latestEval.kpiScores) {
    scoreLookup[`${s.pilarIdx}_${s.metaIdx}_${s.kpiIdx}`] = Number(s.score) || 0;
  }

  let totalProgress = 0;

  for (let pIdx = 0; pIdx < goal.pilares.length; pIdx++) {
    const pilar = goal.pilares[pIdx];
    if (!pilar.metas?.length) continue;
    const pilarWeight = Number(pilar.ponderacao) || 0;
    if (!pilarWeight) continue;

    let pilarScore = 0;

    for (let mIdx = 0; mIdx < pilar.metas.length; mIdx++) {
      const meta = pilar.metas[mIdx];
      const metaWeight = Number(meta.ponderacao) || 0;
      if (!metaWeight || !meta.kpis?.length) continue;

      // Score for this meta = Σ(score_kpi × peso_kpi / 100)
      let metaScore = 0;
      for (let kIdx = 0; kIdx < meta.kpis.length; kIdx++) {
        const kpi   = meta.kpis[kIdx];
        const score = scoreLookup[`${pIdx}_${mIdx}_${kIdx}`] ?? 0;
        metaScore  += (score * (Number(kpi.peso) || 0)) / 100;
      }

      pilarScore += (metaScore * metaWeight) / 100;
    }

    totalProgress += (pilarScore * pilarWeight) / 100;
  }

  return Math.round(Math.min(100, totalProgress));
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
