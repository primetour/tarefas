/**
 * PRIMETOUR — Portal de Dicas: Lista de Dicas
 * Visualização, edição, exclusão e controle de validade
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import {
  fetchTips, fetchDestinations, fetchAreas, deleteTip, toggleTipPriority,
  fetchWebLinksByTip, updateWebLink, fetchImages,
  fetchGenerationsByTip, recordGeneration, registerDownload,
  SEGMENTS, GENERATION_FORMATS,
} from '../services/portal.js';
import { generateTip } from '../services/portalGenerator.js';

const esc = s => String(s||'').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const fmt = ts => {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR').format(d);
};

let allTips   = [];
let allDests  = [];
let filterStr = '';
let filterExp = '';   // 'expired' | 'expiring' | 'ok' | ''
let filterPriority = false;

export async function renderPortalTipsList(container) {
  if (!store.canCreateTip()) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Dicas Cadastradas</h1>
        <p class="page-subtitle">Gerencie todo o conteúdo do Portal de Dicas</p>
      </div>
      <div class="page-header-actions" style="gap:8px;">
        <button class="btn btn-secondary btn-sm" onclick="location.hash='portal-import'">↑ Importar</button>
        <button class="btn btn-primary btn-sm" onclick="location.hash='portal-tip-editor'">+ Nova Dica</button>
      </div>
    </div>

    <!-- Filters -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;align-items:center;">
      <div style="position:relative;flex:1;min-width:200px;">
        <input type="text" id="tips-search" placeholder="Buscar por destino…"
          class="portal-field" style="padding-left:30px;width:100%;">
        <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);
          color:var(--text-muted);font-size:0.875rem;">🔍</span>
      </div>
      <select class="filter-select" id="tips-filter-exp" style="min-width:160px;">
        <option value="">Todas as validades</option>
        <option value="expired">⚠ Vencidas</option>
        <option value="expiring">🕐 Vencem em 30 dias</option>
        <option value="ok">✓ Em dia</option>
        <option value="no-expiry">Sem validade definida</option>
      </select>
      <button class="btn btn-ghost btn-sm" id="tips-filter-priority"
        style="font-size:0.8125rem;padding:5px 12px;border:1px solid var(--border-subtle);
        border-radius:var(--radius-full);white-space:nowrap;"
        title="Filtrar destinos prioritários">☆ Prioritários</button>
      <span id="tips-count" style="font-size:0.8125rem;color:var(--text-muted);"></span>
    </div>

    <!-- Summary KPIs -->
    <div id="tips-kpis" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));
      gap:12px;margin-bottom:20px;"></div>

    <!-- Table -->
    <div class="card" style="padding:0;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
        <thead>
          <tr style="background:var(--bg-surface);">
            <th style="${TH}">Destino</th>
            <th style="${TH}">Segmentos</th>
            <th style="${TH}">Validade</th>
            <th style="${TH}">Atualizado</th>
            <th style="${TH};width:120px;"></th>
          </tr>
        </thead>
        <tbody id="tips-tbody">
          <tr><td colspan="5" style="padding:40px;text-align:center;color:var(--text-muted);">
            Carregando…
          </td></tr>
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('tips-search')?.addEventListener('input', e => {
    filterStr = e.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    renderTable();
  });
  document.getElementById('tips-filter-exp')?.addEventListener('change', e => {
    filterExp = e.target.value;
    renderTable();
  });
  document.getElementById('tips-filter-priority')?.addEventListener('click', () => {
    filterPriority = !filterPriority;
    const btn = document.getElementById('tips-filter-priority');
    if (btn) {
      btn.textContent = filterPriority ? '★ Prioritários' : '☆ Prioritários';
      btn.style.background = filterPriority ? 'var(--brand-gold)' : '';
      btn.style.color      = filterPriority ? '#fff' : '';
      btn.style.borderColor = filterPriority ? 'var(--brand-gold)' : 'var(--border-subtle)';
    }
    renderTable();
  });

  await loadData();
}

const TH = `padding:10px 16px;text-align:left;font-size:0.6875rem;font-weight:700;
  text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);
  border-bottom:1px solid var(--border-subtle);white-space:nowrap;`;

async function loadData() {
  [allTips, allDests] = await Promise.all([fetchTips(), fetchDestinations()]);
  renderKpis();
  renderTable();
}

function renderKpis() {
  const el = document.getElementById('tips-kpis');
  if (!el) return;
  const now     = new Date();
  const in30    = new Date(now.getTime() + 30 * 86400000);
  const expired = allTips.filter(t => hasExpiredSegment(t, now)).length;
  const expiring= allTips.filter(t => !hasExpiredSegment(t, now) && hasExpiringSegment(t, now, in30)).length;
  const priorityCount = allTips.filter(t => t.priority).length;
  const priorityExpired = allTips.filter(t => t.priority && hasExpiredSegment(t, now)).length;
  const kpis = [
    { label: 'Total de dicas',  value: allTips.length, color: 'var(--text-primary)' },
    { label: 'Prioritárias',    value: priorityCount, color: 'var(--brand-gold)',
      sub: priorityExpired > 0 ? `${priorityExpired} vencida${priorityExpired>1?'s':''}` : 'atualizadas' },
    { label: 'Vencidas',        value: expired,  color: expired  > 0 ? '#EF4444' : '#22C55E' },
    { label: 'Vencendo em 30d', value: expiring, color: expiring > 0 ? '#F59E0B' : '#22C55E' },
    { label: 'Em dia',          value: allTips.length - expired - expiring, color: '#22C55E' },
  ];
  el.innerHTML = kpis.map(k => `
    <div class="card" style="padding:14px 16px;">
      <div style="font-size:0.6875rem;color:var(--text-muted);text-transform:uppercase;
        letter-spacing:.06em;margin-bottom:6px;">${k.label}</div>
      <div style="font-size:1.5rem;font-weight:700;color:${k.color};">${k.value}</div>
      ${k.sub ? `<div style="font-size:0.6875rem;color:var(--text-muted);margin-top:2px;">${k.sub}</div>` : ''}
    </div>
  `).join('');
}

function renderTable() {
  const tbody = document.getElementById('tips-tbody');
  const count = document.getElementById('tips-count');
  if (!tbody) return;

  const now  = new Date();
  const in30 = new Date(now.getTime() + 30 * 86400000);

  let rows = allTips.map(t => {
    const dest = allDests.find(d => d.id === t.destinationId);
    return { ...t, _dest: dest };
  });

  // Filter by search
  if (filterStr) rows = rows.filter(r => {
    const label = [r._dest?.city, r._dest?.country, r._dest?.continent, r.city, r.country, r.continent]
      .filter(Boolean).join(' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    return label.includes(filterStr);
  });

  // Filter by expiry
  if (filterExp === 'expired')   rows = rows.filter(r => hasExpiredSegment(r, now));
  if (filterExp === 'expiring')  rows = rows.filter(r => !hasExpiredSegment(r,now) && hasExpiringSegment(r,now,in30));
  if (filterExp === 'ok')        rows = rows.filter(r => !hasExpiredSegment(r,now) && !hasExpiringSegment(r,now,in30));
  if (filterExp === 'no-expiry') rows = rows.filter(r => !hasAnyExpiry(r));
  if (filterPriority) rows = rows.filter(r => r.priority);

  if (count) count.textContent = `${rows.length} dica${rows.length !== 1 ? 's' : ''}`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:48px;text-align:center;color:var(--text-muted);">
      Nenhuma dica encontrada.
    </td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const dest   = r._dest;
    const label  = dest
      ? [dest.city, dest.country, dest.continent].filter(Boolean).join(', ')
      : [r.city, r.country, r.continent].filter(Boolean).join(', ') || '—';

    const segsWithContent = SEGMENTS.filter(s => {
      const seg = r.segments?.[s.key];
      if (!seg) return false;
      if (seg.info && Object.values(seg.info).some(v => v && String(v).trim())) return true;
      if (Array.isArray(seg.items) && seg.items.length) return true;
      if (typeof seg.content === 'string' && seg.content.trim()) return true;
      return false;
    });

    const expiredSegs  = SEGMENTS.filter(s => {
      const seg = r.segments?.[s.key];
      return seg?.hasExpiry && seg?.expiryDate && new Date(seg.expiryDate) < now;
    });
    const expiringSegs = SEGMENTS.filter(s => {
      const seg = r.segments?.[s.key];
      return seg?.hasExpiry && seg?.expiryDate
        && new Date(seg.expiryDate) >= now
        && new Date(seg.expiryDate) <= in30;
    });

    const expiryBadge = expiredSegs.length
      ? `<span style="font-size:0.75rem;padding:2px 8px;background:#EF444415;color:#EF4444;
          border:1px solid #EF444430;border-radius:var(--radius-full);" title="${esc(expiredSegs.map(s=>s.label).join(', '))}">
          ⚠ ${expiredSegs.length} vencido${expiredSegs.length!==1?'s':''}</span>`
      : expiringSegs.length
        ? `<span style="font-size:0.75rem;padding:2px 8px;background:#F59E0B15;color:#F59E0B;
            border:1px solid #F59E0B30;border-radius:var(--radius-full);" title="${esc(expiringSegs.map(s=>s.label).join(', '))}">
            🕐 ${expiringSegs.length} vence em breve</span>`
        : `<span style="font-size:0.75rem;color:var(--text-muted);">—</span>`;

    return `<tr style="border-bottom:1px solid var(--border-subtle);transition:background .1s;"
      onmouseover="this.style.background='var(--bg-surface)'"
      onmouseout="this.style.background=''">
      <td style="padding:12px 16px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="tip-star-btn" data-id="${r.id}" data-priority="${r.priority?'1':'0'}"
            style="border:none;background:none;cursor:pointer;font-size:1.1rem;line-height:1;
            padding:0;color:${r.priority ? 'var(--brand-gold)' : 'var(--border-subtle)'};"
            title="${r.priority ? 'Remover prioridade' : 'Marcar como prioritário'}">${r.priority ? '★' : '☆'}</button>
          <div style="font-weight:600;font-size:0.9375rem;">${esc(label)}</div>
        </div>
      </td>
      <td style="padding:12px 16px;">
        <div style="display:flex;flex-wrap:wrap;gap:4px;">
          ${segsWithContent.slice(0,4).map(s =>
            `<span style="font-size:0.6875rem;padding:1px 6px;background:var(--bg-surface);
              border:1px solid var(--border-subtle);border-radius:var(--radius-full);">
              ${esc(s.label)}</span>`
          ).join('')}
          ${segsWithContent.length > 4
            ? `<span style="font-size:0.6875rem;color:var(--text-muted);">+${segsWithContent.length-4}</span>`
            : ''}
          ${segsWithContent.length === 0
            ? `<span style="font-size:0.75rem;color:var(--text-muted);">Vazia</span>` : ''}
        </div>
      </td>
      <td style="padding:12px 16px;">${expiryBadge}</td>
      <td style="padding:12px 16px;color:var(--text-muted);font-size:0.8125rem;">${fmt(r.updatedAt)}</td>
      <td style="padding:12px 16px;text-align:right;">
        <div style="display:flex;gap:6px;justify-content:flex-end;">
          <button class="btn btn-ghost btn-sm tip-preview-btn"
            data-id="${r.id}" data-dest-id="${r.destinationId}"
            style="font-size:0.75rem;color:var(--text-muted);">👁 Preview</button>
          <button class="btn btn-ghost btn-sm tip-materials-btn"
            data-id="${r.id}" data-dest-id="${r.destinationId}"
            style="font-size:0.75rem;color:var(--brand-gold);">✈ Materiais gerados</button>
          <a href="#portal-tip-editor?destId=${r.destinationId}" class="btn btn-ghost btn-sm"
            style="font-size:0.75rem;text-decoration:none;color:var(--text-muted);">✎ Editar original</a>
          <button class="btn btn-ghost btn-sm tip-delete-btn" data-id="${r.id}"
            data-label="${esc(label)}"
            style="font-size:0.75rem;color:#EF4444;">✕</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.tip-preview-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tip  = allTips.find(t => t.id === btn.dataset.id);
      const dest = allDests.find(d => d.id === btn.dataset.destId);
      if (!tip || !dest) { toast.error('Dica não encontrada.'); return; }
      showPreviewModal(tip, dest);
    });
  });

  tbody.querySelectorAll('.tip-materials-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tip  = allTips.find(t => t.id === btn.dataset.id);
      const dest = allDests.find(d => d.id === btn.dataset.destId);
      if (!tip || !dest) { toast.error('Dica não encontrada.'); return; }
      showMaterialsModal(tip, dest);
    });
  });

  tbody.querySelectorAll('.tip-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Excluir a dica de "${btn.dataset.label}"? Esta ação não pode ser desfeita.`)) return;
      try {
        await deleteTip(btn.dataset.id);
        toast.success('Dica excluída.');
        await loadData();
      } catch(e) { toast.error('Erro: ' + e.message); }
    });
  });

  tbody.querySelectorAll('.tip-star-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tipId    = btn.dataset.id;
      const wasPrio  = btn.dataset.priority === '1';
      const newPrio  = !wasPrio;
      // Optimistic UI update
      btn.textContent   = newPrio ? '★' : '☆';
      btn.style.color   = newPrio ? 'var(--brand-gold)' : 'var(--border-subtle)';
      btn.dataset.priority = newPrio ? '1' : '0';
      btn.title = newPrio ? 'Remover prioridade' : 'Marcar como prioritário';
      // Update local data
      const tip = allTips.find(t => t.id === tipId);
      if (tip) tip.priority = newPrio;
      renderKpis();
      try {
        await toggleTipPriority(tipId, newPrio);
      } catch(err) {
        // Rollback
        btn.textContent   = wasPrio ? '★' : '☆';
        btn.style.color   = wasPrio ? 'var(--brand-gold)' : 'var(--border-subtle)';
        btn.dataset.priority = wasPrio ? '1' : '0';
        if (tip) tip.priority = wasPrio;
        renderKpis();
        toast.error('Erro ao atualizar prioridade.');
      }
    });
  });
}

/* ─── Materials modal ────────────────────────────────────── */
const FMT_ICONS = { docx:'📄', pdf:'📑', pptx:'📊', web:'🔗' };
const FMT_LABELS = { docx:'Word', pdf:'PDF', pptx:'PowerPoint', web:'Link Web' };

