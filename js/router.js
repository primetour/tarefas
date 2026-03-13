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
    const hash  = window.location.hash.replace('#', '') || 'dashboard';
    const parts = hash.split('/');
    const route = parts[0];
    const params = parts.slice(1);

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
      await handler({ route, params });
    }

    // After navigation callbacks
    for (const cb of this._afterNavCallbacks) {
      await cb(route);
    }
  }

  // ─── Utilitários ─────────────────────────────────────────
  getCurrentRoute() {
    return window.location.hash.replace('#', '') || 'dashboard';
  }

  isActive(route) {
    return this.getCurrentRoute().startsWith(route);
  }
}

export const router = new Router();
export default router;
