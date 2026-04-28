/**
 * PRIMETOUR — Portal de Dicas: Áreas
 * Cadastro de áreas com logo e templates vinculados
 */
import { store } from '../store.js';
import { toast } from '../components/toast.js';
import { fetchAreas, saveArea, deleteArea, convertToWebp, uploadImageToR2 } from '../services/portal.js';

const esc = s => String(s||'').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ─── Helpers do modal ──────────────────────────────────────── */
// Bloco de upload de logo (slot: 'main' | 'alt')
function logoBlock({ slot, label, hint, previewBg, currentUrl }) {
  const ids = {
    drop:    `area-logo-${slot}-drop`,
    file:    `area-logo-${slot}-file`,
    label:   `area-logo-${slot}-label`,
    progress:`area-logo-${slot}-progress`,
    url:     `area-logo-${slot}`,
    preview: `area-logo-${slot}-preview`,
  };
  return `<div data-logo-slot="${slot}">
    <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">${label}</label>
    <div style="font-size:0.6875rem;color:var(--text-muted);margin-bottom:6px;">${hint}</div>
    <div id="${ids.drop}"
      style="border:1.5px dashed var(--border-default);border-radius:var(--radius-md);
        padding:14px;text-align:center;cursor:pointer;font-size:0.8125rem;
        color:var(--text-muted);background:var(--bg-surface);
        transition:border-color .15s, background .15s;">
      <span id="${ids.label}">${currentUrl ? '📁 Trocar (clique ou arraste)' : '📁 Clique ou arraste uma imagem (PNG/JPG/SVG)'}</span>
      <input type="file" id="${ids.file}" accept="image/*" style="display:none;">
    </div>
    <div id="${ids.progress}" style="display:none;margin-top:6px;font-size:0.75rem;color:var(--text-muted);"></div>
    <details style="margin-top:6px;">
      <summary style="font-size:0.75rem;color:var(--text-muted);cursor:pointer;">URL manual (avançado)</summary>
      <input type="url" id="${ids.url}" class="filter-select" style="width:100%;margin-top:6px;"
        placeholder="https://pub-xxx.r2.dev/logos/nome.webp"
        value="${esc(currentUrl || '')}">
    </details>
    <div id="${ids.preview}" style="margin-top:8px;">
      ${currentUrl ? `<img src="${esc(currentUrl)}" style="max-height:60px;object-fit:contain;
        padding:6px 10px;background:${previewBg};border-radius:var(--radius-sm);
        border:1px solid var(--border-subtle);">` : ''}
    </div>
  </div>`;
}

// Color picker com input hex sincronizado
function colorPickerWithHex(field, label, value) {
  return `<div>
    <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:4px;">${label}</label>
    <div style="display:flex;gap:6px;align-items:center;">
      <input type="color" id="area-color-${field}" value="${value}"
        style="width:42px;height:36px;border-radius:var(--radius-sm);cursor:pointer;flex-shrink:0;
          border:1px solid var(--border-subtle);padding:2px;">
      <input type="text" id="area-color-${field}-hex" value="${value}" maxlength="7"
        pattern="^#[0-9A-Fa-f]{6}$" placeholder="#000000"
        style="flex:1;height:36px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
          text-transform:uppercase;letter-spacing:.04em;font-size:0.8125rem;
          padding:0 10px;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);
          background:var(--bg-elevated);color:var(--text-primary);">
    </div>
  </div>`;
}

export async function renderPortalAreas(container) {
  if (!store.canManagePortal()) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Áreas do Portal</h1>
        <p class="page-subtitle">Configure as áreas, logos e templates vinculados ao Portal de Dicas</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary btn-sm" id="area-new-btn">+ Nova Área</button>
      </div>
    </div>
    <div id="areas-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;">
      <div class="skeleton" style="height:140px;border-radius:var(--radius-md);"></div>
      <div class="skeleton" style="height:140px;border-radius:var(--radius-md);"></div>
      <div class="skeleton" style="height:140px;border-radius:var(--radius-md);"></div>
    </div>
    <div id="area-modal" style="display:none;"></div>
  `;

  await loadAreas();

  document.getElementById('area-new-btn')?.addEventListener('click', async () => {
    const areas = await fetchAreas();
    showAreaModal(null, areas);
  });
}

