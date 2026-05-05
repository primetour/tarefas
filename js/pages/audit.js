/**
 * PRIMETOUR — Audit Log Page (V2 — Robusta + Revert)
 * Visualização completa, filtragem avançada, detalhes expandíveis e reversão de ações
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import { fetchAuditLogs, ACTION_LABELS, REVERTIBLE_ACTIONS, auditLog } from '../auth/audit.js';
import { fetchUsers } from '../services/users.js';
import { createDoc, loadJsPdf, COL, txt, withExportGuard } from '../components/pdfKit.js';
import { renderPageSizePicker, wirePageSizePicker, getPageSize } from '../components/pageSize.js';
import { renderPickerButton, bindOptionPicker } from '../components/optionPicker.js';

const HASH_PALETTE = ['#6366F1','#8B5CF6','#EC4899','#F59E0B','#22C55E','#0EA5E9','#D4A843','#64748B','#10B981'];
const hashColor = (s) => {
  const str = String(s || '');
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return HASH_PALETTE[Math.abs(h) % HASH_PALETTE.length];
};
const findIn = (list, id) => list.find(o => o.id === id) || null;

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ─── State ──────────────────────────────────────────────── */
let allLogs        = [];
let filteredLogs   = [];
let searchTerm     = '';
let filterAction   = '';
let filterUser     = '';
let filterModule   = '';
let filterSeverity = '';
let currentPage    = 1;
// PAGE_SIZE é dinâmico: lido do localStorage (componente pageSize.js).
// User escolhe 10/20/50/100 e a preferência persiste entre sessões.
const _pgScope = 'audit';
const getCurrentPageSize = () => getPageSize(_pgScope);
const SERVER_PAGE  = 100;      // tamanho de cada batch buscado do Firestore
let lastDoc        = null;     // cursor server-side para "Carregar mais"
let hasMoreOnServer = false;   // sinaliza se ainda há registros não buscados
let isLoading      = false;
let isLoadingMore  = false;
let expandedLogId  = null;

/* ─── Module + Severity Mapping ──────────────────────────── */
const MODULE_MAP = {
  auth:            { label: 'Autenticação',     icon: '🔑', color: '#A78BFA' },
  users:           { label: 'Usuários',         icon: '👤', color: '#22C55E' },
  tasks:           { label: 'Tarefas',          icon: '✓',  color: '#38BDF8' },
  projects:        { label: 'Projetos',         icon: '📁', color: '#F59E0B' },
  workspaces:      { label: 'Squads',           icon: '◈',  color: '#D4A843' },
  csat:            { label: 'CSAT',             icon: '⭐', color: '#EC4899' },
  goals:           { label: 'Metas',            icon: '🎯', color: '#14B8A6' },
  feedback:        { label: 'Feedbacks',        icon: '💬', color: '#8B5CF6' },
  capacity:        { label: 'Capacidade',       icon: '📅', color: '#6366F1' },
  lp:              { label: 'Landing Pages',    icon: '🌐', color: '#0EA5E9' },
  arts:            { label: 'Artes',            icon: '🎨', color: '#F472B6' },
  news:            { label: 'Notícias',         icon: '📰', color: '#78716C' },
  clipping:        { label: 'Clipping',         icon: '✂',  color: '#A3A3A3' },
  portal:          { label: 'Portal Dicas',     icon: '💡', color: '#FBBF24' },
  portal_areas:    { label: 'Áreas do Portal',  icon: '◑', color: '#FB923C' },
  portal_images:   { label: 'Banco de Imagens', icon: '🖼', color: '#A855F7' },
  task_types:      { label: 'Tipos Tarefa',     icon: '⚙',  color: '#94A3B8' },
  roles:           { label: 'Perfis Acesso',    icon: '🛡',  color: '#F97316' },
  requests:        { label: 'Solicitações',     icon: '📩', color: '#06B6D4' },
  integrations:    { label: 'Integrações',      icon: '🔗', color: '#84CC16' },
  site_audits:     { label: 'Audit de Sites',   icon: '🔍', color: '#64748B' },
  settings:        { label: 'Configurações',    icon: '⚙',  color: '#94A3B8' },
  // Módulos antes caíam em "other" — agora com label próprio
  roteiro:         { label: 'Roteiros',         icon: '✈',  color: '#10B981' },
  content_calendar:{ label: 'Calendário Conteúdo', icon: '📱', color: '#F43F5E' },
  luxury_travel:   { label: 'Luxury Travel',    icon: '📖', color: '#9333EA' },
  agent:           { label: 'IA / Agentes',     icon: '✨', color: '#06B6D4' },
  insight:         { label: 'Insights',         icon: '💡', color: '#FBBF24' },
  brand:           { label: 'Marcas Monitoradas', icon: '◉', color: '#3B82F6' },
  vacation:        { label: 'Férias',           icon: '🏖', color: '#FDA4AF' },
  lgpd:            { label: 'LGPD',             icon: '⚖', color: '#EF4444' },
  branding:        { label: 'Branding',         icon: '🎨', color: '#EC4899' },
  // Eventos server-side (Cloud Functions)
  system:          { label: 'Sistema',          icon: '⚙', color: '#64748B' },
  security:        { label: 'Segurança',        icon: '🔒', color: '#DC2626' },
};

function getModule(action) {
  if (!action) return 'other';
  const prefix = action.split('.')[0];
  return MODULE_MAP[prefix] ? prefix : 'other';
}

function getModuleInfo(action) {
  return MODULE_MAP[getModule(action)] || { label: 'Outro', icon: '○', color: '#6B7280' };
}

function getSeverity(action) {
  if (!action) return 'info';
  if (action.includes('delete'))                      return 'critical';
  if (action.includes('deactivate'))                  return 'warning';
  if (action.includes('archive'))                     return 'warning';
  if (action.includes('remove_member'))               return 'warning';
  if (action.includes('demote'))                      return 'warning';
  if (action.includes('failed'))                      return 'critical';
  if (action.includes('create') || action.includes('login')) return 'success';
  if (action.includes('update') || action.includes('complete')) return 'info';
  return 'info';
}

const SEVERITY_CONFIG = {
  critical: { label: 'Crítico',    color: '#EF4444', bg: 'rgba(239,68,68,0.1)',  icon: '●' },
  warning:  { label: 'Atenção',    color: '#F59E0B', bg: 'rgba(245,158,11,0.1)', icon: '▲' },
  success:  { label: 'Normal',     color: '#22C55E', bg: 'rgba(34,197,94,0.1)',  icon: '✓' },
  info:     { label: 'Info',       color: '#38BDF8', bg: 'rgba(56,189,248,0.1)', icon: '○' },
};

