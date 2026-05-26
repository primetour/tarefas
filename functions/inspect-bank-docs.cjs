const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  const snap = await db.collection('roteiros_bank').get();
  console.log(`[inspect] ${snap.size} docs total`);
  snap.forEach(d => {
    const data = d.data();
    console.log(`  ${d.id}  title="${(data.title || '<EMPTY>').slice(0,50)}"  source=${data.source?.type}  envisionId=${data.envision?.id}  status=${data.status}`);
  });
  process.exit(0);
})();
