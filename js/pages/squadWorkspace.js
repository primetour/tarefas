/**
 * PRIMETOUR — Squad Workspace
 * Página única do squad: header + projetos (acordeão expansível) + tarefas avulsas.
 * Hierarquia: Squad → Projetos → Tarefas (e tarefas avulsas vivem direto no squad).
 */

import { store }  from '../store.js';
import { router } from '../router.js';
import { toast }  from '../components/toast.js';
import { fetchProjects, PROJECT_STATUS_MAP, projectIncludesSquad } from '../services/projects.js';
import {
  fetchTasks, toggleTaskComplete, getTask,
  STATUS_MAP, PRIORITY_MAP,
} from '../services/tasks.js';
import { openTaskModal, openTaskDoneOverlay } from '../components/taskModal.js';
import { openProjectModal } from './projects.js';
import { addMember, removeMember, toggleWorkspaceAdmin, getWorkspace } from '../services/workspaces.js';
import { modal } from '../components/modal.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let squadId = '';
let squad   = null;
let allProjects = [];
let allTasks    = [];
const expanded  = new Set();   // ids de projetos expandidos

/* ─── Entry ──────────────────────────────────────────────── */
export async function renderSquadWorkspace(container) {
  squadId = parseSquadIdFromHash();
  if (!squadId) {
    container.innerHTML = renderEmpty('Nenhum squad selecionado.', 'Volte para a lista de squads e clique em um para abrir.');
    container.querySelector('.btn-primary')?.addEventListener('click', () => router.navigate('workspaces'));
    return;
  }

  const userWorkspaces = store.get('userWorkspaces') || [];
  squad = userWorkspaces.find(w => w.id === squadId);
  if (!squad) {
    container.innerHTML = renderEmpty(
      'Squad não encontrado',
      'Esse squad não existe ou você não faz parte dele.'
    );
    return;
  }

  container.innerHTML = `
    <div id="sw-page">
      <div id="sw-header"></div>
      <div id="sw-projects-section" style="margin-top:24px;"></div>
      <div id="sw-orphans-section"  style="margin-top:32px;"></div>
    </div>
  `;

  // Loading state
  document.getElementById('sw-header').innerHTML = renderHeader(squad, 0, 0);
  document.getElementById('sw-projects-section').innerHTML = renderLoading();

  await loadData();
  renderAll();
}

/* ─── Hash parse ─────────────────────────────────────────── */
function parseSquadIdFromHash() {
  try {
    const rawHash = window.location.hash || '';
    const qIdx = rawHash.indexOf('?');
    if (qIdx < 0) return '';
    const qs = new URLSearchParams(rawHash.slice(qIdx + 1));
    return qs.get('id') || '';
  } catch (_) { return ''; }
}

/* ─── Data ───────────────────────────────────────────────── */
async function loadData() {
  try {
    const [projs, tasks] = await Promise.all([fetchProjects(), fetchTasks()]);
    allProjects = projs.filter(p => projectIncludesSquad(p, squadId));
    allTasks    = tasks.filter(t => t.workspaceId === squadId);
  } catch (e) {
    console.error('[squadWorkspace] loadData', e);
    toast.error('Erro ao carregar dados do squad.');
  }
}

async function reload() {
  await loadData();
  renderAll();
}

/* ─── Render ─────────────────────────────────────────────── */
function renderAll() {
  const header   = document.getElementById('sw-header');
  const projsEl  = document.getElementById('sw-projects-section');
  const orphsEl  = document.getElementById('sw-orphans-section');
  if (!header || !projsEl || !orphsEl) return;

  header.innerHTML = renderHeader(squad, allProjects.length, allTasks.length);
  projsEl.innerHTML = renderProjectsSection();
  orphsEl.innerHTML = renderOrphansSection();

  attachEvents();
}

