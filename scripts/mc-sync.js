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
        <Properties>EmailID</Properties>
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
      EmailID:         get('EmailID'),
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

/* ─── REST Asset: HTML do email via legacyId ──────────────────
 * Cada Send referencia um EmailID (legacy id). No Content Builder,
 * o asset correspondente tem `data.email.legacyId` apontando pra esse
 * mesmo número. Usamos POST /asset/v1/content/assets/query pra batch
 * (filter $in cobre múltiplos IDs num round trip).
 */
async function fetchAssetsByLegacyIds(token, legacyIds) {
  if (!legacyIds || !legacyIds.length) return new Map();

  const url = `${MC_REST_URL}/asset/v1/content/assets/query`;
  const body = {
    page: { page: 1, pageSize: 200 },
    query: {
      leftOperand: {
        property: 'data.email.legacyId',
        simpleOperator: 'in',
        value: legacyIds.map(String),
      },
    },
    fields: ['id', 'name', 'description', 'views.html.content', 'data.email.legacyId'],
  };

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.warn(`  Asset query falhou: ${res.status} — ${txt.slice(0, 200)}`);
    return new Map();
  }

  const data = await res.json();
  const items = data.items || [];
  // Map legacyId -> { description, html, name, assetId }
  const out = new Map();
  for (const it of items) {
    const legacyId = String(it.data?.email?.legacyId || '');
    if (!legacyId) continue;
    out.set(legacyId, {
      assetId:     it.id,
      assetName:   it.name || '',
      description: (it.description || '').trim(),
      html:        it.views?.html?.content || '',
    });
  }
  return out;
}

