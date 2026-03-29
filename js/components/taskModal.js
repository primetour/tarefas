/**
 * PRIMETOUR — Task Modal (revisado)
 */

import { modal }  from './modal.js';
import { toast }  from './toast.js';
import { store }  from '../store.js';
import {
  createTask, updateTask, deleteTask,
  addSubtask, toggleSubtask, addComment,
  STATUSES, PRIORITIES,
  NEWSLETTER_STATUSES, TASK_TYPES, REQUESTING_AREAS,
} from '../services/tasks.js';
import { fetchProjects }  from '../services/projects.js';
import { getTaskType }    from '../services/taskTypes.js';
import {
  renderTypeFields, collectFieldValues,
  bindDynamicFieldEvents, validateRequiredFields,
} from './dynamicFields.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cleanVarName = s => String(s||'').replace(/\s*[·•]\s*\d+d\s*$|\s*[·•]\s*mesmo dia\s*$/i, '').trim();

function fmtDate(ts) {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return isNaN(d) ? '' : new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);
}

function toInputDate(ts) {
  if (!ts) return '';
  try {
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  } catch { return ''; }
}

function getInitials(name) {
  return (name||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
}

export async function openTaskModal({ taskData=null, projectId=null, status='not_started', onSave=null, typeId=null } = {}) {
  // isEdit only when taskData has a real Firestore id (not a prefill from requests portal)
  const isEdit = !!(taskData?.id);

  let users = store.get('users') || [];
  if (!users.length) {
    try {
      const { collection, getDocs, query, orderBy } =
        await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const { db } = await import('../firebase.js');
      const snap = await getDocs(query(collection(db,'users'), orderBy('name','asc')));
      users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      store.set('users', users);
    } catch(e) { console.warn('users load error:', e.message); }
  }

  const projects = await fetchProjects().catch(() => []);

  // Ensure task types are loaded — critical for variation cascade
  if (!(store.get('taskTypes') || []).length) {
    try {
      const { loadTaskTypes } = await import('../services/taskTypes.js');
      await loadTaskTypes();
    } catch(e) {}
  }

  // Sanitize taskData — ensure arrays are always arrays
  const sanitize = (td) => ({
    title:'', description:'', status, priority:'medium',
    projectId: projectId||null, assignees:[], tags:[],
    startDate:null, dueDate:null, subtasks:[], comments:[],
    type:'', newsletterStatus:'', requestingArea:'', clientEmail:'',
    nucleos:[], outOfCalendar:false,
    workspaceId: store.get('currentWorkspace')?.id || null,
    typeId: typeId || null,
    customFields: {},
    goalId: null,
    ...(td || {}),
    // Always sanitize arrays regardless of source
    tags:         Array.isArray(td?.tags)        ? td.tags        : [],
    assignees:    Array.isArray(td?.assignees)    ? td.assignees   : [],
    subtasks:     Array.isArray(td?.subtasks)     ? td.subtasks    : [],
    comments:     Array.isArray(td?.comments)     ? td.comments    : [],
    nucleos:      Array.isArray(td?.nucleos)      ? td.nucleos     : [],
    customFields: td?.customFields || {},
  });

  let task = sanitize(taskData);

  // Load current task type for dynamic fields
  const currentTypeId = task.typeId || (task.type && task.type !== '' ? task.type : null);
  let currentTaskType = null;
  if (currentTypeId) {
    currentTaskType = await getTaskType(currentTypeId).catch(() => null);
  }

  let currentTags      = [...(task.tags||[])];
  let currentAssignees = [...(task.assignees||[])];

  const isPrefill = !!(taskData && !taskData.id); // has data but no Firestore id
  const modalTitle = isEdit
    ? 'Detalhes da Tarefa'
    : isPrefill
      ? 'Nova Tarefa — a partir de solicitação'
      : 'Nova Tarefa';

  const m = modal.open({
    title: modalTitle,
    size: 'xl',
    content: buildHTML(task, users, projects, currentTags, currentAssignees, isEdit, currentTaskType,
      task.sector || currentTaskType?.sector || store.get('userSector') || null),
    footer: [
      ...(isEdit && store.can('task_delete') ? [{
        label:'🗑 Excluir', class:'btn-danger btn-sm', closeOnClick:false,
        onClick: async (_,{close}) => {
          if (await modal.confirm({ title:'Excluir tarefa', message:`Excluir "<strong>${esc(task.title)}</strong>"?`, confirmText:'Excluir', danger:true, icon:'🗑️' })) {
            try { await deleteTask(task.id); toast.success('Tarefa excluída.'); close(); onSave?.(); }
            catch(e) { toast.error(e.message); }
          }
        },
      }] : []),
      { label:'Cancelar', class:'btn-secondary', closeOnClick:true },
      { label: isEdit ? 'Salvar alterações' : 'Criar tarefa', class:'btn-primary', closeOnClick:false,
        onClick: async (_,{close}) => {
          const modalEl = document.querySelector('.modal-body') || document.querySelector('.modal') || document;
          await handleSave(task, currentTags, currentAssignees, isEdit, close, onSave, modalEl);
        } },
    ],
  });

  // Bind events after next paint — use requestAnimationFrame for reliability
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      bindEvents(task, users, currentTags, currentAssignees, isEdit);

      // Populate goal selector async (non-blocking)
      import('../services/goals.js').then(({ fetchGoals }) => {
        return fetchGoals();
      }).then(goals => {
        const published = goals.filter(g => g.status === 'publicada');
        const sel = document.getElementById('tm-goal');
        if (!sel) return;
        sel.innerHTML = '<option value="">Sem meta vinculada</option>' +
          published.map(g =>
            `<option value="${g.id}" ${task.goalId === g.id ? 'selected' : ''}>${
              g.titulo || g.id
            }</option>`
          ).join('');
      }).catch(() => {});
    });
  });
}

