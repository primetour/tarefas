/**
 * Audit cross-module usage do SSOT geo + gap portal_destinations
 *
 * Mede:
 *   1. Cobertura backfill: quantos docs com countryCode em cada collection
 *   2. Gap portal_destinations vs cidades do banco_roteiros
 *   3. Cross-module mismatch: cidade "Tóquio" no banco mas "Tokyo" nas imagens
 *   4. Cidades órfãs (no banco/tips/images mas sem doc em portal_destinations)
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

function normKey(s) {
  return String(s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

(async () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  AUDIT CROSS-MODULE SSOT USAGE');
  console.log('═══════════════════════════════════════════════════════\n');

  // ── 1. Cobertura backfill v4.59.2 ──
  console.log('═══ 1. COBERTURA BACKFILL countryCode (v4.59.2) ═══');
  const collections = [
    { name: 'portal_destinations', countryField: 'country', codeField: 'countryCode' },
    { name: 'portal_images',       countryField: 'country', codeField: 'countryCode' },
    { name: 'portal_tips',         countryField: 'country', codeField: 'countryCode' },
  ];
  for (const c of collections) {
    const snap = await db.collection(c.name).get();
    const total = snap.size;
    let withCode = 0, withCountry = 0, neither = 0;
    snap.forEach(d => {
      const data = d.data();
      const hasCode = !!data[c.codeField];
      const hasCountry = !!data[c.countryField];
      if (hasCode) withCode++;
      if (hasCountry) withCountry++;
      if (!hasCode && !hasCountry) neither++;
    });
    console.log(`  ${c.name.padEnd(22)} total:${String(total).padStart(4)} · withCode:${String(withCode).padStart(4)} (${Math.round(withCode/total*100)}%) · withCountry:${String(withCountry).padStart(4)} · neither:${neither}`);
  }
  // roteiros_bank usa array
  const bSnap = await db.collection('roteiros_bank').get();
  let bWithCodes = 0;
  bSnap.forEach(d => {
    const data = d.data();
    if (Array.isArray(data.geo?.countryCodes) && data.geo.countryCodes.length > 0) bWithCodes++;
  });
  console.log(`  roteiros_bank          total:${String(bSnap.size).padStart(4)} · withCountryCodes:${String(bWithCodes).padStart(4)} (${Math.round(bWithCodes/bSnap.size*100)}%)`);

  // ── 2. portal_destinations: cidades existentes ──
  console.log('\n═══ 2. CIDADES ATUAIS EM portal_destinations ═══');
  const destSnap = await db.collection('portal_destinations').get();
  const destByKey = new Map();  // normKey(city|country) → doc
  destSnap.forEach(d => {
    const data = d.data();
    if (data.city && data.country) {
      const key = `${normKey(data.city)}|${normKey(data.country)}`;
      destByKey.set(key, { id: d.id, ...data });
    }
  });
  console.log(`  Total destinos: ${destSnap.size}`);
  console.log(`  Únicos por (city|country): ${destByKey.size}`);

  // ── 3. Cidades únicas vindas do banco_roteiros ──
  console.log('\n═══ 3. CIDADES VINDAS DO BANCO DE ROTEIROS ═══');
  const bankCities = new Map();   // key → {city, country, refCount, sampleBankIds}
  bSnap.forEach(d => {
    const data = d.data();
    (data.geo?.cities || []).forEach(c => {
      if (!c.city) return;
      const country = c.country || (data.geo?.countries || [])[0] || '';
      if (!country) return;
      const key = `${normKey(c.city)}|${normKey(country)}`;
      if (!bankCities.has(key)) {
        bankCities.set(key, { city: c.city, country, refCount: 0, sampleBankIds: [] });
      }
      const entry = bankCities.get(key);
      entry.refCount++;
      if (entry.sampleBankIds.length < 3) entry.sampleBankIds.push(d.id);
    });
  });
  console.log(`  Cidades únicas (city|country normalizado): ${bankCities.size}`);
  let inDest = 0, notInDest = 0;
  const orphans = [];
  for (const [key, entry] of bankCities) {
    if (destByKey.has(key)) inDest++;
    else { notInDest++; orphans.push(entry); }
  }
  console.log(`  Já em portal_destinations: ${inDest}`);
  console.log(`  ÓRFÃS (no banco, NÃO em destinos): ${notInDest}`);

  // Top 20 órfãs por refCount
  console.log('\n  Top 20 órfãs (mais referenciadas):');
  orphans.sort((a, b) => b.refCount - a.refCount).slice(0, 20).forEach(o => {
    console.log(`    [${String(o.refCount).padStart(2)}× refs] ${o.city.padEnd(35)} / ${o.country}`);
  });

  // ── 4. Cidades únicas em portal_images ──
  console.log('\n═══ 4. CIDADES EM portal_images ═══');
  const imgSnap = await db.collection('portal_images').get();
  const imgCities = new Map();
  imgSnap.forEach(d => {
    const data = d.data();
    if (data.city && data.country) {
      const key = `${normKey(data.city)}|${normKey(data.country)}`;
      imgCities.set(key, { city: data.city, country: data.country, refCount: (imgCities.get(key)?.refCount || 0) + 1 });
    }
  });
  let imgInDest = 0, imgOrphans = 0;
  for (const key of imgCities.keys()) {
    if (destByKey.has(key)) imgInDest++; else imgOrphans++;
  }
  console.log(`  Únicas: ${imgCities.size} · em destinos: ${imgInDest} · órfãs: ${imgOrphans}`);

  // ── 5. Cidades únicas em portal_tips ──
  console.log('\n═══ 5. CIDADES EM portal_tips ═══');
  const tipSnap = await db.collection('portal_tips').get();
  const tipCities = new Map();
  tipSnap.forEach(d => {
    const data = d.data();
    if (data.city && data.country) {
      const key = `${normKey(data.city)}|${normKey(data.country)}`;
      tipCities.set(key, true);
    }
  });
  let tipInDest = 0, tipOrphans = 0;
  for (const key of tipCities.keys()) {
    if (destByKey.has(key)) tipInDest++; else tipOrphans++;
  }
  console.log(`  Únicas: ${tipCities.size} · em destinos: ${tipInDest} · órfãs: ${tipOrphans}`);

  // ── 6. Resumo final + plano ──
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  RESUMO + PLANO');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  portal_destinations atual:  ${destSnap.size} cidades`);
  console.log(`  Cidades órfãs do BANCO:     ${notInDest}  ← poderiam virar pending`);
  console.log(`  Cidades órfãs de IMAGES:    ${imgOrphans}`);
  console.log(`  Cidades órfãs de TIPS:      ${tipOrphans}`);
  console.log(`  Total potencial novo:       ${notInDest + imgOrphans + tipOrphans} cidades (com dedupe pode reduzir)`);

  console.log('\nDecisão sugerida pro Renê:');
  console.log('  (A) Auto-popular TODAS as órfãs como source="banco-auto" + reviewStatus="pending"');
  console.log('  (B) Auto-popular SÓ top N por refCount (ex: top 50 mais usadas)');
  console.log('  (C) Não popular, deixar curador adicionar manualmente quando precisar');

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
