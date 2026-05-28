/**
 * PRIMETOUR — Portal de Dicas: Áreas
 * Cadastro de áreas com logo e templates vinculados
 */
import { store } from '../store.js';
import { toast } from '../components/toast.js';
import { fetchAreas, saveArea, deleteArea, convertToWebp, uploadImageToR2, saveImageMeta } from '../services/portal.js';
import { SUPPORTED_HEADLINE_FONTS, SUPPORTED_BODY_FONTS } from '../services/areaTokens.js?v=4.48.1';

const esc = s => String(s||'').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// 4.48.0+ (Sprint 6b) — referências locais pras opções de fonte do modal.
// Re-export pra evitar dependência fundo entre módulos.
const SUPPORTED_HEADLINE_FONTS_LOCAL = SUPPORTED_HEADLINE_FONTS;
const SUPPORTED_BODY_FONTS_LOCAL     = SUPPORTED_BODY_FONTS;

// 4.48.0+ Cache de fontes já carregadas pelo preview da Tipografia.
const _previewFonts = new Set();
function _ensureGoogleFont(family) {
  if (!family || _previewFonts.has(family)) return;
  if (document.querySelector(`link[data-area-preview-font="${family}"]`)) {
    _previewFonts.add(family); return;
  }
  const familyParam = family.replace(/\s+/g, '+');
  const url = `https://fonts.googleapis.com/css2?family=${familyParam}:wght@300;400;500;600;700&display=swap`;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = url; link.dataset.areaPreviewFont = family;
  document.head.appendChild(link);
  _previewFonts.add(family);
}

// 4.48.0+ Bloco de overrides por módulo (Portal de Dicas, Roteiros).
// Vazio = herda do nível geral. Estrutura: cores + fontes + editorial opcionais.
function moduleOverrideBlock(key, label, current = {}) {
  const c = current || {};
  return `
    <details style="margin-bottom:12px;border:1px solid var(--border);border-radius:6px;">
      <summary style="padding:12px 14px;cursor:pointer;font-weight:600;font-size:0.875rem;background:var(--bg-soft,#F9FAFB);">
        ${esc(label)}
      </summary>
      <div style="padding:14px;border-top:1px solid var(--border-subtle);">
        <div class="area-field">
          <label style="font-size:0.75rem;color:var(--text-muted);">Cor primária (override)</label>
          <input type="color" id="area-mod-${key}-color-primary"
            value="${esc(c.colors?.primary || '#475569')}"
            style="width:60px;height:32px;border:1px solid var(--border);border-radius:4px;cursor:pointer;">
          <button type="button" data-clear="area-mod-${key}-color-primary"
            style="margin-left:8px;font-size:0.7rem;color:var(--text-muted);background:none;border:none;cursor:pointer;text-decoration:underline;">
            ${c.colors?.primary ? 'Limpar (herdar)' : ''}
          </button>
        </div>
        <div class="area-field">
          <label style="font-size:0.75rem;color:var(--text-muted);">Fonte títulos (override)</label>
          <select id="area-mod-${key}-font-headline" class="filter-select" style="width:100%;">
            <option value="">— herdar —</option>
            ${SUPPORTED_HEADLINE_FONTS_LOCAL.map(o =>
              `<option value="${esc(o.value)}" ${o.value === c.fonts?.headline ? 'selected' : ''}>${esc(o.label)}</option>`
            ).join('')}
          </select>
        </div>
        <div class="area-field">
          <label style="font-size:0.75rem;color:var(--text-muted);">Fonte corpo (override)</label>
          <select id="area-mod-${key}-font-body" class="filter-select" style="width:100%;">
            <option value="">— herdar —</option>
            ${SUPPORTED_BODY_FONTS_LOCAL.map(o =>
              `<option value="${esc(o.value)}" ${o.value === c.fonts?.body ? 'selected' : ''}>${esc(o.label)}</option>`
            ).join('')}
          </select>
        </div>
      </div>
    </details>
  `;
}

