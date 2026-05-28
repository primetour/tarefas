/**
 * Triple-check Banco × Portal Dicas — valida HIPÓTESES dos bugs HIGH do Agent.
 * Roda queries em produção pra confirmar se cleanups FK operam em schema fantasma.
 */
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  console.log('\n=== TRIPLE-CHECK BANCO × PORTAL ===\n');

  // (1) % portal_images com destinationId setado (espero ~0%)
  const imgs = await db.collection('portal_images').get();
  const imgsWithDestId = imgs.docs.filter(d => d.data().destinationId).length;
  console.log(`[1] portal_images com destinationId: ${imgsWithDestId}/${imgs.size}` +
    `  (${imgs.size ? (100 * imgsWithDestId / imgs.size).toFixed(1) : 0}%)`);

  // (2) % portal_destinations com heroImage setado (espero ~0%)
  const dests = await db.collection('portal_destinations').get();
  const destsWithHero = dests.docs.filter(d => d.data().heroImage).length;
  console.log(`[2] portal_destinations com heroImage: ${destsWithHero}/${dests.size}` +
    `  (${dests.size ? (100 * destsWithHero / dests.size).toFixed(1) : 0}%)`);

  // (3) % portal_tips com pelo menos 1 segments[].items[].image.imageId (espero ~0%)
  const tips = await db.collection('portal_tips').get();
  let tipsWithImg = 0;
  tips.docs.forEach(d => {
    const segs = Object.values(d.data().segments || {});
    if (segs.some(s => (s.items || []).some(i => i?.image?.imageId))) tipsWithImg++;
  });
  console.log(`[3] portal_tips com image.imageId em items: ${tipsWithImg}/${tips.size}` +
    `  (${tips.size ? (100 * tipsWithImg / tips.size).toFixed(1) : 0}%)`);

  // (4) portal_web_links com _overrides usando R2 URLs (potencial 404 pós-delete)
  const links = await db.collection('portal_web_links').get();
  let withR2Overrides = 0;
  let totalOverrideUrls = 0;
  let overrideUrlsWithImageId = 0;
  links.docs.forEach(d => {
    const ibd = d.data().imagesByDest || {};
    for (const k of Object.keys(ibd)) {
      const ov = ibd[k]?._overrides || {};
      let hasR2 = false;
      for (const seg of Object.values(ov)) {
        for (const it of Object.values(seg || {})) {
          const url = String(it?.url || '');
          if (url.includes('.r2.dev')) {
            hasR2 = true;
            totalOverrideUrls++;
            if (it?.imageId) overrideUrlsWithImageId++;
          }
        }
      }
      if (hasR2) { withR2Overrides++; break; }
    }
  });
  console.log(`[4] portal_web_links com overrides pra R2: ${withR2Overrides}/${links.size}`);
  console.log(`    overrides URLs R2 totais: ${totalOverrideUrls}, com imageId: ${overrideUrlsWithImageId}` +
    `  (${totalOverrideUrls ? (100 * overrideUrlsWithImageId / totalOverrideUrls).toFixed(1) : 0}%)`);

  // (5) drift label country: portal_images vs portal_destinations
  const destCountries = new Set(dests.docs.map(d => d.data().country).filter(Boolean));
  const imgCountries  = new Set(imgs.docs.map(d => d.data().country).filter(Boolean));
  const orphanInImg   = [...imgCountries].filter(c => !destCountries.has(c));
  console.log(`[5] country em portal_images SEM match em destinations: ${orphanInImg.length} labels`);
  if (orphanInImg.length) console.log(`    → ${orphanInImg.slice(0, 10).join(', ')}${orphanInImg.length > 10 ? '…' : ''}`);

  // (6) drift cidade label
  const destCities = new Set(dests.docs.map(d => d.data().city).filter(Boolean));
  const imgCities  = new Set(imgs.docs.map(d => d.data().city).filter(Boolean));
  const orphanCities = [...imgCities].filter(c => !destCities.has(c));
  console.log(`[6] city em portal_images SEM match em destinations: ${orphanCities.length} labels`);
  if (orphanCities.length) console.log(`    → ${orphanCities.slice(0, 10).join(', ')}${orphanCities.length > 10 ? '…' : ''}`);

  // (7) Quantidade total de imagens no Banco por categoria
  const byType = {};
  imgs.docs.forEach(d => {
    const t = d.data().assetCategory || d.data().type || '(none)';
    byType[t] = (byType[t] || 0) + 1;
  });
  console.log(`[7] portal_images por assetCategory:`);
  Object.entries(byType).sort((a,b) => b[1] - a[1]).forEach(([k,v]) =>
    console.log(`    ${String(k).padEnd(20)} ${v}`));

  console.log('\n✓ Audit completo.\n');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
