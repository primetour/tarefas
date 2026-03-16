/**
 * PRIMETOUR — Sectors & Nucleos Service
 * Gestão dinâmica de setores e núcleos
 *
 * Hierarquia: Setor → Núcleo → Usuário
 * - Setor: grupo organizacional amplo (ex: Marketing e Comunicação, C&P, TI)
 * - Núcleo: subgrupo do setor (ex: Design, Jornalismo, Redes Sociais)
 * - REQUESTING_AREAS de tasks.js são os setores disponíveis
 */

import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  getDocs, query, where, orderBy, serverTimestamp, setDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';
import { REQUESTING_AREAS } from './tasks.js';

/* ─── Setores disponíveis (espelha REQUESTING_AREAS) ─────── */
export { REQUESTING_AREAS as SECTORS };

/* ─── Buscar todos os núcleos ────────────────────────────── */
export async function fetchNucleos({ sector = null } = {}) {
  let q = query(collection(db, 'nucleos'), orderBy('sector', 'asc'), orderBy('name', 'asc'));
  if (sector) {
    q = query(collection(db, 'nucleos'), where('sector', '==', sector), orderBy('name', 'asc'));
  }
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ─── Buscar núcleos do setor do usuário logado ──────────── */
export async function fetchUserNucleos() {
  const sector = store.get('userSector');
  if (!sector && !store.isMaster()) return [];
  return fetchNucleos(store.isMaster() ? {} : { sector });
}

/* ─── Criar núcleo ───────────────────────────────────────── */
export async function createNucleo({ name, sector, description = '', color = '#6B7280' }) {
  if (!store.can('system_manage_users') && !store.isMaster()) {
    throw new Error('Permissão negada.');
  }
  const user = store.get('currentUser');

  // Verificar duplicata
  const existing = await fetchNucleos({ sector });
  if (existing.some(n => n.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Já existe um núcleo "${name}" neste setor.`);
  }

  const ref = await addDoc(collection(db, 'nucleos'), {
    name:        name.trim(),
    sector,
    description: description.trim(),
    color,
    active:      true,
    createdAt:   serverTimestamp(),
    createdBy:   user.uid,
    updatedAt:   serverTimestamp(),
  });
  return { id: ref.id, name, sector, description, color, active: true };
}

/* ─── Atualizar núcleo ───────────────────────────────────── */
export async function updateNucleo(nucleoId, data) {
  if (!store.can('system_manage_users') && !store.isMaster()) {
    throw new Error('Permissão negada.');
  }
  await updateDoc(doc(db, 'nucleos', nucleoId), {
    ...data, updatedAt: serverTimestamp(),
  });
}

/* ─── Excluir núcleo ─────────────────────────────────────── */
export async function deleteNucleo(nucleoId) {
  if (!store.isMaster() && !store.can('system_manage_users')) {
    throw new Error('Permissão negada.');
  }
  await deleteDoc(doc(db, 'nucleos', nucleoId));
}

/* ─── Carregar núcleos no store ──────────────────────────── */
export async function loadNucleos() {
  try {
    const sector  = store.get('userSector');
    const nucleos = store.isMaster()
      ? await fetchNucleos()
      : sector ? await fetchNucleos({ sector }) : [];
    store.set('nucleos', nucleos);
    return nucleos;
  } catch(e) {
    console.warn('Could not load nucleos:', e.message);
    return [];
  }
}

/* ─── Filtro de visibilidade por setor ───────────────────── */
export function getVisibleSectors() {
  // Diretoria vê tudo
  if (store.isMaster()) return null; // null = sem filtro

  const profile        = store.get('userProfile');
  const visibleSectors = store.get('visibleSectors') || [];

  // Head pode ter múltiplos setores definidos pela Diretoria
  if (visibleSectors.length > 0) return visibleSectors;

  // Demais: apenas seu próprio setor
  const sector = profile?.sector || profile?.department || null;
  return sector ? [sector] : [];
}

/* ─── Verificar se usuário pode ver determinado setor ────── */
export function canSeeSector(sector) {
  if (store.isMaster()) return true;
  const visible = getVisibleSectors();
  if (!visible) return true;
  if (!visible.length) return false;
  return visible.includes(sector);
}

/* ─── Filtrar usuários pelo setor visível ────────────────── */
export function filterUsersBySector(users) {
  if (store.isMaster()) return users;
  const visible = getVisibleSectors();
  if (!visible) return users;
  if (!visible.length) return [];
  return users.filter(u => {
    const userSector = u.sector || u.department;
    return !userSector || visible.includes(userSector);
  });
}
