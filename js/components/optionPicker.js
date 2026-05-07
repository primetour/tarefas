/**
 * PRIMETOUR — Option Picker (componente genérico de dropdown visual)
 *
 * Substitui <select> nativos por um popover visualmente rico, padronizado
 * pra todos os campos do app. Suporta:
 *   - Lista plana ou agrupada (com acordeão por grupo)
 *   - Busca em tempo real (filtra items + força grupos com match a expandir)
 *   - Item visual: bolinha colorida + ícone + label + sublabel + cor de marca
 *   - Empty option opcional ("— Padrão (sem tipo) —", "— Selecionar —", etc.)
 *   - Posicionamento clamped na viewport (abre acima se não couber abaixo)
 *   - Keyboard: Esc fecha; click fora fecha
 *
 * Pattern: <button visível> + <select escondido> que mantém o `value`.
 * Click no botão → abre popover. Selecionar → atualiza select + dispara
 * `change` event (compatível com listeners existentes).
 *
 * Uso típico em taskModal.js (e onde mais aparecer no futuro):
 *
 *   bindOptionPicker({
 *     btnId:    'tm-area-btn',
 *     selectId: 'tm-area',
 *     buildOptions: () => REQUESTING_AREAS.map(a => ({ id: a, label: a })),
 *     emptyLabel: '— Selecionar área —',
 *   });
 */

import { store } from '../store.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ─── Constantes visuais ────────────────────────────────────── */
const POPOVER_WIDTH    = 380;
const POPOVER_MAX_H    = 420;
const ITEM_PADDING     = '8px 14px';
const ITEM_PADDING_GRP = '8px 14px 8px 32px';

/**
 * Renderiza o HTML do botão visível que substitui um <select>. Use no template
 * do componente que possui o picker. O select escondido continua sendo a
 * fonte de verdade pro save.
 *
 * @param {object} opts
 * @param {string} opts.btnId  - id do botão (pra referência via document.getElementById)
 * @param {object?} opts.selected  - opção atualmente selecionada {id, label, icon, color, sublabel}
 * @param {string} opts.emptyLabel - texto quando nada está selecionado
 * @returns {string} HTML
 */
export function renderPickerButton({ btnId, selected = null, emptyLabel = '— Selecionar —' }) {
  const dot = selected?.color || 'var(--border-default)';
  const iconHtml = selected && selected.icon
    ? `<span style="font-size:1rem;flex-shrink:0;">${esc(selected.icon)}</span>`
    : '';
  const inner = selected
    ? `${iconHtml}
       <span style="flex:1;font-weight:500;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(selected.label || '')}</span>
       ${selected.sublabel ? `<span style="font-size:0.6875rem;color:var(--text-muted);font-weight:400;flex-shrink:0;">${esc(selected.sublabel)}</span>` : ''}`
    : `<span style="flex:1;color:var(--text-muted);">${esc(emptyLabel)}</span>`;
  return `
    <button type="button" id="${esc(btnId)}"
      style="width:100%;display:flex;align-items:center;gap:10px;
        padding:8px 12px;border-radius:var(--radius-md);cursor:pointer;
        background:var(--bg-surface);border:1px solid var(--border-default);
        font-family:inherit;font-size:0.875rem;text-align:left;
        transition:border-color 0.15s;">
      <span style="width:8px;height:8px;border-radius:50%;background:${dot};flex-shrink:0;"></span>
      ${inner}
      <span style="font-size:0.625rem;color:var(--text-muted);flex-shrink:0;">▾</span>
    </button>
  `;
}

/**
 * Atualiza o conteúdo do botão (ícone/label/sublabel/cor) após seleção.
 * Reutiliza renderPickerButton mas só preenche o innerHTML (sem re-criar
 * o elemento — preserva listeners).
 */
