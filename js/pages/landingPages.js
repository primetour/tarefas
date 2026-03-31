/**
 * PRIMETOUR — Landing Pages
 * Lista, gestão e criação de landing pages de campanha
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import {
  fetchLandingPages, deleteLandingPage, publishLandingPage,
  unpublishLandingPage, LP_LAYOUTS, LP_SECTION_TYPES, FIELD_LABELS,
  fetchLandingPage, saveLandingPage, isSlugAvailable, slugify,
} from '../services/landingPages.js';
import { fetchImages, fetchTips } from '../services/portal.js';

const esc = s => String(s||'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = ts => ts?.toDate ? ts.toDate().toLocaleDateString('pt-BR') : '—';

/* ─── Caches for pickers ──────────────────────────────────── */
let _imagesCache = null;
let _tipsCache   = null;

async function getImagesCache() {
  if (!_imagesCache) _imagesCache = await fetchImages().catch(() => []);
  return _imagesCache;
}
async function getTipsCache() {
  if (!_tipsCache) _tipsCache = await fetchTips().catch(() => []);
  return _tipsCache;
}

/* ─── URL helper ──────────────────────────────────────────── */
function getLpBaseUrl() {
  return window.location.origin +
    window.location.pathname.replace(/index\.html$/, '') + 'lp.html#';
}

/* ════════════════════════════════════════════════════════════
   Entry point
   ════════════════════════════════════════════════════════════ */
export async function renderLandingPages(container) {
  if (!store.canManagePortal()) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div></div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Landing Pages</h1>
        <p class="page-subtitle">Páginas de campanha com link público compartilhável</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary" id="lp-new-btn">+ Nova Landing Page</button>
      </div>
    </div>
    <div id="lp-list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));
      gap:16px;"></div>`;

  document.getElementById('lp-new-btn')?.addEventListener('click', () => showLayoutPicker(container));
  await loadList(container);
}

/* ════════════════════════════════════════════════════════════
   List view
   ════════════════════════════════════════════════════════════ */
async function loadList(container) {
  const listEl = document.getElementById('lp-list');
  if (!listEl) return;
  listEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;
    color:var(--text-muted);">Carregando…</div>`;

  const pages = await fetchLandingPages().catch(() => []);
  if (!pages.length) {
    listEl.innerHTML = `<div style="grid-column:1/-1;" class="empty-state">
      <div class="empty-state-icon">◱</div>
      <div class="empty-state-title">Nenhuma landing page ainda</div>
      <div class="empty-state-subtitle">Clique em "+ Nova Landing Page" para criar a primeira</div>
    </div>`;
    return;
  }

  const baseUrl = getLpBaseUrl();

  listEl.innerHTML = pages.map(page => {
    const layout = LP_LAYOUTS.find(l => l.key === page.layout) || LP_LAYOUTS[0];
    const isPublished = page.status === 'published';
    const publicUrl = baseUrl + (page.slug || page.token);
    return `
    <div class="card" style="padding:0;overflow:hidden;display:flex;flex-direction:column;">
      <div style="height:6px;background:${isPublished?'var(--brand-gold)':'var(--border-subtle)'};"></div>
      <div style="padding:20px 20px 14px;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:1rem;margin-bottom:4px;
              overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${esc(page.name||'Sem título')}
            </div>
            <div style="font-size:0.75rem;color:var(--text-muted);">
              ${esc(layout.label)} · ${fmt(page.updatedAt)}
            </div>
          </div>
          <span style="padding:3px 10px;border-radius:var(--radius-full);font-size:0.6875rem;
            font-weight:600;flex-shrink:0;
            background:${isPublished?'#22C55E18':'var(--bg-surface)'};
            color:${isPublished?'#22C55E':'var(--text-muted)'};
            border:1px solid ${isPublished?'#22C55E40':'var(--border-subtle)'};">
            ${isPublished?'Publicada':'Rascunho'}
          </span>
        </div>
        ${page.slug ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:6px;
          font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          /${esc(page.slug)}</div>` : ''}
        ${page.description ? `<p style="font-size:0.8125rem;color:var(--text-muted);
          line-height:1.5;margin-bottom:10px;">${esc(page.description.slice(0,80))}${page.description.length>80?'…':''}</p>` : ''}
        <div style="font-size:0.75rem;color:var(--text-muted);">
          ${(page.sections||[]).length} seção(ões)
          ${page.views ? ` · ${page.views} visualizações` : ''}
        </div>
      </div>
      <div style="padding:12px 20px;border-top:1px solid var(--border-subtle);
        display:flex;gap:8px;margin-top:auto;">
        <button class="btn btn-primary btn-sm lp-edit-btn" data-id="${esc(page.id)}"
          style="flex:1;">✎ Editar</button>
        ${isPublished ? `
          <a href="${esc(publicUrl)}" target="_blank" class="btn btn-ghost btn-sm"
            style="font-size:0.75rem;text-decoration:none;">🔗 Abrir</a>
          <button class="btn btn-ghost btn-sm lp-unpublish-btn" data-id="${esc(page.id)}"
            style="font-size:0.75rem;color:var(--text-muted);">Despublicar</button>
        ` : `
          <button class="btn btn-secondary btn-sm lp-publish-btn" data-id="${esc(page.id)}"
            style="font-size:0.75rem;">Publicar</button>
        `}
        <button class="btn btn-ghost btn-sm lp-delete-btn" data-id="${esc(page.id)}"
          data-name="${esc(page.name||'')}"
          style="font-size:0.75rem;color:#EF4444;">✕</button>
      </div>
    </div>`;
  }).join('');

  listEl.querySelectorAll('.lp-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => showBuilder(container, btn.dataset.id));
  });
  listEl.querySelectorAll('.lp-publish-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await publishLandingPage(btn.dataset.id);
      toast.success('Publicada!'); await loadList(container);
    });
  });
  listEl.querySelectorAll('.lp-unpublish-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await unpublishLandingPage(btn.dataset.id);
      toast.success('Movida para rascunho.'); await loadList(container);
    });
  });
  listEl.querySelectorAll('.lp-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Excluir "${btn.dataset.name}"? O link será desativado.`)) return;
      await deleteLandingPage(btn.dataset.id);
      toast.success('Excluída.'); await loadList(container);
    });
  });
}

