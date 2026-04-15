/**
 * PRIMETOUR — Task Modal (revisado)
 */

import { modal }  from './modal.js';
import { toast }  from './toast.js';
import { store }  from '../store.js';
import {
  createTask, updateTask, deleteTask,
  addSubtask, toggleSubtask, updateSubtaskDue, updateSubtaskTitle,
  updateSubtaskAssignees,
  deleteSubtask, reorderSubtasks, addComment,
  STATUSES, PRIORITIES,
  NEWSLETTER_STATUSES, TASK_TYPES, REQUESTING_AREAS,
} from '../services/tasks.js';
import { fetchProjects }  from '../services/projects.js';
import { getTaskType } from '../services/taskTypes.js';
/* getSubtaskTemplate: lazy-loaded (may not exist in older deployments) */
let getSubtaskTemplate = () => [];
let _ttLoaded = false;
async function _loadSubtaskTemplate() {
  if (_ttLoaded) return;
  try {
    const mod = await import('../services/taskTypes.js');
    if (mod.getSubtaskTemplate) getSubtaskTemplate = mod.getSubtaskTemplate;
    _ttLoaded = true;
  } catch { /* not available */ }
}
import {
  renderTypeFields, collectFieldValues,
  bindDynamicFieldEvents, validateRequiredFields,
} from './dynamicFields.js';
/* workflowEngine: lazy-loaded to avoid blocking pre-login */
let _wfLoaded = false;
let getValidTransitions = (status) => Object.keys({ not_started:1, in_progress:1, review:1, rework:1, done:1, cancelled:1 });
let checkSubtaskAutoAdvance = () => null;
async function _loadWorkflowEngine() {
  if (_wfLoaded) return;
  try {
    const wf = await import('../services/workflowEngine.js');
    getValidTransitions = wf.getValidTransitions;
    checkSubtaskAutoAdvance = wf.checkSubtaskAutoAdvance;
    _wfLoaded = true;
  } catch { /* module not available yet */ }
}
import { fetchAllAbsences } from '../services/capacity.js';

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

/** Verifica se o usuário tem ausência que sobrepõe o período da tarefa */
function getUserAbsenceInPeriod(absences, userId, startDate, dueDate) {
  if (!absences.length) return null;
  // Usa dueDate como referência principal; se não existir, usa hoje
  const taskStart = startDate ? (startDate?.toDate ? startDate.toDate() : new Date(startDate)) : new Date();
  const taskEnd   = dueDate   ? (dueDate?.toDate   ? dueDate.toDate()   : new Date(dueDate))   : taskStart;
  taskStart.setHours(0,0,0,0);
  taskEnd.setHours(23,59,59,999);

  return absences.find(a => {
    if (a.userId !== userId) return false;
    const aStart = a.startDate?.toDate ? a.startDate.toDate() : new Date(a.startDate);
    const aEnd   = a.endDate?.toDate   ? a.endDate.toDate()   : new Date(a.endDate);
    aStart.setHours(0,0,0,0);
    aEnd.setHours(23,59,59,999);
    // Sobreposição de intervalos
    return aStart <= taskEnd && aEnd >= taskStart;
  });
}

const ABSENCE_TYPE_LABELS = {
  vacation: 'Férias', sick: 'Licença médica', remote: 'Home office',
  training: 'Treinamento', event: 'Evento externo', other: 'Ausente',
};

export async function openTaskModal({ taskData=null, projectId=null, status='not_started', onSave=null, typeId=null } = {}) {
  await Promise.all([_loadWorkflowEngine(), _loadSubtaskTemplate()]);
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

  // Carrega ausências para indicar indisponibilidade no seletor de responsáveis
  let allAbsences = [];
  try { allAbsences = await fetchAllAbsences(); } catch(e) { /* silent */ }

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
    nucleos:[], outOfCalendar:false, deliveryLink:'',
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

  const isPrefill = !!(taskData && !taskData.id); // has data but no Firestore id

  // ── Smart Defaults: apply remembered values for NEW tasks ──
  if (!isEdit && !isPrefill) {
    const smartDefaults = JSON.parse(localStorage.getItem('primetour-task-defaults') || '{}');
    if (!task.projectId && smartDefaults.projectId) task.projectId = smartDefaults.projectId;
    if (!task.priority) task.priority = smartDefaults.priority || 'medium';
    if (!task.requestingArea && smartDefaults.requestingArea) task.requestingArea = smartDefaults.requestingArea;
    if (!task.typeId && smartDefaults.typeId) task.typeId = smartDefaults.typeId;
    if (!task.variationId && smartDefaults.variationId) task.variationId = smartDefaults.variationId;
  }

  // Load current task type for dynamic fields
  const currentTypeId = task.typeId || (task.type && task.type !== '' ? task.type : null);
  let currentTaskType = null;
  if (currentTypeId) {
    currentTaskType = await getTaskType(currentTypeId).catch(() => null);
  }

  let currentTags      = [...(task.tags||[])];
  let currentAssignees = [...(task.assignees||[])];

  // ── Auto-assign self for NEW tasks ──
  if (!isEdit && !isPrefill && currentAssignees.length === 0) {
    const uid = store.get('currentUser')?.uid;
    if (uid) { currentAssignees = [uid]; task.assignees = [uid]; }
  }
  const modalTitle = isEdit
    ? 'Detalhes da Tarefa'
    : isPrefill
      ? 'Nova Tarefa — a partir de solicitação'
      : 'Nova Tarefa';

  let _isDirty = false;
  let _bypassDirtyCheck = false;

  const m = modal.open({
    title: modalTitle,
    size: 'xl',
    content: buildHTML(task, users, projects, currentTags, currentAssignees, isEdit, currentTaskType,
      task.sector || currentTaskType?.sector || store.get('userSector') || null, allAbsences),
    footer: [
      ...(isEdit && store.can('task_delete') ? [{
        label:'🗑 Excluir', class:'btn-danger btn-sm', closeOnClick:false,
        onClick: async (_,{close}) => {
          if (await modal.confirm({ title:'Excluir tarefa', message:`Excluir "<strong>${esc(task.title)}</strong>"?`, confirmText:'Excluir', danger:true, icon:'🗑️' })) {
            try { await deleteTask(task.id); toast.success('Tarefa excluída.'); _bypassDirtyCheck = true; close(); onSave?.(); }
            catch(e) { toast.error(e.message); }
          }
        },
      }] : []),
      { label:'Cancelar', class:'btn-secondary', closeOnClick:false,
        onClick: () => {
          if (_isDirty && !confirm('Você tem alterações não salvas. Deseja descartar?')) return;
          _bypassDirtyCheck = true;
          m.close();
        } },
      { label: isEdit ? 'Salvar alterações' : 'Criar tarefa', class:'btn-primary', closeOnClick:false,
        onClick: async (_,{close}) => {
          const modalEl = document.querySelector('.modal-body') || document.querySelector('.modal') || document;
          _bypassDirtyCheck = true;
          await handleSave(task, currentTags, currentAssignees, isEdit, close, onSave, modalEl);
        } },
    ],
  });

  // Intercept all close paths (X button, backdrop, ESC) with dirty check
  // by monkey-patching modal.close for this modal's ID
  const _origManagerClose = modal.close.bind(modal);
  const modalId = m.id;
  modal.close = (id) => {
    if (id === modalId && !_bypassDirtyCheck && _isDirty) {
      if (!confirm('Você tem alterações não salvas. Deseja descartar?')) return;
    }
    _origManagerClose(id);
    // Restore original close once this modal is closed
    if (id === modalId) {
      modal.close = _origManagerClose;
    }
  };

  // Bind events after next paint — use requestAnimationFrame for reliability
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      bindEvents(task, users, currentTags, currentAssignees, isEdit, allAbsences, m.getElement());

      // Track dirty state for cancel confirmation
      setTimeout(() => {
        const modalBody = m.getElement()?.querySelector('.modal-body');
        if (modalBody) {
          modalBody.addEventListener('input', () => { _isDirty = true; }, { once: false });
          modalBody.addEventListener('change', () => { _isDirty = true; }, { once: false });
        }
      }, 100);

      // Populate meta selector async — show individual metas (not goals)
      import('../services/goals.js').then(({ fetchGoals }) => {
        return fetchGoals();
      }).then(goals => {
        let available = goals.filter(g => g.status === 'publicada');
        if (!available.length) available = goals.filter(g => g.status !== 'encerrada');
        const sel = document.getElementById('tm-goal');
        if (!sel) return;

        // Build flat meta list
        const opts = [];
        available.forEach(g => {
          const goalName = g.nome || g.objetivoNucleo || g.titulo || 'Meta';
          (g.pilares || []).forEach((pilar, pi) => {
            (pilar.metas || []).forEach((meta, mi) => {
              const val = `${g.id}:${pi}:${mi}`;
              const metaName = meta.titulo || `Meta ${mi + 1}`;
              const pilarName = pilar.titulo || `Pilar ${pi + 1}`;
              // Check if this task is linked to this specific meta
              const isSelected = task.goalId === g.id &&
                (task.goalMetaRef === `${pi}:${mi}` || (!task.goalMetaRef && pi === 0 && mi === 0));
              opts.push(`<option value="${val}" ${isSelected ? 'selected' : ''}>${metaName} — Pilar: ${pilarName} (${goalName})</option>`);
            });
          });
        });

        sel.innerHTML = '<option value="">Sem meta vinculada</option>' + opts.join('');
      }).catch(() => {});
    });
  });
}

