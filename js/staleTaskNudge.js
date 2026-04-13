/**
 * PRIMETOUR — Stale Task Nudge
 * Notifica quando tarefas estao paradas ha muito tempo sem atualizacao
 */
import { collection, getDocs, query, where, limit } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase.js';
import { store } from '../store.js';

const NUDGE_KEY = 'primetour-nudge-last-check';
const NUDGE_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

// Thresholds (in days)
const STALE_IN_PROGRESS = 5;  // in_progress sem atualizacao ha 5 dias
const STALE_REVIEW = 3;       // review sem atualizacao ha 3 dias
const STALE_NOT_STARTED = 7;  // not_started sem atualizacao ha 7 dias

export async function checkStaleTasks() {
  const lastCheck = parseInt(localStorage.getItem(NUDGE_KEY) || '0');
  if (Date.now() - lastCheck < NUDGE_INTERVAL) return;
  localStorage.setItem(NUDGE_KEY, String(Date.now()));

  const uid = store.get('currentUser')?.uid;
  if (!uid) return;

  try {
    const q = query(
      collection(db, 'tasks'),
      where('status', 'in', ['not_started', 'in_progress', 'review']),
      limit(500)
    );
    const snap = await getDocs(q);
    const now = Date.now();
    const stale = [];

    for (const d of snap.docs) {
      const t = { id: d.id, ...d.data() };
      if (!(t.assignees || []).includes(uid)) continue;

      // Get last update timestamp
      const updatedAt = t.updatedAt?.toDate?.()
        ? t.updatedAt.toDate()
        : t.updatedAt?.seconds
          ? new Date(t.updatedAt.seconds * 1000)
          : t.createdAt?.toDate?.()
            ? t.createdAt.toDate()
            : null;
      if (!updatedAt) continue;

      const daysSince = Math.floor((now - updatedAt.getTime()) / (1000 * 60 * 60 * 24));

      let threshold = 999;
      if (t.status === 'in_progress') threshold = STALE_IN_PROGRESS;
      else if (t.status === 'review') threshold = STALE_REVIEW;
      else if (t.status === 'not_started') threshold = STALE_NOT_STARTED;

      if (daysSince >= threshold) {
        stale.push({ ...t, daysSince });
      }
    }

    if (stale.length === 0) return;

    const { notify } = await import('./notifications.js');
    // Group by status
    const inProgress = stale.filter(t => t.status === 'in_progress');
    const inReview = stale.filter(t => t.status === 'review');
    const notStarted = stale.filter(t => t.status === 'not_started');

    if (inProgress.length) {
      notify('task.stale', {
        entityType: 'system', entityId: 'stale-check',
        recipientIds: [uid],
        title: `${inProgress.length} tarefa(s) parada(s) em "Em Andamento"`,
        body: inProgress.slice(0, 3).map(t => `"${t.title}" (${t.daysSince}d)`).join(', '),
        route: 'tasks',
        category: 'productivity',
      });
    }

    if (inReview.length) {
      notify('task.stale_review', {
        entityType: 'system', entityId: 'stale-check',
        recipientIds: [uid],
        title: `${inReview.length} tarefa(s) aguardando revisao ha dias`,
        body: inReview.slice(0, 3).map(t => `"${t.title}" (${t.daysSince}d)`).join(', '),
        route: 'tasks',
        category: 'productivity',
      });
    }

    if (notStarted.length) {
      notify('task.stale_not_started', {
        entityType: 'system', entityId: 'stale-check',
        recipientIds: [uid],
        title: `${notStarted.length} tarefa(s) nao iniciada(s) ha ${notStarted[0].daysSince}+ dias`,
        body: notStarted.slice(0, 3).map(t => `"${t.title}"`).join(', '),
        route: 'tasks',
        category: 'productivity',
      });
    }

    console.log(`[Nudge] ${stale.length} stale tasks found`);
  } catch (e) {
    console.warn('[Nudge] Check failed:', e);
  }
}
