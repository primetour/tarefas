/**
 * PRIMETOUR — Dashboards Page (Etapa 3)
 * Analytics completo com Chart.js
 */

import { store }    from '../store.js';
import { toast }    from '../components/toast.js';
import { openTaskModal } from '../components/taskModal.js';
import { createDoc, loadJsPdf, COL, txt, withExportGuard } from '../components/pdfKit.js';
import {
  getOverviewMetrics, getTasksByDay, getStatusDistribution,
  getPriorityDistribution, getTasksByMember, getTasksByProject,
  getWeeklyVelocity, getActivityHeatmap, getUpcomingDeadlines,
  getTimePerTaskByType, getPeriodDates,
  getCsatGeneral, getCsatByArea, getPerformanceByNucleo,
  getReworkRate, getNewslettersOutOfCalendar,
} from '../services/analytics.js';
import { fetchSurveys } from '../services/csat.js';
import { REQUESTING_AREAS } from '../components/filterBar.js';
import {
  collection, getDocs,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ─── State ──────────────────────────────────────────────── */
let currentPeriod = '30d';
let customFrom = '';
let customTo   = '';
let filterUser   = '';
let filterNucleo = '';
let filterSector = '';
const activePeriod = () =>
  currentPeriod === 'custom' && customFrom && customTo
    ? `custom:${customFrom}:${customTo}`
    : currentPeriod;
let chartInstances = {};
let metrics = null;

const NUCLEOS_LIST = [
  { value:'design',        label:'Design'        },
  { value:'comunicacao',   label:'Comunicação'   },
  { value:'redes_sociais', label:'Redes Sociais' },
  { value:'dados',         label:'Dados'         },
  { value:'web',           label:'Web'           },
  { value:'sistemas',      label:'Sistemas'      },
  { value:'ia',            label:'IA'            },
];

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
  // Guard: permissão necessária
  if (!store.can('analytics_view') && !store.can('dashboard_view') && !store.isMaster()) {
    container.innerHTML = `<div class="empty-state" style="padding:60px 20px;text-align:center;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
      <div class="empty-state-subtitle">Você não tem permissão para acessar os dashboards de produtividade.</div>
    </div>`;
    return;
  }
  // Load users if not in store
  let users = (store.get('users') || []).filter(u => u.active !== false);
  if (!users.length) {
    try {
      const snap = await getDocs(collection(db, 'users'));
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      store.set('users', all);
      users = all.filter(u => u.active !== false);
    } catch { /* ignore */ }
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Dashboards</h1>
        <p class="page-subtitle">Métricas e análises do time</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-secondary btn-sm" id="dash-export-xls">↓ XLS</button>
        <button class="btn btn-secondary btn-sm" id="dash-export-pdf">↓ PDF</button>
        <button class="btn btn-primary" id="dash-new-task">+ Nova Tarefa</button>
      </div>
    </div>

    <!-- Period selector -->
    <div class="dashboard-toolbar">
      <span class="dashboard-toolbar-title"></span>
      <div class="date-range-bar" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
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
        <button class="date-range-btn ${'custom'===currentPeriod?'active':''}" data-period="custom">
          Personalizado
        </button>
        <div id="dash-custom-range" style="display:${'custom'===currentPeriod?'flex':'none'};
          gap:6px;align-items:center;margin-left:4px;">
          <input type="date" id="dash-from" class="portal-field"
            style="font-size:0.8125rem;padding:4px 8px;" value="${customFrom||''}">
          <span style="color:var(--text-muted);">→</span>
          <input type="date" id="dash-to" class="portal-field"
            style="font-size:0.8125rem;padding:4px 8px;" value="${customTo||''}">
          <button class="btn btn-primary btn-sm" id="dash-apply-custom"
            style="font-size:0.8125rem;">Aplicar</button>
        </div>
      </div>
    </div>

    <!-- Filters: user, núcleo, área (restricted by permissions) -->
    ${(() => {
      const isMasterOrAdmin = store.isMaster() || store.can('system_view_all');
      const visibleSectors = store.getVisibleSectors(); // null=master, []=nenhum, [...]
      // Filter users: master sees all; others see only users in their visible sectors
      const visibleUsers = isMasterOrAdmin ? users
        : users.filter(u => {
            const uSector = u.sector || u.department || '';
            if (!uSector) return true; // user without sector — show (safe, tasks already filtered)
            return visibleSectors && visibleSectors.includes(uSector);
          });
      // Filter areas: master sees all; others see only their visible sectors
      const visibleAreas = isMasterOrAdmin ? REQUESTING_AREAS
        : REQUESTING_AREAS.filter(s => visibleSectors && visibleSectors.includes(s));
      // Núcleos: show all (núcleos are cross-sector, no permission restriction needed)
      return `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;align-items:center;">
      <select class="filter-select" id="dash-user-filter" style="min-width:190px;">
        <option value="">Todos os usuários</option>
        ${visibleUsers.map(u => `<option value="${esc(u.id)}" ${filterUser===u.id?'selected':''}>${esc(u.name || u.email)}</option>`).join('')}
      </select>
      <select class="filter-select" id="dash-nucleo-filter" style="min-width:150px;">
        <option value="">Todos os núcleos</option>
        ${NUCLEOS_LIST.map(n => `<option value="${esc(n.value)}" ${filterNucleo===n.value?'selected':''}>${esc(n.label)}</option>`).join('')}
      </select>
      <select class="filter-select" id="dash-sector-filter" style="min-width:160px;">
        <option value="">Todas as áreas</option>
        ${visibleAreas.map(s => `<option value="${esc(s)}" ${filterSector===s?'selected':''}>${esc(s)}</option>`).join('')}
      </select>
      ${(filterUser||filterNucleo||filterSector) ? `
        <button class="btn btn-ghost btn-sm" id="dash-clear-filters"
          style="font-size:0.75rem;color:var(--text-muted);">✕ Limpar filtros</button>` : ''}
    </div>`;
    })()}

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
      const rangeEl = document.getElementById('dash-custom-range');
      if (btn.dataset.period === 'custom') {
        if (rangeEl) rangeEl.style.display = 'flex';
        currentPeriod = 'custom';
        document.querySelectorAll('.date-range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        return; // wait for Aplicar
      }
      if (rangeEl) rangeEl.style.display = 'none';
      currentPeriod = btn.dataset.period;
      document.querySelectorAll('.date-range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      destroyCharts();
      loadData(container);
    });
  });

  const applyCustom = document.getElementById('dash-apply-custom');
  if (applyCustom) {
    applyCustom.addEventListener('click', () => {
      customFrom = document.getElementById('dash-from')?.value || '';
      customTo   = document.getElementById('dash-to')?.value   || '';
      if (!customFrom || !customTo) { toast.error('Selecione as duas datas.'); return; }
      if (customFrom > customTo) { toast.error('Data inicial deve ser anterior à data final.'); return; }
      destroyCharts();
      loadData(container);
    });
  }

  // Filter dropdowns
  document.getElementById('dash-user-filter')?.addEventListener('change', e => {
    filterUser = e.target.value;
    destroyCharts(); loadData(container);
  });
  document.getElementById('dash-nucleo-filter')?.addEventListener('change', e => {
    filterNucleo = e.target.value;
    destroyCharts(); loadData(container);
  });
  document.getElementById('dash-sector-filter')?.addEventListener('change', e => {
    filterSector = e.target.value;
    destroyCharts(); loadData(container);
  });
  document.getElementById('dash-clear-filters')?.addEventListener('click', () => {
    filterUser = ''; filterNucleo = ''; filterSector = '';
    const uf = document.getElementById('dash-user-filter');   if (uf) uf.value = '';
    const nf = document.getElementById('dash-nucleo-filter'); if (nf) nf.value = '';
    const sf = document.getElementById('dash-sector-filter'); if (sf) sf.value = '';
    const cb = document.getElementById('dash-clear-filters'); if (cb) cb.remove();
    destroyCharts(); loadData(container);
  });

  document.getElementById('dash-new-task')?.addEventListener('click', () =>
    openTaskModal({ onSave: () => loadData(container) })
  );
  document.getElementById('dash-export-xls')?.addEventListener('click', () => exportDashXls());
  document.getElementById('dash-export-pdf')?.addEventListener('click', () => exportDashPdf());

  await loadData(container);
}

