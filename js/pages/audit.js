/**
 * PRIMETOUR — Audit Log Page (Etapa 3)
 * Visualização completa do log de auditoria
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { fetchAuditLogs, ACTION_LABELS } from '../auth/audit.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ─── State ──────────────────────────────────────────────── */
let allLogs        = [];
let filteredLogs   = [];
let searchTerm     = '';
let filterAction   = '';
let filterUser     = '';
let currentPage    = 1;
const PAGE_SIZE    = 25;
let isLoading      = false;
let lastDoc        = null;
let hasMore        = true;

const ACTION_GROUPS = {
  auth:     { label: 'Autenticação', color: '#A78BFA', class: 'audit-auth' },
  tasks:    { label: 'Tarefas',      color: '#38BDF8', class: 'audit-update' },
  projects: { label: 'Projetos',     color: '#F59E0B', class: 'audit-update' },
  users:    { label: 'Usuários',     color: '#22C55E', class: 'audit-create' },
};

function getActionClass(action) {
  if (!action) return 'audit-other';
  if (action.startsWith('auth'))            return 'audit-auth';
  if (action.includes('create'))            return 'audit-create';
  if (action.includes('delete') || action.includes('deactivate')) return 'audit-delete';
  if (action.includes('update') || action.includes('reactivate')) return 'audit-update';
  return 'audit-other';
}

function getActionIcon(action) {
  if (!action) return '○';
  if (action.startsWith('auth.login'))    return '→';
  if (action.startsWith('auth.logout'))   return '←';
  if (action.includes('create'))          return '+';
  if (action.includes('delete'))          return '✕';
  if (action.includes('deactivate'))      return '⏸';
  if (action.includes('reactivate'))      return '▶';
  if (action.includes('update') || action.includes('move') || action.includes('complete')) return '✎';
  return '○';
}

