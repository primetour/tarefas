import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import {
  fetchTasks, subscribeToTasks, toggleTaskComplete, getTask, updateTask,
  bulkUpdateTasks,
  STATUSES, PRIORITIES, STATUS_MAP, PRIORITY_MAP, isTaskOverdue,
  TASK_TYPES, NEWSLETTER_STATUSES, NUCLEOS, REQUESTING_AREAS,
} from '../services/tasks.js';
import { fetchProjects } from '../services/projects.js';
import { openTaskModal, openTaskDoneOverlay } from '../components/taskModal.js';
import { APP_CONFIG }    from '../config.js';
import { openCardPrefsModal }  from '../components/cardPrefsModal.js';
import { createDoc, loadJsPdf, COL, STATUS_STYLE, txt, withExportGuard } from '../components/pdfKit.js';
import { wireUiKitMenus } from '../components/uiKit.js';
import { renderPickerButton, bindOptionPicker } from '../components/optionPicker.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* \u2500\u2500\u2500 State \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500*/
let allTasks     = [];
let allProjects  = [];
let pageTaskTypes = [];
let filteredTasks = [];
let unsubscribe  = null;
let _delegationAttached = false;
let groupBy      = 'dueDate';   // 'dueDate' | 'status' | 'priority' | 'project' | 'none'
let searchTerm   = '';
let filterStatus = '';
let filterPriority = '';
let filterProject  = '';
let filterAssignee = '';
let filterDatePreset = 'last30Days'; // default: mantém lista leve mesmo com milhares de tarefas históricas
                                     // '' | 'last30Days' | 'last90Days' | 'today' | 'tomorrow' | 'thisWeek' | 'nextWeek' | 'overdue' | 'thisMonth' | 'noDue' | 'custom'
let filterDateFrom = '';         // ISO YYYY-MM-DD (para custom)
let filterDateTo   = '';
let filterArea     = '';
let filterTag      = '';
let filterSquad    = '';   // workspaceId | '' (todos)
let filterMeta     = '';   // '' | 'with' | 'without' — vínculo com meta (metaLinks[] ou goalId legado)

// Filtros vindos via URL hash (tipicamente do Meu Painel) — não persistem
// na toolbar, mas são aplicados em applyFilters() junto com os demais.
// Reset ao usuário trocar manualmente os pickers da toolbar.
let filterObserver       = '';     // UID — quem é observer; típico cardstat "Observando"
let filterOpen           = false;  // !done && !cancelled — cardstat "Minhas Abertas"
let filterCompletedToday = false;  // done && completedAt é hoje — cardstat "Concluídas Hoje"
let filterPartnership    = false;  // task.isPartnership — cardstat "Parcerias"

// 4.13+ — Bulk select (Monday-style): IDs selecionados pra batch update.
// Action bar flutuante (bulkActionBar.js) aparece quando size > 0.
const _selectedTaskIds = new Set();
let   _bulkBar = null;

// Toggle "Mostrar arquivadas" — off por default. Quando ON, applyFilters()
// remove o `!t.archived` e mostra tarefas com archived:true (badge cinza).
// Útil pra auditoria de metas anuais/plurianuais (ver quais tarefas
// contribuíram). Aceita URL param ?archived=1 pra deep-link.
let filterShowArchived = false;

// Visibilidade de filtros (persistida no localStorage por usuário)
const FILTER_VISIBILITY_KEY = 'tasks.filterVisibility.v1';
const DEFAULT_FILTER_VISIBILITY = {
  status: true, priority: true, project: true, assignee: true,
  datePreset: true, squad: true, area: false, tag: false,
  meta: true,
};
let filterVisibility = { ...DEFAULT_FILTER_VISIBILITY };
function loadFilterVisibility() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_VISIBILITY_KEY) || '{}');
    filterVisibility = { ...DEFAULT_FILTER_VISIBILITY, ...saved };
  } catch (_) { filterVisibility = { ...DEFAULT_FILTER_VISIBILITY }; }
}
function saveFilterVisibility() {
  try { localStorage.setItem(FILTER_VISIBILITY_KEY, JSON.stringify(filterVisibility)); } catch (_) {}
}

