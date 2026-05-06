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
        <Properties>Email.ID</Properties>
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
    // Email vem aninhado: <Email><ID>37396</ID></Email>
    // Extrai o ID de dentro do bloco <Email>
    const emailBlock = block.match(/<(?:\w+:)?Email[^>]*>([\s\S]*?)<\/(?:\w+:)?Email>/i)?.[1] || '';
    const emailIdMatch = emailBlock.match(/<(?:\w+:)?ID[^>]*>([\s\S]*?)<\/(?:\w+:)?ID>/i);
    const emailId = emailIdMatch ? emailIdMatch[1].trim() : null;

    if (id) sends.push({
      ID:              id,
      EmailID:         emailId,
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
/**
 * Busca assets do tipo email por NOME (mais robusto que por ID legacy).
 * SFMC tem 3 IDs distintos pra emails (asset.id, legacyData.legacyId, Email
 * SOAP ID) que NÃO batem entre si. O nome é o único campo que cruza confiável
 * entre o objeto Send (EmailName) e o Asset (name).
 *
 * Recebe array de nomes únicos, retorna Map<name, {description, html, ...}>.
 */
async function fetchAssetsByNames(token, names) {
  if (!names || !names.length) return new Map();

  const out = new Map();
  // SFMC asset query "in" com strings com chars especiais é flaky.
  // Estratégia: 1 query por batch de até 50 nomes via "in".
  const CHUNK = 50;
  for (let i = 0; i < names.length; i += CHUNK) {
    const slice = names.slice(i, i + CHUNK);
    const url = `${MC_REST_URL}/asset/v1/content/assets/query`;
    const body = {
      page: { page: 1, pageSize: 200 },
      query: {
        leftOperand:  { property: 'assetType.name', simpleOperator: 'equals', value: 'htmlemail' },
        logicalOperator: 'AND',
        rightOperand: { property: 'name', simpleOperator: 'in', value: slice },
      },
    };
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.warn(`  Asset query (by name) falhou: ${res.status} — ${txt.slice(0, 200)}`);
      continue;
    }
    const data = await res.json();
    for (const it of (data.items || [])) {
      const name = (it.name || '').trim();
      if (!name) continue;
      const html = it.views?.html?.content || it.content || it.views?.text?.content || '';
      // Se há múltiplos assets com mesmo nome, mantém o mais recente
      const existing = out.get(name);
      if (existing) {
        const newDate = new Date(it.modifiedDate || 0).getTime();
        const oldDate = new Date(existing.modifiedDate || 0).getTime();
        if (newDate <= oldDate) continue;
      }
      out.set(name, {
        assetId:     it.id,
        assetName:   name,
        description: (it.description || '').trim(),
        html,
        modifiedDate: it.modifiedDate,
      });
    }
  }
  return out;
}

/** @deprecated — kept for reference. Use fetchAssetsByNames instead.
 *  Tentativa original era buscar por data.email.legacyId, mas SFMC tem 3 IDs
 *  distintos pra emails (asset.id, legacyData.legacyId, Email SOAP ID) que NÃO
 *  batem entre si. Match por nome resolve. Função kept here só pro caso de
 *  alguém futuro precisar testar essa rota.
 */
async function _OLD_fetchAssetsByLegacyIds(token, legacyIds) {
  if (!legacyIds || !legacyIds.length) return new Map();

  // ── DEBUG TEMPORÁRIO (remove após descobrir property path correta) ──
  if (process.env.DEBUG_SFMC === '1' && legacyIds.length > 0) {
    console.log(`  [DEBUG] legacyIds buscados:`, legacyIds.slice(0, 3));
    // Pega 1 asset qualquer pra ver schema
    const debugBody = {
      page: { page: 1, pageSize: 1 },
      query: { property: 'assetType.name', simpleOperator: 'equals', value: 'htmlemail' },
    };
    const debugRes = await fetch(`${MC_REST_URL}/asset/v1/content/assets/query`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(debugBody),
    });
    // Tenta buscar Email object via SOAP (ID 37336 do Send é Email Object ID antigo)
    const soapBase = MC_AUTH_URL.replace(/\/v2\/token\/?$/, '').replace(/\/$/, '')
      .replace('.auth.marketingcloudapis.com', '.soap.marketingcloudapis.com');
    const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing">
  <s:Header><fueloauth xmlns="http://exacttarget.com">${token}</fueloauth></s:Header>
  <s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <RetrieveRequestMsg xmlns="http://exacttarget.com/wsdl/partnerAPI">
      <RetrieveRequest>
        <ObjectType>Email</ObjectType>
        <Properties>ID</Properties>
        <Properties>Name</Properties>
        <Properties>Subject</Properties>
        <Properties>HTMLBody</Properties>
        <Properties>CustomerKey</Properties>
        <Filter xsi:type="SimpleFilterPart">
          <Property>ID</Property>
          <SimpleOperator>equals</SimpleOperator>
          <Value>${legacyIds[0]}</Value>
        </Filter>
      </RetrieveRequest>
    </RetrieveRequestMsg>
  </s:Body>
</s:Envelope>`;
    const soapRes = await fetch(`${soapBase}/Service.asmx`, {
      method:  'POST',
      headers: { 'Content-Type': 'text/xml', 'SOAPAction': 'Retrieve' },
      body:    soapBody,
    });
    const xml = await soapRes.text();
    const status = xml.match(/<OverallStatus>(.*?)<\/OverallStatus>/)?.[1] || '';
    console.log(`  [DEBUG SOAP Email by ID=${legacyIds[0]}] status: ${status}`);
    if (status.startsWith('OK')) {
      const name = xml.match(/<Name[^>]*>([\s\S]*?)<\/Name>/i)?.[1] || '';
      const ck = xml.match(/<CustomerKey[^>]*>([\s\S]*?)<\/CustomerKey>/i)?.[1] || '';
      const htmlLen = (xml.match(/<HTMLBody[^>]*>([\s\S]*?)<\/HTMLBody>/i)?.[1] || '').length;
      console.log(`  [DEBUG] SOAP Email Name=${name.slice(0,40)} CustomerKey=${ck} HTMLBody len=${htmlLen}`);
    } else {
      console.log(`  [DEBUG] SOAP Email body snippet:`, xml.slice(0, 400));
    }
  }

  const url = `${MC_REST_URL}/asset/v1/content/assets/query`;
  // Sintaxe correta SFMC: query top-level tem property + simpleOperator + value
  // (não usa leftOperand como SQLLike). 'fields' rejeita dot-notation, então
  // omitimos pra pegar payload completo.
  const body = {
    page: { page: 1, pageSize: 200 },
    query: {
      property: 'data.email.legacyId',
      simpleOperator: 'in',
      value: legacyIds.map(String),
    },
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
  // Em alguns assets o HTML está em views.html.content; em outros, em
  // content (texto direto). Tenta ambos.
  const out = new Map();
  for (const it of items) {
    const legacyId = String(it.data?.email?.legacyId || '');
    if (!legacyId) continue;
    const html = it.views?.html?.content
              || it.content
              || it.views?.text?.content
              || '';
    out.set(legacyId, {
      assetId:     it.id,
      assetName:   it.name || '',
      description: (it.description || '').trim(),
      html,
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

/* ─── Extrai URLs de imagens do HTML cru com filtros ──────────
 * Newsletters PRIMETOUR têm o conteúdo principal em IMAGENS (banners
 * de hotéis, cards de destinos), não em texto. Pra analisar via Vision,
 * extraímos URLs filtrando: tracking pixels (1×1), logos pequenos,
 * spacers. Pega top N imagens "de conteúdo" (maiores).
 *
 * Retorna array de { url, alt, width, height, score } ordenado por score desc.
 */
function extractContentImages(html, topN = 5) {
  if (!html) return [];
  const imgs = [];
  const re = /<img\s+([^>]*?)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const url = (attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    if (!url) continue;
    // Pula data: URIs e javascript:
    if (/^(data:|javascript:)/i.test(url)) continue;
    // Pula tracking pixels conhecidos (analytics, mailing trackers)
    if (/\.gif(\?|$)/i.test(url) && /(open|track|pixel|beacon|t\.gif|spacer)/i.test(url)) continue;

    const alt = ((attrs.match(/\balt\s*=\s*["']([^"']*)["']/i) || [])[1] || '').trim();
    const width  = parseInt((attrs.match(/\bwidth\s*=\s*["']?(\d+)/i)  || [])[1], 10) || 0;
    const height = parseInt((attrs.match(/\bheight\s*=\s*["']?(\d+)/i) || [])[1], 10) || 0;

    // Filtros de tamanho:
    // 1×1 ou 1×N = tracking pixel
    if ((width === 1 && height >= 0) || (height === 1 && width >= 0)) continue;
    // Spacer (<10px qualquer dimensão)
    if (width > 0 && width < 10) continue;
    if (height > 0 && height < 10) continue;
    // Logos típicos: <200×<100
    if (width > 0 && width < 200 && height > 0 && height < 100) continue;

    // Score: imagens maiores + com alt text descritivo
    const area = (width || 400) * (height || 300);
    const altScore = alt.length > 20 ? 1.5 : (alt.length > 5 ? 1.2 : 1.0);
    const score = area * altScore;

    imgs.push({ url, alt, width, height, score });
  }
  // Dedup por URL
  const seen = new Set();
  const dedup = imgs.filter(i => { if (seen.has(i.url)) return false; seen.add(i.url); return true; });
  // Ordena por score desc, pega topN
  return dedup.sort((a, b) => b.score - a.score).slice(0, topN);
}

/* ─── Download de imagem + base64 (pra Vision API) ─────────── */
async function fetchImageAsBase64(url) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'PRIMETOUR-Sync/1.0' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//i.test(ct)) return null;
    // Limita 5MB pra não engasgar
    const buf = await res.buffer();
    if (buf.length > 5 * 1024 * 1024) return null;
    return { mimeType: ct.split(';')[0], data: buf.toString('base64') };
  } catch (_) {
    return null;
  }
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

/* ─── IA Hub: agente registrado + chave global ────────────────
 * Em vez de hardcodar provider/model/prompt, lemos tudo de:
 *   - ai_agents/{slug}: configuração do agente (provider, model, systemPrompt, limits)
 *   - system_config/main: chave de API global (groqApiKey, anthropicApiKey, etc.)
 *
 * Permite trocar modelo/prompt via UI da IA Hub sem mexer em código.
 * Usa Firestore Admin SDK (já inicializado) — sem auth user.
 */
const AGENT_SLUG = 'newsletter-content-extractor';

async function loadAgentConfig(slug) {
  // Procura por slug; agent doc id é random, busca via field 'slug'
  const snap = await db.collection('ai_agents').where('slug', '==', slug).limit(1).get();
  if (snap.empty) {
    // Fallback: tenta achar por id literal
    const byId = await db.collection('ai_agents').doc(slug).get();
    if (byId.exists) return { id: byId.id, ...byId.data() };
    return null;
  }
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

async function logAgentUsage({ agentId, provider, model, source, tokensIn, tokensOut, success, error, ms }) {
  try {
    await db.collection('ai_usage_logs').add({
      agentId, provider, model, source,
      tokensIn:  tokensIn  || 0,
      tokensOut: tokensOut || 0,
      success:   success !== false,
      error:     error || null,
      durationMs: ms || 0,
      ts: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) { /* logging falha não trava sync */ }
}

async function resolveGlobalApiKey(provider) {
  // system_config/ai-config (mesmo CONFIG_DOC_ID usado por js/services/ai.js)
  // Schema: { groqApiKey, anthropicApiKey, openaiApiKey, geminiApiKey }
  const snap = await db.collection('system_config').doc('ai-config').get();
  if (!snap.exists) return '';
  const cfg = snap.data();
  return cfg[`${provider}ApiKey`] || '';
}

/* ─── Gemini Vision multimodal: imagens + texto numa só call ──
 * Newsletters PRIMETOUR têm conteúdo em imagens. Gemini 2.5 Flash
 * suporta multi-image (até dezenas) numa request. Cada imagem ~258
 * tokens. Gratuito em volume baixo.
 *
 * @param {Array<{mimeType,data}>} images — base64 + mime das imgs
 * @returns {{text, tokensIn, tokensOut}}
 */
async function callGeminiVision(model, apiKey, systemPrompt, userPrompt, images, maxTokens, temperature) {
  const parts = [{ text: userPrompt }];
  for (const img of images) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
      },
    }),
  });
  if (!res.ok) throw new Error(`gemini-vision ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
    tokensIn:  data.usageMetadata?.promptTokenCount || 0,
    tokensOut: data.usageMetadata?.candidatesTokenCount || 0,
  };
}

