/**
 * PRIMETOUR — Notifications Page
 * Página dedicada para visualização e gerenciamento de notificações
 */

import { store }  from '../store.js';
import { router } from '../router.js';
import { toast }  from '../components/toast.js';
import {
  markAsRead, markAllAsRead, dismissNotification,
  NOTIF_ICONS, NOTIF_TYPE_LABELS, timeAgo,
} from '../services/notifications.js';

const esc = s => String(s||'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ─── Config ─────────────────────────────────────────────── */
const CATEGORIES = [
  { key: '',        label: 'Todas',         icon: '🔔' },
  { key: 'task',    label: 'Tarefas',       icon: '📋' },
  { key: 'request', label: 'Solicitações',  icon: '📩' },
  { key: 'csat',    label: 'CSAT',          icon: '💬' },
  { key: 'goal',    label: 'Metas',         icon: '🎯' },
  { key: 'portal',  label: 'Portal',        icon: '🌍' },
  { key: 'project', label: 'Projetos',      icon: '📊' },
];

const PAGE_SIZE = 30;

let _unsub = null;
let _filter = '';
let _search = '';
let _showUnreadOnly = false;
let _page = 0;

/* ════════════════════════════════════════════════════════════
   Render
   ════════════════════════════════════════════════════════════ */
export async function renderNotifications(container) {
  _filter = '';
  _search = '';
  _showUnreadOnly = false;
  _page = 0;

  container.innerHTML = buildPageHTML();
  wirePageEvents(container);

  // Subscribe to real-time updates
  _unsub = store.subscribe('notifications', () => {
    const list = container.querySelector('#notif-page-list');
    if (list) {
      list.innerHTML = buildListHTML();
      wireListEvents(container);
      updateCounters(container);
    }
  });
}

export function destroyNotifications() {
  if (_unsub) { _unsub(); _unsub = null; }
}

/* ════════════════════════════════════════════════════════════
   Build page HTML
   ════════════════════════════════════════════════════════════ */
function buildPageHTML() {
  const allNotifs = store.get('notifications') || [];
  const unreadCount = allNotifs.filter(n => !n.read).length;

  return `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Notificações</h1>
        <p class="page-subtitle">
          <span id="notif-total-count">${allNotifs.length}</span> notificações ·
          <span id="notif-unread-count" style="color:var(--brand-gold);font-weight:600;">${unreadCount} não lidas</span>
        </p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-secondary btn-sm" id="notif-mark-all-page"
          ${unreadCount === 0 ? 'disabled' : ''}>
          Marcar tudo como lido
        </button>
      </div>
    </div>

    <!-- Filters bar -->
    <div class="card" style="margin-bottom:20px;padding:16px 20px;">
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;">
        <!-- Search -->
        <div style="flex:1;min-width:200px;max-width:360px;position:relative;">
          <input type="text" class="form-input" id="notif-search"
            placeholder="Buscar notificações..." style="padding-left:36px;height:36px;font-size:0.8125rem;" />
          <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);
            font-size:0.875rem;color:var(--text-muted);pointer-events:none;">⌕</span>
        </div>

        <!-- Category pills -->
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          ${CATEGORIES.map(c => `
            <button class="notif-page-cat btn btn-ghost btn-sm" data-cat="${c.key}"
              style="font-size:0.75rem;padding:4px 12px;border-radius:16px;
              ${_filter === c.key ? 'background:var(--brand-gold)15;color:var(--brand-gold);font-weight:700;border:1px solid var(--brand-gold)30;' : 'color:var(--text-muted);'}">
              ${c.icon} ${esc(c.label)}
            </button>`).join('')}
        </div>

        <!-- Unread toggle -->
        <label style="display:flex;align-items:center;gap:8px;font-size:0.8125rem;
          color:var(--text-muted);cursor:pointer;margin-left:auto;white-space:nowrap;">
          <input type="checkbox" id="notif-unread-toggle" ${_showUnreadOnly ? 'checked' : ''}
            style="accent-color:var(--brand-gold);" />
          Apenas não lidas
        </label>
      </div>
    </div>

    <!-- List -->
    <div id="notif-page-list">
      ${buildListHTML()}
    </div>

    <!-- Pagination -->
    <div id="notif-pagination" style="margin-top:16px;"></div>
  `;
}

/* ════════════════════════════════════════════════════════════
   Build list
   ════════════════════════════════════════════════════════════ */
function getFilteredNotifs() {
  let notifs = store.get('notifications') || [];
  if (_filter) notifs = notifs.filter(n => n.category === _filter);
  if (_showUnreadOnly) notifs = notifs.filter(n => !n.read);
  if (_search) {
    const q = _search.toLowerCase();
    notifs = notifs.filter(n =>
      (n.title || '').toLowerCase().includes(q) ||
      (n.body || '').toLowerCase().includes(q) ||
      (n.actorName || '').toLowerCase().includes(q)
    );
  }
  return notifs;
}

function getDateGroup(timestamp) {
  const d = timestamp?.toDate?.() || (timestamp ? new Date(timestamp) : null);
  if (!d || isNaN(d.getTime())) return 'Anteriores';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
  if (d >= today) return 'Hoje';
  if (d >= yesterday) return 'Ontem';
  if (d >= weekAgo) return 'Esta semana';
  return 'Anteriores';
}

function buildListHTML() {
  const notifs = getFilteredNotifs();

  if (!notifs.length) {
    const msg = _search ? `Nenhum resultado para "${esc(_search)}"` :
      _showUnreadOnly ? 'Nenhuma notificação não lida' :
      _filter ? 'Nenhuma notificação nesta categoria' : 'Você não tem notificações';
    return `
      <div class="card" style="text-align:center;padding:60px 20px;">
        <div style="font-size:3rem;margin-bottom:16px;opacity:.3;">🔔</div>
        <div style="font-size:1rem;color:var(--text-secondary);font-weight:500;">${msg}</div>
        <div style="font-size:0.8125rem;color:var(--text-muted);margin-top:8px;">
          As notificações aparecem automaticamente quando há atividade.
        </div>
      </div>`;
  }

  // Paginate
  const total = notifs.length;
  const paged = notifs.slice(_page * PAGE_SIZE, (_page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Group by date
  const groups = {};
  const groupOrder = ['Hoje', 'Ontem', 'Esta semana', 'Anteriores'];
  for (const n of paged) {
    const g = getDateGroup(n.createdAt);
    (groups[g] ||= []).push(n);
  }

  let html = '';
  for (const label of groupOrder) {
    const items = groups[label];
    if (!items?.length) continue;
    html += `
      <div style="padding:10px 0 6px;font-size:0.75rem;font-weight:700;
        color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;">
        ${esc(label)} <span style="font-weight:400;opacity:.6;">(${items.length})</span>
      </div>
      <div class="card" style="margin-bottom:16px;overflow:hidden;">
        ${items.map(n => buildNotifRow(n)).join('')}
      </div>`;
  }

  // Pagination controls
  if (totalPages > 1) {
    html += `
      <div style="display:flex;justify-content:center;align-items:center;gap:12px;margin-top:20px;">
        <button class="btn btn-ghost btn-sm notif-prev" ${_page === 0 ? 'disabled' : ''}
          style="font-size:0.8125rem;">← Anterior</button>
        <span style="font-size:0.8125rem;color:var(--text-muted);">
          Página ${_page + 1} de ${totalPages}
        </span>
        <button class="btn btn-ghost btn-sm notif-next" ${_page >= totalPages - 1 ? 'disabled' : ''}
          style="font-size:0.8125rem;">Próxima →</button>
      </div>`;
  }

  return html;
}

function buildNotifRow(n) {
  const icon = NOTIF_ICONS[n.category] || '🔔';
  const time = timeAgo(n.createdAt);
  const isUnread = !n.read;
  const typeLabel = NOTIF_TYPE_LABELS[n.type] || '';
  const ts = n.createdAt?.toDate?.() || (n.createdAt ? new Date(n.createdAt) : null);
  const fullDate = ts ? new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(ts) : '';

  return `
    <div class="notif-page-item" data-id="${esc(n.id)}" data-route="${esc(n.route||'')}"
      style="padding:16px 20px;cursor:pointer;border-bottom:1px solid var(--border-subtle);
      display:flex;gap:14px;align-items:flex-start;transition:background .1s;
      background:${isUnread ? 'var(--bg-surface)' : 'transparent'};
      ${n.priority === 'high' ? 'border-left:3px solid #EF4444;' : ''}"
      onmouseover="this.style.background='var(--bg-elevated)'"
      onmouseout="this.style.background='${isUnread ? 'var(--bg-surface)' : 'transparent'}'">

      <!-- Icon -->
      <div style="width:40px;height:40px;border-radius:10px;display:flex;align-items:center;
        justify-content:center;font-size:1.25rem;flex-shrink:0;
        background:${isUnread ? 'var(--brand-gold)12' : 'var(--bg-elevated)'};">
        ${icon}
      </div>

      <!-- Content -->
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
          <div>
            <div style="font-size:0.875rem;font-weight:${isUnread ? '600' : '400'};
              color:var(--text-primary);line-height:1.4;">
              ${esc(n.title)}
              ${isUnread ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;
                background:var(--brand-gold);margin-left:8px;vertical-align:middle;"></span>` : ''}
            </div>
            ${n.body ? `<div style="font-size:0.8125rem;color:var(--text-secondary);margin-top:4px;
              line-height:1.5;">${esc(n.body)}</div>` : ''}
          </div>
          <div style="flex-shrink:0;text-align:right;">
            <div style="font-size:0.75rem;color:var(--text-muted);white-space:nowrap;">${esc(time)}</div>
            ${fullDate ? `<div style="font-size:0.6875rem;color:var(--text-muted);margin-top:2px;
              opacity:.6;">${esc(fullDate)}</div>` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:8px;">
          ${typeLabel ? `<span style="font-size:0.6875rem;padding:2px 8px;border-radius:10px;
            background:var(--bg-elevated);color:var(--text-muted);">${esc(typeLabel)}</span>` : ''}
          ${n.actorName ? `<span style="font-size:0.6875rem;color:var(--text-muted);">
            por ${esc(n.actorName)}</span>` : ''}
          ${n.priority === 'high' ? `<span style="font-size:0.6875rem;padding:2px 8px;border-radius:10px;
            background:#EF444418;color:#EF4444;font-weight:600;">Alta prioridade</span>` : ''}
        </div>
      </div>

      <!-- Actions -->
      <div class="notif-page-actions" style="display:flex;flex-direction:column;gap:4px;
        flex-shrink:0;opacity:0;transition:opacity .15s;">
        ${isUnread ? `<button class="btn btn-ghost btn-sm notif-read-btn" data-id="${esc(n.id)}"
          title="Marcar como lida" style="font-size:0.6875rem;padding:4px 8px;">✓ Lida</button>` : ''}
        <button class="btn btn-ghost btn-sm notif-dismiss-btn" data-id="${esc(n.id)}"
          title="Descartar" style="font-size:0.6875rem;padding:4px 8px;color:var(--text-muted);">✕</button>
      </div>
    </div>`;
}

/* ════════════════════════════════════════════════════════════
   Wire events
   ════════════════════════════════════════════════════════════ */
function wirePageEvents(container) {
  // Search
  let searchTimeout;
  container.querySelector('#notif-search')?.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      _search = e.target.value.trim();
      _page = 0;
      refreshList(container);
    }, 300);
  });

  // Category filters
  container.querySelectorAll('.notif-page-cat').forEach(btn => {
    btn.addEventListener('click', () => {
      _filter = btn.dataset.cat;
      _page = 0;
      // Update active style
      container.querySelectorAll('.notif-page-cat').forEach(b => {
        b.style.background = b.dataset.cat === _filter ? 'var(--brand-gold)15' : '';
        b.style.color = b.dataset.cat === _filter ? 'var(--brand-gold)' : 'var(--text-muted)';
        b.style.fontWeight = b.dataset.cat === _filter ? '700' : '400';
        b.style.border = b.dataset.cat === _filter ? '1px solid var(--brand-gold)30' : '';
      });
      refreshList(container);
    });
  });

  // Unread toggle
  container.querySelector('#notif-unread-toggle')?.addEventListener('change', (e) => {
    _showUnreadOnly = e.target.checked;
    _page = 0;
    refreshList(container);
  });

  // Mark all as read
  container.querySelector('#notif-mark-all-page')?.addEventListener('click', async () => {
    const userId = store.get('currentUser')?.uid;
    if (!userId) return;
    const btn = container.querySelector('#notif-mark-all-page');
    if (btn) { btn.disabled = true; btn.textContent = 'Marcando...'; }
    await markAllAsRead(userId).catch(() => {});
    toast.success('Todas as notificações marcadas como lidas.');
    if (btn) { btn.textContent = 'Marcar tudo como lido'; }
  });

  wireListEvents(container);
}

function wireListEvents(container) {
  // Click notification → navigate
  container.querySelectorAll('.notif-page-item').forEach(item => {
    // Show actions on hover
    item.addEventListener('mouseenter', () => {
      const actions = item.querySelector('.notif-page-actions');
      if (actions) actions.style.opacity = '1';
    });
    item.addEventListener('mouseleave', () => {
      const actions = item.querySelector('.notif-page-actions');
      if (actions) actions.style.opacity = '0';
    });

    item.addEventListener('click', async (e) => {
      if (e.target.closest('.notif-read-btn') || e.target.closest('.notif-dismiss-btn')) return;
      const id = item.dataset.id;
      const route = item.dataset.route;
      await markAsRead(id).catch(() => {});
      if (route) router.navigate(route);
    });
  });

  // Mark as read buttons
  container.querySelectorAll('.notif-read-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await markAsRead(btn.dataset.id).catch(() => {});
    });
  });

  // Dismiss buttons
  container.querySelectorAll('.notif-dismiss-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await dismissNotification(btn.dataset.id).catch(() => {});
    });
  });

  // Pagination
  container.querySelector('.notif-prev')?.addEventListener('click', () => {
    if (_page > 0) { _page--; refreshList(container); }
  });
  container.querySelector('.notif-next')?.addEventListener('click', () => {
    const total = getFilteredNotifs().length;
    if ((_page + 1) * PAGE_SIZE < total) { _page++; refreshList(container); }
  });
}

function refreshList(container) {
  const list = container.querySelector('#notif-page-list');
  if (list) {
    list.innerHTML = buildListHTML();
    wireListEvents(container);
    updateCounters(container);
  }
}

function updateCounters(container) {
  const allNotifs = store.get('notifications') || [];
  const unread = allNotifs.filter(n => !n.read).length;
  const totalEl = container.querySelector('#notif-total-count');
  const unreadEl = container.querySelector('#notif-unread-count');
  const markAllBtn = container.querySelector('#notif-mark-all-page');
  if (totalEl) totalEl.textContent = allNotifs.length;
  if (unreadEl) unreadEl.textContent = `${unread} não lidas`;
  if (markAllBtn) markAllBtn.disabled = unread === 0;
}
