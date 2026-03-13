/**
 * PRIMETOUR — Users Page
 * Gestão completa de usuários (CRUD)
 */

import {
  collection, getDocs, query, orderBy,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db }          from '../firebase.js';
import { store }       from '../store.js';
import { createUser, updateUserProfile, deactivateUser, reactivateUser } from '../auth/auth.js';
import { toast }       from '../components/toast.js';
import { modal }       from '../components/modal.js';
import { APP_CONFIG }  from '../config.js';

// ─── Setores disponíveis ─────────────────────────────────
const DEPARTMENTS = [
  'BTG',
  'C&P',
  'Célula ICs',
  'Centurion',
  'CEP',
  'Concierge Bradesco',
  'Contabilidade',
  'Eventos',
  'Financeiro',
  'Lazer',
  'Marketing e Comunicação',
  'Operadora',
  'Programa ICs',
  'Projetos',
  'PTS Bradesco',
  'Qualidade',
  'Suppliers',
  'TI',
];

// ─── Estado da página ─────────────────────────────────────
let users = [];
let filteredUsers = [];
let currentPage  = 1;
const PER_PAGE   = APP_CONFIG.itemsPerPage;
let searchTerm   = '';
let filterRole   = '';
let filterStatus = '';
let sortField    = 'name';
let sortDir      = 'asc';

