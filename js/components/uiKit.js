/**
 * PRIMETOUR — UI Kit
 * Componentes reutilizáveis pra padronizar headers, filtros, exports e tabs
 * em todas as páginas de listagem.
 *
 * USO típico numa página:
 *
 *   import { renderPageHeader, renderFilterBar, renderExportMenu, renderPeriodPills, renderTabs } from '../components/uiKit.js';
 *
 *   container.innerHTML = `
 *     ${renderPageHeader({
 *       title: 'Tarefas',
 *       subtitle: 'Gerencie tarefas da equipe',
 *       primary: { label: '+ Nova Tarefa', action: 'new-task' },
 *       secondary: [
 *         { label: '✉ Email → Tarefa', action: 'email-task' },
 *         { label: '⊕ Solicitação', action: 'new-request' },
 *         { label: '↑ Importar', action: 'import' },
 *       ],
 *       export: { formats: ['xls', 'pdf'], action: 'export' },
 *     })}
 *     ${renderFilterBar({
 *       pills: [...],
 *       search: { placeholder: 'Buscar...' },
 *       selects: [...],
 *       periodPills: true,
 *     })}
 *   `;
 *
 *   wireExportMenu(container);  // ativa o dropdown do Export
 *   wirePeriodPills(container, onChange);  // ativa as pills de período
 */

const esc = s => s == null ? '' : String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ═══════════════════════════════════════════════════════════════
   PAGE HEADER
   ═══════════════════════════════════════════════════════════════ */

/**
 * Renderiza header padrão de página de listagem.
 *
 * @param {Object} cfg
 * @param {string} cfg.title - Título da página
 * @param {string} [cfg.subtitle] - Subtítulo (linha menor abaixo)
 * @param {Object} [cfg.primary] - Botão primário (gold). { label, action, icon? }
 * @param {Array}  [cfg.secondary] - Botões secundários. Se >3, agrupa em ⋮ Mais.
 * @param {Object} [cfg.export] - { formats: ['xls','pdf','pptx','docx'], action: 'export' }
 *                                Renderiza split-button "↓ Exportar ▾"
 * @returns {string} HTML
 */
