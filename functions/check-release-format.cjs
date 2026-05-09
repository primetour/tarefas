const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  const snap = await db.collection('dev_hours').get();
  const releases = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(x => x.entryType === 'release')
    .sort((a, b) => {
      const ad = a.completedAt?.toDate?.() || new Date(0);
      const bd = b.completedAt?.toDate?.() || new Date(0);
      return bd - ad;
    })
    .slice(0, 2);
  for (const x of releases) {
    console.log('---', x.releaseVersion || x.title, '---');
    console.log(JSON.stringify({
      releaseVersion: x.releaseVersion,
      releaseSlug: x.releaseSlug,
      title: x.title,
      bucket: x.bucket,
      multiplierIds: x.multiplierIds,
      profile: x.profile,
      humanEquivalentHours: x.humanEquivalentHours,
      aiAssistanceMultiplier: x.aiAssistanceMultiplier,
      totalHours: x.totalHours,
      totalCost: x.totalCost,
      hourlyRate: x.hourlyRate,
      hoursByCategory: x.hoursByCategory,
      status: x.status,
    }, null, 2));
    console.log('summary:', (x.summary||'').slice(0,150));
  }
  process.exit(0);
})();
