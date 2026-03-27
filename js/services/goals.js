/**
 * PRIMETOUR — Goals Service v2
 */
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  getDoc, getDocs, query, orderBy, serverTimestamp, where,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }       from '../firebase.js';
import { store }    from '../store.js';
import { auditLog } from '../auth/audit.js';

export const GOAL_SCOPES = [
  { value: 'individual', label: 'Individual',   icon: '◉' },
  { value: 'nucleo',     label: 'Núcleo',        icon: '◈' },
  { value: 'area',       label: 'Área / Setor',  icon: '◎' },
];

export const GOAL_PRAZO_TYPES = [
  { value: 'mensal',     label: 'Mensal'        },
  { value: 'bimestral',  label: 'Bimestral'     },
  { value: 'trimestral', label: 'Trimestral'    },
  { value: 'semestral',  label: 'Semestral'     },
  { value: 'anual',      label: 'Anual'         },
  { value: 'custom',     label: 'Personalizado' },
];

// Keep backward compat
export const GOAL_TYPES   = GOAL_SCOPES;
export const GOAL_PERIODS = GOAL_PRAZO_TYPES;

export function emptyGoal() {
  return {
    responsavelId:  store.get('currentUser')?.uid || null,
    gestorId:       null,
    escopo:         'individual',
    nucleo:         '',
    setor:          store.get('userSector') || '',
    objetivoNucleo: '',
    tipo:           '',
    tipoTarefa:     null,
    inicio:         '',
    fim:            '',
    status:         'rascunho',
    pilares:        [emptyPilar()],
  };
}

export function emptyPilar() {
  return { titulo: '', objetivo: '', ponderacao: 100, metas: [emptyMeta()] };
}

export function emptyMeta() {
  return {
    titulo: '', descricao: '', criterio: '',
    ponderacao: 100,
    prazoTipo: 'anual', prazoCustomInicio: '', prazoCustomFim: '',
    recorrencia: false,
    periodicidadeTipo: 'mensal', periodoCustom: '',
    recorrenciaAval: false,
    kpis: [emptyKpi()],
  };
}

export function emptyKpi() { return { descricao: '', peso: 100 }; }

export function validateGoalWeights(goal) {
  const w = [];
  const pilarSum = (goal.pilares||[]).reduce((s,p) => s+(Number(p.ponderacao)||0), 0);
  if (Math.abs(pilarSum-100) > 0.1) w.push(`Ponderação dos pilares soma ${pilarSum}% (deveria ser 100%)`);
  (goal.pilares||[]).forEach((pilar,pi) => {
    const ms = pilar.metas.reduce((s,m) => s+(Number(m.ponderacao)||0), 0);
    if (Math.abs(ms-100) > 0.1) w.push(`Pilar ${pi+1}: metas somam ${ms}%`);
    pilar.metas.forEach((meta,mi) => {
      const ks = meta.kpis.reduce((s,k) => s+(Number(k.peso)||0), 0);
      if (meta.kpis.length && Math.abs(ks-100) > 0.1) w.push(`Pilar ${pi+1}, Meta ${mi+1}: KPIs somam ${ks}%`);
    });
  });
  return w;
}

export function calcGoalProgress(goal, evaluations=[]) {
  const goalEvals = evaluations.filter(e => e.goalId === goal.id);
  if (!goalEvals.length) return { progress: 0, displayProgress: '0%', status: 'sem_avaliacao' };
  let totalPeso = 0, totalScore = 0;
  (goal.pilares||[]).forEach((pilar,pi) => {
    const pp = (Number(pilar.ponderacao)||0)/100;
    (pilar.metas||[]).forEach((meta,mi) => {
      const mp = (Number(meta.ponderacao)||0)/100;
      const ev = goalEvals.find(e => e.pillarIdx===pi && e.metaIdx===mi);
      if (!ev) return;
      let ms=0, pw=0;
      (meta.kpis||[]).forEach((kpi,ki) => {
        const sc = ev.kpiScores?.[ki]?.score ?? null;
        if (sc===null) return;
        const kp = (Number(kpi.peso)||0)/100;
        ms += sc*kp; pw += kp;
      });
      if (pw>0) { totalScore += pp*mp*(ms/pw); totalPeso += pp*mp; }
    });
  });
  const progress = totalPeso>0 ? Math.round((totalScore/totalPeso)*100)/100 : 0;
  return { progress, displayProgress: progress.toFixed(1)+'%', status: totalPeso<0.99?'parcial':'completa' };
}