/* ─── Render ─────────────────────────────────────────────── */
export async function renderAudit(container) {
  if (!store.can('system_manage_settings')) {
    container.innerHTML = `
      <div class="empty-state" style="min-height:60vh;">
        <div class="empty-state-icon">🔒</div>
        <div class="empty-state-title">Acesso restrito</div>
        <p class="text-sm text-muted">Somente administradores podem ver o log de auditoria.</p>
      </div>
    `;
    return;
  }

  // Build module options
  const moduleOptions = Object.entries(MODULE_MAP)
    .map(([key, m]) => `<option value="${key}">${m.icon} ${m.label}</option>`)
    .join('');

  // Build action options grouped by module
  const actionGroups = {};
  Object.entries(ACTION_LABELS).forEach(([action, label]) => {
    const mod = getModule(action);
    const modInfo = MODULE_MAP[mod] || { label: 'Outro' };
    if (!actionGroups[mod]) actionGroups[mod] = { label: modInfo.label, actions: [] };
    actionGroups[mod].actions.push({ value: action, label });
  });
  const actionOptions = Object.entries(actionGroups)
    .map(([, g]) => `
      <optgroup label="${g.label}">
        ${g.actions.map(a => `<option value="${a.value}">${a.label}</option>`).join('')}
      </optgroup>
    `).join('');

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Auditoria do Sistema</h1>
        <p class="page-subtitle" id="audit-count-label">Carregando registros...</p>
      </div>
      <div class="page-header-actions" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button class="btn btn-secondary btn-sm" id="audit-refresh-btn">↺ Atualizar</button>
        <!-- Split-button Export -->
        <div class="uikit-export-wrap" style="position:relative;display:inline-block;">
          <button class="btn btn-secondary uikit-export-trigger" data-export-trigger="1"
            style="display:flex;align-items:center;gap:6px;padding:6px 12px;">
            <span>↓</span><span>Exportar</span><span style="font-size:0.6em;">▾</span>
          </button>
          <div class="uikit-export-menu" style="display:none;position:absolute;top:100%;right:0;margin-top:4px;
            background:var(--bg-card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:8px;
            min-width:180px;box-shadow:0 4px 12px rgba(0,0,0,0.1);z-index:100;padding:4px;">
            <button class="uikit-export-item" id="audit-export-xls"
              style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 12px;
              background:transparent;border:none;cursor:pointer;font-size:0.875rem;color:var(--text-primary);
              border-radius:6px;font-family:inherit;">
              <span style="font-size:0.7em;color:var(--text-muted);">↓</span><span>Excel (.xlsx)</span>
            </button>
            <button class="uikit-export-item" id="audit-export-pdf"
              style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 12px;
              background:transparent;border:none;cursor:pointer;font-size:0.875rem;color:var(--text-primary);
              border-radius:6px;font-family:inherit;">
              <span style="font-size:0.7em;color:var(--text-muted);">↓</span><span>PDF</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Stats row -->
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin-bottom:20px;" id="audit-stats"></div>

    <!-- Module breakdown -->
    <div class="card" style="padding:16px;margin-bottom:16px;" id="audit-module-breakdown"></div>

    <!-- Filters -->
    <div class="toolbar" style="margin-bottom:16px;flex-wrap:wrap;gap:8px;">
      <div class="toolbar-search" style="min-width:220px;">
        <span class="toolbar-search-icon">🔍</span>
        <input type="text" class="toolbar-search-input" id="audit-search"
          placeholder="Buscar por usuário, ação, recurso, detalhe..." />
      </div>
      <div class="toolbar-filter-wrap" style="min-width:160px;">
        <select id="audit-filter-module" style="display:none;">
          <option value="">Todos os módulos</option>
          ${moduleOptions}
        </select>
        ${renderPickerButton({ btnId: 'audit-filter-module-btn', selected: null, emptyLabel: 'Todos os módulos' })}
      </div>
      <div class="toolbar-filter-wrap" style="min-width:180px;">
        <select id="audit-filter-action" style="display:none;">
          <option value="">Todas as ações</option>
          ${actionOptions}
        </select>
        ${renderPickerButton({ btnId: 'audit-filter-action-btn', selected: null, emptyLabel: 'Todas as ações' })}
      </div>
      <div class="toolbar-filter-wrap" style="min-width:140px;">
        <select id="audit-filter-severity" style="display:none;">
          <option value="">Severidade</option>
          <option value="critical">Crítico</option>
          <option value="warning">Atenção</option>
          <option value="success">Normal</option>
          <option value="info">Info</option>
        </select>
        ${renderPickerButton({ btnId: 'audit-filter-severity-btn', selected: null, emptyLabel: 'Severidade' })}
      </div>
      <div class="toolbar-filter-wrap" style="min-width:180px;">
        <select id="audit-filter-user" style="display:none;">
          <option value="">Todos os usuários</option>
          ${(store.get('users')||[]).map(u =>
            `<option value="${u.id}">${esc(u.name)}</option>`
          ).join('')}
        </select>
        ${renderPickerButton({ btnId: 'audit-filter-user-btn', selected: null, emptyLabel: 'Todos os usuários' })}
      </div>
      <input type="date" class="filter-select" id="audit-filter-date-from"
        style="padding:8px 12px;" title="Data de início" />
      <input type="date" class="filter-select" id="audit-filter-date-to"
        style="padding:8px 12px;" title="Data de término" />
      <button class="btn btn-ghost btn-sm" id="audit-clear-filters">✕ Limpar</button>
    </div>

    <!-- Log table -->
    <div class="card" style="overflow:hidden;">
      <div class="audit-log-header" style="grid-template-columns: 32px 130px 1fr 160px 120px 100px;">
        <div></div>
        <div>Data/Hora</div>
        <div>Ação</div>
        <div>Usuário</div>
        <div>Módulo</div>
        <div style="text-align:right;">Ações</div>
      </div>
      <div id="audit-log-body">
        <div class="task-empty">
          <div class="task-empty-icon">⟳</div>
          <div class="task-empty-title">Carregando registros...</div>
        </div>
      </div>
    </div>

    <!-- Pagination -->
    <div id="audit-pagination" style="display:flex; justify-content:center; align-items:center; gap:12px; margin-top:16px; padding:8px 0;"></div>
  `;

  // Pré-carrega lista de usuários (cache 5 min) para que o filtro "Todos os
  // usuários" tenha opções e para que resolveUserEmail() consiga fazer fallback
  // de email/nome em logs antigos sem userEmail gravado.
  // Sem await: render começa imediatamente, opções aparecem assim que chegar.
  fetchUsers().then(() => {
    const sel = document.getElementById('audit-filter-user');
    if (!sel || sel.options.length > 1) return; // já populado
    const users = store.get('users') || [];
    sel.innerHTML = '<option value="">Todos os usuários</option>'
      + users.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('');
    sel.dispatchEvent(new Event('picker-refresh'));
  }).catch(() => {});

  _bindAuditEvents();
  await loadLogs();
}

/* ─── Load logs ──────────────────────────────────────────── */
/**
 * Carrega registros do servidor.
 * @param {Object} opts
 * @param {boolean} opts.append - se true, anexa ao set existente (paginação server-side);
 *                                 se false, substitui (filtro mudou ou refresh).
 */
async function loadLogs({ append = false } = {}) {
  if (isLoading || isLoadingMore) return;
  if (append) isLoadingMore = true; else isLoading = true;

  const refreshBtn = document.getElementById('audit-refresh-btn');
  if (refreshBtn && !append) { refreshBtn.classList.add('loading'); refreshBtn.disabled = true; }

  try {
    const dateFrom = document.getElementById('audit-filter-date-from')?.value;
    const dateTo   = document.getElementById('audit-filter-date-to')?.value;

    const result = await fetchAuditLogs({
      pageSize:     SERVER_PAGE,
      lastDoc:      append ? lastDoc : null,
      // user/action ficam client-side dentro do fetchAuditLogs, mas passamos
      // pra que ele aumente o batch quando estão ativos (over-fetch agressivo).
      filterAction: filterAction || null,
      filterUser:   filterUser || null,
      filterModule: filterModule || null,
      filterSeverity: filterSeverity || null,
      startDate:    dateFrom ? new Date(dateFrom) : null,
      endDate:      dateTo ? new Date(dateTo + 'T23:59:59') : null,
    });

    const newLogs = result.logs || [];
    if (append) {
      allLogs = allLogs.concat(newLogs);
    } else {
      allLogs = newLogs;
      currentPage = 1;
    }
    lastDoc         = result.lastDoc || null;
    hasMoreOnServer = !!result.hasMore;

    applyLocalFilters();
    renderStats();
    renderModuleBreakdown();
  } catch(e) {
    console.error('Audit load error:', e);
    toast.error('Erro ao carregar logs: ' + e.message);
    const body = document.getElementById('audit-log-body');
    if (body && !append) body.innerHTML = `
      <div class="task-empty">
        <div class="task-empty-icon">⚠</div>
        <div class="task-empty-title">Erro ao carregar logs</div>
        <p class="text-sm text-muted mt-2">${esc(e.message)}</p>
      </div>`;
  } finally {
    isLoading = false;
    isLoadingMore = false;
    if (refreshBtn) { refreshBtn.classList.remove('loading'); refreshBtn.disabled = false; }
  }
}

/* ─── Local filter ───────────────────────────────────────── */
function applyLocalFilters() {
  let result = [...allLogs];

  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    result = result.filter(log =>
      log.userName?.toLowerCase().includes(q) ||
      log.userEmail?.toLowerCase().includes(q) ||
      log.action?.toLowerCase().includes(q) ||
      log.entityId?.toLowerCase().includes(q) ||
      log.entity?.toLowerCase().includes(q) ||
      (ACTION_LABELS[log.action]||'').toLowerCase().includes(q) ||
      JSON.stringify(log.details||{}).toLowerCase().includes(q)
    );
  }
  if (filterAction)   result = result.filter(l => l.action === filterAction);
  if (filterUser)     result = result.filter(l => l.userId === filterUser);
  if (filterModule)   result = result.filter(l => getModule(l.action) === filterModule);
  if (filterSeverity) result = result.filter(l => getSeverity(l.action) === filterSeverity);

  filteredLogs = result;
  currentPage  = 1;

  const label = document.getElementById('audit-count-label');
  if (label) {
    let txt = `${filteredLogs.length} registro${filteredLogs.length !== 1 ? 's' : ''}`;
    if (allLogs.length !== filteredLogs.length) txt += ` de ${allLogs.length} carregados`;
    if (hasMoreOnServer) txt += ` · há mais no servidor (use "Carregar mais")`;
    label.textContent = txt;
  }

  renderLogs();
}

/* ─── Render logs table ──────────────────────────────────── */
function renderLogs() {
  const body = document.getElementById('audit-log-body');
  if (!body) return;

  const PAGE_SIZE = getCurrentPageSize();
  const start = (currentPage - 1) * PAGE_SIZE;
  const page  = filteredLogs.slice(start, start + PAGE_SIZE);

  if (filteredLogs.length === 0) {
    body.innerHTML = `
      <div class="task-empty">
        <div class="task-empty-icon">📋</div>
        <div class="task-empty-title">Nenhum registro encontrado</div>
        <p class="text-sm text-muted mt-2">Ajuste os filtros ou o período de busca.</p>
      </div>`;
    renderPagination();
    return;
  }

  body.innerHTML = page.map(log => {
    const ts  = log.timestamp?.toDate ? log.timestamp.toDate() : (log.timestamp ? new Date(log.timestamp) : null);
    const fmt = ts ? new Intl.DateTimeFormat('pt-BR',{
      day:'2-digit', month:'2-digit', year:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit',
    }).format(ts) : '—';
    const relTime = ts ? getRelativeTime(ts) : '';

    const actionLabel = ACTION_LABELS[log.action] || log.action || '—';
    const modInfo     = getModuleInfo(log.action);
    const severity    = getSeverity(log.action);
    const sevCfg      = SEVERITY_CONFIG[severity];
    const isRevertible = REVERTIBLE_ACTIONS[log.action];
    const isExpanded   = expandedLogId === log.id;

    const userColor = (store.get('users')||[]).find(u=>u.id===log.userId)?.avatarColor || '#6B7280';
    const initials  = (log.userName||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
    const userEmail = resolveUserEmail(log);
    // Nome curto pra economizar espaço; email completo no title (tooltip)
    const nameShort = (log.userName || '—').length > 22
      ? (log.userName || '—').slice(0, 22) + '…'
      : (log.userName || '—');

    // Detail summary for the row
    const details = log.details || {};
    const detailSnippet = buildDetailSnippet(log);

    return `
      <div class="audit-log-row ${isExpanded ? 'audit-row-expanded' : ''}" data-log-id="${log.id}"
        style="cursor:pointer;grid-template-columns: 32px 130px 1fr 160px 120px 100px;
          ${severity === 'critical' ? 'border-left:3px solid '+sevCfg.color+';' : ''}">

        <!-- Severity dot -->
        <div style="display:flex;align-items:center;justify-content:center;">
          <span title="${sevCfg.label}" style="color:${sevCfg.color};font-size:0.625rem;">${sevCfg.icon}</span>
        </div>

        <!-- Timestamp -->
        <div style="font-size:0.75rem; color:var(--text-muted); font-variant-numeric:tabular-nums;">
          <div>${fmt}</div>
          <div style="font-size:0.625rem;opacity:0.7;margin-top:1px;">${relTime}</div>
        </div>

        <!-- Action -->
        <div style="min-width:0;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span class="audit-action-badge" style="background:${modInfo.color}18;color:${modInfo.color};border:1px solid ${modInfo.color}33;
              padding:2px 8px;border-radius:var(--radius-full);font-size:0.75rem;font-weight:500;white-space:nowrap;">
              ${esc(actionLabel)}
            </span>
            ${isRevertible ? `<span style="font-size:0.5625rem;padding:1px 5px;border-radius:var(--radius-full);
              background:rgba(212,168,67,0.12);color:var(--brand-gold);border:1px solid rgba(212,168,67,0.2);"
              title="Esta ação pode ser revertida">↩ reversível</span>` : ''}
          </div>
          ${detailSnippet ? `<div style="font-size:0.6875rem;color:var(--text-muted);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${detailSnippet}</div>` : ''}
        </div>

        <!-- User -->
        <div style="display:flex; align-items:center; gap:8px; overflow:hidden;"
             title="${esc(userEmail || log.userId || '')}">
          <div class="avatar" style="background:${userColor}; width:28px; height:28px; font-size:0.55rem; flex-shrink:0;">
            ${initials}
          </div>
          <div style="min-width:0;overflow:hidden;">
            <div style="font-size:0.8125rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-secondary); line-height:1.2;">
              ${esc(nameShort)}
            </div>
            <div style="font-size:0.6875rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.2;">
              ${userEmail ? esc(userEmail) : (log.userRole ? esc(log.userRole) : '<em style="opacity:0.5;">sem email</em>')}
            </div>
          </div>
        </div>

        <!-- Module -->
        <div>
          <span style="display:inline-flex;align-items:center;gap:4px;font-size:0.75rem;color:${modInfo.color};">
            <span>${modInfo.icon}</span>
            <span>${modInfo.label}</span>
          </span>
        </div>

        <!-- Actions -->
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:4px;" onclick="event.stopPropagation()">
          ${isRevertible ? `
            <button class="btn btn-ghost btn-icon btn-sm audit-revert-btn" data-log-id="${log.id}"
              title="${esc(isRevertible.label)}" style="color:var(--brand-gold);font-size:0.75rem;">
              ${isRevertible.icon}
            </button>` : ''}
          <button class="btn btn-ghost btn-icon btn-sm audit-expand-btn" data-log-id="${log.id}"
            title="Ver detalhes" style="font-size:0.75rem;transition:transform 0.2s;${isExpanded ? 'transform:rotate(180deg);' : ''}">
            ▼
          </button>
        </div>
      </div>

      <!-- Expanded detail panel -->
      ${isExpanded ? renderDetailPanel(log) : ''}
    `;
  }).join('');

  // Bind row events
  body.querySelectorAll('.audit-log-row[data-log-id]').forEach(row => {
    row.addEventListener('click', () => {
      const logId = row.dataset.logId;
      expandedLogId = expandedLogId === logId ? null : logId;
      renderLogs();
    });
  });

  body.querySelectorAll('.audit-revert-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleRevert(btn.dataset.logId);
    });
  });

  body.querySelectorAll('.audit-expand-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const logId = btn.dataset.logId;
      expandedLogId = expandedLogId === logId ? null : logId;
      renderLogs();
    });
  });

  renderPagination();
}

/* ─── Lookup helpers (resolvem ID -> nome humano) ────────── */
// Em logs antigos só temos entityId; tentamos resolver pra título atual
// usando o que já está em memória no store (sem hit no Firestore).
function resolveEntityLabel(log) {
  const d = log.details || {};
  // Prefere o que foi gravado no log (snapshot do momento)
  if (d.title) return d.title;
  if (d.name)  return d.name;
  if (!log.entityId) return '';

  const entity = log.entity || '';
  // Tarefa
  if (entity === 'task' || /^tasks?\./.test(log.action || '')) {
    const tasks = store.get('tasks') || [];
    const t = tasks.find(x => x.id === log.entityId);
    if (t?.title) return t.title;
  }
  // Projeto
  if (entity === 'project' || /^projects?\./.test(log.action || '')) {
    const projects = store.get('projects') || [];
    const p = projects.find(x => x.id === log.entityId);
    if (p?.name) return p.name;
  }
  // Squad / workspace
  if (entity === 'workspace' || /^workspaces?\./.test(log.action || '')) {
    const ws = store.get('workspaces') || [];
    const w = ws.find(x => x.id === log.entityId);
    if (w?.name) return w.name;
  }
  // Usuário
  if (entity === 'user' || /^users?\./.test(log.action || '')) {
    const users = store.get('users') || [];
    const u = users.find(x => x.id === log.entityId);
    if (u?.name) return u.name;
  }
  // Roteiro
  if (entity === 'roteiro' || /^roteiro\./.test(log.action || '')) {
    const r = (store.get('roteiros') || []).find(x => x.id === log.entityId);
    if (r?.title) return r.title;
  }
  return '';
}

// Email do usuário do log: prefere userEmail; fallback lookup no store.
// Importante pra logs antigos que foram criados antes do campo userEmail existir.
function resolveUserEmail(log) {
  if (log.userEmail) return log.userEmail;
  if (!log.userId) return '';
  const users = store.get('users') || [];
  const u = users.find(x => x.id === log.userId);
  return u?.email || '';
}

/* ─── Detail snippet (preview in row) ───────────────────── */
function buildDetailSnippet(log) {
  const d = log.details || {};
  const parts = [];

  // Resolve nome humano (tenta details → store → fallback ID)
  const label = resolveEntityLabel(log);
  if (label) parts.push(`"${label}"`);

  // Status change visível (ex: "rascunho → enviado")
  if (d.statusFrom && d.statusTo) {
    parts.push(`${d.statusFrom} → ${d.statusTo}`);
  } else if (d.status) {
    parts.push(`status: ${d.status}`);
  }

  // Campos alterados (tasks.update inclui list de fields)
  if (Array.isArray(d.fields) && d.fields.length) {
    const f = d.fields.filter(x => !['updatedAt','updatedBy'].includes(x)).slice(0, 4);
    if (f.length) parts.push(`alterou: ${f.join(', ')}`);
  }

  // Emails relevantes (CSAT, convites)
  if (d.clientEmail) parts.push(d.clientEmail);
  else if (d.email && d.email !== log.userEmail) parts.push(d.email);

  // Fallback: ID truncado quando nada faz sentido humano
  if (!parts.length && log.entityId) {
    parts.push(`${log.entity || 'recurso'}: ${String(log.entityId).slice(0,12)}…`);
  }

  return parts.length ? esc(parts.join(' · ').slice(0, 130)) : '';
}

/* ─── Expanded detail panel ─────────────────────────────── */
function renderDetailPanel(log) {
  const d = log.details || {};
  const ts = log.timestamp?.toDate ? log.timestamp.toDate() : new Date(log.timestamp||0);
  const severity = getSeverity(log.action);
  const sevCfg = SEVERITY_CONFIG[severity];
  const isRevertible = REVERTIBLE_ACTIONS[log.action];

  const detailRows = Object.entries(d)
    .filter(([k]) => !['_ts','userAgent'].includes(k))
    .map(([k, v]) => {
      const val = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
      return `
        <div style="display:grid;grid-template-columns:140px 1fr;gap:8px;padding:4px 0;border-bottom:1px solid var(--border-subtle);">
          <span style="font-size:0.75rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.03em;">${esc(k)}</span>
          <span style="font-size:0.8125rem;color:var(--text-primary);word-break:break-all;${typeof v === 'object' ? 'font-family:monospace;font-size:0.75rem;white-space:pre-wrap;' : ''}">${esc(val)}</span>
        </div>`;
    }).join('');

  return `
    <div class="audit-detail-panel" style="
      padding:16px 20px 16px 44px;
      background:var(--bg-surface);
      border-bottom:1px solid var(--border-subtle);
      animation:slideDown 0.15s ease-out;">

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:12px;">
        <!-- Left: metadata -->
        <div>
          <div style="font-size:0.6875rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">
            Informações do Registro
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            <div style="font-size:0.8125rem;"><strong>ID:</strong> <span style="font-family:monospace;font-size:0.75rem;color:var(--text-muted);">${esc(log.id)}</span></div>
            <div style="font-size:0.8125rem;"><strong>Ação:</strong> ${esc(log.action)}</div>
            <div style="font-size:0.8125rem;"><strong>Entidade:</strong> ${esc(log.entity || '—')} ${log.entityId ? `<span style="font-family:monospace;font-size:0.75rem;color:var(--text-muted);">${esc(log.entityId)}</span>` : ''}</div>
            <div style="font-size:0.8125rem;"><strong>Timestamp:</strong> ${ts.toLocaleString('pt-BR')}</div>
            <div style="font-size:0.8125rem;"><strong>Severidade:</strong>
              <span style="color:${sevCfg.color};font-weight:500;">${sevCfg.icon} ${sevCfg.label}</span>
            </div>
          </div>
        </div>

        <!-- Right: user info -->
        <div>
          <div style="font-size:0.6875rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">
            Usuário Responsável
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            <div style="font-size:0.8125rem;"><strong>Nome:</strong> ${esc(log.userName || '—')}</div>
            <div style="font-size:0.8125rem;"><strong>Email:</strong> ${
              resolveUserEmail(log)
                ? esc(resolveUserEmail(log))
                : '<em style="color:var(--text-muted);">não registrado</em>'
            }</div>
            <div style="font-size:0.8125rem;"><strong>Perfil:</strong> ${esc(log.userRole || '—')}</div>
            <div style="font-size:0.8125rem;"><strong>UID:</strong> <span style="font-family:monospace;font-size:0.75rem;color:var(--text-muted);">${esc(log.userId || '—')}</span></div>
          </div>
        </div>
      </div>

      <!-- Details -->
      ${Object.keys(d).length ? `
        <div style="margin-top:8px;">
          <div style="font-size:0.6875rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">
            Detalhes da Ação
          </div>
          <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:12px;">
            ${detailRows}
          </div>
        </div>
      ` : '<div style="font-size:0.8125rem;color:var(--text-muted);margin-top:8px;">Nenhum detalhe adicional registrado.</div>'}

      <!-- Revert action -->
      ${isRevertible ? `
        <div style="margin-top:16px;padding:12px;background:rgba(212,168,67,0.06);border:1px solid rgba(212,168,67,0.2);border-radius:var(--radius-md);">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div>
              <div style="font-size:0.8125rem;font-weight:600;color:var(--brand-gold);">↩ Ação reversível</div>
              <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
                ${esc(isRevertible.label)} — esta ação pode ser desfeita.
                ${isRevertible.note ? `<br><em>${esc(isRevertible.note)}</em>` : ''}
              </div>
            </div>
            <button class="btn btn-primary btn-sm audit-revert-btn" data-log-id="${log.id}"
              onclick="event.stopPropagation();"
              style="white-space:nowrap;">
              ${isRevertible.icon} ${esc(isRevertible.label)}
            </button>
          </div>
        </div>
      ` : ''}

      <!-- User agent -->
      ${log.userAgent ? `
        <div style="margin-top:8px;font-size:0.6875rem;color:var(--text-muted);opacity:0.6;">
          UA: ${esc(log.userAgent.slice(0,120))}
        </div>
      ` : ''}
    </div>
  `;
}

/* ─── Revert handler ─────────────────────────────────────── */
async function handleRevert(logId) {
  const log = allLogs.find(l => l.id === logId);
  if (!log) return;
  const revertInfo = REVERTIBLE_ACTIONS[log.action];
  if (!revertInfo) return;

  const confirmed = await modal.confirm({
    title: `Reverter: ${revertInfo.label}`,
    message: `
      <div style="margin-bottom:12px;">
        <strong>Ação original:</strong> ${esc(ACTION_LABELS[log.action] || log.action)}<br>
        <strong>Executada por:</strong> ${esc(log.userName)} em ${formatTimestamp(log.timestamp)}<br>
        ${log.entityId ? `<strong>ID do recurso:</strong> <code style="font-size:0.8rem;">${esc(log.entityId)}</code><br>` : ''}
        ${log.details?.name ? `<strong>Nome:</strong> ${esc(log.details.name)}<br>` : ''}
        ${log.details?.title ? `<strong>Título:</strong> ${esc(log.details.title)}<br>` : ''}
      </div>
      <div style="padding:10px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:var(--radius-md);font-size:0.8125rem;">
        ⚠ A ação <strong>"${esc(revertInfo.label)}"</strong> será executada.
        ${revertInfo.note ? `<br><em style="color:var(--text-muted);">${esc(revertInfo.note)}</em>` : ''}
      </div>
    `,
    confirmText: revertInfo.label,
    danger: false,
    icon: revertInfo.icon,
  });

  if (!confirmed) return;

  try {
    await executeRevert(log, revertInfo);
    toast.success(`Ação revertida: ${revertInfo.label}`);
    await loadLogs();
  } catch(e) {
    console.error('Revert failed:', e);
    toast.error('Falha ao reverter: ' + e.message);
  }
}

async function executeRevert(log, revertInfo) {
  const { doc, updateDoc, addDoc, collection, serverTimestamp, arrayUnion, arrayRemove } =
    await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  const { db } = await import('../firebase.js');

  const entityId = log.entityId;
  const details  = log.details || {};

  switch (log.action) {
    // ─── Tarefas ─────────────────────────────────────────
    case 'tasks.complete': {
      await updateDoc(doc(db, 'tasks', entityId), {
        status: 'in_progress',
        completedAt: null,
        completedBy: null,
        updatedAt: serverTimestamp(),
      });
      await auditLog('tasks.rework', 'task', entityId, { revertedFrom: log.id, reason: 'Revertido via auditoria' });
      break;
    }

    // ─── Projetos ────────────────────────────────────────
    case 'projects.archive': {
      await updateDoc(doc(db, 'projects', entityId), {
        archived: false,
        updatedAt: serverTimestamp(),
      });
      await auditLog('projects.unarchive', 'project', entityId, { revertedFrom: log.id });
      break;
    }

    // ─── Squads ──────────────────────────────────────────
    case 'workspaces.archive': {
      await updateDoc(doc(db, 'workspaces', entityId), {
        archived: false,
        updatedAt: serverTimestamp(),
      });
      await auditLog('workspaces.unarchive', 'workspace', entityId, { revertedFrom: log.id });
      break;
    }

    case 'workspaces.remove_member': {
      const uid = details.memberId || details.uid;
      if (!uid) throw new Error('UID do membro não encontrado nos detalhes do log.');
      await updateDoc(doc(db, 'workspaces', entityId), {
        members: arrayUnion(uid),
        updatedAt: serverTimestamp(),
      });
      await auditLog('workspaces.add_member', 'workspace', entityId, { memberId: uid, revertedFrom: log.id });
      break;
    }

    case 'workspaces.add_member': {
      const uid = details.memberId || details.uid;
      if (!uid) throw new Error('UID do membro não encontrado nos detalhes do log.');
      await updateDoc(doc(db, 'workspaces', entityId), {
        members: arrayRemove(uid),
        updatedAt: serverTimestamp(),
      });
      await auditLog('workspaces.remove_member', 'workspace', entityId, { memberId: uid, revertedFrom: log.id });
      break;
    }

    // ─── Usuários ────────────────────────────────────────
    case 'users.deactivate': {
      await updateDoc(doc(db, 'users', entityId), {
        active: true,
        updatedAt: serverTimestamp(),
      });
      await auditLog('users.reactivate', 'user', entityId, { revertedFrom: log.id });
      break;
    }

    case 'users.reactivate': {
      await updateDoc(doc(db, 'users', entityId), {
        active: false,
        updatedAt: serverTimestamp(),
      });
      await auditLog('users.deactivate', 'user', entityId, { revertedFrom: log.id });
      break;
    }

    // ─── CSAT ────────────────────────────────────────────
    case 'csat.cancel': {
      await updateDoc(doc(db, 'csat_surveys', entityId), {
        status: 'pending',
      });
      await auditLog('csat.reopen', 'survey', entityId, { revertedFrom: log.id });
      break;
    }

    default:
      throw new Error(`Reversão não implementada para: ${log.action}`);
  }
}

/* ─── Stats ──────────────────────────────────────────────── */
function renderStats() {
  const el = document.getElementById('audit-stats');
  if (!el || !allLogs.length) { if(el) el.innerHTML=''; return; }

  const today = new Date(); today.setHours(0,0,0,0);
  const todayLogs   = allLogs.filter(l => { const d=toDate(l.timestamp); return d>=today; });
  const criticals   = allLogs.filter(l => getSeverity(l.action) === 'critical');
  const revertibles = allLogs.filter(l => REVERTIBLE_ACTIONS[l.action]);
  const uniqueUsers = new Set(allLogs.map(l=>l.userId)).size;
  const authFails   = allLogs.filter(l => l.action?.includes('failed'));

  el.innerHTML = `
    ${statCard('Registros Hoje',      todayLogs.length,   '📅', 'rgba(56,189,248,0.12)', '#38BDF8')}
    ${statCard('Ações Críticas',      criticals.length,   '●',  'rgba(239,68,68,0.12)',  '#EF4444')}
    ${statCard('Reversíveis',         revertibles.length, '↩',  'rgba(212,168,67,0.12)', 'var(--brand-gold)')}
    ${statCard('Falhas de Auth',      authFails.length,   '⚠',  'rgba(245,158,11,0.12)', '#F59E0B')}
    ${statCard('Usuários Ativos',     uniqueUsers,        '◎',  'rgba(34,197,94,0.12)',  '#22C55E')}
    ${statCard('Total no Período',    allLogs.length,     '📋', 'rgba(148,163,184,0.12)','#94A3B8')}
  `;
}

function statCard(label, value, icon, ibg, ic) {
  return `<div class="stat-card">
    <div class="stat-card-icon" style="background:${ibg}; color:${ic};">${icon}</div>
    <div class="stat-card-label">${label}</div>
    <div class="stat-card-value">${value}</div>
  </div>`;
}

/* ─── Module breakdown ───────────────────────────────────── */
function renderModuleBreakdown() {
  const el = document.getElementById('audit-module-breakdown');
  if (!el || !allLogs.length) { if(el) el.style.display='none'; return; }
  el.style.display = 'block';

  const counts = {};
  allLogs.forEach(l => {
    const mod = getModule(l.action);
    counts[mod] = (counts[mod]||0) + 1;
  });

  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  const max = sorted[0]?.[1] || 1;

  el.innerHTML = `
    <div style="font-size:0.6875rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px;">
      Distribuição por Módulo
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;">
      ${sorted.map(([mod, count]) => {
        const m = MODULE_MAP[mod] || { label: mod, icon:'○', color:'#6B7280' };
        const pct = Math.round((count/max)*100);
        return `
          <div style="display:flex;align-items:center;gap:10px;cursor:pointer;" class="audit-module-bar" data-module="${mod}">
            <span style="width:24px;text-align:center;font-size:0.875rem;">${m.icon}</span>
            <span style="width:110px;font-size:0.8125rem;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${m.label}</span>
            <div style="flex:1;height:18px;background:var(--bg-elevated);border-radius:var(--radius-sm);overflow:hidden;">
              <div style="height:100%;width:${pct}%;background:${m.color}33;border-radius:var(--radius-sm);transition:width 0.3s;"></div>
            </div>
            <span style="width:40px;text-align:right;font-size:0.8125rem;font-weight:600;color:var(--text-primary);font-variant-numeric:tabular-nums;">${count}</span>
          </div>`;
      }).join('')}
    </div>
  `;

  // Click on bar to filter by module
  el.querySelectorAll('.audit-module-bar').forEach(bar => {
    bar.addEventListener('click', () => {
      const mod = bar.dataset.module;
      const sel = document.getElementById('audit-filter-module');
      if (sel) sel.value = filterModule === mod ? '' : mod;
      filterModule = filterModule === mod ? '' : mod;
      applyLocalFilters();
    });
  });
}

/* ─── Pagination ─────────────────────────────────────────── */
function renderPagination() {
  const el = document.getElementById('audit-pagination');
  if (!el) return;
  const PAGE_SIZE = getCurrentPageSize();
  const total = Math.ceil(filteredLogs.length / PAGE_SIZE);

  const loadMoreBtn = hasMoreOnServer
    ? `<button class="btn btn-secondary btn-sm" id="audit-load-more" ${isLoadingMore?'disabled':''}
         style="min-width:140px;${isLoadingMore?'opacity:.6;':''}">
         ${isLoadingMore ? '⟳ Carregando…' : `↓ Carregar mais ${SERVER_PAGE}`}
       </button>`
    : '';

  // Picker de itens por página (sempre visível, mesmo com 1 página)
  const sizePicker = renderPageSizePicker({ scope: _pgScope, label: 'Por página:' });

  if (total <= 1 && !loadMoreBtn && filteredLogs.length === 0) { el.innerHTML = ''; return; }

  const pages = [];
  if (total > 1) {
    if (currentPage > 1)     pages.push({ label:'←', page: currentPage - 1 });
    for (let p = Math.max(1, currentPage-2); p <= Math.min(total, currentPage+2); p++) {
      pages.push({ label: String(p), page: p, active: p === currentPage });
    }
    if (currentPage < total) pages.push({ label:'→', page: currentPage + 1 });
  }

  const rangeLabel = total >= 1
    ? `<span style="font-size:0.8125rem; color:var(--text-muted);">
         ${filteredLogs.length === 0 ? '0' : (currentPage-1)*PAGE_SIZE+1}–${Math.min(currentPage*PAGE_SIZE, filteredLogs.length)} de ${filteredLogs.length}
       </span>`
    : '';

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;flex:1;">
      ${sizePicker}
      <div style="display:flex;align-items:center;gap:8px;flex:1;justify-content:center;">
        ${rangeLabel}
        ${pages.map(p => `
          <button class="btn ${p.active ? 'btn-primary' : 'btn-secondary'} btn-sm" data-page="${p.page}"
            style="min-width:36px;">
            ${p.label}
          </button>
        `).join('')}
      </div>
      ${loadMoreBtn}
    </div>
  `;

  // Wire do dropdown de itens por página: ao mudar, volta pra página 1 e re-renderiza
  wirePageSizePicker(_pgScope, () => {
    currentPage = 1;
    renderLogs();
  });

  el.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentPage = parseInt(btn.dataset.page);
      renderLogs();
      document.querySelector('.audit-log-header')?.scrollIntoView({ behavior:'smooth', block:'start' });
    });
  });

  document.getElementById('audit-load-more')?.addEventListener('click', () => {
    loadLogs({ append: true });
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
    filterAction = e.target.value;
    // Filtro client-side puro (evita exigência de composite index no Firestore).
    // Se o usuário pediu uma ação específica e ela é rara, usamos loadLogs() pra
    // over-fetchar mais histórico — o fetchAuditLogs já cuida disso.
    if (filterAction) loadLogs(); else applyLocalFilters();
  });
  document.getElementById('audit-filter-user')?.addEventListener('change', e => {
    filterUser = e.target.value;
    // Mesmo raciocínio do filterAction. Esse era o caso que disparava o
    // FirebaseError: The query requires an index — agora roda 100% client-side.
    if (filterUser) loadLogs(); else applyLocalFilters();
  });
  document.getElementById('audit-filter-module')?.addEventListener('change', e => {
    filterModule = e.target.value; applyLocalFilters();
  });
  document.getElementById('audit-filter-severity')?.addEventListener('change', e => {
    filterSeverity = e.target.value; applyLocalFilters();
  });

  // Pickers visuais — leem opções do select escondido
  const fromSelect = (selectId, defaultIcon = '◈', defaultColor = '#6366F1') => {
    const sel = document.getElementById(selectId);
    if (!sel) return [];
    return [...sel.options].filter(o => o.value).map(o => ({
      id: o.value, label: o.textContent.trim(), icon: defaultIcon, color: hashColor(o.value) || defaultColor,
    }));
  };
  bindOptionPicker({
    btnId: 'audit-filter-module-btn',
    selectId: 'audit-filter-module',
    buildConfig: () => ({
      options: fromSelect('audit-filter-module', '◈'),
      empty: { id: '', label: 'Todos os módulos' },
      searchPlaceholder: 'Buscar módulo…',
    }),
    findSelected: (id) => findIn(fromSelect('audit-filter-module', '◈'), id),
    emptyLabel: 'Todos os módulos',
  });
  bindOptionPicker({
    btnId: 'audit-filter-action-btn',
    selectId: 'audit-filter-action',
    buildConfig: () => ({
      options: fromSelect('audit-filter-action', '◇'),
      empty: { id: '', label: 'Todas as ações' },
      searchPlaceholder: 'Buscar ação…',
    }),
    findSelected: (id) => findIn(fromSelect('audit-filter-action', '◇'), id),
    emptyLabel: 'Todas as ações',
  });
  const sevOpts = [
    { id: 'critical', label: 'Crítico', icon: '', color: '#EF4444' },
    { id: 'warning',  label: 'Atenção', icon: '', color: '#F59E0B' },
    { id: 'success',  label: 'Normal',  icon: '', color: '#22C55E' },
    { id: 'info',     label: 'Info',    icon: '', color: '#0EA5E9' },
  ];
  bindOptionPicker({
    btnId: 'audit-filter-severity-btn',
    selectId: 'audit-filter-severity',
    buildConfig: () => ({
      options: sevOpts,
      empty: { id: '', label: 'Severidade' },
      searchPlaceholder: 'Buscar severidade…',
    }),
    findSelected: (id) => findIn(sevOpts, id),
    emptyLabel: 'Severidade',
  });
  const auditUserOpts = () => (store.get('users') || []).map(u => ({
    id: u.id,
    label: u.name || u.email || 'Usuário',
    icon: (u.name || u.email || '?').trim().charAt(0).toUpperCase(),
    color: hashColor(u.id),
  }));
  bindOptionPicker({
    btnId: 'audit-filter-user-btn',
    selectId: 'audit-filter-user',
    buildConfig: () => ({
      options: auditUserOpts(),
      empty: { id: '', label: 'Todos os usuários' },
      searchPlaceholder: 'Buscar usuário…',
    }),
    findSelected: (id) => findIn(auditUserOpts(), id),
    emptyLabel: 'Todos os usuários',
  });
  document.getElementById('audit-filter-date-from')?.addEventListener('change', () => loadLogs());
  document.getElementById('audit-filter-date-to')?.addEventListener('change',   () => loadLogs());
  document.getElementById('audit-refresh-btn')?.addEventListener('click', () => loadLogs());
  document.getElementById('audit-export-xls')?.addEventListener('click', exportAuditXls);
  document.getElementById('audit-export-pdf')?.addEventListener('click', exportAuditPdf);
  import('../components/uiKit.js').then(m => m.wireUiKitMenus(document));
  document.getElementById('audit-clear-filters')?.addEventListener('click', () => {
    searchTerm = ''; filterAction = ''; filterUser = ''; filterModule = ''; filterSeverity = '';
    document.getElementById('audit-search').value = '';
    document.getElementById('audit-filter-action').value = '';
    document.getElementById('audit-filter-user').value = '';
    document.getElementById('audit-filter-module').value = '';
    document.getElementById('audit-filter-severity').value = '';
    document.getElementById('audit-filter-date-from').value = '';
    document.getElementById('audit-filter-date-to').value = '';
    loadLogs();
  });
}

