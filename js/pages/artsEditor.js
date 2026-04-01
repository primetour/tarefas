/**
 * PRIMETOUR — Editor de Artes v2
 * Canvas editor com Fabric.js, filtros, categorias, setores, integração banco de imagens + portal
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import { fetchImages } from '../services/portal.js';
import {
  fetchTemplates, fetchTemplate, saveTemplate, deleteTemplate,
  recordArtGeneration, fetchArtCategories, saveArtCategory, deleteArtCategory,
  installStarterTemplates,
  ART_SIZES, LAYER_TYPES, SECTORS, AVAILABLE_FONTS, IMAGE_FILTERS,
  getFabricFilters, BEST_PRACTICES,
} from '../services/artsEditor.js';

const esc = s => String(s||'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let fabricCanvas = null;
let _currentLayers = null;
let _currentScale = 1;

/* ── Responsive CSS (injected once) ─────────────────────────── */
function injectResponsiveStyles() {
  if (document.getElementById('arts-responsive-css')) return;
  const style = document.createElement('style');
  style.id = 'arts-responsive-css';
  style.textContent = `
    /* ─── Mobile: Arts Editor ─────────────────────────── */
    @media (max-width: 768px) {
      /* Main page header */
      .arts-page-header {
        flex-direction: column !important;
        align-items: flex-start !important;
        gap: 12px !important;
      }
      .arts-page-header .page-header-actions {
        width: 100% !important;
        justify-content: flex-start !important;
      }
      .arts-page-header .page-header-actions .btn {
        flex: 1 !important;
        min-width: 0 !important;
        font-size: 0.75rem !important;
        padding: 8px 6px !important;
      }

      /* Filters card */
      .arts-filters-bar {
        flex-direction: column !important;
        gap: 10px !important;
      }
      .arts-filters-bar > div:first-child {
        max-width: 100% !important;
        min-width: 100% !important;
      }
      #arts-cat-pills {
        overflow-x: auto !important;
        flex-wrap: nowrap !important;
        -webkit-overflow-scrolling: touch;
        padding-bottom: 4px;
        scrollbar-width: none;
      }
      #arts-cat-pills::-webkit-scrollbar { display: none; }
      #arts-cat-pills .arts-cat-btn {
        white-space: nowrap !important;
        flex-shrink: 0 !important;
      }
      #arts-sector-filter, #arts-size-filter {
        width: 100% !important;
      }

      /* Template grid — 2 cols on mobile */
      #arts-template-grid {
        grid-template-columns: repeat(2, 1fr) !important;
        gap: 10px !important;
      }

      /* ─── Editor modal ──────────────────────────────── */
      #arts-editor-modal {
        flex-direction: column !important;
      }
      .arts-editor-toolbar {
        padding: 8px 12px !important;
        flex-wrap: wrap !important;
        gap: 6px !important;
      }
      .arts-editor-toolbar .btn {
        padding: 8px 10px !important;
        font-size: 0.75rem !important;
        min-height: 36px !important;
      }
      .arts-editor-toolbar .arts-tpl-name {
        width: 100% !important;
        order: -1 !important;
        flex: none !important;
        text-align: center !important;
      }
      .arts-editor-body {
        grid-template-columns: 1fr !important;
        grid-template-rows: 1fr auto !important;
      }
      #arts-canvas-area {
        padding: 12px !important;
        min-height: 0 !important;
      }
      .arts-right-panel {
        border-left: none !important;
        border-top: 1px solid var(--border-subtle) !important;
        max-height: 45vh !important;
        min-height: 180px !important;
      }
      .arts-panel-tab {
        padding: 12px 8px !important;
        font-size: 0.8125rem !important;
        min-height: 44px !important;
      }

      /* Layer fields compact */
      .arts-layer-fields .lf-grid-2 {
        grid-template-columns: 1fr !important;
      }
      .arts-layer-item {
        padding: 14px 12px !important;
      }

      /* ─── Sub-modals fullscreen on mobile ───────────── */
      .arts-sub-modal {
        padding: 0 !important;
        align-items: stretch !important;
        justify-content: stretch !important;
      }
      .arts-sub-modal > .card {
        max-width: 100% !important;
        max-height: 100% !important;
        height: 100% !important;
        border-radius: 0 !important;
      }

      /* Filter grid 2 cols on mobile */
      .arts-filter-grid {
        grid-template-columns: repeat(2, 1fr) !important;
      }

      /* Template editor 1-col grid */
      .te-grid-3 {
        grid-template-columns: 1fr !important;
      }

      /* Image bank grid */
      .ibp-grid {
        grid-template-columns: repeat(3, 1fr) !important;
      }
    }

    /* ─── Very small screens (< 400px) ────────────────── */
    @media (max-width: 400px) {
      #arts-template-grid {
        grid-template-columns: 1fr !important;
      }
      .ibp-grid {
        grid-template-columns: repeat(2, 1fr) !important;
      }
      .arts-filter-grid {
        grid-template-columns: repeat(2, 1fr) !important;
      }
    }

    /* ─── Touch-friendly adjustments ──────────────────── */
    @media (hover: none) and (pointer: coarse) {
      .arts-layer-item,
      .tip-item,
      .filter-preview-btn,
      .ibp-img-btn {
        min-height: 44px !important;
      }
      .filter-preview-btn {
        padding: 10px 6px !important;
      }
    }
  `;
  document.head.appendChild(style);
}

/* ════════════════════════════════════════════════════════════
   Main render
   ════════════════════════════════════════════════════════════ */