/* ─── Render ─────────────────────────────────────────────── */
export async function renderAudit(container) {
  if (!store.isAdmin()) {
    container.innerHTML = `
      <div class="empty-state" style="min-height:60vh;">
        <div class="empty-state-icon">🔒</div>
        <div class="empty-state-title">Acesso restrito</div>
        <p class="text-sm text-muted">Somente administradores podem ver o log de auditoria.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Log de Auditoria</h1>
        <p class="page-subtitle" id="audit-count-label">Carregando registros...</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-secondary btn-sm" id="audit-refresh-btn">↺ Atualizar</button>
        <button class="btn btn-secondary btn-sm" id="audit-export-btn">↓ Exportar CSV</button>
      </div>
    </div>

    <!-- Filters -->
    <div class="toolbar" style="margin-bottom:16px;">
      <div class="toolbar-search">
        <span class="toolbar-search-icon">🔍</span>
        <input type="text" class="toolbar-search-input" id="audit-search"
          placeholder="Buscar por usuário, ação, recurso..." />
      </div>
      <select class="filter-select" id="audit-filter-action">
        <option value="">Todas as ações</option>
        <optgroup label="Autenticação">
          <option value="auth.login">Login</option>
          <option value="auth.logout">Logout</option>
          <option value="auth.password_changed">Senha alterada</option>
        </optgroup>
        <optgroup label="Tarefas">
          <option value="tasks.create">Criar tarefa</option>
          <option value="tasks.update">Atualizar tarefa</option>
          <option value="tasks.delete">Excluir tarefa</option>
          <option value="tasks.complete">Completar tarefa</option>
        </optgroup>
        <optgroup label="Projetos">
          <option value="projects.create">Criar projeto</option>
          <option value="projects.update">Atualizar projeto</option>
          <option value="projects.delete">Excluir projeto</option>
        </optgroup>
        <optgroup label="Usuários">
          <option value="users.create">Criar usuário</option>
          <option value="users.update">Atualizar usuário</option>
          <option value="users.deactivate">Desativar usuário</option>
          <option value="users.reactivate">Reativar usuário</option>
        </optgroup>
      </select>
      <select class="filter-select" id="audit-filter-user">
        <option value="">Todos os usuários</option>
        ${(store.get('users')||[]).map(u =>
          `<option value="${u.id}">${esc(u.name)}</option>`
        ).join('')}
      </select>
      <input type="date" class="filter-select" id="audit-filter-date-from"
        style="padding:8px 12px;" title="Data de início" />
      <input type="date" class="filter-select" id="audit-filter-date-to"
        style="padding:8px 12px;" title="Data de término" />
      <button class="btn btn-ghost btn-sm" id="audit-clear-filters">✕ Limpar</button>
    </div>

    <!-- Stats row -->
    <div class="grid" style="grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:20px;" id="audit-stats">
    </div>

    <!-- Log table -->
    <div class="card" style="overflow:hidden;">
      <div class="audit-log-header">
        <div>Data/Hora</div>
        <div>Ação</div>
        <div>Usuário</div>
        <div>Recurso</div>
        <div>Detalhes</div>
      </div>
      <div id="audit-log-body">
        <div class="task-empty">
          <div class="task-empty-icon">⟳</div>
          <div class="task-empty-title">Carregando registros...</div>
        </div>
      </div>
    </div>

    <!-- Pagination -->
    <div id="audit-pagination" style="display:flex; justify-content:center; align-items:center; gap:12px; margin-top:16px; padding:8px 0;">
    </div>
  `;

  _bindAuditEvents();
  await loadLogs();
}

/* ─── Load logs ──────────────────────────────────────────── */
async function loadLogs(reset = true) {
  if (isLoading) return;
  isLoading = true;

  const refreshBtn = document.getElementById('audit-refresh-btn');
  if (refreshBtn) { refreshBtn.classList.add('loading'); refreshBtn.disabled = true; }

  try {
    const dateFrom = document.getElementById('audit-filter-date-from')?.value;
    const dateTo   = document.getElementById('audit-filter-date-to')?.value;

    const result = await fetchAuditLogs({
      pageSize:    200,
      filterAction: filterAction || null,
      filterUser: filterUser || null,
      startDate: dateFrom ? new Date(dateFrom) : null,
      endDate: dateTo ? new Date(dateTo + 'T23:59:59') : null,
    });

    allLogs = result.logs || result;
    applyLocalFilters();
    renderStats();
  } catch(e) {
    console.error('Audit load error:', e);
    toast.error('Erro ao carregar logs de auditoria: ' + e.message);
    const body = document.getElementById('audit-log-body');
    if (body) body.innerHTML = `
      <div class="task-empty">
        <div class="task-empty-icon">⚠</div>
        <div class="task-empty-title">Erro ao carregar logs</div>
        <p class="text-sm text-muted mt-2">${esc(e.message)}</p>
      </div>
    `;
  } finally {
    isLoading = false;
    if (refreshBtn) { refreshBtn.classList.remove('loading'); refreshBtn.disabled = false; }
  }
}

/* ─── Local filter ────────────────────────────────────────── */
function applyLocalFilters() {
  let result = [...allLogs];

  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    result = result.filter(log =>
      log.userName?.toLowerCase().includes(q) ||
      log.action?.toLowerCase().includes(q) ||
      log.entityId?.toLowerCase().includes(q) ||
      JSON.stringify(log.details||{}).toLowerCase().includes(q)
    );
  }
  if (filterAction) result = result.filter(l => l.action === filterAction);
  if (filterUser)   result = result.filter(l => l.userId === filterUser);

  filteredLogs = result;
  currentPage  = 1;

  const label = document.getElementById('audit-count-label');
  if (label) label.textContent = `${filteredLogs.length} registro${filteredLogs.length !== 1 ? 's' : ''}${allLogs.length !== filteredLogs.length ? ` de ${allLogs.length}` : ''}`;

  renderLogs();
}

