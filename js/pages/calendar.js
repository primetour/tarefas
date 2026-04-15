/**
 * PRIMETOUR — Calendar Page
 * Views: Mês | Semana | Dia  ×  Padrão | Esteira
 * Suporte a schedule slots (agenda prévia dos tipos de tarefa)
 */

import { fetchTasks, updateTask, PRIORITY_MAP }  from '../services/tasks.js';
import { openTaskModal }             from '../components/taskModal.js';
import { store }                     from '../store.js';
import {
  renderFilterBar, bindFilterBar, buildFilterFn,
} from '../components/filterBar.js';
import { openCardPrefsModal }        from '../components/cardPrefsModal.js';
import { renderCardFields }          from '../services/cardPrefs.js';
import { toast }                     from '../components/toast.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const PT_MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const PT_DAYS_L = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const PT_DAYS_S = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const HOURS     = Array.from({length:24},(_,i)=>i); // 0-23

let allTasks       = [];
let currentDate    = new Date();
let activeView     = 'standard';  // 'standard' | 'pipeline'
let activeGran     = 'month';     // 'month' | 'week' | 'day'
let pipelineTypeId = '';
let calFilterState = { sector: null, type: null, project: null, area: null, assignee: null };

function initCalFilterState() {
  if (!calFilterState.sector) {
    const sectors = store.getVisibleSectors();
    if (sectors && sectors.length === 1) calFilterState.sector = sectors[0];
  }
}

