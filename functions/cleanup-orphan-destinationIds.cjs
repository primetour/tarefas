/**
 * v4.62.4 — Limpa órfãs em roteiros_bank.geo.destinationIds[].
 *
 * Após v4.62.0 (M:N anchoring) + qualquer delete de destination entre v4.62.0
 * e v4.62.4 (que NÃO tinha FK cleanup), refs ficam pendentes.
 *
 * Idempotente. Dry-run por padrão (use --apply pra escrever).
 *
 *   node cleanup-orphan-destinationIds.cjs           # dry-run
 *   node cleanup-orphan-destinationIds.cjs --apply
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const APPLY = process.argv.includes('--apply');

(async () => {
  // 1) IDs válidos: tudo em portal_destinations.
  const destSnap = await db.collection('portal_destinations').get();
  const validIds = new Set(destSnap.docs.map(d => d.id));
  console.log(`portal_destinations: ${validIds.size} válidos`);

  // 2) Scan roteiros_bank.geo.destinationIds[] — detecta refs órfãs.
  const bankSnap = await db.collection('roteiros_bank').get();
  console.log(`roteiros_bank: ${bankSnap.size} docs`);

  let docsWithOrphans = 0;
  let totalOrphans = 0;
  let docsEmptiedByCleanup = 0;
  const updates = [];

  for (const d of bankSnap.docs) {
    const data = d.data();
    const ids = data.geo?.destinationIds || [];
    if (!Array.isArray(ids) || ids.length === 0) continue;

    const orphans = ids.filter(x => !validIds.has(x));
    if (orphans.length === 0) continue;

    docsWithOrphans++;
    totalOrphans += orphans.length;
    const cleaned = ids.filter(x => validIds.has(x));
    if (cleaned.length === 0) docsEmptiedByCleanup++;

    updates.push({
      id: d.id,
      title: (data.title || '').slice(0, 50),
      before: ids.length,
      orphans: orphans.length,
      after: cleaned.length,
      cleanedArr: cleaned,
      orphanIds: orphans,
    });
  }

  console.log(`\n=== Análise ===`);
  console.log(`Roteiros com órfãs: ${docsWithOrphans}`);
  console.log(`Total refs órfãs:   ${totalOrphans}`);
  console.log(`Roteiros que cairão no bolsão (array vazio após cleanup): ${docsEmptiedByCleanup}`);

  if (updates.length === 0) {
    console.log('✓ Nenhuma órfã encontrada. Nada pra fazer.');
    process.exit(0);
  }

  console.log(`\n=== Primeiras 10 atualizações ===`);
  updates.slice(0, 10).forEach(u => {
    console.log(`  ${u.id.slice(0, 12)} "${u.title}" — ${u.before} → ${u.after} (${u.orphans} órfã${u.orphans > 1 ? 's' : ''})`);
  });

  if (!APPLY) {
    console.log(`\nDRY-RUN. Rode com --apply pra escrever.`);
    process.exit(0);
  }

  console.log(`\n=== Aplicando ${updates.length} updates... ===`);
  let batch = db.batch();
  let batchCount = 0;
  for (const u of updates) {
    const ref = db.collection('roteiros_bank').doc(u.id);
    const orphanRefs = u.orphanIds.map(id => `${id}::cleanup-script::${new Date().toISOString().slice(0, 10)}`);
    batch.update(ref, {
      'geo.destinationIds':  u.cleanedArr,
      'geo.deletedDestRefs': FV.arrayUnion(...orphanRefs),
      'geo.hasDeletedRefs':  true,
    });
    batchCount++;
    if (batchCount >= 400) {
      await batch.commit();
      console.log(`  commit ${batchCount} updates`);
      batch = db.batch();
      batchCount = 0;
    }
  }
  if (batchCount > 0) {
    await batch.commit();
    console.log(`  commit ${batchCount} updates`);
  }
  console.log(`✓ ${updates.length} roteiros atualizados.`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
