/**
 * PRIMETOUR — Portal de Dicas: Banco de Imagens (Camadas 2 + 3)
 * Upload → conversão .webp → R2 | Galeria hierárquica | Tags | Edição | Lightbox
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import {
  fetchImages, saveImageMeta, updateImageMeta, deleteImageMeta,
  convertToWebp, uploadImageToR2, fetchDestinations,
  R2_PUBLIC_URL, CONTINENTS,
} from '../services/portal.js';

const esc = s => String(s||'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const IMAGE_TYPES = [
  {
    key:   'destaque',
    label: 'Destaque',
    desc:  'Foto principal do destino. Usada como hero (capa) nos materiais gerados — link web, PDF e PPTX.',
    icon:  '★',
  },
  {
    key:   'galeria',
    label: 'Galeria',
    desc:  'Fotos gerais do destino. Usadas nos cards de lugares nos materiais. Quanto mais, melhor a cobertura.',
    icon:  '▦',
  },
  {
    key:   'banner',
    label: 'Banner',
    desc:  'Imagem horizontal para cabeçalhos de seção. Fallback para Destaque quando não há foto principal.',
    icon:  '▬',
  },
  {
    key:   'logo_area',
    label: 'Logo de Área',
    desc:  'Logotipo da área (ex: BTG Partners, Centurion). Exibido no header dos materiais e do link web.',
    icon:  '◈',
  },
];

// Tags sugeridas para o Portal de Dicas — aparecem como chips clicáveis no upload
const PORTAL_TAGS = [
  'atrações', 'restaurante', 'hotel', 'compras', 'vida noturna',
  'espetáculos', 'museu', 'parque', 'praia', 'natureza',
  'gastronomia', 'cultura', 'esporte', 'crianças', 'transporte',
  'panorâmica', 'noturna', 'principal', 'destaque', 'bairro',
];

let allImages   = [];
let allDests    = [];
let navContinent = '';
let navCountry   = '';
let navCity      = '';
let viewMode     = 'grid';   // 'grid' | 'list'
let searchStr    = '';
let lightboxIdx  = -1;

export async function renderPortalImages(container) {
  if (!store.canManagePortal()) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div><div class="empty-state-title">Acesso restrito</div>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Banco de Imagens</h1>
        <p class="page-subtitle">Imagens convertidas para .webp e armazenadas no Cloudflare R2</p>
      </div>
      <div class="page-header-actions" style="gap:8px;">
        <button class="btn btn-secondary btn-sm" id="img-view-toggle" title="Alternar visualização">▦</button>
        <button class="btn btn-primary btn-sm" id="img-upload-toggle">↑ Upload</button>
      </div>
    </div>

    <!-- Upload panel (collapsed by default) -->
    <div id="img-upload-panel" style="display:none;margin-bottom:20px;">
      ${uploadPanelHtml()}
    </div>

    <!-- Navigation breadcrumb + search -->
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px;">
      <div id="img-breadcrumb" style="display:flex;align-items:center;gap:6px;flex:1;flex-wrap:wrap;
        font-size:0.875rem;"></div>
      <div style="position:relative;">
        <input type="text" id="img-search" placeholder="Buscar por nome ou tag…"
          class="portal-field" style="width:220px;padding-left:28px;font-size:0.8125rem;">
        <span style="position:absolute;left:9px;top:50%;transform:translateY(-50%);
          color:var(--text-muted);font-size:0.8125rem;">🔍</span>
      </div>
      <span id="img-count" style="font-size:0.8125rem;color:var(--text-muted);white-space:nowrap;"></span>
    </div>

    <!-- Gallery -->
    <div id="img-gallery">
      ${skeletonGrid()}
    </div>

    <!-- Lightbox (hidden) -->
    <div id="img-lightbox" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);
      z-index:3000;align-items:center;justify-content:center;flex-direction:column;">
    </div>
  `;

  // Upload toggle
  document.getElementById('img-upload-toggle')?.addEventListener('click', () => {
    const p = document.getElementById('img-upload-panel');
    if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
  });

  // View mode toggle
  document.getElementById('img-view-toggle')?.addEventListener('click', () => {
    viewMode = viewMode === 'grid' ? 'list' : 'grid';
    document.getElementById('img-view-toggle').textContent = viewMode === 'grid' ? '▦' : '☰';
    renderGallery();
  });

  // Search
  document.getElementById('img-search')?.addEventListener('input', e => {
    searchStr = e.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    renderGallery();
  });

  // Upload panel wiring
  wireUploadPanel();

  // Keyboard lightbox navigation
  document.addEventListener('keydown', handleLightboxKey);

  allDests = await fetchDestinations();
  await loadImages();
}

/* ── Upload panel ── */
function uploadPanelHtml() {
  return `
    <div class="card" style="padding:0;overflow:hidden;">

      <!-- Step 1: Drop zone — always visible and large -->
      <div style="padding:24px;border-bottom:1px solid var(--border-subtle);">
        <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;
          letter-spacing:.07em;color:var(--text-muted);margin-bottom:14px;">
          1 · Selecione as imagens
        </div>
        <div id="img-dropzone"
          style="border:2px dashed var(--border-subtle);border-radius:var(--radius-md);
          padding:40px 24px;text-align:center;cursor:pointer;transition:border-color .2s,background .2s;">
          <div style="font-size:2.5rem;margin-bottom:12px;">🖼</div>
          <div style="font-size:1rem;font-weight:600;margin-bottom:6px;">
            Arraste quantas imagens quiser aqui</div>
          <div style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:16px;">
            ou clique para selecionar · JPG, PNG, WEBP, HEIC · Máx 10 MB por arquivo
          </div>
          <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 20px;
            background:var(--bg-surface);border:1px solid var(--border-subtle);
            border-radius:var(--radius-sm);font-size:0.8125rem;color:var(--text-secondary);">
            ↑ Selecionar arquivos
          </div>
          <input type="file" id="img-file-input" multiple accept="image/*" style="display:none;">
        </div>
      </div>

      <!-- Step 2: Per-image metadata (appears after drop) -->
      <div id="img-batch-list" style="display:none;">
        <div style="padding:16px 24px;background:var(--bg-surface);
          border-bottom:1px solid var(--border-subtle);
          display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;
              letter-spacing:.07em;color:var(--text-muted);">2 · Configure cada imagem</div>
            <div style="font-size:0.8125rem;color:var(--text-muted);margin-top:2px;">
              Preencha destino, tipo e tags. Campos em branco herdam os valores padrão abaixo.
            </div>
          </div>
          <button id="img-upload-all-btn" class="btn btn-primary btn-sm" style="white-space:nowrap;">
            ↑ Enviar todas
          </button>
        </div>

        <!-- Default values (apply to all that don't have individual values) -->
        <div style="padding:16px 24px;background:var(--brand-gold)08;
          border-bottom:1px solid var(--border-subtle);">
          <div style="font-size:0.75rem;font-weight:600;margin-bottom:10px;color:var(--brand-gold);">
            ◈ Valores padrão — aplicados a todas as imagens sem preenchimento individual
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;">
            <div>
              <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:4px;">Continente</label>
              <select id="def-continent" class="filter-select" style="width:100%;">
                <option value="">—</option>
                ${CONTINENTS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:4px;">País</label>
              <select id="def-country" class="filter-select" style="width:100%;" disabled>
                <option value="">—</option>
              </select>
            </div>
            <div>
              <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:4px;">Cidade</label>
              <select id="def-city" class="filter-select" style="width:100%;" disabled>
                <option value="">—</option>
              </select>
            </div>
            <div>
              <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:4px;">Tipo</label>
              <select id="def-type" class="filter-select" style="width:100%;">
                ${IMAGE_TYPES.map(t => `<option value="${t.key}">${t.icon} ${t.label}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>

        <!-- Per-image rows (injected by JS) -->
        <div id="img-item-rows" style="padding:16px 24px;display:flex;flex-direction:column;gap:12px;"></div>
      </div>

      <!-- Upload progress (appears during upload) -->
      <div id="img-upload-queue" style="display:none;padding:16px 24px;"></div>
    </div>
  `;
}

function wireUploadPanel() {
  const dropzone  = document.getElementById('img-dropzone');
  const fileInput = document.getElementById('img-file-input');
  if (!dropzone) return;

  // Dropzone interactions
  dropzone.addEventListener('click', () => fileInput?.click());
  dropzone.addEventListener('dragover', e => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--brand-gold)';
    dropzone.style.background  = 'var(--brand-gold)06';
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.style.borderColor = 'var(--border-subtle)';
    dropzone.style.background  = '';
  });
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--border-subtle)';
    dropzone.style.background  = '';
    buildBatchList([...e.dataTransfer.files].filter(f => f.type.startsWith('image/')));
  });
  fileInput?.addEventListener('change', () => {
    buildBatchList([...fileInput.files].filter(f => f.type.startsWith('image/')));
    fileInput.value = '';
  });

  // Default values cascade
  wireCascade('def-continent', 'def-country', 'def-city');

  // Upload all button
  document.getElementById('img-upload-all-btn')?.addEventListener('click', () => uploadBatch());
}

/* ── Destination cascade helper ── */
function wireCascade(contId, countryId, cityId) {
  document.getElementById(contId)?.addEventListener('change', e => {
    const cont     = e.target.value;
    const countries = [...new Set(allDests.filter(d => !cont || d.continent === cont)
      .map(d => d.country).filter(Boolean))].sort();
    const cSel = document.getElementById(countryId);
    if (!cSel) return;
    cSel.innerHTML = `<option value="">—</option>` +
      countries.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    cSel.disabled = !cont;
    const citySel = document.getElementById(cityId);
    if (citySel) { citySel.innerHTML = `<option value="">—</option>`; citySel.disabled = true; }
  });
  document.getElementById(countryId)?.addEventListener('change', e => {
    const cont  = document.getElementById(contId)?.value;
    const count = e.target.value;
    const cities = [...new Set(allDests.filter(d =>
      (!cont  || d.continent === cont) &&
      (!count || d.country   === count) && d.city
    ).map(d => d.city))].sort();
    const citySel = document.getElementById(cityId);
    if (!citySel) return;
    citySel.innerHTML = `<option value="">—</option>` +
      cities.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    citySel.disabled = !count;
  });
}

/* ── Build per-image metadata rows ── */
function buildBatchList(files) {
  if (!files.length) return;
  const batchList = document.getElementById('img-batch-list');
  const itemRows  = document.getElementById('img-item-rows');
  if (!batchList || !itemRows) return;

  // Clear previous rows before building a new batch
  itemRows.innerHTML = '';
  batchList.style.display = 'block';
  files.forEach((file, i) => {
    const id  = `item-${Date.now()}-${i}`;
    const row = document.createElement('div');
    row.id    = `batch-row-${id}`;
    row.dataset.file = file.name;
    row.style.cssText = `background:var(--bg-surface);border:1px solid var(--border-subtle);
      border-radius:var(--radius-md);overflow:hidden;`;

    // Preview thumbnail (generated client-side)
    const thumbUrl = URL.createObjectURL(file);

    row.innerHTML = `
      <div style="display:flex;gap:12px;padding:12px 14px;">
        <!-- Thumbnail -->
        <img class="batch-thumb" alt=""
          style="width:72px;height:54px;object-fit:cover;border-radius:var(--radius-sm);flex-shrink:0;">

        <!-- Fields -->
        <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
          <!-- Row 1: name + remove button -->
          <div style="display:flex;align-items:center;gap:8px;">
            <input type="text" class="portal-field batch-name" data-id="${id}"
              style="flex:1;font-size:0.8125rem;"
              value="${esc(file.name.replace(/\.[^.]+$/,'').replace(/[-_]/g,' '))}"
              placeholder="Nome da imagem">
            <button class="btn btn-ghost btn-sm batch-remove" data-id="${id}"
              style="font-size:0.75rem;color:var(--text-muted);flex-shrink:0;">✕</button>
          </div>

          <!-- Row 2: continent / country / city / type -->
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;">
            <select class="filter-select batch-continent" data-id="${id}" style="font-size:0.75rem;">
              <option value="">Continente</option>
              ${CONTINENTS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
            </select>
            <select class="filter-select batch-country" data-id="${id}" style="font-size:0.75rem;" disabled>
              <option value="">País</option>
            </select>
            <select class="filter-select batch-city" data-id="${id}" style="font-size:0.75rem;" disabled>
              <option value="">Cidade</option>
            </select>
            <select class="filter-select batch-type" data-id="${id}" style="font-size:0.75rem;">
              ${IMAGE_TYPES.map(t => `<option value="${t.key}">${t.icon} ${t.label}</option>`).join('')}
            </select>
          </div>

          <!-- Row 2b: place name (for matching with tip items) -->
          <div>
            <input type="text" class="portal-field batch-placename" data-id="${id}"
              style="font-size:0.8125rem;width:100%;"
              placeholder="Nome do lugar que esta foto representa (ex: Torre Eiffel, Restaurante Jules Verne)">
            <div style="font-size:0.6875rem;color:var(--text-muted);margin-top:3px;">
              💡 Quando informado, o sistema usa esta foto especificamente para este lugar nas dicas geradas.
            </div>
          </div>

          <!-- Row 3: tag chips + free text -->
          <div>
            <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px;">
              ${PORTAL_TAGS.map(tag => `
                <button class="tag-chip batch-tag-chip" data-id="${id}" data-tag="${esc(tag)}"
                  style="padding:2px 8px;border-radius:20px;border:1px solid var(--border-subtle);
                  background:transparent;cursor:pointer;font-size:0.6875rem;
                  color:var(--text-muted);transition:all .15s;">
                  ${esc(tag)}
                </button>`).join('')}
            </div>
            <input type="text" class="portal-field batch-tags-input" data-id="${id}"
              style="font-size:0.75rem;width:100%;"
              placeholder="Tags livres adicionais (separadas por vírgula)">
          </div>

          <!-- Status -->
          <div class="batch-status" data-id="${id}"
            style="font-size:0.75rem;color:var(--text-muted);display:none;"></div>
        </div>
      </div>
    `;

    // Store file reference
    row._file = file;
    itemRows.appendChild(row);

    // Set thumbnail src via JS (avoids inline onload scope issues)
    const thumbImg = row.querySelector('.batch-thumb');
    if (thumbImg) {
      thumbImg.onload = () => URL.revokeObjectURL(thumbImg.src);
      thumbImg.src = thumbUrl;
    }

    // Wire per-row cascade
    wireBatchCascade(row, id);

    // Wire tag chips
    row.querySelectorAll('.batch-tag-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        const active = chip.classList.contains('active');
        chip.style.background    = active ? 'var(--brand-gold)18' : 'transparent';
        chip.style.borderColor   = active ? 'var(--brand-gold)'   : 'var(--border-subtle)';
        chip.style.color         = active ? 'var(--brand-gold)'   : 'var(--text-muted)';
      });
    });

    // Wire remove button
    row.querySelector(`.batch-remove[data-id="${id}"]`)?.addEventListener('click', () => {
      row.remove();
      const remaining = document.getElementById('img-item-rows')?.querySelectorAll('[id^="batch-row-"]').length || 0;
      if (!remaining) document.getElementById('img-batch-list').style.display = 'none';
    });
  });
}

function wireBatchCascade(row, id) {
  const contSel    = row.querySelector(`.batch-continent[data-id="${id}"]`);
  const countrySel = row.querySelector(`.batch-country[data-id="${id}"]`);
  const citySel    = row.querySelector(`.batch-city[data-id="${id}"]`);

  contSel?.addEventListener('change', e => {
    const cont = e.target.value;
    const countries = [...new Set(allDests.filter(d => !cont || d.continent === cont)
      .map(d => d.country).filter(Boolean))].sort();
    countrySel.innerHTML = `<option value="">País</option>` +
      countries.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    countrySel.disabled = !cont;
    citySel.innerHTML = `<option value="">Cidade</option>`; citySel.disabled = true;
  });
  countrySel?.addEventListener('change', e => {
    const cont  = contSel?.value;
    const count = e.target.value;
    const cities = [...new Set(allDests.filter(d =>
      (!cont || d.continent === cont) && (!count || d.country === count) && d.city
    ).map(d => d.city))].sort();
    citySel.innerHTML = `<option value="">Cidade</option>` +
      cities.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    citySel.disabled = !count;
  });
}

/* ── Upload batch ── */
async function uploadBatch() {
  const itemRows = document.getElementById('img-item-rows');
  const rows = itemRows ? [...itemRows.querySelectorAll('[id^="batch-row-"]')] : [];
  if (!rows.length) { toast.error('Nenhuma imagem na fila.'); return; }

  const btn = document.getElementById('img-upload-all-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando…'; }

  // Get defaults
  const defContinent = document.getElementById('def-continent')?.value || '';
  const defCountry   = document.getElementById('def-country')?.value   || '';
  const defCity      = document.getElementById('def-city')?.value      || '';
  const defType      = document.getElementById('def-type')?.value      || 'galeria';

  let success = 0, failed = 0;

  await Promise.all(rows.map(async row => {
    const id   = row.id.replace('batch-row-','');
    const file = row._file;
    if (!file) return;

    const statusEl = row.querySelector(`.batch-status[data-id="${id}"]`);
    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Convertendo…'; statusEl.style.color = 'var(--brand-gold)'; }

    // Read per-row values, fall back to defaults
    const continent = row.querySelector(`.batch-continent[data-id="${id}"]`)?.value || defContinent;
    const country   = row.querySelector(`.batch-country[data-id="${id}"]`)?.value   || defCountry;
    const city      = row.querySelector(`.batch-city[data-id="${id}"]`)?.value      || defCity;
    const type      = row.querySelector(`.batch-type[data-id="${id}"]`)?.value      || defType;
    const name      = row.querySelector(`.batch-name[data-id="${id}"]`)?.value?.trim() || file.name;
    const placeName = row.querySelector(`.batch-placename[data-id="${id}"]`)?.value?.trim() || '';

    // Active chip tags
    const chipTags = [...row.querySelectorAll(`.batch-tag-chip.active`)].map(c => c.dataset.tag);
    // Free text tags
    const freeTags = (row.querySelector(`.batch-tags-input[data-id="${id}"]`)?.value || '')
      .split(',').map(t => t.trim()).filter(Boolean);
    const tags = [...new Set([...chipTags, ...freeTags])];

    if (!continent || !country) {
      if (statusEl) { statusEl.textContent = '✗ Selecione continente e país'; statusEl.style.color = '#EF4444'; }
      failed++;
      return;
    }

    try {
      const { blob, width, height } = await convertToWebp(file);
      const sizeMB = (blob.size / 1024 / 1024).toFixed(2);
      if (statusEl) statusEl.textContent = `WebP (${sizeMB} MB) — enviando…`;

      const slug = s => s.toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
      const path = [continent, country, city].filter(Boolean).map(slug).join('/')
        + '/' + Date.now() + '-' + slug(file.name.replace(/\.[^.]+$/,'')) + '.webp';

      const url = await uploadImageToR2(blob, path);
      await saveImageMeta({ continent, country, city, type, tags, name, placeName, url, path,
        originalName: file.name, sizeMB: parseFloat(sizeMB), width, height });

      if (statusEl) { statusEl.textContent = '✓ Enviado'; statusEl.style.color = '#22C55E'; }

      // Mark row as done
      row.style.borderColor = '#22C55E40';
      row.style.background  = '#22C55E06';
      success++;
    } catch(e) {
      if (statusEl) { statusEl.textContent = '✗ ' + e.message.slice(0,50); statusEl.style.color = '#EF4444'; }
      failed++;
    }
  }));

  if (btn) { btn.disabled = false; btn.textContent = '↑ Enviar todas'; }
  toast.success(`${success} enviada${success!==1?'s':''} com sucesso${failed ? ` · ${failed} com erro` : ''}.`);

  if (success > 0) {
    setTimeout(async () => {
      await loadImages();
      if (!failed) {
        // All succeeded — close and reset the upload panel
        const panel    = document.getElementById('img-upload-panel');
        const batchList = document.getElementById('img-batch-list');
        const itemRows  = document.getElementById('img-item-rows');
        if (itemRows)  itemRows.innerHTML = '';
        if (batchList) batchList.style.display = 'none';
        if (panel)     panel.style.display = 'none';
        const toggleBtn = document.getElementById('img-upload-toggle');
        if (toggleBtn) toggleBtn.textContent = '↑ Upload';
      } else {
        // Some failed — only remove successful rows, keep failed ones
        const ir = document.getElementById('img-item-rows');
        ir?.querySelectorAll('[id^="batch-row-"]').forEach(r => {
          if (r.style.borderColor.includes('22C55E')) r.remove();
        });
      }
    }, 1200);
  }
}



/* ── Data ── */
async function loadImages() {
  allImages = await fetchImages();
  renderBreadcrumb();
  renderGallery();
}

/* ── Breadcrumb navigation ── */
function renderBreadcrumb() {
  const el = document.getElementById('img-breadcrumb');
  if (!el) return;

  const continents = [...new Set(allImages.map(i => i.continent).filter(Boolean))].sort();

  if (!navContinent) {
    // Top level: show continent chips
    el.innerHTML = `
      <span style="color:var(--text-muted);">Todos</span>
      <span style="color:var(--border-subtle);">›</span>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${continents.map(c => {
          const cnt = allImages.filter(i => i.continent === c).length;
          return `<button class="nav-chip" data-cont="${esc(c)}"
            style="padding:3px 10px;border-radius:20px;border:1px solid var(--border-subtle);
            background:none;cursor:pointer;font-size:0.8125rem;color:var(--text-secondary);
            transition:all .15s;">
            ${esc(c)} <span style="color:var(--text-muted);font-size:0.75rem;">(${cnt})</span>
          </button>`;
        }).join('')}
      </div>`;
    el.querySelectorAll('.nav-chip[data-cont]').forEach(btn => {
      btn.addEventListener('click', () => {
        navContinent = btn.dataset.cont;
        navCountry = ''; navCity = '';
        renderBreadcrumb(); renderGallery();
      });
    });
    return;
  }

  const inCont    = allImages.filter(i => i.continent === navContinent);
  const countries = [...new Set(inCont.map(i => i.country).filter(Boolean))].sort();

  if (!navCountry) {
    el.innerHTML = `
      <button class="bc-btn" data-level="root"
        style="background:none;border:none;cursor:pointer;color:var(--brand-gold);font-size:0.875rem;">
        Todos</button>
      <span style="color:var(--text-muted);">›</span>
      <span style="font-weight:600;font-size:0.875rem;">${esc(navContinent)}</span>
      <span style="color:var(--border-subtle);">›</span>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${countries.map(c => {
          const cnt = inCont.filter(i => i.country === c).length;
          return `<button class="nav-chip" data-country="${esc(c)}"
            style="padding:3px 10px;border-radius:20px;border:1px solid var(--border-subtle);
            background:none;cursor:pointer;font-size:0.8125rem;color:var(--text-secondary);">
            ${esc(c)} <span style="color:var(--text-muted);">(${cnt})</span>
          </button>`;
        }).join('')}
      </div>`;
  } else {
    const inCountry = inCont.filter(i => i.country === navCountry);
    const cities    = [...new Set(inCountry.map(i => i.city).filter(Boolean))].sort();

    el.innerHTML = `
      <button class="bc-btn" data-level="root"
        style="background:none;border:none;cursor:pointer;color:var(--brand-gold);font-size:0.875rem;">
        Todos</button>
      <span style="color:var(--text-muted);">›</span>
      <button class="bc-btn" data-level="continent"
        style="background:none;border:none;cursor:pointer;color:var(--brand-gold);font-size:0.875rem;">
        ${esc(navContinent)}</button>
      <span style="color:var(--text-muted);">›</span>
      <span style="font-weight:600;font-size:0.875rem;">${esc(navCountry)}</span>
      ${cities.length ? `
        <span style="color:var(--border-subtle);">›</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="nav-chip ${!navCity?'active':''}" data-city=""
            style="padding:3px 10px;border-radius:20px;
            border:1px solid ${!navCity?'var(--brand-gold)':'var(--border-subtle)'};
            background:${!navCity?'var(--brand-gold)18':'none'};
            cursor:pointer;font-size:0.8125rem;
            color:${!navCity?'var(--brand-gold)':'var(--text-secondary)'};">
            Todos (${inCountry.length})</button>
          ${cities.map(c => {
            const cnt   = inCountry.filter(i => i.city === c).length;
            const active= navCity === c;
            return `<button class="nav-chip" data-city="${esc(c)}"
              style="padding:3px 10px;border-radius:20px;
              border:1px solid ${active?'var(--brand-gold)':'var(--border-subtle)'};
              background:${active?'var(--brand-gold)18':'none'};
              cursor:pointer;font-size:0.8125rem;
              color:${active?'var(--brand-gold)':'var(--text-secondary)'};">
              ${esc(c)} (${cnt})</button>`;
          }).join('')}
        </div>` : ''}
    `;
  }

  // Breadcrumb back buttons
  el.querySelectorAll('.bc-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.level === 'root')      { navContinent = ''; navCountry = ''; navCity = ''; }
      if (btn.dataset.level === 'continent') { navCountry = ''; navCity = ''; }
      renderBreadcrumb(); renderGallery();
    });
  });

  // Country/city chips
  el.querySelectorAll('.nav-chip[data-country]').forEach(btn => {
    btn.addEventListener('click', () => {
      navCountry = btn.dataset.country; navCity = '';
      renderBreadcrumb(); renderGallery();
    });
  });
  el.querySelectorAll('.nav-chip[data-city]').forEach(btn => {
    btn.addEventListener('click', () => {
      navCity = btn.dataset.city;
      renderBreadcrumb(); renderGallery();
    });
  });
}

/* ── Gallery render ── */
function renderGallery() {
  const gallery = document.getElementById('img-gallery');
  const countEl = document.getElementById('img-count');
  if (!gallery) return;

  let imgs = allImages;
  if (navContinent) imgs = imgs.filter(i => i.continent === navContinent);
  if (navCountry)   imgs = imgs.filter(i => i.country   === navCountry);
  if (navCity)      imgs = imgs.filter(i => i.city       === navCity);
  if (searchStr) {
    imgs = imgs.filter(i => {
      const hay = [i.name, i.city, i.country, ...(i.tags||[])]
        .join(' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      return hay.includes(searchStr);
    });
  }

  if (countEl) countEl.textContent = `${imgs.length} imagem${imgs.length!==1?'ns':''}`;

  if (!imgs.length) {
    gallery.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-muted);">
      ${navContinent || searchStr ? 'Nenhuma imagem encontrada.' : 'Nenhuma imagem cadastrada. Faça upload para começar.'}
    </div>`;
    return;
  }

  // Store filtered list for lightbox navigation
  window._galleryImgs = imgs;

  if (viewMode === 'grid') {
    gallery.innerHTML = `<div style="display:grid;
      grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;">
      ${imgs.map((img, idx) => imgCard(img, idx)).join('')}
    </div>`;
  } else {
    gallery.innerHTML = `<div class="card" style="padding:0;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
        <thead><tr style="background:var(--bg-surface);">
          <th style="${TH}">Imagem</th>
          <th style="${TH}">Nome</th>
          <th style="${TH}">Localização</th>
          <th style="${TH}">Tags</th>
          <th style="${TH}">Tipo</th>
          <th style="${TH}">Tamanho</th>
          <th style="${TH}"></th>
        </tr></thead>
        <tbody>
          ${imgs.map((img, idx) => imgRow(img, idx)).join('')}
        </tbody>
      </table>
    </div>`;
  }

  // Bind events
  gallery.querySelectorAll('.img-open-lightbox').forEach(el => {
    el.addEventListener('click', () => openLightbox(Number(el.dataset.idx)));
  });
  gallery.querySelectorAll('.img-edit-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openEditModal(btn.dataset.id);
    });
  });
  gallery.querySelectorAll('.img-download-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const url  = btn.dataset.url;
      const name = (btn.dataset.name || 'imagem').replace(/\s+/g, '-');
      try {
        // Proxy through R2 worker to avoid CORS
        const R2_PROXY = 'https://primetour-images.rene-castro.workers.dev';
        const res  = await fetch(`${R2_PROXY}?url=${encodeURIComponent(url)}`);
        const blob = await res.blob();
        const ext  = blob.type?.split('/')[1]?.replace('jpeg','jpg') || 'jpg';
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = `${name}.${ext}`;
        a.click();
        URL.revokeObjectURL(a.href);
      } catch(e) {
        // Fallback: open in new tab
        window.open(url, '_blank');
      }
    });
  });

  gallery.querySelectorAll('.img-copy-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      navigator.clipboard.writeText(btn.dataset.url).then(() => toast.success('URL copiada!'));
    });
  });
  gallery.querySelectorAll('.img-delete-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('Excluir esta imagem do banco e do R2?')) return;
      try {
        await deleteImageMeta(btn.dataset.id);
        toast.success('Imagem excluída.');
        await loadImages();
      } catch(err) { toast.error('Erro: ' + err.message); }
    });
  });
}

