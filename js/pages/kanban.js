/**
 * PRIMETOUR — Kanban Board
 * Board drag-and-drop com colunas por status
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import {
  subscribeToTasks, moveTaskKanban, createTask,
  STATUSES, PRIORITY_MAP,
} from '../services/tasks.js';
import { fetchProjects }  from '../services/projects.js';
import { openTaskModal }  from '../components/taskModal.js';
import { fetchTaskTypes }         from '../services/taskTypes.js';
import {
  renderFilterBar, bindFilterBar, buildFilterFn,
} from '../components/filterBar.js';
import { openCardPrefsModal }     from '../components/cardPrefsModal.js';
import { renderCardFields }       from '../services/cardPrefs.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let allTasks     = [];
let allProjects  = [];
let allTaskTypes = [];
let unsubscribe  = null;
let dragTask     = null;
let dragOriginCol = null;
let activeView   = 'kanban';   // 'kanban' | 'pipeline'
let kbFilterState = { sector: null, type: null, project: null, area: null, assignee: null };

function initKbFilterState() {
  // Pre-select user's sector on first load (only if single-sector user)
  if (!kbFilterState.sector) {
    const sectors = store.getVisibleSectors();
    if (sectors && sectors.length === 1) kbFilterState.sector = sectors[0];
  }
}
let activePipelineTypeId = ''; // tipo selecionado na esteira

/* ─── Render ─────────────────────────────────────────────── */
export async function renderKanban(container) {
  try {
    [allProjects, allTaskTypes] = await Promise.all([
      fetchProjects().catch(()=>[]),
      fetchTaskTypes().catch(()=>[]),
    ]);
  } catch(e) {}

  // Types with steps only
  const userSectors = store.getVisibleSectors();
  const pipelineTypes = allTaskTypes.filter(t =>
    t.steps?.length > 0 &&
    (!t.sector || userSectors === null || userSectors.includes(t.sector))
  );
  if (!activePipelineTypeId && pipelineTypes.length) {
    activePipelineTypeId = pipelineTypes[0].id;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title" id="kanban-page-title">
          ${activeView === 'pipeline' ? 'Esteira de Produção' : 'Kanban'}
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
            color:${activeView==='kanban'?'#000':'var(--text-secondary)'};transition:all 0.15s;">
            ▤ Kanban
          </button>
          <button class="view-switch-btn ${activeView==='pipeline'?'active':''}" data-view="pipeline"
            style="padding:6px 14px;border:none;cursor:pointer;font-size:0.8125rem;
            background:${activeView==='pipeline'?'var(--brand-gold)':'var(--bg-surface)'};
            color:${activeView==='pipeline'?'#000':'var(--text-secondary)'};transition:all 0.15s;">
            ▶ Esteira
          </button>
        </div>

        <!-- Pipeline type selector (only in pipeline view) -->
        ${activeView === 'pipeline' && pipelineTypes.length > 1 ? `
          <select class="filter-select" id="pipeline-type-filter" style="min-width:160px;">
            ${pipelineTypes.map(t =>
              `<option value="${t.id}" ${activePipelineTypeId===t.id?'selected':''}>
                ${t.icon||''} ${esc(t.name)}
              </option>`
            ).join('')}
          </select>
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
        : `<div class="kanban-board" id="kanban-board">
            ${STATUSES.map(s => renderColumn(s, [])).join('')}
           </div>`}
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

function renderColumn(status, tasks) {
  return `
    <div class="kanban-column" data-col-status="${status.value}">
      <div class="kanban-column-header">
        <div class="kanban-col-dot" style="background:${status.color};"></div>
        <span class="kanban-col-title">${status.label}</span>
        <span class="kanban-col-count" id="col-count-${status.value}">${tasks.length}</span>
      </div>
      <div class="kanban-col-body" id="col-body-${status.value}"
        data-status="${status.value}">
        ${tasks.map(t => renderKanbanCard(t)).join('')}
      </div>
      ${store.can('task_create') ? `
        <button class="kanban-add-btn" data-add-status="${status.value}">
          + Adicionar tarefa
        </button>
      ` : ''}
    </div>
  `;
}

function _renderKbFilters(container) {
  const wrap = document.getElementById('kb-filter-bar');
  if (!wrap) return;
  // Pipeline view already has type selector in header
  const show = activeView === 'kanban'
    ? ['sector','type','project','area','assignee']
    : ['sector','area','assignee'];
  wrap.innerHTML = renderFilterBar({
    show, state: kbFilterState,
    taskTypes: allTaskTypes,
    projects:  allProjects,
    users:     store.get('users') || [],
  });
  bindFilterBar(wrap, kbFilterState, () => {
    if (activeView === 'kanban') {
      renderCards(allTasks);
    } else {
      renderKanban(container);
    }
  });
}

function renderCards(tasks, _ignored = '') {
  STATUSES.forEach(s => {
    const body  = document.getElementById(`col-body-${s.value}`);
    const count = document.getElementById(`col-count-${s.value}`);
    if (!body) return;

    let colTasks = tasks.filter(t => t.status === s.value && filterFn(t));

    body.innerHTML = colTasks.map(t => renderKanbanCard(t)).join('');
    if (count) count.textContent = colTasks.length;

    // Re-bind drag events
    body.querySelectorAll('.kanban-card').forEach(card => bindCardDrag(card));
  });

  // Bind add buttons
  document.querySelectorAll('[data-add-status]').forEach(btn => {
    btn.onclick = () => {
      const status = btn.dataset.addStatus;
      openTaskModal({ status, onSave: () => {} });
    };
  });

  // Bind column drop zones
  document.querySelectorAll('.kanban-col-body').forEach(col => bindColumnDrop(col));
}

function renderKanbanCard(task, type = null) {
  const prio    = PRIORITY_MAP[task.priority] || {};
  const project = allProjects.find(p => p.id === task.projectId);
  const users   = store.get('users') || [];
  const assignees = (task.assignees||[]).slice(0,3).map(uid => {
    const u = users.find(u=>u.id===uid);
    if (!u) return '';
    return `<div class="avatar" style="background:${u.avatarColor||'#3B82F6'};
      width:22px;height:22px;font-size:0.5rem;
      border:2px solid var(--bg-card);margin-left:-4px;flex-shrink:0;">
      ${(u.name||'').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()}
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

  return `
    <div class="kanban-card ${task.priority||'medium'}"
      data-task-id="${task.id}"
      draggable="true">
      ${project ? `<div class="kanban-card-project">${project.icon} ${esc(project.name)}</div>` : ''}
      <div class="kanban-card-title">${esc(task.title)}</div>
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
      ${renderCardFields(task, { compact: true })}
      <div class="kanban-card-meta">
        <div class="kanban-card-due ${dueClass}">
          ${dueText ? `📅 ${dueText}` : ''}
        </div>
        <div style="display:flex;align-items:center;margin-left:6px;">${assignees}</div>
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

  card.addEventListener('click', (e) => {
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
    const newStatus = col.dataset.status;

    if (!taskId || !newStatus) return;

    // Compute new order from position
    const afterEl = getDragAfterElement(col, e.clientY);
    const cards   = [...col.querySelectorAll('.kanban-card:not(.dragging)')];
    const idx     = afterEl ? cards.indexOf(afterEl) : cards.length;
    const newOrder = idx * 1000 + Date.now() % 1000;

    try {
      await moveTaskKanban(taskId, newStatus, newOrder);
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
      <div class="kanban-col-body" id="pcol-body-${col.id}"
        data-step="${col.id}" data-status="${isDone ? 'done' : ''}">
        ${tasks.map(t => renderKanbanCard(t, type)).join('')}
      </div>
      ${!isDone && store.can('task_create') ? `
        <button class="kanban-add-btn" data-add-step="${col.id}" data-type-id="${type.id}">
          + Adicionar
        </button>
      ` : ''}
    </div>
  `;
}

function renderPipelineCards(tasks) {
  const type = allTaskTypes.find(t => t.id === activePipelineTypeId);
  if (!type) return;

  const steps = [...(type.steps||[])].sort((a,b)=>a.order-b.order);
  const typeTasks = tasks.filter(t =>
    t.typeId === type.id || t.type === type.name?.toLowerCase()
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

    body.innerHTML = colTasks.map(t => renderKanbanCard(t, type)).join('');
    if (count) count.textContent = colTasks.length;
    body.querySelectorAll('.kanban-card').forEach(card => bindPipelineCardDrag(card, type));
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
      const { updateTask } = await import('../services/tasks.js');
      const updates = {
        customFields: { ...(dragTask?.customFields||{}), currentStep: stepId || null },
        status:       isDone ? 'done' : 'in_progress',
        order:        Date.now(),
      };
      await updateTask(taskId, updates);
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

export function destroyKanban() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}