function renderHeader(ws, projCount, taskCount) {
  const color = ws.color || '#D4A843';
  const users = store.get('users') || [];
  const members = (ws.members || []).slice(0, 6).map(uid => {
    const u = users.find(u => u.id === uid);
    if (!u) return '';
    return `<div class="avatar avatar-sm" title="${esc(u.name)}"
      style="background:${u.avatarColor||'#3B82F6'}; margin-left:-6px; border:2px solid var(--bg-card);">
      ${(u.name||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()}
    </div>`;
  }).join('');
  const extraMembers = (ws.members || []).length > 6
    ? `<div class="avatar avatar-sm" style="background:var(--bg-elevated);color:var(--text-muted);margin-left:-6px;border:2px solid var(--bg-card);font-size:0.625rem;">+${(ws.members||[]).length-6}</div>`
    : '';

  const canEdit = store.can('workspace_edit') || store.isMaster();

  return `
    <div class="card" style="padding:24px;border-left:4px solid ${color};">
      <div style="display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;">
        <div style="
          width:72px;height:72px;border-radius:var(--radius-md);
          background:${color}22;border:2px solid ${color}55;
          display:flex;align-items:center;justify-content:center;
          font-size:2.25rem;flex-shrink:0;">
          ${esc(ws.icon || '◈')}
        </div>
        <div style="flex:1;min-width:240px;">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">
            <h1 class="page-title" style="margin:0;">${esc(ws.name)}</h1>
            ${ws.multiSector ? `<span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}44;">⇌ Multissetor</span>` : ''}
          </div>
          ${ws.description ? `<p class="page-subtitle" style="margin:0 0 10px 0;">${esc(ws.description)}</p>` : ''}
          <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center;font-size:0.8125rem;color:var(--text-muted);">
            <span><strong style="color:var(--text-primary);">${projCount}</strong> projeto${projCount!==1?'s':''}</span>
            <span><strong style="color:var(--text-primary);">${taskCount}</strong> tarefa${taskCount!==1?'s':''}</span>
            <span style="display:flex;align-items:center;gap:4px;">
              <span>👥</span>
              <strong style="color:var(--text-primary);">${(ws.members||[]).length}</strong> membro${(ws.members||[]).length!==1?'s':''}
            </span>
            ${members ? `<div style="display:flex;align-items:center;margin-left:6px;">${members}${extraMembers}</div>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
          <button class="btn btn-secondary btn-sm" id="sw-back-btn" title="Voltar para Squads">← Squads</button>
          ${store.can('workspace_create') ? `<button class="btn btn-primary btn-sm" id="sw-new-squad-btn" title="Criar novo squad">+ Novo Squad</button>` : ''}
          ${canEdit ? `<button class="btn btn-ghost btn-sm" id="sw-invite-btn" title="Convidar membros" style="color:var(--brand-gold);">+ Convidar</button>` : ''}
          ${canEdit ? `<button class="btn btn-ghost btn-sm" id="sw-members-btn" title="Gerenciar membros">👥 Membros</button>` : ''}
          ${canEdit ? `<button class="btn btn-ghost btn-sm" id="sw-edit-btn" title="Editar squad">⚙ Editar</button>` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderProjectsSection() {
  const canCreate = store.can('project_create');

  if (allProjects.length === 0) {
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <h2 style="font-size:1rem;font-weight:600;color:var(--text-primary);margin:0;">
          ▸ Projetos do squad
          <span style="font-weight:400;color:var(--text-muted);font-size:0.8125rem;margin-left:6px;">(0)</span>
        </h2>
        ${canCreate ? `<button class="btn btn-primary btn-sm" id="sw-new-project-btn">+ Novo projeto</button>` : ''}
      </div>
      <div class="task-empty" style="padding:32px 16px;">
        <div class="task-empty-icon">📦</div>
        <div class="task-empty-title">Este squad ainda não tem projetos.</div>
        <p class="text-sm text-muted mt-2">
          ${canCreate ? 'Crie um projeto para organizar tarefas relacionadas dentro do squad.' : 'Nenhum projeto criado neste squad ainda.'}
        </p>
        ${canCreate ? '<button class="btn btn-primary mt-4" id="sw-empty-new-project-btn">+ Criar primeiro projeto</button>' : ''}
      </div>
    `;
  }

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <h2 style="font-size:1rem;font-weight:600;color:var(--text-primary);margin:0;">
        ▸ Projetos do squad
        <span style="font-weight:400;color:var(--text-muted);font-size:0.8125rem;margin-left:6px;">(${allProjects.length})</span>
      </h2>
      ${canCreate ? `<button class="btn btn-primary btn-sm" id="sw-new-project-btn">+ Novo projeto</button>` : ''}
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${allProjects.map(renderProjectAccordion).join('')}
    </div>
  `;
}

function renderProjectAccordion(project) {
  const isOpen     = expanded.has(project.id);
  const projTasks  = allTasks.filter(t => t.projectId === project.id);
  const done       = projTasks.filter(t => t.status === 'done').length;
  const total      = projTasks.length;
  const pct        = total ? Math.round((done / total) * 100) : 0;
  const status     = PROJECT_STATUS_MAP[project.status] || { label: project.status, color: '#6B7280' };
  const color      = project.color || '#D4A843';

  return `
    <div class="card sw-project-accordion" data-project-id="${project.id}"
      style="overflow:hidden;border-left:3px solid ${color};">
      <div class="sw-proj-header" data-project-id="${project.id}"
        style="display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;
          background:${isOpen ? color+'08' : 'transparent'};
          transition:background 0.15s;">
        <span class="sw-proj-chevron" style="
          font-size:0.75rem;color:var(--text-muted);width:14px;display:inline-block;
          transform:rotate(${isOpen ? '90deg' : '0deg'});transition:transform 0.15s;">▶</span>
        <div style="
          width:38px;height:38px;border-radius:var(--radius-sm);
          background:${color}18;border:1px solid ${color}33;
          display:flex;align-items:center;justify-content:center;font-size:1.25rem;flex-shrink:0;">
          ${esc(project.icon || '📦')}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;color:var(--text-primary);font-size:0.9375rem;
            overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${esc(project.name)}
          </div>
          ${project.description ? `<div style="font-size:0.75rem;color:var(--text-muted);
            overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${esc(project.description)}
          </div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:14px;flex-shrink:0;">
          <span class="badge" style="background:${status.color}18;color:${status.color};
            border:1px solid ${status.color}30;font-size:0.6875rem;">${esc(status.label)}</span>
          <div style="display:flex;align-items:center;gap:6px;font-size:0.75rem;color:var(--text-muted);">
            <span><strong style="color:var(--text-primary);">${total}</strong> tarefa${total!==1?'s':''}</span>
            <span style="width:60px;height:5px;background:var(--bg-elevated);border-radius:3px;overflow:hidden;display:inline-block;">
              <span style="display:block;height:100%;width:${pct}%;background:${pct===100?'var(--color-success)':color};"></span>
            </span>
            <span style="color:var(--text-primary);font-weight:600;">${pct}%</span>
          </div>
        </div>
      </div>
      ${isOpen ? `
        <div class="sw-proj-body" style="border-top:1px solid var(--border-subtle);padding:12px 16px;background:var(--bg-surface);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <span style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">
              Tarefas do projeto (${total})
            </span>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-ghost btn-sm sw-view-all-btn" data-project-id="${project.id}"
                title="Abrir lista completa de tarefas filtrada por este projeto"
                style="font-size:0.75rem;padding:4px 10px;">Ver todas →</button>
              ${store.can('task_create') ? `
                <button class="btn btn-primary btn-sm sw-add-task-btn" data-project-id="${project.id}"
                  style="font-size:0.75rem;padding:4px 10px;">+ Tarefa</button>
              ` : ''}
            </div>
          </div>
          ${projTasks.length === 0
            ? `<div style="text-align:center;padding:18px;color:var(--text-muted);font-size:0.8125rem;">
                Nenhuma tarefa neste projeto ainda.
              </div>`
            : `<div style="display:flex;flex-direction:column;gap:6px;">
                ${projTasks.slice(0, 30).map(renderCompactTaskRow).join('')}
                ${projTasks.length > 30
                  ? `<div style="text-align:center;padding:8px;font-size:0.75rem;color:var(--text-muted);">
                      … e mais ${projTasks.length - 30}. Clique em "Ver todas" para abrir a lista completa.
                    </div>`
                  : ''}
              </div>`
          }
        </div>
      ` : ''}
    </div>
  `;
}