/* ─── Helpers ────────────────────────────────────────────── */
function toDate(ts) {
  return ts?.toDate ? ts.toDate() : new Date(ts || 0);
}

function formatTimestamp(ts) {
  const d = toDate(ts);
  return d.toLocaleString('pt-BR');
}

function getRelativeTime(date) {
  const now  = new Date();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}min atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'ontem';
  if (days < 7) return `${days}d atrás`;
  return `${Math.floor(days/7)}sem atrás`;
}

/* ─── Export helpers ─────────────────────────────────────── */
function _auditRows() {
  return filteredLogs.map(log => {
    const ts  = toDate(log.timestamp);
    const fmt = new Intl.DateTimeFormat('pt-BR',{
      day:'2-digit', month:'2-digit', year:'numeric',
      hour:'2-digit', minute:'2-digit', second:'2-digit',
    }).format(ts);
    const modInfo = getModuleInfo(log.action);
    const severity = getSeverity(log.action);
    return [
      fmt,
      log.action||'',
      ACTION_LABELS[log.action] || log.action || '',
      modInfo.label,
      SEVERITY_CONFIG[severity]?.label || severity,
      log.userName||'',
      log.userEmail||'',
      log.entity||'',
      log.entityId||'',
      JSON.stringify(log.details||{}),
    ];
  });
}