/* ─── Filter tasks helper ────────────────────────────────── */
function applyFilters(tasks) {
  let filtered = tasks;
  if (filterUser) {
    filtered = filtered.filter(t => (t.assignees || []).includes(filterUser) || t.createdBy === filterUser);
  }
  if (filterNucleo) {
    filtered = filtered.filter(t => (t.nucleos || []).includes(filterNucleo));
  }
  if (filterSector) {
    filtered = filtered.filter(t => t.sector === filterSector);
  }
  return filtered;
}

/* ─── Load & render all charts ────────────────────────────── */
async function loadData(container) {
  try {
    const [Chart, m, surveys] = await Promise.all([
      loadChartJS(),
      getOverviewMetrics(activePeriod()),
      fetchSurveys({ limitN: 500 }).catch(() => []),
    ]);

    // Apply user/nucleo/sector filters
    m.tasks    = applyFilters(m.tasks);
    m.total    = m.tasks.length;

    const { start } = getPeriodDates(activePeriod());
    const done       = m.tasks.filter(t => t.status === 'done');
    const inProgress = m.tasks.filter(t => t.status === 'in_progress');
    const overdue    = m.tasks.filter(t => {
      if (!t.dueDate || t.status === 'done') return false;
      const d = t.dueDate?.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
      return d < new Date();
    });
    const doneInPeriod = done.filter(t => {
      if (!t.completedAt) return false;
      const d = t.completedAt?.toDate ? t.completedAt.toDate() : new Date(t.completedAt);
      return d >= start;
    });
    // Pontualidade: só avaliamos tarefas que TÊM prazo.
    // Sem dueDate → não-avaliável (não puxa taxa pra baixo, mas é reportado).
    const doneEvaluable = done.filter(t => t.dueDate && t.completedAt);
    const doneOnTime = doneEvaluable.filter(t => {
      const due       = t.dueDate?.toDate       ? t.dueDate.toDate()       : new Date(t.dueDate);
      const completed = t.completedAt?.toDate   ? t.completedAt.toDate()   : new Date(t.completedAt);
      return completed <= due;
    });
    const doneLate       = doneEvaluable.length - doneOnTime.length;
    const doneNoDueDate  = done.length - doneEvaluable.length;

    m.done           = done.length;
    m.inProgress     = inProgress.length;
    m.overdue        = overdue.length;
    m.doneInPeriod   = doneInPeriod.length;
    m.doneOnTime     = doneOnTime.length;
    m.doneLate       = doneLate;
    m.doneNoDueDate  = doneNoDueDate;
    m.doneEvaluable  = doneEvaluable.length;
    // Taxa calculada SÓ sobre avaliáveis — tarefas sem prazo não entram no denominador.
    m.onTimeRate     = doneEvaluable.length ? Math.round((doneOnTime.length / doneEvaluable.length) * 100) : 0;

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
    ${kpiCard('Em Andamento',        m.inProgress,              '▶',  'rgba(56,189,248,0.12)',  'var(--color-info)')}
    ${kpiCard('Concluídas (período)',m.doneInPeriod,             '✓',  'rgba(34,197,94,0.12)',   'var(--color-success)')}
    ${kpiCard('Em Atraso',           m.overdue,                 '⚠',  'rgba(239,68,68,0.12)',   'var(--color-danger)')}
    ${kpiCard('Pontualidade',        m.onTimeRate + '%',        '🎯', 'rgba(167,139,250,0.12)', 'var(--role-admin)',
      m.doneEvaluable
        ? `${m.doneOnTime} no prazo · ${m.doneLate} atrasadas${m.doneNoDueDate ? ` · ${m.doneNoDueDate} sem prazo` : ''}`
        : (m.doneNoDueDate ? `${m.doneNoDueDate} concluídas sem prazo definido` : 'sem dados'))}
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
  // Map color to accent type for CSS stripe
  const accentMap = { 'var(--color-info)':'info', 'var(--color-success)':'success',
    'var(--color-danger)':'danger', 'var(--color-warning)':'warning', 'var(--brand-gold)':'brand' };
  const accent = accentMap[ic] || 'brand';
  return `
    <div class="dash-widget kpi col-span-3" data-accent="${accent}" style="min-height:unset;">
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

  // Clear skeleton placeholders from all grids
  ['charts-grid', 'bottom-grid'].forEach(id => {
    const grid = document.getElementById(id);
    if (grid) grid.innerHTML = '';
  });

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

  /* 4 — Projects progress bar (4-col) */
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
  try { renderCsatGeneral(tasks, surveys); }       catch(e){ console.warn('R3 CSAT general:', e); }
  try { renderReworkWidget(tasks); }               catch(e){ console.warn('R3 rework:', e); }
  try { renderNewslettersWidget(tasks); }          catch(e){ console.warn('R3 newsletters:', e); }
  try { renderCsatByAreaWidget(tasks, surveys); }  catch(e){ console.warn('R3 CSAT area:', e); }
  try { renderNucleoWidget(tasks); }               catch(e){ console.warn('R3 nucleo:', e); }
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
    urgent:{label:'Urgente',color:'var(--color-danger)'}, high:{label:'Alta',color:'#F97316'},
    medium:{label:'Média',color:'var(--color-warning)'},   low:{label:'Baixa',color:'#6B7280'},
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
async function exportDashXls() {
  if (!metrics) { toast.warning('Aguarde o carregamento dos dados.'); return; }
  if (!window.XLSX) await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload=res; s.onerror=rej; document.head.appendChild(s); });

  const { start, end } = getPeriodDates(activePeriod());
  const fmtD = d => new Intl.DateTimeFormat('pt-BR').format(d);
  const wb = window.XLSX.utils.book_new();

  // Sheet 1 — Resumo
  const summary = [
    ['PRIMETOUR — Relatório de Atividade'],
    [`Período: ${fmtD(start)} a ${fmtD(end)}`],
    [`Gerado em: ${fmtD(new Date())}`],
    [],
    ['Métrica', 'Valor'],
    ['Total de tarefas', metrics.total],
    ['Em andamento', metrics.inProgress],
    ['Concluídas no período', metrics.doneInPeriod],
    ['Em atraso', metrics.overdue],
    ['Taxa de conclusão', `${metrics.completionRate}%`],
    ['Projetos ativos', metrics.activeProjects],
  ];
  const ws1 = window.XLSX.utils.aoa_to_sheet(summary);
  ws1['!cols'] = [{ wch: 30 }, { wch: 15 }];
  window.XLSX.utils.book_append_sheet(wb, ws1, 'Resumo');

  // Sheet 2 — Status
  const statusRows = [['Status', 'Quantidade'], ...getStatusDistribution(metrics.tasks).map(s => [s.label, s.count])];
  const ws2 = window.XLSX.utils.aoa_to_sheet(statusRows);
  ws2['!cols'] = [{ wch: 20 }, { wch: 12 }];
  window.XLSX.utils.book_append_sheet(wb, ws2, 'Por status');

  // Sheet 3 — Equipe
  const teamRows = [['Membro', 'Concluídas', 'Total', 'Taxa (%)'],
    ...getTasksByMember(metrics.tasks).map(u => [u.name, u.done, u.total, u.rate])];
  const ws3 = window.XLSX.utils.aoa_to_sheet(teamRows);
  ws3['!cols'] = [{ wch: 25 }, { wch: 12 }, { wch: 10 }, { wch: 10 }];
  window.XLSX.utils.book_append_sheet(wb, ws3, 'Equipe');

  window.XLSX.writeFile(wb, `primetour_dashboard_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast.success('XLS exportado!');
}

const exportDashPdf = withExportGuard(async function exportDashPdf() {
  if (!metrics) { toast.warning('Aguarde o carregamento dos dados.'); return; }
  await loadJsPdf();
  if (!window.jspdf?.jsPDF?.API?.autoTable) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }

  const { start, end } = getPeriodDates(activePeriod());
  const fmtD = d => new Intl.DateTimeFormat('pt-BR').format(d);

  // landscape oferece colunagem melhor para dashboards
  const kit = createDoc({ orientation: 'landscape', margin: 14 });
  const { doc, W, M, CW, setFill, setText } = kit;

  kit.drawCover({
    title: 'Relatorio de Produtividade',
    subtitle: 'PRIMETOUR  ·  Gestao de Tarefas',
    meta: `${fmtD(start)} — ${fmtD(end)}  ·  ${metrics.total} tarefas`,
    compact: true,
  });

  // ═════ KPI Strip (5 blocos) ═════
  const kpis = [
    { label: 'Total',        value: String(metrics.total),        col: COL.blue   },
    { label: 'Concluidas',   value: String(metrics.doneInPeriod), col: COL.green  },
    { label: 'Em andamento', value: String(metrics.inProgress),   col: COL.brand2 },
    { label: 'Em atraso',    value: String(metrics.overdue),
      col: metrics.overdue > 0 ? COL.red : COL.green },
    { label: 'Pontualidade', value: `${metrics.onTimeRate}%`,
      col: metrics.onTimeRate >= 80 ? COL.green : metrics.onTimeRate >= 60 ? COL.orange : COL.red },
  ];
  const gap = 3;
  const kpiW = (CW - gap * (kpis.length - 1)) / kpis.length;
  const kpiH = 22;
  let y = kit.y;
  kpis.forEach((k, i) => {
    const x = M + i * (kpiW + gap);
    setFill(COL.white); doc.roundedRect(x, y, kpiW, kpiH, 1.6, 1.6, 'F');
    setFill(k.col);     doc.rect(x, y, kpiW, 1.6, 'F');
    setText(COL.text);  doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    doc.text(txt(k.value), x + kpiW / 2, y + 12, { align: 'center' });
    setText(COL.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    doc.text(txt(k.label.toUpperCase()), x + kpiW / 2, y + 18, { align: 'center' });
  });
  kit.y = y + kpiH + 6;

  // ═════ Gráficos capturados do DOM ═════
  // IMPORTANTE: os <canvas> vivem como filhos dos widgets, com id="canvas-${widgetId}".
  // document.getElementById('velocity-chart') retorna o DIV wrapper, não o canvas —
  // e divs não têm toDataURL(), então a captura falhava silenciosamente.
  const chartIds = [
    'velocity-chart', 'time-type-chart',
    'status-donut', 'priority-donut', 'projects-chart',
  ];
  const charts = {};
  for (const cid of chartIds) {
    const c = document.getElementById(`canvas-${cid}`);
    if (c && c.width > 0 && c.height > 0) {
      try { charts[cid] = { img: c.toDataURL('image/png', 0.92), aspect: c.height / c.width }; }
      catch (_) {}
    }
  }
  const hasAnyChart = Object.keys(charts).length > 0;

  // Linha A: Velocity (2/3) + Tempo por tipo (1/3)
  const vc = charts['velocity-chart'];
  const tt = charts['time-type-chart'];
  if (vc || tt) {
    const wA = CW * (2 / 3) - 2;
    const wB = CW * (1 / 3) - 2;
    const rowH = 52;
    kit.ensureSpace(rowH + 8);
    setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    if (vc) doc.text(txt('CRIADAS vs CONCLUIDAS'), M, kit.y);
    if (tt) doc.text(txt('TEMPO MEDIO POR TIPO'), M + wA + 4, kit.y);
    kit.y += 3;
    // fitImage: mantém proporção nativa do canvas (sem esticar)
    const fitImage = (imgObj, slotX, slotW, slotH) => {
      let w = slotW, h = slotW * imgObj.aspect;
      if (h > slotH) { h = slotH; w = slotH / imgObj.aspect; }
      const xOff = slotX + (slotW - w) / 2;
      doc.addImage(imgObj.img, 'PNG', xOff, kit.y, w, h);
    };
    if (vc) fitImage(vc, M,            wA, rowH);
    if (tt) fitImage(tt, M + wA + 4,   wB, rowH);
    kit.y += rowH + 5;
  }

  // Linha B: donut status + donut prioridade + progresso projetos
  const sd = charts['status-donut'];
  const pd = charts['priority-donut'];
  const pj = charts['projects-chart'];
  if (sd || pd || pj) {
    const colCount = [sd, pd, pj].filter(Boolean).length;
    const colW = (CW - gap * (colCount - 1)) / colCount;
    const rowH = 54;
    kit.ensureSpace(rowH + 8);
    const titles = [];
    if (sd) titles.push({ t: 'POR STATUS', img: sd });
    if (pd) titles.push({ t: 'POR PRIORIDADE', img: pd });
    if (pj) titles.push({ t: 'PROGRESSO POR PROJETO', img: pj });
    setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    titles.forEach((t, i) => doc.text(txt(t.t), M + i * (colW + gap), kit.y));
    kit.y += 3;
    titles.forEach((t, i) => {
      const x = M + i * (colW + gap);
      // Preserva aspect ratio
      let w = colW, h = colW * t.img.aspect;
      if (h > rowH) { h = rowH; w = rowH / t.img.aspect; }
      const xOff = x + (colW - w) / 2;
      doc.addImage(t.img.img, 'PNG', xOff, kit.y, w, h);
    });
    kit.y += rowH + 5;
  }

  // ═════ FALLBACK: sem canvas capturados, desenha gráficos nativos no PDF ═════
  // Isso garante que a página 1 nunca fica vazia (aba colapsada, chart não renderizado, etc.)
  if (!hasAnyChart) {
    const statusDist = getStatusDistribution(metrics.tasks).filter(s => s.count > 0);
    const prioDist   = getPriorityDistribution(metrics.tasks).filter(p => p.count > 0);
    const byProject  = getTasksByProject(metrics.tasks, metrics.projects || []);

    const hexToRgb = (hex) => {
      const h = String(hex || '#6B7280').replace('#', '');
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    };

    const colW = (CW - gap * 2) / 3;
    const colX = [M, M + colW + gap, M + 2 * (colW + gap)];
    const rowH = 58;
    kit.ensureSpace(rowH + 10);

    setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(txt('POR STATUS'), colX[0], kit.y);
    doc.text(txt('POR PRIORIDADE'), colX[1], kit.y);
    doc.text(txt('TOP PROJETOS'), colX[2], kit.y);
    kit.y += 3;

    // Coluna 1: Status bars
    const topY = kit.y;
    const drawDistBars = (list, x, availW) => {
      if (!list.length) {
        setText(COL.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
        doc.text(txt('(sem dados)'), x, topY + 10);
        return;
      }
      const maxC = Math.max(...list.map(d => d.count), 1);
      const labW = Math.min(28, availW * 0.35);
      const barMaxW = availW - labW - 14;
      let yy = topY + 3;
      list.slice(0, 8).forEach(d => {
        const rgb = hexToRgb(d.color);
        setText(COL.text); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2);
        doc.text(txt(d.label), x, yy + 3.2);
        kit.drawBar(x + labW, yy + 1.6, barMaxW, (d.count / maxC) * 100, rgb, 2.2);
        setText(rgb); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.2);
        doc.text(String(d.count), x + labW + barMaxW + 3, yy + 3.2);
        yy += 6;
      });
    };

    drawDistBars(statusDist, colX[0], colW);
    drawDistBars(prioDist,   colX[1], colW);

    // Coluna 3: Top projetos
    if (byProject.length) {
      const top = byProject.slice(0, 7);
      const maxT = Math.max(...top.map(p => p.total || 0), 1);
      const labW = Math.min(30, colW * 0.4);
      const barMaxW = colW - labW - 14;
      let yy = topY + 3;
      top.forEach(p => {
        const pct = p.total ? Math.round((p.done || 0) * 100 / p.total) : 0;
        const rgb = pct >= 80 ? hexToRgb('#16A34A') : pct >= 50 ? hexToRgb('#D97706') : hexToRgb('#2563EB');
        const shortName = (p.name || p.project || '—').slice(0, 18);
        setText(COL.text); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2);
        doc.text(txt(shortName), colX[2], yy + 3.2);
        kit.drawBar(colX[2] + labW, yy + 1.6, barMaxW, pct, rgb, 2.2);
        setText(rgb); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.2);
        doc.text(`${pct}%`, colX[2] + labW + barMaxW + 3, yy + 3.2);
        yy += 6;
      });
    } else {
      setText(COL.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.text(txt('(sem projetos)'), colX[2], topY + 10);
    }

    kit.y = topY + rowH;

    // Linha extra: velocity semanal (criadas vs concluídas)
    const velocity = getWeeklyVelocity(metrics.tasks, 12) || [];
    if (velocity.length) {
      kit.ensureSpace(52);
      setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.text(txt('CRIADAS vs CONCLUIDAS (12 SEMANAS)'), M, kit.y);
      kit.y += 3;

      const chartY = kit.y;
      const chartH = 38;
      const chartW = CW;
      setFill(COL.subBg); doc.rect(M, chartY, chartW, chartH, 'F');

      const maxV = Math.max(
        ...velocity.map(v => Math.max(Number(v.created) || 0, Number(v.done) || 0)),
        1,
      );
      const barGroupW = chartW / velocity.length;
      const barW = Math.max(2, Math.min(6, barGroupW * 0.35));

      velocity.forEach((v, i) => {
        const gx = M + i * barGroupW + barGroupW / 2;
        const xC = gx - barW - 0.4;
        const xD = gx + 0.4;
        const hC = ((Number(v.created) || 0) / maxV) * (chartH - 4);
        const hD = ((Number(v.done) || 0) / maxV) * (chartH - 4);
        setFill(COL.blue);  doc.rect(xC, chartY + chartH - hC - 2, barW, hC, 'F');
        setFill(COL.green); doc.rect(xD, chartY + chartH - hD - 2, barW, hD, 'F');
      });

      // Legenda
      setFill(COL.blue);  doc.rect(M, chartY + chartH + 2.5, 3, 2.2, 'F');
      setText(COL.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
      doc.text(txt('Criadas'), M + 4.5, chartY + chartH + 4.4);
      setFill(COL.green); doc.rect(M + 22, chartY + chartH + 2.5, 3, 2.2, 'F');
      doc.text(txt('Concluidas'), M + 26.5, chartY + chartH + 4.4);
      doc.text(txt(`${velocity.length} semanas`), W - M, chartY + chartH + 4.4, { align: 'right' });

      kit.y = chartY + chartH + 8;
    }
  }

  // ═════ Segunda página: Ranking (esquerda) + Distribuição (direita) ═════
  doc.addPage();
  kit.y = kit.M + 3;
  setText(COL.muted); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
  doc.text(txt('PRIMETOUR  ·  Produtividade'), M, 9);
  kit.setDraw(COL.border); doc.setLineWidth(0.15);
  doc.line(M, 11, W - M, 11);
  kit.y = 17;

  const colW = (CW - 6) / 2;
  const colX1 = M;
  const colX2 = M + colW + 6;
  const topY = kit.y;

  // ── Coluna esquerda: Ranking da equipe ─────────────────
  setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(txt('RANKING DA EQUIPE'), colX1, topY);
  setText(COL.gold); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
  doc.text(txt('— por tarefas concluidas'), colX1 + 54, topY);
  const members = getTasksByMember(metrics.tasks);
  doc.autoTable({
    startY: topY + 3,
    margin: { left: colX1, right: W - (colX1 + colW), bottom: 14 },
    tableWidth: colW,
    head: [['#', 'Membro', 'Concl.', 'Total', 'Taxa']],
    body: members.map((u, i) => [i + 1, txt(u.name), u.done, u.total, `${u.rate}%`]),
    styles: { fontSize: 8, cellPadding: 2.4, textColor: COL.text },
    headStyles: { fillColor: COL.brand, textColor: 255, fontStyle: 'bold', fontSize: 7 },
    alternateRowStyles: { fillColor: COL.subBg },
    columnStyles: {
      0: { cellWidth: 7, halign: 'center' },
      2: { cellWidth: 14, halign: 'center' },
      3: { cellWidth: 14, halign: 'center' },
      4: { cellWidth: 22, halign: 'center' },
    },
    didDrawCell: (data) => {
      if (data.section === 'body' && data.column.index === 4) {
        const rate = members[data.row.index]?.rate || 0;
        const barX = data.cell.x + 1;
        const barY = data.cell.y + data.cell.height - 2.3;
        const barW = data.cell.width - 2;
        setFill(rate >= 80 ? COL.green : rate >= 50 ? COL.orange : COL.red);
        doc.rect(barX, barY, barW * rate / 100, 1.2, 'F');
      }
    },
  });
  const leftFinalY = doc.lastAutoTable.finalY;

  // ── Coluna direita: Distribuição por status + prioridade em barras ──
  setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(txt('DISTRIBUICAO POR STATUS'), colX2, topY);
  let yR = topY + 5;
  const statusDist = getStatusDistribution(metrics.tasks).filter(s => s.count > 0);
  const maxS = Math.max(...statusDist.map(s => s.count), 1);
  const labW = 38;
  const barMaxW = colW - labW - 18;
  statusDist.forEach(s => {
    const hex = s.color || '#6B7280';
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    setText(COL.text); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.text(txt(s.label), colX2, yR + 3.2);
    kit.drawBar(colX2 + labW, yR + 1.4, barMaxW, (s.count / maxS) * 100, [r, g, b], 2.4);
    setText([r, g, b]); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    doc.text(String(s.count), colX2 + labW + barMaxW + 3, yR + 3.2);
    yR += 6;
  });

  yR += 5;
  setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(txt('DISTRIBUICAO POR PRIORIDADE'), colX2, yR);
  yR += 5;
  const prioDist = getPriorityDistribution(metrics.tasks).filter(p => p.count > 0);
  const maxP = Math.max(...prioDist.map(p => p.count), 1);
  prioDist.forEach(p => {
    const hex = p.color || '#6B7280';
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    setText(COL.text); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.text(txt(p.label), colX2, yR + 3.2);
    kit.drawBar(colX2 + labW, yR + 1.4, barMaxW, (p.count / maxP) * 100, [r, g, b], 2.4);
    setText([r, g, b]); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    doc.text(String(p.count), colX2 + labW + barMaxW + 3, yR + 3.2);
    yR += 6;
  });

  // Avança o cursor para o maior dos dois lados
  kit.y = Math.max(leftFinalY, yR) + 8;

  // ═════ Próximos vencimentos / Atrasadas ═════
  const upcoming = (metrics.tasks || [])
    .filter(t => t.status !== 'done' && t.status !== 'cancelled' && t.dueDate)
    .map(t => {
      const d = t.dueDate?.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
      return { t, d };
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, 10);

  if (upcoming.length) {
    kit.ensureSpace(28);
    setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(txt('PROXIMOS VENCIMENTOS'), M, kit.y);
    setText(COL.gold); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.text(txt('— top 10 em atraso ou proximos'), M + 58, kit.y);
    kit.y += 3;
    const users = store.get('users') || [];
    const now = new Date();
    doc.autoTable({
      startY: kit.y,
      margin: { left: M, right: M, bottom: 14 },
      head: [['Prazo', 'Status', 'Titulo', 'Responsaveis']],
      body: upcoming.map(({ t, d }) => {
        const assigns = (t.assignees || [])
          .map(uid => users.find(u => u.id === uid)?.name).filter(Boolean).join(', ');
        const stKey = (t.status || 'not_started').toLowerCase();
        const stLbl = ({
          not_started: 'Nao iniciada', in_progress: 'Em andamento',
          paused: 'Pausada', blocked: 'Bloqueada',
        })[stKey] || stKey;
        return [fmtD(d), stLbl, txt(t.title || '-'), txt(assigns || '-')];
      }),
      styles: { fontSize: 8, cellPadding: 2.4, textColor: COL.text },
      headStyles: { fillColor: COL.brand, textColor: 255, fontStyle: 'bold', fontSize: 7 },
      alternateRowStyles: { fillColor: COL.subBg },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 26 },
        3: { cellWidth: 60 },
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 0) {
          const rowDate = upcoming[data.row.index]?.d;
          if (rowDate && rowDate < now) {
            data.cell.styles.textColor = COL.red;
            data.cell.styles.fontStyle = 'bold';
          }
        }
      },
    });
  }

  kit.drawFooter('PRIMETOUR  ·  Produtividade');
  doc.save(`primetour_dashboard_${new Date().toISOString().slice(0, 10)}.pdf`);
  toast.success('PDF exportado!');
});

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
  const scoreColor = m.avg >= 4 ? 'var(--color-success)' : m.avg >= 3 ? 'var(--color-warning)' : m.avg > 0 ? 'var(--color-danger)' : 'var(--text-muted)';

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
              ['Total enviadas', m.total,        'var(--color-info)'],
              ['Respondidas',    m.responded,    'var(--color-success)'],
              ['Taxa resposta',  m.responseRate+'%', '#A78BFA'],
              ['Enviadas',       m.sent,         'var(--color-warning)'],
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
  const color = r.noReworkRate >= 80 ? 'var(--color-success)' : r.noReworkRate >= 60 ? 'var(--color-warning)' : 'var(--color-danger)';

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
          <span>Com retrabalho: <strong style="color:var(--color-danger);">${r.withRework}</strong></span>
        </div>
      `}
    </div>
  `;
}

/* ─── R3: Newsletters fora do calendário ─────────────────── */
function renderNewslettersWidget(tasks) {
  const el = document.getElementById('r3-newsletters');
  if (!el) return;
  const n = getNewslettersOutOfCalendar(tasks, activePeriod());
  const color = n.outOfCalendarPct === 0 ? 'var(--color-success)' : n.outOfCalendarPct < 20 ? 'var(--color-warning)' : 'var(--color-danger)';

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
          <span>✓ No calendário: <strong style="color:var(--color-success);">${n.inCalendar}</strong></span>
          <span>⚠ Fora: <strong style="color:${color};">${n.outOfCalendar}</strong></span>
        </div>
      `}
    </div>
  `;
}

/* ─── R3: CSAT por área ───────────────────────────────────── */
function renderCsatByAreaWidget(tasks, surveys) {
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
          const color = avg >= 4 ? 'var(--color-success)' : avg >= 3 ? 'var(--color-warning)' : avg > 0 ? 'var(--color-danger)' : '#6B7280';
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
function renderNucleoWidget(tasks) {
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
