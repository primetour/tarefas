/**
 * PRIMETOUR — Help Panel (Drawer)
 * Painel lateral de ajuda com Q&A organizado por módulo e busca instantânea
 */

import { store } from '../store.js';

const esc = s => String(s || '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ─── Base de conhecimento Q&A ──────────────────────────── */
const HELP_CATEGORIES = [
  {
    id: 'getting-started',
    icon: '🚀',
    title: 'Primeiros Passos',
    items: [
      {
        q: 'Como faço login no sistema?',
        a: 'Acesse a tela de login com seu email e senha cadastrados. Se for seu primeiro acesso, você verá um assistente de boas-vindas para configurar seu perfil e workspace.',
      },
      {
        q: 'O que é um workspace?',
        a: 'Workspace (ou Squad) é um espaço de trabalho compartilhado pela equipe. Ele agrupa tarefas, projetos e membros de um setor ou time. Você pode participar de vários workspaces simultaneamente.',
      },
      {
        q: 'Como altero minha senha?',
        a: 'Clique no seu avatar no canto superior direito e selecione "Alterar Senha". Você também pode acessar pelo menu Meu Perfil.',
      },
      {
        q: 'Como personalizo a aparência do sistema?',
        a: 'Clique no ícone 🎨 no header para escolher entre 9 paletas de cores e 7 fontes diferentes. Sua preferência é salva automaticamente no perfil.',
      },
      {
        q: 'Como funciona a busca global?',
        a: 'Use o campo de busca no header para encontrar tarefas, projetos, usuários, dicas do portal, solicitações, metas, pesquisas CSAT, imagens e notícias. A busca pesquisa em todos os módulos simultaneamente.',
      },
      {
        q: 'O que são as notificações?',
        a: 'O sino 🔔 no header mostra notificações em tempo real: atribuições de tarefas, mudanças de status, prazos vencendo, feedbacks recebidos, entre outros. Você pode filtrar por categoria e marcar como lidas.',
      },
    ],
  },
  {
    id: 'tasks',
    icon: '✓',
    title: 'Tarefas',
    items: [
      {
        q: 'Como criar uma nova tarefa?',
        a: 'Na página de Tarefas, clique no botão "+ Nova Tarefa". Preencha título, descrição, tipo, responsável, prioridade e prazo. Você também pode criar tarefas a partir de solicitações.',
      },
      {
        q: 'Quais são os status possíveis de uma tarefa?',
        a: 'Os status seguem um fluxo: Não iniciada → Em andamento → Em revisão → Concluída. Também pode ir para Retrabalho (volta para Em andamento) ou Cancelada. O sistema valida as transições automaticamente.',
      },
      {
        q: 'Como filtrar tarefas?',
        a: 'Use a barra de filtros para combinar: status, prioridade, responsável, projeto, período, setor e tipo. Você pode salvar filtros frequentes como presets.',
      },
      {
        q: 'O que são subtasks?',
        a: 'Subtasks são sub-etapas de uma tarefa. O sistema gera subtasks automaticamente baseado no tipo de tarefa selecionado (ex: briefing, criação, revisão, aprovação). Ao concluir todas as subtasks, a tarefa avança de status.',
      },
      {
        q: 'O que é SLA e como funciona o alerta?',
        a: 'SLA é o prazo de entrega da tarefa. O sistema envia alertas automáticos: 1 dia antes (alerta amarelo) e no dia do vencimento (alerta vermelho). Tarefas atrasadas são destacadas na listagem.',
      },
      {
        q: 'O que acontece quando uma tarefa é concluída?',
        a: 'Ao marcar como concluída, se houver email de cliente vinculado, o sistema pode enviar automaticamente uma pesquisa CSAT. Tarefas concluídas há mais de 30 dias são auto-arquivadas.',
      },
      {
        q: 'O que é o nudge de tarefas paradas?',
        a: 'O sistema detecta tarefas sem movimentação: 5 dias em andamento, 3 dias em revisão ou 7 dias não iniciadas, e envia notificações ao responsável.',
      },
      {
        q: 'Como funciona o Smart Defaults?',
        a: 'Ao criar uma tarefa, o sistema lembra suas escolhas anteriores (projeto, prioridade, tipo) e pré-preenche automaticamente. Você pode alterar a qualquer momento.',
      },
    ],
  },
  {
    id: 'projects',
    icon: '◈',
    title: 'Projetos',
    items: [
      {
        q: 'Como criar um projeto?',
        a: 'Acesse a página Projetos e clique em "+ Novo Projeto". Defina nome, descrição, cor/ícone, membros e datas. As tarefas podem ser vinculadas a projetos para organização.',
      },
      {
        q: 'Como acompanhar o progresso de um projeto?',
        a: 'Na página do projeto você vê: total de tarefas, concluídas, em andamento, percentual de progresso, e o prazo. Use o Kanban ou Timeline para visualizar o fluxo.',
      },
    ],
  },
  {
    id: 'kanban',
    icon: '▤',
    title: 'Kanban',
    items: [
      {
        q: 'Como funciona o Kanban?',
        a: 'O Kanban exibe tarefas em colunas por status (Não iniciada, Em andamento, Revisão, Concluída). Permite visualizar o fluxo de trabalho de forma rápida.',
      },
      {
        q: 'Posso personalizar a visualização?',
        a: 'Sim. Você pode alternar entre visão por status ou por pipeline do tipo de tarefa. Também é possível filtrar por projeto, responsável e prioridade.',
      },
    ],
  },
  {
    id: 'calendar',
    icon: '◷',
    title: 'Calendário',
    items: [
      {
        q: 'O que o calendário mostra?',
        a: 'O calendário exibe tarefas por data de prazo nas visualizações mensal, semanal e diária. Possui modo padrão e modo pipeline para acompanhar entregas.',
      },
      {
        q: 'Posso criar tarefas pelo calendário?',
        a: 'Sim. Clique em uma data para criar uma tarefa já com o prazo preenchido. Tarefas existentes podem ser editadas clicando nelas.',
      },
    ],
  },
  {
    id: 'timeline',
    icon: '━',
    title: 'Timeline / Gantt',
    items: [
      {
        q: 'Para que serve a timeline?',
        a: 'A timeline (gráfico de Gantt) mostra projetos e tarefas em uma linha temporal, permitindo visualizar sobreposições, dependências e o cronograma geral.',
      },
    ],
  },
  {
    id: 'workspaces',
    icon: '▤',
    title: 'Workspaces / Squads',
    items: [
      {
        q: 'Como criar um workspace?',
        a: 'Administradores e gerentes podem criar workspaces na página Squads. Defina nome, setor vinculado e adicione membros. Cada workspace tem suas próprias tarefas e projetos.',
      },
      {
        q: 'Posso participar de mais de um workspace?',
        a: 'Sim. Você pode pertencer a vários workspaces e alternar entre eles. O workspace ativo aparece no seletor do sidebar.',
      },
      {
        q: 'Como adicionar membros ao workspace?',
        a: 'Na página do workspace, use o botão de convidar membros. Você pode buscar por nome ou email de usuários já cadastrados no sistema.',
      },
    ],
  },
  {
    id: 'requests',
    icon: '◌',
    title: 'Solicitações',
    items: [
      {
        q: 'O que é uma solicitação?',
        a: 'Solicitações são pedidos de trabalho que chegam de outros setores ou clientes. Elas passam por triagem antes de se tornarem tarefas. Status: Pendente → Convertida em tarefa ou Rejeitada.',
      },
      {
        q: 'Como converter uma solicitação em tarefa?',
        a: 'Abra a solicitação e clique em "Converter em Tarefa". O sistema preenche os campos automaticamente. Você também pode usar "Converter com IA" para preencher de forma inteligente com sugestões.',
      },
      {
        q: 'Quem pode criar solicitações?',
        a: 'Qualquer usuário autenticado pode criar solicitações, mesmo sem acesso ao módulo de tarefas. Solicitações chegam à equipe responsável para triagem.',
      },
    ],
  },
  {
    id: 'team',
    icon: '◎',
    title: 'Equipe e Capacidade',
    items: [
      {
        q: 'O que vejo na página Equipe?',
        a: 'Perfis dos membros, suas tarefas atribuídas, carga de trabalho e disponibilidade. Administradores podem gerenciar ausências e férias.',
      },
      {
        q: 'Como registrar férias ou ausência?',
        a: 'No módulo de Capacidade (dentro de Equipe), registre períodos de ausência, férias ou home office. Isso ajuda o gestor a distribuir tarefas adequadamente.',
      },
    ],
  },
  {
    id: 'feedbacks',
    icon: '◈',
    title: 'Feedbacks',
    items: [
      {
        q: 'Como registrar um feedback?',
        a: 'Na página Feedbacks, clique em "+ Novo Feedback". Você pode digitar manualmente ou gravar/enviar um áudio que será transcrito automaticamente via IA e os campos preenchidos.',
      },
      {
        q: 'Como funciona a transcrição de áudio?',
        a: 'Clique no botão de microfone para gravar ou faça upload de um arquivo de áudio. O sistema transcreve usando Whisper (Groq) e analisa o conteúdo com IA para extrair: tema, destaques, pontos de melhoria e plano de ação.',
      },
    ],
  },
  {
    id: 'goals',
    icon: '◎',
    title: 'Metas',
    items: [
      {
        q: 'Como criar metas?',
        a: 'Acesse o módulo Metas e defina: título, descrição, escopo (setor/núcleo), período de avaliação e indicadores (KPIs). As metas podem ser acompanhadas com progresso percentual.',
      },
      {
        q: 'Como acompanhar o progresso?',
        a: 'Cada meta possui indicadores mensuráveis. Atualize o progresso periodicamente. A visualização mostra percentual atingido vs. esperado por período.',
      },
    ],
  },
  {
    id: 'csat',
    icon: '★',
    title: 'CSAT — Satisfação',
    items: [
      {
        q: 'O que é CSAT?',
        a: 'CSAT (Customer Satisfaction) mede a satisfação dos clientes após a entrega de uma tarefa. O sistema envia pesquisas por email com avaliação de 1 a 5 estrelas + comentário.',
      },
      {
        q: 'Como enviar pesquisas CSAT?',
        a: 'As pesquisas podem ser enviadas automaticamente (ao concluir tarefas com email de cliente) ou manualmente em conjunto pela página CSAT. O link de avaliação funciona sem login.',
      },
      {
        q: 'Onde vejo os resultados?',
        a: 'Na página CSAT você encontra: score médio, total de respostas, evolução temporal, notas por responsável e comentários dos clientes.',
      },
    ],
  },
  {
    id: 'dashboards',
    icon: '◫',
    title: 'Dashboards e Análise',
    items: [
      {
        q: 'Quais dashboards existem?',
        a: 'O sistema possui dashboards de: Produtividade (tarefas), Newsletters, Instagram, Google Analytics, Portal de Dicas, Roteiros e Inteligência Artificial. Cada um com KPIs e gráficos específicos.',
      },
      {
        q: 'Como funciona o dashboard de produtividade?',
        a: 'Mostra KPIs como: tarefas por período, taxa de conclusão, distribuição por status/prioridade, velocidade de entrega, heatmap semanal e ranking de produtividade.',
      },
      {
        q: 'Posso exportar dados dos dashboards?',
        a: 'Sim. Os dashboards que suportam exportação permitem download em XLSX ou PDF, dependendo do módulo.',
      },
    ],
  },
  {
    id: 'portal',
    icon: '✈',
    title: 'Portal de Dicas',
    items: [
      {
        q: 'O que é o Portal de Dicas?',
        a: 'Plataforma de conteúdo sobre destinos de viagem. Organizado por áreas (BUs), continentes, países e cidades. Cada destino tem dicas com segmentos: atrações, restaurantes, hotéis, informações gerais, etc.',
      },
      {
        q: 'Como criar uma dica?',
        a: 'Acesse "Dicas Cadastradas" e clique em "+ Nova Dica". Selecione continente, país e cidade. Preencha os segmentos desejados (atrações, restaurantes, info geral...). Cada segmento tem formato próprio.',
      },
      {
        q: 'Quais formatos de exportação estão disponíveis?',
        a: 'As dicas podem ser exportadas como: PDF (documento formatado), PPTX (apresentação), DOCX (Word) e Web Link (página online compartilhável com contagem de acessos).',
      },
      {
        q: 'Como funciona o banco de imagens?',
        a: 'O banco de imagens armazena fotos por destino (continente/país/cidade). Imagens são convertidas para WebP automaticamente. Podem ser usadas nas dicas, roteiros e artes.',
      },
      {
        q: 'O que são áreas/BUs?',
        a: 'Áreas representam as unidades de negócio (BUs) da empresa. Cada área tem identidade visual própria (cores, logo) que é aplicada nos materiais exportados.',
      },
    ],
  },
  {
    id: 'roteiros',
    icon: '✈',
    title: 'Roteiros de Viagem',
    items: [
      {
        q: 'O que é o módulo de Roteiros?',
        a: 'Permite criar roteiros de viagem completos e personalizados para clientes. Inclui: perfil do cliente, day-by-day narrativo, hotéis, valores, opcionais, políticas e informações práticas.',
      },
      {
        q: 'Como criar um roteiro?',
        a: 'Acesse "Roteiros de Viagem" e clique em "+ Novo Roteiro". O editor tem 11 seções: Cliente, Viagem, Dia a dia, Hotéis, Valores, Opcionais, Inclui/Não inclui, Pagamento, Cancelamento, Info Importantes e Preview.',
      },
      {
        q: 'Posso exportar o roteiro como PDF?',
        a: 'Sim. Na seção "Preview & Export", selecione a área/BU (para aplicar a identidade visual) e clique em "Exportar PDF". O documento gerado tem layout profissional com capa, day-by-day e tabelas.',
      },
      {
        q: 'O roteiro tem auto-save?',
        a: 'Sim. O editor salva automaticamente a cada 30 segundos. Você também pode salvar manualmente com Ctrl+S ou pelo botão Salvar.',
      },
      {
        q: 'Quais status um roteiro pode ter?',
        a: 'Rascunho → Em revisão → Enviado → Aprovado → Arquivado. O status pode ser alterado pela listagem ou pelo editor.',
      },
    ],
  },
  {
    id: 'cms',
    icon: '◫',
    title: 'CMS, Landing Pages e Artes',
    items: [
      {
        q: 'O que é o CMS?',
        a: 'Módulo de gestão de conteúdo para páginas do site oficial e blog. Permite criar, editar e publicar páginas com otimização SEO.',
      },
      {
        q: 'Como criar uma landing page?',
        a: 'No módulo Landing Pages, crie páginas de campanha com layout personalizável, CTAs, conteúdo e configurações de SEO. Cada página pode ser publicada com link próprio.',
      },
      {
        q: 'Como funciona o Editor de Artes?',
        a: 'O editor de artes usa Canvas (Fabric.js) para criação visual. Suporta templates por setor, filtros, textos, formas e imagens. Ideal para criar peças visuais rápidas.',
      },
    ],
  },
  {
    id: 'news',
    icon: '📰',
    title: 'Monitor de Notícias',
    items: [
      {
        q: 'Para que serve o Monitor de Notícias?',
        a: 'Acompanha notícias relevantes para o negócio com categorização, análise de sentimento e clipping digital. Permite coletar e organizar menções e artigos de interesse.',
      },
    ],
  },
  {
    id: 'ai',
    icon: '⚡',
    title: 'Inteligência Artificial',
    items: [
      {
        q: 'Quais funcionalidades de IA o sistema tem?',
        a: 'O painel de IA (ícone no rodapé) oferece: assistente contextual por módulo, skills configuráveis, transcrição de áudio, geração de narrativas, conversão inteligente de solicitações e análise de conteúdo.',
      },
      {
        q: 'Quais provedores de IA são suportados?',
        a: 'O sistema suporta: Groq (Whisper para áudio, Llama para texto), OpenAI (GPT), Anthropic (Claude), Google (Gemini) e Azure OpenAI. A configuração é feita em IA Skills pelo administrador.',
      },
      {
        q: 'O que são IA Skills?',
        a: 'Skills são habilidades pré-configuradas da IA para tarefas específicas: gerar narrativas de viagem, analisar feedbacks, sugerir respostas, etc. Administradores criam e gerenciam skills na página IA Skills.',
      },
      {
        q: 'O que são Automações IA?',
        a: 'Automações executam skills de IA de forma programada (diária, semanal, etc.). Exemplos: resumo diário de tarefas, análise periódica de métricas, monitoramento de conteúdo.',
      },
    ],
  },
  {
    id: 'automation',
    icon: '⚙',
    title: 'Automações do Sistema',
    items: [
      {
        q: 'Quais automações estão ativas?',
        a: 'O sistema executa automaticamente: alertas de SLA (prazos), nudge de tarefas paradas, auto-arquivamento (+30 dias), resumo diário, envio automático de CSAT, e validação de transições de status.',
      },
      {
        q: 'O que é o Workflow Engine?',
        a: 'O motor de workflow valida transições de status das tarefas: impede mudanças inválidas (ex: de "Não iniciada" direto para "Concluída") e sugere apenas os próximos status válidos.',
      },
      {
        q: 'Como funciona o auto-arquivamento?',
        a: 'Tarefas concluídas há mais de 30 dias são automaticamente marcadas como arquivadas. Elas deixam de aparecer nas listagens e kanban, mas podem ser encontradas com filtros específicos.',
      },
      {
        q: 'O que é o resumo diário?',
        a: 'Uma vez por dia, o sistema gera uma notificação com um resumo: quantas tarefas estão em andamento, atrasadas, concluídas hoje e pendentes de revisão.',
      },
    ],
  },
  {
    id: 'admin',
    icon: '⚙',
    title: 'Administração',
    items: [
      {
        q: 'Como gerenciar usuários?',
        a: 'Na página Usuários, administradores podem: criar contas, definir roles (papéis), atribuir setores, ativar/desativar e redefinir senhas. Cada usuário recebe um papel que define suas permissões.',
      },
      {
        q: 'Quais são os papéis (roles) do sistema?',
        a: 'Master (Diretoria): acesso total. Admin (Head): gerencia usuários e configurações. Manager (Gerente): administra workspaces e equipe. Coordinator (Coordenador): coordena tarefas. Member (Analista): operações básicas. Partner (Parceiro): acesso restrito ao portal.',
      },
      {
        q: 'Como funcionam as permissões?',
        a: 'O sistema usa RBAC (Role-Based Access Control). Cada papel tem um conjunto de permissões pré-definido. Administradores podem criar papéis customizados com permissões específicas na página Roles e Acesso.',
      },
      {
        q: 'O que é a auditoria?',
        a: 'O módulo de Auditoria registra todas as ações relevantes: criação, edição e exclusão de registros, logins, alterações de permissão. Filtros por usuário, ação e período.',
      },
      {
        q: 'Como configurar setores e núcleos?',
        a: 'Na página Setores, defina os setores da empresa e seus núcleos (sub-equipes). Tipos de tarefa são vinculados a setores e núcleos para organização.',
      },
      {
        q: 'Como configurar tipos de tarefa?',
        a: 'Na página Tipos de Tarefa, crie tipos com: nome, setor, categoria, variações, campos customizados, pipeline de etapas e SLA. Os tipos determinam o fluxo e as subtasks automáticas.',
      },
    ],
  },
  {
    id: 'shortcuts',
    icon: '⌨',
    title: 'Atalhos e Dicas',
    items: [
      {
        q: 'Quais atalhos de teclado existem?',
        a: 'Ctrl+S: Salvar (no editor de roteiros e dicas). Esc: Fechar modais e painéis. A busca global pode ser acessada clicando diretamente no campo de pesquisa no header.',
      },
      {
        q: 'Como alterar meu perfil?',
        a: 'Clique no seu avatar no header → "Meu Perfil". Você pode alterar nome, foto, cor do avatar, setor, notificações e preferências visuais.',
      },
      {
        q: 'Como reportar um problema?',
        a: 'Procure o administrador do sistema (papel Master ou Admin). Problemas técnicos devem ser comunicados com: descrição do erro, página onde ocorreu e o que estava fazendo.',
      },
    ],
  },
];

/* ─── Estado ─────────────────────────────────────────────── */
let _panel = null;
let _searchTerm = '';
let _activeCategory = '';
let _expandedItems = new Set();

/* ─── API Pública ────────────────────────────────────────── */
export function toggleHelpPanel() {
  if (_panel) {
    closeHelpPanel();
  } else {
    openHelpPanel();
  }
}

export function openHelpPanel() {
  if (_panel) return;

  _searchTerm = '';
  _activeCategory = '';
  _expandedItems.clear();

  _panel = document.createElement('div');
  _panel.className = 'help-panel-overlay';
  _panel.innerHTML = `
    <div class="help-panel-backdrop"></div>
    <div class="help-panel-drawer">
      <div class="help-panel-header">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:1.25rem;">📖</span>
          <div>
            <h3 style="margin:0;font-size:1rem;font-weight:700;color:var(--text-primary);">Central de Ajuda</h3>
            <p style="margin:0;font-size:0.6875rem;color:var(--text-muted);">Perguntas frequentes e guias</p>
          </div>
        </div>
        <button class="help-panel-close" title="Fechar">&times;</button>
      </div>

      <div class="help-panel-search">
        <span style="color:var(--text-muted);">🔍</span>
        <input type="text" id="help-search-input" placeholder="Buscar na ajuda..."
          autocomplete="off" />
      </div>

      <div class="help-panel-categories" id="help-categories"></div>

      <div class="help-panel-content" id="help-content"></div>
    </div>
  `;

  // Inject styles
  if (!document.getElementById('help-panel-styles')) {
    const style = document.createElement('style');
    style.id = 'help-panel-styles';
    style.textContent = HELP_STYLES;
    document.head.appendChild(style);
  }

  document.body.appendChild(_panel);

  // Force reflow then animate in
  requestAnimationFrame(() => {
    _panel.classList.add('open');
  });

  _renderCategories();
  _renderContent();
  _attachPanelEvents();
}

export function closeHelpPanel() {
  if (!_panel) return;
  _panel.classList.remove('open');
  setTimeout(() => {
    _panel?.remove();
    _panel = null;
  }, 250);
}

/* ─── Renderização ───────────────────────────────────────── */
function _renderCategories() {
  const container = _panel?.querySelector('#help-categories');
  if (!container) return;

  const cats = [{ id: '', icon: '📋', title: 'Todos' }, ...HELP_CATEGORIES];

  container.innerHTML = cats.map(c => `
    <button class="help-cat-pill${_activeCategory === c.id ? ' active' : ''}"
      data-cat="${c.id}" title="${esc(c.title)}">
      <span>${c.icon}</span>
      <span class="help-cat-label">${esc(c.title)}</span>
    </button>
  `).join('');
}

function _renderContent() {
  const container = _panel?.querySelector('#help-content');
  if (!container) return;

  const lower = _searchTerm.toLowerCase();
  let matchCount = 0;
  let html = '';

  const categoriesToShow = _activeCategory
    ? HELP_CATEGORIES.filter(c => c.id === _activeCategory)
    : HELP_CATEGORIES;

  for (const cat of categoriesToShow) {
    const filteredItems = lower
      ? cat.items.filter(item =>
          item.q.toLowerCase().includes(lower) ||
          item.a.toLowerCase().includes(lower))
      : cat.items;

    if (!filteredItems.length) continue;
    matchCount += filteredItems.length;

    html += `
      <div class="help-section">
        <div class="help-section-title">
          <span>${cat.icon}</span> ${esc(cat.title)}
          <span class="help-section-count">${filteredItems.length}</span>
        </div>
        ${filteredItems.map((item, idx) => {
          const key = cat.id + '-' + idx;
          const isOpen = _expandedItems.has(key) || (lower && lower.length >= 2);
          const highlightedQ = lower ? _highlight(item.q, lower) : esc(item.q);
          const highlightedA = lower ? _highlight(item.a, lower) : esc(item.a);
          return `
            <div class="help-item${isOpen ? ' open' : ''}" data-key="${key}">
              <button class="help-item-question" data-toggle="${key}">
                <span class="help-item-arrow">${isOpen ? '▾' : '▸'}</span>
                <span>${highlightedQ}</span>
              </button>
              <div class="help-item-answer" ${isOpen ? '' : 'style="display:none;"'}>
                <p>${highlightedA}</p>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  if (!matchCount) {
    html = `
      <div class="help-empty">
        <span style="font-size:2rem;">🔍</span>
        <p>Nenhum resultado para "<strong>${esc(_searchTerm)}</strong>"</p>
        <p style="font-size:0.75rem;color:var(--text-muted);">Tente termos mais gerais ou navegue pelas categorias</p>
      </div>
    `;
  } else if (lower) {
    html = `<div class="help-match-count">${matchCount} resultado${matchCount !== 1 ? 's' : ''} encontrado${matchCount !== 1 ? 's' : ''}</div>` + html;
  }

  container.innerHTML = html;
}

function _highlight(text, term) {
  const escaped = esc(text);
  const termEsc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${termEsc})`, 'gi');
  return escaped.replace(regex, '<mark class="help-highlight">$1</mark>');
}

/* ─── Eventos ────────────────────────────────────────────── */
function _attachPanelEvents() {
  if (!_panel) return;

  // Close
  _panel.querySelector('.help-panel-backdrop')?.addEventListener('click', closeHelpPanel);
  _panel.querySelector('.help-panel-close')?.addEventListener('click', closeHelpPanel);

  // Esc
  const escHandler = (e) => {
    if (e.key === 'Escape') { closeHelpPanel(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);

  // Search
  const searchInput = _panel.querySelector('#help-search-input');
  let searchTimeout;
  searchInput?.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      _searchTerm = e.target.value.trim();
      _renderContent();
    }, 150);
  });

  // Focus search on open
  setTimeout(() => searchInput?.focus(), 300);

  // Delegation for categories and toggles
  _panel.addEventListener('click', (e) => {
    // Category pills
    const catBtn = e.target.closest('[data-cat]');
    if (catBtn) {
      _activeCategory = catBtn.dataset.cat;
      _expandedItems.clear();
      _renderCategories();
      _renderContent();
      return;
    }

    // Toggle Q&A
    const toggleBtn = e.target.closest('[data-toggle]');
    if (toggleBtn) {
      const key = toggleBtn.dataset.toggle;
      if (_expandedItems.has(key)) {
        _expandedItems.delete(key);
      } else {
        _expandedItems.add(key);
      }
      _renderContent();
    }
  });
}

/* ─── Estilos ────────────────────────────────────────────── */
const HELP_STYLES = `
.help-panel-overlay {
  position: fixed; inset: 0; z-index: 9999;
  opacity: 0; transition: opacity .25s ease;
  pointer-events: none;
}
.help-panel-overlay.open {
  opacity: 1; pointer-events: auto;
}
.help-panel-backdrop {
  position: absolute; inset: 0;
  background: rgba(0,0,0,0.45);
}
.help-panel-drawer {
  position: absolute; top: 0; right: -440px; bottom: 0;
  width: 420px; max-width: 90vw;
  background: var(--bg-card, #1a1a2e);
  border-left: 1px solid var(--border, #333);
  display: flex; flex-direction: column;
  transition: right .3s cubic-bezier(.22,1,.36,1);
  box-shadow: -8px 0 32px rgba(0,0,0,0.3);
}
.help-panel-overlay.open .help-panel-drawer {
  right: 0;
}
.help-panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-subtle, #2a2a3e);
  flex-shrink: 0;
}
.help-panel-close {
  background: none; border: none; cursor: pointer;
  font-size: 1.5rem; color: var(--text-muted); line-height: 1;
  padding: 4px 8px; border-radius: 6px;
  transition: background .15s, color .15s;
}
.help-panel-close:hover {
  background: var(--bg-hover); color: var(--text-primary);
}
.help-panel-search {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border-subtle, #2a2a3e);
  flex-shrink: 0;
}
.help-panel-search input {
  flex: 1; background: transparent; border: none;
  color: var(--text-primary); font-size: 0.875rem;
  outline: none;
}
.help-panel-search input::placeholder {
  color: var(--text-muted);
}
.help-panel-categories {
  display: flex; gap: 6px; padding: 12px 20px;
  overflow-x: auto; flex-shrink: 0;
  border-bottom: 1px solid var(--border-subtle, #2a2a3e);
  scrollbar-width: none;
}
.help-panel-categories::-webkit-scrollbar { display: none; }
.help-cat-pill {
  display: flex; align-items: center; gap: 4px;
  padding: 5px 10px; border-radius: 20px;
  background: var(--bg-surface, #1e1e32);
  border: 1px solid var(--border-subtle, #2a2a3e);
  color: var(--text-muted); cursor: pointer;
  font-size: 0.6875rem; font-weight: 500;
  white-space: nowrap; transition: all .15s;
  font-family: inherit;
}
.help-cat-pill:hover {
  background: var(--bg-hover); color: var(--text-primary);
  border-color: var(--border);
}
.help-cat-pill.active {
  background: var(--brand-blue, #3B82F6);
  border-color: var(--brand-blue, #3B82F6);
  color: white;
}
.help-cat-label {
  max-width: 100px; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}
.help-panel-content {
  flex: 1; overflow-y: auto; padding: 16px 20px;
}
.help-match-count {
  font-size: 0.6875rem; color: var(--text-muted);
  margin-bottom: 12px; font-weight: 500;
}
.help-section {
  margin-bottom: 20px;
}
.help-section-title {
  display: flex; align-items: center; gap: 6px;
  font-size: 0.75rem; font-weight: 700;
  color: var(--text-muted); text-transform: uppercase;
  letter-spacing: 0.05em; margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-subtle, #2a2a3e);
}
.help-section-count {
  margin-left: auto; font-size: 0.625rem;
  background: var(--bg-surface); padding: 1px 6px;
  border-radius: 10px; font-weight: 600;
}
.help-item {
  border: 1px solid var(--border-subtle, #2a2a3e);
  border-radius: 8px; margin-bottom: 6px;
  overflow: hidden; transition: border-color .15s;
}
.help-item:hover {
  border-color: var(--border);
}
.help-item.open {
  border-color: var(--brand-blue, #3B82F6);
}
.help-item-question {
  display: flex; align-items: flex-start; gap: 8px;
  width: 100%; padding: 10px 12px; border: none;
  background: transparent; cursor: pointer;
  text-align: left; color: var(--text-primary);
  font-size: 0.8125rem; font-weight: 500;
  line-height: 1.4; font-family: inherit;
  transition: background .1s;
}
.help-item-question:hover {
  background: var(--bg-hover);
}
.help-item-arrow {
  flex-shrink: 0; font-size: 0.625rem;
  color: var(--text-muted); margin-top: 2px;
  width: 12px; text-align: center;
}
.help-item-answer {
  padding: 0 12px 12px 32px;
}
.help-item-answer p {
  margin: 0; font-size: 0.8125rem;
  color: var(--text-secondary, var(--text-muted));
  line-height: 1.6;
}
.help-highlight {
  background: var(--brand-gold, #D4A843);
  color: var(--bg-primary, #0A1628);
  padding: 0 2px; border-radius: 2px;
  font-weight: 600;
}
.help-empty {
  text-align: center; padding: 3rem 1rem;
  color: var(--text-muted);
}
.help-empty p { margin: 0.5rem 0; font-size: 0.875rem; }

@media (max-width: 480px) {
  .help-panel-drawer { width: 100%; max-width: 100vw; }
  .help-cat-label { max-width: 60px; }
}
`;