export function refreshPickerButton(btnId, { selected = null, emptyLabel = '— Selecionar —' } = {}) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const dot = selected?.color || 'var(--border-default)';
  const iconHtml = selected && selected.icon
    ? `<span style="font-size:1rem;flex-shrink:0;">${esc(selected.icon)}</span>`
    : '';
  const inner = selected
    ? `${iconHtml}
       <span style="flex:1;font-weight:500;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(selected.label || '')}</span>
       ${selected.sublabel ? `<span style="font-size:0.6875rem;color:var(--text-muted);font-weight:400;flex-shrink:0;">${esc(selected.sublabel)}</span>` : ''}`
    : `<span style="flex:1;color:var(--text-muted);">${esc(emptyLabel)}</span>`;
  btn.innerHTML = `
    <span style="width:8px;height:8px;border-radius:50%;background:${dot};flex-shrink:0;"></span>
    ${inner}
    <span style="font-size:0.625rem;color:var(--text-muted);flex-shrink:0;">▾</span>
  `;
}

/**
 * Abre o popover de seleção.
 *
 * @param {HTMLElement} anchor - elemento que ancora o popover (botão clicado)
 * @param {object} config
 * @param {string} config.currentId - id selecionado atualmente
 * @param {Array}  config.options   - lista plana de items {id, label, icon, color, sublabel}
 * @param {Array?} config.groups    - alternativa: agrupado [{ id, label, color, icon, items: [...] }]
 * @param {object?} config.empty    - { id: '', label: '— ... —' } se quiser opção vazia
 * @param {string} config.searchPlaceholder - placeholder do input
 * @param {Function} onSelect - callback(newId)
 */
