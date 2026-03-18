/**
 * PRIMETOUR — Marketing Cloud → Firestore Sync
 * Roda via GitHub Actions (gratuito), sem Firebase Functions.
 * Deploy: commit para primetour/tarefas, roda diariamente às 6h UTC.
 *
 * Secrets necessários no GitHub:
 *   MC_CLIENT_ID, MC_CLIENT_SECRET, MC_AUTH_URL, MC_REST_URL
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 */

const { default: fetch } = require('node-fetch');
const admin = require('firebase-admin');

/* ─── Init Firebase ───────────────────────────────────────── */
admin.initializeApp({
  credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
});
const db = admin.firestore();

/* ─── Configuração ────────────────────────────────────────── */
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

/* ─── OAuth: token por BU ─────────────────────────────────── */
async function getToken(mid) {
  const res = await fetch(`${MC_AUTH_URL}/v2/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      grant_type:    'client_credentials',
      client_id:     MC_CLIENT_ID,
      client_secret: MC_CLIENT_SECRET,
      account_id:    Number(mid),
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Auth falhou (MID ${mid}): ${res.status} — ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.access_token;
}

/* ─── Buscar sends via SOAP (única abordagem que funciona) ─── */
async function fetchSends(token, days) {
  const from    = new Date();
  from.setDate(from.getDate() - days);
  const fromStr = from.toISOString().slice(0, 10);

  const soapBase = MC_AUTH_URL
    .replace(/\/v2\/token\/?$/, '')
    .replace(/\/$/, '')
    .replace('.auth.marketingcloudapis.com', '.soap.marketingcloudapis.com');
  const soapUrl = `${soapBase}/Service.asmx`;

  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing">
  <s:Header>
    <fueloauth xmlns="http://exacttarget.com">${token}</fueloauth>
  </s:Header>
  <s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <RetrieveRequestMsg xmlns="http://exacttarget.com/wsdl/partnerAPI">
      <RetrieveRequest>
        <ObjectType>Send</ObjectType>
        <Properties>ID</Properties>
        <Properties>EmailName</Properties>
        <Properties>Subject</Properties>
        <Properties>SentDate</Properties>
        <Properties>NumberSent</Properties>
        <Properties>NumberDelivered</Properties>
        <Properties>HardBounces</Properties>
        <Properties>SoftBounces</Properties>
        <Properties>OtherBounces</Properties>
        <Properties>UniqueOpens</Properties>
        <Properties>UniqueClicks</Properties>
        <Properties>Unsubscribes</Properties>
        <Filter xsi:type="SimpleFilterPart">
          <Property>SentDate</Property>
          <SimpleOperator>greaterThan</SimpleOperator>
          <DateValue>${fromStr}T00:00:00</DateValue>
        </Filter>
      </RetrieveRequest>
    </RetrieveRequestMsg>
  </s:Body>
</s:Envelope>`;

  const res = await fetch(soapUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'text/xml', 'SOAPAction': 'Retrieve' },
    body:    soapBody,
  });

  if (!res.ok) {
    console.warn(`  SOAP falhou: ${res.status}`);
    return [];
  }

  const xml    = await res.text();
  const status = xml.match(/<OverallStatus>(.*?)<\/OverallStatus>/)?.[1] || '';

  if (!status.startsWith('OK')) {
    console.warn(`  SOAP status: ${status}`);
    return [];
  }

  const blocks = xml.match(/<Results[^>]*>([\s\S]*?)<\/Results>/g) || [];
  const sends  = [];

  for (const block of blocks) {
    const get = tag => {
      const m = block.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i'));
      return m ? m[1].trim() : null;
    };
    const id = get('ID');
    if (id) sends.push({
      ID:              id,
      EmailName:       get('EmailName'),
      Subject:         get('Subject'),
      SentDate:        get('SentDate'),
      NumberSent:      get('NumberSent'),
      NumberDelivered: get('NumberDelivered'),
      HardBounces:     get('HardBounces'),
      SoftBounces:     get('SoftBounces'),
      OtherBounces:    get('OtherBounces'),
      UniqueOpens:     get('UniqueOpens'),
      UniqueClicks:    get('UniqueClicks'),
      Unsubscribes:    get('Unsubscribes'),
    });
  }

  return sends;
}

