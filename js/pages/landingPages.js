/**
 * PRIMETOUR — Landing Pages
 * Lista, gestão e criação de landing pages de campanha
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { fetchImages } from '../services/portal.js';
import {
  fetchLandingPages, deleteLandingPage, publishLandingPage,
  unpublishLandingPage, LP_LAYOUTS,
} from '../services/landingPages.js';

const esc = s => String(s||'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = ts => ts?.toDate ? ts.toDate().toLocaleDateString('pt-BR') : '—';

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

async function loadList(container) {
  const listEl = document.getElementById('lp-list');
  if (!listEl) return;
  listEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;
    color:var(--text-muted);">⏳ Carregando…</div>`;

  const pages = await fetchLandingPages().catch(() => []);
  if (!pages.length) {
    listEl.innerHTML = `<div style="grid-column:1/-1;" class="empty-state">
      <div class="empty-state-icon">◱</div>
      <div class="empty-state-title">Nenhuma landing page ainda</div>
      <div class="empty-state-subtitle">Clique em "+ Nova Landing Page" para criar a primeira</div>
    </div>`;
    return;
  }

  const baseUrl = window.location.origin +
    window.location.pathname.replace(/index\.html$/, '') + 'lp.html#';

  listEl.innerHTML = pages.map(page => {
    const layout = LP_LAYOUTS.find(l => l.key === page.layout) || LP_LAYOUTS[0];
    const isPublished = page.status === 'published';
    const url = baseUrl + page.token;
    return `
    <div class="card" style="padding:0;overflow:hidden;display:flex;flex-direction:column;">
      <!-- Preview strip -->
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
          <a href="${esc(url)}" target="_blank" class="btn btn-ghost btn-sm"
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

/* ─── Layout picker ────────────────────────────────────────── */
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

