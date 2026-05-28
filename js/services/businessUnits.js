/**
 * v4.62.44+ Fase F — SSOT unificado de "Business Units" (BUs).
 *
 * Resolve gap arquitetural D8 da auditoria de Templates de Áreas: hoje
 * existem TRÊS listas paralelas pro mesmo conceito ("BTG" / "Lazer" /
 * "Centurion" etc.):
 *
 *   1. `portal_areas`           — Marca cliente-facing (logo, cor, fonte, template)
 *   2. `sectors`                — Organização interna (TI, Marketing, etc.)
 *   3. `REQUESTING_AREAS` hard  — Lista de solicitante do Portal de Solicitações
 *
 * Sem cross-reference, drift de nomes inevitável.
 *
 * SSOT proposto (`business_units` Firestore):
 *
 *   business_units/{buId} = {
 *     id, name, slug, category,
 *     logoUrl, logoUrlAlt,
 *     colors:    { primary, secondary },
 *     fonts:     { headline, body, accentScale },
 *     editorial: { voice, sectionStyle, coverStyle, chromeAccent },
 *     brand:     { useExternalName: bool },
 *     modules:   { portal: {...}, roteiros: {...}, 'banco-roteiros': {...} },
 *     usedFor:   ['portal', 'roteiros', 'requests'],  // semântica multi-domínio
 *     legacyPortalAreaId: string|null,                // FK pro doc antigo
 *     legacySectorId:     string|null,
 *     active:    true,
 *     createdAt, createdBy, updatedAt, updatedBy,
 *   }
 *
 * Status atual (v4.62.44): foundation+compat. Collection definida, helper
 * `resolveBU(id)` tenta business_units PRIMEIRO, fallback pra portal_areas.
 * Callers não migrados — continuam usando portal_areas e funcionam 100%.
 *
 * Roadmap (próximas releases):
 *   - F.2: script backfill (portal_areas → business_units, idempotente)
 *   - F.3: callers migrados gradualmente (UI Áreas → business_units, depois
 *     generators, depois portal de solicitações)
 *   - F.4: cleanup `portal_areas` quando 100% migrado (release MAJOR)
 *
 * Princípio: schema extension não-destrutivo (CLAUDE.md §14.f). Callers
 * legados continuam funcionando enquanto novos chamam resolveBU().
 */

import { collection, doc, getDoc, getDocs, query, where, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase.js';
import { store } from '../store.js';
import { resolveAreaDefaults } from './areaDefaults.js';

const COLLECTION = 'business_units';

/* ─── Cache em memória (TTL 60s) ─────────────────────────────────── */
let _buCache = null;
let _buCacheAt = 0;
const _BU_TTL = 60_000;

function uid() { return store.get('currentUser')?.uid || null; }

/**
 * Fetch de todas as business_units ativas. Cache 60s.
 */
export async function fetchBusinessUnits({ force = false } = {}) {
  if (!force && _buCache && Date.now() - _buCacheAt < _BU_TTL) return _buCache;
  try {
    const snap = await getDocs(query(collection(db, COLLECTION), where('active', '==', true)));
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _buCache = list; _buCacheAt = Date.now();
    return list;
  } catch (e) {
    console.warn('[businessUnits] fetch falhou:', e?.message);
    return [];
  }
}

/**
 * Resolve uma BU por ID. Tenta business_units PRIMEIRO; fallback pra
 * portal_areas pra preservar compat com docs legados.
 *
 * Retorna shape consistente:
 *   { id, name, category, logoUrl, logoUrlAlt, colors, fonts,
 *     editorial, brand, modules, _source: 'business_units' | 'portal_areas' }
 *
 * Se nada encontrado, retorna null.
 */
export async function resolveBU(id) {
  if (!id) return null;

  // 1. Tenta business_units (SSOT novo)
  try {
    const snap = await getDoc(doc(db, COLLECTION, id));
    if (snap.exists()) {
      return { id: snap.id, ...snap.data(), _source: 'business_units' };
    }
  } catch (e) { /* skip — falha indica permission/network, fallback abaixo */ }

  // 2. Fallback: portal_areas (legacy). Mantém callers antigos funcionando.
  try {
    const snap = await getDoc(doc(db, 'portal_areas', id));
    if (snap.exists()) {
      return { id: snap.id, ...snap.data(), _source: 'portal_areas' };
    }
  } catch (e) { /* skip */ }

  return null;
}

/**
 * Cria/atualiza uma business_unit. Permissão: portal_areas_manage
 * (mesma da edição de áreas legadas — vamos refinar com bu_manage no futuro).
 *
 * Idempotente: se id ausente, cria novo doc; senão, faz merge.
 */
export async function saveBusinessUnit(id, data) {
  if (!store.canManagePortalAreas?.() && !store.isMaster?.()) {
    throw new Error('Permissão negada.');
  }
  const ref = id ? doc(db, COLLECTION, id) : doc(collection(db, COLLECTION));
  const payload = {
    ...data,
    active: data.active !== false,
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
    ...(id ? {} : { createdAt: serverTimestamp(), createdBy: uid() }),
  };
  await setDoc(ref, payload, { merge: true });
  _buCache = null;
  return ref.id;
}

/**
 * Helper conveniente: resolve tokens completos (cores/fonts/editorial)
 * pra um buId + módulo. Usa areaDefaults.resolveAreaDefaults internamente.
 *
 * Caso comum nos generators:
 *   const tpl = await resolveBUTemplate(roteiro.areaId, 'roteiros');
 *   // tpl.colors.primary, tpl.fonts.body, etc.
 */
export async function resolveBUTemplate(buId, moduleKey = null) {
  const bu = await resolveBU(buId);
  return resolveAreaDefaults(bu, moduleKey);
}
