/**
 * PRIMETOUR — Portal de Dicas
 * Página principal: seleção de área, destino e segmentos → geração de material
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import {
  fetchAreas, fetchDestinations, fetchContinentsWithContent,
  fetchTip, fetchAvailableSegments, checkDownloadLimit,
  hasAcceptedTerms, getActiveTerms, acceptTerms,
  recordGeneration, registerDownload, fetchImages,
  SEGMENTS, GENERATION_FORMATS,
} from '../services/portal.js';
import { generateTip } from '../services/portalGenerator.js';

const esc = s => String(s||'').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ════════════════════════════════════════════════════════════
   Hub principal — Portal de Dicas com tabs internas
   ════════════════════════════════════════════════════════════ */

let _activeTab = 'generate';

export async function renderPortalTips(container, requestedTab) {
  if (!store.canPortal()) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
      <div class="empty-state-subtitle">Você não tem permissão para acessar o Portal de Dicas.</div>
    </div>`;
    return;
  }

  // Check terms acceptance
  const terms = await getActiveTerms();
  if (terms) {
    const accepted = await hasAcceptedTerms(terms.id);
    if (!accepted) {
      renderTermsModal(container, terms, () => renderPortalTips(container));
      return;
    }
  }

  // Determinar tab ativa (via parâmetro, URL ou default)
  const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const tabParam = requestedTab || urlParams.get('tab');
  if (tabParam === 'list' || tabParam === 'import') _activeTab = tabParam;
  else if (!requestedTab) _activeTab = 'generate';

  // Tabs disponíveis (baseado em permissões)
  const tabs = [
    { id: 'generate', icon: '✈', label: 'Gerar Material', perm: 'portal_access' },
  ];
  if (store.canCreateTip()) {
    tabs.push({ id: 'list',   icon: '◈', label: 'Dicas Cadastradas', perm: 'portal_create' });
    tabs.push({ id: 'import', icon: '↑', label: 'Importar Dicas',    perm: 'portal_create' });
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Portal de Dicas</h1>
        <p class="page-subtitle">Gerencie e gere materiais personalizados para seus clientes</p>
      </div>
      ${store.canCreateTip() ? `
        <div class="page-header-actions">
          <button class="btn btn-secondary btn-sm" onclick="location.hash='portal-destinations'">
            ◈ Destinos
          </button>
          <button class="btn btn-secondary btn-sm" onclick="location.hash='portal-areas'">
            ◈ Áreas
          </button>
          <button class="btn btn-primary btn-sm" onclick="location.hash='portal-tip-editor'">
            + Nova Dica
          </button>
        </div>
      ` : ''}
    </div>

    <!-- Tabs de navegação interna -->
    ${tabs.length > 1 ? `
    <div class="portal-hub-tabs" style="display:flex;gap:2px;margin-bottom:20px;
      background:var(--bg-dark);border-radius:var(--radius-md);padding:3px;width:fit-content;">
      ${tabs.map(t => `
        <button class="portal-hub-tab ${_activeTab === t.id ? 'active' : ''}" data-tab="${t.id}"
          style="padding:8px 18px;border:none;border-radius:var(--radius-sm);cursor:pointer;
          font-family:inherit;font-size:0.8125rem;font-weight:500;transition:all .15s;
          ${_activeTab === t.id
            ? 'background:linear-gradient(135deg,#D4A843,#B8922F);color:#0C1926;'
            : 'background:transparent;color:var(--text-muted);'}">
          ${t.icon} ${t.label}
        </button>
      `).join('')}
    </div>
    ` : ''}

    <!-- Conteúdo da tab ativa -->
    <div id="portal-hub-content"></div>
  `;

  // Bind tabs
  container.querySelectorAll('.portal-hub-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab === _activeTab) return;
      _activeTab = tab;
      renderPortalTips(container, tab);
    });
  });

  // Renderizar conteúdo da tab ativa
  const hubContent = container.querySelector('#portal-hub-content');
  if (_activeTab === 'list') {
    const { renderPortalTipsList } = await import('./portalTipsList.js');
    await renderPortalTipsList(hubContent, { embedded: true });
  } else if (_activeTab === 'import') {
    const { renderPortalImport } = await import('./portalImport.js');
    await renderPortalImport(hubContent, { embedded: true });
  } else {
    await renderGenerateTab(hubContent);
  }
}

/* ════════════════════════════════════════════════════════════
   Tab "Gerar Material" — conteúdo original do Portal de Dicas
   ════════════════════════════════════════════════════════════ */

