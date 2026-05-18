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
 *     imagem_url, status, createdAt, updatedAt
 *   }
 */

import { getBtgFirebase } from './btg-firebase.js';
import { BTG_COLLECTION } from './btg-config.js';

const COLLECTION = BTG_COLLECTION;
const LOCAL_KEY = 'btg-ofertas-dev';

/**
 * Salva uma oferta (cria nova). Recebe values brutos do form-store.
 * @returns {Promise<{id: string, source: 'firestore' | 'local'}>}
 */
export async function saveOferta(values) {
  const slug = generateSlug(values.nome_da_oferta);
  const doc = {
    ...stripFiles(values),
    slug,
    imagem_url: values.imagem_url || null, // Phase 2: upload pra R2 antes
    status: 'published',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const { db, configured } = await getBtgFirebase();

  if (configured && db) {
    const { addDoc, collection } = await import(
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
    );
    const ref = await addDoc(collection(db, COLLECTION), doc);
    return { id: ref.id, source: 'firestore' };
  }

  // Fallback: salva em localStorage
  const list = readLocal();
  const id = `local-${Date.now()}`;
  list.push({ id, ...doc });
  writeLocal(list);
  return { id, source: 'local' };
}

/**
 * Lista ofertas com filtros opcionais.
 * @param {Object} filters
 * @param {string} [filters.tipo_cartao]  ex: 'Partners'
 * @param {string} [filters.tipo_oferta]  ex: 'Feriado'
 * @param {boolean} [filters.destaque]    se true, só destaque na home
 * @param {string} [filters.concierge_subtipo]
 * @returns {Promise<Array<Object>>}
 */
export async function listOfertas(filters = {}) {
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
    constraints.push(where('status', '==', 'published'));
    constraints.push(orderBy('createdAt', 'desc'));
    if (filters.limit) constraints.push(limit(filters.limit));

    const q = query(collection(db, COLLECTION), ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  // Fallback: lê localStorage
  let list = readLocal();
  if (filters.tipo_cartao) list = list.filter((o) => (o.tipo_cartao || []).includes(filters.tipo_cartao));
  if (filters.tipo_oferta) list = list.filter((o) => o.tipo_oferta === filters.tipo_oferta);
  if (filters.destaque) list = list.filter((o) => o.oferta_destaque === 'Sim');
  if (filters.concierge_subtipo) list = list.filter((o) => o.concierge_subtipo === filters.concierge_subtipo);
  list = list.filter((o) => o.status === 'published');
  list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return filters.limit ? list.slice(0, filters.limit) : list;
}

/**
 * Busca uma oferta por slug. Retorna null se não achar.
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

  // Fallback
  const list = readLocal();
  return list.find((o) => o.slug === slug) || null;
}

/**
 * Retorna o estado da conexão (útil pra mostrar badge no dashboard).
 */
export async function getOfertasSource() {
  const { configured, reason } = await getBtgFirebase();
  return configured
    ? { source: 'firestore', collection: COLLECTION }
    : { source: 'local', reason };
}

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

function generateSlug(nome) {
  return String(nome || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80) || `oferta-${Date.now()}`;
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
