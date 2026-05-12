/**
 * PRIMETOUR — User Resolver
 *
 * Resolução robusta de "id de user" para dados exibíveis (nome, email,
 * avatar). Nunca retorna ID cru ou "(usuário)".
 *
 * MOTIVAÇÃO: o sistema teve várias migrações de UID (Auth password →
 * SSO Microsoft) que deixaram referências a UIDs antigos espalhadas
 * por workspace.members[], task.assignees[], goal.metaLinks[],
 * notification.recipientId, etc. Quando UI tenta `users.find(u => u.id
 * === mid)` e o mid é um UID legado, retorna undefined → exibe o ID
 * cru ou "(usuário)".
 *
 * USO:
 *   import { resolveUser, resolveUserName } from './services/userResolver.js';
 *   const u = await resolveUser('Wsa3xz...');  // { id, name, email, avatar, initials }
 *   const name = resolveUserNameSync(uid);     // sync, usa cache
 *
 * ESTRATÉGIA DE LOOKUP (em ordem):
 *   1. Match exato por id no store.users (cache local 60s)
 *   2. Match por id em pendingSso docs (se id começa com 'pending_')
 *   3. Lookup remoto: query Firestore by id ou email
 *   4. Fallback: parsear nome do pending_id ou retornar "Usuário desconhecido"
 *
 * PERFORMANCE: o cache do userService já tem TTL 60s. Esta camada não
 * adiciona overhead pra hits no cache. Misses fazem getDoc único, sem
 * retry hammers.
 */

