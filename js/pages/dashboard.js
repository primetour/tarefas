/**
 * PRIMETOUR — Dashboard (Etapa 2)
 * Stats reais de tarefas e projetos do Firestore
 */

import { store }         from '../store.js';
import { fetchTasks, PRIORITY_MAP, STATUS_MAP, NEWSLETTER_STATUSES, TASK_TYPES, NUCLEOS } from '../services/tasks.js';
import { fetchProjects } from '../services/projects.js';
import { openTaskModal } from '../components/taskModal.js';
import { toast }         from '../components/toast.js';
import { countPendingRequests } from '../services/requests.js';
import { fetchGoals }    from '../services/goals.js';
import { fetchUserAbsences, fetchAllAbsences, ABSENCE_TYPES } from '../services/capacity.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function renderDashboard(container) {
  const profile = store.get('userProfile');
  const hour    = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const uid      = store.get('currentUser')?.uid;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">${greeting}, ${profile?.name?.split(' ')[0] || 'Usuário'}! 👋</h1>
        <p class="page-subtitle">${formatDate(new Date())}</p>
      </div>
      <div class="page-header-actions">
        ${(() => {
          const sectors = store.getVisibleSectors();
          if (sectors === null || sectors.length > 1) {
            const allSectors = ['BTG','C&P','Célula ICs','Centurion','CEP','Concierge Bradesco','Contabilidade','Diretoria','Eventos','Financeiro','Lazer','Marketing','Operadora','Programa ICs','Projetos','PTS Bradesco','Qualidade','Suppliers','TI'];
            const opts = (sectors || allSectors).map(s=>`<option value="${s}">${s}</option>`).join('');
            return `<select class="filter-select" id="dash-sector-filter" style="min-width:150px;">
              <option value="">Todos os setores</option>${opts}</select>`;
          }
          if (sectors?.length === 1) return `<span style="font-size:0.8125rem;padding:5px 10px;border-radius:var(--radius-full);background:rgba(212,168,67,.1);color:var(--brand-gold);border:1px solid rgba(212,168,67,.3);">🏢 ${sectors[0]}</span>`;
          return '';
        })()}
        <button class="btn btn-primary" id="dash-new-task">+ Nova Tarefa</button>
      </div>
    </div>

    <!-- 4.26+ Lembretes & Anotações no TOPO (acima de Meu Desempenho).
         Antes ficavam no rodapé direito; user pediu pra ficarem mais visíveis. -->
    <div class="dash-personal-row" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
      <div class="card" id="dash-reminders-card-top">
        <div class="card-header">
          <div class="card-title">⏰ Lembretes</div>
          <button class="btn btn-ghost btn-sm" id="dash-reminders-add" title="Novo lembrete" style="padding:4px 8px;">+ Novo</button>
        </div>
        <div class="card-body" id="dash-reminders-list" style="padding:8px 16px 12px;min-height:80px;">
          <div style="color:var(--text-muted);font-size:0.75rem;padding:8px 0;">Carregando...</div>
        </div>
      </div>
      <div class="card" id="dash-notes-card-top">
        <div class="card-header">
          <div class="card-title">📝 Anotações</div>
          <button class="btn btn-ghost btn-sm" id="dash-notes-add" title="Novo post-it" style="padding:4px 8px;">+ Novo</button>
        </div>
        <div class="card-body" id="dash-notes-list" style="padding:8px 16px 12px;min-height:80px;">
          <div style="color:var(--text-muted);font-size:0.75rem;padding:8px 0;">Carregando...</div>
        </div>
      </div>
    </div>

    <div id="dash-stats">
      ${[0,1,2,3].map(()=>'<div class="stat-card skeleton" style="height:100px;"></div>').join('')}
    </div>

    <div class="dash-main-grid" id="dash-main">
      <div class="card"><div class="card-body skeleton" style="height:240px;"></div></div>
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div class="card"><div class="card-body skeleton" style="height:120px;"></div></div>
        <div class="card"><div class="card-body skeleton" style="height:120px;"></div></div>
      </div>
    </div>
  `;

  document.getElementById('dash-new-task')?.addEventListener('click', () =>
    openTaskModal({ onSave: () => renderDashboard(container) })
  );

  // Sector filter for multi-sector users
  document.getElementById('dash-sector-filter')?.addEventListener('change', (e) => {
    renderDashboard(container);
    // Store chosen sector temporarily so fetchTasks picks it up via getVisibleSectors
    // For now just re-render — fetchTasks already filters by user's visible sectors
  });

  const dashSectorFilter = document.getElementById('dash-sector-filter')?.value || null;

  try {
    // Período pra ausências: hoje até +30 dias (próximas) e equipe hoje
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const in30Days = new Date(todayStart); in30Days.setDate(in30Days.getDate()+30);
    const isManager = store.can('system_manage_users') || store.can('workspace_create');

    const [tasks, projects, pendingReqs, myGoals, myAbsences, allAbsences] = await Promise.all([
      fetchTasks().catch(() => []),
      fetchProjects().catch(() => []),
      countPendingRequests().catch(() => 0),
      fetchGoals({ type: 'personal' }).catch(() => []),
      fetchUserAbsences(uid).catch(() => []),
      isManager ? fetchAllAbsences({ startDate: todayStart, endDate: in30Days }).catch(() => []) : Promise.resolve([]),
    ]);

    // Guard: user navigated away during async fetch — container no longer in DOM
    if (!document.getElementById('dash-stats')) return;

    // ── Filtros base ────────────────────────────────────────
    // CRÍTICO: filtrar archived em TODOS os cálculos. A página #tasks
    // filtra archived em applyFilters(); se o painel não fizer o mesmo,
    // os números do card divergem dos da lista (bug 3.5.x reportado).
    const sectorSel = document.getElementById('dash-sector-filter')?.value || null;
    const baseTasks = tasks.filter(t => !t.archived);
    const visibleTasks = sectorSel ? baseTasks.filter(t => !t.sector || t.sector === sectorSel) : baseTasks;

    // ── "MEU" — sempre estritamente assignees.includes(uid) ──
    // Definição canônica: ver RULES-AND-AUTOMATIONS.md § 10.1 ("Minhas tarefas")
    // Mesmo critério que ?assignee=me usa em tasks.js — garante que click
    // no card leva pra lista com EXATAMENTE o mesmo número de tarefas.
    const myTasks       = visibleTasks.filter(t => t.assignees?.includes(uid));
    const myActive      = myTasks.filter(t => !['done','cancelled'].includes(t.status));
    const myInProgress  = myTasks.filter(t => t.status === 'in_progress');
    const myOverdue     = myActive.filter(t => {
      if (!t.dueDate) return false;
      const due = t.dueDate?.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
      const today = new Date(); today.setHours(0,0,0,0);
      return due < today;
    });
    const myPartnerships = myActive.filter(t => t.isPartnership);
    // "Concluí hoje" = status done + completedAt em hoje, e fui assignee.
    // Antes: contava TODAS concluídas hoje no sistema (bug 3.5.x).
    const now = new Date();
    const todayStr = now.toDateString();
    const myDoneToday = myTasks.filter(t => {
      if (t.status !== 'done' || !t.completedAt) return false;
      const d = t.completedAt?.toDate ? t.completedAt.toDate() : new Date(t.completedAt);
      return d.toDateString() === todayStr;
    });

    // ── "Observando" — observer mas NÃO assignee ───────────
    const myObserving = visibleTasks.filter(t =>
      (t.observers||[]).includes(uid) && !(t.assignees||[]).includes(uid)
    );

    // ── "EQUIPE / SETOR" — todas visíveis (não-arquivadas) ──
    // Mostradas em seção separada pra dar visão de capacidade do time.
    // Coordenador/manager/admin tem skin nesse número; analista comum vê,
    // mas o card é informativo, não vinculado a uma ação dele.
    const teamActive     = visibleTasks.filter(t => !['done','cancelled'].includes(t.status));
    const teamInProgress = visibleTasks.filter(t => t.status === 'in_progress');
    const teamOverdue    = teamActive.filter(t => {
      if (!t.dueDate) return false;
      const due = t.dueDate?.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
      const today = new Date(); today.setHours(0,0,0,0);
      return due < today;
    });
    const teamDoneToday = visibleTasks.filter(t => {
      if (t.status !== 'done' || !t.completedAt) return false;
      const d = t.completedAt?.toDate ? t.completedAt.toDate() : new Date(t.completedAt);
      return d.toDateString() === todayStr;
    });

    // ── Stats ─────────────────────────────────────────────
    const $stats = document.getElementById('dash-stats');
    if (!$stats) return; // user navigated away
    // Painel reorganizado em 3.6.0 com 2 seções:
    //   1. "Meu desempenho" — KPIs estritos (assignee=me) onde o número
    //      do card BATE com a lista do clique (mesma definição em ambos)
    //   2. "Equipe" — opcional, mostrada se houver visibleTasks > myTasks
    //      (analista solo não vê — evita ruído). Skin: coordenador+ usa
    //      pra distribuir trabalho.
    //
    // Mudanças vs 3.5.x:
    //   - "Em Andamento: 48" (todas do sistema) → "Minhas Em Andamento" (só minhas)
    //   - "Concluídas Hoje: 40" (todas do sistema) → "Concluí Hoje" (só minhas)
    //   - "Projetos Ativos" removido (não é desempenho pessoal)
    //   - "Atrasadas minhas" novo (vinculado ao status virtual 3.5.0)
    //   - Filtro `archived` aplicado consistentemente
    const teamCardsVisible = visibleTasks.length > myTasks.length;
    // Cada seção tem grid próprio com auto-fit (cards expandem pra preencher
    // a largura). Antes (3.6.0): labels com grid-column:1/-1 misturado com
    // cards no mesmo grid causava "buraco" branco quando havia menos cards
    // que colunas implícitas (ex: 3 cards num grid de 6 col = 3 col vazias
    // que auto-fit não colapsava por estarem no fim da row do mesmo grid).
    // Fix 3.6.1: container vira flex-column + cada seção é seu próprio
    // grid auto-fit que distribui o espaço entre os cards que TEM.
    const sectionLabel = (text) => `<div class="dash-stats-section-label">${text}</div>`;
    const cardsRow = (cards) => `<div class="dash-stats-row">${cards}</div>`;

    // 4 cards canônicos por seção (3.7.0+):
    //   Meu desempenho: Minhas tarefas (total) · Atrasadas · Em andamento · Concluídas hoje
    //   Equipe:         Tarefas da equipe       · Atrasadas · Em andamento · Concluídas hoje
    // Observando e Parcerias deixaram de ser cards principais — informação
    // ainda disponível na lista "Minhas Tarefas" abaixo (seções colapsáveis).
    const myCards = [
      statCard('Minhas tarefas',     myTasks.length,       '📋', 'rgba(212,168,67,0.12)', 'var(--brand-gold)',                 '#tasks?assignee=me'),
      statCard('Atrasadas',          myOverdue.length,     '⚠',  'rgba(239,68,68,0.10)',  '#EF4444',                            '#tasks?assignee=me&status=overdue'),
      statCard('Em andamento',       myInProgress.length,  '▶',  'rgba(56,189,248,0.12)', 'var(--role-manager)',                '#tasks?assignee=me&status=in_progress'),
      statCard('Concluídas hoje',    myDoneToday.length,   '✓',  'var(--color-success-bg)','var(--color-success)',              '#tasks?assignee=me&completedToday=1'),
    ].join('');

    const teamCards = teamCardsVisible ? [
      statCard('Tarefas da equipe',  visibleTasks.length,  '👥', 'rgba(99,102,241,0.10)', 'var(--text-secondary)',              '#tasks'),
      statCard('Atrasadas',          teamOverdue.length,   '⚠',  'rgba(239,68,68,0.06)',  'var(--text-secondary)',              '#tasks?status=overdue'),
      statCard('Em andamento',       teamInProgress.length,'▶',  'rgba(56,189,248,0.06)', 'var(--text-secondary)',              '#tasks?status=in_progress'),
      statCard('Concluídas hoje',    teamDoneToday.length, '✓',  'var(--color-success-bg)','var(--text-secondary)',             '#tasks?completedToday=1'),
    ].join('') : '';

    $stats.innerHTML = `
      ${sectionLabel('🎯 Meu desempenho')}
      ${cardsRow(myCards)}
      ${teamCards ? sectionLabel(sectorSel ? `🏢 Setor ${sectorSel}` : '🏢 Equipe / Setor') : ''}
      ${teamCards ? cardsRow(teamCards) : ''}
    `;

    // overdue mantido por compat — myOverdue já calculado acima
    const overdue = myOverdue;

    // ── Main grid ─────────────────────────────────────────
    const $main = document.getElementById('dash-main');
    if (!$main) return; // user navigated away
    $main.innerHTML = `
      <!-- My tasks card -->
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">📋 Minhas Tarefas</div>
            ${overdue.length ? `<div class="card-subtitle" style="color:var(--color-danger);">⚠ ${overdue.length} em atraso</div>` : ''}
          </div>
          <button class="btn btn-ghost btn-sm" onclick="location.hash='#tasks'">Ver todas →</button>
        </div>
        <div style="padding:0 16px 8px;">
          ${(() => {
            // myActive já calculado acima — reusa
            const myDone = myTasks.filter(t => t.status === 'done');
            const observingActive = myObserving.filter(t => !['done','cancelled'].includes(t.status));

            if (!myTasks.length && !observingActive.length) return `<div class="empty-state" style="padding:24px;"><div class="empty-state-icon">🎉</div>
                <div class="empty-state-title">Nenhuma tarefa atribuída a você</div></div>`;

            const renderRow = (t) => {
              const isDone = t.status === 'done';
              const status = STATUS_MAP[t.status];
              const typeLabel = TASK_TYPES?.find(x=>x.value===t.type)?.label||'';
              const nlLabel   = t.type==='newsletter' && t.newsletterStatus
                ? (NEWSLETTER_STATUSES?.find(s=>s.value===t.newsletterStatus)?.label||'') : '';
              return `<div class="task-row ${isDone?'done':''} dash-task-row" data-tid="${t.id}"
                style="grid-template-columns:10px 1fr auto; padding:9px 0; gap:10px;">
                <div class="priority-dot priority-${t.priority||'medium'}"></div>
                <div style="overflow:hidden; min-width:0;">
                  <div class="task-row-title">${esc(t.title)}</div>
                  <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:2px; align-items:center;">
                    ${t.requestingArea ? `<span style="font-size:0.6875rem;color:var(--text-muted);">📍 ${esc(t.requestingArea)}</span>` : ''}
                    ${typeLabel ? `<span style="font-size:0.6875rem;color:var(--text-muted);">${esc(typeLabel)}</span>` : ''}
                    ${nlLabel ? `<span style="font-size:0.6875rem;color:var(--brand-gold);">↳ ${esc(nlLabel)}</span>` : ''}
                    ${(t.nucleos||[]).length ? `<span style="font-size:0.6875rem;color:var(--text-muted);">◈ ${(t.nucleos||[]).map(n=>NUCLEOS.find(x=>x.value===n)?.label||n).join(', ')}</span>` : ''}
                    ${t.dueDate ? `<span class="text-xs" style="color:${dueColor(t.dueDate,isDone)};">📅 ${fmtShort(t.dueDate)}</span>` : ''}
                  </div>
                </div>
                <span class="badge badge-status-${t.status}" style="font-size:0.625rem;white-space:nowrap;">${status?.label||t.status}</span>
              </div>`;
            };

            let html = '';

            // Tarefas ativas
            if (myActive.length) {
              html += myActive.slice(0, 7).map(renderRow).join('');
              if (myActive.length > 7) {
                html += `<div style="padding:6px 0;text-align:center;">
                  <a href="#tasks" style="font-size:0.8125rem;color:var(--brand-gold);">+${myActive.length-7} mais</a></div>`;
              }
            }

            // Seção Concluídas (colapsável)
            if (myDone.length) {
              html += `
                <div style="border-top:1px solid var(--border-subtle);margin-top:8px;padding-top:8px;">
                  <button id="dash-toggle-done" style="display:flex;align-items:center;gap:6px;width:100%;
                    background:none;border:none;cursor:pointer;padding:4px 0;
                    font-size:0.8125rem;font-weight:600;color:var(--text-muted);">
                    <span id="dash-done-arrow" style="transition:transform 0.2s;font-size:0.75rem;">▸</span>
                    ✓ Concluídas (${myDone.length})
                  </button>
                  <div id="dash-done-list" style="display:none;">
                    ${myDone.slice(0, 5).map(renderRow).join('')}
                    ${myDone.length > 5 ? `<div style="padding:6px 0;text-align:center;">
                      <a href="#tasks" style="font-size:0.8125rem;color:var(--brand-gold);">+${myDone.length-5} mais</a></div>` : ''}
                  </div>
                </div>`;
            }

            // Seção Estou observando (colapsável) — tarefas onde sou observer
            // mas não responsável (não conta em produtividade)
            if (observingActive.length) {
              html += `
                <div style="border-top:1px solid var(--border-subtle);margin-top:8px;padding-top:8px;">
                  <button id="dash-toggle-obs" style="display:flex;align-items:center;gap:6px;width:100%;
                    background:none;border:none;cursor:pointer;padding:4px 0;
                    font-size:0.8125rem;font-weight:600;color:var(--text-muted);">
                    <span id="dash-obs-arrow" style="transition:transform 0.2s;font-size:0.75rem;">▸</span>
                    🔭 Estou observando (${observingActive.length})
                    <span style="font-size:0.6875rem;color:var(--text-muted);font-weight:400;margin-left:4px;">— não conta em metas</span>
                  </button>
                  <div id="dash-obs-list" style="display:none;">
                    ${observingActive.slice(0, 5).map(renderRow).join('')}
                    ${observingActive.length > 5 ? `<div style="padding:6px 0;text-align:center;">
                      <a href="#tasks" style="font-size:0.8125rem;color:var(--brand-gold);">+${observingActive.length-5} mais</a></div>` : ''}
                  </div>
                </div>`;
            }

            return html;
          })()}
        </div>
      </div>

      <!-- Right column -->
      <div style="display:flex;flex-direction:column;gap:16px;">
        <!-- Squads -->
        ${(() => {
          const workspaces = store.get('userWorkspaces') || [];
          if (!workspaces.length) return '';
          return `<div class="card">
            <div class="card-header">
              <div class="card-title">◈ Meus Squads</div>
              <a href="#workspaces" class="btn btn-ghost btn-sm">Ver →</a>
            </div>
            <div class="card-body" style="padding:8px 16px;display:flex;flex-direction:column;gap:8px;">
              ${workspaces.slice(0,4).map(ws => {
                // baseTasks (não-arquivadas) — consistente com a página #tasks
                const wsTasks = baseTasks.filter(t => t.workspaceId === ws.id);
                const wsDone  = wsTasks.filter(t => t.status==='done').length;
                return `<a href="#tasks?workspaceId=${esc(ws.id)}" style="display:flex;align-items:center;gap:10px;padding:4px 0;text-decoration:none;color:inherit;">
                  <div style="width:28px;height:28px;border-radius:var(--radius-sm);flex-shrink:0;
                    background:${ws.color||'#D4A843'}22;color:${ws.color||'#D4A843'};
                    display:flex;align-items:center;justify-content:center;font-size:0.875rem;">
                    ${esc(ws.icon||'◈')}
                  </div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:0.8125rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(ws.name)}</div>
                    <div style="font-size:0.75rem;color:var(--text-muted);">${wsTasks.length} tarefa${wsTasks.length!==1?'s':''} · ${wsDone} concluídas</div>
                  </div>
                </a>`;
              }).join('')}
            </div>
          </div>`;
        })()}

        <!-- Próxima ausência (minha) -->
        ${(() => {
          // Filtra ausências futuras minhas
          const futureMine = (myAbsences || [])
            .map(a => ({
              ...a,
              _start: a.startDate?.toDate ? a.startDate.toDate() : new Date(a.startDate),
              _end:   a.endDate?.toDate   ? a.endDate.toDate()   : new Date(a.endDate),
            }))
            .filter(a => a._end >= now)
            .sort((a, b) => a._start - b._start);
          if (!futureMine.length) return '';
          const next = futureMine[0];
          const td   = ABSENCE_TYPES.find(t => t.value === next.type) || ABSENCE_TYPES[5];
          const fmtD = d => d.toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit'});
          const fmtT = d => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
          const partialBadge = next.partial
            ? `<span style="font-size:0.6875rem;margin-left:6px;color:var(--text-muted);">parcial ${fmtT(next._start)}-${fmtT(next._end)}</span>`
            : '';
          const isStarted = next._start <= now;
          return `<div class="card">
            <div class="card-header">
              <div class="card-title" style="color:${td.color};">${td.icon} ${isStarted?'Ausente agora':'Próxima ausência'}</div>
              <a href="#team" class="btn btn-ghost btn-sm">Ver →</a>
            </div>
            <div class="card-body" style="padding:12px 16px;">
              <div style="font-size:0.875rem;color:var(--text-primary);">
                <strong>${esc(td.label)}</strong> ${partialBadge}
              </div>
              <div style="font-size:0.75rem;color:var(--text-muted);margin-top:3px;">
                ${fmtD(next._start)}${next.partial ? '' : ' a ' + fmtD(next._end)}
              </div>
              ${futureMine.length > 1 ? `<div style="font-size:0.6875rem;color:var(--text-muted);margin-top:6px;">+${futureMine.length-1} agendada${futureMine.length-1!==1?'s':''}</div>` : ''}
            </div>
          </div>`;
        })()}

        <!-- Equipe ausente hoje (gestor) -->
        ${isManager && allAbsences?.length ? (() => {
          const todayMs = now.getTime();
          const absentNow = allAbsences.filter(a => {
            const s = a.startDate?.toDate ? a.startDate.toDate() : new Date(a.startDate);
            const e = a.endDate?.toDate   ? a.endDate.toDate()   : new Date(a.endDate);
            return s.getTime() <= todayMs && todayMs <= e.getTime();
          });
          if (!absentNow.length) return '';
          const users = store.get('users') || [];
          const peopleNames = absentNow.map(a => {
            const u = users.find(x => x.id === a.userId);
            const td = ABSENCE_TYPES.find(t => t.value === a.type);
            return `${u?.name?.split(' ')[0] || a.userId} (${td?.icon || '◌'})`;
          }).join(', ');
          return `<div class="card" style="border:1px solid rgba(239,68,68,0.2);">
            <div class="card-header">
              <div class="card-title" style="color:#EF4444;">⚠ Equipe ausente hoje</div>
              <a href="#team" class="btn btn-ghost btn-sm">Ver →</a>
            </div>
            <div class="card-body" style="padding:12px 16px;">
              <div style="font-size:1.5rem;font-weight:700;color:#EF4444;">${absentNow.length}</div>
              <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;line-height:1.4;">
                ${esc(peopleNames)}
              </div>
            </div>
          </div>`;
        })() : ''}

        <!-- Pending requests (manager+) -->
        ${pendingReqs > 0 && (store.can('workspace_create') || store.can('system_manage_users')) ? `
          <div class="card" style="border:1px solid rgba(239,68,68,0.3);">
            <div class="card-header">
              <div class="card-title" style="color:#EF4444;">◌ Solicitações pendentes</div>
              <a href="#requests" class="btn btn-ghost btn-sm">Ver →</a>
            </div>
            <div class="card-body" style="padding:12px 16px;">
              <div style="display:flex;align-items:center;gap:12px;">
                <div style="font-size:2rem;font-weight:700;color:#EF4444;">${pendingReqs}</div>
                <div style="font-size:0.875rem;color:var(--text-secondary);line-height:1.5;">
                  solicitação${pendingReqs!==1?'s':''} aguardando triagem
                </div>
              </div>
            </div>
          </div>
        ` : ''}

        <!-- My Goals -->
        ${myGoals.length ? `
          <div class="card">
            <div class="card-header">
              <div class="card-title">◎ Minhas Metas</div>
              <a href="#goals" class="btn btn-ghost btn-sm">Ver →</a>
            </div>
            <div class="card-body" style="padding:8px 16px;display:flex;flex-direction:column;gap:10px;">
              ${myGoals.slice(0,3).map(g => {
                const pct = g.target > 0 ? Math.min(100, Math.round((g.current||0)/g.target*100)) : g.progress||0;
                const color = pct>=100?'#22C55E':pct>=60?'#F59E0B':'#38BDF8';
                // baseTasks: filtra archived (consistência com #tasks)
                const gTasks = baseTasks.filter(t => {
                  if (t.goalId === g.id) return true;
                  if (Array.isArray(t.metaLinks)) return t.metaLinks.some(l => l && l.goalId === g.id);
                  return false;
                });
                const gDone  = gTasks.filter(t => t.status === 'done').length;
                return `<div>
                  <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                    <span style="font-size:0.8125rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;
                      white-space:nowrap;max-width:60%;">${esc(g.title || g.objetivoNucleo || g.pilares?.[0]?.titulo || 'Meta')}</span>
                    <span style="font-size:0.8125rem;font-weight:700;color:${color};">${pct}%</span>
                  </div>
                  ${gTasks.length ? `<div style="font-size:0.6875rem;color:var(--text-muted);margin-bottom:3px;">
                    ${gTasks.length} tarefa${gTasks.length!==1?'s':''} vinculada${gTasks.length!==1?'s':''} · ${gDone} concluída${gDone!==1?'s':''}
                  </div>` : ''}
                  <div class="progress" style="height:4px;">
                    <div class="progress-bar" style="width:${pct}%;background:${color};"></div>
                  </div>
                </div>`;
              }).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Meus Projetos — onde sou member, criador, ou tenho tarefa atribuída.
             Fix 3.6.0: antes mostrava TODOS os projetos do sistema, mesmo
             aqueles onde o user nem participa. Agora filtra por relevância. -->
        ${(() => {
          const myProjects = projects.filter(p => {
            // Critério de "meu projeto":
            //   1. Sou member explícito
            //   2. Criei
            //   3. Tenho ao menos 1 tarefa atribuída a mim no projeto
            if ((p.members || []).includes(uid)) return true;
            if (p.createdBy === uid) return true;
            return myTasks.some(t => t.projectId === p.id);
          });
          if (!myProjects.length) return '';
          return `<div class="card">
            <div class="card-header">
              <div class="card-title">📦 Meus Projetos</div>
              <a href="#projects" class="btn btn-ghost btn-sm">Ver todos →</a>
            </div>
            <div class="card-body" style="padding:12px 16px; display:flex; flex-direction:column; gap:10px;">
              ${myProjects.slice(0,4).map(p => {
                // Tarefas do projeto, mas só MINHAS (assignee) — % reflete meu progresso
                // no projeto, não progresso global do projeto.
                const pt = myTasks.filter(t => t.projectId === p.id);
                const pd = pt.filter(t => t.status==='done').length;
                const pct = pt.length ? Math.round(pd/pt.length*100) : 0;
                return `<a href="#tasks?projectId=${esc(p.id)}&assignee=me" style="text-decoration:none;color:inherit;display:block;">
                  <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                    <span style="font-size:0.8125rem;font-weight:500;color:var(--text-primary);">${p.icon||'📦'} ${esc(p.name)}</span>
                    <span style="font-size:0.75rem;color:var(--text-muted);">${pt.length ? `${pd}/${pt.length} (${pct}%)` : 'sem tarefas minhas'}</span>
                  </div>
                  ${pt.length ? `<div class="progress" style="height:4px;">
                    <div class="progress-bar" style="width:${pct}%;background:${p.color||'var(--brand-gold)'};"></div>
                  </div>` : ''}
                </a>`;
              }).join('')}
              ${myProjects.length > 4 ? `<a href="#projects" style="font-size:0.75rem;color:var(--text-muted);text-align:center;text-decoration:none;">
                +${myProjects.length - 4} projeto${myProjects.length-4!==1?'s':''}
              </a>` : ''}
            </div>
          </div>`;
        })()}

        <!-- Minha distribuição — status só das MINHAS tarefas (assignee).
             Fix 3.6.0:
               - Antes: filtrava tasks (global) e usava status='todo' que não existe
                 (real é 'not_started'), sempre mostrando 0 em "A Fazer"
               - Agora: usa myTasks (consistente) e os 5 status reais do sistema -->
        ${myTasks.length ? `
          <div class="card">
            <div class="card-header"><div class="card-title">📊 Minha distribuição</div></div>
            <div class="card-body" style="padding:12px 16px;display:flex;flex-direction:column;gap:8px;">
              ${[
                {value:'not_started', label:'Não iniciado', color:'#38BDF8'},
                {value:'in_progress', label:'Em Andamento', color:'#F59E0B'},
                {value:'review',      label:'Em Revisão',   color:'#A78BFA'},
                {value:'rework',      label:'Retrabalho',   color:'#F97316'},
                {value:'done',        label:'Concluídas',   color:'#22C55E'},
              ].map(s => {
                const cnt = myTasks.filter(t => t.status === s.value).length;
                if (!cnt) return '';
                const pct = Math.round(cnt / myTasks.length * 100);
                return `<a href="#tasks?assignee=me&status=${s.value}" style="text-decoration:none;color:inherit;display:block;">
                  <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                    <span style="font-size:0.8125rem;color:var(--text-secondary);">${s.label}</span>
                    <span style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);">${cnt}</span>
                  </div>
                  <div class="progress" style="height:5px;">
                    <div class="progress-bar" style="width:${pct}%;background:${s.color};"></div>
                  </div>
                </a>`;
              }).filter(Boolean).join('')}
            </div>
          </div>
        ` : ''}

      </div>
    `;

    // 4.24+ Mount Lembretes & Anotações (lazy import + render assíncrono)
    mountUserPanels(container);

    // Bind task rows
    container.querySelectorAll('.dash-task-row[data-tid]').forEach(row => {
      row.addEventListener('click', () => {
        const task = tasks.find(t=>t.id===row.dataset.tid);
        if (task) openTaskModal({ taskData: task, onSave: () => renderDashboard(container) });
      });
    });

    // Toggle concluídas
    document.getElementById('dash-toggle-done')?.addEventListener('click', () => {
      const list  = document.getElementById('dash-done-list');
      const arrow = document.getElementById('dash-done-arrow');
      if (!list) return;
      const show = list.style.display === 'none';
      list.style.display = show ? 'block' : 'none';
      if (arrow) arrow.style.transform = show ? 'rotate(90deg)' : '';
    });

    // Toggle observando
    document.getElementById('dash-toggle-obs')?.addEventListener('click', () => {
      const list  = document.getElementById('dash-obs-list');
      const arrow = document.getElementById('dash-obs-arrow');
      if (!list) return;
      const show = list.style.display === 'none';
      list.style.display = show ? 'block' : 'none';
      if (arrow) arrow.style.transform = show ? 'rotate(90deg)' : '';
    });

  } catch(e) {
    console.error('Dashboard error:', e);
    toast.error('Erro ao carregar dashboard: ' + e.message);
  }
}

