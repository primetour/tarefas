/**
 * PRIMETOUR — Roteiro Dashboard
 * Analytics dashboard for the Roteiros de Viagem module
 */

import { store } from '../store.js';
import { toast } from '../components/toast.js';
import { fetchRoteiroStats, fetchGenerations, ROTEIRO_STATUSES } from '../services/roteiros.js';
import { createDoc, loadJsPdf, COL, txt, withExportGuard } from '../components/pdfKit.js';

const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let chartInstances = [];
let currentPeriod = '30d';
let allRoteiros = [];
let allGenerations = [];

/* ─── Chart.js CDN loader ────────────────────────────────── */
async function loadChartJS() {
  if (window.Chart) return window.Chart;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
    s.onload = () => resolve(window.Chart);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function destroyCharts() {
  chartInstances.forEach(c => c?.destroy?.());
  chartInstances = [];
}

/* ─── Tooltip style ──────────────────────────────────────── */
function tooltipStyle() {
  return {
    backgroundColor: 'rgba(10,22,40,0.92)',
    borderColor: 'rgba(212,168,67,0.3)',
    borderWidth: 1,
    titleColor: '#F1F5F9',
    bodyColor: '#94A3B8',
    padding: 10,
    cornerRadius: 8,
  };
}

/* ─── Inline styles ──────────────────────────────────────── */
function injectStyles() {
  if (document.getElementById('rd-dashboard-styles')) return;
  const style = document.createElement('style');
  style.id = 'rd-dashboard-styles';
  style.textContent = `
    .rd-kpi-grid { display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px; }
    .rd-kpi-card { background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:16px;text-align:center; }
    .rd-kpi-value { font-size:1.75rem;font-weight:800;color:var(--brand-gold); }
    .rd-kpi-label { font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-top:4px; }
    .rd-charts-grid { display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px; }
    .rd-chart-card { background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:16px; }
    .rd-chart-title { font-size:0.875rem;font-weight:700;color:var(--text-primary);margin-bottom:12px; }
    .rd-gen-table { width:100%;border-collapse:collapse;font-size:0.8125rem; }
    .rd-gen-table th { text-align:left;padding:8px 12px;color:var(--text-muted);font-weight:600;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid var(--border-subtle); }
    .rd-gen-table td { padding:8px 12px;border-bottom:1px solid var(--border-subtle);color:var(--text-secondary); }
    .rd-gen-table tr:hover td { background:rgba(212,168,67,0.04); }
  `;
  document.head.appendChild(style);
}

/* ─── Period filter ───────────────────────────────────────── */
const PERIODS = [
  { key: '7d',  label: '7d',    days: 7 },
  { key: '30d', label: '30d',   days: 30 },
  { key: '90d', label: '90d',   days: 90 },
  { key: '1y',  label: '1 ano', days: 365 },
  { key: 'all', label: 'Tudo',  days: null },
];

function filterByPeriod(items) {
  if (currentPeriod === 'all') return items;
  const period = PERIODS.find(p => p.key === currentPeriod);
  if (!period || !period.days) return items;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - period.days);
  return items.filter(item => {
    const ts = parseTimestamp(item.createdAt);
    return ts && ts >= cutoff;
  });
}

