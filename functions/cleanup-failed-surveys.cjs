const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  const snap = await db.collection('csat_surveys').where('status','in',['failed','pending']).get();
  let n = 0;
  for (const d of snap.docs) {
    const data = d.data();
    if (data.taskTitle?.startsWith('Newsletters da semana')) {
      await d.ref.delete();
      n++;
    }
  }
  console.log(`✓ ${n} surveys removidos`);
  process.exit(0);
})();
