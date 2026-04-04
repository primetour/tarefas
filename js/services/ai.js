/**
 * PRIMETOUR — AI Service
 * Central de integração com Claude API
 * Gerencia chamadas, configuração e skills de IA
 */

import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';

/* ─── Registry de módulos: contexto disponível por módulo ── */
export const MODULE_REGISTRY = {
  'tasks':            { label: 'Tarefas',             icon: '✓',  contextFields: ['title','description','type','typeName','status','assignee','deadline','sector','priority','variationName','nucleo'] },
  'portal-tips':      { label: 'Portal de Dicas',     icon: '✈',  contextFields: ['title','body','category','destination','area','lastUpdated'] },
  'dashboards':       { label: 'Dashboards',          icon: '◫',  contextFields: ['metrics','period','chartData','filters','summary'] },
  'kanban':           { label: 'Kanban / Steps',      icon: '▤',  contextFields: ['card','column','project','status','assignee'] },
  'requests':         { label: 'Solicitações',        icon: '◌',  contextFields: ['type','requester','description','status','desiredDate','sector'] },
  'news-monitor':     { label: 'Notícias',            icon: '◉',  contextFields: ['topic','sources','currentFeed','keywords'] },
  'feedbacks':        { label: 'Feedbacks',           icon: '◈',  contextFields: ['feedbackText','audioUrl','rating','customer','category'] },
  'csat':             { label: 'CSAT',                icon: '★',  contextFields: ['surveyData','responses','score','period'] },
  'goals':            { label: 'Metas',               icon: '◎',  contextFields: ['goal','keyResults','progress','period'] },
  'projects':         { label: 'Projetos',            icon: '◈',  contextFields: ['name','description','status','tasks','deadline','members'] },
  'content':          { label: 'Gestão de Conteúdo',  icon: '◈',  contextFields: ['channel','audience','brief','previousPosts','calendar','objectives'] },
  'calendar':         { label: 'Calendário',          icon: '◷',  contextFields: ['events','period','filters'] },
  'cms':              { label: 'CMS / Site',          icon: '◫',  contextFields: ['page','content','seo','images'] },
  'landing-pages':    { label: 'Landing Pages',       icon: '◱',  contextFields: ['page','content','audience','cta'] },
  'arts-editor':      { label: 'Editor de Artes',     icon: '▣',  contextFields: ['design','template','text','brand'] },
  'general':          { label: 'Geral (todos)',       icon: '⊞',  contextFields: ['input'] },
};

/* ─── Providers de IA ────────────────────────────────────── */
export const AI_PROVIDERS = [
  { id: 'gemini',     label: 'Google Gemini (grátis)',        icon: '◈', free: true,  configFields: ['apiKey'],                     signupUrl: 'https://aistudio.google.com/apikey' },
  { id: 'groq',       label: 'Groq (grátis)',                icon: '▤', free: true,  configFields: ['apiKey'],                     signupUrl: 'https://console.groq.com/keys' },
  { id: 'anthropic',  label: 'Anthropic (Claude)',            icon: '◈', free: false, configFields: ['apiKey'] },
  { id: 'azure',      label: 'Microsoft Azure / Foundry',    icon: '◫', free: false, configFields: ['apiKey','azureEndpoint'] },
];

