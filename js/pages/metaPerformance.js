/**
 * PRIMETOUR — Performance Redes Sociais
 * Lê dados sincronizados da Meta Graph API via Firestore
 */

import { store }      from '../store.js';
import { toast }      from '../components/toast.js';
import {
  collection, getDocs, query, orderBy, limit, where,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase.js';
import { createDoc, loadJsPdf, COL, txt, withExportGuard } from '../components/pdfKit.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num  = v => (v != null ? Number(v).toLocaleString('pt-BR') : '—');
const pct  = v => (v != null ? `${Number(v).toFixed(1)}%` : '—');
const fmt  = ts => {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' }).format(d);
};

const ACCOUNTS = [
  { id: '',                   label: 'Todas as contas'    },
  { id: 'primetourviagens', label: '@primetourviagens' },
  { id: 'icsbyprimetour',   label: '@icsbyprimetour'   },
];

const TYPES = [
  { id: '',          label: 'Todos os tipos' },
  { id: 'Post',      label: 'Post'           },
  { id: 'Reel',      label: 'Reel'           },
  { id: 'Carrossel', label: 'Carrossel'      },
  { id: 'Story',     label: 'Story'          },
];

const PERIODS = [
  { value: '7',   label: 'Últimos 7 dias'  },
  { value: '30',  label: 'Últimos 30 dias' },
  { value: '90',  label: 'Últimos 90 dias' },
  { value: '365', label: 'Último ano'      },
];

const COLS = [
  { key: 'postedAt',       label: 'Data'               },
  { key: 'mediaType',      label: 'Tipo'               },
  { key: 'reach',          label: 'Alcance'            },
  { key: 'exits',          label: 'Saídas'             , storyOnly: true  },
  { key: 'tapsForward',    label: 'Taps Frente'         , storyOnly: true  },
  { key: 'tapsBack',       label: 'Taps Voltar'         , storyOnly: true  },
  { key: 'likes',          label: 'Curtidas'           , noStory: true    },
  { key: 'comments',       label: 'Comentários'        , noStory: true    },
  { key: 'saved',          label: 'Salvamentos'        , noStory: true    },
  { key: 'shares',         label: 'Compartilhamentos'  , noStory: true    },
  { key: 'plays',          label: 'Plays (Reels)'      , reelOnly: true   },
  { key: 'replies',        label: 'Respostas'          , storyOnly: true  },
  { key: 'engagement',     label: 'Engajamento'        , noStory: true    },
  { key: 'engagementRate', label: '% Engajamento'      , noStory: true    },
];

let allData     = [];
let filterAcct  = '';
let filterType  = '';
let filterDays  = '30';
let sortKey     = 'postedAt';
let sortDir     = -1;
let hiddenRows  = new Set();

/* ─── Render page ─────────────────────────────────────────── */
export async function renderMetaPerformance(container) {
  if (!store.can('system_manage_users') && !store.isMaster() &&
      !store.can('analytics_view')) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Performance Redes Sociais</h1>
        <p class="page-subtitle">Instagram Business — dados via Meta Graph API</p>
      </div>
      <div class="page-header-actions" style="gap:8px;flex-wrap:wrap;">
        <span id="meta-sync-status" style="font-size:0.75rem;color:var(--text-muted);"></span>
        <a href="https://github.com/primetour/tarefas/actions/workflows/meta-sync.yml"
          target="_blank" rel="noopener" class="btn btn-secondary btn-sm"
          style="display:flex;align-items:center;gap:6px;text-decoration:none;">↗ Sincronizar</a>
        <button class="btn btn-secondary btn-sm" id="meta-export-xlsx">⬇ XLSX</button>
        <button class="btn btn-secondary btn-sm" id="meta-export-pdf">⬇ PDF</button>
      </div>
    </div>

    <!-- Token expiration / sync health banner -->
    <div id="meta-token-banner" style="display:none;margin-bottom:16px;"></div>

    <!-- Filters -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;align-items:center;">
      <select class="filter-select" id="meta-acct-filter" style="min-width:180px;">
        ${ACCOUNTS.map(a=>`<option value="${a.id}">${esc(a.label)}</option>`).join('')}
      </select>
      <select class="filter-select" id="meta-type-filter" style="min-width:150px;">
        ${TYPES.map(t=>`<option value="${t.id}">${esc(t.label)}</option>`).join('')}
      </select>
      <select class="filter-select" id="meta-period-filter" style="min-width:160px;">
        ${PERIODS.map(p=>`<option value="${p.value}" ${p.value==='30'?'selected':''}>${p.label}</option>`).join('')}
        <option value="custom">Período personalizado…</option>
      </select>
      <div id="meta-custom-range" style="display:none;gap:6px;align-items:center;">
        <input type="date" id="meta-date-from" class="portal-field" style="font-size:0.8125rem;">
        <span style="color:var(--text-muted);font-size:0.8125rem;">→</span>
        <input type="date" id="meta-date-to" class="portal-field" style="font-size:0.8125rem;">
        <button class="btn btn-primary btn-sm" id="meta-apply-range" style="font-size:0.8125rem;">Aplicar</button>
      </div>
      <div style="margin-left:auto;display:flex;align-items:center;gap:8px;">
        <span id="meta-hidden-count" style="font-size:0.75rem;color:var(--text-muted);display:none;"></span>
        <button class="btn btn-ghost btn-sm" id="meta-toggle-edit" style="font-size:0.8125rem;">✎ Pré-editar</button>
        <button class="btn btn-ghost btn-sm" id="meta-restore-all"
          style="font-size:0.8125rem;display:none;color:var(--brand-gold);">↺ Restaurar</button>
        <span id="meta-count" style="font-size:0.8125rem;color:var(--text-muted);"></span>
      </div>
    </div>

    <!-- KPI cards -->
    <div id="meta-kpis" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));
      gap:12px;margin-bottom:24px;">
      ${[0,1,2,3,4,5].map(()=>`<div class="card skeleton" style="height:80px;"></div>`).join('')}
    </div>

    <!-- Top posts -->
    <div id="meta-top" style="margin-bottom:24px;"></div>

    <!-- Full table -->
    <div class="card" style="padding:0;overflow:hidden;">
      <div style="overflow-x:auto;max-height:65vh;overflow-y:auto;">
        <table id="meta-table" style="width:100%;border-collapse:separate;border-spacing:0;font-size:0.8125rem;">
          <thead id="meta-thead"></thead>
          <tbody id="meta-tbody">
            <tr><td colspan="15" style="padding:40px;text-align:center;color:var(--text-muted);">
              Carregando…
            </td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  let editMode = false;

  document.getElementById('meta-acct-filter')?.addEventListener('change', e => {
    filterAcct = e.target.value; renderTable(editMode);
  });
  document.getElementById('meta-type-filter')?.addEventListener('change', e => {
    filterType = e.target.value; renderTable(editMode);
  });
  document.getElementById('meta-period-filter')?.addEventListener('change', e => {
    const val = e.target.value;
    const rangeEl = document.getElementById('meta-custom-range');
    if (val === 'custom') {
      if (rangeEl) rangeEl.style.display = 'flex';
    } else {
      if (rangeEl) rangeEl.style.display = 'none';
      filterDays = val;
      loadData(editMode);
    }
  });
  document.getElementById('meta-apply-range')?.addEventListener('click', () => {
    const from = document.getElementById('meta-date-from')?.value;
    const to   = document.getElementById('meta-date-to')?.value;
    if (!from || !to) return;
    if (from > to) { (window.toast||console).error?.('Data inicial deve ser anterior à final.'); return; }
    filterDays = `custom:${from}:${to}`;
    loadData(editMode);
  });
  document.getElementById('meta-toggle-edit')?.addEventListener('click', () => {
    editMode = !editMode;
    const btn = document.getElementById('meta-toggle-edit');
    if (btn) { btn.textContent = editMode ? '✓ Concluir' : '✎ Pré-editar'; btn.style.color = editMode ? 'var(--brand-gold)' : ''; }
    renderTable(editMode);
  });
  document.getElementById('meta-restore-all')?.addEventListener('click', () => {
    hiddenRows.clear(); updateHiddenCount(); renderTable(editMode);
  });
  document.getElementById('meta-export-xlsx')?.addEventListener('click', exportXLSX);
  document.getElementById('meta-export-pdf')?.addEventListener('click', exportPDF);

  await loadData(editMode);
}

