/**
 * PRIMETOUR — Portal de Dicas: Editor de Dicas
 * Editor completo com:
 * - Segmentos modo texto (rich text) e modo lista (título + descrição + links)
 * - Controle de validade por segmento
 * - Navegação entre segmentos via sidebar
 * - Auto-save e indicador de status
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import {
  fetchDestinations, fetchTip, saveTip,
  SEGMENTS, CONTINENTS,
} from '../services/portal.js';

const esc = s => String(s||'').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// State
let currentTip      = null;  // loaded tip doc
let currentDestId   = null;
let currentDestInfo = null;
let segmentData     = {};    // { [segKey]: { content, items, hasExpiry, expiryDate } }
let activeSegKey    = null;
let isDirty         = false;
let autoSaveTimer   = null;

/* ─── Entry point ─────────────────────────────────────────── */
export async function renderPortalTipEditor(container) {
  if (!store.canCreateTip()) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
      <div class="empty-state-subtitle">Você não tem permissão para criar ou editar dicas.</div>
    </div>`;
    return;
  }

  // Parse destination from hash params if coming from portal-tips
  const hash   = window.location.hash;
  const params = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '');
  const destId = params.get('dest') || params.get('destId') || null;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title" id="editor-title">Editor de Dica</h1>
        <p class="page-subtitle" id="editor-subtitle">Selecione um destino para começar</p>
      </div>
      <div class="page-header-actions" style="gap:8px;">
        <span id="editor-save-status" style="font-size:0.75rem;color:var(--text-muted);"></span>
        <button class="btn btn-secondary btn-sm" onclick="location.hash='portal-tips'">
          ← Voltar
        </button>
        <button class="btn btn-primary btn-sm" id="editor-save-btn" disabled>
          Salvar Dica
        </button>
      </div>
    </div>

    <!-- Destination selector (shows when no dest selected) -->
    <div id="editor-dest-selector" class="card" style="padding:24px;margin-bottom:20px;">
      <h3 style="font-size:0.875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
        color:var(--text-muted);margin:0 0 16px;">Destino</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">Continente *</label>
          <select class="filter-select" id="editor-continent" style="width:100%;">
            <option value="">Selecione</option>
            ${CONTINENTS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">País *</label>
          <select class="filter-select" id="editor-country" style="width:100%;" disabled>
            <option value="">Selecione o continente</option>
          </select>
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">
            Cidade <span style="font-weight:400;color:var(--text-muted);">(opcional)</span>
          </label>
          <select class="filter-select" id="editor-city" style="width:100%;" disabled>
            <option value="">Nível país</option>
          </select>
        </div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;align-items:center;">
        <button class="btn btn-primary btn-sm" id="editor-load-dest-btn" disabled>
          Carregar / Criar Dica
        </button>
        <span id="editor-dest-status" style="font-size:0.8125rem;color:var(--text-muted);"></span>
      </div>
    </div>

    <!-- Editor layout (hidden until dest selected) -->
    <div id="editor-layout" style="display:none;gap:20px;">
      <div style="display:grid;grid-template-columns:220px 1fr;gap:20px;">

        <!-- Segment nav -->
        <div>
          <div class="card" style="padding:0;overflow:hidden;">
            <div style="padding:12px 14px;border-bottom:1px solid var(--border-subtle);
              font-size:0.6875rem;font-weight:700;text-transform:uppercase;
              letter-spacing:.07em;color:var(--text-muted);">Segmentos</div>
            <nav id="segment-nav" style="padding:6px 0;"></nav>
          </div>

          <!-- Expiry overview -->
          <div class="card" style="padding:14px;margin-top:12px;">
            <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;
              letter-spacing:.07em;color:var(--text-muted);margin-bottom:10px;">Validades</div>
            <div id="expiry-overview" style="display:flex;flex-direction:column;gap:4px;"></div>
          </div>
        </div>

        <!-- Active segment editor -->
        <div id="segment-editor-panel">
          <div class="card" style="padding:32px;text-align:center;color:var(--text-muted);">
            Selecione um segmento para editar.
          </div>
        </div>

      </div>
    </div>
  `;

  // Bind destination selector
  document.getElementById('editor-continent')?.addEventListener('change', onEditorContinentChange);
  document.getElementById('editor-country')?.addEventListener('change',   onEditorCountryChange);
  document.getElementById('editor-city')?.addEventListener('change', () => {
    document.getElementById('editor-load-dest-btn').disabled = false;
  });
  document.getElementById('editor-load-dest-btn')?.addEventListener('click', loadDestination);
  document.getElementById('editor-save-btn')?.addEventListener('click', saveDraft);

  // Load destination from URL param if provided
  if (destId) {
    await loadDestinationById(destId);
  }
}

