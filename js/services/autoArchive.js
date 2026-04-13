/**
 * PRIMETOUR — Auto-Archive Service
 * Arquiva automaticamente tarefas concluídas há mais de 30 dias
 */
import { collection, getDocs, updateDoc, doc, query, where, limit, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase.js';
import { store } from '../store.js';

const ARCHIVE_KEY = 'primetour-archive-last-check';
const ARCHIVE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const ARCHIVE_AFTER_DAYS = 30;

export async function runAutoArchive() {
  // Only run for admins/managers
  if (!store.can('system_manage_settings') && !store.isMaster()) return;

  const lastCheck = parseInt(localStorage.getItem(ARCHIVE_KEY) || '0');
  if (Date.now() - lastCheck < ARCHIVE_INTERVAL) return;
  localStorage.setItem(ARCHIVE_KEY, String(Date.now()));

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - ARCHIVE_AFTER_DAYS);

    const q = query(
      collection(db, 'tasks'),
      where('status', '==', 'done'),
      limit(200)
    );
    const snap = await getDocs(q);
    let archived = 0;

    for (const d of snap.docs) {
      const t = d.data();
      // Check completedAt
      const completedAt = t.completedAt?.toDate?.()
        || (t.completedAt?.seconds ? new Date(t.completedAt.seconds * 1000) : null);

      if (!completedAt || completedAt > cutoff) continue;
      // Already archived
      if (t.archived) continue;

      await updateDoc(doc(db, 'tasks', d.id), {
        archived: true,
        archivedAt: serverTimestamp(),
      });
      archived++;
    }

    if (archived > 0) {
      console.log(`[AutoArchive] Archived ${archived} tasks completed >30 days ago`);
    }
  } catch (e) {
    console.warn('[AutoArchive] Failed:', e);
  }
}
