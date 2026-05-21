/**
 * Backfill de imageUrls em mc_performance (v4.49.30).
 *
 * Problema: mc-sync.js (até v4.49.28) baixava as imagens dos emails pra
 * Vision IA mas descartava as URLs. A partir de v4.49.29, salvamos
 * doc.imageUrls. Pra docs ANTIGOS sem essas URLs salvas, este script
 * refetch o HTML do SFMC e popula imageUrls.
 *
 * Estratégia:
 *   1. Lê mc_performance filtrando docs SEM imageUrls (ou com array vazio)
 *   2. Agrupa por asset (nome do email) — mesmo asset pode ter N docs
 *      (waves do mesmo conteúdo). 1 fetch SFMC = atualiza N docs.
 *   3. Pra cada asset único: fetch HTML do SFMC → extractContentImages(5)
 *   4. Atualiza TODOS os docs com aquele asset name de uma vez
 *
 * Idempotente: roda quantas vezes quiser. Pula docs que já têm imageUrls.
 *
 * Run:
 *   MC_CLIENT_ID=... MC_CLIENT_SECRET=... ... node scripts/backfill-image-urls.js
 *
 * Flags:
 *   --dry            só relata, não escreve
 *   --bu=centurion   só uma BU
 *   --limit=50       processa só N assets (debug)
 */
const fetchFn = (...args) => import('node-fetch').then(({default: f}) => f(...args));
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
  // Usa Application Default Credentials (gcloud auth) — local dev
  admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
}
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const MC_AUTH_URL      = process.env.MC_AUTH_URL      || 'https://mcdr998fk605k8c51p7t-gc781ly.auth.marketingcloudapis.com';
const MC_REST_URL      = process.env.MC_REST_URL      || 'https://mcdr998fk605k8c51p7t-gc781ly.rest.marketingcloudapis.com';
const MC_CLIENT_ID     = process.env.MC_CLIENT_ID     || '';
const MC_CLIENT_SECRET = process.env.MC_CLIENT_SECRET || '';

const DRY      = process.argv.includes('--dry');
// v4.49.57+ --force: re-extrai imageUrls de TODOS os docs (ignora filtro
// de "sem imageUrls"). Usado quando o schema do extractor muda
// (ex: strings → objetos {url,alt,link,position}).
const FORCE    = process.argv.includes('--force');
const BU_ARG   = (process.argv.find(a => a.startsWith('--bu=')) || '').slice(5);
const LIMIT    = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '').slice(8)) || 0;

/* ─── BUs MID map (mesmo do mc-sync.js BUSINESS_UNITS) ─── */
const BUS = [
  { id: 'primetour',     mid: '546014130' },
  { id: 'btg-partners',  mid: '546015816' },
  { id: 'btg-ultrablue', mid: '546015815' },
  { id: 'centurion',     mid: '546015818' },
  { id: 'pts',           mid: '546015817' },
];

