/**
 * PRIMETOUR — Kanban Board
 * Board drag-and-drop com colunas por status
 */

import { store, routeGuard } from '../store.js';
import { toast }  from '../components/toast.js';
import {
  subscribeToTasks, moveTaskKanban, createTask, toggleTaskComplete, getTask,
  STATUSES, STATUS_OVERDUE, isTaskOverdue, PRIORITY_MAP,
} from '../services/tasks.js';
import { fetchProjects }  from '../services/projects.js';
import { openTaskModal, openTaskDoneOverlay }  from '../components/taskModal.js';
import { fetchTaskTypes }         from '../services/taskTypes.js';
import {
  renderFilterBar, bindFilterBar, buildFilterFn,
} from '../components/filterBar.js';
import { openCardPrefsModal }     from '../components/cardPrefsModal.js';
import { renderCardFields }       from '../services/cardPrefs.js';
import { renderPickerButton, bindOptionPicker } from '../components/optionPicker.js';
import { userAvatarInner } from '../components/userAvatar.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let allTasks     = [];
let allProjects  = [];
let allTaskTypes = [];
let unsubscribe  = null;
let dragTask     = null;
let dragOriginCol = null;
let optimisticTasks = [];
let activeView   = 'kanban';   // 'kanban' | 'pipeline'
// v4.49.51+ 'area' removido (legado, igual a sector — feedback do user).
// 'area' permanece como GROUPBY (agrupador de colunas), mas não mais filtro.
let kbFilterState = { sector: null, type: null, project: null, assignee: null, observer: null, status: null };

// 4.13+ — Bulk select compartilhado com lista de tarefas
const _selectedTaskIds = new Set();
let   _bulkBar = null;

/* ─── Group-By: agrupar colunas do Steps por outro campo ──────
 * Default = 'status' (comportamento original). Mudando, recalcula colunas.
 * Drag-and-drop entre colunas só funciona em status (única mudança que
 * faz sentido sem ambiguidade — ex: arrastar entre áreas exigiria UI
 * pra decidir se é mover só a tarefa ou reatribuir requestingArea).
 * Persiste em localStorage por user. */
const GROUPBY_KEY = 'primetour-kanban-groupby';
const GROUPBY_OPTIONS = [
  { value: 'status',     label: 'Status',          field: 'status'         },
  { value: 'area',       label: 'Área solicitante', field: 'requestingArea' },
  { value: 'sector',     label: 'Setor',           field: 'sector'         },
  { value: 'priority',   label: 'Prioridade',      field: 'priority'       },
  { value: 'project',    label: 'Projeto',         field: 'projectId'      },
  { value: 'type',       label: 'Tipo de tarefa',  field: 'typeId'         },
  { value: 'assignee',   label: 'Responsável',     field: 'assignees'      },
];
let groupBy = (() => {
  try { return localStorage.getItem(GROUPBY_KEY) || 'status'; }
  catch { return 'status'; }
})();
function setGroupBy(v) {
  groupBy = v;
  try { localStorage.setItem(GROUPBY_KEY, v); } catch {}
}

/* ─── 4.18+ Reordenação de colunas (preferência do user) ──────
 * Cada user define a ordem visual das colunas via drag no header.
 * Persiste em localStorage por groupBy (status/priority/area/etc.) — não por
 * user-id pq já é per-browser. Pra sync entre devices, promover pra Firestore
 * em users/{uid}/preferences depois.
 *
 * Schema:
 *   localStorage[primetour-kanban-col-order] = JSON.stringify({
 *     status: ['atrasada', 'in_progress', 'not_started', ...],
 *     priority: ['urgent', 'high', ...],
 *     area: ['Marketing', 'Diretoria', ...],
 *   })
 *
 * Aplicação na ordem:
 *   1. Pega a ordem salva pra o groupBy ativo
 *   2. Aplica nas colunas existentes (mantendo o objeto original)
 *   3. Colunas que não estão na ordem salva (NOVAS) → vão pro fim
 *   4. Colunas que sumiram (ex: setor desativado) → ignoradas
 */
const COL_ORDER_KEY = 'primetour-kanban-col-order';
function _loadColumnOrder(groupKey) {
  try {
    const all = JSON.parse(localStorage.getItem(COL_ORDER_KEY) || '{}');
    return Array.isArray(all[groupKey]) ? all[groupKey] : [];
  } catch { return []; }
}
function _saveColumnOrder(groupKey, order) {
  try {
    const all = JSON.parse(localStorage.getItem(COL_ORDER_KEY) || '{}');
    all[groupKey] = Array.isArray(order) ? order : [];
    localStorage.setItem(COL_ORDER_KEY, JSON.stringify(all));
  } catch {}
}
function _applyColumnOrder(groupKey, cols) {
  const saved = _loadColumnOrder(groupKey);
  if (!saved.length) return cols;
  const byValue = new Map(cols.map(c => [String(c.value), c]));
  const result = [];
  for (const v of saved) {
    if (byValue.has(String(v))) {
      result.push(byValue.get(String(v)));
      byValue.delete(String(v));
    }
  }
  // Colunas novas (não estavam na ordem salva) → final
  for (const c of byValue.values()) result.push(c);
  return result;
}

/**
 * getKanbanGroups(groupKey, tasks)
 * Retorna [{ value, label, color }] — uma "coluna virtual" por valor único.
 * Para 'status' usa o STATUSES (mantém ordem e cor originais).
 * Para outros campos, deriva do conjunto de tasks (filtra "Sem X" no fim).
 */
function getKanbanGroups(groupKey, tasks) {
  if (groupKey === 'status') {
    // Coluna virtual "Atrasada" no início — atalho visual pra prazos vencidos.
    // Tarefa atrasada some do status real e aparece SÓ aqui (ver taskBelongsToGroup).
    // Comportamento documentado em RULES-AND-AUTOMATIONS.md § 10.1.
    const cols = [
      { value: STATUS_OVERDUE.value, label: STATUS_OVERDUE.label, color: STATUS_OVERDUE.color, virtual: true },
      ...STATUSES.map(s => ({ value: s.value, label: s.label, color: s.color })),
    ];
    // 4.18+: aplica preferência do user (drag pra reordenar)
    return _applyColumnOrder(groupKey, cols);
  }

  const opt = GROUPBY_OPTIONS.find(o => o.value === groupKey);
  if (!opt) return STATUSES.map(s => ({ value: s.value, label: s.label, color: s.color }));

  const users = store.get('users') || [];
  const userById = new Map(users.map(u => [u.id, u]));
  const projectById = new Map(allProjects.map(p => [p.id, p]));
  const typeById = new Map(allTaskTypes.map(t => [t.id, t]));

  // Cores estáveis por valor (hash simples)
  const colorFor = (str) => {
    if (!str) return '#6B7280';
    const hue = [...String(str)].reduce((a,c)=>a+c.charCodeAt(0),0) % 360;
    return `hsl(${hue},45%,55%)`;
  };

  // Coleta valores únicos
  const seen = new Map(); // value -> label
  const addValue = (v, label) => {
    if (v == null || v === '') return;
    if (Array.isArray(v)) {
      v.forEach(x => addValue(x, null));
      return;
    }
    if (!seen.has(v)) seen.set(v, label || String(v));
  };

  for (const t of tasks) {
    const raw = t[opt.field];
    if (groupKey === 'assignee') {
      const arr = Array.isArray(raw) ? raw : (typeof raw === 'string' && raw ? [raw] : []);
      arr.forEach(uid => {
        const u = userById.get(uid);
        addValue(uid, u?.name || (typeof uid === 'string' && uid.startsWith('pending_') ? '(pendente)' : '(usuário)'));
      });
    } else if (groupKey === 'project') {
      if (raw) {
        const p = projectById.get(raw);
        addValue(raw, p ? `${p.icon||''} ${p.name}`.trim() : '(projeto removido)');
      }
    } else if (groupKey === 'type') {
      if (raw) {
        const ty = typeById.get(raw);
        addValue(raw, ty ? `${ty.icon||''} ${ty.name}`.trim() : '(tipo removido)');
      }
    } else if (groupKey === 'priority') {
      if (raw) addValue(raw, (PRIORITY_MAP[raw]?.label) || raw);
    } else {
      if (raw) addValue(raw, String(raw));
    }
  }

  // Ordena: prioridade tem ordem fixa; outros alfabético
  const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];
  let entries = [...seen.entries()];
  if (groupKey === 'priority') {
    entries.sort((a,b) => PRIORITY_ORDER.indexOf(a[0]) - PRIORITY_ORDER.indexOf(b[0]));
  } else {
    entries.sort((a,b) => a[1].localeCompare(b[1], 'pt-BR'));
  }

  const groups = entries.map(([value, label]) => ({
    value: `gb_${value}`,            // prefixo evita colisão com IDs do DOM (ex: 'done' do status)
    rawValue: value,
    label,
    color: groupKey === 'priority' ? (PRIORITY_MAP[value]?.color || colorFor(value)) : colorFor(value),
  }));

  // "Sem X" sempre por último — agrupa tasks sem o campo
  const hasOrphans = tasks.some(t => {
    const raw = t[opt.field];
    if (groupKey === 'assignee') {
      const arr = Array.isArray(raw) ? raw : (typeof raw === 'string' && raw ? [raw] : []);
      return arr.length === 0;
    }
    return raw == null || raw === '';
  });
  if (hasOrphans) {
    groups.push({
      value: 'gb___none__',
      rawValue: null,
      label: `Sem ${opt.label.toLowerCase()}`,
      color: '#6B7280',
    });
  }

  // 4.18+: aplica preferência do user (drag pra reordenar)
  return _applyColumnOrder(groupKey, groups);
}

