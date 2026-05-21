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
  // Rodapé fino centralizado — paridade com o btg-pactual (OperadoraFooter
  // / PartnersFooter): só a linha de copyright, sem logo nem colunas.
  container.innerHTML = `
    <footer class="btg-footer" style="background:${cfg.bg};padding:32px 20px;text-align:center;">
      <p style="font-size:14px;line-height:1.5;color:rgba(255,255,255,0.6);">
        Copyright © ${new Date().getFullYear()}. Todos os direitos reservados.
      </p>
    </footer>
  `;
}