function buildHTML(task, users, projects, tags, assignees, isEdit, taskType = null, taskSector = null) {
  const opt = (arr, valKey, labelKey, cur) => arr.map(x =>
    `<option value="${x[valKey]}" ${cur===x[valKey]?'selected':''}>${esc(x[labelKey])}</option>`
  ).join('');

  const projectOpts = `<option value="">— Sem projeto —</option>` +
    projects
      .filter(p => !p.sector || !taskSector || p.sector === taskSector)
      .map(p => `<option value="${p.id}" ${task.projectId===p.id?'selected':''}>${esc(p.icon||'')} ${esc(p.name)}</option>`).join('');

  const areaOpts = `<option value="">— Selecione —</option>` +
    REQUESTING_AREAS.map(a => `<option value="${a}" ${task.requestingArea===a?'selected':''}>${esc(a)}</option>`).join('');

  const tagsHTML = tags.map(t => {
    const hue = [...t].reduce((a,c)=>a+c.charCodeAt(0),0)%360;
    return `<div class="tag-chip" data-tag="${esc(t)}" style="background:hsl(${hue},40%,25%);color:hsl(${hue},70%,75%);border:1px solid hsl(${hue},40%,35%);">${esc(t)}<button class="tag-chip-remove">✕</button></div>`;
  }).join('');

  // Filter users by visible sectors
  const visibleSectors = store.get('visibleSectors') || [];
  const activeUsers = users.filter(u => {
    if (u.active === false) return false;
    if (store.isMaster() || !visibleSectors.length) return true;
    const uSector = u.sector || u.department;
    return !uSector || visibleSectors.includes(uSector);
  });
  const assigneeChips = assignees.map(uid => {
    const u = activeUsers.find(u=>u.id===uid);
    if (!u) return '';
    return `<div class="assignee-chip" data-uid="${uid}">
      <div class="avatar" style="background:${u.avatarColor||'#3B82F6'};width:20px;height:20px;font-size:0.5rem;">${getInitials(u.name)}</div>
      ${esc(u.name.split(' ')[0])}<span style="font-size:0.7rem;opacity:0.6;">✕</span></div>`;
  }).join('');

  const userListHTML = activeUsers.length
    ? activeUsers.map(u => `
        <div class="dropdown-item" data-add-uid="${u.id}" style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 12px;">
          <div class="avatar avatar-sm" style="background:${u.avatarColor||'#3B82F6'};flex-shrink:0;">${getInitials(u.name)}</div>
          <div>
            <div style="font-size:0.875rem;color:var(--text-primary);">${esc(u.name)}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);">${esc(u.department||u.role||'')}</div>
          </div>
        </div>`).join('')
    : `<div style="padding:12px;color:var(--text-muted);font-size:0.875rem;">Nenhum usuário ativo.</div>`;

  return `<div class="task-modal-grid">
    <div class="task-modal-main">
      <input type="text" id="tm-title" class="task-modal-title-input"
        placeholder="Título da tarefa..." value="${esc(task.title)}" maxlength="200" />
      <span class="form-error-msg" id="tm-title-error"></span>
      <div class="form-group mt-4">
        <label class="form-label">Descrição</label>
        <textarea id="tm-desc" class="form-textarea" rows="3"
          placeholder="Descreva a tarefa...">${esc(task.description)}</textarea>
      </div>
      ${isEdit ? `
        <div class="task-detail-field">
          <div class="task-detail-label">Subtarefas <span class="subtask-progress" id="subtask-progress">${getSubtaskProgress(task.subtasks||[])}</span></div>
          <div class="subtask-list" id="subtask-list">${renderSubtasks(task.subtasks||[])}</div>
          <div class="quick-add-bar">
            <span style="color:var(--text-muted);font-size:1rem;">+</span>
            <input type="text" class="quick-add-input" id="subtask-input" placeholder="Adicionar subtarefa... (Enter)" maxlength="200" />
          </div>
        </div>
        <div class="task-detail-field mt-6">
          <div class="task-detail-label">Comentários</div>
          <div class="comment-list" id="comment-list">${renderComments(task.comments||[])}</div>
          <div class="comment-input-area">
            <div class="avatar avatar-sm" style="background:${store.get('userProfile')?.avatarColor||'#3B82F6'};flex-shrink:0;">
              ${getInitials(store.get('userProfile')?.name||'')}
            </div>
            <textarea id="comment-input" class="comment-input" rows="1" placeholder="Comentário... (Ctrl+Enter)"></textarea>
            <button class="btn btn-primary btn-sm" id="comment-send-btn">Enviar</button>
          </div>
        </div>` : ''}
    </div>

    <div class="task-modal-sidebar">
      <div class="task-detail-field">
        <div class="task-detail-label">Status</div>
        <select class="form-select" id="tm-status" style="padding:8px 32px 8px 12px;">
          ${opt(STATUSES,'value','label',task.status)}
        </select>
      </div>
      <div class="task-detail-field">
        <div class="task-detail-label">Prioridade</div>
        <select class="form-select" id="tm-priority" style="padding:8px 32px 8px 12px;">
          ${PRIORITIES.map(p=>`<option value="${p.value}" ${task.priority===p.value?'selected':''}>${p.icon} ${p.label}</option>`).join('')}
        </select>
      </div>
      <!-- Tipo de tarefa -->
      <div class="task-detail-field">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
          <span class="task-detail-label" style="margin:0;">Tipo de tarefa</span>
        </div>
        <select class="form-select" id="tm-type-id" style="padding:8px 32px 8px 12px;">
          <option value="">— Padrão (sem tipo) —</option>
          ${(store.get('taskTypes')||[]).map(t =>
            `<option value="${t.id}" ${(task.typeId||task.type)===t.id?'selected':''}
              style="color:${t.color||'inherit'};">${esc(t.icon||'')} ${esc(t.name)}</option>`
          ).join('')}
        </select>
      </div>

      <!-- Variação do material -->
      <div class="task-detail-field" id="tm-variation-group"
        style="display:${taskType?.variations?.length?'block':'none'};">
        <div style="margin-bottom:5px;">
          <span class="task-detail-label">Variação do material</span>
        </div>
        <select class="form-select" id="tm-variation" style="padding:8px 32px 8px 12px;">
          <option value="">— Selecione a variação —</option>
          ${(taskType?.variations||[]).map(v =>
            `<option value="${v.id}" data-sla="${v.slaDays}"
              ${task.variationId===v.id?'selected':''}>${esc(cleanVarName(v.name))}</option>`
          ).join('')}
        </select>
      </div>

      <!-- SLA badge — shown immediately if editing with a saved variation -->
      ${(() => {
        if (!task.variationId || !taskType?.variations?.length) return '<div id="tm-sla-badge" style="display:none;"></div>';
        const v = taskType.variations.find(x => x.id === task.variationId);
        if (!v) return '<div id="tm-sla-badge" style="display:none;"></div>';
        const label = v.slaDays === 0 ? 'Mesmo dia' : `${v.slaDays} dia${v.slaDays !== 1 ? 's' : ''}`;
        return `<div id="tm-sla-badge" style="display:block;">
          <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;
            background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.25);
            border-radius:var(--radius-md);font-size:0.8125rem;color:var(--text-secondary);">
            <span style="color:var(--brand-gold);">⏱</span>
            SLA da variação: <strong style="color:var(--text-primary);">${label}</strong>
          </div>
        </div>`;
      })()}

      <!-- Campos dinâmicos do tipo selecionado -->
      <div id="tm-dynamic-fields">
        ${renderTypeFields(taskType, task.customFields || {})}
      </div>

      <!-- Núcleos — usa coleção do Firestore, filtrada pelo setor da tarefa -->
      ${(() => {
        const allNucleos = store.get('nucleos') || [];
        const filtered   = taskSector
          ? allNucleos.filter(n => !n.sector || n.sector === taskSector)
          : allNucleos;
        if (!filtered.length) return '';
        const chips = filtered.map(n => {
          const nid     = n.id || n.name;
          const checked = (task.nucleos||[]).includes(nid) || (task.nucleos||[]).includes(n.name);
          const border  = checked ? 'var(--brand-gold)' : 'var(--border-subtle)';
          const bg      = checked ? 'rgba(212,168,67,0.12)' : 'var(--bg-surface)';
          const color   = checked ? 'var(--brand-gold)'     : 'var(--text-secondary)';
          return '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;' +
            'padding:4px 10px;border-radius:var(--radius-full);font-size:0.8125rem;' +
            'border:1px solid ' + border + ';background:' + bg + ';color:' + color + ';' +
            'transition:all 0.15s;" class="nucleo-chip">' +
            '<input type="checkbox" value="' + nid + '" class="tm-nucleo-check" ' + (checked ? 'checked' : '') +
            ' style="display:none;" />' +
            esc(n.name) + '</label>';
        }).join('');
        return '<div class="task-detail-field">' +
          '<div class="task-detail-label">Núcleos</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:6px;padding:6px 0;">' + chips + '</div></div>';
      })()}
      ${(() => {
        const workspaces  = store.get('userWorkspaces') || [];
        const currentWsId = task.workspaceId || store.get('currentWorkspace')?.id;
        const wsName      = workspaces.find(w => w.id === currentWsId)?.name || '';
        if (isEdit && wsName) {
          return `<div class="task-detail-field">
            <div class="task-detail-label">Workspace</div>
            <div class="task-detail-value" style="font-size:0.875rem;color:var(--text-secondary);">${esc(wsName)}</div>
          </div>`;
        } else if (!isEdit && workspaces.length > 1) {
          return `<div class="task-detail-field">
            <div class="task-detail-label">Workspace</div>
            <select class="form-select" id="tm-workspace" style="padding:8px 32px 8px 12px;">
              ${workspaces.map(w => `<option value="${w.id}" ${currentWsId===w.id?'selected':''}>${esc(w.name)}</option>`).join('')}
            </select>
          </div>`;
        }
        return '';
      })()}
      <div class="task-detail-field">
        <div class="task-detail-label">Área solicitante</div>
        <select class="form-select" id="tm-area" style="padding:8px 32px 8px 12px;">
          ${areaOpts}
        </select>
      </div>
      <div class="task-detail-field">
        <div class="task-detail-label">Projeto</div>
        <select class="form-select" id="tm-project" style="padding:8px 32px 8px 12px;">
          ${projectOpts}
        </select>
      </div>
      <div class="task-detail-field">
        <div class="task-detail-label">Meta vinculada</div>
        <select class="form-select" id="tm-goal" style="padding:8px 32px 8px 12px;">
          <option value="">Sem meta vinculada</option>
          <!-- populated async -->
        </select>
      </div>
      <div class="task-detail-field">
        <div class="task-detail-label">Responsáveis</div>
        <div class="assignee-picker" id="assignee-picker">
          ${assigneeChips}
          <button class="assignee-add-btn" id="assignee-add-btn" title="Adicionar">+</button>
        </div>
        <div id="assignee-dropdown" style="display:none;margin-top:6px;">
          <div style="background:var(--bg-elevated);border:1px solid var(--border-default);border-radius:var(--radius-md);max-height:200px;overflow-y:auto;">
            ${userListHTML}
          </div>
        </div>
      </div>
      <div class="task-detail-field">
        <div class="task-detail-label">Data de início</div>
        <input type="date" class="form-input" id="tm-start" style="padding:8px 12px;"
          value="${toInputDate(task.startDate)}" />
      </div>
      <div class="task-detail-field">
        <div class="task-detail-label">Prazo de entrega</div>
        <input type="date" class="form-input" id="tm-due" style="padding:8px 12px;"
          value="${toInputDate(task.dueDate)}" />
      </div>
      <div class="task-detail-field">
        <div class="task-detail-label">Tags</div>
        <div class="tag-input-area" id="tag-input-area">
          <div id="tag-chips">${tagsHTML}</div>
          <input type="text" class="tag-input-field" id="tag-input" placeholder="Tag + Enter..." maxlength="30" />
        </div>
      </div>
      <div class="task-detail-field">
        <div class="task-detail-label">E-mail do cliente <span style="font-size:0.625rem;color:var(--text-muted);">(CSAT)</span></div>
        <input type="email" class="form-input" id="tm-client-email" style="padding:8px 12px;"
          value="${esc(task.clientEmail||'')}" placeholder="cliente@empresa.com" />
      </div>
      ${isEdit ? `
        <div class="task-detail-field">
          <div class="task-detail-label">Criada em</div>
          <div class="task-detail-value">${fmtDate(task.createdAt)}</div>
        </div>
        ${task.completedAt ? `<div class="task-detail-field">
          <div class="task-detail-label">Concluída em</div>
          <div class="task-detail-value" style="color:var(--color-success);">${fmtDate(task.completedAt)}</div>
        </div>` : ''}` : ''}
    </div>
  </div>`;
}

