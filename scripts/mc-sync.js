/**
 * PRIMETOUR — Marketing Cloud → Firestore Sync
 * Roda via GitHub Actions (gratuito), sem Firebase Functions.
 *
 * Variáveis de ambiente necessárias (GitHub Secrets):
 *   MC_CLIENT_ID, MC_CLIENT_SECRET, MC_AUTH_URL, MC_REST_URL
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 */

const { default: fetch } = require('node-fetch');
const admin = require('firebase-admin');

/* ─── Init Firebase Admin ─────────────────────────────────── */
admin.initializeApp({
  credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    // GitHub Secrets escapam \n como string literal — precisamos restaurar
    privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
});

const db = admin.firestore();

/* ─── Configuração Marketing Cloud ───────────────────────── */
const MC_AUTH_URL      = process.env.MC_AUTH_URL      || 'https://mcdr998fk605k8c51p7t-gc781ly.auth.marketingcloudapis.com';
const MC_REST_URL      = process.env.MC_REST_URL      || 'https://mcdr998fk605k8c51p7t-gc781ly.rest.marketingcloudapis.com';
const MC_CLIENT_ID     = process.env.MC_CLIENT_ID     || '';
const MC_CLIENT_SECRET = process.env.MC_CLIENT_SECRET || '';
const SYNC_DAYS        = parseInt(process.env.SYNC_DAYS) || 90;

const BUSINESS_UNITS = [
  { id: 'primetour',     name: 'Primetour',     mid: '546014130' },
  { id: 'btg-partners',  name: 'BTG Partners',  mid: '546015816' },
  { id: 'btg-ultrablue', name: 'BTG Ultrablue', mid: '546015815' },
  { id: 'centurion',     name: 'Centurion',     mid: '546015818' },
  { id: 'pts',           name: 'PTS',           mid: '546015817' },
];

/* ─── OAuth ──────────────────────────────────────────────── */
async function getToken(mid) {
  const body = {
    grant_type:    'client_credentials',
    client_id:     MC_CLIENT_ID,
    client_secret: MC_CLIENT_SECRET,
  };
  if (mid) body.account_id = Number(mid);

  const res = await fetch(`${MC_AUTH_URL}/v2/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Auth falhou (MID ${mid}): ${res.status} — ${txt.slice(0, 300)}`);
  }

  const data = await res.json();
  console.log(`  Token obtido para MID ${mid} (expira em ${data.expires_in}s)`);
  return data.access_token;
}

/* ─── Buscar sends ───────────────────────────────────────── */
async function fetchSends(token, days) {
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fromStr = from.toISOString().slice(0, 10);

  // Tenta endpoint primário
  let url = `${MC_REST_URL}/messaging/v1/email/messages/?$pageSize=200&$page=1`;
  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (!res.ok) {
    // Fallback: endpoint analítico
    url = `${MC_REST_URL}/data/v1/sends?$pageSize=200`;
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }

  if (!res.ok) {
    console.warn(`  fetchSends falhou: ${res.status}`);
    return [];
  }

  const data = await res.json();
  const items = data.items || data.Results || data || [];

  // Filtrar por data
  const cutoff = new Date(fromStr);
  return items.filter(s => {
    const d = new Date(s.SendDate || s.sentDate || s.CreatedDate || s.createTime || 0);
    return d >= cutoff;
  });
}

