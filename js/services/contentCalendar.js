/**
 * PRIMETOUR — Content Calendar Service
 * CRUD + sugestões IA para o Calendário de Conteúdo
 */

import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';

/* ─── Helpers ────────────────────────────────────────────── */
const uid = () => store.get('currentUser')?.uid;
const COL = 'content_calendar';

/* ─── Constantes ─────────────────────────────────────────── */

export const PLATFORMS = [
  { value: 'instagram',  label: 'Instagram',  icon: '◎' },
  { value: 'facebook',   label: 'Facebook',   icon: '◈' },
  { value: 'linkedin',   label: 'LinkedIn',   icon: '▤' },
  { value: 'tiktok',     label: 'TikTok',     icon: '▣' },
  { value: 'youtube',    label: 'YouTube',    icon: '◫' },
  { value: 'twitter',    label: 'X / Twitter', icon: '◌' },
  { value: 'pinterest',  label: 'Pinterest',  icon: '◉' },
  { value: 'blog',       label: 'Blog',       icon: '✎' },
  { value: 'newsletter', label: 'Newsletter', icon: '✉' },
  { value: 'whatsapp',   label: 'WhatsApp',   icon: '◎' },
];

export const CONTENT_TYPES = [
  { value: 'post',        label: 'Post estático',   icon: '▣' },
  { value: 'carrossel',   label: 'Carrossel',       icon: '◫' },
  { value: 'reel',        label: 'Reel / Vídeo curto', icon: '▶' },
  { value: 'story',       label: 'Story',           icon: '◎' },
  { value: 'video',       label: 'Vídeo longo',     icon: '◈' },
  { value: 'live',        label: 'Live',            icon: '◉' },
  { value: 'article',     label: 'Artigo / Blog',   icon: '✎' },
  { value: 'newsletter',  label: 'Newsletter',      icon: '✉' },
  { value: 'thread',      label: 'Thread',          icon: '▤' },
  { value: 'infografico', label: 'Infográfico',     icon: '◷' },
];

export const SLOT_STATUSES = [
  { value: 'idea',       label: 'Ideia',         color: '#94A3B8' },
  { value: 'draft',      label: 'Rascunho',      color: '#38BDF8' },
  { value: 'writing',    label: 'Redação',       color: '#A78BFA' },
  { value: 'design',     label: 'Design',        color: '#F59E0B' },
  { value: 'review',     label: 'Revisão',       color: '#FB923C' },
  { value: 'approved',   label: 'Aprovado',      color: '#22C55E' },
  { value: 'scheduled',  label: 'Agendado',      color: '#2DD4BF' },
  { value: 'published',  label: 'Publicado',     color: '#10B981' },
  { value: 'cancelled',  label: 'Cancelado',     color: '#EF4444' },
];

export const CATEGORIES = [
  { value: 'destino',        label: 'Destino'           },
  { value: 'produto',        label: 'Produto / Oferta'  },
  { value: 'dica_viagem',    label: 'Dica de Viagem'    },
  { value: 'institucional',  label: 'Institucional'     },
  { value: 'bastidores',     label: 'Bastidores'        },
  { value: 'depoimento',     label: 'Depoimento'        },
  { value: 'data_comemorativa', label: 'Data Comemorativa' },
  { value: 'engajamento',    label: 'Engajamento'       },
  { value: 'educativo',      label: 'Educativo'         },
  { value: 'parceiro',       label: 'Parceiro'          },
  { value: 'campanha',       label: 'Campanha'          },
  { value: 'outro',          label: 'Outro'             },
];

export const SLOT_TIMES = [
  { value: '08:00', label: '08:00' },
  { value: '09:00', label: '09:00' },
  { value: '10:00', label: '10:00' },
  { value: '11:00', label: '11:00' },
  { value: '12:00', label: '12:00' },
  { value: '13:00', label: '13:00' },
  { value: '14:00', label: '14:00' },
  { value: '15:00', label: '15:00' },
  { value: '16:00', label: '16:00' },
  { value: '17:00', label: '17:00' },
  { value: '18:00', label: '18:00' },
  { value: '19:00', label: '19:00' },
  { value: '20:00', label: '20:00' },
  { value: '21:00', label: '21:00' },
];

