/**
 * PRIMETOUR — Tasks Page
 * Visualização em lista, tabela e agrupamentos
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import {
  fetchTasks, subscribeToTasks, toggleTaskComplete,
  STATUSES, PRIORITIES, STATUS_MAP, PRIORITY_MAP,
  NEWSLETTER_STATUSES, TASK_TYPES, REQUESTING_AREAS, NUCLEOS,
} from '../services/tasks.js';
import { fetchTaskTypes } from '../services/taskTypes.js';
import { fetchProjects } from '../services/projects.js';
import { openTaskModal } from '../components/taskModal.js';
import { APP_CONFIG }    from '../config.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ─── State ─────────────────────────────────────────────────*/
let allTasks     = [];
let allProjects  = [];
let filteredTasks = [];
let unsubscribe  = null;
let groupBy      = 'status';    // 'status' | 'priority' | 'project' | 'none'
let searchTerm   = '';
let filterStatus = '';
let filterPriority = '';
let filterProject  = '';
let filterAssignee = '';
let filterArea        = '';
let filterType        = '';
let filterNucleo      = '';
let filterTypeId      = '';          // filtro por tipo dinâmico
let filterCustomField = {};          // { fieldKey: value }
let pageTaskTypes     = [];          // tipos carregados para a página

/* ─── Render principal ───────────────────────────────────── */
export async function renderTasks(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Tarefas</h1>
        <p class="page-subtitle" id="tasks-count-label">Carregando...</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-secondary btn-sm" id="tasks-import-btn">↑ Importar</button>
        <button class="btn btn-secondary btn-sm" id="tasks-export-btn">↓ Exportar CSV</button>
        <button class="btn btn-primary" id="new-task-btn">+ Nova Tarefa</button>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="toolbar" style="margin-bottom:16px;">
      <div class="toolbar-search">
        <span class="toolbar-search-icon">🔍</span>
        <input type="text" class="toolbar-search-input" id="tasks-search"
          placeholder="Buscar tarefas..." />
      </div>
      <select class="filter-select" id="filter-status">
        <option value="">Todos os status</option>
        ${STATUSES.map(s=>`<option value="${s.value}">${s.label}</option>`).join('')}
      </select>
      <select class="filter-select" id="filter-priority">
        <option value="">Todas as prioridades</option>
        ${PRIORITIES.map(p=>`<option value="${p.value}">${p.icon} ${p.label}</option>`).join('')}
      </select>
      <select class="filter-select" id="filter-project">
        <option value="">Todos os projetos</option>
      </select>
      <select class="filter-select" id="filter-assignee">
        <option value="">Todos os responsáveis</option>
        ${(store.get('users')||[]).filter(u=>u.active).map(u=>`
          <option value="${u.id}">${esc(u.name)}</option>
        `).join('')}
      </select>
      <select class="filter-select" id="filter-type-id">
        <option value="">Todos os tipos</option>
        ${pageTaskTypes.map(t=>`<option value="${t.id}" ${filterTypeId===t.id?'selected':''}>${esc(t.icon||'')} ${esc(t.name)}</option>`).join('')}
      </select>
      <div id="dynamic-type-filters"></div>
      <select class="filter-select" id="filter-area">
        <option value="">Todas as áreas</option>
        ${REQUESTING_AREAS.map(a=>`<option value="${a}">${esc(a)}</option>`).join('')}
      </select>
      <select class="filter-select" id="filter-nucleo">
        <option value="">Todos os núcleos</option>
        ${NUCLEOS.map(n=>`<option value="${n.value}">${esc(n.label)}</option>`).join('')}
      </select>
      <div style="margin-left:auto; display:flex; align-items:center; gap:8px;">
        <label style="font-size:0.8125rem; color:var(--text-muted);">Agrupar:</label>
        <select class="filter-select" id="group-by">
          <option value="status">Por status</option>
          <option value="priority">Por prioridade</option>
          <option value="project">Por projeto</option>
          <option value="area">Por área</option>
          <option value="type">Por tipo</option>
          <option value="nucleo">Por núcleo</option>
          <option value="none">Sem agrupamento</option>
        </select>
      </div>
    </div>

    <!-- Task list container -->
    <div id="tasks-container">
      <div class="task-empty">
        <div class="task-empty-icon">⟳</div>
        <div class="task-empty-title">Carregando tarefas...</div>
      </div>
    </div>
  `;

  // Load task types for dynamic filters
  try {
    pageTaskTypes = store.get('taskTypes') || await fetchTaskTypes();
  } catch(e) { pageTaskTypes = []; }

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

  _attachPageEvents();
  _subscribeToTasks();
}

/* ─── Real-time subscription ─────────────────────────────── */
function _subscribeToTasks() {
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribeToTasks((tasks) => {
    allTasks = tasks;
    applyFilters();
  });
}

/* ─── Filters ────────────────────────────────────────────── */
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
  if (filterType)     result = result.filter(t => t.type === filterType);
  if (filterNucleo)   result = result.filter(t => (t.nucleos||[]).includes(filterNucleo));
  if (filterTypeId)   result = result.filter(t => t.typeId === filterTypeId || t.type === filterTypeId);
  // Dynamic custom field filters
  Object.entries(filterCustomField).forEach(([key, val]) => {
    if (!val) return;
    result = result.filter(t => {
      const cfVal = t.customFields?.[key];
      if (Array.isArray(cfVal)) return cfVal.includes(val);
      return cfVal === val || String(cfVal||'') === val;
    });
  });

  filteredTasks = result;

  const label = document.getElementById('tasks-count-label');
  if (label) {
    label.textContent = `${filteredTasks.length} tarefa${filteredTasks.length !== 1 ? 's' : ''}${allTasks.length !== filteredTasks.length ? ` (de ${allTasks.length})` : ''}`;
  }

  renderTaskList();
}

/* ─── Render list ─────────────────────────────────────────── */
function renderTaskList() {
  const container = document.getElementById('tasks-container');
  if (!container) return;

  if (filteredTasks.length === 0) {
    container.innerHTML = `
      <div class="task-empty">
        <div class="task-empty-icon">📋</div>
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
          <span class="task-group-chevron">▾</span>
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
    <div>Tipo / Variação</div>
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
  const assignees = (task.assignees||[]).slice(0,3).map(uid => {
    const u = users.find(u=>u.id===uid);
    if (!u) return '';
    return `<div class="avatar avatar-sm" title="${esc(u.name)}"
      style="background:${u.avatarColor||'#3B82F6'}; margin-left:-6px; border:2px solid var(--bg-card);">
      ${(u.name||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()}
    </div>`;
  }).join('');
  const extraAssignees = (task.assignees||[]).length > 3
    ? `<div class="avatar avatar-sm" style="background:var(--bg-elevated); color:var(--text-muted); margin-left:-6px; border:2px solid var(--bg-card); font-size:0.5rem;">
        +${(task.assignees.length-3)}
      </div>` : '';

  const dueText = task.dueDate ? formatDue(task.dueDate) : '';
  const dueClass = task.dueDate ? getDueClass(task.dueDate, isDone) : '';

  const nlStatus = task.type === 'newsletter' && task.newsletterStatus
    ? NEWSLETTER_STATUSES?.find(s=>s.value===task.newsletterStatus)?.label || task.newsletterStatus
    : null;
  const typeLabel = TASK_TYPES?.find(t=>t.value===task.type)?.label || '';

  return `
    <div class="task-row ${isDone?'done':''}" data-task-id="${task.id}">
      <div class="task-check ${isDone?'checked':''}" data-check-id="${task.id}">
        ${isDone ? '✓' : ''}
      </div>
      <div>
        <div class="task-row-title">${esc(task.title)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:2px;align-items:center;">
          <span class="badge badge-priority-${task.priority}" style="font-size:0.6rem;">${prio.label}</span>
          ${(task.nucleos||[]).length ? `<span style="font-size:0.6875rem;color:var(--text-muted);">◈ ${(task.nucleos||[]).map(n=>NUCLEOS.find(x=>x.value===n)?.label||n).join(', ')}</span>` : ''}
          ${task.tags?.length ? task.tags.slice(0,2).map(t=>`<span style="font-size:0.6875rem;color:var(--text-muted);">#${esc(t)}</span>`).join('') : ''}
          ${project ? `<span style="font-size:0.6875rem;color:var(--text-muted);">${project.icon} ${esc(project.name)}</span>` : ''}
        </div>
      </div>
      <div>
        <span class="badge badge-status-${task.status}" style="font-size:0.6875rem;">
          ${status.label}
        </span>
      </div>
      <div style="font-size:0.8125rem;">
        ${(() => {
          const tt = pageTaskTypes.find(t => t.id === task.typeId || t.name?.toLowerCase() === task.type);
          const name = tt?.name || typeLabel;
          return name ? `<div style="color:var(--text-secondary);">${esc(name)}</div>` : '—';
        })()}
        ${task.variationName ? `<div style="font-size:0.75rem;color:var(--brand-gold);margin-top:2px;">↳ ${esc(task.variationName)}</div>` : ''}
        ${nlStatus ? `<div style="font-size:0.75rem;color:var(--brand-gold);margin-top:2px;">↳ ${esc(nlStatus)}</div>` : ''}
        ${(() => {
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

/* ─── Groups ──────────────────────────────────────────────── */
function buildGroups() {
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
  if (groupBy === 'area') {
    const groups = REQUESTING_AREAS.map(a => ({
      key: a, label: a, color: '#38BDF8',
      tasks: filteredTasks.filter(t => t.requestingArea === a),
    })).filter(g => g.tasks.length > 0);
    const noArea = filteredTasks.filter(t => !t.requestingArea);
    if (noArea.length) groups.push({ key: 'none', label: 'Sem área', color: '#6B7280', tasks: noArea });
    return groups;
  }
  if (groupBy === 'type') {
    return TASK_TYPES.map(t => ({
      key: t.value||'standard', label: t.label, color: '#A78BFA',
      tasks: filteredTasks.filter(task => (task.type||'') === (t.value||'')),
    })).filter(g => g.tasks.length > 0);
  }
  if (groupBy === 'nucleo') {
    const groups = NUCLEOS.map(n => ({
      key: n.value, label: n.label, color: '#2EC4B6',
      tasks: filteredTasks.filter(t => (t.nucleos||[]).includes(n.value)),
    })).filter(g => g.tasks.length > 0);
    const noNucleo = filteredTasks.filter(t => !(t.nucleos||[]).length);
    if (noNucleo.length) groups.push({ key:'none', label:'Sem núcleo', color:'#6B7280', tasks: noNucleo });
    return groups;
  }
  return [];
}

/* ─── Dynamic type filters ───────────────────────────────── */
function renderDynamicTypeFilters() {
  const container = document.getElementById('dynamic-type-filters');
  if (!container) return;

  if (!filterTypeId) { container.innerHTML = ''; return; }

  const taskType = pageTaskTypes.find(t => t.id === filterTypeId);
  if (!taskType) { container.innerHTML = ''; return; }

  // Only fields with showInList and type select/multiselect/checkbox
  const filterableFields = (taskType.fields || []).filter(f =>
    f.showInList && ['select','multiselect','checkbox'].includes(f.type)
  );

  container.innerHTML = filterableFields.map(f => {
    const curVal = filterCustomField[f.key] || '';
    if (f.type === 'checkbox') {
      return `<select class="filter-select dynamic-type-filter" data-field-key="${f.key}">
        <option value="">Todos (${f.label})</option>
        <option value="true"  ${curVal==='true'?'selected':''}>✓ ${esc(f.label)}</option>
        <option value="false" ${curVal==='false'?'selected':''}>✗ Não ${esc(f.label)}</option>
      </select>`;
    }
    return `<select class="filter-select dynamic-type-filter" data-field-key="${f.key}">
      <option value="">Todos (${esc(f.label)})</option>
      ${(f.options||[]).map(opt =>
        `<option value="${esc(opt)}" ${curVal===opt?'selected':''}>${esc(opt)}</option>`
      ).join('')}
    </select>`;
  }).join('');

  container.querySelectorAll('.dynamic-type-filter').forEach(sel => {
    sel.addEventListener('change', e => {
      filterCustomField[sel.dataset.fieldKey] = e.target.value || '';
      applyFilters();
    });
  });
}

/* ─── Event Handlers ──────────────────────────────────────── */
function _attachPageEvents() {
  document.getElementById('new-task-btn')?.addEventListener('click', () => openNewTask());
  document.getElementById('tasks-export-btn')?.addEventListener('click', exportCSV);

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
  document.getElementById('filter-type')?.addEventListener('change', e => { filterType = e.target.value; applyFilters(); });
  document.getElementById('filter-area')?.addEventListener('change', e => { filterArea = e.target.value; applyFilters(); });
  document.getElementById('filter-nucleo')?.addEventListener('change', e => { filterNucleo = e.target.value; applyFilters(); });
  document.getElementById('filter-type-id')?.addEventListener('change', e => {
    filterTypeId      = e.target.value;
    filterCustomField = {};
    applyFilters();
    renderDynamicTypeFilters();
  });
  document.getElementById('group-by')?.addEventListener('change', e => { groupBy = e.target.value; renderTaskList(); });
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
        if (isDone) setTimeout(() => _offerCsatPrompt(task), 700);
      } catch(err) { toast.error(err.message); }
    });
  });

  // Row click → open modal
  document.querySelectorAll('.task-row[data-task-id]').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.task-check')) return;
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

