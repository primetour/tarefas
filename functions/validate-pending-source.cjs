const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('portal_destinations')
    .where('reviewStatus', '==', 'pending').limit(500).get();
  const bySource = {};
  const withCreatedAt = [];
  for (const d of snap.docs) {
    const data = d.data();
    const src = data.source || 'manual';
    bySource[src] = (bySource[src] || 0) + 1;
    if (data.createdAt?.toMillis) withCreatedAt.push({
      id: d.id, src, city: data.city, country: data.country,
      ms: data.createdAt.toMillis(),
    });
  }
  // Sort DESC like UI does
  withCreatedAt.sort((a, b) => b.ms - a.ms);
  console.log('Total pending:', snap.size);
  console.log('By source:', bySource);
  console.log('Top 5 recent:');
  withCreatedAt.slice(0, 5).forEach(x => {
    console.log(`  [${x.src}] ${x.country} > ${x.city} — ${new Date(x.ms).toISOString()}`);
  });
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