export async function renderArtsEditor(container) {
  if (!store.canManagePortal()) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div></div>`;
    return;
  }

  const isAdmin = store.isMaster() || store.can('system_manage_users');
  const categories = await fetchArtCategories().catch(() => []);

  injectResponsiveStyles();

  container.innerHTML = `
    <div class="page-header arts-page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;">
      <div class="page-header-left">
        <h1 class="page-title">Editor de Artes</h1>
        <p class="page-subtitle">Templates para redes sociais, e-mails e comunicados</p>
      </div>
      <div class="page-header-actions" style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" id="arts-guide-btn" title="Boas práticas">📖 Guia</button>
        ${isAdmin ? `
          <button class="btn btn-ghost btn-sm" id="arts-cat-btn">◈ Categorias</button>
          <button class="btn btn-secondary btn-sm" id="arts-manage-btn">⚙ Gerenciar</button>
          <button class="btn btn-primary btn-sm" id="arts-new-tpl-btn">+ Novo template</button>
        ` : ''}
      </div>
    </div>

    <!-- Filters -->
    <div class="card" style="padding:14px 20px;margin-bottom:20px;">
      <div class="arts-filters-bar" style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
        <!-- Search -->
        <div style="flex:1;min-width:180px;max-width:300px;position:relative;">
          <input type="text" class="form-input" id="arts-search"
            placeholder="Buscar templates..." style="padding-left:34px;height:36px;font-size:0.8125rem;">
          <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);
            font-size:0.875rem;color:var(--text-muted);pointer-events:none;">⌕</span>
        </div>
        <!-- Category filter -->
        <div style="display:flex;gap:4px;flex-wrap:wrap;" id="arts-cat-pills">
          <button class="arts-cat-btn active" data-cat=""
            style="padding:5px 14px;border-radius:var(--radius-full);font-size:0.8125rem;
            font-weight:600;background:var(--brand-gold);color:#fff;border:none;cursor:pointer;">
            Todos
          </button>
          ${categories.map(c => `<button class="arts-cat-btn" data-cat="${esc(c.id)}"
            style="padding:5px 14px;border-radius:var(--radius-full);font-size:0.8125rem;
            font-weight:600;background:var(--bg-surface);color:var(--text-secondary);
            border:1px solid var(--border-subtle);cursor:pointer;">
            ${esc(c.icon||'')} ${esc(c.name)}
          </button>`).join('')}
        </div>
        <!-- Sector filter -->
        <select id="arts-sector-filter" class="filter-select" style="height:36px;font-size:0.8125rem;">
          <option value="">Todos os setores</option>
          ${SECTORS.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
        </select>
        <!-- Size filter -->
        <select id="arts-size-filter" class="filter-select" style="height:36px;font-size:0.8125rem;">
          <option value="">Todos os formatos</option>
          ${ART_SIZES.map(s => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join('')}
        </select>
      </div>
    </div>

    <!-- Template grid -->
    <div id="arts-template-grid"
      style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;">
    </div>`;

  await loadTemplateGrid(container);
  wireMainEvents(container, isAdmin, categories);
}

/* ─── Wire main events ─────────────────────────────────────── */
function wireMainEvents(container, isAdmin, categories) {
  // Search
  let searchTimeout;
  container.querySelector('#arts-search')?.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadTemplateGrid(container), 300);
  });

  // Category pills
  container.querySelector('#arts-cat-pills')?.addEventListener('click', e => {
    const btn = e.target.closest('.arts-cat-btn');
    if (!btn) return;
    container.querySelectorAll('.arts-cat-btn').forEach(b => {
      const active = b === btn;
      b.style.background = active ? 'var(--brand-gold)' : 'var(--bg-surface)';
      b.style.color      = active ? '#fff' : 'var(--text-secondary)';
      b.style.border     = active ? 'none' : '1px solid var(--border-subtle)';
      b.classList.toggle('active', active);
    });
    loadTemplateGrid(container);
  });

  // Sector + size filters
  container.querySelector('#arts-sector-filter')?.addEventListener('change', () => loadTemplateGrid(container));
  container.querySelector('#arts-size-filter')?.addEventListener('change', () => loadTemplateGrid(container));

  // Admin buttons
  if (isAdmin) {
    container.querySelector('#arts-manage-btn')?.addEventListener('click', () => showTemplateManager(container));
    container.querySelector('#arts-new-tpl-btn')?.addEventListener('click', () => showTemplateEditor(container, null));
    container.querySelector('#arts-cat-btn')?.addEventListener('click', () => showCategoryManager(container));
  }

  // Guide
  container.querySelector('#arts-guide-btn')?.addEventListener('click', showBestPractices);
}

/* ─── Template grid ────────────────────────────────────────── */
async function loadTemplateGrid(container) {
  const grid = container.querySelector('#arts-template-grid');
  if (!grid) return;
  grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">
    <div class="chart-loading-spinner"></div></div>`;

  let templates = await fetchTemplates().catch(() => []);

  // Install starters if empty
  if (!templates.length) {
    const count = await installStarterTemplates().catch(() => 0);
    if (count > 0) {
      templates = await fetchTemplates().catch(() => []);
      toast.success(`${count} templates iniciais instalados!`);
    }
  }

  // Apply filters
  const searchQ = container.querySelector('#arts-search')?.value?.toLowerCase().trim();
  const catId   = container.querySelector('.arts-cat-btn.active')?.dataset.cat || '';
  const sector  = container.querySelector('#arts-sector-filter')?.value || '';
  const sizeKey = container.querySelector('#arts-size-filter')?.value || '';

  if (searchQ) templates = templates.filter(t =>
    (t.name||'').toLowerCase().includes(searchQ) ||
    (t.category||'').toLowerCase().includes(searchQ));
  if (catId)   templates = templates.filter(t => t.categoryId === catId);
  if (sector)  templates = templates.filter(t => !t.sectors?.length || t.sectors.includes(sector));
  if (sizeKey) templates = templates.filter(t => t.size_key === sizeKey);

  if (!templates.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;" class="empty-state">
      <div class="empty-state-icon">▣</div>
      <div class="empty-state-title">Nenhum template encontrado</div>
      <div class="empty-state-subtitle">Ajuste os filtros ou crie um novo template.</div>
    </div>`;
    return;
  }

  grid.innerHTML = templates.map(t => {
    const size = ART_SIZES.find(s => s.key === t.size_key) || { label: t.size_key, w: 1080, h: 1080 };
    const ratio = size.h / size.w;
    return `
    <div class="card" style="padding:0;overflow:hidden;cursor:pointer;transition:transform .15s,box-shadow .15s;"
      onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px rgba(0,0,0,.2)'"
      onmouseout="this.style.transform='';this.style.boxShadow=''">
      <div style="background:var(--bg-surface);position:relative;padding-top:${Math.min(ratio * 100, 120)}%;
        overflow:hidden;">
        ${t.preview_url
          ? `<img src="${esc(t.preview_url)}" style="position:absolute;inset:0;
              width:100%;height:100%;object-fit:cover;" alt="" loading="lazy">`
          : `<div style="position:absolute;inset:0;display:flex;align-items:center;
              justify-content:center;flex-direction:column;gap:8px;color:var(--text-muted);">
              <span style="font-size:2rem;">▣</span>
              <span style="font-size:0.75rem;">${esc(String(size.w))}×${esc(String(size.h))}</span>
            </div>`}
        <div style="position:absolute;top:8px;right:8px;padding:3px 8px;
          background:rgba(0,0,0,.6);border-radius:20px;font-size:0.625rem;
          color:#fff;letter-spacing:.05em;font-weight:600;">
          ${esc(t.category || '')}
        </div>
      </div>
      <div style="padding:14px 16px;">
        <div style="font-weight:700;font-size:0.9375rem;margin-bottom:4px;">
          ${esc(t.name || 'Template')}
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);">
          ${esc(size.label)} · ${(t.layers || []).length} camada(s)
        </div>
        ${t.sectors?.length ? `<div style="font-size:0.6875rem;color:var(--text-muted);margin-top:4px;
          display:flex;flex-wrap:wrap;gap:3px;">
          ${t.sectors.map(s => `<span style="padding:1px 6px;background:var(--bg-surface);
            border:1px solid var(--border-subtle);border-radius:20px;">${esc(s)}</span>`).join('')}
        </div>` : ''}
        <button class="btn btn-primary btn-sm arts-use-btn" data-tid="${esc(t.id)}"
          style="width:100%;margin-top:12px;font-size:0.8125rem;">
          ▶ Usar este template
        </button>
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.arts-use-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openEditor(container, btn.dataset.tid);
    });
  });
}

/* ════════════════════════════════════════════════════════════
   Canvas Editor (fullscreen modal)
   ════════════════════════════════════════════════════════════ */
async function openEditor(container, templateId) {
  const template = await fetchTemplate(templateId);
  if (!template) { toast.error('Template não encontrado.'); return; }

  const size = ART_SIZES.find(s => s.key === template.size_key) || { w: 1080, h: 1080, label: '1080×1080' };
  _currentLayers = JSON.parse(JSON.stringify(template.layers || []));

  const editorModal = document.createElement('div');
  editorModal.id = 'arts-editor-modal';
  editorModal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:2000;
    display:flex;flex-direction:column;overflow:hidden;`;

  editorModal.innerHTML = `
    <!-- Toolbar -->
    <div class="arts-editor-toolbar" style="padding:10px 20px;background:var(--bg-surface);
      border-bottom:1px solid var(--border-subtle);
      display:flex;align-items:center;gap:12px;flex-shrink:0;flex-wrap:wrap;">
      <button id="arts-editor-close" class="btn btn-ghost btn-sm">← Voltar</button>
      <div class="arts-tpl-name" style="flex:1;font-weight:700;font-size:0.9375rem;overflow:hidden;
        text-overflow:ellipsis;white-space:nowrap;">${esc(template.name)}</div>
      <span style="font-size:0.75rem;color:var(--text-muted);">${esc(size.label)}</span>
      <button id="arts-zoom-in" class="btn btn-ghost btn-sm" title="Zoom +">+</button>
      <button id="arts-zoom-out" class="btn btn-ghost btn-sm" title="Zoom −">−</button>
      <button id="arts-export-png" class="btn btn-primary btn-sm">⬇ PNG</button>
      <button id="arts-export-jpg" class="btn btn-secondary btn-sm">⬇ JPG</button>
    </div>

    <!-- Editor body -->
    <div class="arts-editor-body" style="display:grid;grid-template-columns:1fr 320px;
      flex:1;overflow:hidden;min-height:0;">

      <!-- Canvas area -->
      <div id="arts-canvas-area" style="background:#1a1a1a;display:flex;align-items:center;
        justify-content:center;overflow:auto;padding:24px;">
        <div id="arts-canvas-wrap" style="position:relative;box-shadow:0 20px 60px rgba(0,0,0,.5);
          transform-origin:center center;">
          <canvas id="arts-fabric-canvas"></canvas>
        </div>
      </div>

      <!-- Right panel (bottom on mobile) -->
      <div class="arts-right-panel" style="background:var(--bg-surface);
        border-left:1px solid var(--border-subtle);
        display:flex;flex-direction:column;overflow:hidden;">

        <!-- Tab bar -->
        <div style="display:flex;border-bottom:1px solid var(--border-subtle);flex-shrink:0;">
          <button class="arts-panel-tab active" data-tab="layers"
            style="flex:1;padding:10px;font-size:0.75rem;font-weight:600;border:none;cursor:pointer;
            background:transparent;color:var(--text-primary);border-bottom:2px solid var(--brand-gold);">
            Camadas
          </button>
          <button class="arts-panel-tab" data-tab="filters"
            style="flex:1;padding:10px;font-size:0.75rem;font-weight:600;border:none;cursor:pointer;
            background:transparent;color:var(--text-muted);border-bottom:2px solid transparent;">
            Filtros
          </button>
          <button class="arts-panel-tab" data-tab="tips"
            style="flex:1;padding:10px;font-size:0.75rem;font-weight:600;border:none;cursor:pointer;
            background:transparent;color:var(--text-muted);border-bottom:2px solid transparent;">
            Dicas
          </button>
        </div>

        <!-- Tab content -->
        <div id="arts-panel-content" style="flex:1;overflow-y:auto;"></div>
      </div>
    </div>`;

  document.body.appendChild(editorModal);

  // Close
  editorModal.querySelector('#arts-editor-close').addEventListener('click', () => {
    if (fabricCanvas) { fabricCanvas.dispose(); fabricCanvas = null; }
    _currentLayers = null;
    editorModal.remove();
  });

  // Load Fabric.js
  await loadFabric();
  initFabricCanvas(template, size, editorModal);

  // Export
  editorModal.querySelector('#arts-export-png').addEventListener('click', () => exportCanvas('png', template.name));
  editorModal.querySelector('#arts-export-jpg').addEventListener('click', () => exportCanvas('jpg', template.name));

  // Zoom
  let zoomLevel = 1;
  editorModal.querySelector('#arts-zoom-in').addEventListener('click', () => {
    zoomLevel = Math.min(zoomLevel + 0.15, 2);
    const wrap = editorModal.querySelector('#arts-canvas-wrap');
    if (wrap) wrap.style.transform = `scale(${zoomLevel})`;
  });
  editorModal.querySelector('#arts-zoom-out').addEventListener('click', () => {
    zoomLevel = Math.max(zoomLevel - 0.15, 0.3);
    const wrap = editorModal.querySelector('#arts-canvas-wrap');
    if (wrap) wrap.style.transform = `scale(${zoomLevel})`;
  });

  // Tabs
  editorModal.querySelectorAll('.arts-panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      editorModal.querySelectorAll('.arts-panel-tab').forEach(t => {
        const active = t === tab;
        t.classList.toggle('active', active);
        t.style.color = active ? 'var(--text-primary)' : 'var(--text-muted)';
        t.style.borderBottomColor = active ? 'var(--brand-gold)' : 'transparent';
      });
      const tabName = tab.dataset.tab;
      if (tabName === 'layers') renderLayersPanel(_currentLayers, _currentScale);
      else if (tabName === 'filters') renderFiltersPanel();
      else if (tabName === 'tips') renderTipsPanel();
    });
  });
}

