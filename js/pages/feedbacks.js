/**
 * PRIMETOUR — Feedbacks
 * Registro, visualização, rotina, importação e dashboard de feedbacks
 */

import { store } from '../store.js';
import { toast } from '../components/toast.js';
import {
  fetchFeedbacks, fetchFeedback, saveFeedback, deleteFeedback,
  fetchFeedbackSchedules, saveFeedbackSchedule, deleteFeedbackSchedule,
  checkOverdueSchedules, parseImportRow, resolveImportUsers, batchImportFeedbacks,
  FB_CONTEXTS, FB_TYPES, FB_SCHEDULE_FREQUENCIES,
} from '../services/feedbacks.js';
import { createDoc, loadJsPdf, COL, txt, withExportGuard } from '../components/pdfKit.js';

const esc = s => String(s||'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = ts => {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('pt-BR');
};

let allFeedbacks = [];
let filters = { search:'', context:'', type:'', managerId:'', collaboratorId:'', dateFrom:'', dateTo:'' };
let activeTab = 'list';
let _users = [];

/* ═══════════════════════════════════════════════════════════════
   Main render
   ═══════════════════════════════════════════════════════════════ */
export async function renderFeedbacks(container) {
  // Permission: coordinators, managers, heads, directors + exceptions
  const canView = store.isMaster() || store.can('feedback_view') || store.can('feedback_create');
  if (!canView) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
      <div class="empty-state-subtitle">Módulo disponível para coordenadores, gerentes, heads e diretoria.</div>
    </div>`;
    return;
  }

  // Load users
  await ensureUsers();

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
      <div class="page-header-left">
        <h1 class="page-title">Feedbacks</h1>
        <p class="page-subtitle">Registro e acompanhamento de feedbacks da equipe</p>
      </div>
      <div class="page-header-actions" id="fb-header-actions" style="gap:8px;"></div>
    </div>

    <!-- Tabs -->
    <div style="display:flex;gap:0;margin-bottom:20px;border-bottom:2px solid var(--border-subtle);">
      ${[
        { id:'list',      icon:'📋', label:'Feedbacks' },
        { id:'dashboard', icon:'📊', label:'Dashboard' },
        { id:'schedule',  icon:'🔔', label:'Rotina' },
        { id:'import',    icon:'📥', label:'Importar' },
      ].map(t => `
        <button class="fb-tab" data-tab="${t.id}"
          style="padding:10px 24px;font-size:0.875rem;font-weight:600;border:none;cursor:pointer;
          background:transparent;margin-bottom:-2px;
          color:${t.id === 'list' ? 'var(--text-primary)' : 'var(--text-muted)'};
          border-bottom:2px solid ${t.id === 'list' ? 'var(--brand-gold)' : 'transparent'};">
          ${t.icon} ${t.label}
        </button>`).join('')}
    </div>

    <div id="fb-tab-content"></div>`;

  // Wire tabs
  container.querySelectorAll('.fb-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      container.querySelectorAll('.fb-tab').forEach(b => {
        const active = b.dataset.tab === activeTab;
        b.style.color = active ? 'var(--text-primary)' : 'var(--text-muted)';
        b.style.borderBottomColor = active ? 'var(--brand-gold)' : 'transparent';
      });
      renderActiveTab(container);
    });
  });

  // Check overdue schedules
  checkOverdueSchedules().then(overdue => {
    if (overdue.length) {
      toast.info(`${overdue.length} feedback(s) pendente(s) na rotina.`);
    }
  }).catch(() => {});

  await renderActiveTab(container);
}

export function destroyFeedbacks() { /* cleanup if needed */ }

async function ensureUsers() {
  if (!(store.get('users') || []).length) {
    const { collection: coll, getDocs: gd, query: q, orderBy: ob } =
      await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const { db } = await import('../firebase.js');
    const snap = await gd(q(coll(db, 'users'), ob('name', 'asc')));
    store.set('users', snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }
  _users = store.get('users') || [];
}

function userName(id) {
  return _users.find(u => u.id === id)?.name || id || '—';
}

async function renderActiveTab(container) {
  if (activeTab === 'list')      await renderListTab(container);
  else if (activeTab === 'dashboard') await renderDashboardTab(container);
  else if (activeTab === 'schedule')  await renderScheduleTab(container);
  else if (activeTab === 'import')    await renderImportTab(container);
}

/* ═══════════════════════════════════════════════════════════════
   Tab: List (feedbacks)
   ═══════════════════════════════════════════════════════════════ */
async function renderListTab(container) {
  const actions = document.getElementById('fb-header-actions');
  const canCreate = store.isMaster() || store.can('feedback_create');
  if (actions) actions.innerHTML = `
    <button class="btn btn-secondary btn-sm" id="fb-export-xls">↓ XLS</button>
    <button class="btn btn-secondary btn-sm" id="fb-export-pdf">↓ PDF</button>
    ${canCreate ? `<button class="btn btn-primary btn-sm" id="fb-new-btn">+ Novo feedback</button>` : ''}`;

  const tabContent = document.getElementById('fb-tab-content');
  if (!tabContent) return;

  const PERIOD_LABELS = { '7d':'7 dias', '30d':'30 dias', '90d':'90 dias', '12m':'12 meses', 'all':'Tudo', 'custom':'Personalizado' };

  tabContent.innerHTML = `
    <!-- Period -->
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:16px;">
      ${['30d','90d','12m','all','custom'].map(p => `
        <button class="fb-period-btn" data-period="${p}"
          style="padding:6px 16px;border-radius:var(--radius-full);font-size:0.8125rem;
          font-weight:600;border:1px solid var(--border-subtle);cursor:pointer;
          background:${p === 'all' ? 'var(--brand-gold)' : 'var(--bg-surface)'};
          color:${p === 'all' ? '#fff' : 'var(--text-secondary)'};">
          ${PERIOD_LABELS[p]}
        </button>`).join('')}
      <div id="fb-custom-range" style="display:none;gap:8px;align-items:center;margin-left:8px;">
        <input type="date" id="fb-from" class="portal-field" style="height:34px;font-size:0.8125rem;">
        <span style="color:var(--text-muted);">→</span>
        <input type="date" id="fb-to" class="portal-field" style="height:34px;font-size:0.8125rem;">
        <button class="btn btn-primary btn-sm" id="fb-apply-custom">Aplicar</button>
      </div>
    </div>

    <!-- Filters -->
    <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);
      border-radius:var(--radius-md);padding:14px 20px;margin-bottom:20px;
      display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;">

      <div style="flex:2;min-width:180px;">
        <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Buscar</label>
        <input type="text" id="ff-search" class="portal-field" style="width:100%;"
          placeholder="Tema, nome, plano de ação…">
      </div>

      <div style="min-width:140px;">
        <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Gestor</label>
        <select id="ff-manager" class="filter-select" style="width:100%;">
          <option value="">Todos</option>
          ${getManagerOptions()}
        </select>
      </div>

      <div style="min-width:140px;">
        <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Colaborador</label>
        <select id="ff-collaborator" class="filter-select" style="width:100%;">
          <option value="">Todos</option>
          ${_users.map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}
        </select>
      </div>

      <div style="min-width:120px;">
        <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Contexto</label>
        <select id="ff-context" class="filter-select" style="width:100%;">
          <option value="">Todos</option>
          ${FB_CONTEXTS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
        </select>
      </div>

      <div style="min-width:130px;">
        <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Tipo</label>
        <select id="ff-type" class="filter-select" style="width:100%;">
          <option value="">Todos</option>
          ${FB_TYPES.map(t => `<option value="${esc(t.key)}">${esc(t.label)}</option>`).join('')}
        </select>
      </div>

      <button class="btn btn-ghost btn-sm" id="ff-clear"
        style="font-size:0.8125rem;color:var(--text-muted);white-space:nowrap;">✕ Limpar</button>
    </div>

    <!-- KPI strip -->
    <div id="fb-kpi" style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;"></div>

    <!-- List -->
    <div id="fb-list"></div>`;

  // Period buttons
  let currentPeriod = 'all';
  tabContent.querySelectorAll('.fb-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentPeriod = btn.dataset.period;
      tabContent.querySelectorAll('.fb-period-btn').forEach(b => {
        const active = b.dataset.period === currentPeriod;
        b.style.background = active ? 'var(--brand-gold)' : 'var(--bg-surface)';
        b.style.color = active ? '#fff' : 'var(--text-secondary)';
      });
      const customEl = document.getElementById('fb-custom-range');
      if (customEl) customEl.style.display = currentPeriod === 'custom' ? 'flex' : 'none';
      if (currentPeriod !== 'custom') {
        applyPeriod(currentPeriod);
        renderFbList();
      }
    });
  });

  document.getElementById('fb-apply-custom')?.addEventListener('click', () => {
    filters.dateFrom = document.getElementById('fb-from')?.value || '';
    filters.dateTo   = document.getElementById('fb-to')?.value || '';
    renderFbList();
  });

  function applyPeriod(period) {
    const now = new Date();
    filters.dateTo = '';
    if (period === 'all') { filters.dateFrom = ''; return; }
    const d = new Date(now);
    if (period === '7d')  d.setDate(d.getDate() - 7);
    if (period === '30d') d.setDate(d.getDate() - 30);
    if (period === '90d') d.setDate(d.getDate() - 90);
    if (period === '12m') d.setFullYear(d.getFullYear() - 1);
    filters.dateFrom = d.toISOString().slice(0, 10);
  }

  // Wire filters
  const applyF = () => {
    filters.search         = document.getElementById('ff-search')?.value || '';
    filters.managerId      = document.getElementById('ff-manager')?.value || '';
    filters.collaboratorId = document.getElementById('ff-collaborator')?.value || '';
    filters.context        = document.getElementById('ff-context')?.value || '';
    filters.type           = document.getElementById('ff-type')?.value || '';
    renderFbList();
  };
  ['ff-search','ff-manager','ff-collaborator','ff-context','ff-type'].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener(id === 'ff-search' ? 'input' : 'change', applyF);
  });

  document.getElementById('ff-clear')?.addEventListener('click', () => {
    ['ff-search','ff-manager','ff-collaborator','ff-context','ff-type'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    filters = { search:'', context:'', type:'', managerId:'', collaboratorId:'', dateFrom:'', dateTo:'' };
    currentPeriod = 'all';
    tabContent.querySelectorAll('.fb-period-btn').forEach(b => {
      const active = b.dataset.period === 'all';
      b.style.background = active ? 'var(--brand-gold)' : 'var(--bg-surface)';
      b.style.color = active ? '#fff' : 'var(--text-secondary)';
    });
    renderFbList();
  });

  document.getElementById('fb-new-btn')?.addEventListener('click', () => showFeedbackForm(container));
  document.getElementById('fb-export-xls')?.addEventListener('click', () => exportFbXls());
  document.getElementById('fb-export-pdf')?.addEventListener('click', () => exportFbPdf());

  // Load
  const listEl = document.getElementById('fb-list');
  if (listEl) listEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">⏳ Carregando…</div>`;
  allFeedbacks = await fetchFeedbacks().catch(() => []);
  renderFbKpis();
  renderFbList();
}

