/**
 * PRIMETOUR — Banco de Roteiros (v4.50.0+)
 *
 * Roteiros curados da empresa, usados como:
 *   1. Sugestões manuais pro consultor copiar/adaptar
 *   2. Base de conhecimento da IA (futuro v4.51+)
 *
 * Schema é alinhado a:
 *   - `portal_destinations`        (geo, cities[])
 *   - `js/services/roteiros.js`    (days[], hotels[], includes/excludes,
 *                                   payment, cancellation, importantInfo)
 *   - PDFs "Classic Collection"    (categorias de hotel: Sugestão Prime/Luxo/Standard,
 *                                   pricing por período, hotéis por cidade)
 *
 * Permissões (reusa portal_destinations_manage / portal_manage / master):
 *   read   → qualquer usuário autenticado da Primetour
 *   write  → quem pode gerenciar destinos (princípio: curadoria é curadoria)
 *
 * Collections:
 *   roteiros_bank/{id}                  → o roteiro curado
 *   roteiro_bank_categories/{key}       → categorias de hospedagem (CRUD via Settings)
 *
 * Status workflow:
 *   draft       → em construção, não aparece nas buscas padrão
 *   review      → aguardando revisão (curadoria)
 *   approved    → publicado, aparece pra todos
 *   archived    → fora de uso (não exclui — preserva histórico)
 *
 * Validade (`validity.endDate`): controle de equipe pra revisar valores/hotéis.
 * Status `approved` + `validity.endDate < hoje` = mostra badge "Expirado" mas NÃO esconde.
 */

import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  query, where, orderBy, serverTimestamp, limit,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';

const COL_BANK       = 'roteiros_bank';
const COL_CATEGORIES = 'roteiro_bank_categories';

function uid() { return store.get('currentUser')?.uid; }
function canWrite() {
  return store.isMaster?.()
      || store.can?.('portal_destinations_manage')
      || store.can?.('portal_manage');
}

/* ═══════════════════════════════════════════════════════════════
   SCHEMA (single source of truth)
   ═══════════════════════════════════════════════════════════════ */

/**
 * Retorna roteiro_bank "em branco" — todas as propriedades default.
 * Use em criação nova ou pra garantir shape consistente em migração on-read.
 */
