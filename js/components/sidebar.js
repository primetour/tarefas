/**
 * PRIMETOUR — Sidebar Component
 * Navegação lateral principal
 */

import { store }  from '../store.js';
import { router } from '../router.js';
import { APP_CONFIG } from '../config.js';
import { saveWorkspaceSelection } from '../services/workspaces.js';

// ─── Definição de navegação ───────────────────────────────
const NAV_GROUPS = [
  {
    label: 'Principal',
    items: [
      { route: 'dashboard',  icon: '⊞',  label: 'Painel',      roles: ['admin','manager','member'] },
      { route: 'tasks',      icon: '✓',  label: 'Tarefas',     roles: ['admin','manager','member'] },
      { route: 'projects',   icon: '◈',  label: 'Projetos',    roles: ['admin','manager','member'] },
      { route: 'kanban',     icon: '▤',  label: 'Steps',       roles: ['admin','manager','member'] },
      { route: 'calendar',   icon: '◷',  label: 'Calendário',  roles: ['admin','manager','member'] },
      { route: 'timeline',   icon: '━━', label: 'Timeline',    roles: ['admin','manager'] },
    ]
  },
  {
    label: 'Gestão',
    items: [
      { route: 'workspaces', icon: '◈',  label: 'Workspaces',   perm: 'workspace_create', altPerm: 'system_view_all' },
      { route: 'requests',   icon: '◌',  label: 'Solicitações', perm: 'task_create', badge: true },
      { route: 'team',       icon: '◎',  label: 'Equipe',       roles: ['admin','manager','member'] },
      { route: 'goals',      icon: '◎',  label: 'Metas',        roles: ['admin','manager','member'] },
      { route: 'csat',       icon: '★',  label: 'CSAT',         roles: ['admin','manager'] },
    ]
  },
  {
    label: 'Análise de Dados',
    items: [
      { route: 'dashboards',          icon: '◫', label: 'Produtividade',       roles: ['admin','manager'] },
      { route: 'nl-performance',      icon: '◈', label: 'Newsletters',         roles: ['admin','manager'] },
      { route: 'meta-performance',    icon: '◈', label: 'Redes Sociais',       roles: ['admin','manager'] },
      { route: 'portal-dashboard',    icon: '◈', label: 'Portal de Dicas',     perm: 'portal_manage' },
    ]
  },
  {
    label: 'Serviços',
    items: [
      { route: 'portal-tips',         icon: '✈', label: 'Portal de Dicas',     perm: 'portal_access'  },
      { route: 'portal-import',       icon: '↑', label: 'Importar Dicas',      perm: 'portal_create'  },
    ]
  },
  {
    label: 'Administração',
    items: [
      { route: 'users',      icon: '◉',  label: 'Usuários',          perm: 'system_manage_users' },
      { route: 'sectors',    icon: '◈',  label: 'Setores e Núcleos', perm: 'system_manage_users' },
      { route: 'task-types', icon: '▣',  label: 'Tipos de Tarefa',   perm: 'task_type_create', altPerm: 'system_manage_users' },
      { route: 'roles',      icon: '◈',  label: 'Roles e Acesso',    perm: 'system_manage_roles', altPerm: 'system_manage_users' },
      { route: 'audit',      icon: '◌',  label: 'Auditoria',         perm: 'system_manage_settings' },
      { route: 'settings',   icon: '⚙',  label: 'Configurações',     perm: 'system_manage_settings' },
      { route: 'about',      icon: '◎',  label: 'Sobre o sistema',   perm: 'system_manage_users' },
    ]
  }
];