function bindEvents(task, users, currentTags, currentAssignees, isEdit) {
  // Tags
  document.getElementById('tag-input')?.addEventListener('keydown', (e) => {
    if ((e.key==='Enter'||e.key===',') && e.target.value.trim()) {
      e.preventDefault();
      const tag = e.target.value.trim().replace(/,/g,'').slice(0,30);
      if (tag && !currentTags.includes(tag)) {
        currentTags.push(tag);
        const hue = [...tag].reduce((a,c)=>a+c.charCodeAt(0),0)%360;
        document.getElementById('tag-chips')?.insertAdjacentHTML('beforeend',
          `<div class="tag-chip" data-tag="${esc(tag)}" style="background:hsl(${hue},40%,25%);color:hsl(${hue},70%,75%);border:1px solid hsl(${hue},40%,35%);">${esc(tag)}<button class="tag-chip-remove">✕</button></div>`);
      }
      e.target.value = '';
    }
  });
  document.getElementById('tag-input-area')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.tag-chip-remove');
    if (btn) { const chip=btn.closest('.tag-chip'); const tag=chip?.dataset.tag; if(tag){const idx=currentTags.indexOf(tag);if(idx>-1)currentTags.splice(idx,1);chip.remove();} }
  });

  // Nucleo chip toggle (legacy)
  document.querySelectorAll('.nucleo-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const cb = chip.querySelector('.tm-nucleo-check');
      if (!cb) return;
      cb.checked             = !cb.checked;
      chip.style.borderColor = cb.checked ? 'var(--brand-gold)' : 'var(--border-subtle)';
      chip.style.background  = cb.checked ? 'rgba(212,168,67,0.12)' : 'var(--bg-surface)';
      chip.style.color       = cb.checked ? 'var(--brand-gold)' : 'var(--text-secondary)';
    });
  });

  // Bind dynamic field chips
  bindDynamicFieldEvents(document);

  // Type change → reload dynamic fields + variation dropdown
  document.getElementById('tm-type-id')?.addEventListener('change', async (e) => {
    const typeId   = e.target.value;
    // Try store first (fast), then Firestore
    const typeDoc  = typeId
      ? ((store.get('taskTypes')||[]).find(t=>t.id===typeId) || await getTaskType(typeId).catch(()=>null))
      : null;
    const dynEl    = document.getElementById('tm-dynamic-fields');
    const slaEl    = document.getElementById('tm-sla-badge');
    const varGroup = document.getElementById('tm-variation-group');
    const varSel   = document.getElementById('tm-variation');

    // Dynamic fields
    if (dynEl) { dynEl.innerHTML = renderTypeFields(typeDoc, {}); bindDynamicFieldEvents(dynEl); }

    // Variation dropdown
    const variations = typeDoc?.variations || [];
    if (varGroup) varGroup.style.display = variations.length ? 'block' : 'none';
    if (varSel) {
      varSel.innerHTML = '<option value="">— Selecione a variação —</option>' +
        variations.map(v =>
          `<option value="${v.id}" data-sla="${v.slaDays}">${esc(cleanVarName(v.name))}</option>`
        ).join('');
    }

    // Clear SLA badge when type changes
    if (slaEl) { slaEl.style.display = 'none'; slaEl.innerHTML = ''; }
  });

  // Variation change → show SLA badge + auto-fill due date
  document.getElementById('tm-variation')?.addEventListener('change', (e) => {
    const sel    = e.target;
    const opt    = sel.selectedOptions[0];
    const days   = parseInt(opt?.dataset?.sla);
    const slaEl  = document.getElementById('tm-sla-badge');
    const dueEl  = document.getElementById('tm-due');

    if (opt?.value && !isNaN(days) && slaEl) {
      const label = days === 0 ? 'Mesmo dia' : `${days} dia${days!==1?'s':''}`;
      slaEl.style.display = 'block';
      slaEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;
        background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.25);
        border-radius:var(--radius-md);font-size:0.8125rem;color:var(--text-secondary);">
        <span style="color:var(--brand-gold);">⏱</span>
        SLA da variação: <strong style="color:var(--text-primary);">${label}</strong>
      </div>`;
      // Auto-fill due date if empty
      if (dueEl && !dueEl.value) {
        const due = new Date();
        if (days === 0) {
          dueEl.value = due.toISOString().slice(0, 10);
        } else {
          let biz = days;
          while (biz > 0) {
            due.setDate(due.getDate() + 1);
            const dow = due.getDay();
            if (dow !== 0 && dow !== 6) biz--;
          }
          dueEl.value = due.toISOString().slice(0, 10);
        }
      }
    } else if (slaEl) {
      slaEl.style.display = 'none';
      slaEl.innerHTML = '';
    }
  });

  // Assignees
  document.getElementById('assignee-add-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = document.getElementById('assignee-dropdown');
    if (dd) dd.style.display = dd.style.display==='none' ? 'block' : 'none';
  });
  document.getElementById('assignee-dropdown')?.addEventListener('click', (e) => {
    const item = e.target.closest('[data-add-uid]');
    if (!item) return;
    const uid = item.dataset.addUid;
    if (!currentAssignees.includes(uid)) {
      currentAssignees.push(uid);
      const u = users.find(u=>u.id===uid);
      if (u) {
        const el = document.createElement('div');
        el.className='assignee-chip'; el.dataset.uid=uid;
        el.innerHTML=`<div class="avatar" style="background:${u.avatarColor||'#3B82F6'};width:20px;height:20px;font-size:0.5rem;">${getInitials(u.name)}</div>${esc(u.name.split(' ')[0])}<span style="font-size:0.7rem;opacity:0.6;">✕</span>`;
        const btn=document.getElementById('assignee-add-btn');
        document.getElementById('assignee-picker')?.insertBefore(el,btn);
      }
    }
    document.getElementById('assignee-dropdown').style.display='none';
  });
  document.getElementById('assignee-picker')?.addEventListener('click', (e) => {
    const chip=e.target.closest('.assignee-chip[data-uid]');
    if (chip){const uid=chip.dataset.uid;const i=currentAssignees.indexOf(uid);if(i>-1)currentAssignees.splice(i,1);chip.remove();}
  });
  document.addEventListener('click', () => { const dd=document.getElementById('assignee-dropdown'); if(dd)dd.style.display='none'; });

  if (!isEdit) return;

  // Subtasks
  document.getElementById('subtask-input')?.addEventListener('keydown', async (e) => {
    if (e.key==='Enter') {
      const val=e.target.value.trim(); if(!val)return; e.preventDefault();
      try {
        const sub=await addSubtask(task.id,val);
        task.subtasks=[...(task.subtasks||[]),sub]; e.target.value='';
        document.getElementById('subtask-list')?.insertAdjacentHTML('beforeend',renderSubtaskItem(sub));
        const el=document.getElementById('subtask-progress'); if(el)el.textContent=getSubtaskProgress(task.subtasks);
      } catch(err){toast.error(err.message);}
    }
  });
  document.getElementById('subtask-list')?.addEventListener('click', async (e) => {
    const check=e.target.closest('.task-check[data-sub-id]'); if(!check)return;
    try {
      task.subtasks=await toggleSubtask(task.id,check.dataset.subId,task.subtasks);
      const sub=task.subtasks.find(s=>s.id===check.dataset.subId);
      const row=check.closest('.subtask-item');
      if(sub?.done){check.classList.add('checked');check.textContent='✓';row?.classList.add('done');}
      else{check.classList.remove('checked');check.textContent='';row?.classList.remove('done');}
      const el=document.getElementById('subtask-progress'); if(el)el.textContent=getSubtaskProgress(task.subtasks);
    } catch(err){toast.error(err.message);}
  });

  // Comments
  const send = async () => {
    const inp=document.getElementById('comment-input'); const text=inp?.value?.trim(); if(!text)return;
    try {
      const cmt=await addComment(task.id,text); task.comments=[...(task.comments||[]),cmt]; inp.value='';
      const list=document.getElementById('comment-list');
      if(list){list.insertAdjacentHTML('beforeend',renderCommentItem(cmt));list.scrollTo({top:list.scrollHeight,behavior:'smooth'});}
    } catch(err){toast.error(err.message);}
  };
  document.getElementById('comment-send-btn')?.addEventListener('click',send);
  document.getElementById('comment-input')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.ctrlKey)send();});
}

async function handleSave(task, tags, assignees, isEdit, close, onSave, ctx=document) {
  // Ensure ctx is a valid element - fallback to document
  if (!ctx || typeof ctx.querySelector !== 'function') ctx = document;
  const title=ctx.querySelector('#tm-title')?.value?.trim() || document.getElementById('tm-title')?.value?.trim();
  const errEl=ctx.querySelector('#tm-title-error');
  if(!title){if(errEl)errEl.textContent='Título é obrigatório.';return;}
  if(errEl)errEl.textContent='';

  const startVal   = ctx.querySelector('#tm-start')?.value;
  const dueVal     = ctx.querySelector('#tm-due')?.value;
  const typeIdVal  = ctx.querySelector('#tm-type-id')?.value || '';
  const typeDoc    = typeIdVal ? (store.get('taskTypes')||[]).find(t=>t.id===typeIdVal) : null;

  // Validate required custom fields
  if (typeDoc) {
    const fieldErrors = validateRequiredFields(typeDoc, ctx);
    if (fieldErrors.length) { toast.warning(fieldErrors[0].message); return; }
  }

  // Collect dynamic field values
  const customFields = collectFieldValues(ctx);

  const variationId  = ctx.querySelector('#tm-variation')?.value || null;
  const variationOpt = ctx.querySelector('#tm-variation option:checked');
  const variationSLA = variationOpt ? parseInt(variationOpt.dataset?.sla) : null;

  // Sector: from task prefill → from typeDoc → from user's sector
  const taskSector = task.sector
    || typeDoc?.sector
    || store.get('userSector')
    || null;

  const data={
    title,
    description:  ctx.querySelector('#tm-desc')?.value?.trim()||'',
    goalId:       ctx.querySelector('#tm-goal')?.value || null,
    status:       ctx.querySelector('#tm-status')?.value||'not_started',
    priority:     ctx.querySelector('#tm-priority')?.value||'medium',
    projectId:    ctx.querySelector('#tm-project')?.value||null,
    typeId:       typeIdVal || null,
    sector:       taskSector,
    variationId:  variationId || null,
    variationName: variationOpt?.textContent?.split('·')[0]?.trim() || '',
    variationSLADays: isNaN(variationSLA) ? null : variationSLA,
    customFields,
    // Legacy fields — kept for backward compat
    type:             typeDoc?.name?.toLowerCase() || '',
    newsletterStatus: customFields.newsletterStatus || '',
    outOfCalendar:    customFields.outOfCalendar    || false,
    requestingArea:   ctx.querySelector('#tm-area')?.value||'',
    clientEmail:      ctx.querySelector('#tm-client-email')?.value?.trim()||'',
    workspaceId: ctx.querySelector('#tm-workspace')?.value
      || task.workspaceId
      || store.get('currentWorkspace')?.id
      || null,
    assignees,
    tags: Array.from(document.querySelectorAll('.tag-chip[data-tag]')).map(el => el.dataset.tag),
    startDate: startVal ? new Date(startVal+'T00:00:00') : null,
    dueDate:   dueVal   ? new Date(dueVal  +'T23:59:59') : null,
  };
  // Collect nucleos from legacy chips
  data.nucleos = Array.from(ctx.querySelectorAll('.tm-nucleo-check:checked')).map(cb => cb.value);

  if(isEdit) data._prevStatus=task.status;

  const btn=document.querySelector('.modal-footer .btn-primary');
  if(btn){btn.classList.add('loading');btn.disabled=true;}
  try {
    let savedTask;
    if(isEdit){
      await updateTask(task.id,data);
      toast.success('Tarefa atualizada!');
      savedTask = { id: task.id, ...data };
    } else {
      savedTask = await createTask(data);
      toast.success('Tarefa criada!');
    }
    close();

    // Double-check: task being marked done without goal link
    const isBeingCompleted = data.status === 'done' &&
      (!isEdit || task.status !== 'done');

    console.log('[taskModal] isBeingCompleted:', isBeingCompleted, '| status:', data.status, '| prev:', task.status, '| goalId:', data.goalId);

    if (isBeingCompleted && !data.goalId) {
      try {
        const { hasPublishedGoals } = await import('../services/goals.js');
        const hasPubGoals = await hasPublishedGoals();
        console.log('[taskModal] hasPubGoals:', hasPubGoals);
        if (hasPubGoals) {
          showEvidenceModal(savedTask?.id || task.id, data);
        }
      } catch(e) { console.warn('[taskModal] evidence check failed:', e); }
    } else if (isBeingCompleted && data.goalId) {
      showEvidenceModal(savedTask?.id || task.id, data);
    }

    onSave?.(savedTask?.id, savedTask);
  } catch(err){toast.error(err.message);}
  finally{if(btn){btn.classList.remove('loading');btn.disabled=false;}}
}

function getSubtaskProgress(subtasks) {
  if(!subtasks?.length)return '';
  return `${subtasks.filter(s=>s.done).length}/${subtasks.length}`;
}
function renderSubtasks(subtasks){return subtasks.map(s=>renderSubtaskItem(s)).join('');}
function renderSubtaskItem(s){
  return `<div class="subtask-item ${s.done?'done':''}" data-sub="${s.id}">
    <div class="task-check ${s.done?'checked':''}" data-sub-id="${s.id}">${s.done?'✓':''}</div>
    <span class="subtask-label">${esc(s.title)}</span></div>`;
}
function renderComments(comments){return comments.map(c=>renderCommentItem(c)).join('');}
function renderCommentItem(c){
  const time=c.createdAt?new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(c.createdAt?.toDate?c.createdAt.toDate():new Date(c.createdAt)):'';
  return `<div class="comment-item">
    <div class="avatar avatar-sm" style="background:${c.authorColor||'#3B82F6'};">${getInitials(c.authorName)}</div>
    <div class="comment-bubble">
      <div class="comment-header"><span class="comment-author">${esc(c.authorName)}</span><span class="comment-time">${time}</span></div>
      <p class="comment-text">${esc(c.text)}</p>
    </div></div>`;
}

/* ─── Evidence / goal double-check modal ──────────────────── */
async function showEvidenceModal(taskId, taskData) {
  const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const LBL = `font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;`;

  let goals = [];
  let periods = [];

  try {
    const { fetchGoals, generatePendingPeriods } = await import('../services/goals.js');
    goals = (await fetchGoals()).filter(g => g.status === 'publicada');
  } catch(e) { return; }

  const hasGoal = !!taskData.goalId;

  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:3000;
    display:flex;align-items:center;justify-content:center;padding:20px;`;

  const render = (selectedGoalId) => {
    const selGoal = goals.find(g => g.id === selectedGoalId);
    if (selGoal) {
      periods = generatePendingPeriods(selGoal);
    }

    overlay.innerHTML = `
      <div class="card" style="width:100%;max-width:500px;padding:0;overflow:hidden;">
        <div style="padding:16px 22px;background:var(--bg-surface);
          border-bottom:1px solid var(--border-subtle);">
          <div style="font-weight:700;font-size:1rem;margin-bottom:4px;">
            ${hasGoal ? '✅ Tarefa concluída — registrar evidência' : '⚠ Tarefa concluída sem meta vinculada'}
          </div>
          <div style="font-size:0.8125rem;color:var(--text-muted);">
            ${hasGoal
              ? 'Deseja registrar esta entrega como evidência da meta?'
              : 'Há metas publicadas no sistema. Esta tarefa deveria estar vinculada a alguma delas?'}
          </div>
        </div>
        <div style="padding:20px 22px;display:flex;flex-direction:column;gap:14px;">
          ${!hasGoal ? `
            <div>
              <label style="${LBL}">Vincular a uma meta</label>
              <select id="ev-goal-sel" class="filter-select" style="width:100%;">
                <option value="">Não está relacionada a nenhuma meta</option>
                ${goals.map(g => `<option value="${esc(g.id)}" ${taskData.goalId===g.id?'selected':''}>${esc(g.titulo)} — ${esc(g.responsavelNome||'')}</option>`).join('')}
              </select>
            </div>` : ''}
          <div id="ev-extra" style="${selectedGoalId || hasGoal ? '' : 'display:none;'}">
            <div>
              <label style="${LBL}">Período de referência</label>
              <select id="ev-periodo-sel" class="filter-select" style="width:100%;margin-bottom:8px;">
                <option value="">Selecione o período…</option>
                ${periods.map(p => `<option value="${esc(p.label)}">${esc(p.label)}</option>`).join('')}
                <option value="custom">Informar manualmente…</option>
              </select>
              <input type="text" id="ev-periodo-custom" class="portal-field" style="width:100%;display:none;"
                placeholder="Ex: Relatório de produtividade — Abril 2025">
            </div>
            <div>
              <label style="${LBL};margin-top:10px;">Link de comprovação <span style="font-weight:400;color:var(--text-muted);">(opcional)</span></label>
              <input type="url" id="ev-link" class="portal-field" style="width:100%;"
                placeholder="https://…" value="${esc(taskData.linkComprovacao||'')}">
            </div>
          </div>
        </div>
        <div style="padding:14px 22px;border-top:1px solid var(--border-subtle);
          background:var(--bg-surface);display:flex;gap:8px;justify-content:flex-end;">
          <button id="ev-skip" class="btn btn-ghost btn-sm">Pular</button>
          <button id="ev-save" class="btn btn-primary btn-sm">
            ${selectedGoalId || hasGoal ? 'Registrar evidência' : 'Confirmar'}
          </button>
        </div>
      </div>`;

    // Wire goal selector
    document.getElementById('ev-goal-sel')?.addEventListener('change', e => {
      render(e.target.value);
    });

    // Wire period selector
    document.getElementById('ev-periodo-sel')?.addEventListener('change', e => {
      const custom = document.getElementById('ev-periodo-custom');
      if (custom) custom.style.display = e.target.value === 'custom' ? 'block' : 'none';
    });

    document.getElementById('ev-skip')?.addEventListener('click', () => overlay.remove());

    document.getElementById('ev-save')?.addEventListener('click', async () => {
      const goalId   = document.getElementById('ev-goal-sel')?.value || taskData.goalId || null;
      const periodSel = document.getElementById('ev-periodo-sel')?.value;
      const periodCustom = document.getElementById('ev-periodo-custom')?.value?.trim();
      const periodoRef = periodSel === 'custom' ? periodCustom : periodSel;
      const link = document.getElementById('ev-link')?.value?.trim() || '';

      if (goalId || hasGoal) {
        try {
          const { updateTask } = await import('../services/tasks.js');
          await updateTask(taskId, {
            goalId:               goalId || taskData.goalId,
            periodoRef:           periodoRef || '',
            linkComprovacao:      link,
            confirmadaEvidencia:  true,
          });
          toast.success('Evidência registrada!');
        } catch(e) { toast.error('Erro ao registrar evidência: ' + e.message); }
      }
      overlay.remove();
    });
  };

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  render(taskData.goalId || '');
}