export function openOptionPicker(anchor, config, onSelect) {
  document.querySelectorAll('.option-picker-popover').forEach(p => p.remove());

  const {
    currentId = '',
    options = null,
    groups = null,
    empty = null,
    searchPlaceholder = 'Buscar…',
  } = config;

  const useGroups = Array.isArray(groups) && groups.length > 0;

  const pop = document.createElement('div');
  pop.className = 'option-picker-popover';
  Object.assign(pop.style, {
    position:     'fixed',
    zIndex:       '10000',
    background:   'var(--bg-card)',
    border:       '1px solid var(--border-default)',
    borderRadius: 'var(--radius-md, 8px)',
    boxShadow:    '0 12px 32px rgba(0,0,0,0.45)',
    width:        POPOVER_WIDTH + 'px',
    maxWidth:     'calc(100vw - 32px)',
    maxHeight:    POPOVER_MAX_H + 'px',
    display:      'flex',
    flexDirection: 'column',
    fontFamily:   'var(--font-ui)',
    overflow:     'hidden',
  });

  const renderItem = (it, indented = false) => {
    const isSelected = it.id === currentId;
    const padding = indented ? ITEM_PADDING_GRP : ITEM_PADDING;
    const searchText = `${it.label || ''} ${it.sublabel || ''}`.toLowerCase();
    // Quadradinho colorido — se item não tem ícone (ex: status onde a cor já
    // identifica), vira só um swatch sem glifo dentro.
    const swatchInner = it.icon ? esc(it.icon) : '';
    return `<button type="button" class="option-picker-item"
      data-id="${esc(it.id)}"
      data-search="${esc(searchText)}"
      style="width:100%;display:flex;align-items:center;gap:10px;
      padding:${padding};background:${isSelected?'rgba(212,168,67,0.06)':'transparent'};
      border:none;cursor:pointer;font-family:inherit;font-size:0.8125rem;text-align:left;
      color:var(--text-primary);transition:background 0.1s;">
      <span style="width:${it.icon?'28px':'14px'};height:${it.icon?'28px':'14px'};border-radius:${it.icon?'6px':'50%'};
        background:${(it.color || '#6B7280')}${it.icon?'20':''};color:${it.color || '#6B7280'};
        display:flex;align-items:center;justify-content:center;font-size:0.875rem;
        flex-shrink:0;">${swatchInner}</span>
      <span style="flex:1;min-width:0;">
        <span style="display:block;font-weight:${isSelected?'600':'500'};
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${esc(it.label || '')}
        </span>
        ${it.sublabel ? `
          <span style="font-size:0.6875rem;color:var(--text-muted);">
            ${esc(it.sublabel)}
          </span>
        ` : ''}
      </span>
      ${isSelected ? '<span style="color:var(--brand-gold);font-size:0.875rem;">✓</span>' : ''}
    </button>`;
  };

  const renderEmpty = () => {
    if (!empty) return '';
    const isSelected = empty.id === currentId;
    return `<button type="button" class="option-picker-item" data-id="${esc(empty.id || '')}"
      style="width:100%;display:flex;align-items:center;gap:10px;
      padding:${ITEM_PADDING};background:transparent;border:none;cursor:pointer;
      font-family:inherit;font-size:0.8125rem;text-align:left;
      color:${isSelected?'var(--brand-gold)':'var(--text-secondary)'};
      ${isSelected ? 'background:rgba(212,168,67,0.06);' : ''}">
      <span style="width:8px;height:8px;border-radius:50%;background:var(--border-default);flex-shrink:0;"></span>
      <span style="flex:1;font-weight:${isSelected ? '600' : '400'};">${esc(empty.label || '— —')}</span>
      ${isSelected ? '<span style="color:var(--brand-gold);">✓</span>' : ''}
    </button>`;
  };

  const renderGroup = (g, idx) => {
    // Default: todos colapsados. User mira o squad que precisa, sem scroll
    // vertical. Busca expande automaticamente os grupos com match.
    // Exceção: se o item selecionado atual está dentro deste grupo, abre.
    const containsSelected = currentId && (g.items || []).some(it => it.id === currentId);
    const expanded = containsSelected;
    return `
    <div class="option-picker-group" data-group="${esc(g.id || g.label)}" data-expanded="${expanded ? '1' : '0'}">
      <button type="button" class="option-picker-group-header"
        style="width:100%;display:flex;align-items:center;gap:8px;
        padding:10px 14px 6px;background:transparent;border:none;
        ${idx === 0 ? '' : 'border-top:1px solid var(--border-subtle);'}
        cursor:pointer;font-family:inherit;text-align:left;color:var(--text-secondary);">
        <span class="option-picker-group-chevron"
          style="font-size:0.625rem;color:var(--text-muted);transition:transform 0.15s;
          ${expanded ? '' : 'transform:rotate(-90deg);'}">▾</span>
        <span style="width:8px;height:8px;border-radius:50%;background:${g.color || '#6366F1'};flex-shrink:0;"></span>
        <span style="font-size:0.6875rem;font-weight:600;text-transform:uppercase;
          letter-spacing:0.05em;flex:1;">
          ${esc(g.icon || '')} ${esc(g.label || 'Grupo')}
        </span>
        <span style="font-size:0.6875rem;color:var(--text-muted);font-weight:400;text-transform:none;">
          ${(g.items || []).length}
        </span>
      </button>
      <div class="option-picker-group-body" style="${expanded ? '' : 'display:none;'}">
        ${(g.items || []).map(it => renderItem(it, true)).join('')}
      </div>
    </div>
  `;
  };

  pop.innerHTML = `
    <div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle);">
      <input type="text" class="option-picker-search" placeholder="${esc(searchPlaceholder)}"
        style="width:100%;padding:7px 10px;border:1px solid var(--border-default);
        border-radius:var(--radius-sm);background:var(--bg-surface);
        color:var(--text-primary);font-family:inherit;font-size:0.8125rem;outline:none;
        box-sizing:border-box;" />
    </div>
    <div class="option-picker-list" style="overflow-y:auto;flex:1;padding:4px 0;">
      ${renderEmpty()}
      ${useGroups
        ? groups.map((g, i) => renderGroup(g, i)).join('')
        : (options || []).map(it => renderItem(it, false)).join('')}
    </div>
  `;
  document.body.appendChild(pop);

  // Posicionamento clamped
  const rect = anchor.getBoundingClientRect();
  let left = rect.left;
  let top  = rect.bottom + 6;
  const popRect = pop.getBoundingClientRect();
  const margin = 8;
  if (left + popRect.width > window.innerWidth - margin) {
    left = window.innerWidth - popRect.width - margin;
  }
  if (left < margin) left = margin;
  if (top + popRect.height > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - popRect.height - 6);
  }
  pop.style.left = `${left}px`;
  pop.style.top  = `${top}px`;

  function cleanup() {
    pop.remove();
    document.removeEventListener('click', outsideHandler, true);
    document.removeEventListener('keydown', escHandler);
  }
  function outsideHandler(e) {
    if (!pop.contains(e.target) && !anchor.contains(e.target)) cleanup();
  }
  function escHandler(e) {
    if (e.key === 'Escape') cleanup();
  }

  // Hover + click nos items
  pop.querySelectorAll('.option-picker-item').forEach(item => {
    item.addEventListener('mouseenter', () => {
      if (item.dataset.id !== currentId) {
        item.style.background = 'rgba(212,168,67,0.04)';
      }
    });
    item.addEventListener('mouseleave', () => {
      if (item.dataset.id !== currentId) {
        item.style.background = 'transparent';
      }
    });
    item.addEventListener('click', () => {
      onSelect(item.dataset.id);
      cleanup();
    });
  });

  // Acordeão (click no header expande/recolhe)
  pop.querySelectorAll('.option-picker-group-header').forEach(header => {
    header.addEventListener('click', (e) => {
      e.stopPropagation();
      const group = header.closest('.option-picker-group');
      const expanded = group.dataset.expanded === '1';
      group.dataset.expanded = expanded ? '0' : '1';
      const body = group.querySelector('.option-picker-group-body');
      const chev = header.querySelector('.option-picker-group-chevron');
      if (body) body.style.display = expanded ? 'none' : '';
      if (chev) chev.style.transform = expanded ? 'rotate(-90deg)' : 'rotate(0deg)';
    });
  });

  // Busca
  const search = pop.querySelector('.option-picker-search');
  search?.addEventListener('input', () => {
    const q = (search.value || '').toLowerCase().trim();
    pop.querySelectorAll('.option-picker-item').forEach(item => {
      if (!item.dataset.search) {
        // empty option sempre visível
        item.style.display = '';
        return;
      }
      item.style.display = item.dataset.search.includes(q) ? '' : 'none';
    });
    pop.querySelectorAll('.option-picker-group').forEach(g => {
      const visible = [...g.querySelectorAll('.option-picker-item')].some(i => i.style.display !== 'none');
      g.style.display = visible ? '' : 'none';
      if (q && visible) {
        g.dataset.expanded = '1';
        const body = g.querySelector('.option-picker-group-body');
        const chev = g.querySelector('.option-picker-group-chevron');
        if (body) body.style.display = '';
        if (chev) chev.style.transform = 'rotate(0deg)';
      }
    });
  });
  setTimeout(() => search?.focus(), 30);

  setTimeout(() => {
    document.addEventListener('click', outsideHandler, true);
    document.addEventListener('keydown', escHandler);
  }, 0);
}

