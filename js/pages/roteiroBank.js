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
import { actionIcon } from '../components/uiKit.js';

const esc = s => s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '';

let state = {
  list: [],
  loading: false,
  // v4.59.1: removido `continent` do filter (era código morto pós v4.58.2 — Envision não tem continente).
  // Adicionado `collection` (filtro novo) e `sort` (alphabet|recent|expiration|duration).
  filter: { search: '', status: '', country: '', collection: '', sort: 'recent' },
  abortCtrl: null,          // v4.50.10+ AbortController dos listeners delegados
  heroResolveDone: new Set(), // v4.59.1: evita re-fetch após primeira falha (paralelo)
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
      <span title="Validade início" style="${startIndef ? 'font-style:italic;' : ''}">📅 Início: <strong style="color:${startIndef ? 'var(--text-muted)' : 'var(--text-secondary)'};">${esc(startTxt)}</strong></span>
      <span title="Validade fim"    style="${endIndef ? 'font-style:italic;' : ''}">⏳ Fim: <strong style="color:${endIndef ? 'var(--text-muted)' : 'var(--text-secondary)'};">${esc(endTxt)}</strong></span>
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
        ${meta}
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

/** Países disponíveis: todos os países dos roteiros. */
function countryOptions() {
  const set = new Set();
  for (const d of state.list || []) {
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
    if (state.filter.status && d.status !== state.filter.status) return false;
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
  return `
    <div class="rb-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;">
      ${items.map(cardHTML).join('')}
    </div>
  `;
}

export async function renderRoteiroBank(container) {
  // v4.50.10+ Aborta listeners de invocações anteriores (mesma rota re-aberta).
  if (state.abortCtrl) state.abortCtrl.abort();
  state.abortCtrl = new AbortController();
  const signal = state.abortCtrl.signal;

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
          // v4.58.2: filtro continente removido (Renê: "não precisamos do campo continente").
          // v4.59.1: filtro continente código morto também removido (audit). Adicionados coleção + sort.
          { id: 'rb-filter-country',    label: 'País',     value: state.filter.country,    options: countryOptions() },
          { id: 'rb-filter-collection', label: 'Coleção',  value: state.filter.collection, options: collectionOptions() },
          { id: 'rb-filter-sort',       label: 'Ordenar',  value: state.filter.sort,       options: [
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
  const wrap = container.querySelector('#rb-list-wrap');
  if (wrap) wrap.innerHTML = gridHTML();

  // v4.58.8: re-renderiza dropdown país após o load (countryOptions depende
  // de state.list que só fica populado AGORA). Antes ficava só "Todos países"
  // + 1 option vazia porque countryOptions() era chamado no template inicial
  // quando state.list ainda era [].
  const countrySelectEl = container.querySelector('#rb-filter-country');
  if (countrySelectEl) {
    const currentVal = countrySelectEl.value;
    countrySelectEl.innerHTML = countryOptions().map(o => `<option value="${o.value}" ${o.value===currentVal?'selected':''}>${o.label}</option>`).join('');
  }

  // v4.59.1: Hero auto-resolve em PARALELO (batch 5 simultâneos).
  // Antes: loop sequencial bloqueava ~5min com 50+ docs sem hero.
  // Agora: ~5-10s pra 50 docs. Re-render via debounce (não a cada doc).
  // Inclui guard `heroResolveDone` pra evitar re-fetch quando user re-render
  // a página com docs cuja primeira tentativa falhou (sem hero achado).
  const missingHero = (state.list || []).filter(d => !d?.images?.hero && !state.heroResolveDone.has(d.id));
  if (missingHero.length) {
    (async () => {
      const BATCH = 5;
      let pendingRerender = false;
      const scheduleRender = () => {
        if (pendingRerender) return;
        pendingRerender = true;
        setTimeout(() => {
          pendingRerender = false;
          if (signal.aborted) return;
          const wrap2 = container.querySelector('#rb-list-wrap');
          if (wrap2) wrap2.innerHTML = gridHTML();
        }, 800);  // batch updates pra evitar render storm
      };
      for (let i = 0; i < missingHero.length; i += BATCH) {
        if (signal.aborted) return;
        const batch = missingHero.slice(i, i + BATCH);
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
  }, { signal });

  // Filtros
  container.addEventListener('input', (e) => {
    if (e.target.matches('input[name="search"], input[type="search"]')) {
      state.filter.search = e.target.value || '';
      const wrap = container.querySelector('#rb-list-wrap');
      if (wrap) wrap.innerHTML = gridHTML();
    }
  }, { signal });
  container.addEventListener('change', (e) => {
    // v4.59.1: handler #rb-filter-continent removido (era código morto pós v4.58.2 — audit).
    if (e.target.matches('#rb-filter-country')) {
      state.filter.country = e.target.value;
      const wrap = container.querySelector('#rb-list-wrap');
      if (wrap) wrap.innerHTML = gridHTML();
      return;
    }
    if (e.target.matches('#rb-filter-collection')) {
      state.filter.collection = e.target.value;
      const wrap = container.querySelector('#rb-list-wrap');
      if (wrap) wrap.innerHTML = gridHTML();
      return;
    }
    if (e.target.matches('#rb-filter-sort')) {
      state.filter.sort = e.target.value || 'recent';
      const wrap = container.querySelector('#rb-list-wrap');
      if (wrap) wrap.innerHTML = gridHTML();
      return;
    }
  }, { signal });
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
  }, { signal });
}