/* ─── Destination loading ─────────────────────────────────── */
async function onEditorContinentChange() {
  const continent  = document.getElementById('editor-continent')?.value;
  const countrySel = document.getElementById('editor-country');
  const citySel    = document.getElementById('editor-city');
  const loadBtn    = document.getElementById('editor-load-dest-btn');
  if (!countrySel) return;

  countrySel.innerHTML = '<option value="">Carregando…</option>';
  countrySel.disabled  = true;
  citySel.innerHTML    = '<option value="">Nível país</option>';
  citySel.disabled     = true;
  if (loadBtn) loadBtn.disabled = true;

  const dests    = await fetchDestinations({ continent });
  const countries = [...new Set(dests.map(d => d.country).filter(Boolean))].sort();
  countrySel.innerHTML = `<option value="">Selecione o país</option>` +
    countries.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  countrySel.disabled = false;
}

async function onEditorCountryChange() {
  const continent = document.getElementById('editor-continent')?.value;
  const country   = document.getElementById('editor-country')?.value;
  const citySel   = document.getElementById('editor-city');
  const loadBtn   = document.getElementById('editor-load-dest-btn');
  if (!citySel) return;

  citySel.innerHTML = '<option value="">Nível país (sem cidade)</option>';
  citySel.disabled  = true;
  if (loadBtn) loadBtn.disabled = !country;
  if (!country) return;

  const dests  = await fetchDestinations({ continent, country });
  const cities = dests.map(d => d.city).filter(Boolean).sort();
  if (cities.length) {
    citySel.innerHTML = `<option value="">Nível país (sem cidade)</option>` +
      cities.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    citySel.disabled = false;
  }
  if (loadBtn) loadBtn.disabled = false;
}

async function loadDestination() {
  const continent = document.getElementById('editor-continent')?.value;
  const country   = document.getElementById('editor-country')?.value;
  const city      = document.getElementById('editor-city')?.value;
  const status    = document.getElementById('editor-dest-status');

  if (!country) { toast.error('Selecione o país.'); return; }
  if (status) status.textContent = 'Carregando…';

  const dests = await fetchDestinations({ continent, country });
  const dest  = city
    ? dests.find(d => d.city === city)
    : dests.find(d => !d.city) || dests[0];

  if (!dest) {
    if (status) status.textContent = '⚠ Destino não cadastrado.';
    toast.error('Destino não encontrado. Cadastre o destino primeiro em #portal-destinations.');
    return;
  }

  await loadDestinationById(dest.id, dest);
}

async function loadDestinationById(destId, destInfo = null) {
  currentDestId = destId;

  if (!destInfo) {
    const all  = await fetchDestinations();
    destInfo   = all.find(d => d.id === destId);
  }
  currentDestInfo = destInfo;

  // Load existing tip
  const tip = await fetchTip(destId);
  currentTip = tip;

  // Initialize segmentData from existing tip or empty
  segmentData = {};
  for (const seg of SEGMENTS) {
    segmentData[seg.key] = tip?.segments?.[seg.key] || {
      content: '',
      items: [],
      hasExpiry: false,
      expiryDate: '',
    };
  }

  // Update UI
  const label = [destInfo?.city, destInfo?.country, destInfo?.continent]
    .filter(Boolean).join(' · ');
  const titleEl    = document.getElementById('editor-title');
  const subtitleEl = document.getElementById('editor-subtitle');
  const saveBtn    = document.getElementById('editor-save-btn');

  if (titleEl)    titleEl.textContent    = tip ? `Editando dica` : `Nova dica`;
  if (subtitleEl) subtitleEl.textContent = label;
  if (saveBtn)    saveBtn.disabled       = false;

  // Show editor layout, hide dest selector
  const layout   = document.getElementById('editor-layout');
  const selector = document.getElementById('editor-dest-selector');
  if (layout)   layout.style.display   = 'block';
  if (selector) selector.style.display = 'none';

  renderSegmentNav();
  renderExpiryOverview();

  // Activate first segment
  if (SEGMENTS.length > 0) activateSegment(SEGMENTS[0].key);

  const status = document.getElementById('editor-save-status');
  if (status) status.textContent = tip ? `Última edição: ${formatDate(tip.updatedAt)}` : 'Novo rascunho';
}

