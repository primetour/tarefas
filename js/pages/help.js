/**
 * PRIMETOUR — Página de Ajuda
 *
 * Estrutura (ordem):
 *   1. FAQ global (com busca no topo)
 *   2. Tours guiados
 *   3. Atalhos de teclado
 *   4. Segurança & Privacidade (cards visuais)
 *   5. Links úteis
 */
import { store } from '../store.js';
import { TOURS, hasDoneTour, runTour, resetTour, resetAllTours } from '../services/tours.js?v=20260501cc2';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ─── Catálogo global de FAQs ───────────────────────────────
 * Cada FAQ tem: q (pergunta), a (resposta HTML), tags (busca livre), category (filtro).
 * Categories: ['início', 'tarefas', 'ia', 'segurança', 'privacidade', 'rh', 'marketing', 'sistema']
 */
const FAQS = [
  // ── INÍCIO / ONBOARDING ──────────────────────────────────
  {
    q: 'Acabei de receber acesso. Por onde começo?',
    a: 'Faça o tour guiado <strong>"Bem-vindo ao Gestor PRIMETOUR"</strong> (logo abaixo). Em 2 minutos você conhece os módulos principais. Depois explore <strong>Meu Painel</strong> pra ver suas tarefas.',
    tags: 'onboarding tour primeiro acesso comecar inicio',
    category: 'início',
  },
  {
    q: 'Como mudo a paleta de cores e a aparência?',
    a: 'Header → seu avatar → Perfil → seção "Aparência". Escolha entre Portal, Midnight, Charcoal, Ocean Blue e outras paletas. Salva por usuário, sincroniza entre dispositivos.',
    tags: 'cor cores tema dark light paleta visual',
    category: 'início',
  },

  // ── LOGIN E AUTENTICAÇÃO ─────────────────────────────────
  {
    q: 'Por que só dá pra entrar com Microsoft?',
    a: 'Por <strong>segurança corporativa</strong>. SSO Microsoft restringe acesso ao tenant <code>primetour.com.br</code> e herda o MFA do Azure AD (mais robusto que senha). Login email/senha foi removido como vetor de phishing/credential stuffing.',
    tags: 'login sso microsoft azure entrar acesso',
    category: 'segurança',
  },
  {
    q: 'O que é o "App Check" que aparece no console do navegador?',
    a: 'Validação automática que confirma que sua sessão veio do app oficial Gestor PRIMETOUR (não de scripts/Postman/curl). Usa reCAPTCHA Enterprise invisível. Token JWT renovado automaticamente. <strong>Sem ação sua</strong>.',
    tags: 'appcheck recaptcha bot validacao',
    category: 'segurança',
  },
  {
    q: 'Recebi notificação de "Novo IP detectado". O que faço?',
    a: 'Se foi você (mudou de wifi, viajou): ignore. Se <strong>não foi</strong>: troque sua senha Microsoft em <code>portal.office.com</code> imediatamente e avise rene.castro@primetour.com.br. O sistema captura IP+UA do login pra detectar ataques.',
    tags: 'ip suspeito invasao seguranca login',
    category: 'segurança',
  },

  // ── PRIVACIDADE & LGPD ───────────────────────────────────
  {
    q: 'Como exporto meus dados pessoais? (LGPD Art. 18 V)',
    a: 'Em <strong>Configurações → Privacidade e IA → Exportar meus dados</strong>. Gera JSON com tudo que o sistema sabe sobre você: perfil, tarefas, chats com IA, logs. Direito garantido pela LGPD.',
    tags: 'lgpd export portabilidade dados pessoais',
    category: 'privacidade',
  },
  {
    q: 'Como peço pra apagarem meus dados? (LGPD Art. 18 VI)',
    a: 'Em <strong>Configurações → Privacidade e IA → Excluir meus dados</strong>. Apaga chats com IA, drafts, notas e respostas CSAT. Tarefas e comentários são <em>anonimizados</em> (preservam histórico). <strong>Registros de ponto (CLT) ficam por 5 anos por exigência legal</strong>.',
    tags: 'lgpd erasure delete apagar exclusao dados',
    category: 'privacidade',
  },
  {
    q: 'O que é enviado pra IA quando uso o IA Hub?',
    a: 'Antes de enviar, o sistema <strong>anonimiza automaticamente</strong>: emails → <code>&lt;EMAIL_1&gt;</code>, CPF → <code>&lt;CPF_1&gt;</code>, CNPJ, telefones. Em 11 módulos sensíveis (CSAT, feedback, ponto), anonimização é default ON. Você pode revisar/desabilitar em <strong>Configurações → Privacidade e IA</strong>.',
    tags: 'ia anonimizacao pii dados privacidade gpt claude',
    category: 'privacidade',
  },
  {
    q: 'Quem é o DPO (Encarregado LGPD)?',
    a: 'Rene Castro — <code>rene.castro@primetour.com.br</code>. Solicitações de titulares respondidas em até 15 dias úteis. Doc completo em <strong>Sobre o Sistema → 🔐 Privacidade & LGPD</strong>.',
    tags: 'dpo encarregado lgpd contato',
    category: 'privacidade',
  },

  // ── TAREFAS E PROJETOS ───────────────────────────────────
  {
    q: 'Como crio uma nova tarefa?',
    a: 'Em <strong>Tarefas → + Nova tarefa</strong>. Escolha o setor, tipo e variação (vai sugerir SLA automático). Adicione título, responsáveis, prazo e descrição. Comentários, anexos e checklist ficam dentro da tarefa.',
    tags: 'criar tarefa nova adicionar',
    category: 'tarefas',
  },
  {
    q: 'Qual a diferença entre tarefa, projeto e meta?',
    a: '<strong>Tarefa</strong> = entregável único (ex: "Revisar layout newsletter"). <strong>Projeto</strong> = agrupa várias tarefas com começo/fim (ex: "Lançamento campanha Verão"). <strong>Meta</strong> = KPI de desempenho avaliado periodicamente (ex: "NPS &gt; 8.5").',
    tags: 'tarefa projeto meta diferenca conceito',
    category: 'tarefas',
  },
  {
    q: 'O que são "Steps" e "Kanban"?',
    a: '<strong>Steps</strong> são as etapas que cada tipo de tarefa passa (ex: Briefing → Layout → Revisão → Aprovação → Entrega). O Kanban mostra tarefas em colunas pelos seus steps atuais — drag-and-drop pra avançar.',
    tags: 'steps kanban etapa fase fluxo',
    category: 'tarefas',
  },
  {
    q: 'Como acompanho prazos e SLA?',
    a: 'O <strong>SLA</strong> é definido na variação do tipo de tarefa (em dias úteis). O sistema calcula o prazo automaticamente e mostra ⚠ quando ficar próximo (3 dias) ou 🔴 quando atrasar. Notificação automática.',
    tags: 'sla prazo deadline atraso',
    category: 'tarefas',
  },

  // ── IA HUB ──────────────────────────────────────────────
  {
    q: 'Como uso a IA pra me ajudar?',
    a: 'No header → ✨ <strong>IA</strong> (ou Cmd+K). Conversa com agentes especializados: Brief writer, Revisor, Pesquisador, etc. Cada agente tem skills (instruções) e pode acessar conhecimento corporativo (SharePoint).',
    tags: 'ia chat assistente agente claude gpt gemini',
    category: 'ia',
  },
  {
    q: 'Posso criar meu próprio agente de IA?',
    a: 'Sim — apenas Diretoria/Head/Gerente. Em <strong>IA Hub → Agentes → + Novo agente</strong>. Configure provider (Anthropic/OpenAI/Gemini/Groq), modelo, prompt do sistema, skills e limites de custo diário.',
    tags: 'agente criar ia personalizado',
    category: 'ia',
  },
  {
    q: 'Quanto está sendo gasto com IA?',
    a: 'Em <strong>IA Hub → Dashboard</strong> (Diretoria/Head/Gerente). Mostra custo por agente, usuário, módulo. Cada agente tem cap diário configurável. SIEM diário alerta se algum usuário ultrapassa $20/dia.',
    tags: 'custo ia preco token gasto budget',
    category: 'ia',
  },

  // ── CHECK-IN E CLT ──────────────────────────────────────
  {
    q: 'Esqueci de bater ponto. O que faço?',
    a: 'Vá em <strong>Check-in → Ponto</strong> e clique no ✎ da linha do dia errado (ou em "+ Solicitar correção"). Sua solicitação vai pra fila de aprovação do gestor. Justificativa obrigatória.',
    tags: 'ponto bater corrigir esqueci checkin clt',
    category: 'rh',
  },
  {
    q: 'Como pedir férias?',
    a: 'Em <strong>Equipe → Férias</strong>. O sistema calcula seu saldo CLT (períodos aquisitivos de 12 meses). Aceita fracionamento (até 3 períodos, sendo 1 com mín 14 dias) e abono pecuniário (até 10 dias).',
    tags: 'ferias clt periodo fracionamento abono',
    category: 'rh',
  },
  {
    q: 'Posso ter mais de uma reserva de mesa por dia?',
    a: 'Não. Cada usuário tem 1 reserva ativa por dia. Se precisar trocar, cancele a antiga primeiro em <strong>Check-in → Reservar mesa</strong>.',
    tags: 'reserva mesa hot desk checkin',
    category: 'rh',
  },

  // ── MARKETING / CONTEÚDO ────────────────────────────────
  {
    q: 'Como uso o Calendário de Conteúdo?',
    a: 'Em <strong>Calendário de Conteúdo</strong>. Crie ideias arrastando no mês/semana, defina plataforma (IG/FB), data e categoria. IA gera descrição automática. Pode converter ideia em tarefa quando aprovar.',
    tags: 'calendario conteudo redes sociais instagram',
    category: 'marketing',
  },
  {
    q: 'Como geramos um roteiro de viagem?',
    a: 'Em <strong>Roteiros</strong>. Cliente, destinos, datas. IA Hub gera sugestões baseadas no perfil. Export em PDF profissional. Versão pública: <code>roteiro-view.html?id=XXX</code>.',
    tags: 'roteiro viagem destino cliente',
    category: 'marketing',
  },

  // ── NOTIFICAÇÕES ────────────────────────────────────────
  {
    q: 'Como sou notificado?',
    a: 'Sino no header (badge de não lidas) e e-mail (se integração ativa). Tipos: tarefas atribuídas, comentários, prazos, mentions, segurança (IP novo, secrets, backup), LGPD. Configurações em <strong>Perfil → Notificações</strong>.',
    tags: 'notificacao sino email aviso alerta',
    category: 'sistema',
  },

  // ── SISTEMA ─────────────────────────────────────────────
  {
    q: 'Tenho backup dos meus dados?',
    a: 'Sim. Backup automático <strong>todo dia às 03h BRT</strong> pra Google Cloud Storage. Retenção de 1 ano. Recovery granular até 7 dias atrás (PITR — Point-in-Time Recovery). Delete protection ativo (impede DROP acidental).',
    tags: 'backup recovery pitr recuperacao dados',
    category: 'sistema',
  },
  {
    q: 'Onde vejo a documentação técnica completa?',
    a: 'Em <strong>Sobre o Sistema</strong> (acesso Diretoria/Head). Tem 8 abas: Pilares, Hierarquia, Papéis, Modelo de dados, Módulos, ⚙ Infraestrutura, 🛡 Segurança, 🔐 Privacidade & LGPD.',
    tags: 'documentacao tecnica arquitetura',
    category: 'sistema',
  },
  {
    q: 'Como reportar um bug ou vulnerabilidade?',
    a: 'Bug funcional: contate seu gestor. Vulnerabilidade de segurança: ver <a href="https://primetour.github.io/tarefas/.well-known/security.txt" target="_blank">/.well-known/security.txt</a> (responsible disclosure). Resposta em 72h.',
    tags: 'bug erro vulnerabilidade reportar disclosure',
    category: 'sistema',
  },
];