/* ─── Main render ────────────────────────────────────────── */
export async function renderCalendar(container) {
  const taskTypes    = store.get('taskTypes') || [];
  const userSectors  = store.getVisibleSectors();
  const pipeTypes    = taskTypes.filter(t =>
    ((t.fields?.length||0)+(t.steps?.length||0)+(t.scheduleSlots?.length||0) > 0) &&
    (!t.sector || userSectors === null || userSectors.includes(t.sector))
  );
  if (!pipelineTypeId && pipeTypes.length) pipelineTypeId = pipeTypes[0].id;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Calendário</h1>
        <p class="page-subtitle">
          ${(() => {
            if (activeView === 'standard') return 'Tarefas e agenda por data';
            const activeType = (store.get('taskTypes')||[]).find(t => t.id === pipelineTypeId);
            const sectorLabel = activeType?.sector || calFilterState.sector || '';
            const typeLabel   = activeType?.name   || '';
            if (sectorLabel && typeLabel) return `🏢 ${esc(sectorLabel)} › ${esc(typeLabel)}`;
            if (typeLabel)   return `▶ ${esc(typeLabel)}`;
            if (activeView === 'agenda') return '◌ Agenda prévia';
            return 'Esteira de produção';
          })()}
        </p>
      </div>
      <div class="page-header-actions" style="gap:8px;flex-wrap:wrap;">

        <!-- Granularity switcher: Mês | Semana | Dia -->
        <div style="display:flex;border:1px solid var(--border-subtle);border-radius:var(--radius-md);overflow:hidden;">
          ${[['month','Mês'],['week','Semana'],['day','Dia']].map(([g,l])=>`
            <button class="gran-btn" data-gran="${g}" style="padding:6px 12px;border:none;cursor:pointer;font-size:0.8125rem;
              background:${activeGran===g?'var(--brand-gold)':'var(--bg-surface)'};
              color:${activeGran===g?'#000':'var(--text-secondary)'};transition:all 0.15s;">${l}</button>
          `).join('')}
        </div>

        <!-- Mode: Padrão | Esteira | Agenda prévia -->
        <div style="display:flex;border:1px solid var(--border-subtle);border-radius:var(--radius-md);overflow:hidden;">
          ${[['standard','◷ Padrão'],['pipeline','▶ Esteira'],['agenda','◌ Agenda']].map(([v,l])=>`
            <button class="view-switch-btn" data-view="${v}" style="padding:6px 12px;border:none;cursor:pointer;font-size:0.8125rem;
              background:${activeView===v?'var(--brand-gold)':'var(--bg-surface)'};
              color:${activeView===v?'#000':'var(--text-secondary)'};transition:all 0.15s;">${l}</button>
          `).join('')}
        </div>

        ${(activeView==='pipeline'||activeView==='agenda') && pipeTypes.length>1?`
          <select class="filter-select" id="cal-type-filter" style="min-width:150px;">
            ${pipeTypes.map(t=>`<option value="${t.id}" ${pipelineTypeId===t.id?'selected':''}>${esc(t.icon||'')} ${esc(t.name)}</option>`).join('')}
          </select>
        `:''}

        <button class="btn btn-primary" id="cal-new-task-btn">+ Nova Tarefa</button>
        <button class="btn btn-ghost btn-icon" id="cal-prefs-btn" title="Personalizar cards" style="font-size:1rem;">⚙</button>
      </div>
    </div>
    <div id="cal-filter-bar" style="padding:0 2px;"></div>
    <div id="calendar-content">
      <div class="task-empty"><div class="task-empty-icon">⟳</div></div>
    </div>
  `;

  // Bindings
  container.querySelectorAll('.gran-btn').forEach(btn =>
    btn.addEventListener('click', () => { activeGran = btn.dataset.gran; renderCalendar(container); })
  );
  container.querySelectorAll('.view-switch-btn').forEach(btn =>
    btn.addEventListener('click', () => { activeView = btn.dataset.view; renderCalendar(container); })
  );
  document.getElementById('cal-type-filter')?.addEventListener('change', e => {
    pipelineTypeId = e.target.value; renderCalendar(container);
  });
  document.getElementById('cal-new-task-btn')?.addEventListener('click', () => {
    const typeId = activeView==='pipeline' ? pipelineTypeId : null;
    openTaskModal({ typeId, onSave: () => load() });
  });
  document.getElementById('cal-prefs-btn')?.addEventListener('click', () =>
    openCardPrefsModal(() => activeView==='agenda' ? renderAgendaView() : render())
  );

  initCalFilterState();
  renderFilters();
  await load();
}

async function load() {
  try { allTasks = await fetchTasks(); } catch(e) { toast.error('Erro ao carregar.'); }
  if (activeView==='agenda') renderAgendaView();
  else render();
}

function renderFilters() {
  const wrap = document.getElementById('cal-filter-bar');
  if (!wrap) return;
  const projects  = store.get('projects') || [];
  const taskTypes = store.get('taskTypes') || [];
  wrap.innerHTML = renderFilterBar({
    show: ['sector','type','project','area','assignee'],
    state: calFilterState,
    taskTypes, projects,
    users: store.get('users') || [],
  });
  bindFilterBar(wrap, calFilterState, () => render());
}

function render() {
  if (activeGran==='month') renderMonth();
  else if (activeGran==='week') renderWeek();
  else renderDay();
}

function renderAgendaView() {
  // Agenda prévia: shows only slots (no real tasks), all granularities
  if (activeGran==='month') renderAgendaMonth();
  else if (activeGran==='week') renderAgendaWeek();
  else renderAgendaDay();
}

/* ─── Slot helpers ───────────────────────────────────────── */
function getSlotsForDate(date, typeId = null) {
  const taskTypes = store.get('taskTypes') || [];
  const all = [];
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
  const dow = date.getDay();
  const iso = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

  // Filter by typeId if specified, otherwise by user's visible sectors
  let typesToCheck;
  if (typeId) {
    typesToCheck = taskTypes.filter(t => t.id === typeId);
  } else {
    const visibleSectors = store.getVisibleSectors();
    typesToCheck = visibleSectors === null
      ? taskTypes
      : taskTypes.filter(t => !t.sector || visibleSectors.includes(t.sector));
  }

  typesToCheck.forEach(t => {
    (t.scheduleSlots||[]).filter(s=>s.active!==false).forEach(slot => {
      let matches = false;
      if (slot.recurrence==='weekly')            matches = slot.weekDay === dow;
      else if (slot.recurrence==='monthly_days') matches = (slot.monthDays||[]).includes(d);
      else if (slot.recurrence==='custom')       matches = (slot.customDates||[]).includes(iso);
      if (matches) all.push({ ...slot, taskType: t });
    });
  });
  return all;
}

/**
 * Match slot → task on same date.
 * Rules (OR): title substring match (case-insensitive) OR same typeId + same variationId.
 */
function findTaskForSlot(slot, dayTasks) {
  if (!dayTasks?.length) return null;
  const slotTitle = (slot.title || '').toLowerCase().trim();
  return dayTasks.find(t => {
    const tTitle = (t.title || '').toLowerCase().trim();
    if (slotTitle && tTitle && (tTitle.includes(slotTitle) || slotTitle.includes(tTitle))) return true;
    if (slot.taskType?.id && t.typeId === slot.taskType.id && slot.variationId && t.variationId === slot.variationId) return true;
    return false;
  }) || null;
}

function slotPill(slot, compact=false, matchedTask=null) {
  // Filled (matched to task): single green line with task fields, behaves like task click
  if (matchedTask) {
    const done    = matchedTask.status === 'done';
    const label   = compact
      ? `${esc(matchedTask.title.slice(0,22))}${matchedTask.title.length>22?'…':''}`
      : esc(matchedTask.title);
    return `<div class="cal-task-pill" data-task-id="${matchedTask.id}" draggable="true"
      style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.4);
        color:var(--color-success, #16A34A);border-radius:3px;padding:3px 6px;
        margin-bottom:2px;cursor:pointer;opacity:${done?0.55:1};
        overflow:hidden;text-overflow:ellipsis;"
      title="✓ Agenda preenchida: ${esc(matchedTask.title)}">
      <div style="font-size:0.75rem;line-height:1.3;font-weight:500;
        ${done?'text-decoration:line-through;':''}">✓ ${label}</div>
      ${renderCardFields(matchedTask,{compact:true,onlyFields:['requestingArea','taskType','variationName']})}
    </div>`;
  }
  // Empty (no task yet): dotted pill → opens new task modal prefilled from slot
  const color = slot.color || slot.taskType?.color || '#6B7280';
  const label = compact
    ? `${esc(slot.title.slice(0,20))}${slot.title.length>20?'…':''}`
    : esc(slot.title);
  return `<div class="cal-slot-pill" data-slot-id="${slot.id}"
    data-type-id="${slot.taskType?.id||''}"
    data-slot='${JSON.stringify({ title:slot.title, requestingArea:slot.requestingArea||'', variationId:slot.variationId||'' })}'
    style="background:transparent;border:1.5px dashed ${color};color:${color};
      border-radius:3px;padding:2px 5px;font-size:0.6875rem;cursor:pointer;
      margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      opacity:0.85;"
    title="Agenda vaga: ${esc(slot.title)}${slot.requestingArea?' · '+slot.requestingArea:''}">
    ◌ ${label}
  </div>`;
}

function bindSlotClicks(container) {
  container.querySelectorAll('.cal-slot-pill').forEach(pill => {
    pill.addEventListener('click', e => {
      e.stopPropagation();
      try {
        const data   = JSON.parse(pill.dataset.slot);
        const typeId = pill.dataset.typeId || null;
        openTaskModal({ typeId, taskData: {
          title:          data.title || '',
          requestingArea: data.requestingArea || '',
          variationId:    data.variationId || null,
          status:         'not_started',
          assignees:[], tags:[], subtasks:[], comments:[], customFields:{},
        }, onSave: () => load() });
      } catch(e) {}
    });
  });
}

/* ─── Calendar Drag & Drop ──────────────────────────────── */
let _calDragTaskId = null;

function _bindCalendarDragDrop(container) {
  // Drag start
  container.addEventListener('dragstart', e => {
    const pill = e.target.closest('.cal-task-pill[data-task-id]');
    if (!pill) return;
    _calDragTaskId = pill.dataset.taskId;
    pill.style.opacity = '0.4';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', _calDragTaskId);
  });

  // Drag end
  container.addEventListener('dragend', e => {
    const pill = e.target.closest('.cal-task-pill[data-task-id]');
    if (pill) pill.style.opacity = '';
    _calDragTaskId = null;
    container.querySelectorAll('[data-date].cal-drag-over').forEach(c => c.classList.remove('cal-drag-over'));
  });

  // Drag over day cells
  container.addEventListener('dragover', e => {
    if (!_calDragTaskId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const cell = e.target.closest('[data-date]');
    container.querySelectorAll('[data-date].cal-drag-over').forEach(c => {
      if (c !== cell) c.classList.remove('cal-drag-over');
    });
    if (cell && cell.dataset.date) cell.classList.add('cal-drag-over');
  });

  // Drop on day cell
  container.addEventListener('drop', async e => {
    e.preventDefault();
    if (!_calDragTaskId) return;
    const cell = e.target.closest('[data-date]');
    if (!cell || !cell.dataset.date) return;

    const newDateStr = cell.dataset.date; // YYYY-MM-DD
    const task = allTasks.find(t => t.id === _calDragTaskId);
    if (!task) return;

    try {
      const newDate = new Date(newDateStr + 'T12:00:00');
      await updateTask(_calDragTaskId, { dueDate: newDate });
      toast.success(`Prazo alterado para ${String(newDate.getDate()).padStart(2,'0')}/${String(newDate.getMonth()+1).padStart(2,'0')}`);
      await load();
    } catch (err) {
      toast.error('Erro ao mover: ' + err.message);
    }

    _calDragTaskId = null;
    container.querySelectorAll('[data-date].cal-drag-over').forEach(c => c.classList.remove('cal-drag-over'));
  });
}

function fmtShort(ts) {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
}

/* ─── Shared nav bar ─────────────────────────────────────── */
function navBar(titleHTML, statsHTML='') {
  return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
    <div style="display:flex;gap:4px;">
      <button class="btn btn-ghost btn-sm" id="cal-prev">◀</button>
      <button class="btn btn-ghost btn-sm" id="cal-today">Hoje</button>
      <button class="btn btn-ghost btn-sm" id="cal-next">▶</button>
    </div>
    <div style="font-size:1rem;font-weight:600;color:var(--text-primary);">${titleHTML}</div>
    ${statsHTML?`<div style="font-size:0.8125rem;color:var(--text-muted);margin-left:auto;">${statsHTML}</div>`:''}
  </div>`;
}

