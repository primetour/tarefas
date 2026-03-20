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
  { key: 'destaque',  label: 'Destaque'       },
  { key: 'galeria',   label: 'Galeria'         },
  { key: 'banner',    label: 'Banner'          },
  { key: 'logo_area', label: 'Logo de Área'    },
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
    <div class="card" style="padding:24px;">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:16px;">
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:5px;">
            Continente *</label>
          <select id="up-continent" class="filter-select" style="width:100%;">
            <option value="">Selecione</option>
            ${CONTINENTS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:5px;">
            País *</label>
          <select id="up-country" class="filter-select" style="width:100%;" disabled>
            <option value="">Selecione o continente</option>
          </select>
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:5px;">
            Cidade <span style="font-weight:400;color:var(--text-muted);">(opcional)</span></label>
          <select id="up-city" class="filter-select" style="width:100%;" disabled>
            <option value="">Todas as cidades</option>
          </select>
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:5px;">
            Tipo</label>
          <select id="up-type" class="filter-select" style="width:100%;">
            ${IMAGE_TYPES.map(t => `<option value="${t.key}">${t.label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:5px;">
          Tags <span style="font-weight:400;color:var(--text-muted);">(separadas por vírgula)</span></label>
        <input type="text" id="up-tags" class="portal-field"
          placeholder="ex: monumento, noturna, principal" style="width:100%;">
      </div>
      <div id="img-dropzone"
        style="border:2px dashed var(--border-subtle);border-radius:var(--radius-md);
        padding:32px;text-align:center;cursor:pointer;transition:border-color .2s;">
        <div style="font-size:2rem;margin-bottom:8px;">🖼</div>
        <div style="font-size:0.9375rem;font-weight:600;margin-bottom:4px;">
          Arraste imagens aqui ou clique para selecionar</div>
        <div style="font-size:0.8125rem;color:var(--text-muted);">
          JPG, PNG, WEBP, HEIC · Convertido automaticamente para .webp · Máx 10 MB/arquivo</div>
        <input type="file" id="img-file-input" multiple accept="image/*" style="display:none;">
      </div>
      <div id="img-upload-queue" style="margin-top:12px;"></div>
    </div>
  `;
}

function wireUploadPanel() {
  const dropzone  = document.getElementById('img-dropzone');
  const fileInput = document.getElementById('img-file-input');
  if (!dropzone) return;

  dropzone.addEventListener('click', () => fileInput?.click());
  dropzone.addEventListener('dragover', e => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--brand-gold)';
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.style.borderColor = 'var(--border-subtle)';
  });
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--border-subtle)';
    handleFiles([...e.dataTransfer.files]);
  });
  fileInput?.addEventListener('change', () => {
    handleFiles([...fileInput.files]);
    fileInput.value = '';
  });

  // Continent → Country → City cascade (linked to portal_destinations)
  document.getElementById('up-continent')?.addEventListener('change', e => {
    const cont     = e.target.value;
    const countries= [...new Set(allDests.filter(d => !cont || d.continent === cont)
      .map(d => d.country).filter(Boolean))].sort();
    const countrySel = document.getElementById('up-country');
    countrySel.innerHTML = `<option value="">Selecione o país</option>` +
      countries.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    countrySel.disabled = !cont;
    const citySel = document.getElementById('up-city');
    citySel.innerHTML = `<option value="">Todas as cidades</option>`;
    citySel.disabled = true;
  });

  document.getElementById('up-country')?.addEventListener('change', e => {
    const cont  = document.getElementById('up-continent')?.value;
    const count = e.target.value;
    const cities = [...new Set(allDests.filter(d =>
      (!cont  || d.continent === cont) &&
      (!count || d.country   === count) && d.city
    ).map(d => d.city))].sort();
    const citySel = document.getElementById('up-city');
    citySel.innerHTML = `<option value="">Todas as cidades</option>` +
      cities.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    citySel.disabled = !count;
  });
}

