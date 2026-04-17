/**
 * PRIMETOUR — Projects Page
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import {
  fetchProjects, createProject, updateProject, deleteProject,
  archiveProject, unarchiveProject, fetchArchivedProjects, checkProjectDependencies,
  PROJECT_COLORS, PROJECT_ICONS, PROJECT_STATUSES, PROJECT_STATUS_MAP,
} from '../services/projects.js';
import { fetchTasks } from '../services/tasks.js';
import { openTaskModal } from '../components/taskModal.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let allProjects = [];
let allTasks    = [];
let searchTerm  = '';
let filterStatus = '';

export async function renderProjects(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Projetos</h1>
        <p class="page-subtitle" id="proj-count">Carregando...</p>
      </div>
      <div class="page-header-actions">
        ${store.can('project_create') ? `<button class="btn btn-primary" id="new-project-btn">+ Novo Projeto</button>` : ''}
      </div>
    </div>

    <div class="toolbar">
      <div class="toolbar-search">
        <span class="toolbar-search-icon">🔍</span>
        <input type="text" class="toolbar-search-input" id="proj-search" placeholder="Buscar projetos..." />
      </div>
      <select class="filter-select" id="proj-filter-status">
        <option value="">Todos os status</option>
        ${PROJECT_STATUSES.map(s=>`<option value="${s.value}">${s.label}</option>`).join('')}
      </select>
    </div>

    <div id="projects-content">
      <div class="task-empty"><div class="task-empty-icon">⟳</div><div class="task-empty-title">Carregando projetos...</div></div>
    </div>

    <!-- Projetos arquivados -->
    <div id="archived-projects-section" style="margin-top:32px;display:none;">
      <button id="toggle-archived-projects" style="display:flex;align-items:center;gap:8px;
        background:none;border:none;cursor:pointer;padding:8px 0;
        font-size:0.875rem;font-weight:600;color:var(--text-muted);">
        <span id="archived-proj-arrow" style="transition:transform 0.2s;">▸</span>
        Projetos Arquivados (<span id="archived-proj-count">0</span>)
      </button>
      <div id="archived-projects-grid" style="display:none;margin-top:12px;">
      </div>
    </div>
  `;

  document.getElementById('new-project-btn')?.addEventListener('click', () => openProjectModal());
  document.getElementById('toggle-archived-projects')?.addEventListener('click', () => {
    const grid  = document.getElementById('archived-projects-grid');
    const arrow = document.getElementById('archived-proj-arrow');
    if (!grid) return;
    const show = grid.style.display === 'none';
    grid.style.display = show ? 'block' : 'none';
    if (arrow) arrow.style.transform = show ? 'rotate(90deg)' : '';
  });

  let timer;
  document.getElementById('proj-search')?.addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { searchTerm = e.target.value; renderList(); }, 250);
  });
  document.getElementById('proj-filter-status')?.addEventListener('change', e => {
    filterStatus = e.target.value; renderList();
  });

  await loadData();
}

async function loadData() {
  try {
    [allProjects, allTasks] = await Promise.all([fetchProjects(), fetchTasks()]);
    renderList();
    loadArchivedProjects();
  } catch(e) {
    toast.error('Erro ao carregar projetos.');
    console.error(e);
  }
}

function renderList() {
  const content = document.getElementById('projects-content');
  if (!content) return;

  let list = allProjects.filter(p => {
    const matchSearch = !searchTerm ||
      p.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatus = !filterStatus || p.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const label = document.getElementById('proj-count');
  if (label) label.textContent = `${list.length} projeto${list.length !== 1 ? 's' : ''}`;

  if (!list.length) {
    content.innerHTML = `
      <div class="task-empty">
        <div class="task-empty-icon">📦</div>
        <div class="task-empty-title">${allProjects.length === 0 ? 'Nenhum projeto criado ainda' : 'Nenhum projeto encontrado'}</div>
        ${allProjects.length === 0 && store.can('project_create') ? `
          <button class="btn btn-primary mt-4" id="empty-new-proj-btn">+ Criar primeiro projeto</button>
        ` : ''}
      </div>
    `;
    document.getElementById('empty-new-proj-btn')?.addEventListener('click', () => openProjectModal());
    return;
  }

  content.innerHTML = `<div class="projects-grid">${list.map(p => renderProjectCard(p)).join('')}</div>`;

  content.querySelectorAll('.project-card[data-project-id]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      openProjectDetail(card.dataset.projectId);
    });
  });

  content.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { action, projectId } = btn.dataset;
      const proj = allProjects.find(p => p.id === projectId);
      if (action === 'edit')    openProjectModal(proj);
      if (action === 'archive') await handleArchiveProject(proj);
    });
  });
}

function renderProjectCard(p) {
  const tasks     = allTasks.filter(t => t.projectId === p.id);
  const done      = tasks.filter(t => t.status === 'done').length;
  const total     = tasks.length;
  const pct       = total ? Math.round((done / total) * 100) : 0;
  const status    = PROJECT_STATUS_MAP[p.status] || { label: p.status, color: '#6B7280' };
  const users     = store.get('users') || [];
  const workspaces = store.get('userWorkspaces') || [];
  // Multi-squad: lê do array novo (workspaceIds[]) ou cai no campo legado.
  const projWsIds = Array.isArray(p.workspaceIds) && p.workspaceIds.length
    ? p.workspaceIds
    : (p.workspaceId ? [p.workspaceId] : []);
  const projSquads = projWsIds
    .map(id => workspaces.find(w => w.id === id))
    .filter(Boolean);
  const members   = (p.members||[]).slice(0,4).map(uid => {
    const u = users.find(u=>u.id===uid);
    if (!u) return '';
    return `<div class="avatar avatar-sm" title="${esc(u.name)}"
      style="background:${u.avatarColor||'#3B82F6'}; margin-left:-6px; border:2px solid var(--bg-card);">
      ${(u.name||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()}
    </div>`;
  }).join('');

  const endDateStr = p.endDate
    ? new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'})
        .format(p.endDate?.toDate ? p.endDate.toDate() : new Date(p.endDate))
    : null;

  return `
    <div class="project-card" data-project-id="${p.id}">
      <div class="project-card-banner" style="background:${p.color||'#D4A843'};"></div>
      <div class="project-card-body">
        <div class="project-card-header">
          <div>
            <div class="project-card-icon" style="background:${p.color}18; font-size:1.5rem;">${p.icon||'📦'}</div>
          </div>
          <div style="display:flex; gap:6px; align-items:flex-start;">
            <span class="badge" style="background:${status.color}18; color:${status.color}; border:1px solid ${status.color}30; font-size:0.6875rem;">
              ${status.label}
            </span>
            ${store.can('project_edit') ? `
              <button class="btn btn-ghost btn-icon btn-sm" data-action="edit" data-project-id="${p.id}" title="Editar">✎</button>
              ${store.can('project_delete') ? `<button class="btn btn-ghost btn-icon btn-sm" data-action="archive" data-project-id="${p.id}" title="Arquivar">📥</button>` : ''}
            ` : ''}
          </div>
        </div>

        <div class="project-card-name">${esc(p.name)}</div>
        ${projSquads.length ? `
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;">
            ${projSquads.map(ws => `
              <span style="display:inline-flex;align-items:center;gap:6px;font-size:0.6875rem;
                padding:2px 8px;border-radius:var(--radius-full);
                background:${esc(ws.color||'#D4A843')}14;color:${esc(ws.color||'#D4A843')};
                border:1px solid ${esc(ws.color||'#D4A843')}30;">
                <span>${esc(ws.icon||'◈')}</span>
                <span>${esc(ws.name)}</span>
              </span>
            `).join('')}
          </div>
        ` : ''}
        ${p.description ? `<div class="project-card-desc">${esc(p.description)}</div>` : ''}

        <div class="project-card-stats">
          <div class="project-card-stat"><strong>${total}</strong> tarefas</div>
          <div class="project-card-stat"><strong>${done}</strong> concluídas</div>
          ${endDateStr ? `<div class="project-card-stat">📅 ${endDateStr}</div>` : ''}
        </div>

        <div class="project-card-progress">
          <div class="project-card-progress-label">
            <span>Progresso</span>
            <span style="color:var(--text-primary); font-weight:600;">${pct}%</span>
          </div>
          <div class="progress">
            <div class="progress-bar ${pct===100?'success':''}" style="width:${pct}%;"></div>
          </div>
        </div>

        <div class="project-card-footer">
          <div style="display:flex; align-items:center; margin-left:6px;">${members}</div>
          <button class="btn btn-secondary btn-sm" data-action="view-tasks" data-project-id="${p.id}"
            onclick="event.stopPropagation(); location.hash='#tasks?projectId=${encodeURIComponent(p.id)}';">
            Ver tarefas →
          </button>
        </div>
      </div>
    </div>
  `;
}

/* ─── Project Modal ─────────────────────────────────────────*/
export function openProjectModal(project = null, { defaultWorkspaceId = null, onSave = null } = {}) {
  const isEdit = !!project;
  // Usa `active !== false` (inclui docs legados sem o campo) — padrão do resto do app.
  // `u.active` filtrava todos que não têm o campo explicitamente true.
  const users  = (store.get('users')||[]).filter(u => u.active !== false);
  const userWorkspaces = store.get('userWorkspaces') || [];
  const currentWs      = store.get('currentWorkspace');

  let selectedColor = project?.color || PROJECT_COLORS[0];
  let selectedIcon  = project?.icon  || '📦';
  let selectedMembers = project?.members || [store.get('currentUser')?.uid].filter(Boolean);
  // Multi-squad (B5p): array de squad IDs. Lê do projeto existente
  // (workspaceIds[] novo OU workspaceId legado) ou usa default.
  const projSquadIds = Array.isArray(project?.workspaceIds) && project.workspaceIds.length
    ? project.workspaceIds
    : (project?.workspaceId ? [project.workspaceId] : null);
  const initialSquadIds = projSquadIds
    ?? (defaultWorkspaceId ? [defaultWorkspaceId]
        : (currentWs?.id ? [currentWs.id] : []));
  const selectedSquadIds = new Set(initialSquadIds);

  const content = `
    <form id="proj-form" novalidate>
      <div class="flex gap-4 items-start mb-4">
        <!-- Icon picker -->
        <div>
          <div class="form-label">Ícone</div>
          <div id="proj-icon-display" style="
            width:56px;height:56px;border-radius:var(--radius-md);
            background:${selectedColor}18;font-size:2rem;
            display:flex;align-items:center;justify-content:center;
            cursor:pointer;border:2px solid ${selectedColor}40;
            transition:all var(--transition-fast);" title="Clique para trocar">
            ${selectedIcon}
          </div>
        </div>
        <!-- Name + desc -->
        <div style="flex:1;">
          <div class="form-group">
            <label class="form-label">Nome do projeto *</label>
            <input type="text" class="form-input" id="pf-name"
              value="${esc(project?.name||'')}" placeholder="Ex: Lançamento do App" required maxlength="100" />
            <span class="form-error-msg" id="pf-name-err"></span>
          </div>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Descrição</label>
        <textarea class="form-textarea" id="pf-desc" rows="2"
          placeholder="Objetivo, escopo ou contexto do projeto..."
        >${esc(project?.description||'')}</textarea>
      </div>

      <!-- Color picker -->
      <div class="form-group">
        <label class="form-label">Cor</label>
        <div id="color-picker" style="display:flex;flex-wrap:wrap;gap:8px;">
          ${PROJECT_COLORS.map(c=>`
            <div data-color="${c}" style="
              width:28px;height:28px;border-radius:50%;background:${c};cursor:pointer;
              transition:all var(--transition-fast);
              border:3px solid ${c===selectedColor?'white':'transparent'};
              box-shadow:${c===selectedColor?'0 0 0 2px '+c:'none'};
            "></div>
          `).join('')}
        </div>
      </div>

      <!-- Icon picker dropdown -->
      <div class="form-group">
        <label class="form-label">Ícone do projeto</label>
        <div style="display:flex;flex-wrap:wrap;gap:8px;" id="icon-picker">
          ${PROJECT_ICONS.map(icon=>`
            <div data-icon="${icon}" style="
              width:36px;height:36px;border-radius:var(--radius-sm);
              background:${icon===selectedIcon?'rgba(212,168,67,0.15)':'var(--bg-elevated)'};
              border:1px solid ${icon===selectedIcon?'var(--border-accent)':'transparent'};
              display:flex;align-items:center;justify-content:center;
              font-size:1.25rem;cursor:pointer;transition:all var(--transition-fast);">
              ${icon}
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Squads (multi) -->
      <div class="form-group">
        <label class="form-label">
          Squads
          <span style="font-weight:400;color:var(--text-muted);font-size:0.75rem;margin-left:6px;">
            — vincule a um ou mais squads, ou deixe sem squad (visível apenas por setor)
          </span>
        </label>
        ${userWorkspaces.length > 0 ? `
          <div id="pf-squads" style="display:flex;flex-wrap:wrap;gap:6px;padding:10px;
            background:var(--bg-surface);border:1px solid var(--border-default);
            border-radius:var(--radius-md);">
            ${userWorkspaces.map(ws => {
              const on = selectedSquadIds.has(ws.id);
              return `<div class="squad-chip" data-squad-id="${ws.id}"
                style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;
                  border-radius:var(--radius-full);font-size:0.8125rem;cursor:pointer;
                  background:${on ? esc(ws.color||'#D4A843')+'24' : 'var(--bg-elevated)'};
                  color:${on ? esc(ws.color||'#D4A843') : 'var(--text-secondary)'};
                  border:1px solid ${on ? esc(ws.color||'#D4A843')+'60' : 'transparent'};
                  transition:all var(--transition-fast);">
                <span>${esc(ws.icon || '◈')}</span>
                <span>${esc(ws.name)}${ws.multiSector ? ' · multissetor' : ''}</span>
                ${on ? '<span style="font-size:0.75rem;">✓</span>' : ''}
              </div>`;
            }).join('')}
          </div>
          <small style="display:block;margin-top:4px;font-size:0.75rem;color:var(--text-muted);">
            Sem nenhum selecionado, o projeto fica disponível apenas pelo seu setor.
          </small>
        ` : `
          <small style="display:block;margin-top:4px;font-size:0.75rem;color:var(--text-muted);">
            Você ainda não faz parte de nenhum squad. Vá em <strong>Squads</strong> para criar ou peça acesso ao gestor.
          </small>
        `}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="form-group">
          <label class="form-label">Status</label>
          <select class="form-select" id="pf-status">
            ${PROJECT_STATUSES.map(s=>`
              <option value="${s.value}" ${project?.status===s.value?'selected':''}>${s.label}</option>
            `).join('')}
          </select>
        </div>
        <div class="form-group"></div>
        <div class="form-group">
          <label class="form-label">Data de início</label>
          <input type="date" class="form-input" id="pf-start"
            value="${project?.startDate ? toInputDate(project.startDate).slice(0,10) : ''}" style="padding:8px 12px;" />
        </div>
        <div class="form-group">
          <label class="form-label">Data de término</label>
          <input type="date" class="form-input" id="pf-end"
            value="${project?.endDate ? toInputDate(project.endDate).slice(0,10) : ''}" style="padding:8px 12px;" />
        </div>
      </div>

      <!-- Members -->
      <div class="form-group">
        <label class="form-label">Membros da equipe</label>
        <div id="proj-members" style="display:flex;flex-wrap:wrap;gap:6px;padding:10px;background:var(--bg-surface);border:1px solid var(--border-default);border-radius:var(--radius-md);">
          ${users.map(u=>{
            const isMember = selectedMembers.includes(u.id);
            return `<div class="assignee-chip ${isMember?'member-selected':''}" data-member-id="${u.id}"
              style="background:${isMember?'rgba(212,168,67,0.15)':'var(--bg-elevated)'};
                border-color:${isMember?'rgba(212,168,67,0.4)':'transparent'};
                cursor:pointer;">
              <div class="avatar" style="background:${u.avatarColor||'#3B82F6'};width:20px;height:20px;font-size:0.5rem;">
                ${(u.name||'').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()}
              </div>
              ${esc(u.name.split(' ')[0])}
              <span class="member-check" style="color:var(--brand-gold);font-size:0.75rem;display:${isMember?'inline':'none'};">✓</span>
            </div>`;
          }).join('')}
        </div>
      </div>
    </form>
  `;

  const m = modal.open({
    title: isEdit ? 'Editar Projeto' : 'Novo Projeto',
    size: 'lg',
    content,
    footer: [
      { label: 'Cancelar', class: 'btn-secondary', closeOnClick: true },
      {
        label: isEdit ? 'Salvar' : 'Criar Projeto',
        class: 'btn-primary',
        closeOnClick: false,
        onClick: async (_, { close }) => {
          const name = document.getElementById('pf-name')?.value?.trim();
          const errEl = document.getElementById('pf-name-err');
          if (!name) { if(errEl) errEl.textContent='Nome é obrigatório.'; return; }
          if(errEl) errEl.textContent='';

          const btn = document.querySelector('.modal-footer .btn-primary');
          if(btn){ btn.classList.add('loading'); btn.disabled=true; }
          try {
            const wsIds = [...selectedSquadIds].filter(Boolean);
            const data = {
              name,
              description:  document.getElementById('pf-desc')?.value?.trim()||'',
              color:        selectedColor,
              icon:         selectedIcon,
              status:       document.getElementById('pf-status')?.value||'planning',
              members:      selectedMembers,
              startDate:    document.getElementById('pf-start')?.value || null,
              endDate:      document.getElementById('pf-end')?.value   || null,
              workspaceIds: wsIds,                 // canônico (B5p multi-squad)
              workspaceId:  wsIds[0] || null,      // espelho legacy
            };
            if (isEdit) await updateProject(project.id, data);
            else        await createProject(data);
            toast.success(isEdit ? 'Projeto atualizado!' : 'Projeto criado!');
            close();
            // Recarrega a página de projetos só se ela estiver montada
            if (document.getElementById('projects-content')) {
              await loadData();
            }
            if (typeof onSave === 'function') {
              try { await onSave(); } catch (_) {}
            }
          } catch(e) { toast.error(e.message); }
          finally { if(btn){ btn.classList.remove('loading'); btn.disabled=false; } }
        }
      }
    ],
  });

  setTimeout(() => {
    // Color picker
    document.querySelectorAll('#color-picker [data-color]').forEach(el => {
      el.addEventListener('click', () => {
        selectedColor = el.dataset.color;
        document.querySelectorAll('#color-picker [data-color]').forEach(e=>{
          e.style.border=`3px solid ${e.dataset.color===selectedColor?'white':'transparent'}`;
          e.style.boxShadow=e.dataset.color===selectedColor?`0 0 0 2px ${selectedColor}`:'none';
        });
        const disp = document.getElementById('proj-icon-display');
        if(disp){ disp.style.background=`${selectedColor}18`; disp.style.borderColor=`${selectedColor}40`; }
      });
    });

    // Icon picker
    document.querySelectorAll('#icon-picker [data-icon]').forEach(el => {
      el.addEventListener('click', () => {
        selectedIcon = el.dataset.icon;
        document.querySelectorAll('#icon-picker [data-icon]').forEach(e=>{
          e.style.background=e.dataset.icon===selectedIcon?'rgba(212,168,67,0.15)':'var(--bg-elevated)';
          e.style.borderColor=e.dataset.icon===selectedIcon?'var(--border-accent)':'transparent';
        });
        const disp = document.getElementById('proj-icon-display');
        if(disp) disp.textContent = selectedIcon;
      });
    });

    // Member toggle
    document.querySelectorAll('#proj-members [data-member-id]').forEach(el => {
      el.addEventListener('click', () => {
        const uid = el.dataset.memberId;
        const idx = selectedMembers.indexOf(uid);
        if (idx > -1) selectedMembers.splice(idx, 1);
        else selectedMembers.push(uid);
        const isSelected = selectedMembers.includes(uid);
        el.style.background    = isSelected?'rgba(212,168,67,0.15)':'var(--bg-elevated)';
        el.style.borderColor   = isSelected?'rgba(212,168,67,0.4)':'transparent';
        el.classList.toggle('member-selected', isSelected);
        const check = el.querySelector('.member-check');
        if (check) check.style.display = isSelected ? 'inline' : 'none';
      });
    });

    // Squads multi-select toggle (B5p)
    document.querySelectorAll('#pf-squads [data-squad-id]').forEach(el => {
      el.addEventListener('click', () => {
        const sid = el.dataset.squadId;
        const ws  = userWorkspaces.find(w => w.id === sid);
        const color = ws?.color || '#D4A843';
        if (selectedSquadIds.has(sid)) {
          selectedSquadIds.delete(sid);
          el.style.background = 'var(--bg-elevated)';
          el.style.color      = 'var(--text-secondary)';
          el.style.borderColor= 'transparent';
          const check = el.querySelector('span:last-child');
          if (check && check.textContent === '✓') check.remove();
        } else {
          selectedSquadIds.add(sid);
          el.style.background = `${color}24`;
          el.style.color      = color;
          el.style.borderColor= `${color}60`;
          if (!el.querySelector('span:last-child') || el.querySelector('span:last-child').textContent !== '✓') {
            const check = document.createElement('span');
            check.style.fontSize = '0.75rem';
            check.textContent = '✓';
            el.appendChild(check);
          }
        }
      });
    });
  }, 60);
}

async function handleArchiveProject(proj) {
  const confirmed = await modal.confirm({
    title:       'Arquivar projeto',
    message:     `Arquivar o projeto "<strong>${esc(proj.name)}</strong>"?<br>As tarefas vinculadas continuarão acessíveis. Você poderá restaurá-lo depois.`,
    confirmText: 'Arquivar', danger: false, icon: '📥',
  });
  if (!confirmed) return;
  try {
    await archiveProject(proj.id);
    toast.success(`Projeto "${proj.name}" arquivado.`);
    await loadData();
  } catch(e) { toast.error(e.message); }
}

async function loadArchivedProjects() {
  try {
    const archived = await fetchArchivedProjects();
    const section  = document.getElementById('archived-projects-section');
    const countEl  = document.getElementById('archived-proj-count');
    const grid     = document.getElementById('archived-projects-grid');
    if (!section || !grid) return;

    if (!archived.length) { section.style.display = 'none'; return; }
    section.style.display = 'block';
    if (countEl) countEl.textContent = archived.length;

    grid.innerHTML = `<div class="projects-grid">${archived.map(p => {
      const status = PROJECT_STATUS_MAP[p.status] || { label: p.status, color: '#6B7280' };
      return `
        <div class="project-card" style="opacity:0.65;">
          <div class="project-card-banner" style="background:${p.color||'#888'};"></div>
          <div class="project-card-body">
            <div class="project-card-header">
              <div>
                <div class="project-card-icon" style="background:${p.color||'#888'}18;font-size:1.5rem;">${p.icon||'📦'}</div>
              </div>
              <div style="display:flex;gap:6px;align-items:center;">
                <span class="badge" style="background:rgba(245,158,11,0.12);color:var(--color-warning);border:1px solid rgba(245,158,11,0.3);font-size:0.6875rem;">
                  Arquivado
                </span>
                ${store.can('project_edit') ? `
                  <button class="btn btn-secondary btn-sm restore-proj-btn" data-id="${p.id}">Restaurar</button>
                ` : ''}
                ${store.can('project_delete') ? `
                  <button class="btn btn-ghost btn-icon btn-sm delete-proj-btn" data-id="${p.id}"
                    title="Excluir permanentemente" style="color:var(--color-danger);">🗑</button>
                ` : ''}
              </div>
            </div>
            <div class="project-card-name">${esc(p.name)}</div>
            ${p.description ? `<div class="project-card-desc">${esc(p.description)}</div>` : ''}
          </div>
        </div>`;
    }).join('')}</div>`;

    grid.querySelectorAll('.restore-proj-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const proj = archived.find(p => p.id === btn.dataset.id);
        try {
          await unarchiveProject(btn.dataset.id);
          toast.success(`Projeto "${proj?.name}" restaurado!`);
          await loadData();
        } catch(e) { toast.error(e.message); }
      });
    });

    grid.querySelectorAll('.delete-proj-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const proj = archived.find(p => p.id === btn.dataset.id);

        // Verificar dependências
        let depsMsg = '';
        try {
          const deps = await checkProjectDependencies(btn.dataset.id);
          if (deps.total > 0) {
            const parts = [];
            if (deps.tasks)       parts.push(`${deps.tasks} tarefa(s)`);
            if (deps.csatSurveys) parts.push(`${deps.csatSurveys} pesquisa(s) CSAT`);
            depsMsg = `<br><br><strong style="color:var(--color-warning);">Atenção:</strong> este projeto possui ${parts.join(' e ')} vinculado(s). Os vínculos ficarão órfãos.`;
            if (deps.goalEvidence > 0) {
              depsMsg += `<br><strong style="color:var(--color-danger);">Risco:</strong> ${deps.goalEvidence} tarefa(s) são evidência de metas — excluir pode comprometer avaliações.`;
            }
          }
        } catch(_) {}

        const ok = await modal.confirm({
          title: 'Excluir projeto permanentemente',
          message: `Excluir "<strong>${esc(proj?.name||'')}</strong>" de forma irreversível?${depsMsg}`,
          confirmText: 'Excluir permanentemente', danger: true, icon: '🗑',
        });
        if (ok) {
          try {
            await deleteProject(btn.dataset.id, { force: true });
            toast.success('Projeto excluído permanentemente.');
            await loadData();
          } catch(e) { toast.error(e.message); }
        }
      });
    });
  } catch(e) {
    console.warn('[Projects] Erro ao carregar arquivados:', e.message);
  }
}

function openProjectDetail(projectId) {
  // Navega para tasks filtrado por projeto (via query param p/ evitar race com fetchProjects)
  location.hash = `#tasks?projectId=${encodeURIComponent(projectId)}`;
}

function toInputDate(ts) {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toISOString().slice(0, 16);
}