/* ════════════════════════════════════════════════════════════
   Layout picker
   ════════════════════════════════════════════════════════════ */
function showLayoutPicker(container) {
  const modal = document.createElement('div');
  modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2000;
    display:flex;align-items:center;justify-content:center;padding:20px;`;
  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:680px;max-height:88vh;
      padding:0;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:20px 24px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div>
          <div style="font-weight:700;font-size:1rem;">Escolha o layout</div>
          <div style="font-size:0.8125rem;color:var(--text-muted);">
            Cada layout tem seções pré-configuradas para o seu tipo de campanha
          </div>
        </div>
        <button id="lp-layout-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);">✕</button>
      </div>
      <div style="padding:20px 24px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:12px;">
        ${LP_LAYOUTS.map(l => `
          <button class="lp-layout-pick" data-layout="${esc(l.key)}"
            style="text-align:left;padding:18px 20px;background:var(--bg-surface);
            border:2px solid var(--border-subtle);border-radius:var(--radius-md);
            cursor:pointer;transition:all .2s;width:100%;">
            <div style="font-weight:700;font-size:0.9375rem;margin-bottom:4px;">
              ${esc(l.label)}
            </div>
            <div style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:8px;">
              ${esc(l.desc)}
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:5px;">
              ${l.sections.map(s => `<span style="padding:2px 8px;background:var(--brand-gold)12;
                color:var(--brand-gold);border-radius:20px;font-size:0.625rem;font-weight:600;">
                ${esc(s.replace(/_/g,' '))}</span>`).join('')}
            </div>
          </button>`).join('')}
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('lp-layout-close')?.addEventListener('click', () => modal.remove());

  modal.querySelectorAll('.lp-layout-pick').forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      btn.style.borderColor = 'var(--brand-gold)';
      btn.style.background  = 'var(--brand-gold)06';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.borderColor = 'var(--border-subtle)';
      btn.style.background  = 'var(--bg-surface)';
    });
    btn.addEventListener('click', () => {
      modal.remove();
      showBuilder(container, null, btn.dataset.layout);
    });
  });
}

/* ════════════════════════════════════════════════════════════
   Builder (main editor)
   ════════════════════════════════════════════════════════════ */
async function showBuilder(container, pageId, layoutKey) {
  let page = pageId ? await fetchLandingPage(pageId) : null;
  const layout = LP_LAYOUTS.find(l => l.key === (page?.layout || layoutKey)) || LP_LAYOUTS[0];

  if (!page) {
    page = {
      name: '',
      description: '',
      layout: layout.key,
      slug: '',
      sections: layout.sections.map(key => ({
        type: key,
        id:   Math.random().toString(36).slice(2),
        data: {},
      })),
      colors: { primary: '#D4AF37', secondary: '#242362' },
      status: 'draft',
    };
  }

  const modal = document.createElement('div');
  modal.id    = 'lp-builder';
  modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:2000;
    display:flex;align-items:stretch;justify-content:center;`;

  modal.innerHTML = `
    <div style="width:100%;max-width:1100px;display:flex;flex-direction:column;
      background:var(--bg-dark);overflow:hidden;">

      <!-- Header -->
      <div style="padding:12px 20px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;gap:12px;flex-shrink:0;flex-wrap:wrap;">
        <button id="lpb-close" style="border:none;background:none;cursor:pointer;
          font-size:1.125rem;color:var(--text-muted);">←</button>
        <div style="flex:1;min-width:200px;">
          <input id="lpb-name" type="text" class="portal-field"
            value="${esc(page.name)}"
            placeholder="Nome da landing page…"
            style="font-weight:700;font-size:1rem;border:none;background:transparent;
              padding:0;width:100%;color:var(--text-primary);">
        </div>
        <span style="font-size:0.75rem;padding:3px 10px;background:var(--brand-gold)12;
          color:var(--brand-gold);border-radius:var(--radius-full);font-weight:600;flex-shrink:0;">
          ${esc(layout.label)}
        </span>
        <button id="lpb-preview" class="btn btn-secondary btn-sm">👁 Preview</button>
        <button id="lpb-save" class="btn btn-primary btn-sm">💾 Salvar</button>
      </div>

      <!-- Slug bar -->
      <div style="padding:8px 20px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;gap:8px;font-size:0.8125rem;">
        <span style="color:var(--text-muted);flex-shrink:0;">🔗 Link:</span>
        <span style="color:var(--text-muted);flex-shrink:0;font-size:0.75rem;">${esc(getLpBaseUrl())}</span>
        <input id="lpb-slug" type="text" class="portal-field"
          value="${esc(page.slug || '')}"
          placeholder="slug-da-pagina"
          style="flex:1;font-size:0.8125rem;font-family:monospace;padding:4px 8px;
            border:1px solid var(--border-subtle);border-radius:var(--radius-sm);
            background:var(--bg-dark);color:var(--text-primary);">
        <span id="lpb-slug-status" style="font-size:0.75rem;color:var(--text-muted);flex-shrink:0;"></span>
      </div>

      <!-- Body: sections left, editor right -->
      <div style="display:grid;grid-template-columns:260px 1fr;flex:1;overflow:hidden;min-height:0;">

        <!-- Section list -->
        <div style="background:var(--bg-surface);border-right:1px solid var(--border-subtle);
          overflow-y:auto;display:flex;flex-direction:column;">
          <div style="padding:14px 16px;font-size:0.625rem;font-weight:700;text-transform:uppercase;
            letter-spacing:.1em;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">
            Seções (<span id="lpb-sec-count">${page.sections.length}</span>)
          </div>
          <div id="lpb-section-list" style="flex:1;overflow-y:auto;padding:8px 0;"></div>
          <div style="padding:12px 16px;border-top:1px solid var(--border-subtle);">
            <button id="lpb-add-section" class="btn btn-secondary btn-sm" style="width:100%;font-size:0.8125rem;">
              + Adicionar seção
            </button>
          </div>
        </div>

        <!-- Section editor -->
        <div id="lpb-section-editor" style="overflow-y:auto;padding:24px;"></div>
      </div>
    </div>`;

  document.body.appendChild(modal);

  let activeSectionId = page.sections[0]?.id || null;
  let dirty = false;
  let saving = false;

  const markDirty = () => {
    dirty = true;
    const btn = document.getElementById('lpb-save');
    if (btn && !saving) btn.textContent = '💾 Salvar*';
  };

  /* ── Slug auto-generate + validation ────────────────────── */
  const slugInput = document.getElementById('lpb-slug');
  const nameInput = document.getElementById('lpb-name');
  let slugManuallyEdited = !!(page.slug);

  nameInput?.addEventListener('input', () => {
    if (!slugManuallyEdited) {
      const auto = slugify(nameInput.value || '');
      if (slugInput) slugInput.value = auto;
      page.slug = auto;
    }
    markDirty();
  });

  let slugCheckTimeout;
  slugInput?.addEventListener('input', () => {
    slugManuallyEdited = true;
    const raw = slugInput.value;
    page.slug = slugify(raw);
    slugInput.value = page.slug;
    markDirty();
    // Validate uniqueness after debounce
    clearTimeout(slugCheckTimeout);
    const statusEl = document.getElementById('lpb-slug-status');
    if (statusEl) statusEl.textContent = '…';
    slugCheckTimeout = setTimeout(async () => {
      if (!page.slug) return;
      const available = await isSlugAvailable(page.slug, page.id).catch(() => true);
      if (statusEl) {
        statusEl.textContent = available ? '✓ disponível' : '✗ em uso';
        statusEl.style.color = available ? '#22C55E' : '#EF4444';
      }
    }, 500);
  });

  /* ── Section list ───────────────────────────────────────── */
  const renderSectionList = () => {
    const listEl = document.getElementById('lpb-section-list');
    if (!listEl) return;
    const countEl = document.getElementById('lpb-sec-count');
    if (countEl) countEl.textContent = page.sections.length;

    listEl.innerHTML = page.sections.map((sec, idx) => {
      const typeDef = LP_SECTION_TYPES[sec.type] || { label: sec.type };
      const isActive = sec.id === activeSectionId;
      return `<div class="lpb-sec-item" data-id="${esc(sec.id)}"
        style="display:flex;align-items:center;gap:8px;padding:10px 16px;cursor:pointer;
        background:${isActive?'var(--brand-gold)10':'transparent'};
        border-left:3px solid ${isActive?'var(--brand-gold)':'transparent'};
        transition:all .15s;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.8125rem;font-weight:600;color:${isActive?'var(--brand-gold)':'var(--text-primary)'};
            overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${esc(typeDef.label)}
          </div>
          ${sec.data?.title || sec.data?.headline ? `
          <div style="font-size:0.75rem;color:var(--text-muted);
            overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${esc((sec.data.title||sec.data.headline||'').slice(0,30))}
          </div>` : ''}
        </div>
        <div style="display:flex;gap:2px;flex-shrink:0;">
          ${idx > 0 ? `<button class="lpb-sec-up btn btn-ghost" data-id="${esc(sec.id)}"
            style="padding:2px 5px;font-size:0.75rem;color:var(--text-muted);">↑</button>` : ''}
          ${idx < page.sections.length-1 ? `<button class="lpb-sec-down btn btn-ghost" data-id="${esc(sec.id)}"
            style="padding:2px 5px;font-size:0.75rem;color:var(--text-muted);">↓</button>` : ''}
          <button class="lpb-sec-del btn btn-ghost" data-id="${esc(sec.id)}"
            style="padding:2px 5px;font-size:0.75rem;color:#EF4444;">✕</button>
        </div>
      </div>`;
    }).join('');

    listEl.querySelectorAll('.lpb-sec-item').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        activeSectionId = el.dataset.id;
        renderSectionList();
        renderSectionEditor();
      });
    });
    listEl.querySelectorAll('.lpb-sec-up').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation();
        const idx = page.sections.findIndex(s => s.id === btn.dataset.id);
        if (idx > 0) {
          [page.sections[idx-1], page.sections[idx]] = [page.sections[idx], page.sections[idx-1]];
          renderSectionList(); markDirty();
        }
      });
    });
    listEl.querySelectorAll('.lpb-sec-down').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation();
        const idx = page.sections.findIndex(s => s.id === btn.dataset.id);
        if (idx < page.sections.length-1) {
          [page.sections[idx], page.sections[idx+1]] = [page.sections[idx+1], page.sections[idx]];
          renderSectionList(); markDirty();
        }
      });
    });
    listEl.querySelectorAll('.lpb-sec-del').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation();
        page.sections = page.sections.filter(s => s.id !== btn.dataset.id);
        if (activeSectionId === btn.dataset.id) activeSectionId = page.sections[0]?.id || null;
        renderSectionList(); renderSectionEditor(); markDirty();
      });
    });
  };

  /* ── Section editor ─────────────────────────────────────── */
  const renderSectionEditor = () => {
    const editorEl = document.getElementById('lpb-section-editor');
    if (!editorEl) return;
    const sec = page.sections.find(s => s.id === activeSectionId);
    if (!sec) {
      editorEl.innerHTML = `<div style="color:var(--text-muted);text-align:center;padding:40px;">
        Selecione uma seção para editar</div>`;
      return;
    }
    const typeDef = LP_SECTION_TYPES[sec.type] || { label: sec.type, fields: [] };

    editorEl.innerHTML = `
      <div style="max-width:640px;">
        <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;
          letter-spacing:.1em;color:var(--brand-gold);margin-bottom:20px;">
          ${esc(typeDef.label)}
        </div>
        ${renderSectionFields(sec, typeDef)}
      </div>`;

    wireSectionFields(sec, editorEl, markDirty, renderSectionEditor);
  };

  renderSectionList();
  renderSectionEditor();

  /* ── Add section ────────────────────────────────────────── */
  document.getElementById('lpb-add-section')?.addEventListener('click', () => {
    showSectionTypePicker(sec => {
      page.sections.push(sec);
      activeSectionId = sec.id;
      renderSectionList();
      renderSectionEditor();
      markDirty();
    });
  });

  /* ── Save ───────────────────────────────────────────────── */
  document.getElementById('lpb-save')?.addEventListener('click', async () => {
    if (saving) return; // Prevent double-click
    const btn = document.getElementById('lpb-save');
    saving = true;
    btn.disabled = true;
    btn.textContent = '⏳ Salvando…';
    page.name = nameInput?.value?.trim() || 'Sem título';
    if (!page.slug) page.slug = slugify(page.name);
    try {
      const result = await saveLandingPage(page.id || null, page);
      page.id    = result.id;
      page.token = result.token;
      page.slug  = result.slug;
      dirty = false;
      btn.textContent = '💾 Salvar';
      // Update slug input to reflect saved value
      if (slugInput) slugInput.value = page.slug;
      toast.success('Salvo!');
    } catch(e) {
      toast.error('Erro ao salvar: ' + e.message);
    } finally {
      saving = false;
      btn.disabled = false;
    }
  });

  /* ── Preview (works for drafts too) ─────────────────────── */
  document.getElementById('lpb-preview')?.addEventListener('click', async () => {
    if (!page.id) {
      // Auto-save first
      const btn = document.getElementById('lpb-save');
      btn?.click();
      // Wait a moment for save to complete
      await new Promise(r => setTimeout(r, 1500));
      if (!page.token) {
        toast.error('Salve a página antes de visualizar.');
        return;
      }
    }
    const url = getLpBaseUrl() + (page.slug || page.token);
    window.open(url, '_blank');
  });

  /* ── Close ──────────────────────────────────────────────── */
  document.getElementById('lpb-close')?.addEventListener('click', () => {
    if (dirty && !confirm('Há alterações não salvas. Sair mesmo assim?')) return;
    modal.remove();
    loadList(container);
  });
}

