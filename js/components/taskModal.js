/**
 * PRIMETOUR — Task Modal
 * Modal completo de criação/edição de tarefa
 */

import { modal }  from './modal.js';
import { toast }  from './toast.js';
import { store }  from '../store.js';
import {
  createTask, updateTask, deleteTask,
  addSubtask, toggleSubtask, addComment,
  STATUSES, PRIORITIES, STATUS_MAP, PRIORITY_MAP,
} from '../services/tasks.js';
import { fetchProjects } from '../services/projects.js';

/* ─── Helpers ─────────────────────────────────────────────── */
const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function fmtDate(ts) {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);
}

function toInputDate(ts) {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toISOString().slice(0, 16);
}

function getInitials(name) {
  return (name||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
}

/* ─── Open Task Modal ─────────────────────────────────────── */
export async function openTaskModal({
  taskData   = null,    // null = modo criação
  projectId  = null,   // pré-selecionar projeto
  status     = 'todo', // pré-selecionar status
  onSave     = null,   // callback após salvar
} = {}) {
  const isEdit   = !!taskData;
  const users    = store.get('users') || [];
  const projects = await fetchProjects().catch(() => []);
  const currentUser = store.get('currentUser');

  // Estado mutável do modal
  let task = isEdit ? { ...taskData } : {
    title: '', description: '', status, priority: 'medium',
    projectId: projectId || null, assignees: [], tags: [],
    startDate: null, dueDate: null, subtasks: [], comments: [],
  };

  let currentTags = [...(task.tags || [])];
  let currentAssignees = [...(task.assignees || [])];

  const content = buildModalHTML(task, users, projects, currentTags, currentAssignees, isEdit);

  const m = modal.open({
    title: isEdit ? 'Detalhes da Tarefa' : 'Nova Tarefa',
    size: 'xl',
    content,
    footer: [
      ...(isEdit && store.isManager() ? [{
        label: '🗑 Excluir',
        class: 'btn-danger btn-sm',
        closeOnClick: false,
        onClick: async (_, { close }) => {
          const confirmed = await modal.confirm({
            title: 'Excluir tarefa',
            message: `Excluir permanentemente "<strong>${esc(task.title)}</strong>"?`,
            confirmText: 'Excluir', danger: true, icon: '🗑️',
          });
          if (confirmed) {
            try {
              await deleteTask(task.id);
              toast.success('Tarefa excluída.');
              close();
              onSave?.();
            } catch (e) { toast.error(e.message); }
          }
        },
      }] : []),
      { label: 'Cancelar', class: 'btn-secondary', closeOnClick: true },
      {
        label: isEdit ? 'Salvar alterações' : 'Criar tarefa',
        class: 'btn-primary',
        closeOnClick: false,
        onClick: async (_, { close }) => {
          await handleSave(task, currentTags, currentAssignees, isEdit, close, onSave);
        },
      },
    ],
    onClose: () => {},
  });

  // Bind events after render
  setTimeout(() => bindModalEvents(task, users, projects, currentTags, currentAssignees, isEdit, m), 60);
}

/* ─── Build HTML ──────────────────────────────────────────── */
function buildModalHTML(task, users, projects, tags, assignees, isEdit) {
  const statusOptions  = STATUSES.map(s =>
    `<option value="${s.value}" ${task.status===s.value?'selected':''}>${s.label}</option>`
  ).join('');
  const priorityOptions = PRIORITIES.map(p =>
    `<option value="${p.value}" ${task.priority===p.value?'selected':''}>${p.icon} ${p.label}</option>`
  ).join('');
  const projectOptions = [
    '<option value="">— Sem projeto —</option>',
    ...projects.map(p =>
      `<option value="${p.id}" ${task.projectId===p.id?'selected':''}>${esc(p.icon)} ${esc(p.name)}</option>`
    )
  ].join('');

  const tagsHTML = tags.map(t => renderTagChip(t)).join('');
  const assigneesHTML = assignees.map(uid => {
    const u = users.find(u=>u.id===uid);
    if (!u) return '';
    return `<div class="assignee-chip" data-uid="${uid}">
      <div class="avatar" style="background:${u.avatarColor||'#3B82F6'};width:20px;height:20px;font-size:0.5rem;">
        ${getInitials(u.name)}
      </div>
      ${esc(u.name.split(' ')[0])}
      <span style="font-size:0.7rem;opacity:0.6;">✕</span>
    </div>`;
  }).join('');

  const subtasksHTML = isEdit ? renderSubtasks(task.subtasks||[]) : '';
  const commentsHTML = isEdit ? renderComments(task.comments||[]) : '';

  return `
    <div class="task-modal-grid">
      <!-- ─── Main ─── -->
      <div class="task-modal-main">
        <input type="text" id="tm-title" class="task-modal-title-input"
          placeholder="Título da tarefa..." value="${esc(task.title)}" maxlength="200" />
        <span class="form-error-msg" id="tm-title-error"></span>

        <div class="form-group mt-4">
          <label class="form-label">Descrição</label>
          <textarea id="tm-desc" class="form-textarea" rows="3"
            placeholder="Descreva a tarefa, critérios de aceitação, links..."
          >${esc(task.description)}</textarea>
        </div>

        ${isEdit ? `
          <!-- Subtarefas -->
          <div class="task-detail-field">
            <div class="task-detail-label">
              Subtarefas
              <span class="subtask-progress" id="subtask-progress">${getSubtaskProgress(task.subtasks||[])}</span>
            </div>
            <div class="subtask-list" id="subtask-list">${subtasksHTML}</div>
            <div class="quick-add-bar" id="subtask-add-bar">
              <span style="color:var(--text-muted);font-size:1rem;">+</span>
              <input type="text" class="quick-add-input" id="subtask-input"
                placeholder="Adicionar subtarefa... (Enter para confirmar)" maxlength="200" />
            </div>
          </div>

          <!-- Comentários -->
          <div class="task-detail-field mt-6">
            <div class="task-detail-label">Comentários</div>
            <div class="comment-list" id="comment-list">${commentsHTML}</div>
            <div class="comment-input-area">
              <div class="avatar avatar-sm"
                style="background:${store.get('userProfile')?.avatarColor||'#3B82F6'}; flex-shrink:0;">
                ${getInitials(store.get('userProfile')?.name||'')}
              </div>
              <textarea id="comment-input" class="comment-input" rows="1"
                placeholder="Escreva um comentário... (Ctrl+Enter para enviar)"></textarea>
              <button class="btn btn-primary btn-sm" id="comment-send-btn">Enviar</button>
            </div>
          </div>
        ` : ''}
      </div>

      <!-- ─── Sidebar ─── -->
      <div class="task-modal-sidebar">

        <div class="task-detail-field">
          <div class="task-detail-label">Status</div>
          <select class="form-select" id="tm-status" style="padding:8px 32px 8px 12px;">
            ${statusOptions}
          </select>
        </div>

        <div class="task-detail-field">
          <div class="task-detail-label">Prioridade</div>
          <select class="form-select" id="tm-priority" style="padding:8px 32px 8px 12px;">
            ${priorityOptions}
          </select>
        </div>

        <div class="task-detail-field">
          <div class="task-detail-label">Projeto</div>
          <select class="form-select" id="tm-project" style="padding:8px 32px 8px 12px;">
            ${projectOptions}
          </select>
        </div>

        <div class="task-detail-field">
          <div class="task-detail-label">Responsáveis</div>
          <div class="assignee-picker" id="assignee-picker">
            ${assigneesHTML}
            <button class="assignee-add-btn" id="assignee-add-btn" title="Adicionar responsável">+</button>
          </div>
          <div id="assignee-dropdown" style="display:none; position:relative; margin-top:6px;">
            <div style="background:var(--bg-elevated);border:1px solid var(--border-default);border-radius:var(--radius-md);max-height:160px;overflow-y:auto;">
              ${users.filter(u=>u.active).map(u=>`
                <div class="dropdown-item" data-add-uid="${u.id}">
                  <div class="avatar avatar-sm" style="background:${u.avatarColor||'#3B82F6'};">
                    ${getInitials(u.name)}
                  </div>
                  ${esc(u.name)}
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="task-detail-field">
          <div class="task-detail-label">Data de início</div>
          <input type="datetime-local" class="form-input" id="tm-start"
            style="padding:8px 12px;" value="${toInputDate(task.startDate)}" />
        </div>

        <div class="task-detail-field">
          <div class="task-detail-label">Prazo</div>
          <input type="datetime-local" class="form-input" id="tm-due"
            style="padding:8px 12px;" value="${toInputDate(task.dueDate)}" />
        </div>

        <div class="task-detail-field">
          <div class="task-detail-label">Tags</div>
          <div class="tag-input-area" id="tag-input-area">
            <div id="tag-chips">${tagsHTML}</div>
            <input type="text" class="tag-input-field" id="tag-input"
              placeholder="Tag + Enter..." maxlength="30" />
          </div>
        </div>

        <div class="task-detail-field">
          <div class="task-detail-label">E-mail do cliente <span style="font-size:0.625rem; color:var(--text-muted); font-weight:400;">(para CSAT)</span></div>
          <input type="email" class="form-input" id="tm-client-email"
            style="padding:8px 12px;" value="${esc(task.clientEmail||'')}"
            placeholder="cliente@empresa.com" />
        </div>

        ${isEdit ? `
          <div class="task-detail-field">
            <div class="task-detail-label">Criada em</div>
            <div class="task-detail-value">${fmtDate(task.createdAt)}</div>
          </div>
          ${task.completedAt ? `
            <div class="task-detail-field">
              <div class="task-detail-label">Concluída em</div>
              <div class="task-detail-value" style="color:var(--color-success);">
                ${fmtDate(task.completedAt)}
              </div>
            </div>
          ` : ''}
        ` : ''}
      </div>
    </div>
  `;
}

/* ─── Bind events ─────────────────────────────────────────── */
function bindModalEvents(task, users, projects, currentTags, currentAssignees, isEdit, m) {
  // Tag input
  const tagInput = document.getElementById('tag-input');
  tagInput?.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',') && tagInput.value.trim()) {
      e.preventDefault();
      const tag = tagInput.value.trim().replace(/,/g,'').slice(0,30);
      if (tag && !currentTags.includes(tag)) {
        currentTags.push(tag);
        const chipsEl = document.getElementById('tag-chips');
        if (chipsEl) chipsEl.insertAdjacentHTML('beforeend', renderTagChip(tag));
      }
      tagInput.value = '';
    }
    if (e.key === 'Backspace' && !tagInput.value && currentTags.length) {
      const removed = currentTags.pop();
      const chipsEl = document.getElementById('tag-chips');
      chipsEl?.querySelector(`[data-tag="${removed}"]`)?.remove();
    }
  });

  // Tag remove
  document.getElementById('tag-input-area')?.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.tag-chip-remove');
    if (removeBtn) {
      const chip = removeBtn.closest('.tag-chip');
      const tag  = chip?.dataset.tag;
      if (tag) {
        currentTags.splice(currentTags.indexOf(tag), 1);
        chip.remove();
      }
    }
  });

  // Assignee add toggle
  document.getElementById('assignee-add-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = document.getElementById('assignee-dropdown');
    if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
  });

  // Add assignee
  document.getElementById('assignee-dropdown')?.addEventListener('click', (e) => {
    const item = e.target.closest('[data-add-uid]');
    if (!item) return;
    const uid = item.dataset.addUid;
    if (!currentAssignees.includes(uid)) {
      currentAssignees.push(uid);
      const u = (store.get('users')||[]).find(u=>u.id===uid);
      if (u) {
        const picker = document.getElementById('assignee-picker');
        const addBtn = document.getElementById('assignee-add-btn');
        picker?.insertBefore(createAssigneeChip(u), addBtn);
      }
    }
    document.getElementById('assignee-dropdown').style.display = 'none';
  });

  // Remove assignee
  document.getElementById('assignee-picker')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.assignee-chip[data-uid]');
    if (chip) {
      const uid = chip.dataset.uid;
      const idx = currentAssignees.indexOf(uid);
      if (idx > -1) currentAssignees.splice(idx, 1);
      chip.remove();
    }
  });

  // Close dropdown on outside click
  document.addEventListener('click', () => {
    const dd = document.getElementById('assignee-dropdown');
    if (dd) dd.style.display = 'none';
  });

  if (!isEdit) return;

  // Subtask input
  document.getElementById('subtask-input')?.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();
      if (!val) return;
      e.preventDefault();
      try {
        const sub = await addSubtask(task.id, val);
        task.subtasks = [...(task.subtasks||[]), sub];
        e.target.value = '';
        const list = document.getElementById('subtask-list');
        if (list) list.insertAdjacentHTML('beforeend', renderSubtaskItem(sub));
        updateSubtaskProgress(task.subtasks);
      } catch(err) { toast.error(err.message); }
    }
  });

  // Toggle subtask
  document.getElementById('subtask-list')?.addEventListener('click', async (e) => {
    const check = e.target.closest('.task-check[data-sub-id]');
    if (!check) return;
    const subId = check.dataset.subId;
    try {
      task.subtasks = await toggleSubtask(task.id, subId, task.subtasks);
      const sub = task.subtasks.find(s=>s.id===subId);
      const row = check.closest('.subtask-item');
      if (sub?.done) {
        check.classList.add('checked');
        check.textContent = '✓';
        row?.classList.add('done');
      } else {
        check.classList.remove('checked');
        check.textContent = '';
        row?.classList.remove('done');
      }
      updateSubtaskProgress(task.subtasks);
    } catch(err) { toast.error(err.message); }
  });

  // Comment send
  const sendComment = async () => {
    const input = document.getElementById('comment-input');
    const text  = input?.value?.trim();
    if (!text) return;
    try {
      const cmt = await addComment(task.id, text);
      task.comments = [...(task.comments||[]), cmt];
      input.value = '';
      const list = document.getElementById('comment-list');
      if (list) list.insertAdjacentHTML('beforeend', renderCommentItem(cmt));
      list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
    } catch(err) { toast.error(err.message); }
  };

  document.getElementById('comment-send-btn')?.addEventListener('click', sendComment);
  document.getElementById('comment-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) sendComment();
  });
}

/* ─── Save ────────────────────────────────────────────────── */
async function handleSave(task, tags, assignees, isEdit, close, onSave) {
  const title   = document.getElementById('tm-title')?.value?.trim();
  const errEl   = document.getElementById('tm-title-error');
  if (!title) { if(errEl) errEl.textContent='Título é obrigatório.'; return; }
  if(errEl) errEl.textContent='';

  const data = {
    title,
    description: document.getElementById('tm-desc')?.value?.trim() || '',
    status:      document.getElementById('tm-status')?.value || 'todo',
    priority:    document.getElementById('tm-priority')?.value || 'medium',
    projectId:   document.getElementById('tm-project')?.value || null,
    assignees,
    tags,
    startDate:   document.getElementById('tm-start')?.value
                 ? new Date(document.getElementById('tm-start').value) : null,
    dueDate:     document.getElementById('tm-due')?.value
                 ? new Date(document.getElementById('tm-due').value) : null,
  };

  const submitBtn = document.querySelector('.modal-footer .btn-primary');
  if(submitBtn){ submitBtn.classList.add('loading'); submitBtn.disabled=true; }

  try {
    if (isEdit) {
      data._prevStatus = task.status;
      await updateTask(task.id, data);
      toast.success('Tarefa atualizada!');
    } else {
      await createTask(data);
      toast.success('Tarefa criada!');
    }
    close();
    onSave?.();
  } catch(err) {
    toast.error(err.message);
  } finally {
    if(submitBtn){ submitBtn.classList.remove('loading'); submitBtn.disabled=false; }
  }
}

/* ─── Sub-renders ─────────────────────────────────────────── */
function renderTagChip(tag) {
  const hue = [...tag].reduce((a,c)=>a+c.charCodeAt(0),0) % 360;
  return `<div class="tag-chip" data-tag="${esc(tag)}"
    style="background:hsl(${hue},40%,25%);color:hsl(${hue},70%,75%);border:1px solid hsl(${hue},40%,35%);">
    ${esc(tag)}
    <button class="tag-chip-remove">✕</button>
  </div>`;
}

function renderSubtasks(subtasks) {
  return subtasks.map(s => renderSubtaskItem(s)).join('');
}

function renderSubtaskItem(s) {
  return `<div class="subtask-item ${s.done?'done':''}" data-sub="${s.id}">
    <div class="task-check ${s.done?'checked':''}" data-sub-id="${s.id}">${s.done?'✓':''}</div>
    <span class="subtask-label">${esc(s.title)}</span>
  </div>`;
}

function getSubtaskProgress(subtasks) {
  if (!subtasks?.length) return '';
  const done = subtasks.filter(s=>s.done).length;
  return `${done}/${subtasks.length}`;
}

function updateSubtaskProgress(subtasks) {
  const el = document.getElementById('subtask-progress');
  if (el) el.textContent = getSubtaskProgress(subtasks);
}

function renderComments(comments) {
  return comments.map(c => renderCommentItem(c)).join('');
}

function renderCommentItem(c) {
  const initials = getInitials(c.authorName);
  const time = c.createdAt ? new Intl.DateTimeFormat('pt-BR',{
    day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'
  }).format(new Date(c.createdAt)) : '';
  return `<div class="comment-item">
    <div class="avatar avatar-sm" style="background:${c.authorColor||'#3B82F6'};">${initials}</div>
    <div class="comment-bubble">
      <div class="comment-header">
        <span class="comment-author">${esc(c.authorName)}</span>
        <span class="comment-time">${time}</span>
      </div>
      <p class="comment-text">${esc(c.text)}</p>
    </div>
  </div>`;
}

function createAssigneeChip(u) {
  const el = document.createElement('div');
  el.className = 'assignee-chip';
  el.dataset.uid = u.id;
  el.innerHTML = `<div class="avatar" style="background:${u.avatarColor||'#3B82F6'};width:20px;height:20px;font-size:0.5rem;">
    ${getInitials(u.name)}</div>${esc(u.name.split(' ')[0])}<span style="font-size:0.7rem;opacity:0.6;">✕</span>`;
  return el;
}
