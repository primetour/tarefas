/**
 * PRIMETOUR — Insights Widgets Registry & Mounter
 *
 * Helper genérico pra qualquer dashboard plugar insights por widget +
 * análise geral. Centraliza:
 *   - Registry tipado de widgets do dashboard (indexKey, label, snapshot fn)
 *   - Mount paralelo dos popovers em todos os widgets
 *   - Publicação de widgetLabels em window pra export individual achar
 *   - Mount do painel "Análise Geral" no fim do dashboard
 *   - Build de snapshot agregado pra IA
 *
 * Uso típico em uma página de dashboard:
 *
 *   import { setupDashboardInsights } from '../services/insightWidgets.js';
 *
 *   const WIDGETS = [
 *     { widgetId: 'sla-chart', indexKey: 'sla', label: '📊 SLA',
 *       snapshot: (m) => ({ sla: getSlaData(m) }) },
 *     ...
 *   ];
 *
 *   await setupDashboardInsights({
 *     dashboard: 'produtividade',
 *     widgets: WIDGETS,
 *     metrics,                                    // dados agregados do dash
 *     periodFrom, periodTo, periodLabel, filters,
 *     generalPanelContainerId: 'dash-insights-section',
 *     buildGeneralSnapshot: () => ({ ... }),     // opcional, pra IA do panel
 *     enableAi: true,
 *   });
 */

import { mountInsightsPanel } from '../components/insightsPanel.js?v=20260503uu1';

/**
 * Publica widgetLabels num registro global pra insightExport.js encontrar
 * o nome legível do widget ao gerar PDF/XLSX individual.
 */
function publishWidgetLabels(dashboard, widgets) {
  window.__INSIGHT_WIDGET_LABELS = window.__INSIGHT_WIDGET_LABELS || {};
  window.__INSIGHT_WIDGET_LABELS[dashboard] = Object.fromEntries(
    widgets.map(w => [w.indexKey, w.label])
  );
}

/**
 * Monta o popover de insights em cada slot de widget do dashboard.
 * Paralelo via Promise.allSettled — falha de um widget não derruba os outros.
 *
 * @returns {Promise<{ ok: number, failed: Array<{widget, error}> }>}
 */
export async function attachWidgetInsights({
  dashboard,
  widgets,                  // Array<{ widgetId, indexKey, label, snapshot(m) }>
  metrics,                  // dados do dashboard pra snapshot fn
  periodFrom, periodTo, periodLabel, filters,
  enableAi = true,
}) {
  publishWidgetLabels(dashboard, widgets);

  const tasks = widgets.map(w => {
    const widget = document.getElementById(w.widgetId);
    if (!widget) return Promise.resolve({ widget: w.widgetId, skipped: 'no element' });
    const slot = widget.querySelector('.widget-insights-slot');
    if (!slot) return Promise.resolve({ widget: w.widgetId, skipped: 'no slot' });

    return mountInsightsPanel({
      container: slot,
      dashboard,
      mode: 'widget',
      indexKey: w.indexKey,
      indexLabel: w.label,
      periodFrom, periodTo,
      periodLabel,
      filters,
      enableAi,
      getSnapshot: () => {
        try { return w.snapshot(metrics); }
        catch (e) {
          console.warn(`[insightWidgets] snapshot fn de ${w.widgetId} falhou:`, e?.message);
          return {};
        }
      },
    }).catch(e => ({ widget: w.widgetId, error: e?.message }));
  });

  const results = await Promise.allSettled(tasks);
  const failed = [];
  let ok = 0;
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      failed.push({ widget: widgets[i].widgetId, error: r.reason?.message });
    } else if (r.value?.error) {
      failed.push({ widget: widgets[i].widgetId, error: r.value.error });
    } else {
      ok++;
    }
  });
  if (failed.length) console.warn(`[insightWidgets:${dashboard}] ${failed.length} falhas:`, failed);
  return { ok, failed };
}

/**
 * Monta o painel "Análise Geral do Dashboard" (indexKey='general')
 * no container indicado. Filtra apenas insights NÃO ancorados a widget.
 */
export async function attachGeneralPanel({
  dashboard,
  containerId,                // ex: 'dash-insights-section'
  periodFrom, periodTo, periodLabel, filters,
  buildSnapshot = null,       // fn que devolve snapshot agregado pra IA
  enableAi = true,
}) {
  const section = document.getElementById(containerId);
  if (!section) {
    console.warn(`[insightWidgets] container #${containerId} não encontrado`);
    return null;
  }
  return mountInsightsPanel({
    container: section,
    dashboard,
    mode: 'panel',
    indexKey: 'general',
    periodFrom, periodTo,
    periodLabel,
    filters,
    enableAi,
    getSnapshot: typeof buildSnapshot === 'function'
      ? () => { try { return buildSnapshot(); } catch (e) { console.warn(e); return {}; } }
      : null,
  });
}

/**
 * Setup completo: widgets + painel geral em uma chamada.
 * Conveniência pra a maioria dos casos.
 */
export async function setupDashboardInsights(opts) {
  const {
    dashboard, widgets, metrics,
    periodFrom, periodTo, periodLabel, filters,
    generalPanelContainerId, buildGeneralSnapshot,
    enableAi = true,
  } = opts;

  // 1) Registra widgets pro export individual achar labels
  publishWidgetLabels(dashboard, widgets);

  // 2) Mount paralelo dos popovers em cada widget
  const widgetResult = await attachWidgetInsights({
    dashboard, widgets, metrics,
    periodFrom, periodTo, periodLabel, filters,
    enableAi,
  });

  // 3) Mount do painel geral (se containerId fornecido)
  let generalApi = null;
  if (generalPanelContainerId) {
    generalApi = await attachGeneralPanel({
      dashboard,
      containerId: generalPanelContainerId,
      periodFrom, periodTo, periodLabel, filters,
      buildSnapshot: buildGeneralSnapshot,
      enableAi,
    });
  }

  return { widgets: widgetResult, general: generalApi };
}

/**
 * Helper pra exportações batch do dashboard. Retorna o registro de
 * widgetLabels pro mesmo formato esperado por insights.js (groupInsightsByIndex).
 */
export function getWidgetLabelsRegistry(dashboard) {
  return window.__INSIGHT_WIDGET_LABELS?.[dashboard]
    || {};
}