/* ─── v4.62.43+ Fase E.2: bloco de exports por módulo × formato ─── */
function exportsModuleBlock(key, label, current = {}) {
  const exp = (current && current.exports) || {};
  const fmts = [
    { id: 'pdf',  label: 'PDF',           icon: '📄' },
    { id: 'docx', label: 'Word (DOCX)',   icon: '📝' },
    { id: 'pptx', label: 'PowerPoint',    icon: '📊' },
    { id: 'web',  label: 'Link web',      icon: '🌐' },
  ];
  // v4.62.51+ Fix audit pos-sprint: esconder formatos não-implementados por módulo.
  // v4.63.28+ Rename roteiros → cotacoes (Renê: "nomenclatura correta em Roteiros
  // não é Cotação?"). Reader em areaDefaults.js:122 já tem alias bidirectional,
  // backward compat garantida. Web pra cotacoes virá em v4.63.29 (generator real).
  // - portal exporta 4 formatos (PDF/DOCX/PPTX/Web)
  // - cotacoes exporta 3 (PDF/DOCX/PPTX) — web em v4.63.29+ (runtime pendente)
  // - banco-roteiros exporta apenas PDF (reusa roteiroGenerator PDF via adapter)
  const SUPPORTED_FMTS = {
    portal:           ['pdf', 'docx', 'pptx', 'web'],
    cotacoes:         ['pdf', 'docx', 'pptx'],
    'banco-roteiros': ['pdf'],
  };
  const allowedIds = SUPPORTED_FMTS[key] || ['pdf', 'docx', 'pptx', 'web'];
  const fmtsFiltered = fmts.filter(f => allowedIds.includes(f.id));
  return `
    <div class="exports-mod-pane ${key === 'portal' ? 'active' : ''}" data-exports-mod="${esc(key)}" style="display:${key === 'portal' ? 'block' : 'none'};">
      ${fmtsFiltered.map(fmt => {
        const f = exp[fmt.id] || {};
        return `
        <details style="margin-bottom:10px;border:1px solid var(--border);border-radius:6px;">
          <summary style="padding:10px 14px;cursor:pointer;font-weight:600;font-size:0.8125rem;background:var(--bg-soft,#F9FAFB);">
            <span style="margin-right:6px;">${fmt.icon}</span>${esc(fmt.label)}
            ${(f.footerText || f.headerText || f.hideCover) ? '<span style="font-size:0.65rem;color:var(--brand-gold);font-weight:500;margin-left:8px;">· customizado</span>' : ''}
          </summary>
          <div style="padding:14px;border-top:1px solid var(--border-subtle);">
            <div class="area-field">
              <label style="font-size:0.75rem;color:var(--text-muted);display:flex;justify-content:space-between;align-items:center;">
                <span>Texto do rodapé</span>
                <!-- v4.62.48+ counter visual + maxlength defensivo -->
                <span class="area-exp-counter" data-target="area-exp-${key}-${fmt.id}-footer" data-max="300" style="font-size:0.65rem;color:var(--text-muted);font-variant-numeric:tabular-nums;"></span>
              </label>
              <textarea id="area-exp-${key}-${fmt.id}-footer" maxlength="300"
                style="width:100%;min-height:60px;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:4px;font-family:inherit;font-size:0.8125rem;resize:vertical;"
                placeholder="Ex: ${esc('{areaName} · CNPJ 00.000.000/0001-00 · contato@primetour.com.br')}">${esc(f.footerText || '')}</textarea>
              <div style="font-size:0.65rem;color:var(--text-muted);margin-top:3px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                <span>Placeholders: <code>{areaName}</code> · <code>{today}</code> · <code>{clientName}</code> · <code>{title}</code></span>
                <!-- v4.62.48+ botão "copiar pra todos os formatos" pro footer -->
                <button type="button" class="area-exp-copy-all" data-src-key="${esc(key)}" data-src-fmt="${esc(fmt.id)}" data-src-field="footer"
                  style="background:none;border:1px solid var(--border-subtle);color:var(--text-secondary);padding:2px 8px;border-radius:3px;cursor:pointer;font-size:0.65rem;">
                  ⎘ Copiar pra todos os formatos
                </button>
              </div>
            </div>
            <div class="area-field">
              <label style="font-size:0.75rem;color:var(--text-muted);display:flex;justify-content:space-between;align-items:center;">
                <span>Texto adicional no cabeçalho (opcional)</span>
                <span class="area-exp-counter" data-target="area-exp-${key}-${fmt.id}-header" data-max="200" style="font-size:0.65rem;color:var(--text-muted);font-variant-numeric:tabular-nums;"></span>
              </label>
              <input type="text" id="area-exp-${key}-${fmt.id}-header" maxlength="200"
                value="${esc(f.headerText || '')}"
                style="width:100%;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:4px;font-family:inherit;font-size:0.8125rem;"
                placeholder="Ex: Cotação preparada por {areaName}">
              <div style="font-size:0.65rem;color:var(--text-muted);margin-top:3px;text-align:right;">
                <button type="button" class="area-exp-copy-all" data-src-key="${esc(key)}" data-src-fmt="${esc(fmt.id)}" data-src-field="header"
                  style="background:none;border:1px solid var(--border-subtle);color:var(--text-secondary);padding:2px 8px;border-radius:3px;cursor:pointer;font-size:0.65rem;">
                  ⎘ Copiar pra todos os formatos
                </button>
              </div>
            </div>
            ${fmt.id === 'web' ? `
            <!-- v4.62.48+ Web: hideCover é NO-OP (não existe slide de capa em HTML).
                 Mantém schema-compat mas esconde do UI pra não confundir. -->
            <div class="area-field" style="font-size:0.7rem;color:var(--text-muted);font-style:italic;">
              ℹ Formato Web não tem capa separada — opção "esconder capa" não se aplica.
            </div>` : `
            <div class="area-field" style="display:flex;align-items:center;gap:8px;">
              <input type="checkbox" id="area-exp-${key}-${fmt.id}-hidecover" ${f.hideCover ? 'checked' : ''}
                style="width:14px;height:14px;cursor:pointer;accent-color:var(--brand-gold,#D4A843);">
              <label for="area-exp-${key}-${fmt.id}-hidecover" style="font-size:0.8125rem;color:var(--text-primary);font-weight:500;margin:0;cursor:pointer;">
                Esconder capa <span style="font-weight:400;color:var(--text-muted);font-size:0.72rem;">(export compacto sem capa)</span>
              </label>
            </div>`}
          </div>
        </details>`;
      }).join('')}
    </div>
  `;
}

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
  // 4.49.2+ Usa canManagePortalAreas() (wire da perm `portal_areas_manage`
  // que estava orphan no catálogo) em vez do legado canManagePortal().
  // Mantém compat via store.canManagePortalAreas() que aceita ambos.
  if (!store.canManagePortalAreas()) {
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

  // Renderiza cor como swatch redondo com hex pequeno
  const colorSwatch = (hex, label) => hex ? `
    <div style="display:flex;align-items:center;gap:6px;font-size:0.7rem;color:var(--text-muted);">
      <div style="width:18px;height:18px;border-radius:50%;background:${esc(hex)};
        border:1px solid rgba(0,0,0,0.1);box-shadow:0 1px 2px rgba(0,0,0,0.08);"></div>
      <span style="font-family:monospace;">${esc(hex)}</span>
    </div>` : '';

  const renderCard = a => {
    const hasLogo    = !!a.logoUrl;
    const hasLogoAlt = !!a.logoUrlAlt;
    const primary    = a.colors?.primary || '';
    const secondary  = a.colors?.secondary || '';

    // Banner com gradient das cores da BU (preview visual)
    const banner = (primary || secondary)
      ? `background:linear-gradient(135deg, ${esc(primary || secondary)}, ${esc(secondary || primary)});`
      : `background:linear-gradient(135deg, #475569, #1e293b);`;

    return `
    <div class="card" style="padding:0;position:relative;overflow:hidden;border:1px solid var(--border-subtle);">
      <!-- Banner com cores da BU + logo overlay -->
      <div style="${banner}height:90px;position:relative;display:flex;align-items:center;justify-content:center;">
        ${hasLogo
          ? `<img src="${esc(a.logoUrl)}" style="max-height:50px;max-width:80%;object-fit:contain;
              filter:drop-shadow(0 1px 2px rgba(0,0,0,0.3));" alt="${esc(a.name)}">`
          : `<div style="color:rgba(255,255,255,0.7);font-size:1.5rem;font-weight:700;">${esc(a.name)}</div>`}
      </div>
      <div style="padding:16px;">
        <div style="font-weight:700;font-size:0.9375rem;color:var(--text-primary);margin-bottom:10px;">
          ${esc(a.name)}
        </div>
        <!-- Status visual: logo principal + alt + paleta -->
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;">
          <div style="display:flex;align-items:center;gap:6px;font-size:0.75rem;">
            <span style="color:${hasLogo ? '#16A34A' : '#9CA3AF'};">${hasLogo ? '✓' : '○'}</span>
            <span style="color:${hasLogo ? 'var(--text-primary)' : 'var(--text-muted)'};">
              Logo principal ${hasLogo ? 'OK' : 'pendente'}
            </span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;font-size:0.75rem;">
            <span style="color:${hasLogoAlt ? '#16A34A' : '#9CA3AF'};">${hasLogoAlt ? '✓' : '○'}</span>
            <span style="color:${hasLogoAlt ? 'var(--text-primary)' : 'var(--text-muted)'};">
              Logo alternativo ${hasLogoAlt ? 'OK' : 'pendente'}
            </span>
          </div>
          ${primary || secondary ? `
            <div style="display:flex;gap:14px;margin-top:4px;">
              ${colorSwatch(primary, 'primary')}
              ${colorSwatch(secondary, 'secondary')}
            </div>` : `
            <div style="font-size:0.7rem;color:var(--text-muted);font-style:italic;">
              Sem paleta de cores configurada
            </div>`}
        </div>
        ${a.description ? `<p style="font-size:0.75rem;color:var(--text-muted);margin:0 0 12px;
          line-height:1.4;">${esc(a.description)}</p>` : ''}
        <div style="display:flex;gap:8px;">
          <button class="btn btn-ghost btn-sm" data-edit="${a.id}" style="flex:1;">Editar</button>
          <button class="btn btn-ghost btn-sm" data-delete="${a.id}"
            style="color:#EF4444;">Excluir</button>
        </div>
      </div>
    </div>`;
  };

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

  // 4.48.0+ (Sprint 6b Phase 3) — Modal agora tem TABS:
  //   Marca · Tipografia · Editorial · Por módulo
  // Espelha schema de areaTokens.js (SSO multi-módulo).
  const fonts = area?.fonts || {};
  const edit  = area?.editorial || {};
  const mods  = area?.modules || {};
  // v4.63.28+ Migration on-read pra rename roteiros→cotacoes: se schema legado
  // tem area.modules.roteiros mas não area.modules.cotacoes, copia pra cotacoes.
  // Save grava SÓ em cotacoes (chave canônica). Legacy doc fica intacto até
  // próxima edição → safe deprecation. Reader em areaDefaults.js:122 já lê ambos.
  if (mods.roteiros && !mods.cotacoes) mods.cotacoes = mods.roteiros;
  const fontOptions = (sel, cur) => sel.map(o =>
    `<option value="${esc(o.value)}" ${o.value === cur ? 'selected' : ''}>${esc(o.label)}</option>`
  ).join('');

  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:680px;padding:0;max-height:92vh;overflow:hidden;display:flex;flex-direction:column;">
      <!-- Header fixo -->
      <div style="display:flex;justify-content:space-between;align-items:center;padding:24px 28px 0;">
        <h3 style="margin:0;font-size:1rem;">${area ? 'Editar Área' : 'Nova Área'}</h3>
        <button id="area-modal-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);">✕</button>
      </div>

      <!-- Tabs -->
      <div id="area-tabs" style="display:flex;gap:0;border-bottom:1px solid var(--border-subtle);padding:16px 28px 0;margin-top:14px;">
        <button class="area-tab area-tab-active" data-tab="marca"      type="button">🎨 Marca</button>
        <button class="area-tab"                  data-tab="tipografia" type="button">🔤 Tipografia</button>
        <button class="area-tab"                  data-tab="editorial"  type="button">📝 Editorial</button>
        <button class="area-tab"                  data-tab="modules"    type="button">⚙ Por módulo</button>
        <button class="area-tab"                  data-tab="exports"    type="button">📤 Exports</button>
        <button class="area-tab"                  data-tab="templates"  type="button">📐 Templates</button>
      </div>
      <style>
        .area-tab {
          padding:10px 16px; background:transparent; border:none; cursor:pointer;
          font-family:inherit; font-size:0.8125rem; font-weight:500;
          color:var(--text-muted); border-bottom:2px solid transparent;
          transition:color .15s, border-color .15s;
        }
        .area-tab:hover { color:var(--text-primary); }
        .area-tab-active { color:var(--brand-gold,#D4A843); border-bottom-color:var(--brand-gold,#D4A843); font-weight:600; }
        .area-tab-pane { display:none; padding:20px 28px; flex:1; overflow-y:auto; }
        .area-tab-pane.active { display:block; }
        .area-field { margin-bottom:14px; }
        .area-field label { font-size:0.8125rem; font-weight:600; display:block; margin-bottom:6px; }
        .area-field .hint { font-size:0.75rem; color:var(--text-muted); margin-top:4px; line-height:1.5; }
        .area-radio-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:8px; }
        .area-radio-grid label {
          display:block; padding:12px 14px; border:1px solid var(--border); border-radius:6px;
          cursor:pointer; font-weight:500; font-size:0.8125rem; transition:all .15s;
        }
        .area-radio-grid label:has(input:checked) {
          border-color:var(--brand-gold,#D4A843); background:rgba(212,168,67,.08);
        }
        .area-radio-grid label input { margin-right:6px; }
        .area-radio-grid .desc { font-size:0.7rem; color:var(--text-muted); margin-top:4px; font-weight:400; }
      </style>

      <!-- TAB: Marca (visual) -->
      <div class="area-tab-pane active" data-pane="marca">
        <div class="area-field">
          <label>Nome da Área *</label>
          <input type="text" id="area-name" class="filter-select" style="width:100%;"
            placeholder="Ex: BTG Partners" value="${esc(area?.name || '')}">
        </div>

        <!-- v4.62.40 Fase B.1 (D7): toggle brand externo. Default ligado pra
             ser consistente com Portal de Dicas (que sempre mostrou nome da
             área). Desligado força "PRIMETOUR" guarda-chuva nas capas. -->
        <div class="area-field" style="padding:12px 14px;background:var(--bg-soft,#F9FAFB);border-radius:6px;border:1px solid var(--border-subtle,#e5e7eb);">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;margin:0;">
            <input type="checkbox" id="area-use-external-name"
              ${area?.brand?.useExternalName !== false ? 'checked' : ''}
              style="margin:0;width:16px;height:16px;cursor:pointer;accent-color:var(--brand-gold,#D4A843);">
            <div style="flex:1;">
              <div style="font-weight:600;color:var(--text-primary);">Mostrar nome da área nos exports</div>
              <div class="hint" style="margin-top:2px;font-weight:400;">
                Quando ligado, capas de PDF e footer do link web mostram <strong>"${esc(area?.name || 'Nome da área')}"</strong>.<br>
                Quando desligado, mostra <strong>"PRIMETOUR"</strong> (marca guarda-chuva).
              </div>
            </div>
          </label>
        </div>
        <div class="area-field">
          <label>Categoria <span style="font-weight:400;color:var(--text-muted);">(agrupa áreas)</span></label>
          <input type="text" id="area-category" class="filter-select" style="width:100%;"
            placeholder="Ex: ICs, BTG, Bradesco…" value="${esc(area?.category || '')}"
            list="area-category-list">
          <datalist id="area-category-list">
            ${[...new Set(areas.map(a => a.category).filter(Boolean))].map(c =>
              `<option value="${esc(c)}">`).join('')}
          </datalist>
          <div class="hint">Deixe vazio para área independente. Áreas da mesma categoria são agrupadas no portal.</div>
        </div>
        ${logoBlock({
          slot: 'main', label: 'Logo principal (fundo escuro)',
          hint: 'Aparece na CAPA do PDF + footer do link web (fundos escuros). Use a versão BRANCA/CLARA.',
          previewBg: '#1F2937', currentUrl: area?.logoUrl,
        })}
        ${logoBlock({
          slot: 'alt', label: 'Logo p/ fundo claro (header) — opcional',
          hint: 'Aparece no TOPBAR do link web + rodapé do PDF (fundos claros). Use a versão ESCURA/COLORIDA. Se não enviar, usamos o principal.',
          previewBg: '#FFFFFF', currentUrl: area?.logoUrlAlt,
        })}
        <div class="area-field">
          <label>Paleta de cores</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            ${colorPickerWithHex('primary',   'Cor primária',   area?.colors?.primary   || '#475569')}
            ${colorPickerWithHex('secondary', 'Cor secundária', area?.colors?.secondary || '#1F2937')}
          </div>
          <div class="hint">Cor primária aparece em links, badges e detalhes. Secundária em fundos escuros e textos de destaque.</div>
        </div>
        <div class="area-field">
          <label>Descrição (opcional)</label>
          <textarea id="area-desc" class="filter-select" style="width:100%;height:72px;resize:vertical;"
            placeholder="Breve descrição da área...">${esc(area?.description || '')}</textarea>
        </div>
      </div>

      <!-- TAB: Tipografia -->
      <div class="area-tab-pane" data-pane="tipografia">
        <div class="area-field">
          <label>Fonte dos títulos (headline)</label>
          <select id="area-font-headline" class="filter-select" style="width:100%;">
            ${fontOptions(SUPPORTED_HEADLINE_FONTS_LOCAL, fonts.headline || 'Poppins')}
          </select>
          <div class="hint">Usada em h1/h2/h3 dos materiais. Serif = editorial luxo; sans-serif = moderno/tech.</div>
        </div>
        <div class="area-field">
          <label>Fonte do corpo (body)</label>
          <select id="area-font-body" class="filter-select" style="width:100%;">
            ${fontOptions(SUPPORTED_BODY_FONTS_LOCAL, fonts.body || 'Poppins')}
          </select>
          <div class="hint">Usada em parágrafos, listas e UI. Mantenha legibilidade em 14-16px.</div>
        </div>
        <div class="area-field">
          <label>Escala de títulos</label>
          <div class="area-radio-grid">
            <label><input type="radio" name="area-font-scale" value="compact"    ${fonts.accentScale==='compact'?'checked':''}>Compacto<div class="desc">Hierarquia discreta</div></label>
            <label><input type="radio" name="area-font-scale" value="normal"     ${(!fonts.accentScale||fonts.accentScale==='normal')?'checked':''}>Normal<div class="desc">Equilibrado (default)</div></label>
            <label><input type="radio" name="area-font-scale" value="expressive" ${fonts.accentScale==='expressive'?'checked':''}>Expressivo<div class="desc">Hierarquia marcante</div></label>
          </div>
        </div>
        <div class="area-field" style="margin-top:24px;padding:16px;background:var(--bg-soft,#F9FAFB);border-radius:8px;border:1px dashed var(--border);">
          <label style="margin-bottom:10px;">Preview</label>
          <div id="area-font-preview" style="padding:0;">
            <div class="area-preview-h" style="font-size:1.5rem;font-weight:600;letter-spacing:-.01em;color:var(--text-primary);margin-bottom:4px;">Título exemplo da marca</div>
            <div class="area-preview-b" style="font-size:0.875rem;color:var(--text-secondary);line-height:1.6;">Este é um trecho de corpo de texto pra você visualizar a fonte selecionada antes de salvar.</div>
          </div>
        </div>
      </div>

      <!-- TAB: Editorial -->
      <div class="area-tab-pane" data-pane="editorial">
        <div class="area-field">
          <label>Tom de voz</label>
          <div class="area-radio-grid">
            <label><input type="radio" name="area-voice" value="formal"          ${edit.voice==='formal'?'checked':''}>Formal<div class="desc">B2B, instituicional, conservador</div></label>
            <label><input type="radio" name="area-voice" value="caloroso"        ${(!edit.voice||edit.voice==='caloroso')?'checked':''}>Caloroso<div class="desc">Acolhedor (default)</div></label>
            <label><input type="radio" name="area-voice" value="editorial-luxo"  ${edit.voice==='editorial-luxo'?'checked':''}>Editorial luxo<div class="desc">Revista de viagens premium</div></label>
          </div>
        </div>
        <div class="area-field">
          <label>Estilo de seções</label>
          <div class="area-radio-grid">
            <label><input type="radio" name="area-section" value="minimalista" ${edit.sectionStyle==='minimalista'?'checked':''}>Minimalista<div class="desc">Whitespace generoso</div></label>
            <label><input type="radio" name="area-section" value="revista"     ${(!edit.sectionStyle||edit.sectionStyle==='revista')?'checked':''}>Revista<div class="desc">Fotos + cards (default)</div></label>
            <label><input type="radio" name="area-section" value="documento"   ${edit.sectionStyle==='documento'?'checked':''}>Documento<div class="desc">Tabular, formal</div></label>
          </div>
        </div>
        <div class="area-field">
          <label>Estilo de capa</label>
          <div class="area-radio-grid">
            <label><input type="radio" name="area-cover" value="fullbleed" ${(!edit.coverStyle||edit.coverStyle==='fullbleed')?'checked':''}>Full bleed<div class="desc">Foto preenche tela (default)</div></label>
            <label><input type="radio" name="area-cover" value="centered"  ${edit.coverStyle==='centered'?'checked':''}>Centralizado<div class="desc">Foto + caixa branca central</div></label>
            <label><input type="radio" name="area-cover" value="side-image" ${edit.coverStyle==='side-image'?'checked':''}>Foto lateral<div class="desc">Texto à esquerda, foto à direita</div></label>
          </div>
        </div>
        <div class="area-field">
          <label>Acento do hero (overlines + traços)</label>
          <div class="area-radio-grid">
            <label><input type="radio" name="area-chrome" value="white"        ${(!edit.chromeAccent||edit.chromeAccent==='white')?'checked':''}>Branco<div class="desc">Sempre legível (default)</div></label>
            <label><input type="radio" name="area-chrome" value="gold-on-dark" ${edit.chromeAccent==='gold-on-dark'?'checked':''}>Dourado<div class="desc">Amber elegante</div></label>
            <label><input type="radio" name="area-chrome" value="primary"      ${edit.chromeAccent==='primary'?'checked':''}>Cor primária<div class="desc">Risco: ilegível se primary for escura</div></label>
          </div>
        </div>
      </div>

      <!-- TAB: Por módulo -->
      <div class="area-tab-pane" data-pane="modules">
        <div style="background:var(--bg-soft,#F9FAFB);padding:12px 14px;border-left:3px solid var(--brand-gold,#D4A843);border-radius:4px;font-size:0.8125rem;color:var(--text-muted);margin-bottom:16px;line-height:1.5;">
          <strong style="color:var(--text-primary);">Overrides opcionais.</strong> Use só quando um módulo específico precisar de identidade diferente da geral (ex: Portal de Dicas com Poppins, mas Cotações com Cormorant pra tom mais editorial).
          Vazio = herda da Marca/Tipografia/Editorial acima.
        </div>
        ${moduleOverrideBlock('portal',   'Portal de Dicas', mods.portal)}
        ${moduleOverrideBlock('cotacoes', 'Cotações', mods.cotacoes)}
      </div>

      <!-- TAB: Exports (v4.62.43+ Fase E.2) -->
      <div class="area-tab-pane" data-pane="exports">
        <div style="background:var(--bg-soft,#F9FAFB);padding:12px 14px;border-left:3px solid var(--brand-gold,#D4A843);border-radius:4px;font-size:0.8125rem;color:var(--text-muted);margin-bottom:16px;line-height:1.5;">
          <strong style="color:var(--text-primary);">Customizações por módulo × formato.</strong>
          Cada bloco abaixo configura como o módulo exporta no formato selecionado (rodapé, cabeçalho, capa).
          Placeholders suportados em rodapé/cabeçalho: <code>{areaName}</code> · <code>{today}</code> · <code>{clientName}</code> · <code>{title}</code>.
          Vazio = usa o padrão hardcoded do generator (comportamento antigo).
        </div>

        <!-- Sub-tabs por módulo -->
        <div id="exports-mod-tabs" style="display:flex;gap:0;border-bottom:1px solid var(--border-subtle);margin-bottom:14px;">
          <button class="exports-mod-tab area-tab area-tab-active" data-mod="portal"   type="button">📍 Portal de Dicas</button>
          <button class="exports-mod-tab area-tab"                  data-mod="cotacoes" type="button">✈ Cotações</button>
          <button class="exports-mod-tab area-tab"                  data-mod="banco-roteiros" type="button">📚 Banco de Roteiros</button>
        </div>

        ${exportsModuleBlock('portal',          'Portal de Dicas',    mods.portal)}
        ${exportsModuleBlock('cotacoes',        'Cotações',           mods.cotacoes)}
        ${exportsModuleBlock('banco-roteiros',  'Banco de Roteiros',  mods['banco-roteiros'])}
      </div>

      <!-- v4.63.10+ TAB: Templates (atribuir template uploaded à área) -->
      <div class="area-tab-pane" data-pane="templates">
        <div style="background:var(--bg-soft,#F9FAFB);padding:12px 14px;border-left:3px solid var(--brand-blue,#3B82F6);border-radius:4px;font-size:0.8125rem;color:var(--text-muted);margin-bottom:16px;line-height:1.5;">
          <strong style="color:var(--text-primary);">Atribuir templates uploaded a essa área.</strong>
          Cada combinação módulo × formato pode usar um template HTML/DOCX/PPTX da
          <a href="#templates-library" style="color:var(--brand-blue,#3B82F6);">Biblioteca</a>.
          Vazio = generator usa layout hardcoded (comportamento atual). Quando preenchido,
          generators (a partir de v4.63.11) renderizam via template em vez do código.
        </div>
        <div id="area-tpl-refs-grid" data-current-area-id="${esc(area?.id || '')}" style="display:grid;gap:14px;">
          <!-- Populado dinamicamente pelo populateTemplateRefs() abaixo -->
          <div style="padding:24px;text-align:center;color:var(--text-muted);font-size:0.8125rem;">
            ⏳ Carregando templates disponíveis…
          </div>
        </div>
      </div>

      <!-- Footer fixo -->
      <div style="display:flex;gap:8px;padding:16px 28px;border-top:1px solid var(--border-subtle);background:var(--bg-card);">
        <button class="btn btn-secondary" id="area-modal-cancel" style="flex:1;">Cancelar</button>
        <button class="btn btn-primary" id="area-modal-save" style="flex:2;">
          ${area ? 'Salvar Alterações' : 'Criar Área'}
        </button>
      </div>
    </div>
  `;

  // Tab switcher TOP-LEVEL — só pegar tabs com data-tab (Marca/Tipografia/etc)
  // Sub-tabs de exports usam data-mod (.exports-mod-tab) — switcher separado abaixo.
  modal.querySelectorAll('.area-tab[data-tab]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = btn.dataset.tab;
      modal.querySelectorAll('.area-tab[data-tab]').forEach(b => b.classList.toggle('area-tab-active', b === btn));
      modal.querySelectorAll('.area-tab-pane').forEach(p =>
        p.classList.toggle('active', p.dataset.pane === tab));
    });
  });

  // v4.62.43+ Fase E.2: sub-tab switcher dentro da aba Exports
  // (Portal de Dicas / Roteiros / Banco de Roteiros)
  modal.querySelectorAll('.exports-mod-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const mod = btn.dataset.mod;
      modal.querySelectorAll('.exports-mod-tab').forEach(b => b.classList.toggle('area-tab-active', b === btn));
      modal.querySelectorAll('.exports-mod-pane').forEach(p => {
        const isActive = p.dataset.exportsMod === mod;
        p.classList.toggle('active', isActive);
        p.style.display = isActive ? 'block' : 'none';
      });
    });
  });

  // v4.62.48+ counters dos textareas/inputs de exports (live + maxlength)
  const _updExpCounter = (counter) => {
    const el = document.getElementById(counter.dataset.target);
    if (!el) return;
    const max = +counter.dataset.max || 0;
    const cur = (el.value || '').length;
    counter.textContent = `${cur}/${max}`;
    counter.style.color = cur > max * 0.9 ? 'var(--color-danger,#EF4444)' : 'var(--text-muted)';
  };
  modal.querySelectorAll('.area-exp-counter').forEach(c => {
    _updExpCounter(c);
    const el = document.getElementById(c.dataset.target);
    if (el) el.addEventListener('input', () => _updExpCounter(c));
  });

  // v4.62.48+ "copiar pra todos os formatos" (footer/header em PDF+DOCX+PPTX+Web)
  modal.querySelectorAll('.area-exp-copy-all').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const k     = btn.dataset.srcKey;
      const fmt   = btn.dataset.srcFmt;
      const field = btn.dataset.srcField; // 'footer' | 'header'
      const srcEl = document.getElementById(`area-exp-${k}-${fmt}-${field}`);
      if (!srcEl) return;
      const val = srcEl.value || '';
      const fmts = ['pdf', 'docx', 'pptx', 'web'];
      let count = 0;
      fmts.forEach(f => {
        if (f === fmt) return; // skip origem
        const tgt = document.getElementById(`area-exp-${k}-${f}-${field}`);
        if (tgt) { tgt.value = val; count++; tgt.dispatchEvent(new Event('input', { bubbles: true })); }
      });
      btn.textContent = `✓ Copiado em ${count}`;
      btn.style.borderColor = 'var(--brand-gold,#D4A843)';
      setTimeout(() => {
        btn.textContent = '⎘ Copiar pra todos os formatos';
        btn.style.borderColor = '';
      }, 1800);
    });
  });

  // v4.63.10+ populate tab Templates com dropdowns por módulo × formato
  (async () => {
    const grid = modal.querySelector('#area-tpl-refs-grid');
    if (!grid) return;
    try {
      const { fetchTemplates, fetchTemplate, TEMPLATE_MODULES, TEMPLATE_FORMATS } = await import('../services/templates.js');
      const all = await fetchTemplates({ status: 'active' });
      const currentRefs = area?.templateRefs || {};

      // v4.63.14+ Fix Bug #8/#9 (audit pós-sprint): coleta orphan refs (IDs
      // configurados em area.templateRefs mas que sumiram da lista active —
      // archived, deleted, ownerType mudou). Fetch individual pra mostrar
      // mensagem específica ao user (em vez de orphan virar select vazio).
      const orphanFetched = new Map();
      const refIds = [];
      for (const modKey of Object.keys(currentRefs || {})) {
        const fmtMap = currentRefs[modKey] || {};
        for (const fmtKey of Object.keys(fmtMap)) {
          const id = fmtMap[fmtKey];
          if (id && !all.some(t => t.id === id)) refIds.push(id);
        }
      }
      // v4.63.21+ Fix M4 (audit pós-sprint): dedupe — mesmo orphan ID pode
      // aparecer em N cells (portal/html + portal/docx) → evita N reads
      // desnecessários do Firestore.
      const _uniqRefIds = [...new Set(refIds)];
      await Promise.all(_uniqRefIds.map(async id => {
        try { const t = await fetchTemplate(id); if (t) orphanFetched.set(id, t); }
        catch {}
      }));

      // SUPPORTED_FMTS: mesma lógica do exportsModuleBlock — só formatos que generators usam
      // v4.63.12+ Fix Zumbi #1: key canônica é 'cotacoes' (rename v4.62.50).
      // v4.63.22+ 'web' habilitado pra Portal (runtime portal-view-tpl.html).
      // v4.63.25+ Cotações 'web' DESABILITADO até roteiro-view-tpl.html existir
      // (admin atribuiria template silencioso sem runtime). Re-habilitar quando
      // generateWebLink for portado pra roteiroGenerator.js + view tpl criado.
      // Banco mantém só HTML.
      const SUPPORTED_FMTS_TPL = {
        portal:           ['html', 'web', 'docx', 'pptx'],
        cotacoes:         ['html', 'docx', 'pptx'],
        'banco-roteiros': ['html'],
      };

      const html = TEMPLATE_MODULES.map(mod => {
        const allowed = SUPPORTED_FMTS_TPL[mod.id] || ['html', 'docx', 'pptx'];
        const rows = allowed.map(fmtId => {
          const fmt = TEMPLATE_FORMATS.find(f => f.id === fmtId) || { label: fmtId };
          // Templates compatíveis: mesmo módulo + formato + (global OU dessa área)
          const compatible = all.filter(t =>
            t.module === mod.id
            && t.format === fmtId
            && (t.ownerType === 'global' || (t.ownerType === 'area' && t.ownerId === area?.id))
          );
          const currentVal = currentRefs?.[mod.id]?.[fmtId] || '';
          // v4.63.14+ Fix Bug #8/#9 (audit pós-sprint): se templateRef aponta
          // pra ID que NÃO está na lista de compatíveis (arquivado, deleted,
          // mudou de owner), avisar inline em vez de sumir silenciosamente.
          const orphanRef = currentVal && !compatible.some(t => t.id === currentVal);
          const orphanTpl = orphanRef ? (all.find(t => t.id === currentVal) || orphanFetched.get(currentVal)) : null;
          const orphanReason = orphanRef
            ? (orphanTpl
                ? (orphanTpl.status === 'archived'
                    ? `Template "${orphanTpl.name}" está arquivado`
                    : `Template "${orphanTpl.name}" mudou de owner ou formato`)
                : `Template ${currentVal.slice(0,12)}… não existe (excluído)`)
            : '';
          return `
            <div style="display:grid;grid-template-columns:130px 1fr;gap:10px;align-items:center;padding:6px 0;">
              <span style="font-size:0.75rem;color:var(--text-muted);">${esc(fmt.label)}</span>
              <div>
                <select class="area-tpl-ref-select form-input"
                  data-tpl-mod="${esc(mod.id)}" data-tpl-fmt="${esc(fmtId)}"
                  style="width:100%;font-size:0.8125rem;${orphanRef ? 'border-color:var(--color-warning,#F59E0B);' : ''}">
                  <option value="">— Usar padrão do sistema (sem template) —</option>
                  ${orphanRef ? `<option value="${esc(currentVal)}" selected style="color:var(--color-warning,#F59E0B);">⚠ ${esc(orphanReason)}</option>` : ''}
                  ${compatible.map(t => `
                    <option value="${esc(t.id)}" ${t.id === currentVal ? 'selected' : ''}>
                      ${esc(t.name)}${t.ownerType === 'global' ? ' · 🌐' : ''}${t.isDefault ? ' · ★ default' : ''}
                    </option>
                  `).join('')}
                </select>
                ${orphanRef ? `<p style="font-size:0.6875rem;color:var(--color-warning,#F59E0B);margin:3px 0 0;">⚠ Geração vai cair pro padrão do sistema. Selecione novo template ou — Usar padrão —.</p>` : ''}
              </div>
            </div>
          `;
        }).join('');
        return `
          <div style="border:1px solid var(--border-subtle);border-radius:8px;padding:12px 14px;background:var(--bg-card);">
            <h4 style="margin:0 0 4px;font-size:0.875rem;color:var(--text-primary);">
              ${mod.icon} ${esc(mod.label)}
            </h4>
            ${rows || '<p style="font-size:0.7rem;color:var(--text-muted);">Sem formatos suportados.</p>'}
          </div>
        `;
      }).join('');
      grid.innerHTML = html || '<p style="color:var(--text-muted);font-size:0.8125rem;">Nenhum módulo configurável.</p>';
    } catch (e) {
      grid.innerHTML = `<p style="color:var(--color-danger,#EF4444);font-size:0.8125rem;">Erro ao carregar templates: ${esc(e.message || String(e))}</p>`;
    }
  })();

  // Live preview de fontes na aba Tipografia
  const updateFontPreview = () => {
    const h = document.getElementById('area-font-headline')?.value || 'Poppins';
    const b = document.getElementById('area-font-body')?.value || 'Poppins';
    _ensureGoogleFont(h); _ensureGoogleFont(b);
    const preview = modal.querySelector('#area-font-preview');
    if (preview) {
      preview.querySelector('.area-preview-h').style.fontFamily = `'${h}', serif`;
      preview.querySelector('.area-preview-b').style.fontFamily = `'${b}', sans-serif`;
    }
  };
  modal.querySelector('#area-font-headline')?.addEventListener('change', updateFontPreview);
  modal.querySelector('#area-font-body')?.addEventListener('change', updateFontPreview);
  setTimeout(updateFontPreview, 100);

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
        const { blob, width, height } = await convertToWebp(file, 0.95);
        progress.textContent = 'Enviando para Cloudflare R2…';
        const areaName = document.getElementById('area-name')?.value || area?.name || 'Área';
        const areaSlug = slugForFile(areaName);
        const path     = `logos/${areaSlug}-${slot}-${Date.now()}.webp`;
        const url      = await uploadImageToR2(blob, path);
        if (urlInput) urlInput.value = url;
        renderPreview(url);
        // 4.35.33+ Auto-cria entry em portal_images pra logo aparecer no Banco de Imagens.
        // Best-effort: falha aqui não bloqueia o upload da área.
        try {
          await saveImageMeta({
            assetCategory: 'logo',
            type:          'logo_area',
            name:          `Logo ${areaName} (${slot === 'alt' ? 'alternativa' : 'principal'})`,
            placeName:     areaName,
            tags:          ['logo', areaName.toLowerCase(), slot],
            copyright:     `© ${new Date().getFullYear()} ${areaName}`,
            url, path,
            originalName: file.name,
            sizeMB: parseFloat((blob.size / 1024 / 1024).toFixed(2)),
            width, height,
          });
        } catch (idxErr) {
          console.warn('[portalAreas] index em portal_images falhou (não bloqueia):', idxErr?.message);
        }
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
      // 4.48.0+ (Sprint 6b Phase 3) — coleta os novos campos fonts/editorial/modules.
      // Backward compat: legacy fields (colors, logos) continuam mesmo lugar.
      const headline    = document.getElementById('area-font-headline')?.value || 'Poppins';
      const body        = document.getElementById('area-font-body')?.value || 'Poppins';
      const accentScale = document.querySelector('input[name="area-font-scale"]:checked')?.value || 'normal';
      const voice        = document.querySelector('input[name="area-voice"]:checked')?.value || 'caloroso';
      const sectionStyle = document.querySelector('input[name="area-section"]:checked')?.value || 'revista';
      const coverStyle   = document.querySelector('input[name="area-cover"]:checked')?.value || 'fullbleed';
      const chromeAccent = document.querySelector('input[name="area-chrome"]:checked')?.value || 'white';

      // Module overrides — só salva se diferente do default ('' = herdar)
      const buildModuleOverride = (key) => {
        const cp = document.getElementById(`area-mod-${key}-color-primary`)?.value || '';
        const fh = document.getElementById(`area-mod-${key}-font-headline`)?.value || '';
        const fb = document.getElementById(`area-mod-${key}-font-body`)?.value || '';
        const out = {};
        if (cp && cp !== '#475569') out.colors = { primary: cp };
        if (fh || fb) {
          out.fonts = {};
          if (fh) out.fonts.headline = fh;
          if (fb) out.fonts.body     = fb;
        }
        return Object.keys(out).length ? out : null;
      };
      const portalOv         = buildModuleOverride('portal');
      // v4.63.28+ Rename roteiros→cotacoes — coleta dos selects renderizados com
      // key='cotacoes'. Save grava SÓ em modules.cotacoes (canônico). Reader
      // (areaDefaults.js:122) tem alias bidirectional pra retrocompat. Cleanup
      // do `modules.roteiros` legacy é defensivo abaixo (cleanLegacyRoteiros).
      const cotacoesOv       = buildModuleOverride('cotacoes');
      // v4.62.48+ Banco de Roteiros agora também aceita override de cor/fonte
      // (antes só portal/roteiros — banco-roteiros era zumbi em modules.X.colors/fonts).
      const bancoRoteirosOv  = buildModuleOverride('banco-roteiros');
      const modules = {};
      if (portalOv)         modules.portal           = portalOv;
      if (cotacoesOv)       modules.cotacoes         = cotacoesOv;
      if (bancoRoteirosOv)  modules['banco-roteiros']= bancoRoteirosOv;

      // v4.62.43+ Fase E.2: coleta exports.{pdf,docx,pptx,web} por módulo.
      // Salva só campos não-vazios (mantém schema enxuto).
      const collectExports = (modKey) => {
        const exp = {};
        for (const fmt of ['pdf', 'docx', 'pptx', 'web']) {
          const footer    = document.getElementById(`area-exp-${modKey}-${fmt}-footer`)?.value?.trim()    || '';
          const header    = document.getElementById(`area-exp-${modKey}-${fmt}-header`)?.value?.trim()    || '';
          const hideCover = document.getElementById(`area-exp-${modKey}-${fmt}-hidecover`)?.checked       || false;
          const obj = {};
          if (footer)    obj.footerText = footer;
          if (header)    obj.headerText = header;
          if (hideCover) obj.hideCover  = true;
          if (Object.keys(obj).length) exp[fmt] = obj;
        }
        return Object.keys(exp).length ? exp : null;
      };
      const portalExp        = collectExports('portal');
      // v4.63.28+ key canônica cotacoes (era roteiros). collectExports lê IDs
      // que agora têm prefixo `area-exp-cotacoes-*` por causa do rename na UI.
      const cotacoesExp      = collectExports('cotacoes');
      const bancoRoteirosExp = collectExports('banco-roteiros');
      if (portalExp)        modules.portal           = { ...(modules.portal || {}),           exports: portalExp };
      if (cotacoesExp)      modules.cotacoes         = { ...(modules.cotacoes || {}),         exports: cotacoesExp };
      if (bancoRoteirosExp) modules['banco-roteiros']= { ...(modules['banco-roteiros'] || {}),exports: bancoRoteirosExp };

      // v4.63.28+ Cleanup legacy: saveArea usa setDoc(..., {merge:true}) que faz
      // shallow merge. Quando enviamos `modules: {portal, cotacoes, banco}`, o
      // modules inteiro é substituído — `modules.roteiros` legacy desaparece
      // automaticamente. Migration silenciosa: legacy persiste até user editar
      // a área 1× (próxima edição já grava só cotacoes). Reader em
      // areaDefaults.js:122 garante backward compat enquanto isso.

      // v4.62.40 Fase B.1: brand.useExternalName toggle (D7)
      const useExternalName = document.getElementById('area-use-external-name')?.checked !== false;

      // v4.63.10+ coleta templateRefs da tab Templates
      // v4.63.26+ Fix B11: se a tab Templates NÃO foi renderizada (user só
      // editou outras tabs), querySelectorAll retorna 0 selects → templateRefs
      // ficaria {} → save grava null → **zera config existente**. Defensive:
      // se 0 selects, preserva o que já estava no area.templateRefs original.
      const tplSelects = modal.querySelectorAll('.area-tpl-ref-select');
      let templateRefs = null;
      if (tplSelects.length > 0) {
        templateRefs = {};
        tplSelects.forEach(sel => {
          const mod = sel.dataset.tplMod;
          const fmt = sel.dataset.tplFmt;
          const val = sel.value;
          if (val) {
            if (!templateRefs[mod]) templateRefs[mod] = {};
            templateRefs[mod][fmt] = val;
          }
        });
      } else {
        // Tab Templates não foi acessada nesta sessão de edit → manter doc atual.
        templateRefs = area?.templateRefs || null;
      }

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
        // 4.48.0+ NEW
        fonts:     { headline, body, accentScale },
        editorial: { voice, sectionStyle, coverStyle, chromeAccent },
        modules:   Object.keys(modules).length ? modules : null,
        // v4.62.40 Fase B.1 — toggle externalName (D7 fix)
        brand:     { useExternalName },
        // v4.63.10+ atribuição template→área (generators honram em v4.63.11+)
        // v4.63.26+ templateRefs já preserva valor original se tab não foi aberta (B11 fix)
        templateRefs: (templateRefs && Object.keys(templateRefs).length) ? templateRefs : null,
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