function getManagerOptions() {
  // Managers: users who have given feedbacks, or those with management roles
  const managerIds = [...new Set(allFeedbacks.map(f => f.managerId).filter(Boolean))];
  const seen = new Set();
  let opts = '';
  for (const id of managerIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    opts += `<option value="${esc(id)}">${esc(userName(id))}</option>`;
  }
  return opts;
}

function applyClientFilters(items) {
  return items.filter(item => {
    if (filters.search) {
      const s = filters.search.toLowerCase();
      const text = `${item.theme} ${userName(item.managerId)} ${userName(item.collaboratorId)} ${item.actionPlan} ${item.perception}`.toLowerCase();
      if (!text.includes(s)) return false;
    }
    if (filters.managerId      && item.managerId      !== filters.managerId)      return false;
    if (filters.collaboratorId && item.collaboratorId !== filters.collaboratorId) return false;
    if (filters.context        && item.context        !== filters.context)        return false;
    if (filters.type           && item.type           !== filters.type)           return false;
    if (filters.dateFrom) {
      const d = item.date ? new Date(item.date) : new Date(0);
      if (d < new Date(filters.dateFrom)) return false;
    }
    if (filters.dateTo) {
      const d = item.date ? new Date(item.date) : new Date(0);
      if (d > new Date(filters.dateTo + 'T23:59:59')) return false;
    }
    return true;
  });
}

function renderFbKpis() {
  const el = document.getElementById('fb-kpi');
  if (!el) return;
  const filtered = applyClientFilters(allFeedbacks);
  const total = filtered.length;
  const positive = filtered.filter(f => f.type === 'positive').length;
  const negative = filtered.filter(f => f.type === 'negative').length;
  const dev  = filtered.filter(f => f.type === 'development').length;
  const collabs = new Set(filtered.map(f => f.collaboratorId)).size;

  el.innerHTML = [
    ['Total',            total,    'var(--text-primary)'],
    ['Positivos',        positive, '#22C55E'],
    ['Negativos',        negative, '#EF4444'],
    ['Desenvolvimento',  dev,      '#8B5CF6'],
    ['Colaboradores',    collabs,  'var(--brand-gold)'],
  ].map(([label, val, color]) => `
    <div style="padding:12px 18px;background:var(--bg-surface);border:1px solid var(--border-subtle);
      border-radius:var(--radius-md);min-width:100px;text-align:center;">
      <div style="font-size:1.5rem;font-weight:700;color:${color};">${val}</div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">${label}</div>
    </div>`).join('');
}

function renderFbList() {
  const listEl = document.getElementById('fb-list');
  if (!listEl) return;

  const filtered = applyClientFilters(allFeedbacks);
  renderFbKpis();

  if (!filtered.length) {
    listEl.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">💬</div>
      <div class="empty-state-title">Nenhum feedback encontrado</div>
      <div class="empty-state-subtitle">Ajuste os filtros ou registre o primeiro feedback.</div>
    </div>`;
    return;
  }

  listEl.innerHTML = `
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:var(--bg-surface);">
          ${['Data','Gestor','Colaborador','Tipo','Contexto','Tema',''].map(h =>
            `<th style="padding:10px 14px;text-align:left;font-size:0.6875rem;font-weight:700;
              text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);
              border-bottom:1px solid var(--border-subtle);white-space:nowrap;">${h}</th>`
          ).join('')}
        </tr>
      </thead>
      <tbody>
        ${filtered.map(fb => {
          const tp = FB_TYPES.find(t => t.key === fb.type) || FB_TYPES[0];
          const highlights = fb.highlights || [];
          const improvements = fb.improvements || [];
          return `<tr style="border-bottom:1px solid var(--border-subtle);transition:background .15s;"
            onmouseenter="this.style.background='var(--bg-surface)'"
            onmouseleave="this.style.background='transparent'">
            <td style="padding:12px 14px;white-space:nowrap;font-size:0.8125rem;color:var(--text-muted);">
              ${fmt(fb.date)}
            </td>
            <td style="padding:12px 14px;font-size:0.8125rem;font-weight:600;">
              ${esc(userName(fb.managerId))}
            </td>
            <td style="padding:12px 14px;font-size:0.8125rem;font-weight:600;">
              ${esc(userName(fb.collaboratorId))}
            </td>
            <td style="padding:12px 14px;white-space:nowrap;">
              <span style="padding:3px 10px;background:${tp.bg};color:${tp.color};
                border:1px solid ${tp.color}30;border-radius:20px;font-size:0.75rem;font-weight:600;">
                ${tp.icon} ${esc(tp.label)}
              </span>
            </td>
            <td style="padding:12px 14px;font-size:0.8125rem;color:var(--text-muted);">
              ${esc(fb.context || '—')}
            </td>
            <td style="padding:12px 14px;max-width:260px;">
              <div style="font-weight:600;font-size:0.875rem;margin-bottom:2px;">
                ${esc(fb.theme || '—')}
              </div>
              <div style="font-size:0.6875rem;color:var(--text-muted);">
                ${highlights.length ? `▲ ${highlights.length} destaque(s)` : ''}
                ${improvements.length ? ` · ▼ ${improvements.length} a desenvolver` : ''}
              </div>
            </td>
            <td style="padding:12px 14px;white-space:nowrap;">
              <div style="display:flex;gap:6px;justify-content:flex-end;">
                <button class="btn btn-ghost btn-sm fb-view" data-id="${esc(fb.id)}"
                  style="font-size:0.75rem;" title="Ver detalhes">👁</button>
                <button class="btn btn-ghost btn-sm fb-edit" data-id="${esc(fb.id)}"
                  style="font-size:0.75rem;color:var(--brand-gold);">✎</button>
                <button class="btn btn-ghost btn-sm fb-del" data-id="${esc(fb.id)}"
                  data-name="${esc(fb.theme || '')}"
                  style="font-size:0.75rem;color:#EF4444;">✕</button>
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div style="padding:10px 14px;font-size:0.8125rem;color:var(--text-muted);">
      ${filtered.length} resultado${filtered.length !== 1 ? 's' : ''}
      ${filtered.length < allFeedbacks.length ? ` (de ${allFeedbacks.length} total)` : ''}
    </div>`;

  // Wire actions
  listEl.querySelectorAll('.fb-view').forEach(btn => {
    btn.addEventListener('click', () => {
      const fb = allFeedbacks.find(f => f.id === btn.dataset.id);
      if (fb) showFeedbackDetail(fb);
    });
  });
  listEl.querySelectorAll('.fb-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const fb = allFeedbacks.find(f => f.id === btn.dataset.id);
      if (fb) showFeedbackForm(null, fb);
    });
  });
  listEl.querySelectorAll('.fb-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Excluir feedback "${btn.dataset.name}"?`)) return;
      await deleteFeedback(btn.dataset.id);
      allFeedbacks = allFeedbacks.filter(f => f.id !== btn.dataset.id);
      renderFbKpis();
      renderFbList();
      toast.success('Feedback excluído.');
    });
  });
}

