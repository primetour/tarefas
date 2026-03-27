/**
 * PRIMETOUR — Metas v2
 * Formulário por Pilares, Metas por KPI, Avaliação pelo Gestor
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import {
  fetchGoals, fetchGoal, saveGoal, deleteGoal, publishGoal,
  fetchEvaluations, saveEvaluation, deleteEvaluation,
  calcGoalProgress, generatePendingPeriods,
  GOAL_SCOPES, GOAL_PERIODS,
} from '../services/goals.js';
import { NUCLEOS } from '../services/tasks.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = ts => ts?.toDate ? ts.toDate().toLocaleDateString('pt-BR') : ts ? new Date(ts).toLocaleDateString('pt-BR') : '—';
const LBL = `font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;color:var(--text-muted);`;
const FIELD = `width:100%;`;

let allGoals = [];
let activeTab = 'list'; // 'list' | 'evaluation'
let searchQ = '';
let statusF = '';

/* ─── Main render ─────────────────────────────────────────── */
export async function renderGoals(container) {
  const canManage = store.isMaster() || store.can('system_manage_users');
  const curUser   = store.get('currentUser');

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Metas</h1>
        <p class="page-subtitle">Gestão de metas por pilares, KPIs e avaliação de desempenho</p>
      </div>
      <div class="page-header-actions" style="gap:8px;">
        <button class="btn btn-secondary btn-sm" id="goal-export-xls">↓ XLS</button>
        <button class="btn btn-secondary btn-sm" id="goal-export-pdf">↓ PDF</button>
        ${canManage ? `<button class="btn btn-primary" id="new-goal-btn">+ Nova Meta</button>` : ''}
      </div>
    </div>

    <!-- Tabs -->
    <div style="display:flex;gap:0;border-bottom:1px solid var(--border-subtle);margin-bottom:20px;">
      <button class="goal-tab" data-tab="list"
        style="padding:8px 18px;border:none;background:none;cursor:pointer;font-size:0.875rem;
        color:var(--brand-gold);border-bottom:2px solid var(--brand-gold);transition:all .15s;">
        📋 Quadro de Metas
      </button>
      <button class="goal-tab" data-tab="evaluation"
        style="padding:8px 18px;border:none;background:none;cursor:pointer;font-size:0.875rem;
        color:var(--text-muted);border-bottom:2px solid transparent;transition:all .15s;">
        📊 Avaliação
      </button>
    </div>

    <!-- Filters -->
    <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
      <input type="text" id="goal-search" class="portal-field"
        placeholder="Buscar por título, responsável, setor…"
        style="flex:1;min-width:180px;font-size:0.875rem;">
      <select id="goal-status-filter" class="filter-select" style="min-width:150px;">
        <option value="">Todos os status</option>
        <option value="rascunho">Rascunho</option>
        <option value="publicada">Publicada</option>
        <option value="encerrada">Encerrada</option>
      </select>
      <select id="goal-scope-filter" class="filter-select" style="min-width:140px;">
        <option value="">Todos os escopos</option>
        ${GOAL_SCOPES.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}
      </select>
    </div>

    <div id="goals-content">
      <div style="text-align:center;padding:40px;color:var(--text-muted);">⏳ Carregando…</div>
    </div>`;

  // Wire tabs
  container.querySelectorAll('.goal-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      container.querySelectorAll('.goal-tab').forEach(b => {
        b.style.color       = b.dataset.tab === activeTab ? 'var(--brand-gold)' : 'var(--text-muted)';
        b.style.borderBottom= b.dataset.tab === activeTab ? '2px solid var(--brand-gold)' : '2px solid transparent';
      });
      render();
    });
  });

  // Wire filters
  document.getElementById('goal-search')?.addEventListener('input', e => { searchQ = e.target.value.toLowerCase(); render(); });
  document.getElementById('goal-status-filter')?.addEventListener('change', e => { statusF = e.target.value; render(); });
  document.getElementById('goal-scope-filter')?.addEventListener('change', () => render());

  // Wire new goal
  document.getElementById('new-goal-btn')?.addEventListener('click', () => openGoalForm(container));

  // Exports
  document.getElementById('goal-export-xls')?.addEventListener('click', () => exportXls());
  document.getElementById('goal-export-pdf')?.addEventListener('click', () => exportPdf());

  allGoals = await fetchGoals().catch(() => []);
  render();

  function render() {
    const el = document.getElementById('goals-content');
    if (!el) return;
    activeTab === 'evaluation' ? renderEvaluationTab(el, container) : renderList(el, container);
  }
}

/* ─── List view ────────────────────────────────────────────── */
function renderList(el, container) {
  const scopeF = document.getElementById('goal-scope-filter')?.value || '';
  let goals = allGoals.filter(g => {
    if (statusF && g.status !== statusF) return false;
    if (scopeF  && g.escopo !== scopeF)  return false;
    if (searchQ) {
      const hay = (g.titulo + g.objetivoNucleo + g.responsavelNome + g.setor + '').toLowerCase();
      if (!hay.includes(searchQ)) return false;
    }
    return true;
  });

  if (!goals.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">◎</div>
      <div class="empty-state-title">Nenhuma meta encontrada</div>
      <div class="empty-state-subtitle">Clique em "+ Nova Meta" para começar.</div>
    </div>`;
    return;
  }

  el.innerHTML = goals.map(goal => {
    const scope  = GOAL_SCOPES.find(s => s.value === goal.escopo) || GOAL_SCOPES[0];
    const status = goal.status || 'rascunho';
    const statusColors = { rascunho:'#6B7280', publicada:'#22C55E', encerrada:'#EF4444' };
    const statusLabel  = { rascunho:'Rascunho', publicada:'Publicada', encerrada:'Encerrada' };
    const numPilares = (goal.pilares || []).length;
    const numMetas   = (goal.pilares || []).reduce((a, p) => a + (p.metas || []).length, 0);
    const canEdit    = store.isMaster() || store.can('system_manage_users') ||
                       goal.gestorId === store.get('currentUser')?.uid;

    return `
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:12px;">
      <div style="height:4px;background:${statusColors[status]};"></div>
      <div style="padding:16px 20px;">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <span style="font-size:0.75rem;padding:2px 8px;border-radius:20px;
                background:var(--brand-gold)15;color:var(--brand-gold);font-weight:600;">
                ${scope.icon} ${scope.label}
              </span>
              <span style="font-size:0.75rem;padding:2px 8px;border-radius:20px;font-weight:600;
                background:${statusColors[status]}18;color:${statusColors[status]};">
                ${statusLabel[status]}
              </span>
            </div>
            <div style="font-weight:700;font-size:1rem;margin-bottom:4px;">
              ${esc(goal.titulo || 'Meta sem título')}
            </div>
            <div style="font-size:0.8125rem;color:var(--text-muted);">
              ${goal.responsavelNome ? `👤 ${esc(goal.responsavelNome)}` : ''}
              ${goal.gestorNome ? ` · Gestor: ${esc(goal.gestorNome)}` : ''}
              ${goal.setor ? ` · ${esc(goal.setor)}` : ''}
            </div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
              ${numPilares} pilar${numPilares!==1?'es':''} · ${numMetas} meta${numMetas!==1?'s':''}
              ${goal.inicio ? ` · Início: ${fmt(goal.inicio)}` : ''}
              ${goal.fim    ? ` · Fim: ${fmt(goal.fim)}`       : ''}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            <button class="btn btn-ghost btn-sm goal-view-btn" data-id="${esc(goal.id)}"
              style="font-size:0.75rem;">👁 Ver</button>
            ${canEdit ? `
              <button class="btn btn-ghost btn-sm goal-edit-btn" data-id="${esc(goal.id)}"
                style="font-size:0.75rem;color:var(--brand-gold);">✎</button>
              ${status === 'rascunho' ? `
                <button class="btn btn-primary btn-sm goal-publish-btn" data-id="${esc(goal.id)}"
                  style="font-size:0.75rem;">▶ Publicar</button>` : ''}
              <button class="btn btn-ghost btn-sm goal-del-btn" data-id="${esc(goal.id)}"
                data-title="${esc(goal.titulo||'')}"
                style="font-size:0.75rem;color:#EF4444;">✕</button>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.goal-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = allGoals.find(x => x.id === btn.dataset.id);
      if (g) openGoalViewer(g, container);
    });
  });
  el.querySelectorAll('.goal-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openGoalForm(container, btn.dataset.id));
  });
  el.querySelectorAll('.goal-publish-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Publicar esta meta? Após publicada, responsável e gestor serão notificados.')) return;
      await publishGoal(btn.dataset.id);
      toast.success('Meta publicada!');
      allGoals = await fetchGoals();
      renderList(el, container);
    });
  });
  el.querySelectorAll('.goal-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Excluir "${btn.dataset.title}"?`)) return;
      await deleteGoal(btn.dataset.id);
      toast.success('Meta excluída.');
      allGoals = await fetchGoals();
      renderList(el, container);
    });
  });
}

