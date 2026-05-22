/**
 * Catálogo de blocos REAIS dos sites BTG — cada bloco renderiza o markup
 * e as classes CSS de verdade das seções no ar. É a fonte única usada
 * pelo construtor de páginas (btg-site-builder) e, no cutover, pelas
 * próprias páginas dos sites.
 *
 * Cada render recebe (data, brand) e devolve o HTML real da seção.
 * O preview do editor roda num iframe que carrega o CSS real dos sites,
 * então o bloco aparece idêntico ao site publicado.
 */

import { createOfertaCard, createClosingCta } from './btg-components.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

const lines = (s) => String(s ?? '').split(/\n+/).map((x) => x.trim()).filter(Boolean);

/* Mock de ofertas pro preview do bloco "Grid de ofertas". */
const MOCK_OFERTAS = [
  { id: 'm1', slug: '#', imagem: 'assets/parceiros/four-seasons-george-v.jpg', destino: 'Paris', titulo: 'Four Seasons George V', descricao: 'Hospedagem icônica no coração de Paris.', preco: '8900', moeda: 'R$', parcelamento: '10', contextoPreco: 'Por pessoa', ofertaEspecial: 'EXCLUSIVO' },
  { id: 'm2', slug: '#', imagem: 'assets/parceiros/amanyangyun-shanghai.jpg', destino: 'Shanghai', titulo: 'Amanyangyun', descricao: 'Retiro de luxo entre árvores centenárias.', preco: '12400', moeda: 'R$', parcelamento: '10', contextoPreco: 'Por pessoa' },
  { id: 'm3', slug: '#', imagem: 'assets/parceiros/mandarin-oriental-bangkok.jpg', destino: 'Bangkok', titulo: 'Mandarin Oriental', descricao: 'Hospitalidade lendária à beira do rio.', preco: '6200', moeda: 'R$', parcelamento: '10', contextoPreco: 'Por pessoa' },
  { id: 'm4', slug: '#', imagem: 'assets/parceiros/st-regis-maldives.jpg', destino: 'Maldivas', titulo: 'The St. Regis Maldives', descricao: 'Vilas sobre as águas cristalinas.', sobConsulta: true, ofertaEspecial: 'ALL-INCLUSIVE' },
];

/* ─── Renders fiéis por tipo de bloco ─────────────────────── */

function renderHero(d, brand) {
  if (brand === 'operadora') {
    const bg = d.imagem
      ? `<img src="${esc(d.imagem)}" alt="" class="operadora-hero__video" />`
      : '';
    return `
      <section class="operadora-hero">
        ${bg}
        <div class="operadora-hero__overlay"></div>
        <div class="operadora-hero__inner btg-container">
          <h1 class="operadora-hero__title">${esc(d.titulo || '')}</h1>
          <p class="operadora-hero__subtitle">${esc(d.subtitulo || '')}</p>
        </div>
      </section>`;
  }
  // Partners / Ultrablue — hero de imagem
  const img = d.imagem
    ? `<img src="${esc(d.imagem)}" alt="" class="${brand}-hero__img" />`
    : '';
  // Só Partners tem a faixa de overlay escurecida sobre a imagem.
  const overlay = brand === 'partners' ? '<div class="partners-hero__overlay"></div>' : '';
  return `
    <section class="${brand}-hero ${brand}-hero--desktop">
      ${img}
      ${overlay}
      <div class="btg-container ${brand}-hero__inner">
        <div>
          ${d.eyebrow ? `<p class="${brand}-hero__eyebrow">${esc(d.eyebrow)}</p>` : ''}
          <h1 class="${brand}-hero__title">${esc(d.titulo || '')}</h1>
          ${d.subtitulo ? `<p class="${brand}-hero__desc">${esc(d.subtitulo)}</p>` : ''}
        </div>
      </div>
    </section>`;
}

function renderIntro(d, brand) {
  const ps = lines(d.texto).map((p) => `<p>${esc(p)}</p>`).join('');
  return `
    <section class="${brand}-intro">
      <div class="btg-container ${brand}-intro__inner">
        <h2 class="${brand}-intro__title">${esc(d.titulo || '')}</h2>
        <div class="${brand}-intro__body">${ps}</div>
        ${d.experiencias ? `<h3 class="${brand}-intro__experiencias">${esc(d.experiencias)}</h3>` : ''}
      </div>
    </section>`;
}