async function loadFabric() {
  if (window.fabric) return;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js';
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

function initFabricCanvas(template, size) {
  // Responsive: measure available canvas area
  const canvasArea = document.getElementById('arts-canvas-area');
  const isMobile = window.innerWidth <= 768;
  const availW = canvasArea ? canvasArea.clientWidth - (isMobile ? 24 : 48) : 600;
  const availH = canvasArea ? canvasArea.clientHeight - (isMobile ? 24 : 48) : 600;
  const MAX_DISPLAY = Math.min(availW, availH, isMobile ? availW : 600);

  _currentScale = Math.min(MAX_DISPLAY / size.w, MAX_DISPLAY / size.h, 1);
  const displayW = Math.round(size.w * _currentScale);
  const displayH = Math.round(size.h * _currentScale);

  const wrap = document.getElementById('arts-canvas-wrap');
  const canvasEl = document.getElementById('arts-fabric-canvas');
  if (!wrap || !canvasEl) return;

  wrap.style.width  = displayW + 'px';
  wrap.style.height = displayH + 'px';
  canvasEl.width  = displayW;
  canvasEl.height = displayH;

  fabricCanvas = new window.fabric.Canvas('arts-fabric-canvas', {
    width: displayW, height: displayH,
    backgroundColor: '#ffffff',
    selection: true,
    preserveObjectStacking: true,
  });

  renderLayers(_currentLayers, _currentScale);
  renderLayersPanel(_currentLayers, _currentScale);
}

/* ─── Render layers on canvas ──────────────────────────────── */
function renderLayers(layers, scale) {
  if (!fabricCanvas) return;
  fabricCanvas.clear();

  layers.forEach((layer, idx) => {
    const x = (layer.x || 0) * scale;
    const y = (layer.y || 0) * scale;
    const w = (layer.w || 100) * scale;
    const h = (layer.h || 100) * scale;

    switch (layer.type) {
      case 'background_image':
      case 'image': {
        if (layer.image_url) {
          window.fabric.Image.fromURL(layer.image_url, (img) => {
            if (!img) return;
            if (layer.type === 'background_image') {
              img.set({ left: 0, top: 0, selectable: false, evented: false });
              img.scaleToWidth(fabricCanvas.width);
              if (img.getScaledHeight() < fabricCanvas.height) img.scaleToHeight(fabricCanvas.height);
            } else {
              img.set({ left: x, top: y, scaleX: w / img.width, scaleY: h / img.height });
            }
            img.set({ opacity: layer.opacity ?? 1, data: { layerIdx: idx } });
            // Apply filter
            if (layer.filter && layer.filter !== 'none') {
              img.filters = getFabricFilters(layer.filter);
              img.applyFilters();
            }
            fabricCanvas.insertAt(img, idx);
            fabricCanvas.renderAll();
          }, { crossOrigin: 'anonymous' });
        }
        break;
      }
      case 'overlay':
      case 'rectangle': {
        const rect = new window.fabric.Rect({
          left: layer.type === 'overlay' ? 0 : x,
          top:  layer.type === 'overlay' ? 0 : y,
          width:  layer.type === 'overlay' ? fabricCanvas.width  : w,
          height: layer.type === 'overlay' ? fabricCanvas.height : h,
          fill: layer.fill || 'rgba(0,0,0,0.5)',
          opacity: layer.opacity ?? 1,
          rx: (layer.border_radius || 0) * scale,
          ry: (layer.border_radius || 0) * scale,
          selectable: layer.type !== 'overlay',
          data: { layerIdx: idx },
        });
        fabricCanvas.add(rect);
        break;
      }
      case 'text': {
        const text = new window.fabric.Textbox(layer.content || 'Texto aqui', {
          left: x, top: y, width: w,
          fontSize:    (layer.font_size || 32) * scale,
          fontWeight:  layer.font_weight || 'normal',
          fontFamily:  layer.font_family || 'Poppins',
          fill:        layer.color || '#ffffff',
          textAlign:   layer.align || 'left',
          lineHeight:  layer.line_height || 1.2,
          charSpacing: (layer.letter_spacing || 0) * 10,
          editable:    true,
          data:        { layerIdx: idx },
        });
        if (layer.shadow) {
          text.set('shadow', new window.fabric.Shadow({
            color: 'rgba(0,0,0,0.5)', blur: 8, offsetX: 2, offsetY: 2,
          }));
        }
        fabricCanvas.add(text);
        break;
      }
    }
  });

  fabricCanvas.renderAll();
}

/* ─── Layers panel ─────────────────────────────────────────── */
function renderLayersPanel(layers, scale) {
  const panel = document.getElementById('arts-panel-content');
  if (!panel || !layers) return;

  panel.innerHTML = layers.map((layer, idx) => {
    const typeDef = LAYER_TYPES[layer.type] || { label: layer.type, icon: '?' };
    const isEditable = layer.editable !== false;
    return `
    <div class="arts-layer-item" data-idx="${idx}"
      style="padding:12px 16px;border-bottom:1px solid var(--border-subtle);
      cursor:${isEditable ? 'pointer' : 'default'};
      opacity:${isEditable ? 1 : 0.5};transition:background .15s;"
      onmouseover="this.style.background='var(--bg-elevated)'"
      onmouseout="this.style.background=''">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:1rem;flex-shrink:0;">${esc(typeDef.icon)}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.8125rem;font-weight:600;overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap;">
            ${esc(layer.label || typeDef.label)}
          </div>
          ${layer.type === 'text' && layer.content
            ? `<div style="font-size:0.75rem;color:var(--text-muted);overflow:hidden;
                text-overflow:ellipsis;white-space:nowrap;">${esc((layer.content || '').slice(0, 30))}</div>` : ''}
        </div>
        ${isEditable ? `<span style="font-size:0.625rem;color:var(--brand-gold);
          font-weight:600;">✎</span>` : ''}
      </div>
      ${isEditable ? `<div class="arts-layer-fields" id="layer-fields-${idx}"
        style="display:none;margin-top:12px;padding-top:12px;
        border-top:1px solid var(--border-subtle);"></div>` : ''}
    </div>`;
  }).join('');

  panel.querySelectorAll('.arts-layer-item').forEach(item => {
    const idx = Number(item.dataset.idx);
    const layer = layers[idx];
    if (layer.editable === false) return;
    item.addEventListener('click', e => {
      if (e.target.closest('input,textarea,select,button,label')) return;
      const fields = document.getElementById(`layer-fields-${idx}`);
      if (!fields) return;
      const isOpen = fields.style.display !== 'none';
      panel.querySelectorAll('.arts-layer-fields').forEach(f => f.style.display = 'none');
      if (!isOpen) {
        fields.style.display = 'block';
        renderLayerFields(fields, layer, idx, scale);
      }
    });
  });
}

/* ─── Layer field editor ───────────────────────────────────── */
function renderLayerFields(container, layer, idx, scale) {
  const LBL = `font-size:0.75rem;font-weight:600;display:block;margin-bottom:4px;color:var(--text-muted);`;
  const typeDef = LAYER_TYPES[layer.type] || { editable: [] };
  const editableFields = typeDef.editable || [];
  let html = '';

  // TEXT
  if (layer.type === 'text' || editableFields.includes('content')) {
    html += `<div style="margin-bottom:10px;">
      <label style="${LBL}">Texto</label>
      <textarea id="lf-content-${idx}" class="form-textarea" rows="3"
        style="width:100%;font-size:0.8125rem;">${esc(layer.content || '')}</textarea>
      ${layer.max_chars ? `<div style="font-size:0.6875rem;color:var(--text-muted);margin-top:3px;">
        Máx ${layer.max_chars} caracteres</div>` : ''}
    </div>`;
  }

  // FONT
  if (editableFields.includes('font_family')) {
    html += `<div style="margin-bottom:10px;">
      <label style="${LBL}">Fonte</label>
      <select id="lf-font-${idx}" class="filter-select" style="width:100%;font-size:0.8125rem;">
        ${AVAILABLE_FONTS.map(f => `<option value="${esc(f)}"
          ${(layer.font_family || 'Poppins') === f ? 'selected' : ''}
          style="font-family:'${esc(f)}';">${esc(f)}</option>`).join('')}
      </select>
    </div>`;
  }

  // FONT SIZE + WEIGHT
  if (editableFields.includes('font_size')) {
    html += `<div class="lf-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
      <div>
        <label style="${LBL}">Tamanho</label>
        <input id="lf-fsize-${idx}" type="number" class="form-input"
          value="${layer.font_size || 32}" min="8" max="200" style="width:100%;font-size:0.8125rem;">
      </div>
      <div>
        <label style="${LBL}">Peso</label>
        <select id="lf-fweight-${idx}" class="filter-select" style="width:100%;font-size:0.8125rem;">
          ${['300','400','500','600','700','800','900'].map(w =>
            `<option ${(layer.font_weight || '400') === w ? 'selected' : ''}>${w}</option>`).join('')}
        </select>
      </div>
    </div>`;
  }

  // ALIGN + LINE HEIGHT
  if (editableFields.includes('align')) {
    html += `<div class="lf-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
      <div>
        <label style="${LBL}">Alinhamento</label>
        <select id="lf-align-${idx}" class="filter-select" style="width:100%;font-size:0.8125rem;">
          ${[['left','Esquerda'],['center','Centro'],['right','Direita']].map(([v,l]) =>
            `<option value="${v}" ${(layer.align || 'left') === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div>
        <label style="${LBL}">Entrelinha</label>
        <input id="lf-lh-${idx}" type="number" class="form-input"
          value="${layer.line_height || 1.2}" min="0.5" max="3" step="0.1"
          style="width:100%;font-size:0.8125rem;">
      </div>
    </div>`;
  }

  // LETTER SPACING
  if (editableFields.includes('letter_spacing')) {
    html += `<div style="margin-bottom:10px;">
      <label style="${LBL}">Espaçamento: <span id="lf-ls-val-${idx}">${layer.letter_spacing || 0}</span>px</label>
      <input id="lf-ls-${idx}" type="range" min="-5" max="20" value="${layer.letter_spacing || 0}"
        style="width:100%;accent-color:var(--brand-gold);">
    </div>`;
  }

  // IMAGE URL + picker
  if (editableFields.includes('image_url')) {
    html += `<div style="margin-bottom:10px;">
      <label style="${LBL}">Imagem</label>
      ${layer.image_url ? `<div style="margin-bottom:6px;border-radius:var(--radius-sm);overflow:hidden;
        height:60px;background:var(--bg-dark);">
        <img src="${esc(layer.image_url)}" style="width:100%;height:100%;object-fit:cover;">
      </div>` : ''}
      <input id="lf-img-${idx}" type="text" class="form-input"
        style="width:100%;font-size:0.75rem;margin-bottom:6px;" value="${esc(layer.image_url || '')}"
        placeholder="URL da imagem">
      <div style="display:flex;gap:6px;">
        <button class="btn btn-ghost btn-sm lf-img-pick" data-idx="${idx}"
          style="flex:1;font-size:0.75rem;">🖼 Banco de Imagens</button>
        <button class="btn btn-ghost btn-sm lf-tip-pick" data-idx="${idx}"
          style="flex:1;font-size:0.75rem;">✈ Portal de Dicas</button>
      </div>
    </div>`;
  }

  // FILTER
  if (editableFields.includes('filter')) {
    html += `<div style="margin-bottom:10px;">
      <label style="${LBL}">Filtro de imagem</label>
      <select id="lf-filter-${idx}" class="filter-select" style="width:100%;font-size:0.8125rem;">
        ${IMAGE_FILTERS.map(f => `<option value="${esc(f.key)}"
          ${(layer.filter || 'none') === f.key ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}
      </select>
    </div>`;
  }

  // COLOR
  if (editableFields.includes('color') || editableFields.includes('fill')) {
    const field = editableFields.includes('color') ? 'color' : 'fill';
    const val = layer[field] || '#ffffff';
    html += `<div style="margin-bottom:10px;">
      <label style="${LBL}">${field === 'color' ? 'Cor do texto' : 'Cor de preenchimento'}</label>
      <div style="display:flex;gap:8px;align-items:center;">
        <input id="lf-color-${idx}" type="color" value="${esc(val.startsWith('rgba') ? '#000000' : val)}"
          style="width:40px;height:32px;border:none;background:none;cursor:pointer;padding:0;">
        <input id="lf-color-hex-${idx}" type="text" class="form-input"
          value="${esc(val)}" style="flex:1;font-size:0.8125rem;font-family:monospace;">
      </div>
    </div>`;
  }

  // OPACITY
  if (editableFields.includes('opacity')) {
    html += `<div style="margin-bottom:10px;">
      <label style="${LBL}">Opacidade: <span id="lf-opacity-val-${idx}">${Math.round((layer.opacity ?? 1) * 100)}%</span></label>
      <input id="lf-opacity-${idx}" type="range" min="0" max="100"
        value="${Math.round((layer.opacity ?? 1) * 100)}"
        style="width:100%;accent-color:var(--brand-gold);">
    </div>`;
  }

  // BORDER RADIUS
  if (editableFields.includes('border_radius')) {
    html += `<div style="margin-bottom:10px;">
      <label style="${LBL}">Arredondamento: <span id="lf-br-val-${idx}">${layer.border_radius || 0}px</span></label>
      <input id="lf-br-${idx}" type="range" min="0" max="100" value="${layer.border_radius || 0}"
        style="width:100%;accent-color:var(--brand-gold);">
    </div>`;
  }

  // SHADOW (text)
  if (editableFields.includes('shadow')) {
    html += `<div style="margin-bottom:10px;">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
        <input id="lf-shadow-${idx}" type="checkbox" ${layer.shadow ? 'checked' : ''}
          style="accent-color:var(--brand-gold);">
        <span style="font-size:0.8125rem;">Sombra no texto</span>
      </label>
    </div>`;
  }

  html += `<button class="btn btn-primary btn-sm" id="lf-apply-${idx}"
    style="width:100%;margin-top:8px;">✓ Aplicar</button>`;

  container.innerHTML = html;

  // Wire image pickers
  container.querySelectorAll('.lf-img-pick').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      showImageBankPicker(url => {
        const inp = document.getElementById(`lf-img-${btn.dataset.idx}`);
        if (inp) inp.value = url;
      });
    });
  });
  container.querySelectorAll('.lf-tip-pick').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      showTipImagePicker(url => {
        const inp = document.getElementById(`lf-img-${btn.dataset.idx}`);
        if (inp) inp.value = url;
      });
    });
  });

  // Wire syncs
  const colorPicker = document.getElementById(`lf-color-${idx}`);
  const colorHex = document.getElementById(`lf-color-hex-${idx}`);
  colorPicker?.addEventListener('input', () => { if (colorHex) colorHex.value = colorPicker.value; });
  colorHex?.addEventListener('input', () => {
    if (/^#[0-9a-f]{6}$/i.test(colorHex.value) && colorPicker) colorPicker.value = colorHex.value;
  });

  const opacityRange = document.getElementById(`lf-opacity-${idx}`);
  const opacityVal = document.getElementById(`lf-opacity-val-${idx}`);
  opacityRange?.addEventListener('input', () => { if (opacityVal) opacityVal.textContent = opacityRange.value + '%'; });

  const brRange = document.getElementById(`lf-br-${idx}`);
  const brVal = document.getElementById(`lf-br-val-${idx}`);
  brRange?.addEventListener('input', () => { if (brVal) brVal.textContent = brRange.value + 'px'; });

  const lsRange = document.getElementById(`lf-ls-${idx}`);
  const lsVal = document.getElementById(`lf-ls-val-${idx}`);
  lsRange?.addEventListener('input', () => { if (lsVal) lsVal.textContent = lsRange.value; });

  // Apply
  document.getElementById(`lf-apply-${idx}`)?.addEventListener('click', e => {
    e.stopPropagation();
    applyLayerChanges(idx, layer, scale);
  });
}

function applyLayerChanges(idx, layer, scale) {
  if (!fabricCanvas) return;

  const obj = fabricCanvas.getObjects().find(o => o.data?.layerIdx === idx);
  if (!obj) { toast.error('Camada não encontrada no canvas.'); return; }

  const val = id => document.getElementById(id)?.value;
  const content = val(`lf-content-${idx}`);
  const imgUrl  = val(`lf-img-${idx}`)?.trim();
  const color   = val(`lf-color-hex-${idx}`) || val(`lf-color-${idx}`);
  const opacity = val(`lf-opacity-${idx}`);
  const font    = val(`lf-font-${idx}`);
  const fsize   = val(`lf-fsize-${idx}`);
  const fweight = val(`lf-fweight-${idx}`);
  const align   = val(`lf-align-${idx}`);
  const lh      = val(`lf-lh-${idx}`);
  const ls      = val(`lf-ls-${idx}`);
  const br      = val(`lf-br-${idx}`);
  const filter  = val(`lf-filter-${idx}`);
  const shadow  = document.getElementById(`lf-shadow-${idx}`)?.checked;

  // Update layer data
  if (content !== undefined) layer.content = content;
  if (color) { if ('color' in layer) layer.color = color; else layer.fill = color; }
  if (opacity !== undefined) layer.opacity = Number(opacity) / 100;
  if (font) layer.font_family = font;
  if (fsize) layer.font_size = Number(fsize);
  if (fweight) layer.font_weight = fweight;
  if (align) layer.align = align;
  if (lh) layer.line_height = Number(lh);
  if (ls !== undefined) layer.letter_spacing = Number(ls);
  if (br !== undefined) layer.border_radius = Number(br);
  if (filter) layer.filter = filter;
  layer.shadow = !!shadow;

  // Handle image change
  if (imgUrl && imgUrl !== layer.image_url) {
    layer.image_url = imgUrl;
    renderLayers(_currentLayers, scale);
    toast.success('Imagem atualizada!');
    return;
  }

  // Handle filter change on image object
  if (filter && obj.type === 'image') {
    obj.filters = getFabricFilters(filter);
    obj.applyFilters();
  }

  // Apply to fabric object
  if (content !== undefined && obj.type === 'textbox') obj.set('text', content);
  if (color) obj.set('fill', color);
  if (opacity !== undefined) obj.set('opacity', Number(opacity) / 100);
  if (font && obj.type === 'textbox') obj.set('fontFamily', font);
  if (fsize && obj.type === 'textbox') obj.set('fontSize', Number(fsize) * scale);
  if (fweight && obj.type === 'textbox') obj.set('fontWeight', fweight);
  if (align && obj.type === 'textbox') obj.set('textAlign', align);
  if (lh && obj.type === 'textbox') obj.set('lineHeight', Number(lh));
  if (ls !== undefined && obj.type === 'textbox') obj.set('charSpacing', Number(ls) * 10);
  if (br !== undefined && (obj.type === 'rect')) {
    obj.set('rx', Number(br) * scale);
    obj.set('ry', Number(br) * scale);
  }
  if (shadow !== undefined && obj.type === 'textbox') {
    obj.set('shadow', shadow
      ? new window.fabric.Shadow({ color: 'rgba(0,0,0,0.5)', blur: 8, offsetX: 2, offsetY: 2 })
      : null);
  }

  fabricCanvas.renderAll();
  toast.success('Aplicado!');
}

/* ─── Filters panel ────────────────────────────────────────── */
function renderFiltersPanel() {
  const panel = document.getElementById('arts-panel-content');
  if (!panel) return;

  // Find image layers
  const imgLayers = (_currentLayers || [])
    .map((l, i) => ({ ...l, idx: i }))
    .filter(l => (l.type === 'background_image' || l.type === 'image') && l.editable !== false);

  if (!imgLayers.length) {
    panel.innerHTML = `<div style="padding:40px 20px;text-align:center;color:var(--text-muted);">
      <div style="font-size:1.5rem;margin-bottom:8px;opacity:.4;">📷</div>
      Nenhuma camada de imagem editável neste template.
    </div>`;
    return;
  }

  panel.innerHTML = imgLayers.map(layer => `
    <div style="padding:14px 16px;border-bottom:1px solid var(--border-subtle);">
      <div style="font-size:0.8125rem;font-weight:600;margin-bottom:10px;">
        ${esc(layer.label || 'Imagem')}
      </div>
      <div class="arts-filter-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
        ${IMAGE_FILTERS.map(f => `
          <button class="filter-preview-btn" data-idx="${layer.idx}" data-filter="${esc(f.key)}"
            style="border:2px solid ${(layer.filter || 'none') === f.key ? 'var(--brand-gold)' : 'var(--border-subtle)'};
            border-radius:var(--radius-sm);padding:6px 4px;background:var(--bg-dark);cursor:pointer;
            text-align:center;transition:border-color .15s;">
            <div style="font-size:0.6875rem;font-weight:500;color:${(layer.filter || 'none') === f.key ? 'var(--brand-gold)' : 'var(--text-muted)'};">
              ${esc(f.label)}
            </div>
          </button>`).join('')}
      </div>
    </div>`).join('');

  panel.querySelectorAll('.filter-preview-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      const filterKey = btn.dataset.filter;
      const layer = _currentLayers[idx];
      if (!layer) return;
      layer.filter = filterKey;

      // Update border highlights
      btn.closest('div[style*="grid"]').querySelectorAll('.filter-preview-btn').forEach(b => {
        const active = b === btn;
        b.style.borderColor = active ? 'var(--brand-gold)' : 'var(--border-subtle)';
        b.querySelector('div').style.color = active ? 'var(--brand-gold)' : 'var(--text-muted)';
      });

      // Apply filter to canvas
      const obj = fabricCanvas?.getObjects().find(o => o.data?.layerIdx === idx);
      if (obj && obj.type === 'image') {
        obj.filters = getFabricFilters(filterKey);
        obj.applyFilters();
        fabricCanvas.renderAll();
        toast.success(`Filtro "${IMAGE_FILTERS.find(f => f.key === filterKey)?.label}" aplicado!`);
      } else {
        // Re-render if object not found yet (loading)
        renderLayers(_currentLayers, _currentScale);
      }
    });
  });
}

/* ─── Tips panel (portal de dicas integration) ─────────────── */
async function renderTipsPanel() {
  const panel = document.getElementById('arts-panel-content');
  if (!panel) return;
  panel.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);">
    <div class="chart-loading-spinner"></div></div>`;

  try {
    const { fetchTips } = await import('../services/portal.js');
    const tips = await fetchTips({});

    if (!tips.length) {
      panel.innerHTML = `<div style="padding:40px 20px;text-align:center;color:var(--text-muted);">
        Nenhuma dica cadastrada no portal.</div>`;
      return;
    }

    panel.innerHTML = `
      <div style="padding:12px 16px;border-bottom:1px solid var(--border-subtle);">
        <input type="text" class="form-input" id="tips-search"
          placeholder="Buscar destinos..." style="width:100%;height:32px;font-size:0.8125rem;">
      </div>
      <div id="tips-list" style="padding:8px 0;"></div>`;

    const renderTipsList = (q = '') => {
      const filtered = q
        ? tips.filter(t => `${t.city} ${t.country} ${t.continent}`.toLowerCase().includes(q))
        : tips.slice(0, 30);

      document.getElementById('tips-list').innerHTML = filtered.map(t => `
        <div class="tip-item" data-city="${esc(t.city || '')}" data-country="${esc(t.country || '')}"
          style="padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--border-subtle);
          transition:background .15s;display:flex;align-items:center;gap:10px;"
          onmouseover="this.style.background='var(--bg-elevated)'"
          onmouseout="this.style.background=''">
          <span style="font-size:1rem;">✈</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.8125rem;font-weight:600;">${esc(t.city || t.country || 'Destino')}</div>
            <div style="font-size:0.6875rem;color:var(--text-muted);">${esc(t.continent || '')} · ${esc(t.country || '')}</div>
          </div>
          <span style="font-size:0.6875rem;color:var(--brand-gold);">Inserir ↗</span>
        </div>`).join('');

      document.querySelectorAll('.tip-item').forEach(item => {
        item.addEventListener('click', () => {
          // Find first text layer and insert destination name
          const textLayer = _currentLayers?.find(l => l.type === 'text' && l.editable !== false);
          if (textLayer) {
            const city = item.dataset.city;
            const country = item.dataset.country;
            textLayer.content = city ? city.toUpperCase() : country?.toUpperCase() || '';
            renderLayers(_currentLayers, _currentScale);
            renderLayersPanel(_currentLayers, _currentScale);
            // Switch to layers tab
            document.querySelector('.arts-panel-tab[data-tab="layers"]')?.click();
            toast.success(`Destino "${city || country}" inserido!`);
          } else {
            toast.info('Nenhuma camada de texto editável encontrada.');
          }
        });
      });
    };

    renderTipsList();
    document.getElementById('tips-search')?.addEventListener('input', e => {
      renderTipsList(e.target.value.trim().toLowerCase());
    });
  } catch (e) {
    panel.innerHTML = `<div style="padding:40px 20px;text-align:center;color:var(--text-muted);">
      Erro ao carregar dicas.</div>`;
  }
}

/* ─── Image bank picker modal ──────────────────────────────── */
function showImageBankPicker(onSelect) {
  const pickerModal = document.createElement('div');
  pickerModal.className = 'arts-sub-modal';
  pickerModal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:3000;
    display:flex;align-items:center;justify-content:center;padding:20px;`;
  pickerModal.innerHTML = `
    <div class="card" style="width:100%;max-width:800px;max-height:85vh;
      padding:0;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:14px 20px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;gap:12px;flex-shrink:0;flex-wrap:wrap;">
        <div style="font-weight:700;flex:1;min-width:120px;">🖼 Banco de Imagens</div>
        <input type="text" class="form-input" id="ibp-search"
          placeholder="Buscar imagens..." style="flex:1;min-width:140px;height:36px;font-size:0.8125rem;">
        <button id="ibp-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);min-width:36px;min-height:36px;">✕</button>
      </div>
      <div id="ibp-grid" class="ibp-grid" style="padding:16px;overflow-y:auto;flex:1;
        display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;">
        <div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted);">
          <div class="chart-loading-spinner"></div>
        </div>
      </div>
    </div>`;

  document.body.appendChild(pickerModal);
  pickerModal.addEventListener('click', e => { if (e.target === pickerModal) pickerModal.remove(); });
  pickerModal.querySelector('#ibp-close').addEventListener('click', () => pickerModal.remove());

  let allImages = [];
  fetchImages({}).then(imgs => {
    allImages = imgs;
    renderImgGrid(imgs);
  }).catch(() => {});

  pickerModal.querySelector('#ibp-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    renderImgGrid(q ? allImages.filter(i =>
      `${i.name} ${i.placeName} ${i.country} ${i.city} ${(i.tags || []).join(' ')}`.toLowerCase().includes(q)
    ) : allImages);
  });

  function renderImgGrid(imgs) {
    const grid = pickerModal.querySelector('#ibp-grid');
    if (!grid) return;
    if (!imgs.length) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted);">
        Nenhuma imagem encontrada.</div>`;
      return;
    }
    grid.innerHTML = imgs.slice(0, 80).map(img => `
      <button class="ibp-img-btn" data-url="${esc(img.url)}"
        style="border:2px solid var(--border-subtle);border-radius:var(--radius-sm);
        overflow:hidden;cursor:pointer;background:none;padding:0;aspect-ratio:1;
        transition:border-color .2s;position:relative;">
        <img src="${esc(img.url)}" alt="${esc(img.name || '')}"
          style="width:100%;height:100%;object-fit:cover;" loading="lazy">
        <div style="position:absolute;bottom:0;left:0;right:0;padding:4px 6px;
          background:linear-gradient(transparent,rgba(0,0,0,.7));font-size:0.625rem;
          color:#fff;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${esc(img.name || img.placeName || '')}
        </div>
      </button>`).join('');
    grid.querySelectorAll('.ibp-img-btn').forEach(btn => {
      btn.addEventListener('mouseenter', () => btn.style.borderColor = 'var(--brand-gold)');
      btn.addEventListener('mouseleave', () => btn.style.borderColor = 'var(--border-subtle)');
      btn.addEventListener('click', () => { pickerModal.remove(); onSelect(btn.dataset.url); });
    });
  }
}

/* ─── Tip image picker ─────────────────────────────────────── */
async function showTipImagePicker(onSelect) {
  toast.info('Carregando dicas do portal…');
  try {
    const { fetchTips } = await import('../services/portal.js');
    const tips = await fetchTips({});
    // Extract images from tips that have them
    const images = [];
    for (const tip of tips) {
      if (tip.coverImage) images.push({ url: tip.coverImage, name: `${tip.city || tip.country} — Capa`, city: tip.city });
      // Check segments for images
      if (tip.segments && typeof tip.segments === 'object') {
        for (const [, seg] of Object.entries(tip.segments)) {
          if (seg?.items) {
            for (const item of seg.items) {
              if (item?.image) images.push({ url: item.image, name: item.name || tip.city || '', city: tip.city });
            }
          }
        }
      }
    }
    if (!images.length) { toast.info('Nenhuma imagem encontrada nas dicas do portal.'); return; }
    showImageBankPicker(onSelect);
  } catch { toast.error('Erro ao carregar dicas.'); }
}

/* ─── Export ───────────────────────────────────────────────── */
function exportCanvas(format, name) {
  if (!fabricCanvas) return;
  fabricCanvas.discardActiveObject();
  fabricCanvas.renderAll();

  // Use higher multiplier on desktop, lower on mobile to avoid memory issues
  const isMobile = window.innerWidth <= 768;
  const multiplier = isMobile ? 2 : 3;

  const dataUrl = fabricCanvas.toDataURL({
    format: format === 'jpg' ? 'jpeg' : 'png',
    quality: 0.92,
    multiplier,
  });

  const fileName = `${(name || 'arte').replace(/\s+/g, '-')}.${format}`;

  // On mobile Safari/iOS, blob download works better for saving to gallery
  if (isMobile && navigator.share && format === 'png') {
    // Use Web Share API if available (iOS Safari, Android Chrome)
    fetch(dataUrl)
      .then(res => res.blob())
      .then(blob => {
        const file = new File([blob], fileName, { type: `image/${format === 'jpg' ? 'jpeg' : 'png'}` });
        navigator.share({ files: [file], title: fileName }).catch(() => {
          // Fallback to download link if share was cancelled
          triggerDownload(dataUrl, fileName);
        });
      })
      .catch(() => triggerDownload(dataUrl, fileName));
  } else {
    triggerDownload(dataUrl, fileName);
  }

  toast.success(`Arte exportada em ${format.toUpperCase()}!`);
  recordArtGeneration({ templateName: name, format }).catch(() => {});
}

function triggerDownload(dataUrl, fileName) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 100);
}

