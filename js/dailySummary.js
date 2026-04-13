/**
 * PRIMETOUR — Daily Smart Summary
 * Gera resumo personalizado do dia via notificação
 */
import { collection, getDocs, query, where, limit }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase.js';
import { store } from '../store.js';

const SUMMARY_KEY = 'primetour-summary-last';

export async function generateDailySummary() {
  const uid = store.get('currentUser')?.uid;
  if (!uid) return;

  // Run once per day
  const today = new Date().toISOString().slice(0, 10);
  const lastRun = localStorage.getItem(SUMMARY_KEY) || '';
  if (lastRun === today) return;
  localStorage.setItem(SUMMARY_KEY, today);

  try {
    const q = query(
      collection(db, 'tasks'),
      where('status', 'in', ['not_started', 'in_progress', 'review', 'rework']),
      limit(500)
    );
    const snap = await getDocs(q);
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    const myTasks = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => (t.assignees || []).includes(uid));

    if (myTasks.length === 0) return;

    const overdue = myTasks.filter(t => t.dueDate && t.dueDate < todayStr);
    const dueToday = myTasks.filter(t => t.dueDate === todayStr);
    const inProgress = myTasks.filter(t => t.status === 'in_progress');
    const inReview = myTasks.filter(t => t.status === 'review');

    // Build summary parts
    const parts = [];
    if (dueToday.length) parts.push(`${dueToday.length} para hoje`);
    if (overdue.length) parts.push(`${overdue.length} atrasada(s)`);
    if (inProgress.length) parts.push(`${inProgress.length} em andamento`);
    if (inReview.length) parts.push(`${inReview.length} em revisão`);

    const total = myTasks.length;
    const body = parts.join(' · ') || `${total} tarefa(s) ativa(s)`;

    const { notify } = await import('./notifications.js');
    notify('system.daily_summary', {
      entityType: 'system', entityId: 'daily-summary',
      recipientIds: [uid],
      title: `Bom dia! Seu resumo: ${total} tarefa(s)`,
      body,
      route: 'dashboard',
      category: 'summary',
    });

    console.log('[Summary] Daily summary sent:', body);
  } catch (e) {
    console.warn('[Summary] Failed:', e);
  }
}
