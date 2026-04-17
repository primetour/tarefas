/**
 * PRIMETOUR — GA Firestore Cleanup (one-shot)
 *
 * Remove docs no formato antigo (IDs com posição numérica) das coleções
 * ga_pages, ga_sources, ga_countries. Estes docs acumulam histórico de cron
 * runs antigos e distorcem a contagem exibida no frontend (mais docs em
 * períodos curtos do que longos).
 *
 * Formato antigo: `${propNum}_${period}_page_${i}_${slug}`  (i = posição)
 * Formato novo:   `${propNum}_${period}_page_${slug}`        (estável)
 *
 * Também remove docs sem campo `period` (órfãos de versões pré-período).
 *
 * Execução: script dedicado — NÃO roda junto com ga-sync.js para evitar
 * concorrência na quota diária de escrita do Firestore.
 *
 *   node scripts/ga-cleanup.js
 *   — ou via GitHub Actions (workflow_dispatch: ga-cleanup.yml)
 *
 * Respeita DRY_RUN=true pra só listar sem deletar.
 */

const admin = require('firebase-admin');

function fixPem(raw) {
  if (!raw) return '';
  let key = raw.replace(/\\n/g, '\n');
  if (!key.includes('\n-----END')) {
    key = key
      .replace('-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\n')
      .replace('-----END PRIVATE KEY-----', '\n-----END PRIVATE KEY-----\n');
  }
  return key;
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  fixPem(process.env.FIREBASE_PRIVATE_KEY),
  }),
});
const db = admin.firestore();

const DRY_RUN       = String(process.env.DRY_RUN || '').toLowerCase() === 'true';
const GA_PROPERTY_ID = process.env.GA_PROPERTY_ID || '';
const BATCH_SIZE     = 400;   // margem abaixo do limite 500 do Firestore
const BATCH_DELAY_MS = 300;   // respira entre batches pra suavizar rate limit

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Limpa docs legados de uma coleção.
 *
 * @param {string} collectionName
 * @param {string} propertyId      número puro, sem "properties/"
 * @param {RegExp} legacyRegex     identifica IDs no formato antigo
 */
async function cleanupLegacy(collectionName, propertyId, legacyRegex) {
  console.log(`\n── ${collectionName} (propertyId=${propertyId}) ──`);

  const snap = await db.collection(collectionName)
    .where('propertyId', '==', propertyId)
    .get();
  console.log(`  total lido: ${snap.size}`);

  const toDelete = snap.docs.filter(d => {
    const id = d.id;
    const data = d.data();
    return legacyRegex.test(id) || !data.period;
  });

  console.log(`  a remover: ${toDelete.length} (formato antigo ou sem period)`);
  if (!toDelete.length) return 0;

  if (DRY_RUN) {
    console.log(`  [DRY_RUN] amostra:`, toDelete.slice(0, 3).map(d => d.id));
    return 0;
  }

  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = toDelete.slice(i, i + BATCH_SIZE);
    chunk.forEach(d => batch.delete(d.ref));
    try {
      await batch.commit();
      deleted += chunk.length;
      process.stdout.write(`  🧹 batch ${Math.floor(i/BATCH_SIZE)+1}: ${chunk.length} deletados (total ${deleted}/${toDelete.length})\n`);
    } catch(e) {
      console.warn(`  ⚠ batch falhou (${e.code || ''} ${e.message}) — interrompendo; rode de novo mais tarde`);
      break;
    }
    await sleep(BATCH_DELAY_MS);
  }
  return deleted;
}

(async () => {
  console.log('═══════════════════════════════════════════════');
  console.log('  PRIMETOUR — GA Firestore Cleanup');
  console.log('  ' + new Date().toISOString());
  if (DRY_RUN) console.log('  (DRY_RUN = true, nada será deletado)');
  console.log('═══════════════════════════════════════════════');

  if (!GA_PROPERTY_ID) {
    console.error('❌ GA_PROPERTY_ID não definido');
    process.exit(1);
  }
  const propNum = GA_PROPERTY_ID.replace('properties/', '');

  let grandTotal = 0;
  try {
    grandTotal += await cleanupLegacy('ga_pages',     propNum, /_page_\d+(_|$)/);
  } catch(e) { console.error(`❌ ga_pages: ${e.message}`); }
  try {
    grandTotal += await cleanupLegacy('ga_sources',   propNum, /_src_\d+(_|$)/);
  } catch(e) { console.error(`❌ ga_sources: ${e.message}`); }
  try {
    grandTotal += await cleanupLegacy('ga_countries', propNum, /_geo_\d+(_|$)/);
  } catch(e) { console.error(`❌ ga_countries: ${e.message}`); }

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  ✅ Cleanup concluído: ${grandTotal} docs removidos`);
  console.log('═══════════════════════════════════════════════');
  process.exit(0);
})();
