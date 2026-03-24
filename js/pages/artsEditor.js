/**
 * PRIMETOUR — Editor de Artes
 * Canvas-based design editor with templates and Fabric.js
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { fetchImages } from '../services/portal.js';
import {
  fetchTemplates, fetchTemplate, saveTemplate, deleteTemplate,
  recordArtGeneration, ART_SIZES, LAYER_TYPES,
} from '../services/artsEditor.js';

const esc = s => String(s||'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = ts => ts?.toDate ? ts.toDate().toLocaleDateString('pt-BR') : '—';

const BUS = ['PTS Bradesco','Centurion','BTG Partners','BTG Ultrablue','Lazer','Operadora','ICs'];

let fabricCanvas = null;

export async function renderArtsEditor(container) {
  if (!store.canManagePortal()) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div></div>`;
    return;
  }

  const isAdmin = store.isMaster() || store.can('system_manage_users');

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Editor de Artes</h1>
        <p class="page-subtitle">Templates para redes sociais e comunicados</p>
      </div>
      <div class="page-header-actions" style="gap:8px;">
        ${isAdmin ? `<button class="btn btn-secondary btn-sm" id="arts-manage-btn">⚙ Gerenciar templates</button>` : ''}
        <button class="btn btn-primary btn-sm" id="arts-new-btn">+ Criar arte</button>
      </div>
    </div>

    <!-- Category filter -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;" id="arts-cat-filter">
      <button class="arts-cat-btn active" data-cat="" style="padding:5px 14px;border-radius:var(--radius-full);
        font-size:0.8125rem;font-weight:600;background:var(--brand-gold);color:#fff;border:none;cursor:pointer;">
        Todos
      </button>
      ${['Instagram','LinkedIn','WhatsApp','Email','Impressão','Outros'].map(c =>
        `<button class="arts-cat-btn" data-cat="${esc(c)}"
          style="padding:5px 14px;border-radius:var(--radius-full);font-size:0.8125rem;
          font-weight:600;background:var(--bg-surface);color:var(--text-secondary);
          border:1px solid var(--border-subtle);cursor:pointer;">
          ${esc(c)}
        </button>`
      ).join('')}
    </div>

    <div id="arts-template-grid"
      style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;">
    </div>`;

  await loadTemplateGrid(container);

  document.getElementById('arts-new-btn')?.addEventListener('click', () => showTemplatePicker(container));
  if (isAdmin) {
    document.getElementById('arts-manage-btn')?.addEventListener('click', () => showTemplateManager(container));
  }

  // Category filter
  document.getElementById('arts-cat-filter')?.addEventListener('click', e => {
    const btn = e.target.closest('.arts-cat-btn');
    if (!btn) return;
    document.querySelectorAll('.arts-cat-btn').forEach(b => {
      const isActive = b === btn;
      b.style.background = isActive ? 'var(--brand-gold)' : 'var(--bg-surface)';
      b.style.color      = isActive ? '#fff' : 'var(--text-secondary)';
      b.style.border     = isActive ? 'none' : '1px solid var(--border-subtle)';
      b.classList.toggle('active', isActive);
    });
    loadTemplateGrid(container, btn.dataset.cat);
  });
}

/* ─── Template grid ────────────────────────────────────────── */
async function loadTemplateGrid(container, filterCat = '') {
  const grid = document.getElementById('arts-template-grid');
  if (!grid) return;
  grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;
    color:var(--text-muted);">⏳ Carregando…</div>`;

  let templates = await fetchTemplates().catch(() => []);
  if (filterCat) templates = templates.filter(t => t.category === filterCat);

  if (!templates.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;" class="empty-state">
      <div class="empty-state-icon">▣</div>
      <div class="empty-state-title">Nenhum template ${filterCat || 'cadastrado'}</div>
      <div class="empty-state-subtitle">
        ${store.isMaster() || store.can('system_manage_users')
          ? 'Clique em "Gerenciar templates" para criar o primeiro.'
          : 'Templates são cadastrados pelo time de design.'}
      </div>
    </div>`;
    return;
  }

  grid.innerHTML = templates.map(t => {
    const size = ART_SIZES.find(s => s.key === t.size_key) || { label: t.size_key, w:1080, h:1080 };
    const ratio = size.h / size.w;
    return `
    <div class="card" style="padding:0;overflow:hidden;cursor:pointer;" data-tid="${esc(t.id)}">
      <!-- Preview canvas area -->
      <div style="background:var(--bg-surface);position:relative;padding-top:${Math.min(ratio*100,120)}%;
        overflow:hidden;">
        ${t.preview_url
          ? `<img src="${esc(t.preview_url)}" style="position:absolute;inset:0;
              width:100%;height:100%;object-fit:cover;" alt="">`
          : `<div style="position:absolute;inset:0;display:flex;align-items:center;
              justify-content:center;flex-direction:column;gap:8px;color:var(--text-muted);">
              <span style="font-size:2rem;">▣</span>
              <span style="font-size:0.75rem;">${esc(size.w)}×${esc(String(size.h))}</span>
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
          ${esc(size.label)} · ${(t.layers||[]).length} camada(s)
        </div>
        ${t.bus?.length ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:4px;">
          ${t.bus.map(b => `<span style="padding:1px 6px;background:var(--bg-surface);
            border:1px solid var(--border-subtle);border-radius:20px;margin-right:3px;">${esc(b)}</span>`).join('')}
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

/* ─── Template picker ──────────────────────────────────────── */
function showTemplatePicker(container) {
  // Same as loadTemplateGrid but in modal — openEditor handles the rest
  loadTemplateGrid(container);
  toast.success('Escolha um template na grade abaixo.');
}

/* ─── Canvas Editor ────────────────────────────────────────── */
async function openEditor(container, templateId) {
  const template = await fetchTemplate(templateId);
  if (!template) { toast.error('Template não encontrado.'); return; }

  const size = ART_SIZES.find(s => s.key === template.size_key) || { w:1080, h:1080, label:'1080×1080' };

  const modal = document.createElement('div');
  modal.id    = 'arts-editor-modal';
  modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:2000;
    display:flex;flex-direction:column;overflow:hidden;`;

  modal.innerHTML = `
    <!-- Toolbar -->
    <div style="padding:10px 20px;background:var(--bg-surface);border-bottom:1px solid var(--border-subtle);
      display:flex;align-items:center;gap:12px;flex-shrink:0;">
      <button id="arts-editor-close" style="border:none;background:none;cursor:pointer;
        font-size:1.125rem;color:var(--text-muted);">← Voltar</button>
      <div style="flex:1;font-weight:700;font-size:0.9375rem;">${esc(template.name)}</div>
      <span style="font-size:0.75rem;color:var(--text-muted);">${esc(size.label)}</span>
      <button id="arts-export-png" class="btn btn-primary btn-sm">⬇ PNG</button>
      <button id="arts-export-jpg" class="btn btn-secondary btn-sm">⬇ JPG</button>
    </div>

    <!-- Editor body -->
    <div style="display:grid;grid-template-columns:1fr 280px;flex:1;overflow:hidden;min-height:0;">

      <!-- Canvas area -->
      <div style="background:#1a1a1a;display:flex;align-items:center;justify-content:center;
        overflow:auto;padding:24px;">
        <div id="arts-canvas-wrap" style="position:relative;box-shadow:0 20px 60px rgba(0,0,0,.5);">
          <canvas id="arts-fabric-canvas"></canvas>
        </div>
      </div>

      <!-- Layer controls panel -->
      <div style="background:var(--bg-surface);border-left:1px solid var(--border-subtle);
        overflow-y:auto;display:flex;flex-direction:column;">
        <div style="padding:14px 16px;font-size:0.625rem;font-weight:700;text-transform:uppercase;
          letter-spacing:.1em;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">
          Camadas editáveis
        </div>
        <div id="arts-layers-panel" style="flex:1;overflow-y:auto;"></div>
        <div style="padding:12px 16px;border-top:1px solid var(--border-subtle);">
          <div style="font-size:0.75rem;color:var(--text-muted);text-align:center;">
            Clique em uma camada para editar
          </div>
        </div>
      </div>
    </div>`;

  document.body.appendChild(modal);

  document.getElementById('arts-editor-close')?.addEventListener('click', () => {
    if (fabricCanvas) { fabricCanvas.dispose(); fabricCanvas = null; }
    modal.remove();
  });

  // Load Fabric.js and init canvas
  await loadFabric();
  initFabricCanvas(template, size, modal);

  // Export handlers
  document.getElementById('arts-export-png')?.addEventListener('click', () => exportCanvas('png', template.name));
  document.getElementById('arts-export-jpg')?.addEventListener('click', () => exportCanvas('jpg', template.name));
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

function initFabricCanvas(template, size, modal) {
  const MAX_DISPLAY = 600;
  const scale = Math.min(MAX_DISPLAY / size.w, MAX_DISPLAY / size.h, 1);
  const displayW = Math.round(size.w * scale);
  const displayH = Math.round(size.h * scale);

  const wrap = document.getElementById('arts-canvas-wrap');
  const canvasEl = document.getElementById('arts-fabric-canvas');
  if (!wrap || !canvasEl) return;

  wrap.style.width  = displayW + 'px';
  wrap.style.height = displayH + 'px';
  canvasEl.width    = displayW;
  canvasEl.height   = displayH;

  fabricCanvas = new window.fabric.Canvas('arts-fabric-canvas', {
    width:  displayW,
    height: displayH,
    backgroundColor: '#ffffff',
    selection: true,
  });

  // Render template layers
  const layers = template.layers || [];
  renderLayers(layers, scale, template);
  renderLayersPanel(layers, scale);
}

function renderLayers(layers, scale, template) {
  if (!fabricCanvas) return;
  fabricCanvas.clear();

  layers.forEach((layer, idx) => {
    const x = (layer.x || 0) * scale;
    const y = (layer.y || 0) * scale;
    const w = (layer.w || 100) * scale;
    const h = (layer.h || 100) * scale;

    switch(layer.type) {
      case 'background_image':
      case 'image': {
        if (layer.image_url) {
          window.fabric.Image.fromURL(layer.image_url, (img) => {
            if (layer.type === 'background_image') {
              img.set({ left:0, top:0, selectable: false, evented: false });
              img.scaleToWidth(fabricCanvas.width);
              const scaledH = img.getScaledHeight();
              if (scaledH < fabricCanvas.height) img.scaleToHeight(fabricCanvas.height);
            } else {
              img.set({ left:x, top:y, scaleX: w/img.width, scaleY: h/img.height });
            }
            img.set({ opacity: layer.opacity ?? 1, data: { layerIdx: idx } });
            if (layer.border_radius) img.set({ rx: layer.border_radius, ry: layer.border_radius });
            fabricCanvas.add(img);
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
          fill:   layer.fill || 'rgba(0,0,0,0.5)',
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
          fontSize:      (layer.font_size || 32) * scale,
          fontWeight:    layer.font_weight || 'normal',
          fontFamily:    layer.font_family || 'Poppins',
          fill:          layer.color || '#ffffff',
          textAlign:     layer.align || 'left',
          lineHeight:    layer.line_height || 1.2,
          charSpacing:   (layer.letter_spacing || 0) * 10,
          editable:      true,
          data:          { layerIdx: idx },
        });
        fabricCanvas.add(text);
        break;
      }
    }
  });

  fabricCanvas.renderAll();
}

function renderLayersPanel(layers, scale) {
  const panel = document.getElementById('arts-layers-panel');
  if (!panel) return;

  panel.innerHTML = layers.map((layer, idx) => {
    const typeDef = LAYER_TYPES[layer.type] || { label: layer.type, icon: '?' };
    const isEditable = layer.editable !== false;
    return `
    <div class="arts-layer-item" data-idx="${idx}"
      style="padding:12px 16px;border-bottom:1px solid var(--border-subtle);
      cursor:${isEditable?'pointer':'default'};
      opacity:${isEditable?1:0.5};transition:background .15s;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:1rem;flex-shrink:0;">${esc(typeDef.icon)}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.8125rem;font-weight:600;overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap;">
            ${esc(layer.label || typeDef.label)}
          </div>
          ${layer.type === 'text' && layer.content
            ? `<div style="font-size:0.75rem;color:var(--text-muted);overflow:hidden;
                text-overflow:ellipsis;white-space:nowrap;">
                ${esc((layer.content||'').slice(0,30))}
              </div>` : ''}
          ${layer.image_url
            ? `<div style="font-size:0.75rem;color:var(--text-muted);">Imagem vinculada</div>` : ''}
        </div>
        ${isEditable ? `<span style="font-size:0.625rem;color:var(--brand-gold);
          font-weight:600;">Editável</span>` : ''}
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

    item.addEventListener('click', () => {
      // Toggle fields panel
      const fields = document.getElementById(`layer-fields-${idx}`);
      if (!fields) return;
      const isOpen = fields.style.display !== 'none';
      panel.querySelectorAll('.arts-layer-fields').forEach(f => f.style.display = 'none');
      panel.querySelectorAll('.arts-layer-item').forEach(i => i.style.background = 'transparent');
      if (!isOpen) {
        fields.style.display = 'block';
        item.style.background = 'var(--brand-gold)08';
        renderLayerFields(fields, layer, idx, scale);
      }
    });
  });
}

function renderLayerFields(container, layer, idx, scale) {
  const LBL = `font-size:0.75rem;font-weight:600;display:block;margin-bottom:4px;color:var(--text-muted);`;
  const typeDef = LAYER_TYPES[layer.type] || { editable: [] };
  const editableFields = typeDef.editable || [];

  let html = '';

  if (layer.type === 'text' || editableFields.includes('content')) {
    html += `<div style="margin-bottom:10px;">
      <label style="${LBL}">Texto</label>
      <textarea id="lf-content-${idx}" class="portal-field" rows="3"
        style="width:100%;font-size:0.8125rem;">${esc(layer.content||'')}</textarea>
      ${layer.max_chars ? `<div style="font-size:0.6875rem;color:var(--text-muted);margin-top:3px;">
        Máx ${layer.max_chars} caracteres</div>` : ''}
    </div>`;
  }

  if (editableFields.includes('image_url')) {
    html += `<div style="margin-bottom:10px;">
      <label style="${LBL}">URL da imagem</label>
      <input id="lf-img-${idx}" type="text" class="portal-field"
        style="width:100%;font-size:0.8125rem;" value="${esc(layer.image_url||'')}"
        placeholder="Cole a URL ou use o Banco de Imagens">
      <button class="btn btn-ghost btn-sm" id="lf-img-pick-${idx}"
        style="width:100%;margin-top:6px;font-size:0.75rem;">
        🖼 Escolher do Banco de Imagens
      </button>
    </div>`;
  }

  if (editableFields.includes('color')) {
    html += `<div style="margin-bottom:10px;">
      <label style="${LBL}">Cor do texto</label>
      <div style="display:flex;gap:8px;align-items:center;">
        <input id="lf-color-${idx}" type="color" value="${esc(layer.color||'#ffffff')}"
          style="width:40px;height:32px;border:none;background:none;cursor:pointer;padding:0;">
        <input id="lf-color-hex-${idx}" type="text" class="portal-field"
          value="${esc(layer.color||'#ffffff')}" style="flex:1;font-size:0.8125rem;font-family:monospace;">
      </div>
    </div>`;
  }

  if (editableFields.includes('opacity')) {
    html += `<div style="margin-bottom:10px;">
      <label style="${LBL}">Opacidade: <span id="lf-opacity-val-${idx}">${Math.round((layer.opacity??1)*100)}%</span></label>
      <input id="lf-opacity-${idx}" type="range" min="0" max="100"
        value="${Math.round((layer.opacity??1)*100)}"
        style="width:100%;accent-color:var(--brand-gold);">
    </div>`;
  }

  html += `<button class="btn btn-primary btn-sm" id="lf-apply-${idx}"
    style="width:100%;margin-top:4px;">✓ Aplicar</button>`;

  container.innerHTML = html;

  // Wire image bank picker
  document.getElementById(`lf-img-pick-${idx}`)?.addEventListener('click', () => {
    showImageBankPicker(url => {
      const inp = document.getElementById(`lf-img-${idx}`);
      if (inp) inp.value = url;
    });
  });

  // Wire color sync
  const colorPicker = document.getElementById(`lf-color-${idx}`);
  const colorHex    = document.getElementById(`lf-color-hex-${idx}`);
  colorPicker?.addEventListener('input', () => { if (colorHex) colorHex.value = colorPicker.value; });
  colorHex?.addEventListener('input', () => {
    if (/^#[0-9a-f]{6}$/i.test(colorHex.value) && colorPicker) colorPicker.value = colorHex.value;
  });

  // Wire opacity display
  const opacityRange = document.getElementById(`lf-opacity-${idx}`);
  const opacityVal   = document.getElementById(`lf-opacity-val-${idx}`);
  opacityRange?.addEventListener('input', () => {
    if (opacityVal) opacityVal.textContent = opacityRange.value + '%';
  });

  // Apply button
  document.getElementById(`lf-apply-${idx}`)?.addEventListener('click', () => {
    applyLayerChanges(idx, layer, scale);
  });
}

function applyLayerChanges(idx, layer, scale) {
  if (!fabricCanvas) return;

  const objects = fabricCanvas.getObjects();
  const obj = objects.find(o => o.data?.layerIdx === idx);
  if (!obj) { toast.error('Camada não encontrada no canvas.'); return; }

  const content  = document.getElementById(`lf-content-${idx}`)?.value;
  const imgUrl   = document.getElementById(`lf-img-${idx}`)?.value?.trim();
  const color    = document.getElementById(`lf-color-${idx}`)?.value;
  const opacity  = document.getElementById(`lf-opacity-${idx}`)?.value;

  if (content !== undefined && obj.type === 'textbox') obj.set('text', content);
  if (color) obj.set('fill', color);
  if (opacity !== undefined) obj.set('opacity', Number(opacity) / 100);

  if (imgUrl && imgUrl !== layer.image_url) {
    window.fabric.Image.fromURL(imgUrl, img => {
      const bounds = obj.getBoundingRect();
      img.set({
        left: obj.left, top: obj.top,
        scaleX: bounds.width  / img.width,
        scaleY: bounds.height / img.height,
        opacity: Number(opacity ?? 100) / 100,
        data: { layerIdx: idx },
      });
      fabricCanvas.remove(obj);
      fabricCanvas.add(img);
      fabricCanvas.renderAll();
    }, { crossOrigin: 'anonymous' });
    return;
  }

  fabricCanvas.renderAll();
  toast.success('Aplicado!');
}

/* ─── Image bank picker ────────────────────────────────────── */
function showImageBankPicker(onSelect) {
  const modal = document.createElement('div');
  modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:3000;
    display:flex;align-items:center;justify-content:center;padding:20px;`;
  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:700px;max-height:85vh;
      padding:0;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:14px 20px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div style="font-weight:700;">Escolher do Banco de Imagens</div>
        <button id="ibp-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);">✕</button>
      </div>
      <div id="ibp-grid" style="padding:16px;overflow-y:auto;flex:1;
        display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;">
        <div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted);">
          ⏳ Carregando…
        </div>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('ibp-close')?.addEventListener('click', () => modal.remove());

  fetchImages({}).then(imgs => {
    const grid = document.getElementById('ibp-grid');
    if (!grid) return;
    if (!imgs.length) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;
        color:var(--text-muted);">Nenhuma imagem no banco.</div>`;
      return;
    }
    grid.innerHTML = imgs.slice(0, 60).map(img => `
      <button class="ibp-img-btn" data-url="${esc(img.url)}"
        style="border:2px solid var(--border-subtle);border-radius:var(--radius-sm);
        overflow:hidden;cursor:pointer;background:none;padding:0;aspect-ratio:1;
        transition:border-color .2s;">
        <img src="${esc(img.url)}" alt="${esc(img.name||'')}"
          style="width:100%;height:100%;object-fit:cover;" loading="lazy"
          title="${esc(img.name||'')}">
      </button>`).join('');
    grid.querySelectorAll('.ibp-img-btn').forEach(btn => {
      btn.addEventListener('mouseenter', () => btn.style.borderColor = 'var(--brand-gold)');
      btn.addEventListener('mouseleave', () => btn.style.borderColor = 'var(--border-subtle)');
      btn.addEventListener('click', () => { modal.remove(); onSelect(btn.dataset.url); });
    });
  }).catch(() => {});
}

