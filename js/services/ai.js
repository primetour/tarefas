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
  'roteiros':         { label: 'Roteiros de Viagem',  icon: '✈',  contextFields: ['destination','clientProfile','dayNumber','narrative','hotels','pricing','portalTips'] },
  'content-calendar':  { label: 'Calendário de Conteúdo', icon: '📱', contextFields: ['slot','platform','account','brief','performance','schedule','contentType'] },
  'ai-automations':   { label: 'Automações IA',       icon: '⚡', contextFields: ['automationName','type','frequency','status','lastRun'] },
  'sectors':          { label: 'Setores e Núcleos',   icon: '◈',  contextFields: ['sector','nucleo','members'] },
  'workspaces':       { label: 'Workspaces',          icon: '▤',  contextFields: ['name','sector','members','archived'] },
  'task-types':       { label: 'Tipos de Tarefa',     icon: '📋', contextFields: ['name','sector','category','variations','fields','sla'] },
  'capacity':         { label: 'Capacidade/Ausências', icon: '◷', contextFields: ['userId','type','startDate','endDate','availability'] },
  'task-categories':  { label: 'Categorias de Tarefa', icon: '◉', contextFields: ['name','sector','color'] },
  'general':          { label: 'Geral (todos)',       icon: '⊞',  contextFields: ['input'] },
};

/* ─── Providers de IA ────────────────────────────────────── */
export const AI_PROVIDERS = [
  { id: 'gemini',     label: 'Google Gemini (grátis)',        icon: '◈', free: true,  configFields: ['apiKey'],                     signupUrl: 'https://aistudio.google.com/apikey' },
  { id: 'groq',       label: 'Groq (grátis)',                icon: '▤', free: true,  configFields: ['apiKey'],                     signupUrl: 'https://console.groq.com/keys' },
  { id: 'openai',     label: 'OpenAI (ChatGPT)',              icon: '◎', free: false, configFields: ['apiKey'] },
  { id: 'anthropic',  label: 'Anthropic (Claude)',            icon: '◈', free: false, configFields: ['apiKey'] },
  { id: 'azure',      label: 'Microsoft Azure / Foundry',    icon: '◫', free: false, configFields: ['apiKey','azureEndpoint'] },
  { id: 'local',      label: 'Servidor Local (Ollama/vLLM)', icon: '⊚', free: true,  configFields: ['localEndpoint'],              signupUrl: 'https://ollama.com/download' },
];

