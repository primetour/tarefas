/**
 * Pré-popula portal_destinations._geo via Nominatim pra agilizar mapa.
 * Roda 1 req/s (rate limit OSM). ~25s pra 20 destinos.
 * Idempotente — só geocoda destinos com dicas e sem _geo.
 */
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const UA = 'PRIMETOUR-MapPrefill/1.0 (admin@primetour.com.br)';

async function geocode(city, country) {
  const q = encodeURIComponent(`${city}, ${country}`);
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&accept-language=pt-BR`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const arr = await r.json();
  if (!arr.length) return null;
  return { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon) };
}

(async () => {
  console.log('\n=== PREFILL GEO CACHE ===\n');

  // 1. Quais destinos têm dicas?
  const tipsSnap = await db.collection('portal_tips').get();
  const destIds = new Set();
  tipsSnap.forEach(d => { if (d.data().destinationId) destIds.add(d.data().destinationId); });
  console.log(`[1] ${destIds.size} destinos com dicas`);

  // 2. Filtrar os que JÁ TÊM _geo
  const targets = [];
  for (const id of destIds) {
    const snap = await db.collection('portal_destinations').doc(id).get();
    if (!snap.exists) continue;
    const d = snap.data();
    if (d._geo?.lat && d._geo?.lng) continue;  // já tem
    if (!d.city || !d.country) continue;       // dados faltando
    targets.push({ id, city: d.city, country: d.country });
  }
  console.log(`[2] ${targets.length} sem _geo (vão geocodar)`);

  if (!targets.length) { console.log('Nada pra fazer.'); process.exit(0); }

  // 3. Geocodar 1/s
  let ok = 0, fail = 0;
  for (const t of targets) {
    try {
      const coords = await geocode(t.city, t.country);
      if (coords) {
        await db.collection('portal_destinations').doc(t.id).update({
          _geo: { ...coords, source: 'nominatim', cachedAt: admin.firestore.FieldValue.serverTimestamp() },
        });
        console.log(`  ✓ ${t.city.padEnd(25)} ${t.country.padEnd(20)} → ${coords.lat.toFixed(3)}, ${coords.lng.toFixed(3)}`);
        ok++;
      } else {
        console.log(`  · ${t.city.padEnd(25)} ${t.country.padEnd(20)} → sem resultado`);
        fail++;
      }
    } catch (e) {
      console.log(`  ✗ ${t.city.padEnd(25)} ${t.country.padEnd(20)} → ${e.message}`);
      fail++;
    }
    await new Promise(r => setTimeout(r, 1100));  // rate limit OSM
  }

  console.log(`\n✓ ${ok} geocodados, ${fail} falhas.\n`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
