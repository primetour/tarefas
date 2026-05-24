/**
 * PRIMETOUR — Realtime Sync Helper
 * Adiciona auto-refresh em real-time em pages que carregam `tasks` com
 * `fetchTasks()` one-shot no mount.
 *
 * Quando o user fica numa page sem F5, queremos que tarefas novas (criadas
 * em outra aba/device) apareçam sem ação manual. Em vez de migrar cada
 * page pra usar `subscribeToTasks` diretamente (que exigiria refatoração
 * do fluxo de render de cada uma), este helper assina `tasks` UMA vez e,
 * a cada update real, chama uma função `refreshFn(container)` da page —
 * que pode ser a própria `renderXxx` (re-mount completo) ou um redraw
 * mais inteligente.
 *
 * Cuidados:
 *   - `subscribeToTasks` dispara IMEDIATAMENTE com o snapshot inicial;
 *     ignoramos o primeiro callback pra não fazer double-render.
 *   - Debounce de 1.5s pra agrupar bursts de updates (ex: bulk import).
 *   - 1 subscription por `pageId` — chamar setup de novo limpa a anterior.
 *   - `teardown` no `destroyXxx` evita memory leak quando user navega out.
 *
 * Uso:
 *   import { setupTasksAutoRefresh, teardownTasksAutoRefresh }
 *     from '../services/realtimeSync.js';
 *
 *   export async function renderDashboard(container) {
 *     // ... código atual de render ...
 *     setupTasksAutoRefresh('dashboard', container, renderDashboard);
 *   }
 *
 *   export function destroyDashboard() {
 *     teardownTasksAutoRefresh('dashboard');
 *   }
 *
 * v4.53.4+
 */

import { subscribeToTasks } from './tasks.js';

const _registry = new Map();

/**
 * Liga auto-refresh de uma page.
 *
 * @param {string}   pageId      — identificador único da page (ex: 'dashboard')
 * @param {Element}  container   — container DOM da page (passado pra refreshFn)
 * @param {Function} refreshFn   — função chamada quando há update real;
 *                                 normalmente é a própria renderXxx da page
 * @param {Object}   [opts]
 * @param {number}   [opts.debounceMs=1500] — janela pra agrupar bursts
 */
export function setupTasksAutoRefresh(pageId, container, refreshFn, opts = {}) {
  const { debounceMs = 1500 } = opts;

  // Limpa anterior pra mesmo pageId (re-mount idempotente)
  teardownTasksAutoRefresh(pageId);

  const state = {
    container,
    refreshFn,
    gotInitial: false,
    timer: null,
    unsub: null,
  };

  state.unsub = subscribeToTasks(() => {
    // Primeira invocação é o snapshot inicial — page já renderizou com fetch
    if (!state.gotInitial) {
      state.gotInitial = true;
      return;
    }
    // Page foi destruída entre o snapshot e o callback
    if (!state.container || !document.body.contains(state.container)) return;

    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      try {
        const result = state.refreshFn(state.container);
        // refreshFn pode ser async — ignora a promise (não bloqueia)
        if (result?.catch) result.catch(e => console.warn(`[realtimeSync:${pageId}] refresh falhou:`, e?.message || e));
      } catch (e) {
        console.warn(`[realtimeSync:${pageId}] refresh threw:`, e?.message || e);
      }
    }, debounceMs);
  });

  _registry.set(pageId, state);
}

/**
 * Desliga auto-refresh. Chamar em destroyXxx da page e no beforeNavigation
 * do router (defensive).
 */
export function teardownTasksAutoRefresh(pageId) {
  const state = _registry.get(pageId);
  if (!state) return;
  if (state.unsub) {
    try { state.unsub(); } catch {}
  }
  if (state.timer) clearTimeout(state.timer);
  _registry.delete(pageId);
}

/**
 * Pra debug: lista pages com sync ativo.
 */
export function getActiveSyncs() {
  return Array.from(_registry.keys());
}

/**
 * Limpa TODAS as subscriptions registradas. Chamar no `beforeNavigation` do
 * router — defesa-em-profundidade caso uma page tenha sido migrada pra usar
 * setupTasksAutoRefresh mas esqueceram de criar/chamar destroyXxx.
 */
export function teardownAllTasksAutoRefresh() {
  for (const pageId of Array.from(_registry.keys())) {
    teardownTasksAutoRefresh(pageId);
  }
}
