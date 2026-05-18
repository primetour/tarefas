/**
 * Service de ofertas BTG — abstrai Firestore por trás de uma API simples.
 *
 * Quando Firebase está configurado: lê/escreve em `btg_ofertas_dev`
 * no projeto staging (gestor-btg-lp-builder-staging).
 * Quando não está: lê/escreve em `localStorage` (fallback funcional).
 *
 * Schema da oferta (subset do ACF original):
 *   {
 *     slug, tipo_cartao[], tipo_oferta, concierge_subtipo, oferta_destaque,
 *     destino_rota, nome_da_oferta, descricao, oferta_especial,
 *     duracao_noites, tipo_acomodacao, configuracao_hospedes,
 *     local_evento, categoria_ingresso, companhia_aerea, classe_aerea,
 *     nome_navio, nome_feriado, nacional_internacional, estado_pais,
 *     preco_sob_consulta, preco, moeda, parcelamento, contexto_do_preco, taxas,
 *     data_de_inicio, data_final, data_expiracao,
 *     incluso_no_pacote, beneficios_marca, condicoes_observacoes,
 *     imagem_url, imagem_meta, status, createdAt, updatedAt
 *   }
 *
 * Status possíveis: 'published' (visível nas homes), 'archived' (soft-deleted).
 */

import { getBtgFirebase } from './btg-firebase.js';
import { BTG_COLLECTION } from './btg-config.js';

const COLLECTION = BTG_COLLECTION;
const LOCAL_KEY = 'btg-ofertas-dev';

// ─── Create ────────────────────────────────────────────────

/**
 * Cria uma oferta nova. Garante slug único (dedup automático).
 * @returns {Promise<{id: string, slug: string, source: 'firestore' | 'local'}>}
 */
export async function saveOferta(values) {
  const { db, configured } = await getBtgFirebase();
  const baseSlug = generateBaseSlug(values.nome_da_oferta);
  const slug = configured && db ? await findUniqueSlug(db, baseSlug) : await findUniqueSlugLocal(baseSlug);
  const now = new Date().toISOString();
  const doc = {
    ...stripFiles(values),
    slug,
    imagem_url: values.imagem_url || null,
    status: 'published',
    createdAt: now,
    updatedAt: now,
  };

  if (configured && db) {
    const { addDoc, collection } = await import(
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
    );
    const ref = await addDoc(collection(db, COLLECTION), doc);
    return { id: ref.id, slug, source: 'firestore' };
  }

  const list = readLocal();
  const id = `local-${Date.now()}`;
  list.push({ id, ...doc });
  writeLocal(list);
  return { id, slug, source: 'local' };
}

// ─── Read ──────────────────────────────────────────────────

/**
 * Lista ofertas com filtros opcionais.
 * @param {Object} filters
 * @param {string}  [filters.tipo_cartao]
 * @param {string}  [filters.tipo_oferta]
 * @param {boolean} [filters.destaque]
 * @param {string}  [filters.concierge_subtipo]
 * @param {string}  [filters.status]          padrão 'published'; use 'archived' ou 'all' pra admin
 * @param {number}  [filters.limit]
 */
