/**
 * PRIMETOUR — Performance de Newsletters
 * Lê dados sincronizados do Salesforce Marketing Cloud via Firestore
 * Features: colunas fixas, exportação XLSX + PDF com pré-edição de linhas
 */

import { store }      from '../store.js';
import { toast }      from '../components/toast.js';
import { APP_CONFIG } from '../config.js';
import {
  collection, getDocs, query, orderBy, limit,
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

// Base BUs from Marketing Cloud
const BUS_BASE = (APP_CONFIG?.marketingCloud?.businessUnits) || [
  { id: 'primetour',     name: 'Primetour'     },
  { id: 'btg-partners',  name: 'BTG Partners'  },
  { id: 'btg-ultrablue', name: 'BTG Ultrablue' },
  { id: 'centurion',     name: 'Centurion'     },
  { id: 'pts',           name: 'PTS'           },
];

// All BUs including virtual sub-BUs derived client-side
const BUS = [
  { id: 'btg-partners',       name: 'BTG Partners'        },
  { id: 'btg-ultrablue',      name: 'BTG Ultrablue'       },
  { id: 'centurion',          name: 'Centurion'           },
  { id: 'pts',                name: 'PTS'                 },
  { id: 'primetour-lazer',    name: 'Primetour Lazer'     },
  { id: 'primetour-agencias', name: 'Primetour Agências'  },
  { id: 'qualidade',          name: 'Qualidade (CSAT)'    },
];

// Derives virtual buId — CSAT applies to ALL BUs
function getVirtualBuId(r) {
  const name = (r.name || '').trim();
  // CSAT overrides BU — any BU can have CSAT sends
  if (/^CSAT_/i.test(name)) return 'qualidade';
  if (r.buId !== 'primetour') return r.buId;
  // Primetour sub-BUs
  if (/^AG\d+/i.test(name)) return 'primetour-agencias';
  if (/^\d{3,5}/.test(name)) return 'primetour-lazer';
  return 'primetour-lazer';
}

function getVirtualBuName(buId) {
  return BUS.find(b => b.id === buId)?.name || buId;
}

const PERIODS = [
  { value: '7',   label: 'Últimos 7 dias'  },
  { value: '30',  label: 'Últimos 30 dias' },
  { value: '90',  label: 'Últimos 90 dias' },
  { value: '365', label: 'Último ano'      },
];

// Columns after the two fixed ones (sentDate, name)
const COLS_EXTRA = [
  { key: 'subject',         label: 'Assunto'      },
  { key: 'totalSent',       label: 'Enviados'     },
  { key: 'deliveryRate',    label: 'Entrega'      },
  { key: 'hardBounce',      label: 'Hard Bounce'  },
  { key: 'softBounce',      label: 'Soft Bounce'  },
  { key: 'blockBounce',     label: 'Block Bounce' },
  { key: 'openUnique',      label: 'Abertura'    },
  { key: 'openRate',        label: '% Abertura'  },
  { key: 'clickUnique',     label: 'Cliques'     },
  { key: 'clickRate',       label: '% Cliques'   },
  { key: 'optOut',          label: 'Opt-out'      },
];

let allData       = [];
let filterBu      = '';
let filterDays    = '30';
let sortKey       = 'sentDate';
let sortDir       = -1;
let hiddenRows    = new Set(); // jobIds ocultos na pré-edição

/* ─── Render page ─────────────────────────────────────────── */
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
      <div class="page-header-actions" style="gap:8px;flex-wrap:wrap;">
        <span id="nl-sync-status" style="font-size:0.75rem;color:var(--text-muted);padding:0 4px;"></span>
        <a href="https://github.com/primetour/tarefas/actions/workflows/mc-sync.yml"
          target="_blank" rel="noopener" class="btn btn-secondary btn-sm"
          style="display:flex;align-items:center;gap:6px;text-decoration:none;">
          ↗ Sincronizar
        </a>
        <button class="btn btn-secondary btn-sm" id="nl-export-xlsx">⬇ XLSX</button>
        <button class="btn btn-secondary btn-sm" id="nl-export-pdf">⬇ PDF</button>
      </div>
    </div>

    <!-- Filters + edit mode -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;align-items:center;">
      <select class="filter-select" id="nl-bu-filter" style="min-width:180px;">
        <option value="">Todas as unidades</option>
        ${BUS.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}
      </select>
      <select class="filter-select" id="nl-period-filter" style="min-width:160px;">
        ${PERIODS.map(p=>`<option value="${p.value}" ${p.value==='30'?'selected':''}>${p.label}</option>`).join('')}
        <option value="custom">Período personalizado…</option>
      </select>
      <div id="nl-custom-range" style="display:none;gap:6px;align-items:center;">
        <input type="date" id="nl-date-from" class="portal-field" style="font-size:0.8125rem;">
        <span style="color:var(--text-muted);font-size:0.8125rem;">→</span>
        <input type="date" id="nl-date-to" class="portal-field" style="font-size:0.8125rem;">
        <button class="btn btn-primary btn-sm" id="nl-apply-range" style="font-size:0.8125rem;">Aplicar</button>
      </div>
      <div style="margin-left:auto;display:flex;align-items:center;gap:8px;">
        <span id="nl-hidden-count" style="font-size:0.75rem;color:var(--text-muted);display:none;"></span>
        <button class="btn btn-ghost btn-sm" id="nl-toggle-edit" style="font-size:0.8125rem;">
          ✎ Pré-editar linhas
        </button>
        <button class="btn btn-ghost btn-sm" id="nl-restore-all"
          style="font-size:0.8125rem;display:none;color:var(--brand-gold);">
          ↺ Restaurar todas
        </button>
        <span id="nl-count" style="font-size:0.8125rem;color:var(--text-muted);"></span>
      </div>
    </div>

    <!-- KPI cards -->
    <div id="nl-kpis" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));
      gap:12px;margin-bottom:24px;">
      ${[0,1,2,3,4].map(()=>`<div class="card skeleton" style="height:80px;"></div>`).join('')}
    </div>

    <!-- Table with sticky first 2 cols -->
    <div class="card" style="padding:0;overflow:hidden;">
      <div id="nl-table-wrap" style="overflow-x:auto;max-height:72vh;overflow-y:auto;">
        <table id="nl-table" style="width:100%;border-collapse:separate;border-spacing:0;font-size:0.8125rem;">
          <thead id="nl-thead"></thead>
          <tbody id="nl-tbody">
            <tr><td colspan="14" style="padding:40px;text-align:center;color:var(--text-muted);">
              Carregando dados…
            </td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  let editMode = false;

  // Bind filters
  document.getElementById('nl-bu-filter')?.addEventListener('change', e => {
    filterBu = e.target.value; renderTable(editMode);
  });
  document.getElementById('nl-period-filter')?.addEventListener('change', e => {
    const val = e.target.value;
    const rangeEl = document.getElementById('nl-custom-range');
    if (val === 'custom') {
      if (rangeEl) rangeEl.style.display = 'flex';
    } else {
      if (rangeEl) rangeEl.style.display = 'none';
      filterDays = val;
      loadData(editMode);
    }
  });
  document.getElementById('nl-apply-range')?.addEventListener('click', () => {
    const from = document.getElementById('nl-date-from')?.value;
    const to   = document.getElementById('nl-date-to')?.value;
    if (!from || !to) { return; }
    filterDays = `custom:${from}:${to}`;
    loadData(editMode);
  });

  // Edit mode toggle
  document.getElementById('nl-toggle-edit')?.addEventListener('click', () => {
    editMode = !editMode;
    const btn = document.getElementById('nl-toggle-edit');
    if (btn) {
      btn.textContent  = editMode ? '✓ Concluir edição' : '✎ Pré-editar linhas';
      btn.style.color  = editMode ? 'var(--brand-gold)' : '';
    }
    renderTable(editMode);
  });

  // Restore all hidden rows
  document.getElementById('nl-restore-all')?.addEventListener('click', () => {
    hiddenRows.clear();
    updateHiddenCount();
    renderTable(editMode);
  });

  // Export buttons
  document.getElementById('nl-export-xlsx')?.addEventListener('click', exportXLSX);
  document.getElementById('nl-export-pdf')?.addEventListener('click',  exportPDF);

  await loadData(editMode);
}

