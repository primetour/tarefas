/**
 * Remove dashboard_customize (perm órfã removida em 4.49.12)
 * de todos os roles no Firestore. Idempotente.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
(async () => {
  const snap = await db.collection('roles').get();
  for (const d of snap.docs) {
    await d.ref.update({
      'permissions.dashboard_customize': FV.delete(),
      updatedAt: FV.serverTimestamp(),
    });
    console.log(`✓ ${d.id}: dashboard_customize removed`);
  }
  console.log(`\n${snap.size} roles atualizados.`);
  process.exit(0);
})();
