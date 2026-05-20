/**
 * Componentes compartilhados BTG:
 * - createOfertaCard: equivalente do OfertaCard React
 * - createClosingCta: equivalente do ClosingCta
 * - createParceirosHoteis: equivalente do ParceirosHoteis
 * - createCategoryHero: equivalente do CategoryPageHero
 *
 * Recebem dados puros e retornam strings de HTML.
 */

import { icon } from './btg-icons.js';

const BADGE_PER_BRAND = {
  partners: { bg: '#05132a', text: '#ffffff' },
  ultrablue: { bg: '#10408d', text: '#ffffff' },
  operadora: { bg: '#f2b541', text: '#05132a' },
};

const PARCELAS_LABEL = (p) => {
  const n = Number.parseInt(p ?? '', 10);
  if (!Number.isFinite(n) || n < 2) return '';
  return `${Math.min(n, 10)}x de `;
};

function formatMoeda(raw) {
  const s = String(raw ?? '').trim().toUpperCase();
  if (s.includes('US') || s === '$') return 'US$';
  if (s.includes('EUR') || s === '€') return 'EUR';
  return 'R$';
}

function formatPreco(valor, moeda) {
  if (!valor) return '';
  const n = Number(String(valor).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return String(valor);
  const isUSD = moeda === 'US$' || formatMoeda(moeda) === 'US$';
  const locale = isUSD ? 'en-US' : 'pt-BR';
  return n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));

/**
 * Card de oferta (universal entre marcas).
 *
 * @param {Object} oferta
 * @param {string} oferta.id
 * @param {string} oferta.slug
 * @param {string} oferta.imagem  URL da imagem
 * @param {string} oferta.destino
 * @param {string} oferta.titulo
 * @param {string} oferta.descricao
 * @param {string|number} [oferta.preco]
 * @param {string} [oferta.moeda]
 * @param {string|number} [oferta.parcelamento]
 * @param {string} [oferta.contextoPreco]
 * @param {string} [oferta.ofertaEspecial]  selo (badge)
 * @param {boolean} [oferta.sobConsulta]
 * @param {'partners' | 'ultrablue' | 'operadora'} brand
 */
export function createOfertaCard(oferta, brand) {
  const badge = BADGE_PER_BRAND[brand] ?? BADGE_PER_BRAND.partners;
  const moedaLabel = formatMoeda(oferta.moeda);
  const precoFmt = oferta.preco ? formatPreco(oferta.preco, oferta.moeda) : '';
  const precoStr = oferta.preco
    ? `${PARCELAS_LABEL(oferta.parcelamento)}${moedaLabel} ${precoFmt}`
    : 'Consulte';
  const detalheHref = `/btg/${brand}/oferta.html?slug=${esc(oferta.slug)}`;

  return `
    <article class="oferta-card">
      <div class="oferta-card__img" style="background-image:url('${esc(oferta.imagem)}');">
        ${
          oferta.ofertaEspecial
            ? `<span class="oferta-card__badge" style="background:${badge.bg};color:${badge.text};">${esc(oferta.ofertaEspecial)}</span>`
            : ''
        }
      </div>
      <div class="oferta-card__body">
        ${oferta.destino ? `<p class="oferta-card__destino">${esc(oferta.destino)}</p>` : ''}
        <h2 class="oferta-card__title">${esc(oferta.titulo)}</h2>
        ${oferta.descricao ? `<p class="oferta-card__desc">${esc(oferta.descricao)}</p>` : ''}
        <div>
          ${
            oferta.sobConsulta
              ? `<p class="oferta-card__preco" style="font-size:20px;">Consulte valores</p>`
              : `
                <p class="oferta-card__partir">A partir de</p>
                <p class="oferta-card__preco">${esc(precoStr)}</p>
                ${oferta.contextoPreco ? `<p class="oferta-card__preco-ctx">${esc(oferta.contextoPreco)}</p>` : ''}
              `
          }
        </div>
        <div class="oferta-card__cta">
          <a href="${detalheHref}" class="oferta-card__btn">
            Saiba mais ${icon('arrow-right', 'icon-sm')}
          </a>
        </div>
      </div>
    </article>
  `;
}

/**
 * Closing CTA — bloco final antes do footer.
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string} [opts.description]
 * @param {string} opts.ctaUrl
 * @param {string} [opts.ctaLabel]  Texto do botão. Default: "Quero falar com meu concierge".
 * @param {'partners' | 'ultrablue' | 'operadora'} opts.brand
 */
