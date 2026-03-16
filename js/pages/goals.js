/**
 * PRIMETOUR — Goals Page
 * Metas individuais e do núcleo vinculadas a tarefas e projetos
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import {
  fetchGoals, createGoal, updateGoal, deleteGoal,
  linkTaskToGoal, recalcGoalProgress,
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
      <div class="page-header-actions">
        <button class="btn btn-primary" id="new-goal-btn">+ Nova Meta</button>
      </div>
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
  container.querySelectorAll('.goal-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      container.querySelectorAll('.goal-tab-btn').forEach(b => {
        b.style.color       = b.dataset.tab===activeTab ? 'var(--brand-gold)' : 'var(--text-muted)';
        b.style.borderBottom = `2px solid ${b.dataset.tab===activeTab ? 'var(--brand-gold)' : 'transparent'}`;
      });
      loadAndRender();
    });
  });

  await loadAndRender();
}

async function loadAndRender() {
  try {
    const uid = store.get('currentUser').uid;
    [allGoals, allTasks] = await Promise.all([
      fetchGoals({ type: activeTab }),
      fetchTasks().catch(() => []),
    ]);
    renderGoalsList();
  } catch(e) {
    toast.error('Erro ao carregar metas: ' + e.message);
  }
}

function renderGoalsList() {
  const el = document.getElementById('goals-content');
  if (!el) return;

  const filtered = allGoals.filter(g => g.type === activeTab);

  if (!filtered.length) {
    el.innerHTML = `
      <div class="empty-state" style="min-height:35vh;">
        <div class="empty-state-icon">${GOAL_TYPES.find(t=>t.value===activeTab)?.icon||'◉'}</div>
        <div class="empty-state-title">Nenhuma meta ${GOAL_TYPES.find(t=>t.value===activeTab)?.label?.toLowerCase()||''}</div>
        <p class="text-sm text-muted">Crie metas para acompanhar o progresso da equipe.</p>
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
  el.querySelectorAll('.goal-link-btn').forEach(btn =>
    btn.addEventListener('click', () => openLinkModal(allGoals.find(g => g.id === btn.dataset.id)))
  );
  el.querySelectorAll('.goal-recalc-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await recalcGoalProgress(btn.dataset.id, allTasks);
        toast.success('Progresso recalculado.');
        await loadAndRender();
      } catch(e) { toast.error(e.message); }
    });
  });
}

function renderGoalCard(goal) {
  const typeDef    = GOAL_TYPES.find(t => t.value === goal.type) || GOAL_TYPES[0];
  const periodDef  = GOAL_PERIODS.find(p => p.value === goal.period) || { label: goal.period };
  const nucleo     = NUCLEOS.find(n => n.value === goal.nucleo)?.label || goal.nucleo || '';
  const linkedDone = allTasks.filter(t => (goal.linkedTaskIds||[]).includes(t.id) && t.status==='done').length;
  const linked     = (goal.linkedTaskIds||[]).length;
  const pct        = goal.target > 0 ? Math.min(100, Math.round((goal.current / goal.target) * 100)) : goal.progress || 0;
  const isComplete = pct >= 100 || goal.status === 'completed';

  const barColor = isComplete ? '#22C55E' : pct >= 60 ? '#F59E0B' : typeDef.color;

  const now = new Date();
  const end = goal.endDate?.toDate ? goal.endDate.toDate() : goal.endDate ? new Date(goal.endDate) : null;
  const daysLeft = end ? Math.ceil((end - now) / (1000*60*60*24)) : null;

  return `
    <div class="card" style="margin-bottom:12px;border-left:3px solid ${isComplete?'#22C55E':typeDef.color};">
      <div class="card-body" style="padding:16px 18px;">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <!-- Icon -->
          <div style="width:36px;height:36px;border-radius:var(--radius-md);flex-shrink:0;
            background:${typeDef.color}22;color:${typeDef.color};
            display:flex;align-items:center;justify-content:center;font-size:1.125rem;margin-top:2px;">
            ${isComplete ? '✓' : typeDef.icon}
          </div>

          <!-- Content -->
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
              <span style="font-weight:600;color:var(--text-primary);font-size:0.9375rem;">${esc(goal.title)}</span>
              ${isComplete ? `<span style="font-size:0.6875rem;padding:2px 8px;border-radius:var(--radius-full);
                background:rgba(34,197,94,0.12);color:#22C55E;border:1px solid rgba(34,197,94,0.3);">
                ✓ Concluída</span>` : ''}
              <span style="font-size:0.6875rem;padding:2px 8px;border-radius:var(--radius-full);
                background:${typeDef.color}15;color:${typeDef.color};border:1px solid ${typeDef.color}33;">
                ${periodDef.label}
              </span>
              ${nucleo ? `<span style="font-size:0.6875rem;color:var(--text-muted);">◈ ${esc(nucleo)}</span>` : ''}
            </div>

            ${goal.description ? `<p style="font-size:0.8125rem;color:var(--text-secondary);margin-bottom:8px;line-height:1.5;">${esc(goal.description)}</p>` : ''}

            <!-- Progress bar -->
            <div style="margin-bottom:8px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span style="font-size:0.8125rem;color:var(--text-muted);">${esc(goal.metric||'progresso')}</span>
                <span style="font-size:0.875rem;font-weight:700;color:${barColor};">${goal.current||0} / ${goal.target} (${pct}%)</span>
              </div>
              <div style="height:8px;background:var(--bg-elevated);border-radius:4px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:${barColor};border-radius:4px;transition:width 0.6s ease;"></div>
              </div>
            </div>

            <!-- Meta info -->
            <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:0.75rem;color:var(--text-muted);">
              ${linked ? `<span>🔗 ${linked} tarefa${linked!==1?'s':''} vinculada${linked!==1?'s':''}</span>` : ''}
              ${end ? `<span style="color:${daysLeft!==null&&daysLeft<7&&!isComplete?'#F59E0B':'var(--text-muted)'};">
                📅 ${isComplete?'Concluída em ':daysLeft!==null&&daysLeft<0?'Encerrada em ':'Até '}${fmtDate(goal.endDate)}
                ${daysLeft!==null&&daysLeft>=0&&!isComplete?`(${daysLeft}d restante${daysLeft!==1?'s':''})`:''}</span>` : ''}
            </div>
          </div>

          <!-- Actions -->
          <div style="display:flex;gap:4px;flex-shrink:0;">
            <button class="btn btn-ghost btn-icon btn-sm goal-recalc-btn" data-id="${goal.id}" title="Recalcular progresso">↺</button>
            <button class="btn btn-ghost btn-icon btn-sm goal-link-btn"   data-id="${goal.id}" title="Vincular tarefas">🔗</button>
            <button class="btn btn-ghost btn-icon btn-sm goal-edit-btn"   data-id="${goal.id}" title="Editar">✎</button>
            <button class="btn btn-ghost btn-icon btn-sm goal-delete-btn" data-id="${goal.id}" title="Excluir" style="color:var(--color-danger);">✕</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* ─── Modal: criar / editar meta ─────────────────────────── */
