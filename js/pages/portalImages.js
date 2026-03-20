/**
 * PRIMETOUR — Portal de Dicas: Banco de Imagens
 * Upload → conversão .webp → Cloudflare R2
 */
import { store } from '../store.js';
import { toast } from '../components/toast.js';
import {
  fetchImages, saveImageMeta, deleteImageMeta,
  convertToWebp, uploadImageToR2, fetchDestinations,
  R2_PUBLIC_URL, CONTINENTS,
} from '../services/portal.js';

const esc = s => String(s||'').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

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
        <p class="page-subtitle">Imagens convertidas automaticamente para .webp e armazenadas no Cloudflare R2</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary btn-sm" id="img-upload-btn">↑ Upload de Imagens</button>
      </div>
    </div>

    <!-- Upload area -->
    <div id="img-upload-area" style="display:none;margin-bottom:20px;">
      <div class="card" style="padding:24px;">
        <h3 style="font-size:0.875rem;font-weight:700;margin:0 0 16px;">Upload de Imagens</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px;">
          <div>
            <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">Continente *</label>
            <select id="upload-continent" class="filter-select" style="width:100%;">
              <option value="">Selecione</option>
              ${CONTINENTS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">País *</label>
            <input type="text" id="upload-country" class="filter-select" style="width:100%;" placeholder="Ex: França">
          </div>
          <div>
            <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">
              Cidade <span style="font-weight:400;color:var(--text-muted);">(opcional)</span>
            </label>
            <input type="text" id="upload-city" class="filter-select" style="width:100%;" placeholder="Ex: Paris">
          </div>
        </div>

        <div id="img-dropzone"
          style="border:2px dashed var(--border-subtle);border-radius:var(--radius-md);
          padding:32px;text-align:center;cursor:pointer;transition:all .2s;"
          onmouseover="this.style.borderColor='var(--brand-gold)'"
          onmouseout="this.style.borderColor='var(--border-subtle)'">
          <div style="font-size:2rem;margin-bottom:8px;">🖼</div>
          <div style="font-size:0.9375rem;font-weight:600;margin-bottom:4px;">
            Arraste imagens aqui ou clique para selecionar
          </div>
          <div style="font-size:0.8125rem;color:var(--text-muted);">
            Aceita JPG, PNG, WEBP, HEIC. Convertido automaticamente para .webp.
          </div>
          <input type="file" id="img-file-input" multiple accept="image/*" style="display:none;">
        </div>

        <div id="img-upload-queue" style="margin-top:12px;"></div>
      </div>
    </div>

    <!-- Filters -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;align-items:center;">
      <select class="filter-select" id="img-filter-cont" style="min-width:160px;">
        <option value="">Todos os continentes</option>
        ${CONTINENTS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
      </select>
      <select class="filter-select" id="img-filter-country" style="min-width:150px;" disabled>
        <option value="">Todos os países</option>
      </select>
      <span id="img-count" style="margin-left:auto;font-size:0.8125rem;color:var(--text-muted);"></span>
    </div>

    <!-- Gallery -->
    <div id="img-gallery" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;">
      ${[1,2,3,4,5,6].map(() => `<div class="skeleton" style="height:160px;border-radius:var(--radius-md);"></div>`).join('')}
    </div>
  `;

  // Upload toggle
  document.getElementById('img-upload-btn')?.addEventListener('click', () => {
    const area = document.getElementById('img-upload-area');
    if (area) area.style.display = area.style.display === 'none' ? 'block' : 'none';
  });

  // Dropzone
  const dropzone  = document.getElementById('img-dropzone');
  const fileInput = document.getElementById('img-file-input');
  dropzone?.addEventListener('click', () => fileInput?.click());
  dropzone?.addEventListener('dragover', e => { e.preventDefault(); dropzone.style.borderColor = 'var(--brand-gold)'; });
  dropzone?.addEventListener('dragleave', () => { dropzone.style.borderColor = 'var(--border-subtle)'; });
  dropzone?.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--border-subtle)';
    handleFiles([...e.dataTransfer.files]);
  });
  fileInput?.addEventListener('change', () => handleFiles([...fileInput.files]));

  // Filters
  document.getElementById('img-filter-cont')?.addEventListener('change', async e => {
    const countrySel = document.getElementById('img-filter-country');
    if (countrySel) {
      const dests = await fetchDestinations({ continent: e.target.value });
      const countries = [...new Set(dests.map(d => d.country).filter(Boolean))].sort();
      countrySel.innerHTML = `<option value="">Todos os países</option>` +
        countries.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
      countrySel.disabled = !e.target.value;
    }
    await loadGallery();
  });
  document.getElementById('img-filter-country')?.addEventListener('change', loadGallery);

  await loadGallery();
}

async function loadGallery() {
  const gallery = document.getElementById('img-gallery');
  const count   = document.getElementById('img-count');
  if (!gallery) return;

  const continent = document.getElementById('img-filter-cont')?.value;
  const country   = document.getElementById('img-filter-country')?.value;
  const images    = await fetchImages({ continent, country });

  if (count) count.textContent = `${images.length} imagem${images.length !== 1 ? 'ns' : ''}`;

  if (!images.length) {
    gallery.innerHTML = `<div style="grid-column:1/-1;padding:48px;text-align:center;color:var(--text-muted);">
      Nenhuma imagem cadastrada. Faça upload clicando em "Upload de Imagens".
    </div>`;
    return;
  }

  gallery.innerHTML = images.map(img => `
    <div style="position:relative;border-radius:var(--radius-md);overflow:hidden;
      border:1px solid var(--border-subtle);group;">
      <img src="${esc(img.url)}" loading="lazy"
        style="width:100%;height:140px;object-fit:cover;display:block;"
        onerror="this.src='data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'100\'><rect fill=\'%23333\'/><text y=\'50\' fill=\'%23666\' text-anchor=\'middle\' x=\'50\' font-size=\'12\'>Sem imagem</text></svg>'">
      <div style="padding:8px 10px;background:var(--bg-surface);">
        <div style="font-size:0.75rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${esc(img.city || img.country || img.continent || '—')}
        </div>
        <div style="font-size:0.6875rem;color:var(--text-muted);">
          ${esc(img.country || '')}${img.continent ? ` · ${esc(img.continent)}` : ''}
        </div>
      </div>
      <button data-delete="${img.id}"
        style="position:absolute;top:6px;right:6px;border:none;background:rgba(0,0,0,.6);
        color:white;border-radius:var(--radius-full);width:24px;height:24px;cursor:pointer;
        font-size:0.75rem;display:flex;align-items:center;justify-content:center;">
        ✕
      </button>
    </div>
  `).join('');

  gallery.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', async () => {
      if (!confirm('Excluir esta imagem do banco?')) return;
      try {
        await deleteImageMeta(btn.dataset.delete);
        toast.success('Imagem removida do banco.');
        await loadGallery();
      } catch(e) { toast.error('Erro: ' + e.message); }
    }));
}

async function handleFiles(files) {
  const continent = document.getElementById('upload-continent')?.value;
  const country   = document.getElementById('upload-country')?.value?.trim();
  if (!continent || !country) {
    toast.error('Selecione continente e país antes de fazer upload.'); return;
  }
  const city  = document.getElementById('upload-city')?.value?.trim() || '';
  const queue = document.getElementById('img-upload-queue');
  if (!queue) return;

  queue.innerHTML = '';
  for (const file of files.filter(f => f.type.startsWith('image/'))) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-subtle);';
    row.innerHTML = `
      <span style="font-size:0.8125rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${esc(file.name)}
      </span>
      <span class="upload-status" style="font-size:0.75rem;color:var(--text-muted);">Aguardando…</span>
    `;
    queue.appendChild(row);
    const statusEl = row.querySelector('.upload-status');

    try {
      statusEl.textContent = 'Convertendo…';
      statusEl.style.color = 'var(--brand-gold)';
      const webpBlob = await convertToWebp(file);

      const sizeMB = (webpBlob.size / 1024 / 1024).toFixed(2);
      statusEl.textContent = `WebP pronto (${sizeMB}MB) — enviando…`;

      const path     = [continent, country, city].filter(Boolean)
        .map(s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-'))
        .join('/') + '/' + Date.now() + '.webp';

      const url = await uploadImageToR2(webpBlob, path);

      await saveImageMeta({ continent, country, city, url, path, originalName: file.name, sizeMB: parseFloat(sizeMB) });

      statusEl.textContent = '✓ Enviado';
      statusEl.style.color = '#22C55E';
    } catch(e) {
      statusEl.textContent = '✗ ' + e.message.slice(0, 40);
      statusEl.style.color = '#EF4444';
    }
  }
  await loadGallery();
}