async function loadAreas() {
  const grid  = document.getElementById('areas-grid');
  if (!grid) return;
  const areas = await fetchAreas();

  if (!areas.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:48px;text-align:center;color:var(--text-muted);">
      Nenhuma área cadastrada. Crie a primeira área clicando em "Nova Área".
    </div>`;
    return;
  }

  // Group by category
  const categories = [...new Set(areas.map(a => a.category || '').filter(Boolean))].sort();
  const noCategory = areas.filter(a => !a.category);
  const grouped    = [
    ...(noCategory.length ? [{ cat: '', items: noCategory }] : []),
    ...categories.map(cat => ({ cat, items: areas.filter(a => a.category === cat) })),
  ];

  const renderCard = a => `
    <div class="card" style="padding:20px;position:relative;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        ${a.logoUrl
          ? `<img src="${esc(a.logoUrl)}" style="height:36px;object-fit:contain;" alt="${esc(a.name)}">`
          : `<div style="width:36px;height:36px;border-radius:var(--radius-md);background:#475569;color:#fff;
              display:flex;align-items:center;justify-content:center;font-size:1rem;">◈</div>`}
        <div>
          <div style="font-weight:700;font-size:0.9375rem;">${esc(a.name)}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">
            ${(a.templates||[]).length} template${(a.templates||[]).length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
      ${a.description ? `<p style="font-size:0.8125rem;color:var(--text-secondary);margin:0 0 12px;">${esc(a.description)}</p>` : ''}
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost btn-sm" data-edit="${a.id}" style="flex:1;">Editar</button>
        <button class="btn btn-ghost btn-sm" data-delete="${a.id}"
          style="color:#EF4444;">Excluir</button>
      </div>
    </div>`;

  grid.innerHTML = grouped.map(({ cat, items }) => `
    ${cat ? `<div style="grid-column:1/-1;margin-top:8px;">
      <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
        color:var(--text-muted);padding:4px 0 8px;border-bottom:1px solid var(--border-subtle);
        margin-bottom:4px;">${esc(cat)}</div>
    </div>` : ''}
    ${items.map(renderCard).join('')}
  `).join('');

  grid.querySelectorAll('[data-edit]').forEach(btn =>
    btn.addEventListener('click', () => showAreaModal(areas.find(a => a.id === btn.dataset.edit), areas)));
  grid.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => handleDeleteArea(btn.dataset.delete, areas.find(a => a.id === btn.dataset.delete)?.name)));
}

function showAreaModal(area, areas = []) {
  const modal = document.getElementById('area-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  modal.style.cssText = `display:flex;position:fixed;inset:0;background:rgba(0,0,0,.6);
    z-index:1000;align-items:center;justify-content:center;padding:20px;`;

  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:520px;padding:28px;max-height:90vh;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h3 style="margin:0;font-size:1rem;">${area ? 'Editar Área' : 'Nova Área'}</h3>
        <button id="area-modal-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);">✕</button>
      </div>

      <div style="display:flex;flex-direction:column;gap:14px;">
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">
            Nome da Área *
          </label>
          <input type="text" id="area-name" class="filter-select" style="width:100%;"
            placeholder="Ex: BTG Partners" value="${esc(area?.name || '')}">
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">
            Categoria <span style="font-weight:400;color:var(--text-muted);">(agrupa áreas)</span>
          </label>
          <input type="text" id="area-category" class="filter-select" style="width:100%;"
            placeholder="Ex: ICs, BTG, Bradesco…" value="${esc(area?.category || '')}"
            list="area-category-list">
          <datalist id="area-category-list">
            ${[...new Set(areas.map(a => a.category).filter(Boolean))].map(c =>
              `<option value="${esc(c)}">`).join('')}
          </datalist>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
            Deixe vazio para área independente. Áreas da mesma categoria são agrupadas no portal.
          </div>
        </div>
        <!-- Logo principal (capa do PDF, fundo escuro) -->
        ${logoBlock({
          slot: 'main',
          label: 'Logo principal',
          hint:  'Aparece na CAPA do PDF (fundo escuro). Logos brancos/claros funcionam bem aqui.',
          previewBg: '#1F2937',
          currentUrl: area?.logoUrl,
        })}
        <!-- Logo secundário (rodapé do PDF, fundo claro) — opcional -->
        ${logoBlock({
          slot: 'alt',
          label: 'Logo p/ fundo claro (rodapé) — opcional',
          hint:  'Use se o logo principal for branco/claro. Aparece no RODAPÉ (fundo claro). Se não enviar, usamos o principal.',
          previewBg: '#FFFFFF',
          currentUrl: area?.logoUrlAlt,
        })}
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">
            Paleta de cores
          </label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            ${colorPickerWithHex('primary',   'Cor primária',   area?.colors?.primary   || '#475569')}
            ${colorPickerWithHex('secondary', 'Cor secundária', area?.colors?.secondary || '#1F2937')}
          </div>
          <div style="font-size:0.6875rem;color:var(--text-muted);margin-top:4px;">
            Cole o código hex (ex: <code>#475569</code>) ou use o seletor visual.
          </div>
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">
            Descrição (opcional)
          </label>
          <textarea id="area-desc" class="filter-select" style="width:100%;height:72px;resize:vertical;"
            placeholder="Breve descrição da área...">${esc(area?.description || '')}</textarea>
        </div>
      </div>

      <div style="display:flex;gap:8px;margin-top:20px;">
        <button class="btn btn-secondary" id="area-modal-cancel" style="flex:1;">Cancelar</button>
        <button class="btn btn-primary" id="area-modal-save" style="flex:2;">
          ${area ? 'Salvar Alterações' : 'Criar Área'}
        </button>
      </div>
    </div>
  `;

  // slugify simples para nome de arquivo previsível
  const slugForFile = (s) => String(s || 'logo').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'logo';

  // ── Wire-up genérico de slot de logo (main e alt) ──────────────
  const setupLogoSlot = (slot, previewBg) => {
    const drop      = document.getElementById(`area-logo-${slot}-drop`);
    const fileInput = document.getElementById(`area-logo-${slot}-file`);
    const progress  = document.getElementById(`area-logo-${slot}-progress`);
    const dropLabel = document.getElementById(`area-logo-${slot}-label`);
    const urlInput  = document.getElementById(`area-logo-${slot}`);
    const preview   = document.getElementById(`area-logo-${slot}-preview`);

    const setDropHover = (on) => {
      if (!drop) return;
      drop.style.borderColor = on ? 'var(--brand-blue, #3B82F6)' : 'var(--border-default)';
      drop.style.background  = on ? 'rgba(59,130,246,0.05)'      : 'var(--bg-surface)';
    };

    const renderPreview = (url) => {
      if (!preview) return;
      preview.innerHTML = url ? `<img src="${esc(url)}" style="max-height:60px;object-fit:contain;
        padding:6px 10px;background:${previewBg};border-radius:var(--radius-sm);
        border:1px solid var(--border-subtle);" onerror="this.style.display='none'">` : '';
    };

    urlInput?.addEventListener('input', e => renderPreview(e.target.value));

    const handleFile = async (file) => {
      if (!file) return;
      if (!file.type.startsWith('image/')) { toast.error('Selecione um arquivo de imagem.'); return; }
      if (file.size > 5 * 1024 * 1024)     { toast.error('Arquivo maior que 5MB. Reduza antes de enviar.'); return; }
      progress.style.display = 'block';
      progress.style.color   = 'var(--text-muted)';
      progress.textContent   = 'Convertendo para WebP…';
      try {
        const { blob } = await convertToWebp(file, 0.95);
        progress.textContent = 'Enviando para Cloudflare R2…';
        const areaSlug = slugForFile(document.getElementById('area-name')?.value || area?.name);
        const path     = `logos/${areaSlug}-${slot}-${Date.now()}.webp`;
        const url      = await uploadImageToR2(blob, path);
        if (urlInput) urlInput.value = url;
        renderPreview(url);
        progress.textContent = '✓ Upload concluído. Salve a área para confirmar.';
        progress.style.color = '#16A34A';
        if (dropLabel) dropLabel.textContent = '📁 Trocar (clique ou arraste)';
      } catch (e) {
        console.error(`[portalAreas] upload logo ${slot}:`, e);
        progress.textContent = '✗ Falha no upload: ' + (e?.message || e);
        progress.style.color = '#EF4444';
      }
    };

    drop?.addEventListener('click', () => fileInput?.click());
    drop?.addEventListener('dragover',  (e) => { e.preventDefault(); setDropHover(true);  });
    drop?.addEventListener('dragleave', (e) => { e.preventDefault(); setDropHover(false); });
    drop?.addEventListener('drop', (e) => {
      e.preventDefault(); setDropHover(false);
      const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f);
    });
    fileInput?.addEventListener('change', (e) => handleFile(e.target.files?.[0]));
  };
  setupLogoSlot('main', '#1F2937');   // capa (fundo escuro)
  setupLogoSlot('alt',  '#FFFFFF');   // rodapé (fundo claro) — opcional

  // ── Color picker ↔ hex input bidirecional ──────────────────────
  const wireColor = (field) => {
    const picker = document.getElementById(`area-color-${field}`);
    const hex    = document.getElementById(`area-color-${field}-hex`);
    if (!picker || !hex) return;
    const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
    picker.addEventListener('input', () => { hex.value = picker.value.toUpperCase(); });
    hex.addEventListener('input', () => {
      let v = hex.value.trim();
      if (!v.startsWith('#')) v = '#' + v;
      if (HEX_RE.test(v)) {
        picker.value = v.toLowerCase();
        hex.style.borderColor = 'var(--border-subtle)';
      } else {
        hex.style.borderColor = '#EF4444';
      }
    });
  };
  wireColor('primary');
  wireColor('secondary');

  const close = () => { modal.style.display = 'none'; modal.innerHTML = ''; };
  document.getElementById('area-modal-close')?.addEventListener('click', close);
  document.getElementById('area-modal-cancel')?.addEventListener('click', close);

  document.getElementById('area-modal-save')?.addEventListener('click', async () => {
    const name = document.getElementById('area-name')?.value?.trim();
    if (!name) { toast.error('Nome obrigatório.'); return; }
    const btn = document.getElementById('area-modal-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
    try {
      await saveArea(area?.id || null, {
        name,
        category:    document.getElementById('area-category')?.value?.trim() || '',
        logoUrl:     document.getElementById('area-logo-main')?.value?.trim() || null,
        logoUrlAlt:  document.getElementById('area-logo-alt')?.value?.trim()  || null,
        description: document.getElementById('area-desc')?.value?.trim() || '',
        colors: {
          primary:   document.getElementById('area-color-primary')?.value,
          secondary: document.getElementById('area-color-secondary')?.value,
        },
      });
      toast.success(`Área "${name}" ${area ? 'atualizada' : 'criada'}.`);
      close();
      await loadAreas();
    } catch(e) {
      toast.error('Erro: ' + e.message);
      if (btn) { btn.disabled = false; btn.textContent = area ? 'Salvar Alterações' : 'Criar Área'; }
    }
  });
}

async function handleDeleteArea(id, name) {
  if (!confirm(`Excluir a área "${name}"? Esta ação não pode ser desfeita.`)) return;
  try {
    await deleteArea(id);
    toast.success('Área excluída.');
    await loadAreas();
  } catch(e) { toast.error('Erro: ' + e.message); }
}