/** Retorna se uma task pertence ao grupo (pra filtrar coluna). */
function taskBelongsToGroup(task, groupKey, group) {
  if (groupKey === 'status') {
    // Coluna virtual "atrasada": tem precedência sobre o status real.
    // Tarefa atrasada NÃO aparece na coluna do status real — evita duplicar.
    if (group.value === 'overdue') return isTaskOverdue(task);
    if (isTaskOverdue(task)) return false;  // atrasada já foi pra coluna virtual
    return task.status === group.value;
  }
  const opt = GROUPBY_OPTIONS.find(o => o.value === groupKey);
  if (!opt) return false;
  const raw = task[opt.field];
  if (group.value === 'gb___none__') {
    if (groupKey === 'assignee') {
      const arr = Array.isArray(raw) ? raw : (typeof raw === 'string' && raw ? [raw] : []);
      return arr.length === 0;
    }
    return raw == null || raw === '';
  }
  if (groupKey === 'assignee') {
    const arr = Array.isArray(raw) ? raw : (typeof raw === 'string' && raw ? [raw] : []);
    return arr.includes(group.rawValue);
  }
  return raw === group.rawValue;
}

// 4.48.4+ Persistência de filtros do Steps/Kanban.
// Mesmo problema reportado de Tarefas: usuário re-aplicava filtros toda
// vez que voltava pra página. Salva em localStorage e restaura no
// initKbFilterState ANTES do default por setor.
const KB_FILTER_KEY = 'kanban.filterState.v1';
function _saveKbFilters() {
  try { localStorage.setItem(KB_FILTER_KEY, JSON.stringify(kbFilterState)); } catch {}
}
function _loadKbFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(KB_FILTER_KEY) || '{}');
    // Merge respeitando o shape — qualquer chave estranha é ignorada
    // v4.49.51+ 'area' descartado se vier de localStorage legado (legacy save).
    ['sector','type','project','assignee','observer','status'].forEach(k => {
      if (saved[k] !== undefined) kbFilterState[k] = saved[k];
    });
  } catch {}
}
function initKbFilterState() {
  // 4.48.4+ Restaura filtros salvos antes do default por setor
  _loadKbFilters();
  // Pre-select user's sector on first load (only if single-sector user)
  if (!kbFilterState.sector) {
    const sectors = store.getVisibleSectors();
    if (sectors && sectors.length === 1) kbFilterState.sector = sectors[0];
  }
}
let activePipelineTypeId = ''; // tipo selecionado na esteira

/* ─── Paginação por coluna ───────────────────────────────── */
const KANBAN_COL_LIMIT = 200;
// Limite inicial pra seção de "Finalizadas" dentro de cada coluna em
// groupBy != 'status'. Sem isso, expandir a seção pode criar scroll interno
// gigante na coluna (14k+ px se houver 80+ tasks concluídas), quebrando UX
// — user perde referência horizontal das outras colunas. Botão "Ver mais"
// expande paginadamente.
const KANBAN_FINALIZED_INITIAL = 10;
const expandedCols = new Set();  // chaves tipo "kb:done" ou "pipe:type1:__done__"

function renderColumnBody(body, count, colTasks, colKey, cardRenderer, rebindFn) {
  const total     = colTasks.length;
  const expanded  = expandedCols.has(colKey);
  const limit     = (expanded || total <= KANBAN_COL_LIMIT) ? total : KANBAN_COL_LIMIT;
  const visible   = colTasks.slice(0, limit);
  const remaining = total - limit;

  let html = visible.map(cardRenderer).join('');
  if (remaining > 0) {
    html += `<button class="kb-load-more" data-col-key="${colKey}" style="width:100%;
      margin-top:8px;padding:8px 12px;border-radius:var(--radius-md);
      border:1px dashed var(--border-subtle);background:transparent;
      color:var(--text-muted);cursor:pointer;font-family:var(--font-ui);
      font-size:0.75rem;font-weight:500;transition:all 0.15s;">
      ↓ Ver mais ${remaining} tarefa${remaining>1?'s':''}
    </button>`;
  } else if (expanded && total > KANBAN_COL_LIMIT) {
    html += `<button class="kb-load-more" data-col-key="${colKey}" data-collapse="1" style="width:100%;
      margin-top:8px;padding:8px 12px;border-radius:var(--radius-md);
      border:1px dashed var(--border-subtle);background:transparent;
      color:var(--text-muted);cursor:pointer;font-family:var(--font-ui);
      font-size:0.75rem;font-weight:500;">
      ↑ Recolher
    </button>`;
  }

  body.innerHTML = html;
  if (count) count.textContent = total;
  if (typeof rebindFn === 'function') rebindFn(body);

  body.querySelector('.kb-load-more')?.addEventListener('click', e => {
    const key = e.currentTarget.dataset.colKey;
    if (e.currentTarget.dataset.collapse) expandedCols.delete(key);
    else expandedCols.add(key);
    renderColumnBody(body, count, colTasks, colKey, cardRenderer, rebindFn);
  });
}

/**
 * renderColumnBodyWithFinalized
 * Variação de renderColumnBody usada quando groupBy != 'status'. Tarefas
 * concluídas/canceladas precisam aparecer ao final, em uma seção visualmente
 * separada (collapsable com contador) — sem misturar com as ativas.
 *
 * Layout resultante:
 *   <ativas> (cards normais, paginação herdada)
 *   ─── separador ───
 *   ▾ Concluídas (N)
 *     <finalizadas> (cards finais, expandable; default colapsado)
 *
 * Count da coluna inclui ativas + finalizadas (total real).
 */
