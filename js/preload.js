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

/**
 * 4.48.3+ Cache-loop prevention — Auto-reload SE detectar versão mismatch.
 *
 * Problema que isso resolve: depois de um deploy com mudanças em cascata
 * (ex: app.js v4.48.0 importa portalAreas que importa areaTokens BUGADO),
 * o browser pode ficar com index.html cacheado apontando pra app.js?v=OLD
 * + módulos JS cacheados — boot quebra em loop ("Auth timeout — forçando render").
 *
 * Como funciona:
 *   1. Lê a versão do app.js do <script> tag (string ?v=X+Y no src)
 *   2. Compara com a última versão "vista funcionar" salva em localStorage
 *   3. Se a versão MUDOU + última visita foi há menos de 1h: provavelmente
 *      cache stale do browser. Força location.reload(true) UMA vez.
 *   4. Se já tentamos reload nesta sessão, NÃO loop infinito: pula.
 *
 * Não dispara em primeira visita (sem version anterior). Salva nova versão
 * só depois do app boot completar com sucesso (em app.js initApp).
 */
(function () {
  try {
    var scriptTag = document.querySelector('script[src*="js/app.js"]');
    if (!scriptTag) return;
    var match = (scriptTag.src || '').match(/\?v=([\w.+-]+)/);
    if (!match) return;
    var currentVersion = match[1];
    var lastSeenVersion = localStorage.getItem('primetour-last-version');
    var lastReloadTs   = parseInt(localStorage.getItem('primetour-last-reload') || '0', 10);
    var now = Date.now();

    // Se versão mudou E não recarregamos nesta sessão recente (< 30s)
    if (lastSeenVersion && lastSeenVersion !== currentVersion && (now - lastReloadTs) > 30000) {
      console.log('[Preload] Versão mudou: ' + lastSeenVersion + ' → ' + currentVersion + '. Auto-reload pra evitar cache stale.');
      localStorage.setItem('primetour-last-reload', String(now));
      // Force network reload (deprecated mas funciona em todos browsers)
      location.reload(true);
      return; // evita continuar boot
    }
    // Atualiza versão "vista" depois de 5s (se app não recarregou, considera OK)
    setTimeout(function () {
      localStorage.setItem('primetour-last-version', currentVersion);
    }, 5000);
  } catch (e) { /* noop — falha silenciosa, segue boot normal */ }
})();
