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
        <div style="display:flex;justify-content:space-between;align-items:center;
          padding:8px 14px;border-bottom:1px solid var(--border-subtle);background:var(--bg-elevated);">
          <span style="font-size:0.6875rem;color:var(--text-muted);">
            💡 Arraste a borda direita do cabeçalho para ajustar a largura das colunas.
          </span>
          <button id="nl-disparos-reset-cols" class="btn btn-ghost btn-sm"
            title="Restaurar larguras padrão"
            style="font-size:0.6875rem;color:var(--text-muted);padding:2px 8px;">↺ Reset colunas</button>
        </div>
        <div id="nl-table-wrap" style="overflow-x:auto;max-height:72vh;overflow-y:auto;">
          <div style="padding:40px;text-align:center;color:var(--text-muted);font-size:0.8125rem;">
            Carregando dados…
          </div>
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
          <!-- 4.49.28+ Exports honram TODOS os filtros aplicados (BU, período,
               país/cidade/tema/tipo, comercial/turismo, busca livre). -->
          <button class="btn btn-secondary btn-sm" id="nl-content-xls">⬇ Excel</button>
          <button class="btn btn-secondary btn-sm" id="nl-content-pdf">⬇ PDF</button>
          <button class="btn btn-secondary btn-sm" id="nl-content-ppt">⬇ PPT</button>
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

  // Reset colunas Disparos
  document.getElementById('nl-disparos-reset-cols')?.addEventListener('click', () => {
    _resetDisparosColWidths();
    renderTable(editMode);
  });

  await loadData(editMode);
}

/* ─── Load from Firestore ─────────────────────────────────── */
async function loadData(editMode = false) {
  const wrap = document.getElementById('nl-table-wrap');
  if (wrap) wrap.innerHTML = `<div style="padding:40px;text-align:center;
    color:var(--text-muted);font-size:0.8125rem;">Carregando…</div>`;

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
    const wrap = document.getElementById('nl-table-wrap');
    if (wrap) wrap.innerHTML = `<div style="padding:40px;text-align:center;
      color:var(--color-danger);font-size:0.8125rem;">Erro: ${esc(e.message)}</div>`;
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
/* ─── Larguras default + persistência da tabela Disparos ───────
 * Ordem: edit?(36) | unidade(120) | data(110) | nome(220) | assunto(280) |
 *        enviados(80) | entrega(80) | hardB(90) | softB(90) | blockB(90) |
 *        abertura(90) | %abertura(90) | cliques(80) | %cliques(80) | optout(80)
 * Ao mudar editMode/filterBu, recomputa colunas visíveis dinamicamente.
 */
const DISPAROS_COLS_DEFINITION = [
  { key:'_edit',      label:'',           defaultW:40,  visibleWhen:'editMode',  sortable:false, type:'edit' },
  { key:'_bu',        label:'Unidade',    defaultW:120, visibleWhen:'!filterBu', sortable:false, type:'bu' },
  { key:'sentDate',   label:'Data',       defaultW:110, sortable:true, type:'date' },
  { key:'name',       label:'Nome',       defaultW:220, sortable:true, type:'name' },
  { key:'subject',    label:'Assunto',    defaultW:280, sortable:true, type:'subject' },
  { key:'totalSent',  label:'Enviados',   defaultW:80,  sortable:true, type:'num',     align:'right' },
  { key:'deliveryRate', label:'Entrega',  defaultW:80,  sortable:true, type:'pct-good', align:'right', t1:95, t2:85 },
  { key:'hardBounce', label:'Hard bounce',  defaultW:90, sortable:true, type:'num-bad', align:'right' },
  { key:'softBounce', label:'Soft bounce',  defaultW:90, sortable:true, type:'num-bad', align:'right' },
  { key:'blockBounce',label:'Block bounce', defaultW:90, sortable:true, type:'num-bad', align:'right' },
  { key:'openUnique', label:'Abertura',   defaultW:90,  sortable:true, type:'num',     align:'right' },
  { key:'openRate',   label:'% Abertura', defaultW:90,  sortable:true, type:'pct-good', align:'right', t1:20, t2:10 },
  { key:'clickUnique',label:'Cliques',    defaultW:80,  sortable:true, type:'num',     align:'right' },
  { key:'clickRate',  label:'% Cliques',  defaultW:80,  sortable:true, type:'pct-good', align:'right', t1:3, t2:1 },
  { key:'optOut',     label:'Opt-out',    defaultW:80,  sortable:true, type:'num-bad', align:'right' },
];
const DISPAROS_COL_KEY = 'nl-disparos-col-widths-v1';

function _getVisibleDisparosCols(editMode) {
  return DISPAROS_COLS_DEFINITION.filter(c => {
    if (c.visibleWhen === 'editMode')  return !!editMode;
    if (c.visibleWhen === '!filterBu') return !filterBu;
    return true;
  });
}
function _loadDisparosColWidths(visibleCols) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(DISPAROS_COL_KEY) || '{}') || {}; } catch {}
  return visibleCols.map(c => Math.max(40, +saved[c.key] || c.defaultW));
}
function _saveDisparosColWidth(key, width) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(DISPAROS_COL_KEY) || '{}') || {}; } catch {}
  saved[key] = Math.round(width);
  try { localStorage.setItem(DISPAROS_COL_KEY, JSON.stringify(saved)); } catch {}
}
function _resetDisparosColWidths() { try { localStorage.removeItem(DISPAROS_COL_KEY); } catch {} }

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

  const count = document.getElementById('nl-count');
  if (count) count.textContent = `${rows.length} disparos`;
  updateHiddenCount();
  renderKpis(rows);

  const visibleCols = _getVisibleDisparosCols(editMode);
  const widths = _loadDisparosColWidths(visibleCols);
  const totalW = widths.reduce((s, w) => s + w, 0);

  // ── Replace whole table content (colgroup + thead + tbody) ────
  const wrap = document.getElementById('nl-table-wrap');
  if (!wrap) return;

  const handle = `<span class="nl-col-resize" style="position:absolute;right:-3px;top:0;bottom:0;width:6px;cursor:col-resize;z-index:5;"></span>`;

  const thHTML = visibleCols.map((c, i) => {
    if (c.type === 'edit') {
      return `<th data-col-idx="${i}" data-col-key="${esc(c.key)}"
        style="position:relative;padding:10px 8px;border-bottom:1px solid var(--border-subtle);"></th>`;
    }
    const active = c.sortable && sortKey === c.key;
    const arrow = active ? (sortDir === -1 ? ' ↓' : ' ↑') : '';
    const align = c.align === 'right' ? 'right' : 'left';
    const cursor = c.sortable ? 'cursor:pointer;' : '';
    return `<th data-col-idx="${i}" data-col-key="${esc(c.key)}"
      ${c.sortable ? `class="nl-sort-th" data-sort="${c.key}"` : ''}
      style="position:relative;text-align:${align};padding:10px 12px;
      font-size:0.6875rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;
      ${active ? 'color:var(--brand-gold);' : 'color:var(--text-muted);'}
      border-bottom:1px solid var(--border-subtle);${cursor}user-select:none;">
      ${esc(c.label)}${arrow}${handle}
    </th>`;
  }).join('');

  const tbodyHTML = rows.length === 0
    ? `<tr><td colspan="${visibleCols.length}" style="padding:48px;text-align:center;
        color:var(--text-muted);">Nenhum disparo encontrado para o período selecionado.</td></tr>`
    : rows.map(r => {
        const hidden = hiddenRows.has(r.jobId);
        const rowStyle = hidden
          ? 'opacity:.35;text-decoration:line-through;'
          : 'border-bottom:1px solid var(--border-subtle);';

        return `<tr style="${rowStyle}transition:background .1s;"
          onmouseover="if(!this.dataset.hidden)this.style.background='var(--bg-surface)'"
          onmouseout="this.style.background=''"
          data-hidden="${hidden}">
          ${visibleCols.map(c => _renderDisparosCell(c, r, hidden)).join('')}
        </tr>`;
      }).join('');

  wrap.innerHTML = `<table id="nl-disparos-table" style="font-size:0.8125rem;
    border-collapse:separate;border-spacing:0;table-layout:fixed;width:${totalW}px;">
    <colgroup>${widths.map(w => `<col style="width:${w}px;">`).join('')}</colgroup>
    <thead><tr style="background:var(--bg-surface);position:sticky;top:0;z-index:4;">
      ${thHTML}
    </tr></thead>
    <tbody>${tbodyHTML}</tbody>
  </table>`;

  // Bind sort
  wrap.querySelectorAll('.nl-sort-th').forEach(th => {
    th.addEventListener('click', (e) => {
      // Não dispara sort se clicou no handle de resize
      if (e.target.classList.contains('nl-col-resize')) return;
      if (sortKey === th.dataset.sort) sortDir *= -1;
      else { sortKey = th.dataset.sort; sortDir = -1; }
      renderTable(editMode);
    });
  });

  // Bind resize handles
  const cols = [...wrap.querySelectorAll('colgroup col')];
  const state = [...widths];
  const recomputeTableW = () => {
    const t = document.getElementById('nl-disparos-table');
    if (t) t.style.width = `${state.reduce((s, w) => s + w, 0)}px`;
  };
  wrap.querySelectorAll('.nl-col-resize').forEach((h, i) => {
    h.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const startX = e.clientX;
      const startW = state[i];
      document.body.style.cursor = 'col-resize';
      const onMove = (ev) => {
        const newW = Math.max(40, Math.round(startW + (ev.clientX - startX)));
        state[i] = newW;
        cols[i].style.width = `${newW}px`;
        recomputeTableW();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        _saveDisparosColWidth(visibleCols[i].key, state[i]);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    h.addEventListener('mouseenter', () => h.style.background = 'var(--brand-gold)');
    h.addEventListener('mouseleave', () => h.style.background = 'transparent');
  });

  // Bind hide buttons
  wrap.querySelectorAll('.nl-hide-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const jobId = btn.dataset.jobid;
      if (hiddenRows.has(jobId)) hiddenRows.delete(jobId);
      else hiddenRows.add(jobId);
      renderTable(editMode);
    });
  });

  // 4.49.29+ Bind click "Ver arte" — abre modal com as top imagens
  // do email (mesma extração que vai pra Vision IA).
  wrap.querySelectorAll('.nl-art-link').forEach(link => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      openArtworkModal(link.dataset.docId, link.dataset.rowName);
    });
  });
}

/* 4.49.29+ Modal "Ver arte" — mostra as top imagens do email.
 *
 * Estado:
 *   1. Doc tem imageUrls[] preenchido → grid de imagens + métricas
 *   2. Doc sem imageUrls (legado pré-v4.49.29) → empty state explicando
 *      que aparece no próximo sync (ou via --reextract).
 *
 * URLs vêm do SFMC CDN (públicas, estáveis). Click numa imagem abre em
 * nova aba (fullsize). Hospedagem na nossa CDN é evolução futura. */
async function openArtworkModal(docId, rowName) {
  const { modal } = await import('../components/modal.js');
  const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

  let content;
  try {
    const snap = await getDoc(doc(db, 'mc_performance', docId));
    if (!snap.exists()) {
      content = `<div style="padding:24px;text-align:center;color:var(--text-muted);">Documento não encontrado.</div>`;
    } else {
      const d = snap.data();
      const imgs = Array.isArray(d.imageUrls) ? d.imageUrls : [];
      const sent = d.sentDate?.toDate?.() || (d.sentDate ? new Date(d.sentDate) : null);
      const meta = [
        d.subject ? `<strong>${esc(d.subject)}</strong>` : '',
        sent ? sent.toLocaleString('pt-BR', { dateStyle:'medium', timeStyle:'short' }) : '',
        d.buName || d.buId,
        d.totalSent ? `${d.totalSent.toLocaleString('pt-BR')} enviados` : '',
        d.openRate ? `${d.openRate.toFixed(1)}% abertura` : '',
      ].filter(Boolean).join(' · ');

      if (imgs.length === 0) {
        // 4.49.32+ Contexto honesto: noArtReason indica POR QUE não tem arte.
        const reason = d.noArtReason;
        const reasonInfo = {
          csat:    { icon: '📋', title: 'Email de pesquisa de satisfação (CSAT)', text: 'Este disparo é um questionário de feedback enviado após uma viagem ou interação. Por design, não tem arte visual — é texto + escala de avaliação.' },
          warmup:  { icon: '🔥', title: 'Email de warmup (aquecimento de IP)', text: 'Este disparo é parte do processo de aquecimento de IP/domínio pra evitar marcação de spam. Conteúdo intencionalmente neutro, sem arte visual.' },
          test:    { icon: '🧪', title: 'Email de teste / configuração', text: 'Este disparo foi enviado pra validar setup (remetente, template básico, dados de teste). Não é uma newsletter de marketing real.' },
          pending: { icon: '⚠',  title: 'Asset não recuperável', text: 'O HTML original deste email não está mais disponível no SFMC (provavelmente deletado ou renomeado). Backfill automático falhou. Se necessário, pode editar manualmente via "✎ Editar".' },
        };
        const info = reasonInfo[reason] || {
          icon: '🖼',
          title: 'Arte ainda não capturada',
          text: 'O sync automático ainda não rodou pra este doc. Aparecerá no próximo cron diário (~3h Brasília) ou trigger manual.',
        };
        content = `
          <div style="font-size:0.8125rem;color:var(--text-secondary);margin-bottom:16px;line-height:1.5;">
            ${meta}
          </div>
          <div style="padding:24px;border:1px dashed var(--border-subtle);border-radius:8px;text-align:left;
            background:var(--bg-elevated);">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
              <div style="font-size:2rem;line-height:1;">${info.icon}</div>
              <div style="font-size:0.9375rem;font-weight:600;color:var(--text-primary);">${esc(info.title)}</div>
            </div>
            <div style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.6;">
              ${esc(info.text)}
            </div>
          </div>`;
      } else {
        content = `
          <div style="font-size:0.8125rem;color:var(--text-secondary);margin-bottom:16px;line-height:1.5;">
            ${meta}
          </div>
          <div style="font-size:0.6875rem;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">
            ${imgs.length} ${imgs.length === 1 ? 'imagem' : 'imagens'} · servidas pelo SFMC CDN · click pra abrir em tamanho real
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;">
            ${imgs.map((img, i) => {
              const url = typeof img === 'string' ? img : img?.url;
              const alt = (typeof img === 'object' && img?.alt) || '';
              if (!url) return '';
              return `<a href="${esc(url)}" target="_blank" rel="noopener"
                style="display:block;border:1px solid var(--border-subtle);border-radius:8px;
                overflow:hidden;background:var(--bg-elevated);text-decoration:none;
                transition:transform 0.15s, border-color 0.15s;"
                onmouseover="this.style.transform='translateY(-2px)';this.style.borderColor='var(--brand-gold)';"
                onmouseout="this.style.transform='';this.style.borderColor='var(--border-subtle)';">
                <div style="aspect-ratio:16/10;overflow:hidden;background:#f5f5f5;">
                  <img src="${esc(url)}" alt="${esc(alt)}" style="width:100%;height:100%;object-fit:contain;"
                    loading="lazy" referrerpolicy="no-referrer"
                    onerror="this.parentElement.innerHTML='<div style=\\'padding:32px;text-align:center;color:#999;\\'>imagem indisponível</div>';">
                </div>
                ${alt ? `<div style="padding:6px 8px;font-size:0.6875rem;color:var(--text-muted);
                  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(alt)}</div>` : ''}
              </a>`;
            }).join('')}
          </div>`;
      }
    }
  } catch (e) {
    content = `<div style="padding:24px;color:var(--color-danger);">Erro: ${esc(e.message)}</div>`;
  }

  modal.open({
    title: `🖼 Arte do email — ${esc(rowName || '').slice(0,60)}`,
    size: 'xl',
    content,
    dedupeKey: `nl-art-${docId}`,
    footer: [{ label: 'Fechar', class: 'btn-secondary', closeOnClick: true }],
  });
}

