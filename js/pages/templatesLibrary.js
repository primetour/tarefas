/**
 * PRIMETOUR — Biblioteca de Templates (Sprint v4.63.x)
 *
 * Lista templates uploaded (HTML/DOCX/PPTX) filtráveis por módulo, formato,
 * status e área dona. Cards mostram metadata + placeholders extraídos pela
 * CF extractPlaceholders. Ações: visualizar arquivo (R2 público), arquivar.
 *
 * Upload de novo template + duplicação + atribuição a área virão em
 * v4.63.5+ (UI modal de upload).
 *
 * Permissão pra entrar: qualquer auth (perm `portal_areas_view` herdada
 * via sidebar). Ações de write (arquivar, em breve upload/duplicar):
 * requer `templates_manage` OR isMaster.
 */

import { store } from '../store.js';
import { toast } from '../components/toast.js';
import { modal } from '../components/modal.js';
import { renderPageHeader, renderFilterBar } from '../components/uiKit.js';
import {
  fetchTemplates, fetchTemplate, archiveTemplate, uploadTemplate as uploadTemplateService,
  renderTemplate as renderTemplateService, downloadBlob,
  duplicateTemplate as duplicateTemplateService,
  validateTemplateFile, formatFileSize,
  TEMPLATE_MODULES, TEMPLATE_FORMATS, MODULE_MAP, FORMAT_MAP, PLACEHOLDERS_SPEC, PLACEHOLDER_CATEGORIES,
} from '../services/templates.js';
import { fetchAreas } from '../services/portal.js';

/* ─── Estado local + listeners ──────────────────────────────────────── */
let _abortCtrl = null;
let _state = {
  all: [],
  areas: [],
  filtered: [],
  filters: {
    status: 'active',  // active | archived | all
    module: '',
    format: '',
    ownerId: '',       // '' = todas, 'global' = só globais, 'lazer'/'btg-partners'/... = área
    search: '',
  },
};

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
  }[c]));
}

function _canManage() {
  return !!(store.isMaster?.() || store.can?.('templates_manage'));
}

/* ─── Cards ─────────────────────────────────────────────────────────── */

