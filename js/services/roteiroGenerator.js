/**
 * PRIMETOUR — Roteiros de Viagem: Motor de Geração PDF / PPTX
 * Converte dados de roteiro + área em documento profissional
 * Padrão visual: itinerário de viagem premium (jsPDF + autoTable)
 */

import { store } from '../store.js';
import { toast } from '../components/toast.js';
import { fetchAreas, fetchImages } from './portal.js';
import { recordGeneration as logGeneration } from './roteiros.js';
// Reuso de helpers do gerador do Portal de Dicas — fontes, composite logo,
// cover crop e sanitizer (mesmo padrão visual e tratamento de imagens).
import {
  loadPoppinsOnDoc,
  compositeLogoOnBackground,
  coverCropImage,
  cleanText,
} from './portalGenerator.js';

/* ═══════════════════════════════════════════════════════════════
   CDN LOADERS
   ═══════════════════════════════════════════════════════════════ */

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

async function loadJsPDF() {
  if (window.jspdf) return window.jspdf;
  await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
  await loadScript('https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.3/dist/jspdf.plugin.autotable.min.js');
  return window.jspdf;
}

async function loadPptxGenJS() {
  if (window.PptxGenJS) return;
  await loadScript('https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js');
}

// 4.46.0+ (Sprint 5 Phase 3) — DOCX lazy loader, mesma versão do Portal de Dicas
async function loadDocx() {
  if (window.docx) return;
  await loadScript('https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js');
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */

const R2_PROXY = 'https://primetour-images.rene-castro.workers.dev';
const R2_ORIGIN = 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev';

/** Fetch image como base64 dataUrl.
 *  - URLs do R2 da Primetour: vai via worker proxy (precisa pra CORS)
 *  - URLs externas com CORS aberto (Wikimedia/Unsplash): fetch direto
 *  - Tenta direto primeiro; se falhar, cai no proxy
 */
/**
 * 4.46.1+ (Sprint 5 fix) — Fetch imagem retornando ArrayBuffer + ext, espelhando
 * `fetchImgData` do `portalGenerator.js`. Usado pelo DOCX (ImageRun precisa de
 * ArrayBuffer, não dataUrl).
 *
 * Converte WebP→PNG via canvas (docx ImageRun não aceita webp). Mesma lógica
 * do Portal — copiada porque importar deste módulo no roteiroGenerator seria
 * acoplamento desnecessário (Portal tem 2200 linhas).
 */
async function fetchImgArrayBuffer(url) {
  if (!url) return null;
  try {
    // Tenta direto primeiro (Wikipedia/Unsplash CORS), depois proxy R2
    let res = null;
    try {
      res = await fetch(url);
      if (!res.ok) res = null;
    } catch { res = null; }
    if (!res) {
      try {
        res = await fetch(`${R2_PROXY}?url=${encodeURIComponent(url)}`);
        if (!res.ok) return null;
      } catch { return null; }
    }
    const blob = await res.blob();
    const mime = blob.type || 'image/jpeg';
    const extMap = { 'image/jpeg':'jpg','image/jpg':'jpg','image/png':'png','image/webp':'png','image/gif':'gif' };
    let ext  = extMap[mime] || 'jpg';
    let arrayBuffer = await blob.arrayBuffer();

    // WebP → PNG (docx ImageRun não aceita webp)
    if (mime === 'image/webp' && typeof Image !== 'undefined') {
      try {
        const dataUrl = await new Promise(r => {
          const fr = new FileReader();
          fr.onload = () => r(fr.result);
          fr.onerror = () => r(null);
          fr.readAsDataURL(blob);
        });
        if (dataUrl) {
          const img = await new Promise((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = reject;
            im.src = dataUrl;
          });
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          canvas.getContext('2d').drawImage(img, 0, 0);
          const pngBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));
          if (pngBlob) { arrayBuffer = await pngBlob.arrayBuffer(); ext = 'png'; }
        }
      } catch (e) { /* fallback: usa webp mesmo, docx pode falhar silenciosamente */ }
    }
    return { arrayBuffer, ext };
  } catch { return null; }
}

async function fetchImgData(url) {
  if (!url) return null;
  const tryFetch = async (u) => {
    const res = await fetch(u);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  };

  // 1) Se for R2, usa proxy direto (sabemos que worker aceita)
  if (url.startsWith(R2_ORIGIN)) {
    try {
      return await tryFetch(`${R2_PROXY}?url=${encodeURIComponent(url)}`);
    } catch { return null; }
  }

  // 2) Externo: tenta direto (Wikimedia/Unsplash têm CORS aberto)
  try {
    const direct = await tryFetch(url);
    if (direct) return direct;
  } catch { /* fallthrough */ }

  // 3) Último recurso: proxy (pode falhar com 403 pra domínios não-whitelisted)
  try {
    return await tryFetch(`${R2_PROXY}?url=${encodeURIComponent(url)}`);
  } catch { return null; }
}

/** Converte qualquer dataURL (incluindo WebP) pra PNG limpo PRESERVANDO ALPHA.
 *  jsPDF não lê WebP nativo e addImage('PNG','FAST') costuma virar JPEG opaco.
 *  Solução: drawImage num canvas (transparente por default) → toDataURL('image/png')
 *  garante PNG com canal alpha real, que jsPDF respeita com mode='SLOW'.
 *  Retorna { dataUrl, naturalW, naturalH } ou null em ambiente sem canvas.
 */
async function pngWithAlpha(dataUrl) {
  if (typeof Image === 'undefined' || typeof document === 'undefined') return null;
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  // Não pinta fundo — canvas começa transparente (rgba 0,0,0,0)
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0);
  return {
    dataUrl: canvas.toDataURL('image/png'),
    naturalW: img.naturalWidth,
    naturalH: img.naturalHeight,
  };
}

/* ═══════════════════════════════════════════════════════════════
   IMAGES — Banco portal_images + auto-fetch via Cloud Function
   (Unsplash + Wikipedia fallback)
   ═══════════════════════════════════════════════════════════════ */

/** Normaliza nome de cidade/país pra chave de cache. */
function normKey(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Busca imagem no banco portal_images por cidade/país. Match flexível.
 * Retorna URL da PRIMEIRA imagem que bater (ordem: cidade exata, país, gallery genérica).
 */
function pickFromBank(allImages, { city, country }) {
  if (!allImages?.length) return null;
  const cN = normKey(city); const pN = normKey(country);
  // Prioridade 1: city + country match
  let match = allImages.find(img =>
    cN && pN && normKey(img.city) === cN && normKey(img.country) === pN);
  if (match) return match.url;
  // Prioridade 2: só city
  match = allImages.find(img => cN && normKey(img.city) === cN);
  if (match) return match.url;
  // Prioridade 3: só country (genérica do país)
  match = allImages.find(img => pN && normKey(img.country) === pN && !img.city);
  if (match) return match.url;
  return null;
}

/** Cache de fetchDestinationPhoto. TTL 1h pra evitar crescimento unbounded
 *  em sessões longas (admin tela aberta o dia todo). */
const _photoCache = new Map(); // key → { url, ts }
const _PHOTO_CACHE_TTL = 60 * 60 * 1000; // 1h
function _cacheGet(k) {
  const v = _photoCache.get(k);
  if (!v) return undefined;
  if (Date.now() - v.ts > _PHOTO_CACHE_TTL) { _photoCache.delete(k); return undefined; }
  return v.url;
}
function _cacheSet(k, url) {
  _photoCache.set(k, { url, ts: Date.now() });
}
let _fnPhotoPromise = null;

async function getPhotoFn() {
  if (_fnPhotoPromise) return _fnPhotoPromise;
  _fnPhotoPromise = (async () => {
    const { httpsCallable, getFunctions } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
    const { app } = await import('../firebase.js');
    return httpsCallable(getFunctions(app, 'us-central1'), 'fetchDestinationPhoto');
  })();
  return _fnPhotoPromise;
}

/** Mapa PT→EN das principais cidades/países que costumam falhar no Unsplash
 *  por causa de acentos / nomes localizados. Não é exaustivo (impossível
 *  cobrir o mundo todo), mas pega os destinos mais comuns que escapam.
 */
const PT_TO_EN_MAP = {
  // Cidades
  'tóquio': 'Tokyo', 'toquio': 'Tokyo',
  'kioto': 'Kyoto', 'quioto': 'Kyoto',
  'osaka': 'Osaka',
  'pequim': 'Beijing', 'xangai': 'Shanghai', 'hong kong': 'Hong Kong',
  'cingapura': 'Singapore', 'singapura': 'Singapore',
  'nova york': 'New York', 'nova iorque': 'New York',
  'los angeles': 'Los Angeles', 'são francisco': 'San Francisco',
  'cidade do méxico': 'Mexico City', 'cidade do mexico': 'Mexico City',
  'havana': 'Havana', 'cidade do cabo': 'Cape Town',
  'londres': 'London', 'paris': 'Paris', 'roma': 'Rome', 'milão': 'Milan',
  'florença': 'Florence', 'veneza': 'Venice', 'nápoles': 'Naples',
  'madri': 'Madrid', 'madrid': 'Madrid', 'barcelona': 'Barcelona',
  'lisboa': 'Lisbon', 'porto': 'Porto', 'sevilha': 'Seville',
  'atenas': 'Athens', 'istambul': 'Istanbul', 'jerusalém': 'Jerusalem',
  'cairo': 'Cairo', 'marrakech': 'Marrakech', 'marraquexe': 'Marrakech',
  'dubai': 'Dubai', 'abu dhabi': 'Abu Dhabi', 'doha': 'Doha',
  'moscou': 'Moscow', 'são petersburgo': 'Saint Petersburg',
  'genebra': 'Geneva', 'zurique': 'Zurich', 'praga': 'Prague',
  'viena': 'Vienna', 'budapeste': 'Budapest', 'cracóvia': 'Krakow',
  'estocolmo': 'Stockholm', 'copenhague': 'Copenhagen', 'oslo': 'Oslo',
  'helsinque': 'Helsinki', 'reykjavík': 'Reykjavik', 'reykjavik': 'Reykjavik',
  'munique': 'Munich', 'berlim': 'Berlin', 'colônia': 'Cologne',
  'amsterdã': 'Amsterdam', 'haia': 'The Hague', 'bruxelas': 'Brussels',
  'sidney': 'Sydney', 'sydney': 'Sydney', 'melbourne': 'Melbourne',
  'wellington': 'Wellington', 'auckland': 'Auckland',
  // Países
  'frança': 'France', 'inglaterra': 'England', 'reino unido': 'United Kingdom',
  'alemanha': 'Germany', 'itália': 'Italy', 'espanha': 'Spain',
  'portugal': 'Portugal', 'grécia': 'Greece', 'turquia': 'Turkey',
  'japão': 'Japan', 'china': 'China', 'coreia do sul': 'South Korea',
  'tailândia': 'Thailand', 'vietnã': 'Vietnam', 'indonésia': 'Indonesia',
  'índia': 'India', 'maldivas': 'Maldives',
  'estados unidos': 'United States', 'eua': 'USA', 'canadá': 'Canada',
  'méxico': 'Mexico', 'argentina': 'Argentina', 'chile': 'Chile',
  'peru': 'Peru', 'colômbia': 'Colombia', 'uruguai': 'Uruguay',
  'áfrica do sul': 'South Africa', 'marrocos': 'Morocco', 'egito': 'Egypt',
  'austrália': 'Australia', 'nova zelândia': 'New Zealand',
  'noruega': 'Norway', 'suécia': 'Sweden', 'dinamarca': 'Denmark',
  'finlândia': 'Finland', 'islândia': 'Iceland',
  'rússia': 'Russia', 'polônia': 'Poland', 'república tcheca': 'Czech Republic',
  'hungria': 'Hungary', 'áustria': 'Austria', 'suíça': 'Switzerland',
  'países baixos': 'Netherlands', 'holanda': 'Netherlands',
  'bélgica': 'Belgium', 'irlanda': 'Ireland', 'escócia': 'Scotland',
};

/** Traduz query de PT pra EN aplicando o mapa palavra-por-palavra (token).
 *  Retorna null se nada mudou (não vale fazer 2ª tentativa idêntica).
 */
function translateToEnglish(query) {
  if (!query) return null;
  const tokens = query.toLowerCase().split(/\s+/);
  let changed = false;
  const out = [];
  // Tenta multi-palavra primeiro (ex: "nova york")
  let i = 0;
  while (i < tokens.length) {
    const two = tokens.slice(i, i + 2).join(' ');
    if (PT_TO_EN_MAP[two]) {
      out.push(PT_TO_EN_MAP[two]); i += 2; changed = true; continue;
    }
    const one = tokens[i];
    if (PT_TO_EN_MAP[one]) {
      out.push(PT_TO_EN_MAP[one]); changed = true;
    } else {
      out.push(tokens[i]);
    }
    i++;
  }
  return changed ? out.join(' ') : null;
}

/** Busca foto auto via Cloud Function (Unsplash → Wikipedia fallback). Cached.
 *  Tenta na ordem: query original → tradução EN → null.
 *  PT-BR costuma falhar no Unsplash (que indexa em EN), então a 2ª tentativa
 *  pega muitos casos como "Tóquio" → "Tokyo".
 */
async function fetchAutoPhoto(query) {
  if (!query) return null;
  const k = query.toLowerCase().trim();
  const cached = _cacheGet(k);
  if (cached !== undefined) return cached;

  const tryQuery = async (q) => {
    try {
      const fn = await getPhotoFn();
      const r = await fn({ query: q });
      return r?.data?.url || null;
    } catch (e) {
      console.warn('[roteiroImages] fetchAutoPhoto falhou:', q, e.message);
      return null;
    }
  };

  // 1ª tentativa: query original
  let url = await tryQuery(query);

  // 2ª tentativa: tradução EN se a 1ª veio vazia
  if (!url) {
    const en = translateToEnglish(query);
    if (en && en.toLowerCase() !== query.toLowerCase()) {
      console.info('[roteiroImages] retry em EN:', query, '→', en);
      url = await tryQuery(en);
    }
  }

  _cacheSet(k, url);
  return url;
}

/** Resolve imagem pra um destino (city + country).
 * Ordem: override manual → banco portal_images → Unsplash/Wikipedia.
 * @param {Object} dest - { city, country }
 * @param {string|null} override - URL salva manualmente pelo user (vence tudo)
 * @param {Array} bankImages - resultado de fetchImages() (cache na sessão)
 * @returns {Promise<string|null>}
 */
/* ─── 4.41.0+ (Sprint 2) Strip de campos internos ────────────
 *
 * Garante que dados confidenciais (custo interno, notas internas)
 * JAMAIS apareçam em exports pra cliente.
 *
 * Aplicado em generateRoteiroForExport (PDF + PPTX) e em
 * roteiro-view.html quando renderiza o web link público.
 *
 * Campos removidos:
 *   - costPricing.* (custo interno, margem comercial)
 *   - collaboratorIds (lista de quem pode editar — info interna)
 *   - workflowMode (decisão operacional, não interessa cliente)
 *   - aiPrompt, aiSources, aiProvider, aiModel (origem técnica)
 *
 * Tudo permanece no doc do Firestore — só não vai pra render externo.
 */
export function stripInternalFields(roteiro) {
  if (!roteiro || typeof roteiro !== 'object') return roteiro;
  const out = JSON.parse(JSON.stringify(roteiro));
  // Custo interno: zerar pra que mesmo se renderer ler, não exibe nada útil.
  out.costPricing = { perPerson: null, perCouple: null, currency: 'USD', notes: '', customRows: [] };
  // Internals operacionais
  delete out.collaboratorIds;
  delete out.workflowMode;
  // 4.43.0+ Sprint 4 — tarefas vinculadas são internals (operacional)
  delete out.linkedTaskIds;
  delete out.tasksGeneratedAt;
  // Metadata de IA
  delete out.aiPrompt;
  delete out.aiSources;
  delete out.aiProvider;
  delete out.aiModel;
  return out;
}

export async function resolveDestinationImage(dest, override, bankImages) {
  if (override) return override;
  const fromBank = pickFromBank(bankImages, dest || {});
  if (fromBank) return fromBank;
  const q = [dest?.city, dest?.country].filter(Boolean).join(' ');
  if (!q) return null;
  return await fetchAutoPhoto(q);
}

/** Enriquece roteiro com imagens pra capa, dias e hotéis.
 * Lê roteiro.images.overrides (manuais) e popula:
 *   - heroUrl: capa (1ª destinação ou override)
 *   - byDayCity: { 'Paris': url } — uma por cidade visitada
 *   - byHotel: { idx: url } — opcional por hotel
 * Não persiste — só retorna pra usar no PDF/PPTX/DOCX.
 *
 * @param {Object} roteiro
 * @returns {Promise<{ heroUrl, byCity: Object, byHotel: Object }>}
 */
export async function enrichRoteiroImages(roteiro) {
  const overrides = roteiro?.images?.overrides || {};
  const out = { heroUrl: null, byCity: {}, byHotel: {} };

  // Carrega banco de imagens uma vez
  let bankImages = [];
  try { bankImages = await fetchImages({}); }
  catch (e) { console.warn('[roteiroImages] fetchImages falhou:', e.message); }

  // 1) Hero — primeira destinação (ou override hero)
  const heroOverride = overrides.hero || roteiro?.images?.hero;
  const firstDest = roteiro?.travel?.destinations?.[0];
  if (heroOverride) {
    out.heroUrl = heroOverride;
  } else if (firstDest) {
    out.heroUrl = await resolveDestinationImage(firstDest, null, bankImages);
  }

  // 2) Por cidade — coleta cidades únicas do itinerário (days + destinations)
  const cities = new Map(); // key: cityName, value: {city, country}
  (roteiro?.travel?.destinations || []).forEach(d => {
    if (d.city) cities.set(normKey(d.city), { city: d.city, country: d.country });
  });
  (roteiro?.days || []).forEach(d => {
    if (d.city && !cities.has(normKey(d.city))) {
      cities.set(normKey(d.city), { city: d.city, country: '' });
    }
  });

  await Promise.allSettled(
    Array.from(cities.entries()).map(async ([key, dest]) => {
      const ovKey = `city_${key}`;
      const override = overrides[ovKey];
      const url = await resolveDestinationImage(dest, override, bankImages);
      if (url) out.byCity[key] = url;
    })
  );

  // 3) Por hotel (opcional) — usa city + hotelName
  await Promise.allSettled(
    (roteiro?.hotels || []).map(async (h, idx) => {
      const ovKey = `hotel_${idx}`;
      const override = overrides[ovKey];
      if (override) { out.byHotel[idx] = override; return; }
      // Tenta banco por city
      const fromBank = pickFromBank(bankImages, { city: h.city, country: '' });
      if (fromBank) { out.byHotel[idx] = fromBank; return; }
      // Auto-fetch hotel-specific
      const q = h.hotelName ? `${h.hotelName} ${h.city || ''}`.trim() : h.city;
      if (q) {
        const url = await fetchAutoPhoto(q);
        if (url) out.byHotel[idx] = url;
      }
    })
  );

  return out;
}

/** Format date "YYYY-MM-DD" to "dd/MM" */
function fmtDateBR(dateStr) {
  if (!dateStr) return '';
  const parts = String(dateStr).split('-');
  if (parts.length < 3) return dateStr;
  return `${parts[2]}/${parts[1]}`;
}

/** Format date "YYYY-MM-DD" to full Brazilian date */
function fmtDateFull(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return dateStr; }
}

