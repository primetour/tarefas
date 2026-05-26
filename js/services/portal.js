/**
 * PRIMETOUR — Portal de Dicas: Service
 * Firestore CRUD, R2 upload, download control, segments config
 */

import {
  collection, doc, getDoc, getDocs, setDoc, addDoc,
  updateDoc, deleteDoc, query, where, orderBy,
  serverTimestamp, increment, limit, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';

/* ─── Cloudflare R2 ───────────────────────────────────────── */
export const R2_PUBLIC_URL   = 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev';
export const R2_ACCOUNT_ID   = '29a66e93504dfad5ae7cdb2c6044ed6f';
export const R2_WORKER_URL   = 'https://primetour-images.rene-castro.workers.dev';
export const R2_UPLOAD_TOKEN = 'primetour2026-imagens-secreto-xk9q';

/* ─── Continents ──────────────────────────────────────────── */
export const CONTINENTS = [
  'Brasil', 'África', 'América Central', 'Caribe',
  'América do Norte', 'América do Sul', 'Ásia',
  'Europa', 'Oriente Médio', 'Oceania', 'Antártica',
];

/* ─── Default categories per segment ─────────────────────── */
export const DEFAULT_CATEGORIES = {
  atracoes:         ['Edifícios e construções urbanas','Galerias de arte','Igrejas e templos','Parques e Jardins','Museus e centros culturais','Complexos esportivos'],
  atracoes_criancas:['Edifícios e construções urbanas','Galerias de arte','Parques e Jardins','Museus e centros culturais','Complexos esportivos'],
  restaurantes:     ['Cafés e bistrôs','Vegetariano e vegano','Asiático','Culinária Internacional','Mediterrâneo','Infantil'],
  vida_noturna:     ['Balada','Bares e lounges','Vinhos'],
  espetaculos:      ['Teatro','Shows'],
  compras:          ['Antiguidades','Itens em couro','Boutiques','Brinquedos','Cosméticos','Decoração','Gourmet','Joias e Relógios','Livrarias','Lojas de Departamento','Moda Feminina','Moda Infantil','Moda Masculina','Sapatos Femininos','Outlet','Eletrônicos','Variados','Vinhos','Vintage'],
  highlights:       ['Arquitetura','Atividades de Verão','Passeio de Helicóptero'],
  agenda_cultural:  ['Concertos','Dança','Espetáculos de Variedades','Eventos Esportivos','Exposições','Festivais','Musicais','Óperas','Shows'],
};

/* ─── Segments definition ─────────────────────────────────── */
// mode:
//   special_info  → Informações Gerais (structured form)
//   simple_list   → Bairros, Arredores (text items)
//   place_list    → standard list with category+place fields
//   agenda        → Agenda Cultural (place_list + period per item)
// 4.40.18+ DEFAULT_SEGMENTS = lista hardcoded (built-in). User pode criar
// segmentos extras via portal_segments (CRUD). getSegments() retorna a
// união ordenada — defaults primeiro, custom no fim.
export const DEFAULT_SEGMENTS = [
  { key: 'informacoes_gerais',  label: 'Informações Gerais',               mode: 'special_info', builtin: true },
  { key: 'bairros',             label: 'Bairros',                          mode: 'simple_list',  builtin: true },
  { key: 'atracoes',            label: 'Atrações',                         mode: 'place_list',   builtin: true },
  { key: 'atracoes_criancas',   label: 'Atrações para Crianças',           mode: 'place_list',   builtin: true },
  { key: 'restaurantes',        label: 'Restaurantes',                     mode: 'place_list',   builtin: true },
  { key: 'vida_noturna',        label: 'Vida Noturna',                     mode: 'place_list',   builtin: true },
  { key: 'espetaculos',         label: 'Casas de Espetáculos, Teatros e Cia.', mode: 'place_list', builtin: true },
  { key: 'compras',             label: 'Compras',                          mode: 'place_list',   builtin: true },
  { key: 'arredores',           label: 'Arredores',                        mode: 'simple_list',  builtin: true },
  { key: 'highlights',          label: 'Highlights',                       mode: 'place_list',   builtin: true },
  { key: 'agenda_cultural',     label: 'Agenda Cultural',                  mode: 'agenda',       builtin: true },
];
// Compat alias — código legacy ainda importa SEGMENTS. Mesma lista, sem custom.
// Para incluir custom: use getSegments() (async).
export const SEGMENTS = DEFAULT_SEGMENTS;

export const GENERATION_FORMATS = [
  { key: 'docx', label: 'Word (.docx)' },
  { key: 'pdf',  label: 'PDF'          },
  { key: 'pptx', label: 'PowerPoint'   },
  { key: 'web',  label: 'Link Web'     },
];

export const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
export const PARTNER_DAILY_LIMIT = 5;

function uid() { return store.get('currentUser')?.uid; }

/* ─── Categories (dynamic, per segment) ──────────────────── */
export async function fetchCategories(segmentKey) {
  try {
    const snap = await getDoc(doc(db, 'portal_categories', segmentKey));
    if (snap.exists()) {
      return snap.data().categories || DEFAULT_CATEGORIES[segmentKey] || [];
    }
  } catch(e) {}
  return DEFAULT_CATEGORIES[segmentKey] || [];
}

export async function saveCategories(segmentKey, categories) {
  // 4.49.6+ Wire da perm granular portal_segments_manage (libera pro analista
  // sem dar portal_manage completo)
  if (!store.canManagePortalSegments()) throw new Error('Permissão negada.');
  await setDoc(doc(db, 'portal_categories', segmentKey), {
    categories,
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
  }, { merge: true });
}

/* ─── 4.40.18+ Custom Segments (dynamic) ──────────────────────
 * Permite ao admin adicionar segmentos extras além dos DEFAULT_SEGMENTS.
 * Cada custom seg vira um doc em portal_segments/{key} com:
 *   key, label, mode (place_list|simple_list|agenda), order, builtin:false
 * Cache local de 60s pra evitar fetch por tip-render.
 */
let _customSegmentsCache = null;
let _customSegmentsCacheAt = 0;
const CUSTOM_SEGMENTS_TTL = 60_000;

export async function fetchCustomSegments({ force = false } = {}) {
  if (!force && _customSegmentsCache && (Date.now() - _customSegmentsCacheAt < CUSTOM_SEGMENTS_TTL)) {
    return _customSegmentsCache;
  }
  try {
    const snap = await getDocs(query(collection(db, 'portal_segments'), orderBy('order', 'asc')));
    const list = snap.docs.map(d => ({ ...d.data(), key: d.id, builtin: false }));
    _customSegmentsCache = list;
    _customSegmentsCacheAt = Date.now();
    return list;
  } catch (e) {
    console.warn('[portal] fetchCustomSegments failed:', e?.message);
    return [];
  }
}

/**
 * Retorna SEGMENTS mergeados: defaults (builtin) primeiro, custom no fim.
 * Cada custom seg respeita a ordem do campo `order` (default = 999).
 */
export async function getSegments({ force = false } = {}) {
  const custom = await fetchCustomSegments({ force });
  return [...DEFAULT_SEGMENTS, ...custom];
}

/**
 * Cria/atualiza um segmento custom. Key precisa ser único e não pode
 * colidir com DEFAULT_SEGMENTS.
 */
export async function saveCustomSegment({ key, label, mode = 'place_list', order = 100 }) {
  // 4.49.6+ Wire da perm granular portal_segments_manage
  if (!store.canManagePortalSegments()) throw new Error('Permissão negada.');
  if (!key || !label) throw new Error('key e label são obrigatórios.');
  if (DEFAULT_SEGMENTS.find(s => s.key === key)) {
    throw new Error(`Key "${key}" colide com segmento padrão.`);
  }
  if (!['place_list', 'simple_list', 'agenda'].includes(mode)) {
    throw new Error(`Modo inválido: ${mode}. Use: place_list, simple_list ou agenda.`);
  }
  await setDoc(doc(db, 'portal_segments', key), {
    label, mode, order,
    builtin: false,
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
  }, { merge: true });
  // Invalida cache
  _customSegmentsCache = null;
}

export async function deleteCustomSegment(key) {
  // 4.49.6+ Wire da perm granular portal_segments_manage
  if (!store.canManagePortalSegments()) throw new Error('Permissão negada.');
  if (DEFAULT_SEGMENTS.find(s => s.key === key)) {
    throw new Error(`Não é possível deletar segmento padrão.`);
  }
  await deleteDoc(doc(db, 'portal_segments', key));
  _customSegmentsCache = null;
}

/**
 * Slugify pra gerar key automática a partir do label. Idempotente.
 *   "Praias e Costas" → "praias_e_costas"
 */
export function slugifySegmentKey(label) {
  return String(label || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // remove acentos
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    || `seg_${Date.now()}`;
}

/* ─── Areas ───────────────────────────────────────────────── */
export async function fetchAreas() {
  const snap = await getDocs(query(collection(db, 'portal_areas'), orderBy('name')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveArea(id, data) {
  // 4.49.2+ Wire da perm granular portal_areas_manage (era checked via portal_manage)
  if (!store.canManagePortalAreas()) throw new Error('Permissão negada.');
  const ref = id ? doc(db, 'portal_areas', id) : doc(collection(db, 'portal_areas'));
  await setDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
    ...(id ? {} : { createdAt: serverTimestamp(), createdBy: uid() }),
  }, { merge: true });
  return ref.id;
}

export async function deleteArea(id) {
  if (!store.canManagePortalAreas()) throw new Error('Permissão negada.');
  // Captura nome pra preservar em flag (UI mostra "ex-área: X")
  let areaName = null;
  try { const s = await getDoc(doc(db, 'portal_areas', id)); if (s.exists()) areaName = s.data()?.name || s.data()?.title || null; } catch {}
  await deleteDoc(doc(db, 'portal_areas', id));

  // v4.57.39 fix integração PD1: cleanup portal_destinations.areaId órfão.
  // Antes: destinos com areaId apontando pra área deletada ficavam órfãos
  // (hierarquia continente→país→área→destino quebrava silenciosamente).
  try {
    const destSnap = await getDocs(query(
      collection(db, 'portal_destinations'),
      where('areaId', '==', id),
      limit(500),
    ));
    if (!destSnap.empty) {
      const batch = writeBatch(db);
      destSnap.forEach(d => {
        batch.update(d.ref, {
          areaId: null,
          areaDeleted: true,
          areaDeletedAt: serverTimestamp(),
          areaDeletedName: areaName,
        });
      });
      await batch.commit();
    }
  } catch (e) {
    console.warn('[deleteArea] cleanup portal_destinations.areaId falhou:', e?.message);
  }
}

/* ─── Destinations ────────────────────────────────────────── */
export async function fetchDestinations({ continent, country } = {}) {
  const snap = await getDocs(query(collection(db, 'portal_destinations'), limit(1000)));
  let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (continent) docs = docs.filter(d => d.continent === continent);
  if (country)   docs = docs.filter(d => d.country   === country);
  docs.sort((a, b) => {
    const ca = (a.continent||'').localeCompare(b.continent||'', 'pt-BR');
    if (ca !== 0) return ca;
    const cb = (a.country||'').localeCompare(b.country||'', 'pt-BR');
    if (cb !== 0) return cb;
    return (a.city||'').localeCompare(b.city||'', 'pt-BR');
  });
  return docs;
}

export async function fetchContinentsWithContent() {
  const snap = await getDocs(query(collection(db, 'portal_destinations'), limit(1000)));
  const continents = new Set(snap.docs.map(d => d.data().continent).filter(Boolean));
  return CONTINENTS.filter(c => continents.has(c));
}

export async function saveDestination(id, data) {
  // 4.49.2+ Aceita portal_destinations_manage (granular) OU portal_manage (legado/master)
  if (!store.canManageDestinations()) throw new Error('Permissão negada.');
  const ref = id
    ? doc(db, 'portal_destinations', id)
    : doc(collection(db, 'portal_destinations'));
  const slug = [data.continent, data.country, data.city]
    .filter(Boolean).map(s => s.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    .join('/');
  await setDoc(ref, {
    ...data, slug,
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
    ...(id ? {} : { createdAt: serverTimestamp(), createdBy: uid() }),
  }, { merge: true });
  return ref.id;
}

export async function deleteDestination(id) {
  // 4.49.2+ Mesmo critério que saveDestination — analista pode deletar destinos
  // que ele mesmo cadastrou. Auditoria server-side via auditLog preserva trilha.
  if (!store.canManageDestinations()) throw new Error('Permissão negada.');
  // Captura nome (city/country) pra flag UI
  let destLabel = null;
  try {
    const s = await getDoc(doc(db, 'portal_destinations', id));
    if (s.exists()) {
      const d = s.data();
      destLabel = [d.city, d.country].filter(Boolean).join(', ') || null;
    }
  } catch {}
  await deleteDoc(doc(db, 'portal_destinations', id));

  // v4.57.39 fix integração PD2: cleanup portal_tips + portal_images
  // referenciando destino deletado.
  // 1) tips: zera destinationId + flag destinationDeleted (preserva tip pra
  //    curador re-categorizar; alternativa seria soft-delete mas perde conteúdo).
  try {
    const tipsSnap = await getDocs(query(
      collection(db, 'portal_tips'),
      where('destinationId', '==', id),
      limit(500),
    ));
    if (!tipsSnap.empty) {
      const batch = writeBatch(db);
      tipsSnap.forEach(d => {
        batch.update(d.ref, {
          destinationId: null,
          destinationDeleted: true,
          destinationDeletedAt: serverTimestamp(),
          destinationDeletedLabel: destLabel,
        });
      });
      await batch.commit();
    }
  } catch (e) {
    console.warn('[deleteDestination] cleanup portal_tips.destinationId falhou:', e?.message);
  }

  // 2) images taggadas pelo destino — zera o tag + flag (mantém imagem viva,
  //    pode ser re-taggada). Imagem em si NÃO é deletada (lifecycle separado).
  try {
    const imgSnap = await getDocs(query(
      collection(db, 'portal_images'),
      where('destinationId', '==', id),
      limit(500),
    ));
    if (!imgSnap.empty) {
      const batch = writeBatch(db);
      imgSnap.forEach(d => {
        batch.update(d.ref, {
          destinationId: null,
          destinationDeleted: true,
          destinationDeletedAt: serverTimestamp(),
        });
      });
      await batch.commit();
    }
  } catch (e) {
    console.warn('[deleteDestination] cleanup portal_images.destinationId falhou:', e?.message);
  }
}

/* ─── Tips ────────────────────────────────────────────────── */
export async function fetchTip(destinationId) {
  const snap = await getDocs(
    query(collection(db, 'portal_tips'),
      where('destinationId', '==', destinationId), limit(1))
  );
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function fetchTips({ continent, country } = {}) {
  const snap = await getDocs(query(collection(db, 'portal_tips'), orderBy('updatedAt', 'desc'), limit(500)));
  let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (continent) docs = docs.filter(d => d.continent === continent);
  if (country)   docs = docs.filter(d => d.country   === country);
  return docs;
}

export async function saveTip(id, data) {
  if (!store.canCreateTip()) throw new Error('Permissão negada.');
  const isNew = !id;
  const ref = id
    ? doc(db, 'portal_tips', id)
    : doc(collection(db, 'portal_tips'));
  await setDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
    ...(isNew ? { createdAt: serverTimestamp(), createdBy: uid() } : {}),
  }, { merge: true });

  // Geocoding em background — NÃO bloqueia o save (operação pode levar
  // 30s+ pra dicas com muitos items). Roda em segundo plano e atualiza
  // o doc com items._geo quando termina.
  // Política Nominatim: 1 req/seg → max 60 endereços por minuto.
  geocodeAndUpdate(ref.id, data).catch(err =>
    console.warn('[saveTip] geocoding falhou:', err?.message));

  // Notify team about new tip creation
  if (isNew) {
    try {
      const { fetchUsers } = await import('./users.js');
      const portalUsers = (await fetchUsers({ active: true }))
        .filter(u => u.isMaster || u.roleId === 'admin' || u.roleId === 'head')
        .map(u => u.id);
      if (portalUsers.length) {
        import('./notifications.js').then(({ notify }) => {
          notify('portal.tip_created', {
            entityType: 'portal_tip', entityId: ref.id,
            recipientIds: portalUsers,
            title: 'Nova dica criada',
            body: `${data.city || data.country || 'Destino'} — ${data.continent || ''}`.trim(),
            route: 'portal-tips',
            category: 'portal',
          });
        }).catch(() => {});
      }
    } catch { /* non-blocking */ }
  }

  return ref.id;
}

/**
 * Geocoda items da dica e atualiza o doc com items._geo.
 * Roda em background após saveTip — não bloqueia a UI.
 * Idempotente: items que já têm _geo são pulados.
 *
 * Pode ser chamado avulso pra geocodar dicas legadas:
 *   import { geocodeAndUpdate } from './portal.js';
 *   await geocodeAndUpdate(tipId);
 */
export async function geocodeAndUpdate(tipId, dataIn) {
  let data = dataIn;
  if (!data) {
    const snap = await getDoc(doc(db, 'portal_tips', tipId));
    if (!snap.exists()) return;
    data = snap.data();
  }
  if (!data?.segments) return;
  const { geocodeTipItems } = await import('./geocoding.js');
  const updated = await geocodeTipItems({ segments: data.segments }, {
    city: data.city || '', country: data.country || '',
  });
  // Patch parcial: sobrescreve só segments — não toca em outros campos
  await setDoc(doc(db, 'portal_tips', tipId), {
    segments: updated.segments,
    geocodedAt: serverTimestamp(),
  }, { merge: true });
  console.info(`[geocoding] tip ${tipId} atualizado`);
}

export async function deleteTip(id) {
  if (!store.canManagePortal()) throw new Error('Permissão negada.');
  // Captura título pra flag
  let tipTitle = null;
  try { const s = await getDoc(doc(db, 'portal_tips', id)); if (s.exists()) tipTitle = s.data()?.title || null; } catch {}
  await deleteDoc(doc(db, 'portal_tips', id));

  // v4.57.39 fix integração PD3: cleanup roteiros.embeddedTips[] órfão.
  // Roteiros mantêm snapshot da tip em embeddedTips[]; quando tip é deletada,
  // o snapshot continua válido (é cópia), mas perde a referência viva.
  // Marca cada embedded item como tipDeleted (não remove pra preservar
  // conteúdo já entregue ao cliente). Renderer da UI pode mostrar badge.
  // Read-modify-write (não é array-contains de objetos puros).
  try {
    const roteirosSnap = await getDocs(query(
      collection(db, 'roteiros'),
      limit(500),
    ));
    const dirty = [];
    roteirosSnap.forEach(d => {
      const r = d.data();
      const tips = Array.isArray(r.embeddedTips) ? r.embeddedTips : [];
      if (!tips.some(t => t && t.tipId === id)) return;
      const updated = tips.map(t => (t && t.tipId === id)
        ? { ...t, tipDeleted: true, tipDeletedAt: new Date().toISOString(), tipDeletedTitle: tipTitle }
        : t);
      dirty.push({ ref: d.ref, updated });
    });
    if (dirty.length) {
      const batch = writeBatch(db);
      dirty.forEach(({ ref, updated }) => {
        batch.update(ref, { embeddedTips: updated, embeddedTipsStaleAt: serverTimestamp() });
      });
      await batch.commit();
    }
  } catch (e) {
    console.warn('[deleteTip] cleanup roteiros.embeddedTips falhou:', e?.message);
  }
}

export async function toggleTipPriority(tipId, priority) {
  if (!store.canCreateTip()) throw new Error('Permissão negada.');
  await updateDoc(doc(db, 'portal_tips', tipId), {
    priority: !!priority,
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
  });
}

export async function fetchAvailableSegments(destinationId) {
  const tip = await fetchTip(destinationId);
  if (!tip?.segments) return [];
  return Object.entries(tip.segments)
    .filter(([, seg]) => {
      if (!seg) return false;
      if (seg.info && Object.values(seg.info).some(v => v && String(v).trim())) return true;
      if (typeof seg.content === 'string' && seg.content.trim()) return true;
      if (Array.isArray(seg.items) && seg.items.length > 0) return true;
      return false;
    })
    .map(([key]) => key);
}

/* ─── Generations ────────────────────────────────────────── */
export async function fetchGenerationsByTip(tipId) {
  const snap = await getDocs(
    query(collection(db, 'portal_generations'),
      orderBy('generatedAt', 'desc')
    )
  );
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(g => g.tipId === tipId || g.destinationIds?.includes(tipId));
}

/* ─── Web Links ──────────────────────────────────────────── */
export async function fetchWebLinksByTip(tipId) {
  const snap = await getDocs(
    query(collection(db, 'portal_web_links'), orderBy('createdAt', 'desc'))
  );
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(link =>
      (link.allTips  || []).some(t  => t.tipId      === tipId) ||
      (link.tipData  || []).some(({ tip }) => tip?.id === tipId)
    );
}

export async function updateWebLink(token, updates) {
  const { updateDoc } = await import(
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
  );
  await updateDoc(doc(db, 'portal_web_links', token), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Apaga um material gerado (web link ou generation registrada).
 * Pode deletar quem:
 *   - É o autor do material (createdBy.uid === currentUser.uid)
 *   - Tem permissão portal_manage (master, admin, owner do workspace)
 *
 * @param {string} kind  — 'web' (portal_web_links) | 'generation' (portal_generations)
 * @param {string} id    — token do link ou docId da generation
 */
export async function deletePortalMaterial(kind, id) {
  if (!id) throw new Error('ID obrigatório.');
  const col = kind === 'web' ? 'portal_web_links'
            : kind === 'generation' ? 'portal_generations'
            : null;
  if (!col) throw new Error('Tipo inválido: use "web" ou "generation".');

  // Lê o doc pra checar autoria — autor pode deletar próprio material
  const ref     = doc(db, col, id);
  const snap    = await getDoc(ref);
  const data    = snap.exists() ? snap.data() : null;
  const myUid   = store.get('currentUser')?.uid || null;
  // web links salvam createdBy.uid, generations salvam generatedBy (string)
  const ownerId = data?.createdBy?.uid || data?.generatedBy || null;
  const isOwner = myUid && ownerId && myUid === ownerId;
  const canMgr  = store.canManagePortal();
  if (!canMgr && !isOwner) {
    throw new Error('Permissão negada — só o autor ou admin pode excluir.');
  }
  await deleteDoc(ref);
  await auditLog?.('portal.material.delete', col, id, { kind, asAuthor: !canMgr && isOwner });
}

// Stub do auditLog se não estiver importado (não-fatal)
const auditLog = (typeof window !== 'undefined' && window.__auditLog) || (async () => {});

/* ─── Download control ────────────────────────────────────── */
export async function checkDownloadLimit() {
  if (store.isMaster() || store.can('portal_download_unlimited'))
    return { allowed: true, remaining: Infinity };
  const today  = new Date().toISOString().slice(0, 10);
  const ref    = doc(db, 'portal_downloads', `${uid()}_${today}`);
  const snap   = await getDoc(ref);
  const count  = snap.exists ? (snap.data().count || 0) : 0;
  return { allowed: count < PARTNER_DAILY_LIMIT, remaining: PARTNER_DAILY_LIMIT - count, count };
}

export async function registerDownload() {
  if (store.isMaster() || store.can('portal_download_unlimited')) return;
  const today = new Date().toISOString().slice(0, 10);
  const ref   = doc(db, 'portal_downloads', `${uid()}_${today}`);
  const snap  = await getDoc(ref);
  if (snap.exists) await updateDoc(ref, { count: increment(1), lastAt: serverTimestamp() });
  else await setDoc(ref, { userId: uid(), date: today, count: 1, lastAt: serverTimestamp() });
}

/* ─── Images ──────────────────────────────────────────────── */
// 4.35.31+ tamanho máximo (lado mais longo) na conversão WebP. Exportado
// pra permitir override em casos especiais (logos altíssima qualidade).
export const WEBP_MAX_SIDE_DEFAULT = 2560;

// 4.35.32+ Page size do banco de imagens. Antes era 200 hardcoded; agora
// suporta cursor-based pagination via `pageAfter` (último doc).
export const IMAGES_PAGE_SIZE = 500;

/**
 * Busca imagens do banco. Backwards-compat: retorna ARRAY direto (como antes).
 * Filtros opcionais (todos client-side): continent, country, city, assetCategory,
 * type, uploadedBy, sinceDate, untilDate.
 *
 * Para paginação cursor-based, use `fetchImagesPage()` (4.35.32+).
 */
export async function fetchImages(filters = {}) {
  const { docs } = await fetchImagesPage({ ...filters, pageSize: IMAGES_PAGE_SIZE });
  return docs;
}

/**
 * 4.35.32+ Paginação cursor-based. Sem `pageAfter`: primeira página.
 * Com `pageAfter`: continua a partir do último doc da página anterior.
 * Retorna `{ docs, lastDoc, hasMore }`.
 */
export async function fetchImagesPage(filters = {}) {
  const { pageAfter = null, pageSize = IMAGES_PAGE_SIZE,
          continent, country, city,
          assetCategory, type, uploadedBy, sinceDate, untilDate } = filters;

  const parts = [collection(db, 'portal_images'), orderBy('uploadedAt', 'desc')];
  if (pageAfter) {
    const { startAfter } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    parts.push(startAfter(pageAfter));
  }
  parts.push(limit(pageSize));

  const snap = await getDocs(query(...parts));
  let docs = snap.docs.map(d => {
    const data = d.data();
    // 4.35.33+ Inferência retroativa de assetCategory. Ordem:
    //  1. Campo explícito (uploads pos-4.35.31)
    //  2. Prefixo do path (logos/, hoteis/, cruzeiros/, trens/)
    //  3. Campo `type` legacy: 'logo_area' → 'logo'
    //  4. Fallback: 'location' (foto de destino)
    let inferredCategory = data.assetCategory;
    if (!inferredCategory && data.path) {
      const firstSeg = data.path.split('/')[0];
      const PATH_TO_CATEGORY = {
        'logos': 'logo', 'hoteis': 'hotel',
        'cruzeiros': 'cruise', 'trens': 'train',
      };
      inferredCategory = PATH_TO_CATEGORY[firstSeg];
    }
    if (!inferredCategory && data.type === 'logo_area') {
      inferredCategory = 'logo';
    }
    return { id: d.id, ...data, assetCategory: inferredCategory || 'location' };
  });

  // Filtros client-side
  if (continent)     docs = docs.filter(d => d.continent === continent);
  if (country)       docs = docs.filter(d => d.country   === country);
  if (city)          docs = docs.filter(d => d.city       === city);
  if (assetCategory) docs = docs.filter(d => d.assetCategory === assetCategory);
  if (type)          docs = docs.filter(d => d.type === type);
  if (uploadedBy)    docs = docs.filter(d => d.uploadedBy === uploadedBy);
  if (sinceDate) {
    const ts = sinceDate instanceof Date ? sinceDate.getTime() : new Date(sinceDate).getTime();
    docs = docs.filter(d => (d.uploadedAt?.toMillis?.() || 0) >= ts);
  }
  if (untilDate) {
    const ts = untilDate instanceof Date ? untilDate.getTime() : new Date(untilDate).getTime();
    docs = docs.filter(d => (d.uploadedAt?.toMillis?.() || 0) <= ts);
  }

  return {
    docs,
    lastDoc: snap.docs[snap.docs.length - 1] || null,
    hasMore: snap.docs.length === pageSize,
  };
}

// 4.35.31+ Categorias de asset (suporte a imagens não-locação)
// 4.40.5+ Modelo Destino = categoria-mãe. Hotel/Restaurante/Trem são
// sub-tipos: aceitam localização OPCIONAL (não obrigatória pra enviar).
// Trem só aceita continente — cobre rotas que cruzam países (ex: Eurostar).
//
// Campos:
//   requiresLocation — bloqueia upload se faltar continente+país
//   showLocation     — 'full' (cont/país/cidade) | 'continent' (só) | 'none'
//   pathPrefix       — prefixo do path no R2; vazio = monta a partir da geolocalização
export const ASSET_CATEGORIES = [
  { key: 'location',   label: 'Destino',     icon: '📍', requiresLocation: true,  showLocation: 'full', pathPrefix: '' /* legacy: continent/country/city */ },
  { key: 'hotel',      label: 'Hotel',       icon: '🏨', requiresLocation: false, showLocation: 'full', pathPrefix: 'hoteis' },
  { key: 'restaurant', label: 'Restaurante', icon: '🍽', requiresLocation: false, showLocation: 'full', pathPrefix: 'restaurantes' },
  // 4.40.6+ Trem: continente/país/cidade VISÍVEIS mas opcionais (atende rotas
  // domésticas Brasil + cruza-fronteiras tipo Eurostar — user decide o nível).
  { key: 'train',      label: 'Trem',        icon: '🚄', requiresLocation: false, showLocation: 'full', pathPrefix: 'trens' },
  { key: 'cruise',     label: 'Cruzeiro',    icon: '🚢', requiresLocation: false, showLocation: 'none', pathPrefix: 'cruzeiros' },
  { key: 'logo',       label: 'Logo',        icon: '◈', requiresLocation: false, showLocation: 'none', pathPrefix: 'logos' },
];

// Helper pra checar permissão de gerir o banco. 4.35.31+: aceita tanto a
// permission portal_images_manage especifica quanto o portal_manage legacy
// (compat com roles antigas). canManagePortal() do store ja cobre master.
export function canManageImageBank() {
  return store.canManagePortal() || store.can?.('portal_images_manage');
}

// Audit logger best-effort (não bloqueia operação se falhar).
// Usa as actions já existentes: portal_images.upload/update/delete (audit.js:126-128)
async function _auditPortalImage(action, imgId, before, after) {
  try {
    const { auditLog } = await import('../auth/audit.js');
    await auditLog(action, 'portal_image', imgId, { before, after });
  } catch {/* ignore — audit não bloqueia operação */}
}

export async function saveImageMeta(data) {
  // 4.49.10+ SECURITY: requer portal_images_manage. Antes não tinha guard
  // (só deleteImageMeta tinha) — quem chegasse na função criava doc + upload.
  if (!canManageImageBank()) throw new Error('Permissão negada.');
  const ref = doc(collection(db, 'portal_images'));
  const meta = {
    // 4.35.31+ assetCategory determina path no R2 e se a foto exige localização
    assetCategory:data.assetCategory || 'location',
    continent:    data.continent    || '',
    country:      data.country      || '',
    city:         data.city         || '',
    name:         data.name         || data.originalName || '',
    placeName:    data.placeName    || '', // nome do lugar específico que a foto representa
    tags:         Array.isArray(data.tags) ? data.tags : [],
    type:         data.type         || 'galeria', // 'destaque'|'galeria'|'logo_area'|'banner'
    // 4.35.31+ Direitos autorais / atribuição da foto (texto livre)
    copyright:    data.copyright    || '',
    url:          data.url          || '',
    path:         data.path         || '',
    originalName: data.originalName || '',
    sizeMB:       data.sizeMB       || 0,
    width:        data.width        || 0,
    height:       data.height       || 0,
    uploadedAt:   serverTimestamp(),
    uploadedBy:   uid(),
  };
  await setDoc(ref, meta);
  await _auditPortalImage('portal_images.upload', ref.id, null, { name: meta.name, type: meta.type, assetCategory: meta.assetCategory });
  return ref.id;
}

export async function updateImageMeta(id, data) {
  // 4.49.10+ SECURITY: requer portal_images_manage. Match com deleteImageMeta.
  if (!canManageImageBank()) throw new Error('Permissão negada.');
  // 4.35.31+ allowlist inclui assetCategory + copyright
  const allowed = ['name','placeName','tags','type','continent','country','city','assetCategory','copyright'];
  const patch   = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)));
  // 4.35.31+ audit log com diff (lê doc antes pra log de before/after)
  const before = await getDoc(doc(db, 'portal_images', id))
    .then(s => s.exists() ? s.data() : null).catch(() => null);
  await updateDoc(doc(db, 'portal_images', id), patch);
  await _auditPortalImage('portal_images.update', id,
    before ? Object.fromEntries(Object.keys(patch).map(k => [k, before[k]])) : null,
    patch);
}

export async function deleteImageMeta(id) {
  if (!canManageImageBank()) throw new Error('Permissão negada.');
  // 4.35.31+ audit log com snapshot do doc antes do delete
  const snap = await getDoc(doc(db, 'portal_images', id));
  const before = snap.exists() ? snap.data() : null;
  if (before?.path) {
    await deleteFromR2(before.path).catch(() => {}); // non-fatal
  }
  await deleteDoc(doc(db, 'portal_images', id));
  await _auditPortalImage('portal_images.delete', id,
    before ? { name: before.name, type: before.type, url: before.url, assetCategory: before.assetCategory } : null,
    null);

  // v4.57.39 fix integração PD4: cleanup refs órfãs em tips + destinos.
  // Generator quebrava ao tentar carregar imagem inexistente (404 + render fail).
  // 1) portal_destinations.heroImage.imageId (objeto único, simples nullify)
  try {
    const destSnap = await getDocs(query(
      collection(db, 'portal_destinations'),
      where('heroImage.imageId', '==', id),
      limit(500),
    ));
    if (!destSnap.empty) {
      const batch = writeBatch(db);
      destSnap.forEach(d => {
        batch.update(d.ref, {
          heroImage: null,
          heroImageDeleted: true,
          heroImageDeletedAt: serverTimestamp(),
        });
      });
      await batch.commit();
    }
  } catch (e) {
    console.warn('[deleteImageMeta] cleanup destinations.heroImage falhou:', e?.message);
  }

  // 2) portal_tips com a imagem em segments[].items[].image.imageId.
  //    Array aninhado de objetos — não dá pra arrayRemove direto; read-modify-write.
  //    Scan limit 500 (em produção média <100 tips por área).
  try {
    const tipsSnap = await getDocs(query(collection(db, 'portal_tips'), limit(500)));
    const dirty = [];
    tipsSnap.forEach(d => {
      const t = d.data();
      const segs = Array.isArray(t.segments) ? t.segments : [];
      let touched = false;
      const updatedSegs = segs.map(seg => {
        const items = Array.isArray(seg?.items) ? seg.items : [];
        const updatedItems = items.map(it => {
          if (it?.image?.imageId === id) {
            touched = true;
            return { ...it, image: null, imageDeleted: true };
          }
          return it;
        });
        return { ...seg, items: updatedItems };
      });
      if (touched) dirty.push({ ref: d.ref, segments: updatedSegs });
    });
    if (dirty.length) {
      const batch = writeBatch(db);
      dirty.forEach(({ ref, segments }) => {
        batch.update(ref, {
          segments,
          imageDeletedAt: serverTimestamp(),
        });
      });
      await batch.commit();
    }
  } catch (e) {
    console.warn('[deleteImageMeta] cleanup tips.segments[].items[].image falhou:', e?.message);
  }
}

export async function convertToWebp(file, quality = 0.92, maxSide = WEBP_MAX_SIDE_DEFAULT) {
  const MAX_SIDE = maxSide;
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      // Scale down only if the longest side exceeds MAX_SIDE — never upscale
      const scale  = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        blob => blob
          ? resolve({ blob, width: canvas.width, height: canvas.height })
          : reject(new Error('Conversão WebP falhou.')),
        'image/webp', quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida.')); };
    img.src = url;
  });
}