async function showMaterialsModal(tip, dest) {
  const existing = document.getElementById('materials-modal');
  if (existing) existing.remove();

  const label    = [dest?.city, dest?.country].filter(Boolean).join(', ') || '—';
  const segments = Object.keys(tip.segments || {}).filter(k => {
    const seg = tip.segments[k];
    if (!seg) return false;
    if (seg.info && Object.values(seg.info).some(v => v && String(v).trim())) return true;
    return Array.isArray(seg.items) && seg.items.length > 0;
  });

  const modal = document.createElement('div');
  modal.id = 'materials-modal';
  modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2000;
    display:flex;align-items:center;justify-content:center;padding:20px;`;

  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:660px;padding:0;overflow:hidden;
      max-height:90vh;display:flex;flex-direction:column;">
      <div style="padding:18px 22px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div>
          <div style="font-weight:700;font-size:1rem;">Materiais · ${esc(label)}</div>
          <div style="font-size:0.8125rem;color:var(--text-muted);">
            Escolha um material existente como base, ou gere do original
          </div>
        </div>
        <button id="mat-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);">✕</button>
      </div>
      <div id="mat-list" style="padding:16px 22px;overflow-y:auto;flex:1;min-height:80px;">
        <div style="color:var(--text-muted);font-size:0.875rem;text-align:center;padding:20px;">
          ⏳ Carregando…
        </div>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('mat-close')?.addEventListener('click', () => modal.remove());

  const listEl = document.getElementById('mat-list');
  if (!listEl) return;

  const [links, gens] = await Promise.all([
    fetchWebLinksByTip(tip.id).catch(() => []),
    fetchGenerationsByTip(tip.id).catch(() => []),
  ]);
  const otherGens = gens.filter(g => g.format && g.format !== 'web');

  const formatPicker = (onPickFormat) => `
    <div class="fmt-picker" style="display:none;margin-top:10px;padding:10px 12px;
      background:var(--bg-surface);border-radius:var(--radius-sm);
      border:1px solid var(--border-subtle);">
      <div style="font-size:0.6875rem;color:var(--text-muted);margin-bottom:8px;font-weight:600;">
        Escolha o formato de saída:
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${GENERATION_FORMATS.map(f =>
          `<button class="fmt-pick-btn btn btn-ghost btn-sm" data-format="${f.key}"
            style="font-size:0.8125rem;">${FMT_ICONS[f.key]} ${esc(f.label)}</button>`
        ).join('')}
      </div>
    </div>`;

  const renderWebLink = (link) => {
    const date    = (link.createdAt)?.toDate ? link.createdAt.toDate().toLocaleDateString('pt-BR') : '—';
    const upd     = link.updatedAt?.toDate ? ' · ed. '+link.updatedAt.toDate().toLocaleDateString('pt-BR') : '';
    const segs    = (link.segments||[]).length;
    const author  = link.createdBy?.name || null;
    const views   = link.views ? ` · ${link.views} views` : '';
    const token   = link.token || link.id;
    const webUrl  = window.location.origin +
      window.location.pathname.replace(/index\.html$/,'') + 'portal-view.html#' + token;

    return `<div class="mat-card" style="background:var(--bg-surface);border:1px solid var(--border-subtle);
      border-radius:var(--radius-md);padding:14px 16px;margin-bottom:10px;">
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <div style="font-size:1.25rem;margin-top:2px;">🔗</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:0.9375rem;margin-bottom:3px;">Link Web</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">
            ${segs ? segs+' seg. · ' : ''}${esc(date)}${esc(upd)}${views}
            ${author ? ` · <strong>${esc(author)}</strong>` : ''}
          </div>
          ${formatPicker('')}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;align-items:flex-start;">
          <a href="${esc(webUrl)}" target="_blank" class="btn btn-ghost btn-sm"
            style="font-size:0.75rem;text-decoration:none;">🔗 Abrir</a>
          <button class="btn btn-ghost btn-sm mat-edit-btn" data-token="${esc(token)}"
            style="font-size:0.75rem;color:var(--text-muted);">✎ Editar</button>
          <button class="btn btn-primary btn-sm mat-derive-btn" data-token="${esc(token)}"
            style="font-size:0.75rem;">+ Formato</button>
        </div>
      </div>
    </div>`;
  };

  const renderDocItem = (gen) => {
    const date   = gen.generatedAt?.toDate ? gen.generatedAt.toDate().toLocaleDateString('pt-BR') : '—';
    const segs   = (gen.segments||[]).length;
    const fmt    = gen.format || '?';
    return `<div class="mat-card" style="background:var(--bg-surface);border:1px solid var(--border-subtle);
      border-radius:var(--radius-md);padding:14px 16px;margin-bottom:10px;">
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <div style="font-size:1.25rem;margin-top:2px;">${FMT_ICONS[fmt]||'📄'}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:0.9375rem;margin-bottom:3px;">${esc(FMT_LABELS[fmt]||fmt)}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">
            ${segs ? segs+' seg. · ' : ''}${esc(date)}
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;font-style:italic;">
            Documentos baixados não ficam armazenados — use "↓ Baixar" para regerar
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="btn btn-ghost btn-sm mat-regen-btn" data-format="${esc(fmt)}"
            style="font-size:0.75rem;color:var(--brand-gold);">↓ Baixar</button>
        </div>
      </div>
    </div>`;
  };

  // "Do original" card — always shown at bottom
  const originalCard = `
    <div style="margin-top:8px;border-top:1px solid var(--border-subtle);padding-top:14px;">
      <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;
        letter-spacing:.07em;color:var(--text-muted);margin-bottom:10px;">
        Começar do original
      </div>
      <div class="mat-card" style="background:var(--bg-surface);border:1px dashed var(--border-subtle);
        border-radius:var(--radius-md);padding:14px 16px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="font-size:1.25rem;">📋</div>
          <div style="flex:1;">
            <div style="font-weight:600;font-size:0.875rem;">Dica original (sem personalizações)</div>
            <div style="font-size:0.75rem;color:var(--text-muted);">
              Gera um novo material do zero a partir do conteúdo cadastrado
            </div>
            <div class="fmt-picker" style="display:none;margin-top:10px;padding:10px 12px;
              background:var(--bg-dark);border-radius:var(--radius-sm);">
              <div style="font-size:0.6875rem;color:var(--text-muted);margin-bottom:8px;font-weight:600;">
                Escolha o formato:
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                ${GENERATION_FORMATS.map(f =>
                  `<button class="fmt-pick-btn btn btn-ghost btn-sm" data-format="${f.key}"
                    style="font-size:0.8125rem;">${FMT_ICONS[f.key]} ${esc(f.label)}</button>`
                ).join('')}
              </div>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm mat-original-btn" style="flex-shrink:0;font-size:0.8125rem;">
            Escolher formato →
          </button>
        </div>
      </div>
    </div>`;

  if (!links.length && !otherGens.length) {
    listEl.innerHTML = `
      <div style="color:var(--text-muted);font-size:0.875rem;text-align:center;
        padding:20px 0 8px;">Nenhum material gerado ainda.</div>
      ${originalCard}`;
  } else {
    listEl.innerHTML =
      (links.length ? `<div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;
        letter-spacing:.07em;color:var(--text-muted);margin-bottom:10px;">Links web</div>` : '') +
      links.map(l => renderWebLink(l)).join('') +
      (otherGens.length ? `<div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;
        letter-spacing:.07em;color:var(--text-muted);margin:14px 0 10px;">Documentos</div>` : '') +
      otherGens.map(g => renderDocItem(g)).join('') +
      originalCard;
  }

  // Helper: toggle format picker on a card
  const togglePicker = (card, show) => {
    const picker = card.querySelector('.fmt-picker');
    if (picker) picker.style.display = show ? 'block' : 'none';
  };

  // Wire "✎ Editar" buttons (web links — opens text/image editor)
  listEl.querySelectorAll('.mat-edit-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const token = btn.dataset.token;
      const link  = links.find(l => (l.token||l.id) === token);
      if (!link) return;
      modal.remove();
      await showRegenEditor({ link, tip, dest });
    });
  });

  // Wire "+ Formato" buttons (derive new format from existing material)
  listEl.querySelectorAll('.mat-derive-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.mat-card');
      const isOpen = card.querySelector('.fmt-picker')?.style.display !== 'none';
      // Close all pickers first
      listEl.querySelectorAll('.fmt-picker').forEach(p => p.style.display = 'none');
      listEl.querySelectorAll('.mat-original-btn').forEach(b => b.textContent = 'Escolher formato →');
      if (!isOpen) togglePicker(card, true);
    });
  });

  // Wire "Escolher formato →" on original card
  listEl.querySelectorAll('.mat-original-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const card   = btn.closest('.mat-card');
      const picker = card.querySelector('.fmt-picker');
      const isOpen = picker?.style.display !== 'none';
      listEl.querySelectorAll('.fmt-picker').forEach(p => p.style.display = 'none');
      listEl.querySelectorAll('.mat-derive-btn').forEach(b => {});
      if (!isOpen) {
        picker.style.display = 'block';
        btn.textContent = 'Fechar ✕';
      } else {
        btn.textContent = 'Escolher formato →';
      }
    });
  });

  // Wire format pick buttons
  listEl.addEventListener('click', async e => {
    const btn = e.target.closest('.fmt-pick-btn');
    if (!btn) return;

    const format  = btn.dataset.format;
    const card    = btn.closest('.mat-card');
    const deriveBtn = card.querySelector('.mat-derive-btn');
    const isOriginal = !!card.querySelector('.mat-original-btn');

    // Determine base: web link or original
    const token = deriveBtn?.dataset.token || null;
    const baseLink = token ? links.find(l => (l.token||l.id) === token) : null;

    modal.remove();

    try {
      const areas = await fetchAreas().catch(() => []);
      const area  = areas.find(a => a.id === tip.areaId) || areas[0] || { name: 'PRIMETOUR' };

      if (isOriginal || !baseLink) {
        // Fresh from original tip
        await openGenerationEditor({ tip, dest, area, segments, format });
      } else {
        // Derive from existing material — carry over its tipData and image overrides
        const baseTip  = baseLink.tipData?.[0]?.tip  || tip;
        const baseDest = baseLink.tipData?.[0]?.dest || dest;
        const baseSegs = baseLink.segments || segments;
        const baseImgOverrides = {};
        for (const [dId, imgs] of Object.entries(baseLink.imagesByDest || {})) {
          if (imgs._overrides) baseImgOverrides[dId] = imgs._overrides;
        }
        await openGenerationEditor({
          tip:      baseTip,
          dest:     baseDest,
          area,
          segments: baseSegs,
          format,
          initialImages: baseImgOverrides,
        });
      }
    } catch(e) {
      toast.error('Erro: ' + e.message);
    }
  });

  // Wire "↓ Baixar" buttons
  listEl.querySelectorAll('.mat-regen-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = '⏳';
      try {
        const areas = await fetchAreas().catch(() => []);
        const area  = areas.find(a => a.id === tip.areaId) || areas[0] || { name: 'PRIMETOUR' };
        await generateTip({ tip, dest, area, segments, format: btn.dataset.format, extraTips: [] });
        toast.success('Download iniciado!');
      } catch(e) {
        toast.error('Erro: ' + e.message);
      } finally {
        btn.disabled = false; btn.textContent = '↓ Baixar';
      }
    });
  });
}


