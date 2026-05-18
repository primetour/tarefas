/**
 * Painel de prévia ao vivo — replica vanilla do LivePreviewPanel.tsx.
 * Tabs Card / Página, highlight do slot ativo.
 */

const TIPO_META = {
  Feriado: { label: 'Feriado', primary: '#d4a017' },
  Destino: { label: 'Destino', primary: '#7c3aed' },
  Cruzeiro: { label: 'Cruzeiro', primary: '#0c4a6e' },
  Hospedagem: { label: 'Hospedagem', primary: '#15803d' },
  'Aéreo & Transfers': { label: 'Aéreo & Transfers', primary: '#1d4ed8' },
  Concierge: { label: 'Concierge', primary: '#1f2937' },
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));

const PRECO_PARC = (p) => {
  const n = parseInt(p ?? '', 10);
  if (!Number.isFinite(n) || n < 2) return '';
  return `${Math.min(n, 10)}x de `;
};

function moedaLabel(m) {
  const s = String(m ?? '').toUpperCase();
  if (s.includes('US') || s === '$') return 'US$';
  if (s.includes('EUR') || s === '€') return 'EUR';
  return 'R$';
}

function fmt(v, m) {
  if (!v) return '';
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(moedaLabel(m) === 'US$' ? 'en-US' : 'pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

const PH = (txt) => `<span class="lp-ph">${esc(txt)}</span>`;

/**
 * @param {HTMLElement} container
 * @param {Object} state  { tipo, values, mode, activeTargets, imageUrl }
 */
export function renderLivePreview(container, state) {
  const meta = TIPO_META[state.tipo] || TIPO_META.Feriado;
  const v = state.values;

  const moeda = moedaLabel(v.moeda);
  const precoFmt = v.preco ? `${PRECO_PARC(v.parcelamento)}${moeda} ${fmt(v.preco, v.moeda)}` : null;

  const isActive = (t) => (state.activeTargets || []).includes(t);
  const slot = (target, content) => `
    <div class="lp-slot${isActive(target) ? ' is-active' : ''}" data-target="${target}">
      ${content}
    </div>
  `;

  container.innerHTML = `
    <div class="live-preview">
      <div class="live-preview__head">
        <p class="live-preview__title">Prévia ao vivo</p>
        ${slot('marca', `<span style="color:${meta.primary};font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;">${meta.label}</span>`)}
      </div>

      <div class="live-preview__tabs">
        ${['card', 'page'].map((m) => `
          <button type="button" class="live-preview__tab${state.mode === m ? ' is-active' : ''}" data-mode="${m}">
            ${m === 'card' ? 'Card' : 'Página'}
          </button>
        `).join('')}
      </div>

      ${state.mode === 'card' ? renderCard(v, slot, state.imageUrl, meta) : renderPage(v, slot, state.imageUrl, meta)}
    </div>
  `;

  container.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dispatchEvent(new CustomEvent('change-mode', { detail: btn.dataset.mode, bubbles: true }));
    });
  });
}

function renderCard(v, slot, imageUrl, meta) {
  const sobConsulta = v.preco_sob_consulta;
  return `
    <div class="lp-card">
      ${slot('imagem', `
        <div class="lp-card__img">
          ${imageUrl ? `<img src="${esc(imageUrl)}" alt="" />` : `<div class="lp-card__img-empty">${PH('[ Imagem principal ]')}</div>`}
          ${v.oferta_especial ? `<span class="lp-card__badge" style="background:${meta.primary};">${slot('selo', esc(v.oferta_especial))}</span>` : ''}
        </div>
      `)}
      <div class="lp-card__body">
        ${slot('destino', `<p class="lp-card__destino">${v.destino_rota ? esc(v.destino_rota) : PH('[Destino]')}</p>`)}
        ${slot('nome', `<h2 class="lp-card__title">${v.nome_da_oferta ? esc(v.nome_da_oferta) : PH('[Nome da oferta]')}</h2>`)}
        ${slot('descricao', `<p class="lp-card__desc">${v.descricao ? esc(v.descricao) : PH('[Descrição curta]')}</p>`)}
        ${slot('preco', `
          <div>
            <p class="lp-card__partir">A partir de</p>
            <p class="lp-card__preco">${
              sobConsulta ? 'Consulte valores'
              : v.preco ? `${PRECO_PARC(v.parcelamento)}${moedaLabel(v.moeda)} ${fmt(v.preco, v.moeda)}`
              : PH('[R$ 0,00]')
            }</p>
          </div>
        `)}
        <div class="lp-card__btn">Saiba mais</div>
      </div>
    </div>
  `;
}

