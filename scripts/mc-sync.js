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

/* ─── Buscar sends via REST e SOAP ───────────────────────── */
async function fetchSends(token, days) {
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fromStr = from.toISOString().slice(0, 10);
  console.log(`  Buscando sends desde: ${fromStr}`);

  // Tenta REST endpoints conhecidos do MC
  const restEndpoints = [
    `${MC_REST_URL}/data/v1/emailanalytics/v1/sends?startDate=${fromStr}&$pageSize=200`,
    `${MC_REST_URL}/data/v1/sends?$pageSize=200`,
    `${MC_REST_URL}/email/v1/messageDefinitionSends?$pageSize=200`,
    `${MC_REST_URL}/messaging/v1/email/definitions/?$pageSize=200`,
  ];

  for (const url of restEndpoints) {
    console.log(`  Tentando REST: ${url}`);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    console.log(`  Status: ${res.status}`);

    if (res.ok) {
      const data = await res.json();
      console.log(`  Chaves: ${JSON.stringify(Object.keys(data))}`);
      const items = data.items || data.Results || data.sends || (Array.isArray(data) ? data : []);
      console.log(`  Items: ${items.length}`);
      if (items.length > 0) {
        console.log(`  item[0]: ${JSON.stringify(items[0]).slice(0, 400)}`);
        return filterByDate(items, fromStr);
      }
    }
  }

  // Fallback SOAP — sempre disponível, busca Send objects
  console.log(`  Tentando SOAP...`);
  return fetchSendsSoap(token, fromStr);
}

/* ─── SOAP fallback ───────────────────────────────────────── */
async function fetchSendsSoap(token, fromStr) {
  // MC SOAP endpoint é na auth URL trocando /v2/token por /Service.asmx
  // MC SOAP URL usa subdomínio .soap. em vez de .auth.
  // auth: https://XXXX.auth.marketingcloudapis.com
  // soap: https://XXXX.soap.marketingcloudapis.com/Service.asmx
  const soapBase = MC_AUTH_URL
    .replace(/\/v2\/token\/?$/, '')
    .replace(/\/$/, '')
    .replace('.auth.marketingcloudapis.com', '.soap.marketingcloudapis.com');
  const soapUrl = `${soapBase}/Service.asmx`;
  console.log(`  SOAP URL: ${soapUrl}`);

  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:u="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
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
        <Properties>NumberOpens</Properties>
        <Properties>UniqueClicks</Properties>
        <Properties>NumberClicks</Properties>
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
    headers: {
      'Content-Type': 'text/xml',
      'SOAPAction':   'Retrieve',
    },
    body: soapBody,
  });

  console.log(`  SOAP status: ${res.status}`);

  if (!res.ok) {
    const txt = await res.text();
    console.warn(`  SOAP falhou: ${txt.slice(0, 300)}`);
    return [];
  }

  const xml = await res.text();
  // Log XML completo para diagnóstico
  console.log(`  SOAP XML completo:\n${xml}`);

  // Parse XML — Results pode ter namespace prefix (PartnerAPI:Results, etc)
  // e atributos xsi:type
  const results = [];
  const blocks = xml.match(/<(?:\w+:)?Results[^>]*>([\s\S]*?)<\/(?:\w+:)?Results>/g) || [];
  console.log(`  SOAP blocos Results: ${blocks.length}`);

  for (const block of blocks) {
    // Handles both <Tag> and <ns:Tag> formats
    const get = tag => {
      const m = block.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i'));
      return m ? m[1].trim() : null;
    };
    const send = {
      ID:               get('ID'),
      EmailName:        get('EmailName'),
      Subject:          get('Subject'),
      SentDate:         get('SentDate'),
      NumberSent:       get('NumberSent'),
      NumberDelivered:  get('NumberDelivered'),
      HardBounces:      get('HardBounces'),
      SoftBounces:      get('SoftBounces'),
      OtherBounces:     get('OtherBounces'),
      NumberOpens:      get('NumberOpens'),
      UniqueOpens:      get('UniqueOpens'),
      NumberClicks:     get('NumberClicks'),
      UniqueClicks:     get('UniqueClicks'),
      Unsubscribes:     get('Unsubscribes'),
    };
    if (send.ID) results.push(send);
  }

  console.log(`  SOAP sends parseados: ${results.length}`);
  if (results.length > 0) console.log(`  Exemplo: ${JSON.stringify(results[0])}`);
  return results;
}

/* ─── Filtra por data ─────────────────────────────────────── */
function filterByDate(items, fromStr) {
  const cutoff = new Date(fromStr);
  return items.filter(s => {
    const raw = s.SendDate || s.SentDate || s.sentDate || s.CreatedDate || s.createTime || null;
    if (!raw) return true;
    return new Date(raw) >= cutoff;
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

  const totalSent   = get('TotalSent',    'NumberSent',    'Sent',            'totalSent');
  const delivered   = get('TotalDelivered','NumberDelivered','Delivered',     'totalDelivered');
  const hardBounce  = get('HardBounces',  'hardBounces',   'HardBounce');
  const softBounce  = get('SoftBounces',  'softBounces',   'SoftBounce');
  const blockBounce = get('BlockBounces', 'OtherBounces',  'blockBounces',    'BlockBounce');
  const openTotal   = get('NumberOpens',  'Opens',         'opens',           'TotalOpens');
  const openUnique  = get('UniqueOpens',  'uniqueOpens',   'UniqueOpen');
  const clickTotal  = get('NumberClicks', 'Clicks',        'clicks',          'TotalClicks');
  const clickUnique = get('UniqueClicks', 'uniqueClicks',  'UniqueClick');
  // Conversions não disponíveis no objeto Send — zerado (disponível em outros endpoints)
  const convTotal   = get('Conversions',  'conversions',   'TotalConversions') || 0;
  const convUnique  = get('UniqueConversions', 'uniqueConversions')             || 0;
  const optOut      = get('Unsubscribes', 'NumberUnsubscribed', 'unsubscribes', 'OptOut', 'optOut');

  const pct = (n, d) => d > 0 ? Math.round((n / d) * 10000) / 100 : 0;

  const sentDateRaw = send.SentDate || send.SendDate || send.sentDate || send.CreatedDate || send.createTime;
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
