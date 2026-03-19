/**
 * PRIMETOUR — Meta Instagram -> Firestore Sync
 * Graph API v25.0 — métricas validadas empiricamente
 *
 * v22+ breaking changes:
 *   - impressions removido de posts de feed (IMAGE, CAROUSEL, REELS)
 *   - reach requer period=lifetime
 *   - saved, shares requerem period=lifetime
 *   - Reels: plays requer period=lifetime
 *   - Stories: mantêm reach + impressions + taps/exits
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

/* ─── Graph helper ────────────────────────────────────────── */
async function gql(path, token, params) {
  const p   = new URLSearchParams({ access_token: token, ...(params||{}) }).toString();
  const res = await fetch(GRAPH + '/' + path + '?' + p);
  const d   = await res.json();
  if (d.error) throw new Error('[' + path + '] ' + d.error.message + ' (code ' + d.error.code + ')');
  return d;
}

/* ─── Descobrir contas ────────────────────────────────────── */
async function getIGAccounts(token) {
  const accounts = [];
  try {
    const data = await gql('me/accounts', token, {
      fields: 'id,name,instagram_business_account', limit: 50,
    });
    for (const page of (data.data || [])) {
      const ig = page.instagram_business_account;
      if (!ig) continue;
      try {
        const igData = await gql(ig.id, token, { fields: 'id,username,name,followers_count' });
        const match  = KNOWN_ACCOUNTS.find(a => a.handle.toLowerCase() === (igData.username||'').toLowerCase());
        accounts.push({ igId: igData.id, username: igData.username, label: match?.label || igData.name, followers: igData.followers_count || 0 });
      } catch(e) { console.warn('  Erro conta: ' + e.message); }
    }
  } catch(e) {
    console.warn('  /me/accounts: ' + e.message);
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

/* ─── Media type ──────────────────────────────────────────── */
function mediaTypeLabel(type) {
  if (type === 'VIDEO')          return 'Reel';
  if (type === 'CAROUSEL_ALBUM') return 'Carrossel';
  if (type === 'IMAGE')          return 'Post';
  if (type === 'STORY')          return 'Story';
  if (type === 'REELS')          return 'Reel';
  if (type === 'FEED')           return 'Post'; // fallback for ambiguous FEED type
  return type || 'Post';
}

/* ─── Fetch media list ────────────────────────────────────── */
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

/* ─── Fetch stories (endpoint separado, últimas 24h visíveis) ─ */
async function fetchStories(igId, token) {
  // /stories retorna apenas stories ativos (últimas 24h)
  // media_product_type pode vir como null ou 'FEED' — forçamos 'STORY'
  const fields = 'id,timestamp,media_type,media_product_type,caption,permalink,thumbnail_url,media_url';
  try {
    const url = GRAPH + '/' + igId + '/stories?fields=' + fields + '&limit=50&access_token=' + token;
    console.log('   fetching stories: /' + igId + '/stories');
    const res = await fetch(url);
    const d   = await res.json();
    if (d.error) {
      console.log('   stories ERR ' + d.error.code + ': ' + d.error.message.slice(0, 120));
      return [];
    }
    const items = d.data || [];
    console.log('   /stories retornou ' + items.length + ' item(s)');
    if (items.length > 0) console.log('   primeiro item raw: ' + JSON.stringify(items[0]).slice(0, 200));
    // Force media_product_type = 'STORY' — API may return null or 'FEED' for stories
    return items.map(s => ({
      ...s,
      media_product_type: 'STORY',
      media_type:         'STORY',
      like_count:         0,
      comments_count:     0,
    }));
  } catch(e) { console.log('   stories exception: ' + e.message); return []; }
}

/* ─── Fetch one metric safely ─────────────────────────────── */
async function fetchMetric(mediaId, metric, token, verbose) {
  try {
    const params = new URLSearchParams({
      metric,
      period:       'lifetime',
      access_token: token,
    }).toString();
    const res = await fetch(GRAPH + '/' + mediaId + '/insights?' + params);
    const d   = await res.json();
    if (d.error) {
      if (verbose) console.log('     metric [' + metric + '] ERR ' + d.error.code + ': ' + d.error.message.slice(0, 100));
      return null;
    }
    const item = d.data?.[0];
    if (!item) { if (verbose) console.log('     metric [' + metric + '] empty response'); return null; }
    const val = item.values?.[0]?.value ?? item.value ?? null;
    if (verbose) console.log('     metric [' + metric + '] = ' + val);
    return val;
  } catch(e) { return null; }
}

/* ─── Fetch insights ──────────────────────────────────────── */
async function fetchInsights(mediaId, productType, token) {
  const isReel  = productType === 'REELS' || productType === 'VIDEO';
  const isStory = productType === 'STORY';
  const out     = {};

  if (isStory) {
    // v25 story metrics: reach, replies, navigation, saved, profile_visits
    // removed in v22+: impressions, exits, taps_forward, taps_back
    // 'navigation' replaces exits/taps and returns a breakdown object
    for (const m of ['reach', 'replies', 'saved']) {
      const v = await fetchMetric(mediaId, m, token);
      if (v !== null) out[m] = v;
      await new Promise(r => setTimeout(r, 60));
    }
    // navigation returns {SWIPE_FORWARD, TAP_FORWARD, TAP_BACK, TAP_EXIT}
    try {
      const params = new URLSearchParams({
        metric: 'navigation', period: 'lifetime', access_token: token,
      }).toString();
      const res = await fetch(GRAPH + '/' + mediaId + '/insights?' + params);
      const d   = await res.json();
      if (!d.error && d.data?.[0]) {
        const nav = d.data[0].values?.[0]?.value ?? d.data[0].value ?? {};
        if (typeof nav === 'object') {
          out.taps_forward = (nav.TAP_FORWARD  || 0) + (nav.SWIPE_FORWARD || 0);
          out.taps_back    = nav.TAP_BACK  || 0;
          out.exits        = nav.TAP_EXIT  || 0;
        }
      }
    } catch(e) {}
  } else if (isReel) {
    // Reels v25: reach ✓ | impressions ✗ (removed) | saved ✓ | shares ✓ | plays ✓
    for (const m of ['reach', 'saved', 'shares', 'plays']) {
      const v = await fetchMetric(mediaId, m, token);
      if (v !== null) out[m] = v;
      await new Promise(r => setTimeout(r, 60));
    }
    // Fallback for plays
    if (out.plays == null) {
      const v = await fetchMetric(mediaId, 'video_views', token);
      if (v !== null) out.plays = v;
    }
  } else {
    // Feed posts (IMAGE, CAROUSEL_ALBUM, FEED) v25:
    // reach ✓ | impressions ✗ (removed v22+) | saved ✓ | shares ✓
    for (const m of ['reach', 'saved', 'shares']) {
      const v = await fetchMetric(mediaId, m, token);
      if (v !== null) out[m] = v;
      await new Promise(r => setTimeout(r, 60));
    }
  }

  return out;
}

/* ─── Build Firestore doc ─────────────────────────────────── */
function buildDoc(media, insights, account) {
  const productType = media.media_product_type || media.media_type || 'IMAGE';
  const likes       = Number(media.like_count     || 0);
  const comments    = Number(media.comments_count || 0);
  const reach       = Number(insights.reach       ?? 0);
  const impressions = Number(insights.impressions ?? 0); // só stories
  const saved       = Number(insights.saved       ?? 0);
  const shares      = Number(insights.shares      ?? 0);
  const plays       = Number(insights.plays       ?? 0);
  const engagement  = likes + comments + saved + shares;
  const engRate     = reach > 0 ? Math.round((engagement / reach) * 10000) / 100 : 0;
  const caption     = (media.caption || '').replace(/#\S+/g, '').trim().slice(0, 120);

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
    follows:        0,
    profileVisits:  0,
    engagement,
    engagementRate: engRate,
    exits:       Number(insights.exits        ?? 0),
    replies:     Number(insights.replies      ?? 0),
    tapsForward: Number(insights.taps_forward ?? 0),
    tapsBack:    Number(insights.taps_back    ?? 0),
    syncedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

/* ─── Main ────────────────────────────────────────────────── */
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
      const mediaList   = await fetchMedia(account.igId, ACCESS_TOKEN, SYNC_DAYS);
      const storiesList = await fetchStories(account.igId, ACCESS_TOKEN);
      // Merge stories into media list, avoiding duplicates
      const seenIds = new Set(mediaList.map(m => m.id));
      for (const s of storiesList) {
        if (!seenIds.has(s.id)) mediaList.push(s);
      }
      console.log('   ' + mediaList.length + ' posts encontrados (' + storiesList.length + ' stories ativos)');
      if (!mediaList.length) { summary.push('@' + account.username + ' (0)'); continue; }

      let batch = db.batch(), batchSize = 0, written = 0, withReach = 0, firstStoryLogged = false;

      for (const media of mediaList) {
        const productType = media.media_product_type || media.media_type || 'IMAGE';
        const insights    = await fetchInsights(media.id, productType, ACCESS_TOKEN);
        if ((insights.reach ?? 0) > 0) withReach++;
        // Log first story for verification
        if (productType === 'STORY' && !firstStoryLogged) {
          firstStoryLogged = true;
          console.log('   first story insights: reach=' + (insights.reach||0) +
            ' replies=' + (insights.replies||0) +
            ' tapsForward=' + (insights.taps_forward||0) +
            ' tapsBack=' + (insights.taps_back||0) +
            ' exits=' + (insights.exits||0) +
            ' saved=' + (insights.saved||0));
        }
        const doc   = buildDoc(media, insights, account);
        const docId = account.igId + '_' + media.id;
        // Stories: force full overwrite so navigation metrics replace old zeros
        // Posts/Reels: merge to preserve any extra fields
        const batchOpts = productType === 'STORY' ? {} : { merge: true };
        batch.set(db.collection('meta_performance').doc(docId), doc, batchOpts);
        batchSize++; written++;
        if (batchSize >= 499) { await batch.commit(); batch = db.batch(); batchSize = 0; }
        await new Promise(r => setTimeout(r, 150));
      }

      if (batchSize > 0) await batch.commit();
      console.log('   ✓ ' + written + ' posts salvos (' + withReach + ' com reach > 0)');
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
