/**
 * PRIMETOUR — Portal de Dicas: Lista de Dicas
 * Visualização, edição, exclusão e controle de validade
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import {
  fetchTips, fetchDestinations, deleteTip,
  SEGMENTS,
} from '../services/portal.js';

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
  const kpis = [
    { label: 'Total de dicas',  value: allTips.length, color: 'var(--text-primary)' },
    { label: 'Vencidas',        value: expired,  color: expired  > 0 ? '#EF4444' : '#22C55E' },
    { label: 'Vencendo em 30d', value: expiring, color: expiring > 0 ? '#F59E0B' : '#22C55E' },
    { label: 'Em dia',          value: allTips.length - expired - expiring, color: '#22C55E' },
  ];
  el.innerHTML = kpis.map(k => `
    <div class="card" style="padding:14px 16px;">
      <div style="font-size:0.6875rem;color:var(--text-muted);text-transform:uppercase;
        letter-spacing:.06em;margin-bottom:6px;">${k.label}</div>
      <div style="font-size:1.5rem;font-weight:700;color:${k.color};">${k.value}</div>
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
        <div style="font-weight:600;font-size:0.9375rem;">${esc(label)}</div>
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
          <a href="#portal-tip-editor?destId=${r.destinationId}" class="btn btn-ghost btn-sm"
            style="font-size:0.75rem;text-decoration:none;color:var(--brand-gold);">✎ Editar</a>
          <button class="btn btn-ghost btn-sm tip-delete-btn" data-id="${r.id}"
            data-label="${esc(label)}"
            style="font-size:0.75rem;color:#EF4444;">✕</button>
        </div>
      </td>
    </tr>`;
  }).join('');

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
