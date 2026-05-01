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

    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px;" id="dash-stats">
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

    // If master selected a specific sector in the filter, apply it
    const sectorSel = document.getElementById('dash-sector-filter')?.value || null;
    const visibleTasks = sectorSel ? tasks.filter(t => !t.sector || t.sector === sectorSel) : tasks;

    const myTasks       = visibleTasks.filter(t => t.assignees?.includes(uid));
    const myObserving   = visibleTasks.filter(t => (t.observers||[]).includes(uid) && !(t.assignees||[]).includes(uid));
    const myActive      = myTasks.filter(t => !['done','cancelled'].includes(t.status));
    const myPartnerships = myActive.filter(t => t.isPartnership);
    const openTasks     = visibleTasks.filter(t => !['done','cancelled'].includes(t.status));
    const inProgress    = visibleTasks.filter(t => t.status === 'in_progress');
    const now           = new Date();
    const doneToday     = tasks.filter(t => {
      if (!t.completedAt) return false;
      const d = t.completedAt?.toDate ? t.completedAt.toDate() : new Date(t.completedAt);
      return d.toDateString() === now.toDateString();
    });

    // ── Stats ─────────────────────────────────────────────
    const $stats = document.getElementById('dash-stats');
    if (!$stats) return; // user navigated away
    $stats.innerHTML = `
      ${statCard('Minhas Abertas', myActive.length, '📋', 'rgba(212,168,67,0.12)', 'var(--brand-gold)', '#tasks')}
      ${statCard('Em Andamento', inProgress.length, '▶', 'rgba(56,189,248,0.12)', 'var(--role-manager)', '#kanban')}
      ${statCard('Concluídas Hoje', doneToday.length, '✓', 'var(--color-success-bg)', 'var(--color-success)', '#tasks')}
      ${statCard('Observando', myObserving.length, '🔭', 'rgba(56,189,248,0.10)', 'var(--color-info,#38BDF8)', '#tasks')}
      ${myPartnerships.length ? statCard('Parcerias ativas', myPartnerships.length, '🤝', 'rgba(212,168,67,0.10)', 'var(--brand-gold)', '#tasks') : ''}
      ${statCard('Projetos Ativos', projects.filter(p=>p.status==='active'||p.status==='always_on').length, '◈', 'rgba(167,139,250,0.12)', 'var(--role-admin)', '#projects')}
    `;

    const overdue = myTasks.filter(t => {
      if (!t.dueDate || t.status === 'done') return false;
      const d = t.dueDate?.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
      return d < now;
    });

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
                const wsTasks = tasks.filter(t => t.workspaceId === ws.id);
                const wsDone  = wsTasks.filter(t => t.status==='done').length;
                return `<div style="display:flex;align-items:center;gap:10px;padding:4px 0;">
                  <div style="width:28px;height:28px;border-radius:var(--radius-sm);flex-shrink:0;
                    background:${ws.color||'#D4A843'}22;color:${ws.color||'#D4A843'};
                    display:flex;align-items:center;justify-content:center;font-size:0.875rem;">
                    ${esc(ws.icon||'◈')}
                  </div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:0.8125rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(ws.name)}</div>
                    <div style="font-size:0.75rem;color:var(--text-muted);">${wsTasks.length} tarefa${wsTasks.length!==1?'s':''} · ${wsDone} concluídas</div>
                  </div>
                </div>`;
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
                const gTasks = tasks.filter(t => {
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

        <!-- Projects -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">📦 Projetos</div>
            <a href="#projects" class="btn btn-ghost btn-sm">Ver →</a>
          </div>
          <div class="card-body" style="padding:12px 16px; display:flex; flex-direction:column; gap:10px;">
            ${projects.length === 0
              ? `<p class="text-sm text-muted">Nenhum projeto criado.</p>`
              : projects.slice(0,4).map(p => {
                  const pt  = tasks.filter(t=>t.projectId===p.id);
                  const pd  = pt.filter(t=>t.status==='done').length;
                  const pct = pt.length ? Math.round(pd/pt.length*100) : 0;
                  return `<div style="cursor:pointer;" onclick="location.hash='#projects'">
                    <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                      <span style="font-size:0.8125rem;font-weight:500;color:var(--text-primary);">${p.icon} ${esc(p.name)}</span>
                      <span style="font-size:0.75rem;color:var(--text-muted);">${pct}%</span>
                    </div>
                    <div class="progress" style="height:4px;">
                      <div class="progress-bar" style="width:${pct}%;background:${p.color||'var(--brand-gold)'};"></div>
                    </div>
                  </div>`;
                }).join('')
            }
          </div>
        </div>

        <!-- Status distribution -->
        <div class="card">
          <div class="card-header"><div class="card-title">📊 Distribuição</div></div>
          <div class="card-body" style="padding:12px 16px;display:flex;flex-direction:column;gap:8px;">
            ${[
              {value:'todo',        label:'A Fazer',      color:'#38BDF8'},
              {value:'in_progress', label:'Em Andamento', color:'#F59E0B'},
              {value:'review',      label:'Em Revisão',   color:'#A78BFA'},
              {value:'done',        label:'Concluídas',   color:'#22C55E'},
            ].map(s => {
              const cnt = tasks.filter(t=>t.status===s.value).length;
              const pct = tasks.length ? Math.round(cnt/tasks.length*100) : 0;
              return `<div>
                <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                  <span style="font-size:0.8125rem;color:var(--text-secondary);">${s.label}</span>
                  <span style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);">${cnt}</span>
                </div>
                <div class="progress" style="height:5px;">
                  <div class="progress-bar" style="width:${pct}%;background:${s.color};"></div>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>
    `;

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