function renderOfertas(d, brand) {
  const cards = MOCK_OFERTAS.map((o) => createOfertaCard(o, brand)).join('');
  return `
    <section class="${brand}-curated">
      <div class="btg-container">
        <h2 class="${brand}-curated__title">${esc(d.titulo || 'Ofertas em destaque')}</h2>
        <div class="ofertas-grid">${cards}</div>
      </div>
    </section>`;
}

function renderCategorias(d, brand) {
  // Padrão Operadora: 2 colunas, cada uma com banner + lista de links.
  const cols = lines(d.itens);
  const half = Math.ceil(cols.length / 2);
  const col = (items) => `
    <div class="operadora-cat-col">
      <div class="operadora-cat-links">
        ${items.map((i) => `<a href="#" class="operadora-cat-link"><span>${esc(i)}</span><span aria-hidden="true">→</span></a>`).join('')}
      </div>
    </div>`;
  return `
    <section class="operadora-categorias">
      <div class="btg-container">
        ${d.titulo ? `<h2 class="operadora-curated__title">${esc(d.titulo)}</h2>` : ''}
        <div class="operadora-categorias__grid">
          ${col(cols.slice(0, half))}
          ${col(cols.slice(half))}
        </div>
      </div>
    </section>`;
}

function renderVantagens(d, brand) {
  // Operadora não tem seção "why" no ar — usa o estilo Partners no builder.
  const b = brand === 'operadora' ? 'partners' : brand;
  const feats = lines(d.itens).map((t) => `
    <li class="${b}-why__feature">
      <span class="${b}-why__feature-icon"></span>
      <div><h3>${esc(t)}</h3></div>
    </li>`).join('');
  const media = d.imagem
    ? `<div class="${b}-why__media"><img src="${esc(d.imagem)}" alt="" loading="lazy" /></div>`
    : '';
  return `
    <section class="${b}-why">
      <div class="btg-container">
        <h2 class="${b}-why__title">${esc(d.titulo || '')}</h2>
        ${d.subtitulo ? `<p class="${b}-why__subtitle">${esc(d.subtitulo)}</p>` : ''}
        <div class="${b}-why__layout">
          ${media}
          <ul class="${b}-why__features">${feats}</ul>
        </div>
      </div>
    </section>`;
}

function renderClosing(d, brand) {
  return createClosingCta({
    title: d.titulo || '',
    description: d.descricao || '',
    ctaUrl: '#',
    ctaLabel: d.botao || undefined,
    brand,
  });
}

function renderRodape(d, brand) {
  const bg = brand === 'operadora' ? '#1a2b4a' : brand === 'ultrablue' ? '#0b2859' : '#05132a';
  return `
    <footer class="btg-footer" style="background:${bg};padding:32px 20px;text-align:center;">
      <p style="font-size:14px;line-height:1.5;color:rgba(255,255,255,0.6);">${esc(d.texto || '')}</p>
    </footer>`;
}

const RENDERERS = {
  hero: renderHero,
  intro: renderIntro,
  ofertas: renderOfertas,
  categorias: renderCategorias,
  vantagens: renderVantagens,
  closing: renderClosing,
  rodape: renderRodape,
};

/**
 * Renderiza um bloco com o markup real da seção.
 * @param {string} type
 * @param {Object} data
 * @param {'operadora'|'partners'|'ultrablue'} brand
 */
export function renderBlock(type, data, brand) {
  const fn = RENDERERS[type];
  if (!fn) return `<div style="padding:24px;color:#999;">Bloco desconhecido: ${esc(type)}</div>`;
  return fn(data || {}, brand || 'partners');
}

/**
 * CSS real dos sites a carregar no iframe do preview — assim o bloco
 * renderiza idêntico ao site publicado.
 */
export const SITE_CSS = [
  'shared/btg-base.css',
  'shared/btg-header.css',
  'shared/btg-footer.css',
  'shared/btg-components.css',
  'operadora/operadora.css',
  'partners/partners.css',
  'ultrablue/ultrablue.css',
];
