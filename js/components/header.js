/**
 * PRIMETOUR — Header Component
 * Cabeçalho principal do app
 */

import { store }   from '../store.js';
import { signOut } from '../auth/auth.js';
import { router }  from '../router.js';
import { toast }   from './toast.js';
import { toggleNotificationPanel } from './notificationPanel.js';
import { toggleHelpPanel } from './helpPanel.js';
import { renderIcon, ICONS } from './icons.js';
import { userAvatarInner } from './userAvatar.js';
import {
  collection, getDocs, query, orderBy, limit, where,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase.js';

/**
 * 4.19+: títulos de página + ícones agora vêm de uma única fonte.
 * - Título: definido aqui (label longo do header pode diferir do label
 *   curto do sidebar — ex: sidebar="Steps", header="Steps · Kanban").
 * - Ícone: SEMPRE puxado de `./icons.js` via `renderIcon(route)`.
 *   Isto garante que o ícone visto na barra lateral seja IDÊNTICO ao
 *   do header da página correspondente.
 *
 * Cobre TODAS as ~40 rotas do sidebar. Se nova rota for criada e o
 * usuário acessar antes do PAGE_TITLES ser atualizado, fallback usa
 * a chave da rota como título e tenta `renderIcon(route)`.
 */
const PAGE_TITLES = {
  // Tarefas e Projetos
  'check-in':         { title: 'Check-in' },
  dashboard:          { title: 'Meu Painel' },
  tasks:              { title: 'Tarefas' },
  projects:           { title: 'Projetos' },
  kanban:             { title: 'Steps' },
  calendar:           { title: 'Calendário' },
  timeline:           { title: 'Timeline / Gantt' },
  // Gestão de Equipe
  workspaces:         { title: 'Squads' },
  requests:           { title: 'Solicitações' },
  notifications:      { title: 'Notificações' },
  team:               { title: 'Equipe' },
  feedbacks:          { title: 'Feedbacks' },
  goals:              { title: 'Metas' },
  csat:               { title: 'CSAT' },
  // Serviços
  'content-calendar': { title: 'Calendário de Conteúdo' },
  roteiros:           { title: 'Gerador de Roteiros' },
  'portal-tips':      { title: 'Portal de Dicas' },
  'portal-areas':     { title: 'Templates de Áreas' },
  'portal-images':    { title: 'Banco de Imagens' },
  'landing-pages':    { title: 'Landing Pages' },
  cms:                { title: 'CMS / Site' },
  'arts-editor':      { title: 'Editor de Artes' },
  'luxury-travel':    { title: 'Revista Luxury Travel' },
  'news-monitor':     { title: 'Pautas e Clipping' },
  // Análise de Dados
  dashboards:         { title: 'Produtividade' },
  'nl-performance':   { title: 'Performance de Newsletters' },
  'meta-performance': { title: 'Performance de Instagram' },
  'ga-performance':   { title: 'Performance Google Analytics' },
  'portal-dashboard': { title: 'Dashboard do Portal de Dicas' },
  'roteiro-dashboard':{ title: 'Dashboard de Roteiros' },
  // Administração
  users:              { title: 'Usuários' },
  sectors:            { title: 'Setores e Squads' },
  'task-types':       { title: 'Tipos de Tarefa' },
  roles:              { title: 'Roles e Acesso' },
  'ai-hub':           { title: 'IA Hub' },
  audit:              { title: 'Auditoria' },
  settings:           { title: 'Configurações' },
  about:              { title: 'Sobre o Sistema' },
  help:               { title: 'Ajuda' },
  // Outros
  integrations:       { title: 'Integrações' },
  profile:            { title: 'Meu Perfil' },
  absences:           { title: 'Ausências' },
};

const PALETTES = [
  { id:'midnight',  label:'Midnight Navy',  colors:['#0A1628','#D4A843','#152440'] },
  { id:'platinum',  label:'Platinum',        colors:['#FFFFFF','#6366F1','#EDF1F7'] },
  { id:'charcoal',  label:'Charcoal',        colors:['#1E1E22','#E94560','#2D2D32'] },
  { id:'ocean',     label:'Ocean Blue',      colors:['#0F172A','#00BCD4','#1E3A5F'] },
  { id:'forest',    label:'Forest Green',    colors:['#0B1B0E','#4CAF50','#1A3A22'] },
  { id:'royal',     label:'Royal Purple',    colors:['#150D24','#9C27B0','#2A1D47'] },
  { id:'sunset',    label:'Warm Sunset',     colors:['#271510','#FF6B35','#452B1E'] },
  { id:'rose',      label:'Rose',            colors:['#260E18','#E91E63','#451D2E'] },
  { id:'sand',      label:'Sand',            colors:['#FAF7F2','#8B6914','#E8E0D2'] },
  { id:'portal',    label:'Portal (azul/branco)', colors:['#1F2937','#2563EB','#FFFFFF'] },
];

const FONTS = [
  { id:'outfit',      label:'Outfit',            family:'Outfit' },
  { id:'inter',       label:'Inter',             family:'Inter' },
  { id:'dm-sans',     label:'DM Sans',           family:'DM Sans' },
  { id:'jakarta',     label:'Jakarta Sans',      family:'Plus Jakarta Sans' },
  { id:'nunito',      label:'Nunito',             family:'Nunito' },
  { id:'source-sans', label:'Source Sans',        family:'Source Sans 3' },
  { id:'system',      label:'Sistema',            family:'system-ui' },
];

function _buildCustomizePanel() {
  const currentPalette = document.documentElement.dataset.palette || 'midnight';
  const currentFont = document.documentElement.dataset.font || 'outfit';

  // ── Seção: Paletas ──
  const paletteItems = PALETTES.map(p => {
    const active = currentPalette === p.id;
    const swatches = p.colors.map(c =>
      '<span style="width:12px;height:12px;border-radius:50%;background:' + c +
      ';border:1px solid rgba(128,128,128,0.25);display:inline-block;"></span>'
    ).join('');
    return '<button class="dropdown-item palette-option' + (active ? ' active' : '') +
      '" data-palette="' + p.id + '"' +
      ' style="display:flex;align-items:center;gap:8px;padding:7px 14px;' +
      (active ? 'background:var(--bg-hover);' : '') + '">' +
      '<div style="display:flex;gap:2px;">' + swatches + '</div>' +
      '<span style="font-size:0.8125rem;font-weight:' + (active ? '600' : '400') +
      ';color:' + (active ? 'var(--brand-gold)' : 'var(--text-primary)') + ';">' + p.label + '</span>' +
      (active ? '<span style="margin-left:auto;font-size:0.6875rem;color:var(--brand-gold);">✓</span>' : '') +
      '</button>';
  }).join('');

  // ── Seção: Fontes ──
  const fontItems = FONTS.map(f => {
    const active = currentFont === f.id;
    return '<button class="dropdown-item font-option' + (active ? ' active' : '') +
      '" data-font="' + f.id + '"' +
      ' style="display:flex;align-items:center;gap:8px;padding:7px 14px;' +
      (active ? 'background:var(--bg-hover);' : '') + '">' +
      '<span style="font-size:0.8125rem;font-family:\'' + f.family + '\',sans-serif;font-weight:' +
      (active ? '600' : '400') + ';color:' + (active ? 'var(--brand-gold)' : 'var(--text-primary)') +
      ';">' + f.label + '</span>' +
      (active ? '<span style="margin-left:auto;font-size:0.6875rem;color:var(--brand-gold);">✓</span>' : '') +
      '</button>';
  }).join('');

  return `
    <div style="padding:10px 14px 6px;font-size:0.6875rem;font-weight:700;text-transform:uppercase;
      letter-spacing:.06em;color:var(--text-muted);">Paleta de Cores</div>
    ${paletteItems}
    <div style="height:1px;background:var(--border-subtle);margin:6px 0;"></div>
    <div style="padding:6px 14px;font-size:0.6875rem;font-weight:700;text-transform:uppercase;
      letter-spacing:.06em;color:var(--text-muted);">Fonte</div>
    ${fontItems}
  `;
}

export class Header {
  constructor() {
    this.el = null;
    this._unsubRoute = null;
  }

  render() {
    const route = store.get('currentRoute') || 'dashboard';
    const page  = PAGE_TITLES[route] || { title: 'PRIMETOUR' };
    const profile = store.get('userProfile');
    const initials = store.getUserInitials();
    const avatarColor = profile?.avatarColor || '#3B82F6';
    // 4.19+: ícone vem do mesmo conjunto SVG do sidebar (single source of truth).
    // Fallback gracioso: se rota nova não tem entry no ICONS, omite ícone.
    const iconHtml = ICONS[route]
      ? `<span class="app-header-icon" style="color:var(--text-muted); margin-right:8px; display:inline-flex; vertical-align:middle;">${renderIcon(route, { size: 18 })}</span>`
      : '';

    const html = `
      <div class="app-header-title">
        ${iconHtml}<span style="vertical-align:middle;">${page.title}</span>
      </div>

      <div class="header-search">
        <span class="header-search-icon" style="display:inline-flex;align-items:center;">${renderIcon('search', { size: 16 })}</span>
        <input
          type="text"
          class="header-search-input"
          placeholder="Buscar tarefas, projetos..."
          id="global-search-input"
          autocomplete="off"
        />
      </div>

      <div class="header-actions">
        <!-- Online users em tempo real (presence). Mostra avatares dos
             N primeiros + count se houver mais. Tooltip lista nomes. -->
        <div id="header-online-users" style="display:flex;align-items:center;
          margin-right:8px;"></div>

        <button class="header-action-btn" id="notif-btn" title="Notificações"
          style="position:relative;display:inline-flex;align-items:center;justify-content:center;">
          ${renderIcon('bell', { size: 18 })}
          <span id="notif-badge" style="display:none;position:absolute;top:2px;right:2px;
            min-width:16px;height:16px;border-radius:8px;background:#EF4444;color:#fff;
            font-size:0.5625rem;font-weight:700;line-height:16px;text-align:center;
            padding:0 4px;"></span>
        </button>

        <div class="dropdown" style="position:relative;">
          <button class="header-action-btn" id="palette-toggle-btn"
            title="Paleta de cores"
            style="display:inline-flex;align-items:center;justify-content:center;">
            ${renderIcon('palette', { size: 18 })}
          </button>
          <div class="dropdown-menu palette-dropdown" id="palette-dropdown"
            style="display:none;min-width:220px;max-height:480px;overflow-y:auto;">
            ${_buildCustomizePanel()}
          </div>
        </div>

        <button class="header-action-btn" id="help-btn" title="Ajuda"
          style="display:inline-flex;align-items:center;justify-content:center;">
          ${renderIcon('help', { size: 18 })}
        </button>

        <div class="dropdown">
          <button class="header-action-btn" id="user-avatar-btn"
            style="background:${avatarColor}; color:white; font-size:0.75rem; font-weight:600; border:none;
              position:relative; overflow:hidden;"
            title="${profile?.name || 'Usuário'}"
          >${profile?.photoURL
              ? `<img src="${profile.photoURL}" alt="${initials}"
                  onerror="this.style.display='none';"
                  style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;" />${initials}`
              : initials}</button>
          
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

    // Palette picker
    const paletteBtn = this.el.querySelector('#palette-toggle-btn');
    const paletteDrop = this.el.querySelector('#palette-dropdown');
    paletteBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = paletteDrop.style.display !== 'none';
      if (isVisible) {
        paletteDrop.style.display = 'none';
      } else {
        const rect = paletteBtn.getBoundingClientRect();
        paletteDrop.style.top = (rect.bottom + 6) + 'px';
        paletteDrop.style.right = (window.innerWidth - rect.right) + 'px';
        paletteDrop.style.display = 'block';
      }
    });
    // ── Palette selection ──
    paletteDrop?.querySelectorAll('[data-palette]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const paletteId = item.dataset.palette;
        document.documentElement.dataset.palette = paletteId;
        localStorage.setItem('primetour-palette', paletteId);
        // Rebuild panel to reflect new active state
        paletteDrop.innerHTML = _buildCustomizePanel();
        this._reattachCustomizeEvents(paletteDrop);
        // Save to user profile
        const uid = store.get('currentUser')?.uid;
        if (uid) {
          import('../auth/auth.js').then(({ updateUserProfile }) => {
            updateUserProfile(uid, { 'prefs.palette': paletteId }).catch(() => {});
          });
        }
      });
    });
    // ── Font selection ──
    paletteDrop?.querySelectorAll('[data-font]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const fontId = item.dataset.font;
        if (fontId === 'outfit') {
          delete document.documentElement.dataset.font;
        } else {
          document.documentElement.dataset.font = fontId;
        }
        localStorage.setItem('primetour-font', fontId);
        // Rebuild panel to reflect new active state
        paletteDrop.innerHTML = _buildCustomizePanel();
        this._reattachCustomizeEvents(paletteDrop);
        // Save to user profile
        const uid = store.get('currentUser')?.uid;
        if (uid) {
          import('../auth/auth.js').then(({ updateUserProfile }) => {
            updateUserProfile(uid, { 'prefs.font': fontId }).catch(() => {});
          });
        }
      });
    });
    document.addEventListener('click', () => {
      if (paletteDrop) paletteDrop.style.display = 'none';
    });

    // Help button
    const helpBtn = this.el.querySelector('#help-btn');
    helpBtn?.addEventListener('click', () => toggleHelpPanel());

    // Notifications bell
    const notifBtn = this.el.querySelector('#notif-btn');
    notifBtn?.addEventListener('click', () => toggleNotificationPanel());

    // Subscribe to unread count for badge
    const updateBadge = (count) => {
      const badge = this.el.querySelector('#notif-badge');
      if (!badge) return;
      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.display = 'block';
      } else {
        badge.style.display = 'none';
      }
    };
    updateBadge(store.get('unreadCount') || 0);
    this._unsubNotif = store.subscribe('unreadCount', updateBadge);

    // ── Online users (presence) ─────────────────────────────
    // Renderiza avatares dos users em tempo real, separando ATIVOS
    // (interagindo agora) de AUSENTES (aba aberta sem interação por 5min+).
    // store.onlineUsers = ativos · store.idleUsers = ausentes.
    const renderOnlineUsers = () => {
      const wrap = this.el.querySelector('#header-online-users');
      if (!wrap) return;
      // 4.24+ Bug fix presence stuck: o tooltip era criado em closure scope
      // dentro desta função; quando o subscriber re-disparava (presença atualiza
      // a cada minuto), criava novo closure e o tooltip antigo ficava órfão
      // no DOM sem listener pra removê-lo. Solução: limpar QUALQUER tooltip
      // órfão de hover no início de cada re-render.
      document.querySelectorAll('.online-user-tip').forEach(el => el.remove());
      const currentUid = store.get('currentUser')?.uid;
      const active = (store.get('onlineUsers') || []).filter(u => u.uid !== currentUid);
      const idle   = (store.get('idleUsers')   || []).filter(u => u.uid !== currentUid);
      const total  = active.length + idle.length;
      if (total === 0) {
        wrap.innerHTML = '';
        return;
      }
      const MAX_VISIBLE = 4;
      const escAttr = s => String(s||'').replace(/"/g, '&quot;');
      const escHtml = s => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

      const usersById = new Map((store.get('users') || []).map(u => [u.id, u]));
      const enrich = (u, state) => {
        const full = usersById.get(u.uid);
        // 4.35.27+ photoURL: presence doc só passou a gravar foto recentemente,
        // então até todos terem re-feito heartbeat usamos o `users` store como
        // fallback (que tem photoURL sincronizado da SSO).
        return {
          ...u,
          state,
          sector:   full?.sector || full?.department || '',
          photoURL: u.photoURL || full?.photoURL || null,
          avatarColor: u.avatarColor || full?.avatarColor || '#3B82F6',
        };
      };
      // Mostra ativos primeiro, depois ausentes
      const allOthers = [
        ...active.map(u => enrich(u, 'active')),
        ...idle.map(u   => enrich(u, 'idle')),
      ];
      const visibleEnriched = allOthers.slice(0, MAX_VISIBLE);
      const overflow = allOthers.length - visibleEnriched.length;

      // Resumo: "5 ativos · 2 ausentes" — flexível conforme o que tem
      const summary = active.length && idle.length
        ? `<span style="color:var(--text-secondary);">${active.length} ativo${active.length!==1?'s':''}</span> · <span style="color:var(--text-muted);">${idle.length} ausente${idle.length!==1?'s':''}</span>`
        : active.length
          ? `<span style="color:var(--text-secondary);">${active.length} ativo${active.length!==1?'s':''}</span>`
          : `<span style="color:var(--text-muted);">${idle.length} ausente${idle.length!==1?'s':''}</span>`;

      wrap.innerHTML = `
        <div style="display:flex;align-items:center;cursor:default;gap:8px;">
          <span style="font-size:0.75rem;color:var(--text-muted);font-weight:500;
            white-space:nowrap;letter-spacing:0.01em;">${summary}</span>
          <div style="display:flex;align-items:center;">
          ${visibleEnriched.map(u => {
            const dotColor = u.state === 'idle' ? '#F59E0B' : '#22C55E';
            const opacity  = u.state === 'idle' ? '0.7' : '1';
            // 4.34+ Wrapper externo carrega o data-* + dot de status; avatar real fica DENTRO
            // (com overflow:hidden via CSS pra crop circular da foto). O dot precisa ficar
            // FORA do overflow:hidden, então usa um wrapper extra.
            return `<div class="header-online-avatar" style="
              width:28px;height:28px;border:2px solid var(--bg-card,#fff);opacity:${opacity};
              border-radius:50%;margin-left:-6px;position:relative;cursor:pointer;
              box-sizing:content-box;"
              data-uid="${escAttr(u.uid || '')}"
              data-name="${escAttr(u.name || 'Usuário')}"
              data-email="${escAttr(u.email || '')}"
              data-sector="${escAttr(u.sector || '')}"
              data-state="${u.state}"
              data-last-activity="${u.lastActivityAt || (u.lastSeen?.toMillis?.() || '')}"
              data-last-seen="${u.lastSeen?.toMillis?.() || ''}">
              <div class="avatar avatar-sm" style="
                background:${u.avatarColor || '#3B82F6'};width:28px;height:28px;
                font-size:0.625rem;font-weight:600;color:#fff;">
                ${userAvatarInner(u)}
              </div>
              <span style="position:absolute;bottom:-2px;right:-2px;width:8px;height:8px;
                background:${dotColor};border:1.5px solid var(--bg-card,#fff);border-radius:50%;
                z-index:1;"></span>
            </div>`;
          }).join('')}
          ${overflow > 0 ? `<button class="header-online-overflow" type="button" style="
            width:28px;height:28px;border-radius:50%;
            background:var(--bg-elevated);color:var(--text-secondary);
            font-size:0.625rem;font-weight:600;
            display:flex;align-items:center;justify-content:center;
            border:2px solid var(--bg-card,#fff);margin-left:-6px;cursor:pointer;
            font-family:inherit;padding:0;transition:background 0.15s;"
            title="Ver todos os ${total} usuários (ativos + ausentes)">
            +${overflow}
          </button>` : ''}
          </div>
        </div>
      `;

      // Tooltip custom: aparece imediato no hover (sem delay do title nativo).
      // Mostra nome + email + role com indicador "online agora". Posiciona
      // abaixo do avatar e centralizado.
      let tip = null;
      const removeTip = () => {
        if (tip) { tip.remove(); tip = null; }
      };
      const showTip = (anchor, html) => {
        removeTip();
        tip = document.createElement('div');
        tip.className = 'online-user-tip';
        tip.innerHTML = html;
        Object.assign(tip.style, {
          position:        'fixed',
          zIndex:          '9999',
          background:      'var(--bg-card, #1A2332)',
          color:           'var(--text-primary, #E8ECF1)',
          border:          '1px solid var(--border-default, #1E2D3D)',
          borderRadius:    'var(--radius-md, 8px)',
          padding:         '8px 12px',
          fontSize:        '0.75rem',
          lineHeight:      '1.4',
          boxShadow:       '0 8px 24px rgba(0,0,0,0.35)',
          pointerEvents:   'none',
          maxWidth:        '260px',
          whiteSpace:      'nowrap',
          fontFamily:      'var(--font-ui)',
        });
        document.body.appendChild(tip);
        const r = anchor.getBoundingClientRect();
        const t = tip.getBoundingClientRect();
        let left = r.left + (r.width / 2) - (t.width / 2);
        // Garante que não corta na tela
        const margin = 8;
        if (left < margin) left = margin;
        if (left + t.width > window.innerWidth - margin) left = window.innerWidth - t.width - margin;
        const top = r.bottom + 8;
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
      };

      // Helper: formata "ausente há X" baseado em lastActivityAt (ms timestamp)
      const formatIdleSince = (lastActivityAtMs) => {
        const ts = +lastActivityAtMs || 0;
        if (!ts) return 'ausente';
        const min = Math.floor((Date.now() - ts) / 60000);
        if (min < 1) return 'ausente agora';
        if (min < 60) return `ausente há ${min} min`;
        const h = Math.floor(min / 60);
        return `ausente há ${h}h${min % 60 ? ` ${min % 60}m` : ''}`;
      };

      wrap.querySelectorAll('.header-online-avatar').forEach(av => {
        av.addEventListener('mouseenter', () => {
          const name = av.dataset.name || 'Usuário';
          const email = av.dataset.email || '';
          const sector = av.dataset.sector || '';
          const state = av.dataset.state || 'active';
          const lastActivityAt = av.dataset.lastActivity;
          const statusLabel = state === 'idle'
            ? `<span style="color:#F59E0B;">● ${formatIdleSince(lastActivityAt)}</span>`
            : `<span style="color:#22C55E;">● ativo agora</span>`;
          const html = `
            <div style="font-weight:600;color:var(--text-primary);margin-bottom:2px;">${escHtml(name)}</div>
            <div style="font-size:0.6875rem;margin-bottom:2px;">${statusLabel}</div>
            ${email ? `<div style="font-size:0.6875rem;color:var(--text-muted);${sector ? 'margin-bottom:2px;' : ''}">${escHtml(email)}</div>` : ''}
            ${sector ? `<div style="font-size:0.6875rem;color:var(--text-muted);">🏢 ${escHtml(sector)}</div>` : ''}
          `;
          showTip(av, html);
        });
        av.addEventListener('mouseleave', removeTip);
      });

      // ── Dropdown do "+N" (click) ──
      // User pediu: ao clicar no badge "+N", abrir lista completa com
      // nome, email e área pra cada um. Mais útil que tooltip de hover
      // quando há muitos online.
      const overflowEl = wrap.querySelector('.header-online-overflow');
      let dropdown = null;
      const closeDropdown = () => {
        if (dropdown) { dropdown.remove(); dropdown = null; }
        document.removeEventListener('click', outsideClickHandler, true);
        document.removeEventListener('keydown', escHandler);
      };
      const outsideClickHandler = (e) => {
        if (!dropdown) return;
        if (dropdown.contains(e.target) || overflowEl?.contains(e.target)) return;
        closeDropdown();
      };
      const escHandler = (e) => { if (e.key === 'Escape') closeDropdown(); };

      if (overflowEl) {
        overflowEl.addEventListener('click', (e) => {
          e.stopPropagation();
          if (dropdown) { closeDropdown(); return; }
          removeTip();

          dropdown = document.createElement('div');
          dropdown.className = 'online-overflow-dropdown';
          // Lista completa, agrupada por state. Mostra ATIVOS primeiro,
          // depois AUSENTES com timestamp "ausente há X min".
          const renderItem = (u) => {
            const initials = (u.name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
            const dotColor = u.state === 'idle' ? '#F59E0B' : '#22C55E';
            const opacity  = u.state === 'idle' ? '0.7' : '1';
            // 4.35.29+ fallback pra lastSeen quando lastActivityAt está vazio
            // (acontece com docs antigos gravados antes do fix)
            const lastTs = u.lastActivityAt || u.lastSeen?.toMillis?.() || 0;
            const statusLine = u.state === 'idle'
              ? `<span style="color:#F59E0B;font-size:0.6875rem;">● ${formatIdleSince(lastTs)}</span>`
              : `<span style="color:#22C55E;font-size:0.6875rem;">● ativo agora</span>`;
            return `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;
              border-bottom:1px solid var(--border-subtle);opacity:${opacity};">
              <div class="avatar avatar-sm" style="background:${u.avatarColor || '#3B82F6'};
                width:32px;height:32px;font-size:0.6875rem;font-weight:600;color:#fff;
                display:flex;align-items:center;justify-content:center;border-radius:50%;
                flex-shrink:0;position:relative;">
                ${initials}
                <span style="position:absolute;bottom:-1px;right:-1px;width:8px;height:8px;
                  background:${dotColor};border:1.5px solid var(--bg-card,#fff);border-radius:50%;"></span>
              </div>
              <div style="min-width:0;flex:1;">
                <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);
                  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                  ${escHtml(u.name || 'Usuário')}
                </div>
                <div style="margin-top:1px;">${statusLine}</div>
                <div style="font-size:0.6875rem;color:var(--text-muted);
                  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;">
                  ${escHtml(u.email || '')}
                </div>
                ${u.sector ? `<div style="font-size:0.6875rem;color:var(--text-muted);margin-top:2px;">
                  🏢 ${escHtml(u.sector)}
                </div>` : ''}
              </div>
            </div>`;
          };

          const sectionHeader = (title) => `<div style="padding:8px 12px;
            background:var(--bg-elevated);font-size:0.6875rem;font-weight:600;
            color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">
            ${title}</div>`;

          const activeOthers = allOthers.filter(u => u.state !== 'idle');
          const idleOthers   = allOthers.filter(u => u.state === 'idle');
          let listItems = '';
          if (activeOthers.length) {
            listItems += sectionHeader(`🟢 Ativos (${activeOthers.length})`);
            listItems += activeOthers.map(renderItem).join('');
          }
          if (idleOthers.length) {
            listItems += sectionHeader(`🟡 Ausentes (${idleOthers.length})`);
            listItems += idleOthers.map(renderItem).join('');
          }

          dropdown.innerHTML = `
            <div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle);
              font-size:0.75rem;font-weight:600;color:var(--text-muted);
              text-transform:uppercase;letter-spacing:0.05em;
              display:flex;align-items:center;justify-content:space-between;">
              <span>${total} usuário${total!==1?'s':''} no sistema</span>
              <button class="online-dropdown-close" type="button" style="background:none;border:none;
                color:var(--text-muted);cursor:pointer;font-size:1rem;line-height:1;padding:0;
                font-family:inherit;">×</button>
            </div>
            <div style="max-height:340px;overflow-y:auto;">
              ${listItems}
            </div>
          `;
          Object.assign(dropdown.style, {
            position:     'fixed',
            zIndex:       '9999',
            background:   'var(--bg-card, #1A2332)',
            border:       '1px solid var(--border-default, #1E2D3D)',
            borderRadius: 'var(--radius-md, 8px)',
            boxShadow:    '0 12px 32px rgba(0,0,0,0.45)',
            width:        '300px',
            maxWidth:     'calc(100vw - 32px)',
            fontFamily:   'var(--font-ui)',
            overflow:     'hidden',
          });
          document.body.appendChild(dropdown);

          // Posiciona abaixo do badge, alinhado à direita pra não sair da tela
          const r = overflowEl.getBoundingClientRect();
          const dr = dropdown.getBoundingClientRect();
          let left = r.right - dr.width;
          const margin = 8;
          if (left < margin) left = margin;
          if (left + dr.width > window.innerWidth - margin) left = window.innerWidth - dr.width - margin;
          dropdown.style.left = `${left}px`;
          dropdown.style.top = `${r.bottom + 8}px`;

          // Fecha ao clicar no X, fora ou Esc
          dropdown.querySelector('.online-dropdown-close')?.addEventListener('click', closeDropdown);
          setTimeout(() => {
            document.addEventListener('click', outsideClickHandler, true);
            document.addEventListener('keydown', escHandler);
          }, 0);
        });
      }

      // Cleanup ao re-render (próxima chamada de renderOnlineUsers)
      wrap._cleanupTip = () => { removeTip(); closeDropdown(); };
    };
    renderOnlineUsers();
    // Subscribe em ambos: active + idle. Cada mudança re-renderiza.
    this._unsubOnline = store.subscribe('onlineUsers', renderOnlineUsers);
    this._unsubIdle   = store.subscribe('idleUsers',   renderOnlineUsers);

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
      const page = PAGE_TITLES[route] || { title: 'PRIMETOUR' };
      const titleEl = this.el.querySelector('.app-header-title');
      if (titleEl) {
        const iconHtml = ICONS[route]
          ? `<span class="app-header-icon" style="color:var(--text-muted); margin-right:8px; display:inline-flex; vertical-align:middle;">${renderIcon(route, { size: 18 })}</span>`
          : '';
        titleEl.innerHTML = `${iconHtml}<span style="vertical-align:middle;">${page.title}</span>`;
      }
    });
  }

  _reattachCustomizeEvents(paletteDrop) {
    // Re-bind palette clicks
    paletteDrop.querySelectorAll('[data-palette]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const paletteId = item.dataset.palette;
        document.documentElement.dataset.palette = paletteId;
        localStorage.setItem('primetour-palette', paletteId);
        paletteDrop.innerHTML = _buildCustomizePanel();
        this._reattachCustomizeEvents(paletteDrop);
        const uid = store.get('currentUser')?.uid;
        if (uid) {
          import('../auth/auth.js').then(({ updateUserProfile }) => {
            updateUserProfile(uid, { 'prefs.palette': paletteId }).catch(() => {});
          });
        }
      });
    });
    // Re-bind font clicks
    paletteDrop.querySelectorAll('[data-font]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const fontId = item.dataset.font;
        if (fontId === 'outfit') {
          delete document.documentElement.dataset.font;
        } else {
          document.documentElement.dataset.font = fontId;
        }
        localStorage.setItem('primetour-font', fontId);
        paletteDrop.innerHTML = _buildCustomizePanel();
        this._reattachCustomizeEvents(paletteDrop);
        const uid = store.get('currentUser')?.uid;
        if (uid) {
          import('../auth/auth.js').then(({ updateUserProfile }) => {
            updateUserProfile(uid, { 'prefs.font': fontId }).catch(() => {});
          });
        }
      });
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
      todo:'🔵', not_started:'🔵', in_progress:'🟡', review:'🟣',
      approval:'🔷', validation:'🟨',  // v4.53.1+ alinhados a STATUSES
      done:'🟢', backlog:'⚪', cancelled:'🔴', rework:'🟠'
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
    this._unsubNotif?.();
    this._unsubOnline?.();
    this._unsubIdle?.();
  }
}

export default Header;
