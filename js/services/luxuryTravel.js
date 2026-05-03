/**
 * PRIMETOUR — Revista Luxury Travel (CMS)
 *
 * O sistema CATALOGA edições da revista bilíngue (PT/EN). O flipbook em si
 * continua hospedado em GitHub Pages (primetour/luxury-travel) — refazer
 * o engine seria caro e a estrutura atual já funciona.
 *
 * Responsabilidades do service:
 *   - CRUD de edições (Firestore)
 *   - Upload de PDFs e capas pro R2
 *   - Geração de QR codes (client-side via lib qrcode)
 *   - CRUD de fontes customizadas
 *   - Settings globais (URL home, QR home)
 *   - Seed inicial: importar editions.json do GitHub
 *
 * Collections Firestore:
 *   luxury_travel_editions/{id}
 *   luxury_travel_fonts/{id}
 *   luxury_travel_settings/global
 *
 * Storage R2:
 *   luxury-travel/editions/{slug}/pdf_pt.pdf
 *   luxury-travel/editions/{slug}/pdf_en.pdf
 *   luxury-travel/editions/{slug}/cover_pt.jpg
 *   luxury-travel/editions/{slug}/cover_en.jpg
 *   luxury-travel/editions/{slug}/qr.png
 *   luxury-travel/fonts/{filename}
 *   luxury-travel/home_qr.png
 */

import { db } from '../firebase.js';
import { store } from '../store.js';
import { auditLog } from '../auth/audit.js';
import { R2_PUBLIC_URL, R2_WORKER_URL, R2_UPLOAD_TOKEN } from './portal.js';
import {
  collection, doc, addDoc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, limit, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const EDITIONS_COL = 'luxury_travel_editions';
const FONTS_COL    = 'luxury_travel_fonts';
const SETTINGS_COL = 'luxury_travel_settings';

const GH_REPO        = 'primetour/luxury-travel';
const GH_PAGES_BASE  = 'https://primetour.github.io/luxury-travel';
const R2_BASE_PATH   = 'luxury-travel';

const uid      = () => store.get('currentUser')?.uid;
const userName = () => store.get('userProfile')?.name
  || store.get('currentUser')?.email
  || 'Usuário';

/* ════════════════════════════════════════════════════════════
   GENERIC R2 UPLOAD (qualquer tipo de arquivo)
   ════════════════════════════════════════════════════════════ */

/** Upload genérico pro R2. Retorna URL pública.
 * @param {File|Blob} file
 * @param {string} path - ex: "luxury-travel/editions/lt07/pdf_pt.pdf"
 * @param {Function} [onProgress] - callback (loaded/total) opcional
 */
export async function uploadFileToR2(file, path, onProgress) {
  if (!R2_WORKER_URL) throw new Error('R2_WORKER_URL não configurado.');
  if (!R2_UPLOAD_TOKEN) throw new Error('R2_UPLOAD_TOKEN não configurado.');
  if (!file) throw new Error('Arquivo vazio.');

  const fd = new FormData();
  fd.append('file', file, path.split('/').pop());
  fd.append('path', path);

  // Upload via XHR pra ter progresso (fetch não tem upload progress nativo)
  if (typeof onProgress === 'function') {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300
        ? resolve(`${R2_PUBLIC_URL}/${path}`)
        : reject(new Error(`Upload falhou: HTTP ${xhr.status} — ${xhr.responseText?.slice(0,200)}`));
      xhr.onerror = () => reject(new Error('Upload falhou: erro de rede.'));
      xhr.open('POST', R2_WORKER_URL);
      xhr.setRequestHeader('X-Upload-Token', R2_UPLOAD_TOKEN);
      xhr.send(fd);
    });
  }

  // Fallback fetch (sem progresso)
  const res = await fetch(R2_WORKER_URL, {
    method: 'POST',
    headers: { 'X-Upload-Token': R2_UPLOAD_TOKEN },
    body: fd,
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.status);
    throw new Error(`Upload falhou: ${msg}`);
  }
  return `${R2_PUBLIC_URL}/${path}`;
}

/** Remove arquivo do R2. */
export async function deleteFromR2(path) {
  if (!R2_WORKER_URL || !R2_UPLOAD_TOKEN) return;
  const url = `${R2_WORKER_URL}?path=${encodeURIComponent(path)}`;
  await fetch(url, {
    method: 'DELETE',
    headers: { 'X-Upload-Token': R2_UPLOAD_TOKEN },
  }).catch(() => {});
}