/* ─── Helpers ─────────────────────────────────────────────── */
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

function exportCSV() {
  const headers = ['Título','Status','Prioridade','Tipo','Etapa Newsletter','Área Solicitante','Núcleos','Fora do Calendário','Prazo','Projeto','Responsáveis','Tags'];
  const users   = store.get('users') || [];
  const rows = filteredTasks.map(t => {
    const project = allProjects.find(p=>p.id===t.projectId);
    const assigneeNames = (t.assignees||[])
      .map(uid => users.find(u=>u.id===uid)?.name||uid).join('; ');
    const due = t.dueDate ? (t.dueDate?.toDate ? t.dueDate.toDate() : new Date(t.dueDate))
      .toLocaleDateString('pt-BR') : '';
    const typeLabel = TASK_TYPES?.find(x=>x.value===t.type)?.label||'';
    const nlLabel   = t.type==='newsletter'
      ? (NEWSLETTER_STATUSES?.find(s=>s.value===t.newsletterStatus)?.label||'') : '';
    const nucleosLabel = (t.nucleos||[]).map(n=>NUCLEOS.find(x=>x.value===n)?.label||n).join('; ');
    return [
      t.title, STATUS_MAP[t.status]?.label||t.status,
      PRIORITY_MAP[t.priority]?.label||t.priority,
      typeLabel, nlLabel, t.requestingArea||'',
      nucleosLabel, t.outOfCalendar?'Sim':'Não',
      due, project?.name||'', assigneeNames, (t.tags||[]).join('; ')
    ];
  });

  const csv = [headers,...rows]
    .map(r=>r.map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `tarefas_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success('Exportação concluída!');
}

/* ─── Cleanup ─────────────────────────────────────────────── */
export function destroyTasksPage() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}

/* ─── CSAT prompt on task completion ────────────────────────*/
function _offerCsatPrompt(task) {
  // Show a subtle toast with action button
  const toastEl = document.createElement('div');
  toastEl.className = 'toast toast-info';
  toastEl.style.cssText = 'max-width:340px; cursor:default;';
  toastEl.innerHTML = `
    <div style="display:flex; align-items:flex-start; gap:10px; width:100%;">
      <span style="font-size:1.125rem; flex-shrink:0;">★</span>
      <div style="flex:1; min-width:0;">
        <div style="font-size:0.875rem; font-weight:600; color:var(--text-primary); margin-bottom:3px;">
          Tarefa concluída!
        </div>
        <div style="font-size:0.8125rem; color:var(--text-secondary); margin-bottom:8px;">
          Deseja enviar uma pesquisa de satisfação ao cliente?
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-primary btn-sm csat-toast-yes" style="font-size:0.75rem; padding:4px 10px;">
            Criar pesquisa
          </button>
          <button class="btn btn-ghost btn-sm csat-toast-no" style="font-size:0.75rem; padding:4px 10px; color:var(--text-muted);">
            Não agora
          </button>
        </div>
      </div>
    </div>
  `;

  const container = document.getElementById('toast-container');
  if (!container) return;
  container.appendChild(toastEl);
  requestAnimationFrame(() => toastEl.classList.add('show'));

  const remove = () => {
    toastEl.classList.remove('show');
    setTimeout(() => toastEl.remove(), 350);
  };

  toastEl.querySelector('.csat-toast-yes')?.addEventListener('click', () => {
    remove();
    location.hash = '#csat';
    // Small delay to let route render, then open modal
    setTimeout(async () => {
      const { renderCsat } = await import('./csat.js').catch(() => ({ renderCsat: null }));
      // The CSAT page will open with the task pre-selected via the new-survey modal
      const newBtn = document.getElementById('csat-new-btn');
      newBtn?.click();
    }, 400);
  });

  toastEl.querySelector('.csat-toast-no')?.addEventListener('click', remove);
  setTimeout(remove, 8000);
}