import { store } from '../store.js';
import { db } from '../firebase.js';
import {
  collection, doc, getDoc, getDocs, query, where, limit,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// Cache local de "users que NÃO estão no store mas resolvi via Firestore"
// (ex: users excluídos cuja referência ainda existe em alguma collection).
// Vive na memória da aba; é limpo no reload.
const _resolutionCache = new Map();
// Track misses pra não bater no Firestore repetidamente pro mesmo id inválido
const _missSet = new Set();

const SSO_DOMAINS = ['primetour.com.br', 'primetravel.tur.br', 'primetouroperator.com.br'];

/**
 * Tenta extrair email de um pending_* slug.
 * pending_adriana_campos_primetour_com_br → adriana.campos@primetour.com.br
 * Heurística: separa em domain (últimos 3 segmentos: primetour_com_br) + local.
 */
function emailFromPendingSlug(slug) {
  if (!slug || !slug.startsWith('pending_')) return null;
  const parts = slug.replace(/^pending_/, '').split('_');
  // Tenta cada domínio SSO e vê qual sufixo bate
  for (const dom of SSO_DOMAINS) {
    const domSegs = dom.split('.');
    if (parts.length <= domSegs.length) continue;
    const tail = parts.slice(-domSegs.length).join('.');
    if (tail === dom) {
      const local = parts.slice(0, -domSegs.length).join('.');
      return `${local}@${dom}`;
    }
  }
  return null;
}

/**
 * Gera dados visuais "fallback" a partir de um email/nome.
 */
function fallbackProfile(id, email, name) {
  const safeName = name || (email ? email.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Usuário desconhecido');
  return {
    id,
    name:    safeName,
    email:   email || '',
    avatarColor: '#6B7280',
    initials: safeName.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?',
    _resolved: false, // sinaliza que é fallback
  };
}

/**
 * Lookup rápido por id no cache do store (síncrono).
 * Retorna null se não acha.
 */
function lookupInStore(id) {
  if (!id) return null;
  const all = store.get('users') || [];
  return all.find(u => u.id === id) || null;
}

/**
 * Lookup remoto direto no Firestore por id (1 read).
 */
async function lookupRemoteById(id) {
  try {
    const snap = await getDoc(doc(db, 'users', id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (e) {
    console.warn('[userResolver] getDoc by id failed:', e?.message);
    return null;
  }
}

/**
 * Lookup remoto por email (1 query, limit 1).
 */
async function lookupRemoteByEmail(email) {
  try {
    const snap = await getDocs(query(
      collection(db, 'users'),
      where('email', '==', email.toLowerCase().trim()),
      limit(1),
    ));
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
  } catch (e) {
    console.warn('[userResolver] getDocs by email failed:', e?.message);
    return null;
  }
}

/**
 * Resolução SÍNCRONA usando apenas cache local (store + _resolutionCache).
 * Retorna null se não acha. Para casos de UI que não pode ser async.
 */
export function resolveUserSync(idOrEmail) {
  if (!idOrEmail) return null;

  // 1. store cache
  const fromStore = lookupInStore(idOrEmail);
  if (fromStore) return _normalize(fromStore);

  // 2. resolution cache (de lookups async anteriores)
  if (_resolutionCache.has(idOrEmail)) {
    return _resolutionCache.get(idOrEmail);
  }

  // 3. Se é pending_* slug, tenta resolver pelo email derivado
  if (idOrEmail.startsWith?.('pending_')) {
    const email = emailFromPendingSlug(idOrEmail);
    if (email) {
      const all = store.get('users') || [];
      const u = all.find(u => (u.email || '').toLowerCase() === email);
      if (u) return _normalize(u);
      return _normalize(fallbackProfile(idOrEmail, email, null));
    }
  }

  // 4. Se parece email, tenta no store
  if (idOrEmail.includes?.('@')) {
    const all = store.get('users') || [];
    const u = all.find(u => (u.email || '').toLowerCase() === idOrEmail.toLowerCase());
    if (u) return _normalize(u);
  }

  return null;
}

/**
 * Helper sync que retorna SEMPRE algo (nunca null) — pra UI.
 * Se não tem cache, retorna fallback "Usuário (id curto)".
 */
export function resolveUserName(idOrEmail) {
  if (!idOrEmail) return '—';
  const resolved = resolveUserSync(idOrEmail);
  if (resolved) return resolved.name;
  // Fallback amigável
  if (idOrEmail.startsWith?.('pending_')) {
    const email = emailFromPendingSlug(idOrEmail);
    return email ? email.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Usuário (pending)';
  }
  if (idOrEmail.includes?.('@')) return idOrEmail.split('@')[0];
  // Último recurso: ID truncado mas com prefixo claro
  return `Usuário (${String(idOrEmail).slice(0, 6)}…)`;
}

/**
 * Resolução completa (assíncrona). Usa todos os caminhos de lookup.
 * Cacheia o resultado em memória pra evitar reads repetidos.
 *
 * SEMPRE retorna um objeto com {id, name, email, avatarColor, initials}.
 */
export async function resolveUser(idOrEmail) {
  if (!idOrEmail) return _normalize(fallbackProfile('', '', null));

  // 1. Cache instantâneo
  const sync = resolveUserSync(idOrEmail);
  if (sync) return sync;

  // 2. Marcado como miss anteriormente? Não tenta de novo.
  if (_missSet.has(idOrEmail)) {
    return _normalize(fallbackProfile(idOrEmail, '', null));
  }

  // 3. Lookup remoto
  let user = null;
  if (idOrEmail.includes?.('@')) {
    user = await lookupRemoteByEmail(idOrEmail);
  } else {
    user = await lookupRemoteById(idOrEmail);
    // Se não acha por id e parece pending_*, tenta resolver via email derivado
    if (!user && idOrEmail.startsWith?.('pending_')) {
      const email = emailFromPendingSlug(idOrEmail);
      if (email) user = await lookupRemoteByEmail(email);
    }
  }

  if (user) {
    const normalized = _normalize(user);
    _resolutionCache.set(idOrEmail, normalized);
    return normalized;
  }

  // 4. Miss final → cacheia fallback amigável
  _missSet.add(idOrEmail);
  const fb = _normalize(fallbackProfile(
    idOrEmail,
    idOrEmail.includes?.('@') ? idOrEmail : (idOrEmail.startsWith?.('pending_') ? emailFromPendingSlug(idOrEmail) : null),
    null,
  ));
  _resolutionCache.set(idOrEmail, fb);
  return fb;
}

/**
 * Resolve múltiplos ids em batch (paralelo).
 * Retorna Map<id, profile>.
 */
export async function resolveUsers(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return new Map();
  const unique = [...new Set(ids)];
  const profiles = await Promise.all(unique.map(id => resolveUser(id)));
  return new Map(unique.map((id, i) => [id, profiles[i]]));
}

/**
 * Normaliza a forma de saída pra ter sempre os mesmos campos.
 */
function _normalize(u) {
  if (!u) return u;
  const name = u.name || (u.email ? u.email.split('@')[0] : 'Usuário');
  return {
    id:          u.id,
    name,
    email:       u.email || '',
    avatarColor: u.avatarColor || '#6B7280',
    // 4.35.30+ photoURL faz parte do contrato pra `userAvatarInner` mostrar
    // foto SSO. Antes faltava → workspaces/squads sempre mostravam iniciais.
    photoURL:    u.photoURL || null,
    initials:    name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?',
    role:        u.role || u.roleId || 'member',
    sector:      u.sector || u.department || '',
    pendingSso:  !!u.pendingSso,
    _resolved:   u._resolved !== false,
  };
}

/** Limpa o cache de resolução (chamar após bulk migrations) */
export function invalidateResolverCache() {
  _resolutionCache.clear();
  _missSet.clear();
}