async function renderGenerateTab(container) {
  const limitInfo = await checkDownloadLimit();

  container.innerHTML = `
    ${store.isPartner() ? `
      <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-md);
        padding:12px 16px;margin-bottom:20px;display:flex;align-items:center;gap:10px;">
        <span style="font-size:1.125rem;">📥</span>
        <span style="font-size:0.875rem;color:var(--text-secondary);">
          Downloads hoje: <strong style="color:${limitInfo.remaining > 1 ? 'var(--text-primary)' : '#EF4444'};">
            ${limitInfo.count} / ${5}
          </strong>
          ${limitInfo.remaining <= 0 ? ' — Limite diário atingido.' : ` — ${limitInfo.remaining} restante${limitInfo.remaining !== 1 ? 's' : ''}.`}
        </span>
      </div>
    ` : ''}

    <!-- Generation form -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:1100px;">

      <!-- Left: Selection -->
      <div>
        <div class="card" style="padding:24px;margin-bottom:16px;">
          <h3 style="font-size:0.875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
            color:var(--text-muted);margin:0 0 16px;">1 · Área</h3>
          <div id="portal-areas-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
            <div class="skeleton" style="height:64px;border-radius:var(--radius-md);"></div>
            <div class="skeleton" style="height:64px;border-radius:var(--radius-md);"></div>
            <div class="skeleton" style="height:64px;border-radius:var(--radius-md);"></div>
          </div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:16px;">
          <h3 style="font-size:0.875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
            color:var(--text-muted);margin:0 0 16px;">2 · Destino</h3>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <select class="filter-select" id="portal-continent" style="width:100%;">
              <option value="">Carregando continentes…</option>
            </select>
            <select class="filter-select" id="portal-country" style="width:100%;" disabled>
              <option value="">Selecione o país</option>
            </select>
            <select class="filter-select" id="portal-city" style="width:100%;" disabled>
              <option value="">Cidade/Região (opcional)</option>
            </select>
          </div>

          <!-- Add destination button -->
          <div style="margin-top:12px;display:flex;gap:8px;align-items:center;">
            <button class="btn btn-ghost btn-sm" id="portal-add-dest-btn"
              style="font-size:0.75rem;color:var(--brand-gold);">
              + Combinar outro destino
            </button>
          </div>
          <div id="portal-extra-dests"></div>
        </div>

        <div class="card" style="padding:24px;">
          <h3 style="font-size:0.875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
            color:var(--text-muted);margin:0 0 16px;">3 · Segmentos</h3>
          <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
            <button class="btn btn-ghost btn-sm" id="portal-seg-all" style="font-size:0.75rem;">
              Todos
            </button>
            <button class="btn btn-ghost btn-sm" id="portal-seg-none" style="font-size:0.75rem;">
              Nenhum
            </button>
          </div>
          <div id="portal-segments" style="display:flex;flex-direction:column;gap:6px;">
            <div style="font-size:0.8125rem;color:var(--text-muted);padding:8px 0;text-align:center;">
              Selecione um destino para ver os segmentos disponíveis.
            </div>
          </div>
        </div>
      </div>

      <!-- Right: Preview + Generate -->
      <div>
        <div class="card" style="padding:24px;margin-bottom:16px;">
          <h3 style="font-size:0.875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
            color:var(--text-muted);margin:0 0 16px;">Formato de saída</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            ${GENERATION_FORMATS.map(f => `
              <label style="display:flex;align-items:center;gap:8px;padding:10px 12px;
                border:1px solid var(--border-subtle);border-radius:var(--radius-md);
                cursor:pointer;transition:all .15s;"
                id="fmt-label-${f.key}"
                onmouseover="this.style.borderColor='var(--brand-gold)'"
                onmouseout="document.querySelector('input[value=${f.key}]').checked?null:this.style.borderColor='var(--border-subtle)'">
                <input type="radio" name="format" value="${f.key}" ${f.key === 'pdf' ? 'checked' : ''}
                  style="accent-color:var(--brand-gold);"
                  onchange="document.querySelectorAll('[id^=fmt-label-]').forEach(l=>l.style.borderColor='var(--border-subtle)');this.closest('label').style.borderColor='var(--brand-gold)'">
                <span style="font-size:0.875rem;">${esc(f.label)}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <!-- Tip preview card -->
        <div class="card" id="portal-preview-card" style="padding:24px;margin-bottom:16px;min-height:200px;">
          <div style="color:var(--text-muted);font-size:0.875rem;text-align:center;padding:40px 0;">
            Selecione uma área e um destino para ver a pré-visualização.
          </div>
        </div>

        <!-- Generate button -->
        <button class="btn btn-primary" id="portal-generate-btn"
          style="width:100%;padding:14px;font-size:1rem;font-weight:600;
          ${!limitInfo.allowed && store.isPartner() ? 'opacity:.5;cursor:not-allowed;' : ''}"
          ${!limitInfo.allowed && store.isPartner() ? 'disabled' : ''}>
          ✈ Gerar Material
        </button>

        <p style="font-size:0.75rem;color:var(--text-muted);text-align:center;margin-top:8px;">
          Cada geração cria um link exclusivo e permanente.
        </p>
      </div>
    </div>
  `;

  await initPortalForm();
}

/* ─── Init form logic ─────────────────────────────────────── */
/* ─── Two-level area picker with keyboard search ─────────── */
let allAreas = [];

function renderAreaPicker(grid, areas, activeCategoryFilter) {
  allAreas = areas;

  // Separate categories (areas with sub-areas) from standalone areas
  const categories = [...new Set(areas.map(a => a.category).filter(Boolean))].sort();
  const standaloneAreas = areas.filter(a => !a.category);

  // If showing sub-areas inside a category
  if (activeCategoryFilter !== null) {
    const subareas = areas.filter(a => a.category === activeCategoryFilter);
    grid.innerHTML = `
      <!-- Back + search -->
      <div style="grid-column:1/-1;display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <button id="area-back-btn"
          style="border:none;background:none;cursor:pointer;color:var(--brand-gold);
          font-size:0.8125rem;padding:4px 0;display:flex;align-items:center;gap:4px;">
          ← ${esc(activeCategoryFilter)}
        </button>
        <span style="font-size:0.75rem;color:var(--text-muted);">${subareas.length} áreas</span>
      </div>
      <div style="grid-column:1/-1;position:relative;margin-bottom:8px;">
        <input type="text" id="area-search" placeholder="Buscar área… (ou pressione a letra inicial)"
          class="portal-field" style="width:100%;padding-left:30px;"
          autocomplete="off">
        <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);
          color:var(--text-muted);font-size:0.875rem;">🔍</span>
      </div>
      <div id="area-sublist" style="grid-column:1/-1;display:flex;flex-direction:column;gap:4px;
        max-height:300px;overflow-y:auto;">
        ${subareas.map(a => areaItemRow(a)).join('')}
      </div>
    `;

    // Back button
    document.getElementById('area-back-btn')?.addEventListener('click', () => {
      renderAreaPicker(grid, areas, null);
    });

    // Search + keyboard navigation
    const searchInput  = document.getElementById('area-search');
    const sublistEl    = document.getElementById('area-sublist');
    let highlightedIdx = -1;

    const getItems = () => [...(sublistEl?.querySelectorAll('.portal-area-item') || [])];

    const filterItems = (q) => {
      const norm = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      getItems().forEach(item => {
        const name = (item.dataset.name||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        item.style.display = name.includes(norm) ? '' : 'none';
      });
      highlightedIdx = -1;
    };

    searchInput?.addEventListener('input', e => filterItems(e.target.value));

    searchInput?.addEventListener('keydown', e => {
      const visible = getItems().filter(i => i.style.display !== 'none');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightedIdx = Math.min(highlightedIdx + 1, visible.length - 1);
        visible.forEach((i,idx) => i.style.background = idx === highlightedIdx ? 'var(--bg-surface)' : '');
        visible[highlightedIdx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightedIdx = Math.max(highlightedIdx - 1, 0);
        visible.forEach((i,idx) => i.style.background = idx === highlightedIdx ? 'var(--bg-surface)' : '');
        visible[highlightedIdx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && highlightedIdx >= 0) {
        e.preventDefault();
        visible[highlightedIdx]?.click();
      } else if (e.key.length === 1 && /[a-zA-ZÀ-ú]/.test(e.key) && !e.target.value) {
        // Keyboard letter jump — already handled by input event
      }
    });

    // Bind item clicks
    sublistEl?.querySelectorAll('.portal-area-item').forEach(item => {
      item.addEventListener('click', () => {
        sublistEl.querySelectorAll('.portal-area-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        // Also update the grid header to show selected
        const nameEl = grid.querySelector('#area-selected-label');
        if (nameEl) nameEl.textContent = item.dataset.name;
        updatePreview();
      });
    });

    searchInput?.focus();
    return;
  }

  // Top level: categories + standalone areas
  grid.innerHTML = `
    ${categories.map(cat => {
      const subareas = areas.filter(a => a.category === cat);
      return `
        <button class="portal-area-cat" data-category="${esc(cat)}">
          <span style="font-size:0.8125rem;font-weight:600;">${esc(cat)}</span>
          <span style="font-size:0.6875rem;color:var(--text-muted);">${subareas.length} áreas</span>
          <span class="cat-chevron">▶</span>
        </button>
      `;
    }).join('')}
    ${standaloneAreas.map(a => `
      <button class="portal-area-btn portal-area-cat" data-id="${a.id}" data-name="${esc(a.name)}">
        ${a.logoUrl
          ? `<img src="${esc(a.logoUrl)}" style="height:26px;object-fit:contain;" alt="${esc(a.name)}">`
          : `<span style="font-size:0.8125rem;font-weight:600;">${esc(a.name)}</span>`
        }
        <span style="font-size:0.6875rem;color:var(--text-muted);">${esc(a.name)}</span>
      </button>
    `).join('')}
  `;

  // Category click → drill down
  grid.querySelectorAll('[data-category]').forEach(btn => {
    btn.addEventListener('click', () => {
      renderAreaPicker(grid, areas, btn.dataset.category);
    });
  });

  // Standalone area click
  grid.querySelectorAll('.portal-area-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.portal-area-btn,.portal-area-cat').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      updatePreview();
    });
  });
}

function areaItemRow(a) {
  return `<button class="portal-area-item" data-id="${a.id}" data-name="${esc(a.name)}">
    ${a.logoUrl
      ? `<img src="${esc(a.logoUrl)}" style="height:20px;object-fit:contain;flex-shrink:0;" alt="">`
      : `<span style="width:20px;height:20px;border-radius:var(--radius-sm);
          background:var(--brand-gold)20;display:inline-flex;align-items:center;
          justify-content:center;font-size:0.625rem;flex-shrink:0;">◈</span>`
    }
    <span style="flex:1;text-align:left;font-size:0.875rem;">${esc(a.name)}</span>
  </button>`;
}

async function initPortalForm() {
  // Load areas — two-level picker (categories → subareas)
  try {
    const areas  = await fetchAreas();
    const grid   = document.getElementById('portal-areas-grid');
    if (!grid || !areas.length) {
      if (grid) grid.innerHTML = `<div style="grid-column:1/-1;color:var(--text-muted);
        font-size:0.8125rem;padding:12px 0;">Nenhuma área cadastrada.
        ${store.canManagePortal() ? '<a href="#portal-areas" style="color:var(--brand-gold);">Cadastrar</a>' : ''}
      </div>`;
    } else {
      renderAreaPicker(grid, areas, null);
    }
  } catch(e) { console.warn('fetchAreas:', e.message); }

  // Load continents
  try {
    const continents = await fetchContinentsWithContent();
    const sel = document.getElementById('portal-continent');
    if (sel) {
      sel.innerHTML = `<option value="">Selecione o continente</option>` +
        continents.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
      sel.disabled = false;
      sel.addEventListener('change', () => onContinentChange());
    }
  } catch(e) {}

  // Country change
  document.getElementById('portal-country')?.addEventListener('change', () => onCountryChange());
  document.getElementById('portal-city')?.addEventListener('change', async () => {
    const continent = document.getElementById('portal-continent')?.value;
    const country   = document.getElementById('portal-country')?.value;
    const city      = document.getElementById('portal-city')?.value;
    const dests     = await fetchDestinations({ continent, country });
    const dest      = city ? dests.find(d => d.city === city) : dests.find(d => !d.city) || dests[0];
    if (dest) await updateSegments(dest.id);
    updatePreview();
  });

  // Segments
  document.getElementById('portal-seg-all')?.addEventListener('click', () => {
    document.querySelectorAll('input[name=segment]').forEach(i => i.checked = true);
    updatePreview();
  });
  document.getElementById('portal-seg-none')?.addEventListener('click', () => {
    document.querySelectorAll('input[name=segment]').forEach(i => i.checked = false);
    updatePreview();
  });
  document.querySelectorAll('input[name=segment]').forEach(i =>
    i.addEventListener('change', updatePreview));

  // Add destination
  document.getElementById('portal-add-dest-btn')?.addEventListener('click', addExtraDestination);

  // Generate
  document.getElementById('portal-generate-btn')?.addEventListener('click', handleGenerate);
}

async function onContinentChange() {
  const continent = document.getElementById('portal-continent')?.value;
  const countrySel = document.getElementById('portal-country');
  const citySel    = document.getElementById('portal-city');
  if (!countrySel) return;

  countrySel.innerHTML = '<option value="">Carregando…</option>';
  countrySel.disabled  = true;
  citySel.innerHTML    = '<option value="">Cidade/Região (opcional)</option>';
  citySel.disabled     = true;

  if (!continent) return;
  const dests = await fetchDestinations({ continent });
  const countries = [...new Set(dests.map(d => d.country).filter(Boolean))].sort();
  countrySel.innerHTML = `<option value="">Selecione o país</option>` +
    countries.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  countrySel.disabled = false;
}

async function onCountryChange() {
  const continent = document.getElementById('portal-continent')?.value;
  const country   = document.getElementById('portal-country')?.value;
  const citySel   = document.getElementById('portal-city');
  if (!citySel) return;

  citySel.innerHTML = '<option value="">Cidade/Região (opcional)</option>';
  citySel.disabled  = !country;
  if (!country) { await updateSegments(null); return; }

  const dests  = await fetchDestinations({ continent, country });
  const cities = dests.map(d => d.city).filter(Boolean).sort();
  if (cities.length) {
    citySel.innerHTML = `<option value="">Qualquer país (sem cidade específica)</option>` +
      cities.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    citySel.disabled = false;
  }
  // Update segments for the country-level destination
  const dest = dests.find(d => !d.city) || dests[0];
  if (dest) await updateSegments(dest.id);
  updatePreview();
}

function addExtraDestination() {
  const container = document.getElementById('portal-extra-dests');
  if (!container) return;
  const idx = container.children.length + 1;
  const div = document.createElement('div');
  div.style.cssText = 'margin-top:10px;padding:12px;border:1px solid var(--border-subtle);border-radius:var(--radius-md);';
  div.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <span style="font-size:0.8125rem;font-weight:600;color:var(--text-muted);">Destino ${idx + 1}</span>
      <button onclick="this.closest('div').remove();updatePreview()" style="border:none;background:none;cursor:pointer;color:var(--text-muted);">✕</button>
    </div>
    <select class="filter-select extra-continent" style="width:100%;margin-bottom:6px;">
      <option value="">Continente</option>
    </select>
    <select class="filter-select extra-country" style="width:100%;margin-bottom:6px;" disabled>
      <option value="">País</option>
    </select>
    <select class="filter-select extra-city" style="width:100%;" disabled>
      <option value="">Cidade (opcional)</option>
    </select>
  `;
  container.appendChild(div);

  // Populate continents for extra dest
  fetchContinentsWithContent().then(continents => {
    const sel = div.querySelector('.extra-continent');
    sel.innerHTML = `<option value="">Continente</option>` +
      continents.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.disabled = false;
    sel.addEventListener('change', async () => {
      const cont = sel.value;
      const countrySel = div.querySelector('.extra-country');
      countrySel.innerHTML = '<option value="">Carregando…</option>';
      const dests = await fetchDestinations({ continent: cont });
      const countries = [...new Set(dests.map(d => d.country).filter(Boolean))].sort();
      countrySel.innerHTML = `<option value="">País</option>` +
        countries.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
      countrySel.disabled = false;
    });
  });
}

