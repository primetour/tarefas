/**
 * Listener error handler shared (v4.49.61+)
 *
 * Wrapper padronizado pra onError de listeners (onSnapshot).
 * Faz 3 coisas:
 *   1. Log com source identificável
 *   2. Sinaliza connection.markNetworkError se for transitório (rede)
 *   3. Chama callback custom (opcional) pra fallback específico do consumer
 *
 * Uso:
 *   onSnapshot(q, (snap) => { ... }, listenerError('presence'));
 *
 * OU com fallback custom:
 *   onSnapshot(q, (snap) => { ... }, listenerError('presence', (err) => {
 *     if (err.code === 'permission-denied') doSomething();
 *   }));
 */

export function listenerError(source, customHandler) {
  return (err) => {
    const code = err?.code || 'unknown';
    const msg  = err?.message || String(err);
    console.warn(`[${source}] snapshot error:`, code, msg.slice(0, 200));

    // Sinaliza connection (lazy import pra não criar ciclo nem inflar bundle)
    import('./connection.js').then(({ markNetworkError, isFirestoreError }) => {
      if (isFirestoreError(err)) markNetworkError(source, err);
    }).catch(() => { /* connection.js indisponível, log já feito */ });

    // Custom handler (opcional)
    if (typeof customHandler === 'function') {
      try { customHandler(err); } catch (e) { console.warn(`[${source}] custom handler err:`, e); }
    }
  };
}
