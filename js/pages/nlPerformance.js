/**
 * PRIMETOUR — Performance de Newsletters
 * Lê dados sincronizados do Salesforce Marketing Cloud via Firestore
 * Features: colunas fixas, exportação XLSX + PDF com pré-edição de linhas
 */

import { store }      from '../store.js';
import { toast }      from '../components/toast.js';
import { APP_CONFIG } from '../config.js';
import { createDoc, loadJsPdf, COL, txt, withExportGuard } from '../components/pdfKit.js';
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
    </div>

    <!-- Tabs -->
    <div style="display:flex;gap:0;border-bottom:2px solid var(--border-subtle);margin-bottom:20px;">
      <button class="nl-tab active" data-tab="performance"
        style="padding:10px 20px;border:none;background:transparent;font-size:0.875rem;font-weight:600;
        cursor:pointer;border-bottom:2px solid var(--brand-gold);margin-bottom:-2px;
        color:var(--brand-gold);font-family:var(--font-ui);">
        📊 Performance
      </button>
      <button class="nl-tab" data-tab="calendar"
        style="padding:10px 20px;border:none;background:transparent;font-size:0.875rem;font-weight:500;
        cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;
        color:var(--text-muted);font-family:var(--font-ui);">
        📅 Calendário Editorial
      </button>
      <button class="nl-tab" data-tab="content"
        style="padding:10px 20px;border:none;background:transparent;font-size:0.875rem;font-weight:500;
        cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;
        color:var(--text-muted);font-family:var(--font-ui);">
        🌍 Conteúdo &amp; Temas
      </button>
    </div>

    <!-- Tab: Performance -->
    <div id="nl-tab-performance">

    <div class="page-header" style="margin-top:0;">
      <div class="page-header-left"></div>
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
    <div id="nl-kpis-block" style="margin-bottom:24px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
        <h3 style="margin:0;font-size:0.8125rem;font-weight:600;color:var(--text-secondary);
          text-transform:uppercase;letter-spacing:0.06em;">📊 Indicadores</h3>
        <span class="widget-insights-slot" data-widget-id="nl-kpis-block"></span>
      </div>
      <div id="nl-kpis" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;">
        ${[0,1,2,3,4].map(()=>`<div class="card skeleton" style="height:80px;"></div>`).join('')}
      </div>
    </div>

    <!-- Table with sticky first 2 cols -->
    <div id="nl-table-block">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
        <h3 style="margin:0;font-size:0.8125rem;font-weight:600;color:var(--text-secondary);
          text-transform:uppercase;letter-spacing:0.06em;">📋 Disparos</h3>
        <span class="widget-insights-slot" data-widget-id="nl-table-block"></span>
      </div>
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
    </div>

    <!-- Análise Geral do tab Performance -->
    <div id="nl-perf-insights-section" style="margin-top:24px;"></div>
    </div><!-- /nl-tab-performance -->

    <!-- Tab: Calendário Editorial -->
    <div id="nl-tab-calendar" style="display:none;">
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:16px;">
        <button class="btn btn-secondary btn-sm" id="nl-cal-export-xlsx">⬇ XLSX</button>
        <button class="btn btn-secondary btn-sm" id="nl-cal-export-pdf">⬇ PDF</button>
      </div>
      <!-- KPIs com slot de insights -->
      <div id="nl-cal-kpis-block" style="margin-bottom:24px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
          <h3 style="margin:0;font-size:0.8125rem;font-weight:600;color:var(--text-secondary);
            text-transform:uppercase;letter-spacing:0.06em;">📊 Indicadores do Calendário</h3>
          <span class="widget-insights-slot" data-widget-id="nl-cal-kpis-block"></span>
        </div>
        <div id="nl-cal-kpis" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;">
          <div class="card skeleton" style="height:90px;"></div>
          <div class="card skeleton" style="height:90px;"></div>
          <div class="card skeleton" style="height:90px;"></div>
          <div class="card skeleton" style="height:90px;"></div>
          <div class="card skeleton" style="height:90px;"></div>
        </div>
      </div>
      <div id="nl-cal-details" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div id="nl-cal-compliance-card" class="card" style="padding:16px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
            <div style="flex:1;font-size:0.6875rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">
              📅 Cumprimento do Calendário
            </div>
            <span class="widget-insights-slot" data-widget-id="nl-cal-compliance-card"></span>
          </div>
          <div id="nl-cal-compliance"></div>
        </div>
        <div id="nl-cal-top-requesters-card" class="card" style="padding:16px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
            <div style="flex:1;font-size:0.6875rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">
              👤 Top Solicitantes
            </div>
            <span class="widget-insights-slot" data-widget-id="nl-cal-top-requesters-card"></span>
          </div>
          <div id="nl-cal-top-requesters"></div>
        </div>
      </div>
      <div id="nl-cal-table-card" class="card" style="padding:16px;margin-top:16px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
          <div style="flex:1;font-size:0.6875rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">
            📋 Detalhamento de Solicitações
          </div>
          <span class="widget-insights-slot" data-widget-id="nl-cal-table-card"></span>
        </div>
        <div id="nl-cal-table"></div>
      </div>

      <!-- Análise Geral do tab Calendar -->
      <div id="nl-cal-insights-section" style="margin-top:24px;"></div>
    </div><!-- /nl-tab-calendar -->

    <!-- Tab: Conteúdo & Temas -->
    <div id="nl-tab-content" style="display:none;">
      <div class="page-header" style="margin-top:0;">
        <div class="page-header-left">
          <p style="margin:4px 0 0 0;color:var(--text-muted);font-size:0.875rem;">
            Análise das newsletters por destinos, hotéis, marcas, temas e argumentos —
            extraído automaticamente do HTML via IA (agente
            <a href="#ai-hub" style="color:var(--brand-gold);">"Extrator de Conteúdo de Newsletter"</a>).
          </p>
        </div>
        <div class="page-header-actions" style="gap:8px;flex-wrap:wrap;">
          <button class="btn btn-secondary btn-sm" id="nl-content-refresh">↻ Atualizar</button>
          <button class="btn btn-secondary btn-sm" id="nl-content-pdf">⬇ PDF</button>
        </div>
      </div>

      <!-- Filters -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;align-items:center;">
        <select class="filter-select" id="nlc-bu-filter" style="min-width:140px;">
          <option value="">Todas as unidades</option>
          ${BUS.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}
        </select>
        <select class="filter-select" id="nlc-period-filter" style="min-width:130px;">
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="180" selected>Últimos 180 dias</option>
          <option value="365">Último ano</option>
          <option value="">Todo período</option>
        </select>
        <select class="filter-select" id="nlc-type-filter" style="min-width:130px;">
          <option value="">Todos os tipos</option>
        </select>
        <select class="filter-select" id="nlc-country-filter" style="min-width:130px;">
          <option value="">Todos países</option>
        </select>
        <select class="filter-select" id="nlc-city-filter" style="min-width:140px;">
          <option value="">Todas cidades</option>
        </select>
        <select class="filter-select" id="nlc-theme-filter" style="min-width:130px;">
          <option value="">Todos temas</option>
        </select>
        <input type="text" id="nlc-search" class="portal-field" placeholder="Buscar hotel/cidade…"
          style="min-width:160px;font-size:0.8125rem;flex:1;">
        <span id="nlc-meta" style="margin-left:auto;font-size:0.75rem;color:var(--text-muted);"></span>
      </div>

      <!-- Conteúdo dinâmico -->
      <div id="nlc-content"></div>
    </div><!-- /nl-tab-content -->
  `;

  let editMode = false;

  // Tab switching
  container.querySelectorAll('.nl-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.nl-tab').forEach(t => {
        t.style.borderBottomColor = 'transparent';
        t.style.color = 'var(--text-muted)';
        t.style.fontWeight = '500';
        t.classList.remove('active');
      });
      tab.style.borderBottomColor = 'var(--brand-gold)';
      tab.style.color = 'var(--brand-gold)';
      tab.style.fontWeight = '600';
      tab.classList.add('active');

      document.getElementById('nl-tab-performance').style.display = tab.dataset.tab === 'performance' ? 'block' : 'none';
      document.getElementById('nl-tab-calendar').style.display    = tab.dataset.tab === 'calendar'    ? 'block' : 'none';
      document.getElementById('nl-tab-content').style.display     = tab.dataset.tab === 'content'     ? 'block' : 'none';

      if (tab.dataset.tab === 'calendar') {
        loadCalendarDashboard();
      } else if (tab.dataset.tab === 'content') {
        loadContentTab();
      }
    });
  });

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
  document.getElementById('nl-cal-export-xlsx')?.addEventListener('click', exportCalXLSX);
  document.getElementById('nl-cal-export-pdf')?.addEventListener('click',  exportCalPDF);

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
  // Setup insights na primeira vez que dados estão prontos
  if (allData?.length) {
    setTimeout(() => setupNlPerformanceInsights(), 500);
  }

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

    // Sheet "Insights" — histórico completo de observações no dashboard NL
    try {
      const { fetchInsights, insightsToXlsxRows } = await import('../services/insights.js?v=20260503uu1');
      const insights = await fetchInsights({ dashboard: 'nl', max: 200 });
      if (insights.length) {
        const widgetLabels = window.__INSIGHT_WIDGET_LABELS?.nl || {};
        const insRows = insightsToXlsxRows(insights, widgetLabels);
        const wsIns = window.XLSX.utils.json_to_sheet(insRows);
        wsIns['!cols'] = [{wch:30},{wch:14},{wch:10},{wch:50},{wch:60},{wch:60},{wch:50},{wch:25},{wch:12},{wch:24},{wch:20},{wch:18}];
        window.XLSX.utils.book_append_sheet(wb, wsIns, 'Insights');
      }
    } catch (e) { console.warn('insights nl xlsx:', e); }

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
const exportPDF = withExportGuard(async function exportPDF() {
  const btn = document.getElementById('nl-export-pdf');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    await loadJsPdf();
    if (!window.jspdf?.jsPDF?.API?.autoTable) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.1/jspdf.plugin.autotable.min.js';
        s.onload = res; s.onerror = rej; document.head.appendChild(s);
      });
    }

    const rows    = getExportRows();
    const visible = rows.filter(r => !hiddenRows.has(r.jobId));
    const hasBu   = !filterBu;
    const bu      = filterBu ? (BUS.find(b => b.id === filterBu)?.name || filterBu) : 'Todas as unidades';

    const kit = createDoc({ orientation: 'landscape', margin: 14 });
    const { doc, W, M, CW, setFill, setText } = kit;

    kit.drawCover({
      title: 'Performance de Newsletters',
      subtitle: 'PRIMETOUR  ·  Locaweb Email Marketing',
      meta: `${rows.length} disparos  ·  ${bu}`,
      compact: true,
    });

    // ── KPIs ──
    const avg = key => {
      const vals = visible.map(r => r[key]).filter(v => v != null && !isNaN(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    };
    const sum = key => visible.reduce((a, r) => a + (Number(r[key]) || 0), 0);
    const openR = avg('openRate');
    const clickR = avg('clickRate');
    const deliv = avg('deliveryRate');
    const kpis = [
      { label: 'Disparos',     value: String(visible.length),                    col: COL.blue   },
      { label: 'Enviados',     value: sum('totalSent').toLocaleString('pt-BR'),  col: COL.brand2 },
      { label: 'Tx. Abertura', value: pct(openR),
        col: openR >= 20 ? COL.green : openR >= 10 ? COL.orange : COL.red },
      { label: 'Tx. Cliques',  value: pct(clickR),
        col: clickR >= 3 ? COL.green : clickR >= 1 ? COL.orange : COL.red },
      { label: 'Tx. Entrega',  value: pct(deliv),
        col: deliv >= 95 ? COL.green : deliv >= 85 ? COL.orange : COL.red },
    ];
    const gap = 3;
    const kpiW = (CW - gap * (kpis.length - 1)) / kpis.length;
    const kpiH = 18;
    let y = kit.y;
    kpis.forEach((k, i) => {
      const x = M + i * (kpiW + gap);
      setFill(COL.white); doc.roundedRect(x, y, kpiW, kpiH, 1.5, 1.5, 'F');
      setFill(k.col);     doc.rect(x, y, kpiW, 1.4, 'F');
      setText(COL.text);  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
      doc.text(txt(k.value), x + kpiW / 2, y + 10, { align: 'center' });
      setText(COL.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
      doc.text(txt(k.label.toUpperCase()), x + kpiW / 2, y + 15, { align: 'center' });
    });
    kit.y = y + kpiH + 6;

    // ── Top 5 disparos por abertura ──
    if (visible.length) {
      const top = [...visible]
        .sort((a, b) => (b.openRate || 0) - (a.openRate || 0))
        .slice(0, Math.min(5, visible.length));
      setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.text(txt('DESTAQUES POR ABERTURA'), M, kit.y);
      kit.y += 4;
      const cardW = (CW - gap * (top.length - 1)) / top.length;
      const cardH = 30;
      const cy = kit.y;
      top.forEach((r, i) => {
        const x = M + i * (cardW + gap);
        setFill(COL.subBg); doc.roundedRect(x, cy, cardW, cardH, 1.5, 1.5, 'F');
        setFill(COL.green); doc.rect(x, cy, cardW, 1.2, 'F');
        setText(COL.gold); doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
        doc.text(txt(`#${i + 1}  ${fmt(r.sentDate)}`), x + 3, cy + 5.5);
        setText(COL.green); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
        doc.text(txt(pct(r.openRate)), x + cardW - 3, cy + 11, { align: 'right' });
        setText(COL.text); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
        const name = kit.wrap(r.name || '(sem nome)', cardW - 6, 8).slice(0, 2);
        doc.text(name, x + 3, cy + 13);
        setText(COL.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
        const sub = kit.wrap(r.subject || '', cardW - 6, 6.5).slice(0, 1);
        doc.text(sub, x + 3, cy + 22);
        doc.text(txt(`env ${num(r.totalSent)}  ·  cl ${pct(r.clickRate)}`), x + 3, cy + cardH - 2);
      });
      kit.y = cy + cardH + 6;
    }

    // ── Tabela ──
    kit.ensureSpace(30);
    setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(txt('TODOS OS DISPAROS'), M, kit.y);
    kit.y += 3;

    const head = [[
      ...(hasBu ? ['Unidade'] : []),
      'Data', 'Nome', 'Assunto', 'Enviados', 'Entrega',
      'Hard', 'Soft', 'Block', 'Abertura', '% Ab.', 'Cliques', '% Cl.', 'Opt-out',
    ]];
    const body = rows.map(r => [
      ...(hasBu ? [r.virtualBuName] : []),
      fmt(r.sentDate), txt((r.name || '').slice(0, 32)), txt((r.subject || '').slice(0, 40)),
      num(r.totalSent), pct(r.deliveryRate),
      num(r.hardBounce), num(r.softBounce), num(r.blockBounce),
      num(r.openUnique), pct(r.openRate), num(r.clickUnique), pct(r.clickRate), num(r.optOut),
    ]);

    doc.autoTable({
      head, body, startY: kit.y,
      margin: { left: M, right: M, bottom: 14 },
      styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak', textColor: COL.text },
      headStyles: { fillColor: COL.brand, textColor: 255, fontStyle: 'bold', fontSize: 6.5 },
      alternateRowStyles: { fillColor: COL.subBg },
      didParseCell: (data) => {
        if (data.section === 'body') {
          const colIdx = data.column.index - (hasBu ? 1 : 0);
          if ([5, 9, 10].includes(colIdx)) {
            const val = parseFloat(String(data.cell.raw).replace('%', '').replace(',', '.'));
            if (!isNaN(val)) {
              data.cell.styles.textColor = val >= 20 ? COL.green : val >= 10 ? COL.orange : COL.red;
              data.cell.styles.fontStyle = 'bold';
            }
          }
        }
      },
    });
    // Atualiza cursor pra próxima seção não sobrepor a tabela.
    kit.y = doc.lastAutoTable.finalY + 8;

    // Insights & Observações — agrupados por widget (Performance tab)
    try {
      const { fetchInsights, groupInsightsByIndex, formatInsightPeriod, formatDataSnapshot } =
        await import('../services/insights.js?v=20260503uu1');
      const insights = await fetchInsights({ dashboard: 'nl', max: 200 });
      if (insights.length) {
        const widgetLabels = window.__INSIGHT_WIDGET_LABELS?.nl || {};
        const groups = groupInsightsByIndex(insights, widgetLabels);
        // M já vem do kit destructure no início da função
        kit.ensureSpace(40);
        setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
        doc.text(txt('INSIGHTS & OBSERVACOES'), M, kit.y);
        kit.y += 4;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
        setText(COL.muted);
        doc.text(txt(`${insights.length} insights no historico`), M, kit.y);
        kit.y += 5;

        const stripEmoji = s => String(s ?? '')
          .replace(/[\u{1F300}-\u{1FFFF}]/gu, '').replace(/[\u{2400}-\u{27BF}]/gu, '')
          .replace(/[\u{2000}-\u{206F}]/gu, '').trim();
        const safe = s => txt(stripEmoji(s));

        groups.forEach((group) => {
          kit.ensureSpace(20);
          setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
          doc.text(safe(`${group.groupLabel} (${group.items.length})`), M, kit.y);
          kit.y += 3;
          doc.autoTable({
            startY: kit.y, margin: { left: M, right: M },
            head: [['Tipo', 'Impacto', 'Titulo', 'Observacao', 'Dados', 'Periodo', 'Origem', 'Por']],
            body: group.items.map(ins => [
              ins.type || 'neutral', ins.impact || 'medium',
              safe(ins.title || ''), safe(ins.observation || ''),
              safe(formatDataSnapshot(ins.dataSnapshot) || '-'),
              safe(formatInsightPeriod(ins) || '-'),
              ins.source === 'ai-generated' ? 'IA' : ins.source === 'ai-edited' ? 'IA edit.' : 'Manual',
              safe((ins.createdBy?.name || '-')),
            ]),
            styles: { fontSize: 6, cellPadding: 1.8, overflow: 'linebreak' },
            headStyles: { fillColor: [26,42,74], textColor: 255, fontStyle: 'bold', fontSize: 6 },
            columnStyles: {
              0:{cellWidth:14}, 1:{cellWidth:11}, 2:{cellWidth:36},
              3:{cellWidth:48}, 4:{cellWidth:48}, 5:{cellWidth:24},
              6:{cellWidth:13}, 7:{cellWidth:24},
            },
            didDrawPage: (data) => { kit.y = data.cursor.y; },
          });
          kit.y = doc.lastAutoTable.finalY + 5;
        });
      }
    } catch (e) { console.warn('insights nl pdf:', e); }

    kit.drawFooter('PRIMETOUR  ·  Performance de Newsletters');
    doc.save(`primetour_newsletters_${new Date().toISOString().slice(0, 10)}.pdf`);
    toast.success(`PDF gerado com ${rows.length} disparos.`);
  } catch (e) {
    toast.error('Erro ao gerar PDF: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ PDF'; }
  }
});

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

  // Taxa de opt-out: total descadastros / total enviado no período
  const totalSent = sum('totalSent');
  const totalOptOut = sum('optOut');
  const optOutRate = totalSent > 0 ? (totalOptOut / totalSent) * 100 : null;

  const kpis = [
    { label: 'Disparos',         value: visible.length.toLocaleString('pt-BR'), sub: 'no período' },
    { label: 'Enviados total',   value: totalSent.toLocaleString('pt-BR'), sub: 'emails' },
    { label: 'Taxa de abertura', value: pct(avg('openRate')),    sub: 'média única' },
    { label: 'Taxa de cliques',  value: pct(avg('clickRate')),   sub: 'média única' },
    { label: 'Taxa de entrega',  value: pct(avg('deliveryRate')), sub: 'média' },
    { label: 'Taxa de opt-out',  value: pct(optOutRate),
      sub: `${totalOptOut.toLocaleString('pt-BR')} / ${totalSent.toLocaleString('pt-BR')} enviados` },
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

/* ═══════════════════════════════════════════════════════════
 *  Exportação — Calendário Editorial
 * ═══════════════════════════════════════════════════════════ */

async function exportCalXLSX() {
  if (!calDashData) { toast.error('Carregue a aba Calendário primeiro.'); return; }
  const btn = document.getElementById('nl-cal-export-xlsx');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    if (!window.XLSX) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload = res; s.onerror = rej; document.head.appendChild(s);
      });
    }
    const d = calDashData;
    const wb = window.XLSX.utils.book_new();

    // Sheet 1: KPIs
    const kpiData = [
      ['Métrica', 'Valor', 'Detalhe'],
      ['Cumprimento do Calendário', d.complianceRate + '%', `${d.fulfilledSlots} de ${d.expectedSlots} slots (90 dias)`],
      ['Total de Solicitações', d.allRequests.length, ''],
      ['Solicitações Urgentes', d.urgentRequests.length, d.allRequests.length ? Math.round((d.urgentRequests.length/d.allRequests.length)*100) + '% do total' : ''],
      ['Fora do Calendário', d.outOfCalendar.length, d.allRequests.length ? Math.round((d.outOfCalendar.length/d.allRequests.length)*100) + '% do total' : ''],
      ['Tempo Médio de Entrega', d.avgDays !== '—' ? d.avgDays + ' dias' : 'Sem dados', `SLA: ${d.slaDays} dias · ${d.countDelivered} entregas`],
    ];
    const wsKpi = window.XLSX.utils.aoa_to_sheet(kpiData);
    wsKpi['!cols'] = [{ wch: 30 }, { wch: 20 }, { wch: 40 }];
    window.XLSX.utils.book_append_sheet(wb, wsKpi, 'KPIs');

    // Sheet 2: Top Solicitantes
    const topData = [['#', 'Solicitante', 'Qtd. Solicitações'], ...d.topRequesters.map(([name, count], i) => [i + 1, name, count])];
    const wsTop = window.XLSX.utils.aoa_to_sheet(topData);
    wsTop['!cols'] = [{ wch: 5 }, { wch: 30 }, { wch: 20 }];
    window.XLSX.utils.book_append_sheet(wb, wsTop, 'Top Solicitantes');

    // Sheet 3: Solicitações
    const STATUS_LABELS = { pending: 'Aguardando', converted: 'Convertida', rejected: 'Recusada' };
    const reqHeaders = ['Data', 'Título', 'Solicitante', 'E-mail', 'Status', 'Urgente', 'Fora do Cal.', 'Setor', 'Área'];
    const reqRows = [...d.allRequests]
      .sort((a, b) => {
        const da = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
        const db2 = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
        return db2 - da;
      })
      .map(r => {
        const created = r.createdAt?.toDate ? r.createdAt.toDate() : new Date(r.createdAt || 0);
        return [
          fmt(created), r.title || '—', r.requesterName || '—', r.requesterEmail || '—',
          STATUS_LABELS[r.status] || r.status || '—',
          r.urgency ? 'Sim' : 'Não', r.outOfCalendar ? 'Sim' : 'Não',
          r.sector || '—', r.requestingArea || '—',
        ];
      });
    const wsReq = window.XLSX.utils.aoa_to_sheet([reqHeaders, ...reqRows]);
    wsReq['!cols'] = [{ wch: 18 }, { wch: 40 }, { wch: 25 }, { wch: 30 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 16 }, { wch: 16 }];
    window.XLSX.utils.book_append_sheet(wb, wsReq, 'Solicitações');

    // Sheet 4: Tarefas
    const taskHeaders = ['Título', 'Status', 'Data Entrega', 'Área Solicitante', 'Criação'];
    const taskRows = d.allTasks.map(t => {
      const due = t.dueDate?.toDate ? t.dueDate.toDate() : t.startDate?.toDate ? t.startDate.toDate() : null;
      const created = t.createdAt?.toDate ? t.createdAt.toDate() : null;
      return [t.title || '—', t.status || '—', due ? fmt(due) : '—', t.requestingArea || '—', created ? fmt(created) : '—'];
    });
    const wsTask = window.XLSX.utils.aoa_to_sheet([taskHeaders, ...taskRows]);
    wsTask['!cols'] = [{ wch: 40 }, { wch: 14 }, { wch: 18 }, { wch: 20 }, { wch: 18 }];
    window.XLSX.utils.book_append_sheet(wb, wsTask, 'Tarefas');

    const dateStr = new Date().toISOString().slice(0, 10);
    window.XLSX.writeFile(wb, `primetour_calendario_editorial_${dateStr}.xlsx`);
    toast.success('Calendário editorial exportado (XLSX).');
  } catch (e) {
    toast.error('Erro ao exportar: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ XLSX'; }
  }
}