function buildHTML(task, users, projects, tags, assignees, isEdit, taskType = null, taskSector = null, absences = []) {
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
    const absence = getUserAbsenceInPeriod(absences, uid, task.startDate, task.dueDate);
    const absIcon = absence ? '<span title="' + esc(ABSENCE_TYPE_LABELS[absence.type]||'Ausente') + '" style="color:#EF4444;font-size:0.625rem;margin-left:2px;">⚠</span>' : '';
    return `<div class="assignee-chip" data-uid="${uid}" ${absence?'style="border-color:#EF4444;background:#EF444410;"':''}>
      <div class="avatar" style="background:${u.avatarColor||'#3B82F6'};width:20px;height:20px;font-size:0.5rem;">${getInitials(u.name)}</div>
      ${esc(u.name.split(' ')[0])}${absIcon}<span style="font-size:0.7rem;opacity:0.6;">✕</span></div>`;
  }).join('');

  const userListHTML = activeUsers.length
    ? activeUsers.map(u => {
        const absence = getUserAbsenceInPeriod(absences, u.id, task.startDate, task.dueDate);
        const absLabel = absence ? (ABSENCE_TYPE_LABELS[absence.type] || 'Ausente') : '';
        const fmtAbsDate = (d) => {
          const dt = d?.toDate ? d.toDate() : new Date(d);
          return dt.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' });
        };
        return `
        <div class="dropdown-item" data-add-uid="${u.id}" data-absent="${absence?'1':''}"
          style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 12px;
          ${absence?'opacity:0.6;':''}">
          <div class="avatar avatar-sm" style="background:${u.avatarColor||'#3B82F6'};flex-shrink:0;">${getInitials(u.name)}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.875rem;color:var(--text-primary);">${esc(u.name)}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);">${esc(u.department||u.role||'')}</div>
          </div>
          ${absence ? `<span style="font-size:0.625rem;padding:2px 6px;border-radius:4px;
            background:#EF444418;color:#EF4444;white-space:nowrap;flex-shrink:0;"
            title="${absLabel}: ${fmtAbsDate(absence.startDate)} a ${fmtAbsDate(absence.endDate)}">
            ${absLabel} ${fmtAbsDate(absence.startDate)}-${fmtAbsDate(absence.endDate)}</span>` : ''}
        </div>`;
      }).join('')
    : `<div style="padding:12px;color:var(--text-muted);font-size:0.875rem;">Nenhum usuário ativo.</div>`;

  // Build requester-edit banner if task was modified by the portal user
  const editBanner = (() => {
    if (!task.requesterEditFlag) return '';
    const editDate = task.requesterEditAt?.toDate
      ? task.requesterEditAt.toDate().toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})
      : '';
    const FIELD_LABELS = {
      title: 'Título', description: 'Descrição', desiredDate: 'Data',
      urgency: 'Urgência', outOfCalendar: 'Fora do calendário',
      variationId: 'Variação', variationName: 'Variação',
      nucleo: 'Núcleo', sector: 'Setor', requestingArea: 'Área solicitante',
    };
    const changedFields = (task.requesterEditChanges || '')
      .split(',').map(f => f.trim()).filter(Boolean)
      .map(f => FIELD_LABELS[f] || f)
      .join(', ');
    return `
      <div id="tm-requester-edit-banner" style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;
        padding:12px 14px;margin-bottom:12px;display:flex;align-items:flex-start;gap:10px;">
        <span style="font-size:1.125rem;flex-shrink:0;">📝</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.8125rem;font-weight:600;color:#92400E;">
            Solicitação alterada pelo solicitante
          </div>
          <div style="font-size:0.75rem;color:#92400E;margin-top:2px;">
            ${changedFields ? 'Campos alterados: <strong>' + changedFields + '</strong>' : 'Verifique os campos atualizados.'}
            ${editDate ? '<br>Alterado em: ' + editDate : ''}
          </div>
          <div style="font-size:0.6875rem;color:#B45309;margin-top:4px;">
            Confira as informações antes de prosseguir com a produção. Este aviso só desaparece quando você confirmar.
          </div>
          <button id="tm-dismiss-edit-banner" style="margin-top:10px;padding:6px 14px;border-radius:6px;
            border:1px solid #F59E0B;background:#F59E0B;color:#fff;font-weight:600;font-size:0.75rem;
            cursor:pointer;font-family:var(--font-ui);transition:all 0.15s;">
            ✓ OK, estou ciente
          </button>
        </div>
      </div>`;
  })();

  return `<div class="task-modal-grid">
    <div class="task-modal-main">
      ${editBanner}
      <input type="text" id="tm-title" class="task-modal-title-input"
        placeholder="Título da tarefa..." value="${esc(task.title)}" maxlength="200" />
      <span class="form-error-msg" id="tm-title-error"></span>
      <div class="form-group mt-4">
        <label class="form-label">Descrição</label>
        <textarea id="tm-desc" class="form-textarea" rows="3"
          placeholder="Descreva a tarefa...">${esc(task.description)}</textarea>
      </div>
      <div class="form-group mt-4">
        <label class="form-label" style="display:flex;align-items:center;gap:6px;">
          <span>🔗 Link da entrega</span>
          <span style="font-weight:400;color:var(--text-muted);font-size:0.75rem;">(opcional)</span>
        </label>
        <input type="url" id="tm-delivery-link" class="form-input"
          placeholder="https://drive.google.com/... ou https://figma.com/..."
          value="${esc(task.deliveryLink || '')}" />
        ${task.deliveryLink ? `
          <div style="margin-top:6px;">
            <a href="${esc(task.deliveryLink)}" target="_blank" rel="noopener"
              style="font-size:0.8125rem;color:var(--brand-gold);text-decoration:none;
              display:inline-flex;align-items:center;gap:4px;">
              ↗ Abrir link atual
            </a>
          </div>` : ''}
      </div>
      ${!isEdit ? `
        <div class="form-group mt-4" id="tm-recurrence-section">
          <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="tm-recurring-toggle" />
            <span>🔄 Tarefa recorrente</span>
            <span style="font-weight:400;color:var(--text-muted);font-size:0.75rem;">(gera automaticamente)</span>
          </label>
          <div id="tm-recurrence-config" style="display:none;margin-top:10px;padding:12px;border:1px solid var(--border-subtle);border-radius:8px;background:var(--bg-elevated);">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div>
                <label class="form-label" style="font-size:0.75rem;">Frequência</label>
                <select id="tm-rec-frequency" class="form-select">
                  <option value="daily">Diariamente</option>
                  <option value="weekly" selected>Semanalmente</option>
                  <option value="monthly">Mensalmente</option>
                  <option value="custom">A cada N dias</option>
                </select>
              </div>
              <div>
                <label class="form-label" style="font-size:0.75rem;">Prazo (dias após geração)</label>
                <input type="number" id="tm-rec-due-offset" class="form-input" min="0" max="90" value="3" />
              </div>
            </div>
            <div id="tm-rec-weekly" style="margin-top:10px;">
              <label class="form-label" style="font-size:0.75rem;">Dias da semana</label>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                ${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map((n, i) => `
                  <label style="display:flex;align-items:center;gap:4px;padding:4px 8px;border:1px solid var(--border-default);border-radius:6px;cursor:pointer;font-size:0.75rem;">
                    <input type="checkbox" class="tm-rec-weekday" data-day="${i}" ${i >= 1 && i <= 5 ? 'checked' : ''} />${n}
                  </label>
                `).join('')}
              </div>
            </div>
            <div id="tm-rec-monthly" style="display:none;margin-top:10px;">
              <label class="form-label" style="font-size:0.75rem;">Dia do mês</label>
              <input type="number" id="tm-rec-month-day" class="form-input" min="1" max="31" value="1" style="width:100px;" />
            </div>
            <div id="tm-rec-custom" style="display:none;margin-top:10px;">
              <label class="form-label" style="font-size:0.75rem;">Intervalo (dias)</label>
              <input type="number" id="tm-rec-interval" class="form-input" min="1" max="365" value="7" style="width:100px;" />
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px;">
              <div>
                <label class="form-label" style="font-size:0.75rem;">Começar em</label>
                <input type="date" id="tm-rec-start" class="form-input" />
              </div>
              <div>
                <label class="form-label" style="font-size:0.75rem;">Parar em (opcional)</label>
                <input type="date" id="tm-rec-end" class="form-input" />
              </div>
            </div>
            <p style="font-size:0.7rem;color:var(--text-muted);margin-top:10px;margin-bottom:0;">
              ℹ As instâncias são geradas automaticamente quando alguém abrir a página de Tarefas. Você pode gerenciar templates em Configurações › Tarefas recorrentes.
            </p>
          </div>
        </div>
      ` : ''}
      <div class="task-detail-field">
        <div class="task-detail-label" style="display:flex;align-items:center;justify-content:space-between;">
          <span>Subtarefas</span>
          <span class="subtask-progress" id="subtask-progress" style="font-size:0.6875rem;color:var(--text-muted);">${getSubtaskProgress(task.subtasks||[])}</span>
        </div>
        <div class="subtask-progress-bar" id="subtask-progress-bar" style="margin:4px 0 8px;">
          ${renderSubtaskProgressBar(task.subtasks||[])}
        </div>
        <div class="subtask-list" id="subtask-list">${renderSubtasks(task.subtasks||[])}</div>
        <div class="quick-add-bar">
          <span style="color:var(--text-muted);font-size:1rem;">+</span>
          <input type="text" class="quick-add-input" id="subtask-input" placeholder="Adicionar subtarefa... (Enter)" maxlength="200" />
        </div>
      </div>
      ${isEdit ? `
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
          ${(() => {
            const validNext = getValidTransitions(task.status);
            return STATUSES
              .filter(s => {
                if (s.value === task.status) return true; // always show current
                if (s.value === 'done' && !store.can('task_complete') && task.status !== 'done') return false;
                return validNext.includes(s.value);
              })
              .map(s => `<option value="${s.value}" ${task.status===s.value?'selected':''}>${esc(s.label)}</option>`)
              .join('');
          })()}
        </select>
        ${!store.can('task_complete') ? `<div style="font-size:0.6875rem;color:var(--text-muted);margin-top:4px;">🔒 Apenas coordenadores+ podem marcar como concluída.</div>` : ''}
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
        const currentWsId = task.workspaceId || store.get('currentWorkspace')?.id || '';
        // Sempre mostra o seletor quando o usuário tem ao menos 1 squad —
        // inclui a opção "Sem squad" para deixar explícito que a task não é
        // de nenhum grupo específico.
        if (workspaces.length >= 1) {
          const canEditWs = !isEdit || store.can('task_edit_any');
          const wsName = workspaces.find(w => w.id === currentWsId)?.name || '';
          if (!canEditWs) {
            return `<div class="task-detail-field">
              <div class="task-detail-label">Squad / Workspace</div>
              <div class="task-detail-value" style="font-size:0.875rem;color:var(--text-secondary);">
                ${wsName ? esc(wsName) : '<em>Sem squad</em>'}
              </div>
            </div>`;
          }
          return `<div class="task-detail-field">
            <div class="task-detail-label">Squad / Workspace</div>
            <select class="form-select" id="tm-workspace" style="padding:8px 32px 8px 12px;">
              <option value="" ${!currentWsId ? 'selected' : ''}>— Sem squad (apenas por setor)</option>
              ${workspaces.map(w => `
                <option value="${w.id}" ${currentWsId===w.id?'selected':''}>
                  ${esc(w.icon||'◈')} ${esc(w.name)}${w.multiSector ? ' · multissetor' : ''}
                </option>
              `).join('')}
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

function bindEvents(task, users, currentTags, currentAssignees, isEdit, absences = [], rootEl = null) {
  // Scope used for subtask (and other) DOM queries. Falls back to `document`
  // when a modal root isn't provided, preserving legacy behavior.
  const root = rootEl || document;
  const qId = (id) => (rootEl ? rootEl.querySelector('#' + id) : document.getElementById(id));

  // Dismiss requester-edit banner + clear flag on task
  document.getElementById('tm-dismiss-edit-banner')?.addEventListener('click', async () => {
    document.getElementById('tm-requester-edit-banner')?.remove();
    if (task.id && task.requesterEditFlag) {
      try {
        const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const { db } = await import('../firebase.js');
        await updateDoc(doc(db, 'tasks', task.id), {
          requesterEditFlag: false,
        });
      } catch(e) { /* silent */ }
    }
  });

  // Recorrência (apenas criação)
  if (!isEdit) {
    const recToggle = document.getElementById('tm-recurring-toggle');
    const recConfig = document.getElementById('tm-recurrence-config');
    const recStart  = document.getElementById('tm-rec-start');
    if (recStart && !recStart.value) recStart.value = new Date().toISOString().slice(0,10);
    recToggle?.addEventListener('change', () => {
      if (recConfig) recConfig.style.display = recToggle.checked ? 'block' : 'none';
    });
    const recFreq = document.getElementById('tm-rec-frequency');
    recFreq?.addEventListener('change', () => {
      const freq = recFreq.value;
      const wk = document.getElementById('tm-rec-weekly');
      const mn = document.getElementById('tm-rec-monthly');
      const cu = document.getElementById('tm-rec-custom');
      if (wk) wk.style.display = freq === 'weekly'  ? 'block' : 'none';
      if (mn) mn.style.display = freq === 'monthly' ? 'block' : 'none';
      if (cu) cu.style.display = freq === 'custom'  ? 'block' : 'none';
    });
  }

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

    // Auto-populate subtasks from template for NEW tasks
    if (!isEdit && typeDoc && (task.subtasks || []).length === 0) {
      const template = getSubtaskTemplate(typeDoc);
      if (template.length > 0) {
        task.subtasks = template;
        rerenderSubtaskList();
        toast.info(`${template.length} subtarefa(s) adicionada(s) do template "${typeDoc.name}".`);
      }
    }
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
      // Verifica ausência no período da tarefa
      const startVal = document.getElementById('tm-start')?.value;
      const dueVal   = document.getElementById('tm-due')?.value;
      const absence  = getUserAbsenceInPeriod(absences, uid,
        startVal ? new Date(startVal+'T00:00:00') : task.startDate,
        dueVal   ? new Date(dueVal+'T00:00:00')   : task.dueDate);

      currentAssignees.push(uid);
      const u = users.find(u=>u.id===uid);
      if (u) {
        const absIcon = absence ? '<span title="' + esc(ABSENCE_TYPE_LABELS[absence.type]||'Ausente') + '" style="color:#EF4444;font-size:0.625rem;margin-left:2px;">⚠</span>' : '';
        const el = document.createElement('div');
        el.className='assignee-chip'; el.dataset.uid=uid;
        if (absence) { el.style.borderColor='#EF4444'; el.style.background='#EF444410'; }
        el.innerHTML=`<div class="avatar" style="background:${u.avatarColor||'#3B82F6'};width:20px;height:20px;font-size:0.5rem;">${getInitials(u.name)}</div>${esc(u.name.split(' ')[0])}${absIcon}<span style="font-size:0.7rem;opacity:0.6;">✕</span>`;
        const btn=document.getElementById('assignee-add-btn');
        document.getElementById('assignee-picker')?.insertBefore(el,btn);

        if (absence) {
          const absLabel = ABSENCE_TYPE_LABELS[absence.type] || 'Ausente';
          const fmtD = d => { const dt = d?.toDate ? d.toDate() : new Date(d); return dt.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}); };
          toast.warning(`${u.name.split(' ')[0]} está em "${absLabel}" de ${fmtD(absence.startDate)} a ${fmtD(absence.endDate)}. Tarefa atribuída mesmo assim.`);
        }
      }
    }
    document.getElementById('assignee-dropdown').style.display='none';
  });
  document.getElementById('assignee-picker')?.addEventListener('click', (e) => {
    const chip=e.target.closest('.assignee-chip[data-uid]');
    if (chip){const uid=chip.dataset.uid;const i=currentAssignees.indexOf(uid);if(i>-1)currentAssignees.splice(i,1);chip.remove();}
  });
  document.addEventListener('click', () => { const dd=document.getElementById('assignee-dropdown'); if(dd)dd.style.display='none'; });

  // Quando datas mudam, atualizar indicadores de ausência no dropdown
  const updateAbsenceIndicators = () => {
    const startVal = document.getElementById('tm-start')?.value;
    const dueVal   = document.getElementById('tm-due')?.value;
    const sDate = startVal ? new Date(startVal+'T00:00:00') : null;
    const dDate = dueVal   ? new Date(dueVal+'T00:00:00')   : null;

    // Atualizar dropdown
    document.querySelectorAll('#assignee-dropdown [data-add-uid]').forEach(item => {
      const uid = item.dataset.addUid;
      const absence = getUserAbsenceInPeriod(absences, uid, sDate, dDate);
      item.style.opacity = absence ? '0.6' : '';
      item.dataset.absent = absence ? '1' : '';
      const badge = item.querySelector('span[style*="EF4444"]');
      if (!absence && badge) badge.remove();
      if (absence && !badge) {
        const fmtD = d => { const dt = d?.toDate ? d.toDate() : new Date(d); return dt.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}); };
        const absLabel = ABSENCE_TYPE_LABELS[absence.type] || 'Ausente';
        const span = document.createElement('span');
        span.style.cssText = 'font-size:0.625rem;padding:2px 6px;border-radius:4px;background:#EF444418;color:#EF4444;white-space:nowrap;flex-shrink:0;';
        span.title = `${absLabel}: ${fmtD(absence.startDate)} a ${fmtD(absence.endDate)}`;
        span.textContent = `${absLabel} ${fmtD(absence.startDate)}-${fmtD(absence.endDate)}`;
        item.appendChild(span);
      }
    });

    // Atualizar chips existentes
    document.querySelectorAll('#assignee-picker .assignee-chip[data-uid]').forEach(chip => {
      const uid = chip.dataset.uid;
      const absence = getUserAbsenceInPeriod(absences, uid, sDate, dDate);
      chip.style.borderColor = absence ? '#EF4444' : '';
      chip.style.background  = absence ? '#EF444410' : '';
      const warn = chip.querySelector('span[style*="EF4444"][title]');
      if (!absence && warn) warn.remove();
      if (absence && !warn) {
        const s = document.createElement('span');
        s.title = ABSENCE_TYPE_LABELS[absence.type] || 'Ausente';
        s.style.cssText = 'color:#EF4444;font-size:0.625rem;margin-left:2px;';
        s.textContent = '⚠';
        chip.querySelector('span:last-child')?.before(s);
      }
    });
  };

  document.getElementById('tm-start')?.addEventListener('change', updateAbsenceIndicators);
  document.getElementById('tm-due')?.addEventListener('change', updateAbsenceIndicators);

  // ── Subtasks (funciona tanto em criar quanto em editar) ──
  // Em "criar" (isEdit=false), as operações alteram apenas task.subtasks em memória
  // e são persistidas no createTask() ao salvar. Em "editar", persistem via services.
  // IMPORTANT: todas as queries são escopadas ao `root` (o backdrop do modal) para
  // evitar colisões com elementos antigos/duplicados fora deste modal.
  const subtaskList = qId('subtask-list');
  const refreshSubtaskUI = () => {
    const el = qId('subtask-progress');
    if (el) el.textContent = getSubtaskProgress(task.subtasks);
    const bar = qId('subtask-progress-bar');
    if (bar) bar.innerHTML = renderSubtaskProgressBar(task.subtasks);
  };
  const rerenderSubtaskList = () => {
    if (subtaskList) subtaskList.innerHTML = renderSubtasks(task.subtasks || []);
    refreshSubtaskUI();
  };

  qId('subtask-input')?.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const val = e.target.value.trim();
    if (!val) return;
    e.preventDefault();
    try {
      let sub;
      if (isEdit) {
        sub = await addSubtask(task.id, val);
        task.subtasks = [...(task.subtasks || []), sub];
      } else {
        // Modo criar: gera subtarefa local, sem tocar no Firestore
        sub = {
          id:        `sub_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
          title:     val,
          done:      false,
          createdAt: new Date().toISOString(),
          createdBy: store.get('currentUser')?.uid || '',
        };
        task.subtasks = [...(task.subtasks || []), sub];
      }
      e.target.value = '';
      subtaskList?.insertAdjacentHTML('beforeend', renderSubtaskItem(sub));
      refreshSubtaskUI();
    } catch (err) { toast.error(err.message); }
  });

  subtaskList?.addEventListener('click', async (e) => {
    // Assignees (abre popover de seleção)
    const assignBtn = e.target.closest('[data-sub-assign]');
    if (assignBtn) {
      e.stopPropagation();
      const subId = assignBtn.dataset.subAssign;
      openSubtaskAssigneesPopover(assignBtn, subId, task, isEdit, users, (updatedSubtasks) => {
        task.subtasks = updatedSubtasks;
        const row = subtaskList?.querySelector(`.subtask-item[data-sub="${subId}"]`);
        if (row) row.outerHTML = renderSubtaskItem(task.subtasks.find(s => s.id === subId));
      });
      return;
    }

    // Delete
    const delBtn = e.target.closest('[data-sub-del]');
    if (delBtn) {
      const subId = delBtn.dataset.subDel;
      try {
        if (isEdit) {
          task.subtasks = await deleteSubtask(task.id, subId, task.subtasks);
        } else {
          task.subtasks = (task.subtasks || []).filter(s => s.id !== subId);
        }
        subtaskList?.querySelector(`.subtask-item[data-sub="${subId}"]`)?.remove();
        refreshSubtaskUI();
      } catch (err) { toast.error(err.message); }
      return;
    }

    // Add due date
    const dueAdd = e.target.closest('[data-sub-due-add]');
    if (dueAdd) {
      const subId = dueAdd.dataset.subDueAdd;
      const input = document.createElement('input');
      input.type = 'date';
      input.className = 'subtask-due-input';
      input.style.cssText = 'font-size:0.7rem;padding:2px 4px;border:1px solid var(--border-default);border-radius:4px;background:var(--bg-input);color:var(--text-primary);';
      dueAdd.replaceWith(input);
      input.focus();
      input.addEventListener('change', async () => {
        if (!input.value) return;
        try {
          if (isEdit) {
            task.subtasks = await updateSubtaskDue(task.id, subId, input.value, task.subtasks);
          } else {
            task.subtasks = (task.subtasks || []).map(s =>
              s.id === subId ? { ...s, dueDate: input.value } : s
            );
          }
          const row = subtaskList?.querySelector(`.subtask-item[data-sub="${subId}"]`);
          if (row) row.outerHTML = renderSubtaskItem(task.subtasks.find(s => s.id === subId));
          refreshSubtaskUI();
        } catch (err) { toast.error(err.message); }
      });
      input.addEventListener('blur', () => {
        if (!input.value) {
          const btn = document.createElement('button');
          btn.className = 'subtask-add-due';
          btn.dataset.subDueAdd = subId;
          btn.title = 'Definir vencimento';
          btn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:0.75rem;padding:0 4px;';
          btn.textContent = '📅';
          input.replaceWith(btn);
        }
      });
      return;
    }

    // Edit existing due date
    const dueChip = e.target.closest('[data-sub-due]');
    if (dueChip && !dueChip.dataset.subDueAdd) {
      const subId = dueChip.dataset.subDue;
      const sub = task.subtasks.find(s => s.id === subId);
      const input = document.createElement('input');
      input.type = 'date';
      input.value = sub?.dueDate || '';
      input.style.cssText = 'font-size:0.7rem;padding:2px 4px;border:1px solid var(--border-default);border-radius:4px;background:var(--bg-input);color:var(--text-primary);';
      dueChip.replaceWith(input);
      input.focus();
      input.addEventListener('change', async () => {
        try {
          const newVal = input.value || null;
          if (isEdit) {
            task.subtasks = await updateSubtaskDue(task.id, subId, newVal, task.subtasks);
          } else {
            task.subtasks = (task.subtasks || []).map(s =>
              s.id === subId ? { ...s, dueDate: newVal } : s
            );
          }
          const row = subtaskList?.querySelector(`.subtask-item[data-sub="${subId}"]`);
          if (row) row.outerHTML = renderSubtaskItem(task.subtasks.find(s => s.id === subId));
        } catch (err) { toast.error(err.message); }
      });
      return;
    }

    // Inline edit title
    const label = e.target.closest('[data-sub-edit]');
    if (label) {
      const subId = label.dataset.subEdit;
      const sub = task.subtasks.find(s => s.id === subId);
      if (!sub) return;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = sub.title;
      input.maxLength = 200;
      input.className = 'subtask-edit-input';
      label.replaceWith(input);
      input.focus();
      input.select();
      const commit = async () => {
        const newTitle = input.value.trim();
        if (!newTitle || newTitle === sub.title) {
          input.replaceWith(Object.assign(document.createElement('span'), {
            className: 'subtask-label', textContent: sub.title, title: 'Clique para editar',
          }));
          subtaskList?.querySelector(`.subtask-item[data-sub="${subId}"] .subtask-label`)
            ?.setAttribute('data-sub-edit', subId);
          return;
        }
        try {
          if (isEdit) {
            task.subtasks = await updateSubtaskTitle(task.id, subId, newTitle, task.subtasks);
          } else {
            task.subtasks = (task.subtasks || []).map(s =>
              s.id === subId ? { ...s, title: newTitle } : s
            );
          }
          const row = subtaskList?.querySelector(`.subtask-item[data-sub="${subId}"]`);
          if (row) row.outerHTML = renderSubtaskItem(task.subtasks.find(s => s.id === subId));
        } catch (err) { toast.error(err.message); }
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
        if (ev.key === 'Escape') { input.value = sub.title; input.blur(); }
      });
      return;
    }

    // Toggle check
    const check = e.target.closest('.task-check[data-sub-id]');
    if (!check) return;
    try {
      if (isEdit) {
        task.subtasks = await toggleSubtask(task.id, check.dataset.subId, task.subtasks);
      } else {
        task.subtasks = (task.subtasks || []).map(s =>
          s.id === check.dataset.subId ? { ...s, done: !s.done } : s
        );
      }
      const sub = task.subtasks.find(s => s.id === check.dataset.subId);
      const row = check.closest('.subtask-item');
      if (sub?.done) { check.classList.add('checked'); check.textContent = '✓'; row?.classList.add('done'); }
      else           { check.classList.remove('checked'); check.textContent = '';  row?.classList.remove('done'); }
      refreshSubtaskUI();

      // Auto-advance: check if all subtasks done
      const statusSelect = qId('tm-status');
      const suggested = checkSubtaskAutoAdvance(task);
      if (suggested && statusSelect && statusSelect.value !== 'done' && statusSelect.value !== suggested) {
        statusSelect.value = suggested;
        const statusLabel = suggested === 'review' ? 'Em Revisão' : 'Em Andamento';
        toast.info(`Todas as subtarefas concluidas — status movido para "${statusLabel}".`);
      }
    } catch (err) { toast.error(err.message); }
  });

  // ── Drag and drop (reorder) ──
  (() => {
    const list = subtaskList;
    if (!list) return;
    let draggingId = null;

    list.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.subtask-item');
      if (!item) return;
      draggingId = item.dataset.sub;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', draggingId); } catch (_) {}
    });

    list.addEventListener('dragend', (e) => {
      e.target.closest('.subtask-item')?.classList.remove('dragging');
      list.querySelectorAll('.subtask-item.drag-over').forEach(el => el.classList.remove('drag-over'));
      draggingId = null;
    });

    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const target = e.target.closest('.subtask-item');
      if (!target || target.dataset.sub === draggingId) return;
      const draggingEl = list.querySelector('.subtask-item.dragging');
      if (!draggingEl) return;
      const rect = target.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      if (after) target.after(draggingEl);
      else       target.before(draggingEl);
    });

    list.addEventListener('drop', async (e) => {
      e.preventDefault();
      // Reconstruir a ordem a partir do DOM
      const newOrderIds = Array.from(list.querySelectorAll('.subtask-item')).map(el => el.dataset.sub);
      const reordered = newOrderIds
        .map(id => (task.subtasks || []).find(s => s.id === id))
        .filter(Boolean);
      if (reordered.length !== (task.subtasks || []).length) return;
      task.subtasks = reordered;
      if (isEdit) {
        try { await reorderSubtasks(task.id, reordered); }
        catch (err) { toast.error(err.message); }
      }
    });
  })();

  if (!isEdit) return;

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

  // ── @Mention Autocomplete ──────────────────────────────────
  setupMentionAutocomplete();
}