export function createClosingCta({ title, description, ctaUrl, ctaLabel, brand }) {
  const bgPerBrand = {
    partners: '#05132a',
    ultrablue: '#0b2859',
    operadora: '#1a2b4a',
  };
  const label = ctaLabel || 'Quero falar com meu concierge';
  return `
    <section class="btg-closing-cta" style="background:${bgPerBrand[brand] ?? bgPerBrand.partners};">
      <div class="btg-container btg-closing-cta__inner">
        <div>
          <h2 class="btg-closing-cta__title">${esc(title)}</h2>
          ${description ? `<p class="btg-closing-cta__desc">${esc(description)}</p>` : ''}
        </div>
        <a href="${esc(ctaUrl)}" target="_blank" rel="noopener noreferrer" class="btg-cta-wp">
          ${esc(label)} ${icon('arrow-up-right', 'icon-sm')}
        </a>
      </div>
    </section>
  `;
}

/**
 * Hero de categoria — equivalente do CategoryPageHero React.
 * Imagem grande + overlay + voltar + título + descrição.
 *
 * @param {Object} o
 * @param {string} o.imageSrc
 * @param {string} o.imageMobileSrc
 * @param {string} o.title
 * @param {string} [o.description]
 * @param {string} o.backHref
 * @param {'partners' | 'ultrablue' | 'operadora'} o.brand
 */
export function createCategoryHero({ imageSrc, imageMobileSrc, title, description, backHref, brand }) {
  return `
    <section class="btg-category-hero btg-category-hero--desktop" data-brand="${brand}">
      <img src="${esc(imageSrc)}" alt="${esc(title)}" class="btg-category-hero__img" />
      <div class="btg-category-hero__overlay"></div>
      <div class="btg-container btg-category-hero__content">
        <a href="${esc(backHref)}" class="btg-category-hero__back">
          ${icon('chevron-left', 'icon-sm')} voltar
        </a>
        <h1 class="btg-category-hero__title">${esc(title)}</h1>
        ${description ? `<p class="btg-category-hero__desc">${esc(description)}</p>` : ''}
      </div>
    </section>

    <section class="btg-category-hero btg-category-hero--mobile" data-brand="${brand}">
      <div class="btg-category-hero__mobile-wrap">
        <img src="${esc(imageMobileSrc)}" alt="${esc(title)}" class="btg-category-hero__img" />
        <div class="btg-category-hero__overlay"></div>
        <div class="btg-category-hero__content-mobile">
          <a href="${esc(backHref)}" class="btg-category-hero__back">
            ${icon('chevron-left', 'icon-sm')} voltar
          </a>
          <h1 class="btg-category-hero__title">${esc(title)}</h1>
          ${description ? `<p class="btg-category-hero__desc">${esc(description)}</p>` : ''}
        </div>
      </div>
    </section>
  `;
}

/**
 * Parceiros Hotéis — grid de 6 hotéis com overlay e nome.
 * Equivalente do ParceirosHoteis React.
 *
 * @param {Object} o
 * @param {string} o.title
 * @param {string} [o.tagline]
 * @param {Array<{rede:string, nome:string, imagem:string}>} o.hoteis
 * @param {'partners' | 'ultrablue' | 'operadora'} o.brand
 */
export function createParceirosHoteis({ title, tagline, hoteis, brand }) {
  const bgClass =
    brand === 'ultrablue' ? 'rgba(11,40,89,0.85)' : 'rgba(5,19,42,0.85)';
  return `
    <section class="btg-parceiros">
      <div class="btg-container">
        <h2 class="btg-parceiros__title">${esc(title)}</h2>
        ${tagline ? `<p class="btg-parceiros__tag">${esc(tagline)}</p>` : ''}
        <div class="btg-parceiros__grid">
          ${hoteis
            .map(
              (h) => `
            <article class="btg-parceiro-card">
              <img src="${esc(h.imagem)}" alt="${esc(h.rede)} — ${esc(h.nome)}" loading="lazy" />
              <div class="btg-parceiro-card__overlay" style="background:linear-gradient(to top, ${bgClass} 0%, rgba(0,0,0,0.35) 50%, transparent 100%);"></div>
              <div class="btg-parceiro-card__content">
                <p class="btg-parceiro-card__rede">${esc(h.rede)}</p>
                <p class="btg-parceiro-card__nome">${esc(h.nome)}</p>
              </div>
            </article>`,
            )
            .join('')}
        </div>
      </div>
    </section>
  `;
}
