/**
 * PRIMETOUR — Filter Bar Component
 * Combinable filters: sector, type, project, area, assignee, status, meta
 * Sector list is always scoped to what the current user can see.
 *
 * Visual: usa optionPicker (mesma identidade do app — bolinha+icon+label+chevron).
 * Selects nativos sao mantidos escondidos como fonte-de-verdade pro change.
 */

import { store } from '../store.js';
import {
  renderPickerButton, bindOptionPicker,
  renderMultiPickerButton, bindMultiOptionPicker,
} from './optionPicker.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Statuses suportados pelo filtro. Espelha STATUSES de services/tasks.js
// (não importa de lá pra evitar dependência cíclica em renderFilterBar).
const STATUS_OPTIONS = [
  { value: 'not_started', label: 'Não iniciado', color: '#38BDF8' },
  { value: 'in_progress', label: 'Em Andamento', color: '#F59E0B' },
  { value: 'review',      label: 'Em Revisão',   color: '#A78BFA' },
  { value: 'rework',      label: 'Retrabalho',   color: '#F97316' },
  { value: 'done',        label: 'Concluída',    color: '#22C55E' },
  { value: 'cancelled',   label: 'Cancelada',    color: '#EF4444' },
];

export const REQUESTING_AREAS = [
  'BTG','C&P','Célula ICs','Centurion','CEP','Concierge Bradesco',
  'Contabilidade','Diretoria','Eventos','Financeiro','Lazer','Marketing',
  'Operadora','Programa ICs','Projetos','PTS Bradesco','Qualidade','Suppliers','TI',
];

/* Hash deterministico → cor estavel (areas/setores/usuarios) */
const HASH_PALETTE = ['#6366F1','#8B5CF6','#EC4899','#F59E0B','#22C55E','#0EA5E9','#D4A843','#64748B','#10B981'];
const hashColor = (s) => {
  const str = String(s || '');
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return HASH_PALETTE[Math.abs(h) % HASH_PALETTE.length];
};

