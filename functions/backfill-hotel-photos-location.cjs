/**
 * v4.62.8 backfill — preenche continent/country/city das 17 fotos hotel
 * uploadeds hoje que ficaram com strings vazias por causa do bug do ternário
 * requiresLoc.
 *
 * Heurística: agrupa por name prefix.
 *   - "Plaza Atheneé Paris" → Europa / França / Paris
 *   - "Acqualina"           → América do Norte / EUA / Sunny Isles Beach
 *
 * Idempotente. Dry-run por padrão (use --apply pra escrever).
 *
 *   node backfill-hotel-photos-location.cjs           # dry-run
 *   node backfill-hotel-photos-location.cjs --apply
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const APPLY = process.argv.includes('--apply');

// Mapa nome-prefix → location. Adicione mais quando rodar pra novos casos.
const NAME_TO_LOC = [
  // Nomes alinhados ao SSOT (portal_destinations): "Estados Unidos", "Miami"
  { prefix: /^plaza\s*atheneé\s*paris/i,
    loc: { continent: 'Europa', country: 'França', city: 'Paris' } },
  { prefix: /^acqualina/i,
    loc: { continent: 'América do Norte', country: 'Estados Unidos', city: 'Miami' } },
];

(async () => {
  const snap = await db.collection('portal_images')
    .where('assetCategory', '==', 'hotel').get();

  const updates = [];
  for (const d of snap.docs) {
    const data = d.data();
    if (data.continent || data.country || data.city) continue;   // já tem algo
    const match = NAME_TO_LOC.find(m => m.prefix.test(data.name || ''));
    if (!match) continue;
    updates.push({
      id: d.id, name: data.name,
      from: { continent: data.continent, country: data.country, city: data.city },
      to: match.loc,
    });
  }

  console.log(`portal_images (hotel): ${snap.size} docs`);
  console.log(`Updates planejados:    ${updates.length}\n`);
  updates.slice(0, 25).forEach(u => {
    console.log(`  ${u.id.slice(0,10)} "${u.name?.slice(0,30)}" → ${u.to.country}/${u.to.city}`);
  });

  if (!APPLY) {
    console.log(`\nDRY-RUN. Rode com --apply pra escrever.`);
    process.exit(0);
  }

  console.log(`\n=== Aplicando ${updates.length} updates ===`);
  let batch = db.batch();
  let count = 0;
  for (const u of updates) {
    batch.update(db.collection('portal_images').doc(u.id), u.to);
    if (++count >= 400) { await batch.commit(); batch = db.batch(); count = 0; }
  }
  if (count > 0) await batch.commit();
  console.log(`✓ ${updates.length} fotos atualizadas.`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