/** Render de uma célula da tabela Disparos baseado no tipo de coluna. */
function _renderDisparosCell(col, r, hidden) {
  const align = col.align === 'right' ? 'right' : 'left';
  const baseTd = `padding:9px 12px;vertical-align:top;text-align:${align};
    overflow:hidden;text-overflow:ellipsis;`;
  const truncTd = `${baseTd}white-space:nowrap;`;
  const wrapTd  = `${baseTd}white-space:normal;word-break:break-word;line-height:1.35;`;
  switch (col.type) {
    case 'edit': {
      return `<td style="padding:8px;text-align:center;vertical-align:middle;">
        <button class="nl-hide-btn" data-jobid="${r.jobId}"
          title="${hidden ? 'Mostrar linha' : 'Ocultar linha'}"
          style="border:none;background:none;cursor:pointer;font-size:0.875rem;
            color:${hidden ? 'var(--brand-gold)' : 'var(--text-muted)'};">
          ${hidden ? '👁' : '✕'}
        </button></td>`;
    }
    case 'bu': {
      return `<td title="${esc(r.virtualBuName || '')}" style="${truncTd}vertical-align:middle;">
        ${buBadge(r.virtualBuId, r.virtualBuName)}</td>`;
    }
    case 'date':
      return `<td style="${truncTd}color:var(--text-muted);font-size:0.75rem;vertical-align:middle;">${fmt(r.sentDate)}</td>`;
    case 'name': {
      // 4.49.29+ Click no nome → modal "Ver arte". 4.49.32+ ícone reflete
      // a categoria honesta do doc:
      //   🖼 = tem arte capturada
      //   📋 = CSAT (pesquisa, sem arte por design)
      //   🔥 = warmup (aquecimento de IP)
      //   🧪 = teste/configuração
      //   ⚠  = asset sumiu no SFMC (não recuperável)
      //   🔍 = pendente (próximo sync vai popular)
      const hasArt = Array.isArray(r.imageUrls) && r.imageUrls.length > 0;
      const iconMap = { csat:'📋', warmup:'🔥', test:'🧪', pending:'⚠' };
      const icon   = hasArt ? '🖼' : (iconMap[r.noArtReason] || '🔍');
      const docId  = r.id || r.docId || r._docIds?.[0] || '';
      return `<td title="${esc(r.name || '')}" style="${wrapTd}">
        <a href="#" class="nl-art-link" data-doc-id="${esc(docId)}" data-row-name="${esc(r.name||'')}"
          style="text-decoration:none;color:var(--text-primary);display:inline-block;
          padding:1px 4px;border-radius:4px;transition:background 0.12s;"
          title="Ver arte do email${hasArt?'':' (pendente do próximo sync)'}"
          onmouseover="this.style.background='rgba(212,168,67,0.08)'"
          onmouseout="this.style.background=''">
          <span style="font-size:0.75rem;opacity:0.7;margin-right:3px;">${icon}</span>
          ${esc(r.name || '—')}
        </a>
        ${r.waveCount > 1 ? `<br><span title="${esc(r.waveNames)}"
          style="font-size:0.6875rem;color:var(--text-muted);font-weight:400;cursor:help;">⊞ ${r.waveCount} ondas</span>` : ''}
      </td>`;
    }
    case 'subject':
      return `<td title="${esc(r.subject || '')}" style="${wrapTd}color:var(--text-muted);font-size:0.75rem;line-height:1.4;">
        ${esc(r.subject || '—')}
      </td>`;
    case 'num': {
      const v = r[col.key];
      return `<td style="${truncTd}vertical-align:middle;">${num(v)}</td>`;
    }
    case 'num-bad': {
      const v = r[col.key];
      return `<td style="${truncTd}vertical-align:middle;${badColor(v)}">${num(v)}</td>`;
    }
    case 'pct-good': {
      const v = r[col.key];
      return `<td style="${truncTd}vertical-align:middle;${rateColor(v, col.t1, col.t2)}">${pct(v)}</td>`;
    }
    default: return `<td style="${truncTd}">${esc(String(r[col.key] ?? '—'))}</td>`;
  }
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
      const { fetchInsights, insightsToXlsxRows } = await import('../services/insights.js?v=20260508r1');
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
        await import('../services/insights.js?v=20260508r1');
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
        await import('../services/insights.js?v=20260508r1');
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
    const { setupDashboardInsights } = await import('../services/insightWidgets.js?v=20260508r1');
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
    const { setupDashboardInsights } = await import('../services/insightWidgets.js?v=20260508r1');
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
// 4.49.27+ Filtros adicionais pra eixos duplos (commercial/tourism)
let _contentFiltersState = { bu: '', period: '180', country: '', city: '', theme: '', newsletterType: '', search: '', commercial: '', tourism: '' };
// 4.49.24+ Cache do snapshot filtrado pro drill modal — populado em renderContentTab
let _lastContentDocs = [];

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
    // 4.49.28+ Exports da aba Conteúdo & Temas — TODOS honram filtros atuais
    document.getElementById('nl-content-xls')?.addEventListener('click', exportContentXlsx);
    document.getElementById('nl-content-pdf')?.addEventListener('click', exportContentPdf);
    document.getElementById('nl-content-ppt')?.addEventListener('click', exportContentPptx);
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

  // 4.49.24+ Mantém docs filtrados acessíveis ao drill-down modal
  // (openDrillModal lê _lastContentDocs pra resolver os IDs em docs)
  _lastContentDocs = enrichedDocs;

  // Calcula agregações
  const agg = aggregateContent(enrichedDocs);

  root.innerHTML = `
    <!-- KPIs -->
    <div id="nl-content-kpis-block" style="margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
        <h3 style="margin:0;font-size:0.8125rem;font-weight:600;color:var(--text-secondary);
          text-transform:uppercase;letter-spacing:0.06em;">📊 Indicadores de conteúdo</h3>
        <span class="widget-insights-slot" data-widget-id="nl-content-kpis-block"></span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;">
        ${contentKpi('🌍 Países',          agg.countries.size,           'distintos no período', INFO_TIPS.countries)}
        ${contentKpi('🏙 Cidades',          agg.cities.size,              'mencionadas',         INFO_TIPS.cities)}
        ${contentKpi('🏨 Hotéis',          agg.hotels.size,              'únicos citados',      INFO_TIPS.hotels)}
        ${contentKpi('🚢 Cruzeiros',        agg.cruises.size,             'operadoras',          INFO_TIPS.cruises)}
        ${contentKpi('🏷 Marcas',           agg.brands.size,              'hoteleiras',          INFO_TIPS.brands)}
        ${contentKpi('📊 Open rate médio', fmtPct(agg.avgOpenRate),       'das aprovadas',       INFO_TIPS.openRate)}
      </div>
    </div>

    <!-- 2-col grid de blocos -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:16px;">

      <!-- 4.49.27+ Eixos duplos (spec do user): Comercial + Turismo -->
      <!-- 4.49.32+ Tooltips agora abrem modal estruturado via key. -->
      <div id="nl-content-commercial-block" class="card" style="padding:18px;">
        ${blockHeader('💼 Classificação Comercial', 'commercial', 'nl-content-commercial-block')}
        ${renderClassificationBars(agg.commercial, 'commercial')}
      </div>
      <div id="nl-content-tourism-block" class="card" style="padding:18px;">
        ${blockHeader('✈️ Classificação Turismo', 'tourism', 'nl-content-tourism-block')}
        ${renderClassificationBars(agg.tourism, 'tourism')}
      </div>

      <!-- 4.49.32+ Bloco "Tipo de newsletter (legado)" REMOVIDO.
           Após v4.49.27 todos os docs foram reclassificados nos eixos
           Comercial + Turismo. Manter o legado era redundante e confuso. -->
      <div id="nl-content-countries-block" class="card" style="padding:18px;">
        ${blockHeader('🌍 Top países · performance', 'topCountries', 'nl-content-countries-block')}
        ${renderTopDestinosTable(agg.byCountry, enrichedDocs)}
      </div>
      <div id="nl-content-cities-block" class="card" style="padding:18px;">
        ${blockHeader('🏙 Top cidades / regiões', 'topCities', 'nl-content-cities-block')}
        ${renderTopDestinosTable(agg.cities, enrichedDocs, 'cidade')}
      </div>
      <div id="nl-content-hotels-block" class="card" style="padding:18px;">
        ${blockHeader('🏨 Hotéis mais mencionados', 'topHotels', 'nl-content-hotels-block')}
        ${renderTopHoteisBars(agg.hotels, enrichedDocs)}
      </div>
      <div id="nl-content-cruises-block" class="card" style="padding:18px;">
        ${blockHeader('🚢 Cruzeiros / operadoras marítimas', 'topCruises', 'nl-content-cruises-block')}
        ${renderTopHoteisBars(agg.cruises, enrichedDocs)}
      </div>
      <div id="nl-content-themes-block" class="card" style="padding:18px;">
        ${blockHeader('🎯 Temas / posicionamento', 'themes', 'nl-content-themes-block')}
        ${renderThemesBars(agg.themes, enrichedDocs)}
      </div>
      <div id="nl-content-brands-block" class="card" style="padding:18px;">
        ${blockHeader('🏷 Marcas hoteleiras citadas', 'brandsBlock', 'nl-content-brands-block')}
        ${renderBrandsPills(agg.brands, enrichedDocs)}
      </div>

    </div>

    <!-- Comparativo por BU -->
    <div id="nl-content-bybu-block" class="card" style="padding:18px;margin-top:16px;">
      ${blockHeader('🏢 Conteúdo por unidade (BU)', INFO_TIPS.byBu, 'nl-content-bybu-block')}
      ${renderContentByBu(enrichedDocs)}
    </div>

    <!-- Lista de envios filtrados -->
    <div id="nl-content-sends-block" class="card" style="padding:18px;margin-top:16px;">
      ${blockHeader(`📧 Envios (${enrichedDocs.length})`, INFO_TIPS.envios, 'nl-content-sends-block')}
      ${renderEnrichedSendsList(enrichedDocs)}
    </div>

    <!-- Análise Geral do tab Conteúdo & Temas -->
    <div id="nl-content-insights-section" style="margin-top:24px;"></div>
  `;

  wireDrillDowns();

  // Setup insights da aba Conteúdo (idempotente — remontado a cada renderContentTab)
  setTimeout(() => setupNlContentInsights(enrichedDocs, agg), 50);
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
    // 4.49.27+ Filtros dos eixos duplos
    if (f.commercial) {
      if ((d.extracted?.commercial || '').toLowerCase() !== f.commercial.toLowerCase()) return false;
    }
    if (f.tourism) {
      if ((d.extracted?.tourism || '').toLowerCase() !== f.tourism.toLowerCase()) return false;
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

/* 4.49.28+ EXPORTS da aba Conteúdo & Temas — honram TODOS os filtros
 * aplicados. Snapshot single-source-of-truth: pegamos o resultado de
 * applyAllContentFilters → aggregateContent (mesma cadeia da UI).
 *
 * Filtros honrados: BU, período (180d default), país, cidade, tema,
 * tipo (legado), comercial (novo), turismo (novo), busca livre.
 */

function _contentExportSnapshot() {
  const docs = applyAllContentFilters(_contentDataCache || []);
  const enriched = docs.filter(d => d.extracted && Object.keys(d.extracted).length > 0);
  const agg = aggregateContent(enriched);
  return { docs, enriched, agg, filters: { ..._contentFiltersState } };
}

function _filterSummary(filters) {
  const labels = [];
  if (filters.bu)             labels.push(`BU: ${filters.bu}`);
  if (filters.period)         labels.push(`Período: últimos ${filters.period}d`);
  if (filters.country)        labels.push(`País: ${filters.country}`);
  if (filters.city)           labels.push(`Cidade: ${filters.city}`);
  if (filters.theme)          labels.push(`Tema: ${filters.theme}`);
  if (filters.newsletterType) labels.push(`Tipo: ${filters.newsletterType}`);
  if (filters.commercial)     labels.push(`Comercial: ${filters.commercial}`);
  if (filters.tourism)        labels.push(`Turismo: ${filters.tourism}`);
  if (filters.search)         labels.push(`Busca: "${filters.search}"`);
  return labels.length ? labels.join(' · ') : 'Sem filtros adicionais (todos os dados)';
}

function _exportFilename(ext, slug = 'newsletter-conteudo') {
  const date = new Date().toISOString().slice(0,10);
  return `primetour_${slug}_${date}.${ext}`;
}

/* ─── XLSX export ─────────────────────────────────────────── */
async function exportContentXlsx() {
  try {
    if (!window.XLSX) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    const { enriched, agg, filters } = _contentExportSnapshot();
    if (!enriched.length) { alert('Sem dados pra exportar com os filtros atuais.'); return; }

    const wb = window.XLSX.utils.book_new();

    // Sheet "Resumo"
    const resumo = [
      ['Newsletter — Conteúdo & Temas'],
      ['Gerado em', new Date().toLocaleString('pt-BR')],
      ['Filtros',   _filterSummary(filters)],
      [],
      ['Campanhas no recorte',  enriched.length],
      ['Países únicos',         agg.countries.size],
      ['Cidades únicas',        agg.cities.size],
      ['Hotéis citados',        agg.hotels.size],
      ['Cruzeiros citados',     agg.cruises.size],
      ['Marcas',                agg.brands.size],
      ['Temas',                 agg.themes.size],
      ['Open rate médio (%)',   agg.avgOpenRate?.toFixed(2) || '—'],
    ];
    const wsResumo = window.XLSX.utils.aoa_to_sheet(resumo);
    wsResumo['!cols'] = [{wch:30}, {wch:50}];
    window.XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');

    // Helper: monta sheet a partir de map { name → {count, totalSent, totalOpen, totalClick, totalOptOut} }
    const sheetFromMap = (map, primaryLabel) => {
      const headers = [primaryLabel, 'Disparos', 'Enviados', 'Abertura (%)', 'Cliques (%)', 'Opt-out (%)'];
      const rows = [...map.entries()].map(([name, d]) => [
        name, d.count, d.totalSent,
        d.totalSent > 0 ? +(d.totalOpen  / d.totalSent * 100).toFixed(2) : 0,
        d.totalSent > 0 ? +(d.totalClick / d.totalSent * 100).toFixed(2) : 0,
        d.totalSent > 0 ? +(d.totalOptOut/ d.totalSent * 100).toFixed(3) : 0,
      ]).sort((a, b) => b[1] - a[1]);
      const ws = window.XLSX.utils.aoa_to_sheet([headers, ...rows]);
      ws['!cols'] = [{wch:28}, {wch:10}, {wch:12}, {wch:12}, {wch:12}, {wch:12}];
      return ws;
    };

    window.XLSX.utils.book_append_sheet(wb, sheetFromMap(agg.commercial,     'Classif. Comercial'), 'Comercial');
    window.XLSX.utils.book_append_sheet(wb, sheetFromMap(agg.tourism,        'Classif. Turismo'),   'Turismo');
    window.XLSX.utils.book_append_sheet(wb, sheetFromMap(agg.countries,      'País'),               'Países');
    window.XLSX.utils.book_append_sheet(wb, sheetFromMap(agg.cities,         'Cidade / Região'),    'Cidades');
    window.XLSX.utils.book_append_sheet(wb, sheetFromMap(agg.hotels,         'Hotel'),              'Hotéis');
    window.XLSX.utils.book_append_sheet(wb, sheetFromMap(agg.cruises,        'Cruzeiro'),           'Cruzeiros');
    window.XLSX.utils.book_append_sheet(wb, sheetFromMap(agg.themes,         'Tema'),               'Temas');
    window.XLSX.utils.book_append_sheet(wb, sheetFromMap(agg.brands,         'Marca'),              'Marcas');
    // 4.49.32+ sheet "Tipo Legado" removida — eixos novos cobrem 100%.

    // Sheet "Disparos" — uma linha por campanha enriquecida
    const dispHeaders = ['Subject','BU','Data','Enviados','Abertura','Cliques','Opt-out','Comercial','Turismo','País(es)','Cidade(s)','Hotéis','Marcas'];
    const dispRows = enriched.map(d => {
      const ex = d.extracted || {};
      const ts = d.sentDate?.toDate?.() || (d.sentDate ? new Date(d.sentDate) : null);
      return [
        d.subject || '',
        d.buName || d.buId || '',
        ts ? ts.toLocaleDateString('pt-BR') : '',
        +(d.totalSent || 0),
        +(d.openRate  || 0),
        +(d.clickRate || 0),
        d.totalSent > 0 ? +((d.optOut/d.totalSent)*100).toFixed(2) : 0,
        ex.commercial || '',
        ex.tourism    || '',
        (ex.countries || []).join(', '),
        (ex.cities    || []).join(', '),
        (ex.hotels    || []).map(h => typeof h==='string'?h:(h?.name||'')).filter(Boolean).join(', '),
        (ex.brands    || []).join(', '),
      ];
    });
    const wsDisp = window.XLSX.utils.aoa_to_sheet([dispHeaders, ...dispRows]);
    wsDisp['!cols'] = [{wch:50},{wch:14},{wch:10},{wch:10},{wch:10},{wch:10},{wch:10},{wch:14},{wch:14},{wch:30},{wch:30},{wch:40},{wch:30}];
    window.XLSX.utils.book_append_sheet(wb, wsDisp, 'Disparos');

    window.XLSX.writeFile(wb, _exportFilename('xlsx'));
  } catch (e) {
    console.error('[contentXlsx]', e);
    alert('Erro ao gerar Excel: ' + e.message);
  }
}

/* ─── PDF export ──────────────────────────────────────────── */
async function exportContentPdf() {
  try {
    if (!window.jspdf?.jsPDF) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s.onload = res; s.onerror = rej; document.head.appendChild(s);
      });
    }
    if (!window.jspdf?.jsPDF?.API?.autoTable) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.1/jspdf.plugin.autotable.min.js';
        s.onload = res; s.onerror = rej; document.head.appendChild(s);
      });
    }
    const { enriched, agg, filters } = _contentExportSnapshot();
    if (!enriched.length) { alert('Sem dados pra exportar com os filtros atuais.'); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // Capa
    doc.setFontSize(20); doc.setTextColor(40, 40, 40);
    doc.text('Newsletter — Conteúdo & Temas', 14, 22);
    doc.setFontSize(10); doc.setTextColor(120, 120, 120);
    doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, 14, 30);
    doc.setFontSize(9); doc.setTextColor(60, 60, 60);
    const fSum = _filterSummary(filters);
    const fLines = doc.splitTextToSize(`Filtros: ${fSum}`, 180);
    doc.text(fLines, 14, 38);
    let y = 38 + fLines.length * 4 + 6;

    // KPIs em linha
    doc.setFontSize(11); doc.setTextColor(40, 40, 40);
    doc.text(`${enriched.length} campanhas · ${agg.countries.size} países · ${agg.cities.size} cidades · ${agg.hotels.size} hotéis · Open rate médio ${(agg.avgOpenRate||0).toFixed(1)}%`, 14, y);
    y += 8;

    // Função pra renderizar uma tabela a partir de map
    const addMapTable = (title, map, primaryLabel) => {
      if (!map || map.size === 0) return;
      doc.setFontSize(12); doc.setTextColor(40,40,40);
      doc.text(title, 14, y);
      y += 4;
      const rows = [...map.entries()].map(([name, d]) => [
        String(name),
        d.count,
        d.totalSent.toLocaleString('pt-BR'),
        d.totalSent > 0 ? (d.totalOpen / d.totalSent * 100).toFixed(1) + '%' : '—',
        d.totalSent > 0 ? (d.totalClick/ d.totalSent * 100).toFixed(1) + '%' : '—',
        d.totalSent > 0 ? (d.totalOptOut/d.totalSent*100).toFixed(2) + '%' : '—',
      ]).sort((a, b) => b[1] - a[1]).slice(0, 30);
      doc.autoTable({
        startY: y,
        head: [[primaryLabel, 'Disparos', 'Enviados', 'Abertura', 'Cliques', 'Opt-out']],
        body: rows,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [212, 168, 67], textColor: [255,255,255] },
        margin: { left: 14, right: 14 },
      });
      y = (doc.lastAutoTable?.finalY || y) + 8;
      if (y > 260) { doc.addPage(); y = 20; }
    };

    addMapTable('💼 Classificação Comercial', agg.commercial, 'Categoria');
    addMapTable('✈️ Classificação Turismo',  agg.tourism,    'Categoria');
    addMapTable('🌍 Top Países',              agg.countries,  'País');
    addMapTable('🏙 Top Cidades',             agg.cities,     'Cidade');
    addMapTable('🏨 Hotéis citados',          agg.hotels,     'Hotel');
    addMapTable('🚢 Cruzeiros',               agg.cruises,    'Operadora');
    addMapTable('🎯 Temas',                   agg.themes,     'Tema');

    doc.save(_exportFilename('pdf'));
  } catch (e) {
    console.error('[contentPdf]', e);
    alert('Erro ao gerar PDF: ' + e.message);
  }
}

