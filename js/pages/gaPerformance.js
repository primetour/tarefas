/**
 * PRIMETOUR — Performance Google Analytics
 * Lê dados sincronizados da Google Analytics Data API via Firestore
 */

import { store }      from '../store.js';
import { toast }      from '../components/toast.js';
import {
  collection, getDocs, query, orderBy, limit, where, doc, getDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase.js';
import { CWV_LABELS, CATEGORY_COLORS } from '../services/pageSpeed.js';
import {
  fetchSites, createSite, deleteSite, runAuditAndSave,
  fetchLatestRuns, getPsiApiKey,
} from '../services/siteAudits.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num  = v => (v != null ? Number(v).toLocaleString('pt-BR') : '—');
const pct  = v => (v != null ? `${Number(v).toFixed(1)}%` : '—');
const dec  = (v, d=2) => (v != null ? Number(v).toFixed(d).replace('.',',') : '—');
const dur  = secs => {
  if (secs == null) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}m ${s < 10 ? '0' : ''}${s}s`;
};
const fmt  = ts => {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' }).format(d);
};
const fmtShort = ts => {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR', { day:'2-digit', month:'2-digit' }).format(d);
};

/* ─── Config ──────────────────────────────────────────────── */
const PROPERTIES = [
  { id: '',  label: 'Todas as propriedades' },
  // Will be populated from Firestore ga_properties collection
];

const PERIODS = [
  { value: '7',   label: 'Últimos 7 dias'  },
  { value: '14',  label: 'Últimos 14 dias' },
  { value: '28',  label: 'Últimos 28 dias (padrão GA4)' },
  { value: '30',  label: 'Últimos 30 dias' },
  { value: '90',  label: 'Últimos 90 dias' },
  { value: '365', label: 'Último ano'      },
];

const METRICS_COLS = [
  { key: 'date',              label: 'Data',               format: 'date'    },
  { key: 'activeUsers',       label: 'Usuários Ativos',    format: 'number'  },
  { key: 'newUsers',          label: 'Novos Usuários',     format: 'number'  },
  { key: 'sessions',          label: 'Sessões',            format: 'number'  },
  { key: 'screenPageViews',   label: 'Visualizações',      format: 'number'  },
  { key: 'bounceRate',        label: 'Taxa Rejeição',      format: 'percent' },
  { key: 'avgSessionDuration',label: 'Duração Média',      format: 'duration'},
  { key: 'engagedSessions',   label: 'Sessões Engajadas',  format: 'number'  },
  { key: 'engagementRate',    label: 'Taxa Engajamento',   format: 'percent' },
  { key: 'eventsCount',       label: 'Eventos',            format: 'number'  },
  { key: 'conversions',       label: 'Conversões',         format: 'number'  },
];

/* ─── State ───────────────────────────────────────────────── */
let allData      = [];
let allPages     = [];
let allSources   = [];
let allDevices   = [];
let allCountries = [];
let properties   = [];
let filterProp   = '';
let filterDays   = '28';
let sortKey      = 'date';
let sortDir      = -1;
let hiddenRows   = new Set();
let syncMeta     = null;
let periodTotals = null;

// ─── CWV state ────────────────────────────────────────────
let cwvSites        = [];
let cwvSelectedId   = null;
let cwvLatestRuns   = [];  // últimas N runs do site selecionado
let cwvLoaded       = false;  // lazy load no primeiro clique da tab

/* ─── Render page ─────────────────────────────────────────── */
export async function renderGaPerformance(container) {
  if (!store.can('analytics_view') && !store.isMaster()) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
    </div>`;
    return;
  }

  // Load properties from Firestore
  await loadProperties();

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Performance Google Analytics</h1>
        <p class="page-subtitle">Dados de tráfego e comportamento — GA4 Data API</p>
      </div>
      <div class="page-header-actions" style="gap:8px;flex-wrap:wrap;">
        <span id="ga-sync-status" style="font-size:0.75rem;color:var(--text-muted);"></span>
        <button class="btn btn-secondary btn-sm" id="ga-export-xlsx">⬇ XLSX</button>
        <button class="btn btn-secondary btn-sm" id="ga-export-pdf">⬇ PDF</button>
      </div>
    </div>

    <!-- Breakdown tabs -->
    <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;">
      <button class="btn btn-ghost btn-sm ga-tab active" data-tab="daily"
        style="font-size:0.8125rem;">📊 Diário</button>
      <button class="btn btn-ghost btn-sm ga-tab" data-tab="pages"
        style="font-size:0.8125rem;">📄 Páginas</button>
      <button class="btn btn-ghost btn-sm ga-tab" data-tab="sources"
        style="font-size:0.8125rem;">🔗 Origens</button>
      <button class="btn btn-ghost btn-sm ga-tab" data-tab="devices"
        style="font-size:0.8125rem;">📱 Dispositivos</button>
      <button class="btn btn-ghost btn-sm ga-tab" data-tab="countries"
        style="font-size:0.8125rem;">🌍 Países</button>
      <button class="btn btn-ghost btn-sm ga-tab" data-tab="cwv"
        style="font-size:0.8125rem;border-left:2px solid var(--border-subtle);margin-left:4px;padding-left:10px;">
        ⚡ Core Web Vitals + SEO</button>
    </div>

    <!-- ═══ Traffic view (tabs daily/pages/sources/devices/countries) ═══ -->
    <div id="ga-traffic-view">
      <!-- Filters -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;align-items:center;">
        <select class="filter-select" id="ga-prop-filter" style="min-width:200px;">
          ${[{ id:'', label:'Todas as propriedades' }, ...properties]
            .map(p => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('')}
        </select>
        <select class="filter-select" id="ga-period-filter" style="min-width:160px;">
          ${PERIODS.map(p=>`<option value="${p.value}" ${p.value==='28'?'selected':''}>${p.label}</option>`).join('')}
        </select>
        <div style="margin-left:auto;display:flex;align-items:center;gap:8px;">
          <span id="ga-count" style="font-size:0.8125rem;color:var(--text-muted);"></span>
        </div>
      </div>

      <!-- KPI cards -->
      <div id="ga-kpis" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));
        gap:12px;margin-bottom:24px;">
        ${[0,1,2,3,4,5].map(()=>`<div class="card skeleton" style="height:80px;"></div>`).join('')}
      </div>

      <!-- Charts row -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">
        <div class="card" style="padding:20px;">
          <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
            color:var(--text-muted);margin-bottom:12px;">Usuários & Sessões (diário)</div>
          <div style="position:relative;height:220px;">
            <canvas id="ga-chart-users"></canvas>
          </div>
        </div>
        <div class="card" style="padding:20px;">
          <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
            color:var(--text-muted);margin-bottom:12px;">Taxa de Engajamento & Rejeição</div>
          <div style="position:relative;height:220px;">
            <canvas id="ga-chart-rates"></canvas>
          </div>
        </div>
      </div>

      <!-- Data table -->
      <div class="card" style="padding:0;overflow:hidden;">
        <div style="overflow-x:auto;max-height:60vh;overflow-y:auto;">
          <table id="ga-table" style="width:100%;border-collapse:separate;border-spacing:0;font-size:0.8125rem;">
            <thead id="ga-thead"></thead>
            <tbody id="ga-tbody">
              <tr><td colspan="12" style="padding:40px;text-align:center;color:var(--text-muted);">
                Carregando…
              </td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ═══ CWV view ═══ -->
    <div id="ga-cwv-view" style="display:none;"></div>
  `;

  // Event bindings
  document.getElementById('ga-prop-filter')?.addEventListener('change', e => {
    filterProp = e.target.value; loadData();
  });
  document.getElementById('ga-period-filter')?.addEventListener('change', e => {
    filterDays = e.target.value; loadData();
  });
  document.getElementById('ga-export-xlsx')?.addEventListener('click', exportXLSX);
  document.getElementById('ga-export-pdf')?.addEventListener('click', exportPDF);

  // Tab switching
  container.querySelectorAll('.ga-tab').forEach(btn => {
    btn.addEventListener('click', async () => {
      container.querySelectorAll('.ga-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      const trafficView = document.getElementById('ga-traffic-view');
      const cwvView     = document.getElementById('ga-cwv-view');
      if (tab === 'cwv') {
        if (trafficView) trafficView.style.display = 'none';
        if (cwvView)     cwvView.style.display     = '';
        // Lazy load no primeiro clique
        if (!cwvLoaded) {
          cwvLoaded = true;
          await loadCwvData();
        }
        renderCwvView();
      } else {
        if (trafficView) trafficView.style.display = '';
        if (cwvView)     cwvView.style.display     = 'none';
        renderTable(tab);
      }
    });
  });

  await loadData();
}

/* ─── Load properties ─────────────────────────────────────── */
async function loadProperties() {
  try {
    const snap = await getDocs(collection(db, 'ga_properties'));
    properties = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { properties = []; }
}

/* ─── Load from Firestore ─────────────────────────────────── */
async function loadData() {
  const tbody = document.getElementById('ga-tbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="12" style="padding:40px;text-align:center;
    color:var(--text-muted);">Carregando…</td></tr>`;

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - parseInt(filterDays));

    // Load all data collections in parallel
    const [dailySnap, totalsSnap, pagesSnap, sourcesSnap, devicesSnap, countriesSnap, metaSnap] = await Promise.all([
      getDocs(query(collection(db, 'ga_daily'), orderBy('date', 'desc'), limit(500))),
      getDocs(collection(db, 'ga_totals')),
      getDocs(query(collection(db, 'ga_pages'), orderBy('screenPageViews', 'desc'), limit(200))),
      getDocs(query(collection(db, 'ga_sources'), orderBy('sessions', 'desc'), limit(100))),
      getDocs(query(collection(db, 'ga_devices'), orderBy('sessions', 'desc'), limit(50))),
      getDocs(query(collection(db, 'ga_countries'), orderBy('sessions', 'desc'), limit(100))),
      getDoc(doc(db, 'ga_meta', 'lastSync')).catch(() => null),
    ]);

    allData = [];
    dailySnap.forEach(d => {
      const data = { id: d.id, ...d.data() };
      const dt   = data.date?.toDate?.() || (data.date ? new Date(data.date) : null);
      if (dt && dt >= cutoff) {
        if (!filterProp || data.propertyId === filterProp) {
          allData.push({ ...data, _date: dt });
        }
      }
    });

    const SYNCED_PERIODS = ['7d','14d','28d','30d','90d'];
    const filterByPropAndPeriod = docs => {
      let items = docs.map(d => ({ id: d.id, ...d.data() }));
      if (filterProp) items = items.filter(i => i.propertyId === filterProp);
      // Filter by period field (synced per period: 7d, 14d, 28d, 30d, 90d)
      let periodKey = filterDays + 'd';
      // Fallback: if period not synced (e.g. 365d), use 90d
      if (!SYNCED_PERIODS.includes(periodKey)) periodKey = '90d';
      items = items.filter(i => i.period === periodKey);
      return items;
    };

    allPages     = filterByPropAndPeriod(pagesSnap.docs);
    allSources   = filterByPropAndPeriod(sourcesSnap.docs);
    allDevices   = filterByPropAndPeriod(devicesSnap.docs);
    allCountries = filterByPropAndPeriod(countriesSnap.docs);

    // Period totals (deduplicated by GA4)
    const allTotals = totalsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const periodKey = filterDays + 'd';
    periodTotals = allTotals.find(t =>
      t.period === periodKey && (!filterProp || t.propertyId === filterProp)
    ) || null;

    // Sync status
    if (metaSnap?.exists?.()) {
      syncMeta = metaSnap.data();
      const status = document.getElementById('ga-sync-status');
      if (status && syncMeta?.syncedAt) {
        const sd = syncMeta.syncedAt?.toDate?.() || new Date(syncMeta.syncedAt);
        status.textContent = `Sync: ${fmt({ toDate: () => sd })}`;
      }
    }

    renderKpis();
    renderCharts();
    // Re-render the active tab (not always 'daily')
    const activeTab = document.querySelector('.ga-tab.active')?.dataset?.tab || 'daily';
    renderTable(activeTab);

    const count = document.getElementById('ga-count');
    if (count) count.textContent = `${allData.length} dias`;

  } catch(e) {
    console.error('ga-performance load error:', e);
    const tbody = document.getElementById('ga-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="12" style="padding:40px;text-align:center;
      color:var(--text-muted);">Erro: ${esc(e.message)}</td></tr>`;
  }
}