/* \u2500\u2500\u2500 Render principal \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
export async function renderTasks(container) {
  loadFilterVisibility();

  // Lazy load: taskTypes saiu do boot (otimização free tier).
  // Garante carregamento aqui (idempotente — só carrega 1x na sessão).
  if (!(store.get('taskTypes') || []).length) {
    try {
      const { loadTaskTypes } = await import('../services/taskTypes.js');
      await loadTaskTypes();
    } catch {}
  }

  // Lê query params do hash (ex: #tasks?projectId=xxx) para pré-filtrar
  // Reset antes de aplicar query para evitar "lembrar" um filtro antigo de outra navegação
  let urlProjectId   = '';
  let urlWorkspaceId = '';
  let urlAssignee    = '';
  let urlObserver    = '';
  let urlStatus      = '';
  let urlOpen        = false;       // status != done && status != cancelled
  let urlCompletedToday = false;    // status==='done' && completedAt é hoje
  let urlPartnership = false;
  let urlArchived    = false;       // ?archived=1 ativa toggle "Mostrar arquivadas"
  try {
    const rawHash = window.location.hash || '';
    const qIdx = rawHash.indexOf('?');
    if (qIdx >= 0) {
      const qs = new URLSearchParams(rawHash.slice(qIdx + 1));
      urlProjectId   = qs.get('projectId')   || '';
      urlWorkspaceId = qs.get('workspaceId') || '';
      // "me" = currentUser; senão tratamos como UID
      const myUid = store.get('currentUser')?.uid || '';
      const a = qs.get('assignee') || '';
      const o = qs.get('observer') || '';
      urlAssignee = a === 'me' ? myUid : a;
      urlObserver = o === 'me' ? myUid : o;
      urlStatus   = qs.get('status') || '';
      urlOpen     = qs.get('open') === '1';
      urlCompletedToday = qs.get('completedToday') === '1';
      urlPartnership = qs.get('partnership') === '1';
      urlArchived    = qs.get('archived') === '1';
    }
  } catch (_) { /* noop */ }
  // CRÍTICO: URL = fonte da verdade absoluta na entrada da página.
  // Bug pré-3.7.1: `if (urlAssignee) filterAssignee = urlAssignee;` só
  // SOBRESCREVIA quando a URL trazia valor. Resultado: navegar de
  // `#tasks?assignee=me` → dashboard → click em "Tarefas da equipe"
  // (URL `#tasks` puro) mantinha filterAssignee='me' do click anterior.
  // Card mostrava 860 mas lista mostrava só MINHAS (ou ATRASADAS×ME=0
  // quando combinado com status='overdue' persistente). Fix: sempre
  // assignar valor da URL (vazio se ausente) — picker da página continua
  // funcionando porque ele só altera estado in-page (não re-roda este bloco).
  filterProject  = urlProjectId;
  filterSquad    = urlWorkspaceId;
  filterAssignee = urlAssignee || '';
  filterStatus   = urlStatus   || '';
  filterObserver       = urlObserver;
  filterOpen           = urlOpen;
  filterCompletedToday = urlCompletedToday;
  filterPartnership    = urlPartnership;
  filterShowArchived   = urlArchived;
  // Se URL traz qualquer filtro temporal específico (observado, concluídas hoje,
  // parceria), o preset de data padrão (Últimos 30 dias) deixa de fazer sentido —
  // o user clicou num KPI específico, quer ver TUDO daquela categoria.
  // Quando deep-link traz QUALQUER filtro próprio (assignee/observer/status/etc),
  // o preset default "Últimos 30 dias" deixa de fazer sentido — user clicou num
  // KPI específico, quer ver o conjunto completo daquela categoria.
  if (urlOpen || urlCompletedToday || urlPartnership || urlObserver
      || urlAssignee || urlStatus || urlProjectId || urlWorkspaceId) {
    filterDatePreset = '';
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Tarefas</h1>
        <p class="page-subtitle" id="tasks-count-label">Carregando...</p>
      </div>
      <div class="page-header-actions">
        <!-- Split-button Export consolida XLS/PDF -->
        <div class="uikit-export-wrap" style="position:relative;display:inline-block;">
          <button class="btn btn-secondary uikit-export-trigger" data-export-trigger="1"
            style="display:flex;align-items:center;gap:6px;padding:6px 12px;">
            <span>\u2193</span><span>Exportar</span><span style="font-size:0.6em;">\u25be</span>
          </button>
          <div class="uikit-export-menu" style="display:none;position:absolute;top:100%;right:0;margin-top:4px;
            background:var(--bg-card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:8px;
            min-width:180px;box-shadow:0 4px 12px rgba(0,0,0,0.1);z-index:100;padding:4px;">
            <button class="uikit-export-item" id="tasks-export-xls"
              style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 12px;
              background:transparent;border:none;cursor:pointer;font-size:0.875rem;color:var(--text-primary);
              border-radius:6px;font-family:inherit;">
              <span style="font-size:0.7em;color:var(--text-muted);">\u2193</span><span>Excel (.xlsx)</span>
            </button>
            <button class="uikit-export-item" id="tasks-export-pdf"
              style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 12px;
              background:transparent;border:none;cursor:pointer;font-size:0.875rem;color:var(--text-primary);
              border-radius:6px;font-family:inherit;">
              <span style="font-size:0.7em;color:var(--text-muted);">\u2193</span><span>PDF</span>
            </button>
          </div>
        </div>
        <!-- Overflow menu agrupa Importar / Email-task / Solicita\u00e7\u00e3o -->
        <div class="uikit-overflow-wrap" style="position:relative;display:inline-block;">
          <button class="btn btn-secondary uikit-overflow-trigger" data-overflow-trigger="1"
            title="Mais a\u00e7\u00f5es" style="padding:6px 10px;">\u22ee</button>
          <div class="uikit-overflow-menu" style="display:none;position:absolute;top:100%;right:0;margin-top:4px;
            background:var(--bg-card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:8px;
            min-width:220px;box-shadow:0 4px 12px rgba(0,0,0,0.1);z-index:100;padding:4px;">
            <button class="uikit-overflow-item" id="tasks-import-btn"
              style="display:block;width:100%;text-align:left;padding:8px 12px;background:transparent;
              border:none;cursor:pointer;font-size:0.875rem;color:var(--text-primary);border-radius:6px;
              font-family:inherit;">\u2191 Importar do Planner</button>
            <button class="uikit-overflow-item" id="email-task-btn"
              title="Criar tarefa a partir de email"
              style="display:block;width:100%;text-align:left;padding:8px 12px;background:transparent;
              border:none;cursor:pointer;font-size:0.875rem;color:var(--text-primary);border-radius:6px;
              font-family:inherit;">📧 Email → Tarefa</button>
            <a class="uikit-overflow-item" id="new-request-btn" href="solicitar.html" target="_blank" rel="noopener"
              title="Abrir portal de solicitações para pedir uma demanda a outro time"
              style="display:block;width:100%;text-align:left;padding:8px 12px;background:transparent;
              border:none;cursor:pointer;font-size:0.875rem;color:var(--text-primary);border-radius:6px;
              font-family:inherit;text-decoration:none;">📨 Solicitação externa</a>
          </div>
        </div>
        <button class="btn btn-primary" id="new-task-btn">+ Nova Tarefa</button>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="toolbar" style="margin-bottom:16px;flex-wrap:wrap;">
      <div class="toolbar-search">
        <span class="toolbar-search-icon">\ud83d\udd0d</span>
        <input type="text" class="toolbar-search-input" id="tasks-search"
          placeholder="Buscar tarefas..." />
      </div>
      <div class="toolbar-filter-wrap" style="${filterVisibility.status?'':'display:none;'}min-width:170px;">
        <select id="filter-status" style="display:none;">
          <option value="" ${filterStatus===''?'selected':''}>Todos os status</option>
          <option value="overdue" ${filterStatus==='overdue'?'selected':''}>⚠ Atrasada</option>
          ${STATUSES.map(s=>`<option value="${s.value}" ${filterStatus===s.value?'selected':''}>${s.label}</option>`).join('')}
        </select>
        ${(() => {
          // Pre-popula o botão com o estado vindo da URL (deep-link do Meu Painel)
          if (filterStatus === 'overdue') {
            return renderPickerButton({ btnId: 'filter-status-btn',
              selected: { id: 'overdue', label: '⚠ Atrasada', icon: '', color: '#EF4444' },
              emptyLabel: 'Todos os status' });
          }
          const s = STATUSES.find(x => x.value === filterStatus);
          return renderPickerButton({ btnId: 'filter-status-btn',
            selected: s ? { id: s.value, label: s.label, icon: '', color: s.color } : null,
            emptyLabel: 'Todos os status' });
        })()}
      </div>
      <div class="toolbar-filter-wrap" style="${filterVisibility.priority?'':'display:none;'}min-width:170px;">
        <select id="filter-priority" style="display:none;">
          <option value="" ${filterPriority===''?'selected':''}>Todas as prioridades</option>
          ${PRIORITIES.map(p=>`<option value="${p.value}" ${filterPriority===p.value?'selected':''}>${p.icon} ${p.label}</option>`).join('')}
        </select>
        ${(() => {
          const p = PRIORITIES.find(x => x.value === filterPriority);
          return renderPickerButton({ btnId: 'filter-priority-btn',
            selected: p ? { id: p.value, label: p.label, icon: p.icon, color: p.color } : null,
            emptyLabel: 'Todas as prioridades' });
        })()}
      </div>
      <select class="filter-select" id="filter-project" style="${filterVisibility.project?'':'display:none;'}">
        <option value="">Todos os projetos</option>
      </select>
      <div class="toolbar-filter-wrap" style="${filterVisibility.squad?'':'display:none;'}min-width:180px;">
        <select id="filter-squad" style="display:none;">
          <option value="">Todos os squads</option>
          <option value="__none__">— Sem squad</option>
          ${(store.get('userWorkspaces')||[]).map(ws => `
            <option value="${ws.id}">${esc(ws.icon || '◈')} ${esc(ws.name)}${ws.multiSector ? ' (multissetor)' : ''}</option>
          `).join('')}
        </select>
        ${renderPickerButton({ btnId: 'filter-squad-btn', selected: null, emptyLabel: 'Todos os squads' })}
      </div>
      <div class="toolbar-filter-wrap" style="${filterVisibility.assignee?'':'display:none;'}min-width:180px;">
        <select id="filter-assignee" style="display:none;">
          <option value="" ${filterAssignee===''?'selected':''}>Todos os respons\u00e1veis</option>
          ${(store.get('users')||[]).filter(u=>u.active).map(u=>`
            <option value="${u.id}" ${filterAssignee===u.id?'selected':''}>${esc(u.name)}</option>
          `).join('')}
        </select>
        ${(() => {
          const u = (store.get('users')||[]).find(x => x.id === filterAssignee);
          return renderPickerButton({ btnId: 'filter-assignee-btn',
            selected: u ? { id: u.id, label: u.name, icon: (u.name||'?').charAt(0).toUpperCase(), color: '#6366F1' } : null,
            emptyLabel: 'Todos os respons\u00e1veis' });
        })()}
      </div>
      <select class="filter-select" id="filter-date-preset" style="${filterVisibility.datePreset?'':'display:none;'}">
        <option value=""            ${filterDatePreset===''?'selected':''}>Qualquer prazo</option>
        <option value="last30Days"  ${filterDatePreset==='last30Days'?'selected':''}>Últimos 30 dias (padrão)</option>
        <option value="last90Days"  ${filterDatePreset==='last90Days'?'selected':''}>Últimos 90 dias</option>
        <option value="overdue"     ${filterDatePreset==='overdue'?'selected':''}>⚠ Atrasadas</option>
        <option value="today"       ${filterDatePreset==='today'?'selected':''}>Hoje</option>
        <option value="tomorrow"    ${filterDatePreset==='tomorrow'?'selected':''}>Amanhã</option>
        <option value="thisWeek"    ${filterDatePreset==='thisWeek'?'selected':''}>Esta semana</option>
        <option value="nextWeek"    ${filterDatePreset==='nextWeek'?'selected':''}>Próxima semana</option>
        <option value="thisMonth"   ${filterDatePreset==='thisMonth'?'selected':''}>Este mês</option>
        <option value="noDue"       ${filterDatePreset==='noDue'?'selected':''}>Sem prazo</option>
        <option value="custom"      ${filterDatePreset==='custom'?'selected':''}>Período customizado…</option>
      </select>
      <div class="toolbar-filter-wrap" style="${filterVisibility.area?'':'display:none;'}min-width:160px;">
        <select id="filter-area" style="display:none;">
          <option value="">Todas as áreas</option>
          ${REQUESTING_AREAS.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('')}
        </select>
        ${renderPickerButton({ btnId: 'filter-area-btn', selected: null, emptyLabel: 'Todas as áreas' })}
      </div>
      <select class="filter-select" id="filter-tag" style="${filterVisibility.tag?'':'display:none;'}">
        <option value="">Todas as tags</option>
      </select>
      <select class="filter-select" id="filter-meta" style="${filterVisibility.meta?'':'display:none;'}"
        title="Filtrar por vínculo com Meta">
        <option value=""        ${filterMeta===''       ?'selected':''}>Todas (c/ ou s/ meta)</option>
        <option value="with"    ${filterMeta==='with'   ?'selected':''}>🎯 Com meta vinculada</option>
        <option value="without" ${filterMeta==='without'?'selected':''}>○ Sem meta vinculada</option>
      </select>
      <label id="filter-archived-wrap" title="Tarefas auto-arquivadas após 730 dias de conclusão"
        style="display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--border,#e5e7eb);
               border-radius:8px;font-size:0.8125rem;color:var(--text-secondary);cursor:pointer;
               background:${filterShowArchived ? 'var(--brand-gold-bg,rgba(212,168,67,.12))' : 'transparent'};">
        <input type="checkbox" id="filter-archived" ${filterShowArchived?'checked':''}
          style="margin:0;cursor:pointer;">
        <span>📦 Mostrar arquivadas</span>
      </label>
      <div style="margin-left:auto; display:flex; align-items:center; gap:8px;">
        <label style="font-size:0.8125rem; color:var(--text-muted);">Agrupar:</label>
        <select class="filter-select" id="group-by">
          <option value="dueDate">Por prazo</option>
          <option value="status">Por status</option>
          <option value="priority">Por prioridade</option>
          <option value="project">Por projeto</option>
          <option value="squad">Por squad</option>
          <option value="none">Sem agrupamento</option>
        </select>
        <button class="btn btn-ghost btn-sm" id="filter-config-btn" title="Configurar filtros visíveis"
          style="padding:6px 10px;">⚙</button>
        <button class="btn btn-ghost btn-sm" id="tasks-card-prefs-btn" title="Personalizar campos dos cards"
          style="padding:6px 10px;font-size:0.9rem;">🎛</button>
      </div>
    </div>
    <div id="filter-date-custom" style="display:none;margin-bottom:12px;gap:8px;align-items:center;">
      <label style="font-size:0.8125rem;color:var(--text-muted);">De:</label>
      <input type="date" id="filter-date-from" class="form-input" style="width:150px;" />
      <label style="font-size:0.8125rem;color:var(--text-muted);">Até:</label>
      <input type="date" id="filter-date-to" class="form-input" style="width:150px;" />
      <button class="btn btn-ghost btn-sm" id="filter-date-clear">Limpar</button>
    </div>

    <!-- Banner: auto-reparo de tarefas Planner sem projeto (para admin/manager) -->
    <div id="tasks-orphans-banner" style="display:none;margin-bottom:12px;"></div>

    <!-- Task list container -->
    <div id="tasks-container">
      <div class="task-empty">
        <div class="task-empty-icon">\u27f3</div>
        <div class="task-empty-title">Carregando tarefas...</div>
      </div>
    </div>
  `;

  // Load users if store is empty (ex: primeiro acesso, aba privativa, refresh em /tasks)
  // Sem isso, os avatares de responsáveis aparecem vazios nos cards.
  if (!(store.get('users') || []).length) {
    try {
      const { fetchUsers } = await import('../services/users.js');
      await fetchUsers();
      // Re-popula o filtro de responsáveis agora que users chegaram
      const assigneeSel = document.getElementById('filter-assignee');
      if (assigneeSel) {
        const cur = assigneeSel.value;
        assigneeSel.innerHTML = '<option value="">Todos os responsáveis</option>' +
          (store.get('users') || []).filter(u => u.active).map(u =>
            `<option value="${u.id}">${esc(u.name)}</option>`).join('');
        if (cur) assigneeSel.value = cur;
        // Sincroniza visual do picker com a nova lista de opções
        assigneeSel.dispatchEvent(new Event('picker-refresh'));
      }
    } catch (e) { console.warn('[tasks] users load:', e?.message || e); }
  }

  // Load projects for filter
  try {
    allProjects = await fetchProjects();
    const projFilter = document.getElementById('filter-project');
    if (projFilter) {
      allProjects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.icon} ${p.name}`;
        projFilter.appendChild(opt);
      });
      // Se chegou com ?projectId=xxx, seleciona no filtro e garante visível
      if (filterProject) {
        projFilter.value = filterProject;
        projFilter.style.display = '';
        filterVisibility.project = true;
      }
    }
  } catch (e) { console.warn('Projects fetch:', e); }

  // Pré-seleciona squad se chegou via ?workspaceId=xxx
  if (filterSquad) {
    const squadFilter = document.getElementById('filter-squad');
    if (squadFilter) {
      squadFilter.value = filterSquad;
      // O select agora vive escondido dentro de um wrapper; mostra o wrapper.
      const wrap = squadFilter.closest('.toolbar-filter-wrap');
      if (wrap) wrap.style.display = '';
      filterVisibility.squad = true;
    }
  }

  // Load task types for renderTaskRow custom fields
  try {
    const { fetchTaskTypes } = await import('../services/taskTypes.js');
    pageTaskTypes = await fetchTaskTypes();
  } catch (e) { pageTaskTypes = []; }

  // Lazy: gerar instâncias de tarefas recorrentes pendentes (background)
  import('../services/recurringTasks.js')
    .then(({ runDueRecurrenceGeneration }) => runDueRecurrenceGeneration())
    .then(report => {
      if (report?.created > 0) {
        toast.success(`${report.created} tarefa${report.created > 1 ? 's' : ''} recorrente${report.created > 1 ? 's' : ''} gerada${report.created > 1 ? 's' : ''}.`);
      }
    })
    .catch(e => console.warn('[tasks] recurrence generation:', e?.message || e));

  _attachPageEvents();
  _subscribeToTasks();
}

/* \u2500\u2500\u2500 Real-time subscription \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
function _subscribeToTasks() {
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribeToTasks((tasks) => {
    allTasks = tasks;
    _populateTagFilter();
    applyFilters();
    renderPlannerOrphansBanner();
  });
}

/* ─── Auto-reparo: tarefas do Planner sem projectId ─────────────────
 * Detecta tarefas que vieram do Planner (customFields.plannerId OU
 * tag 'planner-import' como fallback) e estão sem projeto atribuído.
 * Mostra um banner acima da lista com CTA "Atribuir projetos" que
 * abre um modal com uma linha por tarefa (cada tarefa recebe seu
 * projeto individualmente, já que pertencem a projetos diferentes).
 * Fica visível apenas para quem pode criar/gerenciar tarefas. */

/** Detecta quais tarefas são órfãs do Planner (sem projeto). */
function getPlannerOrphans() {
  return (allTasks || []).filter(t => {
    if (t.archived) return false;
    if (t.projectId) return false;
    const fromPlanner =
      (t.customFields && t.customFields.plannerId) ||
      (Array.isArray(t.tags) && t.tags.includes('planner-import'));
    return !!fromPlanner;
  });
}

/** Normaliza string p/ matching fuzzy (sem acento, lower, trim). */
function _norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
}

/** Sugere projectId baseado em bucket/tags da tarefa vs. projetos ativos. */
function suggestProjectForOrphan(task, projects) {
  const hints = [];
  const bucket = task?.customFields?.plannerBucket;
  if (bucket) hints.push(_norm(bucket));
  (task.tags || []).forEach(t => {
    if (t && t !== 'planner-import') hints.push(_norm(t));
  });
  if (!hints.length) return '';

  for (const p of projects) {
    const pn = _norm(p.name);
    if (!pn) continue;
    for (const h of hints) {
      if (!h) continue;
      if (pn === h || pn.includes(h) || h.includes(pn)) return p.id;
    }
  }
  return '';
}

function renderPlannerOrphansBanner() {
  const banner = document.getElementById('tasks-orphans-banner');
  if (!banner) return;

  // 4.15.1: era `projects_manage` (não existe no catálogo PERMISSION_CATALOG).
  // Trocado pra `project_edit` (existe e é semanticamente o mesmo —
  // quem edita projetos pode atribuir/remover tarefas).
  const canRepair = store.isMaster()
    || store.can('system_manage_roles')
    || store.can('project_edit')
    || store.can('task_create');
  if (!canRepair) { banner.style.display = 'none'; return; }

  const orphans = getPlannerOrphans();
  if (!orphans.length) { banner.style.display = 'none'; banner.innerHTML = ''; return; }

  banner.style.display = 'block';
  banner.innerHTML = `
    <div style="padding:12px 16px;border-radius:10px;
      background:linear-gradient(135deg, rgba(59,130,246,0.08), rgba(168,85,247,0.08));
      border:1px solid rgba(59,130,246,0.35);
      display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
      <div style="flex:1;min-width:260px;">
        <div style="font-weight:700;color:#3B82F6;margin-bottom:3px;">
          🩹 ${orphans.length} tarefa(s) do Planner sem projeto
        </div>
        <div style="font-size:0.8125rem;color:var(--text-muted);line-height:1.4;">
          Cada tarefa pode pertencer a um projeto diferente. Abra o painel de atribuição
          para definir o projeto <strong>individualmente</strong> (com sugestões automáticas pelo bucket/tags).
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button type="button" id="tasks-orphans-open" class="btn btn-primary btn-sm"
          style="white-space:nowrap;">Atribuir projetos…</button>
        <button type="button" id="tasks-orphans-dismiss" class="btn btn-ghost btn-sm"
          title="Ocultar até próxima recarga">✕</button>
      </div>
    </div>
  `;

  banner.querySelector('#tasks-orphans-dismiss')
    ?.addEventListener('click', () => { banner.style.display = 'none'; });
  banner.querySelector('#tasks-orphans-open')
    ?.addEventListener('click', () => openPlannerOrphansModal());
}

