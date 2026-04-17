/**
 * PRIMETOUR — Monitoramento de Notícias + Clipping
 */
import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { openTaskModal } from '../components/taskModal.js';
import {
  fetchNews, saveNewsItem, deleteNewsItem, recordNewsConversion,
  NEWS_CATEGORIES, NEWS_SUBCATEGORIES,
  fetchClippings, saveClipping, deleteClipping, fetchUrlMetadata,
  CLIPPING_MEDIA_TYPES, CLIPPING_CONTENT_TYPES, CLIPPING_SENTIMENTS,
} from '../services/newsMonitor.js';
import { createDoc, loadJsPdf, COL, txt, withExportGuard } from '../components/pdfKit.js';

const esc = s => String(s||'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = ts => {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('pt-BR');
};
const isExpired = item => item.expiresAt && new Date(item.expiresAt) < new Date();

let filters = { search:'', category:'', subcategory:'', validity:'', dateFrom:'', dateTo:'' };
let allItems = [];

let clipFilters = { search:'', mediaType:'', contentType:'', sentiment:'', dateFrom:'', dateTo:'' };
let allClippings = [];
let activeTab = 'noticias';

export async function renderNewsMonitor(container) {
  if (!store.can('dashboard_view') && !store.isMaster()) {
    container.innerHTML = `<div class="empty-state"><span style="font-size:2rem;">🔒</span><p>Acesso restrito</p><p class="text-muted">Você não tem permissão para acessar o Monitoramento de Notícias.</p></div>`;
    return;
  }
  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
      <div class="page-header-left">
        <h1 class="page-title">Monitoramento de Notícias</h1>
        <p class="page-subtitle">Central de notícias, tendências e clipping da empresa</p>
      </div>
      <div class="page-header-actions" id="news-header-actions" style="gap:8px;"></div>
    </div>

    <!-- Tabs -->
    <div style="display:flex;gap:0;margin-bottom:20px;border-bottom:2px solid var(--border-subtle);">
      <button class="news-tab" data-tab="noticias"
        style="padding:10px 24px;font-size:0.875rem;font-weight:600;border:none;cursor:pointer;
        background:transparent;color:var(--text-primary);
        border-bottom:2px solid var(--brand-gold);margin-bottom:-2px;">
        📰 Notícias
      </button>
      <button class="news-tab" data-tab="clipping"
        style="padding:10px 24px;font-size:0.875rem;font-weight:600;border:none;cursor:pointer;
        background:transparent;color:var(--text-muted);
        border-bottom:2px solid transparent;margin-bottom:-2px;">
        📎 Clipping
      </button>
    </div>

    <!-- Tab content -->
    <div id="news-tab-content"></div>`;

  // Wire tabs
  container.querySelectorAll('.news-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      container.querySelectorAll('.news-tab').forEach(b => {
        const active = b.dataset.tab === activeTab;
        b.style.color = active ? 'var(--text-primary)' : 'var(--text-muted)';
        b.style.borderBottomColor = active ? 'var(--brand-gold)' : 'transparent';
      });
      renderActiveTab(container);
    });
  });

  await renderActiveTab(container);
}

async function renderActiveTab(container) {
  if (activeTab === 'noticias') {
    await renderNoticiasTab(container);
  } else {
    await renderClippingTab(container);
  }
}

/* ════════════════════════════════════════════════════════════
   Tab: Notícias (existing functionality)
   ════════════════════════════════════════════════════════════ */
async function renderNoticiasTab(container) {
  const actions = document.getElementById('news-header-actions');
  if (actions) actions.innerHTML = `
    <button class="btn btn-secondary btn-sm" id="news-export-xls">↓ XLS</button>
    <button class="btn btn-secondary btn-sm" id="news-export-pdf">↓ PDF</button>
    <button class="btn btn-primary btn-sm"   id="news-new-btn">+ Nova notícia</button>`;

  const tabContent = document.getElementById('news-tab-content');
  if (!tabContent) return;

  tabContent.innerHTML = `
    <!-- Filters -->
    <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);
      border-radius:var(--radius-md);padding:16px 20px;margin-bottom:20px;
      display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;">

      <div style="flex:2;min-width:200px;">
        <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Buscar</label>
        <input type="text" id="nf-search" class="portal-field" style="width:100%;"
          placeholder="Título, descrição, categoria…">
      </div>

      <div style="min-width:150px;">
        <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Categoria</label>
        <select id="nf-cat" class="filter-select" style="width:100%;">
          <option value="">Todas</option>
          ${NEWS_CATEGORIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
        </select>
      </div>

      <div style="min-width:140px;">
        <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Subcategoria</label>
        <select id="nf-subcat" class="filter-select" style="width:100%;">
          <option value="">Todas</option>
          ${NEWS_SUBCATEGORIES.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
        </select>
      </div>

      <div style="min-width:120px;">
        <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Validade</label>
        <select id="nf-validity" class="filter-select" style="width:100%;">
          <option value="">Todas</option>
          <option value="valid">Vigentes</option>
          <option value="expired">Expiradas</option>
        </select>
      </div>

      <div style="min-width:130px;">
        <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">De</label>
        <input type="date" id="nf-from" class="portal-field" style="width:100%;">
      </div>

      <div style="min-width:130px;">
        <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Até</label>
        <input type="date" id="nf-to" class="portal-field" style="width:100%;">
      </div>

      <button class="btn btn-ghost btn-sm" id="nf-clear"
        style="font-size:0.8125rem;color:var(--text-muted);white-space:nowrap;">✕ Limpar</button>
    </div>

    <!-- KPI strip -->
    <div id="news-kpi" style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;"></div>

    <!-- List -->
    <div id="news-list"></div>`;

  // Wire filters
  const applyFilters = () => {
    filters.search      = document.getElementById('nf-search')?.value || '';
    filters.category    = document.getElementById('nf-cat')?.value || '';
    filters.subcategory = document.getElementById('nf-subcat')?.value || '';
    filters.validity    = document.getElementById('nf-validity')?.value || '';
    filters.dateFrom    = document.getElementById('nf-from')?.value || '';
    filters.dateTo      = document.getElementById('nf-to')?.value || '';
    renderList();
  };

  ['nf-search','nf-cat','nf-subcat','nf-validity','nf-from','nf-to'].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener(id === 'nf-search' ? 'input' : 'change', applyFilters);
  });

  document.getElementById('nf-clear')?.addEventListener('click', () => {
    ['nf-search','nf-cat','nf-subcat','nf-validity','nf-from','nf-to'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    filters = { search:'', category:'', subcategory:'', validity:'', dateFrom:'', dateTo:'' };
    renderList();
  });

  document.getElementById('news-new-btn')?.addEventListener('click', () => showForm(container));
  document.getElementById('news-export-xls')?.addEventListener('click', () => exportXls());
  document.getElementById('news-export-pdf')?.addEventListener('click', () => exportPdf());

  await loadData(container);
}

async function loadData(container) {
  const listEl = document.getElementById('news-list');
  if (listEl) listEl.innerHTML = `<div style="text-align:center;padding:40px;
    color:var(--text-muted);">⏳ Carregando…</div>`;
  allItems = await fetchNews().catch(() => []);
  renderKpis();
  renderList();
}

function renderKpis() {
  const el = document.getElementById('news-kpi');
  if (!el) return;
  const now     = new Date();
  const total   = allItems.length;
  const valid   = allItems.filter(i => !i.expiresAt || new Date(i.expiresAt) >= now).length;
  const expired = total - valid;
  const week    = allItems.filter(i => {
    const d = i.publishedAt?.toDate?.() || new Date(i.publishedAt||0);
    return (now - d) < 7*24*3600*1000;
  }).length;

  // ─── Métricas de utilização (notícia → tarefa) ─────────────────
  const withConv = allItems.filter(i => Array.isArray(i.conversions) && i.conversions.length > 0);
  const convCount = withConv.length;
  const convRate  = total > 0 ? Math.round((convCount / total) * 100) : 0;

  // Top usuários (pelo total de conversões, não de notícias únicas)
  const userCount = {};
  allItems.forEach(item => {
    (item.conversions || []).forEach(c => {
      const key = c.userId || c.userName || 'Desconhecido';
      const label = c.userName || c.userId || 'Desconhecido';
      if (!userCount[key]) userCount[key] = { label, n: 0 };
      userCount[key].n += 1;
    });
  });
  const topUsers = Object.values(userCount).sort((a,b) => b.n - a.n).slice(0, 3);

  // Categorias mais publicadas
  const catCount = {};
  allItems.forEach(i => {
    const c = i.category || '—';
    catCount[c] = (catCount[c] || 0) + 1;
  });
  const topCats = Object.entries(catCount).sort((a,b) => b[1] - a[1]).slice(0, 3);

  const simpleCard = (label, val, color) => `
    <div style="padding:12px 18px;background:var(--bg-surface);border:1px solid var(--border-subtle);
      border-radius:var(--radius-md);min-width:110px;text-align:center;">
      <div style="font-size:1.5rem;font-weight:700;color:${color};">${val}</div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">${label}</div>
    </div>`;

  const listCard = (label, rows, emptyMsg) => `
    <div style="padding:12px 16px;background:var(--bg-surface);border:1px solid var(--border-subtle);
      border-radius:var(--radius-md);min-width:200px;flex:1;">
      <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
        color:var(--text-muted);margin-bottom:8px;">${label}</div>
      ${rows.length
        ? `<div style="display:flex;flex-direction:column;gap:4px;">
            ${rows.map(([name, n]) => `
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;
                font-size:0.8125rem;">
                <span style="color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;
                  white-space:nowrap;">${esc(name)}</span>
                <span style="font-weight:700;color:var(--brand-gold);flex-shrink:0;">${n}</span>
              </div>`).join('')}
          </div>`
        : `<div style="font-size:0.8125rem;color:var(--text-muted);font-style:italic;">${emptyMsg}</div>`}
    </div>`;

  // Garante que o container empilhe as duas faixas verticalmente
  el.style.flexDirection = 'column';

  el.innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;">
      ${simpleCard('Total',       total,   'var(--text-primary)')}
      ${simpleCard('Vigentes',    valid,   '#22C55E')}
      ${simpleCard('Expiradas',   expired, '#EF4444')}
      ${simpleCard('Últimos 7d',  week,    'var(--brand-gold)')}
      <div style="padding:12px 18px;background:var(--bg-surface);border:1px solid var(--border-subtle);
        border-radius:var(--radius-md);min-width:140px;text-align:center;"
        title="Percentual de notícias que foram convertidas em tarefa ao menos uma vez">
        <div style="font-size:1.5rem;font-weight:700;color:#38BDF8;">${convRate}%</div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
          Utilização <span style="opacity:.7;">(${convCount}/${total})</span>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;">
      ${listCard(
        'Quem mais usa notícias',
        topUsers.map(u => [u.label, u.n]),
        'Nenhuma conversão ainda',
      )}
      ${listCard(
        'Categorias mais publicadas',
        topCats,
        'Nenhuma categoria',
      )}
    </div>`;
}

function applyClientFilters(items) {
  return items.filter(item => {
    const now = new Date();
    if (filters.search) {
      const s = filters.search.toLowerCase();
      if (!(item.title+item.description+item.category+item.subcategory+'').toLowerCase().includes(s)) return false;
    }
    if (filters.category    && item.category    !== filters.category)    return false;
    if (filters.subcategory && item.subcategory !== filters.subcategory) return false;
    if (filters.validity === 'valid'   && item.expiresAt && new Date(item.expiresAt) < now)  return false;
    if (filters.validity === 'expired' && !(item.expiresAt && new Date(item.expiresAt) < now)) return false;
    if (filters.dateFrom) {
      const d = item.publishedAt?.toDate?.() || new Date(item.publishedAt||0);
      if (d < new Date(filters.dateFrom)) return false;
    }
    if (filters.dateTo) {
      const d = item.publishedAt?.toDate?.() || new Date(item.publishedAt||0);
      if (d > new Date(filters.dateTo + 'T23:59:59')) return false;
    }
    return true;
  });
}

function renderList() {
  const listEl = document.getElementById('news-list');
  if (!listEl) return;

  const filtered = applyClientFilters(allItems);

  if (!filtered.length) {
    listEl.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📰</div>
      <div class="empty-state-title">Nenhuma notícia encontrada</div>
      <div class="empty-state-subtitle">Ajuste os filtros ou cadastre a primeira notícia.</div>
    </div>`;
    return;
  }

  listEl.innerHTML = `
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:var(--bg-surface);">
          ${['Título / Descrição','Categoria','Subcategoria','Publicado','Validade',''].map(h =>
            `<th style="padding:10px 14px;text-align:left;font-size:0.6875rem;font-weight:700;
              text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);
              border-bottom:1px solid var(--border-subtle);white-space:nowrap;">${h}</th>`
          ).join('')}
        </tr>
      </thead>
      <tbody id="news-tbody">
        ${filtered.map(item => {
          const exp = item.expiresAt;
          const expired = exp && new Date(exp) < new Date();
          const expBadge = exp
            ? `<span style="font-size:0.6875rem;padding:2px 7px;border-radius:20px;
                background:${expired?'#EF444418':'#22C55E18'};
                color:${expired?'#EF4444':'#22C55E'};
                border:1px solid ${expired?'#EF444430':'#22C55E30'};">
                ${expired?'Expirada':new Date(exp).toLocaleDateString('pt-BR')}
              </span>`
            : `<span style="font-size:0.6875rem;color:var(--text-muted);">Sem validade</span>`;

          const convs = Array.isArray(item.conversions) ? item.conversions : [];
          const convNames = Array.from(new Set(convs.map(c => c.userName || c.userId || 'Desconhecido').filter(Boolean)));
          const convBadge = convs.length
            ? `<div style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span style="font-size:0.6875rem;padding:2px 8px;border-radius:20px;
                  background:#38BDF818;color:#38BDF8;border:1px solid #38BDF830;
                  display:inline-flex;align-items:center;gap:4px;"
                  title="Esta notícia já foi convertida em tarefa">
                  ✈ Convertida em tarefa${convs.length>1?` (${convs.length})`:''}
                </span>
                <span style="font-size:0.6875rem;color:var(--text-muted);"
                  title="${esc(convNames.join(', '))}">
                  por ${convNames.slice(0,2).map(esc).join(', ')}${convNames.length>2?` +${convNames.length-2}`:''}
                </span>
              </div>`
            : '';

          return `<tr class="news-row" data-id="${esc(item.id)}"
            style="border-bottom:1px solid var(--border-subtle);transition:background .15s;
            cursor:pointer;"
            onmouseenter="this.style.background='var(--bg-surface)'"
            onmouseleave="this.style.background='transparent'">
            <td style="padding:12px 14px;max-width:380px;">
              <div style="font-weight:600;font-size:0.9375rem;margin-bottom:3px;">
                ${esc(item.title)}
              </div>
              ${item.description ? `<div style="font-size:0.8125rem;color:var(--text-muted);
                overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;
                -webkit-box-orient:vertical;">${esc(item.description)}</div>` : ''}
              ${item.link ? `<a href="${esc(item.link)}" target="_blank" rel="noopener"
                style="font-size:0.75rem;color:var(--brand-gold);text-decoration:none;
                display:inline-flex;align-items:center;gap:4px;margin-top:4px;"
                onclick="event.stopPropagation()">🔗 Ver fonte ↗</a>` : ''}
              ${convBadge}
            </td>
            <td style="padding:12px 14px;white-space:nowrap;">
              <span style="padding:3px 10px;background:var(--brand-gold)12;
                color:var(--brand-gold);border-radius:20px;font-size:0.75rem;font-weight:600;">
                ${esc(item.category||'—')}
              </span>
            </td>
            <td style="padding:12px 14px;white-space:nowrap;font-size:0.8125rem;color:var(--text-muted);">
              ${esc(item.subcategory||'—')}
            </td>
            <td style="padding:12px 14px;white-space:nowrap;font-size:0.8125rem;color:var(--text-muted);">
              ${fmt(item.publishedAt)}
            </td>
            <td style="padding:12px 14px;white-space:nowrap;">${expBadge}</td>
            <td style="padding:12px 14px;white-space:nowrap;">
              <div style="display:flex;gap:6px;justify-content:flex-end;">
                <button class="btn btn-primary btn-sm news-totask"
                  data-id="${esc(item.id)}"
                  style="font-size:0.75rem;white-space:nowrap;"
                  title="Transformar em tarefa">✈ Tarefa</button>
                <button class="btn btn-ghost btn-sm news-edit"
                  data-id="${esc(item.id)}"
                  style="font-size:0.75rem;color:var(--brand-gold);">✎</button>
                <button class="btn btn-ghost btn-sm news-del"
                  data-id="${esc(item.id)}" data-title="${esc(item.title)}"
                  style="font-size:0.75rem;color:#EF4444;">✕</button>
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div style="padding:10px 14px;font-size:0.8125rem;color:var(--text-muted);">
      ${filtered.length} resultado${filtered.length !== 1 ? 's' : ''}
      ${filtered.length < allItems.length ? ` (de ${allItems.length} total)` : ''}
    </div>`;

  // Wire row click → expand / edit
  listEl.querySelectorAll('.news-edit').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const item = allItems.find(i => i.id === btn.dataset.id);
      if (item) showForm(null, item);
    });
  });

  listEl.querySelectorAll('.news-del').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`Excluir "${btn.dataset.title}"?`)) return;
      await deleteNewsItem(btn.dataset.id);
      allItems = allItems.filter(i => i.id !== btn.dataset.id);
      renderKpis(); renderList();
      toast.success('Excluída.');
    });
  });

  listEl.querySelectorAll('.news-totask').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const item = allItems.find(i => i.id === btn.dataset.id);
      if (!item) return;
      const user = store.get('currentUser');
      // Open task modal pre-filled with news content
      openTaskModal({
        taskData: {
          title:       item.title || '',
          description: [
            item.description || '',
            item.link ? `\n🔗 Fonte: ${item.link}` : '',
            `\n📰 Categoria: ${item.category || ''} · ${item.subcategory || ''}`,
          ].filter(Boolean).join(''),
          sourceNewsId: item.id,
        },
        onSave: async (taskId) => {
          if (taskId) {
            await recordNewsConversion(item.id, {
              taskId,
              userId:   user?.uid,
              userName: user?.name || user?.displayName || user?.email || '',
            });
            // Atualiza estado local para refletir o badge imediatamente
            const localItem = allItems.find(i => i.id === item.id);
            if (localItem) {
              localItem.conversions = Array.isArray(localItem.conversions) ? [...localItem.conversions] : [];
              if (!localItem.conversions.some(c => c.taskId === taskId)) {
                localItem.conversions.push({
                  taskId,
                  userId:   user?.uid || null,
                  userName: user?.name || user?.displayName || user?.email || '',
                  at:       new Date(),
                });
              }
              renderKpis();
              renderList();
            }
          }
          toast.success('Tarefa criada a partir da notícia!');
        },
      });
    });
  });
}

/* ─── Form modal ───────────────────────────────────────────── */
function showForm(container, item = null) {
  const isEdit = !!item?.id;
  const modal  = document.createElement('div');
  modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2000;
    display:flex;align-items:center;justify-content:center;padding:20px;`;

  const LBL = `font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;`;
  const expVal = item?.expiresAt
    ? (typeof item.expiresAt === 'string' ? item.expiresAt : item.expiresAt.toDate?.().toISOString().slice(0,10))
    : '';
  const pubVal = item?.publishedAt
    ? (item.publishedAt?.toDate ? item.publishedAt.toDate().toISOString().slice(0,10) : item.publishedAt)
    : new Date().toISOString().slice(0,10);

  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:600px;max-height:90vh;
      padding:0;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:16px 22px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div style="font-weight:700;font-size:1rem;">
          ${isEdit ? 'Editar notícia' : 'Nova notícia'}
        </div>
        <button id="nf-modal-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);">✕</button>
      </div>

      <div style="overflow-y:auto;flex:1;padding:20px 22px;display:flex;flex-direction:column;gap:14px;">

        <div>
          <label style="${LBL}">Título *</label>
          <input id="nf-title" type="text" class="portal-field" style="width:100%;"
            value="${esc(item?.title||'')}" placeholder="Título da notícia ou informação">
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="${LBL}">Categoria *</label>
            <select id="nf-m-cat" class="filter-select" style="width:100%;">
              <option value="">Selecione…</option>
              ${NEWS_CATEGORIES.map(c =>
                `<option ${item?.category===c?'selected':''} value="${esc(c)}">${esc(c)}</option>`
              ).join('')}
            </select>
          </div>
          <div>
            <label style="${LBL}">Subcategoria *</label>
            <select id="nf-m-subcat" class="filter-select" style="width:100%;">
              <option value="">Selecione…</option>
              ${NEWS_SUBCATEGORIES.map(s =>
                `<option ${item?.subcategory===s?'selected':''} value="${esc(s)}">${esc(s)}</option>`
              ).join('')}
            </select>
          </div>
        </div>

        <div>
          <label style="${LBL}">Descrição / Conteúdo</label>
          <textarea id="nf-desc" class="portal-field" rows="5" style="width:100%;"
            placeholder="Resumo da notícia, insights ou observações…">${esc(item?.description||'')}</textarea>
        </div>

        <div>
          <label style="${LBL}">Link da fonte <span style="font-weight:400;color:var(--text-muted);">(opcional)</span></label>
          <input id="nf-link" type="url" class="portal-field" style="width:100%;"
            value="${esc(item?.link||'')}" placeholder="https://…">
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="${LBL}">Data de publicação</label>
            <input id="nf-pub" type="date" class="portal-field" style="width:100%;"
              value="${esc(pubVal)}">
          </div>
          <div>
            <label style="${LBL}">Validade <span style="font-weight:400;color:var(--text-muted);">(opcional)</span></label>
            <input id="nf-exp" type="date" class="portal-field" style="width:100%;"
              value="${esc(expVal)}">
          </div>
        </div>

      </div>

      <div style="padding:14px 22px;border-top:1px solid var(--border-subtle);
        background:var(--bg-surface);display:flex;gap:10px;flex-shrink:0;">
        <button class="btn btn-secondary" id="nf-modal-cancel" style="flex:1;">Cancelar</button>
        <button class="btn btn-primary"   id="nf-modal-save"   style="flex:2;font-weight:600;">
          💾 ${isEdit ? 'Salvar alterações' : 'Cadastrar notícia'}
        </button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  // Backdrop-click não fecha — só o botão X/Cancelar, para evitar perda acidental de dados.
  document.getElementById('nf-modal-close')?.addEventListener('click',  () => modal.remove());
  document.getElementById('nf-modal-cancel')?.addEventListener('click', () => modal.remove());

  document.getElementById('nf-modal-save')?.addEventListener('click', async () => {
    const btn = document.getElementById('nf-modal-save');
    const title    = document.getElementById('nf-title')?.value?.trim();
    const category = document.getElementById('nf-m-cat')?.value;
    const subcat   = document.getElementById('nf-m-subcat')?.value;

    if (!title)    { toast.error('Preencha o título.'); return; }
    if (!category) { toast.error('Selecione a categoria.'); return; }
    if (!subcat)   { toast.error('Selecione a subcategoria.'); return; }

    btn.disabled = true; btn.textContent = '⏳';
    try {
      const data = {
        title,
        category,
        subcategory: subcat,
        description: document.getElementById('nf-desc')?.value?.trim() || '',
        link:        document.getElementById('nf-link')?.value?.trim() || '',
        publishedAt: document.getElementById('nf-pub')?.value || new Date().toISOString().slice(0,10),
        expiresAt:   document.getElementById('nf-exp')?.value || null,
      };
      const savedId = await saveNewsItem(item?.id || null, data);
      // Update local cache
      const idx = allItems.findIndex(i => i.id === (item?.id || savedId));
      const updated = { ...data, id: savedId };
      if (idx >= 0) allItems[idx] = updated;
      else allItems.unshift(updated);
      renderKpis(); renderList();
      modal.remove();
      toast.success(isEdit ? 'Notícia atualizada.' : 'Notícia cadastrada.');
    } catch(e) {
      toast.error('Erro: ' + e.message);
      btn.disabled = false; btn.textContent = `💾 ${isEdit?'Salvar alterações':'Cadastrar notícia'}`;
    }
  });
}

/* ════════════════════════════════════════════════════════════
   Tab: Clipping
   ════════════════════════════════════════════════════════════ */
async function renderClippingTab(container) {
  const actions = document.getElementById('news-header-actions');
  if (actions) actions.innerHTML = `
    <button class="btn btn-secondary btn-sm" id="clip-export-xls">↓ XLS</button>
    <button class="btn btn-secondary btn-sm" id="clip-export-pdf">↓ PDF</button>
    <button class="btn btn-primary btn-sm"   id="clip-new-btn">+ Novo clipping</button>`;

  const tabContent = document.getElementById('news-tab-content');
  if (!tabContent) return;

  const PERIOD_LABELS = { '7d':'7 dias', '30d':'30 dias', '90d':'90 dias', '12m':'12 meses', 'all':'Tudo', 'custom':'Personalizado' };

  tabContent.innerHTML = `
    <!-- Period filter -->
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:16px;">
      ${['7d','30d','90d','12m','all','custom'].map(p => `
        <button class="clip-period-btn" data-period="${p}"
          style="padding:6px 16px;border-radius:var(--radius-full);font-size:0.8125rem;
          font-weight:600;border:1px solid var(--border-subtle);cursor:pointer;
          background:${p === '30d' ? 'var(--brand-gold)' : 'var(--bg-surface)'};
          color:${p === '30d' ? '#fff' : 'var(--text-secondary)'};">
          ${PERIOD_LABELS[p]}
        </button>`).join('')}
      <div id="clip-custom-range" style="display:none;gap:8px;align-items:center;margin-left:8px;">
        <input type="date" id="clip-from" class="portal-field" style="height:34px;font-size:0.8125rem;">
        <span style="color:var(--text-muted);">→</span>
        <input type="date" id="clip-to" class="portal-field" style="height:34px;font-size:0.8125rem;">
        <button class="btn btn-primary btn-sm" id="clip-apply-custom">Aplicar</button>
      </div>
    </div>

    <!-- Filters -->
    <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);
      border-radius:var(--radius-md);padding:14px 20px;margin-bottom:20px;
      display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;">

      <div style="flex:2;min-width:180px;">
        <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Buscar</label>
        <input type="text" id="cf-search" class="portal-field" style="width:100%;"
          placeholder="Título, veículo, link…">
      </div>

      <div style="min-width:130px;">
        <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Tipo de mídia</label>
        <select id="cf-media" class="filter-select" style="width:100%;">
          <option value="">Todos</option>
          ${CLIPPING_MEDIA_TYPES.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}
        </select>
      </div>

      <div style="min-width:140px;">
        <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Conteúdo</label>
        <select id="cf-content" class="filter-select" style="width:100%;">
          <option value="">Todos</option>
          ${CLIPPING_CONTENT_TYPES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
        </select>
      </div>

      <div style="min-width:130px;">
        <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Sentimento</label>
        <select id="cf-sentiment" class="filter-select" style="width:100%;">
          <option value="">Todos</option>
          ${CLIPPING_SENTIMENTS.map(s => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join('')}
        </select>
      </div>

      <button class="btn btn-ghost btn-sm" id="cf-clear"
        style="font-size:0.8125rem;color:var(--text-muted);white-space:nowrap;">✕ Limpar</button>
    </div>

    <!-- KPI strip -->
    <div id="clip-kpi" style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;"></div>

    <!-- List -->
    <div id="clip-list"></div>`;

  // Wire period buttons
  let currentPeriod = '30d';
  tabContent.querySelectorAll('.clip-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentPeriod = btn.dataset.period;
      tabContent.querySelectorAll('.clip-period-btn').forEach(b => {
        const active = b.dataset.period === currentPeriod;
        b.style.background = active ? 'var(--brand-gold)' : 'var(--bg-surface)';
        b.style.color = active ? '#fff' : 'var(--text-secondary)';
      });
      const customEl = document.getElementById('clip-custom-range');
      if (customEl) customEl.style.display = currentPeriod === 'custom' ? 'flex' : 'none';
      if (currentPeriod !== 'custom') {
        applyPeriod(currentPeriod);
        renderClipList();
      }
    });
  });

  document.getElementById('clip-apply-custom')?.addEventListener('click', () => {
    clipFilters.dateFrom = document.getElementById('clip-from')?.value || '';
    clipFilters.dateTo   = document.getElementById('clip-to')?.value || '';
    renderClipList();
  });

  function applyPeriod(period) {
    const now = new Date();
    clipFilters.dateTo = '';
    if (period === 'all') { clipFilters.dateFrom = ''; return; }
    const d = new Date(now);
    if (period === '7d')  d.setDate(d.getDate() - 7);
    if (period === '30d') d.setDate(d.getDate() - 30);
    if (period === '90d') d.setDate(d.getDate() - 90);
    if (period === '12m') d.setFullYear(d.getFullYear() - 1);
    clipFilters.dateFrom = d.toISOString().slice(0, 10);
  }

  // Wire filters
  const applyClipFilters = () => {
    clipFilters.search      = document.getElementById('cf-search')?.value || '';
    clipFilters.mediaType   = document.getElementById('cf-media')?.value || '';
    clipFilters.contentType = document.getElementById('cf-content')?.value || '';
    clipFilters.sentiment   = document.getElementById('cf-sentiment')?.value || '';
    renderClipList();
  };

  ['cf-search','cf-media','cf-content','cf-sentiment'].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener(id === 'cf-search' ? 'input' : 'change', applyClipFilters);
  });

  document.getElementById('cf-clear')?.addEventListener('click', () => {
    ['cf-search','cf-media','cf-content','cf-sentiment'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    clipFilters = { search:'', mediaType:'', contentType:'', sentiment:'', dateFrom:'', dateTo:'' };
    currentPeriod = 'all';
    tabContent.querySelectorAll('.clip-period-btn').forEach(b => {
      const active = b.dataset.period === 'all';
      b.style.background = active ? 'var(--brand-gold)' : 'var(--bg-surface)';
      b.style.color = active ? '#fff' : 'var(--text-secondary)';
    });
    renderClipList();
  });

  document.getElementById('clip-new-btn')?.addEventListener('click', () => showClipForm(container));
  document.getElementById('clip-export-xls')?.addEventListener('click', () => exportClipXls());
  document.getElementById('clip-export-pdf')?.addEventListener('click', () => exportClipPdf());

  // Load data
  applyPeriod('30d');
  const listEl = document.getElementById('clip-list');
  if (listEl) listEl.innerHTML = `<div style="text-align:center;padding:40px;
    color:var(--text-muted);">⏳ Carregando…</div>`;
  allClippings = await fetchClippings().catch(() => []);
  renderClipKpis();
  renderClipList();
}