/* ─── KPI cards ───────────────────────────────────────────── */
function renderKpis() {
  const el = document.getElementById('ga-kpis');
  if (!el) return;
  if (!allData.length) { el.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted);">Nenhum dado no período.</div>'; return; }

  // Use period totals (deduplicated by GA4) when available, fallback to daily sums
  const pt = periodTotals;
  const sum = key => allData.reduce((a,r) => a + (Number(r[key])||0), 0);
  const avg = key => {
    const vals = allData.map(r => r[key]).filter(v => v != null && !isNaN(v));
    return vals.length ? vals.reduce((a,b) => a+b, 0) / vals.length : 0;
  };

  const totalUsers     = pt?.totalUsers       ?? pt?.activeUsers ?? sum('activeUsers');
  const totalNewUsers  = pt?.newUsers         ?? sum('newUsers');
  const totalSessions  = pt?.sessions         ?? sum('sessions');
  const totalPageViews = pt?.screenPageViews  ?? sum('screenPageViews');
  const bounceRate     = pt?.bounceRate        ?? avg('bounceRate');
  const avgDuration    = pt?.avgSessionDuration?? avg('avgSessionDuration');
  const engagementRate = pt?.engagementRate    ?? avg('engagementRate');
  const sessPerUser    = pt?.sessionsPerUser   ?? (totalUsers ? totalSessions / totalUsers : 0);
  const pagesPerSess   = pt?.pageViewsPerSession ?? (totalSessions ? totalPageViews / totalSessions : 0);

  const kpis = [
    { label: 'Usuários Ativos',   value: num(totalUsers),
      sub: `${num(totalNewUsers)} novos`,
      info: 'Total de usuários únicos (deduplicados) que acessaram o site no período. Corresponde à métrica "Total users" do GA4. Um mesmo visitante conta uma vez, independente de quantas vezes acessou.' },
    { label: 'Sessões',           value: num(totalSessions),
      sub: `${dec(sessPerUser,1)} por usuário`,
      info: 'Total de sessões iniciadas. Uma sessão começa quando o usuário acessa o site e termina após 30 min de inatividade ou à meia-noite.' },
    { label: 'Visualizações',     value: num(totalPageViews),
      sub: `${dec(pagesPerSess,1)} por sessão`,
      info: 'Número total de páginas ou telas visualizadas. Inclui visualizações repetidas da mesma página.' },
    { label: 'Taxa Rejeição',     value: pct(bounceRate * 100),
      sub: bounceRate > 0.6 ? '⚠ acima do ideal' : '✓ saudável',
      warn: bounceRate > 0.6,
      info: 'Percentual de sessões que NÃO foram engajadas. Uma sessão é considerada rejeitada se durou menos de 10 segundos, não teve conversão e não teve mais de 1 visualização de página. Ideal: abaixo de 50%.' },
    { label: 'Duração Média',     value: dur(avgDuration),
      sub: 'por sessão',
      info: 'Tempo médio que os usuários permanecem no site por sessão. Conta desde o início da sessão até a última interação registrada.' },
    { label: 'Tx. Engajamento',   value: pct(engagementRate * 100),
      sub: engagementRate >= 0.6 ? '✓ bom' : engagementRate >= 0.4 ? '~ regular' : '⚠ baixo',
      info: 'Percentual de sessões engajadas. Uma sessão é engajada se: durou mais de 10 segundos, OU teve 2+ visualizações de página, OU teve pelo menos 1 evento de conversão. É o oposto da taxa de rejeição.' },
  ];

  el.innerHTML = kpis.map(k => `
    <div class="card" style="padding:14px 16px;position:relative;">
      <div style="display:flex;align-items:center;gap:4px;font-size:0.6875rem;color:var(--text-muted);
        text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">
        ${k.label}
        <span class="ga-info-icon" style="display:inline-flex;align-items:center;justify-content:center;
          width:14px;height:14px;border-radius:50%;background:var(--bg-surface);
          border:1px solid var(--border-subtle);font-size:0.5625rem;cursor:help;
          text-transform:none;letter-spacing:0;font-weight:700;color:var(--text-muted);flex-shrink:0;"
          title="${esc(k.info)}">i</span>
      </div>
      <div style="font-size:1.25rem;font-weight:600;color:${k.warn?'#EF4444':'var(--text-primary)'};line-height:1.1;">
        ${k.value}</div>
      <div style="font-size:0.6875rem;color:var(--text-muted);margin-top:4px;">${k.sub}</div>
    </div>
  `).join('');
}