function taskPill(task, compact=false) {
  const prio  = PRIORITY_MAP[task.priority]||{};
  const color = prio.color||'#6B7280';
  const done  = task.status==='done';
  return `<div class="cal-task-pill" data-task-id="${task.id}" draggable="true"
    style="background:${color}20;border-left:3px solid ${color};border-radius:3px;
      padding:3px 6px;margin-bottom:2px;cursor:grab;opacity:${done?0.5:1};">
    <div style="font-size:0.75rem;color:var(--text-primary);line-height:1.3;
      ${done?'text-decoration:line-through;':''}">
      ${esc(task.title.slice(0,compact?24:32))}${task.title.length>(compact?24:32)?'…':''}
    </div>
    ${renderCardFields(task,{compact:true,onlyFields:['requestingArea','taskType','variationName']})}
  </div>`;
}

/* ═══════════════════════════════════════════════════════════
   MONTH VIEW
═══════════════════════════════════════════════════════════ */
function renderMonth() {
  const el = document.getElementById('calendar-content');
  if (!el) return;

  const y = currentDate.getFullYear(), m = currentDate.getMonth();
  const firstDay = new Date(y,m,1).getDay();
  const daysInM  = new Date(y,m+1,0).getDate();
  const prevDays = new Date(y,m,0).getDate();
  const today    = new Date();

  const activeType = activeView==='pipeline'
    ? (store.get('taskTypes')||[]).find(t=>t.id===pipelineTypeId)
    : null;

  const monthFilterFn = buildFilterFn(activeView==='standard' ? calFilterState : {});

  // Map tasks
  const taskMap = {};
  allTasks.filter(t => {
    if (activeType && t.typeId!==pipelineTypeId) return false;
    if (!monthFilterFn(t)) return false;
    const df = t.dueDate||t.startDate;
    if (!df) return false;
    const d = df?.toDate?df.toDate():new Date(df);
    return d.getFullYear()===y && d.getMonth()===m;
  }).forEach(t => {
    const df = t.dueDate||t.startDate;
    const d  = df?.toDate?df.toDate():new Date(df);
    const k  = d.getDate();
    if (!taskMap[k]) taskMap[k]=[];
    taskMap[k].push(t);
  });

  const cells = [];
  for (let i=firstDay-1;i>=0;i--) cells.push({day:prevDays-i,cur:false});
  for (let d=1;d<=daysInM;d++)    cells.push({day:d,cur:true});
  while (cells.length%7!==0)       cells.push({day:cells.length-firstDay-daysInM+1,cur:false});

  el.innerHTML = navBar(
    `${PT_MONTHS[m]} ${y}`,
    `${Object.values(taskMap).flat().length} tarefa${Object.values(taskMap).flat().length!==1?'s':''} este mês`
  ) + `
  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--border-subtle);border:1px solid var(--border-subtle);border-radius:var(--radius-md);">
    ${PT_DAYS_S.map(d=>`<div style="padding:6px;text-align:center;font-size:0.75rem;font-weight:600;
      color:var(--text-muted);background:var(--bg-deepest);">${d}</div>`).join('')}
    ${cells.map(cell=>{
      const tasks = cell.cur?(taskMap[cell.day]||[]):[];
      const slots = cell.cur?getSlotsForDate(new Date(y,m,cell.day), activeView==='pipeline'?pipelineTypeId:null):[];
      const isToday=cell.cur&&today.getDate()===cell.day&&today.getMonth()===m&&today.getFullYear()===y;
      const dateStr=cell.cur?`${y}-${String(m+1).padStart(2,'0')}-${String(cell.day).padStart(2,'0')}`:'' ;
      // Match slots to tasks (unify visual)
      const matchedTaskIds = new Set();
      const slotRenders = slots.map(s => {
        const matched = findTaskForSlot(s, tasks);
        if (matched) matchedTaskIds.add(matched.id);
        return slotPill(s, true, matched);
      });
      const unmatchedTasks = tasks.filter(t => !matchedTaskIds.has(t.id));
      return `<div style="min-height:100px;padding:4px;background:${cell.cur?'var(--bg-card)':'var(--bg-deepest)'};
        cursor:${cell.cur?'pointer':'default'};" data-date="${dateStr}">
        <div style="font-size:0.8125rem;font-weight:${isToday?700:400};
          color:${isToday?'var(--brand-gold)':'var(--text-muted)'};
          ${isToday?'background:var(--brand-gold);color:#000;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;':''};
          margin-bottom:3px;">${cell.day}</div>
        ${slotRenders.join('')}
        ${unmatchedTasks.map(t=>taskPill(t,true)).join('')}
      </div>`;
    }).join('')}
  </div>`;

  _bindNavMonth(m,y);
  el.querySelectorAll('[data-task-id]').forEach(pill=>{
    pill.addEventListener('click',e=>{
      e.stopPropagation();
      const t=allTasks.find(x=>x.id===pill.dataset.taskId);
      if(t) openTaskModal({taskData:t,onSave:()=>load()});
    });
  });
  _bindCalendarDragDrop(el);
  bindSlotClicks(el);
}

function _bindNavMonth(m,y) {
  document.getElementById('cal-prev')?.addEventListener('click',()=>{currentDate=new Date(y,m-1,1);render();});
  document.getElementById('cal-next')?.addEventListener('click',()=>{currentDate=new Date(y,m+1,1);render();});
  document.getElementById('cal-today')?.addEventListener('click',()=>{currentDate=new Date();render();});
}

/* ═══════════════════════════════════════════════════════════
   WEEK VIEW
═══════════════════════════════════════════════════════════ */
function renderWeek() {
  const el = document.getElementById('calendar-content');
  if (!el) return;

  // Get Monday of current week
  const base   = new Date(currentDate);
  const dow    = base.getDay();
  const monday = new Date(base); monday.setDate(base.getDate()-(dow===0?6:dow-1));
  // Zero hours on all days for reliable comparison
  const days   = Array.from({length:7},(_,i)=>{
    const d=new Date(monday); d.setDate(monday.getDate()+i); d.setHours(0,0,0,0); return d;
  });
  const today  = new Date(); today.setHours(0,0,0,0);

  const activeType = activeView==='pipeline'
    ? (store.get('taskTypes')||[]).find(t=>t.id===pipelineTypeId) : null;

  const weekFilterFn = buildFilterFn(activeView==='standard' ? calFilterState : {});
  const tasksByDay = days.map(d=>{
    return allTasks.filter(t=>{
      if (activeType && t.typeId!==pipelineTypeId) return false;
      if (!weekFilterFn(t)) return false;
      const df = t.dueDate||t.startDate;
      if (!df) return false;
      const td=df?.toDate?df.toDate():new Date(df); td.setHours(0,0,0,0);
      return td.getTime()===d.getTime();
    });
  });

  const rangeLabel = `${days[0].getDate()} ${PT_MONTHS[days[0].getMonth()].slice(0,3)} — ${days[6].getDate()} ${PT_MONTHS[days[6].getMonth()].slice(0,3)} ${days[6].getFullYear()}`;

  // Track which tasks got absorbed into slot renders, per day index
  const matchedTaskIdsByDay = [];

  el.innerHTML = navBar(rangeLabel) + `
  <div style="display:grid;grid-template-columns:60px repeat(7,1fr);gap:1px;
    background:var(--border-subtle);border:1px solid var(--border-subtle);
    border-radius:var(--radius-md);max-height:72vh;overflow-y:auto;">

    <!-- Header row -->
    <div style="background:var(--bg-deepest);padding:8px 4px;"></div>
    ${days.map((d,i)=>{
      const isToday = d.getTime()===today.getTime();
      const slots   = getSlotsForDate(d, activeView==='pipeline'?pipelineTypeId:null);
      const dayTasks = tasksByDay[i] || [];
      const matchedIds = new Set();
      const slotRenders = slots.map(s => {
        const matched = findTaskForSlot(s, dayTasks);
        if (matched) matchedIds.add(matched.id);
        return slotPill(s, true, matched);
      });
      // Stash matched IDs on the day index so the tasks row below can filter
      matchedTaskIdsByDay[i] = matchedIds;
      return `<div style="padding:6px 4px;text-align:center;background:${isToday?'rgba(212,168,67,0.12)':'var(--bg-deepest)'};
        border-bottom:2px solid ${isToday?'var(--brand-gold)':'transparent'};">
        <div style="font-size:0.75rem;color:var(--text-muted);">${PT_DAYS_S[d.getDay()]}</div>
        <div style="font-size:1rem;font-weight:${isToday?700:400};color:${isToday?'var(--brand-gold)':'var(--text-primary)'};">${d.getDate()}</div>
        ${slotRenders.join('')}
      </div>`;
    }).join('')}

    <!-- Task rows: all-day section -->
    <div style="padding:4px;font-size:0.625rem;color:var(--text-muted);background:var(--bg-card);
      display:flex;align-items:center;justify-content:center;">tarefas</div>
    ${tasksByDay.map((tasks,i)=>{
      const matched = matchedTaskIdsByDay[i] || new Set();
      const unmatched = tasks.filter(t => !matched.has(t.id));
      return `
      <div style="padding:4px;background:var(--bg-card);min-height:80px;vertical-align:top;">
        ${unmatched.map(t=>taskPill(t,true)).join('')}
        ${!unmatched.length?`<div style="font-size:0.6875rem;color:var(--border-subtle);text-align:center;padding-top:8px;">—</div>`:''}
      </div>`;
    }).join('')}
  </div>`;

  _bindNavWeek(monday);
  el.querySelectorAll('[data-task-id]').forEach(pill=>{
    pill.addEventListener('click',e=>{
      e.stopPropagation();
      const t=allTasks.find(x=>x.id===pill.dataset.taskId);
      if(t) openTaskModal({taskData:t,onSave:()=>load()});
    });
  });
  _bindCalendarDragDrop(el);
  bindSlotClicks(el);
}

function _bindNavWeek(monday) {
  document.getElementById('cal-prev')?.addEventListener('click',()=>{
    currentDate=new Date(monday); currentDate.setDate(monday.getDate()-7); render();
  });
  document.getElementById('cal-next')?.addEventListener('click',()=>{
    currentDate=new Date(monday); currentDate.setDate(monday.getDate()+7); render();
  });
  document.getElementById('cal-today')?.addEventListener('click',()=>{currentDate=new Date();render();});
}

/* ═══════════════════════════════════════════════════════════
   DAY VIEW
═══════════════════════════════════════════════════════════ */
function renderDay() {
  const el = document.getElementById('calendar-content');
  if (!el) return;

  const d     = new Date(currentDate);
  const today = new Date(); today.setHours(0,0,0,0);
  const dMid  = new Date(d); dMid.setHours(0,0,0,0);
  const isToday = dMid.getTime()===today.getTime();

  const activeType = activeView==='pipeline'
    ? (store.get('taskTypes')||[]).find(t=>t.id===pipelineTypeId) : null;

  const dayTasks = allTasks.filter(t=>{
    if (activeType && t.typeId!==pipelineTypeId) return false;
    const df=t.dueDate||t.startDate;
    if(!df) return false;
    const td=df?.toDate?df.toDate():new Date(df); td.setHours(0,0,0,0);
    return td.getTime()===dMid.getTime();
  });

  const daySlots = getSlotsForDate(dMid, activeView==='pipeline'?pipelineTypeId:null);
  const dateLabel = `${PT_DAYS_L[d.getDay()]}, ${d.getDate()} de ${PT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;

  el.innerHTML = navBar(dateLabel,
    `${dayTasks.length} tarefa${dayTasks.length!==1?'s':''}${daySlots.length?` · ${daySlots.length} slot${daySlots.length!==1?'s':''} de agenda`:''}`) + `
  <div style="display:grid;grid-template-columns:1fr 280px;gap:16px;align-items:start;">

    <!-- Tasks list -->
    <div class="card">
      <div class="card-header">
        <div class="card-title" style="color:${isToday?'var(--brand-gold)':'var(--text-primary)'};">
          ${isToday?'◎ Hoje':'📅 '+d.getDate()+' de '+PT_MONTHS[d.getMonth()]}
        </div>
        <button class="btn btn-ghost btn-sm" id="day-new-task-btn">+ Tarefa</button>
      </div>
      <div class="card-body" style="padding:0 16px 16px;display:flex;flex-direction:column;gap:8px;">
        ${dayTasks.length
          ? dayTasks.map(t=>{
              const prio=PRIORITY_MAP[t.priority]||{}; const color=prio.color||'#6B7280';
              const done=t.status==='done';
              return `<div class="cal-task-pill" data-task-id="${t.id}" style="
                display:flex;align-items:flex-start;gap:10px;padding:10px 12px;
                border-radius:var(--radius-md);background:var(--bg-surface);
                border:1px solid var(--border-subtle);border-left:3px solid ${color};
                cursor:pointer;opacity:${done?0.6:1};">
                <div style="flex:1;min-width:0;">
                  <div style="font-size:0.875rem;font-weight:500;color:var(--text-primary);
                    ${done?'text-decoration:line-through;':''}margin-bottom:4px;">
                    ${esc(t.title)}
                  </div>
                  ${renderCardFields(t,{compact:false,onlyFields:['requestingArea','taskType','variationName']})}
                </div>
              </div>`;
            }).join('')
          : `<div style="font-size:0.875rem;color:var(--text-muted);padding:20px 0;text-align:center;">
              Nenhuma tarefa para este dia.
            </div>`
        }
      </div>
    </div>

    <!-- Agenda slots sidebar -->
    <div>
      ${daySlots.length?`
        <div class="card" style="margin-bottom:12px;">
          <div class="card-header">
            <div class="card-title">◌ Agenda do dia</div>
          </div>
          <div class="card-body" style="padding:8px 16px 16px;display:flex;flex-direction:column;gap:6px;">
            ${daySlots.map(slot=>{
              const color=slot.color||slot.taskType?.color||'#6B7280';
              return `<div class="cal-slot-pill" data-slot-id="${slot.id}"
                data-type-id="${slot.taskType?.id||''}"
                data-slot='${JSON.stringify({title:slot.title,requestingArea:slot.requestingArea||'',variationId:slot.variationId||''})}'
                style="padding:10px 12px;border-radius:var(--radius-md);cursor:pointer;
                  border:1.5px dashed ${color};background:${color}08;">
                <div style="font-size:0.875rem;font-weight:500;color:${color};margin-bottom:2px;">
                  ◌ ${esc(slot.title)}
                </div>
                ${slot.requestingArea?`<div style="font-size:0.75rem;color:var(--text-muted);">📍 ${esc(slot.requestingArea)}</div>`:''}
                <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
                  ${esc(slot.taskType?.name||'')} · Clique para criar tarefa
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
      `:''}
      <!-- Mini month navigator -->
      ${renderMiniMonth()}
    </div>
  </div>`;

  document.getElementById('day-new-task-btn')?.addEventListener('click',()=>{
    const typeId=activeView==='pipeline'?pipelineTypeId:null;
    openTaskModal({typeId,onSave:()=>load()});
  });
  _bindNavDay(d);
  el.querySelectorAll('[data-task-id]').forEach(pill=>{
    pill.addEventListener('click',e=>{
      e.stopPropagation();
      const t=allTasks.find(x=>x.id===pill.dataset.taskId);
      if(t) openTaskModal({taskData:t,onSave:()=>load()});
    });
  });
  bindSlotClicks(el);
  el.querySelectorAll('.mini-month-day[data-iso]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      currentDate=new Date(btn.dataset.iso+'T12:00:00');
      render();
    });
  });
}

function renderMiniMonth() {
  const y=currentDate.getFullYear(), m=currentDate.getMonth();
  const fd=new Date(y,m,1).getDay();
  const dim=new Date(y,m+1,0).getDate();
  const today=new Date();
  let html='';
  for(let i=fd-1;i>=0;i--) html+=`<div></div>`;
  for(let d=1;d<=dim;d++){
    const iso=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isCur=d===currentDate.getDate();
    const isToday=d===today.getDate()&&m===today.getMonth()&&y===today.getFullYear();
    const slots=getSlotsForDate(new Date(y,m,d));
    html+=`<div class="mini-month-day" data-iso="${iso}" style="
      aspect-ratio:1;border-radius:50%;display:flex;align-items:center;justify-content:center;
      font-size:0.6875rem;cursor:pointer;position:relative;
      background:${isCur?'var(--brand-gold)':isToday?'rgba(212,168,67,0.2)':'transparent'};
      color:${isCur?'#000':isToday?'var(--brand-gold)':'var(--text-secondary)'};
      font-weight:${isCur||isToday?700:400};">
      ${d}
      ${slots.length?`<div style="position:absolute;bottom:1px;right:1px;width:4px;height:4px;
        border-radius:50%;background:${isCur?'#000':'var(--brand-gold)'}"></div>`:''}
    </div>`;
  }
  return `<div class="card">
    <div class="card-header" style="padding:10px 12px;">
      <div style="font-size:0.8125rem;font-weight:600;">${PT_MONTHS[m]} ${y}</div>
    </div>
    <div style="padding:4px 10px 10px;">
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px;">
        ${PT_DAYS_S.map(d=>`<div style="text-align:center;font-size:0.5625rem;color:var(--text-muted);">${d[0]}</div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;">${html}</div>
    </div>
  </div>`;
}

function _bindNavDay(d) {
  document.getElementById('cal-prev')?.addEventListener('click',()=>{
    currentDate=new Date(d); currentDate.setDate(d.getDate()-1); render();
  });
  document.getElementById('cal-next')?.addEventListener('click',()=>{
    currentDate=new Date(d); currentDate.setDate(d.getDate()+1); render();
  });
  document.getElementById('cal-today')?.addEventListener('click',()=>{currentDate=new Date();render();});
}

/* ═══════════════════════════════════════════════════════════
   AGENDA PRÉVIA VIEWS — only schedule slots, no real tasks
═══════════════════════════════════════════════════════════ */
function agendaHeader() {
  const taskTypes = store.get('taskTypes') || [];
  const allTypes  = taskTypes.filter(t => (t.scheduleSlots||[]).length > 0);
  const typeInfo  = allTypes.find(t=>t.id===pipelineTypeId) || allTypes[0];
  return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;
    background:rgba(212,168,67,0.06);border:1px solid rgba(212,168,67,0.2);
    border-radius:var(--radius-md);margin-bottom:16px;font-size:0.875rem;color:var(--text-secondary);">
    <span style="font-size:1rem;">◌</span>
    <span><strong style="color:var(--brand-gold);">Agenda prévia</strong> — visualização dos slots de referência configurados no tipo de tarefa.
    Clique num slot para criar uma tarefa com os dados pré-preenchidos.</span>
    ${typeInfo?`<span style="margin-left:auto;padding:2px 10px;border-radius:var(--radius-full);
      background:${typeInfo.color||'#D4A843'}18;color:${typeInfo.color||'#D4A843'};font-size:0.8125rem;">
      ${typeInfo.icon||''} ${esc(typeInfo.name)}</span>`:''}
  </div>`;
}

function renderAgendaMonth() {
  const el = document.getElementById('calendar-content');
  if (!el) return;
  const y=currentDate.getFullYear(), m=currentDate.getMonth();
  const firstDay=new Date(y,m,1).getDay();
  const daysInM=new Date(y,m+1,0).getDate();
  const today=new Date();
  const cells=[];
  for(let i=firstDay-1;i>=0;i--) cells.push({day:new Date(y,m-1,new Date(y,m,0).getDate()-i+1),cur:false});
  for(let d=1;d<=daysInM;d++) cells.push({day:new Date(y,m,d),cur:true});
  while(cells.length%7!==0) cells.push({day:new Date(y,m+1,cells.length-firstDay-daysInM+1),cur:false});

  // Count total slots this month
  let totalSlots=0;
  for(let d=1;d<=daysInM;d++) totalSlots+=getSlotsForDate(new Date(y,m,d)).length;

  el.innerHTML = agendaHeader() + navBar(`${PT_MONTHS[m]} ${y}`, `${totalSlots} slot${totalSlots!==1?'s':''} este mês`) + `
  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--border-subtle);
    border:1px solid var(--border-subtle);border-radius:var(--radius-md);overflow:hidden;">
    ${PT_DAYS_S.map(d=>`<div style="padding:6px;text-align:center;font-size:0.75rem;font-weight:600;
      color:var(--text-muted);background:var(--bg-deepest);">${d}</div>`).join('')}
    ${cells.map(({day:d, cur})=>{
      const slots=cur?getSlotsForDate(d,pipelineTypeId):[];
      const isToday=cur&&d.getDate()===today.getDate()&&d.getMonth()===today.getMonth()&&d.getFullYear()===today.getFullYear();
      return `<div style="min-height:80px;padding:4px;background:${cur?(slots.length?'rgba(212,168,67,0.04)':'var(--bg-card)'):'var(--bg-deepest)'};">
        <div style="font-size:0.8125rem;font-weight:${isToday?700:400};
          color:${isToday?'var(--brand-gold)':slots.length?'var(--text-primary)':'var(--text-muted)'};
          margin-bottom:3px;">${d.getDate()}</div>
        ${slots.map(s=>slotPill(s,true)).join('')}
      </div>`;
    }).join('')}
  </div>`;

  document.getElementById('cal-prev')?.addEventListener('click',()=>{currentDate=new Date(y,m-1,1);renderAgendaView();});
  document.getElementById('cal-next')?.addEventListener('click',()=>{currentDate=new Date(y,m+1,1);renderAgendaView();});
  document.getElementById('cal-today')?.addEventListener('click',()=>{currentDate=new Date();renderAgendaView();});
  bindSlotClicks(el);
}

function renderAgendaWeek() {
  const el = document.getElementById('calendar-content');
  if (!el) return;
  const base=new Date(currentDate); const dow=base.getDay();
  const monday=new Date(base); monday.setDate(base.getDate()-(dow===0?6:dow-1));
  const days=Array.from({length:7},(_,i)=>{ const d=new Date(monday); d.setDate(monday.getDate()+i); d.setHours(0,0,0,0); return d; });
  const today=new Date(); today.setHours(0,0,0,0);
  const rangeLabel=`${days[0].getDate()} ${PT_MONTHS[days[0].getMonth()].slice(0,3)} — ${days[6].getDate()} ${PT_MONTHS[days[6].getMonth()].slice(0,3)} ${days[6].getFullYear()}`;

  el.innerHTML = agendaHeader() + navBar(rangeLabel) + `
  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;">
    ${days.map(d=>{
      const slots=getSlotsForDate(d,pipelineTypeId);
      const isToday=d.getTime()===today.getTime();
      return `<div style="padding:8px;border-radius:var(--radius-md);min-height:120px;
        background:${slots.length?'rgba(212,168,67,0.04)':'var(--bg-card)'};
        border:1px solid ${isToday?'var(--brand-gold)':slots.length?'rgba(212,168,67,0.2)':'var(--border-subtle)'};">
        <div style="font-size:0.75rem;color:var(--text-muted);">${PT_DAYS_S[d.getDay()]}</div>
        <div style="font-size:1rem;font-weight:${isToday?700:400};color:${isToday?'var(--brand-gold)':'var(--text-primary)'};margin-bottom:6px;">${d.getDate()}</div>
        ${slots.length
          ? slots.map(s=>slotPill(s,false)).join('')
          : `<div style="font-size:0.6875rem;color:var(--border-default);text-align:center;padding-top:16px;">—</div>`}
      </div>`;
    }).join('')}
  </div>`;

  document.getElementById('cal-prev')?.addEventListener('click',()=>{ currentDate=new Date(monday); currentDate.setDate(monday.getDate()-7); renderAgendaView(); });
  document.getElementById('cal-next')?.addEventListener('click',()=>{ currentDate=new Date(monday); currentDate.setDate(monday.getDate()+7); renderAgendaView(); });
  document.getElementById('cal-today')?.addEventListener('click',()=>{currentDate=new Date();renderAgendaView();});
  bindSlotClicks(el);
}

function renderAgendaDay() {
  const el = document.getElementById('calendar-content');
  if (!el) return;
  const d=new Date(currentDate); d.setHours(0,0,0,0);
  const today=new Date(); today.setHours(0,0,0,0);
  const slots=getSlotsForDate(d,pipelineTypeId);
  const dateLabel=`${PT_DAYS_L[d.getDay()]}, ${d.getDate()} de ${PT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;

  el.innerHTML = agendaHeader() + navBar(dateLabel, `${slots.length} slot${slots.length!==1?'s':''}`)+`
  <div style="display:grid;grid-template-columns:1fr 280px;gap:16px;align-items:start;">
    <div class="card">
      <div class="card-header">
        <div class="card-title">◌ Slots do dia</div>
        <button class="btn btn-primary btn-sm" id="agenda-new-btn">+ Criar todas</button>
      </div>
      <div class="card-body" style="padding:8px 16px 16px;display:flex;flex-direction:column;gap:8px;">
        ${slots.length
          ? slots.map(s=>{
              const color=s.color||s.taskType?.color||'#D4A843';
              return `<div class="cal-slot-pill" data-slot-id="${s.id}"
                data-type-id="${s.taskType?.id||''}"
                data-slot='${JSON.stringify({title:s.title,requestingArea:s.requestingArea||'',variationId:s.variationId||''})}'
                style="padding:12px 14px;border-radius:var(--radius-md);cursor:pointer;
                  border:1.5px dashed ${color};background:${color}08;transition:all 0.15s;">
                <div style="font-size:0.9375rem;font-weight:500;color:${color};">◌ ${esc(s.title)}</div>
                ${s.requestingArea?`<div style="font-size:0.8125rem;color:var(--text-muted);margin-top:3px;">📍 ${esc(s.requestingArea)}</div>`:''}
                <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
                  ${esc(s.taskType?.name||'')} · Clique para criar tarefa
                </div>
              </div>`;
            }).join('')
          : `<div style="font-size:0.875rem;color:var(--text-muted);padding:24px 0;text-align:center;">
              Nenhum slot de agenda para este dia.
            </div>`}
      </div>
    </div>
    ${renderMiniMonth()}
  </div>`;

  document.getElementById('agenda-new-btn')?.addEventListener('click', () => {
    // Open first slot as example
    if (slots[0]) {
      openTaskModal({ typeId: slots[0].taskType?.id, taskData: {
        title: slots[0].title, requestingArea: slots[0].requestingArea||'',
        status:'not_started', assignees:[], tags:[], subtasks:[], comments:[], customFields:{},
      }, onSave: ()=>load() });
    }
  });
  document.getElementById('cal-prev')?.addEventListener('click',()=>{currentDate=new Date(d);currentDate.setDate(d.getDate()-1);renderAgendaView();});
  document.getElementById('cal-next')?.addEventListener('click',()=>{currentDate=new Date(d);currentDate.setDate(d.getDate()+1);renderAgendaView();});
  document.getElementById('cal-today')?.addEventListener('click',()=>{currentDate=new Date();renderAgendaView();});
  el.querySelectorAll('.mini-month-day[data-iso]').forEach(btn=>{
    btn.addEventListener('click',()=>{ currentDate=new Date(btn.dataset.iso+'T12:00:00'); renderAgendaView(); });
  });
  bindSlotClicks(el);
}

/* ─── Export for portal ──────────────────────────────────── */
export async function getNewsletterCalendarData(year, month) {
  const tasks = await fetchTasks().catch(()=>[]);
  const map   = {};
  tasks.filter(t=>(t.typeId==='newsletter'||t.type==='newsletter')&&t.status!=='cancelled').forEach(t=>{
    const df=t.dueDate||t.startDate;
    if(!df)return;
    const d=df?.toDate?df.toDate():new Date(df);
    if(d.getFullYear()!==year||d.getMonth()!==month)return;
    const k=d.getDate();
    if(!map[k])map[k]=[];
    map[k].push({title:t.title,requestingArea:t.requestingArea||'',status:t.status});
  });
  return map;
}

export { getSlotsForDate };
