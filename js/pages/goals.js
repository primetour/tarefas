/**
 * PRIMETOUR — Goals Page
 * Metas individuais e do núcleo com progresso automático por filtros
 *
 * RACIONAL:
 * Meta → define donos + critérios (período, núcleo, tipo de tarefa, assignees)
 * Progresso → calculado automaticamente: tarefas concluídas que atendem os critérios
 * Não é necessário "vincular tarefa a meta" — basta criar a meta com os filtros corretos
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import {
  fetchGoals, createGoal, updateGoal, deleteGoal,
  calcGoalProgress, recalcGoalProgress,
  GOAL_TYPES, GOAL_PERIODS,
} from '../services/goals.js';
import { fetchTasks, NUCLEOS } from '../services/tasks.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}).format(d);
}
function toISO(ts) {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toISOString().slice(0,10);
}

let allGoals = [];
let allTasks = [];
let activeTab = 'personal';

/* ─── Render ─────────────────────────────────────────────── */
export async function renderGoals(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Metas</h1>
        <p class="page-subtitle">Acompanhe metas individuais e do núcleo</p>
      </div>
      <div class="page-header-actions" style="gap:8px;">
        ${(() => {
          const sectors = store.getVisibleSectors();
          if (sectors?.length === 1) return `<span style="font-size:0.8125rem;padding:5px 10px;border-radius:var(--radius-full);background:rgba(212,168,67,.1);color:var(--brand-gold);border:1px solid rgba(212,168,67,.3);">🏢 ${sectors[0]}</span>`;
          return '';
        })()}
        <button class="btn btn-secondary btn-sm" id="goal-export-xls">↓ XLS</button>
        <button class="btn btn-secondary btn-sm" id="goal-export-pdf">↓ PDF</button>
        <button class="btn btn-primary" id="new-goal-btn">+ Nova Meta</button>
      </div>
    </div>

    <!-- Explicação do racional -->
    <div style="display:flex;align-items:flex-start;gap:12px;
      background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);
      border-radius:var(--radius-md);padding:12px 16px;margin-bottom:20px;
      font-size:0.8125rem;color:var(--text-secondary);line-height:1.6;">
      <span style="font-size:1rem;flex-shrink:0;">ℹ</span>
      <span>
        Crie uma meta com <strong>critérios de progresso</strong> (período, núcleo, tipo de tarefa).
        O sistema conta automaticamente as tarefas concluídas que se encaixam nesses critérios.
        Clique em <strong>↺ Recalcular</strong> para atualizar o progresso a qualquer momento.
      </span>
    </div>

    <!-- Search + status filter -->
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
      <input type="text" id="goal-search" class="portal-field"
        placeholder="Buscar meta…" style="flex:1;min-width:180px;font-size:0.875rem;">
      <select id="goal-status-filter" class="filter-select" style="min-width:150px;">
        <option value="">Todos os status</option>
        <option value="on_track">No prazo</option>
        <option value="at_risk">Em risco</option>
        <option value="behind">Atrasada</option>
        <option value="completed">Concluída</option>
      </select>
    </div>

    <!-- Tabs -->
    <div style="display:flex;gap:0;margin-bottom:24px;border-bottom:1px solid var(--border-subtle);">
      ${GOAL_TYPES.map(t => `
        <button class="goal-tab-btn" data-tab="${t.value}"
          style="padding:8px 18px;border:none;background:none;cursor:pointer;font-size:0.875rem;
          color:${activeTab===t.value?'var(--brand-gold)':'var(--text-muted)'};
          border-bottom:2px solid ${activeTab===t.value?'var(--brand-gold)':'transparent'};
          transition:all 0.15s;">
          ${t.icon} ${t.label}
        </button>
      `).join('')}
    </div>

    <div id="goals-content">
      ${[0,1].map(()=>'<div class="card skeleton" style="height:140px;margin-bottom:12px;"></div>').join('')}
    </div>
  `;

  document.getElementById('new-goal-btn')?.addEventListener('click', () => openGoalModal());

  let goalSearchQ = '';
  let goalStatusF = '';

  document.getElementById('goal-search')?.addEventListener('input', e => {
    goalSearchQ = e.target.value.toLowerCase();
    renderGoalsList(goalSearchQ, goalStatusF);
  });
  document.getElementById('goal-status-filter')?.addEventListener('change', e => {
    goalStatusF = e.target.value;
    renderGoalsList(goalSearchQ, goalStatusF);
  });
  document.getElementById('goal-export-xls')?.addEventListener('click', () => exportGoalsXls());
  document.getElementById('goal-export-pdf')?.addEventListener('click', () => exportGoalsPdf());

  container.querySelectorAll('.goal-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      container.querySelectorAll('.goal-tab-btn').forEach(b => {
        b.style.color        = b.dataset.tab===activeTab ? 'var(--brand-gold)' : 'var(--text-muted)';
        b.style.borderBottom = `2px solid ${b.dataset.tab===activeTab ? 'var(--brand-gold)' : 'transparent'}`;
      });
      loadAndRender();
    });
  });

  await loadAndRender();
}

async function loadAndRender() {
  try {
    [allGoals, allTasks] = await Promise.all([
      fetchGoals({ type: activeTab }).catch(() => []),
      fetchTasks().catch(() => []),
    ]);
    // Filter goals by visible sectors
    const visibleSectors = store.getVisibleSectors();
    if (visibleSectors !== null && visibleSectors.length > 0) {
      allGoals = allGoals.filter(g =>
        !g.sector || visibleSectors.includes(g.sector)
      );
    }
    // Calcular progresso local (sem salvar) para exibição
    allGoals = allGoals.map(g => {
      const { current, progress } = calcGoalProgress(g, allTasks);
      return { ...g, current, progress };
    });
    renderGoalsList();
  } catch(e) {
    toast.error('Erro ao carregar metas: ' + e.message);
  }
}

function renderGoalsList(searchQ = '', statusF = '') {
  const el = document.getElementById('goals-content');
  if (!el) return;

  const filtered = allGoals.filter(g => g.type === activeTab);

  if (!filtered.length) {
    el.innerHTML = `
      <div class="empty-state" style="min-height:35vh;">
        <div class="empty-state-icon">${GOAL_TYPES.find(t=>t.value===activeTab)?.icon||'◉'}</div>
        <div class="empty-state-title">Nenhuma meta ${GOAL_TYPES.find(t=>t.value===activeTab)?.label?.toLowerCase()||''}</div>
        <p class="text-sm text-muted">Crie uma meta e defina os critérios de progresso.</p>
        <button class="btn btn-primary mt-4" id="empty-new-goal">+ Nova Meta</button>
      </div>`;
    document.getElementById('empty-new-goal')?.addEventListener('click', () => openGoalModal());
    return;
  }

  el.innerHTML = filtered.map(goal => renderGoalCard(goal)).join('');

  el.querySelectorAll('.goal-edit-btn').forEach(btn =>
    btn.addEventListener('click', () => openGoalModal(allGoals.find(g => g.id === btn.dataset.id)))
  );
  el.querySelectorAll('.goal-delete-btn').forEach(btn =>
    btn.addEventListener('click', () => confirmDelete(btn.dataset.id))
  );
  el.querySelectorAll('.goal-recalc-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.textContent = '...';
      try {
        const result = await recalcGoalProgress(btn.dataset.id, allTasks);
        toast.success(`Progresso: ${result?.current||0} / ${allGoals.find(g=>g.id===btn.dataset.id)?.target}`);
        await loadAndRender();
      } catch(e) { toast.error(e.message); btn.textContent = '↺'; }
    });
  });
}

function renderGoalCard(goal) {
  const typeDef   = GOAL_TYPES.find(t => t.value === goal.type) || GOAL_TYPES[0];
  const periodDef = GOAL_PERIODS.find(p => p.value === goal.period) || { label: goal.period };
  const nucleo    = NUCLEOS.find(n => n.value === goal.filterNucleo)?.label || '';
  const taskTypes = store.get('taskTypes') || [];
  const typeLabel = taskTypes.find(t => t.id === goal.filterTypeId)?.name || '';
  const pct       = goal.target > 0 ? Math.min(100, Math.round((goal.current||0) / goal.target * 100)) : goal.progress || 0;
  const isComplete = pct >= 100 || goal.status === 'completed';
  const barColor  = isComplete ? '#22C55E' : pct >= 60 ? '#F59E0B' : typeDef.color;

  const now      = new Date();
  const end      = goal.endDate?.toDate ? goal.endDate.toDate() : goal.endDate ? new Date(goal.endDate) : null;
  const daysLeft = end ? Math.ceil((end - now) / (1000*60*60*24)) : null;

  const users = store.get('users') || [];
  const assigneeNames = (goal.filterAssignees||[]).slice(0,3)
    .map(uid => users.find(u=>u.id===uid)?.name?.split(' ')[0] || uid)
    .join(', ');

  return `
    <div class="card" style="margin-bottom:12px;border-left:3px solid ${isComplete?'#22C55E':typeDef.color};">
      <div class="card-body" style="padding:16px 18px;">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <div style="width:36px;height:36px;border-radius:var(--radius-md);flex-shrink:0;
            background:${typeDef.color}22;color:${typeDef.color};
            display:flex;align-items:center;justify-content:center;font-size:1.125rem;margin-top:2px;">
            ${isComplete ? '✓' : typeDef.icon}
          </div>

          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
              <span style="font-weight:600;color:var(--text-primary);font-size:0.9375rem;">${esc(goal.title)}</span>
              ${isComplete ? `<span style="font-size:0.6875rem;padding:2px 8px;border-radius:var(--radius-full);
                background:rgba(34,197,94,0.12);color:#22C55E;border:1px solid rgba(34,197,94,0.3);">✓ Concluída</span>` : ''}
              <span style="font-size:0.6875rem;padding:2px 8px;border-radius:var(--radius-full);
                background:${typeDef.color}15;color:${typeDef.color};border:1px solid ${typeDef.color}33;">
                ${periodDef.label}
              </span>
            </div>

            ${goal.description ? `<p style="font-size:0.8125rem;color:var(--text-secondary);margin-bottom:8px;line-height:1.5;">${esc(goal.description)}</p>` : ''}

            <!-- Critérios ativos -->
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
              ${assigneeNames ? `<span style="font-size:0.75rem;padding:2px 8px;border-radius:var(--radius-full);background:var(--bg-elevated);color:var(--text-muted);">👤 ${esc(assigneeNames)}</span>` : ''}
              ${nucleo   ? `<span style="font-size:0.75rem;padding:2px 8px;border-radius:var(--radius-full);background:var(--bg-elevated);color:var(--text-muted);">◈ ${esc(nucleo)}</span>` : ''}
              ${typeLabel? `<span style="font-size:0.75rem;padding:2px 8px;border-radius:var(--radius-full);background:var(--bg-elevated);color:var(--text-muted);">📋 ${esc(typeLabel)}</span>` : ''}
            </div>

            <!-- Barra de progresso -->
            <div style="margin-bottom:6px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span style="font-size:0.8125rem;color:var(--text-muted);">${esc(goal.metric||'progresso')}</span>
                <span style="font-size:0.875rem;font-weight:700;color:${barColor};">${goal.current||0} / ${goal.target} (${pct}%)</span>
              </div>
              <div style="height:8px;background:var(--bg-elevated);border-radius:4px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:${barColor};border-radius:4px;transition:width 0.6s;"></div>
              </div>
            </div>

            <div style="font-size:0.75rem;color:var(--text-muted);">
              ${end ? `📅 ${isComplete ? 'Concluída em' : (daysLeft !== null && daysLeft < 0 ? 'Encerrada em' : (daysLeft !== null ? daysLeft + 'd restante' + (daysLeft !== 1 ? 's' : '') + ' —' : ''))} ${fmtDate(goal.endDate)}` : ''}
            </div>
          </div>

          <div style="display:flex;gap:4px;flex-shrink:0;">
            <button class="btn btn-ghost btn-icon btn-sm goal-recalc-btn" data-id="${goal.id}" title="Recalcular progresso">↺</button>
            <button class="btn btn-ghost btn-icon btn-sm goal-edit-btn"   data-id="${goal.id}" title="Editar">✎</button>
            <button class="btn btn-ghost btn-icon btn-sm goal-delete-btn" data-id="${goal.id}" title="Excluir" style="color:var(--color-danger);">✕</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* ─── Modal criar / editar ───────────────────────────────── */
