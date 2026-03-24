/**
 * PRIMETOUR — Monitoramento de Notícias
 */
import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { openTaskModal } from '../components/taskModal.js';
import {
  fetchNews, saveNewsItem, deleteNewsItem,
  NEWS_CATEGORIES, NEWS_SUBCATEGORIES,
} from '../services/newsMonitor.js';

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

export async function renderNewsMonitor(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Monitoramento de Notícias</h1>
        <p class="page-subtitle">Central de notícias e tendências do mercado de viagens</p>
      </div>
      <div class="page-header-actions" style="gap:8px;">
        <button class="btn btn-secondary btn-sm" id="news-export-xls">↓ XLS</button>
        <button class="btn btn-secondary btn-sm" id="news-export-pdf">↓ PDF</button>
        <button class="btn btn-primary btn-sm"   id="news-new-btn">+ Nova notícia</button>
      </div>
    </div>

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

  el.innerHTML = [
    ['Total',       total,   'var(--text-primary)'],
    ['Vigentes',    valid,   '#22C55E'],
    ['Expiradas',   expired, '#EF4444'],
    ['Últimos 7d',  week,    'var(--brand-gold)'],
  ].map(([label, val, color]) => `
    <div style="padding:12px 18px;background:var(--bg-surface);border:1px solid var(--border-subtle);
      border-radius:var(--radius-md);min-width:110px;text-align:center;">
      <div style="font-size:1.5rem;font-weight:700;color:${color};">${val}</div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">${label}</div>
    </div>`).join('');
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
      // Open task modal pre-filled with news content
      openTaskModal({
        taskData: {
          title:       item.title || '',
          description: [
            item.description || '',
            item.link ? `\n🔗 Fonte: ${item.link}` : '',
            `\n📰 Categoria: ${item.category || ''} · ${item.subcategory || ''}`,
          ].filter(Boolean).join(''),
        },
        onSave: () => toast.success('Tarefa criada a partir da notícia!'),
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
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
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
async function exportPdf() {
  const items = applyClientFilters(allItems);
  if (!items.length) { toast.error('Nenhum item para exportar.'); return; }

  if (!window.jspdf) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' });

  doc.setFontSize(14); doc.setFont('helvetica','bold');
  doc.setTextColor(36,35,98);
  doc.text('PRIMETOUR — Monitoramento de Notícias', 14, 16);
  doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(100,100,100);
  doc.text(`Gerado em ${new Date().toLocaleDateString('pt-BR')} · ${items.length} itens`, 14, 22);

  doc.autoTable({
    startY: 27,
    head: [['Título','Categoria','Subcategoria','Descrição','Publicado','Validade']],
    body: items.map(i => [
      (i.title||'').slice(0,50),
      i.category||'',
      i.subcategory||'',
      (i.description||'').slice(0,80),
      fmt(i.publishedAt),
      i.expiresAt ? new Date(i.expiresAt).toLocaleDateString('pt-BR') : '—',
    ]),
    styles:      { fontSize: 8, cellPadding: 3 },
    headStyles:  { fillColor: [36,35,98], textColor: 255, fontStyle:'bold' },
    columnStyles:{ 0:{cellWidth:55}, 1:{cellWidth:28}, 2:{cellWidth:25}, 3:{cellWidth:75}, 4:{cellWidth:22}, 5:{cellWidth:22} },
    alternateRowStyles: { fillColor: [248,247,244] },
    didDrawPage: (data) => {
      doc.setFontSize(7); doc.setTextColor(180,180,180);
      doc.text(`PRIMETOUR · p.${doc.getNumberOfPages()}`, 285, 205, { align:'right' });
    },
  });

  doc.save(`primetour_noticias_${new Date().toISOString().slice(0,10)}.pdf`);
  toast.success('PDF exportado.');
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
