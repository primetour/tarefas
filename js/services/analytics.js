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

  return {
    total, done: done.length, inProgress: inProgress.length,
    overdue: overdue.length, newTasks: newTasks.length,
    doneInPeriod: doneInPeriod.length,
    completionRate: total ? Math.round((done.length / total) * 100) : 0,
    avgCompletionDays: Math.round(avgTime * 10) / 10,
    activeProjects: projects.filter(p => p.status === 'active').length,
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

/* ─── Tarefas por membro ──────────────────────────────────── */
export function getTasksByMember(tasks) {
  const users = store.get('users') || [];
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
      const user = users.find(u => u.id === uid);
      return {
        uid, name: user?.name || uid, avatarColor: user?.avatarColor || '#6B7280',
        ...data,
        rate: data.total ? Math.round(data.done / data.total * 100) : 0,
      };
    })
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