async function updateSegments(destinationId) {
  const container = document.getElementById('portal-segments');
  if (!container) return;

  if (!destinationId) {
    container.innerHTML = `<div style="font-size:0.8125rem;color:var(--text-muted);padding:8px 0;text-align:center;">
      Selecione um destino para ver os segmentos disponíveis.
    </div>`;
    return;
  }

  container.innerHTML = `<div style="font-size:0.8125rem;color:var(--text-muted);padding:8px 0;text-align:center;">
    Verificando conteúdo disponível…
  </div>`;

  const available = await fetchAvailableSegments(destinationId);

  if (!available.length) {
    container.innerHTML = `<div style="font-size:0.8125rem;color:var(--text-muted);padding:8px 0;text-align:center;">
      Nenhum segmento com conteúdo cadastrado para este destino.
      ${store.canCreateTip() ? '<br><a href="#portal-tip-editor" style="color:var(--brand-gold);">Criar dica</a>' : ''}
    </div>`;
    return;
  }

  const segsWithContent = SEGMENTS.filter(s => available.includes(s.key));
  container.innerHTML = segsWithContent.map(s => `
    <label style="display:flex;align-items:center;gap:10px;padding:8px 10px;
      border-radius:var(--radius-sm);cursor:pointer;transition:background .1s;"
      onmouseover="this.style.background='var(--bg-surface)'"
      onmouseout="this.style.background=''">
      <input type="checkbox" name="segment" value="${s.key}" checked
        style="width:15px;height:15px;accent-color:var(--brand-gold);cursor:pointer;"
        onchange="updatePreview()">
      <span style="font-size:0.875rem;color:var(--text-primary);">${esc(s.label)}</span>
    </label>
  `).join('');
}

