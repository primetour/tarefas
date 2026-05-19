/**
 * PRIMETOUR — Analytics Service
 * Agregação de dados para dashboards e relatórios
 */

import { fetchTasks }    from './tasks.js';
import { fetchProjects } from './projects.js';
import {
  collection, query, where, orderBy,
  getDocs, limit, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';

/* ─── Helpers de data ────────────────────────────────────── */
export function startOfDay(date) {
  const d = new Date(date); d.setHours(0,0,0,0); return d;
}
export function endOfDay(date) {
  const d = new Date(date); d.setHours(23,59,59,999); return d;
}
export function subDays(date, n) {
  const d = new Date(date); d.setDate(d.getDate() - n); return d;
}
export function formatDayLabel(date) {
  return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit'}).format(date);
}
export function formatMonthLabel(date) {
  return new Intl.DateTimeFormat('pt-BR',{month:'short',year:'2-digit'}).format(date);
}

/* ─── Calcular período ────────────────────────────────────── */
export function getPeriodDates(period) {
  const now = new Date();
  if (String(period).startsWith('custom:')) {
    const [, from, to] = period.split(':');
    return { start: new Date(from + 'T00:00:00'), end: new Date(to + 'T23:59:59') };
  }
  switch (period) {
    case '7d':  return { start: subDays(now, 6),  end: now };
    case '30d': return { start: subDays(now, 29), end: now };
    case '90d': return { start: subDays(now, 89), end: now };
    case '12m': return { start: subDays(now, 364),end: now };
    default:    return { start: subDays(now, 29), end: now };
  }
}

/* ─── Métricas gerais ─────────────────────────────────────── */
export async function getOverviewMetrics(period = '30d') {
  const { start } = getPeriodDates(period);
  const [tasks, projects] = await Promise.all([fetchTasks(), fetchProjects()]);

  const total      = tasks.length;
  const done       = tasks.filter(t => t.status === 'done');
  const inProgress = tasks.filter(t => t.status === 'in_progress');
  const overdue    = tasks.filter(t => {
    if (!t.dueDate || t.status === 'done') return false;
    const d = t.dueDate?.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
    return d < new Date();
  });
  const newTasks = tasks.filter(t => {
    if (!t.createdAt) return false;
    const d = t.createdAt?.toDate ? t.createdAt.toDate() : new Date(t.createdAt);
    return d >= start;
  });
  const doneInPeriod = done.filter(t => {
    if (!t.completedAt) return false;
    const d = t.completedAt?.toDate ? t.completedAt.toDate() : new Date(t.completedAt);
    return d >= start;
  });

  // Avg completion time (days)
  const avgTime = doneInPeriod.filter(t => t.createdAt && t.completedAt).reduce((acc, t) => {
    const created   = t.createdAt?.toDate   ? t.createdAt.toDate()   : new Date(t.createdAt);
    const completed = t.completedAt?.toDate ? t.completedAt.toDate() : new Date(t.completedAt);
    return acc + (completed - created) / (1000*60*60*24);
  }, 0) / (doneInPeriod.filter(t => t.createdAt && t.completedAt).length || 1);

  // Taxa de conclusão no prazo: tarefas done com completedAt <= dueDate
  const doneOnTime = done.filter(t => {
    if (!t.dueDate || !t.completedAt) return false;
    const due       = t.dueDate?.toDate       ? t.dueDate.toDate()       : new Date(t.dueDate);
    const completed = t.completedAt?.toDate   ? t.completedAt.toDate()   : new Date(t.completedAt);
    return completed <= due;
  });
  const onTimeRate = done.length
    ? Math.round((doneOnTime.length / done.length) * 100)
    : 0;

  return {
    total, done: done.length, inProgress: inProgress.length,
    overdue: overdue.length, newTasks: newTasks.length,
    doneInPeriod: doneInPeriod.length,
    completionRate: total ? Math.round((done.length / total) * 100) : 0,
    onTimeRate,
    doneOnTime: doneOnTime.length,
    avgCompletionDays: Math.round(avgTime * 10) / 10,
    activeProjects: projects.filter(p => p.status === 'active' || p.status === 'always_on').length,
    tasks, projects,
  };
}

/* ─── Tarefas por dia (burndown/velocity) ─────────────────── */
export function getTasksByDay(tasks, period = '30d', type = 'created') {
  const { start, end } = getPeriodDates(period);
  const days = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
    days.push(new Date(d));
  }

  return days.map(day => {
    const dayStart = startOfDay(day).getTime();
    const dayEnd   = endOfDay(day).getTime();
    const count = tasks.filter(t => {
      const ts = type === 'created'   ? t.createdAt   :
                 type === 'completed' ? t.completedAt : t.updatedAt;
      if (!ts) return false;
      const d = ts?.toDate ? ts.toDate() : new Date(ts);
      return d.getTime() >= dayStart && d.getTime() <= dayEnd;
    }).length;
    return { label: formatDayLabel(day), value: count, date: day };
  });
}