/* ════════════════════════════════════════════════════════════
   Template Manager (admin)
   ════════════════════════════════════════════════════════════ */
async function showTemplateManager(container) {
  const mgr = document.createElement('div');
  mgr.className = 'arts-sub-modal';
  mgr.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:2000;
    display:flex;align-items:center;justify-content:center;padding:20px;`;
  mgr.innerHTML = `
    <div class="card" style="width:100%;max-width:700px;max-height:90vh;
      padding:0;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:16px 22px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div style="font-weight:700;">Gerenciar Templates</div>
        <div style="display:flex;gap:8px;">
          <button id="tm-new-btn" class="btn btn-primary btn-sm">+ Novo</button>
          <button id="tm-close" style="border:none;background:none;cursor:pointer;
            font-size:1.25rem;color:var(--text-muted);">✕</button>
        </div>
      </div>
      <div id="tm-list" style="overflow-y:auto;flex:1;padding:12px 16px;
        display:flex;flex-direction:column;gap:8px;">
        <div style="text-align:center;padding:20px;color:var(--text-muted);">
          <div class="chart-loading-spinner"></div></div>
      </div>
    </div>`;

  document.body.appendChild(mgr);
  mgr.addEventListener('click', e => { if (e.target === mgr) mgr.remove(); });
  mgr.querySelector('#tm-close').addEventListener('click', () => mgr.remove());
  mgr.querySelector('#tm-new-btn').addEventListener('click', () => {
    mgr.remove(); showTemplateEditor(container, null);
  });

  const templates = await fetchTemplates().catch(() => []);
  const list = mgr.querySelector('#tm-list');

  if (!templates.length) {
    list.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">
      Nenhum template.</div>`;
    return;
  }

  list.innerHTML = templates.map(t => {
    const size = ART_SIZES.find(s => s.key === t.size_key);
    return `<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;
      background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-md);">
      <div style="width:48px;height:36px;background:var(--bg-dark);border-radius:var(--radius-sm);
        overflow:hidden;flex-shrink:0;">
        ${t.preview_url ? `<img src="${esc(t.preview_url)}" style="width:100%;height:100%;object-fit:cover;">` : ''}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:0.875rem;">${esc(t.name)}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">
          ${esc(t.category || '')} · ${esc(size?.label || t.size_key || '')} · ${(t.layers || []).length} camadas
          ${t.sectors?.length ? ` · ${t.sectors.join(', ')}` : ''}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="btn btn-ghost btn-sm tm-dup-btn" data-tid="${esc(t.id)}" title="Duplicar"
          style="font-size:0.75rem;">⎘</button>
        <button class="btn btn-ghost btn-sm tm-edit-btn" data-tid="${esc(t.id)}"
          style="font-size:0.75rem;color:var(--brand-gold);">✎</button>
        <button class="btn btn-ghost btn-sm tm-del-btn" data-tid="${esc(t.id)}" data-name="${esc(t.name)}"
          style="font-size:0.75rem;color:#EF4444;">✕</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.tm-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => { mgr.remove(); showTemplateEditor(container, btn.dataset.tid); });
  });
  list.querySelectorAll('.tm-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Excluir template "${btn.dataset.name}"?`)) return;
      await deleteTemplate(btn.dataset.tid);
      toast.success('Template excluído.');
      mgr.remove();
      renderArtsEditor(container);
    });
  });
  list.querySelectorAll('.tm-dup-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orig = await fetchTemplate(btn.dataset.tid);
      if (!orig) return;
      await saveTemplate(null, { ...orig, name: orig.name + ' (cópia)', id: undefined });
      toast.success('Template duplicado!');
      mgr.remove();
      renderArtsEditor(container);
    });
  });
}

