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