/** Format currency value */
function formatCurrency(value, currency = 'USD') {
  if (value == null || value === '') return '\u2014';
  const num = typeof value === 'number'
    ? value
    : parseFloat(String(value).replace(/[^\d.,\-]/g, '').replace(',', '.'));
  if (isNaN(num)) return String(value);
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    const symbols = { USD: 'US$', BRL: 'R$', EUR: '\u20AC', GBP: '\u00A3' };
    const sym = symbols[currency] || currency + ' ';
    return `${sym} ${num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

/** Parse hex color to [r, g, b] */
function hexToRgb(hex) {
  hex = String(hex).replace('#', '');
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Sanitize string for filename */
function sanitize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/* ═══════════════════════════════════════════════════════════════
   PDF LAYOUT CONSTANTS
   ═══════════════════════════════════════════════════════════════ */

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 16;
const CONTENT_W = PAGE_W - MARGIN * 2; // 178mm

/* ─── PDF page helpers ────────────────────────────────────── */

function checkPageBreak(doc, y, needed = 40) {
  if (y + needed > PAGE_H - MARGIN) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

/** Section title with accent bar */
function addSectionTitle(doc, y, title, primary, secondary) {
  y = checkPageBreak(doc, y, 22);
  const [pr, pg, pb] = hexToRgb(primary);
  const [sr, sg, sb] = hexToRgb(secondary);

  // Accent bar left
  doc.setFillColor(pr, pg, pb);
  doc.rect(MARGIN, y, 3, 10, 'F');

  // Title text 14pt
  doc.setFont('Poppins', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(sr, sg, sb);
  doc.text(title, MARGIN + 8, y + 7.5);

  // Underline
  doc.setDrawColor(pr, pg, pb);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y + 13, PAGE_W - MARGIN, y + 13);

  return y + 18;
}

/** Footer minimalista: logo opcional + paginação. SEM data, SEM nome da BU
 *  (são infos internas/técnicas que poluem documento de cliente).
 */
function addFooter(doc, areaName, pageNum, totalPages, primary, logoFooter = null) {
  // Linha separadora discreta
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, PAGE_H - 16, PAGE_W - MARGIN, PAGE_H - 16);

  // Logo centralizado (se a area tem) — fica como brand mark sutil
  if (logoFooter) {
    const lw = logoFooter.widthMm, lh = logoFooter.heightMm;
    const lx = (PAGE_W - lw) / 2, ly = PAGE_H - 13;
    try {
      doc.addImage(logoFooter.dataUrl, 'PNG', lx, ly, lw, lh, undefined, 'NONE');
    } catch (e) { /* silencioso */ }
  }

  // Apenas paginação, no canto direito, discreta
  doc.setFontSize(8);
  doc.setFont('Poppins', 'normal');
  doc.setTextColor(150, 150, 150);
  doc.text(`${pageNum} / ${totalPages}`, PAGE_W - MARGIN, PAGE_H - 6, { align: 'right' });
}

/** Gold separator line */
function addSeparator(doc, y, primary) {
  const [r, g, b] = hexToRgb(primary);
  doc.setDrawColor(r, g, b);
  doc.setLineWidth(0.3);
  doc.line(MARGIN + 10, y, PAGE_W - MARGIN - 10, y);
  return y + 6;
}

/* ═══════════════════════════════════════════════════════════════
   MAIN EXPORT: generateRoteiroPDF
   ═══════════════════════════════════════════════════════════════ */

/**
 * Generate a complete travel itinerary PDF
 * @param {object} roteiro - Full roteiro object
 * @param {object} area - { name, colors: { primary, secondary, accent } }
 * @returns {{ filename: string }}
 */
export async function generateRoteiroPDF(roteiro, area = null) {
  if (!roteiro) throw new Error('Roteiro não encontrado. Salve o roteiro antes de exportar.');
  await loadJsPDF();

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Carrega Poppins (mesma do portal de dicas) — sem isso jsPDF cai em Helvetica
  try { await loadPoppinsOnDoc(doc); }
  catch (e) { console.warn('[roteiroGenerator] Poppins falhou, usando Helvetica:', e.message); }

  // Cores neutras como default (não amarelo). Ouro só se a área pedir.
  const primary = area?.colors?.primary || '#475569';   // slate-600 (cinza)
  const secondary = area?.colors?.secondary || '#0F172A'; // slate-900
  const accent = area?.colors?.accent || primary;
  // Branding externo: sempre "PRIMETOUR" (sem nome interno da BU "Lazer", "Corporate" etc).
  // O logo da área é o que diferencia visualmente.
  const buName = 'PRIMETOUR';

  // Resolve imagens (banco → Unsplash → Wikipedia) — não-blocker
  let images = { heroUrl: null, byCity: {}, byHotel: {} };
  try { images = await enrichRoteiroImages(roteiro); }
  catch (e) { console.warn('[roteiroGenerator] enrichRoteiroImages falhou:', e.message); }

  // Logos da área:
  //   - logoCover: PNG transparente convertido via canvas pra preservar alpha.
  //     Necessário pq jsPDF não lê WebP, e addImage('PNG','FAST') vira JPEG.
  //     Aqui draw num canvas vazio (transparente) e exporta PNG → alpha real.
  //   - logoFooter: composite (fundo branco) pra rodapé sobre página branca.
  let logoCoverPng = null;
  let logoFooter = null;
  if (area?.logoUrl) {
    try {
      const logoData = await fetchImgData(area.logoUrl);
      if (logoData) {
        const cleaned = await pngWithAlpha(logoData).catch(() => null);
        if (cleaned) {
          const ratio = cleaned.naturalW / Math.max(cleaned.naturalH, 1);
          // Logo grande na capa (~3x maior que header). Caps por largura E altura.
          const maxW = 130, maxH = 55;
          let w = maxW, h = w / ratio;
          if (h > maxH) { h = maxH; w = h * ratio; }
          logoCoverPng = { dataUrl: cleaned.dataUrl, widthMm: w, heightMm: h };
        }
      }
    } catch (e) { /* silencioso */ }
  }
  const footerLogoSrc = area?.logoUrlAlt || area?.logoUrl;
  if (footerLogoSrc) {
    try {
      const footerData = await fetchImgData(footerLogoSrc);
      if (footerData) {
        logoFooter = await compositeLogoOnBackground({
          logoDataUrl: footerData, bgColorHex: '#FFFFFF',
          maxWmm: 30, maxHmm: 10, padPct: 0.04,
        }).catch(() => null);
      }
    } catch (e) { /* silencioso */ }
  }

  /* ─── PAGE 1: COVER ──────────────────────────────────────── */
  await buildCoverPage(doc, roteiro, buName, primary, secondary, images.heroUrl, logoCoverPng);

  /* ─── PAGES 2+: DAY BY DAY ───────────────────────────────── */
  if (roteiro.days?.length) {
    doc.addPage();
    await buildDayByDayPages(doc, roteiro, primary, secondary, accent, images.byCity);
  }

  /* ─── HOTELS TABLE ───────────────────────────────────────── */
  if (roteiro.hotels?.length) {
    doc.addPage();
    await buildHotelsSection(doc, roteiro, primary, secondary, images.byHotel);
  }

  /* ─── PRICING ────────────────────────────────────────────── */
  if (roteiro.pricing && (roteiro.pricing.perPerson || roteiro.pricing.perCouple || roteiro.pricing.customRows?.length)) {
    buildPricingSection(doc, roteiro, primary, secondary);
  }

  /* ─── OPTIONALS ──────────────────────────────────────────── */
  if (roteiro.optionals?.length) {
    buildOptionalsSection(doc, roteiro, primary, secondary);
  }

  /* ─── INCLUDES / EXCLUDES ────────────────────────────────── */
  if (roteiro.includes?.length || roteiro.excludes?.length) {
    buildIncludesExcludes(doc, roteiro, primary, secondary);
  }

  /* ─── PAYMENT TERMS ──────────────────────────────────────── */
  if (roteiro.payment && (roteiro.payment.deposit || roteiro.payment.installments || roteiro.payment.deadline || roteiro.payment.notes)) {
    buildPaymentSection(doc, roteiro, primary, secondary);
  }

  /* ─── CANCELLATION POLICY ────────────────────────────────── */
  if (roteiro.cancellation?.length) {
    buildCancellationSection(doc, roteiro, primary, secondary);
  }

  /* ─── IMPORTANT INFO ─────────────────────────────────────── */
  if (hasImportantInfo(roteiro.importantInfo)) {
    buildImportantInfoSection(doc, roteiro, primary, secondary);
  }

  /* ─── 4.42.0+ Sprint 3: DICAS ANEXAS ────────────────────── */
  if (Array.isArray(roteiro.embeddedTips) && roteiro.embeddedTips.length) {
    buildEmbeddedTipsSection(doc, roteiro, primary, secondary);
  }

  /* ─── CLOSING PAGE ───────────────────────────────────────── */
  buildClosingPage(doc, roteiro, buName, primary, secondary, logoCoverPng);

  /* ─── FOOTERS (retroactive) ──────────────────────────────── */
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 2; i <= totalPages - 1; i++) {
    doc.setPage(i);
    addFooter(doc, buName, i - 1, totalPages - 2, primary, logoFooter);
  }

  /* ─── SAVE & LOG ─────────────────────────────────────────── */
  const clientName = sanitize(roteiro.client?.name || '');
  const destinations = (roteiro.travel?.destinations || [])
    .map(d => d.city || d.country).filter(Boolean).map(sanitize).join('_');
  const filename = `Roteiro_${clientName || 'viagem'}${destinations ? '_' + destinations : ''}.pdf`;

  doc.save(filename);

  try {
    if (roteiro.id) {
      await logGeneration({
        roteiroId: roteiro.id,
        format: 'pdf',
        areaId: area?.id || roteiro.areaId || '',
        destinations: roteiro.travel?.destinations?.map(d => d.city || d.country) || [],
      });
    }
  } catch (e) {
    console.warn('[roteiroGenerator] PDF generation tracking failed:', e);
  }

  return { filename };
}

/* ═══════════════════════════════════════════════════════════════
   CONVENIENCE WRAPPER: generateRoteiroForExport
   ═══════════════════════════════════════════════════════════════ */

/**
 * Resolve area by ID, generate PDF, and show toast feedback.
 * @param {object} roteiro - Full roteiro object
 * @param {string} areaId - Portal area ID to fetch branding from
 */
/**
 * 4.44.0+ (Sprint 5) — Wrapper único de export no padrão do Portal de Dicas.
 *
 * Espelha `generateTip({ format })` em portalGenerator.js. Aceita format
 * 'pdf'|'pptx'|'docx'|'web' e roteia pra função certa, com strip defensivo
 * de internals e resolução de area antes de qualquer renderização.
 *
 * @param {Object} opts
 * @param {Object} opts.roteiro       — doc completo do roteiro
 * @param {string|null} opts.areaId   — ID da BU/área pra branding (opcional)
 * @param {Object|null} opts.area     — área já resolvida (evita re-fetch)
 * @param {'pdf'|'pptx'|'docx'|'web'} opts.format
 * @returns {Promise<Object>} { filename?, blob?, url?, token?, ... }
 */
export async function generateRoteiro({ roteiro, areaId = null, area = null, format = 'pdf' }) {
  // Resolve area se passou só ID
  if (!area && areaId) {
    const areas = await fetchAreas();
    area = areas.find(a => a.id === areaId) || null;
  }

  // Strip defensivo (custo interno + workflow + linkedTaskIds — nunca pro cliente)
  const sanitized = stripInternalFields(roteiro);

  switch (format) {
    case 'pdf':
      return generateRoteiroPDF(sanitized, area);
    case 'pptx':
      return generateRoteiroPPTX(sanitized, area);
    case 'docx':
      return generateRoteiroDOCX(sanitized, area);
    case 'web':
      // 4.45.0+ planned — fallback temporário
      throw new Error('Link web em desenvolvimento (Sprint 5 Phase 4).');
    default:
      throw new Error(`Formato desconhecido: ${format}`);
  }
}

export async function generateRoteiroForExport(roteiro, areaId, format = 'pdf') {
  try {
    let area = null;
    if (areaId) {
      const areas = await fetchAreas();
      area = areas.find(a => a.id === areaId) || null;
    }

    // 4.41.0+ (Sprint 2) — GARANTIA DE PRIVACIDADE: costPricing JAMAIS vai
    // pra qualquer export pra cliente (PDF/PPTX/web link). Strip aqui, no
    // único ponto de entrada de export. Defense-in-depth: mesmo que o
    // renderer do PDF leia o campo, ele estará null.
    const sanitized = stripInternalFields(roteiro);

    let result;
    if (format === 'pptx') {
      result = await generateRoteiroPPTX(sanitized, area);
      toast.success(`PPTX gerado: ${result.filename}`);
    } else {
      result = await generateRoteiroPDF(sanitized, area);
      toast.success(`PDF gerado: ${result.filename}`);
    }

    return result;
  } catch (err) {
    console.error('[roteiroGenerator] Export failed:', err);
    toast.error(`Erro ao gerar ${format.toUpperCase()} do roteiro.`);
    throw err;
  }
}

/* ═══════════════════════════════════════════════════════════════
   SECTION BUILDERS — PDF
   ═══════════════════════════════════════════════════════════════ */

/* ─── Cover Page ──────────────────────────────────────────── */
async function buildCoverPage(doc, roteiro, buName, primary, secondary, heroImage, logoCover = null) {
  const [pr, pg, pb] = hexToRgb(primary);
  const [sr, sg, sb] = hexToRgb(secondary);

  // Full navy/secondary background (fallback se sem hero)
  doc.setFillColor(sr, sg, sb);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

  // Hero image (full bleed cover-cropped) + overlay pra legibilidade
  if (heroImage) {
    try {
      const rawData = await fetchImgData(heroImage);
      if (rawData) {
        // Cover-crop pra evitar distorção/aspect-ratio errado (mesma técnica do portal)
        const fitData = await coverCropImage({
          dataUrl: rawData, finalWmm: PAGE_W, finalHmm: PAGE_H,
        }).catch(() => rawData);
        doc.addImage(fitData, 'JPEG', 0, 0, PAGE_W, PAGE_H, undefined, 'FAST');
        // Overlay escuro semi-transparente
        doc.setGState(new doc.GState({ opacity: 0.55 }));
        doc.setFillColor(sr, sg, sb);
        doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
        doc.setGState(new doc.GState({ opacity: 1 }));
      }
    } catch (e) {
      console.warn('[roteiroGenerator] hero image falhou:', e.message);
    }
  }

  // Top accent line — branco (capa sobre fundo escuro)
  doc.setFillColor(255, 255, 255);
  doc.rect(30, 40, PAGE_W - 60, 0.6, 'F');

  // Logo da área grande no topo da capa. PNG transparente preservado.
  let nextY = 80;
  if (logoCover) {
    const lw = logoCover.widthMm, lh = logoCover.heightMm;
    const lx = (PAGE_W - lw) / 2, ly = 50;
    try {
      doc.addImage(logoCover.dataUrl, 'PNG', lx, ly, lw, lh, undefined, 'SLOW');
      nextY = ly + lh + 14;
    } catch (e) { /* fallback */ }
  } else {
    doc.setFont('Poppins', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(255, 255, 255);
    doc.text(buName, PAGE_W / 2, 70, { align: 'center' });
    nextY = 90;
  }

  // Destination names (18pt, white, large)
  const destinations = roteiro.travel?.destinations || [];
  const destNames = destinations.map(d => d.city || d.country).filter(Boolean);
  const destText = destNames.join('  |  ').toUpperCase();

  doc.setFont('Poppins', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  const destLines = doc.splitTextToSize(destText, CONTENT_W + 20);
  let destY = nextY;
  for (const line of destLines) {
    doc.text(line, PAGE_W / 2, destY, { align: 'center' });
    destY += 10;
  }

  // Cover usa BRANCO pra texto de accent (não primary), pq cores escuras
  // como cinza/cinza-slate ficam invisíveis sobre dark navy + hero overlay.
  // O ouro/amarelo de uma BU de luxo seria o único caso que funcionaria
  // como primary direto, mas pra ser consistente: cover = branco sempre.

  // Subtitle: ROTEIRO DE VIAGEM (sem charSpace — jsPDF align:center não compensa
  // o spacing extra e o texto fica deslocado vs o separador abaixo).
  doc.setFont('Poppins', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text('ROTEIRO DE VIAGEM', PAGE_W / 2, destY + 8, { align: 'center' });

  // Thin separator branco
  doc.setFillColor(255, 255, 255);
  doc.rect(70, destY + 14, PAGE_W - 140, 0.4, 'F');

  // Duration badge — borda + texto branco
  const nights = roteiro.travel?.nights || destinations.reduce((s, d) => s + (d.nights || 0), 0);
  const badgeText = `${nights} NOITE${nights !== 1 ? 'S' : ''}`;
  const badgeY = destY + 26;

  doc.setFont('Poppins', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);

  const badgeW = Math.min(doc.getTextWidth(badgeText) + 24, CONTENT_W);
  const badgeX = (PAGE_W - badgeW) / 2;
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.4);
  doc.roundedRect(badgeX, badgeY - 6, badgeW, 12, 2, 2, 'S');
  doc.text(badgeText, PAGE_W / 2, badgeY + 2, { align: 'center' });

  // Date range — branco quase puro pra contraste sobre fundo escuro
  if (roteiro.travel?.startDate && roteiro.travel?.endDate) {
    doc.setFont('Poppins', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(245, 245, 245);
    const dateStr = `${fmtDateFull(roteiro.travel.startDate)}  a  ${fmtDateFull(roteiro.travel.endDate)}`;
    doc.text(dateStr, PAGE_W / 2, badgeY + 20, { align: 'center' });
  }

  // Bottom accent line — branco (capa sobre fundo escuro)
  doc.setFillColor(255, 255, 255);
  doc.rect(30, PAGE_H - 60, PAGE_W - 60, 0.6, 'F');

  // Client name \u2014 branco quase puro pra ler sobre hero/overlay
  if (roteiro.client?.name) {
    doc.setFont('Poppins', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text(`Preparado para ${roteiro.client.name}`, PAGE_W / 2, PAGE_H - 48, { align: 'center' });

    const paxParts = [];
    if (roteiro.client.adults) paxParts.push(`${roteiro.client.adults} adulto${roteiro.client.adults > 1 ? 's' : ''}`);
    if (roteiro.client.children) paxParts.push(`${roteiro.client.children} crian\u00E7a${roteiro.client.children > 1 ? 's' : ''}`);
    if (paxParts.length) {
      doc.setFont('Poppins', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(230, 230, 230);
      doc.text(paxParts.join(' + '), PAGE_W / 2, PAGE_H - 41, { align: 'center' });
    }
  }

  // Title at very bottom \u2014 branco mais leve, ainda leg\u00EDvel
  if (roteiro.title) {
    doc.setFont('Poppins', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(220, 220, 220);
    doc.text(roteiro.title, PAGE_W / 2, PAGE_H - 22, { align: 'center' });
  }
}

/* ─── Day by Day ──────────────────────────────────────────── */
async function buildDayByDayPages(doc, roteiro, primary, secondary, accent, byCity = {}) {
  const [pr, pg, pb] = hexToRgb(primary);
  const [sr, sg, sb] = hexToRgb(secondary);
  const [ar, ag, ab] = hexToRgb(accent);

  let y = MARGIN;

  // Section header
  y = addSectionTitle(doc, y, 'ROTEIRO DIA A DIA', primary, secondary);
  y += 4;

  // Pré-fetch das imagens das cidades como dataURL (paralelo, não-blocker)
  // Cover-crop pra dimensão final do banner (CONTENT_W-14 × 28mm) — sem distorção.
  const dayBannerW = CONTENT_W - 14, dayBannerH = 28;
  const cityImageData = {};
  await Promise.allSettled(
    Object.entries(byCity).map(async ([key, url]) => {
      const raw = await fetchImgData(url);
      if (!raw) return;
      const fitted = await coverCropImage({
        dataUrl: raw, finalWmm: dayBannerW, finalHmm: dayBannerH,
      }).catch(() => raw);
      cityImageData[key] = fitted;
    })
  );

  for (let i = 0; i < roteiro.days.length; i++) {
    const day = roteiro.days[i];
    const cityKey = day.city
      ? day.city.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      : '';
    const dayImageData = cityImageData[cityKey] || null;

    // Estimate space: header + city + image + narrative + overnight + padding
    const narrativeLines = day.narrative
      ? doc.splitTextToSize(day.narrative, CONTENT_W - 15).length
      : 0;
    const neededSpace = 20 + (narrativeLines * 5) + (dayImageData ? 32 : 0) + 15;
    y = checkPageBreak(doc, y, Math.min(neededSpace, 80));

    // Day number circle — fill = primary, número = branco (max contraste)
    doc.setFillColor(pr, pg, pb);
    doc.circle(MARGIN + 5, y + 4, 5, 'F');
    doc.setFont('Poppins', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(String(day.dayNumber || i + 1), MARGIN + 5, y + 5.5, { align: 'center' });

    // "DIA X -- date" header
    doc.setFont('Poppins', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(sr, sg, sb);
    const dayLabel = `DIA ${day.dayNumber || i + 1}`;
    let labelX = MARGIN + 14;
    doc.text(dayLabel, labelX, y + 5.5);

    if (day.date) {
      doc.setFont('Poppins', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(130, 130, 130);
      doc.text(`\u2014 ${fmtDateBR(day.date)}`, labelX + doc.getTextWidth(dayLabel) + 3, y + 5.5);
    }

    y += 10;

    // City in accent color
    if (day.city) {
      doc.setFont('Poppins', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(ar, ag, ab);
      doc.text(day.city.toUpperCase(), MARGIN + 14, y + 3, { charSpace: 1.5 });
      y += 8;
    }

    // Imagem do dia (banner full-width, ~28mm altura) — visual divider
    if (dayImageData) {
      try {
        const imgX = MARGIN + 14;
        const imgW = CONTENT_W - 14;
        const imgH = 28;
        // Borda sutil
        doc.setDrawColor(220, 220, 220);
        doc.setLineWidth(0.2);
        doc.rect(imgX - 0.3, y - 0.3, imgW + 0.6, imgH + 0.6);
        doc.addImage(dayImageData, 'JPEG', imgX, y, imgW, imgH, undefined, 'FAST');
        y += imgH + 4;
      } catch (e) {
        console.warn('[roteiroGenerator] day image render falhou:', e.message);
      }
    }

    // Title (if different from city)
    if (day.title && day.title !== day.city) {
      doc.setFont('Poppins', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(sr, sg, sb);
      const titleLines = doc.splitTextToSize(day.title, CONTENT_W - 15);
      doc.text(titleLines, MARGIN + 14, y + 3);
      y += titleLines.length * 4.5 + 2;
    }

    // Narrative text (10pt, justified feel)
    if (day.narrative) {
      doc.setFont('Poppins', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(60, 60, 60);
      const lines = doc.splitTextToSize(day.narrative, CONTENT_W - 15);

      let lineIdx = 0;
      while (lineIdx < lines.length) {
        const availableLines = Math.floor((PAGE_H - MARGIN - y) / 4.8);
        if (availableLines <= 0) {
          doc.addPage();
          y = MARGIN;
          continue;
        }
        const chunk = lines.slice(lineIdx, lineIdx + availableLines);
        doc.text(chunk, MARGIN + 14, y + 3);
        y += chunk.length * 4.8;
        lineIdx += chunk.length;

        if (lineIdx < lines.length) {
          doc.addPage();
          y = MARGIN;
        }
      }
      y += 2;
    }

    // Activities list (time + description)
    if (day.activities?.length) {
      for (const act of day.activities) {
        y = checkPageBreak(doc, y, 10);

        if (act.time) {
          doc.setFont('Poppins', 'bold');
          doc.setFontSize(8);
          doc.setTextColor(pr, pg, pb);
          doc.text(act.time, MARGIN + 14, y + 3);
        }

        const descX = act.time ? MARGIN + 28 : MARGIN + 14;
        const descW = CONTENT_W - (descX - MARGIN);
        doc.setFont('Poppins', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(60, 60, 60);
        const actLines = doc.splitTextToSize(act.description || act.text || '', descW);
        doc.text(actLines, descX, y + 3);
        y += actLines.length * 3.8 + 2;
      }
    }

    // Overnight city
    if (day.overnightCity) {
      y = checkPageBreak(doc, y, 10);
      doc.setFont('Poppins', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(pr, pg, pb);
      doc.text(`Pernoite: ${day.overnightCity}`, MARGIN + 14, y + 3);
      y += 8;
    }

    // Separator between days
    if (i < roteiro.days.length - 1) {
      y = checkPageBreak(doc, y, 8);
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.2);
      doc.line(MARGIN + 14, y, PAGE_W - MARGIN, y);
      y += 6;
    }
  }
}

/* ─── Hotels Table ────────────────────────────────────────── */
async function buildHotelsSection(doc, roteiro, primary, secondary, byHotel = {}) {
  const [pr, pg, pb] = hexToRgb(primary);
  const [sr, sg, sb] = hexToRgb(secondary);

  let y = MARGIN;
  y = addSectionTitle(doc, y, 'HOSPEDAGEM', primary, secondary);
  y += 2;

  // Faixa de thumbnails — até 4 hotéis com imagem, lado a lado
  const hotelsWithImg = roteiro.hotels
    .map((h, i) => ({ h, i, url: byHotel?.[i] }))
    .filter(x => x.url)
    .slice(0, 4);

  if (hotelsWithImg.length) {
    const usableW = PAGE_W - 2 * MARGIN;
    const gap = 3;
    const thumbW = (usableW - gap * (hotelsWithImg.length - 1)) / hotelsWithImg.length;
    const thumbH = 32; // mm
    const captionH = 6;

    for (let k = 0; k < hotelsWithImg.length; k++) {
      const x = MARGIN + k * (thumbW + gap);
      const item = hotelsWithImg[k];
      const raw = await fetchImgData(item.url);
      if (raw) {
        // Cover-crop pra preencher o thumb sem distorção
        const fitted = await coverCropImage({
          dataUrl: raw, finalWmm: thumbW, finalHmm: thumbH,
        }).catch(() => raw);
        try {
          doc.addImage(fitted, 'JPEG', x, y, thumbW, thumbH, undefined, 'FAST');
        } catch (e) { /* ignore */ }
      }
      // Legenda
      doc.setFont('Poppins', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(80, 80, 80);
      const cap = (item.h.hotelName || item.h.city || '').slice(0, 30);
      doc.text(cap, x + thumbW / 2, y + thumbH + 4, { align: 'center', maxWidth: thumbW });
    }
    y += thumbH + captionH + 4;
  }

  const tableBody = roteiro.hotels.map(h => {
    const period = [h.checkIn, h.checkOut].filter(Boolean).map(fmtDateBR).join(' a ');
    return [
      h.city || '',
      h.hotelName || '',
      h.category || h.roomType || '',
      h.regime || '',
      h.checkIn ? fmtDateBR(h.checkIn) : '',
      h.checkOut ? fmtDateBR(h.checkOut) : '',
      h.nights != null ? String(h.nights) : '',
    ];
  });

  doc.autoTable({
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [['Cidade', 'Hotel', 'Categoria', 'Regime', 'Check-in', 'Check-out', 'Noites']],
    body: tableBody,
    theme: 'grid',
    headStyles: {
      fillColor: [sr, sg, sb],
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
      halign: 'center',
      cellPadding: 3,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [50, 50, 50],
      cellPadding: 2.5,
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245],
    },
    columnStyles: {
      0: { cellWidth: 25 },
      1: { cellWidth: 40 },
      2: { cellWidth: 25 },
      3: { cellWidth: 25 },
      4: { cellWidth: 20, halign: 'center' },
      5: { cellWidth: 20, halign: 'center' },
      6: { cellWidth: 13, halign: 'center' },
    },
    styles: {
      lineColor: [220, 220, 220],
      lineWidth: 0.3,
    },
  });
}

/* ─── Pricing ─────────────────────────────────────────────── */
function buildPricingSection(doc, roteiro, primary, secondary) {
  const [pr, pg, pb] = hexToRgb(primary);
  const [sr, sg, sb] = hexToRgb(secondary);
  const pricing = roteiro.pricing;
  const currency = pricing.currency || 'USD';

  let y = (doc.lastAutoTable?.finalY || 0) + 15;
  if (!y || y > PAGE_H - 80) {
    doc.addPage();
    y = MARGIN;
  }

  y = addSectionTitle(doc, y, 'VALORES', primary, secondary);
  y += 2;

  const rows = [];
  if (pricing.perPerson) {
    rows.push(['Valor por pessoa', formatCurrency(pricing.perPerson, currency)]);
  }
  if (pricing.perCouple) {
    rows.push(['Valor por casal', formatCurrency(pricing.perCouple, currency)]);
  }
  if (pricing.validUntil) {
    rows.push(['Validade da cota\u00E7\u00E3o', fmtDateFull(pricing.validUntil)]);
  }
  if (pricing.customRows?.length) {
    for (const cr of pricing.customRows) {
      if (cr.label) rows.push([cr.label, cr.value || '']);
    }
  }

  if (rows.length) {
    doc.autoTable({
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      body: rows,
      theme: 'plain',
      bodyStyles: {
        fontSize: 10,
        textColor: [50, 50, 50],
        cellPadding: 3,
      },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 55, textColor: [sr, sg, sb] },
        1: { halign: 'left', cellWidth: CONTENT_W - 55 },
      },
      styles: {
        lineColor: [230, 230, 230],
        lineWidth: 0.2,
      },
      didDrawCell: (data) => {
        if (data.row.index === 0 && data.section === 'body') {
          doc.setDrawColor(pr, pg, pb);
          doc.setLineWidth(0.5);
          doc.line(data.cell.x, data.cell.y, data.cell.x + data.cell.width, data.cell.y);
        }
      },
    });

    y = doc.lastAutoTable.finalY + 5;
  }

  // Disclaimer (8pt, muted)
  if (pricing.disclaimer) {
    y = checkPageBreak(doc, y, 25);
    doc.setFont('Poppins', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    const disclaimerLines = doc.splitTextToSize(pricing.disclaimer, CONTENT_W);
    doc.text(disclaimerLines, MARGIN, y + 3);
  }
}

/* ─── Optionals ───────────────────────────────────────────── */
function buildOptionalsSection(doc, roteiro, primary, secondary) {
  const [pr, pg, pb] = hexToRgb(primary);
  const [sr, sg, sb] = hexToRgb(secondary);

  let y = (doc.lastAutoTable?.finalY || 0) + 15;
  if (y > PAGE_H - 60) {
    doc.addPage();
    y = MARGIN;
  }

  y = addSectionTitle(doc, y, 'SERVI\u00C7OS OPCIONAIS', primary, secondary);
  y += 2;

  const currency = roteiro.pricing?.currency || 'USD';
  const tableBody = roteiro.optionals.map(o => [
    o.service || '',
    o.priceAdult != null ? formatCurrency(o.priceAdult, currency) : '\u2014',
    o.priceChild != null ? formatCurrency(o.priceChild, currency) : '\u2014',
    o.notes || o.observations || '',
  ]);

  doc.autoTable({
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [['Servi\u00E7o', 'Pre\u00E7o Adulto', 'Pre\u00E7o Crian\u00E7a', 'Observa\u00E7\u00F5es']],
    body: tableBody,
    theme: 'grid',
    headStyles: {
      fillColor: [sr, sg, sb],
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
      halign: 'center',
      cellPadding: 3,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [50, 50, 50],
      cellPadding: 2.5,
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245],
    },
    columnStyles: {
      0: { cellWidth: 65 },
      1: { cellWidth: 30, halign: 'center' },
      2: { cellWidth: 30, halign: 'center' },
      3: { cellWidth: 43 },
    },
    styles: {
      lineColor: [220, 220, 220],
      lineWidth: 0.3,
    },
  });
}

/* ─── Includes / Excludes ─────────────────────────────────── */
function buildIncludesExcludes(doc, roteiro, primary, secondary) {
  const [pr, pg, pb] = hexToRgb(primary);
  const [sr, sg, sb] = hexToRgb(secondary);

  let y = (doc.lastAutoTable?.finalY || 0) + 15;
  if (y > PAGE_H - 80) {
    doc.addPage();
    y = MARGIN;
  }

  // Helpers locais \u2014 Poppins n\u00E3o tem \u2713/\u2715, ent\u00E3o desenhamos com shapes
  const drawCheck = (cx, cy) => {
    doc.setDrawColor(34, 139, 34);
    doc.setLineWidth(0.6);
    // V invertido representando check
    doc.line(cx - 1.5, cy + 0.2, cx - 0.3, cy + 1.4);
    doc.line(cx - 0.3, cy + 1.4, cx + 1.8, cy - 1.2);
  };
  const drawCross = (cx, cy) => {
    doc.setDrawColor(200, 60, 60);
    doc.setLineWidth(0.6);
    doc.line(cx - 1.5, cy - 1.2, cx + 1.5, cy + 1.2);
    doc.line(cx - 1.5, cy + 1.2, cx + 1.5, cy - 1.2);
  };

  // INCLUDES
  if (roteiro.includes?.length) {
    y = addSectionTitle(doc, y, 'O ROTEIRO INCLUI', primary, secondary);
    y += 3;

    for (const item of roteiro.includes) {
      y = checkPageBreak(doc, y, 8);
      drawCheck(MARGIN + 3, y + 2);
      doc.setFont('Poppins', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(50, 50, 50);
      const lines = doc.splitTextToSize(item, CONTENT_W - 12);
      doc.text(lines, MARGIN + 10, y + 3);
      y += lines.length * 4.5 + 2;
    }
    y += 6;
  }

  // EXCLUDES
  if (roteiro.excludes?.length) {
    y = checkPageBreak(doc, y, 20);
    y = addSectionTitle(doc, y, 'O ROTEIRO N\u00C3O INCLUI', primary, secondary);
    y += 3;

    for (const item of roteiro.excludes) {
      y = checkPageBreak(doc, y, 8);
      drawCross(MARGIN + 3, y + 2);
      doc.setFont('Poppins', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(50, 50, 50);
      const lines = doc.splitTextToSize(item, CONTENT_W - 12);
      doc.text(lines, MARGIN + 10, y + 3);
      y += lines.length * 4.5 + 2;
    }
  }

  // Anchor pra pr\u00F3xima se\u00E7\u00E3o saber onde paramos
  doc.lastAutoTable = { finalY: y };
}

/* ─── Payment Terms ───────────────────────────────────────── */
function buildPaymentSection(doc, roteiro, primary, secondary) {
  const [pr, pg, pb] = hexToRgb(primary);
  const [sr, sg, sb] = hexToRgb(secondary);
  const payment = roteiro.payment;

  let y = (doc.lastAutoTable?.finalY || 0) + 15;
  if (y > PAGE_H - 60) {
    doc.addPage();
    y = MARGIN;
  }

  y = addSectionTitle(doc, y, 'CONDI\u00C7\u00D5ES DE PAGAMENTO', primary, secondary);
  y += 4;

  const entries = [
    { label: 'Sinal / Dep\u00F3sito', value: payment.deposit },
    { label: 'Parcelamento', value: payment.installments },
    { label: 'Prazo', value: payment.deadline },
    { label: 'Observa\u00E7\u00F5es', value: payment.notes },
  ].filter(e => e.value);

  for (const entry of entries) {
    y = checkPageBreak(doc, y, 15);

    doc.setFont('Poppins', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(sr, sg, sb);
    doc.text(entry.label + ':', MARGIN + 3, y + 3);

    doc.setFont('Poppins', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(60, 60, 60);
    const lines = doc.splitTextToSize(entry.value, CONTENT_W - 48);
    doc.text(lines, MARGIN + 45, y + 3);
    y += Math.max(lines.length * 4.5, 6) + 3;
  }

  // Anchor pra próxima seção saber onde paramos
  doc.lastAutoTable = { finalY: y };
}

/* ─── Cancellation Policy ─────────────────────────────────── */
function buildCancellationSection(doc, roteiro, primary, secondary) {
  const [pr, pg, pb] = hexToRgb(primary);
  const [sr, sg, sb] = hexToRgb(secondary);

  let y = (doc.lastAutoTable?.finalY || 0) + 15;
  if (y > PAGE_H - 60) {
    doc.addPage();
    y = MARGIN;
  }

  y = addSectionTitle(doc, y, 'POL\u00CDTICA DE CANCELAMENTO', primary, secondary);
  y += 2;

  const tableBody = roteiro.cancellation.map(c => [
    c.period || '',
    c.penalty || '',
  ]);

  doc.autoTable({
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [['Per\u00EDodo', 'Penalidade']],
    body: tableBody,
    theme: 'grid',
    headStyles: {
      fillColor: [sr, sg, sb],
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
      halign: 'center',
      cellPadding: 3,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [50, 50, 50],
      cellPadding: 2.5,
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245],
    },
    columnStyles: {
      0: { cellWidth: 89 },
      1: { cellWidth: 89 },
    },
    styles: {
      lineColor: [220, 220, 220],
      lineWidth: 0.3,
    },
  });
}

/* ─── Important Info ──────────────────────────────────────── */
function hasImportantInfo(info) {
  if (!info) return false;
  return !!(info.passport || info.visa || info.vaccines || info.climate ||
            info.luggage || info.flights || info.customFields?.length);
}

function buildImportantInfoSection(doc, roteiro, primary, secondary) {
  const [pr, pg, pb] = hexToRgb(primary);
  const [sr, sg, sb] = hexToRgb(secondary);
  const info = roteiro.importantInfo;

  let y = (doc.lastAutoTable?.finalY || 0) + 15;
  if (y > PAGE_H - 60) {
    doc.addPage();
    y = MARGIN;
  }

  y = addSectionTitle(doc, y, 'INFORMA\u00C7\u00D5ES IMPORTANTES', primary, secondary);
  y += 4;

  const sections = [
    { label: 'PASSAPORTE', value: info.passport },
    { label: 'VISTO', value: info.visa },
    { label: 'VACINAS', value: info.vaccines },
    { label: 'CLIMA', value: info.climate },
    { label: 'BAGAGEM', value: info.luggage },
    { label: 'VOOS', value: info.flights },
  ].filter(s => s.value);

  // Custom fields
  if (info.customFields?.length) {
    for (const cf of info.customFields) {
      if (cf.label && cf.value) {
        sections.push({ label: cf.label.toUpperCase(), value: cf.value });
      }
    }
  }

  for (const section of sections) {
    y = checkPageBreak(doc, y, 20);

    // Sub-label (8pt, primary color)
    doc.setFont('Poppins', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(pr, pg, pb);
    doc.text(section.label, MARGIN + 3, y + 3, { charSpace: 0.8 });
    y += 7;

    // Content (10pt body)
    doc.setFont('Poppins', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(60, 60, 60);
    const lines = doc.splitTextToSize(section.value, CONTENT_W - 6);

    let lineIdx = 0;
    while (lineIdx < lines.length) {
      const availableLines = Math.floor((PAGE_H - MARGIN - y) / 4.5);
      if (availableLines <= 0) {
        doc.addPage();
        y = MARGIN;
        continue;
      }
      const chunk = lines.slice(lineIdx, lineIdx + availableLines);
      doc.text(chunk, MARGIN + 3, y + 3);
      y += chunk.length * 4.5;
      lineIdx += chunk.length;

      if (lineIdx < lines.length) {
        doc.addPage();
        y = MARGIN;
      }
    }
    y += 5;
  }

  // Anchor pra próxima seção (closing page) saber onde paramos
  doc.lastAutoTable = { finalY: y };
}

/* ─── 4.42.0+ Sprint 3: Dicas anexas (Portal de Dicas embed) ──
 *
 * Renderiza cada dica anexada como seção própria com título + segments.
 * Snapshot foi feito no momento do anexo — usamos `content.segments` como
 * source of truth, não live do portal.
 *
 * Cada segmento (atrações, restaurantes, etc) vira sub-bloco com items.
 * Items podem ser objetos (place_list) ou strings (simple_list).
 */
function buildEmbeddedTipsSection(doc, roteiro, primary, secondary) {
  const [pr, pg, pb] = hexToRgb(primary);
  const embedded = roteiro.embeddedTips || [];
  if (!embedded.length) return;

  let y = (doc.lastAutoTable?.finalY || 0) + 15;
  if (y > PAGE_H - 60) { doc.addPage(); y = MARGIN; }

  y = addSectionTitle(doc, y, 'DICAS LOCAIS', primary, secondary);
  y += 4;

  for (const emb of embedded) {
    // Header da dica (cidade, país)
    y = checkPageBreak(doc, y, 25);
    doc.setFont('Poppins', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(pr, pg, pb);
    doc.text(emb.title || '(Sem destino)', MARGIN + 3, y + 4);
    y += 6;

    if (emb.subtitle) {
      doc.setFont('Poppins', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(140, 140, 140);
      doc.text(emb.subtitle, MARGIN + 3, y + 3);
      y += 6;
    }

    // Renderiza segments (pegamos apenas os que têm items)
    const segments = emb.content?.segments || {};
    for (const [segKey, items] of Object.entries(segments)) {
      if (!Array.isArray(items) || items.length === 0) continue;

      // Label do segmento (usa key humanizada como fallback)
      const segLabel = humanizeSegmentKey(segKey);
      y = checkPageBreak(doc, y, 12);
      doc.setFont('Poppins', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(pr, pg, pb);
      doc.text(segLabel.toUpperCase(), MARGIN + 3, y + 3, { charSpace: 0.6 });
      y += 6;

      // Items — adaptamos pra string OU objeto
      doc.setFont('Poppins', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(60, 60, 60);
      for (const item of items) {
        y = checkPageBreak(doc, y, 10);
        let line;
        if (typeof item === 'string') {
          line = '· ' + item;
        } else if (item && typeof item === 'object') {
          const parts = [];
          if (item.name)        parts.push(item.name);
          if (item.address)     parts.push(item.address);
          else if (item.location) parts.push(item.location);
          if (item.note || item.description) parts.push(item.note || item.description);
          line = '· ' + parts.filter(Boolean).join(' — ');
        } else {
          continue;
        }
        const lines = doc.splitTextToSize(line, CONTENT_W - 6);
        doc.text(lines, MARGIN + 5, y + 3);
        y += lines.length * 4.5 + 1;
      }
      y += 3;
    }
    y += 6;  // gap entre dicas
  }

  doc.lastAutoTable = { finalY: y };
}

function humanizeSegmentKey(key) {
  // Mapeamento dos DEFAULT_SEGMENTS pra labels humanos.
  // Match com js/services/portal.js DEFAULT_SEGMENTS.
  const MAP = {
    informacoes_gerais:  'Informações Gerais',
    bairros:             'Bairros',
    atracoes:            'Atrações',
    atracoes_criancas:   'Atrações para Crianças',
    restaurantes:        'Restaurantes',
    vida_noturna:        'Vida Noturna',
    espetaculos:         'Casas de Espetáculos',
    compras:             'Compras',
    arredores:           'Arredores',
    highlights:          'Highlights',
    agenda_cultural:     'Agenda Cultural',
  };
  if (MAP[key]) return MAP[key];
  // Fallback: snake_case → Title Case
  return key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/* ─── Closing Page ────────────────────────────────────────── */
function buildClosingPage(doc, roteiro, buName, primary, secondary, logoCoverPng = null) {
  const [pr, pg, pb] = hexToRgb(primary);
  const [sr, sg, sb] = hexToRgb(secondary);

  doc.addPage();

  // Fundo escuro
  doc.setFillColor(sr, sg, sb);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

  // Linhas brancas (n\u00E3o primary cinza \u2014 contraste ruim)
  doc.setFillColor(255, 255, 255);
  doc.rect(50, PAGE_H / 2 - 35, PAGE_W - 100, 0.6, 'F');

  // Logo grande no centro (substitui texto "PRIMETOUR")
  if (logoCoverPng) {
    const lw = logoCoverPng.widthMm, lh = logoCoverPng.heightMm;
    const lx = (PAGE_W - lw) / 2;
    const ly = PAGE_H / 2 - 25;
    try {
      doc.addImage(logoCoverPng.dataUrl, 'PNG', lx, ly, lw, lh, undefined, 'SLOW');
    } catch (e) { /* fallback abaixo */ }
  } else {
    doc.setFont('Poppins', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(255, 255, 255);
    doc.text(buName, PAGE_W / 2, PAGE_H / 2 - 5, { align: 'center' });
  }

  // "Boa viagem!" abaixo do logo
  doc.setFont('Poppins', 'italic');
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text('Boa viagem!', PAGE_W / 2, PAGE_H / 2 + 30, { align: 'center' });

  // Tagline branca
  doc.setFont('Poppins', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(230, 230, 230);
  doc.text('Experi\u00EAncias exclusivas de viagem', PAGE_W / 2, PAGE_H / 2 + 40, { align: 'center' });

  // Linha inferior branca
  doc.setFillColor(255, 255, 255);
  doc.rect(50, PAGE_H / 2 + 50, PAGE_W - 100, 0.6, 'F');

  // Contato (se houver)
  const contact = roteiro.contact || roteiro.client?.agentEmail;
  if (contact) {
    doc.setFont('Poppins', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(220, 220, 220);
    doc.text(contact, PAGE_W / 2, PAGE_H / 2 + 62, { align: 'center' });
  }
}

/* ═══════════════════════════════════════════════════════════════
   PPTX GENERATION
   ═══════════════════════════════════════════════════════════════ */

/**
 * Generate travel itinerary as PowerPoint presentation
 */
export async function generateRoteiroPPTX(roteiro, area = null) {
  await loadPptxGenJS();

  // Cores neutras default (cinza/azul-escuro, não amarelo)
  const primary = (area?.colors?.primary || '#475569').replace('#', '');
  const secondary = (area?.colors?.secondary || '#0F172A').replace('#', '');
  // Branding externo: sempre PRIMETOUR (não exibe nome interno da BU "Lazer")
  const buName = 'PRIMETOUR';

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = buName;
  pptx.title = roteiro.title || 'Roteiro de Viagem';

  const W = 10, H = 5.625;

  // ─── Resolve imagens (hero + cidades + hotéis) ────────────
  let images = { heroUrl: null, byCity: {}, byHotel: {} };
  try { images = await enrichRoteiroImages(roteiro); }
  catch (e) { console.warn('[roteiroGenerator PPTX] enrichRoteiroImages falhou:', e.message); }

  // Pre-fetch base64 + cover-crop pra dimensões finais (sem distorção)
  // PPTX usa polegadas; conversão pra mm via × 25.4
  const heroDataRaw = images.heroUrl ? await fetchImgData(images.heroUrl) : null;
  const heroData = heroDataRaw
    ? await coverCropImage({ dataUrl: heroDataRaw, finalWmm: W * 25.4, finalHmm: H * 25.4 }).catch(() => heroDataRaw)
    : null;
  const cityData = {};
  await Promise.allSettled(Object.entries(images.byCity).map(async ([k, url]) => {
    const raw = await fetchImgData(url);
    if (!raw) return;
    // Tamanho usado no card de dia: 2.4 × 2.0 inches
    const fitted = await coverCropImage({ dataUrl: raw, finalWmm: 2.4 * 25.4, finalHmm: 2.0 * 25.4 }).catch(() => raw);
    cityData[k] = fitted;
  }));
  const hotelData = {};
  await Promise.allSettled(Object.entries(images.byHotel).map(async ([k, url]) => {
    const raw = await fetchImgData(url);
    if (!raw) return;
    // Hotel thumb varia por num de hotéis, mas ~2.1 × 1.4 in
    const fitted = await coverCropImage({ dataUrl: raw, finalWmm: 2.1 * 25.4, finalHmm: 1.4 * 25.4 }).catch(() => raw);
    hotelData[k] = fitted;
  }));

  // Logo da área convertido pra PNG limpo com alpha (sem fundo "card")
  let logoCleanData = null, logoRatio = 3;
  if (area?.logoUrl) {
    try {
      const raw = await fetchImgData(area.logoUrl);
      if (raw) {
        const cleaned = await pngWithAlpha(raw).catch(() => null);
        if (cleaned) {
          logoCleanData = cleaned.dataUrl;
          logoRatio = cleaned.naturalW / Math.max(cleaned.naturalH, 1);
        }
      }
    } catch (e) { /* silencioso */ }
  }

  // ─── Slide 1: Cover ───────────────────────────────────────
  const cover = pptx.addSlide();
  cover.background = { color: secondary };

  // Hero full-bleed com cover-crop nativo + overlay escuro
  if (heroData) {
    cover.addImage({ data: heroData, x: 0, y: 0, w: W, h: H, sizing: { type: 'cover', w: W, h: H } });
    cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: secondary, transparency: 50 } });
  }

  // Linhas brancas (não primary cinza — invisível sobre dark)
  cover.addShape(pptx.ShapeType.rect, { x: 1, y: 1.0, w: W - 2, h: 0.02, fill: { color: 'FFFFFF' } });

  // Logo grande centralizado (substitui "PRIMETOUR" texto)
  if (logoCleanData) {
    const logoH = 1.4;  // inches
    const logoW = logoH * logoRatio;
    const logoX = (W - logoW) / 2;
    cover.addImage({ data: logoCleanData, x: logoX, y: 1.2, w: logoW, h: logoH });
  } else {
    cover.addText(buName, { x: 0, y: 1.4, w: W, h: 0.6, align: 'center', fontSize: 28, bold: true, color: 'FFFFFF' });
  }

  const destNames = (roteiro.travel?.destinations || []).map(d => d.city || d.country).filter(Boolean);
  cover.addText(destNames.join('  |  ').toUpperCase(), {
    x: 0.5, y: 2.9, w: W - 1, h: 0.5, align: 'center', fontSize: 22, bold: true, color: 'FFFFFF',
  });

  cover.addText('ROTEIRO DE VIAGEM', {
    x: 0, y: 3.5, w: W, h: 0.35, align: 'center', fontSize: 13, bold: true, color: 'FFFFFF',
  });

  const nights = roteiro.travel?.nights || roteiro.days?.length || 0;
  cover.addText(`${nights} NOITE${nights !== 1 ? 'S' : ''}`, {
    x: 0, y: 3.9, w: W, h: 0.35, align: 'center', fontSize: 12, color: 'FFFFFF',
  });

  // Datas
  if (roteiro.travel?.startDate && roteiro.travel?.endDate) {
    cover.addText(`${fmtDateFull(roteiro.travel.startDate)}  a  ${fmtDateFull(roteiro.travel.endDate)}`, {
      x: 0, y: 4.3, w: W, h: 0.3, align: 'center', fontSize: 11, color: 'F5F5F5',
    });
  }

  // Linha branca inferior
  cover.addShape(pptx.ShapeType.rect, { x: 1, y: 4.7, w: W - 2, h: 0.02, fill: { color: 'FFFFFF' } });

  // Cliente + pax na parte inferior
  if (roteiro.client?.name) {
    cover.addText(`Preparado para ${roteiro.client.name}`, {
      x: 0, y: 4.85, w: W, h: 0.3, align: 'center', fontSize: 11, bold: true, color: 'FFFFFF',
    });
    const paxParts = [];
    if (roteiro.client.adults) paxParts.push(`${roteiro.client.adults} adulto${roteiro.client.adults > 1 ? 's' : ''}`);
    if (roteiro.client.children) paxParts.push(`${roteiro.client.children} criança${roteiro.client.children > 1 ? 's' : ''}`);
    if (paxParts.length) {
      cover.addText(paxParts.join(' + '), {
        x: 0, y: 5.15, w: W, h: 0.25, align: 'center', fontSize: 10, color: 'E6E6E6',
      });
    }
  }

  // ─── Day-by-day slides ─────────────────────────────────────
  const days = roteiro.days || [];
  for (let i = 0; i < days.length; i += 2) {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };

    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.6, fill: { color: secondary } });
    slide.addText('ROTEIRO SUGERIDO', { x: 0.5, y: 0.05, w: W - 1, h: 0.5, fontSize: 14, bold: true, color: 'FFFFFF' });

    for (let j = 0; j < 2 && (i + j) < days.length; j++) {
      const d = days[i + j];
      const yBase = 0.8 + j * 2.3;

      // Imagem da cidade (à direita) — encolhe o texto p/ caber
      const cityKey = normKey(d.city);
      const cityImg = cityData[cityKey];
      const textW = cityImg ? 6.0 : 8.5;

      // Bolinha do dia: fill primary, número BRANCO (max contraste)
      slide.addShape(pptx.ShapeType.ellipse, { x: 0.4, y: yBase, w: 0.45, h: 0.45, fill: { color: primary } });
      slide.addText(`${d.dayNumber || i + j + 1}`, { x: 0.4, y: yBase, w: 0.45, h: 0.45, align: 'center', valign: 'middle', fontSize: 12, bold: true, color: 'FFFFFF' });

      const dateText = d.date ? fmtDateBR(d.date) : '';
      slide.addText(`${dateText} - ${d.city || ''}`, { x: 1, y: yBase, w: 3, h: 0.35, fontSize: 11, bold: true, color: secondary });

      if (d.title) {
        slide.addText(d.title, { x: 1, y: yBase + 0.3, w: textW, h: 0.3, fontSize: 10, bold: true, color: '333333' });
      }

      const narrative = (d.narrative || '').substring(0, 500);
      if (narrative) {
        slide.addText(narrative, { x: 1, y: yBase + 0.6, w: textW, h: 1.5, fontSize: 8.5, color: '555555', valign: 'top', wrap: true });
      }

      if (d.overnightCity) {
        slide.addText(`Noite: ${d.overnightCity}`, { x: 1, y: yBase + 2.0, w: 4, h: 0.25, fontSize: 8, italic: true, color: primary });
      }

      if (cityImg) {
        slide.addImage({ data: cityImg, x: 7.3, y: yBase, w: 2.4, h: 2.0, sizing: { type: 'cover', w: 2.4, h: 2.0 } });
      }
    }
  }

  // ─── Hotels slide ──────────────────────────────────────────
  if (roteiro.hotels?.length) {
    const hSlide = pptx.addSlide();
    hSlide.background = { color: 'FFFFFF' };
    hSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.6, fill: { color: secondary } });
    hSlide.addText('HOSPEDAGEM', { x: 0.5, y: 0.05, w: W - 1, h: 0.5, fontSize: 14, bold: true, color: 'FFFFFF' });

    // Faixa de thumbnails — até 4 hotéis com imagem
    const hotelsWithImg = roteiro.hotels
      .map((h, idx) => ({ h, idx, data: hotelData[idx] }))
      .filter(x => x.data)
      .slice(0, 4);
    let tableY = 0.8;
    if (hotelsWithImg.length) {
      const totalW = W - 1;
      const gap = 0.12;
      const tw = (totalW - gap * (hotelsWithImg.length - 1)) / hotelsWithImg.length;
      const th = 1.4;
      hotelsWithImg.forEach((item, k) => {
        const x = 0.5 + k * (tw + gap);
        hSlide.addImage({ data: item.data, x, y: 0.8, w: tw, h: th, sizing: { type: 'cover', w: tw, h: th } });
        hSlide.addText(item.h.hotelName || item.h.city || '', {
          x, y: 0.8 + th + 0.05, w: tw, h: 0.25, fontSize: 8, bold: true, color: '333333', align: 'center',
        });
      });
      tableY = 0.8 + th + 0.4;
    }

    const rows = [
      [{ text: 'Cidade', options: { bold: true, color: 'FFFFFF', fill: { color: secondary } } },
       { text: 'Hotel', options: { bold: true, color: 'FFFFFF', fill: { color: secondary } } },
       { text: 'Quarto', options: { bold: true, color: 'FFFFFF', fill: { color: secondary } } },
       { text: 'Regime', options: { bold: true, color: 'FFFFFF', fill: { color: secondary } } },
       { text: 'Noites', options: { bold: true, color: 'FFFFFF', fill: { color: secondary } } }],
    ];
    roteiro.hotels.forEach(h => {
      rows.push([h.city || '', h.hotelName || '', h.roomType || '', h.regime || '', String(h.nights || '')]);
    });
    hSlide.addTable(rows, { x: 0.5, y: tableY, w: W - 1, fontSize: 9, border: { pt: 0.5, color: 'CCCCCC' }, colW: [1.8, 2.5, 2, 1.5, 1] });
  }

  // ─── Pricing slide ─────────────────────────────────────────
  if (roteiro.pricing?.perPerson || roteiro.pricing?.perCouple) {
    const pSlide = pptx.addSlide();
    pSlide.background = { color: 'FFFFFF' };
    pSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.6, fill: { color: secondary } });
    pSlide.addText('VALORES', { x: 0.5, y: 0.05, w: W - 1, h: 0.5, fontSize: 14, bold: true, color: 'FFFFFF' });

    let yP = 1;
    const cur = roteiro.pricing.currency || 'USD';
    if (roteiro.pricing.perCouple) {
      pSlide.addText(`DUPLO: ${formatCurrency(roteiro.pricing.perCouple, cur)}`, { x: 1, y: yP, w: 8, h: 0.5, fontSize: 20, bold: true, color: secondary });
      yP += 0.6;
    }
    if (roteiro.pricing.perPerson) {
      pSlide.addText(`POR PESSOA: ${formatCurrency(roteiro.pricing.perPerson, cur)}`, { x: 1, y: yP, w: 8, h: 0.5, fontSize: 20, bold: true, color: secondary });
      yP += 0.6;
    }
    if (roteiro.pricing.disclaimer) {
      pSlide.addText(roteiro.pricing.disclaimer, { x: 1, y: yP + 0.3, w: 8, h: 2, fontSize: 8, color: '888888', italic: true, wrap: true });
    }
  }

  // ─── Includes/Excludes slide ───────────────────────────────
  if (roteiro.includes?.length || roteiro.excludes?.length) {
    const ieSlide = pptx.addSlide();
    ieSlide.background = { color: 'FFFFFF' };
    ieSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.6, fill: { color: secondary } });
    ieSlide.addText('INCLUI / N\u00C3O INCLUI', { x: 0.5, y: 0.05, w: W - 1, h: 0.5, fontSize: 14, bold: true, color: 'FFFFFF' });

    if (roteiro.includes?.length) {
      ieSlide.addText('INCLUI:', { x: 0.5, y: 0.8, w: 4.5, h: 0.35, fontSize: 11, bold: true, color: '22C55E' });
      const incText = roteiro.includes.map(t => `\u2713  ${t}`).join('\n');
      ieSlide.addText(incText, { x: 0.5, y: 1.2, w: 4.5, h: 3.5, fontSize: 8.5, color: '333333', valign: 'top', wrap: true });
    }
    if (roteiro.excludes?.length) {
      ieSlide.addText('N\u00C3O INCLUI:', { x: 5.2, y: 0.8, w: 4.5, h: 0.35, fontSize: 11, bold: true, color: 'EF4444' });
      const excText = roteiro.excludes.map(t => `\u2715  ${t}`).join('\n');
      ieSlide.addText(excText, { x: 5.2, y: 1.2, w: 4.5, h: 3.5, fontSize: 8.5, color: '333333', valign: 'top', wrap: true });
    }
  }

  // ─── 4.44.0+ (Sprint 5) Opcionais slide ───────────────────
  if (Array.isArray(roteiro.optionals) && roteiro.optionals.length) {
    const optSlide = pptx.addSlide();
    optSlide.background = { color: 'FFFFFF' };
    optSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.6, fill: { color: secondary } });
    optSlide.addText('OPCIONAIS', { x: 0.5, y: 0.05, w: W - 1, h: 0.5, fontSize: 14, bold: true, color: 'FFFFFF' });

    const optRows = [[
      { text: 'Serviço',          options: { bold: true, color: 'FFFFFF', fill: { color: secondary } } },
      { text: 'Por adulto',       options: { bold: true, color: 'FFFFFF', fill: { color: secondary } } },
      { text: 'Por criança',      options: { bold: true, color: 'FFFFFF', fill: { color: secondary } } },
      { text: 'Observações',      options: { bold: true, color: 'FFFFFF', fill: { color: secondary } } },
    ]];
    const cur = roteiro.pricing?.currency || 'USD';
    roteiro.optionals.forEach(o => {
      optRows.push([
        o.service || '—',
        o.priceAdult != null ? formatCurrency(o.priceAdult, cur) : '—',
        o.priceChild != null ? formatCurrency(o.priceChild, cur) : '—',
        o.notes || '',
      ]);
    });
    optSlide.addTable(optRows, {
      x: 0.5, y: 0.9, w: W - 1, fontSize: 8.5,
      border: { pt: 0.5, color: 'CCCCCC' },
      colW: [3, 1.6, 1.6, 2.8],
    });
  }

  // ─── 4.44.0+ (Sprint 5) Pagamento slide ───────────────────
  const pay = roteiro.payment;
  if (pay && (pay.deposit || pay.installments || pay.deadline || pay.notes)) {
    const paySlide = pptx.addSlide();
    paySlide.background = { color: 'FFFFFF' };
    paySlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.6, fill: { color: secondary } });
    paySlide.addText('PAGAMENTO', { x: 0.5, y: 0.05, w: W - 1, h: 0.5, fontSize: 14, bold: true, color: 'FFFFFF' });

    let yPay = 1;
    const addPayLine = (label, value) => {
      if (!value) return;
      paySlide.addText(label.toUpperCase(), { x: 0.7, y: yPay, w: 2.5, h: 0.4, fontSize: 9, bold: true, color: primary });
      paySlide.addText(value, { x: 3.3, y: yPay, w: W - 3.8, h: 0.4, fontSize: 10, color: '333333', wrap: true });
      yPay += 0.55;
    };
    addPayLine('Sinal / Depósito', pay.deposit);
    addPayLine('Parcelamento',      pay.installments);
    addPayLine('Prazo',             pay.deadline);
    if (pay.notes) {
      yPay += 0.2;
      paySlide.addText('OBSERVAÇÕES', { x: 0.7, y: yPay, w: W - 1.4, h: 0.3, fontSize: 9, bold: true, color: primary });
      yPay += 0.4;
      paySlide.addText(pay.notes, { x: 0.7, y: yPay, w: W - 1.4, h: 2, fontSize: 9.5, color: '555555', italic: true, valign: 'top', wrap: true });
    }
  }

  // ─── 4.44.0+ (Sprint 5) Cancelamento slide ────────────────
  if (Array.isArray(roteiro.cancellation) && roteiro.cancellation.length) {
    const cSlide = pptx.addSlide();
    cSlide.background = { color: 'FFFFFF' };
    cSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.6, fill: { color: secondary } });
    cSlide.addText('POLÍTICA DE CANCELAMENTO', { x: 0.5, y: 0.05, w: W - 1, h: 0.5, fontSize: 14, bold: true, color: 'FFFFFF' });

    const cRows = [[
      { text: 'Antecedência',  options: { bold: true, color: 'FFFFFF', fill: { color: secondary } } },
      { text: 'Penalidade',    options: { bold: true, color: 'FFFFFF', fill: { color: secondary } } },
    ]];
    roteiro.cancellation.forEach(c => {
      cRows.push([c.period || '—', c.penalty || '—']);
    });
    cSlide.addTable(cRows, {
      x: 1, y: 1, w: W - 2, fontSize: 10,
      border: { pt: 0.5, color: 'CCCCCC' },
      colW: [3.5, W - 5.5],
    });
  }

  // ─── 4.44.0+ (Sprint 5) Informações Importantes slide ─────
  const info = roteiro.importantInfo;
  if (info && (info.passport || info.visa || info.vaccines || info.climate ||
               info.luggage || info.flights || (info.customFields?.length))) {
    const iSlide = pptx.addSlide();
    iSlide.background = { color: 'FFFFFF' };
    iSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.6, fill: { color: secondary } });
    iSlide.addText('INFORMAÇÕES IMPORTANTES', { x: 0.5, y: 0.05, w: W - 1, h: 0.5, fontSize: 14, bold: true, color: 'FFFFFF' });

    // Layout 2 colunas (left, right) pra caber em 1 slide.
    const items = [
      { label: 'PASSAPORTE', value: info.passport },
      { label: 'VISTO',      value: info.visa },
      { label: 'VACINAS',    value: info.vaccines },
      { label: 'CLIMA',      value: info.climate },
      { label: 'BAGAGEM',    value: info.luggage },
      { label: 'VOOS',       value: info.flights },
      ...(info.customFields || []).map(cf => ({ label: cf.label?.toUpperCase() || '', value: cf.value })),
    ].filter(x => x.value);

    // Distribui em 2 colunas alternando esquerda/direita
    const colW = (W - 1.4) / 2;
    let leftY = 0.9, rightY = 0.9;
    items.forEach((it, idx) => {
      const isLeft = idx % 2 === 0;
      const x = isLeft ? 0.5 : 0.5 + colW + 0.4;
      const y = isLeft ? leftY : rightY;
      iSlide.addText(it.label, { x, y, w: colW, h: 0.3, fontSize: 9, bold: true, color: primary });
      const lines = String(it.value).split('\n').length;
      const h = Math.min(2.5, 0.4 + lines * 0.25);
      iSlide.addText(it.value, { x, y: y + 0.32, w: colW, h, fontSize: 9, color: '444444', wrap: true, valign: 'top' });
      const blockH = 0.32 + h + 0.15;
      if (isLeft) leftY += blockH;
      else        rightY += blockH;
    });
  }

  // ─── 4.44.0+ (Sprint 5) Dicas Locais slide(s) — Sprint 3 deferred ─
  if (Array.isArray(roteiro.embeddedTips) && roteiro.embeddedTips.length) {
    for (const emb of roteiro.embeddedTips) {
      const tSlide = pptx.addSlide();
      tSlide.background = { color: 'FFFFFF' };
      tSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.6, fill: { color: secondary } });
      tSlide.addText('DICAS LOCAIS', { x: 0.5, y: 0.05, w: W - 1, h: 0.5, fontSize: 14, bold: true, color: 'FFFFFF' });

      tSlide.addText(emb.title || '', { x: 0.5, y: 0.8, w: W - 1, h: 0.5, fontSize: 18, bold: true, color: secondary });
      if (emb.subtitle) {
        tSlide.addText(emb.subtitle, { x: 0.5, y: 1.25, w: W - 1, h: 0.3, fontSize: 10, color: '888888', italic: true });
      }

      // Renderiza segments — máx 4 segmentos por slide (cabe visualmente)
      const segments = emb.content?.segments || {};
      const segEntries = Object.entries(segments)
        .filter(([_, items]) => Array.isArray(items) && items.length > 0)
        .slice(0, 4);
      let ySeg = 1.7;
      for (const [segKey, items] of segEntries) {
        const label = humanizeSegmentKey(segKey);
        tSlide.addText(label.toUpperCase(), { x: 0.5, y: ySeg, w: W - 1, h: 0.3, fontSize: 9.5, bold: true, color: primary });
        ySeg += 0.35;
        // Top 5 items por segment pra caber visualmente
        const lines = items.slice(0, 5).map(it => {
          if (typeof it === 'string') return '• ' + it;
          if (it && typeof it === 'object') {
            const parts = [];
            if (it.name) parts.push(it.name);
            if (it.address || it.location) parts.push(it.address || it.location);
            return '• ' + parts.filter(Boolean).join(' — ');
          }
          return '';
        }).filter(Boolean).join('\n');
        const blockH = Math.min(1.4, 0.2 + items.slice(0, 5).length * 0.22);
        tSlide.addText(lines, { x: 0.7, y: ySeg, w: W - 1.4, h: blockH, fontSize: 8.5, color: '444444', valign: 'top', wrap: true });
        ySeg += blockH + 0.15;
        if (ySeg > 5.0) break;  // não estoura slide
      }

      // Se algum segmento ficou de fora, sinaliza no footer
      if (segEntries.length < Object.keys(segments).filter(k => segments[k]?.length).length) {
        tSlide.addText(`+ outras categorias no roteiro completo`, { x: 0.5, y: 5.2, w: W - 1, h: 0.3, fontSize: 8, color: '999999', italic: true });
      }
    }
  }

  // ─── Closing slide ─────────────────────────────────────────
  const closing = pptx.addSlide();
  closing.background = { color: secondary };
  // Linhas brancas (n\u00E3o primary cinza \u2014 invis\u00EDvel em fundo escuro)
  closing.addShape(pptx.ShapeType.rect, { x: 2, y: 1.8, w: W - 4, h: 0.02, fill: { color: 'FFFFFF' } });

  // Logo grande no centro (substitui texto "PRIMETOUR")
  if (logoCleanData) {
    const logoH = 1.5;
    const logoW = logoH * logoRatio;
    const logoX = (W - logoW) / 2;
    closing.addImage({ data: logoCleanData, x: logoX, y: 2.0, w: logoW, h: logoH });
  } else {
    closing.addText(buName, {
      x: 0, y: 2.2, w: W, h: 0.6, align: 'center', fontSize: 28, bold: true, color: 'FFFFFF',
    });
  }

  closing.addText('Boa viagem!', {
    x: 0, y: 3.7, w: W, h: 0.4, align: 'center', fontSize: 16, italic: true, color: 'FFFFFF',
  });
  closing.addText('Experi\u00EAncias exclusivas de viagem', {
    x: 0, y: 4.1, w: W, h: 0.35, align: 'center', fontSize: 11, color: 'E6E6E6',
  });

  // Linha branca inferior
  closing.addShape(pptx.ShapeType.rect, { x: 2, y: 4.6, w: W - 4, h: 0.02, fill: { color: 'FFFFFF' } });

  // ─── Save & record ─────────────────────────────────────────
  const filename = `roteiro_${sanitize(roteiro.title || 'viagem')}.pptx`;
  await pptx.writeFile({ fileName: filename });

  try {
    await logGeneration({
      roteiroId: roteiro.id,
      format: 'pptx',
      areaId: area?.id || roteiro.areaId || '',
      destinations: roteiro.travel?.destinations?.map(d => d.city || d.country) || [],
    });
  } catch (e) {
    console.warn('[roteiroGenerator] PPTX generation tracking failed:', e);
  }

  return { filename };
}

/* ═══════════════════════════════════════════════════════════════
   4.46.0+ (Sprint 5 Phase 3) — DOCX EXPORT
   ═══════════════════════════════════════════════════════════════

   Espelha o pattern do Portal de Dicas (generateDocx em portalGenerator.js).
   Lib: docx@8.5.0 (já no projeto via loadDocx).

   FORMATO: pretende ser "editável pelo cliente" — diferente do PDF que é
   final/closed. Por isso é mais texto-pesado e menos visual: cliente abre
   no Word, adiciona observações, devolve.

   ESTRUTURA (1 documento, sem page breaks fortes):
     - Capa: logo + título + período + cliente + destinos
     - Resumo da viagem (1 parágrafo curto)
     - Dia a dia (cada dia: header + narrative resumida)
     - Hotéis (tabela)
     - Valores
     - Opcionais (tabela)
     - Inclui / Não inclui (2 listas)
     - Pagamento
     - Cancelamento (tabela)
     - Informações importantes
     - Dicas locais (cada dica embedded)
     - Closing
*/
export async function generateRoteiroDOCX(roteiro, area = null) {
  await loadDocx();
  const D = window.docx;
  const {
    Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle,
    Table, TableRow, TableCell, WidthType, HeadingLevel, PageBreak,
    ImageRun,
  } = D;

  // 4.46.1+ (Sprint 5 fix) — resolve imagens via banco + Unsplash fallback,
  // mesmo padrão usado por PDF/PPTX. Sem isso, DOCX ficaria só texto/tabelas
  // (degradação assimétrica vs. Portal de Dicas que tem imagens em DOCX).
  let images = { heroUrl: null, byCity: {}, byHotel: {} };
  try { images = await enrichRoteiroImages(roteiro); }
  catch (e) { console.warn('[roteiroGenerator] DOCX enrichImages falhou:', e.message); }

  // Logo da BU (se houver) — usado na capa
  let logoBuf = null;
  if (area?.logoUrl) {
    try { logoBuf = await fetchImgArrayBuffer(area.logoUrl); } catch {}
  }

  // Hero (capa) e dicts de city/hotel já vêm pré-resolvidos
  const heroBuf = images.heroUrl ? await fetchImgArrayBuffer(images.heroUrl) : null;
  // Pré-carrega city/hotel images em paralelo
  const cityBufs = {};
  await Promise.allSettled(
    Object.entries(images.byCity).map(async ([key, url]) => {
      const buf = await fetchImgArrayBuffer(url);
      if (buf) cityBufs[key] = buf;
    })
  );
  const hotelBufs = {};
  await Promise.allSettled(
    Object.entries(images.byHotel).map(async ([idx, url]) => {
      const buf = await fetchImgArrayBuffer(url);
      if (buf) hotelBufs[idx] = buf;
    })
  );

  // Cores (hex sem #) — pra TextRun.color
  const primaryHex   = ((area?.colors?.primary)   || '#0F172A').replace('#', '');
  const secondaryHex = ((area?.colors?.secondary) || '#475569').replace('#', '');
  const mutedHex     = '6B7280';
  const accentHex    = primaryHex;
  const buName       = area?.name || 'PRIMETOUR';
  const today        = new Date().toLocaleDateString('pt-BR', { year: 'numeric', month: 'long', day: 'numeric' });

  // Helpers locais — wrappers do docx API pra reduzir ruído visual
  const tr  = (text, opts = {}) => new TextRun({ font: 'Calibri', text: String(text || ''), ...opts });
  const p   = (children, opts = {}) => new Paragraph({ children, ...opts });
  const hdr = (text, level = HeadingLevel.HEADING_1) => new Paragraph({
    children: [tr(text.toUpperCase(), { bold: true, size: 28, color: secondaryHex, characterSpacing: 50 })],
    spacing: { before: 320, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: accentHex } },
    heading: level,
  });
  const sub = (text) => new Paragraph({
    children: [tr(text.toUpperCase(), { bold: true, size: 20, color: accentHex, characterSpacing: 60 })],
    spacing: { before: 200, after: 80 },
  });
  const body = (text) => new Paragraph({
    children: [tr(text, { size: 22, color: '333333' })],
    spacing: { after: 100, line: 320 },
  });

  // Helper: célula simples
  const cell = (text, opts = {}) => new TableCell({
    children: [new Paragraph({ children: [tr(text, { size: 20, ...(opts.runOpts || {}) })] })],
    width: opts.width,
    shading: opts.shading,
  });
  const headerCell = (text, width) => cell(text, {
    width,
    runOpts: { bold: true, color: 'FFFFFF', size: 20 },
    shading: { fill: secondaryHex, type: 'clear', color: 'auto' },
  });

  const children = [];

  /* ── Capa ─────────────────────────────────────────────── */
  // 4.46.1+ Logo da BU (top, opcional)
  if (logoBuf?.arrayBuffer) {
    try {
      children.push(p([new ImageRun({
        data: logoBuf.arrayBuffer,
        transformation: { width: 200, height: 80 },
        type: logoBuf.ext,
      })], { alignment: AlignmentType.CENTER, spacing: { before: 600, after: 200 } }));
    } catch (e) { console.warn('[DOCX] logo skip:', e.message); }
  }

  children.push(p([tr(buName.toUpperCase(), { bold: true, size: 48, color: primaryHex, characterSpacing: 200 })], {
    alignment: AlignmentType.CENTER, spacing: { before: logoBuf ? 0 : 1200, after: 200 },
  }));
  children.push(p([tr('ROTEIRO DE VIAGEM', { size: 22, color: mutedHex, characterSpacing: 200 })], {
    alignment: AlignmentType.CENTER, spacing: { after: 600 },
  }));
  children.push(p([tr(roteiro.title || 'Roteiro Personalizado', { bold: true, size: 36, color: secondaryHex })], {
    alignment: AlignmentType.CENTER, spacing: { after: 200 },
  }));

  const clientLine = roteiro.client?.name
    ? `Preparado para: ${roteiro.client.name}`
    : '';
  if (clientLine) {
    children.push(p([tr(clientLine, { size: 22, color: secondaryHex, italics: true })], {
      alignment: AlignmentType.CENTER, spacing: { after: 200 },
    }));
  }

  const dests = (roteiro.travel?.destinations || []).map(d => d.city || d.country).filter(Boolean).join(' · ');
  if (dests) {
    children.push(p([tr(dests, { size: 24, bold: true, color: accentHex })], {
      alignment: AlignmentType.CENTER, spacing: { after: 400 },
    }));
  }

  if (roteiro.travel?.startDate || roteiro.travel?.endDate) {
    const fmtD = (s) => s ? new Date(s + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    const period = `${fmtD(roteiro.travel.startDate)} → ${fmtD(roteiro.travel.endDate)} · ${roteiro.travel.nights || 0} noites`;
    children.push(p([tr(period, { size: 20, color: mutedHex })], {
      alignment: AlignmentType.CENTER, spacing: { after: 400 },
    }));
  }

  children.push(p([tr('───────────────────────', { color: accentHex, size: 16 })], {
    alignment: AlignmentType.CENTER, spacing: { before: 200, after: 120 },
  }));
  children.push(p([tr(today, { size: 18, color: mutedHex })], { alignment: AlignmentType.CENTER }));

  // 4.46.1+ Hero (capa) — pós-meta, antes da page break. Largura cheia.
  if (heroBuf?.arrayBuffer) {
    try {
      children.push(p([new ImageRun({
        data: heroBuf.arrayBuffer,
        transformation: { width: 530, height: 260 },
        type: heroBuf.ext,
      })], { alignment: AlignmentType.CENTER, spacing: { before: 300, after: 100 } }));
    } catch (e) { console.warn('[DOCX] hero skip:', e.message); }
  }

  children.push(p([new PageBreak()]));

  /* ── Dia a dia ────────────────────────────────────────── */
  if (Array.isArray(roteiro.days) && roteiro.days.length) {
    children.push(hdr('Dia a dia'));
    // Pra evitar repetir a mesma imagem em vários dias seguidos da mesma
    // cidade, rastreamos qual cityKey já teve imagem inserida.
    let lastCityKeyShown = null;
    for (const d of roteiro.days) {
      const dayLabel = d.title?.trim() || `Dia ${d.dayNumber || ''}`;
      const dateLabel = d.date ? ` · ${new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}` : '';
      const cityLabel = d.city ? ` · ${d.city}` : '';
      children.push(sub(`${dayLabel}${dateLabel}${cityLabel}`));

      // 4.46.1+ Imagem da cidade (1ª vez que aparece nos dias)
      if (d.city) {
        const cityKey = normKey(d.city);
        if (cityKey !== lastCityKeyShown && cityBufs[cityKey]?.arrayBuffer) {
          try {
            children.push(p([new ImageRun({
              data: cityBufs[cityKey].arrayBuffer,
              transformation: { width: 480, height: 220 },
              type: cityBufs[cityKey].ext,
            })], { alignment: AlignmentType.CENTER, spacing: { before: 100, after: 200 } }));
            lastCityKeyShown = cityKey;
          } catch (e) { console.warn('[DOCX] city img skip:', e.message); }
        }
      }

      if (d.narrative) children.push(body(d.narrative));
      if (Array.isArray(d.activities) && d.activities.length) {
        for (const a of d.activities) {
          const t = (a.time || '').trim();
          const desc = (a.description || '').trim();
          if (!desc && !t) continue;
          children.push(new Paragraph({
            children: [
              tr(t ? `${t} · ` : '', { bold: true, color: accentHex, size: 20 }),
              tr(desc, { size: 20, color: '444444' }),
            ],
            spacing: { after: 60 },
            indent: { left: 220 },
          }));
        }
      }
    }
  }

  /* ── Hotéis (thumbs + tabela) ─────────────────────────── */
  if (Array.isArray(roteiro.hotels) && roteiro.hotels.length) {
    children.push(hdr('Hospedagem'));

    // 4.46.1+ Thumb por hotel (1 parágrafo por hotel, com header + image + nome)
    for (let i = 0; i < roteiro.hotels.length; i++) {
      const h = roteiro.hotels[i];
      const buf = hotelBufs[i];
      if (!buf?.arrayBuffer) continue;
      try {
        children.push(p([
          tr(`${h.hotelName || `Hotel ${i+1}`}${h.city ? ' — ' + h.city : ''}`, {
            bold: true, size: 22, color: secondaryHex,
          }),
        ], { spacing: { before: 200, after: 80 } }));
        children.push(p([new ImageRun({
          data: buf.arrayBuffer,
          transformation: { width: 400, height: 200 },
          type: buf.ext,
        })], { alignment: AlignmentType.CENTER, spacing: { after: 100 } }));
      } catch (e) { console.warn('[DOCX] hotel thumb skip:', e.message); }
    }

    // Tabela com detalhes operacionais
    const rows = [
      new TableRow({ children: [
        headerCell('Cidade'), headerCell('Hotel'), headerCell('Quarto'), headerCell('Regime'), headerCell('Noites'),
      ]}),
      ...roteiro.hotels.map(h => new TableRow({ children: [
        cell(h.city || '—'),
        cell(h.hotelName || '—'),
        cell(h.roomType || '—'),
        cell(h.regime || '—'),
        cell(String(h.nights || '—')),
      ]})),
    ];
    children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
    children.push(p([])); // spacer
  }

  /* ── Valores ──────────────────────────────────────────── */
  const pricing = roteiro.pricing || {};
  if (pricing.perPerson || pricing.perCouple || (pricing.customRows || []).length) {
    children.push(hdr('Valores'));
    const cur = pricing.currency || 'USD';
    if (pricing.perCouple)  children.push(body(`Por casal: ${formatCurrency(pricing.perCouple, cur)}`));
    if (pricing.perPerson)  children.push(body(`Por pessoa: ${formatCurrency(pricing.perPerson, cur)}`));
    (pricing.customRows || []).forEach(r => {
      if (r.label || r.value) children.push(body(`${r.label || ''}${r.label && r.value ? ': ' : ''}${r.value || ''}`));
    });
    if (pricing.disclaimer) {
      children.push(p([tr(pricing.disclaimer, { italics: true, size: 18, color: mutedHex })], { spacing: { before: 200, after: 100 } }));
    }
  }

  /* ── Opcionais (tabela) ───────────────────────────────── */
  if (Array.isArray(roteiro.optionals) && roteiro.optionals.length) {
    children.push(hdr('Serviços opcionais'));
    const cur = pricing.currency || 'USD';
    const rows = [
      new TableRow({ children: [
        headerCell('Serviço'), headerCell('Por adulto'), headerCell('Por criança'), headerCell('Observações'),
      ]}),
      ...roteiro.optionals.map(o => new TableRow({ children: [
        cell(o.service || '—'),
        cell(o.priceAdult != null ? formatCurrency(o.priceAdult, cur) : '—'),
        cell(o.priceChild != null ? formatCurrency(o.priceChild, cur) : '—'),
        cell(o.notes || ''),
      ]})),
    ];
    children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
    children.push(p([]));
  }

  /* ── Inclui / Não inclui ──────────────────────────────── */
  if ((roteiro.includes?.length) || (roteiro.excludes?.length)) {
    children.push(hdr('Inclui / Não inclui'));
    if (roteiro.includes?.length) {
      children.push(sub('Inclui'));
      roteiro.includes.forEach(i => children.push(new Paragraph({
        children: [tr(`✓ ${i}`, { size: 20, color: '333333' })],
        spacing: { after: 40 },
        indent: { left: 220 },
      })));
    }
    if (roteiro.excludes?.length) {
      children.push(sub('Não inclui'));
      roteiro.excludes.forEach(i => children.push(new Paragraph({
        children: [tr(`✗ ${i}`, { size: 20, color: '666666' })],
        spacing: { after: 40 },
        indent: { left: 220 },
      })));
    }
  }

  /* ── Pagamento ────────────────────────────────────────── */
  const pay = roteiro.payment || {};
  if (pay.deposit || pay.installments || pay.deadline || pay.notes) {
    children.push(hdr('Pagamento'));
    if (pay.deposit)      children.push(body(`Sinal / Depósito: ${pay.deposit}`));
    if (pay.installments) children.push(body(`Parcelamento: ${pay.installments}`));
    if (pay.deadline)     children.push(body(`Prazo: ${pay.deadline}`));
    if (pay.notes) {
      children.push(sub('Observações'));
      children.push(body(pay.notes));
    }
  }

  /* ── Cancelamento ─────────────────────────────────────── */
  if (Array.isArray(roteiro.cancellation) && roteiro.cancellation.length) {
    children.push(hdr('Política de cancelamento'));
    const rows = [
      new TableRow({ children: [headerCell('Antecedência'), headerCell('Penalidade')]}),
      ...roteiro.cancellation.map(c => new TableRow({ children: [
        cell(c.period || '—'),
        cell(c.penalty || '—'),
      ]})),
    ];
    children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
    children.push(p([]));
  }

  /* ── Informações Importantes ──────────────────────────── */
  const info = roteiro.importantInfo || {};
  const infoItems = [
    { label: 'Passaporte', value: info.passport },
    { label: 'Visto', value: info.visa },
    { label: 'Vacinas', value: info.vaccines },
    { label: 'Clima', value: info.climate },
    { label: 'Bagagem', value: info.luggage },
    { label: 'Voos', value: info.flights },
    ...((info.customFields || []).map(cf => ({ label: cf.label, value: cf.value }))),
  ].filter(x => x.value);
  if (infoItems.length) {
    children.push(hdr('Informações importantes'));
    infoItems.forEach(it => {
      children.push(sub(it.label));
      children.push(body(it.value));
    });
  }

  /* ── Dicas anexas ─────────────────────────────────────── */
  if (Array.isArray(roteiro.embeddedTips) && roteiro.embeddedTips.length) {
    children.push(hdr('Dicas locais'));
    for (const emb of roteiro.embeddedTips) {
      children.push(sub(emb.title || '—'));
      if (emb.subtitle) children.push(p([tr(emb.subtitle, { italics: true, color: mutedHex, size: 18 })], { spacing: { after: 80 } }));
      const segments = emb.content?.segments || {};
      for (const [segKey, items] of Object.entries(segments)) {
        if (!Array.isArray(items) || !items.length) continue;
        children.push(p([tr(humanizeSegmentKey(segKey).toUpperCase(), { bold: true, color: accentHex, size: 18 })], { spacing: { before: 100, after: 60 } }));
        items.slice(0, 10).forEach(it => {  // máx 10 por segmento pra não inflar
          let line;
          if (typeof it === 'string') line = `• ${it}`;
          else if (it && typeof it === 'object') {
            const parts = [];
            if (it.name) parts.push(it.name);
            if (it.address || it.location) parts.push(it.address || it.location);
            if (it.note || it.description) parts.push(it.note || it.description);
            line = `• ${parts.filter(Boolean).join(' — ')}`;
          } else return;
          children.push(new Paragraph({
            children: [tr(line, { size: 18, color: '444444' })],
            spacing: { after: 40 },
            indent: { left: 220 },
          }));
        });
      }
    }
  }

  /* ── Closing ──────────────────────────────────────────── */
  children.push(p([]));
  children.push(p([tr('Boa viagem!', { bold: true, size: 28, color: primaryHex, italics: true })], {
    alignment: AlignmentType.CENTER, spacing: { before: 600 },
  }));
  children.push(p([tr(`${buName} · Experiências exclusivas de viagem`, { size: 16, color: mutedHex })], {
    alignment: AlignmentType.CENTER, spacing: { before: 100 },
  }));

  /* ── Monta documento + save ───────────────────────────── */
  const document = new Document({
    creator: 'PRIMETOUR',
    title: roteiro.title || 'Roteiro de Viagem',
    sections: [{
      properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
      children,
    }],
  });

  const blob = await Packer.toBlob(document);
  const filename = buildRoteiroFilename(roteiro, 'docx');
  saveBlob(blob, filename);

  // Track
  try {
    await logGeneration({
      roteiroId: roteiro.id,
      format: 'docx',
      areaId: area?.id || roteiro.areaId || '',
      destinations: (roteiro.travel?.destinations || []).map(d => d.city || d.country),
    });
  } catch (e) {
    console.warn('[roteiroGenerator] DOCX tracking failed:', e);
  }

  return { filename };
}

/* Helper compartilhado: salva blob via download link (igual ao PDF/PPTX) */
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
}

/* Helper: nome de arquivo do roteiro (igual padrão PDF/PPTX) */
function buildRoteiroFilename(roteiro, ext) {
  const client = (roteiro.client?.name || 'cliente').replace(/[^\w]+/g, '_').slice(0, 30);
  const dest = (roteiro.travel?.destinations?.[0]?.city || roteiro.travel?.destinations?.[0]?.country || 'roteiro').replace(/[^\w]+/g, '_').slice(0, 20);
  const date = new Date().toISOString().slice(0, 10);
  return `roteiro_${client}_${dest}_${date}.${ext}`;
}