function renderPage(v, slot, imageUrl, meta) {
  const sobConsulta = v.preco_sob_consulta;
  const dateRange = [fmtDate(v.data_de_inicio), fmtDate(v.data_final)].filter(Boolean).join(' → ');
  const inclui = (v.incluso_no_pacote || '').split(/[\n;]/).map((s) => s.trim()).filter(Boolean);
  const benef = (v.beneficios_marca || '').split(/[\n;]/).map((s) => s.trim()).filter(Boolean);
  const cond = (v.condicoes_observacoes || '').split(/[\n;]/).map((s) => s.trim()).filter(Boolean);

  const chip = (target, label, value, ph) =>
    (value || (state => state)).length || target ? slot(target, `
      <div class="lp-page__chip">
        <span class="lp-page__chip-label">${label}</span>
        <span class="lp-page__chip-value">${value ? esc(value) : PH(ph)}</span>
      </div>
    `) : '';

  return `
    <div class="lp-page">
      <div class="lp-page__head">
        ${slot('imagem', `
          <div class="lp-page__img">
            ${imageUrl ? `<img src="${esc(imageUrl)}" alt="" />` : `<div class="lp-page__img-empty">${PH('[ Hero ]')}</div>`}
          </div>
        `)}
        <div class="lp-page__head-text">
          ${slot('destino', `<p class="lp-page__destino">${v.destino_rota ? esc(v.destino_rota) : PH('[Destino]')}</p>`)}
          ${slot('nome', `<h2 class="lp-page__title">${v.nome_da_oferta ? esc(v.nome_da_oferta) : PH('[Nome da oferta]')}</h2>`)}
        </div>
      </div>

      ${slot('descricao', `<p class="lp-page__desc">${v.descricao ? esc(v.descricao) : PH('[Descrição]')}</p>`)}

      <div class="lp-page__chips">
        ${v.nome_feriado ? chip('nome_feriado', 'Feriado', v.nome_feriado, '[Feriado]') : ''}
        ${v.duracao_noites ? chip('duracao', 'Duração', `${v.duracao_noites} noites`, '[Duração]') : ''}
        ${v.tipo_acomodacao ? chip('acomodacao', 'Acomodação', v.tipo_acomodacao, '[Acomodação]') : ''}
        ${v.configuracao_hospedes ? chip('hospedes', 'Hóspedes', v.configuracao_hospedes, '[Hóspedes]') : ''}
        ${v.local_evento ? chip('local_evento', 'Local', v.local_evento, '[Local]') : ''}
        ${v.companhia_aerea ? chip('companhia_aerea', 'Cia. aérea', v.companhia_aerea, '[Cia]') : ''}
        ${v.nome_navio ? chip('nome_navio', 'Navio', v.nome_navio, '[Navio]') : ''}
        ${dateRange ? chip('datas', 'Quando', dateRange, '[Período]') : ''}
      </div>

      ${slot('preco', `
        <div class="lp-page__preco">
          <p class="lp-page__preco-label">A partir de</p>
          <p class="lp-page__preco-valor">${
            sobConsulta ? 'Consulte valores'
            : v.preco ? `${PRECO_PARC(v.parcelamento)}${moedaLabel(v.moeda)} ${fmt(v.preco, v.moeda)}`
            : PH('[R$ 0,00]')
          }</p>
        </div>
      `)}

      ${inclui.length ? slot('incluso', `
        <div class="lp-page__list">
          <p class="lp-page__list-title">Inclui no pacote</p>
          <ul>${inclui.slice(0, 4).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
        </div>
      `) : ''}

      ${benef.length ? slot('beneficios', `
        <div class="lp-page__beneficios" style="background:${meta.primary}10;border-color:${meta.primary}30;">
          <p class="lp-page__list-title" style="color:${meta.primary};">Benefícios exclusivos</p>
          <ul>${benef.slice(0, 4).map((i) => `<li style="color:${meta.primary};">${esc(i)}</li>`).join('')}</ul>
        </div>
      `) : ''}

      ${cond.length ? slot('condicoes', `
        <div class="lp-page__list">
          <p class="lp-page__list-title">Importante saber</p>
          <ul>${cond.slice(0, 3).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
        </div>
      `) : ''}
    </div>
  `;
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