/**
 * bindOptionPicker — wire up shortcut. Recebe ids do botão e select escondido,
 * função pra construir options dinamicamente, e (opcional) função pra mapear
 * a opção selecionada quando precisa exibir no botão.
 *
 * @param {object} cfg
 * @param {string} cfg.btnId
 * @param {string} cfg.selectId
 * @param {Function} cfg.buildConfig - () => { options OR groups, empty?, searchPlaceholder? }
 * @param {Function?} cfg.findSelected - (id) => option object pro botão (default: lookup em options/groups)
 * @param {string?} cfg.emptyLabel - texto exibido quando nada selecionado no botão
 * @param {Function?} cfg.onChange  - callback(newId, selectedOption) extra além do change event no select
 */
export function bindOptionPicker(cfg) {
  const { btnId, selectId, buildConfig, findSelected, emptyLabel = '— Selecionar —', onChange } = cfg;
  const btn = document.getElementById(btnId);
  const select = document.getElementById(selectId);
  if (!btn || !select) return;

  const lookupOption = (id) => {
    if (typeof findSelected === 'function') return findSelected(id);
    const conf = buildConfig();
    if (Array.isArray(conf.options)) return conf.options.find(o => o.id === id) || null;
    if (Array.isArray(conf.groups)) {
      for (const g of conf.groups) {
        const found = (g.items || []).find(i => i.id === id);
        if (found) return found;
      }
    }
    return null;
  };

  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const conf = buildConfig();
    openOptionPicker(btn, { ...conf, currentId: select.value }, (newId) => {
      select.value = newId;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const sel = lookupOption(newId);
      refreshPickerButton(btnId, { selected: sel, emptyLabel });
      if (typeof onChange === 'function') onChange(newId, sel);
    });
  });

  // Sync externo: se outro código fizer `select.value = X` + dispatchEvent('change'),
  // o botão visual reflete automaticamente. Pra atualizar SÓ visual sem disparar
  // efeitos colaterais (cascata, re-render), use `dispatchEvent(new Event('picker-refresh'))`.
  const syncBtn = () => {
    const cur = lookupOption(select.value);
    refreshPickerButton(btnId, { selected: cur, emptyLabel });
  };
  select.addEventListener('change', syncBtn);
  select.addEventListener('picker-refresh', syncBtn);

  // Sync inicial: garante que o botão reflete o value atual
  const sel = lookupOption(select.value);
  refreshPickerButton(btnId, { selected: sel, emptyLabel });
}

