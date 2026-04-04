/**
 * PRIMETOUR — App Main
 * Orquestrador principal: auth observer, router, shell
 */

import { initAuthObserver } from './auth/auth.js';
import { auditLog }         from './auth/audit.js';
import { store }            from './store.js';
import { router }           from './router.js';
import { toast }            from './components/toast.js';
import { Sidebar }          from './components/sidebar.js';
import { Header }           from './components/header.js';
import { subscribeNotifications, cleanupExpired } from './services/notifications.js';
import { startScheduler, stopScheduler }          from './services/notificationScheduler.js';
import { checkAndPlaySound, resetSoundCounter }   from './components/notificationPanel.js';

import { renderLogin }       from './pages/login.js';
import { renderDashboard }   from './pages/dashboard.js';
import { renderUsers }       from './pages/users.js';
import { renderTasks, destroyTasksPage } from './pages/tasks.js';
import { renderProjects }    from './pages/projects.js';
import { renderKanban, destroyKanban } from './pages/kanban.js';
import { renderCalendar }    from './pages/calendar.js';
import { renderTimeline }    from './pages/timeline.js';
import { renderPlaceholder }  from './pages/placeholder.js';
import { renderDashboards, destroyDashboards } from './pages/dashboards.js';
import { renderAudit }       from './pages/audit.js';
import { renderProfile }     from './pages/profile.js';
import { renderRoles }       from './pages/roles.js';
import { renderWorkspaces }   from './pages/workspaces.js';
import { renderTaskTypes }    from './pages/taskTypes.js';
import { renderCapacity }     from './pages/capacity.js';
import { renderTeam }         from './pages/team.js';
import { renderGoals }        from './pages/goals.js';
import { renderSectors }      from './pages/sectors.js';
import { renderRequests, destroyRequests } from './pages/requests.js';
import { renderNotifications, destroyNotifications } from './pages/notifications.js';
import { renderCsat, destroyCsat }      from './pages/csat.js';
import { renderIntegrations }             from './pages/integrations.js';
import { renderSettings }                 from './pages/settings.js';
import { renderAbout }                    from './pages/about.js';
import { renderNlPerformance }            from './pages/nlPerformance.js';
import { renderMetaPerformance }          from './pages/metaPerformance.js';
import { renderGaPerformance }            from './pages/gaPerformance.js';
import { renderPortalTips }               from './pages/portalTips.js';
import { renderPortalAreas }              from './pages/portalAreas.js';
import { renderPortalDestinations }       from './pages/portalDestinations.js';
import { renderPortalImages }             from './pages/portalImages.js';
import { renderPortalDashboard }          from './pages/portalDashboard.js';
import { renderPortalTipEditor }          from './pages/portalTipEditor.js';
import { renderPortalImport }             from './pages/portalImport.js';
import { renderPortalTipsList }           from './pages/portalTipsList.js';
import { renderPortalImportManual }       from './pages/portalImportManual.js';
import { renderLandingPages }             from './pages/landingPages.js';
import { renderCms }                      from './pages/cms.js';
import { renderArtsEditor }              from './pages/artsEditor.js';
import { renderAiSkills }               from './pages/aiSkills.js';
import { renderAiDashboard, destroyAiDashboard } from './pages/aiDashboard.js';
import { renderRoteiros }               from './pages/roteiros.js';
import { renderRoteiroEditor, destroyRoteiroEditor } from './pages/roteiroEditor.js';
import { renderRoteiroDashboard, destroyRoteiroDashboard } from './pages/roteiroDashboard.js';
// newsMonitor carregado dinamicamente para evitar bloqueio pré-login

// ─── Instâncias globais ───────────────────────────────────
let sidebar = null;
let header  = null;
let _unsubNotifications = null;

// ─── Init ─────────────────────────────────────────────────
async function init() {
  const root = document.getElementById('app');
  if (!root) return;

  // Aguarda estado de auth antes de qualquer render
  initAuthObserver(() => {
    hideLoadingScreen();
    renderApp(root);
  });

  // Observa mudanças de auth para re-renderizar
  store.subscribe('isAuthenticated', (isAuth) => {
    renderApp(root);
  });
}

