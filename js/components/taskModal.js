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
  NEWSLETTER_STATUSES, TASK_TYPES, REQUESTING_AREAS, NUCLEOS,
} from '../services/tasks.js';
import { fetchProjects }  from '../services/projects.js';
import { getTaskType }    from '../services/taskTypes.js';
import {
  renderTypeFields, collectFieldValues,
  bindDynamicFieldEvents, validateRequiredFields,
} from './dynamicFields.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

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

  // Sanitize taskData — ensure arrays are always arrays (protects against undefined from external callers)
  let task = isEdit ? {
    tags:        [],
    assignees:   [],
    subtasks:    [],
    comments:    [],
    nucleos:     [],
    customFields:{},
    ...taskData,
    tags:        Array.isArray(taskData?.tags)      ? taskData.tags      : [],
    assignees:   Array.isArray(taskData?.assignees) ? taskData.assignees : [],
    subtasks:    Array.isArray(taskData?.subtasks)  ? taskData.subtasks  : [],
    comments:    Array.isArray(taskData?.comments)  ? taskData.comments  : [],
    nucleos:     Array.isArray(taskData?.nucleos)   ? taskData.nucleos   : [],
    customFields: taskData?.customFields || {},
  } : {
    title:'', description:'', status, priority:'medium',
    projectId: projectId||null, assignees:[], tags:[],
    startDate:null, dueDate:null, subtasks:[], comments:[],
    type:'', newsletterStatus:'', requestingArea:'', clientEmail:'',
    nucleos:[], outOfCalendar:false,
    workspaceId: store.get('currentWorkspace')?.id || null,
    typeId:      typeId || null,
    customFields: {},
  };

  // Load current task type for dynamic fields
  const currentTypeId = task.typeId || (task.type && task.type !== '' ? task.type : null);
  let currentTaskType = null;
  if (currentTypeId) {
    currentTaskType = await getTaskType(currentTypeId).catch(() => null);
  }

  let currentTags      = [...(task.tags||[])];
  let currentAssignees = [...(task.assignees||[])];

  const m = modal.open({
    title: isEdit ? 'Detalhes da Tarefa' : 'Nova Tarefa',
    size: 'xl',
    content: buildHTML(task, users, projects, currentTags, currentAssignees, isEdit, currentTaskType),
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
          const modalEl = document.querySelector('.modal-body');
          await handleSave(task, currentTags, currentAssignees, isEdit, close, onSave, modalEl);
        } },
    ],
  });

  // Bind events after next paint — use requestAnimationFrame for reliability
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      bindEvents(task, users, currentTags, currentAssignees, isEdit);
    });
  });
}

function buildHTML(task, users, projects, tags, assignees, isEdit, taskType = null) {
  const opt = (arr, valKey, labelKey, cur) => arr.map(x =>
    `<option value="${x[valKey]}" ${cur===x[valKey]?'selected':''}>${esc(x[labelKey])}</option>`
  ).join('');

  const projectOpts = `<option value="">— Sem projeto —</option>` +
    projects.map(p => `<option value="${p.id}" ${task.projectId===p.id?'selected':''}>${esc(p.icon||'')} ${esc(p.name)}</option>`).join('');

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

      <!-- SLA badge (quando há tipo) -->
      <div id="tm-sla-badge" style="display:${taskType?.sla?'block':'none'};">
        ${taskType?.sla ? `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;
            background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.25);
            border-radius:var(--radius-md);font-size:0.8125rem;color:var(--text-secondary);">
            <span style="color:var(--brand-gold);">⏱</span>
            SLA: <strong style="color:var(--text-primary);">${esc(taskType.sla.label)}</strong>
          </div>
        ` : ''}
      </div>

      <!-- Campos dinâmicos do tipo selecionado -->
      <div id="tm-dynamic-fields">
        ${renderTypeFields(taskType, task.customFields || {})}
      </div>

      <!-- Campos legados (núcleos — mantidos até Fase 3) -->
      <div class="task-detail-field">
        <div class="task-detail-label">Núcleos</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;padding:6px 0;">
          ${NUCLEOS.map(n => {
            const checked = (task.nucleos||[]).includes(n.value);
            return `<label style="display:flex;align-items:center;gap:5px;cursor:pointer;
              padding:4px 10px;border-radius:var(--radius-full);font-size:0.8125rem;
              border:1px solid ${checked?'var(--brand-gold)':'var(--border-subtle)'};
              background:${checked?'rgba(212,168,67,0.12)':'var(--bg-surface)'};
              color:${checked?'var(--brand-gold)':'var(--text-secondary)'};
              transition:all 0.15s;" class="nucleo-chip">
              <input type="checkbox" value="${n.value}" class="tm-nucleo-check" ${checked?'checked':''}
                style="display:none;" />
              ${esc(n.label)}
            </label>`;
          }).join('')}
        </div>
      </div>
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

  // Type change → reload dynamic fields
  document.getElementById('tm-type-id')?.addEventListener('change', async (e) => {
    const typeId   = e.target.value;
    const typeDoc  = typeId ? await getTaskType(typeId).catch(()=>null) : null;
    const dynEl    = document.getElementById('tm-dynamic-fields');
    const slaEl    = document.getElementById('tm-sla-badge');

    if (dynEl) {
      dynEl.innerHTML = renderTypeFields(typeDoc, {});
      bindDynamicFieldEvents(dynEl);
    }
    if (slaEl) {
      slaEl.style.display = typeDoc?.sla ? 'block' : 'none';
      if (typeDoc?.sla) {
        slaEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;
          background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.25);
          border-radius:var(--radius-md);font-size:0.8125rem;color:var(--text-secondary);">
          <span style="color:var(--brand-gold);">⏱</span>
          SLA: <strong style="color:var(--text-primary);">${typeDoc.sla.label}</strong>
        </div>`;
      }
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
  const title=ctx.querySelector('#tm-title')?.value?.trim();
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

  const data={
    title,
    description:  ctx.querySelector('#tm-desc')?.value?.trim()||'',
    status:       ctx.querySelector('#tm-status')?.value||'not_started',
    priority:     ctx.querySelector('#tm-priority')?.value||'medium',
    projectId:    ctx.querySelector('#tm-project')?.value||null,
    typeId:       typeIdVal || null,
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