/** Abre modal com uma linha por tarefa órfã, cada uma com seu próprio dropdown. */
function openPlannerOrphansModal() {
  const orphans = getPlannerOrphans();
  if (!orphans.length) {
    toast.info('Nenhuma tarefa do Planner sem projeto no momento.');
    return;
  }
  const projects = allProjects
    .filter(p => !p.archived && p.status !== 'archived')
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));

  if (!projects.length) {
    toast.warning('Nenhum projeto ativo cadastrado. Crie um projeto antes de atribuir.');
    return;
  }

  const users = store.get('users') || [];

  // Estado: tarefa.id → projectId selecionado (inicial = sugestão automática)
  const selection = new Map();
  const suggested = new Map();
  orphans.forEach(t => {
    const sug = suggestProjectForOrphan(t, projects);
    suggested.set(t.id, sug);
    selection.set(t.id, sug);
  });

  const projectOptions = projects
    .map(p => `<option value="${esc(p.id)}">${esc(p.icon || '📦')} ${esc(p.name)}</option>`)
    .join('');

  const rowHtml = (t) => {
    const sugId   = suggested.get(t.id) || '';
    const curId   = selection.get(t.id) || '';
    const bucket  = t?.customFields?.plannerBucket || '';
    const tagsArr = (t.tags || []).filter(x => x && x !== 'planner-import');
    const assigneesArr = Array.isArray(t.assignees)
      ? t.assignees
      : (typeof t.assignees === 'string' && t.assignees ? [t.assignees] : []);
    const assignees = assigneesArr.slice(0, 3).map(uid => {
      const u = users.find(u => u.id === uid);
      if (!u) return '';
      const initial = (u.name || '?').charAt(0).toUpperCase();
      return `<span title="${esc(u.name)}"
        style="display:inline-flex;align-items:center;justify-content:center;
          width:22px;height:22px;border-radius:50%;
          background:${u.avatarColor || '#3B82F6'};color:#fff;font-size:0.7rem;
          font-weight:700;margin-left:-4px;border:2px solid var(--bg-card);">${esc(initial)}</span>`;
    }).join('');
    const extra = assigneesArr.length > 3
      ? `<span style="font-size:0.7rem;color:var(--text-muted);margin-left:4px;">+${assigneesArr.length - 3}</span>`
      : '';

    const hints = [
      bucket ? `<span style="background:var(--bg-subtle);padding:2px 8px;border-radius:99px;font-size:0.7rem;color:var(--text-muted);">📁 ${esc(bucket)}</span>` : '',
      ...tagsArr.slice(0, 3).map(tag =>
        `<span style="background:var(--bg-subtle);padding:2px 8px;border-radius:99px;font-size:0.7rem;color:var(--text-muted);">#${esc(tag)}</span>`),
    ].filter(Boolean).join(' ');

    return `
      <tr data-task-id="${esc(t.id)}" style="border-top:1px solid var(--border-subtle);">
        <td style="padding:10px 12px;vertical-align:top;">
          <div style="font-weight:600;font-size:0.875rem;margin-bottom:4px;line-height:1.3;">
            ${esc(t.title || '(sem título)')}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;">
            ${hints || '<span style="font-size:0.7rem;color:var(--text-muted);font-style:italic;">sem bucket/tags</span>'}
          </div>
        </td>
        <td style="padding:10px 12px;vertical-align:top;white-space:nowrap;">
          <div style="display:flex;align-items:center;">
            ${assignees || '<span style="font-size:0.75rem;color:var(--text-muted);">—</span>'}${extra}
          </div>
        </td>
        <td style="padding:10px 12px;vertical-align:top;min-width:240px;">
          <select class="form-select orphan-project-select" data-task-id="${esc(t.id)}"
            style="font-size:0.8125rem;padding:8px 32px 8px 12px;width:100%;">
            <option value="">— Escolher projeto —</option>
            ${projectOptions}
          </select>
          ${sugId ? `
            <div style="font-size:0.7rem;color:#3B82F6;margin-top:4px;display:flex;align-items:center;gap:4px;">
              ✨ Sugerido pelo bucket/tag
            </div>` : ''}
        </td>
      </tr>
    `;
  };

  const suggestedCount = [...suggested.values()].filter(Boolean).length;

  const content = `
    <div style="display:flex;flex-direction:column;gap:14px;min-height:0;">
      <div style="padding:10px 14px;border-radius:8px;background:var(--bg-subtle);
        font-size:0.8125rem;color:var(--text-muted);line-height:1.5;">
        <strong style="color:var(--text-default);">${orphans.length}</strong> tarefa(s) sem projeto.
        <strong style="color:#3B82F6;">${suggestedCount}</strong> já têm sugestão automática pelo bucket/tags.
        Revise linha por linha e salve quando estiver pronto.
      </div>

      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;
        padding:10px 12px;border-radius:8px;border:1px dashed var(--border-default);">
        <span style="font-size:0.8125rem;color:var(--text-muted);">Atalho:</span>
        <select id="orphans-bulk-project" class="form-select"
          style="font-size:0.8125rem;padding:8px 32px 8px 12px;min-width:220px;">
          <option value="">— projeto —</option>
          ${projectOptions}
        </select>
        <button type="button" id="orphans-bulk-apply-all" class="btn btn-secondary btn-sm"
          style="font-size:0.8125rem;">Aplicar a todas</button>
        <button type="button" id="orphans-bulk-apply-empty" class="btn btn-secondary btn-sm"
          style="font-size:0.8125rem;">Aplicar apenas às vazias</button>
        <button type="button" id="orphans-restore-suggested" class="btn btn-ghost btn-sm"
          style="font-size:0.8125rem;">↺ Restaurar sugestões</button>
      </div>

      <div style="overflow:auto;max-height:55vh;border:1px solid var(--border-subtle);
        border-radius:8px;">
        <table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
          <thead style="position:sticky;top:0;background:var(--bg-card);z-index:1;">
            <tr style="border-bottom:1px solid var(--border-default);">
              <th style="text-align:left;padding:10px 12px;font-size:0.75rem;
                text-transform:uppercase;letter-spacing:0.03em;color:var(--text-muted);">Tarefa</th>
              <th style="text-align:left;padding:10px 12px;font-size:0.75rem;
                text-transform:uppercase;letter-spacing:0.03em;color:var(--text-muted);width:90px;">Equipe</th>
              <th style="text-align:left;padding:10px 12px;font-size:0.75rem;
                text-transform:uppercase;letter-spacing:0.03em;color:var(--text-muted);">Projeto</th>
            </tr>
          </thead>
          <tbody id="orphans-tbody">
            ${orphans.map(rowHtml).join('')}
          </tbody>
        </table>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;
        padding-top:12px;border-top:1px solid var(--border-subtle);">
        <span id="orphans-pending-count" style="font-size:0.8125rem;color:var(--text-muted);"></span>
        <div style="display:flex;gap:8px;">
          <button type="button" id="orphans-cancel" class="btn btn-ghost">Cancelar</button>
          <button type="button" id="orphans-save" class="btn btn-primary" disabled>Salvar alterações</button>
        </div>
      </div>
    </div>
  `;

  const m = modal.open({
    size: 'lg',
    title: '🩹 Atribuir projetos — tarefas do Planner',
    content,
    closeable: true,
  });

  const body = m.getBody();

  const updateFooter = () => {
    let pending = 0, changed = 0;
    orphans.forEach(t => {
      const val = selection.get(t.id) || '';
      if (val) changed++; else pending++;
    });
    const pendingEl = body.parentElement?.querySelector('#orphans-pending-count')
      || document.getElementById('orphans-pending-count');
    if (pendingEl) {
      pendingEl.textContent = changed
        ? `${changed} pronto(s) para salvar · ${pending} sem projeto`
        : `Nenhum projeto selecionado ainda`;
    }
    const saveBtn = document.getElementById('orphans-save');
    if (saveBtn) {
      saveBtn.disabled = changed === 0;
      saveBtn.textContent = changed
        ? `Salvar ${changed} atribuição(ões)`
        : 'Salvar alterações';
    }
  };

  // Aplica selections iniciais nos <select>
  body.querySelectorAll('.orphan-project-select').forEach(sel => {
    const id = sel.getAttribute('data-task-id');
    const cur = selection.get(id) || '';
    if (cur) sel.value = cur;
  });

  body.addEventListener('change', (ev) => {
    const sel = ev.target.closest('.orphan-project-select');
    if (!sel) return;
    selection.set(sel.getAttribute('data-task-id'), sel.value || '');
    updateFooter();
  });

  const applyBulk = (mode) => {
    const bulkSel = document.getElementById('orphans-bulk-project');
    const pid = bulkSel?.value || '';
    if (!pid) { toast.warning('Escolha um projeto no atalho primeiro.'); return; }
    body.querySelectorAll('.orphan-project-select').forEach(sel => {
      const id = sel.getAttribute('data-task-id');
      const cur = selection.get(id) || '';
      if (mode === 'empty' && cur) return;
      selection.set(id, pid);
      sel.value = pid;
    });
    updateFooter();
  };

  document.getElementById('orphans-bulk-apply-all')
    ?.addEventListener('click', () => applyBulk('all'));
  document.getElementById('orphans-bulk-apply-empty')
    ?.addEventListener('click', () => applyBulk('empty'));
  document.getElementById('orphans-restore-suggested')
    ?.addEventListener('click', () => {
      body.querySelectorAll('.orphan-project-select').forEach(sel => {
        const id = sel.getAttribute('data-task-id');
        const sug = suggested.get(id) || '';
        selection.set(id, sug);
        sel.value = sug;
      });
      updateFooter();
    });

  document.getElementById('orphans-cancel')
    ?.addEventListener('click', () => m.close());

  document.getElementById('orphans-save')
    ?.addEventListener('click', async () => {
      const saveBtn = document.getElementById('orphans-save');
      const toSave = orphans.filter(t => selection.get(t.id));
      if (!toSave.length) return;

      // Valida se ao menos um projeto ainda existe
      const invalid = toSave.find(t => !projects.some(p => p.id === selection.get(t.id)));
      if (invalid) { toast.error('Um dos projetos escolhidos não é mais válido.'); return; }

      saveBtn.disabled = true;
      const originalTxt = saveBtn.textContent;
      saveBtn.textContent = `Salvando ${toSave.length} tarefas…`;

      // writeBatch: 1 round-trip por lote de 400 (vs N round-trips sequenciais)
      const items = toSave.map(t => ({ id: t.id, data: { projectId: selection.get(t.id) } }));
      try {
        const { updated, failed } = await bulkUpdateTasks(items, (n, total) => {
          saveBtn.textContent = `Salvando… ${n}/${total}`;
        });
        saveBtn.textContent = originalTxt;
        if (failed) toast.warning(`${updated} atualizadas · ${failed} falharam. Veja o console.`);
        else        toast.success(`${updated} tarefa(s) atribuídas aos seus projetos.`);
      } catch (e) {
        console.warn('[tasks] bulk orphan fix falhou:', e?.message);
        saveBtn.textContent = originalTxt;
        toast.error('Falha no salvamento em lote: ' + (e?.message || ''));
      }
      m.close();
      // O subscribeToTasks re-renderiza o banner automaticamente.
    });

  updateFooter();
}

function _populateTagFilter() {
  const sel = document.getElementById('filter-tag');
  if (!sel) return;
  const tags = Array.from(new Set((allTasks || []).flatMap(t => t.tags || []))).sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const current = sel.value;
  sel.innerHTML = '<option value="">Todas as tags</option>' + tags.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  if (current && tags.includes(current)) sel.value = current;
}