export async function uploadImageToR2(webpBlob, path) {
  if (!R2_WORKER_URL)   throw new Error('R2_WORKER_URL não configurada. Faça o deploy do Worker.');
  if (!R2_UPLOAD_TOKEN) throw new Error('R2_UPLOAD_TOKEN não configurado.');
  const fd = new FormData();
  fd.append('file', webpBlob, path.split('/').pop());
  fd.append('path', path);
  const res = await fetch(R2_WORKER_URL, {
    method: 'POST',
    headers: { 'X-Upload-Token': R2_UPLOAD_TOKEN },
    body: fd,
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.status);
    throw new Error(`Upload falhou: ${msg}`);
  }
  return `${R2_PUBLIC_URL}/${path}`;
}

export async function deleteFromR2(path) {
  if (!R2_WORKER_URL || !R2_UPLOAD_TOKEN) return; // silently skip if not configured
  const url = `${R2_WORKER_URL}?path=${encodeURIComponent(path)}`;
  await fetch(url, {
    method: 'DELETE',
    headers: { 'X-Upload-Token': R2_UPLOAD_TOKEN },
  });
}

/* ─── Generations ─────────────────────────────────────────── */
export async function recordGeneration(data) {
  const ref = doc(collection(db, 'portal_generations'));
  await setDoc(ref, { ...data, generatedBy: uid(), generatedAt: serverTimestamp() });
  return ref.id;
}

