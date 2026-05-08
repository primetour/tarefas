const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  const snap = await db.collection('csat_periodic_runs').get();
  console.log(`${snap.size} locks existentes`);
  for (const d of snap.docs) {
    console.log(`✕ ${d.id}: ${JSON.stringify(d.data().status)}`);
    await d.ref.delete();
  }
  console.log('✓ todos limpos');
  process.exit(0);
})();
