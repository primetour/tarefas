/**
 * PRIMETOUR — Roteiros de Viagem: Lista / Gestão
 * List/grid page for travel itineraries
 */

import { store } from '../store.js';
import { toast } from '../components/toast.js';
const showToast = (msg, type = 'info') => toast[type]?.(msg) ?? toast.info(msg);
import { fetchRoteiros, deleteRoteiro, duplicateRoteiro, updateRoteiroStatus, generateRoteiroFromPrompt } from '../services/roteiros.js';
import { createDoc, loadJsPdf, COL, txt, withExportGuard } from '../components/pdfKit.js';

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
      <div class="page-actions" style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-secondary" data-action="export-xls" style="gap:6px;"
          title="Exportar lista de roteiros em XLSX">
          XLS
        </button>
        <button class="btn btn-secondary" data-action="export-pdf-list" style="gap:6px;"
          title="Exportar lista de roteiros em PDF">
          PDF
        </button>
        ${store.canCreateRoteiro() ? `
          <button class="btn btn-secondary" data-action="ai-create" style="gap:6px;"
            title="Criar roteiro completo via IA a partir de uma descrição em texto livre">
            ◈ Criar com IA
          </button>
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

    if (action === 'ai-create') {
      openAiCreateModal(container);
      return;
    }

    if (action === 'export-xls') {
      await exportRoteirosXls(getFiltered());
      return;
    }

    if (action === 'export-pdf-list') {
      await exportRoteirosPdf(getFiltered());
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

/* ════════════════════════════════════════════════════════════
   Modal: Criar Roteiro com IA
   ════════════════════════════════════════════════════════════ */

function openAiCreateModal(container) {
  // Remove modal anterior se existir
  document.getElementById('ai-roteiro-modal-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ai-roteiro-modal-overlay';
  overlay.style.cssText = `
    position:fixed;top:0;left:0;right:0;bottom:0;z-index:9000;
    background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;
    animation:fadeIn .2s ease;
  `;

  overlay.innerHTML = `
    <div id="ai-roteiro-modal" style="
      background:var(--bg-surface,#1a1a2e);border-radius:16px;width:95%;max-width:680px;
      max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.4);
      border:1px solid var(--border-subtle,#333);padding:32px;">

      <!-- Header -->
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
        <div style="width:44px;height:44px;border-radius:12px;
          background:linear-gradient(135deg,#D4A843,#B8922F);
          display:flex;align-items:center;justify-content:center;font-size:1.25rem;">
          ◈
        </div>
        <div style="flex:1;">
          <h2 style="margin:0;font-size:1.25rem;font-weight:700;color:var(--text-primary);">
            Criar Roteiro com IA
          </h2>
          <p style="margin:2px 0 0;font-size:0.8125rem;color:var(--text-muted);">
            Descreva a viagem e a IA gera o roteiro completo para você
          </p>
        </div>
        <button id="ai-roteiro-close" style="background:none;border:none;cursor:pointer;
          color:var(--text-muted);font-size:1.5rem;padding:4px 8px;border-radius:8px;
          transition:all .15s;" onmouseover="this.style.color='var(--text-primary)'"
          onmouseout="this.style.color='var(--text-muted)'">&times;</button>
      </div>

      <!-- Prompt -->
      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:0.75rem;font-weight:600;color:var(--text-muted);
          text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">
          Descreva o roteiro desejado
        </label>
        <textarea id="ai-roteiro-prompt" rows="7"
          style="width:100%;padding:14px;border-radius:10px;font-size:0.9375rem;
          font-family:inherit;resize:vertical;line-height:1.6;
          background:var(--bg-input,var(--bg-dark,#0C1926));
          border:1px solid var(--border-subtle,#333);
          color:var(--text-primary);box-sizing:border-box;"
          placeholder="Exemplo: Roteiro de 12 dias pela Itália para um casal em lua de mel, perfil luxury. Começando por Roma (3 noites), depois Toscana (3 noites), Costa Amalfitana (3 noites) e finalizando em Veneza (2 noites). Interesse em gastronomia, cultura e vinícolas. Partindo em 15 de junho de 2026."></textarea>
      </div>

      <!-- Dicas -->
      <div style="background:var(--bg-dark,#0C1926);border-radius:10px;padding:14px 16px;
        margin-bottom:20px;font-size:0.8125rem;color:var(--text-muted);line-height:1.6;">
        <strong style="color:var(--text-secondary);">Dicas para um bom resultado:</strong>
        <ul style="margin:8px 0 0;padding-left:18px;">
          <li>Informe destinos, quantidade de noites em cada um</li>
          <li>Tipo de viajante: casal, família, grupo, individual</li>
          <li>Perfil econômico: standard, premium ou luxury</li>
          <li>Interesses: gastronomia, cultura, aventura, natureza...</li>
          <li>Datas de viagem (ou deixe em branco para sugestão automática)</li>
          <li>Restrições: mobilidade, alimentação, etc.</li>
        </ul>
      </div>

      <!-- Disclaimer -->
      <div style="background:#FEF3C720;border:1px solid #F59E0B33;border-radius:8px;
        padding:10px 14px;margin-bottom:20px;font-size:0.75rem;color:#F59E0B;line-height:1.5;">
        ◈ <strong>Conteúdo gerado por IA</strong> — O roteiro será criado como rascunho para sua revisão.
        Verifique nomes de hotéis, preços e informações antes de enviar ao cliente.
      </div>

      <!-- Ações -->
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="ai-roteiro-cancel"
          style="padding:10px 24px;border-radius:8px;border:1px solid var(--border-subtle,#333);
          background:transparent;color:var(--text-secondary);font-size:0.875rem;
          cursor:pointer;font-family:inherit;">
          Cancelar
        </button>
        <button id="ai-roteiro-generate"
          style="padding:10px 28px;border-radius:8px;border:none;cursor:pointer;
          background:linear-gradient(135deg,#D4A843,#B8922F);color:#0C1926;
          font-weight:700;font-size:0.875rem;font-family:inherit;
          display:flex;align-items:center;gap:8px;">
          ◈ Gerar Roteiro
        </button>
      </div>

      <!-- Progress (hidden initially) -->
      <div id="ai-roteiro-progress" style="display:none;margin-top:20px;text-align:center;">
        <div style="margin-bottom:12px;">
          <div style="width:40px;height:40px;border:3px solid var(--border-subtle);
            border-top-color:var(--brand-gold,#D4A843);border-radius:50%;
            animation:spin 1s linear infinite;margin:0 auto;"></div>
        </div>
        <p id="ai-roteiro-progress-text" style="font-size:0.875rem;color:var(--text-muted);">
          Gerando roteiro... Isso pode levar até 30 segundos.
        </p>
      </div>
    </div>

    <style>
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  `;

  document.body.appendChild(overlay);

  // Focus no textarea
  setTimeout(() => document.getElementById('ai-roteiro-prompt')?.focus(), 100);

  // Fechar modal
  const closeModal = () => overlay.remove();
  document.getElementById('ai-roteiro-close').addEventListener('click', closeModal);
  document.getElementById('ai-roteiro-cancel').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  // Esc para fechar
  const escHandler = (e) => { if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);

  // Gerar roteiro
  document.getElementById('ai-roteiro-generate').addEventListener('click', async () => {
    const prompt = document.getElementById('ai-roteiro-prompt')?.value?.trim();
    if (!prompt) {
      toast.error('Digite uma descrição para o roteiro.');
      return;
    }
    if (prompt.length < 20) {
      toast.error('Descrição muito curta. Forneça mais detalhes sobre a viagem.');
      return;
    }

    const btn = document.getElementById('ai-roteiro-generate');
    const progress = document.getElementById('ai-roteiro-progress');
    const progressText = document.getElementById('ai-roteiro-progress-text');

    btn.disabled = true;
    btn.style.opacity = '0.5';
    btn.textContent = 'Gerando...';
    progress.style.display = 'block';

    // Mensagens de progresso
    const messages = [
      'Analisando destinos e preferências...',
      'Montando dia a dia do roteiro...',
      'Selecionando hotéis e restaurantes...',
      'Criando narrativas de cada dia...',
      'Finalizando detalhes e informações...',
    ];
    let msgIdx = 0;
    const msgTimer = setInterval(() => {
      msgIdx = Math.min(msgIdx + 1, messages.length - 1);
      if (progressText) progressText.textContent = messages[msgIdx];
    }, 5000);

    try {
      const roteiro = await generateRoteiroFromPrompt(prompt);

      clearInterval(msgTimer);

      // Salvar no sessionStorage para o editor carregar
      sessionStorage.setItem('ai_roteiro_data', JSON.stringify(roteiro));
      sessionStorage.setItem('ai_roteiro_ts', Date.now().toString());

      closeModal();
      toast.success('Roteiro gerado! Abrindo editor para revisão...');

      // Navegar para o editor com flag de IA
      location.hash = '#roteiro-editor?ai=1';
    } catch (e) {
      clearInterval(msgTimer);
      console.error('Erro ao gerar roteiro via IA:', e);
      toast.error(e.message || 'Erro ao gerar roteiro via IA.');
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.textContent = '◈ Gerar Roteiro';
      progress.style.display = 'none';
    }
  });
}

/* ════════════════════════════════════════════════════════════
   Exportações: XLS e PDF (lista de roteiros)
   ════════════════════════════════════════════════════════════ */

function fmtDateExport(d) {
  if (!d) return '';
  try {
    const dt = d?.toDate ? d.toDate() : new Date(d);
    if (isNaN(dt?.getTime?.())) return '';
    return dt.toLocaleDateString('pt-BR');
  } catch { return ''; }
}

function _buildRoteiroRows(list) {
  return list.map(r => {
    const dests = destinationsText(r.travel);
    const start = fmtDateExport(r.travel?.startDate);
    const end = fmtDateExport(r.travel?.endDate);
    let nights = '';
    try {
      if (r.travel?.startDate && r.travel?.endDate) {
        const s = r.travel.startDate?.toDate ? r.travel.startDate.toDate() : new Date(r.travel.startDate);
        const e = r.travel.endDate?.toDate ? r.travel.endDate.toDate() : new Date(r.travel.endDate);
        const diff = Math.round((e - s) / (1000 * 60 * 60 * 24));
        if (diff >= 0) nights = String(diff);
      }
    } catch {}
    return {
      title: r.title || '',
      status: STATUS_LABELS[r.status] || r.status || '',
      statusKey: r.status || 'draft',
      clientName: r.client?.name || '',
      clientType: clientTypeLabel(r.client?.type),
      destinations: dests,
      start,
      end,
      nights,
      consultant: r.consultantName || '',
      updated: fmtDateExport(r.updatedAt),
      created: fmtDateExport(r.createdAt),
    };
  });
}

async function exportRoteirosXls(list) {
  if (!list?.length) { toast.error('Nenhum roteiro para exportar.'); return; }
  if (!window.XLSX) await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });

  const headers = ['Título', 'Status', 'Cliente', 'Tipo', 'Destinos',
    'Início', 'Fim', 'Noites', 'Consultor', 'Criado em', 'Atualizado em'];
  const rows = _buildRoteiroRows(list).map(r => [
    r.title, r.status, r.clientName, r.clientType, r.destinations,
    r.start, r.end, r.nights, r.consultant, r.created, r.updated,
  ]);

  const wb = window.XLSX.utils.book_new();
  const ws = window.XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [30, 12, 22, 10, 32, 11, 11, 7, 20, 12, 12].map(w => ({ wch: w }));
  window.XLSX.utils.book_append_sheet(wb, ws, 'Roteiros');
  window.XLSX.writeFile(wb, `primetour_roteiros_${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast.success('XLS exportado.');
}

const exportRoteirosPdf = withExportGuard(async function exportRoteirosPdf(list) {
  if (!list?.length) { toast.error('Nenhum roteiro para exportar.'); return; }
  await loadJsPdf();

  const kit = createDoc({ orientation: 'portrait', margin: 14 });
  const { doc, W, H, M, CW, setFill, setText, setDraw, drawBar, drawChip, wrap } = kit;

  const STATUS_PDF = {
    draft:    { bg: COL.muted,  label: 'RASCUNHO' },
    review:   { bg: COL.orange, label: 'EM REVISAO' },
    sent:     { bg: COL.blue,   label: 'ENVIADO' },
    approved: { bg: COL.green,  label: 'APROVADO' },
    archived: { bg: COL.soft,   label: 'ARQUIVADO' },
  };

  const total = list.length;
  const byStatus = list.reduce((acc, r) => {
    const k = r.status || 'draft';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  kit.drawCover({
    title: 'Roteiros de Viagem',
    subtitle: 'PRIMETOUR  ·  Portfólio de Roteiros',
    meta: `${total} ${total === 1 ? 'roteiro' : 'roteiros'}  ·  ${new Date().toLocaleDateString('pt-BR')}`,
    compact: false,
  });

  // Strip de estatísticas por status
  const statEntries = [
    { key: 'draft',    label: 'Rascunho',   col: COL.muted },
    { key: 'review',   label: 'Em revisão', col: COL.orange },
    { key: 'sent',     label: 'Enviado',    col: COL.blue },
    { key: 'approved', label: 'Aprovado',   col: COL.green },
    { key: 'archived', label: 'Arquivado',  col: COL.soft },
  ];
  const boxW = (CW - 8) / statEntries.length;
  statEntries.forEach((s, i) => {
    const n = byStatus[s.key] || 0;
    const x = M + i * (boxW + 2);
    setFill(COL.bg); doc.roundedRect(x, kit.y, boxW, 18, 1.8, 1.8, 'F');
    setFill(s.col);  doc.rect(x, kit.y, boxW, 1.6, 'F');

    setText(COL.text); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text(String(n), x + 4, kit.y + 11);

    setText(s.col); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6);
    doc.text(txt(s.label.toUpperCase()), x + 4, kit.y + 15.5);
  });
  kit.addY(24);

  // Cards por roteiro
  const rows = _buildRoteiroRows(list);

  const PAD_L = 4.5;
  const CHIP_FS = 6.2;
  const CHIP_H = CHIP_FS * 0.55 + 2;
  const CHIP_ROW_Y = 2;
  const TITLE_Y = CHIP_ROW_Y + CHIP_H + 2.6;
  const TITLE_FS = 9.5;
  const META_FS = 7.3;

  list.forEach((r, i) => {
    const row = rows[i];
    const stKey = (r.status || 'draft').toLowerCase();
    const stStyle = STATUS_PDF[stKey] || { bg: COL.muted, label: stKey.toUpperCase() };

    const title = row.title || '(sem titulo)';
    const titleLines = wrap(title, CW - PAD_L * 2, TITLE_FS).slice(0, 2);

    const line1 = [row.clientName, row.clientType].filter(Boolean).join(' · ');
    const line2 = [row.destinations, row.consultant].filter(Boolean).join(' · ');
    const metaStr = [line1, line2].filter(Boolean).join('  |  ');
    const metaLines = metaStr
      ? wrap(metaStr, CW - PAD_L * 2, META_FS).slice(0, 2)
      : [];

    const cardH =
      TITLE_Y +
      titleLines.length * (TITLE_FS * 0.42) +
      (metaLines.length ? 0.8 + metaLines.length * (META_FS * 0.45) : 0) +
      2.8;

    kit.ensureSpace(cardH + 2);

    setFill(COL.white); setDraw(COL.border); doc.setLineWidth(0.2);
    doc.roundedRect(M, kit.y, CW, cardH, 1.6, 1.6, 'FD');
    setFill(stStyle.bg); doc.rect(M, kit.y, 1.8, cardH, 'F');

    const cardTop = kit.y;

    // Linha superior: status + datas
    drawChip(stStyle.label, M + PAD_L, cardTop + CHIP_ROW_Y, stStyle.bg, COL.white, CHIP_FS, 2, 1);

    const dateStr = (row.start || row.end)
      ? `${row.start || '—'} a ${row.end || '—'}${row.nights ? ` · ${row.nights}n` : ''}`
      : '';
    if (dateStr) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8); setText(COL.muted);
      doc.text(txt(dateStr), W - M - 2, cardTop + CHIP_ROW_Y + CHIP_H - 1.2, { align: 'right' });
    }

    // Título
    setText(COL.text); doc.setFont('helvetica', 'bold'); doc.setFontSize(TITLE_FS);
    doc.text(titleLines, M + PAD_L, cardTop + TITLE_Y);

    // Meta (cliente, destinos, consultor)
    if (metaLines.length) {
      setText(COL.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(META_FS);
      const metaY = cardTop + TITLE_Y + titleLines.length * (TITLE_FS * 0.42) + 0.8;
      doc.text(metaLines, M + PAD_L, metaY);
    }

    kit.y = cardTop + cardH + 1.3;
  });

  kit.drawFooter('PRIMETOUR  ·  Roteiros');
  doc.save(`primetour_roteiros_${new Date().toISOString().slice(0, 10)}.pdf`);
  toast.success('PDF exportado.');
});
