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
let _delegationAttached = false;
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
let filterSquad    = '';   // workspaceId | '' (todos)

// Visibilidade de filtros (persistida no localStorage por usuário)
const FILTER_VISIBILITY_KEY = 'tasks.filterVisibility.v1';
const DEFAULT_FILTER_VISIBILITY = {
  status: true, priority: true, project: true, assignee: true,
  datePreset: true, squad: true, area: false, tag: false,
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

  // Lê query params do hash (ex: #tasks?projectId=xxx) para pré-filtrar
  // Reset antes de aplicar query para evitar "lembrar" um filtro antigo de outra navegação
  let urlProjectId   = '';
  let urlWorkspaceId = '';
  try {
    const rawHash = window.location.hash || '';
    const qIdx = rawHash.indexOf('?');
    if (qIdx >= 0) {
      const qs = new URLSearchParams(rawHash.slice(qIdx + 1));
      urlProjectId   = qs.get('projectId')   || '';
      urlWorkspaceId = qs.get('workspaceId') || '';
    }
  } catch (_) { /* noop */ }
  filterProject = urlProjectId;
  filterSquad   = urlWorkspaceId;

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
        <button class="btn btn-secondary btn-sm" id="email-task-btn" title="Criar tarefa a partir de email">📧 Email → Tarefa</button>
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
      <select class="filter-select" id="filter-squad" style="${filterVisibility.squad?'':'display:none;'}">
        <option value="">Todos os squads</option>
        <option value="__none__">— Sem squad</option>
        ${(store.get('userWorkspaces')||[]).map(ws => `
          <option value="${ws.id}">${esc(ws.icon || '◈')} ${esc(ws.name)}${ws.multiSector ? ' (multissetor)' : ''}</option>
        `).join('')}
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
      <div style="margin-left:auto; display:flex; align-items:center; gap:8px;">
        <label style="font-size:0.8125rem; color:var(--text-muted);">Agrupar:</label>
        <select class="filter-select" id="group-by">
          <option value="dueDate">Por prazo</option>
          <option value="status">Por status</option>
          <option value="priority">Por prioridade</option>
          <option value="project">Por projeto</option>
          <option value="none">Sem agrupamento</option>
        </select>
        <button class="btn btn-ghost btn-sm" id="filter-config-btn" title="Configurar filtros visíveis"
          style="padding:6px 10px;">⚙</button>
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
      // Se chegou com ?projectId=xxx, seleciona no filtro e garante visível
      if (filterProject) {
        projFilter.value = filterProject;
        projFilter.style.display = '';
        filterVisibility.project = true;
      }
    }
  } catch (e) { console.warn('Projects fetch:', e); }

  // Pré-seleciona squad se chegou via ?workspaceId=xxx
  if (filterSquad) {
    const squadFilter = document.getElementById('filter-squad');
    if (squadFilter) {
      squadFilter.value = filterSquad;
      squadFilter.style.display = '';
      filterVisibility.squad = true;
    }
  }

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
  let result = allTasks.filter(t => !t.archived);

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
  if (filterSquad === '__none__') {
    result = result.filter(t => !t.workspaceId);
  } else if (filterSquad) {
    result = result.filter(t => t.workspaceId === filterSquad);
  }

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
    _attachListEvents();
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
  // Use onXxx assignments (not addEventListener) para os botões críticos:
  // assim, se renderTasks rodar duas vezes em paralelo (ex: initial render +
  // store.subscribe('activeWorkspaces')), o handler não é duplicado e o clique
  // não abre o modal duas vezes.
  const newBtn = document.getElementById('new-task-btn');
  if (newBtn) newBtn.onclick = () => openNewTask();
  const emailBtn = document.getElementById('email-task-btn');
  if (emailBtn) emailBtn.onclick = () => openEmailToTaskModal();
  const importBtn = document.getElementById('tasks-import-btn');
  if (importBtn) importBtn.onclick = () => openPlannerImportModal();
  const xlsBtn = document.getElementById('tasks-export-xls');
  if (xlsBtn) xlsBtn.onclick = exportTasksXls;
  const pdfBtn = document.getElementById('tasks-export-pdf');
  if (pdfBtn) pdfBtn.onclick = exportTasksPdf;

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
  document.getElementById('filter-squad')?.addEventListener('change', e => { filterSquad = e.target.value; applyFilters(); });
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
    { key: 'squad',      label: 'Squad / Workspace' },
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
  // Event delegation: attach ONE set of listeners to the container, not per-element.
  // The flag ensures we never add duplicate listeners across re-renders.
  if (_delegationAttached) return;
  const container = document.getElementById('tasks-container');
  if (!container) return;

  container.addEventListener('click', _handleDelegatedClick);
  container.addEventListener('keydown', _handleDelegatedKeydown);
  _delegationAttached = true;
}

