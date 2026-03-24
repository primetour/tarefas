/**
 * PRIMETOUR — Roles Page
 * Gestão de roles e permissões dinâmicas
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import {
  fetchRoles, createRole, updateRole, deleteRole,
  PERMISSION_CATALOG, SYSTEM_ROLES,
} from '../services/rbac.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let allRoles = [];

/* ─── Render ─────────────────────────────────────────────── */
export async function renderRoles(container) {
  if (!store.can('system_manage_roles') && !store.can('system_manage_users')) {
    container.innerHTML = `
      <div class="empty-state" style="min-height:60vh;">
        <div class="empty-state-icon">🔒</div>
        <div class="empty-state-title">Acesso restrito</div>
        <p class="text-sm text-muted">Você não tem permissão para gerenciar roles.</p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Roles e Permissões</h1>
        <p class="page-subtitle">Defina o que cada cargo pode fazer no sistema</p>
      </div>
      <div class="page-header-actions">
        ${store.can('system_manage_roles') ? `
          <button class="btn btn-primary" id="new-role-btn">+ Novo Role</button>
        ` : ''}
      </div>
    </div>

    <!-- Info banner -->
    <div style="
      display:flex; align-items:flex-start; gap:12px;
      background:rgba(56,189,248,0.08); border:1px solid rgba(56,189,248,0.25);
      border-radius:var(--radius-md); padding:12px 16px; margin-bottom:24px;
      font-size:0.8125rem; color:var(--text-secondary); line-height:1.6;">
      <span style="font-size:1rem;flex-shrink:0;">ℹ</span>
      <span>
        Roles definem o que cada usuário pode fazer. Roles do sistema
        <strong>(Master, Administrador, Gerente, Membro)</strong> não podem ser excluídos.
        Você pode criar roles customizados para cargos específicos da organização.
        Passe o mouse sobre o <strong>ℹ</strong> de cada permissão para entender o que ela libera.
      </span>
    </div>

    <div id="roles-grid" style="display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:20px;">
      ${[0,1,2,3].map(()=>'<div class="card skeleton" style="height:180px;"></div>').join('')}
    </div>
  `;

  document.getElementById('new-role-btn')?.addEventListener('click', () => openRoleModal());
  await loadRoles();
}

async function loadRoles() {
  try {
    allRoles = await fetchRoles();
    renderGrid();
  } catch(e) {
    toast.error('Erro ao carregar roles: ' + e.message);
  }
}

function renderGrid() {
  const grid = document.getElementById('roles-grid');
  if (!grid) return;

  grid.innerHTML = allRoles.map(role => {
    const permCount    = Object.values(role.permissions || {}).filter(Boolean).length;
    const totalPerms   = PERMISSION_CATALOG.flatMap(g => g.permissions).length;
    const isSystem     = role.isSystem;
    const canEdit      = store.can('system_manage_roles') && !isSystem;
    const canDelete    = store.can('system_manage_roles') && !isSystem;

    return `
      <div class="card" style="border-top:3px solid ${esc(role.color||'#6B7280')};">
        <div class="card-header" style="padding-bottom:12px;">
          <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
            <div style="width:12px;height:12px;border-radius:50%;background:${esc(role.color||'#6B7280')};flex-shrink:0;"></div>
            <div style="min-width:0;">
              <div style="font-weight:600;color:var(--text-primary);font-size:0.9375rem;">${esc(role.name)}</div>
              <div style="font-size:0.75rem;color:var(--text-muted);margin-top:1px;">${esc(role.description||'')}</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            ${isSystem ? `<span style="font-size:0.6875rem;padding:2px 8px;border-radius:var(--radius-full);background:rgba(255,255,255,0.06);color:var(--text-muted);border:1px solid var(--border-subtle);">Sistema</span>` : ''}
            ${canEdit ? `<button class="btn btn-ghost btn-icon btn-sm role-edit-btn" data-id="${role.id}" title="Editar">✎</button>` : ''}
            ${canDelete ? `<button class="btn btn-ghost btn-icon btn-sm role-delete-btn" data-id="${role.id}" title="Excluir" style="color:var(--color-danger);">✕</button>` : ''}
          </div>
        </div>
        <div class="card-body" style="padding-top:0;">
          <!-- Permission summary -->
          <div style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
              <span style="font-size:0.8125rem;color:var(--text-muted);">Permissões ativas</span>
              <span style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);">${permCount} / ${totalPerms}</span>
            </div>
            <div style="height:4px;background:var(--bg-elevated);border-radius:2px;overflow:hidden;">
              <div style="height:100%;width:${Math.round(permCount/totalPerms*100)}%;background:${esc(role.color||'#6B7280')};border-radius:2px;"></div>
            </div>
          </div>
          <!-- Group summary -->
          <div style="display:flex;flex-wrap:wrap;gap:5px;">
            ${PERMISSION_CATALOG.map(group => {
              const active = group.permissions.filter(p => role.permissions?.[p.key]).length;
              if (!active) return '';
              return `<span style="font-size:0.6875rem;padding:2px 8px;border-radius:var(--radius-full);
                background:rgba(255,255,255,0.05);border:1px solid var(--border-subtle);color:var(--text-muted);">
                ${esc(group.group)}: ${active}/${group.permissions.length}
              </span>`;
            }).join('')}
          </div>
          <button class="btn btn-ghost btn-sm role-detail-btn" data-id="${role.id}"
            data-editable="${canEdit?'1':'0'}"
            style="margin-top:12px;font-size:0.8125rem;width:100%;justify-content:center;">
            ${canEdit ? '✎ Editar permissões' : 'Ver permissões →'}
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Events
  grid.querySelectorAll('.role-edit-btn').forEach(btn =>
    btn.addEventListener('click', () => openRoleModal(allRoles.find(r => r.id === btn.dataset.id)))
  );
  grid.querySelectorAll('.role-delete-btn').forEach(btn =>
    btn.addEventListener('click', () => confirmDeleteRole(btn.dataset.id))
  );
  grid.querySelectorAll('.role-detail-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      const role = allRoles.find(r => r.id === btn.dataset.id);
      if (btn.dataset.editable === '1') openRoleModal(role);
      else openDetailModal(role);
    })
  );
}

/* ─── Modal: detalhe de permissões ──────────────────────── */
function openDetailModal(role) {
  if (!role) return;
  modal.open({
    title: `Permissões — ${role.name}`,
    size:  'lg',
    content: `
      <div style="display:flex;flex-direction:column;gap:20px;">
        ${PERMISSION_CATALOG.map(group => `
          <div>
            <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;
              color:var(--text-muted);margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border-subtle);">
              ${esc(group.group)}
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${group.permissions.map(p => {
                const active = role.permissions?.[p.key] === true;
                return `
                  <div style="display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:var(--radius-sm);
                    background:${active?'rgba(34,197,94,0.06)':'transparent'};">
                    <span style="font-size:1rem;flex-shrink:0;">${active?'✓':'○'}</span>
                    <span style="font-size:0.875rem;color:${active?'var(--text-primary)':'var(--text-muted)'};">${esc(p.label)}</span>
                    <span title="${esc(p.info)}" style="cursor:help;color:var(--text-muted);font-size:0.75rem;margin-left:auto;">ℹ</span>
                  </div>`;
              }).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `,
    footer: [{ label:'Fechar', class:'btn-secondary', closeOnClick:true }],
  });
}

/* ─── Modal: criar / editar role ─────────────────────────── */
function openRoleModal(role = null) {
  const isEdit = !!role;
  const perms  = role?.permissions || {};

  modal.open({
    title:   isEdit ? `Editar — ${role.name}` : 'Novo Role',
    size:    'lg',
    content: `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
        <div class="form-group" style="grid-column:span 2;">
          <label class="form-label">Nome do role *</label>
          <input type="text" class="form-input" id="role-name"
            value="${esc(role?.name||'')}" placeholder="Ex: Analista de Conteúdo" maxlength="50" />
          <span class="form-error-msg" id="role-name-error"></span>
        </div>
        <div class="form-group" style="grid-column:span 2;">
          <label class="form-label">Descrição</label>
          <input type="text" class="form-input" id="role-desc"
            value="${esc(role?.description||'')}" placeholder="Descreva o que esse cargo faz" maxlength="120" />
        </div>
        <div class="form-group">
          <label class="form-label">Cor de identificação</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${['#A78BFA','#38BDF8','#22C55E','#F59E0B','#EF4444','#F97316','#EC4899','#06B6D4','#6B7280'].map(c=>`
              <div class="color-swatch-btn" data-color="${c}" style="width:28px;height:28px;border-radius:50%;
                background:${c};cursor:pointer;border:3px solid ${(role?.color||'#6B7280')===c?'white':'transparent'};
                box-shadow:${(role?.color||'#6B7280')===c?'0 0 0 2px '+c:'none'};
                transition:all 0.15s;"></div>
            `).join('')}
          </div>
          <input type="hidden" id="role-color" value="${esc(role?.color||'#6B7280')}" />
        </div>
      </div>

      <!-- Permissions -->
      <div style="border-top:1px solid var(--border-subtle);padding-top:16px;">
        <div style="font-size:0.875rem;font-weight:600;color:var(--text-primary);margin-bottom:14px;">
          Permissões
        </div>
        <div style="display:flex;flex-direction:column;gap:18px;">
          ${PERMISSION_CATALOG.map(group => `
            <div>
              <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;
                color:var(--text-muted);margin-bottom:8px;">${esc(group.group)}</div>
              <div style="display:flex;flex-direction:column;gap:4px;">
                ${group.permissions.map(p => `
                  <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:6px 8px;
                    border-radius:var(--radius-sm);transition:background 0.15s;"
                    onmouseover="this.style.background='var(--bg-hover)'"
                    onmouseout="this.style.background=''">
                    <input type="checkbox" class="role-perm-check" data-perm="${p.key}"
                      ${perms[p.key]?'checked':''} style="margin-top:2px;accent-color:var(--brand-gold);" />
                    <div style="flex:1;">
                      <div style="font-size:0.875rem;color:var(--text-secondary);">${esc(p.label)}</div>
                    </div>
                    <span title="${esc(p.info)}" style="cursor:help;color:var(--text-muted);font-size:0.8125rem;flex-shrink:0;" title="${esc(p.info)}">ℹ</span>
                  </label>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `,
    footer: [
      { label:'Cancelar', class:'btn-secondary', closeOnClick:true },
      {
        label: isEdit ? 'Salvar' : 'Criar role',
        class: 'btn-primary', closeOnClick: false,
        onClick: async (_, { close }) => {
          const name  = document.getElementById('role-name')?.value?.trim();
          const errEl = document.getElementById('role-name-error');
          if (!name) { if(errEl) errEl.textContent = 'Nome é obrigatório.'; return; }
          if(errEl) errEl.textContent = '';

          const permissions = {};
          document.querySelectorAll('.role-perm-check').forEach(cb => {
            permissions[cb.dataset.perm] = cb.checked;
          });

          const btn = document.querySelector('.modal-footer .btn-primary');
          if(btn){ btn.classList.add('loading'); btn.disabled=true; }
          try {
            const data = {
              name,
              description: document.getElementById('role-desc')?.value?.trim() || '',
              color:       document.getElementById('role-color')?.value || '#6B7280',
              permissions,
            };
            if (isEdit) {
              await updateRole(role.id, data);
              toast.success('Role atualizado!');
            } else {
              await createRole(data);
              toast.success('Role criado!');
            }
            close();
            await loadRoles();
          } catch(e) { toast.error(e.message); }
          finally { if(btn){ btn.classList.remove('loading'); btn.disabled=false; } }
        },
      },
    ],
  });

  // Color swatches
  setTimeout(() => {
    document.querySelectorAll('.color-swatch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('role-color').value = btn.dataset.color;
        document.querySelectorAll('.color-swatch-btn').forEach(b => {
          b.style.borderColor = 'transparent'; b.style.boxShadow = 'none';
        });
        btn.style.borderColor = 'white';
        btn.style.boxShadow   = `0 0 0 2px ${btn.dataset.color}`;
      });
    });
  }, 50);
}

/* ─── Confirmar exclusão ─────────────────────────────────── */
async function confirmDeleteRole(roleId) {
  const role = allRoles.find(r => r.id === roleId);
  if (!role) return;
  const ok = await modal.confirm({
    title:       `Excluir role "${role.name}"`,
    message:     `Usuários com este role perderão as permissões associadas. Esta ação não pode ser desfeita.`,
    confirmText: 'Excluir', danger: true, icon: '✕',
  });
  if (!ok) return;
  try {
    await deleteRole(roleId);
    toast.success(`Role "${role.name}" excluído.`);
    await loadRoles();
  } catch(e) { toast.error(e.message); }
}