function applyClipClientFilters(items) {
  return items.filter(item => {
    if (clipFilters.search) {
      const s = clipFilters.search.toLowerCase();
      if (!(item.title + item.link + item.siteName + '').toLowerCase().includes(s)) return false;
    }
    if (clipFilters.mediaType   && item.mediaType   !== clipFilters.mediaType)   return false;
    if (clipFilters.contentType && item.contentType !== clipFilters.contentType) return false;
    if (clipFilters.sentiment   && item.sentiment   !== clipFilters.sentiment)   return false;
    if (clipFilters.dateFrom) {
      const d = item.publishedAt?.toDate?.() || new Date(item.publishedAt || 0);
      if (d < new Date(clipFilters.dateFrom)) return false;
    }
    if (clipFilters.dateTo) {
      const d = item.publishedAt?.toDate?.() || new Date(item.publishedAt || 0);
      if (d > new Date(clipFilters.dateTo + 'T23:59:59')) return false;
    }
    return true;
  });
}

function renderClipKpis() {
  const el = document.getElementById('clip-kpi');
  if (!el) return;
  const filtered = applyClipClientFilters(allClippings);
  const total    = filtered.length;
  const positive = filtered.filter(i => i.sentiment === 'positive').length;
  const neutral  = filtered.filter(i => i.sentiment === 'neutral').length;
  const negative = filtered.filter(i => i.sentiment === 'negative').length;
  const digital  = filtered.filter(i => i.mediaType === 'Digital').length;

  el.innerHTML = [
    ['Total',     total,    'var(--text-primary)'],
    ['Positivas', positive, '#22C55E'],
    ['Imparciais',neutral,  '#F59E0B'],
    ['Negativas', negative, '#EF4444'],
    ['Digital',   digital,  'var(--brand-gold)'],
  ].map(([label, val, color]) => `
    <div style="padding:12px 18px;background:var(--bg-surface);border:1px solid var(--border-subtle);
      border-radius:var(--radius-md);min-width:100px;text-align:center;">
      <div style="font-size:1.5rem;font-weight:700;color:${color};">${val}</div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">${label}</div>
    </div>`).join('');
}

