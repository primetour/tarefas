/**
 * Seed v4.50.0 — Banco de Roteiros
 *
 * Importa os 2 PDFs "Classic Collection" da PRIMETOUR usando o mesmo
 * fluxo da Cloud Function `importRoteiroBankPdf`:
 *  1. Lê PDF local
 *  2. Base64
 *  3. Anthropic Sonnet 4.5 multimodal (document content block)
 *  4. Parseia JSON conforme schema roteiros_bank
 *  5. Grava em Firestore como status='approved' (seed = curado direto)
 *
 * Idempotente: identifica docs pelo `source.originalFile` — se já existe, atualiza.
 */
const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const PDFS = [
  { file: '/Users/rene/Downloads/Classic Collection - China e Tibete.pdf', autoApprove: true },
  { file: '/Users/rene/Downloads/Classic Collection - Peru Completo - Lima, Arequipa, Puno, Valle Sagrado e Machu Picchu.pdf', autoApprove: true },
];

const EXTRACT_PROMPT = `
Você é um extrator estruturado de roteiros de viagem curados da PRIMETOUR (agência de luxo brasileira).

O PDF anexado contém UM roteiro completo no formato "Classic Collection" (estrutura típica:
título, narrativa de capa, dia-a-dia, valores parte terrestre com múltiplas categorias de
hospedagem, inclui/não inclui, formas de pagamento, cancelamento, documentação).

Extraia TUDO em JSON estrito, conformando AO SCHEMA ABAIXO. Não invente dados — só inclua
o que estiver explícito no PDF. Use null/array vazio quando não houver informação.

SCHEMA OBRIGATÓRIO:
{
  "title": string,
  "subtitle": string,
  "shortDescription": string,
  "longDescription": string,
  "collectionLabel": string,

  "geo": {
    "continents": [string],
    "countries":  [string],
    "cities": [
      { "city": string, "country": string, "continent": string, "nights": number }
    ]
  },

  "durationDays":   number,
  "durationNights": number,

  "days": [
    {
      "dayNumber": number,
      "city": string,
      "title": string,
      "narrative": string,
      "overnightCity": string,
      "flightLeg": boolean
    }
  ],

  "categories": [
    {
      "key": string,
      "label": string,
      "hotels": [
        { "city": string, "name": string, "roomType": string, "nights": number, "supplierUrl": string }
      ],
      "pricing": [
        {
          "period": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
          "single": number,
          "double": number,
          "currency": "USD" | "BRL" | "EUR"
        }
      ],
      "notes": string
    }
  ],

  "includes": {
    "hospedagem":   [string],
    "traslados":    [string],
    "passeios":     [string],
    "assistencia":  [string],
    "aereoInterno": [string],
    "trem":         [string],
    "outros":       [string]
  },
  "excludes": [string],

  "payment": {
    "terrestrial": string,
    "aerial":      string,
    "deposit":  { "amount": number, "currency": "USD"|"BRL"|"EUR", "perPerson": boolean, "notes": string },
    "settlement":  string
  },

  "cancellation": [
    { "fromDays": number, "multaPercent": number, "notes": string }
  ],

  "documentation": {
    "passport": string,
    "minors":   string,
    "visas":    [ { "country": string, "required": boolean, "notes": string } ],
    "vaccines": string
  },

  "travelNotes": [string],
  "tags": [string]
}

REGRAS DE OURO:
1. Retorne APENAS JSON válido, sem fences markdown, sem comentários.
2. Datas no formato ISO YYYY-MM-DD. Se o PDF disser "01/01/2020 a 30/04/2020", converta.
3. Valores numéricos sem prefixo de moeda (moeda em "currency").
4. "key" das categorias use slug: "sugestao-prime", "luxo", "luxo-standard", "luxo-moderado".
5. cities[].nights deve refletir o PDF — soma deve bater com durationNights.
6. Tags em português lowercase sem espaço (ex: "cultural", "espiritual", "unesco", "asia").
7. Se um campo não aparecer no PDF: null/0/[] respectivamente. Não pule chaves.
`.trim();