async function _handleDelegatedClick(e) {
  // --- "Empty state" new-task button ---
  const emptyBtn = e.target.closest('#empty-new-task-btn');
  if (emptyBtn) { openNewTask(); return; }

  // --- Task check toggle (must come before row click) ---
  const check = e.target.closest('.task-check[data-check-id]');
  if (check) {
    e.stopPropagation();
    const id   = check.dataset.checkId;
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
    return;
  }

  // --- Add-group-task button (inside group header) ---
  const addGroupBtn = e.target.closest('.add-group-task-btn');
  if (addGroupBtn) {
    e.stopPropagation();
    const key = addGroupBtn.dataset.groupKey;
    const presets = {};
    if (groupBy === 'status')   presets.status    = key;
    if (groupBy === 'priority') presets.priority  = key;
    if (groupBy === 'project')  presets.projectId = key !== 'none' ? key : null;
    openNewTask(presets);
    return;
  }

  // --- Row click -> open modal (skip if clicking check or stop-row link) ---
  const row = e.target.closest('.task-row[data-task-id]');
  if (row) {
    if (e.target.closest('.task-check')) return;
    if (e.target.closest('[data-stop-row]')) return;
    const id   = row.dataset.taskId;
    const task = allTasks.find(t => t.id === id);
    if (task) openTaskModal({ taskData: task, onSave: () => {} });
    return;
  }
}

async function _handleDelegatedKeydown(e) {
  // --- Quick-add input (Enter to create task) ---
  const input = e.target.closest('.quick-add-task-input');
  if (input && e.key === 'Enter') {
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
  }
}

function openNewTask(presets = {}) {
  openTaskModal({ ...presets, onSave: () => {} });
}