function renderClipList() {
  const listEl = document.getElementById('clip-list');
  if (!listEl) return;

  const filtered = applyClipClientFilters(allClippings);
  renderClipKpis();

  if (!filtered.length) {
    listEl.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📎</div>
      <div class="empty-state-title">Nenhum clipping encontrado</div>
      <div class="empty-state-subtitle">Ajuste os filtros ou cadastre o primeiro clipping.</div>
    </div>`;
    return;
  }

  listEl.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px;">
      ${filtered.map(item => {
        const sent = CLIPPING_SENTIMENTS.find(s => s.key === item.sentiment) || CLIPPING_SENTIMENTS[1];
        const mediaIcon = item.mediaType === 'Televisivo' ? '📺' : item.mediaType === 'Impresso' ? '📰' : '🌐';
        return `
        <div class="card" style="padding:0;overflow:hidden;transition:transform .15s,box-shadow .15s;"
          onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px rgba(0,0,0,.15)'"
          onmouseout="this.style.transform='';this.style.boxShadow=''">

          <!-- Thumbnail -->
          <div style="height:140px;background:var(--bg-dark);position:relative;overflow:hidden;">
            ${item.thumbnail
              ? `<img src="${esc(item.thumbnail)}" style="width:100%;height:100%;object-fit:cover;"
                  alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                 <div style="display:none;position:absolute;inset:0;align-items:center;justify-content:center;
                  color:var(--text-muted);font-size:2rem;">📎</div>`
              : `<div style="display:flex;align-items:center;justify-content:center;
                  height:100%;color:var(--text-muted);font-size:2.5rem;">📎</div>`}
            <!-- Sentiment badge -->
            <div style="position:absolute;top:8px;right:8px;padding:3px 10px;
              background:${sent.bg};border:1px solid ${sent.color}30;
              border-radius:20px;font-size:0.6875rem;font-weight:600;color:${sent.color};">
              ${esc(sent.label)}
            </div>
            <!-- Media type badge -->
            <div style="position:absolute;top:8px;left:8px;padding:3px 10px;
              background:rgba(0,0,0,.6);border-radius:20px;font-size:0.6875rem;color:#fff;">
              ${mediaIcon} ${esc(item.mediaType || '')}
            </div>
          </div>

          <!-- Content -->
          <div style="padding:14px 16px;">
            <div style="font-weight:700;font-size:0.9375rem;margin-bottom:4px;
              overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">
              ${esc(item.title || 'Sem título')}
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
              <span style="font-size:0.75rem;color:var(--text-muted);">${fmt(item.publishedAt)}</span>
              <span style="padding:2px 8px;background:var(--brand-gold)12;color:var(--brand-gold);
                border-radius:20px;font-size:0.6875rem;font-weight:600;">${esc(item.contentType || '')}</span>
              ${item.siteName ? `<span style="font-size:0.6875rem;color:var(--text-muted);">
                ${esc(item.siteName)}</span>` : ''}
            </div>

            <!-- Actions -->
            <div style="display:flex;gap:6px;">
              ${item.link ? `<a href="${esc(item.link)}" target="_blank" rel="noopener"
                class="btn btn-ghost btn-sm" style="flex:1;font-size:0.75rem;text-decoration:none;
                text-align:center;" onclick="event.stopPropagation()">🔗 Ver matéria</a>` : ''}
              <button class="btn btn-ghost btn-sm clip-edit" data-id="${esc(item.id)}"
                style="font-size:0.75rem;color:var(--brand-gold);">✎</button>
              <button class="btn btn-ghost btn-sm clip-del" data-id="${esc(item.id)}"
                data-title="${esc(item.title)}"
                style="font-size:0.75rem;color:#EF4444;">✕</button>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div style="padding:10px 14px;font-size:0.8125rem;color:var(--text-muted);">
      ${filtered.length} resultado${filtered.length !== 1 ? 's' : ''}
      ${filtered.length < allClippings.length ? ` (de ${allClippings.length} total)` : ''}
    </div>`;

  // Wire actions
  listEl.querySelectorAll('.clip-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = allClippings.find(i => i.id === btn.dataset.id);
      if (item) showClipForm(null, item);
    });
  });
  listEl.querySelectorAll('.clip-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Excluir clipping "${btn.dataset.title}"?`)) return;
      await deleteClipping(btn.dataset.id);
      allClippings = allClippings.filter(i => i.id !== btn.dataset.id);
      renderClipKpis();
      renderClipList();
      toast.success('Clipping excluído.');
    });
  });
}