/* ─── Segment navigation ──────────────────────────────────── */
function renderSegmentNav() {
  const nav = document.getElementById('segment-nav');
  if (!nav) return;

  nav.innerHTML = SEGMENTS.map(s => {
    const data      = segmentData[s.key];
    const hasContent = hasSegmentContent(s.key);
    const isExpired  = data?.hasExpiry && data?.expiryDate && new Date(data.expiryDate) < new Date();
    const isActive   = s.key === activeSegKey;

    return `<button class="seg-nav-btn" data-key="${s.key}"
      style="width:100%;text-align:left;padding:9px 14px;border:none;
      background:${isActive ? 'var(--brand-gold)15' : 'transparent'};
      border-left:3px solid ${isActive ? 'var(--brand-gold)' : 'transparent'};
      cursor:pointer;transition:all .15s;display:flex;align-items:center;gap:8px;">
      <span style="flex:1;font-size:0.8125rem;
        color:${isActive ? 'var(--brand-gold)' : 'var(--text-primary)'};">
        ${esc(s.label)}
      </span>
      <span style="font-size:0.625rem;">
        ${isExpired ? '⚠' : hasContent ? '●' : '○'}
      </span>
    </button>`;
  }).join('');

  nav.querySelectorAll('.seg-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      saveActiveSegment(); // save current before switching
      activateSegment(btn.dataset.key);
    });
  });
}

function activateSegment(key) {
  activeSegKey = key;
  renderSegmentNav();
  renderSegmentEditor(key);
}

/* ─── Segment editor ──────────────────────────────────────── */
function renderSegmentEditor(key) {
  const panel = document.getElementById('segment-editor-panel');
  if (!panel) return;

  const seg  = SEGMENTS.find(s => s.key === key);
  const data = segmentData[key] || { content: '', items: [], hasExpiry: false, expiryDate: '' };
  if (!seg) return;

  const isExpired = data.hasExpiry && data.expiryDate && new Date(data.expiryDate) < new Date();

  panel.innerHTML = `
    <div class="card" style="padding:0;overflow:hidden;">

      <!-- Segment header -->
      <div style="padding:16px 20px;border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;justify-content:space-between;gap:16px;
        background:var(--bg-surface);">
        <div>
          <h2 style="margin:0;font-size:1rem;font-weight:700;">${esc(seg.label)}</h2>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
            ${seg.mode === 'list' ? 'Lista de itens com título, descrição e links' : 'Texto livre com formatação'}
          </div>
        </div>

        <!-- Expiry control -->
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.8125rem;">
            <input type="checkbox" id="seg-has-expiry" ${data.hasExpiry ? 'checked' : ''}
              style="accent-color:var(--brand-gold);width:14px;height:14px;">
            Tem validade
          </label>
          <div id="seg-expiry-field" style="display:${data.hasExpiry ? 'flex' : 'none'};align-items:center;gap:6px;">
            <input type="date" id="seg-expiry-date" value="${esc(data.expiryDate || '')}"
              class="filter-select" style="padding:5px 8px;font-size:0.8125rem;width:140px;">
            ${isExpired ? `<span style="font-size:0.75rem;color:#EF4444;font-weight:600;">● Vencido</span>` : ''}
          </div>
        </div>
      </div>

      <!-- Editor body -->
      <div style="padding:20px;" id="seg-editor-body">
        ${seg.mode === 'text' ? renderTextEditor(data) : renderListEditor(data)}
      </div>
    </div>
  `;

  // Expiry toggle
  document.getElementById('seg-has-expiry')?.addEventListener('change', e => {
    const field = document.getElementById('seg-expiry-field');
    if (field) field.style.display = e.target.checked ? 'flex' : 'none';
    markDirty();
  });
  document.getElementById('seg-expiry-date')?.addEventListener('change', markDirty);

  // Mode toggle button
  document.getElementById('seg-mode-toggle')?.addEventListener('click', () => {
    saveActiveSegment();
    const currentMode = seg.mode;
    // Store original mode preference per-session
    seg._modeOverride = currentMode === 'text' ? 'list' : 'text';
    renderSegmentEditor(key);
  });

  // List item buttons
  if (seg.mode === 'list') {
    bindListEditor();
  } else {
    bindTextEditor();
  }
}

