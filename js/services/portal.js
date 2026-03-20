/**
 * PRIMETOUR — Portal de Dicas Service
 * Gerencia áreas, destinos, dicas, banco de imagens e controle de downloads
 *
 * Cloudflare R2:
 *   Account ID:  29a66e93504dfad5ae7cdb2c6044ed6f
 *   Bucket:      primetour-portal
 *   Public URL:  https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev
 *   (Credenciais de escrita ficam no backend / GitHub Actions — nunca no frontend)
 */

import {
  collection, doc, getDoc, getDocs, setDoc, addDoc,
  updateDoc, deleteDoc, query, where, orderBy,
  serverTimestamp, increment, limit,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';

/* ─── Configuração Cloudflare R2 ──────────────────────────── */
export const R2_PUBLIC_URL = 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev';
export const R2_ACCOUNT_ID = '29a66e93504dfad5ae7cdb2c6044ed6f';
// Upload de imagens é feito via endpoint serverless (Cloudflare Worker) para não
// expor credenciais R2 no frontend. O Worker recebe o arquivo, converte para .webp
// e salva no bucket.
export const R2_WORKER_URL = ''; // configurar após deploy do Worker

/* ─── Constantes ──────────────────────────────────────────── */
export const CONTINENTS = [
  'Brasil', 'África', 'América Central', 'Caribe',
  'América do Norte', 'América do Sul', 'Ásia',
  'Europa', 'Oriente Médio', 'Oceania', 'Antártica',
];

export const SEGMENTS = [
  { key: 'informacoes_gerais',    label: 'Informações Gerais',    mode: 'text'  },
  { key: 'bairros',               label: 'Bairros',               mode: 'text'  },
  { key: 'atracoes',              label: 'Atrações',              mode: 'list'  },
  { key: 'atracoes_criancas',     label: 'Atrações para Crianças', mode: 'list' },
  { key: 'restaurantes',          label: 'Restaurantes',          mode: 'list'  },
  { key: 'vida_noturna',          label: 'Vida Noturna',          mode: 'list'  },
  { key: 'compras',               label: 'Compras',               mode: 'list'  },
  { key: 'arredores',             label: 'Arredores',             mode: 'text'  },
  { key: 'highlights',            label: 'Highlights',            mode: 'text'  },
  { key: 'agenda_cultural',       label: 'Agenda Cultural',       mode: 'list'  },
];

export const GENERATION_FORMATS = [
  { key: 'docx', label: 'Word (.docx)' },
  { key: 'pdf',  label: 'PDF'          },
  { key: 'pptx', label: 'PowerPoint'   },
  { key: 'web',  label: 'Link Web'     },
];

export const PARTNER_DAILY_LIMIT = 5;

/* ─── Helpers ─────────────────────────────────────────────── */
function uid() { return store.get('currentUser')?.uid; }

/* ─── ÁREAS ───────────────────────────────────────────────── */
export async function fetchAreas() {
  const snap = await getDocs(query(collection(db, 'portal_areas'), orderBy('name')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveArea(id, data) {
  if (!store.canManagePortal()) throw new Error('Permissão negada.');
  const ref = id ? doc(db, 'portal_areas', id) : doc(collection(db, 'portal_areas'));
  await setDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
    ...(id ? {} : { createdAt: serverTimestamp(), createdBy: uid() }),
  }, { merge: true });
  return ref.id;
}

export async function deleteArea(id) {
  if (!store.canManagePortal()) throw new Error('Permissão negada.');
  await deleteDoc(doc(db, 'portal_areas', id));
}

/* ─── DESTINOS ────────────────────────────────────────────── */
export async function fetchDestinations({ continent, country } = {}) {
  // Client-side filtering + sorting to avoid composite Firestore indexes
  const snap = await getDocs(collection(db, 'portal_destinations'));
  let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (continent) docs = docs.filter(d => d.continent === continent);
  if (country)   docs = docs.filter(d => d.country   === country);
  // Sort: continent → country → city
  docs.sort((a, b) => {
    const ca = (a.continent||'').localeCompare(b.continent||'', 'pt-BR');
    if (ca !== 0) return ca;
    const cb = (a.country||'').localeCompare(b.country||'', 'pt-BR');
    if (cb !== 0) return cb;
    return (a.city||'').localeCompare(b.city||'', 'pt-BR');
  });
  return docs;
}

export async function fetchContinentsWithContent() {
  const snap = await getDocs(collection(db, 'portal_destinations'));
  const continents = new Set(snap.docs.map(d => d.data().continent).filter(Boolean));
  return CONTINENTS.filter(c => continents.has(c));
}

export async function saveDestination(id, data) {
  if (!store.canManagePortal()) throw new Error('Permissão negada.');
  const ref = id
    ? doc(db, 'portal_destinations', id)
    : doc(collection(db, 'portal_destinations'));
  // Build slug: continent/country/city
  const slug = [data.continent, data.country, data.city]
    .filter(Boolean).map(s => s.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    .join('/');
  await setDoc(ref, {
    ...data, slug,
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
    ...(id ? {} : { createdAt: serverTimestamp(), createdBy: uid() }),
  }, { merge: true });
  return ref.id;
}

export async function deleteDestination(id) {
  if (!store.canManagePortal()) throw new Error('Permissão negada.');
  await deleteDoc(doc(db, 'portal_destinations', id));
}

/* ─── DICAS ───────────────────────────────────────────────── */
export async function fetchTip(destinationId) {
  const snap = await getDocs(
    query(collection(db, 'portal_tips'),
      where('destinationId', '==', destinationId), limit(1))
  );
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// Returns array of segment keys that have content for a given destination
export async function fetchAvailableSegments(destinationId) {
  const tip = await fetchTip(destinationId);
  if (!tip?.segments) return [];
  return Object.entries(tip.segments)
    .filter(([, seg]) => {
      if (!seg) return false;
      // Check if segment has actual content
      if (typeof seg.content === 'string' && seg.content.trim()) return true;
      if (Array.isArray(seg.items) && seg.items.length > 0) return true;
      return false;
    })
    .map(([key]) => key);
}

export async function fetchTips({ continent, country } = {}) {
  let constraints = [orderBy('updatedAt', 'desc')];
  if (continent) constraints.unshift(where('continent', '==', continent));
  if (country)   constraints.unshift(where('country',   '==', country));
  const snap = await getDocs(query(collection(db, 'portal_tips'), ...constraints));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveTip(id, data) {
  if (!store.canCreateTip()) throw new Error('Permissão negada.');
  const ref = id
    ? doc(db, 'portal_tips', id)
    : doc(collection(db, 'portal_tips'));
  await setDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
    ...(id ? {} : { createdAt: serverTimestamp(), createdBy: uid() }),
  }, { merge: true });
  return ref.id;
}

export async function deleteTip(id) {
  if (!store.canManagePortal()) throw new Error('Permissão negada.');
  await deleteDoc(doc(db, 'portal_tips', id));
}

/* ─── CONTROLE DE DOWNLOADS (limite Parceiro) ─────────────── */
export async function checkDownloadLimit() {
  // Master e quem tem portal_download_unlimited não tem limite
  if (store.isMaster() || store.can('portal_download_unlimited')) return { allowed: true, remaining: Infinity };

  const today  = new Date().toISOString().slice(0, 10);
  const docId  = `${uid()}_${today}`;
  const ref    = doc(db, 'portal_downloads', docId);
  const snap   = await getDoc(ref);
  const count  = snap.exists() ? (snap.data().count || 0) : 0;
  const remaining = PARTNER_DAILY_LIMIT - count;

  return { allowed: remaining > 0, remaining, count };
}

export async function registerDownload() {
  if (store.isMaster() || store.can('portal_download_unlimited')) return;
  const today = new Date().toISOString().slice(0, 10);
  const docId = `${uid()}_${today}`;
  const ref   = doc(db, 'portal_downloads', docId);
  const snap  = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, { count: increment(1), lastAt: serverTimestamp() });
  } else {
    await setDoc(ref, { userId: uid(), date: today, count: 1, lastAt: serverTimestamp() });
  }
}

/* ─── BANCO DE IMAGENS ────────────────────────────────────── */
export async function fetchImages({ continent, country, city } = {}) {
  let constraints = [orderBy('uploadedAt', 'desc')];
  if (continent) constraints.unshift(where('continent', '==', continent));
  if (country)   constraints.unshift(where('country',   '==', country));
  if (city)      constraints.unshift(where('city',      '==', city));
  const snap = await getDocs(query(collection(db, 'portal_images'), ...constraints));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveImageMeta(data) {
  // Called after successful R2 upload
  const ref = doc(collection(db, 'portal_images'));
  await setDoc(ref, {
    ...data,
    uploadedAt: serverTimestamp(),
    uploadedBy: uid(),
  });
  return ref.id;
}

export async function deleteImageMeta(id) {
  if (!store.canManagePortal()) throw new Error('Permissão negada.');
  await deleteDoc(doc(db, 'portal_images', id));
}

/**
 * Converte File → .webp via canvas (client-side, sem custo de servidor)
 * @param {File} file — qualquer formato de imagem
 * @param {number} maxWidth — largura máxima (default: 1920)
 * @param {number} quality — 0-1 (default: 0.85)
 * @returns {Promise<Blob>} webp blob
 */
export async function convertToWebp(file, maxWidth = 1920, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale  = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Conversão WebP falhou.'));
      }, 'image/webp', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida.')); };
    img.src = url;
  });
}

