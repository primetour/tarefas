/**
 * PRIMETOUR — Sobre o Sistema
 * Guia de referência para usuários — acesso restrito a admin/master
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
        <p class="page-subtitle">Guia de referência — hierarquia, papéis e modelo de dados</p>
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
  { id:'pilares',     label:'Pilares'            },
  { id:'hierarquia',  label:'Hierarquia org.'    },
  { id:'roles',       label:'Papéis'             },
  { id:'dados',       label:'Modelo de dados'    },
  { id:'modulos',     label:'Módulos'            },
  { id:'infra',       label:'⚙ Infraestrutura'  },
  { id:'seguranca',   label:'🛡 Segurança'      },
  { id:'privacidade', label:'🔐 Privacidade & LGPD' },
];

/* ─── Content per tab ──────────────────────────────────────── */
const CONTENT = {

  pilares: () => `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:24px;">
      ${[
        ['🏛','Hierarquia organizacional','Setor → Núcleo → Tipo → Variação → Tarefa'],
        ['👥','Papéis e permissões',      'Diretoria → Head → Gerente → Coordenador → Analista'],
        ['🔭','Visibilidade de dados',    'O que cada papel vê, por setor e workspace'],
      ].map(([icon,name,desc]) => `
        <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);
          border-radius:var(--radius-md);padding:16px;">
          <div style="font-size:1.25rem;margin-bottom:8px">${icon}</div>
          <div style="font-size:0.875rem;font-weight:600;color:var(--text-primary);margin-bottom:4px">${name}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);line-height:1.5">${desc}</div>
        </div>
      `).join('')}
    </div>

    <div style="background:rgba(212,168,67,.07);border-left:3px solid var(--brand-gold);
      border-radius:0 var(--radius-md) var(--radius-md) 0;padding:12px 16px;">
      <p style="font-size:0.875rem;font-weight:600;color:var(--brand-gold);margin-bottom:4px">Regra de ouro</p>
      <p style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.6;margin:0">
        <strong>Setor</strong> é o ponto de entrada em todos os módulos. Antes de exibir tipos de tarefa,
        núcleos, categorias ou tarefas, o sistema parte do setor do usuário logado —
        ou de um filtro de setor explícito na interface.
      </p>
    </div>`,

  hierarquia: () => `
    <p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:20px;line-height:1.6">
      O PRIMETOUR organiza toda a operação em uma hierarquia de cinco níveis.
      Cada nível está subordinado ao anterior e herda suas regras de visibilidade.
    </p>
    ${[
      ['#1a2a4a','#a8c4e8','🏢','Setor',        'Quem executa',         'Ex: Marketing, TI, Operadora, Financeiro. Campo <code>sector</code> presente em task_types, nucleos, users e requests.','0'],
      ['#1a3a2a','#7ecfa8','◈', 'Núcleo',        'Equipe dentro do setor','Ex: Design, Comunicação, Dados, Web. Coleção <code>nucleos</code> com campo <code>sector</code>. Um usuário pode pertencer a múltiplos núcleos do seu setor (<code>users.nucleos[]</code>).','20'],
      ['#3a1a2a','#d4a0be','📋','Tipo de tarefa','Define campos e fluxo', 'Ex: Newsletter, Apresentação. Tem <code>sector</code>, <code>nucleos[]</code>, <code>variations[]</code>, <code>steps[]</code>.','40'],
      ['#3a2a1a','#d4c0a0','🔀','Variação',      'Modalidade do entregável','Ex: Revisão de layout, Criação do zero. Array <code>{ id, name, slaDays }</code> dentro do tipo — o SLA vem daqui.','60'],
      ['#2a1a3a','#b0a0d4','✓', 'Tarefa',        'A demanda real',        'Instância criada no sistema com <code>typeId</code>, <code>variationId</code>, <code>sector</code>, <code>dueDate</code> e <code>assignees[]</code>.','80'],
    ].map(([bg,fg,icon,name,sub,desc,ml],i,arr) => `
      <div style="margin-left:${ml}px">
        <div style="display:flex;align-items:stretch;border-radius:var(--radius-md);
          overflow:hidden;border:1px solid var(--border-subtle);">
          <div style="display:flex;align-items:center;justify-content:center;padding:0 14px;
            background:${bg};color:${fg};font-size:0.75rem;font-weight:700;
            min-width:120px;white-space:nowrap;gap:6px;">
            <span>${icon}</span><span>${name}</span>
          </div>
          <div style="flex:1;padding:10px 14px;border-left:1px solid var(--border-subtle);">
            <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary)">${sub}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;line-height:1.5">${desc}</div>
          </div>
        </div>
        ${i < arr.length-1 ? `<div style="text-align:center;font-size:0.875rem;color:var(--text-muted);padding:2px 0;margin-left:20px">↓</div>` : ''}
      </div>
    `).join('')}

    <div style="margin-top:20px;background:var(--bg-surface);border:1px solid var(--border-subtle);
      border-radius:var(--radius-md);padding:14px 16px;">
      <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
        color:var(--text-muted);margin-bottom:10px">Entidade auxiliar — Portal de Solicitações</div>
      <div style="display:flex;align-items:stretch;border-radius:var(--radius-md);overflow:hidden;border:1px solid var(--border-subtle);">
        <div style="display:flex;align-items:center;justify-content:center;padding:0 14px;
          background:#1a1a3a;color:#a0a8d4;font-size:0.75rem;font-weight:700;min-width:120px;">
          ◌ Solicitação
        </div>
        <div style="flex:1;padding:10px 14px;border-left:1px solid var(--border-subtle);">
          <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary)">Entrada pelo portal público</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;line-height:1.5">
            Campos espelham a tarefa: <code>sector</code>, <code>typeId</code>, <code>variationId</code>,
            <code>requestingArea</code>, <code>outOfCalendar</code>. Vira tarefa quando aprovada pelo time.
          </div>
        </div>
      </div>
    </div>`,

  roles: () => `
    <p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:20px;line-height:1.6">
      Cinco papéis definem o que cada usuário pode ver e fazer no sistema.
      A visibilidade de setor é herdada automaticamente do perfil do usuário.
    </p>
    <div style="overflow-x:auto;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:0.75rem;">
        <thead>
          <tr style="background:var(--bg-surface);">
            ${['Papel','Setores visíveis','Módulos admin','Tarefas','Tipos de tarefa','Solicitações'].map(h=>
              `<th style="text-align:left;padding:9px 12px;font-weight:600;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);">${h}</th>`
            ).join('')}
          </tr>
        </thead>
        <tbody>
          ${[
            ['Diretoria',    '#22C55E','Todos',                               '#22C55E','Todos',                     '#22C55E','Ver/editar tudo',              '#22C55E','Criar/editar/excluir',     '#22C55E','Ver/converter/recusar'],
            ['Head',         '#F59E0B','Definido pela Diretoria',              '#F59E0B','Usuários, Setores, Tipos',   '#F59E0B','Ver/editar nos seus setores',  '#22C55E','Criar/editar nos seus setores','#22C55E','Ver/converter/recusar'],
            ['Gerente',      '#F59E0B','Setor do usuário',                    '#F59E0B','Criar tipos',                '#F59E0B','Ver workspace, editar seu setor','#F59E0B','Criar no seu setor',      '#22C55E','Ver/converter/recusar'],
            ['Coordenador',  '#F59E0B','Setor do usuário',                    '#6B7280','Nenhum',                     '#F59E0B','Ver seu setor/núcleo',          '#6B7280','Só visualizar',             '#F59E0B','Ver do seu setor'],
            ['Analista',     '#F59E0B','Setor do usuário',                    '#6B7280','Nenhum',                     '#F59E0B','Criar + ver workspace',          '#6B7280','Só visualizar',             '#6B7280','Não acessa'],
          ].map((r,ri) => `
            <tr style="border-bottom:1px solid var(--border-subtle);">
              <td style="padding:9px 12px;font-weight:600;color:var(--text-primary);">${r[0]}</td>
              ${[[r[1],r[2]],[r[3],r[4]],[r[5],r[6]],[r[7],r[8]],[r[9],r[10]]].map(([c,v])=>
                `<td style="padding:9px 12px;color:${c};">${v}</td>`
              ).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
      color:var(--text-muted);margin-bottom:10px;">Regras de visibilidade por setor</div>
    ${[
      ['Diretoria',                    'Vê todos os setores, sem restrição.'],
      ['Head',                         'Vê apenas os setores definidos em <code>users.visibleSectors[]</code> — configurado pela Diretoria no perfil do usuário.'],
      ['Gerente / Coordenador / Analista', 'Vê apenas o setor definido em <code>users.sector</code> (campo único). Dentro do setor, pertence a um ou mais núcleos via <code>users.nucleos[]</code> — usados para filtrar responsáveis em Metas e membros em Setores & Núcleos.'],
    ].map(([role,desc]) => `
      <div style="display:flex;gap:8px;margin-bottom:8px;font-size:0.8125rem;line-height:1.6;">
        <span style="font-weight:600;color:var(--text-primary);min-width:220px;white-space:nowrap;">${role}</span>
        <span style="color:var(--text-muted);">${desc}</span>
      </div>
    `).join('')}`,

  dados: () => `
    <p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:20px;line-height:1.6">
      Coleções principais no Firestore e seus campos chave.
      Campos marcados com <span style="font-size:0.625rem;padding:1px 6px;border-radius:3px;font-weight:600;background:rgba(34,197,94,.15);color:#86EFAC;">novo</span>
      foram adicionados nas melhorias recentes.
    </p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;">
      ${[
        ['task_types',      [['id','pk'],['name',''],['sector','new'],['nucleos[]','fk'],['categoryId','fk'],['variations[]','new'],['scheduleSlots[]','new'],['steps[]',''],['deliveryStandard','new']]],
        ['tasks',           [['id','pk'],['typeId','fk'],['variationId','new'],['variationName','new'],['sector','new'],['nucleos[]','fk'],['requestingArea',''],['outOfCalendar','new'],['status, priority',''],['assignees[]','fk'],['workspaceId','fk']]],
        ['requests',        [['id','pk'],['typeId','fk'],['variationId','new'],['variationName','new'],['sector','new'],['requestingArea',''],['outOfCalendar','new'],['nucleo',''],['status',''],['rejectionNote','new']]],
        ['nucleos',         [['id','pk'],['name',''],['sector','fk'],['active','']]],
        ['task_categories', [['id','pk'],['name',''],['sector','new'],['color, icon','']]],
        ['users',           [['id','pk'],['role / roleId',''],['sector','fk'],['nucleos[]','new'],['nucleo','fk'],['visibleSectors[]',''],['prefs.cardFields[]','']]],
      ].map(([col,fields]) => `
        <div style="background:var(--bg-surface);border-radius:var(--radius-md);
          padding:12px 14px;border:1px solid var(--border-subtle);">
          <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);
            margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border-subtle);">${col}</div>
          ${fields.map(([f,tag]) => `
            <div style="font-size:0.75rem;color:var(--text-secondary);padding:4px 0;
              border-bottom:1px solid var(--border-subtle);display:flex;
              justify-content:space-between;align-items:center;">
              <code style="font-size:0.6875rem">${f}</code>
              ${tag==='pk'  ? '<span style="font-size:.6rem;padding:1px 5px;border-radius:3px;font-weight:700;background:rgba(56,189,248,.15);color:#7DD3FC">PK</span>'  :
                tag==='fk'  ? '<span style="font-size:.6rem;padding:1px 5px;border-radius:3px;font-weight:700;background:rgba(245,158,11,.15);color:#FCD34D">FK</span>'  :
                tag==='new' ? '<span style="font-size:.6rem;padding:1px 5px;border-radius:3px;font-weight:700;background:rgba(34,197,94,.15);color:#86EFAC">novo</span>' : ''}
            </div>
          `).join('')}
        </div>
      `).join('')}
    </div>`,

  modulos: () => `
    <p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:20px;line-height:1.6">
      Como a hierarquia de setor e tipo de tarefa se aplica em cada módulo do sistema.
    </p>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:0.75rem;">
        <thead>
          <tr style="background:var(--bg-surface);">
            ${['Módulo','Filtro de setor','Filtro de tipo','Filtros adicionais','Visibilidade por papel'].map(h=>
              `<th style="text-align:left;padding:9px 12px;font-weight:600;color:var(--text-muted);border-bottom:1px solid var(--border-subtle);white-space:nowrap;">${h}</th>`
            ).join('')}
          </tr>
        </thead>
        <tbody>
          ${[
            ['Tarefas (lista)',       '✓ Automático pelo setor do usuário',  '✓ Disponível',              'Área, responsável, status, projeto, meta'],
            ['Steps / Kanban',        '◐ Via filtro combinado',              '✓ Seletor na esteira',      'Área, responsável, projeto'],
            ['Calendário',            '◐ Via filtro combinado',              '✓ Seletor na esteira',      'Área, responsável, projeto'],
            ['Timeline',              '◐ Via filtro combinado',              '◐ Via filtro combinado',    'Área, projeto'],
            ['Metas',                 '✓ Por setor/núcleo',                  '—',                         'Busca, status, exportação XLS/PDF'],
            ['Portal de Dicas',       '✓ Campo obrigatório',                 '✓ Filtrado pelo setor',     'Variação, área solicitante, materiais por formato'],
            ['Banco de Imagens',      '— (global)',                           '—',                         'Continente, país, cidade, tipo, tags, placeName'],
            ['Landing Pages',         '— (global)',                           '—',                         'Layout, seções configuráveis, link público'],
            ['CMS / Site',            '— (global)',                           '—',                         'Páginas, blog, SEO — via Cloudflare Workers'],
            ['Editor de Artes',       '— (global)',                           '—',                         'Templates por BU/categoria, canvas Fabric.js, export PNG/JPG'],
            ['Monitoramento de Notícias','— (global)',                        '—',                         'Categoria, subcategoria, validade, exportação XLS/PDF, ✈ Tarefa'],
            ['Newsletters (dashboard)','— (global)',                          '—',                         'Período (incluindo personalizado), por BU'],
            ['Produtividade (dashboard)','✓ Pelo setor do usuário',           '—',                         'Período (incluindo personalizado)'],
            ['Solicitações',          '◐ Via filtro de status',              '◐ Via filtro de tipo',      'Status'],
            ['Tipos de tarefa',       '✓ Campo setor no builder',            '— (é o próprio objeto)',    'Agrupado por categoria'],
            ['Setores e Núcleos',     '✓ Gerencia os setores',              '—',                         '—'],
            ['Roles e Acesso',        '— (global)',                           '—',                         'Permissões editáveis por role, excluir usuário'],
            ['Log de Auditoria',      '— (global)',                           '—',                         'Todos os módulos, detalhes de exclusão de tarefa'],
          ].map(([mod,...rest]) => `
            <tr style="border-bottom:1px solid var(--border-subtle);">
              <td style="padding:9px 12px;font-weight:600;color:var(--text-primary);white-space:nowrap;">${mod}</td>
              ${rest.map(v => `<td style="padding:9px 12px;color:var(--text-secondary);line-height:1.4;">${v}</td>`).join('')}
              <td style="padding:9px 12px;color:var(--text-muted);">Baseada no setor do usuário</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div style="margin-top:16px;font-size:0.75rem;color:var(--text-muted);display:flex;gap:16px;">
      <span>✓ Implementado</span>
      <span>◐ Parcialmente implementado</span>
    </div>`,

  /* ═══════════════════════════════════════════════════════
   * INFRAESTRUTURA
   * ═══════════════════════════════════════════════════════ */
  infra: () => `
    <div style="margin-bottom:20px;">
      <h3 style="font-size:1rem;font-weight:600;color:var(--text-primary);margin-bottom:6px;">Stack Tecnológico</h3>
      <p style="font-size:0.8125rem;color:var(--text-muted);line-height:1.6;margin-bottom:16px;">
        Plataforma 100% serverless construída sobre Google Cloud + Firebase.
        Sem servidores próprios pra manter, sem capex de infraestrutura.
        Escala automaticamente conforme demanda.
      </p>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-bottom:24px;">
      ${[
        ['🌐','Frontend','SPA estática (HTML/CSS/JS vanilla, ES modules) — sem framework pesado, carregamento &lt; 1s. Hospedada em GitHub Pages com CDN global.'],
        ['🔥','Database','Cloud Firestore (NoSQL document) — multi-region nam5 (US). Cache persistente IndexedDB no browser reduz reads em 80%.'],
        ['⚡','Backend','Firebase Cloud Functions Gen 2 (Node.js 20) — 10 funções serverless pra proxy LLM, audit, backup, SIEM. Auto-scale 0→100 instâncias.'],
        ['🔑','Auth','Firebase Auth + Microsoft SSO (Azure AD tenant primetour.com.br). Senhas nunca chegam ao nosso código — autenticação delegada à Microsoft.'],
        ['📦','Storage','Cloudflare R2 (S3-compatible) pra imagens públicas. Logos servidos via CDN edge global da Cloudflare.'],
        ['📁','SharePoint','Acesso server-side via Microsoft Graph API com client_credentials flow. Docs corporativos consumidos pelo IA Hub sem expor credenciais.'],
        ['🤖','LLMs','Proxy unificado: Anthropic Claude, OpenAI GPT, Google Gemini, Groq Llama. Keys 100% server-side via Secret Manager.'],
        ['💾','Backup','Snapshot diário Firestore→GCS NEARLINE (03h BRT). Lifecycle: NEARLINE→COLDLINE@30d→ARCHIVE@90d→DELETE@365d.'],
      ].map(([icon,name,desc]) => `
        <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);
          border-radius:var(--radius-md);padding:16px;">
          <div style="font-size:1.25rem;margin-bottom:8px">${icon}</div>
          <div style="font-size:0.875rem;font-weight:600;color:var(--text-primary);margin-bottom:6px">${name}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);line-height:1.55">${desc}</div>
        </div>
      `).join('')}
    </div>

    <h3 style="font-size:1rem;font-weight:600;color:var(--text-primary);margin-bottom:8px;">Cloud Functions deployadas</h3>
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
            ['callLLM','onCall','—','Proxy unificado pra todos LLMs com rate limit + cost cap'],
            ['getR2UploadUrl','onCall','—','Upload assinado R2 com path whitelist'],
            ['getSharePointToken','onCall','—','Token Microsoft Graph (client_credentials)'],
            ['getGitHubFile','onCall','—','Read GitHub repos com PAT server-side'],
            ['logUserLogin','onCall','—','Audit IP+UserAgent de cada login'],
            ['eraseUserDataServer','onCall','—','LGPD Art. 18 VI — eliminação de dados'],
            ['dailyBackup','schedule','03h BRT','Snapshot Firestore → GCS'],
            ['dailySecurityDigest','schedule','09h BRT','SIEM diário com risk score'],
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

    <h3 style="font-size:1rem;font-weight:600;color:var(--text-primary);margin-bottom:8px;">Disaster Recovery</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-bottom:16px;">
      ${[
        ['PITR Firestore','Recovery granular até 7 dias atrás (granularidade minuto)'],
        ['Daily backup','Snapshot completo Firestore em GCS, retido 365 dias'],
        ['Delete protection','Impede DROP acidental do banco (gcloud rejeita)'],
        ['Multi-region','Banco em nam5 (replicação automática 2+ regiões US)'],
        ['RTO','Recovery Time Objective: &lt; 4h (restore script em INCIDENT-RESPONSE.md)'],
        ['RPO','Recovery Point Objective: &lt; 1 min (PITR ativo)'],
      ].map(([k,v]) => `
        <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:12px;">
          <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);margin-bottom:4px;">${esc(k)}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);line-height:1.5;">${v}</div>
        </div>
      `).join('')}
    </div>

    <div style="background:rgba(59,130,246,.07);border-left:3px solid #3B82F6;
      border-radius:0 var(--radius-md) var(--radius-md) 0;padding:12px 16px;">
      <p style="font-size:0.8125rem;font-weight:600;color:#3B82F6;margin-bottom:4px">Custo de infraestrutura</p>
      <p style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.6;margin:0">
        Operação atual cabe em <strong>Free Tier</strong> de Firebase + Google Cloud.
        Custo estimado em escala 100 usuários: <strong>R$ 50–150/mês</strong> (Firestore reads, Cloud Functions invocations,
        GCS storage backups). Sem licenças de software, sem servidores dedicados.
      </p>
    </div>`,

  /* ═══════════════════════════════════════════════════════
   * SEGURANÇA
   * ═══════════════════════════════════════════════════════ */
  seguranca: () => `
    <div style="margin-bottom:20px;">
      <h3 style="font-size:1rem;font-weight:600;color:var(--text-primary);margin-bottom:6px;">Postura de Segurança</h3>
      <p style="font-size:0.8125rem;color:var(--text-muted);line-height:1.6;margin-bottom:16px;">
        Defesa em profundidade (defense-in-depth) — múltiplas camadas independentes,
        cada uma assumindo que as outras podem falhar. Segue os princípios OWASP API Security Top 10
        e mapeada para SOC 2 Type II + ISO 27001.
      </p>
    </div>

    <h3 style="font-size:0.9375rem;font-weight:600;color:var(--text-primary);margin-bottom:8px;">Camadas de defesa</h3>
    <div style="display:grid;gap:8px;margin-bottom:24px;">
      ${[
        ['1. Edge','TLS 1.3 obrigatório, HSTS preload-ready, headers de segurança via response (X-Frame-Options, COOP/CORP, X-Content-Type-Options)'],
        ['2. Application','CSP estrita (script-src allowlist), Permissions-Policy desabilita APIs sensíveis (camera/USB/payment)'],
        ['3. Bot Detection','Firebase App Check com reCAPTCHA Enterprise — bloqueia scripts/curl/Postman, validação contínua de token JWT'],
        ['4. Authentication','Microsoft SSO obrigatório (tenant primetour.com.br), MFA exigido via Azure Conditional Access'],
        ['5. Authorization','RBAC em 6 níveis + visibility scopes (own/sector/squad/all), checagem dupla client+server'],
        ['6. Database','Firestore Security Rules com testes regressão automatizados (12 vetores de attack cobertos)'],
        ['7. Backend','Cloud Functions com per-IP rate limit (DDoS) + per-user rate limit + cost cap diário por agente IA'],
        ['8. Secrets','Google Secret Manager — keys nunca ficam no código, rotação trimestral monitorada'],
        ['9. Monitoring','SIEM lite com risk score diário, alertas Slack pra eventos críticos'],
        ['10. Audit','audit_logs append-only com TTL 180 dias, captura uid+ip+userAgent server-side'],
      ].map(([layer,desc]) => `
        <div style="display:flex;gap:12px;align-items:flex-start;padding:10px 14px;
          background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-md);">
          <div style="font-size:0.8125rem;font-weight:600;color:var(--brand-gold);min-width:80px;">${esc(layer.split('. ')[0])}.</div>
          <div style="flex:1;">
            <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);margin-bottom:2px;">${esc(layer.split('. ')[1])}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);line-height:1.5;">${desc}</div>
          </div>
        </div>
      `).join('')}
    </div>

    <h3 style="font-size:0.9375rem;font-weight:600;color:var(--text-primary);margin-bottom:8px;">Mitigações por vetor de ataque</h3>
    <div style="overflow:auto;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:0.8125rem;">
        <thead><tr style="background:var(--bg-surface);">
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--text-secondary);">Vetor (STRIDE)</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--text-secondary);">Mitigação</th>
          <th style="padding:8px 12px;text-align:center;font-weight:600;color:var(--text-secondary);">Status</th>
        </tr></thead>
        <tbody>
          ${[
            ['<strong>S</strong>poofing — impersonação','MS SSO + tenant-restrict + App Check + MFA','✓'],
            ['<strong>T</strong>ampering — modificação','Firestore Rules ownership check + audit trails','✓'],
            ['<strong>R</strong>epudiation — negação','audit_logs server-side com IP/UA imutáveis','✓'],
            ['<strong>I</strong>nformation Disclosure','Anonimização PII pra LLM, secrets server-only','✓'],
            ['<strong>D</strong>oS — denial of service','Per-IP rate limit + cost cap + maxInstances:50','✓'],
            ['<strong>E</strong>scalation of Privilege','Rules denial em users.role write, dual-check','✓'],
            ['XSS','CSP estrita + escape em todo HTML user-generated','✓'],
            ['CSRF','Firebase Auth tokens, sem cookies de sessão','✓'],
            ['Clickjacking','X-Frame-Options SAMEORIGIN','✓'],
            ['Brute force','Firebase Auth rate limit nativo + MFA','✓'],
            ['Bill bomb (LLM abuse)','Daily cost cap por agente + per-user limit','✓'],
            ['Account takeover','MFA + new-IP detection automática','✓'],
            ['Data exfiltration','PII anonimizado antes de sair, SIEM monitora bulk reads','✓'],
            ['Key leak','Secret Manager + audit trimestral + rotação','✓'],
            ['Supply chain','Dependências fixadas, GitHub Dependabot ativo','◐'],
          ].map(([v,m,s]) => `
            <tr style="border-bottom:1px solid var(--border-subtle);">
              <td style="padding:9px 12px;color:var(--text-secondary);">${v}</td>
              <td style="padding:9px 12px;color:var(--text-muted);">${esc(m)}</td>
              <td style="padding:9px 12px;text-align:center;color:${s==='✓'?'#22C55E':'#F59E0B'};font-weight:600;">${s}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <h3 style="font-size:0.9375rem;font-weight:600;color:var(--text-primary);margin-bottom:8px;">Compliance Mapping</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-bottom:16px;">
      ${[
        ['SOC 2 CC6.1','Logical Access — MFA + RBAC + App Check'],
        ['SOC 2 CC6.3','Authorization — Firestore Rules + visibility scopes'],
        ['SOC 2 CC7.2','System Monitoring — SIEM digest + audit logs'],
        ['SOC 2 CC7.4','Incident Response — runbook P0–P3 documentado'],
        ['SOC 2 CC8.1','Change Management — git history + commits assinados'],
        ['ISO 27001 A.5.17','Authentication info — secrets rotation 90d'],
        ['ISO 27001 A.5.24','Incident Management — INCIDENT-RESPONSE.md'],
        ['ISO 27001 A.5.30','Backup — daily automated GCS NEARLINE'],
        ['ISO 27001 A.8.16','Monitoring — dailySecurityDigest'],
        ['OWASP API1','Broken Object Level Authorization — uid checks'],
        ['OWASP API4','Resource Consumption — rate + cost caps'],
        ['OWASP API8','Security Misconfiguration — CSP + headers + rules'],
      ].map(([k,v]) => `
        <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:10px;">
          <div style="font-size:0.75rem;font-weight:600;color:var(--brand-gold);margin-bottom:2px;font-family:monospace;">${esc(k)}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);line-height:1.4;">${esc(v)}</div>
        </div>
      `).join('')}
    </div>

    <div style="background:rgba(34,197,94,.07);border-left:3px solid #22C55E;
      border-radius:0 var(--radius-md) var(--radius-md) 0;padding:12px 16px;">
      <p style="font-size:0.8125rem;font-weight:600;color:#22C55E;margin-bottom:4px">Documentação técnica completa</p>
      <p style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.6;margin:0">
        Modelo de ameaças completo (STRIDE), runbook de incidentes (P0–P3) e matriz de controle de acesso
        estão versionados no repositório: <code style="font-size:0.75rem;background:var(--bg-elevated);padding:1px 6px;border-radius:4px;">SECURITY.md</code>,
        <code style="font-size:0.75rem;background:var(--bg-elevated);padding:1px 6px;border-radius:4px;">THREAT-MODEL.md</code>,
        <code style="font-size:0.75rem;background:var(--bg-elevated);padding:1px 6px;border-radius:4px;">INCIDENT-RESPONSE.md</code>,
        <code style="font-size:0.75rem;background:var(--bg-elevated);padding:1px 6px;border-radius:4px;">ACCESS-CONTROL.md</code>.
      </p>
    </div>`,

  /* ═══════════════════════════════════════════════════════
   * PRIVACIDADE & LGPD
   * ═══════════════════════════════════════════════════════ */
  privacidade: () => `
    <div style="margin-bottom:20px;">
      <h3 style="font-size:1rem;font-weight:600;color:var(--text-primary);margin-bottom:6px;">Privacidade & LGPD</h3>
      <p style="font-size:0.8125rem;color:var(--text-muted);line-height:1.6;margin-bottom:16px;">
        PRIMETOUR é construído seguindo <strong>privacy by design</strong> — privacidade desde o desenho,
        não como afterthought. Conformidade total com a Lei Geral de Proteção de Dados (Lei 13.709/2018)
        e GDPR (regulação europeia equivalente).
      </p>
    </div>

    <h3 style="font-size:0.9375rem;font-weight:600;color:var(--text-primary);margin-bottom:8px;">Direitos dos titulares (LGPD Art. 18)</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-bottom:24px;">
      ${[
        ['Art. 18 I','Confirmação','Usuário pode confirmar a existência de tratamento dos seus dados','✓'],
        ['Art. 18 II','Acesso','Visualização completa do que é coletado em "Privacidade e IA"','✓'],
        ['Art. 18 III','Correção','Edição direta de perfil, foto, dados de contato','✓'],
        ['Art. 18 IV','Anonimização / Bloqueio','Endpoint <code>eraseUserData</code> anonimiza preservando integridade','✓'],
        ['Art. 18 V','Portabilidade','Endpoint <code>exportUserData</code> exporta JSON de todos os dados','✓'],
        ['Art. 18 VI','Eliminação','Hard delete de dados não obrigatórios + anonimização do resto','✓'],
        ['Art. 18 VII','Compartilhamento','Lista de operadores: Google/Microsoft/Anthropic/OpenAI/Cloudflare','✓'],
        ['Art. 18 VIII','Revogação consent','Toggle on/off em "Privacidade e IA"','✓'],
        ['Art. 18 §3','Resposta em 15 dias','SLA documentado em INCIDENT-RESPONSE.md','✓'],
      ].map(([art,nome,desc,s]) => `
        <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <div style="font-size:0.75rem;font-weight:600;color:var(--brand-gold);font-family:monospace;">${esc(art)} — ${esc(nome)}</div>
            <span style="font-size:0.75rem;color:#22C55E;font-weight:600;">${s}</span>
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted);line-height:1.5;">${desc}</div>
        </div>
      `).join('')}
    </div>

    <h3 style="font-size:0.9375rem;font-weight:600;color:var(--text-primary);margin-bottom:8px;">Categorias de dados pessoais tratados</h3>
    <div style="overflow:auto;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:0.8125rem;">
        <thead><tr style="background:var(--bg-surface);">
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--text-secondary);">Dado</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--text-secondary);">Finalidade</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--text-secondary);">Base Legal LGPD</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--text-secondary);">Retenção</th>
        </tr></thead>
        <tbody>
          ${[
            ['Email + nome','Identificação no sistema','Art. 7 V — Execução de contrato','Indefinida (até desligamento + 5y CLT)'],
            ['Foto de perfil','Identificação visual','Art. 7 IX — Legítimo interesse','Indefinida'],
            ['IP + User Agent','Auditoria de segurança','Art. 7 II — Cumprimento obrigação legal (LGPD Art. 37)','180 dias (TTL automático)'],
            ['Histórico de chat IA','Continuidade conversacional','Art. 7 I — Consentimento (opt-in)','90 dias (TTL) ou opt-out'],
            ['Banco de horas','Registro CLT','Art. 7 II — Obrigação legal (CLT Art. 74)','5 anos (obrigatório por lei)'],
            ['Avaliações/feedbacks','Gestão de pessoas','Art. 7 V — Execução de contrato','2 anos'],
            ['Tarefas + comentários','Operação corporativa','Art. 7 V — Execução de contrato','Indefinida (preservado mesmo após eraseUser)'],
            ['Dados de cliente em roteiros','Atendimento ao cliente','Art. 7 V — Execução de contrato (cliente do operador)','5 anos'],
          ].map(([d,f,b,r]) => `
            <tr style="border-bottom:1px solid var(--border-subtle);">
              <td style="padding:9px 12px;color:var(--text-primary);font-weight:500;">${esc(d)}</td>
              <td style="padding:9px 12px;color:var(--text-secondary);">${esc(f)}</td>
              <td style="padding:9px 12px;color:var(--text-muted);font-size:0.75rem;">${esc(b)}</td>
              <td style="padding:9px 12px;color:var(--text-muted);">${esc(r)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <h3 style="font-size:0.9375rem;font-weight:600;color:var(--text-primary);margin-bottom:8px;">Anonimização automática para IA</h3>
    <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:14px;margin-bottom:24px;">
      <p style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.6;margin-bottom:10px;">
        Antes de qualquer dado ser enviado para um LLM (Anthropic/OpenAI/Gemini/Groq), o módulo
        <code style="font-size:0.75rem;background:var(--bg-elevated);padding:1px 6px;border-radius:4px;">aiDataGuard.js</code>
        anonimiza automaticamente:
      </p>
      <ul style="margin:0;padding-left:20px;font-size:0.75rem;color:var(--text-muted);line-height:1.7;">
        <li>Emails — <code>joao@empresa.com</code> → <code>&lt;EMAIL_1&gt;</code></li>
        <li>CPF — <code>123.456.789-00</code> → <code>&lt;CPF_1&gt;</code></li>
        <li>CNPJ — <code>12.345.678/0001-90</code> → <code>&lt;CNPJ_1&gt;</code></li>
        <li>Telefone — <code>(11) 9 8765-4321</code> → <code>&lt;PHONE_1&gt;</code></li>
        <li>11 módulos sensíveis (CSAT, feedback, ponto, etc.) com anonimização default ON</li>
      </ul>
      <p style="font-size:0.75rem;color:var(--text-muted);line-height:1.6;margin-top:10px;font-style:italic;">
        Usuário pode revisar/desabilitar em <strong>Configurações → Privacidade e IA</strong>.
      </p>
    </div>

    <h3 style="font-size:0.9375rem;font-weight:600;color:var(--text-primary);margin-bottom:8px;">Operadores e transferência internacional (LGPD Art. 33)</h3>
    <div style="overflow:auto;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:0.8125rem;">
        <thead><tr style="background:var(--bg-surface);">
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--text-secondary);">Operador</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--text-secondary);">País</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--text-secondary);">Finalidade</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:var(--text-secondary);">Salvaguarda</th>
        </tr></thead>
        <tbody>
          ${[
            ['Google Cloud / Firebase','EUA','Hospedagem app, banco, autenticação','DPA assinado + cláusulas-padrão'],
            ['Microsoft 365 / Azure','Multi','SSO + SharePoint','DPA tenant primetour.com.br'],
            ['Anthropic (Claude)','EUA','LLM (dados anonimizados)','DPA + opt-out de treinamento'],
            ['OpenAI (GPT)','EUA','LLM (dados anonimizados)','DPA + zero-retention via API'],
            ['Google AI (Gemini)','EUA','LLM (dados anonimizados)','GCP DPA herdado'],
            ['Groq','EUA','LLM (dados anonimizados)','DPA + no-train policy'],
            ['Cloudflare R2','Multi','CDN imagens públicas','DPA + EU data residency opt'],
          ].map(([op,pais,fim,salv]) => `
            <tr style="border-bottom:1px solid var(--border-subtle);">
              <td style="padding:9px 12px;color:var(--text-primary);font-weight:500;">${esc(op)}</td>
              <td style="padding:9px 12px;color:var(--text-muted);">${esc(pais)}</td>
              <td style="padding:9px 12px;color:var(--text-secondary);">${esc(fim)}</td>
              <td style="padding:9px 12px;color:var(--text-muted);font-size:0.75rem;">${esc(salv)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <h3 style="font-size:0.9375rem;font-weight:600;color:var(--text-primary);margin-bottom:8px;">Resposta a incidentes de privacidade (LGPD Art. 48)</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:16px;">
      ${[
        ['Detecção','SIEM diário + audit logs com severity classification'],
        ['Contenção','Disable user em Firebase Auth + revoke refresh tokens'],
        ['Avaliação','Snapshot Firestore (PITR) + análise audit_logs últimos 90d'],
        ['Comunicação','ANPD em até 72h via portal gov.br/anpd + titulares afetados'],
        ['Documentação','Pós-mortem versionado em docs/postmortems/'],
        ['Lições aprendidas','Atualização do THREAT-MODEL.md + tabletop exercise semestral'],
      ].map(([k,v]) => `
        <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:10px;">
          <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);margin-bottom:3px;">${esc(k)}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);line-height:1.5;">${esc(v)}</div>
        </div>
      `).join('')}
    </div>

    <div style="background:rgba(212,168,67,.07);border-left:3px solid var(--brand-gold);
      border-radius:0 var(--radius-md) var(--radius-md) 0;padding:12px 16px;">
      <p style="font-size:0.8125rem;font-weight:600;color:var(--brand-gold);margin-bottom:4px">DPO — Data Protection Officer</p>
      <p style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.6;margin:0">
        Encarregado pelo tratamento de dados pessoais (LGPD Art. 41):
        <strong>Rene Castro</strong> — <code style="font-size:0.75rem;background:var(--bg-elevated);padding:1px 6px;border-radius:4px;">rene.castro@primetour.com.br</code>.
        Solicitações de titulares (acesso, correção, eliminação) respondidas em até 15 dias úteis.
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
      PRIMETOUR — Mapa de Arquitetura
    </h2>
    <p style="font-size:0.8125rem;color:var(--text-muted);">
      Guia de referência interno — hierarquia organizacional, papéis e modelo de dados.
      Gerado em ${new Date().toLocaleDateString('pt-BR')}.
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
    btn.style.cssText = `padding:8px 16px;font-size:0.8125rem;font-weight:500;
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
