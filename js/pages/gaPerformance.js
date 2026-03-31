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

    <!-- Breakdown tabs -->
    <div style="display:flex;gap:6px;margin-bottom:16px;">
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
    btn.addEventListener('click', () => {
      container.querySelectorAll('.ga-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderTable(btn.dataset.tab);
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

    const filterByProp = docs => {
      let items = docs.map(d => ({ id: d.id, ...d.data() }));
      if (filterProp) items = items.filter(i => i.propertyId === filterProp);
      return items.filter(i => {
        const dt = i.date?.toDate?.() || (i.date ? new Date(i.date) : null) || i._syncDate;
        return !dt || dt >= cutoff;
      });
    };

    allPages     = filterByProp(pagesSnap.docs);
    allSources   = filterByProp(sourcesSnap.docs);
    allDevices   = filterByProp(devicesSnap.docs);
    allCountries = filterByProp(countriesSnap.docs);

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
    renderTable('daily');

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
    <th style="${thStyle}">Visualizações</th>
    <th style="${thStyle}">Usuários</th>
    <th style="${thStyle}">Duração Média</th>
    <th style="${thStyle}">Taxa Rejeição</th>
    <th style="${thStyle}">Engajamento</th>
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
    <th style="${thStyle}">Origem / Mídia</th>
    <th style="${thStyle}">Sessões</th>
    <th style="${thStyle}">Usuários</th>
    <th style="${thStyle}">Novos Usuários</th>
    <th style="${thStyle}">Taxa Rejeição</th>
    <th style="${thStyle}">Engajamento</th>
    <th style="${thStyle}">Conversões</th>
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
    <th style="${thStyle}">Dispositivo</th>
    <th style="${thStyle}">Sessões</th>
    <th style="${thStyle}">Usuários</th>
    <th style="${thStyle}">% do Total</th>
    <th style="${thStyle}">Taxa Rejeição</th>
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
    <th style="${thStyle}">Engajamento</th>
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
