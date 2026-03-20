/**
 * PRIMETOUR — AI Service
 * Proxy seguro para Claude via Cloudflare Worker
 * Tom de voz carregado por BU antes de cada chamada
 */

import { db }   from '../firebase.js';
import { store } from '../store.js';
import {
  doc, getDoc, setDoc, collection, getDocs, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/* ── Config ── */
export const AI_WORKER_URL   = 'https://primetour-claude.rene-castro.workers.dev';
export const AI_WORKER_TOKEN = 'primetour-ai-2026-xyz'; // cole o WORKER_TOKEN após configurar no Cloudflare

export const BUS = [
  { id: 'pts',                name: 'PTS Bradesco'        },
  { id: 'centurion',          name: 'Centurion'           },
  { id: 'btg-partners',       name: 'BTG Partners'        },
  { id: 'btg-ultrablue',      name: 'BTG Ultrablue'       },
  { id: 'primetour-lazer',    name: 'Lazer'               },
  { id: 'primetour-agencias', name: 'Operadora'           },
  { id: 'ics',                name: 'ICs'                 },
];

/* ── Brand voice cache (session) ── */
const voiceCache = {};

export async function loadBrandVoice(buId) {
  if (voiceCache[buId]) return voiceCache[buId];
  try {
    const snap = await getDoc(doc(db, 'ai_settings', `brand_voice_${buId}`));
    const voice = snap.exists() ? (snap.data().content || '') : '';
    voiceCache[buId] = voice;
    return voice;
  } catch { return ''; }
}

export async function saveBrandVoice(buId, content) {
  await setDoc(doc(db, 'ai_settings', `brand_voice_${buId}`), {
    buId, content,
    updatedAt: serverTimestamp(),
    updatedBy: store.getState()?.user?.uid || '',
  });
  voiceCache[buId] = content; // update cache
}

export async function loadAllBrandVoices() {
  const result = {};
  await Promise.all(BUS.map(async bu => {
    result[bu.id] = await loadBrandVoice(bu.id);
  }));
  return result;
}

/* ── Core call ── */
/**
 * @param {object} opts
 * @param {string}   opts.buId        — BU para carregar tom de voz
 * @param {string}   opts.userPrompt  — mensagem do usuário
 * @param {string=}  opts.extraSystem — instruções extras além do tom de voz
 * @param {number=}  opts.maxTokens   — padrão 1024
 * @param {object[]=} opts.history    — histórico de mensagens anteriores
 */
export async function callClaude({ buId, userPrompt, extraSystem = '', maxTokens = 1024, history = [] }) {
  if (!AI_WORKER_URL)   throw new Error('AI_WORKER_URL não configurada.');
  if (!AI_WORKER_TOKEN) throw new Error('AI_WORKER_TOKEN não configurado.');

  const voice = buId ? await loadBrandVoice(buId) : '';

  const systemParts = [];
  if (voice) systemParts.push(`## Tom de voz e diretrizes de marca\n\n${voice}`);
  if (extraSystem) systemParts.push(extraSystem);
  systemParts.push('Responda sempre em português brasileiro. Seja objetivo e direto.');

  const messages = [
    ...history,
    { role: 'user', content: userPrompt },
  ];

  const resp = await fetch(AI_WORKER_URL, {
    method: 'POST',
    headers: {
      'Content-Type':   'application/json',
      'X-Worker-Token': AI_WORKER_TOKEN,
    },
    body: JSON.stringify({
      messages,
      systemPrompt: systemParts.join('\n\n---\n\n'),
      maxTokens,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.status);
    throw new Error(`Erro no Worker: ${err}`);
  }

  const data = await resp.json();
  const text = data.content?.map(c => c.text || '').join('') || '';
  if (!text) throw new Error('Resposta vazia da IA.');

  await logGeneration({ buId, userPrompt, response: text, maxTokens });
  return text;
}

/* ── Specialized callers ── */

export async function generateTravelTip({ buId, destination, segment, currentContent = '', mode = 'rewrite' }) {
  const modePrompts = {
    rewrite:  `Reescreva o conteúdo abaixo mantendo as informações factuais, mas aplicando o tom de voz da marca.`,
    enrich:   `Enriqueça o conteúdo abaixo com detalhes adicionais relevantes, mantendo o tom de voz da marca.`,
    generate: `Gere conteúdo novo sobre este destino/segmento. Seja específico e útil para turistas brasileiros.`,
  };

  const extraSystem = `Você é especialista em turismo de luxo para o mercado brasileiro.
Destino: ${destination}
Segmento: ${segment}
Tarefa: ${modePrompts[mode] || modePrompts.rewrite}`;

  const userPrompt = currentContent
    ? `Conteúdo atual:\n\n${currentContent}\n\nGere a versão melhorada:`
    : `Gere conteúdo para o segmento "${segment}" do destino "${destination}":`;

  return callClaude({ buId, userPrompt, extraSystem, maxTokens: 1500 });
}

export async function generateNewsletter({ buId, tema, campanha, publico, destaque, secoes = [] }) {
  const extraSystem = `Você é redator especialista em e-mail marketing para agências de viagem de luxo.
Escreva em HTML estruturado apenas se solicitado — caso contrário, texto puro com marcadores claros por seção.
Siga rigorosamente o tom de voz da marca.`;

  const userPrompt = `Crie uma newsletter com os seguintes parâmetros:

Tema: ${tema}
Campanha: ${campanha || '—'}
Público-alvo: ${publico || 'Clientes premium'}
Destaque principal: ${destaque}
${secoes.length ? `Seções solicitadas: ${secoes.join(', ')}` : ''}

Entregue:
1. ASSUNTO — linha de assunto principal
2. ASSUNTO B — variação para teste A/B
3. PRÉ-HEADER — texto de preview (máx 90 caracteres)
4. ABERTURA — parágrafo de entrada (2-3 linhas)
5. CORPO — conteúdo principal estruturado
6. CTA — chamada para ação (texto do botão + frase de apoio)
7. ENCERRAMENTO — assinatura e despedida

Separe cada seção com "===" e o nome da seção em maiúsculas.`;

  return callClaude({ buId, userPrompt, extraSystem, maxTokens: 2000 });
}

export async function generateSocialPost({ buId, plataforma, formato, tema, contexto = '' }) {
  const limites = {
    instagram: { Post: 2200, Story: 0, Reel: 2200, Carrossel: 2200 },
    linkedin:  { Post: 3000, Artigo: 0 },
  };

  const lim = limites[plataforma.toLowerCase()]?.[formato] || 2200;

  const extraSystem = `Você é especialista em social media para marcas de luxo e viagens premium.
Plataforma: ${plataforma}
Formato: ${formato}
${lim ? `Limite de caracteres: ${lim}` : ''}
Adapte o tom para a plataforma mantendo a voz da marca.`;

  const userPrompt = `Crie conteúdo para ${plataforma} — ${formato}:

Tema: ${tema}
${contexto ? `Contexto adicional: ${contexto}` : ''}

Entregue:
1. LEGENDA — texto principal (respeite o limite de caracteres)
2. HASHTAGS — de 5 a 15 hashtags relevantes (para Instagram/LinkedIn)
3. GANCHO — primeira frase que aparece antes do "ver mais" (máx 125 caracteres)
${formato === 'Carrossel' ? '4. SLIDES — sugestão de conteúdo por slide (máx 8 slides)' : ''}
${formato === 'Story' ? '4. CTA — sugestão de sticker ou ação' : ''}

Separe cada seção com "===" e o nome em maiúsculas.`;

  return callClaude({ buId, userPrompt, extraSystem, maxTokens: 1200 });
}

export async function analyzeTipExpiry({ destination, segment, currentContent }) {
  const extraSystem = `Você é analista de conteúdo para uma agência de viagens premium brasileira.
Avalie se o conteúdo de viagem fornecido está provavelmente desatualizado e o que deve ser verificado.`;

  const userPrompt = `Destino: ${destination}
Segmento: ${segment}

Conteúdo atual:
${currentContent}

Analise e informe:
1. O que provavelmente está desatualizado (preços, horários, disponibilidade, eventos)
2. O que deve ser verificado com prioridade ALTA / MÉDIA / BAIXA
3. Onde buscar informações atualizadas (site oficial, Google Maps, etc.)

Seja objetivo e use marcadores.`;

  return callClaude({ buId: null, userPrompt, extraSystem, maxTokens: 800 });
}

/* ── Log ── */
async function logGeneration({ buId, userPrompt, response, maxTokens }) {
  try {
    const ref = doc(collection(db, 'ai_generations'));
    await setDoc(ref, {
      buId:       buId || null,
      promptLen:  userPrompt.length,
      responseLen: response.length,
      maxTokens,
      generatedBy: store.getState()?.user?.uid || '',
      generatedAt: serverTimestamp(),
    });
  } catch { /* non-fatal */ }
}