/* ─── Charts ─────────────────────────────────────────────── */
async function renderCharts() {
  // Load Chart.js if not present
  if (!window.Chart) {
    try {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    } catch { return; }
  }

  const sorted = [...allData].sort((a,b) => a._date - b._date);
  const labels = sorted.map(r => fmtShort(r._date));

  // Users & Sessions chart
  const ctx1 = document.getElementById('ga-chart-users')?.getContext('2d');
  if (ctx1) {
    // Destroy existing chart
    const existing1 = Chart.getChart('ga-chart-users');
    if (existing1) existing1.destroy();

    new Chart(ctx1, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Usuários Ativos',
            data: sorted.map(r => r.activeUsers || 0),
            borderColor: '#38BDF8',
            backgroundColor: '#38BDF820',
            fill: true, tension: 0.3, pointRadius: 2,
          },
          {
            label: 'Sessões',
            data: sorted.map(r => r.sessions || 0),
            borderColor: '#A78BFA',
            backgroundColor: '#A78BFA20',
            fill: true, tension: 0.3, pointRadius: 2,
          },
          {
            label: 'Novos Usuários',
            data: sorted.map(r => r.newUsers || 0),
            borderColor: '#34D399',
            backgroundColor: '#34D39920',
            fill: false, tension: 0.3, pointRadius: 1, borderDash: [4,4],
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        resizeDelay: 100,
        animation: { duration: 400 },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 15 } },
          y: { beginAtZero: true, ticks: { font: { size: 10 } } },
        },
      },
    });
  }

  // Engagement & Bounce chart
  const ctx2 = document.getElementById('ga-chart-rates')?.getContext('2d');
  if (ctx2) {
    const existing2 = Chart.getChart('ga-chart-rates');
    if (existing2) existing2.destroy();

    new Chart(ctx2, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Tx. Engajamento (%)',
            data: sorted.map(r => r.engagementRate != null ? (r.engagementRate * 100).toFixed(1) : null),
            borderColor: '#22C55E',
            backgroundColor: '#22C55E20',
            fill: true, tension: 0.3, pointRadius: 2,
          },
          {
            label: 'Tx. Rejeição (%)',
            data: sorted.map(r => r.bounceRate != null ? (r.bounceRate * 100).toFixed(1) : null),
            borderColor: '#EF4444',
            backgroundColor: '#EF444420',
            fill: true, tension: 0.3, pointRadius: 2,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        resizeDelay: 100,
        animation: { duration: 400 },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 15 } },
          y: { beginAtZero: true, max: 100, ticks: { font: { size: 10 }, callback: v => v+'%' } },
        },
      },
    });
  }
}

/* ─── Column info helper ─────────────────────────────────── */
function thInfo(label, tip) {
  if (!tip) return label;
  return `${label} <span style="display:inline-flex;align-items:center;justify-content:center;
    width:13px;height:13px;border-radius:50%;background:var(--bg-card);
    border:1px solid var(--border-subtle);font-size:0.5rem;cursor:help;
    text-transform:none;letter-spacing:0;font-weight:700;vertical-align:middle;"
    title="${esc(tip)}">i</span>`;
}

/* ─── Tab-based table rendering ──────────────────────────── */
function renderTable(tab = 'daily') {
  const thead = document.getElementById('ga-thead');
  const tbody = document.getElementById('ga-tbody');
  if (!thead || !tbody) return;

  const thStyle = `padding:10px 12px;font-size:0.6875rem;font-weight:600;text-transform:uppercase;
    letter-spacing:.05em;white-space:nowrap;border-bottom:1px solid var(--border-subtle);
    color:var(--text-muted);cursor:pointer;`;

  if (tab === 'daily')    renderDailyTable(thead, tbody, thStyle);
  if (tab === 'pages')    renderPagesTable(thead, tbody, thStyle);
  if (tab === 'sources')  renderSourcesTable(thead, tbody, thStyle);
  if (tab === 'devices')  renderDevicesTable(thead, tbody, thStyle);
  if (tab === 'countries') renderCountriesTable(thead, tbody, thStyle);
}

