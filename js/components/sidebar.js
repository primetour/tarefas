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
      { route: 'dashboard',  icon: '⊞',  label: 'Painel',      perm: 'dashboard_view' },
      { route: 'tasks',      icon: '✓',  label: 'Tarefas',     perm: 'task_create' },
      { route: 'projects',   icon: '◈',  label: 'Projetos',    perm: 'task_create',       altPerm: 'project_create' },
      { route: 'kanban',     icon: '▤',  label: 'Steps',       perm: 'task_create' },
      { route: 'calendar',   icon: '◷',  label: 'Calendário',  perm: 'task_create' },
      { route: 'timeline',   icon: '━━', label: 'Timeline',    perm: 'task_edit_any' },
    ]
  },
  {
    label: 'Gestão',
    items: [
      { route: 'workspaces', icon: '◈',  label: 'Squads',   perm: 'workspace_create', altPerm: 'system_view_all' },
      { route: 'requests',       icon: '◌',  label: 'Solicitações', perm: 'task_create', badge: true },
      { route: 'notifications', icon: '⊘',  label: 'Notificações', perm: 'dashboard_view', badge: true },
      { route: 'team',       icon: '◎',  label: 'Equipe',       perm: 'task_view_all' },
      { route: 'feedbacks',  icon: '◈',  label: 'Feedbacks',    perm: 'feedback_view', altPerm: 'feedback_create' },
      { route: 'goals',      icon: '◎',  label: 'Metas',        perm: 'goals_view' },
      { route: 'csat',       icon: '★',  label: 'CSAT',         perm: 'csat_send',        altPerm: 'csat_view_all' },
    ]
  },
  {
    label: 'Análise de Dados',
    items: [
      { route: 'dashboards',          icon: '◫', label: 'Produtividade',       perm: 'analytics_view',  altPerm: 'dashboard_view' },
      { route: 'nl-performance',      icon: '◈', label: 'Newsletters',         perm: 'analytics_view' },
      { route: 'meta-performance',    icon: '◈', label: 'Instagram',            perm: 'analytics_view' },
      { route: 'ga-performance',      icon: '◈', label: 'Google Analytics',    perm: 'analytics_view' },
      { route: 'portal-dashboard',    icon: '◈', label: 'Portal de Dicas',     perm: 'portal_manage' },
      { route: 'roteiro-dashboard', icon: '✈', label: 'Roteiros',            perm: 'roteiro_manage' },
      { route: 'ai-dashboard',       icon: '◈', label: 'Inteligência Artificial', perm: 'system_manage_settings' },
    ]
  },
  {
    label: 'Serviços',
    items: [
      { route: 'content-calendar',     icon: '📱', label: 'Calendário de Conteúdo', perm: 'content_calendar_view' },
      { route: 'roteiros',            icon: '✈', label: 'Roteiros de Viagem',  perm: 'roteiro_access' },
      { route: 'portal-tips',         icon: '✈', label: 'Portal de Dicas',     perm: 'portal_access'  },
      { route: 'portal-images',       icon: '▨', label: 'Banco de Imagens',     perm: 'portal_manage'  },
      { route: 'landing-pages',       icon: '◱', label: 'Landing Pages',        perm: 'portal_manage'  },
      { route: 'cms',                 icon: '◫', label: 'CMS / Site',           perm: 'portal_manage'  },
      { route: 'arts-editor',         icon: '▣', label: 'Editor de Artes',      perm: 'portal_manage'  },
      { route: 'news-monitor',        icon: '◉', label: 'Notícias',              perm: 'dashboard_view' },
      { route: 'ai-automations',     icon: '◎', label: 'Automações IA',         perm: 'dashboard_view' },
    ]
  },
  {
    label: 'Administração',
    items: [
      { route: 'users',      icon: '◉',  label: 'Usuários',          perm: 'system_manage_users' },
      { route: 'sectors',    icon: '◈',  label: 'Setores e Núcleos', perm: 'system_manage_users' },
      { route: 'task-types', icon: '▣',  label: 'Tipos de Tarefa',   perm: 'task_type_create', altPerm: 'system_manage_users' },
      { route: 'roles',      icon: '◈',  label: 'Roles e Acesso',    perm: 'system_manage_roles', altPerm: 'system_manage_users' },
      { route: 'ai-skills',       icon: '◈',  label: 'IA Skills',          perm: 'system_manage_settings' },
      { route: 'audit',      icon: '◌',  label: 'Auditoria',         perm: 'system_manage_settings' },
      { route: 'settings',   icon: '⚙',  label: 'Configurações',     perm: 'system_manage_settings' },
      { route: 'about',      icon: '◎',  label: 'Sobre o sistema',   perm: 'system_manage_users' },
    ]
  }
];

