const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const counts = {};
  const snap = await db.collection('roteiros_bank').get();
  for (const d of snap.docs) {
    const ids = d.data().geo?.destinationIds || [];
    ids.forEach(id => counts[id] = (counts[id] || 0) + 1);
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log('Top 5 destinations mais referenciadas:');
  for (const [id, n] of sorted) {
    const dd = (await db.collection('portal_destinations').doc(id).get()).data();
    console.log(`  ${id} — ${n} refs — "${dd?.city}, ${dd?.country}"`);
  }
  process.exit(0);
})();