/* ─── Clipping form modal ─────────────────────────────────── */
function showClipForm(container, item = null) {
  const isEdit = !!item?.id;
  const m = document.createElement('div');
  m.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2000;
    display:flex;align-items:center;justify-content:center;padding:20px;`;

  const LBL = `font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;`;
  const pubVal = item?.publishedAt
    ? (item.publishedAt?.toDate ? item.publishedAt.toDate().toISOString().slice(0,10) : item.publishedAt)
    : new Date().toISOString().slice(0,10);

  m.innerHTML = `
    <div class="card" style="width:100%;max-width:600px;max-height:90vh;
      padding:0;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:16px 22px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);
        display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div style="font-weight:700;font-size:1rem;">
          ${isEdit ? 'Editar clipping' : 'Novo clipping'}
        </div>
        <button id="cf-modal-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);">✕</button>
      </div>

      <div style="overflow-y:auto;flex:1;padding:20px 22px;display:flex;flex-direction:column;gap:14px;">

        <!-- Link with auto-fetch -->
        <div>
          <label style="${LBL}">Link da matéria *</label>
          <div style="display:flex;gap:8px;">
            <input id="cf-link" type="url" class="portal-field" style="flex:1;"
              value="${esc(item?.link || '')}" placeholder="https://…">
            <button class="btn btn-secondary btn-sm" id="cf-fetch-meta"
              style="white-space:nowrap;" title="Buscar título e imagem automaticamente">
              🔍 Auto
            </button>
          </div>
          <div id="cf-fetch-status" style="font-size:0.6875rem;color:var(--text-muted);margin-top:4px;"></div>
        </div>

        <!-- Thumbnail preview -->
        <div id="cf-thumb-wrap" style="display:${item?.thumbnail ? 'block' : 'none'};">
          <label style="${LBL}">Thumbnail</label>
          <div style="position:relative;height:100px;border-radius:var(--radius-sm);overflow:hidden;
            background:var(--bg-dark);margin-bottom:4px;">
            <img id="cf-thumb-preview" src="${esc(item?.thumbnail || '')}"
              style="width:100%;height:100%;object-fit:cover;">
          </div>
          <input id="cf-thumb" type="text" class="portal-field" style="width:100%;font-size:0.75rem;"
            value="${esc(item?.thumbnail || '')}" placeholder="URL da imagem (preenchido automaticamente)">
        </div>

        <div>
          <label style="${LBL}">Título da matéria *</label>
          <input id="cf-title" type="text" class="portal-field" style="width:100%;"
            value="${esc(item?.title || '')}" placeholder="Será preenchido automaticamente se usar Auto">
        </div>

        <div>
          <label style="${LBL}">Data da publicação</label>
          <input id="cf-pub" type="date" class="portal-field" style="width:100%;"
            value="${esc(pubVal)}">
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
          <div>
            <label style="${LBL}">Tipo de mídia *</label>
            <select id="cf-m-media" class="filter-select" style="width:100%;">
              <option value="">Selecione…</option>
              ${CLIPPING_MEDIA_TYPES.map(m2 =>
                `<option ${item?.mediaType === m2 ? 'selected' : ''} value="${esc(m2)}">${esc(m2)}</option>`
              ).join('')}
            </select>
          </div>
          <div>
            <label style="${LBL}">Conteúdo *</label>
            <select id="cf-m-content" class="filter-select" style="width:100%;">
              <option value="">Selecione…</option>
              ${CLIPPING_CONTENT_TYPES.map(c =>
                `<option ${item?.contentType === c ? 'selected' : ''} value="${esc(c)}">${esc(c)}</option>`
              ).join('')}
            </select>
          </div>
          <div>
            <label style="${LBL}">Sentimento *</label>
            <select id="cf-m-sentiment" class="filter-select" style="width:100%;">
              <option value="">Selecione…</option>
              ${CLIPPING_SENTIMENTS.map(s =>
                `<option ${item?.sentiment === s.key ? 'selected' : ''} value="${esc(s.key)}">${esc(s.label)}</option>`
              ).join('')}
            </select>
          </div>
        </div>

        <div>
          <label style="${LBL}">Veículo / Fonte <span style="font-weight:400;color:var(--text-muted);">(opcional)</span></label>
          <input id="cf-site" type="text" class="portal-field" style="width:100%;"
            value="${esc(item?.siteName || '')}" placeholder="Ex: Folha de S.Paulo, G1, Valor Econômico…">
        </div>

      </div>

      <div style="padding:14px 22px;border-top:1px solid var(--border-subtle);
        background:var(--bg-surface);display:flex;gap:10px;flex-shrink:0;">
        <button class="btn btn-secondary" id="cf-modal-cancel" style="flex:1;">Cancelar</button>
        <button class="btn btn-primary"   id="cf-modal-save"   style="flex:2;font-weight:600;">
          💾 ${isEdit ? 'Salvar alterações' : 'Cadastrar clipping'}
        </button>
      </div>
    </div>`;

  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  document.getElementById('cf-modal-close')?.addEventListener('click', () => m.remove());
  document.getElementById('cf-modal-cancel')?.addEventListener('click', () => m.remove());

  // Auto-fetch metadata from URL
  document.getElementById('cf-fetch-meta')?.addEventListener('click', async () => {
    const link = document.getElementById('cf-link')?.value?.trim();
    if (!link) { toast.error('Insira o link primeiro.'); return; }

    const statusEl = document.getElementById('cf-fetch-status');
    const fetchBtn = document.getElementById('cf-fetch-meta');
    fetchBtn.disabled = true;
    fetchBtn.textContent = '⏳';
    if (statusEl) statusEl.textContent = 'Buscando metadados…';

    try {
      const meta = await fetchUrlMetadata(link);

      if (meta.title) {
        const titleEl = document.getElementById('cf-title');
        if (titleEl && !titleEl.value.trim()) titleEl.value = meta.title;
      }
      if (meta.thumbnail) {
        const thumbEl = document.getElementById('cf-thumb');
        const previewEl = document.getElementById('cf-thumb-preview');
        const wrapEl = document.getElementById('cf-thumb-wrap');
        if (thumbEl) thumbEl.value = meta.thumbnail;
        if (previewEl) previewEl.src = meta.thumbnail;
        if (wrapEl) wrapEl.style.display = 'block';
      }
      if (meta.siteName) {
        const siteEl = document.getElementById('cf-site');
        if (siteEl && !siteEl.value.trim()) siteEl.value = meta.siteName;
      }

      if (statusEl) statusEl.textContent = meta.title
        ? '✓ Metadados encontrados!'
        : '⚠ Não foi possível extrair metadados. Preencha manualmente.';
      if (statusEl) statusEl.style.color = meta.title ? '#22C55E' : '#F59E0B';
    } catch {
      if (statusEl) {
        statusEl.textContent = '⚠ Erro ao buscar. Preencha manualmente.';
        statusEl.style.color = '#EF4444';
      }
    }
    fetchBtn.disabled = false;
    fetchBtn.textContent = '🔍 Auto';
  });

  // Save
  document.getElementById('cf-modal-save')?.addEventListener('click', async () => {
    const btn = document.getElementById('cf-modal-save');
    const title     = document.getElementById('cf-title')?.value?.trim();
    const link      = document.getElementById('cf-link')?.value?.trim();
    const mediaType = document.getElementById('cf-m-media')?.value;
    const contentType = document.getElementById('cf-m-content')?.value;
    const sentiment = document.getElementById('cf-m-sentiment')?.value;

    if (!link)        { toast.error('Insira o link da matéria.'); return; }
    if (!title)       { toast.error('Preencha o título.'); return; }
    if (!mediaType)   { toast.error('Selecione o tipo de mídia.'); return; }
    if (!contentType) { toast.error('Selecione o tipo de conteúdo.'); return; }
    if (!sentiment)   { toast.error('Selecione a análise de sentimento.'); return; }

    btn.disabled = true; btn.textContent = '⏳';
    try {
      const data = {
        link,
        title,
        thumbnail:   document.getElementById('cf-thumb')?.value?.trim() || '',
        publishedAt: document.getElementById('cf-pub')?.value || new Date().toISOString().slice(0,10),
        mediaType,
        contentType,
        sentiment,
        siteName:    document.getElementById('cf-site')?.value?.trim() || '',
      };
      const savedId = await saveClipping(item?.id || null, data);
      const idx = allClippings.findIndex(i => i.id === (item?.id || savedId));
      const updated = { ...data, id: savedId };
      if (idx >= 0) allClippings[idx] = updated;
      else allClippings.unshift(updated);
      renderClipKpis();
      renderClipList();
      m.remove();
      toast.success(isEdit ? 'Clipping atualizado.' : 'Clipping cadastrado.');
    } catch(e) {
      toast.error('Erro: ' + e.message);
      btn.disabled = false;
      btn.textContent = `💾 ${isEdit ? 'Salvar alterações' : 'Cadastrar clipping'}`;
    }
  });
}

/* ─── Clipping Export XLS ─────────────────────────────────── */
async function exportClipXls() {
  const items = applyClipClientFilters(allClippings);
  if (!items.length) { toast.error('Nenhum item para exportar.'); return; }

  if (!window.XLSX) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }

  const sentLabel = key => CLIPPING_SENTIMENTS.find(s => s.key === key)?.label || key;
  const rows = [
    ['Título', 'Link', 'Veículo', 'Data', 'Tipo de Mídia', 'Conteúdo', 'Sentimento'],
    ...items.map(i => [
      i.title || '', i.link || '', i.siteName || '',
      fmt(i.publishedAt), i.mediaType || '', i.contentType || '',
      sentLabel(i.sentiment),
    ]),
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [50, 55, 25, 14, 16, 18, 14].map(w => ({ wch: w }));

  // Make links clickable in the Link column (column B, index 1)
  items.forEach((item, idx) => {
    if (item.link) {
      const cellRef = XLSX.utils.encode_cell({ r: idx + 1, c: 1 }); // +1 for header row
      if (ws[cellRef]) ws[cellRef].l = { Target: item.link, Tooltip: item.title || 'Abrir matéria' };
    }
  });

  XLSX.utils.book_append_sheet(wb, ws, 'Clipping');
  XLSX.writeFile(wb, `primetour_clipping_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast.success('XLS exportado.');
}