/* \u2500\u2500\u2500 Filters \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
function applyFilters() {
  // Arquivadas só entram quando toggle "Mostrar arquivadas" está ativo
  // (ou ?archived=1 na URL). Default: ocultas pra manter UX limpa.
  let result = filterShowArchived ? [...allTasks] : allTasks.filter(t => !t.archived);

  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    result = result.filter(t =>
      t.title?.toLowerCase().includes(q) ||
      t.description?.toLowerCase().includes(q) ||
      t.tags?.some(tag=>tag.toLowerCase().includes(q))
    );
  }
  if (filterStatus === 'overdue') {
    // Status virtual: tarefa com prazo vencido e ainda em aberto
    result = result.filter(t => isTaskOverdue(t));
  } else if (filterStatus) {
    result = result.filter(t => t.status === filterStatus);
  }
  // Filtros vindos do Meu Painel via URL hash
  if (filterOpen) {
    result = result.filter(t => t.status !== 'done' && t.status !== 'cancelled');
  }
  if (filterCompletedToday) {
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate()+1);
    result = result.filter(t => {
      if (t.status !== 'done' || !t.completedAt) return false;
      const d = t.completedAt?.toDate ? t.completedAt.toDate() : new Date(t.completedAt);
      return d >= today && d < tomorrow;
    });
  }
  if (filterPartnership) {
    result = result.filter(t => t.isPartnership === true);
  }
  if (filterObserver) {
    result = result.filter(t => Array.isArray(t.observers) && t.observers.includes(filterObserver));
  }
  if (filterPriority) result = result.filter(t => t.priority === filterPriority);
  if (filterProject)  result = result.filter(t => t.projectId === filterProject);
  if (filterAssignee) result = result.filter(t => t.assignees?.includes(filterAssignee));
  if (filterArea)     result = result.filter(t => t.requestingArea === filterArea);
  if (filterTag)      result = result.filter(t => (t.tags || []).includes(filterTag));
  if (filterMeta) {
    // "Tem meta" se metaLinks[] preenchido OU goalId legado (back-compat).
    result = result.filter(t => {
      const hasMeta = (Array.isArray(t.metaLinks) && t.metaLinks.length > 0) || !!t.goalId;
      return filterMeta === 'with' ? hasMeta : !hasMeta;
    });
  }
  if (filterSquad === '__none__') {
    result = result.filter(t => !t.workspaceId);
  } else if (filterSquad) {
    result = result.filter(t => t.workspaceId === filterSquad);
  }

  // Date preset filters
  if (filterDatePreset) {
    const today = new Date(); today.setHours(0,0,0,0);
    const getDue = t => {
      if (!t.dueDate) return null;
      const d = t.dueDate?.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
      d.setHours(0,0,0,0);
      return d;
    };
    if (filterDatePreset === 'noDue') {
      result = result.filter(t => !t.dueDate);
    } else if (filterDatePreset === 'last30Days' || filterDatePreset === 'last90Days') {
      // Default filter: tasks com atividade recente OU ativas sem prazo longínquo.
      // Inclui: ainda não concluídas (sempre relevantes) OU concluídas no período.
      const days = filterDatePreset === 'last30Days' ? 30 : 90;
      const cutoff = new Date(today); cutoff.setDate(today.getDate() - days);
      result = result.filter(t => {
        if (t.status !== 'done') return true;
        const ts = t.updatedAt || t.completedAt || t.createdAt;
        if (!ts) return true;
        const d = ts?.toDate ? ts.toDate() : new Date(ts);
        return d >= cutoff;
      });
    } else if (filterDatePreset === 'overdue') {
      result = result.filter(t => { const d = getDue(t); return d && d < today && t.status !== 'done'; });
    } else if (filterDatePreset === 'today') {
      result = result.filter(t => { const d = getDue(t); return d && d.getTime() === today.getTime(); });
    } else if (filterDatePreset === 'tomorrow') {
      const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);
      result = result.filter(t => { const d = getDue(t); return d && d.getTime() === tomorrow.getTime(); });
    } else if (filterDatePreset === 'thisWeek') {
      const end = new Date(today);
      end.setDate(today.getDate() + (7 - today.getDay()));
      end.setHours(23,59,59,999);
      result = result.filter(t => { const d = getDue(t); return d && d >= today && d <= end; });
    } else if (filterDatePreset === 'nextWeek') {
      const startNext = new Date(today);
      startNext.setDate(today.getDate() + (7 - today.getDay()) + 1);
      const endNext = new Date(startNext);
      endNext.setDate(startNext.getDate() + 6);
      endNext.setHours(23,59,59,999);
      result = result.filter(t => { const d = getDue(t); return d && d >= startNext && d <= endNext; });
    } else if (filterDatePreset === 'thisMonth') {
      const startM = new Date(today.getFullYear(), today.getMonth(), 1);
      const endM = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);
      result = result.filter(t => { const d = getDue(t); return d && d >= startM && d <= endM; });
    } else if (filterDatePreset === 'custom' && (filterDateFrom || filterDateTo)) {
      const from = filterDateFrom ? new Date(filterDateFrom + 'T00:00:00') : null;
      const to   = filterDateTo   ? new Date(filterDateTo   + 'T23:59:59') : null;
      result = result.filter(t => {
        const d = getDue(t); if (!d) return false;
        if (from && d < from) return false;
        if (to   && d > to)   return false;
        return true;
      });
    }
  }

  filteredTasks = result;

  const label = document.getElementById('tasks-count-label');
  if (label) {
    // Denominador "(de N)" = teto alcançável removendo filtros REAIS desta tela.
    // - Toggle OFF: denominador = só ativas (arquivadas estão ocultas, não devem
    //   aparecer no teto).
    // - Toggle ON: denominador = TODAS (incluindo arquivadas), porque agora elas
    //   estão na lista visível.
    const denominator = filterShowArchived
      ? allTasks.length
      : allTasks.filter(t => !t.archived).length;
    const archivedSuffix = filterShowArchived ? ' (incluindo arquivadas)' : '';
    label.textContent = `${filteredTasks.length} tarefa${filteredTasks.length !== 1 ? 's' : ''}${denominator !== filteredTasks.length ? ` (de ${denominator})` : ''}${archivedSuffix}`;
  }

  renderTaskList();
}

/* \u2500\u2500\u2500 Render list \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
function renderTaskList() {
  const container = document.getElementById('tasks-container');
  if (!container) return;

  if (filteredTasks.length === 0) {
    container.innerHTML = `
      <div class="task-empty">
        <div class="task-empty-icon">\ud83d\udccb</div>
        <div class="task-empty-title">Nenhuma tarefa encontrada</div>
        <p class="text-sm text-muted mt-2">
          ${allTasks.length === 0
            ? 'Crie sua primeira tarefa clicando em "+ Nova Tarefa".'
            : 'Tente ajustar os filtros para encontrar as tarefas.'}
        </p>
        ${allTasks.length === 0 ? `
          <button class="btn btn-primary mt-4" id="empty-new-task-btn">+ Nova Tarefa</button>
        ` : ''}
      </div>
    `;
    _attachListEvents();
    return;
  }

  if (groupBy === 'none') {
    container.innerHTML = `
      <div class="card" style="overflow:hidden;">
        ${renderListHeader()}
        <div class="task-list" id="task-list-body">
          ${filteredTasks.map(t => renderTaskRow(t)).join('')}
        </div>
      </div>
    `;
  } else {
    const groups = buildGroups();
    container.innerHTML = groups.map(g => {
      // Grupo "Concluídas" / status='done' começa colapsado por default —
      // ajuda a limpar o visual da lista (o foco do dia-a-dia são as
      // ativas). User clica no header pra expandir quando quer ver.
      const startCollapsed = g.key === 'done';
      return `
      <div class="task-group${startCollapsed ? ' collapsed' : ''}" data-group="${g.key}">
        <div class="task-group-header" onclick="this.closest('.task-group').classList.toggle('collapsed')">
          <span class="task-group-chevron">\u25be</span>
          <span class="task-group-title">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${g.color};"></span>
            ${esc(g.label)}
          </span>
          <span class="task-group-count">${g.tasks.length}</span>
          <div style="margin-left:auto;">
            <button class="btn btn-ghost btn-sm add-group-task-btn" data-group-key="${g.key}"
              style="font-size:0.75rem; padding:3px 8px;">
              + Adicionar
            </button>
          </div>
        </div>
        <div class="task-group-body">
          <div class="card" style="overflow:hidden; margin-bottom:4px;">
            ${renderListHeader()}
            <div class="task-list">
              ${g.tasks.map(t => renderTaskRow(t)).join('')}
            </div>
          </div>
          ${renderQuickAdd(g.key)}
        </div>
      </div>
    `;
    }).join('');
  }

  _attachListEvents();
}

function renderListHeader() {
  // Header tem mesmo grid-template-columns das linhas, então 8 cols (incl. bulk)
  return `<div class="task-list-header">
    <div title="Selecionar todas visíveis nesta página">
      <input type="checkbox" id="bulk-select-all" class="bulk-checkbox"
        style="cursor:pointer;width:14px;height:14px;accent-color:var(--brand-gold);">
    </div>
    <div></div>
    <div>Título</div>
    <div>Status</div>
    <div>Tipo / Etapa</div>
    <div>Área</div>
    <div>Prazo</div>
    <div>Responsáveis</div>
  </div>`;
}

function renderTaskRow(task) {
  const isDone  = task.status === 'done';
  const status  = STATUS_MAP[task.status]   || { label: task.status, color: '#6B7280' };
  const prio    = PRIORITY_MAP[task.priority] || { label: task.priority, color: '#6B7280' };
  const project = allProjects.find(p => p.id === task.projectId);
  const users   = store.get('users') || [];
  // Defensivo: assignees pode vir como string se a IA salvou errado
  const assigneesArr = Array.isArray(task.assignees)
    ? task.assignees
    : (typeof task.assignees === 'string' && task.assignees ? [task.assignees] : []);
  const assignees = assigneesArr.slice(0,3).map(uid => {
    const u = users.find(u=>u.id===uid);
    if (!u) return '';
    return `<div class="avatar avatar-sm" title="${esc(u.name)}"
      style="background:${u.avatarColor||'#3B82F6'}; margin-left:-6px; border:2px solid var(--bg-card);">
      ${(u.name||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()}
    </div>`;
  }).join('');
  const extraAssignees = assigneesArr.length > 3
    ? `<div class="avatar avatar-sm" style="background:var(--bg-elevated); color:var(--text-muted); margin-left:-6px; border:2px solid var(--bg-card); font-size:0.5rem;">
        +${(assigneesArr.length-3)}
      </div>` : '';

  const dueText = task.dueDate ? formatDue(task.dueDate) : '';
  const dueClass = task.dueDate ? getDueClass(task.dueDate, isDone) : '';

  const nlStatus = task.type === 'newsletter' && task.newsletterStatus
    ? NEWSLETTER_STATUSES?.find(s=>s.value===task.newsletterStatus)?.label || task.newsletterStatus
    : null;
  const typeLabel = TASK_TYPES?.find(t=>t.value===task.type)?.label || '';

  const canComplete = store.can('task_complete');
  const subs = Array.isArray(task.subtasks) ? task.subtasks : [];
  const subDone = subs.filter(s => s.done).length;
  const subPct = subs.length ? Math.round((subDone / subs.length) * 100) : 0;
  const isSel = _selectedTaskIds.has(task.id);
  return `
    <div class="task-row ${isDone?'done':''} ${isSel?'bulk-selected':''}" data-task-id="${task.id}" draggable="true">
      <div class="bulk-select-cell" data-bulk-toggle="${task.id}"
        title="Selecionar para edição em massa"
        style="display:flex;align-items:center;justify-content:center;cursor:pointer;
        padding:4px;border-radius:4px;transition:background 0.15s;">
        <input type="checkbox" class="bulk-checkbox" data-bulk-id="${task.id}"
          ${isSel ? 'checked' : ''}
          style="cursor:pointer;width:16px;height:16px;accent-color:var(--brand-gold);">
      </div>
      <div class="task-check ${isDone?'checked':''} ${!canComplete && !isDone ? 'disabled' : ''}"
           data-check-id="${task.id}"
           title="${isDone ? 'Reabrir tarefa' : (canComplete ? 'Marcar como concluída' : 'Sem permissão para concluir tarefas. Peça a um coordenador.')}">
        ✓
      </div>
      <div>
        <div class="task-row-title">
          ${esc(task.title)}
          ${task.deliveryLink ? `<a href="${esc(task.deliveryLink)}" target="_blank" rel="noopener"
            title="Abrir link da entrega" data-stop-row
            style="margin-left:6px;font-size:0.75rem;color:var(--brand-gold);text-decoration:none;">🔗</a>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:2px;align-items:center;">
          <span class="badge badge-priority-${task.priority}" style="font-size:0.6rem;">${prio.label}</span>
          ${task.archived ? `<span title="Arquivada automaticamente após 730 dias de conclusão"
            style="font-size:0.625rem;padding:2px 8px;border-radius:99px;background:rgba(107,114,128,0.12);
                   color:var(--text-muted);border:1px solid rgba(107,114,128,0.3);font-weight:500;white-space:nowrap;">
            📦 Arquivada
          </span>` : ''}
          ${task.urgencyOverride?.active ? (() => {
            const ov = task.urgencyOverride;
            const parseAt = v => {
              if (!v) return null;
              if (v instanceof Date && !isNaN(v.getTime())) return v;
              if (typeof v.toDate === 'function') { try { const d=v.toDate(); if(!isNaN(d.getTime())) return d; } catch {} }
              if (typeof v === 'object' && typeof v.seconds === 'number') return new Date(v.seconds * 1000);
              if (typeof v === 'string' || typeof v === 'number') { const d=new Date(v); if(!isNaN(d.getTime())) return d; }
              return null;
            };
            const dt = parseAt(ov.at);
            const dateStr = dt ? dt.toLocaleDateString('pt-BR') : '';
            const tip = `Urgência automática removida${ov.byName?` por ${ov.byName}`:''}${dateStr?` em ${dateStr}`:''}${ov.reason?` — Motivo: ${ov.reason}`:''}`;
            return `<span title="${esc(tip)}"
              style="font-size:0.625rem;padding:2px 8px;border-radius:99px;
              background:rgba(59,130,246,0.12);color:#3B82F6;border:1px solid rgba(59,130,246,0.3);
              font-weight:500;white-space:nowrap;cursor:help;">
              ℹ urgência removida
            </span>`;
          })() : ''}
          ${(task.nucleos||[]).length ? `<span style="font-size:0.6875rem;color:var(--text-muted);">◈ ${(task.nucleos||[]).map(n=>NUCLEOS.find(x=>x.value===n)?.label||n).join(', ')}</span>` : ''}
          ${task.tags?.length ? task.tags.slice(0,2).map(t=>`<span style="font-size:0.6875rem;color:var(--text-muted);">#${esc(t)}</span>`).join('') : ''}
          ${project ? `<span style="font-size:0.6875rem;color:var(--text-muted);">${project.icon} ${esc(project.name)}</span>` : ''}
          ${subs.length ? (() => {
            const now = new Date();
            const overdueSubs = subs.filter(s => s.dueDate && !s.done && new Date(s.dueDate) < now);
            const upcomingSubs = subs.filter(s => s.dueDate && !s.done && (() => {
              const d = new Date(s.dueDate); const diff = (d - now) / 86400000; return diff >= 0 && diff <= 3;
            })());
            let subExtra = '';
            if (overdueSubs.length) {
              subExtra = `<span style="color:#EF4444;font-weight:600;font-size:0.6875rem;" title="${overdueSubs.map(s=>esc(s.title)).join(', ')}">⚠ ${overdueSubs.length} atrasada${overdueSubs.length>1?'s':''}</span>`;
            } else if (upcomingSubs.length) {
              const next = upcomingSubs.sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate))[0];
              const dd = new Date(next.dueDate);
              subExtra = `<span style="color:#D97706;font-size:0.6875rem;" title="${esc(next.title)}">📅 ${String(dd.getDate()).padStart(2,'0')}/${String(dd.getMonth()+1).padStart(2,'0')}</span>`;
            }
            return `<span title="${subDone}/${subs.length} subtarefas concluídas" style="display:inline-flex;align-items:center;gap:4px;font-size:0.6875rem;color:var(--text-muted);">
              <span style="width:40px;height:4px;background:var(--bg-elevated);border-radius:2px;overflow:hidden;display:inline-block;">
                <span style="display:block;height:100%;width:${subPct}%;background:${subPct===100?'var(--color-success)':'var(--brand-gold)'};"></span>
              </span>
              ${subDone}/${subs.length}
            </span>${subExtra}`;
          })() : ''}
        </div>
      </div>
      <div class="task-cell-edit" data-edit-field="status" data-edit-id="${task.id}"
        title="Click pra alterar status">
        <span class="badge badge-status-${task.status}" style="font-size:0.6875rem;">
          ${status.label}
        </span>
      </div>
      <div class="task-cell-edit" data-edit-field="typeStep" data-edit-id="${task.id}"
        title="Click pra alterar tipo/etapa"
        style="font-size:0.8125rem;">
        ${typeLabel ? `<div style="color:var(--text-secondary);">${esc(typeLabel)}</div>` : '<span style="opacity:.5;">—</span>'}
        ${nlStatus ? `<div style="font-size:0.75rem;color:var(--brand-gold);margin-top:2px;">↳ ${esc(nlStatus)}</div>` : ''}
        ${(() => {
          // Show showInList custom fields for this task's type
          if (!task.typeId && !task.type) return '';
          const tt = pageTaskTypes.find(t => t.id === task.typeId || t.name?.toLowerCase() === task.type);
          if (!tt) return '';
          return (tt.fields||[])
            .filter(f => f.showInList && f.key !== 'newsletterStatus' && f.key !== 'outOfCalendar')
            .map(f => {
              const val = task.customFields?.[f.key];
              if (val === null || val === undefined || val === '') return '';
              const display = Array.isArray(val) ? val.join(', ') : String(val);
              return `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:1px;">${esc(f.label)}: ${esc(display)}</div>`;
            }).join('');
        })()}
      </div>
      <div class="task-cell-edit" data-edit-field="area" data-edit-id="${task.id}"
        title="Click pra alterar área"
        style="font-size:0.8125rem; color:var(--text-muted);">
        ${task.requestingArea ? esc(task.requestingArea) : '<span style="opacity:.5;">—</span>'}
      </div>
      <div class="task-cell-edit kanban-card-due ${dueClass}"
        data-edit-field="dueDate" data-edit-id="${task.id}"
        title="Click pra alterar prazo"
        style="font-size:0.8125rem;">${dueText || '<span style="opacity:.5;">—</span>'}</div>
      <div class="task-cell-edit" data-edit-field="assignees" data-edit-id="${task.id}"
        title="Click pra alterar responsáveis"
        style="display:flex; align-items:center;">
        ${assignees}${extraAssignees}
        ${assigneesArr.length === 0 ? '<span style="opacity:.5;font-size:0.75rem;">—</span>' : ''}
      </div>
    </div>

  `;
}

function renderQuickAdd(groupKey) {
  return `
    <div class="quick-add-bar" data-group="${groupKey}" style="margin-top:4px;">
      <span style="color:var(--text-muted);font-size:1rem;">+</span>
      <input type="text" class="quick-add-input quick-add-task-input"
        placeholder="Adicionar tarefa... (Enter para confirmar)"
        data-group="${groupKey}" maxlength="200" />
    </div>
  `;
}

function buildGroups() {
  if (groupBy === 'dueDate') {
    const buckets = {
      overdue:    { key:'overdue',    label:'⚠ Atrasadas',      color:'#EF4444', tasks: [] },
      today:      { key:'today',      label:'📅 Hoje',           color:'#FBBF24', tasks: [] },
      tomorrow:   { key:'tomorrow',   label:'⏰ Amanhã',         color:'#F59E0B', tasks: [] },
      thisWeek:   { key:'thisWeek',   label:'📆 Esta semana',    color:'#60A5FA', tasks: [] },
      nextWeek:   { key:'nextWeek',   label:'🗓 Próxima semana', color:'#38BDF8', tasks: [] },
      future:     { key:'future',     label:'🔮 Futuro',         color:'#A78BFA', tasks: [] },
      noDue:      { key:'noDue',      label:'∅ Sem prazo',       color:'#6B7280', tasks: [] },
      done:       { key:'done',       label:'✓ Concluídas',      color:'#22C55E', tasks: [] },
    };
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);
    // Fim da semana atual (domingo)
    const endOfWeek = new Date(today);
    endOfWeek.setDate(today.getDate() + (7 - today.getDay()));
    endOfWeek.setHours(23,59,59,999);
    const endOfNextWeek = new Date(endOfWeek);
    endOfNextWeek.setDate(endOfWeek.getDate() + 7);

    filteredTasks.forEach(t => {
      if (t.status === 'done') { buckets.done.tasks.push(t); return; }
      if (!t.dueDate) { buckets.noDue.tasks.push(t); return; }
      const due = t.dueDate?.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
      const dueDay = new Date(due); dueDay.setHours(0,0,0,0);
      if (dueDay < today)              buckets.overdue.tasks.push(t);
      else if (dueDay.getTime() === today.getTime()) buckets.today.tasks.push(t);
      else if (dueDay.getTime() === tomorrow.getTime()) buckets.tomorrow.tasks.push(t);
      else if (dueDay <= endOfWeek)    buckets.thisWeek.tasks.push(t);
      else if (dueDay <= endOfNextWeek) buckets.nextWeek.tasks.push(t);
      else                             buckets.future.tasks.push(t);
    });
    // Sort inside each bucket by closest due
    const byDue = (a, b) => {
      const da = a.dueDate?.toDate ? a.dueDate.toDate() : (a.dueDate ? new Date(a.dueDate) : new Date(8640000000000000));
      const db = b.dueDate?.toDate ? b.dueDate.toDate() : (b.dueDate ? new Date(b.dueDate) : new Date(8640000000000000));
      return da - db;
    };
    Object.values(buckets).forEach(b => b.tasks.sort(byDue));
    return Object.values(buckets).filter(b => b.tasks.length > 0);
  }
  if (groupBy === 'status') {
    return STATUSES.map(s => ({
      key:   s.value,
      label: s.label,
      color: s.color,
      tasks: filteredTasks.filter(t => t.status === s.value),
    })).filter(g => g.tasks.length > 0);
  }
  if (groupBy === 'priority') {
    return PRIORITIES.map(p => ({
      key:   p.value,
      label: p.label,
      color: p.color,
      tasks: filteredTasks.filter(t => t.priority === p.value),
    })).filter(g => g.tasks.length > 0);
  }
  if (groupBy === 'project') {
    const groups = [];
    const noProject = filteredTasks.filter(t => !t.projectId);
    allProjects.forEach(p => {
      const tasks = filteredTasks.filter(t => t.projectId === p.id);
      if (tasks.length) groups.push({ key: p.id, label: `${p.icon} ${p.name}`, color: p.color, tasks });
    });
    if (noProject.length) groups.push({ key: 'none', label: 'Sem projeto', color: '#6B7280', tasks: noProject });
    return groups;
  }
  if (groupBy === 'squad') {
    // Agrupa por workspace (squad). Squads vêm de userWorkspaces no store
    // (squads que o user é membro). Tasks de squads que ele não vê (caso
    // master/admin com visão ampla) são derivadas do conjunto de tasks.
    const groups = [];
    const userSquads = store.get('userWorkspaces') || [];
    const squadById = new Map(userSquads.map(w => [w.id, w]));
    // Coleta também IDs de squads vistos nas tasks (cobertura pra master)
    const seen = new Set();
    filteredTasks.forEach(t => { if (t.workspaceId) seen.add(t.workspaceId); });
    // Constrói grupos na ordem: squads do user primeiro, depois os "vistos"
    userSquads.forEach(w => {
      const tasks = filteredTasks.filter(t => t.workspaceId === w.id);
      if (tasks.length) {
        groups.push({
          key:   w.id,
          label: `${w.icon || '◈'} ${w.name}${w.multiSector ? ' · multissetor' : ''}`,
          color: w.color || '#6366F1',
          tasks,
        });
      }
    });
    // Squads visíveis nas tasks mas que o user não é membro (ex: master)
    seen.forEach(wid => {
      if (squadById.has(wid)) return;
      const tasks = filteredTasks.filter(t => t.workspaceId === wid);
      if (tasks.length) {
        groups.push({
          key:   wid,
          label: `◈ Squad ${wid.slice(0, 6)}…`,
          color: '#6366F1',
          tasks,
        });
      }
    });
    // "Sem squad" sempre por último
    const noSquad = filteredTasks.filter(t => !t.workspaceId);
    if (noSquad.length) groups.push({ key: 'none', label: 'Sem squad', color: '#6B7280', tasks: noSquad });
    return groups;
  }
  return [];
}

/* \u2500\u2500\u2500 Event Handlers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
function _attachPageEvents() {
  // Use onXxx assignments (not addEventListener) para os botões críticos:
  // assim, se renderTasks rodar duas vezes em paralelo (ex: initial render +
  // store.subscribe('activeWorkspaces')), o handler não é duplicado e o clique
  // não abre o modal duas vezes.
  const newBtn = document.getElementById('new-task-btn');
  if (newBtn) newBtn.onclick = () => openNewTask();
  const emailBtn = document.getElementById('email-task-btn');
  if (emailBtn) emailBtn.onclick = () => openEmailToTaskModal();
  const importBtn = document.getElementById('tasks-import-btn');
  if (importBtn) importBtn.onclick = async () => {
    const { openPlannerImportWizard } = await import('../components/plannerImport.js');
    openPlannerImportWizard();
  };
  const xlsBtn = document.getElementById('tasks-export-xls');
  if (xlsBtn) xlsBtn.onclick = exportTasksXls;
  const pdfBtn = document.getElementById('tasks-export-pdf');
  if (pdfBtn) pdfBtn.onclick = exportTasksPdf;

  // Ativa dropdowns do header (export menu + overflow ⋮)
  // _attachPageEvents não recebe container como param — usa document como root
  wireUiKitMenus(document);

  // Search
  let timer;
  document.getElementById('tasks-search')?.addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { searchTerm = e.target.value; applyFilters(); }, 250);
  });

  // Filters
  document.getElementById('filter-status')?.addEventListener('change', e => { filterStatus = e.target.value; applyFilters(); });
  document.getElementById('filter-priority')?.addEventListener('change', e => { filterPriority = e.target.value; applyFilters(); });
  document.getElementById('filter-project')?.addEventListener('change', e => { filterProject = e.target.value; applyFilters(); });
  document.getElementById('filter-squad')?.addEventListener('change', e => { filterSquad = e.target.value; applyFilters(); });

  // Visual pickers (status / priority / squad) — selects nativos preservados pra change events
  // status: cor da bolinha já identifica, sem icon redundante.
  // "Atrasada" entra como status virtual (não persistido) — ver
  // STATUS_OVERDUE em services/tasks.js + RULES-AND-AUTOMATIONS.md § 10.1
  const statusOpts = () => [
    { id: 'overdue', label: '⚠ Atrasada', icon: '', color: '#EF4444' },
    ...STATUSES.map(s => ({ id: s.value, label: s.label, icon: '', color: s.color })),
  ];
  const findStatus = (id) => statusOpts().find(o => o.id === id) || null;
  bindOptionPicker({
    btnId: 'filter-status-btn',
    selectId: 'filter-status',
    buildConfig: () => ({
      options: statusOpts(),
      empty: { id: '', label: 'Todos os status' },
      searchPlaceholder: 'Buscar status…',
    }),
    findSelected: findStatus,
    emptyLabel: 'Todos os status',
  });
  const priorityOpts = () => PRIORITIES.map(p => ({ id: p.value, label: p.label, icon: p.icon, color: p.color }));
  const findPriority = (id) => priorityOpts().find(o => o.id === id) || null;
  bindOptionPicker({
    btnId: 'filter-priority-btn',
    selectId: 'filter-priority',
    buildConfig: () => ({
      options: priorityOpts(),
      empty: { id: '', label: 'Todas as prioridades' },
      searchPlaceholder: 'Buscar prioridade…',
    }),
    findSelected: findPriority,
    emptyLabel: 'Todas as prioridades',
  });
  const squadOpts = () => {
    const ws = store.get('userWorkspaces') || [];
    return [
      { id: '__none__', label: '— Sem squad', icon: '○', color: '#6B7280' },
      ...ws.map(w => ({
        id: w.id,
        label: w.name + (w.multiSector ? ' (multissetor)' : ''),
        icon: w.icon || '◈',
        color: w.color || '#6366F1',
      })),
    ];
  };
  const findSquad = (id) => squadOpts().find(o => o.id === id) || null;
  bindOptionPicker({
    btnId: 'filter-squad-btn',
    selectId: 'filter-squad',
    buildConfig: () => ({
      options: squadOpts(),
      empty: { id: '', label: 'Todos os squads' },
      searchPlaceholder: 'Buscar squad…',
    }),
    findSelected: findSquad,
    emptyLabel: 'Todos os squads',
  });
  // Hash determinístico → cor estável por área
  const HASH_PALETTE = ['#6366F1','#8B5CF6','#EC4899','#F59E0B','#22C55E','#0EA5E9','#D4A843','#64748B','#10B981'];
  const hashColor = (s) => {
    let h = 0; for (let i = 0; i < s.length; i++) h = ((h<<5)-h+s.charCodeAt(i))|0;
    return HASH_PALETTE[Math.abs(h) % HASH_PALETTE.length];
  };
  const areaOpts = () => REQUESTING_AREAS.map(a => ({ id: a, label: a, icon: '', color: hashColor(a) }));
  const findArea = (id) => areaOpts().find(o => o.id === id) || null;
  bindOptionPicker({
    btnId: 'filter-area-btn',
    selectId: 'filter-area',
    buildConfig: () => ({
      options: areaOpts(),
      empty: { id: '', label: 'Todas as áreas' },
      searchPlaceholder: 'Buscar área…',
    }),
    findSelected: findArea,
    emptyLabel: 'Todas as áreas',
  });
  // Inicial do nome como ícone, cor estável via hash do id do usuário
  const assigneeOpts = () => (store.get('users') || [])
    .filter(u => u.active)
    .map(u => ({
      id: u.id,
      label: u.name || u.email || 'Usuário',
      icon: (u.name || u.email || '?').trim().charAt(0).toUpperCase(),
      color: hashColor(u.id || u.email || u.name || ''),
    }));
  const findAssignee = (id) => assigneeOpts().find(o => o.id === id) || null;
  bindOptionPicker({
    btnId: 'filter-assignee-btn',
    selectId: 'filter-assignee',
    buildConfig: () => ({
      options: assigneeOpts(),
      empty: { id: '', label: 'Todos os responsáveis' },
      searchPlaceholder: 'Buscar responsável…',
    }),
    findSelected: findAssignee,
    emptyLabel: 'Todos os responsáveis',
  });
  document.getElementById('filter-assignee')?.addEventListener('change', e => { filterAssignee = e.target.value; applyFilters(); });
  document.getElementById('filter-area')?.addEventListener('change', e => { filterArea = e.target.value; applyFilters(); });
  document.getElementById('filter-tag')?.addEventListener('change', e => { filterTag = e.target.value; applyFilters(); });
  document.getElementById('filter-meta')?.addEventListener('change', e => { filterMeta = e.target.value; applyFilters(); });
  document.getElementById('filter-archived')?.addEventListener('change', e => {
    filterShowArchived = e.target.checked;
    // Atualiza o destaque visual do label (fundo dourado quando ON)
    const wrap = document.getElementById('filter-archived-wrap');
    if (wrap) wrap.style.background = filterShowArchived ? 'var(--brand-gold-bg,rgba(212,168,67,.12))' : 'transparent';
    applyFilters();
  });
  document.getElementById('filter-date-preset')?.addEventListener('change', e => {
    filterDatePreset = e.target.value;
    const customBar = document.getElementById('filter-date-custom');
    if (customBar) customBar.style.display = (filterDatePreset === 'custom') ? 'flex' : 'none';
    if (filterDatePreset !== 'custom') { filterDateFrom = ''; filterDateTo = ''; }
    applyFilters();
  });
  document.getElementById('filter-date-from')?.addEventListener('change', e => { filterDateFrom = e.target.value; applyFilters(); });
  document.getElementById('filter-date-to')?.addEventListener('change', e => { filterDateTo = e.target.value; applyFilters(); });
  document.getElementById('filter-date-clear')?.addEventListener('click', () => {
    filterDatePreset = ''; filterDateFrom = ''; filterDateTo = '';
    const sel = document.getElementById('filter-date-preset'); if (sel) sel.value = '';
    const fromI = document.getElementById('filter-date-from'); if (fromI) fromI.value = '';
    const toI   = document.getElementById('filter-date-to');   if (toI)   toI.value = '';
    const customBar = document.getElementById('filter-date-custom'); if (customBar) customBar.style.display = 'none';
    applyFilters();
  });
  document.getElementById('filter-config-btn')?.addEventListener('click', openFilterConfigModal);
  document.getElementById('tasks-card-prefs-btn')?.addEventListener('click', () => openCardPrefsModal(() => renderTaskList()));
  document.getElementById('group-by')?.addEventListener('change', e => { groupBy = e.target.value; renderTaskList(); });
}

/* ─── Modal de configuração de filtros visíveis ──────────── */
function openFilterConfigModal() {
  const items = [
    { key: 'status',     label: 'Status' },
    { key: 'priority',   label: 'Prioridade' },
    { key: 'project',    label: 'Projeto' },
    { key: 'squad',      label: 'Squad' },
    { key: 'assignee',   label: 'Responsável' },
    { key: 'datePreset', label: 'Prazo (hoje, semana, mês…)' },
    { key: 'area',       label: 'Área solicitante' },
    { key: 'tag',        label: 'Tag' },
    { key: 'meta',       label: 'Meta vinculada (com / sem)' },
  ];
  const content = `
    <p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:12px;">
      Escolha quais filtros aparecem na barra de ferramentas. Sua preferência fica salva neste navegador.
    </p>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${items.map(it => `
        <label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:6px;cursor:pointer;">
          <input type="checkbox" class="filter-vis-check" data-key="${it.key}"
            ${filterVisibility[it.key] ? 'checked' : ''} />
          <span style="font-size:0.875rem;">${it.label}</span>
        </label>
      `).join('')}
    </div>
  `;
  modal.open({
    title: '⚙ Configurar filtros',
    size: 'sm',
    content,
    footer: [
      { label: 'Restaurar padrão', class: 'btn-secondary', closeOnClick: false, onClick: (_, { close }) => {
        filterVisibility = { ...DEFAULT_FILTER_VISIBILITY };
        saveFilterVisibility();
        close();
        renderTasks(document.getElementById('page-content') || document.body.querySelector('#page-content'));
      } },
      { label: 'Cancelar', class: 'btn-secondary', closeOnClick: true },
      { label: 'Salvar', class: 'btn-primary', closeOnClick: false, onClick: (_, { close }) => {
        document.querySelectorAll('.filter-vis-check').forEach(cb => {
          filterVisibility[cb.dataset.key] = cb.checked;
        });
        saveFilterVisibility();
        close();
        toast.success('Preferências de filtro salvas.');
        // Re-render a página para aplicar a visibilidade
        const host = document.getElementById('page-content') || document.querySelector('main') || document.body;
        if (host) renderTasks(host);
      } },
    ],
  });
}

