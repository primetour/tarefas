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

    client: {
      name: '', email: '', phone: '',
      type: 'couple',
      adults: 2,
      children: 0,
      childrenAges: [],
      preferences: [],
      restrictions: [],
      economicProfile: 'premium',
      notes: '',
    },

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

/* ─── CRUD ────────────────────────────────────────────────── */

export async function fetchRoteiros(filters = {}) {
  const constraints = [orderBy('updatedAt', 'desc')];

  if (filters.status) {
    constraints.unshift(where('status', '==', filters.status));
  }

  // Non-managers only see their own
  if (!store.canManageRoteiros()) {
    const uid = store.get('currentUser')?.uid;
    if (uid) constraints.unshift(where('consultantId', '==', uid));
  }

  if (filters.limit) {
    constraints.push(limit(filters.limit));
  }

  const q = query(collection(db, COL), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchRoteiro(id) {
  const snap = await getDoc(doc(db, COL, id));
  if (!snap.exists()) throw new Error('Roteiro não encontrado');
  return { id: snap.id, ...snap.data() };
}

export async function saveRoteiro(id, data) {
  const uid = store.get('currentUser')?.uid || '';
  const now = serverTimestamp();

  if (id) {
    await updateDoc(doc(db, COL, id), {
      ...data,
      updatedAt: now,
      updatedBy: uid,
    });
    return id;
  } else {
    const ref = await addDoc(collection(db, COL), {
      ...data,
      createdAt: now,
      createdBy: uid,
      updatedAt: now,
      updatedBy: uid,
    });
    return ref.id;
  }
}

export async function deleteRoteiro(id) {
  await deleteDoc(doc(db, COL, id));
}

export async function updateRoteiroStatus(id, status) {
  const extra = {};
  if (status === 'sent') extra.sentAt = serverTimestamp();
  if (status === 'archived') extra.archivedAt = serverTimestamp();

  await updateDoc(doc(db, COL, id), {
    status,
    ...extra,
    updatedAt: serverTimestamp(),
    updatedBy: store.get('currentUser')?.uid || '',
  });
}

/* ─── Duplicar roteiro ────────────────────────────────────── */
export async function duplicateRoteiro(id) {
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
export async function createWebLink(roteiroId, data, area) {
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  await setDoc(doc(db, COL_LINKS, token), {
    roteiroId,
    data,
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

  // ── 1. Web Search: buscar em fontes de turismo luxury ──
  const LUXURY_SITES = [
    'virtuoso.com',
    'telegraph.co.uk/travel',
    'nytimes.com/section/travel',
    'cntraveler.com',
    'travelandleisure.com',
    'elitetraveler.com',
    'luxurytravelmagazine.com',
    'monocle.com',
    'ft.com/htsi',
    'corriere.it',
  ];

  let webResearchContext = '';
  try {
    const { searchWeb } = await import('./aiActions.js');

    // Extrair destinos do prompt para busca
    const destQuery = userPrompt.substring(0, 150);
    const searchResults = await searchWeb(
      `luxury travel itinerary ${destQuery} best hotels restaurants experiences`,
      LUXURY_SITES
    );

    if (searchResults?.results?.length) {
      webResearchContext = '\n\nPESQUISA WEB (fontes especializadas em turismo luxury):\n' +
        searchResults.results.slice(0, 8).map((r, i) =>
          `[${i+1}] ${r.title || ''} — ${r.snippet || ''} (${r.source || r.link || ''})`
        ).join('\n');
    }
  } catch (e) {
    console.warn('[Roteiro IA] Web search indisponível, continuando sem pesquisa:', e.message || e);
  }

  // ── 2. System prompt robusto ──
  const systemPrompt = `Você é um consultor de viagens sênior da PRIMETOUR, agência premium de turismo.
Crie um roteiro de viagem COMPLETO e PROFISSIONAL baseado na solicitação.

ESTE ROTEIRO SERVE COMO ORÇAMENTO PARA O CLIENTE. Deve ser completo em TODAS as seções.

REGRAS OBRIGATÓRIAS:
- Use nomes REAIS de hotéis, restaurantes e atrações que existam de fato
- Se dados de pesquisa web estiverem disponíveis abaixo, USE-OS para recomendar hotéis e experiências
- Narrativas de cada dia: 150-250 palavras, tom imersivo, 1ª pessoa do plural ("Começamos o dia...")
- Atividades com horários realistas (café 07:30, check-in 15h, jantar 19:30, etc.)
- Mínimo 4-6 atividades por dia
- Data de hoje: ${today}
- Se nenhuma data for informada, use datas a partir de 30 dias de hoje
- Preencha TODOS os campos — este é um documento comercial completo

REGRAS DE PREÇOS (CRÍTICO):
- NÃO INVENTE valores de preços. Preços são SEMPRE definidos pelo consultor.
- pricing.perPerson = null, pricing.perCouple = null (o consultor preenche depois)
- pricing.disclaimer = "Valores sob consulta. Cotação personalizada será enviada após confirmação do roteiro."
- optionals: priceAdult = null, priceChild = null (consultor define)
- Em customRows, NÃO adicione linhas com valores inventados

SEÇÕES OBRIGATÓRIAS (preencha TODAS):
1. client: inferir tipo (couple/family/group/individual), perfil econômico, preferências
2. travel: destinos com noites, datas calculadas corretamente
3. days: TODOS os dias, com narrativa completa, atividades detalhadas, cidade pernoite
4. hotels: hotel REAL para cada cidade (nome, categoria, regime, datas check-in/out)
5. includes: mínimo 5 itens (hospedagem, café, transfers, seguro, passeios, etc.)
6. excludes: mínimo 5 itens (aéreo, refeições não mencionadas, extras, gorjetas, etc.)
7. payment: termos padrão
8. cancellation: 4 faixas padrão
9. importantInfo: passaporte, visto, vacinas, clima, bagagem, voos — TUDO preenchido para o(s) destino(s)

RESPONDA EXCLUSIVAMENTE com JSON válido. Sem markdown, sem comentários, sem texto antes ou depois.
O JSON deve seguir EXATAMENTE esta estrutura:
{
  "title": "Título descritivo do roteiro",
  "client": {
    "name": "", "email": "", "phone": "",
    "type": "couple",
    "adults": 2, "children": 0, "childrenAges": [],
    "preferences": [],
    "restrictions": [],
    "economicProfile": "premium",
    "notes": "Notas inferidas da solicitação"
  },
  "travel": {
    "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "nights": 0,
    "destinations": [{ "city": "", "country": "", "nights": 0 }]
  },
  "days": [{
    "dayNumber": 1, "date": "YYYY-MM-DD",
    "title": "Título do dia",
    "city": "Cidade",
    "narrative": "Narrativa longa e detalhada...",
    "activities": [{ "time": "09:00", "description": "Descrição completa", "type": "passeio" }],
    "overnightCity": "Cidade"
  }],
  "hotels": [{ "city": "", "hotelName": "", "roomType": "", "regime": "", "checkIn": "YYYY-MM-DD", "checkOut": "YYYY-MM-DD", "nights": 0 }],
  "pricing": {
    "perPerson": null, "perCouple": null,
    "currency": "USD", "validUntil": "YYYY-MM-DD",
    "disclaimer": "Valores sob consulta. Cotação personalizada será enviada após confirmação do roteiro.",
    "customRows": []
  },
  "optionals": [{ "service": "", "priceAdult": null, "priceChild": null, "notes": "" }],
  "includes": [],
  "excludes": [],
  "payment": {
    "deposit": "30% no ato da reserva",
    "installments": "Saldo em até 6x sem juros",
    "deadline": "Até 45 dias antes do embarque",
    "notes": ""
  },
  "cancellation": [
    { "period": "Até 60 dias antes da viagem", "penalty": "Sem custo de cancelamento" },
    { "period": "Entre 59 e 30 dias", "penalty": "50% do valor total" },
    { "period": "Entre 29 e 15 dias", "penalty": "75% do valor total" },
    { "period": "Menos de 15 dias ou no-show", "penalty": "100% do valor total" }
  ],
  "importantInfo": {
    "passport": "Informações detalhadas sobre passaporte...",
    "visa": "Requisitos de visto para o destino...",
    "vaccines": "Vacinas recomendadas/obrigatórias...",
    "climate": "Clima esperado no período da viagem...",
    "luggage": "Dicas de bagagem para o destino...",
    "flights": "Informações sobre voos e conexões...",
    "customFields": []
  }
}${webResearchContext}`;

  // ── 3. Chamar IA ──
  let result;
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
        webResearch: webResearchContext,
      });
    } else {
      result = await chatWithAI(userPrompt, {}, {
        moduleId: 'roteiros',
        systemPrompt,
        maxTokens: 8192,
      });
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

    // Extrair JSON do texto
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON não encontrado na resposta.');
    const parsed = JSON.parse(jsonMatch[0]);

    // Merge com template vazio para garantir estrutura completa
    const base = emptyRoteiro();
    const roteiro = deepMergeRoteiro(base, parsed);
    roteiro.aiGenerated = true;
    roteiro.aiPrompt = userPrompt.substring(0, 500);

    // Garantir que preços não foram inventados pela IA
    if (roteiro.pricing) {
      roteiro.pricing.perPerson = null;
      roteiro.pricing.perCouple = null;
      if (!roteiro.pricing.disclaimer || roteiro.pricing.disclaimer.length < 10) {
        roteiro.pricing.disclaimer = 'Valores sob consulta. Cotação personalizada será enviada após confirmação do roteiro.';
      }
    }
    if (roteiro.optionals?.length) {
      roteiro.optionals.forEach(o => { o.priceAdult = null; o.priceChild = null; });
    }

    return roteiro;
  } catch (e) {
    console.error('[Roteiro IA] Erro ao parsear:', e, text.substring(0, 500));
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
