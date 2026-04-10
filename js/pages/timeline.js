/**
 * PRIMETOUR — Timeline / Gantt
 * Diagrama de Gantt interativo por projeto
 */

import { fetchTasks, PRIORITY_MAP }  from '../services/tasks.js';
import {
  renderFilterBar, bindFilterBar, buildFilterFn,
} from '../components/filterBar.js';
import { fetchProjects }             from '../services/projects.js';
import { openTaskModal }             from '../components/taskModal.js';
import { toast }                     from '../components/toast.js';
import { store }                     from '../store.js';
import { openCardPrefsModal }         from '../components/cardPrefsModal.js';
import { renderCardFields }           from '../services/cardPrefs.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const PT_MONTHS_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

let allTasks      = [];
let allProjects   = [];
let tlFilterState = { sector: null, type: null, project: null, area: null };

function initTlFilterState() {
  if (!tlFilterState.sector) {
    const sectors = store.getVisibleSectors();
    if (sectors && sectors.length === 1) tlFilterState.sector = sectors[0];
  }
}

export async function renderTimeline(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Timeline / Gantt</h1>
        <p class="page-subtitle">Visualização temporal de tarefas com datas de início e prazo</p>
      </div>
      <div class="page-header-actions">
        <select class="filter-select" id="tl-proj-filter" style="min-width:180px;">
          <option value="">Todos os projetos</option>
        </select>
        <select class="filter-select" id="tl-window">
          <option value="7">7 dias</option>
          <option value="14">14 dias</option>
          <option value="30">30 dias</option>
          <option value="60" selected>60 dias</option>
          <option value="90">90 dias</option>
        </select>
        <button class="btn btn-ghost btn-icon" id="tl-prefs-btn" title="Personalizar cards" style="font-size:1rem;">⚙</button>
      </div>
    </div>
    <div id="tl-filter-bar" style="padding:0 2px;"></div>
    <div id="timeline-content">
      <div class="task-empty"><div class="task-empty-icon">⟳</div><div class="task-empty-title">Carregando timeline...</div></div>
    </div>
  `;

  try {
    [allTasks, allProjects] = await Promise.all([fetchTasks(), fetchProjects()]);

    // Populate project filter
    const sel = document.getElementById('tl-proj-filter');
    allProjects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = `${p.icon} ${p.name}`;
      sel?.appendChild(opt);
    });

    renderGantt();

    document.getElementById('tl-proj-filter')?.addEventListener('change', renderGantt);
    document.getElementById('tl-window')?.addEventListener('change', renderGantt);
    document.getElementById('tl-prefs-btn')?.addEventListener('click', () =>
      openCardPrefsModal(() => renderGantt())
    );

    // Pre-select sector for single-sector users
    initTlFilterState();
    // Filter bar
    _renderTlFilters();
  } catch(e) {
    toast.error('Erro ao carregar timeline.');
    console.error(e);
  }
}

function _renderTlFilters() {
  const wrap = document.getElementById('tl-filter-bar');
  if (!wrap) return;
  // Remove project filter from filterBar since it's already in the header select
  const userSectors = store.getVisibleSectors();
  const tlTaskTypes = (store.get('taskTypes') || []).filter(t =>
    !t.sector || userSectors === null || userSectors.includes(t.sector)
  );
  wrap.innerHTML = renderFilterBar({
    show: ['sector','type','area'],
    state: tlFilterState,
    taskTypes: tlTaskTypes,
    projects:  allProjects,
  });
  bindFilterBar(wrap, tlFilterState, () => renderGantt());
}

function renderGantt() {
  const content    = document.getElementById('timeline-content');
  if (!content) return;

  const projFilter = document.getElementById('tl-proj-filter')?.value || '';
  const windowDays = parseInt(document.getElementById('tl-window')?.value || '60');

  // Filter tasks with dates
  const tlFn  = buildFilterFn(tlFilterState);
  let tasks = allTasks.filter(t => (t.startDate || t.dueDate) && tlFn(t));
  if (projFilter) tasks = tasks.filter(t => t.projectId === projFilter);

  if (!tasks.length) {
    content.innerHTML = `
      <div class="task-empty">
        <div class="task-empty-icon">━</div>
        <div class="task-empty-title">Nenhuma tarefa com datas encontrada</div>
        <p class="text-sm text-muted mt-2">
          Defina datas de início e prazo nas tarefas para visualizá-las aqui.
        </p>
      </div>
    `;
    return;
  }

  // Date range
  const startWindow = new Date(); startWindow.setHours(0,0,0,0);
  const endWindow   = new Date(startWindow); endWindow.setDate(endWindow.getDate() + windowDays);
  const today       = new Date(); today.setHours(0,0,0,0);

  // Build days array
  const days = [];
  for (let d = new Date(startWindow); d <= endWindow; d.setDate(d.getDate()+1)) {
    days.push(new Date(d));
  }

  // Group tasks by project
  const byProject = {};
  tasks.forEach(t => {
    const key = t.projectId || '__none__';
    if (!byProject[key]) byProject[key] = [];
    byProject[key].push(t);
  });

  // Render
  const DAY_W = 40; // px per day
  const totalW = days.length * DAY_W;

  const monthHeaders = buildMonthHeaders(days, DAY_W);

  content.innerHTML = `
    <div class="timeline-wrapper" style="max-height:calc(100vh - 220px);">
      <div style="min-width:${240 + totalW}px;">

        <!-- Month headers -->
        <div style="display:grid; grid-template-columns:240px 1fr; border-bottom:1px solid var(--border-default);">
          <div style="padding:8px 16px; font-size:0.6875rem; font-weight:600; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-muted); background:var(--bg-surface); border-right:1px solid var(--border-default);">
            Tarefa
          </div>
          <div style="display:flex; background:var(--bg-surface); position:relative;">
            ${monthHeaders}
          </div>
        </div>

        <!-- Day headers -->
        <div style="display:grid; grid-template-columns:240px 1fr; border-bottom:2px solid var(--border-default); position:sticky; top:0; z-index:3; background:var(--bg-surface);">
          <div style="padding:8px 16px; background:var(--bg-surface); border-right:1px solid var(--border-default);"></div>
          <div style="display:flex;">
            ${days.map(d => {
              const isToday = d.getTime() === today.getTime();
              const isSun = d.getDay() === 0;
              const isSat = d.getDay() === 6;
              return `<div style="
                width:${DAY_W}px; min-width:${DAY_W}px;
                padding:6px 2px; text-align:center;
                font-size:0.625rem; font-weight:${isToday?700:400};
                color:${isToday?'var(--brand-gold)':isSun||isSat?'var(--text-muted)':'var(--text-secondary)'};
                background:${isToday?'rgba(212,168,67,0.08)':isSun||isSat?'rgba(255,255,255,0.02)':'transparent'};
                border-right:1px solid var(--border-subtle);
              ">
                ${d.getDate()}<br>
                <span style="opacity:0.6;">
                  ${['D','S','T','Q','Q','S','S'][d.getDay()]}
                </span>
              </div>`;
            }).join('')}
          </div>
        </div>

        <!-- Rows by project -->
        ${Object.entries(byProject).map(([projId, projTasks]) => {
          const project = allProjects.find(p=>p.id===projId);
          return `
            <!-- Project header row -->
            <div style="display:grid; grid-template-columns:240px 1fr; border-bottom:1px solid var(--border-subtle); background:var(--bg-surface);">
              <div style="padding:8px 16px; font-size:0.8125rem; font-weight:600; color:var(--text-primary); border-right:1px solid var(--border-default); display:flex; align-items:center; gap:6px;">
                ${project ? `<span>${project.icon}</span><span>${esc(project.name)}</span>` : '<span>📋 Sem projeto</span>'}
                <span class="badge badge-neutral" style="margin-left:auto;">${projTasks.length}</span>
              </div>
              <div style="background:var(--bg-surface); position:relative; height:36px;">
                ${renderTodayLine(today, startWindow, DAY_W)}
              </div>
            </div>

            <!-- Task rows -->
            ${projTasks.map(task => {
              const prio  = PRIORITY_MAP[task.priority];
              const color = prio?.color || '#6B7280';
              const barLeft   = computeBarLeft(task, startWindow, DAY_W);
              const barWidth  = computeBarWidth(task, startWindow, endWindow, DAY_W);

              return `
                <div class="timeline-row-wrapper" style="display:grid; grid-template-columns:240px 1fr; border-bottom:1px solid var(--border-subtle);" data-task-id="${task.id}">
                  <div style="padding:6px 16px; border-right:1px solid var(--border-default);
                    display:flex; flex-direction:column; justify-content:center; gap:2px;
                    background:var(--bg-card); cursor:pointer; min-height:42px;" class="tl-task-label">
                    <div style="display:flex;align-items:center;gap:8px;">
                      <div class="priority-dot priority-${task.priority||'medium'}"></div>
                      <span style="font-size:0.8125rem; color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(task.title)}</span>
                      ${renderSubtaskBadge(task)}
                    </div>
                    ${renderCardFields(task, { compact:true })}
                  </div>
                  <div style="position:relative; height:42px; background:${task.status==='done'?'rgba(34,197,94,0.03)':'transparent'};">
                    ${renderTodayLine(today, startWindow, DAY_W)}
                    ${barWidth > 0 ? `
                      <div class="timeline-bar tl-task-bar" data-task-id="${task.id}"
                        style="left:${barLeft}px; width:${Math.max(barWidth,20)}px; background:${color}; opacity:${task.status==='done'?0.5:0.85}; top:8px;"
                        title="${esc(task.title)}">
                        ${barWidth > 60 ? esc(task.title.slice(0,14))+'…' : ''}
                      </div>
                    ` : `
                      <div style="position:absolute; left:${barLeft}px; top:14px; width:12px; height:12px; border-radius:50%; background:${color}; opacity:0.7;" title="Sem período definido"></div>
                    `}
                    ${renderSubtaskDots(task, startWindow, endWindow, DAY_W, barLeft, Math.max(barWidth, 20))}
                  </div>
                </div>
              `;
            }).join('')}
          `;
        }).join('')}
      </div>
    </div>
  `;

  // Click on task label or bar
  content.querySelectorAll('[data-task-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      // Ignora se o clique veio de um touchpoint de subtarefa (handler abaixo)
      if (e.target.closest('.timeline-subtask-dot')) return;
      const tid  = el.dataset.taskId || el.closest('[data-task-id]')?.dataset.taskId;
      const task = allTasks.find(t=>t.id===tid);
      if (task) openTaskModal({ taskData: task, onSave: async () => {
        allTasks = await fetchTasks().catch(()=>allTasks);
        renderGantt();
      }});
    });
  });

  // Click em um touchpoint de subtarefa: abre modal e rola até subtarefas
  content.querySelectorAll('.timeline-subtask-dot').forEach(dot => {
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      const tid = dot.dataset.taskId;
      const task = allTasks.find(t => t.id === tid);
      if (!task) return;
      openTaskModal({
        taskData: task,
        onSave: async () => {
          allTasks = await fetchTasks().catch(() => allTasks);
          renderGantt();
        },
      });
      // Aguarda o modal montar e rola até a seção de subtarefas
      setTimeout(() => {
        const list = document.querySelector('.modal-backdrop:last-child #subtask-list');
        list?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        list?.classList.add('tl-flash');
        setTimeout(() => list?.classList.remove('tl-flash'), 1200);
      }, 350);
    });
  });
}

function buildMonthHeaders(days, dayW) {
  const segments = [];
  let cur = null;
  days.forEach(d => {
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (cur?.key !== key) {
      cur = { key, year: d.getFullYear(), month: d.getMonth(), count: 1 };
      segments.push(cur);
    } else { cur.count++; }
  });
  return segments.map(s=>`
    <div style="
      width:${s.count * dayW}px; min-width:${s.count * dayW}px;
      padding:4px 8px;
      font-size:0.6875rem; font-weight:600;
      color:var(--text-secondary);
      border-right:1px solid var(--border-subtle);
      white-space:nowrap;
      overflow:hidden;
    ">${PT_MONTHS_SHORT[s.month]} ${s.year}</div>
  `).join('');
}

function computeBarLeft(task, startWindow, dayW) {
  if (!task.startDate && !task.dueDate) return 0;
  const start = task.startDate
    ? (task.startDate?.toDate ? task.startDate.toDate() : new Date(task.startDate))
    : (task.dueDate?.toDate   ? task.dueDate.toDate()   : new Date(task.dueDate));
  start.setHours(0,0,0,0);
  const diff = Math.max(0, (start - startWindow) / (1000*60*60*24));
  return Math.round(diff * dayW);
}

function computeBarWidth(task, startWindow, endWindow, dayW) {
  if (!task.startDate && !task.dueDate) return 0;

  const start = task.startDate
    ? (task.startDate?.toDate ? task.startDate.toDate() : new Date(task.startDate))
    : (task.dueDate?.toDate   ? task.dueDate.toDate()   : new Date(task.dueDate));
  const end   = task.dueDate
    ? (task.dueDate?.toDate   ? task.dueDate.toDate()   : new Date(task.dueDate))
    : start;

  start.setHours(0,0,0,0); end.setHours(23,59,59,999);

  const visStart = Math.max(start.getTime(), startWindow.getTime());
  const visEnd   = Math.min(end.getTime(), endWindow.getTime());

  if (visEnd < visStart) return 0;
  const days = (visEnd - visStart) / (1000*60*60*24);
  return Math.round(days * dayW);
}

function renderTodayLine(today, startWindow, dayW) {
  const diff = (today - startWindow) / (1000*60*60*24);
  if (diff < 0) return '';
  const left = Math.round(diff * dayW);
  return `<div class="timeline-today-line" style="left:${left}px;"></div>`;
}

/* ─── Subtask touchpoints ─────────────────────────────────
 * Renderiza cada subtarefa como um ponto visual na linha
 * da tarefa. Se a subtarefa tem `dueDate` própria, ela é
 * posicionada nesse dia; caso contrário, é distribuída
 * uniformemente ao longo da barra da tarefa.
 * Dots concluídos aparecem preenchidos em verde; pendentes
 * ficam vazados com a cor da tarefa.
 */
function renderSubtaskDots(task, startWindow, endWindow, dayW, barLeft, barWidth) {
  const subs = Array.isArray(task.subtasks) ? task.subtasks : [];
  if (!subs.length) return '';

  // Garante ao menos 1px de largura para evitar divisão por zero quando
  // a tarefa não tem intervalo (ex: apenas dueDate).
  const effWidth = Math.max(barWidth, 1);

  // Para subtarefas sem dueDate própria, distribui igualmente entre
  // (barLeft + margem) e (barLeft + effWidth - margem).
  const evenSpaced = [];
  const datedSubs  = [];
  subs.forEach((s, i) => {
    if (s.dueDate) datedSubs.push({ s, i });
    else evenSpaced.push({ s, i });
  });

  const dots = [];

  // Datadas: posiciona pelo dueDate dentro da janela visível
  datedSubs.forEach(({ s }) => {
    const d = new Date(s.dueDate);
    if (isNaN(d.getTime())) return;
    d.setHours(0, 0, 0, 0);
    if (d < startWindow || d > endWindow) return;
    const diff = (d - startWindow) / (1000 * 60 * 60 * 24);
    const left = Math.round(diff * dayW);
    dots.push(buildSubtaskDotHTML(s, left, 'dated', task.id));
  });

  // Sem data: distribui ao longo da barra
  if (evenSpaced.length && effWidth > 0) {
    const pad = 6;
    const usable = Math.max(effWidth - pad * 2, 0);
    evenSpaced.forEach((entry, idx) => {
      const step = evenSpaced.length > 1 ? usable / (evenSpaced.length - 1) : 0;
      const offset = evenSpaced.length === 1 ? usable / 2 : step * idx;
      const left = Math.round(barLeft + pad + offset);
      dots.push(buildSubtaskDotHTML(entry.s, left, 'auto', task.id));
    });
  }

  return dots.join('');
}

function renderSubtaskBadge(task) {
  const subs = Array.isArray(task.subtasks) ? task.subtasks : [];
  if (!subs.length) return '';
  const done  = subs.filter(s => s.done).length;
  const total = subs.length;
  const pct   = Math.round((done / total) * 100);
  return `<span class="tl-subtask-badge" title="${done} de ${total} subtarefas concluídas (${pct}%)">
    ◎ ${done}/${total}
  </span>`;
}

function buildSubtaskDotHTML(sub, left, mode, taskId) {
  const done   = !!sub.done;
  const title  = esc(sub.title || '').replace(/"/g, '');
  const dueTxt = sub.dueDate
    ? new Date(sub.dueDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    : '';
  const tooltip = dueTxt
    ? `${title} · ${dueTxt}${done ? ' ✓' : ''}`
    : `${title}${done ? ' ✓' : ''}`;
  return `<div class="timeline-subtask-dot ${done ? 'done' : ''} ${mode}"
    data-task-id="${taskId}"
    data-sub-id="${esc(sub.id || '')}"
    style="left:${left}px;"
    title="${tooltip}"></div>`;
}
