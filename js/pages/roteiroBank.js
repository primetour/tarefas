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
import { generateRoteiroBankPDF } from '../services/roteiroBankGenerator.js';
import { CONTINENTS } from '../services/portal.js';
import { actionIcon } from '../components/uiKit.js';

const esc = s => s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '';

let state = {
  list: [],
  loading: false,
  filter: { search: '', status: '', continent: '', country: '' },
};

function canEdit() {
  return store.isMaster?.()
      || store.can?.('portal_destinations_manage')
      || store.can?.('portal_manage');
}

function statusBadge(status) {
  const map = {
    draft:    { label: 'Rascunho',  bg: 'rgba(107,114,128,0.12)', color: '#374151' },
    review:   { label: 'Revisão',   bg: 'rgba(245,158,11,0.16)',  color: '#92400e' },
    approved: { label: 'Publicado', bg: 'rgba(16,185,129,0.16)',  color: '#065f46' },
    archived: { label: 'Arquivado', bg: 'rgba(220,38,38,0.12)',   color: '#991b1b' },
  };
  const it = map[status] || map.draft;
  return `<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;
    font-size:0.72rem;font-weight:600;background:${it.bg};color:${it.color};">${it.label}</span>`;
}

function expiredBadge(doc) {
  if (!isExpired(doc)) return '';
  return `<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;
    font-size:0.72rem;font-weight:600;background:rgba(220,38,38,0.16);color:#991b1b;margin-left:6px;"
    title="Validade expirou em ${esc(doc.validity?.endDate || '')} — revisar">⚠ Expirado</span>`;
}