/* ─── Workspace selector HTML ────────────────────────────── */
function buildWsSelector() {
  const workspaces   = store.get('userWorkspaces') || [];
  const activeIds    = store.get('activeWorkspaces') || [];
  const current      = store.get('currentWorkspace');

  if (!workspaces.length) return '';

  return `
    <div style="padding:8px 12px 4px; border-bottom:1px solid var(--border-subtle);">
      <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;
        color:var(--text-muted);margin-bottom:6px;">Workspaces</div>
      <div style="display:flex;flex-direction:column;gap:3px;">
        ${workspaces.map(ws => {
          const isActive = activeIds.includes(ws.id);
          return `
            <div class="ws-toggle-chip ${isActive?'active':''}" data-wsid="${ws.id}"
              style="display:flex;align-items:center;gap:8px;padding:5px 8px;
              border-radius:var(--radius-md);cursor:pointer;transition:all 0.15s;
              background:${isActive?ws.color+'18':'transparent'};
              border:1px solid ${isActive?ws.color+'44':'transparent'};">
              <div style="width:8px;height:8px;border-radius:50%;flex-shrink:0;
                background:${ws.color||'#D4A843'};opacity:${isActive?1:0.4};"></div>
              <span class="nav-label" style="font-size:0.8125rem;
                color:${isActive?'var(--text-primary)':'var(--text-muted)'};
                overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">
                ${ws.name}
              </span>
              <div class="ws-current-dot" data-wsid="${ws.id}"
                title="Definir como workspace padrão"
                style="width:6px;height:6px;border-radius:50%;flex-shrink:0;
                  background:${current?.id===ws.id?'var(--brand-gold)':'var(--border-subtle)'};
                  transition:background 0.15s;">
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

export class Sidebar {
  constructor() {
    this.el        = null;
    this.overlay   = null;
    this.collapsed = false;
    this._unsubRoute = null;
  }

  render() {
    const profile = store.get('userProfile');
    const role    = profile?.role || 'member';
    const initials = store.getUserInitials();
    const avatarColor = profile?.avatarColor || '#3B82F6';

    const navGroupsHTML = NAV_GROUPS.map(group => {
      const items = group.items.filter(item => {
        // Master always sees everything
        if (store.isMaster()) return true;
        if (item.perm) return store.can(item.perm) || (item.altPerm && store.can(item.altPerm));
        if (!item.roles) return true;
        // Role name mapping for nav purposes
        const ROLE_NAV_MAP = { master: 'admin', coordinator: 'manager' };
        const effectiveRole = ROLE_NAV_MAP[role] || role;
        return item.roles.includes(effectiveRole);
      });
      if (!items.length) return '';

      const isCollapsed = store.get(`sidebar_section_${group.label}`) === true;
      return `
        <div class="sidebar-section" data-section="${group.label}">
          <div class="sidebar-section-label sidebar-section-toggle" data-section="${group.label}"
            style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;user-select:none;">
            <span>${group.label}</span>
            <span class="section-chevron nav-label" style="font-size:0.6rem;opacity:0.5;transition:transform 0.2s;
              transform:${isCollapsed?'rotate(-90deg)':'rotate(0deg)'};">▼</span>
          </div>
          <div class="sidebar-section-items" style="display:${isCollapsed?'none':'block'}">
            ${items.map(item => `
              <div
                class="nav-item ${router.isActive(item.route) ? 'active' : ''}"
                data-route="${item.route}"
                data-tooltip="${item.label}"
              >
                <span class="nav-icon">${item.icon}</span>
                <span class="nav-label">${item.label}</span>
                ${item.badge ? `<span class="sidebar-badge" style="
                  display:none;min-width:18px;height:18px;padding:0 4px;
                  border-radius:var(--radius-full);background:var(--color-danger);
                  color:#fff;font-size:0.625rem;font-weight:700;
                  align-items:center;justify-content:center;margin-left:auto;"></span>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');

    const allRoles  = store.get('roles') || [];
    const roleDoc   = allRoles.find(r => r.id === (profile?.roleId||role));
    const ROLE_FALLBACKS = {
      master: 'Diretoria', admin: 'Head', manager: 'Gerente',
      coordinator: 'Coordenador', member: 'Analista',
    };
    const roleLabel = roleDoc?.name || APP_CONFIG.roles[role]?.label || ROLE_FALLBACKS[role] || role;

    const html = `
      <div class="sidebar-brand">
        <img src="assets/mandala-branca.png" alt="PRIMETOUR"
        style="width:36px;height:36px;border-radius:var(--radius-sm);object-fit:contain;flex-shrink:0;" />
        <div class="sidebar-brand-text">
          <span class="sidebar-brand-name">PRIMETOUR</span>
          <span class="sidebar-brand-sub">Gestão de Tarefas</span>
        </div>
        <button class="sidebar-toggle" id="sidebar-toggle-btn" aria-label="Recolher menu">
          ◀
        </button>
      </div>

      <!-- Workspace selector -->
      <div class="sidebar-ws-selector" id="sidebar-ws-selector">
        ${buildWsSelector()}
      </div>

      <nav class="sidebar-nav">
        ${navGroupsHTML}
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-user" id="sidebar-user-btn">
          <div class="avatar avatar-sm sidebar-user-avatar"
               style="background:${avatarColor}"
          >${initials}</div>
          <div class="sidebar-user-info">
            <div class="sidebar-user-name">${profile?.name || 'Usuário'}</div>
            <div class="sidebar-user-role">${roleLabel}</div>
          </div>
          <button class="sidebar-user-menu-btn">⋯</button>
        </div>
      </div>
    `;

    // Criar elemento sidebar
    this.el = document.createElement('aside');
    this.el.className = 'sidebar';
    if (this.collapsed) this.el.classList.add('collapsed');
    this.el.innerHTML = html;

    // Criar overlay mobile
    this.overlay = document.createElement('div');
    this.overlay.className = 'sidebar-overlay';
    this.overlay.addEventListener('click', () => this.closeMobile());

    this._attachEvents();
    return this.el;
  }

  _attachEvents() {
    // Toggle collapse
    const toggleBtn = this.el.querySelector('#sidebar-toggle-btn');
    toggleBtn?.addEventListener('click', () => this.toggleCollapse());

    // Nav items
    this.el.querySelectorAll('.nav-item[data-route]').forEach(item => {
      item.addEventListener('click', () => {
        const route = item.dataset.route;
        router.navigate(route);
        this.setActive(route);
        this.closeMobile();
      });
    });

    // User menu
    const userBtn = this.el.querySelector('#sidebar-user-btn');
    userBtn?.addEventListener('click', () => this._showUserMenu());

    // Subscribe to route changes
    this._unsubRoute = store.subscribe('currentRoute', (route) => {
      this.setActive(route);
    });

    // Accordion section toggles
    this.el?.querySelectorAll('.sidebar-section-toggle').forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const section   = toggle.dataset.section;
        const items     = toggle.closest('.sidebar-section')?.querySelector('.sidebar-section-items');
        const chevron   = toggle.querySelector('.section-chevron');
        const collapsed = items?.style.display === 'none';
        if (items)   items.style.display   = collapsed ? 'block' : 'none';
        if (chevron) chevron.style.transform = collapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
        store.set(`sidebar_section_${section}`, !collapsed);
      });
    });

    // Subscribe to workspace changes — re-render selector
    this._unsubWs = store.subscribe('userWorkspaces', () => {
      const sel = this.el?.querySelector('#sidebar-ws-selector');
      if (sel) sel.innerHTML = buildWsSelector();
      this._attachWsEvents();
    });

    this._attachWsEvents();
  }

  _attachWsEvents() {
    // Toggle workspace active
    this.el?.querySelectorAll('.ws-toggle-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const wsId   = chip.dataset.wsid;
        let active   = [...(store.get('activeWorkspaces') || [])];
        if (active.includes(wsId)) {
          // Não permite desativar o último
          if (active.length === 1) return;
          active = active.filter(id => id !== wsId);
        } else {
          active.push(wsId);
        }
        store.set('activeWorkspaces', active);
        saveWorkspaceSelection(active, store.get('currentWorkspace')?.id);
        // Re-render selector
        const sel = this.el?.querySelector('#sidebar-ws-selector');
        if (sel) sel.innerHTML = buildWsSelector();
        this._attachWsEvents();
      });
    });

    // Set current workspace (dot)
    this.el?.querySelectorAll('.ws-current-dot').forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        const wsId = dot.dataset.wsid;
        const ws   = (store.get('userWorkspaces')||[]).find(w => w.id === wsId);
        if (!ws) return;
        store.set('currentWorkspace', ws);
        saveWorkspaceSelection(store.get('activeWorkspaces')||[], wsId);
        const sel = this.el?.querySelector('#sidebar-ws-selector');
        if (sel) sel.innerHTML = buildWsSelector();
        this._attachWsEvents();
      });
    });
  }

  setActive(route) {
    if (!this.el) return;
    this.el.querySelectorAll('.nav-item').forEach(item => {
      const itemRoute = item.dataset.route;
      item.classList.toggle('active', route === itemRoute || route.startsWith(itemRoute + '/'));
    });
  }

  toggleCollapse() {
    this.collapsed = !this.collapsed;
    this.el?.classList.toggle('collapsed', this.collapsed);
    store.set('sidebarCollapsed', this.collapsed);

    // Ajustar main-content
    const main = document.querySelector('.main-content');
    if (main) {
      main.style.transition = 'margin-left var(--transition-normal)';
    }
  }

  openMobile() {
    this.el?.classList.add('mobile-open');
    this.overlay?.classList.add('visible');
    document.body.style.overflow = 'hidden';
  }

  closeMobile() {
    this.el?.classList.remove('mobile-open');
    this.overlay?.classList.remove('visible');
    document.body.style.overflow = '';
  }

  _showUserMenu() {
    import('./userMenu.js')
      .then(m => m.showUserMenu())
      .catch(() => {
        // Fallback inline
        const { signOut } = import('../auth/auth.js');
      });
  }

  mount(container) {
    const sidebarEl = this.render();
    container.appendChild(this.overlay);
    container.appendChild(sidebarEl);
    return this;
  }

  destroy() {
    this._unsubRoute?.();
    this._unsubWs?.();
    this.el?.remove();
    this.overlay?.remove();
  }
}

export default Sidebar;
