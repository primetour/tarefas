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

/* ─── Sync: Top pages ─────────────────────────────────────── */
async function syncPages(propertyId) {
  console.log('  📄 Sync páginas...');

  const [response] = await analyticsClient.runReport({
    property: propertyId,
    dateRanges: [{ startDate: dateStr(SYNC_DAYS), endDate: 'today' }],
    dimensions: [
      { name: 'pageTitle' },
      { name: 'pagePath' },
    ],
    metrics: [
      { name: 'screenPageViews' },
      { name: 'activeUsers' },
      { name: 'averageSessionDuration' },
      { name: 'bounceRate' },
      { name: 'engagementRate' },
    ],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 200,
  });

  const propNum = propertyId.replace('properties/', '');
  const docs = (response.rows || []).map((row, i) => {
    const d = row.dimensionValues;
    const m = row.metricValues;
    const slug = (d[1].value || 'unknown').replace(/[^a-z0-9/\-]/gi, '_').slice(0, 80);
    return {
      id:                `${propNum}_page_${i}_${slug}`,
      propertyId:        propNum,
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

  const n = await batchWrite('ga_pages', docs);
  console.log(`    ✅ ${n} páginas sincronizadas`);
  return n;
}

/* ─── Sync: Sources / Medium ──────────────────────────────── */
async function syncSources(propertyId) {
  console.log('  🔗 Sync origens...');

  const [response] = await analyticsClient.runReport({
    property: propertyId,
    dateRanges: [{ startDate: dateStr(SYNC_DAYS), endDate: 'today' }],
    dimensions: [
      { name: 'sessionSource' },
      { name: 'sessionMedium' },
    ],
    metrics: [
      { name: 'sessions' },
      { name: 'activeUsers' },
      { name: 'newUsers' },
      { name: 'bounceRate' },
      { name: 'engagementRate' },
      { name: 'conversions' },
    ],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 100,
  });

  const propNum = propertyId.replace('properties/', '');
  const docs = (response.rows || []).map((row, i) => {
    const d = row.dimensionValues;
    const m = row.metricValues;
    return {
      id:             `${propNum}_src_${i}`,
      propertyId:     propNum,
      source:         d[0].value || '(direct)',
      medium:         d[1].value || '(none)',
      sessions:       parseInt(m[0].value) || 0,
      activeUsers:    parseInt(m[1].value) || 0,
      newUsers:       parseInt(m[2].value) || 0,
      bounceRate:     parseFloat(m[3].value) || 0,
      engagementRate: parseFloat(m[4].value) || 0,
      conversions:    parseInt(m[5].value) || 0,
      syncedAt:       admin.firestore.FieldValue.serverTimestamp(),
    };
  });

  const n = await batchWrite('ga_sources', docs);
  console.log(`    ✅ ${n} origens sincronizadas`);
  return n;
}

/* ─── Sync: Devices ───────────────────────────────────────── */
async function syncDevices(propertyId) {
  console.log('  📱 Sync dispositivos...');

  const [response] = await analyticsClient.runReport({
    property: propertyId,
    dateRanges: [{ startDate: dateStr(SYNC_DAYS), endDate: 'today' }],
    dimensions: [{ name: 'deviceCategory' }],
    metrics: [
      { name: 'sessions' },
      { name: 'activeUsers' },
      { name: 'bounceRate' },
      { name: 'averageSessionDuration' },
    ],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
  });

  const propNum = propertyId.replace('properties/', '');
  const docs = (response.rows || []).map(row => {
    const d = row.dimensionValues;
    const m = row.metricValues;
    return {
      id:                 `${propNum}_dev_${d[0].value}`,
      propertyId:         propNum,
      deviceCategory:     d[0].value || 'unknown',
      sessions:           parseInt(m[0].value) || 0,
      activeUsers:        parseInt(m[1].value) || 0,
      bounceRate:         parseFloat(m[2].value) || 0,
      avgSessionDuration: parseFloat(m[3].value) || 0,
      syncedAt:           admin.firestore.FieldValue.serverTimestamp(),
    };
  });

  const n = await batchWrite('ga_devices', docs);
  console.log(`    ✅ ${n} dispositivos sincronizados`);
  return n;
}

/* ─── Sync: Countries / Cities ────────────────────────────── */
async function syncCountries(propertyId) {
  console.log('  🌍 Sync países...');

  const [response] = await analyticsClient.runReport({
    property: propertyId,
    dateRanges: [{ startDate: dateStr(SYNC_DAYS), endDate: 'today' }],
    dimensions: [
      { name: 'country' },
      { name: 'city' },
    ],
    metrics: [
      { name: 'sessions' },
      { name: 'activeUsers' },
      { name: 'engagementRate' },
    ],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 100,
  });

  const propNum = propertyId.replace('properties/', '');
  const docs = (response.rows || []).map((row, i) => {
    const d = row.dimensionValues;
    const m = row.metricValues;
    return {
      id:              `${propNum}_geo_${i}`,
      propertyId:      propNum,
      country:         d[0].value || '(unknown)',
      city:            d[1].value || '(unknown)',
      sessions:        parseInt(m[0].value) || 0,
      activeUsers:     parseInt(m[1].value) || 0,
      engagementRate:  parseFloat(m[2].value) || 0,
      syncedAt:        admin.firestore.FieldValue.serverTimestamp(),
    };
  });

  const n = await batchWrite('ga_countries', docs);
  console.log(`    ✅ ${n} registros geográficos sincronizados`);
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
      const pages     = await syncPages(propId);
      const sources   = await syncSources(propId);
      const devices   = await syncDevices(propId);
      const countries = await syncCountries(propId);

      totalDocs += daily + pages + sources + devices + countries;
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
