/**
 * Investiga drift geo entre portal_images e portal_destinations.
 * Mostra labels de ambos lados pra Renê decidir: renomear no Banco?
 * Adicionar alias no destination?
 */
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  console.log('\n=== INSPECT GEO DRIFT ===\n');

  const imgs = await db.collection('portal_images').get();
  const dests = await db.collection('portal_destinations').get();

  // 1. Country drift
  const destCountries = new Map(); // label → count
  dests.docs.forEach(d => {
    const c = d.data().country;
    if (c) destCountries.set(c, (destCountries.get(c) || 0) + 1);
  });
  const imgCountries = new Map();
  imgs.docs.forEach(d => {
    const c = d.data().country;
    if (c) imgCountries.set(c, (imgCountries.get(c) || 0) + 1);
  });

  console.log('[1] COUNTRIES — drift no Banco de Imagens (sem match em destinations):');
  for (const [label, n] of imgCountries.entries()) {
    if (!destCountries.has(label)) {
      // ache candidatos próximos em destinations
      const candidates = [...destCountries.keys()].filter(c =>
        c.toLowerCase().includes(label.toLowerCase().slice(0,4)) ||
        label.toLowerCase().includes(c.toLowerCase().slice(0,4))
      );
      console.log(`  ⚠ Banco de Imagens tem "${label}" (${n} imagens) → SEM match`);
      console.log(`     candidatos em destinations: ${candidates.length ? candidates.join(', ') : '(nenhum)'}`);
    }
  }

  // 2. City drift
  const destCities = new Map(); // city → {country, count}
  dests.docs.forEach(d => {
    const ct = d.data().city;
    const co = d.data().country;
    if (ct) destCities.set(ct, { country: co, count: (destCities.get(ct)?.count || 0) + 1 });
  });
  const imgCities = new Map();
  imgs.docs.forEach(d => {
    const ct = d.data().city;
    const co = d.data().country;
    if (ct) imgCities.set(ct, { country: co, count: (imgCities.get(ct)?.count || 0) + 1 });
  });

  console.log('\n[2] CITIES — drift no Banco de Imagens (sem match em destinations):');
  for (const [label, meta] of imgCities.entries()) {
    if (!destCities.has(label)) {
      const candidates = [...destCities.entries()]
        .filter(([dl, _]) => dl.toLowerCase().slice(0,3) === label.toLowerCase().slice(0,3))
        .map(([dl, dm]) => `${dl} (${dm.country})`);
      console.log(`  ⚠ Banco tem "${label}" / ${meta.country} (${meta.count} imagens) → SEM match`);
      console.log(`     candidatos em destinations: ${candidates.length ? candidates.join(', ') : '(nenhum)'}`);
    }
  }

  // 3. cityAliases existentes em destinations (pra mostrar que schema já suporta)
  let withAliases = 0;
  const aliasExamples = [];
  dests.docs.forEach(d => {
    const a = d.data().cityAliases;
    if (Array.isArray(a) && a.length) {
      withAliases++;
      if (aliasExamples.length < 5) {
        aliasExamples.push(`${d.data().city} → [${a.join(', ')}]`);
      }
    }
  });
  console.log(`\n[3] cityAliases em destinations: ${withAliases}/${dests.size} docs já usam`);
  aliasExamples.forEach(e => console.log(`     ${e}`));

  console.log('\n=== Recomendação ===\n');
  console.log('Opção A) Renomear no Banco de Imagens (mais simples, 1 form-submit por imagem)');
  console.log('Opção B) Adicionar alias no destination via cityAliases (schema já suporta)');
  console.log('Opção C) Helper de normalização no fetchImages (matcha "Kyoto"=="Quioto" etc)\n');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
