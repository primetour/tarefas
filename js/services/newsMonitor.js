/**
 * PRIMETOUR — News Monitor Service
 */
import { db }   from '../firebase.js';
import { auditLog } from '../auth/audit.js';
import { store } from '../store.js';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp, where,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const uid = () => store.get('currentUser')?.uid;

export const NEWS_CATEGORIES = [
  'Hotelaria', 'Cruzeiros', 'Destinos', 'Companhias Aéreas',
  'Mercado', 'Sistemas', 'Agências e Operadoras',
];

export const NEWS_SUBCATEGORIES = [
  'Notícias', 'Curiosidades', 'Dicas', 'Tendências', 'Insights',
  'Eventos', 'Tecnologia', 'Sustentabilidade', 'Educação',
];

export async function fetchNews(filters = {}) {
  let q = query(collection(db, 'news_monitor'), orderBy('publishedAt', 'desc'));
  const snap = await getDocs(q);
  let items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (filters.category)    items = items.filter(i => i.category    === filters.category);
  if (filters.subcategory) items = items.filter(i => i.subcategory === filters.subcategory);
  if (filters.search)      items = items.filter(i =>
    (i.title+i.description+i.category+i.subcategory)
      .toLowerCase().includes(filters.search.toLowerCase()));
  if (filters.validity === 'valid') {
    const now = new Date();
    items = items.filter(i => !i.expiresAt || new Date(i.expiresAt) >= now);
  }
  if (filters.validity === 'expired') {
    const now = new Date();
    items = items.filter(i => i.expiresAt && new Date(i.expiresAt) < now);
  }
  if (filters.dateFrom) items = items.filter(i =>
    i.publishedAt?.toDate?.() >= new Date(filters.dateFrom));
  if (filters.dateTo) items = items.filter(i =>
    i.publishedAt?.toDate?.() <= new Date(filters.dateTo + 'T23:59:59'));

  return items;
}

export async function saveNewsItem(id, data) {
  const ref = id ? doc(db, 'news_monitor', id) : doc(collection(db, 'news_monitor'));
  await setDoc(ref, {
    ...data,
    updatedAt:  serverTimestamp(),
    updatedBy:  uid(),
    ...(id ? {} : { createdAt: serverTimestamp(), createdBy: uid() }),
  }, { merge: true });
  await auditLog(id ? 'news.update' : 'news.create', 'news_monitor', ref.id, { title: data.title || '' });
  return ref.id;
}

export async function deleteNewsItem(id) {
  await deleteDoc(doc(db, 'news_monitor', id));
  await auditLog('news.delete', 'news_monitor', id, {});
}

/* ════════════════════════════════════════════════════════════
   Clipping — notícias sobre a empresa na mídia
   ════════════════════════════════════════════════════════════ */

export const CLIPPING_MEDIA_TYPES = ['Digital', 'Impresso', 'Televisivo'];

export const CLIPPING_CONTENT_TYPES = [
  'Negócios', 'Análises', 'Tendências', 'Novidades', 'Publieditorial',
];

export const CLIPPING_SENTIMENTS = [
  { key: 'positive',  label: 'Positivo',  color: '#22C55E', bg: '#22C55E18' },
  { key: 'neutral',   label: 'Imparcial', color: '#F59E0B', bg: '#F59E0B18' },
  { key: 'negative',  label: 'Negativo',  color: '#EF4444', bg: '#EF444418' },
];

export async function fetchClippings() {
  const q2 = query(collection(db, 'news_clipping'), orderBy('publishedAt', 'desc'));
  const snap = await getDocs(q2);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveClipping(id, data) {
  const ref = id ? doc(db, 'news_clipping', id) : doc(collection(db, 'news_clipping'));
  await setDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
    ...(id ? {} : { createdAt: serverTimestamp(), createdBy: uid() }),
  }, { merge: true });
  await auditLog(id ? 'clipping.update' : 'clipping.create', 'news_clipping', ref.id,
    { title: data.title || '' });
  return ref.id;
}

export async function deleteClipping(id) {
  await deleteDoc(doc(db, 'news_clipping', id));
  await auditLog('clipping.delete', 'news_clipping', id, {});
}

/**
 * Fetch Open Graph metadata from a URL via a lightweight proxy-free approach.
 * Uses a CORS proxy if direct fetch fails (common for news sites).
 */
export async function fetchUrlMetadata(url) {
  const result = { title: '', thumbnail: '', siteName: '' };
  if (!url) return result;

  // Try multiple approaches
  const proxyUrls = [
    url, // direct (works if CORS allows)
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ];

  for (const fetchUrl of proxyUrls) {
    try {
      const resp = await fetch(fetchUrl, {
        headers: { 'Accept': 'text/html' },
        signal: AbortSignal.timeout(6000),
      });
      if (!resp.ok) continue;
      const html = await resp.text();

      // Extract og:title or <title>
      const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1]
        || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
      if (ogTitle) result.title = ogTitle.trim();

      // Extract og:image
      const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
      if (ogImage) result.thumbnail = ogImage.trim();

      // Extract og:site_name
      const ogSite = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1]
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i)?.[1];
      if (ogSite) result.siteName = ogSite.trim();

      if (result.title) break; // Got what we need
    } catch { /* try next */ }
  }

  return result;
}