async function updatePreview() {
  const card = document.getElementById('portal-preview-card');
  if (!card) return;

  const areaBtn   = document.querySelector('.portal-area-btn.selected, .portal-area-item.selected');
  const continent = document.getElementById('portal-continent')?.value;
  const country   = document.getElementById('portal-country')?.value;
  const city      = document.getElementById('portal-city')?.value;
  const segments  = [...document.querySelectorAll('input[name=segment]:checked')].map(i => i.value);

  if (!areaBtn || !country) {
    card.innerHTML = `<div style="color:var(--text-muted);font-size:0.875rem;text-align:center;padding:40px 0;">
      Selecione uma área e um destino para ver a pré-visualização.
    </div>`;
    return;
  }

  card.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.875rem;">
    Carregando pré-visualização…
  </div>`;

  // Find destination
  const dests = await fetchDestinations({ continent, country });
  const dest  = city ? dests.find(d => d.city === city) : dests[0];
  if (!dest) {
    card.innerHTML = `<div style="color:var(--text-muted);font-size:0.875rem;text-align:center;padding:20px;">
      Destino sem dica cadastrada.
      ${store.canCreateTip() ? `<br><a href="#portal-tip-editor?dest=${encodeURIComponent(JSON.stringify({continent,country,city}))}" style="color:var(--brand-gold);">Criar dica</a>` : ''}
    </div>`;
    return;
  }

  const tip = await fetchTip(dest.id);
  if (!tip) {
    card.innerHTML = `<div style="color:var(--text-muted);font-size:0.875rem;text-align:center;padding:20px;">
      Nenhuma dica cadastrada para este destino.
      ${store.canCreateTip() ? `<br><a href="#portal-tip-editor" style="color:var(--brand-gold);">Criar dica</a>` : ''}
    </div>`;
    return;
  }

  const segLabels = SEGMENTS.filter(s => segments.includes(s.key)).map(s => s.label);
  const expiredSegs = SEGMENTS.filter(s => {
    const seg = tip.segments?.[s.key];
    return seg?.hasExpiry && seg?.expiryDate && new Date(seg.expiryDate) < new Date();
  });

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
      <div>
        <div style="font-size:1rem;font-weight:700;color:var(--text-primary);">
          ${esc(city || country)}${city ? `, ${esc(country)}` : ''}
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);">${esc(continent)}</div>
      </div>
      <div style="font-size:0.6875rem;color:var(--text-muted);text-align:right;">
        Atualizado ${tip.updatedAt?.toDate ? new Intl.DateTimeFormat('pt-BR').format(tip.updatedAt.toDate()) : '—'}
      </div>
    </div>

    ${expiredSegs.length ? `
      <div style="background:#EF444415;border:1px solid #EF444430;border-radius:var(--radius-sm);
        padding:8px 12px;margin-bottom:12px;font-size:0.75rem;color:#EF4444;">
        ⚠ ${expiredSegs.length} segmento${expiredSegs.length !== 1 ? 's' : ''} com validade vencida:
        ${expiredSegs.map(s => s.label).join(', ')}
      </div>
    ` : ''}

    <div style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:8px;">Segmentos selecionados:</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">
      ${segLabels.map(l => `
        <span style="font-size:0.75rem;padding:3px 8px;background:var(--bg-surface);
          border:1px solid var(--border-subtle);border-radius:var(--radius-full);">
          ${esc(l)}
        </span>`).join('')}
    </div>
  `;
}

