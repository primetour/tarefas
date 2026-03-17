/**
 * PRIMETOUR — Sobre o Sistema
 * Documento de arquitetura — acesso restrito a admin/master
 */

import { store } from '../store.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

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
        <p class="page-subtitle">Mapa de arquitetura, hierarquia de dados e visibilidade por papel</p>
      </div>
      <div class="page-header-actions">
        <span style="font-size:0.75rem;color:var(--text-muted);padding:4px 10px;
          border-radius:var(--radius-full);border:1px solid var(--border-subtle);">
          🔒 Acesso restrito — Diretoria e Head
        </span>
      </div>
    </div>

    <div id="about-doc" style="border:1px solid var(--border-subtle);border-radius:var(--radius-lg);
      overflow:hidden;background:var(--bg-card);">
    </div>
  `;

  // Render the architecture document inside the page
  const doc = document.getElementById('about-doc');
  if (doc) renderArchitectureDoc(doc);
}

/* ─── Architecture Document ──────────────────────────────── */
function renderArchitectureDoc(root) {
  root.innerHTML = `
  <style>
    .ab-doc *{box-sizing:border-box}
    .ab-doc{padding:1.5rem 1.25rem;font-family:var(--font-ui)}
    .ab-doc h1{font-size:1.125rem;font-weight:600;color:var(--text-primary);margin-bottom:4px}
    .ab-doc .sub{font-size:0.8125rem;color:var(--text-muted);margin-bottom:1.5rem}
    .ab-doc .sec-title{font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
      color:var(--text-muted);margin-bottom:.75rem;padding-bottom:.4rem;
      border-bottom:1px solid var(--border-subtle)}
    .ab-doc .section{margin-bottom:2rem}
    .ab-tabs{display:flex;gap:0;border-bottom:1px solid var(--border-subtle);margin-bottom:1.25rem;
      overflow-x:auto}
    .ab-tab{padding:8px 16px;font-size:0.8125rem;font-weight:500;color:var(--text-muted);
      cursor:pointer;border-bottom:2px solid transparent;transition:all .15s;white-space:nowrap}
    .ab-tab:hover{color:var(--text-primary)}
    .ab-tab.active{color:var(--text-primary);border-bottom-color:var(--brand-gold)}
    .ab-pane{display:none}.ab-pane.active{display:block}
    .ab-tier{display:flex;align-items:stretch;border-radius:var(--radius-md);overflow:hidden;
      border:1px solid var(--border-subtle);margin-bottom:3px}
    .ab-tier-role{display:flex;align-items:center;justify-content:center;padding:0 14px;
      font-size:0.75rem;font-weight:600;min-width:130px;white-space:nowrap}
    .ab-tier-body{flex:1;padding:10px 14px;border-left:1px solid var(--border-subtle)}
    .ab-tier-name{font-size:0.8125rem;font-weight:600;color:var(--text-primary)}
    .ab-tier-desc{font-size:0.75rem;color:var(--text-muted);margin-top:2px;line-height:1.5}
    .ab-arrow{text-align:center;font-size:0.875rem;color:var(--text-muted);padding:1px 0;line-height:1}
    .ab-matrix{width:100%;border-collapse:collapse;font-size:0.75rem}
    .ab-matrix th{text-align:left;padding:8px 10px;font-weight:600;color:var(--text-muted);
      background:var(--bg-surface);border-bottom:1px solid var(--border-subtle)}
    .ab-matrix td{padding:8px 10px;border-bottom:1px solid var(--border-subtle);
      color:var(--text-primary);vertical-align:top}
    .ab-matrix tr:last-child td{border:none}
    .c-ok{color:#22C55E;font-weight:600}
    .c-partial{color:#F59E0B;font-weight:600}
    .c-no{color:var(--text-muted);opacity:.6}
    .ab-flag{display:flex;align-items:flex-start;gap:8px;font-size:0.8125rem;padding:9px 12px;
      border-radius:var(--radius-md);margin-bottom:6px;line-height:1.5}
    .ab-flag code{font-size:0.6875rem;background:rgba(255,255,255,.08);padding:1px 5px;
      border-radius:3px;font-family:monospace}
    .flag-err{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);color:#FCA5A5}
    .flag-warn{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);color:#FCD34D}
    .flag-ok{background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);color:#86EFAC}
    .ab-data-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}
    .ab-data-card{background:var(--bg-surface);border-radius:var(--radius-md);padding:12px 14px;
      border:1px solid var(--border-subtle)}
    .ab-data-title{font-size:0.8125rem;font-weight:600;color:var(--text-primary);margin-bottom:8px}
    .ab-data-field{font-size:0.75rem;color:var(--text-secondary);padding:4px 0;
      border-bottom:1px solid var(--border-subtle);display:flex;justify-content:space-between;
      align-items:center}
    .ab-data-field:last-child{border:none}
    .tag{font-size:0.625rem;padding:1px 6px;border-radius:3px;font-weight:600}
    .tag-pk{background:rgba(56,189,248,.15);color:#7DD3FC}
    .tag-fk{background:rgba(245,158,11,.15);color:#FCD34D}
    .tag-new{background:rgba(34,197,94,.15);color:#86EFAC}
    .ab-pillar-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;
      margin-bottom:1.25rem}
    .ab-pillar{background:var(--bg-surface);border:1px solid var(--border-subtle);
      border-radius:var(--radius-md);padding:14px;cursor:pointer;transition:all .15s}
    .ab-pillar:hover{border-color:rgba(212,168,67,.4)}
    .ab-pillar.active{border-color:var(--brand-gold);background:rgba(212,168,67,.06)}
    .ab-detail{display:none}.ab-detail.active{display:block}
    .step-num{font-size:0.75rem;font-weight:700;color:var(--brand-gold);
      margin-right:6px;min-width:16px}
  </style>

  <div class="ab-doc">
    <h1>PRIMETOUR — Mapa de Arquitetura</h1>
    <p class="sub">
      Documento interno de referência. Versão gerada em ${new Date().toLocaleDateString('pt-BR')}.
      Acesso restrito: Diretoria e Head.
    </p>

    <div class="ab-tabs">
      <div class="ab-tab active" data-pane="pilares">Pilares</div>
      <div class="ab-tab" data-pane="hierarquia">Hierarquia org.</div>
      <div class="ab-tab" data-pane="roles">Papéis e visibilidade</div>
      <div class="ab-tab" data-pane="dados">Modelo de dados</div>
      <div class="ab-tab" data-pane="modulos">Módulos × hierarquia</div>
      <div class="ab-tab" data-pane="varredura">Varredura crítica</div>
    </div>

    <!-- PILARES -->
    <div class="ab-pane active" id="ab-pilares">
      <div class="section">
        <div class="sec-title">Os três pilares conceituais</div>
        <div class="ab-pillar-grid">
          <div class="ab-pillar active" data-pillar="p1">
            <div style="font-size:1.125rem;margin-bottom:6px">🏛</div>
            <div style="font-size:0.875rem;font-weight:600;color:var(--text-primary)">Hierarquia organizacional</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:3px;line-height:1.5">Setor → Núcleo → Tipo → Variação → Tarefa</div>
          </div>
          <div class="ab-pillar" data-pillar="p2">
            <div style="font-size:1.125rem;margin-bottom:6px">👥</div>
            <div style="font-size:0.875rem;font-weight:600;color:var(--text-primary)">Papéis e permissões</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:3px;line-height:1.5">Diretoria → Head → Gerente → Coordenador → Analista</div>
          </div>
          <div class="ab-pillar" data-pillar="p3">
            <div style="font-size:1.125rem;margin-bottom:6px">🔭</div>
            <div style="font-size:0.875rem;font-weight:600;color:var(--text-primary)">Visibilidade de dados</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:3px;line-height:1.5">O que cada papel vê, por setor e workspace</div>
          </div>
        </div>

        <div class="ab-detail active" id="ab-p1">
          <div class="sec-title">Pilar 1 — Hierarquia organizacional</div>
          <div style="background:var(--bg-surface);border-radius:var(--radius-md);padding:16px;border:1px solid var(--border-subtle)">
            ${[
              ['🏢','Setor','Quem executa (Marketing, TI, Operadora…)','Campo sector em task_types, nucleos, users, requests'],
              ['◈','Núcleo','Equipe dentro do setor (Design, Dados…)','Coleção nucleos/{id} com campo sector'],
              ['📋','Tipo de tarefa','Define campos, esteira e variações','Tem sector + nucleos[] + categoryId + variations[]'],
              ['🔀','Variação do material','Dentro do tipo — cada uma com seu SLA','Array { id, name, slaDays } dentro do tipo'],
              ['✓','Tarefa','A demanda real criada no sistema','Campos: typeId, variationId, sector, nucleos, dueDate…'],
            ].map((r,i,arr) => `
              <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;
                background:var(--bg-card);border-radius:var(--radius-sm);
                border:1px solid var(--border-subtle);margin-left:${i*20}px">
                <span style="font-size:1rem">${r[0]}</span>
                <div>
                  <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary)">${r[1]}</div>
                  <div style="font-size:0.75rem;color:var(--text-muted);line-height:1.4">${r[2]}<br><span style="opacity:.7">${r[3]}</span></div>
                </div>
              </div>
              ${i < arr.length-1 ? `<div class="ab-arrow" style="margin-left:${(i+1)*20}px">↓</div>` : ''}
            `).join('')}
          </div>
          <p style="font-size:0.8125rem;color:var(--text-muted);margin-top:10px;line-height:1.6;
            padding:10px 14px;background:rgba(212,168,67,.06);border-radius:var(--radius-md);
            border-left:3px solid var(--brand-gold)">
            <strong style="color:var(--brand-gold)">Regra de ouro:</strong>
            Setor é o ponto de entrada em todos os módulos. Antes de exibir tipos de tarefa,
            núcleos, categorias ou tarefas, o sistema deve saber "de qual setor?" —
            via perfil do usuário ou via filtro explícito na UI.
          </p>
        </div>

        <div class="ab-detail" id="ab-p2">
          <div class="sec-title">Pilar 2 — Papéis e permissões</div>
          <p style="font-size:0.8125rem;color:var(--text-muted);line-height:1.6">
            Ver aba <strong>Papéis e visibilidade</strong> para detalhamento completo.
          </p>
        </div>

        <div class="ab-detail" id="ab-p3">
          <div class="sec-title">Pilar 3 — Visibilidade de dados</div>
          <p style="font-size:0.8125rem;color:var(--text-muted);line-height:1.6">
            Ver aba <strong>Papéis e visibilidade</strong> → coluna visibilidade, e aba
            <strong>Módulos × hierarquia</strong> para onde cada filtro deve aparecer.
          </p>
        </div>
      </div>
    </div>

    <!-- HIERARQUIA -->
    <div class="ab-pane" id="ab-hierarquia">
      <div class="section">
        <div class="sec-title">Hierarquia organizacional e relações entre entidades</div>
        ${[
          ['#1a2a4a','#a8c4e8','Setor','Ex: Marketing, TI, Operadora, Financeiro','Campo <code>sector</code> presente em: task_types, nucleos, task_categories, users, requests.','0'],
          ['#1a3a2a','#7ecfa8','Núcleo','Ex: Design, Comunicação, Dados, Web, IA','Coleção <code>nucleos/{id}</code> com campo <code>sector</code>. Usuários têm <code>nucleo</code>. Tipos têm <code>nucleos[]</code>.','24'],
          ['#3a1a2a','#d4a0be','Tipo de tarefa','Ex: Newsletter, Apresentações, Post Instagram','Tem: <code>sector</code>, <code>nucleos[]</code>, <code>categoryId</code>, <code>variations[]</code>, <code>steps[]</code>, <code>scheduleSlots[]</code>.','48'],
          ['#3a2a1a','#d4c0a0','Variação','Ex: Revisão de layout, Criação, Adaptação','Array dentro do tipo: <code>{ id, name, slaDays }</code>. O SLA da tarefa vem daqui.','72'],
          ['#2a1a3a','#b0a0d4','Tarefa','A demanda real criada no sistema','Campos: <code>typeId</code>, <code>variationId</code>, <code>sector</code>, <code>nucleos[]</code>, <code>requestingArea</code>, <code>outOfCalendar</code>, <code>dueDate</code>.','96'],
        ].map((r,i,arr) => `
          <div class="ab-tier" style="margin-left:${r[5]}px">
            <div class="ab-tier-role" style="background:${r[0]};color:${r[1]}">${r[2]}</div>
            <div class="ab-tier-body">
              <div class="ab-tier-name">${r[3]}</div>
              <div class="ab-tier-desc">${r[4]}</div>
            </div>
          </div>
          ${i < arr.length-1 ? `<div class="ab-arrow" style="margin-left:${parseInt(r[5])+20}px">↓ contém</div>` : ''}
        `).join('')}

        <div style="margin-top:1.25rem">
          <div class="sec-title">Entidade auxiliar: Solicitação (portal público)</div>
          <div class="ab-tier">
            <div class="ab-tier-role" style="background:#1a1a3a;color:#a0a8d4">Solicitação</div>
            <div class="ab-tier-body">
              <div class="ab-tier-name">Entrada pelo portal — vira Tarefa quando aprovada</div>
              <div class="ab-tier-desc">Campos espelham a tarefa: <code>sector</code>, <code>typeId</code>, <code>variationId</code>, <code>variationName</code>, <code>requestingArea</code>, <code>outOfCalendar</code>, <code>nucleo</code>, <code>requesterName</code>, <code>requesterEmail</code>.</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ROLES -->
    <div class="ab-pane" id="ab-roles">
      <div class="section">
        <div class="sec-title">Matriz de papéis × visibilidade</div>
        <div style="overflow-x:auto">
          <table class="ab-matrix">
            <thead>
              <tr>
                <th>Papel</th><th>Setores visíveis</th><th>Módulos admin</th>
                <th>Tarefas</th><th>Tipos de tarefa</th><th>Solicitações</th>
              </tr>
            </thead>
            <tbody>
              ${[
                ['Diretoria (master)','c-ok','Todos','c-ok','Todos','c-ok','Ver/editar tudo','c-ok','Criar/editar/excluir','c-ok','Ver/converter/recusar'],
                ['Head (admin)','c-partial','Definido pela Diretoria (visibleSectors[])','c-partial','Usuários, Setores, Tipos','c-partial','Ver/editar nos seus setores','c-ok','Criar/editar nos seus setores','c-ok','Ver/converter/recusar'],
                ['Gerente (manager)','c-partial','Setor do usuário','c-partial','Só criar tipos','c-partial','Ver workspace, editar seu setor','c-partial','Criar no seu setor','c-ok','Ver/converter/recusar'],
                ['Coordenador','c-partial','Setor do usuário','c-no','Nenhum','c-partial','Ver seu setor/núcleo','c-no','Só visualizar','c-partial','Ver do seu setor'],
                ['Analista (member)','c-partial','Setor do usuário','c-no','Nenhum','c-partial','Criar + ver workspace','c-no','Só visualizar','c-no','Não acessa'],
              ].map(r => `
                <tr>
                  <td><strong>${r[0]}</strong></td>
                  <td class="${r[1]}">${r[2]}</td>
                  <td class="${r[3]}">${r[4]}</td>
                  <td class="${r[5]}">${r[6]}</td>
                  <td class="${r[7]}">${r[8]}</td>
                  <td class="${r[9]}">${r[10]}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="section">
        <div class="sec-title">Regras de visibilidade por setor</div>
        ${[
          ['Diretoria','Vê tudo, todos os setores, sem restrição.'],
          ['Head','Vê apenas os setores em <code>users/{uid}.visibleSectors[]</code>. A Diretoria define esse array.'],
          ['Gerente / Coordenador / Analista','Vê apenas o setor em <code>users/{uid}.sector</code>. Um campo, não um array.'],
          ['Filtros no front','Em qualquer módulo, o filtro de setor deve ser populado com os setores que aquele usuário pode ver — nunca com todos os setores do sistema.'],
        ].map(r => `
          <div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;
            font-size:0.8125rem;color:var(--text-muted);line-height:1.6">
            <span style="color:var(--text-primary);font-weight:600;white-space:nowrap;min-width:200px">${r[0]}</span>
            <span>${r[1]}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- DADOS -->
    <div class="ab-pane" id="ab-dados">
      <div class="section">
        <div class="sec-title">Coleções Firestore e campos chave</div>
        <div class="ab-data-grid">
          ${[
            ['task_types', [['id','pk'],['name',''],['sector','new'],['nucleos[]','fk→nucleos'],['categoryId','fk→categories'],['variations[]','new'],['scheduleSlots[]','new'],['steps[]',''],['deliveryStandard','new']]],
            ['tasks', [['id','pk'],['typeId','fk→types'],['variationId','new'],['variationName','new'],['sector','new'],['nucleos[]','fk→nucleos'],['requestingArea',''],['outOfCalendar','new'],['status, priority',''],['assignees[]','fk→users'],['workspaceId','fk→workspaces']]],
            ['requests', [['id','pk'],['typeId','fk→types'],['variationId','new'],['variationName','new'],['sector','new'],['requestingArea',''],['outOfCalendar','new'],['nucleo',''],['status',''],['rejectionNote','new']]],
            ['nucleos', [['id','pk'],['name',''],['sector','fk→setor'],['active','']]],
            ['task_categories', [['id','pk'],['name',''],['sector','new'],['color, icon','']]],
            ['users', [['id','pk'],['role / roleId',''],['sector','fk→setor'],['nucleo','fk→nucleos'],['visibleSectors[]',''],['prefs.cardFields[]','']]],
          ].map(([name, fields]) => `
            <div class="ab-data-card">
              <div class="ab-data-title">${name}</div>
              ${fields.map(([f, tag]) => `
                <div class="ab-data-field">
                  <code style="font-size:0.6875rem">${f}</code>
                  ${tag==='pk' ? '<span class="tag tag-pk">PK</span>' :
                    tag==='new' ? '<span class="tag tag-new">novo</span>' :
                    tag.startsWith('fk') ? `<span class="tag tag-fk">${tag}</span>` : ''}
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <!-- MÓDULOS -->
    <div class="ab-pane" id="ab-modulos">
      <div class="section">
        <div class="sec-title">Onde a hierarquia deve ser aplicada em cada módulo</div>
        <div style="overflow-x:auto">
          <table class="ab-matrix">
            <thead>
              <tr><th>Módulo</th><th>1° filtro (setor)</th><th>2° filtro (tipo)</th><th>Filtros adicionais</th><th>Visib. por papel</th></tr>
            </thead>
            <tbody>
              ${[
                ['Tarefas (lista)','c-ok','Automático pelo setor do usuário','c-ok','Filtro de tipo disponível','Área, responsável, status, projeto','c-partial','Parcial — ver varredura'],
                ['Steps / Kanban','c-partial','Falta filtro de setor','c-ok','Seletor de tipo na esteira','Área, responsável, projeto (novo)','c-partial','Parcial'],
                ['Calendário','c-partial','Falta filtro de setor','c-ok','Seletor de tipo na esteira/agenda','Área, responsável, projeto (novo)','c-partial','Parcial'],
                ['Timeline','c-partial','Falta filtro de setor','c-partial','Falta seletor de tipo','Área (novo), projeto (existente)','c-partial','Parcial'],
                ['Portal (solicitar.html)','c-ok','Setor responsável — campo obrigatório','c-ok','Tipo filtrado pelo setor','Variação, área solicitante','c-ok','Público — sem papel'],
                ['Solicitações','c-partial','Falta filtro de setor','c-partial','Falta filtro de tipo','Status (existente)','c-partial','Vê tudo — deveria filtrar'],
                ['Tipos de tarefa (admin)','c-ok','Campo setor no builder','—','n/a','Agrupado por categoria','c-ok','Apenas admin/manager'],
                ['Setores e Núcleos','—','n/a','—','n/a','—','c-ok','Apenas admin'],
              ].map(r => `
                <tr>
                  <td><strong>${r[0]}</strong></td>
                  <td class="${r[1]}">${r[2]}</td>
                  <td class="${r[3]}">${r[4]}</td>
                  <td>${r[5]}</td>
                  <td class="${r[6]}">${r[7]}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- VARREDURA -->
    <div class="ab-pane" id="ab-varredura">
      <div class="section">
        <div class="sec-title" style="color:#FCA5A5">🔴 Crítico — bloqueia fluxo ou gera dado errado</div>
        ${[
          'Tarefas criadas antes das melhorias não têm campo <code>sector</code> — filtros por setor retornam vazio para dados antigos.',
          'O campo <code>sector</code> em <code>tasks</code> não é preenchido no momento de criação via taskModal — só via portal e conversão de solicitação.',
          'Filtros dos módulos (Kanban, Calendário, Timeline) não têm setor como 1° filtro — o usuário vê todas as tarefas independente do seu setor.',
          'Visibilidade por papel não está aplicada no front: um Analista vê as mesmas tarefas que um Head — a restrição de setor não foi implementada nas queries.',
        ].map(t => `<div class="ab-flag flag-err"><span>🔴</span><span>${t}</span></div>`).join('')}
      </div>
      <div class="section">
        <div class="sec-title" style="color:#FCD34D">🟡 Importante — dado inconsistente ou UX quebrada</div>
        ${[
          'Newsletter no Firestore ainda tem schema antigo (<code>sla</code>, <code>rules</code>) — a migração automática só roda após próximo login.',
          '<code>task_categories</code> não é filtrada por setor na listagem de tipos (só no builder ao editar).',
          'Módulo Solicitações exibe todas as solicitações sem filtro de setor — Gerente de Marketing vê solicitações de TI.',
          '<code>cardPrefs</code> não considera o setor do usuário — campo "Setor" aparece mesmo para quem só tem acesso a um setor.',
          'Timeline não tem filtro de tipo de tarefa — inconsistente com Kanban e Calendário.',
        ].map(t => `<div class="ab-flag flag-warn"><span>🟡</span><span>${t}</span></div>`).join('')}
      </div>
      <div class="section">
        <div class="sec-title" style="color:#86EFAC">🟢 Melhoria — sem impacto em dado, melhora coerência</div>
        ${[
          'Calendário esteira: tipo já tem seletor, mas falta breadcrumb mostrando Setor > Tipo no header.',
          'Portal: ao selecionar tipo, abrir automaticamente a agenda prévia do tipo selecionado.',
          'Steps / Kanban: ao entrar no módulo, pré-selecionar o setor do usuário logado no filtro de setor.',
        ].map(t => `<div class="ab-flag flag-ok"><span>🟢</span><span>${t}</span></div>`).join('')}
      </div>
      <div class="section">
        <div class="sec-title">Sequência sugerida para correção</div>
        ${[
          'Adicionar <code>sector</code> ao taskModal (salvar em tasks ao criar/editar) → garante que novos dados já têm o campo',
          'Adicionar setor como 1° filtro em Kanban, Calendário, Timeline — populado com os setores visíveis do usuário',
          'Aplicar visibilidade por papel nas queries de tarefas (pelo menos filtro de setor no front)',
          'Filtrar módulo Solicitações por setor do usuário',
          'Script de migração de dados antigos (adicionar sector às tarefas existentes via typeId)',
        ].map((t,i) => `
          <div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;
            font-size:0.8125rem;color:var(--text-muted);line-height:1.6">
            <span class="step-num">${i+1}.</span><span>${t}</span>
          </div>
        `).join('')}
      </div>
    </div>

  </div>
  `;

  // Bind events after innerHTML — scripts inside innerHTML are never executed
  const doc = root.querySelector('.ab-doc');
  if (!doc) return;

  // Tab switching
  doc.querySelectorAll('.ab-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      doc.querySelectorAll('.ab-tab').forEach(t => t.classList.remove('active'));
      doc.querySelectorAll('.ab-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const pane = doc.getElementById('ab-' + tab.dataset.pane);
      if (pane) pane.classList.add('active');
    });
  });

  // Pillar switching
  doc.querySelectorAll('.ab-pillar').forEach(pillar => {
    pillar.addEventListener('click', () => {
      doc.querySelectorAll('.ab-pillar').forEach(p => p.classList.remove('active'));
      doc.querySelectorAll('.ab-detail').forEach(d => d.classList.remove('active'));
      pillar.classList.add('active');
      const det = doc.getElementById('ab-' + pillar.dataset.pillar);
      if (det) det.classList.add('active');
    });
  });
}