/* \u2500\u2500\u2500 Importar Planner (XLSX) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
const PLANNER_STATUS_MAP  = { 'Conclu\u00edda': 'done', 'Em andamento': 'in_progress', 'N\u00e3o iniciado': 'not_started' };
const PLANNER_PRIORITY_MAP = { 'Urgente': 'urgent', 'Importante': 'high', 'M\u00e9dia': 'medium', 'Baixa': 'low' };

async function loadSheetJS() {
  if (window.XLSX) return window.XLSX;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function parsePlannerXlsx(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return rows.map(r => {
    // Parse checklist items
    const checklistRaw = String(r['Itens da lista de verifica\u00e7\u00e3o'] || '');
    const completedRaw = String(r['Itens conclu\u00eddos da lista de verifica\u00e7\u00e3o'] || '');
    const completedCount = parseInt(completedRaw.split('/')[0]) || 0;
    const checklistItems = checklistRaw ? checklistRaw.split(';').map(s => s.trim()).filter(Boolean) : [];

    // Parse labels
    const labelsRaw = String(r['R\u00f3tulos'] || '');
    const labels = labelsRaw ? labelsRaw.split(';').map(s => s.trim()).filter(Boolean) : [];

    // Parse assignees (names, will need resolution to UIDs later)
    const assigneesRaw = String(r['Atribu\u00eddo a'] || '');
    const assigneeNames = assigneesRaw ? assigneesRaw.split(';').map(s => s.trim()).filter(Boolean) : [];

    // Parse dates
    const parseDate = (v) => {
      if (!v) return null;
      const s = String(v).trim();
      if (!s || s === 'NaN') return null;
      // Try dd/mm/yyyy
      const parts = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (parts) return new Date(+parts[3], +parts[2] - 1, +parts[1]);
      // Try Excel serial number
      if (/^\d+(\.\d+)?$/.test(s)) {
        const serial = parseFloat(s);
        if (serial > 40000 && serial < 50000) {
          return new Date((serial - 25569) * 86400 * 1000);
        }
      }
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    };

    return {
      plannerTaskId:  String(r['Identifica\u00e7\u00e3o da tarefa'] || ''),
      title:          String(r['Nome da tarefa'] || '').trim(),
      description:    String(r['Descri\u00e7\u00e3o'] || '').trim().replace(/\\n/g, '\n'),
      bucket:         String(r['Nome do Bucket'] || '').trim(),
      status:         PLANNER_STATUS_MAP[String(r['Progresso'] || '')] || 'not_started',
      priority:       PLANNER_PRIORITY_MAP[String(r['Prioridade'] || '')] || 'medium',
      assigneeNames,
      createdByName:  String(r['Criado por'] || '').trim(),
      createdAt:      parseDate(r['Criado em']),
      startDate:      parseDate(r['Data de in\u00edcio']),
      deadline:       parseDate(r['Data de conclus\u00e3o']),
      completedAt:    parseDate(r['Conclu\u00eddo em']),
      completedByName:String(r['Conclu\u00edda por'] || '').trim(),
      isRecurring:    String(r['\u00c9 Recorrente'] || '').toLowerCase() === 'true',
      isOverdue:      String(r['Atrasados'] || '').toLowerCase() === 'true',
      labels,
      subtasks:       checklistItems.map((item, i) => ({
        title: item,
        done: i < completedCount,
      })),
    };
  }).filter(r => r.title);
}

function resolveAssignees(parsedRows, systemUsers) {
  const nameMap = {};
  systemUsers.forEach(u => {
    if (u.name) {
      nameMap[u.name.toLowerCase().trim()] = u.id;
      // Also map by first+last name partial match
      const parts = u.name.toLowerCase().trim().split(/\s+/);
      if (parts.length >= 2) {
        nameMap[parts[0] + ' ' + parts[parts.length - 1]] = u.id;
      }
    }
  });

  return parsedRows.map(row => {
    const assignees = row.assigneeNames
      .map(name => nameMap[name.toLowerCase().trim()])
      .filter(Boolean);
    const createdBy = nameMap[row.createdByName.toLowerCase().trim()] || null;
    return { ...row, assignees, createdBy };
  });
}

function openPlannerImportModal() {
  modal.open({
    title: '\u2191 Importar Tarefas do Planner',
    size: 'lg',
    content: `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <p style="margin:0;font-size:0.8125rem;color:var(--text-muted);">
          Exporte suas tarefas do Microsoft Planner como Excel (.xlsx) e fa\u00e7a upload aqui.
          O sistema ir\u00e1 mapear os campos automaticamente.
        </p>

        <div style="background:var(--bg-surface);border-radius:10px;padding:20px;border:2px dashed var(--border);
          text-align:center;cursor:pointer;transition:border-color .2s;" id="import-drop-zone">
          <input type="file" id="import-file-input" accept=".xlsx,.xls,.csv"
            style="display:none;" />
          <div style="font-size:2rem;margin-bottom:8px;">\ud83d\udcc1</div>
          <div style="font-size:0.875rem;font-weight:600;color:var(--text-primary);">
            Clique ou arraste o arquivo aqui
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
            Formatos aceitos: .xlsx, .xls, .csv (exporta\u00e7\u00e3o do Planner)
          </div>
        </div>

        <div id="import-preview" style="display:none;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
            <h4 style="margin:0;font-size:0.875rem;font-weight:700;color:var(--text-primary);">
              Pr\u00e9-visualiza\u00e7\u00e3o
            </h4>
            <span id="import-count" style="font-size:0.75rem;color:var(--text-muted);"></span>
          </div>

          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;" id="import-stats"></div>

          <details style="margin-bottom:12px;">
            <summary style="cursor:pointer;font-size:0.8125rem;font-weight:600;color:var(--text-primary);padding:8px 0;">
              Mapeamento de campos
            </summary>
            <div style="font-size:0.75rem;color:var(--text-muted);line-height:1.8;padding:8px 0;">
              <div>\u2714 <strong>Nome da tarefa</strong> \u2192 T\u00edtulo</div>
              <div>\u2714 <strong>Descri\u00e7\u00e3o</strong> \u2192 Descri\u00e7\u00e3o</div>
              <div>\u2714 <strong>Progresso</strong> \u2192 Status (Conclu\u00edda\u2192done, Em andamento\u2192in_progress, N\u00e3o iniciado\u2192not_started)</div>
              <div>\u2714 <strong>Prioridade</strong> \u2192 Prioridade (Urgente\u2192urgent, Importante\u2192high, M\u00e9dia\u2192medium, Baixa\u2192low)</div>
              <div>\u2714 <strong>Atribu\u00eddo a</strong> \u2192 Respons\u00e1veis (resolvido por nome \u2192 UID)</div>
              <div>\u2714 <strong>Data de conclus\u00e3o</strong> \u2192 Prazo</div>
              <div>\u2714 <strong>R\u00f3tulos</strong> \u2192 Tags</div>
              <div>\u2714 <strong>Nome do Bucket</strong> \u2192 Setor / \u00c1rea</div>
              <div>\u2714 <strong>Itens da lista de verifica\u00e7\u00e3o</strong> \u2192 Subtarefas</div>
              <div>\u2714 <strong>Criado em / Conclu\u00eddo em</strong> \u2192 Datas</div>
            </div>
          </details>

          <div style="max-height:260px;overflow-y:auto;border:1px solid var(--border-subtle);border-radius:8px;">
            <table style="width:100%;font-size:0.75rem;border-collapse:collapse;" id="import-table">
              <thead>
                <tr style="position:sticky;top:0;background:var(--bg-surface);">
                  <th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);">
                    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                      <input type="checkbox" id="import-select-all" checked /> Todas
                    </label>
                  </th>
                  <th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);">Tarefa</th>
                  <th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);">Status</th>
                  <th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);">Prioridade</th>
                  <th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);">Bucket</th>
                  <th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);">Prazo</th>
                </tr>
              </thead>
              <tbody id="import-table-body"></tbody>
            </table>
          </div>

          <div style="margin-top:12px;display:flex;gap:8px;align-items:center;">
            <label style="font-size:0.75rem;font-weight:600;color:var(--text-muted);">Filtrar status:</label>
            <select id="import-filter-status" class="form-select" style="font-size:0.75rem;padding:4px 8px;">
              <option value="">Todos</option>
              <option value="not_started">N\u00e3o iniciado</option>
              <option value="in_progress">Em andamento</option>
              <option value="done">Conclu\u00edda</option>
            </select>
            <label style="font-size:0.75rem;font-weight:600;color:var(--text-muted);margin-left:8px;">Duplicatas:</label>
            <select id="import-duplicates" class="form-select" style="font-size:0.75rem;padding:4px 8px;">
              <option value="skip">Pular existentes</option>
              <option value="import">Importar todas</option>
            </select>
          </div>
        </div>

        <div id="import-progress" style="display:none;">
          <div style="background:var(--bg-surface);border-radius:8px;overflow:hidden;height:8px;margin-bottom:8px;">
            <div id="import-progress-bar" style="height:100%;background:var(--brand-blue);width:0%;transition:width .3s;border-radius:8px;"></div>
          </div>
          <div id="import-progress-text" style="font-size:0.75rem;color:var(--text-muted);text-align:center;"></div>
        </div>
      </div>
    `,
    footer: [
      {
        label: '\ud83d\udce5 Importar selecionadas',
        class: 'btn-primary',
        closeOnClick: false,
        onClick: async (e, { close }) => {
          const btn = e.target;
          await executePlannerImport(btn, close);
        },
      },
    ],
  });

  // Wire file input & drag-drop
  setTimeout(() => {
    const dropZone = document.getElementById('import-drop-zone');
    const fileInput = document.getElementById('import-file-input');

    dropZone?.addEventListener('click', () => fileInput?.click());
    dropZone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--brand-blue)';
    });
    dropZone?.addEventListener('dragleave', () => {
      dropZone.style.borderColor = 'var(--border)';
    });
    dropZone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--border)';
      const file = e.dataTransfer?.files?.[0];
      if (file) handleImportFile(file);
    });
    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleImportFile(file);
    });
  }, 200);
}

let _importParsedRows = [];

async function handleImportFile(file) {
  const dropZone = document.getElementById('import-drop-zone');
  const preview = document.getElementById('import-preview');

  try {
    dropZone.innerHTML = '<div style="color:var(--text-muted);font-size:0.8125rem;">\u23f3 Processando...</div>';

    const XLSX = await loadSheetJS();
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });

    _importParsedRows = parsePlannerXlsx(workbook);

    // Resolve assignees with system users
    const users = store.get('users') || [];
    if (users.length) {
      _importParsedRows = resolveAssignees(_importParsedRows, users);
    }

    // Check for existing tasks (by plannerTaskId)
    const existingIds = new Set(
      (store.get('allTasks') || allTasks || [])
        .map(t => t.plannerTaskId)
        .filter(Boolean)
    );
    _importParsedRows.forEach(r => {
      r._exists = existingIds.has(r.plannerTaskId);
    });

    // Show stats
    const stats = document.getElementById('import-stats');
    const byStatus = { done: 0, in_progress: 0, not_started: 0 };
    _importParsedRows.forEach(r => byStatus[r.status] = (byStatus[r.status] || 0) + 1);
    const existing = _importParsedRows.filter(r => r._exists).length;

    stats.innerHTML = `
      <div style="background:var(--bg-card);border-radius:8px;padding:10px;text-align:center;border:1px solid var(--border-subtle);">
        <div style="font-size:1.25rem;font-weight:700;color:var(--brand-green);">${byStatus.done}</div>
        <div style="font-size:0.625rem;color:var(--text-muted);text-transform:uppercase;">Conclu\u00eddas</div>
      </div>
      <div style="background:var(--bg-card);border-radius:8px;padding:10px;text-align:center;border:1px solid var(--border-subtle);">
        <div style="font-size:1.25rem;font-weight:700;color:var(--brand-gold);">${byStatus.in_progress}</div>
        <div style="font-size:0.625rem;color:var(--text-muted);text-transform:uppercase;">Em andamento</div>
      </div>
      <div style="background:var(--bg-card);border-radius:8px;padding:10px;text-align:center;border:1px solid var(--border-subtle);">
        <div style="font-size:1.25rem;font-weight:700;color:var(--text-muted);">${byStatus.not_started}</div>
        <div style="font-size:0.625rem;color:var(--text-muted);text-transform:uppercase;">N\u00e3o iniciadas</div>
      </div>
    `;

    document.getElementById('import-count').textContent =
      `${_importParsedRows.length} tarefas encontradas` + (existing ? ` (${existing} j\u00e1 existentes)` : '');

    // Render table
    renderImportTable('');

    // Wire filter
    document.getElementById('import-filter-status')?.addEventListener('change', (e) => {
      renderImportTable(e.target.value);
    });

    // Wire select-all
    document.getElementById('import-select-all')?.addEventListener('change', (e) => {
      document.querySelectorAll('.import-row-check').forEach(cb => cb.checked = e.target.checked);
    });

    // Update drop zone
    dropZone.innerHTML = `<div style="font-size:0.8125rem;color:var(--brand-green);">\u2705 ${esc(file.name)}</div>`;
    preview.style.display = 'block';
  } catch (err) {
    dropZone.innerHTML = `<div style="color:#EF4444;font-size:0.8125rem;">\u274c Erro: ${esc(err.message)}</div>`;
    toast.error('Erro ao processar arquivo: ' + err.message);
  }
}

function renderImportTable(statusFilter) {
  const tbody = document.getElementById('import-table-body');
  if (!tbody) return;
  const dupMode = document.getElementById('import-duplicates')?.value || 'skip';

  const STATUS_LABELS = { done: 'Conclu\u00edda', in_progress: 'Em andamento', not_started: 'N\u00e3o iniciado' };
  const STATUS_COLORS = { done: 'var(--brand-green)', in_progress: 'var(--brand-gold)', not_started: 'var(--text-muted)' };
  const PRI_LABELS = { urgent: 'Urgente', high: 'Alta', medium: 'M\u00e9dia', low: 'Baixa' };

  const filtered = _importParsedRows.filter(r => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (dupMode === 'skip' && r._exists) return false;
    return true;
  });

  const fmtDate = d => d ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(d) : '\u2014';

  tbody.innerHTML = filtered.map((r, i) => `
    <tr style="border-bottom:1px solid var(--border-subtle);" data-import-idx="${_importParsedRows.indexOf(r)}">
      <td style="padding:4px 8px;">
        <input type="checkbox" class="import-row-check" data-idx="${_importParsedRows.indexOf(r)}" checked />
      </td>
      <td style="padding:4px 8px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${esc(r.title)}${r._exists ? ' <span style="color:var(--brand-gold);font-size:0.625rem;">(existe)</span>' : ''}
      </td>
      <td style="padding:4px 8px;color:${STATUS_COLORS[r.status]};">${STATUS_LABELS[r.status] || r.status}</td>
      <td style="padding:4px 8px;">${PRI_LABELS[r.priority] || r.priority}</td>
      <td style="padding:4px 8px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.bucket)}</td>
      <td style="padding:4px 8px;">${fmtDate(r.deadline)}</td>
    </tr>
  `).join('');
}

async function executePlannerImport(btn, closeModal) {
  const checked = Array.from(document.querySelectorAll('.import-row-check:checked'))
    .map(cb => parseInt(cb.dataset.idx))
    .filter(i => !isNaN(i));

  if (!checked.length) {
    toast.warning('Nenhuma tarefa selecionada para importar.');
    return;
  }

  const rowsToImport = checked.map(i => _importParsedRows[i]).filter(Boolean);
  btn.disabled = true;
  btn.textContent = '\u23f3 Importando...';

  const progressDiv = document.getElementById('import-progress');
  const progressBar = document.getElementById('import-progress-bar');
  const progressText = document.getElementById('import-progress-text');
  if (progressDiv) progressDiv.style.display = 'block';

  const { createTask } = await import('../services/tasks.js');
  const { serverTimestamp, Timestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

  let created = 0, errors = 0;

  for (let i = 0; i < rowsToImport.length; i++) {
    const row = rowsToImport[i];

    if (progressBar) progressBar.style.width = `${((i + 1) / rowsToImport.length * 100).toFixed(0)}%`;
    if (progressText) progressText.textContent = `${i + 1} de ${rowsToImport.length}...`;

    try {
      const taskData = {
        title: row.title,
        description: row.description || '',
        status: row.status,
        priority: row.priority,
        assignees: row.assignees || [],
        tags: row.labels || [],
        sector: row.bucket || '',
        plannerTaskId: row.plannerTaskId,
        importedFrom: 'planner',
        importedAt: serverTimestamp(),
      };

      if (row.deadline) taskData.deadline = Timestamp.fromDate(row.deadline);
      if (row.startDate) taskData.startDate = Timestamp.fromDate(row.startDate);
      if (row.createdAt) taskData.createdAt = Timestamp.fromDate(row.createdAt);
      if (row.completedAt) taskData.completedAt = Timestamp.fromDate(row.completedAt);
      if (row.createdBy) taskData.createdBy = row.createdBy;

      const taskId = await createTask(taskData);

      // Add subtasks if any
      if (row.subtasks.length && taskId) {
        const { addSubtask, toggleSubtask } = await import('../services/tasks.js');
        for (const sub of row.subtasks) {
          try {
            const subId = await addSubtask(taskId, sub.title);
            if (sub.done && subId) {
              await toggleSubtask(taskId, subId, true);
            }
          } catch { /* skip subtask error */ }
        }
      }

      created++;
    } catch (err) {
      console.warn('[import] Failed to import:', row.title, err);
      errors++;
    }
  }

  if (progressText) progressText.textContent = `\u2705 ${created} importadas` + (errors ? `, ${errors} erros` : '');
  toast.success(`Importa\u00e7\u00e3o conclu\u00edda: ${created} tarefas criadas` + (errors ? `, ${errors} erros` : ''));

  setTimeout(() => {
    closeModal();
    // Reload tasks
    if (typeof renderTasks === 'function') {
      const container = document.querySelector('.page-content') || document.querySelector('[data-page]');
      if (container) renderTasks(container);
    }
  }, 1500);
}