// ─── Render principal ─────────────────────────────────────
function renderApp(root) {
  const isAuth = store.get('isAuthenticated');

  if (!isAuth) {
    destroyShell();
    root.innerHTML = '';
    renderLogin(root);
    return;
  }

  // Verificar se usuário tem workspace (exceto master/system_view_all)
  if (!store.hasWorkspaceAccess() && !store.can('system_view_all')) {
    root.innerHTML = '';
    renderNoWorkspace(root);
    return;
  }

  // Já tem shell montado?
  if (document.querySelector('.app-shell')) {
    setupRouter();
    return;
  }

  mountShell(root);
}

/* ─── Tela: sem workspace ────────────────────────────────── */
function renderNoWorkspace(root) {
  root.innerHTML = `
    <div style="
      min-height:100vh; display:flex; align-items:center; justify-content:center;
      background:var(--bg-dark); font-family:var(--font-ui);">
      <div style="text-align:center; max-width:420px; padding:40px 24px;">
        <div style="font-size:3rem; margin-bottom:20px; opacity:0.5;">◈</div>
        <h2 style="font-size:1.375rem; font-weight:600; color:var(--text-primary); margin-bottom:12px;">
          Você ainda não foi atribuído a um workspace
        </h2>
        <p style="font-size:0.9375rem; color:var(--text-secondary); line-height:1.7; margin-bottom:28px;">
          Contate seu gestor para que ele configure seu acesso ao ambiente de trabalho correto.
        </p>
        <div style="display:flex;gap:10px;justify-content:center;">
          <button id="no-ws-refresh" class="btn btn-primary">
            ↺ Verificar novamente
          </button>
          <button id="no-ws-logout" class="btn btn-secondary">
            Sair
          </button>
        </div>
        <p style="font-size:0.75rem; color:var(--text-muted); margin-top:20px;">
          Logado como: <strong style="color:var(--text-secondary);">
            ${store.get('userProfile')?.email || ''}
          </strong>
        </p>
      </div>
    </div>
  `;

  document.getElementById('no-ws-refresh')?.addEventListener('click', () => {
    import('./services/workspaces.js').then(m => m.loadUserWorkspaces()).then(() => {
      renderApp(root);
    }).catch(() => renderApp(root));
  });

  document.getElementById('no-ws-logout')?.addEventListener('click', async () => {
    const { signOut } = await import('./auth/auth.js');
    await signOut().catch(() => {});
  });
}

// ─── Monta o shell (sidebar + header + content) ───────────
function mountShell(root) {
  root.innerHTML = '';

  // Criar estrutura base
  const shell = document.createElement('div');
  shell.className = 'app-shell';

  // Sidebar
  sidebar = new Sidebar();
  sidebar.mount(shell);

  // Área principal
  const mainContent = document.createElement('div');
  mainContent.className = 'main-content';

  // Header
  header = new Header();
  mainContent.appendChild(header.render());

  // Content area
  const pageContent = document.createElement('main');
  pageContent.className = 'page-content';
  pageContent.id = 'page-content';
  mainContent.appendChild(pageContent);

  shell.appendChild(mainContent);
  root.appendChild(shell);

  // Toast container global
  if (!document.getElementById('toast-container')) {
    const tc = document.createElement('div');
    tc.id = 'toast-container';
    document.body.appendChild(tc);
  }

  setupRouter();

  // Log de login na auditoria
  const profile = store.get('userProfile');
  if (profile) {
    auditLog('auth.login', 'session', null, {
      userName: profile.name,
      email:    profile.email
    }).catch(() => {});
  }

  // Start real-time notification listener
  const currentUser = store.get('currentUser');
  if (currentUser?.uid) {
    _unsubNotifications = subscribeNotifications(currentUser.uid, (notifications) => {
      store.set('notifications', notifications);
      const unread = notifications.filter(n => !n.read).length;
      store.set('unreadCount', unread);
      checkAndPlaySound(unread);
      updateNotifSidebarBadge(unread);
    });
    // Cleanup expired notifications (runs once on login)
    cleanupExpired(currentUser.uid).catch(() => {});
    // Start deadline check scheduler
    startScheduler();
  }
}

