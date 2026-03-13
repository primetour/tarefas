/**
 * PRIMETOUR — Header Component
 * Cabeçalho principal do app
 */

import { store }   from '../store.js';
import { signOut } from '../auth/auth.js';
import { router }  from '../router.js';
import { toast }   from './toast.js';

const PAGE_TITLES = {
  dashboard:    { title: 'Dashboard',           icon: '⊞' },
  tasks:        { title: 'Tarefas',              icon: '✓' },
  projects:     { title: 'Projetos',             icon: '◈' },
  kanban:       { title: 'Kanban',               icon: '▤' },
  calendar:     { title: 'Calendário',           icon: '◷' },
  timeline:     { title: 'Timeline / Gantt',     icon: '━' },
  team:         { title: 'Equipe',               icon: '◎' },
  csat:         { title: 'CSAT',                 icon: '★' },
  dashboards:   { title: 'Dashboards',           icon: '◫' },
  users:        { title: 'Gestão de Usuários',   icon: '◉' },
  audit:        { title: 'Auditoria',            icon: '◌' },
  settings:     { title: 'Configurações',        icon: '⚙' },
  integrations: { title: 'Integrações',          icon: '⟳' },
  profile:      { title: 'Meu Perfil',           icon: '👤' },
};

export class Header {
  constructor() {
    this.el = null;
    this._unsubRoute = null;
  }

  render() {
    const route = store.get('currentRoute') || 'dashboard';
    const page  = PAGE_TITLES[route] || { title: 'PRIMETOUR', icon: '✦' };
    const profile = store.get('userProfile');
    const initials = store.getUserInitials();
    const avatarColor = profile?.avatarColor || '#3B82F6';

    const html = `
      <div class="app-header-title">
        <span style="color:var(--text-muted); margin-right:8px; font-size:0.875rem;">${page.icon}</span>
        ${page.title}
      </div>

      <div class="header-search">
        <span class="header-search-icon">🔍</span>
        <input
          type="text"
          class="header-search-input"
          placeholder="Buscar tarefas, projetos..."
          id="global-search-input"
          autocomplete="off"
        />
      </div>

      <div class="header-actions">
        <button class="header-action-btn" id="notif-btn" title="Notificações">
          🔔
          <span class="notif-dot"></span>
        </button>

        <button class="header-action-btn" id="help-btn" title="Ajuda">
          ❓
        </button>

        <div class="dropdown">
          <button class="header-action-btn" id="user-avatar-btn"
            style="background:${avatarColor}; color:white; font-size:0.75rem; font-weight:600; border:none;"
            title="${profile?.name || 'Usuário'}"
          >${initials}</button>
          
          <div class="dropdown-menu" id="user-dropdown" style="display:none;">
            <div style="padding:12px 14px; border-bottom:1px solid var(--border-subtle);">
              <div style="font-size:0.875rem; font-weight:600; color:var(--text-primary);">
                ${profile?.name || 'Usuário'}
              </div>
              <div style="font-size:0.75rem; color:var(--text-muted);">
                ${profile?.email || ''}
              </div>
            </div>
            <button class="dropdown-item" data-action="profile">
              👤 Meu Perfil
            </button>
            <button class="dropdown-item" data-action="change-password">
              🔑 Alterar Senha
            </button>
            <div class="dropdown-divider"></div>
            <button class="dropdown-item danger" data-action="logout">
              🚪 Sair
            </button>
          </div>
        </div>

        <button class="header-action-btn" id="mobile-menu-btn"
          style="display:none;"
          title="Menu"
        >☰</button>
      </div>
    `;

    if (!this.el) {
      this.el = document.createElement('header');
      this.el.className = 'app-header';
    }

    this.el.innerHTML = html;
    this._attachEvents();
    return this.el;
  }

  _attachEvents() {
    // Avatar / user dropdown
    const avatarBtn  = this.el.querySelector('#user-avatar-btn');
    const dropdown   = this.el.querySelector('#user-dropdown');

    avatarBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = dropdown.style.display !== 'none';
      if (isVisible) {
        dropdown.style.display = 'none';
      } else {
        // Position dropdown using fixed coords from button rect
        const rect = avatarBtn.getBoundingClientRect();
        dropdown.style.top    = (rect.bottom + 6) + 'px';
        dropdown.style.right  = (window.innerWidth - rect.right) + 'px';
        dropdown.style.display = 'block';
      }
    });

    document.addEventListener('click', () => {
      if (dropdown) dropdown.style.display = 'none';
    });

    // Dropdown actions
    this.el.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        dropdown.style.display = 'none';
        this._handleAction(action);
      });
    });

    // Mobile menu
    const mobileBtn = this.el.querySelector('#mobile-menu-btn');
    mobileBtn?.addEventListener('click', () => {
      document.querySelector('.sidebar')?.classList.toggle('mobile-open');
      document.querySelector('.sidebar-overlay')?.classList.toggle('visible');
    });

    // Global search
    const searchInput = this.el.querySelector('#global-search-input');
    searchInput?.addEventListener('input', (e) => {
      this._handleSearch(e.target.value);
    });

    // Subscribe to route changes
    this._unsubRoute = store.subscribe('currentRoute', (route) => {
      const page = PAGE_TITLES[route] || { title: 'PRIMETOUR', icon: '✦' };
      const titleEl = this.el.querySelector('.app-header-title');
      if (titleEl) {
        titleEl.innerHTML = `
          <span style="color:var(--text-muted); margin-right:8px; font-size:0.875rem;">${page.icon}</span>
          ${page.title}
        `;
      }
    });
  }

  async _handleAction(action) {
    switch (action) {
      case 'profile':
        router.navigate('profile');
        break;
      case 'change-password':
        router.navigate('profile/change-password');
        break;
      case 'logout':
        try {
          await signOut();
        } catch (err) {
          toast.error('Erro ao sair: ' + err.message);
        }
        break;
    }
  }

  _handleSearch(query) {
    // Será implementado na Etapa 2 com debounce e busca no Firestore
    console.log('Search:', query);
  }

  update() {
    this.render();
  }

  destroy() {
    this._unsubRoute?.();
  }
}

export default Header;