/* ─── Helper: lê squadId atual da URL (?id=XXX) ──────────── */
function getCurrentSquadIdFromHash() {
  const hash = window.location.hash || '';
  const q = hash.split('?')[1] || '';
  const params = new URLSearchParams(q);
  return params.get('id') || null;
}

/* ─── Squads expansível (subitens do menu principal) ─────── */
function buildSquadsMenuItem() {
  const workspaces = store.get('userWorkspaces') || [];
  if (!workspaces.length) return '';

  const current       = store.get('currentWorkspace');
  const currentSquadId = getCurrentSquadIdFromHash();
  const isSquadRoute  = (store.get('currentRoute') || '').startsWith('squad');
  const collapsed     = store.get('sidebar_squads_collapsed') === true;

  const subItems = workspaces.map(ws => {
    const isOpen    = isSquadRoute && currentSquadId === ws.id;
    const isCurrent = current?.id === ws.id;
    return `
      <div class="nav-item nav-squad-subitem ${isOpen?'active':''}"
           data-squad-id="${ws.id}"
           data-tooltip="${esc(ws.name)}${ws.multiSector ? ' · multissetor' : ''}"
           title="Abrir workspace do squad${isCurrent ? ' (squad padrão)' : ''}"
           style="padding-left:32px;">
        <span class="nav-icon" style="color:${ws.color||'#D4A843'};font-size:0.875rem;">●</span>
        <span class="nav-label" style="font-size:0.8125rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">
          ${esc(ws.name)}
        </span>
        ${ws.multiSector ? `<span class="nav-label" title="Squad multissetor"
          style="font-size:0.625rem;color:var(--text-muted);margin-left:4px;">⇌</span>` : ''}
        <span class="nav-label ws-current-dot" data-wsid="${ws.id}"
          title="${isCurrent ? 'Squad padrão atual (onde novas tarefas são criadas)' : 'Definir como squad padrão'}"
          style="width:8px;height:8px;border-radius:50%;flex-shrink:0;cursor:pointer;margin-left:6px;
            background:${isCurrent?'var(--brand-gold)':'var(--border-subtle)'};
            box-shadow:${isCurrent?'0 0 0 2px rgba(212,168,67,0.25)':'none'};
            transition:all 0.15s;display:inline-block;"></span>
      </div>`;
  }).join('');

  return `
    <div class="nav-item nav-squads-parent ${isSquadRoute ? 'active' : ''}" data-squads-toggle>
      <span class="nav-icon">◈</span>
      <span class="nav-label">Squads</span>
      <span class="nav-label" style="margin-left:auto;font-size:0.625rem;opacity:0.6;
        background:var(--bg-subtle);padding:1px 6px;border-radius:var(--radius-full);">${workspaces.length}</span>
      <span class="nav-label section-chevron" style="font-size:0.55rem;opacity:0.5;margin-left:6px;transition:transform 0.2s;
        transform:${collapsed?'rotate(-90deg)':'rotate(0deg)'};">▼</span>
    </div>
    <div class="nav-squads-children" style="display:${collapsed?'none':'block'};">
      ${subItems}
    </div>
  `;
}

