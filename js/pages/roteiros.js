/**
 * PRIMETOUR — Roteiros de Viagem: Lista / Gestão
 * List/grid page for travel itineraries
 */

import { store } from '../store.js';
import { toast } from '../components/toast.js';
const showToast = (msg, type = 'info') => toast[type]?.(msg) ?? toast.info(msg);
import { fetchRoteiros, deleteRoteiro, duplicateRoteiro, updateRoteiroStatus, generateRoteiroFromPrompt } from '../services/roteiros.js';
import { fetchAreas } from '../services/portal.js';
import { createDoc, loadJsPdf, COL, txt, withExportGuard } from '../components/pdfKit.js';
import { renderPageHeader, renderFilterBar, wireUiKitMenus, wirePeriodPills, PERIOD_PRESETS } from '../components/uiKit.js';

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
  let allAreas = [];
  let activeStatus = '';
  let searchTerm = '';
  let selectedConsultant = '';
  let selectedAreaId = '';
  let selectedDestino = '';     // GAP fix: filtro por destino (city ou country)
  let selectedClientType = '';  // GAP fix: filtro por tipo de cliente
  let periodKey = 'all';        // 7d/30d/90d/12m/all/custom — filtra por travel.startDate
  let periodFrom = null;
  let periodTo = null;
  let sortKey = 'updatedAt';   // 'updatedAt' | 'client' | 'destinos' | 'period' | 'consultant' | 'title'
  let sortDir = 'desc';        // 'asc' | 'desc'
  let currentPage = 1;
  const PAGE_SIZE = 50;

  /* ── Initial HTML usando uiKit ── */
  const canCreate = store.canCreateRoteiro();
  container.innerHTML = `
    ${renderPageHeader({
      title: 'Gerador de Roteiros',
      subtitle: 'Crie e gerencie roteiros personalizados para seus clientes',
      primary: canCreate ? { label: '+ Novo Roteiro', action: 'new-roteiro' } : null,
      secondary: canCreate ? [
        { label: 'Criar com IA', icon: '◈', action: 'ai-create',
          title: 'Criar roteiro completo via IA a partir de uma descrição em texto livre' },
      ] : [],
      export: { formats: ['xls', 'pdf'], action: 'export-list' },
    })}

    <div id="rt-filters-mount"></div>

    <!-- Tabela densa (desktop) — em mobile vira lista compacta via CSS.
         overflow-x:auto pra evitar cortar a coluna de Ações em telas justas. -->
    <div id="rt-table-wrap" style="background:var(--bg-card,#fff);border:1px solid var(--border,#e5e7eb);
      border-radius:10px;overflow-x:auto;">
      <div id="rt-table">
        <div style="padding:40px;text-align:center;color:var(--text-muted);">Carregando...</div>
      </div>
    </div>

    <style>
      /* Pills filtro status */
      .rt-pill {
        padding:5px 14px;border-radius:999px;font-size:0.8125rem;font-weight:600;
        border:1px solid var(--border, #e5e7eb);background:transparent;color:var(--text-muted, #6B7280);
        cursor:pointer;transition:all 0.15s;
      }
      .rt-pill:hover { background:var(--bg-hover, rgba(0,0,0,0.04)); }
      .rt-pill.active {
        background:var(--brand-blue, #3B82F6);color:#fff;border-color:var(--brand-blue, #3B82F6);
      }

      /* Tabela densa — table-layout fixed garante que widths declarados
         na <th> são respeitados (sem squeeze de coluna por content) */
      .rt-table-el {
        width:100%; min-width:980px; border-collapse:collapse;
        font-size:0.8125rem; table-layout:fixed;
      }
      .rt-table-el thead th {
        text-align:left; padding:10px 8px;
        background:var(--bg-surface, #f8fafc);
        color:var(--text-muted, #6B7280);
        font-weight:600; font-size:0.6875rem;
        text-transform:uppercase; letter-spacing:0.04em;
        border-bottom:1px solid var(--border, #e5e7eb);
        cursor:default; user-select:none;
        white-space:nowrap;
      }
      .rt-table-el thead th.sortable { cursor:pointer; }
      .rt-table-el thead th.sortable:hover { color:var(--text-primary); }
      .rt-table-el thead th .sort-arrow { opacity:0.5; margin-left:4px; font-size:0.7em; }
      .rt-table-el thead th.sort-active .sort-arrow { opacity:1; color:var(--brand-blue, #3B82F6); }
      .rt-table-el tbody tr {
        border-bottom:1px solid var(--border-subtle, #f0f0f0);
        transition:background 0.1s;
      }
      .rt-table-el tbody tr:hover { background:var(--bg-hover, rgba(59,130,246,0.04)); }
      .rt-table-el tbody td {
        padding:10px 8px; vertical-align:middle;
        color:var(--text-primary);
      }
      .rt-table-el tbody td.ellipsis {
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      }
      .rt-table-el tbody td.muted { color:var(--text-muted); font-size:0.75rem; }
      .rt-table-el tbody td.title-cell {
        max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      }
      .rt-table-el tbody td.title-cell a {
        color:var(--text-primary); text-decoration:none; font-weight:600;
      }
      .rt-table-el tbody td.title-cell a:hover { color:var(--brand-blue, #3B82F6); }
      .rt-table-el tbody td.dest-cell {
        max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        font-size:0.75rem; color:var(--text-muted);
      }
      .rt-actions { display:flex; gap:2px; justify-content:flex-end; flex-wrap:nowrap; }
      .rt-actions button {
        padding:5px 7px; border-radius:5px; font-size:0.875rem;
        border:none; background:transparent; cursor:pointer;
        color:var(--text-muted); transition:all 0.1s;
        line-height:1; flex-shrink:0;
      }
      .rt-actions button:hover { background:var(--bg-hover, rgba(0,0,0,0.05)); color:var(--text-primary); }
      .rt-actions button.danger:hover { background:rgba(239,68,68,0.1); color:#EF4444; }

      .rt-client-badge {
        display:inline-block; padding:1px 7px; border-radius:999px; font-size:0.65rem; font-weight:600;
        background:rgba(59,130,246,0.1); color:var(--brand-blue, #3B82F6);
        border:1px solid rgba(59,130,246,0.2); margin-left:6px; vertical-align:middle;
      }

      /* Paginação */
      .rt-pg-btn {
        padding:4px 10px; border-radius:6px; font-size:0.75rem; cursor:pointer;
        background:transparent; border:1px solid var(--border, #e5e7eb); color:var(--text-secondary);
      }
      .rt-pg-btn:disabled { opacity:0.4; cursor:not-allowed; }
      .rt-pg-btn:not(:disabled):hover { background:var(--bg-hover, rgba(0,0,0,0.04)); }

      /* Mobile: vira "lista de cards" */
      @media (max-width: 768px) {
        .rt-table-el thead { display:none; }
        .rt-table-el, .rt-table-el tbody, .rt-table-el tr, .rt-table-el td {
          display:block; width:100%;
        }
        .rt-table-el tbody tr {
          padding:10px 12px; margin-bottom:6px;
          border:1px solid var(--border, #e5e7eb); border-radius:8px;
        }
        .rt-table-el tbody td { padding:3px 0; border:none; }
        .rt-table-el tbody td.title-cell { max-width:none; font-size:0.875rem; }
        .rt-table-el tbody td.dest-cell { max-width:none; }
        .rt-actions { justify-content:flex-start; flex-wrap:wrap; margin-top:6px; }
      }
    </style>
  `;

  /* ── Load data ──
   * 4.40.31+ (Sprint 1) — aplica hierarquia via getVisibleUserIds()
   * (mesmo padrão de /goals e /feedbacks).
   *
   * Regra:
   *   - master / roteiro_manage / system_view_all → vê todos
   *   - demais → vê próprios + de subordinados (transitivos via managerId)
   *              + roteiros onde está em collaboratorIds[]
   */
  async function loadData() {
    try {
      const [roteiros, areas] = await Promise.all([
        fetchRoteiros(),
        fetchAreas().catch(() => []),
      ]);

      // Aplica hierarquia
      const seeAll = store.isMaster()
        || store.can('system_view_all')
        || store.can('roteiro_manage');

      if (seeAll) {
        allRoteiros = roteiros;
      } else {
        const myUid = store.get('currentUser')?.uid;
        const myProfile = store.get('userProfile') || {};
        const viewer = { uid: myUid, ...myProfile };
        const allUsers = store.get('users') || [];
        const { getVisibleUserIds } = await import('../services/users.js');
        const visibleSet = getVisibleUserIds(viewer, allUsers, (p) => store.can(p));

        if (!visibleSet) {
          allRoteiros = roteiros;  // null = vê tudo
        } else {
          allRoteiros = roteiros.filter(r => {
            // Próprio / hierarquia
            if (r.consultantId && visibleSet.has(r.consultantId)) return true;
            // Colaborador explícito
            if (Array.isArray(r.collaboratorIds) && r.collaboratorIds.includes(myUid)) return true;
            return false;
          });
        }
      }

      allAreas = areas;
      renderFilters();
      renderTable();
    } catch (err) {
      const tableEl = document.getElementById('rt-table');
      if (tableEl) tableEl.innerHTML = `
        <div style="text-align:center;padding:40px;color:var(--text-muted);">
          Erro ao carregar roteiros: ${esc(err.message)}
        </div>`;
    }
  }

  /* Re-renderiza a barra de filtros (precisa rodar após loadData pra ter
     dropdowns com áreas/consultores/destinos populados). Mantém valores
     do state global ao re-renderizar. */
  function renderFilters() {
    const mount = document.getElementById('rt-filters-mount');
    if (!mount) return;

    // Áreas (sempre que houver)
    const areaOptions = (allAreas || []).map(a => ({ value: a.id, label: a.name }));

    // Consultores únicos (admin only)
    const consultantOptions = store.canManageRoteiros() ? [...new Map(
      allRoteiros
        .filter(r => r.consultantId && r.consultantName)
        .map(r => [r.consultantId, r.consultantName])
    ).entries()].map(([id, name]) => ({ value: id, label: name })) : [];

    // Destinos únicos derivados das próprias roteiros (city ou country)
    // GAP fix: filtrar por destino estava ausente, embora os dados estivessem visíveis.
    const destSet = new Set();
    allRoteiros.forEach(r => {
      (r.travel?.destinations || []).forEach(d => {
        if (d.city)    destSet.add(d.city);
        if (d.country) destSet.add(d.country);
      });
    });
    const destOptions = [...destSet].sort().map(d => ({ value: d, label: d }));

    const clientTypeOptions = [
      { value: 'individual', label: 'Individual' },
      { value: 'couple',     label: 'Casal' },
      { value: 'family',     label: 'Família' },
      { value: 'group',      label: 'Grupo' },
    ];

    // Status pills
    const statusPills = [
      { value: '',         label: 'Todos' },
      { value: 'draft',    label: 'Rascunho' },
      { value: 'review',   label: 'Em revisão' },
      { value: 'sent',     label: 'Enviado' },
      { value: 'approved', label: 'Aprovado' },
      { value: 'archived', label: 'Arquivado' },
    ];

    const selects = [
      { id: 'rt-area',        label: '— Todas áreas —',     options: areaOptions,        value: selectedAreaId },
      { id: 'rt-destino',     label: '— Todos destinos —',  options: destOptions,        value: selectedDestino },
      { id: 'rt-clienttype',  label: '— Todo tipo —',        options: clientTypeOptions,  value: selectedClientType },
    ];
    if (consultantOptions.length) {
      selects.push({ id: 'rt-consultant', label: '— Todos consultores —', options: consultantOptions, value: selectedConsultant });
    }

    mount.innerHTML = renderFilterBar({
      statusPills,
      activeStatus,
      search: { id: 'rt-search', placeholder: 'Buscar cliente, título ou destino...', value: searchTerm },
      selects,
      periodPills: { active: periodKey },
      metaText: '',  // populated pelo renderTable
      paginationHTML: '',
    });
  }

  /* Filtros + ordenação aplicados */
  function getFiltered() {
    let filtered = allRoteiros;

    if (activeStatus)        filtered = filtered.filter(r => r.status === activeStatus);
    if (selectedConsultant)  filtered = filtered.filter(r => r.consultantId === selectedConsultant);
    if (selectedAreaId)      filtered = filtered.filter(r => r.areaId === selectedAreaId);
    if (selectedDestino)     filtered = filtered.filter(r =>
      (r.travel?.destinations || []).some(d => d.city === selectedDestino || d.country === selectedDestino)
    );
    if (selectedClientType)  filtered = filtered.filter(r => r.client?.type === selectedClientType);
    if (periodKey !== 'all' && periodFrom) {
      // Filtra por travel.startDate dentro do range
      filtered = filtered.filter(r => {
        const sd = r.travel?.startDate;
        if (!sd) return false;
        const dt = new Date(sd);
        if (periodFrom && dt < periodFrom) return false;
        if (periodTo && dt > periodTo) return false;
        return true;
      });
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(r =>
        (r.client?.name || '').toLowerCase().includes(term) ||
        destinationsText(r.travel).toLowerCase().includes(term) ||
        (r.title || '').toLowerCase().includes(term)
      );
    }

    // Sort
    const dir = sortDir === 'asc' ? 1 : -1;
    const getVal = (r) => {
      switch (sortKey) {
        case 'title':      return (r.title || '').toLowerCase();
        case 'client':     return (r.client?.name || '').toLowerCase();
        case 'destinos':   return destinationsText(r.travel).toLowerCase();
        case 'period':     return r.travel?.startDate || '';
        case 'consultant': return (r.consultantName || '').toLowerCase();
        case 'updatedAt':
        default: {
          const d = r.updatedAt;
          if (!d) return 0;
          return (d?.toDate ? d.toDate() : new Date(d)).getTime();
        }
      }
    };
    filtered = [...filtered].sort((a, b) => {
      const va = getVal(a), vb = getVal(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return  1 * dir;
      return 0;
    });

    return filtered;
  }

  /* Atualiza meta+paginação dentro do filter bar (ele é re-renderizado a cada query) */
  function updateMetaRow(total, startIdx, endIdx, totalPages) {
    const metaEl = document.querySelector('.uikit-meta-row > span');
    const pagEl  = document.querySelector('.uikit-meta-row > div');
    if (metaEl) {
      metaEl.textContent = total
        ? `${total} roteiro${total !== 1 ? 's' : ''}` +
          (totalPages > 1 ? ` · mostrando ${startIdx + 1}–${endIdx}` : '')
        : '';
    }
    if (pagEl) {
      pagEl.innerHTML = totalPages > 1 ? `
        <button class="rt-pg-btn" data-pg="prev" ${currentPage === 1 ? 'disabled' : ''}>‹ Anterior</button>
        <span style="padding:0 6px;">Pág ${currentPage} de ${totalPages}</span>
        <button class="rt-pg-btn" data-pg="next" ${currentPage === totalPages ? 'disabled' : ''}>Próxima ›</button>
      ` : '';
    }
  }

  /* ── Render: tabela densa com paginação ── */
  function renderTable() {
    const tableEl = document.getElementById('rt-table');
    if (!tableEl) return;

    const filtered = getFiltered();
    const total = filtered.length;

    // Empty state
    if (!total) {
      tableEl.innerHTML = `
        <div style="text-align:center;padding:60px 20px;">
          <div style="font-size:3rem;opacity:0.3;margin-bottom:12px;">✈</div>
          <p style="color:var(--text-muted);font-size:0.9375rem;">
            ${allRoteiros.length
              ? 'Nenhum roteiro encontrado com esses filtros.'
              : 'Nenhum roteiro cadastrado ainda.'}
          </p>
          ${!allRoteiros.length && store.canCreateRoteiro() ? `
            <button class="btn btn-primary" data-action="new-roteiro" style="margin-top:16px;">+ Criar primeiro roteiro</button>
          ` : ''}
        </div>`;
      updateMetaRow(0, 0, 0, 1);
      return;
    }

    // Paginação
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const endIdx   = Math.min(startIdx + PAGE_SIZE, total);
    const slice    = filtered.slice(startIdx, endIdx);

    updateMetaRow(total, startIdx, endIdx, totalPages);

    // Headers (com sort)
    const sortArrow = (key) => sortKey === key
      ? `<span class="sort-arrow">${sortDir === 'asc' ? '▲' : '▼'}</span>`
      : '<span class="sort-arrow">↕</span>';
    const sortable = (key, label, extra = '') => `
      <th class="sortable ${sortKey === key ? 'sort-active' : ''}" data-sort="${key}" ${extra}>
        ${label} ${sortArrow(key)}
      </th>`;

    // Linhas
    const rows = slice.map(r => {
      const clientName = r.client?.name || '—';
      const clientType = r.client?.type || 'individual';
      const dests = destinationsText(r.travel) || '—';
      const period = fmtDateRange(r.travel) || '—';
      const isArchived = r.status === 'archived';
      const idEsc = esc(r.id);
      // 4.43.0+ Sprint 4 — indicador de tarefas vinculadas
      const taskCount = Array.isArray(r.linkedTaskIds) ? r.linkedTaskIds.length : 0;
      const tasksBadge = taskCount > 0
        ? `<span title="${taskCount} tarefa(s) operacional(is) vinculada(s)"
            style="display:inline-flex;align-items:center;gap:3px;margin-left:8px;
              font-size:0.7rem;font-weight:600;color:var(--brand-gold);
              background:rgba(212,168,67,.12);padding:2px 7px;border-radius:99px;
              vertical-align:middle;">🔗 ${taskCount}</span>`
        : '';

      return `
        <tr data-id="${idEsc}">
          <td style="white-space:nowrap;">${statusBadge(r.status)}</td>
          <td class="title-cell ellipsis">
            <a href="#roteiro-editor?id=${idEsc}" data-action="edit" data-id="${idEsc}"
              title="${esc(r.title || 'Sem título')}">${esc(r.title || 'Sem título')}</a>${tasksBadge}
          </td>
          <td class="ellipsis">
            <span style="font-weight:500;">${esc(clientName)}</span>
            <span class="rt-client-badge">${esc(clientTypeLabel(clientType))}</span>
          </td>
          <td class="dest-cell ellipsis" title="${esc(dests)}">${esc(dests)}</td>
          <td style="white-space:nowrap;font-size:0.75rem;color:var(--text-muted);">${esc(period)}</td>
          <td class="ellipsis" style="font-size:0.8125rem;">${esc(r.consultantName || '—')}</td>
          <td class="muted" style="white-space:nowrap;">${esc(timeAgo(r.updatedAt))}</td>
          <td>
            <div class="rt-actions">
              <button data-action="edit" data-id="${idEsc}" title="Editar">✎</button>
              <button data-action="duplicate" data-id="${idEsc}" title="Duplicar">⧉</button>
              <button data-action="export-pdf" data-id="${idEsc}" title="Exportar PDF">↓</button>
              <button data-action="${isArchived ? 'restore' : 'archive'}" data-id="${idEsc}"
                title="${isArchived ? 'Restaurar' : 'Arquivar'}">${isArchived ? '↺' : '⊠'}</button>
              <button data-action="delete" data-id="${idEsc}" class="danger" title="Excluir">✕</button>
            </div>
          </td>
        </tr>`;
    }).join('');

    tableEl.innerHTML = `
      <table class="rt-table-el">
        <thead>
          <tr>
            <th style="width:88px;">Status</th>
            ${sortable('title', 'Roteiro', 'style="width:auto;"')}
            ${sortable('client', 'Cliente', 'style="width:140px;"')}
            ${sortable('destinos', 'Destinos', 'style="width:160px;"')}
            ${sortable('period', 'Período', 'style="width:160px;"')}
            ${sortable('consultant', 'Consultor', 'style="width:110px;"')}
            ${sortable('updatedAt', 'Atualizado', 'style="width:84px;"')}
            <th style="text-align:right;width:140px;">Ações</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  /* ── Event delegation ──
     SCOPE: o handler só processa clicks DENTRO do container da página de
     Roteiros. Sem isso, ações genéricas como data-action="edit" capturariam
     clicks de outras páginas (ex: row em Users com data-action="edit"
     navegava pra #roteiro-editor?id=undefined).
     */
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    // Garante que o botão pertence ao container atual de Roteiros
    if (!container.contains(btn)) return;

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

    // Export handlers — uiKit ExportMenu dispara export-list-xls / export-list-pdf
    if (action === 'export-xls' || action === 'export-list-xls') {
      await exportRoteirosXls(getFiltered());
      return;
    }

    if (action === 'export-pdf-list' || action === 'export-list-pdf') {
      await exportRoteirosPdf(getFiltered());
      return;
    }

    // edit/duplicate/archive/restore/delete: só processa se for botão dentro
    // da tabela de Roteiros (evita colisão com outras páginas que usam mesmos data-actions)
    if (!btn.closest('.rt-table-el')) return;

    if (action === 'edit') {
      if (!id) return;   // guard contra id=undefined
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

  /* ── Filter bar interactions ── */
  container.addEventListener('click', (e) => {
    // Status pills (uiKit class)
    const statusPill = e.target.closest('.uikit-status-pill');
    if (statusPill) {
      activeStatus = statusPill.dataset.filterStatus || '';
      currentPage = 1;
      renderFilters();   // re-render pra atualizar visual da pill ativa
      renderTable();
      return;
    }

    // Sort por header
    const th = e.target.closest('.rt-table-el thead th.sortable');
    if (th) {
      const key = th.dataset.sort;
      if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortKey = key; sortDir = 'asc'; }
      renderTable();
      return;
    }

    // Paginação
    const pgBtn = e.target.closest('[data-pg]');
    if (pgBtn && !pgBtn.disabled) {
      if (pgBtn.dataset.pg === 'next') currentPage++;
      else if (pgBtn.dataset.pg === 'prev') currentPage--;
      renderTable();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
  });

  // Search + selects via event delegation no container (filter bar é re-renderizado)
  container.addEventListener('input', (e) => {
    if (e.target.id === 'rt-search') {
      searchTerm = e.target.value;
      currentPage = 1;
      renderTable();
    }
  });
  container.addEventListener('change', (e) => {
    const id = e.target.id;
    if (id === 'rt-area')        { selectedAreaId = e.target.value;     currentPage = 1; renderTable(); }
    else if (id === 'rt-destino')    { selectedDestino = e.target.value;    currentPage = 1; renderTable(); }
    else if (id === 'rt-clienttype') { selectedClientType = e.target.value; currentPage = 1; renderTable(); }
    else if (id === 'rt-consultant') { selectedConsultant = e.target.value; currentPage = 1; renderTable(); }
  });

  // Period pills wire (uiKit)
  wirePeriodPills(container, (key, range) => {
    periodKey = key;
    periodFrom = range.from;
    periodTo = range.to;
    currentPage = 1;
    renderTable();
  });

  // Ativa dropdowns do header (export menu + overflow)
  wireUiKitMenus(container);

  /* ── Init ── */
  await loadData();

  // Remove qualquer botão de agent de roteiros injetado no header — a UI
  // dedicada "Criar com IA" chama o mesmo agent, botão duplicado polui.
  // mountAgentsForRoute pode injetar a qualquer momento (após Firestore
  // fetch), então usamos MutationObserver pra pegar mesmo quando aparece
  // depois do render inicial.
  const detachRoteiroAgentBtn = () => {
    document.querySelectorAll('.agent-trigger-btn').forEach(b => {
      const txt = (b.textContent || '') + ' ' + (b.title || '');
      if (/roteiro/i.test(txt)) b.remove();
    });
    document.querySelectorAll('.agent-trigger-group').forEach(g => {
      if (!g.children.length) g.remove();
    });
  };
  detachRoteiroAgentBtn();
  // Observer no header pra remover assim que aparecer
  const headerEl = container.querySelector('.page-header') || container;
  const obs = new MutationObserver(detachRoteiroAgentBtn);
  obs.observe(headerEl, { childList: true, subtree: true });
  // Auto-disconnect ao trocar de página (defensive — evita observer leak)
  container._agentDetachObs = obs;
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