function renderDailyTable(thead, tbody, thStyle) {
  const sorted = [...allData].sort((a,b) => b._date - a._date);

  thead.innerHTML = `<tr style="background:var(--bg-surface);">
    <th style="${thStyle}">Data</th>
    <th style="${thStyle}">Usuários</th>
    <th style="${thStyle}">Novos</th>
    <th style="${thStyle}">Sessões</th>
    <th style="${thStyle}">Visualizações</th>
    <th style="${thStyle}">Tx. Rejeição</th>
    <th style="${thStyle}">Duração</th>
    <th style="${thStyle}">Engajamento</th>
    <th style="${thStyle}">Eventos</th>
    <th style="${thStyle}">Conversões</th>
  </tr>`;

  if (!sorted.length) {
    tbody.innerHTML = emptyRow(10); return;
  }

  tbody.innerHTML = sorted.map(r => `
    <tr style="border-bottom:1px solid var(--border-subtle);transition:background .1s;"
      onmouseover="this.style.background='var(--bg-surface)'"
      onmouseout="this.style.background=''">
      <td style="padding:8px 12px;white-space:nowrap;color:var(--text-muted);font-size:0.75rem;">
        ${fmt(r._date)}</td>
      <td style="padding:8px 12px;text-align:right;font-weight:600;">${num(r.activeUsers)}</td>
      <td style="padding:8px 12px;text-align:right;color:var(--text-muted);">${num(r.newUsers)}</td>
      <td style="padding:8px 12px;text-align:right;">${num(r.sessions)}</td>
      <td style="padding:8px 12px;text-align:right;">${num(r.screenPageViews)}</td>
      <td style="padding:8px 12px;text-align:right;${bounceColor(r.bounceRate)}">${pct((r.bounceRate||0)*100)}</td>
      <td style="padding:8px 12px;text-align:right;color:var(--text-muted);">${dur(r.avgSessionDuration)}</td>
      <td style="padding:8px 12px;text-align:right;${engColor(r.engagementRate)}">${pct((r.engagementRate||0)*100)}</td>
      <td style="padding:8px 12px;text-align:right;color:var(--text-muted);">${num(r.eventsCount)}</td>
      <td style="padding:8px 12px;text-align:right;font-weight:600;color:var(--brand-gold);">${num(r.conversions)}</td>
    </tr>
  `).join('');
}

function renderPagesTable(thead, tbody, thStyle) {
  thead.innerHTML = `<tr style="background:var(--bg-surface);">
    <th style="${thStyle}">Página</th>
    <th style="${thStyle}">${thInfo('Visualizações', 'Total de vezes que a página foi carregada. Inclui recarregamentos.')}</th>
    <th style="${thStyle}">${thInfo('Usuários', 'Usuários únicos que visitaram esta página no período selecionado.')}</th>
    <th style="${thStyle}">${thInfo('Duração Média', 'Tempo médio de permanência nesta página por sessão.')}</th>
    <th style="${thStyle}">${thInfo('Taxa Rejeição', 'Percentual de sessões que começaram nesta página e não foram engajadas (< 10s, sem conversão, 1 page view).')}</th>
    <th style="${thStyle}">${thInfo('Engajamento', 'Percentual de sessões engajadas que incluíram esta página.')}</th>
  </tr>`;

  if (!allPages.length) { tbody.innerHTML = emptyRow(6); return; }

  tbody.innerHTML = allPages.slice(0,50).map((r,i) => `
    <tr style="border-bottom:1px solid var(--border-subtle);"
      onmouseover="this.style.background='var(--bg-surface)'"
      onmouseout="this.style.background=''">
      <td style="padding:8px 12px;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
        title="${esc(r.pagePath||r.pageTitle||'')}">
        <span style="color:var(--text-muted);font-size:0.75rem;margin-right:6px;">${i+1}</span>
        ${esc(r.pageTitle || r.pagePath || '—')}</td>
      <td style="padding:8px 12px;text-align:right;font-weight:600;">${num(r.screenPageViews)}</td>
      <td style="padding:8px 12px;text-align:right;">${num(r.activeUsers)}</td>
      <td style="padding:8px 12px;text-align:right;color:var(--text-muted);">${dur(r.avgSessionDuration)}</td>
      <td style="padding:8px 12px;text-align:right;${bounceColor(r.bounceRate)}">${pct((r.bounceRate||0)*100)}</td>
      <td style="padding:8px 12px;text-align:right;${engColor(r.engagementRate)}">${pct((r.engagementRate||0)*100)}</td>
    </tr>
  `).join('');
}

function renderSourcesTable(thead, tbody, thStyle) {
  thead.innerHTML = `<tr style="background:var(--bg-surface);">
    <th style="${thStyle}">${thInfo('Origem / Mídia', 'De onde vieram os visitantes. Origem = site/plataforma (google, facebook). Mídia = tipo de tráfego (organic, cpc, referral, email).')}</th>
    <th style="${thStyle}">Sessões</th>
    <th style="${thStyle}">Usuários</th>
    <th style="${thStyle}">Novos Usuários</th>
    <th style="${thStyle}">${thInfo('Taxa Rejeição', 'Sessões não engajadas desta origem.')}</th>
    <th style="${thStyle}">${thInfo('Engajamento', 'Sessões engajadas (> 10s ou 2+ páginas ou conversão).')}</th>
    <th style="${thStyle}">${thInfo('Conversões', 'Eventos marcados como conversão no GA4 vindos desta origem.')}</th>
  </tr>`;

  if (!allSources.length) { tbody.innerHTML = emptyRow(7); return; }

  const total = allSources.reduce((a,r) => a + (r.sessions||0), 0) || 1;
  tbody.innerHTML = allSources.slice(0,30).map(r => {
    const p = ((r.sessions||0) / total * 100).toFixed(1);
    return `
    <tr style="border-bottom:1px solid var(--border-subtle);"
      onmouseover="this.style.background='var(--bg-surface)'"
      onmouseout="this.style.background=''">
      <td style="padding:8px 12px;">
        <div style="font-weight:500;">${esc(r.source || '(direto)')}</div>
        <div style="font-size:0.6875rem;color:var(--text-muted);">${esc(r.medium || '(none)')} · ${p}%</div>
      </td>
      <td style="padding:8px 12px;text-align:right;font-weight:600;">${num(r.sessions)}</td>
      <td style="padding:8px 12px;text-align:right;">${num(r.activeUsers)}</td>
      <td style="padding:8px 12px;text-align:right;color:var(--text-muted);">${num(r.newUsers)}</td>
      <td style="padding:8px 12px;text-align:right;${bounceColor(r.bounceRate)}">${pct((r.bounceRate||0)*100)}</td>
      <td style="padding:8px 12px;text-align:right;${engColor(r.engagementRate)}">${pct((r.engagementRate||0)*100)}</td>
      <td style="padding:8px 12px;text-align:right;font-weight:600;color:var(--brand-gold);">${num(r.conversions)}</td>
    </tr>`;
  }).join('');
}

function renderDevicesTable(thead, tbody, thStyle) {
  thead.innerHTML = `<tr style="background:var(--bg-surface);">
    <th style="${thStyle}">${thInfo('Dispositivo', 'Categoria do dispositivo usado: desktop (computador), mobile (celular) ou tablet.')}</th>
    <th style="${thStyle}">Sessões</th>
    <th style="${thStyle}">Usuários</th>
    <th style="${thStyle}">% do Total</th>
    <th style="${thStyle}">${thInfo('Taxa Rejeição', 'Sessões não engajadas por tipo de dispositivo.')}</th>
    <th style="${thStyle}">Duração Média</th>
  </tr>`;

  if (!allDevices.length) { tbody.innerHTML = emptyRow(6); return; }

  const DEVICE_ICONS = { desktop:'🖥', mobile:'📱', tablet:'📟' };
  const total = allDevices.reduce((a,r) => a + (r.sessions||0), 0) || 1;

  tbody.innerHTML = allDevices.map(r => {
    const p = ((r.sessions||0) / total * 100);
    return `
    <tr style="border-bottom:1px solid var(--border-subtle);"
      onmouseover="this.style.background='var(--bg-surface)'"
      onmouseout="this.style.background=''">
      <td style="padding:8px 12px;font-weight:500;">
        ${DEVICE_ICONS[r.deviceCategory] || '❓'} ${esc(r.deviceCategory || '—')}</td>
      <td style="padding:8px 12px;text-align:right;font-weight:600;">${num(r.sessions)}</td>
      <td style="padding:8px 12px;text-align:right;">${num(r.activeUsers)}</td>
      <td style="padding:8px 12px;text-align:right;">
        <div style="display:flex;align-items:center;gap:8px;justify-content:flex-end;">
          <div style="width:80px;background:var(--bg-surface);border-radius:20px;height:5px;">
            <div style="height:100%;background:var(--brand-gold);width:${p}%;border-radius:20px;"></div>
          </div>
          <span style="min-width:36px;">${p.toFixed(1)}%</span>
        </div>
      </td>
      <td style="padding:8px 12px;text-align:right;${bounceColor(r.bounceRate)}">${pct((r.bounceRate||0)*100)}</td>
      <td style="padding:8px 12px;text-align:right;color:var(--text-muted);">${dur(r.avgSessionDuration)}</td>
    </tr>`;
  }).join('');
}