function _attachListEvents() {
  // Event delegation: attach ONE set of listeners to the container, not per-element.
  // The flag ensures we never add duplicate listeners across re-renders.
  if (_delegationAttached) return;
  const container = document.getElementById('tasks-container');
  if (!container) return;

  container.addEventListener('click', _handleDelegatedClick);
  container.addEventListener('keydown', _handleDelegatedKeydown);

  // Drag and drop
  container.addEventListener('dragstart', _handleDragStart);
  container.addEventListener('dragend', _handleDragEnd);
  container.addEventListener('dragover', _handleDragOver);
  container.addEventListener('drop', _handleDrop);

  _delegationAttached = true;
}

async function _handleDelegatedClick(e) {
  // --- "Empty state" new-task button ---
  const emptyBtn = e.target.closest('#empty-new-task-btn');
  if (emptyBtn) { openNewTask(); return; }

  // --- Bulk select master-checkbox (header) ---
  if (e.target.id === 'bulk-select-all') {
    e.stopPropagation();
    const checked = e.target.checked;
    if (checked) {
      filteredTasks.forEach(t => _selectedTaskIds.add(t.id));
    } else {
      _selectedTaskIds.clear();
    }
    _refreshBulkUi();
    return;
  }
  // --- Bulk select por linha (cell ou checkbox) ---
  const bulkCell = e.target.closest('[data-bulk-toggle]');
  const bulkCheck = e.target.closest('.bulk-checkbox[data-bulk-id]');
  if (bulkCell || bulkCheck) {
    e.stopPropagation();
    const id = bulkCell?.dataset.bulkToggle || bulkCheck?.dataset.bulkId;
    if (!id) return;
    if (_selectedTaskIds.has(id)) _selectedTaskIds.delete(id);
    else                          _selectedTaskIds.add(id);
    _refreshBulkUi();
    return;
  }

  // --- Inline edit em célula (status/area/prazo/responsáveis) ---
  const editCell = e.target.closest('.task-cell-edit[data-edit-field][data-edit-id]');
  if (editCell) {
    e.stopPropagation();
    const field = editCell.dataset.editField;
    const id    = editCell.dataset.editId;
    const task  = allTasks.find(t => t.id === id);
    if (!task) return;
    await _openInlineEditPopover(editCell, field, task);
    return;
  }

  // --- Task check toggle (must come before row click) ---
  const check = e.target.closest('.task-check[data-check-id]');
  if (check) {
    e.stopPropagation();
    const id   = check.dataset.checkId;
    const task = allTasks.find(t => t.id === id);
    if (!task) return;
    const isDone = task.status !== 'done';
    try {
      await toggleTaskComplete(id, isDone);
      if (isDone) {
        // Se getTask falhar, log o erro mas usa stale local — overlay ainda
        // abre. Antes silenciava completamente e podia mostrar dados velhos
        // sem indicação que algo deu errado.
        const fresh = await getTask(id).catch(err => {
          console.warn('[tasks] getTask after complete falhou:', err.message);
          return task;
        });
        openTaskDoneOverlay(id, fresh);
      }
    } catch(err) { toast.error(err.message); }
    return;
  }

  // --- Add-group-task button (inside group header) ---
  const addGroupBtn = e.target.closest('.add-group-task-btn');
  if (addGroupBtn) {
    e.stopPropagation();
    const key = addGroupBtn.dataset.groupKey;
    const presets = {};
    if (groupBy === 'status')   presets.status    = key;
    if (groupBy === 'priority') presets.priority  = key;
    if (groupBy === 'project')  presets.projectId = key !== 'none' ? key : null;
    if (groupBy === 'squad')    presets.workspaceId = key !== 'none' ? key : null;
    openNewTask(presets);
    return;
  }

  // --- Row click -> open modal (skip if clicking check or stop-row link) ---
  const row = e.target.closest('.task-row[data-task-id]');
  if (row) {
    if (e.target.closest('.task-check')) return;
    if (e.target.closest('[data-stop-row]')) return;
    const id   = row.dataset.taskId;
    const task = allTasks.find(t => t.id === id);
    if (task) openTaskModal({ taskData: task, onSave: () => {} });
    return;
  }
}

