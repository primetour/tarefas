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
  { id:'pilares',    label:'Pilares'            },
  { id:'hierarquia', label:'Hierarquia org.'    },
  { id:'roles',      label:'Papéis'             },
  { id:'dados',      label:'Modelo de dados'    },
  { id:'modulos',    label:'Módulos'            },
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
      ['#1a3a2a','#7ecfa8','◈', 'Núcleo',        'Equipe dentro do setor','Ex: Design, Comunicação, Dados, Web. Coleção <code>nucleos</code> com campo <code>sector</code>.','20'],
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
      ['Gerente / Coordenador / Analista', 'Vê apenas o setor definido em <code>users.sector</code>. Um campo único, não um array.'],
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
        ['users',           [['id','pk'],['role / roleId',''],['sector','fk'],['nucleo','fk'],['visibleSectors[]',''],['prefs.cardFields[]','']]],
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
            ['Tarefas (lista)',    '✓ Automático pelo setor do usuário',     '✓ Disponível',              'Área, responsável, status, projeto'],
            ['Steps / Kanban',    '◐ Via filtro combinado',                   '✓ Seletor na esteira',      'Área, responsável, projeto'],
            ['Calendário',        '◐ Via filtro combinado',                   '✓ Seletor na esteira/agenda','Área, responsável, projeto'],
            ['Timeline',          '◐ Via filtro combinado',                   '◐ Via filtro combinado',    'Área, projeto'],
            ['Portal (público)',  '✓ Campo obrigatório no formulário',        '✓ Filtrado pelo setor',     'Variação, área solicitante'],
            ['Solicitações',      '◐ Via filtro de status',                   '◐ Via filtro de tipo',      'Status'],
            ['Tipos de tarefa',   '✓ Campo setor no builder',                 '— (é o próprio objeto)',    'Agrupado por categoria'],
            ['Setores e Núcleos', '✓ Gerencia os setores',                   '—',                         '—'],
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