/* ─── Text editor ─────────────────────────────────────────── */
function renderTextEditor(data) {
  return `
    <!-- Toolbar -->
    <div style="display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap;
      border:1px solid var(--border-subtle);border-bottom:none;
      border-radius:var(--radius-sm) var(--radius-sm) 0 0;padding:6px 8px;
      background:var(--bg-surface);">
      ${[
        ['bold',        'B',  'font-weight:bold;'],
        ['italic',      'I',  'font-style:italic;'],
        ['underline',   'U',  'text-decoration:underline;'],
        ['insertUnorderedList', '• Lista', ''],
        ['insertOrderedList',   '1. Lista', ''],
        ['createLink',  '🔗 Link', ''],
        ['unlink',      '✕ Link', ''],
      ].map(([cmd, label, style]) => `
        <button class="rich-btn" data-cmd="${cmd}"
          style="border:none;background:none;cursor:pointer;padding:4px 8px;
          border-radius:var(--radius-sm);font-size:0.8125rem;${style}
          color:var(--text-primary);transition:background .1s;"
          onmouseover="this.style.background='var(--bg-elevated)'"
          onmouseout="this.style.background='none'">
          ${label}
        </button>
      `).join('')}
    </div>
    <!-- Editable area -->
    <div id="seg-text-editor" contenteditable="true"
      style="min-height:280px;border:1px solid var(--border-subtle);
      border-radius:0 0 var(--radius-sm) var(--radius-sm);
      padding:16px;font-size:0.9375rem;line-height:1.7;
      color:var(--text-primary);background:var(--bg-card);outline:none;
      white-space:pre-wrap;"
      oninput="window._portalEditorDirty=true"
    >${data.content || ''}</div>
  `;
}

function bindTextEditor() {
  document.querySelectorAll('.rich-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      if (cmd === 'createLink') {
        const url = prompt('URL do link:');
        if (url) document.execCommand('createLink', false, url);
      } else {
        document.execCommand(cmd, false, null);
      }
      document.getElementById('seg-text-editor')?.focus();
      markDirty();
    });
  });
}

/* ─── List editor ─────────────────────────────────────────── */
function renderListEditor(data) {
  const items = data.items || [];
  return `
    <div id="list-items-container" style="display:flex;flex-direction:column;gap:16px;">
      ${items.map((item, i) => renderListItem(item, i)).join('')}
    </div>
    <button id="list-add-item-btn" class="btn btn-secondary btn-sm"
      style="margin-top:16px;display:flex;align-items:center;gap:6px;">
      + Adicionar item
    </button>
    <div style="margin-top:12px;padding:10px 14px;background:var(--bg-surface);
      border-radius:var(--radius-sm);font-size:0.8125rem;color:var(--text-muted);">
      💡 Use para restaurantes, atrações, lojas etc. Cada item tem título, descrição e links opcionais.
    </div>
  `;
}

