/**
 * PRIMETOUR — Daily Smart Summary
 * Gera resumo personalizado do dia via notificação
 */
import { collection, getDocs, query, where, limit }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase.js';
import { store } from '../store.js';

const SUMMARY_KEY = 'primetour-summary-last';

/* v4.57.22 — normaliza dueDate em Timestamp/Date/string pra YYYY-MM-DD local */
function _normISO(val) {
  if (!val) return '';
  let d;
  if (val?.toDate) d = val.toDate();
  else if (val instanceof Date) d = val;
  else if (typeof val === 'string') {
    const m = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    d = new Date(val);
  } else if (typeof val === 'number') d = new Date(val);
  else return '';
  if (!d || isNaN(d.getTime())) return '';
  const y = d.getFullYear(), mo = String(d.getMonth()+1).padStart(2,'0'), da = String(d.getDate()).padStart(2,'0');
  return `${y}-${mo}-${da}`;
}

export async function generateDailySummary() {
  const uid = store.get('currentUser')?.uid;
  if (!uid) return;

  // Run once per day
  const today = new Date().toISOString().slice(0, 10);
  const lastRun = localStorage.getItem(SUMMARY_KEY) || '';
  if (lastRun === today) return;
  localStorage.setItem(SUMMARY_KEY, today);

  try {
    // v4.53.1+ Inclui 'approval' (v4.52.0) e 'validation' (v4.53.0) na query.
    // Sem isso, daily summary pulava tasks nesses status novos.
    // ATENÇÃO: Firestore `in` aceita até 10 values, estamos em 6 (ok).
    const q = query(
      collection(db, 'tasks'),
      where('status', 'in', ['not_started', 'in_progress', 'review', 'approval', 'validation', 'rework']),
      limit(500)
    );
    const snap = await getDocs(q);
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    const myTasks = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => (t.assignees || []).includes(uid));

    if (myTasks.length === 0) return;

    // v4.57.22: normaliza pra aceitar Timestamp/Date/string. Antes comparava
    // string direto — tasks com Timestamp eram ignoradas em overdue/today.
    const overdue = myTasks.filter(t => { const d = _normISO(t.dueDate); return d && d < todayStr; });
    const dueToday = myTasks.filter(t => _normISO(t.dueDate) === todayStr);
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