/* ─── Normalizar send → doc Firestore ────────────────────── */
function buildDoc(send, bu) {
  const n   = v => Number(v) || 0;
  const pct = (a, b) => b > 0 ? Math.round((a / b) * 10000) / 100 : 0;

  const totalSent   = n(send.NumberSent);
  const delivered   = n(send.NumberDelivered);
  const openUnique  = n(send.UniqueOpens);
  const clickUnique = n(send.UniqueClicks);

  const sentDateRaw = send.SentDate;
  const sentDate    = sentDateRaw
    ? admin.firestore.Timestamp.fromDate(new Date(sentDateRaw))
    : null;

  // Clean trailing whitespace from EmailName and Subject (MC pads to fixed width)
  const name    = (send.EmailName || '').trim();
  const subject = (send.Subject   || '').trim();

  return {
    buId:             bu.id,
    buName:           bu.name,
    buMid:            bu.mid,
    jobId:            String(send.ID),
    name,
    subject,
    sentDate,
    totalSent,
    delivered,
    deliveryRate:     pct(delivered, totalSent),
    hardBounce:       n(send.HardBounces),
    softBounce:       n(send.SoftBounces),
    blockBounce:      n(send.OtherBounces),
    openTotal:        openUnique,   // MC só retorna únicos no objeto Send
    openUnique,
    openRate:         pct(openUnique, delivered),
    clickTotal:       clickUnique,  // MC só retorna únicos no objeto Send
    clickUnique,
    clickRate:        pct(clickUnique, delivered),
    conversionTotal:  0,            // não disponível no objeto Send
    conversionUnique: 0,
    optOut:           n(send.Unsubscribes),
    syncedAt:         admin.firestore.FieldValue.serverTimestamp(),
  };
}

/* ─── Main ────────────────────────────────────────────────── */
async function main() {
  console.log(`\n🔄 PRIMETOUR — Marketing Cloud Sync`);
  console.log(`   Período: últimos ${SYNC_DAYS} dias\n`);

  const summary = { success: [], failed: [], total: 0 };

  for (const bu of BUSINESS_UNITS) {
    console.log(`📧 ${bu.name}`);
    try {
      const token = await getToken(bu.mid);
      const sends = await fetchSends(token, SYNC_DAYS);
      console.log(`   ${sends.length} sends encontrados`);

      if (!sends.length) {
        summary.success.push(`${bu.name} (0)`);
        continue;
      }

      let batch = db.batch(), batchSize = 0, written = 0;

      for (const send of sends) {
        const doc   = buildDoc(send, bu);
        const docId = `${bu.id}_${send.ID}`;
        batch.set(db.collection('mc_performance').doc(docId), doc, { merge: true });
        batchSize++;
        written++;
        if (batchSize >= 499) {
          await batch.commit();
          batch = db.batch(); batchSize = 0;
        }
      }
      if (batchSize > 0) await batch.commit();

      console.log(`   ✓ ${written} docs salvos`);
      summary.success.push(`${bu.name} (${written})`);
      summary.total += written;
    } catch(e) {
      console.error(`   ✗ ERRO: ${e.message}`);
      summary.failed.push({ bu: bu.name, error: e.message });
    }
  }

  console.log('\n─────────────────────────────────────────');
  console.log(`✅ ${summary.success.join(' · ')}`);
  if (summary.failed.length) {
    console.log(`❌ ${summary.failed.map(f => `${f.bu}: ${f.error}`).join(', ')}`);
    if (summary.failed.length === BUSINESS_UNITS.length) process.exit(1);
  }
  console.log(`📊 Total: ${summary.total} documentos`);
}

main().catch(e => { console.error('Erro fatal:', e); process.exit(1); });