/* ─── Mappers de options pro optionPicker ────────────────── */
function sectorOpts(list) {
  return list.map(s => ({ id: s, label: s, icon: '◈', color: hashColor(s) }));
}
function typeOpts(list) {
  return list.map(t => {
    // Extrai emoji se o nome começa com um (mesma lógica do portal.js)
    const name = String(t.name || '').trim();
    const fc = name[0];
    const isEmoji = fc && fc.codePointAt(0) > 127;
    const parts = isEmoji ? name.split(/\s+/) : null;
    return {
      id: t.id,
      label: parts ? parts.slice(1).join(' ').trim() || name : name,
      icon: t.icon || (parts ? parts[0] : ''),
      color: '#0EA5E9',
    };
  });
}
function projectOpts(list) {
  return list.map(p => ({
    id: p.id,
    label: p.name,
    icon: p.icon || '',
    color: p.color || '#6366F1',
  }));
}
function areaOpts() {
  return REQUESTING_AREAS.map(a => ({ id: a, label: a, icon: '', color: hashColor(a) }));
}
function assigneeOpts(users) {
  return users.map(u => ({
    id: u.id,
    label: u.name || u.email || 'Usuário',
    icon: (u.name || u.email || '?').trim().charAt(0).toUpperCase(),
    color: hashColor(u.id || u.email || u.name || ''),
  }));
}
const statusOpts = () => STATUS_OPTIONS.map(s => ({ id: s.value, label: s.label, icon: '', color: s.color }));
const metaOpts = () => [
  { id: 'with',    label: 'Com meta vinculada', icon: '🎯', color: '#22C55E' },
  { id: 'without', label: 'Sem meta vinculada', icon: '○',  color: '#6B7280' },
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

/* Helper: select hidden + picker button — mantem data-filter pro bind. */
function pickerField(filterKey, selectId, opts, selectedOption, emptyLabel) {
  const optionsHtml = opts.map(o =>
    `<option value="${esc(o.id)}" ${selectedOption?.id === o.id ? 'selected' : ''}>${esc(o.label)}</option>`
  ).join('');
  return `
    <div class="toolbar-filter-wrap" style="min-width:170px;">
      <select id="${esc(selectId)}" data-filter="${esc(filterKey)}" style="display:none;">
        <option value="">${esc(emptyLabel)}</option>
        ${optionsHtml}
      </select>
      ${renderPickerButton({
        btnId: selectId + '-btn',
        selected: selectedOption,
        emptyLabel,
      })}
    </div>
  `;
}

/**
 * renderFilterBar({ show, state, taskTypes, projects, users })
 * Returns HTML string. show = array of keys to include.
 * Available keys: 'sector', 'type', 'project', 'area', 'assignee', 'status', 'meta'
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
  // Considera array-vazio como "sem filtro" (multi-select assignee).
  const hasFilters = show.some(k => {
    const v = state[k];
    if (Array.isArray(v)) return v.length > 0;
    return !!v;
  });

  // When sector is active, filter types to that sector
  const visibleTypes = state.sector
    ? taskTypes.filter(t => !t.sector || t.sector === state.sector)
    : taskTypes;

  const findIn = (list, id) => list.find(o => o.id === id) || null;

  const blocks = [];

  if (show.includes('sector') && sectorOptions.length > 1) {
    const o = sectorOpts(sectorOptions);
    blocks.push(pickerField('sector', 'fb-sector', o, findIn(o, state.sector), 'Todos os setores'));
  } else if (show.includes('sector') && state.sector) {
    blocks.push(`
      <span style="font-size:0.8125rem;padding:6px 12px;border-radius:var(--radius-md);
        background:rgba(212,168,67,.1);color:var(--brand-gold);border:1px solid rgba(212,168,67,.3);">
        🏢 ${esc(state.sector)}
      </span>
    `);
  }

  if (show.includes('type')) {
    const o = typeOpts(visibleTypes);
    blocks.push(pickerField('type', 'fb-type', o, findIn(o, state.type), 'Todos os tipos'));
  }
  if (show.includes('project') && projects.length) {
    const o = projectOpts(projects);
    blocks.push(pickerField('project', 'fb-project', o, findIn(o, state.project), 'Todos os projetos'));
  }
  if (show.includes('area')) {
    const o = areaOpts();
    blocks.push(pickerField('area', 'fb-area', o, findIn(o, state.area), 'Todas as áreas'));
  }
  if (show.includes('assignee') && users.length) {
    // 4.21+ — assignee passou a aceitar multi-select. state.assignee agora pode
    // ser: null | string (legacy, single) | string[] (novo, multi).
    const o = assigneeOpts(users);
    const currentIds = Array.isArray(state.assignee)
      ? state.assignee
      : (state.assignee ? [state.assignee] : []);
    const selectedItems = currentIds.map(id => o.find(opt => opt.id === id)).filter(Boolean);
    blocks.push(`
      <div class="toolbar-filter-wrap" style="min-width:180px;" data-multi-key="assignee">
        ${renderMultiPickerButton({
          btnId: 'fb-assignee-btn',
          selectedItems,
          emptyLabel: 'Todos os responsáveis',
        })}
      </div>
    `);
  }
  if (show.includes('status')) {
    const o = statusOpts();
    blocks.push(pickerField('status', 'fb-status', o, findIn(o, state.status), 'Todos os status'));
  }
  if (show.includes('meta')) {
    const o = metaOpts();
    blocks.push(pickerField('meta', 'fb-meta', o, findIn(o, state.meta), 'Todas (c/ ou s/ meta)'));
  }

  if (hasFilters) {
    blocks.push(`
      <button class="btn btn-ghost btn-sm filter-clear-btn"
        style="color:var(--text-muted);font-size:0.75rem;white-space:nowrap;">
        ✕ Limpar filtros
      </button>
    `);
  }

  return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;
    padding:8px 0;margin-bottom:4px;">${blocks.join('')}</div>`;
}

/* ─── Builders dinamicos pra binding ──────────────────────── */
function buildOptionsForKey(key, opts) {
  const taskTypes = opts.taskTypes || store.get('taskTypes') || [];
  const projects  = opts.projects  || [];
  const users     = opts.users     || store.get('users') || [];
  const state     = opts.state     || {};

  switch (key) {
    case 'sector':   return sectorOpts(getUserSectorOptions());
    case 'type': {
      const visibleTypes = state.sector
        ? taskTypes.filter(t => !t.sector || t.sector === state.sector)
        : taskTypes;
      return typeOpts(visibleTypes);
    }
    case 'project':  return projectOpts(projects);
    case 'area':     return areaOpts();
    case 'assignee': return assigneeOpts(users);
    case 'status':   return statusOpts();
    case 'meta':     return metaOpts();
  }
  return [];
}

const EMPTY_LABELS = {
  sector:   'Todos os setores',
  type:     'Todos os tipos',
  project:  'Todos os projetos',
  area:     'Todas as áreas',
  assignee: 'Todos os responsáveis',
  status:   'Todos os status',
  meta:     'Todas (c/ ou s/ meta)',
};

/**
 * bindFilterBar(container, state, onChange, ctx?)
 * ctx (opcional) = { taskTypes, projects, users } — passado pra rebuilds dinâmicos.
 *
 * Mantém compatibilidade: se chamado sem ctx, usa store/defaults (passados em renderFilterBar).
 */
export function bindFilterBar(container, state, onChange, ctx = {}) {
  // 1) change listener nos selects escondidos (compat com bind antigo)
  container.querySelectorAll('[data-filter]').forEach(el => {
    el.addEventListener('change', () => {
      state[el.dataset.filter] = el.value || null;
      // When sector changes, reset type (may no longer be valid for new sector)
      if (el.dataset.filter === 'sector') {
        state.type = null;
        const typeSel = container.querySelector('[data-filter="type"]');
        if (typeSel) {
          typeSel.value = '';
          typeSel.dispatchEvent(new Event('picker-refresh'));
        }
      }
      onChange({ ...state });
    });
  });

  // 2) Wire optionPicker em cada select escondido (single-select)
  // assignee é tratado separadamente abaixo (multi-select desde 4.21).
  ['sector','type','project','area','status','meta'].forEach(key => {
    const sel = container.querySelector(`[data-filter="${key}"]`);
    if (!sel) return;
    const selectId = sel.id;
    const buildOpts = () => buildOptionsForKey(key, { ...ctx, state });
    bindOptionPicker({
      btnId: selectId + '-btn',
      selectId,
      buildConfig: () => ({
        options: buildOpts(),
        empty: { id: '', label: EMPTY_LABELS[key] },
        searchPlaceholder: 'Buscar…',
      }),
      findSelected: (id) => buildOpts().find(o => o.id === id) || null,
      emptyLabel: EMPTY_LABELS[key],
    });
  });

  // 2b) Multi-select: assignee
  const assigneeWrap = container.querySelector('[data-multi-key="assignee"]');
  if (assigneeWrap) {
    bindMultiOptionPicker({
      btnId: 'fb-assignee-btn',
      buildOptions: () => buildOptionsForKey('assignee', { ...ctx, state }),
      getValues: () => Array.isArray(state.assignee)
        ? state.assignee
        : (state.assignee ? [state.assignee] : []),
      setValues: (ids) => {
        state.assignee = ids.length === 0 ? null : ids;
        onChange({ ...state });
      },
      emptyLabel: 'Todos os responsáveis',
    });
  }

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
    // assignee: pode ser string (legacy) ou string[] (multi-select 4.21+).
    // Multi: passa se a tarefa tem AO MENOS UM dos responsáveis selecionados.
    if (state.assignee) {
      const want = Array.isArray(state.assignee) ? state.assignee : [state.assignee];
      if (want.length > 0) {
        const taskAssignees = task.assignees || [];
        const hasAny = want.some(uid => taskAssignees.includes(uid));
        if (!hasAny) return false;
      }
    }
    if (state.status   && task.status          !== state.status)                  return false;
    // Meta vinculada: tarefa "tem meta" se tem metaLinks[] preenchido OU
    // goalId legado (back-compat para tarefas anteriores ao multi-link).
    if (state.meta) {
      const hasMeta = (Array.isArray(task.metaLinks) && task.metaLinks.length > 0)
                   || !!task.goalId;
      if (state.meta === 'with'    && !hasMeta) return false;
      if (state.meta === 'without' &&  hasMeta) return false;
    }
    return true;
  };
}
