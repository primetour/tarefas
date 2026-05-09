/**
 * PRIMETOUR — System Feedback (admin view)
 *
 * Lista feedbacks do sistema enviados pelos usuários. Filtros por tipo
 * e status. Admin altera status e responde.
 *
 * Acesso: master, admin (system_manage_settings).
 */

import { store } from '../store.js';
import { toast } from '../components/toast.js';
import { modal } from '../components/modal.js';
import {
  fetchSystemFeedbacks, updateSystemFeedback, deleteSystemFeedback,
  FEEDBACK_TYPES, FEEDBACK_STATUSES,
  getFeedbackType, getFeedbackStatus,
} from '../services/systemFeedback.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = (ts) => {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

let allFeedbacks = [];
let filterStatus = '';
let filterType   = '';

export async function renderSystemFeedback(container) {
  if (!store.can('system_manage_settings')) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
      <p class="text-sm text-muted">Esta página é visível apenas para Diretoria e Head.</p>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Feedbacks do Sistema</h1>
        <p class="page-subtitle">Bugs, sugestões, dúvidas e elogios enviados pelos usuários</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-secondary btn-sm" id="sf-refresh">↻ Atualizar</button>
      </div>
    </div>

    <div class="toolbar">
      <div class="toolbar-filter-wrap" style="display:flex;gap:10px;flex-wrap:wrap;">
        <select id="sf-filter-status" style="padding:8px 12px;border-radius:6px;border:1px solid var(--border-default);background:var(--bg-surface);color:var(--text-primary);">
          <option value="">Todos os status</option>
          ${FEEDBACK_STATUSES.map(s=>`<option value="${s.id}">${s.label}</option>`).join('')}
        </select>
        <select id="sf-filter-type" style="padding:8px 12px;border-radius:6px;border:1px solid var(--border-default);background:var(--bg-surface);color:var(--text-primary);">
          <option value="">Todos os tipos</option>
          ${FEEDBACK_TYPES.map(t=>`<option value="${t.id}">${t.label}</option>`).join('')}
        </select>
      </div>
    </div>

    <div id="sf-stats" style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:18px;"></div>

    <div id="sf-list-wrap"></div>
  `;

  document.getElementById('sf-refresh')?.addEventListener('click', loadList);
  document.getElementById('sf-filter-status')?.addEventListener('change', e => {
    filterStatus = e.target.value;
    renderList();
  });
  document.getElementById('sf-filter-type')?.addEventListener('change', e => {
    filterType = e.target.value;
    renderList();
  });

  await loadList();
}

async function loadList() {
  const wrap = document.getElementById('sf-list-wrap');
  if (wrap) wrap.innerHTML = '<div class="loading-spinner" style="margin:40px auto;"></div>';
  try {
    allFeedbacks = await fetchSystemFeedbacks();
  } catch (e) {
    if (wrap) wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠</div><p>${esc(e.message)}</p></div>`;
    return;
  }
  renderList();
}