/* ─── PPT export ──────────────────────────────────────────── */
async function exportContentPptx() {
  try {
    if (!window.PptxGenJS) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
        s.onload = res; s.onerror = rej; document.head.appendChild(s);
      });
    }
    const { enriched, agg, filters } = _contentExportSnapshot();
    if (!enriched.length) { alert('Sem dados pra exportar com os filtros atuais.'); return; }

    const pptx = new window.PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE'; // 13.333 × 7.5 inches
    pptx.author = 'PRIMETOUR';
    pptx.title  = 'Newsletter — Conteúdo & Temas';

    const GOLD = 'D4A843';
    const NAVY = '0F1B2D';

    // ── Slide 1: Capa ──
    const s1 = pptx.addSlide();
    s1.background = { color: 'FFFFFF' };
    s1.addText('Newsletter', { x:0.5, y:1.0, w:12, h:0.6, fontSize:18, color: GOLD, fontFace:'Poppins' });
    s1.addText('Conteúdo & Temas', { x:0.5, y:1.7, w:12, h:1.0, fontSize:44, bold:true, color: NAVY, fontFace:'Poppins' });
    s1.addText(_filterSummary(filters), { x:0.5, y:3.3, w:12, h:0.8, fontSize:14, color:'474650', fontFace:'Poppins', italic:true });
    s1.addText(`${enriched.length} campanhas · ${agg.countries.size} países · ${agg.cities.size} cidades · open rate médio ${(agg.avgOpenRate||0).toFixed(1)}%`,
      { x:0.5, y:4.5, w:12, h:0.6, fontSize:14, color:NAVY, fontFace:'Poppins' });
    s1.addText(`Gerado em ${new Date().toLocaleString('pt-BR')}`,
      { x:0.5, y:6.8, w:12, h:0.4, fontSize:9, color:'888', fontFace:'Poppins' });

    // ── Helper: slide com tabela a partir de map ──
    const addMapSlide = (title, icon, map, primaryLabel) => {
      if (!map || map.size === 0) return;
      const s = pptx.addSlide();
      s.background = { color:'FFFFFF' };
      s.addText(`${icon}  ${title}`, { x:0.5, y:0.35, w:12, h:0.6, fontSize:24, bold:true, color: NAVY, fontFace:'Poppins' });
      s.addText(`${enriched.length} campanhas · ${_filterSummary(filters)}`,
        { x:0.5, y:0.95, w:12, h:0.4, fontSize:10, color:'888', fontFace:'Poppins', italic:true });

      const rows = [...map.entries()].map(([name, d]) => [
        String(name),
        String(d.count),
        d.totalSent.toLocaleString('pt-BR'),
        d.totalSent > 0 ? (d.totalOpen / d.totalSent * 100).toFixed(1) + '%' : '—',
        d.totalSent > 0 ? (d.totalClick/ d.totalSent * 100).toFixed(1) + '%' : '—',
        d.totalSent > 0 ? (d.totalOptOut/d.totalSent*100).toFixed(2) + '%' : '—',
      ]).sort((a, b) => +b[1] - +a[1]).slice(0, 15);

      const header = [primaryLabel, 'Disparos', 'Enviados', 'Abertura', 'Cliques', 'Opt-out']
        .map(t => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: GOLD } } }));
      const body = rows.map(r => r.map(c => ({ text: String(c), options: { color: NAVY }})));

      s.addTable([header, ...body], {
        x: 0.5, y: 1.45, w: 12.3,
        fontSize: 11, fontFace: 'Poppins',
        border: { type: 'solid', color: 'E5E5E5', pt: 0.5 },
        rowH: 0.35,
      });
    };

    addMapSlide('Classificação Comercial', '💼', agg.commercial,     'Categoria');
    addMapSlide('Classificação Turismo',   '✈️', agg.tourism,        'Categoria');
    addMapSlide('Top Países',              '🌍', agg.countries,      'País');
    addMapSlide('Top Cidades',             '🏙', agg.cities,         'Cidade');
    addMapSlide('Hotéis citados',          '🏨', agg.hotels,         'Hotel');
    addMapSlide('Cruzeiros',               '🚢', agg.cruises,        'Operadora');
    addMapSlide('Temas / Posicionamento',  '🎯', agg.themes,         'Tema');
    // 4.49.32+ slide "Tipo (legado)" removido — Comercial + Turismo cobrem.

    await pptx.writeFile({ fileName: _exportFilename('pptx') });
  } catch (e) {
    console.error('[contentPptx]', e);
    alert('Erro ao gerar PPT: ' + e.message);
  }
}

