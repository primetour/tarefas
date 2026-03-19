/**
 * PRIMETOUR — Meta Instagram → Firestore Sync
 * Suporta tokens de System User (Business Manager).
 *
 * Secrets no GitHub:
 *   META_APP_ID, META_APP_SECRET, META_ACCESS_TOKEN
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

/* ─── Config ──────────────────────────────────────────────── */
const APP_ID       = process.env.META_APP_ID      || '';
const APP_SECRET   = process.env.META_APP_SECRET   || '';
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || '';
const SYNC_DAYS    = parseInt(process.env.SYNC_DAYS) || 90;
const GRAPH        = 'https://graph.facebook.com/v19.0';

// Contas Instagram Business conhecidas — apenas 2 agora
const KNOWN_ACCOUNTS = [
  { handle: 'primetourviagens', label: 'Primetour Viagens' },
  { handle: 'icsbyprimetour',   label: 'ICs by Primetour'  },
];

/* ─── Graph API helper ────────────────────────────────────── */
async function gql(path, token, params = {}) {
  const qs = new URLSearchParams({ access_token: token, ...params }).toString();
  const url = `${GRAPH}/${path}?${qs}`;
  const res  = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`[${path}] ${data.error.message} (code ${data.error.code})`);
  return data;
}

/* ─── Descobrir contas IG via múltiplas estratégias ──────── */
async function getIGAccounts(token) {
  const accounts = [];

  // Estratégia 1: /me/accounts (funciona para User tokens)
  try {
    console.log('  Tentando /me/accounts...');
    const data = await gql('me/accounts', token, {
      fields: 'id,name,instagram_business_account',
      limit:  50,
    });
    for (const page of (data.data || [])) {
      const ig = page.instagram_business_account;
      if (!ig) continue;
      try {
        const igData = await gql(ig.id, token, {
          fields: 'id,username,name,followers_count',
        });
        const match = KNOWN_ACCOUNTS.find(
          a => a.handle.toLowerCase() === (igData.username || '').toLowerCase()
        );
        accounts.push({
          igId:      igData.id,
          username:  igData.username,
          label:     match?.label || igData.name,
          followers: igData.followers_count || 0,
        });
      } catch(e) { console.warn(`    Erro ao detalhar conta: ${e.message}`); }
    }
    if (accounts.length) {
      console.log(`  ✓ ${accounts.length} conta(s) via /me/accounts`);
      return accounts;
    }
  } catch(e) {
    console.log(`  /me/accounts falhou: ${e.message}`);
  }

  // Estratégia 2: /me/businesses → owned_pages (System User token)
  try {
    console.log('  Tentando /me/businesses...');
    const biz = await gql('me/businesses', token, { fields: 'id,name', limit: 10 });
    for (const b of (biz.data || [])) {
      try {
        const pages = await gql(`${b.id}/owned_pages`, token, {
          fields: 'id,name,instagram_business_account',
          limit:  50,
        });
        for (const page of (pages.data || [])) {
          const ig = page.instagram_business_account;
          if (!ig) continue;
          const igData = await gql(ig.id, token, {
            fields: 'id,username,name,followers_count',
          });
          const match = KNOWN_ACCOUNTS.find(
            a => a.handle.toLowerCase() === (igData.username || '').toLowerCase()
          );
          if (!accounts.find(a => a.igId === igData.id)) {
            accounts.push({
              igId:      igData.id,
              username:  igData.username,
              label:     match?.label || igData.name,
              followers: igData.followers_count || 0,
            });
          }
        }
      } catch(e) { console.warn(`    Business ${b.id}: ${e.message}`); }
    }
    if (accounts.length) {
      console.log(`  ✓ ${accounts.length} conta(s) via /me/businesses`);
      return accounts;
    }
  } catch(e) {
    console.log(`  /me/businesses falhou: ${e.message}`);
  }

  // Estratégia 3: buscar IDs das contas direto pelo handle (fallback)
  // Requer permissão instagram_basic no token
  console.log('  Tentando busca direta por handle...');
  for (const known of KNOWN_ACCOUNTS) {
    try {
      // Primeiro busca a FB Page pelo nome para obter IG vinculado
      const search = await gql('pages/search', token, {
        q: known.handle, fields: 'id,name,instagram_business_account',
      });
      for (const page of (search.data || [])) {
        const ig = page.instagram_business_account;
        if (!ig) continue;
        const igData = await gql(ig.id, token, {
          fields: 'id,username,name,followers_count',
        });
        if ((igData.username||'').toLowerCase() === known.handle.toLowerCase()) {
          accounts.push({
            igId: igData.id, username: igData.username,
            label: known.label, followers: igData.followers_count || 0,
          });
        }
      }
    } catch(e) { console.warn(`    Busca por handle ${known.handle}: ${e.message}`); }
  }

  return accounts;
}

