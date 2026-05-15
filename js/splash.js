/**
 * PRIMETOUR — Splash Logo Setter
 *
 * 4.40.21+ (security audit) — extraído de inline em index.html. Mapping
 * EXPLÍCITO de logo por paleta. SEM cropped, SEM localStorage — URLs diretas
 * hardcoded pra garantia 100% determinística independente de cache do browser.
 *
 * Roda na sequência do preload.js, ao carregar a tela de splash inicial.
 */

(function () {
  try {
    var LIGHT_LOGO = 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/logos/lazer-1777390896671.webp';
    var DARK_LOGO  = 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/logos/lazer-alt-1777403810065.webp';
    var palette = document.documentElement.getAttribute('data-palette') || 'midnight';
    var useDark = (palette === 'platinum' || palette === 'sand');
    var url = useDark ? DARK_LOGO : LIGHT_LOGO;
    var img = document.getElementById('loading-logo-img');
    var txt = document.getElementById('loading-logo-text');
    if (img) {
      img.src = url;
      img.style.width = 'auto';
      img.style.height = '120px';
      img.style.maxWidth = '480px';
    }
    if (txt) txt.style.display = 'none';
  } catch (e) { /* noop */ }
})();
