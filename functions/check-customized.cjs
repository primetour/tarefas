const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  const snap = await db.collection('roles').get();
  snap.forEach(d => {
    const data = d.data();
    console.log(`${d.id.padEnd(15)} customizedPermissions=${!!data.customizedPermissions}`);
  });
  process.exit(0);
})();
