/**
 * Backfill — vincula geo.destinationIds[] dos 236 roteiros_bank existentes.
 *
 * v4.62.0 — fecha o loop M:N roteiro ↔ destination.
 *
 * Pra cada roteiro:
 *   1. Lê cities[] (cada uma pode ser trecho/propriedade do Envision)
 *   2. Normaliza cada cidade (split " - ", strip "(...)") → cidades atômicas
 *   3. Pra cada cidade atômica + country:
 *      a. Tenta findDestinationByLabel — bate aliases também
 *      b. Se achou: pega id existente
 *      c. Se não achou: cria pending banco-auto via Admin SDK direto
 *   4. Update doc: geo.cities[] (atômicas + originalCity preservada) +
 *      geo.destinationIds[] (unique IDs)
 *
 * Idempotente: roteiros que JÁ têm destinationIds populado são skipped.
 * Dry-run por default; --apply pra executar.
 *
 * Uso:
 *   cd functions && node backfill-bank-destinationIds.cjs           # dry-run
 *   cd functions && node backfill-bank-destinationIds.cjs --apply   # apply
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const APPLY = process.argv.includes('--apply');

console.log(`\n[backfill-destinationIds] Modo: ${APPLY ? '🟢 APPLY' : '🟡 DRY-RUN'}\n`);

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

// ── Mesmo normalizeCityName do adapter ──
function normalizeCityName(raw) {
  if (!raw || typeof raw !== 'string') return [];
  let s = raw.trim();
  if (!s) return [];
  s = s.replace(/\s*\([^)]*\)/g, '').trim();
  if (!s) return [];
  s = s.replace(/\s*[-–]\s*(Tanzânia|Brasil|Argentina|Chile|Peru|Bolívia|África do Sul|Egito|Quênia|Marrocos|Tailândia|Vietnã|Camboja|Laos|China|Japão|Índia|Indonésia|Austrália|Nova Zelândia|Polinésia Francesa|Maldivas)$/i, '').trim();
  const trechoParts = s.split(/\s+[-–]\s+/).map(p => p.trim()).filter(Boolean);
  const atomic = [];
  for (const part of trechoParts) {
    const commaParts = part.split(',').map(p => p.trim()).filter(Boolean);
    if (commaParts.length <= 2) atomic.push(...commaParts);
    else atomic.push(commaParts[0]);
  }
  const seen = new Set();
  const out = [];
  for (const c of atomic) {
    const k = normKey(c);
    if (k && !seen.has(k)) { seen.add(k); out.push(c); }
  }
  return out;
}

const CONTINENT_LABELS = {
  AF: 'África', AS: 'Ásia', EU: 'Europa', NA: 'América do Norte',
  SA: 'América do Sul', OC: 'Oceania', AN: 'Antártida',
};

(async () => {
  // 1. Carrega todos destinations pra lookup local (cache em memória)
  const destSnap = await db.collection('portal_destinations').get();
  const destsByCountryCode = new Map();   // countryCode → [{id, city, cityAliases}]
  destSnap.forEach(d => {
    const data = d.data();
    const code = data.countryCode || countryCodeFromLabel(data.country);
    if (!code) return;
    if (!destsByCountryCode.has(code)) destsByCountryCode.set(code, []);
    destsByCountryCode.get(code).push({
      id: d.id, city: data.city, cityAliases: data.cityAliases || [],
    });
  });
  console.log(`portal_destinations no cache: ${destSnap.size}`);

  function findDest(country, city) {
    const code = countryCodeFromLabel(country);
    if (!code) return null;
    const candidates = destsByCountryCode.get(code) || [];
    const cityNorm = normKey(city);
    return candidates.find(c =>
      normKey(c.city) === cityNorm ||
      c.cityAliases.some(a => normKey(a) === cityNorm)
    ) || null;
  }

  async function createPendingDest(country, city) {
    const code = countryCodeFromLabel(country);
    if (!code) return null;
    const entry = BY_CODE[code];
    const ref = db.collection('portal_destinations').doc();
    const continentCode = entry?.continent;
    const continentLabel = CONTINENT_LABELS[continentCode] || '';
    const countryPt = entry?.pt || country;
    const slug = [continentLabel, countryPt, city].filter(Boolean).map(slugify).join('/');
    const doc = {
      continent: continentLabel,
      country: countryPt,
      city: String(city).trim(),
      countryCode: code,
      continentCode,
      cityAliases: [],
      source: 'banco-auto',
      reviewStatus: 'pending',
      slug,
      autoCreatedFromBankBackfill: true,
      createdAt: FV.serverTimestamp(),
      createdBy: 'system',
      updatedAt: FV.serverTimestamp(),
      updatedBy: 'system',
    };
    if (APPLY) await ref.set(doc);
    // Add ao cache pra deduplicação intra-script
    if (!destsByCountryCode.has(code)) destsByCountryCode.set(code, []);
    destsByCountryCode.get(code).push({ id: ref.id, city: doc.city, cityAliases: [] });
    return ref.id;
  }

  // 2. Itera roteiros
  const bankSnap = await db.collection('roteiros_bank').get();
  let processed = 0, skipped = 0, updated = 0, citiesAdded = 0, destsCreated = 0, destsReused = 0;
  const examples = [];

  for (const bdoc of bankSnap.docs) {
    processed++;
    const data = bdoc.data();
    const oldCities = data.geo?.cities || [];
    const oldDestIds = data.geo?.destinationIds || [];

    if (oldDestIds.length > 0 && oldDestIds.length >= oldCities.length) {
      skipped++; continue;
    }

    // Normaliza cada city + acumula novas atômicas
    const atomicCities = [];
    for (const c of oldCities) {
      if (!c.city) continue;
      const normalized = normalizeCityName(c.city);
      if (!normalized.length) continue;
      const country = c.country || (data.geo?.countries || [])[0] || '';
      for (let i = 0; i < normalized.length; i++) {
        const atomic = normalized[i];
        atomicCities.push({
          city: atomic,
          country,
          continent: c.continent || '',
          nights: (i === 0) ? (c.nights || 0) : 0,
          locationId: c.locationId || null,
          iata: c.iata || '',
          countryCode: countryCodeFromLabel(country),
          originalCity: c.city !== atomic ? c.city : (c.originalCity || null),
        });
      }
    }

    // Dedup atomic cities (mesma city+country)
    const seenKeys = new Set();
    const dedupedCities = [];
    for (const ac of atomicCities) {
      const k = `${normKey(ac.city)}|${normKey(ac.country)}`;
      if (seenKeys.has(k)) continue;
      seenKeys.add(k);
      dedupedCities.push(ac);
    }

    // Pra cada cidade dedup, vincula destinationId
    const destinationIds = [];
    for (const ac of dedupedCities) {
      if (!ac.country) continue;
      const existing = findDest(ac.country, ac.city);
      let destId;
      if (existing) {
        destId = existing.id;
        destsReused++;
      } else {
        destId = await createPendingDest(ac.country, ac.city);
        if (destId) destsCreated++;
      }
      if (destId && !destinationIds.includes(destId)) {
        destinationIds.push(destId);
      }
    }

    citiesAdded += Math.max(0, dedupedCities.length - oldCities.length);

    // Update doc (preserva resto)
    const update = {
      'geo.cities': dedupedCities,
      'geo.destinationIds': destinationIds,
      'geo.backfillDestIdsV462': FV.serverTimestamp(),
    };
    if (APPLY) await bdoc.ref.update(update);
    updated++;

    if (examples.length < 3) {
      examples.push({
        id: bdoc.id.slice(0,8),
        title: (data.title || '').slice(0, 50),
        oldCitiesCount: oldCities.length,
        newCitiesCount: dedupedCities.length,
        destIdsCount: destinationIds.length,
        sample: dedupedCities.slice(0, 4).map(c => `${c.city} (${c.countryCode||'?'})`),
      });
    }
  }

  console.log('\n═══ RESUMO ═══');
  console.log(`Roteiros processados: ${processed}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped (já tinha destIds): ${skipped}`);
  console.log(`Cidades atômicas extras (split de trechos): ${citiesAdded}`);
  console.log(`Destinations:`);
  console.log(`  Reused (já existia): ${destsReused}`);
  console.log(`  Created pending (novo banco-auto): ${destsCreated}`);

  console.log('\nExemplos:');
  for (const ex of examples) {
    console.log(`  ${ex.id} "${ex.title}":`);
    console.log(`    cities ${ex.oldCitiesCount} → ${ex.newCitiesCount} atômicas | destIds ${ex.destIdsCount}`);
    console.log(`    sample: ${ex.sample.join(' · ')}`);
  }

  console.log(APPLY ? '\n✓ APLICADO em produção.' : '\n✓ DRY-RUN OK. Rode com --apply.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
