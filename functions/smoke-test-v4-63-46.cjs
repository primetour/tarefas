/**
 * Smoke test v4.63.45-46 — validações via Admin SDK.
 */
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  console.log('\n=== SMOKE TEST v4.63.45-46 ===\n');

  // 1. portal_destinations existem
  const destsSnap = await db.collection('portal_destinations').limit(5).get();
  console.log(`[1] portal_destinations: ${destsSnap.size} docs lidos (sample)`);

  // 2. portal_tips agrupado por destinationId
  const tipsSnap = await db.collection('portal_tips').get();
  const tipsByDest = new Map();
  tipsSnap.forEach(d => {
    const t = d.data();
    if (t.destinationId) tipsByDest.set(t.destinationId, (tipsByDest.get(t.destinationId) || 0) + 1);
  });
  console.log(`[2] portal_tips: ${tipsSnap.size} dicas em ${tipsByDest.size} destinos únicos`);

  // 3. Listar destinos com dicas + ver se já têm _geo (cache geocoded)
  let withGeo = 0, withoutGeo = 0;
  const sampleDests = [];
  for (const [destId, count] of tipsByDest.entries()) {
    try {
      const snap = await db.collection('portal_destinations').doc(destId).get();
      if (!snap.exists) continue;
      const d = snap.data();
      if (d._geo?.lat && d._geo?.lng) withGeo++;
      else withoutGeo++;
      if (sampleDests.length < 8) sampleDests.push({
        id: destId,
        city: d.city,
        country: d.country,
        tips: count,
        hasGeo: !!(d._geo?.lat && d._geo?.lng),
      });
    } catch {}
  }
  console.log(`[3] destinos com dicas: ${withGeo} com _geo, ${withoutGeo} sem _geo (vão geocodar via Nominatim no primeiro load)`);
  console.log('[4] sample destinations com dicas:');
  sampleDests.forEach(d => {
    console.log(`     ${d.hasGeo ? '✓' : '·'} ${d.city.padEnd(20)} ${d.country.padEnd(20)} ${String(d.tips).padStart(3)} dicas`);
  });

  // 5. Áreas com logoUrl pra teste de logo no Step 1
  const areasSnap = await db.collection('portal_areas').get();
  let withLogo = 0, withoutLogo = 0;
  const areaSample = [];
  areasSnap.forEach(d => {
    const a = d.data();
    if (a.logoUrl) withLogo++; else withoutLogo++;
    areaSample.push({ name: a.name, hasLogo: !!a.logoUrl, category: a.category || '(standalone)' });
  });
  console.log(`\n[5] portal_areas: ${withLogo} com logoUrl, ${withoutLogo} sem`);
  areaSample.slice(0, 8).forEach(a => {
    console.log(`     ${a.hasLogo ? '🎨' : '·'} ${a.name.padEnd(25)} ${a.category}`);
  });

  // 6. portal_tip_tags vocabulary
  const tagsDoc = await db.collection('portal_tip_tags').doc('_root').get();
  if (tagsDoc.exists) {
    const tags = tagsDoc.data().tags || [];
    console.log(`\n[6] portal_tip_tags vocab: ${tags.length} tags. Sample: ${tags.slice(0, 5).join(', ')}…`);
  } else {
    console.log(`\n[6] portal_tip_tags vocab: ainda usando DEFAULT_TIP_TAGS (sem custom adicionado)`);
  }

  // 7. partner_downloads existe e schema OK
  const dlSnap = await db.collection('portal_downloads').limit(3).get();
  console.log(`\n[7] portal_downloads: ${dlSnap.size} entries`);
  dlSnap.forEach(d => {
    const e = d.data();
    console.log(`     ${d.id}: count=${e.count}, date=${e.date}`);
  });

  console.log('\n✓ Smoke test completo.\n');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
