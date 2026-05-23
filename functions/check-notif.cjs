const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  // Procura notifs do tipo request.created criadas nos últimos 3 min
  const cutoff = new Date(Date.now() - 180000);
  const snap = await db.collection('notifications')
    .where('type', '==', 'request.created')
    .get();
  const recent = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(n => n.createdAt?.toDate?.() > cutoff);
  console.log(`Total notifs request.created últimos 3min: ${recent.length}`);
  for (const n of recent.slice(0, 12)) {
    console.log(`  ${n.id.slice(0,8)} | recipient=${n.recipientId?.slice(0,8)} | "${n.title}" — ${(n.body||'').slice(0,50)}`);
  }
})();
