/**
 * BTG Photo Search — busca de foto de destino (fallback online).
 *
 * Quando o banco curado não tem foto do destino, o usuário pode buscar
 * uma foto representativa online. Em produção isso usa a Cloud Function
 * `fetchDestinationPhoto` do Gestor (Unsplash → fallback Wikipedia, com
 * cache em `photo_cache`).
 *
 * A Cloud Function tem CORS/auth restritos ao projeto de produção — a
 * mesma amarra do `callLLM` (ver Fase 3 / btg-ai.js). Por isso, em
 * staging este módulo devolve uma amostra de fotos-modelo, pra validar
 * a UX sem custo. Em produção, plugado automaticamente por hostname.
 */

function isStaging() {
  const h = window.location.hostname;
  return h === 'gestor-btg-lp-builder-staging.web.app'
    || h === 'localhost'
    || h === '127.0.0.1';
}

/* Amostra pro staging — imagens reais já versionadas no repo BTG.
 * Em produção a busca real (Unsplash) substitui isto. */
const MOCK_PHOTOS = [
  '/btg/assets/parceiros/four-seasons-bora-bora.jpg',
  '/btg/assets/parceiros/st-regis-maldives.jpg',
  '/btg/assets/parceiros/four-seasons-george-v.jpg',
  '/btg/assets/parceiros/amanyangyun-shanghai.jpg',
  '/btg/assets/parceiros/mandarin-oriental-bangkok.jpg',
  '/btg/assets/parceiros/mandarin-oriental-tokyo.jpg',
  '/btg/assets/parceiros/six-senses-bhutan.jpg',
  '/btg/assets/parceiros/six-senses-ibiza.jpg',
  '/btg/assets/parceiros/st-regis-venice.jpg',
  '/btg/assets/parceiros/amangiri-utah.jpg',
  '/btg/assets/parceiros/rosewood-mansion.jpg',
  '/btg/assets/parceiros/rosewood-sand-hill.jpg',
].map((url) => ({ url, author: 'Amostra — staging' }));

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─── Cliente real (produção) — chama fetchDestinationPhoto ──── */
async function searchPhotosReal(query) {
  const { getApps, initializeApp } = await import(
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'
  );
  const { getFunctions, httpsCallable } = await import(
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js'
  );

  // App de produção (mesmo padrão de btg-ai.js — reaproveita 'btg-prod-app').
  const PROD_CONFIG = { projectId: 'gestor-de-tarefas-primetour' };
  const existing = getApps().find((a) => a.name === 'btg-prod-app');
  const app = existing || initializeApp(PROD_CONFIG, 'btg-prod-app');

  const functions = getFunctions(app, 'us-central1');
  const fetchDestinationPhoto = httpsCallable(functions, 'fetchDestinationPhoto');

  const res = await fetchDestinationPhoto({ query, count: 12 });
  const d = res.data || {};
  // count > 1 → { urls, sources, attributions }; count === 1 → { url, attribution }
  if (Array.isArray(d.urls)) {
    return d.urls.map((url, i) => ({ url, author: d.attributions?.[i] || '' }));
  }
  if (d.url) return [{ url: d.url, author: d.attribution || '' }];
  return [];
}

/* ─── API pública ─────────────────────────────────────────────
 * Busca fotos de um destino pelo nome.
 * @param {string} query  Nome do destino (ex: 'Paris', 'Maldivas').
 * @returns {Promise<{ photos: Array<{url, author}>, mock?: boolean }>}
 */
export async function searchPhotos(query) {
  const q = String(query || '').trim();
  if (!q) return { photos: [] };

  if (isStaging()) {
    await delay(500); // simula latência da busca real
    return { photos: MOCK_PHOTOS, mock: true };
  }
  const photos = await searchPhotosReal(q);
  return { photos };
}

export { isStaging };
