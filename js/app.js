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
import { renderCsat, destroyCsat }      from './pages/csat.js';
import { renderIntegrations }             from './pages/integrations.js';
import { renderSettings }                 from './pages/settings.js';

// ─── Instâncias globais ───────────────────────────────────
let sidebar = null;
let header  = null;

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

  // Já tem shell montado?
  if (document.querySelector('.app-shell')) {
    setupRouter();
    return;
  }

  mountShell(root);
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
    'team':         async () => renderPlaceholder(content, 'team'),
    'csat':         async () => { destroyCsat(); await renderCsat(content); },
    'dashboards':   async () => { destroyDashboards(); await renderDashboards(content); },
    'audit':        async () => { await renderAudit(content); },
    'settings':     async () => { await renderSettings(content); },
    'integrations': async () => { await renderIntegrations(content); },
    'profile':      async () => { await renderProfile(content); },
    '404':          async () => render404(content),
  });

  // Guard: só acessa app se autenticado
  router.addGuard((route) => {
    if (!store.get('isAuthenticated')) {
      return false; // Bloqueia
    }
    return true;
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