export const STATUS_MAP   = Object.fromEntries(SLOT_STATUSES.map(s => [s.value, s]));
export const PLATFORM_MAP = Object.fromEntries(PLATFORMS.map(p => [p.value, p]));
export const CONTENT_TYPE_MAP = Object.fromEntries(CONTENT_TYPES.map(t => [t.value, t]));

/* ════════════════════════════════════════════════════════════
   CRUD — content_calendar
   ════════════════════════════════════════════════════════════ */

/**
 * Buscar slots com filtros opcionais.
 */
export async function fetchSlots({ startDate, endDate, account, platform, status } = {}) {
  try {
    // Query simples sem orderBy composto — ordena client-side
    const q = query(collection(db, COL));
    const snap = await getDocs(q);
    let items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Filtros client-side (evita índices compostos)
    if (startDate) items = items.filter(i => i.scheduledDate && i.scheduledDate >= startDate);
    if (endDate)   items = items.filter(i => i.scheduledDate && i.scheduledDate <= endDate);
    if (account)   items = items.filter(i => i.account === account);
    if (platform)  items = items.filter(i => i.platform === platform);
    if (status)    items = items.filter(i => i.status === status);

    // Ordenar por data agendada
    items.sort((a, b) => (a.scheduledDate || '').localeCompare(b.scheduledDate || ''));

    return items;
  } catch (e) {
    console.warn('[ContentCalendar] fetchSlots error:', e.message || e);
    return [];
  }
}

/**
 * Buscar slot individual.
 */