/* ─── SFMC OAuth ─── */
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
  if (!res.ok) throw new Error(`SFMC token fail: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

/* ─── SFMC asset fetch by names ─── */
async function fetchAssetsByNames(token, names) {
  if (!names.length) return new Map();
  const fetch = await fetchFn;
  const url = `${MC_REST_URL}/asset/v1/content/assets/query`;

  const out = new Map();
  // SFMC limita queries — chunked em batches de 50
  const CHUNK = 50;
  for (let i = 0; i < names.length; i += CHUNK) {
    const chunk = names.slice(i, i + CHUNK);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        // Body idêntico ao mc-sync.js — sem fields (retorna doc completo).
        // Tentar especificar 'views.html.content' explicitamente quebra com 400.
        page: { page: 1, pageSize: 200 },
        query: {
          leftOperand:  { property: 'assetType.name', simpleOperator: 'equals', value: 'htmlemail' },
          logicalOperator: 'AND',
          rightOperand: { property: 'name', simpleOperator: 'in', value: chunk },
        },
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.warn(`    asset query falhou: ${res.status} — ${txt.slice(0,200)}`);
      continue;
    }
    const data = await res.json();
    for (const it of (data.items || [])) {
      const name = (it.name || '').trim();
      if (!name) continue;
      // Fallback chain idêntico ao mc-sync.js
      const html = it.views?.html?.content || it.content || it.views?.text?.content || '';
      if (!html) continue;
      // Se há múltiplos assets com mesmo nome, mantém o mais recente
      const existing = out.get(name);
      if (existing) {
        const newDate = new Date(it.modifiedDate || 0).getTime();
        const oldDate = new Date(existing.modifiedDate || 0).getTime();
        if (newDate <= oldDate) continue;
      }
      out.set(name, { assetId: it.id, html, modifiedDate: it.modifiedDate });
    }
  }
  return out;
}

/* ─── Image extraction (idêntico ao mc-sync) ─── */
// v4.49.57+ Single source of truth — preserva ordem do HTML + captura links
const { extractContentImages } = require('./lib/extract-content-images.cjs');

/* ─── Main ─── */
(async () => {
  console.log(`${DRY ? '🔍 DRY-RUN' : '✏  ESCREVENDO'} · Backfill image URLs em mc_performance`);
  if (BU_ARG) console.log(`  Filtro: BU = ${BU_ARG}`);
  if (LIMIT)  console.log(`  Limite: ${LIMIT} assets únicos`);
  console.log();

  if (!MC_CLIENT_ID || !MC_CLIENT_SECRET) {
    console.error('❌ MC_CLIENT_ID e MC_CLIENT_SECRET são obrigatórios.');
    process.exit(1);
  }

  // 1. Lê docs alvo
  let q = db.collection('mc_performance');
  if (BU_ARG) q = q.where('buId', '==', BU_ARG);
  const snap = await q.get();
  const allDocs = snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
  // v4.49.57+ FORCE: re-extrai tudo (usado quando schema do extractor muda).
  // Detecta também schema antigo automaticamente: se imageUrls é array de
  // strings (não objetos), re-extrai pra atualizar pra { url, alt, link, ... }.
  const isLegacyStringSchema = (d) =>
    Array.isArray(d.imageUrls) && d.imageUrls.length > 0 &&
    typeof d.imageUrls[0] === 'string';
  const needsBackfill = FORCE
    ? allDocs
    : allDocs.filter(d =>
        !Array.isArray(d.imageUrls) || d.imageUrls.length === 0 || isLegacyStringSchema(d)
      );
  const legacySchemaCount = allDocs.filter(isLegacyStringSchema).length;
  console.log(`📊 Total docs: ${allDocs.length}`);
  console.log(`   sem imageUrls:    ${allDocs.filter(d => !Array.isArray(d.imageUrls) || d.imageUrls.length === 0).length}`);
  console.log(`   schema legado (strings): ${legacySchemaCount} ${legacySchemaCount > 0 ? '← serão atualizados pra novo schema {url,alt,link}' : ''}`);
  console.log(`   força (--force):  ${FORCE ? 'SIM (re-extrai TUDO)' : 'não'}`);
  console.log(`   a processar:      ${needsBackfill.length}`);

  // 2. Agrupa por (buId, name) — assets únicos
  const assetMap = new Map(); // "buId|name" → { buId, name, docs[] }
  for (const d of needsBackfill) {
    const buId = d.buId;
    const name = (d.name || '').trim();
    if (!buId || !name) continue;
    const key = `${buId}|${name}`;
    if (!assetMap.has(key)) assetMap.set(key, { buId, name, docs: [] });
    assetMap.get(key).docs.push(d);
  }
  console.log(`📦 Assets únicos a refetch: ${assetMap.size}`);
  if (LIMIT && assetMap.size > LIMIT) {
    const limited = new Map();
    let i = 0;
    for (const [k, v] of assetMap) { if (i++ >= LIMIT) break; limited.set(k, v); }
    console.log(`   (limitado a ${limited.size})`);
    assetMap.clear();
    for (const [k, v] of limited) assetMap.set(k, v);
  }

  // 3. Agrupa por BU pra reusar token
  const byBu = new Map(); // buId → [assetEntry...]
  for (const entry of assetMap.values()) {
    if (!byBu.has(entry.buId)) byBu.set(entry.buId, []);
    byBu.get(entry.buId).push(entry);
  }

  // 4. Para cada BU: token + fetch assets + update docs
  let touched = 0, skipped = 0, errors = 0, totalUrls = 0;
  for (const [buId, entries] of byBu) {
    const bu = BUS.find(b => b.id === buId);
    if (!bu) { console.warn(`  ⚠ BU desconhecido: ${buId} — pulando`); continue; }
    console.log(`\n━━━ ${buId} (mid=${bu.mid}) · ${entries.length} assets ━━━`);
    let token;
    try { token = await getToken(bu.mid); }
    catch (e) { console.error(`  ❌ token fail: ${e.message}`); errors++; continue; }

    // Names únicos
    const names = [...new Set(entries.map(e => e.name))];
    console.log(`  names únicos: ${names.length}`);

    // Fetch assets
    let assets;
    try { assets = await fetchAssetsByNames(token, names); }
    catch (e) { console.error(`  ❌ asset fetch fail: ${e.message}`); errors++; continue; }
    console.log(`  assets retornados pelo SFMC: ${assets.size}`);

    // Update docs
    let batch = db.batch();
    let batchN = 0;
    for (const entry of entries) {
      const asset = assets.get(entry.name);
      if (!asset?.html) {
        skipped++;
        continue;
      }
      const imageUrls = extractContentImages(asset.html, 5);
      if (!imageUrls.length) { skipped++; continue; }
      totalUrls += imageUrls.length;

      // Atualiza TODOS os docs com este asset name
      for (const d of entry.docs) {
        if (!DRY) {
          batch.update(d.ref, {
            imageUrls,
            imageUrlsBackfilledAt: FV.serverTimestamp(),
            imageUrlsBackfilledBy: 'backfill-image-urls-v4.49.30',
          });
          batchN++;
          if (batchN >= 200) { await batch.commit(); batch = db.batch(); batchN = 0; }
        }
        touched++;
      }
    }
    if (!DRY && batchN > 0) await batch.commit();
    console.log(`  docs atualizados: ${entries.reduce((s,e)=>s+e.docs.length,0)} (touched=${touched})`);
  }

  console.log(`\n${'━'.repeat(60)}`);
  console.log(`📈 Resumo:`);
  console.log(`   Docs tocados:     ${touched}`);
  console.log(`   Docs pulados:     ${skipped} (asset não encontrado / sem imagens)`);
  console.log(`   URLs adicionadas: ${totalUrls}`);
  console.log(`   Erros de BU:      ${errors}`);
  console.log(`\n${DRY ? '⚠  DRY-RUN — nada foi escrito' : '✅ Backfill concluído'}`);
  process.exit(0);
})();