/* ─── Generation editor (called from materials modal) ────────── */
async function openGenerationEditor({ tip, dest, area, segments, format, initialImages = {} }) {
  // Lazy-import showPreviewModal logic — replicate inline since it's in portalTips.js
  // We use generateTip directly with an inline confirm UI
  const fmtLabel = GENERATION_FORMATS.find(f => f.key === format)?.label || format;

  // Deep-clone tip
  const workingTips   = [{ tip: JSON.parse(JSON.stringify(tip)), dest }];
  const allTips       = [{ tip, dest }];
  // Pre-populate with overrides from base material (if deriving from existing)
  const selectedImages = Object.keys(initialImages).length
    ? JSON.parse(JSON.stringify(initialImages))
    : {};

  // Load images
  const imagesByDest = {};
  if (dest?.id) {
    try {
      const { fetchImages } = await import('../services/portal.js');
      imagesByDest[dest.id] = await fetchImages({
        continent: dest.continent, country: dest.country, city: dest.city,
      });
    } catch { imagesByDest[dest.id] = []; }
  }

  const activeSeg = segments.filter(k => {
    const seg = tip.segments?.[k];
    if (!seg) return false;
    if (seg.info && Object.values(seg.info).some(v => v && String(v).trim())) return true;
    return Array.isArray(seg.items) && seg.items.length > 0;
  });

  let curSegKey = activeSeg[0] || '';
  const destId  = dest?.id || 0;
  const destImgs = imagesByDest[destId] || [];

  const modal = document.createElement('div');
  modal.id    = 'gen-from-list-modal';
  modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:2000;
    display:flex;align-items:center;justify-content:center;padding:16px;`;

  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:900px;max-height:92vh;
      padding:0;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:14px 20px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;gap:12px;flex-shrink:0;">
        <div style="flex:1;">
          <div style="font-weight:700;font-size:1rem;">Gerar Material</div>
          <div style="font-size:0.8125rem;color:var(--text-muted);">
            ${esc([dest?.city, dest?.country].filter(Boolean).join(', '))} · ${esc(fmtLabel)}
          </div>
        </div>
        <span style="font-size:0.75rem;padding:3px 10px;background:var(--brand-gold)15;
          color:var(--brand-gold);border-radius:var(--radius-full);font-weight:600;">
          ${esc(fmtLabel)}
        </span>
        <button id="gfl-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:200px 1fr;flex:1;overflow:hidden;min-height:0;">
        <div id="gfl-seg-list" style="border-right:1px solid var(--border-subtle);
          overflow-y:auto;background:var(--bg-surface);"></div>
        <div id="gfl-right-panel" style="overflow-y:auto;padding:20px;"></div>
      </div>
      <div style="padding:14px 20px;border-top:1px solid var(--border-subtle);
        background:var(--bg-surface);flex-shrink:0;display:flex;flex-direction:column;gap:10px;">
        ${format === 'web' ? `
          <div>
            <label style="font-size:0.75rem;font-weight:600;color:var(--text-muted);
              display:block;margin-bottom:4px;">
              Nome do cliente <span style="font-weight:400;">(opcional — usado na URL amigável)</span>
            </label>
            <input type="text" id="gfl-client-name" placeholder="ex.: João e Maria"
              style="width:100%;padding:8px 10px;font-size:0.8125rem;
              background:var(--bg-base);border:1px solid var(--border-subtle);
              border-radius:var(--radius-sm);">
          </div>
        ` : ''}
        <div style="display:flex;gap:10px;">
          <button class="btn btn-secondary" id="gfl-cancel" style="flex:1;">← Voltar</button>
          <button class="btn btn-primary"   id="gfl-confirm" style="flex:2;font-weight:600;">
            ✈ Gerar ${esc(fmtLabel)}
          </button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(modal);

  const refreshSegList = () => {
    const { tip: wTip } = workingTips[0];
    document.getElementById('gfl-seg-list').innerHTML = activeSeg.map(k => {
      const seg = SEGMENTS.find(s => s.key === k);
      const isActive = k === curSegKey;
      return `<button class="gfl-seg-btn" data-seg="${k}"
        style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;
        padding:12px 14px;border:none;
        background:${isActive?'var(--brand-gold)10':'transparent'};
        border-left:3px solid ${isActive?'var(--brand-gold)':'transparent'};
        cursor:pointer;transition:all .15s;font-size:0.8125rem;">
        <span style="flex:1;color:${isActive?'var(--brand-gold)':'var(--text-secondary)'};">
          ${esc(seg?.label||k)}</span>
      </button>`;
    }).join('');
    document.querySelectorAll('.gfl-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        curSegKey = btn.dataset.seg;
        refreshSegList();
        refreshRightPanel();
      });
    });
  };

  const refreshRightPanel = () => {
    const { tip: wTip } = workingTips[0];
    const panel = document.getElementById('gfl-right-panel');
    if (!panel) return;
    panel.innerHTML = renderSegEditorForList(wTip, curSegKey, destImgs, selectedImages[destId]?.[curSegKey] || {}, destId);
    wireRegenEditor(wTip, curSegKey, destImgs, destId, selectedImages, workingTips, 0, 'gfl-right-panel');
  };

  document.getElementById('gfl-close')?.addEventListener('click', () => modal.remove());
  document.getElementById('gfl-cancel')?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  document.getElementById('gfl-confirm')?.addEventListener('click', async () => {
    const btn = document.getElementById('gfl-confirm');
    if (!btn || btn.disabled) return;
    btn.disabled = true; btn.textContent = '⏳ Gerando…';
    try {
      const clientName = document.getElementById('gfl-client-name')?.value?.trim() || '';
      const result = await generateTip({
        tip:            workingTips[0].tip,
        dest,
        area, segments, format,
        extraTips:      [],
        imagesOverride: selectedImages,
        clientName,
      });
      await recordGeneration({
        areaId:    area?.id  || null,
        tipId:     tip?.id   || null,
        format, segments,
        destinationIds: [dest?.id].filter(Boolean),
        status:    'done',
        ...(result.url   ? { webUrl:   result.url   } : {}),
        ...(result.token ? { webToken: result.token } : {}),
      });
      await registerDownload();
      modal.remove();
      if (format === 'web' && result.url) {
        // Show web link result
        const rm = document.createElement('div');
        rm.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2100;
          display:flex;align-items:center;justify-content:center;padding:20px;`;
        rm.innerHTML = `<div class="card" style="max-width:480px;width:100%;padding:32px;text-align:center;">
          <div style="font-size:2rem;margin-bottom:12px;">🔗</div>
          <h2 style="font-size:1.125rem;margin:0 0 8px;">Link gerado!</h2>
          <input type="text" value="${esc(result.url)}" readonly
            style="width:100%;padding:10px;background:var(--bg-surface);border:1px solid var(--border-subtle);
            border-radius:var(--radius-sm);font-size:0.8125rem;margin-bottom:16px;">
          <div style="display:flex;gap:8px;justify-content:center;">
            <a href="${esc(result.url)}" target="_blank" class="btn btn-primary btn-sm">Abrir link</a>
            <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText('${esc(result.url)}');this.textContent='✓ Copiado!'">Copiar</button>
            <button class="btn btn-ghost btn-sm" onclick="this.closest('[style*=fixed]').remove()">Fechar</button>
          </div>
        </div>`;
        document.body.appendChild(rm);
        rm.addEventListener('click', e => { if (e.target === rm) rm.remove(); });
      } else {
        toast.success('Material gerado e download iniciado!');
      }
    } catch(e) {
      console.error('[PRIMETOUR] Erro ao gerar:', e);
      toast.error('Erro ao gerar: ' + (e.message || 'desconhecido'));
      btn.disabled = false; btn.textContent = `✈ Gerar ${fmtLabel}`;
    }
  });

  refreshSegList();
  refreshRightPanel();
}


