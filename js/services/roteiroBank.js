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
  query, where, orderBy, serverTimestamp, limit, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';

const COL_BANK        = 'roteiros_bank';
const COL_CATEGORIES  = 'roteiro_bank_categories';
const COL_COLLECTIONS = 'roteiro_bank_collections';   // v4.50.1+ Classic/Exclusive/Corporate (CRUDable)

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
      continents: [],                 // legado v4.50 — labels pt-BR ('Ásia')
      countries:  [],                 // legado v4.50 — labels pt-BR ('China', 'Tibete')
      countryCodes:   [],             // v4.59.3+ ISO 3166-1 alpha-2 (preferido — usar nos filtros)
      continentCodes: [],             // v4.59.3+ UN M.49 (AF/EU/AS/NA/SA/OC/AN)
      cities: [],                     // [{ city, country, countryCode, continent, nights }, ...]
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
     *     hotels: [{
     *       // legacy minimal
     *       city, name, roomType, nights, supplierUrl, notes,
     *       // v4.58.0+ enriched (Envision API): preenchidos quando source='envision'
     *       address:    { street, number, district, postalCode, complement },
     *       phone, email,
     *       chainCode,            // ex: "FOURSEASONS"
     *       rating,               // estrelas (1-5)
     *       coords:     { lat, lng },
     *       iata,                 // IATA da cidade (ex: "TYO" pra Tokyo)
     *       locationId,           // FK Envision pra Location
     *       distanceToCenter,     // km do centro
     *       distanceToAirport,    // km do aeroporto mais próximo
     *       nearestAirport,       // nome do aeroporto
     *       envisionProductId,    // FK Envision Product
     *       envisionRoomId,       // FK Envision Room (matriz fares)
     *       optional,             // se é opcional/upgrade na categoria
     *     }, ...],
     *     pricing: [
     *       { period: { start, end }, single, double, currency: 'USD'|'BRL'|'EUR', notes },
     *       ...
     *     ],
     *     notes:  string,
     *   }
     * Pricing é por pessoa (compatível com convenção do PDF).
     */
    categories: [],

    /* ─── Services estruturados (passeios, transfers, ingressos, trens) ─── */
    /**
     * v4.58.0+ ADD. Envision Product (ProductType=1) vem como entidade RICA
     * (Category + Description + CancellationPolicy + AgeGroups), não bullet.
     * Mantemos paralelo ao `includes.{passeios,traslados,...}` (que continua
     * pra render bullet-friendly no PDF). Render decide quando usar struct
     * (modal de detalhe do serviço) vs bullet (resumo Inclui no PDF).
     *
     * Cada service:
     *   {
     *     category:           'passeio'|'transfer'|'ingresso'|'trem'|'mini-roteiro'|'outro',
     *     categoryLabel:      string (label oficial Envision, ex: "Passeio", "Mini Roteiro"),
     *     name:               string,
     *     descriptionHtml:    string (HTML rico — passa por sanitize no render),
     *     day:                number (dia do roteiro em que ocorre),
     *     consumableDays:     number (quantos dias o serviço dura),
     *     optional:           boolean (se é opcional/upgrade),
     *     ageGroups:          [{ min, max, label }] (ex: criança 6-11, adulto 12+),
     *     cancellationPolicyHtml: string (política PRÓPRIA do serviço),
     *     supplier:           string (ProductSupplier),
     *     locationId:         number (FK Envision Location),
     *     locationName:       string,
     *     envisionProductId:  number (FK),
     *     online:             boolean,
     *     maxQuantity:        number,
     *   }
     */
    services: [],

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

    /* ─── Informações gerais do destino (Envision: Globalization.GeneralInfo) ─── */
    /**
     * v4.58.0+ ADD. Hoje o curador preenche essas coisas como bullets em
     * `travelNotes`. Envision tem campo dedicado pra cada (mais estruturado).
     * Mantemos `travelNotes` pra bullets livres + estes campos pra essenciais.
     * Cada um aceita HTML ou texto livre — render decide formatação.
     */
    generalInfo: {
      timezone:   '',                 // ex: "GMT-3 (Brasília)"
      currency:   '',                 // ex: "Iene (¥) — 1 USD ≈ 150 JPY"
      climate:    '',                 // ex: "Verão quente jul-set (28-35°C)..."
      gratuities: '',                 // ex: "Gorjeta não é costume no Japão..."
      voltage:    '',                 // ex: "100V, plug tipo A. Adaptador opcional."
      gastronomy: '',                 // ex: "Sushi/sashimi/ramen, omakase reservas..."
      telecom:    '',                 // ex: "Wi-Fi pocket recomendado, eSIM funciona..."
      tips:       '',                 // bullets livres adicionais
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
      type:         'manual',         // manual | pdf_import | api_import | envision
      originalFile: '',               // nome do PDF de origem
      importedAt:   null,             // ISO timestamp
      importedBy:   '',               // uid do usuário que importou
      llmTokens:    { input: 0, output: 0 },  // pra controle de custo
    },

    /* ─── Integração Envision (v4.58.0+) ─── */
    /**
     * Sync com TravelAgent (envisiontecnologia.com.br). Populado quando o
     * roteiro vem da Envision (manualmente importado OU via Cloud Function
     * de sync). Vazio (envision.id = null) pra roteiros 100% manuais.
     *
     * Rastreabilidade: dado o envision.id, o sync re-importa preservando
     * editorialOverlay (campos locais que o curador customizou). Doc completo
     * de overlay em docs/ENVISION-INTEGRATION-PLAN.md §6.
     */
    envision: {
      id:                   null,     // Itinerary.Id (FK Envision, número)
      url:                  null,     // deep link pro TravelAgent (gerado on-save)
      loginInformationId:   null,     // qual credencial Envision criou (debug)
      supplierId:           null,     // operador local que montou o pacote
      syncedAt:             null,     // ISO timestamp do último sync bem-sucedido
      // Currency/ExchangeRate adiados pra Fase 2 (quando integrarmos preços
      // via /CalculateItineraryFareEstimate).
    },

    /**
     * HTML bruto vindo da Envision (raw fallback). Não é renderizado por
     * default — só se o campo estruturado correspondente estiver vazio.
     * Adapter copia direto da Envision sem parsing (sem parser frágil).
     * Curador edita os campos estruturados → renderer prioriza estruturado.
     */
    envisionRaw: {
      includes:           '',         // Globalization.Includes (HTML)
      generalInfo:        '',         // Globalization.GeneralInfo (HTML)
      cancellationPolicy: '',         // Globalization.CancellationPolicy (HTML)
      formOfPayment:      '',         // Globalization.FormOfPayment (HTML)
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
 *
 * v4.58.0+ ADD: cobre novos sub-objetos { envision, envisionRaw, generalInfo }
 * e novo array `services`. CLAUDE.md §11.h — fallback explícito, não migra
 * dado silenciosamente (preserva valores existentes).
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

  // v4.58.0+ novos sub-objetos
  merged.generalInfo = { ...base.generalInfo, ...(raw.generalInfo || {}) };
  merged.envision    = { ...base.envision, ...(raw.envision || {}) };
  merged.envisionRaw = { ...base.envisionRaw, ...(raw.envisionRaw || {}) };

  // Arrays — default vazio se ausente
  for (const k of ['categories', 'days', 'excludes', 'cancellation', 'travelNotes', 'tags', 'services']) {
    if (!Array.isArray(merged[k])) merged[k] = [];
  }
  for (const k of ['continents', 'countries', 'countryCodes', 'continentCodes', 'cities', 'destinationIds']) {
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

  // v4.59.1: captura label antes do delete pra preservar em flag downstream (CLAUDE.md §13.a).
  let docLabel = null;
  try {
    const s = await getDoc(doc(db, COL_BANK, id));
    if (s.exists()) docLabel = s.data()?.title || null;
  } catch {}

  await deleteDoc(doc(db, COL_BANK, id));

  // v4.59.1 (CLAUDE.md §13.a) — FK cleanup cross-collection.
  // Sem isso: notificações órfãs, ai_usage_logs apontando pra doc inexistente,
  // potencial spam em CF roteiroBankValidityCron (busca expirados → notif).

  // (1) notifications deterministic IDs (bank_expired_${id}_*)
  try {
    const notifSnap = await getDocs(query(
      collection(db, 'notifications'),
      where('entityType', '==', 'roteiro_bank'),
      where('entityId',   '==', id),
      limit(500),
    ));
    if (!notifSnap.empty) {
      const batch = writeBatch(db);
      notifSnap.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (e) {
    console.warn('[deleteRoteiroBank] cleanup notifications falhou:', e?.message);
  }

  // (2) ai_usage_logs (preserva pra audit, só marca refDeleted)
  try {
    const aiSnap = await getDocs(query(
      collection(db, 'ai_usage_logs'),
      where('bankRefId', '==', id),
      limit(500),
    ));
    if (!aiSnap.empty) {
      const batch = writeBatch(db);
      aiSnap.forEach(d => batch.update(d.ref, {
        bankRefId: null,
        bankRefDeleted: true,
        bankRefDeletedAt: serverTimestamp(),
        bankRefDeletedLabel: docLabel,
      }));
      await batch.commit();
    }
  } catch (e) {
    console.warn('[deleteRoteiroBank] cleanup ai_usage_logs falhou:', e?.message);
  }

  // (3) tasks que referenciam (caso exista — schema atual não tem mas defensivo)
  try {
    const taskSnap = await getDocs(query(
      collection(db, 'tasks'),
      where('roteiroBankId', '==', id),
      limit(500),
    ));
    if (!taskSnap.empty) {
      const batch = writeBatch(db);
      taskSnap.forEach(d => batch.update(d.ref, {
        roteiroBankId: null,
        roteiroBankDeleted: true,
        roteiroBankDeletedAt: serverTimestamp(),
        roteiroBankDeletedLabel: docLabel,
      }));
      await batch.commit();
    }
  } catch (e) {
    console.warn('[deleteRoteiroBank] cleanup tasks falhou:', e?.message);
  }
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
  // v4.59.1 (auditoria §7.8): zerar refs Envision na cópia. Senão duplicado
  // referencia MESMA itinerary Envision e sync futuro sobrescreve um deles.
  copy.envision = { ...emptyRoteiroBank().envision };
  copy.source   = { ...(copy.source || {}), type: 'manual' };
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

/* ─── Coleções (Classic, Exclusive, Corporate…) — CRUD v4.50.1+ ─── */

export const DEFAULT_COLLECTIONS = [
  { key: 'classic',   label: 'Classic',   order: 1, color: '#3B82F6', builtin: true },
  { key: 'exclusive', label: 'Exclusive', order: 2, color: '#D4A843', builtin: true },
  { key: 'corporate', label: 'Corporate', order: 3, color: '#10B981', builtin: true },
];

export async function fetchBankCollections() {
  try {
    const snap = await getDocs(query(collection(db, COL_COLLECTIONS), orderBy('order')));
    const docs = snap.docs.map(d => ({ key: d.id, ...d.data() }));
    if (docs.length) return docs;
  } catch (e) {
    console.warn('[fetchBankCollections] falhou:', e.message);
  }
  return DEFAULT_COLLECTIONS;
}

export async function saveBankCollection(key, data) {
  if (!canWrite()) throw new Error('Permissão negada.');
  await setDoc(doc(db, COL_COLLECTIONS, key), {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: uid() || '',
  }, { merge: true });
}

export async function deleteBankCollection(key) {
  if (!canWrite()) throw new Error('Permissão negada.');
  await deleteDoc(doc(db, COL_COLLECTIONS, key));
}

/* ═══════════════════════════════════════════════════════════════
   v4.50.1+ HERO IMAGE: banco_imagens → Unsplash fallback
   ═══════════════════════════════════════════════════════════════ */

/**
 * Resolve hero image URL pra um roteiro_bank.
 *
 * Estratégia (mesma do roteiroEditor / portal_tips):
 *   1. Banco de Imagens PRIMETOUR (`portal_images`) — busca por city+country
 *      filtrando por assetCategory='location' (capa de destino)
 *   2. Fallback: Unsplash via Cloud Function `fetchDestinationPhoto`
 *      (que tem cache de 90d em `photo_cache/{queryKey}`)
 *
 * @param {object} doc — roteiro_bank com `geo.cities[]`
 * @returns {Promise<{url: string|null, source: string|null, attribution?: string}>}
 */
export async function resolveBankHero(doc) {
  const city = doc?.geo?.cities?.[0];
  if (!city?.city) return { url: null, source: null };

  // 1. Banco de Imagens
  try {
    const snap = await getDocs(query(
      collection(db, 'portal_images'),
      where('country', '==', city.country || ''),
      limit(40),
    ));
    const cityKey = slugify(city.city);
    const match = snap.docs.find(d => {
      const data = d.data();
      if (data.assetCategory && data.assetCategory !== 'location') return false;
      return slugify(data.city || '') === cityKey;
    });
    if (match) {
      const data = match.data();
      const url = data.imageUrl || data.url || data.r2Url || null;
      if (url) return { url, source: 'portal_images', attribution: data.copyright || '' };
    }
  } catch (e) { /* segue pro fallback */ }

  // 2. Unsplash via CF (com cache de 90d em photo_cache)
  // v4.58.5: retry chain — query mais específica falha primeiro (Cidade do Cabo,
  // África do Sul), tenta variações progressivamente mais amplas.
  try {
    const { httpsCallable, getFunctions } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
    const { app } = await import('../firebase.js');
    const fn = httpsCallable(getFunctions(app, 'us-central1'), 'fetchDestinationPhoto');
    // Lista de queries em ordem de specificidade (mais → menos)
    const queries = [
      city.city && city.country ? `${city.city}, ${city.country}` : null,  // 1. cidade + país
      city.city || null,                                                    // 2. só cidade
      city.country || null,                                                 // 3. só país
    ].filter(Boolean);
    for (const q of queries) {
      try {
        const res = await fn({ query: q, count: 1 });
        const url = res?.data?.url || null;
        if (url) return { url, source: res?.data?.source || 'unsplash', attribution: res?.data?.attribution || '' };
      } catch (e) {
        // 404/nenhuma foto encontrada — tenta próxima
        if (!/nenhuma foto/i.test(e?.message || '')) throw e;
      }
    }
  } catch (e) { console.warn('[resolveBankHero] Unsplash falhou:', e?.message); }

  return { url: null, source: null };
}

/**
 * Garante hero — se já existe retorna; senão resolve + persiste no doc.
 * Idempotente (não toca hero pré-existente).
 *
 * @returns {Promise<string|null>} URL final do hero
 */
export async function ensureBankHero(id, bankDoc) {
  // v4.58.1: hero precisa ser URL absoluta (não UUID Envision sem prefix).
  const hero = bankDoc?.images?.hero;
  if (hero && (hero.startsWith('http://') || hero.startsWith('https://'))) return hero;
  const { url, source, attribution } = await resolveBankHero(bankDoc);
  if (!url || !id) return url;
  try {
    await setDoc(doc(db, COL_BANK, id), {
      images: { ...(bankDoc.images||{}), hero: url, heroSource: source, heroAttribution: attribution },
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (e) { console.warn('[ensureBankHero] persist falhou:', e.message); }
  return url;
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
