/**
 * Backfill geo SSOT — v4.59.2 (sprint Geography SSOT)
 *
 * Adiciona campos NOVOS em todos os docs existentes, SEM remover legados:
 *   - portal_destinations: countryCode, continentCode, source='manual', reviewStatus='approved'
 *   - roteiros_bank:       geo.countryCodes[], geo.continentCodes[]
 *   - portal_images:       countryCode, continentCode
 *   - portal_tips:         countryCode, continentCode
 *
 * Idempotente: docs que já têm countryCode são pulados (verificação pré-write).
 * Dry-run por default — passar `--apply` pra executar.
 *
 * Uso:
 *   cd functions && node backfill-geo-codes.cjs              # dry-run
 *   cd functions && node backfill-geo-codes.cjs --apply      # execute
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const APPLY = process.argv.includes('--apply');

console.log(`\n[backfill-geo] Modo: ${APPLY ? '🟢 APPLY (write real)' : '🟡 DRY-RUN (sem write)'}\n`);

// ───── Carrega countries.js via eval ─────
function loadCountries() {
  const src = fs.readFileSync(path.join(__dirname, '../js/data/countries.js'), 'utf8');
  const match = src.match(/export const COUNTRIES = Object\.freeze\(\[([\s\S]*?)\]\);/);
  if (!match) throw new Error('COUNTRIES não encontrado');
  return eval('[' + match[1] + ']');
}

const countries = loadCountries();
const COUNTRIES_BY_CODE = Object.fromEntries(countries.map(c => [c.code, c]));

function buildNameToCode() {
  const m = {};
  for (const c of countries) {
    const add = (label) => {
      if (!label) return;
      const key = String(label).toLowerCase().trim();
      if (key && !m[key]) m[key] = c.code;
      const noAccent = key.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (noAccent !== key && !m[noAccent]) m[noAccent] = c.code;
    };
    add(c.pt); add(c.en);
    if (Array.isArray(c.aliases)) c.aliases.forEach(add);
  }
  return m;
}
const NAME_TO_CODE = buildNameToCode();

function countryCodeFromLabel(label) {
  if (!label || typeof label !== 'string') return null;
  const raw = label.trim();
  if (!raw) return null;
  const up = raw.toUpperCase();
  if (COUNTRIES_BY_CODE[up]) return up;
  const key = raw.toLowerCase().trim();
  if (NAME_TO_CODE[key]) return NAME_TO_CODE[key];
  const noAccent = key.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return NAME_TO_CODE[noAccent] || null;
}

function continentFromCode(countryCode) {
  return COUNTRIES_BY_CODE[countryCode]?.continent || null;
}

// ────────────────────────────────────────────────────────────
// 1. portal_destinations
// ────────────────────────────────────────────────────────────
async function backfillDestinations() {
  console.log('═══ 1. portal_destinations ═══');
  const snap = await db.collection('portal_destinations').get();
  let skipped = 0, updated = 0, unresolved = 0;
  const batch = db.batch();
  let batchCount = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (data.countryCode && data.continentCode && data.source && data.reviewStatus) {
      skipped++; continue;
    }
    const countryCode = data.countryCode || countryCodeFromLabel(data.country);
    if (!countryCode) {
      console.log(`  ⚠ unresolved: ${docSnap.id} country="${data.country}" city="${data.city}"`);
      unresolved++; continue;
    }
    const continentCode = data.continentCode || continentFromCode(countryCode);
    const update = {
      countryCode,
      continentCode,
      source:       data.source       || 'manual',
      reviewStatus: data.reviewStatus || 'approved',
      cityAliases:  Array.isArray(data.cityAliases) ? data.cityAliases : [],
      // Touch updatedAt pra rastrear migração
      backfillGeoV459: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (APPLY) {
      batch.update(docSnap.ref, update);
      batchCount++;
      if (batchCount >= 400) { await batch.commit(); batchCount = 0; }
    }
    updated++;
  }
  if (APPLY && batchCount > 0) await batch.commit();
  console.log(`  total: ${snap.size} · updated: ${updated} · skipped: ${skipped} · unresolved: ${unresolved}\n`);
}

// ────────────────────────────────────────────────────────────
// 2. roteiros_bank — geo.countryCodes[] + geo.continentCodes[]
// ────────────────────────────────────────────────────────────
async function backfillRoteirosBank() {
  console.log('═══ 2. roteiros_bank ═══');
  const snap = await db.collection('roteiros_bank').get();
  let skipped = 0, updated = 0, partial = 0;
  // Não usa batch único — docs podem ter campos aninhados grandes
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const geo = data.geo || {};
    if (Array.isArray(geo.countryCodes) && Array.isArray(geo.continentCodes) && geo.countryCodes.length > 0) {
      skipped++; continue;
    }
    const labels = Array.isArray(geo.countries) ? geo.countries : [];
    const countryCodes = [];
    const unresolved = [];
    for (const l of labels) {
      const code = countryCodeFromLabel(l);
      if (code) {
        if (!countryCodes.includes(code)) countryCodes.push(code);
      } else if (l) unresolved.push(l);
    }
    const continentCodes = [...new Set(countryCodes.map(continentFromCode).filter(Boolean))];
    if (unresolved.length) {
      console.log(`  ⚠ partial: ${docSnap.id} unresolved=${JSON.stringify(unresolved)}`);
      partial++;
    }
    const update = {
      'geo.countryCodes':   countryCodes,
      'geo.continentCodes': continentCodes,
      backfillGeoV459: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (APPLY) await docSnap.ref.update(update);
    updated++;
  }
  console.log(`  total: ${snap.size} · updated: ${updated} · skipped: ${skipped} · partial(parcial): ${partial}\n`);
}

// ────────────────────────────────────────────────────────────
// 3. portal_images
// ────────────────────────────────────────────────────────────
async function backfillImages() {
  console.log('═══ 3. portal_images ═══');
  const snap = await db.collection('portal_images').get();
  let skipped = 0, updated = 0, unresolved = 0;
  const batch = db.batch();
  let batchCount = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (data.countryCode) { skipped++; continue; }
    if (!data.country) { skipped++; continue; }
    const countryCode = countryCodeFromLabel(data.country);
    if (!countryCode) {
      console.log(`  ⚠ unresolved: ${docSnap.id} country="${data.country}"`);
      unresolved++; continue;
    }
    const continentCode = continentFromCode(countryCode);
    const update = {
      countryCode,
      continentCode,
      backfillGeoV459: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (APPLY) {
      batch.update(docSnap.ref, update);
      batchCount++;
      if (batchCount >= 400) { await batch.commit(); batchCount = 0; }
    }
    updated++;
  }
  if (APPLY && batchCount > 0) await batch.commit();
  console.log(`  total: ${snap.size} · updated: ${updated} · skipped: ${skipped} · unresolved: ${unresolved}\n`);
}

// ────────────────────────────────────────────────────────────
// 4. portal_tips
// ────────────────────────────────────────────────────────────
async function backfillTips() {
  console.log('═══ 4. portal_tips ═══');
  const snap = await db.collection('portal_tips').get();
  let skipped = 0, updated = 0, unresolved = 0;
  const batch = db.batch();
  let batchCount = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (data.countryCode) { skipped++; continue; }
    if (!data.country) { skipped++; continue; }
    const countryCode = countryCodeFromLabel(data.country);
    if (!countryCode) {
      console.log(`  ⚠ unresolved: ${docSnap.id} country="${data.country}"`);
      unresolved++; continue;
    }
    const continentCode = continentFromCode(countryCode);
    const update = {
      countryCode,
      continentCode,
      backfillGeoV459: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (APPLY) {
      batch.update(docSnap.ref, update);
      batchCount++;
      if (batchCount >= 400) { await batch.commit(); batchCount = 0; }
    }
    updated++;
  }
  if (APPLY && batchCount > 0) await batch.commit();
  console.log(`  total: ${snap.size} · updated: ${updated} · skipped: ${skipped} · unresolved: ${unresolved}\n`);
}

(async () => {
  try {
    await backfillDestinations();
    await backfillRoteirosBank();
    await backfillImages();
    await backfillTips();
    console.log('═══════════════════════════════════════════════════════');
    console.log(APPLY ? '✓ Backfill APLICADO em produção.' : '✓ DRY-RUN OK. Re-rode com --apply pra aplicar.');
    process.exit(0);
  } catch (e) {
    console.error('[backfill] ERRO:', e);
    process.exit(1);
  }
})();