/* ─── Builder ───────────────────────────────────────────────── */
async function showBuilder(container, pageId, layoutKey) {
  const { fetchLandingPage, saveLandingPage, LP_SECTION_TYPES } =
    await import('../services/landingPages.js');
  const { fetchImages, SEGMENTS } = await import('../services/portal.js');

  let page = pageId ? await fetchLandingPage(pageId) : null;
  const layout = LP_LAYOUTS.find(l => l.key === (page?.layout || layoutKey)) || LP_LAYOUTS[0];

  // Initialize sections from layout if new
  if (!page) {
    page = {
      name: '',
      description: '',
      layout: layout.key,
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
        display:flex;align-items:center;gap:12px;flex-shrink:0;">
        <button id="lpb-close" style="border:none;background:none;cursor:pointer;
          font-size:1.125rem;color:var(--text-muted);">←</button>
        <div style="flex:1;">
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

      <!-- Body: sections left, editor right -->
      <div style="display:grid;grid-template-columns:260px 1fr;flex:1;overflow:hidden;min-height:0;">

        <!-- Section list -->
        <div style="background:var(--bg-surface);border-right:1px solid var(--border-subtle);
          overflow-y:auto;display:flex;flex-direction:column;">
          <div style="padding:14px 16px;font-size:0.625rem;font-weight:700;text-transform:uppercase;
            letter-spacing:.1em;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">
            Seções (${page.sections.length})
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

  const markDirty = () => {
    dirty = true;
    const btn = document.getElementById('lpb-save');
    if (btn) btn.textContent = '💾 Salvar*';
  };

  const renderSectionList = () => {
    const listEl = document.getElementById('lpb-section-list');
    if (!listEl) return;
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
    const LBL = `font-size:0.75rem;font-weight:600;display:block;margin-bottom:6px;color:var(--text-muted);`;

    editorEl.innerHTML = `
      <div style="max-width:640px;">
        <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;
          letter-spacing:.1em;color:var(--brand-gold);margin-bottom:20px;">
          ${esc(typeDef.label)}
        </div>
        ${renderSectionFields(sec, typeDef, LBL)}
      </div>`;

    wireSectionFields(sec, editorEl, markDirty);
  };

  renderSectionList();
  renderSectionEditor();

  // Add section
  document.getElementById('lpb-add-section')?.addEventListener('click', () => {
    showSectionTypePicker(page, activeSectionId => {
      activeSectionId = activeSectionId;
      renderSectionList();
      renderSectionEditor();
      markDirty();
    }, sec => {
      page.sections.push(sec);
      activeSectionId = sec.id;
      renderSectionList();
      renderSectionEditor();
      markDirty();
    });
  });

  // Save
  document.getElementById('lpb-save')?.addEventListener('click', async () => {
    const btn = document.getElementById('lpb-save');
    btn.disabled = true; btn.textContent = '⏳ Salvando…';
    page.name = document.getElementById('lpb-name')?.value?.trim() || 'Sem título';
    try {
      const { id: savedId } = await saveLandingPage(page.id || null, page);
      page.id = savedId;
      dirty = false;
      btn.textContent = '💾 Salvar';
      toast.success('Salvo!');
    } catch(e) {
      toast.error('Erro: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  });

  // Preview
  document.getElementById('lpb-preview')?.addEventListener('click', () => {
    if (!page.token) { toast.error('Salve primeiro para visualizar.'); return; }
    const url = window.location.origin +
      window.location.pathname.replace(/index\.html$/, '') + 'lp.html#' + page.token;
    window.open(url, '_blank');
  });

  // Close
  document.getElementById('lpb-close')?.addEventListener('click', () => {
    if (dirty && !confirm('Há alterações não salvas. Sair mesmo assim?')) return;
    modal.remove();
    loadList(container);
  });
}

function renderSectionFields(sec, typeDef, LBL) {
  const fields = typeDef.fields || [];
  const data   = sec.data || {};
  const textFields = ['title','subtitle','headline','subheadline','badge_text','body',
    'cta_text','cta_link','button_text','button_link','label','urgency_text','align',
    'overlay_opacity','bg_color'];

  return fields.map(field => {
    const isTextarea = field === 'body' || field === 'caption';
    const isImg      = field === 'bg_image';
    const isSpecial  = ['items','steps','images','destinations','show_fields','captions','target_date'].includes(field);
    const labelText  = field.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());

    if (isImg) return `
      <div style="margin-bottom:16px;">
        <label style="${LBL}">${esc(labelText)}</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="text" class="portal-field sec-field" data-field="${field}"
            value="${esc(data[field]||'')}" placeholder="URL da imagem…"
            style="flex:1;font-size:0.875rem;">
          ${data[field] ? `<img src="${esc(data[field])}" style="width:48px;height:36px;
            object-fit:cover;border-radius:var(--radius-sm);flex-shrink:0;">` : ''}
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
          Cole a URL da imagem do Banco de Imagens ou externa
        </div>
      </div>`;

    if (isSpecial) return `
      <div style="margin-bottom:16px;padding:14px;background:var(--bg-surface);
        border-radius:var(--radius-md);border:1px solid var(--border-subtle);">
        <label style="${LBL}">${esc(labelText)}</label>
        <div style="font-size:0.8125rem;color:var(--text-muted);">
          Editor avançado disponível em breve — configuração via JSON por enquanto.
        </div>
        <textarea class="portal-field sec-field" data-field="${field}" rows="4"
          style="width:100%;font-size:0.75rem;font-family:monospace;margin-top:8px;"
          placeholder='[]'>${esc(JSON.stringify(data[field]||[], null, 2))}</textarea>
      </div>`;

    if (isTextarea) return `
      <div style="margin-bottom:16px;">
        <label style="${LBL}">${esc(labelText)}</label>
        <textarea class="portal-field sec-field" data-field="${field}" rows="4"
          style="width:100%;font-size:0.875rem;">${esc(data[field]||'')}</textarea>
      </div>`;

    return `
      <div style="margin-bottom:16px;">
        <label style="${LBL}">${esc(labelText)}</label>
        <input type="text" class="portal-field sec-field" data-field="${field}"
          value="${esc(data[field]||'')}" style="width:100%;font-size:0.875rem;">
      </div>`;
  }).join('');
}

function wireSectionFields(sec, editorEl, markDirty) {
  editorEl.querySelectorAll('.sec-field').forEach(el => {
    el.addEventListener('input', () => {
      const field = el.dataset.field;
      let val = el.value;
      // Try parse JSON for array fields
      if (el.tagName === 'TEXTAREA' && val.trim().startsWith('[')) {
        try { val = JSON.parse(val); } catch { /* keep string */ }
      }
      sec.data[field] = val;
      markDirty();
    });
  });
}

function showSectionTypePicker(page, setActive, onAdd) {
  const { LP_SECTION_TYPES } = { LP_SECTION_TYPES: {} };
  import('../services/landingPages.js').then(({ LP_SECTION_TYPES }) => {
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
                ${def.fields.slice(0,3).join(', ')}…
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
  });
}