/* \u2500\u2500\u2500 Email \u2192 Tarefa \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
function openEmailToTaskModal() {
  modal.open({
    title: '\ud83d\udce7 Criar Tarefa a partir de Email',
    size: 'lg',
    content: `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <p style="margin:0;font-size:0.8125rem;color:var(--text-muted);">
          Cole o conte\u00fado do email abaixo. A IA ir\u00e1 analisar e pr\u00e9-preencher os campos da tarefa automaticamente.
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="font-size:0.75rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;">
              De (remetente)
            </label>
            <input type="text" id="email-from" class="form-input"
              placeholder="nome@empresa.com" style="margin-top:4px;" />
          </div>
          <div>
            <label style="font-size:0.75rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;">
              Assunto
            </label>
            <input type="text" id="email-subject" class="form-input"
              placeholder="Assunto do email" style="margin-top:4px;" />
          </div>
        </div>
        <div>
          <label style="font-size:0.75rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;">
            Corpo do email
          </label>
          <textarea id="email-body" class="form-input" rows="10"
            placeholder="Cole aqui o conte\u00fado completo do email..."
            style="margin-top:4px;resize:vertical;min-height:180px;font-size:0.8125rem;line-height:1.6;"></textarea>
        </div>
        <div id="email-parse-status" style="display:none;padding:10px 14px;border-radius:8px;
          background:var(--bg-surface);font-size:0.8125rem;color:var(--text-muted);text-align:center;">
        </div>
      </div>
    `,
    footer: [
      {
        label: '\u2728 Analisar com IA e criar tarefa',
        class: 'btn-primary',
        closeOnClick: false,
        onClick: async (e, { close }) => {
          const btn = e.target;
          const from    = document.getElementById('email-from')?.value?.trim() || '';
          const subject = document.getElementById('email-subject')?.value?.trim() || '';
          const emailBody = document.getElementById('email-body')?.value?.trim() || '';
          const statusEl = document.getElementById('email-parse-status');

          if (!emailBody && !subject) {
            toast.warning('Cole pelo menos o assunto ou corpo do email.');
            return;
          }

          btn.disabled = true;
          btn.textContent = '\u23f3 Analisando email...';
          if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Enviando para IA...'; }

          try {
            const suggestion = await parseEmailToTask(from, subject, emailBody);

            if (!suggestion) {
              if (statusEl) { statusEl.textContent = 'IA n\u00e3o dispon\u00edvel. Abrindo formul\u00e1rio manual...'; }
              setTimeout(() => {
                close();
                openTaskModal({
                  taskData: {
                    title: subject || 'Tarefa de email',
                    description: `De: ${from}\nAssunto: ${subject}\n\n${emailBody}`,
                  },
                  onSave: () => {},
                });
              }, 800);
              return;
            }

            if (statusEl) { statusEl.textContent = '\u2705 An\u00e1lise conclu\u00edda! Abrindo formul\u00e1rio...'; }
            setTimeout(() => {
              close();
              openTaskModal({
                typeId: suggestion.suggestedTypeId || null,
                taskData: {
                  title:       suggestion.title || subject || 'Tarefa de email',
                  description: suggestion.description || `De: ${from}\nAssunto: ${subject}\n\n${emailBody}`,
                  priority:    suggestion.priority || 'medium',
                  clientName:  suggestion.clientName || from || '',
                  clientEmail: suggestion.clientEmail || from || '',
                },
                onSave: () => {},
              });
            }, 600);
          } catch (err) {
            btn.disabled = false;
            btn.textContent = '\u2728 Analisar com IA e criar tarefa';
            if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = '\u274c Erro: ' + err.message; }
            toast.error('Erro ao analisar email: ' + err.message);
          }
        },
      },
    ],
  });
  setTimeout(() => document.getElementById('email-subject')?.focus(), 200);
}

async function parseEmailToTask(from, subject, body) {
  const { getAIConfig, resolveApiKey } = await import('../services/ai.js');
  const cfg = await getAIConfig() || {};
  const provider = cfg.provider || 'groq';
  const resolved = await resolveApiKey(provider);
  const apiKey = resolved.apiKey;
  if (!apiKey) return null;

  let typesSummary = '';
  try {
    const { fetchTaskTypes } = await import('../services/taskTypes.js');
    const taskTypes = await fetchTaskTypes();
    typesSummary = taskTypes.map(t => `${t.id}: ${t.name} (setor: ${t.sector || 'geral'})`).join('\n');
  } catch { /* ignore */ }

  const systemPrompt = `Voc\u00ea \u00e9 um assistente que analisa emails e extrai informa\u00e7\u00f5es para criar tarefas de trabalho.
${typesSummary ? `Tipos de tarefa dispon\u00edveis:\n${typesSummary}\n` : ''}
Analise o email e retorne APENAS JSON v\u00e1lido (sem markdown, sem \\\`\\\`\\\`) com:
{
  "title": "t\u00edtulo curto e claro para a tarefa (m\u00e1x 80 chars)",
  "description": "descri\u00e7\u00e3o detalhada da demanda extra\u00edda do email, incluindo contexto relevante",
  "priority": "urgent|high|medium|low",
  "suggestedTypeId": "ID do tipo mais adequado ou string vazia",
  "clientName": "nome do remetente/cliente se identific\u00e1vel",
  "clientEmail": "email do remetente se fornecido",
  "deadline": "prazo mencionado no email (formato YYYY-MM-DD) ou string vazia",
  "reasoning": "1 frase explicando sua an\u00e1lise"
}

Regras:
- O t\u00edtulo deve ser uma a\u00e7\u00e3o clara (ex: "Criar arte para campanha X", "Atualizar roteiro Jap\u00e3o")
- A descri\u00e7\u00e3o deve conter o contexto do pedido, n\u00e3o repetir o email inteiro
- Se o email mencionar urg\u00eancia, prazo curto ou palavras como "urgente", "asap", marque priority como "urgent" ou "high"
- Se n\u00e3o conseguir identificar um tipo de tarefa, deixe suggestedTypeId vazio`;

  const userContent = `Email recebido:
De: ${from || '(n\u00e3o informado)'}
Assunto: ${subject || '(sem assunto)'}

Corpo:
${body || '(vazio)'}`;

  let url, headers, reqBody;

  if (provider === 'groq') {
    url = 'https://api.groq.com/openai/v1/chat/completions';
    headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    reqBody = JSON.stringify({
      model: cfg.model || 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      temperature: 0.2, max_tokens: 600,
      response_format: { type: 'json_object' },
    });
  } else if (provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model || 'gemini-2.5-flash'}:generateContent?key=${apiKey}`;
    headers = { 'Content-Type': 'application/json' };
    reqBody = JSON.stringify({
      contents: [{ parts: [{ text: systemPrompt + '\n\n' + userContent }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 600, responseMimeType: 'application/json' },
    });
  } else if (provider === 'openai' || provider === 'azure') {
    url = provider === 'azure' && cfg.azureEndpoint
      ? `${cfg.azureEndpoint}/openai/deployments/${cfg.model || 'gpt-4o-mini'}/chat/completions?api-version=2024-02-01`
      : 'https://api.openai.com/v1/chat/completions';
    headers = {
      'Content-Type': 'application/json',
      ...(provider === 'azure' ? { 'api-key': apiKey } : { 'Authorization': `Bearer ${apiKey}` }),
    };
    reqBody = JSON.stringify({
      model: cfg.model || 'gpt-4o-mini',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      temperature: 0.2, max_tokens: 600,
      response_format: { type: 'json_object' },
    });
  } else if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages';
    headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true' };
    reqBody = JSON.stringify({
      model: cfg.model || 'claude-sonnet-4-20250514',
      max_tokens: 600, system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });
  } else {
    return null;
  }

  const resp = await fetch(url, { method: 'POST', headers, body: reqBody });
  if (!resp.ok) throw new Error(`API ${provider}: ${resp.status}`);
  const data = await resp.json();

  let text = '';
  if (provider === 'gemini') {
    text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } else if (provider === 'anthropic') {
    text = data.content?.[0]?.text || '';
  } else {
    text = data.choices?.[0]?.message?.content || '';
  }

  text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(text); }
  catch { console.warn('[email-to-task] Failed to parse AI response:', text); return null; }
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
  _delegationAttached = false;
}

/* \u2500\u2500\u2500 CSAT prompt on task completion \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500*/
