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
// SAFETY: tetos por scope pra evitar travamento ao renderizar listas grandes.
// Audit: 50 max (100 trava o browser ao re-renderizar com leaks de listener).
const SAFE_MAX = { audit: 50, default: 100 };

const _LS_KEY = (scope) => `primetour:pageSize:${scope || 'default'}`;
// 1 callback por scope (não Set). Substituir = swap, sem leak.
const _callbacks = new Map(); // scope → callback (singular)

/**
 * Lê o pageSize salvo pra um escopo. Aplica SAFE_MAX defensivo.
 */
export function getPageSize(scope = 'default') {
  try {
    const v = parseInt(localStorage.getItem(_LS_KEY(scope)) || '', 10);
    if (!PAGE_SIZE_OPTIONS.includes(v)) return DEFAULT_PAGE_SIZE;
    const max = SAFE_MAX[scope] ?? SAFE_MAX.default;
    if (v > max) {
      // Auto-correção: usuário tinha valor proibido salvo (ex: 100 em audit)
      try { localStorage.setItem(_LS_KEY(scope), String(max)); } catch {}
      return max;
    }
    return v;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

/**
 * Salva pageSize pra um escopo. Aplica SAFE_MAX antes de chamar callback.
 */
export function setPageSize(scope, value) {
  const max = SAFE_MAX[scope] ?? SAFE_MAX.default;
  let v = PAGE_SIZE_OPTIONS.includes(value) ? value : DEFAULT_PAGE_SIZE;
  if (v > max) v = max; // cap
  try { localStorage.setItem(_LS_KEY(scope), String(v)); } catch {}
  // 1 callback por scope (sem leak). Se nenhum, ninguém re-renderiza.
  const cb = _callbacks.get(scope);
  if (typeof cb === 'function') {
    try { cb(v); } catch (e) { console.warn('[pageSize cb]', e?.message); }
  }
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
  // Filtra opções pelo SAFE_MAX do scope (ex: audit não mostra 100)
  const max = SAFE_MAX[scope] ?? SAFE_MAX.default;
  const options = PAGE_SIZE_OPTIONS.filter(n => n <= max);
  return `
    <label for="${elId}" style="display:inline-flex;align-items:center;gap:8px;
      font-size:0.8125rem;color:var(--text-secondary);">
      <span>${label}</span>
      <select id="${elId}" data-pagesize-scope="${scope}"
        class="filter-select"
        style="padding:4px 8px;font-size:0.8125rem;min-width:70px;">
        ${options.map(n => `
          <option value="${n}" ${n === current ? 'selected' : ''}>${n}</option>
        `).join('')}
      </select>
    </label>
  `;
}

/**
 * Conecta o dropdown ao localStorage + callback.
 * Chamar após inserir o HTML no DOM.
 *
 * BUG FIX: versão anterior mantinha um Set<callback> que ACUMULAVA cada
 * chamada — cada renderPagination disparava +1 callback. Em audit com
 * 100 logs/página, o leak triggerava re-render exponencial e travava o
 * browser. Agora 1 callback por scope (substitui anterior, sem leak).
 *
 * @param {string} scope
 * @param {(newSize: number) => void} [onChange]
 */
export function wirePageSizePicker(scope, onChange) {
  const sel = document.querySelector(`[data-pagesize-scope="${scope}"]`);
  if (!sel) return;
  // O elemento select foi recém-criado (innerHTML reset). Vincula change
  // aqui mesmo — o sel antigo foi descartado junto com seus listeners.
  sel.addEventListener('change', (e) => {
    const v = parseInt(e.target.value, 10);
    setPageSize(scope, v); // setPageSize já chama o callback do scope
  });
  // Registra/SUBSTITUI o callback do scope (singular, sem Set/leak)
  if (typeof onChange === 'function') {
    _callbacks.set(scope, onChange);
  }
}

/**
 * Cleanup do callback (chamar no destroy de uma página).
 */
export function unwirePageSizePicker(scope) {
  _callbacks.delete(scope);
}

// ── Auto-correção no carregamento ──
// Se o user tem um valor "perigoso" salvo (ex: 100 em audit que travava),
// resetar pra DEFAULT_PAGE_SIZE. Roda 1x ao importar este módulo.
// Recovery automático sem precisar usuário limpar localStorage manualmente.
try {
  Object.entries(SAFE_MAX).forEach(([scope, max]) => {
    if (scope === 'default') return;
    const v = parseInt(localStorage.getItem(_LS_KEY(scope)) || '', 10);
    if (PAGE_SIZE_OPTIONS.includes(v) && v > max) {
      localStorage.setItem(_LS_KEY(scope), String(DEFAULT_PAGE_SIZE));
      console.log(`[pageSize] Reset ${scope} de ${v} pra ${DEFAULT_PAGE_SIZE} (safety)`);
    }
  });
} catch {}