/* ─── Constantes ─────────────────────────────────────────── */
export const AI_MODELS = {
  gemini: [
    { id: 'gemini-2.5-flash',    label: 'Gemini 2.5 Flash',     desc: 'Grátis — rápido e versátil, ótimo para começar' },
    { id: 'gemini-2.5-pro',      label: 'Gemini 2.5 Pro',       desc: 'Grátis — alta qualidade, ideal para análise e redação' },
    { id: 'gemini-2.0-flash',    label: 'Gemini 2.0 Flash',     desc: 'Grátis — geração anterior, ainda muito capaz' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile',                       label: 'Llama 3.3 70B',       desc: 'Grátis — produção, muito capaz para tarefas complexas' },
    { id: 'llama-3.1-8b-instant',                           label: 'Llama 3.1 8B',        desc: 'Grátis — produção, ultra-rápido para tarefas simples' },
    { id: 'meta-llama/llama-4-scout-17b-16e-instruct',     label: 'Llama 4 Scout',       desc: 'Grátis — preview, rápido e inteligente' },
    { id: 'meta-llama/llama-4-maverick-17b-128e-instruct',  label: 'Llama 4 Maverick',    desc: 'Grátis — preview, máxima qualidade' },
  ],
  openai: [
    { id: 'gpt-4o',             label: 'GPT-4o',             desc: 'Modelo principal — multimodal e rápido' },
    { id: 'gpt-4o-mini',        label: 'GPT-4o Mini',        desc: 'Versão econômica do GPT-4o' },
    { id: 'gpt-4.1',            label: 'GPT-4.1',            desc: 'Última geração — máximo desempenho' },
    { id: 'gpt-4.1-mini',       label: 'GPT-4.1 Mini',       desc: 'Compacto e rápido' },
    { id: 'gpt-4.1-nano',       label: 'GPT-4.1 Nano',       desc: 'Ultra-leve para tarefas simples' },
    { id: 'o4-mini',            label: 'o4-mini',            desc: 'Modelo de raciocínio — ideal para análise complexa' },
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
  local: [
    // Modelos populares — o id deve corresponder ao nome no Ollama (ollama list)
    { id: 'qwen2.5',            label: 'Qwen 2.5 7B',        desc: 'On-premise — excelente para português, rápido' },
    { id: 'llama3',             label: 'Llama 3 8B',          desc: 'On-premise — sigilo total, rápido' },
    { id: 'llama3.3:70b',       label: 'Llama 3.3 70B',      desc: 'On-premise — alta qualidade (requer GPU potente)' },
    { id: 'llama3.3',           label: 'Llama 3.3 8B',       desc: 'On-premise — sigilo total, rápido' },
    { id: 'llama3.1:70b',       label: 'Llama 3.1 70B',      desc: 'On-premise — estável (requer GPU potente)' },
    { id: 'llama3.1',           label: 'Llama 3.1 8B',       desc: 'On-premise — sigilo total, ultra-rápido' },
    { id: 'qwen3:32b',          label: 'Qwen 3 32B',         desc: 'On-premise — excelente para português, pesado' },
    { id: 'mistral',            label: 'Mistral 7B',         desc: 'On-premise — leve e eficiente' },
    { id: 'gemma3',             label: 'Gemma 3',            desc: 'On-premise — modelo Google compacto' },
    { id: 'custom',             label: 'Modelo personalizado', desc: 'Informe o nome do modelo no campo de configuração' },
  ],
};

/* ─── Defaults por provider ──────────────────────────────── */
const PROVIDER_DEFAULTS = {
  gemini:    { model: 'gemini-2.5-flash',   maxTokens: 1024 },
  groq:      { model: 'llama-3.3-70b-versatile', maxTokens: 1024 },
  openai:    { model: 'gpt-4o-mini',        maxTokens: 1024 },
  anthropic: { model: 'claude-sonnet-4-6',  maxTokens: 1024 },
  azure:     { model: 'gpt-4o',             maxTokens: 1024 },
  local:     { model: 'qwen2.5',            maxTokens: 2048 },
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

/* ─── Hints de prompt por módulo (defaults) ──────────────── */
/*
 * Estes defaults servem como FALLBACK quando não há override no Firestore
 * (collection `ai_module_hints`, gerenciada pela aba "Prompts por Módulo").
 * Cada hint cobre: terminologia, formatos de campo, enums válidos,
 * ordem de chamadas, armadilhas comuns.
 */
export const DEFAULT_MODULE_HINTS = {

  /* ═════════════════ TASKS ═════════════════ */
  'tasks': `MÓDULO TAREFAS — REGRAS CRÍTICAS:

FORMATO DOS CAMPOS (NUNCA QUEBRE):
- assignees: SEMPRE array de UIDs de usuários. NUNCA nomes ("João"), NUNCA string solta. Se não souber o UID, OMITA o campo (o sistema usará o usuário atual por padrão).
- tags, nucleos: SEMPRE arrays de strings, mesmo com um só item. Ex: ["marketing"] e não "marketing".
- dueDate, startDate: SEMPRE formato YYYY-MM-DD (ex: "2026-04-15"). NUNCA datas por extenso.
- priority: APENAS urgent | high | medium | low.
- status: APENAS not_started | in_progress | review | rework | done | cancelled.
- customFields: objeto { key: value }. SÓ use se souber o typeId e seus campos reais (rode list_task_types antes). Exemplo: {"outOfCalendar": true, "newsletterStatus": "Pauta"}.

FLUXOS OBRIGATÓRIOS:
- Antes de usar typeId/variationId → execute list_task_types para pegar IDs reais. NUNCA invente IDs.
- Antes de update_task/delete_task → execute list_tasks para confirmar que o ID existe (ou use o >>> ID_CRIADO do histórico).
- Para "marcar como feito" → use complete_task (NUNCA update_task com status=done).
- Para excluir permanentemente → use delete_task. Para arquivar/ocultar → use update_task com status=cancelled.

ARMADILHAS COMUNS:
- NUNCA passe assignees como nome de pessoa. Se o usuário disser "atribuir pro Tiago", deixe o campo vazio e informe "Associei a você; o Tiago pode ser adicionado depois pelo menu de membros."
- NUNCA preencha sector com valor inventado — se não souber, omita.
- Ao criar tarefas em lote, use UM bloco <<<ACTION>>> por tarefa.`,

  /* ═════════════════ KANBAN ═════════════════ */
  'kanban': `MÓDULO KANBAN — REGRAS:

CONCEITO:
- Kanban é a visualização de board das mesmas tarefas. Criar um "card" = criar uma tarefa.

FORMATO:
- assignees: SEMPRE array de UIDs, NUNCA nomes. Se não souber, omita.
- status (coluna): APENAS not_started | in_progress | review | rework | done | cancelled.
- dueDate: YYYY-MM-DD.

FLUXOS:
- Para mover card → use move_card com taskId e newStatus (uma das colunas acima).
- Para ver o board → use get_board_summary (contagem por coluna) ou list_tasks.
- Para criar card rápido → use create_card (versão simplificada de create_task).
- Para atualizar um card existente → use update_card. Para apagar, volte ao módulo tasks e use delete_task.`,

  /* ═════════════════ PROJECTS ═════════════════ */
  'projects': `MÓDULO PROJETOS — REGRAS:

FORMATO:
- members: SEMPRE array de UIDs. NUNCA nomes. Se não souber, omita.
- status: APENAS planning | active | on_hold | completed | cancelled.
- startDate, endDate: YYYY-MM-DD.
- color: hex com # (ex: "#3B82F6"). icon: um emoji único.

FLUXOS:
- Antes de vincular tarefas a um projeto → use list_projects para pegar o projectId real.
- Para ver tarefas de um projeto → use get_project_tasks (nunca filtre manualmente no list_tasks).
- Para ver progresso (% concluído) → use get_project_progress.
- delete_project NÃO apaga as tarefas vinculadas; elas apenas ficam sem projeto.`,

  /* ═════════════════ ROTEIROS ═════════════════ */
  'roteiros': `MÓDULO ROTEIROS DE VIAGEM — REGRAS:

CONCEITO:
- Roteiro = proposta de viagem personalizada para um cliente. Estrutura rica com cliente, viagem, day-by-day, hotéis, valores, opcionais, inclui/exclui, pagamento, cancelamento, info importantes.

FORMATO:
- status: APENAS draft | review | sent | approved | archived.
- Datas (startDate, endDate, checkIn, checkOut, validUntil): YYYY-MM-DD.
- client.type: individual | couple | family | group.
- client.economicProfile: standard | premium | luxury.
- pricing.currency: BRL | USD | EUR.
- days[].narrative: texto imersivo de 150+ palavras por dia. Se for curto, recuse e peça mais contexto ou gere com IA.

FLUXOS:
- Antes de criar roteiro → pergunte ao usuário: destino, datas, número de pax, perfil do cliente.
- Para preencher destinos → consulte portal-tips (list_destinations) para pegar IDs reais de destino.
- Para gerar narrativas do dia → use as skills de IA do módulo (não tente escrever tudo de uma vez).`,

  /* ═════════════════ PORTAL-TIPS ═════════════════ */
  'portal-tips': `MÓDULO PORTAL DE DICAS — REGRAS:

HIERARQUIA (respeitar ordem de criação):
- area (BU) → continent → country → destination → tip
- Antes de criar uma dica, o destino precisa existir. Antes do destino, continent/country precisam existir.
- Use list_destinations / list_continents / list_countries para pegar IDs antes de criar dica.

CONTEÚDO:
- create_tip DEVE ter o campo "content" com 300+ palavras reais, com informações práticas (endereços, horários, preços, dicas locais).
- NUNCA crie dicas vazias ou com 1-2 frases genéricas.
- Se o conteúdo for curto (<500 chars), o sistema expande automaticamente via IA — mas prefira mandar completo.
- AVISO: Seu conhecimento pode estar desatualizado. Diga sempre "dados devem ser verificados" ao final.

EXCLUSÕES:
- delete_tip (dica específica), delete_destination (destino inteiro — CUIDADO, apaga dicas filhas), delete_area (BU inteira — CUIDADO).
- SEMPRE confirme com o usuário antes de delete_destination ou delete_area.

ATUALIZAÇÃO:
- update_destination para destino, update_tip para dica. NUNCA recrie se já existe — atualize.`,

  /* ═════════════════ NEWS-MONITOR ═════════════════ */
  'news-monitor': `MÓDULO NOTÍCIAS — REGRAS:

CONCEITOS (NÃO CONFUNDIR):
- NOTÍCIA (create_news) = notícias GERAIS do mercado de turismo (novos voos, tendências, destinos). Fontes: Panrotas, Mercado & Eventos, etc.
- CLIPPING (create_clipping) = menções/citações DA PRIMETOUR na mídia. Quando alguém fala SOBRE a Primetour.

BUSCA:
- "notícias sobre a Primetour" / menções / clipping → search_web_clipping.
- notícias gerais do setor (sem mencionar Primetour) → search_web_news.
- NUNCA use list_news ou list_clippings para buscar notícias NOVAS. Esses listam APENAS o banco interno.
- PRIORIDADE: search_web PRIMEIRO. Não perca tempo listando banco vazio.

CADASTRO:
- Menções sobre a PRIMETOUR → SEMPRE create_clipping (NUNCA create_news).
- Notícias gerais → create_news.
- Campos obrigatórios: title, description (1-2 frases), sourceUrl, sourceName, publishedAt (YYYY-MM-DD).
- IGNORE redes sociais (Instagram, Facebook, LinkedIn, Twitter/X) e páginas institucionais. Só matérias jornalísticas reais.

DUPLICATAS:
- Antes de cadastrar, execute list_clippings / list_news para ver o que já existe.
- Compare títulos/URLs. NÃO cadastre duplicatas.
- Pode usar search_web + list juntos (2 ações na mesma resposta).`,

  /* ═════════════════ REQUESTS ═════════════════ */
  'requests': `MÓDULO SOLICITAÇÕES — REGRAS:

CICLO DE VIDA:
- pending → approved/rejected → converted (em tarefa).

AÇÕES:
- approve_request / reject_request → moderar.
- convert_request_to_task → transformar solicitação aprovada em tarefa.
- delete_request → excluir permanentemente (irreversível, confirme com usuário).

FORMATO:
- requesterName, requesterEmail, description são obrigatórios em create_request.
- status: APENAS pending | approved | rejected | converted.
- desiredDate: YYYY-MM-DD.`,

  /* ═════════════════ CSAT ═════════════════ */
  'csat': `MÓDULO CSAT — REGRAS:

CICLO DE VIDA:
- pending → sent → responded (ou expired/cancelled).

FLUXO PARA ENVIAR PESQUISA A UM CLIENTE:
1. Execute find_tasks_without_csat para ver tarefas concluídas sem pesquisa.
2. Execute create_survey passando taskId, taskTitle, clientEmail (obrigatórios).
3. Execute send_survey com o surveyId retornado para disparar o email.
ISSO SÃO 2 PASSOS DISTINTOS — create_survey NÃO envia automaticamente.

FORMATO:
- status: APENAS pending | sent | responded | expired | cancelled.
- clientEmail é obrigatório em create_survey.

OUTRAS AÇÕES:
- cancel_survey → cancela uma pendente.
- resend_survey → reenvia com nova validade.
- get_csat_metrics → calcula score médio, NPS, taxa de resposta.`,

  /* ═════════════════ CALENDAR ═════════════════ */
  'calendar': `MÓDULO CALENDÁRIO — REGRAS:

CONCEITO:
- O calendário mostra tarefas com dueDate + eventos. Não há CRUD de "evento" separado no backend — tarefas com dueDate aparecem aqui automaticamente.

AÇÕES:
- get_today_agenda → tarefas com vencimento hoje (use para "o que tenho hoje?").
- list_events → eventos visíveis no store ou DOM.
- Para criar compromissos futuros → use create_task (do módulo tasks) com dueDate definida. NÃO invente uma ação create_event.

FORMATO:
- Datas sempre YYYY-MM-DD.`,

  /* ═════════════════ DASHBOARDS ═════════════════ */
  'dashboards': `MÓDULO DASHBOARDS — REGRAS:

ESCOPO:
- Este módulo é APENAS LEITURA/ANÁLISE. NUNCA modifique dados daqui.
- Use get_dashboard_summary para ler KPIs visíveis na tela.
- Use get_tasks_overview para análise agregada de tarefas (por status, prioridade, setor, atrasadas).
- Para criar/editar tarefas, oriente o usuário a ir ao módulo Tarefas.`,

  /* ═════════════════ GOALS ═════════════════ */
  'goals': `MÓDULO METAS — REGRAS:

CICLO DE VIDA:
- draft → publicada → encerrada.

AÇÕES:
- publish_goal → publica e notifica responsáveis (passo explícito, não é automático).
- Avaliações (evaluations) = registros periódicos de progresso.
- list_evaluations (ver), create_evaluation (registrar nova), delete_evaluation (remover).

FORMATO:
- Datas (period.start, period.end): YYYY-MM-DD.
- Metas têm keyResults (array de resultados-chave).`,

  /* ═════════════════ FEEDBACKS ═════════════════ */
  'feedbacks': `MÓDULO FEEDBACKS — REGRAS:

CONCEITO:
- Feedback = registro de elogio/sugestão/reclamação de cliente.
- Schedule = configuração de feedback recorrente automático.

AÇÕES:
- list_feedback_schedules (ver), create_feedback_schedule (criar), delete_feedback_schedule (remover).
- Para criar feedback manual, use o CRUD normal de feedbacks.

FORMATO:
- rating: número 1-5.
- category: define o tipo (elogio, sugestão, reclamação, etc).`,

  /* ═════════════════ CAPACITY ═════════════════ */
  'capacity': `MÓDULO CAPACIDADE/AUSÊNCIAS — REGRAS:

CONCEITO:
- Ausência = período em que colaborador está indisponível (férias, licença, folga, atestado).

FORMATO:
- type: vacation | leave | dayoff | sick | other.
- startDate, endDate: YYYY-MM-DD.
- userId: UID do colaborador (NUNCA nome).

FLUXOS:
- get_team_availability → verifica quem está disponível em um período (use para "quem está de férias em março?").
- Se não souber o userId, peça ao usuário antes de criar ausência.`,

  /* ═════════════════ SECTORS ═════════════════ */
  'sectors': `MÓDULO SETORES E NÚCLEOS — REGRAS:

HIERARQUIA:
- Setor → Núcleos (um núcleo pertence a um setor).

AÇÕES:
- list_nucleos (ver todos ou filtrar por setor), create_nucleo (name + sector obrigatórios), update_nucleo, delete_nucleo.

FORMATO:
- color: hex com # (ex: "#FF5733"), opcional.`,

  /* ═════════════════ WORKSPACES ═════════════════ */
  'workspaces': `MÓDULO WORKSPACES — REGRAS:

CONCEITO:
- Workspace = espaço de trabalho que agrupa tarefas e membros de um setor/projeto.

AÇÕES:
- archive_workspace → desativa (soft delete, não apaga permanentemente). Prefira esta a qualquer exclusão.
- add_workspace_member / remove_workspace_member → gerencia membros (userId é UID, nunca nome).

FORMATO:
- members: array de UIDs.
- icon: um emoji único.`,

  /* ═════════════════ TASK-TYPES ═════════════════ */
  'task-types': `MÓDULO TIPOS DE TAREFA — REGRAS:

CONCEITO:
- Tipo de tarefa = template reutilizável com variações (sub-tipos), campos customizados e SLA.
- Ex: "Newsletter" tem variações "Domingo", "Quarta" e campos "newsletterStatus", "outOfCalendar".

ESTRUTURA COMPLEXA:
- variations: array de { name, slaHours, color }.
- fields: array de { key, label, type (text|number|select|checkbox|date), options }.

FLUXOS:
- Antes de criar tipo novo, execute list_task_types_full para ver se já existe.
- Ao passar fields/variations, SEMPRE use arrays (mesmo com 1 item).
- Antes de excluir, verifique se há tarefas usando esse tipo — senão as tarefas ficam órfãs.`,

  /* ═════════════════ TASK-CATEGORIES ═════════════════ */
  'task-categories': `MÓDULO CATEGORIAS DE TAREFA — REGRAS:

CONCEITO:
- Categoria = agrupamento visual de tipos de tarefa (ex: "Marketing", "Operações", "Financeiro").
- Cada categoria tem nome, setor e cor.

FORMATO:
- color: hex com #.
- sector: obrigatório para vincular categoria a um setor.`,

  /* ═════════════════ CONTENT ═════════════════ */
  'content': `MÓDULO GESTÃO DE CONTEÚDO — REGRAS:

ESCOPO ATUAL:
- Apenas leitura de métricas visíveis via get_content_metrics.
- Para criar/editar conteúdo, oriente o usuário a usar a página específica (ainda não há CRUD via IA).
- Foque em análise: performance, alcance, engajamento baseado nos KPIs da tela.`,

  /* ═════════════════ GENERAL ═════════════════ */
  'general': `MÓDULO GERAL (modo livre) — REGRAS:

ESCOPO:
- Ferramentas utilitárias: busca web, resumos, análise de texto, cálculos.
- NÃO modifique dados do sistema a partir daqui — se o usuário pedir para criar/editar algo específico (tarefa, dica, projeto), oriente a ir ao módulo correspondente.
- Para perguntas sobre o sistema em si (ajuda, navegação), responda diretamente sem ações.`,
};

/* ─── Configuração de API Keys (multi-escopo) ───────────── */
/*
 * Hierarquia de resolução (maior prioridade primeiro):
 *   1. Usuário  → ai_api_keys/{scope:'user',   scopeId: uid}
 *   2. Núcleo   → ai_api_keys/{scope:'nucleo', scopeId: nucleoValue}
 *   3. Área     → ai_api_keys/{scope:'area',   scopeId: areaName}
 *   4. Global   → system_config/ai-config  (legado, compatível)
 */
const CONFIG_DOC_ID   = 'ai-config';
const API_KEYS_COL    = 'ai_api_keys';

/** Carrega config global (legado — mantido para compatibilidade) */
export async function getAIConfig() {
  try {
    const snap = await getDoc(doc(db, 'system_config', CONFIG_DOC_ID));
    return snap.exists() ? snap.data() : null;
  } catch { return null; }
}

/** Salva config global (legado) */
export async function saveAIConfig(data) {
  const user = store.get('currentUser');
  await updateDoc(doc(db, 'system_config', CONFIG_DOC_ID), {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: user?.uid || null,
  }).catch(async () => {
    const { setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    await setDoc(doc(db, 'system_config', CONFIG_DOC_ID), {
      ...data,
      createdAt: serverTimestamp(),
      createdBy: user?.uid || null,
      updatedAt: serverTimestamp(),
    });
  });
}

/* ─── CRUD: Configurações de API por Escopo ──────────────── */

/**
 * Busca config de API key por escopo (user, nucleo, area)
 * Para 'area' busca usando array-contains em scopeIds.
 * @param {'user'|'nucleo'|'area'} scope
 * @param {string} scopeId — uid, nucleoValue ou areaName
 */
export async function getScopedApiConfig(scope, scopeId) {
  try {
    let q2;
    if (scope === 'area') {
      // Área usa scopeIds (array) — busca com array-contains
      q2 = query(
        collection(db, API_KEYS_COL),
        where('scope', '==', 'area'),
        where('scopeIds', 'array-contains', scopeId),
      );
    } else {
      q2 = query(
        collection(db, API_KEYS_COL),
        where('scope', '==', scope),
        where('scopeId', '==', scopeId),
      );
    }
    const snap = await getDocs(q2);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
  } catch { return null; }
}

/** Lista TODAS as configurações de escopo (para admin) */
export async function listAllScopedConfigs() {
  try {
    const snap = await getDocs(query(collection(db, API_KEYS_COL), orderBy('scope')));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
}

/**
 * Salva/atualiza config de escopo.
 * Para scope='area', scopeId pode ser um array de áreas (múltiplas áreas).
 */
export async function saveScopedApiConfig(scope, scopeId, scopeLabel, data) {
  const user = store.get('currentUser');

  const payload = {
    ...data,
    scope,
    active: data.active !== false,
    updatedAt: serverTimestamp(),
    updatedBy: user?.uid || null,
  };

  if (scope === 'area') {
    // Área: scopeId é um array de áreas selecionadas
    const areaIds = Array.isArray(scopeId) ? scopeId : [scopeId];
    payload.scopeIds   = areaIds;
    payload.scopeId    = areaIds.join(', '); // para display / compatibilidade
    payload.scopeLabel = scopeLabel || areaIds.join(', ');

    // Buscar doc existente que contenha QUALQUER dessas áreas
    let existing = null;
    for (const aid of areaIds) {
      existing = await getScopedApiConfig('area', aid);
      if (existing) break;
    }

    if (existing) {
      await updateDoc(doc(db, API_KEYS_COL, existing.id), payload);
    } else {
      payload.createdAt = serverTimestamp();
      payload.createdBy = user?.uid || null;
      await addDoc(collection(db, API_KEYS_COL), payload);
    }
  } else {
    // User / Núcleo: escopo simples
    payload.scopeId    = scopeId;
    payload.scopeLabel = scopeLabel;

    const existing = await getScopedApiConfig(scope, scopeId);
    if (existing) {
      await updateDoc(doc(db, API_KEYS_COL, existing.id), payload);
    } else {
      payload.createdAt = serverTimestamp();
      payload.createdBy = user?.uid || null;
      await addDoc(collection(db, API_KEYS_COL), payload);
    }
  }
}

/** Remove config de escopo */
export async function deleteScopedApiConfig(docId) {
  await deleteDoc(doc(db, API_KEYS_COL, docId));
}

/**
 * Resolve a API key com cascata de prioridade:
 *   Usuário → Núcleo(s) → Área(s) → Global
 * Retorna { config, apiKey, resolvedFrom, label }.
 */
export async function resolveApiKey(provider) {
  const user    = store.get('currentUser');
  const profile = store.get('currentProfile') || {};
  // Para provider 'local', a "key" é o endpoint (não precisa de API key real)
  const extractKey = (cfg) => {
    if (provider === 'local') return cfg?.localEndpoint || cfg?.localApiKey || 'local';
    return cfg?.[provider + 'ApiKey'] || '';
  };

  // 1. Nível USUÁRIO
  if (user?.uid) {
    const userCfg = await getScopedApiConfig('user', user.uid);
    if (userCfg?.active !== false) {
      const k = extractKey(userCfg);
      if (k) return { config: userCfg, apiKey: k, resolvedFrom: 'user', label: profile.name || user.email };
    }
  }

  // 2. Nível NÚCLEO (usuário pode pertencer a múltiplos — testa todos)
  const userNucleos = profile.nucleos || (profile.nucleo ? [profile.nucleo] : []);
  for (const nuc of userNucleos) {
    const nucCfg = await getScopedApiConfig('nucleo', nuc);
    if (nucCfg?.active !== false) {
      const k = extractKey(nucCfg);
      if (k) return { config: nucCfg, apiKey: k, resolvedFrom: 'nucleo', label: nucCfg.scopeLabel || nuc };
    }
  }

  // 3. Nível ÁREA — busca por cada área do usuário (sector, visibleSectors)
  //    Como area usa scopeIds (array), uma config pode cobrir múltiplas áreas
  const userAreas = new Set();
  if (profile.sector) userAreas.add(profile.sector);
  if (profile.department) userAreas.add(profile.department);
  (profile.visibleSectors || []).forEach(s => userAreas.add(s));

  for (const area of userAreas) {
    const areaCfg = await getScopedApiConfig('area', area);
    if (areaCfg?.active !== false) {
      const k = extractKey(areaCfg);
      if (k) return { config: areaCfg, apiKey: k, resolvedFrom: 'area', label: areaCfg.scopeLabel || area };
    }
  }

  // 4. Nível GLOBAL (fallback — legado)
  const globalCfg = await getAIConfig();
  const k = extractKey(globalCfg);
  return { config: globalCfg, apiKey: k || '', resolvedFrom: 'global', label: 'Global' };
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
    folder:    data.folder?.trim() || '',
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
  let config = await getAIConfig();
  const skill  = await getSkill(skillId);
  if (!skill) throw new Error('Skill não encontrada.');

  // ── LGPD: verificar consentimento e anonimizar PII ──
  let _piiMapping = null;
  let _piiAnonymized = false;
  let _consentVersion = null;
  try {
    const { checkConsent, shouldAnonymize, anonymizeContext, isProviderAllowed, getPreferredProvider }
      = await import('./aiDataGuard.js');
    const consent = await checkConsent();
    if (!consent.consented) throw new Error('AI_CONSENT_REQUIRED');
    _consentVersion = consent.version;

    // Verificar se deve anonimizar para este módulo
    if (await shouldAnonymize(skill.module)) {
      const anon = anonymizeContext(context, skill.module);
      context = anon.anonymized;
      _piiMapping = anon.mapping;
      _piiAnonymized = Object.keys(anon.mapping).length > 0;
    }
  } catch (e) {
    if (e.message === 'AI_CONSENT_REQUIRED') throw e;
    /* aiDataGuard indisponível — continuar sem proteção */
  }

  // Montar o prompt do usuário com variáveis do contexto
  let userPrompt = skill.userPromptTemplate || '';
  for (const [key, val] of Object.entries(context)) {
    userPrompt = userPrompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val ?? ''));
  }
  // Limpar variáveis não preenchidas
  userPrompt = userPrompt.replace(/\{\{[^}]+\}\}/g, '').trim();

  // Determinar provider
  const provider = skill.provider || config?.provider || 'gemini';

  // Resolver API key com cascata: Usuário → Núcleo → Área → Global
  const resolved = await resolveApiKey(provider);
  const apiKey = resolved.apiKey;
  if (!apiKey) {
    return mockResponse(skill, userPrompt);
  }
  // Se a config resolvida tem azureEndpoint, usar ela (para o provider Azure)
  if (resolved.config?.azureEndpoint && !config?.azureEndpoint) {
    config = { ...config, azureEndpoint: resolved.config.azureEndpoint };
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

  // Carregar documento de tom de voz (se vinculado)
  let voiceContext = '';
  if (skill.voiceDocId) {
    const voiceDoc = await getKnowledgeDoc(skill.voiceDocId).catch(() => null);
    if (voiceDoc) {
      voiceContext = `\n\n=== MANUAL DE TOM DE VOZ / REDAÇÃO ===\nSiga RIGOROSAMENTE as diretrizes abaixo para tom de voz, estilo e redação:\n\n${voiceDoc.content}\n=== FIM DO MANUAL ===`;
    }
  }

  // Montar system prompt enriquecido
  const systemParts = [];
  if (skill.systemPrompt) systemParts.push(skill.systemPrompt);
  if (voiceContext) systemParts.push(voiceContext);
  if (knowledgeContext) systemParts.push('Use a base de conhecimento abaixo como referência principal para suas respostas. Priorize informações da base sobre conhecimento geral.' + knowledgeContext);
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
    case 'openai':
      result = await callOpenAI({ apiKey, model, maxTokens, systemPrompt, userPrompt, temperature: skill.temperature });
      break;
    case 'azure':
      result = await callAzure({ config, apiKey, model, maxTokens, systemPrompt, userPrompt, temperature: skill.temperature });
      break;
    default:
      result = await callAnthropic({ apiKey, model, maxTokens, systemPrompt, userPrompt, temperature: skill.temperature });
  }

  // ── LGPD: restaurar PII na resposta ──
  let finalText = result.text;
  if (_piiMapping && Object.keys(_piiMapping).length) {
    try {
      const { restoreText } = await import('./aiDataGuard.js');
      finalText = restoreText(result.text, _piiMapping);
    } catch { /* fallback: texto sem restauração */ }
  }

  // Log de uso (silencioso) — inclui escopo da key usada + LGPD metadata
  logUsage(skill, {
    ...result, provider,
    keyScope: resolved.resolvedFrom, keyScopeLabel: resolved.label,
    piiAnonymized: _piiAnonymized, consentVersion: _consentVersion,
  }).catch(() => {});

  return {
    text:         finalText,
    model:        result.model,
    provider,
    inputTokens:  result.inputTokens,
    outputTokens: result.outputTokens,
    skillId:      skill.id,
    skillName:    skill.name,
    keyScope:     resolved.resolvedFrom,
    keyScopeLabel: resolved.label,
  };
}

/**
 * Chat livre com IA — mensagem do usuário no contexto de um módulo.
 * Usa a config global (provider padrão, API key resolvida em cascata).
 * Inclui ações disponíveis no system prompt para o módulo atual.
 * @param {string} userMessage — texto digitado pelo usuário
 * @param {Object} context — contexto do módulo (dados da página atual)
 * @param {Object} [opts] — { moduleId, history[] }
 */
export async function chatWithAI(userMessage, context = {}, opts = {}) {
  let config = await getAIConfig() || {};
  const provider = config?.provider || 'gemini';

  // ── LGPD: verificar consentimento e anonimizar PII ──
  let _chatPiiMapping = null;
  let _chatPiiAnonymized = false;
  let _chatConsentVersion = null;
  try {
    const { checkConsent, shouldAnonymize, anonymizeContext, anonymizeText, isProviderAllowed }
      = await import('./aiDataGuard.js');
    const consent = await checkConsent();
    if (!consent.consented) throw new Error('AI_CONSENT_REQUIRED');
    _chatConsentVersion = consent.version;

    // Verificar provider
    if (!(await isProviderAllowed(provider))) {
      return { text: `Provider "${provider}" não autorizado pela política de privacidade.`, model: 'none', provider, inputTokens: 0, outputTokens: 0, isMock: true };
    }

    // Anonimizar contexto e mensagem do usuário
    const moduleId = opts.moduleId || 'general';
    if (await shouldAnonymize(moduleId)) {
      const anonCtx = anonymizeContext(context, moduleId);
      context = anonCtx.anonymized;
      _chatPiiMapping = { ...anonCtx.mapping };
      // Anonimizar a própria mensagem do user
      const anonMsg = anonymizeText(userMessage);
      userMessage = anonMsg.anonymized;
      Object.assign(_chatPiiMapping, anonMsg.mapping);
      _chatPiiAnonymized = Object.keys(_chatPiiMapping).length > 0;
    }
  } catch (e) {
    if (e.message === 'AI_CONSENT_REQUIRED') throw e;
    /* aiDataGuard indisponível — continuar sem proteção */
  }

  const resolved = await resolveApiKey(provider);
  const apiKey = resolved.apiKey;
  // Provider local não precisa de API key — usa localEndpoint
  if (!apiKey && provider !== 'local') {
    return {
      text: '[SEM API KEY CONFIGURADA]\n\nConfigure uma API Key em IA Skills → Configurar API para usar o chat.',
      model: 'none', provider, inputTokens: 0, outputTokens: 0, isMock: true,
    };
  }
  if (resolved.config?.azureEndpoint) config = { ...config, azureEndpoint: resolved.config.azureEndpoint };

  // System prompt contextual
  const moduleLabel = MODULE_REGISTRY[opts.moduleId]?.label || opts.moduleId || 'Sistema';
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
  const tomorrowStr = new Date(today.getTime() + 86400000).toISOString().split('T')[0];
  const todayBR = today.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const systemParts = [
    `Assistente IA PRIMETOUR — módulo "${moduleLabel}". Hoje: ${todayStr} (${todayBR}). Amanhã: ${tomorrowStr}.`,
    `Responda em pt-BR, conciso (1-2 frases + ação). SEMPRE execute ações, NUNCA diga "eu faria". NUNCA invente IDs — use APENAS IDs do histórico (>>> ID_CRIADO="xxx" <<<). Se não souber o ID, faça list_ primeiro. NUNCA preencha params opcionais com valores inventados — omita-os. Formato OBRIGATÓRIO: <<<ACTION>>>{"action":"x","params":{}}<<<END_ACTION>>> — SEMPRE feche com <<<END_ACTION>>>. Pode usar MÚLTIPLOS blocos <<<ACTION>>> na mesma resposta para executar várias ações de uma vez.`,
  ];

  // Orientações específicas por módulo — carregadas do Firestore com fallback para DEFAULT_MODULE_HINTS.
  // Gerenciadas pela aba "Prompts por Módulo" na página IA Skills.
  let moduleHint = DEFAULT_MODULE_HINTS[opts.moduleId] || '';
  try {
    const { getModuleHint } = await import('./aiModuleHints.js');
    const customHint = await getModuleHint(opts.moduleId);
    if (typeof customHint === 'string' && customHint.trim()) moduleHint = customHint;
  } catch (_) { /* serviço indisponível — usa fallback */ }
  if (moduleHint) systemParts.push(moduleHint);

  // Adicionar contexto do módulo (excluir __fileContext do JSON)
  const fileContext = context?.__fileContext || '';
  const moduleContext = { ...context };
  delete moduleContext.__fileContext;
  if (moduleContext && Object.keys(moduleContext).length) {
    systemParts.push(`\n=== CONTEXTO DO MÓDULO (${moduleLabel}) ===\n${JSON.stringify(moduleContext, null, 2)}\n=== FIM DO CONTEXTO ===`);
  }

  // Adicionar conteúdo de arquivos anexados (separado do contexto do módulo)
  if (fileContext) {
    systemParts.push(fileContext);
  }

  // Adicionar ações disponíveis para o módulo
  try {
    const { formatActionsForPrompt } = await import('./aiActions.js');
    const actionsPrompt = formatActionsForPrompt(opts.moduleId || 'general');
    if (actionsPrompt) systemParts.push(actionsPrompt);
  } catch (e) { /* aiActions não disponível, continuar sem ações */ }

  // Histórico de conversa (para continuidade) — limitar para economizar tokens
  const history = opts.history || [];
  let fullUserPrompt = userMessage;
  if (history.length) {
    // Compactar histórico: manter últimas 6 mensagens, truncar textos longos
    const recentHistory = history.slice(-6).map(h => {
      const truncated = h.text.length > 300 ? h.text.substring(0, 300) + '...' : h.text;
      return `${h.role === 'user' ? 'Usuário' : 'Assistente'}: ${truncated}`;
    });
    fullUserPrompt = `Histórico:\n${recentHistory.join('\n')}\n\nUsuário: ${userMessage}`;
  }

  // Se opts.systemPrompt foi fornecido, usa ele diretamente (sem actions/hints do módulo)
  const systemPrompt = opts.systemPrompt || systemParts.join('\n');
  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.gemini;
  const model     = opts.model || config?.defaultModel || defaults.model;
  // Usar maxTokens configurado, com mínimo razoável de 2048 (antes era 4096 — desperdiçava tokens)
  const maxTokens = opts.maxTokens || config?.defaultMaxTokens || defaults.maxTokens || 2048;
  const temperature = opts.temperature ?? 0.7;

  let result;
  switch (provider) {
    case 'gemini':
      result = await callGemini({ apiKey, model, maxTokens, systemPrompt, userPrompt: fullUserPrompt, temperature });
      break;
    case 'groq':
      result = await callGroq({ apiKey, model, maxTokens, systemPrompt, userPrompt: fullUserPrompt, temperature });
      break;
    case 'openai':
      result = await callOpenAI({ apiKey, model, maxTokens, systemPrompt, userPrompt: fullUserPrompt, temperature });
      break;
    case 'azure':
      result = await callAzure({ config, apiKey, model, maxTokens, systemPrompt, userPrompt: fullUserPrompt, temperature });
      break;
    case 'local':
      result = await callLocal({ config: resolved.config, apiKey, model, maxTokens, systemPrompt, userPrompt: fullUserPrompt, temperature });
      break;
    default:
      result = await callAnthropic({ apiKey, model, maxTokens, systemPrompt, userPrompt: fullUserPrompt, temperature });
  }

  // ── LGPD: restaurar PII na resposta ──
  let chatFinalText = result.text;
  if (_chatPiiMapping && Object.keys(_chatPiiMapping).length) {
    try {
      const { restoreText } = await import('./aiDataGuard.js');
      chatFinalText = restoreText(result.text, _chatPiiMapping);
    } catch { /* fallback */ }
  }

  // Log silencioso + LGPD metadata
  logUsage({ id: 'chat', name: 'Chat Livre', module: opts.moduleId || 'general' }, {
    ...result, provider,
    keyScope: resolved.resolvedFrom, keyScopeLabel: resolved.label,
    piiAnonymized: _chatPiiAnonymized, consentVersion: _chatConsentVersion,
  }).catch(() => {});

  return { text: chatFinalText, model: result.model, provider, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
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

/* ─── Provider: OpenAI (ChatGPT) ─────────────────────────── */
async function callOpenAI({ apiKey, model, maxTokens, systemPrompt, userPrompt, temperature }) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });

  const body = { model, messages, max_tokens: maxTokens };
  if (temperature != null) body.temperature = temperature;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Erro OpenAI: ${response.status}`);
  }

  const data = await response.json();
  return {
    text:         data.choices?.[0]?.message?.content || '',
    model:        data.model || model,
    inputTokens:  data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
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

/* ─── Provider: Local (Ollama / vLLM / TGI) ─────────────── */
async function callLocal({ config, apiKey, model, maxTokens, systemPrompt, userPrompt, temperature }) {
  // Endpoint configurável — padrão: Ollama na porta 11434
  const endpoint = config?.localEndpoint
    || config?.azureEndpoint  // campo reutilizado se vier de config legada
    || 'http://localhost:11434';

  // Detectar tipo de API: Ollama nativo vs OpenAI-compatible
  const isOllamaApi = endpoint.includes('11434') && !endpoint.includes('/v1');

  try {
    if (isOllamaApi) {
      // ─── Ollama API nativa (/api/chat) ───
      const body = {
        model,
        messages: [],
        stream: false,
        options: {
          num_predict: maxTokens,
        },
      };
      if (temperature != null) body.options.temperature = temperature;
      if (systemPrompt) body.messages.push({ role: 'system', content: systemPrompt });
      body.messages.push({ role: 'user', content: userPrompt });

      const url = endpoint.replace(/\/+$/, '') + '/api/chat';
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey && apiKey !== 'local') headers['Authorization'] = `Bearer ${apiKey}`;

      // Timeout de 90s para modelos locais (podem ser lentos dependendo do hardware)
      const LOCAL_TIMEOUT = 90000;

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(LOCAL_TIMEOUT),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => String(response.status));
        throw new Error(`Erro servidor local (${response.status}): ${errText}`);
      }

      const data = await response.json();
      return {
        text:         data.message?.content || '',
        model:        data.model || model,
        inputTokens:  data.prompt_eval_count || 0,
        outputTokens: data.eval_count || 0,
      };
    } else {
      // ─── OpenAI-compatible API (/v1/chat/completions) ───
      // Funciona com: vLLM, text-generation-inference, LiteLLM, LocalAI, Ollama (modo OpenAI)
      const messages = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: userPrompt });

      const body = { model, messages, max_tokens: maxTokens };
      if (temperature != null) body.temperature = temperature;

      const url = endpoint.replace(/\/+$/, '') + '/v1/chat/completions';
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey && apiKey !== 'local') headers['Authorization'] = `Bearer ${apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(LOCAL_TIMEOUT),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => String(response.status));
        throw new Error(`Erro servidor local (${response.status}): ${errText}`);
      }

      const data = await response.json();
      return {
        text:         data.choices?.[0]?.message?.content || '',
        model:        data.model || model,
        inputTokens:  data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      };
    }
  } catch (err) {
    // Timeout — modelo demorou demais para responder
    if (err.name === 'TimeoutError' || err.message?.includes('signal') || err.message?.includes('abort')) {
      throw new Error(
        `O modelo local demorou demais para responder (timeout de 90s).\n\n` +
        `Possíveis causas:\n` +
        `1. Modelo muito grande para seu hardware → tente um modelo menor (qwen2.5 ou llama3:8b)\n` +
        `2. Outra requisição em andamento → aguarde e tente novamente\n` +
        `3. Computador sobrecarregado → feche apps pesados e tente novamente`
      );
    }
    // Detectar erro de CORS ou servidor offline (ambos geram TypeError: Failed to fetch)
    if (err.name === 'TypeError' || err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
      throw new Error(
        `Não foi possível conectar ao servidor local (${endpoint}).\n\n` +
        `Possíveis causas:\n` +
        `1. Ollama não está rodando → abra o app Ollama ou execute "ollama serve"\n` +
        `2. CORS bloqueado → configure: launchctl setenv OLLAMA_ORIGINS "*" e reinicie o Ollama\n` +
        `3. Endereço incorreto → verifique o endpoint nas configurações de IA`
      );
    }
    throw err;
  }
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
    skillId:        skill.id,
    skillName:      skill.name,
    module:         skill.module,
    provider:       result.provider || 'anthropic',
    model:          result.model || '',
    inputTokens:    result.inputTokens || 0,
    outputTokens:   result.outputTokens || 0,
    userId:         user?.uid || null,
    keyScope:       result.keyScope || 'global',
    keyScopeLabel:  result.keyScopeLabel || 'Global',
    // LGPD metadata
    piiAnonymized:  result.piiAnonymized || false,
    consentVersion: result.consentVersion || null,
    timestamp:      serverTimestamp(),
  });
}
