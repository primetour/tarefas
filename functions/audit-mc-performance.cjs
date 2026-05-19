/**
 * Diagnóstico do pipeline de Newsletter / Conteúdo & Temas.
 *
 * User relatou: "Centurion em ~1.5 meses só mostrou 4 cidades. Pela
 * variedade de comunicações enviadas, esse número parece muito abaixo
 * do esperado".
 *
 * Este script responde:
 *   1. Quantos docs há na mc_performance no total + por BU + por período?
 *   2. Quantos têm `extracted` preenchido (% enrichment)?
 *   3. Quantos com `extracted.cities` não-vazio?
 *   4. Quantas cidades únicas por BU (a partir de extracted.cities)?
 *   5. Qual o range de datas dos docs (sentDate)?
 *
 * Sem custo de API — só leitura.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('mc_performance').get();
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`\n📊 mc_performance — ${all.length} documentos no total\n`);

  // Range de datas
  let minDate = null, maxDate = null;
  for (const d of all) {
    const ts = d.sentDate?.toDate?.() || (d.sentDate ? new Date(d.sentDate) : null);
    if (ts && !isNaN(ts.getTime())) {
      if (!minDate || ts < minDate) minDate = ts;
      if (!maxDate || ts > maxDate) maxDate = ts;
    }
  }
  const fmtD = d => d?.toLocaleDateString('pt-BR') || '—';
  console.log(`📅 Range: ${fmtD(minDate)} → ${fmtD(maxDate)}`);
  if (minDate && maxDate) {
    const days = Math.round((maxDate - minDate) / 86400000) + 1;
    console.log(`   (${days} dias de calendário)`);
  }

  // Por BU
  console.log('\n━━━ BU breakdown ━━━');
  const byBu = {};
  for (const d of all) {
    const bu = d.buId || d.buName || d.bu || '(sem BU)';
    if (!byBu[bu]) byBu[bu] = { total: 0, enriched: 0, withCities: 0, withCountries: 0, citiesSet: new Set(), countriesSet: new Set() };
    byBu[bu].total++;
    const ex = d.extracted || {};
    if (Object.keys(ex).length > 0) byBu[bu].enriched++;
    if (Array.isArray(ex.cities) && ex.cities.length) {
      byBu[bu].withCities++;
      ex.cities.forEach(c => { if (c) byBu[bu].citiesSet.add(String(c).trim()); });
    }
    if (Array.isArray(ex.countries) && ex.countries.length) {
      byBu[bu].withCountries++;
      ex.countries.forEach(c => { if (c) byBu[bu].countriesSet.add(String(c).trim()); });
    }
  }

  const buEntries = Object.entries(byBu).sort((a, b) => b[1].total - a[1].total);
  for (const [bu, s] of buEntries) {
    const pctEnriched = s.total > 0 ? (s.enriched / s.total * 100).toFixed(0) : 0;
    const pctCities   = s.total > 0 ? (s.withCities / s.total * 100).toFixed(0) : 0;
    console.log(`\n  ${bu}`);
    console.log(`    docs:           ${s.total}`);
    console.log(`    enriched:       ${s.enriched} (${pctEnriched}%)`);
    console.log(`    com cities[]:   ${s.withCities} (${pctCities}%)`);
    console.log(`    cidades únicas: ${s.citiesSet.size}`);
    console.log(`    países únicos:  ${s.countriesSet.size}`);
    if (s.citiesSet.size <= 10) {
      console.log(`    └ cidades:    ${[...s.citiesSet].join(', ')}`);
    }
    if (s.countriesSet.size <= 10) {
      console.log(`    └ países:     ${[...s.countriesSet].join(', ')}`);
    }
  }

  // Foco em Centurion: lista os docs e o que tá no extracted
  console.log('\n━━━ FOCO: Centurion ━━━');
  const centurion = all.filter(d => /centurion/i.test(d.buId || d.buName || d.bu || ''));
  console.log(`Total docs Centurion: ${centurion.length}\n`);
  centurion.slice(0, 30).forEach(d => {
    const ts = d.sentDate?.toDate?.() || (d.sentDate ? new Date(d.sentDate) : null);
    const ex = d.extracted || {};
    const tag = Object.keys(ex).length === 0 ? '❌ vazio'
              : ex.confidence === 'high' ? '✓ high'
              : ex.confidence === 'medium' ? '~ medium'
              : ex.confidence === 'low' ? '· low'
              : '? sem confidence';
    console.log(`  ${fmtD(ts).padEnd(12)} ${tag.padEnd(15)} ${(d.subject||'').slice(0,60)}`);
    if (ex.cities?.length) console.log(`     cidades: ${ex.cities.join(', ')}`);
    if (ex.countries?.length) console.log(`     países:  ${ex.countries.join(', ')}`);
  });

  // Docs sem extracted no geral
  const allEmpty = all.filter(d => !d.extracted || Object.keys(d.extracted || {}).length === 0);
  console.log(`\n━━━ Docs SEM enrichment: ${allEmpty.length} (${(allEmpty.length / all.length * 100).toFixed(0)}%) ━━━`);
  console.log(`(amostra dos primeiros 5)`);
  allEmpty.slice(0, 5).forEach(d => {
    const ts = d.sentDate?.toDate?.() || null;
    console.log(`  ${fmtD(ts).padEnd(12)} [${(d.buId||d.buName||'?')}] ${(d.subject||'').slice(0,60)}`);
  });

  process.exit(0);
})();