const TH = `padding:10px 14px;text-align:left;font-size:0.6875rem;font-weight:700;
  text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);
  border-bottom:1px solid var(--border-subtle);`;

function imgCard(img, idx) {
  const typeBadge = IMAGE_TYPES.find(t => t.key === img.type)?.label || img.type || 'Galeria';
  return `
    <div style="border-radius:var(--radius-md);overflow:hidden;
      border:1px solid var(--border-subtle);background:var(--bg-surface);
      cursor:pointer;transition:transform .15s,box-shadow .15s;"
      onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px rgba(0,0,0,.3)'"
      onmouseout="this.style.transform='';this.style.boxShadow=''">
      <div class="img-open-lightbox" data-idx="${idx}"
        style="position:relative;height:150px;overflow:hidden;">
        <img src="${esc(img.url)}" loading="lazy" alt="${esc(img.name)}"
          style="width:100%;height:100%;object-fit:cover;display:block;"
          onerror="this.parentElement.innerHTML='<div style=\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--bg-surface);color:var(--text-muted);font-size:1.5rem;\'>🖼</div>'">
        <div style="position:absolute;top:6px;left:6px;font-size:0.6375rem;padding:2px 7px;
          border-radius:20px;background:rgba(0,0,0,.65);color:white;backdrop-filter:blur(4px);">
          ${esc(typeBadge)}</div>
      </div>
      <div style="padding:10px 12px;">
        <div style="font-size:0.875rem;font-weight:600;white-space:nowrap;overflow:hidden;
          text-overflow:ellipsis;margin-bottom:3px;">${esc(img.name || '—')}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:6px;">
          ${esc([img.city, img.country].filter(Boolean).join(', ') || img.continent || '—')}
        </div>
        ${img.tags?.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">
          ${img.tags.slice(0,3).map(t => `
            <span style="font-size:0.625rem;padding:1px 6px;border-radius:20px;
              background:var(--brand-gold)15;border:1px solid var(--brand-gold)30;
              color:var(--brand-gold);">${esc(t)}</span>`).join('')}
          ${img.tags.length > 3 ? `<span style="font-size:0.625rem;color:var(--text-muted);">+${img.tags.length-3}</span>` : ''}
        </div>` : ''}
        <div style="display:flex;gap:5px;">
          <button class="img-edit-btn btn btn-ghost btn-sm" data-id="${img.id}"
            style="font-size:0.7rem;flex:1;">✎ Editar</button>
          <button class="img-copy-btn btn btn-ghost btn-sm" data-url="${esc(img.url)}"
            style="font-size:0.7rem;" title="Copiar URL">⎘</button>
          <button class="img-download-btn btn btn-ghost btn-sm"
            data-url="${esc(img.url)}" data-name="${esc(img.name||'imagem')}"
            style="font-size:0.7rem;color:var(--brand-gold);" title="Baixar">↓</button>
          <button class="img-delete-btn btn btn-ghost btn-sm" data-id="${img.id}"
            style="font-size:0.7rem;color:#EF4444;" title="Excluir">✕</button>
        </div>
      </div>
    </div>`;
}