/* ════════════════════════════════════════════════════════════
 * MULTI-SELECT PICKER (4.21+)
 * Para filtros que permitem múltiplos valores (ex: filtro de
 * responsável aceita N usuários). Mantém o single-select acima
 * intacto pra não regredir todos os outros pickers.
 * ════════════════════════════════════════════════════════════ */

/**
 * renderMultiPickerButton — botão visual que substitui um <select multiple>.
 * Mostra: bolinha cinza + label adaptativo ("Todos os X" / "Nome" / "N selecionados") + chevron.
 */
export function renderMultiPickerButton({ btnId, selectedItems = [], emptyLabel = '— Selecionar —' }) {
  const n = selectedItems.length;
  let inner;
  if (n === 0) {
    inner = `<span style="flex:1;color:var(--text-muted);">${esc(emptyLabel)}</span>`;
  } else if (n === 1) {
    const s = selectedItems[0];
    const iconHtml = s.icon ? `<span style="font-size:1rem;flex-shrink:0;">${esc(s.icon)}</span>` : '';
    inner = `${iconHtml}
       <span style="flex:1;font-weight:500;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.label || '')}</span>`;
  } else {
    inner = `<span style="flex:1;font-weight:500;color:var(--text-primary);">${n} selecionados</span>`;
  }
  const dot = n === 1 ? (selectedItems[0].color || 'var(--border-default)') : (n > 1 ? 'var(--brand-gold)' : 'var(--border-default)');
  return `
    <button type="button" id="${esc(btnId)}"
      style="width:100%;display:flex;align-items:center;gap:10px;
        padding:8px 12px;border-radius:var(--radius-md);cursor:pointer;
        background:var(--bg-surface);border:1px solid var(--border-default);
        font-family:inherit;font-size:0.875rem;text-align:left;
        transition:border-color 0.15s;">
      <span style="width:8px;height:8px;border-radius:50%;background:${dot};flex-shrink:0;"></span>
      ${inner}
      <span style="font-size:0.625rem;color:var(--text-muted);flex-shrink:0;">▾</span>
    </button>
  `;
}

export function refreshMultiPickerButton(btnId, { selectedItems = [], emptyLabel = '— Selecionar —' } = {}) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  // Re-render usando o mesmo helper inline
  const html = renderMultiPickerButton({ btnId, selectedItems, emptyLabel })
    .replace(/^\s*<button[^>]*>/, '')
    .replace(/<\/button>\s*$/, '');
  btn.innerHTML = html;
}

/**
 * openMultiOptionPicker — popover multi-select com checkboxes, busca,
 * "Selecionar todos" / "Limpar". Não fecha ao clicar item — só ao clicar fora,
 * Esc, ou no botão "Aplicar".
 *
 * @param {HTMLElement} anchor
 * @param {object} config
 * @param {Array}  config.options    - {id, label, icon, color, sublabel}
 * @param {Array}  config.currentIds - ids atualmente selecionados
 * @param {string} config.searchPlaceholder
 * @param {Function} onChange - callback(idsArray) chamado a cada toggle (live)
 */
