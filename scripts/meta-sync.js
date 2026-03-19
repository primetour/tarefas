/**
 * PRIMETOUR — Meta Instagram → Firestore Sync
 * Busca posts, reels, stories e métricas das 3 contas Instagram Business.
 *
 * Secrets necessários no GitHub:
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

/* ─── Configuração ────────────────────────────────────────── */
const APP_ID       = process.env.META_APP_ID     || '1498397055192415';
const APP_SECRET   = process.env.META_APP_SECRET || '0b55a4a87815ce2395a7ab3688310223';
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || '';
const SYNC_DAYS    = parseInt(process.env.SYNC_DAYS) || 90;
const GRAPH_URL    = 'https://graph.facebook.com/v19.0';

// Contas Instagram Business — handles para referência
const ACCOUNTS = [
  { handle: 'primetourviagens', label: 'Primetour Viagens' },
  { handle: 'icsbyprimetour',   label: 'ICs by Primetour'  },
  { handle: 'heyprimers',       label: 'Hey Primers'       },
];

/* ─── Renovar token se necessário ────────────────────────── */
async function getLongLivedToken() {
  // Exchange short token for long-lived (60 days) if needed
  // If already a System User token (never expires), this is a no-op
  const url = `${GRAPH_URL}/oauth/access_token`
    + `?grant_type=fb_exchange_token`
    + `&client_id=${APP_ID}`
    + `&client_secret=${APP_SECRET}`
    + `&fb_exchange_token=${ACCESS_TOKEN}`;

  const res  = await fetch(url);
  const data = await res.json();

  if (data.error) {
    console.log('  Token já é de longa duração ou System User — usando diretamente.');
    return ACCESS_TOKEN;
  }
  console.log(`  Token renovado (expira em ${Math.round((data.expires_in||0)/86400)} dias)`);
  return data.access_token || ACCESS_TOKEN;
}

/* ─── Buscar contas Instagram Business vinculadas ao token ── */
async function getIGAccounts(token) {
  // Get all Facebook Pages
  const res  = await fetch(`${GRAPH_URL}/me/accounts?fields=id,name,instagram_business_account&access_token=${token}&limit=50`);
  const data = await res.json();

  if (data.error) throw new Error(`getIGAccounts: ${data.error.message}`);

  const accounts = [];
  for (const page of (data.data || [])) {
    const ig = page.instagram_business_account;
    if (!ig) continue;

    // Get IG account details
    const igRes  = await fetch(`${GRAPH_URL}/${ig.id}?fields=id,username,name,followers_count,media_count&access_token=${token}`);
    const igData = await igRes.json();
    if (igData.error) continue;

    const match = ACCOUNTS.find(a => a.handle.toLowerCase() === (igData.username || '').toLowerCase());
    accounts.push({
      igId:      igData.id,
      username:  igData.username,
      name:      igData.name,
      label:     match?.label || igData.name,
      followers: igData.followers_count || 0,
      pageId:    page.id,
    });
  }

  console.log(`  ${accounts.length} conta(s) Instagram encontrada(s): ${accounts.map(a => '@' + a.username).join(', ')}`);
  return accounts;
}

/* ─── Media type label ────────────────────────────────────── */
function mediaTypeLabel(type, isCarousel) {
  if (type === 'VIDEO')         return 'Reel';
  if (type === 'IMAGE')         return isCarousel ? 'Carrossel' : 'Post';
  if (type === 'CAROUSEL_ALBUM') return 'Carrossel';
  return type || 'Post';
}

/* ─── Fetch media list for an IG account ─────────────────── */
async function fetchMedia(igId, token, days) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceTs = Math.floor(since.getTime() / 1000);

  const fields = [
    'id', 'timestamp', 'media_type', 'media_product_type',
    'caption', 'permalink', 'thumbnail_url', 'media_url',
    'like_count', 'comments_count', 'is_shared_to_feed',
  ].join(',');

  let url   = `${GRAPH_URL}/${igId}/media?fields=${fields}&since=${sinceTs}&limit=50&access_token=${token}`;
  const all = [];

  while (url) {
    const res  = await fetch(url);
    const data = await res.json();
    if (data.error) { console.warn(`  fetchMedia error: ${data.error.message}`); break; }
    all.push(...(data.data || []));
    url = data.paging?.next || null;
  }

  return all;
}