/* ─── Feedback detail modal ───────────────────────────────── */
function showFeedbackDetail(fb) {
  const tp = FB_TYPES.find(t => t.key === fb.type) || FB_TYPES[0];
  const m = document.createElement('div');
  m.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2000;
    display:flex;align-items:center;justify-content:center;padding:20px;`;

  m.innerHTML = `
    <div class="card" style="width:100%;max-width:640px;max-height:90vh;
      padding:0;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:16px 22px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div>
          <div style="font-weight:700;font-size:1rem;">${esc(fb.theme || 'Feedback')}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
            ${fmt(fb.date)} · <span style="color:${tp.color};font-weight:600;">${tp.icon} ${esc(tp.label)}</span>
            · ${esc(fb.context || '')}
          </div>
        </div>
        <button class="fb-detail-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);">✕</button>
      </div>
      <div style="overflow-y:auto;flex:1;padding:20px 22px;">

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
          <div style="padding:12px;background:var(--bg-surface);border-radius:var(--radius-md);
            border:1px solid var(--border-subtle);">
            <div style="font-size:0.6875rem;font-weight:600;color:var(--text-muted);
              text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Gestor</div>
            <div style="font-weight:600;">${esc(userName(fb.managerId))}</div>
          </div>
          <div style="padding:12px;background:var(--bg-surface);border-radius:var(--radius-md);
            border:1px solid var(--border-subtle);">
            <div style="font-size:0.6875rem;font-weight:600;color:var(--text-muted);
              text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Colaborador</div>
            <div style="font-weight:600;">${esc(userName(fb.collaboratorId))}</div>
          </div>
        </div>

        ${(fb.highlights || []).length ? `
          <div style="margin-bottom:16px;">
            <div style="font-size:0.75rem;font-weight:700;color:#22C55E;
              text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">▲ Pontos em destaque</div>
            ${(fb.highlights || []).map(h => `
              <div style="padding:8px 12px;background:#22C55E08;border-left:3px solid #22C55E;
                margin-bottom:6px;border-radius:0 var(--radius-sm) var(--radius-sm) 0;
                font-size:0.875rem;">${esc(h)}</div>`).join('')}
          </div>` : ''}

        ${(fb.improvements || []).length ? `
          <div style="margin-bottom:16px;">
            <div style="font-size:0.75rem;font-weight:700;color:#EF4444;
              text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">▼ Pontos a desenvolver</div>
            ${(fb.improvements || []).map(h => `
              <div style="padding:8px 12px;background:#EF444408;border-left:3px solid #EF4444;
                margin-bottom:6px;border-radius:0 var(--radius-sm) var(--radius-sm) 0;
                font-size:0.875rem;">${esc(h)}</div>`).join('')}
          </div>` : ''}

        ${fb.actionPlan ? `
          <div style="margin-bottom:16px;">
            <div style="font-size:0.75rem;font-weight:700;color:var(--brand-gold);
              text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">📋 Plano de ação</div>
            <div style="padding:12px;background:var(--bg-surface);border-radius:var(--radius-md);
              border:1px solid var(--border-subtle);font-size:0.875rem;white-space:pre-line;">
              ${esc(fb.actionPlan)}</div>
          </div>` : ''}

        ${fb.perception ? `
          <div>
            <div style="font-size:0.75rem;font-weight:700;color:var(--text-muted);
              text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">💭 Percepção do colaborador</div>
            <div style="padding:12px;background:var(--bg-surface);border-radius:var(--radius-md);
              border:1px solid var(--border-subtle);font-size:0.875rem;font-style:italic;
              white-space:pre-line;">${esc(fb.perception)}</div>
          </div>` : ''}
      </div>
    </div>`;

  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  m.querySelector('.fb-detail-close')?.addEventListener('click', () => m.remove());
}

/* ─── Feedback form modal ─────────────────────────────────── */
/* ─── Audio transcription helpers ────────────────────────── */

async function transcribeWithGroq(audioBlob) {
  const { getAIConfig, resolveApiKey } = await import('../services/ai.js');

  // Buscar API key do Groq — cascata: user → nucleo → area → global
  let groqKey = '';
  try {
    // 1. Tentar via resolveApiKey (cascata completa)
    const resolved = await resolveApiKey('groq');
    groqKey = resolved?.apiKey || '';

    // 2. Fallback: buscar na config global (campo groqApiKey ou apiKey se provider=groq)
    if (!groqKey) {
      const globalCfg = await getAIConfig();
      groqKey = globalCfg?.groqApiKey || '';
      if (!groqKey && globalCfg?.provider === 'groq') {
        groqKey = globalCfg?.apiKey || '';
      }
    }
  } catch {}

  if (!groqKey) {
    throw new Error('Configure uma API Key do Groq (grátis) em Configurações → IA para usar transcrição de áudio.');
  }

  const formData = new FormData();
  const ext = audioBlob.type.includes('webm') ? 'webm' : audioBlob.type.includes('mp4') ? 'm4a' : 'wav';
  formData.append('file', audioBlob, `audio.${ext}`);
  formData.append('model', 'whisper-large-v3');
  formData.append('language', 'pt');
  formData.append('response_format', 'json');

  const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${groqKey}` },
    body: formData,
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => '');
    throw new Error(`Erro na transcrição (${resp.status}): ${err}`);
  }

  const data = await resp.json();
  return data.text || '';
}

async function parseTranscriptWithAI(text) {
  // Use the AI service to parse the transcript into structured feedback fields
  try {
    const { getAIConfig } = await import('../services/ai.js');
    const globalCfg = await getAIConfig() || {};
    const provider = globalCfg.provider || 'groq';
    const apiKey = globalCfg.apiKey || globalCfg[provider + 'ApiKey'] || '';
    const cfg = globalCfg;

    if (!apiKey) return null;

    const systemPrompt = `Você é um assistente que extrai informações de uma transcrição de áudio de feedback.
Analise o texto e retorne APENAS um JSON válido (sem markdown, sem backticks) com estes campos:
{
  "theme": "tema principal do feedback (1 frase curta)",
  "highlights": ["ponto positivo 1", "ponto positivo 2"],
  "improvements": ["ponto a desenvolver 1", "ponto a desenvolver 2"],
  "actionPlan": "ações combinadas (texto livre)",
  "perception": "reação/percepção do colaborador (texto livre)",
  "suggestedType": "positive|negative|mixed|development"
}
Se algum campo não for mencionado, use string vazia ou array vazio. Seja conciso.`;

    let url, headers, body;

    if (provider === 'groq') {
      url = 'https://api.groq.com/openai/v1/chat/completions';
      headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
      body = JSON.stringify({ model: cfg.model || 'llama-3.3-70b-versatile', messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ], temperature: 0.2, max_tokens: 800, response_format: { type: 'json_object' } });
    } else if (provider === 'gemini') {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model || 'gemini-2.5-flash'}:generateContent?key=${apiKey}`;
      headers = { 'Content-Type': 'application/json' };
      body = JSON.stringify({ contents: [{ parts: [{ text: systemPrompt + '\n\nTranscrição:\n' + text }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 800, responseMimeType: 'application/json' } });
    } else if (provider === 'openai' || provider === 'azure') {
      const base = provider === 'azure' && cfg.azureEndpoint ? cfg.azureEndpoint : 'https://api.openai.com/v1';
      url = `${base}/chat/completions`;
      headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
      body = JSON.stringify({ model: cfg.model || 'gpt-4o-mini', messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ], temperature: 0.2, max_tokens: 800, response_format: { type: 'json_object' } });
    } else if (provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages';
      headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true' };
      body = JSON.stringify({ model: cfg.model || 'claude-sonnet-4-6', max_tokens: 800,
        system: systemPrompt, messages: [{ role: 'user', content: text }] });
    } else {
      return null;
    }

    const resp = await fetch(url, { method: 'POST', headers, body });
    if (!resp.ok) return null;
    const data = await resp.json();

    let jsonText = '';
    if (provider === 'gemini') {
      jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else if (provider === 'anthropic') {
      jsonText = data.content?.[0]?.text || '';
    } else {
      jsonText = data.choices?.[0]?.message?.content || '';
    }

    // Clean markdown wrapping if present
    jsonText = jsonText.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(jsonText);
  } catch (e) {
    console.warn('[Feedback] Erro ao parsear transcrição com IA:', e);
    return null;
  }
}

function setupAudioTranscription(modal, addRow) {
  const recBtn   = modal.querySelector('#fbf-rec-btn');
  const recIcon  = modal.querySelector('#fbf-rec-icon');
  const recLabel = modal.querySelector('#fbf-rec-label');
  const fileInput = modal.querySelector('#fbf-audio-file');
  const statusEl = modal.querySelector('#fbf-rec-status');
  const previewEl = modal.querySelector('#fbf-transcript-preview');

  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;

  function showStatus(html) {
    statusEl.style.display = 'flex';
    statusEl.innerHTML = html;
  }

  function hideStatus() {
    statusEl.style.display = 'none';
    statusEl.innerHTML = '';
  }

  async function fillFieldsFromTranscript(text) {
    // Show raw transcript
    previewEl.style.display = 'block';
    previewEl.innerHTML = `<div style="font-size:0.6875rem;font-weight:600;color:var(--text-muted);
      text-transform:uppercase;margin-bottom:4px;">Transcrição</div>${esc(text)}`;

    // Try to parse with AI
    showStatus('⚙ Analisando com IA...');
    const parsed = await parseTranscriptWithAI(text);

    if (parsed) {
      // Fill fields
      if (parsed.theme && !modal.querySelector('#fbf-theme')?.value) {
        modal.querySelector('#fbf-theme').value = parsed.theme;
      }

      if (parsed.suggestedType) {
        const typeSelect = modal.querySelector('#fbf-type');
        if (typeSelect && !typeSelect.value) typeSelect.value = parsed.suggestedType;
      }

      if (parsed.highlights?.length) {
        const hlContainer = modal.querySelector('#fbf-highlights');
        const existingInputs = hlContainer.querySelectorAll('.fbf-hl-input');
        parsed.highlights.forEach((h, i) => {
          if (i < existingInputs.length) {
            if (!existingInputs[i].value) existingInputs[i].value = h;
          } else {
            addRow('fbf-highlights', 'fbf-hl');
            const newInputs = hlContainer.querySelectorAll('.fbf-hl-input');
            newInputs[newInputs.length - 1].value = h;
          }
        });
      }

      if (parsed.improvements?.length) {
        const impContainer = modal.querySelector('#fbf-improvements');
        const existingInputs = impContainer.querySelectorAll('.fbf-imp-input');
        parsed.improvements.forEach((h, i) => {
          if (i < existingInputs.length) {
            if (!existingInputs[i].value) existingInputs[i].value = h;
          } else {
            addRow('fbf-improvements', 'fbf-imp');
            const newInputs = impContainer.querySelectorAll('.fbf-imp-input');
            newInputs[newInputs.length - 1].value = h;
          }
        });
      }

      if (parsed.actionPlan) {
        const el = modal.querySelector('#fbf-action');
        if (el && !el.value) el.value = parsed.actionPlan;
      }

      if (parsed.perception) {
        const el = modal.querySelector('#fbf-perception');
        if (el && !el.value) el.value = parsed.perception;
      }

      showStatus('✓ Campos preenchidos automaticamente. Revise antes de salvar.');
      toast.success('Áudio transcrito e campos preenchidos!');
    } else {
      // No AI parsing — just put raw text in action plan as fallback
      const actionEl = modal.querySelector('#fbf-action');
      if (actionEl && !actionEl.value) actionEl.value = text;
      showStatus('✓ Transcrito. Distribua o texto nos campos manualmente.');
      toast.info('Áudio transcrito. Edite os campos conforme necessário.');
    }
  }

  // ── Record button ──
  recBtn?.addEventListener('click', async () => {
    if (isRecording) {
      // Stop recording
      mediaRecorder?.stop();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4' });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        isRecording = false;
        recIcon.textContent = '🎙';
        recLabel.textContent = 'Gravar áudio';
        recBtn.style.borderColor = 'var(--border-default)';
        recBtn.style.background = 'var(--bg-surface)';
        stream.getTracks().forEach(t => t.stop());

        if (!audioChunks.length) return;
        const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });

        showStatus('⏳ Transcrevendo áudio...');
        try {
          const text = await transcribeWithGroq(blob);
          if (!text?.trim()) { showStatus('Nenhum texto detectado no áudio.'); return; }
          await fillFieldsFromTranscript(text);
        } catch (e) {
          showStatus(`❌ ${e.message}`);
          toast.error(e.message);
        }
      };

      mediaRecorder.start();
      isRecording = true;
      recIcon.textContent = '⏹';
      recLabel.textContent = 'Parar gravação';
      recBtn.style.borderColor = 'var(--color-danger)';
      recBtn.style.background = 'rgba(239,68,68,0.08)';
      showStatus('<span style="color:var(--color-danger);animation:pulse 1.5s infinite;">●</span> Gravando...');
    } catch (e) {
      toast.error('Não foi possível acessar o microfone. Verifique as permissões do navegador.');
    }
  });

  // ── File upload ──
  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      toast.error('Arquivo muito grande. Máximo 25 MB.');
      return;
    }

    showStatus(`⏳ Transcrevendo "${file.name}"...`);
    try {
      const text = await transcribeWithGroq(file);
      if (!text?.trim()) { showStatus('Nenhum texto detectado no arquivo.'); return; }
      await fillFieldsFromTranscript(text);
    } catch (e) {
      showStatus(`❌ ${e.message}`);
      toast.error(e.message);
    }
    fileInput.value = '';
  });
}