/* ════════════════════════════════════════════════════════════
   PDF.js — extração de capa (página 1) como JPEG
   ════════════════════════════════════════════════════════════ */

let _pdfjsPromise = null;
async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      res(window.pdfjsLib);
    };
    s.onerror = () => rej(new Error('Falha ao carregar PDF.js'));
    document.head.appendChild(s);
  });
  return _pdfjsPromise;
}

/** Extrai a capa (página 1) de um PDF File como Blob JPEG.
 * Default 1200px de largura — adequado pra capa de revista.
 */
export async function extractCoverFromPdf(pdfFile, maxWidth = 1200) {
  const pdfjs = await loadPdfJs();
  const buf = await pdfFile.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(1);

  const viewport = page.getViewport({ scale: 1 });
  const scale = maxWidth / viewport.width;
  const scaled = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = scaled.width;
  canvas.height = scaled.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: scaled }).promise;

  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
}

/* ════════════════════════════════════════════════════════════
   QR Code — geração client-side
   ════════════════════════════════════════════════════════════ */

let _qrPromise = null;
async function loadQrLib() {
  if (window.QRCode) return window.QRCode;
  if (_qrPromise) return _qrPromise;
  _qrPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    s.onload = () => res(window.QRCode);
    s.onerror = () => rej(new Error('Falha ao carregar lib QRCode'));
    document.head.appendChild(s);
  });
  return _qrPromise;
}

/** Gera QR code como Blob PNG.
 * @param {string} url - destino do QR
 * @param {number} size - tamanho em pixels (default 512)
 * @returns {Promise<Blob>} PNG blob
 */
export async function generateQrPng(url, size = 512) {
  await loadQrLib();
  // qrcodejs renderiza dentro de um div temporário
  const tmp = document.createElement('div');
  tmp.style.cssText = 'position:absolute;left:-9999px;top:0;';
  document.body.appendChild(tmp);
  try {
    new window.QRCode(tmp, {
      text: url,
      width: size,
      height: size,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.H,
    });
    // Aguarda render (qrcodejs cria <img> ou <canvas>)
    await new Promise(r => setTimeout(r, 50));
    const canvas = tmp.querySelector('canvas');
    const img = tmp.querySelector('img');

    if (canvas) {
      return new Promise(res => canvas.toBlob(res, 'image/png'));
    }
    if (img) {
      // Converter <img> pra blob via canvas
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || size;
      c.height = img.naturalHeight || size;
      c.getContext('2d').drawImage(img, 0, 0);
      return new Promise(res => c.toBlob(res, 'image/png'));
    }
    throw new Error('QRCode lib não retornou canvas nem img');
  } finally {
    document.body.removeChild(tmp);
  }
}

/** Gera QR como Data URL (pra preview rápido). */
export async function generateQrDataUrl(url, size = 256) {
  const blob = await generateQrPng(url, size);
  return new Promise(res => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(blob);
  });
}

/* ════════════════════════════════════════════════════════════
   EDITIONS — CRUD
   ════════════════════════════════════════════════════════════ */

const EDITION_DEFAULTS = {
  active: true,
  title: 'LUXURY TRAVEL',
  pages: 0,
  pt: { pdfUrl: null, pdfSize: 0, coverUrl: null },
  en: { pdfUrl: null, pdfSize: 0, coverUrl: null },
  flipbookUrl: null,
  qrUrl: null,
  shortUrl: null,
};

/** Lista todas as edições, ordem desc por número. */
export async function fetchEditions({ activeOnly = false } = {}) {
  const snap = await getDocs(query(
    collection(db, EDITIONS_COL),
    orderBy('number', 'desc'),
    limit(100),
  )).catch(() => ({ docs: [] }));
  let items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (activeOnly) items = items.filter(e => e.active !== false);
  return items;
}