/* ─── Extração — multi-provider, dirigido pelo agente ───────── */
async function callProvider(provider, model, apiKey, systemPrompt, userPrompt, maxTokens, temperature) {
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: maxTokens, temperature,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return {
      text: data.content?.[0]?.text || '',
      tokensIn: data.usage?.input_tokens || 0,
      tokensOut: data.usage?.output_tokens || 0,
    };
  }

  if (provider === 'groq') {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: maxTokens, temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return {
      text: data.choices?.[0]?.message?.content || '',
      tokensIn: data.usage?.prompt_tokens || 0,
      tokensOut: data.usage?.completion_tokens || 0,
    };
  }

  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: maxTokens, temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return {
      text: data.choices?.[0]?.message?.content || '',
      tokensIn: data.usage?.prompt_tokens || 0,
      tokensOut: data.usage?.completion_tokens || 0,
    };
  }

  if (provider === 'gemini') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          responseMimeType: 'application/json',
        },
      }),
    });
    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return {
      text: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
      tokensIn: data.usageMetadata?.promptTokenCount || 0,
      tokensOut: data.usageMetadata?.candidatesTokenCount || 0,
    };
  }

  throw new Error(`provider nao suportado: ${provider}`);
}

/* ─── Cache de extração por URL de imagem ─────────────────────
 * Imagens reaparecem em campanhas (logo Belmond, foto de hotel popular).
 * Cache por sha256(url) na collection mc_image_extractions evita re-call
 * Vision na mesma imagem. Estrutura: { url, mimeType, extracted, ts }.
 */