async function handleGenerate() {
  const limitInfo = await checkDownloadLimit();
  if (!limitInfo.allowed) {
    toast.error('Limite diário de downloads atingido. Tente novamente amanhã.');
    return;
  }

  const areaBtn   = document.querySelector('.portal-area-btn.selected, .portal-area-item.selected');
  const continent = document.getElementById('portal-continent')?.value;
  const country   = document.getElementById('portal-country')?.value;
  const city      = document.getElementById('portal-city')?.value;
  const format    = document.querySelector('input[name=format]:checked')?.value;
  const segments  = [...document.querySelectorAll('input[name=segment]:checked')].map(i => i.value);

  if (!areaBtn)        { toast.error('Selecione uma área.'); return; }
  if (!country)        { toast.error('Selecione um destino.'); return; }
  if (!segments.length){ toast.error('Selecione ao menos um segmento.'); return; }

  // Resolve destination + tip
  const dests = await fetchDestinations({ continent, country });
  const dest  = city ? dests.find(d => d.city === city) : dests.find(d => !d.city) || dests[0];
  if (!dest) { toast.error('Destino não encontrado.'); return; }

  const tip = await fetchTip(dest.id);
  if (!tip)  { toast.error('Nenhuma dica cadastrada para este destino.'); return; }

  // Resolve extra destinations (combined)
  const extraTips = [];
  for (const block of document.querySelectorAll('.extra-dest-block')) {
    const eCont = block.querySelector('.extra-continent')?.value;
    const eCoun = block.querySelector('.extra-country')?.value;
    const eCity = block.querySelector('.extra-city')?.value;
    if (!eCoun) continue;
    const ed = await fetchDestinations({ continent: eCont, country: eCoun });
    const edest = eCity ? ed.find(d => d.city === eCity) : ed.find(d => !d.city) || ed[0];
    if (!edest) continue;
    const etip = await fetchTip(edest.id);
    if (etip) extraTips.push({ tip: etip, dest: edest });
  }

  // Load area data
  const { fetchAreas: _fa } = await import('../services/portal.js');
  const areas = await _fa();
  const area  = areas.find(a => a.id === areaBtn.dataset.id) || {};

  // Show preview modal
  showPreviewModal({ tip, dest, area, segments, format, extraTips });
}

