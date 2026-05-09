/**
 * PRIMETOUR — Governança Corporativa
 *
 * Documento normativo do uso do sistema. Referência única de:
 *   - princípios da centralização
 *   - papéis e responsabilidades
 *   - fluxos canônicos (abrir tarefa, solicitar, criar projeto)
 *   - padrões de nomenclatura e campos obrigatórios
 *   - regras de operação (SLA, prioridade, evidência, CSAT)
 *   - checklists e FAQ por persona
 *
 * Acesso: aberto a todos os usuários autenticados (transparência).
 * Posicionamento: sidebar > Administração > Governança (após Auditoria).
 */

// Aberto a todos autenticados — sem checagem de RBAC.
// (Permissão é o sidebar item: perm:null = visível pra todos.)

const SECTIONS = [
  { id:'principios',  label:'📜 Princípios',          icon:'📜' },
  { id:'estrutura',   label:'🏛 Estrutura',           icon:'🏛' },
  { id:'fluxos',      label:'📥 Como pedir trabalho', icon:'📥' },
  { id:'padroes',     label:'✏ Padrões de abertura', icon:'✏' },
  { id:'operacao',    label:'⚙ Operação',            icon:'⚙' },
  { id:'csat',        label:'★ Pesquisa de Satisfação',icon:'★' },
  { id:'checklists',  label:'✅ Checklists',          icon:'✅' },
  { id:'faq',         label:'❓ FAQ por papel',       icon:'❓' },
];

