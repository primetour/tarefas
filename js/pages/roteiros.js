/**
 * PRIMETOUR — Roteiros de Viagem: Lista / Gestão
 */

import { store }  from '../store.js';
import { router } from '../router.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import {
  fetchRoteiros, deleteRoteiro, updateRoteiroStatus,
  duplicateRoteiro, ROTEIRO_STATUSES,
} from '../services/roteiros.js';

/* ─── Helpers ─────────────────────────────────────────────── */
const esc = s => (s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function fmtDate(d) {
  if (!d) return '—';
  const dt = d.toDate ? d.toDate() : new Date(d);
  return dt.toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' });
}

function statusBadge(status) {
  const s = ROTEIRO_STATUSES.find(x => x.key === status) || ROTEIRO_STATUSES[0];
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;
    border-radius:var(--radius-full);font-size:0.75rem;font-weight:600;
    background:${s.color}18;color:${s.color};border:1px solid ${s.color}33;">
    ${s.label}
  </span>`;
}

function destinationsText(travel) {
  if (!travel?.destinations?.length) return '—';
  return travel.destinations.map(d => d.city || d.country).join(' → ');
}

/* ─── Render ──────────────────────────────────────────────── */
export async function renderRoteiros(container) {
  if (!store.canAccessRoteiros()) {
    container.innerHTML = `<div class="empty-state"><p>Sem permissão para acessar roteiros.</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:20px;">
      <div>
        <h1 style="font-size:1.5rem;font-weight:700;color:var(--text-primary);margin:0;">
          ✈ Roteiros de Viagem
        </h1>
        <p style="color:var(--text-muted);font-size:0.875rem;margin:4px 0 0;">
          Crie roteiros personalizados e exporte em PDF, PPT ou link web.
        </p>
      </div>
      ${store.canCreateRoteiro() ? `
        <button id="rt-new" class="btn btn-primary" style="gap:6px;">
          + Novo Roteiro
        </button>
      ` : ''}
    </div>

    <!-- Filtros -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
      <button class="rt-status-filter active" data-status="">Todos</button>
      ${ROTEIRO_STATUSES.map(s => `
        <button class="rt-status-filter" data-status="${s.key}"
          style="--filter-color:${s.color};">${s.label}</button>
      `).join('')}
      <input type="text" id="rt-search" class="form-input" placeholder="Buscar cliente ou destino..."
        style="margin-left:auto;max-width:260px;height:34px;font-size:0.8125rem;" />
    </div>

    <!-- Lista -->
    <div id="rt-list" style="display:flex;flex-direction:column;gap:10px;">
      <div style="text-align:center;padding:40px;color:var(--text-muted);">Carregando...</div>
    </div>
  `;

  // Estilos dos filtros
  const style = document.createElement('style');
  style.textContent = `
    .rt-status-filter {
      padding:5px 14px;border-radius:var(--radius-full);font-size:0.8125rem;font-weight:600;
      border:1px solid var(--border-subtle);background:transparent;color:var(--text-secondary);
      cursor:pointer;transition:all 0.15s;
    }
    .rt-status-filter:hover { background:var(--bg-surface); }
    .rt-status-filter.active {
      background:var(--brand-gold);color:#000;border-color:var(--brand-gold);
    }
    .rt-card {
      background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);
      padding:16px 20px;display:flex;align-items:center;gap:16px;transition:all 0.15s;cursor:pointer;
    }
    .rt-card:hover { border-color:var(--brand-gold);transform:translateY(-1px);box-shadow:var(--shadow-sm); }
    .rt-card-actions { display:flex;gap:6px;margin-left:auto;flex-shrink:0; }
    .rt-card-actions button {
      padding:4px 10px;border-radius:var(--radius-md);font-size:0.75rem;font-weight:600;
      border:1px solid var(--border-subtle);background:transparent;color:var(--text-secondary);
      cursor:pointer;transition:all 0.15s;
    }
    .rt-card-actions button:hover { background:var(--bg-surface);color:var(--text-primary); }
    .rt-card-actions button.danger:hover { background:rgba(239,68,68,0.1);color:#EF4444;border-color:#EF444433; }
  `;
  container.appendChild(style);

  // State
  let allRoteiros = [];
  let activeFilter = '';
  let searchTerm = '';

  async function loadData() {
    try {
      allRoteiros = await fetchRoteiros();
      renderList();
    } catch (err) {
      document.getElementById('rt-list').innerHTML = `
        <div class="empty-state"><p>Erro ao carregar roteiros: ${esc(err.message)}</p></div>`;
    }
  }

  function renderList() {
    const list = document.getElementById('rt-list');
    if (!list) return;

    let filtered = allRoteiros;
    if (activeFilter) filtered = filtered.filter(r => r.status === activeFilter);
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(r =>
        (r.title||'').toLowerCase().includes(term) ||
        (r.client?.name||'').toLowerCase().includes(term) ||
        destinationsText(r.travel).toLowerCase().includes(term) ||
        (r.consultantName||'').toLowerCase().includes(term)
      );
    }

    if (!filtered.length) {
      list.innerHTML = `
        <div style="text-align:center;padding:60px 20px;">
          <div style="font-size:3rem;opacity:0.3;margin-bottom:12px;">✈</div>
          <p style="color:var(--text-muted);font-size:0.9375rem;">
            ${allRoteiros.length ? 'Nenhum roteiro encontrado com esses filtros.' : 'Nenhum roteiro criado ainda.'}
          </p>
          ${!allRoteiros.length && store.canCreateRoteiro() ? `
            <button id="rt-new-empty" class="btn btn-primary" style="margin-top:16px;">+ Criar primeiro roteiro</button>
          ` : ''}
        </div>`;
      document.getElementById('rt-new-empty')?.addEventListener('click', () => router.navigate('roteiro-editor'));
      return;
    }

    list.innerHTML = filtered.map(r => {
      const dests = destinationsText(r.travel);
      const nights = r.travel?.nights || r.days?.length || 0;
      const clientName = r.client?.name || 'Sem cliente';
      const clientType = r.client?.type || '';
      const typeLabel = clientType === 'couple' ? 'Casal' : clientType === 'family' ? 'Família' : clientType === 'group' ? 'Grupo' : 'Individual';

      return `
        <div class="rt-card" data-id="${r.id}">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">
              <span style="font-weight:700;color:var(--text-primary);font-size:0.9375rem;">
                ${esc(r.title || 'Sem título')}
              </span>
              ${statusBadge(r.status)}
              ${nights ? `<span style="font-size:0.75rem;color:var(--text-muted);background:var(--bg-surface);padding:2px 8px;border-radius:var(--radius-full);">${nights} noites</span>` : ''}
            </div>
            <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:0.8125rem;color:var(--text-secondary);">
              <span>👤 ${esc(clientName)} <span style="color:var(--text-muted);">(${typeLabel})</span></span>
              ${dests !== '—' ? `<span>📍 ${esc(dests)}</span>` : ''}
              <span style="color:var(--text-muted);">Consultor: ${esc(r.consultantName || '—')}</span>
              <span style="color:var(--text-muted);">${fmtDate(r.updatedAt)}</span>
            </div>
          </div>
          <div class="rt-card-actions" onclick="event.stopPropagation();">
            <button data-action="duplicate" data-id="${r.id}" title="Duplicar">◈ Duplicar</button>
            <button data-action="status" data-id="${r.id}" title="Alterar status">↻ Status</button>
            ${store.canManageRoteiros() || r.consultantId === store.get('currentUser')?.uid ? `
              <button data-action="delete" data-id="${r.id}" class="danger" title="Excluir">✕</button>
            ` : ''}
          </div>
        </div>`;
    }).join('');

    // Card click → edit
    list.querySelectorAll('.rt-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        router.navigate(`roteiro-editor?id=${id}`);
      });
    });

    // Action buttons
    list.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { action, id } = btn.dataset;
        if (action === 'duplicate') {
          try {
            const newId = await duplicateRoteiro(id);
            toast.success('Roteiro duplicado!');
            router.navigate(`roteiro-editor?id=${newId}`);
          } catch (e) { toast.error('Erro ao duplicar: ' + e.message); }
        }
        if (action === 'status') {
          openStatusModal(id);
        }
        if (action === 'delete') {
          openDeleteConfirm(id);
        }
      });
    });
  }

  function openStatusModal(id) {
    const roteiro = allRoteiros.find(r => r.id === id);
    if (!roteiro) return;

    modal.open({
      title: 'Alterar Status',
      size: 'sm',
      content: `
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${ROTEIRO_STATUSES.map(s => `
            <button class="rt-status-btn" data-status="${s.key}"
              style="padding:10px 16px;border-radius:var(--radius-md);border:1px solid ${s.color}33;
              background:${roteiro.status === s.key ? s.color+'22' : 'transparent'};
              color:${s.color};font-weight:600;font-size:0.875rem;cursor:pointer;
              text-align:left;transition:all 0.15s;">
              ${roteiro.status === s.key ? '● ' : '○ '}${s.label}
            </button>
          `).join('')}
        </div>
      `,
      footer: [{ label: 'Cancelar', class: 'btn-secondary' }],
      onOpen: () => {
        document.querySelectorAll('.rt-status-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            try {
              await updateRoteiroStatus(id, btn.dataset.status);
              toast.success('Status atualizado!');
              modal.close();
              loadData();
            } catch (e) { toast.error('Erro: ' + e.message); }
          });
        });
      },
    });
  }

  function openDeleteConfirm(id) {
    modal.open({
      title: 'Excluir Roteiro',
      size: 'sm',
      content: `<p style="color:var(--text-secondary);">Tem certeza que deseja excluir este roteiro? Esta ação não pode ser desfeita.</p>`,
      footer: [
        { label: 'Cancelar', class: 'btn-secondary' },
        { label: 'Excluir', class: 'btn-primary', style: 'background:#EF4444;border-color:#EF4444;', onClick: async (e, { close }) => {
          try {
            await deleteRoteiro(id);
            toast.success('Roteiro excluído.');
            close();
            loadData();
          } catch (err) { toast.error('Erro: ' + err.message); }
        }},
      ],
    });
  }

  // Events
  document.getElementById('rt-new')?.addEventListener('click', () => router.navigate('roteiro-editor'));

  document.querySelectorAll('.rt-status-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rt-status-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.status;
      renderList();
    });
  });

  document.getElementById('rt-search')?.addEventListener('input', (e) => {
    searchTerm = e.target.value;
    renderList();
  });

  loadData();
}