/* ─── Clipping Export PDF ─────────────────────────────────── */
const exportClipPdf = withExportGuard(async function exportClipPdf() {
  const items = applyClipClientFilters(allClippings);
  if (!items.length) { toast.error('Nenhum item para exportar.'); return; }
  await loadJsPdf();

  const sentLabel = key => CLIPPING_SENTIMENTS.find(s => s.key === key)?.label || key;
  const SENT_COL = {
    positive: COL.green, positivo: COL.green,
    neutral:  COL.muted, neutro:   COL.muted,
    negative: COL.red,   negativo: COL.red,
    mixed:    COL.orange, misto:   COL.orange,
  };
  const sentColor = key => SENT_COL[(key||'').toLowerCase()] || COL.brand2;

  const kit = createDoc({ orientation: 'portrait', margin: 14 });
  const { doc, W, M, CW, setFill, setText, setDraw, drawBar, drawChip, wrap } = kit;

  // Agregação por sentimento
  const bySent = items.reduce((acc, i) => {
    const k = i.sentiment || 'neutro'; acc[k] = (acc[k] || 0) + 1; return acc;
  }, {});

  kit.drawCover({
    title: 'Clipping de Imprensa',
    subtitle: 'PRIMETOUR  ·  Menções na Mídia',
    meta: `${items.length} ${items.length === 1 ? 'matéria' : 'matérias'}  ·  ${new Date().toLocaleDateString('pt-BR')}`,
  });

  // Strip por sentimento
  const sentEntries = Object.entries(bySent);
  if (sentEntries.length) {
    const bw = (CW - (sentEntries.length - 1) * 3) / sentEntries.length;
    sentEntries.forEach(([k, n], i) => {
      const x = M + i * (bw + 3);
      const col = sentColor(k);
      setFill(COL.bg); doc.roundedRect(x, kit.y, bw, 20, 1.8, 1.8, 'F');
      setFill(col);    doc.rect(x, kit.y, bw, 1.6, 'F');
      setText(COL.text); doc.setFont('helvetica','bold'); doc.setFontSize(16);
      doc.text(String(n), x + 5, kit.y + 12);
      setText(col); doc.setFont('helvetica','bold'); doc.setFontSize(7);
      doc.text(txt(sentLabel(k).toUpperCase()), x + 5, kit.y + 17.5);
    });
    kit.addY(25);
  }

  // Cards de matéria
  items.forEach((i) => {
    const sCol = sentColor(i.sentiment);
    const title = i.title || '(sem título)';
    const titleLines = wrap(title, CW - 12, 10);
    const meta = [i.siteName, fmt(i.publishedAt), i.mediaType, i.contentType].filter(Boolean).join('  ·  ');
    const metaLines = meta ? wrap(meta, CW - 12, 7.8) : [];
    const cardH = 10 + titleLines.length * 4.2 + metaLines.length * 3.6 + 6;

    kit.ensureSpace(cardH + 2.5);
    const top = kit.y;
    setFill(COL.white); setDraw(COL.border); doc.setLineWidth(0.2);
    doc.roundedRect(M, top, CW, cardH, 1.8, 1.8, 'FD');
    setFill(sCol); doc.rect(M, top, 2, cardH, 'F');

    // Sent chip topo
    drawChip(sentLabel(i.sentiment), M + 5, top + 3, sCol, COL.white, 6.5, 2.2, 1.2);

    // Link à direita (se houver)
    if (i.link) {
      const lbl = 'ABRIR MATERIA';
      doc.setFont('helvetica','bold'); doc.setFontSize(6.8); setText(COL.blue);
      const lw = doc.getTextWidth(lbl) + 5;
      setDraw(COL.blue); doc.setLineWidth(0.3);
      doc.roundedRect(W - M - lw, top + 3, lw, 4.5, 1, 1, 'S');
      doc.text(lbl, W - M - lw + 2.5, top + 6.2);
      doc.link(W - M - lw, top + 3, lw, 4.5, { url: i.link });
    }

    // Título
    kit.y = top + 11;
    setText(COL.text); doc.setFont('helvetica','bold'); doc.setFontSize(10);
    doc.text(titleLines, M + 5, kit.y);
    kit.addY(titleLines.length * 4.2);

    // Meta
    if (metaLines.length) {
      setText(COL.muted); doc.setFont('helvetica','normal'); doc.setFontSize(7.8);
      doc.text(metaLines, M + 5, kit.y);
    }
    kit.y = top + cardH + 2.5;
  });

  kit.drawFooter('PRIMETOUR  ·  Clipping');
  doc.save(`primetour_clipping_${new Date().toISOString().slice(0,10)}.pdf`);
  toast.success('PDF exportado.');
});

