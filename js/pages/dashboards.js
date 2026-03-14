/**
 * PRIMETOUR — Dashboards Page (Etapa 3)
 * Analytics completo com Chart.js
 */

import { store }    from '../store.js';
import { toast }    from '../components/toast.js';
import { openTaskModal } from '../components/taskModal.js';
import {
  getOverviewMetrics, getTasksByDay, getStatusDistribution,
  getPriorityDistribution, getTasksByMember, getTasksByProject,
  getWeeklyVelocity, getActivityHeatmap, getUpcomingDeadlines,
  getTimePerTaskByType, getPeriodDates,
  getCsatGeneral, getCsatByArea, getPerformanceByNucleo,
  getReworkRate, getNewslettersOutOfCalendar,
} from '../services/analytics.js';
import { fetchSurveys } from '../services/csat.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ─── State ──────────────────────────────────────────────── */
let currentPeriod = '30d';
let chartInstances = {};
let metrics = null;

/* ─── Chart.js loader ────────────────────────────────────── */
async function loadChartJS() {
  if (window.Chart) return window.Chart;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
    s.onload  = () => resolve(window.Chart);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/* ─── Render shell ────────────────────────────────────────── */
export async function renderDashboards(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Dashboards</h1>
        <p class="page-subtitle">Métricas e análises do time</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-secondary btn-sm" id="dash-export-btn">↓ Exportar Relatório</button>
        <button class="btn btn-primary" id="dash-new-task">+ Nova Tarefa</button>
      </div>
    </div>

    <!-- Period selector -->
    <div class="dashboard-toolbar">
      <span class="dashboard-toolbar-title"></span>
      <div class="date-range-bar">
        ${['7d','30d','90d','12m'].map(p => `
          <button class="date-range-btn ${p===currentPeriod?'active':''}" data-period="${p}">
            ${{
              '7d':  'Últimos 7 dias',
              '30d': 'Últimos 30 dias',
              '90d': 'Últimos 90 dias',
              '12m': '12 meses',
            }[p]}
          </button>
        `).join('')}
      </div>
    </div>

    <!-- Skeleton KPIs -->
    <div class="dashboard-grid" id="kpi-row">
      ${[0,1,2,3,4].map(()=>`
        <div class="dash-widget col-span-${5>4?'12':'3'} skeleton" style="min-height:110px;grid-column:span 2;"></div>
      `).join('')}
    </div>

    <!-- Charts grid -->
    <div class="dashboard-grid" id="charts-grid">
      <div class="dash-widget col-span-8" style="min-height:300px;">
        <div class="chart-loading"><div class="chart-loading-spinner"></div>Carregando gráficos...</div>
      </div>
      <div class="dash-widget col-span-4" style="min-height:300px;">
        <div class="chart-loading"><div class="chart-loading-spinner"></div></div>
      </div>
      <div class="dash-widget col-span-4" style="min-height:260px;">
        <div class="chart-loading"><div class="chart-loading-spinner"></div></div>
      </div>
      <div class="dash-widget col-span-4" style="min-height:260px;">
        <div class="chart-loading"><div class="chart-loading-spinner"></div></div>
      </div>
      <div class="dash-widget col-span-4" style="min-height:260px;">
        <div class="chart-loading"><div class="chart-loading-spinner"></div></div>
      </div>
    </div>

    <!-- Bottom row -->
    <div class="dashboard-grid" id="bottom-grid">
      <div class="dash-widget col-span-6" style="min-height:280px;">
        <div class="chart-loading"><div class="chart-loading-spinner"></div></div>
      </div>
      <div class="dash-widget col-span-6" style="min-height:280px;">
        <div class="chart-loading"><div class="chart-loading-spinner"></div></div>
      </div>
    </div>

    <!-- Heatmap -->
    <div class="dash-widget" id="heatmap-widget" style="margin-bottom:24px; min-height:120px;">
      <div class="chart-loading"><div class="chart-loading-spinner"></div></div>
    </div>

    <!-- Round 3 widgets -->
    <div class="dashboard-grid" id="r3-grid-top" style="margin-bottom:24px;">
      <div class="dash-widget col-span-4" id="r3-csat-general" style="min-height:200px;">
        <div class="chart-loading"><div class="chart-loading-spinner"></div></div>
      </div>
      <div class="dash-widget col-span-4" id="r3-rework" style="min-height:200px;">
        <div class="chart-loading"><div class="chart-loading-spinner"></div></div>
      </div>
      <div class="dash-widget col-span-4" id="r3-newsletters" style="min-height:200px;">
        <div class="chart-loading"><div class="chart-loading-spinner"></div></div>
      </div>
    </div>
    <div class="dashboard-grid" id="r3-grid-bottom">
      <div class="dash-widget col-span-6" id="r3-csat-area" style="min-height:280px;">
        <div class="chart-loading"><div class="chart-loading-spinner"></div></div>
      </div>
      <div class="dash-widget col-span-6" id="r3-nucleo" style="min-height:280px;">
        <div class="chart-loading"><div class="chart-loading-spinner"></div></div>
      </div>
    </div>
  `;

  // Period buttons
  document.querySelectorAll('.date-range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentPeriod = btn.dataset.period;
      document.querySelectorAll('.date-range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      destroyCharts();
      loadData(container);
    });
  });

  document.getElementById('dash-new-task')?.addEventListener('click', () =>
    openTaskModal({ onSave: () => loadData(container) })
  );
  document.getElementById('dash-export-btn')?.addEventListener('click', () => exportReport());

  await loadData(container);
}

/* ─── Load & render all charts ────────────────────────────── */
async function loadData(container) {
  try {
    const [Chart, m, surveys] = await Promise.all([
      loadChartJS(),
      getOverviewMetrics(currentPeriod),
      fetchSurveys({ limitN: 500 }).catch(() => []),
    ]);
    metrics = m;
    metrics.surveys = surveys;
    renderKPIs(m);
    renderAllCharts(Chart, m);
  } catch(e) {
    console.error('Dashboard error:', e);
    toast.error('Erro ao carregar dados do dashboard.');
  }
}

/* ─── KPIs ────────────────────────────────────────────────── */
function renderKPIs(m) {
  document.getElementById('kpi-row').innerHTML = `
    ${kpiCard('Total de Tarefas',    m.total,                   '📋', 'rgba(212,168,67,0.12)',  'var(--brand-gold)')}
    ${kpiCard('Em Andamento',        m.inProgress,              '▶',  'rgba(56,189,248,0.12)',  '#38BDF8')}
    ${kpiCard('Concluídas (período)',m.doneInPeriod,             '✓',  'rgba(34,197,94,0.12)',   '#22C55E')}
    ${kpiCard('Em Atraso',           m.overdue,                 '⚠',  'rgba(239,68,68,0.12)',   '#EF4444')}
    ${kpiCard('Entregues no Prazo',  m.onTimeRate + '%',        '🎯', 'rgba(167,139,250,0.12)', '#A78BFA',
      `${m.doneOnTime} de ${m.done} concluídas`)}
  `;
  // Animate bars
  setTimeout(() => {
    document.querySelectorAll('.kpi-bar-fill').forEach(el => {
      el.style.width = el.dataset.pct + '%';
    });
  }, 80);
}

function kpiCard(label, value, icon, ibg, ic, sub = '') {
  const pct = typeof value === 'string' ? parseInt(value) : Math.min(100, Math.round(value / 20 * 100));
  return `
    <div class="dash-widget col-span-3" style="min-height:unset;">
      <div class="kpi-widget">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
          <div class="widget-icon" style="background:${ibg}; color:${ic};">${icon}</div>
          <span class="kpi-label" style="margin:0;">${label}</span>
        </div>
        <div class="kpi-value">${value}</div>
        ${sub ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">${sub}</div>` : ''}
        <div class="kpi-bar" style="margin-top:auto;">
          <div class="kpi-bar-fill" data-pct="${pct}"
            style="width:0%; background:${ic}; transition: width 1s ease;"></div>
        </div>
      </div>
    </div>
  `;
}

/* ─── Empty state helper ──────────────────────────────────── */
function emptyWidget(gridId, id, colClass, title, height = 200) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  const existing = document.getElementById(id);
  if (existing) existing.remove();
  const wrap = document.createElement('div');
  wrap.className = `dash-widget ${colClass}`;
  wrap.id = id;
  wrap.style.minHeight = height + 'px';
  wrap.innerHTML = `
    <div class="widget-header"><div class="widget-title">${title}</div></div>
    <div class="widget-body" style="display:flex;align-items:center;justify-content:center;height:${height}px;">
      <div style="text-align:center;color:var(--text-muted);">
        <div style="font-size:2rem;margin-bottom:8px;opacity:0.3;">📊</div>
        <div style="font-size:0.8125rem;">Sem dados no período selecionado</div>
      </div>
    </div>`;
  grid.appendChild(wrap);
  return wrap;
}

/* ─── All Charts ──────────────────────────────────────────── */
function renderAllCharts(Chart, m) {
  const { tasks, projects } = m;

  // Chart defaults
  Chart.defaults.color = '#94A3B8';
  Chart.defaults.font.family = 'Outfit, sans-serif';
  Chart.defaults.font.size = 11;

  const gridColor = 'rgba(255,255,255,0.05)';

  /* 1a — Criadas vs Concluídas por semana (line, 8-col) */
  const velocity = getWeeklyVelocity(tasks, 12);
  const hasVelocity = velocity.some(v => v.done > 0 || v.created > 0);
  if (hasVelocity) {
    renderLineChart(Chart, 'charts-grid', 'velocity-chart', 'col-span-8', {
      title: '📈 Criadas vs Concluídas',
      subtitle: 'Tarefas criadas vs concluídas por semana',
      labels:   velocity.map(v => v.label),
      datasets: [
        { label: 'Concluídas', data: velocity.map(v => v.done),    borderColor: '#22C55E', backgroundColor: 'rgba(34,197,94,0.10)' },
        { label: 'Criadas',    data: velocity.map(v => v.created), borderColor: '#38BDF8', backgroundColor: 'rgba(56,189,248,0.08)', borderDash: [4,4] },
      ],
      gridColor, height: 260,
    });
  } else {
    emptyWidget('charts-grid', 'velocity-chart', 'col-span-8', '📈 Criadas vs Concluídas', 260);
  }

  /* 1b — Tempo médio por tarefa por tipo (4-col) */
  const timeByType = getTimePerTaskByType(tasks);
  renderTimeByTypeChart(Chart, 'charts-grid', 'time-type-chart', 'col-span-4', timeByType);

  /* 2 — Status donut (4-col) */
  const statusDist = getStatusDistribution(tasks).filter(s => s.count > 0);
  if (statusDist.length) {
    const statusTotal = statusDist.reduce((a,s)=>a+s.count,0) || 1;
    renderDonutChart(Chart, 'charts-grid', 'status-donut', 'col-span-4', {
      title:  '◎ Status das Tarefas',
      labels: statusDist.map(s => `${s.label} (${Math.round(s.count/statusTotal*100)}%)`),
      data:   statusDist.map(s => s.count),
      colors: statusDist.map(s => s.color),
      height: 260,
    });
  } else {
    emptyWidget('charts-grid', 'status-donut', 'col-span-4', '◎ Status das Tarefas', 260);
  }

  /* 3 — Priority donut (4-col) */
  const prioDist = getPriorityDistribution(tasks).filter(p => p.count > 0);
  if (prioDist.length) {
    const prioTotal = prioDist.reduce((a,p)=>a+p.count,0) || 1;
    renderDonutChart(Chart, 'charts-grid', 'priority-donut', 'col-span-4', {
      title:  '▲ Prioridade das Tarefas',
      labels: prioDist.map(p => `${p.label} (${Math.round(p.count/prioTotal*100)}%)`),
      data:   prioDist.map(p => p.count),
      colors: prioDist.map(p => p.color),
      height: 200,
    });
  } else {
    emptyWidget('charts-grid', 'priority-donut', 'col-span-4', '▲ Prioridade das Tarefas', 200);
  }

  /* 4 — Daily bar (4-col) */
  const createdByDay   = getTasksByDay(tasks, currentPeriod, 'created');
  const completedByDay = getTasksByDay(tasks, currentPeriod, 'completed');
  const stride = currentPeriod === '90d' ? 6 : currentPeriod === '12m' ? 14 : currentPeriod === '7d' ? 1 : 3;
  const filtLabels  = createdByDay.filter((_,i)=>i%stride===0).map(d=>d.label);
  const filtCreated = createdByDay.filter((_,i)=>i%stride===0).map(d=>d.value);
  const filtDone    = completedByDay.filter((_,i)=>i%stride===0).map(d=>d.value);
  const hasDaily    = filtCreated.some(v=>v>0) || filtDone.some(v=>v>0);

  if (hasDaily) {
    renderBarChart(Chart, 'charts-grid', 'daily-chart', 'col-span-4', {
      title:  '📊 Criadas vs Concluídas (período)',
      labels: filtLabels,
      datasets: [
        { label: 'Criadas',    data: filtCreated, backgroundColor: 'rgba(56,189,248,0.65)' },
        { label: 'Concluídas', data: filtDone,    backgroundColor: 'rgba(34,197,94,0.65)'  },
      ],
      gridColor, height: 200,
    });
  } else {
    emptyWidget('charts-grid', 'daily-chart', 'col-span-4', '📊 Criadas vs Concluídas', 200);
  }

  /* 5 — Projects progress bar (4-col) */
  const byProject = getTasksByProject(tasks, projects);
  if (byProject.length) {
    renderHorizontalBarChart(Chart, 'charts-grid', 'projects-chart', 'col-span-4', {
      title:  '📦 Progresso por Projeto',
      labels: byProject.slice(0,6).map(p => `${p.icon} ${p.name}`),
      data:   byProject.slice(0,6).map(p => p.rate),
      colors: byProject.slice(0,6).map(p => p.color || '#D4A843'),
      height: 200,
    });
  } else {
    emptyWidget('charts-grid', 'projects-chart', 'col-span-4', '📦 Progresso por Projeto', 200);
  }

  /* 6 — Member leaderboard (6-col) */
  const byMember = getTasksByMember(tasks);
  renderLeaderboard('bottom-grid', 'member-board', 'col-span-6', {
    title: '🏆 Ranking da Equipe',
    subtitle: 'Por tarefas concluídas no período',
    items: byMember.slice(0, 8),
  });

  /* 7 — Upcoming deadlines (6-col) */
  renderUpcoming('bottom-grid', 'upcoming-widget', 'col-span-6', tasks);

  /* 8 — Activity heatmap */
  renderHeatmap('heatmap-widget', tasks);

  /* R3 — New widgets */
  const surveys = m.surveys || [];
  renderCsatGeneral(tasks, surveys);
  renderReworkWidget(tasks);
  renderNewslettersWidget(tasks);
  renderCsatByAreaWidget(tasks, surveys, Chart);
  renderNucleoWidget(tasks, Chart);
}

/* ─── Line chart ─────────────────────────────────────────── */
function renderLineChart(Chart, gridId, id, colClass, opts) {
  const widget = createWidget(gridId, id, colClass, opts.title, opts.subtitle, opts.height || 260);
  const canvas = widget.querySelector('canvas');
  if (!canvas) return;
  chartInstances[id] = new Chart(canvas, {
    type: 'line',
    data: { labels: opts.labels, datasets: opts.datasets.map(d => ({
      ...d, fill: true, tension: 0.4,
      pointRadius: 3, pointHoverRadius: 5,
    })) },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top', labels: { boxWidth: 10, padding: 16 } }, tooltip: tooltipStyle() },
      scales: {
        x: { grid: { color: opts.gridColor }, ticks: { maxTicksLimit: 10 } },
        y: { grid: { color: opts.gridColor }, beginAtZero: true, ticks: { stepSize: 1 } },
      },
    },
  });
}

/* ─── Bar chart ──────────────────────────────────────────── */
function renderBarChart(Chart, gridId, id, colClass, opts) {
  const widget = createWidget(gridId, id, colClass, opts.title, '', opts.height || 200);
  const canvas = widget.querySelector('canvas');
  if (!canvas) return;
  chartInstances[id] = new Chart(canvas, {
    type: 'bar',
    data: { labels: opts.labels, datasets: opts.datasets.map(d => ({
      ...d, borderRadius: 4, borderSkipped: false,
    })) },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top', labels: { boxWidth: 10, padding: 12 } }, tooltip: tooltipStyle() },
      scales: {
        x: { grid: { color: opts.gridColor }, stacked: false },
        y: { grid: { color: opts.gridColor }, beginAtZero: true, ticks: { stepSize: 1 } },
      },
    },
  });
}

/* ─── Horizontal bar ─────────────────────────────────────── */
function renderHorizontalBarChart(Chart, gridId, id, colClass, opts) {
  const widget = createWidget(gridId, id, colClass, opts.title, '', opts.height || 200);
  const canvas = widget.querySelector('canvas');
  if (!canvas) return;
  chartInstances[id] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: opts.labels,
      datasets: [{ label: 'Progresso %', data: opts.data, backgroundColor: opts.colors, borderRadius: 4 }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: tooltipStyle() },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, min: 0, max: 100,
             ticks: { callback: v => v + '%' } },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
}

/* ─── Donut chart ────────────────────────────────────────── */
function renderDonutChart(Chart, gridId, id, colClass, opts) {
  const widget = createWidget(gridId, id, colClass, opts.title, '', opts.height || 220);
  const canvas = widget.querySelector('canvas');
  if (!canvas) return;
  chartInstances[id] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: opts.labels,
      datasets: [{ data: opts.data, backgroundColor: opts.colors.map(c=>c+'CC'),
        borderColor: opts.colors, borderWidth: 1.5, hoverOffset: 6 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 10, padding: 12, font: { size: 11 } } },
        tooltip: {
          ...tooltipStyle(),
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((a,b)=>a+b,0) || 1;
              const pct   = Math.round(ctx.parsed / total * 100);
              return ` ${ctx.label.split(' (')[0]}: ${ctx.parsed} (${pct}%)`;
            }
          }
        },
      },
    },
  });
}

/* ─── Leaderboard widget ─────────────────────────────────── */
function renderLeaderboard(gridId, id, colClass, opts) {
  const grid  = document.getElementById(gridId);
  if (!grid) return;
  const wrap = document.createElement('div');
  wrap.className = `dash-widget ${colClass}`;
  wrap.id = id;
  grid.appendChild(wrap);
  const rankLabels = ['', '🥇','🥈','🥉'];

  wrap.innerHTML = `
    <div class="widget-header">
      <div class="widget-title">${opts.title}</div>
      ${opts.subtitle ? `<span style="font-size:0.75rem;color:var(--text-muted);">${opts.subtitle}</span>` : ''}
    </div>
    <div class="widget-body" style="padding:0 18px;">
      ${opts.items.length === 0
        ? `<div class="empty-state" style="padding:24px;"><div class="empty-state-icon">🏆</div>
            <div class="empty-state-title">Nenhum dado disponível</div></div>`
        : opts.items.map((u, i) => `
          <div class="leaderboard-item">
            <div class="leaderboard-rank ${i<3?['gold','silver','bronze'][i]:''}">
              ${i < 3 ? rankLabels[i+1] : i+1}
            </div>
            <div class="avatar avatar-sm" style="background:${u.avatarColor}; flex-shrink:0;">
              ${(u.name||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()}
            </div>
            <div class="leaderboard-info">
              <div class="leaderboard-name">${esc(u.name)}</div>
              <div class="leaderboard-sub">${u.total} tarefa${u.total!==1?'s':''}  · ${u.rate}% concluída${u.rate!==1?'s':''}</div>
            </div>
            <div class="leaderboard-value" style="color:var(--color-success);">${u.done}</div>
          </div>
        `).join('')
      }
    </div>
  `;
}

/* ─── Upcoming deadlines widget ──────────────────────────── */
function renderUpcoming(gridId, id, colClass, tasks) {
  const upcoming = getUpcomingDeadlines(tasks, 7);
  const grid = document.getElementById(gridId);
  if (!grid) return;
  const wrap = document.createElement('div');
  wrap.className = `dash-widget ${colClass}`;
  wrap.id = id;
  grid.appendChild(wrap);

  const { PRIORITY_MAP } = { PRIORITY_MAP: {
    urgent:{label:'Urgente',color:'#EF4444'}, high:{label:'Alta',color:'#F97316'},
    medium:{label:'Média',color:'#F59E0B'},   low:{label:'Baixa',color:'#6B7280'},
  }};

  wrap.innerHTML = `
    <div class="widget-header">
      <div class="widget-title">⏰ Prazos Próximos (7 dias)</div>
      <span class="badge ${upcoming.length>0?'badge-warning':'badge-neutral'}">${upcoming.length}</span>
    </div>
    <div class="widget-body" style="padding:0 18px; overflow-y:auto; max-height:220px;">
      ${upcoming.length === 0
        ? `<div class="empty-state" style="padding:24px;"><div class="empty-state-icon">🎉</div>
            <div class="empty-state-title">Nenhum prazo nos próximos 7 dias!</div></div>`
        : upcoming.map(t => {
            const d    = t.dueDate?.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
            const diff = Math.ceil((d - new Date()) / (1000*60*60*24));
            const prio = PRIORITY_MAP[t.priority] || { color: '#6B7280' };
            return `<div class="leaderboard-item upcoming-task" data-tid="${t.id}" style="cursor:pointer;">
              <div class="priority-dot" style="background:${prio.color}; width:8px; height:8px; border-radius:50%; flex-shrink:0;"></div>
              <div class="leaderboard-info">
                <div class="leaderboard-name">${esc(t.title)}</div>
                <div class="leaderboard-sub">
                  ${new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit'}).format(d)}
                </div>
              </div>
              <span class="badge ${diff<=1?'badge-danger':diff<=3?'badge-warning':'badge-neutral'}" style="font-size:0.6875rem; flex-shrink:0;">
                ${diff===0?'Hoje':diff===1?'Amanhã':diff+'d'}
              </span>
            </div>`;
          }).join('')
      }
    </div>
  `;

  // Open task modal on click
  wrap.querySelectorAll('.upcoming-task[data-tid]').forEach(el => {
    el.addEventListener('click', async () => {
      const { fetchTasks } = await import('../services/tasks.js');
      const all = await fetchTasks().catch(()=>[]);
      const task = all.find(t=>t.id===el.dataset.tid);
      if (task) openTaskModal({ taskData: task, onSave: () => {} });
    });
  });
}

/* ─── Heatmap ─────────────────────────────────────────────── */
function renderHeatmap(widgetId, tasks) {
  const widget = document.getElementById(widgetId);
  if (!widget) return;
  const map  = getActivityHeatmap(tasks);
  const max  = Math.max(1, ...Object.values(map));
  const days = [];
  const now  = new Date();
  for (let i = 364; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ key, d, count: map[key] || 0 });
  }

  // Pad to start on Sunday
  const firstDay = days[0].d.getDay();
  const padding  = Array(firstDay).fill(null);

  widget.innerHTML = `
    <div class="widget-header">
      <div class="widget-title">🔥 Atividade — últimos 12 meses</div>
      <div style="display:flex;align-items:center;gap:6px;font-size:0.75rem;color:var(--text-muted);">
        Menos
        ${[0,1,2,3,4].map(l=>`<div style="width:12px;height:12px;border-radius:2px;background:${
          l===0?'var(--bg-elevated)':
          l===1?'rgba(212,168,67,0.20)':
          l===2?'rgba(212,168,67,0.40)':
          l===3?'rgba(212,168,67,0.65)':'rgba(212,168,67,0.90)'
        };"></div>`).join('')}
        Mais
      </div>
    </div>
    <div class="widget-body" style="overflow-x:auto; padding:12px 18px;">
      <div style="display:flex; gap:3px; align-items:flex-start;">
        ${[...padding, ...days].map(day => {
          if (!day) return `<div style="width:12px;height:12px;opacity:0;"></div>`;
          const level = day.count === 0 ? 0 : day.count < max*0.25 ? 1 : day.count < max*0.5 ? 2 : day.count < max*0.75 ? 3 : 4;
          const fmt = new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}).format(day.d);
          return `<div class="heatmap-cell heatmap-${level}" title="${fmt}: ${day.count} ação${day.count!==1?'s':''}"></div>`;
        }).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:0.6875rem;color:var(--text-muted);">
        <span>${new Intl.DateTimeFormat('pt-BR',{month:'short'}).format(days[0].d)}</span>
        <span>${new Intl.DateTimeFormat('pt-BR',{month:'short'}).format(days[Math.floor(days.length/2)].d)}</span>
        <span>${new Intl.DateTimeFormat('pt-BR',{month:'short'}).format(days[days.length-1].d)}</span>
      </div>
    </div>
  `;
}

/* ─── Export ─────────────────────────────────────────────── */
function exportReport() {
  if (!metrics) { toast.warning('Aguarde o carregamento dos dados.'); return; }
  const { start, end } = getPeriodDates(currentPeriod);
  const fmtDate = d => new Intl.DateTimeFormat('pt-BR').format(d);
  const lines = [
    `PRIMETOUR — Relatório de Atividade`,
    `Período: ${fmtDate(start)} a ${fmtDate(end)}`,
    `Gerado em: ${fmtDate(new Date())}`,
    ``,
    `=== MÉTRICAS GERAIS ===`,
    `Total de tarefas: ${metrics.total}`,
    `Em andamento: ${metrics.inProgress}`,
    `Concluídas no período: ${metrics.doneInPeriod}`,
    `Em atraso: ${metrics.overdue}`,
    `Taxa de conclusão: ${metrics.completionRate}%`,
    `Projetos ativos: ${metrics.activeProjects}`,
    ``,
    `=== DISTRIBUIÇÃO POR STATUS ===`,
    ...getStatusDistribution(metrics.tasks).map(s => `${s.label}: ${s.count}`),
    ``,
    `=== RANKING DA EQUIPE ===`,
    ...getTasksByMember(metrics.tasks).map((u,i) => `${i+1}. ${u.name}: ${u.done} concluídas / ${u.total} total (${u.rate}%)`),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: `primetour-relatorio-${new Date().toISOString().slice(0,10)}.txt`,
  });
  a.click();
  URL.revokeObjectURL(url);
  toast.success('Relatório exportado!');
}

/* ─── Helpers ─────────────────────────────────────────────── */
function createWidget(gridId, id, colClass, title, subtitle, height) {
  const grid = document.getElementById(gridId);
  const existing = document.getElementById(id);
  if (existing) existing.remove();

  const wrap = document.createElement('div');
  wrap.className = `dash-widget ${colClass}`;
  wrap.id = id;
  wrap.style.minHeight = height + 'px';
  wrap.innerHTML = `
    <div class="widget-header">
      <div class="widget-title">${title}</div>
      ${subtitle ? `<span style="font-size:0.75rem;color:var(--text-muted);">${subtitle}</span>` : ''}
    </div>
    <div class="widget-body">
      <div class="chart-container" style="height:${height}px;">
        <canvas id="canvas-${id}"></canvas>
      </div>
    </div>
  `;
  if (grid) grid.appendChild(wrap);
  return wrap;
}

function tooltipStyle() {
  return {
    backgroundColor: 'rgba(10,22,40,0.92)',
    borderColor: 'rgba(212,168,67,0.3)',
    borderWidth: 1,
    titleColor: '#F1F5F9',
    bodyColor:  '#94A3B8',
    padding: 10,
    cornerRadius: 8,
  };
}

/* ─── R3: CSAT Geral ─────────────────────────────────────── */
function renderCsatGeneral(tasks, surveys) {
  const el = document.getElementById('r3-csat-general');
  if (!el) return;
  const m = getCsatGeneral(surveys);
  const stars = m.avg ? '★'.repeat(Math.round(m.avg)) + '☆'.repeat(5-Math.round(m.avg)) : '—';
  const scoreColor = m.avg >= 4 ? '#22C55E' : m.avg >= 3 ? '#F59E0B' : m.avg > 0 ? '#EF4444' : 'var(--text-muted)';

  el.innerHTML = `
    <div class="widget-header">
      <div class="widget-title">★ CSAT Geral</div>
      <span style="font-size:0.75rem;color:var(--text-muted);">Satisfação do cliente</span>
    </div>
    <div class="widget-body" style="padding:16px 18px;">
      ${!m.total ? `
        <div class="empty-state" style="padding:16px;">
          <div class="empty-state-icon" style="font-size:1.5rem;">★</div>
          <div class="empty-state-title" style="font-size:0.875rem;">Nenhuma pesquisa enviada ainda</div>
        </div>` : `
        <div style="display:flex;align-items:center;gap:20px;margin-bottom:16px;">
          <div style="text-align:center;">
            <div style="font-size:2.5rem;font-weight:700;color:${scoreColor};line-height:1;">
              ${m.avg || '—'}
            </div>
            <div style="font-size:1rem;color:${scoreColor};margin-top:2px;">${stars}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">média</div>
          </div>
          <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            ${[
              ['Total enviadas', m.total,        '#38BDF8'],
              ['Respondidas',    m.responded,    '#22C55E'],
              ['Taxa resposta',  m.responseRate+'%', '#A78BFA'],
              ['Enviadas',       m.sent,         '#F59E0B'],
            ].map(([label,val,color]) => `
              <div style="background:var(--bg-surface);border-radius:var(--radius-md);padding:8px 10px;">
                <div style="font-size:1.125rem;font-weight:700;color:${color};">${val}</div>
                <div style="font-size:0.6875rem;color:var(--text-muted);margin-top:1px;">${label}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `}
    </div>
  `;
}

/* ─── R3: % sem retrabalho ────────────────────────────────── */
function renderReworkWidget(tasks) {
  const el = document.getElementById('r3-rework');
  if (!el) return;
  const r = getReworkRate(tasks);
  const color = r.noReworkRate >= 80 ? '#22C55E' : r.noReworkRate >= 60 ? '#F59E0B' : '#EF4444';

  el.innerHTML = `
    <div class="widget-header">
      <div class="widget-title">✓ Tarefas sem Retrabalho</div>
    </div>
    <div class="widget-body" style="padding:16px 18px;">
      ${!r.total ? `
        <div class="empty-state" style="padding:16px;">
          <div class="empty-state-icon" style="font-size:1.5rem;">✓</div>
          <div class="empty-state-title" style="font-size:0.875rem;">Nenhuma tarefa concluída ainda</div>
        </div>` : `
        <div style="text-align:center;margin-bottom:14px;">
          <div style="font-size:2.5rem;font-weight:700;color:${color};line-height:1;">${r.noReworkRate}%</div>
          <div style="font-size:0.8125rem;color:var(--text-muted);margin-top:4px;">
            ${r.withoutRework} de ${r.total} concluídas sem retrabalho
          </div>
        </div>
        <div style="height:8px;background:var(--bg-elevated);border-radius:4px;overflow:hidden;margin-bottom:12px;">
          <div style="height:100%;width:${r.noReworkRate}%;background:${color};border-radius:4px;transition:width 0.8s ease;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--text-muted);">
          <span>🔄 Em retrabalho agora: <strong style="color:var(--color-warning);">${r.inRework}</strong></span>
          <span>Com retrabalho: <strong style="color:#EF4444;">${r.withRework}</strong></span>
        </div>
      `}
    </div>
  `;
}

/* ─── R3: Newsletters fora do calendário ─────────────────── */
function renderNewslettersWidget(tasks) {
  const el = document.getElementById('r3-newsletters');
  if (!el) return;
  const n = getNewslettersOutOfCalendar(tasks, currentPeriod);
  const color = n.outOfCalendarPct === 0 ? '#22C55E' : n.outOfCalendarPct < 20 ? '#F59E0B' : '#EF4444';

  el.innerHTML = `
    <div class="widget-header">
      <div class="widget-title">📧 Newsletters fora do calendário</div>
    </div>
    <div class="widget-body" style="padding:16px 18px;">
      ${!n.total ? `
        <div class="empty-state" style="padding:16px;">
          <div class="empty-state-icon" style="font-size:1.5rem;">📧</div>
          <div class="empty-state-title" style="font-size:0.875rem;">Nenhuma newsletter no período</div>
        </div>` : `
        <div style="text-align:center;margin-bottom:14px;">
          <div style="font-size:2.5rem;font-weight:700;color:${color};line-height:1;">${n.outOfCalendar}</div>
          <div style="font-size:0.8125rem;color:var(--text-muted);margin-top:4px;">
            de ${n.total} newsletters (${n.outOfCalendarPct}% fora do calendário)
          </div>
        </div>
        <div style="height:8px;background:var(--bg-elevated);border-radius:4px;overflow:hidden;margin-bottom:12px;">
          <div style="height:100%;width:${n.outOfCalendarPct}%;background:${color};border-radius:4px;transition:width 0.8s ease;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--text-muted);">
          <span>✓ No calendário: <strong style="color:#22C55E;">${n.inCalendar}</strong></span>
          <span>⚠ Fora: <strong style="color:${color};">${n.outOfCalendar}</strong></span>
        </div>
      `}
    </div>
  `;
}

/* ─── R3: CSAT por área ───────────────────────────────────── */
function renderCsatByAreaWidget(tasks, surveys, Chart) {
  const el = document.getElementById('r3-csat-area');
  if (!el) return;
  const data = getCsatByArea(surveys, tasks).filter(d => d.total > 0);

  el.innerHTML = `
    <div class="widget-header">
      <div class="widget-title">★ CSAT por Área</div>
      <span style="font-size:0.75rem;color:var(--text-muted);">Média de score · tarefas · % respostas</span>
    </div>
    <div class="widget-body" style="padding:0 18px 12px;">
      ${!data.length ? `
        <div class="empty-state" style="padding:24px;">
          <div class="empty-state-icon">★</div>
          <div class="empty-state-title" style="font-size:0.875rem;">Sem dados de CSAT por área</div>
        </div>` :
        data.map(d => {
          const avg   = d.avg || 0;
          const color = avg >= 4 ? '#22C55E' : avg >= 3 ? '#F59E0B' : avg > 0 ? '#EF4444' : '#6B7280';
          return `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-subtle);">
              <div style="min-width:120px;font-size:0.8125rem;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(d.area)}">${esc(d.area)}</div>
              <div style="flex:1;height:6px;background:var(--bg-elevated);border-radius:3px;overflow:hidden;">
                <div style="height:100%;width:${avg/5*100}%;background:${color};border-radius:3px;transition:width 0.8s;"></div>
              </div>
              <div style="width:28px;text-align:right;font-size:0.875rem;font-weight:700;color:${color};">${d.avg || '—'}</div>
              <div style="width:60px;text-align:right;font-size:0.75rem;color:var(--text-muted);">${d.total} tar.</div>
              <div style="width:40px;text-align:right;font-size:0.75rem;color:var(--text-muted);">${d.responseRate}%</div>
            </div>`;
        }).join('')
      }
    </div>
  `;
}

/* ─── R3: Performance por núcleo ──────────────────────────── */
function renderNucleoWidget(tasks, Chart) {
  const el = document.getElementById('r3-nucleo');
  if (!el) return;
  const data = getPerformanceByNucleo(tasks);

  el.innerHTML = `
    <div class="widget-header">
      <div class="widget-title">◈ Performance por Núcleo</div>
      <span style="font-size:0.75rem;color:var(--text-muted);">Tarefas concluídas</span>
    </div>
    <div class="widget-body" style="padding:0 18px 12px;">
      ${!data.length ? `
        <div class="empty-state" style="padding:24px;">
          <div class="empty-state-icon">◈</div>
          <div class="empty-state-title" style="font-size:0.875rem;">Nenhuma tarefa com núcleo definido</div>
        </div>` :
        data.map(d => `
          <div style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
              <span style="font-size:0.875rem;color:var(--text-secondary);">${esc(d.label)}</span>
              <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:0.75rem;color:var(--text-muted);">${d.done}/${d.total}</span>
                <span style="font-size:0.9375rem;font-weight:700;color:${d.color};">${d.rate}%</span>
              </div>
            </div>
            <div style="height:6px;background:var(--bg-elevated);border-radius:3px;overflow:hidden;">
              <div style="height:100%;width:${d.rate}%;background:${d.color};border-radius:3px;transition:width 0.8s ease;"></div>
            </div>
          </div>
        `).join('')
      }
    </div>
  `;
}

/* ─── Tempo por tarefa por tipo ──────────────────────────── */
function renderTimeByTypeChart(Chart, gridId, id, colClass, data) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  const wrap = document.createElement('div');
  wrap.className = `dash-widget ${colClass}`;
  wrap.id = id;
  grid.appendChild(wrap);

  if (!data.length) {
    wrap.innerHTML = `
      <div class="widget-header"><div class="widget-title">⏱ Tempo por Tarefa / Tipo</div></div>
      <div class="widget-body"><div class="empty-state" style="padding:24px;">
        <div class="empty-state-icon">⏱</div>
        <div class="empty-state-title" style="font-size:0.875rem;">Nenhuma tarefa concluída com datas registradas</div>
      </div></div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="widget-header">
      <div class="widget-title">⏱ Tempo por Tarefa / Tipo</div>
      <span style="font-size:0.75rem;color:var(--text-muted);">Média de dias até conclusão</span>
    </div>
    <div class="widget-body" style="padding:0 18px 12px;">
      ${data.map(d => `
        <div style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
            <span style="font-size:0.875rem;color:var(--text-secondary);">${esc(d.label)}</span>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:0.75rem;color:var(--text-muted);">${d.count} tarefa${d.count!==1?'s':''}</span>
              <span style="font-size:0.9375rem;font-weight:700;color:var(--text-primary);">${d.avgDays}d</span>
            </div>
          </div>
          <div style="height:6px;background:var(--bg-elevated);border-radius:3px;overflow:hidden;">
            <div style="height:100%;width:${Math.min(100,d.avgDays/30*100)}%;background:${d.color};
              border-radius:3px;transition:width 0.8s ease;"></div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function destroyCharts() {
  Object.values(chartInstances).forEach(c => { try { c.destroy(); } catch(e){} });
  chartInstances = {};
}

export function destroyDashboards() {
  destroyCharts();
}