/* ─── Export ───────────────────────────────────────────────── */
function exportCanvas(format, name) {
  if (!fabricCanvas) return;
  fabricCanvas.discardActiveObject();
  fabricCanvas.renderAll();
  const dataUrl = fabricCanvas.toDataURL({
    format:  format === 'jpg' ? 'jpeg' : 'png',
    quality: 0.92,
    multiplier: 3, // 3x for high-res output
  });
  const a = document.createElement('a');
  a.href     = dataUrl;
  a.download = `${(name||'arte').replace(/\s+/g,'-')}.${format}`;
  a.click();
  toast.success(`Arte exportada em ${format.toUpperCase()}!`);
  recordArtGeneration({ templateName: name, format }).catch(()=>{});
}

/* ─── Template Manager (admin only) ────────────────────────── */
async function showTemplateManager(container) {
  const modal = document.createElement('div');
  modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:2000;
    display:flex;align-items:center;justify-content:center;padding:20px;`;
  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:700px;max-height:90vh;
      padding:0;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:16px 22px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div style="font-weight:700;">Gerenciar Templates</div>
        <div style="display:flex;gap:8px;">
          <button id="tm-new-btn" class="btn btn-primary btn-sm">+ Novo template</button>
          <button id="tm-close" style="border:none;background:none;cursor:pointer;
            font-size:1.25rem;color:var(--text-muted);">✕</button>
        </div>
      </div>
      <div id="tm-list" style="overflow-y:auto;flex:1;padding:12px 16px;
        display:flex;flex-direction:column;gap:8px;">
        <div style="text-align:center;padding:20px;color:var(--text-muted);">⏳ Carregando…</div>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('tm-close')?.addEventListener('click', () => modal.remove());
  document.getElementById('tm-new-btn')?.addEventListener('click', () => {
    modal.remove();
    showTemplateEditor(container, null);
  });

  const templates = await fetchTemplates().catch(() => []);
  const list = document.getElementById('tm-list');
  if (!list) return;

  if (!templates.length) {
    list.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">
      Nenhum template cadastrado ainda.</div>`;
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
          ${esc(t.category||'')} · ${esc(size?.label||t.size_key||'')} · ${(t.layers||[]).length} camadas
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="btn btn-ghost btn-sm tm-edit-btn" data-tid="${esc(t.id)}"
          style="font-size:0.75rem;color:var(--brand-gold);">✎ Editar</button>
        <button class="btn btn-ghost btn-sm tm-del-btn" data-tid="${esc(t.id)}"
          data-name="${esc(t.name)}"
          style="font-size:0.75rem;color:#EF4444;">✕</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.tm-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => { modal.remove(); showTemplateEditor(container, btn.dataset.tid); });
  });
  list.querySelectorAll('.tm-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Excluir template "${btn.dataset.name}"?`)) return;
      await deleteTemplate(btn.dataset.tid);
      toast.success('Template excluído.'); modal.remove(); renderArtsEditor(container);
    });
  });
}