async function exportAuditXls() {
  if (!filteredLogs.length) { toast.error('Nenhum registro.'); return; }
  if (!window.XLSX) await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload=res; s.onerror=rej; document.head.appendChild(s); });

  const headers = ['Data/Hora','Ação (código)','Descrição','Módulo','Severidade','Usuário','Email','Entidade','ID','Detalhes'];
  const wb = window.XLSX.utils.book_new();
  const ws = window.XLSX.utils.aoa_to_sheet([headers, ..._auditRows()]);
  ws['!cols'] = [18, 22, 28, 14, 10, 20, 25, 12, 20, 50].map(w=>({wch:w}));
  window.XLSX.utils.book_append_sheet(wb, ws, 'Auditoria');
  window.XLSX.writeFile(wb, `primetour_auditoria_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast.success(`${filteredLogs.length} registros exportados!`);
}

const exportAuditPdf = withExportGuard(async function exportAuditPdf() {
  if (!filteredLogs.length) { toast.error('Nenhum registro.'); return; }
  await loadJsPdf();

  const kit = createDoc({ orientation: 'portrait', margin: 14 });
  const { doc, W, M, CW, setFill, setText, setDraw, drawBar, drawChip, wrap } = kit;

  // Severidade → cor
  const SEV_COL = {
    critical: COL.red, high: COL.red,
    warning:  COL.orange, medium: COL.orange,
    info:     COL.blue, low: COL.blue,
    success:  COL.green,
  };

  // Agregações
  const bySeverity = {};
  const byModule = {};
  filteredLogs.forEach(log => {
    const sev = getSeverity(log.action);
    const mod = getModuleInfo(log.action).label;
    bySeverity[sev] = (bySeverity[sev] || 0) + 1;
    byModule[mod]   = (byModule[mod]   || 0) + 1;
  });

  // Período coberto
  const times = filteredLogs.map(l => toDate(l.timestamp)).filter(Boolean).sort((a,b)=>a-b);
  const periodo = times.length
    ? `${times[0].toLocaleDateString('pt-BR')} a ${times[times.length-1].toLocaleDateString('pt-BR')}`
    : '';

  kit.drawCover({
    title: 'Auditoria do Sistema',
    subtitle: 'PRIMETOUR  ·  Trilha de Atividades',
    meta: `${filteredLogs.length} ${filteredLogs.length === 1 ? 'evento' : 'eventos'}${periodo ? '  ·  ' + periodo : ''}`,
  });

  // Painel de severidade (blocos coloridos)
  const sevEntries = Object.entries(bySeverity).sort((a,b) => b[1] - a[1]).slice(0, 4);
  if (sevEntries.length) {
    const bw = (CW - 6) / sevEntries.length;
    sevEntries.forEach(([sev, n], i) => {
      const x = M + i * (bw + 2);
      const col = SEV_COL[sev] || COL.muted;
      setFill(COL.bg); doc.roundedRect(x, kit.y, bw, 18, 1.8, 1.8, 'F');
      setFill(col);    doc.rect(x, kit.y, bw, 1.6, 'F');
      setText(COL.text); doc.setFont('helvetica','bold'); doc.setFontSize(15);
      doc.text(String(n), x + 4, kit.y + 11);
      setText(col); doc.setFont('helvetica','bold'); doc.setFontSize(6.8);
      doc.text(txt((SEVERITY_CONFIG[sev]?.label || sev).toUpperCase()), x + 4, kit.y + 15.5);
    });
    kit.addY(22);
  }

  // Top módulos
  const modEntries = Object.entries(byModule).sort((a,b) => b[1] - a[1]).slice(0, 8);
  if (modEntries.length) {
    setText(COL.muted); doc.setFont('helvetica','bold'); doc.setFontSize(7);
    doc.text(txt('TOP MODULOS'), M, kit.y); kit.addY(4);
    const maxN = modEntries[0][1];
    modEntries.forEach(([mod, n]) => {
      setText(COL.text); doc.setFont('helvetica','normal'); doc.setFontSize(8);
      doc.text(txt(mod).slice(0, 28), M, kit.y);
      setText(COL.muted); doc.setFont('helvetica','bold'); doc.setFontSize(7.5);
      doc.text(String(n), W - M, kit.y, { align: 'right' });
      kit.addY(2);
      drawBar(M, kit.y, CW, Math.round(n * 100 / maxN), COL.brand2, 1.4);
      kit.addY(4.5);
    });
    kit.addY(4);
  }

  // Lista de eventos (timeline)
  setText(COL.brand); doc.setFont('helvetica','bold'); doc.setFontSize(11);
  doc.text(txt('Eventos recentes'), M, kit.y);
  kit.addY(2);
  setDraw(COL.gold); doc.setLineWidth(0.5); doc.line(M, kit.y, M + 20, kit.y);
  kit.addY(5);

  filteredLogs.slice(0, 200).forEach(log => {
    const ts = toDate(log.timestamp);
    const fmtDt = ts ? ts.toLocaleString('pt-BR', {
      day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit',
    }) : '—';
    const sev = getSeverity(log.action);
    const sevCol = SEV_COL[sev] || COL.muted;
    const modInfo = getModuleInfo(log.action);
    const desc = ACTION_LABELS[log.action] || log.action || '';

    const descLines = wrap(desc, CW - 55, 8.2);
    const rowH = Math.max(10, descLines.length * 3.5 + 5);
    kit.ensureSpace(rowH + 1);

    const top = kit.y;
    // Bolinha severity na margem
    setFill(sevCol); doc.circle(M + 1.5, top + 2, 1.2, 'F');

    // Linha 1: data + módulo chip
    setText(COL.muted); doc.setFont('helvetica','normal'); doc.setFontSize(6.8);
    doc.text(txt(fmtDt), M + 5, top + 2);
    setText(COL.brand2); doc.setFont('helvetica','bold'); doc.setFontSize(6.8);
    const dtW = doc.getTextWidth(txt(fmtDt)) + 3;
    doc.text(txt((modInfo.label || '').toUpperCase()).slice(0, 26), M + 5 + dtW, top + 2);

    // Linha 2: descrição
    setText(COL.text); doc.setFont('helvetica','normal'); doc.setFontSize(8.2);
    doc.text(descLines, M + 5, top + 6);
    kit.addY(rowH);

    // Linha 3 (opcional): usuário à direita
    if (log.userName || log.userEmail) {
      setText(COL.soft); doc.setFont('helvetica','italic'); doc.setFontSize(6.5);
      doc.text(txt([log.userName, log.userEmail].filter(Boolean).join('  ·  ')), W - M, top + 6, { align: 'right' });
    }

    // Divisória sutil
    setDraw(COL.border); doc.setLineWidth(0.1);
    doc.line(M + 5, kit.y - 0.8, W - M, kit.y - 0.8);
    kit.addY(1);
  });

  if (filteredLogs.length > 200) {
    kit.addY(3);
    setText(COL.muted); doc.setFont('helvetica','italic'); doc.setFontSize(7.5);
    doc.text(txt(`+ ${filteredLogs.length - 200} eventos adicionais (veja o XLS)`), M, kit.y);
  }

  kit.drawFooter('PRIMETOUR  ·  Auditoria');
  doc.save(`primetour_auditoria_${new Date().toISOString().slice(0,10)}.pdf`);
  toast.success('PDF exportado!');
});
