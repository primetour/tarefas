/**
 * PRIMETOUR — Store (Estado Global)
 * Gerenciamento de estado reativo simples sem dependências externas
 */

class Store {
  constructor() {
    this._state = {
      // Autenticação
      currentUser:     null,   // Firebase Auth user
      userProfile:     null,   // Dados do Firestore
      isAuthenticated: false,
      authLoading:     true,

      // Navegação
      currentRoute:    'dashboard',
      sidebarCollapsed: false,

      // Dados em cache
      users: [],
      
      // UI
      globalLoading: false,
    };

    this._listeners = {};
  }

  // ─── Leitura ─────────────────────────────────────────────
  get(key) {
    return key ? this._state[key] : { ...this._state };
  }

  // ─── Escrita + notifica listeners ────────────────────────
  set(key, value) {
    const prev = this._state[key];
    this._state[key] = value;
    
    if (prev !== value) {
      this._notify(key, value, prev);
      this._notify('*', this._state, null); // wildcard
    }
  }

  // ─── Atualização parcial de objeto ───────────────────────
  merge(key, partial) {
    const current = this._state[key];
    if (typeof current === 'object' && current !== null) {
      this.set(key, { ...current, ...partial });
    }
  }

  // ─── Subscribe ───────────────────────────────────────────
  subscribe(key, callback) {
    if (!this._listeners[key]) this._listeners[key] = [];
    this._listeners[key].push(callback);
    
    // Retorna função de unsubscribe
    return () => {
      this._listeners[key] = this._listeners[key].filter(cb => cb !== callback);
    };
  }

  // ─── Notify ──────────────────────────────────────────────
  _notify(key, value, prev) {
    const callbacks = this._listeners[key] || [];
    callbacks.forEach(cb => {
      try { cb(value, prev); }
      catch (e) { console.error(`Store listener error [${key}]:`, e); }
    });
  }

  // ─── Computed ────────────────────────────────────────────
  isAdmin() {
    return this._state.userProfile?.role === 'admin';
  }

  isManager() {
    const role = this._state.userProfile?.role;
    return role === 'admin' || role === 'manager';
  }

  getUserInitials() {
    const name = this._state.userProfile?.name || '';
    return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  }
}

// Singleton
export const store = new Store();
export default store;
