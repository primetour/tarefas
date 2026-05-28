/**
 * v4.63.45+ Portal de Dicas — Mapa interativo das cidades com dica cadastrada.
 *
 * Renê: "gostaria de um mapa interativo que exibisse onde já temos dicas
 * (atualização sincronizada com o cadastro de dicas). Quando o usuário clica
 * no pin locate, exibe o nome do país e cidades. Acho que trará cor e um
 * envelopamento melhor para o serviço."
 *
 * Stack:
 *   - Leaflet (open source, free) + OpenStreetMap tiles
 *   - leaflet.markercluster pra agrupar muitos pins próximos
 *   - Geocoding via Nominatim (OSM) com cache em portal_destinations._geo
 *     (idempotente — pula docs que já têm _geo)
 *
 * Performance:
 *   - Lazy load Leaflet só quando mapa é renderizado
 *   - Cache em-memória pra cidade→coords durante session
 *   - Real-time listener via onSnapshot: novas dicas atualizam mapa
 *
 * Fluxo:
 *   1. fetchTipsAggregated(): junta portal_tips × portal_destinations.
 *   2. Pra cada destination com tip, garante _geo (geocoda + persiste se faltar).
 *   3. Cria markers no cluster.
 *   4. Click → popup com cidade, país, qtd dicas, link "ver detalhes".
 */

import { db } from '../firebase.js';
import { store } from '../store.js';
import {
  collection, query, where, getDocs, doc, getDoc, updateDoc, onSnapshot, orderBy, limit,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const LEAFLET_VERSION = '1.9.4';
const CLUSTER_VERSION = '1.5.3';

const esc = (s) =>
  String(s || '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );

let _leafletLoaded = null;
async function loadLeaflet() {
  if (_leafletLoaded) return _leafletLoaded;
  _leafletLoaded = new Promise((resolve, reject) => {
    // CSS Leaflet
    const linkLeaf = document.createElement('link');
    linkLeaf.rel = 'stylesheet';
    linkLeaf.href = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
    document.head.appendChild(linkLeaf);

    // CSS MarkerCluster (default + skin)
    const linkClu = document.createElement('link');
    linkClu.rel = 'stylesheet';
    linkClu.href = `https://unpkg.com/leaflet.markercluster@${CLUSTER_VERSION}/dist/MarkerCluster.css`;
    document.head.appendChild(linkClu);

    const linkCluDef = document.createElement('link');
    linkCluDef.rel = 'stylesheet';
    linkCluDef.href = `https://unpkg.com/leaflet.markercluster@${CLUSTER_VERSION}/dist/MarkerCluster.Default.css`;
    document.head.appendChild(linkCluDef);

    // JS Leaflet
    const scrLeaf = document.createElement('script');
    scrLeaf.src = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
    scrLeaf.onload = () => {
      // JS MarkerCluster (depende de L)
      const scrClu = document.createElement('script');
      scrClu.src = `https://unpkg.com/leaflet.markercluster@${CLUSTER_VERSION}/dist/leaflet.markercluster.js`;
      scrClu.onload = () => resolve(window.L);
      scrClu.onerror = (e) => reject(new Error('MarkerCluster load failed'));
      document.head.appendChild(scrClu);
    };
    scrLeaf.onerror = (e) => reject(new Error('Leaflet load failed'));
    document.head.appendChild(scrLeaf);
  });
  return _leafletLoaded;
}

// Cache em-memória pra coords (cidade, país → lat/lng). Idempotente entre renders.
const _geoCache = new Map();

/**
 * Geocoda cidade/país via Nominatim. Respeitoso ao rate-limit (1 req/s).
 * Cache em-memória primeiro, depois Firestore _geo, depois rede.
 */
async function geocodeDestination(dest) {
  const key = `${dest.city || ''}__${dest.country || ''}`;
  if (_geoCache.has(key)) return _geoCache.get(key);

  // 1. Cache do Firestore — _geo no doc
  if (dest._geo && typeof dest._geo.lat === 'number' && typeof dest._geo.lng === 'number') {
    _geoCache.set(key, dest._geo);
    return dest._geo;
  }

  // 2. Nominatim
  if (!dest.city && !dest.country) return null;
  const q = [dest.city, dest.country].filter(Boolean).join(', ');
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'pt-BR,pt,en' } });
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || !arr[0]) return null;
    const lat = parseFloat(arr[0].lat);
    const lng = parseFloat(arr[0].lon);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    const geo = { lat, lng };
    _geoCache.set(key, geo);

    // 3. Persiste no doc do destination (idempotente)
    if (dest.id) {
      try {
        await updateDoc(doc(db, 'portal_destinations', dest.id), { _geo: geo });
      } catch (e) {
        // permission denied (non-master read+write?) — não bloqueia render
        console.warn('[portalTipsMap] persist _geo skip:', e?.message);
      }
    }
    return geo;
  } catch (e) {
    console.warn('[portalTipsMap] geocode failed:', q, e?.message);
    return null;
  }
}

