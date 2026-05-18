/**
 * PRIMETOUR — Store (Estado Global)
 * Gerenciamento de estado reativo com suporte a RBAC dinâmico
 */

class Store {
  constructor() {
    this._state = {
      // Autenticação
      currentUser:      null,
      userProfile:      null,
      isAuthenticated:  false,
      authLoading:      true,

      // RBAC
      userRole:         null,   // documento completo do role do usuário
      userPermissions:  {},     // { permission_key: true/false }

      // Workspaces (Fase 0 Round B)
      userWorkspaces:    [],    // workspaces que o usuário pertence
      activeWorkspaces:  [],    // IDs ativos na view (multi-select)
      currentWorkspace:  null,  // workspace padrão para criar itens

      // Navegação
      currentRoute:     'dashboard',
      sidebarCollapsed: false,

      // Cache
      users:          [],
      roles:          [],
      taskTypes:      [],
      taskCategories: [],
      cardPrefs:      null,  // null = use defaults
      nucleos:        [],

      // Setor e visibilidade
      userSector:     null,   // setor do usuário logado
      visibleSectors: [],     // setores visíveis (Head pode ter múltiplos)

      // Notificações
      notifications: [],
      unreadCount:   0,

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
      this._notify('*', this._state, null);
    }
  }

  // ─── Atualização parcial ──────────────────────────────────
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
    return () => {
      this._listeners[key] = this._listeners[key].filter(cb => cb !== callback);
    };
  }

  _notify(key, value, prev) {
    (this._listeners[key] || []).forEach(cb => {
      try { cb(value, prev); }
      catch(e) { console.error(`Store listener error [${key}]:`, e); }
    });
  }

  // ─── Cache com TTL ────────────────────────────────────────
  _cache = {};  // { key: { data, timestamp } }

  /**
   * Retorna dados cacheados se ainda válidos (dentro do TTL).
   * @param {string} key - chave do cache
   * @param {number} ttlMs - tempo de vida em ms (default 5 minutos)
   * @returns {any|null} dados cacheados ou null se expirado/inexistente
   */
  getCached(key, ttlMs = 300000) {
    const entry = this._cache[key];
    if (!entry) return null;
    if (Date.now() - entry.timestamp > ttlMs) {
      delete this._cache[key];
      return null;
    }
    return entry.data;
  }

  /**
   * Salva dados no cache com timestamp.
   * @param {string} key
   * @param {any} data
   */
  setCache(key, data) {
    this._cache[key] = { data, timestamp: Date.now() };
  }

  /** Invalida uma chave específica do cache */
  invalidateCache(key) {
    if (key) {
      delete this._cache[key];
    } else {
      this._cache = {};
    }
  }

  // ─── RBAC: carregar permissões do usuário ─────────────────
  loadPermissions(roleDoc) {
    if (!roleDoc) {
      this.set('userRole', null);
      this.set('userPermissions', {});
      return;
    }
    this.set('userRole', roleDoc);
    // Master tem tudo independente do documento
    if (roleDoc.id === 'master' || this._state.userProfile?.isMaster) {
      const allTrue = {};
      Object.keys(roleDoc.permissions || {}).forEach(k => { allTrue[k] = true; });
      this.set('userPermissions', allTrue);
    } else {
      this.set('userPermissions', roleDoc.permissions || {});
    }
  }

  // ─── RBAC: verificar permissão ────────────────────────────
  can(permission) {
    // Master sempre pode tudo
    if (this._state.userProfile?.isMaster) return true;
    if (this._state.userRole?.id === 'master') return true;
    // 4.35.22+ Overrides por user têm prioridade sobre role base.
    // user.permissionOverrides: { permKey: true|false }
    //   true  → liga essa permissão pra esse user específico
    //   false → desliga (mesmo que role libere)
    //   undefined → cai no role base
    const overrides = this._state.userProfile?.permissionOverrides;
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, permission)) {
      return overrides[permission] === true;
    }
    return this._state.userPermissions[permission] === true;
  }

  // ─── Atalhos de compatibilidade (Round D: todos migrados para can()) ──
  // Mantidos como aliases — safe para remover em versão futura
  isAdmin()   { return this.can('system_manage_users'); }
  isManager() { return this.can('workspace_create') || this.can('system_manage_users'); }
  isPartner() {
    const profile = this._state.userProfile;
    return profile?.roleId === 'partner' && !this.isMaster();
  }
  canPortal()  { return this.isMaster() || this.can('portal_access'); }
  canCreateTip() { return this.isMaster() || this.can('portal_create'); }
  canManagePortal() { return this.isMaster() || this.can('portal_manage'); }
  // 4.35.31+ banco de imagens: aceita portal_images_manage (novo) ou portal_manage (legado).
  canManagePortalImages() {
    return this.isMaster() || this.can('portal_images_manage') || this.can('portal_manage');
  }
  // 4.49.2+ destinos (cidade/país/continente): perm granular pra liberar pro
  // analista criar destino novo sem ter portal_manage (que dá acesso a tudo).
  // Aceita portal_destinations_manage (novo) ou portal_manage (legado/master).
  canManageDestinations() {
    return this.isMaster() || this.can('portal_destinations_manage') || this.can('portal_manage');
  }
  // 4.49.6+ segmentos + categorias do Portal — mesma lógica do destinos.
  canManagePortalSegments() {
    return this.isMaster() || this.can('portal_segments_manage') || this.can('portal_manage');
  }
  // 4.49.2+ áreas/BUs (templates): wire das perms `portal_areas_*` que estavam
  // no catálogo mas não eram consultadas no código (orphan).
  canViewPortalAreas() {
    return this.isMaster() || this.can('portal_areas_view') || this.can('portal_manage');
  }
  canManagePortalAreas() {
    return this.isMaster() || this.can('portal_areas_manage') || this.can('portal_manage');
  }

  canAccessRoteiros()  { return this.isMaster() || this.can('roteiro_access'); }
  canCreateRoteiro()   { return this.isMaster() || this.can('roteiro_create'); }
  canManageRoteiros()  { return this.isMaster() || this.can('roteiro_manage'); }

  canViewContentCalendar()   { return this.isMaster() || this.can('content_calendar_view'); }
  canCreateContentCalendar() { return this.isMaster() || this.can('content_calendar_create'); }
  canManageContentCalendar() { return this.isMaster() || this.can('content_calendar_manage'); }

  canManageLuxuryTravel() { return this.isMaster() || this.can('luxury_travel_manage'); }

  /**
   * getVisibleSectors()
   * Returns:
   *   null          → master/Diretoria (sees all)
   *   string[]      → head gets visibleSectors[], others get [userSector]
   *   []            → no sector assigned (sees nothing sector-filtered)
   */
  getVisibleSectors() {
    if (this.isMaster() || this.can('system_view_all')) return null;
    const visible = this._state.visibleSectors || [];
    if (visible.length > 0) return visible; // Head
    const single = this._state.userSector;
    return single ? [single] : [];
  }

  isMaster() {
    return this._state.userProfile?.isMaster === true
        || this._state.userRole?.id === 'master';
  }

  // ─── Helpers de usuário ───────────────────────────────────
  getUserInitials() {
    const name = this._state.userProfile?.name || '';
    return name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase() || '?';
  }

  // ─── Workspace helpers ────────────────────────────────────
  getActiveWorkspaceIds() {
    const active = this._state.activeWorkspaces;
    if (this.isMaster() || this.can('system_view_all')) return null; // null = sem filtro
    return active.length ? active : (this._state.userWorkspaces.map(w => w.id) || []);
  }

  hasWorkspaceAccess() {
    if (this.isMaster()) return true;
    if (this.can('system_view_all')) return true;
    if (this.can('system_manage_users')) return true; // admin sempre entra
    if (this._state.userRole?.id === 'admin') return true;
    const profile = this._state.userProfile;
    if (profile?.role === 'admin' || profile?.roleId === 'admin') return true;
    return this._state.userWorkspaces.length > 0;
  }
}

export const store = new Store();
export default store;

/**
 * 4.35.22+ Helper de route-guard pra páginas.
 * @param {HTMLElement} container - destino do render
 * @param {string|string[]} perms - permissão(ões) — basta UMA
 * @returns {boolean} true se passou; false se renderizou "Acesso negado"
 */
export function routeGuard(container, perms) {
  if (store.isMaster()) return true;
  const list = Array.isArray(perms) ? perms : [perms];
  if (list.some(p => store.can(p))) return true;
  container.innerHTML = `
    <div class="empty-state" style="min-height:60vh;padding:60px 20px;text-align:center;">
      <div class="empty-state-icon" style="font-size:3rem;margin-bottom:10px;">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
      <p class="text-sm text-muted" style="margin-top:8px;max-width:480px;margin-left:auto;margin-right:auto;">
        Você não tem permissão pra acessar este módulo.
        Fale com a Diretoria pra liberar acesso.
      </p>
    </div>`;
  return false;
}
