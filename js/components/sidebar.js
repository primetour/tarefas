/**
 * PRIMETOUR — Sidebar Component
 * Navegação lateral principal
 */

import { store }  from '../store.js';
import { router } from '../router.js';
import { APP_CONFIG } from '../config.js';

// ─── Definição de navegação ───────────────────────────────
const NAV_GROUPS = [
  {
    label: 'Principal',
    items: [
      { route: 'dashboard',  icon: '⊞',  label: 'Dashboard',   roles: ['admin','manager','member'] },
      { route: 'tasks',      icon: '✓',  label: 'Tarefas',     roles: ['admin','manager','member'] },
      { route: 'projects',   icon: '◈',  label: 'Projetos',    roles: ['admin','manager','member'] },
      { route: 'kanban',     icon: '▤',  label: 'Kanban',      roles: ['admin','manager','member'] },
      { route: 'calendar',   icon: '◷',  label: 'Calendário',  roles: ['admin','manager','member'] },
      { route: 'timeline',   icon: '━━', label: 'Timeline',    roles: ['admin','manager'] },
    ]
  },
  {
    label: 'Gestão',
    items: [
      { route: 'team',       icon: '◎',  label: 'Equipe',      roles: ['admin','manager'] },
      { route: 'csat',       icon: '★',  label: 'CSAT',        roles: ['admin','manager'] },
      { route: 'dashboards', icon: '◫',  label: 'Dashboards',  roles: ['admin','manager'] },
    ]
  },
  {
    label: 'Administração',
    items: [
      { route: 'users',      icon: '◉',  label: 'Usuários',    roles: ['admin'] },
      { route: 'audit',      icon: '◌',  label: 'Auditoria',   roles: ['admin'] },
      { route: 'settings',   icon: '⚙',  label: 'Configurações', roles: ['admin'] },
      { route: 'integrations', icon: '⟳', label: 'Integrações', roles: ['admin'] },
    ]
  }
];

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
      const items = group.items.filter(item => item.roles.includes(role));
      if (!items.length) return '';

      return `
        <div class="sidebar-section">
          <div class="sidebar-section-label">${group.label}</div>
          ${items.map(item => `
            <div
              class="nav-item ${router.isActive(item.route) ? 'active' : ''}"
              data-route="${item.route}"
              data-tooltip="${item.label}"
            >
              <span class="nav-icon">${item.icon}</span>
              <span class="nav-label">${item.label}</span>
            </div>
          `).join('')}
        </div>
      `;
    }).join('');

    const roleConfig = APP_CONFIG.roles[role] || APP_CONFIG.roles.member;

    const html = `
      <div class="sidebar-brand">
        <div class="sidebar-brand-icon">✦</div>
        <div class="sidebar-brand-text">
          <span class="sidebar-brand-name">PRIMETOUR</span>
          <span class="sidebar-brand-sub">Gestão de Tarefas</span>
        </div>
        <button class="sidebar-toggle" id="sidebar-toggle-btn" aria-label="Recolher menu">
          ◀
        </button>
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
            <div class="sidebar-user-role">${roleConfig.label}</div>
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
    this.el?.remove();
    this.overlay?.remove();
  }
}

export default Sidebar;