function renderOrphansSection() {
  const orphans = allTasks.filter(t => !t.projectId);
  const canCreate = store.can('task_create');

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <h2 style="font-size:1rem;font-weight:600;color:var(--text-primary);margin:0;">
        ▸ Tarefas avulsas do squad
        <span style="font-weight:400;color:var(--text-muted);font-size:0.8125rem;margin-left:6px;">
          (${orphans.length}) — sem projeto
        </span>
      </h2>
      ${canCreate ? `<button class="btn btn-secondary btn-sm" id="sw-new-orphan-btn">+ Nova tarefa avulsa</button>` : ''}
    </div>
    ${orphans.length === 0
      ? `<div class="task-empty" style="padding:24px 16px;">
          <div class="task-empty-icon">∅</div>
          <div class="task-empty-title">Nenhuma tarefa avulsa neste squad.</div>
          <p class="text-sm text-muted mt-2">
            Tarefas avulsas são aquelas que vivem direto no squad, sem pertencer a um projeto específico.
          </p>
        </div>`
      : `<div class="card" style="padding:12px 16px;">
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${orphans.map(renderCompactTaskRow).join('')}
          </div>
        </div>`
    }
  `;
}

function renderCompactTaskRow(task) {
  const isDone = task.status === 'done';
  const status = STATUS_MAP[task.status]   || { label: task.status, color: '#6B7280' };
  const prio   = PRIORITY_MAP[task.priority] || { label: task.priority, color: '#6B7280' };
  const users  = store.get('users') || [];
  const assigneesArr = Array.isArray(task.assignees) ? task.assignees : [];
  const assignees = assigneesArr.slice(0,3).map(uid => {
    const u = users.find(u=>u.id===uid);
    if (!u) return '';
    return `<div class="avatar avatar-sm" title="${esc(u.name)}"
      style="background:${u.avatarColor||'#3B82F6'};margin-left:-6px;border:2px solid var(--bg-card);width:22px;height:22px;font-size:0.55rem;">
      ${(u.name||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()}
    </div>`;
  }).join('');

  const dueText = task.dueDate ? formatDue(task.dueDate) : '';
  const dueClass = task.dueDate ? getDueClass(task.dueDate, isDone) : '';
  const canComplete = store.can('task_complete');

  return `
    <div class="sw-task-row ${isDone?'done':''}" data-task-id="${task.id}"
      style="display:grid;grid-template-columns:24px 1fr auto auto auto;gap:12px;align-items:center;
        padding:8px 10px;border-radius:var(--radius-sm);
        background:var(--bg-card);border:1px solid var(--border-subtle);
        cursor:pointer;transition:background 0.12s;
        ${isDone ? 'opacity:0.65;' : ''}">
      <div class="sw-task-check ${isDone?'checked':''} ${!canComplete && !isDone ? 'disabled' : ''}"
        data-check-id="${task.id}"
        style="width:18px;height:18px;border-radius:50%;border:2px solid ${isDone?'var(--color-success)':'var(--border-default)'};
          background:${isDone?'var(--color-success)':'transparent'};
          display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.625rem;
          cursor:${!canComplete && !isDone ? 'not-allowed' : 'pointer'};">
        ${isDone ? '✓' : ''}
      </div>
      <div style="min-width:0;">
        <div style="font-size:0.875rem;color:var(--text-primary);
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
          ${isDone ? 'text-decoration:line-through;' : ''}">
          ${esc(task.title)}
        </div>
        ${(task.tags||[]).length || prio.label ? `
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:2px;align-items:center;">
            <span class="badge badge-priority-${task.priority}" style="font-size:0.6rem;">${esc(prio.label)}</span>
            ${(task.tags||[]).slice(0,2).map(t=>`<span style="font-size:0.65rem;color:var(--text-muted);">#${esc(t)}</span>`).join('')}
          </div>` : ''}
      </div>
      <span class="badge badge-status-${task.status}" style="font-size:0.6875rem;">${esc(status.label)}</span>
      <span class="kanban-card-due ${dueClass}" style="font-size:0.75rem;min-width:60px;text-align:right;">${dueText}</span>
      <div style="display:flex;align-items:center;">${assignees}</div>
    </div>
  `;
}

/* ─── Helpers de data ─────────────────────────────────────── */
function formatDue(dueDate) {
  if (!dueDate) return '';
  const d = dueDate?.toDate ? dueDate.toDate() : new Date(dueDate);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit'}).format(d);
}
function getDueClass(dueDate, isDone) {
  if (isDone || !dueDate) return '';
  const d = dueDate?.toDate ? dueDate.toDate() : new Date(dueDate);
  const today = new Date(); today.setHours(0,0,0,0);
  const dDay = new Date(d);  dDay.setHours(0,0,0,0);
  if (dDay < today) return 'overdue';
  if (dDay.getTime() === today.getTime()) return 'today';
  return '';
}

/* ─── Empty state ─────────────────────────────────────────── */
function renderEmpty(title, subtitle) {
  return `
    <div class="task-empty" style="padding:60px 20px;">
      <div class="task-empty-icon">◈</div>
      <div class="task-empty-title">${esc(title)}</div>
      <p class="text-sm text-muted mt-2">${esc(subtitle)}</p>
      <div style="margin-top:20px;">
        <a href="#workspaces" class="btn btn-primary">← Ver squads</a>
      </div>
    </div>
  `;
}
function renderLoading() {
  return `
    <div class="task-empty"><div class="task-empty-icon">⟳</div>
      <div class="task-empty-title">Carregando…</div></div>
  `;
}

/* ─── Eventos ─────────────────────────────────────────────── */
function attachEvents() {
  // Voltar / novo squad / editar squad / gerenciar membros
  document.getElementById('sw-back-btn')?.addEventListener('click', () => router.navigate('workspaces'));
  document.getElementById('sw-new-squad-btn')?.addEventListener('click', () => router.navigate('workspaces'));
  document.getElementById('sw-edit-btn')?.addEventListener('click', () => router.navigate('workspaces'));
  document.getElementById('sw-members-btn')?.addEventListener('click', () => openMembersModal());
  document.getElementById('sw-invite-btn')?.addEventListener('click', () => openSquadInviteModal());

  // Novo projeto neste squad
  const newProjBtn = document.getElementById('sw-new-project-btn');
  const newProjEmptyBtn = document.getElementById('sw-empty-new-project-btn');
  const handleNewProject = () => {
    openProjectModal(null, {
      defaultWorkspaceId: squadId,
      onSave: () => reload(),
    });
  };
  newProjBtn?.addEventListener('click', handleNewProject);
  newProjEmptyBtn?.addEventListener('click', handleNewProject);

  // Nova tarefa avulsa neste squad
  document.getElementById('sw-new-orphan-btn')?.addEventListener('click', () => {
    openTaskModal({
      taskData: { workspaceId: squadId, projectId: null },
      onSave: () => reload(),
    });
  });

  // Toggle de expansão de projeto
  document.querySelectorAll('.sw-proj-header').forEach(h => {
    h.addEventListener('click', (e) => {
      // Não togglear se clicou num botão interno
      if (e.target.closest('button')) return;
      const pid = h.dataset.projectId;
      if (expanded.has(pid)) expanded.delete(pid);
      else expanded.add(pid);
      // Re-render só a seção de projetos para preservar scroll
      const section = document.getElementById('sw-projects-section');
      if (section) {
        section.innerHTML = renderProjectsSection();
        attachEvents();
      }
    });
  });

  // "Ver todas" → tasks page filtrado por projeto + squad
  document.querySelectorAll('.sw-view-all-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pid = btn.dataset.projectId;
      router.navigate(`tasks?projectId=${encodeURIComponent(pid)}&workspaceId=${encodeURIComponent(squadId)}`);
    });
  });

  // "+ Tarefa" dentro de um projeto
  document.querySelectorAll('.sw-add-task-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pid = btn.dataset.projectId;
      openTaskModal({
        taskData: { workspaceId: squadId, projectId: pid },
        projectId: pid,
        onSave: () => reload(),
      });
    });
  });

  // Click em linha de tarefa → abre modal de edição
  document.querySelectorAll('.sw-task-row[data-task-id]').forEach(row => {
    row.addEventListener('click', async (e) => {
      if (e.target.closest('.sw-task-check')) return;
      const id = row.dataset.taskId;
      const task = allTasks.find(t => t.id === id);
      if (!task) return;
      openTaskModal({ taskData: task, onSave: () => reload() });
    });
  });

  // Click nos avatares de membros (atalho para gerenciar)
  document.querySelector('.sw-members-avatars')?.addEventListener('click', () => {
    if (store.can('workspace_edit') || store.isMaster()) openMembersModal();
  });

  // Toggle conclusão
  document.querySelectorAll('.sw-task-check[data-check-id]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (el.classList.contains('disabled')) return;
      const id = el.dataset.checkId;
      const task = allTasks.find(t => t.id === id);
      if (!task) return;
      const isDone = task.status !== 'done';
      try {
        await toggleTaskComplete(id, isDone);
        if (isDone) {
          const fresh = await getTask(id).catch(() => task);
          openTaskDoneOverlay(id, fresh);
        }
        await reload();
      } catch (err) { toast.error(err.message); }
    });
  });
}