export async function renderGovernance(container) {
  let active = location.hash.includes('section=')
    ? new URLSearchParams(location.hash.split('?')[1] || '').get('section') || 'principios'
    : 'principios';

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Governança</h1>
        <p class="page-subtitle">Como a PRIMETOUR opera com o sistema — referência viva, atualizada conforme a operação evolui</p>
      </div>
      <div class="page-header-actions">
        <span style="font-size:0.75rem;color:var(--text-muted);padding:4px 10px;
          border-radius:var(--radius-full);border:1px solid var(--border-subtle);">
          📖 Aberto a todos
        </span>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:240px 1fr;gap:20px;align-items:start;">
      <!-- TOC sidebar -->
      <nav id="gov-toc" style="position:sticky;top:80px;background:var(--bg-card);
        border:1px solid var(--border-subtle);border-radius:var(--radius-lg);
        padding:10px;display:flex;flex-direction:column;gap:2px;">
        ${SECTIONS.map(s => `
          <button class="gov-toc-btn" data-id="${s.id}"
            style="text-align:left;padding:9px 12px;border-radius:var(--radius-sm);
              background:${active===s.id ? 'rgba(212,168,67,0.15)' : 'transparent'};
              color:${active===s.id ? 'var(--brand-gold)' : 'var(--text-secondary)'};
              border:none;cursor:pointer;font-size:0.875rem;font-weight:500;
              transition:all 0.15s;">
            ${s.label}
          </button>
        `).join('')}
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border-subtle);font-size:0.7rem;color:var(--text-muted);line-height:1.5;">
          <strong style="color:var(--text-secondary);">Atualização contínua</strong><br>
          Este doc evolui com o sistema. Sugestões → Feedback no menu.
        </div>
      </nav>

      <!-- Content -->
      <div id="gov-content" style="background:var(--bg-card);border:1px solid var(--border-subtle);
        border-radius:var(--radius-lg);padding:28px 32px;line-height:1.65;font-size:0.9375rem;">
        ${renderSection(active)}
      </div>
    </div>
  `;

  // TOC binding
  container.querySelectorAll('.gov-toc-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      active = btn.dataset.id;
      container.querySelectorAll('.gov-toc-btn').forEach(b => {
        const on = b.dataset.id === active;
        b.style.background = on ? 'rgba(212,168,67,0.15)' : 'transparent';
        b.style.color      = on ? 'var(--brand-gold)' : 'var(--text-secondary)';
      });
      document.getElementById('gov-content').innerHTML = renderSection(active);
      // atualiza URL pra deep-link (sem reload)
      const base = location.hash.split('?')[0];
      history.replaceState(null, '', `${base}?section=${active}`);
      document.getElementById('gov-content').scrollTop = 0;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

/* ─── Helpers ──────────────────────────────────────────────── */
const H = (level, txt, anchor) => `<h${level}${anchor ? ` id="${anchor}"` : ''} style="margin:${level===2?'0 0 14px':'24px 0 10px'};font-size:${level===2?'1.5rem':'1.125rem'};font-weight:700;color:var(--text-primary);">${txt}</h${level}>`;
const P = (txt) => `<p style="margin:0 0 12px;color:var(--text-secondary);">${txt}</p>`;
const UL = (items) => `<ul style="margin:0 0 14px 22px;padding:0;color:var(--text-secondary);">${items.map(i=>`<li style="margin:4px 0;">${i}</li>`).join('')}</ul>`;
const OL = (items) => `<ol style="margin:0 0 14px 22px;padding:0;color:var(--text-secondary);">${items.map(i=>`<li style="margin:4px 0;">${i}</li>`).join('')}</ol>`;
const CALLOUT = (kind, title, body) => {
  const colors = {
    rule:   { bg:'rgba(239,68,68,0.08)',  border:'rgba(239,68,68,0.3)',  c:'#EF4444', icon:'⛔' },
    info:   { bg:'rgba(56,189,248,0.08)', border:'rgba(56,189,248,0.3)', c:'#38BDF8', icon:'ℹ' },
    do:     { bg:'rgba(34,197,94,0.08)',  border:'rgba(34,197,94,0.3)',  c:'#22C55E', icon:'✅' },
    dont:   { bg:'rgba(239,68,68,0.08)',  border:'rgba(239,68,68,0.3)',  c:'#EF4444', icon:'❌' },
    tip:    { bg:'rgba(212,168,67,0.10)', border:'rgba(212,168,67,0.3)', c:'#D4A843', icon:'💡' },
  }[kind] || {};
  return `<div style="margin:14px 0;padding:12px 16px;background:${colors.bg};border-left:3px solid ${colors.c};border-radius:6px;">
    <div style="font-weight:600;color:${colors.c};margin-bottom:4px;">${colors.icon} ${title}</div>
    <div style="color:var(--text-secondary);font-size:0.875rem;">${body}</div>
  </div>`;
};
const TABLE = (headers, rows) => `
  <table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:0.875rem;">
    <thead><tr style="background:var(--bg-surface);">
      ${headers.map(h=>`<th style="padding:10px 12px;text-align:left;font-weight:600;border-bottom:1px solid var(--border-subtle);color:var(--text-primary);">${h}</th>`).join('')}
    </tr></thead>
    <tbody>${rows.map(r=>`<tr>${r.map(c=>`<td style="padding:9px 12px;border-bottom:1px solid var(--border-subtle);color:var(--text-secondary);vertical-align:top;">${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>`;
const CODE = (txt) => `<code style="background:var(--bg-surface);padding:1px 6px;border-radius:4px;font-size:0.8125rem;color:var(--brand-gold);font-family:ui-monospace,Menlo,monospace;">${txt}</code>`;
const PRE = (txt) => `<pre style="background:var(--bg-surface);padding:12px 14px;border-radius:6px;border:1px solid var(--border-subtle);font-size:0.8125rem;overflow-x:auto;line-height:1.5;color:var(--text-secondary);">${txt}</pre>`;

/* ─── Sections ─────────────────────────────────────────────── */
function renderSection(id) {
  const fn = ({
    principios:  sectionPrincipios,
    estrutura:   sectionEstrutura,
    fluxos:      sectionFluxos,
    padroes:     sectionPadroes,
    operacao:    sectionOperacao,
    csat:        sectionCsat,
    checklists:  sectionChecklists,
    faq:         sectionFaq,
  })[id];
  return fn ? fn() : `<p>Seção não encontrada.</p>`;
}

/* ─── 1. Princípios ────────────────────────────────────────── */
function sectionPrincipios() {
  return `
    ${H(2, '📜 Princípios da Governança')}
    ${P('Este sistema existe para <strong>centralizar todo o trabalho da PRIMETOUR</strong> em um único lugar — eliminando comunicação dispersa, planilhas paralelas e pedidos por WhatsApp. Cinco pilares sustentam essa centralização:')}

    ${TABLE(
      ['Pilar', 'O que significa', 'Como o sistema sustenta'],
      [
        ['<strong>Centralização</strong>',     'Toda demanda nasce, vive e morre dentro do sistema',  'Portal de Solicitações + Tarefas + Projetos'],
        ['<strong>Padronização</strong>',      'Mesma forma de abrir, descrever e fechar trabalho',   'Tipos de Tarefa + campos obrigatórios + nomenclatura'],
        ['<strong>Rastreabilidade</strong>',   'Histórico completo de quem fez o quê, quando',        'Auditoria + evidências + CSAT'],
        ['<strong>Responsabilização</strong>', 'Toda tarefa tem dono, prazo e prioridade claros',     'RBAC + assignees + dueDate + sectores'],
        ['<strong>Mensurabilidade</strong>',   'Decisões baseadas em dados (não em opinião)',         'Dashboards + horas de desenvolvimento + CSAT'],
      ]
    )}

    ${CALLOUT('rule', 'Regra de ouro',
      'Se um pedido foi feito fora do sistema (WhatsApp, e-mail, conversa de corredor), <strong>quem recebeu deve responder: "abra a solicitação no sistema"</strong>. Sem solicitação registrada, não há tarefa, não há SLA, não há acompanhamento.')}

    ${H(3, 'Por que padronizar')}
    ${UL([
      '<strong>Equipe nova entra mais rápido</strong> — sem precisar aprender 10 jeitos de pedir tarefa',
      '<strong>Diretoria vê o real</strong> — dashboards refletem o trabalho de todos, não só dos que avisam',
      '<strong>Cliente recebe melhor</strong> — CSAT estruturado dá feedback acionável, não percepção subjetiva',
      '<strong>Decisões viram base de dados</strong> — quanto tempo gastamos em campanha X? Em qual setor?',
      '<strong>Auditoria existe</strong> — toda mudança crítica tem registro de autor + horário',
    ])}

    ${H(3, 'O que esperar deste documento')}
    ${P('Cada seção tem regras + exemplos. Quando houver conflito entre prática informal e regra deste documento, <strong>prevalece este documento</strong>. Mudanças na governança passam por aprovação da Diretoria e ficam no histórico de versões do sistema.')}
  `;
}

/* ─── 2. Estrutura ─────────────────────────────────────────── */
function sectionEstrutura() {
  return `
    ${H(2, '🏛 Estrutura Organizacional')}
    ${P('O sistema modela 4 dimensões de organização. Entender como elas se relacionam evita 80% das dúvidas de uso.')}

    ${H(3, 'Hierarquia de conceitos')}
    ${PRE(`Squad (workspace)
  └─ Setor (Marketing, Comunicação, Tecnologia, Comercial...)
       └─ Projeto (escopo finito ou always-on)
            └─ Tarefa (unidade de trabalho)
                 └─ Subtarefa (passo de uma tarefa)`)}

    ${P('<strong>Squad</strong> = grupo multissetor com objetivo comum (ex: "Lançamento Verão 2026"). Squad pode atravessar setores.<br><strong>Setor</strong> = área funcional fixa (Marketing, Comunicação, etc).<br><strong>Projeto</strong> = container de tarefas com tema único (sempre dentro de um ou mais squads).<br><strong>Tarefa</strong> = entrega individual rastreável.')}

    ${H(3, 'Papéis (Roles) e Responsabilidades')}
    ${TABLE(
      ['Papel', 'O que pode fazer', 'O que NÃO pode'],
      [
        ['<strong>Master</strong> (Diretoria)',     'Tudo. Configura roles, exclui dados, vê auditoria global.', 'Nada — acesso total mas com responsabilidade total.'],
        ['<strong>Admin</strong> (Head/CTO)',        'Gerencia usuários, configura tipos de tarefa, vê auditoria, exclui CSAT.', 'Mexer em roles do master.'],
        ['<strong>Manager</strong> (Gerente)',       'Cria/edita projetos, gerencia squads, dispara CSAT, vê dashboards de área.', 'Excluir projetos com vínculos críticos. Ver auditoria global.'],
        ['<strong>Coordinator</strong> (Coordenador)','Cria tarefas pra squad, atribui responsáveis, acompanha SLA.',                'Mudar config de tipo de tarefa. Mexer em roles.'],
        ['<strong>Member</strong> (Colaborador)',    'Cria tarefas pessoais, executa as suas, fecha entregas com evidência.',       'Atribuir tarefa a outro colaborador externo ao squad.'],
        ['<strong>Observer</strong> (Stakeholder)',  'Lê dashboards e tarefas que acompanha. Comenta.',                              'Criar/editar/concluir tarefas.'],
        ['<strong>Cliente externo</strong>',         'Responde CSAT via link público. Ver tarefa via portal de solicitações.',      'Login no sistema interno.'],
      ]
    )}

    ${CALLOUT('info', 'Onde mudar role',
      'Administração → <strong>Roles e Acesso</strong>. Apenas master/admin. Toda mudança vai pra auditoria automaticamente.')}

    ${H(3, 'Quem aprova o quê')}
    ${TABLE(
      ['Decisão', 'Quem aprova'],
      [
        ['Criar novo squad (multissetor)',                  'Master ou Admin'],
        ['Criar novo tipo de tarefa',                       'Manager do setor + Admin'],
        ['Criar projeto novo',                              'Manager do setor'],
        ['Excluir projeto/tarefa em massa',                 'Manager + Admin (auditoria)'],
        ['Alterar config CSAT de projeto em produção',      'Manager (afeta cliente externo)'],
        ['Tarefa fora do horário comercial / pós-prazo',    'Coordinator → comunicar Manager'],
      ]
    )}
  `;
}

/* ─── 3. Como pedir trabalho ──────────────────────────────── */
function sectionFluxos() {
  return `
    ${H(2, '📥 Como pedir trabalho — fluxos canônicos')}
    ${P('Existem <strong>3 caminhos legítimos</strong> para que trabalho entre no sistema. Qualquer pedido fora desses 3 caminhos viola a centralização.')}

    ${H(3, '1. Portal de Solicitações (cliente interno → executor)')}
    ${P('Use quando: <em>colaborador de qualquer setor</em> precisa pedir algo a <em>outro setor</em>.')}
    ${OL([
      'Solicitante acessa <strong>/solicitar.html</strong> (link público + SSO)',
      'Preenche: o que precisa, prazo desejado, anexos',
      'Sistema cria automaticamente uma tarefa no setor de destino',
      'Coordenador do setor receptor distribui para executor',
      'Executor entrega — solicitante recebe notificação',
      'CSAT automático ao concluir (se tipo da tarefa tem coleta ativa)',
    ])}
    ${CALLOUT('do', 'Quando usar',
      'Demandas <strong>entre setores</strong>. Ex: Comercial pedindo arte ao Marketing, Marketing pedindo blog post à Comunicação.')}
    ${CALLOUT('dont', 'Quando NÃO usar',
      'Tarefa pessoal (criar direto em /tasks). Demanda dentro do mesmo setor (criar direto, sem portal).')}

    ${H(3, '2. Criar tarefa direto (executor cria pra si ou squad)')}
    ${P('Use quando: você é o executor e está organizando seu próprio trabalho, ou um coordenador organizando o squad.')}
    ${OL([
      'Vai em <strong>Tarefas → + Nova Tarefa</strong>',
      'Preenche título, tipo, prazo, responsável(is), squad/projeto',
      'Adiciona subtarefas se for trabalho composto',
      'Salva — tarefa aparece no kanban/lista do(s) responsável(is)',
    ])}

    ${H(3, '3. Criar projeto (trabalho de longo prazo)')}
    ${P('Use quando: o trabalho tem múltiplas tarefas relacionadas, dura semanas/meses, ou envolve mais de uma pessoa.')}
    ${OL([
      'Projetos → <strong>+ Novo Projeto</strong>',
      'Define nome, escopo, datas, squad(s), membros',
      'Configura CSAT (se for entregar para cliente)',
      'Cria tarefas dentro do projeto conforme avança',
    ])}
    ${CALLOUT('tip', 'Always-on vs com prazo',
      'Projeto com data de fim → trigger CSAT "ao fechar". Projeto contínuo (operação, suporte) → trigger "manual" ou "marcos". Define isso na criação.')}

    ${H(3, 'Antipadrões a eliminar')}
    ${UL([
      '❌ "Manda no WhatsApp" — pedidos por chat não viram tarefa rastreável',
      '❌ "Anota aí" — agenda pessoal não é fonte de verdade da empresa',
      '❌ "Faz uma planilha" — duplica esforço e desatualiza',
      '❌ "Eu lembro" — memória não escala',
      '❌ "Conversa em pé" — informalidade não tem SLA',
    ])}
    ${CALLOUT('rule', 'O que fazer ao receber pedido informal',
      'Responda: "<em>Pode abrir no sistema? Sem registro fica fora do meu fluxo.</em>" — Não é grosseria, é disciplina de governança. Reforce até virar cultura.')}
  `;
}

/* ─── 4. Padrões de abertura ──────────────────────────────── */
function sectionPadroes() {
  return `
    ${H(2, '✏ Padrões de abertura')}
    ${P('Toda tarefa, projeto e tipo segue um padrão. Não é estética — é o que torna possível buscar, filtrar, agrupar e medir.')}

    ${H(3, 'Nomenclatura de Tarefas')}
    ${P('Fórmula: <strong>[Verbo no infinitivo] + [objeto] + [qualificador opcional]</strong>')}
    ${TABLE(
      ['❌ Ruim', '✅ Bom', 'Por quê'],
      [
        ['"Site"',                              '"Atualizar banner do site (campanha verão)"',     'Verbo + objeto + escopo'],
        ['"Reunião com Marketing"',             '"Preparar pauta de reunião — Marketing 12/05"',   'Ação concreta, com data'],
        ['"Bug"',                               '"Corrigir login Microsoft SSO no Safari iOS"',    'Ação + escopo técnico claro'],
        ['"Newsletter"',                        '"Diagramar newsletter Lazer #45"',                 'Verbo + entrega + identificador'],
        ['"Kanban PRIMETOUR"',                  '"Criar tarefas semanais Marketing — semana 19/05"', 'Especificidade temporal'],
      ]
    )}

    ${H(3, 'Campos obrigatórios em tarefas')}
    ${TABLE(
      ['Campo', 'Por quê é obrigatório'],
      [
        ['<strong>Título</strong>',              'Sem título não há rastreabilidade.'],
        ['<strong>Responsável (assignee)</strong>', 'Tarefa órfã = tarefa não feita.'],
        ['<strong>Prazo (dueDate)</strong>',     'Sem prazo, não há SLA. Não há urgência.'],
        ['<strong>Tipo de tarefa</strong>',      'Define template, SLA padrão, CSAT, dashboards.'],
        ['<strong>Setor</strong>',               'Decide quais permissões aplicam, quem pode ver.'],
      ]
    )}
    ${CALLOUT('info', 'Squad e Projeto',
      '<strong>Squad</strong> e <strong>Projeto</strong> não são obrigatórios mas <em>fortemente recomendados</em>. Tarefa sem squad/projeto fica órfã na visão consolidada — só seu autor a enxerga bem.')}

    ${H(3, 'Nomenclatura de Projetos')}
    ${P('Fórmula: <strong>[Substantivo] + [escopo/período]</strong>')}
    ${UL([
      '✅ "Campanha Verão 2026" · "Lançamento App Móvel" · "Operação Comercial — Q2"',
      '❌ "Coisas" · "Marketing" · "Geral" · "Diversos"',
    ])}

    ${H(3, 'Nomenclatura de Tipos de Tarefa')}
    ${P('Tipo descreve <strong>o que é entregue</strong>, não como. Use o substantivo do entregável.')}
    ${UL([
      '✅ "Newsletter Quinzenal" · "Apresentação Comercial" · "Post Instagram"',
      '❌ "Fazer arte" · "Design" · "Tarefas chatas"',
    ])}

    ${H(3, 'Tags vs Tipo vs Projeto')}
    ${TABLE(
      ['Conceito', 'Quando usar', 'Exemplo'],
      [
        ['<strong>Tipo</strong>',    'Identidade do entregável (template + SLA + CSAT)',          'Newsletter Quinzenal'],
        ['<strong>Projeto</strong>', 'Container temporal/temático que agrupa entregas relacionadas', 'Campanha Verão 2026'],
        ['<strong>Tag</strong>',     'Marcação livre transversal pra busca/filtro',               '#urgente, #cliente-X, #revisão'],
      ]
    )}
    ${CALLOUT('tip', 'Regra prática',
      'Se você quer <em>medir/SLAr/coletar CSAT</em>, é <strong>tipo</strong>. Se quer <em>agrupar entregas relacionadas</em>, é <strong>projeto</strong>. Se quer só <em>marcar e filtrar</em>, é <strong>tag</strong>.')}
  `;
}

/* ─── 5. Operação ──────────────────────────────────────────── */
function sectionOperacao() {
  return `
    ${H(2, '⚙ Operação — SLA, prioridade, evidência')}

    ${H(3, 'SLA (Service Level Agreement)')}
    ${P('Cada tipo de tarefa tem SLA padrão (em <strong>dias úteis</strong>). Esse SLA define o prazo automático ao criar a tarefa. Coordenador pode estender com justificativa.')}
    ${UL([
      'SLA conta apenas <strong>dias úteis</strong> (segunda a sexta)',
      'Tarefas criadas sexta às 18h vencem na <em>terça</em> (não sábado)',
      'Feriados nacionais entram no cálculo automaticamente',
      'Mudança de prazo gera log de auditoria',
    ])}

    ${H(3, 'Prioridades')}
    ${TABLE(
      ['Nível', 'Critério', 'Tempo de reação esperado'],
      [
        ['<strong style="color:#EF4444;">Crítico</strong>',  'Cliente externo bloqueado, perda financeira ou de imagem',          '< 2h úteis'],
        ['<strong style="color:#F97316;">Alto</strong>',     'Bloqueia outras pessoas, risco de SLA',                              '< 1 dia útil'],
        ['<strong style="color:#F59E0B;">Médio</strong>',    'Padrão. Volume normal de operação',                                  'Conforme SLA do tipo'],
        ['<strong style="color:#22C55E;">Baixo</strong>',    'Pode esperar. "Quando tiver tempo"',                                'Sem compromisso'],
      ]
    )}
    ${CALLOUT('rule', 'Quem define crítico',
      'Apenas Manager+ pode marcar tarefa como <strong>Crítico</strong>. Justificativa é obrigatória. Se todo mundo for crítico, nada é crítico.')}

    ${H(3, 'Evidência de entrega')}
    ${P('Toda tarefa concluída exige <strong>link de evidência</strong> (link de comprovação). Não basta clicar "concluir" — é preciso anexar:')}
    ${UL([
      'Link do material entregue (PDF, post publicado, deploy, etc)',
      'Captura de tela quando link público não existe',
      'Para tarefas internas: print do arquivo no Drive/Sharepoint',
    ])}
    ${CALLOUT('do', 'Por quê é importante',
      'Sem evidência, não dá pra responder ao solicitante "está pronto e <em>aqui está</em>". Evidência também alimenta o CSAT — cliente clica no link na pesquisa.')}

    ${H(3, 'Mudança de prazo')}
    ${OL([
      'Não estende calado — sempre vai pro auditoria',
      'Se você é executor: <em>justifique no comentário antes de mover</em>',
      'Se você é coordenador: revise mudanças de prazo do squad semanalmente',
      'Mudanças repetidas no mesmo tipo = sinal de SLA mal calibrado (ajuste o tipo, não a tarefa individual)',
    ])}

    ${H(3, 'Tarefas Recorrentes')}
    ${P('Tarefas que se repetem (newsletter, relatórios mensais) devem usar o sistema de <strong>recorrência</strong>:')}
    ${OL([
      'Tarefas → criar → marcar "Tarefa recorrente"',
      'Define frequência (semanal, quinzenal, mensal)',
      'Sistema gera automaticamente as instâncias futuras',
      'CSAT periódico (se configurado) agrupa todas as instâncias da janela',
    ])}
  `;
}

/* ─── 6. CSAT ──────────────────────────────────────────────── */
function sectionCsat() {
  return `
    ${H(2, '★ Pesquisa de Satisfação (CSAT)')}
    ${P('Coleta estruturada de feedback do cliente. Substitui "ele falou que gostou" por <strong>nota mensurável + comentário</strong>. 4 modos disponíveis — escolha pela natureza do trabalho:')}

    ${H(3, '4 modos de CSAT')}
    ${TABLE(
      ['Modo', 'Quando usar', 'Configuração'],
      [
        ['<strong>Individual</strong>',     'Tarefa avulsa pra cliente externo (ex: apresentação, proposta)', 'No <strong>tipo de tarefa</strong>: mode=individual'],
        ['<strong>Periódico</strong>',      'Entregas recorrentes (newsletter quinzenal, relatórios)',         'No <strong>tipo de tarefa</strong>: mode=periodic + período + dia + horário'],
        ['<strong>Marco do projeto</strong>','Projeto com várias entregas, fechamento de fase',                 'No <strong>projeto</strong>: trigger=on_close ou custom_milestones'],
        ['<strong>Manual (always-on)</strong>','Operação contínua sem fim claro',                              'No <strong>projeto</strong>: trigger=manual_only + botão "Disparar agora"'],
      ]
    )}

    ${CALLOUT('tip', 'Árvore de decisão',
      `<strong>É um projeto?</strong> → Configure CSAT no projeto.<br>
      <strong>É tarefa avulsa, repete sempre?</strong> → Configure CSAT no tipo (periódico).<br>
      <strong>É tarefa única pra cliente?</strong> → Configure CSAT no tipo (individual).<br>
      <strong>Configura nos dois?</strong> → Projeto sempre vence (override).`)}

    ${H(3, 'Quando NÃO disparar CSAT')}
    ${UL([
      'Tarefa interna sem cliente externo',
      'Cliente já respondeu pesquisa há menos de 7 dias (evita fadiga)',
      'Bug fix / correção que o cliente não percebeu',
      'Projetos de POC / experimentos internos',
    ])}

    ${H(3, 'Como interpretar resultados')}
    ${TABLE(
      ['Nota', 'Interpretação', 'Ação'],
      [
        ['5,0',          'Cliente entusiasmado',                  'Captura: o que fizemos diferente?'],
        ['4,0–4,9',      'Satisfeito, sem reclamação',            'Padrão. Manter consistência'],
        ['3,0–3,9',      'Aceitou mas há atrito',                 'Investigar: comentário aponta gap?'],
        ['2,0–2,9',      'Desalinhamento real',                   'Reunião com cliente. Revisar processo'],
        ['1,0–1,9',      'Crítico — perdemos confiança',          'Escalada imediata para Manager + Diretoria'],
      ]
    )}

    ${H(3, 'Privacidade do CSAT')}
    ${UL([
      'Resposta do cliente é confidencial — só Manager+ vê comentários completos',
      'Member vê apenas <em>sua própria</em> nota agregada',
      'Resposta nunca é compartilhada de volta com o cliente (anonimato interno)',
      'Cliente recebe link único com token expirável (7 dias)',
    ])}
  `;
}

/* ─── 7. Checklists ────────────────────────────────────────── */
function sectionChecklists() {
  return `
    ${H(2, '✅ Checklists')}
    ${P('Listas práticas pra rodar antes/durante/depois das principais ações.')}

    ${H(3, 'Antes de abrir uma tarefa')}
    ${UL([
      '☐ A demanda é clara o suficiente pra outra pessoa fazer sem me perguntar?',
      '☐ Tem prazo realista (não "ontem")?',
      '☐ Sei quem deveria executar — ou estou pedindo ao coordenador distribuir?',
      '☐ Existe tarefa parecida aberta (evitar duplicar)?',
      '☐ Anexei materiais necessários (briefing, referências)?',
    ])}

    ${H(3, 'Antes de fechar uma tarefa')}
    ${UL([
      '☐ Anexei link de evidência (entregável final)?',
      '☐ Comentário de fechamento explica decisões/observações?',
      '☐ Notifiquei o solicitante (sistema faz automaticamente, mas validar)?',
      '☐ Fiz hand-off pra próxima etapa se aplicável?',
    ])}

    ${H(3, 'Antes de criar um projeto')}
    ${UL([
      '☐ Escopo claro: o que ESTÁ no projeto e o que NÃO está',
      '☐ Cliente externo? Configurei CSAT (qual trigger?)',
      '☐ Datas: tem fim previsto ou é always-on?',
      '☐ Squad e setores envolvidos definidos',
      '☐ Membros com acesso correto (não convidar quem não vai usar)',
    ])}

    ${H(3, 'Antes de fechar um projeto')}
    ${UL([
      '☐ Todas tarefas filhas estão concluídas ou explicitamente canceladas',
      '☐ CSAT foi disparado (se configurado on_close)',
      '☐ Documentei aprendizados em comentário ou doc anexo',
      '☐ Arquivei materiais finais em local de longo prazo (Drive/Sharepoint)',
    ])}

    ${H(3, 'Revisão semanal do Coordenador')}
    ${UL([
      '☐ Tarefas sem responsável? — atribuir',
      '☐ Tarefas vencidas? — repactuar prazo (com justificativa)',
      '☐ Tarefas paradas há mais de 1 semana? — reunião com executor',
      '☐ Squad com sobrecarga? — redistribuir',
      '☐ Pesquisas CSAT pendentes? — fila aguardando envio',
    ])}

    ${H(3, 'Revisão mensal do Manager')}
    ${UL([
      '☐ Dashboards: temos tendência negativa em algum tipo de tarefa?',
      '☐ CSAT médio do mês está acima de 4,0?',
      '☐ Tipos de tarefa com SLA mal calibrado (muitos extends)?',
      '☐ Solicitações pelo portal: tempo médio de resposta está OK?',
      '☐ Há tarefas órfãs (sem squad/projeto) acumulando?',
    ])}
  `;
}

/* ─── 8. FAQ ───────────────────────────────────────────────── */
function sectionFaq() {
  return `
    ${H(2, '❓ FAQ por papel')}
    ${P('Perguntas mais comuns agrupadas pelo perfil de quem pergunta.')}

    ${H(3, '👤 Solicitante (qualquer colaborador)')}

    <div style="margin:12px 0;"><strong>Como peço uma tarefa pra outro setor?</strong></div>
    ${P('Acesse o Portal de Solicitações (sidebar → Solicitar). Preencha o formulário. Sistema cria tarefa no setor de destino. Você recebe notificação a cada movimentação.')}

    <div style="margin:12px 0;"><strong>Quanto tempo até alguém pegar minha solicitação?</strong></div>
    ${P('SLA varia por tipo de tarefa. Em geral: <strong>1 dia útil</strong> para distribuição (coordenador atribui ao executor). A entrega segue o SLA do tipo escolhido.')}

    <div style="margin:12px 0;"><strong>Posso pedir alteração depois de aberta?</strong></div>
    ${P('Sim — adicione comentário na tarefa. Mudanças grandes (escopo) podem reabrir SLA. Mudanças pequenas (ajuste de cor, texto) entram na execução normal.')}

    ${H(3, '👤 Executor (member)')}

    <div style="margin:12px 0;"><strong>Onde vejo minhas tarefas?</strong></div>
    ${P('Sidebar → Tarefas. Por padrão filtra por você. Use as visualizações: Lista (priorize por data), Kanban (priorize por status), Calendário (planeje semana).')}

    <div style="margin:12px 0;"><strong>Não consigo entregar no prazo, e agora?</strong></div>
    ${P('Edite a tarefa, mude o prazo, escreva o motivo no comentário. Notificação vai pro coordenador automaticamente. Não fique calado — repactuar é normal, esconder não.')}

    <div style="margin:12px 0;"><strong>Como anexo evidência?</strong></div>
    ${P('No campo "Link de comprovação" da tarefa. Pode ser link público (Drive, Sharepoint), URL de site, ou print no ImgBB se nada melhor. Sem evidência a tarefa fica como "concluída sem comprovação" — visível como pendência no dashboard.')}

    ${H(3, '👤 Coordenador')}

    <div style="margin:12px 0;"><strong>Como distribuo tarefas do portal?</strong></div>
    ${P('Solicitações chegam sem assignee. Em Tarefas, filtre por seu setor + sem responsável. Atribua considerando: capacidade atual da pessoa (vê na aba Equipe → Capacidade), expertise, histórico do tipo.')}

    <div style="margin:12px 0;"><strong>Quem pode pedir aumento de SLA do tipo?</strong></div>
    ${P('Você sugere ao Manager. SLA do tipo é decisão de Manager+ porque afeta promessa ao cliente.')}

    ${H(3, '👤 Manager')}

    <div style="margin:12px 0;"><strong>Como vejo a saúde do meu setor?</strong></div>
    ${P('Sidebar → Dashboards → seleciona seu setor. Tem: tarefas por status, SLA cumprido, CSAT médio, ranking por executor, gargalos. Olhe semanalmente.')}

    <div style="margin:12px 0;"><strong>CSAT está caindo, o que faço?</strong></div>
    ${P('1) Lê os comentários (Dashboards → CSAT → comentários recentes). 2) Cruza nota com tipo de tarefa: é um tipo específico? 3) Conversa com executor — problema técnico ou expectativa mal alinhada? 4) Repactua escopo com cliente se for o caso.')}

    <div style="margin:12px 0;"><strong>Posso forçar uma tarefa fora do squad?</strong></div>
    ${P('Tecnicamente sim (master/admin pode). Em termos de governança: <strong>não</strong>. Crie um squad multissetor temporário se a colaboração for legítima. Atalhos viram cultura.')}

    ${H(3, '👤 Diretoria (Master)')}

    <div style="margin:12px 0;"><strong>Quero ver o todo da empresa.</strong></div>
    ${P('Dashboards (sem filtro de setor) + Sobre o Sistema (estrutura) + Auditoria (eventos críticos). Reuniões mensais devem usar dados desses 3 lugares — não slides feitos manualmente.')}

    <div style="margin:12px 0;"><strong>Quem está sobrecarregado?</strong></div>
    ${P('Sidebar → Equipe → Capacidade. Mostra carga atual de cada pessoa. Vermelho = > 100% da capacidade nominal. Use isso pra rebalancear, não pra cobrar.')}

    <div style="margin:12px 0;"><strong>O sistema é a fonte da verdade?</strong></div>
    ${P('Sim. Se planilhas/PDFs paralelos discordam, prevalece o sistema. Pares com discordâncias frequentes → ajustar o sistema (faltam campos? tipo errado?). Não criar atalho fora.')}
  `;
}