/** Busca uma edição por ID. */
export async function fetchEdition(id) {
  const snap = await getDoc(doc(db, EDITIONS_COL, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** Cria edição. Slug auto: luxury-travel-{number padded}. */
export async function createEdition(data) {
  if (!data.number) throw new Error('Número da edição é obrigatório.');
  const number = parseInt(data.number);
  const slug = data.slug || `luxury-travel-${String(number).padStart(2, '0')}`;
  const flipbookUrl = data.flipbookUrl || `${GH_PAGES_BASE}/${slug}/`;

  const payload = {
    ...EDITION_DEFAULTS,
    ...data,
    number,
    slug,
    flipbookUrl,
    title: String(data.title || 'LUXURY TRAVEL').trim().slice(0, 100),
    subtitle: String(data.subtitle || `Edition ${number}`).trim().slice(0, 100),
    pages: parseInt(data.pages) || 0,
    publishedAt: data.publishedAt ? new Date(data.publishedAt) : null,
    pt: { ...EDITION_DEFAULTS.pt, ...(data.pt || {}) },
    en: { ...EDITION_DEFAULTS.en, ...(data.en || {}) },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: { uid: uid(), name: userName() },
  };

  const ref = await addDoc(collection(db, EDITIONS_COL), payload);
  await auditLog('luxury_travel.edition.create', EDITIONS_COL, ref.id, {
    number, slug, title: payload.title,
  });
  return { id: ref.id, ...payload };
}

/** Atualiza edição existente. */
export async function updateEdition(id, patch) {
  if (!id) throw new Error('id obrigatório');
  const updates = { ...patch, updatedAt: serverTimestamp() };
  if (typeof updates.title === 'string') updates.title = updates.title.trim().slice(0, 100);
  if (typeof updates.subtitle === 'string') updates.subtitle = updates.subtitle.trim().slice(0, 100);
  if (updates.publishedAt && !(updates.publishedAt instanceof Date)) {
    updates.publishedAt = new Date(updates.publishedAt);
  }
  if (updates.number !== undefined) updates.number = parseInt(updates.number);
  if (updates.pages !== undefined) updates.pages = parseInt(updates.pages) || 0;
  await updateDoc(doc(db, EDITIONS_COL, id), updates);
  await auditLog('luxury_travel.edition.update', EDITIONS_COL, id, {});
}

/** Remove edição (apaga doc + arquivos no R2). */
export async function deleteEdition(id) {
  const edition = await fetchEdition(id);
  if (!edition) return;

  // Apaga arquivos no R2 (best-effort)
  const r2Paths = [];
  if (edition.pt?.pdfUrl?.includes(R2_PUBLIC_URL)) {
    r2Paths.push(edition.pt.pdfUrl.replace(`${R2_PUBLIC_URL}/`, ''));
  }
  if (edition.en?.pdfUrl?.includes(R2_PUBLIC_URL)) {
    r2Paths.push(edition.en.pdfUrl.replace(`${R2_PUBLIC_URL}/`, ''));
  }
  if (edition.pt?.coverUrl?.includes(R2_PUBLIC_URL)) {
    r2Paths.push(edition.pt.coverUrl.replace(`${R2_PUBLIC_URL}/`, ''));
  }
  if (edition.en?.coverUrl?.includes(R2_PUBLIC_URL)) {
    r2Paths.push(edition.en.coverUrl.replace(`${R2_PUBLIC_URL}/`, ''));
  }
  if (edition.qrUrl?.includes(R2_PUBLIC_URL)) {
    r2Paths.push(edition.qrUrl.replace(`${R2_PUBLIC_URL}/`, ''));
  }
  await Promise.allSettled(r2Paths.map(p => deleteFromR2(p)));

  await deleteDoc(doc(db, EDITIONS_COL, id));
  await auditLog('luxury_travel.edition.delete', EDITIONS_COL, id, {
    slug: edition.slug, r2Removed: r2Paths.length,
  });
}

/** Helper: upload PDF + extract+upload cover + salva URLs na edição.
 * @param {string} editionId
 * @param {File} pdfFile
 * @param {'pt'|'en'} lang
 * @param {string} slug
 * @param {Function} [onProgress]
 */
export async function uploadEditionPdf(editionId, pdfFile, lang, slug, onProgress) {
  if (!['pt', 'en'].includes(lang)) throw new Error('lang deve ser pt ou en');
  if (!pdfFile) throw new Error('PDF obrigatório');
  if (pdfFile.type !== 'application/pdf') throw new Error('Arquivo deve ser PDF.');
  if (pdfFile.size > 100 * 1024 * 1024) throw new Error('PDF não pode passar 100MB.');

  const pdfPath = `${R2_BASE_PATH}/editions/${slug}/pdf_${lang}.pdf`;
  const pdfUrl = await uploadFileToR2(pdfFile, pdfPath, onProgress);

  // Auto-extract cover
  let coverUrl = null;
  try {
    const coverBlob = await extractCoverFromPdf(pdfFile, 1200);
    if (coverBlob) {
      const coverPath = `${R2_BASE_PATH}/editions/${slug}/cover_${lang}.jpg`;
      coverUrl = await uploadFileToR2(coverBlob, coverPath);
    }
  } catch (e) {
    console.warn('[luxuryTravel] cover auto-extract falhou:', e.message);
  }

  // Atualiza edição
  const patch = {};
  patch[lang] = { pdfUrl, pdfSize: pdfFile.size, coverUrl };
  await updateEdition(editionId, patch);

  return { pdfUrl, pdfSize: pdfFile.size, coverUrl };
}

/** Upload manual de capa (sobrescreve auto-extract). */
export async function uploadEditionCover(editionId, coverFile, lang, slug) {
  if (!['pt', 'en'].includes(lang)) throw new Error('lang deve ser pt ou en');
  if (!coverFile.type.startsWith('image/')) throw new Error('Capa deve ser imagem (JPG/PNG/WebP).');
  if (coverFile.size > 5 * 1024 * 1024) throw new Error('Capa não pode passar 5MB.');

  const ext = coverFile.type === 'image/png' ? 'png' : coverFile.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${R2_BASE_PATH}/editions/${slug}/cover_${lang}.${ext}`;
  const coverUrl = await uploadFileToR2(coverFile, path);

  const edition = await fetchEdition(editionId);
  const patch = {};
  patch[lang] = { ...(edition?.[lang] || {}), coverUrl };
  await updateEdition(editionId, patch);

  return coverUrl;
}

/** Gera e salva QR code da edição no R2. */
export async function regenerateEditionQr(editionId, slug, targetUrl) {
  const url = targetUrl || `${GH_PAGES_BASE}/${slug}/`;
  const qrBlob = await generateQrPng(url, 512);
  const path = `${R2_BASE_PATH}/editions/${slug}/qr.png`;
  const qrUrl = await uploadFileToR2(qrBlob, path);
  await updateEdition(editionId, { qrUrl });
  return qrUrl;
}

/* ════════════════════════════════════════════════════════════
   FONTS — Upload + lista + delete
   ════════════════════════════════════════════════════════════ */

export async function fetchFonts() {
  const snap = await getDocs(query(
    collection(db, FONTS_COL),
    orderBy('family', 'asc'),
    limit(200),
  )).catch(() => ({ docs: [] }));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function uploadFont(file, meta = {}) {
  if (!file) throw new Error('Arquivo obrigatório');
  const allowedExts = ['otf', 'ttf', 'woff', 'woff2'];
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!allowedExts.includes(ext)) {
    throw new Error('Formato suportado: OTF, TTF, WOFF, WOFF2.');
  }
  if (file.size > 10 * 1024 * 1024) throw new Error('Fonte não pode passar 10MB.');

  // Path no R2 — preserva nome original
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${R2_BASE_PATH}/fonts/${safeName}`;
  const url = await uploadFileToR2(file, path);

  const family = (meta.family || file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')).slice(0, 100);
  const payload = {
    family,
    weight: meta.weight || 400,
    style: meta.style || 'normal',
    filename: safeName,
    originalName: file.name,
    url,
    format: ext,
    size: file.size,
    uploadedAt: serverTimestamp(),
    uploadedBy: { uid: uid(), name: userName() },
  };
  const ref = await addDoc(collection(db, FONTS_COL), payload);
  await auditLog('luxury_travel.font.upload', FONTS_COL, ref.id, { family, filename: safeName });
  return { id: ref.id, ...payload };
}

export async function deleteFont(id) {
  const snap = await getDoc(doc(db, FONTS_COL, id));
  if (!snap.exists()) return;
  const data = snap.data();
  // Apaga R2
  if (data.filename) {
    await deleteFromR2(`${R2_BASE_PATH}/fonts/${data.filename}`);
  }
  await deleteDoc(doc(db, FONTS_COL, id));
  await auditLog('luxury_travel.font.delete', FONTS_COL, id, { family: data.family });
}

/* ════════════════════════════════════════════════════════════
   SETTINGS — config global
   ════════════════════════════════════════════════════════════ */

const SETTINGS_DEFAULTS = {
  homeUrl: GH_PAGES_BASE,
  homeQrUrl: null,
  description: 'Biblioteca bilíngue (PT / EN) das edições da revista LUXURY TRAVEL by PRIMETOUR.',
  ghRepo: GH_REPO,
};

export async function fetchSettings() {
  const snap = await getDoc(doc(db, SETTINGS_COL, 'global'));
  return { ...SETTINGS_DEFAULTS, ...(snap.exists() ? snap.data() : {}) };
}

export async function updateSettings(patch) {
  await setDoc(doc(db, SETTINGS_COL, 'global'), {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: { uid: uid(), name: userName() },
  }, { merge: true });
  await auditLog('luxury_travel.settings.update', SETTINGS_COL, 'global', {});
}

/** Regenera QR da home e salva nas settings. */
export async function regenerateHomeQr() {
  const settings = await fetchSettings();
  const url = settings.homeUrl || GH_PAGES_BASE;
  const qrBlob = await generateQrPng(url, 512);
  const path = `${R2_BASE_PATH}/home_qr.png`;
  const homeQrUrl = await uploadFileToR2(qrBlob, path);
  await updateSettings({ homeQrUrl });
  return homeQrUrl;
}

/* ════════════════════════════════════════════════════════════
   SEED — importa editions.json do GitHub na primeira load
   ════════════════════════════════════════════════════════════ */

// Lock global pra evitar race quando 2 chamadas paralelas tentam seedar
// (página pública + admin abrindo simultaneamente).
let _seedLock = null;

/** Idempotente: só cria edições que não existem ainda.
 * Lock evita duplicatas em chamadas paralelas.
 */
export async function seedFromGithubEditions() {
  // Se já tem seed em andamento, espera ele terminar e retorna mesmo resultado
  if (_seedLock) return _seedLock;
  _seedLock = _seedFromGithubEditionsImpl().finally(() => { _seedLock = null; });
  return _seedLock;
}

async function _seedFromGithubEditionsImpl() {
  let editionsJson;
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${GH_REPO}/main/editions.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    editionsJson = await res.json();
  } catch (e) {
    console.warn('[luxuryTravel] não conseguiu fetch editions.json:', e.message);
    return { created: 0, skipped: 0, errors: [e.message] };
  }

  const existing = await fetchEditions();
  const existingSlugs = new Set(existing.map(e => e.slug));
  const report = { created: 0, skipped: 0, errors: [] };

  for (const item of editionsJson) {
    if (existingSlugs.has(item.slug)) { report.skipped++; continue; }
    try {
      // Tenta extrair número do slug (luxury-travel-07 → 7)
      const numMatch = item.slug?.match(/(\d+)$/);
      const number = numMatch ? parseInt(numMatch[1]) : 0;
      const flipbookUrl = `${GH_PAGES_BASE}/${item.slug}/`;
      const coverUrl = item.cover ? `${GH_PAGES_BASE}/${item.cover}` : null;

      await createEdition({
        number,
        slug: item.slug,
        title: item.title || 'LUXURY TRAVEL',
        subtitle: item.subtitle || `Edition ${number}`,
        pages: item.pages || 0,
        flipbookUrl,
        active: true,
        // Como o seed vem do GH, não temos PDFs em R2 ainda — referenciamos GH
        pt: { pdfUrl: null, pdfSize: 0, coverUrl },
        en: { pdfUrl: null, pdfSize: 0, coverUrl: null },
      });
      report.created++;
    } catch (e) {
      report.errors.push(`${item.slug}: ${e.message}`);
    }
  }

  return report;
}

/* ════════════════════════════════════════════════════════════
   HELPERS UI
   ════════════════════════════════════════════════════════════ */

export function formatBytes(bytes) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

export const LUXURY_TRAVEL_GH_REPO = GH_REPO;
export const LUXURY_TRAVEL_GH_BASE = GH_PAGES_BASE;
export const LUXURY_TRAVEL_R2_BASE = R2_BASE_PATH;
