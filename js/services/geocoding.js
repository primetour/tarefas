/**
 * PRIMETOUR — Geocoding via Nominatim (OpenStreetMap)
 *
 * - Free, sem API key
 * - Política Nominatim: max 1 req/seg + User-Agent identificável
 * - Retorna { lat, lng, displayName } ou null se não geocodar
 * - Cache em localStorage pra evitar re-geocodar mesmo endereço
 *
 * Uso típico:
 *   import { geocodeAddress, ensureItemsGeocoded } from './geocoding.js';
 *   const geo = await geocodeAddress('5th Avenue 455, New York');
 *   await ensureItemsGeocoded(items, { city: 'New York', country: 'EUA' });
 */

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'PRIMETOUR City Guides (https://primetour.com.br)';
const CACHE_PREFIX = 'primetour-geocode:';
const RATE_LIMIT_MS = 1100; // 1.1s entre requests (margem sobre o 1req/seg da política)

// Estado interno: timestamp da última request
let _lastRequestAt = 0;

/* ─── Cache helpers ────────────────────────────────────────── */
function getCached(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Cache permanente (sem expiração) — endereços não mudam de coords
    return parsed;
  } catch { return null; }
}
function setCached(key, value) {
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value)); }
  catch { /* localStorage cheio — ignora */ }
}

/* ─── Rate limiter ─────────────────────────────────────────── */
async function throttle() {
  const elapsed = Date.now() - _lastRequestAt;
  const wait = Math.max(0, RATE_LIMIT_MS - elapsed);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastRequestAt = Date.now();
}

/**
 * Pega bounding box (viewbox) e centro de uma cidade. Cacheado.
 * Usado pra restringir buscas de items dentro da região do destino —
 * evita "5th Avenue 338" virar coord em outra cidade do estado.
 *
 * @returns { center: {lat, lng}, viewbox: 'lonW,latS,lonE,latN' } | null
 */
export async function getCityBounds(city, country) {
  if (!city) return null;
  const cacheKey = `__bounds:${(city + '|' + (country||'')).toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;
  await throttle();
  const q = [city, country].filter(Boolean).join(', ');
  try {
    const url = `${NOMINATIM_BASE}?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=0`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) { setCached(cacheKey, null); return null; }
    const arr = await res.json();
    if (!arr.length || !arr[0].boundingbox) { setCached(cacheKey, null); return null; }
    const bb = arr[0].boundingbox; // [latS, latN, lonW, lonE] (Nominatim format)
    const result = {
      center: { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon) },
      // viewbox no formato Nominatim: lon_left,lat_top,lon_right,lat_bottom
      viewbox: `${bb[2]},${bb[1]},${bb[3]},${bb[0]}`,
    };
    setCached(cacheKey, result);
    return result;
  } catch (e) {
    console.warn('[geocoding] cityBounds:', e.message, q);
    return null;
  }
}

// Distância em km entre 2 coords (Haversine simplificado)
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/**
 * Geocoda um endereço.
 * @param {string} address  — endereço bruto (ex: "5th Avenue 455")
 * @param {object} ctx       — { city, country, bounds? } — bounds é cache de getCityBounds
 * @returns { lat, lng, displayName } | null
 */
export async function geocodeAddress(address, ctx = {}) {
  if (!address) return null;
  const parts = [address];
  if (ctx.city)    parts.push(ctx.city);
  if (ctx.country) parts.push(ctx.country);
  const q = parts.join(', ').trim();
  // Cache key inclui se houve viewbox (resultados mudam)
  const cacheKey = q.toLowerCase() + (ctx.bounds ? '#bb' : '');
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  await throttle();
  try {
    let url = `${NOMINATIM_BASE}?q=${encodeURIComponent(q)}&format=json&limit=1`;
    // Viewbox + bounded=1 força resultado dentro da região da cidade.
    // Reduz drasticamente falsos positivos (ex: rua com mesmo nome em
    // outra cidade do estado).
    if (ctx.bounds?.viewbox) {
      url += `&viewbox=${encodeURIComponent(ctx.bounds.viewbox)}&bounded=1`;
    }
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) {
      console.warn('[geocoding] HTTP', res.status, q);
      setCached(cacheKey, null);
      return null;
    }
    const arr = await res.json();
    if (!arr.length) {
      setCached(cacheKey, null);
      return null;
    }
    const r = arr[0];
    const result = {
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
      displayName: r.display_name || '',
    };
    // Validação de sanidade: se o resultado está MUITO longe do centro
    // da cidade (>50km), considera erro de geocoding e descarta.
    if (ctx.bounds?.center) {
      const d = distanceKm(result.lat, result.lng, ctx.bounds.center.lat, ctx.bounds.center.lng);
      if (d > 50) {
        console.warn(`[geocoding] descartado (${d.toFixed(0)}km do centro):`, q, '→', r.display_name);
        setCached(cacheKey, null);
        return null;
      }
    }
    setCached(cacheKey, result);
    return result;
  } catch (e) {
    console.warn('[geocoding] erro:', e.message, q);
    return null;
  }
}

/**
 * Percorre items de um segmento de dica, geocoda os que têm `endereco`
 * mas não têm `_geo`, e DEVOLVE o array com `_geo` adicionado quando
 * conseguiu (não-mutativo). Items sem endereço passam intactos.
 *
 * @param items  — array de items (com .endereco e .titulo)
 * @param ctx    — { city, country } pra desambiguar
 * @returns array novo com items.{...,_geo?: {lat, lng}}
 */
export async function ensureItemsGeocoded(items, ctx = {}) {
  if (!Array.isArray(items)) return items;
  // Pega bounds da cidade UMA vez (cache permanente) — usado em todas
  // as chamadas geocodeAddress pra restringir + validar resultados.
  if (!ctx.bounds && ctx.city) {
    ctx = { ...ctx, bounds: await getCityBounds(ctx.city, ctx.country) };
  }
  const out = [];
  for (const item of items) {
    if (!item) { out.push(item); continue; }
    if (item._geo && typeof item._geo.lat === 'number') {
      out.push(item); continue;
    }
    if (!item.endereco || !String(item.endereco).trim()) {
      out.push(item); continue;
    }
    const g = await geocodeAddress(item.endereco, ctx);
    if (g) {
      out.push({ ...item, _geo: { lat: g.lat, lng: g.lng } });
    } else {
      out.push({ ...item, _geo: null });
    }
  }
  return out;
}

/**
 * Helper completo: dado um doc de tip + dest, geocoda TODOS os items
 * de TODOS os segmentos place_list e devolve o tip com .segments
 * atualizado.
 */
export async function geocodeTipItems(tip, dest) {
  if (!tip?.segments) return tip;
  const ctx = { city: dest?.city || '', country: dest?.country || '' };
  const segs = { ...tip.segments };
  for (const segKey of Object.keys(segs)) {
    const seg = segs[segKey];
    if (!seg || !Array.isArray(seg.items)) continue;
    segs[segKey] = { ...seg, items: await ensureItemsGeocoded(seg.items, ctx) };
  }
  return { ...tip, segments: segs };
}