function renderCountriesTable(thead, tbody, thStyle) {
  thead.innerHTML = `<tr style="background:var(--bg-surface);">
    <th style="${thStyle}">País</th>
    <th style="${thStyle}">Cidade</th>
    <th style="${thStyle}">Sessões</th>
    <th style="${thStyle}">Usuários</th>
    <th style="${thStyle}">% do Total</th>
    <th style="${thStyle}">${thInfo('Engajamento', 'Percentual de sessões engajadas vindas deste local.')}</th>
  </tr>`;

  if (!allCountries.length) { tbody.innerHTML = emptyRow(6); return; }

  const total = allCountries.reduce((a,r) => a + (r.sessions||0), 0) || 1;
  tbody.innerHTML = allCountries.slice(0,40).map(r => {
    const p = ((r.sessions||0) / total * 100);
    return `
    <tr style="border-bottom:1px solid var(--border-subtle);"
      onmouseover="this.style.background='var(--bg-surface)'"
      onmouseout="this.style.background=''">
      <td style="padding:8px 12px;font-weight:500;">${esc(r.country || '—')}</td>
      <td style="padding:8px 12px;color:var(--text-muted);">${esc(r.city || '—')}</td>
      <td style="padding:8px 12px;text-align:right;font-weight:600;">${num(r.sessions)}</td>
      <td style="padding:8px 12px;text-align:right;">${num(r.activeUsers)}</td>
      <td style="padding:8px 12px;text-align:right;">${p.toFixed(1)}%</td>
      <td style="padding:8px 12px;text-align:right;${engColor(r.engagementRate)}">${pct((r.engagementRate||0)*100)}</td>
    </tr>`;
  }).join('');
}

/* ─── Helpers ─────────────────────────────────────────────── */
function emptyRow(cols) {
  return `<tr><td colspan="${cols}" style="padding:48px;text-align:center;
    color:var(--text-muted);">Nenhum dado encontrado para o período.</td></tr>`;
}

function bounceColor(v) {
  if (v == null) return '';
  const pctVal = v * 100;
  if (pctVal > 60) return 'color:#EF4444;font-weight:600;';
  if (pctVal > 40) return 'color:#F59E0B;font-weight:600;';
  return 'color:#22C55E;font-weight:600;';
}

function engColor(v) {
  if (v == null) return '';
  const pctVal = v * 100;
  if (pctVal >= 60) return 'color:#22C55E;font-weight:600;';
  if (pctVal >= 40) return 'color:#F59E0B;font-weight:600;';
  return 'color:#EF4444;';
}

/* ─── Export XLSX ─────────────────────────────────────────── */
async function exportXLSX() {
  const btn = document.getElementById('ga-export-xlsx');
  if (btn) { btn.disabled=true; btn.textContent='…'; }
  try {
    if (!window.XLSX) {
      await new Promise((res,rej) => {
        const s = document.createElement('script');
        s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload=res; s.onerror=rej; document.head.appendChild(s);
      });
    }

    const sorted = [...allData].sort((a,b) => b._date - a._date);
    const headers = ['Data','Usuários Ativos','Novos Usuários','Sessões','Visualizações',
      'Taxa Rejeição','Duração Média (s)','Sessões Engajadas','Taxa Engajamento','Eventos','Conversões'];
    const data = sorted.map(r => [
      fmt(r._date), r.activeUsers, r.newUsers, r.sessions, r.screenPageViews,
      r.bounceRate, r.avgSessionDuration, r.engagedSessions, r.engagementRate,
      r.eventsCount, r.conversions,
    ]);

    const wb = window.XLSX.utils.book_new();

    // Daily sheet
    const ws1 = window.XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws1['!cols'] = headers.map((_,i) => ({ wch: i===0?14:16 }));
    window.XLSX.utils.book_append_sheet(wb, ws1, 'Diário');

    // Pages sheet
    if (allPages.length) {
      const ws2 = window.XLSX.utils.aoa_to_sheet([
        ['Página','Caminho','Visualizações','Usuários','Duração','Rejeição','Engajamento'],
        ...allPages.map(r => [r.pageTitle, r.pagePath, r.screenPageViews, r.activeUsers,
          r.avgSessionDuration, r.bounceRate, r.engagementRate]),
      ]);
      window.XLSX.utils.book_append_sheet(wb, ws2, 'Páginas');
    }

    // Sources sheet
    if (allSources.length) {
      const ws3 = window.XLSX.utils.aoa_to_sheet([
        ['Origem','Mídia','Sessões','Usuários','Novos','Rejeição','Engajamento','Conversões'],
        ...allSources.map(r => [r.source, r.medium, r.sessions, r.activeUsers, r.newUsers,
          r.bounceRate, r.engagementRate, r.conversions]),
      ]);
      window.XLSX.utils.book_append_sheet(wb, ws3, 'Origens');
    }

    window.XLSX.writeFile(wb, `primetour_ga_${new Date().toISOString().slice(0,10)}.xlsx`);
    toast.success(`${sorted.length} dias exportados.`);
  } catch(e) { toast.error('Erro XLSX: '+e.message); }
  finally { if(btn){btn.disabled=false;btn.textContent='⬇ XLSX';} }
}

