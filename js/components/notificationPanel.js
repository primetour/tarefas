/**
 * PRIMETOUR — Notification Panel (Drawer)
 * Painel lateral com lista de notificações em tempo real
 */

import { store }  from '../store.js';
import { router } from '../router.js';
import {
  markAsRead, markAllAsRead, dismissNotification,
  NOTIF_ICONS, timeAgo,
} from '../services/notifications.js';

const esc = s => String(s||'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ─── Notification sound (Web Audio API) ─────────────────── */
let _audioCtx = null;
let _prevUnread = 0;

function playNotifSound() {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _audioCtx;
    const now = ctx.currentTime;

    // Two-tone chime: C6 → E6
    [1047, 1319].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.12);
      gain.gain.linearRampToValueAtTime(0.15, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.3);
    });
  } catch { /* AudioContext not available */ }
}

/** Call from store subscription to play sound on new unread notifications */
export function checkAndPlaySound(newUnread) {
  if (newUnread > _prevUnread && _prevUnread >= 0) {
    // Respect user sound preference
    const profile = store.get('userProfile');
    if (profile?.prefs?.notifySound !== false) {
      playNotifSound();
    }
  }
  _prevUnread = newUnread;
}

/** Reset counter (on logout) */
export function resetSoundCounter() {
  _prevUnread = 0;
}

const CATEGORIES = [
  { key: '',        label: 'Todas' },
  { key: 'task',    label: 'Tarefas' },
  { key: 'request', label: 'Solicitações' },
  { key: 'csat',    label: 'CSAT' },
  { key: 'goal',    label: 'Metas' },
  { key: 'portal',  label: 'Portal' },
  { key: 'project', label: 'Projetos' },
];

let _panel = null;
let _activeFilter = '';       // '' = all, 'task', 'csat', etc.
let _showUnreadOnly = false;
let _unsubStore = null;

/* ════════════════════════════════════════════════════════════
   Public API
   ════════════════════════════════════════════════════════════ */
export function toggleNotificationPanel() {
  if (_panel) {
    closeNotificationPanel();
  } else {
    openNotificationPanel();
  }
}