// ─── Render principal ─────────────────────────────────────
export async function renderUsers(container) {
  // Verificar permissão
  if (!store.isAdmin()) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔒</div>
        <div class="empty-state-title">Acesso restrito</div>
        <p class="text-sm text-muted">Apenas administradores podem gerenciar usuários.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Gestão de Usuários</h1>
        <p class="page-subtitle">Gerencie os membros da equipe PRIMETOUR</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-secondary" id="export-users-btn">
          ↓ Exportar
        </button>
        <button class="btn btn-primary" id="new-user-btn">
          + Novo Usuário
        </button>
      </div>
    </div>

    <!-- Banner: redefinição de senha -->
    <div style="
      display:flex; align-items:flex-start; gap:12px;
      background:rgba(212,168,67,0.08);
      border:1px solid rgba(212,168,67,0.3);
      border-radius:var(--radius-md);
      padding:12px 16px;
      margin-bottom:24px;
      font-size:0.8125rem;
      line-height:1.6;
      color:var(--text-secondary);
    ">
      <span style="font-size:1.1rem; flex-shrink:0; margin-top:1px;">🔑</span>
      <div>
        <strong style="color:var(--text-primary);">Redefinição de senha</strong>
        — Para trocar a senha de um usuário, acesse o
        <a href="https://console.firebase.google.com/project/gestor-de-tarefas-primetour/authentication/users"
          target="_blank" rel="noopener"
          style="color:var(--brand-gold); text-decoration:underline;">
          Firebase Console → Authentication → Users
        </a>,
        localize o usuário, clique em <strong>⋮ → Edit user</strong>
        e defina a nova senha diretamente. O botão 🔑 na tabela abre este guia rápido.
      </div>
    </div>

    <!-- Stats -->
    <div id="users-stats" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px;">
      <div class="stat-card skeleton" style="height:96px;"></div>
      <div class="stat-card skeleton" style="height:96px;"></div>
      <div class="stat-card skeleton" style="height:96px;"></div>
      <div class="stat-card skeleton" style="height:96px;"></div>
    </div>

    <!-- Toolbar -->
    <div class="toolbar">
      <div class="toolbar-search">
        <span class="toolbar-search-icon">🔍</span>
        <input
          type="text"
          class="toolbar-search-input"
          placeholder="Buscar por nome ou e-mail..."
          id="users-search"
        />
      </div>
      <div class="toolbar-filter">
        <select class="filter-select" id="filter-role">
          <option value="">Todos os papéis</option>
          <option value="admin">Administrador</option>
          <option value="manager">Gerente</option>
          <option value="member">Membro</option>
        </select>
        <select class="filter-select" id="filter-status">
          <option value="">Todos os status</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
        </select>
      </div>
    </div>

    <!-- Table -->
    <div class="card">
      <div id="users-table-container">
        <div class="empty-state">
          <div class="empty-state-icon">⟳</div>
          <div class="empty-state-title">Carregando usuários...</div>
        </div>
      </div>
    </div>
  `;

  _attachPageEvents();
  await loadUsers();
}

async function loadUsers() {
  try {
    const snap = await getDocs(
      query(collection(db, 'users'), orderBy('name', 'asc'))
    );
    users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    store.set('users', users);
    renderStats();
    applyFilters();
  } catch (err) {
    console.error('Load users error:', err);
    toast.error('Erro ao carregar usuários: ' + err.message);
  }
}

function renderStats() {
  const statsEl = document.getElementById('users-stats');
  if (!statsEl) return;

  const total    = users.length;
  const active   = users.filter(u => u.active).length;
  const admins   = users.filter(u => u.role === 'admin').length;
  const managers = users.filter(u => u.role === 'manager').length;

  statsEl.innerHTML = `
    <div class="stat-card">
      <div class="stat-card-icon" style="background:rgba(212,168,67,0.12); color:var(--brand-gold);">👥</div>
      <div class="stat-card-label">Total de Usuários</div>
      <div class="stat-card-value">${total}</div>
      <div class="stat-card-trend trend-flat">cadastrados</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-icon" style="background:var(--color-success-bg); color:var(--color-success);">✓</div>
      <div class="stat-card-label">Usuários Ativos</div>
      <div class="stat-card-value">${active}</div>
      <div class="stat-card-trend trend-up">${total - active} inativos</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-icon" style="background:rgba(167,139,250,0.12); color:var(--role-admin);">★</div>
      <div class="stat-card-label">Administradores</div>
      <div class="stat-card-value">${admins}</div>
      <div class="stat-card-trend trend-flat">com acesso total</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-icon" style="background:rgba(56,189,248,0.12); color:var(--role-manager);">◈</div>
      <div class="stat-card-label">Gerentes</div>
      <div class="stat-card-value">${managers}</div>
      <div class="stat-card-trend trend-flat">de projetos</div>
    </div>
  `;
}

function applyFilters() {
  let result = [...users];

  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    result = result.filter(u =>
      u.name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.department?.toLowerCase().includes(q)
    );
  }

  if (filterRole)   result = result.filter(u => u.role === filterRole);
  if (filterStatus === 'active')   result = result.filter(u => u.active);
  if (filterStatus === 'inactive') result = result.filter(u => !u.active);

  // Sort
  result.sort((a, b) => {
    let va = a[sortField] || '';
    let vb = b[sortField] || '';
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  filteredUsers = result;
  currentPage   = 1;
  renderTable();
}

function renderTable() {
  const container = document.getElementById('users-table-container');
  if (!container) return;

  if (filteredUsers.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <div class="empty-state-title">Nenhum usuário encontrado</div>
        <p class="text-sm text-muted">Tente ajustar os filtros ou crie um novo usuário.</p>
      </div>
    `;
    return;
  }

  const start   = (currentPage - 1) * PER_PAGE;
  const pageData = filteredUsers.slice(start, start + PER_PAGE);
  const totalPages = Math.ceil(filteredUsers.length / PER_PAGE);

  const sortIcon = (field) => {
    if (sortField !== field) return '<span class="sort-icon">↕</span>';
    return `<span class="sort-icon">${sortDir === 'asc' ? '↑' : '↓'}</span>`;
  };

  container.innerHTML = `
    <div class="data-table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th data-sort="name" class="${sortField === 'name' ? 'sorted' : ''}">
              Nome ${sortIcon('name')}
            </th>
            <th data-sort="email" class="${sortField === 'email' ? 'sorted' : ''}">
              E-mail ${sortIcon('email')}
            </th>
            <th data-sort="role" class="${sortField === 'role' ? 'sorted' : ''}">
              Papel ${sortIcon('role')}
            </th>
            <th data-sort="department">
              Departamento ${sortIcon('department')}
            </th>
            <th>Status</th>
            <th data-sort="lastLogin">Último acesso ${sortIcon('lastLogin')}</th>
            <th class="col-actions">Ações</th>
          </tr>
        </thead>
        <tbody>
          ${pageData.map(user => renderUserRow(user)).join('')}
        </tbody>
      </table>
    </div>

    ${totalPages > 1 ? renderPagination(currentPage, totalPages) : ''}

    <div style="padding:12px 16px; border-top:1px solid var(--border-subtle); font-size:0.8125rem; color:var(--text-muted);">
      Mostrando ${start + 1}–${Math.min(start + PER_PAGE, filteredUsers.length)} de ${filteredUsers.length} usuários
    </div>
  `;

  _attachTableEvents();
}

