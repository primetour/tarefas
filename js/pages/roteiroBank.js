/**
 * PRIMETOUR — Banco de Roteiros: Listagem (v4.50.0+)
 *
 * Listagem de roteiros curados da empresa. Sidebar item próprio
 * (`#banco-roteiros`). Lê de `roteiros_bank` (CRUD em services/roteiroBank.js).
 *
 * Layout: cards (não tabela) — cada roteiro tem foto de capa + cidades + dias.
 * Filtros padrão: status, continente, busca.
 *
 * Permissão: read pra qualquer autenticado, write pra canManageDestinations.
 */

import { store } from '../store.js';
import { toast } from '../components/toast.js';
import { renderPageHeader, renderFilterBar } from '../components/uiKit.js';
import { fetchRoteiroBankList, archiveRoteiroBank, duplicateRoteiroBank, isExpired, ensureBankHero } from '../services/roteiroBank.js';
import { continentLabel } from '../data/continents.js';
import { generateRoteiroBankPDF } from '../services/roteiroBankGenerator.js';
import { actionIcon } from '../components/uiKit.js';

const esc = s => s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '';

// v4.59.5: page size do lazy render. 50 = render rápido inicial,
// IntersectionObserver carrega +50 quando user chega no fim da grade.
const PAGE_SIZE = 50;

let state = {
  list: [],
  loading: false,
  // v4.62.11: re-adicionado `continent` no filter. Removido em v4.58.2 quando
  // Envision não trazia continente, mas pós v4.62.0 todos os roteiros ancorados
  // (184/236) têm `geo.continents[]` populado pelo SSOT. Cascata com país:
  // selecionar continente restringe países disponíveis no select.
  filter: { search: '', status: '', continent: '', country: '', collection: '', sort: 'recent' },
  renderedCount: PAGE_SIZE,    // v4.59.5: lazy render incremental
  abortCtrl: null,          // v4.50.10+ AbortController dos listeners delegados
  heroResolveDone: new Set(), // v4.59.1: evita re-fetch após primeira falha (paralelo)
  scrollObserver: null,        // v4.59.5: IntersectionObserver pro sentinel
};

function canEdit() {
  return store.isMaster?.()
      || store.can?.('portal_destinations_manage')
      || store.can?.('portal_manage');
}

// v4.59.8 (CLAUDE.md §11.l): hex hardcoded → CSS vars semânticas.
// Mantém label/bg/fg como dicionário pra reaproveitar e dark-mode-safe.
function statusBadge(status) {
  const map = {
    draft:    { label: 'Rascunho',  bg: 'var(--badge-muted-bg,rgba(107,114,128,0.12))', color: 'var(--text-secondary,#374151)' },
    review:   { label: 'Revisão',   bg: 'var(--badge-warn-bg,rgba(245,158,11,0.16))',   color: 'var(--color-warn-text,#92400e)' },
    approved: { label: 'Publicado', bg: 'var(--badge-success-bg,rgba(16,185,129,0.16))', color: 'var(--color-success-text,#065f46)' },
    archived: { label: 'Arquivado', bg: 'var(--badge-danger-bg,rgba(220,38,38,0.12))',  color: 'var(--color-danger-text,#991b1b)' },
  };
  const it = map[status] || map.draft;
  return `<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;
    font-size:0.72rem;font-weight:600;background:${it.bg};color:${it.color};">${it.label}</span>`;
}

function expiredBadge(doc) {
  if (!isExpired(doc)) return '';
  return `<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;
    font-size:0.72rem;font-weight:600;background:var(--badge-danger-bg,rgba(220,38,38,0.16));color:var(--color-danger-text,#991b1b);margin-left:6px;"
    title="Validade expirou em ${esc(doc.validity?.endDate || '')} — revisar">⚠ Expirado</span>`;
}

/** v4.62.1: badge "Sem âncora geo" — Envision não trouxe country/cidade
 *  resolvível. Master precisa abrir Corrigir geo (botão na linha de ações). */
function noGeoBadge(doc) {
  const hasDestIds = Array.isArray(doc.geo?.destinationIds) && doc.geo.destinationIds.length > 0;
  const hasCountries = Array.isArray(doc.geo?.countries) && doc.geo.countries.length > 0;
  if (hasDestIds && hasCountries) return '';
  const missing = !hasCountries ? 'país' : 'destinations';
  return `<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;
    font-size:0.72rem;font-weight:600;background:var(--badge-warn-bg,rgba(245,158,11,0.16));color:var(--color-warn-text,#92400e);margin-left:6px;"
    title="Sem ${missing} resolvido (Envision não trouxe). Use 🌍 Corrigir geo pra atribuir manualmente.">⚠ Sem geo</span>`;
}

// v4.59.8 (CLAUDE.md §11.m): emoji → SVG inline (Heroicons style 16px, stroke 1.75).
// Acessível + consistente em qualquer SO/fonte.
const ICONS = {
  pin:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>',
  clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
  bed:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M2 4v16M22 12v8M2 12h20M6 12V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4"></path><circle cx="7" cy="10" r="1"></circle></svg>',
  calStart: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>',
  calEnd: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 8 14"></polyline></svg>',
};

