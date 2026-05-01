/**
 * PRIMETOUR — Router
 * Roteamento client-side baseado em hash (#route)
 */

import { store } from './store.js';

class Router {
  constructor() {
    this.routes   = {};
    this.guards   = [];
    this.current  = null;
    this._beforeNavCallbacks = [];
    this._afterNavCallbacks  = [];
  }

  // ─── Registrar rotas ──────────────────────────────────────
  register(routes) {
    this.routes = { ...this.routes, ...routes };
    return this;
  }

  // ─── Adicionar guards globais ─────────────────────────────
  addGuard(fn) {
    this.guards.push(fn);
    return this;
  }

  beforeNavigation(fn) {
    this._beforeNavCallbacks.push(fn);
    return this;
  }

  afterNavigation(fn) {
    this._afterNavCallbacks.push(fn);
    return this;
  }

  // ─── Inicializar ──────────────────────────────────────────
  init() {
    window.addEventListener('hashchange', () => this._resolve());
    this._resolve();
    return this;
  }

  // ─── Navegar programaticamente ────────────────────────────
  navigate(route, params = {}) {
    window.location.hash = '#' + route;
  }

  // ─── Voltar ───────────────────────────────────────────────
  back() {
    window.history.back();
  }

  // ─── Resolver rota atual ──────────────────────────────────
  async _resolve() {
    const hash    = window.location.hash.replace('#', '') || 'dashboard';
    const noQuery = hash.split('?')[0];          // strip ?key=val
    const parts   = noQuery.split('/');
    const route   = parts[0];
    const params  = parts.slice(1);

    // Verificar guards
    for (const guard of this.guards) {
      const result = await guard(route, params);
      if (result === false) return;
      if (typeof result === 'string') {
        this.navigate(result);
        return;
      }
    }

    // Before navigation callbacks
    for (const cb of this._beforeNavCallbacks) {
      await cb(route, this.current);
    }

    const handler = this.routes[route] || this.routes['404'] || this.routes['dashboard'];

    if (handler) {
      this.current = route;
      store.set('currentRoute', route);

      // Watchdog: se a página ainda tiver SOMENTE skeleton (sem conteúdo
      // de fato) após 15s, injeta uma UI de "tente recarregar" pra
      // resgatar o user de internet lenta / rede com timeout.
      const watchdog = setTimeout(() => {
        try {
          const root = document.getElementById('app');
          if (!root) return;
          // Considera "stuck" se 100% dos children são .skeleton ou loaders
          const hasRealContent = root.querySelector(
            '.page-header, .dashboard-grid > :not(.skeleton), table, .card-body:not(.skeleton)'
          );
          if (hasRealContent) return;
          // Não duplica banner se já tiver
          if (root.querySelector('#stuck-banner')) return;
          const banner = document.createElement('div');
          banner.id = 'stuck-banner';
          banner.style.cssText = `
            margin: 24px auto; max-width: 480px; padding: 16px 20px;
            background: rgba(245,158,11,0.10); border: 1px solid rgba(245,158,11,0.4);
            border-radius: 8px; color: var(--text-primary); font-size: 0.875rem;
            text-align: center; line-height: 1.5;
          `;
          banner.innerHTML = `
            <div style="font-weight:600;margin-bottom:6px;color:#F59E0B;">⚠ Carregamento lento</div>
            <div style="color:var(--text-muted);margin-bottom:12px;">
              Esta página ainda não respondeu. Pode ser internet lenta ou um erro temporário.
            </div>
            <button class="btn btn-primary btn-sm" onclick="location.reload()">
              ↻ Recarregar página
            </button>
          `;
          root.prepend(banner);
        } catch {}
      }, 15000);

      try {
        await handler({ route, params });
      } finally {
        clearTimeout(watchdog);
        // Se já carregou, remove banner de stuck (caso tenha sido injetado)
        document.getElementById('stuck-banner')?.remove();
      }
    }

    // After navigation callbacks
    for (const cb of this._afterNavCallbacks) {
      await cb(route);
    }
  }

  // ─── Utilitários ─────────────────────────────────────────
  getCurrentRoute() {
    return (window.location.hash.replace('#', '') || 'dashboard').split('?')[0];
  }

  isActive(route) {
    return this.getCurrentRoute().startsWith(route);
  }
}

export const router = new Router();
export default router;
