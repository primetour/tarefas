/**
 * PRIMETOUR — Dev Hours Page (#dev-hours)
 *
 * Histórico de horas de desenvolvimento, custo e categorização. Master-only
 * por padrão (4.0.0); página pública vem na 4.2.0 e PDF na 4.3.0.
 *
 * Cards: Horas trabalhadas (filtrável) · Custo total · Em rascunho · Aprovados.
 * Tabela: por release/fase, com expand pra ver decomposição categórica.
 * Modal "Como cheguei": expõe bucket + multiplicadores + decomposição → garante
 * transparência exigida ao se cobrar de cliente.
 */

import { store }   from '../store.js';
import { toast }   from '../components/toast.js';
import {
  CATEGORIES, CATEGORY_MAP, BUCKETS, BUCKET_MAP, STATUSES, STATUS_MAP,
  DEFAULT_MULTIPLIERS, MULTIPLIER_MAP, ENTRY_TYPES, DEFAULT_HOURLY_RATE,
  subscribeToDevHours, createEntry, updateEntry, deleteEntry,
  approveEntry, rejectEntry, reopenEntry,
  calcHoursFromBucket, calcCost, suggestCategoryBreakdown, explainEntry,
  sumEntries, filterEntries,
} from '../services/devHours.js';

const esc = s => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let _allEntries = [];
let _unsubscribe = null;

// Filtros UI (defaults)
let f_from   = null;     // Date | null
let f_to     = null;     // Date | null
let f_period = '';       // '' | 'month' | 'quarter' | 'year' | 'all' | 'custom'
let f_statuses = ['draft','approved','rejected']; // default: TODAS pra evitar "voltou vazio" pós-seed
let f_types  = ['release', 'phase'];
let f_search = '';

const fmtBR = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtH = n => `${(n || 0).toFixed(2).replace(/\.00$/, '')}h`;
const fmtDate = (ts) => {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('pt-BR');
};

