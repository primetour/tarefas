/**
 * Footer simples por marca — reduzido (py-8) como no projeto Next.
 */

const FOOTERS = {
  partners: {
    bg: '#05132a',
    text: 'rgba(255,255,255,0.7)',
    logo: '/btg/assets/partners/btgpactual_logo.png',
    invert: true,
    title: 'Cartão Partners BTG Pactual',
  },
  ultrablue: {
    bg: '#0b2859',
    text: 'rgba(255,255,255,0.7)',
    logo: '/btg/assets/partners/btgpactual_logo.png',
    invert: true,
    title: 'Cartão Ultrablue BTG Pactual',
  },
  operadora: {
    bg: '#1a2b4a',
    text: 'rgba(255,255,255,0.7)',
    logo: '/btg/assets/operadora/logo_primetour.png',
    invert: false,
    title: 'Operadora Primetour',
  },
};

/**
 * @param {HTMLElement} container
 * @param {'partners' | 'ultrablue' | 'operadora'} brand
 */
export function renderBtgFooter(container, brand) {
  const cfg = FOOTERS[brand];
  if (!cfg) return;
  container.innerHTML = `
    <footer class="btg-footer" style="background:${cfg.bg};color:${cfg.text};">
      <div class="btg-container btg-footer__inner">
        <img src="${cfg.logo}" alt="${cfg.title}" class="btg-footer__logo" style="filter:${cfg.invert ? 'brightness(0) invert(1) opacity(.85)' : 'none'};" />
        <p class="btg-footer__copy">
          © ${new Date().getFullYear()} ${cfg.title} · Operado por Primetour Viagens e Experiências.
        </p>
      </div>
    </footer>
  `;
}