const exportCalPDF = withExportGuard(async function exportCalPDF() {
  if (!calDashData) { toast.error('Carregue a aba Calendário primeiro.'); return; }
  const btn = document.getElementById('nl-cal-export-pdf');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    await loadJsPdf();
    if (!window.jspdf?.jsPDF?.API?.autoTable) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.1/jspdf.plugin.autotable.min.js';
        s.onload = res; s.onerror = rej; document.head.appendChild(s);
      });
    }
    const d = calDashData;
    const kit = createDoc({ orientation: 'landscape', margin: 14 });
    const { doc, W, M, CW, setFill, setText } = kit;

    kit.drawCover({
      title: 'Calendario Editorial — Dashboard',
      subtitle: 'PRIMETOUR  ·  Newsletter',
      meta: `${d.allRequests.length} solicitacoes  ·  cumprimento ${d.complianceRate}%`,
      compact: true,
    });

    // ── KPIs ──
    const complianceCol = d.complianceRate >= 80 ? COL.green : d.complianceRate >= 60 ? COL.orange : COL.red;
    const urgCol   = d.urgentRequests.length > 0 ? COL.red : COL.green;
    const foraCol  = d.outOfCalendar.length > 0 ? COL.orange : COL.green;
    const tempoCol = d.slaOk ? COL.green : COL.red;
    const kpis = [
      { label: 'Cumprimento',   value: d.complianceRate + '%',                         col: complianceCol },
      { label: 'Solicitacoes',  value: String(d.allRequests.length),                   col: COL.blue },
      { label: 'Urgentes',      value: String(d.urgentRequests.length),                col: urgCol },
      { label: 'Fora Cal.',     value: String(d.outOfCalendar.length),                 col: foraCol },
      { label: 'Tempo Medio',   value: d.avgDays !== '—' ? d.avgDays + 'd' : '—',      col: tempoCol },
    ];
    const gap = 3;
    const kpiW = (CW - gap * (kpis.length - 1)) / kpis.length;
    const kpiH = 18;
    let y = kit.y;
    kpis.forEach((k, i) => {
      const x = M + i * (kpiW + gap);
      setFill(COL.white); doc.roundedRect(x, y, kpiW, kpiH, 1.5, 1.5, 'F');
      setFill(k.col);     doc.rect(x, y, kpiW, 1.4, 'F');
      setText(COL.text);  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
      doc.text(txt(k.value), x + kpiW / 2, y + 10, { align: 'center' });
      setText(COL.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
      doc.text(txt(k.label.toUpperCase()), x + kpiW / 2, y + 15, { align: 'center' });
    });
    kit.y = y + kpiH + 6;

    // ── Top solicitantes: barras horizontais ──
    if (d.topRequesters.length) {
      setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.text(txt('TOP SOLICITANTES'), M, kit.y);
      kit.y += 4;
      const max = d.topRequesters[0][1] || 1;
      const rowH = 6;
      const labW = 60;
      d.topRequesters.slice(0, 8).forEach(([name, count]) => {
        const yy = kit.y;
        setText(COL.text); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
        doc.text(txt(String(name).slice(0, 36)), M, yy + 3.5);
        const barX = M + labW;
        const barMax = (CW / 2) - labW;
        kit.drawBar(barX, yy + 2, barMax, (count / max) * 100, COL.brand2, 2.2);
        setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
        doc.text(txt(String(count)), barX + barMax + 3, yy + 3.8);
        kit.y += rowH;
      });
      kit.y += 3;
    }

    // ── Solicitações table ──
    const STATUS_LABELS = { pending: 'Aguardando', converted: 'Convertida', rejected: 'Recusada' };
    const sorted = [...d.allRequests].sort((a, b) => {
      const da = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
      const db2 = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
      return db2 - da;
    });

    kit.ensureSpace(24);
    setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(txt('SOLICITACOES DE NEWSLETTER'), M, kit.y);
    kit.y += 3;

    doc.autoTable({
      startY: kit.y,
      margin: { left: M, right: M, bottom: 14 },
      head: [['Data', 'Titulo', 'Solicitante', 'Status', 'Urg.', 'Fora Cal.']],
      body: sorted.map(r => {
        const created = r.createdAt?.toDate ? r.createdAt.toDate() : new Date(r.createdAt || 0);
        return [
          fmt(created),
          txt((r.title || '-').slice(0, 40)),
          txt((r.requesterName || '-').slice(0, 25)),
          STATUS_LABELS[r.status] || r.status || '-',
          r.urgency ? 'Sim' : '', r.outOfCalendar ? 'Sim' : '',
        ];
      }),
      styles: { fontSize: 7, cellPadding: 2, textColor: COL.text },
      headStyles: { fillColor: COL.brand, textColor: 255, fontStyle: 'bold', fontSize: 7 },
      alternateRowStyles: { fillColor: COL.subBg },
      columnStyles: {
        0: { cellWidth: 25 }, 1: { cellWidth: 80 }, 2: { cellWidth: 45 },
        3: { cellWidth: 24 }, 4: { cellWidth: 14 }, 5: { cellWidth: 18 },
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 3) {
          const v = String(data.cell.raw).toLowerCase();
          data.cell.styles.fontStyle = 'bold';
          if (v.includes('convert')) data.cell.styles.textColor = COL.green;
          else if (v.includes('recus')) data.cell.styles.textColor = COL.red;
          else if (v.includes('agua'))  data.cell.styles.textColor = COL.orange;
        }
        if (data.section === 'body' && data.column.index === 4 && data.cell.raw === 'Sim') {
          data.cell.styles.textColor = COL.red; data.cell.styles.fontStyle = 'bold';
        }
        if (data.section === 'body' && data.column.index === 5 && data.cell.raw === 'Sim') {
          data.cell.styles.textColor = COL.orange; data.cell.styles.fontStyle = 'bold';
        }
      },
    });
    kit.y = doc.lastAutoTable.finalY + 8;

    // Insights & Observações (mesmo bloco do Performance — dashboard='nl' compartilha)
    try {
      const { fetchInsights, groupInsightsByIndex, formatInsightPeriod, formatDataSnapshot } =
        await import('../services/insights.js?v=20260503uu1');
      const insights = await fetchInsights({ dashboard: 'nl', max: 200 });
      if (insights.length) {
        const widgetLabels = window.__INSIGHT_WIDGET_LABELS?.nl || {};
        const groups = groupInsightsByIndex(insights, widgetLabels);
        kit.ensureSpace(40);
        setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
        doc.text(txt('INSIGHTS & OBSERVACOES'), M, kit.y);
        kit.y += 5;
        const stripEmoji = s => String(s ?? '')
          .replace(/[\u{1F300}-\u{1FFFF}]/gu, '').replace(/[\u{2400}-\u{27BF}]/gu, '')
          .replace(/[\u{2000}-\u{206F}]/gu, '').trim();
        const safe = s => txt(stripEmoji(s));
        groups.forEach((group) => {
          kit.ensureSpace(20);
          setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
          doc.text(safe(`${group.groupLabel} (${group.items.length})`), M, kit.y);
          kit.y += 3;
          doc.autoTable({
            startY: kit.y, margin: { left: M, right: M },
            head: [['Tipo', 'Impacto', 'Titulo', 'Observacao', 'Dados', 'Periodo', 'Origem', 'Por']],
            body: group.items.map(ins => [
              ins.type || 'neutral', ins.impact || 'medium',
              safe(ins.title || ''), safe(ins.observation || ''),
              safe(formatDataSnapshot(ins.dataSnapshot) || '-'),
              safe(formatInsightPeriod(ins) || '-'),
              ins.source === 'ai-generated' ? 'IA' : ins.source === 'ai-edited' ? 'IA edit.' : 'Manual',
              safe((ins.createdBy?.name || '-')),
            ]),
            styles: { fontSize: 6, cellPadding: 1.8, overflow: 'linebreak' },
            headStyles: { fillColor: [26,42,74], textColor: 255, fontStyle: 'bold', fontSize: 6 },
            columnStyles: {
              0:{cellWidth:14}, 1:{cellWidth:11}, 2:{cellWidth:36},
              3:{cellWidth:48}, 4:{cellWidth:48}, 5:{cellWidth:24},
              6:{cellWidth:13}, 7:{cellWidth:24},
            },
            didDrawPage: (data) => { kit.y = data.cursor.y; },
          });
          kit.y = doc.lastAutoTable.finalY + 5;
        });
      }
    } catch (e) { console.warn('insights nl-cal pdf:', e); }

    kit.drawFooter('PRIMETOUR  ·  Calendario Editorial');
    doc.save(`primetour_calendario_editorial_${new Date().toISOString().slice(0, 10)}.pdf`);
    toast.success('Calendário editorial exportado (PDF).');
  } catch (e) {
    toast.error('Erro ao exportar PDF: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ PDF'; }
  }
});