// ─── Configurar rotas ─────────────────────────────────────
function setupRouter() {
  const content = document.getElementById('page-content');
  if (!content) return;

  router.register({
    'dashboard':    async () => { await renderDashboard(content); },
    'users':        async () => { await renderUsers(content); },
    'tasks':        async () => { destroyKanban(); await renderTasks(content); },
    'projects':     async () => { destroyKanban(); await renderProjects(content); },
    'kanban':       async () => { destroyTasksPage(); await renderKanban(content); },
    'calendar':     async () => { destroyKanban(); await renderCalendar(content); },
    'timeline':     async () => { destroyKanban(); await renderTimeline(content); },
    'team':         async () => { await renderTeam(content); },
    'csat':         async () => { destroyCsat(); await renderCsat(content); },
    'dashboards':   async () => { destroyDashboards(); await renderDashboards(content); },
    'audit':        async () => { await renderAudit(content); },
    'workspaces':   async () => { await renderWorkspaces(content); },
    'task-types':   async () => { await renderTaskTypes(content); },
    'capacity':     async () => { await renderTeam(content); }, // capacity merged into team
    'goals':        async () => { await renderGoals(content); },
    'feedbacks':    async () => { const { renderFeedbacks } = await import('./pages/feedbacks.js'); await renderFeedbacks(content); },
    'sectors':      async () => { await renderSectors(content); },
    'requests':      async () => { await renderRequests(content); },
    'notifications': async () => { destroyNotifications(); await renderNotifications(content); },
    'roles':        async () => { await renderRoles(content); },
    'settings':     async () => { await renderSettings(content); },
    'ai-skills':    async () => { await renderAiSkills(content); },
    'ai-dashboard': async () => { destroyAiDashboard(); await renderAiDashboard(content); },
    'roteiros':         async () => { await renderRoteiros(content); },
    'roteiro-editor':   async () => { destroyRoteiroEditor(); await renderRoteiroEditor(content); },
    'roteiro-dashboard': async () => { destroyRoteiroDashboard(); await renderRoteiroDashboard(content); },
    'integrations': async () => { await renderIntegrations(content); },
    'about':        async () => { await renderAbout(content); },
    'nl-performance':       async () => { await renderNlPerformance(content); },
    'meta-performance':     async () => { await renderMetaPerformance(content); },
    'ga-performance':       async () => { await renderGaPerformance(content); },
    'portal-tips':          async () => { await renderPortalTips(content); },
    'portal-areas':         async () => { await renderPortalAreas(content); },
    'portal-destinations':  async () => { await renderPortalDestinations(content); },
    'portal-images':        async () => { await renderPortalImages(content); },
    'portal-dashboard':     async () => { await renderPortalDashboard(content); },
    'portal-tip-editor':    async () => { await renderPortalTipEditor(content); },
    'portal-import':        async () => { await renderPortalImport(content); },
    'landing-pages':        async () => { await renderLandingPages(content); },
    'cms':                  async () => { await renderCms(content); },
    'arts-editor':          async () => { await renderArtsEditor(content); },
    'news-monitor':         async () => { const { renderNewsMonitor } = await import('./pages/newsMonitor.js'); await renderNewsMonitor(content); },
    'portal-tips-list':     async () => { await renderPortalTipsList(content); },
    'portal-import-manual': async () => { await renderPortalImportManual(content); },
    'profile':      async () => { await renderProfile(content); },
    '404':          async () => render404(content),
  });

  // Guard: só acessa app se autenticado
  router.addGuard((route) => {
    if (!store.get('isAuthenticated')) {
      return false;
    }
    // Parceiros só acessam rotas do portal
    if (store.isPartner()) {
      const portalRoutes = ['portal-tips','portal-dashboard','profile'];
      if (!portalRoutes.includes(route)) {
        router.navigate('portal-tips');
        return false;
      }
    }
    return true;
  });

  // Re-render páginas de dados ao trocar workspace ativo
  // Poll pending requests count for badge (every 60s)
  async function updateRequestsBadge() {
    try {
      const { countPendingRequests } = await import('./services/requests.js');
      const count = await countPendingRequests();
      store.set('pendingRequests', count);
      updateSidebarBadge(count);
    } catch(e) {}
  }
  updateRequestsBadge();
  setInterval(updateRequestsBadge, 60000);

  store.subscribe('activeWorkspaces', () => {
    const route = router.getCurrentRoute();
    const refreshMap = {
      'tasks':     () => { destroyTasksPage(); import('./pages/tasks.js').then(m => m.renderTasks(content)); },
      'projects':  () => import('./pages/projects.js').then(m => m.renderProjects(content)),
      'kanban':    () => { destroyKanban(); import('./pages/kanban.js').then(m => m.renderKanban(content)); },
      'dashboard': () => import('./pages/dashboard.js').then(m => m.renderDashboard(content)),
      'dashboards':() => { destroyDashboards(); import('./pages/dashboards.js').then(m => m.renderDashboards(content)); },
      'csat':      () => { destroyCsat(); import('./pages/csat.js').then(m => m.renderCsat(content)); },
    };
    refreshMap[route]?.()?.catch?.(console.warn);
  });

  // Limpar conteúdo e scroll antes de cada navegação
  router.beforeNavigation(() => {
    if (content) {
      content.scrollTop = 0;
      // Destruir instâncias ativas antes de limpar o DOM
      destroyDashboards();
      destroyKanban();
      destroyTasksPage();
      destroyCsat();
      destroyRequests();
      destroyNotifications();
      destroyRoteiroEditor();
      // Limpar o container garante que não há resíduos visuais
      content.innerHTML = '';
    }
  });

  // Atualiza header ao navegar
  router.afterNavigation((route) => {
    header?.update?.();
    // Atualiza sidebar active state
    sidebar?.setActive?.(route);
  });

  router.init();
}