function renderListItem(item = {}, index) {
  return `
    <div class="list-item-block" data-index="${index}"
      style="border:1px solid var(--border-subtle);border-radius:var(--radius-md);
      padding:16px;background:var(--bg-card);position:relative;">

      <!-- Drag handle + remove -->
      <div style="position:absolute;top:10px;right:10px;display:flex;gap:6px;">
        <button class="list-move-up" data-index="${index}" title="Mover acima"
          style="border:none;background:none;cursor:pointer;color:var(--text-muted);font-size:0.875rem;
          padding:2px 6px;">↑</button>
        <button class="list-move-down" data-index="${index}" title="Mover abaixo"
          style="border:none;background:none;cursor:pointer;color:var(--text-muted);font-size:0.875rem;
          padding:2px 6px;">↓</button>
        <button class="list-remove-item" data-index="${index}" title="Remover"
          style="border:none;background:none;cursor:pointer;color:#EF4444;font-size:0.875rem;
          padding:2px 6px;">✕</button>
      </div>

      <!-- Title -->
      <div style="margin-bottom:10px;margin-right:80px;">
        <label style="font-size:0.75rem;font-weight:700;text-transform:uppercase;
          letter-spacing:.06em;color:var(--text-muted);display:block;margin-bottom:4px;">
          Título / Nome *
        </label>
        <input type="text" class="list-item-title filter-select" data-index="${index}"
          style="width:100%;font-weight:600;"
          placeholder="Ex: Le Jules Verne, Museu do Louvre…"
          value="${esc(item.title || '')}">
      </div>

      <!-- Description -->
      <div style="margin-bottom:10px;">
        <label style="font-size:0.75rem;font-weight:700;text-transform:uppercase;
          letter-spacing:.06em;color:var(--text-muted);display:block;margin-bottom:4px;">
          Descrição
        </label>
        <div class="list-item-desc-toolbar"
          style="display:flex;gap:3px;padding:5px 8px;
          border:1px solid var(--border-subtle);border-bottom:none;
          border-radius:var(--radius-sm) var(--radius-sm) 0 0;
          background:var(--bg-surface);">
          ${[['bold','B','font-weight:bold;'],['italic','I','font-style:italic;'],['createLink','🔗','']].map(([cmd,lbl,st])=>`
            <button class="list-rich-btn" data-cmd="${cmd}" data-index="${index}"
              style="border:none;background:none;cursor:pointer;padding:3px 7px;
              border-radius:3px;font-size:0.8125rem;${st}color:var(--text-primary);"
              onmouseover="this.style.background='var(--bg-elevated)'"
              onmouseout="this.style.background='none'">${lbl}</button>
          `).join('')}
        </div>
        <div class="list-item-desc" contenteditable="true" data-index="${index}"
          style="min-height:80px;border:1px solid var(--border-subtle);
          border-radius:0 0 var(--radius-sm) var(--radius-sm);
          padding:10px 12px;font-size:0.875rem;line-height:1.6;
          color:var(--text-primary);background:var(--bg-card);outline:none;"
          oninput="window._portalEditorDirty=true"
        >${item.description || ''}</div>
      </div>

      <!-- Links -->
      <div>
        <label style="font-size:0.75rem;font-weight:700;text-transform:uppercase;
          letter-spacing:.06em;color:var(--text-muted);display:block;margin-bottom:6px;">
          Links <span style="font-weight:400;">(opcionais — clicáveis em todos os formatos)</span>
        </label>
        <div class="item-links-container" data-index="${index}" style="display:flex;flex-direction:column;gap:6px;">
          ${(item.links || []).map((link, li) => renderLinkRow(index, li, link)).join('')}
        </div>
        <button class="add-link-btn" data-index="${index}"
          style="margin-top:6px;border:none;background:none;cursor:pointer;
          font-size:0.8125rem;color:var(--brand-gold);padding:4px 0;">
          + Adicionar link
        </button>
      </div>
    </div>
  `;
}