export function renderPageHeader({ title, subtitle, primary, secondary = [], export: exportCfg } = {}) {
  const exportBtn = exportCfg?.formats?.length ? renderExportMenu(exportCfg) : '';

  // Se >3 secundários, agrupa todos em menu "⋮ Mais"
  const useOverflow = secondary.length > 3;
  const visibleSecondary = useOverflow ? [] : secondary;
  const overflowSecondary = useOverflow ? secondary : [];

  const visibleBtnsHTML = visibleSecondary.map(b => `
    <button class="btn btn-secondary" data-action="${esc(b.action)}" ${b.title ? `title="${esc(b.title)}"` : ''}>
      ${b.icon ? esc(b.icon) + ' ' : ''}${esc(b.label)}
    </button>
  `).join('');

  const overflowMenuHTML = overflowSecondary.length ? `
    <div class="uikit-overflow-wrap" style="position:relative;display:inline-block;">
      <button class="btn btn-secondary uikit-overflow-trigger" data-overflow-trigger="1" title="Mais ações" style="padding:6px 10px;">⋮</button>
      <div class="uikit-overflow-menu" style="display:none;position:absolute;top:100%;right:0;margin-top:4px;
        background:var(--bg-card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:8px;
        min-width:200px;box-shadow:0 4px 12px rgba(0,0,0,0.1);z-index:100;padding:4px;">
        ${overflowSecondary.map(b => `
          <button class="uikit-overflow-item" data-action="${esc(b.action)}"
            style="display:block;width:100%;text-align:left;padding:8px 12px;background:transparent;
            border:none;cursor:pointer;font-size:0.875rem;color:var(--text-primary);border-radius:6px;
            font-family:inherit;" ${b.title ? `title="${esc(b.title)}"` : ''}>
            ${b.icon ? esc(b.icon) + ' ' : ''}${esc(b.label)}
          </button>
        `).join('')}
      </div>
    </div>
  ` : '';

  const primaryBtnHTML = primary ? `
    <button class="btn btn-primary" data-action="${esc(primary.action)}" ${primary.title ? `title="${esc(primary.title)}"` : ''}>
      ${primary.icon ? esc(primary.icon) + ' ' : ''}${esc(primary.label)}
    </button>
  ` : '';

  return `
    <div class="page-header uikit-page-header" style="display:flex;justify-content:space-between;
      align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:20px;">
      <div style="min-width:240px;flex:1;">
        <h1 style="font-size:1.5rem;font-weight:700;color:var(--text-primary);margin:0;">
          ${esc(title)}
        </h1>
        ${subtitle ? `<p style="color:var(--text-muted);font-size:0.875rem;margin:4px 0 0;">${esc(subtitle)}</p>` : ''}
      </div>
      <div class="page-actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        ${visibleBtnsHTML}
        ${overflowMenuHTML}
        ${exportBtn}
        ${primaryBtnHTML}
      </div>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════════
   EXPORT MENU (split-button)
   ═══════════════════════════════════════════════════════════════ */

const EXPORT_LABELS = {
  xls:  'Excel (.xlsx)',
  pdf:  'PDF',
  pptx: 'PowerPoint (.pptx)',
  docx: 'Word (.docx)',
  csv:  'CSV',
};

/**
 * Split-button "↓ Exportar ▾" que abre dropdown com formatos.
 * Cada formato dispara `data-action="export-<format>"` (ex: export-xls).
 *
 * @param {Object} cfg
 * @param {string[]} cfg.formats - ['xls', 'pdf', 'pptx', 'docx', 'csv']
 * @param {string} [cfg.action] - prefix de action (default 'export'). Vira 'export-xls' etc.
 * @param {string} [cfg.label]  - texto do botão trigger (default 'Exportar'). v4.49.84+
 */
export function renderExportMenu({ formats = [], action = 'export', label = 'Exportar' } = {}) {
  if (!formats.length) return '';

  return `
    <div class="uikit-export-wrap" style="position:relative;display:inline-block;">
      <button class="btn btn-secondary uikit-export-trigger" data-export-trigger="1"
        style="display:flex;align-items:center;gap:6px;padding:6px 12px;">
        <span>↓</span><span>${esc(label)}</span><span style="font-size:0.6em;">▾</span>
      </button>
      <div class="uikit-export-menu" style="display:none;position:absolute;top:100%;right:0;margin-top:4px;
        background:var(--bg-card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:8px;
        min-width:180px;box-shadow:0 4px 12px rgba(0,0,0,0.1);z-index:100;padding:4px;">
        ${formats.map(f => `
          <button class="uikit-export-item" data-action="${esc(action)}-${esc(f)}"
            style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 12px;
            background:transparent;border:none;cursor:pointer;font-size:0.875rem;color:var(--text-primary);
            border-radius:6px;font-family:inherit;">
            <span style="font-size:0.7em;color:var(--text-muted);width:14px;">↓</span>
            <span>${esc(EXPORT_LABELS[f] || f.toUpperCase())}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

/**
 * Ativa o split-button + overflow menu.
 *
 * Refactor v2: handler INLINE no próprio trigger (.onclick) em vez de
 * event delegation. Delegation falhou em produção quando algum handler
 * intermediário (capture phase) chamava stopPropagation, impedindo o
 * bubble de chegar ao listener no container/document. Inline garante
 * que o trigger SEMPRE responde ao click próprio.
 *
 * Idempotente: pode ser chamado múltiplas vezes (sobrescreve onclick).
 *
 * @param {HTMLElement|Document} root - escopo de busca dos triggers (default: document)
 */
export function wireUiKitMenus(root = document) {
  const triggers = root.querySelectorAll('[data-export-trigger], [data-overflow-trigger]');
  triggers.forEach(trigger => {
    trigger.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wrap = trigger.parentElement;
      const menu = wrap?.querySelector('.uikit-export-menu, .uikit-overflow-menu');
      if (!menu) return;
      const isOpen = menu.style.display === 'block';
      // Fecha TODOS os menus (em qualquer lugar do DOM) primeiro
      document.querySelectorAll('.uikit-export-menu, .uikit-overflow-menu').forEach(m => m.style.display = 'none');
      if (!isOpen) menu.style.display = 'block';
    };
  });

  // Items de menu: ao clicar, fecha o dropdown (mas deixa propagar pro
  // handler de data-action da página)
  const items = root.querySelectorAll('.uikit-export-item, .uikit-overflow-item');
  items.forEach(item => {
    // Não usa onclick aqui — page handler precisa receber o click via bubble.
    // Em vez disso, addEventListener com cleanup via flag.
    if (item._uiKitWired) return;
    item._uiKitWired = true;
    item.addEventListener('click', () => {
      const menu = item.closest('.uikit-export-menu, .uikit-overflow-menu');
      if (menu) menu.style.display = 'none';
    });
  });

  // Click fora fecha menus — único handler global, instalado uma vez
  if (!document._uiKitOutsideHandler) {
    document._uiKitOutsideHandler = true;
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.uikit-export-wrap, .uikit-overflow-wrap')) {
        document.querySelectorAll('.uikit-export-menu, .uikit-overflow-menu').forEach(m => m.style.display = 'none');
      }
    });
  }
}

/* ═══════════════════════════════════════════════════════════════
   PERIOD PILLS (7d / 30d / 90d / 12m / Tudo / Custom)
   ═══════════════════════════════════════════════════════════════ */

export const PERIOD_PRESETS = {
  '7d':    { label: '7 dias',  days: 7 },
  '30d':   { label: '30 dias', days: 30 },
  '90d':   { label: '90 dias', days: 90 },
  '12m':   { label: '12 meses',days: 365 },
  'all':   { label: 'Tudo',    days: null },
  'custom':{ label: 'Período…',days: null, isCustom: true },
};

/**
 * Renderiza pills de período padrão. Estado persistido em data-period.
 * Padrão: '30d' selecionado.
 *
 * @param {Object} [cfg]
 * @param {string} [cfg.active='30d'] - preset ativo
 * @param {string[]} [cfg.show] - quais presets mostrar (default: todos)
 */
export function renderPeriodPills({ active = '30d', show } = {}) {
  const keys = show || Object.keys(PERIOD_PRESETS);
  return `
    <div class="uikit-period-pills" style="display:flex;gap:4px;flex-wrap:wrap;">
      ${keys.map(k => {
        const p = PERIOD_PRESETS[k];
        if (!p) return '';
        return `<button class="uikit-period-pill ${k === active ? 'active' : ''}" data-period="${esc(k)}"
          style="padding:4px 12px;border-radius:999px;font-size:0.75rem;font-weight:600;
          border:1px solid ${k === active ? 'var(--brand-blue,#3B82F6)' : 'var(--border,#e5e7eb)'};
          background:${k === active ? 'var(--brand-blue,#3B82F6)' : 'transparent'};
          color:${k === active ? '#fff' : 'var(--text-muted)'};
          cursor:pointer;transition:all 0.15s;font-family:inherit;">
          ${esc(p.label)}
        </button>`;
      }).join('')}
    </div>`;
}

/**
 * Wire-up: dispara onChange(periodKey, { from, to }) ao trocar.
 * Pra 'custom', dispara modal de date-range (caller deve renderizar).
 */
export function wirePeriodPills(container, onChange) {
  container.addEventListener('click', (e) => {
    const pill = e.target.closest('.uikit-period-pill');
    if (!pill) return;
    container.querySelectorAll('.uikit-period-pill').forEach(p => {
      p.classList.remove('active');
      p.style.background = 'transparent';
      p.style.color = 'var(--text-muted)';
      p.style.borderColor = 'var(--border, #e5e7eb)';
    });
    pill.classList.add('active');
    pill.style.background = 'var(--brand-blue, #3B82F6)';
    pill.style.color = '#fff';
    pill.style.borderColor = 'var(--brand-blue, #3B82F6)';

    const key = pill.dataset.period;
    const preset = PERIOD_PRESETS[key];
    if (!preset) return;

    let from = null, to = null;
    if (preset.days != null) {
      to = new Date();
      from = new Date(Date.now() - preset.days * 86400000);
    }
    onChange?.(key, { from, to, preset });
  });
}

/* ═══════════════════════════════════════════════════════════════
   FILTER BAR
   ═══════════════════════════════════════════════════════════════ */

/**
 * Barra de filtros padronizada.
 *
 * @param {Object} cfg
 * @param {Array} [cfg.statusPills] - [{ value, label, count? }] — pill ativa via active
 * @param {string} [cfg.activeStatus] - valor da pill ativa
 * @param {Object} [cfg.search] - { id, placeholder, value }
 * @param {Array} [cfg.selects] - [{ id, label, options: [{value,label}], value }]
 * @param {Object} [cfg.periodPills] - { active, show? } — passa pra renderPeriodPills
 * @param {string} [cfg.metaText] - texto à esquerda da paginação ("234 itens · pág 2 de 5")
 * @param {string} [cfg.paginationHTML] - HTML pré-renderizado da paginação
 */
export function renderFilterBar({ statusPills, activeStatus = '', search, selects, periodPills, metaText, paginationHTML } = {}) {
  const pillsRow = statusPills?.length ? `
    <div class="uikit-filter-row uikit-status-row" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
      ${statusPills.map(p => `
        <button class="uikit-status-pill ${p.value === activeStatus ? 'active' : ''}" data-filter-status="${esc(p.value)}"
          style="padding:5px 14px;border-radius:999px;font-size:0.8125rem;font-weight:600;
          border:1px solid ${p.value === activeStatus ? 'var(--brand-blue,#3B82F6)' : 'var(--border,#e5e7eb)'};
          background:${p.value === activeStatus ? 'var(--brand-blue,#3B82F6)' : 'transparent'};
          color:${p.value === activeStatus ? '#fff' : 'var(--text-muted)'};
          cursor:pointer;transition:all 0.15s;font-family:inherit;">
          ${esc(p.label)}${p.count != null ? ` <span style="opacity:0.7;font-weight:500;">${p.count}</span>` : ''}
        </button>
      `).join('')}
    </div>
  ` : '';

  const periodRow = periodPills ? `
    <div class="uikit-filter-row uikit-period-row" style="margin-top:8px;">
      ${renderPeriodPills(periodPills)}
    </div>
  ` : '';

  const searchHTML = search ? `
    <div style="position:relative;flex:1;min-width:220px;max-width:340px;">
      <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:0.875rem;
        color:var(--text-muted);pointer-events:none;">🔍</span>
      <input type="text" id="${esc(search.id || 'uikit-search')}" class="filter-select"
        placeholder="${esc(search.placeholder || 'Buscar...')}"
        value="${esc(search.value || '')}"
        style="height:34px;font-size:0.8125rem;padding-left:32px;width:100%;" />
    </div>
  ` : '';

  // Selects usam .filter-select (tem seta SVG nativa via CSS) — antes
  // usávamos .form-input que não renderiza a seta indicadora.
  const selectsHTML = (selects || []).map(s => `
    <select id="${esc(s.id)}" class="filter-select"
      style="height:34px;font-size:0.8125rem;min-width:160px;max-width:220px;">
      <option value="">${esc(s.label || '— Filtrar —')}</option>
      ${(s.options || []).map(o => `
        <option value="${esc(o.value)}" ${o.value === s.value ? 'selected' : ''}>${esc(o.label)}</option>
      `).join('')}
    </select>
  `).join('');

  const filterRow2 = (search || selects?.length) ? `
    <div class="uikit-filter-row uikit-search-row" style="display:flex;gap:8px;align-items:center;
      flex-wrap:wrap;margin-top:${pillsRow || periodRow ? '10px' : '0'};">
      ${searchHTML}
      ${selectsHTML}
    </div>
  ` : '';

  const metaRow = (metaText || paginationHTML) ? `
    <div class="uikit-filter-row uikit-meta-row" style="display:flex;justify-content:space-between;
      align-items:center;font-size:0.75rem;color:var(--text-muted);margin-top:10px;">
      <span>${esc(metaText || '')}</span>
      <div>${paginationHTML || ''}</div>
    </div>
  ` : '';

  return `
    <div class="uikit-filter-bar" style="margin-bottom:16px;">
      ${pillsRow}
      ${periodRow}
      ${filterRow2}
      ${metaRow}
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════════
   TABS BAR (interna a uma página, ex: List / Dashboard / Schedule)
   ═══════════════════════════════════════════════════════════════ */

/**
 * Renderiza barra de tabs internas com underline padrão.
 *
 * @param {Object} cfg
 * @param {Array} cfg.tabs - [{ id, label, icon?, count? }]
 * @param {string} cfg.active - id da tab ativa
 */
export function renderTabsBar({ tabs = [], active } = {}) {
  return `
    <div class="uikit-tabs-bar" style="display:flex;gap:0;border-bottom:1px solid var(--border,#e5e7eb);
      margin-bottom:16px;overflow-x:auto;">
      ${tabs.map(t => {
        const isActive = t.id === active;
        return `<button class="uikit-tab ${isActive ? 'active' : ''}" data-tab="${esc(t.id)}"
          style="padding:10px 20px;background:transparent;border:none;cursor:pointer;
          color:${isActive ? 'var(--brand-blue,#3B82F6)' : 'var(--text-muted)'};
          font-weight:${isActive ? '700' : '500'};font-size:0.875rem;
          border-bottom:2px solid ${isActive ? 'var(--brand-blue,#3B82F6)' : 'transparent'};
          margin-bottom:-1px;transition:all 0.15s;font-family:inherit;white-space:nowrap;">
          ${t.icon ? esc(t.icon) + ' ' : ''}${esc(t.label)}
          ${t.count != null ? `<span style="margin-left:6px;padding:1px 7px;border-radius:999px;
            background:${isActive ? 'var(--brand-blue,#3B82F6)' : 'var(--bg-surface,#f3f4f6)'};
            color:${isActive ? '#fff' : 'var(--text-muted)'};font-size:0.7rem;font-weight:600;">${t.count}</span>` : ''}
        </button>`;
      }).join('')}
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════════
   ESC GLOBAL — fecha modais/popups visíveis ao apertar Esc
   ═══════════════════════════════════════════════════════════════ */

let _escInstalled = false;

/**
 * Instala handler global de Esc. Idempotente — chamar quantas vezes quiser.
 * Ordem de fechamento (apenas o TOPO é fechado por Esc, não todos):
 *   1. Menus abertos do uiKit (.uikit-export-menu, .uikit-overflow-menu)
 *   2. Overlay com z-index mais alto que tenha botão de fechar
 *
 * Convenções suportadas pra "botão fechar" (procura nessa ordem):
 *   - [data-modal-close]
 *   - .modal-close
 *   - [aria-label="Fechar"], [aria-label="Close"]
 *   - .close-btn
 */
export function installGlobalEscHandler() {
  if (_escInstalled) return;
  _escInstalled = true;

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // Não fecha se o foco está num input/textarea com texto sendo digitado
    // (deixa o navegador limpar o campo)
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    if (tag === 'textarea') return;

    // 1. Menus abertos do uiKit
    const openMenu = document.querySelector('.uikit-export-menu[style*="display: block"], .uikit-overflow-menu[style*="display: block"]');
    if (openMenu) {
      openMenu.style.display = 'none';
      e.preventDefault();
      return;
    }

    // 2. Overlay/modal mais "no topo" (maior z-index)
    const overlays = Array.from(document.querySelectorAll('div, aside, section'))
      .filter(el => {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed') return false;
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const z = parseInt(cs.zIndex) || 0;
        if (z < 100) return false; // ignora elementos comuns fixed (sidebar, etc)
        // Tem que ter algum botão de close pra ser modal
        return el.querySelector('[data-modal-close], .modal-close, [aria-label="Fechar"], [aria-label="Close"], .close-btn, [data-close]');
      })
      .sort((a, b) => (parseInt(getComputedStyle(b).zIndex) || 0) - (parseInt(getComputedStyle(a).zIndex) || 0));

    if (overlays.length) {
      const top = overlays[0];
      const closeBtn = top.querySelector('[data-modal-close], .modal-close, [aria-label="Fechar"], [aria-label="Close"], .close-btn, [data-close]');
      if (closeBtn) {
        closeBtn.click();
        e.preventDefault();
      }
    }
  });
}

/**
 * Wire de tabs internas. onChange(tabId).
 */
export function wireTabsBar(container, onChange) {
  container.addEventListener('click', (e) => {
    const tab = e.target.closest('.uikit-tab');
    if (!tab) return;
    container.querySelectorAll('.uikit-tab').forEach(t => {
      t.classList.remove('active');
      t.style.color = 'var(--text-muted)';
      t.style.fontWeight = '500';
      t.style.borderBottomColor = 'transparent';
    });
    tab.classList.add('active');
    tab.style.color = 'var(--brand-blue, #3B82F6)';
    tab.style.fontWeight = '700';
    tab.style.borderBottomColor = 'var(--brand-blue, #3B82F6)';
    onChange?.(tab.dataset.tab);
  });
}