/* ─── Helpers ─────────────────────────────────────────────── */
function statCard(label, value, icon, ibg, ic, href) {
  return `<div class="stat-card" style="cursor:pointer;" onclick="location.hash='${href}'">
    <div class="stat-card-icon" style="background:${ibg};color:${ic};">${icon}</div>
    <div class="stat-card-label">${label}</div>
    <div class="stat-card-value">${value}</div>
  </div>`;
}

/* ─── 4.24+ Lembretes & Anotações (Meu Painel) ─────────────── */

const escTxt = s => String(s||'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function mountUserPanels(container) {
  const [{
    fetchNotes, createNote, updateNote, deleteNote,
    fetchReminders, createReminder, updateReminder, deleteReminder,
    checkDueReminders, NOTE_COLORS,
  }, { openTaskModal: openTM }] = await Promise.all([
    import('../services/userNotes.js'),
    import('../components/taskModal.js'),
  ]);

  // ── Reminders ──────────────────────────────────────────────
  async function renderReminders() {
    const list = await fetchReminders({ includeDone: false }).catch(() => []);
    const el = document.getElementById('dash-reminders-list');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = `<div style="color:var(--text-muted);font-size:0.75rem;padding:8px 0;text-align:center;">
        Nenhum lembrete ativo. Clique em <strong>+ Novo</strong> pra criar.
      </div>`;
      return;
    }
    const fmtDue = (r) => {
      if (!r.dueAt) return '';
      const d = r.dueAt?.toDate?.() || new Date(r.dueAt);
      if (isNaN(d.getTime())) return '';
      const today = new Date(); today.setHours(0,0,0,0);
      const diff = Math.floor((d - today) / 86400000);
      const overdue = d < new Date();
      const color = overdue ? '#EF4444' : diff <= 1 ? '#F59E0B' : 'var(--text-muted)';
      const label = overdue ? 'vencido' :
                    diff === 0 ? 'hoje' :
                    diff === 1 ? 'amanhã' :
                    diff < 7 ? `em ${diff}d` :
                    d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' });
      return `<span style="font-size:0.6875rem;color:${color};font-weight:500;">📅 ${label}</span>`;
    };
    el.innerHTML = list.slice(0, 5).map(r => `
      <div class="reminder-row" data-id="${escTxt(r.id)}" style="display:flex;align-items:center;gap:8px;padding:6px 0;
        border-bottom:1px dashed var(--border-subtle);">
        <input type="checkbox" data-act="rem-done" data-id="${escTxt(r.id)}"
          style="cursor:pointer;flex-shrink:0;accent-color:var(--brand-gold);" />
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;">
          <div style="font-size:0.8125rem;color:var(--text-primary);overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap;">${escTxt(r.title)}</div>
          ${r.dueAt ? fmtDue(r) : ''}
        </div>
        <button data-act="rem-task" data-id="${escTxt(r.id)}" title="Converter em tarefa"
          style="background:none;border:none;cursor:pointer;color:var(--text-muted);
          padding:4px 6px;font-size:0.6875rem;">→ tarefa</button>
        <button data-act="rem-del" data-id="${escTxt(r.id)}" title="Excluir"
          style="background:none;border:none;cursor:pointer;color:var(--color-danger);
          padding:4px 6px;font-size:0.75rem;">✕</button>
      </div>
    `).join('') + (list.length > 5 ? `<div style="text-align:center;padding-top:6px;
      font-size:0.6875rem;color:var(--text-muted);">+${list.length-5} mais lembretes</div>` : '');

    // Wire actions
    el.querySelectorAll('[data-act="rem-done"]').forEach(cb => {
      cb.addEventListener('change', async (e) => {
        try {
          await updateReminder(e.target.dataset.id, { done: true, completedAt: new Date() });
          toast.success('Lembrete concluído!');
          await renderReminders();
        } catch (err) { toast.error('Erro: ' + err.message); }
      });
    });
    el.querySelectorAll('[data-act="rem-del"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Excluir este lembrete?')) return;
        try {
          await deleteReminder(btn.dataset.id);
          await renderReminders();
        } catch (err) { toast.error('Erro: ' + err.message); }
      });
    });
    el.querySelectorAll('[data-act="rem-task"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const r = list.find(x => x.id === btn.dataset.id);
        if (!r) return;
        // Abre taskModal pré-preenchido com dados do lembrete
        openTM({
          taskData: {
            title: r.title,
            description: '',
            assignees: [store.get('currentUser')?.uid].filter(Boolean),
            dueDate: r.dueAt
              ? (r.dueAt.toDate?.() || new Date(r.dueAt)).toISOString().slice(0,10)
              : null,
            status: 'not_started',
            tags: ['lembrete'],
          },
          onSave: async (newTaskId) => {
            // Marca lembrete como done + linka task
            try {
              await updateReminder(r.id, { done: true, taskId: newTaskId, completedAt: new Date() });
              toast.success('Lembrete convertido em tarefa!');
              await renderReminders();
            } catch (err) { console.warn('Update reminder fail:', err.message); }
          },
        });
      });
    });
  }

  document.getElementById('dash-reminders-add')?.addEventListener('click', () => {
    openReminderModal({ createReminder, onSaved: renderReminders });
  });

  // ── Notes (post-its) ────────────────────────────────────────
  async function renderNotes() {
    const list = await fetchNotes().catch(() => []);
    const el = document.getElementById('dash-notes-list');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = `<div style="color:var(--text-muted);font-size:0.75rem;padding:8px 0;text-align:center;">
        Sem anotações. Clique em <strong>+ Novo</strong> pra criar um post-it.
      </div>`;
      return;
    }
    el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px;">${
      list.slice(0, 6).map(n => `
        <div class="note-card" data-id="${escTxt(n.id)}"
          style="background:${escTxt(n.color || NOTE_COLORS[0])};color:#1F2937;
          border-radius:6px;padding:10px;width:calc(50% - 4px);min-height:80px;
          font-size:0.75rem;line-height:1.4;cursor:pointer;
          box-shadow:0 1px 3px rgba(0,0,0,0.08);position:relative;
          transition:transform 0.1s;"
          onmouseover="this.style.transform='translateY(-1px)'"
          onmouseout="this.style.transform=''">
          <div style="white-space:pre-wrap;word-break:break-word;
            display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;
            overflow:hidden;">${escTxt(n.text || '— vazio —')}</div>
          <button data-act="note-del" data-id="${escTxt(n.id)}" title="Excluir"
            style="position:absolute;top:2px;right:4px;background:none;border:none;
            cursor:pointer;color:rgba(0,0,0,0.4);font-size:0.875rem;line-height:1;
            padding:2px 4px;">×</button>
        </div>
      `).join('')
    }</div>${list.length > 6 ? `<div style="text-align:center;padding-top:6px;
      font-size:0.6875rem;color:var(--text-muted);">+${list.length-6} anotações</div>` : ''}`;

    el.querySelectorAll('.note-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.dataset.act === 'note-del') return;
        const n = list.find(x => x.id === card.dataset.id);
        if (n) openNoteModal({ note: n, updateNote, deleteNote, NOTE_COLORS, onSaved: renderNotes });
      });
    });
    el.querySelectorAll('[data-act="note-del"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Excluir esta anotação?')) return;
        try {
          await deleteNote(btn.dataset.id);
          await renderNotes();
        } catch (err) { toast.error('Erro: ' + err.message); }
      });
    });
  }

  document.getElementById('dash-notes-add')?.addEventListener('click', () => {
    openNoteModal({ note: null, createNote, NOTE_COLORS, onSaved: renderNotes });
  });

  // Render initial
  renderReminders();
  renderNotes();

  // Check due reminders → toast (one-shot per session)
  if (!window.__reminders_checked__) {
    window.__reminders_checked__ = true;
    checkDueReminders().then(due => {
      if (due.length) {
        toast.warning(`Você tem ${due.length} lembrete${due.length>1?'s':''} vencido${due.length>1?'s':''}!`,
          'Lembretes');
      }
    });
  }
}

/* ─── Modais auxiliares ─────────────────────────────────────── */

function openReminderModal({ createReminder, onSaved }) {
  import('../components/modal.js').then(({ modal }) => {
    // 4.26+ Bug fix: usar ref capturada do input (e do modal element) em vez
    // de getElementById no onClick. Causa do bug: se o user abrisse o modal
    // 2× rapidamente (debounce ausente), poderia haver 2 inputs com mesmo
    // id no DOM e getElementById retornava o errado (vazio). Solução:
    // capturar refs no escopo do MODAL atual via getElement().querySelector.
    let modalHandle = null;
    let titleInput = null;
    let dueInput = null;
    let notifyInput = null;

    modalHandle = modal.open({
      title: 'Novo lembrete',
      size: 'sm',
      content: `
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div class="form-group">
            <label class="form-label">Título *</label>
            <input type="text" class="form-input" id="rem-title" maxlength="120"
              placeholder="Ex: Confirmar voo da Maria" />
          </div>
          <div class="form-group">
            <label class="form-label">Data de vencimento</label>
            <input type="date" class="form-input" id="rem-due" />
          </div>
          <div class="form-group">
            <label style="display:flex;align-items:center;gap:8px;font-size:0.8125rem;cursor:pointer;">
              <input type="checkbox" id="rem-notify" checked />
              Notificar quando vencer
            </label>
          </div>
        </div>
      `,
      footer: [
        { label: 'Cancelar', class: 'btn-secondary', closeOnClick: true },
        {
          label: 'Criar lembrete', class: 'btn-primary', closeOnClick: false,
          onClick: async (_, { close }) => {
            // Lê SEMPRE do modal corrente (escopo isolado)
            const title  = (titleInput?.value || '').trim();
            const dueAt  = dueInput?.value || null;
            const notify = notifyInput?.checked ?? true;
            if (!title) {
              console.warn('[reminder] título vazio. titleInput:', titleInput,
                'value:', titleInput?.value);
              toast.warning('Digite um título para o lembrete.');
              titleInput?.focus();
              return;
            }
            try {
              await createReminder({ title, dueAt, notify });
              toast.success('Lembrete criado!');
              close();
              onSaved?.();
            } catch (err) { toast.error('Erro: ' + err.message); }
          },
        },
      ],
    });

    // Captura refs no escopo do modal atual (não no document) — evita
    // colisão de id se outro modal residual ainda estiver no DOM.
    setTimeout(() => {
      const root = modalHandle?.getElement?.() || document;
      titleInput  = root.querySelector('#rem-title');
      dueInput    = root.querySelector('#rem-due');
      notifyInput = root.querySelector('#rem-notify');
      titleInput?.focus();
    }, 50);
  });
}

function openNoteModal({ note, createNote, updateNote, deleteNote, NOTE_COLORS, onSaved }) {
  const isEdit = !!note;
  import('../components/modal.js').then(({ modal }) => {
    let modalHandle = null;
    let textInput  = null;
    let colorInput = null;

    modalHandle = modal.open({
      title: isEdit ? 'Editar anotação' : 'Nova anotação',
      size: 'sm',
      content: `
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div class="form-group">
            <label class="form-label">Texto</label>
            <textarea class="form-input" id="note-text" rows="6"
              placeholder="Digite sua anotação..." maxlength="2000"
              style="resize:vertical;">${escTxt(note?.text || '')}</textarea>
          </div>
          <div class="form-group">
            <label class="form-label">Cor</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${NOTE_COLORS.map(c => `
                <div class="note-color-btn" data-color="${c}" style="
                  width:32px;height:32px;border-radius:6px;background:${c};cursor:pointer;
                  border:3px solid ${(note?.color||NOTE_COLORS[0])===c?'#1F2937':'transparent'};
                  transition:all 0.15s;"></div>
              `).join('')}
            </div>
            <input type="hidden" id="note-color" value="${escTxt(note?.color || NOTE_COLORS[0])}" />
          </div>
        </div>
      `,
      footer: [
        { label: 'Cancelar', class: 'btn-secondary', closeOnClick: true },
        {
          label: isEdit ? 'Salvar' : 'Criar', class: 'btn-primary', closeOnClick: false,
          onClick: async (_, { close }) => {
            const text  = textInput?.value ?? '';
            const color = colorInput?.value || NOTE_COLORS[0];
            try {
              if (isEdit) await updateNote(note.id, { text, color });
              else        await createNote({ text, color });
              close();
              onSaved?.();
            } catch (err) { toast.error('Erro: ' + err.message); }
          },
        },
      ],
    });
    setTimeout(() => {
      // Refs no escopo do modal corrente (mesmo padrão do reminder)
      const root = modalHandle?.getElement?.() || document;
      textInput  = root.querySelector('#note-text');
      colorInput = root.querySelector('#note-color');
      root.querySelectorAll('.note-color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (colorInput) colorInput.value = btn.dataset.color;
          root.querySelectorAll('.note-color-btn').forEach(b => {
            b.style.borderColor = 'transparent';
          });
          btn.style.borderColor = '#1F2937';
        });
      });
      textInput?.focus();
    }, 50);
  });
}

function dueColor(ts, done) {
  if (done) return 'var(--text-muted)';
  const d    = ts?.toDate ? ts.toDate() : new Date(ts);
  const diff = (d - new Date()) / (1000*60*60*24);
  if (diff < 0)  return 'var(--color-danger)';
  if (diff <= 2) return 'var(--color-warning)';
  return 'var(--text-muted)';
}

function fmtShort(ts) {
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit'}).format(d);
}

function formatDate(date) {
  return new Intl.DateTimeFormat('pt-BR',{
    weekday:'long', day:'numeric', month:'long', year:'numeric'
  }).format(date);
}
