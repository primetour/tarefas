/**
 * Backfill dev_hours.completedAt — Firestore orderBy('completedAt') exclui
 * docs sem o campo. Resultado: docs novos do Banco ficavam invisíveis.
 *
 * Fix: pra todo doc sem `completedAt`, copia `createdAt`.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('dev_hours').get();
  console.log(`Scanning ${snap.size} dev_hours docs...`);

  let updated = 0;
  let skipped = 0;
  let noCreatedAt = 0;

  for (const d of snap.docs) {
    const data = d.data();
    if (data.completedAt) { skipped++; continue; }
    if (!data.createdAt) { noCreatedAt++; continue; }
    await d.ref.update({ completedAt: data.createdAt });
    console.log(`  + ${d.id} v${data.releaseVersion || '?'} → completedAt copiado de createdAt`);
    updated++;
  }

  console.log(`\nDone. ${updated} updated, ${skipped} já tinham, ${noCreatedAt} sem createdAt.`);
  process.exit(0);
})();
