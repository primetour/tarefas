/**
 * PRIMETOUR — Meta Instagram -> Firestore Sync
 * Graph API v25.0
 */

const { default: fetch } = require('node-fetch');
const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
});
const db = admin.firestore();

const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || '';
const SYNC_DAYS    = parseInt(process.env.SYNC_DAYS) || 90;
const GRAPH        = 'https://graph.facebook.com/v25.0';

const KNOWN_ACCOUNTS = [
  { handle: 'primetourviagens', label: 'Primetour Viagens' },
  { handle: 'icsbyprimetour',   label: 'ICs by Primetour'  },
];

async function gql(path, token, params) {
  const p   = new URLSearchParams({ access_token: token, ...(params||{}) }).toString();
  const res = await fetch(GRAPH + '/' + path + '?' + p);
  const d   = await res.json();
  if (d.error) throw new Error('[' + path + '] ' + d.error.message + ' (code ' + d.error.code + ')');
  return d;
}

async function getIGAccounts(token) {
  const accounts = [];
  try {
    const data = await gql('me/accounts', token, { fields: 'id,name,instagram_business_account', limit: 50 });
    for (const page of (data.data || [])) {
      const ig = page.instagram_business_account;
      if (!ig) continue;
      try {
        const igData = await gql(ig.id, token, { fields: 'id,username,name,followers_count' });
        const match  = KNOWN_ACCOUNTS.find(a => a.handle.toLowerCase() === (igData.username||'').toLowerCase());
        accounts.push({ igId: igData.id, username: igData.username, label: match?.label || igData.name, followers: igData.followers_count || 0 });
      } catch(e) { console.warn('  Erro conta: ' + e.message); }
    }
  } catch(e) { console.warn('  /me/accounts: ' + e.message); }

  if (!accounts.length) {
    try {
      const biz = await gql('me/businesses', token, { fields: 'id,name', limit: 10 });
      for (const b of (biz.data || [])) {
        try {
          const pages = await gql(b.id + '/owned_pages', token, { fields: 'id,name,instagram_business_account', limit: 50 });
          for (const page of (pages.data || [])) {
            const ig = page.instagram_business_account;
            if (!ig) continue;
            const igData = await gql(ig.id, token, { fields: 'id,username,name,followers_count' });
            const match  = KNOWN_ACCOUNTS.find(a => a.handle.toLowerCase() === (igData.username||'').toLowerCase());
            if (!accounts.find(a => a.igId === igData.id))
              accounts.push({ igId: igData.id, username: igData.username, label: match?.label || igData.name, followers: igData.followers_count || 0 });
          }
        } catch(e) {}
      }
    } catch(e) { console.warn('  /me/businesses: ' + e.message); }
  }

  console.log('  ' + accounts.length + ' conta(s): ' + accounts.map(a => '@' + a.username).join(', '));
  return accounts;
}

function mediaTypeLabel(type) {
  if (type === 'VIDEO')          return 'Reel';
  if (type === 'CAROUSEL_ALBUM') return 'Carrossel';
  if (type === 'IMAGE')          return 'Post';
  if (type === 'STORY')          return 'Story';
  return type || 'Post';
}

async function fetchMedia(igId, token, days) {
  const since   = new Date();
  since.setDate(since.getDate() - days);
  const sinceTs = Math.floor(since.getTime() / 1000);
  const fields  = 'id,timestamp,media_type,media_product_type,caption,permalink,thumbnail_url,media_url,like_count,comments_count';
  let url = GRAPH + '/' + igId + '/media?fields=' + fields + '&since=' + sinceTs + '&limit=50&access_token=' + token;
  const all = [];
  while (url) {
    const res = await fetch(url);
    const d   = await res.json();
    if (d.error) { console.warn('  fetchMedia: ' + d.error.message); break; }
    all.push(...(d.data || []));
    url = d.paging?.next || null;
  }
  return all;
}

async function fetchInsights(mediaId, productType, token) {
  /**
   * v25 — Feed posts (IMAGE/CAROUSEL/REELS) requerem period=lifetime
   * Stories requerem period=lifetime também
   *
   * Métricas válidas v25:
   *   Feed/Carrossel: reach, impressions, saved, shares  (+ period=lifetime)
   *   Reels:          reach, impressions, saved, shares, plays, ig_reels_avg_watch_time
   *   Story:          reach, impressions, exits, replies, taps_forward, taps_back
   */

  const isReel  = productType === 'REELS' || productType === 'VIDEO';
  const isStory = productType === 'STORY';

  const out = {};

  async function tryFetch(metrics, extraParams) {
    try {
      const params = new URLSearchParams({
        metric:       metrics,
        access_token: token,
        ...(extraParams || {}),
      }).toString();
      const res = await fetch(GRAPH + '/' + mediaId + '/insights?' + params);
      const d   = await res.json();
      if (!d.error) {
        for (const item of (d.data || [])) {
          const val = item.values?.[0]?.value ?? item.value ?? 0;
          out[item.name] = val;
        }
        return true;
      } else {
        if (d.error.code !== 100 && d.error.code !== 10) {
          console.log('    insight [' + metrics + ']: ' + d.error.message.slice(0, 100));
        }
        return false;
      }
    } catch(e) { return false; }
  }

  if (isStory) {
    await tryFetch('reach,impressions', { period: 'lifetime' });
    await tryFetch('exits,replies,taps_forward,taps_back', { period: 'lifetime' });
  } else if (isReel) {
    // Reels: try with period=lifetime first, then without
    const ok = await tryFetch('reach,impressions', { period: 'lifetime' });
    if (!ok) await tryFetch('reach,impressions', {});
    await tryFetch('saved,shares', { period: 'lifetime' });
    // plays — try multiple metric names
    const playsOk = await tryFetch('plays', { period: 'lifetime' });
    if (!playsOk) {
      const vvOk = await tryFetch('video_views', { period: 'lifetime' });
      if (!vvOk) await tryFetch('ig_reels_video_view_total_time', { period: 'lifetime' });
    }
    if (out.video_views && !out.plays) out.plays = out.video_views;
  } else {
    // Feed posts (IMAGE, CAROUSEL_ALBUM, FEED)
    const ok = await tryFetch('reach,impressions', { period: 'lifetime' });
    if (!ok) await tryFetch('reach,impressions', {});
    await tryFetch('saved,shares', { period: 'lifetime' });
  }

  await new Promise(r => setTimeout(r, 80));
  return out;
}

