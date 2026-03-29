/**
 * PRIMETOUR — Goals Page v2
 * Form multi-pilar + aba Avaliação de Metas
 */
import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import {
  fetchGoals, fetchGoal, saveGoal, deleteGoal, publishGoal,
  saveEvaluation, fetchEvaluations,
  calcGoalProgress, getPendingPeriods, validateGoalWeights,
  emptyGoal, emptyPilar, emptyMeta, emptyKpi,
  GOAL_SCOPES, GOAL_PRAZO_TYPES,
} from '../services/goals.js';
import { NUCLEOS, fetchTasks } from '../services/tasks.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = ts => { if(!ts) return '—'; const d=ts?.toDate?ts.toDate():new Date(ts); return d.toLocaleDateString('pt-BR'); };

let allGoals=[], allUsers=[], evaluations=[], activeTab='metas';

export async function renderGoals(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Metas</h1>
        <p class="page-subtitle">Gestão de metas por pilar, KPI e avaliação</p>
      </div>
      <div class="page-header-actions" style="gap:8px;">
        <button class="btn btn-secondary btn-sm" id="goal-export-xls">↓ XLS</button>
        <button class="btn btn-secondary btn-sm" id="goal-export-pdf">↓ PDF</button>
        ${store.can('system_manage_roles')||store.isMaster()?
          `<button class="btn btn-primary" id="new-goal-btn">+ Nova Meta</button>` : ''}
      </div>
    </div>

    <!-- Tabs -->
    <div style="display:flex;gap:0;border-bottom:1px solid var(--border-subtle);margin-bottom:20px;">
      ${[{id:'metas',label:'Metas'},
         {id:'avaliacoes',label:'Avaliação de Metas'}].map(t=>`
        <button class="goal-tab" data-tab="${t.id}"
          style="padding:9px 18px;border:none;background:none;cursor:pointer;font-size:0.875rem;
          font-weight:500;transition:all .15s;
          color:${activeTab===t.id?'var(--brand-gold)':'var(--text-muted)'};
          border-bottom:2px solid ${activeTab===t.id?'var(--brand-gold)':'transparent'};">
          ${t.label}
        </button>`).join('')}
    </div>

    <!-- Filters -->
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
      <input type="text" id="goal-search" class="portal-field"
        placeholder="Buscar meta…" style="flex:1;min-width:180px;font-size:0.875rem;">
      <select id="goal-scope-filter" class="filter-select" style="min-width:150px;">
        <option value="">Todos os escopos</option>
        ${GOAL_SCOPES.map(s=>`<option value="${s.value}">${s.label}</option>`).join('')}
      </select>
      <select id="goal-status-filter" class="filter-select" style="min-width:140px;">
        <option value="">Todos os status</option>
        <option value="rascunho">Rascunho</option>
        <option value="publicada">Publicada</option>
        <option value="encerrada">Encerrada</option>
      </select>
    </div>

    <div id="goals-content"></div>`;

  // Load data
  [allGoals, allUsers] = await Promise.all([
    fetchGoals().catch(()=>[]),
    Promise.resolve(store.get('users')||[]),
  ]);

  // Wire tabs
  container.querySelectorAll('.goal-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      container.querySelectorAll('.goal-tab').forEach(b => {
        b.style.color        = b.dataset.tab===activeTab?'var(--brand-gold)':'var(--text-muted)';
        b.style.borderBottom = `2px solid ${b.dataset.tab===activeTab?'var(--brand-gold)':'transparent'}`;
      });
      renderContent();
    });
  });

  // Wire filters
  container.querySelector('#goal-search')?.addEventListener('input', renderContent);
  container.querySelector('#goal-scope-filter')?.addEventListener('change', renderContent);
  container.querySelector('#goal-status-filter')?.addEventListener('change', renderContent);

  // Wire buttons
  document.getElementById('new-goal-btn')?.addEventListener('click', () => openGoalForm(container, null));
  document.getElementById('goal-export-xls')?.addEventListener('click', () => exportGoalsXls());
  document.getElementById('goal-export-pdf')?.addEventListener('click', () => exportGoalsPdf());

  renderContent();

  function renderContent() {
    if (activeTab === 'metas') renderGoalsList(container);
    else renderAvaliacoes(container);
  }
}

/* ─── Goals list ─────────────────────────────────────────── */
function renderGoalsList(container) {
  const el = document.getElementById('goals-content');
  if (!el) return;

  const search = document.getElementById('goal-search')?.value?.toLowerCase()||'';
  const scope  = document.getElementById('goal-scope-filter')?.value||'';
  const status = document.getElementById('goal-status-filter')?.value||'';

  let goals = allGoals;
  if (search) goals = goals.filter(g => (JSON.stringify(g)).toLowerCase().includes(search));
  if (scope)  goals = goals.filter(g => g.escopo===scope);
  if (status) goals = goals.filter(g => g.status===status);

  if (!goals.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">◉</div>
      <div class="empty-state-title">Nenhuma meta encontrada</div>
      <div class="empty-state-subtitle">Crie a primeira meta clicando em "+ Nova Meta"</div>
    </div>`; return;
  }

  el.innerHTML = goals.map(goal => {
    const resp  = allUsers.find(u=>u.id===goal.responsavelId);
    const gestor = allUsers.find(u=>u.id===goal.gestorId);
    const pilarCount = (goal.pilares||[]).length;
    const metaCount  = (goal.pilares||[]).reduce((s,p)=>s+(p.metas||[]).length,0);
    const warnings   = validateGoalWeights(goal);
    const statusColors = { rascunho:'#6B7280', publicada:'#22C55E', encerrada:'#A78BFA' };

    return `
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:12px;">
      <!-- Header bar -->
      <div style="height:4px;background:${statusColors[goal.status]||'#6B7280'};"></div>
      <div style="padding:18px 22px;">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
              <span style="font-size:0.75rem;padding:2px 10px;border-radius:var(--radius-full);
                background:${statusColors[goal.status]}18;color:${statusColors[goal.status]};
                font-weight:600;border:1px solid ${statusColors[goal.status]}30;">
                ${esc(goal.status||'rascunho')}
              </span>
              <span style="font-size:0.75rem;color:var(--text-muted);padding:2px 10px;
                background:var(--bg-surface);border-radius:var(--radius-full);border:1px solid var(--border-subtle);">
                ${GOAL_SCOPES.find(s=>s.value===goal.escopo)?.label||goal.escopo||'—'}
              </span>
              ${goal.setor?`<span style="font-size:0.75rem;color:var(--brand-gold);padding:2px 10px;
                background:var(--brand-gold)10;border-radius:var(--radius-full);">${esc(goal.setor)}</span>`:''}
              ${warnings.length?`<span style="font-size:0.75rem;color:#F59E0B;padding:2px 10px;
                background:#F59E0B18;border-radius:var(--radius-full);border:1px solid #F59E0B30;"
                title="${esc(warnings.join('\n'))}">⚠ ponderação pendente</span>`:''}
            </div>
            <div style="font-weight:700;font-size:0.9375rem;margin-bottom:4px;">
              ${esc(goal.objetivoNucleo || (goal.pilares?.[0]?.titulo) || 'Meta sem título')}
            </div>
            <div style="font-size:0.8125rem;color:var(--text-muted);">
              ${pilarCount} pilar${pilarCount!==1?'es':''} · ${metaCount} meta${metaCount!==1?'s':''}
              ${resp?` · Responsável: <strong style="color:var(--text-secondary);">${esc(resp.name)}</strong>`:''}
              ${gestor?` · Gestor: <strong style="color:var(--text-secondary);">${esc(gestor.name)}</strong>`:''}
              ${goal.inicio?` · ${fmtDate(goal.inicio)}`:''} ${goal.fim?`→ ${fmtDate(goal.fim)}`:''}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;">
            ${goal.status==='rascunho'&&(store.isMaster()||store.can('system_manage_roles'))?
              `<button class="btn btn-primary btn-sm goal-publish-btn" data-id="${esc(goal.id)}"
                style="font-size:0.75rem;">✓ Publicar</button>`:''}
            ${store.isMaster()||store.can('system_manage_roles')?
              `<button class="btn btn-ghost btn-sm goal-edit-btn" data-id="${esc(goal.id)}"
                style="font-size:0.75rem;color:var(--brand-gold);">✎ Editar</button>
               <button class="btn btn-ghost btn-sm goal-del-btn" data-id="${esc(goal.id)}"
                style="font-size:0.75rem;color:#EF4444;">✕</button>`:''}
          </div>
        </div>

        <!-- Pilares preview -->
        ${(goal.pilares||[]).length ? `
        <div style="margin-top:14px;border-top:1px solid var(--border-subtle);padding-top:12px;
          display:flex;flex-direction:column;gap:8px;">
          ${(goal.pilares||[]).map((pilar,pi) => `
            <div style="background:var(--bg-surface);border-radius:var(--radius-sm);padding:10px 14px;">
              <div style="font-size:0.75rem;font-weight:700;color:var(--text-muted);
                text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">
                Pilar ${pi+1} · ${esc(pilar.titulo||'Sem título')}
                <span style="font-weight:400;color:var(--brand-gold);margin-left:6px;">${pilar.ponderacao||0}%</span>
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:6px;">
                ${(pilar.metas||[]).map((meta,mi) => `
                  <span style="font-size:0.75rem;padding:2px 10px;background:var(--bg-dark);
                    border-radius:var(--radius-full);color:var(--text-secondary);">
                    ${esc(meta.titulo||`Meta ${mi+1}`)}
                    <span style="color:var(--brand-gold);margin-left:4px;">${meta.ponderacao||0}%</span>
                  </span>`).join('')}
              </div>
            </div>`).join('')}
        </div>` : ''}
      </div>
    </div>`;
  }).join('');

  // Wire buttons
  el.querySelectorAll('.goal-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openGoalForm(container, btn.dataset.id));
  });
  el.querySelectorAll('.goal-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Excluir esta meta?')) return;
      await deleteGoal(btn.dataset.id);
      allGoals = allGoals.filter(g=>g.id!==btn.dataset.id);
      renderGoalsList(container);
      toast.success('Meta excluída.');
    });
  });
  el.querySelectorAll('.goal-publish-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const warnings = validateGoalWeights(allGoals.find(g=>g.id===btn.dataset.id)||{pilares:[]});
      if (warnings.length) {
        const ok = confirm(`⚠ Esta meta tem ponderações incompletas:\n\n${warnings.join('\n')}\n\nPublicar mesmo assim?`);
        if (!ok) return;
      }
      await publishGoal(btn.dataset.id);
      const g = allGoals.find(g=>g.id===btn.dataset.id);
      if (g) g.status = 'publicada';
      renderGoalsList(container);
      toast.success('Meta publicada!');
    });
  });
}

/* ─── Avaliações tab ─────────────────────────────────────── */
async function renderAvaliacoes(container) {
  const el = document.getElementById('goals-content');
  if (!el) return;

  el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">⏳ Carregando…</div>`;

  const publishedGoals = allGoals.filter(g=>g.status==='publicada');

  if (!publishedGoals.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">◈</div>
      <div class="empty-state-title">Nenhuma meta publicada</div>
      <div class="empty-state-subtitle">Publique uma meta para iniciar as avaliações</div>
    </div>`; return;
  }

  const uid = store.get('currentUser')?.uid;
  el.innerHTML = publishedGoals.map(goal => {
    const resp   = allUsers.find(u=>u.id===goal.responsavelId);
    const gestor = allUsers.find(u=>u.id===goal.gestorId);
    const isGestor = goal.gestorId===uid || store.isMaster() || store.can('system_manage_roles');

    return `
    <div class="card" style="margin-bottom:16px;padding:0;overflow:hidden;">
      <div style="padding:16px 22px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-weight:700;">${esc(goal.objetivoNucleo||(goal.pilares?.[0]?.titulo)||'Meta')}</div>
          <div style="font-size:0.8125rem;color:var(--text-muted);">
            ${resp?esc(resp.name):'—'} · Gestor: ${gestor?esc(gestor.name):'—'}
          </div>
        </div>
        ${isGestor?`<button class="btn btn-primary btn-sm goal-aval-btn"
          data-id="${esc(goal.id)}" style="font-size:0.8125rem;">+ Avaliar</button>`:''}
      </div>
      <div id="goal-evals-${esc(goal.id)}" style="padding:16px 22px;">
        <div style="color:var(--text-muted);font-size:0.8125rem;text-align:center;padding:16px;">
          ⏳ Carregando avaliações…
        </div>
      </div>
    </div>`;
  }).join('');

  // Load evaluations + evidence tasks for each goal
  for (const goal of publishedGoals) {
    const [evals, allTasksRaw] = await Promise.all([
      fetchEvaluations(goal.id).catch(()=>[]),
      fetchTasks().catch(()=>[]),
    ]);
    const evidenceTasks = allTasksRaw.filter(t => t.goalId === goal.id && t.confirmadaEvidencia);

    const evalEl = document.getElementById(`goal-evals-${goal.id}`);
    if (!evalEl) continue;

    const { progress, displayProgress, status } = calcGoalProgress(goal, evals);
    const progressColor = progress>=80?'#22C55E':progress>=50?'#F59E0B':'#EF4444';

    const evalsHTML = evals.length ? `
      <!-- Progress bar -->
      <div style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:0.8125rem;color:var(--text-muted);">Progresso geral</span>
          <span style="font-size:0.875rem;font-weight:700;color:${progressColor};">
            ${displayProgress}
            ${status==='parcial'?'<span style="font-size:0.6875rem;color:#F59E0B;margin-left:6px;">⚠ avaliação parcial</span>':''}
          </span>
        </div>
        <div style="height:8px;background:var(--border-subtle);border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${Math.min(progress,100)}%;background:${progressColor};
            border-radius:4px;transition:width .6s;"></div>
        </div>
      </div>
      ${evals.map(ev => {
        const evDate = ev.createdAt?.toDate?ev.createdAt.toDate():new Date(ev.createdAt||0);
        const uid2   = store.get('currentUser')?.uid;
        const canEdit = goal.gestorId===uid2||store.isMaster()||store.can('system_manage_roles');
        return `
        <div style="background:var(--bg-surface);border-radius:var(--radius-md);
          padding:12px 16px;margin-bottom:8px;border:1px solid var(--border-subtle);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <div style="font-size:0.8125rem;font-weight:600;">
              Pilar ${(ev.pillarIdx||0)+1} · Meta ${(ev.metaIdx||0)+1}
              ${ev.periodoRef?` · <span style="color:var(--brand-gold);">${esc(ev.periodoRef)}</span>`:''}
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:0.75rem;color:var(--text-muted);">${evDate.toLocaleDateString('pt-BR')}</span>
              ${canEdit?`<button class="btn btn-ghost btn-sm eval-edit-btn"
                data-goal="${esc(goal.id)}" data-eval="${esc(ev.id)}"
                style="font-size:0.75rem;color:var(--brand-gold);">✎</button>`:''}
            </div>
          </div>
          ${(ev.kpiScores||[]).map((ks,ki) => {
            const kpiDef = goal.pilares?.[ev.pillarIdx||0]?.metas?.[ev.metaIdx||0]?.kpis?.[ki];
            return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;
              border-bottom:1px solid var(--border-subtle);">
              <div style="flex:1;font-size:0.8125rem;color:var(--text-secondary);">
                ${esc(kpiDef?.descricao||`KPI ${ki+1}`)}
                <span style="color:var(--text-muted);margin-left:4px;">(peso ${kpiDef?.peso||0}%)</span>
              </div>
              <div style="font-size:0.875rem;font-weight:700;color:${(ks.score||0)>=70?'#22C55E':'#F59E0B'};">
                ${ks.score??'—'}%
              </div>
              ${ks.comentario?`<div style="font-size:0.75rem;color:var(--text-muted);
                max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                title="${esc(ks.comentario)}">💬 ${esc(ks.comentario)}</div>`:''}
            </div>`;
          }).join('')}
        </div>`;
      }).join('')}` : `<div style="font-size:0.8125rem;color:var(--text-muted);text-align:center;padding:12px;">
        Nenhuma avaliação registrada ainda.</div>`;

    // Evidence tasks section
    const evidenceHTML = evidenceTasks.length ? `
      <div style="margin-top:${evals.length?'20px':'0'};">
        <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;
          letter-spacing:.07em;color:var(--text-muted);margin-bottom:10px;">
          📎 Tarefas vinculadas como evidência (${evidenceTasks.length})
        </div>
        ${evidenceTasks.map(t => {
          const doneDate = t.completedAt?.toDate ? t.completedAt.toDate() : null;
          return `
          <div style="background:var(--bg-surface);border-radius:var(--radius-md);
            padding:10px 14px;margin-bottom:6px;border:1px solid var(--border-subtle);
            display:flex;align-items:center;gap:10px;">
            <span style="color:#22C55E;font-size:0.875rem;flex-shrink:0;">✓</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:0.8125rem;font-weight:600;
                overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                ${esc(t.title)}
              </div>
              <div style="display:flex;gap:8px;margin-top:2px;flex-wrap:wrap;">
                ${t.periodoRef?`<span style="font-size:0.75rem;color:var(--brand-gold);">
                  📅 ${esc(t.periodoRef)}</span>`:''}
                ${doneDate?`<span style="font-size:0.75rem;color:var(--text-muted);">
                  Concluída ${doneDate.toLocaleDateString('pt-BR')}</span>`:''}
              </div>
            </div>
            ${t.linkComprovacao?`
              <a href="${esc(t.linkComprovacao)}" target="_blank" rel="noopener"
                class="btn btn-ghost btn-sm"
                style="font-size:0.75rem;flex-shrink:0;color:var(--brand-gold);">
                🔗 Ver
              </a>`:''}
          </div>`;
        }).join('')}
      </div>` : '';

    evalEl.innerHTML = evalsHTML + evidenceHTML;

    // Wire edit evaluation buttons
    evalEl.querySelectorAll('.eval-edit-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ev = evals.find(e=>e.id===btn.dataset.eval);
        if (ev) openEvaluationForm(goal, ev.pillarIdx||0, ev.metaIdx||0, evals, ev);
      });
    });
  }

  // Wire new evaluation buttons
  el.querySelectorAll('.goal-aval-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const goal = allGoals.find(g=>g.id===btn.dataset.id);
      if (!goal) return;
      const evals = await fetchEvaluations(goal.id).catch(()=>[]);
      openEvaluationForm(goal, 0, 0, evals, null);
    });
  });
}

