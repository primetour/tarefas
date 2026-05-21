/**
 * Categorização honesta dos 64 docs sem imageUrls (v4.49.32).
 *
 * Após backfill v4.49.30 ficaram 64 docs sem imagens. Categorias:
 *   - 'csat'     → pesquisa de satisfação (não tem arte)
 *   - 'warmup'   → email de aquecimento de IP (sem conteúdo visual)
 *   - 'test'     → email de teste (sem arte)
 *   - 'pending'  → newsletter real, asset sumiu/renomeou no SFMC
 *
 * Pra 'pending', tenta refetch com lookup fuzzy (nome trimado/case-insensitive).
 *
 * Estratégia "100% honest coverage": cada doc termina com EXPLICITAMENTE
 * uma das opções acima ou imageUrls preenchido. Nada em estado ambíguo.
 *
 * Run:
 *   MC_CLIENT_ID=... MC_CLIENT_SECRET=... node scripts/categorize-no-art.js [--dry]
 */
const fetchFn = (...a) => import('node-fetch').then(({default:f}) => f(...a));
const admin = require('firebase-admin');

if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
} else {
  admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
}
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const MC_AUTH_URL      = process.env.MC_AUTH_URL || '';
const MC_REST_URL      = process.env.MC_REST_URL || '';
const MC_CLIENT_ID     = process.env.MC_CLIENT_ID || '';
const MC_CLIENT_SECRET = process.env.MC_CLIENT_SECRET || '';
const DRY = process.argv.includes('--dry');

const BUS = [
  { id: 'primetour',     mid: '546014130' },
  { id: 'btg-partners',  mid: '546015816' },
  { id: 'btg-ultrablue', mid: '546015815' },
  { id: 'centurion',     mid: '546015818' },
  { id: 'pts',           mid: '546015817' },
];

/* Categorização por padrão de nome */
function categorize(name) {
  const n = (name || '').toLowerCase();
  // CSAT / pesquisa de satisfação — não é newsletter de marketing
  if (/csat|pesquisa.*experi|opiniao|satisfacao|avaliacao|nps/i.test(n)) return 'csat';
  // WARMUP — aquecimento de IP, conteúdo neutro/genérico
  if (/warmup|aquecimento/i.test(n)) return 'warmup';
  // Test sends (template de teste, remetente, configuração)
  if (/^teste|test.*envio|test.*remetente|test_/i.test(n)) return 'test';
  // Default: newsletter real cujo asset sumiu/foi renomeado
  return 'pending';
}

const LABELS = {
  csat:    'CSAT · pesquisa de satisfação (sem arte visual por design)',
  warmup:  'Warmup · aquecimento de IP (conteúdo neutro, sem arte)',
  test:    'Email de teste · configuração/remetente (sem arte)',
  pending: 'Asset não encontrado no SFMC (provavelmente deletado/renomeado)',
};

async function getToken(mid) {
  const fetch = await fetchFn;
  const res = await fetch(`${MC_AUTH_URL}/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type:    'client_credentials',
      client_id:     MC_CLIENT_ID,
      client_secret: MC_CLIENT_SECRET,
      account_id:    mid,
    }),
  });
  if (!res.ok) throw new Error(`SFMC token fail: ${res.status}`);
  return (await res.json()).access_token;
}

/* Busca fuzzy: tenta nome exato + lowercase + variações com underscores/espaços */
async function fuzzyFetchAsset(token, name) {
  const fetch = await fetchFn;
  const variants = [
    name,
    name.replace(/_/g, ' '),
    name.replace(/\s+/g, '_'),
    name.replace(/\s*-\s*/g, ' '),
    name.replace(/\s+/g, ''),
  ];
  const unique = [...new Set(variants)];

  const url = `${MC_REST_URL}/asset/v1/content/assets/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      page: { page: 1, pageSize: 200 },
      query: {
        leftOperand:  { property: 'assetType.name', simpleOperator: 'equals', value: 'htmlemail' },
        logicalOperator: 'AND',
        rightOperand: { property: 'name', simpleOperator: 'in', value: unique },
      },
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.items?.length) return null;
  // Pega o mais recente
  const sorted = data.items.sort((a, b) =>
    new Date(b.modifiedDate || 0) - new Date(a.modifiedDate || 0)
  );
  const it = sorted[0];
  return it.views?.html?.content || it.content || '';
}

// v4.49.57+ Single source of truth — preserva ordem do HTML + captura links
const { extractContentImages } = require('./lib/extract-content-images.cjs');

