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
  'task.unassigned':          'notifyAssign',
  'task.rework':              'notifyAssign',
  'task.commented':           'notifyMention',
  'task.overdue':             'notifyDeadline',
  'task.deadline_approaching':'notifyDeadline',
  'subtask.assigned':         'notifyAssign',
  'subtask.unassigned':       'notifyAssign',
  'project.member_added':     'notifyAssign',
  'project.member_removed':   'notifyAssign',
  'squad.member_added':       'notifyAssign',
  'squad.member_removed':     'notifyAssign',
  'squad.admin_granted':      'notifyAssign',
  'squad.admin_revoked':      'notifyAssign',
  'system.mention':           'notifyMention',
};

/* ─── Category icons ──────────────────────────────────────── */
export const NOTIF_ICONS = {
  task:              '📋',
  project:           '📊',
  csat:              '💬',
  request:           '📩',
  goal:              '🎯',
  portal:            '🌍',
  portal_areas:      '◑',
  portal_images:     '▨',
  roteiro:           '✈',
  content_calendar:  '📱',
  luxury_travel:     '📖',
  agent:             '◈',
  feedback:          '✎',
  system:            '🔔',
  security:          '🛡',
  lgpd:              '🔐',
};

/* ─── Notification type labels ────────────────────────────── */
export const NOTIF_TYPE_LABELS = {
  'task.assigned':            'Tarefa atribuída',
  'task.unassigned':          'Removido de tarefa',
  'task.completed':           'Tarefa concluída',
  'task.commented':           'Novo comentário',
  'task.overdue':             'Tarefa atrasada',
  'task.deadline_approaching':'Prazo próximo',
  'task.status_changed':      'Status alterado',
  'task.rework':              'Tarefa devolvida',
  'subtask.assigned':         'Subtarefa atribuída',
  'subtask.unassigned':       'Removido de subtarefa',
  'project.updated':          'Projeto atualizado',
  'project.member_added':     'Adicionado a projeto',
  'project.member_removed':   'Removido de projeto',
  'squad.member_added':       'Adicionado a squad',
  'squad.member_removed':     'Removido de squad',
  'squad.admin_granted':      'Promovido a admin do squad',
  'squad.admin_revoked':      'Admin do squad removido',
  'request.created':          'Nova solicitação',
  'request.converted':        'Solicitação convertida',
  'csat.responded':           'Resposta CSAT',
  'csat.low_score':           'CSAT crítico',
  'goal.published':           'Meta publicada',
  'goal.deadline':            'Prazo de meta',
  'portal.tip_created':       'Nova dica',
  'feedback.created':         'Novo feedback',
  'feedback.schedule_due':    'Feedback pendente',
  'system.mention':           'Menção',
  // ─── Roteiros de Viagem ────────────────────────────────────
  'roteiro.created':           'Novo roteiro criado',
  'roteiro.assigned':          'Roteiro atribuído a você',
  'roteiro.status_change':     'Status do roteiro alterado',
  'roteiro.exported':          'Roteiro exportado (PDF/PPTX)',
  'roteiro.ai_generated':      'Roteiro gerado por IA',
  // ─── Calendário de Conteúdo ────────────────────────────────
  'content_calendar.slot_created':  'Novo slot de conteúdo',
  'content_calendar.scheduled':     'Conteúdo agendado',
  'content_calendar.published':     'Conteúdo publicado',
  'content_calendar.ai_suggested':  'IA sugeriu conteúdo da semana',
  // ─── Revista Luxury Travel ─────────────────────────────────
  'luxury_travel.edition_published':'Nova edição da Luxury Travel',
  'luxury_travel.qr_generated':     'QR Code da revista gerado',
  // ─── Templates de Áreas ────────────────────────────────────
  'portal_areas.updated':      'Template de área atualizado',
  // ─── Banco de Imagens ──────────────────────────────────────
  'portal_images.upload_failed':'Falha no upload de imagem',
  'portal_images.auto_synced': 'Imagens auto-sincronizadas (Unsplash/Wikipedia)',
  // ─── IA Hub / Agentes ──────────────────────────────────────
  'agent.suggestion_ready':    'Sugestão de agente IA pronta',
  'agent.run_failed':          'Falha na execução do agente IA',
  // ─── Segurança (Sprints 1-5) ────────────────────────────────
  'security.suspicious_login': 'Novo IP detectado no seu login',
  'security.rate_limit_hit':   'Muitas requisições do seu IP',
  'security.backup_completed': 'Backup diário concluído',
  'security.backup_failed':    'Falha no backup diário',
  'security.digest_critical':  'Digest de segurança CRÍTICO',
  'security.digest_warning':   'Digest de segurança com alertas',
  'security.secret_stale':     'API key precisa ser rotacionada',
  // ─── LGPD ────────────────────────────────────────────────────
  'lgpd.export_ready':         'Exportação dos seus dados pronta',
  'lgpd.erasure_completed':    'Seus dados foram apagados (LGPD)',
  'lgpd.consent_updated':      'Suas preferências de privacidade foram atualizadas',
};