/* ─── Re-generation editor (edit saved material) ──────────── */
async function showRegenEditor({ link, tip, dest }) {
  const existing = document.getElementById('regen-modal');
  if (existing) existing.remove();

  // Deep-clone tipData from saved link
  const workingTips = (link.tipData || []).map(({ tip: t, dest: d }) => ({
    tip:  JSON.parse(JSON.stringify(t || {})),
    dest: d,
  }));
  if (!workingTips.length) { toast.error('Dados do material não encontrados.'); return; }

  const segments  = link.segments || [];
  const area      = { name: link.areaName, logoUrl: link.areaLogoUrl, colors: link.colors };
  const fmt       = link.format || 'web';
  const fmtLabel  = FMT_LABELS[fmt] || fmt;
  const token     = link.token || link.id;

  // Load available images for each dest
  const imagesByDest = {};
  for (const { dest: d } of workingTips) {
    if (d?.id) {
      try {
        const imgs = await fetchImages({ continent: d.continent, country: d.country, city: d.city });
        imagesByDest[d.id] = imgs;
      } catch { imagesByDest[d.id] = []; }
    }
  }

  // Read existing overrides back from saved imagesByDest
  const selectedImages = {};
  for (const [destId, imgs] of Object.entries(link.imagesByDest || {})) {
    if (imgs._overrides) selectedImages[destId] = imgs._overrides;
  }

  const modal = document.createElement('div');
  modal.id    = 'regen-modal';
  modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:2000;
    display:flex;align-items:center;justify-content:center;padding:16px;`;

  const activeSeg = segments.filter(k =>
    workingTips.some(({ tip: t }) => {
      const seg = t?.segments?.[k];
      if (!seg) return false;
      if (seg.info && Object.values(seg.info).some(v => v && String(v).trim())) return true;
      return Array.isArray(seg.items) && seg.items.length > 0;
    })
  );

  let curDestIdx  = 0;
  let curSegKey   = activeSeg[0] || '';

  // ── Build static shell once ───────────────────────────────
  const webUrl = fmt === 'web' && token
    ? (window.location.origin + window.location.pathname.replace(/index\.html$/, '') + 'portal-view.html#' + token)
    : null;

  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:900px;max-height:92vh;
      padding:0;overflow:hidden;display:flex;flex-direction:column;">

      <!-- Header -->
      <div style="padding:14px 20px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;gap:12px;flex-shrink:0;">
        <div style="flex:1;">
          <div style="font-weight:700;font-size:1rem;">Editar Material Gerado</div>
          <div style="font-size:0.8125rem;color:var(--text-muted);" id="regen-header-sub">
            ${esc(fmtLabel)} · Alterações salvas no material, sem afetar a dica original
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <span style="font-size:0.75rem;padding:3px 10px;background:var(--brand-gold)15;
            color:var(--brand-gold);border-radius:var(--radius-full);font-weight:600;">
            ${esc(fmtLabel)}
          </span>
          <button id="regen-close" style="border:none;background:none;cursor:pointer;
            font-size:1.25rem;color:var(--text-muted);">✕</button>
        </div>
      </div>

      <!-- Dest tabs (static, shown only for multi-dest) -->
      <div id="regen-dest-tabs" style="display:${workingTips.length > 1 ? 'flex' : 'none'};
        overflow-x:auto;border-bottom:1px solid var(--border-subtle);
        background:var(--bg-surface);flex-shrink:0;">
        ${workingTips.map((item, i) => {
          const lbl = [item.dest?.city, item.dest?.country].filter(Boolean).join(', ');
          return `<button class="regen-dest-tab" data-idx="${i}"
            style="padding:10px 16px;border:none;background:none;cursor:pointer;
            font-size:0.8125rem;white-space:nowrap;
            border-bottom:2px solid ${i===0?'var(--brand-gold)':'transparent'};
            color:${i===0?'var(--brand-gold)':'var(--text-muted)'};
            transition:all .15s;">${esc(lbl||`Destino ${i+1}`)}</button>`;
        }).join('')}
      </div>

      <!-- Body -->
      <div style="display:grid;grid-template-columns:200px 1fr;flex:1;overflow:hidden;min-height:0;">
        <div id="regen-seg-list" style="border-right:1px solid var(--border-subtle);
          overflow-y:auto;background:var(--bg-surface);"></div>
        <div id="regen-right-panel" style="overflow-y:auto;padding:20px;"></div>
      </div>

      <!-- Footer -->
      <div style="padding:14px 20px;border-top:1px solid var(--border-subtle);
        background:var(--bg-surface);display:flex;gap:10px;flex-shrink:0;">
        <button class="btn btn-secondary" id="regen-cancel" style="flex:1;">← Fechar</button>
        <button class="btn btn-primary"   id="regen-save"   style="flex:2;font-weight:600;">
          💾 Salvar alterações
        </button>
        ${webUrl ? `
        <a href="${esc(webUrl)}" target="_blank" class="btn btn-secondary"
          style="flex:1;text-decoration:none;text-align:center;">
          🔗 Ver link
        </a>` : ''}
      </div>
    </div>`;

  document.body.appendChild(modal);

  // ── Refresh helpers (update dynamic zones only) ───────────
  const refreshSegList = () => {
    const { tip: wTip } = workingTips[curDestIdx];
    document.getElementById('regen-seg-list').innerHTML = activeSeg.map(k => {
      const seg = SEGMENTS.find(s => s.key === k);
      const isActive = k === curSegKey;
      return `<button class="regen-seg-btn" data-seg="${k}"
        style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;
        padding:12px 14px;border:none;
        background:${isActive?'var(--brand-gold)10':'transparent'};
        border-left:3px solid ${isActive?'var(--brand-gold)':'transparent'};
        cursor:pointer;transition:all .15s;font-size:0.8125rem;">
        <span style="flex:1;color:${isActive?'var(--brand-gold)':'var(--text-secondary)'};">
          ${esc(seg?.label||k)}</span>
      </button>`;
    }).join('');
    document.querySelectorAll('.regen-seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        curSegKey = btn.dataset.seg;
        refreshSegList();
        refreshRightPanel();
      });
    });
  };

  const refreshRightPanel = () => {
    const { tip: wTip, dest: wDest } = workingTips[curDestIdx];
    const destId   = wDest?.id || curDestIdx;
    const destImgs = imagesByDest[destId] || [];
    const segImgs  = selectedImages[destId]?.[curSegKey] || {};
    const panel = document.getElementById('regen-right-panel');
    if (panel) {
      panel.innerHTML = renderSegEditorForList(wTip, curSegKey, destImgs, segImgs, destId);
      panel._refreshRef = { refresh: refreshRightPanel };
    }
    wireRegenEditor(wTip, curSegKey, destImgs, destId, selectedImages, workingTips, curDestIdx);
  };

  const refreshDestTabs = () => {
    document.querySelectorAll('.regen-dest-tab').forEach(btn => {
      const i = Number(btn.dataset.idx);
      btn.style.borderBottomColor = i === curDestIdx ? 'var(--brand-gold)' : 'transparent';
      btn.style.color = i === curDestIdx ? 'var(--brand-gold)' : 'var(--text-muted)';
    });
  };

  // ── Wire events ONCE ──────────────────────────────────────
  document.getElementById('regen-close')?.addEventListener('click', () => modal.remove());
  document.getElementById('regen-cancel')?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  document.querySelectorAll('.regen-dest-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      curDestIdx = Number(btn.dataset.idx);
      curSegKey  = activeSeg[0] || '';
      refreshDestTabs();
      refreshSegList();
      refreshRightPanel();
    });
  });

  // Save — wired ONCE
  document.getElementById('regen-save')?.addEventListener('click', async () => {
    const saveBtn = document.getElementById('regen-save');
    if (!saveBtn || saveBtn.disabled) return;
    saveBtn.disabled = true;
    saveBtn.textContent = '⏳ Salvando…';
    try {
      // Merge overrides into imagesByDest
      const newImagesByDest = JSON.parse(JSON.stringify(link.imagesByDest || {}));
      for (const [dId, overrides] of Object.entries(selectedImages)) {
        if (!newImagesByDest[dId]) newImagesByDest[dId] = { hero: null, gallery: [], banners: {} };
        newImagesByDest[dId]._overrides = overrides;
      }
      await updateWebLink(token, {
        tipData:      workingTips.map(({ tip: t, dest: d }) => ({ tip: t, dest: d })),
        imagesByDest: newImagesByDest,
      });
      toast.success('Material atualizado com sucesso!');
      modal.remove();
    } catch(e) {
      console.error('[PRIMETOUR] Erro ao salvar material:', e);
      toast.error('Erro ao salvar: ' + e.message);
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 Salvar alterações';
    }
  });

  // Initial render
  refreshSegList();
  refreshRightPanel();
}

/* ─── Segment editor (reused from portalTips, standalone copy) */
function renderSegEditorForList(tip, segKey, destImgs, segSelectedImgs, destId) {
  if (!segKey) return '<div style="color:var(--text-muted);padding:20px;">Selecione um segmento.</div>';
  const segDef = SEGMENTS.find(s => s.key === segKey);
  const data   = tip?.segments?.[segKey];
  if (!segDef || !data) return `<div style="color:var(--text-muted);">Sem conteúdo para este segmento.</div>`;

  const LBL = `font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;`;
  const galeria = destImgs.filter ? destImgs.filter(i => i.type === 'galeria' || i.type === 'destaque') : [];

  let html = `<div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;
    letter-spacing:.07em;color:var(--brand-gold);margin-bottom:16px;">${esc(segDef.label)}</div>`;

  if (segDef.mode === 'special_info') {
    const inf = data.info || {};
    const fields = [
      ['descricao','Descrição','textarea',inf.descricao],
      ['dica','Dica','textarea',inf.dica],
      ['populacao','População','text',inf.populacao],
      ['moeda','Moeda','text',inf.moeda],
      ['lingua','Língua oficial','text',inf.lingua],
      ['religiao','Religião','text',inf.religiao],
      ['voltagem','Voltagem','text',inf.voltagem],
      ['ddd','DDD','text',inf.ddd],
    ].filter(([,,,v]) => v !== undefined);
    html += fields.map(([field,label,type,value]) => `
      <div style="margin-bottom:12px;">
        <label style="${LBL}">${esc(label)}</label>
        ${type==='textarea'
          ? `<textarea class="portal-field regen-field" data-seg="${segKey}" data-field="${field}"
              rows="3" style="width:100%;font-size:0.875rem;">${esc(value||'')}</textarea>`
          : `<input type="text" class="portal-field regen-field" data-seg="${segKey}" data-field="${field}"
              value="${esc(value||'')}" style="width:100%;font-size:0.875rem;">`}
      </div>`).join('');
  } else {
    const items = data.items || [];
    if (data.themeDesc !== undefined) {
      html += `<div style="margin-bottom:16px;">
        <label style="${LBL}">Descrição do tema</label>
        <textarea class="portal-field regen-field" data-seg="${segKey}" data-field="themeDesc"
          rows="2" style="width:100%;font-size:0.875rem;">${esc(data.themeDesc||'')}</textarea>
      </div>`;
    }
    html += items.map((item, idx) => `
      <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);
        border-radius:var(--radius-md);padding:14px 16px;margin-bottom:12px;">
        <div style="font-size:0.6875rem;font-weight:700;color:var(--text-muted);
          margin-bottom:10px;display:flex;align-items:center;gap:6px;">
          <span style="background:var(--brand-gold);color:#fff;border-radius:50%;
            width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;
            font-size:0.5rem;font-weight:800;flex-shrink:0;">${idx+1}</span>
          <span style="flex:1;">${esc(item.titulo || item.title || `Item ${idx+1}`)}</span>
          <button class="regen-item-del btn btn-ghost" data-seg="${segKey}" data-idx="${idx}"
            style="padding:1px 5px;font-size:0.7rem;color:#EF4444;margin-left:auto;">
            ✕ remover</button>
        </div>
        <div style="margin-bottom:8px;">
          <label style="${LBL}">${item.titulo!==undefined?'Título':'Nome'}</label>
          <input type="text" class="portal-field regen-item-field" data-seg="${segKey}"
            data-idx="${idx}" data-subfield="${item.titulo!==undefined?'titulo':'title'}"
            value="${esc(item.titulo||item.title||'')}" style="width:100%;font-size:0.875rem;">
        </div>
        ${item.descricao!==undefined ? `
        <div style="margin-bottom:8px;">
          <label style="${LBL}">Descrição</label>
          <textarea class="portal-field regen-item-field" data-seg="${segKey}"
            data-idx="${idx}" data-subfield="descricao" rows="3"
            style="width:100%;font-size:0.875rem;">${esc(item.descricao||'')}</textarea>
        </div>` : ''}
        ${item.observacoes!==undefined ? `
        <div style="margin-bottom:8px;">
          <label style="${LBL}">Observações</label>
          <input type="text" class="portal-field regen-item-field" data-seg="${segKey}"
            data-idx="${idx}" data-subfield="observacoes"
            value="${esc(item.observacoes||'')}" style="width:100%;font-size:0.875rem;">
        </div>` : ''}
        ${galeria.length > 0 ? `
        <div style="margin-top:10px;">
          <label style="${LBL}">Imagem para este lugar</label>
          <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;">
            <button class="regen-img-none"
              data-seg="${segKey}" data-idx="${idx}"
              style="flex-shrink:0;width:56px;height:42px;border:2px solid
              ${!(segSelectedImgs[idx])?'var(--brand-gold)':'var(--border-subtle)'};
              border-radius:var(--radius-sm);background:var(--bg-surface);cursor:pointer;
              font-size:0.5rem;color:var(--text-muted);display:flex;align-items:center;
              justify-content:center;flex-direction:column;">
              <span style="font-size:0.75rem;">◑</span>auto
            </button>
            ${galeria.slice(0,12).map(img => {
              const isSel = segSelectedImgs[idx]?.url === img.url;
              return `<div style="flex-shrink:0;display:flex;flex-direction:column;gap:2px;">
                <button class="regen-img-pick"
                  data-seg="${segKey}" data-idx="${idx}"
                  data-url="${esc(img.url)}" data-name="${esc(img.name||'')}"
                  style="flex-shrink:0;border:2px solid ${isSel?'var(--brand-gold)':'var(--border-subtle)'};
                  border-radius:var(--radius-sm);overflow:hidden;cursor:pointer;
                  width:72px;height:54px;padding:0;background:none;display:block;">
                  <img src="${esc(img.url)}" alt=""
                    style="width:100%;height:100%;object-fit:cover;"
                    title="${esc(img.name||'')}">
                </button>
                <button class="regen-img-preview btn btn-ghost"
                  data-url="${esc(img.url)}" data-name="${esc(img.name||'')}"
                  style="width:72px;font-size:0.5625rem;padding:1px 0;text-align:center;
                  color:var(--text-muted);" title="Ampliar">⤢</button>
              </div>`;
            }).join('')}
            ${galeria.length > 12 ? `<span style="flex-shrink:0;display:flex;align-items:center;
              font-size:0.6875rem;color:var(--text-muted);white-space:nowrap;padding:0 4px;">
              +${galeria.length-12} mais</span>` : ''}
          </div>
        </div>` : ''}
      </div>`).join('');
  }
  return html;
}

