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
  'Negócios', 'Análises', 'Tendências', 'Novidades', 'Publieditorial', 'Eventos',
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
 * Fetch Open Graph metadata from a URL.
 * Sites block direct browser requests (CORS), so we use public CORS proxies.
 * Tries multiple proxies in sequence until one works.
 */
export async function fetchUrlMetadata(url) {
  const result = { title: '', thumbnail: '', siteName: '' };
  if (!url) return result;

  const encoded = encodeURIComponent(url);

  // Strategy 1: Try JSON-based OG extraction APIs (no HTML parsing needed)
  const jsonApis = [
    `https://api.microlink.io/?url=${encoded}`,
    `https://opengraph.io/api/1.1/site/${encoded}?app_id=default`,
  ];

  for (const apiUrl of jsonApis) {
    try {
      const resp = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) continue;
      const json = await resp.json();

      // Microlink format
      if (json.data) {
        result.title     = json.data.title || '';
        result.thumbnail = json.data.image?.url || json.data.logo?.url || '';
        result.siteName  = json.data.publisher || '';
        if (result.title) return result;
      }

      // OpenGraph.io format
      if (json.hybridGraph) {
        result.title     = json.hybridGraph.title || '';
        result.thumbnail = json.hybridGraph.image || '';
        result.siteName  = json.hybridGraph.site_name || '';
        if (result.title) return result;
      }
    } catch { /* try next */ }
  }

  // Strategy 2: CORS proxy + HTML parsing as fallback
  const proxyUrls = [
    `https://api.allorigins.win/raw?url=${encoded}`,
    `https://corsproxy.io/?${encoded}`,
  ];

  for (const fetchUrl of proxyUrls) {
    try {
      const resp = await fetch(fetchUrl, {
        headers: { 'Accept': 'text/html' },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) continue;
      // Read only the first 50KB to avoid large payloads
      const reader = resp.body?.getReader();
      let html = '';
      if (reader) {
        const decoder = new TextDecoder();
        let bytesRead = 0;
        while (bytesRead < 50000) {
          const { done, value } = await reader.read();
          if (done) break;
          html += decoder.decode(value, { stream: true });
          bytesRead += value.length;
        }
        reader.cancel().catch(() => {});
      } else {
        html = await resp.text();
      }

      // Extract og:title or <title>
      const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1]
        || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
      if (ogTitle) result.title = decodeHTMLEntities(ogTitle.trim());

      // Extract og:image
      const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
      if (ogImage) result.thumbnail = ogImage.trim();

      // Extract og:site_name
      const ogSite = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1]
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i)?.[1];
      if (ogSite) result.siteName = decodeHTMLEntities(ogSite.trim());

      if (result.title) break;
    } catch { /* try next */ }
  }

  // Strategy 3: Extract info from the URL itself as last resort
  if (!result.title) {
    try {
      const u = new URL(url);
      // Try to build a readable title from the URL path
      const pathParts = u.pathname.split('/').filter(Boolean);
      const lastPart = pathParts[pathParts.length - 1] || '';
      // Remove file extensions and common separators
      const cleaned = lastPart
        .replace(/\.\w+$/, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
      if (cleaned.length > 5) result.title = cleaned;
      if (!result.siteName) result.siteName = u.hostname.replace(/^www\./, '');
    } catch { /* ignore */ }
  }

  return result;
}

function decodeHTMLEntities(str) {
  const el = document.createElement('textarea');
  el.innerHTML = str;
  return el.value;
}