function cardHTML(d) {
  const hero = d.images?.hero || '';
  // v4.59.8: placeholder usa --bg-surface (dark-mode safe) em vez de gradient hardcoded
  const placeholder = !hero
    ? `<div style="width:100%;height:160px;background:var(--bg-surface);border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.8rem;">
        sem imagem
      </div>`
    : `<div style="width:100%;height:160px;background-image:url('${esc(hero)}');background-size:cover;background-position:center;background-color:var(--bg-surface);"></div>`;

  const cities = (d.geo?.cities || []).map(c => c.city).filter(Boolean);
  const citiesText = cities.length > 4
    ? `${cities.slice(0, 3).join(' · ')} +${cities.length - 3}`
    : cities.join(' · ');
  const countries = (d.geo?.countries || []).slice(0, 3).join(', ');

  const days = d.durationDays || (d.days?.length || 0);
  const nights = d.durationNights || cities.reduce((acc, _, i) => acc + (d.geo.cities[i]?.nights || 0), 0);

  const cats = (d.categories || []).length;

  // v4.50.7+ Validade do roteiro (start + end) — campos do schema definidos
  // pelo curador. NÃO confundir com data de criação do doc no sistema.
  // v4.50.8 (Renê): "vc tem que respeitar os campos 'validade início' e
  // 'validade fim' nessa tarefa, e nao qdo o roteiro foi criado no sistema".
  const fmtDateBr = (val) => {
    if (!val) return '';
    try {
      // v4.50.9+ Bug timezone: `new Date("2020-01-01")` é UTC midnight, em
      // UTC-3 (Brasília) renderiza como 31/12/2019 21:00. Pra string ISO
      // YYYY-MM-DD (campo de validade), parse manual em timezone local.
      if (typeof val === 'string') {
        const m = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) {
          const [_, y, mo, d] = m;
          return `${d}/${mo}/${y}`;
        }
      }
      // Firestore Timestamp ou outros formatos
      const dt = val?.toDate ? val.toDate() : new Date(val);
      if (isNaN(dt.getTime())) return '';
      return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return ''; }
  };
  const startTxt   = d.validity?.startDate ? fmtDateBr(d.validity.startDate) : 'Indefinida';
  const endTxt     = d.validity?.endDate   ? fmtDateBr(d.validity.endDate)   : 'Indefinida';
  const startIndef = !d.validity?.startDate;
  const endIndef   = !d.validity?.endDate;
  const meta = `
    <div style="display:flex;gap:14px;color:var(--text-muted);font-size:0.72rem;flex-wrap:wrap;">
      <span title="Validade início" style="${startIndef ? 'font-style:italic;' : ''}">${ICONS.calStart} Início: <strong style="color:${startIndef ? 'var(--text-muted)' : 'var(--text-secondary)'};">${esc(startTxt)}</strong></span>
      <span title="Validade fim"    style="${endIndef ? 'font-style:italic;' : ''}">${ICONS.calEnd} Fim: <strong style="color:${endIndef ? 'var(--text-muted)' : 'var(--text-secondary)'};">${esc(endTxt)}</strong></span>
    </div>`;

  return `
    <div class="rb-card" data-id="${esc(d.id)}" style="background:var(--bg-card);
      border:1px solid var(--border-subtle);border-radius:12px;overflow:hidden;
      cursor:pointer;transition:all 0.15s;display:flex;flex-direction:column;">
      ${placeholder}
      <div style="padding:14px 16px 12px;flex:1;display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          ${statusBadge(d.status)}
          ${expiredBadge(d)}
          ${noGeoBadge(d)}
          ${d.collectionLabel ? `<span style="color:var(--brand-gold,#D4A843);font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">${esc(d.collectionLabel)}</span>` : ''}
        </div>
        <h3 style="margin:0;font-size:1rem;font-weight:700;color:var(--text-primary);line-height:1.3;">
          ${esc(d.title || '(sem título)')}
        </h3>
        <div style="color:var(--text-secondary);font-size:0.82rem;line-height:1.4;">
          ${esc(d.shortDescription?.slice(0, 140) || '')}${d.shortDescription?.length > 140 ? '…' : ''}
        </div>
        <div style="display:flex;gap:12px;align-items:center;color:var(--text-muted);font-size:0.78rem;margin-top:auto;padding-top:8px;border-top:1px solid var(--border-subtle);">
          <span title="Cidades">${ICONS.pin} ${cities.length}</span>
          <span title="Duração total">${ICONS.clock} ${days}d / ${nights}n</span>
          <span title="Categorias de hospedagem">${ICONS.bed} ${cats}</span>
        </div>
        <div style="color:var(--text-muted);font-size:0.78rem;">${esc(citiesText)}</div>
        ${meta}
        <div class="rb-actions" style="display:flex;gap:4px;justify-content:flex-end;margin-top:6px;border-top:1px solid var(--border-subtle);padding-top:8px;">
          <button class="btn-icon-action" data-action="export-pdf" data-id="${esc(d.id)}" title="Exportar PDF"
            style="padding:6px;background:transparent;border:1px solid var(--border-subtle);border-radius:6px;cursor:pointer;color:var(--text-secondary);">
            ${actionIcon('download')}
          </button>
          ${canEdit() ? `
          ${(!(d.geo?.destinationIds?.length) || !(d.geo?.countries?.length)) ? `
          <button class="btn-icon-action" data-action="fix-geo" data-id="${esc(d.id)}" title="🌍 Corrigir geo (atribuir país + cidades pra vincular cross-module)"
            style="padding:6px;background:var(--badge-warn-bg,rgba(245,158,11,0.12));border:1px solid var(--color-warn-text,#92400e);border-radius:6px;cursor:pointer;color:var(--color-warn-text,#92400e);font-size:0.78rem;font-weight:600;">
            🌍
          </button>` : ''}
          <button class="btn-icon-action" data-action="duplicate" data-id="${esc(d.id)}" title="Duplicar"
            style="padding:6px;background:transparent;border:1px solid var(--border-subtle);border-radius:6px;cursor:pointer;color:var(--text-secondary);">
            ${actionIcon('duplicate')}
          </button>
          ${d.status !== 'archived' ? `
          <button class="btn-icon-action" data-action="archive" data-id="${esc(d.id)}" title="Arquivar"
            style="padding:6px;background:transparent;border:1px solid var(--border-subtle);border-radius:6px;cursor:pointer;color:var(--text-secondary);">
            ${actionIcon('archive')}
          </button>` : ''}
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

