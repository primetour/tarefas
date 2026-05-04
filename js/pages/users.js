/**
 * PRIMETOUR — Users Page
 * Gestão completa de usuários (CRUD)
 */

import { store }       from '../store.js';
import { createUser, updateUserProfile, deactivateUser, reactivateUser, getErrorMessage } from '../auth/auth.js';
import { REQUESTING_AREAS } from '../services/tasks.js';
import { userNucleos } from '../services/sectors.js';
import { fetchRoles } from '../services/rbac.js';
import { toast }       from '../components/toast.js';
import { modal }       from '../components/modal.js';
import { APP_CONFIG, isAllowedSSODomain, ALLOWED_SSO_DOMAINS }  from '../config.js';

// ─── Roles (carregado dinamicamente) ────────────────────────
let availableRoles = [];

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
]; // mantido por compatibilidade — usar REQUESTING_AREAS como setores

// ─── Estado da página ─────────────────────────────────────
let users = [];
let filteredUsers = [];
let currentPage  = 1;
const PER_PAGE   = APP_CONFIG.itemsPerPage;
let searchTerm   = '';
let filterRole   = '';
let filterStatus = '';
let filterSector = '';   // GAP fix
let sortField    = 'name';
let sortDir      = 'asc';

// ─── Render principal ─────────────────────────────────────
export async function renderUsers(container) {
  // Verificar permissão
  if (!store.can('system_manage_users')) {
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
      <div class="page-header-actions" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <!-- Split-button Export — antes só "Exportar" genérico, agora especifica formato -->
        <div class="uikit-export-wrap" style="position:relative;display:inline-block;">
          <button class="btn btn-secondary uikit-export-trigger" data-export-trigger="1"
            style="display:flex;align-items:center;gap:6px;padding:6px 12px;">
            <span>↓</span><span>Exportar</span><span style="font-size:0.6em;">▾</span>
          </button>
          <div class="uikit-export-menu" style="display:none;position:absolute;top:100%;right:0;margin-top:4px;
            background:var(--bg-card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:8px;
            min-width:180px;box-shadow:0 4px 12px rgba(0,0,0,0.1);z-index:100;padding:4px;">
            <button class="uikit-export-item" id="export-users-btn"
              style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 12px;
              background:transparent;border:none;cursor:pointer;font-size:0.875rem;color:var(--text-primary);
              border-radius:6px;font-family:inherit;">
              <span style="font-size:0.7em;color:var(--text-muted);">↓</span><span>Excel (.xlsx)</span>
            </button>
          </div>
        </div>
        <button class="btn btn-primary" id="new-user-btn"
          title="Pré-cadastra usuário com role/setor. Se for email SSO, ativa
            automaticamente no 1º login Microsoft. Se for email externo,
            cria conta com senha temporária.">
          + Novo Usuário
        </button>
      </div>
    </div>

    <!-- Banner: como funciona o login (resposta única ao "Novo Usuário") -->
    <details style="margin-bottom:20px;border:1px solid var(--border-subtle);
      border-radius:var(--radius-md);background:var(--bg-surface);">
      <summary style="cursor:pointer;padding:12px 16px;font-size:0.875rem;
        font-weight:500;color:var(--text-primary);user-select:none;">
        ℹ Como funciona o login no PRIMETOUR? (clique para expandir)
      </summary>
      <div style="padding:0 16px 16px;font-size:0.8125rem;line-height:1.6;color:var(--text-secondary);">
        <p style="margin-top:8px;"><strong style="color:var(--text-primary);">3 modos de entrada:</strong></p>
        <ol style="margin:8px 0 0;padding-left:20px;">
          <li style="margin-bottom:8px;"><strong>SSO Microsoft (padrão)</strong> — emails dos
            domínios <code>@primetour.com.br</code>, <code>@primetravel.tur.br</code>,
            <code>@primetouroperator.com.br</code>. Usuário clica em
            <em>"Entrar com Microsoft"</em> e a conta é ativada automaticamente.
            Pré-cadastrar aqui (botão "Novo Usuário") só serve pra <strong>definir
            role/setor antes</strong> do 1º login — não cria credencial Auth.</li>
          <li style="margin-bottom:8px;"><strong>Email/senha (externos)</strong> — clientes,
            freelancers, parceiros sem Microsoft. Ao cadastrar com email <strong>fora dos
            domínios SSO</strong>, o sistema pede uma senha temporária.</li>
          <li style="margin-bottom:8px;"><strong>Login emergencial (admin)</strong> —
            escondido por padrão. Pra ativar, abra DevTools no console e rode:
            <code style="background:var(--bg-elevated);padding:2px 6px;border-radius:4px;font-size:0.75rem;">
              localStorage.setItem('emergency-pwd-login','1')
            </code>, recarregue. Aparece formulário escondido pra
            <code>admin@primetour.com.br</code> e similares.</li>
        </ol>
        <p style="margin-top:12px;color:var(--text-muted);">
          <strong>Reset de senha</strong> (só usuários não-SSO):
          <a href="https://console.firebase.google.com/project/gestor-de-tarefas-primetour/authentication/users"
            target="_blank" rel="noopener"
            style="color:var(--brand-gold); text-decoration:underline;">Firebase Console</a>
          → localize → ⋮ → Edit user. O botão 🔑 na tabela abre este guia.
        </p>
      </div>
    </details>

    <!-- Banner de migração SSO em massa: aparece apenas quando há usuários
         presos no bug antigo (criados pelo admin com senha em domínio SSO).
         Renderizado em loadUsers() depois que sabemos a contagem real. -->
    <div id="sso-migrate-banner" style="display:none;"></div>

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
          <option value="">Todos os cargos</option>
          ${availableRoles.map(r =>
            `<option value="${r.id}">${r.name}</option>`
          ).join('')}
        </select>
        <!-- GAP fix: filtro por SETOR (era impossível agrupar usuários por área) -->
        <select class="filter-select" id="filter-sector">
          <option value="">Todos os setores</option>
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
    const { fetchUsers, invalidateUsersCache } = await import('../services/users.js');
    // Página de admin: invalida cache para garantir lista fresca após CRUD
    invalidateUsersCache();
    const [list, roles] = await Promise.all([
      fetchUsers({ force: true }),
      fetchRoles().catch(() => []),
    ]);
    users = list;

    // Merge SYSTEM_ROLES as fallback so new roles appear even before Firestore sync
    const { SYSTEM_ROLES } = await import('../services/rbac.js');
    const roleIds = new Set(roles.map(r => r.id));
    const merged  = [...roles, ...SYSTEM_ROLES.filter(r => !roleIds.has(r.id))];
    availableRoles = merged;
    store.set('users', users);
    store.set('roles', merged);
    renderStats();
    renderSsoMigrateBanner();
    applyFilters();
    // Rebuild role filter with dynamic roles after load
    const filterRoleEl = document.getElementById('filter-role');
    if (filterRoleEl) {
      filterRoleEl.innerHTML = '<option value="">Todos os cargos</option>' +
        availableRoles.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
    }
  } catch (err) {
    console.error('Load users error:', err);
    toast.error('Erro ao carregar usuários: ' + err.message);
  }
}

/**
 * Banner de migração SSO em massa.
 * Aparece SÓ quando há usuários presos no bug antigo:
 *   - email é de domínio SSO autorizado
 *   - foi criado pelo admin (createdBy != 'sso-microsoft')
 *   - nunca logou (lastLogin == null)
 *   - não está em estado pendente já (pendingSso !== true)
 * Esses são exatamente os usuários que tentam SSO Microsoft e batem
 * em "senha incorreta" porque o Firebase Auth tem credencial email/senha
 * registrada com a senha temporária definida pelo admin.
 */
function renderSsoMigrateBanner() {
  const banner = document.getElementById('sso-migrate-banner');
  if (!banner) return;

  const blocked = users.filter(u =>
    isAllowedSSODomain(u.email)
    && u.createdBy && u.createdBy !== 'sso-microsoft'
    && !u.lastLogin
    && !u.pendingSso
  );

  if (!blocked.length) {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }

  banner.style.display = 'block';
  banner.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:14px;
      background:rgba(245,158,11,0.10);border:1px solid rgba(245,158,11,0.35);
      border-radius:var(--radius-md);padding:14px 18px;margin-bottom:24px;
      font-size:0.875rem;line-height:1.5;color:var(--text-primary);">
      <span style="font-size:1.4rem;flex-shrink:0;line-height:1;">⚠</span>
      <div style="flex:1;min-width:0;">
        <strong style="color:#F59E0B;">${blocked.length} usuário${blocked.length>1?'s':''} preso${blocked.length>1?'s':''} no bug SSO antigo</strong>
        <p style="margin:6px 0 0;color:var(--text-secondary);font-size:0.8125rem;">
          Esses foram cadastrados com senha temporária quando o SSO ainda
          não estava funcionando direito. Hoje, ao clicar em "Entrar com
          Microsoft", o sistema diz <em>"senha incorreta"</em> porque a
          credencial de senha bloqueia o SSO. Posso liberar todos de uma vez
          — o perfil (role, setor, núcleos) é preservado.
        </p>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-warning btn-sm" id="bulk-migrate-sso-btn"
            style="background:#F59E0B;color:#fff;border:none;">
            ⇄ Liberar SSO de todos os ${blocked.length}
          </button>
          <button class="btn btn-ghost btn-sm" id="show-blocked-list-btn"
            style="font-size:0.75rem;">
            Ver lista
          </button>
        </div>
        <div id="blocked-list" style="display:none;margin-top:12px;padding:10px;
          background:var(--bg-surface);border-radius:var(--radius-sm);
          font-size:0.75rem;color:var(--text-muted);max-height:160px;overflow:auto;">
          ${blocked.map(u => `<div>• ${escHtml(u.name)} <span style="opacity:0.6;">${escHtml(u.email)}</span></div>`).join('')}
        </div>
      </div>
    </div>
  `;

  document.getElementById('show-blocked-list-btn')?.addEventListener('click', () => {
    const list = document.getElementById('blocked-list');
    if (list) list.style.display = list.style.display === 'none' ? 'block' : 'none';
  });

  document.getElementById('bulk-migrate-sso-btn')?.addEventListener('click', async () => {
    const ok = await modal.confirm({
      title:   `Liberar SSO de ${blocked.length} usuários`,
      message: `<div style="font-size:0.875rem;line-height:1.5;">
        <p>Vou apagar a credencial email/senha de <strong>${blocked.length} usuários</strong>
        no Firebase Auth. Os perfis (role, setor, núcleos) serão preservados.</p>
        <p style="margin-top:8px;color:var(--text-muted);">A lista:</p>
        <ul style="margin:6px 0 0;padding-left:20px;font-size:0.75rem;color:var(--text-muted);max-height:200px;overflow:auto;">
          ${blocked.map(u => `<li>${escHtml(u.name)} (${escHtml(u.email)})</li>`).join('')}
        </ul>
      </div>`,
      confirmText: 'Liberar todos',
      danger: false,
      icon: '⇄',
    });
    if (!ok) return;

    const btn = document.getElementById('bulk-migrate-sso-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⟳ Migrando...'; }

    try {
      const { app } = await import('../firebase.js');
      const fb = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
      const fn = fb.httpsCallable(fb.getFunctions(app, 'us-central1'), 'migrateUserToSso');

      let succeeded = 0;
      let failed = 0;
      // Sequencial pra não estourar o quota do Auth Admin SDK
      for (const u of blocked) {
        try {
          await fn({ email: u.email });
          succeeded++;
        } catch (e) {
          console.error(`Falha em ${u.email}:`, e);
          failed++;
        }
      }

      if (failed === 0) {
        toast.success(`✓ ${succeeded} usuários migrados! Eles já podem entrar via Microsoft.`);
      } else {
        toast.warning(`${succeeded} OK · ${failed} falhas — veja o console.`);
      }
      await loadUsers();
    } catch (err) {
      toast.error('Falha na migração em massa: ' + err.message);
    }
  });
}

function renderStats() {
  const statsEl = document.getElementById('users-stats');
  if (!statsEl) return;

  const total       = users.length;
  const active      = users.filter(u => u.active).length;

  // Count by roleId (new) falling back to role (legacy)
  const countRole   = id => users.filter(u => (u.roleId||u.role) === id).length;
  const heads       = countRole('admin');
  const managers    = countRole('manager') + countRole('coordinator');

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
      <div class="stat-card-label">Heads</div>
      <div class="stat-card-value">${heads}</div>
      <div class="stat-card-trend trend-flat">acesso ampliado</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-icon" style="background:rgba(56,189,248,0.12); color:var(--role-manager);">◈</div>
      <div class="stat-card-label">Gerentes / Coord.</div>
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

  if (filterRole)   result = result.filter(u => (u.roleId||u.role) === filterRole);
  if (filterSector) result = result.filter(u => u.sector === filterSector);
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
              Núcleos ${sortIcon('department')}
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
  const roleConfig  = availableRoles.find(r => r.id === (user.roleId||user.role))
    || { name: user.role, color: '#6B7280' };
  const initials    = user.name?.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase() || '?';
  const lastLogin   = user.lastLogin?.toDate?.()
    ? formatDate(user.lastLogin.toDate())
    : 'Nunca';

  // Detecta usuário "preso" no bug SSO antigo:
  //   - email é de domínio SSO autorizado
  //   - foi criado pelo admin (createdBy != 'sso-microsoft')
  //   - NUNCA logou (sintoma claro: tentou SSO e foi bloqueado pela credencial)
  const isSsoBlocked = isAllowedSSODomain(user.email)
    && user.createdBy && user.createdBy !== 'sso-microsoft'
    && !user.lastLogin
    && !user.pendingSso;

  // Pendente de primeiro login SSO (já criado corretamente, esperando user)
  const isPendingSso = user.pendingSso === true;

  return `
    <tr data-user-id="${user.id}">
      <td>
        <div class="flex items-center gap-3">
          <div class="avatar avatar-sm" style="background:${user.avatarColor || '#3B82F6'}">
            ${initials}
          </div>
          <div>
            <div style="font-weight:500; color:var(--text-primary);">${escHtml(user.name)}</div>
            ${isSsoBlocked ? `<div style="font-size:0.6875rem;color:#F59E0B;margin-top:2px;">
              ⚠ SSO bloqueado · clique em ⇄ para liberar
            </div>` : ''}
            ${isPendingSso ? `<div style="font-size:0.6875rem;color:#22C55E;margin-top:2px;">
              ⏳ Aguardando 1º login Microsoft
            </div>` : ''}
          </div>
        </div>
      </td>
      <td style="color:var(--text-secondary);">${escHtml(user.email)}</td>
      <td><span class="badge" style="background:${roleConfig?.color||'#6B7280'}22;color:${roleConfig?.color||'#6B7280'};border:1px solid ${roleConfig?.color||'#6B7280'}44;">
        ${escHtml(roleConfig?.name || roleConfig?.label || user.role || '—')}
      </span></td>
      <td style="color:var(--text-secondary);">${escHtml(userNucleos(user).join(', ') || user.sector || user.department || '—')}</td>
      <td>
        <span class="badge ${user.active ? 'badge-success' : 'badge-danger'}">
          ${user.active ? '● Ativo' : '● Inativo'}
        </span>
      </td>
      <td style="color:var(--text-muted); font-size:0.8125rem;">${lastLogin}</td>
      <td class="col-actions">
        <div class="actions-group">
          ${isSsoBlocked ? `
            <button class="btn btn-ghost btn-icon btn-sm" data-action="migrate-sso" data-uid="${user.id}"
              data-email="${escHtml(user.email)}" title="Liberar SSO Microsoft (apaga senha legada)"
              style="color:#F59E0B;">⇄</button>
          ` : ''}
          <button class="btn btn-ghost btn-icon btn-sm" data-action="edit" data-uid="${user.id}" title="Editar">
            ✎
          </button>
          ${!isPendingSso && !isSsoBlocked ? `
            <button class="btn btn-ghost btn-icon btn-sm" data-action="reset-password" data-uid="${user.id}" title="Redefinir senha">
              🔑
            </button>
          ` : ''}
          ${user.active
            ? `<button class="btn btn-ghost btn-icon btn-sm" data-action="deactivate" data-uid="${user.id}" title="Desativar">⊘</button>`
            : `<button class="btn btn-success btn-icon btn-sm" data-action="activate" data-uid="${user.id}" title="Reativar">✓</button>`
          }
          <button class="btn btn-ghost btn-icon btn-sm" data-action="delete" data-uid="${user.id}"
            title="Excluir permanentemente" style="color:#EF4444;">🗑</button>
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
        <!-- Aviso SSO: aparece quando o email digitado é de domínio corporativo.
             Some quando é email externo (cliente/freela) — daí mostra senha. -->
        <div id="uf-sso-banner" style="display:none;margin-bottom:12px;padding:12px 14px;
          border-radius:var(--radius-md);background:rgba(34,197,94,0.08);
          border:1px solid rgba(34,197,94,0.25);font-size:0.8125rem;color:var(--text-primary);">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:1.1em;">🔒</span>
            <strong>Conta SSO Microsoft</strong>
          </div>
          <p style="margin:6px 0 0;color:var(--text-secondary);font-size:0.75rem;line-height:1.4;">
            Esse email pertence a um domínio corporativo. <strong>Não precisa criar senha</strong> —
            o usuário entrará pela primeira vez clicando em <em>"Entrar com Microsoft"</em> e a conta
            será ativada automaticamente com a role e setor que você definir aqui.
          </p>
        </div>

        <div class="form-group" id="uf-password-group">
          <label class="form-label">Senha temporária *</label>
          <div class="form-input-wrapper">
            <input type="password" class="form-input has-icon-right" id="uf-password"
              placeholder="Mínimo 6 caracteres"
              minlength="6"
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
            ${availableRoles.map(r =>
              `<option value="${r.id}" ${(user?.roleId||user?.role)===r.id?'selected':''}
                style="color:${r.color||'inherit'};">
                ${escHtml(r.name)}
              </option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Setor *</label>
          <select class="form-select" id="uf-department" size="1">
            <option value="">— Selecione o setor —</option>
            ${REQUESTING_AREAS.map(d =>
              `<option value="${d}" ${(user?.sector||user?.department||'')=== d?'selected':''}>${d}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Núcleos <span style="font-weight:400;color:var(--text-muted);">(pode participar de mais de um)</span></label>
          <div id="uf-nucleos-picker" data-selected="${escHtml(JSON.stringify(userNucleos(user)))}"
            style="display:flex;flex-wrap:wrap;gap:6px;padding:8px;min-height:40px;
            border:1px solid var(--border-subtle);border-radius:var(--radius-md);background:var(--bg-elevated);">
            ${renderNucleoChips(user?.sector || '', userNucleos(user))}
          </div>
          <span class="form-hint" style="font-size:0.7rem;color:var(--text-muted);">
            Só núcleos do setor selecionado aparecem. Clique para adicionar/remover.
          </span>
        </div>
      </div>

      ${store.isMaster() ? `
        <div class="form-group" style="grid-column:span 2;">
          <label class="form-label">
            Setores visíveis (Head)
            <span title="Defina quais setores este Head pode visualizar. Deixe vazio para ver apenas o próprio setor."
              style="cursor:help;color:var(--text-muted);font-size:0.75rem;">ℹ</span>
          </label>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${REQUESTING_AREAS.map(s => {
              const sel = (user?.visibleSectors||[]).includes(s);
              return '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;padding:4px 10px;' +
                'border-radius:var(--radius-full);font-size:0.8125rem;' +
                'border:1px solid ' + (sel?'var(--brand-gold)':'var(--border-subtle)') + ';' +
                'background:' + (sel?'rgba(212,168,67,0.12)':'var(--bg-surface)') + ';' +
                'color:' + (sel?'var(--brand-gold)':'var(--text-secondary)') + ';' +
                'transition:all 0.15s;" class="sector-vis-chip">' +
                '<input type="checkbox" value="' + s + '" class="sector-vis-cb" ' + (sel?'checked':'') + ' style="display:none;" />' +
                escHtml(s) +
                '</label>';
            }).join('')}
          </div>
        </div>
      ` : ''}

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

  // Sector visibility chips
  setTimeout(() => {
    document.querySelectorAll('.sector-vis-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const cb = chip.querySelector('.sector-vis-cb');
        if (!cb) return;
        cb.checked = !cb.checked;
        chip.style.borderColor = cb.checked ? 'var(--brand-gold)' : 'var(--border-subtle)';
        chip.style.background  = cb.checked ? 'rgba(212,168,67,0.12)' : 'var(--bg-surface)';
        chip.style.color       = cb.checked ? 'var(--brand-gold)' : 'var(--text-secondary)';
      });
    });
  }, 60);

  // Cascata Setor → Núcleos: quando o setor muda, zera a seleção e re-renderiza
  // os chips filtrados pelo novo setor. Wire inicial dos chips também aqui.
  setTimeout(() => {
    const setorSel = document.getElementById('uf-department');
    if (!setorSel) return;
    wireNucleoChips(setorSel.value);
    setorSel.addEventListener('change', () => {
      writeSelectedNucleos(setorSel.value, []); // troca de setor → zera núcleos
    });
  }, 60);

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

    // Detector dinâmico de domínio SSO no campo email.
    // Se o email digitado é de domínio corporativo → esconde o campo senha
    // e mostra o banner explicando que o user entrará via Microsoft. Isso
    // evita o bug "senha incorreta no SSO" reportado pelos usuários, que
    // era causado pela criação de credencial email/senha pra usuários SSO.
    const emailInput = document.getElementById('uf-email');
    const ssoBanner  = document.getElementById('uf-sso-banner');
    const pwGroup    = document.getElementById('uf-password-group');
    if (emailInput && ssoBanner && pwGroup) {
      const updateSsoVisibility = () => {
        const isSso = isAllowedSSODomain(emailInput.value);
        ssoBanner.style.display = isSso ? 'block' : 'none';
        pwGroup.style.display   = isSso ? 'none'  : 'block';
        // Tira required do password quando é SSO pra não bloquear submit
        const pw = document.getElementById('uf-password');
        if (pw) {
          if (isSso) pw.removeAttribute('required');
          else       pw.setAttribute('required', '');
        }
      };
      emailInput.addEventListener('input', updateSsoVisibility);
      // Também roda na carga (caso o admin cole um email no input já populado)
      updateSsoVisibility();
    }
  }, 50);
}