export function emptyRoteiroBank() {
  return {
    /* ─── Identidade ─── */
    title: '',
    subtitle: '',
    code: '',                         // ex: "CC-CHN-TBT" — gerado on-save se vazio
    slug: '',                         // gerado on-save (title slugified)
    collectionLabel: 'Classic',       // marca curatorial (Classic / Exclusive / Corporate / livre)

    /* ─── Status ─── */
    status: 'draft',                  // draft | review | approved | archived

    /* ─── Validade pra controle de equipe ─── */
    validity: {
      startDate: '',                  // ISO yyyy-mm-dd (vazio = sempre válido)
      endDate: '',                    // ISO yyyy-mm-dd (vazio = sem expiração)
      notes: '',                      // ex: "Revisar valores em abril"
    },

    /* ─── Narrativa de capa ─── */
    shortDescription: '',             // 1-2 parágrafos (vai no card e na abertura do export)
    longDescription: '',              // opcional, narrativa estendida

    /* ─── Cobertura geográfica (alinhada a portal_destinations) ─── */
    geo: {
      continents: [],                 // ['Ásia']
      countries:  [],                 // ['China', 'Tibete']
      cities: [],                     // [{ city, country, continent, nights }, ...]
      destinationIds: [],             // refs em portal_destinations (auto-vinculadas quando city+country bate)
    },

    /* ─── Duração ─── */
    durationDays:   0,                // total (inclui chegada+saída)
    durationNights: 0,                // soma de noites por cidade

    /* ─── Dia a dia (mesmo shape de roteiro.days, sem date/activities) ─── */
    days: [],                         // [{ dayNumber, city, title, narrative, overnightCity, flightLeg }]

    /* ─── Categorias de hospedagem + pricing (estilo Classic Collection PDF) ─── */
    /**
     * Cada categoria:
     *   {
     *     key:    'sugestao-prime' | 'luxo' | 'luxo-standard' | 'luxo-moderado' | custom,
     *     label:  'Sugestão Prime' | ...
     *     hotels: [{ city, name, roomType, nights, supplierUrl, notes }, ...],
     *     pricing: [
     *       { period: { start, end }, single, double, currency: 'USD'|'BRL'|'EUR', notes },
     *       ...
     *     ],
     *     notes:  string,
     *   }
     * Pricing é por pessoa (compatível com convenção do PDF).
     */
    categories: [],

    /* ─── Inclui / Não inclui (buckets pra render limpo) ─── */
    includes: {
      hospedagem:    [],              // ['3 noites c/ café em Pequim', ...]
      traslados:     [],
      passeios:      [],
      assistencia:   [],
      aereoInterno:  [],
      trem:          [],
      outros:        [],
    },
    excludes: [],                     // lista plana — itens negativos

    /* ─── Pagamento (terrestre + aéreo + sinal) ─── */
    payment: {
      terrestrial: '',                // ex: 'À vista ou 40% entrada + 2x cartão'
      aerial:      'De acordo com a política da cia aérea escolhida.',
      deposit:     { amount: 0, currency: 'USD', perPerson: true, notes: '' },
      settlement:  '',                // prazo de pagamento total
    },

    /* ─── Cancelamento (escalado) ─── */
    /**
     * Cada item: { fromDays, multaPercent, notes }.
     * fromDays = quantos dias antes da viagem aquela multa se aplica (limite SUPERIOR).
     * Ex: fromDays=90 multa=20 → 'até 90 dias antes: 20%'.
     */
    cancellation: [],

    /* ─── Documentação ─── */
    documentation: {
      passport: '',
      minors:   '',
      visas:    [],                   // [{ country, required, notes }]
      vaccines: '',
    },

    /* ─── Notas de viagem (clima, altitude, festas locais) ─── */
    travelNotes: [],                  // lista de strings, cada uma um bullet

    /* ─── Imagens ─── */
    images: {
      hero:     null,                 // URL R2 (ou Unsplash) pra capa
      gallery:  [],                   // até 6 URLs auxiliares (composição capa estilo PDF)
      overrides: {},                  // city_<slug>: url
    },

    /* ─── Origem do dado ─── */
    source: {
      type:         'manual',         // manual | pdf_import | api_import
      originalFile: '',               // nome do PDF de origem
      importedAt:   null,             // ISO timestamp
      importedBy:   '',               // uid do usuário que importou
      llmTokens:    { input: 0, output: 0 },  // pra controle de custo
    },

    /* ─── Curadoria / tags ─── */
    tags: [],                         // ['cultural', 'espiritual', 'unesco']
    aiUsable: true,                   // flag pra IA usar como base (futuro v4.51+)

    /* ─── Auditoria (preenchido on-save) ─── */
    createdAt: null, createdBy: '',
    updatedAt: null, updatedBy: '',
    approvedAt: null, approvedBy: '',
  };
}

/**
 * Migration on-read: garante que docs antigos têm o shape novo.
 * Defensivo — só preenche campos faltando, não altera valores existentes.
 */
export function migrateRoteiroBank(raw) {
  const base = emptyRoteiroBank();
  const merged = { ...base, ...raw };

  // Sub-objetos: merge profundo defensivo (raw sobrescreve base, mas não some)
  merged.validity      = { ...base.validity, ...(raw.validity || {}) };
  merged.geo           = { ...base.geo, ...(raw.geo || {}) };
  merged.includes      = { ...base.includes, ...(raw.includes || {}) };
  merged.payment       = { ...base.payment, ...(raw.payment || {}) };
  merged.payment.deposit = { ...base.payment.deposit, ...(raw.payment?.deposit || {}) };
  merged.documentation = { ...base.documentation, ...(raw.documentation || {}) };
  merged.images        = { ...base.images, ...(raw.images || {}) };
  merged.source        = { ...base.source, ...(raw.source || {}) };
  merged.source.llmTokens = { ...base.source.llmTokens, ...(raw.source?.llmTokens || {}) };

  // Arrays — default vazio se ausente
  for (const k of ['categories', 'days', 'excludes', 'cancellation', 'travelNotes', 'tags']) {
    if (!Array.isArray(merged[k])) merged[k] = [];
  }
  for (const k of ['continents', 'countries', 'cities', 'destinationIds']) {
    if (!Array.isArray(merged.geo[k])) merged.geo[k] = [];
  }
  if (!Array.isArray(merged.documentation.visas)) merged.documentation.visas = [];
  if (!Array.isArray(merged.images.gallery)) merged.images.gallery = [];
  for (const k of ['hospedagem','traslados','passeios','assistencia','aereoInterno','trem','outros']) {
    if (!Array.isArray(merged.includes[k])) merged.includes[k] = [];
  }

  return merged;
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Gera código curto a partir do título (3-12 chars uppercase). */
function autoCode(title, collectionLabel) {
  const pref = (collectionLabel || 'BNK').slice(0, 3).toUpperCase();
  const body = String(title || '')
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9 ]/g, '')
    .split(/\s+/).filter(Boolean)
    .slice(0, 3)
    .map(w => w.slice(0, 3))
    .join('');
  return `${pref}-${body || 'NEW'}`;
}

