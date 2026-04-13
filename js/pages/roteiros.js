/**
 * PRIMETOUR — Roteiros de Viagem: Lista / Gestão
 * List/grid page for travel itineraries
 */

import { store } from '../store.js';
import { toast } from '../components/toast.js';
const showToast = (msg, type = 'info') => toast[type]?.(msg) ?? toast.info(msg);
import { fetchRoteiros, deleteRoteiro, duplicateRoteiro, updateRoteiroStatus } from '../services/roteiros.js';

/* ─── Helpers ─────────────────────────────────────────────── */
const esc = s => s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '';

function timeAgo(date) {
  if (!date) return '';
  const d = date?.toDate ? date.toDate() : new Date(date);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}min atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d atrás`;
  return d.toLocaleDateString('pt-BR');
}

function fmtDateRange(travel) {
  if (!travel?.startDate && !travel?.endDate) return '';
  const fmt = d => {
    if (!d) return '—';
    const dt = d.toDate ? d.toDate() : new Date(d);
    return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  return `${fmt(travel.startDate)} — ${fmt(travel.endDate)}`;
}

function destinationsText(travel) {
  if (!travel?.destinations?.length) return '';
  return travel.destinations.map(d => d.city || d.country).join(', ');
}

function clientTypeLabel(type) {
  const map = { individual: 'Individual', couple: 'Casal', family: 'Família', group: 'Grupo' };
  return map[type] || 'Individual';
}

const STATUS_COLORS = {
  draft:    'var(--text-muted, #6B7280)',
  review:   'var(--brand-gold, #F59E0B)',
  sent:     'var(--brand-blue, #3B82F6)',
  approved: 'var(--brand-green, #22C55E)',
  archived: '#9CA3AF',
};

const STATUS_LABELS = {
  draft:    'Rascunho',
  review:   'Em revisão',
  sent:     'Enviado',
  approved: 'Aprovado',
  archived: 'Arquivado',
};

function statusBadge(status) {
  const color = STATUS_COLORS[status] || STATUS_COLORS.draft;
  const label = STATUS_LABELS[status] || status;
  return `<span class="badge" style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;
    border-radius:999px;font-size:0.75rem;font-weight:600;
    background:${color}18;color:${color};border:1px solid ${color}33;">
    ${esc(label)}
  </span>`;
}

/* ─── Render ──────────────────────────────────────────────── */
export async function renderRoteiros(container) {
  /* ── State ── */
  let allRoteiros = [];
  let activeStatus = '';
  let searchTerm = '';
  let selectedConsultant = '';

  /* ── Initial HTML ── */
  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:20px;">
      <div>
        <h1 style="font-size:1.5rem;font-weight:700;color:var(--text-primary);margin:0;">
          Roteiros de Viagem
        </h1>
        <p style="color:var(--text-muted);font-size:0.875rem;margin:4px 0 0;">
          Crie e gerencie roteiros personalizados para seus clientes
        </p>
      </div>
      <div class="page-actions">
        ${store.canCreateRoteiro() ? `
          <button class="btn btn-primary" data-action="new-roteiro" style="gap:6px;">
            + Novo Roteiro
          </button>
        ` : ''}
      </div>
    </div>

    <!-- Filters bar -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px;">
      <div class="rt-pills" style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="rt-pill active" data-status="">Todos</button>
        <button class="rt-pill" data-status="draft">Rascunho</button>
        <button class="rt-pill" data-status="review">Em revisão</button>
        <button class="rt-pill" data-status="sent">Enviado</button>
        <button class="rt-pill" data-status="approved">Aprovado</button>
        <button class="rt-pill" data-status="archived">Arquivado</button>
      </div>
      <div style="display:flex;gap:8px;margin-left:auto;flex-wrap:wrap;align-items:center;">
        <input type="text" id="rt-search" class="form-input" placeholder="Buscar cliente ou destino..."
          style="max-width:240px;height:34px;font-size:0.8125rem;" />
        <select id="rt-consultant" class="form-input" style="max-width:200px;height:34px;font-size:0.8125rem;display:none;">
          <option value="">Todos os consultores</option>
        </select>
      </div>
    </div>

    <!-- Cards grid -->
    <div id="rt-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">
      <div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">Carregando...</div>
    </div>

    <style>
      .rt-pill {
        padding:5px 14px;border-radius:999px;font-size:0.8125rem;font-weight:600;
        border:1px solid var(--border, #e5e7eb);background:transparent;color:var(--text-muted, #6B7280);
        cursor:pointer;transition:all 0.15s;
      }
      .rt-pill:hover { background:var(--bg-card, #fff); }
      .rt-pill.active {
        background:var(--brand-blue, #3B82F6);color:#fff;border-color:var(--brand-blue, #3B82F6);
      }
      .rt-card {
        background:var(--bg-card, #fff);border:1px solid var(--border, #e5e7eb);
        border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:12px;
        transition:all 0.15s;
      }
      .rt-card:hover {
        border-color:var(--brand-blue, #3B82F6);
        box-shadow:0 2px 8px rgba(0,0,0,0.08);
        transform:translateY(-1px);
      }
      .rt-card-title {
        font-weight:700;font-size:0.9375rem;color:var(--text-primary);
        margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      }
      .rt-card-meta {
        font-size:0.8125rem;color:var(--text-muted);display:flex;flex-direction:column;gap:4px;
      }
      .rt-card-actions {
        display:flex;gap:6px;flex-wrap:wrap;margin-top:auto;padding-top:8px;
        border-top:1px solid var(--border, #e5e7eb);
      }
      .rt-card-actions button {
        padding:4px 10px;border-radius:6px;font-size:0.75rem;font-weight:600;
        border:1px solid var(--border, #e5e7eb);background:transparent;
        color:var(--text-muted);cursor:pointer;transition:all 0.15s;
      }
      .rt-card-actions button:hover { background:var(--bg-card);color:var(--text-primary); }
      .rt-card-actions button.danger { color:#EF4444; }
      .rt-card-actions button.danger:hover { background:rgba(239,68,68,0.1);border-color:#EF444433; }
      .rt-client-badge {
        display:inline-block;padding:1px 8px;border-radius:999px;font-size:0.6875rem;font-weight:600;
        background:var(--brand-blue, #3B82F6)15;color:var(--brand-blue, #3B82F6);
        border:1px solid var(--brand-blue, #3B82F6)25;
      }
      @media (max-width: 1024px) {
        #rt-grid { grid-template-columns: repeat(2, 1fr) !important; }
      }
      @media (max-width: 640px) {
        #rt-grid { grid-template-columns: 1fr !important; }
      }
    </style>
  `;

  /* ── Load data ── */
  async function loadData() {
    try {
      allRoteiros = await fetchRoteiros();
      populateConsultantFilter();
      renderGrid();
    } catch (err) {
      const grid = document.getElementById('rt-grid');
      if (grid) grid.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">
          Erro ao carregar roteiros: ${esc(err.message)}
        </div>`;
    }
  }

  function populateConsultantFilter() {
    const select = document.getElementById('rt-consultant');
    if (!select) return;
    if (!store.canManageRoteiros()) { select.style.display = 'none'; return; }

    const consultants = [...new Map(
      allRoteiros
        .filter(r => r.consultantId && r.consultantName)
        .map(r => [r.consultantId, r.consultantName])
    ).entries()];

    if (consultants.length > 0) {
      select.style.display = '';
      select.innerHTML = `<option value="">Todos os consultores</option>` +
        consultants.map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
    }
  }

  function getFiltered() {
    let filtered = allRoteiros;

    if (activeStatus) {
      filtered = filtered.filter(r => r.status === activeStatus);
    }
    if (selectedConsultant) {
      filtered = filtered.filter(r => r.consultantId === selectedConsultant);
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(r =>
        (r.client?.name || '').toLowerCase().includes(term) ||
        destinationsText(r.travel).toLowerCase().includes(term) ||
        (r.title || '').toLowerCase().includes(term)
      );
    }
    return filtered;
  }

  function renderGrid() {
    const grid = document.getElementById('rt-grid');
    if (!grid) return;

    const filtered = getFiltered();

    if (!filtered.length) {
      grid.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:60px 20px;">
          <div style="font-size:3rem;opacity:0.3;margin-bottom:12px;">✈</div>
          <p style="color:var(--text-muted);font-size:0.9375rem;">
            ${allRoteiros.length
              ? 'Nenhum roteiro encontrado com esses filtros.'
              : 'Nenhum roteiro encontrado. Crie seu primeiro roteiro!'}
          </p>
          ${!allRoteiros.length && store.canCreateRoteiro() ? `
            <button class="btn btn-primary" data-action="new-roteiro" style="margin-top:16px;">+ Criar primeiro roteiro</button>
          ` : ''}
        </div>`;
      return;
    }

    grid.innerHTML = filtered.map(r => {
      const clientName = r.client?.name || 'Sem cliente';
      const clientType = r.client?.type || 'individual';
      const dests = destinationsText(r.travel);
      const dateRange = fmtDateRange(r.travel);
      const isArchived = r.status === 'archived';

      return `
        <div class="rt-card" data-id="${esc(r.id)}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
            <h3 class="rt-card-title">${esc(r.title || 'Sem título')}</h3>
            ${statusBadge(r.status)}
          </div>

          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:0.875rem;color:var(--text-primary);font-weight:500;">
              ${esc(clientName)}
            </span>
            <span class="rt-client-badge">${esc(clientTypeLabel(clientType))}</span>
          </div>

          <div class="rt-card-meta">
            ${dests ? `<span>📍 ${esc(dests)}</span>` : ''}
            ${dateRange ? `<span>📅 ${esc(dateRange)}</span>` : ''}
            <span>👤 ${esc(r.consultantName || '—')}</span>
            <span style="font-size:0.75rem;">Atualizado ${timeAgo(r.updatedAt)}</span>
          </div>

          <div class="rt-card-actions">
            <button data-action="edit" data-id="${esc(r.id)}">Editar</button>
            <button data-action="duplicate" data-id="${esc(r.id)}">Duplicar</button>
            <button data-action="export-pdf" data-id="${esc(r.id)}">Exportar PDF</button>
            <button data-action="${isArchived ? 'restore' : 'archive'}" data-id="${esc(r.id)}">
              ${isArchived ? 'Restaurar' : 'Arquivar'}
            </button>
            <button data-action="delete" data-id="${esc(r.id)}" class="danger">Excluir</button>
          </div>
        </div>`;
    }).join('');
  }

  /* ── Event delegation ── */
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (action === 'new-roteiro') {
      location.hash = '#roteiro-editor';
      return;
    }

    if (action === 'edit') {
      location.hash = `#roteiro-editor?id=${id}`;
      return;
    }

    if (action === 'duplicate') {
      try {
        await duplicateRoteiro(id);
        showToast('Roteiro duplicado com sucesso!', 'success');
        await loadData();
      } catch (err) {
        showToast('Erro ao duplicar roteiro: ' + err.message, 'error');
      }
      return;
    }

    if (action === 'export-pdf') {
      location.hash = `#roteiro-editor?id=${id}&export=pdf`;
      return;
    }

    if (action === 'archive') {
      try {
        await updateRoteiroStatus(id, 'archived');
        showToast('Roteiro arquivado.', 'success');
        await loadData();
      } catch (err) {
        showToast('Erro ao arquivar: ' + err.message, 'error');
      }
      return;
    }

    if (action === 'restore') {
      try {
        await updateRoteiroStatus(id, 'draft');
        showToast('Roteiro restaurado.', 'success');
        await loadData();
      } catch (err) {
        showToast('Erro ao restaurar: ' + err.message, 'error');
      }
      return;
    }

    if (action === 'delete') {
      if (!confirm('Tem certeza que deseja excluir este roteiro? Esta ação não pode ser desfeita.')) return;
      try {
        await deleteRoteiro(id);
        showToast('Roteiro excluído.', 'success');
        await loadData();
      } catch (err) {
        showToast('Erro ao excluir: ' + err.message, 'error');
      }
      return;
    }
  });

  /* ── Status pills ── */
  container.addEventListener('click', (e) => {
    const pill = e.target.closest('.rt-pill');
    if (!pill) return;
    container.querySelectorAll('.rt-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    activeStatus = pill.dataset.status;
    renderGrid();
  });

  /* ── Search ── */
  const searchInput = document.getElementById('rt-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchTerm = e.target.value;
      renderGrid();
    });
  }

  /* ── Consultant filter ── */
  const consultantSelect = document.getElementById('rt-consultant');
  if (consultantSelect) {
    consultantSelect.addEventListener('change', (e) => {
      selectedConsultant = e.target.value;
      renderGrid();
    });
  }

  /* ── Init ── */
  await loadData();
}
