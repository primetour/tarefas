/**
 * PRIMETOUR — Content Meta Service
 *
 * CRUD pras coleções dinâmicas que substituem os hardcoded
 * PLATFORM_OPTIONS e CONTENT_TYPE_OPTIONS:
 *   - content_platforms  (Instagram, Facebook, Newsletter, ...)
 *   - content_contents   (Post, Reel, Carrossel, ...)
 *
 * Padrão de permissão (v4.49.59+):
 *   - read: qualquer auth (dropdowns precisam carregar)
 *   - create/update: admin/master OU content_calendar_meta_manage
 *     (perm granular liberável pra coord/analista — pareia com
 *      Firestore rules em firestore.rules:233-249)
 *   - delete: apenas master (mais restritivo, consistente com rules)
 *
 * Cache local 5min via store. Live invalidate ao criar/editar/excluir.
 *
 * Cada doc tem shape:
 *   { id, label, icon, color, order, active, createdAt, updatedAt }
 */

import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs,
  query, orderBy, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }       from '../firebase.js';
import { store }    from '../store.js';
import { auditLog } from '../auth/audit.js';

const COLS = {
  platforms:  'content_platforms',
  contents:   'content_contents',
  categories: 'content_categories', // 4.35.16+
};

const CACHE_KEYS = {
  platforms:  'content_platforms',
  contents:   'content_contents',
  categories: 'content_categories',
};

/* ─── Sanitizer (server e client) ─────────────────────────── */
function sanitize(data) {
  return {
    label: typeof data.label === 'string' ? data.label.trim().slice(0, 60) : '',
    icon:  typeof data.icon === 'string' ? data.icon.slice(0, 8) : '📋',
    color: /^#[0-9A-Fa-f]{6}$/.test(data.color || '') ? data.color : '#94A3B8',
    order: Number.isFinite(+data.order) ? +data.order : 99,
    active: data.active !== false,
  };
}

/* ─── Listar (com cache) ──────────────────────────────────── */
async function _list(kind) {
  const cached = store.getCached(CACHE_KEYS[kind]);
  if (cached) return cached;
  const q    = query(collection(db, COLS[kind]), orderBy('order', 'asc'));
  const snap = await getDocs(q);
  const arr  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  store.setCache(CACHE_KEYS[kind], arr);
  return arr;
}

export async function fetchPlatforms()  { return _list('platforms'); }
export async function fetchContents()   { return _list('contents');  }
export async function fetchCategories() { return _list('categories'); }

/* ─── Permission check compartilhado pra create/update ───────
 * v4.49.59+ Aceita content_calendar_meta_manage (perm granular)
 * além de system_manage_settings + master. Single source of truth
 * pra não dispersar checks. Bug histórico (v4.49.50→58): essa
 * função era inline com `system_manage_settings` only — derrubava
 * analista mesmo com a perm granular ligada no role.
 */
function _canWriteMeta() {
  return store.isMaster()
      || store.can('content_calendar_meta_manage')
      || store.can('system_manage_settings');
}

/* ─── Criar ───────────────────────────────────────────────── */
async function _create(kind, data) {
  if (!_canWriteMeta()) {
    throw new Error('Sem permissão pra criar item do calendário de conteúdo. ' +
      'Peça ao admin pra habilitar "Criar plataformas, tipos e categorias" no seu role.');
  }
  const clean = sanitize(data);
  if (!clean.label) throw new Error('Nome é obrigatório.');
  const docData = {
    ...clean,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, COLS[kind]), docData);
  await auditLog(`content_${kind}.create`, kind, ref.id, { label: clean.label });
  store.invalidateCache(CACHE_KEYS[kind]);
  return { id: ref.id, ...docData };
}

export const createPlatform  = (d) => _create('platforms', d);
export const createContent   = (d) => _create('contents',  d);
export const createCategory  = (d) => _create('categories', d);

/* ─── Atualizar ───────────────────────────────────────────── */
async function _update(kind, id, data) {
  if (!_canWriteMeta()) {
    throw new Error('Sem permissão pra editar item do calendário de conteúdo.');
  }
  const clean = sanitize(data);
  await updateDoc(doc(db, COLS[kind], id), { ...clean, updatedAt: serverTimestamp() });
  await auditLog(`content_${kind}.update`, kind, id, {});
  store.invalidateCache(CACHE_KEYS[kind]);
}