function slugify(s) {
  return String(s||'').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function autoCode(title, collectionLabel) {
  const pref = (collectionLabel || 'BNK').slice(0, 3).toUpperCase();
  const body = String(title || '')
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9 ]/g, '')
    .split(/\s+/).filter(Boolean)
    .slice(0, 3)
    .map(w => w.slice(0, 3))
    .join('');
  return `${pref}-${body || 'NEW'}`;
}

async function getAnthropicKey() {
  // Lê do GCP Secret Manager via gcloud (mesmo lugar onde a CF lê).
  const { execSync } = require('child_process');
  const out = execSync('gcloud secrets versions access latest --secret=ANTHROPIC_API_KEY --project=gestor-de-tarefas-primetour', { encoding: 'utf8' });
  const k = out.trim();
  if (!k.startsWith('sk-ant')) throw new Error('ANTHROPIC_API_KEY inválida do Secret Manager');
  return k;
}

async function callAnthropicWithPdf(apiKey, pdfBase64) {
  const reqBody = {
    model: 'claude-sonnet-4-5',
    max_tokens: 16000,
    temperature: 0.1,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: EXTRACT_PROMPT },
      ],
    }],
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(reqBody),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const d = await res.json();
  const text = (d.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('\n');
  return { text, inputTokens: d.usage?.input_tokens || 0, outputTokens: d.usage?.output_tokens || 0 };
}

function parseJson(text) {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('JSON não encontrado');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function findExistingByFilename(filename) {
  const snap = await db.collection('roteiros_bank')
    .where('source.originalFile', '==', filename).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

async function importOne({ file, autoApprove }) {
  const filename = path.basename(file);
  console.log(`\n=== Importing: ${filename} ===`);

  const stats = fs.statSync(file);
  console.log(`  PDF size: ${Math.round(stats.size/1024)}KB`);

  const pdfBase64 = fs.readFileSync(file).toString('base64');

  const apiKey = await getAnthropicKey();

  console.log('  Calling Anthropic...');
  const t0 = Date.now();
  const { text, inputTokens, outputTokens } = await callAnthropicWithPdf(apiKey, pdfBase64);
  console.log(`  Anthropic ${Math.round((Date.now()-t0)/1000)}s — in:${inputTokens} out:${outputTokens}`);

  const parsed = parseJson(text);
  console.log(`  Parsed: "${parsed.title}" — ${parsed.geo?.cities?.length||0} cidades, ${parsed.categories?.length||0} categorias, ${parsed.days?.length||0} dias`);

  const existingId = await findExistingByFilename(filename);
  if (existingId) {
    console.log(`  ⚠ Já existe doc com esse filename: ${existingId} — vou atualizar.`);
  }

  const finalStatus = autoApprove ? 'approved' : 'review';
  const now = FV.serverTimestamp();
  const docData = {
    ...parsed,
    status: finalStatus,
    slug: slugify(parsed.title || filename),
    code: autoCode(parsed.title, parsed.collectionLabel),
    source: {
      type: 'pdf_import_seed',
      originalFile: filename,
      importedAt: now,
      importedBy: RENE_UID,
      llmTokens: { input: inputTokens, output: outputTokens },
    },
    updatedAt: now,
    updatedBy: RENE_UID,
    ...(existingId ? {} : { createdAt: now, createdBy: RENE_UID }),
    ...(finalStatus === 'approved' ? { approvedAt: now, approvedBy: RENE_UID } : {}),
  };

  const ref = existingId
    ? db.collection('roteiros_bank').doc(existingId)
    : db.collection('roteiros_bank').doc();
  await ref.set(docData, { merge: !!existingId });
  console.log(`  ✅ ${existingId ? 'Atualizado' : 'Criado'}: ${ref.id}  (status=${finalStatus})`);
  return ref.id;
}

(async () => {
  for (const item of PDFS) {
    try {
      await importOne(item);
    } catch (e) {
      console.error(`  ❌ Falha em ${path.basename(item.file)}:`, e.message);
    }
  }
  console.log('\n=== Done. ===');
  process.exit(0);
})();
