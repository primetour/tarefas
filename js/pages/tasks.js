import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import {
  fetchTasks, subscribeToTasks, toggleTaskComplete, getTask,
  STATUSES, PRIORITIES, STATUS_MAP, PRIORITY_MAP,
  TASK_TYPES, NEWSLETTER_STATUSES, NUCLEOS, REQUESTING_AREAS,
} from '../services/tasks.js';
import { fetchProjects } from '../services/projects.js';
import { openTaskModal, openTaskDoneOverlay } from '../components/taskModal.js';
import { APP_CONFIG }    from '../config.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* \u2500\u2500\u2500 State \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500*/
let allTasks     = [];
let allProjects  = [];
let pageTaskTypes = [];
let filteredTasks = [];
let unsubscribe  = null;
let groupBy      = 'dueDate';   // 'dueDate' | 'status' | 'priority' | 'project' | 'none'
let searchTerm   = '';
let filterStatus = '';
let filterPriority = '';
let filterProject  = '';
let filterAssignee = '';
let filterDatePreset = '';       // '' | 'today' | 'tomorrow' | 'thisWeek' | 'nextWeek' | 'overdue' | 'thisMonth' | 'custom'
let filterDateFrom = '';         // ISO YYYY-MM-DD (para custom)
let filterDateTo   = '';
let filterArea     = '';
let filterTag      = '';

// Visibilidade de filtros (persistida no localStorage por usuário)
const FILTER_VISIBILITY_KEY = 'tasks.filterVisibility.v1';
const DEFAULT_FILTER_VISIBILITY = {
  status: true, priority: true, project: true, assignee: true,
  datePreset: true, area: false, tag: false,
};
let filterVisibility = { ...DEFAULT_FILTER_VISIBILITY };
function loadFilterVisibility() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_VISIBILITY_KEY) || '{}');
    filterVisibility = { ...DEFAULT_FILTER_VISIBILITY, ...saved };
  } catch (_) { filterVisibility = { ...DEFAULT_FILTER_VISIBILITY }; }
}
function saveFilterVisibility() {
  try { localStorage.setItem(FILTER_VISIBILITY_KEY, JSON.stringify(filterVisibility)); } catch (_) {}
}