/* ─── Goal viewer ──────────────────────────────────────────── */
async function openGoalViewer(goal, container) {
  const evals = await fetchEvaluations(goal.id).catch(() => []);
  const progress = calcGoalProgress(goal, evals);

  const m = modal.open({
    title: goal.titulo || 'Meta',
    size: 'xl',
    content: buildViewerHTML(goal, evals, progress),
    footer: [{ label: 'Fechar', class: 'btn-secondary', closeOnClick: true }],
  });
}

function buildViewerHTML(goal, evals, progress) {
  const scope = GOAL_SCOPES.find(s => s.value === goal.escopo) || GOAL_SCOPES[0];

  return `
    <div style="display:flex;flex-direction:column;gap:20px;">

      <!-- Header info -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        ${[
          ['Escopo', `${scope.icon} ${scope.label}`],
          ['Status', goal.status || 'rascunho'],
          ['Responsável', goal.responsavelNome || '—'],
          ['Gestor', goal.gestorNome || '—'],
          ['Área/Setor', goal.setor || '—'],
          ['Cargo', goal.cargo || '—'],
          ['Início', fmt(goal.inicio)],
          ['Fim', fmt(goal.fim)],
        ].map(([l,v]) => `
          <div style="padding:10px 14px;background:var(--bg-surface);border-radius:var(--radius-sm);">
            <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;
              letter-spacing:.08em;color:var(--text-muted);margin-bottom:3px;">${l}</div>
            <div style="font-size:0.875rem;font-weight:500;">${esc(v)}</div>
          </div>`).join('')}
      </div>

      <!-- Progress -->
      <div style="background:var(--bg-surface);border-radius:var(--radius-md);padding:16px 20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:0.875rem;font-weight:600;">Progresso geral</span>
          <span style="font-size:1.25rem;font-weight:700;color:var(--brand-gold);">${progress}%</span>
        </div>
        <div style="height:8px;background:var(--bg-dark);border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${progress}%;background:var(--brand-gold);
            border-radius:4px;transition:width .5s;"></div>
        </div>
      </div>

      <!-- Pilares -->
      ${(goal.pilares || []).map((pilar, pIdx) => `
        <div style="border:1px solid var(--border-subtle);border-radius:var(--radius-md);overflow:hidden;">
          <div style="padding:12px 16px;background:var(--bg-surface);border-bottom:1px solid var(--border-subtle);
            display:flex;align-items:center;justify-content:space-between;">
            <div>
              <span style="font-weight:700;font-size:0.9375rem;">${esc(pilar.titulo || `Pilar ${pIdx+1}`)}</span>
              <span style="font-size:0.75rem;color:var(--text-muted);margin-left:8px;">
                Ponderação: ${pilar.ponderacao || 0}%
              </span>
            </div>
          </div>
          ${pilar.objetivo ? `<div style="padding:8px 16px;font-size:0.8125rem;color:var(--text-muted);
            border-bottom:1px solid var(--border-subtle);">${esc(pilar.objetivo)}</div>` : ''}
          <div style="padding:12px 16px;display:flex;flex-direction:column;gap:10px;">
            ${(pilar.metas || []).map((meta, mIdx) => {
              const latestEval = evals
                .filter(e => e.pilarIdx === pIdx && e.metaIdx === mIdx)
                .sort((a,b) => (b.createdAt?.toDate?.() || 0) - (a.createdAt?.toDate?.() || 0))[0];
              const metaProgress = latestEval ? calcMetaProgress(meta, latestEval) : null;
              return `
              <div style="background:var(--bg-dark);border-radius:var(--radius-sm);padding:12px 14px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                  <span style="font-weight:600;font-size:0.875rem;">${esc(meta.titulo || `Meta ${mIdx+1}`)}</span>
                  <span style="font-size:0.75rem;color:var(--text-muted);">${meta.ponderacao || 0}%</span>
                </div>
                ${meta.descricao ? `<div style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:8px;">
                  ${esc(meta.descricao)}</div>` : ''}
                ${meta.criterio ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:8px;">
                  Critério: ${esc(meta.criterio)}</div>` : ''}
                <!-- KPIs -->
                ${(meta.kpis || []).map((kpi, kIdx) => {
                  const score = latestEval?.kpiScores?.[kIdx];
                  return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;
                    border-top:1px solid var(--border-subtle);">
                    <span style="flex:1;font-size:0.8125rem;">${esc(kpi.descricao || `KPI ${kIdx+1}`)}</span>
                    <span style="font-size:0.75rem;color:var(--text-muted);">Peso: ${kpi.peso||0}%</span>
                    ${score ? `<span style="font-size:0.75rem;font-weight:600;color:var(--brand-gold);">
                      Nota: ${score.score}%</span>` : `<span style="font-size:0.75rem;color:var(--text-muted);">Não avaliado</span>`}
                  </div>`;
                }).join('')}
                ${metaProgress !== null ? `
                  <div style="margin-top:8px;display:flex;align-items:center;gap:8px;">
                    <div style="flex:1;height:4px;background:var(--bg-surface);border-radius:2px;">
                      <div style="height:100%;width:${metaProgress}%;background:var(--brand-gold);border-radius:2px;"></div>
                    </div>
                    <span style="font-size:0.75rem;color:var(--brand-gold);font-weight:600;">${metaProgress}%</span>
                  </div>` : ''}
              </div>`;
            }).join('')}
          </div>
        </div>`).join('')}
    </div>`;
}

function calcMetaProgress(meta, eval_) {
  if (!eval_?.kpiScores?.length) return null;
  let score = 0;
  (meta.kpis || []).forEach((kpi, kIdx) => {
    const s = eval_.kpiScores[kIdx]?.score ?? 0;
    score += (Number(s) * (Number(kpi.peso) || 0)) / 100;
  });
  return Math.round(score);
}

/* ─── Evaluation tab ───────────────────────────────────────── */
async function renderEvaluationTab(el, container) {
  const curUser  = store.get('currentUser');
  const isGestor = store.isMaster() || store.can('system_manage_users');

  // Goals where user is gestor or responsável
  const relevant = allGoals.filter(g =>
    g.status === 'publicada' &&
    (isGestor || g.gestorId === curUser?.uid || g.responsavelId === curUser?.uid)
  );

  if (!relevant.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📊</div>
      <div class="empty-state-title">Nenhuma meta publicada para avaliar</div>
    </div>`;
    return;
  }

  el.innerHTML = relevant.map(g => `
    <div class="card" style="padding:0;margin-bottom:12px;overflow:hidden;">
      <div style="padding:14px 20px;background:var(--bg-surface);border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-weight:700;">${esc(g.titulo)}</div>
          <div style="font-size:0.8125rem;color:var(--text-muted);">
            ${esc(g.responsavelNome || '')} · Gestor: ${esc(g.gestorNome || '')}
          </div>
        </div>
        ${(isGestor || g.gestorId === curUser?.uid) ? `
          <button class="btn btn-primary btn-sm eval-new-btn" data-id="${esc(g.id)}"
            style="font-size:0.8125rem;">+ Nova Avaliação</button>` : ''}
      </div>
      <div class="eval-list-${esc(g.id)}" style="padding:14px 20px;">
        <div style="color:var(--text-muted);font-size:0.875rem;">⏳ Carregando avaliações…</div>
      </div>
    </div>`).join('');

  // Load evaluations for each goal
  for (const g of relevant) {
    const evals = await fetchEvaluations(g.id).catch(() => []);
    const listEl = el.querySelector(`.eval-list-${g.id}`);
    if (!listEl) continue;

    if (!evals.length) {
      listEl.innerHTML = `<div style="color:var(--text-muted);font-size:0.875rem;">
        Nenhuma avaliação registrada ainda.</div>`;
    } else {
      listEl.innerHTML = evals.map(ev => {
        const progress = calcGoalProgress(g, [ev]);
        const isPartial = ev.status === 'parcial';
        return `
        <div style="display:flex;align-items:center;gap:12px;padding:8px 0;
          border-bottom:1px solid var(--border-subtle);">
          <div style="flex:1;">
            <span style="font-size:0.875rem;font-weight:600;">${esc(ev.periodoRef || 'Período não definido')}</span>
            ${isPartial ? `<span style="font-size:0.625rem;margin-left:6px;padding:1px 6px;border-radius:20px;
              background:#F59E0B18;color:#F59E0B;font-weight:600;">Parcial</span>` : ''}
            <span style="font-size:0.75rem;color:var(--text-muted);margin-left:8px;">
              ${fmt(ev.createdAt)}
            </span>
          </div>
          <span style="font-weight:700;color:var(--brand-gold);">${progress}%</span>
          ${(isGestor || g.gestorId === curUser?.uid) ? `
            <button class="btn btn-ghost btn-sm eval-edit-btn"
              data-goal-id="${esc(g.id)}" data-eval-id="${esc(ev.id)}"
              style="font-size:0.75rem;color:var(--brand-gold);">✎ Editar</button>
            <button class="btn btn-ghost btn-sm eval-del-btn"
              data-eval-id="${esc(ev.id)}"
              style="font-size:0.75rem;color:#EF4444;">✕</button>` : ''}
        </div>`;
      }).join('');
    }
  }

  // Wire buttons
  el.querySelectorAll('.eval-new-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = allGoals.find(x => x.id === btn.dataset.id);
      if (g) openEvaluationForm(g, null, () => renderEvaluationTab(el, container));
    });
  });
  el.querySelectorAll('.eval-edit-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const g  = allGoals.find(x => x.id === btn.dataset.goalId);
      const ev = (await fetchEvaluations(btn.dataset.goalId).catch(() => []))
        .find(e => e.id === btn.dataset.evalId);
      if (g && ev) openEvaluationForm(g, ev, () => renderEvaluationTab(el, container));
    });
  });
  el.querySelectorAll('.eval-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Excluir esta avaliação?')) return;
      await deleteEvaluation(btn.dataset.evalId);
      toast.success('Avaliação excluída.');
      renderEvaluationTab(el, container);
    });
  });
}

/* ─── Evaluation form ──────────────────────────────────────── */
function openEvaluationForm(goal, existingEval, onSave) {
  const MODAL_ID = 'eval-form-overlay';
  document.getElementById(MODAL_ID)?.remove();

  const periods = generatePendingPeriods(goal);

  // Build KPI rows
  const allKpiRows = [];
  (goal.pilares || []).forEach((pilar, pIdx) => {
    (pilar.metas || []).forEach((meta, mIdx) => {
      (meta.kpis || []).forEach((kpi, kIdx) => {
        const existing = (existingEval?.kpiScores || [])
          .find(s => s.pilarIdx === pIdx && s.metaIdx === mIdx && s.kpiIdx === kIdx);
        allKpiRows.push({ pilar, pIdx, meta, mIdx, kpi, kIdx, existing });
      });
    });
  });

  const overlay = document.createElement('div');
  overlay.id = MODAL_ID;
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:3000;
    display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;`;

  overlay.innerHTML = `
    <div class="card" style="width:100%;max-width:600px;padding:0;overflow:hidden;margin:auto;">
      <div style="padding:16px 22px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;justify-content:space-between;
        position:sticky;top:0;z-index:10;">
        <div style="font-weight:700;font-size:1rem;">
          ${existingEval ? 'Editar Avaliação' : 'Nova Avaliação'}
        </div>
        <button id="eval-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);padding:0 4px;">✕</button>
      </div>

      <div style="padding:20px 22px;display:flex;flex-direction:column;gap:14px;">

        <!-- Período -->
        <div>
          <label style="${LBL}">Período de referência *</label>
          ${periods.length ? `
            <select id="eval-period-sel" class="filter-select" style="${FIELD}">
              <option value="">Selecione…</option>
              ${periods.map(p => `<option value="${esc(p.label)}"
                ${existingEval?.periodoRef === p.label ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
              <option value="__custom__">Período personalizado…</option>
            </select>
            <input type="text" id="eval-period-txt" class="portal-field"
              style="${FIELD};margin-top:6px;display:${existingEval?.periodoRef && !periods.find(p=>p.label===existingEval.periodoRef) ? 'block' : 'none'};"
              value="${esc(existingEval?.periodoRef||'')}" placeholder="Ex: Abril 2025">`
          : `<input type="text" id="eval-period-txt" class="portal-field" style="${FIELD}"
              value="${esc(existingEval?.periodoRef||'')}" placeholder="Ex: Abril 2025">`}
        </div>

        <!-- KPIs -->
        ${allKpiRows.map((row, i) => `
          <div style="background:var(--bg-surface);border-radius:var(--radius-md);padding:14px 16px;">
            <div style="font-size:0.6875rem;text-transform:uppercase;letter-spacing:.07em;
              color:var(--text-muted);margin-bottom:4px;">
              ${esc(row.pilar.titulo||`Pilar ${row.pIdx+1}`)} › ${esc(row.meta.titulo||`Meta ${row.mIdx+1}`)}
            </div>
            <div style="font-weight:600;font-size:0.875rem;margin-bottom:10px;">
              ${esc(row.kpi.descricao||`KPI ${row.kIdx+1}`)}
              <span style="font-weight:400;color:var(--text-muted);margin-left:6px;">Peso: ${row.kpi.peso||0}%</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 2fr;gap:10px;">
              <div>
                <label style="${LBL}">Nota (%)</label>
                <input type="number" class="portal-field eval-kpi-score"
                  min="0" max="100"
                  data-pidx="${row.pIdx}" data-midx="${row.mIdx}" data-kidx="${row.kIdx}"
                  value="${row.existing?.score ?? ''}"
                  style="${FIELD}" placeholder="0–100">
              </div>
              <div>
                <label style="${LBL}">Comentário</label>
                <input type="text" class="portal-field eval-kpi-comment"
                  data-pidx="${row.pIdx}" data-midx="${row.mIdx}" data-kidx="${row.kIdx}"
                  value="${esc(row.existing?.comentario||'')}"
                  style="${FIELD}" placeholder="Justificativa (opcional)">
              </div>
            </div>
          </div>`).join('')}

        <!-- Progresso ao vivo -->
        <div style="background:var(--bg-surface);border-radius:var(--radius-md);padding:14px 16px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:0.875rem;font-weight:600;">Progresso calculado</span>
            <span id="eval-prog-val" style="font-size:1.125rem;font-weight:700;color:var(--brand-gold);">—</span>
          </div>
          <div style="height:6px;background:var(--bg-dark);border-radius:3px;overflow:hidden;">
            <div id="eval-prog-bar" style="height:100%;width:0%;background:var(--brand-gold);
              border-radius:3px;transition:width .3s;"></div>
          </div>
        </div>
      </div>

      <div style="padding:14px 22px;border-top:1px solid var(--border-subtle);
        background:var(--bg-surface);display:flex;gap:8px;justify-content:flex-end;">
        <button id="eval-cancel" class="btn btn-secondary btn-sm">Cancelar</button>
        <button id="eval-save" class="btn btn-primary btn-sm">💾 Salvar avaliação</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  document.getElementById('eval-close')?.addEventListener('click', close);
  document.getElementById('eval-cancel')?.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  // Period select toggle
  document.getElementById('eval-period-sel')?.addEventListener('change', e => {
    const txt = document.getElementById('eval-period-txt');
    if (txt) txt.style.display = e.target.value === '__custom__' ? 'block' : 'none';
  });

  // Live progress preview — scoped entirely to this overlay
  const updatePreview = () => {
    const scores = {};
    overlay.querySelectorAll('.eval-kpi-score').forEach(inp => {
      scores[`${inp.dataset.pidx}_${inp.dataset.midx}_${inp.dataset.kidx}`] = Number(inp.value) || 0;
    });
    const fakeEval = {
      kpiScores: allKpiRows.map(row => ({
        pilarIdx: row.pIdx, metaIdx: row.mIdx, kpiIdx: row.kIdx,
        score: scores[`${row.pIdx}_${row.mIdx}_${row.kIdx}`] || 0,
      })),
    };
    const p = calcGoalProgress(goal, [fakeEval]);
    const valEl = document.getElementById('eval-prog-val');
    const barEl = document.getElementById('eval-prog-bar');
    if (valEl) valEl.textContent = p + '%';
    if (barEl) barEl.style.width = p + '%';
  };

  overlay.querySelectorAll('.eval-kpi-score').forEach(inp =>
    inp.addEventListener('input', updatePreview));
  updatePreview();

  // Save
  document.getElementById('eval-save')?.addEventListener('click', async () => {
    const btn = document.getElementById('eval-save');

    // Collect period
    const selEl = document.getElementById('eval-period-sel');
    const txtEl = document.getElementById('eval-period-txt');
    const periodoRef = (selEl?.value === '__custom__' || !selEl)
      ? txtEl?.value?.trim()
      : selEl?.value;

    if (!periodoRef) { toast.error('Selecione o período de referência.'); return; }

    // Collect KPI scores — scoped to this overlay
    const kpiScoresFinal = [];
    overlay.querySelectorAll('.eval-kpi-score').forEach(inp => {
      const score    = inp.value !== '' ? Number(inp.value) : null;
      const pilarIdx = Number(inp.dataset.pidx);
      const metaIdx  = Number(inp.dataset.midx);
      const kpiIdx   = Number(inp.dataset.kidx);
      const commentEl = overlay.querySelector(
        `.eval-kpi-comment[data-pidx="${pilarIdx}"][data-midx="${metaIdx}"][data-kidx="${kpiIdx}"]`);
      kpiScoresFinal.push({
        pilarIdx, metaIdx, kpiIdx,
        score,
        comentario: commentEl?.value?.trim() || '',
      });
    });

    const isPartial = kpiScoresFinal.some(s => s.score === null);

    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
    try {
      await saveEvaluation(existingEval?.id || null, {
        goalId:    goal.id,
        periodoRef,
        kpiScores: kpiScoresFinal,
        status:    isPartial ? 'parcial' : 'completa',
      });
      toast.success('Avaliação salva!');
      close();
      onSave?.();
    } catch(e) {
      toast.error('Erro ao salvar: ' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar avaliação'; }
    }
  });
}

/* ─── Goal form (create/edit) ──────────────────────────────── */
async function openGoalForm(container, goalId = null) {
  const existing = goalId ? await fetchGoal(goalId).catch(() => null) : null;
  const users    = store.get('users') || [];
  const curUser  = store.get('currentUser');

  // Initial state
  const goal = existing ? JSON.parse(JSON.stringify(existing)) : {
    titulo: '', objetivoNucleo: '', escopo: 'individual',
    responsavelId: curUser?.uid || '', responsavelNome: curUser?.name || '',
    gestorId: '', gestorNome: '', setor: curUser?.sector || store.get('userSector') || '',
    cargo: '', nucleo: '', tipo: '', tipoTarefa: '', inicio: '', fim: '',
    status: 'rascunho',
    pilares: [],
  };

  if (!goal.pilares.length) {
    goal.pilares.push(makePilar(0));
  }

  const m = document.createElement('div');
  m.id = 'goal-form-modal';
  m.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:2000;
    overflow-y:auto;display:flex;align-items:flex-start;justify-content:center;padding:20px;`;

  document.body.appendChild(m);
  renderGoalFormModal(m, goal, container, goalId);
}

function makePilar(idx) {
  return { _idx: idx, titulo: '', objetivo: '', ponderacao: '', metas: [makeMeta(0)] };
}
function makeMeta(idx) {
  return {
    titulo: '', descricao: '', criterio: '', ponderacao: '',
    prazo: 'monthly', prazoCustomFrom: '', prazoCustomTo: '', recorrencia: false,
    periodicidadeAval: 'monthly', periodicidadeCustomFrom: '', periodicidadeCustomTo: '',
    recorrenciaAval: false,
    kpis: [makeKpi(0)],
  };
}
function makeKpi(idx) { return { descricao: '', peso: '' }; }

function renderGoalFormModal(m, goal, container, goalId) {
  const users   = store.get('users') || [];
  const userOpts = users.map(u => `<option value="${esc(u.id)}" ${goal.responsavelId===u.id?'selected':''}>${esc(u.name)}</option>`).join('');
  const gestOpts = users.map(u => `<option value="${esc(u.id)}" ${goal.gestorId===u.id?'selected':''}>${esc(u.name)}</option>`).join('');

  m.innerHTML = `
    <div class="card" style="width:100%;max-width:860px;padding:0;overflow:hidden;margin:auto;">
      <!-- Header -->
      <div style="padding:16px 24px;background:var(--bg-surface);border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10;">
        <div style="font-weight:700;font-size:1rem;">${goalId ? 'Editar Meta' : 'Nova Meta'}</div>
        <div style="display:flex;gap:8px;">
          <button id="gf-cancel" class="btn btn-secondary btn-sm">Cancelar</button>
          <button id="gf-save" class="btn btn-primary btn-sm">💾 Salvar</button>
        </div>
      </div>

      <div style="padding:24px;display:flex;flex-direction:column;gap:20px;">

        <!-- Section: Dados gerais -->
        <div>
          <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;
            color:var(--brand-gold);margin-bottom:14px;">Dados gerais</div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div style="grid-column:span 2;">
              <label style="${LBL}">Título da meta *</label>
              <input id="gf-titulo" type="text" class="portal-field" style="${FIELD}"
                value="${esc(goal.titulo)}" placeholder="Ex: Metas de Desempenho 2025 — Q1">
            </div>
            <div>
              <label style="${LBL}">Escopo</label>
              <select id="gf-escopo" class="filter-select" style="${FIELD}">
                ${GOAL_SCOPES.map(s => `<option value="${s.value}" ${goal.escopo===s.value?'selected':''}>${s.icon} ${s.label}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="${LBL}">Núcleo</label>
              <select id="gf-nucleo" class="filter-select" style="${FIELD}">
                <option value="">—</option>
                ${NUCLEOS.map(n => `<option value="${esc(n.value)}" ${goal.nucleo===n.value?'selected':''}>${esc(n.label)}</option>`).join('')}
              </select>
            </div>
            <div style="grid-column:span 2;">
              <label style="${LBL}">Objetivo do núcleo / área</label>
              <textarea id="gf-objetivo" class="portal-field" rows="2" style="${FIELD}"
                placeholder="Descreva o objetivo geral do núcleo ou área…">${esc(goal.objetivoNucleo)}</textarea>
            </div>
            <div>
              <label style="${LBL}">Responsável *</label>
              <select id="gf-responsavel" class="filter-select" style="${FIELD}">
                <option value="">Selecione…</option>
                ${userOpts}
              </select>
            </div>
            <div>
              <label style="${LBL}">Gestor *</label>
              <select id="gf-gestor" class="filter-select" style="${FIELD}">
                <option value="">Selecione…</option>
                ${gestOpts}
              </select>
            </div>
            <div>
              <label style="${LBL}">Área/Setor <span style="font-weight:400;color:var(--text-muted);">(auto)</span></label>
              <input id="gf-setor" type="text" class="portal-field" style="${FIELD}"
                value="${esc(goal.setor)}" readonly>
            </div>
            <div>
              <label style="${LBL}">Cargo</label>
              <input id="gf-cargo" type="text" class="portal-field" style="${FIELD}"
                value="${esc(goal.cargo)}" placeholder="Ex: Coordenador de Marketing">
            </div>
            <div>
              <label style="${LBL}">Data de início</label>
              <input id="gf-inicio" type="date" class="portal-field" style="${FIELD}"
                value="${esc(goal.inicio?.toDate?.() ? goal.inicio.toDate().toISOString().slice(0,10) : goal.inicio || '')}">
            </div>
            <div>
              <label style="${LBL}">Data de fim</label>
              <input id="gf-fim" type="date" class="portal-field" style="${FIELD}"
                value="${esc(goal.fim?.toDate?.() ? goal.fim.toDate().toISOString().slice(0,10) : goal.fim || '')}">
            </div>
          </div>
        </div>

        <!-- Section: Pilares -->
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
            <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;
              letter-spacing:.1em;color:var(--brand-gold);">Pilares</div>
            <div style="font-size:0.75rem;color:var(--text-muted);" id="gf-pilar-weight-warn"></div>
          </div>
          <div id="gf-pilares"></div>
          <button id="gf-add-pilar" class="btn btn-secondary btn-sm" style="margin-top:8px;font-size:0.8125rem;">
            + Adicionar pilar
          </button>
        </div>

      </div>
    </div>`;

  renderPilares(m, goal);
  wirePonderacaoWarnings(m, goal);

  // Responsive: responsável selects sector auto
  document.getElementById('gf-responsavel')?.addEventListener('change', e => {
    const u = (store.get('users') || []).find(x => x.id === e.target.value);
    if (u) document.getElementById('gf-setor').value = u.sector || u.department || '';
  });

  document.getElementById('gf-add-pilar')?.addEventListener('click', () => {
    collectPilares(m, goal);
    goal.pilares.push(makePilar(goal.pilares.length));
    renderPilares(m, goal);
    wirePonderacaoWarnings(m, goal);
  });

  document.getElementById('gf-cancel')?.addEventListener('click', () => m.remove());
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });

  document.getElementById('gf-save')?.addEventListener('click', async () => {
    const btn = document.getElementById('gf-save');
    if (!btn || btn.disabled) return;

    const titulo = document.getElementById('gf-titulo')?.value?.trim();
    if (!titulo) { toast.error('Título é obrigatório.'); return; }

    const respId = document.getElementById('gf-responsavel')?.value;
    const gestId = document.getElementById('gf-gestor')?.value;
    if (!respId) { toast.error('Selecione o responsável.'); return; }
    if (!gestId) { toast.error('Selecione o gestor.'); return; }

    // Collect pilares from DOM
    collectPilares(m, goal);

    const users = store.get('users') || [];
    const respUser = users.find(u => u.id === respId);
    const gestUser = users.find(u => u.id === gestId);

    const data = {
      titulo,
      objetivoNucleo: document.getElementById('gf-objetivo')?.value?.trim() || '',
      escopo:         document.getElementById('gf-escopo')?.value || 'individual',
      nucleo:         document.getElementById('gf-nucleo')?.value || '',
      responsavelId:  respId,
      responsavelNome: respUser?.name || '',
      gestorId:       gestId,
      gestorNome:     gestUser?.name || '',
      setor:          document.getElementById('gf-setor')?.value?.trim() || '',
      cargo:          document.getElementById('gf-cargo')?.value?.trim() || '',
      inicio:         document.getElementById('gf-inicio')?.value || null,
      fim:            document.getElementById('gf-fim')?.value || null,
      pilares:        goal.pilares,
      status:         goal.status || 'rascunho',
    };

    btn.disabled = true; btn.textContent = '⏳';
    try {
      await saveGoal(goalId, data);
      toast.success(goalId ? 'Meta atualizada!' : 'Meta criada!');
      m.remove();
      allGoals = await fetchGoals();
      const el = document.getElementById('goals-content');
      if (el) renderList(el, container);
    } catch(e) {
      toast.error('Erro: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = '💾 Salvar';
    }
  });
}

function renderPilares(m, goal) {
  const cont = document.getElementById('gf-pilares');
  if (!cont) return;

  cont.innerHTML = goal.pilares.map((pilar, pIdx) => `
    <div class="gf-pilar" data-pidx="${pIdx}"
      style="border:1px solid var(--border-subtle);border-radius:var(--radius-md);
      margin-bottom:12px;overflow:hidden;">

      <!-- Pilar header -->
      <div style="padding:12px 16px;background:var(--bg-surface);border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;gap:10px;">
        <span style="font-weight:700;font-size:0.875rem;flex:1;">
          Pilar ${pIdx+1}
        </span>
        <div style="display:grid;grid-template-columns:1fr 100px;gap:8px;flex:3;">
          <input type="text" class="portal-field gf-pilar-titulo" data-pidx="${pIdx}"
            value="${esc(pilar.titulo)}" placeholder="Título do pilar" style="font-size:0.875rem;">
          <div style="position:relative;">
            <input type="number" class="portal-field gf-pilar-pond" data-pidx="${pIdx}"
              value="${esc(pilar.ponderacao)}" placeholder="%" min="0" max="100"
              style="font-size:0.875rem;padding-right:24px;">
            <span style="position:absolute;right:8px;top:50%;transform:translateY(-50%);
              color:var(--text-muted);font-size:0.75rem;">%</span>
          </div>
        </div>
        ${goal.pilares.length > 1 ? `
          <button class="btn btn-ghost gf-del-pilar" data-pidx="${pIdx}"
            style="font-size:0.75rem;color:#EF4444;padding:4px 8px;">✕</button>` : ''}
      </div>

      <div style="padding:12px 16px;border-bottom:1px solid var(--border-subtle);">
        <textarea class="portal-field gf-pilar-obj" data-pidx="${pIdx}"
          rows="2" style="${FIELD};font-size:0.875rem;"
          placeholder="Objetivo do pilar…">${esc(pilar.objetivo)}</textarea>
      </div>

      <!-- Metas -->
      <div style="padding:12px 16px;">
        <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
          color:var(--text-muted);margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;">
          <span>Metas do pilar</span>
          <span id="gf-meta-warn-${pIdx}" style="font-weight:400;color:#F59E0B;font-size:0.7rem;"></span>
        </div>
        <div id="gf-metas-${pIdx}">
          ${pilar.metas.map((meta, mIdx) => metaHTML(meta, pIdx, mIdx, pilar.metas.length)).join('')}
        </div>
        <button class="btn btn-ghost btn-sm gf-add-meta" data-pidx="${pIdx}"
          style="font-size:0.8125rem;margin-top:6px;">+ Adicionar meta</button>
      </div>
    </div>`).join('');

  // Wire pilar events
  cont.querySelectorAll('.gf-del-pilar').forEach(btn => {
    btn.addEventListener('click', () => {
      collectPilares(m, goal);
      goal.pilares.splice(Number(btn.dataset.pidx), 1);
      renderPilares(m, goal);
      wirePonderacaoWarnings(m, goal);
    });
  });
  cont.querySelectorAll('.gf-add-meta').forEach(btn => {
    btn.addEventListener('click', () => {
      collectPilares(m, goal);
      const pIdx = Number(btn.dataset.pidx);
      goal.pilares[pIdx].metas.push(makeMeta(goal.pilares[pIdx].metas.length));
      renderPilares(m, goal);
      wirePonderacaoWarnings(m, goal);
    });
  });
  cont.querySelectorAll('.gf-del-meta').forEach(btn => {
    btn.addEventListener('click', () => {
      collectPilares(m, goal);
      const pIdx = Number(btn.dataset.pidx), mIdx = Number(btn.dataset.midx);
      goal.pilares[pIdx].metas.splice(mIdx, 1);
      renderPilares(m, goal);
      wirePonderacaoWarnings(m, goal);
    });
  });
  cont.querySelectorAll('.gf-add-kpi').forEach(btn => {
    btn.addEventListener('click', () => {
      collectPilares(m, goal);
      const pIdx = Number(btn.dataset.pidx), mIdx = Number(btn.dataset.midx);
      goal.pilares[pIdx].metas[mIdx].kpis.push(makeKpi(goal.pilares[pIdx].metas[mIdx].kpis.length));
      renderPilares(m, goal);
      wirePonderacaoWarnings(m, goal);
    });
  });
  cont.querySelectorAll('.gf-del-kpi').forEach(btn => {
    btn.addEventListener('click', () => {
      collectPilares(m, goal);
      const pIdx = Number(btn.dataset.pidx), mIdx = Number(btn.dataset.midx), kIdx = Number(btn.dataset.kidx);
      goal.pilares[pIdx].metas[mIdx].kpis.splice(kIdx, 1);
      renderPilares(m, goal);
      wirePonderacaoWarnings(m, goal);
    });
  });
  // Period toggles
  cont.querySelectorAll('.gf-prazo-sel').forEach(sel => {
    sel.addEventListener('change', e => {
      const pIdx = sel.dataset.pidx, mIdx = sel.dataset.midx;
      const customEl = cont.querySelector(`.gf-prazo-custom[data-pidx="${pIdx}"][data-midx="${mIdx}"]`);
      if (customEl) customEl.style.display = e.target.value === 'custom' ? 'grid' : 'none';
    });
  });
  cont.querySelectorAll('.gf-aval-sel').forEach(sel => {
    sel.addEventListener('change', e => {
      const pIdx = sel.dataset.pidx, mIdx = sel.dataset.midx;
      const customEl = cont.querySelector(`.gf-aval-custom[data-pidx="${pIdx}"][data-midx="${mIdx}"]`);
      if (customEl) customEl.style.display = e.target.value === 'custom' ? 'grid' : 'none';
    });
  });
  cont.querySelectorAll('.gf-pilar-pond, .gf-meta-pond, .gf-kpi-peso').forEach(inp => {
    inp.addEventListener('input', () => {
      // Cap KPI peso so sum cannot exceed 100
      if (inp.classList.contains('gf-kpi-peso')) {
        const pIdx = inp.dataset.pidx, mIdx = inp.dataset.midx;
        const allKpiInputs = [...cont.querySelectorAll(`.gf-kpi-peso[data-pidx="${pIdx}"][data-midx="${mIdx}"]`)];
        const othersSum = allKpiInputs
          .filter(x => x !== inp)
          .reduce((s, x) => s + (Number(x.value) || 0), 0);
        const maxAllowed = 100 - othersSum;
        if (Number(inp.value) > maxAllowed) inp.value = maxAllowed;
      }
      // Cap meta ponderacao per pilar
      if (inp.classList.contains('gf-meta-pond')) {
        const pIdx = inp.dataset.pidx;
        const allMetaInputs = [...cont.querySelectorAll(`.gf-meta-pond[data-pidx="${pIdx}"]`)];
        const othersSum = allMetaInputs
          .filter(x => x !== inp)
          .reduce((s, x) => s + (Number(x.value) || 0), 0);
        const maxAllowed = 100 - othersSum;
        if (Number(inp.value) > maxAllowed) inp.value = maxAllowed;
      }
      // Cap pilar ponderacao overall
      if (inp.classList.contains('gf-pilar-pond')) {
        const allPilarInputs = [...cont.querySelectorAll('.gf-pilar-pond')];
        const othersSum = allPilarInputs
          .filter(x => x !== inp)
          .reduce((s, x) => s + (Number(x.value) || 0), 0);
        const maxAllowed = 100 - othersSum;
        if (Number(inp.value) > maxAllowed) inp.value = maxAllowed;
      }
      wirePonderacaoWarnings(m, goal);
    });
  });
}

function metaHTML(meta, pIdx, mIdx, totalMetas) {
  const periodOpts = GOAL_PERIODS.map(p =>
    `<option value="${p.value}" ${meta.prazo===p.value?'selected':''}>${p.label}</option>`).join('');
  const avalOpts = GOAL_PERIODS.map(p =>
    `<option value="${p.value}" ${meta.periodicidadeAval===p.value?'selected':''}>${p.label}</option>`).join('');

  return `
  <div style="background:var(--bg-dark);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:8px;">
    <div style="display:grid;grid-template-columns:1fr 90px auto;gap:8px;align-items:start;margin-bottom:8px;">
      <input type="text" class="portal-field gf-meta-titulo" data-pidx="${pIdx}" data-midx="${mIdx}"
        value="${esc(meta.titulo)}" placeholder="Título da meta" style="font-size:0.875rem;">
      <div style="position:relative;">
        <input type="number" class="portal-field gf-meta-pond" data-pidx="${pIdx}" data-midx="${mIdx}"
          value="${esc(meta.ponderacao)}" placeholder="%" min="0" max="100"
          style="font-size:0.875rem;padding-right:24px;">
        <span style="position:absolute;right:8px;top:50%;transform:translateY(-50%);
          color:var(--text-muted);font-size:0.75rem;">%</span>
      </div>
      ${totalMetas > 1 ? `<button class="btn btn-ghost gf-del-meta"
        data-pidx="${pIdx}" data-midx="${mIdx}"
        style="font-size:0.7rem;color:#EF4444;padding:4px 6px;white-space:nowrap;">✕</button>` : '<div></div>'}
    </div>
    <textarea class="portal-field gf-meta-desc" data-pidx="${pIdx}" data-midx="${mIdx}"
      rows="2" style="${FIELD};font-size:0.8125rem;margin-bottom:8px;"
      placeholder="Descrição da meta…">${esc(meta.descricao)}</textarea>
    <input type="text" class="portal-field gf-meta-criterio" data-pidx="${pIdx}" data-midx="${mIdx}"
      value="${esc(meta.criterio)}" placeholder="Critério de medição…"
      style="${FIELD};font-size:0.8125rem;margin-bottom:8px;">

    <!-- Prazo -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
      <div>
        <label style="${LBL}">Prazo</label>
        <select class="filter-select gf-prazo-sel" data-pidx="${pIdx}" data-midx="${mIdx}" style="${FIELD}">
          ${periodOpts}
        </select>
        <label style="${LBL};margin-top:6px;display:flex;align-items:center;gap:6px;">
          <input type="checkbox" class="gf-recorrencia" data-pidx="${pIdx}" data-midx="${mIdx}"
            ${meta.recorrencia?'checked':''}>
          Com recorrência
        </label>
      </div>
      <div>
        <label style="${LBL}">Periodicidade de avaliação</label>
        <select class="filter-select gf-aval-sel" data-pidx="${pIdx}" data-midx="${mIdx}" style="${FIELD}">
          ${avalOpts}
        </select>
        <label style="${LBL};margin-top:6px;display:flex;align-items:center;gap:6px;">
          <input type="checkbox" class="gf-recorrencia-aval" data-pidx="${pIdx}" data-midx="${mIdx}"
            ${meta.recorrenciaAval?'checked':''}>
          Com recorrência
        </label>
      </div>
    </div>
    <div class="gf-prazo-custom" data-pidx="${pIdx}" data-midx="${mIdx}"
      style="display:${meta.prazo==='custom'?'grid':'none'};grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
      <input type="date" class="portal-field gf-prazo-from" data-pidx="${pIdx}" data-midx="${mIdx}"
        value="${esc(meta.prazoCustomFrom||'')}" placeholder="De">
      <input type="date" class="portal-field gf-prazo-to" data-pidx="${pIdx}" data-midx="${mIdx}"
        value="${esc(meta.prazoCustomTo||'')}" placeholder="Até">
    </div>
    <div class="gf-aval-custom" data-pidx="${pIdx}" data-midx="${mIdx}"
      style="display:${meta.periodicidadeAval==='custom'?'grid':'none'};grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
      <input type="date" class="portal-field gf-aval-from" data-pidx="${pIdx}" data-midx="${mIdx}"
        value="${esc(meta.periodicidadeCustomFrom||'')}" placeholder="De">
      <input type="date" class="portal-field gf-aval-to" data-pidx="${pIdx}" data-midx="${mIdx}"
        value="${esc(meta.periodicidadeCustomTo||'')}" placeholder="Até">
    </div>

    <!-- KPIs -->
    <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
      color:var(--text-muted);margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;">
      <span>KPIs</span>
      <span class="gf-kpi-warn-${pIdx}-${mIdx}" style="color:#F59E0B;font-weight:400;"></span>
    </div>
    ${(meta.kpis || []).map((kpi, kIdx) => `
      <div style="display:grid;grid-template-columns:1fr 80px auto;gap:6px;align-items:center;margin-bottom:6px;">
        <input type="text" class="portal-field gf-kpi-desc" data-pidx="${pIdx}" data-midx="${mIdx}" data-kidx="${kIdx}"
          value="${esc(kpi.descricao)}" placeholder="Descrição do KPI" style="font-size:0.8125rem;">
        <div style="position:relative;">
          <input type="number" class="portal-field gf-kpi-peso" data-pidx="${pIdx}" data-midx="${mIdx}" data-kidx="${kIdx}"
            value="${esc(kpi.peso)}" placeholder="%" min="0" max="100"
            style="font-size:0.8125rem;padding-right:20px;">
          <span style="position:absolute;right:6px;top:50%;transform:translateY(-50%);
            color:var(--text-muted);font-size:0.7rem;">%</span>
        </div>
        ${(meta.kpis||[]).length > 1 ? `<button class="btn btn-ghost gf-del-kpi"
          data-pidx="${pIdx}" data-midx="${mIdx}" data-kidx="${kIdx}"
          style="font-size:0.7rem;color:#EF4444;padding:3px 6px;">✕</button>` : '<div></div>'}
      </div>`).join('')}
    <button class="btn btn-ghost btn-sm gf-add-kpi" data-pidx="${pIdx}" data-midx="${mIdx}"
      style="font-size:0.75rem;margin-top:2px;">+ KPI</button>
  </div>`;
}

function collectPilares(m, goal) {
  goal.pilares.forEach((pilar, pIdx) => {
    pilar.titulo     = m.querySelector(`.gf-pilar-titulo[data-pidx="${pIdx}"]`)?.value?.trim() || '';
    pilar.ponderacao = m.querySelector(`.gf-pilar-pond[data-pidx="${pIdx}"]`)?.value || '';
    pilar.objetivo   = m.querySelector(`.gf-pilar-obj[data-pidx="${pIdx}"]`)?.value?.trim() || '';
    pilar._idx       = pIdx;

    pilar.metas.forEach((meta, mIdx) => {
      meta.titulo        = m.querySelector(`.gf-meta-titulo[data-pidx="${pIdx}"][data-midx="${mIdx}"]`)?.value?.trim() || '';
      meta.ponderacao    = m.querySelector(`.gf-meta-pond[data-pidx="${pIdx}"][data-midx="${mIdx}"]`)?.value || '';
      meta.descricao     = m.querySelector(`.gf-meta-desc[data-pidx="${pIdx}"][data-midx="${mIdx}"]`)?.value?.trim() || '';
      meta.criterio      = m.querySelector(`.gf-meta-criterio[data-pidx="${pIdx}"][data-midx="${mIdx}"]`)?.value?.trim() || '';
      meta.prazo         = m.querySelector(`.gf-prazo-sel[data-pidx="${pIdx}"][data-midx="${mIdx}"]`)?.value || 'monthly';
      meta.recorrencia   = m.querySelector(`.gf-recorrencia[data-pidx="${pIdx}"][data-midx="${mIdx}"]`)?.checked || false;
      meta.prazoCustomFrom = m.querySelector(`.gf-prazo-from[data-pidx="${pIdx}"][data-midx="${mIdx}"]`)?.value || '';
      meta.prazoCustomTo   = m.querySelector(`.gf-prazo-to[data-pidx="${pIdx}"][data-midx="${mIdx}"]`)?.value || '';
      meta.periodicidadeAval = m.querySelector(`.gf-aval-sel[data-pidx="${pIdx}"][data-midx="${mIdx}"]`)?.value || 'monthly';
      meta.recorrenciaAval   = m.querySelector(`.gf-recorrencia-aval[data-pidx="${pIdx}"][data-midx="${mIdx}"]`)?.checked || false;
      meta.periodicidadeCustomFrom = m.querySelector(`.gf-aval-from[data-pidx="${pIdx}"][data-midx="${mIdx}"]`)?.value || '';
      meta.periodicidadeCustomTo   = m.querySelector(`.gf-aval-to[data-pidx="${pIdx}"][data-midx="${mIdx}"]`)?.value || '';

      meta.kpis.forEach((kpi, kIdx) => {
        kpi.descricao = m.querySelector(`.gf-kpi-desc[data-pidx="${pIdx}"][data-midx="${mIdx}"][data-kidx="${kIdx}"]`)?.value?.trim() || '';
        kpi.peso      = m.querySelector(`.gf-kpi-peso[data-pidx="${pIdx}"][data-midx="${mIdx}"][data-kidx="${kIdx}"]`)?.value || '';
      });
    });
  });
}

function wirePonderacaoWarnings(m, goal) {
  // Pilar sum
  const pilarSum = goal.pilares.reduce((s, _, pIdx) => {
    const v = Number(m.querySelector(`.gf-pilar-pond[data-pidx="${pIdx}"]`)?.value || 0);
    return s + v;
  }, 0);
  const pilarWarn = document.getElementById('gf-pilar-weight-warn');
  if (pilarWarn) {
    if (goal.pilares.length > 1) {
      pilarWarn.textContent = pilarSum !== 100 ? `⚠ Soma dos pilares: ${pilarSum}% (deve ser 100%)` : '✓ 100%';
      pilarWarn.style.color = pilarSum !== 100 ? '#F59E0B' : '#22C55E';
    } else {
      pilarWarn.textContent = '';
    }
  }

  // Meta sum per pilar
  goal.pilares.forEach((pilar, pIdx) => {
    const metaSum = pilar.metas.reduce((s, _, mIdx) => {
      const v = Number(m.querySelector(`.gf-meta-pond[data-pidx="${pIdx}"][data-midx="${mIdx}"]`)?.value || 0);
      return s + v;
    }, 0);
    const warnEl = document.getElementById(`gf-meta-warn-${pIdx}`);
    if (warnEl) {
      if (pilar.metas.length > 1) {
        warnEl.textContent = metaSum !== 100 ? `⚠ Soma: ${metaSum}%` : '✓ 100%';
        warnEl.style.color = metaSum !== 100 ? '#F59E0B' : '#22C55E';
      } else {
        warnEl.textContent = '';
      }
    }

    // KPI sum per meta
    pilar.metas.forEach((meta, mIdx) => {
      const kpiSum = meta.kpis.reduce((s, _, kIdx) => {
        const v = Number(m.querySelector(`.gf-kpi-peso[data-pidx="${pIdx}"][data-midx="${mIdx}"][data-kidx="${kIdx}"]`)?.value || 0);
        return s + v;
      }, 0);
      const kpiWarn = m.querySelector(`.gf-kpi-warn-${pIdx}-${mIdx}`);
      if (kpiWarn) {
        if (meta.kpis.length > 1) {
          kpiWarn.textContent = kpiSum !== 100 ? `⚠ Soma KPIs: ${kpiSum}%` : '✓ 100%';
          kpiWarn.style.color = kpiSum !== 100 ? '#F59E0B' : '#22C55E';
        } else {
          kpiWarn.textContent = '';
        }
      }
    });
  });
}

/* ─── Exports ──────────────────────────────────────────────── */
async function exportXls() {
  if (!allGoals.length) { toast.error('Nenhuma meta para exportar.'); return; }
  if (!window.XLSX) await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s);});
  const rows = [
    ['Título','Escopo','Responsável','Gestor','Setor','Status','Pilares','Metas','Início','Fim'],
    ...allGoals.map(g => [
      g.titulo||'', g.escopo||'', g.responsavelNome||'', g.gestorNome||'',
      g.setor||'', g.status||'',
      (g.pilares||[]).length, (g.pilares||[]).reduce((a,p)=>a+(p.metas||[]).length,0),
      fmt(g.inicio), fmt(g.fim),
    ]),
  ];
  const wb = window.XLSX.utils.book_new();
  const ws = window.XLSX.utils.aoa_to_sheet(rows);
  window.XLSX.utils.book_append_sheet(wb, ws, 'Metas');
  window.XLSX.writeFile(wb, `primetour_metas_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast.success('XLS exportado.');
}

async function exportPdf() {
  if (!allGoals.length) { toast.error('Nenhuma meta para exportar.'); return; }
  if (!window.jspdf) {
    await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s);});
    await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s);});
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' });
  doc.setFontSize(14); doc.setFont('helvetica','bold'); doc.setTextColor(36,35,98);
  doc.text('PRIMETOUR — Quadro de Metas', 14, 16);
  doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(100,100,100);
  doc.text(`Gerado em ${new Date().toLocaleDateString('pt-BR')} · ${allGoals.length} metas`, 14, 22);
  doc.autoTable({
    startY: 27,
    head: [['Título','Escopo','Responsável','Gestor','Setor','Status','Pilares','Metas','Início','Fim']],
    body: allGoals.map(g => [
      (g.titulo||'').slice(0,40), g.escopo||'', g.responsavelNome||'', g.gestorNome||'',
      (g.setor||'').slice(0,20), g.status||'',
      (g.pilares||[]).length, (g.pilares||[]).reduce((a,p)=>a+(p.metas||[]).length,0),
      fmt(g.inicio), fmt(g.fim),
    ]),
    styles:     { fontSize: 7, cellPadding: 3 },
    headStyles: { fillColor:[36,35,98], textColor:255, fontStyle:'bold' },
    alternateRowStyles: { fillColor:[248,247,244] },
  });
  doc.save(`primetour_metas_${new Date().toISOString().slice(0,10)}.pdf`);
  toast.success('PDF exportado.');
}
