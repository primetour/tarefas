/**
 * Renderiza a página de detalhe de uma oferta — replica do
 * OfertaDetalhe.tsx do projeto Next (versão "limpa" com hero menor,
 * texto fora da imagem e chips de detalhe sem retângulos cinzas).
 */

import { renderBtgHeader } from './btg-header.js';
import { renderBtgFooter } from './btg-footer.js';
import { createClosingCta } from './btg-components.js';
import { icon } from './btg-icons.js';
import { getOfertaBySlug } from './btg-ofertas-service.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));

/**
 * Carrega oferta dinamicamente do Firestore por slug (passado na URL),
 * normaliza para o formato do renderOfertaDetalhe e renderiza.
 *
 * Uso (na página oferta.html):
 *   import { renderOfertaDetalheDynamic } from '.../btg-oferta-detalhe.js';
 *   renderOfertaDetalheDynamic('partners');  // lê slug do path ?slug=... ou hash
 */
export async function renderOfertaDetalheDynamic(brand) {
  // Extrai slug da URL — aceita ?slug=foo ou #foo ou pathname /oferta/foo.html
  const slug = getSlugFromUrl();
  if (!slug) {
    showError('Link inválido', 'Este link não contém o identificador da oferta.');
    return;
  }

  const oferta = await getOfertaBySlug(slug);
  if (!oferta) {
    showError('Oferta não encontrada', 'Esta oferta pode ter expirado ou ainda não foi publicada.');
    return;
  }

  const whatsapp = (
    brand === 'ultrablue' ? '551148621688' : '551148621680'
  );

  // Normaliza pro formato esperado pelo renderOfertaDetalhe
  const adapted = {
    slug: oferta.slug,
    imagem: oferta.imagem_url || '',
    destino: oferta.destino_rota || '',
    titulo: oferta.nome_da_oferta || '',
    descricao: oferta.descricao || '',
    ofertaEspecial: oferta.oferta_especial || '',
    sobConsulta: !!oferta.preco_sob_consulta,
    precoFormatado: oferta.preco
      ? formatPreco(oferta.preco, oferta.moeda, oferta.parcelamento)
      : '',
    contextoPreco: oferta.contexto_do_preco || '',
    taxas: oferta.taxas || '',
    periodo: oferta.data_de_inicio && oferta.data_final
      ? `${formatDate(oferta.data_de_inicio)} → ${formatDate(oferta.data_final)}`
      : '',
    duracao: oferta.duracao_noites
      ? `${oferta.duracao_noites} ${Number(oferta.duracao_noites) === 1 ? 'noite' : 'noites'}`
      : '',
    acomodacao: oferta.tipo_acomodacao || '',
    hospedes: oferta.configuracao_hospedes || '',
    localEvento: oferta.local_evento || '',
    categoriaIngresso: oferta.categoria_ingresso || '',
    inclui: splitLines(oferta.incluso_no_pacote),
    inclusoesBlocks: Array.isArray(oferta.inclusoes) && oferta.inclusoes.length > 0
      ? oferta.inclusoes
          .map((b) => ({
            subtitulo: b?.subtitulo || '',
            topicos: splitLines(b?.topicos),
            valor: b?.valor || '',
          }))
          .filter((b) => b.subtitulo || b.topicos.length || b.valor)
      : null,
    beneficios: splitLines(oferta.beneficios_marca),
    condicoes: splitLines(oferta.condicoes_observacoes),
  };

  renderOfertaDetalhe({
    brand,
    backHref: `${brand}/`,
    whatsappUrl: `https://wa.me/${whatsapp}?text=` +
      encodeURIComponent(`Olá! Tenho interesse na oferta: ${adapted.titulo}`),
    oferta: adapted,
  });
}

function getSlugFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('slug');
  if (fromQuery) return fromQuery;
  const fromHash = window.location.hash.slice(1);
  if (fromHash) return fromHash;
  // pathname /oferta/foo.html → foo
  const match = window.location.pathname.match(/\/oferta\/([^/]+?)(\.html)?$/);
  return match ? match[1] : '';
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function formatPreco(preco, moeda, parcelamento) {
  const n = Number(String(preco).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return String(preco);
  const moedaLabel = String(moeda).toUpperCase().includes('US') ? 'US$' : moeda || 'R$';
  const locale = moedaLabel === 'US$' ? 'en-US' : 'pt-BR';
  const fmt = n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const p = parseInt(parcelamento ?? '', 10);
  const prefixo = Number.isFinite(p) && p >= 2 ? `${Math.min(p, 10)}x de ` : '';
  return `${prefixo}${moedaLabel} ${fmt}`;
}

function splitLines(s) {
  return String(s || '')
    .split(/[\n;]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function showError(title, msg) {
  const root = document.getElementById('app');
  if (!root) return;
  root.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
      min-height:80vh;padding:40px 24px;text-align:center;gap:16px;color:#6b7280;">
      <span style="font-size:48px;">✈</span>
      <h2 style="font-size:20px;font-weight:600;color:#374151;">${esc(title)}</h2>
      <p style="font-size:14px;max-width:420px;">${esc(msg)}</p>
    </div>
  `;
}

const BRAND_TOKENS = {
  partners: {
    chipBg: '#05132a',
    chipText: '#ffffff',
    accent: '#05132a',
    benefitsBg: '#05132a',
  },
  ultrablue: {
    chipBg: '#10408d',
    chipText: '#ffffff',
    accent: '#0b2859',
    benefitsBg: '#0b2859',
  },
  operadora: {
    chipBg: '#f2b541',
    chipText: '#05132a',
    accent: '#1a2b4a',
    benefitsBg: '#1a2b4a',
  },
};

/**
 * @param {Object} cfg
 * @param {'partners' | 'ultrablue' | 'operadora'} cfg.brand
 * @param {Object} cfg.oferta
 * @param {string} cfg.backHref
 * @param {string} cfg.whatsappUrl
 */
export function renderOfertaDetalhe(cfg) {
  const t = BRAND_TOKENS[cfg.brand];
  const o = cfg.oferta;

  const chips = [];
  if (o.periodo) chips.push({ icon: 'calendar-days', label: 'Período', value: o.periodo });
  if (o.duracao) chips.push({ icon: 'bed-double', label: 'Duração', value: o.duracao });
  if (o.acomodacao) chips.push({ icon: 'bed-double', label: 'Acomodação', value: o.acomodacao });
  if (o.hospedes) chips.push({ icon: 'users', label: 'Para', value: o.hospedes });
  if (o.localEvento) chips.push({ icon: 'map-pin', label: 'Local', value: o.localEvento });
  if (o.categoriaIngresso) chips.push({ icon: 'sparkles', label: 'Ingresso', value: o.categoriaIngresso });

  const root = document.getElementById('app');
  if (!root) return;

  root.innerHTML = `
    <div id="header"></div>

    <article class="oferta-detalhe">
      ${o.imagem ? `
        <header class="oferta-detalhe__hero" style="padding-top:var(--header-offset);">
          <img src="${esc(o.imagem)}" alt="${esc(o.titulo)}" class="oferta-detalhe__hero-img" />
        </header>
      ` : ''}

      <div class="btg-container oferta-detalhe__main">
        <a href="${esc(cfg.backHref)}" class="oferta-detalhe__back">
          ${icon('chevron-left', 'icon-sm')} voltar
        </a>

        <div class="oferta-detalhe__header">
          ${o.destino ? `<p class="oferta-detalhe__destino">${esc(o.destino)}</p>` : ''}
          ${o.ofertaEspecial ? `<span class="oferta-detalhe__badge" style="background:${t.chipBg};color:${t.chipText};">${esc(o.ofertaEspecial)}</span>` : ''}
        </div>

        <h1 class="oferta-detalhe__title" style="color:${t.accent};">${esc(o.titulo)}</h1>

        ${o.descricao ? `<section class="oferta-detalhe__sobre"><p>${esc(o.descricao)}</p></section>` : ''}

        ${chips.length > 0 ? `
          <section class="oferta-detalhe__chips">
            ${chips.map((c) => `
              <div class="oferta-detalhe__chip">
                <span class="oferta-detalhe__chip-icon" style="color:${t.accent};">${icon(c.icon, 'icon-md')}</span>
                <div>
                  <p class="oferta-detalhe__chip-label">${esc(c.label)}</p>
                  <p class="oferta-detalhe__chip-value">${esc(c.value)}</p>
                </div>
              </div>
            `).join('')}
          </section>
        ` : ''}

        <section class="oferta-detalhe__preco">
          ${o.sobConsulta ? `
            <p class="oferta-detalhe__preco-label">Valor</p>
            <p class="oferta-detalhe__preco-valor" style="color:${t.accent};">Consulte valores</p>
            <p class="oferta-detalhe__preco-aux">Fale com o Concierge para receber detalhes da experiência.</p>
          ` : `
            <p class="oferta-detalhe__preco-label">A partir de</p>
            <p class="oferta-detalhe__preco-valor" style="color:${t.accent};">${esc(o.precoFormatado || 'Consulte')}</p>
            ${o.taxas || o.contextoPreco ? `
              <div class="oferta-detalhe__preco-aux">
                ${o.taxas ? `<span>${esc(o.taxas)}</span>` : ''}
                ${o.contextoPreco ? `<span>· ${esc(o.contextoPreco)}</span>` : ''}
              </div>
            ` : ''}
          `}
        </section>

        ${(o.inclusoesBlocks && o.inclusoesBlocks.length) || (o.inclui && o.inclui.length > 0) ? `
          <section class="oferta-detalhe__lista oferta-detalhe__lista--incluso">
            <div class="oferta-detalhe__lista-head">
              ${icon('list-checks', 'icon-md')}
              <h2>Inclui no pacote</h2>
            </div>
            ${o.inclusoesBlocks && o.inclusoesBlocks.length ? `
              ${o.inclusoesBlocks.map((b) => `
                <div class="oferta-detalhe__incluso-block">
                  ${b.subtitulo ? `<p class="oferta-detalhe__incluso-subtitulo" style="color:${t.accent};">${esc(b.subtitulo)}</p>` : ''}
                  ${b.topicos.length ? `<ul>${b.topicos.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
                  ${b.valor ? `<p class="oferta-detalhe__incluso-valor" style="color:${t.accent};">${esc(b.valor)}</p>` : ''}
                </div>
              `).join('')}
            ` : `
              <ul>${o.inclui.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
            `}
          </section>
        ` : ''}

        ${o.beneficios && o.beneficios.length > 0 ? `
          <section class="oferta-detalhe__beneficios" style="background:${t.benefitsBg};">
            <div class="oferta-detalhe__lista-head">
              ${icon('crown', 'icon-md')}
              <p class="btg-eyebrow" style="color:rgba(255,255,255,0.7);">Benefícios exclusivos</p>
            </div>
            <h2 class="oferta-detalhe__beneficios-title">${cfg.brand === 'partners' ? 'Vantagens Partners' : cfg.brand === 'ultrablue' ? 'Vantagens Ultrablue' : 'Vantagens Primetour'}</h2>
            <ul>
              ${o.beneficios.map((b) => `<li>${esc(b)}</li>`).join('')}
            </ul>
          </section>
        ` : ''}

        ${o.condicoes && o.condicoes.length > 0 ? `
          <section class="oferta-detalhe__lista">
            <div class="oferta-detalhe__lista-head">
              ${icon('info', 'icon-md')}
              <h2>Importante saber</h2>
            </div>
            <ul class="oferta-detalhe__lista--condicoes">
              ${o.condicoes.map((c) => `<li>${esc(c)}</li>`).join('')}
            </ul>
          </section>
        ` : ''}

        <section class="oferta-detalhe__cta">
          <h2>Pronto para reservar?</h2>
          <p>Fale com nosso Concierge — atendimento de segunda a domingo, das 8h às 20h.</p>
          <a href="${esc(cfg.whatsappUrl)}" target="_blank" rel="noopener" class="btg-cta-wp" style="background:${t.accent};">
            Quero saber mais sobre esta oferta ${icon('arrow-up-right', 'icon-sm')}
          </a>
        </section>
      </div>
    </article>

    <div id="footer"></div>
  `;

  renderBtgHeader(document.getElementById('header'), cfg.brand);
  renderBtgFooter(document.getElementById('footer'), cfg.brand);
}