/* ─── Render logs table ──────────────────────────────────── */
function renderLogs() {
  const body = document.getElementById('audit-log-body');
  if (!body) return;

  const start = (currentPage - 1) * PAGE_SIZE;
  const page  = filteredLogs.slice(start, start + PAGE_SIZE);

  if (filteredLogs.length === 0) {
    body.innerHTML = `
      <div class="task-empty">
        <div class="task-empty-icon">📋</div>
        <div class="task-empty-title">Nenhum registro encontrado</div>
      </div>
    `;
    renderPagination();
    return;
  }

  body.innerHTML = page.map(log => {
    const ts  = log.timestamp?.toDate ? log.timestamp.toDate() : (log.timestamp ? new Date(log.timestamp) : null);
    const fmt = ts ? new Intl.DateTimeFormat('pt-BR',{
      day:'2-digit', month:'2-digit', year:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit',
    }).format(ts) : '—';
    const actionLabel = ACTION_LABELS[log.action] || log.action || '—';
    const actionClass = getActionClass(log.action);
    const icon        = getActionIcon(log.action);

    const details = log.details ? Object.entries(log.details)
      .filter(([k]) => !['_ts','userAgent'].includes(k))
      .map(([k,v]) => `${k}: ${JSON.stringify(v)}`).join(' · ') : '';

    const userColor = (store.get('users')||[]).find(u=>u.id===log.userId)?.avatarColor || '#6B7280';
    const initials  = (log.userName||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();

    return `
      <div class="audit-log-row">
        <div style="font-size:0.75rem; color:var(--text-muted); font-variant-numeric:tabular-nums;">
          ${fmt}
        </div>
        <div>
          <span class="audit-action-badge ${actionClass}">
            <span>${icon}</span>${esc(actionLabel)}
          </span>
        </div>
        <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
          <div class="avatar" style="background:${userColor}; width:22px; height:22px; font-size:0.5rem; flex-shrink:0;">
            ${initials}
          </div>
          <span style="font-size:0.8125rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-secondary);">
            ${esc(log.userName || '—')}
          </span>
        </div>
        <div style="font-size:0.75rem; color:var(--text-muted); font-family:monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          ${log.entityType ? `${esc(log.entityType)}${log.entityId ? ' · ' + esc(log.entityId.slice(0,8)) : ''}` : '—'}
        </div>
        <div style="font-size:0.75rem; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          ${esc(details.slice(0, 80))}${details.length > 80 ? '…' : ''}
        </div>
      </div>
    `;
  }).join('');

  renderPagination();
}

/* ─── Stats ───────────────────────────────────────────────── */
function renderStats() {
  const el = document.getElementById('audit-stats');
  if (!el || !allLogs.length) return;

  const today = new Date(); today.setHours(0,0,0,0);
  const todayLogs = allLogs.filter(l => {
    const d = l.timestamp?.toDate ? l.timestamp.toDate() : new Date(l.timestamp||0);
    return d >= today;
  });
  const authLogs = allLogs.filter(l => l.action?.startsWith('auth'));
  const uniqueUsers = new Set(allLogs.map(l=>l.userId)).size;

  el.innerHTML = `
    ${auditStatCard('Registros Hoje', todayLogs.length, '📅', 'rgba(56,189,248,0.12)', '#38BDF8')}
    ${auditStatCard('Ações de Auth', authLogs.length, '🔑', 'rgba(167,139,250,0.12)', '#A78BFA')}
    ${auditStatCard('Usuários Ativos', uniqueUsers, '◎', 'rgba(212,168,67,0.12)', 'var(--brand-gold)')}
    ${auditStatCard('Total no Período', allLogs.length, '📋', 'rgba(34,197,94,0.12)', '#22C55E')}
  `;
}

function auditStatCard(label, value, icon, ibg, ic) {
  return `<div class="stat-card">
    <div class="stat-card-icon" style="background:${ibg}; color:${ic};">${icon}</div>
    <div class="stat-card-label">${label}</div>
    <div class="stat-card-value">${value}</div>
  </div>`;
}

/* ─── Pagination ──────────────────────────────────────────── */
function renderPagination() {
  const el       = document.getElementById('audit-pagination');
  if (!el) return;
  const total    = Math.ceil(filteredLogs.length / PAGE_SIZE);
  if (total <= 1) { el.innerHTML = ''; return; }

  const pages = [];
  if (currentPage > 1)     pages.push({ label:'←', page: currentPage - 1 });
  for (let p = Math.max(1, currentPage-2); p <= Math.min(total, currentPage+2); p++) {
    pages.push({ label: String(p), page: p, active: p === currentPage });
  }
  if (currentPage < total) pages.push({ label:'→', page: currentPage + 1 });

  el.innerHTML = `
    <span style="font-size:0.8125rem; color:var(--text-muted);">
      ${(currentPage-1)*PAGE_SIZE+1}–${Math.min(currentPage*PAGE_SIZE, filteredLogs.length)} de ${filteredLogs.length}
    </span>
    ${pages.map(p => `
      <button class="btn ${p.active ? 'btn-primary' : 'btn-secondary'} btn-sm" data-page="${p.page}"
        style="min-width:36px; ${p.active ? '' : ''}">
        ${p.label}
      </button>
    `).join('')}
  `;

  el.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentPage = parseInt(btn.dataset.page);
      renderLogs();
      document.querySelector('.card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

/* ─── Events ─────────────────────────────────────────────── */
function _bindAuditEvents() {
  let timer;
  document.getElementById('audit-search')?.addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { searchTerm = e.target.value; applyLocalFilters(); }, 250);
  });
  document.getElementById('audit-filter-action')?.addEventListener('change', e => {
    filterAction = e.target.value; applyLocalFilters();
  });
  document.getElementById('audit-filter-user')?.addEventListener('change', e => {
    filterUser = e.target.value; applyLocalFilters();
  });
  document.getElementById('audit-filter-date-from')?.addEventListener('change', () => loadLogs());
  document.getElementById('audit-filter-date-to')?.addEventListener('change',   () => loadLogs());
  document.getElementById('audit-refresh-btn')?.addEventListener('click', () => loadLogs());
  document.getElementById('audit-export-btn')?.addEventListener('click', exportAuditCSV);
  document.getElementById('audit-clear-filters')?.addEventListener('click', () => {
    searchTerm = ''; filterAction = ''; filterUser = '';
    document.getElementById('audit-search').value = '';
    document.getElementById('audit-filter-action').value = '';
    document.getElementById('audit-filter-user').value = '';
    document.getElementById('audit-filter-date-from').value = '';
    document.getElementById('audit-filter-date-to').value = '';
    applyLocalFilters();
  });
}

/* ─── CSV Export ─────────────────────────────────────────── */
function exportAuditCSV() {
  const headers = ['Data/Hora','Ação','Descrição','Usuário','Email','Recurso','ID','Detalhes'];
  const rows = filteredLogs.map(log => {
    const ts  = log.timestamp?.toDate ? log.timestamp.toDate() : new Date(log.timestamp||0);
    const fmt = new Intl.DateTimeFormat('pt-BR',{
      day:'2-digit', month:'2-digit', year:'numeric',
      hour:'2-digit', minute:'2-digit', second:'2-digit',
    }).format(ts);
    return [
      fmt,
      log.action||'',
      ACTION_LABELS[log.action] || log.action || '',
      log.userName||'',
      log.userEmail||'',
      log.entityType||'',
      log.entityId||'',
      JSON.stringify(log.details||{}),
    ];
  });
  const csv = [headers, ...rows]
    .map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','))
    .join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a    = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `auditoria_${new Date().toISOString().slice(0,10)}.csv`,
  });
  a.click();
  toast.success(`${filteredLogs.length} registros exportados!`);
}