async function _handleDelegatedKeydown(e) {
  // --- Quick-add input (Enter to create task) ---
  const input = e.target.closest('.quick-add-task-input');
  if (input && e.key === 'Enter') {
    const val = input.value.trim();
    if (!val) return;
    e.preventDefault();
    const groupKey = input.dataset.group;
    const newTaskData = { title: val };
    if (groupBy === 'status' && groupKey !== 'none') newTaskData.status = groupKey;
    if (groupBy === 'priority' && groupKey !== 'none') newTaskData.priority = groupKey;
    if (groupBy === 'project' && groupKey !== 'none') newTaskData.projectId = groupKey;
    if (groupBy === 'squad' && groupKey !== 'none') newTaskData.workspaceId = groupKey;
    try {
      const { createTask } = await import('../services/tasks.js');
      await createTask(newTaskData);
      input.value = '';
      toast.success('Tarefa criada!');
    } catch(err) { toast.error(err.message); }
  }
}

/* ─── Drag and Drop ────────────────────────────────────────── */
let _dragTaskId = null;

function _handleDragStart(e) {
  const row = e.target.closest('.task-row[data-task-id]');
  if (!row) return;
  _dragTaskId = row.dataset.taskId;
  row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', _dragTaskId);
  // Make the drag image slightly transparent
  requestAnimationFrame(() => { row.style.opacity = '0.4'; });
}