export async function listOfertas(filters = {}) {
  const status = filters.status || 'published';
  const { db, configured } = await getBtgFirebase();

  if (configured && db) {
    const { collection, getDocs, query, where, orderBy, limit } = await import(
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
    );
    const constraints = [];
    if (filters.tipo_cartao) constraints.push(where('tipo_cartao', 'array-contains', filters.tipo_cartao));
    if (filters.tipo_oferta) constraints.push(where('tipo_oferta', '==', filters.tipo_oferta));
    if (filters.destaque) constraints.push(where('oferta_destaque', '==', 'Sim'));
    if (filters.concierge_subtipo) constraints.push(where('concierge_subtipo', '==', filters.concierge_subtipo));
    if (status !== 'all') constraints.push(where('status', '==', status));
    constraints.push(orderBy('createdAt', 'desc'));
    if (filters.limit) constraints.push(limit(filters.limit));

    const q = query(collection(db, COLLECTION), ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  let list = readLocal();
  if (filters.tipo_cartao) list = list.filter((o) => (o.tipo_cartao || []).includes(filters.tipo_cartao));
  if (filters.tipo_oferta) list = list.filter((o) => o.tipo_oferta === filters.tipo_oferta);
  if (filters.destaque) list = list.filter((o) => o.oferta_destaque === 'Sim');
  if (filters.concierge_subtipo) list = list.filter((o) => o.concierge_subtipo === filters.concierge_subtipo);
  if (status !== 'all') list = list.filter((o) => o.status === status);
  list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return filters.limit ? list.slice(0, filters.limit) : list;
}

/**
 * Busca uma oferta por slug. Retorna null se não achar (ou se estiver archived).
 */
export async function getOfertaBySlug(slug) {
  const { db, configured } = await getBtgFirebase();

  if (configured && db) {
    const { collection, getDocs, query, where, limit } = await import(
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
    );
    const q = query(
      collection(db, COLLECTION),
      where('slug', '==', slug),
      where('status', '==', 'published'),
      limit(1),
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
  }

  const list = readLocal();
  return list.find((o) => o.slug === slug && o.status === 'published') || null;
}

/**
 * Busca uma oferta por ID. Inclui qualquer status (pra UI de edição).
 */
export async function getOfertaById(id) {
  const { db, configured } = await getBtgFirebase();

  if (configured && db) {
    const { doc, getDoc } = await import(
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
    );
    const snap = await getDoc(doc(db, COLLECTION, id));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  }

  const list = readLocal();
  return list.find((o) => o.id === id) || null;
}

/**
 * Estado da conexão (útil pra mostrar badge no dashboard).
 */
export async function getOfertasSource() {
  const { configured, reason } = await getBtgFirebase();
  return configured
    ? { source: 'firestore', collection: COLLECTION }
    : { source: 'local', reason };
}

// ─── Update ────────────────────────────────────────────────

/**
 * Atualiza uma oferta existente.
 * Mantém slug original a menos que `opts.regenerateSlug=true`.
 * Se regenerar, garante unicidade (excluindo a própria oferta do dedup).
 */
export async function updateOferta(id, values, opts = {}) {
  const { db, configured } = await getBtgFirebase();
  const now = new Date().toISOString();
  const patch = {
    ...stripFiles(values),
    imagem_url: values.imagem_url || null,
    updatedAt: now,
  };
  // Remove campos imutáveis caso venham por engano
  delete patch.id;
  delete patch.createdAt;
  delete patch.slug; // só regenera se explicitamente solicitado abaixo

  if (opts.regenerateSlug && values.nome_da_oferta) {
    const baseSlug = generateBaseSlug(values.nome_da_oferta);
    patch.slug = configured && db
      ? await findUniqueSlug(db, baseSlug, id)
      : await findUniqueSlugLocal(baseSlug, id);
  }

  if (configured && db) {
    const { doc, updateDoc } = await import(
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
    );
    await updateDoc(doc(db, COLLECTION, id), patch);
    return { id, source: 'firestore' };
  }

  const list = readLocal();
  const idx = list.findIndex((o) => o.id === id);
  if (idx === -1) throw new Error(`Oferta ${id} não encontrada`);
  list[idx] = { ...list[idx], ...patch };
  writeLocal(list);
  return { id, source: 'local' };
}

// ─── Delete (soft) ─────────────────────────────────────────

/**
 * Soft-delete: marca a oferta como `status='archived'`.
 * A oferta deixa de aparecer nas homes (filtram por status='published')
 * mas continua no banco — recuperável via restoreOferta(id).
 */
export async function archiveOferta(id) {
  return updateOferta(id, { status: 'archived' });
}

/**
 * Reverte um archive: volta status pra 'published'.
 */
export async function restoreOferta(id) {
  return updateOferta(id, { status: 'published' });
}

// ─── Normalize (pra UI) ────────────────────────────────────

/**
 * Normaliza um doc do Firestore (schema flat) para os campos esperados
 * pelo createOfertaCard.
 */
export function normalizeForCard(doc) {
  return {
    id: doc.id,
    slug: doc.slug,
    imagem: doc.imagem_url || '',
    destino: doc.destino_rota || '',
    titulo: doc.nome_da_oferta || '',
    descricao: doc.descricao || '',
    preco: doc.preco || '',
    moeda: doc.moeda || 'R$',
    parcelamento: doc.parcelamento || '1',
    contextoPreco: doc.contexto_do_preco || '',
    ofertaEspecial: doc.oferta_especial || '',
    sobConsulta: !!doc.preco_sob_consulta,
  };
}

// ─── Helpers internos ──────────────────────────────────────

function generateBaseSlug(nome) {
  return String(nome || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80) || `oferta-${Date.now()}`;
}

/**
 * Garante slug único no Firestore. Se baseSlug já existe, tenta -2, -3, ...
 * Para o loop em 100 (paranoid). excludeId permite ignorar a própria oferta
 * (caso update regenerando slug).
 */
async function findUniqueSlug(db, baseSlug, excludeId = null) {
  const { collection, getDocs, query, where, limit } = await import(
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
  );
  const tryOnce = async (candidate) => {
    const snap = await getDocs(query(
      collection(db, COLLECTION),
      where('slug', '==', candidate),
      limit(2),
    ));
    if (snap.empty) return true;
    if (excludeId && snap.docs.every((d) => d.id === excludeId)) return true;
    return false;
  };
  if (await tryOnce(baseSlug)) return baseSlug;
  for (let i = 2; i <= 100; i++) {
    const cand = `${baseSlug}-${i}`;
    if (await tryOnce(cand)) return cand;
  }
  // Fallback paranoid: append timestamp
  return `${baseSlug}-${Date.now()}`;
}

async function findUniqueSlugLocal(baseSlug, excludeId = null) {
  const list = readLocal();
  const exists = (s) => list.some((o) => o.slug === s && o.id !== excludeId);
  if (!exists(baseSlug)) return baseSlug;
  for (let i = 2; i <= 100; i++) {
    const cand = `${baseSlug}-${i}`;
    if (!exists(cand)) return cand;
  }
  return `${baseSlug}-${Date.now()}`;
}

function stripFiles(values) {
  // File objects não serializam — devem ser tratados separadamente
  // (upload pra R2 antes de salvar a oferta).
  const { imagem_file, galeria_files, ...rest } = values;
  return rest;
}

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeLocal(list) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
  } catch (err) {
    console.error('[btg-lab] erro ao salvar local:', err);
  }
}