function _renderCard(tpl, areas) {
  const mod = MODULE_MAP[tpl.module] || { label: tpl.module, icon: '📄' };
  const fmt = FORMAT_MAP[tpl.format] || { label: tpl.format };

  // Owner display
  let ownerLabel = '';
  if (tpl.ownerType === 'global') {
    ownerLabel = `<span style="color:var(--brand-blue,#3B82F6);font-weight:600;">🌐 Global</span>`;
  } else if (tpl.ownerType === 'area') {
    const area = areas.find(a => a.id === tpl.ownerId);
    ownerLabel = `<span title="Área dona">${_esc(area?.name || tpl.ownerId || '—')}</span>`;
  }

  // Placeholders summary
  const placeholders = tpl.placeholders || [];
  const placeholdersPreview = placeholders.slice(0, 5);
  const placeholdersExtra = placeholders.length - placeholdersPreview.length;
  const placeholdersHTML = placeholders.length
    ? `<div style="font-size:0.7rem;color:var(--text-secondary);margin-top:8px;">
         <strong>${placeholders.length}</strong> placeholders:
         ${placeholdersPreview.map(p => `<code style="background:var(--bg-surface);padding:1px 5px;border-radius:3px;margin:0 2px;font-size:0.7rem;">{{${_esc(p)}}}</code>`).join(' ')}
         ${placeholdersExtra > 0 ? `<span style="color:var(--text-muted);">+${placeholdersExtra}</span>` : ''}
       </div>`
    : tpl.placeholdersExtractionError
      ? `<div style="font-size:0.7rem;color:var(--color-danger,#EF4444);margin-top:8px;">⚠ Erro extração: ${_esc(tpl.placeholdersExtractionError).slice(0,80)}</div>`
      : `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:8px;font-style:italic;">⏳ Aguardando extração de placeholders…</div>`;

  // Status badge
  const statusBadge = tpl.status === 'archived'
    ? `<span style="background:var(--text-muted);color:#fff;font-size:0.65rem;padding:2px 8px;border-radius:999px;font-weight:600;">ARQUIVADO</span>`
    : '';

  // Default badge
  const defaultBadge = tpl.isDefault
    ? `<span style="background:var(--brand-gold,#D4A843);color:#0A1628;font-size:0.65rem;padding:2px 8px;border-radius:999px;font-weight:700;margin-left:6px;">DEFAULT</span>`
    : '';

  const canManage = _canManage();
  const isArchived = tpl.status === 'archived';

  return `
    <div class="tpl-card" data-tpl-id="${_esc(tpl.id)}" style="
      background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:8px;
      padding:16px;display:flex;flex-direction:column;gap:8px;
      opacity:${isArchived ? '0.7' : '1'};">
      <div style="display:flex;align-items:start;justify-content:space-between;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span style="font-size:0.7rem;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;">
              ${_esc(mod.icon)} ${_esc(mod.label)} · ${_esc(fmt.label)}
            </span>
            ${statusBadge}${defaultBadge}
          </div>
          <h3 style="font-size:0.95rem;font-weight:600;margin:4px 0 0;color:var(--text-primary);
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${_esc(tpl.name)}">
            ${_esc(tpl.name)}
          </h3>
        </div>
      </div>

      <div style="font-size:0.7rem;color:var(--text-muted);display:flex;gap:12px;flex-wrap:wrap;">
        <span>📦 ${formatFileSize(tpl.fileSize)}</span>
        <span>${ownerLabel}</span>
        ${tpl.version > 1 ? `<span>v${tpl.version}</span>` : ''}
      </div>

      ${placeholdersHTML}

      <div style="display:flex;gap:6px;margin-top:auto;padding-top:10px;border-top:1px solid var(--border-subtle);flex-wrap:wrap;">
        <a href="${_esc(tpl.fileUrl)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm"
          style="flex:1;text-align:center;text-decoration:none;font-size:0.75rem;min-width:90px;">
          🔗 Abrir
        </a>
        ${!isArchived ? `
          <button class="btn btn-primary btn-sm tpl-action-render" data-id="${_esc(tpl.id)}"
            style="font-size:0.75rem;flex:1;min-width:90px;" title="Renderizar com dados de teste + baixar arquivo">
            🧪 Testar ${tpl.format === 'html' ? 'PDF' : tpl.format.toUpperCase()}
          </button>
        ` : ''}
        ${canManage && !isArchived ? `
          <button class="btn btn-secondary btn-sm tpl-action-duplicate" data-id="${_esc(tpl.id)}"
            style="font-size:0.75rem;" title="Duplicar pra outra área">
            ⎘ Duplicar
          </button>
          <button class="btn btn-secondary btn-sm tpl-action-archive" data-id="${_esc(tpl.id)}"
            style="font-size:0.75rem;" title="Arquivar template">
            📦 Arquivar
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

/* ─── Filtros ───────────────────────────────────────────────────────── */

function _applyFilters() {
  const f = _state.filters;
  _state.filtered = _state.all.filter(t => {
    if (f.status !== 'all' && (t.status || 'active') !== f.status) return false;
    if (f.module && t.module !== f.module) return false;
    if (f.format && t.format !== f.format) return false;
    if (f.ownerId === 'global' && t.ownerType !== 'global') return false;
    // v4.63.26+ Fix A21: filtrar por área (ex: Lazer) DEVE incluir templates
    // globais — mesmo critério da tab Templates por Área (portalAreas.js:719+).
    // Sem isso, library mostra menos templates que o dropdown de atribuição
    // (drift confuso pro user).
    if (f.ownerId && f.ownerId !== 'global'
        && t.ownerId !== f.ownerId
        && t.ownerType !== 'global') return false;
    if (f.search) {
      const q = f.search.toLowerCase();
      const hay = `${t.name || ''} ${(t.placeholders || []).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function _renderResults(container) {
  const grid = container.querySelector('#tpl-grid');
  if (!grid) return;
  if (!_state.filtered.length) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:48px 16px;color:var(--text-muted);">
        <div style="font-size:2rem;margin-bottom:8px;">📐</div>
        <h3 style="font-size:1rem;margin:0 0 6px;color:var(--text-primary);">Nenhum template encontrado</h3>
        <p style="font-size:0.875rem;margin:0;">
          ${_state.all.length === 0
            ? 'Suba o primeiro template (em breve via modal).'
            : 'Ajuste os filtros pra ver outros templates.'}
        </p>
      </div>
    `;
  } else {
    grid.innerHTML = _state.filtered.map(t => _renderCard(t, _state.areas)).join('');
  }
  // Update count
  const countEl = container.querySelector('#tpl-count');
  if (countEl) {
    countEl.textContent = `${_state.filtered.length} de ${_state.all.length}`;
  }
}

/* ─── Main render ───────────────────────────────────────────────────── */

export async function renderTemplatesLibrary(container) {
  // v4.63.4+ AbortController pra cleanup de listeners em SPA (CLAUDE.md §11.k)
  if (_abortCtrl) _abortCtrl.abort();
  _abortCtrl = new AbortController();
  const signal = _abortCtrl.signal;

  const canManage = _canManage();

  // Header padrão uiKit (CLAUDE.md §4: respeitar padrão visual)
  const headerHTML = renderPageHeader({
    title: 'Biblioteca de Templates',
    subtitle: 'Templates de exportação (HTML / DOCX / PPTX) aplicáveis às áreas — Cotações · Portal · Banco',
    primary: canManage ? {
      label: 'Subir template',
      action: 'upload-template',
      icon: '+',
    } : null,
    secondary: [
      { label: '📖 Manual', action: 'open-manual', title: 'Dicionário de placeholders + guia de autoria' },
    ],
  });

  container.innerHTML = `
    <div class="page-content" style="padding:24px;max-width:1400px;margin:0 auto;">
      ${headerHTML}

      <div id="tpl-filter-zone" style="margin:16px 0;"></div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="font-size:0.8125rem;color:var(--text-secondary);">
          <strong id="tpl-count">—</strong> templates
        </div>
        <button class="btn btn-ghost btn-sm" id="tpl-btn-clear" style="font-size:0.75rem;">
          Limpar filtros
        </button>
      </div>

      <div id="tpl-grid" style="
        display:grid;
        grid-template-columns:repeat(auto-fill, minmax(320px, 1fr));
        gap:16px;
      ">
        <div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--text-muted);">
          ⏳ Carregando templates…
        </div>
      </div>
    </div>
  `;

  // Wire header button (delegação porque uiKit usa data-action)
  const headerEl = container.querySelector('.uikit-page-header');
  if (headerEl) {
    headerEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="upload-template"]')) _openUploadModal(container);
      if (e.target.closest('[data-action="open-manual"]')) _openManualModal();
    }, { signal });
  }

  // Fetch dados
  try {
    const [tpls, areas] = await Promise.all([
      fetchTemplates({ status: 'all' }), // pegamos todos, filtramos client-side por status
      fetchAreas().catch(() => []),
    ]);
    _state.all = tpls;
    _state.areas = areas;
  } catch (e) {
    toast.error('Erro ao carregar templates: ' + e.message);
    return;
  }

  // Render filter bar
  const filterZone = container.querySelector('#tpl-filter-zone');
  _renderFilters(filterZone, signal);

  // Apply + render
  _applyFilters();
  _renderResults(container);

  // Wire ações nos cards (delegação no grid pra evitar leak)
  const grid = container.querySelector('#tpl-grid');
  grid.addEventListener('click', async (e) => {
    // v4.63.6+ Testar render HTML→PDF via Puppeteer
    const renderBtn = e.target.closest('.tpl-action-render');
    if (renderBtn) {
      e.preventDefault();
      const id = renderBtn.dataset.id;
      const tpl = _state.all.find(t => t.id === id);
      if (!tpl) return;
      _openTestRenderModal(tpl, container);
      return;
    }

    // v4.63.9+ Duplicar template pra outra área
    const dupBtn = e.target.closest('.tpl-action-duplicate');
    if (dupBtn) {
      e.preventDefault();
      const id = dupBtn.dataset.id;
      const tpl = _state.all.find(t => t.id === id);
      if (!tpl) return;
      _openDuplicateModal(tpl, container);
      return;
    }

    const archiveBtn = e.target.closest('.tpl-action-archive');
    if (archiveBtn) {
      e.preventDefault();
      const id = archiveBtn.dataset.id;
      const tpl = _state.all.find(t => t.id === id);
      if (!tpl) return;
      const ok = await modal.confirm({
        title: 'Arquivar template?',
        message: `O template "${tpl.name}" ficará oculto da lista padrão. Áreas que já usam continuam funcionando até v4.63.8 (integração editor).`,
        confirmText: 'Arquivar',
        danger: true,
      }).catch(() => false);
      if (!ok) return;
      try {
        await archiveTemplate(id);
        // Update local + re-render
        tpl.status = 'archived';
        _applyFilters();
        _renderResults(container);
        toast.success(`Template "${tpl.name}" arquivado`);
      } catch (err) {
        toast.error('Erro ao arquivar: ' + err.message);
      }
    }
  }, { signal });

  // Wire limpar filtros
  const clearBtn = container.querySelector('#tpl-btn-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      _state.filters = { status: 'active', module: '', format: '', ownerId: '', search: '' };
      _renderFilters(container.querySelector('#tpl-filter-zone'), signal);
      _applyFilters();
      _renderResults(container);
    }, { signal });
  }
}

