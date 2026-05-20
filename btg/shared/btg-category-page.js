/**
 * Helper para páginas de categoria (Feriados/Destinos/Hospedagem/Aéreo/Cruzeiros).
 * Renderiza: header + category hero + grid de ofertas + closing + footer.
 */

import { renderBtgHeader } from './btg-header.js';
import { renderBtgFooter } from './btg-footer.js';
import {
  createOfertaCard,
  createClosingCta,
  createCategoryHero,
  createTextCategoryHero,
} from './btg-components.js';
import { listOfertas, normalizeForCard } from './btg-ofertas-service.js';

const BRAND_LABEL = {
  partners: 'Partners',
  ultrablue: 'Ultrablue',
  operadora: 'Operadora',
};

/**
 * @param {Object} cfg
 * @param {'partners' | 'ultrablue' | 'operadora'} cfg.brand
 * @param {string} cfg.title
 * @param {string} cfg.description
 * @param {string} cfg.backHref
 * @param {'image' | 'text-only'} [cfg.heroVariant]  Default 'image'. 'text-only' usado em subpages Operadora.
 * @param {string} [cfg.heroImage]      Obrigatório em heroVariant='image'.
 * @param {string} [cfg.heroImageMobile] Obrigatório em heroVariant='image'.
 * @param {string} cfg.closingCtaUrl
 * @param {string} cfg.closingTitle
 * @param {string} [cfg.closingDescription]
 * @param {string} [cfg.closingCtaLabel] Texto do botão do closing CTA.
 * @param {string} [cfg.tipoOferta]  Filtra ofertas por tipo_oferta (ex: 'Feriado')
 * @param {Array<Object>} [cfg.ofertasMock]  Usado se Firestore vazio (fallback visual)
 */
export async function renderCategoryPage(cfg) {
  const root = document.getElementById('app');
  if (!root) return;

  const heroHtml = cfg.heroVariant === 'text-only'
    ? createTextCategoryHero({
        title: cfg.title,
        description: cfg.description,
        backHref: cfg.backHref,
        brand: cfg.brand,
      })
    : createCategoryHero({
        imageSrc: cfg.heroImage,
        imageMobileSrc: cfg.heroImageMobile,
        title: cfg.title,
        description: cfg.description,
        backHref: cfg.backHref,
        brand: cfg.brand,
      });

  const closingHtml = createClosingCta({
    title: cfg.closingTitle,
    description: cfg.closingDescription,
    ctaUrl: cfg.closingCtaUrl,
    ctaLabel: cfg.closingCtaLabel,
    brand: cfg.brand,
  });

  // Skeleton primeiro (não bloqueia render)
  root.innerHTML = `
    <div id="header"></div>
    ${heroHtml}
    <section class="category-grid-section">
      <div class="btg-container">
        <div class="ofertas-grid" id="ofertas-grid">
          <p class="category-empty">Carregando ofertas…</p>
        </div>
      </div>
    </section>
    ${closingHtml}
    <div id="footer"></div>
  `;

  renderBtgHeader(document.getElementById('header'), cfg.brand);
  renderBtgFooter(document.getElementById('footer'), cfg.brand);

  // Carrega ofertas do Firestore (ou local fallback)
  const filters = {
    tipo_cartao: BRAND_LABEL[cfg.brand],
  };
  if (cfg.tipoOferta) filters.tipo_oferta = cfg.tipoOferta;

  let ofertas = [];
  try {
    const fromFs = await listOfertas(filters);
    ofertas = fromFs.map(normalizeForCard);
  } catch (err) {
    console.error('[btg-lab] erro ao carregar ofertas:', err);
  }

  // Fallback visual (mock) se Firestore retornou vazio
  if (ofertas.length === 0 && Array.isArray(cfg.ofertasMock) && cfg.ofertasMock.length > 0) {
    ofertas = cfg.ofertasMock;
  }

  const grid = document.getElementById('ofertas-grid');
  grid.innerHTML =
    ofertas.length > 0
      ? ofertas.map((o) => createOfertaCard(o, cfg.brand)).join('')
      : '<p class="category-empty">Em breve, novas ofertas exclusivas nesta categoria.</p>';
}