/* ═══════════════════════════════════════════════════════════
 *  ABA: Calendário Editorial — Dashboard de Newsletter
 * ═══════════════════════════════════════════════════════════ */

let calDashLoaded = false;
let calDashData = null; // stored for exports

async function loadCalendarDashboard() {
  if (calDashLoaded) return;
  calDashLoaded = true;

  try {
    const { where } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

    // 1. Load newsletter tasks (typeId=newsletter or type=newsletter)
    const [snap1, snap2, reqSnap, typeSnap] = await Promise.all([
      getDocs(query(collection(db, 'tasks'), where('typeId', '==', 'newsletter'), limit(500))),
      getDocs(query(collection(db, 'tasks'), where('type', '==', 'newsletter'), limit(500))).catch(() => ({ docs: [] })),
      getDocs(query(collection(db, 'requests'), where('typeId', '==', 'newsletter'), limit(500))).catch(() => ({ docs: [] })),
      getDocs(query(collection(db, 'task_types'), limit(50))),
    ]);

    // Deduplicate tasks
    const seen = new Set();
    const allTasks = [];
    [...snap1.docs, ...snap2.docs].forEach(d => {
      if (seen.has(d.id)) return;
      seen.add(d.id);
      allTasks.push({ id: d.id, ...d.data() });
    });

    const allRequests = reqSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Get newsletter type with schedule slots
    const nlType = typeSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .find(t => t.id === 'newsletter' || t.name?.toLowerCase() === 'newsletter');
    const scheduleSlots = nlType?.scheduleSlots?.filter(s => s.active !== false) || [];
    const slaDays = nlType?.sla?.days || 2;

    // 2. Calculate metrics
    const now = new Date();
    const users = store.get('users') || [];

    // ── Cumprimento do calendário (últimos 90 dias) ──
    const last90 = new Date(); last90.setDate(last90.getDate() - 90);
    let expectedSlots = 0;
    let fulfilledSlots = 0;

    // Count expected slots in last 90 days
    for (let d = new Date(last90); d <= now; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      const dm = d.getDate();
      const iso = d.toISOString().slice(0, 10);
      if (dow === 0 || dow === 6) continue;
      scheduleSlots.forEach(s => {
        let matches = false;
        if (s.recurrence === 'weekly' && s.weekDay === dow) matches = true;
        if (s.recurrence === 'monthly_days' && (s.monthDays || []).includes(dm)) matches = true;
        if (s.recurrence === 'custom' && (s.customDates || []).includes(iso)) matches = true;
        if (matches) expectedSlots++;
      });
    }

    // Count fulfilled (tasks that exist for those dates)
    allTasks.forEach(t => {
      const dd = t.dueDate || t.startDate;
      if (!dd) return;
      const d = dd.toDate ? dd.toDate() : new Date(dd);
      if (d >= last90 && d <= now && t.status !== 'cancelled') fulfilledSlots++;
    });
    const complianceRate = expectedSlots > 0 ? Math.round((fulfilledSlots / expectedSlots) * 100) : 0;

    // ── Solicitações urgentes ──
    const urgentRequests = allRequests.filter(r => r.urgency === true);

    // ── Fora do calendário ──
    const outOfCalendar = allRequests.filter(r => r.outOfCalendar === true);

    // ── Top solicitantes ──
    const requesterCounts = {};
    allRequests.forEach(r => {
      const name = r.requesterName || r.requesterEmail || 'Desconhecido';
      requesterCounts[name] = (requesterCounts[name] || 0) + 1;
    });
    const topRequesters = Object.entries(requesterCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    // ── Tempo médio entre solicitação e entrega ──
    let totalDays = 0;
    let countDelivered = 0;
    allTasks.forEach(t => {
      if (t.status !== 'completed' && t.status !== 'done') return;
      const created = t.createdAt?.toDate ? t.createdAt.toDate() : null;
      const completed = t.completedAt?.toDate ? t.completedAt.toDate() : null;
      if (created && completed) {
        const diffDays = (completed - created) / (1000 * 60 * 60 * 24);
        totalDays += diffDays;
        countDelivered++;
      }
    });
    const avgDays = countDelivered > 0 ? (totalDays / countDelivered).toFixed(1) : '—';
    const slaOk = countDelivered > 0 && (totalDays / countDelivered) <= slaDays;

    // Store data for exports
    calDashData = {
      complianceRate, fulfilledSlots, expectedSlots,
      allRequests, allTasks, urgentRequests, outOfCalendar,
      topRequesters, avgDays, slaOk, slaDays, countDelivered,
    };

    // 3. Render KPIs
    const kpis = document.getElementById('nl-cal-kpis');
    if (kpis) {
      kpis.innerHTML = `
        ${calStatCard('Cumprimento', complianceRate + '%', '📅',
          complianceRate >= 80 ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
          complianceRate >= 80 ? '#22C55E' : '#EF4444',
          `${fulfilledSlots} de ${expectedSlots} slots (90 dias)`)}
        ${calStatCard('Solicitações', allRequests.length.toString(), '📩',
          'rgba(56,189,248,0.12)', '#38BDF8', 'Total de solicitações de newsletter')}
        ${calStatCard('Urgentes', urgentRequests.length.toString(), '🔴',
          urgentRequests.length > 0 ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)',
          urgentRequests.length > 0 ? '#EF4444' : '#22C55E',
          `${allRequests.length ? Math.round((urgentRequests.length/allRequests.length)*100) : 0}% do total`)}
        ${calStatCard('Fora do Calendário', outOfCalendar.length.toString(), '⚠',
          outOfCalendar.length > 0 ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.12)',
          outOfCalendar.length > 0 ? '#F59E0B' : '#22C55E',
          `${allRequests.length ? Math.round((outOfCalendar.length/allRequests.length)*100) : 0}% do total`)}
        ${calStatCard('Tempo Médio', avgDays !== '—' ? avgDays + 'd' : '—', '⏱',
          slaOk ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
          slaOk ? '#22C55E' : '#EF4444',
          `SLA: ${slaDays} dias úteis${countDelivered ? ' · ' + countDelivered + ' entregas' : ''}`)}
      `;
    }

    // 4. Render compliance bar
    const compEl = document.getElementById('nl-cal-compliance');
    if (compEl) {
      const months = {};
      // Group tasks by month
      allTasks.forEach(t => {
        const dd = t.dueDate || t.startDate;
        if (!dd) return;
        const d = dd.toDate ? dd.toDate() : new Date(dd);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        if (!months[key]) months[key] = { total: 0, completed: 0, label: '' };
        const PT_M = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        months[key].label = PT_M[d.getMonth()] + '/' + d.getFullYear();
        months[key].total++;
        if (t.status === 'completed' || t.status === 'done') months[key].completed++;
      });

      const sortedMonths = Object.entries(months).sort((a, b) => a[0].localeCompare(b[0])).slice(-6);
      compEl.innerHTML = sortedMonths.length ? sortedMonths.map(([, m]) => {
        const rate = m.total > 0 ? Math.round((m.completed / m.total) * 100) : 0;
        return `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="width:70px;font-size:0.75rem;color:var(--text-muted);">${m.label}</span>
            <div style="flex:1;height:20px;background:var(--bg-elevated);border-radius:var(--radius-sm);overflow:hidden;">
              <div style="height:100%;width:${rate}%;background:${rate>=80?'#22C55E':rate>=50?'#F59E0B':'#EF4444'};
                border-radius:var(--radius-sm);transition:width 0.3s;"></div>
            </div>
            <span style="width:40px;text-align:right;font-size:0.8125rem;font-weight:600;color:var(--text-primary);">${rate}%</span>
          </div>`;
      }).join('') : '<p style="font-size:0.8125rem;color:var(--text-muted);">Sem dados suficientes.</p>';
    }

    // 5. Render top requesters
    const topEl = document.getElementById('nl-cal-top-requesters');
    if (topEl) {
      topEl.innerHTML = topRequesters.length ? topRequesters.map(([name, count], i) => {
        const max = topRequesters[0][1];
        const pct = Math.round((count / max) * 100);
        return `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="width:16px;font-size:0.75rem;color:var(--text-muted);text-align:center;">${i+1}</span>
            <span style="width:140px;font-size:0.8125rem;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(name)}</span>
            <div style="flex:1;height:16px;background:var(--bg-elevated);border-radius:var(--radius-sm);overflow:hidden;">
              <div style="height:100%;width:${pct}%;background:rgba(212,168,67,0.3);border-radius:var(--radius-sm);"></div>
            </div>
            <span style="width:30px;text-align:right;font-size:0.8125rem;font-weight:600;color:var(--text-primary);">${count}</span>
          </div>`;
      }).join('') : '<p style="font-size:0.8125rem;color:var(--text-muted);">Sem solicitações.</p>';
    }

    // 6. Render requests table
    const tableEl = document.getElementById('nl-cal-table');
    if (tableEl) {
      const sorted = [...allRequests].sort((a, b) => {
        const da = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
        const db2 = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
        return db2 - da;
      }).slice(0, 50);

      const STATUS_COLORS = { pending: '#F59E0B', converted: '#22C55E', rejected: '#EF4444' };
      const STATUS_LABELS = { pending: 'Aguardando', converted: 'Convertida', rejected: 'Recusada' };

      tableEl.innerHTML = sorted.length ? `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.8125rem;">
            <thead>
              <tr style="background:var(--bg-surface);">
                <th style="text-align:left;padding:8px 12px;font-size:0.6875rem;font-weight:600;text-transform:uppercase;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">Data</th>
                <th style="text-align:left;padding:8px 12px;font-size:0.6875rem;font-weight:600;text-transform:uppercase;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">Título</th>
                <th style="text-align:left;padding:8px 12px;font-size:0.6875rem;font-weight:600;text-transform:uppercase;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">Solicitante</th>
                <th style="text-align:left;padding:8px 12px;font-size:0.6875rem;font-weight:600;text-transform:uppercase;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">Status</th>
                <th style="text-align:center;padding:8px 12px;font-size:0.6875rem;font-weight:600;text-transform:uppercase;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">Urgente</th>
                <th style="text-align:center;padding:8px 12px;font-size:0.6875rem;font-weight:600;text-transform:uppercase;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">Fora Cal.</th>
              </tr>
            </thead>
            <tbody>
              ${sorted.map(r => {
                const created = r.createdAt?.toDate ? r.createdAt.toDate() : new Date(r.createdAt || 0);
                const stColor = STATUS_COLORS[r.status] || '#6B7280';
                return `<tr style="border-bottom:1px solid var(--border-subtle);">
                  <td style="padding:8px 12px;font-size:0.75rem;color:var(--text-muted);white-space:nowrap;">${fmt(created)}</td>
                  <td style="padding:8px 12px;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.title || '—')}</td>
                  <td style="padding:8px 12px;font-size:0.75rem;color:var(--text-secondary);">${esc(r.requesterName || r.requesterEmail || '—')}</td>
                  <td style="padding:8px 12px;">
                    <span style="font-size:0.6875rem;padding:2px 8px;border-radius:var(--radius-full);
                      background:${stColor}15;color:${stColor};border:1px solid ${stColor}30;">${STATUS_LABELS[r.status] || r.status}</span>
                  </td>
                  <td style="padding:8px 12px;text-align:center;">${r.urgency ? '<span style="color:#EF4444;">🔴</span>' : '—'}</td>
                  <td style="padding:8px 12px;text-align:center;">${r.outOfCalendar ? '<span style="color:#F59E0B;">⚠</span>' : '—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      ` : '<p style="font-size:0.8125rem;color:var(--text-muted);padding:16px;">Nenhuma solicitação de newsletter encontrada.</p>';
    }

  } catch (e) {
    console.error('Calendar dashboard error:', e);
    const kpis = document.getElementById('nl-cal-kpis');
    if (kpis) kpis.innerHTML = `<div class="card" style="grid-column:1/-1;padding:24px;text-align:center;color:var(--text-muted);">
      Erro ao carregar dados: ${esc(e.message)}</div>`;
  }

  // Setup insights da aba Calendar (idempotente — só monta uma vez)
  if (calDashData) setTimeout(() => setupNlCalendarInsights(), 500);
}

function calStatCard(label, value, icon, bg, color, sub = '') {
  return `<div class="stat-card">
    <div class="stat-card-icon" style="background:${bg};color:${color};">${icon}</div>
    <div class="stat-card-label">${label}</div>
    <div class="stat-card-value">${value}</div>
    ${sub ? `<div style="font-size:0.625rem;color:var(--text-muted);margin-top:2px;">${sub}</div>` : ''}
  </div>`;
}

/* ════════════════════════════════════════════════════════════
   INSIGHTS & OBSERVAÇÕES — Setup por tab
   ════════════════════════════════════════════════════════════ */

// Idempotência via DOM check (flag boolean falha em re-renders entre navegações).

/** Computa período visualizado a partir do filterDays atual.
 * filterDays pode ser '7'|'30'|'90'|'180'|'365' OU 'custom:from:to'.
 */
function computeNlPeriod() {
  if (String(filterDays).startsWith('custom:')) {
    const [, from, to] = filterDays.split(':');
    return {
      start: from ? new Date(from + 'T12:00:00') : null,
      end:   to   ? new Date(to   + 'T12:00:00') : null,
      label: `${from} → ${to}`,
    };
  }
  const days = parseInt(filterDays) || 30;
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return { start, end, label: `Últimos ${days} dias` };
}

/** Snapshot resumido dos KPIs da aba Performance (a partir de allData filtered). */
function buildNlKpisSnapshot() {
  let rows = allData;
  if (filterBu) rows = rows.filter(r => r.virtualBuId === filterBu);
  rows = mergeWaves(rows).filter(r => !hiddenRows.has(r.jobId));
  if (!rows.length) return { kpis: 'sem dados no período' };

  const avg = (key) => {
    const vals = rows.map(r => r[key]).filter(v => v != null && !isNaN(v));
    return vals.length ? vals.reduce((a,b) => a+b, 0) / vals.length : null;
  };
  const sum = (key) => rows.reduce((a,r) => a + (Number(r[key])||0), 0);
  const totalSent = sum('totalSent');
  const totalOptOut = sum('optOut');

  return {
    disparos: rows.length,
    enviadosTotal: totalSent,
    taxaAberturaMedia: avg('openRate')?.toFixed(1) ?? null,
    taxaCliquesMedia: avg('clickRate')?.toFixed(1) ?? null,
    taxaEntregaMedia: avg('deliveryRate')?.toFixed(1) ?? null,
    taxaOptOut: totalSent > 0 ? ((totalOptOut / totalSent) * 100).toFixed(2) : null,
    optOutTotal: totalOptOut,
    bu: filterBu || 'Todas',
  };
}

/** Snapshot da tabela: top 10 disparos por openRate. */
function buildNlTableSnapshot() {
  let rows = allData;
  if (filterBu) rows = rows.filter(r => r.virtualBuId === filterBu);
  rows = mergeWaves(rows).filter(r => !hiddenRows.has(r.jobId));
  const top = [...rows]
    .filter(r => r.openRate != null)
    .sort((a, b) => (b.openRate || 0) - (a.openRate || 0))
    .slice(0, 10)
    .map(r => ({
      label: (r.title || 'sem nome').slice(0, 50),
      sent: r.totalSent,
      openRate: r.openRate?.toFixed(1),
      clickRate: r.clickRate?.toFixed(1),
    }));
  return { totalDisparos: rows.length, top10PorAbertura: top };
}

/** Snapshot agregado pra IA gerar análise geral do tab Performance. */
function buildNlPerfGeneralSnapshot() {
  return {
    ...buildNlKpisSnapshot(),
    ...buildNlTableSnapshot(),
  };
}

/** Setup dos insights na aba Performance (idempotente). */
async function setupNlPerformanceInsights() {
  if (document.querySelector('#nl-kpis-block .ip-widget-btn')) return;
  try {
    const { setupDashboardInsights } = await import('../services/insightWidgets.js?v=20260503uu1');
    const period = computeNlPeriod();
    const filters = { bu: filterBu, days: filterDays, periodLabel: period.label };

    await setupDashboardInsights({
      dashboard: 'nl',
      widgets: [
        { widgetId: 'nl-kpis-block',  indexKey: 'kpis',  label: '📊 KPIs do período',
          snapshot: () => buildNlKpisSnapshot() },
        { widgetId: 'nl-table-block', indexKey: 'tabela', label: '📋 Tabela de disparos',
          snapshot: () => buildNlTableSnapshot() },
      ],
      metrics: null,
      periodFrom: period.start, periodTo: period.end,
      periodLabel: period.label,
      filters,
      generalPanelContainerId: 'nl-perf-insights-section',
      buildGeneralSnapshot: () => buildNlPerfGeneralSnapshot(),
      enableAi: true,
    });
  } catch (e) { console.warn('[nl] perf insights setup:', e); }
}

/** Snapshot dos KPIs da aba Calendar (de calDashData populado por loadCalendarDashboard). */
function buildNlCalKpisSnapshot() {
  if (!calDashData) return { kpis: 'sem dados — aba Calendário não carregada' };
  return {
    complianceRate: calDashData.complianceRate,
    expectedSlots: calDashData.expectedSlots,
    fulfilledSlots: calDashData.fulfilledSlots,
    urgentRequests: calDashData.urgentRequests?.length || 0,
    outOfCalendar: calDashData.outOfCalendar?.length || 0,
    avgDays: calDashData.avgDays,
    slaOk: calDashData.slaOk,
    slaDays: calDashData.slaDays,
  };
}

function buildNlCalComplianceSnapshot() {
  if (!calDashData) return {};
  return {
    complianceRate: calDashData.complianceRate,
    expectedSlots: calDashData.expectedSlots,
    fulfilledSlots: calDashData.fulfilledSlots,
    gap: (calDashData.expectedSlots || 0) - (calDashData.fulfilledSlots || 0),
  };
}

function buildNlCalRequestersSnapshot() {
  if (!calDashData?.topRequesters) return {};
  return {
    topRequesters: calDashData.topRequesters.map(([name, count]) => ({ label: name, count })),
  };
}

function buildNlCalTableSnapshot() {
  if (!calDashData?.allRequests) return {};
  const reqs = calDashData.allRequests || [];
  return {
    totalRequests: reqs.length,
    urgentes: reqs.filter(r => r.urgency).length,
    foraDoCalendario: reqs.filter(r => r.outOfCalendar).length,
  };
}

function buildNlCalGeneralSnapshot() {
  return {
    ...buildNlCalKpisSnapshot(),
    ...buildNlCalComplianceSnapshot(),
    ...buildNlCalRequestersSnapshot(),
    ...buildNlCalTableSnapshot(),
  };
}

/** Setup dos insights na aba Calendar (idempotente, chamado após loadCalendarDashboard). */
async function setupNlCalendarInsights() {
  if (document.querySelector('#nl-cal-kpis-block .ip-widget-btn')) return;
  try {
    const { setupDashboardInsights } = await import('../services/insightWidgets.js?v=20260503uu1');
    // Calendar usa janela fixa de 90 dias (ver loadCalendarDashboard)
    const end = new Date();
    const start = new Date(); start.setDate(start.getDate() - 90);
    const period = { start, end, label: 'Últimos 90 dias' };
    const filters = { scope: 'calendar', windowDays: 90 };

    await setupDashboardInsights({
      dashboard: 'nl',
      widgets: [
        { widgetId: 'nl-cal-kpis-block',           indexKey: 'calKpis',        label: '📊 KPIs do calendário',
          snapshot: () => buildNlCalKpisSnapshot() },
        { widgetId: 'nl-cal-compliance-card',      indexKey: 'compliance',     label: '📅 Cumprimento do calendário',
          snapshot: () => buildNlCalComplianceSnapshot() },
        { widgetId: 'nl-cal-top-requesters-card',  indexKey: 'topRequesters',  label: '👤 Top solicitantes',
          snapshot: () => buildNlCalRequestersSnapshot() },
        { widgetId: 'nl-cal-table-card',           indexKey: 'requestsTable',  label: '📋 Detalhamento de solicitações',
          snapshot: () => buildNlCalTableSnapshot() },
      ],
      metrics: null,
      periodFrom: start, periodTo: end,
      periodLabel: period.label,
      filters,
      generalPanelContainerId: 'nl-cal-insights-section',
      buildGeneralSnapshot: () => buildNlCalGeneralSnapshot(),
      enableAi: true,
    });
  } catch (e) { console.warn('[nl] cal insights setup:', e); }
}

/* ═══════════════════════════════════════════════════════════════════════════
   ABA "CONTEÚDO & TEMAS" (4.6.0+) — análise das newsletters por entidades
   extraídas via IA do HTML de cada disparo (campo mc_performance.extracted)
   ═══════════════════════════════════════════════════════════════════════════ */

let _contentDataCache = null;       // array de docs com extracted
let _contentFiltersState = { bu: '', period: '180', country: '', city: '', theme: '', newsletterType: '', search: '' };

async function loadContentTab() {
  const root = document.getElementById('nlc-content');
  if (!root) return;

  if (!_contentDataCache) {
    root.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--text-muted);">
      ⏳ Carregando análise de conteúdo…</div>`;
    try {
      const { collection, getDocs, query, orderBy, limit, where } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      const { db } = await import('../firebase.js');
      const snap = await getDocs(query(
        collection(db, 'mc_performance'),
        orderBy('sentDate', 'desc'),
        limit(2000)
      ));
      _contentDataCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      root.innerHTML = `<div style="text-align:center;padding:40px;color:var(--color-danger);">
        Erro ao carregar: ${esc(e.message)}</div>`;
      return;
    }
  }

  // Wire filtros (idempotente)
  if (!root.dataset.wired) {
    root.dataset.wired = '1';
    document.getElementById('nlc-bu-filter').addEventListener('change', e => {
      _contentFiltersState.bu = e.target.value; renderContentTab();
    });
    document.getElementById('nlc-period-filter').addEventListener('change', e => {
      _contentFiltersState.period = e.target.value; renderContentTab();
    });
    document.getElementById('nlc-country-filter').addEventListener('change', e => {
      _contentFiltersState.country = e.target.value; renderContentTab();
    });
    document.getElementById('nlc-city-filter')?.addEventListener('change', e => {
      _contentFiltersState.city = e.target.value; renderContentTab();
    });
    document.getElementById('nlc-theme-filter').addEventListener('change', e => {
      _contentFiltersState.theme = e.target.value; renderContentTab();
    });
    document.getElementById('nlc-type-filter')?.addEventListener('change', e => {
      _contentFiltersState.newsletterType = e.target.value; renderContentTab();
    });
    document.getElementById('nlc-search').addEventListener('input', e => {
      _contentFiltersState.search = e.target.value.trim().toLowerCase(); renderContentTab();
    });
    document.getElementById('nl-content-refresh')?.addEventListener('click', async () => {
      _contentDataCache = null;
      await loadContentTab();
    });
    document.getElementById('nl-content-pdf')?.addEventListener('click', () => {
      alert('Export PDF da aba Conteúdo será entregue na 4.7.0 (Fase 3).');
    });
  }

  renderContentTab();
}

function renderContentTab() {
  const root = document.getElementById('nlc-content');
  if (!root) return;

  // Aplica filtros básicos primeiro pra popular dropdowns
  const baseFiltered = applyContentFilters(_contentDataCache || []);
  populateContentDropdowns(_contentDataCache || []);

  // Filtra mais por search/country/theme depois dos dropdowns prontos
  const filtered = applyAllContentFilters(_contentDataCache || []);

  // Stats globais — agora `filtered` já vem com wave dedup (1 campanha = 1 doc)
  const totalCampaigns = filtered.length;
  const totalRawDocs = filtered.reduce((s, d) => s + (d._waveCount || 1), 0);
  const enrichedDocs = filtered.filter(d => d.extracted && Object.keys(d.extracted).length > 0);
  const enrichedPct = totalCampaigns > 0 ? Math.round((enrichedDocs.length / totalCampaigns) * 100) : 0;

  document.getElementById('nlc-meta').textContent =
    `${totalCampaigns} campanha${totalCampaigns!==1?'s':''} (${totalRawDocs} disparos) no período · ${enrichedDocs.length} enriquecidas (${enrichedPct}%)`;

  // Empty state se não tem nenhum enriquecido
  if (enrichedDocs.length === 0) {
    root.innerHTML = renderContentEmptyState(totalDocs);
    return;
  }

  // Calcula agregações
  const agg = aggregateContent(enrichedDocs);

  root.innerHTML = `
    <!-- KPIs -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px;">
      ${contentKpi('🌍 Países',          agg.countries.size,           'distintos no período')}
      ${contentKpi('🏙 Cidades',          agg.cities.size,              'mencionadas')}
      ${contentKpi('🏨 Hotéis',          agg.hotels.size,              'únicos citados')}
      ${contentKpi('🚢 Cruzeiros',        agg.cruises.size,             'operadoras')}
      ${contentKpi('🏷 Marcas',           agg.brands.size,              'hoteleiras')}
      ${contentKpi('📊 Open rate médio', fmtPct(agg.avgOpenRate),       'das aprovadas')}
    </div>

    <!-- 2-col grid de blocos -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:16px;">

      <!-- Tipo de newsletter -->
      <div class="card" style="padding:18px;">
        <h3 style="margin:0 0 12px 0;font-size:0.875rem;font-weight:700;text-transform:uppercase;
          letter-spacing:0.06em;color:var(--text-muted);">📂 Tipo de newsletter</h3>
        ${renderNewsletterTypesBars(agg.newsletterTypes, enrichedDocs)}
      </div>

      <!-- Top destinos (países) com performance -->
      <div class="card" style="padding:18px;">
        <h3 style="margin:0 0 12px 0;font-size:0.875rem;font-weight:700;text-transform:uppercase;
          letter-spacing:0.06em;color:var(--text-muted);">🌍 Top países · performance</h3>
        ${renderTopDestinosTable(agg.byCountry, enrichedDocs)}
      </div>

      <!-- Top cidades / regiões -->
      <div class="card" style="padding:18px;">
        <h3 style="margin:0 0 12px 0;font-size:0.875rem;font-weight:700;text-transform:uppercase;
          letter-spacing:0.06em;color:var(--text-muted);">🏙 Top cidades / regiões</h3>
        ${renderTopDestinosTable(agg.cities, enrichedDocs, 'cidade')}
      </div>

      <!-- Top hotéis -->
      <div class="card" style="padding:18px;">
        <h3 style="margin:0 0 12px 0;font-size:0.875rem;font-weight:700;text-transform:uppercase;
          letter-spacing:0.06em;color:var(--text-muted);">🏨 Hotéis mais mencionados</h3>
        ${renderTopHoteisBars(agg.hotels, enrichedDocs)}
      </div>

      <!-- Top cruzeiros (separado de hotéis) -->
      <div class="card" style="padding:18px;">
        <h3 style="margin:0 0 12px 0;font-size:0.875rem;font-weight:700;text-transform:uppercase;
          letter-spacing:0.06em;color:var(--text-muted);">🚢 Cruzeiros / operadoras marítimas</h3>
        ${renderTopHoteisBars(agg.cruises, enrichedDocs)}
      </div>

      <!-- Temas/posicionamento -->
      <div class="card" style="padding:18px;">
        <h3 style="margin:0 0 12px 0;font-size:0.875rem;font-weight:700;text-transform:uppercase;
          letter-spacing:0.06em;color:var(--text-muted);">🎯 Temas / posicionamento</h3>
        ${renderThemesBars(agg.themes, enrichedDocs)}
      </div>

      <!-- Marcas -->
      <div class="card" style="padding:18px;">
        <h3 style="margin:0 0 12px 0;font-size:0.875rem;font-weight:700;text-transform:uppercase;
          letter-spacing:0.06em;color:var(--text-muted);">🏷 Marcas hoteleiras citadas</h3>
        ${renderBrandsPills(agg.brands, enrichedDocs)}
      </div>

    </div>

    <!-- Comparativo por BU (igual padrão Performance) -->
    <div class="card" style="padding:18px;margin-top:16px;">
      <h3 style="margin:0 0 12px 0;font-size:0.875rem;font-weight:700;text-transform:uppercase;
        letter-spacing:0.06em;color:var(--text-muted);">🏢 Conteúdo por unidade (BU)</h3>
      ${renderContentByBu(enrichedDocs)}
    </div>

    <!-- Lista de envios filtrados -->
    <div class="card" style="padding:18px;margin-top:16px;">
      <h3 style="margin:0 0 12px 0;font-size:0.875rem;font-weight:700;text-transform:uppercase;
        letter-spacing:0.06em;color:var(--text-muted);">📧 Envios (${enrichedDocs.length})</h3>
      ${renderEnrichedSendsList(enrichedDocs)}
    </div>
  `;

  wireDrillDowns();
}

/* ─── Filtros ──────────────────────────────────────────────── */

function applyContentFilters(docs) {
  const f = _contentFiltersState;
  return docs.filter(d => {
    if (f.bu && d.buId !== f.bu) return false;
    if (f.period) {
      const days = parseInt(f.period, 10);
      const cutoff = Date.now() - days * 86400000;
      const ts = d.sentDate?.toDate?.()?.getTime() || (d.sentDate?.seconds * 1000) || 0;
      if (ts < cutoff) return false;
    }
    return true;
  });
}

/* ─── Wave dedup pra análise de conteúdo ───────────────────────
 * Newsletters PXXX/UXXX são divididas em ondas (P0209_1, P0209_2, P0209_3)
 * que disparam o MESMO HTML. Pra contagem de termos (hotéis, países, etc.)
 * cada campanha-base conta UMA vez, não 3. Performance segue por wave.
 * Reusa baseCode() do mergeWaves existente.
 */
function dedupContentByCampaign(docs) {
  const baseCode = (name) => (name || '').trim()
    .replace(/\s*-\s*\d+$/, '').replace(/_\d+$/, '')
    .replace(/-\d+$/, '').replace(/_[A-Z]$/, '').trim();

  const groups = new Map(); // bu|baseCode -> docs[]
  for (const d of docs) {
    const key = (d.buId || '') + '|' + baseCode(d.name || '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }

  // Pra cada grupo: mantém doc canônico (com extracted) + agrega métricas
  const merged = [];
  for (const [, group] of groups) {
    // Pega o doc com extracted preenchido se houver; senão o primeiro
    const withExtracted = group.find(d => d.extracted);
    const canonical = withExtracted || group[0];
    if (group.length === 1) {
      merged.push({ ...canonical, _waveCount: 1, _waveDocs: group });
    } else {
      // Soma métricas, mantém extracted do canônico
      const totalSent  = group.reduce((s, d) => s + (+d.totalSent || 0), 0);
      const delivered  = group.reduce((s, d) => s + (+d.delivered || 0), 0);
      const openUnique = group.reduce((s, d) => s + (+d.openUnique || 0), 0);
      const clickUnique = group.reduce((s, d) => s + (+d.clickUnique || 0), 0);
      merged.push({
        ...canonical,
        name: baseCode(canonical.name),
        totalSent,
        delivered,
        openUnique,
        clickUnique,
        openRate: delivered > 0 ? +(openUnique / delivered * 100).toFixed(2) : 0,
        clickRate: delivered > 0 ? +(clickUnique / delivered * 100).toFixed(2) : 0,
        _waveCount: group.length,
        _waveDocs: group,
      });
    }
  }
  return merged;
}

function applyAllContentFilters(docs) {
  const f = _contentFiltersState;
  const baseFiltered = applyContentFilters(docs);
  const deduped = dedupContentByCampaign(baseFiltered);
  return deduped.filter(d => {
    if (f.country) {
      const countries = (d.extracted?.countries || []).map(c => String(c).toLowerCase());
      if (!countries.includes(f.country.toLowerCase())) return false;
    }
    if (f.city) {
      const cities = (d.extracted?.cities || []).map(c => String(c).toLowerCase());
      if (!cities.includes(f.city.toLowerCase())) return false;
    }
    if (f.theme) {
      const themes = (d.extracted?.themes || []).map(t => String(t).toLowerCase());
      if (!themes.includes(f.theme.toLowerCase())) return false;
    }
    if (f.newsletterType) {
      if ((d.extracted?.newsletterType || '').toLowerCase() !== f.newsletterType.toLowerCase()) return false;
    }
    if (f.search) {
      const hay = JSON.stringify(d.extracted || {}).toLowerCase()
        + ' ' + (d.name || '').toLowerCase()
        + ' ' + (d.subject || '').toLowerCase();
      if (!hay.includes(f.search)) return false;
    }
    return true;
  });
}

function populateContentDropdowns(allDocs) {
  const baseFiltered = applyContentFilters(allDocs);
  const enriched = baseFiltered.filter(d => d.extracted);

  const countries = new Set();
  const cities    = new Set();
  const themes    = new Set();
  const types     = new Set();
  for (const d of enriched) {
    (d.extracted.countries || []).forEach(c => c && countries.add(c));
    (d.extracted.cities    || []).forEach(c => c && cities.add(c));
    (d.extracted.themes    || []).forEach(t => t && themes.add(t));
    if (d.extracted.newsletterType) types.add(d.extracted.newsletterType);
  }

  const countrySel = document.getElementById('nlc-country-filter');
  const citySel    = document.getElementById('nlc-city-filter');
  const themeSel   = document.getElementById('nlc-theme-filter');
  const typeSel    = document.getElementById('nlc-type-filter');
  const cur1 = countrySel?.value, cur2 = themeSel?.value;
  const cur3 = citySel?.value,    cur4 = typeSel?.value;

  if (countrySel) countrySel.innerHTML = `<option value="">Todos os países</option>` +
    [...countries].sort().map(c => `<option value="${esc(c)}" ${c===cur1?'selected':''}>${esc(c)}</option>`).join('');
  if (citySel) citySel.innerHTML = `<option value="">Todas cidades/regiões</option>` +
    [...cities].sort().map(c => `<option value="${esc(c)}" ${c===cur3?'selected':''}>${esc(c)}</option>`).join('');
  if (themeSel) themeSel.innerHTML = `<option value="">Todos os temas</option>` +
    [...themes].sort().map(t => `<option value="${esc(t)}" ${t===cur2?'selected':''}>${esc(t)}</option>`).join('');
  if (typeSel) typeSel.innerHTML = `<option value="">Todos os tipos</option>` +
    [...types].sort().map(t => `<option value="${esc(t)}" ${t===cur4?'selected':''}>${esc(t)}</option>`).join('');
}

/* ─── Agregações ───────────────────────────────────────────── */

function aggregateContent(docs) {
  const countries = new Map();
  const cities    = new Map();
  const hotels    = new Map();
  const cruises   = new Map();   // 4.9.0+ separado de hotels
  const brands    = new Map();
  const themes    = new Map();
  const audiences = new Map();
  const newsletterTypes = new Map(); // 4.9.0+ promocao/aereo/roteiro/hotelaria/cruzeiro/csat/inspiracional/institucional
  let confidenceHigh = 0;
  let totalOpenRate = 0;
  let openRateCount = 0;

  for (const d of docs) {
    const ex = d.extracted || {};
    const sent = +(d.totalSent || 0);
    const opens = +(d.openUnique || 0);
    if (sent > 0) { totalOpenRate += +(d.openRate || 0); openRateCount++; }
    if (ex.confidence === 'high') confidenceHigh++;

    const tally = (map, name) => {
      if (!name) return;
      const k = String(name).trim();
      if (!k) return;
      const cur = map.get(k) || { count: 0, totalSent: 0, totalOpen: 0, sends: [] };
      cur.count++;
      cur.totalSent += sent;
      cur.totalOpen += opens;
      cur.sends.push(d.id);
      map.set(k, cur);
    };

    // Dedup INTRA-doc: cada entidade conta 1× por campanha (já está OK
    // porque arrays de extracted normalmente já vêm sem duplicatas; mas
    // garantimos via Set local).
    const dedup = (arr) => [...new Set((arr || []).filter(Boolean).map(x =>
      typeof x === 'string' ? x.trim() : (x?.name || '').trim()
    ).filter(Boolean))];

    dedup(ex.countries).forEach(c => tally(countries, c));
    dedup(ex.cities).forEach(c => tally(cities, c));
    dedup(ex.brands).forEach(b => tally(brands, b));
    dedup(ex.themes).forEach(t => tally(themes, t));
    dedup(ex.targetAudience).forEach(a => tally(audiences, a));
    dedup(ex.hotels).forEach(h => tally(hotels, h));
    dedup(ex.cruises).forEach(c => tally(cruises, c));
    dedup(ex.newsletterType ? [ex.newsletterType] : []).forEach(t => tally(newsletterTypes, t));
  }

  return {
    countries, cities, hotels, cruises, brands, themes, audiences, newsletterTypes,
    confidenceHigh,
    avgOpenRate: openRateCount > 0 ? totalOpenRate / openRateCount : 0,
    byCountry: countries,
  };
}

/* ─── Renderers ────────────────────────────────────────────── */

function contentKpi(title, value, sub) {
  return `<div class="card" style="padding:14px 16px;">
    <div style="font-size:0.6875rem;color:var(--text-muted);text-transform:uppercase;
      letter-spacing:0.05em;font-weight:600;margin-bottom:4px;">${title}</div>
    <div style="font-size:1.5rem;font-weight:700;color:var(--text-primary);">${value}</div>
    <div style="font-size:0.6875rem;color:var(--text-muted);margin-top:2px;">${sub}</div>
  </div>`;
}

function renderTopDestinosTable(map, allEnriched, label = 'País') {
  if (!map || map.size === 0) return `<p style="color:var(--text-muted);font-size:0.8125rem;">Nenhum ${String(label).toLowerCase()} identificado ainda.</p>`;
  const top = [...map.entries()]
    .map(([name, d]) => ({ name, count: d.count, openRate: d.totalSent > 0 ? (d.totalOpen / d.totalSent * 100) : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
  const headerLabel = label === 'cidade' ? 'Cidade / Região' : 'País';
  const drillClass = label === 'cidade' ? 'nlc-city-drill' : 'nlc-country-drill';
  const drillAttr  = label === 'cidade' ? 'data-city'      : 'data-country';

  return `<table style="width:100%;font-size:0.8125rem;border-collapse:collapse;">
    <thead><tr style="border-bottom:1px solid var(--border-subtle);color:var(--text-muted);font-size:0.6875rem;text-transform:uppercase;letter-spacing:0.05em;">
      <th style="text-align:left;padding:8px 6px;">${esc(headerLabel)}</th>
      <th style="text-align:right;padding:8px 6px;">Disparos</th>
      <th style="text-align:right;padding:8px 6px;">Open rate</th>
    </tr></thead>
    <tbody>${top.map(r => `<tr style="border-bottom:1px solid var(--border-subtle);cursor:pointer;"
      class="${drillClass}" ${drillAttr}="${esc(r.name)}">
      <td style="padding:7px 6px;font-weight:500;">${esc(r.name)}</td>
      <td style="padding:7px 6px;text-align:right;color:var(--text-secondary);">${r.count}</td>
      <td style="padding:7px 6px;text-align:right;font-weight:600;color:${rateColor2(r.openRate)};">${r.openRate.toFixed(1)}%</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function renderNewsletterTypesBars(typesMap, allEnriched) {
  if (!typesMap || typesMap.size === 0) return '<p style="color:var(--text-muted);font-size:0.8125rem;">Tipos não classificados ainda.</p>';
  const labels = {
    promocao: '🏷 Promoção',
    aereo: '✈ Aéreo',
    roteiro: '📍 Roteiro',
    hotelaria: '🏨 Hotelaria',
    cruzeiro: '🚢 Cruzeiro',
    csat: '📋 CSAT',
    inspiracional: '🌟 Inspiracional',
    institucional: '🏢 Institucional',
    'show/evento': '🎤 Show/Evento',
    'retreat/wellness': '🧘 Retreat/Wellness',
  };
  const colors = {
    promocao: '#F59E0B', aereo: '#3B82F6', roteiro: '#10B981',
    hotelaria: '#8B5CF6', cruzeiro: '#06B6D4', csat: '#6B7280',
    inspiracional: '#EC4899', institucional: '#64748B',
    'show/evento': '#F97316', 'retreat/wellness': '#14B8A6',
  };
  const top = [...typesMap.entries()]
    .map(([name, d]) => ({ name, count: d.count, openRate: d.totalSent > 0 ? (d.totalOpen / d.totalSent * 100) : 0 }))
    .sort((a, b) => b.count - a.count);
  const max = top[0]?.count || 1;
  return top.map(r => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:0.8125rem;">
    <div style="flex:0 0 140px;">${esc(labels[r.name] || r.name)}</div>
    <div style="flex:1;min-width:60px;height:8px;background:var(--bg-elevated);border-radius:4px;overflow:hidden;">
      <div style="height:100%;width:${(r.count/max*100).toFixed(1)}%;background:${colors[r.name] || '#94A3B8'};"></div>
    </div>
    <div style="flex:0 0 40px;text-align:right;font-weight:600;color:var(--text-secondary);">${r.count}</div>
    <div style="flex:0 0 60px;text-align:right;font-size:0.75rem;color:${rateColor2(r.openRate)};">${r.openRate.toFixed(1)}%</div>
  </div>`).join('');
}

function renderTopHoteisBars(hotelsMap, allEnriched) {
  if (hotelsMap.size === 0) return '<p style="color:var(--text-muted);font-size:0.8125rem;">Nenhum hotel identificado ainda.</p>';
  const top = [...hotelsMap.entries()]
    .map(([name, d]) => ({ name, count: d.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const max = top[0]?.count || 1;
  return top.map(r => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:0.8125rem;">
    <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.name)}</div>
    <div style="flex:0 0 120px;height:8px;background:var(--bg-elevated);border-radius:4px;overflow:hidden;">
      <div style="height:100%;width:${(r.count/max*100).toFixed(1)}%;background:var(--brand-gold);"></div>
    </div>
    <div style="flex:0 0 30px;text-align:right;font-weight:600;color:var(--text-secondary);">${r.count}</div>
  </div>`).join('');
}

function renderThemesBars(themesMap, allEnriched) {
  if (themesMap.size === 0) return '<p style="color:var(--text-muted);font-size:0.8125rem;">Nenhum tema identificado ainda.</p>';
  const top = [...themesMap.entries()]
    .map(([name, d]) => ({ name, count: d.count, openRate: d.totalSent > 0 ? (d.totalOpen / d.totalSent * 100) : 0 }))
    .sort((a, b) => b.count - a.count);
  const max = top[0]?.count || 1;
  return top.map(r => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:0.8125rem;">
    <div style="flex:0 0 120px;text-transform:capitalize;">${esc(r.name)}</div>
    <div style="flex:1;min-width:60px;height:8px;background:var(--bg-elevated);border-radius:4px;overflow:hidden;">
      <div style="height:100%;width:${(r.count/max*100).toFixed(1)}%;background:#8B5CF6;"></div>
    </div>
    <div style="flex:0 0 50px;text-align:right;font-weight:600;color:var(--text-secondary);">${r.count}</div>
    <div style="flex:0 0 60px;text-align:right;font-size:0.75rem;color:${rateColor2(r.openRate)};">${r.openRate.toFixed(1)}%</div>
  </div>`).join('');
}

function renderBrandsPills(brandsMap, allEnriched) {
  if (brandsMap.size === 0) return '<p style="color:var(--text-muted);font-size:0.8125rem;">Nenhuma marca identificada ainda.</p>';
  const top = [...brandsMap.entries()]
    .map(([name, d]) => ({ name, count: d.count }))
    .sort((a, b) => b.count - a.count);
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;">
    ${top.map(r => `<span style="display:inline-flex;align-items:center;gap:4px;
      padding:4px 10px;border-radius:16px;background:rgba(212,168,67,0.12);
      color:var(--brand-gold);font-size:0.75rem;font-weight:600;">
      ${esc(r.name)} <span style="background:rgba(255,255,255,0.5);padding:1px 6px;border-radius:8px;
        color:var(--text-secondary);font-weight:500;">${r.count}</span>
    </span>`).join('')}
  </div>`;
}

function renderEnrichedSendsList(docs) {
  const top = docs.slice(0, 50);
  return `<div style="overflow-x:auto;">
    <table style="width:100%;font-size:0.8125rem;border-collapse:collapse;">
      <thead><tr style="border-bottom:1px solid var(--border-subtle);color:var(--text-muted);font-size:0.6875rem;text-transform:uppercase;letter-spacing:0.05em;">
        <th style="text-align:left;padding:8px 6px;">Data</th>
        <th style="text-align:left;padding:8px 6px;">Tipo · Nome</th>
        <th style="text-align:left;padding:8px 6px;">Países</th>
        <th style="text-align:left;padding:8px 6px;">Hotéis</th>
        <th style="text-align:left;padding:8px 6px;">Temas</th>
        <th style="text-align:right;padding:8px 6px;">Open</th>
        <th style="text-align:center;padding:8px 6px;">Editar</th>
      </tr></thead>
      <tbody>${top.map(d => {
        const dateStr = d.sentDate?.toDate ? d.sentDate.toDate().toLocaleDateString('pt-BR') : '—';
        const ex = d.extracted || {};
        const countries = (ex.countries || []).join(', ') || '—';
        const hotels = (ex.hotels || []).slice(0, 2).map(h => typeof h === 'string' ? h : h.name).filter(Boolean).join(', ');
        const moreH = (ex.hotels || []).length > 2 ? ` +${ex.hotels.length - 2}` : '';
        const themes = (ex.themes || []).slice(0, 3).join(', ');
        const ntype = ex.newsletterType ? `<span style="font-size:0.625rem;padding:1px 6px;border-radius:8px;background:rgba(139,92,246,.1);color:#8B5CF6;margin-right:4px;">${esc(ex.newsletterType)}</span>` : '';
        const waveTxt = d._waveCount > 1
          ? `<span title="${d._waveCount} ondas disparadas" style="font-size:0.625rem;color:var(--text-muted);font-weight:400;margin-left:4px;">⊞${d._waveCount}</span>` : '';
        return `<tr style="border-bottom:1px solid var(--border-subtle);">
          <td style="padding:7px 6px;color:var(--text-muted);font-size:0.75rem;white-space:nowrap;">${dateStr}</td>
          <td style="padding:7px 6px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${ntype}${esc(d.name || '—')}${waveTxt}</td>
          <td style="padding:7px 6px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary);">${esc(countries)}</td>
          <td style="padding:7px 6px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary);">${esc(hotels || '—')}${moreH}</td>
          <td style="padding:7px 6px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary);">${esc(themes || '—')}</td>
          <td style="padding:7px 6px;text-align:right;font-weight:600;color:${rateColor2(d.openRate || 0)};">${(d.openRate || 0).toFixed(1)}%</td>
          <td style="padding:7px 6px;text-align:center;">
            <button class="nlc-edit-doc btn btn-ghost btn-sm" data-doc-id="${esc(d.id)}"
              title="Editar análise manualmente"
              style="padding:2px 8px;font-size:0.75rem;color:var(--brand-gold);">✎</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>
    ${docs.length > 50 ? `<div style="text-align:center;color:var(--text-muted);font-size:0.75rem;padding:12px;">
      Mostrando 50 de ${docs.length}. Filtre pra refinar.
    </div>` : ''}
  </div>`;
}

function renderContentEmptyState(totalDocs) {
  return `<div style="text-align:center;padding:60px 20px;color:var(--text-muted);">
    <div style="font-size:3rem;margin-bottom:12px;">🌍</div>
    <h3 style="margin:0 0 8px 0;color:var(--text-primary);">Análise de conteúdo ainda não disponível</h3>
    <p style="font-size:0.875rem;line-height:1.6;max-width:560px;margin:0 auto;">
      ${totalDocs > 0
        ? `Encontrei <strong>${totalDocs} disparo${totalDocs!==1?'s':''}</strong> no período, mas nenhum tem
           extração de entidades ainda. Isso significa que o sync rodou antes da feature 4.5.0+
           OU o pipeline de extração não conseguiu rodar (sem permissão SFMC <code>Assets &gt; Read</code>
           ou agente IA Hub inativo).`
        : 'Nenhum disparo no período selecionado. Tente ampliar o filtro.'}
    </p>
    <div style="margin-top:20px;">
      <a href="https://github.com/primetour/tarefas/actions/workflows/mc-sync.yml"
        target="_blank" rel="noopener" class="btn btn-secondary btn-sm"
        style="text-decoration:none;">↗ Ver Sync Marketing Cloud</a>
      <a href="#ai-hub" class="btn btn-secondary btn-sm" style="margin-left:8px;text-decoration:none;">
        🤖 IA Hub: agente "Extrator"
      </a>
    </div>
  </div>`;
}

function wireDrillDowns() {
  // Click em país → seta filtro de país e re-renderiza
  document.querySelectorAll('.nlc-country-drill').forEach(row => {
    row.addEventListener('click', () => {
      const country = row.dataset.country;
      _contentFiltersState.country = country;
      const sel = document.getElementById('nlc-country-filter');
      if (sel) sel.value = country;
      renderContentTab();
    });
  });
  // Click em cidade → seta filtro de cidade e re-renderiza
  document.querySelectorAll('.nlc-city-drill').forEach(row => {
    row.addEventListener('click', () => {
      const city = row.dataset.city;
      _contentFiltersState.city = city;
      const sel = document.getElementById('nlc-city-filter');
      if (sel) sel.value = city;
      renderContentTab();
    });
  });
  // Botão "✎" em cada envio → abre modal de edição manual do extracted
  document.querySelectorAll('.nlc-edit-doc').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openExtractedEditor(btn.dataset.docId);
    });
  });
}

function rateColor2(pct) {
  if (pct >= 25) return '#10B981';
  if (pct >= 15) return '#F59E0B';
  if (pct >= 5)  return '#6B7280';
  return '#EF4444';
}

function fmtPct(n) { return `${(+n || 0).toFixed(1)}%`; }

/* ─── Comparativo por BU (separação solicitada pelo user) ─────
 * Mostra 1 linha por BU com: # campanhas, top destino, top hotel,
 * top tema, open rate médio. Espelha padrão da aba Performance.
 */
function renderContentByBu(docs) {
  const byBu = new Map(); // buName -> { campaigns, countries, hotels, themes, opens, sendCount }
  for (const d of docs) {
    const bu = d.buName || d.buId || '—';
    if (!byBu.has(bu)) byBu.set(bu, {
      campaigns: 0, countries: new Map(), hotels: new Map(), themes: new Map(),
      openSum: 0, openCount: 0,
    });
    const b = byBu.get(bu);
    b.campaigns++;
    const ex = d.extracted || {};
    (ex.countries || []).forEach(c => b.countries.set(c, (b.countries.get(c) || 0) + 1));
    (ex.themes    || []).forEach(t => b.themes.set(t, (b.themes.get(t) || 0) + 1));
    (ex.hotels    || []).forEach(h => {
      const n = typeof h === 'string' ? h : h?.name; if (n) b.hotels.set(n, (b.hotels.get(n) || 0) + 1);
    });
    if (d.openRate > 0) { b.openSum += +d.openRate; b.openCount++; }
  }
  const top = (m) => [...m.entries()].sort((a,b) => b[1]-a[1])[0]?.[0] || '—';
  return `<table style="width:100%;font-size:0.8125rem;border-collapse:collapse;">
    <thead><tr style="border-bottom:1px solid var(--border-subtle);color:var(--text-muted);font-size:0.6875rem;text-transform:uppercase;letter-spacing:0.05em;">
      <th style="text-align:left;padding:8px 6px;">Unidade</th>
      <th style="text-align:right;padding:8px 6px;">Campanhas</th>
      <th style="text-align:left;padding:8px 6px;">Top destino</th>
      <th style="text-align:left;padding:8px 6px;">Top hotel</th>
      <th style="text-align:left;padding:8px 6px;">Top tema</th>
      <th style="text-align:right;padding:8px 6px;">Open rate médio</th>
    </tr></thead>
    <tbody>${[...byBu.entries()]
      .sort((a,b) => b[1].campaigns - a[1].campaigns)
      .map(([bu, b]) => {
        const avgOpen = b.openCount > 0 ? (b.openSum / b.openCount) : 0;
        return `<tr style="border-bottom:1px solid var(--border-subtle);">
          <td style="padding:7px 6px;font-weight:600;">${esc(bu)}</td>
          <td style="padding:7px 6px;text-align:right;color:var(--text-secondary);">${b.campaigns}</td>
          <td style="padding:7px 6px;color:var(--text-secondary);">${esc(top(b.countries))}</td>
          <td style="padding:7px 6px;color:var(--text-secondary);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(top(b.hotels))}</td>
          <td style="padding:7px 6px;color:var(--text-secondary);text-transform:capitalize;">${esc(top(b.themes))}</td>
          <td style="padding:7px 6px;text-align:right;font-weight:600;color:${rateColor2(avgOpen)};">${avgOpen.toFixed(1)}%</td>
        </tr>`;
      }).join('')}</tbody>
  </table>`;
}

/* ─── Modal de edição manual de extracted (4.9.0+) ─────────────
 * Permite ao master/admin corrigir manualmente entidades extraídas
 * por IA quando estiverem erradas. Salva direto em mc_performance.
 * Garante 100% de efetividade nas análises (palavra do user).
 */
async function openExtractedEditor(docId) {
  const { collection, doc, getDoc, updateDoc, serverTimestamp } = await import(
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
  );
  const { db } = await import('../firebase.js');

  const ref = doc(db, 'mc_performance', docId);
  const snap = await getDoc(ref);
  if (!snap.exists()) { alert('Documento não encontrado.'); return; }
  const data = snap.data();
  const ex = data.extracted || {};

  // Helper pra render array de strings/objetos como textarea (1 linha cada)
  const arrToText = (arr, key) => (arr || []).map(v =>
    typeof v === 'string' ? v : (key === 'hotels' || key === 'cruises'
      ? JSON.stringify(v)
      : (v?.name || JSON.stringify(v)))
  ).join('\n');

  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);
    z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;`;
  overlay.innerHTML = `
    <div class="card" style="max-width:720px;width:100%;max-height:88vh;overflow:auto;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <h3 style="margin:0;font-size:1rem;">✎ Editar análise · ${esc(data.name || docId)}</h3>
        <button class="btn btn-ghost btn-sm" id="ed-close">✕</button>
      </div>
      <p style="margin:0 0 14px 0;font-size:0.75rem;color:var(--text-muted);">
        Subject: ${esc(data.subject || '—')}
      </p>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <label style="display:block;font-size:0.75rem;color:var(--text-muted);">Tipo de newsletter
          <select id="ed-newsletterType" class="form-input" style="width:100%;">
            <option value="">— escolher —</option>
            <option value="promocao">🏷 promocao</option>
            <option value="aereo">✈ aereo</option>
            <option value="roteiro">📍 roteiro</option>
            <option value="hotelaria">🏨 hotelaria</option>
            <option value="cruzeiro">🚢 cruzeiro</option>
            <option value="csat">📋 csat</option>
            <option value="inspiracional">🌟 inspiracional</option>
            <option value="institucional">🏢 institucional</option>
            <option value="show/evento">🎤 show/evento</option>
            <option value="retreat/wellness">🧘 retreat/wellness</option>
          </select>
        </label>
        <label style="display:block;font-size:0.75rem;color:var(--text-muted);">Confiança
          <select id="ed-confidence" class="form-input" style="width:100%;">
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
        </label>
        <label style="display:block;font-size:0.75rem;color:var(--text-muted);">Price point
          <select id="ed-pricePoint" class="form-input" style="width:100%;">
            <option value="">—</option>
            <option value="ultra-luxo">ultra-luxo</option>
            <option value="luxo">luxo</option>
            <option value="premium">premium</option>
          </select>
        </label>
        <div></div>
        <label style="display:block;font-size:0.75rem;color:var(--text-muted);">Países (1 por linha)
          <textarea id="ed-countries" class="form-input" style="width:100%;height:70px;font-size:0.8125rem;">${esc(arrToText(ex.countries, 'countries'))}</textarea>
        </label>
        <label style="display:block;font-size:0.75rem;color:var(--text-muted);">Cidades/Regiões (1 por linha)
          <textarea id="ed-cities" class="form-input" style="width:100%;height:70px;font-size:0.8125rem;">${esc(arrToText(ex.cities, 'cities'))}</textarea>
        </label>
        <label style="display:block;font-size:0.75rem;color:var(--text-muted);grid-column:span 2;">Hotéis — JSON 1 por linha: {"name":"X","brand":"Y","category":"luxo"}
          <textarea id="ed-hotels" class="form-input" style="width:100%;height:80px;font-size:0.75rem;font-family:ui-monospace;">${esc(arrToText(ex.hotels, 'hotels'))}</textarea>
        </label>
        <label style="display:block;font-size:0.75rem;color:var(--text-muted);grid-column:span 2;">Cruzeiros (operadoras) — JSON 1 por linha: {"name":"Aqua Expeditions","brand":"X","category":"ultra-luxo"}
          <textarea id="ed-cruises" class="form-input" style="width:100%;height:60px;font-size:0.75rem;font-family:ui-monospace;">${esc(arrToText(ex.cruises, 'cruises'))}</textarea>
        </label>
        <label style="display:block;font-size:0.75rem;color:var(--text-muted);">Marcas (1 por linha)
          <textarea id="ed-brands" class="form-input" style="width:100%;height:60px;font-size:0.8125rem;">${esc(arrToText(ex.brands))}</textarea>
        </label>
        <label style="display:block;font-size:0.75rem;color:var(--text-muted);">Temas (1 por linha)
          <textarea id="ed-themes" class="form-input" style="width:100%;height:60px;font-size:0.8125rem;">${esc(arrToText(ex.themes))}</textarea>
        </label>
        <label style="display:block;font-size:0.75rem;color:var(--text-muted);">Target audience (1 por linha)
          <textarea id="ed-targetAudience" class="form-input" style="width:100%;height:60px;font-size:0.8125rem;">${esc(arrToText(ex.targetAudience))}</textarea>
        </label>
        <label style="display:block;font-size:0.75rem;color:var(--text-muted);">Atividades (1 por linha)
          <textarea id="ed-activities" class="form-input" style="width:100%;height:60px;font-size:0.8125rem;">${esc(arrToText(ex.activities))}</textarea>
        </label>
        <label style="display:block;font-size:0.75rem;color:var(--text-muted);grid-column:span 2;">Sales points (1 por linha)
          <textarea id="ed-sellingPoints" class="form-input" style="width:100%;height:60px;font-size:0.8125rem;">${esc(arrToText(ex.sellingPoints))}</textarea>
        </label>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
        <button class="btn btn-secondary" id="ed-cancel">Cancelar</button>
        <button class="btn btn-primary" id="ed-save">💾 Salvar análise manual</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Pré-popula selects
  if (ex.newsletterType) document.getElementById('ed-newsletterType').value = ex.newsletterType;
  if (ex.confidence)     document.getElementById('ed-confidence').value     = ex.confidence;
  if (ex.pricePoint)     document.getElementById('ed-pricePoint').value     = ex.pricePoint;

  const close = () => overlay.remove();
  document.getElementById('ed-close').addEventListener('click', close);
  document.getElementById('ed-cancel').addEventListener('click', close);

  // Helper pra parsear textarea de JSON 1-por-linha (hotels/cruises)
  const parseJsonLines = (text) => {
    return (text || '').split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      try { return JSON.parse(line); }
      catch { return { name: line }; } // fallback: nome simples
    });
  };
  const parseLines = (text) => (text || '').split('\n').map(l => l.trim()).filter(Boolean);

  document.getElementById('ed-save').addEventListener('click', async () => {
    const newExtracted = {
      ...ex,
      newsletterType: document.getElementById('ed-newsletterType').value || null,
      confidence:     document.getElementById('ed-confidence').value || 'medium',
      pricePoint:     document.getElementById('ed-pricePoint').value || null,
      countries: parseLines(document.getElementById('ed-countries').value),
      cities:    parseLines(document.getElementById('ed-cities').value),
      hotels:    parseJsonLines(document.getElementById('ed-hotels').value),
      cruises:   parseJsonLines(document.getElementById('ed-cruises').value),
      brands:    parseLines(document.getElementById('ed-brands').value),
      themes:    parseLines(document.getElementById('ed-themes').value),
      targetAudience: parseLines(document.getElementById('ed-targetAudience').value),
      activities:     parseLines(document.getElementById('ed-activities').value),
      sellingPoints:  parseLines(document.getElementById('ed-sellingPoints').value),
      extractedBy: 'manual-edit',
      editedAt:    serverTimestamp(),
    };
    try {
      await updateDoc(ref, { extracted: newExtracted });
      _contentDataCache = null; // força refetch
      close();
      await loadContentTab();
    } catch (e) {
      alert('Falha ao salvar: ' + e.message);
    }
  });
}
