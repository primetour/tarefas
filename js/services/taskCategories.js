/**
 * PRIMETOUR — Task Categories Service
 * Categorias de tipos de tarefa (ex: Design, Comunicação, Dados)
 */

import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  getDocs, orderBy, query, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';

export const CATEGORY_COLORS = [
  '#D4A843','#38BDF8','#22C55E','#A78BFA',
  '#F97316','#EC4899','#EF4444','#14B8A6',
  '#6366F1','#84CC16','#06B6D4','#6B7280',
];

export const CATEGORY_ICONS = ['📋','🎨','📣','📊','🌐','⚙','🤖','📧','📸','🎬','📝','🔗'];

/* ─── Fetch ───────────────────────────────────────────────── */
export async function fetchCategories() {
  const snap = await getDocs(query(
    collection(db, 'task_categories'),
    orderBy('name', 'asc'),
  )).catch(() => ({ docs: [] }));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ─── Create ──────────────────────────────────────────────── */
export async function createCategory({ name, color, icon }) {
  const user = store.get('currentUser');
  const ref  = await addDoc(collection(db, 'task_categories'), {
    name:      name.trim(),
    color:     color || CATEGORY_COLORS[0],
    icon:      icon  || CATEGORY_ICONS[0],
    createdAt: serverTimestamp(),
    createdBy: user.uid,
    updatedAt: serverTimestamp(),
  });
  return { id: ref.id, name, color, icon };
}

/* ─── Update ──────────────────────────────────────────────── */
export async function updateCategory(id, data) {
  await updateDoc(doc(db, 'task_categories', id), {
    ...data, updatedAt: serverTimestamp(),
  });
}

/* ─── Delete ──────────────────────────────────────────────── */
export async function deleteCategory(id) {
  await deleteDoc(doc(db, 'task_categories', id));
}

/* ─── Load into store ─────────────────────────────────────── */
export async function loadCategories() {
  try {
    const cats = await fetchCategories();
    store.set('taskCategories', cats);
    return cats;
  } catch(e) {
    return [];
  }
}
