/**
 * PRIMETOUR — Performance de Newsletters
 * Lê dados sincronizados do Salesforce Marketing Cloud via Firestore
 */

import { store }     from '../store.js';
import { toast }     from '../components/toast.js';
import { APP_CONFIG } from '../config.js';
import {
  collection, getDocs, query, where, orderBy, limit,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct  = v => (v != null ? `${Number(v).toFixed(1)}%` : '—');
const num  = v => (v != null ? Number(v).toLocaleString('pt-BR') : '—');
const fmt  = ts => {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR').format(d);
};

const BUS = (APP_CONFIG?.marketingCloud?.businessUnits) || [
  { id: 'primetour',     name: 'Primetour'     },
  { id: 'btg-partners',  name: 'BTG Partners'  },
  { id: 'btg-ultrablue', name: 'BTG Ultrablue' },
  { id: 'centurion',     name: 'Centurion'     },
  { id: 'pts',           name: 'PTS'           },
];

const PERIODS = [
  { value: '7',  label: 'Últimos 7 dias'  },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
  { value: '365',label: 'Último ano'      },
];

const COLS = [
  { key: 'sentDate',        label: 'Data de Envio'   },
  { key: 'name',            label: 'Nome'            },
  { key: 'subject',         label: 'Assunto'         },
  { key: 'totalSent',       label: 'Enviados'        },
  { key: 'deliveryRate',    label: 'Entrega'         },
  { key: 'hardBounce',      label: 'Hard Bounce'     },
  { key: 'softBounce',      label: 'Soft Bounce'     },
  { key: 'blockBounce',     label: 'Block Bounce'    },
  { key: 'openTotal',       label: 'Ab. Total'       },
  { key: 'openUnique',      label: 'Ab. Único'       },
  { key: 'openRate',        label: 'Taxa Ab.'        },
  { key: 'clickTotal',      label: 'Cliques Total'   },
  { key: 'clickUnique',     label: 'Cliques Únicos'  },
  { key: 'clickRate',       label: 'Taxa Clique'     },
  { key: 'conversionTotal', label: 'Conv. Total'     },
  { key: 'conversionUnique',label: 'Conv. Únicos'    },
  { key: 'optOut',          label: 'Opt-out'         },
];

let allData   = [];
let filterBu  = '';
let filterDays= '30';
let sortKey   = 'sentDate';
let sortDir   = -1; // -1 = desc

/* ─── Render ─────────────────────────────────────────────── */
export async function renderNlPerformance(container) {
  if (!store.can('system_manage_users') && !store.isMaster() &&
      !store.can('analytics_view')) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Performance de Newsletters</h1>
        <p class="page-subtitle">Dados sincronizados do Salesforce Marketing Cloud</p>
      </div>
      <div class="page-header-actions" style="gap:8px;">
        <span id="nl-sync-status" style="font-size:0.75rem;color:var(--text-muted);padding:0 4px;"></span>
        ${store.can('system_manage_settings') || store.isMaster() ? `
          <button class="btn btn-secondary btn-sm" id="nl-sync-btn">⟳ Sincronizar agora</button>
        ` : ''}
      </div>
    </div>

    <!-- Filters -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;align-items:center;">
      <select class="filter-select" id="nl-bu-filter" style="min-width:180px;">
        <option value="">Todas as unidades</option>
        ${BUS.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}
      </select>
      <select class="filter-select" id="nl-period-filter" style="min-width:160px;">
        ${PERIODS.map(p=>`<option value="${p.value}" ${p.value==='30'?'selected':''}>${p.label}</option>`).join('')}
      </select>
      <span id="nl-count" style="font-size:0.8125rem;color:var(--text-muted);margin-left:4px;"></span>
    </div>

    <!-- KPI cards -->
    <div id="nl-kpis" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));
      gap:12px;margin-bottom:24px;">
      ${[0,1,2,3,4].map(()=>`<div class="card skeleton" style="height:80px;"></div>`).join('')}
    </div>

    <!-- Table -->
    <div class="card" style="padding:0;overflow:hidden;">
      <div style="overflow-x:auto;">
        <table id="nl-table" style="width:100%;border-collapse:collapse;font-size:0.8125rem;">
          <thead id="nl-thead"></thead>
          <tbody id="nl-tbody">
            <tr><td colspan="17" style="padding:40px;text-align:center;color:var(--text-muted);">
              Carregando dados…
            </td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Bind filters
  document.getElementById('nl-bu-filter')?.addEventListener('change', e => {
    filterBu = e.target.value; renderTable();
  });
  document.getElementById('nl-period-filter')?.addEventListener('change', e => {
    filterDays = e.target.value; loadData();
  });

  // Sync button
  document.getElementById('nl-sync-btn')?.addEventListener('click', triggerSync);

  await loadData();
}