/**
 * Renderiza os chips multi-select de núcleo, filtrados pelo setor dado.
 * Setor vazio → mostra placeholder. Os selecionados ficam ativos (border gold).
 * Ao clicar, alterna o selecionado — a fonte da verdade fica no data-selected
 * do container (JSON array) pra sobreviver a re-renderizações do picker.
 */
function renderNucleoChips(sector, selectedNames) {
  const all = store.get('nucleos') || [];
  const list = sector ? all.filter(n => n.sector === sector) : [];
  if (!sector) {
    return `<span style="font-size:0.75rem;color:var(--text-muted);padding:4px;">
      Selecione o setor primeiro.
    </span>`;
  }
  if (!list.length) {
    return `<span style="font-size:0.75rem;color:var(--text-muted);padding:4px;">
      Nenhum núcleo cadastrado neste setor.
    </span>`;
  }
  const sel = new Set(selectedNames || []);
  return list.map(n => {
    const isSel = sel.has(n.name);
    return `<span class="uf-nuc-chip" data-name="${escHtml(n.name)}" style="
      display:inline-flex;align-items:center;gap:6px;padding:4px 10px;
      border-radius:var(--radius-full);font-size:0.8125rem;cursor:pointer;
      border:1px solid ${isSel ? (n.color||'var(--brand-gold)') : 'var(--border-subtle)'};
      background:${isSel ? (n.color||'#6B7280')+'22' : 'var(--bg-surface)'};
      color:${isSel ? 'var(--text-primary)' : 'var(--text-secondary)'};
      transition:all 0.15s;">
      <span style="width:8px;height:8px;border-radius:50%;background:${n.color||'#6B7280'};"></span>
      ${escHtml(n.name)}
      ${isSel ? '<span style="color:var(--brand-gold);">✓</span>' : ''}
    </span>`;
  }).join('');
}

