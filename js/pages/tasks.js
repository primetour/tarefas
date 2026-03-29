import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import {
  fetchTasks, subscribeToTasks, toggleTaskComplete, getTask,
  STATUSES, PRIORITIES, STATUS_MAP, PRIORITY_MAP,
  TASK_TYPES, NEWSLETTER_STATUSES, NUCLEOS,
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
let groupBy      = 'status';    // 'status' | 'priority' | 'project' | 'none'
let searchTerm   = '';
let filterStatus = '';
let filterPriority = '';
let filterProject  = '';
let filterAssignee = '';

/* \u2500\u2500\u2500 Render principal \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
export async function renderTasks(container) {
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
    <div class="toolbar" style="margin-bottom:16px;">
      <div class="toolbar-search">
        <span class="toolbar-search-icon">\ud83d\udd0d</span>
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
        <option value="">Todos os respons\u00e1veis</option>
        ${(store.get('users')||[]).filter(u=>u.active).map(u=>`
          <option value="${u.id}">${esc(u.name)}</option>
        `).join('')}
      </select>
      <div style="margin-left:auto; display:flex; align-items:center; gap:8px;">
        <label style="font-size:0.8125rem; color:var(--text-muted);">Agrupar:</label>
        <select class="filter-select" id="group-by">
          <option value="status">Por status</option>
          <option value="priority">Por prioridade</option>
          <option value="project">Por projeto</option>
          <option value="none">Sem agrupamento</option>
        </select>
      </div>
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

  _attachPageEvents();
  _subscribeToTasks();
}

/* \u2500\u2500\u2500 Real-time subscription \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
function _subscribeToTasks() {
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribeToTasks((tasks) => {
    allTasks = tasks;
    applyFilters();
  });
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