/* ─── Terms ───────────────────────────────────────────────── */
export async function getActiveTerms() {
  const snap = await getDocs(
    query(collection(db, 'portal_terms'), orderBy('updatedAt', 'desc'), limit(1))
  );
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function hasAcceptedTerms(termsId) {
  const ref  = doc(db, 'portal_terms_acceptance', `${uid()}_${termsId}`);
  const snap = await getDoc(ref);
  return snap.exists;
}

export async function acceptTerms(termsId) {
  await setDoc(doc(db, 'portal_terms_acceptance', `${uid()}_${termsId}`), {
    userId: uid(), termsId, acceptedAt: serverTimestamp(), userAgent: navigator.userAgent,
  });
}

/* ─── IA: Sugerir atualização para segmento vencido ──────── */

const AI_TRAVEL_SITES = ['tripadvisor.com', 'timeout.com', 'lonelyplanet.com', 'viator.com', 'thefork.com'];

/**
 * Usa IA para sugerir conteúdo atualizado para um segmento vencido.
 * @param {string} tipId — ID do documento portal_tips
 * @param {string} segmentKey — chave do segmento (ex: 'restaurantes')
 * @returns {{ suggestion: string, sources: Array, model: string, provider: string } | null}
 */
export async function suggestExpiredUpdate(tipId, segmentKey) {
  // 1. Carregar dados do tip
  const tipDoc = await getDoc(doc(db, 'portal_tips', tipId));
  if (!tipDoc.exists()) throw new Error('Dica não encontrada.');
  const tip = tipDoc.data();

  const segDef = SEGMENTS.find(s => s.key === segmentKey);
  if (!segDef) throw new Error('Segmento inválido.');

  const segData = tip.segments?.[segmentKey];
  if (!segData) throw new Error('Segmento sem dados.');

  // Serializar conteúdo do segmento para contexto
  let oldContent = '';
  if (segDef.mode === 'special_info' && segData.info) {
    oldContent = Object.entries(segData.info)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
  } else if (segData.items?.length) {
    oldContent = segData.items.slice(0, 15).map(item => {
      let line = item.title || item.name || '';
      if (item.category) line = `[${item.category}] ${line}`;
      if (item.description) line += ` — ${item.description.substring(0, 120)}`;
      if (item.address) line += ` (${item.address})`;
      return line;
    }).join('\n');
  }
  if (segData.dica) oldContent += `\nDica: ${segData.dica}`;
  if (!oldContent.trim()) oldContent = '(sem conteúdo)';

  const destinationName = `${tip.city || ''}, ${tip.country || ''}`.replace(/^,\s*|,\s*$/g, '');

  // 2. Buscar dados frescos na web
  let webResults = [];
  let webText = '';
  try {
    const { default: searchWebFromActions } = await import('./aiActions.js').catch(() => ({}));
    // Tentar buscar via a função de AI actions ou diretamente
    const { getAIConfig } = await import('./ai.js');
    const cfg = await getAIConfig() || {};

    if (cfg.serperApiKey) {
      const searchQuery = `${destinationName} ${segDef.label} ${new Date().getFullYear()}`;
      const siteFilter = AI_TRAVEL_SITES.map(s => `site:${s}`).join(' OR ');
      const resp = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': cfg.serperApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: `${searchQuery} (${siteFilter})`, gl: 'br', hl: 'pt-br', num: 8 }),
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const data = await resp.json();
        webResults = (data.organic || []).map(item => ({
          title: item.title || '',
          url: item.link || '',
          snippet: (item.snippet || '').substring(0, 250),
          source: (() => { try { return new URL(item.link).hostname.replace('www.', ''); } catch { return ''; } })(),
        }));
        webText = webResults.map(r => `[${r.source}] ${r.title}\n${r.snippet}`).join('\n\n');
      }
    }
  } catch (e) {
    console.warn('[Portal AI] Web search failed:', e);
    webText = '(pesquisa web indisponível)';
  }

  // 3. Chamar IA via skill ou prompt direto
  const { runSkill, fetchSkillsForModule, chatWithAI } = await import('./ai.js');

  // Tentar encontrar skill configurada para este propósito
  const skills = await fetchSkillsForModule('portal-tips').catch(() => []);
  const updateSkill = skills.find(s =>
    s.name?.toLowerCase().includes('vencid') ||
    s.name?.toLowerCase().includes('atualizar dica') ||
    s.name?.toLowerCase().includes('expired')
  );

  let result;
  if (updateSkill) {
    // Usar skill configurada pelo admin
    result = await runSkill(updateSkill.id, {
      destinationName,
      segmentLabel: segDef.label,
      oldContent: oldContent.substring(0, 3000),
      expiryDate: segData.expiryDate || '',
      webSearchResults: webText.substring(0, 4000),
    });
  } else {
    // Fallback: usar chatWithAI com prompt inline
    const prompt = `Atualize o conteúdo vencido do Portal de Dicas de viagem.

Destino: ${destinationName}
Segmento: ${segDef.label}

CONTEÚDO ATUAL (vencido em ${segData.expiryDate || 'data indefinida'}):
${oldContent.substring(0, 3000)}

PESQUISA WEB RECENTE:
${webText.substring(0, 4000) || '(sem resultados)'}

Gere uma versão atualizada mantendo o mesmo formato e tom. Português BR. Seja conciso e prático.`;

    result = await chatWithAI(prompt, {}, { moduleId: 'portal-tips' });
  }

  return {
    suggestion: result.text,
    sources: webResults.slice(0, 5),
    model: result.model,
    provider: result.provider,
    segmentKey,
    segmentLabel: segDef.label,
    destinationName,
  };
}