function renderUserRow(user) {
  const roleConfig  = APP_CONFIG.roles[user.role] || APP_CONFIG.roles.member;
  const initials    = user.name?.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase() || '?';
  const lastLogin   = user.lastLogin?.toDate?.()
    ? formatDate(user.lastLogin.toDate())
    : 'Nunca';

  return `
    <tr data-user-id="${user.id}">
      <td>
        <div class="flex items-center gap-3">
          <div class="avatar avatar-sm" style="background:${user.avatarColor || '#3B82F6'}">
            ${initials}
          </div>
          <div>
            <div style="font-weight:500; color:var(--text-primary);">${escHtml(user.name)}</div>
            ${user.firstLogin ? '<div class="text-xs" style="color:var(--color-warning);">⚠ Primeiro login pendente</div>' : ''}
          </div>
        </div>
      </td>
      <td style="color:var(--text-secondary);">${escHtml(user.email)}</td>
      <td><span class="badge ${roleConfig.badge}">${roleConfig.label}</span></td>
      <td style="color:var(--text-secondary);">${escHtml(user.department || '—')}</td>
      <td>
        <span class="badge ${user.active ? 'badge-success' : 'badge-danger'}">
          ${user.active ? '● Ativo' : '● Inativo'}
        </span>
      </td>
      <td style="color:var(--text-muted); font-size:0.8125rem;">${lastLogin}</td>
      <td class="col-actions">
        <div class="actions-group">
          <button class="btn btn-ghost btn-icon btn-sm" data-action="edit" data-uid="${user.id}" title="Editar">
            ✎
          </button>
          <button class="btn btn-ghost btn-icon btn-sm" data-action="reset-password" data-uid="${user.id}" title="Redefinir senha">
            🔑
          </button>
          ${user.active
            ? `<button class="btn btn-ghost btn-icon btn-sm" data-action="deactivate" data-uid="${user.id}" title="Desativar">⊘</button>`
            : `<button class="btn btn-success btn-icon btn-sm" data-action="activate" data-uid="${user.id}" title="Reativar">✓</button>`
          }
        </div>
      </td>
    </tr>
  `;
}

function renderPagination(current, total) {
  const pages = [];
  pages.push(`<button class="pagination-btn" data-page="${current - 1}" ${current === 1 ? 'disabled' : ''}>←</button>`);

  for (let i = 1; i <= total; i++) {
    if (total <= 7 || i === 1 || i === total || (i >= current - 1 && i <= current + 1)) {
      pages.push(`<button class="pagination-btn ${i === current ? 'active' : ''}" data-page="${i}">${i}</button>`);
    } else if (i === current - 2 || i === current + 2) {
      pages.push(`<span class="pagination-btn" style="pointer-events:none;">…</span>`);
    }
  }

  pages.push(`<button class="pagination-btn" data-page="${current + 1}" ${current === total ? 'disabled' : ''}>→</button>`);

  return `<div class="pagination" style="padding:12px 0;">${pages.join('')}</div>`;
}