async function handleFiles(files) {
  const continent = document.getElementById('up-continent')?.value;
  const country   = document.getElementById('up-country')?.value;
  if (!continent || !country) {
    toast.error('Selecione continente e país antes de fazer upload.'); return;
  }
  const city  = document.getElementById('up-city')?.value   || '';
  const type  = document.getElementById('up-type')?.value   || 'galeria';
  const tags  = (document.getElementById('up-tags')?.value  || '')
    .split(',').map(t => t.trim()).filter(Boolean);

  const imgFiles = files.filter(f => f.type.startsWith('image/'));
  if (!imgFiles.length) { toast.error('Nenhuma imagem selecionada.'); return; }

  const queue = document.getElementById('img-upload-queue');
  if (!queue) return;

  // Build queue rows
  const rows = imgFiles.map(file => {
    const row = document.createElement('div');
    row.style.cssText = `display:flex;align-items:center;gap:10px;padding:8px 0;
      border-bottom:1px solid var(--border-subtle);`;
    row.innerHTML = `
      <div id="up-thumb-${esc(file.name)}"
        style="width:40px;height:40px;border-radius:var(--radius-sm);background:var(--bg-surface);
        overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;
        font-size:1.25rem;color:var(--text-muted);">🖼</div>
      <div style="flex:1;overflow:hidden;">
        <div style="font-size:0.8125rem;font-weight:600;white-space:nowrap;
          overflow:hidden;text-overflow:ellipsis;">${esc(file.name)}</div>
        <div class="up-status-${esc(file.name)}"
          style="font-size:0.75rem;color:var(--text-muted);">Aguardando…</div>
      </div>
      <div class="up-size-${esc(file.name)}"
        style="font-size:0.75rem;color:var(--text-muted);white-space:nowrap;"></div>
    `;
    return { file, row };
  });
  queue.innerHTML = '';
  rows.forEach(({ row }) => queue.appendChild(row));

  // Process all in parallel
  await Promise.all(rows.map(async ({ file, row }) => {
    const safeKey    = esc(file.name);
    const statusEl   = row.querySelector(`.up-status-${safeKey}`);
    const sizeEl     = row.querySelector(`.up-size-${safeKey}`);
    const thumbEl    = row.querySelector(`#up-thumb-${safeKey}`);
    const setStatus  = (msg, color = 'var(--text-muted)') => {
      if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color; }
    };

    try {
      setStatus('Convertendo para .webp…', 'var(--brand-gold)');
      const { blob, width, height } = await convertToWebp(file);
      const sizeMB = (blob.size / 1024 / 1024).toFixed(2);
      if (sizeEl) sizeEl.textContent = `${sizeMB} MB`;

      // Show preview thumbnail
      if (thumbEl) {
        const objUrl = URL.createObjectURL(blob);
        thumbEl.innerHTML = `<img src="${objUrl}" style="width:100%;height:100%;object-fit:cover;"
          onload="URL.revokeObjectURL(this.src)">`;
      }

      setStatus(`WebP pronto (${sizeMB} MB) — enviando…`, 'var(--brand-gold)');

      const slug = s => s.toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
      const path = [continent, country, city].filter(Boolean).map(slug).join('/')
        + '/' + Date.now() + '-' + slug(file.name.replace(/\.[^.]+$/,'')) + '.webp';

      const url = await uploadImageToR2(blob, path);

      // Default name = file name without extension, prettified
      const defaultName = file.name.replace(/\.[^.]+$/,'').replace(/[-_]/g,' ')
        .replace(/\b\w/g, c => c.toUpperCase());

      await saveImageMeta({
        continent, country, city, type, tags, url, path,
        name: defaultName, originalName: file.name,
        sizeMB: parseFloat(sizeMB), width, height,
      });

      setStatus('✓ Enviado com sucesso', '#22C55E');
    } catch(e) {
      setStatus('✗ ' + e.message.slice(0, 60), '#EF4444');
    }
  }));

  toast.success('Upload concluído!');
  await loadImages();
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
            Tags <span style="font-weight:400;color:var(--text-muted);">(separadas por vírgula)</span></label>
          <input type="text" id="edit-img-tags" value="${esc((img.tags||[]).join(', '))}"
            class="portal-field" style="width:100%;">
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:5px;">
            Tipo</label>
          <select id="edit-img-type" class="filter-select" style="width:100%;">
            ${IMAGE_TYPES.map(t =>
              `<option value="${t.key}" ${img.type===t.key?'selected':''}>${t.label}</option>`
            ).join('')}
          </select>
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

  document.getElementById('edit-img-save')?.addEventListener('click', async () => {
    const name = document.getElementById('edit-img-name')?.value.trim();
    const tags = (document.getElementById('edit-img-tags')?.value || '')
      .split(',').map(t => t.trim()).filter(Boolean);
    const type = document.getElementById('edit-img-type')?.value;
    try {
      await updateImageMeta(imgId, { name, tags, type });
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
