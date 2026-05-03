/**
 * PRIMETOUR — Insights Panel Component
 *
 * Reutilizável em qualquer dashboard, em 2 modos:
 *
 * 1) PANEL (default): card grande com header + lista + botões.
 *    Usado pra "Análise Geral" no fim do dashboard.
 *
 * 2) WIDGET: botão compacto com badge contador (ex: "💬 3 🤖").
 *    Usado em cada gráfico/KPI individual. Abre popover ao clicar.
 *
 * Ambos compartilham o mesmo form de criar/editar e o mesmo preview de IA.
 *
 * Uso panel:
 *   mountInsightsPanel({
 *     container,
 *     dashboard: 'produtividade',
 *     mode: 'panel',                  // ou omitido (default)
 *     indexKey: 'general',            // só insights gerais (não ancorados)
 *     periodFrom, periodTo, filters,
 *     enableAi: true,
 *     getSnapshot: () => ({...}),     // função que devolve dados pro IA
 *   });
 *
 * Uso widget:
 *   mountInsightsPanel({
 *     container,                       // ideal: header do widget
 *     dashboard: 'produtividade',
 *     mode: 'widget',
 *     indexKey: 'sla90',
 *     indexLabel: 'SLA 90%',
 *     periodFrom, periodTo, filters,
 *     enableAi: true,
 *     getSnapshot: () => ({ value: 87, prev: 95, breakdown: {...} }),
 *   });
 *
 * Dispara evento custom 'insights:changed' no container quando muda.
 *
 * API retornada: { refresh(), open() }
 */

import { toast } from './toast.js';
import {
  fetchInsights, createInsight, updateInsight, deleteInsight,
  suggestInsightsViaAi,
  insightCoversPeriod, formatInsightPeriod, formatDataSnapshot,
  INSIGHT_TYPES, IMPACT_LEVELS, DASHBOARDS,
} from '../services/insights.js?v=20260503tt1';
import { exportInsightToPdf, exportInsightToXlsx } from '../services/insightExport.js?v=20260503tt1';

/** Mapa global de widgetLabels passado pelo dashboards.js — usado no export PDF/XLSX
 * pra mostrar nome legível do widget. Set/get via janela compartilhada. */
function getWidgetLabels(dashboard) {
  return window.__INSIGHT_WIDGET_LABELS?.[dashboard] || {};
}

/** Abre um insight em PDF ou XLSX (chamado pelos botões 📤). */
async function exportSingleInsight(insight, format, dashboard) {
  const widgetLabels = getWidgetLabels(dashboard);
  try {
    if (format === 'pdf') {
      await exportInsightToPdf(insight, { widgetLabels });
      toast.success('PDF exportado.');
    } else if (format === 'xlsx') {
      await exportInsightToXlsx(insight, { widgetLabels });
      toast.success('XLSX exportado.');
    }
  } catch (e) {
    console.error('[insightExport]', e);
    toast.error('Erro ao exportar: ' + (e.message || ''));
  }
}

/** Abre mini-menu pop-up perto do botão pra escolher PDF/XLSX. */
function openExportMenu(anchorBtn, insight, dashboard) {
  // Remove menu anterior se existir
  document.querySelectorAll('.ip-export-menu').forEach(el => el.remove());

  const menu = document.createElement('div');
  menu.className = 'ip-export-menu';
  menu.style.cssText = `
    position:fixed;z-index:2500;background:var(--bg-card);
    border:1px solid var(--border-subtle);border-radius:var(--radius-md);
    box-shadow:0 8px 24px rgba(0,0,0,.4);padding:4px;min-width:160px;
    display:flex;flex-direction:column;
  `;
  menu.innerHTML = `
    <button class="ip-export-opt" data-fmt="pdf"
      style="border:none;background:none;cursor:pointer;padding:8px 12px;
      text-align:left;font-size:0.8125rem;color:var(--text-primary);
      display:flex;align-items:center;gap:8px;border-radius:4px;">
      📄 Exportar como PDF
    </button>
    <button class="ip-export-opt" data-fmt="xlsx"
      style="border:none;background:none;cursor:pointer;padding:8px 12px;
      text-align:left;font-size:0.8125rem;color:var(--text-primary);
      display:flex;align-items:center;gap:8px;border-radius:4px;">
      📊 Exportar como XLSX
    </button>
  `;

  // Posiciona próximo ao botão
  const r = anchorBtn.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(window.innerWidth - 168, r.left)) + 'px';
  menu.style.top  = Math.min(window.innerHeight - 100, r.bottom + 4) + 'px';

  document.body.appendChild(menu);

  // Hover effect
  menu.querySelectorAll('.ip-export-opt').forEach(b => {
    b.addEventListener('mouseenter', () => b.style.background = 'var(--bg-elevated)');
    b.addEventListener('mouseleave', () => b.style.background = 'none');
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const fmt = b.dataset.fmt;
      menu.remove();
      await exportSingleInsight(insight, fmt, dashboard);
    });
  });

  // Fecha ao clicar fora
  const onOutside = (e) => {
    if (!menu.contains(e.target) && e.target !== anchorBtn) {
      menu.remove();
      document.removeEventListener('click', onOutside);
    }
  };
  setTimeout(() => document.addEventListener('click', onOutside), 50);
}

const esc = s => String(s||'').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** Redimensiona canvas pra largura máxima e devolve dataURL JPEG (mais compacto que PNG).
 * JPEG quality 0.85 + max 800px → ~50-150KB.
 * jsPDF embed JPEG mantém compressão original (não vira raw RGB como PNG).
 */
function downsizeCanvas(srcCanvas, maxWidth = 800) {
  const ratio = srcCanvas.width / srcCanvas.height;
  const w = Math.min(srcCanvas.width, maxWidth);
  const h = Math.round(w / ratio);
  if (w === srcCanvas.width && h === srcCanvas.height) {
    // Mesmo tamanho — tenta toDataURL JPEG direto
    try { return srcCanvas.toDataURL('image/jpeg', 0.85); }
    catch { return srcCanvas.toDataURL('image/png'); }
  }
  // Fundo branco (Chart.js usa transparência, JPEG não suporta)
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(srcCanvas, 0, 0, w, h);
  try { return c.toDataURL('image/jpeg', 0.85); }
  catch { return c.toDataURL('image/png'); }
}

