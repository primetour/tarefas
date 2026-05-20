/**
 * Header fixo das landing pages BTG/Operadora.
 * Replica o comportamento do LandingHeader.tsx do projeto Next.js:
 * logo + nav agrupados a esquerda, CTA "Quero falar com meu concierge"
 * a direita, transicao solid/transparent ao rolar, menu mobile com
 * overlay deslizando do topo.
 */

import { icon } from './btg-icons.js';

/**
 * @typedef {Object} BtgNavItem
 * @property {string} label
 * @property {string} href
 * @property {Array<{label: string, href: string}>} [children]
 */

/**
 * @typedef {Object} BtgHeaderConfig
 * @property {'partners' | 'ultrablue' | 'operadora'} brand
 * @property {string} homeHref
 * @property {string} logoSrc
 * @property {string} logoAlt
 * @property {Array<BtgNavItem>} nav
 * @property {string} conciergeUrl
 */

const VIAGENS_CHILDREN = [
  { label: 'Feriados', href: '/viagens/feriados' },
  { label: 'Destinos', href: '/viagens/destinos' },
  { label: 'Hospedagem', href: '/viagens/hospedagem' },
  { label: 'Aéreo & Transfers', href: '/viagens/aereo-transfers' },
];

const NAV_PARTNERS_ULTRABLUE = [
  { label: 'Viagens', href: '/viagens', children: VIAGENS_CHILDREN },
  { label: 'Cruzeiros', href: '/cruzeiros' },
  { label: 'Concierge', href: '/concierge' },
  { label: 'Benefícios', href: '/beneficios' },
];

const NAV_OPERADORA = [
  { label: 'Feriados', href: '/operadora/viagens/feriados' },
  { label: 'Destinos', href: '/operadora/viagens/destinos' },
  { label: 'Hospedagem', href: '/operadora/viagens/hospedagem' },
  { label: 'Aéreo & Transfers', href: '/operadora/viagens/aereo-transfers' },
  { label: 'Cruzeiros', href: '/operadora/cruzeiros' },
];

const BRAND_CONFIG = {
  partners: {
    homeHref: '/btg/partners/',
    logoSrc: '/btg/assets/partners/btgpactual_logo.png',
    logoAlt: 'BTG Pactual',
    logoClass: 'btg-logo',
    nav: NAV_PARTNERS_ULTRABLUE.map((i) =>
      i.href === '/viagens' ? { ...i, href: '/btg/partners/viagens/' }
      : i.href === '/cruzeiros' ? { ...i, href: '/btg/partners/cruzeiros/' }
      : i.href === '/concierge' ? { ...i, href: '/btg/partners/concierge/' }
      : i.href === '/beneficios' ? { ...i, href: '/btg/partners/beneficios/' }
      : i,
    ),
    conciergeUrl:
      'https://wa.me/551148621680?text=' +
      encodeURIComponent('Cartão Partners: Quero falar sobre as ofertas'),
    cssClass: 'btg-header-partners',
  },
  ultrablue: {
    homeHref: '/btg/ultrablue/',
    logoSrc: '/btg/assets/ultrablue/ultrablue_logo.svg',
    logoAlt: 'Cartão Ultrablue BTG Pactual',
    logoClass: 'btg-logo btg-logo--ultrablue',
    nav: NAV_PARTNERS_ULTRABLUE.map((i) =>
      i.href === '/viagens' ? { ...i, href: '/btg/ultrablue/viagens/' }
      : i.href === '/cruzeiros' ? { ...i, href: '/btg/ultrablue/cruzeiros/' }
      : i.href === '/concierge' ? { ...i, href: '/btg/ultrablue/concierge/' }
      : i.href === '/beneficios' ? { ...i, href: '/btg/ultrablue/beneficios/' }
      : i,
    ),
    conciergeUrl:
      'https://wa.me/551148621688?text=' +
      encodeURIComponent('Cartão Ultrablue BTG Pactual: Quero falar sobre as ofertas'),
    cssClass: 'btg-header-ultrablue',
  },
  operadora: {
    homeHref: '/btg/operadora/',
    logoSrc: '/btg/assets/operadora/logo_primetour.png',
    logoAlt: 'Primetour Viagens & Experiências',
    logoClass: 'btg-logo btg-logo--operadora',
    nav: NAV_OPERADORA,
    conciergeUrl:
      'https://wa.me/551148621680?text=' +
      encodeURIComponent('Operadora Primetour: Quero falar sobre as ofertas'),
    cssClass: 'btg-header-operadora',
  },
};

/**
 * Renderiza o header em um container.
 * @param {HTMLElement} container
 * @param {'partners' | 'ultrablue' | 'operadora'} brand
 */