function _renderFilters(filterZone, signal) {
  if (!filterZone) return;
  const f = _state.filters;

  // Counts por status pra pills
  const countActive = _state.all.filter(t => (t.status || 'active') === 'active').length;
  const countArchived = _state.all.filter(t => t.status === 'archived').length;

  // Áreas pro select (única lista, +global)
  const areaOptions = [
    { value: 'global', label: '🌐 Globais' },
    ..._state.areas.map(a => ({ value: a.id, label: a.name })),
  ];

  const filterBarHTML = renderFilterBar({
    statusPills: [
      { value: 'active',   label: 'Ativos',     count: countActive },
      { value: 'archived', label: 'Arquivados', count: countArchived },
      { value: 'all',      label: 'Todos',      count: _state.all.length },
    ],
    activeStatus: f.status,
    search: {
      id: 'tpl-search',
      value: f.search,
      placeholder: 'Buscar por nome ou placeholder…',
    },
    selects: [
      { id: 'tpl-filter-module', label: 'Módulo',  value: f.module,
        options: TEMPLATE_MODULES.map(m => ({ value: m.id, label: `${m.icon} ${m.label}` })) },
      { id: 'tpl-filter-format', label: 'Formato', value: f.format,
        options: TEMPLATE_FORMATS.map(x => ({ value: x.id, label: x.label })) },
      { id: 'tpl-filter-owner',  label: 'Área',    value: f.ownerId,
        options: areaOptions },
    ],
  });

  filterZone.innerHTML = filterBarHTML;

  // Wire listeners (uiKit usa data-filter-status nas pills + ids customizados)
  filterZone.querySelectorAll('.uikit-status-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const val = pill.dataset.filterStatus;
      _state.filters.status = val;
      _renderFilters(filterZone, signal); // re-render pills com novo active
      _applyFilters();
      _renderResults(filterZone.closest('.page-content') || document.querySelector('#content') || document.body);
    }, { signal });
  });

  const searchEl = filterZone.querySelector('#tpl-search');
  if (searchEl) {
    let t;
    searchEl.addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        _state.filters.search = e.target.value;
        _applyFilters();
        _renderResults(filterZone.closest('.page-content') || document.querySelector('#content') || document.body);
      }, 220);
    }, { signal });
  }

  ['module', 'format', 'owner'].forEach(k => {
    const sel = filterZone.querySelector(`#tpl-filter-${k}`);
    if (sel) {
      // Set value (renderFilterBar pode não inicializar)
      sel.value = (k === 'owner') ? f.ownerId : f[k];
      sel.addEventListener('change', () => {
        if (k === 'owner') _state.filters.ownerId = sel.value;
        else _state.filters[k] = sel.value;
        _applyFilters();
        _renderResults(filterZone.closest('.page-content') || document.querySelector('#content') || document.body);
      }, { signal });
    }
  });
}

/* ─── Duplicate modal (v4.63.9+ duplicar pra outra área) ────────────── */

function _openDuplicateModal(tpl, container) {
  const sourceOwnerLabel = tpl.ownerType === 'global'
    ? '🌐 Global'
    : (_state.areas.find(a => a.id === tpl.ownerId)?.name || tpl.ownerId || '—');

  // Áreas elegíveis (exclui owner atual)
  const eligibleAreas = _state.areas.filter(a => !(tpl.ownerType === 'area' && a.id === tpl.ownerId));
  const allowGlobal = tpl.ownerType !== 'global';

  const html = `
    <div id="tpl-dup-overlay" style="
      position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;
      display:flex;align-items:center;justify-content:center;padding:24px;overflow-y:auto;">
      <div style="background:var(--bg-card);border-radius:10px;padding:24px;
        max-width:520px;width:100%;box-shadow:0 24px 48px rgba(0,0,0,0.35);">

        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <h2 style="font-size:1.125rem;margin:0;color:var(--text-primary);">⎘ Duplicar template</h2>
          <button id="dp-x" style="background:none;border:none;font-size:1.25rem;
            color:var(--text-muted);cursor:pointer;padding:4px 8px;line-height:1;">×</button>
        </div>
        <p style="font-size:0.8125rem;color:var(--text-muted);margin:0 0 16px;">
          Origem: <strong>${_esc(tpl.name)}</strong> · ${_esc(tpl.module)} · ${_esc(tpl.format)}
          <br/>Owner atual: ${_esc(sourceOwnerLabel)}
        </p>

        <div style="display:grid;gap:12px;font-size:0.8125rem;">
          <label>
            <span style="display:block;color:var(--text-secondary);margin-bottom:4px;font-weight:500;">Novo nome (opcional)</span>
            <input id="dp-name" class="form-input" type="text" maxlength="120"
              placeholder="${_esc(tpl.name)} (cópia)" style="width:100%;" />
          </label>

          <label>
            <span style="display:block;color:var(--text-secondary);margin-bottom:4px;font-weight:500;">Atribuir a</span>
            <select id="dp-target" class="form-input" style="width:100%;">
              ${allowGlobal ? '<option value="global">🌐 Global (todas as áreas)</option>' : ''}
              ${eligibleAreas.map(a => `<option value="${_esc(a.id)}">${_esc(a.name)}</option>`).join('')}
            </select>
            <span style="display:block;font-size:0.7rem;color:var(--text-muted);margin-top:3px;">
              Arquivo é copiado pra novo path no R2 — alterações no original não afetam a cópia.
            </span>
          </label>

          <label style="display:flex;align-items:center;gap:8px;font-size:0.8125rem;">
            <input id="dp-default" type="checkbox" style="width:14px;height:14px;accent-color:var(--brand-gold,#D4A843);">
            <span>Marcar como template default da área destino</span>
          </label>
        </div>

        <div id="dp-msg" style="font-size:0.7rem;color:var(--text-muted);margin-top:10px;min-height:18px;"></div>

        <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;">
          <button class="btn btn-secondary" id="dp-cancel">Cancelar</button>
          <button class="btn btn-primary" id="dp-submit">⎘ Duplicar</button>
        </div>
      </div>
    </div>
  `;

  const overlay = document.createElement('div');
  overlay.innerHTML = html;
  document.body.appendChild(overlay.firstElementChild);

  const close = () => document.getElementById('tpl-dup-overlay')?.remove();
  document.getElementById('dp-x')?.addEventListener('click', close);
  document.getElementById('dp-cancel')?.addEventListener('click', close);
  document.getElementById('tpl-dup-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'tpl-dup-overlay') close();
  });
  const keyHandler = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', keyHandler);
  const observer = new MutationObserver(() => {
    if (!document.getElementById('tpl-dup-overlay')) {
      document.removeEventListener('keydown', keyHandler);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });

  const submitBtn = document.getElementById('dp-submit');
  submitBtn?.addEventListener('click', async () => {
    const newName = document.getElementById('dp-name')?.value?.trim();
    const target = document.getElementById('dp-target')?.value;
    const isDefault = document.getElementById('dp-default')?.checked;
    const msgEl = document.getElementById('dp-msg');

    if (!target) { toast.error('Selecione área destino'); return; }

    submitBtn.disabled = true; submitBtn.textContent = 'Duplicando…';
    msgEl.textContent = '⏳ Copiando arquivo R2 + criando doc…';
    msgEl.style.color = 'var(--text-muted)';

    try {
      const targetOwnerType = target === 'global' ? 'global' : 'area';
      const targetOwnerId = target === 'global' ? null : target;
      const result = await duplicateTemplateService(tpl.id, {
        targetOwnerType, targetOwnerId, newName, isDefault,
      });
      toast.success(`Cópia criada: "${result.name}"`);
      close();
      await renderTemplatesLibrary(container);
    } catch (e) {
      const err = String(e?.message || e).slice(0, 200);
      msgEl.textContent = `⚠ Falhou: ${err}`;
      msgEl.style.color = 'var(--color-danger,#EF4444)';
      submitBtn.disabled = false; submitBtn.textContent = '⎘ Duplicar';
    }
  });
}

