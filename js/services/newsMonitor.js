/**
 * PRIMETOUR — News Monitor Service
 */
import { db }   from '../firebase.js';
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
  return ref.id;
}

export async function deleteNewsItem(id) {
  await deleteDoc(doc(db, 'news_monitor', id));
}