/* ─── Distribuição por status ─────────────────────────────── */
export function getStatusDistribution(tasks) {
  const STATUSES = [
    { value:'todo',        label:'A Fazer',      color:'#38BDF8' },
    { value:'in_progress', label:'Em Andamento', color:'#F59E0B' },
    { value:'review',      label:'Em Revisão',   color:'#A78BFA' },
    { value:'done',        label:'Concluída',    color:'#22C55E' },
    { value:'backlog',     label:'Backlog',      color:'#6B7280' },
    { value:'cancelled',   label:'Cancelada',    color:'#EF4444' },
  ];
  return STATUSES.map(s => ({
    ...s,
    count: tasks.filter(t => t.status === s.value).length,
  })).filter(s => s.count > 0);
}

/* ─── Distribuição por prioridade ─────────────────────────── */
export function getPriorityDistribution(tasks) {
  const PRIORITIES = [
    { value:'urgent', label:'Urgente', color:'#EF4444' },
    { value:'high',   label:'Alta',    color:'#F97316' },
    { value:'medium', label:'Média',   color:'#F59E0B' },
    { value:'low',    label:'Baixa',   color:'#6B7280' },
  ];
  return PRIORITIES.map(p => ({
    ...p,
    count: tasks.filter(t => t.priority === p.value).length,
  })).filter(p => p.count > 0);
}

/* ─── Tarefas por membro ──────────────────────────────────────
 * 4.49.18+ Bug fix: usuários `pendingSso: true` (pré-cadastrados que ainda
 * não fizeram primeiro login SSO) ou inativos (`active === false`) NÃO
 * aparecem no ranking. Antes, todo uid que estivesse em algum t.assignees[]
 * virava entry — incluía até stub de pré-cadastro, poluindo o ranking.
 *
 * Tasks atribuídas a uids "fantasma" (user não existe no store, ou pendente,
 * ou inativo) caem num bucket "_orphan" que pode ser exposto via toggle
 * caso o gestor queira limpar. Por padrão essas entries são silenciadas. */
export function getTasksByMember(tasks, { includeOrphans = false } = {}) {
  const users = store.get('users') || [];
  // Index por uid pra lookup O(1)
  const userById = new Map(users.map(u => [u.id, u]));
  const byMember = {};
  tasks.forEach(t => {
    (t.assignees || []).forEach(uid => {
      if (!byMember[uid]) byMember[uid] = { total: 0, done: 0 };
      byMember[uid].total++;
      if (t.status === 'done') byMember[uid].done++;
    });
  });
  return Object.entries(byMember)
    .map(([uid, data]) => {
      const user = userById.get(uid);
      const isPending  = user?.pendingSso === true;
      const isInactive = user?.active === false;
      const isOrphan   = !user || isPending || isInactive;
      return {
        uid,
        id: uid,                                    // 4.34.8+ pra helper userAvatar reconhecer como user
        name: user?.name || uid,
        avatarColor: user?.avatarColor || '#6B7280',
        photoURL: user?.photoURL || null,           // 4.34.8+ pra ranking mostrar foto SSO
        _isPending:  isPending,
        _isInactive: isInactive,
        _isOrphan:   isOrphan,
        ...data,
        rate: data.total ? Math.round(data.done / data.total * 100) : 0,
      };
    })
    .filter(m => includeOrphans || !m._isOrphan)
    .sort((a, b) => b.done - a.done);
}

/* ─── Tarefas por projeto ─────────────────────────────────── */
export function getTasksByProject(tasks, projects) {
  return projects.map(p => {
    const pt   = tasks.filter(t => t.projectId === p.id);
    const done = pt.filter(t => t.status === 'done').length;
    return {
      id: p.id, name: p.name, icon: p.icon, color: p.color,
      total: pt.length, done,
      rate: pt.length ? Math.round(done / pt.length * 100) : 0,
    };
  }).filter(p => p.total > 0).sort((a, b) => b.total - a.total);
}