/* ─── Load from Firestore ─────────────────────────────────── */
async function loadData() {
  const tbody = document.getElementById('nl-tbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="17" style="padding:40px;text-align:center;
    color:var(--text-muted);">Carregando…</td></tr>`;

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - parseInt(filterDays));

    // Firestore doesn't support inequality on multiple fields without composite index
    // So we fetch all and filter client-side on date
    const snap = await getDocs(
      query(collection(db, 'mc_performance'), orderBy('sentDate', 'desc'), limit(2000))
    );

    allData = [];
    snap.forEach(d => {
      const data = { id: d.id, ...d.data() };
      // Client-side date filter
      const sentDate = data.sentDate?.toDate?.() || (data.sentDate ? new Date(data.sentDate) : null);
      if (!sentDate || sentDate >= cutoff) {
        allData.push({ ...data, _sentDate: sentDate });
      }
    });

    // Show last sync time
    const status = document.getElementById('nl-sync-status');
    if (status && allData.length) {
      const latest = allData.reduce((a,b) => {
        const at = b.syncedAt?.toDate?.();
        const aa = a.syncedAt?.toDate?.();
        return at && (!aa || at > aa) ? b : a;
      }, allData[0]);
      const syncDate = latest.syncedAt?.toDate?.();
      if (syncDate) status.textContent = `Última sync: ${fmt({ toDate: () => syncDate })}`;
    }

    renderTable();
  } catch(e) {
    console.error('nl-performance load error:', e);
    const tbody = document.getElementById('nl-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="17" style="padding:40px;text-align:center;
      color:var(--text-muted);">Erro ao carregar dados: ${esc(e.message)}</td></tr>`;
  }
}