function showFeedbackForm(container, fb = null) {
  const isEdit = !!fb?.id;
  const m = document.createElement('div');
  m.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2000;
    display:flex;align-items:center;justify-content:center;padding:20px;`;

  const LBL = `font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;`;
  const dateVal = fb?.date || new Date().toISOString().slice(0, 10);
  const highlights = fb?.highlights || [''];
  const improvements = fb?.improvements || [''];

  m.innerHTML = `
    <div class="card" style="width:100%;max-width:680px;max-height:92vh;
      padding:0;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:16px 22px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div style="font-weight:700;font-size:1rem;">
          ${isEdit ? 'Editar feedback' : 'Novo feedback'}
        </div>
        <button id="fbf-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);">✕</button>
      </div>

      <div style="overflow-y:auto;flex:1;padding:20px 22px;display:flex;flex-direction:column;gap:14px;">

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="${LBL}">Gestor *</label>
            <select id="fbf-manager" class="filter-select" style="width:100%;">
              <option value="">Selecione…</option>
              ${_users.map(u => `<option value="${esc(u.id)}"
                ${fb?.managerId === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="${LBL}">Colaborador *</label>
            <select id="fbf-collaborator" class="filter-select" style="width:100%;">
              <option value="">Selecione…</option>
              ${_users.map(u => `<option value="${esc(u.id)}"
                ${fb?.collaboratorId === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
          <div>
            <label style="${LBL}">Data</label>
            <input id="fbf-date" type="date" class="portal-field" style="width:100%;"
              value="${esc(dateVal)}">
          </div>
          <div>
            <label style="${LBL}">Contexto *</label>
            <select id="fbf-context" class="filter-select" style="width:100%;">
              <option value="">Selecione…</option>
              ${FB_CONTEXTS.map(c => `<option ${fb?.context === c ? 'selected' : ''}
                value="${esc(c)}">${esc(c)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="${LBL}">Tipo *</label>
            <select id="fbf-type" class="filter-select" style="width:100%;">
              <option value="">Selecione…</option>
              ${FB_TYPES.map(t => `<option ${fb?.type === t.key ? 'selected' : ''}
                value="${esc(t.key)}">${esc(t.label)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div>
          <label style="${LBL}">Tema *</label>
          <input id="fbf-theme" type="text" class="portal-field" style="width:100%;"
            value="${esc(fb?.theme || '')}" placeholder="Principal motivo que gerou o feedback">
        </div>

        <!-- Audio transcription -->
        <div style="background:var(--bg-elevated);border:1px solid var(--border-subtle);
          border-radius:var(--radius-md);padding:14px 16px;">
          <label style="${LBL}color:var(--brand-gold);">🎙 Preencher por áudio</label>
          <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:10px;line-height:1.4;">
            Grave ou envie um áudio descrevendo o feedback. O sistema transcreve e preenche os campos automaticamente.
          </p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" id="fbf-rec-btn" class="btn btn-sm"
              style="background:var(--bg-surface);border:1px solid var(--border-default);
              color:var(--text-primary);gap:6px;">
              <span id="fbf-rec-icon">🎙</span>
              <span id="fbf-rec-label">Gravar áudio</span>
            </button>
            <label class="btn btn-sm" style="background:var(--bg-surface);cursor:pointer;
              border:1px solid var(--border-default);color:var(--text-primary);gap:6px;">
              📎 Enviar arquivo
              <input type="file" id="fbf-audio-file" accept="audio/*,.m4a,.mp3,.wav,.ogg,.webm"
                style="display:none;">
            </label>
          </div>
          <div id="fbf-rec-status" style="display:none;margin-top:10px;font-size:0.8125rem;
            color:var(--text-secondary);display:flex;align-items:center;gap:8px;">
          </div>
          <div id="fbf-transcript-preview" style="display:none;margin-top:10px;
            background:var(--bg-surface);border-radius:var(--radius-sm);padding:10px 12px;
            font-size:0.8125rem;color:var(--text-secondary);max-height:120px;overflow-y:auto;
            border:1px solid var(--border-subtle);">
          </div>
        </div>

        <!-- Highlights (dynamic) -->
        <div>
          <label style="${LBL}">Pontos em destaque</label>
          <div id="fbf-highlights">
            ${highlights.map((h, i) => `
              <div style="display:flex;gap:6px;margin-bottom:6px;" class="fbf-hl-row">
                <input type="text" class="portal-field fbf-hl-input" style="flex:1;"
                  value="${esc(h)}" placeholder="Ponto ${i + 1}">
                <button type="button" class="btn btn-ghost btn-sm fbf-hl-remove"
                  style="color:#EF4444;font-size:0.75rem;">✕</button>
              </div>`).join('')}
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="fbf-add-hl"
            style="font-size:0.75rem;color:var(--brand-gold);">+ Adicionar ponto</button>
        </div>

        <!-- Improvements (dynamic) -->
        <div>
          <label style="${LBL}">Pontos a desenvolver</label>
          <div id="fbf-improvements">
            ${improvements.map((h, i) => `
              <div style="display:flex;gap:6px;margin-bottom:6px;" class="fbf-imp-row">
                <input type="text" class="portal-field fbf-imp-input" style="flex:1;"
                  value="${esc(h)}" placeholder="Ponto ${i + 1}">
                <button type="button" class="btn btn-ghost btn-sm fbf-imp-remove"
                  style="color:#EF4444;font-size:0.75rem;">✕</button>
              </div>`).join('')}
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="fbf-add-imp"
            style="font-size:0.75rem;color:var(--brand-gold);">+ Adicionar ponto</button>
        </div>

        <div>
          <label style="${LBL}">Plano de ação</label>
          <textarea id="fbf-action" class="portal-field" rows="3" style="width:100%;"
            placeholder="Ações combinadas com o colaborador…">${esc(fb?.actionPlan || '')}</textarea>
        </div>

        <div>
          <label style="${LBL}">Percepção do colaborador</label>
          <textarea id="fbf-perception" class="portal-field" rows="2" style="width:100%;"
            placeholder="Como o colaborador reagiu ao feedback?">${esc(fb?.perception || '')}</textarea>
        </div>

      </div>

      <div style="padding:14px 22px;border-top:1px solid var(--border-subtle);
        background:var(--bg-surface);display:flex;gap:10px;flex-shrink:0;">
        <button class="btn btn-secondary" id="fbf-cancel" style="flex:1;">Cancelar</button>
        <button class="btn btn-primary"   id="fbf-save"   style="flex:2;font-weight:600;">
          💾 ${isEdit ? 'Salvar alterações' : 'Registrar feedback'}
        </button>
      </div>
    </div>`;

  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  m.querySelector('#fbf-close')?.addEventListener('click', () => m.remove());
  m.querySelector('#fbf-cancel')?.addEventListener('click', () => m.remove());

  // Dynamic highlights
  function addRow(containerId, cls) {
    const container2 = document.getElementById(containerId);
    const count = container2.querySelectorAll(`.${cls}-input`).length;
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;';
    div.className = `${cls}-row`;
    div.innerHTML = `
      <input type="text" class="portal-field ${cls}-input" style="flex:1;"
        placeholder="Ponto ${count + 1}">
      <button type="button" class="btn btn-ghost btn-sm ${cls}-remove"
        style="color:#EF4444;font-size:0.75rem;">✕</button>`;
    container2.appendChild(div);
    wireRemove(container2, cls);
  }

  function wireRemove(container2, cls) {
    container2.querySelectorAll(`.${cls}-remove`).forEach(btn => {
      btn.onclick = () => {
        if (container2.querySelectorAll(`.${cls}-input`).length > 1) {
          btn.closest(`.${cls}-row`).remove();
        } else {
          btn.closest(`.${cls}-row`).querySelector('input').value = '';
        }
      };
    });
  }

  m.querySelector('#fbf-add-hl')?.addEventListener('click', () => addRow('fbf-highlights', 'fbf-hl'));
  m.querySelector('#fbf-add-imp')?.addEventListener('click', () => addRow('fbf-improvements', 'fbf-imp'));
  wireRemove(document.getElementById('fbf-highlights'), 'fbf-hl');
  wireRemove(document.getElementById('fbf-improvements'), 'fbf-imp');

  // ─── Audio recording & transcription ───
  setupAudioTranscription(m, addRow);

  // Save
  m.querySelector('#fbf-save')?.addEventListener('click', async () => {
    const btn = m.querySelector('#fbf-save');
    const managerId      = m.querySelector('#fbf-manager')?.value;
    const collaboratorId = m.querySelector('#fbf-collaborator')?.value;
    const context        = m.querySelector('#fbf-context')?.value;
    const type           = m.querySelector('#fbf-type')?.value;
    const theme          = m.querySelector('#fbf-theme')?.value?.trim();

    if (!managerId)      { toast.error('Selecione o gestor.'); return; }
    if (!collaboratorId) { toast.error('Selecione o colaborador.'); return; }
    if (!context)        { toast.error('Selecione o contexto.'); return; }
    if (!type)           { toast.error('Selecione o tipo.'); return; }
    if (!theme)          { toast.error('Preencha o tema.'); return; }

    const hlInputs  = [...m.querySelectorAll('.fbf-hl-input')].map(i => i.value.trim()).filter(Boolean);
    const impInputs = [...m.querySelectorAll('.fbf-imp-input')].map(i => i.value.trim()).filter(Boolean);

    btn.disabled = true; btn.textContent = '⏳';
    try {
      const data = {
        managerId,
        collaboratorId,
        date:        m.querySelector('#fbf-date')?.value || new Date().toISOString().slice(0, 10),
        context,
        type,
        theme,
        highlights:  hlInputs,
        improvements: impInputs,
        actionPlan:  m.querySelector('#fbf-action')?.value?.trim() || '',
        perception:  m.querySelector('#fbf-perception')?.value?.trim() || '',
      };
      const savedId = await saveFeedback(fb?.id || null, data);
      const idx = allFeedbacks.findIndex(f => f.id === (fb?.id || savedId));
      const updated = { ...data, id: savedId };
      if (idx >= 0) allFeedbacks[idx] = updated;
      else allFeedbacks.unshift(updated);
      renderFbKpis();
      renderFbList();
      m.remove();
      toast.success(isEdit ? 'Feedback atualizado.' : 'Feedback registrado.');

      // Notify collaborator
      if (!isEdit) {
        import('../services/notifications.js').then(({ notify }) => {
          notify('feedback.created', {
            entityType: 'feedback', entityId: savedId,
            recipientIds: [collaboratorId],
            title: 'Novo feedback recebido',
            body: `${userName(managerId)} registrou um feedback: "${theme}"`,
            route: 'feedbacks',
            category: 'feedback',
          });
        }).catch(() => {});
      }
    } catch(e) {
      toast.error('Erro: ' + e.message);
      btn.disabled = false;
      btn.textContent = `💾 ${isEdit ? 'Salvar alterações' : 'Registrar feedback'}`;
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   Tab: Dashboard
   ═══════════════════════════════════════════════════════════════ */
async function renderDashboardTab(container) {
  const actions = document.getElementById('fb-header-actions');
  if (actions) actions.innerHTML = '';

  const tabContent = document.getElementById('fb-tab-content');
  if (!tabContent) return;

  if (!allFeedbacks.length) {
    allFeedbacks = await fetchFeedbacks().catch(() => []);
  }

  const fbs = allFeedbacks;
  const now = new Date();

  // Feedbacks per collaborator
  const byCollab = {};
  const byManager = {};
  for (const fb of fbs) {
    byCollab[fb.collaboratorId] = (byCollab[fb.collaboratorId] || 0) + 1;
    byManager[fb.managerId] = (byManager[fb.managerId] || 0) + 1;
  }

  // Performance board: highlights vs improvements per collaborator
  const perfBoard = {};
  for (const fb of fbs) {
    if (!perfBoard[fb.collaboratorId]) perfBoard[fb.collaboratorId] = { hl: 0, imp: 0 };
    perfBoard[fb.collaboratorId].hl  += (fb.highlights || []).length;
    perfBoard[fb.collaboratorId].imp += (fb.improvements || []).length;
  }

  // Absence: users with no feedback in last 90 days
  const d90 = new Date(now); d90.setDate(d90.getDate() - 90);
  const recentCollabs = new Set(fbs.filter(fb => {
    const d = fb.date ? new Date(fb.date) : new Date(0);
    return d >= d90;
  }).map(fb => fb.collaboratorId));

  const allActiveUsers = _users.filter(u => u.status !== 'inactive' && u.roleId !== 'partner');
  const absentUsers = allActiveUsers.filter(u => !recentCollabs.has(u.id));

  // Sort helpers
  const sortedCollab = Object.entries(byCollab)
    .map(([id, count]) => ({ id, count, name: userName(id) }))
    .sort((a, b) => b.count - a.count);

  const sortedPerf = Object.entries(perfBoard)
    .map(([id, v]) => ({ id, ...v, name: userName(id) }))
    .sort((a, b) => (b.hl + b.imp) - (a.hl + a.imp));

  tabContent.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:20px;">

      <!-- Feedbacks por colaborador -->
      <div class="card" style="padding:20px;">
        <h3 style="font-size:0.875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
          color:var(--text-muted);margin:0 0 16px;">Feedbacks por colaborador</h3>
        ${sortedCollab.length ? sortedCollab.slice(0, 15).map(c => `
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:0.8125rem;font-weight:600;overflow:hidden;
                text-overflow:ellipsis;white-space:nowrap;">${esc(c.name)}</div>
            </div>
            <div style="width:120px;height:8px;background:var(--bg-dark);border-radius:4px;overflow:hidden;">
              <div style="height:100%;background:var(--brand-gold);border-radius:4px;
                width:${Math.min(c.count / (sortedCollab[0]?.count || 1) * 100, 100)}%;"></div>
            </div>
            <span style="font-size:0.875rem;font-weight:700;min-width:28px;text-align:right;">
              ${c.count}
            </span>
          </div>`).join('') : '<div style="color:var(--text-muted);font-size:0.875rem;">Nenhum dado.</div>'}
      </div>

      <!-- Quadro de performance -->
      <div class="card" style="padding:20px;">
        <h3 style="font-size:0.875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
          color:var(--text-muted);margin:0 0 16px;">Quadro de performance</h3>
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:4px;margin-bottom:10px;">
          <div style="font-size:0.6875rem;font-weight:700;color:var(--text-muted);">Colaborador</div>
          <div style="font-size:0.6875rem;font-weight:700;color:#22C55E;text-align:center;">▲ Destaques</div>
          <div style="font-size:0.6875rem;font-weight:700;color:#EF4444;text-align:center;">▼ Desenvolver</div>
        </div>
        ${sortedPerf.length ? sortedPerf.slice(0, 15).map(p => `
          <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:4px;padding:6px 0;
            border-top:1px solid var(--border-subtle);">
            <div style="font-size:0.8125rem;font-weight:600;overflow:hidden;
              text-overflow:ellipsis;white-space:nowrap;">${esc(p.name)}</div>
            <div style="text-align:center;font-weight:700;color:#22C55E;">${p.hl}</div>
            <div style="text-align:center;font-weight:700;color:#EF4444;">${p.imp}</div>
          </div>`).join('') : '<div style="color:var(--text-muted);font-size:0.875rem;">Nenhum dado.</div>'}
      </div>

      <!-- Ausência de feedback -->
      <div class="card" style="padding:20px;">
        <h3 style="font-size:0.875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
          color:var(--text-muted);margin:0 0 4px;">Ausência de feedback (>90 dias)</h3>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:16px;">
          ${absentUsers.length} colaborador${absentUsers.length !== 1 ? 'es' : ''} sem feedback recente
        </div>
        ${absentUsers.length ? `
          <div style="max-height:320px;overflow-y:auto;">
            ${absentUsers.slice(0, 25).map(u => {
              const lastFb = fbs.filter(f => f.collaboratorId === u.id)
                .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))[0];
              const lastDate = lastFb?.date ? new Date(lastFb.date) : null;
              const daysSince = lastDate ? Math.floor((now - lastDate) / (1000*60*60*24)) : null;
              return `
              <div style="display:flex;align-items:center;gap:10px;padding:8px 0;
                border-top:1px solid var(--border-subtle);">
                <div style="flex:1;min-width:0;">
                  <div style="font-size:0.8125rem;font-weight:600;overflow:hidden;
                    text-overflow:ellipsis;white-space:nowrap;">${esc(u.name)}</div>
                  <div style="font-size:0.6875rem;color:var(--text-muted);">
                    ${u.sector || u.department || ''}
                  </div>
                </div>
                <span style="font-size:0.75rem;padding:3px 10px;border-radius:20px;
                  ${daysSince !== null
                    ? `background:#EF444418;color:#EF4444;border:1px solid #EF444430;`
                    : `background:var(--bg-surface);color:var(--text-muted);border:1px solid var(--border-subtle);`}">
                  ${daysSince !== null ? `${daysSince}d atrás` : 'Nunca'}
                </span>
              </div>`;
            }).join('')}
          </div>` : '<div style="color:#22C55E;font-size:0.875rem;">Todos os colaboradores estão em dia!</div>'}
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   Tab: Schedule (Rotina de feedbacks)
   ═══════════════════════════════════════════════════════════════ */
async function renderScheduleTab(container) {
  const actions = document.getElementById('fb-header-actions');
  if (actions) actions.innerHTML = `
    <button class="btn btn-primary btn-sm" id="sch-new-btn">+ Nova rotina</button>`;

  const tabContent = document.getElementById('fb-tab-content');
  if (!tabContent) return;

  tabContent.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">⏳ Carregando…</div>`;

  const schedules = await fetchFeedbackSchedules().catch(() => []);

  // Check overdue
  const overdue = await checkOverdueSchedules().catch(() => []);
  const overdueMap = {};
  for (const o of overdue) {
    if (!overdueMap[o.schedule.id]) overdueMap[o.schedule.id] = [];
    overdueMap[o.schedule.id].push(o);
  }

  if (!schedules.length) {
    tabContent.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">🔔</div>
      <div class="empty-state-title">Nenhuma rotina de feedbacks criada</div>
      <div class="empty-state-subtitle">Crie uma rotina para receber alertas quando for hora de dar feedback.</div>
    </div>`;
  } else {
    tabContent.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px;">
        ${schedules.map(sch => {
          const freq = FB_SCHEDULE_FREQUENCIES.find(f => f.key === sch.frequency);
          const overdueItems = overdueMap[sch.id] || [];
          const collabNames = (sch.collaboratorIds || []).map(id => userName(id));
          return `
          <div class="card" style="padding:16px;border-left:4px solid ${sch.active ? 'var(--brand-gold)' : 'var(--border-subtle)'};">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
              <div>
                <div style="font-weight:700;font-size:0.9375rem;">
                  ${esc(sch.name || 'Rotina de feedback')}
                </div>
                <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
                  Gestor: ${esc(userName(sch.managerId))} · ${esc(freq?.label || sch.frequency)}
                </div>
              </div>
              <div style="display:flex;gap:6px;">
                <button class="btn btn-ghost btn-sm sch-edit" data-id="${esc(sch.id)}"
                  style="font-size:0.75rem;color:var(--brand-gold);">✎</button>
                <button class="btn btn-ghost btn-sm sch-del" data-id="${esc(sch.id)}"
                  style="font-size:0.75rem;color:#EF4444;">✕</button>
              </div>
            </div>

            <div style="font-size:0.8125rem;margin-bottom:8px;">
              <span style="font-weight:600;">Colaboradores:</span>
              ${collabNames.length
                ? collabNames.map(n => `<span style="display:inline-block;padding:2px 8px;
                    background:var(--bg-surface);border:1px solid var(--border-subtle);
                    border-radius:20px;font-size:0.6875rem;margin:2px;">${esc(n)}</span>`).join('')
                : '<span style="color:var(--text-muted);">Nenhum</span>'}
            </div>

            ${overdueItems.length ? `
              <div style="padding:8px 12px;background:#EF444408;border:1px solid #EF444420;
                border-radius:var(--radius-sm);margin-top:8px;">
                <div style="font-size:0.6875rem;font-weight:600;color:#EF4444;margin-bottom:4px;">
                  ⚠ ${overdueItems.length} feedback(s) pendente(s):
                </div>
                ${overdueItems.map(o => `<div style="font-size:0.75rem;color:var(--text-secondary);">
                  ${esc(o.collaboratorName)} — ${o.daysSinceLast}d desde o último
                </div>`).join('')}
              </div>` : `
              <div style="font-size:0.75rem;color:#22C55E;">✓ Em dia</div>`}

            <div style="margin-top:8px;font-size:0.6875rem;color:var(--text-muted);">
              ${sch.active
                ? `<span style="color:#22C55E;font-weight:600;">● Ativa</span>`
                : `<span style="color:var(--text-muted);font-weight:600;">○ Inativa</span>`}
            </div>
          </div>`;
        }).join('')}
      </div>`;
  }

  document.getElementById('sch-new-btn')?.addEventListener('click', () => showScheduleForm(container));

  tabContent.querySelectorAll('.sch-edit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sch = schedules.find(s => s.id === btn.dataset.id);
      if (sch) showScheduleForm(container, sch);
    });
  });
  tabContent.querySelectorAll('.sch-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Excluir esta rotina?')) return;
      await deleteFeedbackSchedule(btn.dataset.id);
      toast.success('Rotina excluída.');
      renderScheduleTab(container);
    });
  });
}