/* \u2500\u2500\u2500 Render principal \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
export async function renderTasks(container) {
  loadFilterVisibility();
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Tarefas</h1>
        <p class="page-subtitle" id="tasks-count-label">Carregando...</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-secondary btn-sm" id="tasks-import-btn">\u2191 Importar</button>
        <button class="btn btn-secondary btn-sm" id="tasks-export-xls">\u2193 XLS</button>
        <button class="btn btn-secondary btn-sm" id="tasks-export-pdf">\u2193 PDF</button>
        <button class="btn btn-primary" id="new-task-btn">+ Nova Tarefa</button>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="toolbar" style="margin-bottom:16px;flex-wrap:wrap;">
      <div class="toolbar-search">
        <span class="toolbar-search-icon">\ud83d\udd0d</span>
        <input type="text" class="toolbar-search-input" id="tasks-search"
          placeholder="Buscar tarefas..." />
      </div>
      <select class="filter-select" id="filter-status" style="${filterVisibility.status?'':'display:none;'}">
        <option value="">Todos os status</option>
        ${STATUSES.map(s=>`<option value="${s.value}">${s.label}</option>`).join('')}
      </select>
      <select class="filter-select" id="filter-priority" style="${filterVisibility.priority?'':'display:none;'}">
        <option value="">Todas as prioridades</option>
        ${PRIORITIES.map(p=>`<option value="${p.value}">${p.icon} ${p.label}</option>`).join('')}
      </select>
      <select class="filter-select" id="filter-project" style="${filterVisibility.project?'':'display:none;'}">
        <option value="">Todos os projetos</option>
      </select>
      <select class="filter-select" id="filter-assignee" style="${filterVisibility.assignee?'':'display:none;'}">
        <option value="">Todos os respons\u00e1veis</option>
        ${(store.get('users')||[]).filter(u=>u.active).map(u=>`
          <option value="${u.id}">${esc(u.name)}</option>
        `).join('')}
      </select>
      <select class="filter-select" id="filter-date-preset" style="${filterVisibility.datePreset?'':'display:none;'}">
        <option value="">Qualquer prazo</option>
        <option value="overdue">⚠ Atrasadas</option>
        <option value="today">Hoje</option>
        <option value="tomorrow">Amanhã</option>
        <option value="thisWeek">Esta semana</option>
        <option value="nextWeek">Próxima semana</option>
        <option value="thisMonth">Este mês</option>
        <option value="noDue">Sem prazo</option>
        <option value="custom">Período customizado…</option>
      </select>
      <select class="filter-select" id="filter-area" style="${filterVisibility.area?'':'display:none;'}">
        <option value="">Todas as áreas</option>
        ${REQUESTING_AREAS.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('')}
      </select>
      <select class="filter-select" id="filter-tag" style="${filterVisibility.tag?'':'display:none;'}">
        <option value="">Todas as tags</option>
      </select>
      <button class="btn btn-ghost btn-sm" id="filter-config-btn" title="Configurar filtros visíveis"
        style="padding:6px 10px;">⚙</button>
      <div style="margin-left:auto; display:flex; align-items:center; gap:8px;">
        <label style="font-size:0.8125rem; color:var(--text-muted);">Agrupar:</label>
        <select class="filter-select" id="group-by">
          <option value="dueDate">Por prazo</option>
          <option value="status">Por status</option>
          <option value="priority">Por prioridade</option>
          <option value="project">Por projeto</option>
          <option value="none">Sem agrupamento</option>
        </select>
      </div>
    </div>
    <div id="filter-date-custom" style="display:none;margin-bottom:12px;gap:8px;align-items:center;">
      <label style="font-size:0.8125rem;color:var(--text-muted);">De:</label>
      <input type="date" id="filter-date-from" class="form-input" style="width:150px;" />
      <label style="font-size:0.8125rem;color:var(--text-muted);">Até:</label>
      <input type="date" id="filter-date-to" class="form-input" style="width:150px;" />
      <button class="btn btn-ghost btn-sm" id="filter-date-clear">Limpar</button>
    </div>

    <!-- Task list container -->
    <div id="tasks-container">
      <div class="task-empty">
        <div class="task-empty-icon">\u27f3</div>
        <div class="task-empty-title">Carregando tarefas...</div>
      </div>
    </div>
  `;

  // Load projects for filter
  try {
    allProjects = await fetchProjects();
    const projFilter = document.getElementById('filter-project');
    if (projFilter) {
      allProjects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.icon} ${p.name}`;
        projFilter.appendChild(opt);
      });
    }
  } catch (e) { console.warn('Projects fetch:', e); }

  // Load task types for renderTaskRow custom fields
  try {
    const { fetchTaskTypes } = await import('../services/taskTypes.js');
    pageTaskTypes = await fetchTaskTypes();
  } catch (e) { pageTaskTypes = []; }

  // Lazy: gerar instâncias de tarefas recorrentes pendentes (background)
  import('../services/recurringTasks.js')
    .then(({ runDueRecurrenceGeneration }) => runDueRecurrenceGeneration())
    .then(report => {
      if (report?.created > 0) {
        toast.success(`${report.created} tarefa${report.created > 1 ? 's' : ''} recorrente${report.created > 1 ? 's' : ''} gerada${report.created > 1 ? 's' : ''}.`);
      }
    })
    .catch(e => console.warn('[tasks] recurrence generation:', e?.message || e));

  _attachPageEvents();
  _subscribeToTasks();
}

/* \u2500\u2500\u2500 Real-time subscription \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
function _subscribeToTasks() {
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribeToTasks((tasks) => {
    allTasks = tasks;
    _populateTagFilter();
    applyFilters();
  });
}

function _populateTagFilter() {
  const sel = document.getElementById('filter-tag');
  if (!sel) return;
  const tags = Array.from(new Set((allTasks || []).flatMap(t => t.tags || []))).sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const current = sel.value;
  sel.innerHTML = '<option value="">Todas as tags</option>' + tags.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  if (current && tags.includes(current)) sel.value = current;
}

/* \u2500\u2500\u2500 Filters \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
function applyFilters() {
  let result = [...allTasks];

  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    result = result.filter(t =>
      t.title?.toLowerCase().includes(q) ||
      t.description?.toLowerCase().includes(q) ||
      t.tags?.some(tag=>tag.toLowerCase().includes(q))
    );
  }
  if (filterStatus)   result = result.filter(t => t.status === filterStatus);
  if (filterPriority) result = result.filter(t => t.priority === filterPriority);
  if (filterProject)  result = result.filter(t => t.projectId === filterProject);
  if (filterAssignee) result = result.filter(t => t.assignees?.includes(filterAssignee));
  if (filterArea)     result = result.filter(t => t.requestingArea === filterArea);
  if (filterTag)      result = result.filter(t => (t.tags || []).includes(filterTag));

  // Date preset filters
  if (filterDatePreset) {
    const today = new Date(); today.setHours(0,0,0,0);
    const getDue = t => {
      if (!t.dueDate) return null;
      const d = t.dueDate?.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
      d.setHours(0,0,0,0);
      return d;
    };
    if (filterDatePreset === 'noDue') {
      result = result.filter(t => !t.dueDate);
    } else if (filterDatePreset === 'overdue') {
      result = result.filter(t => { const d = getDue(t); return d && d < today && t.status !== 'done'; });
    } else if (filterDatePreset === 'today') {
      result = result.filter(t => { const d = getDue(t); return d && d.getTime() === today.getTime(); });
    } else if (filterDatePreset === 'tomorrow') {
      const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);
      result = result.filter(t => { const d = getDue(t); return d && d.getTime() === tomorrow.getTime(); });
    } else if (filterDatePreset === 'thisWeek') {
      const end = new Date(today);
      end.setDate(today.getDate() + (7 - today.getDay()));
      end.setHours(23,59,59,999);
      result = result.filter(t => { const d = getDue(t); return d && d >= today && d <= end; });
    } else if (filterDatePreset === 'nextWeek') {
      const startNext = new Date(today);
      startNext.setDate(today.getDate() + (7 - today.getDay()) + 1);
      const endNext = new Date(startNext);
      endNext.setDate(startNext.getDate() + 6);
      endNext.setHours(23,59,59,999);
      result = result.filter(t => { const d = getDue(t); return d && d >= startNext && d <= endNext; });
    } else if (filterDatePreset === 'thisMonth') {
      const startM = new Date(today.getFullYear(), today.getMonth(), 1);
      const endM = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);
      result = result.filter(t => { const d = getDue(t); return d && d >= startM && d <= endM; });
    } else if (filterDatePreset === 'custom' && (filterDateFrom || filterDateTo)) {
      const from = filterDateFrom ? new Date(filterDateFrom + 'T00:00:00') : null;
      const to   = filterDateTo   ? new Date(filterDateTo   + 'T23:59:59') : null;
      result = result.filter(t => {
        const d = getDue(t); if (!d) return false;
        if (from && d < from) return false;
        if (to   && d > to)   return false;
        return true;
      });
    }
  }

  filteredTasks = result;

  const label = document.getElementById('tasks-count-label');
  if (label) {
    label.textContent = `${filteredTasks.length} tarefa${filteredTasks.length !== 1 ? 's' : ''}${allTasks.length !== filteredTasks.length ? ` (de ${allTasks.length})` : ''}`;
  }

  renderTaskList();
}

/* \u2500\u2500\u2500 Render list \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
function renderTaskList() {
  const container = document.getElementById('tasks-container');
  if (!container) return;

  if (filteredTasks.length === 0) {
    container.innerHTML = `
      <div class="task-empty">
        <div class="task-empty-icon">\ud83d\udccb</div>
        <div class="task-empty-title">Nenhuma tarefa encontrada</div>
        <p class="text-sm text-muted mt-2">
          ${allTasks.length === 0
            ? 'Crie sua primeira tarefa clicando em "+ Nova Tarefa".'
            : 'Tente ajustar os filtros para encontrar as tarefas.'}
        </p>
        ${allTasks.length === 0 ? `
          <button class="btn btn-primary mt-4" id="empty-new-task-btn">+ Nova Tarefa</button>
        ` : ''}
      </div>
    `;
    document.getElementById('empty-new-task-btn')?.addEventListener('click', () => openNewTask());
    return;
  }

  if (groupBy === 'none') {
    container.innerHTML = `
      <div class="card" style="overflow:hidden;">
        ${renderListHeader()}
        <div class="task-list" id="task-list-body">
          ${filteredTasks.map(t => renderTaskRow(t)).join('')}
        </div>
      </div>
    `;
  } else {
    const groups = buildGroups();
    container.innerHTML = groups.map(g => `
      <div class="task-group" data-group="${g.key}">
        <div class="task-group-header" onclick="this.closest('.task-group').classList.toggle('collapsed')">
          <span class="task-group-chevron">\u25be</span>
          <span class="task-group-title">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${g.color};"></span>
            ${esc(g.label)}
          </span>
          <span class="task-group-count">${g.tasks.length}</span>
          <div style="margin-left:auto;">
            <button class="btn btn-ghost btn-sm add-group-task-btn" data-group-key="${g.key}"
              style="font-size:0.75rem; padding:3px 8px;">
              + Adicionar
            </button>
          </div>
        </div>
        <div class="task-group-body">
          <div class="card" style="overflow:hidden; margin-bottom:4px;">
            ${renderListHeader()}
            <div class="task-list">
              ${g.tasks.map(t => renderTaskRow(t)).join('')}
            </div>
          </div>
          ${renderQuickAdd(g.key)}
        </div>
      </div>
    `).join('');
  }

  _attachListEvents();
}

function renderListHeader() {
  return `<div class="task-list-header">
    <div></div>
    <div>Título</div>
    <div>Status</div>
    <div>Tipo / Etapa</div>
    <div>Área</div>
    <div>Prazo</div>
    <div>Responsáveis</div>
  </div>`;
}

function renderTaskRow(task) {
  const isDone  = task.status === 'done';
  const status  = STATUS_MAP[task.status]   || { label: task.status, color: '#6B7280' };
  const prio    = PRIORITY_MAP[task.priority] || { label: task.priority, color: '#6B7280' };
  const project = allProjects.find(p => p.id === task.projectId);
  const users   = store.get('users') || [];
  // Defensivo: assignees pode vir como string se a IA salvou errado
  const assigneesArr = Array.isArray(task.assignees)
    ? task.assignees
    : (typeof task.assignees === 'string' && task.assignees ? [task.assignees] : []);
  const assignees = assigneesArr.slice(0,3).map(uid => {
    const u = users.find(u=>u.id===uid);
    if (!u) return '';
    return `<div class="avatar avatar-sm" title="${esc(u.name)}"
      style="background:${u.avatarColor||'#3B82F6'}; margin-left:-6px; border:2px solid var(--bg-card);">
      ${(u.name||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()}
    </div>`;
  }).join('');
  const extraAssignees = assigneesArr.length > 3
    ? `<div class="avatar avatar-sm" style="background:var(--bg-elevated); color:var(--text-muted); margin-left:-6px; border:2px solid var(--bg-card); font-size:0.5rem;">
        +${(assigneesArr.length-3)}
      </div>` : '';

  const dueText = task.dueDate ? formatDue(task.dueDate) : '';
  const dueClass = task.dueDate ? getDueClass(task.dueDate, isDone) : '';

  const nlStatus = task.type === 'newsletter' && task.newsletterStatus
    ? NEWSLETTER_STATUSES?.find(s=>s.value===task.newsletterStatus)?.label || task.newsletterStatus
    : null;
  const typeLabel = TASK_TYPES?.find(t=>t.value===task.type)?.label || '';

  const canComplete = store.can('task_complete');
  const subs = Array.isArray(task.subtasks) ? task.subtasks : [];
  const subDone = subs.filter(s => s.done).length;
  const subPct = subs.length ? Math.round((subDone / subs.length) * 100) : 0;
  return `
    <div class="task-row ${isDone?'done':''}" data-task-id="${task.id}">
      <div class="task-check ${isDone?'checked':''} ${!canComplete && !isDone ? 'disabled' : ''}"
           data-check-id="${task.id}"
           ${!canComplete && !isDone ? 'title="Sem permissão para concluir tarefas. Peça a um coordenador."' : ''}>
        ${isDone ? '✓' : ''}
      </div>
      <div>
        <div class="task-row-title">
          ${esc(task.title)}
          ${task.deliveryLink ? `<a href="${esc(task.deliveryLink)}" target="_blank" rel="noopener"
            title="Abrir link da entrega" data-stop-row
            style="margin-left:6px;font-size:0.75rem;color:var(--brand-gold);text-decoration:none;">🔗</a>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:2px;align-items:center;">
          <span class="badge badge-priority-${task.priority}" style="font-size:0.6rem;">${prio.label}</span>
          ${(task.nucleos||[]).length ? `<span style="font-size:0.6875rem;color:var(--text-muted);">◈ ${(task.nucleos||[]).map(n=>NUCLEOS.find(x=>x.value===n)?.label||n).join(', ')}</span>` : ''}
          ${task.tags?.length ? task.tags.slice(0,2).map(t=>`<span style="font-size:0.6875rem;color:var(--text-muted);">#${esc(t)}</span>`).join('') : ''}
          ${project ? `<span style="font-size:0.6875rem;color:var(--text-muted);">${project.icon} ${esc(project.name)}</span>` : ''}
          ${subs.length ? `
            <span title="${subDone}/${subs.length} subtarefas concluídas" style="display:inline-flex;align-items:center;gap:4px;font-size:0.6875rem;color:var(--text-muted);">
              <span style="width:40px;height:4px;background:var(--bg-elevated);border-radius:2px;overflow:hidden;display:inline-block;">
                <span style="display:block;height:100%;width:${subPct}%;background:${subPct===100?'var(--color-success)':'var(--brand-gold)'};"></span>
              </span>
              ${subDone}/${subs.length}
            </span>` : ''}
        </div>
      </div>
      <div>
        <span class="badge badge-status-${task.status}" style="font-size:0.6875rem;">
          ${status.label}
        </span>
      </div>
      <div style="font-size:0.8125rem;">
        ${typeLabel ? `<div style="color:var(--text-secondary);">${esc(typeLabel)}</div>` : '—'}
        ${nlStatus ? `<div style="font-size:0.75rem;color:var(--brand-gold);margin-top:2px;">↳ ${esc(nlStatus)}</div>` : ''}
        ${(() => {
          // Show showInList custom fields for this task's type
          if (!task.typeId && !task.type) return '';
          const tt = pageTaskTypes.find(t => t.id === task.typeId || t.name?.toLowerCase() === task.type);
          if (!tt) return '';
          return (tt.fields||[])
            .filter(f => f.showInList && f.key !== 'newsletterStatus' && f.key !== 'outOfCalendar')
            .map(f => {
              const val = task.customFields?.[f.key];
              if (val === null || val === undefined || val === '') return '';
              const display = Array.isArray(val) ? val.join(', ') : String(val);
              return `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:1px;">${esc(f.label)}: ${esc(display)}</div>`;
            }).join('');
        })()}
      </div>
      <div style="font-size:0.8125rem; color:var(--text-muted);">
        ${task.requestingArea ? esc(task.requestingArea) : '—'}
      </div>
      <div class="kanban-card-due ${dueClass}" style="font-size:0.8125rem;">${dueText}</div>
      <div style="display:flex; align-items:center;">${assignees}${extraAssignees}</div>
    </div>

  `;
}

function renderQuickAdd(groupKey) {
  return `
    <div class="quick-add-bar" data-group="${groupKey}" style="margin-top:4px;">
      <span style="color:var(--text-muted);font-size:1rem;">+</span>
      <input type="text" class="quick-add-input quick-add-task-input"
        placeholder="Adicionar tarefa... (Enter para confirmar)"
        data-group="${groupKey}" maxlength="200" />
    </div>
  `;
}

function buildGroups() {
  if (groupBy === 'dueDate') {
    const buckets = {
      overdue:    { key:'overdue',    label:'⚠ Atrasadas',      color:'#EF4444', tasks: [] },
      today:      { key:'today',      label:'📅 Hoje',           color:'#FBBF24', tasks: [] },
      tomorrow:   { key:'tomorrow',   label:'⏰ Amanhã',         color:'#F59E0B', tasks: [] },
      thisWeek:   { key:'thisWeek',   label:'📆 Esta semana',    color:'#60A5FA', tasks: [] },
      nextWeek:   { key:'nextWeek',   label:'🗓 Próxima semana', color:'#38BDF8', tasks: [] },
      future:     { key:'future',     label:'🔮 Futuro',         color:'#A78BFA', tasks: [] },
      noDue:      { key:'noDue',      label:'∅ Sem prazo',       color:'#6B7280', tasks: [] },
      done:       { key:'done',       label:'✓ Concluídas',      color:'#22C55E', tasks: [] },
    };
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);
    // Fim da semana atual (domingo)
    const endOfWeek = new Date(today);
    endOfWeek.setDate(today.getDate() + (7 - today.getDay()));
    endOfWeek.setHours(23,59,59,999);
    const endOfNextWeek = new Date(endOfWeek);
    endOfNextWeek.setDate(endOfWeek.getDate() + 7);

    filteredTasks.forEach(t => {
      if (t.status === 'done') { buckets.done.tasks.push(t); return; }
      if (!t.dueDate) { buckets.noDue.tasks.push(t); return; }
      const due = t.dueDate?.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
      const dueDay = new Date(due); dueDay.setHours(0,0,0,0);
      if (dueDay < today)              buckets.overdue.tasks.push(t);
      else if (dueDay.getTime() === today.getTime()) buckets.today.tasks.push(t);
      else if (dueDay.getTime() === tomorrow.getTime()) buckets.tomorrow.tasks.push(t);
      else if (dueDay <= endOfWeek)    buckets.thisWeek.tasks.push(t);
      else if (dueDay <= endOfNextWeek) buckets.nextWeek.tasks.push(t);
      else                             buckets.future.tasks.push(t);
    });
    // Sort inside each bucket by closest due
    const byDue = (a, b) => {
      const da = a.dueDate?.toDate ? a.dueDate.toDate() : (a.dueDate ? new Date(a.dueDate) : new Date(8640000000000000));
      const db = b.dueDate?.toDate ? b.dueDate.toDate() : (b.dueDate ? new Date(b.dueDate) : new Date(8640000000000000));
      return da - db;
    };
    Object.values(buckets).forEach(b => b.tasks.sort(byDue));
    return Object.values(buckets).filter(b => b.tasks.length > 0);
  }
  if (groupBy === 'status') {
    return STATUSES.map(s => ({
      key:   s.value,
      label: s.label,
      color: s.color,
      tasks: filteredTasks.filter(t => t.status === s.value),
    })).filter(g => g.tasks.length > 0);
  }
  if (groupBy === 'priority') {
    return PRIORITIES.map(p => ({
      key:   p.value,
      label: p.label,
      color: p.color,
      tasks: filteredTasks.filter(t => t.priority === p.value),
    })).filter(g => g.tasks.length > 0);
  }
  if (groupBy === 'project') {
    const groups = [];
    const noProject = filteredTasks.filter(t => !t.projectId);
    allProjects.forEach(p => {
      const tasks = filteredTasks.filter(t => t.projectId === p.id);
      if (tasks.length) groups.push({ key: p.id, label: `${p.icon} ${p.name}`, color: p.color, tasks });
    });
    if (noProject.length) groups.push({ key: 'none', label: 'Sem projeto', color: '#6B7280', tasks: noProject });
    return groups;
  }
  return [];
}

/* \u2500\u2500\u2500 Event Handlers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
function _attachPageEvents() {
  document.getElementById('new-task-btn')?.addEventListener('click', () => openNewTask());
  document.getElementById('tasks-export-xls')?.addEventListener('click', exportTasksXls);
  document.getElementById('tasks-export-pdf')?.addEventListener('click', exportTasksPdf);

  // Search
  let timer;
  document.getElementById('tasks-search')?.addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { searchTerm = e.target.value; applyFilters(); }, 250);
  });

  // Filters
  document.getElementById('filter-status')?.addEventListener('change', e => { filterStatus = e.target.value; applyFilters(); });
  document.getElementById('filter-priority')?.addEventListener('change', e => { filterPriority = e.target.value; applyFilters(); });
  document.getElementById('filter-project')?.addEventListener('change', e => { filterProject = e.target.value; applyFilters(); });
  document.getElementById('filter-assignee')?.addEventListener('change', e => { filterAssignee = e.target.value; applyFilters(); });
  document.getElementById('filter-area')?.addEventListener('change', e => { filterArea = e.target.value; applyFilters(); });
  document.getElementById('filter-tag')?.addEventListener('change', e => { filterTag = e.target.value; applyFilters(); });
  document.getElementById('filter-date-preset')?.addEventListener('change', e => {
    filterDatePreset = e.target.value;
    const customBar = document.getElementById('filter-date-custom');
    if (customBar) customBar.style.display = (filterDatePreset === 'custom') ? 'flex' : 'none';
    if (filterDatePreset !== 'custom') { filterDateFrom = ''; filterDateTo = ''; }
    applyFilters();
  });
  document.getElementById('filter-date-from')?.addEventListener('change', e => { filterDateFrom = e.target.value; applyFilters(); });
  document.getElementById('filter-date-to')?.addEventListener('change', e => { filterDateTo = e.target.value; applyFilters(); });
  document.getElementById('filter-date-clear')?.addEventListener('click', () => {
    filterDatePreset = ''; filterDateFrom = ''; filterDateTo = '';
    const sel = document.getElementById('filter-date-preset'); if (sel) sel.value = '';
    const fromI = document.getElementById('filter-date-from'); if (fromI) fromI.value = '';
    const toI   = document.getElementById('filter-date-to');   if (toI)   toI.value = '';
    const customBar = document.getElementById('filter-date-custom'); if (customBar) customBar.style.display = 'none';
    applyFilters();
  });
  document.getElementById('filter-config-btn')?.addEventListener('click', openFilterConfigModal);
  document.getElementById('group-by')?.addEventListener('change', e => { groupBy = e.target.value; renderTaskList(); });
}

/* ─── Modal de configuração de filtros visíveis ──────────── */
function openFilterConfigModal() {
  const items = [
    { key: 'status',     label: 'Status' },
    { key: 'priority',   label: 'Prioridade' },
    { key: 'project',    label: 'Projeto' },
    { key: 'assignee',   label: 'Responsável' },
    { key: 'datePreset', label: 'Prazo (hoje, semana, mês…)' },
    { key: 'area',       label: 'Área solicitante' },
    { key: 'tag',        label: 'Tag' },
  ];
  const content = `
    <p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:12px;">
      Escolha quais filtros aparecem na barra de ferramentas. Sua preferência fica salva neste navegador.
    </p>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${items.map(it => `
        <label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:6px;cursor:pointer;">
          <input type="checkbox" class="filter-vis-check" data-key="${it.key}"
            ${filterVisibility[it.key] ? 'checked' : ''} />
          <span style="font-size:0.875rem;">${it.label}</span>
        </label>
      `).join('')}
    </div>
  `;
  modal.open({
    title: '⚙ Configurar filtros',
    size: 'sm',
    content,
    footer: [
      { label: 'Restaurar padrão', class: 'btn-secondary', closeOnClick: false, onClick: (_, { close }) => {
        filterVisibility = { ...DEFAULT_FILTER_VISIBILITY };
        saveFilterVisibility();
        close();
        renderTasks(document.getElementById('page-content') || document.body.querySelector('#page-content'));
      } },
      { label: 'Cancelar', class: 'btn-secondary', closeOnClick: true },
      { label: 'Salvar', class: 'btn-primary', closeOnClick: false, onClick: (_, { close }) => {
        document.querySelectorAll('.filter-vis-check').forEach(cb => {
          filterVisibility[cb.dataset.key] = cb.checked;
        });
        saveFilterVisibility();
        close();
        toast.success('Preferências de filtro salvas.');
        // Re-render a página para aplicar a visibilidade
        const host = document.getElementById('page-content') || document.querySelector('main') || document.body;
        if (host) renderTasks(host);
      } },
    ],
  });
}