/* ─── Velocity (tarefas concluídas por semana) ────────────── */
export function getWeeklyVelocity(tasks, weeks = 12) {
  const now = new Date();
  const result = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const weekEnd   = new Date(now);
    weekEnd.setDate(weekEnd.getDate() - i * 7);
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0,0,0,0);
    weekEnd.setHours(23,59,59,999);

    const done = tasks.filter(t => {
      if (!t.completedAt) return false;
      const d = t.completedAt?.toDate ? t.completedAt.toDate() : new Date(t.completedAt);
      return d >= weekStart && d <= weekEnd;
    }).length;
    const created = tasks.filter(t => {
      if (!t.createdAt) return false;
      const d = t.createdAt?.toDate ? t.createdAt.toDate() : new Date(t.createdAt);
      return d >= weekStart && d <= weekEnd;
    }).length;

    result.push({
      label: `${weekStart.getDate().toString().padStart(2,'0')}/${(weekStart.getMonth()+1).toString().padStart(2,'0')}`,
      done, created,
    });
  }
  return result;
}

/* ─── Tempo médio por tarefa por tipo ──────────────────────
 * 4.32+ Usa typeId (não mais o campo legado t.type) e resolveTypeName,
 * casando com o ranking por tipo. Tipos órfãos viram "Outros tipos". */
export function getTimePerTaskByType(tasks) {
  const groups = {};
  tasks.forEach(t => {
    if (t.status !== 'done' || !t.createdAt || !t.completedAt) return;
    const typeId = t.typeId || t.type || '__none__';
    const created   = t.createdAt?.toDate   ? t.createdAt.toDate()   : new Date(t.createdAt);
    const completed = t.completedAt?.toDate ? t.completedAt.toDate() : new Date(t.completedAt);
    const days = (completed - created) / (1000 * 60 * 60 * 24);
    if (!groups[typeId]) groups[typeId] = { total: 0, count: 0 };
    groups[typeId].total += days;
    groups[typeId].count += 1;
  });
  // Resolve nome amigável e merge dos órfãos em "Outros tipos"
  const resolved = Object.entries(groups)
    .filter(([, g]) => g.count > 0)
    .map(([typeId, g]) => {
      const r = resolveTypeName(typeId);
      return { typeId, label: r.name, icon: r.icon, color: r.color, total: g.total, count: g.count };
    });
  const merged = {};
  resolved.forEach(r => {
    const k = r.label.toLowerCase();
    if (!merged[k]) merged[k] = { ...r, total: 0, count: 0 };
    merged[k].total += r.total;
    merged[k].count += r.count;
  });
  return Object.values(merged)
    .map(m => ({
      type: m.typeId,
      label: m.label,
      icon: m.icon,
      color: m.color,
      avgDays: Math.round((m.total / m.count) * 10) / 10,
      count: m.count,
    }))
    .sort((a, b) => b.count - a.count);
}

/* ─── 4.32+ Resolver typeId pra nome amigável ─────────────
 * Cobre 3 casos (igual contentCalendar):
 *   1. Doc Firestore em store.get('taskTypes')
 *   2. Valor legacy estático ('newsletter' → 'Newsletter')
 *   3. Genérico se não encontrar (em vez de mostrar ID cifrado)
 */
const STATIC_FALLBACKS = {
  newsletter: { name: 'Newsletter', icon: '📧', color: '#D4A843' },
};

function resolveTypeName(typeId) {
  if (!typeId || typeId === '__none__') {
    return { name: 'Sem tipo', icon: '◇', color: '#6B7280' };
  }
  const dyn = store.get('taskTypes') || [];
  const fromDoc = dyn.find(t => t.id === typeId);
  if (fromDoc) {
    return {
      name: fromDoc.name || 'Tipo',
      icon: fromDoc.icon || '◇',
      color: fromDoc.color || '#6B7280',
    };
  }
  if (STATIC_FALLBACKS[typeId]) return STATIC_FALLBACKS[typeId];
  // Match case-insensitive em nomes dinâmicos (defensivo)
  const fuzzy = dyn.find(t =>
    String(t.name || '').toLowerCase() === String(typeId).toLowerCase()
  );
  if (fuzzy) return { name: fuzzy.name, icon: fuzzy.icon || '◇', color: fuzzy.color || '#6B7280' };
  // Fallback final: genérico em vez de ID cifrado
  return { name: 'Outros tipos', icon: '◇', color: '#94A3B8' };
}