async function handleSave(task, tags, assignees, isEdit, close, onSave, ctx=document) {
  // Use getElementById directly — modal fields can be anywhere in the DOM
  const $ = id => document.getElementById(id) || ctx?.querySelector?.('#' + id);

  const title  = $('tm-title')?.value?.trim();
  const errEl  = $('tm-title-error');
  if(!title){if(errEl)errEl.textContent='Título é obrigatório.';return;}
  if(errEl)errEl.textContent='';

  const startVal   = $('tm-start')?.value;
  const dueVal     = $('tm-due')?.value;
  const typeIdVal  = $('tm-type-id')?.value || '';
  const typeDoc    = typeIdVal ? (store.get('taskTypes')||[]).find(t=>t.id===typeIdVal) : null;

  // Validate required custom fields
  if (typeDoc) {
    const fieldErrors = validateRequiredFields(typeDoc, ctx);
    if (fieldErrors.length) { toast.warning(fieldErrors[0].message); return; }
  }

  // Collect dynamic field values
  const customFields = collectFieldValues(ctx);

  const variationId  = $('tm-variation')?.value || null;
  const variationOpt = $('tm-variation option:checked');
  const variationSLA = variationOpt ? parseInt(variationOpt.dataset?.sla) : null;

  // Sector: from task prefill → from typeDoc → from user's sector
  const taskSector = task.sector
    || typeDoc?.sector
    || store.get('userSector')
    || null;

  const data={
    title,
    subtasks:     Array.isArray(task.subtasks) ? task.subtasks : [],
    description:  $('tm-desc')?.value?.trim()||'',
    goalId:       ($('tm-goal')?.value || '').split(':')[0] || null,
    goalMetaRef:  ($('tm-goal')?.value || '').includes(':') ? ($('tm-goal').value.split(':').slice(1).join(':')) : null,
    status:       $('tm-status')?.value||'not_started',
    priority:     $('tm-priority')?.value||'medium',
    projectId:    $('tm-project')?.value||null,
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
    requestingArea:   $('tm-area')?.value||'',
    clientEmail:      $('tm-client-email')?.value?.trim()||'',
    deliveryLink:     $('tm-delivery-link')?.value?.trim()||'',
    // Se o seletor existe na UI, ele é a fonte de verdade (incluindo "" = sem squad).
    // Se não existe (usuário sem squads), cai no fallback do contexto.
    workspaceId: (() => {
      const el = $('tm-workspace');
      if (el) return el.value || null;
      return task.workspaceId || store.get('currentWorkspace')?.id || null;
    })(),
    assignees,
    tags: Array.from(document.querySelectorAll('.tag-chip[data-tag]')).map(el => el.dataset.tag),
    startDate: startVal ? new Date(startVal+'T00:00:00') : null,
    dueDate:   dueVal   ? new Date(dueVal  +'T23:59:59') : null,
    // Preserve origin/flags from taskData prefill (conversion from request, news, etc.)
    sourceRequestId:      task.sourceRequestId      || null,
    sourceNewsId:         task.sourceNewsId         || null,
    requesterEditFlag:    task.requesterEditFlag    || false,
    requesterEditAt:      task.requesterEditAt      || null,
    requesterEditChanges: task.requesterEditChanges || '',
  };
  // Collect nucleos from legacy chips
  data.nucleos = Array.from(document.querySelectorAll('.tm-nucleo-check:checked')).map(cb => cb.value);

  if(isEdit) data._prevStatus=task.status;

  // Recorrência: se marcado na criação, cria template em vez de tarefa
  const isRecurring = !isEdit && $('tm-recurring-toggle')?.checked;
  const btn=document.querySelector('.modal-footer .btn-primary');
  if(btn){btn.classList.add('loading');btn.disabled=true;}
  try {
    let savedTask;
    if(isEdit){
      await updateTask(task.id,data);
      toast.success('Tarefa atualizada!');
      savedTask = { id: task.id, ...data };
    } else if (isRecurring) {
      // Criar template de recorrência em vez de tarefa pontual
      const { createTemplate, runDueRecurrenceGeneration } = await import('../services/recurringTasks.js');
      const freq       = $('tm-rec-frequency')?.value || 'weekly';
      const dueOffset  = parseInt($('tm-rec-due-offset')?.value || '0', 10) || 0;
      const startDate  = $('tm-rec-start')?.value || new Date().toISOString().slice(0,10);
      const endDate    = $('tm-rec-end')?.value || null;
      const weekdays   = Array.from(document.querySelectorAll('.tm-rec-weekday:checked'))
        .map(cb => Number(cb.dataset.day));
      const monthDay   = parseInt($('tm-rec-month-day')?.value || '1', 10) || 1;
      const intervalDays = parseInt($('tm-rec-interval')?.value || '7', 10) || 7;

      // Remove campos incompatíveis do template (startDate/dueDate viram offsets)
      const templateTaskData = { ...data };
      delete templateTaskData.startDate;
      delete templateTaskData.dueDate;
      delete templateTaskData._prevStatus;

      await createTemplate({
        taskData: templateTaskData,
        frequency: freq,
        weekdays, monthDay, intervalDays,
        startDate, endDate,
        dueOffsetDays: dueOffset,
      });
      toast.success('Tarefa recorrente criada! As instâncias serão geradas automaticamente.');
      // Gerar imediatamente as ocorrências pendentes (inclusive a de hoje)
      runDueRecurrenceGeneration({ force: true }).catch(() => {});
      savedTask = null;
    } else {
      // ── Optimistic UI: fechar modal imediatamente, criar em background ──
      close();
      let optId = null;
      try {
        const kanban = await import('../pages/kanban.js').catch(() => null);
        if (kanban?.addOptimisticTask) optId = kanban.addOptimisticTask(data);
      } catch(_) {}

      try {
        savedTask = await createTask(data);
        toast.success('Tarefa criada!');
      } finally {
        // Remove card otimista (subscription do Firestore traz o real)
        if (optId) {
          try {
            const kanban = await import('../pages/kanban.js').catch(() => null);
            if (kanban?.removeOptimisticTask) kanban.removeOptimisticTask(optId);
          } catch(_) {}
        }
      }
    }

    // close() para edição/recorrência (criação já fechou acima)
    if (isEdit || isRecurring) close();

    // Double-check overlay: show whenever a task is being completed
    const isBeingCompleted = data.status === 'done' &&
      (!isEdit || task.status !== 'done');

    if (isBeingCompleted) {
      // Show overlay BEFORE onSave re-renders the page;
      // onSave fires after user confirms/skips the overlay
      await showEvidenceModal(savedTask?.id || task.id, { ...data, id: savedTask?.id || task.id });
    }

    onSave?.(savedTask?.id, savedTask);

    // ── Save smart defaults for next new task ──
    localStorage.setItem('primetour-task-defaults', JSON.stringify({
      projectId: data.projectId || null,
      typeId: data.typeId || null,
      variationId: data.variationId || null,
      requestingArea: data.requestingArea || '',
      priority: data.priority || 'medium',
    }));
  } catch(err){toast.error(err.message);}
  finally{if(btn){btn.classList.remove('loading');btn.disabled=false;}}
}