function buildDoc(media, insights, account) {
  const productType = media.media_product_type || media.media_type || 'IMAGE';
  const likes       = Number(media.like_count     || insights.likes    || 0);
  const comments    = Number(media.comments_count || insights.comments || 0);
  const reach       = Number(insights.reach       || 0);
  const impressions = Number(insights.impressions || 0);
  const saved       = Number(insights.saved       || 0);
  const shares      = Number(insights.shares      || 0);
  const plays       = Number(insights.plays       || 0);
  const engagement  = likes + comments + saved + shares;
  const engRate     = reach > 0 ? Math.round((engagement / reach) * 10000) / 100 : 0;
  const caption     = (media.caption || '').replace(/#\S+/g, '').trim().slice(0, 120);

  if (Object.keys(insights).length === 0 || (reach === 0 && impressions === 0 && Object.keys(insights).length < 2)) {
    console.log('    ⚠ ' + media.id + ' (' + productType + '): sem insights — raw=' + JSON.stringify(insights));
  }

  return {
    accountId:        account.igId,
    accountHandle:    account.username,
    accountName:      account.label,
    mediaId:          media.id,
    mediaType:        mediaTypeLabel(productType),
    mediaProductType: productType,
    permalink:        media.permalink     || null,
    thumbnailUrl:     media.thumbnail_url || media.media_url || null,
    caption,
    postedAt: media.timestamp
      ? admin.firestore.Timestamp.fromDate(new Date(media.timestamp))
      : null,
    reach, impressions, likes, comments, saved, shares, plays,
    follows:         0,
    profileVisits:   0,
    engagement,
    engagementRate:  engRate,
    exits:       Number(insights.exits        || 0),
    replies:     Number(insights.replies      || 0),
    tapsForward: Number(insights.taps_forward || 0),
    tapsBack:    Number(insights.taps_back    || 0),
    syncedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function main() {
  console.log('\n📸 PRIMETOUR — Meta Instagram Sync (v25)');
  console.log('   Período: últimos ' + SYNC_DAYS + ' dias\n');

  try {
    const me = await gql('me', ACCESS_TOKEN, { fields: 'id,name' });
    console.log('  Token válido -> id:' + me.id + ' name:"' + me.name + '"');
  } catch(e) { console.error('  Token inválido: ' + e.message); process.exit(1); }

  const igAccounts = await getIGAccounts(ACCESS_TOKEN);
  if (!igAccounts.length) { console.error('Nenhuma conta encontrada.'); process.exit(1); }
  console.log('\n  Contas: ' + igAccounts.map(a => '@' + a.username + ' (' + a.igId + ')').join(', ') + '\n');

  const summary = [];
  let totalPosts = 0;

  for (const account of igAccounts) {
    console.log('📷 @' + account.username + ' — ' + account.label);
    try {
      const mediaList = await fetchMedia(account.igId, ACCESS_TOKEN, SYNC_DAYS);
      console.log('   ' + mediaList.length + ' posts encontrados');
      if (!mediaList.length) { summary.push('@' + account.username + ' (0)'); continue; }

      let batch = db.batch(), batchSize = 0, written = 0, withData = 0;

      for (const media of mediaList) {
        const productType = media.media_product_type || media.media_type || 'IMAGE';
        const insights    = await fetchInsights(media.id, productType, ACCESS_TOKEN);
        if (insights.reach > 0 || insights.impressions > 0 || insights.saved > 0) withData++;
        const doc   = buildDoc(media, insights, account);
        const docId = account.igId + '_' + media.id;
        batch.set(db.collection('meta_performance').doc(docId), doc, { merge: true });
        batchSize++; written++;
        if (batchSize >= 499) { await batch.commit(); batch = db.batch(); batchSize = 0; }
        await new Promise(r => setTimeout(r, 250));
      }

      if (batchSize > 0) await batch.commit();
      console.log('   ✓ ' + written + ' posts salvos (' + withData + ' com insights preenchidos)');
      summary.push('@' + account.username + ' (' + written + ')');
      totalPosts += written;

    } catch(e) { console.error('   ERRO: ' + e.message); }
  }

  for (const acc of igAccounts) {
    try {
      await db.collection('meta_accounts').doc(acc.igId).set({
        igId: acc.igId, username: acc.username, label: acc.label,
        followers: acc.followers, syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch(e) {}
  }

  console.log('\n─────────────────────────────────────────');
  console.log('✅ ' + summary.join(' · '));
  console.log('📊 Total: ' + totalPosts + ' posts sincronizados\n');
}

main().catch(e => { console.error('Erro fatal:', e); process.exit(1); });