/**
 * v4.62.11: Continentes disponíveis — usa geo.continentCodes (populado pelo SSOT)
 * porque geo.continents está [] em todos os 236 docs (gap de migration —
 * adapter Envision popula só continentCodes). Label vem de continentLabel(code).
 * value = code (AF/AS/EU/NA/SA/OC/AN), label = nome pt-BR.
 */
function continentOptions() {
  const set = new Set();
  for (const d of state.list || []) {
    (d.geo?.continentCodes || []).forEach(c => c && set.add(c));
  }
  const sorted = [...set].sort((a,b) =>
    (continentLabel(a) || a).localeCompare(continentLabel(b) || b, 'pt-BR'));
  return [{ value: '', label: 'Todos continentes' },
    ...sorted.map(c => ({ value: c, label: continentLabel(c) || c }))];
}

/**
 * v4.62.11 — Países disponíveis. Quando `filter.continent` ativo (code), restringe
 * aos países dos roteiros desse continente. Senão, todos os países do banco.
 */
function countryOptions() {
  const set = new Set();
  const contCode = state.filter.continent;
  for (const d of state.list || []) {
    if (contCode && !(d.geo?.continentCodes || []).includes(contCode)) continue;
    (d.geo?.countries || []).forEach(c => c && set.add(c));
  }
  const sorted = [...set].sort((a,b) => a.localeCompare(b, 'pt-BR'));
  return [{ value: '', label: 'Todos países' }, ...sorted.map(c => ({ value: c, label: c }))];
}

/** v4.59.1: coleções disponíveis (extraídas dos roteiros existentes). */
function collectionOptions() {
  const set = new Set();
  for (const d of state.list || []) {
    if (d.collectionLabel) set.add(d.collectionLabel);
  }
  const sorted = [...set].sort((a,b) => a.localeCompare(b, 'pt-BR'));
  return [{ value: '', label: 'Todas coleções' }, ...sorted.map(c => ({ value: c, label: c }))];
}

/** v4.59.1: comparador pra sort. Fallbacks defensivos pra datas faltantes. */
function sortFn(mode) {
  return (a, b) => {
    if (mode === 'alphabet') {
      return (a.title || '').localeCompare(b.title || '', 'pt-BR');
    }
    if (mode === 'expiration') {
      // Roteiros expirando antes vêm primeiro; sem validade vai pro fim.
      const ea = a.validity?.endDate || '9999-12-31';
      const eb = b.validity?.endDate || '9999-12-31';
      return String(ea).localeCompare(String(eb));
    }
    if (mode === 'duration') {
      return (b.durationDays || 0) - (a.durationDays || 0);
    }
    // default 'recent' — preserva ordem do service (status priority + updatedAt desc)
    return 0;
  };
}