function aggregateContent(docs) {
  const countries = new Map();
  const cities    = new Map();
  const hotels    = new Map();
  const cruises   = new Map();   // 4.9.0+ separado de hotels
  const brands    = new Map();
  const themes    = new Map();
  const audiences = new Map();
  const newsletterTypes = new Map(); // 4.9.0+ promocao/aereo/roteiro/hotelaria/cruzeiro/csat/inspiracional/institucional
  // 4.49.27+ Eixos duplos: Comercial + Turismo (spec do user)
  const commercial = new Map(); // promocao|sazonal|parceiro|inspiracional
  const tourism    = new Map(); // evento|aereo|roteiro|servico|hotelaria|cruzeiro|produto|destino|outros
  let confidenceHigh = 0;
  let totalOpenRate = 0;
  let openRateCount = 0;

  for (const d of docs) {
    const ex = d.extracted || {};
    const sent  = +(d.totalSent   || 0);
    const opens = +(d.openUnique  || 0);
    const clk   = +(d.clickUnique || 0);   // 4.49.24+ track cliques
    const opt   = +(d.optOut      || 0);   // 4.49.24+ track opt-out
    if (sent > 0) { totalOpenRate += +(d.openRate || 0); openRateCount++; }
    if (ex.confidence === 'high') confidenceHigh++;

    const tally = (map, name) => {
      if (!name) return;
      const k = String(name).trim();
      if (!k) return;
      // 4.49.24+ Adicionei totalClick e totalOptOut pra suportar sort por
      // qualquer coluna (req do user: "ordenar disparos/abertura/cliques/opt-out")
      const cur = map.get(k) || {
        count: 0, totalSent: 0, totalOpen: 0,
        totalClick: 0, totalOptOut: 0,
        sends: [],
      };
      cur.count++;
      cur.totalSent  += sent;
      cur.totalOpen  += opens;
      cur.totalClick += clk;
      cur.totalOptOut+= opt;
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
    // 4.49.27+ Eixos duplos da spec do user
    if (ex.commercial) tally(commercial, ex.commercial);
    if (ex.tourism)    tally(tourism, ex.tourism);
  }

  return {
    countries, cities, hotels, cruises, brands, themes, audiences, newsletterTypes,
    commercial, tourism,   // 4.49.27+
    confidenceHigh,
    avgOpenRate: openRateCount > 0 ? totalOpenRate / openRateCount : 0,
    byCountry: countries,
  };
}

/* ─── Renderers ────────────────────────────────────────────── */

/* ─── Critérios canônicos da IA (4.10.0+) ─────────────────────
 * Cada bloco/KPI tem um tooltip "ⓘ" que explica COMO a entidade
 * foi extraída. Transparência radical pra usuário entender o que
 * está vendo e quando deve corrigir manualmente via botão Editar.
 */
const INFO_TIPS = {
  countries:      'Países extraídos por matching contra dicionário curado de keywords geográficas (ex: "Mekong" → Vietnã, "Toscana" → Itália, "Acrópole" → Grécia). Subject + nome + descrição.',
  cities:         'Cidades/regiões identificadas por keywords específicas no subject (ex: "Lençóis Maranhenses", "Cumbuco", "Atenas", "Mar Jônico"). Granularidade abaixo de país.',
  hotels:         'Hotéis identificados por matching contra dicionário curado de marcas e empreendimentos PRIMETOUR (Faena, OIÁ, Carmel, Emiliano, Six Senses, EDITION, Four Seasons, Inkaterra, etc.).',
  cruises:        'Operadoras marítimas (Aqua Expeditions, Silversea, Ritz-Carlton Yacht, Delfin, AmaWaterways, Orient Express). Ficam SEPARADAS de hotéis pois são produtos distintos.',
  brands:         'Subset de hotels.brand + cruises.brand. Cada marca aparece 1× por campanha (não infla por waves).',
  openRate:       'Média ponderada da taxa de abertura das newsletters enriquecidas (sample.openRate × N campanhas / total).',
  newsletterType: 'Classificação por padrões no subject: csat (pesquisa), aereo (voo/classe executiva), cruzeiro (yacht/Silversea/Aqua), show/evento (BTS, Bocelli, GP), retreat/wellness (Rituaali, spa), promocao (Dia das Mães, %OFF), roteiro (multi-destino), hotelaria (default).',
  // 4.49.27+ Eixos duplos da spec do user
  commercial:     'Eixo COMERCIAL (tema macro da comunicação): Sazonal (estação/feriado/data específica), Promoção (oferta/desconto/condição comercial), Parceiro (empresa parceira em destaque), Inspiracional (editorial sem valor). Prioridade: Sazonal > Promoção > Parceiro > Inspiracional.',
  tourism:        'Eixo TURISMO (tipo de conteúdo turístico): Evento (shows/esportes/festivais), Aéreo (voos/passagens/milhas), Roteiro (multi-dia/multi-destino), Serviço (transfer/concierge), Hotelaria (hotel específico), Cruzeiro (yacht/river-cruise), Produto (presentes/revista), Destino (foco no lugar), Outros (trens, experiências raras). Prioridade: Evento > Aéreo > Roteiro > Serviço > Hotelaria > Cruzeiro > Produto > Destino > Outros.',
  topCountries:   'Top 12 países por # de campanhas. Open rate médio agregado dos disparos relacionados. Click pra drill-down.',
  topCities:      'Top 12 cidades/regiões por # de campanhas. Granularidade abaixo de país (ex: Atenas dentro de Grécia). Click pra drill-down.',
  topHotels:      'Top 10 hotéis mais mencionados nas newsletters do período. Cada hotel conta 1× por campanha (dedup intra-doc + inter-wave).',
  topCruises:     'Top operadoras de cruzeiro. Estão SEPARADAS de hotéis no schema pois são produtos distintos no portfolio.',
  themes:         'Temas inferidos por triggers no subject. luxo→cinco-estrelas/Faena/Aman; romance→casais/lua-de-mel; familia→Dia-das-Mães/crianças/villas; aventura→safari/Antártida; gastronomia→Michelin/vinho; wellness→spa/yoga; cultura→museu/Acrópole; praia→ilhas/beach; cidade→city-break; natureza→parques/paisagem; mar→cruzeiro/yacht; slow-travel→sem-pressa.',
  brandsBlock:    'Marcas mais citadas em ordem decrescente. Tier-1 (ultra-luxo): Aman, Belmond, Faena, Six Senses, Bvlgari, Cheval Blanc. Tier-2 (luxo): Four Seasons, Ritz-Carlton, EDITION, Lotte. Marcas próprias PRIMETOUR: OIÁ, Carmel, Emiliano.',
  byBu:           'Distribuição de campanhas, top destino, top hotel, top tema e open rate médio agrupados por BU (Primetour, BTG Partners, BTG Ultrablue, Centurion, PTS).',
  envios:         'Lista das campanhas enriquecidas (deduplicadas por baseCode — P0209_1/_2/_3 = 1 linha). Click no ✎ pra editar manualmente quando IA errar.',
};

function blockHeader(title, tooltipOrKey, widgetId) {
  // 4.49.32+ Ícone "i" não usa mais o title= nativo (texto pequeno e
  // ilegível). Vira botão que abre modal estruturado com definição
  // formatada (vê INFO_MODAL_DEFINITIONS + openInfoModal).
  // tooltipOrKey: string (com texto) OU key do INFO_MODAL_DEFINITIONS.
  const isKey = typeof tooltipOrKey === 'string' && INFO_MODAL_DEFINITIONS[tooltipOrKey];
  const infoKey = isKey ? tooltipOrKey : '';
  const fallbackText = isKey ? '' : (tooltipOrKey || '');
  const tipBtn = tooltipOrKey ? `<button type="button" class="nlc-info-btn"
      data-info-key="${esc(infoKey)}"
      data-info-title="${esc(title)}"
      data-info-fallback="${esc(fallbackText)}"
      title="Sobre este indicador"
      style="cursor:pointer;display:inline-flex;align-items:center;justify-content:center;
      width:22px;height:22px;border-radius:50%;background:var(--bg-elevated);
      color:var(--text-muted);font-size:0.8125rem;font-weight:700;font-style:italic;
      font-family:Georgia,serif;border:1px solid var(--border-subtle);
      transition:all 0.15s;padding:0;line-height:1;"
      onmouseover="this.style.background='var(--brand-gold)';this.style.color='white';this.style.borderColor='var(--brand-gold)';"
      onmouseout="this.style.background='var(--bg-elevated)';this.style.color='var(--text-muted)';this.style.borderColor='var(--border-subtle)';">i</button>` : '';
  const insightSlot = widgetId
    ? `<span class="widget-insights-slot" data-widget-id="${esc(widgetId)}"></span>`
    : '';
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 12px 0;">
    <h3 style="margin:0;font-size:0.875rem;font-weight:700;text-transform:uppercase;
      letter-spacing:0.06em;color:var(--text-muted);">${title}</h3>
    <div style="display:flex;align-items:center;gap:6px;">
      ${insightSlot}
      ${tipBtn}
    </div>
  </div>`;
}

// 4.49.32+ Definições estruturadas legíveis em modal.
// Cada entry tem { definition, categories[]?, priority?, examples[]?, source? }
// Substitui texto longo do INFO_TIPS antigo por estrutura HTML formatada.
const INFO_MODAL_DEFINITIONS = {
  commercial: {
    title: '💼 Classificação Comercial',
    definition: 'Eixo macro da comunicação — qual a INTENÇÃO comercial do disparo. Cada doc recebe exatamente UMA categoria.',
    categories: [
      { label: '🗓 Sazonal',       desc: 'Período específico mencionado: estação (verão/inverno), feriado (Natal, Páscoa, Mães), data comemorativa, mês+ano explícito.' },
      { label: '🏷 Promoção',      desc: 'Valor, desconto, condição comercial: %OFF, "noite FREE", cashback, "crédito US$", "tarifa especial", benefício exclusivo.' },
      { label: '🤝 Parceiro',      desc: 'Empresa parceira em destaque: Cartão Partners, Centurion Card, Latam Pass, celebridade (Bocelli), marca não-PRIMETOUR (Rolex, Tag Heuer).' },
      { label: '✨ Inspiracional', desc: 'Editorial sem valor, sazonalidade ou parceiro destacado. Foco em desejo/conteúdo curado.' },
    ],
    priority: ['Sazonal', 'Promoção', 'Parceiro', 'Inspiracional'],
    source: 'Classificação automática via regex sobre subject + name + body do email.',
  },
  tourism: {
    title: '✈️ Classificação Turismo',
    definition: 'Tipo de conteúdo turístico apresentado. Cada doc recebe exatamente UMA categoria.',
    categories: [
      { label: '🎤 Evento',    desc: 'Shows, esportes, festivais com data/local específicos (Bocelli, GP, Wimbledon, Olimpíadas).' },
      { label: '✈ Aéreo',      desc: 'Voos, passagens, classe executiva, milhas (Latam Pass, jato privado, Emirates).' },
      { label: '📍 Roteiro',   desc: 'Multi-destino, X noites, day-by-day, pacote fechado com preço por pessoa.' },
      { label: '🛎 Serviço',   desc: 'Transfer, concierge, Lifestyle Manager, alfaiate, personal shopper.' },
      { label: '🏨 Hotelaria', desc: 'Bloco/destaque de hotel específico — hospedagem como protagonista.' },
      { label: '🚢 Cruzeiro',  desc: 'Yacht, navio, river-cruise — Silversea, Aqua Mekong, Ritz-Carlton Yacht.' },
      { label: '🎁 Produto',   desc: 'Item físico — flores, presentes, entrega de revista.' },
      { label: '🌍 Destino',   desc: 'Editorial sobre o lugar em si — sem hotel/aéreo/roteiro específico.' },
      { label: '◇ Outros',     desc: 'Trens de luxo (Orient Express, Andean Explorer) ou casos não-classificáveis.' },
    ],
    priority: ['Evento', 'Aéreo', 'Roteiro', 'Serviço', 'Hotelaria', 'Cruzeiro', 'Produto', 'Destino', 'Outros'],
    source: 'Classificação automática via regex sobre subject + name + body do email.',
  },
  topCountries: {
    title: '🌍 Top Países',
    definition: 'Contagem de campanhas que mencionam cada país (no subject, name ou body). Cada campanha conta 1× por país independente de waves.',
    examples: ['Itália (10 disparos · 28% open rate médio)', 'Maldivas (4 disparos · 41% open rate)'],
    source: 'Extração automática via dicionário curado de 51 países (PT + EN) sobre subject + name + body com regra anti-boilerplate (header/footer cortados).',
  },
  topCities: {
    title: '🏙 Top Cidades / Regiões',
    definition: 'Granularidade abaixo de país: cidades, regiões turísticas (Toscana), atrações-âncora (Mekong, Acrópole).',
    examples: ['Atenas (Grécia)', 'Mar Egeu (região)', 'Bora Bora (Polinésia Francesa)'],
    source: 'Dicionário curado de 148 cidades com país-mãe. Aliases (NY → Nova York, Tokyo → Tóquio).',
  },
  topHotels: {
    title: '🏨 Hotéis citados',
    definition: 'Hotéis identificados por marca curada (luxury travel). Cada hotel conta 1× por campanha (dedup intra-doc + inter-wave).',
    examples: ['Aman Tokyo, Belmond, Faena, Patina Maldives, Waldorf Astoria'],
    source: 'Dicionário de 50+ marcas premium (Aman, Belmond, Faena, Six Senses, Cheval Blanc, Four Seasons, Ritz-Carlton, Capella, Rosewood…).',
  },
  topCruises: {
    title: '🚢 Cruzeiros / Operadoras Marítimas',
    definition: 'Operadoras de cruzeiro/yacht separadas dos hotéis (são produtos com economia distinta).',
    examples: ['Silversea, Aqua Expeditions, Ritz-Carlton Yacht, Crystal Cruises'],
  },
  themes: {
    title: '🎯 Temas / Posicionamento',
    definition: 'Tags livres que indicam o ângulo emocional/de posicionamento da campanha. Múltiplos temas por campanha.',
    examples: ['luxo, romance, família, aventura, gastronomia, wellness, cultura, praia, cidade, natureza, mar, slow-travel'],
  },
  brandsBlock: {
    title: '🏷 Marcas Hoteleiras Citadas',
    definition: 'Subset de hotels.brand + cruises.brand. Cada marca aparece 1× por campanha (não infla por waves).',
  },
  openRate: {
    title: '📊 Open Rate Médio',
    definition: 'Média ponderada da taxa de abertura das newsletters enriquecidas (campanhas com extração válida).',
    source: 'Fórmula: Σ(openRate × totalSent) / Σ(totalSent) — pondera por volume de envio.',
  },
};

async function openInfoModal(key, fallbackTitle) {
  const { modal } = await import('../components/modal.js');
  const def = INFO_MODAL_DEFINITIONS[key];
  let content;
  if (!def) {
    content = `<div style="padding:16px;color:var(--text-muted);">${esc(fallbackTitle || 'Sem definição disponível.')}</div>`;
  } else {
    const catsHTML = def.categories?.length
      ? `<div style="margin-top:16px;">
          <div style="font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:8px;">Categorias</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${def.categories.map(c => `
              <div style="padding:10px 12px;background:var(--bg-elevated);border-radius:6px;border-left:3px solid var(--brand-gold);">
                <div style="font-size:0.875rem;font-weight:600;color:var(--text-primary);margin-bottom:3px;">${esc(c.label)}</div>
                <div style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.5;">${esc(c.desc)}</div>
              </div>`).join('')}
          </div>
        </div>` : '';
    const priHTML = def.priority?.length
      ? `<div style="margin-top:16px;padding:10px 14px;background:rgba(212,168,67,0.08);border-radius:6px;border:1px solid rgba(212,168,67,0.25);">
          <div style="font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--brand-gold);margin-bottom:6px;">⚡ Prioridade em caso de convergência</div>
          <div style="font-size:0.8125rem;color:var(--text-primary);line-height:1.6;">
            ${def.priority.map((p, i) => `<span style="display:inline-block;margin-right:6px;">${i+1}. <strong>${esc(p)}</strong></span>`).join(' › ')}
          </div>
        </div>` : '';
    const exHTML = def.examples?.length
      ? `<div style="margin-top:16px;">
          <div style="font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:6px;">Exemplos</div>
          <div style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.6;">
            ${def.examples.map(e => `<div>• ${esc(e)}</div>`).join('')}
          </div>
        </div>` : '';
    const srcHTML = def.source
      ? `<div style="margin-top:16px;padding-top:12px;border-top:1px dashed var(--border-subtle);
          font-size:0.6875rem;color:var(--text-muted);line-height:1.6;font-style:italic;">
          ${esc(def.source)}
        </div>` : '';
    content = `
      <div style="font-size:0.9375rem;color:var(--text-primary);line-height:1.6;">
        ${esc(def.definition)}
      </div>
      ${catsHTML}
      ${priHTML}
      ${exHTML}
      ${srcHTML}`;
  }

  modal.open({
    title: def?.title || (fallbackTitle || 'Sobre este indicador'),
    size: 'md',
    content,
    dedupeKey: `nlc-info-${key}`,
    footer: [{ label: 'Fechar', class: 'btn-secondary', closeOnClick: true }],
  });
}

function contentKpi(title, value, sub, tooltip) {
  const infoBtn = tooltip ? `<span title="${esc(tooltip)}"
    style="cursor:help;float:right;display:inline-flex;align-items:center;justify-content:center;
    width:16px;height:16px;border-radius:50%;background:var(--bg-elevated);
    color:var(--text-muted);font-size:0.625rem;font-weight:600;font-style:italic;
    font-family:Georgia,serif;border:1px solid var(--border-subtle);">i</span>` : '';
  return `<div class="card" style="padding:14px 16px;">
    <div style="font-size:0.6875rem;color:var(--text-muted);text-transform:uppercase;
      letter-spacing:0.05em;font-weight:600;margin-bottom:4px;">${title}${infoBtn}</div>
    <div style="font-size:1.5rem;font-weight:700;color:var(--text-primary);">${value}</div>
    <div style="font-size:0.6875rem;color:var(--text-muted);margin-top:2px;">${sub}</div>
  </div>`;
}

// 4.49.24+ State global de sort/expand por bloco. Persistido in-memory
// pra sobreviver re-renders do tab; reset quando user navega fora.
const _contentTableState = {}; // { 'countries': { sortBy:'count', dir:'desc', expanded:false } }

function _getTblState(key) {
  if (!_contentTableState[key]) {
    _contentTableState[key] = { sortBy: 'count', dir: 'desc', expanded: false };
  }
  return _contentTableState[key];
}

function _sortAndCap(rows, state, cap = 12) {
  const dir = state.dir === 'asc' ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    const va = a[state.sortBy] ?? 0;
    const vb = b[state.sortBy] ?? 0;
    if (typeof va === 'string' || typeof vb === 'string') {
      return dir * String(va).localeCompare(String(vb), 'pt-BR');
    }
    return dir * (vb - va) * -1; // dir invertido pra manter intuição: desc primeiro
  });
  return state.expanded ? sorted : sorted.slice(0, cap);
}