function imgRow(img, idx) {
  const typeBadge = IMAGE_TYPES.find(t => t.key === img.type)?.label || '—';
  return `
    <tr style="border-bottom:1px solid var(--border-subtle);transition:background .1s;"
      onmouseover="this.style.background='var(--bg-surface)'"
      onmouseout="this.style.background=''">
      <td style="padding:8px 14px;">
        <img src="${esc(img.url)}" loading="lazy" alt=""
          class="img-open-lightbox" data-idx="${idx}"
          style="width:48px;height:36px;object-fit:cover;border-radius:var(--radius-sm);cursor:pointer;">
      </td>
      <td style="padding:8px 14px;font-weight:600;max-width:180px;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(img.name||'—')}</td>
      <td style="padding:8px 14px;color:var(--text-muted);font-size:0.8125rem;">
        ${esc([img.city, img.country, img.continent].filter(Boolean).join(' · '))}
      </td>
      <td style="padding:8px 14px;">
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          ${(img.tags||[]).slice(0,3).map(t => `
            <span style="font-size:0.6875rem;padding:1px 6px;border-radius:20px;
              background:var(--brand-gold)15;border:1px solid var(--brand-gold)30;
              color:var(--brand-gold);">${esc(t)}</span>`).join('')}
        </div>
      </td>
      <td style="padding:8px 14px;font-size:0.8125rem;color:var(--text-muted);">${esc(typeBadge)}</td>
      <td style="padding:8px 14px;font-size:0.8125rem;color:var(--text-muted);">
        ${img.sizeMB ? img.sizeMB + ' MB' : '—'}
      </td>
      <td style="padding:8px 14px;">
        <div style="display:flex;gap:5px;justify-content:flex-end;">
          <button class="img-edit-btn btn btn-ghost btn-sm" data-id="${img.id}"
            style="font-size:0.75rem;">✎</button>
          <button class="img-copy-btn btn btn-ghost btn-sm" data-url="${esc(img.url)}"
            style="font-size:0.75rem;" title="Copiar URL">⎘</button>
          <button class="img-download-btn btn btn-ghost btn-sm"
            data-url="${esc(img.url)}" data-name="${esc(img.name||'imagem')}"
            style="font-size:0.75rem;color:var(--brand-gold);" title="Baixar">↓</button>
          <button class="img-delete-btn btn btn-ghost btn-sm" data-id="${img.id}"
            style="font-size:0.75rem;color:#EF4444;">✕</button>
        </div>
      </td>
    </tr>`;
}

/* ── Edit modal ── */
function openEditModal(imgId) {
  const img = allImages.find(i => i.id === imgId);
  if (!img) return;

  const existing = document.getElementById('img-edit-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'img-edit-modal';
  modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2500;
    display:flex;align-items:center;justify-content:center;padding:20px;`;
  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:480px;padding:0;overflow:hidden;">
      <div style="padding:18px 24px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;gap:10px;">
        <div style="flex:1;font-weight:700;">Editar imagem</div>
        <button id="edit-img-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);">✕</button>
      </div>
      <div style="padding:24px;display:flex;flex-direction:column;gap:14px;">
        <img src="${esc(img.url)}" alt=""
          style="width:100%;height:160px;object-fit:cover;border-radius:var(--radius-sm);">
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:5px;">
            Nome da imagem</label>
          <input type="text" id="edit-img-name" value="${esc(img.name||'')}"
            class="portal-field" style="width:100%;">
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:5px;">
            Lugar representado
            <span style="font-weight:400;color:var(--text-muted);">(opcional)</span></label>
          <input type="text" id="edit-img-placename" value="${esc(img.placeName||'')}"
            class="portal-field" style="width:100%;"
            placeholder="Ex: Torre Eiffel, Restaurante Jules Verne, Museu do Louvre">
          <div style="font-size:0.6875rem;color:var(--text-muted);margin-top:4px;">
            Quando preenchido, esta foto é usada especificamente para este lugar nas dicas geradas.
          </div>
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:5px;">
            Tags <span style="font-weight:400;color:var(--text-muted);">(separadas por vírgula)</span></label>
          <input type="text" id="edit-img-tags" value="${esc((img.tags||[]).join(', '))}"
            class="portal-field" style="width:100%;">
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:5px;">
            Tipo</label>
          <select id="edit-img-type" class="filter-select" style="width:100%;">
            ${IMAGE_TYPES.map(t =>
              `<option value="${t.key}" ${img.type===t.key?'selected':''}>${t.icon} ${t.label}</option>`
            ).join('')}
          </select>
          <div id="edit-type-desc"
            style="font-size:0.75rem;color:var(--text-muted);margin-top:6px;line-height:1.5;
            padding:8px 10px;background:var(--bg-surface);border-radius:var(--radius-sm);">
            ${IMAGE_TYPES.find(t=>t.key===(img.type||'galeria'))?.desc||''}
          </div>
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);">
          ${img.width && img.height ? `${img.width} × ${img.height} px · ` : ''}${img.sizeMB || '—'} MB ·
          <a href="${esc(img.url)}" target="_blank" style="color:var(--brand-gold);">Abrir original ↗</a>
        </div>
      </div>
      <div style="padding:14px 24px;border-top:1px solid var(--border-subtle);
        background:var(--bg-surface);display:flex;gap:8px;justify-content:flex-end;">
        <button id="edit-img-cancel" class="btn btn-ghost btn-sm">Cancelar</button>
        <button id="edit-img-save" class="btn btn-primary btn-sm">Salvar</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById('edit-img-close')?.addEventListener('click', close);
  document.getElementById('edit-img-cancel')?.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  document.getElementById('edit-img-type')?.addEventListener('change', e => {
    const desc = IMAGE_TYPES.find(t => t.key === e.target.value)?.desc || '';
    const el   = document.getElementById('edit-type-desc');
    if (el) el.textContent = desc;
  });

  document.getElementById('edit-img-save')?.addEventListener('click', async () => {
    const name      = document.getElementById('edit-img-name')?.value.trim();
    const placeName = document.getElementById('edit-img-placename')?.value.trim() || '';
    const tags = (document.getElementById('edit-img-tags')?.value || '')
      .split(',').map(t => t.trim()).filter(Boolean);
    const type = document.getElementById('edit-img-type')?.value;
    try {
      await updateImageMeta(imgId, { name, placeName, tags, type });
      toast.success('Imagem atualizada.');
      close();
      await loadImages();
    } catch(e) { toast.error('Erro: ' + e.message); }
  });
}