function _handleDragEnd(e) {
  const row = e.target.closest('.task-row[data-task-id]');
  if (row) { row.classList.remove('dragging'); row.style.opacity = ''; }
  _dragTaskId = null;
  // Remove all drag-over highlights
  document.querySelectorAll('.task-group.drag-over').forEach(g => g.classList.remove('drag-over'));
  document.querySelectorAll('.task-row.drag-insert-above,.task-row.drag-insert-below').forEach(r => {
    r.classList.remove('drag-insert-above', 'drag-insert-below');
  });
}

function _handleDragOver(e) {
  if (!_dragTaskId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  // Highlight target group
  const group = e.target.closest('.task-group[data-group]');
  document.querySelectorAll('.task-group.drag-over').forEach(g => {
    if (g !== group) g.classList.remove('drag-over');
  });
  if (group) group.classList.add('drag-over');

  // Show insert indicator on nearest row
  const row = e.target.closest('.task-row[data-task-id]');
  document.querySelectorAll('.task-row.drag-insert-above,.task-row.drag-insert-below').forEach(r => {
    if (r !== row) r.classList.remove('drag-insert-above', 'drag-insert-below');
  });
  if (row && row.dataset.taskId !== _dragTaskId) {
    const rect = row.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      row.classList.add('drag-insert-above');
      row.classList.remove('drag-insert-below');
    } else {
      row.classList.add('drag-insert-below');
      row.classList.remove('drag-insert-above');
    }
  }
}

async function _handleDrop(e) {
  e.preventDefault();
  if (!_dragTaskId) return;

  const targetGroup = e.target.closest('.task-group[data-group]');
  const task = allTasks.find(t => t.id === _dragTaskId);
  if (!task) return;

  // When grouped by status, change status
  if (groupBy === 'status' && targetGroup) {
    const newStatus = targetGroup.dataset.group;
    if (newStatus && newStatus !== task.status) {
      try {
        if (newStatus === 'done') {
          await toggleTaskComplete(_dragTaskId, true);
          const fresh = await getTask(_dragTaskId).catch(() => task);
          openTaskDoneOverlay(_dragTaskId, fresh);
        } else {
          await updateTask(_dragTaskId, { status: newStatus });
        }
        toast.success(`Status alterado para ${STATUS_MAP[newStatus]?.label || newStatus}`);
      } catch (err) { toast.error(err.message); }
    }
  }
  // When grouped by priority, change priority
  else if (groupBy === 'priority' && targetGroup) {
    const newPriority = targetGroup.dataset.group;
    if (newPriority && newPriority !== task.priority) {
      try {
        await updateTask(_dragTaskId, { priority: newPriority });
        toast.success(`Prioridade alterada para ${PRIORITY_MAP[newPriority]?.label || newPriority}`);
      } catch (err) { toast.error(err.message); }
    }
  }
  // When grouped by project, change project
  else if (groupBy === 'project' && targetGroup) {
    const newProjectId = targetGroup.dataset.group;
    if (newProjectId !== (task.projectId || 'none')) {
      try {
        await updateTask(_dragTaskId, { projectId: newProjectId === 'none' ? null : newProjectId });
        const proj = allProjects.find(p => p.id === newProjectId);
        toast.success(proj ? `Movida para ${proj.name}` : 'Removida do projeto');
      } catch (err) { toast.error(err.message); }
    }
  }
  // When grouped by squad, change workspaceId
  else if (groupBy === 'squad' && targetGroup) {
    const newSquadId = targetGroup.dataset.group;
    const currentSquad = task.workspaceId || 'none';
    if (newSquadId !== currentSquad) {
      try {
        await updateTask(_dragTaskId, { workspaceId: newSquadId === 'none' ? null : newSquadId });
        const squads = store.get('userWorkspaces') || [];
        const sq = squads.find(s => s.id === newSquadId);
        toast.success(sq ? `Movida para ${sq.name}` : 'Removida do squad');
      } catch (err) { toast.error(err.message); }
    }
  }

  _dragTaskId = null;
}

function openNewTask(presets = {}) {
  openTaskModal({ projectId: filterProject || null, ...presets, onSave: () => {} });
}

/* \u2500\u2500\u2500 Email \u2192 Tarefa \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
function openEmailToTaskModal() {
  modal.open({
    title: '\ud83d\udce7 Criar Tarefa a partir de Email',
    size: 'lg',
    content: `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <p style="margin:0;font-size:0.8125rem;color:var(--text-muted);">
          Cole o conte\u00fado do email abaixo. A IA ir\u00e1 analisar e pr\u00e9-preencher os campos da tarefa automaticamente.
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="font-size:0.75rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;">
              De (remetente)
            </label>
            <input type="text" id="email-from" class="form-input"
              placeholder="nome@empresa.com" style="margin-top:4px;" />
          </div>
          <div>
            <label style="font-size:0.75rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;">
              Assunto
            </label>
            <input type="text" id="email-subject" class="form-input"
              placeholder="Assunto do email" style="margin-top:4px;" />
          </div>
        </div>
        <div>
          <label style="font-size:0.75rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;">
            Corpo do email
          </label>
          <textarea id="email-body" class="form-input" rows="10"
            placeholder="Cole aqui o conte\u00fado completo do email..."
            style="margin-top:4px;resize:vertical;min-height:180px;font-size:0.8125rem;line-height:1.6;"></textarea>
        </div>
        <div id="email-parse-status" style="display:none;padding:10px 14px;border-radius:8px;
          background:var(--bg-surface);font-size:0.8125rem;color:var(--text-muted);text-align:center;">
        </div>
      </div>
    `,
    footer: [
      {
        label: '\u2728 Analisar com IA e criar tarefa',
        class: 'btn-primary',
        closeOnClick: false,
        onClick: async (e, { close }) => {
          const btn = e.target;
          const from    = document.getElementById('email-from')?.value?.trim() || '';
          const subject = document.getElementById('email-subject')?.value?.trim() || '';
          const emailBody = document.getElementById('email-body')?.value?.trim() || '';
          const statusEl = document.getElementById('email-parse-status');

          if (!emailBody && !subject) {
            toast.warning('Cole pelo menos o assunto ou corpo do email.');
            return;
          }

          btn.disabled = true;
          btn.textContent = '\u23f3 Analisando email...';
          if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Enviando para IA...'; }

          try {
            const suggestion = await parseEmailToTask(from, subject, emailBody);

            if (!suggestion) {
              if (statusEl) { statusEl.textContent = 'IA n\u00e3o dispon\u00edvel. Abrindo formul\u00e1rio manual...'; }
              setTimeout(() => {
                close();
                openTaskModal({
                  taskData: {
                    title: subject || 'Tarefa de email',
                    description: `De: ${from}\nAssunto: ${subject}\n\n${emailBody}`,
                  },
                  onSave: () => {},
                });
              }, 800);
              return;
            }

            if (statusEl) { statusEl.textContent = '\u2705 An\u00e1lise conclu\u00edda! Abrindo formul\u00e1rio...'; }
            setTimeout(() => {
              close();
              openTaskModal({
                typeId: suggestion.suggestedTypeId || null,
                taskData: {
                  title:       suggestion.title || subject || 'Tarefa de email',
                  description: suggestion.description || `De: ${from}\nAssunto: ${subject}\n\n${emailBody}`,
                  priority:    suggestion.priority || 'medium',
                  clientName:  suggestion.clientName || from || '',
                  clientEmail: suggestion.clientEmail || from || '',
                },
                onSave: () => {},
              });
            }, 600);
          } catch (err) {
            btn.disabled = false;
            btn.textContent = '\u2728 Analisar com IA e criar tarefa';
            if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = '\u274c Erro: ' + err.message; }
            toast.error('Erro ao analisar email: ' + err.message);
          }
        },
      },
    ],
  });
  setTimeout(() => document.getElementById('email-subject')?.focus(), 200);
}

async function parseEmailToTask(from, subject, body) {
  const { getAIConfig, resolveApiKey } = await import('../services/ai.js');
  const cfg = await getAIConfig() || {};
  const provider = cfg.provider || 'groq';
  const resolved = await resolveApiKey(provider);
  const apiKey = resolved.apiKey;
  if (!apiKey) return null;

  let typesSummary = '';
  try {
    const { fetchTaskTypes } = await import('../services/taskTypes.js');
    const taskTypes = await fetchTaskTypes();
    typesSummary = taskTypes.map(t => `${t.id}: ${t.name} (setor: ${t.sector || 'geral'})`).join('\n');
  } catch { /* ignore */ }

  const systemPrompt = `Voc\u00ea \u00e9 um assistente que analisa emails e extrai informa\u00e7\u00f5es para criar tarefas de trabalho.
${typesSummary ? `Tipos de tarefa dispon\u00edveis:\n${typesSummary}\n` : ''}
Analise o email e retorne APENAS JSON v\u00e1lido (sem markdown, sem \\\`\\\`\\\`) com:
{
  "title": "t\u00edtulo curto e claro para a tarefa (m\u00e1x 80 chars)",
  "description": "descri\u00e7\u00e3o detalhada da demanda extra\u00edda do email, incluindo contexto relevante",
  "priority": "urgent|high|medium|low",
  "suggestedTypeId": "ID do tipo mais adequado ou string vazia",
  "clientName": "nome do remetente/cliente se identific\u00e1vel",
  "clientEmail": "email do remetente se fornecido",
  "deadline": "prazo mencionado no email (formato YYYY-MM-DD) ou string vazia",
  "reasoning": "1 frase explicando sua an\u00e1lise"
}

Regras:
- O t\u00edtulo deve ser uma a\u00e7\u00e3o clara (ex: "Criar arte para campanha X", "Atualizar roteiro Jap\u00e3o")
- A descri\u00e7\u00e3o deve conter o contexto do pedido, n\u00e3o repetir o email inteiro
- Se o email mencionar urg\u00eancia, prazo curto ou palavras como "urgente", "asap", marque priority como "urgent" ou "high"
- Se n\u00e3o conseguir identificar um tipo de tarefa, deixe suggestedTypeId vazio`;

  const userContent = `Email recebido:
De: ${from || '(n\u00e3o informado)'}
Assunto: ${subject || '(sem assunto)'}

Corpo:
${body || '(vazio)'}`;

  let url, headers, reqBody;

  if (provider === 'groq') {
    url = 'https://api.groq.com/openai/v1/chat/completions';
    headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    reqBody = JSON.stringify({
      model: cfg.model || 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      temperature: 0.2, max_tokens: 600,
      response_format: { type: 'json_object' },
    });
  } else if (provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model || 'gemini-2.5-flash'}:generateContent?key=${apiKey}`;
    headers = { 'Content-Type': 'application/json' };
    reqBody = JSON.stringify({
      contents: [{ parts: [{ text: systemPrompt + '\n\n' + userContent }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 600, responseMimeType: 'application/json' },
    });
  } else if (provider === 'openai' || provider === 'azure') {
    url = provider === 'azure' && cfg.azureEndpoint
      ? `${cfg.azureEndpoint}/openai/deployments/${cfg.model || 'gpt-4o-mini'}/chat/completions?api-version=2024-02-01`
      : 'https://api.openai.com/v1/chat/completions';
    headers = {
      'Content-Type': 'application/json',
      ...(provider === 'azure' ? { 'api-key': apiKey } : { 'Authorization': `Bearer ${apiKey}` }),
    };
    reqBody = JSON.stringify({
      model: cfg.model || 'gpt-4o-mini',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      temperature: 0.2, max_tokens: 600,
      response_format: { type: 'json_object' },
    });
  } else if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages';
    headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true' };
    reqBody = JSON.stringify({
      model: cfg.model || 'claude-sonnet-4-20250514',
      max_tokens: 600, system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });
  } else {
    return null;
  }

  const resp = await fetch(url, { method: 'POST', headers, body: reqBody });
  if (!resp.ok) throw new Error(`API ${provider}: ${resp.status}`);
  const data = await resp.json();

  let text = '';
  if (provider === 'gemini') {
    text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } else if (provider === 'anthropic') {
    text = data.content?.[0]?.text || '';
  } else {
    text = data.choices?.[0]?.message?.content || '';
  }

  text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(text); }
  catch { console.warn('[email-to-task] Failed to parse AI response:', text); return null; }
}

/* \u2500\u2500\u2500 Helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
function formatDue(ts) {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' }).format(d);
}

function getDueClass(ts, done) {
  if (done) return '';
  const d   = ts?.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const diff = (d - now) / (1000 * 60 * 60 * 24);
  if (diff < 0)  return 'overdue';
  if (diff <= 2) return 'soon';
  return '';
}

/* ─── Helpers for export ─────────────────────────────────── */
const fmtDateExport = ts => { if(!ts) return ''; const d = ts?.toDate ? ts.toDate() : new Date(ts); return d.toLocaleDateString('pt-BR'); };

function _buildTaskRows() {
  const users = store.get('users') || [];
  return filteredTasks.map(t => {
    const project = allProjects.find(p => p.id === t.projectId);
    // Resolve UIDs → nome. Fallback para primeiro nome se user não encontrado.
    const assigneeNames = (t.assignees || [])
      .map(uid => {
        const u = users.find(u => u.id === uid);
        return u?.name || u?.displayName || u?.email?.split('@')[0] || '';
      })
      .filter(Boolean)
      .join(', ');
    const due = fmtDateExport(t.dueDate);
    const created = fmtDateExport(t.createdAt);
    const completed = fmtDateExport(t.completedAt);
    // Núcleos são array (t.nucleos), não string. Tipo fica em t.type.
    const nucleosArr = Array.isArray(t.nucleos) ? t.nucleos : (t.nucleo ? [t.nucleo] : []);
    const nucleo = nucleosArr
      .map(n => NUCLEOS?.find(x => x.value === n)?.label || n)
      .filter(Boolean)
      .join(', ');
    const taskType = TASK_TYPES?.find(tt => tt.value === t.type)?.label || t.type || '';
    return {
      title: t.title || '',
      status: STATUS_MAP[t.status]?.label || t.status || '',
      priority: PRIORITY_MAP[t.priority]?.label || t.priority || '',
      due,
      created,
      completed,
      project: project?.name || '',
      assignees: assigneeNames,
      nucleo,
      taskType,
      tags: (t.tags || []).join('; '),
      clientEmail: t.clientEmail || '',
      goalLinked: (t.goalId || (Array.isArray(t.metaLinks) && t.metaLinks.length)) ? 'Sim' : 'Não',
    };
  });
}

async function exportTasksXls() {
  if (!filteredTasks.length) { toast.error('Nenhuma tarefa para exportar.'); return; }
  if (!window.XLSX) await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });

  const headers = ['Título', 'Status', 'Prioridade', 'Prazo', 'Criada em', 'Concluída em',
    'Projeto', 'Responsáveis', 'Núcleo', 'Tipo', 'Tags', 'E-mail cliente', 'Meta vinculada'];
  const rows = _buildTaskRows().map(r => [
    r.title, r.status, r.priority, r.due, r.created, r.completed,
    r.project, r.assignees, r.nucleo, r.taskType, r.tags, r.clientEmail, r.goalLinked,
  ]);

  const wb = window.XLSX.utils.book_new();
  const ws = window.XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [35, 14, 12, 12, 12, 12, 20, 25, 15, 15, 20, 25, 10].map(w => ({ wch: w }));
  window.XLSX.utils.book_append_sheet(wb, ws, 'Tarefas');
  window.XLSX.writeFile(wb, `primetour_tarefas_${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast.success('XLS exportado.');
}