function _sortIcon(state, col) {
  if (state.sortBy !== col) return '<span style="opacity:0.3;">⇅</span>';
  return state.dir === 'desc' ? '▼' : '▲';
}

function renderTopDestinosTable(map, allEnriched, label = 'País') {
  if (!map || map.size === 0) return `<p style="color:var(--text-muted);font-size:0.8125rem;">Nenhum ${String(label).toLowerCase()} identificado ainda.</p>`;
  const stateKey = label === 'cidade' ? 'cities' : 'countries';
  const state = _getTblState(stateKey);

  // 4.49.24+ enriquecido: adiciona clickRate, optOutRate e os totais
  // pra suportar sort em qualquer eixo.
  const all = [...map.entries()].map(([name, d]) => ({
    name,
    count: d.count,
    totalSent: d.totalSent,
    openRate:   d.totalSent > 0 ? (d.totalOpen   / d.totalSent * 100) : 0,
    clickRate:  d.totalSent > 0 ? (d.totalClick  / d.totalSent * 100) : 0,
    optOutRate: d.totalSent > 0 ? (d.totalOptOut / d.totalSent * 100) : 0,
    sends: d.sends,
  }));
  const totalCount = all.length;
  const rows = _sortAndCap(all, state, 12);

  const headerLabel = label === 'cidade' ? 'Cidade / Região' : 'País';
  const drillClass = label === 'cidade' ? 'nlc-city-drill' : 'nlc-country-drill';
  const drillAttr  = label === 'cidade' ? 'data-city'      : 'data-country';

  const sortable = (col, lbl) =>
    `<th class="nlc-sort-th" data-tbl="${stateKey}" data-col="${col}"
      style="text-align:right;padding:8px 6px;cursor:pointer;user-select:none;">
      ${esc(lbl)} ${_sortIcon(state, col)}</th>`;

  // Header de "ver todos" abaixo da tabela
  const expandHint = !state.expanded && totalCount > 12
    ? `<div style="text-align:center;padding:8px 0;">
        <button class="nlc-expand-btn" data-tbl="${stateKey}"
          style="background:none;border:1px solid var(--border-subtle);border-radius:6px;
          padding:5px 12px;cursor:pointer;font-size:0.75rem;color:var(--text-secondary);">
          + Ver todos os ${totalCount}
        </button>
       </div>`
    : state.expanded && totalCount > 12
      ? `<div style="text-align:center;padding:8px 0;">
          <button class="nlc-expand-btn" data-tbl="${stateKey}"
            style="background:none;border:1px solid var(--border-subtle);border-radius:6px;
            padding:5px 12px;cursor:pointer;font-size:0.75rem;color:var(--text-secondary);">
            − Colapsar (top 12)
          </button>
         </div>`
      : '';

  return `<table style="width:100%;font-size:0.8125rem;border-collapse:collapse;">
    <thead><tr style="border-bottom:1px solid var(--border-subtle);color:var(--text-muted);font-size:0.6875rem;text-transform:uppercase;letter-spacing:0.05em;">
      <th class="nlc-sort-th" data-tbl="${stateKey}" data-col="name"
        style="text-align:left;padding:8px 6px;cursor:pointer;user-select:none;">
        ${esc(headerLabel)} ${_sortIcon(state, 'name')}</th>
      ${sortable('count', 'Disparos')}
      ${sortable('openRate', 'Abertura')}
      ${sortable('clickRate', 'Cliques')}
      ${sortable('optOutRate', 'Opt-out')}
    </tr></thead>
    <tbody>${rows.map(r => `<tr style="border-bottom:1px solid var(--border-subtle);cursor:pointer;"
      class="${drillClass} nlc-drill-row" ${drillAttr}="${esc(r.name)}"
      data-sends="${esc(JSON.stringify(r.sends))}" data-name="${esc(r.name)}"
      data-entity="${stateKey === 'cities' ? 'city' : 'country'}"
      title="Click pra ver os ${r.count} disparos de ${esc(r.name)}">
      <td style="padding:7px 6px;font-weight:500;">${esc(r.name)}</td>
      <td style="padding:7px 6px;text-align:right;color:var(--text-secondary);">${r.count}</td>
      <td style="padding:7px 6px;text-align:right;font-weight:600;color:${rateColor2(r.openRate)};">${r.openRate.toFixed(1)}%</td>
      <td style="padding:7px 6px;text-align:right;color:var(--text-secondary);">${r.clickRate.toFixed(1)}%</td>
      <td style="padding:7px 6px;text-align:right;color:var(--text-secondary);">${r.optOutRate.toFixed(2)}%</td>
    </tr>`).join('')}</tbody>
  </table>
  ${expandHint}`;
}

// 4.49.27+ Renderer dos eixos duplos (Comercial + Turismo).
// Mesma estética dos newsletterTypes mas com labels/cores próprios e
// drill-down clicável (data-entity=commercial/tourism).
const COMMERCIAL_LABELS = {
  promocao:       '🏷 Promoção',
  sazonal:        '🗓 Sazonal',
  parceiro:       '🤝 Parceiro',
  inspiracional:  '✨ Inspiracional',
};
const COMMERCIAL_COLORS = {
  promocao: '#F59E0B', sazonal: '#10B981',
  parceiro: '#8B5CF6', inspiracional: '#3B82F6',
};
const TOURISM_LABELS = {
  evento:    '🎤 Evento',
  aereo:     '✈ Aéreo',
  roteiro:   '📍 Roteiro',
  servico:   '🛎 Serviço',
  hotelaria: '🏨 Hotelaria',
  cruzeiro:  '🚢 Cruzeiro',
  produto:   '🎁 Produto',
  destino:   '🌍 Destino',
  outros:    '◇ Outros',
};
const TOURISM_COLORS = {
  evento: '#F97316', aereo: '#3B82F6', roteiro: '#10B981',
  servico: '#06B6D4', hotelaria: '#8B5CF6', cruzeiro: '#0EA5E9',
  produto: '#EC4899', destino: '#D4A843', outros: '#6B7280',
};