/* ─── Test render modal (v4.63.6+ HTML→PDF via Puppeteer) ──────────── */

/**
 * Gera objeto de dados de exemplo cobrindo a maioria dos placeholders
 * conhecidos (PLACEHOLDERS_SPEC). Permite "teste rápido" sem o user
 * digitar JSON.
 */
function _sampleData(moduleKey) {
  const today = new Date().toLocaleDateString('pt-BR');
  if (moduleKey === 'cotacoes') {
    return {
      cliente: { nome: 'João da Silva', adults: 2, children: 1 },
      viagem: {
        dataInicio: '12/06/2026', dataFim: '22/06/2026', noites: 10,
        destinos: 'Paris · Roma · Veneza',
      },
      area: { nome: 'Lazer · PRIMETOUR', logoUrl: '' },
      dias: [
        { numero: 1, cidade: 'Paris',   narrativa: 'Chegada + city tour panorâmico.', atividades: ['Check-in', 'Jantar bistrô'] },
        { numero: 2, cidade: 'Paris',   narrativa: 'Louvre + Torre Eiffel.', atividades: ['Museu', 'Sunset'] },
        { numero: 3, cidade: 'Roma',    narrativa: 'TGV pra Roma. Coliseu à tarde.', atividades: ['Trem', 'Coliseu'] },
        { numero: 4, cidade: 'Veneza',  narrativa: 'Gôndolas + Piazza San Marco.', atividades: ['Gondola', 'Café'] },
      ],
      hoteis: [
        { cidade: 'Paris', nome: 'Le Bristol' },
        { cidade: 'Roma',  nome: 'Hassler Roma' },
      ],
      voos: [
        { rota: 'GRU → CDG', cia: 'Air France' },
        { rota: 'VCE → GRU', cia: 'LATAM' },
      ],
      precos: { totalCasal: 'R$ 32.500', porPessoa: 'R$ 16.250', moeda: 'BRL' },
      inclui:    ['Hotéis 5★', 'Café da manhã', 'Trens 1ª classe'],
      naoInclui: ['Voos internacionais', 'Almoços', 'Despesas pessoais'],
      today,
    };
  }
  if (moduleKey === 'portal') {
    return {
      area: { nome: 'Lazer · PRIMETOUR' },
      destinos: [
        { cidade: 'Tóquio', pais: 'Japão',  tips: ['Comer em Tsukiji', 'Bairro Shibuya à noite'] },
        { cidade: 'Quioto', pais: 'Japão',  tips: ['Templo Kinkaku-ji', 'Ryokan tradicional'] },
      ],
      segments: ['Gastronomia', 'Hotéis', 'Atrações'],
      today,
    };
  }
  return {
    titulo: 'Roteiro exemplo',
    destinos: 'Lima · Cusco · Machu Picchu',
    noites: 7,
    dias: [{ cidade: 'Lima', narrativa: 'Tour gastronômico.' }],
    area: { nome: 'Operadora' },
    today,
  };
}

function _openTestRenderModal(tpl, container) {
  const sample = _sampleData(tpl.module);
  const sampleJson = JSON.stringify(sample, null, 2);

  const html = `
    <div id="tpl-render-overlay" style="
      position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;
      display:flex;align-items:center;justify-content:center;padding:24px;overflow-y:auto;">
      <div style="background:var(--bg-card);border-radius:10px;padding:24px;
        max-width:680px;width:100%;box-shadow:0 24px 48px rgba(0,0,0,0.35);">

        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <h2 style="font-size:1.125rem;margin:0;color:var(--text-primary);">🧪 Testar render → PDF</h2>
          <button id="rd-x" aria-label="Fechar" style="background:none;border:none;font-size:1.25rem;
            color:var(--text-muted);cursor:pointer;padding:4px 8px;line-height:1;">×</button>
        </div>
        <p style="font-size:0.8125rem;color:var(--text-muted);margin:0 0 14px;">
          Template: <strong>${_esc(tpl.name)}</strong> · ${_esc(tpl.module)} · ${_esc(tpl.format)}
          <br/>Edite o JSON de dados se quiser. Submit → Puppeteer renderiza + baixa PDF.
        </p>

        <label style="display:block;font-size:0.8125rem;color:var(--text-secondary);margin-bottom:4px;font-weight:500;">
          Dados (JSON)
        </label>
        <textarea id="rd-json" spellcheck="false"
          style="width:100%;min-height:280px;font-family:monospace;font-size:0.75rem;
          padding:10px;border:1px solid var(--border-subtle);border-radius:6px;
          background:var(--bg-surface);color:var(--text-primary);resize:vertical;">${_esc(sampleJson)}</textarea>
        <div id="rd-msg" style="font-size:0.7rem;color:var(--text-muted);margin-top:6px;min-height:18px;"></div>

        <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;align-items:center;">
          <button class="btn btn-secondary" id="rd-cancel">Cancelar</button>
          <button class="btn btn-primary" id="rd-submit">📄 Gerar PDF</button>
        </div>
      </div>
    </div>
  `;

  const overlay = document.createElement('div');
  overlay.innerHTML = html;
  document.body.appendChild(overlay.firstElementChild);

  const close = () => document.getElementById('tpl-render-overlay')?.remove();
  document.getElementById('rd-x')?.addEventListener('click', close);
  document.getElementById('rd-cancel')?.addEventListener('click', close);
  document.getElementById('tpl-render-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'tpl-render-overlay') close();
  });
  const keyHandler = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', keyHandler);
  const observer = new MutationObserver(() => {
    if (!document.getElementById('tpl-render-overlay')) {
      document.removeEventListener('keydown', keyHandler);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });

  const submitBtn = document.getElementById('rd-submit');
  submitBtn?.addEventListener('click', async () => {
    const jsonEl = document.getElementById('rd-json');
    const msgEl = document.getElementById('rd-msg');
    let data;
    try {
      data = JSON.parse(jsonEl.value);
    } catch (e) {
      msgEl.textContent = `⚠ JSON inválido: ${e.message}`;
      msgEl.style.color = 'var(--color-danger,#EF4444)';
      return;
    }
    submitBtn.disabled = true; submitBtn.textContent = 'Renderizando…';
    msgEl.textContent = '⏳ CF rodando Puppeteer (cold start ~5s primeira vez)…';
    msgEl.style.color = 'var(--text-muted)';
    try {
      const t0 = Date.now();
      const result = await renderTemplateService(tpl.id, data);
      const ms = Date.now() - t0;
      downloadBlob(result.blob, result.filename);
      msgEl.textContent = `✓ PDF gerado em ${ms}ms · ${(result.sizeBytes/1024).toFixed(1)} KB · download disparado`;
      msgEl.style.color = 'var(--color-success,#10B981)';
      submitBtn.textContent = '✓ Gerado';
      setTimeout(close, 1500);
    } catch (e) {
      const err = String(e?.message || e).slice(0, 200);
      msgEl.textContent = `⚠ Falhou: ${err}`;
      msgEl.style.color = 'var(--color-danger,#EF4444)';
      submitBtn.disabled = false; submitBtn.textContent = '📄 Gerar PDF';
    }
  });
}

