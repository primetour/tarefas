/**
 * PRIMETOUR — Archive old completed tasks
 *
 * Move tarefas concluídas há mais de 1 ano da coleção `tasks` para
 * `tasks_archive`. Mantém o sistema rápido no dia a dia sem perder
 * histórico: relatórios e dashboard de metas podem consultar ambas
 * as coleções quando precisarem de dados antigos.
 *
 * Critério de arquivamento:
 *   - status === 'done' OU 'cancelled'
 *   - completedAt (ou updatedAt, se não houver completedAt) há mais
 *     de 365 dias
 *
 * Env vars necessárias:
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY
 *   ARCHIVE_DAYS           → opcional, default 365
 *   DRY_RUN                → se "1", só conta, não move
 *
 * Execução:
 *   node scripts/archive-tasks.js
 *   — ou via GitHub Actions (ver .github/workflows/archive-tasks.yml)
 */

const admin = require('firebase-admin');

/* ─── Fix PEM key formatting ─────────────────────────────── */
function fixPem(raw) {
  if (!raw) return '';
  let key = raw.replace(/\\n/g, '\n');
  if (!key.includes('\n-----END')) {
    key = key
      .replace('-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\n')
      .replace('-----END PRIVATE KEY-----', '\n-----END PRIVATE KEY-----\n');
  }
  return key;
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  fixPem(process.env.FIREBASE_PRIVATE_KEY),
  }),
});
const db = admin.firestore();

const ARCHIVE_DAYS = parseInt(process.env.ARCHIVE_DAYS) || 365;
const DRY_RUN      = process.env.DRY_RUN === '1';

/* ─── Helper: ISO do docId para ordenação estável ────────── */
function toDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  if (value._seconds) return new Date(value._seconds * 1000);
  if (value instanceof Date) return value;
  return new Date(value);
}

async function archiveBatch() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - ARCHIVE_DAYS);
  console.log(`[archive-tasks] cutoff: ${cutoff.toISOString()} (${ARCHIVE_DAYS} dias atrás)`);
  console.log(`[archive-tasks] DRY_RUN=${DRY_RUN ? 'sim' : 'não'}`);

  // Busca tarefas concluídas/canceladas.
  // Usamos `where status in [...]` + filtro em JS por data (evita exigir índice composto)
  const snap = await db.collection('tasks')
    .where('status', 'in', ['done', 'cancelled'])
    .get();

  console.log(`[archive-tasks] ${snap.size} tarefas concluídas/canceladas encontradas`);

  const toArchive = [];
  snap.forEach(doc => {
    const d = doc.data();
    const when = toDate(d.completedAt) || toDate(d.updatedAt) || toDate(d.createdAt);
    if (!when) return;            // sem timestamp confiável: deixa no lugar
    if (when >= cutoff) return;   // recente demais: deixa no lugar
    toArchive.push({ id: doc.id, data: d });
  });

  console.log(`[archive-tasks] ${toArchive.length} tarefas candidatas a arquivamento`);

  if (DRY_RUN) {
    console.log('[archive-tasks] DRY_RUN ativo — nada foi movido.');
    if (toArchive.length) {
      console.log('[archive-tasks] Primeiras 10 candidatas:');
      toArchive.slice(0, 10).forEach(t => {
        const when = toDate(t.data.completedAt) || toDate(t.data.updatedAt) || toDate(t.data.createdAt);
        console.log(`  - ${t.id} | ${t.data.status} | ${when?.toISOString()} | ${(t.data.title||'').slice(0,60)}`);
      });
    }
    return;
  }

  if (!toArchive.length) {
    console.log('[archive-tasks] Nada para arquivar. Fim.');
    return;
  }

  // Firestore batch = 500 ops. Cada tarefa = 1 set no archive + 1 delete = 2 ops.
  // Então 250 tarefas por batch.
  const CHUNK = 250;
  let moved = 0;
  for (let i = 0; i < toArchive.length; i += CHUNK) {
    const chunk = toArchive.slice(i, i + CHUNK);
    const batch = db.batch();
    chunk.forEach(t => {
      const archiveRef = db.collection('tasks_archive').doc(t.id);
      const sourceRef  = db.collection('tasks').doc(t.id);
      batch.set(archiveRef, {
        ...t.data,
        archivedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      batch.delete(sourceRef);
    });
    await batch.commit();
    moved += chunk.length;
    console.log(`[archive-tasks] Lote processado: ${moved}/${toArchive.length}`);
  }

  // Registra metadados do último sync
  await db.collection('tasks_archive_meta').doc('lastSync').set({
    runAt:    admin.firestore.FieldValue.serverTimestamp(),
    archived: moved,
    cutoff:   cutoff.toISOString(),
    days:     ARCHIVE_DAYS,
  });

  console.log(`[archive-tasks] Concluído. ${moved} tarefas movidas para tasks_archive.`);
}

archiveBatch()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[archive-tasks] ERRO:', err);
    process.exit(1);
  });