/* ─── Render table ────────────────────────────────────────── */
function renderTable() {
  let rows = allData;
  if (filterBu) rows = rows.filter(r => r.buId === filterBu);

  // Sort
  rows = [...rows].sort((a, b) => {
    let va = a[sortKey], vb = b[sortKey];
    if (sortKey === 'sentDate') { va = a._sentDate; vb = b._sentDate; }
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'string') return sortDir * va.localeCompare(vb, 'pt-BR');
    return sortDir * (va - vb);
  });

  // Count
  const count = document.getElementById('nl-count');
  if (count) count.textContent = `${rows.length} disparos`;

  // KPIs
  renderKpis(rows);

  // Table header
  const thead = document.getElementById('nl-thead');
  if (thead) {
    thead.innerHTML = `<tr style="background:var(--bg-surface);">
      ${!filterBu ? `<th style="${thStyle()}">Unidade</th>` : ''}
      ${COLS.map(c => `
        <th style="${thStyle(c.key === sortKey)}" data-sort="${c.key}" class="nl-sort-th">
          ${c.label}${c.key === sortKey ? (sortDir === -1 ? ' ↓' : ' ↑') : ''}
        </th>
      `).join('')}
    </tr>`;

    thead.querySelectorAll('.nl-sort-th').forEach(th => {
      th.addEventListener('click', () => {
        if (sortKey === th.dataset.sort) sortDir *= -1;
        else { sortKey = th.dataset.sort; sortDir = -1; }
        renderTable();
      });
    });
  }

  // Table body
  const tbody = document.getElementById('nl-tbody');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="17" style="padding:48px;text-align:center;
      color:var(--text-muted);">
      Nenhum disparo encontrado para o período e filtro selecionados.
      <br><span style="font-size:0.75rem;margin-top:6px;display:block;">
        Clique em "Sincronizar agora" para buscar dados do Marketing Cloud.
      </span></td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr style="border-bottom:1px solid var(--border-subtle);transition:background .1s;"
      onmouseover="this.style.background='var(--bg-surface)'"
      onmouseout="this.style.background=''">
      ${!filterBu ? `<td style="${tdStyle()};font-weight:500;">${buBadge(r.buId, r.buName)}</td>` : ''}
      <td style="${tdStyle()}">${fmt(r.sentDate)}</td>
      <td style="${tdStyle()};max-width:200px;white-space:normal;line-height:1.3;">
        <span title="${esc(r.name)}">${esc(r.name?.slice(0,60))}${(r.name||'').length>60?'…':''}</span>
      </td>
      <td style="${tdStyle()};max-width:220px;white-space:normal;color:var(--text-muted);font-size:0.75rem;line-height:1.3;">
        ${esc(r.subject?.slice(0,80))}${(r.subject||'').length>80?'…':''}
      </td>
      <td style="${tdStyle('right')}">${num(r.totalSent)}</td>
      <td style="${tdStyle('right')};${rateColor(r.deliveryRate, 95, 85)}">${pct(r.deliveryRate)}</td>
      <td style="${tdStyle('right')};${badColor(r.hardBounce)}">${num(r.hardBounce)}</td>
      <td style="${tdStyle('right')};${badColor(r.softBounce)}">${num(r.softBounce)}</td>
      <td style="${tdStyle('right')};${badColor(r.blockBounce)}">${num(r.blockBounce)}</td>
      <td style="${tdStyle('right')}">${num(r.openTotal)}</td>
      <td style="${tdStyle('right')}">${num(r.openUnique)}</td>
      <td style="${tdStyle('right')};${rateColor(r.openRate, 20, 10)}">${pct(r.openRate)}</td>
      <td style="${tdStyle('right')}">${num(r.clickTotal)}</td>
      <td style="${tdStyle('right')}">${num(r.clickUnique)}</td>
      <td style="${tdStyle('right')};${rateColor(r.clickRate, 3, 1)}">${pct(r.clickRate)}</td>
      <td style="${tdStyle('right')}">${num(r.conversionTotal)}</td>
      <td style="${tdStyle('right')}">${num(r.conversionUnique)}</td>
      <td style="${tdStyle('right')};${badColor(r.optOut)}">${num(r.optOut)}</td>
    </tr>
  `).join('');
}

/* ─── KPI summary cards ───────────────────────────────────── */
function renderKpis(rows) {
  const el = document.getElementById('nl-kpis');
  if (!el || !rows.length) return;

  const avg = key => {
    const vals = rows.map(r => r[key]).filter(v => v != null && !isNaN(v));
    return vals.length ? vals.reduce((a,b) => a+b, 0) / vals.length : null;
  };
  const sum = key => rows.reduce((a,r) => a + (Number(r[key])||0), 0);

  const kpis = [
    { label: 'Disparos',           value: rows.length.toLocaleString('pt-BR'),   sub: 'no período' },
    { label: 'Enviados total',     value: sum('totalSent').toLocaleString('pt-BR'), sub: 'emails enviados' },
    { label: 'Taxa de abertura',   value: pct(avg('openRate')),   sub: 'média única' },
    { label: 'Taxa de cliques',    value: pct(avg('clickRate')),  sub: 'média única' },
    { label: 'Taxa de entrega',    value: pct(avg('deliveryRate')), sub: 'média' },
  ];

  el.innerHTML = kpis.map(k => `
    <div class="card" style="padding:14px 16px;">
      <div style="font-size:0.6875rem;color:var(--text-muted);text-transform:uppercase;
        letter-spacing:.06em;margin-bottom:6px;">${k.label}</div>
      <div style="font-size:1.375rem;font-weight:600;color:var(--text-primary);line-height:1.1;">
        ${k.value}
      </div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">${k.sub}</div>
    </div>
  `).join('');
}

/* ─── Trigger sync via Cloud Function ────────────────────── */
async function triggerSync() {
  const btn    = document.getElementById('nl-sync-btn');
  const status = document.getElementById('nl-sync-status');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Sincronizando…'; }
  if (status) status.textContent = 'Sincronizando com Marketing Cloud…';

  try {
    const url = APP_CONFIG?.marketingCloud?.syncFunctionUrl;
    if (!url || url.includes('SEU_PROJETO')) throw new Error('URL da Function não configurada.');

    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ days: parseInt(filterDays) || 90 }),
    });

    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Erro desconhecido');

    toast.success(`Sincronização concluída: ${data.docsWritten || 0} registros atualizados.`);
    if (status) status.textContent = 'Sincronizado agora';
    await loadData();
  } catch(e) {
    toast.error('Erro na sincronização: ' + e.message);
    if (status) status.textContent = 'Erro na sincronização';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⟳ Sincronizar agora'; }
  }
}

/* ─── Style helpers ───────────────────────────────────────── */
function thStyle(active = false) {
  return `padding:10px 12px;text-align:left;font-size:0.6875rem;font-weight:600;
    text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);
    white-space:nowrap;cursor:pointer;border-bottom:1px solid var(--border-subtle);
    ${active ? 'color:var(--brand-gold);' : ''}`;
}
function tdStyle(align = 'left') {
  return `padding:9px 12px;text-align:${align};vertical-align:middle;white-space:nowrap;color:var(--text-primary);`;
}
function rateColor(val, good, warn) {
  if (val == null) return '';
  if (val >= good) return 'color:#22C55E;font-weight:600;';
  if (val >= warn) return 'color:#F59E0B;font-weight:600;';
  return 'color:#EF4444;font-weight:600;';
}
function badColor(val) {
  if (!val || val === 0) return 'color:var(--text-muted);';
  return 'color:#F59E0B;';
}
function buBadge(id, name) {
  const colors = {
    'primetour':    '#D4A843',
    'btg-partners': '#38BDF8',
    'btg-ultrablue':'#818CF8',
    'centurion':    '#34D399',
    'pts':          '#F472B6',
  };
  const c = colors[id] || '#6B7280';
  return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:0.75rem;
    padding:2px 8px;border-radius:var(--radius-full);
    background:${c}15;color:${c};border:1px solid ${c}30;">
    ${esc(name || id)}
  </span>`;
}