export function getPendingPeriods(meta, existingEvals=[]) {
  if (!meta.recorrenciaAval) return [{ key:'unico', label:'Avaliação única' }];
  const start = new Date(meta.prazoCustomInicio || '');
  const end   = new Date(meta.prazoCustomFim   || '');
  if (isNaN(start)||isNaN(end)) return [];
  const periods=[]; const cur=new Date(start);
  const advance = d => {
    switch(meta.periodicidadeTipo) {
      case 'mensal':     d.setMonth(d.getMonth()+1); break;
      case 'bimestral':  d.setMonth(d.getMonth()+2); break;
      case 'trimestral': d.setMonth(d.getMonth()+3); break;
      case 'semestral':  d.setMonth(d.getMonth()+6); break;
      case 'anual':      d.setFullYear(d.getFullYear()+1); break;
      default: return false;
    }
    return true;
  };
  while(cur<=end && periods.length<60) {
    const key=cur.toISOString().slice(0,7);
    const label=cur.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
    if (!existingEvals.some(e=>e.periodoRef===key)) periods.push({key,label});
    if (!advance(cur)) break;
  }
  return periods;
}

export async function saveGoal(goalId, data) {
  const uid = store.get('currentUser')?.uid;
  if (goalId) {
    await updateDoc(doc(db,'goals',goalId),{...data,updatedAt:serverTimestamp(),updatedBy:uid});
    return goalId;
  }
  const ref = await addDoc(collection(db,'goals'),{...data,createdAt:serverTimestamp(),createdBy:uid,updatedAt:serverTimestamp()});
  await auditLog('goals.create','goal',ref.id,{});
  return ref.id;
}

export async function deleteGoal(goalId) {
  await deleteDoc(doc(db,'goals',goalId));
  await auditLog('goals.delete','goal',goalId,{});
}

export async function publishGoal(goalId) {
  await updateDoc(doc(db,'goals',goalId),{status:'publicada',publishedAt:serverTimestamp(),updatedAt:serverTimestamp()});
}

export async function fetchGoals() {
  const uid  = store.get('currentUser')?.uid;
  const snap = await getDocs(query(collection(db,'goals'),orderBy('createdAt','desc')));
  let goals  = snap.docs.map(d=>({id:d.id,...d.data()}));
  if (!store.can('system_view_all')) {
    goals = goals.filter(g =>
      g.responsavelId===uid || g.gestorId===uid ||
      g.setor===store.get('userSector')
    );
  }
  return goals.filter(g=>g.status!=='arquivada');
}

export async function fetchGoal(goalId) {
  const snap = await getDoc(doc(db,'goals',goalId));
  return snap.exists() ? {id:snap.id,...snap.data()} : null;
}

export async function saveEvaluation(evalId, data) {
  const uid = store.get('currentUser')?.uid;
  if (evalId) {
    await updateDoc(doc(db,'goal_evaluations',evalId),{...data,updatedAt:serverTimestamp(),updatedBy:uid});
    return evalId;
  }
  const ref = await addDoc(collection(db,'goal_evaluations'),{...data,createdAt:serverTimestamp(),createdBy:uid,updatedAt:serverTimestamp()});
  return ref.id;
}

export async function fetchEvaluations(goalId) {
  const snap = await getDocs(query(collection(db,'goal_evaluations'),where('goalId','==',goalId),orderBy('createdAt','desc')));
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}

export async function hasPublishedGoals() {
  const snap = await getDocs(query(collection(db,'goals'),where('status','==','publicada')));
  return !snap.empty;
}

// Legacy compat
export async function createGoal(data) { return saveGoal(null, data); }
export async function updateGoal(id, data) { return saveGoal(id, data); }
export function calcGoalProgressLegacy(goal, allTasks) {
  let relevant = allTasks.filter(t=>t.status==='done');
  if (goal.filterAssignees?.length) relevant=relevant.filter(t=>(t.assignees||[]).some(u=>goal.filterAssignees.includes(u)));
  const current=relevant.length;
  const progress=goal.target>0?Math.min(100,Math.round(current/goal.target*100)):0;
  return {current,progress};
}
export async function recalcGoalProgress(goalId, allTasks) {
  const snap=await getDoc(doc(db,'goals',goalId));
  if(!snap.exists())return;
  const goal={id:snap.id,...snap.data()};
  const {current,progress}=calcGoalProgressLegacy(goal,allTasks);
  await updateDoc(doc(db,'goals',goalId),{current,progress,updatedAt:serverTimestamp()});
  return {current,progress};
}
