/**
 * PRIMETOUR — Portal de Dicas: Service
 * Firestore CRUD, R2 upload, download control, segments config
 */

import {
  collection, doc, getDoc, getDocs, setDoc, addDoc,
  updateDoc, deleteDoc, query, where, orderBy,
  serverTimestamp, increment, limit,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';

/* ─── Cloudflare R2 ───────────────────────────────────────── */
export const R2_PUBLIC_URL   = 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev';
export const R2_ACCOUNT_ID   = '29a66e93504dfad5ae7cdb2c6044ed6f';
export const R2_WORKER_URL   = 'https://primetour-images.rene-castro.workers.dev';
export const R2_UPLOAD_TOKEN = 'primetour2026-imagens-secreto-xk9q';

/* ─── Continents ──────────────────────────────────────────── */
export const CONTINENTS = [
  'Brasil', 'África', 'América Central', 'Caribe',
  'América do Norte', 'América do Sul', 'Ásia',
  'Europa', 'Oriente Médio', 'Oceania', 'Antártica',
];

/* ─── Default categories per segment ─────────────────────── */
export const DEFAULT_CATEGORIES = {
  atracoes:         ['Edifícios e construções urbanas','Galerias de arte','Igrejas e templos','Parques e Jardins','Museus e centros culturais','Complexos esportivos'],
  atracoes_criancas:['Edifícios e construções urbanas','Galerias de arte','Parques e Jardins','Museus e centros culturais','Complexos esportivos'],
  restaurantes:     ['Cafés e bistrôs','Vegetariano e vegano','Asiático','Culinária Internacional','Mediterrâneo','Infantil'],
  vida_noturna:     ['Balada','Bares e lounges','Vinhos'],
  espetaculos:      ['Teatro','Shows'],
  compras:          ['Antiguidades','Itens em couro','Boutiques','Brinquedos','Cosméticos','Decoração','Gourmet','Joias e Relógios','Livrarias','Lojas de Departamento','Moda Feminina','Moda Infantil','Moda Masculina','Sapatos Femininos','Outlet','Eletrônicos','Variados','Vinhos','Vintage'],
  highlights:       ['Arquitetura','Atividades de Verão','Passeio de Helicóptero'],
  agenda_cultural:  ['Concertos','Dança','Espetáculos de Variedades','Eventos Esportivos','Exposições','Festivais','Musicais','Óperas','Shows'],
};

/* ─── Segments definition ─────────────────────────────────── */
// mode:
//   special_info  → Informações Gerais (structured form)
//   simple_list   → Bairros, Arredores (text items)
//   place_list    → standard list with category+place fields
//   agenda        → Agenda Cultural (place_list + period per item)
export const SEGMENTS = [
  { key: 'informacoes_gerais',  label: 'Informações Gerais',               mode: 'special_info' },
  { key: 'bairros',             label: 'Bairros',                          mode: 'simple_list'  },
  { key: 'atracoes',            label: 'Atrações',                         mode: 'place_list'   },
  { key: 'atracoes_criancas',   label: 'Atrações para Crianças',           mode: 'place_list'   },
  { key: 'restaurantes',        label: 'Restaurantes',                     mode: 'place_list'   },
  { key: 'vida_noturna',        label: 'Vida Noturna',                     mode: 'place_list'   },
  { key: 'espetaculos',         label: 'Casas de Espetáculos, Teatros e Cia.', mode: 'place_list' },
  { key: 'compras',             label: 'Compras',                          mode: 'place_list'   },
  { key: 'arredores',           label: 'Arredores',                        mode: 'simple_list'  },
  { key: 'highlights',          label: 'Highlights',                       mode: 'place_list'   },
  { key: 'agenda_cultural',     label: 'Agenda Cultural',                  mode: 'agenda'       },
];

export const GENERATION_FORMATS = [
  { key: 'docx', label: 'Word (.docx)' },
  { key: 'pdf',  label: 'PDF'          },
  { key: 'pptx', label: 'PowerPoint'   },
  { key: 'web',  label: 'Link Web'     },
];

export const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
export const PARTNER_DAILY_LIMIT = 5;

function uid() { return store.get('currentUser')?.uid; }

/* ─── Categories (dynamic, per segment) ──────────────────── */
export async function fetchCategories(segmentKey) {
  try {
    const snap = await getDoc(doc(db, 'portal_categories', segmentKey));
    if (snap.exists()) {
      return snap.data().categories || DEFAULT_CATEGORIES[segmentKey] || [];
    }
  } catch(e) {}
  return DEFAULT_CATEGORIES[segmentKey] || [];
}

export async function saveCategories(segmentKey, categories) {
  if (!store.canManagePortal()) throw new Error('Permissão negada.');
  await setDoc(doc(db, 'portal_categories', segmentKey), {
    categories,
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
  }, { merge: true });
}

/* ─── Areas ───────────────────────────────────────────────── */
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

/* ─── Destinations ────────────────────────────────────────── */
export async function fetchDestinations({ continent, country } = {}) {
  const snap = await getDocs(collection(db, 'portal_destinations'));
  let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (continent) docs = docs.filter(d => d.continent === continent);
  if (country)   docs = docs.filter(d => d.country   === country);
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

/* ─── Tips ────────────────────────────────────────────────── */
export async function fetchTip(destinationId) {
  const snap = await getDocs(
    query(collection(db, 'portal_tips'),
      where('destinationId', '==', destinationId), limit(1))
  );
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function fetchTips({ continent, country } = {}) {
  const snap = await getDocs(query(collection(db, 'portal_tips'), orderBy('updatedAt', 'desc')));
  let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (continent) docs = docs.filter(d => d.continent === continent);
  if (country)   docs = docs.filter(d => d.country   === country);
  return docs;
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

export async function fetchAvailableSegments(destinationId) {
  const tip = await fetchTip(destinationId);
  if (!tip?.segments) return [];
  return Object.entries(tip.segments)
    .filter(([, seg]) => {
      if (!seg) return false;
      if (seg.info && Object.values(seg.info).some(v => v && String(v).trim())) return true;
      if (typeof seg.content === 'string' && seg.content.trim()) return true;
      if (Array.isArray(seg.items) && seg.items.length > 0) return true;
      return false;
    })
    .map(([key]) => key);
}

/* ─── Web Links ──────────────────────────────────────────── */
export async function fetchWebLinksByTip(tipId) {
  const snap = await getDocs(
    query(collection(db, 'portal_web_links'), orderBy('createdAt', 'desc'))
  );
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(link =>
      (link.allTips  || []).some(t  => t.tipId      === tipId) ||
      (link.tipData  || []).some(({ tip }) => tip?.id === tipId)
    );
}

export async function updateWebLink(token, updates) {
  const { updateDoc } = await import(
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
  );
  await updateDoc(doc(db, 'portal_web_links', token), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

/* ─── Download control ────────────────────────────────────── */
export async function checkDownloadLimit() {
  if (store.isMaster() || store.can('portal_download_unlimited'))
    return { allowed: true, remaining: Infinity };
  const today  = new Date().toISOString().slice(0, 10);
  const ref    = doc(db, 'portal_downloads', `${uid()}_${today}`);
  const snap   = await getDoc(ref);
  const count  = snap.exists ? (snap.data().count || 0) : 0;
  return { allowed: count < PARTNER_DAILY_LIMIT, remaining: PARTNER_DAILY_LIMIT - count, count };
}

export async function registerDownload() {
  if (store.isMaster() || store.can('portal_download_unlimited')) return;
  const today = new Date().toISOString().slice(0, 10);
  const ref   = doc(db, 'portal_downloads', `${uid()}_${today}`);
  const snap  = await getDoc(ref);
  if (snap.exists) await updateDoc(ref, { count: increment(1), lastAt: serverTimestamp() });
  else await setDoc(ref, { userId: uid(), date: today, count: 1, lastAt: serverTimestamp() });
}

/* ─── Images ──────────────────────────────────────────────── */
export async function fetchImages({ continent, country, city } = {}) {
  const snap = await getDocs(query(collection(db, 'portal_images'), orderBy('uploadedAt', 'desc')));
  let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (continent) docs = docs.filter(d => d.continent === continent);
  if (country)   docs = docs.filter(d => d.country   === country);
  if (city)      docs = docs.filter(d => d.city       === city);
  return docs;
}

export async function saveImageMeta(data) {
  const ref = doc(collection(db, 'portal_images'));
  const meta = {
    continent:    data.continent    || '',
    country:      data.country      || '',
    city:         data.city         || '',
    name:         data.name         || data.originalName || '',
    placeName:    data.placeName    || '', // nome do lugar específico que a foto representa
    tags:         Array.isArray(data.tags) ? data.tags : [],
    type:         data.type         || 'galeria', // 'destaque'|'galeria'|'logo_area'|'banner'
    url:          data.url          || '',
    path:         data.path         || '',
    originalName: data.originalName || '',
    sizeMB:       data.sizeMB       || 0,
    width:        data.width        || 0,
    height:       data.height       || 0,
    uploadedAt:   serverTimestamp(),
    uploadedBy:   uid(),
  };
  await setDoc(ref, meta);
  return ref.id;
}

export async function updateImageMeta(id, data) {
  const allowed = ['name','placeName','tags','type','continent','country','city'];
  const patch   = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)));
  await updateDoc(doc(db, 'portal_images', id), patch);
}

export async function deleteImageMeta(id) {
  if (!store.canManagePortal()) throw new Error('Permissão negada.');
  // Also remove from R2 if path exists
  const snap = await getDoc(doc(db, 'portal_images', id));
  if (snap.exists() && snap.data().path) {
    await deleteFromR2(snap.data().path).catch(() => {}); // non-fatal
  }
  await deleteDoc(doc(db, 'portal_images', id));
}

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
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        blob => blob
          ? resolve({ blob, width: canvas.width, height: canvas.height })
          : reject(new Error('Conversão WebP falhou.')),
        'image/webp', quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida.')); };
    img.src = url;
  });
}

