/**
 * Backfill v4.50.1 — Heroes pros 2 PDFs seed do Banco de Roteiros.
 *
 * Pra cada doc sem images.hero:
 *   1. Busca em portal_images por (city, country) com assetCategory='location'
 *   2. Fallback: Unsplash via API direta com key do Secret Manager (UNSPLASH_ACCESS_KEY)
 *   3. Persiste no doc com `heroSource` e `heroAttribution`
 */
const admin = require('firebase-admin');
const { execSync } = require('child_process');

admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

function slugify(s) {
  return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function getUnsplashKey() {
  const out = execSync('gcloud secrets versions access latest --secret=UNSPLASH_ACCESS_KEY --project=gestor-de-tarefas-primetour', { encoding: 'utf8' });
  return out.trim();
}

async function findInPortalImages(city, country) {
  if (!city || !country) return null;
  const snap = await db.collection('portal_images')
    .where('country', '==', country)
    .limit(50)
    .get();
  const cityKey = slugify(city);
  const match = snap.docs.find(d => {
    const data = d.data();
    if (data.assetCategory && data.assetCategory !== 'location') return false;
    return slugify(data.city || '') === cityKey;
  });
  if (!match) return null;
  const data = match.data();
  const url = data.imageUrl || data.url || data.r2Url || null;
  return url ? { url, source: 'portal_images', attribution: data.copyright || '' } : null;
}

async function findInUnsplash(city, country, accessKey) {
  const q = encodeURIComponent([city, country].filter(Boolean).join(', '));
  const res = await fetch(`https://api.unsplash.com/search/photos?query=${q}&per_page=1&orientation=landscape`, {
    headers: { Authorization: `Client-ID ${accessKey}` },
  });
  if (!res.ok) throw new Error('Unsplash ' + res.status);
  const d = await res.json();
  const first = d.results?.[0];
  if (!first) return null;
  return {
    url: first.urls?.regular || first.urls?.full || null,
    source: 'unsplash',
    attribution: `Photo by ${first.user?.name || 'Unknown'} on Unsplash`,
  };
}

(async () => {
  const accessKey = getUnsplashKey();
  const snap = await db.collection('roteiros_bank').get();
  console.log(`Found ${snap.size} bank docs`);

  for (const d of snap.docs) {
    const data = d.data();
    if (data.images?.hero) {
      console.log(`= ${d.id} "${(data.title||'').slice(0,40)}" já tem hero — skip`);
      continue;
    }
    const firstCity = data.geo?.cities?.[0];
    if (!firstCity?.city) {
      console.log(`! ${d.id} sem city[0] — skip`);
      continue;
    }
    console.log(`\n→ ${d.id} "${(data.title||'').slice(0,50)}"`);
    console.log(`   city=${firstCity.city} country=${firstCity.country}`);

    let hero = await findInPortalImages(firstCity.city, firstCity.country);
    if (hero) {
      console.log(`   ✓ portal_images: ${hero.url.slice(0,60)}…`);
    } else {
      console.log(`   ⤴ portal_images vazio — tentando Unsplash…`);
      try {
        hero = await findInUnsplash(firstCity.city, firstCity.country, accessKey);
        if (hero) console.log(`   ✓ unsplash: ${hero.url.slice(0,60)}…`);
        else      console.log(`   ⚠ Unsplash sem resultados`);
      } catch (e) {
        console.log(`   ✗ Unsplash falhou: ${e.message}`);
      }
    }

    if (!hero?.url) {
      console.log(`   ⚠ nada achado — skip`);
      continue;
    }

    await d.ref.update({
      images: { ...(data.images||{}), hero: hero.url, heroSource: hero.source, heroAttribution: hero.attribution },
      updatedAt: FV.serverTimestamp(),
    });
    console.log(`   ✅ persisted`);
  }
  console.log('\ndone.');
  process.exit(0);
})();
