/**
 * PRIMETOUR — Notifications Service
 * Criação, entrega em tempo real, leitura e limpeza de notificações in-app
 */

import { db } from '../firebase.js';
import { store } from '../store.js';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, writeBatch,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const uid = () => store.get('currentUser')?.uid;

/* ─── Notification type → preference mapping ─────────────── */
const TYPE_TO_ADMIN_PREF = {
  'task.assigned':           'notifyTaskAssigned',
  'task.completed':          'notifyTaskComplete',
  'task.commented':          'notifyTaskComment',
  'task.overdue':            'notifyOverdue',
  'task.deadline_approaching':'notifyOverdue',
  'task.status_changed':     'notifyTaskComplete',
  'task.rework':             'notifyTaskAssigned',
  'project.updated':         'notifyProjectUpdate',
};

const TYPE_TO_USER_PREF = {
  'task.assigned':            'notifyAssign',
  'task.rework':              'notifyAssign',
  'task.commented':           'notifyMention',
  'task.overdue':             'notifyDeadline',
  'task.deadline_approaching':'notifyDeadline',
  'system.mention':           'notifyMention',
};

/* ─── Category icons ──────────────────────────────────────── */
export const NOTIF_ICONS = {
  task:    '📋',
  project: '📊',
  csat:    '💬',
  request: '📩',
  goal:    '🎯',
  portal:  '🌍',
  system:  '🔔',
};

/* ─── Notification type labels ────────────────────────────── */
export const NOTIF_TYPE_LABELS = {
  'task.assigned':            'Tarefa atribuída',
  'task.completed':           'Tarefa concluída',
  'task.commented':           'Novo comentário',
  'task.overdue':             'Tarefa atrasada',
  'task.deadline_approaching':'Prazo próximo',
  'task.status_changed':      'Status alterado',
  'task.rework':              'Tarefa devolvida',
  'project.updated':          'Projeto atualizado',
  'request.created':          'Nova solicitação',
  'request.converted':        'Solicitação convertida',
  'csat.responded':           'Resposta CSAT',
  'csat.low_score':           'CSAT crítico',
  'goal.published':           'Meta publicada',
  'goal.deadline':            'Prazo de meta',
  'portal.tip_created':       'Nova dica',
  'system.mention':           'Menção',
};

/* ════════════════════════════════════════════════════════════
   notify() — Central gateway
   Creates one notification per recipient (skips the actor)
   ════════════════════════════════════════════════════════════ */
export async function notify(type, {
  entityType,
  entityId,
  recipientIds = [],
  title,
  body,
  route,
  priority = 'normal',
  category,
}) {
  if (!recipientIds.length) return;

  const actorId   = uid();
  const actorName = store.get('userProfile')?.name || 'Sistema';

  // Auto-detect category from type
  if (!category) category = type.split('.')[0];

  // Check admin-level setting
  const adminPrefKey = TYPE_TO_ADMIN_PREF[type];
  if (adminPrefKey) {
    const enabled = await isGloballyEnabled(adminPrefKey);
    if (!enabled) return;
  }

  // Load user preferences for recipients (batch)
  const userPrefs = await loadUserPrefs(recipientIds);

  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + 30 * 24 * 60 * 60 * 1000); // 30 days

  const batch = writeBatch(db);
  let created = 0;

  for (const recipientId of recipientIds) {
    // Never notify the actor themselves
    if (recipientId === actorId) continue;

    // Check user preference
    const userPrefKey = TYPE_TO_USER_PREF[type];
    if (userPrefKey) {
      const prefs = userPrefs[recipientId];
      if (prefs && prefs[userPrefKey] === false) continue;
    }

    const ref = doc(collection(db, 'notifications'));
    batch.set(ref, {
      recipientId,
      actorId:    actorId || 'system',
      actorName,
      type,
      category,
      priority,
      title:      title || NOTIF_TYPE_LABELS[type] || type,
      body:       body || '',
      entityType: entityType || null,
      entityId:   entityId || null,
      route:      route || null,
      read:       false,
      readAt:     null,
      dismissed:  false,
      createdAt:  serverTimestamp(),
      expiresAt,
    });
    created++;
  }

  if (created > 0) {
    try {
      await batch.commit();
    } catch (err) {
      console.warn('Notification batch failed:', err.message);
    }
  }
}

/* ════════════════════════════════════════════════════════════
   Real-time subscription (one per user session)
   ════════════════════════════════════════════════════════════ */
export function subscribeNotifications(userId, callback) {
  const q = query(
    collection(db, 'notifications'),
    where('recipientId', '==', userId),
    where('dismissed', '==', false),
    orderBy('createdAt', 'desc'),
    limit(50),
  );

  return onSnapshot(q, snap => {
    const notifications = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(notifications);
  }, err => {
    console.warn('Notification listener error:', err.message);
  });
}

/* ════════════════════════════════════════════════════════════
   Read / dismiss / cleanup
   ════════════════════════════════════════════════════════════ */
export async function markAsRead(notificationId) {
  await updateDoc(doc(db, 'notifications', notificationId), {
    read: true,
    readAt: serverTimestamp(),
  });
}

export async function markAllAsRead(userId) {
  const q = query(
    collection(db, 'notifications'),
    where('recipientId', '==', userId),
    where('read', '==', false),
  );
  const snap = await getDocs(q);
  if (snap.empty) return;

  const batch = writeBatch(db);
  snap.docs.forEach(d => {
    batch.update(d.ref, { read: true, readAt: serverTimestamp() });
  });
  await batch.commit();
}

export async function dismissNotification(notificationId) {
  await updateDoc(doc(db, 'notifications', notificationId), {
    dismissed: true,
  });
}

export async function cleanupExpired(userId) {
  const now = Timestamp.now();
  const q = query(
    collection(db, 'notifications'),
    where('recipientId', '==', userId),
    where('expiresAt', '<=', now),
  );
  const snap = await getDocs(q);
  if (snap.empty) return;

  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

/* ════════════════════════════════════════════════════════════
   Helpers (internal)
   ════════════════════════════════════════════════════════════ */
let _globalSettings = null;
let _globalSettingsTTL = 0;

async function isGloballyEnabled(prefKey) {
  // Cache settings for 5 minutes
  if (!_globalSettings || Date.now() > _globalSettingsTTL) {
    try {
      const snap = await getDoc(doc(db, 'settings', 'global'));
      _globalSettings = snap.exists() ? snap.data() : {};
      _globalSettingsTTL = Date.now() + 5 * 60 * 1000;
    } catch {
      return true; // fail open
    }
  }
  return _globalSettings[prefKey] !== false;
}

async function loadUserPrefs(recipientIds) {
  const result = {};
  // Use users from store if available to avoid extra reads
  const cachedUsers = store.get('users') || [];

  for (const id of recipientIds) {
    const cached = cachedUsers.find(u => u.id === id);
    if (cached) {
      result[id] = cached.prefs || {};
    } else {
      try {
        const snap = await getDoc(doc(db, 'users', id));
        result[id] = snap.exists() ? (snap.data().prefs || {}) : {};
      } catch {
        result[id] = {};
      }
    }
  }
  return result;
}

/* ─── Time-ago helper (exported for UI) ───────────────────── */
export function timeAgo(timestamp) {
  if (!timestamp) return '';
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `há ${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days} dias`;
  return date.toLocaleDateString('pt-BR');
}