/* ─── Strip HTML para texto plain ──────────────────────────── */
function stripHtml(html) {
  if (!html) return '';
  return String(html)
    // Remove comments
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Remove inline styles & scripts (com conteúdo)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    // Tags em geral
    .replace(/<[^>]+>/g, ' ')
    // Decode entidades comuns
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&[a-z0-9#]+;/gi, ' ')
    // Normaliza whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/* ─── Estatísticas estruturais do HTML (zero LLM) ─────────── */
function htmlStructuralStats(html) {
  if (!html) return { ctaCount: 0, imageCount: 0, wordCount: 0, charCount: 0 };
  const text = stripHtml(html);
  const ctaMatches = (html.match(/<a\s[^>]*href=/gi) || []).length;
  const imgMatches = (html.match(/<img\s/gi) || []).length;
  const words = text.split(/\s+/).filter(Boolean);
  return {
    ctaCount:  ctaMatches,
    imageCount: imgMatches,
    wordCount: words.length,
    charCount: text.length,
  };
}

/* ─── Hash SHA-256 — detecta mudança de conteúdo ─────────── */
function sha256(s) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(String(s || '')).digest('hex');
}

/* ─── Extração de entidades via Anthropic API ─────────────────
 * Usa Claude Haiku 3.5 (fast + barato). Prompt estruturado pede JSON
 * estrito com countries/cities/hotels/brands/etc. Falha gracefully se
 * key ausente, parse falhar ou rate-limit — sync continua sem enrich.
 */
async function extractEntitiesViaLLM(text, anthropicKey, retries = 1) {
  if (!anthropicKey) return null;
  if (!text || text.length < 50) return null;

  // Trunca pra 8000 chars (~2.5k tokens) — emails longos não ajudam mais
  const input = text.slice(0, 8000);

  const prompt = `Você é um extrator de entidades especializado em conteúdo de marketing turístico de luxo.

Analise o texto abaixo de uma newsletter e extraia em JSON ESTRITO (sem markdown, sem comentários):

{
  "countries": ["nome do país em português"],
  "cities":    ["cidades/regiões"],
  "hotels":    [{"name": "nome do hotel", "brand": "marca ou null", "category": "ultra-luxo|luxo|premium|null"}],
  "brands":    ["marcas hoteleiras citadas (Belmond, Aman, Four Seasons, etc.)"],
  "productTypes":   ["hotel|cruise|fam|roteiro|experiencia"],
  "themes":         ["luxo|romance|familia|aventura|gastronomia|wellness|cultura|praia|cidade|natureza"],
  "targetAudience": ["casais|familias|solo|grupo|50+|millennials"],
  "activities":     ["atividades específicas mencionadas"],
  "pricePoint":     "ultra-luxo|luxo|premium|null",
  "priceRange":     {"min": null, "max": null, "currency": "USD|BRL|EUR|null", "basis": "noite|pacote|null"},
  "travelSeason":   ["primavera|verao|outono|inverno|alta-temporada"],
  "sellingPoints":  ["argumentos de venda em frase curta"],
  "confidence":     "high|medium|low"
}

Regras:
- Se não conseguir identificar com certeza, deixe array vazio ou null. Não invente.
- Use nomes em português brasileiro quando óbvio (Maldivas, não Maldives).
- Categorias e enums devem ser EXATAMENTE como listados. Sem variações.
- Se o texto for curto/vazio, confidence: "low".
- Hotels: só inclua nomes específicos identificáveis, não "hotel da rede" genérico.

Texto:
"""${input}"""

JSON:`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'x-api-key':         anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:       'claude-haiku-4-5',
        max_tokens:  1500,
        temperature: 0,
        messages:    [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      if ((res.status === 429 || res.status >= 500) && retries > 0) {
        await new Promise(r => setTimeout(r, 2000));
        return extractEntitiesViaLLM(text, anthropicKey, retries - 1);
      }
      console.warn(`  LLM falhou: ${res.status} — ${txt.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const raw = data.content?.[0]?.text || '';
    // Tolerância: às vezes vem com ```json ... ``` mesmo com instrução
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const json = JSON.parse(cleaned);
    return json;
  } catch (e) {
    console.warn(`  LLM parse falhou: ${e.message}`);
    return null;
  }
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
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
  const ENRICH_DISABLED   = process.env.ENRICH_DISABLED === '1';
  const enrichEnabled     = !!ANTHROPIC_API_KEY && !ENRICH_DISABLED;

  console.log(`\n🔄 PRIMETOUR — Marketing Cloud Sync`);
  console.log(`   Período: últimos ${SYNC_DAYS} dias`);
  console.log(`   Enriquecimento IA: ${enrichEnabled ? '✓ ATIVO (Claude Haiku)' : '✗ desativado (sem ANTHROPIC_API_KEY)'}\n`);

  const summary = { success: [], failed: [], total: 0, enriched: 0, cacheHits: 0, llmCalls: 0 };

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

      // ── Enriquecimento: batch fetch HTML + extração LLM ───────
      // 1. Coleta legacyIds únicos dos sends
      // 2. Fetch batch de assets via REST asset query
      // 3. Pra cada asset: hash do HTML → checa Firestore se já tem
      //    extracted com mesmo hash → cache hit (skip). Senão chama LLM.
      // 4. Mapa: legacyId -> {description, extracted, htmlHash}
      const legacyIds = [...new Set(sends.map(s => s.EmailID).filter(Boolean))];
      const assetMap  = await fetchAssetsByLegacyIds(token, legacyIds);
      console.log(`   ${assetMap.size} assets recuperados (de ${legacyIds.length} legacyIds únicos)`);

      // Pré-busca docs existentes pra cache lookup
      const existingDocs = new Map(); // legacyId -> existing.htmlHash
      if (enrichEnabled && assetMap.size) {
        // Buscar todos os docs dessa BU que tenham as legacyIds — pra checar htmlHash
        // Firestore in() limita 30 — quebra em chunks
        const chunks = [];
        for (let i = 0; i < legacyIds.length; i += 30) chunks.push(legacyIds.slice(i, i + 30));
        for (const chunk of chunks) {
          const snap = await db.collection('mc_performance')
            .where('buId', '==', bu.id)
            .where('emailLegacyId', 'in', chunk)
            .get();
          snap.docs.forEach(d => {
            const data = d.data();
            if (data.emailLegacyId) existingDocs.set(String(data.emailLegacyId), data.htmlHash || null);
          });
        }
      }

      // Enriquece assets (htmlHash + extracted via LLM)
      const enrichmentMap = new Map(); // legacyId -> { description, htmlHash, extracted, structural }
      if (assetMap.size) {
        // Concorrência limitada (4 paralelas) pra não sobrecarregar Anthropic
        const entries = [...assetMap.entries()];
        const CONCURRENCY = 4;

        for (let i = 0; i < entries.length; i += CONCURRENCY) {
          const slice = entries.slice(i, i + CONCURRENCY);
          await Promise.all(slice.map(async ([legacyId, asset]) => {
            const htmlHash = sha256(asset.html);
            const structural = htmlStructuralStats(asset.html);
            const cachedHash = existingDocs.get(legacyId);

            // Cache hit: já tem extracted com mesmo hash → não re-chama LLM
            if (cachedHash && cachedHash === htmlHash) {
              summary.cacheHits++;
              enrichmentMap.set(legacyId, {
                description: asset.description,
                htmlHash,
                structural,
                extracted: null, // mantém o existente no Firestore via merge
              });
              return;
            }

            // Sem cache: extrai via LLM (se ativo)
            let extracted = null;
            if (enrichEnabled && asset.html) {
              const text = stripHtml(asset.html);
              extracted = await extractEntitiesViaLLM(text, ANTHROPIC_API_KEY);
              if (extracted) {
                summary.llmCalls++;
                summary.enriched++;
              }
            }

            enrichmentMap.set(legacyId, {
              description: asset.description,
              htmlHash,
              structural,
              extracted,
            });
          }));
        }
      }

      let batch = db.batch(), batchSize = 0, written = 0;

      for (const send of sends) {
        const doc   = buildDoc(send, bu);
        const docId = `${bu.id}_${send.ID}`;

        // Anexa enrichment se disponível
        const enrich = send.EmailID ? enrichmentMap.get(send.EmailID) : null;
        if (enrich) {
          doc.emailLegacyId = send.EmailID;
          if (enrich.description) doc.description = enrich.description;
          if (enrich.htmlHash)    doc.htmlHash    = enrich.htmlHash;
          if (enrich.structural)  doc.htmlStats   = enrich.structural;
          if (enrich.extracted) {
            doc.extracted = {
              ...enrich.extracted,
              extractedAt: admin.firestore.FieldValue.serverTimestamp(),
              extractedBy: 'claude-haiku-4-5',
            };
          }
        }

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
  if (enrichEnabled) {
    console.log(`🤖 Enriquecimento IA: ${summary.enriched} novos · ${summary.cacheHits} cache hits · ${summary.llmCalls} chamadas LLM`);
  }
}

main().catch(e => { console.error('Erro fatal:', e); process.exit(1); });