const fmtDate = ts => {
  if (!ts) return '—';
  const d = ts?.toDate?.() || new Date(ts);
  return d.toLocaleDateString('pt-BR');
};

export async function mountInsightsPanel(opts) {
  const {
    container,
    dashboard,
    mode = 'panel',                  // 'panel' | 'widget'
    indexKey = null,                 // null = todos; 'general' = só gerais; string = só desse índice
    indexLabel = '',                 // label do widget (mostrado no form)
    periodFrom, periodTo, filters,
    periodLabel = '',
    enableAi = true,
    getSnapshot = null,              // function que retorna snapshot pra IA
  } = opts;

  if (!container || !dashboard) {
    console.warn('[insightsPanel] container e dashboard obrigatórios');
    return null;
  }

  const dashInfo = DASHBOARDS[dashboard] || { label: dashboard, icon: '📊' };
  let insights = [];
  let popoverOpen = false;
  let onlyCurrentPeriod = false; // toggle do filtro "só período atual"

  // Filtro de fetch: widget mode pega só o indexKey específico,
  // panel mode com indexKey='general' pega só os gerais,
  // panel mode sem indexKey (null) pega TODOS.
  const fetchIndexKey = mode === 'widget' ? indexKey : indexKey;

  async function refresh() {
    try {
      // Traz histórico completo (sem filtro de período). UI faz o filtro
      // de "atual vs histórico" client-side baseado em periodOverlap.
      insights = await fetchInsights({
        dashboard,
        indexKey: fetchIndexKey || undefined,
        max: 100,
      });
    } catch (e) {
      console.error('[insightsPanel] fetch failed:', e);
      insights = [];
    }
    render();
  }

  /** Lista efetivamente exibida (aplicando toggle "só período atual" se ativo). */
  function visibleInsights() {
    if (!onlyCurrentPeriod) return insights;
    return insights.filter(i => insightCoversPeriod(i, periodFrom, periodTo));
  }

  /** Conta quantos insights cobrem o período atual. */
  function countCurrent() {
    if (!periodFrom && !periodTo) return insights.length;
    return insights.filter(i => insightCoversPeriod(i, periodFrom, periodTo)).length;
  }

  function render() {
    if (mode === 'widget') renderWidget();
    else renderPanel();
  }

  /* ════════════════════════════════════════════════
     WIDGET MODE — botão compacto com contador
     Label didático: "+ insights" (vazio) / "N insights" (com contagem)
     ════════════════════════════════════════════════ */
  function renderWidget() {
    const total   = insights.length;
    const current = countCurrent();
    const hasCurrent = current > 0;
    const label = total === 0
      ? '+ insights'
      : `${total} insight${total !== 1 ? 's' : ''}`;
    const tooltipParts = [`Insights${indexLabel ? ' · ' + indexLabel : ''}`];
    if (total > 0) tooltipParts.push(`${total} no histórico`);
    if (hasCurrent && (periodFrom || periodTo)) tooltipParts.push(`${current} cobre(m) período atual`);

    container.innerHTML = `
      <button class="ip-widget-btn" id="ip-widget-trigger"
        title="${esc(tooltipParts.join(' · '))}"
        style="display:inline-flex;align-items:center;gap:5px;
        padding:3px 10px;border-radius:var(--radius-full);
        background:${total ? 'rgba(59,130,246,.12)' : 'var(--bg-elevated)'};
        border:1px solid ${total ? 'rgba(59,130,246,.3)' : 'var(--border-subtle)'};
        color:${total ? '#3B82F6' : 'var(--text-muted)'};
        font-size:0.7rem;font-weight:600;cursor:pointer;
        transition:all .15s;white-space:nowrap;">
        💡 ${esc(label)}
      </button>
    `;
    container.querySelector('#ip-widget-trigger')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openPopover(e.currentTarget);
    });
  }

  function openPopover(anchor) {
    if (popoverOpen) return;
    popoverOpen = true;

    const pop = document.createElement('div');
    pop.className = 'ip-popover';
    pop.style.cssText = `
      position:fixed;z-index:1500;width:380px;max-width:92vw;max-height:520px;
      background:var(--bg-card);border:1px solid var(--border-subtle);
      border-radius:var(--radius-lg);box-shadow:0 16px 48px rgba(0,0,0,.4);
      display:flex;flex-direction:column;overflow:hidden;
    `;
    // Posição: abaixo do anchor, alinhado à direita
    const r = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - 388, r.right - 380));
    const top  = Math.min(window.innerHeight - 540, r.bottom + 6);
    pop.style.left = left + 'px';
    pop.style.top  = top  + 'px';

    const total = insights.length;
    const current = countCurrent();
    const showFilter = (periodFrom || periodTo) && total > 0;

    pop.innerHTML = `
      <div style="padding:12px 16px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);
        display:flex;flex-direction:column;gap:6px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="font-weight:600;font-size:0.875rem;color:var(--text-primary);">
            💡 Insights ${indexLabel ? '· ' + esc(indexLabel) : ''}
          </div>
          <button id="ip-pop-close" style="border:none;background:none;cursor:pointer;
            font-size:1rem;color:var(--text-muted);padding:4px 8px;">✕</button>
        </div>
        <div style="font-size:0.7rem;color:var(--text-muted);display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span>${total} no histórico${current !== total && (periodFrom || periodTo) ? ` · ${current} cobre(m) período atual` : ''}</span>
          ${showFilter ? `
            <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:0.7rem;">
              <input type="checkbox" id="ip-pop-only-current" ${onlyCurrentPeriod ? 'checked' : ''} style="width:13px;height:13px;cursor:pointer;">
              Só período atual
            </label>
          ` : ''}
        </div>
      </div>
      <div id="ip-pop-list" style="flex:1;overflow-y:auto;padding:10px;">
        ${renderListCompact()}
      </div>
      <div style="padding:10px;border-top:1px solid var(--border-subtle);
        background:var(--bg-surface);display:flex;gap:6px;">
        ${enableAi ? `
          <button class="btn btn-secondary btn-sm" id="ip-pop-ai" style="flex:1;font-size:0.75rem;">
            🤖 Sugerir via IA
          </button>
        ` : ''}
        <button class="btn btn-primary btn-sm" id="ip-pop-add" style="flex:1;font-size:0.75rem;">
          + Adicionar
        </button>
      </div>
    `;
    document.body.appendChild(pop);

    // Toggle filtro "só período atual"
    pop.querySelector('#ip-pop-only-current')?.addEventListener('change', (e) => {
      onlyCurrentPeriod = e.target.checked;
      pop.querySelector('#ip-pop-list').innerHTML = renderListCompact();
      rebindPopoverList(pop, closePopover);
    });

    // Fecha ao clicar fora
    const onClickOutside = (e) => {
      if (!pop.contains(e.target) && e.target !== anchor) closePopover();
    };
    setTimeout(() => document.addEventListener('click', onClickOutside), 50);

    function closePopover() {
      pop.remove();
      document.removeEventListener('click', onClickOutside);
      popoverOpen = false;
    }

    pop.querySelector('#ip-pop-close')?.addEventListener('click', closePopover);
    pop.querySelector('#ip-pop-add')?.addEventListener('click', () => {
      closePopover();
      openForm();
    });
    pop.querySelector('#ip-pop-ai')?.addEventListener('click', () => {
      closePopover();
      handleAiSuggest();
    });
    bindPopoverItemActions(pop, closePopover);
  }

  /** Bind dos botões edit/del/export em um popover. Reutilizável após re-render. */
  function bindPopoverItemActions(pop, closePopover) {
    pop.querySelectorAll('[data-act="ip-edit"]').forEach(b => {
      b.addEventListener('click', () => {
        const ins = insights.find(x => x.id === b.dataset.id);
        closePopover();
        if (ins) openForm(ins);
      });
    });
    pop.querySelectorAll('[data-act="ip-del"]').forEach(b => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Remover este insight?')) return;
        try {
          await deleteInsight(b.dataset.id);
          toast.success('Removido.');
          await refresh();
          pop.querySelector('#ip-pop-list').innerHTML = renderListCompact();
          bindPopoverItemActions(pop, closePopover);
          container.dispatchEvent(new CustomEvent('insights:changed'));
        } catch (e) { toast.error('Erro: ' + (e.message || '')); }
      });
    });
    pop.querySelectorAll('[data-act="ip-export"]').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const ins = insights.find(x => x.id === b.dataset.id);
        if (ins) openExportMenu(b, ins, dashboard);
      });
    });
  }

  function rebindPopoverList(pop, closePopover) {
    bindPopoverItemActions(pop, closePopover);
  }

  function renderListCompact() {
    const visible = visibleInsights();
    if (!visible.length) {
      const allEmpty = insights.length === 0;
      return `
        <div style="text-align:center;padding:20px 12px;color:var(--text-muted);">
          <div style="font-size:1.5rem;margin-bottom:6px;opacity:.4;">💡</div>
          <div style="font-size:0.75rem;">${
            allEmpty
              ? 'Nenhum insight ainda.'
              : 'Nenhum insight cobre o período atual. Desmarque o filtro pra ver histórico.'
          }</div>
        </div>
      `;
    }
    return `<div style="display:flex;flex-direction:column;gap:6px;">${visible.map(renderItemCompact).join('')}</div>`;
  }

  function renderItemCompact(ins) {
    const type = INSIGHT_TYPES.find(t => t.key === ins.type) || INSIGHT_TYPES[4];
    const impact = IMPACT_LEVELS.find(x => x.key === ins.impact) || IMPACT_LEVELS[1];
    const isCurrent = (periodFrom || periodTo) ? insightCoversPeriod(ins, periodFrom, periodTo) : true;
    const periodCovered = formatInsightPeriod(ins);
    const snapshotText = formatDataSnapshot(ins.dataSnapshot);
    const opacity = isCurrent ? '1' : '0.7';
    return `
      <div style="background:var(--bg-surface);border-left:3px solid ${type.color};
        padding:8px 10px;border-radius:var(--radius-sm);opacity:${opacity};">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:0.8125rem;color:var(--text-primary);margin-bottom:3px;">
              ${type.icon} ${esc(ins.title)}
              ${ins.source === 'ai-generated' ? '<span style="color:#A78BFA;font-size:0.65rem;" title="Gerado por IA">🤖</span>' : ''}
              ${ins.source === 'ai-edited' ? '<span style="color:#A78BFA;font-size:0.65rem;" title="IA editada por humano">🤖✎</span>' : ''}
              ${isCurrent && (periodFrom || periodTo) ? '<span style="background:rgba(34,197,94,.15);color:#22C55E;font-size:0.6rem;padding:1px 5px;border-radius:8px;font-weight:700;" title="Cobre o período atual">●&nbsp;atual</span>' : ''}
            </div>
            ${ins.observation ? `
              <div style="font-size:0.75rem;color:var(--text-secondary);line-height:1.45;
                white-space:pre-wrap;margin-bottom:3px;">${esc(ins.observation.slice(0, 220))}${ins.observation.length > 220 ? '…' : ''}</div>
            ` : ''}
            ${snapshotText ? `
              <div style="font-size:0.65rem;color:var(--text-muted);background:var(--bg-elevated);
                padding:4px 6px;border-radius:3px;margin-bottom:3px;font-family:monospace;
                line-height:1.4;" title="Foto dos dados que motivaram este insight (imutável)">
                📊 ${esc(snapshotText.slice(0, 180))}${snapshotText.length > 180 ? '…' : ''}
              </div>
            ` : ''}
            <div style="font-size:0.65rem;color:var(--text-muted);line-height:1.5;">
              <span style="color:${impact.color};">●</span> ${esc(impact.label)} ·
              ${periodCovered ? `📅 ${esc(periodCovered)} · ` : ''}
              <em>escrito ${fmtDate(ins.createdAt)} por ${esc(ins.createdBy?.name || '—')}</em>
            </div>
          </div>
          <div style="display:flex;gap:2px;flex-shrink:0;">
            <button data-act="ip-export" data-id="${esc(ins.id)}"
              style="border:none;background:none;cursor:pointer;color:var(--text-muted);padding:3px 5px;font-size:0.75rem;" title="Exportar este insight (PDF ou XLSX)">📤</button>
            <button data-act="ip-edit" data-id="${esc(ins.id)}"
              style="border:none;background:none;cursor:pointer;color:var(--text-muted);padding:3px 5px;font-size:0.75rem;" title="Editar">✎</button>
            <button data-act="ip-del" data-id="${esc(ins.id)}"
              style="border:none;background:none;cursor:pointer;color:var(--color-danger);padding:3px 5px;font-size:0.75rem;" title="Remover">✕</button>
          </div>
        </div>
      </div>
    `;
  }

  /* ════════════════════════════════════════════════
     PANEL MODE — card completo (modo original)
     ════════════════════════════════════════════════ */
  function renderPanel() {
    const isGeneral = indexKey === 'general';
    const headerLabel = isGeneral
      ? 'Análise Geral do Dashboard'
      : (indexKey ? `Insights · ${indexLabel || indexKey}` : 'Insights & Observações');
    const total = insights.length;
    const current = countCurrent();
    const showFilter = (periodFrom || periodTo) && total > 0;

    container.innerHTML = `
      <div class="card" style="padding:18px 20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
          <div style="flex:1;min-width:200px;">
            <h3 style="margin:0;font-size:1rem;font-weight:600;color:var(--text-primary);">
              💡 ${esc(headerLabel)}
            </h3>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <span>${total} ${total === 1 ? 'insight no histórico' : 'insights no histórico'}${showFilter && current !== total ? ` · ${current} cobre(m) período atual` : ''}</span>
              <span>·</span>
              <span>${dashInfo.icon} ${esc(dashInfo.label)}</span>
              ${periodFrom || periodTo ? `<span>·</span><span>${periodFrom ? fmtDate(periodFrom) : ''}${periodTo ? ' → ' + fmtDate(periodTo) : ''}</span>` : ''}
              ${showFilter ? `
                <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:0.7rem;background:var(--bg-elevated);padding:2px 8px;border-radius:var(--radius-full);">
                  <input type="checkbox" id="ip-only-current" ${onlyCurrentPeriod ? 'checked' : ''} style="width:13px;height:13px;cursor:pointer;">
                  Só período atual
                </label>
              ` : ''}
              ${isGeneral ? '<span>·</span><em>análises que cruzam múltiplos índices</em>' : ''}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            ${enableAi ? `
              <button class="btn btn-secondary btn-sm" id="ip-suggest-ai" title="IA analisa o dashboard e sugere insights">
                🤖 Sugerir via IA
              </button>
            ` : ''}
            <button class="btn btn-primary btn-sm" id="ip-add">+ Adicionar insight</button>
          </div>
        </div>

        <div id="ip-list">
          ${renderList()}
        </div>
      </div>
    `;
    bindPanelEvents();
  }

  function renderList() {
    const visible = visibleInsights();
    if (!visible.length) {
      const allEmpty = insights.length === 0;
      return `
        <div style="text-align:center;padding:30px 20px;color:var(--text-muted);
          background:var(--bg-surface);border:1px dashed var(--border-subtle);border-radius:var(--radius-md);">
          <div style="font-size:1.75rem;margin-bottom:8px;opacity:.5;">💡</div>
          <div style="font-size:0.875rem;margin-bottom:4px;">${
            allEmpty
              ? 'Nenhum insight registrado ainda.'
              : 'Nenhum insight cobre o período atual.'
          }</div>
          <div style="font-size:0.75rem;">${
            allEmpty
              ? 'Adicione observações sobre os dados — exportadas em PDF/XLSX junto com as métricas.'
              : 'Desmarque "Só período atual" pra ver os ' + insights.length + ' insights do histórico.'
          }</div>
        </div>
      `;
    }
    return `<div style="display:flex;flex-direction:column;gap:10px;">${visible.map(renderItem).join('')}</div>`;
  }

  function renderItem(ins) {
    const type = INSIGHT_TYPES.find(t => t.key === ins.type) || INSIGHT_TYPES[4];
    const impact = IMPACT_LEVELS.find(x => x.key === ins.impact) || IMPACT_LEVELS[1];
    const isCurrent = (periodFrom || periodTo) ? insightCoversPeriod(ins, periodFrom, periodTo) : true;
    const periodCovered = formatInsightPeriod(ins);
    const opacity = isCurrent ? '1' : '0.7';
    return `
      <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);
        border-left:3px solid ${type.color};border-radius:var(--radius-md);padding:14px 16px;opacity:${opacity};">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
              <span style="font-size:0.6875rem;font-weight:600;padding:2px 8px;border-radius:var(--radius-full);
                background:${type.color}22;color:${type.color};">
                ${type.icon} ${esc(type.label)}
              </span>
              <span style="font-size:0.6875rem;font-weight:600;padding:2px 8px;border-radius:var(--radius-full);
                background:${impact.color}22;color:${impact.color};">
                Impacto ${esc(impact.label)}
              </span>
              ${ins.indexKey ? `
                <span style="font-size:0.6875rem;font-weight:600;padding:2px 8px;border-radius:var(--radius-full);
                  background:rgba(148,163,184,.15);color:var(--text-muted);" title="Ancorado ao widget">
                  📍 ${esc(ins.indexKey)}
                </span>
              ` : ''}
              ${ins.source === 'ai-generated' ? `
                <span style="font-size:0.6875rem;font-weight:600;padding:2px 8px;border-radius:var(--radius-full);
                  background:rgba(167,139,250,.15);color:#A78BFA;">🤖 IA</span>
              ` : ''}
              ${ins.source === 'ai-edited' ? `
                <span style="font-size:0.6875rem;font-weight:600;padding:2px 8px;border-radius:var(--radius-full);
                  background:rgba(167,139,250,.15);color:#A78BFA;">🤖✎ IA editada</span>
              ` : ''}
              ${isCurrent && (periodFrom || periodTo) ? `
                <span style="font-size:0.6875rem;font-weight:700;padding:2px 8px;border-radius:var(--radius-full);
                  background:rgba(34,197,94,.15);color:#22C55E;" title="Cobre o período atual visualizado">
                  ● atual
                </span>
              ` : ''}
            </div>
            <div style="font-size:0.9375rem;font-weight:600;color:var(--text-primary);margin-bottom:6px;">
              ${esc(ins.title)}
            </div>
            ${ins.observation ? `
              <div style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.55;margin-bottom:6px;
                white-space:pre-wrap;">${esc(ins.observation)}</div>
            ` : ''}
            ${ins.recommendation ? `
              <div style="background:rgba(34,197,94,.07);border-left:2px solid #22C55E;
                padding:8px 12px;border-radius:0 4px 4px 0;font-size:0.8125rem;color:var(--text-secondary);
                line-height:1.55;margin-bottom:6px;white-space:pre-wrap;">
                <strong style="color:#22C55E;">Recomendação:</strong> ${esc(ins.recommendation)}
              </div>
            ` : ''}
            ${(() => {
              const snap = formatDataSnapshot(ins.dataSnapshot);
              return snap ? `
                <div style="background:rgba(59,130,246,.06);border-left:2px solid #3B82F6;
                  padding:8px 12px;border-radius:0 4px 4px 0;font-size:0.75rem;color:var(--text-secondary);
                  line-height:1.5;margin-bottom:6px;font-family:monospace;word-break:break-word;"
                  title="Foto dos dados que motivaram este insight (imutável)">
                  <strong style="color:#3B82F6;">📊 Dados observados:</strong> ${esc(snap)}
                </div>
              ` : '';
            })()}
            <div style="font-size:0.6875rem;color:var(--text-muted);line-height:1.6;">
              ${periodCovered ? `📅 <strong>Análise de ${esc(periodCovered)}</strong> · ` : ''}
              <em>escrito ${fmtDate(ins.createdAt)} por ${esc(ins.createdBy?.name || '—')}</em>
              ${(ins.tags || []).length ? ` · ${ins.tags.map(t => `<span style="background:var(--bg-elevated);padding:1px 6px;border-radius:3px;">${esc(t)}</span>`).join(' ')}` : ''}
            </div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            <button class="btn btn-ghost btn-sm" data-act="ip-export" data-id="${esc(ins.id)}" title="Exportar este insight (PDF ou XLSX)">📤</button>
            <button class="btn btn-ghost btn-sm" data-act="ip-edit" data-id="${esc(ins.id)}" title="Editar">✎</button>
            <button class="btn btn-ghost btn-sm" data-act="ip-del" data-id="${esc(ins.id)}" title="Remover" style="color:var(--color-danger);">✕</button>
          </div>
        </div>
      </div>
    `;
  }

  function bindPanelEvents() {
    container.querySelector('#ip-add')?.addEventListener('click', () => openForm());
    container.querySelector('#ip-suggest-ai')?.addEventListener('click', handleAiSuggest);
    container.querySelector('#ip-only-current')?.addEventListener('change', (e) => {
      onlyCurrentPeriod = e.target.checked;
      const list = container.querySelector('#ip-list');
      if (list) list.innerHTML = renderList();
      // Re-bind delete/edit/export buttons after re-render
      container.querySelectorAll('[data-act="ip-edit"]').forEach(b => {
        b.addEventListener('click', () => {
          const ins = insights.find(x => x.id === b.dataset.id);
          if (ins) openForm(ins);
        });
      });
      container.querySelectorAll('[data-act="ip-export"]').forEach(b => {
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const ins = insights.find(x => x.id === b.dataset.id);
          if (ins) openExportMenu(b, ins, dashboard);
        });
      });
      container.querySelectorAll('[data-act="ip-del"]').forEach(b => {
        b.addEventListener('click', async () => {
          if (!confirm('Remover este insight?')) return;
          try {
            await deleteInsight(b.dataset.id);
            toast.success('Insight removido.');
            await refresh();
            container.dispatchEvent(new CustomEvent('insights:changed'));
          } catch (e) { toast.error('Erro: ' + (e.message || '')); }
        });
      });
    });
    container.querySelectorAll('[data-act="ip-edit"]').forEach(b => {
      b.addEventListener('click', () => {
        const ins = insights.find(x => x.id === b.dataset.id);
        if (ins) openForm(ins);
      });
    });
    container.querySelectorAll('[data-act="ip-del"]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('Remover este insight?')) return;
        try {
          await deleteInsight(b.dataset.id);
          toast.success('Insight removido.');
          await refresh();
          container.dispatchEvent(new CustomEvent('insights:changed'));
        } catch (e) { toast.error('Erro: ' + (e.message || '')); }
      });
    });
    container.querySelectorAll('[data-act="ip-export"]').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const ins = insights.find(x => x.id === b.dataset.id);
        if (ins) openExportMenu(b, ins, dashboard);
      });
    });
  }

  /* ════════════════════════════════════════════════
     IA — sugerir e mostrar preview com aprovação
     ════════════════════════════════════════════════ */
  async function handleAiSuggest() {
    const snapshot = typeof getSnapshot === 'function' ? (getSnapshot() || {}) : {};
    if (!Object.keys(snapshot).length) {
      toast.warning('Sem dados de snapshot pra mandar pra IA. Configure getSnapshot.');
      return;
    }

    // Loading toast (id manual pra remover quando terminar)
    const loadingId = toast.info('🤖 IA analisando dados, aguarde...');

    let suggestions;
    try {
      suggestions = await suggestInsightsViaAi({
        dashboard,
        indexKey: indexKey === 'general' ? null : indexKey,
        scope: indexKey && indexKey !== 'general' ? 'widget' : 'dashboard',
        periodFrom, periodTo, periodLabel,
        snapshot, filters,
      });
    } catch (e) {
      console.error('[insightsPanel] AI suggest failed:', e);
      toast.remove(loadingId);
      toast.error('IA falhou: ' + (e.message || ''));
      return;
    }
    toast.remove(loadingId);

    if (suggestions === null) {
      toast.warning('Agente "bi-insights-analyst" não foi seedado no IA Hub. Vá em IA Hub e clique em "Seed agentes".');
      return;
    }

    if (!suggestions.length) {
      toast.info('IA não identificou achados relevantes nos dados desse período.');
      return;
    }

    openAiPreviewModal(suggestions);
  }

  function openAiPreviewModal(suggestions) {
    const m = document.createElement('div');
    m.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2000;
      display:flex;align-items:center;justify-content:center;padding:20px;`;
    m.innerHTML = `
      <div class="card" style="width:100%;max-width:720px;max-height:90vh;
        padding:0;overflow:hidden;display:flex;flex-direction:column;">
        <div style="padding:16px 22px;background:var(--bg-surface);
          border-bottom:1px solid var(--border-subtle);">
          <div style="font-weight:700;font-size:1rem;color:var(--text-primary);margin-bottom:4px;">
            🤖 Sugestões da IA · ${dashInfo.icon} ${esc(dashInfo.label)}
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted);">
            ${suggestions.length} ${suggestions.length === 1 ? 'sugestão' : 'sugestões'}.
            Marque as que quer salvar. Pode editar antes de salvar.
          </div>
        </div>

        <div id="ip-aip-list" style="flex:1;overflow-y:auto;padding:14px 18px;display:flex;flex-direction:column;gap:10px;">
          ${suggestions.map((s, i) => renderAiPreviewCard(s, i)).join('')}
        </div>

        <div style="padding:14px 22px;border-top:1px solid var(--border-subtle);
          background:var(--bg-surface);display:flex;gap:10px;">
          <button class="btn btn-secondary" id="ip-aip-cancel" style="flex:1;">Descartar todas</button>
          <button class="btn btn-primary" id="ip-aip-save" style="flex:2;font-weight:600;">
            💾 Salvar selecionadas
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) m.remove(); });
    document.getElementById('ip-aip-cancel')?.addEventListener('click', () => m.remove());

    document.getElementById('ip-aip-save')?.addEventListener('click', async () => {
      const cards = m.querySelectorAll('[data-aip-card]');
      const toSave = [];
      cards.forEach(card => {
        const checked = card.querySelector('[data-aip-check]').checked;
        if (!checked) return;
        const i = parseInt(card.dataset.aipCard, 10);
        const original = suggestions[i];
        // Pega valores possivelmente editados
        const title = card.querySelector('[data-aip-title]').value.trim();
        const observation = card.querySelector('[data-aip-obs]').value.trim();
        const recommendation = card.querySelector('[data-aip-rec]').value.trim();
        const type = card.querySelector('[data-aip-type]').value;
        const impact = card.querySelector('[data-aip-impact]').value;

        // Detecta se houve edição vs original da IA
        const wasEdited = (
          title !== original.title ||
          observation !== original.observation ||
          recommendation !== original.recommendation ||
          type !== original.type ||
          impact !== original.impact
        );

        toSave.push({
          dashboard,
          indexKey: original.indexKey || (indexKey === 'general' ? null : indexKey),
          title, observation, recommendation, type, impact,
          source: wasEdited ? 'ai-edited' : 'ai-generated',
          aiOriginal: original.aiOriginal,
          dataSnapshot: original.dataSnapshot, // foto dos dados que IA analisou (preservada)
          periodFrom, periodTo, filters,
          tags: ['IA'],
        });
      });

      if (!toSave.length) {
        toast.warning('Nenhuma selecionada.');
        return;
      }

      try {
        for (const s of toSave) await createInsight(s);
        toast.success(`${toSave.length} ${toSave.length === 1 ? 'insight salvo' : 'insights salvos'}.`);
        m.remove();
        await refresh();
        container.dispatchEvent(new CustomEvent('insights:changed'));
      } catch (e) {
        toast.error('Erro ao salvar: ' + (e.message || ''));
      }
    });
  }

  function renderAiPreviewCard(s, i) {
    return `
      <div data-aip-card="${i}" style="background:var(--bg-surface);
        border:1px solid var(--border-subtle);border-left:3px solid #A78BFA;
        border-radius:var(--radius-md);padding:12px 14px;">
        <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;">
          <input type="checkbox" data-aip-check checked
            style="margin-top:6px;width:16px;height:16px;cursor:pointer;">
          <input type="text" data-aip-title value="${esc(s.title)}" maxlength="200"
            class="portal-field" style="flex:1;font-weight:600;font-size:0.875rem;">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
          <select data-aip-type class="filter-select" style="font-size:0.75rem;">
            ${INSIGHT_TYPES.map(t => `<option value="${t.key}" ${s.type === t.key ? 'selected' : ''}>${t.icon} ${esc(t.label)}</option>`).join('')}
          </select>
          <select data-aip-impact class="filter-select" style="font-size:0.75rem;">
            ${IMPACT_LEVELS.map(x => `<option value="${x.key}" ${s.impact === x.key ? 'selected' : ''}>Impacto ${esc(x.label)}</option>`).join('')}
          </select>
        </div>
        <textarea data-aip-obs rows="3" maxlength="4000" placeholder="Observação"
          class="portal-field" style="width:100%;resize:vertical;font-size:0.8125rem;margin-bottom:6px;">${esc(s.observation || '')}</textarea>
        <textarea data-aip-rec rows="2" maxlength="4000" placeholder="Recomendação (opcional)"
          class="portal-field" style="width:100%;resize:vertical;font-size:0.8125rem;">${esc(s.recommendation || '')}</textarea>
      </div>
    `;
  }

  /* ════════════════════════════════════════════════
     FORM — criar/editar manual
     Campos visíveis e editáveis:
       - Período da análise (DD/MM/YYYY → DD/MM/YYYY)
       - Checkbox "Sem período específico"
       - Viewer readonly do snapshot dos dados (auto-capturado ou IA)
     ════════════════════════════════════════════════ */
  function openForm(existing = null) {
    const isEdit = !!existing?.id;
    const isAiSourced = existing?.source === 'ai-generated' || existing?.source === 'ai-edited';
    const targetIndexKey = isEdit
      ? (existing.indexKey || null)
      : (indexKey === 'general' ? null : indexKey || null);

    // Período: edit usa o que já tem; novo pré-preenche com filtro do dash
    const initFrom = existing?.periodFrom?.toDate?.() || (existing?.periodFrom ? new Date(existing.periodFrom) : periodFrom);
    const initTo   = existing?.periodTo?.toDate?.()   || (existing?.periodTo   ? new Date(existing.periodTo)   : periodTo);
    const dateToInput = d => d ? d.toISOString().slice(0, 10) : '';
    const initFromStr = dateToInput(initFrom);
    const initToStr   = dateToInput(initTo);
    const noPeriodInit = isEdit && !existing.periodFrom && !existing.periodTo;

    // Snapshot: edit usa o salvo; novo captura do widget agora (manual) — se não houver ainda
    let initialSnapshot = existing?.dataSnapshot || null;
    if (!initialSnapshot && !isEdit && typeof getSnapshot === 'function') {
      try {
        const snap = getSnapshot() || {};
        initialSnapshot = { ...snap, capturedAt: new Date().toISOString(), _source: 'manual-capture' };
      } catch (e) {
        console.warn('[insightsPanel] getSnapshot falhou no openForm:', e.message);
      }
    }
    const snapshotPreview = initialSnapshot ? formatDataSnapshot(initialSnapshot) : null;

    // Captura imagem do canvas do widget (se houver) pra embed no PDF.
    // IMPORTANTE: redimensiona pra max 800px de largura. PNG nao comprimido
    // em PDF expande pra raw RGB (W×H×4 bytes). Canvas Chart.js retina é
    // ~1400x1460 → 8MB de RGB. Redimensionado a 800x~830 → ~2.6MB raw,
    // ainda mais que ideal mas funcional. Compression FAST no addImage
    // ajuda no PDF final.
    let initialChartImage = existing?.chartImage || null;
    if (!initialChartImage && !isEdit && targetIndexKey) {
      try {
        const slot = container.querySelector('[data-widget-id]') || container;
        const widgetId = slot.dataset?.widgetId;
        const widgetEl = widgetId ? document.getElementById(widgetId) : container.closest('.dash-widget');
        const canvas = widgetEl?.querySelector('canvas');
        if (canvas && canvas.width > 0 && canvas.height > 0) {
          initialChartImage = downsizeCanvas(canvas, 800);
          if (initialChartImage && initialChartImage.length > 350_000) {
            console.warn('[insightsPanel] canvas resized image >350KB:', initialChartImage.length);
          }
        }
      } catch (e) {
        console.warn('[insightsPanel] captura canvas falhou:', e.message);
      }
    }

    const m = document.createElement('div');
    m.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2000;
      display:flex;align-items:center;justify-content:center;padding:20px;`;
    m.innerHTML = `
      <div class="card" style="width:100%;max-width:620px;max-height:92vh;
        padding:0;overflow:hidden;display:flex;flex-direction:column;">
        <div style="padding:16px 22px;background:var(--bg-surface);
          border-bottom:1px solid var(--border-subtle);
          display:flex;justify-content:space-between;align-items:center;">
          <div style="font-weight:700;font-size:1rem;">
            💡 ${isEdit ? 'Editar' : 'Novo'} insight · ${dashInfo.icon} ${esc(dashInfo.label)}
            ${targetIndexKey ? `<span style="font-size:0.7rem;color:var(--text-muted);font-weight:400;">📍 ${esc(indexLabel || targetIndexKey)}</span>` : ''}
          </div>
          <button id="ipf-close" style="border:none;background:none;cursor:pointer;font-size:1.25rem;color:var(--text-muted);">✕</button>
        </div>

        <div style="overflow-y:auto;flex:1;padding:18px 22px;display:flex;flex-direction:column;gap:14px;">
          ${isAiSourced ? `
            <div style="background:rgba(167,139,250,.1);border:1px solid rgba(167,139,250,.3);
              padding:8px 12px;border-radius:var(--radius-sm);font-size:0.75rem;color:var(--text-secondary);">
              🤖 Insight gerado por IA. Edições serão marcadas como "ai-edited" mantendo o original em audit trail.
              ${initialSnapshot ? '<br><strong>Dados observados</strong> (abaixo) ficam preservados imutáveis — são a foto do que a IA analisou.' : ''}
            </div>
          ` : ''}

          <div>
            <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Título *</label>
            <input id="ipf-title" type="text" class="portal-field" style="width:100%;"
              maxlength="200" placeholder="Ex: SLA caiu 15% no setor Marketing"
              value="${esc(existing?.title || '')}">
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Tipo</label>
              <select id="ipf-type" class="filter-select" style="width:100%;">
                ${INSIGHT_TYPES.map(t => `<option value="${t.key}" ${(existing?.type || 'neutral') === t.key ? 'selected' : ''}>${t.icon} ${esc(t.label)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Impacto</label>
              <select id="ipf-impact" class="filter-select" style="width:100%;">
                ${IMPACT_LEVELS.map(x => `<option value="${x.key}" ${(existing?.impact || 'medium') === x.key ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}
              </select>
            </div>
          </div>

          <!-- ═══ PERÍODO DA ANÁLISE (visível e editável) ═══ -->
          <div style="background:rgba(59,130,246,.05);border:1px solid rgba(59,130,246,.2);
            padding:10px 12px;border-radius:var(--radius-sm);">
            <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:6px;color:var(--text-primary);">
              📅 Período da análise <span style="font-weight:400;color:var(--text-muted);">— qual janela de dados este insight cobre</span>
            </label>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
              <input type="date" id="ipf-period-from" class="portal-field" style="flex:1;min-width:130px;font-size:0.8125rem;"
                value="${initFromStr}" ${noPeriodInit ? 'disabled' : ''}>
              <span style="color:var(--text-muted);">→</span>
              <input type="date" id="ipf-period-to" class="portal-field" style="flex:1;min-width:130px;font-size:0.8125rem;"
                value="${initToStr}" ${noPeriodInit ? 'disabled' : ''}>
            </div>
            <label style="display:flex;align-items:center;gap:6px;font-size:0.7rem;color:var(--text-muted);cursor:pointer;">
              <input type="checkbox" id="ipf-no-period" ${noPeriodInit ? 'checked' : ''} style="cursor:pointer;">
              Sem período específico (insight permanente / não temporal)
            </label>
            ${!isEdit ? `<div style="font-size:0.65rem;color:var(--text-muted);margin-top:6px;font-style:italic;">
              Pré-preenchido com filtro atual do dashboard. Ajuste pra refletir o que você está analisando.
            </div>` : ''}
          </div>

          <div>
            <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Observação (o que aconteceu) *</label>
            <textarea id="ipf-obs" class="portal-field" rows="4" maxlength="4000"
              placeholder="Descreva o achado nos dados..." style="width:100%;resize:vertical;">${esc(existing?.observation || '')}</textarea>
          </div>

          <div>
            <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Recomendação (o que fazer) <span style="font-weight:400;color:var(--text-muted);">opcional</span></label>
            <textarea id="ipf-rec" class="portal-field" rows="3" maxlength="4000"
              placeholder="Ação sugerida para corrigir/explorar este achado..." style="width:100%;resize:vertical;">${esc(existing?.recommendation || '')}</textarea>
          </div>

          <!-- ═══ DADOS OBSERVADOS (snapshot, readonly) ═══ -->
          ${snapshotPreview ? `
          <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);
            padding:10px 12px;border-radius:var(--radius-sm);">
            <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:6px;color:var(--text-primary);">
              📊 Dados observados <span style="font-weight:400;color:var(--text-muted);">— foto histórica, imutável</span>
            </label>
            <div style="font-size:0.75rem;color:var(--text-secondary);font-family:monospace;
              line-height:1.5;background:var(--bg-elevated);padding:8px 10px;border-radius:4px;
              max-height:90px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;">${esc(snapshotPreview)}</div>
            <div style="font-size:0.65rem;color:var(--text-muted);margin-top:4px;font-style:italic;">
              ${initialSnapshot._source === 'ai-suggestion'
                ? 'Capturado pela IA quando gerou esta sugestão.'
                : 'Capturado do widget no momento de criação.'}
              ${initialSnapshot.capturedAt ? ' · ' + new Date(initialSnapshot.capturedAt).toLocaleString('pt-BR') : ''}
            </div>
          </div>
          ` : (!isEdit && targetIndexKey ? `
          <div style="background:var(--bg-surface);border:1px dashed var(--border-subtle);
            padding:8px 12px;border-radius:var(--radius-sm);font-size:0.7rem;color:var(--text-muted);">
            ⓘ Sem dados pra capturar deste widget no momento. Insight será salvo sem snapshot.
          </div>
          ` : '')}

          <div>
            <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Tags <span style="font-weight:400;color:var(--text-muted);">separadas por vírgula, opcional</span></label>
            <input id="ipf-tags" type="text" class="portal-field" style="width:100%;"
              placeholder="ex: marketing, atraso, urgente"
              value="${esc((existing?.tags || []).join(', '))}">
          </div>
        </div>

        <div style="padding:14px 22px;border-top:1px solid var(--border-subtle);
          background:var(--bg-surface);display:flex;gap:10px;">
          <button class="btn btn-secondary" id="ipf-cancel" style="flex:1;">Cancelar</button>
          <button class="btn btn-primary" id="ipf-save" style="flex:2;font-weight:600;">
            💾 ${isEdit ? 'Salvar alterações' : 'Adicionar insight'}
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) m.remove(); });
    document.getElementById('ipf-close')?.addEventListener('click', () => m.remove());
    document.getElementById('ipf-cancel')?.addEventListener('click', () => m.remove());

    // Toggle "Sem período específico" — desabilita inputs de data
    document.getElementById('ipf-no-period')?.addEventListener('change', (e) => {
      const disabled = e.target.checked;
      document.getElementById('ipf-period-from').disabled = disabled;
      document.getElementById('ipf-period-to').disabled = disabled;
      if (disabled) {
        document.getElementById('ipf-period-from').value = '';
        document.getElementById('ipf-period-to').value = '';
      }
    });

    document.getElementById('ipf-save')?.addEventListener('click', async () => {
      const title = document.getElementById('ipf-title').value.trim();
      if (!title) { toast.error('Título obrigatório.'); return; }

      const noPeriod = document.getElementById('ipf-no-period').checked;
      const periodFromVal = noPeriod ? null : document.getElementById('ipf-period-from').value;
      const periodToVal   = noPeriod ? null : document.getElementById('ipf-period-to').value;

      // Parse date local (YYYY-MM-DD ao meio-dia local pra evitar shift de timezone).
      // new Date('2026-03-01') é interpretado como UTC midnight, vira "28 fev 21:00"
      // em UTC-3. Construir com noon local resolve.
      const parseLocalDate = (s) => {
        if (!s) return null;
        const [y, mo, d] = s.split('-').map(Number);
        return new Date(y, mo - 1, d, 12, 0, 0);
      };
      const periodFromDate = parseLocalDate(periodFromVal);
      const periodToDate   = parseLocalDate(periodToVal);

      // Validação: se tem from + to, from <= to
      if (periodFromDate && periodToDate && periodFromDate > periodToDate) {
        toast.error('Data inicial não pode ser posterior à final.');
        return;
      }

      const data = {
        dashboard,
        indexKey: targetIndexKey,
        title,
        observation:    document.getElementById('ipf-obs').value.trim(),
        recommendation: document.getElementById('ipf-rec').value.trim(),
        type:           document.getElementById('ipf-type').value,
        impact:         document.getElementById('ipf-impact').value,
        tags:           document.getElementById('ipf-tags').value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10),
        periodFrom:     periodFromDate,
        periodTo:       periodToDate,
        filters,
      };

      // dataSnapshot + chartImage: imutáveis após criação (preservados no edit)
      if (!isEdit) {
        data.dataSnapshot = initialSnapshot;
        if (initialChartImage) data.chartImage = initialChartImage;
      }
      // No edit, NÃO sobrescreve dataSnapshot/chartImage — fotos históricas preservadas

      // Se editando insight ai-generated, vira ai-edited
      if (isEdit && isAiSourced && existing.source === 'ai-generated') {
        data.source = 'ai-edited';
        data.aiOriginal = existing.aiOriginal || {
          title: existing.title, observation: existing.observation,
          recommendation: existing.recommendation, type: existing.type, impact: existing.impact,
          generatedAt: null, agentId: null, agentName: 'unknown',
        };
      }

      try {
        if (isEdit) await updateInsight(existing.id, data);
        else await createInsight(data);
        toast.success(isEdit ? 'Insight atualizado.' : 'Insight adicionado.');
        m.remove();
        await refresh();
        container.dispatchEvent(new CustomEvent('insights:changed'));
      } catch (e) {
        toast.error('Erro: ' + (e.message || ''));
      }
    });
  }

  await refresh();
  return {
    refresh,
    open: () => {
      // No modo widget, abre popover programaticamente
      if (mode === 'widget') {
        const trigger = container.querySelector('#ip-widget-trigger');
        if (trigger) openPopover(trigger);
      }
    },
  };
}