function renderLinkRow(itemIndex, linkIndex, link = {}) {
  return `
    <div class="link-row" style="display:flex;gap:6px;align-items:center;" data-link="${linkIndex}">
      <input type="text" class="link-label filter-select"
        style="flex:1;font-size:0.8125rem;padding:6px 8px;"
        placeholder="Texto do link (ex: Site oficial)"
        value="${esc(link.label || '')}">
      <input type="url" class="link-url filter-select"
        style="flex:2;font-size:0.8125rem;padding:6px 8px;"
        placeholder="https://"
        value="${esc(link.url || '')}">
      <button class="remove-link-btn" data-item="${itemIndex}" data-link="${linkIndex}"
        style="border:none;background:none;cursor:pointer;color:var(--text-muted);font-size:0.875rem;
        padding:4px 8px;">✕</button>
    </div>
  `;
}

function bindListEditor() {
  const container = document.getElementById('list-items-container');

  // Add item
  document.getElementById('list-add-item-btn')?.addEventListener('click', () => {
    saveActiveSegmentData();
    const data = segmentData[activeSegKey];
    if (!data.items) data.items = [];
    data.items.push({ title: '', description: '', links: [] });
    renderSegmentEditor(activeSegKey);
    markDirty();
  });

  // Per-item buttons (delegated)
  container?.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const idx = parseInt(btn.dataset.index ?? btn.dataset.item ?? '0');

    if (btn.classList.contains('list-remove-item')) {
      saveActiveSegmentData();
      segmentData[activeSegKey].items.splice(idx, 1);
      renderSegmentEditor(activeSegKey);
      markDirty();

    } else if (btn.classList.contains('list-move-up') && idx > 0) {
      saveActiveSegmentData();
      const items = segmentData[activeSegKey].items;
      [items[idx-1], items[idx]] = [items[idx], items[idx-1]];
      renderSegmentEditor(activeSegKey);
      markDirty();

    } else if (btn.classList.contains('list-move-down')) {
      saveActiveSegmentData();
      const items = segmentData[activeSegKey].items;
      if (idx < items.length - 1) {
        [items[idx], items[idx+1]] = [items[idx+1], items[idx]];
        renderSegmentEditor(activeSegKey);
        markDirty();
      }

    } else if (btn.classList.contains('add-link-btn')) {
      saveActiveSegmentData();
      const item = segmentData[activeSegKey].items[idx];
      if (!item.links) item.links = [];
      item.links.push({ label: '', url: '' });
      renderSegmentEditor(activeSegKey);
      markDirty();

    } else if (btn.classList.contains('remove-link-btn')) {
      saveActiveSegmentData();
      const li   = parseInt(btn.dataset.link);
      const item = segmentData[activeSegKey].items[idx];
      item.links.splice(li, 1);
      renderSegmentEditor(activeSegKey);
      markDirty();

    } else if (btn.classList.contains('list-rich-btn')) {
      const cmd    = btn.dataset.cmd;
      const descEl = container.querySelector(`.list-item-desc[data-index="${idx}"]`);
      descEl?.focus();
      if (cmd === 'createLink') {
        const url = prompt('URL do link:');
        if (url) document.execCommand('createLink', false, url);
      } else {
        document.execCommand(cmd, false, null);
      }
      markDirty();
    }
  });

  container?.addEventListener('input', markDirty);
}

/* ─── Read segment data from DOM ─────────────────────────── */
function saveActiveSegmentData() {
  if (!activeSegKey) return;
  const seg  = SEGMENTS.find(s => s.key === activeSegKey);
  if (!seg) return;
  const data = segmentData[activeSegKey] || {};

  data.hasExpiry  = document.getElementById('seg-has-expiry')?.checked || false;
  data.expiryDate = document.getElementById('seg-expiry-date')?.value  || '';

  if (seg.mode === 'text') {
    data.content = document.getElementById('seg-text-editor')?.innerHTML || '';
    data.items   = [];
  } else {
    data.content = '';
    // Read items from DOM
    const blocks = document.querySelectorAll('.list-item-block');
    data.items   = [...blocks].map(block => {
      const idx   = parseInt(block.dataset.index);
      const title = block.querySelector('.list-item-title')?.value || '';
      const desc  = block.querySelector('.list-item-desc')?.innerHTML || '';
      const links = [...block.querySelectorAll('.link-row')].map(row => ({
        label: row.querySelector('.link-label')?.value || '',
        url:   row.querySelector('.link-url')?.value   || '',
      })).filter(l => l.url);
      return { title, description: desc, links };
    }).filter(item => item.title || item.description);
  }

  segmentData[activeSegKey] = data;
}

