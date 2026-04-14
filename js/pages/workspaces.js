/**
 * PRIMETOUR — Workspaces Page (Fase 0 Round B)
 * Gestão de workspaces: criar, editar, membros, convites
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import { REQUESTING_AREAS } from '../services/tasks.js';
import {
  createWorkspace, updateWorkspace, archiveWorkspace, unarchiveWorkspace,
  addMember, removeMember, toggleWorkspaceAdmin,
  createInvite, fetchInvites, getWorkspace,
  fetchUserWorkspaces, fetchAllWorkspaces, fetchArchivedWorkspaces,
  WORKSPACE_ICONS, WORKSPACE_COLORS,
} from '../services/workspaces.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let allWorkspaces = [];

/* ─── Render ─────────────────────────────────────────────── */
export async function renderWorkspaces(container) {
  const canCreate = store.can('workspace_create');
  const canViewAll = store.can('system_view_all');

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Squads / Workspaces</h1>
        <p class="page-subtitle">Times de trabalho temporários ou permanentes — agrupam pessoas, projetos e tarefas de uma iniciativa</p>
      </div>
      <div class="page-header-actions">
        ${canCreate ? `<button class="btn btn-primary" id="new-ws-btn">+ Novo Squad</button>` : ''}
      </div>
    </div>

    <!-- Info banner -->
    <div style="display:flex;align-items:flex-start;gap:12px;
      background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.25);
      border-radius:var(--radius-md);padding:12px 16px;margin-bottom:24px;
      font-size:0.8125rem;color:var(--text-secondary);line-height:1.6;">
      <span style="font-size:1rem;flex-shrink:0;">ℹ</span>
      <span>
        <strong>Squads</strong> são grupos de trabalho que agrupam pessoas, projetos e tarefas de uma mesma iniciativa.
        Diferente do <em>setor</em> (que é fixo no cadastro do usuário), um squad pode ser
        <strong>monossetorial</strong> (ex: "Time Vendas SP") ou <strong>multissetor</strong>
        (ex: "Feirão 2026" juntando Vendas, Marketing e Operações).
        Na sidebar você escolhe quais squads ficam ativos (afetam o que você vê) e qual é o seu padrão (onde novas tarefas são criadas).
      </span>
    </div>

    <div id="ws-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px;">
      ${[0,1,2].map(()=>'<div class="card skeleton" style="height:200px;"></div>').join('')}
    </div>

    <!-- Seção de workspaces arquivados -->
    ${canViewAll ? `
    <div id="archived-section" style="margin-top:32px;display:none;">
      <button id="toggle-archived-btn" style="display:flex;align-items:center;gap:8px;
        background:none;border:none;cursor:pointer;padding:8px 0;
        font-size:0.875rem;font-weight:600;color:var(--text-muted);">
        <span id="archived-arrow" style="transition:transform 0.2s;">▸</span>
        Squads Arquivados (<span id="archived-count">0</span>)
      </button>
      <div id="archived-grid" style="display:none;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px;margin-top:12px;">
      </div>
    </div>
    ` : ''}
  `;

  document.getElementById('new-ws-btn')?.addEventListener('click', () => openWorkspaceModal());
  document.getElementById('toggle-archived-btn')?.addEventListener('click', toggleArchivedSection);
  await loadWorkspaces();
  if (canViewAll) loadArchivedWorkspaces();
}

async function loadWorkspaces() {
  try {
    const user = store.get('currentUser');
    if (store.can('system_view_all')) {
      allWorkspaces = await fetchAllWorkspaces();
    } else {
      allWorkspaces = await fetchUserWorkspaces(user.uid);
    }
    allWorkspaces = allWorkspaces.filter(w => !w.archived);
    renderGrid();
  } catch(e) {
    toast.error('Erro ao carregar workspaces: ' + e.message);
  }
}

function renderGrid() {
  const grid = document.getElementById('ws-grid');
  if (!grid) return;

  if (!allWorkspaces.length) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;">
        <div class="empty-state" style="min-height:40vh;">
          <div class="empty-state-icon">◈</div>
          <div class="empty-state-title">Nenhum squad ainda</div>
          <p class="text-sm text-muted">
            ${store.can('workspace_create')
              ? 'Crie o primeiro squad para agrupar projetos e tarefas de uma iniciativa ou time.'
              : 'Você ainda não foi adicionado a nenhum squad. Contate seu gestor.'}
          </p>
          ${store.can('workspace_create') ? `
            <button class="btn btn-primary mt-4" id="empty-new-ws-btn">+ Criar Squad</button>
          ` : ''}
        </div>
      </div>`;
    document.getElementById('empty-new-ws-btn')?.addEventListener('click', () => openWorkspaceModal());
    return;
  }

  const uid = store.get('currentUser')?.uid;

  grid.innerHTML = allWorkspaces.map(ws => {
    const isAdmin   = ws.adminIds?.includes(uid);
    const memberCount = ws.members?.length || 0;
    const allUsers  = store.get('users') || [];
    const members   = ws.members?.slice(0, 5).map(mid => {
      const u = allUsers.find(u => u.id === mid);
      if (!u) return '';
      const initials = u.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
      return `<div class="avatar avatar-sm" title="${esc(u.name)}"
        style="background:${u.avatarColor||'#3B82F6'};margin-left:-8px;border:2px solid var(--bg-card);">
        ${initials}</div>`;
    }).join('') || '';

    return `
      <div class="card" style="border-top:3px solid ${esc(ws.color||'#D4A843')};cursor:default;">
        <div class="card-header" style="padding-bottom:12px;">
          <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
            <div style="width:40px;height:40px;border-radius:var(--radius-md);
              background:${esc(ws.color||'#D4A843')}22;color:${esc(ws.color||'#D4A843')};
              display:flex;align-items:center;justify-content:center;font-size:1.25rem;flex-shrink:0;">
              ${esc(ws.icon||'◈')}
            </div>
            <div style="min-width:0;">
              <div style="font-weight:600;color:var(--text-primary);font-size:0.9375rem;
                overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(ws.name)}</div>
              <div style="font-size:0.75rem;color:var(--text-muted);display:flex;align-items:center;gap:6px;">
                ${ws.multiSector
                  ? `<span title="Squad multissetor — aceita membros de qualquer setor">⇌ Multissetor</span>`
                  : (ws.sector ? esc(ws.sector) : 'Sem setor definido')}
              </div>
            </div>
          </div>
          <div style="display:flex;gap:4px;">
            <button class="btn btn-ghost btn-icon btn-sm ws-open-btn" data-id="${ws.id}" title="Abrir workspace do squad">↗</button>
            ${isAdmin || store.can('system_view_all') ? `
              <button class="btn btn-ghost btn-icon btn-sm ws-edit-btn" data-id="${ws.id}" title="Editar">✎</button>
              <button class="btn btn-ghost btn-icon btn-sm ws-members-btn" data-id="${ws.id}" title="Membros">◉</button>
            ` : ''}
          </div>
        </div>
        <div class="card-body" style="padding-top:0;">
          ${ws.description ? `<p style="font-size:0.8125rem;color:var(--text-secondary);margin-bottom:12px;line-height:1.5;">${esc(ws.description)}</p>` : ''}
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="display:flex;align-items:center;margin-left:8px;">
              ${members}
              ${memberCount > 5 ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-left:4px;">+${memberCount-5}</div>` : ''}
            </div>
            <span style="font-size:0.75rem;color:var(--text-muted);">${memberCount} membro${memberCount!==1?'s':''}</span>
          </div>
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border-subtle);
            display:flex;align-items:center;gap:6px;">
            ${isAdmin
              ? `<span style="font-size:0.6875rem;padding:2px 8px;border-radius:var(--radius-full);
                  background:rgba(212,168,67,0.12);color:var(--brand-gold);border:1px solid rgba(212,168,67,0.3);">
                  Admin</span>`
              : `<span style="font-size:0.6875rem;padding:2px 8px;border-radius:var(--radius-full);
                  background:var(--bg-elevated);color:var(--text-muted);border:1px solid var(--border-subtle);">
                  Membro</span>`}
            ${isAdmin || store.can('system_view_all') ? `
              <button class="btn btn-ghost btn-sm ws-invite-btn" data-id="${ws.id}"
                style="margin-left:auto;font-size:0.8125rem;">
                + Convidar
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Events
  grid.querySelectorAll('.ws-open-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      window.location.hash = `#squad?id=${encodeURIComponent(btn.dataset.id)}`;
    })
  );
  grid.querySelectorAll('.ws-edit-btn').forEach(btn =>
    btn.addEventListener('click', () => openWorkspaceModal(allWorkspaces.find(w => w.id === btn.dataset.id)))
  );
  grid.querySelectorAll('.ws-members-btn').forEach(btn =>
    btn.addEventListener('click', () => openMembersModal(allWorkspaces.find(w => w.id === btn.dataset.id)))
  );
  grid.querySelectorAll('.ws-invite-btn').forEach(btn =>
    btn.addEventListener('click', () => openInviteModal(btn.dataset.id))
  );
}

