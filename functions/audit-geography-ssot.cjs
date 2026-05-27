/**
 * Audit Geography SSOT (sprint v4.59 step 1)
 *
 * Roda contra Firestore prod + arquivos js/data/{continents,countries}.js
 * e reporta:
 *   1. Países do Envision (atuais em roteiros_bank) que NÃO batem no SSOT
 *   2. portal_destinations cujo `country` não bate no SSOT
 *   3. Inferência de countryCode pra cada doc (qual ISO code resolveria)
 *
 * Sem write — apenas leitura + report. Pra validar SSOT antes de qualquer mutação.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

// Carrega countries.js manualmente (não dá pra require ES module em .cjs sem flag)
function loadCountries() {
  const p = path.join(__dirname, '../js/data/countries.js');
  const src = fs.readFileSync(p, 'utf8');
  // Extrai o array COUNTRIES via eval controlado (seguro: arquivo trusted local).
  // Bem feio mas resolve. Alternativa: rodar com `node --experimental-vm-modules`.
  const match = src.match(/export const COUNTRIES = Object\.freeze\(\[([\s\S]*?)\]\);/);
  if (!match) throw new Error('Não encontrei COUNTRIES no arquivo');
  const arrLiteral = '[' + match[1] + ']';
  // eslint-disable-next-line no-eval
  const arr = eval(arrLiteral);
  return arr;
}

function buildNameToCode(countries) {
  const m = {};
  for (const c of countries) {
    const add = (label) => {
      if (!label) return;
      const key = String(label).toLowerCase().trim();
      if (key && !m[key]) m[key] = c.code;
      const noAccent = key.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (noAccent !== key && !m[noAccent]) m[noAccent] = c.code;
    };
    add(c.pt);
    add(c.en);
    if (Array.isArray(c.aliases)) c.aliases.forEach(add);
  }
  return m;
}

function codeFromLabel(label, nameToCode, byCode) {
  if (!label || typeof label !== 'string') return null;
  const raw = label.trim();
  if (!raw) return null;
  const up = raw.toUpperCase();
  if (byCode[up]) return up;
  const key = raw.toLowerCase().trim();
  if (nameToCode[key]) return nameToCode[key];
  const noAccent = key.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return nameToCode[noAccent] || null;
}

(async () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  GEOGRAPHY SSOT — AUDIT (read-only)');
  console.log('═══════════════════════════════════════════════════════\n');

  const countries = loadCountries();
  const byCode = Object.fromEntries(countries.map(c => [c.code, c]));
  const nameToCode = buildNameToCode(countries);
  console.log(`[ssot] Carregados ${countries.length} países no SSOT (js/data/countries.js)\n`);

  // ───── 1. roteiros_bank: países únicos
  const bankSnap = await db.collection('roteiros_bank').get();
  const bankCountryCounts = {};
  bankSnap.forEach(d => {
    const arr = d.data().geo?.countries || [];
    arr.forEach(c => {
      bankCountryCounts[c] = (bankCountryCounts[c] || 0) + 1;
    });
  });
  const bankCountries = Object.entries(bankCountryCounts).sort((a, b) => b[1] - a[1]);

  console.log('═══ 1. ROTEIROS_BANK ═══');
  console.log(`Total docs: ${bankSnap.size}`);
  console.log(`Países únicos em geo.countries: ${bankCountries.length}\n`);

  let bankMatched = 0;
  let bankUnmatched = 0;
  const unmatchedList = [];
  for (const [name, count] of bankCountries) {
    const code = codeFromLabel(name, nameToCode, byCode);
    if (code) {
      bankMatched++;
      const canon = byCode[code].pt;
      const flag = canon === name ? '✓' : `✓ → "${canon}" (${code})`;
      console.log(`  [${String(count).padStart(3)}] ${name.padEnd(35)} ${flag}`);
    } else {
      bankUnmatched++;
      unmatchedList.push({ name, count });
      console.log(`  [${String(count).padStart(3)}] ${name.padEnd(35)} ✗ NÃO BATE no SSOT`);
    }
  }
  console.log(`\n  Match: ${bankMatched}/${bankCountries.length} (${Math.round(bankMatched / bankCountries.length * 100)}%)`);
  if (unmatchedList.length) {
    console.log(`  ⚠ Países sem match: ${unmatchedList.map(u => u.name).join(', ')}`);
  }

  // ───── 2. portal_destinations: countries únicos
  const destSnap = await db.collection('portal_destinations').get();
  const destCountryCounts = {};
  const destSampleByCountry = {};
  destSnap.forEach(d => {
    const data = d.data();
    const c = data.country;
    if (c) {
      destCountryCounts[c] = (destCountryCounts[c] || 0) + 1;
      if (!destSampleByCountry[c]) destSampleByCountry[c] = data.city || '<sem cidade>';
    }
  });
  const destCountries = Object.entries(destCountryCounts).sort((a, b) => b[1] - a[1]);

  console.log('\n═══ 2. PORTAL_DESTINATIONS ═══');
  console.log(`Total docs: ${destSnap.size}`);
  console.log(`Países únicos: ${destCountries.length}\n`);

  let destMatched = 0;
  let destUnmatched = 0;
  for (const [name, count] of destCountries) {
    const code = codeFromLabel(name, nameToCode, byCode);
    if (code) {
      destMatched++;
      const canon = byCode[code].pt;
      const flag = canon === name ? '✓' : `✓ → "${canon}" (${code})`;
      console.log(`  [${String(count).padStart(3)}] ${name.padEnd(35)} ${flag}`);
    } else {
      destUnmatched++;
      console.log(`  [${String(count).padStart(3)}] ${name.padEnd(35)} ✗ NÃO BATE (cidade exemplo: ${destSampleByCountry[name]})`);
    }
  }
  console.log(`\n  Match: ${destMatched}/${destCountries.length}`);

  // ───── 3. portal_images: country único
  const imgSnap = await db.collection('portal_images').get();
  const imgCountryCounts = {};
  imgSnap.forEach(d => {
    const c = d.data().country;
    if (c) imgCountryCounts[c] = (imgCountryCounts[c] || 0) + 1;
  });
  const imgCountries = Object.entries(imgCountryCounts).sort((a, b) => b[1] - a[1]);

  console.log('\n═══ 3. PORTAL_IMAGES ═══');
  console.log(`Total docs: ${imgSnap.size}`);
  console.log(`Países únicos: ${imgCountries.length}\n`);

  let imgMatched = 0;
  for (const [name, count] of imgCountries) {
    const code = codeFromLabel(name, nameToCode, byCode);
    if (code) {
      imgMatched++;
      const canon = byCode[code].pt;
      const flag = canon === name ? '✓' : `✓ → "${canon}" (${code})`;
      console.log(`  [${String(count).padStart(3)}] ${name.padEnd(35)} ${flag}`);
    } else {
      console.log(`  [${String(count).padStart(3)}] ${name.padEnd(35)} ✗ NÃO BATE`);
    }
  }
  console.log(`\n  Match: ${imgMatched}/${imgCountries.length}`);

  // ───── 4. portal_tips: country único
  const tipSnap = await db.collection('portal_tips').get();
  const tipCountryCounts = {};
  tipSnap.forEach(d => {
    const c = d.data().country;
    if (c) tipCountryCounts[c] = (tipCountryCounts[c] || 0) + 1;
  });
  const tipCountries = Object.entries(tipCountryCounts).sort((a, b) => b[1] - a[1]);

  console.log('\n═══ 4. PORTAL_TIPS ═══');
  console.log(`Total docs: ${tipSnap.size}`);
  console.log(`Países únicos: ${tipCountries.length}\n`);

  let tipMatched = 0;
  for (const [name, count] of tipCountries) {
    const code = codeFromLabel(name, nameToCode, byCode);
    if (code) {
      tipMatched++;
      const canon = byCode[code].pt;
      const flag = canon === name ? '✓' : `✓ → "${canon}" (${code})`;
      console.log(`  [${String(count).padStart(3)}] ${name.padEnd(35)} ${flag}`);
    } else {
      console.log(`  [${String(count).padStart(3)}] ${name.padEnd(35)} ✗ NÃO BATE`);
    }
  }
  console.log(`\n  Match: ${tipMatched}/${tipCountries.length || 1}`);

  // ───── 5. Summary final
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  RESUMO FINAL');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  roteiros_bank:       ${bankMatched}/${bankCountries.length} países OK`);
  console.log(`  portal_destinations: ${destMatched}/${destCountries.length} países OK`);
  console.log(`  portal_images:       ${imgMatched}/${imgCountries.length} países OK`);
  console.log(`  portal_tips:         ${tipMatched}/${tipCountries.length || 1} países OK`);
  console.log('\n  Países unmatched no roteiros_bank (precisam de adição ao SSOT):');
  if (unmatchedList.length === 0) {
    console.log('    🎉 ZERO! SSOT cobre tudo.');
  } else {
    unmatchedList.forEach(u => {
      console.log(`    - "${u.name}" (${u.count} docs)`);
    });
  }

  process.exit(0);
})().catch(e => {
  console.error('[audit] ERRO:', e);
  process.exit(1);
});