/* ─── Export XLS ───────────────────────────────────────────── */
async function exportXls() {
  const items = applyClientFilters(allItems);
  if (!items.length) { toast.error('Nenhum item para exportar.'); return; }

  // Load SheetJS
  if (!window.XLSX) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }
  const rows = [
    ['Título','Categoria','Subcategoria','Descrição','Link','Publicado','Validade'],
    ...items.map(i => [
      i.title, i.category, i.subcategory, i.description||'', i.link||'',
      fmt(i.publishedAt), i.expiresAt||'',
    ]),
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [40,20,15,60,40,12,12].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, 'Notícias');
  XLSX.writeFile(wb, `primetour_noticias_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast.success('XLS exportado.');
}

/* ─── Export PDF ───────────────────────────────────────────── */
const exportPdf = withExportGuard(async function exportPdf() {
  const items = applyClientFilters(allItems);
  if (!items.length) { toast.error('Nenhum item para exportar.'); return; }
  await loadJsPdf();

  const kit = createDoc({ orientation: 'portrait', margin: 14 });
  const { doc, W, M, CW, setFill, setText, setDraw, drawBar, drawChip, wrap } = kit;

  kit.drawCover({
    title: 'Monitor de Notícias',
    subtitle: 'PRIMETOUR  ·  Notícias do Setor',
    meta: `${items.length} ${items.length === 1 ? 'notícia' : 'notícias'}  ·  ${new Date().toLocaleDateString('pt-BR')}`,
  });

  // Agregação por categoria
  const byCat = items.reduce((acc, i) => {
    const k = i.category || '—'; acc[k] = (acc[k] || 0) + 1; return acc;
  }, {});
  const catEntries = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0, 6);
  if (catEntries.length) {
    setText(COL.muted); doc.setFont('helvetica','bold'); doc.setFontSize(7);
    doc.text(txt('POR CATEGORIA'), M, kit.y); kit.addY(4);
    const maxN = catEntries[0][1];
    catEntries.forEach(([cat, n]) => {
      setText(COL.text); doc.setFont('helvetica','normal'); doc.setFontSize(8);
      doc.text(txt(cat), M, kit.y);
      setText(COL.muted); doc.setFont('helvetica','bold'); doc.setFontSize(7.5);
      doc.text(String(n), W - M, kit.y, { align: 'right' });
      kit.addY(2);
      drawBar(M, kit.y, CW, Math.round(n * 100 / maxN), COL.brand2, 1.4);
      kit.addY(4.5);
    });
    kit.addY(4);
  }

  // Cards de notícia
  items.forEach(i => {
    const title = i.title || '(sem título)';
    const desc = (i.description || '').trim();
    const titleLines = wrap(title, CW - 12, 10);
    const descLines  = desc ? wrap(desc, CW - 12, 8) : [];
    const meta = [i.category, i.subcategory, fmt(i.publishedAt)].filter(Boolean).join('  ·  ');
    const metaLines  = meta ? wrap(meta, CW - 12, 7.5) : [];
    const cardH = 10 + titleLines.length * 4.2 + descLines.length * 3.6 + metaLines.length * 3.4 + 6;

    kit.ensureSpace(cardH + 2.5);
    const top = kit.y;
    setFill(COL.white); setDraw(COL.border); doc.setLineWidth(0.2);
    doc.roundedRect(M, top, CW, cardH, 1.8, 1.8, 'FD');
    setFill(COL.brand2); doc.rect(M, top, 2, cardH, 'F');

    // Categoria chip
    if (i.category) drawChip(i.category, M + 5, top + 3, COL.brand2, COL.white, 6.5, 2.2, 1.2);

    // Validade à direita (se houver)
    if (i.expiresAt) {
      const exp = new Date(i.expiresAt);
      const isSoon = (exp - Date.now()) < 7 * 24 * 3600 * 1000;
      const valCol = isSoon ? COL.orange : COL.muted;
      setText(valCol); doc.setFont('helvetica','bold'); doc.setFontSize(6.8);
      doc.text(txt(`VALIDADE ${exp.toLocaleDateString('pt-BR')}`), W - M - 2, top + 6, { align: 'right' });
    }

    kit.y = top + 11;
    setText(COL.text); doc.setFont('helvetica','bold'); doc.setFontSize(10);
    doc.text(titleLines, M + 5, kit.y);
    kit.addY(titleLines.length * 4.2);

    if (descLines.length) {
      setText(COL.text); doc.setFont('helvetica','normal'); doc.setFontSize(8);
      doc.text(descLines, M + 5, kit.y);
      kit.addY(descLines.length * 3.6);
    }
    if (metaLines.length) {
      setText(COL.muted); doc.setFont('helvetica','italic'); doc.setFontSize(7.5);
      doc.text(metaLines, M + 5, kit.y);
    }
    kit.y = top + cardH + 2.5;
  });

  kit.drawFooter('PRIMETOUR  ·  Notícias');
  doc.save(`primetour_noticias_${new Date().toISOString().slice(0,10)}.pdf`);
  toast.success('PDF exportado.');
});