/* ─── Upload modal (v4.63.5+ drag-drop + preview placeholders + spec) ── */

/**
 * Extrai placeholders Handlebars de texto plano (HTML).
 * Espelha CF extractPlaceholders (functions/index.js) — manter sincronizado.
 * DOCX/PPTX só dão pra parsear server-side (precisaria pizzip no browser);
 * a partir desses, preview client-side mostra "extração roda no servidor".
 */
function _previewHandlebars(text) {
  if (!text) return [];
  const re = /\{\{\s*(?:#(?:each|if|unless|with)\s+)?([a-zA-Z_][\w.[\]\-]*)\s*[}~]/g;
  const found = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    const p = m[1];
    if (!p || p.startsWith('@') || p === 'this') continue;
    found.add(p);
  }
  return [...found].sort();
}

function _openUploadModal(container) {
  // Estado interno do modal
  const _modal = {
    selectedFile: null,
    detectedPlaceholders: [],
    detectedError: null,
    selectedModule: TEMPLATE_MODULES[0]?.id || 'cotacoes',
    selectedFormat: TEMPLATE_FORMATS[0]?.id || 'html',
  };

  const html = `
    <div id="tpl-upload-overlay" style="
      position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;
      display:flex;align-items:center;justify-content:center;padding:24px;overflow-y:auto;">
      <div style="background:var(--bg-card);border-radius:10px;padding:24px;
        max-width:720px;width:100%;box-shadow:0 24px 48px rgba(0,0,0,0.35);">

        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <h2 style="font-size:1.125rem;margin:0;color:var(--text-primary);">📤 Subir template</h2>
          <button id="up-x" aria-label="Fechar" style="background:none;border:none;font-size:1.25rem;
            color:var(--text-muted);cursor:pointer;padding:4px 8px;line-height:1;">×</button>
        </div>
        <p style="font-size:0.8125rem;color:var(--text-muted);margin:0 0 18px;">
          HTML serve PDF + Web link · DOCX e PPTX renderizam Word/PowerPoint nativos.
          Use <code>{{placeholders}}</code> Handlebars no template.
        </p>

        <div style="display:grid;grid-template-columns:1fr 280px;gap:18px;">

          <!-- Form -->
          <div style="display:grid;gap:12px;font-size:0.8125rem;">
            <label>
              <span style="display:block;color:var(--text-secondary);margin-bottom:4px;font-weight:500;">Nome</span>
              <input id="up-name" class="form-input" type="text" maxlength="120"
                placeholder="Ex: BTG Cotação Padrão Q1 2026" style="width:100%;" />
              <span id="up-name-counter" style="display:block;font-size:0.65rem;color:var(--text-muted);margin-top:3px;text-align:right;">0/120</span>
            </label>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <label>
                <span style="display:block;color:var(--text-secondary);margin-bottom:4px;font-weight:500;">Módulo</span>
                <select id="up-module" class="form-input" style="width:100%;">
                  ${TEMPLATE_MODULES.map(m => `<option value="${m.id}">${m.icon} ${m.label}</option>`).join('')}
                </select>
              </label>
              <label>
                <span style="display:block;color:var(--text-secondary);margin-bottom:4px;font-weight:500;">Formato</span>
                <select id="up-format" class="form-input" style="width:100%;">
                  ${TEMPLATE_FORMATS.map(x => `<option value="${x.id}">${x.label}</option>`).join('')}
                </select>
              </label>
            </div>

            <label>
              <span style="display:block;color:var(--text-secondary);margin-bottom:4px;font-weight:500;">Área dona</span>
              <select id="up-owner" class="form-input" style="width:100%;">
                <option value="global">🌐 Global (todas as áreas podem usar)</option>
                ${_state.areas.map(a => `<option value="${a.id}">${_esc(a.name)}</option>`).join('')}
              </select>
            </label>

            <!-- Drop zone -->
            <div>
              <span style="display:block;color:var(--text-secondary);margin-bottom:4px;font-weight:500;font-size:0.8125rem;">Arquivo</span>
              <div id="up-dropzone" style="
                border:2px dashed var(--border-subtle);border-radius:8px;
                padding:24px 16px;text-align:center;background:var(--bg-surface);
                cursor:pointer;transition:all 0.15s;">
                <div id="up-dropzone-idle" style="display:block;">
                  <div style="font-size:1.5rem;margin-bottom:6px;">📁</div>
                  <div style="font-size:0.8125rem;color:var(--text-secondary);font-weight:500;">
                    Arraste o arquivo aqui ou <span style="color:var(--brand-blue,#3B82F6);text-decoration:underline;">clique pra escolher</span>
                  </div>
                  <div style="font-size:0.7rem;color:var(--text-muted);margin-top:6px;">
                    HTML ≤5MB · DOCX ≤10MB · PPTX ≤15MB
                  </div>
                </div>
                <div id="up-dropzone-file" style="display:none;">
                  <div style="font-size:0.875rem;font-weight:600;color:var(--text-primary);" id="up-file-name">—</div>
                  <div style="font-size:0.7rem;color:var(--text-muted);margin-top:3px;" id="up-file-meta">—</div>
                  <button id="up-file-clear" style="background:none;border:none;color:var(--brand-blue,#3B82F6);
                    font-size:0.7rem;cursor:pointer;margin-top:6px;text-decoration:underline;">
                    Trocar arquivo
                  </button>
                </div>
                <input id="up-file" type="file" accept=".html,.htm,.docx,.pptx" style="display:none;" />
              </div>
            </div>
          </div>

          <!-- Sidebar: spec de placeholders -->
          <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:8px;
            padding:14px;font-size:0.75rem;max-height:480px;overflow-y:auto;">
            <h4 style="margin:0 0 8px;font-size:0.8125rem;color:var(--text-primary);">
              📚 Variáveis disponíveis
            </h4>
            <p style="font-size:0.7rem;color:var(--text-muted);margin:0 0 12px;line-height:1.4;">
              Use no template como <code>{{var.path}}</code>. Lista varia por módulo.
            </p>
            <div id="up-spec-list"></div>
          </div>
        </div>

        <!-- Preview de placeholders detectados -->
        <div id="up-preview" style="margin-top:16px;display:none;
          background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:8px;padding:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <h4 style="margin:0;font-size:0.8125rem;color:var(--text-primary);">
              🔍 Placeholders detectados no arquivo
            </h4>
            <span id="up-preview-count" style="font-size:0.7rem;color:var(--text-muted);"></span>
          </div>
          <div id="up-preview-list" style="display:flex;flex-wrap:wrap;gap:6px;"></div>
          <p id="up-preview-msg" style="margin:8px 0 0;font-size:0.7rem;color:var(--text-muted);"></p>
        </div>

        <div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end;align-items:center;">
          <span id="up-submit-hint" style="font-size:0.7rem;color:var(--text-muted);"></span>
          <button class="btn btn-secondary" id="up-cancel">Cancelar</button>
          <button class="btn btn-primary" id="up-submit">Subir template</button>
        </div>
      </div>
    </div>
  `;

  const overlay = document.createElement('div');
  overlay.innerHTML = html;
  document.body.appendChild(overlay.firstElementChild);

  const close = () => {
    document.getElementById('tpl-upload-overlay')?.remove();
  };

  // Esc fecha (CLAUDE.md §11.k overlay handler — listener removido junto com modal)
  const keyHandler = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', keyHandler);
  const observer = new MutationObserver(() => {
    if (!document.getElementById('tpl-upload-overlay')) {
      document.removeEventListener('keydown', keyHandler);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });

  // Fechar via X / cancel / clique fora
  document.getElementById('up-x')?.addEventListener('click', close);
  document.getElementById('up-cancel')?.addEventListener('click', close);
  document.getElementById('tpl-upload-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'tpl-upload-overlay') close();
  });

  const nameEl   = document.getElementById('up-name');
  const moduleEl = document.getElementById('up-module');
  const formatEl = document.getElementById('up-format');
  const ownerEl  = document.getElementById('up-owner');
  const fileEl   = document.getElementById('up-file');
  const dropZone = document.getElementById('up-dropzone');
  const submitBtn = document.getElementById('up-submit');

  // Counter nome
  const nameCounter = document.getElementById('up-name-counter');
  nameEl?.addEventListener('input', () => {
    const len = (nameEl.value || '').length;
    nameCounter.textContent = `${len}/120`;
    nameCounter.style.color = len > 110 ? 'var(--color-danger,#EF4444)' : 'var(--text-muted)';
  });

  // Spec sidebar — re-render quando módulo muda
  const renderSpec = () => {
    const mod = moduleEl?.value || _modal.selectedModule;
    const spec = PLACEHOLDERS_SPEC[mod] || [];
    const list = document.getElementById('up-spec-list');
    if (!list) return;
    list.innerHTML = spec.map(s => `
      <div style="margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid var(--border-subtle);">
        <code style="font-size:0.7rem;color:var(--brand-blue,#3B82F6);font-weight:600;">{{${_esc(s.key)}}}</code>
        <div style="font-size:0.65rem;color:var(--text-muted);margin-top:2px;line-height:1.3;">${_esc(s.desc)}</div>
      </div>
    `).join('') || `<p style="font-size:0.7rem;color:var(--text-muted);">Sem spec disponível pra esse módulo.</p>`;
    _modal.selectedModule = mod;
    _updatePreviewBadges();
  };
  renderSpec();
  moduleEl?.addEventListener('change', renderSpec);

  formatEl?.addEventListener('change', () => {
    _modal.selectedFormat = formatEl.value;
    // Re-validar se já tem arquivo
    if (_modal.selectedFile) handleFile(_modal.selectedFile);
  });

  // Drag-drop visual
  dropZone?.addEventListener('click', (e) => {
    if (e.target.id === 'up-file-clear') return;
    fileEl?.click();
  });
  ['dragenter', 'dragover'].forEach(ev => {
    dropZone?.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--brand-blue,#3B82F6)';
      dropZone.style.background = 'rgba(59,130,246,0.08)';
    });
  });
  ['dragleave', 'drop'].forEach(ev => {
    dropZone?.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--border-subtle)';
      dropZone.style.background = 'var(--bg-surface)';
    });
  });
  dropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) {
      // Define no input pra mesmo handler
      const dt = new DataTransfer();
      dt.items.add(f);
      fileEl.files = dt.files;
      handleFile(f);
    }
  });

  fileEl?.addEventListener('change', () => {
    const f = fileEl.files?.[0];
    if (f) handleFile(f);
  });

  document.getElementById('up-file-clear')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _modal.selectedFile = null;
    _modal.detectedPlaceholders = [];
    _modal.detectedError = null;
    fileEl.value = '';
    document.getElementById('up-dropzone-idle').style.display = 'block';
    document.getElementById('up-dropzone-file').style.display = 'none';
    document.getElementById('up-preview').style.display = 'none';
  });

  async function handleFile(file) {
    _modal.selectedFile = file;
    document.getElementById('up-dropzone-idle').style.display = 'none';
    document.getElementById('up-dropzone-file').style.display = 'block';
    document.getElementById('up-file-name').textContent = file.name;
    document.getElementById('up-file-meta').textContent =
      `${formatFileSize(file.size)} · ${file.type || 'tipo desconhecido'}`;

    // Auto-detect formato pela extensão
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    let autoFormat = null;
    for (const f of TEMPLATE_FORMATS) {
      if (f.ext.includes(ext)) { autoFormat = f.id; break; }
    }
    if (autoFormat && formatEl.value !== autoFormat) {
      formatEl.value = autoFormat;
      _modal.selectedFormat = autoFormat;
    }

    // Validate
    const valid = validateTemplateFile(file, formatEl.value);
    const previewEl = document.getElementById('up-preview');
    const previewList = document.getElementById('up-preview-list');
    const previewMsg = document.getElementById('up-preview-msg');
    const previewCount = document.getElementById('up-preview-count');

    if (!valid.ok) {
      previewEl.style.display = 'block';
      previewList.innerHTML = '';
      previewMsg.textContent = `⚠ ${valid.error}`;
      previewMsg.style.color = 'var(--color-danger,#EF4444)';
      previewCount.textContent = '';
      return;
    }

    // Extract placeholders (HTML client-side, DOCX/PPTX deferido pro servidor)
    if (formatEl.value === 'html') {
      try {
        const text = await file.text();
        _modal.detectedPlaceholders = _previewHandlebars(text);
        _modal.detectedError = null;
        previewEl.style.display = 'block';
        _renderDetected();
      } catch (e) {
        _modal.detectedError = e.message;
        previewMsg.textContent = `⚠ Erro lendo arquivo: ${e.message}`;
        previewMsg.style.color = 'var(--color-danger,#EF4444)';
      }
    } else {
      // DOCX/PPTX são ZIPs — parse só no servidor
      _modal.detectedPlaceholders = [];
      previewEl.style.display = 'block';
      previewList.innerHTML = '';
      previewMsg.textContent = `ℹ Extração de placeholders pra ${formatEl.value.toUpperCase()} acontece no servidor após upload.`;
      previewMsg.style.color = 'var(--text-muted)';
      previewCount.textContent = '';
    }
  }

  function _renderDetected() {
    const previewList = document.getElementById('up-preview-list');
    const previewMsg = document.getElementById('up-preview-msg');
    const previewCount = document.getElementById('up-preview-count');
    const detected = _modal.detectedPlaceholders;
    if (!detected.length) {
      previewList.innerHTML = '';
      previewMsg.textContent = '⚠ Nenhum placeholder Handlebars detectado. Template gerará output estático.';
      previewMsg.style.color = 'var(--color-warning,#F59E0B)';
      previewCount.textContent = '0';
      return;
    }
    previewCount.textContent = `${detected.length} encontrados`;
    _updatePreviewBadges();
  }

  function _updatePreviewBadges() {
    const previewList = document.getElementById('up-preview-list');
    const previewMsg = document.getElementById('up-preview-msg');
    if (!previewList || !_modal.detectedPlaceholders.length) return;
    const spec = PLACEHOLDERS_SPEC[_modal.selectedModule] || [];
    const specKeys = new Set(spec.map(s => s.key.replace(/\.\[i\]\./g, '.').replace(/\[i\]/g, '')));
    // Normalize: remove índices [N] pra match
    const normalize = (k) => k.replace(/\[\d+\]/g, '').replace(/\.\d+\./g, '.');

    let unknown = 0;
    previewList.innerHTML = _modal.detectedPlaceholders.map(p => {
      const norm = normalize(p);
      const recognized = specKeys.has(p) || specKeys.has(norm)
        || [...specKeys].some(k => norm.startsWith(k + '.') || k.startsWith(norm + '.'));
      if (!recognized) unknown++;
      const color = recognized ? 'var(--color-success,#10B981)' : 'var(--color-warning,#F59E0B)';
      const bg = recognized ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)';
      return `<span style="
        display:inline-flex;align-items:center;gap:4px;
        background:${bg};color:${color};
        font-size:0.7rem;font-weight:500;padding:3px 8px;border-radius:999px;
        font-family:monospace;" title="${recognized ? 'Reconhecido na spec' : 'Não reconhecido — verifique nome ou adicione na spec'}">
        ${recognized ? '✓' : '⚠'} ${_esc(p)}
      </span>`;
    }).join('');

    const previewMsgEl = document.getElementById('up-preview-msg');
    if (previewMsgEl) {
      if (unknown > 0) {
        previewMsgEl.textContent = `⚠ ${unknown} placeholder(s) não reconhecido(s) na spec do módulo ${_modal.selectedModule}. Verifique se o nome está correto.`;
        previewMsgEl.style.color = 'var(--color-warning,#F59E0B)';
      } else {
        previewMsgEl.textContent = `✓ Todos os ${_modal.detectedPlaceholders.length} placeholders batem com a spec do módulo.`;
        previewMsgEl.style.color = 'var(--color-success,#10B981)';
      }
    }
  }

  // Submit
  submitBtn?.addEventListener('click', async () => {
    const name = nameEl?.value?.trim();
    const module = moduleEl?.value;
    const format = formatEl?.value;
    const ownerVal = ownerEl?.value;
    const file = _modal.selectedFile;

    if (!name) { toast.error('Nome obrigatório'); return; }
    if (!file) { toast.error('Selecione um arquivo'); return; }

    const valid = validateTemplateFile(file, format);
    if (!valid.ok) { toast.error(valid.error); return; }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Subindo…'; }
    const hintEl = document.getElementById('up-submit-hint');
    if (hintEl) hintEl.textContent = 'Validando + enviando pro R2…';

    try {
      const result = await uploadTemplateService(file, {
        name, module, format,
        ownerType: ownerVal === 'global' ? 'global' : 'area',
        ownerId:   ownerVal === 'global' ? null     : ownerVal,
      });
      toast.success(`Template "${name}" criado. Extração de placeholders rodando em background (~3s).`);
      close();
      await renderTemplatesLibrary(container);
    } catch (e) {
      toast.error('Erro: ' + (e.message || e));
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Subir template'; }
      if (hintEl) hintEl.textContent = '';
    }
  });
}

