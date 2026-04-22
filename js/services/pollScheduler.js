/**
 * PRIMETOUR — Poll Scheduler
 *
 * Wrapper sobre setInterval com:
 *   - pausa automática quando a aba fica hidden (Page Visibility API)
 *   - opcional: dispara imediatamente uma vez ao iniciar
 *   - cleanup centralizado (retorna função de stop)
 *
 * Por quê: pollers de notificação, contadores e automações ficam rodando
 * em abas em background, gastando reads do Firestore em quem deixou a
 * aba aberta a noite inteira. O custo médio é não-trivial — 18 users
 * × 1 timer 60s × 8h dormindo = 8.640 reads/dia desperdiçados.
 *
 * Uso:
 *   const stop = startPolling(async () => { ... }, {
 *     intervalMs: 5 * 60 * 1000,
 *     immediate: true,
 *     pauseWhenHidden: true,
 *   });
 *   // depois: stop();
 */

/**
 * Inicia um poller que respeita visibilidade da aba.
 * @param {() => any|Promise<any>} fn - função executada a cada tick
 * @param {object} opts
 * @param {number} opts.intervalMs - intervalo entre execuções
 * @param {boolean} [opts.immediate=true] - executa uma vez ao iniciar
 * @param {boolean} [opts.pauseWhenHidden=true] - pausa quando aba escondida
 * @param {boolean} [opts.runOnVisible=true] - quando a aba volta, dispara fn
 * @param {string}  [opts.label] - label para logs (debug)
 * @returns {() => void} função de stop
 */
export function startPolling(fn, {
  intervalMs,
  immediate       = true,
  pauseWhenHidden = true,
  runOnVisible    = true,
  label           = '',
} = {}) {
  if (typeof fn !== 'function')   throw new TypeError('fn must be a function');
  if (!Number.isFinite(intervalMs) || intervalMs < 1000) {
    throw new RangeError('intervalMs must be >= 1000ms');
  }

  let timer    = null;
  let stopped  = false;

  const tick = async () => {
    try { await fn(); }
    catch (e) { console.warn(`[poll${label ? ':'+label : ''}] tick error:`, e?.message || e); }
  };

  const start = () => {
    if (stopped || timer) return;
    timer = setInterval(tick, intervalMs);
  };

  const pause = () => {
    if (timer) { clearInterval(timer); timer = null; }
  };

  const onVisibility = () => {
    if (stopped) return;
    if (document.hidden) {
      pause();
    } else {
      start();
      if (runOnVisible) tick(); // catch-up imediato ao voltar
    }
  };

  if (pauseWhenHidden && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
  }

  if (immediate) tick();
  if (!pauseWhenHidden || !document?.hidden) start();

  return function stop() {
    stopped = true;
    pause();
    if (pauseWhenHidden && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
    }
  };
}