/* ─── Load from Firestore ─────────────────────────────────── */
async function loadData(editMode = false) {
  const tbody = document.getElementById('nl-tbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="14" style="padding:40px;text-align:center;
    color:var(--text-muted);">Carregando…</td></tr>`;

  try {
    let cutoff, cutoffTo = null;
    if (String(filterDays).startsWith('custom:')) {
      const [, from, to] = filterDays.split(':');
      cutoff   = new Date(from + 'T00:00:00');
      cutoffTo = new Date(to   + 'T23:59:59');
    } else {
      cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - parseInt(filterDays));
    }

    const snap = await getDocs(
      query(collection(db, 'mc_performance'), orderBy('sentDate', 'desc'), limit(2000))
    );

    allData = [];
    snap.forEach(d => {
      const data     = { id: d.id, ...d.data() };
      // Skip [Teste] emails — except CSAT (they're always operational test-style sends)
      const isCsat = /^CSAT_/i.test((data.name || '').trim());
      if (!isCsat && /^\s*\[Teste\]/i.test(data.subject || '')) return;
      const sentDate = data.sentDate?.toDate?.() || (data.sentDate ? new Date(data.sentDate) : null);
      if (!sentDate) return;
      if (sentDate < cutoff) return;
      if (cutoffTo && sentDate > cutoffTo) return;
      const virtualBuId   = getVirtualBuId(data);
      const virtualBuName = getVirtualBuName(virtualBuId);
      allData.push({ ...data, _sentDate: sentDate, virtualBuId, virtualBuName });
    });

    // Sync status
    const status = document.getElementById('nl-sync-status');
    if (status && allData.length) {
      const latest = allData.reduce((a,b) => {
        const at = b.syncedAt?.toDate?.();
        const aa = a.syncedAt?.toDate?.();
        return at && (!aa || at > aa) ? b : a;
      }, allData[0]);
      const syncDate = latest.syncedAt?.toDate?.();
      if (syncDate) status.textContent = `Sync: ${fmt({ toDate: () => syncDate })}`;
    }

    renderTable(editMode);
  } catch(e) {
    console.error('nl-performance load error:', e);
    const tbody = document.getElementById('nl-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="14" style="padding:40px;text-align:center;
      color:var(--text-muted);">Erro: ${esc(e.message)}</td></tr>`;
  }
}

/* ─── Merge wave sends (U0197_1/2/3/4 → 1 row) ──────────────── */
function mergeWaves(rows) {
  // Extract base code — strip trailing wave suffixes in various formats
  function baseCode(name) {
    return (name || '')
      .trim()
      .replace(/\s*-\s*\d+$/, '')  // U0195 - 4  → U0195
      .replace(/_\d+$/, '')          // U0197_1    → U0197
      .replace(/-\d+$/, '')          // P0193-2    → P0193
      .replace(/_[A-Z]$/, '')         // CODE_A     → CODE
      .trim();
  }

  // Group by virtualBuId + baseCode (no day — waves can span multiple days)
  const groups = new Map();
  for (const r of rows) {
    const key = (r.virtualBuId || r.buId) + '|' + baseCode(r.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const merged = [];
  for (const [, group] of groups) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    // Sort waves by name so _1 is first
    group.sort((a, b) => (a.name||'').localeCompare(b.name||''));
    const base = group[0];
    const waves = group.length;

    // Sum numeric metrics
    const sum = k => group.reduce((t, r) => t + (Number(r[k]) || 0), 0);
    const avg = k => { const s = sum(k); return s > 0 ? Math.round(s / waves * 10) / 10 : 0; };

    const totalSent    = sum('totalSent');
    const delivered    = sum('totalSent') > 0
      ? Math.round(group.reduce((t,r) => t + (r.deliveryRate||0) * (r.totalSent||0), 0) / totalSent * 10) / 10
      : 0;
    const openUnique   = sum('openUnique');
    const clickUnique  = sum('clickUnique');
    const hardBounce   = sum('hardBounce');
    const softBounce   = sum('softBounce');
    const blockBounce  = sum('blockBounce');
    const optOut       = sum('optOut');
    const openRate     = delivered > 0 ? Math.round(openUnique / (totalSent * (delivered/100)) * 1000) / 10 : 0;
    const clickRate    = delivered > 0 ? Math.round(clickUnique / (totalSent * (delivered/100)) * 1000) / 10 : 0;

    // Wave label list for tooltip: "1776_1 / 1776_2 / 1776_3 / 1776_4"
    const waveNames = group.map(r => r.name).join(' / ');

    merged.push({
      ...base,
      name:         baseCode(base.name),  // show clean base name
      waveCount:    waves,
      waveNames,
      totalSent,
      deliveryRate: delivered,
      openUnique,
      clickUnique,
      hardBounce,
      softBounce,
      blockBounce,
      optOut,
      openRate,
      clickRate,
      // Use earliest sentDate
      sentDate:   base.sentDate,
      _sentDate:  base._sentDate,
      // jobId = first wave's jobId for hide/show
      jobId: base.jobId,
    });
  }
  return merged;
}

/* ─── Render table ────────────────────────────────────────── */
function renderTable(editMode = false) {
  let rows = allData;
  if (filterBu) rows = rows.filter(r => r.virtualBuId === filterBu);

  // Merge wave sends (U0197_1/U0197_2/... → single row)
  rows = mergeWaves(rows);

  // Sort
  rows = [...rows].sort((a, b) => {
    let va = a[sortKey], vb = b[sortKey];
    if (sortKey === 'sentDate') { va = a._sentDate; vb = b._sentDate; }
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'string') return sortDir * va.localeCompare(vb, 'pt-BR');
    return sortDir * (va - vb);
  });

  // In export mode: only visible rows. In display: show all with crossed style
  const visibleRows = rows.filter(r => !hiddenRows.has(r.jobId));

  const count = document.getElementById('nl-count');
  if (count) count.textContent = `${rows.length} disparos`;
  updateHiddenCount();
  renderKpis(rows);

  // ── Styles for sticky columns ──────────────────────────────
  const stickyBase  = `position:sticky;z-index:2;background:var(--bg-card);`;
  const stickyHead  = `position:sticky;z-index:3;background:var(--bg-surface);`;

  // Fixed col widths: col0=BU(90), col1=Date(90), col2=Name(180)
  const hasBu     = !filterBu;
  const col0w     = hasBu ? 90  : 0;
  const col1left  = hasBu ? col0w : 0;   // Date left position
  const col2left  = col1left + 112;       // Name left position (after Date=112px)
  const afterFixed= col2left + 190;       // shadow starts here

  const thFixed = (left, w, label, sortK) => {
    const active = sortK === sortKey;
    return `<th data-sort="${sortK}" class="nl-sort-th"
      style="${stickyHead}left:${left}px;min-width:${w}px;max-width:${w}px;
      padding:10px 12px;text-align:left;font-size:0.6875rem;font-weight:600;
      text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;cursor:pointer;
      border-bottom:1px solid var(--border-subtle);
      ${active ? 'color:var(--brand-gold);' : 'color:var(--text-muted);'}
      ${left + w === afterFixed ? 'box-shadow:4px 0 8px -4px rgba(0,0,0,.25);' : ''}">
      ${label}${active ? (sortDir === -1 ? ' ↓' : ' ↑') : ''}
    </th>`;
  };

  const tdFixed = (left, w, content, extra = '') =>
    `<td style="${stickyBase}left:${left}px;min-width:${w}px;max-width:${w}px;
      padding:9px 12px;vertical-align:middle;
      ${left + w === afterFixed ? 'box-shadow:4px 0 8px -4px rgba(0,0,0,.2);' : ''}
      ${extra}">
      ${content}
    </td>`;

  const thScroll = (c) => {
    const active = c.key === sortKey;
    return `<th data-sort="${c.key}" class="nl-sort-th"
      style="${thStyle(active)}">${c.label}${active ? (sortDir === -1 ? ' ↓' : ' ↑') : ''}</th>`;
  };

  // ── Header ─────────────────────────────────────────────────
  const thead = document.getElementById('nl-thead');
  if (thead) {
    thead.innerHTML = `<tr style="background:var(--bg-surface);">
      ${editMode ? `<th style="${stickyHead}left:0;min-width:36px;padding:10px 8px;
        border-bottom:1px solid var(--border-subtle);z-index:3;"></th>` : ''}
      ${hasBu ? `<th style="${stickyHead}left:${editMode?36:0}px;min-width:${col0w}px;max-width:${col0w}px;
        padding:10px 12px;font-size:0.6875rem;font-weight:600;text-transform:uppercase;
        letter-spacing:.05em;color:var(--text-muted);white-space:nowrap;overflow:hidden;
        border-bottom:1px solid var(--border-subtle);">Unidade</th>` : ''}
      ${thFixed(hasBu ? col0w + (editMode?36:0) : (editMode?36:0), 112, 'Data', 'sentDate')}
      ${thFixed(hasBu ? col2left + (editMode?36:0) : 112 + (editMode?36:0), 190, 'Nome', 'name')}
      ${COLS_EXTRA.map(thScroll).join('')}
    </tr>`;

    thead.querySelectorAll('.nl-sort-th').forEach(th => {
      th.addEventListener('click', () => {
        if (sortKey === th.dataset.sort) sortDir *= -1;
        else { sortKey = th.dataset.sort; sortDir = -1; }
        renderTable(editMode);
      });
    });
  }

  // ── Body ───────────────────────────────────────────────────
  const tbody = document.getElementById('nl-tbody');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="14" style="padding:48px;text-align:center;
      color:var(--text-muted);">Nenhum disparo encontrado para o período selecionado.</td></tr>`;
    return;
  }

  const editOffset = editMode ? 36 : 0;
  const buOffset   = hasBu   ? col0w : 0;

  tbody.innerHTML = rows.map(r => {
    const hidden = hiddenRows.has(r.jobId);
    const rowStyle = hidden
      ? 'opacity:.35;text-decoration:line-through;'
      : 'border-bottom:1px solid var(--border-subtle);';

    return `<tr style="${rowStyle}transition:background .1s;"
      onmouseover="if(!this.dataset.hidden)this.style.background='var(--bg-surface)'"
      onmouseout="this.style.background=''"
      data-hidden="${hidden}">
      ${editMode ? `
        <td style="position:sticky;left:0;z-index:2;background:var(--bg-card);
          min-width:36px;padding:9px 8px;text-align:center;vertical-align:middle;">
          <button class="nl-hide-btn" data-jobid="${r.jobId}"
            title="${hidden ? 'Mostrar linha' : 'Ocultar linha'}"
            style="border:none;background:none;cursor:pointer;font-size:0.875rem;
              color:${hidden ? 'var(--brand-gold)' : 'var(--text-muted)'};">
            ${hidden ? '👁' : '✕'}
          </button>
        </td>` : ''}
      ${hasBu ? `<td style="${stickyBase}left:${editOffset}px;min-width:${col0w}px;max-width:${col0w}px;
        padding:9px 12px;vertical-align:middle;overflow:hidden;">${buBadge(r.virtualBuId, r.virtualBuName)}</td>` : ''}
      ${tdFixed(buOffset + editOffset, 112, fmt(r.sentDate), 'color:var(--text-muted);font-size:0.75rem;')}
      ${tdFixed(buOffset + editOffset + 112, 190,
        `<span style="display:block;font-size:0.8125rem;white-space:normal;line-height:1.35;word-break:break-word;">
          ${esc(r.name || '—')}
          ${r.waveCount > 1 ? `<br><span title="${esc(r.waveNames)}" style="font-size:0.6875rem;color:var(--text-muted);font-weight:400;cursor:help;">⊞ ${r.waveCount} ondas</span>` : ''}
        </span>`,
        `box-shadow:4px 0 8px -4px rgba(0,0,0,.2);vertical-align:top;`)}
      <td style="padding:9px 12px;vertical-align:top;white-space:normal;word-break:break-word;
        color:var(--text-muted);font-size:0.75rem;line-height:1.4;min-width:180px;max-width:300px;">
        ${esc(r.subject || '—')}
      </td>
      <td style="${tdStyle('right')}">${num(r.totalSent)}</td>
      <td style="${tdStyle('right')};${rateColor(r.deliveryRate, 95, 85)}">${pct(r.deliveryRate)}</td>
      <td style="${tdStyle('right')};${badColor(r.hardBounce)}">${num(r.hardBounce)}</td>
      <td style="${tdStyle('right')};${badColor(r.softBounce)}">${num(r.softBounce)}</td>
      <td style="${tdStyle('right')};${badColor(r.blockBounce)}">${num(r.blockBounce)}</td>
      <td style="${tdStyle('right')}">${num(r.openUnique)}</td>
      <td style="${tdStyle('right')};${rateColor(r.openRate, 20, 10)}">${pct(r.openRate)}</td>
      <td style="${tdStyle('right')}">${num(r.clickUnique)}</td>
      <td style="${tdStyle('right')};${rateColor(r.clickRate, 3, 1)}">${pct(r.clickRate)}</td>
      <td style="${tdStyle('right')};${badColor(r.optOut)}">${num(r.optOut)}</td>
    </tr>`;
  }).join('');

  // Bind hide buttons
  tbody.querySelectorAll('.nl-hide-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const jobId = btn.dataset.jobid;
      if (hiddenRows.has(jobId)) hiddenRows.delete(jobId);
      else hiddenRows.add(jobId);
      renderTable(editMode);
    });
  });
}

/* ─── Hidden rows counter ─────────────────────────────────── */
function updateHiddenCount() {
  const span    = document.getElementById('nl-hidden-count');
  const restore = document.getElementById('nl-restore-all');
  const n       = hiddenRows.size;
  if (span) {
    span.textContent    = n > 0 ? `${n} linha${n!==1?'s':''} oculta${n!==1?'s':''}` : '';
    span.style.display  = n > 0 ? 'inline' : 'none';
  }
  if (restore) restore.style.display = n > 0 ? 'inline-flex' : 'none';
}

/* ─── Visible rows for export (excludes hidden) ───────────── */
function getExportRows() {
  let rows = allData;
  if (filterBu) rows = rows.filter(r => r.virtualBuId === filterBu);
  rows = mergeWaves(rows.filter(r => !hiddenRows.has(r.jobId)))
    .sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (sortKey === 'sentDate') { va = a._sentDate; vb = b._sentDate; }
      if (va == null) return 1; if (vb == null) return -1;
      if (typeof va === 'string') return sortDir * va.localeCompare(vb, 'pt-BR');
      return sortDir * (va - vb);
    });
  return rows;
}

/* ─── Export XLSX ─────────────────────────────────────────── */
async function exportXLSX() {
  const btn  = document.getElementById('nl-export-xlsx');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    // Load SheetJS from CDN
    if (!window.XLSX) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src    = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }

    const rows = getExportRows();
    const hasBu = !filterBu;

    const headers = [
      ...(hasBu ? ['Unidade'] : []),
      'Data de Envio', 'Nome', 'Assunto',
      'Enviados', 'Taxa Entrega (%)',
      'Hard Bounce', 'Soft Bounce', 'Block Bounce',
      'Abertura Única', '% Abertura',
      'Cliques Únicos', '% Cliques',
      'Opt-out',
    ];

    const data = rows.map(r => [
      ...(hasBu ? [r.virtualBuName] : []),
      fmt(r.sentDate), r.name, r.subject,
      r.totalSent, r.deliveryRate,
      r.hardBounce, r.softBounce, r.blockBounce,
      r.openUnique, r.openRate,
      r.clickUnique, r.clickRate,
      r.optOut,
    ]);

    const ws  = window.XLSX.utils.aoa_to_sheet([headers, ...data]);
    const wb  = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Performance');

    // Style: bold header, column widths
    ws['!cols'] = headers.map((h, i) =>
      ({ wch: i < 4 ? 28 : 16 })
    );

    const date = new Date().toISOString().slice(0,10);
    window.XLSX.writeFile(wb, `primetour_newsletters_${date}.xlsx`);
    toast.success(`${rows.length} disparos exportados.`);
  } catch(e) {
    toast.error('Erro ao exportar XLSX: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ XLSX'; }
  }
}

/* ─── Export PDF ──────────────────────────────────────────── */
async function exportPDF() {
  const btn = document.getElementById('nl-export-pdf');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    // Load jsPDF + AutoTable
    if (!window.jspdf) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src    = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src    = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.1/jspdf.plugin.autotable.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }

    const rows  = getExportRows();
    const hasBu = !filterBu;
    const { jsPDF } = window.jspdf;
    const doc   = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    // Title
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Performance de Newsletters — PRIMETOUR', 14, 16);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120);
    const bu    = filterBu ? (BUS.find(b => b.id === filterBu)?.name || filterBu) : 'Todas as unidades';
    const date  = new Date().toLocaleDateString('pt-BR');
    doc.text(`${bu}  ·  Exportado em ${date}  ·  ${rows.length} disparos`, 14, 22);
    doc.setTextColor(0);

    const head = [[
      ...(hasBu ? ['Unidade'] : []),
      'Data', 'Nome', 'Assunto',
      'Enviados', 'Entrega',
      'Hard', 'Soft', 'Block',
      'Abertura', '% Abertura',
      'Cliques', '% Cliques',
      'Opt-out',
    ]];

    const body = rows.map(r => [
      ...(hasBu ? [r.virtualBuName] : []),
      fmt(r.sentDate),
      (r.name || '').slice(0, 32),
      (r.subject || '').slice(0, 40),
      num(r.totalSent), pct(r.deliveryRate),
      num(r.hardBounce), num(r.softBounce), num(r.blockBounce),
      num(r.openUnique), pct(r.openRate),
      num(r.clickUnique), pct(r.clickRate),
      num(r.optOut),
    ]);

    doc.autoTable({
      head, body,
      startY:   28,
      styles:   { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
      headStyles: { fillColor: [30, 30, 30], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      columnStyles: hasBu ? {
        0: { cellWidth: 20 },   // Unidade
        1: { cellWidth: 18 },   // Data
        2: { cellWidth: 38 },   // Nome
        3: { cellWidth: 44 },   // Assunto
        4: { cellWidth: 16 },   // Enviados
        5: { cellWidth: 14 },   // Entrega
        6: { cellWidth: 12 },   // Hard
        7: { cellWidth: 12 },   // Soft
        8: { cellWidth: 12 },   // Block
        9: { cellWidth: 14 },   // Ab.
        10:{ cellWidth: 13 },   // Taxa Ab.
        11:{ cellWidth: 14 },   // Cliques
        12:{ cellWidth: 13 },   // Taxa Cl.
        13:{ cellWidth: 12 },   // Opt-out
      } : {
        0: { cellWidth: 18 },   // Data
        1: { cellWidth: 42 },   // Nome
        2: { cellWidth: 52 },   // Assunto
        3: { cellWidth: 16 },   // Enviados
        4: { cellWidth: 14 },   // Entrega
        5: { cellWidth: 12 },   // Hard
        6: { cellWidth: 12 },   // Soft
        7: { cellWidth: 12 },   // Block
        8: { cellWidth: 14 },   // Ab.
        9: { cellWidth: 13 },   // Taxa Ab.
        10:{ cellWidth: 14 },   // Cliques
        11:{ cellWidth: 13 },   // Taxa Cl.
        12:{ cellWidth: 12 },   // Opt-out
      },
    });

    const dateStr = new Date().toISOString().slice(0,10);
    doc.save(`primetour_newsletters_${dateStr}.pdf`);
    toast.success(`PDF gerado com ${rows.length} disparos.`);
  } catch(e) {
    toast.error('Erro ao gerar PDF: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ PDF'; }
  }
}

/* ─── KPI cards ───────────────────────────────────────────── */
function renderKpis(rows) {
  const el = document.getElementById('nl-kpis');
  if (!el) return;
  const visible = rows.filter(r => !hiddenRows.has(r.jobId));
  if (!visible.length) { el.innerHTML = ''; return; }

  const avg = key => {
    const vals = visible.map(r => r[key]).filter(v => v != null && !isNaN(v));
    return vals.length ? vals.reduce((a,b) => a+b, 0) / vals.length : null;
  };
  const sum = key => visible.reduce((a,r) => a + (Number(r[key])||0), 0);

  const kpis = [
    { label: 'Disparos',         value: visible.length.toLocaleString('pt-BR'), sub: 'no período' },
    { label: 'Enviados total',   value: sum('totalSent').toLocaleString('pt-BR'), sub: 'emails' },
    { label: 'Taxa de abertura', value: pct(avg('openRate')),    sub: 'média única' },
    { label: 'Taxa de cliques',  value: pct(avg('clickRate')),   sub: 'média única' },
    { label: 'Taxa de entrega',  value: pct(avg('deliveryRate')), sub: 'média' },
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

/* ─── Style helpers ───────────────────────────────────────── */
function thStyle(active = false) {
  return `padding:10px 12px;text-align:left;font-size:0.6875rem;font-weight:600;
    text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;cursor:pointer;
    border-bottom:1px solid var(--border-subtle);
    ${active ? 'color:var(--brand-gold);' : 'color:var(--text-muted);'}`;
}
function tdStyle(align = 'left', wrap = false) {
  return `padding:9px 12px;text-align:${align};vertical-align:middle;
    ${wrap ? 'white-space:normal;word-break:break-word;' : 'white-space:nowrap;'}
    color:var(--text-primary);`;
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
    'btg-partners':       '#38BDF8',
    'btg-ultrablue':      '#818CF8',
    'centurion':          '#34D399',
    'pts':                '#F472B6',
    'primetour-lazer':    '#D4A843',
    'primetour-agencias': '#E88C30',
    'qualidade':          '#A78BFA',
  };
  const c = colors[id] || '#6B7280';
  return `<span style="display:inline-flex;align-items:center;font-size:0.75rem;
    padding:2px 8px;border-radius:var(--radius-full);
    background:${c}15;color:${c};border:1px solid ${c}30;white-space:nowrap;">
    ${esc(name || id)}
  </span>`;
}