export function openMultiOptionPicker(anchor, config, onChange) {
  document.querySelectorAll('.option-picker-popover').forEach(p => p.remove());

  const {
    options = [],
    currentIds = [],
    searchPlaceholder = 'Buscar…',
  } = config;

  const selected = new Set(currentIds);

  const pop = document.createElement('div');
  pop.className = 'option-picker-popover';
  Object.assign(pop.style, {
    position: 'fixed', zIndex: '10000',
    background: 'var(--bg-card)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-md, 8px)',
    boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
    width: POPOVER_WIDTH + 'px',
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: POPOVER_MAX_H + 'px',
    display: 'flex', flexDirection: 'column',
    fontFamily: 'var(--font-ui)',
    overflow: 'hidden',
  });

  const renderItem = (it) => {
    const isChecked = selected.has(it.id);
    const searchText = `${it.label || ''} ${it.sublabel || ''}`.toLowerCase();
    const swatchInner = it.icon ? esc(it.icon) : '';
    return `<button type="button" class="option-picker-item"
      data-id="${esc(it.id)}"
      data-search="${esc(searchText)}"
      style="width:100%;display:flex;align-items:center;gap:10px;
      padding:${ITEM_PADDING};background:${isChecked ? 'rgba(212,168,67,0.06)' : 'transparent'};
      border:none;cursor:pointer;font-family:inherit;font-size:0.8125rem;text-align:left;
      color:var(--text-primary);transition:background 0.1s;">
      <span class="opm-check" style="width:16px;height:16px;flex-shrink:0;
        border:1.5px solid ${isChecked ? 'var(--brand-gold)' : 'var(--border-default)'};
        background:${isChecked ? 'var(--brand-gold)' : 'transparent'};
        border-radius:3px;display:flex;align-items:center;justify-content:center;
        color:#fff;font-size:0.75rem;font-weight:700;line-height:1;">
        ${isChecked ? '✓' : ''}
      </span>
      <span style="width:${it.icon ? '24px' : '12px'};height:${it.icon ? '24px' : '12px'};
        border-radius:${it.icon ? '5px' : '50%'};
        background:${(it.color || '#6B7280')}${it.icon ? '20' : ''};
        color:${it.color || '#6B7280'};
        display:flex;align-items:center;justify-content:center;font-size:0.8125rem;
        flex-shrink:0;">${swatchInner}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${esc(it.label || '')}
      </span>
    </button>`;
  };

  pop.innerHTML = `
    <div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle);
      display:flex;flex-direction:column;gap:8px;">
      <input type="text" class="option-picker-search" placeholder="${esc(searchPlaceholder)}"
        style="width:100%;padding:7px 10px;border:1px solid var(--border-default);
        border-radius:var(--radius-sm);background:var(--bg-surface);
        color:var(--text-primary);font-family:inherit;font-size:0.8125rem;outline:none;
        box-sizing:border-box;" />
      <div style="display:flex;gap:8px;align-items:center;font-size:0.6875rem;">
        <button type="button" class="opm-select-all"
          style="background:none;border:none;color:var(--brand-gold);cursor:pointer;
          font-family:inherit;font-size:0.6875rem;font-weight:500;padding:2px 4px;">
          Selecionar todos
        </button>
        <span style="color:var(--text-muted);">·</span>
        <button type="button" class="opm-clear"
          style="background:none;border:none;color:var(--text-muted);cursor:pointer;
          font-family:inherit;font-size:0.6875rem;font-weight:500;padding:2px 4px;">
          Limpar
        </button>
        <span class="opm-count" style="margin-left:auto;color:var(--text-muted);font-size:0.6875rem;">
          ${selected.size} selecionado${selected.size === 1 ? '' : 's'}
        </span>
      </div>
    </div>
    <div class="option-picker-list" style="overflow-y:auto;flex:1;padding:4px 0;">
      ${options.map(it => renderItem(it)).join('')}
    </div>
  `;
  document.body.appendChild(pop);

  // Posicionamento clamped (mesma lógica do single-select)
  const rect = anchor.getBoundingClientRect();
  let left = rect.left;
  let top = rect.bottom + 6;
  const popRect = pop.getBoundingClientRect();
  const margin = 8;
  if (left + popRect.width > window.innerWidth - margin) {
    left = window.innerWidth - popRect.width - margin;
  }
  if (left < margin) left = margin;
  if (top + popRect.height > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - popRect.height - 6);
  }
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;

  function cleanup() {
    pop.remove();
    document.removeEventListener('click', outsideHandler, true);
    document.removeEventListener('keydown', escHandler);
  }
  function outsideHandler(e) {
    if (!pop.contains(e.target) && !anchor.contains(e.target)) cleanup();
  }
  function escHandler(e) { if (e.key === 'Escape') cleanup(); }

  function notify() {
    onChange(Array.from(selected));
  }

  function rerenderItem(itemEl, it) {
    const isChecked = selected.has(it.id);
    itemEl.style.background = isChecked ? 'rgba(212,168,67,0.06)' : 'transparent';
    const ck = itemEl.querySelector('.opm-check');
    if (ck) {
      ck.style.borderColor = isChecked ? 'var(--brand-gold)' : 'var(--border-default)';
      ck.style.background = isChecked ? 'var(--brand-gold)' : 'transparent';
      ck.textContent = isChecked ? '✓' : '';
    }
  }
  function refreshCount() {
    const c = pop.querySelector('.opm-count');
    if (c) c.textContent = `${selected.size} selecionado${selected.size === 1 ? '' : 's'}`;
  }

  pop.querySelectorAll('.option-picker-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      const it = options.find(o => o.id === id);
      if (it) rerenderItem(item, it);
      refreshCount();
      notify();
    });
  });

  pop.querySelector('.opm-select-all')?.addEventListener('click', () => {
    options.forEach(it => selected.add(it.id));
    pop.querySelectorAll('.option-picker-item').forEach(itemEl => {
      const it = options.find(o => o.id === itemEl.dataset.id);
      if (it) rerenderItem(itemEl, it);
    });
    refreshCount();
    notify();
  });
  pop.querySelector('.opm-clear')?.addEventListener('click', () => {
    selected.clear();
    pop.querySelectorAll('.option-picker-item').forEach(itemEl => {
      const it = options.find(o => o.id === itemEl.dataset.id);
      if (it) rerenderItem(itemEl, it);
    });
    refreshCount();
    notify();
  });

  // Busca
  const search = pop.querySelector('.option-picker-search');
  search?.addEventListener('input', () => {
    const q = (search.value || '').toLowerCase().trim();
    pop.querySelectorAll('.option-picker-item').forEach(item => {
      item.style.display = item.dataset.search.includes(q) ? '' : 'none';
    });
  });
  setTimeout(() => search?.focus(), 30);

  setTimeout(() => {
    document.addEventListener('click', outsideHandler, true);
    document.addEventListener('keydown', escHandler);
  }, 0);
}