function parseTimestamp(val) {
  if (!val) return null;
  if (val.toDate) return val.toDate();
  if (val instanceof Date) return val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

/* ─── Render ─────────────────────────────────────────────── */
export async function renderRoteiroDashboard(container) {
  if (!store.canManageRoteiros()) {
    container.innerHTML = '<div class="empty-state"><p>Sem permissão.</p></div>';
    return;
  }

  injectStyles();

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">
          <span style="background:linear-gradient(135deg,var(--brand-gold),#F59E0B);-webkit-background-clip:text;
            -webkit-text-fill-color:transparent;font-weight:700;">Dashboard — Roteiros de Viagem</span>
        </h1>
      </div>
    </div>

    <!-- Period selector -->
    <div class="dashboard-toolbar" style="display:flex;align-items:center;gap:8px;margin-bottom:20px;">
      <div class="date-range-bar" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
        ${PERIODS.map(p => `
          <button class="date-range-btn ${p.key === currentPeriod ? 'active' : ''}" data-period="${p.key}" style="
            padding:6px 14px;border-radius:6px;font-size:0.8125rem;cursor:pointer;border:1px solid var(--border-subtle);
            background:${p.key === currentPeriod ? 'var(--brand-gold)' : 'transparent'};
            color:${p.key === currentPeriod ? 'var(--bg-dark)' : 'var(--text-muted)'};font-weight:500;
          ">${p.label}</button>
        `).join('')}
      </div>
      <div style="margin-left:auto;display:flex;gap:8px;">
        <button id="rd-export-xls" class="btn btn-secondary" style="font-size:0.8125rem;padding:6px 14px;">
          Exportar XLS
        </button>
        <button id="rd-export-pdf" class="btn btn-secondary" style="font-size:0.8125rem;padding:6px 14px;">
          Exportar PDF
        </button>
      </div>
    </div>

    <!-- KPI cards -->
    <div id="rd-kpis" class="rd-kpi-grid">
      ${Array(6).fill('<div class="rd-kpi-card skeleton" style="height:80px;"></div>').join('')}
    </div>

    <!-- Charts -->
    <div id="rd-charts" class="rd-charts-grid">
      ${Array(8).fill('<div class="rd-chart-card skeleton" style="height:300px;"></div>').join('')}
    </div>

    <!-- Generations table -->
    <div id="rd-gen-table" class="rd-chart-card" style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:16px;">
      <div class="rd-chart-title">Ultimas Geracoes</div>
      <div class="skeleton" style="height:200px;"></div>
    </div>
  `;

  // Period button handlers
  container.querySelectorAll('.date-range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentPeriod = btn.dataset.period;
      container.querySelectorAll('.date-range-btn').forEach(b => {
        b.style.background = 'transparent';
        b.style.color = 'var(--text-muted)';
        b.classList.remove('active');
      });
      btn.style.background = 'var(--brand-gold)';
      btn.style.color = 'var(--bg-dark)';
      btn.classList.add('active');
      destroyCharts();
      processAndRender();
    });
  });

  // Export XLS
  container.querySelector('#rd-export-xls')?.addEventListener('click', () => exportRoteirosXLS());
  // Export PDF
  container.querySelector('#rd-export-pdf')?.addEventListener('click', () => exportRoteiroDashboardPdf());

  // Load data
  try {
    const [roteiros, generations] = await Promise.all([
      fetchRoteiroStats(),
      fetchGenerations({ limit: 50 }),
    ]);
    allRoteiros = roteiros.map(r => ({
      ...r,
      _ts: parseTimestamp(r.createdAt),
    })).filter(r => r._ts);
    allGenerations = generations.map(g => ({
      ...g,
      _ts: parseTimestamp(g.generatedAt),
    }));
  } catch (e) {
    console.warn('Erro ao carregar dados do dashboard de roteiros:', e);
    toast.error('Erro ao carregar dados do dashboard.');
    allRoteiros = [];
    allGenerations = [];
  }

  await processAndRender();
}

/* ─── Process & render all ───────────────────────────────── */
async function processAndRender() {
  const Chart = await loadChartJS();
  const roteiros = filterByPeriod(allRoteiros);

  renderKPIs(roteiros);
  renderCharts(Chart, roteiros);
  renderGenerationsTable();
}

/* ─── KPI cards ──────────────────────────────────────────── */
function renderKPIs(roteiros) {
  const el = document.getElementById('rd-kpis');
  if (!el) return;

  const total = roteiros.length;

  // Current month
  const now = new Date();
  const thisMonth = roteiros.filter(r => {
    return r._ts.getMonth() === now.getMonth() && r._ts.getFullYear() === now.getFullYear();
  }).length;

  const countByStatus = (key) => roteiros.filter(r => r.status === key).length;
  const drafts   = countByStatus('draft');
  const sent     = countByStatus('sent');
  const approved = countByStatus('approved');
  const convRate = sent > 0 ? ((approved / sent) * 100).toFixed(1) : '0.0';

  const kpis = [
    { value: total.toLocaleString('pt-BR'),   label: 'Total Roteiros' },
    { value: thisMonth.toLocaleString('pt-BR'), label: 'Este Mes' },
    { value: drafts.toLocaleString('pt-BR'),  label: 'Rascunhos' },
    { value: sent.toLocaleString('pt-BR'),    label: 'Enviados' },
    { value: approved.toLocaleString('pt-BR'), label: 'Aprovados' },
    { value: convRate + '%',                   label: 'Taxa de Conversão' },
  ];

  el.innerHTML = kpis.map(k => `
    <div class="rd-kpi-card">
      <div class="rd-kpi-value">${k.value}</div>
      <div class="rd-kpi-label">${k.label}</div>
    </div>
  `).join('');
}

/* ─── All charts ─────────────────────────────────────────── */
function renderCharts(Chart, roteiros) {
  const el = document.getElementById('rd-charts');
  if (!el) return;
  el.innerHTML = '';

  renderEvolucaoMensal(Chart, el, roteiros);
  renderPipelineStatus(Chart, el, roteiros);
  renderTopDestinos(Chart, el, roteiros);
  renderPerfilClientes(Chart, el, roteiros);
  renderPerfilEconomico(Chart, el, roteiros);
  renderFormatosExport(Chart, el);
  renderPorConsultor(Chart, el, roteiros);
  renderMoedas(Chart, el, roteiros);
}

/* ─── Helper: create chart card ──────────────────────────── */
function createChartCard(parent, id, title, height = 280) {
  const card = document.createElement('div');
  card.className = 'rd-chart-card';
  card.id = id;
  card.innerHTML = `
    <div class="rd-chart-title">${title}</div>
    <div style="height:${height}px;position:relative;">
      <canvas id="canvas-${id}"></canvas>
    </div>
  `;
  parent.appendChild(card);
  return card;
}

/* ─── Chart 1: Evolucao Mensal (line) ────────────────────── */
function renderEvolucaoMensal(Chart, parent, roteiros) {
  const card = createChartCard(parent, 'rd-evolucao', 'Evolucao Mensal');
  const canvas = card.querySelector('canvas');

  // Group by month (last 12)
  const monthMap = {};
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthMap[key] = 0;
  }
  for (const r of roteiros) {
    const key = `${r._ts.getFullYear()}-${String(r._ts.getMonth() + 1).padStart(2, '0')}`;
    if (key in monthMap) monthMap[key]++;
  }

  const labels = Object.keys(monthMap).map(k => {
    const [y, m] = k.split('-');
    return `${m}/${y.slice(2)}`;
  });
  const data = Object.values(monthMap);

  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Roteiros',
        data,
        borderColor: '#D4A843',
        backgroundColor: 'rgba(212,168,67,0.15)',
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointHoverRadius: 5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: tooltipStyle(),
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: 'var(--text-muted)', font: { size: 10 } } },
        y: { grid: { color: 'rgba(255,255,255,0.06)' }, beginAtZero: true, ticks: { color: 'var(--text-muted)', stepSize: 1 } },
      },
    },
  });
  chartInstances.push(chart);
}

/* ─── Chart 2: Pipeline de Status (doughnut) ─────────────── */
function renderPipelineStatus(Chart, parent, roteiros) {
  const card = createChartCard(parent, 'rd-pipeline', 'Pipeline de Status');
  const canvas = card.querySelector('canvas');

  const statusCounts = {};
  for (const s of ROTEIRO_STATUSES) statusCounts[s.key] = 0;
  for (const r of roteiros) {
    if (statusCounts[r.status] !== undefined) statusCounts[r.status]++;
  }

  const labels = ROTEIRO_STATUSES.map(s => s.label);
  const data = ROTEIRO_STATUSES.map(s => statusCounts[s.key]);
  const colors = ROTEIRO_STATUSES.map(s => s.color);

  const chart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.map(c => c + 'CC'),
        borderColor: colors,
        borderWidth: 1.5,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { position: 'right', labels: { color: '#94A3B8', boxWidth: 10, padding: 10, font: { size: 11 } } },
        tooltip: {
          ...tooltipStyle(),
          callbacks: {
            label: ctx => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
              return ` ${ctx.label}: ${ctx.parsed} (${Math.round(ctx.parsed / total * 100)}%)`;
            },
          },
        },
      },
    },
  });
  chartInstances.push(chart);
}

/* ─── Chart 3: Top 10 Destinos (horizontal bar) ─────────── */
function renderTopDestinos(Chart, parent, roteiros) {
  const card = createChartCard(parent, 'rd-destinos', 'Top 10 Destinos', 300);
  const canvas = card.querySelector('canvas');

  const destMap = {};
  for (const r of roteiros) {
    const dests = r.travel?.destinations || [];
    for (const d of dests) {
      const name = d.city || d.country || d.name || 'Desconhecido';
      if (name) destMap[name] = (destMap[name] || 0) + 1;
    }
  }
  const sorted = Object.entries(destMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const labels = sorted.map(([n]) => n.length > 25 ? n.substring(0, 23) + '...' : n);
  const data = sorted.map(([, v]) => v);

  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Roteiros',
        data,
        backgroundColor: 'rgba(212,168,67,0.7)',
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: tooltipStyle(),
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.06)' }, beginAtZero: true, ticks: { color: 'var(--text-muted)', stepSize: 1 } },
        y: { grid: { display: false }, ticks: { color: 'var(--text-muted)', font: { size: 11 } } },
      },
    },
  });
  chartInstances.push(chart);
}

/* ─── Chart 4: Perfil de Clientes (doughnut) ─────────────── */
function renderPerfilClientes(Chart, parent, roteiros) {
  const card = createChartCard(parent, 'rd-clientes', 'Perfil de Clientes');
  const canvas = card.querySelector('canvas');

  const typeLabels = {
    individual: 'Individual',
    couple: 'Casal',
    family: 'Familia',
    group: 'Grupo',
  };
  const typeMap = {};
  for (const r of roteiros) {
    const t = r.client?.type || 'individual';
    typeMap[t] = (typeMap[t] || 0) + 1;
  }

  const entries = Object.entries(typeMap).sort((a, b) => b[1] - a[1]);
  const labels = entries.map(([k]) => typeLabels[k] || k);
  const data = entries.map(([, v]) => v);
  const colors = ['#D4A843', '#38BDF8', '#22C55E', '#A78BFA'];

  const chart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.slice(0, data.length).map(c => c + 'CC'),
        borderColor: colors.slice(0, data.length),
        borderWidth: 1.5,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { position: 'right', labels: { color: '#94A3B8', boxWidth: 10, padding: 10, font: { size: 11 } } },
        tooltip: {
          ...tooltipStyle(),
          callbacks: {
            label: ctx => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
              return ` ${ctx.label}: ${ctx.parsed} (${Math.round(ctx.parsed / total * 100)}%)`;
            },
          },
        },
      },
    },
  });
  chartInstances.push(chart);
}

/* ─── Chart 5: Perfil Economico (doughnut) ───────────────── */
function renderPerfilEconomico(Chart, parent, roteiros) {
  const card = createChartCard(parent, 'rd-economico', 'Perfil Economico');
  const canvas = card.querySelector('canvas');

  const profLabels = {
    standard: 'Standard',
    premium: 'Premium',
    luxury: 'Luxury',
  };
  const profMap = {};
  for (const r of roteiros) {
    const p = r.client?.economicProfile || 'standard';
    profMap[p] = (profMap[p] || 0) + 1;
  }

  const entries = Object.entries(profMap).sort((a, b) => b[1] - a[1]);
  const labels = entries.map(([k]) => profLabels[k] || k);
  const data = entries.map(([, v]) => v);
  const colors = ['#6B7280', '#D4A843', '#A78BFA'];

  const chart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.slice(0, data.length).map(c => c + 'CC'),
        borderColor: colors.slice(0, data.length),
        borderWidth: 1.5,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { position: 'right', labels: { color: '#94A3B8', boxWidth: 10, padding: 10, font: { size: 11 } } },
        tooltip: {
          ...tooltipStyle(),
          callbacks: {
            label: ctx => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
              return ` ${ctx.label}: ${ctx.parsed} (${Math.round(ctx.parsed / total * 100)}%)`;
            },
          },
        },
      },
    },
  });
  chartInstances.push(chart);
}

/* ─── Chart 6: Formatos de Export (bar) ──────────────────── */
function renderFormatosExport(Chart, parent) {
  const card = createChartCard(parent, 'rd-formatos', 'Formatos de Export');
  const canvas = card.querySelector('canvas');

  const formatMap = {};
  for (const g of allGenerations) {
    const fmt = (g.format || 'pdf').toLowerCase();
    formatMap[fmt] = (formatMap[fmt] || 0) + 1;
  }

  const entries = Object.entries(formatMap).sort((a, b) => b[1] - a[1]);
  const labels = entries.map(([k]) => k.toUpperCase());
  const data = entries.map(([, v]) => v);
  const colors = ['#D4A843', '#38BDF8', '#22C55E', '#A78BFA', '#F59E0B'];

  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Geracoes',
        data,
        backgroundColor: colors.slice(0, data.length).map(c => c + 'BB'),
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: tooltipStyle(),
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: 'var(--text-muted)', font: { size: 11 } } },
        y: { grid: { color: 'rgba(255,255,255,0.06)' }, beginAtZero: true, ticks: { color: 'var(--text-muted)', stepSize: 1 } },
      },
    },
  });
  chartInstances.push(chart);
}

/* ─── Chart 7: Por Consultor (horizontal bar) ────────────── */
function renderPorConsultor(Chart, parent, roteiros) {
  const card = createChartCard(parent, 'rd-consultor', 'Por Consultor', 300);
  const canvas = card.querySelector('canvas');

  const consultMap = {};
  for (const r of roteiros) {
    const name = r.consultantName || 'Desconhecido';
    consultMap[name] = (consultMap[name] || 0) + 1;
  }
  const sorted = Object.entries(consultMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const labels = sorted.map(([n]) => n.length > 25 ? n.substring(0, 23) + '...' : n);
  const data = sorted.map(([, v]) => v);

  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Roteiros',
        data,
        backgroundColor: 'rgba(56,189,248,0.7)',
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: tooltipStyle(),
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.06)' }, beginAtZero: true, ticks: { color: 'var(--text-muted)', stepSize: 1 } },
        y: { grid: { display: false }, ticks: { color: 'var(--text-muted)', font: { size: 11 } } },
      },
    },
  });
  chartInstances.push(chart);
}

/* ─── Chart 8: Moedas (doughnut) ─────────────────────────── */
function renderMoedas(Chart, parent, roteiros) {
  const card = createChartCard(parent, 'rd-moedas', 'Moedas');
  const canvas = card.querySelector('canvas');

  const currMap = {};
  for (const r of roteiros) {
    const c = r.pricing?.currency || 'USD';
    currMap[c] = (currMap[c] || 0) + 1;
  }

  const entries = Object.entries(currMap).sort((a, b) => b[1] - a[1]);
  const labels = entries.map(([k]) => k);
  const data = entries.map(([, v]) => v);
  const colors = ['#D4A843', '#22C55E', '#38BDF8', '#A78BFA', '#F59E0B'];

  const chart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.slice(0, data.length).map(c => c + 'CC'),
        borderColor: colors.slice(0, data.length),
        borderWidth: 1.5,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { position: 'right', labels: { color: '#94A3B8', boxWidth: 10, padding: 10, font: { size: 11 } } },
        tooltip: {
          ...tooltipStyle(),
          callbacks: {
            label: ctx => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
              return ` ${ctx.label}: ${ctx.parsed} (${Math.round(ctx.parsed / total * 100)}%)`;
            },
          },
        },
      },
    },
  });
  chartInstances.push(chart);
}

/* ─── Generations table ──────────────────────────────────── */
function renderGenerationsTable() {
  const el = document.getElementById('rd-gen-table');
  if (!el) return;

  const gens = allGenerations.slice(0, 30);

  if (!gens.length) {
    el.innerHTML = `
      <div class="rd-chart-title">Ultimas Geracoes</div>
      <div style="text-align:center;padding:40px 20px;color:var(--text-muted);">
        <div style="font-size:0.875rem;">Nenhuma geracao encontrada.</div>
      </div>
    `;
    return;
  }

  el.innerHTML = `
    <div class="rd-chart-title">Ultimas Geracoes</div>
    <div style="overflow-x:auto;">
      <table class="rd-gen-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Roteiro</th>
            <th>Formato</th>
            <th>Consultor</th>
          </tr>
        </thead>
        <tbody>
          ${gens.map(g => {
            const ts = parseTimestamp(g.generatedAt);
            const dateStr = ts ? ts.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
            const title = esc(g.roteiroTitle || g.title || '—');
            const format = esc((g.format || 'pdf').toUpperCase());
            const consultant = esc(g.consultantName || g.createdByName || '—');
            return `
              <tr>
                <td>${dateStr}</td>
                <td>${title}</td>
                <td><span style="background:rgba(212,168,67,0.15);color:var(--brand-gold);padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;">${format}</span></td>
                <td>${consultant}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/* ─── Export XLS ─────────────────────────────────────────── */
async function loadSheetJS() {
  if (window.XLSX) return;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function exportRoteirosXLS() {
  try {
    await loadSheetJS();
    const roteiros = filterByPeriod(allRoteiros);

    const rows = roteiros.map(r => ({
      'Titulo': r.title || '',
      'Status': r.status || '',
      'Cliente': r.client?.name || '',
      'Tipo Cliente': r.client?.type || '',
      'Perfil': r.client?.economicProfile || '',
      'Destinos': (r.travel?.destinations || []).map(d => d.city || d.country).join(', '),
      'Noites': r.travel?.nights || '',
      'Data Inicio': r.travel?.startDate || '',
      'Data Fim': r.travel?.endDate || '',
      'Moeda': r.pricing?.currency || '',
      'Valor/Pessoa': r.pricing?.perPerson || '',
      'Valor/Casal': r.pricing?.perCouple || '',
      'Consultor': r.consultantName || '',
      'Criado em': r._ts ? r._ts.toLocaleDateString('pt-BR') : '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Roteiros');

    // Generations sheet
    const genRows = allGenerations.map(g => ({
      'Roteiro ID': g.roteiroId || '',
      'Formato': g.format || '',
      'Area': g.areaId || '',
      'Destinos': (g.destinations || []).join(', '),
      'Gerado por': g.generatedBy || '',
      'Data': g._ts ? g._ts.toLocaleDateString('pt-BR') : '',
    }));
    const ws2 = XLSX.utils.json_to_sheet(genRows);
    XLSX.utils.book_append_sheet(wb, ws2, 'Geracoes');

    XLSX.writeFile(wb, `roteiros_dashboard_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success('XLS exportado!');
  } catch (e) {
    toast.error('Erro ao exportar: ' + e.message);
  }
}

/* ─── Export PDF ─────────────────────────────────────────── */
const exportRoteiroDashboardPdf = withExportGuard(async function exportRoteiroDashboardPdf() {
  try {
    await loadJsPdf();
    if (!window.jspdf?.jsPDF?.API?.autoTable) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
        s.onload = res; s.onerror = rej; document.head.appendChild(s);
      });
    }

    const roteiros = filterByPeriod(allRoteiros);
    const fmtD = d => (d ? new Intl.DateTimeFormat('pt-BR').format(d) : '—');

    // KPIs
    const now = new Date();
    const thisMonth = roteiros.filter(r => r._ts.getMonth() === now.getMonth() && r._ts.getFullYear() === now.getFullYear()).length;
    const countByStatus = (k) => roteiros.filter(r => r.status === k).length;
    const drafts = countByStatus('draft');
    const sent = countByStatus('sent');
    const approved = countByStatus('approved');
    const convRate = sent > 0 ? ((approved / sent) * 100).toFixed(1) : '0.0';

    // Período humano
    const periodLabel = (PERIODS.find(p => p.key === currentPeriod) || {}).label || '—';

    const kit = createDoc({ orientation: 'landscape', margin: 14 });
    const { doc, W, M, CW, setFill, setText } = kit;

    kit.drawCover({
      title: 'Dashboard — Roteiros de Viagem',
      subtitle: 'PRIMETOUR  ·  Roteiros Premium',
      meta: `Periodo: ${periodLabel}  ·  ${roteiros.length} roteiros  ·  ${allGenerations.length} geracoes`,
      compact: true,
    });

    // KPI strip
    const kpis = [
      { label: 'Total',       value: roteiros.length.toLocaleString('pt-BR'), col: COL.blue },
      { label: 'Este Mes',    value: thisMonth.toLocaleString('pt-BR'),        col: COL.brand2 },
      { label: 'Rascunhos',   value: drafts.toLocaleString('pt-BR'),           col: COL.orange },
      { label: 'Enviados',    value: sent.toLocaleString('pt-BR'),             col: COL.blue },
      { label: 'Aprovados',   value: approved.toLocaleString('pt-BR'),         col: COL.green },
      { label: 'Taxa Conv.',  value: `${convRate}%`,
        col: Number(convRate) >= 50 ? COL.green : Number(convRate) >= 25 ? COL.orange : COL.red },
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

    // Capturar charts do DOM
    const chartDefs = [
      { id: 'rd-evolucao',  title: 'EVOLUCAO MENSAL' },
      { id: 'rd-pipeline',  title: 'PIPELINE DE STATUS' },
      { id: 'rd-destinos',  title: 'TOP 10 DESTINOS' },
      { id: 'rd-clientes',  title: 'PERFIL DE CLIENTES' },
      { id: 'rd-economico', title: 'PERFIL ECONOMICO' },
      { id: 'rd-formatos',  title: 'FORMATOS DE EXPORT' },
      { id: 'rd-consultor', title: 'POR CONSULTOR' },
      { id: 'rd-moedas',    title: 'MOEDAS' },
    ];
    const charts = [];
    for (const def of chartDefs) {
      const c = document.getElementById(`canvas-${def.id}`);
      if (c && c.width > 0 && c.height > 0) {
        try {
          charts.push({
            title: def.title,
            img: c.toDataURL('image/png', 0.92),
            aspect: c.height / c.width,
          });
        } catch (_) {}
      }
    }

    // Grid de charts 2 colunas
    if (charts.length) {
      const cols = 2;
      const colW = (CW - gap) / cols;
      const cellH = 58;

      for (let i = 0; i < charts.length; i += cols) {
        kit.ensureSpace(cellH + 10);
        // Títulos da linha
        setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
        for (let j = 0; j < cols && (i + j) < charts.length; j++) {
          const cx = M + j * (colW + gap);
          doc.text(txt(charts[i + j].title), cx, kit.y);
        }
        kit.y += 3;

        // Imagens — preserva aspect ratio do canvas (evita esticar)
        const rowStart = kit.y;
        for (let j = 0; j < cols && (i + j) < charts.length; j++) {
          const cx = M + j * (colW + gap);
          const ch = charts[i + j];
          let w = colW, h = colW * ch.aspect;
          if (h > cellH) { h = cellH; w = cellH / ch.aspect; }
          const xOff = cx + (colW - w) / 2;
          doc.addImage(ch.img, 'PNG', xOff, rowStart, w, h);
        }
        kit.y = rowStart + cellH + 5;
      }
    } else {
      // Fallback nativo: top destinos + por consultor como barras
      setText(COL.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.text(txt('(Graficos nao disponiveis — abra o dashboard no navegador antes de exportar)'), M, kit.y);
      kit.y += 8;

      const hexToRgb = (hex) => {
        const h = String(hex || '#6B7280').replace('#', '');
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      };

      // Top destinos
      const destMap = {};
      for (const r of roteiros) {
        const dests = r.travel?.destinations || [];
        for (const d of dests) {
          const name = d.city || d.country || d.name;
          if (name) destMap[name] = (destMap[name] || 0) + 1;
        }
      }
      const destSorted = Object.entries(destMap).sort((a, b) => b[1] - a[1]).slice(0, 10);

      // Por consultor
      const consultMap = {};
      for (const r of roteiros) {
        const name = r.consultantName || 'Desconhecido';
        consultMap[name] = (consultMap[name] || 0) + 1;
      }
      const consultSorted = Object.entries(consultMap).sort((a, b) => b[1] - a[1]).slice(0, 10);

      const colW = (CW - gap) / 2;
      const colX = [M, M + colW + gap];
      const topY = kit.y;

      setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.text(txt('TOP 10 DESTINOS'), colX[0], topY);
      doc.text(txt('POR CONSULTOR (TOP 10)'), colX[1], topY);
      kit.y = topY + 4;

      const drawBars = (data, x, availW, rgb) => {
        if (!data.length) {
          setText(COL.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
          doc.text(txt('(sem dados)'), x, kit.y + 4);
          return kit.y + 4;
        }
        const max = Math.max(...data.map(d => d[1]), 1);
        const labW = Math.min(46, availW * 0.4);
        const barMaxW = availW - labW - 14;
        let yy = kit.y + 3;
        data.forEach(([n, v]) => {
          setText(COL.text); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2);
          doc.text(txt(String(n).slice(0, 22)), x, yy + 3.2);
          kit.drawBar(x + labW, yy + 1.6, barMaxW, (v / max) * 100, rgb, 2.2);
          setText(rgb); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.2);
          doc.text(String(v), x + labW + barMaxW + 3, yy + 3.2);
          yy += 6;
        });
        return yy;
      };

      const yEndLeft  = drawBars(destSorted,    colX[0], colW, hexToRgb('#D4A843'));
      const yEndRight = drawBars(consultSorted, colX[1], colW, hexToRgb('#38BDF8'));
      kit.y = Math.max(yEndLeft, yEndRight) + 6;
    }

    // ═════ Tabela de últimas gerações ═════
    const gens = allGenerations.slice(0, 25);
    if (gens.length) {
      doc.addPage();
      kit.y = kit.M + 3;
      setText(COL.muted); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
      doc.text(txt('PRIMETOUR  ·  Roteiros'), M, 9);
      kit.setDraw(COL.border); doc.setLineWidth(0.15);
      doc.line(M, 11, W - M, 11);
      kit.y = 17;

      setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
      doc.text(txt('ULTIMAS GERACOES'), M, kit.y);
      setText(COL.gold); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.text(txt(`— ${gens.length} ultimas geradas`), M + 52, kit.y);
      kit.y += 4;

      doc.autoTable({
        startY: kit.y,
        margin: { left: M, right: M, bottom: 14 },
        head: [['Data', 'Roteiro', 'Formato', 'Consultor']],
        body: gens.map(g => {
          const ts = parseTimestamp(g.generatedAt);
          const dateStr = ts ? ts.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
          return [
            dateStr,
            txt(g.roteiroTitle || g.title || '—'),
            txt((g.format || 'pdf').toUpperCase()),
            txt(g.consultantName || g.createdByName || '—'),
          ];
        }),
        styles: { fontSize: 8, cellPadding: 2.4, textColor: COL.text },
        headStyles: { fillColor: COL.brand, textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
        alternateRowStyles: { fillColor: COL.subBg },
        columnStyles: {
          0: { cellWidth: 36 },
          2: { cellWidth: 20, halign: 'center' },
          3: { cellWidth: 52 },
        },
      });
    }

    kit.drawFooter('PRIMETOUR  ·  Dashboard Roteiros');
    doc.save(`roteiros_dashboard_${new Date().toISOString().slice(0, 10)}.pdf`);
    toast.success('PDF exportado!');
  } catch (e) {
    console.error(e);
    toast.error('Erro ao exportar PDF: ' + e.message);
  }
});

/* ─── Cleanup ────────────────────────────────────────────── */
export function destroyRoteiroDashboard() {
  destroyCharts();
}