const exportTasksPdf = withExportGuard(async function exportTasksPdf() {
  if (!filteredTasks.length) { toast.error('Nenhuma tarefa para exportar.'); return; }
  await loadJsPdf();

  const kit = createDoc({ orientation: 'portrait', margin: 14 });
  const { doc, W, H, M, CW, setFill, setText, setDraw, drawBar, drawChip, wrap } = kit;

  // Mapa priority → cor (visual)
  const PRIO_COL = {
    urgent: COL.red, high: COL.orange, medium: COL.blue, low: COL.muted,
  };

  // ── Capa compacta ───────────────────────────────────────────
  const total = filteredTasks.length;
  const byStatus = filteredTasks.reduce((acc, t) => {
    const key = t.status || 'not_started';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const doneCount = byStatus.done || 0;
  const progressCount = byStatus.in_progress || 0;
  const pctDone = total ? Math.round(doneCount * 100 / total) : 0;

  kit.drawCover({
    title: 'Tarefas',
    subtitle: 'PRIMETOUR  ·  Visão Operacional',
    meta: `${total} ${total === 1 ? 'tarefa' : 'tarefas'}  ·  ${new Date().toLocaleDateString('pt-BR')}`,
    compact: false,
  });

  // ── Strip de estatísticas por status ────────────────────────
  const statEntries = [
    { key: 'not_started', label: 'Não iniciadas', col: COL.muted },
    { key: 'in_progress', label: 'Em andamento', col: COL.blue   },
    { key: 'paused',      label: 'Pausadas',     col: COL.orange },
    { key: 'done',        label: 'Concluídas',   col: COL.green  },
  ];
  const boxW = (CW - 6) / statEntries.length;
  statEntries.forEach((s, i) => {
    const n = byStatus[s.key] || 0;
    const x = M + i * (boxW + 2);
    setFill(COL.bg); doc.roundedRect(x, kit.y, boxW, 18, 1.8, 1.8, 'F');
    setFill(s.col);  doc.rect(x, kit.y, boxW, 1.6, 'F');

    setText(COL.text); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text(String(n), x + 4, kit.y + 11);

    setText(s.col); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8);
    doc.text(txt(s.label.toUpperCase()), x + 4, kit.y + 15.5);
  });
  kit.addY(22);

  // Progresso agregado
  setText(COL.muted); doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
  doc.text(txt('PROGRESSO GERAL'), M, kit.y);
  setText(COL.text); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text(txt(`${pctDone}%`), W - M, kit.y, { align: 'right' });
  kit.addY(2.5);
  drawBar(M, kit.y, CW, pctDone, COL.green, 2.2);
  kit.addY(8);

  // ── Listagem em cards ───────────────────────────────────────
  const rows = _buildTaskRows();
  const tasks = filteredTasks;

  const PAD_L = 5.5;          // padding esquerdo interno (depois da barra)
  const PAD_T = 3.5;          // padding superior do card
  const PAD_B = 3.5;          // padding inferior do card
  const CHIP_FS = 6.4;
  const CHIP_H = CHIP_FS * 0.55 + 2.4;   // altura do chip (~6mm)
  const CHIP_TO_TITLE = 4;    // espaço entre chip e título
  const TITLE_TO_META = 2.5;  // espaço entre título e meta
  const TITLE_FS = 9.5;
  const META_FS = 7.6;
  const TITLE_LH = TITLE_FS * 0.45;
  const META_LH  = META_FS * 0.5;
  const CARD_GAP = 3.2;       // espaço entre cards

  tasks.forEach((t, i) => {
    const r = rows[i];
    const prioKey = (t.priority || 'medium').toLowerCase();
    const stKey   = (t.status || 'not_started').toLowerCase();
    const stStyle = STATUS_STYLE[stKey] || { bg: COL.muted, label: stKey.toUpperCase() };
    const prioCol = PRIO_COL[prioKey] || COL.muted;

    // Título: até 2 linhas. Meta: até 2 linhas (para caber responsáveis + extras).
    const titleLines = wrap(t.title || '(sem titulo)', CW - PAD_L * 2, TITLE_FS).slice(0, 2);
    const metaStr    = [r.assignees, r.nucleo, r.taskType, r.project]
      .filter(s => s && String(s).trim()).join(' · ');
    const metaLines  = metaStr
      ? wrap(metaStr, CW - PAD_L * 2, META_FS).slice(0, 2)
      : [];

    const chipBlockH = CHIP_H;
    const titleBlockH = titleLines.length * TITLE_LH;
    const metaBlockH  = metaLines.length ? (TITLE_TO_META + metaLines.length * META_LH) : 0;

    const cardH = PAD_T + chipBlockH + CHIP_TO_TITLE + titleBlockH + metaBlockH + PAD_B;

    kit.ensureSpace(cardH + CARD_GAP);

    // Card
    setFill(COL.white); setDraw(COL.border); doc.setLineWidth(0.2);
    doc.roundedRect(M, kit.y, CW, cardH, 1.8, 1.8, 'FD');
    setFill(prioCol); doc.rect(M, kit.y, 1.8, cardH, 'F');

    const cardTop = kit.y;

    // Linha superior: chip de status + chip META + prazo
    const chipY = cardTop + PAD_T;
    const stCh = drawChip(stStyle.label, M + PAD_L, chipY, stStyle.bg, COL.white, CHIP_FS, 2.2, 1.2);
    let chipX = M + PAD_L + stCh.w + 2.2;
    if (t.goalId || (Array.isArray(t.metaLinks) && t.metaLinks.length)) {
      const gw = drawChip('META', chipX, chipY, COL.gold, COL.white, CHIP_FS, 2.2, 1.2);
      chipX += gw.w + 2.2;
    }
    if (r.due) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); setText(COL.muted);
      doc.text(txt(`PRAZO ${r.due}`), W - M - 2, chipY + CHIP_H - 1.4, { align: 'right' });
    }

    // Título
    const titleY = chipY + chipBlockH + CHIP_TO_TITLE;
    setText(COL.text); doc.setFont('helvetica', 'bold'); doc.setFontSize(TITLE_FS);
    doc.text(titleLines, M + PAD_L, titleY);

    // Meta (responsáveis · núcleo · tipo · projeto)
    if (metaLines.length) {
      setText(COL.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(META_FS);
      const metaY = titleY + titleBlockH + TITLE_TO_META - 1.2;
      doc.text(metaLines, M + PAD_L, metaY);
    }

    kit.y = cardTop + cardH + CARD_GAP;
  });

  kit.drawFooter('PRIMETOUR  ·  Tarefas');
  doc.save(`primetour_tarefas_${new Date().toISOString().slice(0, 10)}.pdf`);
  toast.success('PDF exportado.');
});

/* \u2500\u2500\u2500 Inline edit (popovers em c\u00e9lulas da linha) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 * Click numa c\u00e9lula edit\u00e1vel (status/\u00e1rea/prazo/respons\u00e1veis) abre o
 * popover compartilhado e dispara updateTask single ao escolher op\u00e7\u00e3o.
 */
async function _openInlineEditPopover(anchor, field, task) {
  const { updateTask } = await import('../services/tasks.js');
  const popovers = await import('../components/taskPopovers.js');

  const onPick = async (patch, label) => {
    try {
      await updateTask(task.id, patch);
      // Atualiza local cache pra UI refletir sem aguardar fetch
      Object.assign(task, patch);
      const idx = allTasks.findIndex(t => t.id === task.id);
      if (idx >= 0) Object.assign(allTasks[idx], patch);
      const idx2 = filteredTasks.findIndex(t => t.id === task.id);
      if (idx2 >= 0) Object.assign(filteredTasks[idx2], patch);
      renderTaskList();
      toast.success(`Atualizado \u00b7 ${label}`);
    } catch (e) {
      toast.error('Falha: ' + (e.message || 'erro desconhecido'));
    }
  };

  switch (field) {
    case 'status':
      popovers.openStatusPopover(anchor, { onPick, currentValue: task.status });
      break;
    case 'area':
      popovers.openAreaPopover(anchor, { onPick, currentValue: task.requestingArea });
      break;
    case 'dueDate':
      popovers.openDueDatePopover(anchor, { onPick, currentValue: task.dueDate });
      break;
    case 'assignees':
      popovers.openAssigneesPopover(anchor, {
        onPick, currentValue: task.assignees, multi: true,
        allUsers: store.get('users') || [],
      });
      break;
    case 'typeStep':
      popovers.openTypeStepPopover(anchor, {
        onPick, task, allTaskTypes: pageTaskTypes,
      });
      break;
  }
}

/* \u2500\u2500\u2500 Bulk Action Bar wiring \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

/** Atualiza a UI: linhas selecionadas + barra de a\u00e7\u00f5es + master-checkbox. */
function _refreshBulkUi() {
  // Atualiza visual de cada linha (border dourada + checkbox state)
  document.querySelectorAll('.task-row[data-task-id]').forEach(row => {
    const id = row.dataset.taskId;
    const sel = _selectedTaskIds.has(id);
    row.classList.toggle('bulk-selected', sel);
    const cb = row.querySelector('.bulk-checkbox');
    if (cb) cb.checked = sel;
  });
  // Master-checkbox: marca se TODAS as filteredTasks est\u00e3o selecionadas
  const master = document.getElementById('bulk-select-all');
  if (master) {
    const allSelected = filteredTasks.length > 0 &&
      filteredTasks.every(t => _selectedTaskIds.has(t.id));
    master.checked = allSelected;
    master.indeterminate = !allSelected && _selectedTaskIds.size > 0;
  }
  // Atualiza ou monta a action bar
  if (!_bulkBar) {
    import('../components/bulkActionBar.js').then(({ mountBulkActionBar }) => {
      _bulkBar = mountBulkActionBar({
        getSelectedIds:   () => [..._selectedTaskIds],
        getSelectedTasks: () => allTasks.filter(t => _selectedTaskIds.has(t.id)),
        onClear: () => {
          _selectedTaskIds.clear();
          _refreshBulkUi();
        },
        onAfterUpdate: async () => {
          _selectedTaskIds.clear();
          await fetchTasks().then(ts => { allTasks = ts; }).catch(() => {});
          applyFilters?.();
          renderTaskList();
          _refreshBulkUi();
        },
        allProjects,
        allUsers: store.get('users') || [],
      });
      _bulkBar.update();
    });
  } else {
    _bulkBar.update();
  }
}

/* \u2500\u2500\u2500 Cleanup \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
export function destroyTasksPage() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  _delegationAttached = false;
  _selectedTaskIds.clear();
  if (_bulkBar) { _bulkBar.destroy(); _bulkBar = null; }
}

/* \u2500\u2500\u2500 CSAT prompt on task completion \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500*/
