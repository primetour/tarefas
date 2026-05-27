/**
 * PRIMETOUR — Sidebar Component
 * Navegação lateral principal
 */

import { store }  from '../store.js';
import { router } from '../router.js';
import { APP_CONFIG } from '../config.js';
import { saveWorkspaceSelection } from '../services/workspaces.js';
import { LABEL as APP_VERSION_LABEL, FULL as APP_VERSION_FULL } from '../version.js';
// 4.19+: ICONS extraídos pra módulo compartilhado (single source of truth).
// Sidebar e header global usam o mesmo conjunto pra que o ícone visto na
// barra lateral seja IDÊNTICO ao do header da página correspondente.
import { ICONS, renderIcon } from './icons.js';
import { userAvatarInner } from './userAvatar.js';

// ─── Ícones SVG (estilo Lucide) ─────────────────
// Por que SVG inline em vez de Unicode/emoji?
//   • Unicode geométrico (◈ ◎ ◌ ▤) renderiza minimalista demais — todos
//     parecem o mesmo "círculo" e o usuário não distingue rotas no scan.
//   • Emoji (📱 📖 ✈) renderiza com tamanho/baseline diferentes em cada
//     OS, quebrando o alinhamento (problema reportado em "Calendário de
//     Conteúdo" e "Revista Luxury Travel").
//   • SVG inline: tamanho fixo, cor herdada via currentColor (segue a
//     paleta), zero requests HTTP, alta nitidez em qualquer DPI.
//
// ─── Definição de navegação ───────────────────────────────
const NAV_GROUPS = [
  {
    label: 'Tarefas e Projetos',
    items: [
      // 4.49.11+ Migrado de dashboard_view (renomeado) pra dashboard_home_view.
      // Check-in e Meu Painel são parte do painel inicial — mesma perm.
      { route: 'check-in',   icon: 'check-in',   label: 'Check-in',     perm: 'dashboard_home_view' },
      { route: 'dashboard',  icon: 'dashboard',  label: 'Meu Painel',   perm: 'dashboard_home_view' },
      { route: 'tasks',      icon: 'tasks',      label: 'Tarefas',      perm: 'task_create' },
      { route: 'projects',   icon: 'projects',   label: 'Projetos',     perm: 'task_create',       altPerm: 'project_create' },
      { route: 'kanban',     icon: 'kanban',     label: 'Steps',        perm: 'task_create' },
      { route: 'calendar',   icon: 'calendar',   label: 'Calendário',   perm: 'task_create' },
      { route: 'timeline',   icon: 'timeline',   label: 'Timeline',     perm: 'task_edit_any' },
    ]
  },
  {
    label: 'Gestão de Equipe',
    items: [
      { route: 'workspaces',    icon: 'workspaces',    label: 'Squads',       perm: 'workspace_create', altPerm: 'system_view_all' },
      { route: 'requests',      icon: 'requests',      label: 'Solicitações', perm: 'task_create',      badge: true },
      // 4.49.11+ Notificações sempre visíveis pra qualquer user autenticado
      // (não faz sentido bloquear notificações próprias). Antes usava
      // dashboard_view (renomeado). Sem perm = sempre visível.
      { route: 'notifications', icon: 'notifications', label: 'Notificações',                           badge: true },
      { route: 'team',          icon: 'team',          label: 'Equipe',       perm: 'task_view_all' },
      // 4.49.23+ Label "Feedbacks 1:1" pra deixar inequívoco que é o
      // módulo de gestão de pessoas (RH/avaliação), diferenciando do
      // "Feedbacks do Sistema" (bug/sugestão do app) — ver §Administração.
      { route: 'feedbacks',     icon: 'feedbacks',     label: 'Feedbacks 1:1', perm: 'feedback_view',    altPerm: 'feedback_create' },
      { route: 'goals',         icon: 'goals',         label: 'Metas',        perm: 'goals_view' },
      // 4.49.12+ CSAT: perm primária agora é dashboard_csat_view (acesso à página);
      // csat_send/view_all são pra ações dentro. Quem tem qualquer uma vê o item.
      { route: 'csat',          icon: 'csat',          label: 'CSAT',         perm: 'dashboard_csat_view', altPerm: 'csat_send' },
    ]
  },
  {
    label: 'Serviços',
    items: [
      { route: 'content-calendar', icon: 'content-calendar', label: 'Calendário de Conteúdo', perm: 'content_calendar_view' },
      { route: 'roteiros',         icon: 'roteiros',         label: 'Gerador de Cotações',    perm: 'roteiro_access' },
      // v4.50.0+ Banco de Roteiros: curadoria PRIMETOUR (Classic Collection etc.) que alimenta a IA. Visível a todos autenticados.
      { route: 'banco-roteiros',   icon: 'portal-areas',     label: 'Banco de Roteiros' },
      { route: 'portal-tips',      icon: 'portal-tips',      label: 'Portal de Dicas',        perm: 'portal_access'  },
      // 4.49.12+ Templates de áreas: tanto portal_areas_view quanto portal_areas_manage liberam ver
      { route: 'portal-areas',     icon: 'portal-areas',     label: 'Templates de áreas',     perm: 'portal_areas_view',   altPerm: 'portal_areas_manage' },
      // 4.49.12+ Banco de Imagens: perm granular nova com fallback legacy
      { route: 'portal-images',    icon: 'portal-images',    label: 'Banco de Imagens',       perm: 'portal_images_manage', altPerm: 'portal_manage' },
      // v4.50.4+ "Landing Pages" e "CMS / Site" removidos da sidebar (Renê 22/05) —
      // rotas continuam funcionando via hash direto, mas não aparecem no nav.
      { route: 'sites-btg',        icon: 'cms',              label: 'Sites',                  perm: 'portal_manage', href: 'btg/dashboard/sites/' },
      { route: 'arts-editor',      icon: 'arts-editor',      label: 'Editor de Artes',        perm: 'portal_manage'  },
      // 4.49.12+ Luxury Travel: gated por luxury_travel_manage (antes sempre visível)
      { route: 'luxury-travel',    icon: 'luxury-travel',    label: 'Revista Luxury Travel',  perm: 'luxury_travel_manage' },
      // 4.49.11+ Pautas/Clipping = análise → analytics_view (consistente com newsMonitor.js)
      { route: 'news-monitor',     icon: 'news-monitor',     label: 'Pautas e Clipping',      perm: 'analytics_view' },
      // 'ai-automations' DEPRECADO em favor do IA Hub (triggers.schedule do agente).
    ]
  },
  {
    label: 'Análise de Dados',
    items: [
      // 4.49.12+ Invertido: perm primária é dashboard_productivity_view; analytics_view é fallback
      { route: 'dashboards',        icon: 'dashboards',        label: 'Produtividade',     perm: 'dashboard_productivity_view', altPerm: 'analytics_view' },
      // v4.49.60+ Granular: perm primária específica + analytics_view como fallback.
      { route: 'nl-performance',    icon: 'nl-performance',    label: 'Newsletters',       perm: 'dashboard_nl_view',   altPerm: 'analytics_view' },
      { route: 'meta-performance',  icon: 'meta-performance',  label: 'Instagram',         perm: 'dashboard_meta_view', altPerm: 'analytics_view' },
      { route: 'ga-performance',    icon: 'ga-performance',    label: 'Google Analytics',  perm: 'dashboard_ga_view',   altPerm: 'analytics_view' },
      // 4.49.11+ Migrado pra perms granulares (aceitam o legado como altPerm)
      { route: 'portal-dashboard',  icon: 'portal-dashboard',  label: 'Portal de Dicas',   perm: 'dashboard_portal_view',   altPerm: 'portal_manage' },
      { route: 'roteiro-dashboard', icon: 'roteiro-dashboard', label: 'Roteiros',          perm: 'dashboard_roteiros_view', altPerm: 'roteiro_manage' },
      // 'ai-dashboard' agora dentro do IA Hub (aba Custos)
    ]
  },
  {
    label: 'Administração',
    items: [
      { route: 'users',      icon: 'users',      label: 'Usuários',          perm: 'system_manage_users' },
      { route: 'sectors',    icon: 'sectors',    label: 'Setores e Squads',  perm: 'system_manage_users' },
      { route: 'task-types', icon: 'task-types', label: 'Tipos de Tarefa',   perm: 'task_type_create',    altPerm: 'system_manage_users' },
      { route: 'roles',      icon: 'roles',      label: 'Roles e Acesso',    perm: 'system_manage_roles', altPerm: 'system_manage_users' },
      // 4.49.12+ IA Hub: perm primária ai_dashboard_view; system_manage_settings é fallback legacy
      { route: 'ai-hub',     icon: 'ai-hub',     label: 'IA Hub',            perm: 'ai_dashboard_view',   altPerm: 'system_manage_settings' },
      // 'ai-skills' DEPRECADO em favor do IA Hub. Skills migradas viram agents.
      { route: 'audit',           icon: 'audit',      label: 'Auditoria',           perm: 'system_manage_settings' },
      // 4.36.0+ Escritório Virtual — visualização real-time dos users no sistema
      { route: 'office',          icon: 'office',     label: 'Escritório Virtual',  perm: 'office_view' },
      { route: 'governance',      icon: 'governance', label: 'Governança',          perm: null }, // todos os autenticados
      // 4.49.23+ Ícone trocado pra 'system-feedback' (megafone) — antes
      // usava o mesmo 'feedbacks' (balão de chat) que o módulo 1:1 de
      // RH. Visualmente confundia os dois conceitos no menu.
      { route: 'system-feedback', icon: 'system-feedback', label: 'Feedbacks do Sistema',perm: 'system_manage_settings' },
      { route: 'settings',        icon: 'settings',   label: 'Configurações',       perm: 'system_manage_settings' },
      { route: 'about',      icon: 'about',      label: 'Sobre o sistema',   perm: 'system_manage_users' },
      { route: 'help',       icon: 'help',       label: 'Ajuda',             perm: null }, // todos
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
      <span class="nav-icon">${renderIcon('squads')}</span>
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
          class="nav-item ${!item.href && router.isActive(item.route) ? 'active' : ''}"
          ${item.href ? `data-href="${item.href}"` : `data-route="${item.route}"`}
          data-tooltip="${item.label}"
        >
          <span class="nav-icon">${renderIcon(item.icon)}</span>
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

    // ── Logo do sidebar: mapping EXPLÍCITO por paleta ──────────
    // PALETAS COM SIDEBAR ESCURA (usa logo BRANCO/light):
    //   midnight, charcoal, ocean, forest, royal, sunset, rose, portal
    // PALETAS COM SIDEBAR CLARA (usa logo NAVY/dark):
    //   platinum, sand
    // SEMPRE usa as URLs hardcoded direto. Sem cropped, sem fallback
    // cruzado, sem dependência de Firestore/localStorage. Garantia
    // 100% determinística — qualquer paleta puxa o logo correto.
    const palette = document.documentElement.getAttribute('data-palette') || 'midnight';
    const LIGHT_PALETTES = ['platinum', 'sand'];
    const useDarkLogo = LIGHT_PALETTES.includes(palette);

    const LIGHT_LOGO = 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/logos/lazer-1777390896671.webp';
    const DARK_LOGO  = 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/logos/lazer-alt-1777403810065.webp';
    const logoUrl = useDarkLogo ? DARK_LOGO : LIGHT_LOGO;

    const html = `
      <div class="sidebar-brand">
        <img src="${logoUrl}" alt="Logo">
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
          >${userAvatarInner(profile, { withTitle: true })}</div>
          <div class="sidebar-user-info">
            <div class="sidebar-user-name">${profile?.name || 'Usuário'}</div>
            <div class="sidebar-user-role">${roleLabel}</div>
          </div>
          <button class="sidebar-user-menu-btn">⋯</button>
        </div>
        <!-- Versão + acesso à documentação técnica.
             Single source of truth: js/version.js
             docs.html é público (auditoria externa autorizada).
             v4.50.4+: link "⏱" pra dev-hours-view.html REMOVIDO (Renê 22/05) —
             continua acessível só via URL externa /dev-hours-view.html. -->
        <div style="display:flex;align-items:stretch;border-top:1px solid var(--border-subtle);margin-top:4px;opacity:0.7;">
          <a class="sidebar-version" href="docs.html" target="_blank" rel="noopener"
            title="Documentação técnica · Build: ${APP_VERSION_FULL}"
            style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;
              padding:8px 8px 10px;font-size:0.6875rem;color:var(--text-muted);
              text-align:center;letter-spacing:0.04em;font-variant-numeric:tabular-nums;
              text-decoration:none;transition:opacity 0.15s,color 0.15s;"
            onmouseover="this.style.color='var(--brand-gold)';"
            onmouseout="this.style.color='var(--text-muted)';"
          ><span>PRIMETOUR · ${APP_VERSION_LABEL}</span><span style="font-size:0.625rem;">📚</span></a>
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
    this._watchPaletteChange();
    return this.el;
  }

  _watchPaletteChange() {
    // Observa mudanças em <html data-palette>. Quando user troca paleta
    // em runtime (settings/profile), re-aplica o logo correto sem
    // precisar re-renderizar a sidebar inteira.
    if (this._paletteObserver) this._paletteObserver.disconnect();
    const LIGHT_PALETTES = ['platinum', 'sand'];
    const LIGHT_LOGO = 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/logos/lazer-1777390896671.webp';
    const DARK_LOGO  = 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/logos/lazer-alt-1777403810065.webp';
    const updateLogo = () => {
      const palette = document.documentElement.getAttribute('data-palette') || 'midnight';
      const useDark = LIGHT_PALETTES.includes(palette);
      const url = useDark ? DARK_LOGO : LIGHT_LOGO;
      const img = this.el?.querySelector('.sidebar-brand > img');
      if (img && img.src !== url) img.src = url;
    };
    this._paletteObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'data-palette') {
          updateLogo();
          break;
        }
      }
    });
    this._paletteObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-palette'],
    });
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

    // Nav items (com data-href) — link pra área estática (módulo BTG/Sites).
    // O href é relativo; resolve a partir do diretório do Gestor, então
    // funciona tanto na raiz quanto sob um prefixo (ex.: /tarefas/).
    this.el.querySelectorAll('.nav-item[data-href]').forEach(item => {
      item.addEventListener('click', () => {
        const baseDir = location.pathname.replace(/[^/]*$/, '');
        window.location.href = baseDir + item.dataset.href;
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
      // v4.50.0+ Banco de Roteiros — editor é filha
      'banco-roteiro-editor':'banco-roteiros',
      // Gerador de Cotações — editor + dashboard também são filhas
      'roteiro-editor':       'roteiros',
      'roteiro-dashboard':    'roteiros',
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
    // Cleanup robusto: cada item em try/catch pra que falha de um não impeça
    // os outros (antes: se _unsubRoute lançasse, _unsubWs ficava como leak).
    [
      () => this._unsubRoute?.(),
      () => this._unsubWs?.(),
      () => this._paletteObserver?.disconnect(),
      () => this.el?.remove(),
      () => this.overlay?.remove(),
    ].forEach(fn => { try { fn(); } catch (e) { console.warn('[sidebar] cleanup falhou:', e.message); } });
  }
}

export default Sidebar;