/* ─── Goal form (create / edit) ──────────────────────────── */
async function openGoalForm(container, goalId) {
  let goal = goalId ? await fetchGoal(goalId).catch(()=>null) : null;
  if (!goal) goal = emptyGoal();

  // Deep-copy for editing
  let draft = JSON.parse(JSON.stringify(goal));

  // Use allUsers if available, fall back to store, then fetch directly
  let users = allUsers.length ? allUsers : (store.get('users')||[]);
  if (!users.length) {
    try {
      const { getDocs, collection, query, orderBy } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      const { db } = await import('../firebase.js');
      const snap = await getDocs(query(collection(db, 'users'), orderBy('name', 'asc')));
      users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      allUsers = users;
      store.set('users', users);
    } catch(e) { console.warn('users fetch failed:', e.message); }
  }

  modal.open({
    title: goalId ? 'Editar Meta' : 'Nova Meta',
    size: 'xl',
    content: buildGoalFormHTML(draft, users),
    footer: [
      { label:'Cancelar', class:'btn-secondary', closeOnClick:true },
      { label: goalId ? 'Salvar' : 'Criar meta', class:'btn-primary', closeOnClick:false,
        onClick: async (_,{close}) => {
          // Read form into draft
          readFormIntoDraft(draft);
          const warnings = validateGoalWeights(draft);
          if (warnings.length) {
            toast.error('⚠ ' + warnings[0] + (warnings.length>1?` (+${warnings.length-1} mais)`:''));
          }
          try {
            const savedId = await saveGoal(goalId||null, draft);
            if (!goalId) allGoals.unshift({...draft, id:savedId});
            else { const idx=allGoals.findIndex(g=>g.id===goalId); if(idx>=0) allGoals[idx]={...draft,id:goalId}; }
            close();
            renderGoalsList(container);
            toast.success(goalId?'Meta salva!':'Meta criada!');
          } catch(e) { toast.error('Erro: '+e.message); }
        }
      }
    ],
  });
  // modal.open doesn't support onOpen — wire form after DOM is inserted
  setTimeout(() => wireGoalForm(draft), 0);
}