async function fetchImageExtractionCache(urls) {
  if (!urls || !urls.length) return new Map();
  const out = new Map();
  const ids = urls.map(u => sha256(u));
  // Firestore in() limit 30
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    const reads = await Promise.all(
      chunk.map(id => db.collection('mc_image_extractions').doc(id).get())
    );
    reads.forEach((r, j) => {
      if (r.exists) out.set(urls[i + j], r.data());
    });
  }
  return out;
}

async function saveImageExtractionCache(url, extracted) {
  const id = sha256(url);
  await db.collection('mc_image_extractions').doc(id).set({
    url,
    extracted,
    ts: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

/**
 * Extrai entidades usando o agente registrado na IA Hub.
 *
 * Estratégia VISION-FIRST (4.8.0+):
 *   - Newsletters PRIMETOUR têm conteúdo principalmente em IMAGENS
 *   - Se provider do agente é 'gemini' AND temos URLs de imagens:
 *     baixa top 5 imagens → manda multimodal pro Gemini Vision
 *   - Senão (texto only): usa apenas subject + name + alt + texto stripped
 *
 * @param {Object} input — { text, html, subject, name, alts }
 * @param {Object} agent — config do agente
 * @returns {{ json, provider, model }} ou null
 */
async function extractEntitiesViaAgent(input, agent, retries = 3) {
  if (!agent) return null;

  const provider = agent.provider || 'gemini';
  const model    = agent.model    || 'gemini-2.5-flash';
  const sysPrompt = agent.systemPrompt || '';
  const maxTok   = agent.limits?.maxTokensPerRun || 2000;
  const temp     = agent.limits?.temperature ?? 0;

  const apiKey = await resolveGlobalApiKey(provider);
  if (!apiKey) {
    console.warn(`  Agent "${agent.name||agent.slug}": sem chave para provider ${provider}`);
    return null;
  }

  const { text = '', html = '', subject = '', name = '' } = (input || {});

  // Monta contexto textual (usado em todos os providers)
  const textContext = [
    name    ? `NOME: ${name}` : '',
    subject ? `SUBJECT: ${subject}` : '',
    text    ? `TEXTO HTML (rodapé/disclaimer): ${text.slice(0, 2000)}` : '',
  ].filter(Boolean).join('\n\n');

  let userPrompt = `Analise a newsletter de viagens da PRIMETOUR e extraia entidades em JSON estrito.\n\n${textContext}`;
  let images = [];
  let imagesUsed = [];
  let cacheHitsImg = 0;

  // VISION FLOW: baixa top imagens, chama Gemini multimodal
  if (provider === 'gemini' && html) {
    const candidates = extractContentImages(html, 5);
    if (candidates.length > 0) {
      const urls = candidates.map(c => c.url);
      const cache = await fetchImageExtractionCache(urls);
      // Cache: imagens já analisadas → usa extracted cacheado, sem re-baixar
      const cachedExtractions = [];
      const toFetch = [];
      for (const c of candidates) {
        const cached = cache.get(c.url);
        if (cached?.extracted) {
          cachedExtractions.push({ url: c.url, alt: c.alt, extracted: cached.extracted });
          cacheHitsImg++;
        } else {
          toFetch.push(c);
        }
      }
      // Download em paralelo (até 5 imgs)
      const downloads = await Promise.all(toFetch.map(c => fetchImageAsBase64(c.url)));
      images = downloads.filter(Boolean);
      imagesUsed = toFetch.map((c, i) => downloads[i] ? c.url : null).filter(Boolean);

      // Adiciona cache resumido ao prompt (aproveita análises antigas)
      if (cachedExtractions.length > 0) {
        userPrompt += `\n\nIMAGENS JÁ ANALISADAS (cache):\n` +
          cachedExtractions.map(c => `- ${c.alt || 'imagem'}: ${JSON.stringify(c.extracted).slice(0, 300)}`).join('\n');
      }

      // Adiciona alts ao prompt
      const altsText = candidates.filter(c => c.alt).map(c => `- ${c.alt}`).join('\n');
      if (altsText) userPrompt += `\n\nALT-TEXTS DAS IMAGENS:\n${altsText}`;
    }
  }

  userPrompt += `\n\nRetorne APENAS JSON conforme schema do system prompt. Sem markdown.`;

  const t0 = Date.now();
  try {
    let r;
    if (provider === 'gemini' && images.length > 0) {
      r = await callGeminiVision(model, apiKey, sysPrompt, userPrompt, images, maxTok, temp);
    } else {
      r = await callProvider(provider, model, apiKey, sysPrompt, userPrompt, maxTok, temp);
    }
    const cleaned = r.text.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const json = JSON.parse(cleaned);

    // Salva cache de cada imagem analisada (best-effort: usa o JSON inteiro;
    // distribuição precisa por imagem requeria prompt diferente — por ora,
    // cacheia o JSON consolidado por URL).
    for (const url of imagesUsed) {
      try { await saveImageExtractionCache(url, json); } catch (_) {}
    }

    await logAgentUsage({
      agentId: agent.id, provider, model, source: 'mc-sync',
      tokensIn: r.tokensIn, tokensOut: r.tokensOut,
      success: true, ms: Date.now() - t0,
      meta: { imagesUsed: imagesUsed.length, cacheHitsImg, hasVision: images.length > 0 },
    });
    return { json, provider, model, imagesUsed: imagesUsed.length, cacheHitsImg };
  } catch (e) {
    if (retries > 0 && /429|5\d\d/.test(e.message)) {
      const waitMatch = e.message.match(/try again in ([\d.]+)s/i);
      const waitMs = waitMatch ? Math.ceil(parseFloat(waitMatch[1]) * 1000) + 500 : 5000;
      console.log(`    rate limit hit, esperando ${waitMs}ms antes de retry...`);
      await new Promise(r => setTimeout(r, waitMs));
      return extractEntitiesViaAgent(input, agent, retries - 1);
    }
    console.warn(`  Agent extract falhou: ${e.message}`);
    await logAgentUsage({
      agentId: agent.id, provider, model, source: 'mc-sync',
      success: false, error: e.message, ms: Date.now() - t0,
    });
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
  const ENRICH_DISABLED = process.env.ENRICH_DISABLED === '1';

  console.log(`\n🔄 PRIMETOUR — Marketing Cloud Sync`);
  console.log(`   Período: últimos ${SYNC_DAYS} dias`);

  // Carrega agente da IA Hub (se existir + estiver ativo) e checa se tem
  // chave do provider configurada. Caso contrário, sync continua sem enrich.
  let agent = null;
  let enrichEnabled = false;
  if (!ENRICH_DISABLED) {
    agent = await loadAgentConfig(AGENT_SLUG);
    if (!agent) {
      console.log(`   Enriquecimento IA: ✗ desativado (agente "${AGENT_SLUG}" nao registrado na IA Hub)`);
    } else if (agent.active === false) {
      console.log(`   Enriquecimento IA: ✗ desativado (agente "${agent.name}" inativo)`);
    } else {
      const apiKey = await resolveGlobalApiKey(agent.provider);
      if (!apiKey) {
        console.log(`   Enriquecimento IA: ✗ desativado (sem chave global para provider "${agent.provider}")`);
      } else {
        enrichEnabled = true;
        console.log(`   Enriquecimento IA: ✓ ATIVO via agente "${agent.name || agent.slug}" (${agent.provider}/${agent.model})`);
      }
    }
  } else {
    console.log(`   Enriquecimento IA: ✗ desativado (ENRICH_DISABLED=1)`);
  }
  console.log('');

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
      // 1. Coleta NOMES únicos dos sends (EmailName)
      // 2. Fetch batch de assets via REST asset query (por nome — único campo
      //    confiável que cruza Send→Asset; os IDs não batem entre as APIs)
      // 3. Pra cada asset: hash do HTML → checa Firestore se já tem
      //    extracted com mesmo hash → cache hit (skip). Senão chama LLM.
      // 4. Mapa: nome -> {description, extracted, htmlHash}
      const sendNames = [...new Set(sends.map(s => (s.EmailName || '').trim()).filter(Boolean))];
      const assetMap  = await fetchAssetsByNames(token, sendNames);
      console.log(`   ${assetMap.size} assets recuperados (de ${sendNames.length} nomes únicos)`);

      // Pré-busca docs existentes pra cache lookup (por jobId já é nosso docId)
      // Cache hit = mesmo htmlHash + extracted no formato/provider atual.
      // Se extractedBy mudou (ex: Groq → Gemini Vision), invalida cache.
      const expectedExtractedBy = agent
        ? `${agent.provider}/${agent.model}`
        : null;
      const FORCE_REEXTRACT = process.env.FORCE_REEXTRACT === '1';
      const existingDocs = new Map(); // jobId -> htmlHash existente (válido)
      if (enrichEnabled && assetMap.size) {
        const docIds = sends.map(s => `${bu.id}_${s.ID}`);
        const chunks = [];
        for (let i = 0; i < docIds.length; i += 30) chunks.push(docIds.slice(i, i + 30));
        for (const chunk of chunks) {
          const reads = await Promise.all(chunk.map(id => db.collection('mc_performance').doc(id).get()));
          reads.forEach(r => {
            if (r.exists) {
              const data = r.data();
              // Cache só válido se: tem htmlHash + extracted populado + extractedBy
              // bate com agente atual + não há FORCE_REEXTRACT
              const matchesProvider = expectedExtractedBy
                ? (data.extracted?.extractedBy || '').startsWith(expectedExtractedBy.split('/')[0])
                : true;
              const hasExtracted = data.extracted && Object.keys(data.extracted).length > 2;
              if (data.htmlHash && hasExtracted && matchesProvider && !FORCE_REEXTRACT) {
                existingDocs.set(r.id, data.htmlHash);
              }
            }
          });
        }
      }

      // Enriquece assets (htmlHash + extracted via LLM)
      // Mapa por NOME (não mais legacyId)
      const enrichmentMap = new Map(); // name -> { description, htmlHash, extracted, structural }
      if (assetMap.size) {
        const entries = [...assetMap.entries()];
        // CONCURRENCY=1 (serial). Aplica tanto pra Groq quanto Gemini Vision.
        // Gemini Flash free tier: 15 RPM, 1M TPM, 1500 RPD — serial+throttle
        // 4s entre chamadas (~15 RPM) cabe folgado.
        const CONCURRENCY = 1;
        const PROVIDER_DELAY_MS = (agent?.provider === 'gemini') ? 4500 : 0;

        for (let i = 0; i < entries.length; i += CONCURRENCY) {
          const slice = entries.slice(i, i + CONCURRENCY);
          await Promise.all(slice.map(async ([name, asset]) => {
            const htmlHash = sha256(asset.html);
            const structural = htmlStructuralStats(asset.html);

            // Cache hit: pra qualquer doc dessa BU com este nome+hash, pula
            // (multiplos sends do mesmo email = mesmo asset = mesmo hash)
            const matchingDocIds = sends
              .filter(s => (s.EmailName || '').trim() === name)
              .map(s => `${bu.id}_${s.ID}`);
            const allCached = matchingDocIds.length > 0 &&
              matchingDocIds.every(id => existingDocs.get(id) === htmlHash);

            if (allCached) {
              summary.cacheHits += matchingDocIds.length;
              // Mesmo em cache hit, salva htmlText (até 30k chars).
              const htmlText = asset.html ? stripHtml(asset.html).slice(0, 30000) : '';
              enrichmentMap.set(name, {
                description: asset.description, htmlHash, structural, extracted: null,
                htmlText,
              });
              return;
            }

            // Sem cache: extrai via agente. Passa contexto rico:
            // - html cru (pra Vision extrair imagens)
            // - text stripped (rodapé/disclaimer pode ter contexto)
            // - subject + name (representativos da campanha)
            let extracted = null;
            let extractedMeta = null;
            if (enrichEnabled && asset.html) {
              const text = stripHtml(asset.html);
              const sample = sends.find(s => (s.EmailName || '').trim() === name);
              const result = await extractEntitiesViaAgent({
                html: asset.html,
                text,
                subject: sample?.Subject || '',
                name,
              }, agent);
              if (result?.json) {
                extracted = result.json;
                extractedMeta = { provider: result.provider, model: result.model };
                summary.llmCalls++;
                summary.enriched++;
                if (result.imagesUsed) summary.imagesUsed = (summary.imagesUsed || 0) + result.imagesUsed;
                if (result.cacheHitsImg) summary.imageCacheHits = (summary.imageCacheHits || 0) + result.cacheHitsImg;
              }
              // Throttle entre chamadas pra respeitar rate limits (Gemini ~15 RPM)
              if (PROVIDER_DELAY_MS > 0) {
                await new Promise(r => setTimeout(r, PROVIDER_DELAY_MS));
              }
            }

            // Dump texto stripped (até 30k chars) pra auditoria + re-extração.
            // Aumentado de 10k → 30k em 4.7.1 após descobrir que os primeiros
            // ~5-8k chars de email SFMC são template/rodapé legal — o conteúdo
            // real (destinos, hotéis) vem DEPOIS no HTML cru (estrutura de
            // tabelas aninhadas).
            const htmlText = asset.html ? stripHtml(asset.html).slice(0, 30000) : '';
            enrichmentMap.set(name, {
              description: asset.description,
              htmlHash, structural, extracted, extractedMeta,
              assetId: asset.assetId, assetName: asset.assetName,
              htmlText,
            });
          }));
        }
      }

      let batch = db.batch(), batchSize = 0, written = 0;

      for (const send of sends) {
        const doc   = buildDoc(send, bu);
        const docId = `${bu.id}_${send.ID}`;

        // Anexa enrichment se disponível (lookup por nome agora)
        const sendName = (send.EmailName || '').trim();
        const enrich = sendName ? enrichmentMap.get(sendName) : null;
        if (enrich) {
          if (send.EmailID)         doc.emailLegacyId = send.EmailID;
          if (enrich.assetId)       doc.assetId       = enrich.assetId;
          if (enrich.description)   doc.description   = enrich.description;
          if (enrich.htmlHash)      doc.htmlHash      = enrich.htmlHash;
          if (enrich.structural)    doc.htmlStats     = enrich.structural;
          if (enrich.extracted) {
            doc.extracted = {
              ...enrich.extracted,
              extractedAt: admin.firestore.FieldValue.serverTimestamp(),
              extractedBy: enrich.extractedMeta
                ? `${enrich.extractedMeta.provider}/${enrich.extractedMeta.model}`
                : 'agent',
              agentId: agent?.id || null,
              agentSlug: agent?.slug || null,
            };
          }
          // Dump texto stripped (até 10k chars) pra auditoria + re-extração
          // futura sem refazer fetch SFMC.
          if (enrich.htmlText) doc.htmlText = enrich.htmlText;
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
    const visionInfo = summary.imagesUsed
      ? ` · 🖼 ${summary.imagesUsed} imgs Vision (${summary.imageCacheHits || 0} cache img)`
      : '';
    console.log(`🤖 Enriquecimento IA: ${summary.enriched} novos · ${summary.cacheHits} cache hits · ${summary.llmCalls} chamadas LLM${visionInfo}`);
  }
}

main().catch(e => { console.error('Erro fatal:', e); process.exit(1); });
