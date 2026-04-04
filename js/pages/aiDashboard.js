/**
 * PRIMETOUR — AI Dashboard
 * Análise de uso de inteligência artificial no sistema
 */

import {
  collection, getDocs, query, where, orderBy, limit as fbLimit, Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';
import { toast } from '../components/toast.js';
import { MODULE_REGISTRY, AI_PROVIDERS, AI_MODELS } from '../services/ai.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let chartInstances = {};
let currentPeriod = '30d';
let allLogs = [];
let allUsers = [];

/* ─── Chart.js loader (mesmo padrão do dashboards.js) ──── */
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

/* ─── Render ─────────────────────────────────────────────── */
export async function renderAiDashboard(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">
          <span style="background:linear-gradient(135deg,var(--brand-gold),#F59E0B);-webkit-background-clip:text;
            -webkit-text-fill-color:transparent;font-weight:700;">◈ Dashboard IA</span>
        </h1>
        <p class="page-subtitle">Análise de uso de inteligência artificial nos módulos</p>
      </div>
    </div>

    <!-- Period selector -->
    <div class="dashboard-toolbar" style="display:flex;align-items:center;gap:8px;margin-bottom:20px;">
      <div class="date-range-bar" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
        ${['7d','30d','90d','all'].map(p => `
          <button class="date-range-btn ${p===currentPeriod?'active':''}" data-period="${p}" style="
            padding:6px 14px;border-radius:6px;font-size:0.8125rem;cursor:pointer;border:1px solid var(--border-subtle);
            background:${p===currentPeriod?'var(--brand-gold)':'transparent'};
            color:${p===currentPeriod?'var(--bg-dark)':'var(--text-muted)'};font-weight:500;
          ">${{'7d':'7 dias','30d':'30 dias','90d':'90 dias','all':'Tudo'}[p]}</button>
        `).join('')}
      </div>
    </div>

    <!-- KPI cards -->
    <div id="ai-kpis" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:24px;">
      ${[0,1,2,3,4,5].map(()=>'<div class="card skeleton" style="height:80px;"></div>').join('')}
    </div>

    <!-- Charts row 1: temporal -->
    <div id="ai-charts-r1" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
      <div class="card skeleton" style="height:280px;"></div>
      <div class="card skeleton" style="height:280px;"></div>
    </div>

    <!-- Charts row 2: distribution -->
    <div id="ai-charts-r2" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px;">
      <div class="card skeleton" style="height:280px;"></div>
      <div class="card skeleton" style="height:280px;"></div>
      <div class="card skeleton" style="height:280px;"></div>
    </div>

    <!-- Charts row 3: rankings -->
    <div id="ai-charts-r3" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
      <div class="card skeleton" style="height:320px;"></div>
      <div class="card skeleton" style="height:320px;"></div>
    </div>

    <!-- Row 4: efficiency + unused skills -->
    <div id="ai-charts-r4" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
      <div class="card skeleton" style="height:280px;"></div>
      <div class="card skeleton" style="height:280px;"></div>
    </div>
  `;

  // Period buttons
  container.querySelectorAll('.date-range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentPeriod = btn.dataset.period;
      container.querySelectorAll('.date-range-btn').forEach(b => {
        b.style.background = 'transparent';
        b.style.color = 'var(--text-muted)';
      });
      btn.style.background = 'var(--brand-gold)';
      btn.style.color = 'var(--bg-dark)';
      destroyCharts();
      processAndRender();
    });
  });

  // Load users for name resolution
  try {
    const snap = await getDocs(collection(db, 'users'));
    allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { allUsers = []; }

  await loadLogs();
}

/* ─── Data loading ───────────────────────────────────────── */
async function loadLogs() {
  try {
    const snap = await getDocs(query(
      collection(db, 'ai_usage_logs'),
      orderBy('timestamp', 'desc'),
      fbLimit(5000),
    ));
    allLogs = snap.docs.map(d => {
      const data = d.data();
      return {
        ...data,
        id: d.id,
        ts: data.timestamp?.toDate ? data.timestamp.toDate() : null,
      };
    }).filter(l => l.ts);
  } catch (e) {
    allLogs = [];
    console.warn('Erro ao carregar logs IA:', e);
  }

  await processAndRender();
}

/* ─── Filter by period ───────────────────────────────────── */
function filterByPeriod(logs) {
  if (currentPeriod === 'all') return logs;
  const days = { '7d': 7, '30d': 30, '90d': 90 }[currentPeriod] || 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return logs.filter(l => l.ts >= cutoff);
}

/* ─── Process & render all ───────────────────────────────── */
async function processAndRender() {
  const Chart = await loadChartJS();
  const logs = filterByPeriod(allLogs);

  renderKPIs(logs);
  renderCallsPerDay(Chart, logs);
  renderTokensPerDay(Chart, logs);
  renderByModule(Chart, logs);
  renderByProvider(Chart, logs);
  renderByModel(Chart, logs);
  renderTopSkills(Chart, logs);
  renderTopUsers(Chart, logs);
  renderCostByModule(Chart, logs);
  renderUnusedSkills(logs);
}

/* ─── KPI cards ──────────────────────────────────────────── */
function renderKPIs(logs) {
  const el = document.getElementById('ai-kpis');
  if (!el) return;

  const totalCalls   = logs.length;
  const totalTokensIn  = logs.reduce((s, l) => s + (l.inputTokens || 0), 0);
  const totalTokensOut = logs.reduce((s, l) => s + (l.outputTokens || 0), 0);
  const totalTokens  = totalTokensIn + totalTokensOut;
  const uniqueUsers  = new Set(logs.map(l => l.userId).filter(Boolean)).size;
  const uniqueSkills = new Set(logs.map(l => l.skillId).filter(Boolean)).size;
  const costEst = estimateCost(logs);

  const kpis = [
    { value: totalCalls.toLocaleString('pt-BR'),    label: 'Chamadas',        color: 'var(--brand-gold)' },
    { value: formatTokens(totalTokens),              label: 'Tokens totais',   color: 'var(--text-primary)' },
    { value: formatTokens(totalTokensIn),            label: 'Tokens input',    color: '#38BDF8' },
    { value: formatTokens(totalTokensOut),           label: 'Tokens output',   color: '#A78BFA' },
    { value: uniqueUsers,                            label: 'Usuários ativos', color: '#22C55E' },
    { value: `~R$ ${costEst.toFixed(2)}`,            label: 'Custo estimado',  color: '#F59E0B' },
  ];

  el.innerHTML = kpis.map(k => `
    <div class="card" style="padding:16px;text-align:center;">
      <div style="font-size:1.5rem;font-weight:700;color:${k.color};">${k.value}</div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">${k.label}</div>
    </div>
  `).join('');
}

function formatTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toLocaleString('pt-BR');
}

function estimateCost(logs) {
  // Custo estimado em USD convertido para BRL (~5.2)
  const rates = {
    // por 1M tokens [input, output]
    'gemini':    [0, 0],        // grátis
    'groq':      [0, 0],        // grátis
    'anthropic': [3, 15],       // Sonnet default
    'azure':     [2.5, 10],     // GPT-4o default
  };
  let total = 0;
  for (const l of logs) {
    const r = rates[l.provider] || [0, 0];
    total += ((l.inputTokens || 0) * r[0] + (l.outputTokens || 0) * r[1]) / 1000000;
  }
  return total * 5.2; // USD → BRL
}

/* ─── Chart: Chamadas por dia ────────────────────────────── */
function renderCallsPerDay(Chart, logs) {
  const el = document.getElementById('ai-charts-r1');
  if (!el) return;
  el.innerHTML = '';

  const { labels, data } = groupByDay(logs);

  const wrap = createChartWidget(el, 'ai-calls-day', 'Chamadas por dia', 260);
  const canvas = wrap.querySelector('canvas');
  chartInstances['ai-calls-day'] = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Chamadas',
        data,
        borderColor: '#D4A843',
        backgroundColor: 'rgba(212,168,67,0.15)',
        fill: true, tension: 0.4, pointRadius: 3, pointHoverRadius: 5,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: tooltipStyle() },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { maxTicksLimit: 10, font: { size: 10 } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true, ticks: { stepSize: 1 } },
      },
    },
  });

  // Tokens per day (stacked)
  const { labels: tLabels, dataIn, dataOut } = groupTokensByDay(logs);

  const wrap2 = createChartWidget(el, 'ai-tokens-day', 'Tokens por dia (input vs output)', 260);
  const canvas2 = wrap2.querySelector('canvas');
  chartInstances['ai-tokens-day'] = new Chart(canvas2, {
    type: 'bar',
    data: {
      labels: tLabels,
      datasets: [
        { label: 'Input', data: dataIn, backgroundColor: 'rgba(56,189,248,0.7)', borderRadius: 3 },
        { label: 'Output', data: dataOut, backgroundColor: 'rgba(167,139,250,0.7)', borderRadius: 3 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { boxWidth: 10, padding: 12 } }, tooltip: tooltipStyle() },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, stacked: true, ticks: { maxTicksLimit: 10, font: { size: 10 } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, stacked: true, beginAtZero: true },
      },
    },
  });
}

/* (renderTokensPerDay is merged into renderCallsPerDay for grid layout) */
function renderTokensPerDay() {}

/* ─── Chart: Por módulo (donut) ──────────────────────────── */
function renderByModule(Chart, logs) {
  const el = document.getElementById('ai-charts-r2');
  if (!el) return;
  el.innerHTML = '';

  const grouped = {};
  for (const l of logs) {
    const m = l.module || 'general';
    grouped[m] = (grouped[m] || 0) + 1;
  }
  const sorted = Object.entries(grouped).sort((a,b) => b[1] - a[1]).slice(0, 8);
  const labels = sorted.map(([m]) => MODULE_REGISTRY[m]?.label || m);
  const data   = sorted.map(([, v]) => v);
  const colors = ['#D4A843','#38BDF8','#22C55E','#A78BFA','#F59E0B','#EF4444','#EC4899','#64748B'];

  const wrap = createChartWidget(el, 'ai-by-module', 'Uso por módulo', 260);
  const canvas = wrap.querySelector('canvas');
  chartInstances['ai-by-module'] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors.slice(0, data.length).map(c=>c+'CC'),
        borderColor: colors.slice(0, data.length), borderWidth: 1.5, hoverOffset: 6 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 10, padding: 10, font: { size: 11 } } },
        tooltip: { ...tooltipStyle(), callbacks: {
          label: ctx => {
            const total = ctx.dataset.data.reduce((a,b)=>a+b,0) || 1;
            return ` ${ctx.label}: ${ctx.parsed} (${Math.round(ctx.parsed/total*100)}%)`;
          }
        }},
      },
    },
  });

  // By provider
  renderByProviderChart(Chart, el, logs);
  // By model
  renderByModelChart(Chart, el, logs);
}

function renderByProvider() {} // placeholder — actual in renderByModule
function renderByModel() {}   // placeholder — actual in renderByModule

function renderByProviderChart(Chart, el, logs) {
  const grouped = {};
  for (const l of logs) {
    const p = l.provider || 'unknown';
    grouped[p] = (grouped[p] || 0) + 1;
  }
  const sorted = Object.entries(grouped).sort((a,b) => b[1] - a[1]);
  const labels = sorted.map(([p]) => AI_PROVIDERS.find(x => x.id === p)?.label || p);
  const data   = sorted.map(([,v]) => v);
  const colors = ['#D4A843','#38BDF8','#A78BFA','#22C55E','#EF4444'];

  const wrap = createChartWidget(el, 'ai-by-provider', 'Uso por provider', 260);
  const canvas = wrap.querySelector('canvas');
  chartInstances['ai-by-provider'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors.slice(0, data.length).map(c=>c+'BB'), borderRadius: 4 }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: tooltipStyle() },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true, ticks: { stepSize: 1 } },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
}

function renderByModelChart(Chart, el, logs) {
  const grouped = {};
  for (const l of logs) {
    const m = l.model || 'unknown';
    grouped[m] = (grouped[m] || 0) + 1;
  }
  const sorted = Object.entries(grouped).sort((a,b) => b[1] - a[1]).slice(0, 8);

  // Resolve friendly names
  const allModels = Object.values(AI_MODELS).flat();
  const labels = sorted.map(([m]) => allModels.find(x => x.id === m)?.label || m);
  const data   = sorted.map(([,v]) => v);
  const colors = ['#D4A843','#38BDF8','#22C55E','#A78BFA','#F59E0B','#EF4444','#EC4899','#64748B'];

  const wrap = createChartWidget(el, 'ai-by-model', 'Uso por modelo', 260);
  const canvas = wrap.querySelector('canvas');
  chartInstances['ai-by-model'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors.slice(0, data.length).map(c=>c+'BB'), borderRadius: 4 }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: tooltipStyle() },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true, ticks: { stepSize: 1 } },
        y: { grid: { display: false }, ticks: { font: { size: 10 } } },
      },
    },
  });
}

/* ─── Chart: Top skills ──────────────────────────────────── */
function renderTopSkills(Chart, logs) {
  const el = document.getElementById('ai-charts-r3');
  if (!el) return;
  el.innerHTML = '';

  const grouped = {};
  for (const l of logs) {
    const name = l.skillName || l.skillId || 'Desconhecida';
    grouped[name] = (grouped[name] || 0) + 1;
  }
  const sorted = Object.entries(grouped).sort((a,b) => b[1] - a[1]).slice(0, 10);
  const labels = sorted.map(([n]) => n.length > 30 ? n.substring(0, 28) + '...' : n);
  const data   = sorted.map(([,v]) => v);

  const wrap = createChartWidget(el, 'ai-top-skills', 'Top 10 skills mais usadas', 300);
  const canvas = wrap.querySelector('canvas');
  chartInstances['ai-top-skills'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Chamadas', data, backgroundColor: 'rgba(212,168,67,0.7)', borderRadius: 4 }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: tooltipStyle() },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true, ticks: { stepSize: 1 } },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
}

/* ─── Chart: Top users ───────────────────────────────────── */
function renderTopUsers(Chart, logs) {
  const el = document.getElementById('ai-charts-r3');
  if (!el) return;

  const grouped = {};
  for (const l of logs) {
    if (!l.userId) continue;
    grouped[l.userId] = (grouped[l.userId] || 0) + 1;
  }
  const sorted = Object.entries(grouped).sort((a,b) => b[1] - a[1]).slice(0, 10);

  // Resolve names
  const labels = sorted.map(([uid]) => {
    const u = allUsers.find(x => x.id === uid);
    const name = u?.name || u?.displayName || u?.email || uid.substring(0, 8);
    return name.length > 25 ? name.substring(0, 23) + '...' : name;
  });
  const data = sorted.map(([,v]) => v);

  const wrap = createChartWidget(el, 'ai-top-users', 'Top 10 usuários', 300);
  const canvas = wrap.querySelector('canvas');
  chartInstances['ai-top-users'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Chamadas', data, backgroundColor: 'rgba(56,189,248,0.7)', borderRadius: 4 }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: tooltipStyle() },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true, ticks: { stepSize: 1 } },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
}

/* ─── Chart: Custo por módulo ────────────────────────────── */
function renderCostByModule(Chart, logs) {
  const el = document.getElementById('ai-charts-r4');
  if (!el) return;
  el.innerHTML = '';

  // Agrupar custo por módulo
  const costByMod = {};
  const rates = {
    'gemini': [0,0], 'groq': [0,0],
    'anthropic': [3,15], 'azure': [2.5,10],
  };
  for (const l of logs) {
    const m = l.module || 'general';
    const r = rates[l.provider] || [0,0];
    const cost = ((l.inputTokens||0)*r[0] + (l.outputTokens||0)*r[1]) / 1000000 * 5.2;
    costByMod[m] = (costByMod[m] || 0) + cost;
  }
  const sorted = Object.entries(costByMod).sort((a,b) => b[1] - a[1]).filter(([,v]) => v > 0);

  if (!sorted.length) {
    // Sem custo (tudo grátis)
    const wrap = createInfoWidget(el, 'ai-cost-mod', 'Custo estimado por módulo', 260);
    wrap.querySelector('.widget-body-content').innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:var(--text-muted);">
        <div style="font-size:2rem;margin-bottom:8px;">🎉</div>
        <div style="font-size:0.9375rem;font-weight:500;color:var(--text-primary);">Custo zero!</div>
        <div style="font-size:0.8125rem;margin-top:4px;">Todos os providers em uso são gratuitos.</div>
      </div>
    `;
  } else {
    const labels = sorted.map(([m]) => MODULE_REGISTRY[m]?.label || m);
    const data   = sorted.map(([,v]) => parseFloat(v.toFixed(2)));
    const colors = ['#D4A843','#38BDF8','#22C55E','#A78BFA','#F59E0B','#EF4444'];

    const wrap = createChartWidget(el, 'ai-cost-mod', 'Custo estimado por módulo (R$)', 260);
    const canvas = wrap.querySelector('canvas');
    chartInstances['ai-cost-mod'] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: 'R$', data, backgroundColor: colors.slice(0,data.length).map(c=>c+'BB'), borderRadius: 4 }],
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { ...tooltipStyle(), callbacks: {
          label: ctx => ` R$ ${ctx.parsed.x?.toFixed(2) || ctx.parsed.toFixed(2)}`,
        }}},
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true,
            ticks: { callback: v => 'R$ ' + v.toFixed(2) } },
          y: { grid: { display: false }, ticks: { font: { size: 11 } } },
        },
      },
    });
  }

  // Unused skills / efficiency
  renderUnusedSkills(logs);
}

