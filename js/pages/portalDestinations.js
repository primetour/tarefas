/**
 * PRIMETOUR — Portal de Dicas: Destinos
 * Cadastro e hierarquia Continente → País → Cidade/Região
 */
import { store } from '../store.js';
import { toast } from '../components/toast.js';
import {
  fetchDestinations, saveDestination, deleteDestination, mergeDestinations,
  CONTINENTS,
} from '../services/portal.js';
import { openDestinationsImport } from '../components/destinationsImport.js';

const esc = s => String(s||'').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let allDests   = [];
let filterCont = '';
let filterCoun = '';
let filterReview = 'approved';   // v4.60.0: default só aprovados; toggle pra ver pending

export async function renderPortalDestinations(container) {
  // 4.49.2+ Usa canManageDestinations() (perm granular nova) em vez de
  // canManagePortal(). Libera pro analista criar destinos sem dar acesso
  // ao resto do Portal (banco de imagens, áreas, templates).
  if (!store.canManageDestinations()) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Destinos</h1>
        <p class="page-subtitle">Hierarquia de destinos: Continente → País → Cidade/Região</p>
      </div>
      <div class="page-header-actions" style="display:flex;gap:8px;">
        <button class="btn btn-secondary btn-sm" id="dest-import-btn"
          title="Importar vários destinos via planilha Excel">📤 Importar Excel</button>
        <button class="btn btn-primary btn-sm" id="dest-new-btn">+ Novo Destino</button>
      </div>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center;">
      <span style="font-size:0.72rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-right:4px;">Revisão:</span>
      ${[
        { v: 'approved', l: 'Aprovados' },
        { v: 'pending',  l: 'Pendentes' },
        { v: 'all',      l: 'Todos' },
      ].map(p => `
        <button class="dest-review-pill" data-review-value="${p.v}"
          style="padding:5px 12px;border-radius:999px;font-size:0.78rem;font-weight:600;cursor:pointer;
          border:1px solid ${filterReview === p.v ? 'var(--brand-blue,#3B82F6)' : 'var(--border-subtle)'};
          background:${filterReview === p.v ? 'var(--brand-blue,#3B82F6)' : 'transparent'};
          color:${filterReview === p.v ? '#fff' : 'var(--text-muted)'};font-family:inherit;">
          ${esc(p.l)}
        </button>
      `).join('')}
      <span id="dest-pending-count" style="margin-left:8px;font-size:0.72rem;color:var(--text-muted);"></span>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;">
      <select class="filter-select" id="dest-filter-cont" style="min-width:180px;">
        <option value="">Todos os continentes</option>
        ${CONTINENTS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
      </select>
      <select class="filter-select" id="dest-filter-country" style="min-width:160px;" disabled>
        <option value="">Todos os países</option>
      </select>
      <span id="dest-count" style="margin-left:auto;font-size:0.8125rem;color:var(--text-muted);
        align-self:center;"></span>
    </div>

    <div class="card" style="padding:0;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
        <thead>
          <tr style="background:var(--bg-surface);">
            <th style="padding:10px 16px;text-align:left;font-size:0.6875rem;font-weight:700;
              text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);
              border-bottom:1px solid var(--border-subtle);">Continente</th>
            <th style="padding:10px 16px;text-align:left;font-size:0.6875rem;font-weight:700;
              text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);
              border-bottom:1px solid var(--border-subtle);">País</th>
            <th style="padding:10px 16px;text-align:left;font-size:0.6875rem;font-weight:700;
              text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);
              border-bottom:1px solid var(--border-subtle);">Cidade/Região</th>
            <th style="padding:10px 16px;text-align:left;font-size:0.6875rem;font-weight:700;
              text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);
              border-bottom:1px solid var(--border-subtle);">Dica</th>
            <th style="padding:10px 16px;border-bottom:1px solid var(--border-subtle);width:100px;"></th>
          </tr>
        </thead>
        <tbody id="dest-tbody">
          <tr><td colspan="5" style="padding:40px;text-align:center;color:var(--text-muted);">
            Carregando…
          </td></tr>
        </tbody>
      </table>
    </div>
    <div id="dest-modal" style="display:none;"></div>
  `;

  document.getElementById('dest-new-btn')?.addEventListener('click', () => showDestModal(null));
  // 4.49.7+ Bulk import via Excel — abre wizard que parseia XLSX/CSV e
  // chama saveDestination pra cada linha selecionada. onComplete refaz fetch.
  document.getElementById('dest-import-btn')?.addEventListener('click', () => {
    openDestinationsImport({
      onComplete: async () => {
        allDests = await fetchDestinations();
        renderTable();
      },
    });
  });
  document.getElementById('dest-filter-cont')?.addEventListener('change', e => {
    filterCont = e.target.value;
    filterCoun = '';
    updateCountryFilter();
    renderTable();
  });
  document.getElementById('dest-filter-country')?.addEventListener('change', e => {
    filterCoun = e.target.value;
    renderTable();
  });
  // v4.60.0: filtro reviewStatus pills
  document.querySelectorAll('.dest-review-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      filterReview = pill.dataset.reviewValue;
      // Re-render só os pills (visual active) + tabela
      document.querySelectorAll('.dest-review-pill').forEach(p => {
        const isActive = p.dataset.reviewValue === filterReview;
        p.style.background = isActive ? 'var(--brand-blue,#3B82F6)' : 'transparent';
        p.style.color = isActive ? '#fff' : 'var(--text-muted)';
        p.style.borderColor = isActive ? 'var(--brand-blue,#3B82F6)' : 'var(--border-subtle)';
      });
      renderTable();
    });
  });

  allDests = await fetchDestinations();   // default 'all' agora — UI filtra in-memory
  updateCountryFilter();
  renderTable();
}

function updateCountryFilter() {
  const sel = document.getElementById('dest-filter-country');
  if (!sel) return;
  const countries = [...new Set(
    allDests.filter(d => d.continent === filterCont)
      .map(d => d.country).filter(Boolean)
  )].sort();
  sel.innerHTML = `<option value="">Todos os países</option>` +
    countries.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  sel.value    = filterCoun; // restores if still valid, otherwise empty
  sel.disabled = !filterCont;
}

function renderTable() {
  const tbody = document.getElementById('dest-tbody');
  const count = document.getElementById('dest-count');
  const pendCount = document.getElementById('dest-pending-count');
  if (!tbody) return;

  // v4.60.0: pending count global (independente dos filtros) pra UI alertar curador
  const totalPending = allDests.filter(d => (d.reviewStatus || 'approved') === 'pending').length;
  if (pendCount) {
    pendCount.textContent = totalPending
      ? `${totalPending} pendente${totalPending !== 1 ? 's' : ''} no banco — revisar e aprovar.`
      : '';
  }

  let rows = allDests;
  // v4.60.0: filtra por reviewStatus
  if (filterReview && filterReview !== 'all') {
    rows = rows.filter(d => (d.reviewStatus || 'approved') === filterReview);
  }
  if (filterCont) rows = rows.filter(d => d.continent === filterCont);
  if (filterCoun) rows = rows.filter(d => d.country   === filterCoun);

  if (count) count.textContent = `${rows.length} destino${rows.length !== 1 ? 's' : ''}`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:48px;text-align:center;color:var(--text-muted);">
      Nenhum destino encontrado.
    </td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(d => {
    const isPending = (d.reviewStatus || 'approved') === 'pending';
    const isAutoBank = d.source === 'banco-auto';
    return `
    <tr style="border-bottom:1px solid var(--border-subtle);transition:background .1s;background:${isPending?'rgba(245,158,11,0.05)':''};"
      onmouseover="this.style.background='${isPending?'rgba(245,158,11,0.10)':'var(--bg-surface)'}'"
      onmouseout="this.style.background='${isPending?'rgba(245,158,11,0.05)':''}'">
      <td style="padding:10px 16px;color:var(--text-muted);font-size:0.8125rem;">${esc(d.continent || '—')}</td>
      <td style="padding:10px 16px;font-weight:500;">${esc(d.country || '—')}</td>
      <td style="padding:10px 16px;color:var(--text-secondary);">
        ${esc(d.city || '—')}
        ${isPending ? `<span style="display:inline-block;margin-left:6px;font-size:0.65rem;padding:1px 6px;
          background:var(--badge-warn-bg,rgba(245,158,11,0.16));color:var(--color-warn-text,#92400e);
          border-radius:999px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;"
          title="${isAutoBank ? `Auto-criada do banco de roteiros (${d.refCount || 0} ref${(d.refCount||0)!==1?'s':''}). Revisar antes de aprovar.` : 'Aguardando revisão master.'}">
          ⏳ Pendente${isAutoBank ? ' (banco)' : ''}
        </span>` : ''}
      </td>
      <td style="padding:10px 16px;">
        ${d.hasTip
          ? `<span style="font-size:0.75rem;padding:2px 8px;background:#22C55E15;color:#22C55E;
              border:1px solid #22C55E30;border-radius:var(--radius-full);">✓ Cadastrada</span>`
          : `<span style="font-size:0.75rem;padding:2px 8px;background:var(--bg-surface);
              color:var(--text-muted);border:1px solid var(--border-subtle);
              border-radius:var(--radius-full);">Sem dica</span>`}
      </td>
      <td style="padding:10px 16px;text-align:right;">
        <div style="display:flex;gap:6px;justify-content:flex-end;">
          ${isPending ? `<button class="btn btn-primary btn-sm" data-approve="${d.id}"
            style="font-size:0.72rem;padding:3px 10px;" title="Aprovar destino — vira parte canônica do SSOT">
            ✓ Aprovar
          </button>` : ''}
          <a href="#portal-tip-editor?destId=${d.id}" class="btn btn-ghost btn-sm"
            style="font-size:0.75rem;color:var(--brand-gold);text-decoration:none;">
            ✎ Dica
          </a>
          <button class="btn btn-ghost btn-sm" data-edit="${d.id}" style="font-size:0.75rem;">Destino</button>
          <button class="btn btn-ghost btn-sm" data-delete="${d.id}"
            style="font-size:0.75rem;color:var(--color-danger,#EF4444);">✕</button>
        </div>
      </td>
    </tr>
  `;}).join('');

  tbody.querySelectorAll('[data-edit]').forEach(btn =>
    btn.addEventListener('click', () => showDestModal(allDests.find(d => d.id === btn.dataset.edit))));
  tbody.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => handleDelete(btn.dataset.delete,
      allDests.find(d => d.id === btn.dataset.delete))));
  // v4.60.0: handler aprovar (flip reviewStatus pra 'approved')
  tbody.querySelectorAll('[data-approve]').forEach(btn =>
    btn.addEventListener('click', () => handleApprove(btn.dataset.approve,
      allDests.find(d => d.id === btn.dataset.approve))));
}

/** v4.60.0: aprova destino pending → reviewStatus='approved'.
 *  v4.60.2: detecta DUPLICATE (já existe approved com mesma cidade ou alias)
 *  e oferece mesclar inline via modal — sem permitir duplicata silenciosa. */
async function handleApprove(id, dest) {
  if (!dest) return;
  try {
    await saveDestination(id, {
      continent: dest.continent,
      country: dest.country,
      city: dest.city,
      countryCode: dest.countryCode,
      continentCode: dest.continentCode,
      notes: dest.notes || '',
      reviewStatus: 'approved',
      source: dest.source,
    });
    toast.success(`Aprovado: ${[dest.city, dest.country].filter(Boolean).join(', ')}.`);
    allDests = await fetchDestinations();
    renderTable();
  } catch (e) {
    if (e?.code === 'DUPLICATE') {
      await _handleDuplicateMergeFlow(id, dest, e);
      return;
    }
    toast.error('Erro ao aprovar: ' + e.message);
  }
}

/**
 * v4.60.2: fluxo de merge quando aprovação detecta duplicata.
 * Mostra modal "Mesclar com existente?" + 2 ações.
 */
async function _handleDuplicateMergeFlow(duplicateId, dupDest, dupErr) {
  const { modal } = await import('../components/modal.js');
  const tryingCity = [dupDest.city, dupDest.country].filter(Boolean).join(', ');
  const existing = `${dupErr.mergeTargetCity}${dupErr.mergeTargetAliases?.length
    ? ` (aliases: ${dupErr.mergeTargetAliases.join(', ')})`
    : ''}`;
  let resolved = false;
  await new Promise(resolve => {
    const handle = modal.open({
      title: '⚠ Já existe destino aprovado equivalente',
      size: 'md', closeOnEsc: true,
      content: `
        <div style="line-height:1.5;">
          <p style="margin:0 0 10px;">Você está tentando aprovar <strong>"${esc(tryingCity)}"</strong>,
          mas já existe um destino aprovado equivalente no mesmo país:</p>
          <p style="margin:0 0 12px;background:var(--bg-surface);padding:8px 12px;border-radius:6px;
            border:1px solid var(--border-subtle);font-weight:600;">
            ✓ ${esc(existing)} <span style="color:var(--text-muted);font-weight:400;">— canônico</span>
          </p>
          <p style="margin:0 0 8px;"><strong>Mesclar</strong> (recomendado):</p>
          <ul style="margin:0 0 12px 18px;font-size:0.88rem;color:var(--text-secondary);">
            <li>"${esc(dupDest.city)}" vira <strong>alias</strong> do canônico</li>
            <li>FKs cross-module (imagens / dicas / banco de roteiros) redirecionam pro canônico</li>
            <li>Este pending é deletado</li>
          </ul>
          <p style="margin:0;font-size:0.78rem;color:var(--text-muted);">
            <strong>Cancelar</strong> mantém o pending pendente — você pode editá-lo manualmente depois (ex: renomear pra cidade distinta).
          </p>
        </div>
      `,
      footer: [
        { label: 'Cancelar', class: 'btn-secondary' },
        {
          label: 'Mesclar com canônico', class: 'btn-primary',
          onClick: async () => {
            resolved = true;
            try {
              const res = await mergeDestinations(dupErr.mergeTargetId, duplicateId);
              toast.success(`Mesclado em "${dupErr.mergeTargetCity}". ${res.redirected ? res.redirected + ' refs cross-module atualizadas.' : ''}`);
              allDests = await fetchDestinations();
              renderTable();
            } catch (e) { toast.error('Erro ao mesclar: ' + e.message); }
          },
        },
      ],
      onClose: () => { resolve(); },
    });
  });
}

function showDestModal(dest) {
  const modal = document.getElementById('dest-modal');
  if (!modal) return;
  modal.style.cssText = `display:flex;position:fixed;inset:0;background:rgba(0,0,0,.6);
    z-index:1000;align-items:center;justify-content:center;padding:20px;`;

  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:480px;padding:28px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h3 style="margin:0;font-size:1rem;">${dest ? 'Editar Destino' : 'Novo Destino'}</h3>
        <button id="dest-modal-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">Continente *</label>
          <select id="dest-continent" class="filter-select" style="width:100%;">
            <option value="">Selecione</option>
            ${CONTINENTS.map(c => `<option value="${esc(c)}" ${dest?.continent===c?'selected':''}>${esc(c)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">País *</label>
          <input type="text" id="dest-country" class="filter-select" style="width:100%;"
            placeholder="Ex: França" value="${esc(dest?.country || '')}">
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">
            Cidade / Região <span style="font-weight:400;color:var(--text-muted);">(opcional)</span>
          </label>
          <input type="text" id="dest-city" class="filter-select" style="width:100%;"
            placeholder="Ex: Paris" value="${esc(dest?.city || '')}">
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">Notas internas</label>
          <textarea id="dest-notes" class="filter-select" style="width:100%;height:60px;resize:vertical;"
            placeholder="Informações de referência...">${esc(dest?.notes || '')}</textarea>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:20px;">
        <button class="btn btn-secondary" id="dest-modal-cancel" style="flex:1;">Cancelar</button>
        <button class="btn btn-primary" id="dest-modal-save" style="flex:2;">
          ${dest ? 'Salvar' : 'Criar Destino'}
        </button>
      </div>
    </div>
  `;

  const close = () => { modal.style.display = 'none'; modal.innerHTML = ''; };
  document.getElementById('dest-modal-close')?.addEventListener('click', close);
  document.getElementById('dest-modal-cancel')?.addEventListener('click', close);

  document.getElementById('dest-modal-save')?.addEventListener('click', async () => {
    const continent = document.getElementById('dest-continent')?.value;
    const country   = document.getElementById('dest-country')?.value?.trim();
    if (!continent) { toast.error('Selecione o continente.'); return; }
    if (!country)   { toast.error('País obrigatório.'); return; }
    const btn = document.getElementById('dest-modal-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
    const payload = {
      continent,
      country,
      city:  document.getElementById('dest-city')?.value?.trim() || '',
      notes: document.getElementById('dest-notes')?.value?.trim() || '',
    };
    try {
      await saveDestination(dest?.id || null, payload);
      toast.success(`Destino ${dest ? 'atualizado' : 'criado'}.`);
      close();
      allDests = await fetchDestinations();
      renderTable();
    } catch(e) {
      // v4.60.2: DUPLICATE → oferece merge inline (mesma UX do approve)
      if (e?.code === 'DUPLICATE') {
        if (dest?.id) {
          // Existe doc atual sendo editado — pode tentar mesclá-lo no canônico
          close();
          await _handleDuplicateMergeFlow(dest.id, { ...dest, ...payload }, e);
        } else {
          // Save de doc NOVO: nada pra mesclar, só explica. Mantém modal aberto pro user corrigir.
          toast.error(`Já existe "${e.mergeTargetCity}" em ${e.mergeTargetCountry}. Renomeie ou cancele.`);
          if (btn) { btn.disabled = false; btn.textContent = 'Criar Destino'; }
        }
        return;
      }
      toast.error('Erro: ' + e.message);
      if (btn) { btn.disabled = false; btn.textContent = dest ? 'Salvar' : 'Criar Destino'; }
    }
  });
}

async function handleDelete(id, dest) {
  const label = [dest?.city, dest?.country, dest?.continent].filter(Boolean).join(', ');
  if (!confirm(`Excluir o destino "${label}"?`)) return;
  try {
    await deleteDestination(id);
    toast.success('Destino excluído.');
    allDests = await fetchDestinations();
    renderTable();
  } catch(e) { toast.error('Erro: ' + e.message); }
}