export async function getSlot(id) {
  const snap = await getDoc(doc(db, COL, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * Criar novo slot.
 */
export async function createSlot(data) {
  const ref = await addDoc(collection(db, COL), {
    ...data,
    createdAt: serverTimestamp(),
    createdBy: uid(),
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
  });
  return ref.id;
}

/**
 * Atualizar slot existente.
 */
export async function updateSlot(id, data) {
  await updateDoc(doc(db, COL, id), {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
  });
  return id;
}

/**
 * Excluir slot.
 */
export async function deleteSlot(id) {
  await deleteDoc(doc(db, COL, id));
  return id;
}

/**
 * Duplicar slot — copia tudo exceto status (vira draft) e scheduledDate.
 */
export async function duplicateSlot(id) {
  const original = await getSlot(id);
  if (!original) throw new Error('Slot não encontrado.');

  const { id: _id, createdAt, createdBy, updatedAt, updatedBy, scheduledDate, scheduledTime, status, performance, linkedPostId, ...rest } = original;

  return createSlot({
    ...rest,
    status: 'draft',
    scheduledDate: null,
    scheduledTime: null,
    performance: null,
    linkedPostId: null,
  });
}

/* ════════════════════════════════════════════════════════════
   AI — Sugestão de conteúdo semanal
   ════════════════════════════════════════════════════════════ */

/**
 * Sugere conteúdos para a semana informada usando IA.
 * Analisa posts recentes, dicas do portal e lacunas no calendário.
 */
export async function suggestWeekContent({ startDate, endDate, account, count = 5 }) {
  // 1. Buscar top 10 posts por engajamento (últimos 90 dias)
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const postsIsoDate = ninetyDaysAgo.toISOString().split('T')[0];

  let topPosts = [];
  try {
    // Query simples sem índice composto — filtra client-side
    const postsSnap = await getDocs(
      query(collection(db, 'meta_posts'), orderBy('date', 'desc'), limit(100))
    );
    topPosts = postsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => (!account || p.account === account) && (p.date || '') >= postsIsoDate)
      .sort((a, b) => (b.engagement || 0) - (a.engagement || 0))
      .slice(0, 10);
  } catch (e) {
    console.warn('[ContentCalendar AI] meta_posts indisponível, continuando sem dados de performance:', e.message || e);
    // Continua normalmente — meta_posts é opcional para sugestões
  }

  // 2. Buscar dicas do portal atualizadas recentemente (últimos 30 dias)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const tipsIsoDate = thirtyDaysAgo.toISOString().split('T')[0];

  let recentTips = [];
  try {
    const tipsSnap = await getDocs(
      query(collection(db, 'portal_tips'), orderBy('lastUpdated', 'desc'), limit(20))
    );
    recentTips = tipsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => (t.lastUpdated || '') >= tipsIsoDate);
  } catch (e) {
    console.warn('[ContentCalendar AI] portal_tips indisponível, continuando sem dicas:', e.message || e);
    // Continua normalmente — portal_tips é opcional
  }

  // 3. Identificar gaps (dias sem conteúdo na semana)
  let existingSlots = [];
  try {
    existingSlots = await fetchSlots({ startDate, endDate, account });
  } catch (e) {
    console.warn('[ContentCalendar AI] Falha ao buscar slots existentes:', e.message || e);
  }
  const daysWithContent = new Set(existingSlots.map(s => s.scheduledDate).filter(Boolean));

  const gaps = [];
  const current = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T23:59:59');
  while (current <= end) {
    const iso = current.toISOString().split('T')[0];
    if (!daysWithContent.has(iso)) gaps.push(iso);
    current.setDate(current.getDate() + 1);
  }

  // 4. Montar contexto para a IA
  const topPostsSummary = topPosts.map(p => ({
    message: (p.message || '').substring(0, 200),
    type: p.type,
    engagement: p.engagement,
    likes: p.likes,
    comments: p.comments,
    date: p.date,
  }));

  const tipsSummary = recentTips.slice(0, 5).map(t => ({
    title: t.title || t.destination,
    category: t.category,
    destination: t.destination,
  }));

  const platformList = PLATFORMS.map(p => p.value).join(', ');
  const typeList = CONTENT_TYPES.map(t => `${t.value} (${t.label})`).join(', ');
  const categoryList = CATEGORIES.map(c => `${c.value} (${c.label})`).join(', ');

  const prompt = `Você é um estrategista de conteúdo digital para a agência de viagens PRIMETOUR.

Analise os dados abaixo e sugira ${count} conteúdos para a semana de ${startDate} a ${endDate}.

TOP POSTS RECENTES (maior engajamento):
${JSON.stringify(topPostsSummary, null, 2)}

DICAS DO PORTAL ATUALIZADAS:
${JSON.stringify(tipsSummary, null, 2)}

DIAS SEM CONTEÚDO NA SEMANA: ${gaps.length > 0 ? gaps.join(', ') : 'todos os dias já têm conteúdo'}

CONTEÚDOS JÁ AGENDADOS NA SEMANA: ${existingSlots.length} slot(s)

REGRAS DE MIX DE CONTEÚDO:
- Máximo 2 do mesmo contentType por semana
- Pelo menos 1 reel e 1 carrossel na semana
- Priorizar dias sem conteúdo (gaps)
- Variar categorias e plataformas

PLATAFORMAS DISPONÍVEIS: ${platformList}
TIPOS DE CONTEÚDO: ${typeList}
CATEGORIAS: ${categoryList}

Responda APENAS com um JSON array (sem markdown) no formato:
[
  {
    "title": "Título do conteúdo",
    "platform": "instagram",
    "contentType": "reel",
    "category": "destino",
    "scheduledDate": "YYYY-MM-DD",
    "brief": "Breve descrição do conteúdo e abordagem",
    "hashtags": ["#hashtag1", "#hashtag2"],
    "reasoning": "Por que este conteúdo foi sugerido"
  }
]`;

  // 5. Chamar IA via skill ou prompt direto
  const { runSkill, fetchSkillsForModule, chatWithAI } = await import('./ai.js');

  let result;
  try {
    const skills = await fetchSkillsForModule('content-calendar').catch(() => []);
    const contentSkill = skills.find(s =>
      s.name?.toLowerCase().includes('conteúdo') ||
      s.name?.toLowerCase().includes('content')
    );

    if (contentSkill) {
      result = await runSkill(contentSkill.id, {
        startDate,
        endDate,
        account,
        count,
        topPosts: topPostsSummary,
        tips: tipsSummary,
        gaps,
        existingCount: existingSlots.length,
      });
    } else {
      result = await chatWithAI(prompt, {}, { moduleId: 'content-calendar' });
    }
  } catch (e) {
    console.error('[ContentCalendar AI] Erro na chamada IA:', e);
    throw new Error('Falha ao gerar sugestões de conteúdo.');
  }

  // 6. Parsear resposta
  const text = result?.text || result?.content || '';
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('JSON array não encontrado na resposta.');
    const suggestions = JSON.parse(jsonMatch[0]);

    return suggestions.map(s => ({
      title: s.title || '',
      platform: s.platform || 'instagram',
      contentType: s.contentType || 'post',
      category: s.category || 'outro',
      scheduledDate: s.scheduledDate || null,
      brief: s.brief || '',
      hashtags: Array.isArray(s.hashtags) ? s.hashtags : [],
      reasoning: s.reasoning || '',
      aiGenerated: true,
      aiSuggestionBasis: 'week-planner',
    }));
  } catch (e) {
    console.error('[ContentCalendar AI] Erro ao parsear sugestões:', e, text);
    throw new Error('Não foi possível interpretar as sugestões da IA.');
  }
}