/* ════════════════════════════════════════════════════════════
   Section field renderer
   ════════════════════════════════════════════════════════════ */
function renderSectionFields(sec, typeDef) {
  const fields = typeDef.fields || [];
  const data   = sec.data || {};
  const LBL = `font-size:0.75rem;font-weight:600;display:block;margin-bottom:6px;color:var(--text-muted);`;

  return fields.map(field => {
    const label    = FIELD_LABELS[field] || field.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
    const isTextarea = field === 'body' || field === 'caption';
    const isImg      = field === 'bg_image';
    const isImages   = field === 'images';
    const isTipId    = field === 'tip_id';
    const isSpecial  = ['items','steps','destinations','show_fields','captions','target_date'].includes(field);

    // ── Image field with picker ──
    if (isImg) return `
      <div style="margin-bottom:16px;">
        <label style="${LBL}">${esc(label)}</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="text" class="portal-field sec-field" data-field="${field}"
            value="${esc(data[field]||'')}" placeholder="URL da imagem…"
            style="flex:1;font-size:0.875rem;">
          <button class="btn btn-secondary btn-sm lp-pick-image" data-field="${field}"
            style="flex-shrink:0;font-size:0.75rem;" title="Escolher do Banco de Imagens">
            🖼️ Banco
          </button>
        </div>
        ${data[field] ? `<img src="${esc(data[field])}" style="width:100%;max-height:180px;
          object-fit:cover;border-radius:var(--radius-sm);margin-top:8px;">` : ''}
      </div>`;

    // ── Images array with picker ──
    if (isImages) return `
      <div style="margin-bottom:16px;padding:14px;background:var(--bg-surface);
        border-radius:var(--radius-md);border:1px solid var(--border-subtle);">
        <label style="${LBL}">${esc(label)}</label>
        <div id="lp-images-preview-${esc(sec.id)}" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
          ${(Array.isArray(data.images) ? data.images : []).map((url, i) => `
            <div style="position:relative;width:80px;height:60px;border-radius:var(--radius-sm);overflow:hidden;">
              <img src="${esc(url)}" style="width:100%;height:100%;object-fit:cover;">
              <button class="lp-remove-img" data-idx="${i}"
                style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,.7);color:#fff;
                border:none;cursor:pointer;width:18px;height:18px;border-radius:50%;font-size:0.625rem;
                display:flex;align-items:center;justify-content:center;">✕</button>
            </div>`).join('')}
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-secondary btn-sm lp-pick-images" data-field="images"
            style="font-size:0.75rem;">🖼️ Adicionar do Banco</button>
          <input type="text" class="portal-field lp-img-url-input" data-field="images"
            placeholder="…ou cole uma URL" style="flex:1;font-size:0.8125rem;">
          <button class="btn btn-ghost btn-sm lp-add-img-url" data-field="images"
            style="font-size:0.75rem;">+</button>
        </div>
      </div>`;

    // ── Tip picker ──
    if (isTipId) return `
      <div style="margin-bottom:16px;">
        <label style="${LBL}">${esc(label)}</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="text" class="portal-field sec-field" data-field="${field}"
            value="${esc(data[field]||'')}" placeholder="ID da dica…"
            style="flex:1;font-size:0.875rem;" readonly>
          <button class="btn btn-secondary btn-sm lp-pick-tip" data-field="${field}"
            style="flex-shrink:0;font-size:0.75rem;">
            📋 Buscar dica
          </button>
        </div>
        ${data[field] ? `<div id="lp-tip-preview-${esc(sec.id)}" style="margin-top:8px;
          font-size:0.8125rem;color:var(--text-muted);"></div>` : ''}
      </div>`;

    // ── Body/text with "consult tips" button ──
    if (isTextarea) return `
      <div style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <label style="font-size:0.75rem;font-weight:600;color:var(--text-muted);">${esc(label)}</label>
          ${field === 'body' ? `<button class="btn btn-ghost btn-sm lp-consult-tips"
            style="font-size:0.6875rem;color:var(--brand-gold);">📋 Consultar dicas</button>` : ''}
        </div>
        <textarea class="portal-field sec-field" data-field="${field}" rows="5"
          style="width:100%;font-size:0.875rem;">${esc(data[field]||'')}</textarea>
      </div>`;

    // ── Special fields (JSON) ──
    if (isSpecial) return `
      <div style="margin-bottom:16px;padding:14px;background:var(--bg-surface);
        border-radius:var(--radius-md);border:1px solid var(--border-subtle);">
        <label style="${LBL}">${esc(label)}</label>
        <div style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:8px;">
          Configuração via JSON — cole ou edite abaixo.
        </div>
        <textarea class="portal-field sec-field" data-field="${field}" rows="5"
          style="width:100%;font-size:0.75rem;font-family:monospace;"
          placeholder='[]'>${esc(JSON.stringify(data[field]||[], null, 2))}</textarea>
      </div>`;

    // ── Align selector ──
    if (field === 'align') return `
      <div style="margin-bottom:16px;">
        <label style="${LBL}">${esc(label)}</label>
        <select class="portal-field sec-field" data-field="${field}" style="width:100%;font-size:0.875rem;">
          <option value="left" ${data[field]==='left'?'selected':''}>Esquerda</option>
          <option value="center" ${data[field]==='center'||!data[field]?'selected':''}>Centro</option>
          <option value="right" ${data[field]==='right'?'selected':''}>Direita</option>
        </select>
      </div>`;

    // ── Overlay opacity ──
    if (field === 'overlay_opacity') return `
      <div style="margin-bottom:16px;">
        <label style="${LBL}">${esc(label)}: <span id="lp-opacity-val">${data[field] || '0.5'}</span></label>
        <input type="range" class="sec-field" data-field="${field}"
          min="0" max="1" step="0.05" value="${data[field] || '0.5'}"
          style="width:100%;">
      </div>`;

    // ── Default text input ──
    return `
      <div style="margin-bottom:16px;">
        <label style="${LBL}">${esc(label)}</label>
        <input type="text" class="portal-field sec-field" data-field="${field}"
          value="${esc(data[field]||'')}" style="width:100%;font-size:0.875rem;">
      </div>`;
  }).join('');
}

/* ════════════════════════════════════════════════════════════
   Wire section field events
   ════════════════════════════════════════════════════════════ */
function wireSectionFields(sec, editorEl, markDirty, reRender) {
  // Standard field listeners
  editorEl.querySelectorAll('.sec-field').forEach(el => {
    const evt = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evt, () => {
      const field = el.dataset.field;
      let val = el.value;
      // Opacity display
      if (field === 'overlay_opacity') {
        const display = document.getElementById('lp-opacity-val');
        if (display) display.textContent = val;
      }
      // Try parse JSON for textarea array fields
      if (el.tagName === 'TEXTAREA' && val.trim().startsWith('[')) {
        try { val = JSON.parse(val); } catch { /* keep string */ }
      }
      if (el.tagName === 'TEXTAREA' && val.trim().startsWith('{')) {
        try { val = JSON.parse(val); } catch { /* keep string */ }
      }
      sec.data[field] = val;
      markDirty();
    });
  });

  // ── Image picker (single) ──
  editorEl.querySelectorAll('.lp-pick-image').forEach(btn => {
    btn.addEventListener('click', async () => {
      const field = btn.dataset.field;
      const url = await showImagePicker();
      if (url) {
        sec.data[field] = url;
        markDirty();
        reRender();
      }
    });
  });

  // ── Images picker (multiple) ──
  editorEl.querySelectorAll('.lp-pick-images').forEach(btn => {
    btn.addEventListener('click', async () => {
      const url = await showImagePicker();
      if (url) {
        if (!Array.isArray(sec.data.images)) sec.data.images = [];
        sec.data.images.push(url);
        markDirty();
        reRender();
      }
    });
  });

  // ── Add image URL manually ──
  editorEl.querySelectorAll('.lp-add-img-url').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = editorEl.querySelector('.lp-img-url-input');
      const url = input?.value?.trim();
      if (!url) return;
      if (!Array.isArray(sec.data.images)) sec.data.images = [];
      sec.data.images.push(url);
      input.value = '';
      markDirty();
      reRender();
    });
  });

  // ── Remove image from array ──
  editorEl.querySelectorAll('.lp-remove-img').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      if (Array.isArray(sec.data.images)) {
        sec.data.images.splice(idx, 1);
        markDirty();
        reRender();
      }
    });
  });

  // ── Tip picker ──
  editorEl.querySelectorAll('.lp-pick-tip').forEach(btn => {
    btn.addEventListener('click', async () => {
      const field = btn.dataset.field;
      const tip = await showTipPicker();
      if (tip) {
        sec.data[field] = tip.id;
        markDirty();
        reRender();
      }
    });
  });

  // ── Consult tips (insert content into body) ──
  editorEl.querySelectorAll('.lp-consult-tips').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tip = await showTipPicker();
      if (tip) {
        // Build text from tip segments
        let text = '';
        if (tip.title) text += tip.title + '\n\n';
        if (tip.city) text += tip.city;
        if (tip.country && tip.country !== tip.city) text += ', ' + tip.country;
        if (tip.continent) text += ' — ' + tip.continent;
        text += '\n\n';
        // Include segment content if available
        const segments = tip.segments;
        if (segments && typeof segments === 'object') {
          const segKeys = Array.isArray(segments) ? segments : Object.keys(segments);
          segKeys.forEach(key => {
            const val = typeof segments === 'object' && !Array.isArray(segments) ? segments[key] : null;
            const segLabel = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            text += `— ${segLabel} —\n`;
            if (typeof val === 'string') text += val + '\n';
            else if (Array.isArray(val)) text += val.map(v => typeof v === 'string' ? v : (v.name || v.title || JSON.stringify(v))).join('\n') + '\n';
            text += '\n';
          });
        }
        // Append to existing body
        const bodyField = editorEl.querySelector('textarea[data-field="body"]');
        if (bodyField) {
          bodyField.value = (bodyField.value ? bodyField.value + '\n\n' : '') + text.trim();
          sec.data.body = bodyField.value;
          markDirty();
        }
      }
    });
  });
}

/* ════════════════════════════════════════════════════════════
   Image Picker Modal
   ════════════════════════════════════════════════════════════ */
function showImagePicker() {
  return new Promise(async (resolve) => {
    const images = await getImagesCache();

    const modal = document.createElement('div');
    modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:3000;
      display:flex;align-items:center;justify-content:center;padding:20px;`;

    const continents = [...new Set(images.map(i => i.continent).filter(Boolean))].sort();
    const countries  = [...new Set(images.map(i => i.country).filter(Boolean))].sort();

    modal.innerHTML = `
      <div class="card" style="width:100%;max-width:800px;max-height:85vh;
        padding:0;overflow:hidden;display:flex;flex-direction:column;">
        <div style="padding:16px 20px;background:var(--bg-surface);
          border-bottom:1px solid var(--border-subtle);flex-shrink:0;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
            <div style="font-weight:700;font-size:1rem;">Banco de Imagens</div>
            <button id="img-pick-close" style="border:none;background:none;cursor:pointer;
              font-size:1.25rem;color:var(--text-muted);">✕</button>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <input type="text" id="img-pick-search" class="portal-field"
              placeholder="Buscar por nome, local, tag…"
              style="flex:1;min-width:180px;font-size:0.8125rem;">
            <select id="img-pick-continent" class="portal-field" style="font-size:0.8125rem;">
              <option value="">Todos continentes</option>
              ${continents.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
            </select>
            <select id="img-pick-country" class="portal-field" style="font-size:0.8125rem;">
              <option value="">Todos países</option>
              ${countries.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div id="img-pick-grid" style="overflow-y:auto;padding:16px;flex:1;
          display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;
          align-content:start;"></div>
      </div>`;

    document.body.appendChild(modal);

    const renderGrid = (filter = '') => {
      const grid = document.getElementById('img-pick-grid');
      if (!grid) return;
      const lower = filter.toLowerCase();
      const continent = document.getElementById('img-pick-continent')?.value || '';
      const country   = document.getElementById('img-pick-country')?.value || '';

      let filtered = images;
      if (continent) filtered = filtered.filter(i => i.continent === continent);
      if (country)   filtered = filtered.filter(i => i.country === country);
      if (lower)     filtered = filtered.filter(i =>
        (i.name||'').toLowerCase().includes(lower) ||
        (i.placeName||'').toLowerCase().includes(lower) ||
        (i.city||'').toLowerCase().includes(lower) ||
        (Array.isArray(i.tags) ? i.tags : []).join(' ').toLowerCase().includes(lower)
      );

      if (!filtered.length) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;
          color:var(--text-muted);font-size:0.8125rem;">Nenhuma imagem encontrada</div>`;
        return;
      }

      grid.innerHTML = filtered.slice(0, 60).map(img => `
        <div class="img-pick-item" data-url="${esc(img.url)}"
          style="cursor:pointer;border-radius:var(--radius-sm);overflow:hidden;
          border:2px solid transparent;transition:all .15s;aspect-ratio:4/3;">
          <img src="${esc(img.url)}" alt="${esc(img.name||'')}"
            style="width:100%;height:100%;object-fit:cover;" loading="lazy">
        </div>`).join('');

      grid.querySelectorAll('.img-pick-item').forEach(item => {
        item.addEventListener('mouseenter', () => item.style.borderColor = 'var(--brand-gold)');
        item.addEventListener('mouseleave', () => item.style.borderColor = 'transparent');
        item.addEventListener('click', () => {
          modal.remove();
          resolve(item.dataset.url);
        });
      });
    };

    renderGrid();

    document.getElementById('img-pick-search')?.addEventListener('input', e => renderGrid(e.target.value));
    document.getElementById('img-pick-continent')?.addEventListener('change', () =>
      renderGrid(document.getElementById('img-pick-search')?.value || ''));
    document.getElementById('img-pick-country')?.addEventListener('change', () =>
      renderGrid(document.getElementById('img-pick-search')?.value || ''));

    modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); resolve(null); } });
    document.getElementById('img-pick-close')?.addEventListener('click', () => { modal.remove(); resolve(null); });
  });
}