function openGoalModal(goal = null) {
  const isEdit = !!goal;

  modal.open({
    title: isEdit ? `Editar — ${goal.title}` : 'Nova Meta',
    size:  'md',
    content: `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div class="form-group">
          <label class="form-label">Título *</label>
          <input type="text" class="form-input" id="gl-title"
            value="${esc(goal?.title||'')}" maxlength="80" placeholder="Ex: Concluir 20 newsletters no trimestre" />
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
        <div class="form-group" id="gl-nucleo-group" style="display:${goal?.type==='nucleo'?'block':'none'}">
          <label class="form-label">Núcleo</label>
          <select class="form-select" id="gl-nucleo">
            <option value="">— Selecione —</option>
            ${NUCLEOS.map(n => `<option value="${n.value}" ${goal?.nucleo===n.value?'selected':''}>${n.label}</option>`).join('')}
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div class="form-group">
            <label class="form-label">Meta (valor alvo) *
              <span title="Número de tarefas concluídas, projetos entregues, etc." style="cursor:help;color:var(--text-muted);font-size:0.75rem;">ℹ</span>
            </label>
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
        ${isEdit ? `
          <div class="form-group">
            <label class="form-label">Progresso atual (manual)</label>
            <input type="number" class="form-input" id="gl-current"
              value="${goal?.current||0}" min="0" />
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
              Use "Recalcular" na lista para calcular automaticamente pelas tarefas vinculadas.
            </div>
          </div>
        ` : ''}
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
          if (!title) { if(errEl) errEl.textContent='Título é obrigatório.'; return; }
          if (!target) { toast.warning('Defina um valor alvo para a meta.'); return; }
          if(errEl) errEl.textContent='';

          const data = {
            title,
            description: document.getElementById('gl-desc')?.value?.trim() || '',
            type:        document.getElementById('gl-type')?.value || 'personal',
            period:      document.getElementById('gl-period')?.value || 'monthly',
            nucleo:      document.getElementById('gl-nucleo')?.value || null,
            target,
            metric:      document.getElementById('gl-metric')?.value?.trim() || 'tarefas concluídas',
            startDate:   document.getElementById('gl-start')?.value || null,
            endDate:     document.getElementById('gl-end')?.value   || null,
            ...(isEdit ? { current: parseInt(document.getElementById('gl-current')?.value)||0 } : {}),
          };
          if (isEdit && data.target > 0) {
            data.progress = Math.min(100, Math.round(((data.current||goal.current||0) / data.target) * 100));
          }

          const btn = document.querySelector('.modal-footer .btn-primary');
          if(btn){ btn.classList.add('loading'); btn.disabled=true; }
          try {
            if (isEdit) { await updateGoal(goal.id, data); toast.success('Meta atualizada!'); }
            else        { await createGoal(data);           toast.success('Meta criada!');     }
            close();
            await loadAndRender();
          } catch(e) { toast.error(e.message); }
          finally { if(btn){ btn.classList.remove('loading'); btn.disabled=false; } }
        },
      },
    ],
  });

  setTimeout(() => {
    document.getElementById('gl-type')?.addEventListener('change', e => {
      document.getElementById('gl-nucleo-group').style.display = e.target.value==='nucleo' ? 'block' : 'none';
    });
  }, 50);
}

/* ─── Modal: vincular tarefas ────────────────────────────── */
function openLinkModal(goal) {
  if (!goal) return;
  const linked = goal.linkedTaskIds || [];

  modal.open({
    title: `Vincular tarefas — ${goal.title}`,
    size:  'md',
    content: `
      <p style="font-size:0.875rem;color:var(--text-secondary);margin-bottom:14px;line-height:1.5;">
        Tarefas vinculadas são contadas no progresso ao serem concluídas.
        Selecione as tarefas relevantes para esta meta.
      </p>
      <input type="text" class="form-input" id="task-search-link"
        placeholder="Buscar tarefa..." style="margin-bottom:12px;" />
      <div style="max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;" id="task-link-list">
        ${allTasks.slice(0,50).map(t => {
          const isLinked = linked.includes(t.id);
          return `
            <label style="display:flex;align-items:center;gap:10px;padding:8px 10px;
              border-radius:var(--radius-md);cursor:pointer;border:1px solid ${isLinked?'var(--brand-gold)':'var(--border-subtle)'};
              background:${isLinked?'rgba(212,168,67,0.06)':'var(--bg-surface)'};transition:all 0.15s;" class="task-link-item">
              <input type="checkbox" value="${t.id}" class="task-link-cb" ${isLinked?'checked':''}
                style="accent-color:var(--brand-gold);" />
              <div style="flex:1;min-width:0;">
                <div style="font-size:0.875rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.title)}</div>
                <div style="font-size:0.75rem;color:var(--text-muted);">${t.status==='done'?'✓ Concluída':'Aberta'}</div>
              </div>
            </label>`;
        }).join('')}
      </div>
    `,
    footer: [
      { label:'Cancelar', class:'btn-secondary', closeOnClick:true },
      {
        label: 'Salvar vínculos', class: 'btn-primary', closeOnClick: false,
        onClick: async (_, { close }) => {
          const selected = Array.from(document.querySelectorAll('.task-link-cb:checked')).map(cb => cb.value);
          const btn = document.querySelector('.modal-footer .btn-primary');
          if(btn){ btn.classList.add('loading'); btn.disabled=true; }
          try {
            await updateGoal(goal.id, { linkedTaskIds: selected });
            await recalcGoalProgress(goal.id, allTasks);
            toast.success('Tarefas vinculadas e progresso recalculado!');
            close();
            await loadAndRender();
          } catch(e) { toast.error(e.message); }
          finally { if(btn){ btn.classList.remove('loading'); btn.disabled=false; } }
        },
      },
    ],
  });

  // Search filter
  setTimeout(() => {
    document.getElementById('task-search-link')?.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('.task-link-item').forEach(item => {
        item.style.display = item.textContent.toLowerCase().includes(q) ? 'flex' : 'none';
      });
    });
    document.querySelectorAll('.task-link-item').forEach(item => {
      item.addEventListener('click', () => {
        const cb = item.querySelector('.task-link-cb');
        if (!cb) return;
        cb.checked = !cb.checked;
        item.style.borderColor  = cb.checked ? 'var(--brand-gold)'        : 'var(--border-subtle)';
        item.style.background   = cb.checked ? 'rgba(212,168,67,0.06)'    : 'var(--bg-surface)';
      });
    });
  }, 50);
}

async function confirmDelete(goalId) {
  const goal = allGoals.find(g => g.id === goalId);
  if (!goal) return;
  const ok = await modal.confirm({
    title:`Excluir meta "${goal.title}"`,
    message:'Esta ação não pode ser desfeita.',
    confirmText:'Excluir', danger:true, icon:'✕',
  });
  if (!ok) return;
  try {
    await deleteGoal(goalId);
    toast.success('Meta excluída.');
    await loadAndRender();
  } catch(e) { toast.error(e.message); }
}