function getSubtaskProgress(subtasks) {
  if(!subtasks?.length)return '';
  const done = subtasks.filter(s=>s.done).length;
  const pct = Math.round((done/subtasks.length) * 100);
  return `${done}/${subtasks.length} (${pct}%)`;
}
function renderSubtaskProgressBar(subtasks) {
  if (!subtasks?.length) return '';
  const done = subtasks.filter(s => s.done).length;
  const pct = Math.round((done / subtasks.length) * 100);
  const color = pct === 100 ? 'var(--color-success)' : pct >= 50 ? 'var(--brand-gold)' : 'var(--color-info,#3B82F6)';
  return `
    <div style="height:6px;background:var(--bg-elevated);border-radius:3px;overflow:hidden;">
      <div style="height:100%;width:${pct}%;background:${color};transition:width 0.3s ease;"></div>
    </div>
  `;
}
function renderSubtasks(subtasks){return subtasks.map(s=>renderSubtaskItem(s)).join('');}
function renderSubtaskItem(s){
  const dueDisplay = s.dueDate ? formatSubtaskDue(s.dueDate) : '';
  return `<div class="subtask-item ${s.done?'done':''}" data-sub="${s.id}" draggable="true">
    <span class="subtask-drag-handle" title="Arrastar para reordenar">⋮⋮</span>
    <div class="task-check ${s.done?'checked':''}" data-sub-id="${s.id}">${s.done?'✓':''}</div>
    <span class="subtask-label" data-sub-edit="${s.id}" title="Clique para editar">${esc(s.title)}</span>
    ${renderSubtaskAssignees(s)}
    ${dueDisplay ? `<span class="subtask-due ${dueDisplay.className}" title="Vencimento da subtarefa" data-sub-due="${s.id}">${dueDisplay.text}</span>` : `<button class="subtask-add-due" data-sub-due-add="${s.id}" title="Definir vencimento" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:0.75rem;padding:0 4px;">📅</button>`}
    <button class="subtask-delete-btn" data-sub-del="${s.id}" title="Remover subtarefa" type="button">×</button>
    </div>`;
}
function renderSubtaskAssignees(s) {
  const assignees = Array.isArray(s.assignees) ? s.assignees : [];
  const users = store.get('users') || [];
  if (!assignees.length) {
    return `<button class="subtask-assignees-btn" data-sub-assign="${s.id}"
      title="Atribuir responsáveis"
      type="button"
      style="background:none;border:1px dashed var(--border-default);border-radius:var(--radius-full);
        cursor:pointer;color:var(--text-muted);font-size:0.7rem;padding:2px 8px;display:inline-flex;
        align-items:center;gap:4px;height:22px;">
      <span style="font-size:0.85rem;line-height:1;">👤</span>
      <span>+</span>
    </button>`;
  }
  const shown = assignees.slice(0, 3).map(uid => {
    const u = users.find(u => u.id === uid);
    if (!u) return '';
    return `<div class="avatar avatar-sm" title="${esc(u.name)}"
      style="background:${u.avatarColor||'#3B82F6'};width:20px;height:20px;font-size:0.55rem;
        margin-left:-4px;border:2px solid var(--bg-card);">
      ${getInitials(u.name)}
    </div>`;
  }).join('');
  const extra = assignees.length > 3
    ? `<div class="avatar avatar-sm" style="background:var(--bg-elevated);color:var(--text-muted);
        width:20px;height:20px;font-size:0.55rem;margin-left:-4px;border:2px solid var(--bg-card);">
        +${assignees.length-3}
      </div>`
    : '';
  return `<button class="subtask-assignees-btn" data-sub-assign="${s.id}"
    title="Editar responsáveis (${assignees.length})"
    type="button"
    style="background:none;border:none;cursor:pointer;padding:0 4px;display:inline-flex;align-items:center;">
    ${shown}${extra}
  </button>`;
}
/* ─── Popover de responsáveis da subtarefa ──────────────── */
function openSubtaskAssigneesPopover(anchorEl, subId, task, isEdit, allUsers, onUpdate) {
  // Remove qualquer popover anterior
  document.querySelectorAll('.subtask-assignees-popover').forEach(p => p.remove());

  const sub = (task.subtasks || []).find(s => s.id === subId);
  if (!sub) return;

  let currentIds = new Set(Array.isArray(sub.assignees) ? sub.assignees : []);
  const activeUsers = (allUsers || []).filter(u => u.active !== false);

  const pop = document.createElement('div');
  pop.className = 'subtask-assignees-popover';
  pop.style.cssText = `
    position:fixed;z-index:10010;
    background:var(--bg-card);border:1px solid var(--border-default);
    border-radius:var(--radius-md);box-shadow:var(--shadow-lg);
    padding:8px;width:260px;max-height:340px;display:flex;flex-direction:column;
  `;
  pop.innerHTML = `
    <div style="font-size:0.6875rem;font-weight:700;color:var(--text-muted);
      text-transform:uppercase;letter-spacing:0.05em;padding:4px 6px 8px;">
      Responsáveis da subtarefa
    </div>
    <input type="text" class="subtask-assignees-search" placeholder="Buscar..."
      style="font-size:0.8125rem;padding:6px 10px;border:1px solid var(--border-default);
        border-radius:var(--radius-sm);background:var(--bg-input);color:var(--text-primary);
        margin-bottom:6px;outline:none;" />
    <div class="subtask-assignees-list" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:2px;"></div>
    <div style="display:flex;justify-content:space-between;gap:6px;padding-top:8px;
      border-top:1px solid var(--border-subtle);margin-top:6px;">
      <button type="button" class="btn btn-ghost btn-sm" data-pop-clear
        style="font-size:0.75rem;padding:4px 8px;">Limpar</button>
      <div style="display:flex;gap:6px;">
        <button type="button" class="btn btn-secondary btn-sm" data-pop-cancel
          style="font-size:0.75rem;padding:4px 10px;">Cancelar</button>
        <button type="button" class="btn btn-primary btn-sm" data-pop-save
          style="font-size:0.75rem;padding:4px 10px;">Salvar</button>
      </div>
    </div>
  `;
  document.body.appendChild(pop);

  // Posiciona o popover perto do botão (flip se não couber)
  const rect = anchorEl.getBoundingClientRect();
  const popW = 260;
  const popH = Math.min(340, window.innerHeight - 40);
  let left = rect.left;
  if (left + popW > window.innerWidth - 12) left = window.innerWidth - popW - 12;
  if (left < 12) left = 12;
  let top = rect.bottom + 6;
  if (top + popH > window.innerHeight - 12) top = rect.top - popH - 6;
  if (top < 12) top = 12;
  pop.style.left = `${left}px`;
  pop.style.top  = `${top}px`;

  const listEl = pop.querySelector('.subtask-assignees-list');
  const searchEl = pop.querySelector('.subtask-assignees-search');

  const renderList = (filter = '') => {
    const q = filter.toLowerCase().trim();
    const filtered = q
      ? activeUsers.filter(u => (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
      : activeUsers;
    listEl.innerHTML = filtered.map(u => {
      const checked = currentIds.has(u.id);
      return `
        <label data-uid="${u.id}" style="
          display:flex;align-items:center;gap:8px;padding:6px 8px;
          border-radius:var(--radius-sm);cursor:pointer;
          background:${checked ? 'rgba(212,168,67,0.12)' : 'transparent'};
          border:1px solid ${checked ? 'rgba(212,168,67,0.35)' : 'transparent'};">
          <input type="checkbox" ${checked ? 'checked' : ''}
            style="margin:0;cursor:pointer;" />
          <div class="avatar avatar-sm" style="background:${u.avatarColor||'#3B82F6'};
            width:22px;height:22px;font-size:0.55rem;flex-shrink:0;">
            ${getInitials(u.name)}
          </div>
          <span style="font-size:0.8125rem;color:var(--text-primary);overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap;flex:1;">${esc(u.name || u.email || '—')}</span>
        </label>
      `;
    }).join('') || `<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:0.75rem;">Nenhum usuário encontrado.</div>`;
  };
  renderList();
  setTimeout(() => searchEl.focus(), 30);

  listEl.addEventListener('click', (ev) => {
    const lbl = ev.target.closest('label[data-uid]');
    if (!lbl) return;
    ev.preventDefault();
    const uid = lbl.dataset.uid;
    if (currentIds.has(uid)) currentIds.delete(uid);
    else currentIds.add(uid);
    renderList(searchEl.value);
  });

  searchEl.addEventListener('input', () => renderList(searchEl.value));

  const close = () => {
    pop.remove();
    document.removeEventListener('mousedown', onDocClick, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const onDocClick = (ev) => {
    if (!pop.contains(ev.target) && ev.target !== anchorEl) close();
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); close(); }
  };
  setTimeout(() => {
    document.addEventListener('mousedown', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);

  pop.querySelector('[data-pop-cancel]').addEventListener('click', close);
  pop.querySelector('[data-pop-clear]').addEventListener('click', () => {
    currentIds = new Set();
    renderList(searchEl.value);
  });
  pop.querySelector('[data-pop-save]').addEventListener('click', async () => {
    const ids = Array.from(currentIds);
    try {
      let updated;
      if (isEdit && task.id) {
        updated = await updateSubtaskAssignees(task.id, subId, ids, task.subtasks);
      } else {
        updated = (task.subtasks || []).map(s =>
          s.id === subId ? { ...s, assignees: ids } : s
        );
      }
      onUpdate(updated);
      close();
    } catch (err) {
      toast.error(err.message || 'Erro ao salvar responsáveis.');
    }
  });
}

function formatSubtaskDue(dateStr) {
  // dateStr: ISO YYYY-MM-DD
  const d = new Date(dateStr + 'T23:59:59');
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.floor((d - today) / (1000*60*60*24));
  const dayMonth = d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' });
  if (diff < 0) return { text: `⏰ ${dayMonth}`, className: 'overdue' };
  if (diff === 0) return { text: `Hoje`, className: 'today' };
  if (diff === 1) return { text: `Amanhã`, className: 'soon' };
  if (diff <= 7) return { text: `${dayMonth}`, className: 'soon' };
  return { text: dayMonth, className: '' };
}
function renderComments(comments){return comments.map(c=>renderCommentItem(c)).join('');}

/** Renderiza texto do comentário com @mentions destacados */
function highlightMentions(text) {
  const safe = esc(text);
  const users = store.get('users') || [];
  if (!users.length) return safe;
  // Criar regex com nomes dos usuários (mais longos primeiro para match guloso)
  const names = users
    .map(u => u.name || u.displayName || '')
    .filter(n => n.length > 1)
    .sort((a, b) => b.length - a.length);
  if (!names.length) return safe;
  const escapedNames = names.map(n => esc(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`@(${escapedNames.join('|')})`, 'gi');
  return safe.replace(pattern, '<span class="mention-tag">@$1</span>');
}

function renderCommentItem(c){
  const time=c.createdAt?new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(c.createdAt?.toDate?c.createdAt.toDate():new Date(c.createdAt)):'';
  return `<div class="comment-item">
    <div class="avatar avatar-sm" style="background:${c.authorColor||'#3B82F6'};">${getInitials(c.authorName)}</div>
    <div class="comment-bubble">
      <div class="comment-header"><span class="comment-author">${esc(c.authorName)}</span><span class="comment-time">${time}</span></div>
      <p class="comment-text">${highlightMentions(c.text)}</p>
    </div></div>`;
}

/* ─── @Mention Autocomplete ────────────────────────────────── */
function setupMentionAutocomplete() {
  const input = document.getElementById('comment-input');
  if (!input) return;

  let dropdown = null;
  let mentionStart = -1;

  function removeDropdown() {
    if (dropdown) { dropdown.remove(); dropdown = null; }
    mentionStart = -1;
  }

  function insertMention(name) {
    const val = input.value;
    const before = val.substring(0, mentionStart);
    const after = val.substring(input.selectionStart);
    input.value = `${before}@${name} ${after}`;
    const cursorPos = before.length + name.length + 2; // +2 for @ and space
    input.setSelectionRange(cursorPos, cursorPos);
    input.focus();
    removeDropdown();
  }

  function showDropdown(query) {
    removeDropdown();
    const users = (store.get('users') || []).filter(u => u.active !== false);
    const q = query.toLowerCase();
    const matches = users.filter(u => {
      const name = (u.name || u.displayName || '').toLowerCase();
      return name.includes(q);
    }).slice(0, 6);

    if (!matches.length) return;

    dropdown = document.createElement('div');
    dropdown.className = 'mention-dropdown';
    dropdown.style.cssText = `
      position:absolute; z-index:9999; background:var(--bg-surface);
      border:1px solid var(--border-subtle); border-radius:8px;
      box-shadow:0 8px 24px rgba(0,0,0,0.18); max-height:200px;
      overflow-y:auto; min-width:200px; padding:4px 0;
    `;

    matches.forEach((u, i) => {
      const item = document.createElement('div');
      item.className = 'mention-item';
      item.style.cssText = `
        display:flex; align-items:center; gap:8px; padding:8px 12px;
        cursor:pointer; font-size:0.875rem; color:var(--text-primary);
        transition: background 0.1s;
      `;
      if (i === 0) item.style.background = 'var(--bg-hover)';
      item.innerHTML = `
        <div style="width:26px;height:26px;border-radius:50%;background:${u.avatarColor||'#3B82F6'};
          display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.6875rem;
          font-weight:700;flex-shrink:0;">${getInitials(u.name||u.displayName||'')}</div>
        <span>${esc(u.name || u.displayName || '')}</span>
      `;
      item.addEventListener('mouseenter', () => {
        dropdown.querySelectorAll('.mention-item').forEach(el => el.style.background = '');
        item.style.background = 'var(--bg-hover)';
      });
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        insertMention(u.name || u.displayName || '');
      });
      dropdown.appendChild(item);
    });

    // Posicionar abaixo do textarea
    const rect = input.getBoundingClientRect();
    dropdown.style.left = rect.left + 'px';
    dropdown.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    dropdown.style.position = 'fixed';
    document.body.appendChild(dropdown);
  }

  input.addEventListener('input', () => {
    const val = input.value;
    const cursor = input.selectionStart;

    // Encontrar @ mais recente antes do cursor
    const before = val.substring(0, cursor);
    const atIdx = before.lastIndexOf('@');

    if (atIdx === -1 || (atIdx > 0 && /\S/.test(before[atIdx - 1]) && before[atIdx - 1] !== '\n')) {
      removeDropdown();
      return;
    }

    const query = before.substring(atIdx + 1);
    // Se tem espaço no meio, pode ser mention de nome composto — verificar se faz match
    if (query.length > 30) { removeDropdown(); return; }

    mentionStart = atIdx;
    showDropdown(query);
  });

  // Navegação por teclado no dropdown
  input.addEventListener('keydown', (e) => {
    if (!dropdown) return;
    const items = dropdown.querySelectorAll('.mention-item');
    if (!items.length) return;

    let activeIdx = [...items].findIndex(el => el.style.background && el.style.background !== '');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items.forEach(el => el.style.background = '');
      activeIdx = (activeIdx + 1) % items.length;
      items[activeIdx].style.background = 'var(--bg-hover)';
      items[activeIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items.forEach(el => el.style.background = '');
      activeIdx = activeIdx <= 0 ? items.length - 1 : activeIdx - 1;
      items[activeIdx].style.background = 'var(--bg-hover)';
      items[activeIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && !e.ctrlKey) {
      e.preventDefault();
      const activeItem = items[activeIdx >= 0 ? activeIdx : 0];
      if (activeItem) activeItem.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      removeDropdown();
    }
  });

  // Fechar dropdown ao clicar fora
  document.addEventListener('click', (e) => {
    if (dropdown && !dropdown.contains(e.target) && e.target !== input) {
      removeDropdown();
    }
  }, { once: false });
}

/* ─── Double-check: CSAT + evidência de meta ───────────────── */
function showEvidenceModal(taskId, taskData) {
  return new Promise(async (resolveOverlay) => {
  const esc2 = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const LBL2 = `font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;color:var(--text-muted);`;
  const F2   = `width:100%;`;

  // Flatten goals → pilares → metas into a selectable list
  let goals = [], metaOptions = [], periods = [];
  try {
    const goalsModule = await import('../services/goals.js');
    let allGoals = [];
    try {
      allGoals = await goalsModule.fetchGoals();
    } catch(fetchErr) {
      console.warn('[overlay] fetchGoals failed, trying direct query:', fetchErr.message);
      const { collection: col, getDocs: gd } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      const { db: fireDb } = await import('../firebase.js');
      const snap = await gd(col(fireDb, 'goals'));
      allGoals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    goals = allGoals.filter(g => g.status === 'publicada');
    if (!goals.length) goals = allGoals.filter(g => g.status !== 'encerrada');

    // Build flat list: each entry = one meta from one pilar from one goal
    goals.forEach(g => {
      const goalName = g.nome || g.objetivoNucleo || g.titulo || 'Meta';
      (g.pilares || []).forEach((pilar, pi) => {
        (pilar.metas || []).forEach((meta, mi) => {
          metaOptions.push({
            goalId:    g.id,
            pilarIdx:  pi,
            metaIdx:   mi,
            value:     `${g.id}:${pi}:${mi}`,
            metaName:  meta.titulo || `Meta ${mi + 1}`,
            pilarName: pilar.titulo || `Pilar ${pi + 1}`,
            goalName,
            goal: g,
          });
        });
      });
    });
  } catch(e) { console.error('[overlay] goals load error:', e); goals = []; }

  const hasCsat    = !!taskData.clientEmail;
  const hasMetaRef = !!taskData.goalId && taskData.goalMetaRef;
  const hasMetas   = metaOptions.length > 0;

  // Find pre-selected meta if task already linked
  let preselectedValue = '';
  if (hasMetaRef) {
    preselectedValue = `${taskData.goalId}:${taskData.goalMetaRef}`;
  } else if (taskData.goalId) {
    // Legacy: linked to goal but no specific meta — select first meta of that goal
    const first = metaOptions.find(m => m.goalId === taskData.goalId);
    if (first) preselectedValue = first.value;
  }

  // Load periods for pre-selected goal
  if (preselectedValue) {
    const sel = metaOptions.find(m => m.value === preselectedValue);
    if (sel) {
      try {
        const { generatePendingPeriods } = await import('../services/goals.js');
        periods = generatePendingPeriods(sel.goal);
      } catch(e) {}
    }
  }

  const OVERLAY_ID = 'task-done-overlay';
  document.getElementById(OVERLAY_ID)?.remove();
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9000;
    display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;`;

  const renderOverlay = (activeMetaValue) => {
    const activeMeta = metaOptions.find(m => m.value === activeMetaValue);

    overlay.innerHTML = `
      <div class="card" style="width:100%;max-width:540px;padding:0;overflow:hidden;">
        <div style="padding:16px 22px;background:var(--bg-surface);
          border-bottom:1px solid var(--border-subtle);">
          <div style="font-weight:700;font-size:1rem;">✅ Tarefa concluída</div>
          <div style="font-size:0.8125rem;color:var(--text-muted);margin-top:3px;">
            Confirme o envio do CSAT e/ou o vínculo com uma meta de desempenho.
          </div>
        </div>
        <div style="padding:20px 22px;display:flex;flex-direction:column;gap:18px;">

          <!-- CSAT -->
          <div style="border:1px solid var(--border-subtle);border-radius:var(--radius-md);overflow:hidden;">
            <div style="padding:12px 16px;background:var(--bg-surface);
              display:flex;align-items:center;justify-content:space-between;gap:12px;">
              <div>
                <div style="font-weight:600;font-size:0.875rem;">📧 Pesquisa de satisfação (CSAT)</div>
                <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
                  ${hasCsat
                    ? `E-mail pré-preenchido: <strong>${esc2(taskData.clientEmail)}</strong>`
                    : 'Nenhum e-mail cadastrado — preencha abaixo se quiser enviar'}
                </div>
              </div>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0;">
                <input type="checkbox" id="dc-csat-check" ${hasCsat ? 'checked' : ''}
                  style="width:16px;height:16px;cursor:pointer;">
                <span style="font-size:0.8125rem;font-weight:500;">Enviar</span>
              </label>
            </div>
            <div id="dc-csat-body" style="padding:12px 16px;display:${hasCsat ? 'block' : 'none'};">
              <label style="${LBL2}">E-mail do cliente</label>
              <input type="email" id="dc-csat-email" class="portal-field" style="${F2}"
                value="${esc2(taskData.clientEmail||'')}" placeholder="cliente@empresa.com">
            </div>
          </div>

          <!-- Meta -->
          <div style="border:1px solid var(--border-subtle);border-radius:var(--radius-md);overflow:hidden;">
            <div style="padding:12px 16px;background:var(--bg-surface);
              display:flex;align-items:center;justify-content:space-between;gap:12px;">
              <div>
                <div style="font-weight:600;font-size:0.875rem;">🎯 Evidência de meta</div>
                <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
                  ${activeMeta
                    ? `Meta: <strong>${esc2(activeMeta.metaName)}</strong> (Pilar: ${esc2(activeMeta.pilarName)})`
                    : hasMetas
                      ? 'Selecione a meta do pilar à qual esta tarefa é evidência'
                      : 'Nenhuma meta publicada no sistema'}
                </div>
              </div>
              ${hasMetas ? `
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0;">
                  <input type="checkbox" id="dc-meta-check" ${activeMeta ? 'checked' : ''}
                    style="width:16px;height:16px;cursor:pointer;">
                  <span style="font-size:0.8125rem;font-weight:500;">Registrar</span>
                </label>` : ''}
            </div>
            ${hasMetas ? `
            <div id="dc-meta-body" style="padding:12px 16px;flex-direction:column;gap:10px;
              display:${activeMeta ? 'flex' : 'none'};">
              <div>
                <label style="${LBL2}">Meta do pilar</label>
                <select id="dc-meta-sel" class="filter-select" style="${F2}">
                  <option value="">— Selecione a meta —</option>
                  ${metaOptions.map(m => `<option value="${esc2(m.value)}"
                    ${m.value === activeMetaValue ? 'selected' : ''}>
                    ${esc2(m.metaName)} — Pilar: ${esc2(m.pilarName)} (${esc2(m.goalName)})
                  </option>`).join('')}
                </select>
              </div>
              <div id="dc-pilar-info" style="display:${activeMeta ? 'block' : 'none'};
                background:var(--bg-hover);border-radius:var(--radius-sm);padding:8px 12px;
                font-size:0.75rem;color:var(--text-muted);">
                ${activeMeta ? `<strong>Pilar:</strong> ${esc2(activeMeta.pilarName)} · <strong>Meta geral:</strong> ${esc2(activeMeta.goalName)}` : ''}
              </div>
              <div>
                <label style="${LBL2}">Período de referência</label>
                <select id="dc-periodo-sel" class="filter-select" style="${F2}">
                  <option value="">Selecione o período…</option>
                  ${periods.map(p => `<option value="${esc2(p.label)}">${esc2(p.label)}</option>`).join('')}
                  <option value="__custom__">Informar manualmente…</option>
                </select>
                <input type="text" id="dc-periodo-txt" class="portal-field"
                  style="${F2};margin-top:6px;display:none;"
                  placeholder="Ex: Abril 2025"
                  value="${esc2(taskData.periodoRef||'')}">
              </div>
              <div>
                <label style="${LBL2}">Link de comprovação <span style="font-weight:400;">(opcional)</span></label>
                <input type="url" id="dc-link" class="portal-field" style="${F2}"
                  placeholder="https://…" value="${esc2(taskData.linkComprovacao||'')}">
              </div>
            </div>` : ''}
          </div>

        </div>
        <div style="padding:14px 22px;border-top:1px solid var(--border-subtle);
          background:var(--bg-surface);display:flex;gap:8px;justify-content:flex-end;">
          <button id="dc-skip" class="btn btn-ghost btn-sm">Pular</button>
          <button id="dc-confirm" class="btn btn-primary btn-sm">Confirmar</button>
        </div>
      </div>`;

    // Wire checkboxes
    document.getElementById('dc-csat-check')?.addEventListener('change', e => {
      const body = document.getElementById('dc-csat-body');
      if (body) body.style.display = e.target.checked ? 'block' : 'none';
    });
    document.getElementById('dc-meta-check')?.addEventListener('change', e => {
      const body = document.getElementById('dc-meta-body');
      if (body) body.style.display = e.target.checked ? 'flex' : 'none';
    });

    // Meta change → show pilar info + reload periods
    document.getElementById('dc-meta-sel')?.addEventListener('change', async e => {
      const val = e.target.value;
      const meta = metaOptions.find(m => m.value === val);
      const infoEl = document.getElementById('dc-pilar-info');
      if (meta) {
        if (infoEl) {
          infoEl.style.display = 'block';
          infoEl.innerHTML = `<strong>Pilar:</strong> ${esc2(meta.pilarName)} · <strong>Meta geral:</strong> ${esc2(meta.goalName)}`;
        }
        try {
          const { generatePendingPeriods } = await import('../services/goals.js');
          periods = generatePendingPeriods(meta.goal);
          const pSel = document.getElementById('dc-periodo-sel');
          if (pSel) pSel.innerHTML =
            `<option value="">Selecione o período…</option>` +
            periods.map(p => `<option value="${esc2(p.label)}">${esc2(p.label)}</option>`).join('') +
            `<option value="__custom__">Informar manualmente…</option>`;
        } catch(err) {}
      } else {
        if (infoEl) infoEl.style.display = 'none';
      }
    });

    document.getElementById('dc-periodo-sel')?.addEventListener('change', e => {
      const txt = document.getElementById('dc-periodo-txt');
      if (txt) txt.style.display = e.target.value === '__custom__' ? 'block' : 'none';
    });

    document.getElementById('dc-skip')?.addEventListener('click', () => { overlay.remove(); resolveOverlay(); });

    document.getElementById('dc-confirm')?.addEventListener('click', async () => {
      const btn = document.getElementById('dc-confirm');
      if (btn) { btn.disabled = true; btn.textContent = '⏳'; }

      const sendCsat  = document.getElementById('dc-csat-check')?.checked;
      const regMeta   = document.getElementById('dc-meta-check')?.checked;
      const csatEmail = document.getElementById('dc-csat-email')?.value?.trim();
      const metaVal   = document.getElementById('dc-meta-sel')?.value || '';
      const selMeta   = metaOptions.find(m => m.value === metaVal);
      const pSel      = document.getElementById('dc-periodo-sel')?.value;
      const pTxt      = document.getElementById('dc-periodo-txt')?.value?.trim();
      const periodoRef = pSel === '__custom__' ? pTxt : pSel;
      const link       = document.getElementById('dc-link')?.value?.trim() || '';

      const ops = [];

      // Update task
      const updates = {};
      if (regMeta && selMeta) {
        updates.goalId = selMeta.goalId;
        updates.goalMetaRef = `${selMeta.pilarIdx}:${selMeta.metaIdx}`;
        updates.goalMetaName = selMeta.metaName;
        updates.goalPilarName = selMeta.pilarName;
        updates.periodoRef = periodoRef || '';
        updates.linkComprovacao = link;
        updates.confirmadaEvidencia = true;
      }
      if (sendCsat && csatEmail) updates.clientEmail = csatEmail;

      if (Object.keys(updates).length) {
        ops.push(
          import('../services/tasks.js')
            .then(({ updateTask }) => updateTask(taskId, updates))
            .catch(e => console.error('task update error:', e))
        );
      }

      // Send CSAT via csat service
      if (sendCsat && csatEmail) {
        ops.push(
          import('../services/csat.js').then(({ createCsatSurvey, sendCsatEmail }) => {
            return createCsatSurvey({
              taskId,
              taskTitle:   taskData.title || 'Entrega PRIMETOUR',
              projectId:   taskData.projectId || null,
              projectName: taskData.projectName || null,
              clientEmail: csatEmail,
              clientName:  csatEmail.split('@')[0],
              assignedTo:  (taskData.assignees||[])[0] || null,
            }).then(survey => sendCsatEmail(survey.id));
          }).catch(e => console.error('CSAT send failed:', e?.message || e?.text || e))
        );
      }

      await Promise.all(ops);

      if (sendCsat && csatEmail) toast.success('CSAT enviado para ' + csatEmail);
      if (regMeta && selMeta)    toast.success('Evidência registrada!');

      overlay.remove();
      resolveOverlay();
      if (btn) { btn.disabled = false; btn.textContent = 'Confirmar'; }
    });
  };

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); resolveOverlay(); } });
  renderOverlay(preselectedValue);
  }); // end Promise
}

/* ─── Public entry point for quick-complete (task list / kanban) ── */
export async function openTaskDoneOverlay(taskId, taskData) {
  // Check if there's anything worth asking about
  const hasCsat  = !!taskData?.clientEmail;
  const hasGoalId = !!taskData?.goalId;

  let hasGoals = false;
  try {
    const { hasPublishedGoals } = await import('../services/goals.js');
    hasGoals = await hasPublishedGoals();
  } catch(e) { /* non-blocking */ }

  // Always show — user decides what to confirm
  await showEvidenceModal(taskId, taskData || {});
}