function showScheduleForm(container, sch = null) {
  const isEdit = !!sch?.id;
  const m = document.createElement('div');
  m.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2000;
    display:flex;align-items:center;justify-content:center;padding:20px;`;

  const LBL = `font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;`;
  const selectedCollabs = sch?.collaboratorIds || [];

  m.innerHTML = `
    <div class="card" style="width:100%;max-width:560px;max-height:90vh;
      padding:0;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:16px 22px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div style="font-weight:700;">${isEdit ? 'Editar rotina' : 'Nova rotina de feedbacks'}</div>
        <button class="schf-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);">✕</button>
      </div>
      <div style="overflow-y:auto;flex:1;padding:20px 22px;display:flex;flex-direction:column;gap:14px;">
        <div>
          <label style="${LBL}">Nome da rotina</label>
          <input id="schf-name" type="text" class="portal-field" style="width:100%;"
            value="${esc(sch?.name || '')}" placeholder="Ex: Feedback mensal equipe vendas">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="${LBL}">Gestor responsável *</label>
            <select id="schf-manager" class="filter-select" style="width:100%;">
              <option value="">Selecione…</option>
              ${_users.map(u => `<option value="${esc(u.id)}"
                ${sch?.managerId === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="${LBL}">Frequência *</label>
            <select id="schf-freq" class="filter-select" style="width:100%;">
              ${FB_SCHEDULE_FREQUENCIES.map(f => `<option value="${esc(f.key)}"
                ${sch?.frequency === f.key ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div>
          <label style="${LBL}">Colaboradores *</label>
          <div style="max-height:200px;overflow-y:auto;border:1px solid var(--border-subtle);
            border-radius:var(--radius-sm);padding:8px;">
            ${_users.filter(u => u.status !== 'inactive' && u.roleId !== 'partner').map(u => `
              <label style="display:flex;align-items:center;gap:8px;padding:4px 0;
                font-size:0.8125rem;cursor:pointer;">
                <input type="checkbox" class="schf-collab-cb" value="${esc(u.id)}"
                  ${selectedCollabs.includes(u.id) ? 'checked' : ''}>
                ${esc(u.name)}
                <span style="font-size:0.6875rem;color:var(--text-muted);">${esc(u.sector || u.department || '')}</span>
              </label>`).join('')}
          </div>
        </div>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="schf-active" ${sch?.active !== false ? 'checked' : ''}>
          <span style="font-size:0.8125rem;font-weight:600;">Rotina ativa</span>
        </label>
      </div>
      <div style="padding:14px 22px;border-top:1px solid var(--border-subtle);
        background:var(--bg-surface);display:flex;gap:10px;flex-shrink:0;">
        <button class="btn btn-secondary schf-close" style="flex:1;">Cancelar</button>
        <button class="btn btn-primary" id="schf-save" style="flex:2;font-weight:600;">
          💾 ${isEdit ? 'Salvar' : 'Criar rotina'}
        </button>
      </div>
    </div>`;

  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  m.querySelectorAll('.schf-close').forEach(b => b.addEventListener('click', () => m.remove()));

  m.querySelector('#schf-save')?.addEventListener('click', async () => {
    const managerId = m.querySelector('#schf-manager')?.value;
    if (!managerId) { toast.error('Selecione o gestor.'); return; }
    const collabIds = [...m.querySelectorAll('.schf-collab-cb:checked')].map(cb => cb.value);
    if (!collabIds.length) { toast.error('Selecione ao menos um colaborador.'); return; }

    const btn = m.querySelector('#schf-save');
    btn.disabled = true; btn.textContent = '⏳';
    try {
      await saveFeedbackSchedule(sch?.id || null, {
        name:            m.querySelector('#schf-name')?.value?.trim() || 'Rotina de feedback',
        managerId,
        frequency:       m.querySelector('#schf-freq')?.value || 'monthly',
        collaboratorIds: collabIds,
        active:          m.querySelector('#schf-active')?.checked ?? true,
        startDate:       new Date().toISOString().slice(0, 10),
      });
      toast.success(isEdit ? 'Rotina atualizada.' : 'Rotina criada.');
      m.remove();
      renderScheduleTab(container);
    } catch(e) {
      toast.error('Erro: ' + e.message);
      btn.disabled = false;
      btn.textContent = `💾 ${isEdit ? 'Salvar' : 'Criar rotina'}`;
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   Tab: Import
   ═══════════════════════════════════════════════════════════════ */
async function renderImportTab(container) {
  const actions = document.getElementById('fb-header-actions');
  if (actions) actions.innerHTML = '';

  const tabContent = document.getElementById('fb-tab-content');
  if (!tabContent) return;

  tabContent.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;">
      <div class="card" style="padding:20px;">
        <h3 style="font-size:0.875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
          color:var(--text-muted);margin:0 0 16px;">📥 Importar feedbacks via planilha</h3>
        <p style="font-size:0.8125rem;color:var(--text-secondary);margin-bottom:16px;">
          Importe múltiplos feedbacks de uma vez usando uma planilha Excel (.xlsx).
          Use a planilha modelo para garantir o formato correto.
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-secondary btn-sm" id="fb-download-template">
            ⬇ Baixar planilha modelo
          </button>
        </div>
      </div>
      <div class="card" style="padding:20px;">
        <h3 style="font-size:0.875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
          color:var(--text-muted);margin:0 0 16px;">📖 Manual de importação</h3>
        <div style="font-size:0.8125rem;color:var(--text-secondary);">
          <div style="margin-bottom:8px;"><strong>Colunas obrigatórias:</strong></div>
          <ul style="padding-left:16px;margin:0 0 8px;">
            <li><strong>Gestor</strong> — Nome completo (como cadastrado no sistema)</li>
            <li><strong>Colaborador</strong> — Nome completo</li>
            <li><strong>Data</strong> — Formato DD/MM/AAAA ou AAAA-MM-DD</li>
            <li><strong>Tema</strong> — Motivo principal do feedback</li>
          </ul>
          <div style="margin-bottom:8px;"><strong>Colunas opcionais:</strong></div>
          <ul style="padding-left:16px;margin:0;">
            <li><strong>Contexto</strong> — Rotina, Situação pontual, Avaliação</li>
            <li><strong>Tipo</strong> — Positivo, Negativo, Misto, Desenvolvimento</li>
            <li><strong>Pontos em destaque</strong> — Separar por quebra de linha</li>
            <li><strong>Pontos a desenvolver</strong> — Separar por quebra de linha</li>
            <li><strong>Plano de ação</strong> — Texto livre</li>
            <li><strong>Percepção do colaborador</strong> — Texto livre</li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Upload area -->
    <div class="card" style="padding:24px;">
      <div id="fb-import-dropzone"
        style="border:2px dashed var(--border-subtle);border-radius:var(--radius-md);
        padding:40px;text-align:center;cursor:pointer;transition:all .2s;"
        onmouseover="this.style.borderColor='var(--brand-gold)'"
        onmouseout="this.style.borderColor='var(--border-subtle)'">
        <div style="font-size:2.5rem;margin-bottom:10px;">📊</div>
        <div style="font-size:1rem;font-weight:600;margin-bottom:6px;">
          Arraste o arquivo .xlsx aqui ou clique para selecionar
        </div>
        <input type="file" id="fb-import-file" accept=".xlsx,.xls" style="display:none;">
      </div>
      <div id="fb-import-preview" style="margin-top:16px;display:none;"></div>
    </div>`;

  // Download template
  document.getElementById('fb-download-template')?.addEventListener('click', generateTemplate);

  // File upload
  const dropzone = document.getElementById('fb-import-dropzone');
  const fileInput = document.getElementById('fb-import-file');

  dropzone?.addEventListener('click', () => fileInput?.click());
  dropzone?.addEventListener('dragover', e => { e.preventDefault(); dropzone.style.borderColor = 'var(--brand-gold)'; });
  dropzone?.addEventListener('dragleave', () => { dropzone.style.borderColor = 'var(--border-subtle)'; });
  dropzone?.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--border-subtle)';
    const file = e.dataTransfer?.files?.[0];
    if (file) handleImportFile(file, container);
  });
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) handleImportFile(file, container);
  });
}

