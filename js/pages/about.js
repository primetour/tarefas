/**
 * PRIMETOUR — Sobre o Sistema
 * Guia de referência para usuários — acesso restrito a admin/master
 *
 * Reestruturado 2026-05-03: 8 abas → 4 (eliminada duplicação com docs.html).
 * Tabs:
 *   1. 🏛 Estrutura     — pilares + hierarquia + papéis
 *   2. 🗺 Módulos       — mapa completo (38 módulos × 7 grupos)
 *   3. ⚙ Stack          — infra + cloud functions + DR
 *   4. 🛡 Segurança     — defesa em camadas + IA confidencialidade + docs
 *
 * Dados técnicos detalhados (PII inventory, threat model STRIDE, runbooks,
 * modelo de dados completo) ficam em /docs.html?doc=X (markdown renderizado).
 */

import { store } from '../store.js';

export async function renderAbout(container) {
  if (!store.isMaster() && !store.can('system_manage_users')) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
      <p class="text-sm text-muted">Esta página é visível apenas para Diretoria e Head.</p>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Sobre o sistema</h1>
        <p class="page-subtitle">Estrutura, módulos, stack técnico e segurança</p>
      </div>
      <div class="page-header-actions">
        <span style="font-size:0.75rem;color:var(--text-muted);padding:4px 10px;
          border-radius:var(--radius-full);border:1px solid var(--border-subtle);">
          🔒 Diretoria e Head
        </span>
      </div>
    </div>
    <div id="about-wrap" style="border:1px solid var(--border-subtle);border-radius:var(--radius-lg);overflow:hidden;background:var(--bg-card);padding:1.5rem 1.25rem;"></div>
  `;

  buildDoc(document.getElementById('about-wrap'));
}

/* ─── helpers ──────────────────────────────────────────────── */
const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const TABS = [
  { id:'estrutura', label:'🏛 Estrutura' },
  { id:'modulos',   label:'🗺 Módulos' },
  { id:'stack',     label:'⚙ Stack' },
  { id:'seguranca', label:'🛡 Segurança & LGPD' },
  { id:'docs',      label:'📚 Documentação técnica' },
];

/* ─── Content per tab ──────────────────────────────────────── */
const CONTENT = {

  /* ═══════════════════════════════════════════════════════
   * 🏛 ESTRUTURA — pilares + hierarquia + papéis
   * ═══════════════════════════════════════════════════════ */
  estrutura: () => `
    <h3 style="font-size:1rem;font-weight:600;color:var(--text-primary);margin:0 0 8px;">Os 6 pilares do Gestor PRIMETOUR</h3>
    <p style="font-size:0.8125rem;color:var(--text-muted);line-height:1.6;margin-bottom:14px;">
      Cada pilar cobre uma dimensão crítica da operação corporativa. Juntos formam o produto.
    </p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-bottom:24px;">
      ${[
        ['🏛','Hierarquia organizacional','Setor → Núcleo → Tipo → Variação → Tarefa.'],
        ['👥','Papéis e permissões',      '6 níveis × 70+ permissões granulares.'],
        ['🔭','Visibilidade de dados',    'Scopes own/sector/squad/all em dupla camada.'],
        ['🤖','IA Hub corporativo',       'Multi-provider, PII anonimizado, knowledge SharePoint.'],
        ['🛡','Segurança em camadas',     'TLS, App Check, SSO+MFA, RBAC, rules, SIEM.'],
        ['🔐','Privacidade by design',    'LGPD completo, audit imutável, DPO designado.'],
      ].map(([icon,name,desc]) => `
        <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);
          border-radius:var(--radius-md);padding:14px;">
          <div style="font-size:1.5rem;margin-bottom:8px">${icon}</div>
          <div style="font-size:0.875rem;font-weight:600;color:var(--text-primary);margin-bottom:6px">${name}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);line-height:1.55">${desc}</div>
        </div>
      `).join('')}
    </div>

    <div style="background:rgba(212,168,67,.07);border-left:3px solid var(--brand-gold);
      border-radius:0 var(--radius-md) var(--radius-md) 0;padding:12px 16px;margin-bottom:32px;">
      <p style="font-size:0.875rem;font-weight:600;color:var(--brand-gold);margin-bottom:6px">3 regras de ouro</p>
      <ol style="margin:0;padding-left:20px;font-size:0.8125rem;color:var(--text-secondary);line-height:1.7;">
        <li><strong>Setor é entrada</strong> — todo módulo parte do setor do usuário logado.</li>
        <li><strong>Server-side é fonte da verdade</strong> — toda permissão checada cliente E servidor (Firestore Rules + Cloud Functions).</li>
        <li><strong>Audit tudo</strong> — eventos críticos vão pra <code>audit_logs</code> imutável (TTL 180d), com IP+UA capturado server-side.</li>
      </ol>
    </div>

    <h3 style="font-size:1rem;font-weight:600;color:var(--text-primary);margin:0 0 8px;">Hierarquia organizacional</h3>
    <p style="font-size:0.8125rem;color:var(--text-muted);line-height:1.6;margin-bottom:14px;">
      Cinco níveis subordinados. Visibilidade herda do anterior.
    </p>
    ${[
      ['#1a2a4a','#a8c4e8','🏢','Setor',         'Quem executa',           'Ex: Marketing, TI, Operadora, Financeiro.','0'],
      ['#1a3a2a','#7ecfa8','◈', 'Núcleo',         'Equipe dentro do setor', 'Ex: Design, Comunicação, Dados, Web.','20'],
      ['#3a1a2a','#d4a0be','📋','Tipo de tarefa', 'Define campos e fluxo',  'Ex: Newsletter, Apresentação, Briefing.','40'],
      ['#3a2a1a','#d4c0a0','🔀','Variação',       'Modalidade do entregável','Ex: Revisão / Criação do zero. SLA vem daqui.','60'],
      ['#2a1a3a','#b0a0d4','✓', 'Tarefa',         'A demanda real',         'Instância criada com typeId, variationId, dueDate, assignees.','80'],
    ].map(([bg,fg,icon,name,sub,desc,ml],i,arr) => `
      <div style="margin-left:${ml}px">
        <div style="display:flex;align-items:stretch;border-radius:var(--radius-md);overflow:hidden;border:1px solid var(--border-subtle);">
          <div style="display:flex;align-items:center;justify-content:center;padding:0 14px;
            background:${bg};color:${fg};font-size:0.75rem;font-weight:700;
            min-width:140px;white-space:nowrap;gap:6px;">
            <span>${icon}</span><span>${name}</span>
          </div>
          <div style="flex:1;padding:10px 14px;border-left:1px solid var(--border-subtle);">
            <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary)">${sub}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;line-height:1.5">${desc}</div>
          </div>
        </div>
        ${i < arr.length-1 ? `<div style="text-align:center;font-size:0.875rem;color:var(--text-muted);padding:2px 0;margin-left:30px">↓</div>` : ''}
      </div>
    `).join('')}

    <h3 style="font-size:1rem;font-weight:600;color:var(--text-primary);margin:32px 0 8px;">Os 6 papéis</h3>
    <p style="font-size:0.8125rem;color:var(--text-muted);line-height:1.6;margin-bottom:14px;">
      Diretoria tem acesso total. Head atua como DPO (LGPD). Parceiros são externos com acesso restrito.
    </p>
    <div style="overflow-x:auto;margin-bottom:16px;">
      <table style="width:100%;border-collapse:collapse;font-size:0.8125rem;">
        <thead><tr style="background:var(--bg-surface);">
          <th style="padding:9px 12px;text-align:left;font-weight:600;color:var(--text-muted);">Papel</th>
          <th style="padding:9px 12px;text-align:left;font-weight:600;color:var(--text-muted);">Função</th>
          <th style="padding:9px 12px;text-align:left;font-weight:600;color:var(--text-muted);">Visibilidade</th>
          <th style="padding:9px 12px;text-align:left;font-weight:600;color:var(--text-muted);">Permissões críticas</th>
        </tr></thead>
        <tbody>
          ${[
            ['Diretoria',   '#EF4444', 'Direção executiva',    'Todos os setores',                'Tudo + zona de perigo'],
            ['Head',        '#A78BFA', 'Gestão + DPO',         'Setores configurados pela Direção','Usuários, configs, branding, LGPD outros'],
            ['Gerente',     '#38BDF8', 'Gerencia squad',       'Setor do usuário',                'Aprovar férias, ver audit do squad'],
            ['Coordenador', '#F97316', 'Coordena tarefas',     'Setor + núcleo',                  'Triagem, criar tipos no setor'],
            ['Analista',    '#22C55E', 'Operação',             'Setor do usuário',                'Criar tarefas, próprios dados LGPD'],
            ['Parceiro',    '#D4A843', 'Externo',              'Apenas Portal de Dicas',          'Download dicas (limite 5/dia)'],
          ].map(([papel,cor,funcao,vis,perms]) => `
            <tr style="border-bottom:1px solid var(--border-subtle);">
              <td style="padding:9px 12px;font-weight:600;color:${cor};">${esc(papel)}</td>
              <td style="padding:9px 12px;color:var(--text-secondary);">${esc(funcao)}</td>
              <td style="padding:9px 12px;color:var(--text-muted);">${esc(vis)}</td>
              <td style="padding:9px 12px;color:var(--text-secondary);">${esc(perms)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div style="background:rgba(59,130,246,.07);border-left:3px solid #3B82F6;
      border-radius:0 var(--radius-md) var(--radius-md) 0;padding:12px 16px;">
      <p style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.6;margin:0;">
        <strong>Customizar permissões:</strong> Diretoria edita em <code>Configurações → Roles</code>.
        Sistema marca como <code>customizedPermissions: true</code> e preserva edições mesmo após updates.
        Detalhes completos da matriz RBAC em
        <a href="docs.html?doc=access" style="color:var(--brand-gold);">📚 Controle de Acesso</a>.
      </p>
    </div>`,

  /* ═══════════════════════════════════════════════════════
   * 🗺 MÓDULOS — mapa completo (mantido como estava)
   * ═══════════════════════════════════════════════════════ */
  modulos: () => `
    <p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:20px;line-height:1.6">
      38 módulos agrupados por área. Como a hierarquia de setor e tipo se aplica em cada um.
    </p>

    ${[
      ['Tarefas e Projetos', [
        ['Meu Painel',              '✓ Setor do usuário',     '—',                         'Tarefas atribuídas, ausências, próximas reuniões'],
        ['Tarefas (lista)',         '✓ Automático',           '✓ Disponível',              'Área, responsável, status, projeto, meta'],
        ['Steps / Kanban',          '◐ Filtro combinado',     '✓ Seletor na esteira',      'Área, responsável, projeto'],
        ['Calendário',              '◐ Filtro combinado',     '✓ Seletor na esteira',      'Área, responsável, projeto, mês/semana'],
        ['Timeline',                '◐ Filtro combinado',     '◐ Filtro combinado',        'Área, projeto, gantt'],
        ['Projetos',                '✓ Por setor',            '—',                         'Tarefas vinculadas, progresso, milestones'],
      ]],
      ['IA Hub', [
        ['Conversa com Agentes',    '— (global)',             '—',                         'Multi-provider, PII anonimizado'],
        ['Skills (instruções)',     '— (global)',             '—',                         'Biblioteca compartilhada, versioning'],
        ['Knowledge SharePoint',    '✓ Por setor (visibility)','—',                        'Cache Firestore, sync via getSharePointToken'],
        ['Automações',              '— (global)',             '—',                         'Triggers (cron, evento), workflow steps'],
        ['Dashboard de IA',         '— (global)',             '—',                         'Custo por agente/usuário, tokens, qualidade'],
      ]],
      ['Equipe e CLT', [
        ['Check-in (ponto)',        '— (próprio)',            '—',                         'Banco de horas CLT, espelho, correção via gestor'],
        ['Reservas de mesa',        '— (próprio)',            '—',                         '1 reserva/dia, mapa visual'],
        ['Equipe / Ausências',      '✓ Setor do usuário',     '—',                         'Calendário compartilhado, conflitos'],
        ['Férias (CLT)',            '— (próprio)',            '—',                         'Períodos aquisitivos, fracionamento, abono'],
        ['Feedbacks',               '✓ Por setor',            '—',                         'Kudos / concerns, ciclo de avaliação'],
        ['Metas (KPIs)',            '✓ Por setor/núcleo',     '—',                         'Status, exportação XLS/PDF'],
      ]],
      ['Marketing e Conteúdo', [
        ['Calendário de Conteúdo',  '✓ Por conta',            '—',                         'IG/FB/etc, slot mês/semana, IA sugere descrição/legenda, agendamento'],
        ['Roteiros de Viagem',      '— (próprio + admin)',    '✓ Filtrado por consultor',  'Tabela densa, filtros, pag.; cliente/destinos/dia-a-dia/hotéis/valores; nova seção Imagens (banco + auto-fetch Unsplash/Wikipedia + override manual); IA Hub gera draft; export PDF/PPTX com logo+cores da BU; área obrigatória'],
        ['Portal de Dicas',         '✓ Campo obrigatório',    '✓ Filtrado pelo setor',     'Variação, área, materiais por formato (PDF/PPTX/DOCX), web search, IA enriquece'],
        ['Templates de Áreas (BUs)','— (global)',             '—',                         'Cores primary/secondary, logo + logo-alt. Single source of truth — usado por Roteiros e Portal de Dicas'],
        ['Banco de Imagens',        '— (global)',             '✓ Por continente/país/cidade','Upload R2 + WebP convert, tags, tipo (destaque/galeria/banner). Compartilhado com Roteiros e Portal'],
        ['Revista Luxury Travel',   '— (global)',             '—',                         'CMS de edições, upload PDFs (PT/EN), QR codes (por edição + home), fontes customizadas, flipbook em GH Pages'],
        ['Landing Pages',           '— (global)',             '—',                         'Layout, seções, link público'],
        ['CMS / Site',              '— (global)',             '—',                         'Páginas, blog, SEO via Cloudflare Workers'],
        ['Editor de Artes',         '— (global)',             '—',                         'Templates por BU, canvas, export PNG/JPG'],
        ['Pautas e Clipping',       '— (global)',             '—',                         'Categoria, validade, ✈ Tarefa, exportação'],
      ]],
      ['Análise', [
        ['Newsletters',             '— (global)',             '—',                         'Período custom, por BU'],
        ['Instagram (Meta)',        '— (global)',             '—',                         'Engajamento, alcance, top posts'],
        ['Produtividade',           '✓ Setor do usuário',     '—',                         'SLA, throughput, gargalos'],
        ['Auditoria de Sites',      '— (global)',             '—',                         'PageSpeed Insights, Core Web Vitals'],
        ['CSAT',                    '— (global)',             '—',                         'NPS por tarefa, gestor, área'],
      ]],
      ['Solicitações', [
        ['Solicitações (interno)',  '◐ Por status',           '◐ Por tipo',                'Triagem (master+coord), conversão em tarefa'],
        ['Portal público',          '✓ Sem auth',             '✓ Por setor',               'solicitar.html — formulário externo'],
      ]],
      ['Sistema', [
        ['Configurações',           '— (global)',             '—',                         'Geral, tarefas, notificações, integrações, privacidade, dados'],
        ['Tipos de tarefa',         '✓ Builder por setor',    '— (é o objeto)',            'Agrupado por categoria, variations, SLA'],
        ['Setores e Núcleos',       '✓ Gerencia setores',     '—',                         'Hierarquia de visibilidade'],
        ['Roles e Permissões',      '— (global)',             '—',                         '6 roles, 70+ permissions editáveis'],
        ['Log de Auditoria',        '— (global)',             '—',                         'audit_logs com TTL 180d, severity classification'],
        ['Sobre o Sistema',         '— (global)',             '—',                         'Esta página: estrutura, módulos, stack, segurança'],
        ['Ajuda',                   '— (global)',             '—',                         'Tours, FAQ com busca, atalhos, docs técnicos'],
      ]],
    ].map(([group, rows]) => `
      <h3 style="font-size:0.875rem;font-weight:700;color:var(--text-secondary);margin:18px 0 10px;
        text-transform:uppercase;letter-spacing:.06em;">${esc(group)}</h3>
      <div style="overflow-x:auto;margin-bottom:14px;">
        <table style="width:100%;border-collapse:collapse;font-size:0.75rem;">
          <thead>
            <tr style="background:var(--bg-surface);">
              ${['Módulo','Filtro de setor','Filtro de tipo','Filtros adicionais'].map(h =>
                `<th style="text-align:left;padding:9px 12px;font-weight:600;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);white-space:nowrap;">${h}</th>`
              ).join('')}
            </tr>
          </thead>
          <tbody>
            ${rows.map(([mod, ...rest]) => `
              <tr style="border-bottom:1px solid var(--border-subtle);">
                <td style="padding:9px 12px;font-weight:600;color:var(--text-primary);white-space:nowrap;">${esc(mod)}</td>
                ${rest.map(v => `<td style="padding:9px 12px;color:var(--text-secondary);line-height:1.4;">${esc(v)}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `).join('')}

    <div style="margin-top:16px;font-size:0.75rem;color:var(--text-muted);display:flex;gap:16px;">
      <span>✓ Implementado</span>
      <span>◐ Parcialmente implementado</span>
      <span>— Não aplica</span>
    </div>`,

  /* ═══════════════════════════════════════════════════════
   * ⚙ STACK — infra + cloud functions + DR
   * ═══════════════════════════════════════════════════════ */
  stack: () => `
    <p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:16px;line-height:1.6;">
      Stack 100% serverless sobre Google Cloud + Firebase. Sem servidores próprios pra manter.
      Escala automática. Free tier suficiente pra operação atual.
    </p>

    <h3 style="font-size:1rem;font-weight:600;color:var(--text-primary);margin:0 0 8px;">Stack Tecnológico</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;margin-bottom:24px;">
      ${[
        ['🌐','Frontend','SPA estática (HTML/CSS/JS vanilla, ES modules). Sem framework. GitHub Pages com CDN global.'],
        ['🔥','Database','Cloud Firestore (NoSQL document) — multi-region nam5. Cache IndexedDB reduz reads em 80%.'],
        ['⚡','Backend','Firebase Cloud Functions Gen 2 (Node.js 20). 9 funções serverless. Auto-scale 0→100.'],
        ['🔑','Auth','Firebase Auth + Microsoft SSO (tenant primetour.com.br). Senhas nunca chegam ao código.'],
        ['📦','Storage','Cloudflare R2 (S3-compatible) pra imagens públicas. CDN edge global.'],
        ['📁','SharePoint','Server-side via Microsoft Graph API com client_credentials. Docs corporativos sem expor credenciais.'],
        ['🤖','LLMs','Proxy unificado: Anthropic, OpenAI, Gemini, Groq. Keys 100% Secret Manager.'],
        ['💾','Backup','Snapshot diário Firestore→GCS NEARLINE (03h BRT). Lifecycle: NEARLINE→COLDLINE@30d→ARCHIVE@90d→DELETE@365d.'],
      ].map(([icon,name,desc]) => `
        <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);
          border-radius:var(--radius-md);padding:14px;">
          <div style="font-size:1.25rem;margin-bottom:8px">${icon}</div>
          <div style="font-size:0.875rem;font-weight:600;color:var(--text-primary);margin-bottom:4px">${name}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);line-height:1.55">${desc}</div>
        </div>
      `).join('')}
    </div>

    <h3 style="font-size:1rem;font-weight:600;color:var(--text-primary);margin:0 0 8px;">Cloud Functions deployadas</h3>
    <div style="overflow:auto;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:0.8125rem;">
        <thead><tr style="background:var(--bg-surface);">
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--text-secondary);">Função</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--text-secondary);">Tipo</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--text-secondary);">Schedule</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--text-secondary);">Função</th>
        </tr></thead>
        <tbody>
          ${[
            ['callLLM','onCall','—','Proxy unificado pra todos LLMs com rate limit + cost cap + prompt caching'],
            ['getR2UploadUrl','onCall','—','Upload assinado R2 com path whitelist + traversal block'],
            ['getSharePointToken','onCall','—','Token Microsoft Graph (client_credentials)'],
            ['getGitHubFile','onCall','—','Read GitHub repos com PAT server-side'],
            ['logUserLogin','onCall','—','Audit IP+UserAgent de cada login + suspicious-IP detection'],
            ['eraseUserDataServer','onCall','—','LGPD Art. 18 VI — eliminação de dados'],
            ['dailyBackup','schedule','03h BRT','Snapshot Firestore → GCS NEARLINE'],
            ['dailySecurityDigest','schedule','09h BRT','SIEM diário com risk score + Slack'],
            ['weeklySecretsAudit','schedule','seg 09h BRT','Alerta secrets >90 dias sem rotação'],
          ].map(([n,t,s,d]) => `
            <tr style="border-bottom:1px solid var(--border-subtle);">
              <td style="padding:9px 12px;font-family:monospace;font-size:0.75rem;color:var(--brand-gold);">${esc(n)}</td>
              <td style="padding:9px 12px;color:var(--text-secondary);">${esc(t)}</td>
              <td style="padding:9px 12px;color:var(--text-muted);">${esc(s)}</td>
              <td style="padding:9px 12px;color:var(--text-secondary);">${esc(d)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <h3 style="font-size:1rem;font-weight:600;color:var(--text-primary);margin:0 0 8px;">Disaster Recovery</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-bottom:16px;">
      ${[
        ['PITR Firestore','Recovery granular até 7 dias atrás (granularidade minuto)'],
        ['Daily backup','Snapshot completo Firestore em GCS, retido 365 dias'],
        ['Delete protection','Impede DROP acidental do banco (gcloud rejeita)'],
        ['Multi-region','Banco em nam5 (replicação automática 2+ regiões US)'],
        ['RTO','Recovery Time Objective: &lt; 4h (script em Resposta a Incidentes)'],
        ['RPO','Recovery Point Objective: &lt; 1 min (PITR ativo)'],
      ].map(([k,v]) => `
        <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:12px;">
          <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);margin-bottom:4px;">${esc(k)}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);line-height:1.5;">${v}</div>
        </div>
      `).join('')}
    </div>

    <div style="background:rgba(59,130,246,.07);border-left:3px solid #3B82F6;
      border-radius:0 var(--radius-md) var(--radius-md) 0;padding:12px 16px;margin-bottom:24px;">
      <p style="font-size:0.8125rem;font-weight:600;color:#3B82F6;margin-bottom:4px">💰 Custo de infraestrutura</p>
      <p style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.6;margin:0">
        Operação atual cabe em <strong>Free Tier</strong> de Firebase + Google Cloud.
        Estimativa em escala 100 usuários: <strong>R$ 50–150/mês</strong>.
        Sem licenças de software, sem servidores dedicados.
      </p>
    </div>

    <h3 style="font-size:1rem;font-weight:600;color:var(--text-primary);margin:0 0 8px;">Documentação técnica detalhada</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;">
      ${[
        ['🗂','Modelo de Dados (Firestore)', 'data-model',   '36 collections, campos, PK/FK, TTL, índices'],
        ['⚙','Infraestrutura completa',     'infra',        'Stack, deploy, monitoring, custos detalhados'],
        ['💾','Prompt Caching (IA)',         'prompt-cache', 'Anthropic + OpenAI cache, economia 47-90% input'],
        ['☁','Migração Cloudflare',         'cloudflare', 'Plano de migração GH Pages → CF Pages'],
      ].map(([icon,title,id,desc]) => `
        <a href="docs.html?doc=${id}"
          style="display:flex;gap:12px;align-items:flex-start;padding:14px;
          background:var(--bg-surface);border:1px solid var(--border-subtle);
          border-radius:var(--radius-md);text-decoration:none;transition:all .15s;">
          <div style="font-size:1.5rem;flex-shrink:0;">${icon}</div>
          <div style="min-width:0;flex:1;">
            <div style="font-size:0.875rem;font-weight:600;color:var(--text-primary);margin-bottom:3px;">${esc(title)}</div>
            <div style="font-size:0.7188rem;color:var(--text-muted);line-height:1.5;">${esc(desc)}</div>
          </div>
          <div style="font-size:0.875rem;color:var(--text-muted);flex-shrink:0;">→</div>
        </a>
      `).join('')}
    </div>`,

  /* ═══════════════════════════════════════════════════════
   * 🛡 SEGURANÇA & LGPD — defesa em camadas + IA + docs
   * ═══════════════════════════════════════════════════════ */
  seguranca: () => `
    <p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:16px;line-height:1.6;">
      Defesa em profundidade — múltiplas camadas independentes.
      Compliance: LGPD ✓ · SOC 2 Type II (ready) · ISO 27001 (mapped).
    </p>

    <h3 style="font-size:1rem;font-weight:600;color:var(--text-primary);margin:0 0 8px;">10 camadas de defesa</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;margin-bottom:24px;">
      ${[
        ['1','Edge','TLS 1.3, HSTS, headers seguros'],
        ['2','Application','CSP estrita, Permissions-Policy'],
        ['3','Bot Detection','App Check + reCAPTCHA Enterprise'],
        ['4','Authentication','MS SSO obrigatório + MFA Azure AD'],
        ['5','Authorization','RBAC 6 níveis + visibility scopes'],
        ['6','Database','Firestore Rules + 12 vetores testados'],
        ['7','Backend','Per-IP rate limit + cost cap'],
        ['8','Secrets','Secret Manager + rotação 90d monitorada'],
        ['9','Monitoring','SIEM diário + Slack alerts'],
        ['10','Audit','audit_logs append-only TTL 180d'],
      ].map(([n,t,d]) => `
        <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);
          border-radius:var(--radius-md);padding:12px;display:flex;gap:10px;align-items:flex-start;">
          <div style="font-size:0.875rem;font-weight:700;color:var(--brand-gold);min-width:20px;">${n}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);margin-bottom:2px;">${esc(t)}</div>
            <div style="font-size:0.7188rem;color:var(--text-muted);line-height:1.5;">${esc(d)}</div>
          </div>
        </div>
      `).join('')}
    </div>

    <h3 style="font-size:1rem;font-weight:600;color:var(--text-primary);margin:0 0 8px;">Privacidade by design</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;margin-bottom:24px;">
      ${[
        ['🔐','Login só Microsoft','SSO + MFA herdado do Azure AD'],
        ['🤖','IA com PII anonimizado','Emails/CPF/CNPJ trocados por placeholders'],
        ['💾','Backup + PITR','03h BRT GCS + recovery 7d granular'],
        ['📋','Audit logs imutáveis','IP+UA por 180d, append-only'],
        ['✅','LGPD escopo total','12 artigos atendidos (Art. 6, 7, 9, 18, 33, 37, 41, 46, 48, 50)'],
        ['👤','DPO designado','Rene Castro · 15 dias úteis SLA'],
      ].map(([icon,t,d]) => `
        <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);
          border-radius:var(--radius-md);padding:12px;">
          <div style="font-size:1.125rem;margin-bottom:6px;">${icon}</div>
          <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);margin-bottom:3px;">${esc(t)}</div>
          <div style="font-size:0.7188rem;color:var(--text-muted);line-height:1.5;">${esc(d)}</div>
        </div>
      `).join('')}
    </div>

    <!-- ═══ COMPLIANCE LGPD — escopo completo (mais que Art. 18) ═══ -->
    <h3 style="font-size:1rem;font-weight:600;color:var(--text-primary);margin:0 0 6px;">
      📜 Compliance LGPD — escopo completo
    </h3>
    <p style="font-size:0.8125rem;color:var(--text-muted);line-height:1.6;margin-bottom:14px;">
      A LGPD <strong>não se resume ao Art. 18</strong> (direitos do titular). Atendemos toda a cadeia de obrigações
      legais — princípios, bases legais, segurança, governança, incidentes e transferência internacional.
    </p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;margin-bottom:24px;">
      ${[
        ['Art. 6',  '10 Princípios',         'Finalidade, adequação, necessidade, livre acesso, qualidade, transparência, segurança, prevenção, não-discriminação, responsabilização.'],
        ['Art. 7',  '10 Bases legais',       'Consentimento, contrato, obrigação legal, política pública, estudos, exercício de direitos, proteção da vida, saúde, legítimo interesse, proteção ao crédito.'],
        ['Art. 8',  'Consentimento',         'Forma específica + destacada. Versionado em users.privacy.consentVersion (atualmente v1.1).'],
        ['Art. 9',  'Direito de informação', 'Política de privacidade clara + acessível em "Sobre o Sistema". Linguagem não-técnica, no idioma do titular.'],
        ['Art. 18', '9 Direitos do titular', 'Confirmação, acesso, correção, anonimização, portabilidade, eliminação, info compartilhamento, revogação consent. SLA 15 dias úteis.'],
        ['Art. 22', 'Operadores', 'Listamos todos operadores (Google, Microsoft, Anthropic, OpenAI, Cloudflare) com DPA assinado.'],
        ['Art. 33', 'Transferência internacional', 'EUA + Multi via cláusulas-padrão dos provedores. Documentado em DATA-FLOW.md.'],
        ['Art. 37', 'Registro de operações',  'Inventário PII por collection com finalidade, retenção e base legal — em DATA-FLOW.md.'],
        ['Art. 41', 'DPO/Encarregado',        '<strong>Rene Castro</strong> · rene.castro@primetour.com.br · responde em até 15 dias úteis.'],
        ['Art. 46', 'Medidas técnicas + administrativas', 'TLS 1.3, MFA, RBAC, Firestore Rules, criptografia em repouso (GCP), audit logs imutáveis, treinamento equipe, política interna.'],
        ['Art. 48', 'Comunicação de incidente', 'Runbook com SLA <strong>72h pra ANPD</strong> + comunicação titulares. Detalhado em INCIDENT-RESPONSE.md.'],
        ['Art. 50', 'Programa de governança',  'Políticas, treinamentos, revisão trimestral, pentest interno, monitoramento contínuo (SIEM).'],
      ].map(([artigo, nome, desc]) => `
        <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);
          border-radius:var(--radius-md);padding:12px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:5px;gap:6px;">
            <span style="font-size:0.6875rem;font-weight:700;color:var(--brand-gold);
              padding:2px 7px;background:rgba(212,168,67,.12);border-radius:var(--radius-full);
              white-space:nowrap;">${esc(artigo)}</span>
            <span style="font-size:0.6875rem;color:#22C55E;font-weight:600;">✓</span>
          </div>
          <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);margin-bottom:4px;">${esc(nome)}</div>
          <div style="font-size:0.7188rem;color:var(--text-muted);line-height:1.5;">${desc}</div>
        </div>
      `).join('')}
    </div>

    <div style="background:rgba(34,197,94,.07);border-left:3px solid #22C55E;
      border-radius:0 var(--radius-md) var(--radius-md) 0;padding:12px 16px;margin-bottom:24px;">
      <p style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.6;margin:0;">
        Detalhes completos de cada artigo, inventário PII e bases legais por collection em
        <a href="docs.html?doc=data-flow" style="color:var(--brand-gold);">📚 Fluxo de Dados & PII</a>.
        Runbook de resposta a incidentes (Art. 48) em
        <a href="docs.html?doc=incident" style="color:var(--brand-gold);">📚 Resposta a Incidentes</a>.
      </p>
    </div>

    <!-- ═══ CONFIDENCIALIDADE NA IA HUB (diferencial corporativo) ═══ -->
    <h3 style="font-size:1rem;font-weight:600;color:var(--text-primary);margin:0 0 6px;">
      🤖 Confidencialidade na IA Hub
    </h3>
    <p style="font-size:0.8125rem;color:var(--text-muted);line-height:1.6;margin-bottom:14px;">
      <strong>Pergunta corporativa frequente:</strong> "Os dados ficam no servidor de vocês ou vão pra OpenAI?"
      Resposta: o modelo roda no servidor do provider, mas o dado sai do Gestor PRIMETOUR
      <strong>anonimizado</strong> e a inferência é <strong>contratualmente isolada</strong> (DPA + no-train).
    </p>

    <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);
      border-radius:var(--radius-md);padding:18px;margin-bottom:18px;font-family:monospace;
      font-size:0.7188rem;line-height:1.55;color:var(--text-secondary);overflow-x:auto;">
<pre style="margin:0;white-space:pre;color:var(--text-secondary);">
┌─────────────┐                                ┌──────────────────┐
│   Browser   │                                │  Provider LLM    │
│   usuário   │   <span style="color:#EF4444;">❌ NUNCA conecta direto</span>     │  (Anthropic /    │
│             │ ──────────────────────────────→│   OpenAI /       │
└─────────────┘                                │   Gemini / Groq) │
       │                                       └──────────────────┘
       │ HTTPS + JWT                                    ▲
       ▼                                                │
┌─────────────────┐    ┌──────────────────┐             │
│   Firebase      │ ──→│ <span style="color:#22C55E;">aiDataGuard.js</span>   │             │
│ Cloud Functions │    │ ANONIMIZA PII:   │             │
│   (callLLM)     │    │  email→&lt;EMAIL_1&gt;│             │
│                 │    │  CPF →&lt;CPF_1&gt;   │             │
│ • valida auth   │    │  CNPJ→&lt;CNPJ_1&gt;  │             │
│ • rate limit    │    │  fone→&lt;PHONE_1&gt; │             │
│ • cost cap      │    └──────────────────┘             │
│ • App Check     │            │                        │
└─────────────────┘            ▼                        │
                       ┌──────────────────┐             │
                       │  Cloud Function  │── <span style="color:#22C55E;">TLS 1.3</span> ─→
                       │     callLLM      │  (anonimo)
                       └──────────────────┘
</pre>
    </div>

    <h4 style="font-size:0.875rem;font-weight:600;color:var(--text-primary);margin:0 0 8px;">Garantias contratuais por provider (DPA ativo)</h4>
    <div style="overflow:auto;margin-bottom:18px;">
      <table style="width:100%;border-collapse:collapse;font-size:0.8125rem;">
        <thead><tr style="background:var(--bg-surface);">
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--text-secondary);">Provider</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--text-secondary);">Sem treino?</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--text-secondary);">Retenção</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--text-secondary);">Localização</th>
        </tr></thead>
        <tbody>
          ${[
            ['Anthropic (Claude)','✓ default API','Zero retenção (modo padrão)','EUA (data residency EU disponível)'],
            ['OpenAI API','✓ default desde mar/2023','30d abuse monitoring (zerável)','EUA'],
            ['Google Gemini API','✓ paid tier (Vertex)','Não treina (paid tier)','EUA / EU (configurável)'],
            ['Groq','✓ no-train policy','Mínima (inferência apenas)','EUA'],
          ].map(([p,t,r,l]) => `
            <tr style="border-bottom:1px solid var(--border-subtle);">
              <td style="padding:9px 12px;color:var(--text-primary);font-weight:500;">${esc(p)}</td>
              <td style="padding:9px 12px;color:#22C55E;font-weight:600;">${esc(t)}</td>
              <td style="padding:9px 12px;color:var(--text-muted);">${esc(r)}</td>
              <td style="padding:9px 12px;color:var(--text-muted);">${esc(l)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div style="background:rgba(34,197,94,.07);border-left:3px solid #22C55E;
      border-radius:0 var(--radius-md) var(--radius-md) 0;padding:12px 16px;margin-bottom:32px;">
      <p style="font-size:0.8125rem;font-weight:600;color:#22C55E;margin-bottom:4px">📞 Resposta padrão pra time de segurança corporativo</p>
      <p style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.6;margin:0;font-style:italic;">
        "Os dados saem da nossa infra <strong>anonimizados</strong> via TLS 1.3.
        O provider executa a inferência sem armazenar pra treino (DPA assinado),
        retenção máxima 30d. Logs internos com TTL 90d, anônimos por default em 11 módulos sensíveis.
        Para clientes que exigem isolamento total, oferecemos <strong>Azure OpenAI no tenant Primetour</strong>
        ou <strong>Llama 3 self-hosted</strong> com zero exposição externa
        (detalhes em <a href="docs.html?doc=data-flow" style="color:var(--brand-gold);">Fluxo de Dados</a>)."
      </p>
    </div>

    <!-- ═══ DOCS DE SEGURANÇA & LGPD (apenas) ═══ -->
    <h3 style="font-size:1rem;font-weight:600;color:var(--text-primary);margin:0 0 6px;">
      📋 Documentos de Segurança & LGPD
    </h3>
    <p style="font-size:0.8125rem;color:var(--text-muted);line-height:1.6;margin-bottom:14px;">
      Cada doc abre em página dedicada (auth obrigatória, formatado, sem ir ao GitHub).
      Para docs técnicos de arquitetura, performance e operação, vá pra aba
      <strong>📚 Documentação técnica</strong>.
    </p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-bottom:24px;">
      ${[
        ['🛡','Política de Segurança',          'security',     'Postura, sprints completos, métricas'],
        ['🎯','Modelo de Ameaças (STRIDE)',     'threat-model', 'Vetores STRIDE + OWASP API Top 10 + action items'],
        ['🚨','Resposta a Incidentes',          'incident',     'Runbook P0–P3, comunicação ANPD &lt;72h, recovery'],
        ['🔑','Controle de Acesso (RBAC)',      'access',       'Matriz roles × permissions, lifecycle, MFA'],
        ['🔐','Fluxo de Dados & PII',           'data-flow',    'Inventário PII, fluxos, base legal LGPD, transferência internacional'],
      ].map(([icon,title,id,desc]) => `
        <a href="docs.html?doc=${id}"
          style="display:flex;gap:12px;align-items:flex-start;padding:14px;
          background:var(--bg-surface);border:1px solid var(--border-subtle);
          border-radius:var(--radius-md);text-decoration:none;transition:all .15s;">
          <div style="font-size:1.5rem;flex-shrink:0;">${icon}</div>
          <div style="min-width:0;flex:1;">
            <div style="font-size:0.875rem;font-weight:600;color:var(--text-primary);margin-bottom:3px;">${esc(title)}</div>
            <div style="font-size:0.7188rem;color:var(--text-muted);line-height:1.5;">${desc}</div>
          </div>
          <div style="font-size:0.875rem;color:var(--text-muted);flex-shrink:0;">→</div>
        </a>
      `).join('')}
    </div>

    <div style="background:rgba(212,168,67,.07);border-left:3px solid var(--brand-gold);
      border-radius:0 var(--radius-md) var(--radius-md) 0;padding:12px 16px;">
      <p style="font-size:0.8125rem;font-weight:600;color:var(--brand-gold);margin-bottom:4px">DPO — Data Protection Officer</p>
      <p style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.6;margin:0">
        Encarregado pelo tratamento de dados pessoais (LGPD Art. 41):
        <strong>Rene Castro</strong> — <code style="font-size:0.75rem;background:var(--bg-elevated);padding:1px 6px;border-radius:4px;">rene.castro@primetour.com.br</code>.
        Solicitações de titulares (acesso, correção, eliminação) respondidas em até 15 dias úteis.
        Reportar vulnerabilidades: <a href="/.well-known/security.txt" target="_blank" style="color:var(--brand-gold);">/.well-known/security.txt</a>.
      </p>
    </div>`,

  /* ═══════════════════════════════════════════════════════
   * 📚 DOCUMENTAÇÃO TÉCNICA — arquitetura, dev, ops, geral
   * Movido de dentro da aba Segurança em 2026-05-04. Antes os docs
   * técnicos viviam dentro de "Segurança & LGPD" o que era confuso —
   * arquitetura/performance/dev workflow não são tópicos de segurança.
   * ═══════════════════════════════════════════════════════ */
  docs: () => `
    <h3 style="font-size:1rem;font-weight:600;color:var(--text-primary);margin:0 0 8px;">📚 Documentação técnica</h3>
    <p style="font-size:0.8125rem;color:var(--text-muted);line-height:1.6;margin-bottom:18px;">
      Referência completa pra time de desenvolvimento. Cada doc abre em página dedicada
      (auth obrigatória, formatado em HTML, conteúdo do GitHub renderizado).
      Para docs de segurança/LGPD, vá pra aba <strong>🛡 Segurança & LGPD</strong>.
    </p>

    <!-- ═══ DESENVOLVIMENTO ═══ -->
    <h4 style="font-size:0.8125rem;font-weight:700;color:var(--text-muted);
      text-transform:uppercase;letter-spacing:0.08em;margin:0 0 10px;">Desenvolvimento</h4>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-bottom:24px;">
      ${[
        ['🚀','Onboarding (dev novo)', 'onboarding',  'Setup em ~15 min: pré-requisitos, clonar, rodar local, deploy, comandos úteis'],
        ['🏗','Arquitetura',          'architecture', 'Decisões, camadas, fluxos, padrões, segurança em 5 camadas, débitos'],
        ['🤝','Convenções e Workflow', 'contributing','Naming, async patterns, error handling, XSS, logging, Conventional Commits'],
        ['⚡','Performance & Custos', 'performance', 'Otimizações, free tier, listeners, estimativas por volume, roadmap'],
      ].map(([icon,title,id,desc]) => `
        <a href="docs.html?doc=${id}"
          style="display:flex;gap:12px;align-items:flex-start;padding:14px;
          background:var(--bg-surface);border:1px solid var(--border-subtle);
          border-radius:var(--radius-md);text-decoration:none;transition:all .15s;">
          <div style="font-size:1.5rem;flex-shrink:0;">${icon}</div>
          <div style="min-width:0;flex:1;">
            <div style="font-size:0.875rem;font-weight:600;color:var(--text-primary);margin-bottom:3px;">${esc(title)}</div>
            <div style="font-size:0.7188rem;color:var(--text-muted);line-height:1.5;">${desc}</div>
          </div>
          <div style="font-size:0.875rem;color:var(--text-muted);flex-shrink:0;">→</div>
        </a>
      `).join('')}
    </div>

    <!-- ═══ OPERAÇÃO ═══ -->
    <h4 style="font-size:0.8125rem;font-weight:700;color:var(--text-muted);
      text-transform:uppercase;letter-spacing:0.08em;margin:0 0 10px;">Operação</h4>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-bottom:24px;">
      ${[
        ['🗂','Modelo de Dados (Firestore)','data-model',  '42+ collections, schema, índices, TTL'],
        ['⚙','Infraestrutura',             'infra',       'Cloudflare, Firestore, GitHub Actions, DR'],
        ['💾','Prompt Caching (IA)',        'prompt-cache','Estratégia de cache de tokens pra LLMs (Anthropic, OpenAI, Gemini)'],
        ['☁','Migração Cloudflare',        'cloudflare',  'Plano de migração GH Pages → Cloudflare Pages'],
      ].map(([icon,title,id,desc]) => `
        <a href="docs.html?doc=${id}"
          style="display:flex;gap:12px;align-items:flex-start;padding:14px;
          background:var(--bg-surface);border:1px solid var(--border-subtle);
          border-radius:var(--radius-md);text-decoration:none;transition:all .15s;">
          <div style="font-size:1.5rem;flex-shrink:0;">${icon}</div>
          <div style="min-width:0;flex:1;">
            <div style="font-size:0.875rem;font-weight:600;color:var(--text-primary);margin-bottom:3px;">${esc(title)}</div>
            <div style="font-size:0.7188rem;color:var(--text-muted);line-height:1.5;">${desc}</div>
          </div>
          <div style="font-size:0.875rem;color:var(--text-muted);flex-shrink:0;">→</div>
        </a>
      `).join('')}
    </div>

    <!-- ═══ GERAL ═══ -->
    <h4 style="font-size:0.8125rem;font-weight:700;color:var(--text-muted);
      text-transform:uppercase;letter-spacing:0.08em;margin:0 0 10px;">Geral</h4>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-bottom:24px;">
      ${[
        ['📄','Fact Sheet (executivo)', 'fact-sheet', 'Resumo 1-página pra apresentar a clientes'],
      ].map(([icon,title,id,desc]) => `
        <a href="docs.html?doc=${id}"
          style="display:flex;gap:12px;align-items:flex-start;padding:14px;
          background:var(--bg-surface);border:1px solid var(--border-subtle);
          border-radius:var(--radius-md);text-decoration:none;transition:all .15s;">
          <div style="font-size:1.5rem;flex-shrink:0;">${icon}</div>
          <div style="min-width:0;flex:1;">
            <div style="font-size:0.875rem;font-weight:600;color:var(--text-primary);margin-bottom:3px;">${esc(title)}</div>
            <div style="font-size:0.7188rem;color:var(--text-muted);line-height:1.5;">${desc}</div>
          </div>
          <div style="font-size:0.875rem;color:var(--text-muted);flex-shrink:0;">→</div>
        </a>
      `).join('')}
    </div>

    <div style="background:rgba(56,189,248,.06);border-left:3px solid #38BDF8;
      border-radius:0 var(--radius-md) var(--radius-md) 0;padding:12px 16px;">
      <p style="font-size:0.8125rem;font-weight:600;color:#38BDF8;margin-bottom:4px">Para devs novos</p>
      <p style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.6;margin:0">
        Quickstart de setup local: <a href="https://github.com/primetour/tarefas/blob/main/README.md"
          target="_blank" style="color:var(--brand-gold);">README.md</a>.
        Convenções de código + workflow de PR: aba <strong>Convenções e Workflow</strong> acima.
      </p>
    </div>`,
};

/* ─── Build the document ───────────────────────────────────── */
function buildDoc(wrap) {
  // Header
  const header = document.createElement('div');
  header.style.cssText = 'margin-bottom:1.5rem;';
  header.innerHTML = `
    <h2 style="font-size:1.125rem;font-weight:600;color:var(--text-primary);margin-bottom:4px;">
      Gestor PRIMETOUR — Mapa de Arquitetura
    </h2>
    <p style="font-size:0.8125rem;color:var(--text-muted);">
      Estrutura organizacional, módulos, stack técnico e segurança.
      Atualizado em ${new Date().toLocaleDateString('pt-BR')}.
    </p>
  `;
  wrap.appendChild(header);

  // Tab bar
  const tabBar = document.createElement('div');
  tabBar.style.cssText = 'display:flex;gap:0;border-bottom:1px solid var(--border-subtle);margin-bottom:1.25rem;overflow-x:auto;';
  TABS.forEach(t => {
    const btn = document.createElement('button');
    btn.dataset.tab = t.id;
    btn.textContent = t.label;
    btn.style.cssText = `padding:10px 18px;font-size:0.875rem;font-weight:500;
      color:var(--text-muted);cursor:pointer;border:none;background:transparent;
      border-bottom:2px solid transparent;transition:all .15s;white-space:nowrap;`;
    tabBar.appendChild(btn);
  });
  wrap.appendChild(tabBar);

  // Content area
  const area = document.createElement('div');
  area.id = 'about-content-area';
  wrap.appendChild(area);

  // Activate a tab
  function activate(id) {
    tabBar.querySelectorAll('button').forEach(b => {
      const isActive = b.dataset.tab === id;
      b.style.color        = isActive ? 'var(--text-primary)' : 'var(--text-muted)';
      b.style.borderBottomColor = isActive ? 'var(--brand-gold)' : 'transparent';
    });
    area.innerHTML = CONTENT[id] ? CONTENT[id]() : '';
  }

  // Bind tab clicks
  tabBar.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => activate(btn.dataset.tab));
  });

  // Show first tab by default
  activate(TABS[0].id);
}