/* ─── Media type label ────────────────────────────────────── */
function mediaTypeLabel(type) {
  if (type === 'VIDEO')          return 'Reel';
  if (type === 'CAROUSEL_ALBUM') return 'Carrossel';
  if (type === 'IMAGE')          return 'Post';
  if (type === 'STORY')          return 'Story';
  return type || 'Post';
}

/* ─── Fetch media list ────────────────────────────────────── */
async function fetchMedia(igId, token, days) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceTs = Math.floor(since.getTime() / 1000);

  const fields = [
    'id','timestamp','media_type','media_product_type',
    'caption','permalink','thumbnail_url','media_url',
    'like_count','comments_count',
  ].join(',');

  let url  = `${GRAPH}/${igId}/media?fields=${fields}&since=${sinceTs}&limit=50&access_token=${token}`;
  const all = [];

  while (url) {
    const res  = await fetch(url);
    const data = await res.json();
    if (data.error) { console.warn(`  fetchMedia: ${data.error.message}`); break; }
    all.push(...(data.data || []));
    url = data.paging?.next || null;
  }
  return all;
}

/* ─── Fetch insights for a media item ────────────────────── */
async function fetchInsights(mediaId, type, token) {
  let metrics;
  if (type === 'VIDEO' || type === 'REELS') {
    metrics = 'reach,impressions,plays,saved,shares,comments,likes,follows,profile_visits';
  } else if (type === 'STORY') {
    metrics = 'reach,impressions,exits,replies,taps_forward,taps_back';
  } else {
    metrics = 'reach,impressions,saved,shares,comments,likes,follows,profile_visits';
  }

  try {
    const url = `${GRAPH}/${mediaId}/insights?metric=${metrics}&access_token=${token}`;
    const res  = await fetch(url);
    const data = await res.json();
    if (data.error) return {};
    const out = {};
    for (const item of (data.data || [])) {
      out[item.name] = item.values?.[0]?.value ?? item.value ?? 0;
    }
    return out;
  } catch(e) { return {}; }
}

