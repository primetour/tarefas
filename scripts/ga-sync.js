/**
 * PRIMETOUR — Google Analytics 4 -> Firestore Sync
 * Uses GA4 Data API (google-analytics-data) via Service Account
 *
 * Syncs:
 *   ga_daily      → métricas diárias agregadas
 *   ga_pages      → top páginas por views
 *   ga_sources    → origem/mídia de tráfego
 *   ga_devices    → distribuição por dispositivo
 *   ga_countries  → distribuição geográfica
 *   ga_properties → propriedades configuradas
 *   ga_meta       → metadados do último sync
 *
 * Env vars necessárias:
 *   GA_PROPERTY_ID        → ex: "properties/123456789"
 *   GA_CLIENT_EMAIL       → service account email
 *   GA_PRIVATE_KEY        → service account private key (PEM)
 *   FIREBASE_PROJECT_ID   → projeto Firebase
 *   FIREBASE_CLIENT_EMAIL → service account Firebase
 *   FIREBASE_PRIVATE_KEY  → private key Firebase
 *   SYNC_DAYS             → dias para sincronizar (default: 90)
 *
 * Execução:
 *   node scripts/ga-sync.js
 *   — ou via GitHub Actions (ver .github/workflows/ga-sync.yml)
 */

const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const admin = require('firebase-admin');

/* ─── Fix PEM key formatting ─────────────────────────────── */
function fixPem(raw) {
  if (!raw) return '';
  // Replace literal \n with real newlines
  let key = raw.replace(/\\n/g, '\n');
  // If it still has no real newlines between header/footer, fix it
  if (!key.includes('\n-----END')) {
    key = key
      .replace('-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\n')
      .replace('-----END PRIVATE KEY-----', '\n-----END PRIVATE KEY-----\n');
  }
  return key;
}

/* ─── Firebase init ──────────────────────────────────────── */
admin.initializeApp({
  credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  fixPem(process.env.FIREBASE_PRIVATE_KEY),
  }),
});
const db = admin.firestore();

/* ─── GA4 init ───────────────────────────────────────────── */
const GA_PROPERTY_ID = process.env.GA_PROPERTY_ID || '';
const SYNC_DAYS      = parseInt(process.env.SYNC_DAYS) || 90;

const analyticsClient = new BetaAnalyticsDataClient({
  credentials: {
    client_email: process.env.GA_CLIENT_EMAIL,
    private_key:  fixPem(process.env.GA_PRIVATE_KEY),
  },
});

/* ─── Helpers ─────────────────────────────────────────────── */
function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function toFirestoreDate(yyyymmdd) {
  // GA returns dates as "20260101" format
  const y = yyyymmdd.slice(0, 4);
  const m = yyyymmdd.slice(4, 6);
  const d = yyyymmdd.slice(6, 8);
  return admin.firestore.Timestamp.fromDate(new Date(`${y}-${m}-${d}T00:00:00Z`));
}

async function batchWrite(collectionName, docs) {
  const BATCH_SIZE = 450;
  let total = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + BATCH_SIZE);
    for (const { id, ...data } of chunk) {
      const ref = db.collection(collectionName).doc(id);
      batch.set(ref, data, { merge: true });
    }
    await batch.commit();
    total += chunk.length;
  }
  return total;
}

/**
 * Remove docs órfãos: docs do mesmo propertyId+period que NÃO foram atualizados
 * nesta rodada (IDs fora do validIds). Cobre dois cenários:
 *  - IDs legados (formato antigo com posição: `_page_${i}_${slug}`)
 *  - Páginas/origens/países que saíram do top no período corrente
 * Lê só por propertyId (sem composite index) e filtra period client-side.
 */