/** Verifica se um doc está expirado relativo a hoje. */
export function isExpired(doc) {
  const end = doc?.validity?.endDate;
  if (!end) return false;
  try {
    return new Date(end + 'T23:59:59') < new Date();
  } catch { return false; }
}

/* ═══════════════════════════════════════════════════════════════
   CRUD — roteiros_bank
   ═══════════════════════════════════════════════════════════════ */

/**
 * Lista roteiros do banco com filtros opcionais.
 * Por padrão exclui 'archived'. Use `includeArchived: true` pra incluir.
 */
export async function fetchRoteiroBankList({
  status,                  // 'draft' | 'review' | 'approved' | 'archived'
  continent, country, city,
  search,
  includeArchived = false,
  max = 500,
} = {}) {
  const snap = await getDocs(query(collection(db, COL_BANK), limit(max)));
  let docs = snap.docs.map(d => migrateRoteiroBank({ id: d.id, ...d.data() }));

  if (!includeArchived) docs = docs.filter(d => d.status !== 'archived');
  if (status)    docs = docs.filter(d => d.status === status);
  if (continent) docs = docs.filter(d => d.geo.continents.includes(continent));
  if (country)   docs = docs.filter(d => d.geo.countries.includes(country));
  if (city)      docs = docs.filter(d => d.geo.cities.some(c => c.city === city));
  if (search) {
    const s = search.toLowerCase();
    docs = docs.filter(d =>
      d.title.toLowerCase().includes(s)
      || d.shortDescription.toLowerCase().includes(s)
      || d.geo.cities.some(c => c.city.toLowerCase().includes(s))
      || d.geo.countries.some(co => co.toLowerCase().includes(s))
      || (d.tags || []).some(t => t.toLowerCase().includes(s))
    );
  }

  // Ordem padrão: approved primeiro, draft depois; dentro de cada status, mais recente primeiro
  const statusOrder = { approved: 0, review: 1, draft: 2, archived: 3 };
  docs.sort((a, b) => {
    const so = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
    if (so !== 0) return so;
    const ta = a.updatedAt?.toMillis?.() || 0;
    const tb = b.updatedAt?.toMillis?.() || 0;
    return tb - ta;
  });
  return docs;
}

export async function fetchRoteiroBank(id) {
  const snap = await getDoc(doc(db, COL_BANK, id));
  if (!snap.exists()) return null;
  return migrateRoteiroBank({ id: snap.id, ...snap.data() });
}

export async function saveRoteiroBank(id, data) {
  if (!canWrite()) throw new Error('Permissão negada pra editar Banco de Roteiros.');

  // Auto-fill: slug + code se vazios
  const slug = data.slug || slugify(data.title || 'roteiro');
  const code = data.code || autoCode(data.title, data.collectionLabel);

  const ref = id ? doc(db, COL_BANK, id) : doc(collection(db, COL_BANK));
  const payload = {
    ...data,
    slug,
    code,
    updatedAt: serverTimestamp(),
    updatedBy: uid() || '',
    ...(id ? {} : {
      createdAt: serverTimestamp(),
      createdBy: uid() || '',
    }),
  };

  // Approval auto-stamp se transicionou pra approved
  if (data.status === 'approved' && !data.approvedAt) {
    payload.approvedAt = serverTimestamp();
    payload.approvedBy = uid() || '';
  }

  await setDoc(ref, payload, { merge: true });
  return ref.id;
}