// ─── Modal: Criar / Editar Usuário ────────────────────────
function openUserModal(userId = null) {
  const user = userId ? users.find(u => u.id === userId) : null;
  const isEdit = !!user;
  const title = isEdit ? 'Editar Usuário' : 'Novo Usuário';

  const content = `
    <form id="user-form" novalidate>
      <div class="form-group">
        <label class="form-label">Nome completo *</label>
        <input type="text" class="form-input" id="uf-name"
          value="${escHtml(user?.name || '')}"
          placeholder="João Silva"
          required maxlength="100"
        />
        <span class="form-error-msg" id="uf-name-error"></span>
      </div>

      <div class="form-group">
        <label class="form-label">E-mail *</label>
        <input type="email" class="form-input" id="uf-email"
          value="${escHtml(user?.email || '')}"
          placeholder="joao@primetour.com.br"
          ${isEdit ? 'disabled style="opacity:0.6;"' : ''}
          required
        />
        <span class="form-error-msg" id="uf-email-error"></span>
        ${isEdit ? '<span class="form-hint">E-mail não pode ser alterado.</span>' : ''}
      </div>

      ${!isEdit ? `
        <div class="form-group">
          <label class="form-label">Senha temporária *</label>
          <div class="form-input-wrapper">
            <input type="password" class="form-input has-icon-right" id="uf-password"
              placeholder="Mínimo 6 caracteres"
              required minlength="6"
            />
            <button type="button" class="form-input-icon-right" id="uf-toggle-pw">👁</button>
          </div>
          <span class="form-error-msg" id="uf-password-error"></span>
          <span class="form-hint">O usuário deverá trocar a senha no primeiro acesso.</span>
        </div>
      ` : ''}

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div class="form-group">
          <label class="form-label">Papel *</label>
          <select class="form-select" id="uf-role" required>
            <option value="member"  ${user?.role === 'member'  ? 'selected' : ''}>Membro</option>
            <option value="manager" ${user?.role === 'manager' ? 'selected' : ''}>Gerente</option>
            <option value="admin"   ${user?.role === 'admin'   ? 'selected' : ''}>Administrador</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Setor</label>
          <select class="form-select" id="uf-department" size="1">
            <option value="">— Selecione o setor —</option>
            ${DEPARTMENTS.map(d =>
              `<option value="${d}" ${(user?.department||'')=== d?'selected':''}>${d}</option>`
            ).join('')}
          </select>
        </div>
      </div>

      ${isEdit ? `
        <div class="form-group">
          <label class="form-label flex items-center gap-3">
            Status da conta
            <label class="toggle-switch" style="margin-left:auto;">
              <input type="checkbox" id="uf-active" ${user?.active ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </label>
          <span class="form-hint">Desativar bloqueia o acesso mas mantém os dados.</span>
        </div>
      ` : ''}
    </form>
  `;

  const modalInstance = modal.open({
    title,
    content,
    footer: [
      { label: 'Cancelar', class: 'btn-secondary', closeOnClick: true },
      {
        label: isEdit ? 'Salvar alterações' : 'Criar usuário',
        class: 'btn-primary',
        closeOnClick: false,
        onClick: async (e, { close }) => {
          await handleUserSave(userId, isEdit, close);
        }
      },
    ]
  });

  // Toggle password visibility
  setTimeout(() => {
    const toggleBtn = document.getElementById('uf-toggle-pw');
    const pwInput   = document.getElementById('uf-password');
    if (toggleBtn && pwInput) {
      toggleBtn.addEventListener('click', () => {
        pwInput.type = pwInput.type === 'text' ? 'password' : 'text';
        toggleBtn.textContent = pwInput.type === 'text' ? '🙈' : '👁';
      });
    }
  }, 50);
}

async function handleUserSave(userId, isEdit, closeModal) {
  const name       = document.getElementById('uf-name')?.value?.trim();
  const email      = document.getElementById('uf-email')?.value?.trim();
  const password   = document.getElementById('uf-password')?.value;
  const role       = document.getElementById('uf-role')?.value;
  const department = document.getElementById('uf-department')?.value?.trim();
  const active     = document.getElementById('uf-active')?.checked ?? true;

  // Validation
  let valid = true;
  const setErr = (id, msg) => {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
    valid = false;
  };
  const clearErr = (id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  };

  clearErr('uf-name-error');
  clearErr('uf-email-error');
  if (!isEdit) clearErr('uf-password-error');

  if (!name || name.length < 2) setErr('uf-name-error', 'Nome deve ter ao menos 2 caracteres.');
  if (!isEdit && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    setErr('uf-email-error', 'E-mail inválido.');
  }
  if (!isEdit && (!password || password.length < 6)) {
    setErr('uf-password-error', 'Senha deve ter ao menos 6 caracteres.');
  }

  if (!valid) return;

  // Submit
  const submitBtn = document.querySelector('.modal-footer .btn-primary');
  if (submitBtn) {
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
  }

  try {
    if (isEdit) {
      await updateUserProfile(userId, { name, role, department, active });
      toast.success(`Usuário "${name}" atualizado com sucesso!`);
    } else {
      await createUser({ name, email, password, role, department });
      toast.success(`Usuário "${name}" criado com sucesso!`);
    }
    closeModal();
    await loadUsers();
  } catch (err) {
    toast.error(err.message || 'Erro ao salvar usuário.');
    console.error(err);
  } finally {
    if (submitBtn) {
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
    }
  }
}

// ─── Modal: Guia de redefinição de senha ──────────────────
function openResetPasswordModal(uid, user) {
  const projectId = 'gestor-de-tarefas-primetour';
  const authUrl   = `https://console.firebase.google.com/project/${projectId}/authentication/users`;

  modal.open({
    title:   `Redefinir senha — ${escHtml(user.name)}`,
    size:    'sm',
    content: `
      <div style="text-align:center; padding:8px 0 20px;">
        <div style="font-size:2.5rem; margin-bottom:12px;">🔑</div>
        <p style="color:var(--text-secondary); font-size:0.875rem; line-height:1.7; margin-bottom:20px;">
          A redefinição de senha é feita diretamente no <strong>Firebase Console</strong>.
          Siga os passos abaixo:
        </p>
      </div>

      <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:20px;">
        ${[
          ['1', 'Clique no botão abaixo para abrir o Firebase Console'],
          ['2', 'Localize <strong>' + escHtml(user.name) + '</strong> na lista de usuários'],
          ['3', 'Clique no ícone <strong>⋮</strong> à direita do usuário'],
          ['4', 'Selecione <strong>Edit user</strong>'],
          ['5', 'Digite a nova senha no campo <strong>Password</strong>'],
          ['6', 'Clique em <strong>Save</strong>'],
        ].map(([n, text]) => `
          <div style="display:flex; align-items:flex-start; gap:10px;">
            <div style="
              width:24px; height:24px; border-radius:50%;
              background:var(--brand-gold); color:var(--text-inverse);
              font-size:0.75rem; font-weight:700;
              display:flex; align-items:center; justify-content:center;
              flex-shrink:0; margin-top:1px;
            ">${n}</div>
            <div style="font-size:0.875rem; color:var(--text-secondary); line-height:1.5; padding-top:3px;">
              ${text}
            </div>
          </div>
        `).join('')}
      </div>

      <a href="${authUrl}" target="_blank" rel="noopener"
        style="
          display:block; text-align:center;
          background:var(--brand-gold); color:var(--text-inverse);
          padding:10px 16px; border-radius:var(--radius-md);
          font-size:0.875rem; font-weight:600;
          text-decoration:none;
        ">
        Abrir Firebase Console →
      </a>
    `,
    footer: [
      { label: 'Fechar', class: 'btn-secondary', closeOnClick: true },
    ],
  });
}

// ─── Attach events ────────────────────────────────────────
function _attachPageEvents() {
  // New user button
  document.getElementById('new-user-btn')?.addEventListener('click', () => openUserModal());

  // Export
  document.getElementById('export-users-btn')?.addEventListener('click', () => exportUsers());

  // Search
  const searchEl = document.getElementById('users-search');
  if (searchEl) {
    let timer;
    searchEl.addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        searchTerm = e.target.value;
        applyFilters();
      }, 300);
    });
  }

  // Filters
  document.getElementById('filter-role')?.addEventListener('change', (e) => {
    filterRole = e.target.value;
    applyFilters();
  });

  document.getElementById('filter-status')?.addEventListener('change', (e) => {
    filterStatus = e.target.value;
    applyFilters();
  });
}

