/**
 * PRIMETOUR — Meta Instagram → Firestore Sync
 * Graph API v19 — métricas corretas por tipo de mídia
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
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || '';
const SYNC_DAYS    = parseInt(process.env.SYNC_DAYS) || 90;
const GRAPH        = 'https://graph.facebook.com/v19.0';

const KNOWN_ACCOUNTS = [
  { handle: 'primetourviagens', label: 'Primetour Viagens' },
  { handle: 'icsbyprimetour',   label: 'ICs by Primetour'  },
];

/* ─── Graph API helper ────────────────────────────────────── */
async function gql(path, token, params = {}) {
  const qs  = new URLSearchParams({ access_token: token, ...params }).toString();
  const res  = await fetch(`${GRAPH}/${path}?${qs}`);
  const data = await res.json();
  if (data.error) throw new Error(`[${path}] ${data.error.message} (code ${data.error.code})`);
  return data;
}

/* ─── Descobrir contas IG ─────────────────────────────────── */
async function getIGAccounts(token) {
  const accounts = [];
  try {
    const data = await gql('me/accounts', token, {
      fields: 'id,name,instagram_business_account',
      limit: 50,
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
      } catch(e) { console.warn(`  Erro ao detalhar conta: ${e.message}`); }
    }
  } catch(e) { console.warn(`  /me/accounts falhou: ${e.message}`); }

  if (!accounts.length) {
    // Fallback: /me/businesses
    try {
      const biz = await gql('me/businesses', token, { fields: 'id,name', limit: 10 });
      for (const b of (biz.data || [])) {
        const pages = await gql(`${b.id}/owned_pages`, token, {
          fields: 'id,name,instagram_business_account', limit: 50,
        });
        for (const page of (pages.data || [])) {
          const ig = page.instagram_business_account;
          if (!ig) continue;
          const igData = await gql(ig.id, token, { fields: 'id,username,name,followers_count' });
          const match  = KNOWN_ACCOUNTS.find(a => a.handle.toLowerCase() === (igData.username||'').toLowerCase());
          if (!accounts.find(a => a.igId === igData.id)) {
            accounts.push({ igId: igData.id, username: igData.username, label: match?.label || igData.name, followers: igData.followers_count || 0 });
          }
        }
      }
    } catch(e) { console.warn(`  /me/businesses falhou: ${e.message}`); }
  }

  console.log(`  ${accounts.length} conta(s): ${accounts.map(a=>'@'+a.username).join(', ')}`);
  return accounts;
}

/* ─── Media type ──────────────────────────────────────────── */
function mediaTypeLabel(type) {
  if (type === 'VIDEO')          return 'Reel';
  if (type === 'CAROUSEL_ALBUM') return 'Carrossel';
  if (type === 'IMAGE')          return 'Post';
  if (type === 'STORY')          return 'Story';
  return type || 'Post';
}