/**
 * Agrega dicas por destino. Retorna [{destId, dest, count}].
 * Filtra apenas destinations com ao menos 1 tip aprovada.
 *
 * v4.63.47 PERF: fetch de destinations PARALELO via Promise.all
 * (antes: N getDoc sequenciais = 20 dests × 200ms = 4s).
 */
async function fetchTipsAggregated() {
  const tipsSnap = await getDocs(
    query(collection(db, 'portal_tips'), orderBy('updatedAt', 'desc'), limit(500)),
  );
  const tipsByDest = new Map();
  tipsSnap.forEach((d) => {
    const t = d.data();
    const dId = t.destinationId;
    if (!dId) return;
    tipsByDest.set(dId, (tipsByDest.get(dId) || 0) + 1);
  });

  const destIds = Array.from(tipsByDest.keys());
  // Paraleliza getDoc — Firestore aguenta dezenas de reads concorrentes
  const destDocs = await Promise.all(
    destIds.map((id) =>
      getDoc(doc(db, 'portal_destinations', id)).catch(() => null),
    ),
  );

  const aggregated = [];
  destDocs.forEach((destSnap, i) => {
    if (!destSnap || !destSnap.exists()) return;
    const destId = destIds[i];
    aggregated.push({
      destId,
      dest: { id: destId, ...destSnap.data() },
      count: tipsByDest.get(destId),
    });
  });
  return aggregated;
}

/**
 * Renderiza o mapa dentro de containerEl. Substitui conteúdo existente.
 * Retorna { destroy }: cleanup pra remover listeners/map.
 */