/* ─── Tipos que vão pra recipients fixos (admin/master) ───── */
// Notificações de SEGURANÇA SISTÊMICA (não pessoal) sempre vão pra:
//   - todos com role master
//   - todos com permissão security_alerts_receive
// Use isSystemSecurityType() pra checar.
export const SYSTEM_SECURITY_TYPES = new Set([
  'security.backup_failed',
  'security.digest_critical',
  'security.digest_warning',
  'security.secret_stale',
]);

export function isSystemSecurityType(type) {
  return SYSTEM_SECURITY_TYPES.has(type);
}

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
  if (!recipientIds.length) { console.log('[Notify] No recipients, skipping'); return; }

  // 4.23+ — Bug fix: lia userProfile cacheado, podendo gravar o nome do
  // user que abriu o app antes (relato: aparecia "Rafaela Gouvêa" em
  // notificações disparadas por outros). Agora re-lê o currentUser pelo
  // store de users (que é o source of truth atualizado por subscriptions),
  // e só usa userProfile como fallback.
  const actorId   = uid();
  const actorName = (() => {
    if (actorId) {
      const users = store.get('users') || [];
      const u = users.find(x => x.id === actorId);
      if (u?.name) return u.name;
    }
    return store.get('userProfile')?.name || 'Sistema';
  })();

  // Auto-detect category from type
  if (!category) category = type.split('.')[0];

  console.log(`[Notify] type=${type}, actor=${actorId}, recipients=`, recipientIds);

  // Check admin-level setting
  const adminPrefKey = TYPE_TO_ADMIN_PREF[type];
  if (adminPrefKey) {
    const enabled = await isGloballyEnabled(adminPrefKey);
    if (!enabled) {
      console.log(`[Notify] Blocked by admin setting: ${adminPrefKey}=false`);
      return;
    }
  }

  // Load user preferences for recipients (batch)
  const userPrefs = await loadUserPrefs(recipientIds);

  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + 30 * 24 * 60 * 60 * 1000); // 30 days

  const batch = writeBatch(db);
  let created = 0;

  for (const recipientId of recipientIds) {
    // Never notify the actor themselves
    if (recipientId === actorId) {
      console.log(`[Notify] Skipping self: ${recipientId}`);
      continue;
    }

    // Check user preference
    const userPrefKey = TYPE_TO_USER_PREF[type];
    if (userPrefKey) {
      const prefs = userPrefs[recipientId];
      if (prefs && prefs[userPrefKey] === false) {
        console.log(`[Notify] Blocked by user pref: ${recipientId}.${userPrefKey}=false`);
        continue;
      }
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
      console.log(`[Notify] ✓ ${created} notification(s) created for type=${type}`);
    } catch (err) {
      console.error('[Notify] Batch commit FAILED:', err);
    }
  } else {
    console.log(`[Notify] No notifications created (all filtered)`);
  }
}

/* ════════════════════════════════════════════════════════════
   Real-time subscription (one per user session)
   ════════════════════════════════════════════════════════════ */
export function subscribeNotifications(userId, callback) {
  // Single-field query to avoid composite index requirement.
  // Filter dismissed + sort client-side.
  const q = query(
    collection(db, 'notifications'),
    where('recipientId', '==', userId),
    limit(200),
  );

  return onSnapshot(q, snap => {
    const notifications = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(n => n.dismissed !== true)
      .sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() || 0;
        const tb = b.createdAt?.toMillis?.() || 0;
        return tb - ta;
      })
      .slice(0, 50);
    callback(notifications);
  }, err => {
    console.warn('Notification listener error:', err.message);
    // If index is missing, Firestore returns an error with a link to create it.
    // Log full error for debugging.
    console.error('Full notification error:', err);
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