/* ════════════════════════════════════════════════════════════
   Template Editor (admin)
   ════════════════════════════════════════════════════════════ */
async function showTemplateEditor(container, templateId) {
  const template = templateId ? await fetchTemplate(templateId) : {
    name: '', category: 'Instagram', size_key: 'feed_square',
    categoryId: '', sectors: [], layers: [], preview_url: '',
  };

  const categories = await fetchArtCategories().catch(() => []);

  const edModal = document.createElement('div');
  edModal.className = 'arts-sub-modal';
  edModal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:2000;
    display:flex;align-items:center;justify-content:center;padding:20px;`;

  const LBL = `font-size:0.75rem;font-weight:600;display:block;margin-bottom:6px;`;

  edModal.innerHTML = `
    <div class="card" style="width:100%;max-width:700px;max-height:90vh;
      padding:0;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:16px 22px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div style="font-weight:700;">${templateId ? 'Editar' : 'Novo'} Template</div>
        <button id="te-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);">✕</button>
      </div>
      <div style="overflow-y:auto;flex:1;padding:20px 22px;">

        <div style="margin-bottom:14px;">
          <label style="${LBL}">Nome do template *</label>
          <input id="te-name" type="text" class="form-input" style="width:100%;"
            value="${esc(template.name)}" placeholder="Ex: Destaque de Destino - Stories">
        </div>

        <div class="te-grid-3" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px;">
          <div>
            <label style="${LBL}">Categoria de rede</label>
            <select id="te-cat" class="filter-select" style="width:100%;">
              ${['Instagram', 'LinkedIn', 'WhatsApp', 'Email', 'Impressão', 'Outros'].map(c =>
                `<option ${template.category === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="${LBL}">Categoria de arte</label>
            <select id="te-art-cat" class="filter-select" style="width:100%;">
              <option value="">— Nenhuma —</option>
              ${categories.map(c => `<option value="${esc(c.id)}"
                ${template.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="${LBL}">Tamanho</label>
            <select id="te-size" class="filter-select" style="width:100%;">
              ${ART_SIZES.map(s => `<option value="${s.key}"
                ${template.size_key === s.key ? 'selected' : ''}>${s.label}</option>`).join('')}
            </select>
          </div>
        </div>

        <div style="margin-bottom:14px;">
          <label style="${LBL}">Setores vinculados (vazio = disponível para todos)</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${SECTORS.map(s => `<label style="display:flex;align-items:center;gap:5px;
              font-size:0.8125rem;cursor:pointer;">
              <input type="checkbox" class="te-sector-cb" value="${esc(s)}"
                ${(template.sectors || []).includes(s) ? 'checked' : ''}>
              ${esc(s)}
            </label>`).join('')}
          </div>
        </div>

        <div style="margin-bottom:14px;">
          <label style="${LBL}">Imagem de preview</label>
          <div style="display:flex;gap:8px;">
            <input id="te-preview" type="text" class="form-input" style="flex:1;"
              value="${esc(template.preview_url || '')}" placeholder="https://…">
            <button class="btn btn-ghost btn-sm" id="te-preview-pick">🖼 Banco</button>
          </div>
        </div>

        <div style="margin-bottom:14px;">
          <label style="${LBL}">Camadas (JSON)
            <span style="font-weight:400;color:var(--text-muted);margin-left:6px;">
              — cada camada: type, label, editable, x, y, w, h, + campos do tipo
            </span>
          </label>
          <textarea id="te-layers" class="form-textarea" rows="14"
            style="width:100%;font-family:monospace;font-size:0.75rem;"
          >${esc(JSON.stringify(template.layers || [], null, 2))}</textarea>
        </div>

        <details>
          <summary style="font-size:0.8125rem;cursor:pointer;color:var(--brand-gold);
            font-weight:600;margin-bottom:8px;">📋 Referência de tipos de camada</summary>
          <div style="background:var(--bg-surface);border-radius:var(--radius-sm);
            padding:12px;font-size:0.75rem;font-family:monospace;color:var(--text-muted);">
            ${Object.entries(LAYER_TYPES).map(([key, def]) =>
              `<div style="margin-bottom:8px;">
                <strong style="color:var(--text-primary);">${key}</strong> — ${def.label}<br>
                Campos: ${def.editable.join(', ')}
              </div>`).join('')}
          </div>
        </details>
      </div>

      <div style="padding:14px 22px;border-top:1px solid var(--border-subtle);
        background:var(--bg-surface);display:flex;gap:10px;flex-shrink:0;">
        <button class="btn btn-secondary" id="te-cancel" style="flex:1;">Cancelar</button>
        <button class="btn btn-primary"   id="te-save"   style="flex:2;">💾 Salvar</button>
      </div>
    </div>`;

  document.body.appendChild(edModal);
  edModal.addEventListener('click', e => { if (e.target === edModal) edModal.remove(); });
  edModal.querySelector('#te-close').addEventListener('click', () => edModal.remove());
  edModal.querySelector('#te-cancel').addEventListener('click', () => edModal.remove());

  // Preview image picker
  edModal.querySelector('#te-preview-pick')?.addEventListener('click', () => {
    showImageBankPicker(url => {
      const inp = document.getElementById('te-preview');
      if (inp) inp.value = url;
    });
  });

  // Save
  edModal.querySelector('#te-save').addEventListener('click', async () => {
    const btn = edModal.querySelector('#te-save');
    btn.disabled = true; btn.textContent = '⏳';
    try {
      let layers;
      try { layers = JSON.parse(document.getElementById('te-layers')?.value || '[]'); }
      catch { toast.error('JSON de camadas inválido.'); btn.disabled = false; btn.textContent = '💾 Salvar'; return; }

      const sectors = [...edModal.querySelectorAll('.te-sector-cb:checked')].map(cb => cb.value);
      await saveTemplate(templateId || null, {
        name:       document.getElementById('te-name')?.value?.trim() || 'Sem título',
        category:   document.getElementById('te-cat')?.value,
        categoryId: document.getElementById('te-art-cat')?.value || '',
        size_key:   document.getElementById('te-size')?.value,
        preview_url:document.getElementById('te-preview')?.value?.trim() || '',
        sectors,
        layers,
      });
      toast.success('Template salvo!');
      edModal.remove();
      renderArtsEditor(container);
    } catch (e) {
      toast.error('Erro: ' + e.message);
      btn.disabled = false; btn.textContent = '💾 Salvar';
    }
  });
}

/* ════════════════════════════════════════════════════════════
   Category Manager
   ════════════════════════════════════════════════════════════ */
async function showCategoryManager(container) {
  const catModal = document.createElement('div');
  catModal.className = 'arts-sub-modal';
  catModal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:2000;
    display:flex;align-items:center;justify-content:center;padding:20px;`;

  catModal.innerHTML = `
    <div class="card" style="width:100%;max-width:500px;max-height:80vh;
      padding:0;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:16px 22px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div style="font-weight:700;">Categorias de Artes</div>
        <button id="catm-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);">✕</button>
      </div>

      <!-- Add form -->
      <div style="padding:14px 22px;border-bottom:1px solid var(--border-subtle);display:flex;gap:8px;">
        <input type="text" id="catm-name" class="form-input" placeholder="Nome da categoria"
          style="flex:1;font-size:0.8125rem;">
        <input type="text" id="catm-icon" class="form-input" placeholder="Ícone" maxlength="4"
          style="width:50px;text-align:center;font-size:1rem;">
        <button class="btn btn-primary btn-sm" id="catm-add">+</button>
      </div>

      <div id="catm-list" style="overflow-y:auto;flex:1;padding:8px 16px;">
        <div style="text-align:center;padding:20px;color:var(--text-muted);">
          <div class="chart-loading-spinner"></div></div>
      </div>
    </div>`;

  document.body.appendChild(catModal);
  catModal.addEventListener('click', e => { if (e.target === catModal) catModal.remove(); });
  catModal.querySelector('#catm-close').addEventListener('click', () => catModal.remove());

  // Add category
  catModal.querySelector('#catm-add').addEventListener('click', async () => {
    const name = catModal.querySelector('#catm-name')?.value?.trim();
    const icon = catModal.querySelector('#catm-icon')?.value?.trim() || '◈';
    if (!name) { toast.error('Nome é obrigatório.'); return; }
    await saveArtCategory(null, { name, icon });
    toast.success(`Categoria "${name}" criada!`);
    loadCatList();
    catModal.querySelector('#catm-name').value = '';
    catModal.querySelector('#catm-icon').value = '';
  });

  async function loadCatList() {
    const cats = await fetchArtCategories().catch(() => []);
    const list = catModal.querySelector('#catm-list');
    if (!list) return;

    if (!cats.length) {
      list.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-muted);">
        Nenhuma categoria criada.</div>`;
      return;
    }

    list.innerHTML = cats.map(c => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 6px;
        border-bottom:1px solid var(--border-subtle);">
        <span style="font-size:1.25rem;">${esc(c.icon || '◈')}</span>
        <span style="flex:1;font-size:0.875rem;font-weight:600;">${esc(c.name)}</span>
        <button class="btn btn-ghost btn-sm catm-del" data-id="${esc(c.id)}" data-name="${esc(c.name)}"
          style="color:#EF4444;font-size:0.75rem;">✕</button>
      </div>`).join('');

    list.querySelectorAll('.catm-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Excluir categoria "${btn.dataset.name}"?`)) return;
        await deleteArtCategory(btn.dataset.id);
        toast.success('Categoria excluída.');
        loadCatList();
      });
    });
  }

  loadCatList();
}