function renderColumnBodyWithFinalized(body, count, activeTasks, finalizedTasks, colKey, cardRenderer, rebindFn) {
  const total = activeTasks.length + finalizedTasks.length;

  // Renderiza ativas usando a paginação padrão
  const activeColKey = `${colKey}:active`;
  const expanded = expandedCols.has(activeColKey);
  const limit = (expanded || activeTasks.length <= KANBAN_COL_LIMIT) ? activeTasks.length : KANBAN_COL_LIMIT;
  const visible = activeTasks.slice(0, limit);
  const remaining = activeTasks.length - limit;

  let html = visible.map(cardRenderer).join('');
  if (remaining > 0) {
    html += `<button class="kb-load-more" data-col-key="${esc(activeColKey)}" style="width:100%;
      margin-top:8px;padding:8px 12px;border-radius:var(--radius-md);
      border:1px dashed var(--border-subtle);background:transparent;
      color:var(--text-muted);cursor:pointer;font-family:var(--font-ui);
      font-size:0.75rem;font-weight:500;transition:all 0.15s;">
      ↓ Ver mais ${remaining} ativa${remaining>1?'s':''}
    </button>`;
  } else if (expanded && activeTasks.length > KANBAN_COL_LIMIT) {
    html += `<button class="kb-load-more" data-col-key="${esc(activeColKey)}" data-collapse="1" style="width:100%;
      margin-top:8px;padding:8px 12px;border-radius:var(--radius-md);
      border:1px dashed var(--border-subtle);background:transparent;
      color:var(--text-muted);cursor:pointer;font-family:var(--font-ui);
      font-size:0.75rem;font-weight:500;">
      ↑ Recolher
    </button>`;
  }

  // Mensagem quando coluna fica vazia (só finalizadas, ou nada)
  if (activeTasks.length === 0 && finalizedTasks.length === 0) {
    html += `<div style="padding:14px 8px;text-align:center;font-size:0.75rem;
      color:var(--text-muted);font-style:italic;">Sem tarefas</div>`;
  } else if (activeTasks.length === 0) {
    html += `<div style="padding:10px 8px;text-align:center;font-size:0.75rem;
      color:var(--text-muted);font-style:italic;">Sem tarefas ativas</div>`;
  }

  // Seção de finalizadas (concluídas + canceladas), default colapsada.
  // Paginação interna evita scroll gigante na coluna ao expandir.
  if (finalizedTasks.length > 0) {
    const finalKey = `${colKey}:final`;
    const finalAllKey = `${colKey}:final-all`;
    const finalExpanded = expandedCols.has(finalKey);
    const showAllFinal = expandedCols.has(finalAllKey);
    const doneCount = finalizedTasks.filter(t => t.status === 'done').length;
    const cancelledCount = finalizedTasks.filter(t => t.status === 'cancelled').length;
    const labelParts = [];
    if (doneCount > 0)      labelParts.push(`${doneCount} conclu${doneCount>1?'ídas':'ída'}`);
    if (cancelledCount > 0) labelParts.push(`${cancelledCount} cancel${cancelledCount>1?'adas':'ada'}`);
    const sectionLabel = labelParts.join(' · ');

    // Mostra primeiras N (KANBAN_FINALIZED_INITIAL=10); botão "ver mais"
    // expande todas. Limita scroll vertical interno da coluna a um valor
    // gerenciável (sem isso, 80+ tarefas concluídas estendiam a coluna pra
    // 14k+ px e o user perdia referência das outras colunas).
    const finalVisible = showAllFinal
      ? finalizedTasks
      : finalizedTasks.slice(0, KANBAN_FINALIZED_INITIAL);
    const finalRemaining = finalizedTasks.length - finalVisible.length;

    html += `<div style="margin-top:14px;padding-top:10px;
      border-top:1px dashed var(--border-subtle);">
      <button class="kb-finalized-toggle" data-final-key="${esc(finalKey)}" style="
        width:100%;display:flex;align-items:center;justify-content:space-between;
        background:transparent;border:none;cursor:pointer;padding:6px 4px;
        font-family:var(--font-ui);font-size:0.75rem;color:var(--text-muted);
        font-weight:600;text-transform:uppercase;letter-spacing:0.05em;
        transition:color 0.15s;">
        <span>${finalExpanded?'▾':'▸'} Finalizadas (${finalizedTasks.length})</span>
        <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text-muted);font-size:0.6875rem;">${esc(sectionLabel)}</span>
      </button>
      <div class="kb-finalized-body" style="${finalExpanded?'':'display:none;'}margin-top:6px;
        opacity:0.7;">
        ${finalVisible.map(cardRenderer).join('')}
        ${finalRemaining > 0 ? `
          <button class="kb-finalized-more" data-final-all-key="${esc(finalAllKey)}" style="
            width:100%;margin-top:6px;padding:6px 10px;border-radius:var(--radius-md);
            border:1px dashed var(--border-subtle);background:transparent;
            color:var(--text-muted);cursor:pointer;font-family:var(--font-ui);
            font-size:0.7rem;font-weight:500;">
            ↓ Ver mais ${finalRemaining} finalizada${finalRemaining>1?'s':''}
          </button>
        ` : (showAllFinal && finalizedTasks.length > KANBAN_FINALIZED_INITIAL ? `
          <button class="kb-finalized-more" data-final-all-key="${esc(finalAllKey)}" data-collapse="1" style="
            width:100%;margin-top:6px;padding:6px 10px;border-radius:var(--radius-md);
            border:1px dashed var(--border-subtle);background:transparent;
            color:var(--text-muted);cursor:pointer;font-family:var(--font-ui);
            font-size:0.7rem;font-weight:500;">
            ↑ Recolher
          </button>
        ` : '')}
      </div>
    </div>`;
  }

  body.innerHTML = html;
  if (count) count.textContent = total;
  if (typeof rebindFn === 'function') rebindFn(body);

  body.querySelector('.kb-load-more')?.addEventListener('click', e => {
    const key = e.currentTarget.dataset.colKey;
    if (e.currentTarget.dataset.collapse) expandedCols.delete(key);
    else expandedCols.add(key);
    renderColumnBodyWithFinalized(body, count, activeTasks, finalizedTasks, colKey, cardRenderer, rebindFn);
  });
  body.querySelector('.kb-finalized-toggle')?.addEventListener('click', e => {
    const key = e.currentTarget.dataset.finalKey;
    if (expandedCols.has(key)) expandedCols.delete(key);
    else expandedCols.add(key);
    renderColumnBodyWithFinalized(body, count, activeTasks, finalizedTasks, colKey, cardRenderer, rebindFn);
  });
  body.querySelector('.kb-finalized-more')?.addEventListener('click', e => {
    const key = e.currentTarget.dataset.finalAllKey;
    if (e.currentTarget.dataset.collapse) expandedCols.delete(key);
    else expandedCols.add(key);
    renderColumnBodyWithFinalized(body, count, activeTasks, finalizedTasks, colKey, cardRenderer, rebindFn);
  });
}