const CATEGORIES = [
  { id:'',           label:'Todas',         icon:'📚' },
  { id:'início',     label:'Início',        icon:'🚀' },
  { id:'tarefas',    label:'Tarefas',       icon:'✓'  },
  { id:'ia',         label:'IA Hub',        icon:'🤖' },
  { id:'segurança',  label:'Segurança',     icon:'🛡' },
  { id:'privacidade',label:'Privacidade',   icon:'🔐' },
  { id:'rh',         label:'RH/CLT',        icon:'⏱'  },
  { id:'marketing',  label:'Marketing',     icon:'📱' },
  { id:'sistema',    label:'Sistema',       icon:'⚙' },
];

export async function renderHelp(container) {
  let searchTerm = '';
  let activeCat = '';

  paint();

  function filterFaqs() {
    const term = searchTerm.toLowerCase().trim();
    return FAQS.filter(f => {
      if (activeCat && f.category !== activeCat) return false;
      if (!term) return true;
      const haystack = (f.q + ' ' + f.a + ' ' + f.tags).toLowerCase();
      return term.split(/\s+/).every(t => haystack.includes(t));
    });
  }

  function paint() {
    const tours = TOURS.filter(t => !t.eligibility || t.eligibility());
    const doneCount = tours.filter(t => hasDoneTour(t.id)).length;
    const filtered = filterFaqs();

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1 class="page-title">❓ Ajuda</h1>
          <p class="page-subtitle">Tire dúvidas, refaça tours e veja atalhos. Conteúdo global do sistema.</p>
        </div>
      </div>

      <!-- ═══ FAQ COM BUSCA (no topo) ═══ -->
      <div class="card" style="margin-bottom:24px;">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div>
            <div class="card-title">💬 Dúvidas frequentes</div>
            <div class="card-subtitle" style="font-size:0.8125rem;color:var(--text-muted);margin-top:2px;">
              ${FAQS.length} perguntas · ${filtered.length} mostrando
            </div>
          </div>
          <div style="position:relative;flex:1;max-width:360px;min-width:200px;">
            <input id="faq-search" type="search" placeholder="🔍 Buscar dúvida... (ex: ferias, ia, lgpd, ponto)"
              value="${esc(searchTerm)}"
              style="width:100%;padding:9px 12px 9px 14px;font-size:0.875rem;
              border:1px solid var(--border-default);border-radius:var(--radius-md);
              background:var(--bg-elevated);color:var(--text-primary);
              font-family:inherit;outline:none;" />
          </div>
        </div>
        <div class="card-body">
          <!-- Filtros por categoria -->
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;padding-bottom:14px;
            border-bottom:1px solid var(--border-subtle);">
            ${CATEGORIES.map(c => `
              <button data-cat="${c.id}" class="faq-cat-btn"
                style="padding:6px 12px;font-size:0.75rem;font-weight:500;
                border:1px solid ${activeCat===c.id?'var(--brand-gold)':'var(--border-subtle)'};
                background:${activeCat===c.id?'rgba(212,168,67,0.12)':'transparent'};
                color:${activeCat===c.id?'var(--brand-gold)':'var(--text-secondary)'};
                border-radius:var(--radius-full);cursor:pointer;transition:all .15s;
                font-family:inherit;display:flex;align-items:center;gap:5px;">
                <span>${c.icon}</span> ${esc(c.label)}
              </button>
            `).join('')}
          </div>

          ${filtered.length === 0 ? `
            <div style="text-align:center;padding:32px;color:var(--text-muted);font-size:0.875rem;">
              Nenhum resultado pra "<strong>${esc(searchTerm)}</strong>".
              ${activeCat ? `<br><br><button id="faq-clear-cat" class="btn btn-ghost btn-sm">↻ Limpar filtro de categoria</button>` : ''}
            </div>
          ` : filtered.map((f, i) => `
            <details style="border:1px solid var(--border-subtle);border-radius:6px;
              margin-bottom:8px;padding:0;">
              <summary style="cursor:pointer;padding:12px 14px;font-weight:600;font-size:0.875rem;
                color:var(--text-primary);list-style:none;display:flex;align-items:center;
                justify-content:space-between;gap:8px;">
                <span style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
                  <span style="font-size:0.75rem;color:var(--text-muted);">▸</span>
                  ${esc(f.q)}
                </span>
                <span style="font-size:0.625rem;padding:2px 7px;border-radius:var(--radius-full);
                  background:var(--bg-surface);color:var(--text-muted);font-weight:500;
                  white-space:nowrap;text-transform:uppercase;letter-spacing:.04em;">${esc(f.category)}</span>
              </summary>
              <div style="padding:0 14px 14px 30px;font-size:0.875rem;color:var(--text-secondary);line-height:1.6;">
                ${f.a}
              </div>
            </details>
          `).join('')}
        </div>
      </div>

      <!-- ═══ TOURS GUIADOS ═══ -->
      <div class="card" style="margin-bottom:24px;">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div>
            <div class="card-title">🎯 Tours guiados</div>
            <div class="card-subtitle" style="font-size:0.8125rem;color:var(--text-muted);margin-top:2px;">
              Aprenda na prática. ${doneCount} de ${tours.length} concluídos.
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" id="help-reset-all">↺ Refazer todos</button>
        </div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;">
            ${tours.map(t => {
              const done = hasDoneTour(t.id);
              return `<div class="card" style="padding:16px;border:1px solid ${done?'rgba(34,197,94,0.4)':'var(--border-subtle)'};
                background:${done?'rgba(34,197,94,0.04)':'var(--bg-card)'};">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                  <div style="font-size:1.5rem;">${t.icon || '◯'}</div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:0.9375rem;color:var(--text-primary);">${esc(t.title)}</div>
                    <div style="font-size:0.6875rem;color:var(--text-muted);">
                      ⏱ ${esc(t.duration||'')} · ${t.steps.length} passos
                    </div>
                  </div>
                  ${done ? `<span style="font-size:0.75rem;color:#22C55E;font-weight:600;">✓ Feito</span>` : ''}
                </div>
                <p style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.5;margin:0 0 12px;">
                  ${esc(t.description||'')}
                </p>
                <div style="display:flex;gap:6px;">
                  <button class="btn btn-${done?'secondary':'primary'} btn-sm" data-tour="${t.id}" data-act="run">
                    ${done?'↺ Refazer':'▶ Iniciar'}
                  </button>
                  ${done ? `<button class="btn btn-ghost btn-sm" data-tour="${t.id}" data-act="reset"
                    title="Marcar como não feito">⨯</button>` : ''}
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>

      <!-- ═══ ATALHOS DE TECLADO ═══ -->
      <div class="card" style="margin-bottom:24px;">
        <div class="card-header">
          <div class="card-title">⌨ Atalhos de teclado</div>
        </div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;">
            ${[
              { keys: ['ESC'],          desc: 'Fecha modal ou tour ativo' },
              { keys: ['←', '→'],       desc: 'Navega entre passos do tour' },
              { keys: ['Cmd', 'K'],     desc: 'Busca global / IA assistente' },
              { keys: ['Cmd', 'B'],     desc: 'Abre/fecha sidebar' },
              { keys: ['?'],            desc: 'Ajuda rápida (esta página)' },
              { keys: ['G', 'D'],       desc: 'Vai pra Meu Painel' },
              { keys: ['G', 'T'],       desc: 'Vai pra Tarefas' },
              { keys: ['G', 'C'],       desc: 'Vai pra Check-in' },
            ].map(s => `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;
              background:var(--bg-surface);border-radius:6px;font-size:0.8125rem;">
              <div style="display:flex;gap:4px;flex-shrink:0;">
                ${s.keys.map(k => `<kbd style="background:var(--bg-card);
                  border:1px solid var(--border-subtle);border-radius:4px;padding:2px 7px;
                  font-family:var(--font-mono,monospace);font-size:0.75rem;font-weight:600;
                  color:var(--text-primary);">${esc(k)}</kbd>`).join(' + ')}
              </div>
              <span style="color:var(--text-secondary);">${esc(s.desc)}</span>
            </div>`).join('')}
          </div>
        </div>
      </div>

      <!-- ═══ SEGURANÇA & PRIVACIDADE ═══ -->
      <div class="card" style="margin-bottom:24px;border:1px solid rgba(34,197,94,0.25);">
        <div class="card-header">
          <div>
            <div class="card-title">🛡 Segurança & Privacidade</div>
            <div class="card-subtitle" style="font-size:0.8125rem;color:var(--text-muted);margin-top:2px;">
              O que protege seus dados, em linguagem simples.
            </div>
          </div>
        </div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;">
            ${[
              ['🔐','Login só Microsoft','SSO com tenant primetour.com.br + MFA herdado do Azure AD'],
              ['🤖','IA com PII anonimizado','Emails/CPF/CNPJ trocados por placeholders antes de sair'],
              ['🛡','reCAPTCHA Enterprise','Bloqueia bots, scrapers e automações maliciosas'],
              ['💾','Backup diário automático','03h BRT → GCS com retenção 365 dias'],
              ['⏪','PITR ativo','Recovery granular até 7 dias atrás (qualquer minuto)'],
              ['📋','Audit logs imutáveis','Cada login/ação registrada com IP+UA por 180 dias'],
              ['📊','Digest diário SIEM','Relatório 09h BRT com anomalias e risk score'],
              ['🔄','Rotação de secrets','Alerta semanal se API key passar dos 90d'],
              ['🌐','Rate limit per-IP','Defesa DDoS antes mesmo da autenticação'],
              ['✅','LGPD completo','Art. 18 todos: acesso, correção, exportação, eliminação'],
            ].map(([icon,t,d]) => `
              <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);
                border-radius:var(--radius-md);padding:12px;">
                <div style="font-size:1.125rem;margin-bottom:6px;">${icon}</div>
                <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);margin-bottom:3px;">${esc(t)}</div>
                <div style="font-size:0.7188rem;color:var(--text-muted);line-height:1.5;">${esc(d)}</div>
              </div>
            `).join('')}
          </div>
          ${(store.isMaster() || store.can('system_manage_users')) ? `
            <div style="margin-top:14px;padding:12px 14px;background:rgba(212,168,67,.07);
              border-left:3px solid var(--brand-gold);border-radius:0 6px 6px 0;">
              <div style="font-size:0.875rem;font-weight:600;color:var(--brand-gold);margin-bottom:6px;">
                📚 Documentação técnica completa
              </div>
              <div style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.6;margin-bottom:10px;">
                Pra time de TI/segurança/compliance — 8 documentos versionados:
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <a href="docs.html?doc=security"     class="btn btn-secondary btn-sm">🛡 Segurança</a>
                <a href="docs.html?doc=threat-model" class="btn btn-secondary btn-sm">🎯 Modelo de Ameaças</a>
                <a href="docs.html?doc=incident"     class="btn btn-secondary btn-sm">🚨 Resposta a Incidentes</a>
                <a href="docs.html?doc=access"       class="btn btn-secondary btn-sm">🔑 RBAC</a>
                <a href="docs.html?doc=data-flow"    class="btn btn-secondary btn-sm">🔐 Fluxo de Dados</a>
                <a href="docs.html?doc=infra"        class="btn btn-secondary btn-sm">⚙ Infraestrutura</a>
                <a href="docs.html?doc=fact-sheet"   class="btn btn-secondary btn-sm">📄 Fact Sheet</a>
                <a href="docs.html"                  class="btn btn-primary btn-sm">📚 Ver todos →</a>
              </div>
            </div>
          ` : ''}
        </div>
      </div>

      <!-- ═══ LINKS ÚTEIS ═══ -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">🔗 Links úteis</div>
        </div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;">
            ${[
              { show: store.isMaster() || store.can('system_manage_users'),
                href: '#about', icon: '📚', label: 'Sobre o Sistema',
                desc: '8 abas: pilares, hierarquia, dados, infra, segurança, LGPD' },
              { show: store.can('system_manage_settings'),
                href: '#settings', icon: '⚙', label: 'Configurações',
                desc: 'Geral, integrações, privacidade, dados' },
              { show: store.can('system_manage_users'),
                href: '#users', icon: '👥', label: 'Gerenciar usuários',
                desc: 'Criar, editar roles, desativar' },
              { show: true,
                href: '#profile', icon: '🔐', label: 'Privacidade e IA',
                desc: 'Exportar / excluir meus dados (LGPD)' },
              { show: store.can('portal_manage'),
                href: 'solicitar.html', target: '_blank', icon: '🌐', label: 'Portal público',
                desc: 'Formulário externo de solicitações' },
              { show: store.can('content_calendar_view'),
                href: 'calendario-conteudo.html', target: '_blank', icon: '📱', label: 'Calendário público',
                desc: 'Read-only do calendário de conteúdo' },
              { show: true,
                href: 'https://primetour.github.io/tarefas/.well-known/security.txt', target: '_blank',
                icon: '🛡', label: 'Reportar vulnerabilidade',
                desc: 'Responsible disclosure (RFC 9116)' },
              { show: store.isMaster() || store.can('system_manage_users'),
                href: 'https://github.com/primetour/tarefas', target: '_blank',
                icon: '💻', label: 'Código fonte',
                desc: 'Repositório GitHub' },
              { show: store.isMaster() || store.can('system_manage_users'),
                href: 'https://console.firebase.google.com/project/gestor-de-tarefas-primetour/overview',
                target: '_blank', icon: '🔥', label: 'Firebase Console',
                desc: 'Apenas owners autorizados' },
            ].filter(l => l.show).map(l => `
              <a href="${esc(l.href)}" ${l.target?`target="${esc(l.target)}"`:''}
                style="display:flex;gap:10px;align-items:flex-start;padding:12px 14px;
                background:var(--bg-surface);border:1px solid var(--border-subtle);
                border-radius:var(--radius-md);text-decoration:none;transition:all .15s;">
                <div style="font-size:1.25rem;flex-shrink:0;">${l.icon}</div>
                <div style="min-width:0;">
                  <div style="font-size:0.875rem;font-weight:600;color:var(--text-primary);margin-bottom:2px;">${esc(l.label)}</div>
                  <div style="font-size:0.75rem;color:var(--text-muted);line-height:1.4;">${esc(l.desc)}</div>
                </div>
              </a>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    bindings();
  }

  function bindings() {
    // Search input
    const search = container.querySelector('#faq-search');
    if (search) {
      search.addEventListener('input', e => {
        searchTerm = e.target.value;
        const cursorPos = search.selectionStart;
        paint();
        // Restaura foco e cursor após repaint
        const newSearch = container.querySelector('#faq-search');
        if (newSearch) {
          newSearch.focus();
          newSearch.setSelectionRange(cursorPos, cursorPos);
        }
      });
    }

    // Category filters
    container.querySelectorAll('.faq-cat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeCat = btn.dataset.cat;
        paint();
      });
    });

    container.querySelector('#faq-clear-cat')?.addEventListener('click', () => {
      activeCat = '';
      paint();
    });

    // Tours
    container.querySelectorAll('[data-act="run"]').forEach(btn => {
      btn.addEventListener('click', () => runTour(btn.dataset.tour));
    });
    container.querySelectorAll('[data-act="reset"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await resetTour(btn.dataset.tour);
        paint();
      });
    });
    container.querySelector('#help-reset-all')?.addEventListener('click', async () => {
      if (!confirm('Marcar TODOS os tours como não feitos?\nIsso fará com que voltem a aparecer automaticamente nas próximas navegações.')) return;
      await resetAllTours();
      paint();
    });
  }
}