function _attachListEvents() {
  // Check toggle
  document.querySelectorAll('.task-check[data-check-id]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id   = el.dataset.checkId;
      const task = allTasks.find(t => t.id === id);
      if (!task) return;
      const isDone = task.status !== 'done';
      try {
        await toggleTaskComplete(id, isDone);
        if (isDone) {
          const fresh = await getTask(id).catch(() => task);
          openTaskDoneOverlay(id, fresh);
        }
      } catch(err) { toast.error(err.message); }
    });
  });

  // Row click \u2192 open modal
  document.querySelectorAll('.task-row[data-task-id]').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.task-check')) return;
      if (e.target.closest('[data-stop-row]')) return;
      const id   = row.dataset.taskId;
      const task = allTasks.find(t => t.id === id);
      if (task) openTaskModal({ taskData: task, onSave: () => {} });
    });
  });

  // Quick add
  document.querySelectorAll('.quick-add-task-input').forEach(input => {
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const val = input.value.trim();
      if (!val) return;
      e.preventDefault();
      const groupKey = input.dataset.group;
      const newTaskData = { title: val };
      if (groupBy === 'status' && groupKey !== 'none') newTaskData.status = groupKey;
      if (groupBy === 'priority' && groupKey !== 'none') newTaskData.priority = groupKey;
      if (groupBy === 'project' && groupKey !== 'none') newTaskData.projectId = groupKey;
      try {
        const { createTask } = await import('../services/tasks.js');
        await createTask(newTaskData);
        input.value = '';
        toast.success('Tarefa criada!');
      } catch(err) { toast.error(err.message); }
    });
  });

  // Add group task button
  document.querySelectorAll('.add-group-task-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.groupKey;
      const presets = {};
      if (groupBy === 'status')   presets.status    = key;
      if (groupBy === 'priority') presets.priority  = key;
      if (groupBy === 'project')  presets.projectId = key !== 'none' ? key : null;
      openNewTask(presets);
    });
  });
}