/* ════════════════════════════════════════════════════════════
   Tip Picker Modal
   ════════════════════════════════════════════════════════════ */
function showTipPicker() {
  return new Promise(async (resolve) => {
    const tips = await getTipsCache();

    const modal = document.createElement('div');
    modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:3000;
      display:flex;align-items:center;justify-content:center;padding:20px;`;

    const continents = [...new Set(tips.map(t => t.continent).filter(Boolean))].sort();

    modal.innerHTML = `
      <div class="card" style="width:100%;max-width:700px;max-height:85vh;
        padding:0;overflow:hidden;display:flex;flex-direction:column;">
        <div style="padding:16px 20px;background:var(--bg-surface);
          border-bottom:1px solid var(--border-subtle);flex-shrink:0;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
            <div style="font-weight:700;font-size:1rem;">Portal de Dicas</div>
            <button id="tip-pick-close" style="border:none;background:none;cursor:pointer;
              font-size:1.25rem;color:var(--text-muted);">✕</button>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <input type="text" id="tip-pick-search" class="portal-field"
              placeholder="Buscar por destino, país, continente…"
              style="flex:1;min-width:180px;font-size:0.8125rem;">
            <select id="tip-pick-continent" class="portal-field" style="font-size:0.8125rem;">
              <option value="">Todos continentes</option>
              ${continents.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div id="tip-pick-list" style="overflow-y:auto;padding:8px 0;flex:1;"></div>
      </div>`;

    document.body.appendChild(modal);

    const renderList = (filter = '') => {
      const listEl = document.getElementById('tip-pick-list');
      if (!listEl) return;
      const lower = filter.toLowerCase();
      const continent = document.getElementById('tip-pick-continent')?.value || '';

      let filtered = tips;
      if (continent) filtered = filtered.filter(t => t.continent === continent);
      if (lower) filtered = filtered.filter(t =>
        (t.title||'').toLowerCase().includes(lower) ||
        (t.city||'').toLowerCase().includes(lower) ||
        (t.country||'').toLowerCase().includes(lower) ||
        (t.continent||'').toLowerCase().includes(lower)
      );

      if (!filtered.length) {
        listEl.innerHTML = `<div style="text-align:center;padding:40px;
          color:var(--text-muted);font-size:0.8125rem;">Nenhuma dica encontrada</div>`;
        return;
      }

      listEl.innerHTML = filtered.slice(0, 50).map(tip => `
        <div class="tip-pick-item" data-id="${esc(tip.id)}"
          style="padding:12px 20px;cursor:pointer;border-bottom:1px solid var(--border-subtle);
          transition:background .1s;display:flex;align-items:center;gap:12px;"
          onmouseover="this.style.background='var(--bg-surface)'"
          onmouseout="this.style.background=''">
          <span style="font-size:1.25rem;">🌍</span>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:0.875rem;overflow:hidden;text-overflow:ellipsis;
              white-space:nowrap;">${esc(tip.title || tip.city || 'Sem título')}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);">
              ${esc([tip.city, tip.country, tip.continent].filter(Boolean).join(' · '))}
            </div>
          </div>
          ${tip.priority ? `<span style="font-size:0.625rem;padding:2px 8px;border-radius:10px;
            background:${tip.priority==='high'?'#EF444420':tip.priority==='medium'?'#F9731620':'#22C55E20'};
            color:${tip.priority==='high'?'#EF4444':tip.priority==='medium'?'#F97316':'#22C55E'};
            font-weight:600;">${esc(tip.priority)}</span>` : ''}
        </div>`).join('');

      listEl.querySelectorAll('.tip-pick-item').forEach(item => {
        item.addEventListener('click', () => {
          const tip = tips.find(t => t.id === item.dataset.id);
          modal.remove();
          resolve(tip || null);
        });
      });
    };

    renderList();

    document.getElementById('tip-pick-search')?.addEventListener('input', e => renderList(e.target.value));
    document.getElementById('tip-pick-continent')?.addEventListener('change', () =>
      renderList(document.getElementById('tip-pick-search')?.value || ''));

    modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); resolve(null); } });
    document.getElementById('tip-pick-close')?.addEventListener('click', () => { modal.remove(); resolve(null); });
  });
}

/* ════════════════════════════════════════════════════════════
   Section type picker
   ════════════════════════════════════════════════════════════ */
function showSectionTypePicker(onAdd) {
  const modal = document.createElement('div');
  modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:3000;
    display:flex;align-items:center;justify-content:center;padding:20px;`;
  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:500px;max-height:80vh;
      padding:0;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:16px 20px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div style="font-weight:700;">Adicionar seção</div>
        <button id="sec-pick-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);">✕</button>
      </div>
      <div style="overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:6px;">
        ${Object.entries(LP_SECTION_TYPES).map(([key, def]) => `
          <button class="sec-type-pick btn btn-ghost" data-type="${esc(key)}"
            style="text-align:left;padding:10px 14px;justify-content:flex-start;
            font-size:0.875rem;color:var(--text-primary);">
            <strong>${esc(def.label)}</strong>
            <span style="color:var(--text-muted);font-size:0.75rem;margin-left:8px;">
              ${def.fields.slice(0,3).map(f => FIELD_LABELS[f] || f).join(', ')}…
            </span>
          </button>`).join('')}
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('sec-pick-close')?.addEventListener('click', () => modal.remove());
  modal.querySelectorAll('.sec-type-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.remove();
      onAdd({ type: btn.dataset.type, id: Math.random().toString(36).slice(2), data: {} });
    });
  });
}