// ─── Sidebar badge helpers ────────────────────────────────
function updateSidebarBadge(count) {
  const badge = document.querySelector('[data-route="requests"] .sidebar-badge');
  if (!badge) return;
  badge.textContent = count > 0 ? (count > 99 ? '99+' : count) : '';
  badge.style.display = count > 0 ? 'flex' : 'none';
}

function updateNotifSidebarBadge(count) {
  const badge = document.querySelector('[data-route="notifications"] .sidebar-badge');
  if (!badge) return;
  badge.textContent = count > 0 ? (count > 99 ? '99+' : count) : '';
  badge.style.display = count > 0 ? 'flex' : 'none';
}

// ─── 404 ──────────────────────────────────────────────────
function render404(container) {
  container.innerHTML = `
    <div style="
      display:flex; flex-direction:column; align-items:center;
      justify-content:center; min-height:60vh; text-align:center;
    ">
      <div style="font-size:5rem; margin-bottom:16px; opacity:0.3;">404</div>
      <h2 style="font-size:1.25rem; color:var(--text-primary); margin-bottom:8px;">
        Página não encontrada
      </h2>
      <p style="color:var(--text-muted); margin-bottom:24px;">
        A rota solicitada não existe.
      </p>
      <a href="#dashboard" class="btn btn-primary">← Voltar ao Dashboard</a>
    </div>
  `;
}

// ─── Destroy shell (no logout) ────────────────────────────
function destroyShell() {
  sidebar?.destroy();
  header?.destroy();
  sidebar = null;
  header  = null;
  // Stop deadline scheduler
  stopScheduler();
  // Cleanup notification listener
  if (_unsubNotifications) {
    _unsubNotifications();
    _unsubNotifications = null;
  }
  store.set('notifications', []);
  store.set('unreadCount', 0);
  resetSoundCounter();
}

// ─── Loading screen ───────────────────────────────────────
function hideLoadingScreen() {
  const ls = document.getElementById('loading-screen');
  if (ls) {
    ls.classList.add('fade-out');
    setTimeout(() => ls.remove(), 500);
  }
}

// ─── Iniciar ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