function openNewTask(presets = {}) {
  openTaskModal({ ...presets, onSave: () => {} });
}

/* \u2500\u2500\u2500 Helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
function formatDue(ts) {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' }).format(d);
}

function getDueClass(ts, done) {
  if (done) return '';
  const d   = ts?.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const diff = (d - now) / (1000 * 60 * 60 * 24);
  if (diff < 0)  return 'overdue';
  if (diff <= 2) return 'soon';
  return '';
}

/* ─── Helpers for export ─────────────────────────────────── */
const fmtDateExport = ts => { if(!ts) return ''; const d = ts?.toDate ? ts.toDate() : new Date(ts); return d.toLocaleDateString('pt-BR'); };

function _buildTaskRows() {
  const users = store.get('users') || [];
  return filteredTasks.map(t => {
    const project = allProjects.find(p => p.id === t.projectId);
    const assigneeNames = (t.assignees || [])
      .map(uid => users.find(u => u.id === uid)?.name || uid).join('; ');
    const due = fmtDateExport(t.dueDate);
    const created = fmtDateExport(t.createdAt);
    const completed = fmtDateExport(t.completedAt);
    const nucleo = NUCLEOS?.find(n => n.value === t.nucleo)?.label || t.nucleo || '';
    const taskType = TASK_TYPES?.find(tt => tt.value === t.taskType)?.label || t.taskType || '';
    return {
      title: t.title || '',
      status: STATUS_MAP[t.status]?.label || t.status || '',
      priority: PRIORITY_MAP[t.priority]?.label || t.priority || '',
      due,
      created,
      completed,
      project: project?.name || '',
      assignees: assigneeNames,
      nucleo,
      taskType,
      tags: (t.tags || []).join('; '),
      clientEmail: t.clientEmail || '',
      goalLinked: t.goalId ? 'Sim' : 'Não',
    };
  });
}