/* ─── Widget: Skills sem uso ─────────────────────────────── */
async function renderUnusedSkills(logs) {
  const el = document.getElementById('ai-charts-r4');
  if (!el) return;

  // Existing skill-unused widget? remove
  document.getElementById('ai-unused-skills')?.remove();

  // Fetch active skills
  let skills = [];
  try {
    const { fetchSkills } = await import('../services/ai.js');
    skills = await fetchSkills();
  } catch { return; }

  const activeSkills = skills.filter(s => s.active);
  const usedIds = new Set(logs.map(l => l.skillId).filter(Boolean));
  const unused = activeSkills.filter(s => !usedIds.has(s.id));

  const wrap = createInfoWidget(el, 'ai-unused-skills', `Skills sem uso no período (${unused.length})`, 260);
  const body = wrap.querySelector('.widget-body-content');

  if (!unused.length) {
    body.innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:var(--text-muted);">
        <div style="font-size:2rem;margin-bottom:8px;">✓</div>
        <div style="font-size:0.875rem;color:var(--text-primary);">Todas as skills ativas foram utilizadas!</div>
      </div>
    `;
  } else {
    body.innerHTML = `
      <div style="max-height:220px;overflow-y:auto;">
        ${unused.map(s => {
          const mod = MODULE_REGISTRY[s.module] || {};
          return `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border-subtle);">
            <span style="font-size:0.8125rem;color:var(--text-primary);flex:1;">${esc(s.name)}</span>
            <span style="font-size:0.6875rem;color:var(--text-muted);background:var(--bg-surface);padding:2px 6px;border-radius:4px;">
              ${mod.icon || ''} ${esc(mod.label || s.module)}
            </span>
          </div>`;
        }).join('')}
      </div>
      <div style="padding:8px 12px;font-size:0.75rem;color:var(--text-muted);font-style:italic;">
        Considere revisar ou desativar skills que não estão sendo usadas.
      </div>
    `;
  }
}

/* ─── Helpers: data grouping ─────────────────────────────── */
function groupByDay(logs) {
  const map = {};
  for (const l of logs) {
    const key = l.ts.toISOString().slice(0, 10);
    map[key] = (map[key] || 0) + 1;
  }
  const sorted = Object.entries(map).sort((a,b) => a[0].localeCompare(b[0]));
  return {
    labels: sorted.map(([d]) => formatDateLabel(d)),
    data:   sorted.map(([,v]) => v),
  };
}

function groupTokensByDay(logs) {
  const mapIn = {}, mapOut = {};
  for (const l of logs) {
    const key = l.ts.toISOString().slice(0, 10);
    mapIn[key]  = (mapIn[key] || 0) + (l.inputTokens || 0);
    mapOut[key] = (mapOut[key] || 0) + (l.outputTokens || 0);
  }
  const allDays = [...new Set([...Object.keys(mapIn), ...Object.keys(mapOut)])].sort();
  return {
    labels: allDays.map(d => formatDateLabel(d)),
    dataIn:  allDays.map(d => mapIn[d] || 0),
    dataOut: allDays.map(d => mapOut[d] || 0),
  };
}

function formatDateLabel(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}`;
}

/* ─── Helpers: widget creation ───────────────────────────── */
function createChartWidget(parent, id, title, height) {
  const wrap = document.createElement('div');
  wrap.className = 'card';
  wrap.id = id;
  wrap.style.padding = '16px';
  wrap.innerHTML = `
    <div style="font-weight:600;font-size:0.875rem;color:var(--text-primary);margin-bottom:12px;">${title}</div>
    <div style="height:${height}px;position:relative;">
      <canvas id="canvas-${id}"></canvas>
    </div>
  `;
  parent.appendChild(wrap);
  return wrap;
}

function createInfoWidget(parent, id, title, height) {
  const wrap = document.createElement('div');
  wrap.className = 'card';
  wrap.id = id;
  wrap.style.padding = '16px';
  wrap.innerHTML = `
    <div style="font-weight:600;font-size:0.875rem;color:var(--text-primary);margin-bottom:12px;">${title}</div>
    <div class="widget-body-content" style="min-height:${height - 60}px;"></div>
  `;
  parent.appendChild(wrap);
  return wrap;
}

/* ─── Cleanup ────────────────────────────────────────────── */
function destroyCharts() {
  Object.values(chartInstances).forEach(c => { try { c.destroy(); } catch {} });
  chartInstances = {};
}

export function destroyAiDashboard() {
  destroyCharts();
}