function _attachTableEvents() {
  // Sort headers
  document.querySelectorAll('.data-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (sortField === field) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortField = field;
        sortDir = 'asc';
      }
      applyFilters();
    });
  });

  // Row actions
  document.querySelectorAll('[data-action][data-uid]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      const uid    = btn.dataset.uid;
      const user   = users.find(u => u.id === uid);
      if (!user) return;

      switch (action) {
        case 'edit':
          openUserModal(uid);
          break;
        case 'reset-password':
          openResetPasswordModal(uid, user);
          break;
        case 'deactivate':
          if (await modal.confirm({
            title:       'Desativar usuário',
            message:     `Tem certeza que deseja desativar a conta de <strong>${escHtml(user.name)}</strong>?<br>O usuário perderá o acesso imediatamente.`,
            confirmText: 'Desativar',
            danger:      true,
            icon:        '⚠️',
          })) {
            try {
              await deactivateUser(uid);
              toast.success(`Usuário "${user.name}" desativado.`);
              await loadUsers();
            } catch (err) {
              toast.error(err.message);
            }
          }
          break;
        case 'activate':
          if (await modal.confirm({
            title:       'Reativar usuário',
            message:     `Reativar a conta de <strong>${escHtml(user.name)}</strong>?`,
            confirmText: 'Reativar',
            icon:        '✅',
          })) {
            try {
              await reactivateUser(uid);
              toast.success(`Usuário "${user.name}" reativado.`);
              await loadUsers();
            } catch (err) {
              toast.error(err.message);
            }
          }
          break;
      }
    });
  });

  // Pagination
  document.querySelectorAll('.pagination-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = parseInt(btn.dataset.page);
      const maxPage = Math.ceil(filteredUsers.length / PER_PAGE);
      if (page < 1 || page > maxPage) return;
      currentPage = page;
      renderTable();
    });
  });
}

// ─── Export CSV ───────────────────────────────────────────
function exportUsers() {
  const headers = ['Nome', 'E-mail', 'Papel', 'Departamento', 'Status', 'Criado em'];
  const rows = filteredUsers.map(u => [
    u.name,
    u.email,
    APP_CONFIG.roles[u.role]?.label || u.role,
    u.department || '',
    u.active ? 'Ativo' : 'Inativo',
    u.createdAt?.toDate?.() ? formatDate(u.createdAt.toDate()) : '',
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `usuarios_primetour_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success('Relatório de usuários exportado!');
}

// ─── Helpers ──────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

function formatDate(date) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(date);
}