/* ─── Buscar métricas de um send ──────────────────────────── */
async function fetchMetrics(token, jobId) {
  const res = await fetch(`${MC_REST_URL}/data/v1/sends/${jobId}/metrics`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

/* ─── Normalizar → doc Firestore ──────────────────────────── */
function buildDoc(send, metrics, bu) {
  const m   = metrics || {};
  const get = (...keys) => {
    for (const k of keys) {
      const v = m[k] ?? send[k];
      if (v !== undefined && v !== null) return Number(v) || 0;
    }
    return 0;
  };

  const totalSent   = get('TotalSent',    'Sent',          'totalSent');
  const delivered   = get('TotalDelivered','Delivered',    'totalDelivered');
  const hardBounce  = get('HardBounces',  'hardBounces',   'HardBounce');
  const softBounce  = get('SoftBounces',  'softBounces',   'SoftBounce');
  const blockBounce = get('BlockBounces', 'blockBounces',  'BlockBounce');
  const openTotal   = get('Opens',        'opens',         'TotalOpens');
  const openUnique  = get('UniqueOpens',  'uniqueOpens',   'UniqueOpen');
  const clickTotal  = get('Clicks',       'clicks',        'TotalClicks');
  const clickUnique = get('UniqueClicks', 'uniqueClicks',  'UniqueClick');
  const convTotal   = get('Conversions',  'conversions',   'TotalConversions');
  const convUnique  = get('UniqueConversions', 'uniqueConversions');
  const optOut      = get('Unsubscribes', 'unsubscribes',  'OptOut', 'optOut');

  const pct = (n, d) => d > 0 ? Math.round((n / d) * 10000) / 100 : 0;

  const sentDateRaw = send.SendDate || send.sentDate || send.CreatedDate || send.createTime;
  const sentDate    = sentDateRaw ? admin.firestore.Timestamp.fromDate(new Date(sentDateRaw)) : null;

  return {
    buId:             bu.id,
    buName:           bu.name,
    buMid:            bu.mid,
    jobId:            String(send.ID || send.JobID || send.jobId || send.id || ''),
    name:             send.EmailName || send.emailName || send.Name || send.name || '',
    subject:          send.Subject   || send.subject   || '',
    sentDate,
    totalSent,
    delivered,
    deliveryRate:     pct(delivered, totalSent),
    hardBounce,
    softBounce,
    blockBounce,
    openTotal,
    openUnique,
    openRate:         pct(openUnique, delivered),
    clickTotal,
    clickUnique,
    clickRate:        pct(clickUnique, delivered),
    conversionTotal:  convTotal,
    conversionUnique: convUnique,
    optOut,
    syncedAt:         admin.firestore.FieldValue.serverTimestamp(),
  };
}

/* ─── Main ────────────────────────────────────────────────── */
async function main() {
  console.log(`\n🔄 PRIMETOUR — Marketing Cloud Sync`);
  console.log(`   Período: últimos ${SYNC_DAYS} dias`);
  console.log(`   BUs: ${BUSINESS_UNITS.length}\n`);

  const summary = { success: [], failed: [], total: 0 };

  for (const bu of BUSINESS_UNITS) {
    console.log(`\n📧 ${bu.name} (MID: ${bu.mid})`);

    try {
      const token = await getToken(bu.mid);
      const sends = await fetchSends(token, SYNC_DAYS);
      console.log(`  ${sends.length} sends encontrados`);

      if (!sends.length) {
        summary.success.push(`${bu.name} (0 sends)`);
        continue;
      }

      // Firestore batch (máx 500 ops por batch)
      let batch     = db.batch();
      let batchSize = 0;
      let written   = 0;

      for (const send of sends) {
        const jobId = String(send.ID || send.JobID || send.jobId || send.id || '');
        if (!jobId) continue;

        const metrics = await fetchMetrics(token, jobId).catch(() => null);
        const doc     = buildDoc(send, metrics, bu);
        const docId   = `${bu.id}_${jobId}`;

        batch.set(db.collection('mc_performance').doc(docId), doc, { merge: true });
        batchSize++;
        written++;

        if (batchSize >= 499) {
          await batch.commit();
          batch     = db.batch();
          batchSize = 0;
          console.log(`  Batch commitado (${written} docs)`);
        }
      }

      if (batchSize > 0) await batch.commit();

      console.log(`  ✓ ${written} documentos salvos`);
      summary.success.push(`${bu.name} (${written})`);
      summary.total += written;

    } catch (e) {
      console.error(`  ✗ ERRO: ${e.message}`);
      summary.failed.push({ bu: bu.name, error: e.message });
    }
  }

  console.log('\n─────────────────────────────────────────');
  console.log(`✅ Sucesso: ${summary.success.join(', ')}`);
  if (summary.failed.length) {
    console.log(`❌ Falhou:  ${summary.failed.map(f => `${f.bu} (${f.error})`).join(', ')}`);
  }
  console.log(`📊 Total docs escritos: ${summary.total}`);
  console.log('─────────────────────────────────────────\n');

  if (summary.failed.length === BUSINESS_UNITS.length) {
    // Todas falharam — sair com erro para o GitHub Actions reportar
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
