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
import { REQUESTING_AREAS as DEFAULT_SECTORS } from './tasks.js';

/* ─── Setores 4.23+ ──────────────────────────────────────────
 * Antes (≤4.22): SECTORS era um alias estático de REQUESTING_AREAS
 * (lista hardcoded em services/tasks.js). Não havia CRUD: a Sectors page
 * só permitia criar/editar/excluir NÚCLEOS; setores eram fixos.
 *
 * Agora: collection Firestore `sectors` com {name, color, order, active,
 * createdAt}. Se a collection estiver vazia (primeiro acesso), o sistema
 * cai pro DEFAULT_SECTORS (REQUESTING_AREAS) como seed/fallback.
 *
 * Consumers devem usar getActiveSectors() em vez de importar DEFAULT_SECTORS
 * diretamente — assim a fonte é dinâmica.
 *
 * Mantido o re-export `SECTORS` apontando pro default p/ back-compat com
 * imports antigos que ainda não migraram.
 */
export { DEFAULT_SECTORS as SECTORS };

/**
 * Retorna a lista ATIVA de setores (nomes string[]).
 * - Primeiro tenta store.get('sectors') (carregado no boot por loadSectors)
 * - Fallback: DEFAULT_SECTORS estático
 */
export function getActiveSectors() {
  const dyn = store.get('sectors');
  if (Array.isArray(dyn) && dyn.length) {
    return dyn.filter(s => s.active !== false).map(s => s.name);
  }
  return DEFAULT_SECTORS;
}

/* ─── Buscar todos os setores (raw) ──────────────────────── */
export async function fetchSectors() {
  const snap = await getDocs(query(collection(db, 'sectors'), orderBy('order', 'asc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ─── Criar setor ────────────────────────────────────────── */
export async function createSector({ name, color = '#6366F1', order = 999 }) {
  if (!store.can('system_manage_users') && !store.isMaster()) {
    throw new Error('Permissão negada.');
  }
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Nome do setor é obrigatório.');
  // Verifica duplicata (case-insensitive) entre os ATIVOS
  const existing = getActiveSectors();
  if (existing.some(s => s.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`Já existe um setor "${trimmed}".`);
  }
  const user = store.get('currentUser');
  const ref = await addDoc(collection(db, 'sectors'), {
    name:      trimmed,
    color,
    order,
    active:    true,
    createdAt: serverTimestamp(),
    createdBy: user?.uid || null,
  });
  return { id: ref.id, name: trimmed, color, order, active: true };
}

/* ─── Atualizar setor ────────────────────────────────────── */
export async function updateSector(sectorId, data) {
  if (!store.can('system_manage_users') && !store.isMaster()) {
    throw new Error('Permissão negada.');
  }
  await updateDoc(doc(db, 'sectors', sectorId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

/* ─── Excluir setor (soft delete via active=false) ───────── */
export async function deleteSector(sectorId, { hard = false } = {}) {
  if (!store.isMaster() && !store.can('system_manage_users')) {
    throw new Error('Permissão negada.');
  }
  if (hard) {
    await deleteDoc(doc(db, 'sectors', sectorId));
  } else {
    // Soft delete preserva histórico (tarefas/usuários ainda referenciam o nome)
    await updateDoc(doc(db, 'sectors', sectorId), {
      active: false, deletedAt: serverTimestamp(),
    });
  }
}

/* ─── Carregar setores no store ──────────────────────────── */
export async function loadSectors() {
  try {
    const list = await fetchSectors();
    // Seed inicial: se a collection está vazia, NÃO escreve nada (evita
    // gerar lixo se permissões mudarem). Apenas usa o default como fallback.
    if (!list.length) {
      store.set('sectors', null);
      return [];
    }
    store.set('sectors', list);
    return list;
  } catch (e) {
    console.warn('[sectors] load falhou:', e.message);
    store.set('sectors', null);
    return [];
  }
}

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

/* ─── Núcleos do usuário (multi) ──────────────────────────── */
/**
 * Retorna a lista de núcleos em que o usuário participa.
 *
 * Schema canônico: u.nucleos: string[]  (array de nomes)
 * Back-compat:     u.nucleo:  string    (campo legado, usado como fallback)
 *
 * Se só o legado existir, empacota em array. Se for string vazia em algum
 * item, remove. Dedup no final.
 */
export function userNucleos(u) {
  if (!u) return [];
  const arr = Array.isArray(u.nucleos) ? u.nucleos : [];
  const legacy = typeof u.nucleo === 'string' && u.nucleo.trim() ? [u.nucleo.trim()] : [];
  const set = new Set([...arr, ...legacy].map(s => String(s || '').trim()).filter(Boolean));
  return Array.from(set);
}

/**
 * Verifica se o usuário participa do núcleo `name`.
 */
export function userInNucleo(u, name) {
  if (!name) return false;
  return userNucleos(u).includes(name);
}