/* ─── Load from Firestore ─────────────────────────────────── */
async function loadData(editMode = false) {
  const tbody = document.getElementById('meta-tbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="15" style="padding:40px;text-align:center;
    color:var(--text-muted);">Carregando…</td></tr>`;

  try {
    let cutoff, cutoffTo = null;
    if (String(filterDays).startsWith('custom:')) {
      const [, from, to] = filterDays.split(':');
      cutoff   = new Date(from + 'T00:00:00');
      cutoffTo = new Date(to   + 'T23:59:59');
    } else {
      cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - parseInt(filterDays));
    }

    const snap = await getDocs(
      query(collection(db, 'meta_performance'), orderBy('postedAt', 'desc'), limit(2000))
    );

    allData = [];
    snap.forEach(d => {
      const data     = { id: d.id, ...d.data() };
      const postedAt = data.postedAt?.toDate?.() || (data.postedAt ? new Date(data.postedAt) : null);
      if (!postedAt || postedAt >= cutoff) allData.push({ ...data, _postedAt: postedAt });
    });

    const status = document.getElementById('meta-sync-status');
    let lastSync = null;
    if (allData.length) {
      const latest = allData.reduce((a,b) => {
        const at = b.syncedAt?.toDate?.(), aa = a.syncedAt?.toDate?.();
        return at && (!aa || at > aa) ? b : a;
      }, allData[0]);
      lastSync = latest.syncedAt?.toDate?.() || null;
      if (status && lastSync) status.textContent = `Sync: ${fmt({ toDate: () => lastSync })}`;
    }
    renderTokenBanner(lastSync);

    renderTable(editMode);
  } catch(e) {
    console.error('meta-performance load error:', e);
    const tbody = document.getElementById('meta-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="15" style="padding:40px;text-align:center;
      color:var(--text-muted);">Erro: ${esc(e.message)}</td></tr>`;
    renderTokenBanner(null);
  }
}

/* ─── Token expiration / sync health banner ──────────────
 * Meta Graph API long-lived access tokens expire every ~60 days.
 * When META_ACCESS_TOKEN expires, the daily GitHub Actions sync
 * (.github/workflows/meta-sync.yml) fails silently and data stops
 * updating. This banner makes the problem visible and gives
 * step-by-step renewal instructions.
 *
 * States:
 *  • ok      → sync < 2 days old: discreet collapsed info
 *  • warn    → sync 2-6 days old: amber banner ("sync atrasada")
 *  • stale   → sync 7+ days old OR no data: red banner
 *              ("token provavelmente expirou")
 */
function renderTokenBanner(lastSync) {
  const el = document.getElementById('meta-token-banner');
  if (!el) return;
  el.style.display = 'block';

  const now = new Date();
  let state = 'ok';
  let daysAgo = null;
  if (!lastSync) {
    state = 'stale';
  } else {
    daysAgo = Math.floor((now - lastSync) / (1000 * 60 * 60 * 24));
    if (daysAgo >= 7) state = 'stale';
    else if (daysAgo >= 2) state = 'warn';
  }

  const COLORS = {
    ok:    { bg:'rgba(34,197,94,0.06)',  border:'rgba(34,197,94,0.3)',  accent:'#22C55E', icon:'ℹ', title:'Token Meta vence a cada ~60 dias' },
    warn:  { bg:'rgba(245,158,11,0.08)', border:'rgba(245,158,11,0.4)', accent:'#F59E0B', icon:'⚠', title:'Sincronização atrasada' },
    stale: { bg:'rgba(239,68,68,0.08)',  border:'rgba(239,68,68,0.5)',  accent:'#EF4444', icon:'🔴', title:'Sincronização parou — token Meta provavelmente expirou' },
  };
  const c = COLORS[state];

  const stateMsg = state === 'stale'
    ? (lastSync
        ? `Última sincronização há <strong>${daysAgo} dias</strong>. O sync diário (06:00 BRT) não está rodando. Causa mais provável: <code>META_ACCESS_TOKEN</code> expirou.`
        : `Nenhuma sincronização registrada. O sync diário pode nunca ter rodado ou o token expirou.`)
    : state === 'warn'
    ? `Última sincronização há ${daysAgo} dias. Se não atualizar nas próximas 24h, provavelmente é token expirado.`
    : `Sincronização diária ativa. Se os dados pararem de atualizar, expanda abaixo para instruções de renovação.`;

  const expanded = state !== 'ok';  // always expanded when warn/stale

  el.innerHTML = `
    <div style="padding:14px 16px;border:1px solid ${c.border};background:${c.bg};border-radius:8px;
      font-family:var(--font-ui);">
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <div style="font-size:1.25rem;line-height:1;margin-top:1px;">${c.icon}</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
            <div style="font-weight:600;color:${c.accent};font-size:0.9375rem;">${c.title}</div>
            ${state==='ok' ? `<button id="meta-token-toggle" class="btn btn-ghost btn-sm"
              style="font-size:0.75rem;color:var(--text-muted);">Ver instruções de renovação ▾</button>` : ''}
          </div>
          <div style="font-size:0.8125rem;color:var(--text-secondary);margin-top:4px;line-height:1.5;">
            ${stateMsg}
          </div>
          <div id="meta-token-details" style="display:${expanded?'block':'none'};margin-top:12px;
            padding-top:12px;border-top:1px dashed ${c.border};">
            <div style="font-size:0.8125rem;color:var(--text-primary);font-weight:600;margin-bottom:8px;">
              Passos para renovar o token (leva ~5 min):
            </div>
            <ol style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.7;margin:0;padding-left:20px;">
              <li>
                Acesse o <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener"
                  style="color:${c.accent};text-decoration:underline;">Graph API Explorer</a>
                (logado na conta Meta com acesso às páginas de Instagram)
              </li>
              <li>
                Selecione o app <strong>PRIMETOUR</strong> no dropdown "Meta App" e gere um
                <strong>User Token</strong> com as permissões:
                <code style="font-size:0.75rem;background:var(--bg-card);padding:1px 4px;border-radius:3px;">
                  instagram_basic, instagram_manage_insights, pages_show_list, pages_read_engagement
                </code>
              </li>
              <li>
                Converta o token short-lived em <strong>long-lived</strong> (60 dias) via:
                <code style="display:block;margin-top:4px;font-size:0.72rem;background:var(--bg-card);
                  padding:6px 8px;border-radius:4px;white-space:pre-wrap;word-break:break-all;color:var(--text-primary);">GET https://graph.facebook.com/v25.0/oauth/access_token?grant_type=fb_exchange_token&client_id={META_APP_ID}&client_secret={META_APP_SECRET}&fb_exchange_token={SHORT_LIVED_TOKEN}</code>
              </li>
              <li>
                Copie o novo <code>access_token</code> retornado e cole em
                <a href="https://github.com/primetour/tarefas/settings/secrets/actions/META_ACCESS_TOKEN"
                  target="_blank" rel="noopener"
                  style="color:${c.accent};text-decoration:underline;">
                  GitHub → Secrets → <code>META_ACCESS_TOKEN</code>
                </a>
                (clique em "Update secret")
              </li>
              <li>
                Valide: rode o workflow manualmente em
                <a href="https://github.com/primetour/tarefas/actions/workflows/meta-sync.yml"
                  target="_blank" rel="noopener"
                  style="color:${c.accent};text-decoration:underline;">
                  GitHub Actions → Sync Meta Instagram → Run workflow
                </a>
                e confira se conclui com ✓ verde
              </li>
              <li>
                Volte nesta página e confirme que o "Sync:" no canto superior direito
                mostra a hora atual.
              </li>
            </ol>
            <div style="margin-top:10px;padding:8px 10px;background:var(--bg-card);border-radius:4px;
              font-size:0.75rem;color:var(--text-muted);line-height:1.5;">
              💡 <strong>Dica:</strong> anote na sua agenda um lembrete para renovar o token
              a cada 50 dias (10 dias antes do vencimento). Depois de renovado, o sync diário
              volta automaticamente sem precisar mexer em mais nada.
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Toggle expand/collapse (only in 'ok' state — warn/stale are always expanded)
  if (state === 'ok') {
    const toggle  = el.querySelector('#meta-token-toggle');
    const details = el.querySelector('#meta-token-details');
    toggle?.addEventListener('click', () => {
      const open = details.style.display === 'block';
      details.style.display = open ? 'none' : 'block';
      toggle.textContent = open ? 'Ver instruções de renovação ▾' : 'Esconder instruções ▴';
    });
  }
}

/* ─── Filtered + sorted rows ─────────────────────────────── */
function getRows(includeHidden = false) {
  let rows = allData;
  if (filterAcct) rows = rows.filter(r => r.accountHandle === filterAcct);
  if (filterType) rows = rows.filter(r => r.mediaType    === filterType);
  if (!includeHidden) rows = rows.filter(r => !hiddenRows.has(r.mediaId));
  return [...rows].sort((a, b) => {
    let va = a[sortKey], vb = b[sortKey];
    if (sortKey === 'postedAt') { va = a._postedAt; vb = b._postedAt; }
    if (va == null) return 1; if (vb == null) return -1;
    if (typeof va === 'string') return sortDir * va.localeCompare(vb, 'pt-BR');
    return sortDir * (va - vb);
  });
}

/* ─── Render table ────────────────────────────────────────── */
function renderTable(editMode = false) {
  const allRows     = getRows(true);
  const visibleRows = allRows.filter(r => !hiddenRows.has(r.mediaId));

  const count = document.getElementById('meta-count');
  if (count) count.textContent = `${allRows.length} posts`;
  updateHiddenCount();
  renderKpis(visibleRows);
  renderTopPosts(visibleRows);

  const stickyBase = `position:sticky;z-index:2;background:var(--bg-card);`;
  const stickyHead = `position:sticky;z-index:3;background:var(--bg-surface);`;
  const editOffset = editMode ? 36 : 0;

  // Fixed cols: [edit?36] [thumb:56] [caption:220] — after that scrollable
  const col1left = editOffset;        // thumb
  const col2left = editOffset + 56;   // caption
  const afterFixed = col2left + 220;

  const thFix = (left, w, label, sk) => {
    const active = sk === sortKey;
    return `<th data-sort="${sk}" class="ms-sort-th"
      style="${stickyHead}left:${left}px;min-width:${w}px;max-width:${w}px;
      padding:10px 10px;font-size:0.6875rem;font-weight:600;text-transform:uppercase;
      letter-spacing:.05em;white-space:nowrap;cursor:pointer;
      border-bottom:1px solid var(--border-subtle);
      ${active?'color:var(--brand-gold);':'color:var(--text-muted);'}
      ${left+w===afterFixed?'box-shadow:4px 0 8px -4px rgba(0,0,0,.25);':''}">
      ${label}${active?(sortDir===-1?' ↓':' ↑'):''}
    </th>`;
  };
  const tdFix = (left, w, content, extra='') =>
    `<td style="${stickyBase}left:${left}px;min-width:${w}px;max-width:${w}px;
      padding:8px 10px;vertical-align:middle;
      ${left+w===afterFixed?'box-shadow:4px 0 8px -4px rgba(0,0,0,.2);':''}${extra}">
      ${content}
    </td>`;

  const thScroll = (c) => {
    const active = c.key === sortKey;
    return `<th data-sort="${c.key}" class="ms-sort-th"
      style="padding:10px 12px;font-size:0.6875rem;font-weight:600;text-transform:uppercase;
      letter-spacing:.05em;white-space:nowrap;cursor:pointer;
      border-bottom:1px solid var(--border-subtle);
      ${active?'color:var(--brand-gold);':'color:var(--text-muted);'}">
      ${c.label}${active?(sortDir===-1?' ↓':' ↑'):''}
    </th>`;
  };

  // Header
  const thead = document.getElementById('meta-thead');
  if (thead) {
    const haAcct = !filterAcct;
    thead.innerHTML = `<tr style="background:var(--bg-surface);">
      ${editMode ? `<th style="${stickyHead}left:0;min-width:36px;padding:10px 8px;
        border-bottom:1px solid var(--border-subtle);"></th>` : ''}
      ${thFix(col1left, 56, '', 'thumbnailUrl')}
      ${thFix(col2left, 220, 'Legenda', 'caption')}
      ${haAcct ? `<th style="padding:10px 12px;font-size:0.6875rem;font-weight:600;
        text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);
        white-space:nowrap;border-bottom:1px solid var(--border-subtle);">Conta</th>` : ''}
      ${COLS.map(thScroll).join('')}
    </tr>`;
    thead.querySelectorAll('.ms-sort-th').forEach(th => {
      th.addEventListener('click', () => {
        if (sortKey === th.dataset.sort) sortDir *= -1;
        else { sortKey = th.dataset.sort; sortDir = -1; }
        renderTable(editMode);
      });
    });
  }

  // Body
  const tbody = document.getElementById('meta-tbody');
  if (!tbody) return;
  const rows = getRows(true);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="15" style="padding:48px;text-align:center;
      color:var(--text-muted);">Nenhum post encontrado para o período selecionado.</td></tr>`;
    return;
  }

  const haAcct = !filterAcct;

  tbody.innerHTML = rows.map(r => {
    const hidden   = hiddenRows.has(r.mediaId);
    const rowStyle = hidden ? 'opacity:.35;text-decoration:line-through;' : 'border-bottom:1px solid var(--border-subtle);';
    const thumb    = r.thumbnailUrl
      ? `<img src="${esc(r.thumbnailUrl)}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;" loading="lazy" onerror="this.style.display='none'">`
      : `<div style="width:40px;height:40px;background:var(--bg-surface);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:0.625rem;color:var(--text-muted);">${r.mediaType?.[0]||'?'}</div>`;
    const caption  = r.caption ? `<span style="font-size:0.75rem;color:var(--text-secondary);line-height:1.4;" title="${esc(r.caption)}">${esc(r.caption.slice(0,80))}${r.caption.length>80?'…':''}</span>` : '<span style="color:var(--text-muted);font-size:0.75rem;">—</span>';
    const typeChip = typeBadge(r.mediaType);
    const acctChip = acctBadge(r.accountHandle);

    return `<tr style="${rowStyle}transition:background .1s;"
      onmouseover="if(!this.dataset.h)this.style.background='var(--bg-surface)'"
      onmouseout="this.style.background=''" data-h="${hidden}">
      ${editMode ? `<td style="position:sticky;left:0;z-index:2;background:var(--bg-card);
        min-width:36px;padding:8px;text-align:center;vertical-align:middle;">
        <button class="ms-hide-btn" data-mid="${r.mediaId}"
          style="border:none;background:none;cursor:pointer;font-size:0.875rem;
          color:${hidden?'var(--brand-gold)':'var(--text-muted)'};">${hidden?'👁':'✕'}</button>
      </td>` : ''}
      ${tdFix(col1left, 56, thumb)}
      ${tdFix(col2left, 220, caption, 'white-space:normal;')}
      ${haAcct ? `<td style="padding:8px 12px;vertical-align:middle;white-space:nowrap;">${acctChip}</td>` : ''}
      <td style="padding:8px 12px;vertical-align:middle;white-space:nowrap;color:var(--text-muted);font-size:0.75rem;">${fmt(r.postedAt)}</td>
      <td style="padding:8px 12px;vertical-align:middle;">${typeChip}</td>
      <td style="padding:8px 12px;text-align:right;vertical-align:middle;">${num(r.reach)}</td>
      ${storyCell(r, num(r.likes),    false, true)}
      ${storyCell(r, num(r.comments), false, true)}
      ${storyCell(r, num(r.saved),    false, true)}
      ${storyCell(r, num(r.shares),   false, true)}
      <td style="padding:8px 12px;text-align:right;vertical-align:middle;color:var(--text-muted);">${r.mediaType==='Reel'?num(r.plays):'—'}</td>
      ${storyCell(r, num(r.exits),       true, false)}
      ${storyCell(r, num(r.tapsForward), true, false)}
      ${storyCell(r, num(r.tapsBack),    true, false)}
      ${storyCell(r, num(r.replies),     true, false)}
      ${storyCell(r, num(r.engagement),          false, true)}
      ${storyCell(r, pct(r.engagementRate), false, true, engColor(r.engagementRate))}
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.ms-hide-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const mid = btn.dataset.mid;
      if (hiddenRows.has(mid)) hiddenRows.delete(mid); else hiddenRows.add(mid);
      renderTable(editMode);
    });
  });
}

/* ─── KPI cards ───────────────────────────────────────────── */
function renderKpis(rows) {
  const el = document.getElementById('meta-kpis');
  if (!el) return;
  if (!rows.length) { el.innerHTML = ''; return; }

  const avg = key => {
    const vals = rows.map(r => r[key]).filter(v => v != null && !isNaN(v));
    return vals.length ? vals.reduce((a,b) => a+b, 0) / vals.length : 0;
  };
  const sum = key => rows.reduce((a,r) => a + (Number(r[key])||0), 0);
  const max = (key) => rows.reduce((best, r) => {
    return (Number(r[key])||0) > (Number(best[key])||0) ? r : best;
  }, rows[0]);

  const bestReach = max('reach');

  const kpis = [
    { label: 'Posts',             value: rows.length.toLocaleString('pt-BR'),        sub: 'no período' },
    { label: 'Alcance médio',     value: Math.round(avg('reach')).toLocaleString('pt-BR'), sub: 'por post' },
    { label: 'Engajamento médio', value: pct(avg('engagementRate')),                 sub: 'por post' },
    { label: 'Curtidas totais',   value: sum('likes').toLocaleString('pt-BR'),        sub: 'no período' },
    { label: 'Saves totais',      value: sum('saved').toLocaleString('pt-BR'),        sub: 'no período' },
    { label: 'Maior alcance',     value: num(bestReach?.reach),
      sub: bestReach ? `${bestReach.mediaType} · ${fmt(bestReach.postedAt)}` : '' },
  ];

  el.innerHTML = kpis.map(k => `
    <div class="card" style="padding:14px 16px;">
      <div style="font-size:0.6875rem;color:var(--text-muted);text-transform:uppercase;
        letter-spacing:.06em;margin-bottom:6px;">${k.label}</div>
      <div style="font-size:1.25rem;font-weight:600;color:var(--text-primary);line-height:1.1;">${k.value}</div>
      <div style="font-size:0.6875rem;color:var(--text-muted);margin-top:4px;">${k.sub}</div>
    </div>
  `).join('');
}

/* ─── Top 3 posts ─────────────────────────────────────────── */
function renderTopPosts(rows) {
  const el = document.getElementById('meta-top');
  if (!el || !rows.length) return;

  const top3 = [...rows].sort((a,b) => (b.reach||0)-(a.reach||0)).slice(0,3);

  el.innerHTML = `
    <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
      color:var(--text-muted);margin-bottom:10px;">Top 3 por alcance</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">
      ${top3.map((r,i) => `
        <a href="${esc(r.permalink||'#')}" target="_blank" rel="noopener"
          style="display:flex;gap:12px;text-decoration:none;background:var(--bg-surface);
          border-radius:var(--radius-md);padding:12px;border:1px solid var(--border-subtle);
          transition:border-color .15s;" onmouseover="this.style.borderColor='var(--brand-gold)'"
          onmouseout="this.style.borderColor='var(--border-subtle)'">
          ${r.thumbnailUrl
            ? `<img src="${esc(r.thumbnailUrl)}" style="width:56px;height:56px;object-fit:cover;border-radius:6px;flex-shrink:0;" loading="lazy" onerror="this.style.display='none'">`
            : `<div style="width:56px;height:56px;background:var(--bg-elevated);border-radius:6px;flex-shrink:0;"></div>`}
          <div style="flex:1;overflow:hidden;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
              <span style="font-size:0.6875rem;font-weight:700;color:var(--brand-gold);">#${i+1}</span>
              ${typeBadge(r.mediaType)}
              <span style="font-size:0.6875rem;color:var(--text-muted);">${acctBadge(r.accountHandle)}</span>
            </div>
            <div style="font-size:0.75rem;color:var(--text-secondary);line-height:1.4;
              overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${esc(r.caption||r.mediaType||'—')}
            </div>
            <div style="display:flex;gap:12px;margin-top:6px;font-size:0.75rem;color:var(--text-muted);">
              <span>👁 ${num(r.reach)}</span>
              ${r.mediaType==='Story'
                ? `<span>↩ ${num(r.replies)}</span><span>⏭ ${num(r.tapsForward)}</span>`
                : `<span>❤ ${num(r.likes)}</span><span>💬 ${num(r.comments)}</span>`}
              ${r.mediaType==='Reel'?`<span>▶ ${num(r.plays)}</span>`:''}
            </div>
          </div>
        </a>
      `).join('')}
    </div>
  `;
}

/* ─── Helpers ─────────────────────────────────────────────── */
function updateHiddenCount() {
  const span = document.getElementById('meta-hidden-count');
  const restore = document.getElementById('meta-restore-all');
  const n = hiddenRows.size;
  if (span) { span.textContent = n>0?`${n} oculto${n!==1?'s':''}`:''; span.style.display=n>0?'inline':'none'; }
  if (restore) restore.style.display = n>0?'inline-flex':'none';
}

function typeBadge(type) {
  const colors = { 'Post':'#38BDF8','Reel':'#A78BFA','Carrossel':'#34D399','Story':'#F472B6' };
  const c = colors[type]||'#6B7280';
  return `<span style="font-size:0.6875rem;padding:2px 7px;border-radius:var(--radius-full);
    background:${c}18;color:${c};border:1px solid ${c}30;white-space:nowrap;">${esc(type||'—')}</span>`;
}

function acctBadge(handle) {
  const colors = { 'primetourviagens':'#D4A843','icsbyprimetour':'#38BDF8' };
  const c = colors[handle]||'#6B7280';
  return `<span style="font-size:0.6875rem;padding:2px 7px;border-radius:var(--radius-full);
    background:${c}18;color:${c};border:1px solid ${c}30;white-space:nowrap;">@${esc(handle||'—')}</span>`;
}

function engColor(v) {
  if (!v) return '';
  if (v >= 5) return 'color:#22C55E;font-weight:600;';
  if (v >= 2) return 'color:#F59E0B;font-weight:600;';
  return 'color:#EF4444;';
}

// storyOnly=true: só mostra para stories, — para outros
// noStory=true: mostra para todos exceto stories
function storyCell(r, value, storyOnly, noStory, extraStyle) {
  const isStory = r.mediaType === 'Story';
  const show    = storyOnly ? isStory : (noStory ? !isStory : true);
  const style   = 'padding:8px 12px;text-align:right;vertical-align:middle;' + (extraStyle || '');
  return '<td style="' + style + '">' + (show ? value : '<span style="color:var(--text-muted);">—</span>') + '</td>';
}

/* ─── Export XLSX ─────────────────────────────────────────── */
async function exportXLSX() {
  const btn = document.getElementById('meta-export-xlsx');
  if (btn) { btn.disabled=true; btn.textContent='…'; }
  try {
    if (!window.XLSX) {
      await new Promise((res,rej) => {
        const s = document.createElement('script');
        s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload=res; s.onerror=rej; document.head.appendChild(s);
      });
    }
    const rows = getRows();
    const haAcct = !filterAcct;
    const headers = [
      ...(haAcct?['Conta']:[]),
      'Data','Tipo','Legenda',
      'Alcance','Curtidas','Comentários','Saves','Compartilhamentos','Plays',
      'Engajamento','% Engajamento','Seguidores+','Visitas Perfil',
    ];
    const data = rows.map(r => [
      ...(haAcct?[`@${r.accountHandle}`]:[]),
      fmt(r.postedAt), r.mediaType, r.caption,
      r.reach, r.likes, r.comments, r.saved, r.shares, r.plays||0,
      r.engagement, r.engagementRate, r.follows, r.profileVisits,
    ]);
    const ws = window.XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws['!cols'] = headers.map((_,i) => ({ wch: i<4?24:14 }));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Instagram');
    window.XLSX.writeFile(wb, `primetour_instagram_${new Date().toISOString().slice(0,10)}.xlsx`);
    toast.success(`${rows.length} posts exportados.`);
  } catch(e) { toast.error('Erro XLSX: '+e.message); }
  finally { if(btn){btn.disabled=false;btn.textContent='⬇ XLSX';} }
}

/* ─── Export PDF ──────────────────────────────────────────── */
const exportPDF = withExportGuard(async function exportPDF() {
  const btn = document.getElementById('meta-export-pdf');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    await loadJsPdf();
    // autotable só é necessária para a tabela detalhada no final
    if (!window.jspdf?.jsPDF?.API?.autoTable) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.1/jspdf.plugin.autotable.min.js';
        s.onload = res; s.onerror = rej; document.head.appendChild(s);
      });
    }

    const rows   = getRows();
    const haAcct = !filterAcct;
    const acct   = filterAcct ? `@${filterAcct}` : 'Todas as contas';
    // filterDays pode ser "30", "7", ... ou "custom:YYYY-MM-DD:YYYY-MM-DD"
    let periodLabel;
    if (String(filterDays).startsWith('custom:')) {
      const [, from, to] = filterDays.split(':');
      const fmtIso = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '';
      periodLabel = `${fmtIso(from)} — ${fmtIso(to)}`;
    } else {
      periodLabel = (PERIODS.find(p => p.value === String(filterDays))?.label) || `Últimos ${filterDays}d`;
    }

    const kit = createDoc({ orientation: 'landscape', margin: 14 });
    const { doc, W, M, CW, setFill, setText } = kit;

    kit.drawCover({
      title: 'Performance Redes Sociais',
      subtitle: 'PRIMETOUR  ·  Meta Graph API',
      meta: `${rows.length} posts  ·  ${periodLabel || 'período'}`,
      compact: true,
    });

    // sub-linha com conta filtrada
    setText(COL.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text(txt(acct), M, kit.y);
    kit.addY(6);

    // ── KPIs strip ──
    const avg = key => {
      const vals = rows.map(r => r[key]).filter(v => v != null && !isNaN(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    };
    const sumK = key => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);
    const best = rows.reduce((a, r) => (r.reach || 0) > (a.reach || 0) ? r : a, rows[0] || {});

    const kpis = [
      { label: 'Posts',          value: String(rows.length),            col: COL.blue  },
      { label: 'Alcance medio',  value: num(Math.round(avg('reach'))),  col: COL.brand2},
      { label: 'Engaj. medio',   value: pct(avg('engagementRate')),     col: COL.green },
      { label: 'Curtidas',       value: num(sumK('likes')),             col: COL.red   },
      { label: 'Saves',          value: num(sumK('saved')),             col: COL.gold  },
      { label: 'Maior alcance',  value: num(best?.reach || 0),          col: COL.blue  },
    ];
    const gap = 3;
    const kpiW = (CW - gap * (kpis.length - 1)) / kpis.length;
    const kpiH = 18;
    const kpiY = kit.y;
    kpis.forEach((k, i) => {
      const x = M + i * (kpiW + gap);
      setFill(COL.white); doc.roundedRect(x, kpiY, kpiW, kpiH, 1.5, 1.5, 'F');
      setFill(k.col);     doc.rect(x, kpiY, kpiW, 1.4, 'F');
      setText(COL.text);  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
      doc.text(txt(k.value), x + kpiW / 2, kpiY + 10, { align: 'center' });
      setText(COL.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
      doc.text(txt(k.label.toUpperCase()), x + kpiW / 2, kpiY + 15, { align: 'center' });
    });
    kit.y = kpiY + kpiH + 6;

    // ── TOP 5 posts em cards ──
    if (rows.length) {
      const top = [...rows]
        .sort((a, b) => (b.engagementRate || 0) - (a.engagementRate || 0))
        .slice(0, 5);

      setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.text(txt('DESTAQUES POR ENGAJAMENTO'), M, kit.y);
      setText(COL.gold); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
      doc.text(txt('— top 5 posts do período'), M + 62, kit.y);
      kit.y += 4;

      const cardW = (CW - gap * (top.length - 1)) / top.length;
      const cardH = 32;
      const cy = kit.y;
      top.forEach((r, i) => {
        const x = M + i * (cardW + gap);
        setFill(COL.subBg); doc.roundedRect(x, cy, cardW, cardH, 1.5, 1.5, 'F');
        setFill(COL.gold);  doc.rect(x, cy, cardW, 1.2, 'F');

        // rank
        setText(COL.gold); doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
        doc.text(txt(`#${i + 1}  ${r.mediaType || ''}`.toUpperCase()), x + 3, cy + 5.5);
        // engajamento %
        setText(COL.green); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
        doc.text(txt(pct(r.engagementRate)), x + cardW - 3, cy + 11, { align: 'right' });
        // data
        setText(COL.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
        doc.text(txt(fmt(r.postedAt)), x + 3, cy + 11);
        // legenda
        setText(COL.text); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
        const cap = kit.wrap(r.caption || '(sem legenda)', cardW - 6, 7).slice(0, 3);
        doc.text(cap, x + 3, cy + 16);
        // métricas miúdas
        setText(COL.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
        doc.text(txt(`alc ${num(r.reach)}  ·  lk ${num(r.likes)}  ·  cm ${num(r.comments)}`), x + 3, cy + cardH - 2);
      });
      kit.y = cy + cardH + 6;
    }

    // ── Tabela detalhada ──
    kit.ensureSpace(40);
    setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(txt('TODOS OS POSTS'), M, kit.y);
    kit.y += 3;

    const head = [[
      ...(haAcct ? ['Conta'] : []),
      'Data', 'Tipo', 'Legenda', 'Alcance', 'Curtidas', 'Coment.', 'Saves', 'Plays', 'Engaj.', '% Engaj.',
    ]];
    const body = rows.map(r => [
      ...(haAcct ? [`@${r.accountHandle}`] : []),
      fmt(r.postedAt), r.mediaType || '-', txt((r.caption || '').slice(0, 60)),
      num(r.reach), num(r.likes), num(r.comments),
      num(r.saved), r.mediaType === 'Reel' ? num(r.plays) : '-',
      num(r.engagement), pct(r.engagementRate),
    ]);

    doc.autoTable({
      head, body, startY: kit.y,
      margin: { left: M, right: M, bottom: 14 },
      styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak', textColor: COL.text },
      headStyles: { fillColor: COL.brand, textColor: 255, fontStyle: 'bold', fontSize: 6.5 },
      alternateRowStyles: { fillColor: COL.subBg },
      didParseCell: (data) => {
        if (data.section === 'body') {
          const colIdx = data.column.index - (haAcct ? 1 : 0);
          if (colIdx === 9) {
            const val = parseFloat(String(data.cell.raw).replace('%', '').replace(',', '.'));
            if (!isNaN(val)) {
              data.cell.styles.textColor = val >= 3 ? COL.green : val >= 1 ? COL.gold : COL.red;
              data.cell.styles.fontStyle = 'bold';
            }
          }
        }
      },
    });

    kit.drawFooter('PRIMETOUR  ·  Performance Redes Sociais');
    doc.save(`primetour_instagram_${new Date().toISOString().slice(0, 10)}.pdf`);
    toast.success(`PDF gerado com ${rows.length} posts.`);
  } catch (e) {
    toast.error('Erro PDF: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ PDF'; }
  }
});