/* ─── Render ─────────────────────────────────────────────── */
export async function renderKanban(container) {
  if (!routeGuard(container, 'task_create')) return;
  // Load users if store is empty (ex: primeiro acesso, aba privativa, refresh em /kanban)
  // Sem isso, os avatares de responsáveis aparecem vazios nos cards.
  const usersNeedLoad = !(store.get('users') || []).length;

  try {
    const jobs = [
      // 4.49.3+ allWorkspaces:true — Steps mostra todos os projetos no filtro
      // (consistente com timeline/calendar/contentCalendar). Antes filtrava por
      // squad ativo, escondendo projetos cross-squad legítimos no dropdown.
      fetchProjects({ allWorkspaces: true }).catch(()=>[]),
      fetchTaskTypes().catch(()=>[]),
    ];
    if (usersNeedLoad) {
      jobs.push((async () => {
        try {
          const { fetchUsers } = await import('../services/users.js');
          await fetchUsers();
        } catch (e) { console.warn('[kanban] users load:', e?.message || e); }
      })());
    }
    const res = await Promise.all(jobs);
    allProjects  = res[0];
    allTaskTypes = res[1];
  } catch(e) {}

  // Types with steps only
  // 4.49.3+ Filtro de visibleSectors removido — pipeline mostra todos os tipos
  // com steps. Antes escondia tipos de outros setores, mas user precisa ver tudo
  // pra escolher esteira/pipeline livremente. Filter explícito por sector
  // (kbFilterState.sector) continua respeitado quando user seleciona um filtro.
  const activeSector  = kbFilterState.sector || null;
  const pipelineTypes = allTaskTypes.filter(t => {
    if (!t.steps?.length) return false;
    if (activeSector) return !t.sector || t.sector === activeSector;
    return true;
  });
  if (!activePipelineTypeId && pipelineTypes.length) {
    activePipelineTypeId = pipelineTypes[0].id;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title" id="kanban-page-title">
          ${activeView === 'pipeline' ? 'Esteira de Produção' : 'Steps'}
        </h1>
        <p class="page-subtitle">
          ${activeView === 'pipeline' ? 'Fluxo de produção por tipo de tarefa' : 'Visualização de tarefas por status'}
        </p>
      </div>
      <div class="page-header-actions">
        <!-- View switcher -->
        <div style="display:flex;border:1px solid var(--border-subtle);border-radius:var(--radius-md);overflow:hidden;">
          <button class="view-switch-btn ${activeView==='kanban'?'active':''}" data-view="kanban"
            style="padding:6px 14px;border:none;cursor:pointer;font-size:0.8125rem;
            background:${activeView==='kanban'?'var(--brand-gold)':'var(--bg-surface)'};
            color:${activeView==='kanban'?'#FFFFFF':'var(--text-secondary)'};transition:all 0.15s;">
            ▤ Kanban
          </button>
          <button class="view-switch-btn ${activeView==='pipeline'?'active':''}" data-view="pipeline"
            style="padding:6px 14px;border:none;cursor:pointer;font-size:0.8125rem;
            background:${activeView==='pipeline'?'var(--brand-gold)':'var(--bg-surface)'};
            color:${activeView==='pipeline'?'#FFFFFF':'var(--text-secondary)'};transition:all 0.15s;">
            ▶ Esteira
          </button>
        </div>

        <!-- Pipeline type selector (only in pipeline view) -->
        ${activeView === 'pipeline' && pipelineTypes.length > 1 ? `
          <div class="toolbar-filter-wrap" style="min-width:170px;">
            <select id="pipeline-type-filter" style="display:none;">
              ${pipelineTypes.map(t =>
                `<option value="${t.id}" ${activePipelineTypeId===t.id?'selected':''}>${t.icon||''} ${esc(t.name)}</option>`
              ).join('')}
            </select>
            ${renderPickerButton({
              btnId: 'pipeline-type-filter-btn',
              selected: (() => {
                const t = pipelineTypes.find(x => x.id === activePipelineTypeId);
                return t ? { id: t.id, label: t.name, icon: t.icon || '', color: '#0EA5E9' } : null;
              })(),
              emptyLabel: 'Selecione o tipo',
            })}
          </div>
        ` : ''}

        <!-- Group-by selector (only in kanban view) -->
        ${activeView === 'kanban' ? `
          <div class="toolbar-filter-wrap" style="min-width:180px;">
            <select id="kanban-groupby" style="display:none;">
              ${GROUPBY_OPTIONS.map(o =>
                `<option value="${o.value}" ${groupBy===o.value?'selected':''}>Agrupar: ${esc(o.label)}</option>`
              ).join('')}
            </select>
            ${renderPickerButton({
              btnId: 'kanban-groupby-btn',
              selected: (() => {
                const o = GROUPBY_OPTIONS.find(x => x.value === groupBy);
                return o ? { id: o.value, label: 'Agrupar: ' + o.label, icon: '', color: groupBy !== 'status' ? '#D4A843' : '#64748B' } : null;
              })(),
              emptyLabel: 'Agrupar: Status',
            })}
          </div>
        ` : ''}

        <!-- Filters rendered below header -->

        ${store.can('task_create') ? `
          <button class="btn btn-primary" id="kanban-new-task-btn">+ Nova Tarefa</button>
        ` : ''}
        <button class="btn btn-ghost btn-icon" id="kanban-prefs-btn" title="Personalizar cards" style="font-size:1rem;">⚙</button>
      </div>
    </div>

    <div id="kb-filter-bar" style="padding:0 2px;"></div>
    <div id="kanban-board-wrap">
      ${activeView === 'pipeline'
        ? renderPipelineBoard(pipelineTypes)
        : (() => {
            // Para a renderização inicial (antes de tasks chegarem), usa STATUSES
            // se groupBy === 'status'; caso contrário, deixa vazio e renderCards
            // re-renderiza o board quando tasks chegarem.
            // Datasets data-group-key-rendered e data-rendered-group-keys são
            // usados em renderCards pra detectar quando re-renderizar (ex: ao
            // mudar groupBy ou quando um grupo deixa de ter tasks e some).
            if (groupBy === 'status') {
              // Inclui coluna virtual "Atrasada" no início
              const initialCols = [
                { value: STATUS_OVERDUE.value, label: STATUS_OVERDUE.label, color: STATUS_OVERDUE.color, virtual: true },
                ...STATUSES.map(s => ({ value: s.value, label: s.label, color: s.color })),
              ];
              const initialKeys = initialCols.map(s => s.value).join('|');
              return `<div class="kanban-board" id="kanban-board"
                data-group-key-rendered="status"
                data-rendered-group-keys="${esc(initialKeys)}">
                ${initialCols.map(s => renderColumn(s, [])).join('')}
              </div>`;
            }
            return `<div class="kanban-board" id="kanban-board"
              data-group-key-rendered=""
              data-rendered-group-keys=""></div>`;
          })()}
    </div>
  `;

  // View switch
  document.querySelectorAll('.view-switch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeView = btn.dataset.view;
      renderKanban(container);
    });
  });

  // Card prefs gear
  document.getElementById('kanban-prefs-btn')?.addEventListener('click', () =>
    openCardPrefsModal(() => renderKanban(container))
  );

  // Pre-select sector for single-sector users
  initKbFilterState();
  // Render filter bar
  _renderKbFilters(container);

  document.getElementById('kanban-new-task-btn')?.addEventListener('click', () => {
    const typeId = activeView === 'pipeline' ? activePipelineTypeId : null;
    openTaskModal({ typeId, onSave: () => {} });
  });

  document.getElementById('pipeline-type-filter')?.addEventListener('change', (e) => {
    activePipelineTypeId = e.target.value;
    renderKanban(container);
  });
  if (document.getElementById('pipeline-type-filter-btn')) {
    const pipeOpts = () => pipelineTypes.map(t => ({ id: t.id, label: t.name, icon: t.icon || '', color: '#0EA5E9' }));
    bindOptionPicker({
      btnId: 'pipeline-type-filter-btn',
      selectId: 'pipeline-type-filter',
      buildConfig: () => ({ options: pipeOpts(), searchPlaceholder: 'Buscar tipo…' }),
      findSelected: (id) => pipeOpts().find(o => o.id === id) || null,
      emptyLabel: 'Selecione o tipo',
    });
  }

  document.getElementById('kanban-groupby')?.addEventListener('change', (e) => {
    setGroupBy(e.target.value);
    renderKanban(container);
  });
  if (document.getElementById('kanban-groupby-btn')) {
    const groupOpts = () => GROUPBY_OPTIONS.map(o => ({
      id: o.value,
      label: 'Agrupar: ' + o.label,
      icon: '',
      color: o.value !== 'status' ? '#D4A843' : '#64748B',
    }));
    bindOptionPicker({
      btnId: 'kanban-groupby-btn',
      selectId: 'kanban-groupby',
      buildConfig: () => ({ options: groupOpts(), searchPlaceholder: 'Buscar agrupamento…' }),
      findSelected: (id) => groupOpts().find(o => o.id === id) || null,
      emptyLabel: 'Agrupar: Status',
    });
  }

  _subscribeToTasks();
}

function _subscribeToTasks() {
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribeToTasks((tasks) => {
    allTasks = tasks;
    if (activeView === 'pipeline') {
      renderPipelineCards(tasks);
    } else {
      const projFilter = document.getElementById('kanban-proj-filter')?.value || '';
      renderCards(tasks, projFilter);
    }
  });
}

/**
 * renderColumn(group, tasks)
 * `group` pode ser um status (compat) ou um grupo derivado (groupBy != 'status').
 * Em ambos os casos, tem { value, label, color }. Para drag-and-drop, lemos
 * o atributo data-col-status (mantido por compat — drop só dispara mudança
 * de status quando groupBy === 'status').
 */
function renderColumn(group, tasks) {
  return `
    <div class="kanban-column" data-col-status="${esc(group.value)}">
      <div class="kanban-column-header" draggable="true" data-col-drag-key="${esc(group.value)}"
        title="Arraste pra reordenar as colunas. A ordem fica salva no seu navegador.">
        <span class="kanban-col-drag-handle" aria-hidden="true">⋮⋮</span>
        <div class="kanban-col-dot" style="background:${group.color};"></div>
        <span class="kanban-col-title">${esc(group.label)}</span>
        <span class="kanban-col-count" id="col-count-${esc(group.value)}">${tasks.length}</span>
      </div>
      ${store.can('task_create') ? `
        <button class="kanban-add-btn kanban-add-btn-top" data-add-status="${esc(group.value)}"
          title="Adicionar tarefa nesta coluna">
          + Adicionar tarefa
        </button>
      ` : ''}
      <div class="kanban-col-body" id="col-body-${esc(group.value)}"
        data-status="${esc(group.value)}">
        ${tasks.map(t => renderKanbanCard(t)).join('')}
      </div>
    </div>
  `;
}

function _renderKbFilters(container) {
  const wrap = document.getElementById('kb-filter-bar');
  if (!wrap) return;
  // Pipeline view already has type selector in header
  // Em groupBy='status' o filtro 'status' é redundante (cada coluna já é um
  // status), então o omitimos. Em outros groupBy é útil pra ver, ex, só
  // tarefas "em andamento" agrupadas por área.
  // v4.49.51+ 'area' removido do filtro em todas as views (era legado/redundante
  // com 'sector'). Continua disponível como GROUPBY (agrupador de colunas).
  const show = activeView === 'kanban'
    ? (groupBy === 'status'
        ? ['sector','type','project','assignee','observer','meta']
        : ['sector','type','project','assignee','observer','status','meta'])
    : ['sector','assignee','observer','status','meta'];
  wrap.innerHTML = renderFilterBar({
    show, state: kbFilterState,
    taskTypes: allTaskTypes,
    projects:  allProjects,
    users:     store.get('users') || [],
  });
  bindFilterBar(wrap, kbFilterState, (newState) => {
    // When sector changes, reset pipeline type so it picks the first valid one
    if (newState.sector !== undefined) {
      activePipelineTypeId = '';
    }
    // 4.48.4+ Persiste filtros do Steps no localStorage
    _saveKbFilters();
    if (activeView === 'kanban') {
      renderCards(allTasks);
    } else {
      renderKanban(container);
    }
  }, { taskTypes: allTaskTypes, projects: allProjects, users: store.get('users') || [] });
}

function renderCards(tasks, _ignored = '') {
  // Merge optimistic tasks (mostrar imediatamente antes do Firestore confirmar)
  const merged = [...optimisticTasks.filter(ot => !tasks.some(t => t.title === ot.title && t.status === ot.status)), ...tasks].filter(t => !t.archived);
  const filterFn = buildFilterFn(kbFilterState);
  const filteredTasks = merged.filter(filterFn);

  // Calcula grupos (colunas) — para 'status' usa STATUSES; outros derivam dos tasks
  const groups = getKanbanGroups(groupBy, filteredTasks);

  // Re-render do board: comparar conjunto de grupos atual com o renderizado.
  // Necessário sempre que:
  //   1. groupBy mudou (ex: status → área)
  //   2. Conjunto de groups mudou (ex: agrupando por área, todas as tarefas
  //      de "Marketing" mudaram de área → coluna Marketing deve sumir)
  //   3. ORDEM dos groups mudou (4.18+: user reordenou colunas via drag —
  //      antes só rebuildava em groupBy != 'status', mas agora qualquer
  //      groupBy permite reorder).
  const board = document.getElementById('kanban-board');
  if (board) {
    const expectedKeys = groups.map(g => g.value).join('|');
    const renderedGroupBy = board.dataset.groupKeyRendered || 'status';
    const renderedKeys = board.dataset.renderedGroupKeys || '';
    const shouldRebuild =
      renderedGroupBy !== groupBy ||
      renderedKeys !== expectedKeys; // 4.18+: rebuild sempre que keys/ordem mudarem
    if (shouldRebuild) {
      board.innerHTML = groups.map(g => renderColumn(g, [])).join('');
      board.dataset.groupKeyRendered = groupBy;
      board.dataset.renderedGroupKeys = expectedKeys;
    }
  }

  groups.forEach(g => {
    const body  = document.getElementById(`col-body-${g.value}`);
    const count = document.getElementById(`col-count-${g.value}`);
    if (!body) return;

    let colTasks = filteredTasks.filter(t => taskBelongsToGroup(t, groupBy, g));

    // Tarefas concluídas/canceladas vão para o final da lista (só faz sentido em status)
    if (groupBy === 'status' && (g.value === 'done' || g.value === 'cancelled')) {
      colTasks.sort((a, b) => {
        const aTime = a.completedAt?.toDate?.() || a.completedAt || a.updatedAt?.toDate?.() || a.updatedAt || 0;
        const bTime = b.completedAt?.toDate?.() || b.completedAt || b.updatedAt?.toDate?.() || b.updatedAt || 0;
        return (new Date(aTime)) - (new Date(bTime));
      });
    }

    // Em groupBy != 'status', cada coluna pode misturar tarefas ativas e
    // concluídas/canceladas. UX pede separação visual: ativas no topo,
    // concluídas no final dentro de uma seção colapsada com cabeçalho.
    // Em status mode (default), a separação já é inerente — cada coluna É
    // um status, então pula esse caminho.
    if (groupBy !== 'status') {
      const isFinalized = (t) => t.status === 'done' || t.status === 'cancelled';
      const active = colTasks.filter(t => !isFinalized(t));
      const finalized = colTasks
        .filter(isFinalized)
        .sort((a, b) => {
          const aTime = a.completedAt?.toDate?.() || a.completedAt || a.updatedAt?.toDate?.() || a.updatedAt || 0;
          const bTime = b.completedAt?.toDate?.() || b.completedAt || b.updatedAt?.toDate?.() || b.updatedAt || 0;
          return (new Date(bTime)) - (new Date(aTime)); // mais recentes no topo da seção
        });

      renderColumnBodyWithFinalized(
        body, count, active, finalized, `kb:${g.value}`,
        t => renderKanbanCard(t),
        b => b.querySelectorAll('.kanban-card').forEach(card => bindCardDrag(card)),
      );
      return;
    }

    renderColumnBody(
      body, count, colTasks, `kb:${g.value}`,
      t => renderKanbanCard(t),
      b => b.querySelectorAll('.kanban-card').forEach(card => bindCardDrag(card)),
    );
  });

  // Bind add buttons (só funciona em status — outros agrupamentos não definem
  // o valor pra criar tarefa; se quiser adicionar fora do status, pré-popula
  // o campo agrupado a partir do dataset)
  document.querySelectorAll('[data-add-status]').forEach(btn => {
    btn.onclick = () => {
      const colVal = btn.dataset.addStatus;
      if (groupBy === 'status') {
        openTaskModal({ status: colVal, onSave: () => {} });
      } else {
        // Pré-popula o campo agrupado quando possível
        const opt = GROUPBY_OPTIONS.find(o => o.value === groupBy);
        const group = groups.find(g => g.value === colVal);
        const taskData = {};
        if (opt && group && group.rawValue != null) {
          if (groupBy === 'assignee') taskData.assignees = [group.rawValue];
          else if (opt.field) taskData[opt.field] = group.rawValue;
        }
        openTaskModal({ taskData, onSave: () => {} });
      }
    };
  });

  // Bind column drop zones (drag-and-drop entre colunas só persiste mudança
  // quando agrupando por status; outros groupBy não têm semântica clara
  // para "mover entre colunas" — a função bindColumnDrop respeita essa regra)
  document.querySelectorAll('.kanban-col-body').forEach(col => bindColumnDrop(col));

  // 4.18+: bind column reorder via drag no header
  bindColumnReorder();
}

/* 4.18+ — Reordenação de colunas via drag no header.
 * Distingue de card-drag pelo prefixo `COL:` no dataTransfer.
 * `bindColumnDrop` (no col-body) já ignora drops com COL: pra não tentar
 * mover task fantasma.
 * Pipeline view (renderPipelineColumn) NÃO usa este sistema — pipeline
 * tem ordem fixa pelos steps[] do task type.
 */
function bindColumnReorder() {
  const headers = document.querySelectorAll('.kanban-column-header[draggable="true"]');
  headers.forEach(h => {
    h.addEventListener('dragstart', (e) => {
      const key = h.dataset.colDragKey;
      if (!key) return;
      e.dataTransfer.setData('text/plain', 'COL:' + key);
      e.dataTransfer.effectAllowed = 'move';
      h.classList.add('col-dragging');
      h.closest('.kanban-column')?.classList.add('col-dragging');
    });
    h.addEventListener('dragend', () => {
      h.classList.remove('col-dragging');
      h.closest('.kanban-column')?.classList.remove('col-dragging');
      document.querySelectorAll('.col-drag-target').forEach(el => el.classList.remove('col-drag-target'));
    });
    h.addEventListener('dragover', (e) => {
      // Só aceita drops de tipo column (texto começando com COL:)
      // dataTransfer.types não permite ler o valor, mas permite checar tipos.
      // Confiamos no .col-dragging do source pra detectar é column drag.
      const src = document.querySelector('.kanban-column-header.col-dragging');
      if (!src) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      h.classList.add('col-drag-target');
    });
    h.addEventListener('dragleave', () => {
      h.classList.remove('col-drag-target');
    });
    h.addEventListener('drop', (e) => {
      e.preventDefault();
      h.classList.remove('col-drag-target');
      const data = e.dataTransfer.getData('text/plain') || '';
      if (!data.startsWith('COL:')) return; // não é column drag
      const fromKey = data.slice(4);
      const toKey = h.dataset.colDragKey;
      if (!fromKey || !toKey || fromKey === toKey) return;
      _reorderColumns(fromKey, toKey);
    });
  });
}

/** Move coluna fromKey pra posição da toKey na ordem visual e persiste. */
function _reorderColumns(fromKey, toKey) {
  // Le ordem atual do DOM
  const cols = [...document.querySelectorAll('.kanban-column[data-col-status]')];
  if (!cols.length) return;
  const order = cols.map(c => c.dataset.colStatus);
  const fromIdx = order.indexOf(fromKey);
  const toIdx = order.indexOf(toKey);
  if (fromIdx === -1 || toIdx === -1) return;
  const [moved] = order.splice(fromIdx, 1);
  order.splice(toIdx, 0, moved);
  _saveColumnOrder(groupBy, order);
  // Re-renderiza com nova ordem
  renderCards(allTasks);
}

/** Adiciona tarefa otimista (aparece imediatamente na UI) */
export function addOptimisticTask(taskData) {
  const optimistic = { ...taskData, _optimistic: true, id: '_opt_' + Date.now() };
  optimisticTasks.push(optimistic);
  renderCards(allTasks);
  return optimistic.id;
}

/** Remove tarefa otimista (quando Firestore confirma ou falha) */
export function removeOptimisticTask(optId) {
  optimisticTasks = optimisticTasks.filter(t => t.id !== optId);
}

function renderKanbanCard(task, type = null) {
  const prio    = PRIORITY_MAP[task.priority] || {};
  const project = allProjects.find(p => p.id === task.projectId);
  const users   = store.get('users') || [];
  const assigneesArr = Array.isArray(task.assignees)
    ? task.assignees
    : (typeof task.assignees === 'string' && task.assignees ? [task.assignees] : []);
  const assignees = assigneesArr.slice(0,3).map(uid => {
    const u = users.find(u=>u.id===uid);
    if (!u) return '';
    return `<div class="avatar" style="background:${u.avatarColor||'#3B82F6'};
      width:22px;height:22px;font-size:0.5rem;
      border:2px solid var(--bg-card);margin-left:-4px;flex-shrink:0;">
      ${userAvatarInner(u)}
    </div>`;
  }).join('');

  const dueText  = task.dueDate ? formatDue(task.dueDate) : '';
  const dueClass = task.dueDate ? getDueClass(task.dueDate, task.status==='done') : '';

  const tagsHTML = (task.tags||[]).slice(0,3).map(tag => {
    const hue = [...tag].reduce((a,c)=>a+c.charCodeAt(0),0) % 360;
    return `<span class="kanban-tag"
      style="background:hsl(${hue},40%,22%);color:hsl(${hue},65%,72%);border:1px solid hsl(${hue},40%,32%);">
      ${esc(tag)}
    </span>`;
  }).join('');

  const subtasks = task.subtasks||[];
  const subDone  = subtasks.filter(s=>s.done).length;

  const isDone = task.status === 'done';
  const canComplete = store.can('task_complete');

  const isSel = _selectedTaskIds.has(task.id);
  return `
    <div class="kanban-card ${task.priority||'medium'} ${isDone?'done':''} ${isSel?'bulk-selected':''}"
      data-task-id="${task.id}"
      draggable="true"
      style="position:relative;${task._optimistic ? 'opacity:0.6;pointer-events:none;' : ''}${isDone ? 'opacity:0.65;' : ''}${isSel ? 'box-shadow:0 0 0 2px var(--brand-gold,#D4A843);' : ''}">
      <input type="checkbox" class="kanban-bulk-checkbox bulk-checkbox" data-bulk-id="${task.id}"
        ${isSel ? 'checked' : ''}
        title="Selecionar para edição em massa"
        style="position:absolute;top:8px;left:8px;width:16px;height:16px;
        cursor:pointer;accent-color:var(--brand-gold);z-index:2;">
      <div class="kanban-card-check ${isDone?'checked':''} ${!canComplete && !isDone ? 'disabled' : ''}"
        data-check-id="${task.id}"
        title="${isDone ? 'Reabrir tarefa' : (canComplete ? 'Marcar como concluída' : 'Sem permissão para concluir')}"
        style="position:absolute;top:8px;right:8px;width:22px;height:22px;
        border-radius:50%;border:2px solid ${isDone ? 'var(--color-success,#22C55E)' : 'var(--border-default,#3B4754)'};
        background:${isDone ? 'var(--color-success,#22C55E)' : 'var(--bg-card,#fff)'};
        cursor:${!canComplete && !isDone ? 'not-allowed' : 'pointer'};
        display:flex;align-items:center;justify-content:center;
        font-size:0.75rem;color:${isDone ? '#fff' : 'var(--text-muted,#9AA5B5)'};
        font-weight:700;line-height:1;
        transition:all 0.15s;z-index:1;
        ${!canComplete && !isDone ? 'opacity:0.4;' : ''}">
        ✓
      </div>
      ${project ? `<div class="kanban-card-project" style="padding-right:32px;">${project.icon} ${esc(project.name)}</div>` : ''}
      <div class="kanban-card-title" style="padding-right:32px;">${esc(task.title)}</div>
      ${task.urgencyOverride?.active ? (() => {
        const ov = task.urgencyOverride;
        const parseAt = v => {
          if (!v) return null;
          if (v instanceof Date && !isNaN(v.getTime())) return v;
          if (typeof v.toDate === 'function') { try { const d=v.toDate(); if(!isNaN(d.getTime())) return d; } catch {} }
          if (typeof v === 'object' && typeof v.seconds === 'number') return new Date(v.seconds * 1000);
          if (typeof v === 'string' || typeof v === 'number') { const d=new Date(v); if(!isNaN(d.getTime())) return d; }
          return null;
        };
        const dt = parseAt(ov.at);
        const dateStr = dt ? dt.toLocaleDateString('pt-BR') : '';
        const tip = `Urgência removida${ov.byName?` por ${ov.byName}`:''}${dateStr?` em ${dateStr}`:''}${ov.reason?` — Motivo: ${ov.reason}`:''}`;
        return `<span title="${esc(tip)}"
          style="display:inline-block;font-size:0.625rem;padding:1px 6px;border-radius:99px;
          background:rgba(59,130,246,0.12);color:#3B82F6;border:1px solid rgba(59,130,246,0.3);
          font-weight:500;margin-bottom:4px;cursor:help;">
          ℹ urgência removida
        </span>`;
      })() : ''}
      ${tagsHTML ? `<div class="kanban-card-tags">${tagsHTML}</div>` : ''}
      ${type ? renderKanbanCardPipelineExtra(task, type) : ''}
      ${subtasks.length ? `
        <div style="padding-left:6px; margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
            <span style="font-size:0.6875rem;color:var(--text-muted);">${subDone}/${subtasks.length} subtarefas</span>
          </div>
          <div class="progress" style="height:3px;">
            <div class="progress-bar" style="width:${subtasks.length?Math.round(subDone/subtasks.length*100):0}%;"></div>
          </div>
        </div>
      ` : ''}
      ${type && task.customFields?.currentStep ? (() => {
        const step = (type.steps||[]).find(s => s.id === task.customFields.currentStep);
        return step ? `<div style="font-size:0.6875rem;padding:2px 6px;border-radius:3px;
          display:inline-block;margin-bottom:4px;
          background:${step.color||'#6B7280'}22;color:${step.color||'#6B7280'};
          border:1px solid ${step.color||'#6B7280'}44;">${esc(step.label)}</div>` : '';
      })() : ''}
      ${renderCardFields(task, { compact: true, skipFields: ['dueDate', 'assignees'] })}
      <div class="kanban-card-meta">
        <div class="kanban-card-due kb-cell-edit ${dueClass}"
          data-edit-field="dueDate" data-edit-id="${task.id}"
          title="Click pra alterar prazo">
          ${dueText ? `📅 ${dueText}` : '📅 —'}
        </div>
        <div class="kb-cell-edit"
          data-edit-field="assignees" data-edit-id="${task.id}"
          title="Click pra alterar responsáveis"
          style="display:flex;align-items:center;margin-left:6px;">${assignees || '<span style="opacity:.5;font-size:0.75rem;">—</span>'}</div>
      </div>
    </div>
  `;
}

/* ─── Drag & Drop ─────────────────────────────────────────── */
function bindCardDrag(card) {
  card.addEventListener('dragstart', (e) => {
    dragTask = allTasks.find(t => t.id === card.dataset.taskId);
    dragOriginCol = card.closest('.kanban-col-body')?.dataset.status;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.taskId);
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    document.querySelectorAll('.kanban-placeholder').forEach(el => el.remove());
  });

  card.addEventListener('click', async (e) => {
    // Click no checkbox de bulk-select (canto superior esquerdo) → toggle
    // selecionado pra batch update via action bar. Não abre modal.
    const bulk = e.target.closest('.kanban-bulk-checkbox[data-bulk-id]');
    if (bulk) {
      e.stopPropagation();
      const id = bulk.dataset.bulkId;
      if (_selectedTaskIds.has(id)) _selectedTaskIds.delete(id);
      else                          _selectedTaskIds.add(id);
      _refreshKanbanBulkUi();
      dragTask = null;
      return;
    }

    // Click numa célula com edição inline (prazo / responsáveis) → popover
    const editCell = e.target.closest('.kb-cell-edit[data-edit-field][data-edit-id]');
    if (editCell) {
      e.stopPropagation();
      const field = editCell.dataset.editField;
      const id    = editCell.dataset.editId;
      const task  = allTasks.find(t => t.id === id);
      if (!task) return;
      await _openKanbanInlineEdit(editCell, field, task);
      dragTask = null;
      return;
    }

    // Click no botão de check (canto superior direito) → toggle status done
    // sem abrir o modal. Aplica o overlay de conclusão (CSAT, evidência, etc)
    // pra paridade com o comportamento da lista de tarefas.
    const check = e.target.closest('.kanban-card-check[data-check-id]');
    if (check) {
      e.stopPropagation();
      if (check.classList.contains('disabled')) return;
      const id = check.dataset.checkId;
      const task = allTasks.find(t => t.id === id);
      if (!task) return;
      const willBeDone = task.status !== 'done';
      try {
        await toggleTaskComplete(id, willBeDone);
        if (willBeDone) {
          const fresh = await getTask(id).catch(() => task);
          openTaskDoneOverlay(id, fresh || task);
        }
      } catch (err) { toast.error(err.message); }
      dragTask = null;
      return;
    }

    if (!dragTask) {
      const task = allTasks.find(t => t.id === card.dataset.taskId);
      if (task) openTaskModal({ taskData: task, onSave: () => {} });
    }
    dragTask = null;
  });
}

function bindColumnDrop(col) {
  col.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    col.classList.add('drag-over');

    // Placeholder position
    const afterEl = getDragAfterElement(col, e.clientY);
    const placeholder = document.querySelector('.kanban-placeholder');
    if (!placeholder) {
      const ph = document.createElement('div');
      ph.className = 'kanban-placeholder';
      if (afterEl) col.insertBefore(ph, afterEl);
      else col.appendChild(ph);
    } else {
      if (afterEl) col.insertBefore(placeholder, afterEl);
      else col.appendChild(placeholder);
    }
  });

  col.addEventListener('dragleave', (e) => {
    if (!col.contains(e.relatedTarget)) {
      col.classList.remove('drag-over');
      document.querySelector('.kanban-placeholder')?.remove();
    }
  });

  col.addEventListener('drop', async (e) => {
    e.preventDefault();
    col.classList.remove('drag-over');
    document.querySelector('.kanban-placeholder')?.remove();

    const taskId   = e.dataTransfer.getData('text/plain');
    // 4.18+: ignora drops de column-drag (prefixo COL:) — esses são
    // tratados em bindColumnReorder no header da coluna destino.
    if (typeof taskId === 'string' && taskId.startsWith('COL:')) return;
    const newColValue = col.dataset.status;

    if (!taskId || !newColValue) return;

    // Drop entre colunas só altera status quando agrupando por status.
    // Para outros groupBy, drag-drop apenas reorganiza visualmente sem
    // persistir (avisa o user). Reordenar dentro da mesma coluna continua
    // funcionando independente do groupBy.
    if (groupBy !== 'status') {
      const sameCol = (dragOriginCol === newColValue);
      if (!sameCol) {
        toast.info('Mudança de coluna só persiste quando agrupado por status. Use o modal pra alterar o campo.');
        // Re-renderiza pra reverter a posição visual
        renderCards(allTasks);
      }
      dragTask = null;
      return;
    }

    // Compute new order from position
    const afterEl = getDragAfterElement(col, e.clientY);
    const cards   = [...col.querySelectorAll('.kanban-card:not(.dragging)')];
    const idx     = afterEl ? cards.indexOf(afterEl) : cards.length;
    const newOrder = idx * 1000 + Date.now() % 1000;

    try {
      await moveTaskKanban(taskId, newColValue, newOrder);

      // Double-check overlay when completing a task via kanban drag
      if (newColValue === 'done') {
        const { getTask } = await import('../services/tasks.js');
        const fresh = await getTask(taskId).catch(() => dragTask);
        openTaskDoneOverlay(taskId, fresh || dragTask || {});
      }
    } catch(err) {
      toast.error('Erro ao mover tarefa: ' + err.message);
    }

    dragTask = null;
  });
}

function getDragAfterElement(col, y) {
  const draggables = [...col.querySelectorAll('.kanban-card:not(.dragging)')];
  return draggables.reduce((closest, child) => {
    const box    = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > (closest.offset ?? -Infinity)) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: -Infinity }).element;
}

function formatDue(ts) {
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit'}).format(d);
}

function getDueClass(ts, done) {
  if (done) return '';
  const d   = ts?.toDate ? ts.toDate() : new Date(ts);
  const diff = (d - new Date()) / (1000*60*60*24);
  if (diff < 0)  return 'overdue';
  if (diff <= 2) return 'soon';
  return '';
}

/* ─── Pipeline (Esteira de Produção) ──────────────────────── */
function renderPipelineBoard(pipelineTypes) {
  const type = pipelineTypes.find(t => t.id === activePipelineTypeId);
  if (!type) {
    return `<div class="empty-state" style="min-height:40vh;">
      <div class="empty-state-icon">▶</div>
      <div class="empty-state-title">Nenhum tipo com steps configurados</div>
      <p class="text-sm text-muted">Acesse Tipos de Tarefa e defina os steps do fluxo de produção.</p>
    </div>`;
  }

  const steps = [...(type.steps||[])].sort((a,b)=>a.order-b.order);
  // Add a virtual "Concluído" column at the end
  const allCols = [
    ...steps,
    { id: '__done__', label: 'Concluído', color: '#22C55E', order: 999 },
  ];

  return `
    <!-- Pipeline type info bar -->
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;
      padding:10px 16px;background:var(--bg-surface);border-radius:var(--radius-md);
      border:1px solid var(--border-subtle);">
      <div style="width:32px;height:32px;border-radius:var(--radius-md);
        background:${type.color||'#D4A843'}22;color:${type.color||'#D4A843'};
        display:flex;align-items:center;justify-content:center;font-size:1.125rem;">
        ${type.icon||'📋'}
      </div>
      <div>
        <div style="font-weight:600;color:var(--text-primary);font-size:0.9375rem;">${esc(type.name)}</div>
        ${type.sla ? `<div style="font-size:0.75rem;color:var(--text-muted);">SLA: ${esc(type.sla.label)}</div>` : ''}
      </div>
      ${type.rules?.blockDuplicate || type.rules?.maxPerDay > 0 ? `
        <div style="margin-left:auto;font-size:0.75rem;color:var(--brand-gold);padding:3px 10px;
          background:rgba(212,168,67,0.1);border-radius:var(--radius-full);border:1px solid rgba(212,168,67,0.3);">
          ⚠ ${type.rules.blockDuplicate ? 'Máx. 1 por dia' : `Máx. ${type.rules.maxPerDay}/dia`}
        </div>
      ` : ''}
    </div>

    <div class="kanban-board" id="kanban-board" style="--col-min:200px;">
      ${allCols.map(col => renderPipelineColumn(col, type, [])).join('')}
    </div>
  `;
}

function renderPipelineColumn(col, type, tasks) {
  const isDone = col.id === '__done__';
  return `
    <div class="kanban-column" data-col-status="${isDone ? 'done' : ''}" data-col-step="${isDone ? '' : col.id}">
      <div class="kanban-column-header">
        <div class="kanban-col-dot" style="background:${col.color||'#6B7280'};"></div>
        <span class="kanban-col-title">${esc(col.label)}</span>
        <span class="kanban-col-count" id="pcol-count-${col.id}">${tasks.length}</span>
      </div>
      ${!isDone && store.can('task_create') ? `
        <button class="kanban-add-btn kanban-add-btn-top" data-add-step="${col.id}" data-type-id="${type.id}"
          title="Adicionar tarefa nesta etapa">
          + Adicionar
        </button>
      ` : ''}
      <div class="kanban-col-body" id="pcol-body-${col.id}"
        data-step="${col.id}" data-status="${isDone ? 'done' : ''}">
        ${tasks.map(t => renderKanbanCard(t, type)).join('')}
      </div>
    </div>
  `;
}

function renderPipelineCards(tasks) {
  const type = allTaskTypes.find(t => t.id === activePipelineTypeId);
  if (!type) return;

  const steps = [...(type.steps||[])].sort((a,b)=>a.order-b.order);
  const typeTasks = tasks.filter(t =>
    !t.archived && (t.typeId === type.id || t.type === type.name?.toLowerCase())
  );

  // Each step column: tasks where customFields.currentStep === step.id
  // Plus: tasks with status 'done' go to __done__
  const allCols = [
    ...steps,
    { id: '__done__', label: 'Concluído', color: '#22C55E', order: 999 },
  ];

  allCols.forEach(col => {
    const body  = document.getElementById(`pcol-body-${col.id}`);
    const count = document.getElementById(`pcol-count-${col.id}`);
    if (!body) return;

    let colTasks;
    if (col.id === '__done__') {
      colTasks = typeTasks.filter(t => t.status === 'done');
      // Concluídas mais recentes no final
      colTasks.sort((a, b) => {
        const aTime = a.completedAt?.toDate?.() || a.completedAt || a.updatedAt?.toDate?.() || a.updatedAt || 0;
        const bTime = b.completedAt?.toDate?.() || b.completedAt || b.updatedAt?.toDate?.() || b.updatedAt || 0;
        return (new Date(aTime)) - (new Date(bTime));
      });
    } else {
      // Tasks in this step: either customFields.currentStep matches, or
      // fall back to first step for tasks without a currentStep
      const isFirstStep = col.id === steps[0]?.id;
      colTasks = typeTasks.filter(t => {
        if (t.status === 'done') return false;
        const cs = t.customFields?.currentStep;
        if (!cs && isFirstStep) return true;
        return cs === col.id;
      });
    }

    renderColumnBody(
      body, count, colTasks, `pipe:${type.id}:${col.id}`,
      t => renderKanbanCard(t, type),
      b => b.querySelectorAll('.kanban-card').forEach(card => bindPipelineCardDrag(card, type)),
    );
  });

  // Bind add buttons
  document.querySelectorAll('[data-add-step]').forEach(btn => {
    btn.onclick = () => {
      const stepId = btn.dataset.addStep;
      const typeId = btn.dataset.typeId;
      openTaskModal({
        typeId,
        status: 'in_progress',
        onSave: () => {},
      });
    };
  });

  // Bind pipeline column drop zones
  document.querySelectorAll('#kanban-board .kanban-col-body').forEach(col => {
    if (col.dataset.step) bindPipelineColumnDrop(col, type);
  });
}

function bindPipelineCardDrag(card, type) {
  card.addEventListener('dragstart', (e) => {
    dragTask = allTasks.find(t => t.id === card.dataset.taskId);
    dragOriginCol = card.closest('.kanban-col-body')?.dataset.step;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.taskId);
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    document.querySelectorAll('.kanban-placeholder').forEach(el => el.remove());
  });

  card.addEventListener('click', () => {
    if (!dragTask) {
      const task = allTasks.find(t => t.id === card.dataset.taskId);
      if (task) openTaskModal({ taskData: task, onSave: () => {} });
    }
    dragTask = null;
  });
}

function bindPipelineColumnDrop(col, type) {
  col.addEventListener('dragover', (e) => {
    e.preventDefault();
    col.classList.add('drag-over');
    const afterEl     = getDragAfterElement(col, e.clientY);
    const placeholder = document.querySelector('.kanban-placeholder');
    if (!placeholder) {
      const ph = document.createElement('div'); ph.className = 'kanban-placeholder';
      if (afterEl) col.insertBefore(ph, afterEl); else col.appendChild(ph);
    } else {
      if (afterEl) col.insertBefore(placeholder, afterEl); else col.appendChild(placeholder);
    }
  });

  col.addEventListener('dragleave', (e) => {
    if (!col.contains(e.relatedTarget)) {
      col.classList.remove('drag-over');
      document.querySelector('.kanban-placeholder')?.remove();
    }
  });

  col.addEventListener('drop', async (e) => {
    e.preventDefault();
    col.classList.remove('drag-over');
    document.querySelector('.kanban-placeholder')?.remove();

    const taskId  = e.dataTransfer.getData('text/plain');
    const stepId  = col.dataset.step;
    const isDone  = col.dataset.status === 'done';
    if (!taskId) return;

    try {
      const { updateTask, getTask } = await import('../services/tasks.js');
      const updates = {
        customFields: { ...(dragTask?.customFields||{}), currentStep: stepId || null },
        status:       isDone ? 'done' : 'in_progress',
        _prevStatus:  dragTask?.status || 'in_progress',
        order:        Date.now(),
      };
      await updateTask(taskId, updates);

      // Double-check overlay when completing a task via kanban drag
      if (isDone) {
        const fresh = await getTask(taskId).catch(() => dragTask);
        openTaskDoneOverlay(taskId, fresh || dragTask || {});
      }
    } catch(err) {
      toast.error('Erro ao mover tarefa: ' + err.message);
    }
    dragTask = null;
  });
}

/* ─── Extended card for pipeline (shows step-specific fields) */
function renderKanbanCardPipelineExtra(task, type) {
  if (!type?.fields) return '';
  const showFields = type.fields.filter(f => f.showInKanban && f.key !== 'currentStep');
  if (!showFields.length) return '';
  return showFields.map(f => {
    const val = task.customFields?.[f.key];
    if (val === null || val === undefined || val === '') return '';
    const display = Array.isArray(val) ? val.join(', ') : String(val);
    return `<div style="font-size:0.6875rem;color:var(--text-muted);margin-top:2px;">
      ${esc(f.label)}: <span style="color:var(--text-secondary);">${esc(display)}</span>
    </div>`;
  }).join('');
}

/* ─── Inline edit popover (prazo / responsáveis) ──────────
 * Click numa célula do card abre o popover compartilhado.
 */
async function _openKanbanInlineEdit(anchor, field, task) {
  const { updateTask } = await import('../services/tasks.js');
  const popovers = await import('../components/taskPopovers.js');

  const onPick = async (patch, label) => {
    try {
      await updateTask(task.id, patch);
      // Subscribe vai trazer dados frescos. Atualiza local pra UI imediata.
      Object.assign(task, patch);
      const idx = allTasks.findIndex(t => t.id === task.id);
      if (idx >= 0) Object.assign(allTasks[idx], patch);
      renderCards(allTasks);
      toast.success(`Atualizado · ${label}`);
    } catch (e) {
      toast.error('Falha: ' + (e.message || 'erro desconhecido'));
    }
  };

  switch (field) {
    case 'dueDate':
      popovers.openDueDatePopover(anchor, { onPick, currentValue: task.dueDate });
      break;
    case 'assignees':
      popovers.openAssigneesPopover(anchor, {
        onPick, currentValue: task.assignees, multi: true,
        allUsers: store.get('users') || [],
      });
      break;
  }
}

/* ─── Bulk select UI refresh ──────────────────────────────── */
function _refreshKanbanBulkUi() {
  // Re-pinta cards selecionados
  document.querySelectorAll('.kanban-card[data-task-id]').forEach(card => {
    const id = card.dataset.taskId;
    const sel = _selectedTaskIds.has(id);
    card.classList.toggle('bulk-selected', sel);
    if (sel) {
      card.style.boxShadow = '0 0 0 2px var(--brand-gold,#D4A843)';
    } else {
      card.style.boxShadow = '';
    }
    const cb = card.querySelector('.kanban-bulk-checkbox');
    if (cb) cb.checked = sel;
  });
  if (!_bulkBar) {
    import('../components/bulkActionBar.js').then(({ mountBulkActionBar }) => {
      _bulkBar = mountBulkActionBar({
        getSelectedIds:   () => [..._selectedTaskIds],
        getSelectedTasks: () => allTasks.filter(t => _selectedTaskIds.has(t.id)),
        onClear: () => {
          _selectedTaskIds.clear();
          _refreshKanbanBulkUi();
        },
        onAfterUpdate: async () => {
          _selectedTaskIds.clear();
          // Subscribe vai trazer dados frescos automaticamente; força re-render
          renderCards(allTasks);
          _refreshKanbanBulkUi();
        },
        allProjects,
        allUsers: store.get('users') || [],
      });
      _bulkBar.update();
    });
  } else {
    _bulkBar.update();
  }
}

export function destroyKanban() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  _selectedTaskIds.clear();
  if (_bulkBar) { _bulkBar.destroy(); _bulkBar = null; }
}
