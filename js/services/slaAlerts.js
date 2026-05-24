/**
 * PRIMETOUR — SLA Alert Service
 * Verifica tarefas com prazo próximo ou vencido e notifica automaticamente
 */
import { collection, getDocs, query, where, limit } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase.js';
import { store } from '../store.js';

const SLA_CHECK_KEY = 'primetour-sla-last-check';
const SLA_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

export async function checkSlaAlerts() {
  const lastCheck = parseInt(localStorage.getItem(SLA_CHECK_KEY) || '0');
  if (Date.now() - lastCheck < SLA_CHECK_INTERVAL) return;
  localStorage.setItem(SLA_CHECK_KEY, String(Date.now()));

  const uid = store.get('currentUser')?.uid;
  if (!uid) return;

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    // Fetch active tasks (not done/cancelled) with dueDate
    // v4.53.1+ Inclui 'approval' (v4.52.0) e 'validation' (v4.53.0).
    // NOTA: 'validation' tem SLA congelado (isTaskOverdue retorna false),
    // mas mantemos na query pra dashboard de SLA acompanhar visualmente.
    const q = query(
      collection(db, 'tasks'),
      where('status', 'in', ['not_started', 'in_progress', 'review', 'approval', 'validation', 'rework']),
      limit(500)
    );
    const snap = await getDocs(q);
    const tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Filter tasks assigned to current user or created by them
    const myTasks = tasks.filter(t =>
      (t.assignees || []).includes(uid) || t.createdBy === uid
    );

    const overdue = [];
    const dueTomorrow = [];
    const dueToday = [];

    for (const t of myTasks) {
      if (!t.dueDate) continue;
      const due = typeof t.dueDate === 'string' ? t.dueDate : '';
      if (!due) continue;

      if (due < todayStr) overdue.push(t);
      else if (due === todayStr) dueToday.push(t);
      else if (due === tomorrowStr) dueTomorrow.push(t);
    }

    const { notify } = await import('./notifications.js');

    if (overdue.length > 0) {
      notify('task.sla_breach', {
        entityType: 'system', entityId: 'sla-check',
        recipientIds: [uid],
        title: `⚠ ${overdue.length} tarefa(s) com prazo vencido`,
        body: overdue.slice(0, 3).map(t => `"${t.title}"`).join(', ') + (overdue.length > 3 ? ` e mais ${overdue.length - 3}` : ''),
        route: 'tasks',
        priority: 'high',
        category: 'sla',
      });
    }

    if (dueToday.length > 0) {
      notify('task.sla_today', {
        entityType: 'system', entityId: 'sla-check',
        recipientIds: [uid],
        title: `📅 ${dueToday.length} tarefa(s) vencem hoje`,
        body: dueToday.slice(0, 3).map(t => `"${t.title}"`).join(', '),
        route: 'tasks',
        category: 'sla',
      });
    }

    if (dueTomorrow.length > 0) {
      notify('task.sla_tomorrow', {
        entityType: 'system', entityId: 'sla-check',
        recipientIds: [uid],
        title: `🔔 ${dueTomorrow.length} tarefa(s) vencem amanhã`,
        body: dueTomorrow.slice(0, 3).map(t => `"${t.title}"`).join(', '),
        route: 'tasks',
        category: 'sla',
      });
    }

    console.log(`[SLA] Check complete: ${overdue.length} overdue, ${dueToday.length} today, ${dueTomorrow.length} tomorrow`);
  } catch (e) {
    console.warn('[SLA] Check failed:', e);
  }
}