function applyFilters() {
  const filtered = state.list.filter(d => {
    // v4.62.1: pill especial "no-geo" — não é status real, é filtro de qualidade
    if (state.filter.status === 'no-geo') {
      const hasDestIds = Array.isArray(d.geo?.destinationIds) && d.geo.destinationIds.length > 0;
      const hasCountries = Array.isArray(d.geo?.countries) && d.geo.countries.length > 0;
      if (hasDestIds && hasCountries) return false;
    } else if (state.filter.status && d.status !== state.filter.status) {
      return false;
    }
    // v4.62.11: filtro continente — usa geo.continentCodes[] (code AF/AS/EU/etc),
    // que é o campo realmente populado (vs geo.continents que está vazio em prod).
    if (state.filter.continent && !(d.geo?.continentCodes || []).includes(state.filter.continent)) return false;
    if (state.filter.country && !d.geo.countries.includes(state.filter.country)) return false;
    if (state.filter.collection && d.collectionLabel !== state.filter.collection) return false;
    if (state.filter.search) {
      const s = state.filter.search.toLowerCase();
      const hay = [
        d.title, d.shortDescription, d.code, d.collectionLabel,
        ...(d.geo?.cities || []).map(c => c.city),
        ...(d.geo?.countries || []),
        ...(d.tags || []),
      ].join(' ').toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });
  // v4.59.1: ordena após filtrar (sort=='recent' preserva ordem do service)
  if (state.filter.sort && state.filter.sort !== 'recent') {
    filtered.sort(sortFn(state.filter.sort));
  }
  return filtered;
}

function gridHTML() {
  const items = applyFilters();
  if (state.loading) {
    return `<div style="text-align:center;padding:60px 0;color:var(--text-muted);">Carregando banco de roteiros…</div>`;
  }
  if (!items.length) {
    return `<div style="text-align:center;padding:60px 0;color:var(--text-muted);">
      Nenhum roteiro encontrado.
      ${canEdit() ? `<br><br><button class="btn btn-primary" data-action="new" style="margin-top:8px;">+ Novo roteiro</button>` : ''}
    </div>`;
  }
  // v4.59.5: lazy render — só os primeiros `renderedCount`. Sentinel ativa
  // IntersectionObserver pra carregar +PAGE_SIZE quando user chega no fim.
  // Filtros são client-side (state.list inteira em memória), só o DOM é incremental.
  const visible    = items.slice(0, state.renderedCount);
  const hasMore    = items.length > state.renderedCount;
  const counterTxt = hasMore
    ? `Mostrando ${visible.length} de ${items.length}`
    : `${items.length} ${items.length === 1 ? 'roteiro' : 'roteiros'}`;
  return `
    <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:8px;">${esc(counterTxt)}</div>
    <div class="rb-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;">
      ${visible.map(cardHTML).join('')}
    </div>
    ${hasMore ? `
      <div data-rb-sentinel style="text-align:center;padding:24px 0;color:var(--text-muted);font-size:0.85rem;">
        Carregando mais…
      </div>
    ` : ''}
  `;
}

/** v4.59.5: configura/reconfigura IntersectionObserver no sentinel pra incrementar
 * renderedCount quando user scrolla até o fim. Idempotente — reset a cada re-render. */
function _setupScrollObserver(container) {
  // Cleanup anterior
  if (state.scrollObserver) {
    try { state.scrollObserver.disconnect(); } catch {}
    state.scrollObserver = null;
  }
  const sentinel = container.querySelector('[data-rb-sentinel]');
  if (!sentinel || typeof IntersectionObserver === 'undefined') return;
  state.scrollObserver = new IntersectionObserver((entries) => {
    if (entries.some(e => e.isIntersecting)) {
      state.renderedCount += PAGE_SIZE;
      const wrap = container.querySelector('#rb-list-wrap');
      if (wrap) {
        wrap.innerHTML = gridHTML();
        _setupScrollObserver(container);  // re-arma pro novo sentinel (se houver mais)
      }
    }
  }, { rootMargin: '200px' });   // pré-carrega antes do user chegar
  state.scrollObserver.observe(sentinel);
}

/** v4.59.5: re-render do wrap + reconfigura observer. Reset renderedCount opcional
 * (sempre que filtro mudou, queremos voltar pra primeira página).
 */
function refreshGrid(container, { resetPage = false } = {}) {
  if (resetPage) state.renderedCount = PAGE_SIZE;
  const wrap = container.querySelector('#rb-list-wrap');
  if (!wrap) return;
  wrap.innerHTML = gridHTML();
  _setupScrollObserver(container);
}

/**
 * v4.62.1 — Bolsão de triagem geo. Modal pra master atribuir país + cidades
 * num roteiro que Envision deixou sem âncora.
 *
 * Fluxo:
 *   1. Master vê pill "⚠ Sem âncora geo" → filtra roteiros sem geo.destinationIds
 *   2. Clica botão 🌍 no card → abre este modal
 *   3. Atribui país (datalist SSOT) + lista cidades (1 por linha)
 *   4. Save: pra cada cidade, normalizeCityName + findDestinationByLabel
 *      (bate alias) ou cria pending banco-auto + popula geo.destinationIds[]
 *   5. Card perde badge "Sem geo" + ganha N destinations
 */
async function _openFixGeoModal(roteiro, container) {
  const [{ modal }, { COUNTRIES }, { resolveCountry, findDestinationByLabel, createPendingDestination }, { saveRoteiroBank }] = await Promise.all([
    import('../components/modal.js'),
    import('../data/countries.js'),
    import('../services/geoResolver.js'),
    import('../services/roteiroBank.js'),
  ]);

  // Pre-fill: country atual (se houver) + cities atuais
  const currentCountry = (roteiro.geo?.countries || [])[0] || '';
  const currentCities = (roteiro.geo?.cities || []).map(c => c.city).filter(Boolean).join('\n');

  const datalistHTML = COUNTRIES.slice()
    .sort((a,b) => a.pt.localeCompare(b.pt, 'pt-BR'))
    .map(c => `<option value="${esc(c.pt)}">${esc(c.en)}</option>`).join('');

  let handle;
  return new Promise(resolve => {
    handle = modal.open({
      title: '🌍 Corrigir geo do roteiro',
      size: 'md',
      closeOnEsc: true,
      content: `
        <div style="line-height:1.5;">
          <p style="margin:0 0 10px;font-size:0.85rem;color:var(--text-muted);">
            <strong>Roteiro:</strong> ${esc(roteiro.title || '(sem título)')}
          </p>
          <p style="margin:0 0 14px;font-size:0.78rem;color:var(--text-muted);">
            Envision não trouxe geo resolvível. Atribua país + cidades pra
            vincular este roteiro ao banco de destinos (cross-module).
          </p>

          <div style="margin-bottom:14px;">
            <label style="display:block;font-size:0.8rem;font-weight:600;margin-bottom:4px;">
              País * <span style="font-weight:400;color:var(--text-muted);">— digite ou escolha</span>
            </label>
            <input type="text" id="fg-country" class="form-input"
              list="fg-countries-datalist" autocomplete="off"
              placeholder="Ex: Argentina"
              value="${esc(currentCountry)}"
              style="width:100%;padding:8px 10px;border:1px solid var(--border-default,var(--border-subtle));border-radius:6px;">
            <datalist id="fg-countries-datalist">${datalistHTML}</datalist>
            <div id="fg-country-feedback" style="font-size:0.7rem;margin-top:4px;min-height:14px;"></div>
          </div>

          <div>
            <label style="display:block;font-size:0.8rem;font-weight:600;margin-bottom:4px;">
              Cidades — <span style="font-weight:400;color:var(--text-muted);">uma por linha</span>
            </label>
            <textarea id="fg-cities" rows="6" placeholder="Cusco&#10;Lima&#10;Aguas Calientes"
              style="width:100%;padding:8px 10px;border:1px solid var(--border-default,var(--border-subtle));border-radius:6px;font-family:inherit;font-size:0.85rem;resize:vertical;">${esc(currentCities)}</textarea>
            <p style="font-size:0.7rem;color:var(--text-muted);margin:4px 0 0;">
              Cidades existentes (com alias) são reutilizadas. Novas viram pendentes
              em Destinos pra revisão master.
            </p>
          </div>
        </div>
      `,
      footer: [
        { label: 'Cancelar', class: 'btn-secondary' },
        { label: 'Salvar e vincular', class: 'btn-primary', closeOnClick: false, onClick: async () => {
          const countryRaw = document.getElementById('fg-country')?.value?.trim() || '';
          const citiesRaw  = document.getElementById('fg-cities')?.value?.trim() || '';
          const resolved = resolveCountry(countryRaw);
          if (!resolved) {
            toast.error(`"${countryRaw}" não é um país reconhecido. Escolha da lista.`);
            return;
          }
          const cityLines = citiesRaw.split('\n').map(s => s.trim()).filter(Boolean);
          if (!cityLines.length) {
            toast.error('Pelo menos 1 cidade obrigatória.');
            return;
          }
          // Dedup case-insens
          const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
          const seen = new Set();
          const atomicCities = [];
          for (const c of cityLines) {
            const k = norm(c);
            if (!seen.has(k)) { seen.add(k); atomicCities.push(c); }
          }

          // Pra cada cidade: findDestinationByLabel ou criar pending
          const destinationIds = [];
          const newCitiesObj = [];
          let reused = 0, created = 0;
          for (let i = 0; i < atomicCities.length; i++) {
            const city = atomicCities[i];
            try {
              const existing = await findDestinationByLabel({ country: resolved.pt, city });
              let destId;
              if (existing?.id) { destId = existing.id; reused++; }
              else {
                const newDest = await createPendingDestination(
                  { country: resolved.pt, city },
                  { actorId: 'fix-geo-modal' }
                );
                destId = newDest?.id;
                if (destId) created++;
              }
              if (destId && !destinationIds.includes(destId)) destinationIds.push(destId);
              newCitiesObj.push({
                city, country: resolved.pt,
                continent: '', nights: (roteiro.geo?.cities?.[i]?.nights) || 0,
                countryCode: resolved.code, locationId: null, iata: '',
              });
            } catch (err) {
              console.warn('[fix-geo] cidade falhou:', city, err?.message);
            }
          }

          // Update doc completo
          try {
            const updated = {
              ...roteiro,
              geo: {
                ...(roteiro.geo || {}),
                countries:      [resolved.pt],
                countryCodes:   [resolved.code],
                continentCodes: [resolved.continent],
                cities:         newCitiesObj,
                destinationIds,
                fixedGeoAt:     new Date().toISOString(),
              },
            };
            await saveRoteiroBank(roteiro.id, updated);
            toast.success(`Geo corrigido: ${destinationIds.length} destinos (${reused} reusados${created ? `, ${created} novos pending` : ''}).`);
            // Atualiza state.list local
            const local = state.list.find(d => d.id === roteiro.id);
            if (local) {
              local.geo = updated.geo;
            }
            refreshGrid(container);
            handle?.close?.();
            resolve();
          } catch (err) {
            console.error('[fix-geo] save falhou:', err);
            toast.error('Falha ao salvar: ' + (err?.message || err));
          }
        }},
      ],
      onClose: () => resolve(),
    });

    // Wire validação live do país
    setTimeout(() => {
      const countryEl = document.getElementById('fg-country');
      const fbEl = document.getElementById('fg-country-feedback');
      if (!countryEl || !fbEl) return;
      const validate = () => {
        const raw = countryEl.value.trim();
        if (!raw) { fbEl.textContent = ''; countryEl.style.borderColor = ''; return; }
        const r = resolveCountry(raw);
        if (r) {
          fbEl.innerHTML = `<span style="color:var(--color-success,#10b981);">✓ ${esc(r.pt)} (${esc(r.code)})</span>`;
          countryEl.style.borderColor = 'var(--color-success,#10b981)';
        } else {
          fbEl.innerHTML = `<span style="color:var(--color-danger,#dc2626);">⚠ não está na lista</span>`;
          countryEl.style.borderColor = 'var(--color-danger,#dc2626)';
        }
      };
      countryEl.addEventListener('input', validate);
      countryEl.addEventListener('change', validate);
      validate();
    }, 60);
  });
}

export async function renderRoteiroBank(container) {
  // v4.50.10+ Aborta listeners de invocações anteriores (mesma rota re-aberta).
  if (state.abortCtrl) state.abortCtrl.abort();
  state.abortCtrl = new AbortController();
  const signal = state.abortCtrl.signal;

  // v4.59.5: cleanup do IntersectionObserver da invocação anterior
  if (state.scrollObserver) { try { state.scrollObserver.disconnect(); } catch {} state.scrollObserver = null; }

  state.loading = true;
  container.innerHTML = `
    <div class="page-container" style="padding:20px;max-width:1400px;margin:0 auto;">
      ${renderPageHeader({
        title: 'Banco de Roteiros',
        subtitle: 'Curadoria PRIMETOUR de roteiros prontos — usados como referência manual e base da IA.',
        ...(canEdit() ? {
          primary: { action: 'new', label: '+ Novo roteiro' },
          secondary: [{ action: 'envision-help', label: 'Como atualizar via Envision', title: 'Procedimento de sync com Envision' }],
        } : {}),
      })}
      ${renderFilterBar({
        search: { id: 'rb-search', value: state.filter.search, placeholder: 'Buscar por título, cidade, país ou tag…' },
        statusPills: [
          { value: '',          label: 'Todos' },
          { value: 'approved',  label: 'Publicados' },
          { value: 'review',    label: 'Em revisão' },
          { value: 'draft',     label: 'Rascunhos' },
          { value: 'archived',  label: 'Arquivados' },
          // v4.62.1: bolsão de triagem geo (52 roteiros sem âncora cross-module).
          // Especial: não é status do doc, é um "filtro virtual" de qualidade
          // de dados. applyFilters detecta valor 'no-geo' e filtra docs com
          // geo.destinationIds vazio OU geo.countries vazio.
          { value: 'no-geo',    label: '⚠ Sem âncora geo', count: (state.list||[]).filter(d => !(d.geo?.destinationIds?.length) || !(d.geo?.countries?.length)).length },
        ],
        activeStatus: state.filter.status,
        selects: [
          // v4.62.11: filtro continente RE-adicionado — pós v4.62.0 SSOT geo,
          // geo.continents[] está populado pra 184/236 roteiros.
          { id: 'rb-filter-continent',  label: 'Continente', value: state.filter.continent,  options: continentOptions() },
          { id: 'rb-filter-country',    label: 'País',       value: state.filter.country,    options: countryOptions() },
          { id: 'rb-filter-collection', label: 'Coleção',    value: state.filter.collection, options: collectionOptions() },
          { id: 'rb-filter-sort',       label: 'Ordenar',    value: state.filter.sort,       options: [
            { value: 'recent',     label: 'Mais recentes' },
            { value: 'alphabet',   label: 'Alfabética' },
            { value: 'expiration', label: 'Validade próxima' },
            { value: 'duration',   label: 'Duração (longos)' },
          ]},
        ],
      })}
      <div id="rb-list-wrap">${gridHTML()}</div>
    </div>
  `;

  // Carrega da rede
  try {
    state.list = await fetchRoteiroBankList({ includeArchived: true });
  } catch (e) {
    console.error('[Banco de Roteiros] fetch falhou:', e);
    toast.error('Falha ao carregar banco de roteiros: ' + (e?.message || e));
    state.list = [];
  }
  state.loading = false;
  refreshGrid(container, { resetPage: true });

  // v4.58.8 + v4.62.11: re-renderiza dropdowns continente + país após o load
  // (options dependem de state.list que só fica populado AGORA). Antes ficava
  // só "Todos" + 1 option vazia porque options() era chamado no template
  // inicial quando state.list ainda era [].
  const contSelectEl = container.querySelector('#rb-filter-continent');
  if (contSelectEl) {
    const v = contSelectEl.value;
    contSelectEl.innerHTML = continentOptions().map(o => `<option value="${o.value}" ${o.value===v?'selected':''}>${o.label}</option>`).join('');
  }
  const countrySelectEl = container.querySelector('#rb-filter-country');
  if (countrySelectEl) {
    const currentVal = countrySelectEl.value;
    countrySelectEl.innerHTML = countryOptions().map(o => `<option value="${o.value}" ${o.value===currentVal?'selected':''}>${o.label}</option>`).join('');
  }

  // v4.59.1: Hero auto-resolve em PARALELO (batch 5 simultâneos).
  // v4.59.5: PRIORIZA visíveis (primeiros `renderedCount` do filter atual).
  // Antes carregava 236 docs de uma vez bloqueando ~5min. Agora:
  // 1. Primeiro lote = visíveis (50) → user vê hero rápido nos cards renderizados
  // 2. Segundo lote = resto (não-bloqueante, em segundo plano)
  const allMissing = (state.list || []).filter(d => !d?.images?.hero && !state.heroResolveDone.has(d.id));
  if (allMissing.length) {
    (async () => {
      const BATCH = 5;
      let pendingRerender = false;
      const scheduleRender = () => {
        if (pendingRerender) return;
        pendingRerender = true;
        setTimeout(() => {
          pendingRerender = false;
          if (signal.aborted) return;
          refreshGrid(container);   // preserva renderedCount, só re-render
        }, 800);  // batch updates pra evitar render storm
      };
      // Ordena: visíveis (filtered → primeiros renderedCount) primeiro.
      const visibleIds = new Set(applyFilters().slice(0, state.renderedCount).map(d => d.id));
      const prioritized = [
        ...allMissing.filter(d => visibleIds.has(d.id)),
        ...allMissing.filter(d => !visibleIds.has(d.id)),
      ];
      for (let i = 0; i < prioritized.length; i += BATCH) {
        if (signal.aborted) return;
        const batch = prioritized.slice(i, i + BATCH);
        await Promise.allSettled(batch.map(async (d) => {
          try {
            const url = await ensureBankHero(d.id, d);
            state.heroResolveDone.add(d.id);
            if (url) {
              d.images = { ...(d.images||{}), hero: url };
              scheduleRender();
            }
          } catch { state.heroResolveDone.add(d.id); }
        }));
      }
    })();
  }

  /* ─── Listeners (delegados no container) ─── */
  container.addEventListener('click', async (e) => {
    const card = e.target.closest('.rb-card');
    const btn  = e.target.closest('[data-action]');

    if (btn) {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;

      if (action === 'new') {
        location.hash = '#banco-roteiro-editor';
        return;
      }
      // v4.59.1: modal explicativo "Como atualizar via Envision". Links pro
      // doc completo (docs/ENVISION-SYNC-GUIDE.md) + resumo dos 4 passos.
      if (action === 'envision-help') {
        try {
          const { modal } = await import('../components/modal.js');
          modal.open({
            title: 'Atualização Banco via Envision',
            size: 'md',
            closeOnEsc: true,
            content: `
              <div style="line-height:1.5;padding:4px 2px;">
                <p style="margin:0 0 12px;"><strong>Fonte da verdade dos roteiros é a Envision (TravelAgent).</strong>
                O PRIMETOUR consome via SOAP (sem API REST disponível pra roteiros) e enriquece com camada editorial.</p>
                <h4 style="margin:16px 0 6px;font-size:0.95rem;">Procedimento resumido</h4>
                <ol style="margin:0 0 12px 18px;padding:0;">
                  <li>Logar em <a href="https://v2.travelagent.com.br/" target="_blank" rel="noopener" style="color:var(--brand-gold,#D4A843);">v2.travelagent.com.br</a> no Chrome (cookie ativo)</li>
                  <li>DevTools → Console → rodar bulk fetch script (ver doc)</li>
                  <li>No terminal: <code style="background:var(--bg-surface);padding:1px 5px;border-radius:3px;font-size:0.85em;">node functions/import-envision-bundle.cjs --bundle X.json --apply</code></li>
                  <li><code style="background:var(--bg-surface);padding:1px 5px;border-radius:3px;font-size:0.85em;">node functions/backfill-geo-codes.cjs --apply</code></li>
                </ol>
                <p style="margin:8px 0 0;font-size:0.85rem;color:var(--text-muted);">
                  Guia completo: <code>docs/ENVISION-SYNC-GUIDE.md</code> no repo. Inclui troubleshooting, arquitetura, roadmap.
                </p>
                <p style="margin:12px 0 0;font-size:0.85rem;color:var(--text-muted);">
                  <strong>Frequência sugerida:</strong> mensal ou sob demanda (lote novo / antes de campanha).
                  Cada re-sync sobrescreve campos vindos do Envision; curadoria editorial PRIMETOUR é preservada.
                </p>
              </div>
            `,
            footer: [
              { label: 'Abrir guia no GitHub', class: 'btn-secondary', onClick: () => window.open('https://github.com/primetour/tarefas/blob/main/docs/ENVISION-SYNC-GUIDE.md', '_blank') },
              { label: 'Entendi', class: 'btn-primary' },
            ],
          });
        } catch (err) {
          // Fallback se modal.js falhar.
          window.open('https://github.com/primetour/tarefas/blob/main/docs/ENVISION-SYNC-GUIDE.md', '_blank');
        }
        return;
      }
      if (action === 'export-pdf') {
        const d = state.list.find(x => x.id === id);
        if (!d) { toast.error('Roteiro não encontrado.'); return; }
        // v4.50.10+: indica progresso visualmente no próprio botão (sem toast
        // "Gerando PDF…" que duplicava com o toast.success final).
        const origHTML = btn.innerHTML;
        btn.disabled = true;
        btn.style.opacity = '0.6';
        btn.innerHTML = '<span style="font-size:0.7rem;">⋯</span>';
        try {
          const res = await generateRoteiroBankPDF(d);
          toast.success(`PDF gerado: ${res.filename || 'download iniciado'}`);
        } catch (err) {
          console.error('[Banco] export PDF falhou:', err);
          toast.error('Falha ao gerar PDF: ' + (err.message || err));
        } finally {
          btn.disabled = false;
          btn.style.opacity = '';
          btn.innerHTML = origHTML;
        }
        return;
      }
      if (action === 'duplicate') {
        try {
          const newId = await duplicateRoteiroBank(id);
          toast.success('Roteiro duplicado.');
          location.hash = `#banco-roteiro-editor?id=${newId}`;
        } catch (err) { toast.error(err.message); }
        return;
      }
      if (action === 'archive') {
        // v4.59.3 (CLAUDE.md §11.k): confirm() nativo → modal custom.
        const { modal } = await import('../components/modal.js');
        const ok = await modal.confirm({
          title: 'Arquivar roteiro',
          message: 'Ele some das buscas (filtros padrão), mas pode ser restaurado depois — não é destrutivo.',
          confirmText: 'Arquivar',
          cancelText: 'Cancelar',
        });
        if (!ok) return;
        try {
          await archiveRoteiroBank(id);
          toast.success('Arquivado.');
          const d = state.list.find(x => x.id === id);
          if (d) d.status = 'archived';
          refreshGrid(container);   // v4.59.5
        } catch (err) { toast.error(err.message); }
        return;
      }
      // v4.62.1: bolsão de triagem geo
      if (action === 'fix-geo') {
        const d = state.list.find(x => x.id === id);
        if (!d) { toast.error('Roteiro não encontrado.'); return; }
        await _openFixGeoModal(d, container);
        return;
      }
      return;
    }

    if (card) {
      const id = card.dataset.id;
      location.hash = `#banco-roteiro-editor?id=${id}`;
    }
  }, { signal });

  // Filtros
  // v4.59.4: bug crítico Renê — handler procurava input[name=search]/[type=search]
  // mas uiKit gera <input type="text" id="rb-search">. Match com id explícito.
  // v4.59.5: refreshGrid({ resetPage: true }) — filtro mudou, volta pra primeira página.
  container.addEventListener('input', (e) => {
    if (e.target.id === 'rb-search') {
      state.filter.search = e.target.value || '';
      refreshGrid(container, { resetPage: true });
    }
  }, { signal });
  container.addEventListener('change', (e) => {
    // v4.62.11: handler continente — cascata com país (zera país se conflitar,
    // re-popula select de país com opções restritas ao continente selecionado).
    if (e.target.matches('#rb-filter-continent')) {
      state.filter.continent = e.target.value;
      // Se país atual não pertence ao novo continente, zera
      if (state.filter.country) {
        const validInCont = (state.list || []).some(d =>
          (d.geo?.continentCodes || []).includes(state.filter.continent) &&
          (d.geo?.countries      || []).includes(state.filter.country));
        if (!validInCont) state.filter.country = '';
      }
      // Re-popula select de país com opções filtradas
      const countrySel = container.querySelector('#rb-filter-country');
      if (countrySel) {
        const opts = countryOptions();
        countrySel.innerHTML = opts.map(o => `<option value="${o.value}" ${o.value===state.filter.country?'selected':''}>${o.label}</option>`).join('');
      }
      refreshGrid(container, { resetPage: true });
      return;
    }
    if (e.target.matches('#rb-filter-country')) {
      state.filter.country = e.target.value;
      refreshGrid(container, { resetPage: true });
      return;
    }
    if (e.target.matches('#rb-filter-collection')) {
      state.filter.collection = e.target.value;
      refreshGrid(container, { resetPage: true });
      return;
    }
    if (e.target.matches('#rb-filter-sort')) {
      state.filter.sort = e.target.value || 'recent';
      refreshGrid(container, { resetPage: true });
      return;
    }
  }, { signal });
  // Status pills
  // v4.59.4: bug crítico Renê — handler procurava [data-status-value], mas
  // uiKit gera classe .uikit-status-pill com data-filter-status. Replicado do
  // pattern correto em roteiros.js:800-802.
  container.addEventListener('click', (e) => {
    const pill = e.target.closest('.uikit-status-pill');
    if (!pill) return;
    state.filter.status = pill.dataset.filterStatus || '';
    container.querySelectorAll('.uikit-status-pill').forEach(p => {
      p.classList.toggle('active', (p.dataset.filterStatus || '') === state.filter.status);
    });
    refreshGrid(container, { resetPage: true });
  }, { signal });
}
