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
 * Geocoda um endereço.
 * @param {string} address  — endereço bruto (ex: "5th Avenue 455")
 * @param {object} ctx       — contexto opcional pra desambiguar { city, country }
 * @returns { lat, lng, displayName } | null
 */
export async function geocodeAddress(address, ctx = {}) {
  if (!address) return null;
  // Monta query: address + city + country (mais preciso)
  const parts = [address];
  if (ctx.city)    parts.push(ctx.city);
  if (ctx.country) parts.push(ctx.country);
  const q = parts.join(', ').trim();
  const cacheKey = q.toLowerCase();
  const cached = getCached(cacheKey);
  if (cached !== null) return cached; // cached pode ser null (geocoding falhou antes)

  await throttle();
  try {
    const url = `${NOMINATIM_BASE}?q=${encodeURIComponent(q)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': USER_AGENT },
    });
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
  const out = [];
  for (const item of items) {
    if (!item) { out.push(item); continue; }
    if (item._geo && typeof item._geo.lat === 'number') {
      // já tem coords — não regeocoda
      out.push(item); continue;
    }
    if (!item.endereco || !String(item.endereco).trim()) {
      // sem endereço — não vai pro mapa, mas mantém o item
      out.push(item); continue;
    }
    const g = await geocodeAddress(item.endereco, ctx);
    if (g) {
      out.push({ ...item, _geo: { lat: g.lat, lng: g.lng } });
    } else {
      // Marcamos como tentado-mas-falhou pra não retentar a cada save
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
