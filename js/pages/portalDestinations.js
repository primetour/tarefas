/**
 * PRIMETOUR — Portal de Dicas: Destinos
 * Cadastro e hierarquia Continente → País → Cidade/Região
 */
import { store } from '../store.js';
import { toast } from '../components/toast.js';
import {
  fetchDestinations, saveDestination, deleteDestination,
  CONTINENTS,
} from '../services/portal.js';

const esc = s => String(s||'').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let allDests   = [];
let filterCont = '';
let filterCoun = '';

export async function renderPortalDestinations(container) {
  if (!store.canManagePortal()) {
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
      <div class="page-header-actions">
        <button class="btn btn-primary btn-sm" id="dest-new-btn">+ Novo Destino</button>
      </div>
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

  allDests = await fetchDestinations();
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
  if (!tbody) return;

  let rows = allDests;
  if (filterCont) rows = rows.filter(d => d.continent === filterCont);
  if (filterCoun) rows = rows.filter(d => d.country   === filterCoun);

  if (count) count.textContent = `${rows.length} destino${rows.length !== 1 ? 's' : ''}`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:48px;text-align:center;color:var(--text-muted);">
      Nenhum destino encontrado.
    </td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(d => `
    <tr style="border-bottom:1px solid var(--border-subtle);transition:background .1s;"
      onmouseover="this.style.background='var(--bg-surface)'"
      onmouseout="this.style.background=''">
      <td style="padding:10px 16px;color:var(--text-muted);font-size:0.8125rem;">${esc(d.continent || '—')}</td>
      <td style="padding:10px 16px;font-weight:500;">${esc(d.country || '—')}</td>
      <td style="padding:10px 16px;color:var(--text-secondary);">${esc(d.city || '—')}</td>
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
          <a href="#portal-tip-editor?destId=${d.id}" class="btn btn-ghost btn-sm"
            style="font-size:0.75rem;color:var(--brand-gold);text-decoration:none;">
            ✎ Dica
          </a>
          <button class="btn btn-ghost btn-sm" data-edit="${d.id}" style="font-size:0.75rem;">Destino</button>
          <button class="btn btn-ghost btn-sm" data-delete="${d.id}"
            style="font-size:0.75rem;color:#EF4444;">✕</button>
        </div>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-edit]').forEach(btn =>
    btn.addEventListener('click', () => showDestModal(allDests.find(d => d.id === btn.dataset.edit))));
  tbody.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => handleDelete(btn.dataset.delete,
      allDests.find(d => d.id === btn.dataset.delete))));
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
    try {
      await saveDestination(dest?.id || null, {
        continent,
        country,
        city:  document.getElementById('dest-city')?.value?.trim() || '',
        notes: document.getElementById('dest-notes')?.value?.trim() || '',
      });
      toast.success(`Destino ${dest ? 'atualizado' : 'criado'}.`);
      close();
      allDests = await fetchDestinations();
      renderTable();
    } catch(e) {
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