/* ─── HTML-escape local para o selector ──────────────────── */
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
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
        // All items now use permission-based checks
        if (item.perm) return store.can(item.perm) || (item.altPerm && store.can(item.altPerm));
        return true;
      });
      if (!items.length) return '';

      // Montar HTML de itens, injetando o bloco de Squads após "projects"
      // no grupo Principal quando o usuário tiver squads.
      const renderNavItem = (item) => `
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
      `;

      let itemsHTML = '';
      const userWorkspaces = store.get('userWorkspaces') || [];
      const showSquadsHere = group.label === 'Principal' && userWorkspaces.length > 0;
      if (showSquadsHere) {
        // Injeta "Squads" logo após "projects"
        for (const item of items) {
          itemsHTML += renderNavItem(item);
          if (item.route === 'projects') {
            itemsHTML += buildSquadsMenuItem();
          }
        }
      } else {
        itemsHTML = items.map(renderNavItem).join('');
      }

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
            ${itemsHTML}
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

    // Nav items (com data-route) — navegação padrão
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
      // Re-render squads para marcar subitem ativo conforme ?id=XXX
      this._rerenderSquadsBlock();
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

    // Subscribe to workspace changes — re-render Squads block
    this._unsubWs = store.subscribe('userWorkspaces', () => {
      this._rerenderSquadsBlock(true);
    });

    this._attachSquadEvents();
  }

  /**
   * Re-renderiza o bloco "Squads" (item pai + subitens) sem perder
   * estado do resto do sidebar. Se `structural=true`, pode ter
   * havido mudança no número de squads (ou vazio), então reconstrói
   * todo o sidebar via re-render parcial do nav.
   */
  _rerenderSquadsBlock(structural = false) {
    if (!this.el) return;
    const parent   = this.el.querySelector('.nav-squads-parent');
    const children = this.el.querySelector('.nav-squads-children');
    const workspaces = store.get('userWorkspaces') || [];

    // Caso estrutural: criar do zero se não existia, remover se ficou vazio
    if (structural) {
      // Remover antigos
      if (parent)   parent.remove();
      if (children) children.remove();
      if (workspaces.length) {
        // Inserir após o item "projects"
        const projectsItem = this.el.querySelector('.nav-item[data-route="projects"]');
        if (projectsItem) {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = buildSquadsMenuItem();
          // Insere cada filho do wrapper após projectsItem, na ordem
          const nodes = [...wrapper.children];
          let anchor = projectsItem;
          for (const n of nodes) {
            anchor.after(n);
            anchor = n;
          }
        }
      }
    } else if (parent || children) {
      // Apenas atualiza classes/ativo dos subitens existentes
      const html = buildSquadsMenuItem();
      if (html && parent && children) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        const newParent   = wrapper.querySelector('.nav-squads-parent');
        const newChildren = wrapper.querySelector('.nav-squads-children');
        if (newParent)   parent.replaceWith(newParent);
        if (newChildren) children.replaceWith(newChildren);
      }
    }
    this._attachSquadEvents();
  }

  _attachSquadEvents() {
    // Toggle expandir/colapsar lista de squads
    const parent = this.el?.querySelector('.nav-squads-parent[data-squads-toggle]');
    if (parent) {
      // Clique no chevron → apenas toggle expandir/colapsar
      const chevron = parent.querySelector('.section-chevron');
      if (chevron) {
        chevron.addEventListener('click', (e) => {
          e.stopPropagation();
          const children = this.el.querySelector('.nav-squads-children');
          const collapsed = children?.style.display === 'none';
          if (children) children.style.display = collapsed ? 'block' : 'none';
          chevron.style.transform = collapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
          store.set('sidebar_squads_collapsed', !collapsed);
        });
      }
      // Clique no item pai → navega para lista de squads
      parent.addEventListener('click', (e) => {
        if (e.target.closest('.section-chevron')) return; // ignora se clicou no chevron
        e.stopPropagation();
        // Expande os subitens se estavam colapsados
        const children = this.el.querySelector('.nav-squads-children');
        if (children?.style.display === 'none') {
          children.style.display = 'block';
          const chev = parent.querySelector('.section-chevron');
          if (chev) chev.style.transform = 'rotate(0deg)';
          store.set('sidebar_squads_collapsed', false);
        }
        router.navigate('workspaces');
        this.setActive('workspaces');
        this.closeMobile();
      });
    }

    // Click em subitem → ativa squad + navega para página dedicada
    this.el?.querySelectorAll('.nav-squad-subitem').forEach(sub => {
      sub.addEventListener('click', (e) => {
        // Clique no dot de "squad padrão" não navega
        if (e.target.closest('.ws-current-dot')) return;
        e.stopPropagation();
        const wsId = sub.dataset.squadId;
        const ws   = (store.get('userWorkspaces') || []).find(w => w.id === wsId);
        if (!ws) return;
        // ORDEM CRÍTICA: navegar PRIMEIRO (muda hash síncrono) e só depois
        // setar activeWorkspaces. Caso contrário, o subscribe de
        // activeWorkspaces re-renderiza a rota antiga (dashboard) antes
        // do navigate disparar — race condition que fazia o 1º clique
        // não responder.
        router.navigate(`squad?id=${encodeURIComponent(wsId)}`);
        store.set('activeWorkspaces', [wsId]);
        store.set('currentWorkspace', ws);
        saveWorkspaceSelection([wsId], wsId);
        this.closeMobile();
        // Atualiza estado visual (ativo / dot)
        this._rerenderSquadsBlock();
      });
    });

    // Dot de "squad padrão" — apenas define currentWorkspace sem navegar
    this.el?.querySelectorAll('.nav-squad-subitem .ws-current-dot').forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        const wsId = dot.dataset.wsid;
        const ws   = (store.get('userWorkspaces') || []).find(w => w.id === wsId);
        if (!ws) return;
        store.set('currentWorkspace', ws);
        saveWorkspaceSelection(store.get('activeWorkspaces') || [], wsId);
        this._rerenderSquadsBlock();
      });
    });
  }

  setActive(route) {
    if (!this.el) return;
    // Mapear rotas filhas para o item pai no sidebar
    const routeAliases = {
      'portal-tips-list': 'portal-tips',
      'portal-import':    'portal-tips',
      'portal-tip-editor':'portal-tips',
      'portal-import-manual':'portal-tips',
    };
    const effectiveRoute = routeAliases[route] || route;
    this.el.querySelectorAll('.nav-item').forEach(item => {
      const itemRoute = item.dataset.route;
      item.classList.toggle('active',
        effectiveRoute === itemRoute || effectiveRoute.startsWith(itemRoute + '/') ||
        route === itemRoute || route.startsWith(itemRoute + '/')
      );
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