function cardHTML(d) {
  const hero = d.images?.hero || '';
  const placeholder = !hero
    ? `<div style="width:100%;height:160px;background:linear-gradient(135deg,var(--brand-blue,#0A1628),#1e3a8a);
        display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.4);font-size:0.85rem;">
        sem imagem
      </div>`
    : `<div style="width:100%;height:160px;background-image:url('${esc(hero)}');background-size:cover;background-position:center;"></div>`;

  const cities = (d.geo?.cities || []).map(c => c.city).filter(Boolean);
  const citiesText = cities.length > 4
    ? `${cities.slice(0, 3).join(' · ')} +${cities.length - 3}`
    : cities.join(' · ');
  const countries = (d.geo?.countries || []).slice(0, 3).join(', ');

  const days = d.durationDays || (d.days?.length || 0);
  const nights = d.durationNights || cities.reduce((acc, _, i) => acc + (d.geo.cities[i]?.nights || 0), 0);

  const cats = (d.categories || []).length;
  const validity = d.validity?.endDate
    ? `<span style="color:var(--text-muted);font-size:0.72rem;">Validade até ${esc(d.validity.endDate)}</span>`
    : '';

  return `
    <div class="rb-card" data-id="${esc(d.id)}" style="background:var(--bg-card);
      border:1px solid var(--border-subtle);border-radius:12px;overflow:hidden;
      cursor:pointer;transition:all 0.15s;display:flex;flex-direction:column;">
      ${placeholder}
      <div style="padding:14px 16px 12px;flex:1;display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          ${statusBadge(d.status)}
          ${expiredBadge(d)}
          ${d.collectionLabel ? `<span style="color:var(--brand-gold,#D4A843);font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">${esc(d.collectionLabel)}</span>` : ''}
        </div>
        <h3 style="margin:0;font-size:1rem;font-weight:700;color:var(--text-primary);line-height:1.3;">
          ${esc(d.title || '(sem título)')}
        </h3>
        <div style="color:var(--text-secondary);font-size:0.82rem;line-height:1.4;">
          ${esc(d.shortDescription?.slice(0, 140) || '')}${d.shortDescription?.length > 140 ? '…' : ''}
        </div>
        <div style="display:flex;gap:12px;align-items:center;color:var(--text-muted);font-size:0.78rem;margin-top:auto;padding-top:8px;border-top:1px solid var(--border-subtle);">
          <span title="Cidades">📍 ${cities.length}</span>
          <span title="Dias">⏱ ${days}d / ${nights}n</span>
          <span title="Categorias hospedagem">🏨 ${cats}</span>
        </div>
        <div style="color:var(--text-muted);font-size:0.78rem;">${esc(citiesText)}</div>
        ${validity}
        <div class="rb-actions" style="display:flex;gap:4px;justify-content:flex-end;margin-top:6px;border-top:1px solid var(--border-subtle);padding-top:8px;">
          <button class="btn-icon-action" data-action="export-pdf" data-id="${esc(d.id)}" title="Exportar PDF"
            style="padding:6px;background:transparent;border:1px solid var(--border-subtle);border-radius:6px;cursor:pointer;color:var(--text-secondary);">
            ${actionIcon('download')}
          </button>
          ${canEdit() ? `
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

/** Países disponíveis: todos os países dos roteiros (filtrados por continente se setado). */
function countryOptions() {
  const set = new Set();
  for (const d of state.list || []) {
    if (state.filter.continent && !d.geo.continents.includes(state.filter.continent)) continue;
    (d.geo.countries || []).forEach(c => c && set.add(c));
  }
  const sorted = [...set].sort((a,b) => a.localeCompare(b, 'pt-BR'));
  return [{ value: '', label: 'Todos países' }, ...sorted.map(c => ({ value: c, label: c }))];
}

function applyFilters() {
  return state.list.filter(d => {
    if (state.filter.status && d.status !== state.filter.status) return false;
    if (state.filter.continent && !d.geo.continents.includes(state.filter.continent)) return false;
    if (state.filter.country && !d.geo.countries.includes(state.filter.country)) return false;
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
  return `
    <div class="rb-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;">
      ${items.map(cardHTML).join('')}
    </div>
  `;
}

export async function renderRoteiroBank(container) {
  state.loading = true;
  container.innerHTML = `
    <div class="page-container" style="padding:20px;max-width:1400px;margin:0 auto;">
      ${renderPageHeader({
        title: 'Banco de Roteiros',
        subtitle: 'Curadoria PRIMETOUR de roteiros prontos — usados como referência manual e base da IA.',
        ...(canEdit() ? {
          primary: { action: 'new', label: '+ Novo roteiro' },
        } : {}),
      })}
      ${renderFilterBar({
        search: { value: state.filter.search, placeholder: 'Buscar por título, cidade, país ou tag…' },
        statusPills: [
          { value: '',         label: 'Todos' },
          { value: 'approved', label: 'Publicados' },
          { value: 'review',   label: 'Em revisão' },
          { value: 'draft',    label: 'Rascunhos' },
          { value: 'archived', label: 'Arquivados' },
        ],
        activeStatus: state.filter.status,
        selects: [
          { id: 'rb-filter-continent', label: 'Continente', value: state.filter.continent, options: [
            { value: '', label: 'Todos continentes' },
            ...CONTINENTS.map(c => ({ value: c, label: c })),
          ]},
          // v4.50.1+ Filtro país cascata — opções derivadas dos roteiros sob o continente ativo
          { id: 'rb-filter-country', label: 'País', value: state.filter.country, options: countryOptions() },
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
  const wrap = container.querySelector('#rb-list-wrap');
  if (wrap) wrap.innerHTML = gridHTML();

  // v4.50.1+ Hero auto-resolve em background — pra docs sem hero,
  // busca banco_imagens → Unsplash e persiste no doc. Atualiza UI quando achar.
  const missingHero = (state.list || []).filter(d => !d?.images?.hero);
  if (missingHero.length) {
    (async () => {
      for (const d of missingHero) {
        try {
          const url = await ensureBankHero(d.id, d);
          if (url) {
            d.images = { ...(d.images||{}), hero: url };
            const wrap2 = container.querySelector('#rb-list-wrap');
            if (wrap2) wrap2.innerHTML = gridHTML();   // re-render simples
          }
        } catch {}
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
      if (action === 'export-pdf') {
        const d = state.list.find(x => x.id === id);
        if (!d) { toast.error('Roteiro não encontrado.'); return; }
        try {
          toast.info('Gerando PDF…');
          const res = await generateRoteiroBankPDF(d);
          toast.success(`PDF gerado: ${res.filename || 'download iniciado'}`);
        } catch (err) {
          console.error('[Banco] export PDF falhou:', err);
          toast.error('Falha ao gerar PDF: ' + (err.message || err));
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
        if (!confirm('Arquivar este roteiro? Ele some das buscas mas pode ser restaurado.')) return;
        try {
          await archiveRoteiroBank(id);
          toast.success('Arquivado.');
          const d = state.list.find(x => x.id === id);
          if (d) d.status = 'archived';
          const wrap = container.querySelector('#rb-list-wrap');
          if (wrap) wrap.innerHTML = gridHTML();
        } catch (err) { toast.error(err.message); }
        return;
      }
      return;
    }

    if (card) {
      const id = card.dataset.id;
      location.hash = `#banco-roteiro-editor?id=${id}`;
    }
  });

  // Filtros
  container.addEventListener('input', (e) => {
    if (e.target.matches('input[name="search"], input[type="search"]')) {
      state.filter.search = e.target.value || '';
      const wrap = container.querySelector('#rb-list-wrap');
      if (wrap) wrap.innerHTML = gridHTML();
    }
  });
  container.addEventListener('change', (e) => {
    if (e.target.matches('#rb-filter-continent')) {
      state.filter.continent = e.target.value;
      // Reset país (cascata: muda continente → países disponíveis mudam)
      state.filter.country = '';
      const countrySelect = container.querySelector('#rb-filter-country');
      if (countrySelect) {
        countrySelect.innerHTML = countryOptions().map(o => `<option value="${o.value}">${o.label}</option>`).join('');
        countrySelect.value = '';
      }
      const wrap = container.querySelector('#rb-list-wrap');
      if (wrap) wrap.innerHTML = gridHTML();
      return;
    }
    if (e.target.matches('#rb-filter-country')) {
      state.filter.country = e.target.value;
      const wrap = container.querySelector('#rb-list-wrap');
      if (wrap) wrap.innerHTML = gridHTML();
      return;
    }
  });
  // Status pills
  container.addEventListener('click', (e) => {
    const pill = e.target.closest('[data-status-value]');
    if (!pill) return;
    state.filter.status = pill.dataset.statusValue || '';
    container.querySelectorAll('[data-status-value]').forEach(p => {
      p.classList.toggle('active', (p.dataset.statusValue || '') === state.filter.status);
    });
    const wrap = container.querySelector('#rb-list-wrap');
    if (wrap) wrap.innerHTML = gridHTML();
  });
}
