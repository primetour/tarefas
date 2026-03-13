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
import { fetchProjects } from '../services/projects.js';
import { openTaskModal } from '../components/taskModal.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let allTasks    = [];
let allProjects = [];
let unsubscribe = null;
let dragTask    = null;
let dragOriginCol = null;

/* ─── Render ─────────────────────────────────────────────── */
export async function renderKanban(container) {
  try { allProjects = await fetchProjects(); } catch(e) {}

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Kanban</h1>
        <p class="page-subtitle">Visualização de tarefas por status</p>
      </div>
      <div class="page-header-actions">
        <select class="filter-select" id="kanban-proj-filter" style="min-width:160px;">
          <option value="">Todos os projetos</option>
          ${allProjects.map(p=>`<option value="${p.id}">${p.icon} ${esc(p.name)}</option>`).join('')}
        </select>
        <button class="btn btn-primary" id="kanban-new-task-btn">+ Nova Tarefa</button>
      </div>
    </div>

    <div class="kanban-board" id="kanban-board">
      ${STATUSES.map(s => renderColumn(s, [])).join('')}
    </div>
  `;

  document.getElementById('kanban-new-task-btn')?.addEventListener('click', () =>
    openTaskModal({ onSave: () => {} })
  );

  document.getElementById('kanban-proj-filter')?.addEventListener('change', (e) => {
    renderCards(allTasks, e.target.value);
  });

  _subscribeToTasks();
}

function _subscribeToTasks() {
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribeToTasks((tasks) => {
    allTasks = tasks;
    const projFilter = document.getElementById('kanban-proj-filter')?.value || '';
    renderCards(tasks, projFilter);
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
      ${store.isManager() ? `
        <button class="kanban-add-btn" data-add-status="${status.value}">
          + Adicionar tarefa
        </button>
      ` : ''}
    </div>
  `;
}

function renderCards(tasks, projectFilter = '') {
  STATUSES.forEach(s => {
    const body  = document.getElementById(`col-body-${s.value}`);
    const count = document.getElementById(`col-count-${s.value}`);
    if (!body) return;

    let colTasks = tasks.filter(t => t.status === s.value);
    if (projectFilter) colTasks = colTasks.filter(t => t.projectId === projectFilter);

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

function renderKanbanCard(task) {
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

export function destroyKanban() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}
