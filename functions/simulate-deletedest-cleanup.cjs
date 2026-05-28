/**
 * v4.62.4 — Simulação dry-run do FK cleanup em deleteDestination.
 *
 * Pega uma destination que TEM refs em roteiros_bank, simula o que a v4.62.4
 * faria ao deletar (sem escrever de fato).
 *
 *   node simulate-deletedest-cleanup.cjs               # acha 1 e simula
 *   node simulate-deletedest-cleanup.cjs <destId>      # simula pra ID específico
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  let destId = process.argv[2];

  if (!destId) {
    // Acha 1 destination que tenha refs em roteiros_bank
    const bankSnap = await db.collection('roteiros_bank').limit(50).get();
    for (const d of bankSnap.docs) {
      const ids = d.data().geo?.destinationIds || [];
      if (ids.length > 0) { destId = ids[0]; break; }
    }
    if (!destId) { console.log('Nenhuma destination com refs encontrada nas primeiras 50 roteiros.'); process.exit(0); }
    console.log(`(escolhido auto: ${destId})`);
  }

  // 1) Carrega o destination
  const destDoc = await db.collection('portal_destinations').doc(destId).get();
  if (!destDoc.exists) { console.log(`Destination ${destId} não existe!`); process.exit(1); }
  const dd = destDoc.data();
  const destLabel = [dd.city, dd.country].filter(Boolean).join(', ');
  console.log(`\nDestination: "${destLabel}" (${destId})`);
  console.log(`  reviewStatus: ${dd.reviewStatus}, source: ${dd.source}`);

  // 2) Simula query do FK cleanup: roteiros_bank com array-contains
  const bankSnap = await db.collection('roteiros_bank')
    .where('geo.destinationIds', 'array-contains', destId).get();
  console.log(`\n  → ${bankSnap.size} roteiros_bank refs encontradas`);

  if (bankSnap.empty) {
    console.log('  Nada pra cleanup. Pode deletar sem efeito colateral.');
    process.exit(0);
  }

  // 3) Mostra o que seria feito em cada doc
  console.log(`\n  Simulação (sem escrever):`);
  bankSnap.docs.slice(0, 5).forEach(d => {
    const data = d.data();
    const ids = data.geo?.destinationIds || [];
    const after = ids.filter(x => x !== destId);
    console.log(`    ${d.id.slice(0, 12)} "${(data.title || '').slice(0, 40)}"`);
    console.log(`       antes: ${ids.length} refs → depois: ${after.length} refs`);
    console.log(`       deletedDestRefs entry: "${destId}::${destLabel || 'sem-label'}::${new Date().toISOString().slice(0, 10)}"`);
    if (after.length === 0) {
      console.log(`       ⚠ cairá no bolsão "Sem âncora geo" (array vazio)`);
    }
  });
  if (bankSnap.size > 5) console.log(`    ... +${bankSnap.size - 5} outros`);

  // 4) Verifica também portal_tips + portal_images (cleanup já existia)
  const tipsSnap = await db.collection('portal_tips')
    .where('destinationId', '==', destId).get();
  const imgsSnap = await db.collection('portal_images')
    .where('destinationId', '==', destId).get();
  console.log(`\n  Cross-collection (já tinham cleanup desde v4.57.39):`);
  console.log(`    portal_tips: ${tipsSnap.size} refs`);
  console.log(`    portal_images: ${imgsSnap.size} refs`);

  console.log(`\n✓ Simulação OK. Em deleteDestination(${destId}) v4.62.4 zeraria:`);
  console.log(`   - ${tipsSnap.size} portal_tips.destinationId → null + flag`);
  console.log(`   - ${imgsSnap.size} portal_images.destinationId → null + flag`);
  console.log(`   - ${bankSnap.size} roteiros_bank.geo.destinationIds (arrayRemove) + flag`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