/* ─── Constantes ─────────────────────────────────────────── */
export const AI_MODELS = {
  gemini: [
    { id: 'gemini-2.5-flash',    label: 'Gemini 2.5 Flash',     desc: 'Grátis — rápido e versátil, ótimo para começar' },
    { id: 'gemini-2.5-pro',      label: 'Gemini 2.5 Pro',       desc: 'Grátis — alta qualidade, ideal para análise e redação' },
    { id: 'gemini-2.0-flash',    label: 'Gemini 2.0 Flash',     desc: 'Grátis — geração anterior, ainda muito capaz' },
  ],
  groq: [
    { id: 'llama-4-scout-17b-16e-instruct',  label: 'Llama 4 Scout',    desc: 'Grátis — Meta Llama 4, rápido e inteligente' },
    { id: 'llama-4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick', desc: 'Grátis — Meta Llama 4, máxima qualidade' },
    { id: 'gemma2-9b-it',        label: 'Gemma 2 9B',           desc: 'Grátis — Google Gemma 2, leve e eficiente' },
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B',    desc: 'Grátis — muito capaz para tarefas complexas' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-6',  label: 'Claude Sonnet 4.6',  desc: 'Rápido e econômico — ideal para tarefas do dia a dia' },
    { id: 'claude-opus-4-6',    label: 'Claude Opus 4.6',    desc: 'Máxima qualidade — ideal para redação e análise complexa' },
    { id: 'claude-haiku-4-5',   label: 'Claude Haiku 4.5',   desc: 'Ultra-rápido e barato — ideal para classificação e triagem' },
  ],
  azure: [
    { id: 'gpt-4o',             label: 'GPT-4o',             desc: 'Modelo multimodal avançado da OpenAI via Azure' },
    { id: 'gpt-4o-mini',        label: 'GPT-4o Mini',        desc: 'Versão compacta e econômica do GPT-4o' },
    { id: 'gpt-4.1',            label: 'GPT-4.1',            desc: 'Última geração GPT — alto desempenho' },
    { id: 'gpt-4.1-mini',       label: 'GPT-4.1 Mini',       desc: 'Versão compacta do GPT-4.1' },
    { id: 'gpt-4.1-nano',       label: 'GPT-4.1 Nano',       desc: 'Ultra-leve para tarefas simples' },
  ],
};

/* ─── Defaults por provider ──────────────────────────────── */
const PROVIDER_DEFAULTS = {
  gemini:    { model: 'gemini-2.5-flash',   maxTokens: 1024 },
  groq:      { model: 'llama-4-scout-17b-16e-instruct', maxTokens: 1024 },
  anthropic: { model: 'claude-sonnet-4-6',  maxTokens: 1024 },
  azure:     { model: 'gpt-4o',             maxTokens: 1024 },
};

/* Helper: lista flat de modelos do provider ativo */
export function getModelsForProvider(providerId) {
  return AI_MODELS[providerId] || AI_MODELS.gemini;
}

export const OUTPUT_FORMATS = [
  { id: 'text',     label: 'Texto livre' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'json',     label: 'JSON estruturado' },
  { id: 'html',     label: 'HTML' },
];

export const TRIGGER_TYPES = [
  { id: 'button',    label: 'Botão manual' },
  { id: 'auto',      label: 'Automático ao abrir' },
  { id: 'context',   label: 'Menu de contexto' },
];

/* ─── Configuração global da API ─────────────────────────── */
const CONFIG_DOC_ID = 'ai-config';

export async function getAIConfig() {
  try {
    const snap = await getDoc(doc(db, 'system_config', CONFIG_DOC_ID));
    return snap.exists() ? snap.data() : null;
  } catch { return null; }
}