/* ─── Seção Arquivados ──────────────────────────────────── */
function toggleArchivedSection() {
  const grid  = document.getElementById('archived-grid');
  const arrow = document.getElementById('archived-arrow');
  if (!grid) return;
  const show = grid.style.display === 'none';
  grid.style.display = show ? 'grid' : 'none';
  if (arrow) arrow.style.transform = show ? 'rotate(90deg)' : '';
}

async function loadArchivedWorkspaces() {
  try {
    const archived = await fetchArchivedWorkspaces();
    const section  = document.getElementById('archived-section');
    const countEl  = document.getElementById('archived-count');
    const grid     = document.getElementById('archived-grid');
    if (!section || !grid) return;

    if (!archived.length) { section.style.display = 'none'; return; }
    section.style.display = 'block';
    if (countEl) countEl.textContent = archived.length;

    const allUsers = store.get('users') || [];

    grid.innerHTML = archived.map(ws => {
      const memberCount = ws.members?.length || 0;
      return `
        <div class="card" style="border-top:3px solid ${esc(ws.color||'#888')};opacity:0.7;">
          <div class="card-header" style="padding-bottom:12px;">
            <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
              <div style="width:40px;height:40px;border-radius:var(--radius-md);
                background:${esc(ws.color||'#888')}22;color:${esc(ws.color||'#888')};
                display:flex;align-items:center;justify-content:center;font-size:1.25rem;flex-shrink:0;">
                ${esc(ws.icon||'◈')}
              </div>
              <div style="min-width:0;">
                <div style="font-weight:600;color:var(--text-primary);font-size:0.9375rem;
                  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(ws.name)}</div>
                <div style="font-size:0.75rem;color:var(--text-muted);display:flex;align-items:center;gap:6px;">
                  <span style="color:var(--color-warning);">Arquivado</span>
                  · ${memberCount} membro${memberCount!==1?'s':''}
                </div>
              </div>
            </div>
          </div>
          <div class="card-body" style="padding-top:0;">
            ${ws.description ? `<p style="font-size:0.8125rem;color:var(--text-secondary);margin-bottom:12px;line-height:1.5;">${esc(ws.description)}</p>` : ''}
            <div style="display:flex;gap:8px;justify-content:flex-end;">
              <button class="btn btn-secondary btn-sm ws-restore-btn" data-id="${ws.id}">
                Restaurar
              </button>
            </div>
          </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.ws-restore-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const wsId = btn.dataset.id;
        const ws = archived.find(w => w.id === wsId);
        const ok = await modal.confirm({
          title: 'Restaurar workspace',
          message: `Restaurar <strong>${esc(ws?.name||'')}</strong>? Ele voltará a aparecer para todos os membros.`,
          confirmText: 'Restaurar', icon: '↩',
        });
        if (ok) {
          try {
            await unarchiveWorkspace(wsId);
            toast.success('Workspace restaurado!');
            await loadWorkspaces();
            await loadArchivedWorkspaces();
          } catch(e) { toast.error(e.message); }
        }
      });
    });
  } catch(e) {
    console.warn('[Workspaces] Erro ao carregar arquivados:', e.message);
  }
}

/* ─── Modal: criar / editar workspace ───────────────────── */
function openWorkspaceModal(ws = null) {
  const isEdit = !!ws;

  modal.open({
    title:   isEdit ? `Editar squad — ${ws.name}` : 'Novo Squad',
    size:    'md',
    content: `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div class="form-group">
          <label class="form-label">Nome do squad *</label>
          <input type="text" class="form-input" id="ws-name"
            value="${esc(ws?.name||'')}" placeholder="Ex: Feirão 2026, Time Vendas SP, Squad Lançamento App" maxlength="60" />
          <span class="form-error-msg" id="ws-name-error"></span>
        </div>
        <div class="form-group">
          <label class="form-label">Setor principal (opcional)</label>
          <select class="form-select" id="ws-sector">
            <option value="">— Nenhum setor específico —</option>
            ${REQUESTING_AREAS.map(a =>
              `<option value="${a}" ${(ws?.sector||'')=== a?'selected':''}>${a}</option>`
            ).join('')}
          </select>
          <small style="display:block;margin-top:4px;font-size:0.75rem;color:var(--text-muted);">
            Usado para sugerir membros quando não é multissetor. Deixe em branco se o squad é transversal.
          </small>
        </div>
        <div class="form-group">
          <label class="form-label">Descrição</label>
          <textarea class="form-textarea" id="ws-description" rows="2" maxlength="200"
            placeholder="Objetivo, prazo previsto, escopo do squad...">${esc(ws?.description||'')}</textarea>
        </div>
        <div class="form-group">
          <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:10px 12px;
            border-radius:var(--radius-md);background:var(--bg-surface);border:1px solid var(--border-subtle);">
            <input type="checkbox" id="ws-multisector" ${ws?.multiSector?'checked':''}
              style="margin-top:2px;accent-color:var(--brand-gold);" />
            <div>
              <div style="font-size:0.875rem;font-weight:500;color:var(--text-secondary);">
                Workspace multissetor
                <span title="Permite convidar usuários de setores diferentes do seu." 
                  style="cursor:help;color:var(--text-muted);font-size:0.75rem;">ℹ</span>
              </div>
              <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
                Por padrão, apenas usuários do mesmo setor podem ser convidados.
                Ative para permitir colaboração entre setores.
              </div>
            </div>
          </label>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <div class="form-group">
            <label class="form-label">Ícone</label>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${WORKSPACE_ICONS.map(icon => `
                <div class="ws-icon-btn" data-icon="${icon}" style="
                  width:36px;height:36px;border-radius:var(--radius-md);
                  display:flex;align-items:center;justify-content:center;font-size:1.1rem;
                  cursor:pointer;border:2px solid ${(ws?.icon||WORKSPACE_ICONS[0])===icon?'var(--brand-gold)':'var(--border-subtle)'};
                  background:${(ws?.icon||WORKSPACE_ICONS[0])===icon?'rgba(212,168,67,0.12)':'var(--bg-surface)'};
                  transition:all 0.15s;">${icon}</div>
              `).join('')}
            </div>
            <input type="hidden" id="ws-icon" value="${esc(ws?.icon||WORKSPACE_ICONS[0])}" />
          </div>
          <div class="form-group">
            <label class="form-label">Cor</label>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
              ${WORKSPACE_COLORS.map(c => `
                <div class="ws-color-btn" data-color="${c}" style="
                  width:28px;height:28px;border-radius:50%;background:${c};cursor:pointer;
                  border:3px solid ${(ws?.color||WORKSPACE_COLORS[0])===c?'white':'transparent'};
                  box-shadow:${(ws?.color||WORKSPACE_COLORS[0])===c?'0 0 0 2px '+c:'none'};
                  transition:all 0.15s;"></div>
              `).join('')}
            </div>
            <input type="hidden" id="ws-color" value="${esc(ws?.color||WORKSPACE_COLORS[0])}" />
          </div>
        </div>
        ${isEdit && (store.can('system_view_all') || ws?.adminIds?.includes(store.get('currentUser')?.uid)) ? `
          <div style="padding-top:12px;border-top:1px solid var(--border-subtle);">
            <button class="btn btn-secondary btn-sm ws-archive-btn" style="color:var(--color-danger);border-color:rgba(239,68,68,0.3);">
              Arquivar workspace
            </button>
          </div>
        ` : ''}
      </div>
    `,
    footer: [
      { label:'Cancelar', class:'btn-secondary', closeOnClick:true },
      {
        label: isEdit ? 'Salvar' : 'Criar squad',
        class: 'btn-primary', closeOnClick: false,
        onClick: async (_, { close }) => {
          const name = document.getElementById('ws-name')?.value?.trim();
          const errEl = document.getElementById('ws-name-error');
          if (!name) { if(errEl) errEl.textContent='Nome é obrigatório.'; return; }
          if(errEl) errEl.textContent='';

          const data = {
            name,
            description: document.getElementById('ws-description')?.value?.trim() || '',
            sector:      document.getElementById('ws-sector')?.value?.trim() || '',
            color:       document.getElementById('ws-color')?.value || WORKSPACE_COLORS[0],
            icon:        document.getElementById('ws-icon')?.value  || WORKSPACE_ICONS[0],
            multiSector: !!document.getElementById('ws-multisector')?.checked,
          };

          const btn = document.querySelector('.modal-footer .btn-primary');
          if(btn){ btn.classList.add('loading'); btn.disabled=true; }
          try {
            if (isEdit) {
              await updateWorkspace(ws.id, data);
              toast.success('Workspace atualizado!');
            } else {
              await createWorkspace(data);
              toast.success(`Workspace "${data.name}" criado!`);
            }
            close();
            await loadWorkspaces();
          } catch(e) { toast.error(e.message); }
          finally { if(btn){ btn.classList.remove('loading'); btn.disabled=false; } }
        },
      },
    ],
  });

  // Bind icon/color selectors
  setTimeout(() => {
    document.querySelectorAll('.ws-icon-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('ws-icon').value = btn.dataset.icon;
        document.querySelectorAll('.ws-icon-btn').forEach(b => {
          b.style.borderColor = 'var(--border-subtle)';
          b.style.background  = 'var(--bg-surface)';
        });
        btn.style.borderColor = 'var(--brand-gold)';
        btn.style.background  = 'rgba(212,168,67,0.12)';
      });
    });
    document.querySelectorAll('.ws-color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('ws-color').value = btn.dataset.color;
        document.querySelectorAll('.ws-color-btn').forEach(b => {
          b.style.borderColor = 'transparent'; b.style.boxShadow='none';
        });
        btn.style.borderColor = 'white';
        btn.style.boxShadow   = `0 0 0 2px ${btn.dataset.color}`;
      });
    });
    document.querySelector('.ws-archive-btn')?.addEventListener('click', async () => {
      const ok = await modal.confirm({
        title:'Arquivar workspace',
        message:`Arquivar <strong>${esc(ws.name)}</strong>? As tarefas não serão excluídas.`,
        confirmText:'Arquivar', danger:true, icon:'⚠',
      });
      if (ok) {
        try {
          await archiveWorkspace(ws.id);
          toast.success('Workspace arquivado.');
          document.querySelector('.modal-overlay')?.click();
          await loadWorkspaces();
        } catch(e) { toast.error(e.message); }
      }
    });
  }, 50);
}

/* ─── Modal: membros ─────────────────────────────────────── */
async function openMembersModal(ws) {
  if (!ws) return;
  const allUsers = store.get('users') || [];
  const members  = ws.members || [];
  const uid      = store.get('currentUser')?.uid;

  modal.open({
    title: `Membros — ${ws.name}`,
    size:  'md',
    content: `
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${members.length === 0
          ? `<div class="empty-state" style="padding:24px;"><div class="empty-state-title">Nenhum membro</div></div>`
          : members.map(mid => {
              const u       = allUsers.find(u => u.id === mid);
              const name    = u?.name || mid;
              const isAdmin = ws.adminIds?.includes(mid);
              const isOwner = ws.ownerId === mid;
              const initials = (u?.name||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
              const canManage = store.can('system_view_all') || ws.adminIds?.includes(uid);

              return `
                <div style="display:flex;align-items:center;gap:10px;padding:8px 0;
                  border-bottom:1px solid var(--border-subtle);">
                  <div class="avatar avatar-sm" style="background:${u?.avatarColor||'#3B82F6'};flex-shrink:0;">
                    ${initials}
                  </div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:0.875rem;font-weight:500;color:var(--text-primary);">${esc(name)}</div>
                    <div style="font-size:0.75rem;color:var(--text-muted);">${esc(u?.department||u?.role||'')}</div>
                  </div>
                  <div style="display:flex;align-items:center;gap:6px;">
                    ${isOwner
                      ? `<span style="font-size:0.6875rem;padding:2px 8px;border-radius:var(--radius-full);background:rgba(212,168,67,0.12);color:var(--brand-gold);">Dono</span>`
                      : isAdmin
                        ? `<span style="font-size:0.6875rem;padding:2px 8px;border-radius:var(--radius-full);background:rgba(56,189,248,0.12);color:#38BDF8;">Admin</span>`
                        : ''}
                    ${canManage && !isOwner ? `
                      <button class="btn btn-ghost btn-icon btn-sm toggle-admin-btn"
                        data-uid="${mid}" data-admin="${isAdmin}" title="${isAdmin?'Rebaixar':'Promover a admin'}">
                        ${isAdmin ? '↓' : '↑'}
                      </button>
                      <button class="btn btn-ghost btn-icon btn-sm remove-member-btn"
                        data-uid="${mid}" title="Remover do workspace" style="color:var(--color-danger);">✕</button>
                    ` : ''}
                  </div>
                </div>
              `;
            }).join('')}
      </div>
    `,
    footer: [{ label:'Fechar', class:'btn-secondary', closeOnClick:true }],
  });

  setTimeout(() => {
    document.querySelectorAll('.toggle-admin-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const makeAdmin = btn.dataset.admin === 'false';
        try {
          await toggleWorkspaceAdmin(ws.id, btn.dataset.uid, makeAdmin);
          toast.success(makeAdmin ? 'Usuário promovido a admin.' : 'Admin rebaixado.');
          document.querySelector('.modal-overlay')?.click();
          await loadWorkspaces();
        } catch(e) { toast.error(e.message); }
      });
    });
    document.querySelectorAll('.remove-member-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const u = allUsers.find(u => u.id === btn.dataset.uid);
        const ok = await modal.confirm({
          title:'Remover membro',
          message:`Remover <strong>${esc(u?.name||btn.dataset.uid)}</strong> deste workspace?`,
          confirmText:'Remover', danger:true, icon:'✕',
        });
        if (ok) {
          try {
            await removeMember(ws.id, btn.dataset.uid);
            toast.success('Membro removido.');
            document.querySelector('.modal-overlay')?.click();
            await loadWorkspaces();
          } catch(e) { toast.error(e.message); }
        }
      });
    });
  }, 50);
}

/* ─── Modal: convidar membro ─────────────────────────────── */
async function openInviteModal(wsId) {
  // Buscar workspace fresco do Firestore para ter members atualizado
  let ws = await getWorkspace(wsId).catch(() => allWorkspaces.find(w => w.id === wsId));

  // Garantir usuários carregados
  let allUsers = store.get('users') || [];
  if (!allUsers.length) {
    try {
      const { collection, getDocs, query, orderBy } =
        await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const { db } = await import('../firebase.js');
      const snap = await getDocs(query(collection(db,'users'), orderBy('name','asc')));
      allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      store.set('users', allUsers);
    } catch(e) { console.warn('users load error:', e.message); }
  }

  // Usuários ainda não no workspace — members pode ser undefined em workspace recém-criado
  const wsMembers    = Array.isArray(ws?.members) ? ws.members : [];
  const userSector   = store.get('userSector');
  const wsSector     = ws?.sector || '';
  const isMultiSector = ws?.multiSector === true;

  const nonMembers = allUsers.filter(u => {
    if (u.active === false) return false;
    if (wsMembers.includes(u.id)) return false;
    // Se workspace é multissetor: aceita qualquer usuário
    if (isMultiSector) return true;
    // Se workspace tem setor: apenas usuários do mesmo setor
    if (wsSector) {
      const uSector = u.sector || u.department;
      return !uSector || uSector === wsSector;
    }
    return true;
  });

  modal.open({
    title:   `Convidar para — ${ws?.name}`,
    size:    'sm',
    content: `
      <div style="margin-bottom:16px;">
        <p style="font-size:0.875rem;color:var(--text-secondary);margin-bottom:12px;line-height:1.5;">
          Selecione um usuário já cadastrado no sistema para adicionar ao workspace.
        </p>
        ${nonMembers.length ? `
          <div style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto;">
            ${nonMembers.map(u => {
              const initials = u.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
              return `
                <div class="dropdown-item add-user-to-ws" data-uid="${u.id}"
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
    footer: [{ label:'Fechar', class:'btn-secondary', closeOnClick:true }],
  });

  setTimeout(() => {
    document.querySelectorAll('.add-user-to-ws').forEach(item => {
      item.addEventListener('click', async () => {
        const uid = item.dataset.uid;
        const u   = allUsers.find(u => u.id === uid);
        try {
          await addMember(wsId, uid);
          toast.success(`${u?.name} adicionado ao workspace!`);
          document.querySelector('.modal-overlay')?.click();
          await loadWorkspaces();
        } catch(e) { toast.error(e.message); }
      });
    });
  }, 50);
}
