const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  const snap = await db.collection('users').get();
  let yes = 0;
  snap.forEach(d => {
    const data = d.data();
    if (data.photoURL) {
      yes++;
      console.log(`✓ ${data.name} (${(data.photoURL.length/1024).toFixed(1)}KB)`);
    }
  });
  console.log(`\n${yes}/${snap.size} users com photoURL`);
  process.exit(0);
})();