/**
 * Upload de imagem para Cloudflare R2 via Worker
 * Path no bucket: {continent}/{country}/{city}/{filename}.webp
 */
export async function uploadImageToR2(webpBlob, path) {
  if (!R2_WORKER_URL) throw new Error('Worker URL não configurada.');
  const formData = new FormData();
  formData.append('file', webpBlob, path.split('/').pop());
  formData.append('path', path);
  const res = await fetch(R2_WORKER_URL, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(`Upload falhou: ${res.status}`);
  const data = await res.json();
  return `${R2_PUBLIC_URL}/${path}`;
}

/* ─── GERAÇÕES ────────────────────────────────────────────── */
export async function recordGeneration(data) {
  const ref = doc(collection(db, 'portal_generations'));
  await setDoc(ref, {
    ...data,
    generatedBy:   uid(),
    generatedAt:   serverTimestamp(),
  });
  // Atualiza contador do destino
  if (data.destinationIds?.length) {
    for (const destId of data.destinationIds) {
      const tipRef = doc(db, 'portal_tips_stats', destId);
      const snap   = await getDoc(tipRef);
      if (snap.exists()) await updateDoc(tipRef, { generationCount: increment(1) });
      else await setDoc(tipRef, { destinationId: destId, generationCount: 1 });
    }
  }
  return ref.id;
}

/* ─── TERMOS DE USO ───────────────────────────────────────── */
export async function getActiveTerms() {
  const snap = await getDocs(
    query(collection(db, 'portal_terms'), orderBy('updatedAt', 'desc'), limit(1))
  );
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function hasAcceptedTerms(termsId) {
  const ref  = doc(db, 'portal_terms_acceptance', `${uid()}_${termsId}`);
  const snap = await getDoc(ref);
  return snap.exists();
}

export async function acceptTerms(termsId) {
  const ref = doc(db, 'portal_terms_acceptance', `${uid()}_${termsId}`);
  await setDoc(ref, {
    userId:    uid(),
    termsId,
    acceptedAt: serverTimestamp(),
    userAgent:  navigator.userAgent,
  });
}