function wireRegenEditor(wTip, segKey, destImgs, destId, selectedImages, workingTips, curDestIdx, panelId = 'regen-right-panel') {
  // Scope all queries to the right panel to avoid cross-modal interference
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const qs = sel => panel.querySelectorAll(sel);

  qs(`.regen-field[data-seg="${segKey}"]`).forEach(el => {
    el.addEventListener('input', () => {
      const field = el.dataset.field;
      if (!wTip.segments?.[segKey]) return;
      if (segKey === 'informacoes_gerais') {
        if (!wTip.segments[segKey].info) wTip.segments[segKey].info = {};
        wTip.segments[segKey].info[field] = el.value;
      } else {
        wTip.segments[segKey][field] = el.value;
      }
      workingTips[curDestIdx].tip = wTip;
    });
  });

  qs(`.regen-item-field[data-seg="${segKey}"]`).forEach(el => {
    el.addEventListener('input', () => {
      const idx = Number(el.dataset.idx);
      const sub = el.dataset.subfield;
      if (!wTip.segments?.[segKey]?.items?.[idx]) return;
      wTip.segments[segKey].items[idx][sub] = el.value;
      workingTips[curDestIdx].tip = wTip;
    });
  });

  if (!selectedImages[destId])          selectedImages[destId] = {};
  if (!selectedImages[destId][segKey])  selectedImages[destId][segKey] = {};

  qs(`.regen-img-pick[data-seg="${segKey}"]`).forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      // Deselect all thumbnails for this item
      qs(`.regen-img-pick[data-seg="${segKey}"][data-idx="${idx}"]`).forEach(b => {
        b.style.borderColor = 'var(--border-subtle)';
      });
      qs(`.regen-img-none[data-seg="${segKey}"][data-idx="${idx}"]`).forEach(b => {
        b.style.borderColor = 'var(--border-subtle)';
      });
      // Select this one
      btn.style.borderColor = 'var(--brand-gold)';
      // Persist selection
      selectedImages[destId][segKey][idx] = { url: btn.dataset.url, name: btn.dataset.name };
    });
  });

  qs(`.regen-img-none[data-seg="${segKey}"]`).forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      qs(`.regen-img-pick[data-seg="${segKey}"][data-idx="${idx}"]`).forEach(b => {
        b.style.borderColor = 'var(--border-subtle)';
      });
      btn.style.borderColor = 'var(--brand-gold)';
      delete selectedImages[destId]?.[segKey]?.[idx];
    });
  });

  // Delete item — re-renders the panel
  qs(`.regen-item-del[data-seg="${segKey}"]`).forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      if (!wTip.segments?.[segKey]?.items) return;
      wTip.segments[segKey].items.splice(idx, 1);
      workingTips[curDestIdx].tip = wTip;
      // Trigger re-render via stored ref
      const p = document.getElementById(panelId);
      if (p?._refreshRef?.refresh) p._refreshRef.refresh();
    });
  });

  // Image preview lightbox
  qs('.regen-img-preview').forEach(btn => {
    btn.addEventListener('click', () => {
      const url  = btn.dataset.url;
      const name = btn.dataset.name || '';
      if (!url) return;
      const lb = document.createElement('div');
      lb.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:9999;
        display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;
        cursor:zoom-out;`;
      lb.innerHTML = `
        <img src="${esc(url)}" alt="${esc(name)}"
          style="max-width:90vw;max-height:80vh;object-fit:contain;border-radius:4px;
          box-shadow:0 8px 40px rgba(0,0,0,.6);">
        <div style="color:rgba(255,255,255,.7);font-size:0.875rem;">${esc(name)}</div>
        <div style="font-size:0.75rem;color:rgba(255,255,255,.4);">Clique para fechar</div>`;
      lb.addEventListener('click', () => lb.remove());
      document.body.appendChild(lb);
    });
  });
}

/* ─── Expiry helpers ──────────────────────────────────────── */
function hasExpiredSegment(tip, now) {
  return SEGMENTS.some(s => {
    const seg = tip.segments?.[s.key];
    return seg?.hasExpiry && seg?.expiryDate && new Date(seg.expiryDate) < now;
  });
}

function hasExpiringSegment(tip, now, deadline) {
  return SEGMENTS.some(s => {
    const seg = tip.segments?.[s.key];
    return seg?.hasExpiry && seg?.expiryDate
      && new Date(seg.expiryDate) >= now
      && new Date(seg.expiryDate) <= deadline;
  });
}

function hasAnyExpiry(tip) {
  return SEGMENTS.some(s => tip.segments?.[s.key]?.hasExpiry);
}

/* ─── Preview Modal ───────────────────────────────────────── */
function showPreviewModal(tip, dest) {
  const existing = document.getElementById('tip-preview-modal');
  if (existing) existing.remove();

  const destLabel = [dest?.city, dest?.country, dest?.continent].filter(Boolean).join(', ') || '—';
  const segsWithContent = SEGMENTS.filter(s => {
    const seg = tip?.segments?.[s.key];
    if (!seg) return false;
    if (seg.info && Object.values(seg.info).some(v => v && String(v).trim())) return true;
    return Array.isArray(seg.items) && seg.items.length > 0;
  });

  const modal = document.createElement('div');
  modal.id = 'tip-preview-modal';
  modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:2000;
    display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;`;

  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:760px;padding:0;overflow:hidden;
      margin:auto;max-height:90vh;display:flex;flex-direction:column;">

      <!-- Header -->
      <div style="padding:18px 24px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;gap:12px;
        flex-shrink:0;">
        <div style="flex:1;">
          <div style="font-weight:700;font-size:1.0625rem;">${esc(destLabel)}</div>
          <div style="font-size:0.8125rem;color:var(--text-muted);margin-top:2px;">
            ${segsWithContent.length} segmento${segsWithContent.length!==1?'s':''} com conteúdo
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <button id="preview-close-btn" style="border:none;background:none;cursor:pointer;
            font-size:1.25rem;color:var(--text-muted);padding:0 4px;">✕</button>
        </div>
      </div>

      <!-- Segment tabs -->
      <div style="display:flex;gap:0;overflow-x:auto;border-bottom:1px solid var(--border-subtle);
        flex-shrink:0;background:var(--bg-surface);">
        ${segsWithContent.map((s, i) => `
          <button class="preview-seg-tab" data-seg="${esc(s.key)}"
            style="padding:10px 14px;border:none;background:none;cursor:pointer;
            font-size:0.8125rem;white-space:nowrap;color:var(--text-muted);
            border-bottom:2px solid ${i===0?'var(--brand-gold)':'transparent'};
            color:${i===0?'var(--brand-gold)':'var(--text-muted)'};
            transition:all .15s;">
            ${esc(s.label)}
          </button>`).join('')}
      </div>

      <!-- Content -->
      <div id="preview-content" style="padding:24px;overflow-y:auto;flex:1;min-height:200px;">
        ${segsWithContent.length ? renderSegPreview(tip, segsWithContent[0].key) : '<div style="color:var(--text-muted);text-align:center;padding:40px;">Sem conteúdo.</div>'}
      </div>

      <!-- Footer -->
      <div style="padding:14px 24px;border-top:1px solid var(--border-subtle);
        background:var(--bg-surface);display:flex;justify-content:flex-end;gap:8px;flex-shrink:0;">
        <button id="preview-close-btn2" class="btn btn-ghost btn-sm">Fechar</button>
        <button id="preview-edit-btn" class="btn btn-primary btn-sm">✎ Editar original</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById('preview-close-btn')?.addEventListener('click', close);
  document.getElementById('preview-close-btn2')?.addEventListener('click', close);
  document.getElementById('preview-edit-btn')?.addEventListener('click', () => {
    close();
    location.hash = `portal-tip-editor?destId=${encodeURIComponent(tip.destinationId)}`;
  });
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  // Tab switching
  modal.querySelectorAll('.preview-seg-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      modal.querySelectorAll('.preview-seg-tab').forEach(t => {
        t.style.borderBottomColor = 'transparent';
        t.style.color = 'var(--text-muted)';
      });
      tab.style.borderBottomColor = 'var(--brand-gold)';
      tab.style.color = 'var(--brand-gold)';
      document.getElementById('preview-content').innerHTML =
        renderSegPreview(tip, tab.dataset.seg);
    });
  });
}