/** Lê os núcleos atualmente selecionados no picker (fonte: data-selected JSON). */
function readSelectedNucleos() {
  const picker = document.getElementById('uf-nucleos-picker');
  if (!picker) return [];
  try { return JSON.parse(picker.dataset.selected || '[]') || []; }
  catch { return []; }
}

/** Atualiza o array de selecionados no data-attribute e re-renderiza chips. */
function writeSelectedNucleos(sector, selected) {
  const picker = document.getElementById('uf-nucleos-picker');
  if (!picker) return;
  picker.dataset.selected = JSON.stringify(selected);
  picker.innerHTML = renderNucleoChips(sector, selected);
  wireNucleoChips(sector);
}

/** Wire-up dos chips (delega clique → toggle no array). */
function wireNucleoChips(sector) {
  const picker = document.getElementById('uf-nucleos-picker');
  if (!picker) return;
  picker.querySelectorAll('.uf-nuc-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const name = chip.dataset.name;
      const current = readSelectedNucleos();
      const idx = current.indexOf(name);
      if (idx > -1) current.splice(idx, 1);
      else current.push(name);
      writeSelectedNucleos(sector, current);
    });
  });
}

async function handleUserSave(userId, isEdit, closeModal) {
  const name       = document.getElementById('uf-name')?.value?.trim();
  const email      = document.getElementById('uf-email')?.value?.trim();
  const password   = document.getElementById('uf-password')?.value;
  const role       = document.getElementById('uf-role')?.value;
  const department = document.getElementById('uf-department')?.value?.trim();
  // Núcleos: multi-select — array de nomes. Back-compat: grava também
  // u.nucleo = nucleos[0] pra consumidores antigos que ainda leem o campo
  // escalar (o helper userNucleos unifica os dois na leitura).
  const nucleos    = readSelectedNucleos();
  const nucleo     = nucleos[0] || '';
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
  // Senha só é obrigatória quando NÃO é domínio SSO (usuários externos).
  // SSO entram sem senha — Auth credential é criado automaticamente no 1º login Microsoft.
  const requiresPassword = !isEdit && email && !isAllowedSSODomain(email);
  if (requiresPassword && (!password || password.length < 6)) {
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
      const visibleSectors = Array.from(document.querySelectorAll('.sector-vis-cb:checked')).map(cb => cb.value);
      await updateUserProfile(userId, { name, role, roleId: role, department: nucleo, nucleo, nucleos, sector: department, active, visibleSectors });
      toast.success(`Usuário "${name}" atualizado com sucesso!`);
    } else {
      await createUser({ name, email, password, role, roleId: role, department: nucleo, nucleo, nucleos, sector: department });
      toast.success(`Usuário "${name}" criado com sucesso!`);
    }
    closeModal();
    await loadUsers();
  } catch (err) {
    // Traduz erros do Firebase Auth para português
    const msg = err.code ? getErrorMessage(err.code) : (err.message || 'Erro ao salvar usuário.');
    toast.error(msg);
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

  document.getElementById('filter-sector')?.addEventListener('change', (e) => {
    filterSector = e.target.value;
    applyFilters();
  });

  document.getElementById('filter-status')?.addEventListener('change', (e) => {
    filterStatus = e.target.value;
    applyFilters();
  });

  // Popula dropdown de setor com os setores únicos vistos nos usuários
  // (GAP fix: filtro por setor estava ausente, embora o dado fosse exibido).
  const sectorSet = new Set(users.map(u => u.sector).filter(Boolean));
  const sectorEl = document.getElementById('filter-sector');
  if (sectorEl && sectorSet.size) {
    sectorEl.innerHTML = `<option value="">Todos os setores</option>` +
      [...sectorSet].sort().map(s => `<option value="${s}">${s}</option>`).join('');
  }

  // Ativa dropdown do split-button Export
  import('../components/uiKit.js').then(m => m.wireUiKitMenus(document.body));
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
        case 'migrate-sso': {
          // Libera SSO Microsoft pra usuários antigos criados com senha.
          // Vide functions/index.js → migrateUserToSso pro detalhe completo.
          const email = btn.dataset.email || user.email;
          const ok = await modal.confirm({
            title:   'Liberar SSO Microsoft',
            message: `<div style="font-size:0.875rem;line-height:1.5;">
              <p>Vou apagar a credencial de <strong>email/senha</strong> de
              <strong>${escHtml(email)}</strong> no Firebase Auth.</p>
              <p style="margin-top:8px;color:var(--text-muted);">O perfil
              (role, setor, núcleos) será preservado. Quando ${escHtml(user.name)}
              clicar em <em>"Entrar com Microsoft"</em>, a conta será ativada
              automaticamente.</p>
              <p style="margin-top:8px;font-size:0.75rem;color:var(--text-muted);">
              Esta operação resolve o erro <em>"senha incorreta"</em> reportado
              por usuários que tentavam SSO em contas pré-cadastradas com senha.</p>
            </div>`,
            confirmText: 'Liberar SSO',
            danger: false,
            icon: '⇄',
          });
          if (!ok) return;

          try {
            const { app } = await import('../firebase.js');
            const fb = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
            const fn = fb.httpsCallable(fb.getFunctions(app, 'us-central1'), 'migrateUserToSso');
            const result = await fn({ email });
            const r = result.data || {};
            toast.success(r.message || `${email} pronto para SSO!`);
            await loadUsers();
          } catch (err) {
            console.error('migrateUserToSso failed:', err);
            const msg = err.message?.replace(/^FirebaseError:\s*/, '') || 'Falha ao liberar SSO.';
            toast.error(msg);
          }
          break;
        }
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
        case 'delete':
          if (await modal.confirm({
            title:       'Desativar usuário',
            message:     `Esta ação desativa o perfil de <strong>${escHtml(user.name)}</strong>.<br>
                          <br>O usuário perderá acesso imediatamente. Ele poderá ser reativado
                          futuramente ou recriado com o mesmo e-mail.<br>
                          <br><strong>Tarefas e dados vinculados serão mantidos.</strong>`,
            confirmText: 'Desativar usuário',
            danger:      true,
            icon:        '🗑️',
          })) {
            try {
              await deactivateUser(uid);
              toast.success(`Usuário "${user.name}" desativado.`);
              await loadUsers();
            } catch (err) {
              toast.error('Erro ao desativar: ' + err.message);
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
  const headers = ['Nome', 'E-mail', 'Papel', 'Núcleo', 'Status', 'Criado em'];
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