/* ─── Fetch media list ────────────────────────────────────── */
async function fetchMedia(igId, token, days) {
  const since   = new Date();
  since.setDate(since.getDate() - days);
  const sinceTs = Math.floor(since.getTime() / 1000);
  const fields  = 'id,timestamp,media_type,media_product_type,caption,permalink,thumbnail_url,media_url,like_count,comments_count';

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

/* ─── Fetch insights — métricas corretas por tipo ────────── */
async function fetchInsights(mediaId, productType, token) {
  /**
   * Graph API v19 — métricas válidas por tipo:
   *
   * IMAGE / CAROUSEL_ALBUM (Feed posts):
   *   reach, impressions, saved, likes, comments, shares, follows, profile_visits
   *   (nota: "follows" e "profile_visits" só disponíveis em contas com >100 seguidores)
   *
   * VIDEO (Reels):
   *   reach, impressions, plays, saved, likes, comments, shares, follows, profile_visits
   *   (Reels usam "ig_reels_video_view_total_time" e "ig_reels_avg_watch_time" extras)
   *
   * STORY:
   *   reach, impressions, exits, replies, taps_forward, taps_back
   *   (stories NÃO têm saved/likes/shares)
   */

  const isReel  = productType === 'REELS'  || productType === 'VIDEO';
  const isStory = productType === 'STORY';

  let primaryMetrics;
  if (isStory) {
    primaryMetrics = ['reach','impressions','exits','replies','taps_forward','taps_back'];
  } else if (isReel) {
    primaryMetrics = ['reach','impressions','plays','saved','likes','comments','shares','follows','profile_visits'];
  } else {
    // IMAGE, CAROUSEL_ALBUM, outros
    primaryMetrics = ['reach','impressions','saved','likes','comments','shares','follows','profile_visits'];
  }

  const out = {};

  // Busca primária — tenta todos os metrics de uma vez
  try {
    const url  = `${GRAPH}/${mediaId}/insights?metric=${primaryMetrics.join(',')}&access_token=${token}`;
    const res  = await fetch(url);
    const data = await res.json();

    if (!data.error) {
      for (const item of (data.data || [])) {
        out[item.name] = item.values?.[0]?.value ?? item.value ?? 0;
      }
      return out;
    }

    // Se falhou em bloco, tenta métrica por métrica para isolar quais funcionam
    console.log(`   Insights em bloco falhou (${data.error.message.slice(0,60)}), tentando individualmente...`);
  } catch(e) { /* tenta individual */ }

  // Busca individual — ignora as que falharem
  for (const metric of primaryMetrics) {
    try {
      const url  = `${GRAPH}/${mediaId}/insights?metric=${metric}&access_token=${token}`;
      const res  = await fetch(url);
      const data = await res.json();
      if (!data.error && data.data?.length) {
        const item = data.data[0];
        out[item.name] = item.values?.[0]?.value ?? item.value ?? 0;
      }
    } catch(e) { /* métrica não disponível */ }
  }

  return out;
}

/* ─── Build Firestore doc ─────────────────────────────────── */
function buildDoc(media, insights, account) {
  const productType = media.media_product_type || media.media_type || 'IMAGE';

  const likes       = Number(media.like_count     || insights.likes       || 0);
  const comments    = Number(media.comments_count || insights.comments    || 0);
  const reach       = Number(insights.reach       || 0);
  const impressions = Number(insights.impressions || 0);
  const saved       = Number(insights.saved       || 0);
  const shares      = Number(insights.shares      || 0);
  const plays       = Number(insights.plays       || 0);
  const follows     = Number(insights.follows     || 0);
  const profileVisits = Number(insights.profile_visits || 0);

  const engagement = likes + comments + saved + shares;
  const engRate    = reach > 0 ? Math.round((engagement / reach) * 10000) / 100 : 0;
  const caption    = (media.caption || '').replace(/#\S+/g, '').trim().slice(0, 120);

  // Log resumido para diagnóstico
  if (reach === 0 && impressions === 0) {
    console.log(`   ⚠ ${media.id} (${productType}): insights vazios — ${JSON.stringify(insights)}`);
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
    follows, profileVisits, engagement, engagementRate: engRate,
    // Story-specific
    exits:       Number(insights.exits        || 0),
    replies:     Number(insights.replies      || 0),
    tapsForward: Number(insights.taps_forward || 0),
    tapsBack:    Number(insights.taps_back    || 0),
    syncedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

/* ─── Main ────────────────────────────────────────────────── */
async function main() {
  console.log(`\n📸 PRIMETOUR — Meta Instagram Sync`);
  console.log(`   Período: últimos ${SYNC_DAYS} dias\n`);

  // Verificar token
  try {
    const me = await gql('me', ACCESS_TOKEN, { fields: 'id,name' });
    console.log(`  Token válido → id:${me.id} name:"${me.name}"`);
  } catch(e) {
    console.error(`  Token inválido: ${e.message}`); process.exit(1);
  }

  const igAccounts = await getIGAccounts(ACCESS_TOKEN);
  if (!igAccounts.length) {
    console.error('❌ Nenhuma conta encontrada.'); process.exit(1);
  }
  console.log(`\n  Contas: ${igAccounts.map(a=>`@${a.username} (${a.igId})`).join(', ')}\n`);

  const summary = { success: [], total: 0 };

  for (const account of igAccounts) {
    console.log(`📷 @${account.username} — ${account.label}`);
    try {
      const mediaList = await fetchMedia(account.igId, ACCESS_TOKEN, SYNC_DAYS);
      console.log(`   ${mediaList.length} posts encontrados`);
      if (!mediaList.length) { summary.success.push(`@${account.username} (0)`); continue; }

      let batch = db.batch(), batchSize = 0, written = 0;
      let withInsights = 0;

      for (const media of mediaList) {
        const productType = media.media_product_type || media.media_type || 'IMAGE';
        const insights    = await fetchInsights(media.id, productType, ACCESS_TOKEN);
        if (Object.keys(insights).length > 0) withInsights++;

        const doc   = buildDoc(media, insights, account);
        const docId = `${account.igId}_${media.id}`;
        batch.set(db.collection('meta_performance').doc(docId), doc, { merge: true });
        batchSize++; written++;

        if (batchSize >= 499) { await batch.commit(); batch = db.batch(); batchSize = 0; }
        await new Promise(r => setTimeout(r, 250));
      }

      if (batchSize > 0) await batch.commit();
      console.log(`   ✓ ${written} posts salvos (${withInsights} com insights)`);
      summary.success.push(`@${account.username} (${written})`);
      summary.total += written;

    } catch(e) {
      console.error(`   ✗ ERRO: ${e.message}`);
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
  console.log(`✅ ${summary.success.join(' · ')}`);
  console.log(`📊 Total: ${summary.total} posts sincronizados\n`);
}

main().catch(e => { console.error('Erro fatal:', e); process.exit(1); });