async function showPreviewModal({ tip, dest, area, segments, format, extraTips }) {
  const existing = document.getElementById('portal-preview-modal');
  if (existing) existing.remove();

  const allTips  = [{ tip, dest }, ...extraTips];
  const fmtLabel = GENERATION_FORMATS.find(f => f.key === format)?.label || format;

  // Deep-clone so edits never touch originals
  const workingTips = allTips.map(({ tip: t, dest: d }) => ({
    tip:  JSON.parse(JSON.stringify(t || {})),
    dest: d,
  }));

  // Load images for all destinations
  const imagesByDest = {};
  for (const { dest: d } of allTips) {
    if (d?.id) {
      try {
        imagesByDest[d.id] = await fetchImages({
          continent: d.continent, country: d.country, city: d.city,
        });
      } catch { imagesByDest[d.id] = []; }
    }
  }

  const activeSeg = segments.filter(k =>
    workingTips.some(({ tip: t }) => {
      const seg = t?.segments?.[k];
      if (!seg) return false;
      if (seg.info && Object.values(seg.info).some(v => v && String(v).trim())) return true;
      return Array.isArray(seg.items) && seg.items.length > 0;
    })
  );

  const selectedImages = {};  // { [destId]: { [segKey]: { [idx]: { url, name } } } }

  // Mutable state — never re-declared
  let curDestIdx   = 0;
  let curSegKey    = activeSeg[0] || '';

  // ── Build static shell (rendered once, never replaced) ──────
  const modal = document.createElement('div');
  modal.id    = 'portal-preview-modal';
  modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:2000;
    display:flex;align-items:center;justify-content:center;padding:16px;`;

  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:900px;max-height:92vh;
      padding:0;overflow:hidden;display:flex;flex-direction:column;">

      <!-- Header (static) -->
      <div style="padding:16px 20px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;gap:12px;flex-shrink:0;">
        <div style="flex:1;">
          <div style="font-weight:700;font-size:1rem;">Editor de Geração</div>
          <div style="font-size:0.8125rem;color:var(--text-muted);">
            Ajuste textos e imagens apenas para este material · o conteúdo original não é alterado
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:0.75rem;padding:3px 10px;background:var(--brand-gold)15;
            color:var(--brand-gold);border-radius:var(--radius-full);font-weight:600;">
            ${esc(fmtLabel)}
          </span>
          <button id="gen-close" style="border:none;background:none;cursor:pointer;
            font-size:1.25rem;color:var(--text-muted);">✕</button>
        </div>
      </div>

      <!-- Dest tabs (static shell, updated via JS) -->
      <div id="gen-dest-tabs" style="display:${workingTips.length > 1 ? 'flex' : 'none'};
        overflow-x:auto;border-bottom:1px solid var(--border-subtle);
        background:var(--bg-surface);flex-shrink:0;">
        ${workingTips.map((item, i) => {
          const lbl = [item.dest?.city, item.dest?.country].filter(Boolean).join(', ');
          return `<button class="gen-dest-tab" data-idx="${i}"
            style="padding:10px 16px;border:none;background:none;cursor:pointer;
            font-size:0.8125rem;white-space:nowrap;
            border-bottom:2px solid ${i===0?'var(--brand-gold)':'transparent'};
            color:${i===0?'var(--brand-gold)':'var(--text-muted)'};
            transition:all .15s;">${esc(lbl||`Destino ${i+1}`)}</button>`;
        }).join('')}
      </div>

      <!-- Body: seg list (left) + editor panel (right) -->
      <div style="display:grid;grid-template-columns:200px 1fr;flex:1;overflow:hidden;min-height:0;">
        <div id="gen-seg-list" style="border-right:1px solid var(--border-subtle);
          overflow-y:auto;background:var(--bg-surface);"></div>
        <div id="gen-right-panel" style="overflow-y:auto;padding:20px;"></div>
      </div>

      <!-- Footer (static) -->
      <div style="padding:14px 20px;border-top:1px solid var(--border-subtle);
        background:var(--bg-surface);flex-shrink:0;display:flex;flex-direction:column;gap:10px;">
        ${format === 'web' ? `
          <div>
            <label style="font-size:0.75rem;font-weight:600;color:var(--text-muted);
              display:block;margin-bottom:4px;">
              Nome do cliente <span style="font-weight:400;">(opcional — usado na URL amigável)</span>
            </label>
            <input type="text" id="gen-client-name" placeholder="ex.: João e Maria"
              style="width:100%;padding:8px 10px;font-size:0.8125rem;
              background:var(--bg-base);border:1px solid var(--border-subtle);
              border-radius:var(--radius-sm);">
          </div>
        ` : ''}
        <div style="display:flex;gap:10px;">
          <button class="btn btn-secondary" id="gen-cancel" style="flex:1;">← Voltar</button>
          <button class="btn btn-primary"   id="gen-confirm" style="flex:2;font-weight:600;">
            ✈ Gerar ${esc(fmtLabel)}
          </button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(modal);

  // ── Helpers to update dynamic zones ──────────────────────────
  const refreshSegList = () => {
    const { tip: wTip } = workingTips[curDestIdx];
    document.getElementById('gen-seg-list').innerHTML = activeSeg.map(k => {
      const seg = SEGMENTS.find(s => s.key === k);
      const segData = wTip?.segments?.[k];
      const hasContent = segData && (
        (segData.info && Object.values(segData.info).some(v => v && String(v).trim())) ||
        (Array.isArray(segData.items) && segData.items.length > 0)
      );
      const isActive = k === curSegKey;
      return `<button class="gen-seg-btn" data-seg="${k}"
        style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;
        padding:12px 14px;border:none;
        background:${isActive?'var(--brand-gold)10':'transparent'};
        border-left:3px solid ${isActive?'var(--brand-gold)':'transparent'};
        cursor:pointer;transition:all .15s;font-size:0.8125rem;">
        <span style="flex:1;color:${isActive?'var(--brand-gold)':'var(--text-secondary)'};">
          ${esc(seg?.label||k)}</span>
        ${hasContent?`<span style="width:6px;height:6px;border-radius:50%;
          background:#22C55E;flex-shrink:0;"></span>`:''}
      </button>`;
    }).join('');

    // re-wire seg buttons every time list is refreshed
    document.querySelectorAll('.gen-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        curSegKey = btn.dataset.seg;
        refreshSegList();
        refreshRightPanel();
      });
    });
  };

  const refreshRightPanel = () => {
    const { tip: wTip, dest: wDest } = workingTips[curDestIdx];
    const destId   = wDest?.id || curDestIdx;
    const destImgs = imagesByDest[destId] || [];
    const segImgs  = selectedImages[destId]?.[curSegKey] || {};

    const panel = document.getElementById('gen-right-panel');
    if (panel) {
      panel.innerHTML = renderSegEditor(wTip, curSegKey, destImgs, segImgs, destId);
      panel._refreshRef = { refreshRightPanel };
    }

    wireSegEditor(wTip, curSegKey, destImgs, destId, selectedImages, workingTips, curDestIdx);
  };

  const refreshDestTabs = () => {
    document.querySelectorAll('.gen-dest-tab').forEach(btn => {
      const i = Number(btn.dataset.idx);
      btn.style.borderBottomColor = i === curDestIdx ? 'var(--brand-gold)' : 'transparent';
      btn.style.color = i === curDestIdx ? 'var(--brand-gold)' : 'var(--text-muted)';
    });
  };

  // ── Wire events ONCE ──────────────────────────────────────────
  document.getElementById('gen-close')?.addEventListener('click', () => modal.remove());
  document.getElementById('gen-cancel')?.addEventListener('click', () => modal.remove());
  // Backdrop-click não fecha — só X/Cancelar.

  document.querySelectorAll('.gen-dest-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      curDestIdx = Number(btn.dataset.idx);
      curSegKey  = activeSeg[0] || '';
      refreshDestTabs();
      refreshSegList();
      refreshRightPanel();
    });
  });

  // Generate button — wired ONCE here, never re-attached
  document.getElementById('gen-confirm')?.addEventListener('click', async () => {
    const btn = document.getElementById('gen-confirm');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '⏳ Gerando…';
    try {
      const clientName = document.getElementById('gen-client-name')?.value?.trim() || '';
      const result = await generateTip({
        tip:            workingTips[0].tip,
        dest:           workingTips[0].dest,
        area, segments, format,
        extraTips:      workingTips.slice(1),
        imagesOverride: selectedImages,
        clientName,
      });
      await recordGeneration({
        areaId:         area?.id  || null,
        tipId:          tip?.id   || null,
        format, segments,
        destinationIds: allTips.map(({ dest: d }) => d?.id).filter(Boolean),
        status:         'done',
        ...(result.url   ? { webUrl: result.url }     : {}),
        ...(result.token ? { webToken: result.token } : {}),
      });
      await registerDownload();
      modal.remove();
      if (format === 'web' && result.url) showWebLinkResult(result.url);
      else toast.success('Material gerado e download iniciado!');
    } catch(e) {
      console.error('[PRIMETOUR] Erro ao gerar material:', e);
      toast.error('Erro ao gerar: ' + (e.message || 'desconhecido'));
      btn.disabled   = false;
      btn.textContent = `✈ Gerar ${fmtLabel}`;
    }
  });

  // Initial render
  refreshSegList();
  refreshRightPanel();
}

/* ─── Segment editor renderer ──────────────────────────────── */
function renderSegEditor(tip, segKey, destImgs, segSelectedImgs, destId) {
  if (!segKey) return '<div style="color:var(--text-muted);padding:20px;">Selecione um segmento.</div>';
  const segDef = SEGMENTS.find(s => s.key === segKey);
  const data   = tip?.segments?.[segKey];
  if (!segDef || !data) return `<div style="color:var(--text-muted);">Sem conteúdo para este segmento.</div>`;

  const LBL = `font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;`;
  const galeria = destImgs.filter(i => i.type === 'galeria' || i.type === 'destaque');

  let html = `<div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;
    letter-spacing:.07em;color:var(--brand-gold);margin-bottom:16px;">${esc(segDef.label)}</div>`;

  if (segDef.mode === 'special_info') {
    const inf = data.info || {};
    const fields = [
      ['descricao', 'Descrição',      'textarea', inf.descricao],
      ['dica',      'Dica',           'textarea', inf.dica],
      ['populacao', 'População',      'text',     inf.populacao],
      ['moeda',     'Moeda',          'text',     inf.moeda],
      ['lingua',    'Língua oficial', 'text',     inf.lingua],
      ['religiao',  'Religião',       'text',     inf.religiao],
      ['voltagem',  'Voltagem',       'text',     inf.voltagem],
      ['ddd',       'DDD',            'text',     inf.ddd],
    ].filter(([,, ,v]) => v !== undefined);

    html += fields.map(([field, label, type, value]) => `
      <div style="margin-bottom:12px;">
        <label style="${LBL}">${esc(label)}</label>
        ${type === 'textarea'
          ? `<textarea class="portal-field editor-field" data-seg="${segKey}" data-field="${field}"
              rows="3" style="width:100%;font-size:0.875rem;">${esc(value||'')}</textarea>`
          : `<input type="text" class="portal-field editor-field" data-seg="${segKey}" data-field="${field}"
              value="${esc(value||'')}" style="width:100%;font-size:0.875rem;">`
        }
      </div>`).join('');

  } else {
    const items = data.items || [];

    if (data.themeDesc !== undefined) {
      html += `<div style="margin-bottom:16px;">
        <label style="${LBL}">Descrição do tema</label>
        <textarea class="portal-field editor-field" data-seg="${segKey}" data-field="themeDesc"
          rows="2" style="width:100%;font-size:0.875rem;">${esc(data.themeDesc||'')}</textarea>
      </div>`;
    }

    html += items.map((item, idx) => `
      <div class="editor-item-card" style="background:var(--bg-surface);border:1px solid var(--border-subtle);
        border-radius:var(--radius-md);padding:14px 16px;margin-bottom:12px;">

        <!-- Item header -->
        <div style="font-size:0.6875rem;font-weight:700;color:var(--text-muted);
          margin-bottom:10px;display:flex;align-items:center;gap:6px;">
          <span style="background:var(--brand-gold);color:#fff;border-radius:50%;
            width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;
            font-size:0.5rem;font-weight:800;flex-shrink:0;">${idx+1}</span>
          <span style="flex:1;">${esc(item.titulo || item.title || `Item ${idx+1}`)}</span>
          <button class="editor-item-del btn btn-ghost" data-seg="${segKey}" data-idx="${idx}"
            title="Remover item"
            style="padding:1px 5px;font-size:0.7rem;color:#EF4444;border-radius:var(--radius-sm);
            margin-left:auto;">✕ remover</button>
        </div>

        <!-- Title -->
        <div style="margin-bottom:8px;">
          <label style="${LBL}">${item.titulo !== undefined ? 'Título' : 'Nome'}</label>
          <input type="text" class="portal-field editor-item-field" data-seg="${segKey}"
            data-idx="${idx}" data-subfield="${item.titulo !== undefined ? 'titulo' : 'title'}"
            value="${esc(item.titulo || item.title || '')}"
            style="width:100%;font-size:0.875rem;">
        </div>

        ${item.descricao !== undefined ? `
        <div style="margin-bottom:8px;">
          <label style="${LBL}">Descrição</label>
          <textarea class="portal-field editor-item-field" data-seg="${segKey}"
            data-idx="${idx}" data-subfield="descricao" rows="3"
            style="width:100%;font-size:0.875rem;">${esc(item.descricao||'')}</textarea>
        </div>` : ''}

        ${item.description !== undefined ? `
        <div style="margin-bottom:8px;">
          <label style="${LBL}">Descrição</label>
          <textarea class="portal-field editor-item-field" data-seg="${segKey}"
            data-idx="${idx}" data-subfield="description" rows="3"
            style="width:100%;font-size:0.875rem;">${esc(item.description||'')}</textarea>
        </div>` : ''}

        ${item.observacoes !== undefined ? `
        <div style="margin-bottom:8px;">
          <label style="${LBL}">Observações</label>
          <input type="text" class="portal-field editor-item-field" data-seg="${segKey}"
            data-idx="${idx}" data-subfield="observacoes"
            value="${esc(item.observacoes||'')}" style="width:100%;font-size:0.875rem;">
        </div>` : ''}

        <!-- Image picker for this item -->
        ${galeria.length > 0 ? `
        <div style="margin-top:10px;">
          <label style="${LBL}">Imagem para este lugar</label>
          <div class="img-picker-row" data-seg="${segKey}" data-idx="${idx}"
            style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;">
            <button class="img-pick-none ${!(segSelectedImgs[idx]) ? 'active' : ''}"
              data-seg="${segKey}" data-idx="${idx}"
              style="flex-shrink:0;width:56px;height:42px;border:2px solid
              ${!(segSelectedImgs[idx]) ? 'var(--brand-gold)' : 'var(--border-subtle)'};
              border-radius:var(--radius-sm);background:var(--bg-surface);cursor:pointer;
              font-size:0.5rem;color:var(--text-muted);display:flex;align-items:center;
              justify-content:center;flex-direction:column;gap:1px;">
              <span style="font-size:0.75rem;">◑</span>auto
            </button>
            ${galeria.slice(0, 12).map((img, iIdx) => {
              const isSelected = segSelectedImgs[idx]?.url === img.url;
              return `<div style="flex-shrink:0;position:relative;display:flex;flex-direction:column;gap:2px;">
                <button class="img-pick-btn"
                  data-seg="${segKey}" data-idx="${idx}" data-iidx="${iIdx}"
                  data-url="${esc(img.url)}" data-name="${esc(img.name||'')}"
                  style="flex-shrink:0;border:2px solid
                  ${isSelected ? 'var(--brand-gold)' : 'var(--border-subtle)'};
                  border-radius:var(--radius-sm);overflow:hidden;cursor:pointer;
                  width:72px;height:54px;padding:0;background:none;display:block;">
                  <img src="${esc(img.url)}" alt="${esc(img.name||'')}"
                    style="width:100%;height:100%;object-fit:cover;"
                    title="${esc(img.name||'')}${img.placeName ? ' · '+img.placeName : ''}">
                </button>
                <button class="img-preview-btn btn btn-ghost"
                  data-url="${esc(img.url)}" data-name="${esc(img.name||'')}"
                  style="width:72px;font-size:0.5625rem;padding:1px 0;
                  text-align:center;color:var(--text-muted);" title="Ampliar">⤢</button>
              </div>`;
            }).join('')}
            ${galeria.length > 12 ? `
              <span style="flex-shrink:0;display:flex;align-items:center;
                font-size:0.6875rem;color:var(--text-muted);white-space:nowrap;padding:0 4px;">
                +${galeria.length-12} mais
              </span>` : ''}
          </div>
        </div>` : ''}
      </div>`).join('');
  }

  return html;
}

/* ─── Wire segment editor events ──────────────────────────── */
function wireSegEditor(wTip, segKey, destImgs, destId, selectedImages, workingTips, curDestIdx) {
  if (!segKey) return;

  // Scope all queries to the right panel only
  const panel = document.getElementById('gen-right-panel');
  if (!panel) return;
  const qs = sel => panel.querySelectorAll(sel);

  qs(`.editor-field[data-seg="${segKey}"]`).forEach(el => {
    el.addEventListener('input', () => {
      const field = el.dataset.field;
      if (!wTip.segments?.[segKey]) return;
      if (segKey === 'informacoes_gerais') {
        if (!wTip.segments[segKey].info) wTip.segments[segKey].info = {};
        wTip.segments[segKey].info[field] = el.value;
      } else {
        wTip.segments[segKey][field] = el.value;
      }
      workingTips[curDestIdx].tip = wTip;
    });
  });

  qs(`.editor-item-field[data-seg="${segKey}"]`).forEach(el => {
    el.addEventListener('input', () => {
      const idx      = Number(el.dataset.idx);
      const subfield = el.dataset.subfield;
      if (!wTip.segments?.[segKey]?.items?.[idx]) return;
      wTip.segments[segKey].items[idx][subfield] = el.value;
      workingTips[curDestIdx].tip = wTip;
    });
  });

  if (!selectedImages[destId])         selectedImages[destId] = {};
  if (!selectedImages[destId][segKey]) selectedImages[destId][segKey] = {};

  qs(`.img-pick-btn[data-seg="${segKey}"]`).forEach(btn => {
    btn.addEventListener('click', () => {
      const idx  = Number(btn.dataset.idx);
      const url  = btn.dataset.url;
      const name = btn.dataset.name;
      qs(`.img-pick-btn[data-seg="${segKey}"][data-idx="${idx}"]`).forEach(b => {
        b.style.borderColor = 'var(--border-subtle)';
      });
      qs(`.img-pick-none[data-seg="${segKey}"][data-idx="${idx}"]`).forEach(b => {
        b.style.borderColor = 'var(--border-subtle)';
      });
      btn.style.borderColor = 'var(--brand-gold)';
      selectedImages[destId][segKey][idx] = { url, name };
    });
  });

  qs(`.img-pick-none[data-seg="${segKey}"]`).forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      qs(`.img-pick-btn[data-seg="${segKey}"][data-idx="${idx}"]`).forEach(b => {
        b.style.borderColor = 'var(--border-subtle)';
      });
      btn.style.borderColor = 'var(--brand-gold)';
      delete selectedImages[destId]?.[segKey]?.[idx];
    });
  });

  // Delete item
  qs(`.editor-item-del[data-seg="${segKey}"]`).forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      if (!wTip.segments?.[segKey]?.items) return;
      wTip.segments[segKey].items.splice(idx, 1);
      workingTips[curDestIdx].tip = wTip;
      // Re-render the right panel
      const panel = document.getElementById('gen-right-panel');
      if (panel) {
        const { refreshRightPanel } = panel._refreshRef || {};
        if (refreshRightPanel) refreshRightPanel();
        else panel.dispatchEvent(new CustomEvent('refresh-segment'));
      }
    });
  });

  // Image preview lightbox
  qs('.img-preview-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url  = btn.dataset.url;
      const name = btn.dataset.name || '';
      if (!url) return;
      const lb = document.createElement('div');
      lb.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:9999;
        display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;
        cursor:zoom-out;`;
      lb.innerHTML = `
        <img src="${esc(url)}" alt="${esc(name)}"
          style="max-width:90vw;max-height:80vh;object-fit:contain;border-radius:4px;
          box-shadow:0 8px 40px rgba(0,0,0,.6);">
        <div style="color:rgba(255,255,255,.7);font-size:0.875rem;">${esc(name)}</div>
        <div style="font-size:0.75rem;color:rgba(255,255,255,.4);">Clique para fechar</div>`;
      lb.addEventListener('click', () => lb.remove());
      document.body.appendChild(lb);
    });
  });
}

function showWebLinkResult(url) {
  const existing = document.getElementById('weblink-result-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id    = 'weblink-result-modal';
  modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2000;
    display:flex;align-items:center;justify-content:center;padding:20px;`;

  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:500px;padding:32px;text-align:center;">
      <div style="font-size:2.5rem;margin-bottom:12px;">🔗</div>
      <h2 style="font-size:1.125rem;margin:0 0 8px;">Link gerado com sucesso!</h2>
      <p style="font-size:0.875rem;color:var(--text-muted);margin:0 0 20px;">
        Compartilhe este link com o cliente. O conteúdo fica disponível permanentemente.
      </p>
      <div style="display:flex;gap:8px;margin-bottom:20px;">
        <input type="text" id="weblink-url" value="${esc(url)}" readonly
          class="portal-field" style="flex:1;font-size:0.8125rem;">
        <button class="btn btn-primary btn-sm" id="weblink-copy">Copiar</button>
      </div>
      <a href="${esc(url)}" target="_blank" class="btn btn-secondary btn-sm"
        style="text-decoration:none;display:inline-block;margin-right:8px;">
        Abrir link ↗
      </a>
      <button class="btn btn-ghost btn-sm" id="weblink-close">Fechar</button>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById('weblink-copy')?.addEventListener('click', () => {
    navigator.clipboard.writeText(url).then(() => toast.success('Link copiado!'));
  });
  document.getElementById('weblink-close')?.addEventListener('click', () => modal.remove());
}