/* ─── Export PDF ──────────────────────────────────────────── */
async function exportPDF() {
  const btn = document.getElementById('ga-export-pdf');
  if (btn) { btn.disabled=true; btn.textContent='…'; }
  try {
    if (!window.jspdf) {
      await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'; s.onload=res;s.onerror=rej;document.head.appendChild(s); });
      await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.1/jspdf.plugin.autotable.min.js'; s.onload=res;s.onerror=rej;document.head.appendChild(s); });
    }

    const sorted = [...allData].sort((a,b) => b._date - a._date);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' });
    const W   = doc.internal.pageSize.getWidth();
    const H   = doc.internal.pageSize.getHeight();
    const date = new Date().toLocaleDateString('pt-BR');
    const prop = filterProp ? (properties.find(p=>p.id===filterProp)?.label || filterProp) : 'Todas as propriedades';

    // ── Header ──
    doc.setFillColor(212,168,67);
    doc.rect(0, 0, W, 3, 'F');
    doc.setFillColor(36,35,98);
    doc.rect(0, 3, W, 20, 'F');
    doc.setFontSize(14); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
    doc.text('PRIMETOUR', 14, 14);
    doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(212,168,67);
    doc.text('Performance Google Analytics', 14, 19);
    doc.setTextColor(200,200,200);
    doc.text(`${prop}  ·  ${date}  ·  ${sorted.length} dias`, W-14, 19, {align:'right'});

    // ── KPIs ──
    const pt = periodTotals;
    const sum = key => allData.reduce((a,r) => a+(Number(r[key])||0), 0);
    const avg = key => { const vals=allData.map(r=>r[key]).filter(v=>v!=null&&!isNaN(v)); return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0; };
    const kpis = [
      { label:'Usuários',     value:num(pt?.totalUsers ?? pt?.activeUsers ?? sum('activeUsers')), color:[56,189,248]  },
      { label:'Sessões',      value:num(pt?.sessions ?? sum('sessions')),                      color:[167,139,250] },
      { label:'Visualizações',value:num(pt?.screenPageViews ?? sum('screenPageViews')),         color:[34,197,94]   },
      { label:'Tx. Rejeição', value:pct((pt?.bounceRate ?? avg('bounceRate'))*100),             color:[239,68,68]   },
      { label:'Duração',      value:dur(pt?.avgSessionDuration ?? avg('avgSessionDuration')),   color:[212,168,67]  },
      { label:'Engajamento',  value:pct((pt?.engagementRate ?? avg('engagementRate'))*100),     color:[56,189,248]  },
    ];
    let y = 28;
    const kpiW = (W - 28 - (kpis.length-1)*3) / kpis.length;
    kpis.forEach((k,i) => {
      const x = 14 + i*(kpiW+3);
      doc.setFillColor(...k.color);
      doc.roundedRect(x, y, kpiW, 16, 2, 2, 'F');
      doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
      doc.text(k.value, x+kpiW/2, y+7, {align:'center'});
      doc.setFontSize(5.5); doc.setFont('helvetica','normal');
      doc.text(k.label, x+kpiW/2, y+12.5, {align:'center'});
    });
    y += 22;

    // ── Chart capture ──
    const chartCanvas = document.getElementById('ga-chart-users');
    if (chartCanvas) {
      try {
        const imgData = chartCanvas.toDataURL('image/png');
        const cw = W - 28;
        const ch = cw * 0.35;
        doc.addImage(imgData, 'PNG', 14, y, cw, ch);
        y += ch + 6;
      } catch {}
    }

    // ── Daily table ──
    const head = [['Data','Usuários','Novos','Sessões','Views','Rejeição','Duração','Engajamento','Eventos','Conversões']];
    const body = sorted.map(r => [
      fmt(r._date), num(r.activeUsers), num(r.newUsers), num(r.sessions),
      num(r.screenPageViews), pct((r.bounceRate||0)*100), dur(r.avgSessionDuration),
      pct((r.engagementRate||0)*100), num(r.eventsCount), num(r.conversions),
    ]);

    doc.autoTable({
      head, body, startY: y,
      styles: { fontSize:7, cellPadding:2.5, overflow:'linebreak' },
      headStyles: { fillColor:[36,35,98], textColor:255, fontStyle:'bold', fontSize:6.5 },
      alternateRowStyles: { fillColor:[248,247,244] },
      didParseCell: (data) => {
        if (data.section === 'body') {
          if (data.column.index === 5) { // bounce
            const val = parseFloat(String(data.cell.raw).replace('%','').replace(',','.'));
            if (!isNaN(val)) {
              data.cell.styles.textColor = val > 60 ? [239,68,68] : val > 40 ? [212,168,67] : [34,197,94];
              data.cell.styles.fontStyle = 'bold';
            }
          }
          if (data.column.index === 7) { // engagement
            const val = parseFloat(String(data.cell.raw).replace('%','').replace(',','.'));
            if (!isNaN(val)) {
              data.cell.styles.textColor = val >= 60 ? [34,197,94] : val >= 40 ? [212,168,67] : [239,68,68];
              data.cell.styles.fontStyle = 'bold';
            }
          }
        }
      },
    });

    // ── Footer ──
    const pageCount = doc.internal.getNumberOfPages();
    for (let i=1;i<=pageCount;i++) {
      doc.setPage(i);
      const pH = doc.internal.pageSize.getHeight();
      doc.setFillColor(36,35,98);
      doc.rect(0, pH-7, W, 7, 'F');
      doc.setFontSize(6); doc.setFont('helvetica','normal'); doc.setTextColor(180,180,180);
      doc.text('PRIMETOUR — Google Analytics', 14, pH-2.5);
      doc.text(`Página ${i}/${pageCount}`, W-14, pH-2.5, {align:'right'});
    }

    doc.save(`primetour_ga_${new Date().toISOString().slice(0,10)}.pdf`);
    toast.success(`PDF gerado com ${sorted.length} dias.`);
  } catch(e) { toast.error('Erro PDF: '+e.message); }
  finally { if(btn){btn.disabled=false;btn.textContent='⬇ PDF';} }
}

/* ══════════════════════════════════════════════════════════
   CORE WEB VITALS + SEO (PageSpeed Insights API)
   ══════════════════════════════════════════════════════════ */

async function loadCwvData() {
  try {
    cwvSites = await fetchSites();
    if (!cwvSelectedId && cwvSites.length) cwvSelectedId = cwvSites[0].id;
    if (cwvSelectedId) {
      cwvLatestRuns = await fetchLatestRuns(cwvSelectedId, 10);
    } else {
      cwvLatestRuns = [];
    }
  } catch (e) {
    console.warn('[CWV] load error:', e);
    toast.error('Erro ao carregar auditorias: ' + e.message);
  }
}

function renderCwvView() {
  const root = document.getElementById('ga-cwv-view');
  if (!root) return;
  const canManage = store.can('site_audit_manage') || store.isMaster();
  const selected  = cwvSites.find(s => s.id === cwvSelectedId);
  const latest    = cwvLatestRuns[0];

  root.innerHTML = `
    <!-- Header + seletor de site + ações -->
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:20px;">
      <select class="filter-select" id="cwv-site-select" style="min-width:240px;">
        ${cwvSites.length
          ? cwvSites.map(s => `<option value="${esc(s.id)}" ${s.id===cwvSelectedId?'selected':''}>
              ${esc(s.label)}
            </option>`).join('')
          : `<option value="">— Nenhum site cadastrado —</option>`}
      </select>
      ${canManage ? `
        <button class="btn btn-secondary btn-sm" id="cwv-add-site">+ Cadastrar site</button>
        <button class="btn btn-primary btn-sm" id="cwv-run-now" ${!selected ? 'disabled' : ''}>
          ▶ Executar auditoria agora
        </button>
        ${selected ? `<button class="btn btn-ghost btn-sm" id="cwv-delete-site"
          style="color:var(--color-danger);" title="Remover site e histórico">🗑</button>` : ''}
      ` : ''}
      <div style="margin-left:auto;font-size:0.75rem;color:var(--text-muted);">
        ${latest ? `Última auditoria: ${fmtDateTime(latest.runAt)}` : 'Sem auditorias'}
      </div>
    </div>

    ${cwvSites.length === 0 ? renderCwvEmptyState(canManage) : ''}
    ${cwvSites.length > 0 && !latest ? renderCwvNoRunsState(canManage) : ''}
    ${latest ? renderCwvResults(latest, cwvLatestRuns) : ''}
  `;

  attachCwvEvents();
}

