/**
 * PRIMETOUR — Preload script
 *
 * 4.40.21+ (security audit) — extraído de inline em index.html pra permitir
 * remoção de 'unsafe-inline' do script-src CSP no futuro (atual ainda precisa
 * pelos scripts inline restantes em loading splash).
 *
 * Roda ANTES do app principal — aplica paleta/fonte salvas pra evitar flash
 * de tema errado durante a hydration do Vanilla JS.
 */

// Aplica paleta e fonte salvas antes do render
(function () {
  try {
    var p = localStorage.getItem('primetour-palette') || 'portal';
    var f = localStorage.getItem('primetour-font') || '';
    document.documentElement.dataset.palette = p;
    if (f && f !== 'outfit') document.documentElement.dataset.font = f;
  } catch (e) {
    // localStorage indisponível (modo privado raro) → segue com defaults
  }
})();

// Limpa cropped legacy do localStorage (4.39.x cleanup; mantido por idempotência)
(function () {
  try {
    ['app-logo-light-cropped', 'app-logo-dark-cropped'].forEach(function (k) {
      localStorage.removeItem(k);
    });
  } catch (e) { /* noop */ }
})();
