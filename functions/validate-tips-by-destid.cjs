/**
 * v4.62.7 — Valida cardinalidade de tips e quantos destinos têm dica
 * cadastrada via FK destinationId.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const tipsSnap = await db.collection('portal_tips').get();
  const destSnap = await db.collection('portal_destinations').get();

  console.log(`portal_tips:         ${tipsSnap.size} docs`);
  console.log(`portal_destinations: ${destSnap.size} docs`);

  const tipsByDestId = new Map();
  let tipsWithoutDestId = 0;
  for (const t of tipsSnap.docs) {
    const data = t.data();
    if (!data.destinationId) { tipsWithoutDestId++; continue; }
    if (!tipsByDestId.has(data.destinationId)) tipsByDestId.set(data.destinationId, []);
    tipsByDestId.get(data.destinationId).push({
      id: t.id,
      title: (data.title || data.city || '(sem)').slice(0, 40),
    });
  }

  console.log(`\n=== Análise ===`);
  console.log(`Tips sem destinationId:    ${tipsWithoutDestId}`);
  console.log(`Destinos COM dica:         ${tipsByDestId.size}`);
  console.log(`Destinos SEM dica:         ${destSnap.size - tipsByDestId.size}`);

  // Multi-tips por destino (caso futuro N:1)
  const multi = [...tipsByDestId.entries()].filter(([, arr]) => arr.length > 1);
  console.log(`Destinos com >1 tip:       ${multi.length}`);
  if (multi.length) {
    console.log('  (top 3):');
    multi.slice(0, 3).forEach(([destId, arr]) => console.log(`    ${destId}: ${arr.length} tips`));
  }

  // Mostra 5 exemplos de destinos COM dica (validação visual)
  console.log(`\n=== 5 exemplos de destinos COM dica ===`);
  let i = 0;
  for (const [destId, tips] of tipsByDestId) {
    if (i++ >= 5) break;
    const dest = (await db.collection('portal_destinations').doc(destId).get()).data();
    console.log(`  ${dest?.city || '???'}, ${dest?.country || '???'} (${destId.slice(0,8)}) → ${tips.length} tip(s)`);
    tips.slice(0, 2).forEach(t => console.log(`    └─ "${t.title}"`));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