export async function deleteRoteiroBank(id) {
  if (!canWrite()) throw new Error('Permissão negada.');
  // Soft-delete recomendado via archived. Hard-delete só pra master/admin.
  if (!store.isMaster?.()) throw new Error('Apenas master pode deletar permanentemente. Use "Arquivar".');
  await deleteDoc(doc(db, COL_BANK, id));
}

export async function archiveRoteiroBank(id) {
  if (!canWrite()) throw new Error('Permissão negada.');
  await setDoc(doc(db, COL_BANK, id), {
    status: 'archived',
    updatedAt: serverTimestamp(),
    updatedBy: uid() || '',
  }, { merge: true });
}

export async function duplicateRoteiroBank(id) {
  if (!canWrite()) throw new Error('Permissão negada.');
  const orig = await fetchRoteiroBank(id);
  if (!orig) throw new Error('Roteiro não encontrado.');
  const copy = { ...orig };
  delete copy.id;
  copy.title = `${orig.title} (cópia)`;
  copy.status = 'draft';
  copy.code = '';            // regenera
  copy.slug = '';
  copy.approvedAt = null;
  copy.approvedBy = '';
  return await saveRoteiroBank(null, copy);
}

/* ═══════════════════════════════════════════════════════════════
   CRUD — Categorias (defaults + custom via Settings)
   ═══════════════════════════════════════════════════════════════ */

/**
 * Categorias DEFAULT (seed). Extraídas dos PDFs Classic Collection.
 * User pode adicionar/editar via collection roteiro_bank_categories.
 */
export const DEFAULT_CATEGORIES = [
  { key: 'sugestao-prime', label: 'Sugestão Prime',   order: 1, color: '#3B82F6', builtin: true },
  { key: 'luxo',           label: 'Luxo',             order: 2, color: '#D4A843', builtin: true },
  { key: 'luxo-standard',  label: 'Luxo Standard',    order: 3, color: '#10B981', builtin: true },
  { key: 'luxo-moderado',  label: 'Luxo Moderado',    order: 4, color: '#8B5CF6', builtin: true },
];

export async function fetchBankCategories() {
  try {
    const snap = await getDocs(query(collection(db, COL_CATEGORIES), orderBy('order')));
    const docs = snap.docs.map(d => ({ key: d.id, ...d.data() }));
    if (docs.length) return docs;
  } catch (e) {
    console.warn('[fetchBankCategories] falhou:', e.message);
  }
  return DEFAULT_CATEGORIES;
}

export async function saveBankCategory(key, data) {
  if (!canWrite()) throw new Error('Permissão negada.');
  await setDoc(doc(db, COL_CATEGORIES, key), {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: uid() || '',
  }, { merge: true });
}

export async function deleteBankCategory(key) {
  if (!canWrite()) throw new Error('Permissão negada.');
  await deleteDoc(doc(db, COL_CATEGORIES, key));
}

/* ═══════════════════════════════════════════════════════════════
   AUTO-LINK com portal_destinations
   ═══════════════════════════════════════════════════════════════ */

/**
 * Resolve city → portal_destinations.id (cria se não existir e user pode).
 * Retorna { destinationId, created: boolean }.
 *
 * Usado pelo editor / import pra manter `geo.destinationIds` sincronizado.
 */
export async function ensureDestination({ city, country, continent }) {
  if (!city || !country || !continent) return { destinationId: null, created: false };
  const cityKey = slugify(city);
  const snap = await getDocs(query(
    collection(db, 'portal_destinations'),
    where('country', '==', country),
    limit(50),
  ));
  const match = snap.docs.find(d => {
    const data = d.data();
    return slugify(data.city || '') === cityKey;
  });
  if (match) return { destinationId: match.id, created: false };

  // Não achou — tenta criar (precisa canManageDestinations)
  if (!store.canManageDestinations?.()) return { destinationId: null, created: false };
  const ref = doc(collection(db, 'portal_destinations'));
  const slug = [continent, country, city].map(slugify).filter(Boolean).join('/');
  await setDoc(ref, {
    continent, country, city, slug,
    autoCreated: true,
    autoCreatedSource: 'roteiro_bank',
    createdAt: serverTimestamp(),
    createdBy: uid() || '',
    updatedAt: serverTimestamp(),
    updatedBy: uid() || '',
  });
  return { destinationId: ref.id, created: true };
}