/* ─────────────────────────────────────────────────────────────────── */
export async function renderDevHours(container) {
  if (!store.isMaster()) {
    container.innerHTML = `<div class="card" style="margin:24px;padding:24px;">
      <h2>🔒 Acesso restrito</h2>
      <p>Esta página é visível apenas para administradores master.</p>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">⏱ Horas de Desenvolvimento</h1>
        <p class="page-subtitle" id="devh-summary">Carregando...</p>
      </div>
      <div class="page-header-actions" style="display:flex;gap:8px;">
        <button class="btn btn-secondary" id="devh-pdf-btn" title="Exportar entradas filtradas para PDF">📄 Exportar PDF</button>
        <button class="btn btn-primary" id="devh-new-btn">+ Nova entrada</button>
      </div>
    </div>

    <!-- Disclaimer permanente -->
    <div class="card" style="margin-bottom:16px;border-left:3px solid #F59E0B;background:rgba(245,158,11,.06);">
      <div class="card-body" style="padding:12px 16px;font-size:0.8125rem;color:var(--text-secondary);">
        <strong>⚠ Estimativa equivalente, não cronometragem.</strong>
        Os valores refletem o tempo que um sr full-stack dev com conhecimento do
        codebase levaria pra entregar o mesmo escopo. Cada entrada expõe a metodologia
        completa via "ⓘ Como cheguei" — taxa horária R$ ${DEFAULT_HOURLY_RATE},00.
      </div>
    </div>

    <!-- Cards -->
    <div id="devh-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px;"></div>

    <!-- Filtros -->
    <div class="card" style="margin-bottom:16px;">
      <div class="card-body" style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;padding:12px 16px;">
        <select class="filter-select" id="devh-period">
          <option value="">Todo período</option>
          <option value="month">Este mês</option>
          <option value="quarter">Este trimestre</option>
          <option value="year">Este ano</option>
          <option value="custom">Personalizado</option>
        </select>
        <div id="devh-custom-range" style="display:none;gap:8px;align-items:center;">
          <input type="date" id="devh-from" class="form-input" style="width:140px;">
          <span>até</span>
          <input type="date" id="devh-to" class="form-input" style="width:140px;">
        </div>
        <select class="filter-select" id="devh-status">
          <option value="all" selected>Todas</option>
          <option value="approved">Só aprovadas</option>
          <option value="draft">Só rascunhos</option>
          <option value="rejected">Só rejeitadas</option>
        </select>
        <select class="filter-select" id="devh-type">
          <option value="all">Todos os tipos</option>
          <option value="release">Releases</option>
          <option value="phase">Fases retroativas</option>
        </select>
        <input type="text" class="form-input" id="devh-search" placeholder="Buscar título/versão..."
          style="flex:1;min-width:200px;">
      </div>
    </div>

    <!-- Tabela -->
    <div class="card" style="overflow:auto;">
      <table id="devh-table" style="width:100%;border-collapse:collapse;font-size:0.875rem;">
        <thead>
          <tr style="background:var(--bg-elevated);text-align:left;">
            <th style="padding:10px 12px;width:90px;">Data</th>
            <th style="padding:10px 12px;width:90px;">Tipo</th>
            <th style="padding:10px 12px;">Versão / Fase / Título</th>
            <th style="padding:10px 12px;width:140px;">Categorias</th>
            <th style="padding:10px 12px;width:80px;text-align:right;">Horas</th>
            <th style="padding:10px 12px;width:110px;text-align:right;">Custo</th>
            <th style="padding:10px 12px;width:100px;">Status</th>
            <th style="padding:10px 12px;width:140px;">Ações</th>
          </tr>
        </thead>
        <tbody id="devh-tbody"><tr><td colspan="8" style="padding:24px;text-align:center;">Carregando...</td></tr></tbody>
      </table>
    </div>

    <!-- Container de modais -->
    <div id="devh-modal-root"></div>
  `;

  attachFiltersEvents();
  document.getElementById('devh-new-btn').addEventListener('click', () => openEditModal(null));

  // Exportar PDF — usa as entradas atualmente filtradas, mas APENAS aprovadas
  // (mesma regra do link público — drafts/rejeitadas não vão pro cliente).
  document.getElementById('devh-pdf-btn').addEventListener('click', async () => {
    try {
      const filtered = filterEntries(_allEntries, {
        from: f_from, to: f_to,
        statuses: ['approved'], // força apenas aprovadas no export
        types: f_types,
      });
      if (!filtered.length) {
        toast.error('Nenhuma entrada aprovada nos filtros atuais. Aprove pelo menos 1 entrada antes de exportar.');
        return;
      }
      const { exportDevHoursPdf } = await import('../services/devHoursPdf.js');
      const periodLabel = f_period === 'month'   ? 'Este mês'
                       : f_period === 'quarter' ? 'Este trimestre'
                       : f_period === 'year'    ? 'Este ano'
                       : f_period === 'custom'  ? `${f_from?.toLocaleDateString('pt-BR')||''} a ${f_to?.toLocaleDateString('pt-BR')||''}`
                       : 'Histórico completo';
      await exportDevHoursPdf(filtered, { periodLabel });
      toast.success('PDF gerado.');
    } catch (e) {
      console.error('[devHours] PDF error:', e);
      toast.error('Falha ao gerar PDF: ' + e.message);
    }
  });

  // Subscribe real-time
  if (_unsubscribe) _unsubscribe();
  _unsubscribe = subscribeToDevHours((items) => {
    _allEntries = items;
    rerender();
  });
}

export function destroyDevHours() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
}

/* ─────────────────────────────────────────────────────────────────── */
function attachFiltersEvents() {
  document.getElementById('devh-period').addEventListener('change', e => {
    f_period = e.target.value;
    const customWrap = document.getElementById('devh-custom-range');
    customWrap.style.display = (f_period === 'custom') ? 'flex' : 'none';
    applyPeriod();
    rerender();
  });
  document.getElementById('devh-from').addEventListener('change', e => {
    f_from = e.target.value ? new Date(e.target.value + 'T00:00:00') : null;
    rerender();
  });
  document.getElementById('devh-to').addEventListener('change', e => {
    f_to = e.target.value ? new Date(e.target.value + 'T23:59:59') : null;
    rerender();
  });
  document.getElementById('devh-status').addEventListener('change', e => {
    const v = e.target.value;
    f_statuses = v === 'all' ? ['draft','approved','rejected'] : [v];
    rerender();
  });
  document.getElementById('devh-type').addEventListener('change', e => {
    const v = e.target.value;
    f_types = v === 'all' ? ['release','phase'] : [v];
    rerender();
  });
  document.getElementById('devh-search').addEventListener('input', e => {
    f_search = e.target.value.trim().toLowerCase();
    rerender();
  });
}