export async function uploadImageToR2(webpBlob, path) {
  if (!R2_WORKER_URL)   throw new Error('R2_WORKER_URL não configurada. Faça o deploy do Worker.');
  if (!R2_UPLOAD_TOKEN) throw new Error('R2_UPLOAD_TOKEN não configurado.');
  const fd = new FormData();
  fd.append('file', webpBlob, path.split('/').pop());
  fd.append('path', path);
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

export async function deleteFromR2(path) {
  if (!R2_WORKER_URL || !R2_UPLOAD_TOKEN) return; // silently skip if not configured
  const url = `${R2_WORKER_URL}?path=${encodeURIComponent(path)}`;
  await fetch(url, {
    method: 'DELETE',
    headers: { 'X-Upload-Token': R2_UPLOAD_TOKEN },
  });
}

/* ─── Generations ─────────────────────────────────────────── */
export async function recordGeneration(data) {
  const ref = doc(collection(db, 'portal_generations'));
  await setDoc(ref, { ...data, generatedBy: uid(), generatedAt: serverTimestamp() });
  return ref.id;
}

/* ─── Terms ───────────────────────────────────────────────── */
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
  return snap.exists;
}

export async function acceptTerms(termsId) {
  await setDoc(doc(db, 'portal_terms_acceptance', `${uid()}_${termsId}`), {
    userId: uid(), termsId, acceptedAt: serverTimestamp(), userAgent: navigator.userAgent,
  });
}