async function exportTasksXls() {
  if (!filteredTasks.length) { toast.error('Nenhuma tarefa para exportar.'); return; }
  if (!window.XLSX) await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });

  const headers = ['Título', 'Status', 'Prioridade', 'Prazo', 'Criada em', 'Concluída em',
    'Projeto', 'Responsáveis', 'Núcleo', 'Tipo', 'Tags', 'E-mail cliente', 'Meta vinculada'];
  const rows = _buildTaskRows().map(r => [
    r.title, r.status, r.priority, r.due, r.created, r.completed,
    r.project, r.assignees, r.nucleo, r.taskType, r.tags, r.clientEmail, r.goalLinked,
  ]);

  const wb = window.XLSX.utils.book_new();
  const ws = window.XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [35, 14, 12, 12, 12, 12, 20, 25, 15, 15, 20, 25, 10].map(w => ({ wch: w }));
  window.XLSX.utils.book_append_sheet(wb, ws, 'Tarefas');
  window.XLSX.writeFile(wb, `primetour_tarefas_${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast.success('XLS exportado.');
}

async function exportTasksPdf() {
  if (!filteredTasks.length) { toast.error('Nenhuma tarefa para exportar.'); return; }
  if (!window.jspdf) {
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(36, 35, 98);
  doc.text('PRIMETOUR — Tarefas', 14, 16);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 100, 100);
  doc.text(`Gerado em ${new Date().toLocaleDateString('pt-BR')} · ${filteredTasks.length} tarefas`, 14, 22);

  const taskRows = _buildTaskRows().map(r => [
    r.title.slice(0, 35), r.status, r.priority, r.due, r.project.slice(0, 20),
    r.assignees.slice(0, 25), r.nucleo.slice(0, 15), r.taskType.slice(0, 15),
    r.completed, r.goalLinked,
  ]);

  doc.autoTable({
    startY: 27,
    head: [['Título', 'Status', 'Prioridade', 'Prazo', 'Projeto', 'Responsáveis', 'Núcleo', 'Tipo', 'Concluída', 'Meta']],
    body: taskRows,
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [36, 35, 98], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 247, 244] },
    columnStyles: {
      0: { cellWidth: 40 }, 1: { cellWidth: 18 }, 2: { cellWidth: 16 }, 3: { cellWidth: 18 },
      4: { cellWidth: 25 }, 5: { cellWidth: 30 }, 6: { cellWidth: 20 }, 7: { cellWidth: 20 },
      8: { cellWidth: 18 }, 9: { cellWidth: 12 },
    },
  });

  doc.save(`primetour_tarefas_${new Date().toISOString().slice(0, 10)}.pdf`);
  toast.success('PDF exportado.');
}

/* \u2500\u2500\u2500 Cleanup \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
export function destroyTasksPage() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}

/* \u2500\u2500\u2500 CSAT prompt on task completion \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500*/