function applyPeriod() {
  const now = new Date();
  if (f_period === 'month') {
    f_from = new Date(now.getFullYear(), now.getMonth(), 1);
    f_to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  } else if (f_period === 'quarter') {
    const q = Math.floor(now.getMonth() / 3);
    f_from = new Date(now.getFullYear(), q * 3, 1);
    f_to = new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59);
  } else if (f_period === 'year') {
    f_from = new Date(now.getFullYear(), 0, 1);
    f_to = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
  } else if (f_period !== 'custom') {
    f_from = null; f_to = null;
  }
}

/* ─────────────────────────────────────────────────────────────────── */
function rerender() {
  const filtered = filterEntries(_allEntries, {
    from: f_from, to: f_to, statuses: f_statuses, types: f_types,
  }).filter(e => {
    if (!f_search) return true;
    const hay = `${e.releaseVersion || ''} ${e.phaseLabel || ''} ${e.title || ''} ${e.summary || ''}`.toLowerCase();
    return hay.includes(f_search);
  });

  renderCards(filtered);
  renderTable(filtered);
  renderSummary(filtered);
}

function renderSummary(filtered) {
  const total = sumEntries(filtered);
  const el = document.getElementById('devh-summary');
  if (el) el.textContent = `${filtered.length} entrada${filtered.length !== 1 ? 's' : ''} • ${fmtH(total.hours)} • ${fmtBR.format(total.cost)}`;
}

function renderCards(filtered) {
  const total = sumEntries(filtered);
  // Para cards "Em rascunho" e "Aprovadas" mostramos count GLOBAL (não filtrado)
  const draftCount    = _allEntries.filter(e => e.status === 'draft').length;
  const approvedCount = _allEntries.filter(e => e.status === 'approved').length;

  const card = (title, value, sub, color, icon) => `
    <div class="stat-card" style="background:var(--bg-card);border:1px solid var(--border);
         border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:6px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;">${title}</span>
        <span style="font-size:1.25rem;color:${color};">${icon}</span>
      </div>
      <div style="font-size:1.75rem;font-weight:700;color:var(--text-primary);">${value}</div>
      <div style="font-size:0.75rem;color:var(--text-muted);">${sub}</div>
    </div>
  `;

  document.getElementById('devh-cards').innerHTML = [
    card('Horas trabalhadas', fmtH(total.hours), 'no período filtrado', 'var(--brand-gold)', '⏱'),
    card('Custo de desenvolvimento', fmtBR.format(total.cost), `@ R$ ${DEFAULT_HOURLY_RATE}/h`, '#10B981', '💰'),
    card('Entradas em rascunho', draftCount, 'aguardando sua aprovação', '#6B7280', '✎'),
    card('Entradas aprovadas', approvedCount, 'no histórico total', '#10B981', '✓'),
  ].join('');
}