function renderSegPreview(tip, segKey) {
  const segDef = SEGMENTS.find(s => s.key === segKey);
  const data   = tip?.segments?.[segKey];
  if (!segDef || !data) return '<div style="color:var(--text-muted);">Sem dados.</div>';

  const LBL = 'font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);margin-bottom:4px;';
  const VAL = 'font-size:0.9375rem;color:var(--text-primary);';

  if (segDef.mode === 'special_info') {
    const inf = data.info || {};
    const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const fields = [
      ['Descrição', inf.descricao], ['Dica', inf.dica],
      ['População', inf.populacao], ['Moeda', inf.moeda],
      ['Língua oficial', inf.lingua], ['Religião', inf.religiao],
      ['Fuso horário', inf.fusoSinal && inf.fusoHoras ? `${inf.fusoSinal}${inf.fusoHoras}h de Brasília` : ''],
      ['Voltagem', inf.voltagem], ['DDD', inf.ddd],
    ].filter(([,v]) => v);

    const cli = inf.clima || {};
    const hasClima = MONTHS.some((_,i) => cli[`max_${i}`] || cli[`min_${i}`]);

    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
        ${fields.map(([l,v]) => `
          <div style="background:var(--bg-surface);border-radius:var(--radius-sm);padding:10px 12px;">
            <div style="${LBL}">${esc(l)}</div>
            <div style="${VAL}">${esc(v)}</div>
          </div>`).join('')}
      </div>
      ${hasClima ? `
        <div style="margin-bottom:12px;">
          <div style="${LBL}">Clima (°C)</div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:0.8125rem;margin-top:6px;">
              <thead><tr>
                <th style="text-align:left;padding:5px 8px;color:var(--text-muted);font-size:0.6875rem;">°C</th>
                ${MONTHS.map(m=>`<th style="padding:5px 6px;color:var(--text-muted);font-size:0.6875rem;">${m}</th>`).join('')}
              </tr></thead>
              <tbody>
                <tr style="color:#F97316;">
                  <td style="padding:5px 8px;font-weight:600;font-size:0.75rem;">↑</td>
                  ${MONTHS.map((_,i)=>`<td style="text-align:center;padding:5px 6px;">${cli[`max_${i}`]??'—'}</td>`).join('')}
                </tr>
                <tr style="color:#38BDF8;">
                  <td style="padding:5px 8px;font-weight:600;font-size:0.75rem;">↓</td>
                  ${MONTHS.map((_,i)=>`<td style="text-align:center;padding:5px 6px;">${cli[`min_${i}`]??'—'}</td>`).join('')}
                </tr>
              </tbody>
            </table>
          </div>
        </div>` : ''}
      ${inf.representacao?.nome ? `
        <div style="background:var(--bg-surface);border-radius:var(--radius-sm);padding:12px 14px;">
          <div style="${LBL};margin-bottom:8px;">Representação Brasileira</div>
          ${[['Nome',inf.representacao.nome],['Endereço',inf.representacao.endereco],
             ['Telefone',inf.representacao.telefone],['Site',inf.representacao.link]]
            .filter(([,v])=>v)
            .map(([l,v])=>`<div style="font-size:0.875rem;margin-bottom:4px;">
              <strong>${esc(l)}:</strong> ${esc(v)}</div>`).join('')}
        </div>` : ''}
    `;
  }

  if (segDef.mode === 'simple_list') {
    const items = (data.items || []).filter(i => i.title);
    if (!items.length) return '<div style="color:var(--text-muted);">Sem itens.</div>';
    return items.map(item => `
      <div style="padding:12px 0;border-bottom:1px solid var(--border-subtle)88;">
        <div style="font-weight:600;font-size:0.9375rem;margin-bottom:4px;">${esc(item.title)}</div>
        ${item.description ? `<div style="font-size:0.875rem;color:var(--text-muted);">${esc(item.description)}</div>` : ''}
      </div>`).join('');
  }

  // place_list / agenda
  const items = (data.items || []).filter(i => i.titulo);
  if (!items.length && !data.themeDesc) return '<div style="color:var(--text-muted);">Sem itens.</div>';
  return `
    ${data.themeDesc ? `<p style="color:var(--text-muted);font-style:italic;margin-bottom:16px;">${esc(data.themeDesc)}</p>` : ''}
    ${segDef.mode === 'agenda' && data.periodoAgenda ? `
      <div style="font-size:0.875rem;color:var(--brand-gold);margin-bottom:12px;">📅 ${esc(data.periodoAgenda)}</div>` : ''}
    <div style="display:flex;flex-direction:column;gap:12px;">
      ${items.map(item => `
        <div style="background:var(--bg-surface);border-radius:var(--radius-sm);
          padding:14px 16px;border:1px solid var(--border-subtle);">
          ${item.categoria ? `<div style="font-size:0.6875rem;color:var(--brand-gold);text-transform:uppercase;
            letter-spacing:.07em;margin-bottom:4px;">${esc(item.categoria)}</div>` : ''}
          <div style="font-weight:700;font-size:0.9375rem;margin-bottom:6px;">${esc(item.titulo)}</div>
          ${item.descricao ? `<div style="font-size:0.875rem;color:var(--text-muted);margin-bottom:8px;line-height:1.5;">${esc(item.descricao)}</div>` : ''}
          <div style="display:flex;flex-wrap:wrap;gap:10px;font-size:0.8125rem;color:var(--text-muted);">
            ${item.endereco ? `<span>📍 ${esc(item.endereco)}</span>` : ''}
            ${item.telefone ? `<span>📞 ${esc(item.telefone)}</span>` : ''}
            ${item.site     ? `<a href="${esc(item.site)}" target="_blank" style="color:var(--brand-gold);text-decoration:none;">🌐 Site</a>` : ''}
            ${item.periodo  ? `<span>📅 ${esc(item.periodo)}</span>` : ''}
          </div>
          ${item.observacoes ? `<div style="margin-top:6px;font-size:0.8125rem;color:var(--text-muted);font-style:italic;">💡 ${esc(item.observacoes)}</div>` : ''}
        </div>`).join('')}
    </div>
  `;
}