/* ─── Ranking de produtividade por tipo de tarefa ─────────
 * Agrupa por taskTypeId (campo `typeId` na task), calcula concluídas,
 * total, taxa, e VOLUME DE PARCERIAS (isPartnership=true).
 *
 * 4.49.18+ Bug fix de divergência com o filtro "Sem tipo" em #tasks:
 * antes usava `t.typeId || '__none__'`, ignorando o campo legacy `t.type`
 * (string "newsletter"/"relatorio"/…). Tarefas com t.type preenchido mas
 * sem typeId caíam no bucket "Sem tipo" — inflando essa contagem e
 * mostrando contagens diferentes nas 2 views.
 *
 * Agora usa `t.typeId || t.type || '__none__'` — mesmo critério do
 * getTimePerTaskByType acima. Só conta como "Sem tipo" quando AMBOS estão
 * vazios, igual ao filtro __NONE__ de tasks.js (`!t.typeId && !t.type`). */
export function getProductivityByType(tasks) {
  const byType = {};
  tasks.forEach(t => {
    const typeId = t.typeId || t.type || '__none__';
    if (!byType[typeId]) byType[typeId] = { total: 0, done: 0, partnerships: 0 };
    byType[typeId].total++;
    if (t.status === 'done') byType[typeId].done++;
    if (t.isPartnership)     byType[typeId].partnerships++;
  });
  // 4.32+ Agrega "Outros tipos" pra evitar lista poluída de tipos órfãos
  // (typeIds legacy sem doc nem fallback estático)
  const resolved = Object.entries(byType).map(([typeId, data]) => {
    const r = resolveTypeName(typeId);
    return {
      typeId, ...r, ...data,
      rate: data.total ? Math.round(data.done / data.total * 100) : 0,
      partnershipRate: data.total ? Math.round(data.partnerships / data.total * 100) : 0,
    };
  });
  // Merge das entries com mesmo "name" (casos onde 2+ typeIds órfãos viram "Outros tipos")
  const merged = {};
  resolved.forEach(r => {
    const k = r.name.toLowerCase();
    if (!merged[k]) merged[k] = { ...r, total: 0, done: 0, partnerships: 0, _ids: [] };
    merged[k].total += r.total;
    merged[k].done  += r.done;
    merged[k].partnerships += r.partnerships;
    merged[k]._ids.push(r.typeId);
  });
  return Object.values(merged)
    .map(m => ({
      ...m,
      rate: m.total ? Math.round(m.done / m.total * 100) : 0,
      partnershipRate: m.total ? Math.round(m.partnerships / m.total * 100) : 0,
    }))
    .filter(t => t.total > 0)
    .sort((a, b) => b.done - a.done);
}

/* ─── Heatmap de atividade (365 dias) ────────────────────── */
export function getActivityHeatmap(tasks) {
  const map = {};
  tasks.forEach(t => {
    const dates = [];
    if (t.createdAt)   dates.push(t.createdAt);
    if (t.completedAt) dates.push(t.completedAt);
    if (t.updatedAt)   dates.push(t.updatedAt);
    dates.forEach(ts => {
      if (!ts) return;
      const d    = ts?.toDate ? ts.toDate() : new Date(ts);
      const key  = d.toISOString().slice(0, 10);
      map[key]   = (map[key] || 0) + 1;
    });
  });
  return map;
}

/* ─── Tarefas vencendo em breve ───────────────────────────── */
export function getUpcomingDeadlines(tasks, days = 7) {
  const now    = new Date();
  const future = new Date(); future.setDate(future.getDate() + days);
  return tasks
    .filter(t => {
      if (!t.dueDate || t.status === 'done') return false;
      const d = t.dueDate?.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
      return d >= now && d <= future;
    })
    .sort((a, b) => {
      const da = a.dueDate?.toDate ? a.dueDate.toDate() : new Date(a.dueDate);
      const db = b.dueDate?.toDate ? b.dueDate.toDate() : new Date(b.dueDate);
      return da - db;
    });
}

/* ─── CSAT geral ──────────────────────────────────────────── */
export function getCsatGeneral(surveys) {
  const responded = surveys.filter(s => s.status === 'responded' && s.score);
  const total     = surveys.length;
  const sent      = surveys.filter(s => ['sent','responded'].includes(s.status)).length;
  if (!responded.length) return { avg: 0, total, sent, responded: 0, responseRate: 0 };
  const avg = responded.reduce((a,s) => a + s.score, 0) / responded.length;
  return {
    avg:          Math.round(avg * 10) / 10,
    total, sent,
    responded:    responded.length,
    responseRate: sent ? Math.round((responded.length / sent) * 100) : 0,
  };
}