/* ─── Terms modal ─────────────────────────────────────────── */
function renderTermsModal(container, terms, onAccept) {
  container.innerHTML = `
    <div style="max-width:780px;margin:40px auto;">
      <div class="card" style="padding:40px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
          <span style="font-size:1.5rem;">📋</span>
          <div>
            <h2 style="margin:0;font-size:1.25rem;">Termos de Uso</h2>
            <div style="font-size:0.8125rem;color:var(--text-muted);margin-top:2px;">
              Portal de Dicas PRIMETOUR — Última atualização: ${terms.updatedAt?.toDate
                ? new Intl.DateTimeFormat('pt-BR').format(terms.updatedAt.toDate())
                : '30/07/2025'}
            </div>
          </div>
        </div>

        <div style="max-height:420px;overflow-y:auto;border:1px solid var(--border-subtle);
          border-radius:var(--radius-md);padding:20px;margin-bottom:24px;
          font-size:0.875rem;line-height:1.7;color:var(--text-secondary);
          white-space:pre-wrap;">
${esc(terms.text || TERMS_TEXT)}
        </div>

        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
          <input type="checkbox" id="terms-check" style="width:16px;height:16px;accent-color:var(--brand-gold);">
          <label for="terms-check" style="font-size:0.875rem;cursor:pointer;">
            Li e aceito integralmente os Termos de Uso do Portal de Dicas.
          </label>
        </div>

        <button class="btn btn-primary" id="terms-accept-btn" disabled
          style="width:100%;padding:12px;font-size:0.9375rem;opacity:.5;">
          Aceitar e Continuar
        </button>
      </div>
    </div>
  `;

  document.getElementById('terms-check')?.addEventListener('change', e => {
    const btn = document.getElementById('terms-accept-btn');
    if (btn) { btn.disabled = !e.target.checked; btn.style.opacity = e.target.checked ? '1' : '.5'; }
  });

  document.getElementById('terms-accept-btn')?.addEventListener('click', async () => {
    try {
      await acceptTerms(terms.id);
      toast.success('Termos aceitos. Bem-vindo ao Portal de Dicas!');
      onAccept();
    } catch(e) { toast.error('Erro ao registrar aceite: ' + e.message); }
  });
}

// Default terms text (will be loaded from Firestore in production)
const TERMS_TEXT = `TERMO DE USO DO PORTAL DE DICAS DA PRIMETOUR

Última atualização: 30/07/2025

Este Termo de Uso regula o uso do PORTAL DE DICAS DA PRIMETOUR, criado e desenvolvido por PRIME TOUR AGÊNCIA DE VIAGENS E TURISMO LTDA., empresa com sede na Avenida Paulista, 854 – 8º andar – conjunto 82 – Bela Vista – CEP 01311-100 - São Paulo/SP, inscrita no CNPJ/MF sob o número 55.132.906/0001-51, sendo todos os direitos reservados a esta. Ao acessar ou utilizar o sistema, o usuário declara ter lido, compreendido e aceitado integralmente os termos e condições abaixo.

[Texto completo disponível no documento oficial]`;
