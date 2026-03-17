/**
 * PRIMETOUR — Filter Bar Component
 * Combinable filters: type, project, requestingArea, assignee
 * Used by: Kanban, Calendar, Timeline
 */

import { store } from '../store.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export const REQUESTING_AREAS = [
  'BTG','C&P','Célula ICs','Centurion','CEP','Concierge Bradesco',
  'Contabilidade','Diretoria','Eventos','Financeiro','Lazer','Marketing',
  'Operadora','Programa ICs','Projetos','PTS Bradesco','Qualidade','Suppliers','TI',
];

/**
 * renderFilterBar(options)
 * Returns HTML string for the filter bar.
 * options: { show: ['type','project','area','assignee'], state: filterState }
 */
export function renderFilterBar(opts = {}) {
  const {
    show = ['type','project','area'],
    state = {},
    taskTypes = store.get('taskTypes') || [],
    projects  = store.get('projects') || [],
    users     = store.get('users')    || [],
  } = opts;

  const hasFilters = show.some(k => state[k]);

  return `
    <div class="filter-bar" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;
      padding:8px 0;margin-bottom:4px;">

      ${show.includes('type') ? `
        <select class="filter-select filter-type" style="min-width:160px;" data-filter="type">
          <option value="">Todos os tipos</option>
          ${taskTypes.map(t=>`<option value="${t.id}" ${state.type===t.id?'selected':''}>${esc(t.icon||'')} ${esc(t.name)}</option>`).join('')}
        </select>
      ` : ''}

      ${show.includes('project') ? `
        <select class="filter-select filter-project" style="min-width:150px;" data-filter="project">
          <option value="">Todos os projetos</option>
          ${projects.map(p=>`<option value="${p.id}" ${state.project===p.id?'selected':''}>${p.icon||''} ${esc(p.name)}</option>`).join('')}
        </select>
      ` : ''}

      ${show.includes('area') ? `
        <select class="filter-select filter-area" style="min-width:150px;" data-filter="area">
          <option value="">Todas as áreas</option>
          ${REQUESTING_AREAS.map(a=>`<option value="${a}" ${state.area===a?'selected':''}>${esc(a)}</option>`).join('')}
        </select>
      ` : ''}

      ${show.includes('assignee') && users.length ? `
        <select class="filter-select filter-assignee" style="min-width:140px;" data-filter="assignee">
          <option value="">Todos os responsáveis</option>
          ${users.map(u=>`<option value="${u.id}" ${state.assignee===u.id?'selected':''}>${esc(u.name)}</option>`).join('')}
        </select>
      ` : ''}

      ${hasFilters ? `
        <button class="btn btn-ghost btn-sm filter-clear-btn"
          style="color:var(--text-muted);font-size:0.75rem;white-space:nowrap;">
          ✕ Limpar filtros
        </button>
      ` : ''}
    </div>
  `;
}

/**
 * bindFilterBar(container, state, onChange)
 * Binds change events. onChange(newState) called on any change.
 */
export function bindFilterBar(container, state, onChange) {
  container.querySelectorAll('.filter-bar [data-filter]').forEach(el => {
    el.addEventListener('change', () => {
      state[el.dataset.filter] = el.value || null;
      onChange({ ...state });
    });
  });
  container.querySelector('.filter-clear-btn')?.addEventListener('click', () => {
    Object.keys(state).forEach(k => state[k] = null);
    onChange({ ...state });
  });
}

/**
 * buildFilterFn(state)
 * Returns a function (task) => boolean
 */
export function buildFilterFn(state = {}) {
  return (task) => {
    if (state.type    && task.typeId       !== state.type)                     return false;
    if (state.project && task.projectId    !== state.project)                  return false;
    if (state.area    && task.requestingArea !== state.area)                   return false;
    if (state.assignee && !(task.assignees||[]).includes(state.assignee))      return false;
    return true;
  };
}