/* ─── Carrega lista de usuários se ainda não estiver no store ─ */
async function ensureUsersLoaded() {
  let users = store.get('users');
  if (Array.isArray(users) && users.length) return users;
  try {
    const { collection, getDocs, query, orderBy } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const { db } = await import('../firebase.js');
    const snap = await getDocs(query(collection(db, 'users'), orderBy('name', 'asc')));
    users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    store.set('users', users);
    return users;
  } catch (e) {
    console.warn('[squadWorkspace] erro ao carregar users:', e.message);
    return [];
  }
}

/* ─── Modal: Gerenciar Membros do Squad ──────────────────── */
async function openMembersModal() {
  if (!squad) return;
  // Garante que a lista de usuários esteja carregada — sem isso o modal
  // mostrava UIDs no lugar dos nomes e o seletor "Adicionar membro" sumia.
  const users = await ensureUsersLoaded();
  const allUsers = users.filter(u => u.active !== false);
  const memberIds = squad.members || [];
  const currentUid = store.get('currentUser')?.uid;
  const isOwner = uid => uid === squad.createdBy;
  const isAdmin = uid => (squad.adminIds || []).includes(uid);
  const canManage = store.can('workspace_edit') || store.isMaster();

  const memberRows = memberIds.map(mid => {
    const u = allUsers.find(x => x.id === mid);
    // Membros "órfãos": estão em squad.members mas o doc users/<uid> não
    // existe mais (usuário removido, ou inserção manual com UID inválido).
    // Mostrar como "Usuário removido" + UID truncado, com botão para limpar.
    const isOrphan = !u;
    const name = u?.name || u?.displayName || (isOrphan ? 'Usuário removido' : mid);
    const subText = isOrphan
      ? `UID órfão: ${mid.slice(0, 12)}…`
      : (u?.email || '');
    const color = isOrphan ? '#9CA3AF' : (u?.avatarColor || '#3B82F6');
    const initials = isOrphan ? '?' : (name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    const ownerBadge = isOwner(mid)
      ? `<span style="font-size:0.6875rem;padding:2px 8px;border-radius:99px;background:rgba(212,168,67,0.12);color:var(--brand-gold);">Dono</span>`
      : isAdmin(mid)
        ? `<span style="font-size:0.6875rem;padding:2px 8px;border-radius:99px;background:rgba(56,189,248,0.12);color:#38BDF8;">Admin</span>`
        : '';
    const orphanBadge = isOrphan
      ? `<span style="font-size:0.6875rem;padding:2px 8px;border-radius:99px;background:rgba(239,68,68,0.12);color:#EF4444;">órfão</span>`
      : '';
    const actions = canManage && !isOwner(mid)
      ? `${!isOrphan ? `<button class="btn btn-ghost btn-icon btn-sm sw-toggle-admin" data-uid="${mid}" data-admin="${isAdmin(mid)}" title="${isAdmin(mid) ? 'Rebaixar' : 'Promover a admin'}">
           ${isAdmin(mid) ? '↓' : '↑'}
         </button>` : ''}
         <button class="btn btn-ghost btn-icon btn-sm sw-remove-member" data-uid="${mid}" title="${isOrphan ? 'Remover UID órfão' : 'Remover membro'}" style="color:var(--color-danger);">✕</button>`
      : '';
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-subtle);${isOrphan ? 'opacity:0.7;' : ''}">
        <div class="avatar avatar-sm" style="background:${color};">${initials}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.875rem;font-weight:500;color:var(--text-primary);">${esc(name)}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">${esc(subText)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          ${orphanBadge}
          ${ownerBadge}
          ${actions}
        </div>
      </div>`;
  }).join('');

  // Lista de usuários que NÃO são membros (para adicionar)
  const nonMembers = allUsers.filter(u => !memberIds.includes(u.id));
  const addSelect = canManage && nonMembers.length
    ? `<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border-subtle);">
         <label style="font-size:0.75rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:6px;">Adicionar membro</label>
         <div style="display:flex;gap:8px;">
           <select id="sw-add-member-select" class="form-select" style="flex:1;font-size:0.8125rem;">
             <option value="">Selecione um usuário...</option>
             ${nonMembers.map(u => `<option value="${u.id}">${esc(u.name || u.displayName || u.email)}</option>`).join('')}
           </select>
           <button class="btn btn-primary btn-sm" id="sw-add-member-btn">+ Adicionar</button>
         </div>
       </div>`
    : '';

  modal.open({
    title: `👥 Membros — ${esc(squad.name)}`,
    content: `
      <div style="max-height:360px;overflow-y:auto;">
        ${memberRows || '<p style="color:var(--text-muted);font-size:0.875rem;">Nenhum membro.</p>'}
      </div>
      ${addSelect}
    `,
    footer: [{ label: 'Fechar', class: 'btn-secondary', closeOnClick: true }],
  });

  // Bind eventos após render
  setTimeout(() => {
    // Adicionar membro
    document.getElementById('sw-add-member-btn')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      if (btn.dataset.busy === '1') return;
      const sel = document.getElementById('sw-add-member-select');
      const uid = sel?.value;
      if (!uid) return;
      btn.dataset.busy = '1';
      const prevText = btn.textContent;
      btn.classList.add('loading');
      btn.disabled = true;
      btn.textContent = 'Adicionando…';
      try {
        await addMember(squad.id, uid);
        toast.success('Membro adicionado.');
        document.querySelector('.modal-overlay')?.click();
        await reload();
      } catch (e) {
        toast.error(e.message);
        btn.classList.remove('loading');
        btn.disabled = false;
        btn.textContent = prevText;
        btn.dataset.busy = '0';
      }
    });

    // Remover membro
    document.querySelectorAll('.sw-remove-member').forEach(btn => {
      btn.addEventListener('click', async () => {
        const u = allUsers.find(x => x.id === btn.dataset.uid);
        const ok = await modal.confirm({
          title: 'Remover membro',
          message: `Remover <strong>${esc(u?.name || btn.dataset.uid)}</strong> deste squad?`,
          confirmText: 'Remover', danger: true, icon: '✕',
        });
        if (ok) {
          try {
            await removeMember(squad.id, btn.dataset.uid);
            toast.success('Membro removido.');
            document.querySelector('.modal-overlay')?.click();
            await reload();
          } catch (e) { toast.error(e.message); }
        }
      });
    });

    // Toggle admin
    document.querySelectorAll('.sw-toggle-admin').forEach(btn => {
      btn.addEventListener('click', async () => {
        const makeAdmin = btn.dataset.admin === 'false';
        try {
          await toggleWorkspaceAdmin(squad.id, btn.dataset.uid, makeAdmin);
          toast.success(makeAdmin ? 'Promovido a admin.' : 'Admin rebaixado.');
          document.querySelector('.modal-overlay')?.click();
          await reload();
        } catch (e) { toast.error(e.message); }
      });
    });
  }, 50);
}

/* ─── Modal: convidar membros (visual amigável) ──────────── */
async function openSquadInviteModal() {
  if (!squad) return;

  // Busca workspace fresco para ter members atualizado
  const freshWs = await getWorkspace(squad.id).catch(() => squad);
  const wsMembers = Array.isArray(freshWs?.members) ? freshWs.members : [];
  const wsSector = freshWs?.sector || '';
  const isMultiSector = freshWs?.multiSector === true;

  const users = await ensureUsersLoaded();
  const allUsers = users.filter(u => u.active !== false);
  const nonMembers = allUsers.filter(u => {
    if (wsMembers.includes(u.id)) return false;
    if (isMultiSector) return true;
    if (wsSector) {
      const uSector = u.sector || u.department;
      return !uSector || uSector === wsSector;
    }
    return true;
  });

  modal.open({
    title: `+ Convidar para — ${esc(squad.name)}`,
    size: 'sm',
    content: `
      <div style="margin-bottom:16px;">
        <p style="font-size:0.875rem;color:var(--text-secondary);margin-bottom:12px;line-height:1.5;">
          Selecione usuários para adicionar ao squad.
        </p>
        ${nonMembers.length ? `
          <div style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto;">
            ${nonMembers.map(u => {
              const initials = (u.name||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
              return `
                <div class="dropdown-item sw-add-invite" data-uid="${u.id}"
                  style="display:flex;align-items:center;gap:10px;padding:8px 10px;
                  border-radius:var(--radius-md);cursor:pointer;border:1px solid transparent;
                  transition:all 0.15s;">
                  <div class="avatar avatar-sm" style="background:${u.avatarColor||'#3B82F6'};flex-shrink:0;">
                    ${initials}
                  </div>
                  <div>
                    <div style="font-size:0.875rem;color:var(--text-primary);">${esc(u.name)}</div>
                    <div style="font-size:0.75rem;color:var(--text-muted);">${esc(u.department||u.role||'')}</div>
                  </div>
                  <span style="margin-left:auto;font-size:0.8125rem;color:var(--brand-gold);">+ Adicionar</span>
                </div>`;
            }).join('')}
          </div>
        ` : `
          <div class="empty-state" style="padding:24px;">
            <div class="empty-state-icon">◉</div>
            <div class="empty-state-title" style="font-size:0.875rem;">Todos os usuários já são membros</div>
          </div>
        `}
      </div>
    `,
    footer: [{ label: 'Fechar', class: 'btn-secondary', closeOnClick: true }],
  });

  setTimeout(() => {
    document.querySelectorAll('.sw-add-invite').forEach(item => {
      item.addEventListener('click', async () => {
        if (item.dataset.busy === '1') return;   // evita duplo-clique
        item.dataset.busy = '1';
        const uid = item.dataset.uid;
        const u = allUsers.find(x => x.id === uid);
        // feedback visual imediato
        const prevHtml = item.innerHTML;
        item.style.opacity = '0.6';
        item.style.pointerEvents = 'none';
        item.innerHTML = `<span class="spinner-inline"></span>
          <span style="margin-left:8px;color:var(--text-secondary);">Adicionando…</span>`;
        try {
          await addMember(squad.id, uid);
          toast.success(`${esc(u?.name)} adicionado ao squad!`);
          document.querySelector('.modal-overlay')?.click();
          await reload();
        } catch(e) {
          toast.error(e.message);
          item.innerHTML = prevHtml;
          item.style.opacity = '';
          item.style.pointerEvents = '';
          item.dataset.busy = '0';
        }
      });
    });
  }, 50);
}
