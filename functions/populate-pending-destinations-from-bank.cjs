/**
 * Auto-popular portal_destinations com cidades órfãs do banco de roteiros
 *
 * v4.60.0 Step 1 — sprint pós-SSOT geo.
 *
 * Cada cidade órfã (em roteiros_bank.geo.cities mas NÃO em portal_destinations)
 * vira um doc novo:
 *   - source: 'banco-auto'
 *   - reviewStatus: 'pending'   ← master aprova depois
 *   - countryCode + continentCode resolvidos via js/data/countries.js
 *   - sampleBankIds[]: até 3 ids de roteiros que referenciam (rastreabilidade)
 *   - createdBy: 'system'
 *
 * Idempotente: re-execução skipa cidades que já existem.
 * Dry-run por default; passar --apply pra escrever.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const APPLY = process.argv.includes('--apply');

console.log(`\n[populate-pending] Modo: ${APPLY ? '🟢 APPLY (write real)' : '🟡 DRY-RUN'}\n`);

// ── Carrega SSOT countries ──
function loadCountries() {
  const src = fs.readFileSync(path.join(__dirname, '../js/data/countries.js'), 'utf8');
  const match = src.match(/export const COUNTRIES = Object\.freeze\(\[([\s\S]*?)\]\);/);
  if (!match) throw new Error('COUNTRIES não encontrado');
  return eval('[' + match[1] + ']');
}
const COUNTRIES = loadCountries();
const BY_CODE = Object.fromEntries(COUNTRIES.map(c => [c.code, c]));
const NAME_TO_CODE = (() => {
  const m = {};
  for (const c of COUNTRIES) {
    const add = label => {
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
})();
function countryCodeFromLabel(label) {
  if (!label) return null;
  const up = String(label).trim().toUpperCase();
  if (BY_CODE[up]) return up;
  const key = String(label).toLowerCase().trim();
  if (NAME_TO_CODE[key]) return NAME_TO_CODE[key];
  const noAccent = key.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return NAME_TO_CODE[noAccent] || null;
}

function normKey(s) {
  return String(s || '').toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Mapa continentCode → label pt
const CONTINENT_LABELS = {
  AF: 'África', AN: 'Antártida', AS: 'Ásia', EU: 'Europa',
  NA: 'América do Norte', OC: 'Oceania', SA: 'América do Sul',
};

(async () => {
  // 1. Carrega portal_destinations atuais (lookup por normKey)
  const destSnap = await db.collection('portal_destinations').get();
  const existing = new Map();
  destSnap.forEach(d => {
    const data = d.data();
    if (data.city && data.country) {
      existing.set(`${normKey(data.city)}|${normKey(data.country)}`, true);
    }
  });
  console.log(`portal_destinations atuais: ${existing.size} cidades únicas`);

  // 2. Coleta cidades únicas do banco_roteiros + ref count + sample IDs
  const bankSnap = await db.collection('roteiros_bank').get();
  const orphans = new Map();  // normKey → {city, country, sampleBankIds, refCount}
  bankSnap.forEach(d => {
    const data = d.data();
    (data.geo?.cities || []).forEach(c => {
      if (!c.city) return;
      const country = c.country || (data.geo?.countries || [])[0] || '';
      if (!country) return;
      const key = `${normKey(c.city)}|${normKey(country)}`;
      if (existing.has(key)) return;  // já existe
      if (!orphans.has(key)) {
        orphans.set(key, {
          city: c.city.trim(),
          country: country.trim(),
          sampleBankIds: [],
          refCount: 0,
        });
      }
      const o = orphans.get(key);
      o.refCount++;
      if (o.sampleBankIds.length < 3) o.sampleBankIds.push(d.id);
    });
  });
  console.log(`Cidades órfãs encontradas: ${orphans.size}`);

  if (orphans.size === 0) {
    console.log('\n✓ Nada pra popular. Tudo já sincronizado.');
    process.exit(0);
  }

  // 3. Pra cada órfã, resolve códigos ISO e prepara doc
  let resolved = 0, unresolved = 0;
  const toWrite = [];
  for (const [key, o] of orphans) {
    const countryCode = countryCodeFromLabel(o.country);
    if (!countryCode) {
      console.log(`  ⚠ unresolved country: ${o.city} / ${o.country}`);
      unresolved++; continue;
    }
    const continentCode = BY_CODE[countryCode]?.continent || null;
    const countryPt = BY_CODE[countryCode]?.pt || o.country;
    const continentLabel = continentCode ? CONTINENT_LABELS[continentCode] : '';

    const slug = [continentLabel, countryPt, o.city].filter(Boolean).map(slugify).join('/');

    toWrite.push({
      city: o.city,
      country: countryPt,
      continent: continentLabel,
      countryCode,
      continentCode,
      cityAliases: [],
      source: 'banco-auto',
      reviewStatus: 'pending',
      envisionLocationId: null,
      sampleBankIds: o.sampleBankIds,
      refCount: o.refCount,
      slug,
    });
    resolved++;
  }

  console.log(`\nResolved: ${resolved} · Unresolved: ${unresolved}`);

  // 4. Write em batches de 400
  if (APPLY) {
    let batch = db.batch();
    let ops = 0;
    for (const doc of toWrite) {
      const ref = db.collection('portal_destinations').doc();
      batch.set(ref, {
        ...doc,
        createdAt: FV.serverTimestamp(),
        createdBy:  'system',
        updatedAt: FV.serverTimestamp(),
        updatedBy:  'system',
      });
      ops++;
      if (ops >= 400) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
    if (ops > 0) await batch.commit();
    console.log(`\n✓ ${resolved} destinos pending criados em portal_destinations.`);
  } else {
    console.log('\nAmostra (10 primeiros pra escrever):');
    toWrite.slice(0, 10).forEach(d => {
      console.log(`  + ${d.city.padEnd(30)} / ${d.country.padEnd(20)} [${d.countryCode}/${d.continentCode}] refs:${d.refCount}`);
    });
    console.log(`\n✓ DRY-RUN OK. Re-rode com --apply pra criar ${resolved} destinos.`);
  }

  process.exit(0);
})().catch(e => { console.error('[populate] ERRO:', e); process.exit(1); });