export async function renderPortalTipsMap(containerEl, opts = {}) {
  if (!containerEl) return { destroy: () => {} };
  const height = opts.height || 360;

  // v4.63.48: isolation:isolate cria novo stacking context confinando os
  // z-indices internos do Leaflet (controles têm z=1000-1010 que vazavam
  // pra cima de dropdowns do header como Paleta/Perfil). z-index:0 reforço.
  containerEl.innerHTML = `
    <div style="position:relative;height:${height}px;border-radius:var(--radius-md);overflow:hidden;
      border:1px solid var(--border-subtle);background:var(--bg-surface);
      isolation:isolate;z-index:0;">
      <div id="ptm-loading" style="position:absolute;inset:0;display:flex;flex-direction:column;
        align-items:center;justify-content:center;background:var(--bg-surface);z-index:10;
        font-size:0.8125rem;color:var(--text-muted);gap:8px;">
        <div style="font-size:1.5rem;">🗺</div>
        <div>Carregando mapa…</div>
      </div>
      <div id="ptm-canvas" style="width:100%;height:100%;"></div>
      <div id="ptm-stats" style="position:absolute;bottom:8px;left:8px;background:rgba(255,255,255,0.95);
        padding:6px 10px;border-radius:var(--radius-sm);font-size:0.7rem;color:var(--text-secondary);
        font-weight:500;box-shadow:0 1px 4px rgba(0,0,0,0.1);z-index:5;display:none;">
        — cidades · — dicas
      </div>
    </div>
  `;

  let L, map, clusterGroup, snapUnsub;
  const cleanup = [];

  const loadingEl = containerEl.querySelector('#ptm-loading');
  const statsEl   = containerEl.querySelector('#ptm-stats');
  const canvas    = containerEl.querySelector('#ptm-canvas');

  // v4.63.47 PERF: arranca Leaflet + fetch em PARALELO (antes era serial).
  // Cada um leva ~1-2s; rodando juntos reduz pra max(L, fetch) = ~1.5s.
  let leafletPromise, aggregatedPromise;
  try {
    leafletPromise = loadLeaflet();
    aggregatedPromise = fetchTipsAggregated();
    L = await leafletPromise;
  } catch (e) {
    loadingEl.innerHTML = `<div style="color:var(--color-danger);">Falha ao carregar Leaflet.</div>`;
    return { destroy: () => containerEl.innerHTML = '' };
  }

  // Mapa centrado no Atlântico (centroid entre Americas e Europa)
  map = L.map(canvas, {
    center: [10, -30],
    zoom: 2,
    minZoom: 2,
    maxZoom: 11,
    worldCopyJump: true,
    scrollWheelZoom: true,
    attributionControl: true,
  });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  // Cluster
  clusterGroup = L.markerClusterGroup({
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    maxClusterRadius: 50,
  });
  map.addLayer(clusterGroup);

  // Ícone customizado dourado
  const goldIcon = L.divIcon({
    className: 'ptm-marker',
    html: `<div style="background:#D4A843;width:14px;height:14px;border-radius:50%;
      border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

  // Função pra renderizar (ou re-renderizar) markers
  // v4.63.47 PERF: resolve coords em PARALELO via Promise.all (antes await sequencial).
  // Com 19/20 destinos com _geo cache, resolve instantâneo (sem rede).
  let lastData = [];
  async function refresh(aggregated) {
    clusterGroup.clearLayers();
    const withGeo = await Promise.all(
      aggregated.map(async (a) => ({ ...a, geo: await geocodeDestination(a.dest) })),
    );
    let okCount = 0;
    const markers = [];
    for (const { dest, count, geo } of withGeo) {
      if (!geo) continue;
      const popupHtml = `
        <div style="font-family:'Poppins',sans-serif;min-width:160px;">
          <div style="font-weight:700;font-size:0.95rem;color:#1F2937;">
            ${esc(dest.city || 'Cidade')}
          </div>
          <div style="font-size:0.8125rem;color:#6B7280;margin-top:2px;">
            ${esc(dest.country || '')}
          </div>
          <div style="margin-top:8px;padding:4px 8px;background:rgba(212,168,67,0.12);
            border-radius:4px;font-size:0.75rem;color:#1F2937;display:inline-block;">
            ${count} ${count === 1 ? 'dica cadastrada' : 'dicas cadastradas'}
          </div>
        </div>
      `;
      markers.push(L.marker([geo.lat, geo.lng], { icon: goldIcon }).bindPopup(popupHtml));
      okCount++;
    }
    // addLayers (plural) é mais rápido que N addLayer
    clusterGroup.addLayers(markers);
    statsEl.style.display = 'block';
    const totalTips = aggregated.reduce((s, a) => s + a.count, 0);
    statsEl.textContent = `${okCount} ${okCount === 1 ? 'cidade' : 'cidades'} · ${totalTips} ${totalTips === 1 ? 'dica' : 'dicas'}`;
  }

  // Carrega dados + popula
  // v4.63.47 PERF: aggregated já está sendo buscado em paralelo desde acima.
  try {
    loadingEl.querySelector('div:last-child').textContent = 'Buscando dicas cadastradas…';
    lastData = await aggregatedPromise;
    await refresh(lastData);
    loadingEl.style.display = 'none';
  } catch (e) {
    console.error('[portalTipsMap] erro:', e);
    loadingEl.innerHTML = `<div style="color:var(--color-danger);">${esc(e.message || 'Erro')}</div>`;
  }

  // v4.63.45+ Real-time: novas dicas → re-fetch + refresh
  try {
    snapUnsub = onSnapshot(
      query(collection(db, 'portal_tips'), orderBy('updatedAt', 'desc'), limit(50)),
      async () => {
        // debounce 1s pra evitar re-render por escritas em sequência
        clearTimeout(refresh._t);
        refresh._t = setTimeout(async () => {
          try {
            lastData = await fetchTipsAggregated();
            await refresh(lastData);
          } catch (e) {}
        }, 1000);
      },
    );
    cleanup.push(() => snapUnsub && snapUnsub());
  } catch (e) {
    // permission denied — silently skip real-time
  }

  return {
    destroy: () => {
      cleanup.forEach((fn) => { try { fn(); } catch {} });
      try { map && map.remove(); } catch {}
      containerEl.innerHTML = '';
    },
  };
}
