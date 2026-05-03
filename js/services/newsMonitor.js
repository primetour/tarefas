/**
 * PRIMETOUR — News Monitor Service
 */
import { db }   from '../firebase.js';
import { auditLog } from '../auth/audit.js';
import { store } from '../store.js';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp, where, limit, arrayUnion, Timestamp,
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
  let q = query(collection(db, 'news_monitor'), orderBy('publishedAt', 'desc'), limit(500));
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

/**
 * Registra que uma notícia foi convertida em tarefa.
 * Mantém histórico (array) para permitir múltiplos usuários converterem a mesma notícia.
 * Idempotente: evita duplicar o mesmo taskId.
 */
export async function recordNewsConversion(newsId, { taskId, userId, userName }) {
  if (!newsId || !taskId) return;
  try {
    const ref = doc(db, 'news_monitor', newsId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const existing = Array.isArray(snap.data().conversions) ? snap.data().conversions : [];
    // Dedup por taskId — se já está registrado, não duplica
    if (existing.some(c => c.taskId === taskId)) return;
    const entry = {
      taskId,
      userId:   userId || uid() || null,
      userName: userName || '',
      at:       Timestamp.now(),
    };
    await updateDoc(ref, { conversions: arrayUnion(entry) });
  } catch (e) {
    console.warn('[News] recordNewsConversion falhou:', e.message);
  }
}

/**
 * Remove uma conversão do histórico quando a tarefa gerada é excluída.
 * Protege os KPIs contra inflação artificial (erro ou burla).
 * Idempotente e tolerante a falhas — não bloqueia o delete da task.
 */
export async function removeNewsConversion(newsId, taskId) {
  if (!newsId || !taskId) return;
  try {
    const ref = doc(db, 'news_monitor', newsId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const existing = Array.isArray(snap.data().conversions) ? snap.data().conversions : [];
    const filtered = existing.filter(c => c.taskId !== taskId);
    if (filtered.length === existing.length) return; // nada a remover
    await updateDoc(ref, { conversions: filtered });
  } catch (e) {
    console.warn('[News] removeNewsConversion falhou:', e.message);
  }
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
  const q2 = query(collection(db, 'news_clipping'), orderBy('publishedAt', 'desc'), limit(200));
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
  if (!str) return '';
  const doc = new DOMParser().parseFromString(str, 'text/html');
  return doc.documentElement.textContent || '';
}

/* ════════════════════════════════════════════════════════════
   Share of Voice (SoV)
   ──────────────────────────────────────────────────────────
   Mede % de presença na midia da nossa marca vs concorrentes.

   Fórmulas:
   1) SoV simples = mencoes(marca) / total_mencoes × 100
   2) SoV ponderado = (mencoes × peso_sentimento × peso_alcance) / total × 100

   Pesos:
   - Sentimento: positivo=1.5, neutro=1.0, negativo=0.3
   - Alcance (tier do veiculo): A=1.0 (massiva), B=0.7 (segmentada), C=0.4 (nicho)
   ════════════════════════════════════════════════════════════ */

export const BRAND_TIERS = [
  { tier: 'A', label: 'Tier A — mídia massiva (>1M leitores/mês)',  weight: 1.0 },
  { tier: 'B', label: 'Tier B — mídia segmentada (100k–1M)',        weight: 0.7 },
  { tier: 'C', label: 'Tier C — nicho/blog (<100k)',                weight: 0.4 },
];

export const SENTIMENT_WEIGHT = {
  positive: 1.5,
  neutral:  1.0,
  negative: 0.3,
};

const DEFAULT_BRANDS = [
  { name: 'PRIMETOUR',     isOwn: true,  color: '#D4A843' },
  { name: 'Teresa Perez',  isOwn: false, color: '#A78BFA' },
  { name: 'Latitudes',     isOwn: false, color: '#38BDF8' },
  { name: 'Matueté',       isOwn: false, color: '#F97316' },
  { name: 'TTW Group',     isOwn: false, color: '#22C55E' },
  { name: 'Ten Group',     isOwn: false, color: '#EC4899' },
];

/** Lista as marcas trackadas. Auto-seed na primeira chamada. */
export async function fetchTrackedBrands() {
  const ref = collection(db, 'tracked_brands');
  let snap = await getDocs(query(ref, orderBy('name')));
  if (snap.empty) {
    // Seed inicial
    for (const b of DEFAULT_BRANDS) {
      const id = b.name.toLowerCase().replace(/\s+/g, '_');
      await setDoc(doc(ref, id), { ...b, active: true, createdAt: serverTimestamp() });
    }
    snap = await getDocs(query(ref, orderBy('name')));
  }
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveTrackedBrand(id, data) {
  const ref = id
    ? doc(db, 'tracked_brands', id)
    : doc(db, 'tracked_brands', (data.name || '').toLowerCase().replace(/\s+/g, '_'));
  await setDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
    ...(id ? {} : { createdAt: serverTimestamp() }),
  }, { merge: true });
  await auditLog(id ? 'brand.update' : 'brand.create', 'tracked_brands', ref.id, { name: data.name });
  return ref.id;
}

export async function deleteTrackedBrand(id) {
  await deleteDoc(doc(db, 'tracked_brands', id));
  await auditLog('brand.delete', 'tracked_brands', id, {});
}

/**
 * Calcula SoV (Share of Voice) a partir de clippings + brands.
 * @param {Array} clippings - lista de clippings com `brandsMentioned[]` + `sentiment` + `veiculoTier`
 * @param {Array} brands - marcas trackadas
 * @param {Object} options - { from?: Date, to?: Date }
 * @returns {Array} marcas com .mentions, .sov%, .sovWeighted%, .sentiments{positive,neutral,negative}
 */
export function calculateSoV(clippings, brands, options = {}) {
  const { from, to } = options;
  // Filtro por periodo
  let items = clippings.filter(c => Array.isArray(c.brandsMentioned) && c.brandsMentioned.length > 0);
  if (from) items = items.filter(c => {
    const d = c.publishedAt?.toDate ? c.publishedAt.toDate() : new Date(c.publishedAt);
    return d >= from;
  });
  if (to) items = items.filter(c => {
    const d = c.publishedAt?.toDate ? c.publishedAt.toDate() : new Date(c.publishedAt);
    return d <= to;
  });

  // Inicializa contadores
  const counts = {};
  brands.forEach(b => {
    counts[b.name] = {
      name: b.name, color: b.color || '#94A3B8', isOwn: !!b.isOwn,
      mentions: 0, weighted: 0,
      sentiments: { positive: 0, neutral: 0, negative: 0 },
      mediaTypes: { Digital: 0, Impresso: 0, Televisivo: 0 },
    };
  });

  // Conta menções
  items.forEach(c => {
    const sent = c.sentiment || 'neutral';
    const tier = c.veiculoTier || 'B';                 // default Tier B
    const sentW = SENTIMENT_WEIGHT[sent] || 1;
    const tierW = BRAND_TIERS.find(t => t.tier === tier)?.weight || 0.7;
    const w = sentW * tierW;

    (c.brandsMentioned || []).forEach(brandName => {
      const b = counts[brandName];
      if (!b) return;  // marca não trackada
      b.mentions++;
      b.weighted += w;
      if (b.sentiments[sent] !== undefined) b.sentiments[sent]++;
      if (b.mediaTypes[c.mediaType] !== undefined) b.mediaTypes[c.mediaType]++;
    });
  });

  const list = Object.values(counts);
  const totalMentions = list.reduce((s, b) => s + b.mentions, 0);
  const totalWeighted = list.reduce((s, b) => s + b.weighted, 0);

  list.forEach(b => {
    b.sov         = totalMentions > 0 ? (b.mentions / totalMentions) * 100 : 0;
    b.sovWeighted = totalWeighted > 0 ? (b.weighted / totalWeighted) * 100 : 0;
    // Net Sentiment Score: -100 (todo negativo) a +100 (todo positivo)
    const ts = b.sentiments;
    const tot = ts.positive + ts.neutral + ts.negative;
    b.nss = tot > 0 ? ((ts.positive - ts.negative) / tot) * 100 : 0;
  });

  return list.sort((a, b) => b.weighted - a.weighted);
}

/**
 * Agrupa SoV por mês pra gráfico de evolução.
 * @returns Array de { month: 'YYYY-MM', brands: { brandName: sovWeighted% } }
 */
export function calculateSoVByMonth(clippings, brands, options = {}) {
  const { months = 6 } = options;
  const now = new Date();
  const buckets = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    buckets.push({ key, label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }), from: d, to: new Date(d.getFullYear(), d.getMonth()+1, 0, 23, 59, 59) });
  }
  return buckets.map(b => {
    const sov = calculateSoV(clippings, brands, { from: b.from, to: b.to });
    return { month: b.label, sov };
  });
}