export function renderBtgHeader(container, brand) {
  const cfg = BRAND_CONFIG[brand];
  if (!cfg) {
    console.error('BTG Header: marca invalida', brand);
    return;
  }
  // Substitui placeholders das sub-rotas (ex.: /viagens/feriados → adapta por marca)
  const nav = cfg.nav.map((item) =>
    item.children
      ? {
          ...item,
          children: item.children.map((c) => {
            const path = c.href;
            const base = cfg.homeHref.replace(/\/$/, '');
            const newHref = path.startsWith('/viagens/')
              ? `${base}${path}`
              : c.href;
            return { ...c, href: newHref };
          }),
        }
      : item,
  );

  container.innerHTML = `
    <header class="btg-header ${cfg.cssClass}" data-solid="false">
      <div class="btg-container btg-header__inner">
        <div class="btg-header__left">
          <a href="${cfg.homeHref}" class="btg-header__logo-link">
            <img src="${cfg.logoSrc}" alt="${cfg.logoAlt}" class="${cfg.logoClass}" />
          </a>
          <nav class="btg-header__nav" aria-label="Principal">
            ${nav.map((item) => renderDesktopNavItem(item)).join('')}
          </nav>
        </div>
        <button type="button" class="btg-header__menu-toggle" aria-label="Abrir menu" data-mobile-toggle>
          ${icon('menu', 'icon-lg')}
        </button>
        <a href="${cfg.conciergeUrl}" target="_blank" rel="noopener" class="btg-header__cta">
          Quero falar com meu concierge ${icon('arrow-up-right', 'icon-sm')}
        </a>
      </div>

      <div class="btg-mobile-menu" data-mobile-menu aria-hidden="true">
        <div class="btg-mobile-menu__panel">
          <div class="btg-mobile-menu__head">
            <span class="btg-mobile-menu__label">Menu</span>
            <button type="button" class="btg-mobile-menu__close" aria-label="Fechar menu" data-mobile-close>
              ${icon('x', 'icon-lg')}
            </button>
          </div>
          <nav class="btg-mobile-menu__nav">
            <a href="${cfg.homeHref}" class="btg-mobile-menu__link">Homepage</a>
            ${nav.map((item) => renderMobileNavItem(item)).join('')}
          </nav>
          <a href="${cfg.conciergeUrl}" target="_blank" rel="noopener" class="btg-cta-wp btg-mobile-menu__cta">
            Quero falar com meu concierge ${icon('arrow-up-right', 'icon-sm')}
          </a>
        </div>
      </div>
    </header>
  `;

  wireHeaderInteractivity(container);
}

function renderDesktopNavItem(item) {
  if (!item.children || item.children.length === 0) {
    return `<a href="${item.href}" class="btg-header__nav-link">${item.label}</a>`;
  }
  return `
    <div class="btg-header__nav-group">
      <a href="${item.href}" class="btg-header__nav-link btg-header__nav-link--has-children">
        ${item.label}
        ${icon('chevron-down', 'icon-sm')}
      </a>
      <div class="btg-header__dropdown">
        <ul>
          ${item.children
            .map(
              (sub) =>
                `<li><a href="${sub.href}">${sub.label}</a></li>`,
            )
            .join('')}
        </ul>
      </div>
    </div>
  `;
}

function renderMobileNavItem(item) {
  if (!item.children || item.children.length === 0) {
    return `<a href="${item.href}" class="btg-mobile-menu__link">${item.label}</a>`;
  }
  return `
    <details class="btg-mobile-menu__group">
      <summary class="btg-mobile-menu__link">${item.label} ${icon('chevron-down', 'icon-sm')}</summary>
      <div class="btg-mobile-menu__sub">
        <a href="${item.href}" class="btg-mobile-menu__sublink">Ver hub completo</a>
        ${item.children.map((s) => `<a href="${s.href}" class="btg-mobile-menu__sublink">${s.label}</a>`).join('')}
      </div>
    </details>
  `;
}

function wireHeaderInteractivity(container) {
  const header = container.querySelector('.btg-header');
  const menu = container.querySelector('[data-mobile-menu]');
  const toggle = container.querySelector('[data-mobile-toggle]');
  const close = container.querySelector('[data-mobile-close]');

  // Scroll solid/transparent
  const onScroll = () => {
    header.dataset.solid = window.scrollY > 48 ? 'true' : 'false';
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // Mobile open
  if (toggle && menu && close) {
    const open = () => {
      menu.setAttribute('aria-hidden', 'false');
      menu.classList.add('btg-mobile-menu--open');
      document.body.style.overflow = 'hidden';
    };
    const shut = () => {
      menu.setAttribute('aria-hidden', 'true');
      menu.classList.remove('btg-mobile-menu--open');
      document.body.style.overflow = '';
    };
    toggle.addEventListener('click', open);
    close.addEventListener('click', shut);
    menu.addEventListener('click', (e) => {
      if (e.target === menu) shut();
    });
  }
}