/* ════════════════════════════════════════════════════════════
   Best Practices Guide
   ════════════════════════════════════════════════════════════ */
function showBestPractices() {
  const guideModal = document.createElement('div');
  guideModal.className = 'arts-sub-modal';
  guideModal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:2000;
    display:flex;align-items:center;justify-content:center;padding:20px;`;
  guideModal.innerHTML = `
    <div class="card" style="width:100%;max-width:640px;max-height:85vh;
      padding:0;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:16px 22px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div style="font-weight:700;">📖 Guia de Boas Práticas</div>
        <button id="guide-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);">✕</button>
      </div>
      <div style="overflow-y:auto;flex:1;padding:20px 22px;">
        ${BEST_PRACTICES.map(section => `
          <div style="margin-bottom:24px;">
            <h3 style="font-size:1rem;font-weight:700;color:var(--text-primary);margin-bottom:12px;
              padding-bottom:8px;border-bottom:1px solid var(--border-subtle);">
              ${esc(section.title)}
            </h3>
            <ul style="list-style:none;padding:0;margin:0;">
              ${section.items.map(item => `
                <li style="font-size:0.8125rem;color:var(--text-secondary);padding:6px 0;
                  padding-left:20px;position:relative;line-height:1.5;">
                  <span style="position:absolute;left:0;color:var(--brand-gold);">•</span>
                  ${esc(item)}
                </li>`).join('')}
            </ul>
          </div>`).join('')}
      </div>
    </div>`;

  document.body.appendChild(guideModal);
  guideModal.addEventListener('click', e => { if (e.target === guideModal) guideModal.remove(); });
  guideModal.querySelector('#guide-close').addEventListener('click', () => guideModal.remove());
}