function renderTable(filtered) {
  const tbody = document.getElementById('devh-tbody');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:32px;text-align:center;color:var(--text-muted);">
      Nenhuma entrada encontrada com os filtros atuais.
    </td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(e => {
    const status = STATUS_MAP[e.status] || STATUS_MAP.draft;
    const isPhase = e.entryType === 'phase';
    const versionCell = isPhase
      ? `<strong>${esc(e.phaseLabel || 'Fase sem nome')}</strong>
         <div style="font-size:0.7rem;color:var(--text-muted);">${e.phaseCommitsCount || 0} commits agregados</div>`
      : `<strong>${esc(e.releaseVersion || '—')}</strong>
         ${e.releaseSlug ? `<span style="color:var(--text-muted);"> · ${esc(e.releaseSlug)}</span>` : ''}
         ${e.title ? `<div style="font-size:0.75rem;color:var(--text-secondary);margin-top:2px;">${esc(e.title)}</div>` : ''}`;

    // Mini-barras de categoria
    const hbc = e.hoursByCategory || {};
    const totalH = Object.values(hbc).reduce((a, b) => a + (+b || 0), 0);
    const catBars = CATEGORIES.map(c => {
      const v = +(hbc[c.value] || 0);
      const pct = totalH > 0 ? (v / totalH * 100) : 0;
      return `<div title="${c.label}: ${v.toFixed(2)}h (${pct.toFixed(0)}%)"
        style="width:14px;height:${Math.max(2, pct/4)}px;background:${c.color};border-radius:2px 2px 0 0;
               opacity:${pct > 0 ? 1 : 0.15};"></div>`;
    }).join('');

    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:10px 12px;font-size:0.75rem;color:var(--text-muted);">${fmtDate(e.completedAt)}</td>
      <td style="padding:10px 12px;">
        <span style="font-size:0.7rem;padding:2px 6px;border-radius:4px;
                     background:${isPhase ? 'rgba(139,92,246,.12)' : 'rgba(56,189,248,.12)'};
                     color:${isPhase ? '#8B5CF6' : '#38BDF8'};">
          ${isPhase ? '📜 Fase' : '🚀 Release'}
        </span>
      </td>
      <td style="padding:10px 12px;">${versionCell}</td>
      <td style="padding:10px 12px;">
        <div style="display:flex;align-items:flex-end;gap:2px;height:30px;">${catBars}</div>
      </td>
      <td style="padding:10px 12px;text-align:right;font-weight:600;">${fmtH(e.totalHours)}</td>
      <td style="padding:10px 12px;text-align:right;color:#10B981;font-weight:600;">${fmtBR.format(e.totalCost || 0)}</td>
      <td style="padding:10px 12px;">
        <span style="font-size:0.7rem;padding:2px 8px;border-radius:99px;
                     background:${status.color}20;color:${status.color};">
          ${status.icon} ${status.label}
        </span>
      </td>
      <td style="padding:10px 12px;">
        <button class="btn btn-ghost btn-sm devh-explain" data-id="${e.id}" title="Como cheguei">ⓘ</button>
        <button class="btn btn-ghost btn-sm devh-edit" data-id="${e.id}" title="Editar">✎</button>
        ${e.status === 'draft' ? `<button class="btn btn-ghost btn-sm devh-approve" data-id="${e.id}" title="Aprovar"
          style="color:#10B981;">✓</button>` : ''}
        ${e.status === 'approved' ? `<button class="btn btn-ghost btn-sm devh-reopen" data-id="${e.id}" title="Reabrir"
          style="color:#F59E0B;">↺</button>` : ''}
        <button class="btn btn-ghost btn-sm devh-delete" data-id="${e.id}" title="Excluir"
          style="color:var(--color-danger);">✕</button>
      </td>
    </tr>`;
  }).join('');

  // Wire actions
  tbody.querySelectorAll('.devh-explain').forEach(b => b.addEventListener('click', () => openExplainModal(b.dataset.id)));
  tbody.querySelectorAll('.devh-edit').forEach(b => b.addEventListener('click', () => openEditModal(b.dataset.id)));
  tbody.querySelectorAll('.devh-approve').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Aprovar esta entrada?')) return;
    await approveEntry(b.dataset.id);
    toast.success('Aprovada.');
  }));
  tbody.querySelectorAll('.devh-reopen').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Reabrir como rascunho?')) return;
    await reopenEntry(b.dataset.id);
    toast.info('Reaberta.');
  }));
  tbody.querySelectorAll('.devh-delete').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Excluir permanentemente?')) return;
    await deleteEntry(b.dataset.id);
    toast.success('Excluída.');
  }));
}

/* ─────────────────────────────────────────────────────────────────── */
function openExplainModal(id) {
  const e = _allEntries.find(x => x.id === id);
  if (!e) return;
  const exp = explainEntry(e);
  const root = document.getElementById('devh-modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,.5);
         display:flex;align-items:center;justify-content:center;z-index:1000;">
      <div class="card" style="max-width:600px;width:92%;max-height:85vh;overflow:auto;">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
          <div class="card-title">ⓘ Como cheguei nessa estimativa</div>
          <button class="btn btn-ghost btn-sm" id="devh-explain-close">✕</button>
        </div>
        <div class="card-body">
          <h4 style="margin:0 0 6px 0;">${esc(e.releaseVersion || e.phaseLabel || '—')}</h4>
          <div style="color:var(--text-muted);font-size:0.875rem;margin-bottom:16px;">${esc(e.title || e.summary || '')}</div>

          <table style="width:100%;font-size:0.875rem;">
            <tr><td style="padding:4px 0;color:var(--text-muted);">Bucket inicial</td>
                <td style="padding:4px 0;text-align:right;"><strong>${exp.bucketLabel}</strong> (${exp.bucketRange})</td></tr>
            <tr><td style="padding:4px 0;color:var(--text-muted);">Ponto base</td>
                <td style="padding:4px 0;text-align:right;">${exp.basePoint.toFixed(2)}h</td></tr>
            <tr><td style="padding:4px 0;color:var(--text-muted);">Razão do bucket</td>
                <td style="padding:4px 0;text-align:right;font-style:italic;color:var(--text-secondary);">${esc(exp.bucketReason)}</td></tr>
          </table>

          ${exp.multipliers.length ? `
            <h5 style="margin:16px 0 6px 0;font-size:0.875rem;">Multiplicadores aplicados:</h5>
            <ul style="font-size:0.875rem;padding-left:20px;">
              ${exp.multipliers.map(m => `<li><strong>${m.pctLabel}</strong> ${esc(m.label)}</li>`).join('')}
            </ul>
            <div style="font-size:0.875rem;color:var(--text-muted);margin-top:6px;">
              Fator total: ×${exp.factor.toFixed(2)}
            </div>
          ` : '<div style="font-size:0.8125rem;color:var(--text-muted);margin-top:8px;">Nenhum multiplicador aplicado.</div>'}

          <h5 style="margin:16px 0 6px 0;font-size:0.875rem;">Decomposição em categorias:</h5>
          <table style="width:100%;font-size:0.875rem;">
            ${CATEGORIES.map(c => {
              const v = +(exp.breakdown[c.value] || 0);
              const pct = exp.adjustedHours > 0 ? (v / exp.adjustedHours * 100) : 0;
              return `<tr>
                <td style="padding:3px 0;">
                  <span style="color:${c.color};">${c.icon} ${c.label}</span>
                </td>
                <td style="padding:3px 0;text-align:right;">${v.toFixed(2)}h</td>
                <td style="padding:3px 0;text-align:right;width:50px;color:var(--text-muted);">${pct.toFixed(0)}%</td>
              </tr>`;
            }).join('')}
            <tr style="border-top:1px solid var(--border);font-weight:600;">
              <td style="padding:6px 0;">Total</td>
              <td style="padding:6px 0;text-align:right;">${fmtH(exp.adjustedHours)}</td>
              <td style="padding:6px 0;text-align:right;color:var(--text-muted);">100%</td>
            </tr>
          </table>

          <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);
                      display:flex;justify-content:space-between;font-size:0.875rem;">
            <span>Confiança: <strong>${esc((exp.confidence||'').toUpperCase())}</strong></span>
            <span>Taxa horária: <strong>R$ ${exp.rate.toFixed(2)}</strong></span>
          </div>
          <div style="margin-top:8px;font-size:1.125rem;color:#10B981;font-weight:700;text-align:right;">
            Total: ${fmtBR.format(exp.cost)}
          </div>
          ${!exp.matches ? `<div style="margin-top:8px;font-size:0.75rem;color:#F59E0B;">
            ⚠ Horas armazenadas (${exp.storedHours.toFixed(2)}h) divergem do cálculo recalculado (${exp.adjustedHours.toFixed(2)}h).
            Pode ser ajuste manual posterior — ver "editar" pra detalhes.
          </div>` : ''}
        </div>
      </div>
    </div>
  `;
  document.getElementById('devh-explain-close').addEventListener('click', () => root.innerHTML = '');
  root.querySelector('.modal-backdrop').addEventListener('click', (ev) => {
    if (ev.target.classList.contains('modal-backdrop')) root.innerHTML = '';
  });
}

/* ─────────────────────────────────────────────────────────────────── */
function openEditModal(id) {
  const editing = id ? _allEntries.find(x => x.id === id) : null;
  const e = editing || {
    entryType: 'release', releaseVersion: '', releaseSlug: '', phaseLabel: '',
    title: '', summary: '',
    bucket: 'medium', basePoint: null, multipliers: [],
    profile: 'feature',
    hoursByCategory: { refinamento: 0, desenvolvimento: 0, testes: 0, documentacao: 0, implantacao: 0 },
    notes: '', confidenceLevel: 'medium',
    hourlyRate: DEFAULT_HOURLY_RATE,
    status: 'draft',
    completedAt: new Date(),
    phaseCommitsCount: null,
  };

  const root = document.getElementById('devh-modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,.5);
         display:flex;align-items:center;justify-content:center;z-index:1000;">
      <div class="card" style="max-width:720px;width:94%;max-height:90vh;overflow:auto;">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
          <div class="card-title">${editing ? '✎ Editar entrada' : '+ Nova entrada'}</div>
          <button class="btn btn-ghost btn-sm" id="devh-edit-close">✕</button>
        </div>
        <div class="card-body" id="devh-edit-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <label>Tipo
              <select class="form-input" id="ed-entryType">
                ${ENTRY_TYPES.map(t => `<option value="${t.value}" ${e.entryType===t.value?'selected':''}>${t.label}</option>`).join('')}
              </select>
            </label>
            <label>Data de conclusão
              <input type="date" class="form-input" id="ed-completedAt"
                value="${(() => { const d = e.completedAt?.toDate ? e.completedAt.toDate() : (e.completedAt instanceof Date ? e.completedAt : new Date(e.completedAt||Date.now())); return d.toISOString().slice(0,10); })()}">
            </label>
          </div>

          <div id="ed-release-fields" style="display:${e.entryType==='release'?'grid':'none'};grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
            <label>Versão
              <input type="text" class="form-input" id="ed-releaseVersion" value="${esc(e.releaseVersion||'')}" placeholder="3.8.0">
            </label>
            <label>Slug
              <input type="text" class="form-input" id="ed-releaseSlug" value="${esc(e.releaseSlug||'')}" placeholder="arquivamento-730d-toggle">
            </label>
          </div>

          <div id="ed-phase-fields" style="display:${e.entryType==='phase'?'grid':'none'};grid-template-columns:2fr 1fr;gap:12px;margin-top:12px;">
            <label>Fase
              <input type="text" class="form-input" id="ed-phaseLabel" value="${esc(e.phaseLabel||'')}" placeholder="Hardening de segurança (5 sprints)">
            </label>
            <label>Commits agregados
              <input type="number" class="form-input" id="ed-phaseCommitsCount" value="${e.phaseCommitsCount||''}" min="0">
            </label>
          </div>

          <label style="display:block;margin-top:12px;">Título
            <input type="text" class="form-input" id="ed-title" value="${esc(e.title||'')}" placeholder="Resumo curto da entrega">
          </label>

          <label style="display:block;margin-top:12px;">Resumo / Notas
            <textarea class="form-input" id="ed-summary" rows="3" placeholder="Razão do bucket, contexto, decisões importantes...">${esc(e.summary||e.notes||'')}</textarea>
          </label>

          <hr style="margin:20px 0;border:none;border-top:1px solid var(--border);">

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <label>Bucket
              <select class="form-input" id="ed-bucket">
                ${BUCKETS.map(b => `<option value="${b.value}" ${e.bucket===b.value?'selected':''}>${b.label} (${b.range})</option>`).join('')}
              </select>
            </label>
            <label>Confiança
              <select class="form-input" id="ed-confidence">
                <option value="high"   ${e.confidenceLevel==='high'?'selected':''}>Alta</option>
                <option value="medium" ${e.confidenceLevel==='medium'?'selected':''}>Média</option>
                <option value="low"    ${e.confidenceLevel==='low'?'selected':''}>Baixa</option>
              </select>
            </label>
          </div>

          <label style="display:block;margin-top:12px;">Multiplicadores
            <div id="ed-multipliers" style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;font-size:0.875rem;">
              ${DEFAULT_MULTIPLIERS.map(m => `
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:normal;">
                  <input type="checkbox" value="${m.id}" ${(e.multipliers||[]).includes(m.id)?'checked':''}>
                  <span>${esc(m.label)} (<strong>${m.value>=0?'+':''}${(m.value*100).toFixed(0)}%</strong>)</span>
                </label>`).join('')}
            </div>
          </label>

          <div style="display:flex;gap:12px;margin-top:12px;align-items:flex-end;">
            <label style="flex:1;">Total de horas (auto-calc)
              <input type="number" step="0.25" class="form-input" id="ed-totalHours" value="${e.totalHours||0}">
            </label>
            <label style="flex:1;">Taxa horária (R$)
              <input type="number" step="1" class="form-input" id="ed-hourlyRate" value="${e.hourlyRate||DEFAULT_HOURLY_RATE}">
            </label>
            <button class="btn btn-secondary" id="ed-recalc" type="button" title="Recalcular do bucket">↻ recalc</button>
          </div>

          <hr style="margin:20px 0;border:none;border-top:1px solid var(--border);">

          <h5 style="margin:0 0 8px 0;">Decomposição por categoria</h5>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
            <label style="margin:0;flex:1;">Perfil sugerido
              <select class="form-input" id="ed-profile">
                <option value="feature"  ${e.profile==='feature'?'selected':''}>Feature</option>
                <option value="bugfix"   ${e.profile==='bugfix'?'selected':''}>Bug fix</option>
                <option value="refactor" ${e.profile==='refactor'?'selected':''}>Refactor</option>
                <option value="docs"     ${e.profile==='docs'?'selected':''}>Documentação</option>
                <option value="phase"    ${e.profile==='phase'?'selected':''}>Fase agregada</option>
              </select>
            </label>
            <button class="btn btn-secondary" id="ed-suggest-cat" type="button">↻ Sugerir distribuição</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;">
            ${CATEGORIES.map(c => `
              <label style="margin:0;font-size:0.75rem;">
                <span style="color:${c.color};">${c.icon} ${c.label}</span>
                <input type="number" step="0.25" min="0" class="form-input" id="ed-cat-${c.value}"
                  value="${(e.hoursByCategory||{})[c.value] || 0}">
              </label>`).join('')}
          </div>
          <div id="ed-cat-warn" style="font-size:0.75rem;color:var(--text-muted);margin-top:6px;"></div>

          <div style="display:flex;gap:8px;margin-top:20px;justify-content:flex-end;">
            <button class="btn btn-ghost" id="ed-cancel">Cancelar</button>
            <button class="btn btn-primary" id="ed-save">${editing ? 'Salvar' : 'Criar rascunho'}</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Wire dynamic fields
  const tEl = document.getElementById('ed-entryType');
  tEl.addEventListener('change', () => {
    document.getElementById('ed-release-fields').style.display = (tEl.value === 'release' ? 'grid' : 'none');
    document.getElementById('ed-phase-fields').style.display   = (tEl.value === 'phase'   ? 'grid' : 'none');
  });

  const recalc = () => {
    const bucket = document.getElementById('ed-bucket').value;
    const mults = Array.from(document.querySelectorAll('#ed-multipliers input:checked')).map(i => i.value);
    const h = calcHoursFromBucket(bucket, mults);
    document.getElementById('ed-totalHours').value = h;
  };
  document.getElementById('ed-recalc').addEventListener('click', recalc);

  const suggestCat = () => {
    const total = parseFloat(document.getElementById('ed-totalHours').value) || 0;
    const profile = document.getElementById('ed-profile').value;
    const dist = suggestCategoryBreakdown(total, profile);
    for (const c of CATEGORIES) {
      const el = document.getElementById(`ed-cat-${c.value}`);
      if (el) el.value = dist[c.value] || 0;
    }
    validateCatSum();
  };
  document.getElementById('ed-suggest-cat').addEventListener('click', suggestCat);

  const validateCatSum = () => {
    let sum = 0;
    for (const c of CATEGORIES) sum += parseFloat(document.getElementById(`ed-cat-${c.value}`).value) || 0;
    const tot = parseFloat(document.getElementById('ed-totalHours').value) || 0;
    const diff = Math.abs(sum - tot);
    const warn = document.getElementById('ed-cat-warn');
    if (diff > 0.05) {
      warn.textContent = `⚠ Soma das categorias (${sum.toFixed(2)}h) ≠ total (${tot.toFixed(2)}h). Ajuste manual ou clique "Sugerir distribuição".`;
      warn.style.color = '#F59E0B';
    } else {
      warn.textContent = `✓ Soma das categorias = total.`;
      warn.style.color = '#10B981';
    }
  };
  document.querySelectorAll('#devh-edit-body input, #devh-edit-body select').forEach(el => {
    el.addEventListener('change', validateCatSum);
  });
  validateCatSum();

  document.getElementById('ed-cancel').addEventListener('click', () => root.innerHTML = '');
  document.getElementById('devh-edit-close').addEventListener('click', () => root.innerHTML = '');

  document.getElementById('ed-save').addEventListener('click', async () => {
    try {
      const entryType = document.getElementById('ed-entryType').value;
      const completedAtStr = document.getElementById('ed-completedAt').value;
      const completedAt = completedAtStr ? new Date(completedAtStr + 'T12:00:00') : new Date();
      const totalHours = parseFloat(document.getElementById('ed-totalHours').value) || 0;
      const hourlyRate = parseFloat(document.getElementById('ed-hourlyRate').value) || DEFAULT_HOURLY_RATE;
      const totalCost = calcCost(totalHours, hourlyRate);
      const mults = Array.from(document.querySelectorAll('#ed-multipliers input:checked')).map(i => i.value);

      const hoursByCategory = {};
      for (const c of CATEGORIES) {
        hoursByCategory[c.value] = parseFloat(document.getElementById(`ed-cat-${c.value}`).value) || 0;
      }

      const data = {
        entryType,
        releaseVersion: entryType === 'release' ? document.getElementById('ed-releaseVersion').value.trim() : null,
        releaseSlug:    entryType === 'release' ? document.getElementById('ed-releaseSlug').value.trim()    : null,
        phaseLabel:     entryType === 'phase'   ? document.getElementById('ed-phaseLabel').value.trim()     : null,
        phaseCommitsCount: entryType === 'phase' ? (parseInt(document.getElementById('ed-phaseCommitsCount').value) || 0) : null,
        title:   document.getElementById('ed-title').value.trim(),
        summary: document.getElementById('ed-summary').value.trim(),
        completedAt,
        bucket:           document.getElementById('ed-bucket').value,
        confidenceLevel:  document.getElementById('ed-confidence').value,
        profile:          document.getElementById('ed-profile').value,
        multipliers: mults,
        totalHours,
        hourlyRate,
        totalCost,
        hoursByCategory,
        notes: document.getElementById('ed-summary').value.trim(),
        status: editing ? editing.status : 'draft',
      };

      if (editing) {
        await updateEntry(editing.id, data);
        toast.success('Entrada atualizada.');
      } else {
        await createEntry(data);
        toast.success('Rascunho criado.');
      }
      root.innerHTML = '';
    } catch (err) {
      console.error('[devHours] save error:', err);
      toast.error('Erro ao salvar: ' + err.message);
    }
  });

  root.querySelector('.modal-backdrop').addEventListener('click', (ev) => {
    if (ev.target.classList.contains('modal-backdrop')) root.innerHTML = '';
  });
}
