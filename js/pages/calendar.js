/**
 * PRIMETOUR — Calendar Page
 * Visualização de tarefas em calendário mensal
 */

import { fetchTasks, PRIORITY_MAP, STATUS_MAP } from '../services/tasks.js';
import { openTaskModal } from '../components/taskModal.js';
import { toast }         from '../components/toast.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const PT_MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const PT_DAYS   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

let allTasks    = [];
let currentDate = new Date();

export async function renderCalendar(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Calendário</h1>
        <p class="page-subtitle">Tarefas e prazos por data</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary" id="cal-new-task-btn">+ Nova Tarefa</button>
      </div>
    </div>
    <div id="calendar-content">
      <div class="task-empty"><div class="task-empty-icon">⟳</div><div class="task-empty-title">Carregando calendário...</div></div>
    </div>
  `;

  document.getElementById('cal-new-task-btn')?.addEventListener('click', () =>
    openTaskModal({ onSave: () => load() })
  );

  await load();
}

async function load() {
  try {
    allTasks = await fetchTasks();
    renderMonth();
  } catch(e) {
    toast.error('Erro ao carregar tarefas.');
  }
}

function renderMonth() {
  const content = document.getElementById('calendar-content');
  if (!content) return;

  const year  = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Build calendar days
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays  = new Date(year, month, 0).getDate();
  const today     = new Date();

  // Map tasks to dates
  const taskMap = {};
  allTasks.forEach(task => {
    if (!task.dueDate) return;
    const d = task.dueDate?.toDate ? task.dueDate.toDate() : new Date(task.dueDate);
    if (d.getFullYear() !== year || d.getMonth() !== month) return;
    const key = d.getDate();
    if (!taskMap[key]) taskMap[key] = [];
    taskMap[key].push(task);
  });

  // Cells
  const cells = [];
  // Previous month fill
  for (let i = firstDay - 1; i >= 0; i--) {
    cells.push({ day: prevDays - i, current: false });
  }
  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, current: true });
  }
  // Next month fill
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    cells.push({ day: d, current: false });
  }

  content.innerHTML = `
    <div class="calendar-wrapper">
      <div class="calendar-header">
        <div class="calendar-nav">
          <button class="calendar-nav-btn" id="cal-prev">◀</button>
          <button class="btn btn-ghost btn-sm" id="cal-today">Hoje</button>
          <button class="calendar-nav-btn" id="cal-next">▶</button>
        </div>
        <div class="calendar-month-title">
          ${PT_MONTHS[month]} ${year}
        </div>
        <div style="font-size:0.8125rem; color:var(--text-muted);">
          ${allTasks.filter(t => {
            if (!t.dueDate) return false;
            const d = t.dueDate?.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
            return d.getFullYear()===year && d.getMonth()===month;
          }).length} tarefas este mês
        </div>
      </div>

      <div class="calendar-grid">
        ${PT_DAYS.map(d=>`<div class="calendar-day-label">${d}</div>`).join('')}

        ${cells.map(cell => {
          const tasks = cell.current ? (taskMap[cell.day] || []) : [];
          const isToday = cell.current &&
            today.getDate()===cell.day &&
            today.getMonth()===month &&
            today.getFullYear()===year;

          const MAX_SHOW = 3;
          const shown = tasks.slice(0, MAX_SHOW);
          const extra = tasks.length - MAX_SHOW;

          return `<div class="calendar-cell ${!cell.current?'other-month':''} ${isToday?'today':''}"
            data-date="${cell.current ? `${year}-${String(month+1).padStart(2,'0')}-${String(cell.day).padStart(2,'0')}` : ''}">
            <div class="calendar-date-num">${cell.day}</div>
            ${shown.map(t => {
              const prio  = PRIORITY_MAP[t.priority];
              const color = prio?.color || '#6B7280';
              return `<div class="calendar-task-pill" data-task-id="${t.id}"
                style="background:${color}20; color:${color}; border-left:2px solid ${color};"
                title="${esc(t.title)}">
                ${esc(t.title.slice(0,25))}${t.title.length>25?'…':''}
              </div>`;
            }).join('')}
            ${extra>0 ? `<div class="calendar-more" data-date="${year}-${String(month+1).padStart(2,'0')}-${String(cell.day).padStart(2,'0')}">+${extra} mais</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Side panel for selected day -->
    <div id="cal-side-panel" style="display:none; margin-top:16px;"></div>
  `;

  // Events
  document.getElementById('cal-prev')?.addEventListener('click', () => {
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    renderMonth();
  });
  document.getElementById('cal-next')?.addEventListener('click', () => {
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
    renderMonth();
  });
  document.getElementById('cal-today')?.addEventListener('click', () => {
    currentDate = new Date();
    renderMonth();
  });

  // Click on task pill
  content.querySelectorAll('.calendar-task-pill[data-task-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const task = allTasks.find(t=>t.id===el.dataset.taskId);
      if (task) openTaskModal({ taskData: task, onSave: () => load() });
    });
  });

  // Click on cell → show day tasks
  content.querySelectorAll('.calendar-cell[data-date]').forEach(cell => {
    cell.addEventListener('click', (e) => {
      if (e.target.closest('.calendar-task-pill')) return;
      const dateStr = cell.dataset.date;
      if (!dateStr) return;
      showDayPanel(dateStr, taskMap);
    });
  });

  // Click on +more
  content.querySelectorAll('.calendar-more[data-date]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      showDayPanel(el.dataset.date, taskMap);
    });
  });
}

function showDayPanel(dateStr, taskMap) {
  const panel = document.getElementById('cal-side-panel');
  if (!panel) return;

  const [y, m, d] = dateStr.split('-').map(Number);
  const tasks = taskMap[d] || [];

  if (!tasks.length) {
    panel.style.display = 'block';
    panel.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">${PT_DAYS[new Date(y,m-1,d).getDay()]}, ${d} de ${PT_MONTHS[m-1]}</div>
          <button class="btn btn-ghost btn-sm" onclick="this.closest('#cal-side-panel').style.display='none'">✕</button>
        </div>
        <div class="card-body">
          <div class="empty-state" style="padding:24px;">
            <div class="empty-state-icon">📅</div>
            <div class="empty-state-title">Nenhuma tarefa neste dia</div>
            <button class="btn btn-primary btn-sm mt-4"
              onclick="openTaskModalForDate('${dateStr}')">+ Criar tarefa</button>
          </div>
        </div>
      </div>
    `;
    return;
  }

  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-title">
          ${PT_DAYS[new Date(y,m-1,d).getDay()]}, ${d} de ${PT_MONTHS[m-1]}
          <span class="badge badge-neutral" style="margin-left:8px;">${tasks.length} tarefa${tasks.length!==1?'s':''}</span>
        </div>
        <button class="btn btn-ghost btn-sm" id="close-day-panel">✕</button>
      </div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:8px;">
        ${tasks.map(t => {
          const prio   = PRIORITY_MAP[t.priority];
          const status = STATUS_MAP[t.status];
          return `
            <div class="task-row" data-task-id="${t.id}" style="cursor:pointer;">
              <div class="task-check ${t.status==='done'?'checked':''}">
                ${t.status==='done'?'✓':''}
              </div>
              <div>
                <div class="task-row-title">${esc(t.title)}</div>
              </div>
              <div>
                <span class="badge badge-status-${t.status}" style="font-size:0.6875rem;">${status?.label||t.status}</span>
              </div>
              <div>
                <span class="badge badge-priority-${t.priority}" style="font-size:0.6875rem;">${prio?.label||t.priority}</span>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>
  `;

  document.getElementById('close-day-panel')?.addEventListener('click', () => {
    panel.style.display = 'none';
  });

  panel.querySelectorAll('.task-row[data-task-id]').forEach(row => {
    row.addEventListener('click', () => {
      const task = allTasks.find(t=>t.id===row.dataset.taskId);
      if (task) openTaskModal({ taskData: task, onSave: () => load() });
    });
  });
}