function buildGoalFormHTML(draft, users) {
  const LBL = `font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;`;
  const userOpts = `<option value="">—</option>` +
    users.map(u=>`<option value="${esc(u.id)}" ${draft.responsavelId===u.id?'selected':''}>${esc(u.name)}</option>`).join('');
  const gestorOpts = `<option value="">—</option>` +
    users.map(u=>`<option value="${esc(u.id)}" ${draft.gestorId===u.id?'selected':''}>${esc(u.name)}</option>`).join('');
  const nucleoOpts = `<option value="">—</option>` +
    NUCLEOS.map(n=>`<option value="${esc(n.value)}" ${draft.nucleo===n.value?'selected':''}>${esc(n.label)}</option>`).join('');

  return `<div style="display:flex;flex-direction:column;gap:20px;">

    <!-- Cabeçalho da meta -->
    <div style="background:var(--bg-surface);border-radius:var(--radius-md);padding:18px 20px;">
      <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;
        color:var(--brand-gold);margin-bottom:14px;">Dados da Meta</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="${LBL}">Escopo</label>
          <select id="gf-escopo" class="filter-select" style="width:100%;">
            ${GOAL_SCOPES.map(s=>`<option value="${s.value}" ${draft.escopo===s.value?'selected':''}>${s.icon} ${s.label}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="${LBL}">Núcleo</label>
          <select id="gf-nucleo" class="filter-select" style="width:100%;">${nucleoOpts}</select>
        </div>
        <div>
          <label style="${LBL}">Responsável</label>
          <select id="gf-responsavel" class="filter-select" style="width:100%;">${userOpts}</select>
        </div>
        <div>
          <label style="${LBL}">Gestor</label>
          <select id="gf-gestor" class="filter-select" style="width:100%;">${gestorOpts}</select>
        </div>
        <div>
          <label style="${LBL}">Área / Setor <span style="font-weight:400;color:var(--text-muted);">(automático)</span></label>
          <input type="text" id="gf-setor" class="portal-field" style="width:100%;"
            value="${esc(draft.setor)}" readonly>
        </div>
        <div>
          <label style="${LBL}">Cargo do responsável</label>
          <input type="text" id="gf-cargo" class="portal-field" style="width:100%;"
            value="${esc(draft.cargo||'')}" placeholder="Ex: Coordenador de Marketing">
        </div>
        <div style="grid-column:span 2;">
          <label style="${LBL}">Objetivo geral do núcleo / equipe</label>
          <input type="text" id="gf-objetivo" class="portal-field" style="width:100%;"
            value="${esc(draft.objetivoNucleo)}" placeholder="Descreva o objetivo macro desta meta">
        </div>
        <div>
          <label style="${LBL}">Data de início</label>
          <input type="date" id="gf-inicio" class="portal-field" style="width:100%;"
            value="${esc(draft.inicio)}">
        </div>
        <div>
          <label style="${LBL}">Data de fim</label>
          <input type="date" id="gf-fim" class="portal-field" style="width:100%;"
            value="${esc(draft.fim)}">
        </div>
        <div>
          <label style="${LBL}">Tipo</label>
          <input type="text" id="gf-tipo" class="portal-field" style="width:100%;"
            value="${esc(draft.tipo)}" placeholder="Ex: Produtividade">
        </div>
      </div>
    </div>

    <!-- Pilares -->
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div>
          <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--brand-gold);">
            Pilares
          </div>
          <div id="gf-pilar-warning" style="font-size:0.75rem;color:#F59E0B;margin-top:2px;display:none;">
            ⚠ Ponderação dos pilares ≠ 100%
          </div>
        </div>
        <button type="button" id="gf-add-pilar" class="btn btn-secondary btn-sm"
          style="font-size:0.8125rem;">+ Pilar</button>
      </div>
      <div id="gf-pilares"></div>
    </div>
  </div>`;
}

function renderPilarHTML(pilar, pi) {
  const LBL = `font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;`;
  return `
  <div class="gf-pilar-card" data-pi="${pi}"
    style="background:var(--bg-surface);border:1px solid var(--border-subtle);
    border-radius:var(--radius-md);padding:16px 18px;margin-bottom:12px;">

    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
      <div style="background:var(--brand-gold);color:#fff;border-radius:50%;width:22px;height:22px;
        display:flex;align-items:center;justify-content:center;font-size:0.625rem;font-weight:800;flex-shrink:0;">
        ${pi+1}
      </div>
      <input type="text" class="portal-field gf-pilar-titulo" data-pi="${pi}"
        value="${esc(pilar.titulo)}" placeholder="Título do pilar"
        style="flex:1;font-weight:600;font-size:0.9375rem;">
      <div style="display:flex;align-items:center;gap:6px;">
        <label style="font-size:0.75rem;color:var(--text-muted);">Ponderação:</label>
        <input type="number" class="portal-field gf-pilar-pond" data-pi="${pi}"
          value="${pilar.ponderacao||0}" min="0" max="100" step="1"
          style="width:65px;font-size:0.875rem;text-align:right;">
        <span style="font-size:0.875rem;color:var(--text-muted);">%</span>
      </div>
      <button type="button" class="gf-del-pilar btn btn-ghost btn-sm" data-pi="${pi}"
        style="font-size:0.75rem;color:#EF4444;">✕</button>
    </div>

    <div style="margin-bottom:12px;">
      <label style="${LBL}">Objetivo do pilar</label>
      <textarea class="portal-field gf-pilar-obj" data-pi="${pi}" rows="2"
        style="width:100%;font-size:0.875rem;">${esc(pilar.objetivo)}</textarea>
    </div>

    <!-- Metas do pilar -->
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <div>
          <span style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;
            letter-spacing:.08em;color:var(--text-muted);">Metas</span>
          <span id="gf-meta-warning-${pi}" style="font-size:0.6875rem;color:#F59E0B;margin-left:8px;display:none;">
            ⚠ soma ≠ 100%
          </span>
        </div>
        <button type="button" class="gf-add-meta btn btn-ghost btn-sm" data-pi="${pi}"
          style="font-size:0.75rem;">+ Meta</button>
      </div>
      <div class="gf-metas-list" data-pi="${pi}">
        ${(pilar.metas||[]).map((meta,mi) => renderMetaHTML(meta,pi,mi)).join('')}
      </div>
    </div>
  </div>`;
}

function renderMetaHTML(meta, pi, mi) {
  const LBL = `font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;`;
  const prazoOpts = GOAL_PRAZO_TYPES.map(p=>
    `<option value="${p.value}" ${meta.prazoTipo===p.value?'selected':''}>${p.label}</option>`
  ).join('');

  return `
  <div class="gf-meta-card" data-pi="${pi}" data-mi="${mi}"
    style="background:var(--bg-dark);border-radius:var(--radius-sm);
    padding:14px 16px;margin-bottom:8px;border:1px solid var(--border-subtle);">

    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
      <span style="font-size:0.6875rem;font-weight:700;color:var(--text-muted);">
        Meta ${mi+1}
      </span>
      <input type="text" class="portal-field gf-meta-titulo" data-pi="${pi}" data-mi="${mi}"
        value="${esc(meta.titulo)}" placeholder="Título da meta"
        style="flex:1;font-size:0.875rem;font-weight:600;">
      <div style="display:flex;align-items:center;gap:5px;">
        <input type="number" class="portal-field gf-meta-pond" data-pi="${pi}" data-mi="${mi}"
          value="${meta.ponderacao||0}" min="0" max="100" step="1"
          style="width:60px;font-size:0.8125rem;text-align:right;">
        <span style="font-size:0.8125rem;color:var(--text-muted);">%</span>
      </div>
      <button type="button" class="gf-del-meta btn btn-ghost btn-sm"
        data-pi="${pi}" data-mi="${mi}" style="font-size:0.75rem;color:#EF4444;">✕</button>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      <div style="grid-column:span 2;">
        <label style="${LBL}">Descrição</label>
        <textarea class="portal-field gf-meta-desc" data-pi="${pi}" data-mi="${mi}" rows="2"
          style="width:100%;font-size:0.8125rem;">${esc(meta.descricao)}</textarea>
      </div>
      <div style="grid-column:span 2;">
        <label style="${LBL}">Critério de medição</label>
        <input type="text" class="portal-field gf-meta-criterio" data-pi="${pi}" data-mi="${mi}"
          value="${esc(meta.criterio)}" style="width:100%;font-size:0.8125rem;"
          placeholder="Como será medido o sucesso?">
      </div>
      <div>
        <label style="${LBL}">Prazo</label>
        <select class="filter-select gf-meta-prazo" data-pi="${pi}" data-mi="${mi}"
          style="width:100%;font-size:0.8125rem;">${prazoOpts}</select>
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding-top:22px;">
        <label style="display:flex;align-items:center;gap:6px;font-size:0.8125rem;cursor:pointer;">
          <input type="checkbox" class="gf-meta-recorr" data-pi="${pi}" data-mi="${mi}"
            ${meta.recorrencia?'checked':''}
            style="accent-color:var(--brand-gold);">
          Com recorrência
        </label>
      </div>
      <div class="gf-meta-custom-range" data-pi="${pi}" data-mi="${mi}"
        style="${meta.prazoTipo==='custom'?'display:grid;':'display:none;'}grid-template-columns:1fr 1fr;gap:8px;grid-column:span 2;">
        <div>
          <label style="${LBL}">Início personalizado</label>
          <input type="date" class="portal-field gf-meta-custom-ini" data-pi="${pi}" data-mi="${mi}"
            value="${esc(meta.prazoCustomInicio)}" style="width:100%;font-size:0.8125rem;">
        </div>
        <div>
          <label style="${LBL}">Fim personalizado</label>
          <input type="date" class="portal-field gf-meta-custom-fim" data-pi="${pi}" data-mi="${mi}"
            value="${esc(meta.prazoCustomFim)}" style="width:100%;font-size:0.8125rem;">
        </div>
      </div>
      <div>
        <label style="${LBL}">Periodicidade de avaliação</label>
        <select class="filter-select gf-meta-period" data-pi="${pi}" data-mi="${mi}"
          style="width:100%;font-size:0.8125rem;">
          ${GOAL_PRAZO_TYPES.map(p=>`<option value="${p.value}" ${meta.periodicidadeTipo===p.value?'selected':''}>${p.label}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding-top:22px;">
        <label style="display:flex;align-items:center;gap:6px;font-size:0.8125rem;cursor:pointer;">
          <input type="checkbox" class="gf-meta-recorr-aval" data-pi="${pi}" data-mi="${mi}"
            ${meta.recorrenciaAval?'checked':''}
            style="accent-color:var(--brand-gold);">
          Avaliação recorrente
        </label>
      </div>
    </div>

    <!-- KPIs -->
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div>
          <span style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;
            letter-spacing:.08em;color:var(--text-muted);">KPIs</span>
          <span id="gf-kpi-warning-${pi}-${mi}"
            style="font-size:0.6875rem;color:#F59E0B;margin-left:6px;display:none;">
            ⚠ soma ≠ 100%
          </span>
        </div>
        <button type="button" class="gf-add-kpi btn btn-ghost btn-sm"
          data-pi="${pi}" data-mi="${mi}" style="font-size:0.75rem;">+ KPI</button>
      </div>
      <div class="gf-kpis-list" data-pi="${pi}" data-mi="${mi}">
        ${(meta.kpis||[]).map((kpi,ki)=>renderKpiHTML(kpi,pi,mi,ki)).join('')}
      </div>
    </div>
  </div>`;
}

function renderKpiHTML(kpi, pi, mi, ki) {
  return `
  <div class="gf-kpi-row" data-pi="${pi}" data-mi="${mi}" data-ki="${ki}"
    style="display:flex;align-items:center;gap:8px;padding:6px 0;
    border-bottom:1px solid var(--border-subtle);">
    <span style="font-size:0.6875rem;color:var(--text-muted);min-width:40px;">KPI ${ki+1}</span>
    <input type="text" class="portal-field gf-kpi-desc" data-pi="${pi}" data-mi="${mi}" data-ki="${ki}"
      value="${esc(kpi.descricao)}" placeholder="Descrição do KPI"
      style="flex:1;font-size:0.8125rem;">
    <input type="number" class="portal-field gf-kpi-peso" data-pi="${pi}" data-mi="${mi}" data-ki="${ki}"
      value="${kpi.peso||0}" min="0" max="100" step="1"
      style="width:60px;font-size:0.8125rem;text-align:right;">
    <span style="font-size:0.8125rem;color:var(--text-muted);">%</span>
    <button type="button" class="gf-del-kpi btn btn-ghost btn-sm"
      data-pi="${pi}" data-mi="${mi}" data-ki="${ki}"
      style="font-size:0.75rem;color:#EF4444;padding:2px 5px;">✕</button>
  </div>`;
}

function wireGoalForm(draft) {
  const pilaresEl = document.getElementById('gf-pilares');
  if (!pilaresEl) return;

  const rerenderPilares = () => {
    pilaresEl.innerHTML = draft.pilares.map((p,pi)=>renderPilarHTML(p,pi)).join('');
    wireAllPilarEvents();
    updateWeightWarnings();
  };

  const updateWeightWarnings = () => {
    // Pilar sum
    const ps = draft.pilares.reduce((s,p)=>s+(Number(p.ponderacao)||0),0);
    const pw = document.getElementById('gf-pilar-warning');
    if (pw) pw.style.display = Math.abs(ps-100)>0.1?'block':'none';
    // Per-pilar meta sum
    draft.pilares.forEach((pilar,pi) => {
      const ms = pilar.metas.reduce((s,m)=>s+(Number(m.ponderacao)||0),0);
      const mw = document.getElementById(`gf-meta-warning-${pi}`);
      if (mw) mw.style.display = Math.abs(ms-100)>0.1?'block':'none';
      // Per-meta KPI sum
      pilar.metas.forEach((meta,mi) => {
        const ks = meta.kpis.reduce((s,k)=>s+(Number(k.peso)||0),0);
        const kw = document.getElementById(`gf-kpi-warning-${pi}-${mi}`);
        if (kw) kw.style.display = meta.kpis.length&&Math.abs(ks-100)>0.1?'block':'none';
      });
    });
  };

  const wireAllPilarEvents = () => {
    // Pilar title / ponderacao / objetivo
    pilaresEl.querySelectorAll('.gf-pilar-titulo').forEach(el => {
      el.addEventListener('input', () => { draft.pilares[+el.dataset.pi].titulo = el.value; });
    });
    pilaresEl.querySelectorAll('.gf-pilar-pond').forEach(el => {
      el.addEventListener('input', () => { draft.pilares[+el.dataset.pi].ponderacao = Number(el.value); updateWeightWarnings(); });
    });
    pilaresEl.querySelectorAll('.gf-pilar-obj').forEach(el => {
      el.addEventListener('input', () => { draft.pilares[+el.dataset.pi].objetivo = el.value; });
    });
    pilaresEl.querySelectorAll('.gf-del-pilar').forEach(btn => {
      btn.addEventListener('click', () => {
        if (draft.pilares.length<=1) { toast.error('A meta precisa de pelo menos 1 pilar.'); return; }
        draft.pilares.splice(+btn.dataset.pi,1);
        rerenderPilares();
      });
    });
    // Add meta
    pilaresEl.querySelectorAll('.gf-add-meta').forEach(btn => {
      btn.addEventListener('click', () => {
        draft.pilares[+btn.dataset.pi].metas.push(emptyMeta());
        rerenderPilares();
      });
    });
    // Meta fields
    pilaresEl.querySelectorAll('.gf-meta-titulo').forEach(el => {
      el.addEventListener('input', () => { draft.pilares[+el.dataset.pi].metas[+el.dataset.mi].titulo=el.value; });
    });
    pilaresEl.querySelectorAll('.gf-meta-pond').forEach(el => {
      el.addEventListener('input', () => { draft.pilares[+el.dataset.pi].metas[+el.dataset.mi].ponderacao=Number(el.value); updateWeightWarnings(); });
    });
    pilaresEl.querySelectorAll('.gf-meta-desc').forEach(el => {
      el.addEventListener('input', () => { draft.pilares[+el.dataset.pi].metas[+el.dataset.mi].descricao=el.value; });
    });
    pilaresEl.querySelectorAll('.gf-meta-criterio').forEach(el => {
      el.addEventListener('input', () => { draft.pilares[+el.dataset.pi].metas[+el.dataset.mi].criterio=el.value; });
    });
    pilaresEl.querySelectorAll('.gf-meta-prazo').forEach(el => {
      el.addEventListener('change', () => {
        const m=draft.pilares[+el.dataset.pi].metas[+el.dataset.mi];
        m.prazoTipo=el.value;
        const cr=pilaresEl.querySelector(`.gf-meta-custom-range[data-pi="${el.dataset.pi}"][data-mi="${el.dataset.mi}"]`);
        if (cr) cr.style.display=el.value==='custom'?'grid':'none';
      });
    });
    pilaresEl.querySelectorAll('.gf-meta-recorr').forEach(el => {
      el.addEventListener('change', () => { draft.pilares[+el.dataset.pi].metas[+el.dataset.mi].recorrencia=el.checked; });
    });
    pilaresEl.querySelectorAll('.gf-meta-custom-ini').forEach(el => {
      el.addEventListener('input', () => { draft.pilares[+el.dataset.pi].metas[+el.dataset.mi].prazoCustomInicio=el.value; });
    });
    pilaresEl.querySelectorAll('.gf-meta-custom-fim').forEach(el => {
      el.addEventListener('input', () => { draft.pilares[+el.dataset.pi].metas[+el.dataset.mi].prazoCustomFim=el.value; });
    });
    pilaresEl.querySelectorAll('.gf-meta-period').forEach(el => {
      el.addEventListener('change', () => { draft.pilares[+el.dataset.pi].metas[+el.dataset.mi].periodicidadeTipo=el.value; });
    });
    pilaresEl.querySelectorAll('.gf-meta-recorr-aval').forEach(el => {
      el.addEventListener('change', () => { draft.pilares[+el.dataset.pi].metas[+el.dataset.mi].recorrenciaAval=el.checked; });
    });
    pilaresEl.querySelectorAll('.gf-del-meta').forEach(btn => {
      btn.addEventListener('click', () => {
        const metas=draft.pilares[+btn.dataset.pi].metas;
        if (metas.length<=1) { toast.error('O pilar precisa de pelo menos 1 meta.'); return; }
        metas.splice(+btn.dataset.mi,1);
        rerenderPilares();
      });
    });
    // KPIs
    pilaresEl.querySelectorAll('.gf-add-kpi').forEach(btn => {
      btn.addEventListener('click', () => {
        draft.pilares[+btn.dataset.pi].metas[+btn.dataset.mi].kpis.push(emptyKpi());
        rerenderPilares();
      });
    });
    pilaresEl.querySelectorAll('.gf-kpi-desc').forEach(el => {
      el.addEventListener('input', () => { draft.pilares[+el.dataset.pi].metas[+el.dataset.mi].kpis[+el.dataset.ki].descricao=el.value; });
    });
    pilaresEl.querySelectorAll('.gf-kpi-peso').forEach(el => {
      el.addEventListener('input', () => { draft.pilares[+el.dataset.pi].metas[+el.dataset.mi].kpis[+el.dataset.ki].peso=Number(el.value); updateWeightWarnings(); });
    });
    pilaresEl.querySelectorAll('.gf-del-kpi').forEach(btn => {
      btn.addEventListener('click', () => {
        const kpis=draft.pilares[+btn.dataset.pi].metas[+btn.dataset.mi].kpis;
        if (kpis.length<=1) { toast.error('A meta precisa de pelo menos 1 KPI.'); return; }
        kpis.splice(+btn.dataset.ki,1);
        rerenderPilares();
      });
    });
  };

  // Header fields
  document.getElementById('gf-responsavel')?.addEventListener('change', e => {
    draft.responsavelId = e.target.value;
    // Auto-fill setor from user
    const u = (store.get('users')||[]).find(u=>u.id===e.target.value);
    if (u?.sector||u?.department) {
      const sEl = document.getElementById('gf-setor');
      if (sEl) { sEl.value = u.sector||u.department||''; draft.setor = sEl.value; }
    }
  });
  document.getElementById('gf-gestor')?.addEventListener('change', e => { draft.gestorId = e.target.value; });
  document.getElementById('gf-escopo')?.addEventListener('change', e => { draft.escopo = e.target.value; });
  document.getElementById('gf-nucleo')?.addEventListener('change', e => { draft.nucleo = e.target.value; });
  document.getElementById('gf-cargo')?.addEventListener('input', e => { draft.cargo = e.target.value; });
  document.getElementById('gf-objetivo')?.addEventListener('input', e => { draft.objetivoNucleo = e.target.value; });
  document.getElementById('gf-inicio')?.addEventListener('input', e => { draft.inicio = e.target.value; });
  document.getElementById('gf-fim')?.addEventListener('input', e => { draft.fim = e.target.value; });
  document.getElementById('gf-tipo')?.addEventListener('input', e => { draft.tipo = e.target.value; });

  // Add pilar button
  document.getElementById('gf-add-pilar')?.addEventListener('click', () => {
    draft.pilares.push(emptyPilar());
    rerenderPilares();
  });

  rerenderPilares();
}

function readFormIntoDraft(draft) {
  // Header fields already wired live. Just sync pilares structure read-only pass is redundant.
  // All inputs wired live via wireGoalForm.
}

/* ─── Evaluation form ────────────────────────────────────── */
function openEvaluationForm(goal, pillarIdx, metaIdx, existingEvals, existingEval) {
  const uid      = store.get('currentUser')?.uid;
  const isGestor = goal.gestorId===uid||store.isMaster()||store.can('system_manage_roles');
  if (!isGestor) { toast.error('Apenas o gestor pode registrar avaliações.'); return; }

  const pilar = goal.pilares?.[pillarIdx];
  const meta  = pilar?.metas?.[metaIdx];
  if (!meta) { toast.error('Meta não encontrada.'); return; }

  const kpiScores = existingEval?.kpiScores
    || (meta.kpis||[]).map(()=>({score:null,comentario:''}));

  const periods = getPendingPeriods(meta, existingEvals);
  const LBL = `font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;`;

  const pilarOpts = (goal.pilares||[]).map((p,pi)=>
    `<option value="${pi}" ${pi===pillarIdx?'selected':''}>${esc(p.titulo||`Pilar ${pi+1}`)}</option>`
  ).join('');
  const metaOpts  = (pilar?.metas||[]).map((m,mi)=>
    `<option value="${mi}" ${mi===metaIdx?'selected':''}>${esc(m.titulo||`Meta ${mi+1}`)}</option>`
  ).join('');
  const periodOpts = periods.length
    ? periods.map(p=>`<option value="${esc(p.key)}" ${existingEval?.periodoRef===p.key?'selected':''}>${esc(p.label)}</option>`).join('')
    : `<option value="unico">Avaliação única</option>`;

  let liveScore = { progress: existingEval?.progressoCalculado||0 };

  modal.open({
    title: 'Registrar Avaliação',
    size:  'lg',
    content: `<div style="display:flex;flex-direction:column;gap:16px;">

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
        <div>
          <label style="${LBL}">Pilar</label>
          <select id="ev-pilar" class="filter-select" style="width:100%;">${pilarOpts}</select>
        </div>
        <div>
          <label style="${LBL}">Meta</label>
          <select id="ev-meta" class="filter-select" style="width:100%;">${metaOpts}</select>
        </div>
        <div>
          <label style="${LBL}">Período de referência</label>
          <select id="ev-periodo" class="filter-select" style="width:100%;">${periodOpts}</select>
        </div>
      </div>

      <!-- Progress bar live -->
      <div style="background:var(--bg-surface);border-radius:var(--radius-md);padding:14px 16px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span style="font-size:0.8125rem;font-weight:600;">Progresso calculado</span>
          <span id="ev-progress-label" style="font-size:1rem;font-weight:700;color:var(--brand-gold);">
            ${liveScore.progress.toFixed(1)}%
          </span>
        </div>
        <div style="height:10px;background:var(--border-subtle);border-radius:5px;overflow:hidden;">
          <div id="ev-progress-bar" style="height:100%;width:${Math.min(liveScore.progress,100)}%;
            background:var(--brand-gold);border-radius:5px;transition:width .4s;"></div>
        </div>
        <div id="ev-incomplete-badge" style="font-size:0.75rem;color:#F59E0B;margin-top:6px;display:none;">
          ⚠ Avaliação parcial — nem todos os KPIs foram preenchidos
        </div>
      </div>

      <!-- KPI scores -->
      <div>
        <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;
          letter-spacing:.1em;color:var(--text-muted);margin-bottom:10px;">KPIs</div>
        <div id="ev-kpis-list">
          ${(meta.kpis||[]).map((kpi,ki) => `
          <div style="background:var(--bg-surface);border-radius:var(--radius-sm);
            padding:12px 14px;margin-bottom:8px;border:1px solid var(--border-subtle);">
            <div style="font-size:0.8125rem;font-weight:600;margin-bottom:8px;">
              KPI ${ki+1}: ${esc(kpi.descricao||`KPI ${ki+1}`)}
              <span style="font-weight:400;color:var(--text-muted);margin-left:6px;">Peso: ${kpi.peso||0}%</span>
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <label style="font-size:0.75rem;font-weight:600;white-space:nowrap;">Nota (%):</label>
              <input type="number" class="portal-field ev-kpi-score" data-ki="${ki}"
                value="${kpiScores[ki]?.score??''}" min="0" max="100" step="0.1"
                style="width:80px;font-size:0.875rem;text-align:right;"
                placeholder="0–100">
              <input type="text" class="portal-field ev-kpi-comment" data-ki="${ki}"
                value="${esc(kpiScores[ki]?.comentario||'')}"
                placeholder="Comentário (opcional)"
                style="flex:1;min-width:160px;font-size:0.8125rem;">
            </div>
          </div>`).join('')}
        </div>
      </div>
    </div>`,
    footer: [
      { label:'Cancelar', class:'btn-secondary', closeOnClick:true },
      { label:'Salvar avaliação', class:'btn-primary', closeOnClick:false,
        onClick: async (_,{close}) => {
          const scores = [...document.querySelectorAll('.ev-kpi-score')].map((el,ki) => ({
            score:      el.value!==''?Number(el.value):null,
            comentario: document.querySelector(`.ev-kpi-comment[data-ki="${ki}"]`)?.value||'',
          }));

          // Calculate progress for this evaluation
          let ms=0, pw=0;
          scores.forEach((s,ki) => {
            if (s.score===null) return;
            const kp=(Number(meta.kpis[ki]?.peso)||0)/100;
            ms+=s.score*kp; pw+=kp;
          });
          const progress = pw>0 ? Math.round(ms/pw*100)/100 : 0;
          const isPartial = pw < (meta.kpis.reduce((s,k)=>s+(Number(k.peso)||0)/100,0)) - 0.01;

          const evalData = {
            goalId:    goal.id,
            pillarIdx,
            metaIdx,
            periodoRef:   document.getElementById('ev-periodo')?.value||'',
            kpiScores:    scores,
            progressoCalculado: progress,
            status:       isPartial ? 'parcial' : 'completa',
            gestorId:     uid,
          };

          try {
            await saveEvaluation(existingEval?.id||null, evalData);
            close();
            toast.success('Avaliação salva!');
            // Reload evaluations tab
            activeTab = 'avaliacoes';
            allGoals = await fetchGoals().catch(()=>allGoals);
            const container = document.querySelector('[id="goals-content"]')?.closest('.page-content,main,#app>div');
            if (container) renderAvaliacoes(container);
          } catch(e) { toast.error('Erro: '+e.message); }
        }
      }
    ],
  });

  // modal.open doesn't support onOpen — wire live progress recalc after DOM is inserted
  setTimeout(() => {
    const recalc = () => {
      const scores = [...document.querySelectorAll('.ev-kpi-score')].map(el=>
        el.value!==''?Number(el.value):null
      );
      let ms=0,pw=0,filled=0;
      scores.forEach((sc,ki) => {
        if (sc===null) return;
        const kp=(Number(meta.kpis[ki]?.peso)||0)/100;
        ms+=sc*kp; pw+=kp; filled++;
      });
      const progress = pw>0?Math.round(ms/pw*100)/100:0;
      const lbl   = document.getElementById('ev-progress-label');
      const bar   = document.getElementById('ev-progress-bar');
      const badge = document.getElementById('ev-incomplete-badge');
      if (lbl)   lbl.textContent = progress.toFixed(1)+'%';
      if (bar)   bar.style.width = Math.min(progress,100)+'%';
      const totalPeso = meta.kpis.reduce((s,k)=>s+(Number(k.peso)||0)/100,0);
      if (badge) badge.style.display = filled>0&&pw<totalPeso-0.01?'block':'none';
    };
    document.querySelectorAll('.ev-kpi-score').forEach(el => el.addEventListener('input', recalc));
  }, 0);
}

/* ─── Exports ────────────────────────────────────────────── */
async function exportGoalsXls() {
  if (!allGoals.length) { toast.error('Nenhuma meta.'); return; }
  if (!window.XLSX) await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload=res; s.onerror=rej; document.head.appendChild(s); });
  const rows=[['Escopo','Objetivo','Responsável','Gestor','Setor','Status','Pilares','Metas','Início','Fim']];
  allGoals.forEach(g => {
    const resp  = (store.get('users')||[]).find(u=>u.id===g.responsavelId)?.name||'—';
    const gestor= (store.get('users')||[]).find(u=>u.id===g.gestorId)?.name||'—';
    rows.push([
      GOAL_SCOPES.find(s=>s.value===g.escopo)?.label||g.escopo||'—',
      g.objetivoNucleo||g.pilares?.[0]?.titulo||'—', resp, gestor,
      g.setor||'—', g.status||'—',
      (g.pilares||[]).length, (g.pilares||[]).reduce((s,p)=>s+(p.metas||[]).length,0),
      fmtDate(g.inicio), fmtDate(g.fim),
    ]);
    // Sub-rows for each meta
    (g.pilares||[]).forEach((pilar,pi) => {
      (pilar.metas||[]).forEach((meta,mi) => {
        rows.push(['','','','','',
          `  Pilar ${pi+1}: ${pilar.titulo||''}`,
          `  Meta ${mi+1}: ${meta.titulo||''}`,
          `  Pond: ${meta.ponderacao||0}%`,
          meta.criterio||'',
          `${meta.prazoTipo||''} ${meta.recorrencia?'(recorrente)':''}`,
        ]);
      });
    });
  });
  const wb=window.XLSX.utils.book_new();
  const ws=window.XLSX.utils.aoa_to_sheet(rows);
  ws['!cols']=[15,40,20,20,15,12,8,8,12,12].map(w=>({wch:w}));
  window.XLSX.utils.book_append_sheet(wb,ws,'Metas');
  window.XLSX.writeFile(wb,`primetour_metas_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast.success('XLS exportado.');
}

async function exportGoalsPdf() {
  if (!allGoals.length) { toast.error('Nenhuma meta.'); return; }
  if (!window.jspdf) {
    await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'; s.onload=res; s.onerror=rej; document.head.appendChild(s); });
    await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'; s.onload=res; s.onerror=rej; document.head.appendChild(s); });
  }
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
  doc.setFontSize(14);doc.setFont('helvetica','bold');doc.setTextColor(36,35,98);
  doc.text('PRIMETOUR — Quadro de Metas',14,16);
  doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(100,100,100);
  doc.text(`Gerado em ${new Date().toLocaleDateString('pt-BR')} · ${allGoals.length} metas`,14,22);
  const rows=[];
  allGoals.forEach(g => {
    const resp=(store.get('users')||[]).find(u=>u.id===g.responsavelId)?.name||'—';
    const gestor=(store.get('users')||[]).find(u=>u.id===g.gestorId)?.name||'—';
    (g.pilares||[]).forEach((pilar,pi) => {
      (pilar.metas||[]).forEach((meta,mi) => {
        rows.push([
          GOAL_SCOPES.find(s=>s.value===g.escopo)?.label||'—',
          (g.objetivoNucleo||'').slice(0,30),
          (pilar.titulo||`Pilar ${pi+1}`).slice(0,25),
          (meta.titulo||`Meta ${mi+1}`).slice(0,30),
          `${meta.ponderacao||0}%`,
          meta.criterio?.slice(0,30)||'—',
          GOAL_PRAZO_TYPES.find(p=>p.value===meta.prazoTipo)?.label||'—',
          resp.slice(0,15), gestor.slice(0,15), g.status||'—',
        ]);
      });
    });
  });
  doc.autoTable({
    startY:27,
    head:[['Escopo','Objetivo','Pilar','Meta','Pond.','Critério','Prazo','Responsável','Gestor','Status']],
    body: rows,
    styles:{fontSize:7,cellPadding:2},
    headStyles:{fillColor:[36,35,98],textColor:255,fontStyle:'bold'},
    alternateRowStyles:{fillColor:[248,247,244]},
    columnStyles:{0:{cellWidth:18},1:{cellWidth:30},2:{cellWidth:25},3:{cellWidth:30},4:{cellWidth:12},5:{cellWidth:28},6:{cellWidth:18},7:{cellWidth:20},8:{cellWidth:20},9:{cellWidth:14}},
  });
  doc.save(`primetour_metas_${new Date().toISOString().slice(0,10)}.pdf`);
  toast.success('PDF exportado.');
}