export function openNotificationPanel() {
  if (_panel) return;

  _panel = document.createElement('div');
  _panel.id = 'notification-panel';

  // Backdrop
  const backdrop = document.createElement('div');
  backdrop.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2500;
    transition:opacity .2s;opacity:0;`;
  backdrop.addEventListener('click', closeNotificationPanel);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.style.opacity = '1');
  _panel._backdrop = backdrop;

  // Drawer
  _panel.style.cssText = `position:fixed;top:0;right:0;bottom:0;width:400px;max-width:100vw;
    z-index:2501;background:var(--bg-dark);border-left:1px solid var(--border-subtle);
    display:flex;flex-direction:column;transform:translateX(100%);
    transition:transform .25s cubic-bezier(.4,0,.2,1);
    box-shadow:-4px 0 24px rgba(0,0,0,.3);`;

  _panel.innerHTML = buildPanelHTML();
  document.body.appendChild(_panel);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => _panel.style.transform = 'translateX(0)');
  });

  wireEvents();

  // Subscribe to store updates
  _unsubStore = store.subscribe('notifications', () => {
    const list = _panel?.querySelector('#notif-list');
    if (list) list.innerHTML = buildListHTML();
    wireListEvents();
  });
}

export function closeNotificationPanel() {
  if (!_panel) return;
  _panel.style.transform = 'translateX(100%)';
  _panel._backdrop.style.opacity = '0';
  const panel = _panel;
  const backdrop = _panel._backdrop;
  setTimeout(() => {
    panel.remove();
    backdrop.remove();
  }, 260);
  if (_unsubStore) { _unsubStore(); _unsubStore = null; }
  _panel = null;
}

/* ════════════════════════════════════════════════════════════
   Build HTML
   ════════════════════════════════════════════════════════════ */
function buildPanelHTML() {
  const unreadCount = store.get('unreadCount') || 0;
  return `
    <!-- Header -->
    <div style="padding:16px 20px;border-bottom:1px solid var(--border-subtle);flex-shrink:0;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:1.125rem;">🔔</span>
          <span style="font-weight:700;font-size:1rem;">Notificações</span>
          ${unreadCount > 0 ? `<span style="background:var(--brand-gold);color:#fff;font-size:0.6875rem;
            font-weight:700;padding:2px 8px;border-radius:10px;">${unreadCount}</span>` : ''}
        </div>
        <div style="display:flex;gap:6px;">
          ${unreadCount > 0 ? `<button id="notif-mark-all" class="btn btn-ghost btn-sm"
            style="font-size:0.75rem;color:var(--text-muted);">Marcar tudo como lido</button>` : ''}
          <button id="notif-close" style="border:none;background:none;cursor:pointer;
            font-size:1.25rem;color:var(--text-muted);">✕</button>
        </div>
      </div>

      <!-- Filters -->
      <div style="display:flex;gap:4px;overflow-x:auto;padding-bottom:4px;">
        ${CATEGORIES.map(c => `
          <button class="notif-cat-btn btn btn-ghost btn-sm" data-cat="${c.key}"
            style="font-size:0.6875rem;flex-shrink:0;padding:4px 10px;
            ${_activeFilter === c.key ? 'background:var(--brand-gold)15;color:var(--brand-gold);font-weight:700;' : 'color:var(--text-muted);'}">
            ${esc(c.label)}
          </button>`).join('')}
        <button class="btn btn-ghost btn-sm" id="notif-toggle-unread"
          style="font-size:0.6875rem;flex-shrink:0;padding:4px 10px;margin-left:auto;
          ${_showUnreadOnly ? 'color:var(--brand-gold);font-weight:700;' : 'color:var(--text-muted);'}">
          Não lidas
        </button>
      </div>
    </div>

    <!-- List -->
    <div id="notif-list" style="flex:1;overflow-y:auto;">
      ${buildListHTML()}
    </div>`;
}

/* ─── Date grouping helper ───────────────────────────────── */
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
  let notifications = store.get('notifications') || [];

  // Apply filters
  if (_activeFilter) notifications = notifications.filter(n => n.category === _activeFilter);
  if (_showUnreadOnly) notifications = notifications.filter(n => !n.read);

  if (!notifications.length) {
    const msg = _showUnreadOnly ? 'Nenhuma notificação não lida' :
      _activeFilter ? 'Nenhuma notificação nesta categoria' : 'Nenhuma notificação';
    return `<div style="text-align:center;padding:60px 20px;color:var(--text-muted);">
      <div style="font-size:2rem;margin-bottom:12px;opacity:.4;">🔔</div>
      <div style="font-size:0.875rem;">${msg}</div>
    </div>`;
  }

  // Group by date
  const groups = {};
  const groupOrder = ['Hoje', 'Ontem', 'Esta semana', 'Anteriores'];
  for (const n of notifications) {
    const g = getDateGroup(n.createdAt);
    (groups[g] ||= []).push(n);
  }

  let html = '';
  for (const label of groupOrder) {
    const items = groups[label];
    if (!items?.length) continue;
    html += `<div style="padding:8px 20px 4px;font-size:0.6875rem;font-weight:700;
      color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;
      background:var(--bg-dark);position:sticky;top:0;z-index:1;">${esc(label)}</div>`;
    html += items.map(n => buildNotifItem(n)).join('');
  }
  return html;
}

  function buildNotifItem(n) {
    const icon = NOTIF_ICONS[n.category] || '🔔';
    const time = timeAgo(n.createdAt);
    const isUnread = !n.read;
    const priorityBar = n.priority === 'high' ? 'border-left:3px solid #EF4444;' :
                        n.priority === 'low'  ? '' : '';

    return `
      <div class="notif-item" data-id="${esc(n.id)}" data-route="${esc(n.route||'')}"
        data-entity-type="${esc(n.entityType||'')}" data-entity-id="${esc(n.entityId||'')}"
        style="padding:14px 20px;cursor:pointer;border-bottom:1px solid var(--border-subtle);
        transition:background .1s;display:flex;gap:12px;align-items:flex-start;
        background:${isUnread ? 'var(--bg-surface)' : 'transparent'};
        ${priorityBar}"
        onmouseover="this.style.background='var(--bg-surface)'"
        onmouseout="this.style.background='${isUnread ? 'var(--bg-surface)' : 'transparent'}'">

        <!-- Icon -->
        <div style="font-size:1.25rem;flex-shrink:0;margin-top:2px;">${icon}</div>

        <!-- Content -->
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
            <div style="font-size:0.8125rem;font-weight:${isUnread ? '600' : '400'};
              color:var(--text-primary);line-height:1.4;">
              ${esc(n.title)}
            </div>
            ${isUnread ? `<div style="width:8px;height:8px;border-radius:50%;background:var(--brand-gold);
              flex-shrink:0;margin-top:4px;"></div>` : ''}
          </div>
          ${n.body ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:3px;
            line-height:1.4;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;
            -webkit-line-clamp:2;-webkit-box-orient:vertical;">${esc(n.body)}</div>` : ''}
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
            <span style="font-size:0.6875rem;color:var(--text-muted);">${esc(time)}</span>
            ${n.actorName ? `<span style="font-size:0.6875rem;color:var(--text-muted);">· ${esc(n.actorName)}</span>` : ''}
          </div>
        </div>

        <!-- Dismiss -->
        <button class="notif-dismiss" data-id="${esc(n.id)}"
          style="border:none;background:none;cursor:pointer;color:var(--text-muted);
          font-size:0.75rem;padding:4px;flex-shrink:0;opacity:0;transition:opacity .15s;"
          title="Descartar">✕</button>
      </div>`;
  }

/* ════════════════════════════════════════════════════════════
   Wire events
   ════════════════════════════════════════════════════════════ */
function wireEvents() {
  if (!_panel) return;

  // Close
  _panel.querySelector('#notif-close')?.addEventListener('click', closeNotificationPanel);

  // Mark all as read
  _panel.querySelector('#notif-mark-all')?.addEventListener('click', async () => {
    const userId = uid();
    if (!userId) return;
    await markAllAsRead(userId);
  });

  // Category filters
  _panel.querySelectorAll('.notif-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeFilter = btn.dataset.cat;
      refreshPanel();
    });
  });

  // Unread toggle
  _panel.querySelector('#notif-toggle-unread')?.addEventListener('click', () => {
    _showUnreadOnly = !_showUnreadOnly;
    refreshPanel();
  });

  wireListEvents();
}

function wireListEvents() {
  if (!_panel) return;

  // Click notification → mark read + navigate
  _panel.querySelectorAll('.notif-item').forEach(item => {
    // Show dismiss on hover
    item.addEventListener('mouseenter', () => {
      const btn = item.querySelector('.notif-dismiss');
      if (btn) btn.style.opacity = '1';
    });
    item.addEventListener('mouseleave', () => {
      const btn = item.querySelector('.notif-dismiss');
      if (btn) btn.style.opacity = '0';
    });

    item.addEventListener('click', async (e) => {
      if (e.target.closest('.notif-dismiss')) return;
      const id    = item.dataset.id;
      const route = item.dataset.route;

      // Mark as read
      await markAsRead(id).catch(() => {});

      // Navigate
      if (route) {
        closeNotificationPanel();
        router.navigate(route);
      }
    });
  });

  // Dismiss individual
  _panel.querySelectorAll('.notif-dismiss').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await dismissNotification(btn.dataset.id).catch(() => {});
    });
  });
}

function refreshPanel() {
  if (!_panel) return;
  _panel.innerHTML = buildPanelHTML();
  wireEvents();
}

function uid() {
  return store.get('currentUser')?.uid;
}
