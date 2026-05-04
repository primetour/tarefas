/**
 * PRIMETOUR — Page Size Picker (componente reutilizável)
 *
 * Componente genérico de paginação com seletor de "itens por página":
 * 10 / 20 / 50 / 100. Salva a escolha no localStorage por escopo
 * (ex: "audit", "tasks", "users") pra que o user não precise repetir
 * a configuração toda vez.
 *
 * USO BÁSICO:
 *   import { renderPageSizePicker, getPageSize, setPageSize } from './pageSize.js';
 *
 *   // Render do dropdown:
 *   container.innerHTML = renderPageSizePicker({
 *     scope: 'audit',
 *     onChange: (newSize) => { /* re-render lista *\/ },
 *   });
 *
 *   // Ler tamanho atual em qualquer lugar:
 *   const pageSize = getPageSize('audit'); // 10|20|50|100
 *
 *   // Setar programaticamente (ex: import de URL):
 *   setPageSize('audit', 50);
 *
 * Persistência: localStorage[`primetour:pageSize:${scope}`] = '20'
 */

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
export const DEFAULT_PAGE_SIZE = 20;

const _LS_KEY = (scope) => `primetour:pageSize:${scope || 'default'}`;
const _listeners = new Map(); // scope → Set<callback>

/**
 * Lê o pageSize salvo pra um escopo (ou retorna default).
 */
export function getPageSize(scope = 'default') {
  try {
    const v = parseInt(localStorage.getItem(_LS_KEY(scope)) || '', 10);
    return PAGE_SIZE_OPTIONS.includes(v) ? v : DEFAULT_PAGE_SIZE;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

/**
 * Salva pageSize pra um escopo. Notifica listeners pra re-render.
 */
export function setPageSize(scope, value) {
  const v = PAGE_SIZE_OPTIONS.includes(value) ? value : DEFAULT_PAGE_SIZE;
  try { localStorage.setItem(_LS_KEY(scope), String(v)); } catch {}
  // Notifica listeners desse scope
  const set = _listeners.get(scope);
  if (set) set.forEach(cb => { try { cb(v); } catch {} });
}

/**
 * Renderiza o HTML do dropdown. Usar como string em innerHTML.
 * Após inserir no DOM, chamar `wirePageSizePicker(scope, onChange)`.
 *
 * @param {object} opts
 * @param {string} opts.scope - chave única pra salvar (ex: 'audit', 'users')
 * @param {string} [opts.label='Itens por página:']
 * @param {string} [opts.id] - id do elemento (default: pgsize-{scope})
 */
export function renderPageSizePicker({ scope, label = 'Itens por página:', id }) {
  const elId = id || `pgsize-${scope}`;
  const current = getPageSize(scope);
  return `
    <label for="${elId}" style="display:inline-flex;align-items:center;gap:8px;
      font-size:0.8125rem;color:var(--text-secondary);">
      <span>${label}</span>
      <select id="${elId}" data-pagesize-scope="${scope}"
        class="filter-select"
        style="padding:4px 8px;font-size:0.8125rem;min-width:70px;">
        ${PAGE_SIZE_OPTIONS.map(n => `
          <option value="${n}" ${n === current ? 'selected' : ''}>${n}</option>
        `).join('')}
      </select>
    </label>
  `;
}

/**
 * Conecta o dropdown ao localStorage + listeners.
 * Chamar após inserir o HTML no DOM.
 *
 * @param {string} scope
 * @param {(newSize: number) => void} [onChange]
 */
export function wirePageSizePicker(scope, onChange) {
  const sel = document.querySelector(`[data-pagesize-scope="${scope}"]`);
  if (!sel) return;
  sel.addEventListener('change', (e) => {
    const v = parseInt(e.target.value, 10);
    setPageSize(scope, v);
    if (typeof onChange === 'function') onChange(v);
  });
  // Registra listener pra mudanças vindas de outros componentes
  if (typeof onChange === 'function') {
    if (!_listeners.has(scope)) _listeners.set(scope, new Set());
    _listeners.get(scope).add(onChange);
  }
}

/**
 * Cleanup de listeners (chamar no destroy de uma página).
 */
export function unwirePageSizePicker(scope, onChange) {
  const set = _listeners.get(scope);
  if (set && onChange) set.delete(onChange);
}
