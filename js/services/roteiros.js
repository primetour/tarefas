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