function openGoalModal(goal = null) {
  const isEdit = !!goal;
  const users  = (store.get('users') || []).filter(u => u.active !== false);
  const uid    = store.get('currentUser').uid;
  const taskTypes = store.get('taskTypes') || [];

  modal.open({
    title: isEdit ? `Editar — ${goal.title}` : 'Nova Meta',
    size:  'md',
    content: `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div class="form-group">
          <label class="form-label">Título *</label>
          <input type="text" class="form-input" id="gl-title"
            value="${esc(goal?.title||'')}" maxlength="80"
            placeholder="Ex: Concluir 20 newsletters no trimestre" />
          <span class="form-error-msg" id="gl-title-error"></span>
        </div>
        <div class="form-group">
          <label class="form-label">Descrição</label>
          <textarea class="form-textarea" id="gl-desc" rows="2"
            placeholder="Contexto e critérios de sucesso...">${esc(goal?.description||'')}</textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div class="form-group">
            <label class="form-label">Tipo</label>
            <select class="form-select" id="gl-type">
              ${GOAL_TYPES.map(t => `<option value="${t.value}" ${goal?.type===t.value?'selected':''}>${t.icon} ${t.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Período</label>
            <select class="form-select" id="gl-period">
              ${GOAL_PERIODS.map(p => `<option value="${p.value}" ${goal?.period===p.value?'selected':''}>${p.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div class="form-group">
            <label class="form-label">Meta (valor alvo) *</label>
            <input type="number" class="form-input" id="gl-target"
              value="${goal?.target||''}" min="1" placeholder="Ex: 20" />
          </div>
          <div class="form-group">
            <label class="form-label">Métrica
              <span title="O que está sendo medido (ex: tarefas concluídas, newsletters)." style="cursor:help;color:var(--text-muted);font-size:0.75rem;">ℹ</span>
            </label>
            <input type="text" class="form-input" id="gl-metric"
              value="${esc(goal?.metric||'tarefas concluídas')}" maxlength="40" />
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div class="form-group">
            <label class="form-label">Data de início</label>
            <input type="date" class="form-input" id="gl-start" value="${goal ? toISO(goal.startDate) : ''}" />
          </div>
          <div class="form-group">
            <label class="form-label">Data de fim</label>
            <input type="date" class="form-input" id="gl-end" value="${goal ? toISO(goal.endDate) : ''}" />
          </div>
        </div>

        <div style="border-top:1px solid var(--border-subtle);padding-top:14px;">
          <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);margin-bottom:12px;">
            Critérios de progresso
            <span title="Defina quais tarefas contam para esta meta. Deixe em branco para não filtrar." style="cursor:help;color:var(--text-muted);font-size:0.75rem;font-weight:400;margin-left:4px;">ℹ</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:12px;">
            <!-- Assignees -->
            <div class="form-group">
              <label class="form-label">Pessoas (tarefas atribuídas a)</label>
              <div style="display:flex;flex-wrap:wrap;gap:6px;" id="assignee-chips-goal">
                ${users.map(u => {
                  const sel = (goal?.filterAssignees||[uid]).includes(u.id);
                  const initials = u.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
                  return `<label style="display:flex;align-items:center;gap:5px;cursor:pointer;padding:4px 10px;
                    border-radius:var(--radius-full);font-size:0.8125rem;
                    border:1px solid ${sel?'var(--brand-gold)':'var(--border-subtle)'};
                    background:${sel?'rgba(212,168,67,0.12)':'var(--bg-surface)'};
                    color:${sel?'var(--brand-gold)':'var(--text-secondary)'};
                    transition:all 0.15s;" class="assignee-goal-chip">
                    <input type="checkbox" value="${u.id}" class="gl-assignee-cb" ${sel?'checked':''}
                      style="display:none;" />
                    ${initials} ${esc(u.name.split(' ')[0])}
                  </label>`;
                }).join('')}
              </div>
            </div>
            <!-- Nucleo -->
            <div class="form-group">
              <label class="form-label">Núcleo (opcional)</label>
              <select class="form-select" id="gl-nucleo">
                <option value="">— Qualquer núcleo —</option>
                ${NUCLEOS.map(n => `<option value="${n.value}" ${goal?.filterNucleo===n.value?'selected':''}>${n.label}</option>`).join('')}
              </select>
            </div>
            <!-- Task type -->
            ${taskTypes.length ? `
              <div class="form-group">
                <label class="form-label">Tipo de tarefa (opcional)</label>
                <select class="form-select" id="gl-type-filter">
                  <option value="">— Qualquer tipo —</option>
                  ${taskTypes.map(t => `<option value="${t.id}" ${goal?.filterTypeId===t.id?'selected':''}>${esc(t.icon||'')} ${esc(t.name)}</option>`).join('')}
                </select>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `,
    footer: [
      { label:'Cancelar', class:'btn-secondary', closeOnClick:true },
      {
        label: isEdit ? 'Salvar' : 'Criar meta',
        class: 'btn-primary', closeOnClick: false,
        onClick: async (_, { close }) => {
          const title  = document.getElementById('gl-title')?.value?.trim();
          const errEl  = document.getElementById('gl-title-error');
          const target = parseInt(document.getElementById('gl-target')?.value) || 0;
          if (!title)  { if(errEl) errEl.textContent='Título obrigatório.'; return; }
          if (!target) { toast.warning('Defina um valor alvo.'); return; }
          if(errEl) errEl.textContent='';

          const filterAssignees = Array.from(document.querySelectorAll('.gl-assignee-cb:checked')).map(cb=>cb.value);
          const data = {
            title,
            description:      document.getElementById('gl-desc')?.value?.trim() || '',
            type:             document.getElementById('gl-type')?.value || 'personal',
            period:           document.getElementById('gl-period')?.value || 'monthly',
            target,
            metric:           document.getElementById('gl-metric')?.value?.trim() || 'tarefas concluídas',
            startDate:        document.getElementById('gl-start')?.value || null,
            endDate:          document.getElementById('gl-end')?.value   || null,
            filterAssignees,
            filterNucleo:     document.getElementById('gl-nucleo')?.value     || null,
            filterTypeId:     document.getElementById('gl-type-filter')?.value || null,
          };

          const btn = document.querySelector('.modal-footer .btn-primary');
          if(btn){ btn.classList.add('loading'); btn.disabled=true; }
          try {
            if (isEdit) { await updateGoal(goal.id, data); toast.success('Meta atualizada!'); }
            else        { await createGoal(data);           toast.success('Meta criada!');    }
            close();
            await loadAndRender();
          } catch(e) { toast.error(e.message); }
          finally { if(btn){ btn.classList.remove('loading'); btn.disabled=false; } }
        },
      },
    ],
  });

  // Bind assignee chips
  setTimeout(() => {
    document.querySelectorAll('.assignee-goal-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const cb = chip.querySelector('.gl-assignee-cb');
        if (!cb) return;
        cb.checked             = !cb.checked;
        chip.style.borderColor = cb.checked ? 'var(--brand-gold)'     : 'var(--border-subtle)';
        chip.style.background  = cb.checked ? 'rgba(212,168,67,0.12)' : 'var(--bg-surface)';
        chip.style.color       = cb.checked ? 'var(--brand-gold)'     : 'var(--text-secondary)';
      });
    });
  }, 50);
}

async function confirmDelete(goalId) {
  const goal = allGoals.find(g => g.id === goalId);
  if (!goal) return;
  const ok = await modal.confirm({
    title:`Excluir "${goal.title}"`, message:'Esta ação não pode ser desfeita.',
    confirmText:'Excluir', danger:true, icon:'✕',
  });
  if (!ok) return;
  try {
    await deleteGoal(goalId);
    toast.success('Meta excluída.');
    await loadAndRender();
  } catch(e) { toast.error(e.message); }
}


/* ─── Export XLS ─────────────────────────────────────────── */
async function exportGoalsXls() {
  if (!allGoals.length) { (await import('../components/toast.js')).toast.error('Nenhuma meta para exportar.'); return; }
  if (!window.XLSX) await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s);});
  const { toast } = await import('../components/toast.js');
  const rows = [
    ['Título','Tipo','Setor','Progresso','Meta','Início','Fim','Status'],
    ...allGoals.map(g => {
      const due = g.endDate?.toDate ? g.endDate.toDate() : (g.endDate ? new Date(g.endDate) : null);
      const sta = g.endDate?.toDate ? g.startDate?.toDate() : (g.startDate ? new Date(g.startDate) : null);
      return [
        g.title||'',
        g.type||'',
        g.sector||'',
        `${Math.round(g.progress||0)}%`,
        g.target||'',
        sta ? sta.toLocaleDateString('pt-BR') : '—',
        due ? due.toLocaleDateString('pt-BR') : '—',
        g.progress>=100 ? 'Concluída' : due && due < new Date() ? 'Atrasada' : 'Em andamento',
      ];
    }),
  ];
  const wb = window.XLSX.utils.book_new();
  const ws = window.XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [40,15,20,12,10,12,12,15].map(w=>({wch:w}));
  window.XLSX.utils.book_append_sheet(wb, ws, 'Metas');
  window.XLSX.writeFile(wb, `primetour_metas_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast.success('XLS exportado.');
}

/* ─── Export PDF ─────────────────────────────────────────── */
async function exportGoalsPdf() {
  if (!allGoals.length) { (await import('../components/toast.js')).toast.error('Nenhuma meta para exportar.'); return; }
  const { toast } = await import('../components/toast.js');
  if (!window.jspdf) {
    await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s);});
    await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s);});
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
  doc.setFontSize(14);doc.setFont('helvetica','bold');doc.setTextColor(36,35,98);
  doc.text('PRIMETOUR — Metas', 14, 16);
  doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(100,100,100);
  doc.text(`Gerado em ${new Date().toLocaleDateString('pt-BR')} · ${allGoals.length} metas`, 14, 22);
  doc.autoTable({
    startY: 27,
    head: [['Título','Tipo','Setor','Progresso','Fim','Status']],
    body: allGoals.map(g => {
      const due = g.endDate?.toDate ? g.endDate.toDate() : (g.endDate ? new Date(g.endDate) : null);
      return [
        (g.title||'').slice(0,50),
        g.type||'',
        g.sector||'',
        `${Math.round(g.progress||0)}%`,
        due ? due.toLocaleDateString('pt-BR') : '—',
        g.progress>=100 ? 'Concluída' : due && due < new Date() ? 'Atrasada' : 'Em andamento',
      ];
    }),
    styles:{fontSize:8,cellPadding:3},
    headStyles:{fillColor:[36,35,98],textColor:255,fontStyle:'bold'},
    columnStyles:{0:{cellWidth:80},1:{cellWidth:25},2:{cellWidth:30},3:{cellWidth:22},4:{cellWidth:22},5:{cellWidth:28}},
    alternateRowStyles:{fillColor:[248,247,244]},
  });
  doc.save(`primetour_metas_${new Date().toISOString().slice(0,10)}.pdf`);
  toast.success('PDF exportado.');
}