function renderCwvEmptyState(canManage) {
  return `
    <div class="card" style="padding:40px;text-align:center;">
      <div style="font-size:2rem;margin-bottom:8px;">⚡</div>
      <div style="font-size:1.0625rem;font-weight:600;margin-bottom:6px;">Nenhum site cadastrado ainda</div>
      <div style="font-size:0.8125rem;color:var(--text-muted);max-width:420px;margin:0 auto 16px;">
        Cadastre um site para começar a medir Core Web Vitals (LCP, INP, CLS) e SEO
        via PageSpeed Insights API.
      </div>
      ${canManage ? `<button class="btn btn-primary btn-sm" id="cwv-add-site-empty">+ Cadastrar primeiro site</button>` : `
        <div style="font-size:0.75rem;color:var(--text-muted);">Seu perfil não tem permissão para cadastrar sites.</div>
      `}
    </div>
  `;
}

function renderCwvNoRunsState(canManage) {
  return `
    <div class="card" style="padding:32px;text-align:center;">
      <div style="font-size:0.9375rem;font-weight:600;margin-bottom:6px;">Nenhuma auditoria executada</div>
      <div style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:14px;">
        ${canManage ? 'Clique em "Executar auditoria agora" para gerar a primeira medição.' : 'Aguarde um administrador executar a primeira auditoria.'}
      </div>
    </div>
  `;
}

function renderCwvResults(latest, allRuns) {
  return `
    <!-- Mobile + Desktop lado a lado -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
      ${renderCwvStrategyCard('mobile',  '📱 Mobile',  latest.mobile)}
      ${renderCwvStrategyCard('desktop', '🖥 Desktop', latest.desktop)}
    </div>

    <!-- SEO audits (falhas) -->
    ${renderSeoFailsCard(latest.mobile, latest.desktop)}

    <!-- Histórico -->
    ${allRuns.length > 1 ? renderCwvHistory(allRuns) : ''}
  `;
}

function renderCwvStrategyCard(key, title, data) {
  if (!data) {
    return `<div class="card" style="padding:20px;">
      <div style="font-size:0.75rem;color:var(--text-muted);">${title} — sem dados</div>
    </div>`;
  }
  const scores = data.scores || {};
  const cwv    = data.cwv    || {};
  const source = data.cwvSource || 'lab';
  return `
    <div class="card" style="padding:20px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div style="font-size:0.9375rem;font-weight:600;">${title}</div>
        <div style="font-size:0.625rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.07em;"
          title="${source==='field'?'Dados reais de usuários Chrome (CrUX)':'Simulação Lighthouse (lab)'}">
          ${source==='field' ? '● Field data (CrUX)' : '○ Lab data (Lighthouse)'}
        </div>
      </div>

      <!-- Scores 0-100 -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px;">
        ${scoreCircle('Performance',   scores.performance)}
        ${scoreCircle('Acessib.',      scores.accessibility)}
        ${scoreCircle('Boas Práticas', scores.bestPractices)}
        ${scoreCircle('SEO',           scores.seo)}
      </div>

      <!-- CWV metrics -->
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${['lcp','inp','cls','fcp','ttfb'].map(k => cwvBadge(k, cwv[k])).join('')}
      </div>
    </div>
  `;
}

function scoreCircle(label, score) {
  const color = score == null ? '#9CA3AF'
    : score >= 90 ? '#22C55E'
    : score >= 50 ? '#F59E0B'
    : '#EF4444';
  const display = score == null ? '—' : score;
  return `
    <div style="text-align:center;">
      <div style="width:52px;height:52px;border-radius:50%;margin:0 auto 6px;
        border:3px solid ${color};display:flex;align-items:center;justify-content:center;
        font-size:0.9375rem;font-weight:700;color:${color};">
        ${display}
      </div>
      <div style="font-size:0.625rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;">
        ${label}
      </div>
    </div>
  `;
}

function cwvBadge(key, metric) {
  const meta = CWV_LABELS[key];
  if (!meta) return '';
  const value = metric?.value;
  const cat   = metric?.category;
  const color = CATEGORY_COLORS[cat] || '#9CA3AF';
  const display = value == null ? '—'
    : key === 'cls' ? Number(value).toFixed(3).replace('.', ',')
    : `${Math.round(value)}${meta.unit}`;
  const catLabel = cat === 'FAST' ? 'Bom'
    : cat === 'AVERAGE' || cat === 'NEEDS_IMPROVEMENT' ? 'Precisa melhorar'
    : cat === 'SLOW' ? 'Ruim' : '—';
  return `
    <div style="display:flex;align-items:center;gap:10px;padding:7px 10px;
      background:var(--bg-surface);border-radius:var(--radius-md);
      border-left:3px solid ${color};">
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.75rem;font-weight:600;" title="${esc(meta.info)}">
          ${meta.label} <span style="color:var(--text-muted);font-weight:400;font-size:0.6875rem;">
          ${meta.full}</span>
        </div>
      </div>
      <div style="font-size:0.8125rem;font-weight:700;color:${color};min-width:64px;text-align:right;">
        ${display}
      </div>
      <div style="font-size:0.625rem;text-transform:uppercase;color:${color};min-width:80px;text-align:right;">
        ${catLabel}
      </div>
    </div>
  `;
}

