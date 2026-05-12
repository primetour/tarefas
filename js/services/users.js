/**
 * PRIMETOUR — Users Service (cache centralizado)
 *
 * Antes deste módulo: cada página (tasks, kanban, projects, team, goals,
 * sectors, dashboards, etc.) fazia o seu próprio
 *   getDocs(query(collection(db, 'users'), orderBy('name', 'asc')))
 * e chamava store.set('users', ...). Resultado: ~16 lugares lendo a
 * coleção inteira a cada navegação — milhares de reads/dia para 18 users.
 *
 * Agora: uma única função `fetchUsers()` com cache TTL de 5 min via
 * `store.getCached/setCache`. Subsequentes chamadas dentro da janela
 * servem do cache local (0 reads adicionais). O Firestore com persistência
 * IndexedDB ainda dá fallback de cache local quando o TTL expira.
 *
 * Como usar:
 *   const users = await fetchUsers();           // todos
 *   const active = await fetchUsers({ active: true });
 *   invalidateUsersCache();                     // após criar/editar usuário
 */

import { db }    from '../firebase.js';
import { store } from '../store.js';
import {
  collection, getDocs, query, orderBy,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const CACHE_KEY = 'usersAll';
// 5 min: voltou ao TTL original. Antes baixei pra 60s pra propagar
// mudanças rápido, mas agora há um snapshot global em initAuthObserver
// (onSnapshot na coleção users) que mantém store.users SEMPRE fresh em
// tempo real. fetchUsers vira fallback redundante — cache longo é OK.
// Reduz reads em ~5x (de 1500/user/dia pra 300/user/dia).
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Busca usuários (com cache). Retorna array já ordenado por nome.
 * @param {object} [opts]
 * @param {boolean} [opts.active] - se true, retorna só u.active !== false
 * @param {boolean} [opts.force]  - ignora o cache e força re-fetch
 */
export async function fetchUsers({ active = false, force = false } = {}) {
  if (!force) {
    const cached = store.getCached(CACHE_KEY, CACHE_TTL);
    if (cached) {
      // Mantém store.users em sincronia mesmo em hits de cache
      if (store.get('users') !== cached) store.set('users', cached);
      return active ? cached.filter(u => u.active !== false) : cached;
    }
  }

  const snap = await getDocs(query(collection(db, 'users'), orderBy('name', 'asc')));
  const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  store.setCache(CACHE_KEY, users);
  store.set('users', users);
  return active ? users.filter(u => u.active !== false) : users;
}

/** Invalida o cache (chamar após criar/editar/desativar usuário). */
export function invalidateUsersCache() {
  store.invalidateCache(CACHE_KEY);
}

/* ─── 4.35.21+ Hierarquia (managerId) ────────────────────── *
 * Cada user.managerId aponta pro gestor direto. Subordinados:
 * filtram users.managerId === uid (diretos), recurse pra obter
 * toda a árvore abaixo.
 *
 * Usado por feedbacks (visibilidade restrita pro gestor de área)
 * e potencialmente CSAT, dashboards, capacity (vide auditoria).
 */

/** Subordinados diretos de um uid. */
export function getDirectReports(uid, users) {
  if (!uid || !Array.isArray(users)) return [];
  return users.filter(u => u.managerId === uid);
}

/**
 * Árvore inteira abaixo de um uid (recursivo + iterativo seguro).
 * Detecta loops e ignora (idempotente).
 * @returns {Array} usuários subordinados (excluindo o próprio uid)
 */
export function getSubordinatesTree(uid, users) {
  if (!uid || !Array.isArray(users)) return [];
  const visited = new Set([uid]); // evita loop
  const result = [];
  const queue = [uid];
  while (queue.length) {
    const current = queue.shift();
    const directs = users.filter(u => u.managerId === current);
    for (const d of directs) {
      if (visited.has(d.id)) continue; // loop detectado
      visited.add(d.id);
      result.push(d);
      queue.push(d.id);
    }
  }
  return result;
}

/**
 * Conjunto de UIDs visíveis hierarquicamente pra um viewer.
 * - master/admin (com system_view_all): null = "todos visíveis"
 * - gestor: { meUid + subordinados (transitivos) }
 * - membro: { meUid } só
 *
 * Helper centralizado pra usar em feedbacks, csat e outros módulos
 * que precisam aplicar visibilidade por hierarquia.
 *
 * @returns {Set<string>|null} null = ver todos; Set = só esses uids
 */
export function getVisibleUserIds(viewer, allUsers, roleCan) {
  if (!viewer) return new Set();
  // Master ou system_view_all: vê tudo
  if (roleCan?.('system_view_all') || viewer.role === 'master') return null;
  // Construir Set transitivo
  const set = new Set([viewer.uid || viewer.id]);
  const subtree = getSubordinatesTree(viewer.uid || viewer.id, allUsers);
  subtree.forEach(u => set.add(u.id));
  return set;
}

/**
 * Validação de loop ao salvar managerId.
 * @returns {boolean} true se NÃO há ciclo (ok pra salvar)
 */
export function isValidManagerAssignment(targetUid, newManagerId, allUsers) {
  if (!newManagerId) return true; // remover gestor sempre ok
  if (newManagerId === targetUid) return false; // não pode ser gestor de si
  // Verifica se newManagerId está na subtree de targetUid (loop)
  const subtree = getSubordinatesTree(targetUid, allUsers);
  return !subtree.some(u => u.id === newManagerId);
}