/**
 * bindMultiOptionPicker — wire-up de botão visual + estado externo.
 * Diferente do single-select: como um <select multiple> nativo é meio chato
 * de manter sincronizado, o estado fica em `getValues()`/`setValues()`
 * fornecidos pelo caller. O componente só renderiza e dispara onChange.
 */
export function bindMultiOptionPicker(cfg) {
  const {
    btnId,
    buildOptions,    // () => [{id,label,icon,color,...}]
    getValues,       // () => string[]
    setValues,       // (string[]) => void  (dispara o filtro)
    emptyLabel = '— Selecionar —',
    searchPlaceholder = 'Buscar…',
  } = cfg;
  const btn = document.getElementById(btnId);
  if (!btn) return;

  const lookupItems = (ids) => {
    const opts = buildOptions();
    return ids.map(id => opts.find(o => o.id === id)).filter(Boolean);
  };

  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const opts = buildOptions();
    openMultiOptionPicker(btn, {
      options: opts,
      currentIds: getValues(),
      searchPlaceholder,
    }, (newIds) => {
      setValues(newIds);
      refreshMultiPickerButton(btnId, { selectedItems: lookupItems(newIds), emptyLabel });
    });
  });

  // Sync inicial
  refreshMultiPickerButton(btnId, { selectedItems: lookupItems(getValues()), emptyLabel });
}

// Re-export pra debug/teste
export { store as _store };
