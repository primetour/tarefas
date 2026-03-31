/**
 * PRIMETOUR — Header Component
 * Cabeçalho principal do app
 */

import { store }   from '../store.js';
import { signOut } from '../auth/auth.js';
import { router }  from '../router.js';
import { toast }   from './toast.js';
import {
  collection, getDocs, query, orderBy, limit, where,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase.js';

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

        <button class="header-action-btn" id="theme-toggle-btn"
          title="Alternar tema claro/escuro">
          ${document.documentElement.dataset.theme === 'light' ? '🌙' : '☀️'}
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

    // Theme toggle
    const themeBtn = this.el.querySelector('#theme-toggle-btn');
    themeBtn?.addEventListener('click', () => {
      const isLight = document.documentElement.dataset.theme === 'light';
      const newTheme = isLight ? 'dark' : 'light';
      document.documentElement.dataset.theme = newTheme;
      localStorage.setItem('primetour-theme', newTheme);
      themeBtn.textContent = newTheme === 'light' ? '🌙' : '☀️';
    });

    // Mobile menu
    const mobileBtn = this.el.querySelector('#mobile-menu-btn');
    mobileBtn?.addEventListener('click', () => {
      document.querySelector('.sidebar')?.classList.toggle('mobile-open');
      document.querySelector('.sidebar-overlay')?.classList.toggle('visible');
    });

    // Global search
    const searchInput = this.el.querySelector('#global-search-input');
    let searchTimeout = null;
    searchInput?.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const q = e.target.value.trim();
      if (!q || q.length < 2) {
        this._closeSearchResults();
        return;
      }
      searchTimeout = setTimeout(() => this._handleSearch(q), 300);
    });
    searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        this._closeSearchResults();
      }
    });
    // Close search results on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.header-search')) this._closeSearchResults();
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

  async _handleSearch(q) {
    const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const lower = q.toLowerCase();

    // Remove existing results
    this._closeSearchResults();

    // Search locally first (tasks from store or Firestore)
    let tasks = store.get('allTasks') || [];
    let projects = store.get('projects') || [];
    const users = store.get('users') || [];

    // If no cached tasks, fetch from Firestore
    if (!tasks.length) {
      try {
        const snap = await getDocs(query(collection(db, 'tasks'), orderBy('createdAt', 'desc'), limit(500)));
        tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        store.set('allTasks', tasks);
      } catch { /* ignore */ }
    }
    if (!projects.length) {
      try {
        const snap = await getDocs(collection(db, 'projects'));
        projects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        store.set('projects', projects);
      } catch { /* ignore */ }
    }

    // Helper: fetch & cache a collection
    const cached = async (key, col, opts) => {
      let data = store.get(key) || [];
      if (!data.length) {
        try {
          const ref = opts ? query(collection(db, col), ...opts) : collection(db, col);
          const snap = await getDocs(ref);
          data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          store.set(key, data);
        } catch { /* ignore */ }
      }
      return data;
    };

    // Portal tips
    let tips = [];
    if (store.canPortal()) tips = await cached('portalTips', 'portal_tips');

    // Portal images
    let images = [];
    if (store.canPortal()) images = await cached('portalImages', 'portal_images');

    // Solicitações
    const requests = await cached('searchRequests', 'requests', [orderBy('createdAt', 'desc'), limit(500)]);

    // Metas
    const goals = await cached('searchGoals', 'goals');

    // CSAT surveys
    const surveys = await cached('searchSurveys', 'csat_surveys', [orderBy('createdAt', 'desc'), limit(500)]);

    // Notícias
    const news = await cached('searchNews', 'news_monitor', [orderBy('createdAt', 'desc'), limit(500)]);

    // ── Match tasks ──
    const matchTasks = tasks.filter(t => {
      const title = (t.title || '').toLowerCase();
      const desc  = (t.description || '').toLowerCase();
      const id    = (t.id || '').toLowerCase();
      return title.includes(lower) || desc.includes(lower) || id.includes(lower);
    }).slice(0, 6);

    // ── Match projects ──
    const matchProjects = projects.filter(p => {
      return (p.name || '').toLowerCase().includes(lower)
        || (p.description || '').toLowerCase().includes(lower);
    }).slice(0, 4);

    // ── Match users ──
    const matchUsers = users.filter(u => {
      return (u.name || '').toLowerCase().includes(lower)
        || (u.email || '').toLowerCase().includes(lower);
    }).slice(0, 4);

    // ── Match portal tips ──
    const matchTips = tips.filter(t => {
      const title    = (t.title || '').toLowerCase();
      const city     = (t.city || '').toLowerCase();
      const country  = (t.country || '').toLowerCase();
      const continent= (t.continent || '').toLowerCase();
      const segRaw   = t.segments;
      const segments = (Array.isArray(segRaw) ? segRaw : typeof segRaw === 'object' && segRaw ? Object.keys(segRaw) : []).join(' ').toLowerCase();
      return title.includes(lower) || city.includes(lower) || country.includes(lower)
        || continent.includes(lower) || segments.includes(lower);
    }).slice(0, 4);

    // ── Match solicitações ──
    const matchRequests = requests.filter(r => {
      return (r.requesterName || '').toLowerCase().includes(lower)
        || (r.typeName || '').toLowerCase().includes(lower)
        || (r.description || '').toLowerCase().includes(lower)
        || (r.requestingArea || '').toLowerCase().includes(lower);
    }).slice(0, 4);

    // ── Match metas ──
    const matchGoals = goals.filter(g => {
      return (g.titulo || '').toLowerCase().includes(lower)
        || (g.descricao || '').toLowerCase().includes(lower);
    }).slice(0, 4);

    // ── Match CSAT ──
    const matchSurveys = surveys.filter(s => {
      return (s.taskTitle || '').toLowerCase().includes(lower)
        || (s.clientName || '').toLowerCase().includes(lower)
        || (s.comment || '').toLowerCase().includes(lower)
        || (s.projectName || '').toLowerCase().includes(lower);
    }).slice(0, 4);

    // ── Match imagens do portal ──
    const matchImages = images.filter(i => {
      return (i.name || '').toLowerCase().includes(lower)
        || (i.placeName || '').toLowerCase().includes(lower)
        || (i.country || '').toLowerCase().includes(lower)
        || (i.city || '').toLowerCase().includes(lower)
        || (Array.isArray(i.tags) ? i.tags : []).join(' ').toLowerCase().includes(lower);
    }).slice(0, 4);

    // ── Match notícias ──
    const matchNews = news.filter(n => {
      return (n.title || '').toLowerCase().includes(lower)
        || (n.description || '').toLowerCase().includes(lower)
        || (n.category || '').toLowerCase().includes(lower);
    }).slice(0, 4);

    const total = matchTasks.length + matchProjects.length + matchUsers.length + matchTips.length
      + matchRequests.length + matchGoals.length + matchSurveys.length + matchImages.length + matchNews.length;
    if (!total) {
      this._showSearchResults(`
        <div style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.8125rem;">
          Nenhum resultado para "<strong>${esc(q)}</strong>"
        </div>`);
      return;
    }

    const STATUS_ICONS = {
      todo:'🔵', in_progress:'🟡', review:'🟣', done:'🟢', backlog:'⚪', cancelled:'🔴', rework:'🟠'
    };

    let html = '';

    if (matchTasks.length) {
      html += `<div style="padding:6px 12px;font-size:0.625rem;font-weight:700;text-transform:uppercase;
        letter-spacing:.08em;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">
        Tarefas (${matchTasks.length})</div>`;
      html += matchTasks.map(t => {
        const assignee = users.find(u => (t.assignees||[]).includes(u.id));
        return `<div class="search-result-item" data-type="task" data-id="${esc(t.id)}"
          style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;
          border-bottom:1px solid var(--border-subtle);transition:background .1s;"
          onmouseover="this.style.background='var(--bg-surface)'"
          onmouseout="this.style.background=''">
          <span style="font-size:0.875rem;">${STATUS_ICONS[t.status]||'⚪'}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.8125rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;
              white-space:nowrap;">${esc(t.title)}</div>
            ${assignee ? `<div style="font-size:0.6875rem;color:var(--text-muted);">${esc(assignee.name)}</div>` : ''}
          </div>
          ${t.priority ? `<span style="font-size:0.625rem;padding:2px 6px;border-radius:10px;
            background:${t.priority==='urgent'?'#EF444420':t.priority==='high'?'#F9731620':'var(--bg-surface)'};
            color:${t.priority==='urgent'?'#EF4444':t.priority==='high'?'#F97316':'var(--text-muted)'};
            font-weight:600;text-transform:uppercase;">${t.priority}</span>` : ''}
        </div>`;
      }).join('');
    }

    if (matchProjects.length) {
      html += `<div style="padding:6px 12px;font-size:0.625rem;font-weight:700;text-transform:uppercase;
        letter-spacing:.08em;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">
        Projetos (${matchProjects.length})</div>`;
      html += matchProjects.map(p => `
        <div class="search-result-item" data-type="project" data-id="${esc(p.id)}"
          style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;
          border-bottom:1px solid var(--border-subtle);transition:background .1s;"
          onmouseover="this.style.background='var(--bg-surface)'"
          onmouseout="this.style.background=''">
          <span style="font-size:0.875rem;">${p.icon||'◈'}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.8125rem;font-weight:500;">${esc(p.name)}</div>
            <div style="font-size:0.6875rem;color:var(--text-muted);">${esc(p.status||'')}</div>
          </div>
        </div>`).join('');
    }

    if (matchUsers.length) {
      html += `<div style="padding:6px 12px;font-size:0.625rem;font-weight:700;text-transform:uppercase;
        letter-spacing:.08em;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">
        Usuários (${matchUsers.length})</div>`;
      html += matchUsers.map(u => `
        <div class="search-result-item" data-type="user" data-id="${esc(u.id)}"
          style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;
          border-bottom:1px solid var(--border-subtle);transition:background .1s;"
          onmouseover="this.style.background='var(--bg-surface)'"
          onmouseout="this.style.background=''">
          <div style="width:24px;height:24px;border-radius:50%;background:${u.avatarColor||'#6B7280'};
            display:flex;align-items:center;justify-content:center;font-size:0.625rem;
            color:white;font-weight:600;flex-shrink:0;">
            ${(u.name||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.8125rem;font-weight:500;">${esc(u.name)}</div>
            <div style="font-size:0.6875rem;color:var(--text-muted);">${esc(u.email||'')}</div>
          </div>
        </div>`).join('');
    }

    if (matchTips.length) {
      const PRIORITY_COLORS = { high:'#EF4444', medium:'#F97316', low:'#22C55E' };
      html += `<div style="padding:6px 12px;font-size:0.625rem;font-weight:700;text-transform:uppercase;
        letter-spacing:.08em;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">
        Dicas do Portal (${matchTips.length})</div>`;
      html += matchTips.map(t => `
        <div class="search-result-item" data-type="tip" data-id="${esc(t.id)}"
          style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;
          border-bottom:1px solid var(--border-subtle);transition:background .1s;"
          onmouseover="this.style.background='var(--bg-surface)'"
          onmouseout="this.style.background=''">
          <span style="font-size:0.875rem;">🌍</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.8125rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;
              white-space:nowrap;">${esc(t.title || t.city || 'Sem título')}</div>
            <div style="font-size:0.6875rem;color:var(--text-muted);">
              ${esc([t.city, t.country, t.continent].filter(Boolean).join(' · '))}
            </div>
          </div>
          ${t.priority ? `<span style="font-size:0.625rem;padding:2px 6px;border-radius:10px;
            background:${(PRIORITY_COLORS[t.priority]||'#6B7280')}20;
            color:${PRIORITY_COLORS[t.priority]||'#6B7280'};
            font-weight:600;text-transform:uppercase;">${t.priority}</span>` : ''}
        </div>`).join('');
    }

    if (matchRequests.length) {
      const REQ_STATUS = { pending:'🟡', converted:'🟢', rejected:'🔴' };
      html += `<div style="padding:6px 12px;font-size:0.625rem;font-weight:700;text-transform:uppercase;
        letter-spacing:.08em;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">
        Solicitações (${matchRequests.length})</div>`;
      html += matchRequests.map(r => `
        <div class="search-result-item" data-type="request" data-id="${esc(r.id)}"
          style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;
          border-bottom:1px solid var(--border-subtle);transition:background .1s;"
          onmouseover="this.style.background='var(--bg-surface)'"
          onmouseout="this.style.background=''">
          <span style="font-size:0.875rem;">${REQ_STATUS[r.status]||'⚪'}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.8125rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;
              white-space:nowrap;">${esc(r.typeName || r.description || 'Solicitação')}</div>
            <div style="font-size:0.6875rem;color:var(--text-muted);">
              ${esc([r.requesterName, r.requestingArea].filter(Boolean).join(' · '))}
            </div>
          </div>
          ${r.urgency ? `<span style="font-size:0.625rem;padding:2px 6px;border-radius:10px;
            background:#EF444420;color:#EF4444;font-weight:600;">URGENTE</span>` : ''}
        </div>`).join('');
    }

    if (matchGoals.length) {
      const GOAL_STATUS = { rascunho:'📝', publicada:'🟢', encerrada:'⚫' };
      html += `<div style="padding:6px 12px;font-size:0.625rem;font-weight:700;text-transform:uppercase;
        letter-spacing:.08em;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">
        Metas (${matchGoals.length})</div>`;
      html += matchGoals.map(g => `
        <div class="search-result-item" data-type="goal" data-id="${esc(g.id)}"
          style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;
          border-bottom:1px solid var(--border-subtle);transition:background .1s;"
          onmouseover="this.style.background='var(--bg-surface)'"
          onmouseout="this.style.background=''">
          <span style="font-size:0.875rem;">${GOAL_STATUS[g.status]||'📋'}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.8125rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;
              white-space:nowrap;">${esc(g.titulo)}</div>
            <div style="font-size:0.6875rem;color:var(--text-muted);">
              ${esc([g.escopo, g.nucleo].filter(Boolean).join(' · '))}
            </div>
          </div>
        </div>`).join('');
    }

    if (matchSurveys.length) {
      const SCORE_COLOR = s => s >= 4 ? '#22C55E' : s >= 3 ? '#F97316' : '#EF4444';
      html += `<div style="padding:6px 12px;font-size:0.625rem;font-weight:700;text-transform:uppercase;
        letter-spacing:.08em;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">
        CSAT (${matchSurveys.length})</div>`;
      html += matchSurveys.map(s => `
        <div class="search-result-item" data-type="csat" data-id="${esc(s.id)}"
          style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;
          border-bottom:1px solid var(--border-subtle);transition:background .1s;"
          onmouseover="this.style.background='var(--bg-surface)'"
          onmouseout="this.style.background=''">
          <span style="font-size:0.875rem;">💬</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.8125rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;
              white-space:nowrap;">${esc(s.taskTitle || s.clientName || 'Pesquisa CSAT')}</div>
            <div style="font-size:0.6875rem;color:var(--text-muted);">
              ${esc([s.clientName, s.comment ? s.comment.substring(0,60)+'…' : ''].filter(Boolean).join(' — '))}
            </div>
          </div>
          ${s.score ? `<span style="font-size:0.75rem;font-weight:700;color:${SCORE_COLOR(s.score)};">
            ${'★'.repeat(s.score)}</span>` : ''}
        </div>`).join('');
    }

    if (matchImages.length) {
      html += `<div style="padding:6px 12px;font-size:0.625rem;font-weight:700;text-transform:uppercase;
        letter-spacing:.08em;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">
        Banco de Imagens (${matchImages.length})</div>`;
      html += matchImages.map(i => `
        <div class="search-result-item" data-type="image" data-id="${esc(i.id)}"
          style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;
          border-bottom:1px solid var(--border-subtle);transition:background .1s;"
          onmouseover="this.style.background='var(--bg-surface)'"
          onmouseout="this.style.background=''">
          <span style="font-size:0.875rem;">🖼️</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.8125rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;
              white-space:nowrap;">${esc(i.name || i.placeName || i.originalName || 'Imagem')}</div>
            <div style="font-size:0.6875rem;color:var(--text-muted);">
              ${esc([i.city, i.country, i.continent].filter(Boolean).join(' · '))}
            </div>
          </div>
          ${i.type ? `<span style="font-size:0.625rem;padding:2px 6px;border-radius:10px;
            background:var(--bg-surface);color:var(--text-muted);font-weight:600;">${esc(i.type)}</span>` : ''}
        </div>`).join('');
    }

    if (matchNews.length) {
      html += `<div style="padding:6px 12px;font-size:0.625rem;font-weight:700;text-transform:uppercase;
        letter-spacing:.08em;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">
        Notícias (${matchNews.length})</div>`;
      html += matchNews.map(n => `
        <div class="search-result-item" data-type="news" data-id="${esc(n.id)}"
          style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;
          border-bottom:1px solid var(--border-subtle);transition:background .1s;"
          onmouseover="this.style.background='var(--bg-surface)'"
          onmouseout="this.style.background=''">
          <span style="font-size:0.875rem;">📰</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.8125rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;
              white-space:nowrap;">${esc(n.title)}</div>
            <div style="font-size:0.6875rem;color:var(--text-muted);">
              ${esc([n.category, n.subcategory].filter(Boolean).join(' · '))}
            </div>
          </div>
        </div>`).join('');
    }

    this._showSearchResults(html);
  }

  _showSearchResults(html) {
    this._closeSearchResults();
    const container = this.el.querySelector('.header-search');
    if (!container) return;
    const dropdown = document.createElement('div');
    dropdown.className = 'search-results-dropdown';
    dropdown.style.cssText = `position:absolute;top:100%;left:0;right:0;z-index:200;
      background:var(--bg-card);border:1px solid var(--border-subtle);
      border-radius:0 0 var(--radius-md) var(--radius-md);box-shadow:var(--shadow-lg);
      max-height:420px;overflow-y:auto;`;
    dropdown.innerHTML = html;

    // Click handlers for results
    dropdown.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const type = item.dataset.type;
        const id   = item.dataset.id;
        this._closeSearchResults();
        const input = this.el.querySelector('#global-search-input');
        if (input) input.value = '';

        if (type === 'task') {
          // Navigate to tasks and open modal
          router.navigate('tasks');
          setTimeout(async () => {
            try {
              const { openTaskModal } = await import('./taskModal.js');
              const allTasks = store.get('allTasks') || [];
              const task = allTasks.find(t => t.id === id);
              if (task) openTaskModal({ taskData: task, onSave: () => {} });
            } catch {}
          }, 300);
        } else if (type === 'project') {
          router.navigate('projects');
        } else if (type === 'user') {
          if (store.can('system_manage_users')) router.navigate('users');
          else router.navigate('team');
        } else if (type === 'tip') {
          router.navigate('portal');
        } else if (type === 'request') {
          router.navigate('requests');
        } else if (type === 'goal') {
          router.navigate('goals');
        } else if (type === 'csat') {
          router.navigate('csat');
        } else if (type === 'image') {
          router.navigate('portal-images');
        } else if (type === 'news') {
          router.navigate('news-monitor');
        }
      });
    });

    container.style.position = 'relative';
    container.appendChild(dropdown);
  }

  _closeSearchResults() {
    document.querySelectorAll('.search-results-dropdown').forEach(el => el.remove());
  }

  update() {
    this.render();
  }

  destroy() {
    this._unsubRoute?.();
  }
}

export default Header;
