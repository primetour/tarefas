/**
 * PRIMETOUR — Portal de Dicas: Destinos
 * Cadastro e hierarquia Continente → País → Cidade/Região
 */
import { store } from '../store.js';
import { toast } from '../components/toast.js';
import {
  fetchDestinations, saveDestination, deleteDestination, mergeDestinations,
  fetchTips, CONTINENTS,
} from '../services/portal.js';
import { openDestinationsImport } from '../components/destinationsImport.js';
// v4.61.1: SSOT geográfico — validação + auto-fill continente + datalist
import { COUNTRIES } from '../data/countries.js';
import { CONTINENTS_BY_CODE } from '../data/continents.js';
import { resolveCountry, resolveContinent, LEGACY_CONTINENT_TO_CODE } from '../services/geoResolver.js';

const esc = s => String(s||'').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let allDests   = [];
let roteirosByDestId = new Map();   // v4.62.2: destId → [{id, title}] (vinculação reversa)
let tipsByDestId     = new Map();   // v4.62.7: destId → { id, title } (1:1 schema atual)
let filterCont = '';
let filterCoun = '';
let filterReview = 'approved';   // v4.60.0: default só aprovados; toggle pra ver pending
let filterSearch = '';           // v4.61.2: busca por palavra (cidade/país/aliases)
let filterTip    = 'all';        // v4.61.2: 'all' | 'with' | 'without' (dica cadastrada?)
let currentTab = 'list';         // v4.61.0 Feature B: 'list' | 'aliases'