/* ── Lightbox ── */
function openLightbox(idx) {
  lightboxIdx = idx;
  renderLightbox();
  const lb = document.getElementById('img-lightbox');
  if (lb) lb.style.display = 'flex';
}

function renderLightbox() {
  const lb  = document.getElementById('img-lightbox');
  const imgs = window._galleryImgs || [];
  const img  = imgs[lightboxIdx];
  if (!lb || !img) return;

  lb.innerHTML = `
    <div style="position:absolute;top:16px;right:16px;display:flex;gap:8px;z-index:10;">
      <button id="lb-copy" style="border:none;background:rgba(255,255,255,.15);color:white;
        border-radius:var(--radius-sm);padding:6px 12px;cursor:pointer;font-size:0.8125rem;
        backdrop-filter:blur(4px);">⎘ Copiar URL</button>
      <button id="lb-close" style="border:none;background:rgba(255,255,255,.15);color:white;
        border-radius:var(--radius-sm);padding:6px 12px;cursor:pointer;font-size:1rem;
        backdrop-filter:blur(4px);">✕</button>
    </div>
    ${lightboxIdx > 0 ? `<button id="lb-prev" style="position:absolute;left:16px;top:50%;
      transform:translateY(-50%);border:none;background:rgba(255,255,255,.15);color:white;
      border-radius:var(--radius-sm);padding:10px 14px;cursor:pointer;font-size:1.25rem;
      backdrop-filter:blur(4px);">‹</button>` : ''}
    ${lightboxIdx < imgs.length - 1 ? `<button id="lb-next" style="position:absolute;right:16px;
      top:50%;transform:translateY(-50%);border:none;background:rgba(255,255,255,.15);color:white;
      border-radius:var(--radius-sm);padding:10px 14px;cursor:pointer;font-size:1.25rem;
      backdrop-filter:blur(4px);">›</button>` : ''}
    <img src="${esc(img.url)}" alt="${esc(img.name)}"
      style="max-width:90vw;max-height:80vh;object-fit:contain;border-radius:var(--radius-md);
      box-shadow:0 24px 80px rgba(0,0,0,.6);">
    <div style="margin-top:14px;text-align:center;color:white;">
      <div style="font-size:1rem;font-weight:600;margin-bottom:4px;">${esc(img.name||'')}</div>
      <div style="font-size:0.8125rem;color:rgba(255,255,255,.6);">
        ${esc([img.city, img.country, img.continent].filter(Boolean).join(' · '))}
        ${img.width && img.height ? ` · ${img.width}×${img.height}px` : ''}
        ${img.sizeMB ? ` · ${img.sizeMB} MB` : ''}
      </div>
      ${img.tags?.length ? `<div style="display:flex;gap:6px;justify-content:center;margin-top:8px;flex-wrap:wrap;">
        ${img.tags.map(t => `<span style="font-size:0.75rem;padding:2px 8px;border-radius:20px;
          background:rgba(212,168,67,.2);border:1px solid rgba(212,168,67,.4);color:var(--brand-gold);">
          ${esc(t)}</span>`).join('')}
      </div>` : ''}
      <div style="font-size:0.75rem;color:rgba(255,255,255,.4);margin-top:8px;">
        ${lightboxIdx + 1} de ${imgs.length}</div>
    </div>
  `;

  document.getElementById('lb-close')?.addEventListener('click', closeLightbox);
  document.getElementById('lb-prev')?.addEventListener('click', () => { lightboxIdx--; renderLightbox(); });
  document.getElementById('lb-next')?.addEventListener('click', () => { lightboxIdx++; renderLightbox(); });
  document.getElementById('lb-copy')?.addEventListener('click', () => {
    navigator.clipboard.writeText(img.url).then(() => toast.success('URL copiada!'));
  });
  lb.onclick = e => { if (e.target === lb) closeLightbox(); };
}

function closeLightbox() {
  const lb = document.getElementById('img-lightbox');
  if (lb) lb.style.display = 'none';
  lightboxIdx = -1;
}

function handleLightboxKey(e) {
  const lb = document.getElementById('img-lightbox');
  if (!lb || lb.style.display === 'none') return;
  const imgs = window._galleryImgs || [];
  if (e.key === 'Escape')      closeLightbox();
  if (e.key === 'ArrowLeft'  && lightboxIdx > 0)             { lightboxIdx--; renderLightbox(); }
  if (e.key === 'ArrowRight' && lightboxIdx < imgs.length-1) { lightboxIdx++; renderLightbox(); }
}

function skeletonGrid() {
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;">
    ${Array(6).fill(`<div class="skeleton" style="height:220px;border-radius:var(--radius-md);"></div>`).join('')}
  </div>`;
}
