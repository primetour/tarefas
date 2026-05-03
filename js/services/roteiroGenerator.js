/**
 * PRIMETOUR — Roteiros de Viagem: Motor de Geração PDF / PPTX
 * Converte dados de roteiro + área em documento profissional
 * Padrão visual: itinerário de viagem premium (jsPDF + autoTable)
 */

import { store } from '../store.js';
import { toast } from '../components/toast.js';
import { fetchAreas, fetchImages } from './portal.js';
import { recordGeneration as logGeneration } from './roteiros.js';

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

/** Cache simples de fetchDestinationPhoto durante uma geração. */
const _photoCache = new Map();
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

/** Busca foto auto via Cloud Function (Unsplash → Wikipedia fallback). Cached. */
async function fetchAutoPhoto(query) {
  if (!query) return null;
  const k = query.toLowerCase().trim();
  if (_photoCache.has(k)) return _photoCache.get(k);
  try {
    const fn = await getPhotoFn();
    const r = await fn({ query });
    const url = r?.data?.url || null;
    _photoCache.set(k, url);
    return url;
  } catch (e) {
    console.warn('[roteiroImages] fetchAutoPhoto falhou:', query, e.message);
    _photoCache.set(k, null);
    return null;
  }
}

/** Resolve imagem pra um destino (city + country).
 * Ordem: override manual → banco portal_images → Unsplash/Wikipedia.
 * @param {Object} dest - { city, country }
 * @param {string|null} override - URL salva manualmente pelo user (vence tudo)
 * @param {Array} bankImages - resultado de fetchImages() (cache na sessão)
 * @returns {Promise<string|null>}
 */
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
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(sr, sg, sb);
  doc.text(title, MARGIN + 8, y + 7.5);

  // Underline
  doc.setDrawColor(pr, pg, pb);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y + 13, PAGE_W - MARGIN, y + 13);

  return y + 18;
}

