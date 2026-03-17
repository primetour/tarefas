/**
 * PRIMETOUR — Filter Bar Component
 * Combinable filters: sector (1st), type, project, area, assignee
 * Sector list is always scoped to what the current user can see.
 */

import { store } from '../store.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export const REQUESTING_AREAS = [
  'BTG','C&P','Célula ICs','Centurion','CEP','Concierge Bradesco',
  'Contabilidade','Diretoria','Eventos','Financeiro','Lazer','Marketing',
  'Operadora','Programa ICs','Projetos','PTS Bradesco','Qualidade','Suppliers','TI',
];

/**
 * getUserSectorOptions()
 * Returns the sectors the current user is allowed to see.
 * null means "all" (master). Otherwise returns the filtered list.
 */
function getUserSectorOptions() {
  const visible = store.getVisibleSectors(); // null | string[]
  if (visible === null) return REQUESTING_AREAS; // master sees all
  if (visible.length === 0) return REQUESTING_AREAS; // no sector set — show all (failsafe)
  return visible;
}

/**
 * renderFilterBar({ show, state, taskTypes, projects, users })
 * Returns HTML string. show = array of keys to include.
 * Available keys: 'sector', 'type', 'project', 'area', 'assignee'
 */
export function renderFilterBar(opts = {}) {
  const {
    show      = ['sector','type','project','area'],
    state     = {},
    taskTypes = store.get('taskTypes') || [],
    projects  = [],
    users     = store.get('users') || [],
  } = opts;

  const sectorOptions = getUserSectorOptions();
  const hasFilters    = show.some(k => state[k]);

  // When sector is active, filter types to that sector
  const visibleTypes = state.sector
    ? taskTypes.filter(t => !t.sector || t.sector === state.sector)
    : taskTypes;

  return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;
    padding:8px 0;margin-bottom:4px;">

    ${show.includes('sector') && sectorOptions.length > 1 ? `
      <select class="filter-select" data-filter="sector"
        style="min-width:150px;border-color:${state.sector?'var(--brand-gold)':''};">
        <option value="">Todos os setores</option>
        ${sectorOptions.map(s=>`<option value="${esc(s)}" ${state.sector===s?'selected':''}>${esc(s)}</option>`).join('')}
      </select>
    ` : state.sector ? `
      <span style="font-size:0.8125rem;padding:6px 12px;border-radius:var(--radius-md);
        background:rgba(212,168,67,.1);color:var(--brand-gold);border:1px solid rgba(212,168,67,.3);">
        🏢 ${esc(state.sector)}
      </span>
    ` : ''}

    ${show.includes('type') ? `
      <select class="filter-select" data-filter="type"
        style="min-width:160px;border-color:${state.type?'var(--brand-gold)':''};">
        <option value="">Todos os tipos</option>
        ${visibleTypes.map(t=>`<option value="${t.id}" ${state.type===t.id?'selected':''}>${esc(t.icon||'')} ${esc(t.name)}</option>`).join('')}
      </select>
    ` : ''}

    ${show.includes('project') && projects.length ? `
      <select class="filter-select" data-filter="project"
        style="min-width:150px;border-color:${state.project?'var(--brand-gold)':''};">
        <option value="">Todos os projetos</option>
        ${projects.map(p=>`<option value="${p.id}" ${state.project===p.id?'selected':''}>${p.icon||''} ${esc(p.name)}</option>`).join('')}
      </select>
    ` : ''}

    ${show.includes('area') ? `
      <select class="filter-select" data-filter="area"
        style="min-width:150px;border-color:${state.area?'var(--brand-gold)':''};">
        <option value="">Todas as áreas</option>
        ${REQUESTING_AREAS.map(a=>`<option value="${esc(a)}" ${state.area===a?'selected':''}>${esc(a)}</option>`).join('')}
      </select>
    ` : ''}

    ${show.includes('assignee') && users.length ? `
      <select class="filter-select" data-filter="assignee"
        style="min-width:140px;border-color:${state.assignee?'var(--brand-gold)':''};">
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
  </div>`;
}

/**
 * bindFilterBar(container, state, onChange)
 */
export function bindFilterBar(container, state, onChange) {
  container.querySelectorAll('[data-filter]').forEach(el => {
    el.addEventListener('change', () => {
      state[el.dataset.filter] = el.value || null;
      // When sector changes, reset type (may no longer be valid for new sector)
      if (el.dataset.filter === 'sector') state.type = null;
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
    if (state.sector   && task.sector          !== state.sector)                  return false;
    if (state.type     && task.typeId          !== state.type)                    return false;
    if (state.project  && task.projectId       !== state.project)                 return false;
    if (state.area     && task.requestingArea  !== state.area)                    return false;
    if (state.assignee && !(task.assignees||[]).includes(state.assignee))         return false;
    return true;
  };
}