(async () => {
  console.log(`${DRY ? '🔍 DRY-RUN' : '✏  ESCREVENDO'} · Categorização honesta v4.49.32\n`);
  if (!MC_CLIENT_ID || !MC_CLIENT_SECRET) {
    console.error('❌ MC_CLIENT_ID e MC_CLIENT_SECRET obrigatórios pra fuzzy refetch');
    process.exit(1);
  }

  // Lê docs sem imageUrls
  const snap = await db.collection('mc_performance').get();
  const all = snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
  const missing = all.filter(d => !Array.isArray(d.imageUrls) || d.imageUrls.length === 0);
  console.log(`📊 ${missing.length} docs sem imageUrls`);

  // Categoriza + agrupa por (buId, name)
  const buckets = { csat: [], warmup: [], test: [], pending: [] };
  for (const d of missing) {
    const cat = categorize(d.name);
    buckets[cat].push(d);
  }
  console.log(`📂 Categorização:`);
  console.log(`   csat:    ${buckets.csat.length}`);
  console.log(`   warmup:  ${buckets.warmup.length}`);
  console.log(`   test:    ${buckets.test.length}`);
  console.log(`   pending: ${buckets.pending.length} (tentar fuzzy refetch)\n`);

  // Pra csat/warmup/test: marca direto (sem refetch)
  let batch = db.batch(), batchN = 0;
  for (const [cat, docs] of [['csat', buckets.csat], ['warmup', buckets.warmup], ['test', buckets.test]]) {
    for (const d of docs) {
      if (!DRY) {
        batch.update(d.ref, {
          imageUrls: [],            // explicitamente vazio (não null/undefined)
          noArtReason: cat,
          noArtLabel:  LABELS[cat],
          noArtMarkedAt: FV.serverTimestamp(),
          noArtMarkedBy: 'categorize-v4.49.32',
        });
        batchN++;
        if (batchN >= 200) { await batch.commit(); batch = db.batch(); batchN = 0; }
      }
    }
  }
  if (!DRY && batchN > 0) { await batch.commit(); batch = db.batch(); batchN = 0; }

  // Pra pending: agrupa por BU + tenta fuzzy refetch
  const pendingByBu = {};
  for (const d of buckets.pending) {
    const bu = d.buId;
    if (!pendingByBu[bu]) pendingByBu[bu] = [];
    pendingByBu[bu].push(d);
  }

  let recovered = 0, stillMissing = 0, totalUrls = 0;
  for (const [buId, docs] of Object.entries(pendingByBu)) {
    const bu = BUS.find(b => b.id === buId);
    if (!bu) continue;
    console.log(`━━━ ${buId} pending · ${docs.length} docs ━━━`);
    let token;
    try { token = await getToken(bu.mid); } catch (e) { console.error(`  token fail: ${e.message}`); continue; }

    // Único por nome
    const byName = {};
    for (const d of docs) {
      const n = (d.name || '').trim();
      if (!n) continue;
      if (!byName[n]) byName[n] = [];
      byName[n].push(d);
    }

    for (const [name, docs2] of Object.entries(byName)) {
      const html = await fuzzyFetchAsset(token, name);
      if (!html) {
        // Marca como pending definitivo (asset sumido)
        for (const d of docs2) {
          if (!DRY) {
            batch.update(d.ref, {
              imageUrls: [],
              noArtReason: 'pending',
              noArtLabel:  LABELS.pending,
              noArtMarkedAt: FV.serverTimestamp(),
              noArtMarkedBy: 'categorize-v4.49.32',
            });
            batchN++;
            if (batchN >= 200) { await batch.commit(); batch = db.batch(); batchN = 0; }
          }
        }
        stillMissing += docs2.length;
        console.log(`  ✗ "${name.slice(0,50)}" — asset sumiu (${docs2.length} docs)`);
        continue;
      }
      const imgs = extractContentImages(html, 5);
      if (!imgs.length) {
        for (const d of docs2) {
          if (!DRY) {
            batch.update(d.ref, {
              imageUrls: [],
              noArtReason: 'pending',
              noArtLabel:  'HTML encontrado mas sem imagens identificáveis',
              noArtMarkedAt: FV.serverTimestamp(),
              noArtMarkedBy: 'categorize-v4.49.32',
            });
            batchN++;
          }
        }
        stillMissing += docs2.length;
        console.log(`  ~ "${name.slice(0,50)}" — HTML sem imagens (${docs2.length} docs)`);
        continue;
      }
      for (const d of docs2) {
        if (!DRY) {
          batch.update(d.ref, {
            imageUrls: imgs,
            imageUrlsBackfilledAt: FV.serverTimestamp(),
            imageUrlsBackfilledBy: 'categorize-v4.49.32-fuzzy',
            // Remove possíveis flags antigas
            noArtReason: FV.delete(),
            noArtLabel:  FV.delete(),
          });
          batchN++;
          totalUrls += imgs.length;
          if (batchN >= 200) { await batch.commit(); batch = db.batch(); batchN = 0; }
        }
        recovered++;
      }
      console.log(`  ✓ "${name.slice(0,50)}" — ${imgs.length} imgs · ${docs2.length} docs`);
    }
  }
  if (!DRY && batchN > 0) await batch.commit();

  console.log(`\n${'━'.repeat(60)}`);
  console.log(`📈 Resumo:`);
  console.log(`   Marcados csat/warmup/test: ${buckets.csat.length + buckets.warmup.length + buckets.test.length}`);
  console.log(`   Recuperados via fuzzy:      ${recovered} (com ${totalUrls} URLs)`);
  console.log(`   Pending definitivo:         ${stillMissing}`);
  console.log(`\n${DRY ? '⚠  DRY-RUN' : '✅ Aplicado'}`);
  process.exit(0);
})();
