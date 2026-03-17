/**
 * PRIMETOUR — Calendar Page
 * View padrão + View esteira (por tipo de tarefa)
 */

import { fetchTasks, PRIORITY_MAP, STATUS_MAP, REQUESTING_AREAS } from '../services/tasks.js';
import { openTaskModal } from '../components/taskModal.js';
import { store }               from '../store.js';
import { openCardPrefsModal }  from '../components/cardPrefsModal.js';
import { renderCardFields }    from '../services/cardPrefs.js';
import { toast }         from '../components/toast.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const PT_MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const PT_DAYS   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

let allTasks    = [];
let currentDate = new Date();
let activeView  = 'standard'; // 'standard' | 'pipeline'
let pipelineTypeId = '';

export async function renderCalendar(container) {
  const taskTypes = store.get('taskTypes') || [];
  const pipelineTypes = taskTypes.filter(t => t.fields?.length > 0 || t.steps?.length > 0);
  if (!pipelineTypeId && pipelineTypes.length) pipelineTypeId = pipelineTypes[0].id;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Calendário</h1>
        <p class="page-subtitle">Tarefas e prazos por data</p>
      </div>
      <div class="page-header-actions">
        <!-- View switcher -->
        <div style="display:flex;border:1px solid var(--border-subtle);border-radius:var(--radius-md);overflow:hidden;">
          <button class="view-switch-btn ${activeView==='standard'?'active':''}" data-view="standard"
            style="padding:6px 14px;border:none;cursor:pointer;font-size:0.8125rem;
            background:${activeView==='standard'?'var(--brand-gold)':'var(--bg-surface)'};
            color:${activeView==='standard'?'#000':'var(--text-secondary)'};transition:all 0.15s;">
            ◷ Padrão
          </button>
          <button class="view-switch-btn ${activeView==='pipeline'?'active':''}" data-view="pipeline"
            style="padding:6px 14px;border:none;cursor:pointer;font-size:0.8125rem;
            background:${activeView==='pipeline'?'var(--brand-gold)':'var(--bg-surface)'};
            color:${activeView==='pipeline'?'#000':'var(--text-secondary)'};transition:all 0.15s;">
            ▶ Esteira
          </button>
        </div>

        ${activeView === 'pipeline' && pipelineTypes.length > 1 ? `
          <select class="filter-select" id="cal-type-filter" style="min-width:160px;">
            ${pipelineTypes.map(t =>
              `<option value="${t.id}" ${pipelineTypeId===t.id?'selected':''}>${esc(t.icon||'')} ${esc(t.name)}</option>`
            ).join('')}
          </select>
        ` : ''}

        <button class="btn btn-primary" id="cal-new-task-btn">+ Nova Tarefa</button>
        <button class="btn btn-ghost btn-icon" id="cal-prefs-btn" title="Personalizar cards" style="font-size:1rem;">⚙</button>
      </div>
    </div>
    <div id="calendar-content">
      <div class="task-empty"><div class="task-empty-icon">⟳</div><div class="task-empty-title">Carregando...</div></div>
    </div>
  `;

  // View switch
  container.querySelectorAll('.view-switch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeView = btn.dataset.view;
      renderCalendar(container);
    });
  });

  document.getElementById('cal-type-filter')?.addEventListener('change', e => {
    pipelineTypeId = e.target.value;
    renderCalendar(container);
  });

  document.getElementById('cal-new-task-btn')?.addEventListener('click', () => {
    const typeId = activeView === 'pipeline' ? pipelineTypeId : null;
    openTaskModal({ typeId, onSave: () => load() });
  });
  document.getElementById('cal-prefs-btn')?.addEventListener('click', () =>
    openCardPrefsModal(() => { if (activeView==='pipeline') renderPipeline(); else renderMonth(); })
  );

  await load();
}

async function load() {
  try {
    allTasks = await fetchTasks();
    if (activeView === 'pipeline') renderPipeline();
    else renderMonth();
  } catch(e) {
    toast.error('Erro ao carregar tarefas.');
  }
}

/* ─── View Padrão ────────────────────────────────────────── */
function renderMonth() {
  const content = document.getElementById('calendar-content');
  if (!content) return;

  const year  = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays    = new Date(year, month, 0).getDate();
  const today       = new Date();

  const taskMap = {};
  allTasks.forEach(task => {
    if (!task.dueDate) return;
    const d = task.dueDate?.toDate ? task.dueDate.toDate() : new Date(task.dueDate);
    if (d.getFullYear() !== year || d.getMonth() !== month) return;
    const key = d.getDate();
    if (!taskMap[key]) taskMap[key] = [];
    taskMap[key].push(task);
  });

  const cells = [];
  for (let i = firstDay - 1; i >= 0; i--) cells.push({ day: prevDays - i, current: false });
  for (let d = 1; d <= daysInMonth; d++)  cells.push({ day: d, current: true });
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++)    cells.push({ day: d, current: false });

  content.innerHTML = `
    <div class="calendar-wrapper">
      <div class="calendar-header">
        <div class="calendar-nav">
          <button class="calendar-nav-btn" id="cal-prev">◀</button>
          <button class="btn btn-ghost btn-sm" id="cal-today">Hoje</button>
          <button class="calendar-nav-btn" id="cal-next">▶</button>
        </div>
        <div class="calendar-month-title">${PT_MONTHS[month]} ${year}</div>
        <div style="font-size:0.8125rem;color:var(--text-muted);">
          ${Object.values(taskMap).flat().length} tarefas este mês
        </div>
      </div>

      <div class="calendar-grid">
        ${PT_DAYS.map(d=>`<div class="calendar-day-label">${d}</div>`).join('')}
        ${cells.map(cell => {
          const tasks   = cell.current ? (taskMap[cell.day] || []) : [];
          const isToday = cell.current && today.getDate()===cell.day &&
            today.getMonth()===month && today.getFullYear()===year;
          const MAX_SHOW = 3;
          const shown = tasks.slice(0, MAX_SHOW);
          const extra = tasks.length - MAX_SHOW;

          return `<div class="calendar-cell ${!cell.current?'other-month':''} ${isToday?'today':''}"
            data-date="${cell.current?`${year}-${String(month+1).padStart(2,'0')}-${String(cell.day).padStart(2,'0')}`:'' }">
            <div class="calendar-date-num">${cell.day}</div>
            ${shown.map(t => {
              const prio  = PRIORITY_MAP[t.priority];
              const color = prio?.color || '#6B7280';
              return `<div class="calendar-task-pill" data-task-id="${t.id}"
                style="background:${color}20;color:${color};border-left:2px solid ${color};padding:2px 4px;">
                <div style="font-size:0.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                  ${esc(t.title.slice(0,22))}${t.title.length>22?'…':''}
                </div>
                ${renderCardFields(t, { compact:true })}
              </div>`;
            }).join('')}
            ${extra>0 ? `<div class="calendar-more" data-date="${year}-${String(month+1).padStart(2,'0')}-${String(cell.day).padStart(2,'0')}">+${extra} mais</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>
    <div id="cal-side-panel" style="display:none;margin-top:16px;"></div>
  `;

  _bindMonthEvents(taskMap, year, month);
}

function _bindMonthEvents(taskMap, year, month) {
  const content = document.getElementById('calendar-content');
  document.getElementById('cal-prev')?.addEventListener('click', () => {
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    renderMonth();
  });
  document.getElementById('cal-next')?.addEventListener('click', () => {
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
    renderMonth();
  });
  document.getElementById('cal-today')?.addEventListener('click', () => {
    currentDate = new Date(); renderMonth();
  });

  content?.querySelectorAll('.calendar-task-pill[data-task-id]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const task = allTasks.find(t=>t.id===el.dataset.taskId);
      if (task) openTaskModal({ taskData: task, onSave: () => load() });
    });
  });

  content?.querySelectorAll('.calendar-cell[data-date]').forEach(cell => {
    cell.addEventListener('click', e => {
      if (e.target.closest('.calendar-task-pill') || e.target.closest('.calendar-more')) return;
      if (!cell.dataset.date) return;
      showDayPanel(cell.dataset.date, taskMap);
    });
  });

  content?.querySelectorAll('.calendar-more').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      showDayPanel(el.dataset.date, taskMap);
    });
  });
}

/* ─── View Esteira ───────────────────────────────────────── */
function renderPipeline() {
  const content = document.getElementById('calendar-content');
  if (!content) return;

  const taskTypes  = store.get('taskTypes') || [];
  const taskType   = taskTypes.find(t => t.id === pipelineTypeId);
  const year       = currentDate.getFullYear();
  const month      = currentDate.getMonth();

  // Filter tasks of this type
  const typeTasks = allTasks.filter(t =>
    (t.typeId === pipelineTypeId || t.type === taskType?.name?.toLowerCase()) &&
    t.status !== 'cancelled'
  );

  // Map by due date
  const taskMap = {};
  typeTasks.forEach(task => {
    const dateField = task.dueDate || task.startDate;
    if (!dateField) return;
    const d = dateField?.toDate ? dateField.toDate() : new Date(dateField);
    if (d.getFullYear() !== year || d.getMonth() !== month) return;
    const key = d.getDate();
    if (!taskMap[key]) taskMap[key] = [];
    taskMap[key].push(task);
  });

  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays    = new Date(year, month, 0).getDate();
  const today       = new Date();

  const cells = [];
  for (let i = firstDay - 1; i >= 0; i--) cells.push({ day: prevDays - i, current: false });
  for (let d = 1; d <= daysInMonth; d++)  cells.push({ day: d, current: true });
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++)    cells.push({ day: d, current: false });

  content.innerHTML = `
    <!-- Navigation -->
    <div class="calendar-wrapper">
      <div class="calendar-header">
        <div class="calendar-nav">
          <button class="calendar-nav-btn" id="cal-prev">◀</button>
          <button class="btn btn-ghost btn-sm" id="cal-today">Hoje</button>
          <button class="calendar-nav-btn" id="cal-next">▶</button>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          <div class="calendar-month-title">${PT_MONTHS[month]} ${year}</div>
          ${taskType ? `
            <div style="display:flex;align-items:center;gap:6px;padding:3px 10px;
              border-radius:var(--radius-full);background:${taskType.color||'#D4A843'}18;
              border:1px solid ${taskType.color||'#D4A843'}44;font-size:0.8125rem;
              color:${taskType.color||'#D4A843'};">
              ${taskType.icon||'📋'} ${esc(taskType.name)}
            </div>
          ` : ''}
        </div>
        <div style="font-size:0.8125rem;color:var(--text-muted);">
          ${typeTasks.length} tarefa${typeTasks.length!==1?'s':''} · ${Object.values(taskMap).flat().length} este mês
        </div>
      </div>

      <!-- Calendar grid — pipeline style -->
      <div class="calendar-grid">
        ${PT_DAYS.map(d=>`<div class="calendar-day-label">${d}</div>`).join('')}
        ${cells.map(cell => {
          const tasks   = cell.current ? (taskMap[cell.day] || []) : [];
          const isToday = cell.current && today.getDate()===cell.day &&
            today.getMonth()===month && today.getFullYear()===year;

          return `<div class="calendar-cell ${!cell.current?'other-month':''} ${isToday?'today':''}"
            style="${tasks.length>0?'background:var(--bg-surface);':''}"
            data-date="${cell.current?`${year}-${String(month+1).padStart(2,'0')}-${String(cell.day).padStart(2,'0')}`:'' }">
            <div class="calendar-date-num">${cell.day}</div>
            ${tasks.map(t => {
              const status    = t.status || 'not_started';
              const isDone    = status === 'done';
              const isOverdue = !isDone && t.dueDate && (() => {
                const dd = t.dueDate?.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
                return dd < today;
              })();
              const typeColor = taskType?.color || '#D4A843';
              const dotColor  = isDone ? '#22C55E' : isOverdue ? '#EF4444' : typeColor;

              // Step label (from customFields if available)
              const stepId   = t.customFields?.currentStep;
              const stepDef  = (taskType?.steps||[]).find(s => s.id === stepId);

              return `<div class="calendar-task-pill pipeline-pill" data-task-id="${t.id}"
                style="background:${dotColor}15;border-left:3px solid ${dotColor};
                  padding:4px 6px;margin-bottom:3px;border-radius:3px;cursor:pointer;">
                <!-- Title -->
                <div style="font-size:0.75rem;font-weight:600;color:var(--text-primary);
                  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:2px;"
                  title="${esc(t.title)}">
                  ${esc(t.title.slice(0,24))}${t.title.length>24?'…':''}
                </div>
                ${renderCardFields(t, { compact:true })}
              </div>`;
            }).join('')}
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Legend -->
    <div style="display:flex;gap:16px;margin-top:16px;flex-wrap:wrap;font-size:0.75rem;color:var(--text-muted);">
      <span style="display:flex;align-items:center;gap:5px;">
        <span style="width:10px;height:10px;border-radius:2px;background:#22C55E;display:inline-block;"></span> Concluída
      </span>
      <span style="display:flex;align-items:center;gap:5px;">
        <span style="width:10px;height:10px;border-radius:2px;background:#EF4444;display:inline-block;"></span> Atrasada
      </span>
      <span style="display:flex;align-items:center;gap:5px;">
        <span style="width:10px;height:10px;border-radius:2px;background:${taskType?.color||'#D4A843'};display:inline-block;"></span> Em andamento
      </span>
    </div>

    <!-- Side panel -->
    <div id="cal-side-panel" style="display:none;margin-top:16px;"></div>
  `;

  // Bind events
  document.getElementById('cal-prev')?.addEventListener('click', () => {
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    renderPipeline();
  });
  document.getElementById('cal-next')?.addEventListener('click', () => {
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
    renderPipeline();
  });
  document.getElementById('cal-today')?.addEventListener('click', () => {
    currentDate = new Date(); renderPipeline();
  });

  content.querySelectorAll('.pipeline-pill[data-task-id]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const task = allTasks.find(t=>t.id===el.dataset.taskId);
      if (task) openTaskModal({ taskData: task, onSave: () => load() });
    });
  });

  content.querySelectorAll('.calendar-cell[data-date]').forEach(cell => {
    cell.addEventListener('click', e => {
      if (e.target.closest('.pipeline-pill')) return;
      if (!cell.dataset.date) return;
      showDayPanel(cell.dataset.date, taskMap);
    });
  });
}

/* ─── Day panel ──────────────────────────────────────────── */
function showDayPanel(dateStr, taskMap) {
  const panel = document.getElementById('cal-side-panel');
  if (!panel) return;
  const [y,m,d] = dateStr.split('-').map(Number);
  const tasks   = taskMap[d] || [];

  if (!tasks.length) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-title">
          ${d} de ${PT_MONTHS[m-1]} · ${tasks.length} tarefa${tasks.length!==1?'s':''}
        </div>
        <button class="btn btn-ghost btn-sm" id="close-panel">✕</button>
      </div>
      <div class="card-body" style="padding:0 16px 12px;display:flex;flex-direction:column;gap:10px;">
        ${tasks.map(t => {
          const prio    = PRIORITY_MAP[t.priority];
          const color   = prio?.color || '#6B7280';
          const isDone  = t.status === 'done';
          const taskTypes = store.get('taskTypes') || [];
          const tt      = taskTypes.find(x => x.id === t.typeId);
          return `
            <div class="cal-day-task" data-tid="${t.id}"
              style="display:flex;align-items:flex-start;gap:10px;padding:10px;
              border-radius:var(--radius-md);background:var(--bg-surface);
              border:1px solid var(--border-subtle);cursor:pointer;
              opacity:${isDone?0.6:1};">
              <div style="width:3px;align-self:stretch;border-radius:2px;background:${color};flex-shrink:0;"></div>
              <div style="flex:1;min-width:0;">
                <div style="font-size:0.875rem;font-weight:500;color:var(--text-primary);
                  ${isDone?'text-decoration:line-through;':''}">
                  ${esc(t.title)}
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;font-size:0.75rem;color:var(--text-muted);">
                  ${t.requestingArea ? `<span>📍 ${esc(t.requestingArea)}</span>` : ''}
                  ${t.dueDate ? `<span>📅 ${fmtShort(t.dueDate)}</span>` : ''}
                  ${tt ? `<span>${tt.icon||'📋'} ${esc(tt.name)}</span>` : ''}
                  ${t.status ? `<span style="color:${color};">${prio?.label||t.status}</span>` : ''}
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>
  `;

  document.getElementById('close-panel')?.addEventListener('click', () => {
    panel.style.display = 'none';
  });
  panel.querySelectorAll('.cal-day-task[data-tid]').forEach(el => {
    el.addEventListener('click', () => {
      const task = allTasks.find(t=>t.id===el.dataset.tid);
      if (task) openTaskModal({ taskData: task, onSave: () => load() });
    });
  });
}

/* ─── Helpers ────────────────────────────────────────────── */
function fmtShort(ts) {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
}

/* ─── Public calendar data for portal ───────────────────── */
export async function getNewsletterCalendarData(year, month) {
  const tasks = await fetchTasks();
  const newsletters = tasks.filter(t =>
    (t.typeId === 'newsletter' || t.type === 'newsletter') &&
    t.status !== 'cancelled'
  );

  const map = {};
  newsletters.forEach(t => {
    const dateField = t.dueDate || t.startDate;
    if (!dateField) return;
    const d = dateField?.toDate ? dateField.toDate() : new Date(dateField);
    if (d.getFullYear() !== year || d.getMonth() !== month) return;
    const key = d.getDate();
    if (!map[key]) map[key] = [];
    map[key].push({
      title:          t.title,
      dueDate:        fmtShort(t.dueDate || t.startDate),
      requestingArea: t.requestingArea || '',
      status:         t.status,
      outOfCalendar:  t.outOfCalendar || t.customFields?.outOfCalendar || false,
    });
  });
  return map;
}