function renderList() {
  const wrap = document.getElementById('sf-list-wrap');
  const stats = document.getElementById('sf-stats');
  if (!wrap) return;

  // Stats por status
  const counts = { total: allFeedbacks.length };
  FEEDBACK_STATUSES.forEach(s => { counts[s.id] = allFeedbacks.filter(f => f.status === s.id).length; });
  stats.innerHTML = `
    ${kpiCard('Total', counts.total, '#D4A843')}
    ${kpiCard('Novos', counts.new, '#38BDF8')}
    ${kpiCard('Em análise', counts.analyzing, '#F59E0B')}
    ${kpiCard('Em desenv.', counts.in_progress, '#A78BFA')}
    ${kpiCard('Resolvidos', counts.resolved, '#22C55E')}
  `;

  // Filtra
  let filtered = allFeedbacks;
  if (filterStatus) filtered = filtered.filter(f => f.status === filterStatus);
  if (filterType)   filtered = filtered.filter(f => f.type === filterType);

  if (!filtered.length) {
    wrap.innerHTML = `<div class="empty-state" style="min-height:200px;">
      <div class="empty-state-icon">💬</div>
      <div class="empty-state-title">Nenhum feedback ${filterStatus||filterType?'com esse filtro':'ainda'}</div>
    </div>`;
    return;
  }

  wrap.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;">
    ${filtered.map(renderCard).join('')}
  </div>`;

  // bind actions
  wrap.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fb = filtered.find(f => f.id === btn.dataset.id);
      if (!fb) return;
      const action = btn.dataset.action;
      if (action === 'view')   openDetail(fb);
      if (action === 'delete') handleDelete(fb);
    });
  });
}

function kpiCard(label, val, color) {
  return `<div class="card" style="padding:14px;text-align:center;">
    <div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;margin-bottom:4px;">${label}</div>
    <div style="font-size:1.75rem;font-weight:700;color:${color};">${val}</div>
  </div>`;
}

function renderCard(fb) {
  const tInfo = getFeedbackType(fb.type) || { label: fb.type, color: '#888' };
  const sInfo = getFeedbackStatus(fb.status) || { label: fb.status, color: '#888' };
  const preview = (fb.message || '').slice(0, 200);
  return `<div class="card" data-id="${fb.id}" style="padding:14px 16px;cursor:pointer;" data-action="view">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
      <span style="background:${tInfo.color}22;color:${tInfo.color};padding:3px 10px;border-radius:var(--radius-full);
        font-size:0.7rem;font-weight:600;">${tInfo.label}</span>
      <span style="background:${sInfo.color}22;color:${sInfo.color};padding:3px 10px;border-radius:var(--radius-full);
        font-size:0.7rem;font-weight:600;">${sInfo.label}</span>
      <span style="font-size:0.75rem;color:var(--text-muted);margin-left:auto;">${fmtDate(fb.createdAt)}</span>
    </div>
    <div style="font-size:0.875rem;color:var(--text-primary);margin-bottom:6px;line-height:1.5;">${esc(preview)}${(fb.message||'').length>200?'…':''}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.75rem;color:var(--text-muted);">
      <span>👤 ${esc(fb.authorName)} · ${esc(fb.authorEmail)} · ${esc(fb.authorRole)}</span>
      <span style="font-family:ui-monospace,Menlo,monospace;">${esc(fb.page||'#')}</span>
    </div>
  </div>`;
}

function openDetail(fb) {
  const tInfo = getFeedbackType(fb.type) || { label: fb.type, color: '#888' };
  const sInfo = getFeedbackStatus(fb.status) || { label: fb.status, color: '#888' };

  const m = modal.open({
    title: `${tInfo.label} · ${sInfo.label}`,
    size: 'md',
    content: `
      <div style="margin-bottom:14px;padding:12px;background:var(--bg-surface);border-radius:6px;font-size:0.8125rem;line-height:1.6;">
        <div><strong>De:</strong> ${esc(fb.authorName)} (${esc(fb.authorEmail)}) · ${esc(fb.authorRole)}</div>
        <div><strong>Quando:</strong> ${fmtDate(fb.createdAt)}</div>
        <div><strong>Página:</strong> <code style="font-size:0.75rem;">${esc(fb.page||'#')}</code></div>
        <div><strong>Versão:</strong> <code style="font-size:0.75rem;">${esc(fb.appVersion||'?')}</code></div>
      </div>

      <div class="form-group">
        <label class="form-label">Mensagem do usuário</label>
        <div style="padding:12px;background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:6px;
          white-space:pre-wrap;font-size:0.875rem;line-height:1.6;color:var(--text-primary);">${esc(fb.message||'')}</div>
      </div>

      <div class="form-group">
        <label class="form-label">Status</label>
        <select id="sf-edit-status" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-default);background:var(--bg-surface);color:var(--text-primary);">
          ${FEEDBACK_STATUSES.map(s => `<option value="${s.id}" ${fb.status===s.id?'selected':''}>${s.label}</option>`).join('')}
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">Resposta interna (opcional)</label>
        <textarea id="sf-edit-response" class="form-textarea" rows="3" maxlength="1000"
          placeholder="Anotação interna sobre como esse feedback foi tratado.">${esc(fb.adminResponse||'')}</textarea>
      </div>

      ${store.isMaster() ? `
        <div style="text-align:right;margin-top:8px;">
          <button id="sf-delete-btn" class="btn btn-ghost btn-sm" style="color:var(--color-danger);">🗑 Excluir feedback</button>
        </div>
      ` : ''}
    `,
    footer: [
      { label: 'Cancelar', class: 'btn-secondary', closeOnClick: true },
      {
        label: 'Salvar',
        class: 'btn-primary',
        closeOnClick: false,
        onClick: async (_, { close }) => {
          const status = document.getElementById('sf-edit-status')?.value;
          const response = document.getElementById('sf-edit-response')?.value || '';
          try {
            await updateSystemFeedback(fb.id, { status, adminResponse: response });
            toast.success('Atualizado.');
            close();
            await loadList();
          } catch (e) { toast.error(e.message); }
        }
      }
    ],
  });

  setTimeout(() => {
    document.getElementById('sf-delete-btn')?.addEventListener('click', async () => {
      const ok = await modal.confirm({
        title: 'Excluir feedback',
        message: 'Excluir permanentemente este feedback? Esta ação não pode ser desfeita.',
        confirmText: 'Excluir', danger: true,
      });
      if (!ok) return;
      try {
        await deleteSystemFeedback(fb.id);
        toast.success('Excluído.');
        m.close();
        await loadList();
      } catch (e) { toast.error(e.message); }
    });
  }, 60);
}

async function handleDelete(fb) {
  if (!store.isMaster()) { toast.error('Apenas Diretoria pode excluir.'); return; }
  const ok = await modal.confirm({
    title: 'Excluir feedback',
    message: 'Excluir permanentemente este feedback?',
    confirmText: 'Excluir', danger: true,
  });
  if (!ok) return;
  try {
    await deleteSystemFeedback(fb.id);
    toast.success('Excluído.');
    await loadList();
  } catch (e) { toast.error(e.message); }
}
