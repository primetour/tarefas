/**
 * PRIMETOUR — Portal de Dicas: Lista de Dicas
 * Visualização, edição, exclusão e controle de validade
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import {
  fetchTips, fetchDestinations, fetchAreas, deleteTip,
  SEGMENTS,
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
          <button class="btn btn-ghost btn-sm tip-preview-btn"
            data-id="${r.id}" data-dest-id="${r.destinationId}"
            style="font-size:0.75rem;color:var(--text-muted);">👁 Preview</button>
          <a href="#portal-tip-editor?destId=${r.destinationId}" class="btn btn-ghost btn-sm"
            style="font-size:0.75rem;text-decoration:none;color:var(--brand-gold);">✎ Editar</a>
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
          <a href="#portal-tip-editor?destId=${esc(tip.destinationId)}"
            class="btn btn-secondary btn-sm"
            style="text-decoration:none;font-size:0.8125rem;">✎ Editar</a>
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
        <a href="#portal-tip-editor?destId=${esc(tip.destinationId)}"
          class="btn btn-primary btn-sm" style="text-decoration:none;">✎ Editar dica</a>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById('preview-close-btn')?.addEventListener('click', close);
  document.getElementById('preview-close-btn2')?.addEventListener('click', close);
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