function renderClassificationBars(map, axis) {
  if (!map || map.size === 0) return '<p style="color:var(--text-muted);font-size:0.8125rem;">Sem dados classificados ainda. Rode o classifier.</p>';
  const labels = axis === 'commercial' ? COMMERCIAL_LABELS : TOURISM_LABELS;
  const colors = axis === 'commercial' ? COMMERCIAL_COLORS : TOURISM_COLORS;
  const all = [...map.entries()].map(([name, d]) => ({
    name, count: d.count, sends: d.sends, totalSent: d.totalSent,
    openRate:   d.totalSent > 0 ? (d.totalOpen   / d.totalSent * 100) : 0,
    clickRate:  d.totalSent > 0 ? (d.totalClick  / d.totalSent * 100) : 0,
    optOutRate: d.totalSent > 0 ? (d.totalOptOut / d.totalSent * 100) : 0,
  }));
  all.sort((a, b) => b.count - a.count);
  const max = all[0]?.count || 1;

  return all.map(r => `<div class="nlc-drill-row" data-entity="${axis}" data-name="${esc(r.name)}"
    data-sends="${esc(JSON.stringify(r.sends))}"
    style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:0.8125rem;
    cursor:pointer;padding:2px 4px;border-radius:4px;"
    title="Click pra ver os ${r.count} disparos classificados como ${esc(labels[r.name]||r.name)}"
    onmouseover="this.style.background='rgba(212,168,67,0.06)'"
    onmouseout="this.style.background=''">
    <div style="flex:0 0 130px;">${esc(labels[r.name] || r.name)}</div>
    <div style="flex:1;min-width:60px;height:8px;background:var(--bg-elevated);border-radius:4px;overflow:hidden;">
      <div style="height:100%;width:${(r.count/max*100).toFixed(1)}%;background:${colors[r.name] || '#94A3B8'};"></div>
    </div>
    <div style="flex:0 0 40px;text-align:right;font-weight:600;color:var(--text-secondary);">${r.count}</div>
    <div style="flex:0 0 60px;text-align:right;font-size:0.75rem;color:${rateColor2(r.openRate)};" title="Abertura">${r.openRate.toFixed(1)}%</div>
    <div style="flex:0 0 50px;text-align:right;font-size:0.75rem;color:var(--text-muted);" title="Cliques">${r.clickRate.toFixed(1)}%</div>
    <div style="flex:0 0 50px;text-align:right;font-size:0.75rem;color:var(--text-muted);" title="Opt-out">${r.optOutRate.toFixed(2)}%</div>
  </div>`).join('');
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
  // 4.49.24+ Enriquecido com cliques + opt-out, drill clicável.
  const top = [...typesMap.entries()]
    .map(([name, d]) => ({
      name, count: d.count, sends: d.sends, totalSent: d.totalSent,
      openRate:   d.totalSent > 0 ? (d.totalOpen   / d.totalSent * 100) : 0,
      clickRate:  d.totalSent > 0 ? (d.totalClick  / d.totalSent * 100) : 0,
      optOutRate: d.totalSent > 0 ? (d.totalOptOut / d.totalSent * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);
  const max = top[0]?.count || 1;
  return top.map(r => `<div class="nlc-drill-row" data-entity="newsletterType" data-name="${esc(r.name)}"
    data-sends="${esc(JSON.stringify(r.sends))}"
    style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:0.8125rem;
    cursor:pointer;padding:2px 4px;border-radius:4px;"
    title="Click pra ver os ${r.count} disparos do tipo ${esc(labels[r.name]||r.name)}"
    onmouseover="this.style.background='rgba(212,168,67,0.06)'"
    onmouseout="this.style.background=''">
    <div style="flex:0 0 140px;">${esc(labels[r.name] || r.name)}</div>
    <div style="flex:1;min-width:60px;height:8px;background:var(--bg-elevated);border-radius:4px;overflow:hidden;">
      <div style="height:100%;width:${(r.count/max*100).toFixed(1)}%;background:${colors[r.name] || '#94A3B8'};"></div>
    </div>
    <div style="flex:0 0 40px;text-align:right;font-weight:600;color:var(--text-secondary);">${r.count}</div>
    <div style="flex:0 0 60px;text-align:right;font-size:0.75rem;color:${rateColor2(r.openRate)};" title="Abertura">${r.openRate.toFixed(1)}%</div>
    <div style="flex:0 0 50px;text-align:right;font-size:0.75rem;color:var(--text-muted);" title="Cliques">${r.clickRate.toFixed(1)}%</div>
    <div style="flex:0 0 50px;text-align:right;font-size:0.75rem;color:var(--text-muted);" title="Opt-out">${r.optOutRate.toFixed(2)}%</div>
  </div>`).join('');
}

// 4.49.24+ Versão genérica de bars com drill + expand. Usa _contentTableState.
function _renderBarsList(map, opts) {
  const { emptyMsg, stateKey, entity, color = 'var(--brand-gold)', capDefault = 10, labels = {} } = opts;
  if (!map || map.size === 0) return `<p style="color:var(--text-muted);font-size:0.8125rem;">${emptyMsg}</p>`;
  const state = _getTblState(stateKey);
  const all = [...map.entries()].map(([name, d]) => ({
    name, count: d.count, sends: d.sends, totalSent: d.totalSent,
    openRate:   d.totalSent > 0 ? (d.totalOpen   / d.totalSent * 100) : 0,
    clickRate:  d.totalSent > 0 ? (d.totalClick  / d.totalSent * 100) : 0,
    optOutRate: d.totalSent > 0 ? (d.totalOptOut / d.totalSent * 100) : 0,
  }));
  // Bars sempre ordenam por count desc (visual); expand muda só o cap
  all.sort((a, b) => b.count - a.count);
  const total = all.length;
  const rows = state.expanded ? all : all.slice(0, capDefault);
  const max = all[0]?.count || 1;

  const bars = rows.map(r => `<div class="nlc-drill-row" data-entity="${entity}" data-name="${esc(r.name)}"
    data-sends="${esc(JSON.stringify(r.sends))}"
    style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:0.8125rem;
    cursor:pointer;padding:2px 4px;border-radius:4px;"
    title="Click pra ver os ${r.count} disparos de ${esc(labels[r.name] || r.name)}"
    onmouseover="this.style.background='rgba(212,168,67,0.06)'"
    onmouseout="this.style.background=''">
    <div style="flex:0 0 ${opts.labelWidth || 120}px;${opts.capitalize ? 'text-transform:capitalize;' : ''}
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(labels[r.name] || r.name)}</div>
    <div style="flex:1;min-width:60px;height:8px;background:var(--bg-elevated);border-radius:4px;overflow:hidden;">
      <div style="height:100%;width:${(r.count/max*100).toFixed(1)}%;background:${color};"></div>
    </div>
    <div style="flex:0 0 40px;text-align:right;font-weight:600;color:var(--text-secondary);">${r.count}</div>
    <div style="flex:0 0 60px;text-align:right;font-size:0.75rem;color:${rateColor2(r.openRate)};" title="Abertura">${r.openRate.toFixed(1)}%</div>
    <div style="flex:0 0 50px;text-align:right;font-size:0.75rem;color:var(--text-muted);" title="Cliques">${r.clickRate.toFixed(1)}%</div>
    <div style="flex:0 0 50px;text-align:right;font-size:0.75rem;color:var(--text-muted);" title="Opt-out">${r.optOutRate.toFixed(2)}%</div>
  </div>`).join('');

  const expandHint = total > capDefault
    ? `<div style="text-align:center;padding:6px 0;">
        <button class="nlc-expand-btn" data-tbl="${stateKey}"
          style="background:none;border:1px solid var(--border-subtle);border-radius:6px;
          padding:4px 12px;cursor:pointer;font-size:0.75rem;color:var(--text-secondary);">
          ${state.expanded ? `− Colapsar (top ${capDefault})` : `+ Ver todos os ${total}`}
        </button>
       </div>`
    : '';
  return bars + expandHint;
}

function renderTopHoteisBars(hotelsMap, allEnriched) {
  return _renderBarsList(hotelsMap, {
    emptyMsg: 'Nenhum hotel identificado ainda.',
    stateKey: 'hotels', entity: 'hotel',
    color: 'var(--brand-gold)', capDefault: 10, labelWidth: 180,
  });
}

function renderThemesBars(themesMap, allEnriched) {
  return _renderBarsList(themesMap, {
    emptyMsg: 'Nenhum tema identificado ainda.',
    stateKey: 'themes', entity: 'theme',
    color: '#8B5CF6', capDefault: 12, labelWidth: 120, capitalize: true,
  });
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

// Larguras default + persistência via localStorage. Coluna 0=Data, 1=Tipo·Nome, 2=Países,
// 3=Hotéis, 4=Temas, 5=Open, 6=Editar.
const ENVIOS_COL_DEFAULTS = [88, 260, 160, 200, 160, 70, 60];
const ENVIOS_COL_KEY = 'nl-content-envios-col-widths-v2';

function _loadEnviosColWidths() {
  try {
    const raw = localStorage.getItem(ENVIOS_COL_KEY);
    if (!raw) return [...ENVIOS_COL_DEFAULTS];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length !== ENVIOS_COL_DEFAULTS.length) return [...ENVIOS_COL_DEFAULTS];
    return arr.map((n, i) => Math.max(40, +n || ENVIOS_COL_DEFAULTS[i]));
  } catch { return [...ENVIOS_COL_DEFAULTS]; }
}
function _saveEnviosColWidths(arr) {
  try { localStorage.setItem(ENVIOS_COL_KEY, JSON.stringify(arr)); } catch {}
}

function renderEnrichedSendsList(docs) {
  const top = docs.slice(0, 50);
  const widths = _loadEnviosColWidths();
  const totalW = widths.reduce((s, w) => s + w, 0);
  const colgroup = `<colgroup>
    ${widths.map(w => `<col style="width:${w}px;">`).join('')}
  </colgroup>`;
  // Cada th tem um handle de resize na borda direita
  const thStyle = 'text-align:left;padding:8px 6px;position:relative;user-select:none;';
  const handle  = `<span class="nlc-col-resize" style="position:absolute;right:-3px;top:0;bottom:0;width:6px;cursor:col-resize;z-index:1;"></span>`;
  return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
    <span style="font-size:0.6875rem;color:var(--text-muted);">
      💡 Arraste a borda direita do cabeçalho para ajustar a largura das colunas.
    </span>
    <button id="nlc-reset-cols" class="btn btn-ghost btn-sm"
      title="Restaurar larguras padrão"
      style="font-size:0.6875rem;color:var(--text-muted);padding:2px 8px;">↺ Reset colunas</button>
  </div>
  <div style="overflow-x:auto;">
    <table id="nlc-envios-table" style="font-size:0.8125rem;border-collapse:collapse;table-layout:fixed;width:${totalW}px;">
      ${colgroup}
      <thead><tr style="border-bottom:1px solid var(--border-subtle);color:var(--text-muted);font-size:0.6875rem;text-transform:uppercase;letter-spacing:0.05em;">
        <th data-col="0" style="${thStyle}">Data${handle}</th>
        <th data-col="1" style="${thStyle}">Tipo · Nome${handle}</th>
        <th data-col="2" style="${thStyle}">Países${handle}</th>
        <th data-col="3" style="${thStyle}">Hotéis${handle}</th>
        <th data-col="4" style="${thStyle}">Temas${handle}</th>
        <th data-col="5" style="${thStyle}text-align:right;">Open${handle}</th>
        <th data-col="6" style="${thStyle}text-align:center;">Editar</th>
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
        const cellTrunc = 'padding:7px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        return `<tr style="border-bottom:1px solid var(--border-subtle);">
          <td title="${esc(dateStr)}" style="${cellTrunc}color:var(--text-muted);font-size:0.75rem;">${dateStr}</td>
          <td title="${esc(d.name || '')}" style="${cellTrunc}">${ntype}${esc(d.name || '—')}${waveTxt}</td>
          <td title="${esc(countries)}" style="${cellTrunc}color:var(--text-secondary);">${esc(countries)}</td>
          <td title="${esc(hotels || '')}" style="${cellTrunc}color:var(--text-secondary);">${esc(hotels || '—')}${moreH}</td>
          <td title="${esc(themes || '')}" style="${cellTrunc}color:var(--text-secondary);">${esc(themes || '—')}</td>
          <td style="${cellTrunc}text-align:right;font-weight:600;color:${rateColor2(d.openRate || 0)};">${(d.openRate || 0).toFixed(1)}%</td>
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

/** Wire dos resize-handles + reset da tabela de envios. Idempotente. */
function wireEnviosColResize() {
  const table = document.getElementById('nlc-envios-table');
  if (!table || table.dataset.wiredResize) return;
  table.dataset.wiredResize = '1';

  const cols = [...table.querySelectorAll('colgroup col')];
  if (!cols.length) return;

  // Mantém o array de larguras explicitas em estado — só altera a coluna arrastada.
  const state = _loadEnviosColWidths();
  const recomputeTableWidth = () => {
    table.style.width = `${state.reduce((s, w) => s + w, 0)}px`;
  };

  table.querySelectorAll('.nlc-col-resize').forEach((handle, i) => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const startX = e.clientX;
      const startW = state[i];
      document.body.style.cursor = 'col-resize';
      const onMove = (ev) => {
        const newW = Math.max(40, Math.round(startW + (ev.clientX - startX)));
        state[i] = newW;
        cols[i].style.width = `${newW}px`;
        recomputeTableWidth();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        _saveEnviosColWidths(state);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    handle.addEventListener('mouseenter', () => handle.style.background = 'var(--brand-gold)');
    handle.addEventListener('mouseleave', () => handle.style.background = 'transparent');
  });

  document.getElementById('nlc-reset-cols')?.addEventListener('click', () => {
    ENVIOS_COL_DEFAULTS.forEach((w, i) => { state[i] = w; cols[i].style.width = `${w}px`; });
    recomputeTableWidth();
    _saveEnviosColWidths(state);
  });
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
  // 4.49.24+ Click em qualquer linha drill (.nlc-drill-row) → abre MODAL
  // com a lista de disparos daquela entidade. Antes só setava filtro;
  // user pediu "ao clicar em Marrocos, abrir tela com todas as artes
  // classificadas como Marrocos, respeitando filtros já aplicados".
  document.querySelectorAll('.nlc-drill-row').forEach(row => {
    row.addEventListener('click', (e) => {
      // Não dispara se clicou no header de sort/expand
      if (e.target.closest('.nlc-sort-th, .nlc-expand-btn')) return;
      const entity = row.dataset.entity;
      const name   = row.dataset.name;
      let sends;
      try { sends = JSON.parse(row.dataset.sends || '[]'); }
      catch (_) { sends = []; }
      openDrillModal(entity, name, sends);
    });
  });

  // 4.49.24+ Sort por click em column header
  document.querySelectorAll('.nlc-sort-th').forEach(th => {
    th.addEventListener('click', () => {
      const tbl = th.dataset.tbl;
      const col = th.dataset.col;
      const state = _getTblState(tbl);
      if (state.sortBy === col) {
        state.dir = state.dir === 'desc' ? 'asc' : 'desc';
      } else {
        state.sortBy = col;
        state.dir    = (col === 'name') ? 'asc' : 'desc';
      }
      renderContentTab();
    });
  });

  // 4.49.24+ Botão "+ Ver todos" / "− Colapsar"
  document.querySelectorAll('.nlc-expand-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tbl = btn.dataset.tbl;
      const state = _getTblState(tbl);
      state.expanded = !state.expanded;
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
  // 4.49.32+ Botão "i" em cada blockHeader → abre modal de definição.
  document.querySelectorAll('.nlc-info-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.infoKey || '';
      const title = btn.dataset.infoTitle || '';
      const fallback = btn.dataset.infoFallback || '';
      openInfoModal(key, title || fallback);
    });
  });
  // Resize de colunas da tabela de envios (idempotente)
  wireEnviosColResize();
}

/* 4.49.24+ Drill-down modal: abre lista dos disparos que compõem
 * o item clicado, respeitando os filtros já aplicados na aba (BU,
 * período, etc. — porque sends[] já vem do agregador filtrado).
 *
 * Cada linha = uma campanha (mc_performance doc). Mostra: subject,
 * BU, sent date, totalSent, openRate, clickRate, optOut. Action:
 * "✎ Editar" reusa o openExtractedEditor (mesmo modal de override).
 */
async function openDrillModal(entity, name, sendIds) {
  const { modal } = await import('../components/modal.js');
  const allDocs = _lastContentDocs || [];
  const docs = allDocs.filter(d => sendIds.includes(d.id))
    .sort((a, b) => {
      const ta = a.sentDate?.toDate?.()?.getTime?.() || 0;
      const tb = b.sentDate?.toDate?.()?.getTime?.() || 0;
      return tb - ta;
    });

  const entityLabels = {
    country: 'país', city: 'cidade', hotel: 'hotel',
    theme: 'tema', newsletterType: 'tipo de newsletter',
    // 4.49.27+ Eixos duplos
    commercial: 'classificação comercial', tourism: 'classificação turismo',
  };
  const entityLabel = entityLabels[entity] || entity;

  const fmtDate = (ts) => {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' });
  };
  const pct = (n) => (n == null || n === '') ? '—' : `${Number(n).toFixed(1)}%`;
  const num = (n) => (n == null) ? '—' : Number(n).toLocaleString('pt-BR');

  const rows = docs.map(d => {
    const sent  = +(d.totalSent || 0);
    const opens = +(d.openUnique || 0);
    const clk   = +(d.clickUnique || 0);
    const opt   = +(d.optOut || 0);
    const openR  = sent > 0 ? (opens / sent * 100) : 0;
    const clickR = sent > 0 ? (clk   / sent * 100) : 0;
    const optR   = sent > 0 ? (opt   / sent * 100) : 0;
    return `<tr style="border-bottom:1px solid var(--border-subtle);font-size:0.8125rem;">
      <td style="padding:8px 6px;font-weight:500;color:var(--text-primary);max-width:340px;">
        <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(d.subject || '(sem subject)')}</div>
        <div style="font-size:0.6875rem;color:var(--text-muted);margin-top:2px;">${esc(d.baseCode || d.id || '')}</div>
      </td>
      <td style="padding:8px 6px;text-align:center;color:var(--text-secondary);">${esc(d.bu || '—')}</td>
      <td style="padding:8px 6px;text-align:right;color:var(--text-secondary);">${fmtDate(d.sentDate)}</td>
      <td style="padding:8px 6px;text-align:right;color:var(--text-secondary);">${num(sent)}</td>
      <td style="padding:8px 6px;text-align:right;color:${rateColor2(openR)};font-weight:600;">${pct(openR)}</td>
      <td style="padding:8px 6px;text-align:right;color:var(--text-secondary);">${pct(clickR)}</td>
      <td style="padding:8px 6px;text-align:right;color:var(--text-muted);">${pct(optR)}</td>
      <td style="padding:8px 6px;text-align:center;">
        <button class="nlc-drill-edit" data-doc-id="${esc(d.id)}"
          style="background:none;border:1px solid var(--border-subtle);border-radius:4px;
          padding:3px 8px;cursor:pointer;font-size:0.6875rem;color:var(--text-secondary);"
          title="Editar classificação manual">✎</button>
      </td>
    </tr>`;
  }).join('');

  const content = `
    <div style="margin-bottom:12px;font-size:0.8125rem;color:var(--text-muted);">
      ${docs.length} disparo${docs.length!==1?'s':''} classificado${docs.length!==1?'s':''} como
      <strong style="color:var(--text-primary);">${esc(name)}</strong> (${entityLabel}),
      respeitando filtros aplicados no dashboard.
    </div>
    <div style="max-height:60vh;overflow:auto;border:1px solid var(--border-subtle);border-radius:6px;">
      <table style="width:100%;border-collapse:collapse;">
        <thead style="position:sticky;top:0;background:var(--bg-elevated);z-index:1;">
          <tr style="font-size:0.6875rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);">
            <th style="text-align:left;padding:8px 6px;">Subject / Código</th>
            <th style="text-align:center;padding:8px 6px;">BU</th>
            <th style="text-align:right;padding:8px 6px;">Envio</th>
            <th style="text-align:right;padding:8px 6px;">Enviados</th>
            <th style="text-align:right;padding:8px 6px;">Abertura</th>
            <th style="text-align:right;padding:8px 6px;">Cliques</th>
            <th style="text-align:right;padding:8px 6px;">Opt-out</th>
            <th style="text-align:center;padding:8px 6px;">Ações</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="8" style="padding:24px;text-align:center;color:var(--text-muted);">Nenhum disparo encontrado para este recorte.</td></tr>'}</tbody>
      </table>
    </div>`;

  const m = modal.open({
    title: `🔍 Disparos · ${entityLabel}: ${name}`,
    size: 'xl',
    content,
    dedupeKey: `nlc-drill-${entity}-${name}`,
    footer: [
      { label: 'Fechar', class: 'btn-secondary', closeOnClick: true },
    ],
  });

  // Wire ✎ buttons no modal
  setTimeout(() => {
    const root = m?.getElement?.() || document;
    root.querySelectorAll('.nlc-drill-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        openExtractedEditor(btn.dataset.docId);
      });
    });
  }, 50);
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
/* ═══════════════════════════════════════════════════════════════════════════
   MODAL EDITAR — UI com chips/multi-select (sem JSON exposto)
   ═══════════════════════════════════════════════════════════════════════════ */