/* ─── Fetch insights for a single media ──────────────────── */
async function fetchInsights(mediaId, mediaType, token) {
  // Metrics depend on media type
  let metrics;
  if (mediaType === 'VIDEO' || mediaType === 'REELS') {
    metrics = 'reach,impressions,plays,saved,shares,comments,likes,follows,profile_visits';
  } else if (mediaType === 'STORY') {
    metrics = 'reach,impressions,exits,replies,taps_forward,taps_back';
  } else {
    // IMAGE or CAROUSEL_ALBUM
    metrics = 'reach,impressions,saved,shares,comments,likes,follows,profile_visits';
  }

  const url = `${GRAPH_URL}/${mediaId}/insights?metric=${metrics}&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.error) return {};

  // Normalize to flat object
  const out = {};
  for (const item of (data.data || [])) {
    out[item.name] = item.values?.[0]?.value ?? item.value ?? 0;
  }
  return out;
}

/* ─── Build Firestore doc ─────────────────────────────────── */
function buildDoc(media, insights, account) {
  const type    = media.media_product_type || media.media_type || 'IMAGE';
  const isReel  = type === 'VIDEO' || type === 'REELS';
  const isStory = type === 'STORY';

  const likes      = Number(media.like_count    || insights.likes       || 0);
  const comments   = Number(media.comments_count|| insights.comments    || 0);
  const reach      = Number(insights.reach      || 0);
  const impressions= Number(insights.impressions|| 0);
  const saved      = Number(insights.saved      || 0);
  const shares     = Number(insights.shares     || 0);
  const plays      = Number(insights.plays      || 0);
  const follows    = Number(insights.follows    || 0);
  const profileVisits = Number(insights.profile_visits || 0);

  const engagement = likes + comments + saved + shares;
  const engRate    = reach > 0 ? Math.round((engagement / reach) * 10000) / 100 : 0;

  // Caption preview (first 120 chars, no hashtags for preview)
  const caption = (media.caption || '').replace(/#\S+/g, '').trim().slice(0, 120);

  return {
    accountId:     account.igId,
    accountHandle: account.username,
    accountName:   account.label,
    mediaId:       media.id,
    mediaType:     mediaTypeLabel(media.media_type, media.media_type === 'CAROUSEL_ALBUM'),
    mediaProductType: type,
    permalink:     media.permalink    || null,
    thumbnailUrl:  media.thumbnail_url || media.media_url || null,
    caption,
    postedAt:      media.timestamp
      ? admin.firestore.Timestamp.fromDate(new Date(media.timestamp))
      : null,
    reach,
    impressions,
    likes,
    comments,
    saved,
    shares,
    plays,
    follows,
    profileVisits,
    engagement,
    engagementRate: engRate,
    // Stories specific
    exits:       Number(insights.exits       || 0),
    replies:     Number(insights.replies     || 0),
    tapsForward: Number(insights.taps_forward|| 0),
    tapsBack:    Number(insights.taps_back   || 0),
    syncedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

/* ─── Main ────────────────────────────────────────────────── */
async function main() {
  console.log(`\n📸 PRIMETOUR — Meta Instagram Sync`);
  console.log(`   Período: últimos ${SYNC_DAYS} dias\n`);

  const token   = await getLongLivedToken();
  const igAccounts = await getIGAccounts(token);

  if (!igAccounts.length) {
    console.error('Nenhuma conta Instagram Business encontrada. Verifique as permissões do token.');
    process.exit(1);
  }

  const summary = { success: [], failed: [], total: 0 };

  for (const account of igAccounts) {
    console.log(`\n📷 @${account.username} — ${account.label}`);
    try {
      const mediaList = await fetchMedia(account.igId, token, SYNC_DAYS);
      console.log(`   ${mediaList.length} posts encontrados`);

      if (!mediaList.length) {
        summary.success.push(`@${account.username} (0)`);
        continue;
      }

      let batch = db.batch(), batchSize = 0, written = 0;

      for (const media of mediaList) {
        try {
          const mediaType = media.media_product_type || media.media_type || 'IMAGE';
          const insights  = await fetchInsights(media.id, mediaType, token);
          const doc       = buildDoc(media, insights, account);
          const docId     = `${account.igId}_${media.id}`;

          batch.set(db.collection('meta_performance').doc(docId), doc, { merge: true });
          batchSize++;
          written++;

          if (batchSize >= 499) {
            await batch.commit();
            batch = db.batch(); batchSize = 0;
          }

          // Rate limit: Meta allows ~200 calls/hour per token
          await new Promise(r => setTimeout(r, 200));
        } catch(e) {
          console.warn(`   Erro no post ${media.id}: ${e.message}`);
        }
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

  // Save account stats (followers etc) to separate collection
  try {
    for (const acc of igAccounts) {
      await db.collection('meta_accounts').doc(acc.igId).set({
        igId:      acc.igId,
        username:  acc.username,
        label:     acc.label,
        followers: acc.followers,
        syncedAt:  admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  } catch(e) {}

  console.log('\n─────────────────────────────────────────');
  console.log(`✅ ${summary.success.join(' · ')}`);
  if (summary.failed.length) {
    console.log(`❌ ${summary.failed.map(f => `@${f.account}: ${f.error}`).join(', ')}`);
  }
  console.log(`📊 Total: ${summary.total} posts sincronizados\n`);
}

main().catch(e => { console.error('Erro fatal:', e); process.exit(1); });