/** Footer: area name + page number */
function addFooter(doc, areaName, pageNum, totalPages, primary) {
  const [r, g, b] = hexToRgb(primary);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(r, g, b);
  doc.text(areaName, MARGIN, PAGE_H - 8);
  doc.text(`${pageNum} / ${totalPages}`, PAGE_W - MARGIN, PAGE_H - 8, { align: 'right' });
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

  const primary = area?.colors?.primary || '#D4A843';
  const secondary = area?.colors?.secondary || '#1A1A2E';
  const accent = area?.colors?.accent || primary;
  const buName = area?.name || 'Primetour';

  // Resolve imagens (banco → Unsplash → Wikipedia) — não-blocker
  let images = { heroUrl: null, byCity: {}, byHotel: {} };
  try { images = await enrichRoteiroImages(roteiro); }
  catch (e) { console.warn('[roteiroGenerator] enrichRoteiroImages falhou:', e.message); }

  /* ─── PAGE 1: COVER ──────────────────────────────────────── */
  await buildCoverPage(doc, roteiro, buName, primary, secondary, images.heroUrl);

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

  /* ─── CLOSING PAGE ───────────────────────────────────────── */
  buildClosingPage(doc, roteiro, buName, primary, secondary);

  /* ─── FOOTERS (retroactive) ──────────────────────────────── */
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 2; i <= totalPages - 1; i++) {
    doc.setPage(i);
    addFooter(doc, buName, i - 1, totalPages - 2, primary);
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
export async function generateRoteiroForExport(roteiro, areaId, format = 'pdf') {
  try {
    let area = null;
    if (areaId) {
      const areas = await fetchAreas();
      area = areas.find(a => a.id === areaId) || null;
    }

    let result;
    if (format === 'pptx') {
      result = await generateRoteiroPPTX(roteiro, area);
      toast.success(`PPTX gerado: ${result.filename}`);
    } else {
      result = await generateRoteiroPDF(roteiro, area);
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
async function buildCoverPage(doc, roteiro, buName, primary, secondary, heroImage) {
  const [pr, pg, pb] = hexToRgb(primary);
  const [sr, sg, sb] = hexToRgb(secondary);

  // Full navy/secondary background (fallback se sem hero)
  doc.setFillColor(sr, sg, sb);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

  // Hero image (full bleed) com overlay escuro pra legibilidade do texto
  if (heroImage) {
    try {
      const imgData = await fetchImgData(heroImage);
      if (imgData) {
        doc.addImage(imgData, 'JPEG', 0, 0, PAGE_W, PAGE_H, undefined, 'FAST');
        // Overlay gradiente escuro (top transparent → bottom 70% opaque) simulado
        // jsPDF não tem gradient nativo — usamos retângulos sobrepostos com alpha
        doc.setGState(new doc.GState({ opacity: 0.55 }));
        doc.setFillColor(sr, sg, sb);
        doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
        doc.setGState(new doc.GState({ opacity: 1 }));
      }
    } catch (e) {
      console.warn('[roteiroGenerator] hero image falhou:', e.message);
    }
  }

  // Top gold accent line
  doc.setFillColor(pr, pg, pb);
  doc.rect(30, 40, PAGE_W - 60, 0.8, 'F');

  // BU name (10pt, spaced)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(pr, pg, pb);
  doc.text(buName.toUpperCase(), PAGE_W / 2, 52, { align: 'center', charSpace: 3 });

  // Destination names (18pt, white, large)
  const destinations = roteiro.travel?.destinations || [];
  const destNames = destinations.map(d => d.city || d.country).filter(Boolean);
  const destText = destNames.join('  |  ').toUpperCase();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  const destLines = doc.splitTextToSize(destText, CONTENT_W + 20);
  let destY = 80;
  for (const line of destLines) {
    doc.text(line, PAGE_W / 2, destY, { align: 'center' });
    destY += 10;
  }

  // Subtitle: ROTEIRO DE VIAGEM
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(pr, pg, pb);
  doc.text('ROTEIRO DE VIAGEM', PAGE_W / 2, destY + 8, { align: 'center', charSpace: 3 });

  // Thin separator
  doc.setFillColor(pr, pg, pb);
  doc.rect(70, destY + 14, PAGE_W - 140, 0.4, 'F');

  // Duration badge
  const nights = roteiro.travel?.nights || destinations.reduce((s, d) => s + (d.nights || 0), 0);
  const badgeText = `${nights} NOITE${nights !== 1 ? 'S' : ''}`;
  const badgeY = destY + 26;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(pr, pg, pb);

  const badgeW = Math.min(doc.getTextWidth(badgeText) + 24, CONTENT_W);
  const badgeX = (PAGE_W - badgeW) / 2;
  doc.setDrawColor(pr, pg, pb);
  doc.setLineWidth(0.4);
  doc.roundedRect(badgeX, badgeY - 6, badgeW, 12, 2, 2, 'S');
  doc.text(badgeText, PAGE_W / 2, badgeY + 2, { align: 'center' });

  // Date range
  if (roteiro.travel?.startDate && roteiro.travel?.endDate) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(180, 180, 180);
    const dateStr = `${fmtDateFull(roteiro.travel.startDate)}  a  ${fmtDateFull(roteiro.travel.endDate)}`;
    doc.text(dateStr, PAGE_W / 2, badgeY + 20, { align: 'center' });
  }

  // Bottom gold line
  doc.setFillColor(pr, pg, pb);
  doc.rect(30, PAGE_H - 60, PAGE_W - 60, 0.8, 'F');

  // Client name
  if (roteiro.client?.name) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(200, 200, 200);
    doc.text(`Preparado para ${roteiro.client.name}`, PAGE_W / 2, PAGE_H - 48, { align: 'center' });

    const paxParts = [];
    if (roteiro.client.adults) paxParts.push(`${roteiro.client.adults} adulto${roteiro.client.adults > 1 ? 's' : ''}`);
    if (roteiro.client.children) paxParts.push(`${roteiro.client.children} crian\u00E7a${roteiro.client.children > 1 ? 's' : ''}`);
    if (paxParts.length) {
      doc.setFontSize(9);
      doc.setTextColor(160, 160, 160);
      doc.text(paxParts.join(' + '), PAGE_W / 2, PAGE_H - 42, { align: 'center' });
    }
  }

  // Title at very bottom
  if (roteiro.title) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(roteiro.title, PAGE_W / 2, PAGE_H - 20, { align: 'center' });
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
  const cityImageData = {};
  await Promise.allSettled(
    Object.entries(byCity).map(async ([key, url]) => {
      const data = await fetchImgData(url);
      if (data) cityImageData[key] = data;
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

    // Day number circle
    doc.setFillColor(pr, pg, pb);
    doc.circle(MARGIN + 5, y + 4, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(sr, sg, sb);
    doc.text(String(day.dayNumber || i + 1), MARGIN + 5, y + 5.5, { align: 'center' });

    // "DIA X -- date" header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(sr, sg, sb);
    const dayLabel = `DIA ${day.dayNumber || i + 1}`;
    let labelX = MARGIN + 14;
    doc.text(dayLabel, labelX, y + 5.5);

    if (day.date) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(130, 130, 130);
      doc.text(`\u2014 ${fmtDateBR(day.date)}`, labelX + doc.getTextWidth(dayLabel) + 3, y + 5.5);
    }

    y += 10;

    // City in accent color
    if (day.city) {
      doc.setFont('helvetica', 'bold');
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
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(sr, sg, sb);
      const titleLines = doc.splitTextToSize(day.title, CONTENT_W - 15);
      doc.text(titleLines, MARGIN + 14, y + 3);
      y += titleLines.length * 4.5 + 2;
    }

    // Narrative text (10pt, justified feel)
    if (day.narrative) {
      doc.setFont('helvetica', 'normal');
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
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8);
          doc.setTextColor(pr, pg, pb);
          doc.text(act.time, MARGIN + 14, y + 3);
        }

        const descX = act.time ? MARGIN + 28 : MARGIN + 14;
        const descW = CONTENT_W - (descX - MARGIN);
        doc.setFont('helvetica', 'normal');
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
      doc.setFont('helvetica', 'italic');
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
      const imgData = await fetchImgData(item.url);
      if (imgData) {
        try {
          doc.addImage(imgData, 'JPEG', x, y, thumbW, thumbH, undefined, 'FAST');
        } catch (e) { /* ignore */ }
      }
      // Legenda
      doc.setFont('helvetica', 'bold');
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
    doc.setFont('helvetica', 'italic');
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

  // INCLUDES
  if (roteiro.includes?.length) {
    y = addSectionTitle(doc, y, 'O ROTEIRO INCLUI', primary, secondary);
    y += 3;

    for (const item of roteiro.includes) {
      y = checkPageBreak(doc, y, 8);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(34, 139, 34);
      doc.text('\u2713', MARGIN + 3, y + 3);
      doc.setFont('helvetica', 'normal');
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
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(200, 60, 60);
      doc.text('\u2715', MARGIN + 3, y + 3);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(50, 50, 50);
      const lines = doc.splitTextToSize(item, CONTENT_W - 12);
      doc.text(lines, MARGIN + 10, y + 3);
      y += lines.length * 4.5 + 2;
    }
  }
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

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(sr, sg, sb);
    doc.text(entry.label + ':', MARGIN + 3, y + 3);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(60, 60, 60);
    const lines = doc.splitTextToSize(entry.value, CONTENT_W - 48);
    doc.text(lines, MARGIN + 45, y + 3);
    y += Math.max(lines.length * 4.5, 6) + 3;
  }
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
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(pr, pg, pb);
    doc.text(section.label, MARGIN + 3, y + 3, { charSpace: 0.8 });
    y += 7;

    // Content (10pt body)
    doc.setFont('helvetica', 'normal');
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
}

/* ─── Closing Page ────────────────────────────────────────── */
function buildClosingPage(doc, roteiro, buName, primary, secondary) {
  const [pr, pg, pb] = hexToRgb(primary);
  const [sr, sg, sb] = hexToRgb(secondary);

  doc.addPage();

  // Full secondary background
  doc.setFillColor(sr, sg, sb);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

  // Top gold line
  doc.setFillColor(pr, pg, pb);
  doc.rect(50, PAGE_H / 2 - 25, PAGE_W - 100, 0.6, 'F');

  // BU Name (18pt)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(pr, pg, pb);
  doc.text(buName.toUpperCase(), PAGE_W / 2, PAGE_H / 2 - 5, { align: 'center', charSpace: 4 });

  // "Boa viagem!" message
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text('Boa viagem!', PAGE_W / 2, PAGE_H / 2 + 10, { align: 'center' });

  // Tagline
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(180, 180, 180);
  doc.text('Experi\u00EAncias exclusivas de viagem', PAGE_W / 2, PAGE_H / 2 + 20, { align: 'center' });

  // Bottom gold line
  doc.setFillColor(pr, pg, pb);
  doc.rect(50, PAGE_H / 2 + 28, PAGE_W - 100, 0.6, 'F');

  // Contact info if available
  const contact = roteiro.contact || roteiro.client?.agentEmail;
  if (contact) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text(contact, PAGE_W / 2, PAGE_H / 2 + 42, { align: 'center' });
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

  const primary = area?.colors?.primary || '#D4A843';
  const secondary = area?.colors?.secondary || '#1A1A2E';
  const buName = area?.name || 'Primetour';

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = buName;
  pptx.title = roteiro.title || 'Roteiro de Viagem';

  const W = 10, H = 5.625;

  // ─── Resolve imagens (hero + por cidade + por hotel) ──────
  let images = { heroUrl: null, byCity: {}, byHotel: {} };
  try { images = await enrichRoteiroImages(roteiro); }
  catch (e) { console.warn('[roteiroGenerator PPTX] enrichRoteiroImages falhou:', e.message); }

  // Pre-fetch base64 das imagens que vamos usar
  const heroData = images.heroUrl ? await fetchImgData(images.heroUrl) : null;
  const cityData = {};
  await Promise.allSettled(Object.entries(images.byCity).map(async ([k, url]) => {
    const d = await fetchImgData(url);
    if (d) cityData[k] = d;
  }));
  const hotelData = {};
  await Promise.allSettled(Object.entries(images.byHotel).map(async ([k, url]) => {
    const d = await fetchImgData(url);
    if (d) hotelData[k] = d;
  }));

  // ─── Slide 1: Cover ───────────────────────────────────────
  const cover = pptx.addSlide();
  cover.background = { color: secondary.replace('#', '') };

  // Hero como fundo (se houver), com overlay escuro p/ legibilidade
  if (heroData) {
    cover.addImage({ data: heroData, x: 0, y: 0, w: W, h: H, sizing: { type: 'cover', w: W, h: H } });
    cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: secondary.replace('#', ''), transparency: 50 } });
  }

  cover.addShape(pptx.ShapeType.rect, { x: 1, y: 1.2, w: W - 2, h: 0.02, fill: { color: primary.replace('#', '') } });
  cover.addText(buName.toUpperCase(), { x: 0, y: 1.4, w: W, h: 0.4, align: 'center', fontSize: 10, color: primary.replace('#', ''), charSpacing: 4 });
  cover.addText('ROTEIRO', { x: 0, y: 2, w: W, h: 0.7, align: 'center', fontSize: 36, bold: true, color: primary.replace('#', ''), charSpacing: 5 });

  const destNames = (roteiro.travel?.destinations || []).map(d => d.city || d.country).filter(Boolean);
  cover.addText(destNames.join('  |  ').toUpperCase(), { x: 0.5, y: 2.8, w: W - 1, h: 0.5, align: 'center', fontSize: 18, bold: true, color: 'FFFFFF' });

  const nights = roteiro.travel?.nights || roteiro.days?.length || 0;
  cover.addText(`${nights} NOITES | ${destNames.join(' e ')}`, { x: 0, y: 3.5, w: W, h: 0.35, align: 'center', fontSize: 11, color: primary.replace('#', '') });

  cover.addShape(pptx.ShapeType.rect, { x: 1, y: 4.2, w: W - 2, h: 0.02, fill: { color: primary.replace('#', '') } });

  // ─── Day-by-day slides ─────────────────────────────────────
  const days = roteiro.days || [];
  for (let i = 0; i < days.length; i += 2) {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };

    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.6, fill: { color: secondary.replace('#', '') } });
    slide.addText('ROTEIRO SUGERIDO', { x: 0.5, y: 0.05, w: W - 1, h: 0.5, fontSize: 14, bold: true, color: primary.replace('#', '') });

    for (let j = 0; j < 2 && (i + j) < days.length; j++) {
      const d = days[i + j];
      const yBase = 0.8 + j * 2.3;

      // Imagem da cidade (à direita) — encolhe o texto p/ caber
      const cityKey = normKey(d.city);
      const cityImg = cityData[cityKey];
      const textW = cityImg ? 6.0 : 8.5;

      slide.addShape(pptx.ShapeType.ellipse, { x: 0.4, y: yBase, w: 0.45, h: 0.45, fill: { color: primary.replace('#', '') } });
      slide.addText(`${d.dayNumber || i + j + 1}`, { x: 0.4, y: yBase, w: 0.45, h: 0.45, align: 'center', valign: 'middle', fontSize: 12, bold: true, color: secondary.replace('#', '') });

      const dateText = d.date ? fmtDateBR(d.date) : '';
      slide.addText(`${dateText} - ${d.city || ''}`, { x: 1, y: yBase, w: 3, h: 0.35, fontSize: 11, bold: true, color: secondary.replace('#', '') });

      if (d.title) {
        slide.addText(d.title, { x: 1, y: yBase + 0.3, w: textW, h: 0.3, fontSize: 10, bold: true, color: '333333' });
      }

      const narrative = (d.narrative || '').substring(0, 500);
      if (narrative) {
        slide.addText(narrative, { x: 1, y: yBase + 0.6, w: textW, h: 1.5, fontSize: 8.5, color: '555555', valign: 'top', wrap: true });
      }

      if (d.overnightCity) {
        slide.addText(`Noite: ${d.overnightCity}`, { x: 1, y: yBase + 2.0, w: 4, h: 0.25, fontSize: 8, italic: true, color: primary.replace('#', '') });
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
    hSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.6, fill: { color: secondary.replace('#', '') } });
    hSlide.addText('HOSPEDAGEM', { x: 0.5, y: 0.05, w: W - 1, h: 0.5, fontSize: 14, bold: true, color: primary.replace('#', '') });

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
      [{ text: 'Cidade', options: { bold: true, color: 'FFFFFF', fill: { color: secondary.replace('#', '') } } },
       { text: 'Hotel', options: { bold: true, color: 'FFFFFF', fill: { color: secondary.replace('#', '') } } },
       { text: 'Quarto', options: { bold: true, color: 'FFFFFF', fill: { color: secondary.replace('#', '') } } },
       { text: 'Regime', options: { bold: true, color: 'FFFFFF', fill: { color: secondary.replace('#', '') } } },
       { text: 'Noites', options: { bold: true, color: 'FFFFFF', fill: { color: secondary.replace('#', '') } } }],
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
    pSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.6, fill: { color: secondary.replace('#', '') } });
    pSlide.addText('VALORES', { x: 0.5, y: 0.05, w: W - 1, h: 0.5, fontSize: 14, bold: true, color: primary.replace('#', '') });

    let yP = 1;
    const cur = roteiro.pricing.currency || 'USD';
    if (roteiro.pricing.perCouple) {
      pSlide.addText(`DUPLO: ${formatCurrency(roteiro.pricing.perCouple, cur)}`, { x: 1, y: yP, w: 8, h: 0.5, fontSize: 20, bold: true, color: secondary.replace('#', '') });
      yP += 0.6;
    }
    if (roteiro.pricing.perPerson) {
      pSlide.addText(`POR PESSOA: ${formatCurrency(roteiro.pricing.perPerson, cur)}`, { x: 1, y: yP, w: 8, h: 0.5, fontSize: 20, bold: true, color: secondary.replace('#', '') });
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
    ieSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.6, fill: { color: secondary.replace('#', '') } });
    ieSlide.addText('INCLUI / N\u00C3O INCLUI', { x: 0.5, y: 0.05, w: W - 1, h: 0.5, fontSize: 14, bold: true, color: primary.replace('#', '') });

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

  // ─── Closing slide ─────────────────────────────────────────
  const closing = pptx.addSlide();
  closing.background = { color: secondary.replace('#', '') };
  closing.addShape(pptx.ShapeType.rect, { x: 2, y: 2.2, w: W - 4, h: 0.02, fill: { color: primary.replace('#', '') } });
  closing.addText(buName.toUpperCase(), { x: 0, y: 2.4, w: W, h: 0.6, align: 'center', fontSize: 24, bold: true, color: primary.replace('#', ''), charSpacing: 4 });
  closing.addText('Experi\u00EAncias exclusivas de viagem', { x: 0, y: 3, w: W, h: 0.4, align: 'center', fontSize: 10, color: 'AAAAAA' });
  closing.addShape(pptx.ShapeType.rect, { x: 2, y: 3.5, w: W - 4, h: 0.02, fill: { color: primary.replace('#', '') } });

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