/* ─── Template Editor (admin) ──────────────────────────────── */
async function showTemplateEditor(container, templateId) {
  const template = templateId ? await fetchTemplate(templateId) : {
    name: '', category: 'Instagram', size_key: 'feed_square',
    bus: [], layers: [], preview_url: '',
  };

  const modal = document.createElement('div');
  modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:2000;
    display:flex;align-items:center;justify-content:center;padding:20px;`;

  const LBL = `font-size:0.75rem;font-weight:600;display:block;margin-bottom:6px;`;

  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:640px;max-height:90vh;
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
          <input id="te-name" type="text" class="portal-field" style="width:100%;"
            value="${esc(template.name)}" placeholder="Ex: Destaque de Destino - Stories">
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
          <div>
            <label style="${LBL}">Categoria</label>
            <select id="te-cat" class="filter-select" style="width:100%;">
              ${['Instagram','LinkedIn','WhatsApp','Email','Impressão','Outros'].map(c =>
                `<option ${template.category===c?'selected':''}>${c}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="${LBL}">Tamanho</label>
            <select id="te-size" class="filter-select" style="width:100%;">
              ${ART_SIZES.map(s =>
                `<option value="${s.key}" ${template.size_key===s.key?'selected':''}>${s.label}</option>`
              ).join('')}
            </select>
          </div>
        </div>

        <div style="margin-bottom:14px;">
          <label style="${LBL}">BUs (deixe vazio para todas)</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${BUS.map(bu => `<label style="display:flex;align-items:center;gap:5px;
              font-size:0.8125rem;cursor:pointer;">
              <input type="checkbox" class="te-bu-cb" value="${esc(bu)}"
                ${(template.bus||[]).includes(bu)?'checked':''}>
              ${esc(bu)}
            </label>`).join('')}
          </div>
        </div>

        <div style="margin-bottom:14px;">
          <label style="${LBL}">URL do preview (imagem de capa)</label>
          <input id="te-preview" type="text" class="portal-field" style="width:100%;"
            value="${esc(template.preview_url||'')}" placeholder="https://…">
        </div>

        <div style="margin-bottom:14px;">
          <label style="${LBL}">Camadas (JSON)
            <span style="font-weight:400;color:var(--text-muted);margin-left:6px;">
              — cada camada tem: type, label, editable, x, y, w, h, e campos do tipo
            </span>
          </label>
          <textarea id="te-layers" class="portal-field" rows="12"
            style="width:100%;font-family:monospace;font-size:0.75rem;"
            placeholder='[{"type":"background_image","label":"Foto de fundo","editable":true,"image_url":"","opacity":1},{"type":"text","label":"Título","editable":true,"content":"Seu texto aqui","x":40,"y":200,"w":1000,"font_size":64,"font_weight":"700","color":"#ffffff"}]'
          >${esc(JSON.stringify(template.layers||[], null, 2))}</textarea>
        </div>

        <!-- Layer type reference -->
        <details style="margin-bottom:14px;">
          <summary style="font-size:0.8125rem;cursor:pointer;color:var(--brand-gold);
            font-weight:600;margin-bottom:8px;">📋 Referência de tipos de camada</summary>
          <div style="background:var(--bg-surface);border-radius:var(--radius-sm);
            padding:12px;font-size:0.75rem;font-family:monospace;color:var(--text-muted);">
            ${Object.entries(LAYER_TYPES).map(([key, def]) =>
              `<div style="margin-bottom:8px;"><strong style="color:var(--text-primary);">${key}</strong>
               — ${def.label}<br>Campos: ${def.editable.join(', ')}</div>`
            ).join('')}
          </div>
        </details>
      </div>

      <div style="padding:14px 22px;border-top:1px solid var(--border-subtle);
        background:var(--bg-surface);display:flex;gap:10px;flex-shrink:0;">
        <button class="btn btn-secondary" id="te-cancel" style="flex:1;">Cancelar</button>
        <button class="btn btn-primary"   id="te-save"   style="flex:2;">💾 Salvar template</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('te-close')?.addEventListener('click',  () => modal.remove());
  document.getElementById('te-cancel')?.addEventListener('click', () => modal.remove());

  document.getElementById('te-save')?.addEventListener('click', async () => {
    const btn = document.getElementById('te-save');
    btn.disabled = true; btn.textContent = '⏳';
    try {
      let layers;
      try { layers = JSON.parse(document.getElementById('te-layers')?.value || '[]'); }
      catch { toast.error('JSON de camadas inválido.'); btn.disabled=false; btn.textContent='💾 Salvar template'; return; }

      const buses = [...document.querySelectorAll('.te-bu-cb:checked')].map(cb => cb.value);
      await saveTemplate(templateId || null, {
        name:        document.getElementById('te-name')?.value?.trim() || 'Sem título',
        category:    document.getElementById('te-cat')?.value,
        size_key:    document.getElementById('te-size')?.value,
        preview_url: document.getElementById('te-preview')?.value?.trim() || '',
        bus:         buses,
        layers,
      });
      toast.success('Template salvo!');
      modal.remove();
      renderArtsEditor(container);
    } catch(e) {
      toast.error('Erro: ' + e.message);
      btn.disabled=false; btn.textContent='💾 Salvar template';
    }
  });
}
