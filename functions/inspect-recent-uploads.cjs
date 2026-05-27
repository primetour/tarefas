/**
 * v4.62.8 inspect — pega últimas 20 imagens uploaded e mostra continent/country/city/destinationId/assetCategory.
 * Confirma se o bug é (a) dado não persistido ou (b) dado persistido mas não renderizado.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('portal_images')
    .orderBy('uploadedAt', 'desc').limit(20).get();
  console.log(`Total fetched: ${snap.size}\n`);

  let withLoc = 0, withoutLoc = 0, withDestId = 0;
  for (const d of snap.docs) {
    const x = d.data();
    const hasLoc = !!(x.continent || x.country || x.city);
    if (hasLoc) withLoc++; else withoutLoc++;
    if (x.destinationId) withDestId++;
    console.log(`${d.id.slice(0,10)} [${x.assetCategory||'-'}] ${x.name?.slice(0,30) || '(no name)'}`);
    console.log(`  continent="${x.continent||''}" country="${x.country||''}" city="${x.city||''}"`);
    console.log(`  destinationId=${x.destinationId || '(null)'} | uploadedAt=${x.uploadedAt?.toDate?.().toISOString().slice(0,10)}`);
  }
  console.log(`\n=== Stats ===`);
  console.log(`com loc strings: ${withLoc}`);
  console.log(`sem loc strings: ${withoutLoc}`);
  console.log(`com destinationId FK: ${withDestId}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
