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
  validateTemplateFile, formatFileSize,
  TEMPLATE_MODULES, TEMPLATE_FORMATS, MODULE_MAP, FORMAT_MAP, PLACEHOLDERS_SPEC,
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

      <div style="display:flex;gap:6px;margin-top:auto;padding-top:10px;border-top:1px solid var(--border-subtle);">
        <a href="${_esc(tpl.fileUrl)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm"
          style="flex:1;text-align:center;text-decoration:none;font-size:0.75rem;">
          🔗 Abrir arquivo
        </a>
        ${canManage && !isArchived ? `
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
    if (f.ownerId && f.ownerId !== 'global' && t.ownerId !== f.ownerId) return false;
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
      const btn = e.target.closest('[data-action="upload-template"]');
      if (btn) _openUploadModal(container);
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

/* ─── Upload modal (placeholder — UI completa em v4.63.5) ─────────── */

function _openUploadModal(container) {
  // v4.63.4 stub: input file inline temporário só pra continuar testando.
  // v4.63.5 vai trazer modal completo com nome, módulo, formato, ownerType, drop zone.
  const html = `
    <div id="tpl-upload-overlay" style="
      position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;
      display:flex;align-items:center;justify-content:center;padding:24px;">
      <div style="background:var(--bg-card);border-radius:8px;padding:24px;max-width:520px;width:100%;
        box-shadow:0 20px 40px rgba(0,0,0,0.3);">
        <h2 style="font-size:1.125rem;margin:0 0 6px;color:var(--text-primary);">📤 Subir template</h2>
        <p style="font-size:0.8125rem;color:var(--text-muted);margin:0 0 16px;">
          v4.63.4 — modal simplificado · UI completa em v4.63.5
        </p>

        <div style="display:grid;gap:10px;font-size:0.8125rem;">
          <label>
            <span style="display:block;color:var(--text-muted);margin-bottom:3px;">Nome</span>
            <input id="up-name" class="form-input" type="text" maxlength="120"
              placeholder="Ex: BTG Cotação Padrão Q1 2026" style="width:100%;" />
          </label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <label>
              <span style="display:block;color:var(--text-muted);margin-bottom:3px;">Módulo</span>
              <select id="up-module" class="form-input" style="width:100%;">
                ${TEMPLATE_MODULES.map(m => `<option value="${m.id}">${m.icon} ${m.label}</option>`).join('')}
              </select>
            </label>
            <label>
              <span style="display:block;color:var(--text-muted);margin-bottom:3px;">Formato</span>
              <select id="up-format" class="form-input" style="width:100%;">
                ${TEMPLATE_FORMATS.map(x => `<option value="${x.id}">${x.label}</option>`).join('')}
              </select>
            </label>
          </div>
          <label>
            <span style="display:block;color:var(--text-muted);margin-bottom:3px;">Área dona</span>
            <select id="up-owner" class="form-input" style="width:100%;">
              <option value="global">🌐 Global (todas as áreas podem usar)</option>
              ${_state.areas.map(a => `<option value="${a.id}">${_esc(a.name)}</option>`).join('')}
            </select>
          </label>
          <label>
            <span style="display:block;color:var(--text-muted);margin-bottom:3px;">Arquivo</span>
            <input id="up-file" type="file" accept=".html,.htm,.docx,.pptx" class="form-input" style="width:100%;" />
            <span style="display:block;font-size:0.7rem;color:var(--text-muted);margin-top:3px;">
              HTML ≤5MB · DOCX ≤10MB · PPTX ≤15MB · Use {{placeholders}} Handlebars
            </span>
          </label>
        </div>

        <div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end;">
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
    const ov = document.getElementById('tpl-upload-overlay');
    if (ov) ov.remove();
  };

  document.getElementById('up-cancel')?.addEventListener('click', close);
  document.getElementById('tpl-upload-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'tpl-upload-overlay') close();
  });

  document.getElementById('up-submit')?.addEventListener('click', async () => {
    const name = document.getElementById('up-name')?.value?.trim();
    const module = document.getElementById('up-module')?.value;
    const format = document.getElementById('up-format')?.value;
    const ownerVal = document.getElementById('up-owner')?.value;
    const fileEl = document.getElementById('up-file');
    const file = fileEl?.files?.[0];

    if (!name) { toast.error('Nome obrigatório'); return; }
    if (!file) { toast.error('Selecione um arquivo'); return; }

    const valid = validateTemplateFile(file, format);
    if (!valid.ok) { toast.error(valid.error); return; }

    const submitBtn = document.getElementById('up-submit');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Subindo…'; }

    try {
      const result = await uploadTemplateService(file, {
        name, module, format,
        ownerType: ownerVal === 'global' ? 'global' : 'area',
        ownerId:   ownerVal === 'global' ? null     : ownerVal,
      });
      toast.success(`Template criado (${result.templateId}). Extração de placeholders rodando em background.`);
      close();
      // Re-render lista
      await renderTemplatesLibrary(container);
    } catch (e) {
      toast.error('Erro: ' + (e.message || e));
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Subir template'; }
    }
  });
}

/* ─── Cleanup (CLAUDE.md §11.j SPA cleanup) ─────────────────────────── */

export function destroyTemplatesLibrary() {
  if (_abortCtrl) { _abortCtrl.abort(); _abortCtrl = null; }
}