export async function renderPortalDestinations(container) {
  // 4.49.2+ Usa canManageDestinations() (perm granular nova) em vez de
  // canManagePortal(). Libera pro analista criar destinos sem dar acesso
  // ao resto do Portal (banco de imagens, áreas, templates).
  if (!store.canManageDestinations()) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Destinos</h1>
        <p class="page-subtitle">Hierarquia de destinos: Continente → País → Cidade/Região</p>
      </div>
      <div class="page-header-actions" style="display:flex;gap:8px;">
        <button class="btn btn-secondary btn-sm" id="dest-import-btn"
          title="Importar vários destinos via planilha Excel">📤 Importar Excel</button>
        <button class="btn btn-primary btn-sm" id="dest-new-btn">+ Novo Destino</button>
      </div>
    </div>

    <!-- v4.61.0 Feature B: tab switcher -->
    <div style="display:flex;gap:0;border-bottom:1px solid var(--border-subtle);margin-bottom:16px;">
      ${[
        { id: 'list',    label: 'Destinos' },
        { id: 'aliases', label: 'Variações de nome' },
      ].map(t => `
        <button class="dest-tab" data-tab="${t.id}"
          style="padding:10px 20px;background:transparent;border:none;cursor:pointer;
          font-size:0.875rem;font-weight:600;color:${currentTab === t.id ? 'var(--brand-blue,#3B82F6)' : 'var(--text-muted)'};
          border-bottom:2px solid ${currentTab === t.id ? 'var(--brand-blue,#3B82F6)' : 'transparent'};
          margin-bottom:-1px;font-family:inherit;">
          ${esc(t.label)}
        </button>
      `).join('')}
    </div>

    <div id="dest-tab-content"></div>
  `;

  // v4.61.0: handler do tab switcher
  container.querySelectorAll('.dest-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      renderPortalDestinations(container);   // re-render full page (idempotente)
    });
  });

  // Renderiza o conteúdo da tab ativa
  const tabContent = document.getElementById('dest-tab-content');
  if (currentTab === 'aliases') {
    tabContent.innerHTML = `<div class="card" style="padding:0;overflow:hidden;">
      <div style="padding:14px 16px;border-bottom:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:0.95rem;font-weight:600;">Gerenciar variações de nome de cidades</div>
          <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px;">
            Adicione grafias alternativas (ex: "Cape Town" como alias de "Cidade do Cabo").
            Sistema reconhece como mesma cidade no cross-module.
            <span style="color:var(--brand-blue,#3B82F6);font-weight:500;">Salva automaticamente ao pressionar Enter.</span>
          </div>
        </div>
        <input type="search" id="dest-aliases-search" placeholder="Buscar cidade ou alias…"
          class="filter-select" style="min-width:240px;">
      </div>
      <div style="overflow:auto;max-height:calc(100vh - 280px);">
        <table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
          <thead style="position:sticky;top:0;background:var(--bg-surface);z-index:1;">
            <tr>
              <th style="padding:10px 16px;text-align:left;font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">País</th>
              <th style="padding:10px 16px;text-align:left;font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">Cidade (canônico)</th>
              <th style="padding:10px 16px;text-align:left;font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">Variações (aliases)</th>
              <th style="padding:10px 16px;width:110px;border-bottom:1px solid var(--border-subtle);"></th>
            </tr>
          </thead>
          <tbody id="aliases-tbody">
            <tr><td colspan="4" style="padding:40px;text-align:center;color:var(--text-muted);">Carregando…</td></tr>
          </tbody>
        </table>
      </div>
    </div>`;
    // Espera load de allDests
    allDests = await fetchDestinations();
    _renderAliasesTab();
    document.getElementById('dest-aliases-search')?.addEventListener('input', _renderAliasesTab);
    document.getElementById('dest-modal-wrapper') || (() => {
      const m = document.createElement('div');
      m.id = 'dest-modal'; m.style.display = 'none';
      container.appendChild(m);
    })();
    return;
  }

  // Default tab 'list': fluxo original (filtros + tabela)
  tabContent.innerHTML = `

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center;">
      <span style="font-size:0.72rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-right:4px;">Revisão:</span>
      ${[
        { v: 'approved', l: 'Aprovados' },
        { v: 'pending',  l: 'Pendentes' },
        { v: 'all',      l: 'Todos' },
      ].map(p => `
        <button class="dest-review-pill" data-review-value="${p.v}"
          style="padding:5px 12px;border-radius:999px;font-size:0.78rem;font-weight:600;cursor:pointer;
          border:1px solid ${filterReview === p.v ? 'var(--brand-blue,#3B82F6)' : 'var(--border-subtle)'};
          background:${filterReview === p.v ? 'var(--brand-blue,#3B82F6)' : 'transparent'};
          color:${filterReview === p.v ? '#fff' : 'var(--text-muted)'};font-family:inherit;">
          ${esc(p.l)}
        </button>
      `).join('')}
      <span id="dest-pending-count" style="margin-left:8px;font-size:0.72rem;color:var(--text-muted);"></span>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center;">
      <!-- v4.61.2: busca por palavra (cidade/país/aliases) -->
      <div style="position:relative;flex:1;min-width:220px;max-width:340px;">
        <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:0.875rem;color:var(--text-muted);pointer-events:none;">🔍</span>
        <input type="search" id="dest-search" class="filter-select"
          placeholder="Buscar por cidade, país ou variação…"
          value="${esc(filterSearch)}"
          style="height:34px;font-size:0.8125rem;padding-left:32px;width:100%;">
      </div>
      <select class="filter-select" id="dest-filter-cont" style="min-width:180px;">
        <option value="">Todos os continentes</option>
        ${CONTINENTS.map(c => `<option value="${esc(c)}" ${filterCont===c?'selected':''}>${esc(c)}</option>`).join('')}
      </select>
      <!-- v4.62.5: país standalone — não depende mais de continente selecionado.
           Populado com TODOS os países do dataset (ou filtrado se cont ativo). -->
      <select class="filter-select" id="dest-filter-country" style="min-width:180px;">
        <option value="">Todos os países</option>
      </select>
      <select class="filter-select" id="dest-filter-tip" style="min-width:130px;" title="Filtrar por status da dica">
        <option value="all"     ${filterTip==='all'?'selected':''}>Todas as dicas</option>
        <option value="with"    ${filterTip==='with'?'selected':''}>✓ Com dica</option>
        <option value="without" ${filterTip==='without'?'selected':''}>Sem dica</option>
      </select>
      <button class="btn btn-ghost btn-sm" id="dest-clear-filters"
        title="Limpar todos os filtros"
        style="font-size:0.78rem;color:var(--text-muted);${(filterSearch||filterCont||filterCoun||filterTip!=='all')?'':'visibility:hidden;'}">
        ✕ Limpar
      </button>
      <span id="dest-count" style="margin-left:auto;font-size:0.8125rem;color:var(--text-muted);
        align-self:center;"></span>
    </div>

    <div class="card" style="padding:0;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
        <thead>
          <tr style="background:var(--bg-surface);">
            <th style="padding:10px 16px;text-align:left;font-size:0.6875rem;font-weight:700;
              text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);
              border-bottom:1px solid var(--border-subtle);">Continente</th>
            <th style="padding:10px 16px;text-align:left;font-size:0.6875rem;font-weight:700;
              text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);
              border-bottom:1px solid var(--border-subtle);">País</th>
            <th style="padding:10px 16px;text-align:left;font-size:0.6875rem;font-weight:700;
              text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);
              border-bottom:1px solid var(--border-subtle);">Cidade/Região</th>
            <!-- v4.62.5: coluna "Dica" removida — info agora consolidada no
                 botão 💡 Dica da coluna de ações (badge numeral, igual 📋 Roteiro). -->
            <th style="padding:10px 16px;border-bottom:1px solid var(--border-subtle);width:100px;"></th>
          </tr>
        </thead>
        <tbody id="dest-tbody">
          <tr><td colspan="4" style="padding:40px;text-align:center;color:var(--text-muted);">
            Carregando…
          </td></tr>
        </tbody>
      </table>
    </div>
    <div id="dest-modal" style="display:none;"></div>
  `;

  document.getElementById('dest-new-btn')?.addEventListener('click', () => showDestModal(null));
  // 4.49.7+ Bulk import via Excel — abre wizard que parseia XLSX/CSV e
  // chama saveDestination pra cada linha selecionada. onComplete refaz fetch.
  document.getElementById('dest-import-btn')?.addEventListener('click', () => {
    openDestinationsImport({
      onComplete: async () => {
        allDests = await fetchDestinations();
        renderTable();
      },
    });
  });
  document.getElementById('dest-filter-cont')?.addEventListener('change', e => {
    filterCont = e.target.value;
    filterCoun = '';
    updateCountryFilter();
    renderTable();
  });
  document.getElementById('dest-filter-country')?.addEventListener('change', e => {
    filterCoun = e.target.value;
    // v4.62.5: se país standalone selecionado E continente atual não bate, zera
    // continente (evita filtro AND retornar 0 quando user quis só filtrar país).
    if (filterCoun && filterCont) {
      const validInCont = allDests.some(d => d.country === filterCoun && d.continent === filterCont);
      if (!validInCont) {
        filterCont = '';
        const contSel = document.getElementById('dest-filter-cont');
        if (contSel) contSel.value = '';
      }
    }
    renderTable();
  });
  // v4.61.2 — busca + filtro dica + limpar
  document.getElementById('dest-search')?.addEventListener('input', e => {
    filterSearch = e.target.value || '';
    renderTable();
  });
  document.getElementById('dest-filter-tip')?.addEventListener('change', e => {
    filterTip = e.target.value || 'all';
    renderTable();
  });
  document.getElementById('dest-clear-filters')?.addEventListener('click', () => {
    filterSearch = ''; filterCont = ''; filterCoun = ''; filterTip = 'all';
    renderPortalDestinations(container);
  });
  // v4.60.0: filtro reviewStatus pills
  document.querySelectorAll('.dest-review-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      filterReview = pill.dataset.reviewValue;
      // Re-render só os pills (visual active) + tabela
      document.querySelectorAll('.dest-review-pill').forEach(p => {
        const isActive = p.dataset.reviewValue === filterReview;
        p.style.background = isActive ? 'var(--brand-blue,#3B82F6)' : 'transparent';
        p.style.color = isActive ? '#fff' : 'var(--text-muted)';
        p.style.borderColor = isActive ? 'var(--brand-blue,#3B82F6)' : 'var(--border-subtle)';
      });
      renderTable();
    });
  });

  allDests = await fetchDestinations();   // default 'all' agora — UI filtra in-memory
  // v4.62.2 + v4.62.7: paralelo — destId → roteiros + destId → tip
  await Promise.all([_loadRoteiroLinks(), _loadTipLinks()]);
  updateCountryFilter();
  renderTable();
}

/**
 * v4.62.2 — carrega vinculação reversa destId → roteiros do banco.
 * 1 fetch grande (236 docs) em vez de N queries individuais. Cache em memória
 * dura a sessão do user na página de destinos. Atualizado ao re-fetch.
 */
async function _loadRoteiroLinks() {
  try {
    const { db } = await import('../firebase.js');
    const { collection, getDocs, query, limit } = await import(
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
    );
    const snap = await getDocs(query(collection(db, 'roteiros_bank'), limit(1000)));
    roteirosByDestId = new Map();
    snap.forEach(d => {
      const data = d.data();
      const ids = data.geo?.destinationIds || [];
      for (const destId of ids) {
        if (!roteirosByDestId.has(destId)) roteirosByDestId.set(destId, []);
        roteirosByDestId.get(destId).push({
          id: d.id,
          title: data.title || '(sem título)',
          status: data.status || 'draft',
        });
      }
    });
  } catch (e) {
    console.warn('[portalDestinations] _loadRoteiroLinks falhou (não-bloqueante):', e?.message);
    roteirosByDestId = new Map();
  }
}

/**
 * v4.62.7 — carrega vinculação reversa destId → tip (1:1 schema atual).
 * Substitui d.hasTip que nunca era populado (sempre falsy → tabela mostrava
 * "Sem dica" mesmo pra destinos COM dica). Fluxo single-source: fetch direto
 * de portal_tips agrupado por destinationId. Mantém shape extensível pra
 * eventual N:1 futuro (Map<destId, [{id,title}]>).
 */
async function _loadTipLinks() {
  try {
    const tips = await fetchTips();
    tipsByDestId = new Map();
    for (const t of tips) {
      if (!t.destinationId) continue;
      // Schema atual é 1:1, mas guardamos array pra escalar pra N:1 sem mudar API
      if (!tipsByDestId.has(t.destinationId)) tipsByDestId.set(t.destinationId, []);
      tipsByDestId.get(t.destinationId).push({
        id: t.id,
        title: t.title || t.city || '(sem título)',
      });
    }
  } catch (e) {
    console.warn('[portalDestinations] _loadTipLinks falhou (não-bloqueante):', e?.message);
    tipsByDestId = new Map();
  }
}

function updateCountryFilter() {
  const sel = document.getElementById('dest-filter-country');
  if (!sel) return;
  // v4.62.5: país é STANDALONE — lista todos os países sempre, opcionalmente
  // restringido pelo continente se selecionado. Sem continente → todos visíveis.
  const base = filterCont
    ? allDests.filter(d => d.continent === filterCont)
    : allDests;
  const countries = [...new Set(base.map(d => d.country).filter(Boolean))].sort();
  sel.innerHTML = `<option value="">Todos os países</option>` +
    countries.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  // Restaura seleção se ainda válida; caso contrário, zera
  sel.value = countries.includes(filterCoun) ? filterCoun : '';
  if (sel.value !== filterCoun) filterCoun = sel.value;
  sel.disabled = false;   // nunca desabilita — sempre clicável
}

function renderTable() {
  const tbody = document.getElementById('dest-tbody');
  const count = document.getElementById('dest-count');
  const pendCount = document.getElementById('dest-pending-count');
  if (!tbody) return;

  // v4.60.0: pending count global (independente dos filtros) pra UI alertar curador
  const totalPending = allDests.filter(d => (d.reviewStatus || 'approved') === 'pending').length;
  if (pendCount) {
    pendCount.textContent = totalPending
      ? `${totalPending} pendente${totalPending !== 1 ? 's' : ''} no banco — revisar e aprovar.`
      : '';
  }

  let rows = allDests;
  // v4.60.0: filtra por reviewStatus
  if (filterReview && filterReview !== 'all') {
    rows = rows.filter(d => (d.reviewStatus || 'approved') === filterReview);
  }
  if (filterCont) rows = rows.filter(d => d.continent === filterCont);
  if (filterCoun) rows = rows.filter(d => d.country   === filterCoun);
  // v4.62.7: filtro dica usa lookup real em tipsByDestId (d.hasTip nunca foi
  // populado — sempre falsy. Bug latente desde v4.61.2).
  if (filterTip === 'with')    rows = rows.filter(d => tipsByDestId.has(d.id));
  if (filterTip === 'without') rows = rows.filter(d => !tipsByDestId.has(d.id));
  if (filterSearch) {
    const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const q = norm(filterSearch);
    rows = rows.filter(d =>
      norm(d.city).includes(q) ||
      norm(d.country).includes(q) ||
      norm(d.continent).includes(q) ||
      (Array.isArray(d.cityAliases) && d.cityAliases.some(a => norm(a).includes(q)))
    );
  }

  // v4.62.3: quando filtrando Pendentes, sort por createdAt DESC (mais recentes
  // primeiro — o que o user acabou de criar via bolsão aparece no topo).
  if (filterReview === 'pending') {
    rows = rows.slice().sort((a, b) => {
      const aMs = a.createdAt?.toMillis?.() || 0;
      const bMs = b.createdAt?.toMillis?.() || 0;
      return bMs - aMs;
    });
  }

  if (count) {
    // v4.62.3: breakdown por origem quando pending tab ativo
    let extraInfo = '';
    if (filterReview === 'pending' && rows.length) {
      const bySource = rows.reduce((acc, d) => {
        acc[d.source || 'manual'] = (acc[d.source || 'manual'] || 0) + 1;
        return acc;
      }, {});
      const parts = [];
      if (bySource['envision-auto']) parts.push(`${bySource['envision-auto']} bolsão 🌍`);
      if (bySource['banco-auto'])    parts.push(`${bySource['banco-auto']} banco 📦`);
      if (bySource.manual)           parts.push(`${bySource.manual} manual`);
      if (parts.length) extraInfo = ` · ${parts.join(' · ')}`;
    }
    count.textContent = `${rows.length} destino${rows.length !== 1 ? 's' : ''}${
      (filterSearch||filterCont||filterCoun||filterTip!=='all') ? ' (filtrado)' : ''
    }${extraInfo}`;
  }

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="padding:48px;text-align:center;color:var(--text-muted);">
      Nenhum destino encontrado.
    </td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(d => {
    const isPending = (d.reviewStatus || 'approved') === 'pending';
    // v4.62.3: origem do destino — distingue manual/banco-auto/envision-auto
    // Manual: criado pelo curador. Banco-auto: populate inicial v4.60.0.
    // Envision-auto (do bolsão): triado via modal Corrigir geo no Banco.
    const source = d.source || 'manual';
    const SOURCE_BADGES = {
      'manual':        { icon: '',       label: 'Manual',  color: 'var(--text-muted)' },
      'banco-auto':    { icon: '📦',     label: 'Banco',   color: 'var(--brand-blue,#3B82F6)' },
      'envision-auto': { icon: '🌍',     label: 'Bolsão',  color: 'var(--color-warn-text,#92400e)' },
    };
    const srcBadge = SOURCE_BADGES[source] || SOURCE_BADGES['manual'];
    return `
    <tr style="border-bottom:1px solid var(--border-subtle);transition:background .1s;background:${isPending?'rgba(245,158,11,0.05)':''};"
      onmouseover="this.style.background='${isPending?'rgba(245,158,11,0.10)':'var(--bg-surface)'}'"
      onmouseout="this.style.background='${isPending?'rgba(245,158,11,0.05)':''}'">
      <td style="padding:10px 16px;color:var(--text-muted);font-size:0.8125rem;">${esc(d.continent || '—')}</td>
      <td style="padding:10px 16px;font-weight:500;">${esc(d.country || '—')}</td>
      <td style="padding:10px 16px;color:var(--text-secondary);">
        ${esc(d.city || '—')}
        ${isPending ? `<span style="display:inline-block;margin-left:6px;font-size:0.65rem;padding:1px 6px;
          background:var(--badge-warn-bg,rgba(245,158,11,0.16));color:var(--color-warn-text,#92400e);
          border-radius:999px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;"
          title="Aguardando revisão master.">⏳ Pendente</span>` : ''}
        ${srcBadge.icon ? `<span style="display:inline-block;margin-left:4px;font-size:0.65rem;padding:1px 6px;
          background:transparent;color:${srcBadge.color};border:1px solid ${srcBadge.color};
          border-radius:999px;font-weight:600;letter-spacing:.02em;"
          title="${source === 'envision-auto' ? 'Criado via bolsão de triagem geo (Corrigir geo no Banco de Roteiros)' : source === 'banco-auto' ? 'Auto-criado pelo populate inicial v4.60.0 (cidades do banco sem destino canônico)' : 'Criado manualmente'}">
          ${srcBadge.icon} ${esc(srcBadge.label)}
        </span>` : ''}
      </td>
      <td style="padding:10px 16px;text-align:right;">
        <div style="display:flex;gap:6px;justify-content:flex-end;align-items:center;">
          ${isPending ? `<button class="btn btn-primary btn-sm" data-approve="${d.id}"
            style="font-size:0.72rem;padding:3px 10px;" title="Aprovar destino — vira parte canônica do SSOT">
            ✓ Aprovar
          </button>` : ''}
          <button class="btn btn-ghost btn-sm" data-edit="${d.id}"
            style="font-size:0.75rem;color:var(--brand-blue,#3B82F6);" title="Editar destino (nome, país, aliases…)">
            ✎ Editar
          </button>
          <!-- v4.62.5+v4.62.7+v4.62.9: botão Dica usa <button> + sessionStorage
               em vez de <a href> (URL param era perdido no boot inicial — abria
               como nova dica mesmo havendo tip existente). sessionStorage é
               consumido pelo editor no boot e removido após uso. -->
          ${(() => {
            const tips = tipsByDestId.get(d.id) || [];
            const baseAttrs = `class="btn btn-ghost btn-sm dest-open-tip" data-dest-id="${d.id}"`;
            if (tips.length) {
              return `<button ${baseAttrs}
                style="font-size:0.75rem;color:var(--brand-gold);"
                title="Editar a dica deste destino">
                💡 Dica <span style="background:var(--brand-gold);color:#0A1628;padding:0 6px;border-radius:999px;font-size:0.65rem;font-weight:700;margin-left:2px;">${tips.length}</span>
              </button>`;
            }
            return `<button ${baseAttrs}
              style="font-size:0.75rem;color:var(--text-muted);opacity:0.7;"
              title="Cadastrar dica pra este destino">
              💡 Dica
            </button>`;
          })()}
          ${(() => {
            const refs = roteirosByDestId.get(d.id) || [];
            if (!refs.length) return `<span class="btn btn-ghost btn-sm" style="font-size:0.75rem;color:var(--text-muted);opacity:0.5;cursor:default;" title="Sem roteiros vinculados">📋 Roteiro</span>`;
            return `<button class="btn btn-ghost btn-sm" data-view-roteiros="${d.id}"
              style="font-size:0.75rem;color:var(--brand-blue,#3B82F6);"
              title="Ver ${refs.length} roteiro(s) vinculado(s) a este destino">
              📋 Roteiro <span style="background:var(--brand-blue,#3B82F6);color:#fff;padding:0 6px;border-radius:999px;font-size:0.65rem;font-weight:700;margin-left:2px;">${refs.length}</span>
            </button>`;
          })()}
          <button class="btn btn-ghost btn-sm" data-delete="${d.id}"
            style="font-size:0.75rem;color:var(--color-danger,#EF4444);" title="Excluir destino">✕</button>
        </div>
      </td>
    </tr>
  `;}).join('');

  tbody.querySelectorAll('[data-edit]').forEach(btn =>
    btn.addEventListener('click', () => showDestModal(allDests.find(d => d.id === btn.dataset.edit))));
  tbody.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => handleDelete(btn.dataset.delete,
      allDests.find(d => d.id === btn.dataset.delete))));
  // v4.60.0: handler aprovar (flip reviewStatus pra 'approved')
  tbody.querySelectorAll('[data-approve]').forEach(btn =>
    btn.addEventListener('click', () => handleApprove(btn.dataset.approve,
      allDests.find(d => d.id === btn.dataset.approve))));
  // v4.62.2: handler ver roteiros vinculados (cross-module reverso)
  tbody.querySelectorAll('[data-view-roteiros]').forEach(btn =>
    btn.addEventListener('click', () => _openLinkedRoteirosModal(
      btn.dataset.viewRoteiros,
      allDests.find(d => d.id === btn.dataset.viewRoteiros))));
  // v4.62.9: handler botão Dica — usa sessionStorage pra passar destId
  // (URL param era perdido no boot inicial). Editor consome no boot e remove.
  tbody.querySelectorAll('.dest-open-tip').forEach(btn =>
    btn.addEventListener('click', () => {
      const destId = btn.dataset.destId;
      if (!destId) return;
      try { sessionStorage.setItem('tipEditor.pendingDestId', destId); } catch {}
      location.hash = '#portal-tip-editor';
    }));
}

/**
 * v4.62.2 — modal lista roteiros do banco vinculados a este destination.
 * UX paralela ao botão 💡 Dica — fecha o ciclo reverso (destino → roteiros).
 */
async function _openLinkedRoteirosModal(destId, dest) {
  const refs = roteirosByDestId.get(destId) || [];
  if (!refs.length) return;
  const { modal } = await import('../components/modal.js');
  const cityLabel = [dest?.city, dest?.country].filter(Boolean).join(', ');

  // Status badges (cores semânticas alinhadas ao Banco)
  const STATUS_STYLES = {
    approved: { label: 'Publicado',  bg: 'rgba(16,185,129,0.16)',  color: '#065f46' },
    review:   { label: 'Em revisão', bg: 'rgba(245,158,11,0.16)',  color: '#92400e' },
    draft:    { label: 'Rascunho',   bg: 'rgba(107,114,128,0.12)', color: '#374151' },
    archived: { label: 'Arquivado',  bg: 'rgba(220,38,38,0.12)',   color: '#991b1b' },
  };

  // Sort: approved primeiro, depois review, depois resto
  const sortOrder = { approved: 1, review: 2, draft: 3, archived: 4 };
  const sortedRefs = [...refs].sort((a, b) =>
    (sortOrder[a.status] || 99) - (sortOrder[b.status] || 99) ||
    a.title.localeCompare(b.title, 'pt-BR'));

  modal.open({
    title: `📋 Roteiros vinculados — ${esc(cityLabel)}`,
    size: 'md',
    closeOnEsc: true,
    content: `
      <div style="line-height:1.5;">
        <p style="margin:0 0 14px;font-size:0.8rem;color:var(--text-muted);">
          <strong>${refs.length}</strong> roteiro${refs.length !== 1 ? 's' : ''} do banco
          ${refs.length === 1 ? 'vincula' : 'vinculam'} este destino em ${esc(dest?.city || 'cidade')}.
          Clique pra abrir no editor.
        </p>
        <div style="display:flex;flex-direction:column;gap:6px;max-height:50vh;overflow:auto;">
          ${sortedRefs.map(r => {
            const st = STATUS_STYLES[r.status] || STATUS_STYLES.draft;
            return `
              <a href="#banco-roteiro-editor?id=${esc(r.id)}"
                style="display:flex;align-items:center;gap:10px;padding:8px 12px;
                border:1px solid var(--border-subtle);border-radius:6px;
                text-decoration:none;color:var(--text-primary);
                background:var(--bg-surface);transition:background 0.1s;"
                onmouseover="this.style.background='var(--bg-hover,rgba(0,0,0,0.04))'"
                onmouseout="this.style.background='var(--bg-surface)'">
                <span style="flex:1;font-size:0.85rem;font-weight:500;">${esc(r.title)}</span>
                <span style="padding:2px 8px;border-radius:999px;font-size:0.65rem;
                  font-weight:600;background:${st.bg};color:${st.color};white-space:nowrap;">
                  ${esc(st.label)}
                </span>
              </a>
            `;
          }).join('')}
        </div>
        <p style="margin:12px 0 0;font-size:0.72rem;color:var(--text-muted);">
          💡 Vinculação por ID. Renomear/editar este destino preserva refs cross-module.
        </p>
      </div>
    `,
    footer: [{ label: 'Fechar', class: 'btn-primary' }],
  });
}

/** v4.60.0: aprova destino pending → reviewStatus='approved'.
 *  v4.60.2: detecta DUPLICATE (já existe approved com mesma cidade ou alias)
 *  e oferece mesclar inline via modal — sem permitir duplicata silenciosa. */
/**
 * v4.61.0 Feature B — renderiza tabela da aba "Variações de nome".
 * Cada linha: país | cidade canônica | chips de aliases (add inline) | salvar.
 * Permite edição rápida em massa sem abrir modal por destino.
 */
function _renderAliasesTab() {
  const tbody = document.getElementById('aliases-tbody');
  if (!tbody) return;
  const search = (document.getElementById('dest-aliases-search')?.value || '').toLowerCase().trim();
  const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  let rows = allDests.slice().sort((a, b) =>
    (a.country||'').localeCompare(b.country||'', 'pt-BR') ||
    (a.city||'').localeCompare(b.city||'', 'pt-BR'));

  // Esconde docs com city vazio (não dá pra ter alias sem nome canônico)
  rows = rows.filter(d => d.city);

  if (search) {
    const ns = norm(search);
    rows = rows.filter(d =>
      norm(d.country).includes(ns) ||
      norm(d.city).includes(ns) ||
      (d.cityAliases || []).some(a => norm(a).includes(ns)));
  }

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="padding:48px;text-align:center;color:var(--text-muted);">
      Nenhum destino encontrado.
    </td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(d => {
    const aliases = Array.isArray(d.cityAliases) ? d.cityAliases : [];
    const isPending = (d.reviewStatus || 'approved') === 'pending';
    return `
      <tr data-row-id="${d.id}" style="border-bottom:1px solid var(--border-subtle);
        background:${isPending ? 'rgba(245,158,11,0.04)' : ''};">
        <td style="padding:10px 16px;color:var(--text-muted);font-size:0.78rem;white-space:nowrap;">
          ${esc(d.country)}
          ${isPending ? `<span style="display:block;font-size:0.62rem;color:var(--color-warn-text,#92400e);font-weight:600;text-transform:uppercase;margin-top:2px;">⏳ Pending</span>` : ''}
        </td>
        <td style="padding:10px 16px;font-weight:600;white-space:nowrap;">${esc(d.city)}</td>
        <td style="padding:10px 16px;">
          <div data-aliases-cell="${d.id}" style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;
            border:1px solid var(--border-subtle);border-radius:6px;padding:5px 8px;min-height:32px;
            background:var(--bg-input,#fff);">
            <div data-aliases-list="${d.id}" style="display:flex;flex-wrap:wrap;gap:4px;">
              ${aliases.map((a, i) => `
                <span style="display:inline-flex;align-items:center;gap:3px;padding:1px 7px;
                  border-radius:999px;background:var(--brand-gold,#D4A843);color:#0A1628;
                  font-size:0.72rem;font-weight:600;">
                  ${esc(a)}
                  <button type="button" data-row-remove-alias="${d.id}" data-alias-idx="${i}"
                    style="background:none;border:none;color:#0A1628;cursor:pointer;padding:0;
                    font-size:0.78rem;line-height:1;font-weight:700;opacity:0.7;">×</button>
                </span>
              `).join('')}
            </div>
            <input type="text" data-row-alias-input="${d.id}"
              placeholder="${aliases.length ? '+ adicionar' : 'Digite e Enter pra adicionar'}"
              style="flex:1;min-width:100px;border:none;outline:none;padding:2px 4px;
              font-size:0.78rem;background:transparent;color:var(--text-primary);">
          </div>
        </td>
        <td style="padding:10px 16px;text-align:right;white-space:nowrap;">
          <!-- v4.62.6: indicador status do autosave (CLAUDE.md §11.b).
               Atualizado dinamicamente por _setAliasSaveStatus(id, state). -->
          <span data-save-status="${d.id}" style="font-size:0.72rem;color:var(--text-muted);
            opacity:0;transition:opacity .25s;">—</span>
        </td>
      </tr>
    `;
  }).join('');

  // Handlers por linha
  tbody.querySelectorAll('[data-row-alias-input]').forEach(input => {
    const id = input.dataset.rowAliasInput;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = input.value.trim().replace(/,$/, '');
        if (!val) return;
        const dest = allDests.find(d => d.id === id);
        if (!dest) return;
        if (norm(val) === norm(dest.city)) { toast.info('Esse já é o nome canônico.'); input.value=''; return; }
        const aliases = Array.isArray(dest.cityAliases) ? dest.cityAliases : [];
        if (aliases.some(a => norm(a) === norm(val))) { toast.info('Já adicionado.'); input.value=''; return; }
        aliases.push(val);
        dest.cityAliases = aliases;
        _renderAliasesTab();    // re-render reflete chip novo
        // v4.62.6: autosave silencioso imediato (sem botão Salvar manual)
        _saveAliasesForId(id, { silent: true });
      }
    });
  });
  tbody.querySelectorAll('[data-row-remove-alias]').forEach(btn =>
    btn.addEventListener('click', () => {
      const id = btn.dataset.rowRemoveAlias;
      const idx = +btn.dataset.aliasIdx;
      const dest = allDests.find(d => d.id === id);
      if (!dest || !Array.isArray(dest.cityAliases)) return;
      dest.cityAliases.splice(idx, 1);
      _renderAliasesTab();
      _saveAliasesForId(id, { silent: true });   // autosave remoção
    }));
}

/**
 * v4.62.6 — atualiza indicador inline do autosave da linha.
 * Estados: 'saving' | 'saved' | 'error' | 'idle'.
 * 'saved' faz fade-out automático após 2.5s (volta pra idle invisível).
 */
function _setAliasSaveStatus(id, state, msg) {
  const el = document.querySelector(`[data-save-status="${id}"]`);
  if (!el) return;
  // Cancela timer anterior se houver
  if (el._fadeTimer) { clearTimeout(el._fadeTimer); el._fadeTimer = null; }

  if (state === 'saving') {
    el.textContent = '⟳ Salvando…';
    el.style.color = 'var(--text-muted)';
    el.style.opacity = '1';
  } else if (state === 'saved') {
    el.textContent = '✓ Salvo';
    el.style.color = 'var(--brand-green,#10B981)';
    el.style.opacity = '1';
    el._fadeTimer = setTimeout(() => { el.style.opacity = '0'; }, 2500);
  } else if (state === 'error') {
    el.textContent = '⚠ ' + (msg || 'Erro — tente de novo');
    el.style.color = 'var(--color-danger,#EF4444)';
    el.style.opacity = '1';
  } else {
    el.style.opacity = '0';
  }
}

/**
 * v4.62.6 — opts.silent suprime toast.success (mantém toast.error)
 * + atualiza indicador inline via _setAliasSaveStatus.
 */
async function _saveAliasesForId(id, opts = {}) {
  const { silent = false } = opts;
  const dest = allDests.find(d => d.id === id);
  if (!dest) return;
  _setAliasSaveStatus(id, 'saving');
  try {
    await saveDestination(id, {
      continent: dest.continent,
      country:   dest.country,
      city:      dest.city,
      countryCode:   dest.countryCode,
      continentCode: dest.continentCode,
      notes:        dest.notes || '',
      cityAliases:  Array.isArray(dest.cityAliases) ? dest.cityAliases : [],
      reviewStatus: dest.reviewStatus || 'approved',
      source:       dest.source || 'manual',
    });
    _setAliasSaveStatus(id, 'saved');
    if (!silent) toast.success(`${dest.city}: variações atualizadas.`);
  } catch (e) {
    if (e?.code === 'DUPLICATE') {
      _setAliasSaveStatus(id, 'error', 'Colide com canônico');
      toast.error(`"${dest.city}" colide com canônico existente "${e.mergeTargetCity}". Abra "Destinos" pra mesclar.`);
    } else {
      _setAliasSaveStatus(id, 'error', 'Erro salvar');
      toast.error('Erro ao salvar: ' + e.message);
    }
  }
}

async function handleApprove(id, dest) {
  if (!dest) return;
  try {
    await saveDestination(id, {
      continent: dest.continent,
      country: dest.country,
      city: dest.city,
      countryCode: dest.countryCode,
      continentCode: dest.continentCode,
      notes: dest.notes || '',
      reviewStatus: 'approved',
      source: dest.source,
    });
    toast.success(`Aprovado: ${[dest.city, dest.country].filter(Boolean).join(', ')}.`);
    allDests = await fetchDestinations();
    renderTable();
  } catch (e) {
    if (e?.code === 'DUPLICATE') {
      await _handleDuplicateMergeFlow(id, dest, e);
      return;
    }
    toast.error('Erro ao aprovar: ' + e.message);
  }
}

/**
 * v4.60.2: fluxo de merge quando aprovação detecta duplicata.
 * Mostra modal "Mesclar com existente?" + 2 ações.
 */
async function _handleDuplicateMergeFlow(duplicateId, dupDest, dupErr) {
  const { modal } = await import('../components/modal.js');
  const tryingCity = [dupDest.city, dupDest.country].filter(Boolean).join(', ');
  const existing = `${dupErr.mergeTargetCity}${dupErr.mergeTargetAliases?.length
    ? ` (aliases: ${dupErr.mergeTargetAliases.join(', ')})`
    : ''}`;
  let resolved = false;
  await new Promise(resolve => {
    const handle = modal.open({
      title: '⚠ Já existe destino aprovado equivalente',
      size: 'md', closeOnEsc: true,
      content: `
        <div style="line-height:1.5;">
          <p style="margin:0 0 10px;">Você está tentando aprovar <strong>"${esc(tryingCity)}"</strong>,
          mas já existe um destino aprovado equivalente no mesmo país:</p>
          <p style="margin:0 0 12px;background:var(--bg-surface);padding:8px 12px;border-radius:6px;
            border:1px solid var(--border-subtle);font-weight:600;">
            ✓ ${esc(existing)} <span style="color:var(--text-muted);font-weight:400;">— canônico</span>
          </p>
          <p style="margin:0 0 8px;"><strong>Mesclar</strong> (recomendado):</p>
          <ul style="margin:0 0 12px 18px;font-size:0.88rem;color:var(--text-secondary);">
            <li>"${esc(dupDest.city)}" vira <strong>alias</strong> do canônico</li>
            <li>FKs cross-module (imagens / dicas / banco de roteiros) redirecionam pro canônico</li>
            <li>Este pending é deletado</li>
          </ul>
          <p style="margin:0;font-size:0.78rem;color:var(--text-muted);">
            <strong>Cancelar</strong> mantém o pending pendente — você pode editá-lo manualmente depois (ex: renomear pra cidade distinta).
          </p>
        </div>
      `,
      footer: [
        { label: 'Cancelar', class: 'btn-secondary' },
        {
          label: 'Mesclar com canônico', class: 'btn-primary',
          onClick: async () => {
            resolved = true;
            try {
              const res = await mergeDestinations(dupErr.mergeTargetId, duplicateId);
              toast.success(`Mesclado em "${dupErr.mergeTargetCity}". ${res.redirected ? res.redirected + ' refs cross-module atualizadas.' : ''}`);
              allDests = await fetchDestinations();
              renderTable();
            } catch (e) { toast.error('Erro ao mesclar: ' + e.message); }
          },
        },
      ],
      onClose: () => { resolve(); },
    });
  });
}

function showDestModal(dest) {
  const modal = document.getElementById('dest-modal');
  if (!modal) return;
  modal.style.cssText = `display:flex;position:fixed;inset:0;background:rgba(0,0,0,.6);
    z-index:1000;align-items:center;justify-content:center;padding:20px;`;

  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:480px;padding:28px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h3 style="margin:0;font-size:1rem;">${dest ? 'Editar Destino' : 'Novo Destino'}</h3>
        <button id="dest-modal-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">Continente *</label>
          <select id="dest-continent" class="filter-select" style="width:100%;">
            <option value="">Selecione</option>
            ${CONTINENTS.map(c => `<option value="${esc(c)}" ${dest?.continent===c?'selected':''}>${esc(c)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">
            País *
            <span style="font-weight:400;color:var(--text-muted);">— digite ou escolha da lista</span>
          </label>
          <input type="text" id="dest-country" class="filter-select" style="width:100%;"
            placeholder="Ex: França" value="${esc(dest?.country || '')}"
            list="dest-countries-datalist" autocomplete="off">
          <datalist id="dest-countries-datalist">
            ${COUNTRIES.slice()
              .sort((a, b) => a.pt.localeCompare(b.pt, 'pt-BR'))
              .map(c => `<option value="${esc(c.pt)}">${esc(c.en)}${c.aliases ? ' · ' + esc(c.aliases.slice(0,2).join(', ')) : ''}</option>`)
              .join('')}
          </datalist>
          <div id="dest-country-feedback" style="font-size:0.7rem;margin-top:4px;min-height:14px;"></div>
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">
            Cidade / Região <span style="font-weight:400;color:var(--text-muted);">(opcional)</span>
          </label>
          <input type="text" id="dest-city" class="filter-select" style="width:100%;"
            placeholder="Ex: Paris" value="${esc(dest?.city || '')}">
        </div>
        <!-- v4.61.0 Feature A: chips de aliases inline -->
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">
            Variações de nome <span style="font-weight:400;color:var(--text-muted);">(aliases)</span>
          </label>
          <div id="dest-aliases-wrap" style="border:1px solid var(--border-default,var(--border-subtle));
            border-radius:6px;padding:6px 8px;min-height:36px;display:flex;flex-wrap:wrap;gap:4px;
            align-items:center;background:var(--bg-input,#fff);">
            <div id="dest-aliases-chips" style="display:flex;flex-wrap:wrap;gap:4px;"></div>
            <input type="text" id="dest-alias-input" placeholder="Digite e Enter pra adicionar (ex: Tokyo)"
              style="flex:1;min-width:140px;border:none;outline:none;padding:3px 4px;
              font-size:0.8125rem;background:transparent;color:var(--text-primary);">
          </div>
          <p style="font-size:0.7rem;color:var(--text-muted);margin:4px 0 0;line-height:1.4;">
            Sistema reconhece estas grafias como a mesma cidade no cross-module
            (banco, imagens, dicas). Ex: "Cape Town" como alias de "Cidade do Cabo".
          </p>
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">Notas internas</label>
          <textarea id="dest-notes" class="filter-select" style="width:100%;height:60px;resize:vertical;"
            placeholder="Informações de referência...">${esc(dest?.notes || '')}</textarea>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:20px;">
        <button class="btn btn-secondary" id="dest-modal-cancel" style="flex:1;">Cancelar</button>
        <button class="btn btn-primary" id="dest-modal-save" style="flex:2;">
          ${dest ? 'Salvar' : 'Criar Destino'}
        </button>
      </div>
    </div>
  `;

  const close = () => { modal.style.display = 'none'; modal.innerHTML = ''; };
  document.getElementById('dest-modal-close')?.addEventListener('click', close);
  document.getElementById('dest-modal-cancel')?.addEventListener('click', close);

  // v4.61.1 — validação live país + auto-fill continente
  // Mapa continentCode SSOT (UN M.49) → label legacy CONTINENTS (pt) usado no select.
  const CONTINENT_CODE_TO_LEGACY = {
    AF: 'África', AS: 'Ásia', EU: 'Europa',
    NA: 'América do Norte', SA: 'América do Sul',
    OC: 'Oceania', AN: 'Antártica',
  };
  const countryEl = document.getElementById('dest-country');
  const contEl = document.getElementById('dest-continent');
  const feedbackEl = document.getElementById('dest-country-feedback');
  function _validateCountry() {
    if (!countryEl || !feedbackEl) return null;
    const raw = (countryEl.value || '').trim();
    if (!raw) {
      feedbackEl.textContent = '';
      countryEl.style.borderColor = '';
      return null;
    }
    const resolved = resolveCountry(raw);
    if (!resolved) {
      feedbackEl.innerHTML = `<span style="color:var(--color-danger,#dc2626);">⚠ "${esc(raw)}" não está na lista de países. Escolha da lista pra evitar typo.</span>`;
      countryEl.style.borderColor = 'var(--color-danger,#dc2626)';
      return null;
    }
    countryEl.style.borderColor = 'var(--color-success,#10b981)';
    // Normaliza valor pro canônico pt-BR (corrige case/grafias en)
    if (raw !== resolved.pt) {
      feedbackEl.innerHTML = `<span style="color:var(--color-success,#10b981);">✓ Reconhecido como "${esc(resolved.pt)}" (${esc(resolved.code)})</span>`;
    } else {
      feedbackEl.innerHTML = `<span style="color:var(--color-success,#10b981);">✓ ${esc(resolved.code)} · ${esc(CONTINENT_CODE_TO_LEGACY[resolved.continent] || '')}</span>`;
    }
    return resolved;
  }
  if (countryEl) {
    countryEl.addEventListener('input', () => {
      const r = _validateCountry();
      // Auto-fill continente se vazio (não sobrescreve escolha do user)
      if (r && contEl && !contEl.value) {
        const legacyLabel = CONTINENT_CODE_TO_LEGACY[r.continent];
        if (legacyLabel) contEl.value = legacyLabel;
      }
    });
    countryEl.addEventListener('change', () => {
      // Ao escolher do datalist (browser dispara change), normaliza pro canônico
      const r = _validateCountry();
      if (r && countryEl.value !== r.pt) {
        countryEl.value = r.pt;
        _validateCountry();
      }
      // Auto-fill continente se vazio
      if (r && contEl && !contEl.value) {
        const legacyLabel = CONTINENT_CODE_TO_LEGACY[r.continent];
        if (legacyLabel) contEl.value = legacyLabel;
      }
    });
    _validateCountry();   // valida estado inicial (edit mode)
  }

  // v4.61.0 Feature A: state + render de chips de aliases
  let aliases = Array.isArray(dest?.cityAliases) ? [...dest.cityAliases] : [];
  function renderAliasChips() {
    const wrap = document.getElementById('dest-aliases-chips');
    if (!wrap) return;
    wrap.innerHTML = aliases.map((a, i) => `
      <span data-alias-idx="${i}" style="display:inline-flex;align-items:center;gap:4px;
        padding:2px 8px;border-radius:999px;background:var(--brand-gold,#D4A843);
        color:#0A1628;font-size:0.75rem;font-weight:600;">
        ${esc(a)}
        <button type="button" data-remove-alias="${i}" aria-label="Remover"
          style="background:none;border:none;color:#0A1628;cursor:pointer;padding:0;
          font-size:0.85rem;line-height:1;opacity:0.7;font-weight:700;">×</button>
      </span>
    `).join('');
    wrap.querySelectorAll('[data-remove-alias]').forEach(btn =>
      btn.addEventListener('click', () => {
        aliases.splice(+btn.dataset.removeAlias, 1);
        renderAliasChips();
      }));
  }
  renderAliasChips();
  const aliasInput = document.getElementById('dest-alias-input');
  if (aliasInput) {
    aliasInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = aliasInput.value.trim().replace(/,$/, '');
        if (!val) return;
        // Skip se já é a cidade canônica ou já está em aliases
        const cityNow = document.getElementById('dest-city')?.value?.trim() || '';
        const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        if (norm(val) === norm(cityNow)) { toast.info('Esse já é o nome canônico.'); aliasInput.value=''; return; }
        if (aliases.some(a => norm(a) === norm(val))) { toast.info('Já adicionado.'); aliasInput.value=''; return; }
        aliases.push(val);
        renderAliasChips();
        aliasInput.value = '';
      }
    });
    // Foco visual: click no wrap delega pro input
    document.getElementById('dest-aliases-wrap')?.addEventListener('click', (e) => {
      if (!e.target.matches('[data-remove-alias]')) aliasInput.focus();
    });
  }

  document.getElementById('dest-modal-save')?.addEventListener('click', async () => {
    const continent = document.getElementById('dest-continent')?.value;
    let country     = document.getElementById('dest-country')?.value?.trim();
    if (!continent) { toast.error('Selecione o continente.'); return; }
    if (!country)   { toast.error('País obrigatório.'); return; }
    // v4.61.1: valida país contra SSOT — rejeita typos antes de gravar
    const resolved = resolveCountry(country);
    if (!resolved) {
      toast.error(`"${country}" não está na lista. Escolha um país válido (datalist sugere ao digitar).`);
      document.getElementById('dest-country')?.focus();
      return;
    }
    // Normaliza pro canônico pt-BR antes de salvar
    country = resolved.pt;
    const countryEl2 = document.getElementById('dest-country');
    if (countryEl2 && countryEl2.value !== country) countryEl2.value = country;
    // v4.61.0: pega valor pending do input de aliases (se user esqueceu de pressionar Enter)
    const pendingAlias = (document.getElementById('dest-alias-input')?.value || '').trim();
    if (pendingAlias) {
      const cityNow = document.getElementById('dest-city')?.value?.trim() || '';
      const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (norm(pendingAlias) !== norm(cityNow) && !aliases.some(a => norm(a) === norm(pendingAlias))) {
        aliases.push(pendingAlias);
      }
    }
    const btn = document.getElementById('dest-modal-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
    const payload = {
      continent,
      country,
      city:  document.getElementById('dest-city')?.value?.trim() || '',
      notes: document.getElementById('dest-notes')?.value?.trim() || '',
      cityAliases: aliases,   // v4.61.0
    };
    try {
      await saveDestination(dest?.id || null, payload);
      toast.success(`Destino ${dest ? 'atualizado' : 'criado'}.`);
      close();
      allDests = await fetchDestinations();
      renderTable();
    } catch(e) {
      // v4.60.2: DUPLICATE → oferece merge inline (mesma UX do approve)
      if (e?.code === 'DUPLICATE') {
        if (dest?.id) {
          // Existe doc atual sendo editado — pode tentar mesclá-lo no canônico
          close();
          await _handleDuplicateMergeFlow(dest.id, { ...dest, ...payload }, e);
        } else {
          // Save de doc NOVO: nada pra mesclar, só explica. Mantém modal aberto pro user corrigir.
          toast.error(`Já existe "${e.mergeTargetCity}" em ${e.mergeTargetCountry}. Renomeie ou cancele.`);
          if (btn) { btn.disabled = false; btn.textContent = 'Criar Destino'; }
        }
        return;
      }
      toast.error('Erro: ' + e.message);
      if (btn) { btn.disabled = false; btn.textContent = dest ? 'Salvar' : 'Criar Destino'; }
    }
  });
}

async function handleDelete(id, dest) {
  const label = [dest?.city, dest?.country, dest?.continent].filter(Boolean).join(', ');
  if (!confirm(`Excluir o destino "${label}"?`)) return;
  try {
    await deleteDestination(id);
    toast.success('Destino excluído.');
    allDests = await fetchDestinations();
    renderTable();
  } catch(e) { toast.error('Erro: ' + e.message); }
}