export async function saveAIConfig(data) {
  const user = store.get('currentUser');
  await updateDoc(doc(db, 'system_config', CONFIG_DOC_ID), {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: user?.uid || null,
  }).catch(async () => {
    // Doc may not exist yet — create it
    const { setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    await setDoc(doc(db, 'system_config', CONFIG_DOC_ID), {
      ...data,
      createdAt: serverTimestamp(),
      createdBy: user?.uid || null,
      updatedAt: serverTimestamp(),
    });
  });
}

/* ─── CRUD: Base de Conhecimento ─────────────────────────── */
const KNOWLEDGE_COL = 'ai_knowledge';

export async function fetchKnowledge() {
  const snap = await getDocs(query(
    collection(db, KNOWLEDGE_COL),
    orderBy('title', 'asc'),
  )).catch(() => ({ docs: [] }));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getKnowledgeDoc(id) {
  const snap = await getDoc(doc(db, KNOWLEDGE_COL, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createKnowledgeDoc(data) {
  const user = store.get('currentUser');
  const ref = await addDoc(collection(db, KNOWLEDGE_COL), {
    title:     data.title?.trim() || 'Sem título',
    content:   data.content || '',
    type:      data.type || 'text',         // 'text' | 'url'
    sourceUrl: data.sourceUrl?.trim() || '',
    tags:      data.tags || [],
    charCount: (data.content || '').length,
    createdAt: serverTimestamp(),
    createdBy: user?.uid || null,
    updatedAt: serverTimestamp(),
  });
  return { id: ref.id, ...data };
}

export async function updateKnowledgeDoc(id, data) {
  const update = { ...data, updatedAt: serverTimestamp() };
  if (data.content != null) update.charCount = data.content.length;
  await updateDoc(doc(db, KNOWLEDGE_COL, id), update);
}

export async function deleteKnowledgeDoc(id) {
  await deleteDoc(doc(db, KNOWLEDGE_COL, id));
}

/** Carrega conteúdo de múltiplos docs de conhecimento por IDs */
export async function loadKnowledgeContents(ids = []) {
  if (!ids.length) return [];
  const results = await Promise.all(
    ids.map(id => getKnowledgeDoc(id).catch(() => null))
  );
  return results.filter(Boolean);
}

/* ─── CRUD: Skills IA ────────────────────────────────────── */
const SKILLS_COL = 'ai_skills';

export async function fetchSkills() {
  const snap = await getDocs(query(
    collection(db, SKILLS_COL),
    orderBy('name', 'asc'),
  )).catch(() => ({ docs: [] }));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getSkill(id) {
  const snap = await getDoc(doc(db, SKILLS_COL, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function fetchSkillsForModule(moduleId) {
  const snap = await getDocs(query(
    collection(db, SKILLS_COL),
    where('module', '==', moduleId),
    where('active', '==', true),
  )).catch(() => ({ docs: [] }));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function createSkill(data) {
  const user = store.get('currentUser');
  const ref = await addDoc(collection(db, SKILLS_COL), {
    ...data,
    active:    data.active !== false,
    createdAt: serverTimestamp(),
    createdBy: user?.uid || null,
    updatedAt: serverTimestamp(),
  });
  return { id: ref.id, ...data };
}

export async function updateSkill(id, data) {
  await updateDoc(doc(db, SKILLS_COL, id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteSkill(id) {
  await deleteDoc(doc(db, SKILLS_COL, id));
}

/* ─── Execução de Skill (chamada à API) ─────────────────── */
export async function runSkill(skillId, context = {}) {
  const config = await getAIConfig();
  const skill  = await getSkill(skillId);
  if (!skill) throw new Error('Skill não encontrada.');

  // Montar o prompt do usuário com variáveis do contexto
  let userPrompt = skill.userPromptTemplate || '';
  for (const [key, val] of Object.entries(context)) {
    userPrompt = userPrompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val ?? ''));
  }
  // Limpar variáveis não preenchidas
  userPrompt = userPrompt.replace(/\{\{[^}]+\}\}/g, '').trim();

  // Determinar provider
  const provider = skill.provider || config?.provider || 'gemini';

  // Resolver API key do provider
  const providerKeyMap = {
    gemini:    config?.geminiApiKey   || '',
    groq:      config?.groqApiKey     || '',
    anthropic: config?.anthropicApiKey || '',
    azure:     config?.azureApiKey     || '',
  };
  const apiKey = providerKeyMap[provider] || '';
  if (!apiKey) {
    return mockResponse(skill, userPrompt);
  }

  // Carregar base de conhecimento vinculada à skill
  let knowledgeContext = '';
  if (skill.knowledgeIds?.length) {
    const docs = await loadKnowledgeContents(skill.knowledgeIds);
    if (docs.length) {
      knowledgeContext = '\n\n=== BASE DE CONHECIMENTO ===\n' +
        docs.map(d => `--- ${d.title} ---\n${d.content}`).join('\n\n') +
        '\n=== FIM DA BASE DE CONHECIMENTO ===';
    }
  }

  // Montar system prompt enriquecido
  const systemParts = [];
  if (skill.systemPrompt) systemParts.push(skill.systemPrompt);
  if (knowledgeContext) systemParts.push('Use a base de conhecimento abaixo como referência principal para suas respostas. Priorize informações da base sobre conhecimento geral.' + knowledgeContext);
  if (skill.voiceTone) systemParts.push(`Tom de voz: ${skill.voiceTone}`);
  if (skill.charLimit) systemParts.push(`Limite de caracteres na resposta: ${skill.charLimit}`);
  if (skill.outputFormat === 'json') systemParts.push('Responda APENAS em JSON válido.');
  if (skill.outputFormat === 'html') systemParts.push('Responda em HTML semântico.');
  if (skill.allowedSources?.length) systemParts.push(`Fontes autorizadas: ${skill.allowedSources.join(', ')}`);
  const systemPrompt = systemParts.join('\n\n');

  const defaults  = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.gemini;
  const model     = skill.model || config?.defaultModel || defaults.model;
  const maxTokens = skill.maxTokens || config?.defaultMaxTokens || defaults.maxTokens;
  const webSearch = skill.webSearch === true;

  let result;
  switch (provider) {
    case 'gemini':
      result = await callGemini({ apiKey, model, maxTokens, systemPrompt, userPrompt, temperature: skill.temperature, webSearch });
      break;
    case 'groq':
      result = await callGroq({ apiKey, model, maxTokens, systemPrompt, userPrompt, temperature: skill.temperature });
      break;
    case 'azure':
      result = await callAzure({ config, apiKey, model, maxTokens, systemPrompt, userPrompt, temperature: skill.temperature });
      break;
    default:
      result = await callAnthropic({ apiKey, model, maxTokens, systemPrompt, userPrompt, temperature: skill.temperature });
  }

  // Log de uso (silencioso)
  logUsage(skill, { ...result, provider }).catch(() => {});

  return {
    text:         result.text,
    model:        result.model,
    provider,
    inputTokens:  result.inputTokens,
    outputTokens: result.outputTokens,
    skillId:      skill.id,
    skillName:    skill.name,
  };
}

/* ─── Provider: Anthropic (Claude) ───────────────────────── */
async function callAnthropic({ apiKey, model, maxTokens, systemPrompt, userPrompt, temperature }) {
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: userPrompt }],
  };
  if (systemPrompt) body.system = systemPrompt;
  if (temperature != null) body.temperature = temperature;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version':  '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Erro Anthropic: ${response.status}`);
  }

  const data = await response.json();
  return {
    text:         data.content?.[0]?.text || '',
    model:        data.model,
    inputTokens:  data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
  };
}

/* ─── Provider: Azure OpenAI / Foundry ───────────────────── */
async function callAzure({ config, apiKey, model, maxTokens, systemPrompt, userPrompt, temperature }) {
  // Azure OpenAI usa endpoint customizado: https://{resource}.openai.azure.com/openai/deployments/{model}/chat/completions?api-version=...
  const endpoint = config?.azureEndpoint || '';
  if (!endpoint) throw new Error('Endpoint Azure não configurado. Vá em IA Skills → Configurações.');

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });

  const body = { messages, max_tokens: maxTokens };
  if (temperature != null) body.temperature = temperature;

  const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${model}/chat/completions?api-version=2024-10-21`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key':      apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Erro Azure: ${response.status}`);
  }

  const data = await response.json();
  return {
    text:         data.choices?.[0]?.message?.content || '',
    model:        data.model || model,
    inputTokens:  data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
  };
}

/* ─── Provider: Google Gemini (grátis) ───────────────────── */
async function callGemini({ apiKey, model, maxTokens, systemPrompt, userPrompt, temperature, webSearch }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const contents = [{ parts: [{ text: userPrompt }] }];
  const body = { contents, generationConfig: { maxOutputTokens: maxTokens } };
  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };
  if (temperature != null) body.generationConfig.temperature = temperature;

  // Gemini Grounding: busca na web antes de responder
  if (webSearch) {
    body.tools = [{ googleSearch: {} }];
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Erro Gemini: ${response.status}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  // Gemini pode retornar múltiplas parts (texto + grounding metadata)
  const textParts = (candidate?.content?.parts || []).filter(p => p.text).map(p => p.text);
  const text = textParts.join('\n\n') || '';

  // Extrair fontes do Grounding (se disponíveis)
  const groundingMeta = candidate?.groundingMetadata;
  let sources = '';
  if (groundingMeta?.groundingChunks?.length) {
    sources = '\n\n---\nFontes:\n' + groundingMeta.groundingChunks
      .filter(c => c.web?.uri)
      .map(c => `- ${c.web.title || c.web.uri}: ${c.web.uri}`)
      .join('\n');
  }

  return {
    text:         text + sources,
    model:        model,
    inputTokens:  data.usageMetadata?.promptTokenCount || 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
    webSearchUsed: !!webSearch,
  };
}

/* ─── Provider: Groq (grátis, OpenAI-compatible) ─────────── */
async function callGroq({ apiKey, model, maxTokens, systemPrompt, userPrompt, temperature }) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });

  const body = { model, messages, max_tokens: maxTokens };
  if (temperature != null) body.temperature = temperature;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Erro Groq: ${response.status}`);
  }

  const data = await response.json();
  return {
    text:         data.choices?.[0]?.message?.content || '',
    model:        data.model || model,
    inputTokens:  data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
  };
}

/* ─── Mock response (sem API key) ────────────────────────── */
function mockResponse(skill, prompt) {
  const mockTexts = {
    text: `[MODO DEMONSTRAÇÃO]\n\nEsta é uma resposta simulada da skill "${skill.name}".\n\nQuando a API Key estiver configurada, o Claude processará seu pedido usando o modelo ${skill.model || 'claude-sonnet-4-6'}.\n\nPrompt enviado:\n"${prompt.substring(0, 200)}${prompt.length > 200 ? '...' : ''}"`,
    json: JSON.stringify({
      _demo: true,
      skill: skill.name,
      message: 'Resposta simulada. Configure a API Key para respostas reais.',
      prompt: prompt.substring(0, 200),
    }, null, 2),
    markdown: `## Modo Demonstração\n\nSkill: **${skill.name}**\n\nEsta resposta é simulada. Configure a API Key nas configurações de IA para ativar o Claude.\n\n> Prompt: "${prompt.substring(0, 150)}..."`,
    html: `<div style="padding:12px;border:1px dashed #D4A843;border-radius:8px;"><h3>Modo Demonstração</h3><p>Skill: <strong>${skill.name}</strong></p><p>Configure a API Key para ativar respostas reais do Claude.</p></div>`,
  };

  return {
    text:         mockTexts[skill.outputFormat] || mockTexts.text,
    model:        'mock',
    inputTokens:  0,
    outputTokens: 0,
    skillId:      skill.id,
    skillName:    skill.name,
    isMock:       true,
  };
}

/* ─── Log de uso ─────────────────────────────────────────── */
async function logUsage(skill, result) {
  const user = store.get('currentUser');
  await addDoc(collection(db, 'ai_usage_logs'), {
    skillId:      skill.id,
    skillName:    skill.name,
    module:       skill.module,
    provider:     result.provider || 'anthropic',
    model:        result.model || '',
    inputTokens:  result.inputTokens || 0,
    outputTokens: result.outputTokens || 0,
    userId:       user?.uid || null,
    timestamp:    serverTimestamp(),
  });
}