function saveActiveSegment() {
  saveActiveSegmentData();
  renderExpiryOverview();
}

/* ─── Expiry overview ─────────────────────────────────────── */
function renderExpiryOverview() {
  const el = document.getElementById('expiry-overview');
  if (!el) return;

  const withExpiry = SEGMENTS.filter(s => segmentData[s.key]?.hasExpiry && segmentData[s.key]?.expiryDate);
  if (!withExpiry.length) {
    el.innerHTML = `<div style="font-size:0.75rem;color:var(--text-muted);">Nenhuma validade definida.</div>`;
    return;
  }

  el.innerHTML = withExpiry.map(s => {
    const d         = segmentData[s.key];
    const expDate   = new Date(d.expiryDate);
    const isExpired = expDate < new Date();
    const daysLeft  = Math.ceil((expDate - new Date()) / 86400000);
    return `
      <div style="display:flex;justify-content:space-between;font-size:0.75rem;">
        <span style="color:var(--text-secondary);">${esc(s.label)}</span>
        <span style="color:${isExpired ? '#EF4444' : daysLeft <= 30 ? '#F59E0B' : '#22C55E'};
          font-weight:600;">
          ${isExpired ? '✕ Vencido' : daysLeft + 'd'}
        </span>
      </div>
    `;
  }).join('');
}

/* ─── Save to Firestore ───────────────────────────────────── */
async function saveDraft() {
  if (!currentDestId) { toast.error('Nenhum destino selecionado.'); return; }
  saveActiveSegment();

  const btn    = document.getElementById('editor-save-btn');
  const status = document.getElementById('editor-save-status');
  if (btn)    { btn.disabled = true; btn.textContent = 'Salvando…'; }
  if (status) status.textContent = 'Salvando…';

  try {
    // Build segments object — only save segments that have content
    const segments = {};
    for (const seg of SEGMENTS) {
      const data = segmentData[seg.key];
      if (hasSegmentContent(seg.key) || data?.hasExpiry) {
        segments[seg.key] = {
          content:    data?.content    || '',
          items:      data?.items      || [],
          hasExpiry:  data?.hasExpiry  || false,
          expiryDate: data?.expiryDate || '',
        };
      }
    }

    const tipId = await saveTip(currentTip?.id || null, {
      destinationId: currentDestId,
      continent:     currentDestInfo?.continent || '',
      country:       currentDestInfo?.country   || '',
      city:          currentDestInfo?.city       || '',
      segments,
    });

    if (!currentTip) currentTip = { id: tipId };
    isDirty = false;

    const now = new Intl.DateTimeFormat('pt-BR', {
      day:'2-digit', month:'2-digit', year:'numeric',
      hour:'2-digit', minute:'2-digit',
    }).format(new Date());

    if (status) status.textContent = `Salvo às ${now}`;
    toast.success('Dica salva com sucesso.');
    renderSegmentNav(); // refresh dot indicators

  } catch(e) {
    toast.error('Erro ao salvar: ' + e.message);
    if (status) status.textContent = 'Erro ao salvar.';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar Dica'; }
  }
}

/* ─── Helpers ─────────────────────────────────────────────── */
function hasSegmentContent(key) {
  const data = segmentData[key];
  if (!data) return false;
  if (data.content && data.content.trim().replace(/<[^>]*>/g, '').trim()) return true;
  if (data.items && data.items.some(i => i.title || i.description)) return true;
  return false;
}

function markDirty() {
  isDirty = true;
  const status = document.getElementById('editor-save-status');
  if (status && !status.textContent.includes('…')) status.textContent = 'Alterações não salvas';

  // Auto-save after 3s of inactivity
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    if (isDirty && currentDestId) saveDraft();
  }, 3000);
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR').format(d);
}