/* ─── Manual de Templates modal (v4.63.20+) ─────────────────────────── */

const GUIDE_URL = 'https://github.com/primetour/tarefas/blob/main/docs/TEMPLATES-AUTHORING-GUIDE.md';

function _openManualModal() {
  // Modal full-width com tabs por módulo + categorias + tabela placeholders
  const wrap = document.createElement('div');
  wrap.className = 'tpl-modal-overlay';
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;';
  wrap.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:1100px;width:96%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.25);">
      <div style="padding:18px 24px;border-bottom:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
        <div>
          <h2 style="margin:0;font-size:1.125rem;font-weight:700;color:var(--text-primary);">📖 Manual de Templates</h2>
          <p style="margin:3px 0 0;font-size:0.75rem;color:var(--text-secondary);">Dicionário de placeholders + orientações HTML/CSS/DOCX/PPTX pra construir templates customizados</p>
        </div>
        <button class="btn btn-ghost btn-sm" id="man-close" style="font-size:1.1rem;">✕</button>
      </div>

      <div style="padding:12px 24px;border-bottom:1px solid var(--border-subtle);display:flex;gap:12px;flex-wrap:wrap;align-items:center;flex-shrink:0;background:var(--bg-surface,#FAFAF7);">
        <span style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;">Módulo:</span>
        <div id="man-tabs" style="display:flex;gap:6px;flex-wrap:wrap;">
          ${TEMPLATE_MODULES.map(m => `<button class="btn btn-sm man-tab" data-mod="${_esc(m.id)}" style="padding:4px 10px;font-size:0.75rem;">${m.icon} ${_esc(m.label)}</button>`).join('')}
        </div>
        <a href="${GUIDE_URL}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="margin-left:auto;font-size:0.7rem;">↗ Guia completo no GitHub</a>
      </div>

      <div id="man-content" style="overflow-y:auto;padding:18px 24px;flex:1;">
        <p style="font-size:0.8125rem;color:var(--text-secondary);">Carregando…</p>
      </div>

      <div style="padding:12px 24px;border-top:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;background:var(--bg-surface,#FAFAF7);">
        <span style="font-size:0.7rem;color:var(--text-muted);">
          💡 Use estes paths EXATAMENTE no seu template (case-sensitive).
        </span>
        <button class="btn btn-secondary btn-sm" id="man-close-bottom">Fechar</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  // v4.63.21+ Fix M5 (audit pós-sprint): keydown handler precisa SAIR do
  // document mesmo quando user fecha via click (✕, fora, botão Fechar).
  // Antes, listener só era removido quando user pressionava Esc → memory
  // leak + zombie listener capturando eventos pós-close.
  const escH = (e) => { if (e.key === 'Escape') close(); };
  const close = () => {
    document.removeEventListener('keydown', escH);
    wrap.remove();
  };
  wrap.querySelector('#man-close').onclick = close;
  wrap.querySelector('#man-close-bottom').onclick = close;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', escH);

  // Tabs por módulo
  const _renderModule = (modId) => {
    wrap.querySelectorAll('.man-tab').forEach(b => {
      const active = b.dataset.mod === modId;
      b.style.background = active ? 'var(--brand-gold,#D4A843)' : '';
      b.style.color = active ? '#0A1628' : '';
      b.style.fontWeight = active ? '700' : '';
    });
    const spec = PLACEHOLDERS_SPEC[modId] || [];
    if (!spec.length) {
      wrap.querySelector('#man-content').innerHTML = '<p style="color:var(--text-muted);">Sem placeholders documentados.</p>';
      return;
    }
    // Group by category
    const byCat = {};
    spec.forEach(p => {
      const c = p.category || 'root';
      if (!byCat[c]) byCat[c] = [];
      byCat[c].push(p);
    });
    const cats = Object.keys(byCat).sort((a, b) =>
      (PLACEHOLDER_CATEGORIES[a]?.order || 99) - (PLACEHOLDER_CATEGORIES[b]?.order || 99)
    );

    const reqBadge = (r) => {
      const colorMap = { always: '#10B981', common: '#3B82F6', optional: '#9CA3AF', computed: '#8B5CF6' };
      const labelMap = { always: 'Sempre', common: 'Comum', optional: 'Opcional', computed: 'Calculado' };
      const c = colorMap[r] || '#9CA3AF';
      return `<span style="background:${c}1a;color:${c};font-size:0.65rem;padding:1px 6px;border-radius:8px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${labelMap[r] || r}</span>`;
    };
    const typeBadge = (t) => {
      const c = { string:'#64748B', number:'#0EA5E9', bool:'#A855F7', array:'#F59E0B', object:'#EC4899', url:'#10B981', date:'#06B6D4' }[t] || '#64748B';
      return `<span style="background:${c}1a;color:${c};font-size:0.65rem;padding:1px 6px;border-radius:8px;font-family:monospace;font-weight:600;">${t}</span>`;
    };

    const html = cats.map(c => {
      const meta = PLACEHOLDER_CATEGORIES[c] || { label: c, icon: '📌' };
      const items = byCat[c];
      return `
        <section style="margin-bottom:24px;">
          <h3 style="margin:0 0 10px;font-size:0.875rem;font-weight:700;color:var(--text-primary);padding:6px 10px;background:var(--bg-callout,#FAF6EC);border-left:3px solid var(--brand-gold,#D4A843);">
            ${meta.icon} ${_esc(meta.label)} <span style="color:var(--text-muted);font-weight:400;">· ${items.length} ${items.length === 1 ? 'placeholder' : 'placeholders'}</span>
          </h3>
          <table style="width:100%;border-collapse:collapse;font-size:0.75rem;">
            <thead>
              <tr style="background:var(--bg-surface,#FAFAF7);">
                <th style="text-align:left;padding:8px;border-bottom:1px solid var(--border-subtle);width:35%;">Path</th>
                <th style="text-align:left;padding:8px;border-bottom:1px solid var(--border-subtle);width:10%;">Tipo</th>
                <th style="text-align:left;padding:8px;border-bottom:1px solid var(--border-subtle);width:10%;">Required</th>
                <th style="text-align:left;padding:8px;border-bottom:1px solid var(--border-subtle);width:20%;">Exemplo</th>
                <th style="text-align:left;padding:8px;border-bottom:1px solid var(--border-subtle);width:25%;">Descrição</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(p => `
                <tr style="border-bottom:1px solid var(--border-subtle);">
                  <td style="padding:8px;">
                    <code style="background:var(--bg-surface,#FAFAF7);color:var(--brand-gold,#D4A843);padding:2px 6px;border-radius:3px;font-size:0.7rem;font-weight:600;cursor:pointer;" title="Click pra copiar" data-copy="{{${_esc(p.key)}}}">{{${_esc(p.key)}}}</code>
                  </td>
                  <td style="padding:8px;">${typeBadge(p.type || 'string')}</td>
                  <td style="padding:8px;">${reqBadge(p.required || 'optional')}</td>
                  <td style="padding:8px;font-family:monospace;font-size:0.7rem;color:var(--text-secondary);">${_esc(String(p.example || '—')).slice(0, 60)}</td>
                  <td style="padding:8px;color:var(--text-secondary);">${_esc(p.desc || '')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </section>
      `;
    }).join('');

    wrap.querySelector('#man-content').innerHTML = `
      <div style="background:var(--bg-callout,#FAF6EC);border-left:3px solid var(--brand-gold,#D4A843);padding:10px 14px;margin-bottom:18px;border-radius:0 6px 6px 0;">
        <p style="margin:0;font-size:0.75rem;color:var(--text-secondary);line-height:1.6;">
          <strong>Como usar:</strong> Cada <code>path</code> abaixo está disponível no seu template como variável Handlebars
          (HTML) ou Mustache (DOCX/PPTX). Click no path pra copiar com chaves duplas <code>{{path}}</code>.
          Para detalhes finos (cores brand, fontes Poppins, SSRF allowlist, page-breaks, exemplos completos):
          <a href="${GUIDE_URL}" target="_blank" rel="noopener" style="color:var(--brand-gold,#D4A843);font-weight:600;">↗ guia completo</a>.
        </p>
      </div>
      ${html}
    `;

    // Click-to-copy
    wrap.querySelectorAll('code[data-copy]').forEach(c => {
      c.addEventListener('click', () => {
        const v = c.dataset.copy;
        try {
          navigator.clipboard.writeText(v);
          toast.success(`Copiado: ${v}`);
        } catch {}
      });
    });
  };

  wrap.querySelectorAll('.man-tab').forEach(b => {
    b.addEventListener('click', () => _renderModule(b.dataset.mod));
  });

  // Inicia com cotações
  _renderModule('cotacoes');
}

/* ─── Cleanup (CLAUDE.md §11.j SPA cleanup) ─────────────────────────── */

export function destroyTemplatesLibrary() {
  if (_abortCtrl) { _abortCtrl.abort(); _abortCtrl = null; }
}