function renderSeoFailsCard(mobile, desktop) {
  // Une falhas únicas das duas estratégias (o SEO check é o mesmo, mas por segurança)
  const map = new Map();
  for (const src of [mobile, desktop]) {
    if (!src?.seoFails) continue;
    for (const f of src.seoFails) {
      if (!map.has(f.id)) map.set(f.id, f);
    }
  }
  const fails = [...map.values()];
  if (!fails.length) {
    return `
      <div class="card" style="padding:20px;margin-bottom:20px;border-left:3px solid #22C55E;">
        <div style="font-size:0.9375rem;font-weight:600;color:#22C55E;">
          ✓ Todas as verificações SEO passaram
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
          Lighthouse não encontrou problemas de SEO nesta auditoria.
        </div>
      </div>
    `;
  }
  return `
    <div class="card" style="padding:20px;margin-bottom:20px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div style="font-size:0.9375rem;font-weight:600;">⚠ Problemas de SEO detectados (${fails.length})</div>
        <div style="font-size:0.625rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.07em;">
          Lighthouse audits
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${fails.map(f => `
          <div style="padding:10px 12px;background:var(--bg-surface);border-radius:var(--radius-md);
            border-left:3px solid #F59E0B;">
            <div style="font-size:0.8125rem;font-weight:600;margin-bottom:2px;">${esc(f.title)}</div>
            ${f.displayValue ? `<div style="font-size:0.6875rem;color:#F59E0B;margin-bottom:2px;">${esc(f.displayValue)}</div>` : ''}
            <div style="font-size:0.6875rem;color:var(--text-muted);line-height:1.45;">${esc(stripMarkdown(f.description))}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderCwvHistory(runs) {
  // Mini timeline dos últimos runs: score de performance (mobile) + INP
  const sorted = [...runs].reverse(); // mais antigos primeiro
  const rows = sorted.map(r => {
    const dt = r.runAt?.toDate ? r.runAt.toDate() : new Date(r.runAt);
    return {
      date:    dt,
      perfMob: r.mobile?.scores?.performance ?? null,
      perfDesk:r.desktop?.scores?.performance ?? null,
      seoMob:  r.mobile?.scores?.seo ?? null,
      lcpMob:  r.mobile?.cwv?.lcp?.value ?? null,
      inpMob:  r.mobile?.cwv?.inp?.value ?? null,
      clsMob:  r.mobile?.cwv?.cls?.value ?? null,
    };
  });
  return `
    <div class="card" style="padding:20px;">
      <div style="font-size:0.9375rem;font-weight:600;margin-bottom:12px;">
        Histórico das últimas ${runs.length} auditorias
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;font-size:0.75rem;border-collapse:collapse;">
          <thead>
            <tr style="color:var(--text-muted);font-size:0.625rem;text-transform:uppercase;letter-spacing:.05em;">
              <th style="text-align:left;padding:6px 8px;">Data</th>
              <th style="text-align:right;padding:6px 8px;">Perf. 📱</th>
              <th style="text-align:right;padding:6px 8px;">Perf. 🖥</th>
              <th style="text-align:right;padding:6px 8px;">SEO 📱</th>
              <th style="text-align:right;padding:6px 8px;">LCP</th>
              <th style="text-align:right;padding:6px 8px;">INP</th>
              <th style="text-align:right;padding:6px 8px;">CLS</th>
            </tr>
          </thead>
          <tbody>
            ${rows.reverse().map(r => `
              <tr style="border-top:1px solid var(--border-subtle);">
                <td style="padding:6px 8px;color:var(--text-muted);">${fmtDateTime(r.date)}</td>
                <td style="padding:6px 8px;text-align:right;${scoreTextColor(r.perfMob)}">${r.perfMob ?? '—'}</td>
                <td style="padding:6px 8px;text-align:right;${scoreTextColor(r.perfDesk)}">${r.perfDesk ?? '—'}</td>
                <td style="padding:6px 8px;text-align:right;${scoreTextColor(r.seoMob)}">${r.seoMob ?? '—'}</td>
                <td style="padding:6px 8px;text-align:right;">${r.lcpMob != null ? Math.round(r.lcpMob)+'ms' : '—'}</td>
                <td style="padding:6px 8px;text-align:right;">${r.inpMob != null ? Math.round(r.inpMob)+'ms' : '—'}</td>
                <td style="padding:6px 8px;text-align:right;">${r.clsMob != null ? Number(r.clsMob).toFixed(3).replace('.',',') : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function scoreTextColor(score) {
  if (score == null) return 'color:var(--text-muted);';
  if (score >= 90)   return 'color:#22C55E;font-weight:600;';
  if (score >= 50)   return 'color:#F59E0B;font-weight:600;';
  return 'color:#EF4444;font-weight:600;';
}

function stripMarkdown(str) {
  if (!str) return '';
  // Remove [text](url) → text, backticks, **bold**
  return String(str)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .trim();
}

function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  if (!d || isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit',
  }).format(d);
}

/* ─── Eventos da CWV view ────────────────────────────────── */
function attachCwvEvents() {
  const root = document.getElementById('ga-cwv-view');
  if (!root) return;

  // Seletor de site
  root.querySelector('#cwv-site-select')?.addEventListener('change', async (e) => {
    cwvSelectedId = e.target.value || null;
    cwvLatestRuns = cwvSelectedId ? await fetchLatestRuns(cwvSelectedId, 10) : [];
    renderCwvView();
  });

  // Cadastrar site (botão principal + botão do empty state)
  root.querySelector('#cwv-add-site')?.addEventListener('click', openAddSiteDialog);
  root.querySelector('#cwv-add-site-empty')?.addEventListener('click', openAddSiteDialog);

  // Executar auditoria agora
  root.querySelector('#cwv-run-now')?.addEventListener('click', async () => {
    if (!cwvSelectedId) return;
    const btn = root.querySelector('#cwv-run-now');
    const apiKey = await getPsiApiKey();
    if (!apiKey) {
      toast.error('Configure a API key do PageSpeed Insights em Configurações → Integrações.');
      return;
    }
    try {
      if (btn) { btn.disabled = true; btn.classList.add('loading'); btn.textContent = 'Auditando… (~15s)'; }
      await runAuditAndSave(cwvSelectedId);
      toast.success('Auditoria concluída e salva no histórico.');
      cwvLatestRuns = await fetchLatestRuns(cwvSelectedId, 10);
      renderCwvView();
    } catch (e) {
      toast.error('Erro na auditoria: ' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('loading'); btn.textContent = '▶ Executar auditoria agora'; }
    }
  });

  // Remover site
  root.querySelector('#cwv-delete-site')?.addEventListener('click', async () => {
    if (!cwvSelectedId) return;
    const site = cwvSites.find(s => s.id === cwvSelectedId);
    const { modal } = await import('../components/modal.js');
    const ok = await modal.confirm({
      title:   'Remover site?',
      message: `Remover <strong>${esc(site?.label || '')}</strong> e todo o histórico de auditorias? Essa ação não pode ser desfeita.`,
      confirmText: 'Remover', danger: true, icon: '⚠',
    });
    if (!ok) return;
    try {
      await deleteSite(cwvSelectedId);
      toast.success('Site removido.');
      cwvSelectedId = null;
      cwvLatestRuns = [];
      await loadCwvData();
      renderCwvView();
    } catch (e) {
      toast.error('Erro: ' + e.message);
    }
  });
}

/* ─── Diálogo de cadastro de site ────────────────────────── */
async function openAddSiteDialog() {
  const { modal } = await import('../components/modal.js');
  const content = `
    <div class="form-group">
      <label class="form-label">URL do site</label>
      <input type="url" class="form-input" id="cwv-new-url"
        placeholder="https://primetour.com.br" autofocus />
      <div style="font-size:0.6875rem;color:var(--text-muted);margin-top:4px;">
        Se omitir https://, será adicionado automaticamente.
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Nome/rótulo</label>
      <input type="text" class="form-input" id="cwv-new-label"
        placeholder="Ex.: Primetour — Site Principal" maxlength="80" />
    </div>
  `;

  return new Promise((resolve) => {
    const m = modal.open({
      title:   'Cadastrar site',
      content,
      size:    'sm',
      footer: [
        {
          label: 'Cancelar',
          class: 'btn-secondary',
        },
        {
          label: 'Cadastrar',
          class: 'btn-primary',
          // Captura os valores ANTES de o modal fechar
          onClick: async (_e, { close }) => {
            const body = m.getBody();
            const url   = body.querySelector('#cwv-new-url')?.value?.trim();
            const label = body.querySelector('#cwv-new-label')?.value?.trim();
            if (!url) {
              toast.error('URL é obrigatória.');
              return; // não fecha
            }
            close();
            try {
              const id = await createSite({ url, label });
              toast.success('Site cadastrado.');
              cwvSelectedId = id;
              await loadCwvData();
              renderCwvView();
            } catch (e) {
              toast.error('Erro: ' + e.message);
            }
            resolve();
          },
          closeOnClick: false, // controlamos o close manualmente
        },
      ],
      onClose: () => resolve(),
    });

    // Enter no input principal dispara o cadastro
    setTimeout(() => {
      const urlInput = m.getBody().querySelector('#cwv-new-url');
      urlInput?.focus();
      urlInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          m.getElement().querySelector('[data-btn-index="1"]')?.click();
        }
      });
    }, 50);
  });
}
