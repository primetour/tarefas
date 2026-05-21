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
  // 4.49.11+ Guard granular: dashboard_home_view (antes era sem guard).
  // Roles sem essa perm caem em "Acesso restrito" com sugestão de outro módulo.
  if (!store.canViewHomeDashboard()) {
    container.innerHTML = `<div class="empty-state" style="min-height:50vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Sem acesso ao painel inicial</div>
      <p class="text-sm text-muted mt-2">Seu role não tem permissão pra ver este dashboard.
        Tente <a href="#tasks">Tarefas</a> ou <a href="#portal-tips">Portal de Dicas</a>.</p>
    </div>`;
    return;
  }
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

    const [tasks, projects, pendingReqs, allGoals, myAbsences, allAbsences] = await Promise.all([
      fetchTasks().catch(() => []),
      fetchProjects().catch(() => []),
      countPendingRequests().catch(() => 0),
      fetchGoals().catch(() => []),
      fetchUserAbsences(uid).catch(() => []),
      isManager ? fetchAllAbsences({ startDate: todayStart, endDate: in30Days }).catch(() => []) : Promise.resolve([]),
    ]);

    // 4.29+ — Bug fix: card "Minhas Metas" mostrava TODAS as metas em vez
    // de filtrar pelo vínculo do user. Causa: fetchGoals() não aceita filtro
    // (o parâmetro `{type:'personal'}` era ignorado).
    // Fix: filtrar client-side por responsavelIds (formato novo) ou
    // responsavelId (legado) — apenas metas onde o user é responsável.
    const { getResponsavelIds } = await import('../services/goals.js');
    const myGoals = allGoals.filter(g => {
      const ids = getResponsavelIds(g);
      return ids.includes(uid);
    });

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

    // 4.49.12+ Cards de "Acesso rápido aos dashboards" — renderiza
    // chips clicáveis apenas pros dashboards executivos que o user pode ver.
    // Analista (só home) não vê esta seção; coord+ vê todos os disponíveis.
    const dashboardShortcuts = [];
    if (store.canViewProductivityDashboard()) {
      dashboardShortcuts.push({ icon: '📊', label: 'Produtividade',   route: '#dashboards',        bg: 'rgba(212,168,67,0.10)',  color: 'var(--brand-gold)' });
    }
    if (store.canViewPortalDashboard()) {
      dashboardShortcuts.push({ icon: '🌍', label: 'Portal de Dicas', route: '#portal-dashboard',  bg: 'rgba(56,189,248,0.10)',  color: 'var(--role-manager)' });
    }
    if (store.canViewRoteirosDashboard()) {
      dashboardShortcuts.push({ icon: '✈',  label: 'Roteiros',        route: '#roteiro-dashboard', bg: 'rgba(167,139,250,0.10)', color: '#A78BFA' });
    }
    if (store.canViewCsatDashboard()) {
      dashboardShortcuts.push({ icon: '💬', label: 'CSAT',            route: '#csat',              bg: 'rgba(34,197,94,0.10)',   color: 'var(--color-success)' });
    }
    if (store.isMaster() || store.can('ai_dashboard_view')) {
      dashboardShortcuts.push({ icon: '◈',  label: 'IA Hub',          route: '#ai-hub',            bg: 'rgba(236,72,153,0.10)',  color: '#EC4899' });
    }
    if (store.isMaster() || store.can('site_audit_view')) {
      dashboardShortcuts.push({ icon: '⚡', label: 'Site Audit',      route: '#ga-performance',    bg: 'rgba(245,158,11,0.10)',  color: '#F59E0B' });
    }
    const dashboardShortcutsHTML = dashboardShortcuts.length ? `
      ${sectionLabel('🚀 Acesso rápido aos dashboards')}
      <div class="dash-stats-row">
        ${dashboardShortcuts.map(s => `
          <a href="${s.route}" class="stat-card"
             style="background:${s.bg};text-decoration:none;display:flex;align-items:center;gap:10px;padding:14px 16px;
                    border:1px solid ${s.color}22;border-radius:var(--radius-md);cursor:pointer;transition:transform 0.1s;"
             onmouseover="this.style.transform='translateY(-2px)'"
             onmouseout="this.style.transform=''">
            <span style="font-size:1.6rem;">${s.icon}</span>
            <div style="display:flex;flex-direction:column;gap:1px;">
              <span style="font-size:0.6875rem;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:var(--text-muted);">DASHBOARD</span>
              <span style="font-size:0.95rem;font-weight:600;color:${s.color};">${s.label}</span>
            </div>
          </a>
        `).join('')}
      </div>
    ` : '';

    $stats.innerHTML = `
      ${sectionLabel('🎯 Meu desempenho')}
      ${cardsRow(myCards)}
      ${teamCards ? sectionLabel(sectorSel ? `🏢 Setor ${sectorSel}` : '🏢 Equipe / Setor') : ''}
      ${teamCards ? cardsRow(teamCards) : ''}
      ${dashboardShortcutsHTML}
    `;

    // overdue mantido por compat — myOverdue já calculado acima
    const overdue = myOverdue;

    // ── Main grid ─────────────────────────────────────────
    const $main = document.getElementById('dash-main');
    if (!$main) return; // user navigated away
    $main.innerHTML = `
      <!-- LEFT COLUMN: Meu Calendário (em cima) + Minhas Tarefas (4.49.17+) -->
      <div style="display:flex;flex-direction:column;gap:16px;">

      <!-- 4.49.17+ Meu Calendário NO TOPO (era embaixo de Minhas Tarefas).
           Agenda visível + mini-mês sempre aberto. Tooltip nas células
           mostra os títulos das tarefas. -->
      <div class="card" id="dash-mini-cal-card">
        <div class="card-header">
          <div>
            <div class="card-title">📅 Meu Calendário</div>
            <div class="card-subtitle" id="dash-mini-cal-summary"
              style="font-size:0.75rem;color:var(--text-muted);"></div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            <button class="btn btn-ghost btn-sm" onclick="location.hash='#calendar'"
              style="padding:4px 10px;font-size:0.75rem;">Agenda completa →</button>
          </div>
        </div>
        <div class="card-body" style="padding:0;">

          <!-- AGENDA: próximos 14 dias agrupados por data, com título da tarefa -->
          <div id="dash-mini-cal-upcoming" style="padding:8px 16px 4px;"></div>

          <!-- MINI-MÊS: sempre aberto (4.49.17+ removido toggle) -->
          <div style="border-top:1px solid var(--border-subtle);padding:10px 16px 14px;
            background:var(--bg-surface);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <span style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;
                letter-spacing:0.08em;color:var(--text-muted);">
                Visão do mês — <span id="dash-mini-cal-subtitle" style="text-transform:none;letter-spacing:0;color:var(--text-secondary);">…</span>
              </span>
              <div id="dash-cal-nav" style="display:flex;gap:4px;align-items:center;">
                <button class="btn btn-ghost btn-sm" id="dash-cal-prev" title="Mês anterior"
                  style="padding:2px 8px;font-size:0.75rem;">◀</button>
                <button class="btn btn-ghost btn-sm" id="dash-cal-today"
                  style="padding:2px 8px;font-size:0.6875rem;">Hoje</button>
                <button class="btn btn-ghost btn-sm" id="dash-cal-next" title="Próximo mês"
                  style="padding:2px 8px;font-size:0.75rem;">▶</button>
              </div>
            </div>
            <div id="dash-mini-cal-grid"></div>
            <div id="dash-mini-cal-detail" style="margin-top:8px;"></div>
          </div>
        </div>
      </div>

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

      </div>
      <!-- /LEFT COLUMN -->

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

    // 4.49.15+ Mount Meu Calendário (mini-mês com tarefas do user)
    mountMiniCalendar(myTasks, (task) =>
      openTaskModal({ taskData: task, onSave: () => renderDashboard(container) }));

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

/* ─── 4.49.15+ Mini-Calendário (Meu Painel) ───────────────────
   Mini-grid mensal 6×7 das tarefas do user (assignees.includes uid)
   ancoradas em dueDate. Cada dia mostra dots (1-3) com cor por status,
   ou número de tarefas se > 3. Click no dia abre lista inline com as
   tarefas daquele dia + link pra abrir a tarefa no modal padrão.

   Performance: tudo client-side em cima de myTasks (já fetchado pelo
   render principal). Render do mês é O(n) tarefas × O(42) células.
*/
function mountMiniCalendar(myTasks, onTaskClick) {
  const grid       = document.getElementById('dash-mini-cal-grid');
  const subtitle   = document.getElementById('dash-mini-cal-subtitle');
  const summary    = document.getElementById('dash-mini-cal-summary');
  const upcomingEl = document.getElementById('dash-mini-cal-upcoming');
  const detailEl   = document.getElementById('dash-mini-cal-detail');
  if (!grid) return;

  // Cursor inicial: mês corrente. Mantemos referência ao "primeiro dia do mês"
  // pra fugir de bugs de DST/timezone com dias 28-31.
  const today = new Date(); today.setHours(0,0,0,0);
  let cursor  = new Date(today.getFullYear(), today.getMonth(), 1);
  let selectedDayKey = null; // YYYY-MM-DD

  const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const DOW    = ['D','S','T','Q','Q','S','S']; // dom-sáb (estilo pt-BR compacto)
  const WEEKDAYS = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const fmtTime = (d) => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

  // Indexa tarefas por dayKey do dueDate — só ativas (não cancelled).
  // done conta também: user pode querer rever o que entregou no dia.
  const tasksByDay = (() => {
    const m = new Map();
    for (const t of myTasks) {
      if (!t.dueDate || t.status === 'cancelled') continue;
      const d = t.dueDate?.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
      if (isNaN(d.getTime())) continue;
      const key = dayKey(d);
      if (!m.has(key)) m.set(key, []);
      m.get(key).push({ task: t, dueObj: d });
    }
    // ordena cada dia por horário
    for (const arr of m.values()) {
      arr.sort((a,b) => a.dueObj - b.dueObj);
    }
    return m;
  })();

  // Cor do dot por status — alinhada ao resto do painel
  const STATUS_COLOR = {
    not_started: '#38BDF8',
    in_progress: '#F59E0B',
    review:      '#A78BFA',
    rework:      '#F97316',
    done:        '#22C55E',
  };

  function renderMonth() {
    const year  = cursor.getFullYear();
    const month = cursor.getMonth();
    if (subtitle) subtitle.textContent = `${MONTHS[month]} ${year}`;

    // Determina o range a renderizar: do domingo da semana do dia 1
    // até completar 42 células (6 semanas) — padrão clássico de calendar.
    const firstOfMonth = new Date(year, month, 1);
    const startDay     = new Date(firstOfMonth);
    startDay.setDate(startDay.getDate() - firstOfMonth.getDay()); // back to Sun

    // Header com dias da semana
    let html = `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:6px;">`;
    for (const d of DOW) {
      html += `<div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;
        letter-spacing:0.05em;color:var(--text-muted);text-align:center;padding:2px 0;">${d}</div>`;
    }
    html += `</div>`;

    // Cells
    html += `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">`;
    for (let i = 0; i < 42; i++) {
      const d = new Date(startDay);
      d.setDate(startDay.getDate() + i);
      const isOtherMonth = d.getMonth() !== month;
      const isToday      = d.getTime() === today.getTime();
      const isPast       = d < today;
      const key          = dayKey(d);
      const dayTasks     = tasksByDay.get(key) || [];
      const isSelected   = key === selectedDayKey;

      // Visual:
      //   - bg sutil hoje (gold), fade pra outros meses
      //   - borda dourada se selecionado
      //   - dots empilhados pra cada tarefa (até 3); se >3 mostra "+N"
      const cellBg =
        isSelected ? 'rgba(212,168,67,0.18)' :
        isToday    ? 'rgba(212,168,67,0.10)' :
                     'transparent';
      const cellBorder = isSelected ? '1px solid var(--brand-gold)' : '1px solid transparent';
      const numColor =
        isOtherMonth ? 'var(--text-muted)' :
        isToday      ? 'var(--brand-gold)' :
        isPast       ? 'var(--text-secondary)' :
                       'var(--text-primary)';
      const numWeight = isToday ? '700' : '500';

      // Renderiza até 3 dots; se houver mais, dot final vira "+N"
      let dotsHTML = '';
      if (dayTasks.length) {
        const limit = Math.min(3, dayTasks.length);
        for (let j = 0; j < limit; j++) {
          const t = dayTasks[j].task;
          const c = STATUS_COLOR[t.status] || 'var(--text-muted)';
          dotsHTML += `<span style="width:4px;height:4px;border-radius:50%;background:${c};"></span>`;
        }
        if (dayTasks.length > 3) {
          dotsHTML += `<span style="font-size:0.5625rem;color:var(--text-muted);font-weight:600;line-height:1;margin-left:2px;">+${dayTasks.length-3}</span>`;
        }
      }

      // 4.49.17+ Tooltip nativo (title) com os títulos das tarefas do dia.
      // Mostra até 5 títulos, com horário se houver; se passar de 5, "+N".
      let tooltipTitle = '';
      if (dayTasks.length) {
        const previews = dayTasks.slice(0, 5).map(({task: t, dueObj}) => {
          const hh = (dueObj.getHours() || dueObj.getMinutes())
            ? `${String(dueObj.getHours()).padStart(2,'0')}:${String(dueObj.getMinutes()).padStart(2,'0')} `
            : '';
          return `• ${hh}${(t.title || '').replace(/"/g,'')}`;
        });
        const header = `${dayTasks.length} tarefa${dayTasks.length!==1?'s':''} — ${d.getDate()}/${String(d.getMonth()+1).padStart(2,'0')}`;
        const extra  = dayTasks.length > 5 ? `\n+${dayTasks.length-5} mais` : '';
        tooltipTitle = `${header}\n${previews.join('\n')}${extra}`;
      }

      const cursorStyle = dayTasks.length ? 'cursor:pointer;' : 'cursor:default;';
      html += `<div class="dash-cal-cell" data-day-key="${key}"
        style="aspect-ratio:1;min-height:32px;border-radius:6px;
          background:${cellBg};border:${cellBorder};
          display:flex;flex-direction:column;align-items:center;justify-content:space-between;
          padding:3px 2px;${cursorStyle}transition:background 0.12s;position:relative;"
        ${tooltipTitle ? `title="${esc(tooltipTitle)}"` : ''}
        onmouseover="if(${dayTasks.length}) this.style.background='rgba(212,168,67,0.10)'"
        onmouseout="this.style.background='${cellBg}'">
        <span style="font-size:0.6875rem;font-weight:${numWeight};color:${numColor};line-height:1.1;">
          ${d.getDate()}
        </span>
        <div style="display:flex;align-items:center;gap:2px;min-height:6px;">${dotsHTML}</div>
      </div>`;
    }
    html += `</div>`;

    // Legenda — discreta
    html += `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;font-size:0.625rem;color:var(--text-muted);">
      ${Object.entries({not_started:'A fazer',in_progress:'Em andamento',review:'Revisão',rework:'Retrabalho',done:'Concluída'})
        .map(([k,l]) => `<span style="display:inline-flex;align-items:center;gap:4px;">
          <span style="width:6px;height:6px;border-radius:50%;background:${STATUS_COLOR[k]};"></span>${l}
        </span>`).join('')}
    </div>`;

    grid.innerHTML = html;

    // Wire clicks: toggle detail
    grid.querySelectorAll('.dash-cal-cell').forEach(cell => {
      const key = cell.dataset.dayKey;
      const list = tasksByDay.get(key) || [];
      if (!list.length) return;
      cell.addEventListener('click', () => {
        selectedDayKey = (selectedDayKey === key) ? null : key;
        renderMonth();
        renderDetail();
      });
    });
  }

  function renderDetail() {
    if (!detailEl) return;
    if (!selectedDayKey) { detailEl.innerHTML = ''; return; }
    const list = tasksByDay.get(selectedDayKey) || [];
    if (!list.length) { detailEl.innerHTML = ''; return; }

    // Header do detalhe: data legível + contador
    const [y,m,d] = selectedDayKey.split('-').map(Number);
    const dateObj = new Date(y, m-1, d);
    const dateLabel = dateObj.toLocaleDateString('pt-BR', {
      weekday:'long', day:'2-digit', month:'long'
    });

    detailEl.innerHTML = `
      <div style="border-top:1px solid var(--border-subtle);padding-top:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <div style="font-size:0.75rem;font-weight:600;color:var(--text-secondary);text-transform:capitalize;">
            ${esc(dateLabel)} · ${list.length} tarefa${list.length!==1?'s':''}
          </div>
          <button id="dash-cal-clear" style="background:none;border:none;cursor:pointer;
            color:var(--text-muted);font-size:0.6875rem;padding:2px 6px;">Fechar</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          ${list.map(({task: t, dueObj}) => {
            const c = STATUS_COLOR[t.status] || 'var(--text-muted)';
            const stLabel = STATUS_MAP[t.status]?.label || t.status;
            const hasTime = dueObj.getHours() || dueObj.getMinutes();
            return `<div class="dash-cal-task-row" data-tid="${esc(t.id)}"
              style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;
                background:var(--bg-card);cursor:pointer;font-size:0.8125rem;
                transition:background 0.12s;"
              onmouseover="this.style.background='var(--bg-hover, rgba(212,168,67,0.06))'"
              onmouseout="this.style.background='var(--bg-card)'">
              <span style="width:6px;height:6px;border-radius:50%;background:${c};flex-shrink:0;"></span>
              ${hasTime ? `<span style="font-size:0.6875rem;color:var(--text-muted);font-variant-numeric:tabular-nums;flex-shrink:0;">${fmtTime(dueObj)}</span>` : ''}
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary);">
                ${esc(t.title)}
              </span>
              <span style="font-size:0.625rem;color:var(--text-muted);white-space:nowrap;">
                ${esc(stLabel)}
              </span>
            </div>`;
          }).join('')}
        </div>
      </div>`;

    detailEl.querySelector('#dash-cal-clear')?.addEventListener('click', () => {
      selectedDayKey = null;
      renderMonth();
      renderDetail();
    });
    detailEl.querySelectorAll('.dash-cal-task-row[data-tid]').forEach(row => {
      row.addEventListener('click', () => {
        const t = myTasks.find(x => x.id === row.dataset.tid);
        if (t) onTaskClick?.(t);
      });
    });
  }

  /* ─── Agenda dos próximos dias ───────────────────────────────
     v4.49.16+ — Mostra próximos 14 dias com TÍTULO de cada tarefa
     pra user saber na hora o que tem (não só dot). Agrupa por dia,
     prioriza HOJE/AMANHÃ com header destacado. */
  function renderUpcoming() {
    if (!upcomingEl) return;
    const HORIZON_DAYS = 14;
    const horizonEnd = new Date(today);
    horizonEnd.setDate(today.getDate() + HORIZON_DAYS);

    // Pega tarefas atrasadas (não-done) + próximas 14 dias
    const overdueList = [];
    const upcomingByDay = []; // [{date, key, items}]
    for (let i = 0; i < HORIZON_DAYS; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const k = dayKey(d);
      const items = (tasksByDay.get(k) || []).filter(({task}) => task.status !== 'done');
      if (items.length) upcomingByDay.push({ date: d, key: k, items });
    }
    // Atrasadas: anteriores a hoje, status != done
    for (const [k, arr] of tasksByDay.entries()) {
      const [y,m,d] = k.split('-').map(Number);
      const dt = new Date(y, m-1, d);
      if (dt < today) {
        for (const entry of arr) {
          if (entry.task.status !== 'done') overdueList.push(entry);
        }
      }
    }
    overdueList.sort((a,b) => a.dueObj - b.dueObj);

    // Resumo no header
    const totalUpcoming = upcomingByDay.reduce((sum, d) => sum + d.items.length, 0);
    const todayCount    = upcomingByDay.find(d => d.key === dayKey(today))?.items.length || 0;
    if (summary) {
      const parts = [];
      if (todayCount)         parts.push(`<strong style="color:var(--brand-gold);">${todayCount} hoje</strong>`);
      if (overdueList.length) parts.push(`<strong style="color:var(--color-danger);">${overdueList.length} em atraso</strong>`);
      if (totalUpcoming - todayCount > 0)
        parts.push(`${totalUpcoming - todayCount} próximos`);
      summary.innerHTML = parts.length ? parts.join(' · ') : 'Sem compromissos nos próximos 14 dias';
    }

    // Render
    if (!overdueList.length && !upcomingByDay.length) {
      upcomingEl.innerHTML = `
        <div style="padding:24px 8px;text-align:center;color:var(--text-muted);font-size:0.8125rem;">
          🎉 Sem tarefas com data marcada nos próximos 14 dias.
          <div style="font-size:0.6875rem;margin-top:6px;">
            Tarefas com <em>data de vencimento</em> aparecem aqui.
          </div>
        </div>`;
      return;
    }

    const taskRow = ({task: t, dueObj}, opts={}) => {
      const c = STATUS_COLOR[t.status] || 'var(--text-muted)';
      const stLabel = STATUS_MAP[t.status]?.label || t.status;
      const hasTime = dueObj.getHours() || dueObj.getMinutes();
      const overdue = opts.overdue;
      const accent  = overdue ? '#EF4444' : c;
      return `<div class="dash-up-task" data-tid="${esc(t.id)}"
        style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;
          background:var(--bg-surface);cursor:pointer;font-size:0.8125rem;
          border-left:3px solid ${accent};transition:background 0.12s;"
        onmouseover="this.style.background='rgba(212,168,67,0.08)'"
        onmouseout="this.style.background='var(--bg-surface)'">
        ${hasTime ? `<span style="font-size:0.6875rem;color:var(--text-muted);font-weight:600;
          font-variant-numeric:tabular-nums;flex-shrink:0;min-width:36px;">${fmtTime(dueObj)}</span>` : ''}
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary);">
          ${esc(t.title)}
        </span>
        <span style="font-size:0.625rem;color:var(--text-muted);white-space:nowrap;
          padding:1px 6px;border-radius:var(--radius-full);background:var(--bg-card);">
          ${esc(stLabel)}
        </span>
      </div>`;
    };

    const dayHeader = (date, key, count) => {
      const diff = Math.round((date - today) / 86400000);
      let label;
      if (diff === 0)      label = `<strong style="color:var(--brand-gold);">Hoje</strong>`;
      else if (diff === 1) label = `<strong>Amanhã</strong>`;
      else if (diff < 7)   label = `<strong>${WEEKDAYS[date.getDay()]}</strong>`;
      else                 label = `<strong>${WEEKDAYS[date.getDay()].slice(0,3)}, ${date.getDate()}/${String(date.getMonth()+1).padStart(2,'0')}</strong>`;

      const dateSuffix = (diff > 0 && diff < 7)
        ? ` <span style="color:var(--text-muted);font-weight:400;">${date.getDate()}/${String(date.getMonth()+1).padStart(2,'0')}</span>`
        : '';

      return `<div style="display:flex;align-items:center;justify-content:space-between;
        margin:10px 0 4px;font-size:0.75rem;color:var(--text-secondary);">
        <span>${label}${dateSuffix}</span>
        <span style="font-size:0.6875rem;color:var(--text-muted);">${count} tarefa${count!==1?'s':''}</span>
      </div>`;
    };

    let html = '';

    // Atrasadas — sempre no topo se houver
    if (overdueList.length) {
      html += `<div style="display:flex;align-items:center;justify-content:space-between;
        margin:6px 0 4px;font-size:0.75rem;">
        <span style="color:var(--color-danger);font-weight:600;">⚠ Em atraso</span>
        <span style="font-size:0.6875rem;color:var(--text-muted);">${overdueList.length} tarefa${overdueList.length!==1?'s':''}</span>
      </div>`;
      html += `<div style="display:flex;flex-direction:column;gap:4px;">`;
      html += overdueList.slice(0, 5).map(e => taskRow(e, {overdue:true})).join('');
      if (overdueList.length > 5) {
        html += `<a href="#tasks?assignee=me&status=overdue" style="font-size:0.6875rem;
          color:var(--brand-gold);text-decoration:none;padding:4px 0;text-align:center;">
          + ${overdueList.length-5} atrasadas →
        </a>`;
      }
      html += `</div>`;
    }

    // Próximos dias com tarefas
    for (const day of upcomingByDay) {
      html += dayHeader(day.date, day.key, day.items.length);
      html += `<div style="display:flex;flex-direction:column;gap:4px;">`;
      html += day.items.map(e => taskRow(e)).join('');
      html += `</div>`;
    }

    upcomingEl.innerHTML = html;

    upcomingEl.querySelectorAll('.dash-up-task[data-tid]').forEach(row => {
      row.addEventListener('click', () => {
        const t = myTasks.find(x => x.id === row.dataset.tid);
        if (t) onTaskClick?.(t);
      });
    });
  }

  // Wire nav buttons (uma vez — botões são reescritos pelo card mas só uma
  // instância do mount roda por render do dashboard).
  document.getElementById('dash-cal-prev')?.addEventListener('click', () => {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    selectedDayKey = null;
    renderMonth(); renderDetail();
  });
  document.getElementById('dash-cal-next')?.addEventListener('click', () => {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    selectedDayKey = null;
    renderMonth(); renderDetail();
  });
  document.getElementById('dash-cal-today')?.addEventListener('click', () => {
    cursor = new Date(today.getFullYear(), today.getMonth(), 1);
    selectedDayKey = dayKey(today);
    renderMonth(); renderDetail();
  });

  // 4.49.17+ Inicial: agenda + mini-mês ambos visíveis (toggle removido)
  renderUpcoming();
  renderMonth();
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

  // 4.40.14+ .onclick (não addEventListener) — idempotente: se mountUserPanels
  // rodar 2× no mesmo nó (race em renderDashboard duplo), handler é
  // sobrescrito em vez de empilhado.
  const remBtn = document.getElementById('dash-reminders-add');
  if (remBtn) remBtn.onclick = () => {
    openReminderModal({ createReminder, onSaved: renderReminders });
  };

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

  // 4.40.14+ idempotente (vide remBtn acima)
  const noteBtn = document.getElementById('dash-notes-add');
  if (noteBtn) noteBtn.onclick = () => {
    openNoteModal({ note: null, createNote, NOTE_COLORS, onSaved: renderNotes });
  };

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
    // 4.40.14+ dedupeKey impede empilhamento se botão tiver listener
    // duplicado (ex: dashboard re-renderizado bind handler 2×). Antes:
    // 3 cliques → 6 backdrops (comprovado via Chrome MCP).
    let modalHandle = null;
    let titleInput = null;
    let dueInput = null;
    let notifyInput = null;

    modalHandle = modal.open({
      dedupeKey: 'reminder-create',
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
      // 4.40.14+ dedupeKey por nota (edit) ou 'create' (nova). Previne
      // empilhamento por listener duplicado no botão.
      dedupeKey: isEdit ? `note-edit-${note.id}` : 'note-create',
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