async function generateTemplate() {
  if (!window.XLSX) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }
  const header = ['Gestor','Colaborador','Data','Contexto','Tipo','Tema',
    'Pontos em destaque','Pontos a desenvolver','Plano de ação','Percepção do colaborador'];
  const example = ['Maria Silva','João Santos','2025-04-01','Rotina','Positivo',
    'Excelente atendimento ao cliente','Proatividade\nComunicação clara',
    'Gestão de tempo','Criar rotina de priorização semanal','Colaborador concordou e se mostrou motivado'];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([header, example]);
  ws['!cols'] = header.map(() => ({ wch: 25 }));
  XLSX.utils.book_append_sheet(wb, ws, 'Feedbacks');
  XLSX.writeFile(wb, 'modelo_importacao_feedbacks.xlsx');
  toast.success('Planilha modelo baixada.');
}

async function handleImportFile(file, container) {
  if (!window.XLSX) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }

  const preview = document.getElementById('fb-import-preview');
  if (!preview) return;
  preview.style.display = 'block';
  preview.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);">⏳ Lendo arquivo…</div>`;

  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(ws);

    if (!rawRows.length) {
      preview.innerHTML = `<div style="color:#EF4444;padding:16px;">Planilha vazia ou formato incorreto.</div>`;
      return;
    }

    const parsed = rawRows.map(r => parseImportRow(r));
    const resolved = resolveImportUsers(parsed, _users);
    const validCount = resolved.filter(r => r._valid).length;
    const errorCount = resolved.filter(r => !r._valid).length;

    preview.innerHTML = `
      <div style="margin-bottom:12px;">
        <span style="font-weight:600;">${resolved.length} linha(s) lida(s)</span> —
        <span style="color:#22C55E;font-weight:600;">${validCount} válida(s)</span>
        ${errorCount ? `· <span style="color:#EF4444;font-weight:600;">${errorCount} com erro(s)</span>` : ''}
      </div>

      <div style="max-height:300px;overflow:auto;border:1px solid var(--border-subtle);
        border-radius:var(--radius-sm);margin-bottom:16px;">
        <table style="width:100%;border-collapse:collapse;font-size:0.75rem;">
          <thead>
            <tr style="background:var(--bg-surface);">
              <th style="padding:8px;text-align:left;">Status</th>
              <th style="padding:8px;text-align:left;">Gestor</th>
              <th style="padding:8px;text-align:left;">Colaborador</th>
              <th style="padding:8px;text-align:left;">Data</th>
              <th style="padding:8px;text-align:left;">Tema</th>
              <th style="padding:8px;text-align:left;">Erros</th>
            </tr>
          </thead>
          <tbody>
            ${resolved.map(r => `
              <tr style="border-top:1px solid var(--border-subtle);
                background:${r._valid ? '' : '#EF444408'};">
                <td style="padding:6px 8px;">${r._valid ? '✅' : '❌'}</td>
                <td style="padding:6px 8px;">${esc(r.managerName)}</td>
                <td style="padding:6px 8px;">${esc(r.collaboratorName)}</td>
                <td style="padding:6px 8px;">${esc(r.date)}</td>
                <td style="padding:6px 8px;">${esc(r.theme)}</td>
                <td style="padding:6px 8px;color:#EF4444;">${r._errors.join('; ')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      ${validCount > 0 ? `
        <button class="btn btn-primary" id="fb-confirm-import" style="font-weight:600;">
          📥 Importar ${validCount} feedback(s) válido(s)
        </button>` : ''}`;

    document.getElementById('fb-confirm-import')?.addEventListener('click', async () => {
      const btn = document.getElementById('fb-confirm-import');
      btn.disabled = true; btn.textContent = '⏳ Importando…';
      try {
        const count = await batchImportFeedbacks(resolved);
        toast.success(`${count} feedback(s) importado(s)!`);
        allFeedbacks = await fetchFeedbacks().catch(() => []);
        activeTab = 'list';
        renderActiveTab(container);
        // Switch tab visual
        document.querySelectorAll('.fb-tab').forEach(b => {
          const active = b.dataset.tab === 'list';
          b.style.color = active ? 'var(--text-primary)' : 'var(--text-muted)';
          b.style.borderBottomColor = active ? 'var(--brand-gold)' : 'transparent';
        });
      } catch(e) {
        toast.error('Erro na importação: ' + e.message);
        btn.disabled = false; btn.textContent = `📥 Importar ${validCount} feedback(s) válido(s)`;
      }
    });
  } catch(e) {
    preview.innerHTML = `<div style="color:#EF4444;padding:16px;">Erro ao ler arquivo: ${esc(e.message)}</div>`;
  }
}

/* ═══════════════════════════════════════════════════════════════
   Exports (XLS + PDF)
   ═══════════════════════════════════════════════════════════════ */
async function exportFbXls() {
  const items = applyClientFilters(allFeedbacks);
  if (!items.length) { toast.error('Nenhum item para exportar.'); return; }

  if (!window.XLSX) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }

  const typeLabel = key => FB_TYPES.find(t => t.key === key)?.label || key;
  const rows = [
    ['Data','Gestor','Colaborador','Tipo','Contexto','Tema','Pontos em destaque',
     'Pontos a desenvolver','Plano de ação','Percepção do colaborador'],
    ...items.map(i => [
      fmt(i.date), userName(i.managerId), userName(i.collaboratorId),
      typeLabel(i.type), i.context || '',  i.theme || '',
      (i.highlights || []).join('\n'), (i.improvements || []).join('\n'),
      i.actionPlan || '', i.perception || '',
    ]),
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [14, 25, 25, 16, 18, 30, 35, 35, 35, 30].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, 'Feedbacks');
  XLSX.writeFile(wb, `primetour_feedbacks_${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast.success('XLS exportado.');
}

const exportFbPdf = withExportGuard(async function exportFbPdf() {
  const items = applyClientFilters(allFeedbacks);
  if (!items.length) { toast.error('Nenhum item para exportar.'); return; }
  await loadJsPdf();

  // Mapa de cores por tipo (positivo/negativo/reconhecimento/alerta etc.)
  const TYPE_COL = {
    positivo:       COL.green,
    positive:       COL.green,
    reconhecimento: COL.green,
    negativo:       COL.orange,
    constructive:   COL.orange,
    alerta:         COL.red,
    critico:        COL.red,
    desenvolvimento:COL.blue,
    crescimento:    COL.blue,
  };
  const typeLabel = key => FB_TYPES.find(t => t.key === key)?.label || key;
  const typeColor = key => TYPE_COL[(key||'').toLowerCase()] || COL.brand2;

  const kit = createDoc({ orientation: 'portrait', margin: 14 });
  const { doc, W, M, CW, setFill, setText, setDraw, drawBar, drawChip, wrap } = kit;

  // Stats agregadas
  const byType = items.reduce((acc, i) => {
    const k = i.type || '—'; acc[k] = (acc[k] || 0) + 1; return acc;
  }, {});

  kit.drawCover({
    title: 'Feedbacks',
    subtitle: 'PRIMETOUR  ·  Registro de Feedbacks',
    meta: `${items.length} ${items.length === 1 ? 'registro' : 'registros'}  ·  ${new Date().toLocaleDateString('pt-BR')}`,
  });

  // Strip de tipos (chips coloridas com contagem)
  const typeEntries = Object.entries(byType);
  if (typeEntries.length) {
    setText(COL.muted); doc.setFont('helvetica','bold'); doc.setFontSize(7);
    doc.text(txt('POR TIPO'), M, kit.y); kit.addY(4);
    let cx = M;
    typeEntries.forEach(([k, n]) => {
      const lbl = `${typeLabel(k)}  ${n}`;
      const ch = drawChip(lbl, cx, kit.y, typeColor(k), COL.white, 7.2, 3, 1.6);
      cx += ch.w + 3;
      if (cx > W - M - 40) { kit.addY(ch.h + 1.5); cx = M; }
    });
    kit.addY(10);
  }

  // Cards individuais
  items.forEach((fb, idx) => {
    const tpCol = typeColor(fb.type);
    const mgr = userName(fb.managerId);
    const col = userName(fb.collaboratorId);
    const data = fmt(fb.date);
    const theme = fb.theme || '';
    const ctx  = fb.context || '';
    const hi = (fb.highlights || []).filter(Boolean);
    const imp = (fb.improvements || []).filter(Boolean);

    // Calcula altura estimada
    const themeLines = theme ? wrap(theme, CW - 16, 9) : [];
    const hiLines  = hi.length  ? wrap('• ' + hi.join('   • '),  CW - 18, 8) : [];
    const impLines = imp.length ? wrap('• ' + imp.join('   • '), CW - 18, 8) : [];
    const cardH = 14 + themeLines.length*4 + (hiLines.length + impLines.length)*3.6 + 10;

    kit.ensureSpace(cardH + 4);

    const top = kit.y;
    // Card
    setFill(COL.white); setDraw(COL.border); doc.setLineWidth(0.2);
    doc.roundedRect(M, top, CW, cardH, 2, 2, 'FD');
    // Barra colorida lateral
    setFill(tpCol); doc.rect(M, top, 2, cardH, 'F');

    // Header: data + tipo chip
    kit.y = top + 5;
    setText(COL.muted); doc.setFont('helvetica','bold'); doc.setFontSize(6.8);
    doc.text(txt(String(idx + 1).padStart(2, '0')), M + 5, kit.y);
    const numW = doc.getTextWidth(String(idx + 1).padStart(2, '0')) + 2;
    setText(COL.text); doc.setFont('helvetica','bold'); doc.setFontSize(8.2);
    doc.text(txt(data), M + 5 + numW, kit.y);
    const dataW = doc.getTextWidth(txt(data)) + 3;
    drawChip(typeLabel(fb.type), M + 5 + numW + dataW, top + 2.8, tpCol, COL.white, 6.8, 2.4, 1.3);

    // Tema (título grande)
    kit.y = top + 10;
    if (themeLines.length) {
      setText(COL.text); doc.setFont('helvetica','bold'); doc.setFontSize(9);
      doc.text(themeLines, M + 5, kit.y);
      kit.addY(themeLines.length * 4);
    }

    // Gestor → Colaborador (linha)
    setText(COL.muted); doc.setFont('helvetica','normal'); doc.setFontSize(7.5);
    const gcLine = `${mgr}  ·  para  ·  ${col}${ctx ? '   ·   ' + ctx : ''}`;
    doc.text(txt(gcLine), M + 5, kit.y);
    kit.addY(4);

    // Destaques (verde)
    if (hiLines.length) {
      setText(COL.green); doc.setFont('helvetica','bold'); doc.setFontSize(6.5);
      doc.text(txt('DESTAQUES'), M + 5, kit.y); kit.addY(2.8);
      setText(COL.text); doc.setFont('helvetica','normal'); doc.setFontSize(8);
      doc.text(hiLines, M + 7, kit.y);
      kit.addY(hiLines.length * 3.6 + 1);
    }
    // Desenvolver (laranja)
    if (impLines.length) {
      setText(COL.orange); doc.setFont('helvetica','bold'); doc.setFontSize(6.5);
      doc.text(txt('A DESENVOLVER'), M + 5, kit.y); kit.addY(2.8);
      setText(COL.text); doc.setFont('helvetica','normal'); doc.setFontSize(8);
      doc.text(impLines, M + 7, kit.y);
      kit.addY(impLines.length * 3.6 + 1);
    }

    kit.y = top + cardH + 3;
  });

  kit.drawFooter('PRIMETOUR  ·  Feedbacks');
  doc.save(`primetour_feedbacks_${new Date().toISOString().slice(0, 10)}.pdf`);
  toast.success('PDF exportado.');
});
