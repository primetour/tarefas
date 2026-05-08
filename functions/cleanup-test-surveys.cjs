const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  // Limpa surveys de teste recém criados (status pending, taskTitle começa com Newsletters da semana)
  const snap = await db.collection('csat_surveys')
    .where('status', '==', 'pending')
    .get();
  let deleted = 0;
  for (const d of snap.docs) {
    const data = d.data();
    if (data.taskTitle?.startsWith('Newsletters da semana')) {
      await d.ref.delete();
      deleted++;
    }
  }
  console.log(`✓ ${deleted} surveys de teste removidos`);

  // Limpa lock pra não bloquear próximo teste
  const lockSnap = await db.collection('csat_periodic_runs').get();
  for (const d of lockSnap.docs) {
    await d.ref.delete();
  }
  console.log(`✓ ${lockSnap.size} locks removidos`);

  process.exit(0);
})();