export const updatePlatform  = (id, d) => _update('platforms', id, d);
export const updateContent   = (id, d) => _update('contents',  id, d);
export const updateCategory  = (id, d) => _update('categories', id, d);

/* ─── Excluir ─────────────────────────────────────────────── */
async function _delete(kind, id) {
  if (!store.isMaster()) throw new Error('Apenas Diretoria pode excluir.');
  await deleteDoc(doc(db, COLS[kind], id));
  await auditLog(`content_${kind}.delete`, kind, id, {});
  store.invalidateCache(CACHE_KEYS[kind]);
}

export const deletePlatform  = (id) => _delete('platforms', id);
export const deleteContent   = (id) => _delete('contents',  id);
export const deleteCategory  = (id) => _delete('categories', id);

/* ─── Helpers pro modal de slot: lista com fallback estático ─
 * Enquanto Firestore não tiver dados, retorna defaults.
 * Após primeiro create, fica vivo no Firestore.
 */
export const FALLBACK_PLATFORMS = [
  { id: 'instagram',  label: 'Instagram',  icon: '📷', color: '#E1306C', order: 1 },
  { id: 'facebook',   label: 'Facebook',   icon: '◈',  color: '#1877F2', order: 2 },
  { id: 'linkedin',   label: 'LinkedIn',   icon: '▤',  color: '#0A66C2', order: 3 },
  { id: 'newsletter', label: 'Newsletter', icon: '✉',  color: '#D4A843', order: 4 },
  { id: 'blog',       label: 'Blog',       icon: '✎',  color: '#64748B', order: 5 },
  { id: 'tiktok',     label: 'TikTok',     icon: '▣',  color: '#94A3B8', order: 6 },
];

export const FALLBACK_CONTENTS = [
  { id: 'post',       label: 'Post',       icon: '📸', color: '#6366F1', order: 1 },
  { id: 'reel',       label: 'Reel',       icon: '🎬', color: '#EC4899', order: 2 },
  { id: 'carrossel',  label: 'Carrossel',  icon: '📑', color: '#8B5CF6', order: 3 },
  { id: 'story',      label: 'Story',      icon: '📱', color: '#F59E0B', order: 4 },
  { id: 'artigo',     label: 'Artigo',     icon: '📰', color: '#0EA5E9', order: 5 },
  { id: 'newsletter', label: 'Newsletter', icon: '✉',  color: '#D4A843', order: 6 },
];

// 4.35.16+ Categorias de slot (Destinos, Dicas, Institucional, etc).
export const FALLBACK_CATEGORIES = [
  { id: 'destinos',      label: 'Destinos',      icon: '🌍', color: '#0EA5E9', order: 1 },
  { id: 'dicas',         label: 'Dicas',         icon: '💡', color: '#F59E0B', order: 2 },
  { id: 'institucional', label: 'Institucional', icon: '🏛', color: '#6B7280', order: 3 },
  { id: 'lancamento',    label: 'Lançamento',    icon: '🚀', color: '#EC4899', order: 4 },
  { id: 'engajamento',   label: 'Engajamento',   icon: '❤',  color: '#EF4444', order: 5 },
  { id: 'educativo',     label: 'Educativo',     icon: '📚', color: '#8B5CF6', order: 6 },
];

/**
 * Resolve lista live + fallback. Filtra inativos.
 * Usado nos dropdowns do modal de slot.
 */
export async function getActivePlatforms() {
  let list = await fetchPlatforms().catch(() => []);
  if (!list.length) list = FALLBACK_PLATFORMS;
  return list.filter(x => x.active !== false);
}

export async function getActiveContents() {
  let list = await fetchContents().catch(() => []);
  if (!list.length) list = FALLBACK_CONTENTS;
  return list.filter(x => x.active !== false);
}

export async function getActiveCategories() {
  let list = await fetchCategories().catch(() => []);
  if (!list.length) list = FALLBACK_CATEGORIES;
  return list.filter(x => x.active !== false);
}