async function cleanupStale(collectionName, propertyId, period, validIds) {
  const snap = await db.collection(collectionName)
    .where('propertyId', '==', propertyId)
    .get();
  const toDelete = snap.docs.filter(d => d.data().period === period && !validIds.has(d.id));
  if (!toDelete.length) return 0;
  for (let i = 0; i < toDelete.length; i += 450) {
    const batch = db.batch();
    toDelete.slice(i, i + 450).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  return toDelete.length;
}

/**
 * Purga docs legados (formato antigo baseado em posição) independente do sync da API.
 * Precisa rodar MESMO quando a quota do GA está esgotada — caso contrário o lixo
 * continua acumulando e deturpa o frontend (períodos curtos com mais URLs que longos).
 *
 * - ga_pages:     IDs tipo `_page_${digito}_${slug}` → novo usa `_page_${slug}`
 * - ga_sources:   IDs tipo `_src_${digito}_${slug}`  → novo usa `_src_${slug}`
 * - ga_countries: IDs tipo `_geo_${digito}_${slug}`  → novo usa `_geo_${slug}`
 *
 * Também remove docs sem o campo `period` (órfãos de versões antigas).
 */
async function cleanupLegacy(collectionName, propertyId, legacyRegex) {
  const snap = await db.collection(collectionName)
    .where('propertyId', '==', propertyId)
    .get();
  const toDelete = snap.docs.filter(d => {
    const id = d.id;
    const data = d.data();
    return legacyRegex.test(id) || !data.period;
  });
  if (!toDelete.length) return 0;
  for (let i = 0; i < toDelete.length; i += 450) {
    const batch = db.batch();
    toDelete.slice(i, i + 450).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  return toDelete.length;
}

/* ─── Sync: Daily metrics ─────────────────────────────────── */
async function syncDaily(propertyId) {
  console.log('  📊 Sync diário...');

  const [response] = await analyticsClient.runReport({
    property: propertyId,
    dateRanges: [{ startDate: dateStr(SYNC_DAYS), endDate: 'today' }],
    dimensions: [{ name: 'date' }],
    metrics: [
      { name: 'activeUsers' },
      { name: 'newUsers' },
      { name: 'sessions' },
      { name: 'screenPageViews' },
      { name: 'bounceRate' },
      { name: 'averageSessionDuration' },
      { name: 'engagedSessions' },
      { name: 'engagementRate' },
      { name: 'eventCount' },
      { name: 'conversions' },
    ],
    orderBys: [{ dimension: { dimensionName: 'date' }, desc: true }],
  });

  const propNum = propertyId.replace('properties/', '');
  const docs = (response.rows || []).map(row => {
    const dateVal = row.dimensionValues[0].value;
    const m = row.metricValues;
    return {
      id:                  `${propNum}_${dateVal}`,
      propertyId:          propNum,
      date:                toFirestoreDate(dateVal),
      activeUsers:         parseInt(m[0].value) || 0,
      newUsers:            parseInt(m[1].value) || 0,
      sessions:            parseInt(m[2].value) || 0,
      screenPageViews:     parseInt(m[3].value) || 0,
      bounceRate:          parseFloat(m[4].value) || 0,
      avgSessionDuration:  parseFloat(m[5].value) || 0,
      engagedSessions:     parseInt(m[6].value) || 0,
      engagementRate:      parseFloat(m[7].value) || 0,
      eventsCount:         parseInt(m[8].value) || 0,
      conversions:         parseInt(m[9].value) || 0,
      syncedAt:            admin.firestore.FieldValue.serverTimestamp(),
    };
  });

  const n = await batchWrite('ga_daily', docs);
  console.log(`    ✅ ${n} dias sincronizados`);
  return n;
}

/* ─── Periods for breakdown syncs ─────────────────────────── */
const BREAKDOWN_PERIODS = [
  { days: 7,   key: '7d'  },
  { days: 14,  key: '14d' },
  { days: 28,  key: '28d' },
  { days: 30,  key: '30d' },
  { days: 90,  key: '90d' },
  { days: 365, key: '365d'},
];

/* ─── Sync: Top pages ─────────────────────────────────────── */
async function syncPages(propertyId) {
  console.log('  📄 Sync páginas...');
  const propNum = propertyId.replace('properties/', '');
  let total = 0;

  for (const p of BREAKDOWN_PERIODS) {
    try {
      const [response] = await analyticsClient.runReport({
        property: propertyId,
        dateRanges: [{ startDate: dateStr(p.days), endDate: 'today' }],
        dimensions: [{ name: 'pageTitle' }, { name: 'pagePath' }],
        metrics: [
          { name: 'screenPageViews' }, { name: 'activeUsers' },
          { name: 'averageSessionDuration' }, { name: 'bounceRate' }, { name: 'engagementRate' },
        ],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 1000,
      });

      const docs = (response.rows || []).map((row) => {
        const d = row.dimensionValues, m = row.metricValues;
        // Slug estável baseado no pagePath (sem posição). Normaliza / pra __ pra
        // não quebrar Firestore IDs, limita a 200 chars. Mesma URL → mesmo doc.
        const raw = (d[1].value || 'unknown').toLowerCase()
          .split('?')[0].split('#')[0].replace(/\/+$/, '');
        const slug = raw.replace(/\//g, '__').replace(/[^a-z0-9_\-]/g, '_').slice(0, 200) || 'root';
        return {
          id:                `${propNum}_${p.key}_page_${slug}`,
          propertyId:        propNum,
          period:            p.key,
          pageTitle:         d[0].value || '(sem título)',
          pagePath:          d[1].value || '/',
          screenPageViews:   parseInt(m[0].value) || 0,
          activeUsers:       parseInt(m[1].value) || 0,
          avgSessionDuration:parseFloat(m[2].value) || 0,
          bounceRate:        parseFloat(m[3].value) || 0,
          engagementRate:    parseFloat(m[4].value) || 0,
          syncedAt:          admin.firestore.FieldValue.serverTimestamp(),
        };
      });
      total += await batchWrite('ga_pages', docs);
      // Remove docs órfãos (IDs legados com posição, ou URLs que saíram do top)
      const validIds = new Set(docs.map(x => x.id));
      const cleaned = await cleanupStale('ga_pages', propNum, p.key, validIds);
      if (cleaned) console.log(`    🧹 ${cleaned} páginas órfãs removidas (${p.key})`);
    } catch(e) { console.warn(`    ⚠ Páginas ${p.key}: ${e.message}`); }
  }
  console.log(`    ✅ ${total} páginas sincronizadas`);
  return total;
}

/* ─── Sync: Sources / Medium ──────────────────────────────── */
async function syncSources(propertyId) {
  console.log('  🔗 Sync origens...');
  const propNum = propertyId.replace('properties/', '');
  let total = 0;

  for (const p of BREAKDOWN_PERIODS) {
    try {
      const [response] = await analyticsClient.runReport({
        property: propertyId,
        dateRanges: [{ startDate: dateStr(p.days), endDate: 'today' }],
        dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
        metrics: [
          { name: 'sessions' }, { name: 'activeUsers' }, { name: 'newUsers' },
          { name: 'bounceRate' }, { name: 'engagementRate' }, { name: 'conversions' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 200,
      });

      const docs = (response.rows || []).map((row) => {
        const d = row.dimensionValues, m = row.metricValues;
        const source = d[0].value || '(direct)';
        const medium = d[1].value || '(none)';
        // Slug estável (sem posição) a partir de source+medium
        const slug = `${source}_${medium}`.toLowerCase()
          .replace(/[^a-z0-9_\-]/g, '_').slice(0, 180) || 'unknown';
        return {
          id:             `${propNum}_${p.key}_src_${slug}`,
          propertyId:     propNum,
          period:         p.key,
          source,
          medium,
          sessions:       parseInt(m[0].value) || 0,
          activeUsers:    parseInt(m[1].value) || 0,
          newUsers:       parseInt(m[2].value) || 0,
          bounceRate:     parseFloat(m[3].value) || 0,
          engagementRate: parseFloat(m[4].value) || 0,
          conversions:    parseInt(m[5].value) || 0,
          syncedAt:       admin.firestore.FieldValue.serverTimestamp(),
        };
      });
      total += await batchWrite('ga_sources', docs);
      const validIds = new Set(docs.map(x => x.id));
      const cleaned = await cleanupStale('ga_sources', propNum, p.key, validIds);
      if (cleaned) console.log(`    🧹 ${cleaned} origens órfãs removidas (${p.key})`);
    } catch(e) { console.warn(`    ⚠ Origens ${p.key}: ${e.message}`); }
  }
  console.log(`    ✅ ${total} origens sincronizadas`);
  return total;
}

/* ─── Sync: Devices ───────────────────────────────────────── */
async function syncDevices(propertyId) {
  console.log('  📱 Sync dispositivos...');
  const propNum = propertyId.replace('properties/', '');
  let total = 0;

  for (const p of BREAKDOWN_PERIODS) {
    try {
      const [response] = await analyticsClient.runReport({
        property: propertyId,
        dateRanges: [{ startDate: dateStr(p.days), endDate: 'today' }],
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [
          { name: 'sessions' }, { name: 'activeUsers' },
          { name: 'bounceRate' }, { name: 'averageSessionDuration' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      });

      const docs = (response.rows || []).map(row => {
        const d = row.dimensionValues, m = row.metricValues;
        return {
          id:                 `${propNum}_${p.key}_dev_${d[0].value}`,
          propertyId:         propNum,
          period:             p.key,
          deviceCategory:     d[0].value || 'unknown',
          sessions:           parseInt(m[0].value) || 0,
          activeUsers:        parseInt(m[1].value) || 0,
          bounceRate:         parseFloat(m[2].value) || 0,
          avgSessionDuration: parseFloat(m[3].value) || 0,
          syncedAt:           admin.firestore.FieldValue.serverTimestamp(),
        };
      });
      total += await batchWrite('ga_devices', docs);
    } catch(e) { console.warn(`    ⚠ Dispositivos ${p.key}: ${e.message}`); }
  }
  console.log(`    ✅ ${total} dispositivos sincronizados`);
  return total;
}

/* ─── Sync: Countries / Cities ────────────────────────────── */
async function syncCountries(propertyId) {
  console.log('  🌍 Sync países...');
  const propNum = propertyId.replace('properties/', '');
  let total = 0;

  for (const p of BREAKDOWN_PERIODS) {
    try {
      const [response] = await analyticsClient.runReport({
        property: propertyId,
        dateRanges: [{ startDate: dateStr(p.days), endDate: 'today' }],
        dimensions: [{ name: 'country' }, { name: 'city' }],
        metrics: [
          { name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagementRate' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 300,
      });

      const docs = (response.rows || []).map((row) => {
        const d = row.dimensionValues, m = row.metricValues;
        const country = d[0].value || '(unknown)';
        const city    = d[1].value || '(unknown)';
        const slug = `${country}_${city}`.toLowerCase()
          .replace(/[^a-z0-9_\-]/g, '_').slice(0, 180) || 'unknown';
        return {
          id:              `${propNum}_${p.key}_geo_${slug}`,
          propertyId:      propNum,
          period:          p.key,
          country,
          city,
          sessions:        parseInt(m[0].value) || 0,
          activeUsers:     parseInt(m[1].value) || 0,
          engagementRate:  parseFloat(m[2].value) || 0,
          syncedAt:        admin.firestore.FieldValue.serverTimestamp(),
        };
      });
      total += await batchWrite('ga_countries', docs);
      const validIds = new Set(docs.map(x => x.id));
      const cleaned = await cleanupStale('ga_countries', propNum, p.key, validIds);
      if (cleaned) console.log(`    🧹 ${cleaned} países órfãos removidos (${p.key})`);
    } catch(e) { console.warn(`    ⚠ Países ${p.key}: ${e.message}`); }
  }
  console.log(`    ✅ ${total} registros geográficos sincronizados`);
  return total;
}

/* ─── Sync: Period totals (deduplicated) ──────────────────── */
async function syncTotals(propertyId) {
  console.log('  📈 Sync totais do período...');

  // Query sem dimensão = GA retorna totais agregados/deduplicados
  const periods = [
    { days: 7,   key: '7d'  },
    { days: 14,  key: '14d' },
    { days: 28,  key: '28d' },
    { days: 30,  key: '30d' },
    { days: 90,  key: '90d' },
    { days: 365, key: '365d'},
  ];

  const propNum = propertyId.replace('properties/', '');
  const docs = [];

  for (const p of periods) {
    try {
      const range = [{ startDate: dateStr(p.days), endDate: 'today' }];

      // Batch 1: 8 metrics
      const [r1] = await analyticsClient.runReport({
        property: propertyId,
        dateRanges: range,
        metrics: [
          { name: 'activeUsers' },
          { name: 'newUsers' },
          { name: 'totalUsers' },
          { name: 'sessions' },
          { name: 'screenPageViews' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
          { name: 'engagedSessions' },
        ],
      });

      // Batch 2: 5 metrics
      const [r2] = await analyticsClient.runReport({
        property: propertyId,
        dateRanges: range,
        metrics: [
          { name: 'engagementRate' },
          { name: 'eventCount' },
          { name: 'conversions' },
          { name: 'sessionsPerUser' },
          { name: 'screenPageViewsPerSession' },
        ],
      });

      const m1 = r1.rows?.[0]?.metricValues;
      const m2 = r2.rows?.[0]?.metricValues;
      if (m1 && m2) {
        docs.push({
          id:                       `${propNum}_totals_${p.key}`,
          propertyId:               propNum,
          period:                   p.key,
          days:                     p.days,
          activeUsers:              parseInt(m1[0].value) || 0,
          newUsers:                 parseInt(m1[1].value) || 0,
          totalUsers:               parseInt(m1[2].value) || 0,
          sessions:                 parseInt(m1[3].value) || 0,
          screenPageViews:          parseInt(m1[4].value) || 0,
          bounceRate:               parseFloat(m1[5].value) || 0,
          avgSessionDuration:       parseFloat(m1[6].value) || 0,
          engagedSessions:          parseInt(m1[7].value) || 0,
          engagementRate:           parseFloat(m2[0].value) || 0,
          eventsCount:              parseInt(m2[1].value) || 0,
          conversions:              parseInt(m2[2].value) || 0,
          sessionsPerUser:          parseFloat(m2[3].value) || 0,
          pageViewsPerSession:      parseFloat(m2[4].value) || 0,
          syncedAt:                 admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    } catch(e) {
      console.warn(`    ⚠ Erro totais ${p.key}: ${e.message}`);
    }
  }

  const n = await batchWrite('ga_totals', docs);
  console.log(`    ✅ ${n} períodos sincronizados`);
  return n;
}

/* ─── Main ────────────────────────────────────────────────── */
async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  PRIMETOUR — GA4 Sync');
  console.log('  ' + new Date().toISOString());
  console.log('═══════════════════════════════════════════════');

  if (!GA_PROPERTY_ID) {
    console.error('❌ GA_PROPERTY_ID não configurada.');
    process.exit(1);
  }

  const propertyIds = GA_PROPERTY_ID.split(',').map(s => s.trim()).filter(Boolean);
  console.log(`📋 ${propertyIds.length} propriedade(s): ${propertyIds.join(', ')}`);
  console.log(`📅 Período: últimos ${SYNC_DAYS} dias\n`);

  let totalDocs = 0;

  for (const propertyId of propertyIds) {
    const propId = propertyId.startsWith('properties/')
      ? propertyId
      : `properties/${propertyId}`;
    const propNum = propId.replace('properties/', '');

    console.log(`\n── Propriedade: ${propId} ──`);

    try {
      // Register property in Firestore
      await db.collection('ga_properties').doc(propNum).set({
        propertyId: propNum,
        label: `GA4 ${propNum}`,
        lastSync: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      const daily     = await syncDaily(propId);
      const totals    = await syncTotals(propId);
      const pages     = await syncPages(propId);
      const sources   = await syncSources(propId);
      const devices   = await syncDevices(propId);
      const countries = await syncCountries(propId);

      totalDocs += daily + totals + pages + sources + devices + countries;
    } catch (e) {
      console.error(`  ❌ Erro na propriedade ${propId}: ${e.message}`);
    }
  }

  // Update sync metadata
  await db.collection('ga_meta').doc('lastSync').set({
    syncedAt:    admin.firestore.FieldValue.serverTimestamp(),
    properties:  propertyIds,
    totalDocs,
    syncDays:    SYNC_DAYS,
  });

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`  ✅ Sync concluído: ${totalDocs} docs gravados`);
  console.log('═══════════════════════════════════════════════');
}

main().catch(e => {
  console.error('❌ Fatal:', e.message);
  process.exit(1);
});