/* ─── CSAT por área ───────────────────────────────────────── */
export function getCsatByArea(surveys, tasks) {
  // Map taskId → requestingArea from tasks
  const taskAreaMap = {};
  tasks.forEach(t => { if (t.requestingArea) taskAreaMap[t.id] = t.requestingArea; });

  const groups = {};
  surveys.forEach(s => {
    const area = taskAreaMap[s.taskId] || s.requestingArea || null;
    if (!area) return;
    if (!groups[area]) groups[area] = { area, scores: [], total: 0 };
    groups[area].total++;
    if (s.status === 'responded' && s.score) groups[area].scores.push(s.score);
  });

  return Object.values(groups)
    .map(g => ({
      area:         g.area,
      total:        g.total,
      responded:    g.scores.length,
      responseRate: g.total ? Math.round((g.scores.length / g.total) * 100) : 0,
      avg:          g.scores.length
        ? Math.round(g.scores.reduce((a,b)=>a+b,0) / g.scores.length * 10) / 10
        : null,
    }))
    .sort((a,b) => (b.avg||0) - (a.avg||0));
}

/* ─── Performance por núcleo ──────────────────────────────── */
export function getPerformanceByNucleo(tasks) {
  const NUCLEOS_LIST = [
    { value:'design',        label:'Design'        },
    { value:'comunicacao',   label:'Comunicação'   },
    { value:'redes_sociais', label:'Redes Sociais' },
    { value:'dados',         label:'Dados'         },
    { value:'web',           label:'Web'           },
    { value:'sistemas',      label:'Sistemas'      },
    { value:'ia',            label:'IA'            },
  ];
  const COLORS = ['#D4A843','#38BDF8','#22C55E','#A78BFA','#F97316','#EC4899','#06B6D4'];

  return NUCLEOS_LIST.map((n, i) => {
    const related = tasks.filter(t => (t.nucleos||[]).includes(n.value));
    const done    = related.filter(t => t.status === 'done').length;
    const total   = related.length;
    return {
      nucleo:  n.value,
      label:   n.label,
      color:   COLORS[i],
      total,
      done,
      rate:    total ? Math.round((done / total) * 100) : 0,
    };
  }).filter(n => n.total > 0);
}

/* ─── % sem retrabalho ────────────────────────────────────── */
export function getReworkRate(tasks) {
  const done        = tasks.filter(t => t.status === 'done');
  const withRework  = done.filter(t => t.hadRework === true);
  // Also count tasks that passed through 'rework' status via audit (approximate via status history)
  const reworkTasks = tasks.filter(t => t.status === 'rework').length;
  const total       = done.length;
  if (!total) return { total: 0, withRework: 0, withoutRework: 0, noReworkRate: 0, reworkRate: 0 };
  const noRework    = total - withRework.length;
  return {
    total,
    withRework:   withRework.length,
    withoutRework: noRework,
    noReworkRate:  Math.round((noRework / total) * 100),
    reworkRate:    Math.round((withRework.length / total) * 100),
    inRework:      reworkTasks,
  };
}

/* ─── Newsletters fora do calendário ─────────────────────── */
export function getNewslettersOutOfCalendar(tasks, period = null) {
  // 4.32+ Aceita tanto legacy t.type quanto t.typeId. Resolve typeId via store
  // pra cobrir caso onde o doc do tipo tenha id arbitrário mas nome "Newsletter".
  const dyn = store.get('taskTypes') || [];
  const newsletterIds = new Set(['newsletter']);
  dyn.forEach(t => {
    if (String(t.name || '').toLowerCase() === 'newsletter') newsletterIds.add(t.id);
  });
  let newsletters = tasks.filter(t =>
    t.type === 'newsletter' || (t.typeId && newsletterIds.has(t.typeId))
  );
  if (period) {
    const { start } = getPeriodDates(period);
    newsletters = newsletters.filter(t => {
      if (!t.createdAt) return false;
      const d = t.createdAt?.toDate ? t.createdAt.toDate() : new Date(t.createdAt);
      return d >= start;
    });
  }
  const outOfCalendar = newsletters.filter(t => t.outOfCalendar === true);
  const total         = newsletters.length;
  return {
    total,
    outOfCalendar:    outOfCalendar.length,
    inCalendar:       total - outOfCalendar.length,
    outOfCalendarPct: total ? Math.round((outOfCalendar.length / total) * 100) : 0,
    items:            outOfCalendar,
  };
}
