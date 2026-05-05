/**
 * PRIMETOUR — Auto-Archive Service
 * Arquiva automaticamente tarefas concluídas há mais de 730 dias (2 anos).
 *
 * Por que 730 e não 30 (anterior)?
 *   Metas duram até 12 meses (anuais) — algumas multianuais (rebranding,
 *   transformações). Threshold de 30 dias retirava da UI tarefas que ainda
 *   estavam dentro do escopo de metas em andamento, impossibilitando o
 *   drill-down de "quais tarefas contribuíram pra minha meta de 2025".
 *   730 dias = 2 ciclos anuais completos + buffer pra metas plurianuais.
 *   Tarefas só arquivam quando estão claramente fora de qualquer escopo
 *   produtivo de auditoria de metas.
 *
 *   A página #tasks tem toggle "Mostrar arquivadas" (3.8.0+) para auditoria
 *   das que excedem 730 dias quando necessário.
 */
import { collection, getDocs, updateDoc, doc, query, where, limit, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase.js';
import { store } from '../store.js';

const ARCHIVE_KEY = 'primetour-archive-last-check';
const ARCHIVE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const ARCHIVE_AFTER_DAYS = 730; // 2 anos — alinha com horizonte de metas

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