// Sugestões pré-curadas para auto-complete rápido nos chip-inputs
const SUGGEST = {
  themes: ['luxo','romance','familia','aventura','gastronomia','wellness','cultura','praia','cidade','natureza','mar','slow-travel'],
  targetAudience: ['casais','familias','jovens','grupos','solo-travelers','luxury-seekers','aventureiros','boomers','executivos'],
  activities: ['safari','trekking','spa','gastronomia','vinho','golf','mergulho','yoga','passeios-culturais','city-tour','cruise','observacao-fauna'],
  brands: ['Aman','Belmond','Faena','Six Senses','Bvlgari','Cheval Blanc','Four Seasons','Ritz-Carlton','EDITION','Lotte','OIÁ','Carmel','Emiliano','Inkaterra','Anantara','Mandarin Oriental','One&Only','Rosewood','Park Hyatt','St. Regis'],
  countries: ['Brasil','Argentina','Chile','Peru','Uruguai','Estados Unidos','México','Itália','França','Espanha','Portugal','Grécia','Egito','Marrocos','África do Sul','Quênia','Tanzânia','Japão','Tailândia','Indonésia','Maldivas','Vietnã','Camboja','Índia','Austrália','Nova Zelândia','Polinésia Francesa','Antártida','Emirados Árabes Unidos','Turquia','Inglaterra','Escócia','Irlanda','Suíça','Áustria','Alemanha','Croácia','Islândia'],
  cities: ['Atenas','Mykonos','Santorini','Roma','Florença','Veneza','Toscana','Cinque Terre','Paris','Nice','Provence','Barcelona','Madri','Lisboa','Algarve','Porto','Buenos Aires','Mendoza','Patagônia','Bariloche','Cusco','Machu Picchu','Mekong','Bangkok','Phuket','Bali','Marrakech','Cairo','Petra','Cidade do Cabo','Maui','Maldivas','Bora Bora','Fernando de Noronha','Lençóis Maranhenses','Cumbuco','Trancoso','Jericoacoara'],
  hotelCategories: ['ultra-luxo','luxo','premium','boutique'],
  cruiseCategories: ['ultra-luxo','luxo','expedicao','river-cruise'],
  pricePoints: ['ultra-luxo','luxo','premium'],
  confidences: [
    { v:'high', l:'Alta — IA + manual confirmado' },
    { v:'medium', l:'Média — IA com confiança razoável' },
    { v:'low', l:'Baixa — IA incerta, requer revisão' },
  ],
  newsletterTypes: [
    { v:'promocao', l:'🏷 Promoção' },
    { v:'aereo', l:'✈ Aéreo' },
    { v:'roteiro', l:'📍 Roteiro' },
    { v:'hotelaria', l:'🏨 Hotelaria' },
    { v:'cruzeiro', l:'🚢 Cruzeiro' },
    { v:'csat', l:'📋 CSAT (pesquisa)' },
    { v:'inspiracional', l:'🌟 Inspiracional' },
    { v:'institucional', l:'🏢 Institucional' },
    { v:'show/evento', l:'🎤 Show/Evento' },
    { v:'retreat/wellness', l:'🧘 Retreat/Wellness' },
  ],
};

