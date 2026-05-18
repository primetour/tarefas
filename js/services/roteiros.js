/**
 * PRIMETOUR — Roteiros de Viagem: Service
 * Firestore CRUD for itineraries, generation tracking, web links
 */

import {
  collection, doc, getDoc, getDocs, setDoc, addDoc,
  updateDoc, deleteDoc, query, where, orderBy,
  serverTimestamp, limit,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';
import { auditLog } from '../auth/audit.js';

/* ─── Collections ─────────────────────────────────────────── */
const COL         = 'roteiros';
const COL_GEN     = 'roteiro_generations';
const COL_LINKS   = 'roteiro_web_links';

/* ─── Constantes ──────────────────────────────────────────── */
export const ROTEIRO_STATUSES = [
  { key: 'draft',    label: 'Rascunho',   color: '#6B7280' },
  { key: 'review',   label: 'Em revisão', color: '#F59E0B' },
  { key: 'sent',     label: 'Enviado',    color: '#3B82F6' },
  { key: 'approved', label: 'Aprovado',   color: '#22C55E' },
  { key: 'archived', label: 'Arquivado',  color: '#9CA3AF' },
];

export const CLIENT_TYPES = [
  { key: 'individual', label: 'Individual' },
  { key: 'couple',     label: 'Casal' },
  { key: 'family',     label: 'Família' },
  { key: 'group',      label: 'Grupo de Amigos' },
];

export const ECONOMIC_PROFILES = [
  { key: 'standard', label: 'Standard' },
  { key: 'premium',  label: 'Premium' },
  { key: 'luxury',   label: 'Luxury' },
];

export const PREFERENCE_OPTIONS = [
  'Gastronomia', 'Cultura', 'Aventura', 'Relaxamento',
  'Compras', 'Natureza', 'Vida Noturna', 'Esportes',
  'Arte', 'História', 'Fotografia', 'Família',
];

export const RESTRICTION_OPTIONS = [
  'Mobilidade reduzida', 'Restrição alimentar', 'Gestante',
  'Idoso', 'Criança de colo', 'Outro',
];

export const CURRENCIES = ['USD', 'BRL', 'EUR', 'GBP'];

/* ─── Presets para Inclui / Não inclui ───────────────────── */
export const INCLUDES_PRESETS = [
  'Hospedagem conforme descrito com café da manhã',
  'Traslados privativos aeroporto/hotel/aeroporto',
  'Passeios privativos com guia em português',
  'Bilhetes de trem conforme descrito',
  'Impostos de remessa internacional (IRRF e IOF)',
  'Seguro viagem',
  'Assistência 24h durante a viagem',
];

export const EXCLUDES_PRESETS = [
  'Passagens aéreas internacionais e taxas de embarque',
  'Traslados e passeios não mencionados',
  'Early check-in / late check-out',
  'Serviços mencionados como opcionais',
  'Despesas com documentação (passaporte, visto)',
  'Despesas pessoais (telefone, lavanderia, gorjetas)',
  'Seguro viagem (se não incluso)',
  'Refeições e bebidas não citadas como incluídas',
];

/* ─── Modelo vazio ────────────────────────────────────────── */
export function emptyRoteiro() {
  const profile = store.get('userProfile');
  return {
    status: 'draft',
    title: '',
    areaId: '',
    consultantId: profile?.uid || '',
    consultantName: profile?.name || '',
    // 4.41.0+ (Sprint 2) — collaboratorIds usado pra dar permissão de
    // edição a outros consultores. Vazio = só o consultantId edita.
    collaboratorIds: [],
    // 4.41.0+ workflowMode controla se o sistema FORÇA o fluxo de status
    // (draft → review → sent → approved). Modo 'offline' = status é só
    // informativo, user gerencia processo fora do sistema.
    workflowMode: 'system',

    client: {
      // Dados do RESPONSÁVEL/contato principal (quem fecha contrato).
      // Informação operacional/legal — não é "passageiro" necessariamente.
      name: '', email: '', phone: '',
      type: 'individual',     // individual | couple | family | group
      preferences: [],
      restrictions: [],
      economicProfile: 'premium',
      notes: '',
      // ── DEPRECATED 4.41.0+ — mantidos pra compat com docs antigos ──
      // Foram substituídos por `travelers[]`. migrateRoteiro converte
      // adults/children/childrenAges → travelers automaticamente no read.
      // Não usar em código novo. Serão removidos em 5.0.
      adults: 1,
      children: 0,
      childrenAges: [],
    },

    /* 4.41.0+ (Sprint 2) — Viajantes individuais.
     *
     * Substitui o agregado adults/children/childrenAges por uma lista
     * estruturada: cada viajante tem nome, idade, doc, papel.
     *
     * Schema de cada item:
     *   {
     *     id:      string,  // uuid local pra reorder/edit stable
     *     name:    string,
     *     age:     number|null,
     *     isLead:  boolean, // o responsável principal (1 por roteiro)
     *     doc:     string,  // CPF / passaporte (opcional)
     *     notes:   string,
     *   }
     */
    travelers: [],

    /* 4.41.0+ (Sprint 2) — Custo interno (margem comercial).
     *
     * Estrutura paralela a `pricing`, mas só visível pra usuários com
     * permission `roteiro_view_cost`. NUNCA renderizado em export pra
     * cliente (PDF/PPT/link público).
     *
     * Schema espelha `pricing` pra facilitar margem calc:
     *   margem% = (pricing - costPricing) / pricing × 100
     */
    costPricing: {
      perPerson: null,
      perCouple: null,
      currency: 'USD',
      notes: '',
      customRows: [],  // { label, value }
    },

    /* 4.43.0+ (Sprint 4) — Integração com módulo de tarefas.
     *
     * Quando o roteiro é APROVADO (status: 'approved') e workflowMode='system',
     * o sistema gera automaticamente N tarefas operacionais (reservar voos,
     * confirmar hotéis, organizar transfers, emitir vouchers, etc.).
     *
     * `linkedTaskIds[]`: IDs gerados pra rastreabilidade bidirecional
     *                    (cada task tem `roteiroId` apontando de volta).
     * `tasksGeneratedAt`: timestamp da PRIMEIRA geração (idempotente). Re-gerar
     *                     com IDs determinísticos não cria duplicatas.
     */
    linkedTaskIds: [],
    tasksGeneratedAt: null,

    /* 4.42.0+ (Sprint 3) — Dicas anexas do Portal de Dicas.
     *
     * Cada item armazena um SNAPSHOT do conteúdo da dica no momento do
     * anexo — garantia de previsibilidade pro cliente (mudanças posteriores
     * na dica original NÃO afetam roteiros já enviados).
     *
     * O user pode "re-publicar" a dica pra puxar a versão atual quando
     * quiser. Detection de divergência (`isStale`) é computada on-read
     * comparando `content.updatedAtSnapshot` com `portal_tips/{tipId}.updatedAt`.
     *
     * Schema:
     *   {
     *     id:        string,    // uuid local pro UI (reorder, edit stable)
     *     tipId:     string,    // doc id em portal_tips
     *     title:     string,    // snapshot do título (city/country)
     *     subtitle:  string,    // continent
     *     snapshotAt: timestamp,// quando foi anexada/re-publicada
     *     content: {
     *       city, country, continent: string,
     *       segments: { [segmentKey]: array },  // mesmo formato de portal_tips
     *       updatedAtSnapshot: timestamp,       // updatedAt da tip no momento
     *     },
     *   }
     */
    embeddedTips: [],

    travel: {
      startDate: '',
      endDate: '',
      nights: 0,
      destinations: [],
    },

    days: [],

    hotels: [],

    pricing: {
      perPerson: null,
      perCouple: null,
      currency: 'USD',
      validUntil: '',
      disclaimer: 'Este roteiro é uma sugestão e pode ser totalmente adequado para atender às suas expectativas. Os valores expressam apenas uma cotação e serão fixados somente no ato da confirmação de reservas.',
      customRows: [],
    },

    optionals: [],

    includes: [],
    excludes: [],

    payment: {
      deposit: '',
      installments: '',
      deadline: '',
      notes: '',
    },

    cancellation: [],

    importantInfo: {
      passport: '',
      visa: '',
      vaccines: '',
      climate: '',
      luggage: '',
      flights: '',
      customFields: [],
    },

    /* Imagens — racional do Portal de Dicas:
     *   - hero: imagem da capa (auto se vazio)
     *   - overrides: { 'city_<slug>': url, 'hotel_<idx>': url, hero: url }
     *     User escolhe manualmente no editor; vence sempre sobre auto-fetch.
     *   - Auto-fetch (Unsplash → Wikipedia) só pra slots SEM override.
     */
    images: {
      hero: null,
      overrides: {},
    },
  };
}

/* ─── Gerar dias automaticamente ──────────────────────────── */
export function generateDays(startDate, destinations) {
  if (!startDate || !destinations.length) return [];
  const days = [];
  const start = new Date(startDate + 'T12:00:00');
  let dayNum = 0;

  for (const dest of destinations) {
    for (let n = 0; n < (dest.nights || 1) + (dest === destinations[destinations.length - 1] ? 1 : 0); n++) {
      // Last destination gets +1 day for departure
      if (dest !== destinations[destinations.length - 1] && n >= dest.nights) break;
      const date = new Date(start);
      date.setDate(date.getDate() + dayNum);
      days.push({
        dayNumber: dayNum + 1,
        date: date.toISOString().split('T')[0],
        title: '',
        city: dest.city || dest.country,
        narrative: '',
        activities: [],
        overnightCity: n < dest.nights ? (dest.city || dest.country) : '',
        imageIds: [],
      });
      dayNum++;
    }
  }
  return days;
}

/* ─── Migrations on-read (4.41.0+ Sprint 2) ────────────────
 *
 * Roteiros antigos têm `client.{adults,children,childrenAges}` mas não
 * têm `travelers[]`. Pra manter compat sem precisar rodar backfill
 * imediato, convertemos no momento da leitura — defensivo e idempotente.
 *
 * Roteiros novos já são salvos com travelers populados pela UI.
 */
function _stableId(prefix, idx) {
  return `${prefix}-${idx}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Converte client.{adults,children,childrenAges} → travelers[].
 * Mantém os campos legacy intactos (não-destrutivo no client).
 * @returns {Array} travelers (novo array; nunca undefined)
 */
export function deriveTravelersFromLegacyClient(client) {
  const c = client || {};
  const adults = Math.max(0, parseInt(c.adults) || 0);
  const children = Math.max(0, parseInt(c.children) || 0);
  const ages = Array.isArray(c.childrenAges) ? c.childrenAges : [];
  const out = [];

  // Primeiro adulto = lead (responsável); usa client.name se disponível.
  if (adults > 0) {
    out.push({
      id:     _stableId('lead', 0),
      name:   (c.name || '').trim(),
      age:    null,
      isLead: true,
      doc:    '',
      notes:  'Responsável',
    });
    for (let i = 1; i < adults; i++) {
      out.push({
        id:     _stableId('adulto', i),
        name:   '',
        age:    null,
        isLead: false,
        doc:    '',
        notes:  'Adulto',
      });
    }
  }

  for (let i = 0; i < children; i++) {
    const age = parseInt(ages[i]);
    out.push({
      id:     _stableId('crianca', i),
      name:   '',
      age:    Number.isFinite(age) ? age : null,
      isLead: false,
      doc:    '',
      notes:  'Criança',
    });
  }

  return out;
}

/**
 * Aplica migrations idempotentes a um doc bruto de roteiro.
 * Roda no read — não escreve no Firestore (escrita acontece quando o
 * user editar e salvar pela UI).
 */
function migrateRoteiroOnRead(doc) {
  if (!doc) return doc;
  const out = { ...doc };

  // travelers[]: deriva de adults/children/childrenAges se ausente
  if (!Array.isArray(out.travelers) || out.travelers.length === 0) {
    out.travelers = deriveTravelersFromLegacyClient(out.client);
  }

  // collaboratorIds: garantir array
  if (!Array.isArray(out.collaboratorIds)) out.collaboratorIds = [];

  // workflowMode: default 'system' (comportamento prévio)
  if (out.workflowMode !== 'offline') out.workflowMode = 'system';

  // costPricing: garantir shape mínimo
  if (!out.costPricing || typeof out.costPricing !== 'object') {
    out.costPricing = { perPerson: null, perCouple: null, currency: 'USD', notes: '', customRows: [] };
  } else {
    out.costPricing = {
      perPerson:   out.costPricing.perPerson   ?? null,
      perCouple:   out.costPricing.perCouple   ?? null,
      currency:    out.costPricing.currency    || 'USD',
      notes:       out.costPricing.notes       || '',
      customRows:  Array.isArray(out.costPricing.customRows) ? out.costPricing.customRows : [],
    };
  }

  // 4.42.0+ (Sprint 3) embeddedTips: garantir array
  if (!Array.isArray(out.embeddedTips)) out.embeddedTips = [];

  // 4.43.0+ (Sprint 4) linkedTaskIds + tasksGeneratedAt
  if (!Array.isArray(out.linkedTaskIds)) out.linkedTaskIds = [];
  if (out.tasksGeneratedAt === undefined) out.tasksGeneratedAt = null;

  return out;
}

/* ─── 4.42.0+ (Sprint 3) Embed de dicas do Portal ──────────
 *
 * Anexa uma dica do Portal de Dicas ao roteiro fazendo SNAPSHOT do
 * conteúdo atual. Snapshot fica em `embeddedTips[]` do doc do roteiro.
 *
 * Por que snapshot:
 *   - Cliente recebe link/PDF com versão estável da dica
 *   - Mudanças posteriores na dica original (admin reorganizou, removeu
 *     restaurante etc.) NÃO mudam o que cliente já viu — previsibilidade
 *   - User pode chamar `republishEmbeddedTip` quando quiser atualizar
 */
export async function snapshotTipForEmbed(tipId) {
  const snap = await getDoc(doc(db, 'portal_tips', tipId));
  if (!snap.exists()) throw new Error('Dica não encontrada (pode ter sido removida).');
  const tip = snap.data();
  const updatedAtSnapshot = tip.updatedAt || tip.createdAt || null;
  // Pega apenas o que importa pra render — sem metadata interna (_geo
  // pode ser pesado, deixamos só se já está no snapshot).
  const content = {
    city:              tip.city || '',
    country:           tip.country || '',
    continent:         tip.continent || '',
    segments:          tip.segments || {},
    updatedAtSnapshot, // ref pra detect stale
  };
  return {
    id:         'emb-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    tipId,
    title:      `${tip.city || ''}${tip.country ? ', ' + tip.country : ''}`.trim() || '(sem destino)',
    subtitle:   tip.continent || '',
    snapshotAt: new Date(),
    content,
  };
}

/**
 * Verifica se uma dica anexada está "stale" — i.e., a versão atual no
 * portal é mais nova que o snapshot. Usado no editor pra mostrar badge
 * "atualizada disponível".
 *
 * Retorna false se não conseguir ler a tip (sem badge — assume up-to-date
 * pra não dar falso alarme).
 */
export async function isEmbeddedTipStale(embedded) {
  if (!embedded?.tipId) return false;
  try {
    const snap = await getDoc(doc(db, 'portal_tips', embedded.tipId));
    if (!snap.exists()) return false;
    const live = snap.data();
    const liveTs = live.updatedAt?.toMillis?.() || 0;
    const snapTs = embedded.content?.updatedAtSnapshot?.toMillis?.() || 0;
    // Stale = live é mais nova que snapshot (delta > 1s pra evitar flutter)
    return liveTs - snapTs > 1000;
  } catch (_) {
    return false;
  }
}

/* ─── CRUD ────────────────────────────────────────────────── */

/**
 * 4.40.31+ (Sprint 1) — fetch SEMPRE todos os roteiros. Hierarquia é
 * aplicada NA PÁGINA via getVisibleUserIds() — mesmo padrão de /goals
 * e /feedbacks. Antes filtrava por consultantId server-side, o que
 * impedia gerentes de ver roteiros dos seus subordinados.
 *
 * Volume de roteiros é pequeno (~centenas) então o custo de fetch+filter
 * client-side é aceitável. Se chegar a milhares, repensar com paginação.
 */
export async function fetchRoteiros(filters = {}) {
  const constraints = [orderBy('updatedAt', 'desc')];
  if (filters.status) constraints.unshift(where('status', '==', filters.status));
  if (filters.limit)  constraints.push(limit(filters.limit));

  const q = query(collection(db, COL), ...constraints);
  const snap = await getDocs(q);
  // 4.41.0+ aplicar migrations on-read defensivas
  return snap.docs.map(d => migrateRoteiroOnRead({ id: d.id, ...d.data() }));
}

export async function fetchRoteiro(id) {
  const snap = await getDoc(doc(db, COL, id));
  if (!snap.exists()) throw new Error('Roteiro não encontrado');
  // 4.41.0+ aplicar migrations on-read defensivas
  return migrateRoteiroOnRead({ id: snap.id, ...snap.data() });
}

export async function saveRoteiro(id, data) {
  const uid = store.get('currentUser')?.uid || '';
  const now = serverTimestamp();

  if (id) {
    // Editar: dono pode sempre; gerentes podem editar todos
    const existing = await fetchRoteiro(id).catch(() => null);
    const isOwner = existing && existing.consultantId === uid;
    if (!store.canManageRoteiros() && !isOwner) {
      throw new Error('Permissão negada: você não pode editar este roteiro.');
    }
    await updateDoc(doc(db, COL, id), {
      ...data,
      updatedAt: now,
      updatedBy: uid,
    });
    auditLog('roteiro.update', 'roteiro', id, {
      title: data.title || existing?.title || '',
      fields: Object.keys(data),
    }).catch(() => {});
    return id;
  } else {
    if (!store.canCreateRoteiro()) {
      throw new Error('Permissão negada: você não pode criar roteiros.');
    }
    const ref = await addDoc(collection(db, COL), {
      ...data,
      createdAt: now,
      createdBy: uid,
      updatedAt: now,
      updatedBy: uid,
    });
    auditLog('roteiro.create', 'roteiro', ref.id, {
      title: data.title || '',
      clientName: data.clientName || '',
      destinations: Array.isArray(data.destinations) ? data.destinations.slice(0,5) : [],
    }).catch(() => {});
    return ref.id;
  }
}

export async function deleteRoteiro(id) {
  const uid = store.get('currentUser')?.uid || '';
  const existing = await fetchRoteiro(id).catch(() => null);
  const isOwner = existing && existing.consultantId === uid;
  if (!store.canManageRoteiros() && !isOwner) {
    throw new Error('Permissão negada: você não pode excluir este roteiro.');
  }
  await deleteDoc(doc(db, COL, id));
  auditLog('roteiro.delete', 'roteiro', id, {
    title: existing?.title || '',
  }).catch(() => {});
}

export async function updateRoteiroStatus(id, status) {
  const uid = store.get('currentUser')?.uid || '';
  const existing = await fetchRoteiro(id).catch(() => null);
  const isOwner = existing && existing.consultantId === uid;
  if (!store.canManageRoteiros() && !isOwner) {
    throw new Error('Permissão negada: você não pode alterar o status deste roteiro.');
  }

  const prevStatus = existing?.status;
  const extra = {};
  if (status === 'sent') extra.sentAt = serverTimestamp();
  if (status === 'archived') extra.archivedAt = serverTimestamp();

  await updateDoc(doc(db, COL, id), {
    status,
    ...extra,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
  // Audit do status change. Especial pra archive/restore (severity warn)
  const action = status === 'archived' ? 'roteiro.archive'
              : prevStatus === 'archived' && status !== 'archived' ? 'roteiro.restore'
              : 'roteiro.status_change';
  auditLog(action, 'roteiro', id, {
    title: existing?.title || '',
    statusFrom: prevStatus,
    statusTo: status,
  }).catch(() => {});
}

/* ─── Duplicar roteiro ────────────────────────────────────── */
export async function duplicateRoteiro(id) {
  if (!store.canCreateRoteiro()) {
    throw new Error('Permissão negada: você não pode duplicar roteiros.');
  }
  const original = await fetchRoteiro(id);
  delete original.id;
  const profile = store.get('userProfile');
  return saveRoteiro(null, {
    ...original,
    title: `${original.title} (cópia)`,
    status: 'draft',
    consultantId: profile?.uid || original.consultantId,
    consultantName: profile?.name || original.consultantName,
    sentAt: null,
    archivedAt: null,
  });
}

/* ─── Generation tracking ─────────────────────────────────── */
export async function recordGeneration({ roteiroId, format, areaId, destinations }) {
  await addDoc(collection(db, COL_GEN), {
    roteiroId,
    format,
    areaId: areaId || '',
    destinations: destinations || [],
    generatedBy: store.get('currentUser')?.uid || '',
    generatedAt: serverTimestamp(),
  });
}

export async function fetchGenerations(filters = {}) {
  const constraints = [orderBy('generatedAt', 'desc')];
  if (filters.limit) constraints.push(limit(filters.limit));
  const q = query(collection(db, COL_GEN), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ─── Web links ───────────────────────────────────────────── */
/**
 * 4.41.0+ (Sprint 2) — STRIP DEFENSIVO de campos internos antes do snapshot.
 *
 * O snapshot vai pra coleção `roteiro_web_links` com regra de read PÚBLICA
 * (qualquer holder do token vê). Se gravarmos custo interno aqui, vaza pro
 * cliente independente de qualquer filtro no renderer.
 *
 * Mesma lógica do stripInternalFields em roteiroGenerator.js — duplicada
 * intencionalmente aqui pra evitar import cíclico com generator (que é heavy).
 */
function stripInternalForPublicLink(roteiro) {
  if (!roteiro || typeof roteiro !== 'object') return roteiro;
  const out = JSON.parse(JSON.stringify(roteiro));
  out.costPricing = { perPerson: null, perCouple: null, currency: 'USD', notes: '', customRows: [] };
  delete out.collaboratorIds;
  delete out.workflowMode;
  // 4.43.0+ Sprint 4 — tarefas vinculadas são internals (operacional)
  delete out.linkedTaskIds;
  delete out.tasksGeneratedAt;
  delete out.aiPrompt;
  delete out.aiSources;
  delete out.aiProvider;
  delete out.aiModel;
  return out;
}

export async function createWebLink(roteiroId, data, area) {
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  // 4.41.0+ Strip OBRIGATÓRIO — custo interno nunca vai pra link público.
  const cleanData = stripInternalForPublicLink(data);

  // 4.46.2+ (Sprint 5 fix) — enriquece imagens ANTES do snapshot.
  // Antes: snapshot tinha só `images.hero` (que ficava null se user não setou
  // manualmente) e a página pública não renderizava capa nenhuma. Agora salva
  // URLs resolvidas (banco + Unsplash fallback com dedup) num campo
  // `enrichedImages` dedicado pro web view consumir.
  try {
    const { enrichRoteiroImages } = await import('./roteiroGenerator.js');
    const enriched = await enrichRoteiroImages(cleanData);
    cleanData.enrichedImages = {
      heroUrl: enriched.heroUrl || null,
      byCity:  enriched.byCity || {},
      byHotel: enriched.byHotel || {},
    };
  } catch (e) {
    console.warn('[roteiros.createWebLink] enrichImages falhou:', e.message);
    // Não bloqueia — snapshot vai sem enriched (page mostra hero gradient apenas)
  }

  await setDoc(doc(db, COL_LINKS, token), {
    roteiroId,
    data: cleanData,
    area: area || null,
    createdBy: store.get('currentUser')?.uid || '',
    createdAt: serverTimestamp(),
    viewCount: 0,
  });
  return token;
}

export async function fetchWebLink(token) {
  const snap = await getDoc(doc(db, COL_LINKS, token));
  if (!snap.exists()) return null;
  return { token: snap.id, ...snap.data() };
}

/* ─── Clientes recentes (autocomplete) ────────────────────── */
export async function fetchRecentClients(maxResults = 20) {
  const uid = store.get('currentUser')?.uid;
  if (!uid) return [];
  const q = query(
    collection(db, COL),
    where('consultantId', '==', uid),
    orderBy('updatedAt', 'desc'),
    limit(maxResults),
  );
  const snap = await getDocs(q);
  const seen = new Set();
  const clients = [];
  snap.docs.forEach(d => {
    const c = d.data().client;
    if (c?.name && !seen.has(c.name.toLowerCase())) {
      seen.add(c.name.toLowerCase());
      clients.push(c);
    }
  });
  return clients;
}

/* ─── Stats para dashboard ────────────────────────────────── */
export async function fetchRoteiroStats() {
  const q = query(collection(db, COL), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ════════════════════════════════════════════════════════════
   IA — Gerar roteiro completo a partir de prompt livre
   ════════════════════════════════════════════════════════════ */

/**
 * Gera um roteiro completo via IA a partir de descrição em texto livre.
 * @param {string} userPrompt - Descrição livre do roteiro desejado
 * @returns {Promise<Object>} Objeto roteiro preenchido pela IA
 */
export async function generateRoteiroFromPrompt(userPrompt) {
  if (!userPrompt?.trim()) throw new Error('Descrição do roteiro é obrigatória.');

  const { chatWithAI, fetchSkillsForModule, runSkill } = await import('./ai.js');

  const today = new Date().toISOString().split('T')[0];
  const profile = store.get('userProfile');

  // ── 1. Web Search: buscar referências de turismo luxury ──
  let webResults = [];
  let webResearchSection = '';
  try {
    const { searchWeb } = await import('./aiActions.js');

    // Extrair APENAS destino/palavras-chave do prompt (máx 60 chars, sem ruído)
    const destQuery = userPrompt
      .substring(0, 200)
      .replace(/[^\w\sáéíóúâêîôûãõçÀ-ú,.-]/g, '')
      .replace(/\b(quero|quer|gostaria|preciso|dias|noites|casal|familia|grupo|jovem|adulto|criança|viagem|roteiro|passar|todos|principais|destino)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .substring(0, 60);

    console.log('[Roteiro IA] Busca web destino:', destQuery);

    // Fazer 2 buscas paralelas: hotéis + experiências (queries curtas e focadas)
    const [hotelsSearch, expSearch] = await Promise.allSettled([
      searchWeb(`melhores hotéis luxo ${destQuery}`),
      searchWeb(`melhores restaurantes experiências ${destQuery}`),
    ]);

    // searchWeb retorna array direto, NÃO { results: [] }
    const hotelResults = hotelsSearch.status === 'fulfilled' ? (hotelsSearch.value || []) : [];
    const expResults = expSearch.status === 'fulfilled' ? (expSearch.value || []) : [];
    webResults = [...hotelResults.slice(0, 5), ...expResults.slice(0, 5)];
    console.log(`[Roteiro IA] Web search: ${hotelResults.length} hotéis, ${expResults.length} experiências`);

    if (webResults.length) {
      webResearchSection = '\n\n=== PESQUISA WEB — FONTES LUXURY (use estes dados para enriquecer o roteiro) ===\n' +
        webResults.map((r, i) =>
          `[${i+1}] ${r.title || ''}\n    ${r.snippet || ''}\n    Fonte: ${r.url || r.source || 'N/A'}`
        ).join('\n\n') +
        '\n=== FIM DA PESQUISA ===';
    }
  } catch (e) {
    console.warn('[Roteiro IA] Web search indisponível:', e.message || e);
  }

  // ── 2. System prompt — base hardcoded (fallback) + agent IA Hub override ──
  let customHint = '';
  try {
    const { getModuleHint } = await import('./aiModuleHints.js');
    const hint = await getModuleHint('roteiros');
    if (typeof hint === 'string' && hint.trim()) customHint = hint;
  } catch (_) { /* serviço indisponível */ }

  // Carrega agent "roteiro-generator" do IA Hub. Se existir, usa o systemPrompt,
  // model e temperature dele (single source of truth gerenciado pelo admin).
  // Se não existir (ex: ambiente novo sem seed rodado), usa defaults hardcoded.
  let agentConfig = null;
  try {
    const { fetchAgents } = await import('./agents.js');
    const all = await fetchAgents();
    agentConfig = all.find(a =>
      a.module === 'roteiros' && a.active !== false &&
      (a.migratedFrom?.systemSeed === 'roteiro-generator' ||
       a.seedId === 'roteiro-generator' ||
       /roteiro/i.test(a.name || ''))
    );
  } catch (_) { /* IA Hub indisponível, segue com fallback */ }

  // Direção criativa: vem do agent IA Hub se existir, senão do hardcoded
  const baseSystemPrompt = agentConfig?.systemPrompt || `Consultor sênior PRIMETOUR. Crie roteiro COMPLETO como PROPOSTA COMERCIAL. Hoje: ${today}. Sem data mencionada → planeje a partir de +45 dias.

ESCRITA: Narrativas imersivas/sensoriais (aromas, texturas, emoções). Tom sofisticado-acolhedor. 1ª pessoa plural. Cada dia: 200+ palavras. NOMES REAIS de restaurantes, bares, mercados, pratos típicos. Seja ESPECÍFICO (não "explorar a cidade" → "cruzar a Ponte Vecchio ao pôr do sol").

ATIVIDADES: 5-7/dia com horário realista. Incluir café, almoço, jantar (nome do restaurante), tempo livre. Types: "passeio"|"refeição"|"transfer"|"livre".

HOTÉIS: Apenas hotéis REAIS. Luxury: Four Seasons, Aman, Belmond, Mandarin Oriental. Premium: Relais & Châteaux, SLH. Categoria real do quarto.

PREÇOS: TODOS null. NUNCA invente valores. pricing.perPerson=null, perCouple=null, optionals[].priceAdult=null, priceChild=null, customRows=[].

INFO: passport (validade, páginas), visa (regras brasileiros), vaccines, climate (temperaturas período), luggage (roupa, adaptadores, moeda), flights (companhias, tempo voo).`;

  // Sempre append: data atual + hint customizado + obrigatoriedade de JSON + web research
  // (agent.systemPrompt cuida só da direção criativa; estrutura de saída é
  //  responsabilidade desta função — JSON é parseado/validado aqui).
  const systemPrompt = `${baseSystemPrompt}

CONTEXTO: Hoje é ${today}.
${customHint ? '\n=== INSTRUÇÕES CUSTOMIZADAS (Prompts por Módulo) ===\n' + customHint + '\n=== FIM ===\n' : ''}
Responda EXCLUSIVAMENTE com JSON válido, sem texto/markdown ao redor:
{"title":"","aiSources":["fonte1"],"client":{"name":"","email":"","phone":"","type":"couple|individual|family|group","adults":2,"children":0,"childrenAges":[],"preferences":[],"restrictions":[],"economicProfile":"standard|premium|luxury","notes":""},"travel":{"startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","nights":0,"destinations":[{"city":"","country":"","nights":0}]},"days":[{"dayNumber":1,"date":"YYYY-MM-DD","title":"","city":"","narrative":"200+ palavras","activities":[{"time":"HH:MM","description":"","type":"passeio"}],"overnightCity":""}],"hotels":[{"city":"","hotelName":"","roomType":"","regime":"","checkIn":"YYYY-MM-DD","checkOut":"YYYY-MM-DD","nights":0}],"pricing":{"perPerson":null,"perCouple":null,"currency":"USD","validUntil":"YYYY-MM-DD","disclaimer":"Valores sob consulta.","customRows":[]},"optionals":[{"service":"","priceAdult":null,"priceChild":null,"notes":""}],"includes":["item1"],"excludes":["item1"],"payment":{"deposit":"30% no ato","installments":"Até 6x sem juros","deadline":"45 dias antes","notes":""},"cancellation":[{"period":"Até 60 dias","penalty":"Sem custo"},{"period":"59-30 dias","penalty":"50%"},{"period":"29-15 dias","penalty":"75%"},{"period":"<15 dias/no-show","penalty":"100%"}],"importantInfo":{"passport":"","visa":"","vaccines":"","climate":"","luggage":"","flights":"","customFields":[]}}${webResearchSection}`;

  // ── 3. Chamar IA — com fallback automático de provider ──
  // Provider/modelo/temperature vem do agent IA Hub se existir, senão defaults.
  let result;
  const aiOpts = {
    moduleId: 'roteiros',
    systemPrompt,
    maxTokens: agentConfig?.limits?.maxTokensPerRun || 8192,
    temperature: agentConfig?.limits?.temperature ?? 0.8,
    ...(agentConfig?.provider ? { provider: agentConfig.provider } : {}),
    ...(agentConfig?.model ? { model: agentConfig.model } : {}),
  };

  try {
    const skills = await fetchSkillsForModule('roteiros').catch(() => []);
    const createSkill = skills.find(s =>
      s.name?.toLowerCase().includes('criar') ||
      s.name?.toLowerCase().includes('gerar') ||
      s.name?.toLowerCase().includes('create')
    );

    if (createSkill) {
      result = await runSkill(createSkill.id, {
        userPrompt, today, consultantName: profile?.name,
        webResearch: webResearchSection,
      });
    } else {
      try {
        result = await chatWithAI(userPrompt, {}, aiOpts);
      } catch (firstErr) {
        // Se Groq falhar por TPM/tamanho, tentar com Gemini (sem custo e aceita prompts grandes)
        const msg = firstErr.message || '';
        if (msg.includes('too large') || msg.includes('Limit') || msg.includes('TPM') || msg.includes('token')) {
          console.warn('[Roteiro IA] Provider primário falhou por limite de tokens, tentando Gemini...');
          result = await chatWithAI(userPrompt, {}, { ...aiOpts, provider: 'gemini' });
        } else {
          throw firstErr;
        }
      }
    }
  } catch (e) {
    console.error('[Roteiro IA] Erro na chamada IA:', e);
    throw new Error('Falha ao gerar roteiro via IA: ' + (e.message || e));
  }

  // ── 4. Parsear resposta JSON ──
  const text = result?.text || result?.content || '';
  try {
    // Limpar markdown wrappers se presentes
    let cleanText = text.trim();
    cleanText = cleanText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');

    // Extrair JSON — pegar o maior bloco JSON possível
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON não encontrado na resposta da IA.');

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      // Tentar corrigir JSON truncado (response cortada por maxTokens)
      let fixedJson = jsonMatch[0];
      // Fechar arrays e objetos abertos
      const opens = (fixedJson.match(/[{[]/g) || []).length;
      const closes = (fixedJson.match(/[}\]]/g) || []).length;
      for (let i = 0; i < opens - closes; i++) {
        fixedJson += fixedJson.lastIndexOf('[') > fixedJson.lastIndexOf('{') ? ']' : '}';
      }
      // Remover trailing comma antes de } ou ]
      fixedJson = fixedJson.replace(/,\s*([}\]])/g, '$1');
      parsed = JSON.parse(fixedJson);
    }

    // Merge com template vazio para garantir estrutura completa
    const base = emptyRoteiro();
    const roteiro = deepMergeRoteiro(base, parsed);
    roteiro.aiGenerated = true;
    roteiro.aiPrompt = userPrompt.substring(0, 500);

    // Gravar fontes consultadas (para backoffice)
    roteiro.aiSources = parsed.aiSources || webResults.map(r => r.link || r.source).filter(Boolean);
    roteiro.aiProvider = result?.provider || 'unknown';
    roteiro.aiModel = result?.model || 'unknown';

    // Garantir que preços NÃO foram inventados pela IA
    if (roteiro.pricing) {
      roteiro.pricing.perPerson = null;
      roteiro.pricing.perCouple = null;
      roteiro.pricing.customRows = [];
      if (!roteiro.pricing.disclaimer || roteiro.pricing.disclaimer.length < 10) {
        roteiro.pricing.disclaimer = 'Valores sob consulta. Cotação personalizada será enviada após confirmação do roteiro e disponibilidade hoteleira.';
      }
    }
    if (roteiro.optionals?.length) {
      roteiro.optionals.forEach(o => { o.priceAdult = null; o.priceChild = null; });
    }

    return roteiro;
  } catch (e) {
    console.error('[Roteiro IA] Erro ao parsear:', e, '\nResposta (primeiros 800 chars):', text.substring(0, 800));
    throw new Error('Não foi possível interpretar a resposta da IA. Tente reformular sua descrição.');
  }
}

/** Merge profundo: base garante estrutura, parsed sobrescreve com dados da IA */
function deepMergeRoteiro(base, parsed) {
  const result = { ...base };

  // Campos simples
  if (parsed.title) result.title = parsed.title;
  if (parsed.status) result.status = parsed.status;

  // Client
  if (parsed.client && typeof parsed.client === 'object') {
    result.client = { ...result.client, ...parsed.client };
    result.client.childrenAges = Array.isArray(parsed.client.childrenAges) ? parsed.client.childrenAges : result.client.childrenAges;
    result.client.preferences = Array.isArray(parsed.client.preferences) ? parsed.client.preferences : result.client.preferences;
    result.client.restrictions = Array.isArray(parsed.client.restrictions) ? parsed.client.restrictions : result.client.restrictions;
  }

  // Travel
  if (parsed.travel && typeof parsed.travel === 'object') {
    result.travel = { ...result.travel, ...parsed.travel };
    result.travel.destinations = Array.isArray(parsed.travel.destinations) ? parsed.travel.destinations : result.travel.destinations;
  }

  // Arrays diretos
  if (Array.isArray(parsed.days) && parsed.days.length) result.days = parsed.days;
  if (Array.isArray(parsed.hotels) && parsed.hotels.length) result.hotels = parsed.hotels;
  if (Array.isArray(parsed.optionals) && parsed.optionals.length) result.optionals = parsed.optionals;
  if (Array.isArray(parsed.includes) && parsed.includes.length) result.includes = parsed.includes;
  if (Array.isArray(parsed.excludes) && parsed.excludes.length) result.excludes = parsed.excludes;
  if (Array.isArray(parsed.cancellation) && parsed.cancellation.length) result.cancellation = parsed.cancellation;

  // Pricing
  if (parsed.pricing && typeof parsed.pricing === 'object') {
    result.pricing = { ...result.pricing, ...parsed.pricing };
    result.pricing.customRows = Array.isArray(parsed.pricing.customRows) ? parsed.pricing.customRows : result.pricing.customRows;
  }

  // Payment
  if (parsed.payment && typeof parsed.payment === 'object') {
    result.payment = { ...result.payment, ...parsed.payment };
  }

  // Important Info
  if (parsed.importantInfo && typeof parsed.importantInfo === 'object') {
    result.importantInfo = { ...result.importantInfo, ...parsed.importantInfo };
    result.importantInfo.customFields = Array.isArray(parsed.importantInfo.customFields) ? parsed.importantInfo.customFields : result.importantInfo.customFields;
  }

  return result;
}