/* ════════════════════════════════════════════════════════════
   AI — Gerador de legendas / captions
   ════════════════════════════════════════════════════════════ */

/**
 * Gera legenda/caption para um conteúdo usando IA.
 */
export async function suggestCaption({ title, brief, platform, category, account }) {
  const { chatWithAI } = await import('./ai.js');

  const prompt = `Você é um copywriter de redes sociais da agência de viagens PRIMETOUR.

Gere uma legenda/caption para o seguinte conteúdo:

Título: ${title || '(sem título)'}
Briefing: ${brief || '(sem briefing)'}
Plataforma: ${platform || 'instagram'}
Categoria: ${category || 'geral'}
Conta: ${account || 'PRIMETOUR'}

INSTRUÇÕES:
- Tom profissional mas acessível, convidativo
- Inclua CTA (call to action) quando apropriado
- Adapte o comprimento à plataforma (Instagram: até 2200 chars, Twitter: curto, LinkedIn: profissional)
- Inclua emojis relevantes de forma moderada
- Sugira hashtags relevantes para turismo/viagem

Responda APENAS com um JSON (sem markdown):
{
  "text": "A legenda completa aqui",
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3"]
}`;

  let result;
  try {
    result = await chatWithAI(prompt, {}, { moduleId: 'content-calendar' });
  } catch (e) {
    console.error('[ContentCalendar AI] Erro ao gerar caption:', e);
    throw new Error('Falha ao gerar legenda.');
  }

  const text = result?.text || result?.content || '';
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON não encontrado na resposta.');
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      text: parsed.text || '',
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
    };
  } catch (e) {
    // Fallback: retornar texto bruto como caption
    return { text: text.trim(), hashtags: [] };
  }
}

/* ════════════════════════════════════════════════════════════
   Stats — Estatísticas do calendário
   ════════════════════════════════════════════════════════════ */

/**
 * Retorna estatísticas agregadas do calendário de conteúdo.
 */
export async function getContentCalendarStats({ startDate, endDate, account } = {}) {
  const slots = await fetchSlots({ startDate, endDate, account });

  const byStatus = {};
  const byPlatform = {};
  const byContentType = {};
  const byCategory = {};

  for (const slot of slots) {
    // Por status
    const st = slot.status || 'draft';
    byStatus[st] = (byStatus[st] || 0) + 1;

    // Por plataforma
    const pl = slot.platform || 'other';
    byPlatform[pl] = (byPlatform[pl] || 0) + 1;

    // Por tipo de conteúdo
    const ct = slot.contentType || 'other';
    byContentType[ct] = (byContentType[ct] || 0) + 1;

    // Por categoria
    const cat = slot.category || 'outro';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  }

  return {
    total: slots.length,
    byStatus,
    byPlatform,
    byContentType,
    byCategory,
    published: byStatus.published || 0,
    scheduled: byStatus.scheduled || 0,
    inProgress: (byStatus.writing || 0) + (byStatus.design || 0) + (byStatus.review || 0),
    pending: (byStatus.idea || 0) + (byStatus.draft || 0),
  };
}