/** Cria um campo de chips com input livre + sugestões via datalist. */
function createChipInput(initial = [], { placeholder = 'Digite e pressione Enter…', suggestions = [], dataListId = '' } = {}) {
  const items = [...(initial || [])];
  const wrap = document.createElement('div');
  wrap.style.cssText = 'min-height:38px;padding:6px;border:1px solid var(--border-subtle);border-radius:6px;background:var(--bg-elevated);display:flex;flex-wrap:wrap;gap:4px;align-items:center;';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.style.cssText = 'flex:1;min-width:120px;border:none;background:transparent;outline:none;padding:4px 6px;font-size:0.8125rem;color:var(--text-primary);';
  if (dataListId) input.setAttribute('list', dataListId);

  const renderChips = () => {
    wrap.innerHTML = '';
    items.forEach((it, i) => {
      const chip = document.createElement('span');
      chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:var(--brand-gold);color:#000;border-radius:12px;font-size:0.75rem;font-weight:500;';
      chip.innerHTML = `${esc(it)} <button type="button" style="background:none;border:none;color:#000;cursor:pointer;font-size:0.875rem;line-height:1;padding:0 0 0 2px;" data-idx="${i}">×</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        items.splice(i, 1); renderChips();
      });
      wrap.appendChild(chip);
    });
    wrap.appendChild(input);
    input.focus();
  };

  const addItem = (val) => {
    const v = (val || '').trim();
    if (!v) return;
    if (items.includes(v)) return;
    items.push(v);
    renderChips();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addItem(input.value);
      input.value = '';
    } else if (e.key === 'Backspace' && !input.value && items.length) {
      items.pop(); renderChips();
    }
  });
  input.addEventListener('blur', () => {
    if (input.value.trim()) { addItem(input.value); input.value = ''; }
  });

  renderChips();
  return { wrap, getItems: () => [...items], setItems: (arr) => { items.length = 0; items.push(...(arr||[])); renderChips(); } };
}

/** Lista de objetos {name, brand, category} editáveis (hotels/cruises) — 3 inputs + add + remove */
function createObjectListEditor(initial = [], categories = [], { nameLabel = 'Nome', brandLabel = 'Marca' } = {}) {
  const items = (initial || []).map(o => ({
    name: o?.name || '',
    brand: o?.brand || '',
    category: o?.category || '',
  }));

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

  const renderRows = () => {
    wrap.innerHTML = '';
    items.forEach((o, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:1.2fr 1fr 0.9fr auto;gap:6px;align-items:center;';
      row.innerHTML = `
        <input type="text" value="${esc(o.name)}" placeholder="${esc(nameLabel)}" class="form-input" style="font-size:0.8125rem;">
        <input type="text" value="${esc(o.brand)}" placeholder="${esc(brandLabel)} (opcional)" class="form-input" style="font-size:0.8125rem;">
        <select class="form-input" style="font-size:0.8125rem;">
          <option value="">— categoria —</option>
          ${categories.map(c => `<option value="${esc(c)}" ${c === o.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
        <button type="button" class="btn btn-ghost btn-sm" title="Remover" style="padding:4px 8px;color:var(--color-danger);">✕</button>
      `;
      const [nameI, brandI, catS, delB] = row.children;
      nameI.addEventListener('input', e => o.name = e.target.value);
      brandI.addEventListener('input', e => o.brand = e.target.value);
      catS.addEventListener('change', e => o.category = e.target.value);
      delB.addEventListener('click', () => { items.splice(i, 1); renderRows(); });
      wrap.appendChild(row);
    });
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-ghost btn-sm';
    addBtn.style.cssText = 'align-self:flex-start;font-size:0.75rem;color:var(--brand-gold);';
    addBtn.textContent = '+ Adicionar';
    addBtn.addEventListener('click', () => { items.push({ name:'', brand:'', category:'' }); renderRows(); });
    wrap.appendChild(addBtn);
  };

  renderRows();
  return {
    wrap,
    getItems: () => items.filter(o => o.name && o.name.trim()).map(o => ({
      name: o.name.trim(),
      ...(o.brand?.trim() ? { brand: o.brand.trim() } : {}),
      ...(o.category ? { category: o.category } : {}),
    })),
  };
}

async function openExtractedEditor(docId) {
  const { doc, getDoc, updateDoc, serverTimestamp } = await import(
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
  );
  const { db } = await import('../firebase.js');

  const ref = doc(db, 'mc_performance', docId);
  const snap = await getDoc(ref);
  if (!snap.exists()) { alert('Documento não encontrado.'); return; }
  const data = snap.data();
  const ex = data.extracted || {};

  // Normaliza arrays heterogêneos (string/objeto) pra forma simples (string)
  const arrToStrings = (arr) => (arr || []).map(v => typeof v === 'string' ? v : (v?.name || ''))
    .filter(Boolean);

  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.55);
    z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;`;

  const sectionLabel = (text, hint) => `
    <div style="font-size:0.75rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;
      letter-spacing:0.05em;margin:0 0 6px 0;display:flex;align-items:center;gap:6px;">
      ${esc(text)}
      ${hint ? `<span title="${esc(hint)}" style="cursor:help;display:inline-flex;align-items:center;
        justify-content:center;width:14px;height:14px;border-radius:50%;background:var(--bg-secondary);
        font-size:0.5625rem;font-weight:600;font-style:italic;font-family:Georgia,serif;
        border:1px solid var(--border-subtle);">i</span>` : ''}
    </div>`;

  overlay.innerHTML = `
    <div class="card" style="max-width:780px;width:100%;max-height:90vh;overflow:auto;padding:22px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;gap:12px;">
        <div style="flex:1;">
          <h3 style="margin:0 0 4px 0;font-size:1rem;">✎ Editar análise</h3>
          <div style="font-size:0.8125rem;color:var(--text-secondary);font-weight:500;">${esc(data.name || docId)}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">Subject: ${esc(data.subject || '—')}</div>
        </div>
        <button class="btn btn-ghost btn-sm" id="ed-close" style="font-size:1rem;">✕</button>
      </div>

      <!-- Linha 1: tipo + confiança + price point -->
      <div style="display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:12px;margin-bottom:16px;">
        <div>
          ${sectionLabel('Tipo de newsletter', 'Categorização principal — usada nos filtros e bloco "Tipo".')}
          <select id="ed-newsletterType" class="form-input" style="width:100%;">
            <option value="">— escolher —</option>
            ${SUGGEST.newsletterTypes.map(t => `<option value="${esc(t.v)}">${esc(t.l)}</option>`).join('')}
          </select>
        </div>
        <div>
          ${sectionLabel('Confiança', 'Quanto a IA confia na extração. Se você editou manualmente, suba para "Alta".')}
          <select id="ed-confidence" class="form-input" style="width:100%;">
            ${SUGGEST.confidences.map(c => `<option value="${esc(c.v)}">${esc(c.l)}</option>`).join('')}
          </select>
        </div>
        <div>
          ${sectionLabel('Posicionamento', 'Faixa de preço/posicionamento da campanha.')}
          <select id="ed-pricePoint" class="form-input" style="width:100%;">
            <option value="">— não aplicável —</option>
            ${SUGGEST.pricePoints.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- Hotéis -->
      <div style="margin-bottom:16px;">
        ${sectionLabel('🏨 Hotéis citados', 'Hotéis mencionados na newsletter. Marca e categoria são opcionais.')}
        <div id="ed-hotels-host"></div>
      </div>

      <!-- Cruzeiros -->
      <div style="margin-bottom:16px;">
        ${sectionLabel('🚢 Cruzeiros / operadoras marítimas', 'Operadoras de cruzeiro (Aqua Expeditions, Silversea, etc.). SEPARADOS de hotéis.')}
        <div id="ed-cruises-host"></div>
      </div>

      <!-- Linha 2 colunas: países + cidades -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div>
          ${sectionLabel('🌍 Países', 'Países mencionados. Tecle Enter ou vírgula para adicionar.')}
          <div id="ed-countries-host"></div>
        </div>
        <div>
          ${sectionLabel('🏙 Cidades / Regiões', 'Cidades ou regiões específicas (Atenas, Toscana, Mekong…).')}
          <div id="ed-cities-host"></div>
        </div>
      </div>

      <!-- Linha 2 colunas: marcas + temas -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div>
          ${sectionLabel('🏷 Marcas hoteleiras', 'Marcas citadas (auto-deduplicadas).')}
          <div id="ed-brands-host"></div>
        </div>
        <div>
          ${sectionLabel('🎯 Temas / posicionamento', 'Tags livres — clique nas sugestões ou digite.')}
          <div id="ed-themes-host"></div>
        </div>
      </div>

      <!-- Linha 2 colunas: audiência + atividades -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div>
          ${sectionLabel('👥 Público-alvo', 'Para quem a newsletter está direcionada.')}
          <div id="ed-targetAudience-host"></div>
        </div>
        <div>
          ${sectionLabel('🎒 Atividades', 'Ações/experiências (safari, trekking, spa…).')}
          <div id="ed-activities-host"></div>
        </div>
      </div>

      <!-- Sales points -->
      <div style="margin-bottom:18px;">
        ${sectionLabel('✨ Argumentos de venda', 'Frases curtas usadas como gancho na peça.')}
        <div id="ed-sellingPoints-host"></div>
      </div>

      <!-- datalists para auto-complete -->
      <datalist id="ed-dl-countries">${SUGGEST.countries.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
      <datalist id="ed-dl-cities">${SUGGEST.cities.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
      <datalist id="ed-dl-themes">${SUGGEST.themes.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
      <datalist id="ed-dl-targetAudience">${SUGGEST.targetAudience.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
      <datalist id="ed-dl-activities">${SUGGEST.activities.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
      <datalist id="ed-dl-brands">${SUGGEST.brands.map(s => `<option value="${esc(s)}">`).join('')}</datalist>

      <div style="display:flex;gap:8px;justify-content:space-between;align-items:center;
        margin-top:18px;padding-top:14px;border-top:1px solid var(--border-subtle);">
        <span style="font-size:0.6875rem;color:var(--text-muted);">
          ${ex.extractedBy ? `Última análise: <strong>${esc(ex.extractedBy)}</strong>` : ''}
        </span>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" id="ed-cancel">Cancelar</button>
          <button class="btn btn-primary" id="ed-save">💾 Salvar</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Pré-popula selects
  if (ex.newsletterType) document.getElementById('ed-newsletterType').value = ex.newsletterType;
  if (ex.confidence)     document.getElementById('ed-confidence').value     = ex.confidence;
  else                   document.getElementById('ed-confidence').value     = 'medium';
  if (ex.pricePoint)     document.getElementById('ed-pricePoint').value     = ex.pricePoint;

  // Monta chip-inputs
  const cCountries = createChipInput(arrToStrings(ex.countries),
    { placeholder: 'Ex: Brasil, Itália…', dataListId: 'ed-dl-countries' });
  const cCities = createChipInput(arrToStrings(ex.cities),
    { placeholder: 'Ex: Atenas, Toscana…', dataListId: 'ed-dl-cities' });
  const cBrands = createChipInput(arrToStrings(ex.brands),
    { placeholder: 'Ex: Aman, Faena…', dataListId: 'ed-dl-brands' });
  const cThemes = createChipInput(arrToStrings(ex.themes),
    { placeholder: 'Ex: luxo, romance…', dataListId: 'ed-dl-themes' });
  const cTarget = createChipInput(arrToStrings(ex.targetAudience),
    { placeholder: 'Ex: casais, famílias…', dataListId: 'ed-dl-targetAudience' });
  const cActivities = createChipInput(arrToStrings(ex.activities),
    { placeholder: 'Ex: safari, spa…', dataListId: 'ed-dl-activities' });
  const cSellingPoints = createChipInput(arrToStrings(ex.sellingPoints),
    { placeholder: 'Frases curtas (ex: 30% OFF, voos diretos)…' });

  document.getElementById('ed-countries-host').appendChild(cCountries.wrap);
  document.getElementById('ed-cities-host').appendChild(cCities.wrap);
  document.getElementById('ed-brands-host').appendChild(cBrands.wrap);
  document.getElementById('ed-themes-host').appendChild(cThemes.wrap);
  document.getElementById('ed-targetAudience-host').appendChild(cTarget.wrap);
  document.getElementById('ed-activities-host').appendChild(cActivities.wrap);
  document.getElementById('ed-sellingPoints-host').appendChild(cSellingPoints.wrap);

  // Object lists (hotels / cruises)
  const oHotels = createObjectListEditor(ex.hotels, SUGGEST.hotelCategories,
    { nameLabel: 'Nome do hotel', brandLabel: 'Marca' });
  const oCruises = createObjectListEditor(ex.cruises, SUGGEST.cruiseCategories,
    { nameLabel: 'Operadora / navio', brandLabel: 'Marca' });
  document.getElementById('ed-hotels-host').appendChild(oHotels.wrap);
  document.getElementById('ed-cruises-host').appendChild(oCruises.wrap);

  const close = () => overlay.remove();
  document.getElementById('ed-close').addEventListener('click', close);
  document.getElementById('ed-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  document.getElementById('ed-save').addEventListener('click', async () => {
    const saveBtn = document.getElementById('ed-save');
    saveBtn.disabled = true; saveBtn.textContent = 'Salvando…';
    const newExtracted = {
      ...ex,
      newsletterType: document.getElementById('ed-newsletterType').value || null,
      confidence:     document.getElementById('ed-confidence').value || 'medium',
      pricePoint:     document.getElementById('ed-pricePoint').value || null,
      countries:      cCountries.getItems(),
      cities:         cCities.getItems(),
      hotels:         oHotels.getItems(),
      cruises:        oCruises.getItems(),
      brands:         cBrands.getItems(),
      themes:         cThemes.getItems(),
      targetAudience: cTarget.getItems(),
      activities:     cActivities.getItems(),
      sellingPoints:  cSellingPoints.getItems(),
      extractedBy:    'manual-edit',
      editedAt:       serverTimestamp(),
    };
    try {
      await updateDoc(ref, { extracted: newExtracted });
      _contentDataCache = null; // força refetch
      close();
      await loadContentTab();
    } catch (e) {
      saveBtn.disabled = false; saveBtn.textContent = '💾 Salvar';
      alert('Falha ao salvar: ' + e.message);
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   INSIGHTS & OBSERVAÇÕES — Aba "Conteúdo & Temas"
   ═══════════════════════════════════════════════════════════════════════════ */

function _topEntries(map, n = 8) {
  if (!map || typeof map.entries !== 'function') return [];
  return [...map.entries()]
    .sort((a, b) => {
      const ca = typeof a[1] === 'object' ? (a[1].count || 0) : a[1];
      const cb = typeof b[1] === 'object' ? (b[1].count || 0) : b[1];
      return cb - ca;
    })
    .slice(0, n)
    .map(([k, v]) => ({ label: k, count: typeof v === 'object' ? (v.count || 0) : v }));
}

function buildNlContentKpisSnapshot(agg) {
  if (!agg) return { kpis: 'sem dados — aba Conteúdo não renderizada' };
  return {
    countries: agg.countries?.size || 0,
    cities: agg.cities?.size || 0,
    hotels: agg.hotels?.size || 0,
    cruises: agg.cruises?.size || 0,
    brands: agg.brands?.size || 0,
    avgOpenRate: agg.avgOpenRate || 0,
  };
}

function buildNlContentTypesSnapshot(agg) {
  if (!agg?.newsletterTypes) return {};
  return { newsletterTypes: _topEntries(agg.newsletterTypes, 12) };
}

function buildNlContentCountriesSnapshot(agg) {
  if (!agg?.byCountry) return {};
  return { topCountries: _topEntries(agg.byCountry, 12) };
}

function buildNlContentCitiesSnapshot(agg) {
  if (!agg?.cities) return {};
  return { topCities: _topEntries(agg.cities, 12) };
}

function buildNlContentHotelsSnapshot(agg) {
  if (!agg?.hotels) return {};
  return { topHotels: _topEntries(agg.hotels, 12) };
}

function buildNlContentCruisesSnapshot(agg) {
  if (!agg?.cruises) return {};
  return { topCruises: _topEntries(agg.cruises, 12) };
}

function buildNlContentThemesSnapshot(agg) {
  if (!agg?.themes) return {};
  return { themes: _topEntries(agg.themes, 12) };
}

function buildNlContentBrandsSnapshot(agg) {
  if (!agg?.brands) return {};
  return { brands: _topEntries(agg.brands, 12) };
}

function buildNlContentByBuSnapshot(enrichedDocs) {
  if (!enrichedDocs?.length) return {};
  const byBu = new Map();
  enrichedDocs.forEach(d => {
    const bu = d.virtualBuName || getVirtualBuName(d.buId) || '—';
    if (!byBu.has(bu)) byBu.set(bu, { count: 0, openRateSum: 0, openRateN: 0 });
    const e = byBu.get(bu);
    e.count++;
    if (typeof d.openRate === 'number') { e.openRateSum += d.openRate; e.openRateN++; }
  });
  return {
    byBu: [...byBu.entries()].map(([bu, e]) => ({
      bu, campaigns: e.count,
      avgOpenRate: e.openRateN ? +(e.openRateSum / e.openRateN).toFixed(1) : 0,
    })),
  };
}

function buildNlContentSendsSnapshot(enrichedDocs) {
  if (!enrichedDocs?.length) return {};
  return {
    totalSends: enrichedDocs.length,
    enrichedBy: enrichedDocs.reduce((acc, d) => {
      const k = d.extracted?.extractedBy || 'unknown';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
  };
}

function buildNlContentGeneralSnapshot(enrichedDocs, agg) {
  if (!enrichedDocs?.length || !agg) return {};
  return {
    totalCampaigns: enrichedDocs.length,
    avgOpenRate: agg.avgOpenRate || 0,
    countries: agg.countries?.size || 0,
    cities: agg.cities?.size || 0,
    hotels: agg.hotels?.size || 0,
    cruises: agg.cruises?.size || 0,
    brands: agg.brands?.size || 0,
    topCountries: _topEntries(agg.byCountry, 5),
    topCities: _topEntries(agg.cities, 5),
    topHotels: _topEntries(agg.hotels, 5),
    topThemes: _topEntries(agg.themes, 5),
    typesDistribution: _topEntries(agg.newsletterTypes, 12),
    byBu: buildNlContentByBuSnapshot(enrichedDocs).byBu,
  };
}

/** Setup dos insights na aba Conteúdo (idempotente, chamado após renderContentTab). */
async function setupNlContentInsights(enrichedDocs, agg) {
  // Idempotente: se os botões já estão montados, não remonta.
  if (document.querySelector('#nl-content-kpis-block .ip-widget-btn')) return;
  try {
    const { setupDashboardInsights } = await import('../services/insightWidgets.js?v=20260508r1');

    // Período: usa o filtro selecionado na aba Conteúdo (ou últimos 180 dias por default).
    const days = parseInt(_contentFiltersState.period, 10) || 180;
    const end = new Date();
    const start = new Date(); start.setDate(start.getDate() - days);
    const periodLabel = days >= 365 ? `Últimos ${Math.round(days/365)} ano(s)` : `Últimos ${days} dias`;
    const filters = {
      bu: _contentFiltersState.bu || 'all',
      country: _contentFiltersState.country || '',
      city: _contentFiltersState.city || '',
      theme: _contentFiltersState.theme || '',
      newsletterType: _contentFiltersState.newsletterType || '',
      search: _contentFiltersState.search || '',
      periodLabel,
    };

    await setupDashboardInsights({
      dashboard: 'nl',
      widgets: [
        { widgetId: 'nl-content-kpis-block',     indexKey: 'contentKpis',      label: '📊 Indicadores de conteúdo',
          snapshot: () => buildNlContentKpisSnapshot(agg) },
        { widgetId: 'nl-content-types-block',    indexKey: 'newsletterTypes',  label: '📂 Tipo de newsletter',
          snapshot: () => buildNlContentTypesSnapshot(agg) },
        { widgetId: 'nl-content-countries-block', indexKey: 'topCountries',    label: '🌍 Top países',
          snapshot: () => buildNlContentCountriesSnapshot(agg) },
        { widgetId: 'nl-content-cities-block',   indexKey: 'topCities',        label: '🏙 Top cidades',
          snapshot: () => buildNlContentCitiesSnapshot(agg) },
        { widgetId: 'nl-content-hotels-block',   indexKey: 'topHotels',        label: '🏨 Hotéis',
          snapshot: () => buildNlContentHotelsSnapshot(agg) },
        { widgetId: 'nl-content-cruises-block',  indexKey: 'topCruises',       label: '🚢 Cruzeiros',
          snapshot: () => buildNlContentCruisesSnapshot(agg) },
        { widgetId: 'nl-content-themes-block',   indexKey: 'themes',           label: '🎯 Temas / posicionamento',
          snapshot: () => buildNlContentThemesSnapshot(agg) },
        { widgetId: 'nl-content-brands-block',   indexKey: 'brands',           label: '🏷 Marcas',
          snapshot: () => buildNlContentBrandsSnapshot(agg) },
        { widgetId: 'nl-content-bybu-block',     indexKey: 'contentByBu',      label: '🏢 Conteúdo por unidade',
          snapshot: () => buildNlContentByBuSnapshot(enrichedDocs) },
        { widgetId: 'nl-content-sends-block',    indexKey: 'enrichedSends',    label: '📧 Envios enriquecidos',
          snapshot: () => buildNlContentSendsSnapshot(enrichedDocs) },
      ],
      metrics: null,
      periodFrom: start, periodTo: end,
      periodLabel,
      filters,
      generalPanelContainerId: 'nl-content-insights-section',
      buildGeneralSnapshot: () => buildNlContentGeneralSnapshot(enrichedDocs, agg),
      enableAi: true,
    });
  } catch (e) { console.warn('[nl] content insights setup:', e); }
}