/* ─── Build Firestore doc ─────────────────────────────────── */
function buildDoc(media, insights, account) {
  const type  = media.media_product_type || media.media_type || 'IMAGE';
  const likes      = Number(media.like_count    || insights.likes        || 0);
  const comments   = Number(media.comments_count|| insights.comments     || 0);
  const reach      = Number(insights.reach      || 0);
  const impressions= Number(insights.impressions|| 0);
  const saved      = Number(insights.saved      || 0);
  const shares     = Number(insights.shares     || 0);
  const plays      = Number(insights.plays      || 0);
  const follows    = Number(insights.follows    || 0);
  const profileVisits = Number(insights.profile_visits || 0);
  const engagement = likes + comments + saved + shares;
  const engRate    = reach > 0 ? Math.round((engagement / reach) * 10000) / 100 : 0;
  const caption    = (media.caption || '').replace(/#\S+/g, '').trim().slice(0, 120);

  return {
    accountId:       account.igId,
    accountHandle:   account.username,
    accountName:     account.label,
    mediaId:         media.id,
    mediaType:       mediaTypeLabel(type),
    mediaProductType:type,
    permalink:       media.permalink    || null,
    thumbnailUrl:    media.thumbnail_url || media.media_url || null,
    caption,
    postedAt: media.timestamp
      ? admin.firestore.Timestamp.fromDate(new Date(media.timestamp))
      : null,
    reach, impressions, likes, comments, saved, shares, plays, follows,
    profileVisits, engagement, engagementRate: engRate,
    exits:       Number(insights.exits       || 0),
    replies:     Number(insights.replies     || 0),
    tapsForward: Number(insights.taps_forward|| 0),
    tapsBack:    Number(insights.taps_back   || 0),
    syncedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

/* ─── Debug: show token info ──────────────────────────────── */
async function debugToken(token) {
  try {
    const me = await gql('me', token, { fields: 'id,name,type' });
    console.log(`  Token válido. me → id:${me.id} name:${me.name} type:${me.type||'user'}`);
  } catch(e) {
    console.log(`  Token inválido: ${e.message}`);
    process.exit(1);
  }
}

/* ─── Main ────────────────────────────────────────────────── */
async function main() {
  console.log(`\n📸 PRIMETOUR — Meta Instagram Sync`);
  console.log(`   Período: últimos ${SYNC_DAYS} dias\n`);

  await debugToken(ACCESS_TOKEN);

  const igAccounts = await getIGAccounts(ACCESS_TOKEN);

  if (!igAccounts.length) {
    console.error('\n❌ Nenhuma conta Instagram encontrada.');
    console.error('   Possíveis causas:');
    console.error('   1. O token não tem permissões: pages_read_engagement, instagram_basic, instagram_manage_insights');
    console.error('   2. As Pages do Facebook não estão vinculadas às contas Instagram Business');
    console.error('   3. O System User não tem acesso às Pages no Business Manager');
    console.error('\n   → Verifique em business.facebook.com → Configurações → Contas → Páginas');
    process.exit(1);
  }

  console.log(`\n  Contas: ${igAccounts.map(a => `@${a.username} (${a.igId})`).join(', ')}\n`);

  const summary = { success: [], failed: [], total: 0 };

  for (const account of igAccounts) {
    console.log(`📷 @${account.username} — ${account.label}`);
    try {
      const mediaList = await fetchMedia(account.igId, ACCESS_TOKEN, SYNC_DAYS);
      console.log(`   ${mediaList.length} posts encontrados`);

      if (!mediaList.length) {
        summary.success.push(`@${account.username} (0)`); continue;
      }

      let batch = db.batch(), batchSize = 0, written = 0;

      for (const media of mediaList) {
        try {
          const type     = media.media_product_type || media.media_type || 'IMAGE';
          const insights = await fetchInsights(media.id, type, ACCESS_TOKEN);
          const doc      = buildDoc(media, insights, account);
          const docId    = `${account.igId}_${media.id}`;
          batch.set(db.collection('meta_performance').doc(docId), doc, { merge: true });
          batchSize++; written++;
          if (batchSize >= 499) { await batch.commit(); batch = db.batch(); batchSize = 0; }
          // Respeitar rate limit da Meta (~200 req/hora)
          await new Promise(r => setTimeout(r, 250));
        } catch(e) { console.warn(`   Erro no post ${media.id}: ${e.message}`); }
      }

      if (batchSize > 0) await batch.commit();
      console.log(`   ✓ ${written} posts salvos`);
      summary.success.push(`@${account.username} (${written})`);
      summary.total += written;

    } catch(e) {
      console.error(`   ✗ ERRO: ${e.message}`);
      summary.failed.push({ account: account.username, error: e.message });
    }
  }

  // Salvar metadados das contas
  for (const acc of igAccounts) {
    try {
      await db.collection('meta_accounts').doc(acc.igId).set({
        igId: acc.igId, username: acc.username, label: acc.label,
        followers: acc.followers,
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch(e) {}
  }

  console.log('\n─────────────────────────────────────────');
  if (summary.success.length) console.log(`✅ ${summary.success.join(' · ')}`);
  if (summary.failed.length)  console.log(`❌ ${summary.failed.map(f=>`@${f.account}: ${f.error}`).join(', ')}`);
  console.log(`📊 Total: ${summary.total} posts sincronizados\n`);
}

main().catch(e => { console.error('Erro fatal:', e); process.exit(1); });
