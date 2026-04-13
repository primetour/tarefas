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
import { renderSquadWorkspace } from './pages/squadWorkspace.js';
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
import { renderContentCalendar }         from './pages/contentCalendar.js';
import { mountAiPanel } from './components/aiPanel.js';
// newsMonitor carregado dinamicamente para evitar bloqueio pré-login

// ─── Instâncias globais ───────────────────────────────────
let sidebar = null;
let header  = null;
let _unsubNotifications = null;

// ─── Init ─────────────────────────────────────────────────
async function init() {
  const root = document.getElementById('app');
  if (!root) return;

  let authResolved = false;

  // Aguarda estado de auth antes de qualquer render
  initAuthObserver(() => {
    if (authResolved) return;
    authResolved = true;
    hideLoadingScreen();
    renderApp(root);
  });

  // Safety timeout: se o auth observer não disparar em 8s, forçar render
  setTimeout(() => {
    if (!authResolved) {
      authResolved = true;
      console.warn('[App] Auth timeout — forçando render');
      store.set('authLoading', false);
      hideLoadingScreen();
      renderApp(root);
    }
  }, 8000);

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

  // Wizard de primeiro acesso (SSO ou criado pelo admin)
  const profile = store.get('userProfile');
  if (profile?.firstLogin && !store.isMaster()) {
    root.innerHTML = '';
    renderFirstLoginWizard(root);
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

/* ─── Wizard de primeiro acesso ──────────────────────────── */
async function renderFirstLoginWizard(root) {
  const profile = store.get('userProfile');
  const userName = profile?.name || 'Usuário';

  // Carregar setores e squads disponíveis
  const { REQUESTING_AREAS } = await import('./services/tasks.js');
  const { fetchAllWorkspaces, addMember, loadUserWorkspaces } = await import('./services/workspaces.js');
  const { updateUserProfile } = await import('./auth/auth.js');

  let allWorkspaces = [];
  try { allWorkspaces = await fetchAllWorkspaces(); } catch(_) {}
  const activeWorkspaces = allWorkspaces.filter(w => !w.archived);

  // Pré-preencher setor se o admin já definiu
  let selectedSector = profile?.sector || profile?.department || '';
  let selectedSquads = new Set();

  const render = () => {
    const sectorSquads = activeWorkspaces.filter(w => !w.sector || w.sector === selectedSector || w.multiSector);

    root.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
        background:var(--bg-dark);font-family:var(--font-ui);">
        <div style="width:100%;max-width:520px;padding:40px 24px;">

          <!-- Header -->
          <div style="text-align:center;margin-bottom:32px;">
            <div style="font-size:2.5rem;margin-bottom:12px;">✈</div>
            <h1 style="font-size:1.5rem;font-weight:700;color:var(--text-primary);margin:0 0 8px;">
              Bem-vindo(a), ${userName.split(' ')[0]}!
            </h1>
            <p style="font-size:0.9375rem;color:var(--text-secondary);line-height:1.6;margin:0;">
              Configure seu perfil para começar a usar o Gestor de Tarefas.
            </p>
          </div>

          <!-- Card -->
          <div style="background:var(--bg-surface);border:1px solid var(--border-default);
            border-radius:var(--radius-lg);padding:28px 24px;">

            <!-- Passo 1: Setor -->
            <div style="margin-bottom:24px;">
              <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-secondary);
                text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">
                1. Qual é o seu setor?
              </label>
              <select id="wiz-sector" style="width:100%;padding:10px 14px;background:var(--bg-elevated);
                border:1px solid var(--border-default);border-radius:var(--radius-md);
                color:var(--text-primary);font-size:0.9375rem;">
                <option value="">Selecione seu setor...</option>
                ${REQUESTING_AREAS.map(s => `<option value="${s}" ${selectedSector===s?'selected':''}>${s}</option>`).join('')}
              </select>
            </div>

            <!-- Passo 2: Squads -->
            <div style="margin-bottom:24px;${!selectedSector ? 'opacity:0.4;pointer-events:none;' : ''}">
              <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-secondary);
                text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">
                2. Participa de algum squad? <span style="font-weight:400;text-transform:none;">(opcional)</span>
              </label>
              ${sectorSquads.length ? `
                <div style="display:flex;flex-direction:column;gap:8px;">
                  ${sectorSquads.map(w => `
                    <label style="display:flex;align-items:center;gap:10px;padding:10px 14px;
                      background:${selectedSquads.has(w.id) ? 'rgba(212,168,67,0.1)' : 'var(--bg-elevated)'};
                      border:1px solid ${selectedSquads.has(w.id) ? 'var(--brand-gold)' : 'var(--border-default)'};
                      border-radius:var(--radius-md);cursor:pointer;transition:all 0.15s;">
                      <input type="checkbox" value="${w.id}" class="wiz-squad-check"
                        ${selectedSquads.has(w.id) ? 'checked' : ''}
                        style="accent-color:var(--brand-gold);width:16px;height:16px;" />
                      <div>
                        <div style="font-size:0.875rem;font-weight:500;color:var(--text-primary);">
                          ${w.icon || '◈'} ${w.name}
                        </div>
                        ${w.description ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">${w.description}</div>` : ''}
                      </div>
                    </label>
                  `).join('')}
                </div>
              ` : `
                <p style="font-size:0.8125rem;color:var(--text-muted);padding:12px 0;">
                  ${selectedSector ? 'Nenhum squad disponível para este setor.' : 'Selecione um setor primeiro.'}
                </p>
              `}
            </div>

            <!-- Botão -->
            <button id="wiz-submit" class="btn btn-primary" style="width:100%;padding:12px;font-size:0.9375rem;"
              ${!selectedSector ? 'disabled' : ''}>
              Começar a usar →
            </button>
          </div>

          <!-- Logout -->
          <div style="text-align:center;margin-top:16px;">
            <button id="wiz-logout" style="background:none;border:none;color:var(--text-muted);
              font-size:0.8125rem;cursor:pointer;text-decoration:underline;">
              Sair da conta
            </button>
          </div>
        </div>
      </div>
    `;

    // ─── Events ───
    document.getElementById('wiz-sector')?.addEventListener('change', (e) => {
      selectedSector = e.target.value;
      selectedSquads.clear();
      render();
    });

    document.querySelectorAll('.wiz-squad-check').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) selectedSquads.add(cb.value);
        else selectedSquads.delete(cb.value);
        render();
      });
    });

    document.getElementById('wiz-submit')?.addEventListener('click', async () => {
      const btn = document.getElementById('wiz-submit');
      btn.classList.add('loading');
      btn.disabled = true;
      btn.textContent = 'Configurando...';

      try {
        const uid = store.get('currentUser').uid;

        // 1. Atualizar setor + firstLogin no perfil
        await updateUserProfile(uid, {
          sector: selectedSector,
          department: selectedSector,
          firstLogin: false,
        });

        // 2. Adicionar aos squads selecionados
        for (const wsId of selectedSquads) {
          try { await addMember(wsId, uid, { selfJoin: true }); } catch(e) {
            console.warn('[Wizard] Erro ao adicionar ao squad:', wsId, e.message);
          }
        }

        // 3. Recarregar workspaces e setor no store
        store.set('userSector', selectedSector);
        store.set('visibleSectors', [selectedSector]);
        await loadUserWorkspaces().catch(() => {});

        // 4. Atualizar perfil no store
        const updatedProfile = { ...store.get('userProfile'), sector: selectedSector, department: selectedSector, firstLogin: false };
        store.set('userProfile', updatedProfile);

        toast.success('Configuração concluída! Bem-vindo(a) ao Gestor de Tarefas.');
        renderApp(root);
      } catch(err) {
        console.error('[Wizard] Erro:', err);
        toast.error('Erro ao configurar. Tente novamente.');
        btn.classList.remove('loading');
        btn.disabled = false;
        btn.textContent = 'Começar a usar →';
      }
    });

    document.getElementById('wiz-logout')?.addEventListener('click', async () => {
      const { signOut } = await import('./auth/auth.js');
      await signOut().catch(() => {});
    });
  };

  render();
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
    // Start AI automations scheduler
    import('./services/aiAutomations.js').then(m => m.startAutomationScheduler()).catch(() => {});
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
    'squad':        async () => { await renderSquadWorkspace(content); },
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
    'ai-automations': async () => { const { renderAiAutomations } = await import('./pages/aiAutomations.js'); await renderAiAutomations(content); },
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
    'portal-import':        async () => { await renderPortalTips(content, 'import'); },
    'landing-pages':        async () => { await renderLandingPages(content); },
    'cms':                  async () => { await renderCms(content); },
    'arts-editor':          async () => { await renderArtsEditor(content); },
    'news-monitor':         async () => { const { renderNewsMonitor } = await import('./pages/newsMonitor.js'); await renderNewsMonitor(content); },
    'content-calendar':     async () => { await renderContentCalendar(content); },
    'portal-tips-list':     async () => { await renderPortalTips(content, 'list'); },
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
      'squad':     () => import('./pages/squadWorkspace.js').then(m => m.renderSquadWorkspace(content)),
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
      // Remover painel de IA flutuante (será recriado para o novo módulo)
      document.getElementById('ai-panel-auto')?.remove();
      // Limpar o container garante que não há resíduos visuais
      content.innerHTML = '';
    }
  });

  // Atualiza header ao navegar + monta painel de IA automaticamente
  router.afterNavigation(async (route) => {
    header?.update?.();
    sidebar?.setActive?.(route);

    // ── Auto-mount AI Panel ──────────────────────────────────
    // Mapa: rota do sistema → moduleId do MODULE_REGISTRY (ai.js)
    // Se a rota estiver aqui e houver skills ativas para o módulo,
    // o painel de IA aparece automaticamente. Senão, nada acontece.
    const ROUTE_TO_MODULE = {
      'tasks':              'tasks',
      'kanban':             'kanban',
      'calendar':           'calendar',
      'timeline':           'tasks',
      'projects':           'projects',
      'dashboard':          'dashboards',
      'dashboards':         'dashboards',
      'portal-tips':        'portal-tips',
      'portal-tip-editor':  'portal-tips',
      'portal-tips-list':   'portal-tips',
      'portal-dashboard':   'portal-tips',
      'portal-areas':       'portal-tips',
      'portal-destinations':'portal-tips',
      'portal-images':      'portal-tips',
      'portal-import':      'portal-tips',
      'portal-import-manual':'portal-tips',
      'roteiros':           'roteiros',
      'roteiro-editor':     'roteiros',
      'roteiro-dashboard':  'roteiros',
      'feedbacks':          'feedbacks',
      'goals':              'goals',
      'csat':               'csat',
      'requests':           'requests',
      'news-monitor':       'news-monitor',
      'content-calendar':   'content-calendar',
      'nl-performance':     'content',
      'meta-performance':   'content',
      'ga-performance':     'content',
      'landing-pages':      'landing-pages',
      'cms':                'cms',
      'arts-editor':        'arts-editor',
      'team':               'general',
      'capacity':           'capacity',
      'workspaces':         'workspaces',
      'settings':           'general',
      'users':              'general',
      'roles':              'general',
      'sectors':            'sectors',
      'audit':              'general',
      'integrations':       'general',
      'notifications':      'general',
      'task-types':         'task-types',
      'task-categories':    'task-categories',
      'ai-dashboard':       'general',
    };

    const moduleId = ROUTE_TO_MODULE[route];
    if (!moduleId || !content) return;

    // Esperar o DOM do módulo renderizar (pequeno delay para async renders)
    setTimeout(async () => {
      try {
        // Criar container flutuante para o painel de IA (canto inferior direito)
        if (document.getElementById('ai-panel-auto')) return; // já montado
        const aiDiv = document.createElement('div');
        aiDiv.id = 'ai-panel-auto';
        aiDiv.style.cssText = `
          position:fixed;bottom:24px;right:24px;z-index:9999;
        `;

        // Append no body (é fixed, não precisa estar no fluxo do page-content)
        document.body.appendChild(aiDiv);

        // Montar — se não houver skills E não houver ações, nada aparece
        await mountAiPanel(aiDiv, moduleId, () => {
          // Captura contexto dinâmico da página visível
          const ctx = {
            currentRoute: route,
            moduleId,
            sector:  store.get('userSector') || '',
            user:    store.get('currentUser')?.email || '',
            pageTitle: content.querySelector('.page-title')?.textContent || '',
            pageSubtitle: content.querySelector('.page-subtitle,.page-header p')?.textContent || '',
          };

          // Capturar stats/contadores visíveis
          const statsEls = content.querySelectorAll('.stat-card-value,.kpi-value,.rd-kpi-value');
          if (statsEls.length) {
            ctx.visibleStats = [...statsEls].slice(0, 10).map(el => ({
              label: el.closest('.stat-card,.kpi-card,.rd-kpi-card')?.querySelector('.stat-card-label,.kpi-label,.rd-kpi-label,small')?.textContent || '',
              value: el.textContent?.trim() || '',
            })).filter(s => s.value);
          }

          // Capturar filtros ativos
          const filters = content.querySelectorAll('select.filter-select, select[id*="filter"]');
          if (filters.length) {
            ctx.activeFilters = [...filters].map(s => ({
              name: s.id || s.name || '',
              value: s.options[s.selectedIndex]?.textContent || '',
            })).filter(f => f.value && !f.value.startsWith('Todos'));
          }

          // Capturar dados de tabelas/listas (primeiras linhas)
          const rows = content.querySelectorAll('tr, .task-row, .card-item, .kanban-card');
          if (rows.length) {
            ctx.visibleItems = Math.min(rows.length, 50);
          }

          return ctx;
        });

        // Se o painel não renderizou nada (sem skills/config), remover
        if (!aiDiv.innerHTML.trim()) aiDiv.remove();
      } catch (e) { /* silencioso */ }
    }, 150);
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
  // Stop AI automations scheduler
  import('./services/aiAutomations.js').then(m => m.stopAutomationScheduler()).catch(() => {});
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
