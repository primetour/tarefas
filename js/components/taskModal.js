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
import { resolveUserName, resolveUserSync } from '../services/userResolver.js';
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
      const { fetchUsers } = await import('../services/users.js');
      users = await fetchUsers();
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
    projectId: projectId||null, assignees:[], observers:[], tags:[],
    startDate:null, dueDate:null, subtasks:[], comments:[],
    type:'', newsletterStatus:'', requestingArea:'', clientEmail:'',
    nucleos:[], outOfCalendar:false, deliveryLink:'',
    isPartnership: false,
    workspaceId: store.get('currentWorkspace')?.id || null,
    typeId: typeId || null,
    customFields: {},
    goalId: null,
    goalMetaRef: null,
    metaLinks: [],
    ...(td || {}),
    // Always sanitize arrays regardless of source
    tags:         Array.isArray(td?.tags)        ? td.tags        : [],
    assignees:    Array.isArray(td?.assignees)    ? td.assignees   : [],
    observers:    Array.isArray(td?.observers)    ? td.observers   : [],
    subtasks:     Array.isArray(td?.subtasks)     ? td.subtasks    : [],
    comments:     Array.isArray(td?.comments)     ? td.comments    : [],
    nucleos:      Array.isArray(td?.nucleos)      ? td.nucleos     : [],
    metaLinks:    Array.isArray(td?.metaLinks)   ? td.metaLinks   : [],
    customFields: td?.customFields || {},
  });

  let task = sanitize(taskData);

  // Migra legado (goalId + goalMetaRef) → metaLinks expandido por todos os assignees.
  // Idempotente: se já tem metaLinks, mantém.
  //
  // GUARDA: se a tarefa tem goalId legado mas a migração FALHOU (faltava
  // goalMetaRef ou assignees), marcamos `_legacyPreserve = true`. Ao salvar,
  // se essa flag estiver ativa E o picker não foi tocado, omitimos metaLinks
  // do payload pra NÃO disparar syncLegacyFields() que zeraria o goalId.
  // (Bug histórico: editar título de tarefa legada apagava o vínculo.)
  try {
    const { migrateLegacyToMetaLinks, normalizeMetaLinks } = await import('../services/metaLinks.js');
    const existing = normalizeMetaLinks(task.metaLinks);
    if (!existing.length) {
      const migrated = migrateLegacyToMetaLinks({
        goalId: task.goalId,
        goalMetaRef: task.goalMetaRef,
        assignees: task.assignees,
      });
      task.metaLinks = migrated;
      // Sinal de legacy órfão: goalId existe mas não foi migrável
      if (!migrated.length && task.goalId) {
        task._legacyPreserve = true;
      }
    } else {
      task.metaLinks = existing;
    }
  } catch (e) { console.warn('metaLinks migrate:', e?.message || e); }

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
  let currentObservers = [...(task.observers||[])];

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

  // Dedupe: 1 modal por taskId (ou 1 modal de "criar nova")
  const dedupeKey = isEdit && task.id ? `task-modal:${task.id}` : `task-modal:new`;

  const m = modal.open({
    title: modalTitle,
    size: 'xl',
    dedupeKey,
    content: buildHTML(task, users, projects, currentTags, currentAssignees, currentObservers, isEdit, currentTaskType,
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
      // Botão "Concluir" — atalho rápido pra marcar como done sem precisar
      // mexer no select de status. Aparece apenas em edição, quando a task
      // ainda não está done e o user tem permissão. Reusa o overlay de
      // conclusão (evidência/CSAT) pra paridade com o check da lista.
      ...(isEdit && task.status !== 'done' && store.can('task_complete') ? [{
        label:'✓ Concluir tarefa', class:'btn-success', closeOnClick:false,
        onClick: async (_,{close}) => {
          try {
            const { toggleTaskComplete, getTask } = await import('../services/tasks.js');
            await toggleTaskComplete(task.id, true);
            const fresh = await getTask(task.id).catch(() => task);
            // Mostra overlay (evidência) ANTES de fechar pra dar continuidade
            const { openTaskDoneOverlay } = await import('./taskModal.js');
            await openTaskDoneOverlay(task.id, fresh || task);
            _bypassDirtyCheck = true;
            close();
            onSave?.();
            toast.success('Tarefa concluída.');
          } catch(e) { toast.error(e.message); }
        },
      }] : []),
      { label: isEdit ? 'Salvar alterações' : 'Criar tarefa', class:'btn-primary', closeOnClick:false,
        onClick: async (_,{close}) => {
          const modalEl = document.querySelector('.modal-body') || document.querySelector('.modal') || document;
          _bypassDirtyCheck = true;
          await handleSave(task, currentTags, currentAssignees, currentObservers, isEdit, close, onSave, modalEl);
        } },
    ],
  });

  // Se já havia esse modal aberto (dedupe), não re-binda eventos —
  // o existente continua válido. Apenas devolve o handle.
  if (m.isExisting) return m;

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
      bindEvents(task, users, currentTags, currentAssignees, currentObservers, isEdit, allAbsences, m.getElement());

      // Track dirty state for cancel confirmation
      setTimeout(() => {
        const modalBody = m.getElement()?.querySelector('.modal-body');
        if (modalBody) {
          modalBody.addEventListener('input', () => { _isDirty = true; }, { once: false });
          modalBody.addEventListener('change', () => { _isDirty = true; }, { once: false });
        }
      }, 100);

      // Populate meta picker custom (searchable, grouped by scope, com cartão de contexto)
      Promise.all([
        import('../services/goals.js'),
        import('../services/metaLinks.js'),
      ]).then(([goalsMod, metaLinksHelper]) => {
        const { fetchGoals, GOAL_SCOPES, getResponsavelIds } = goalsMod;
        return Promise.all([
          fetchGoals(),
          Promise.resolve({ GOAL_SCOPES, getResponsavelIds, metaLinksHelper }),
        ]);
      }).then(([goals, { GOAL_SCOPES, getResponsavelIds, metaLinksHelper }]) => {
        let available = goals.filter(g => g.status === 'publicada');
        if (!available.length) available = goals.filter(g => g.status !== 'encerrada');

        // ─── Filtro hierárquico ────────────────────────────────────────
        // Master/diretoria/roles com system_view_all veem tudo. Demais
        // veem apenas metas coerentes com seu escopo de atuação:
        //   • global          → sempre visível (meta da empresa toda)
        //   • area            → apenas se o setor da meta estiver nos visibleSectors
        //   • nucleo          → se o núcleo da meta estiver em u.nucleos[] OU
        //                       se o setor estiver nos visibleSectors
        //   • squad           → apenas squads aos quais o usuário pertence
        //   • individual      → responsável é o próprio usuário, é um dos
        //                       assignees DESTA tarefa, ou o setor do responsável
        //                       está nos meus visibleSectors
        const seeAllGoals   = store.isMaster() || store.can('system_view_all');
        const visibleSetores = store.getVisibleSectors();          // null = ver tudo
        const myUid         = store.get('currentUser')?.uid || '';
        const myProfile     = store.get('userProfile') || {};
        const myNucleos     = Array.isArray(myProfile.nucleos) && myProfile.nucleos.length
                                ? myProfile.nucleos
                                : (myProfile.nucleo ? [myProfile.nucleo] : []);
        const myWorkspaceIds = new Set(
          (store.get('userWorkspaces') || []).map(w => w.id));
        const usersRef      = store.get('users') || [];
        const userSector    = (id) => (usersRef.find(u => u.id === id) || {}).sector || '';

        if (!seeAllGoals && Array.isArray(visibleSetores)) {
          const taskAssignees = Array.isArray(task.assignees) ? task.assignees : [];
          available = available.filter(g => {
            const escopo = g.escopo || 'individual';
            if (escopo === 'global') return true;
            if (escopo === 'area') {
              return !g.setor || visibleSetores.includes(g.setor);
            }
            if (escopo === 'nucleo') {
              const byNucleo = g.nucleo && myNucleos.includes(g.nucleo);
              const bySetor  = g.setor  && visibleSetores.includes(g.setor);
              return byNucleo || bySetor;
            }
            if (escopo === 'squad') {
              return !g.squadId || myWorkspaceIds.has(g.squadId);
            }
            if (escopo === 'individual') {
              const respIds = getResponsavelIds(g);
              if (respIds.includes(myUid) || g.gestorId === myUid) return true;
              if (respIds.some(r => taskAssignees.includes(r))) return true;
              // Responsável do meu setor → coordenador vê metas individuais
              // de toda a sua equipe.
              if (respIds.some(r => visibleSetores.includes(userSector(r)))) return true;
              return false;
            }
            return false;
          });
        }

        const sel     = document.getElementById('tm-goal');
        const info    = document.getElementById('tm-goal-info');
        const btn     = document.getElementById('tm-goal-btn');
        const btnLbl  = document.getElementById('tm-goal-btn-label');
        if (!sel || !btn) return;

        // ── Estado de seleção MULTI por responsável ──────────────
        // Source of truth: task.metaLinks (mutado em-place pelo picker).
        // O #tm-goal hidden vira "primeiro link" por back-compat.
        // Garante que task.metaLinks já está normalizado (sanitize fez a migração).
        if (!Array.isArray(task.metaLinks)) task.metaLinks = [];

        const linkKey = (l) => `${l.userId}::${l.goalId}::${l.metaRef}`;
        const hasLink = (uid, gid, mref) => task.metaLinks.some(l =>
          l.userId === uid && l.goalId === gid && l.metaRef === mref);
        const addLink = (uid, gid, mref) => {
          if (hasLink(uid, gid, mref)) return false;
          task.metaLinks.push({ userId: uid, goalId: gid, metaRef: mref });
          task._legacyPreserve = false; // user tocou no picker → não preservar legacy órfão
          return true;
        };
        const removeLink = (uid, gid, mref) => {
          const before = task.metaLinks.length;
          task.metaLinks = task.metaLinks.filter(l =>
            !(l.userId === uid && l.goalId === gid && l.metaRef === mref));
          if (task.metaLinks.length !== before) task._legacyPreserve = false;
          return task.metaLinks.length !== before;
        };
        const syncHiddenSelect = () => {
          const first = task.metaLinks[0];
          sel.innerHTML = first
            ? `<option value="${first.goalId}:${first.metaRef}" selected>(metaLinks)</option>`
            : '<option value="">Sem meta vinculada</option>';
          sel.value = first ? `${first.goalId}:${first.metaRef}` : '';
        };


        // Paleta fixa por escopo — mantém visual leve e diferenciado
        const scopeOrder = GOAL_SCOPES.map(s => s.value);
        const scopeMap   = Object.fromEntries(GOAL_SCOPES.map(s => [s.value, s]));
        const scopeColor = {
          individual: '#60A5FA',   // azul
          squad:      '#A78BFA',   // roxo
          nucleo:     '#34D399',   // verde
          area:       '#FBBF24',   // âmbar
          global:     '#F472B6',   // rosa
        };
        const nucleoMap  = { design:'Design', comunicacao:'Comunicação', redes_sociais:'Redes Sociais',
                             dados:'Dados', web:'Web', sistemas:'Sistemas', ia:'IA' };
        const workspaces = store.get('userWorkspaces') || [];

        // Helper: deriva o setor da meta — primário para agrupamento no popup.
        //   area    → g.setor
        //   nucleo  → g.setor
        //   squad   → setor do workspace (se único)
        //   individual → setor do primeiro responsável (via users)
        //   global  → '__global__' (separado no topo)
        const deriveSetor = (g) => {
          const escopo = g.escopo || 'individual';
          if (escopo === 'global') return '__global__';
          if (escopo === 'area' || escopo === 'nucleo') return g.setor || '';
          if (escopo === 'squad') {
            const ws = workspaces.find(w => w.id === g.squadId);
            return ws?.sector || g.setor || '';
          }
          if (escopo === 'individual') {
            const respIds = getResponsavelIds(g);
            for (const id of respIds) {
              const u = usersRef.find(u => u.id === id);
              if (u?.sector) return u.sector;
            }
            return g.setor || '';
          }
          return g.setor || '';
        };

        // Monta índice + árvore agrupada por SETOR → GOAL → PILAR → metas
        // Cada "item" é uma meta-avaliável (g.pilares[].metas[]).
        // Selecão é MULTI: cada par (responsável,meta) entra em task.metaLinks.
        const metaIndex = {};
        const bySector  = {}; // { setor: { goalId: { goal, pilares: { pIdx: { pilarName, items[] } } } } }

        // Valores distintos p/ alimentar os filtros do popup
        const respSet  = new Map();   // id → name
        const gestorSet = new Map();  // id → name
        const squadSet = new Map();   // id → {name,icon}

        available.forEach(g => {
          const escopo = g.escopo || 'individual';
          const goalName = g.nome || g.objetivoNucleo || g.titulo || 'Meta';
          const respIds = getResponsavelIds(g);
          const derivedSetor = deriveSetor(g);

          respIds.forEach(id => {
            const u = usersRef.find(x => x.id === id);
            if (u) respSet.set(id, u.name);
          });
          if (g.gestorId) {
            const u = usersRef.find(x => x.id === g.gestorId);
            if (u) gestorSet.set(g.gestorId, u.name);
          }
          if (g.squadId) {
            const ws = workspaces.find(w => w.id === g.squadId);
            if (ws) squadSet.set(g.squadId, { name: ws.name, icon: ws.icon || '◊' });
          }

          (g.pilares || []).forEach((pilar, pi) => {
            (pilar.metas || []).forEach((meta, mi) => {
              const metaRef = `${pi}:${mi}`;
              const val = `${g.id}:${metaRef}`;            // chave estável p/ index
              const metaName = meta.titulo || `Meta ${mi + 1}`;
              const pilarName = pilar.titulo || `Pilar ${pi + 1}`;

              metaIndex[val] = {
                goalId: g.id, pilarIdx: pi, metaIdx: mi, metaRef,
                escopo, goalName, metaName, pilarName,
                responsavelIds: respIds,
                gestorId:       g.gestorId || '',
                squadId:        g.squadId || '',
                nucleo:         g.nucleo  || '',
                setor:          g.setor   || '',
                derivedSetor,
              };

              const normStr = (`${metaName} ${pilarName} ${goalName} ${derivedSetor}`)
                .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
              const sectorKey = derivedSetor || '__unknown__';

              const sectorBucket = (bySector[sectorKey] = bySector[sectorKey] || {});
              const goalBucket = (sectorBucket[g.id] = sectorBucket[g.id] || {
                goalId: g.id, goalName, escopo,
                gestorId: g.gestorId || '',
                squadId:  g.squadId || '',
                responsavelIds: respIds,
                pilares: {},        // pilarIdx → { pilarName, items[] }
              });
              const pilarBucket = (goalBucket.pilares[pi] = goalBucket.pilares[pi] || {
                pilarIdx: pi, pilarName, items: [],
              });
              pilarBucket.items.push({
                val, goalId: g.id, pilarIdx: pi, metaIdx: mi, metaRef,
                metaName, pilarName, goalName, norm: normStr, escopo,
                responsavelIds: respIds,
                gestorId: g.gestorId || '',
                squadId:  g.squadId || '',
              });
            });
          });
        });

        // Ordem de apresentação dos setores: Globais no topo, setores do
        // usuário (visibleSectors) a seguir em ordem alfabética, depois os
        // demais, por último 'Sem setor' (quando existir).
        const sectorKeys = Object.keys(bySector);
        const priority = new Set(Array.isArray(visibleSetores) ? visibleSetores : []);
        const sectorOrder = sectorKeys.sort((a, b) => {
          if (a === '__global__') return -1;
          if (b === '__global__') return 1;
          if (a === '__unknown__') return 1;
          if (b === '__unknown__') return -1;
          const pa = priority.has(a), pb = priority.has(b);
          if (pa !== pb) return pa ? -1 : 1;
          return a.localeCompare(b, 'pt-BR');
        });
        const sectorTitle = (key) => {
          if (key === '__global__') return 'Globais · corporativas';
          if (key === '__unknown__') return 'Sem setor definido';
          return key;
        };
        const sectorIcon = (key) => {
          if (key === '__global__') return '✦';
          if (key === '__unknown__') return '∅';
          return '▣';
        };

        syncHiddenSelect();

        // Filtros do popup (aplicados em buildListHtml). Inicialmente vazios.
        const popupFilters = { escopo: '', resp: '', gestor: '', squad: '' };

        // Estado do acordeão
        const sectorCollapsed = {};  // { sectorKey: true/false }
        const goalCollapsed   = {};  // { sectorKey + '::' + goalId: true/false }
        sectorKeys.forEach(k => {
          const isPriority = priority.has(k) || k === '__global__';
          sectorCollapsed[k] = !isPriority;
        });
        sectorKeys.forEach(sk => {
          Object.keys(bySector[sk] || {}).forEach(gid => {
            goalCollapsed[sk + '::' + gid] = false;
          });
        });

        // ─── Aba ativa do picker (responsável atualmente sendo editado) ───
        // assigneeIds vem de task.assignees; se vazio, exibe aba "Tarefa"
        // (vincula com userId='__task__' como placeholder não-individual).
        const SCOPE_USER = '__task__';
        const taskAssignees = () => Array.isArray(task.assignees) ? task.assignees : [];
        let activeUserId = '';   // '' = sem aba ainda; será definido ao abrir o modal

        const passesFilters = (it, goalBucket) => {
          if (popupFilters.escopo && it.escopo !== popupFilters.escopo) return false;
          if (popupFilters.resp && !(goalBucket.responsavelIds || []).includes(popupFilters.resp)) return false;
          if (popupFilters.gestor && goalBucket.gestorId !== popupFilters.gestor) return false;
          if (popupFilters.squad && goalBucket.squadId !== popupFilters.squad) return false;
          return true;
        };

        // ─── Renderiza a árvore (aba do responsável activeUserId) ────
        // Hierarquia: SETOR → GOAL → PILAR → metas (multi-toggle).
        const buildListHtml = (query = '') => {
          const q = (query || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
          const tokens = q ? q.split(/\s+/).filter(Boolean) : [];

          const hasActiveQuery = !!q
            || !!popupFilters.escopo || !!popupFilters.resp
            || !!popupFilters.gestor || !!popupFilters.squad;

          const uid = activeUserId || SCOPE_USER;

          let html = '';
          let totalShown = 0;

          sectorOrder.forEach(sectorKey => {
            const goalsMap = bySector[sectorKey] || {};
            const goalBuckets = Object.values(goalsMap).sort((a, b) =>
              (a.goalName || '').localeCompare(b.goalName || '', 'pt-BR'));

            const goalsWithMatches = goalBuckets.map(gb => {
              const pilares = Object.values(gb.pilares).map(pb => {
                const items = pb.items.filter(it =>
                  passesFilters(it, gb) &&
                  (!tokens.length || tokens.every(t => it.norm.includes(t))));
                return { ...pb, items };
              }).filter(pb => pb.items.length)
                .sort((a, b) => a.pilarIdx - b.pilarIdx);
              return { ...gb, pilaresFiltered: pilares };
            }).filter(gb => gb.pilaresFiltered.length);

            if (!goalsWithMatches.length) return;
            const sectorTotal = goalsWithMatches.reduce((n, gb) =>
              n + gb.pilaresFiltered.reduce((m, p) => m + p.items.length, 0), 0);
            totalShown += sectorTotal;

            const isGlobal = sectorKey === '__global__';
            const headerColor = isGlobal ? scopeColor.global : 'var(--text-muted)';
            const sectorIsCollapsed = hasActiveQuery ? false : !!sectorCollapsed[sectorKey];
            const sectorChevron = sectorIsCollapsed ? '▸' : '▾';

            html += `
              <button type="button" class="tm-goal-sector-header" data-sector="${esc(sectorKey)}"
                style="width:100%;text-align:left;cursor:pointer;background:transparent;
                  padding:10px 12px 6px;margin-top:8px;border:none;border-top:1px solid var(--border-subtle);
                  display:flex;align-items:center;gap:8px;
                  font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
                  color:${headerColor};">
                <span style="font-size:0.75rem;line-height:1;width:10px;color:var(--text-muted);">${sectorChevron}</span>
                <span style="font-size:0.875rem;line-height:1;">${sectorIcon(sectorKey)}</span>
                <span>${esc(sectorTitle(sectorKey))}</span>
                <span style="color:var(--text-muted);font-weight:500;letter-spacing:0;">· ${sectorTotal}</span>
              </button>`;

            if (sectorIsCollapsed) return;

            goalsWithMatches.forEach(gb => {
              const gColor = scopeColor[gb.escopo] || '#9CA3AF';
              const gSc    = scopeMap[gb.escopo] || { icon:'•', label: gb.escopo };
              const goalKey = sectorKey + '::' + gb.goalId;
              const goalIsCollapsed = hasActiveQuery ? false : !!goalCollapsed[goalKey];
              const goalChevron = goalIsCollapsed ? '▸' : '▾';

              const goalTotal = gb.pilaresFiltered.reduce((n, p) => n + p.items.length, 0);

              html += `
                <button type="button" class="tm-goal-goal-header" data-goal="${esc(goalKey)}"
                  style="width:100%;text-align:left;cursor:pointer;
                    margin:6px 0 2px;padding:6px 10px;display:flex;align-items:center;gap:8px;
                    background:${gColor}0f;border:none;border-left:3px solid ${gColor};border-radius:4px;">
                  <span style="font-size:0.75rem;line-height:1;width:10px;color:${gColor};">${goalChevron}</span>
                  <span style="font-size:0.8125rem;font-weight:700;color:var(--text-primary);">
                    📌 ${esc(gb.goalName)}
                  </span>
                  <span style="padding:1px 7px;border-radius:999px;font-size:0.6875rem;font-weight:600;
                    background:${gColor}22;color:${gColor};border:1px solid ${gColor}44;">
                    ${gSc.icon} ${esc(gSc.label)}
                  </span>
                  <span style="color:var(--text-muted);font-size:0.6875rem;margin-left:auto;">
                    ${goalTotal} ${goalTotal === 1 ? 'meta' : 'metas'}
                  </span>
                </button>`;

              if (goalIsCollapsed) return;

              gb.pilaresFiltered.forEach(pb => {
                const allChecked = pb.items.every(it => hasLink(uid, it.goalId, it.metaRef));
                const someChecked = pb.items.some(it => hasLink(uid, it.goalId, it.metaRef));
                const pilarBtnLbl = allChecked ? '✓ Pilar inteiro' : (someChecked ? '◐ Marcar pilar' : '+ Pilar inteiro');

                html += `
                  <div style="margin:4px 0 2px 14px;display:flex;align-items:center;gap:8px;">
                    <span style="font-size:0.75rem;color:var(--text-muted);font-weight:600;flex:1;">
                      📂 ${esc(pb.pilarName)}
                      <span style="color:var(--text-muted);font-weight:400;font-size:0.6875rem;">
                        · ${pb.items.length} ${pb.items.length === 1 ? 'meta' : 'metas'}
                      </span>
                    </span>
                    <button type="button" class="tm-goal-pilar-bulk"
                      data-goal-id="${esc(gb.goalId)}" data-pilar-idx="${pb.pilarIdx}"
                      style="font-size:0.6875rem;padding:3px 9px;border-radius:6px;cursor:pointer;
                        background:${allChecked ? gColor + '22' : 'var(--bg-elevated)'};
                        border:1px solid ${allChecked ? gColor + '66' : 'var(--border-subtle)'};
                        color:${allChecked ? gColor : 'var(--text-muted)'};font-weight:600;">
                      ${pilarBtnLbl}
                    </button>
                  </div>`;

                pb.items.forEach(it => {
                  const isSel = hasLink(uid, it.goalId, it.metaRef);
                  const color = scopeColor[it.escopo] || '#9CA3AF';
                  html += `
                    <button type="button" class="tm-goal-item"
                      data-goal-id="${esc(it.goalId)}" data-meta-ref="${esc(it.metaRef)}"
                      data-val="${esc(it.val)}"
                      style="width:calc(100% - 28px);margin-left:28px;display:flex;align-items:flex-start;gap:10px;
                        padding:8px 10px;margin-top:3px;margin-bottom:3px;
                        background:${isSel ? color + '18' : 'var(--bg-elevated)'};
                        border:1px solid ${isSel ? color + '66' : 'var(--border-subtle)'};
                        border-radius:8px;cursor:pointer;text-align:left;transition:background .1s;">
                      <span style="display:inline-flex;align-items:center;justify-content:center;
                        width:16px;height:16px;border-radius:4px;flex-shrink:0;margin-top:2px;
                        background:${isSel ? color : 'transparent'};
                        border:1.5px solid ${isSel ? color : 'var(--border-default)'};
                        color:#fff;font-size:0.6875rem;font-weight:900;">
                        ${isSel ? '✓' : ''}
                      </span>
                      <span style="flex:1;min-width:0;">
                        <div style="font-size:0.8125rem;color:var(--text-primary);font-weight:500;
                          white-space:normal;line-height:1.35;">${esc(it.metaName)}</div>
                      </span>
                    </button>`;
                });
              });
            });
          });

          const hasFilterActive = q || popupFilters.escopo || popupFilters.resp || popupFilters.gestor || popupFilters.squad;
          if (!totalShown && hasFilterActive) {
            html += `<div style="padding:28px;text-align:center;color:var(--text-muted);font-size:0.875rem;">
              Nenhuma meta encontrada com os filtros atuais
              <div style="margin-top:6px;font-size:0.75rem;">Limpe os filtros ou ajuste a busca.</div>
            </div>`;
          } else if (!totalShown) {
            html += `<div style="padding:28px;text-align:center;color:var(--text-muted);font-size:0.875rem;">
              Nenhuma meta publicada disponível</div>`;
          }
          return html;
        };

        // Cartão de contexto + lista de metas vinculadas (resumo)
        const renderInfo = () => {
          if (!info) return;
          const links = task.metaLinks || [];
          if (!links.length) { info.style.display = 'none'; info.innerHTML = ''; return; }

          // Agrupa por (goalId+metaRef) para mostrar quantos responsáveis em cada
          const grouped = new Map();
          for (const l of links) {
            const k = `${l.goalId}:${l.metaRef}`;
            if (!grouped.has(k)) grouped.set(k, { meta: metaIndex[k], users: [] });
            grouped.get(k).users.push(l.userId);
          }

          const cards = [...grouped.values()].map(({ meta, users: uids }) => {
            if (!meta) return '';
            const sc = scopeMap[meta.escopo] || { icon:'•', label: meta.escopo };
            const color = scopeColor[meta.escopo] || '#9CA3AF';
            const userNames = uids
              .filter(uid => uid !== SCOPE_USER)
              .map(uid => (users.find(u => u.id === uid) || {}).name || '?')
              .join(', ');
            return `
              <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;
                background:${color}10;border-left:2px solid ${color};margin-bottom:4px;font-size:0.75rem;">
                <span style="color:${color};font-weight:700;">${sc.icon}</span>
                <span style="flex:1;color:var(--text-primary);">
                  <strong>${esc(meta.metaName)}</strong>
                  <span style="color:var(--text-muted);">· ${esc(meta.pilarName)}</span>
                </span>
                ${userNames
                  ? `<span style="color:var(--text-muted);font-size:0.6875rem;">👤 ${esc(userNames)}</span>`
                  : ''}
              </div>`;
          }).join('');

          info.style.display = 'block';
          info.style.borderLeft = `none`;
          info.innerHTML = `
            <div style="font-size:0.6875rem;color:var(--text-muted);text-transform:uppercase;
              letter-spacing:.05em;font-weight:700;margin-bottom:4px;">
              ${links.length} vínculo${links.length === 1 ? '' : 's'} de meta
            </div>
            ${cards}`;
        };

        // Atualiza estado visual do botão trigger
        const btnIcon   = document.getElementById('tm-goal-btn-icon');
        const btnAction = document.getElementById('tm-goal-btn-action');
        const refreshBtnLabel = () => {
          const links = task.metaLinks || [];
          if (!links.length) {
            btn.classList.add('tm-goal-empty');
            btn.classList.remove('tm-goal-filled');
            btn.style.background = 'transparent';
            btn.style.border = '1.5px dashed var(--border-default)';
            btn.style.color = 'var(--text-muted)';
            if (btnIcon) btnIcon.textContent = '🎯';
            if (btnLbl)  btnLbl.textContent = 'Vincular meta(s)…';
            if (btnAction) { btnAction.textContent = 'Escolher'; btnAction.style.color = 'var(--text-muted)'; }
            return;
          }
          // Agrega por meta para o resumo do botão
          const distinctMetas = new Set(links.map(l => `${l.goalId}:${l.metaRef}`));
          const firstMeta = metaIndex[links[0].goalId + ':' + links[0].metaRef];
          const color = firstMeta ? (scopeColor[firstMeta.escopo] || '#60A5FA') : '#60A5FA';
          btn.classList.remove('tm-goal-empty');
          btn.classList.add('tm-goal-filled');
          btn.style.background = color + '14';
          btn.style.border = '1.5px solid ' + color + '66';
          btn.style.color = 'var(--text-primary)';
          if (btnIcon) btnIcon.textContent = '🎯';
          if (btnLbl) {
            btnLbl.innerHTML = `
              <span style="color:var(--text-primary);font-weight:600;">
                ${distinctMetas.size} meta${distinctMetas.size === 1 ? '' : 's'} vinculada${distinctMetas.size === 1 ? '' : 's'}
              </span>
              <span style="color:var(--text-muted);font-size:0.75rem;margin-left:6px;font-weight:500;">
                · ${links.length} vínculo${links.length === 1 ? '' : 's'}
              </span>`;
          }
          if (btnAction) { btnAction.textContent = 'Editar'; btnAction.style.color = color; }
          syncHiddenSelect();
        };

        // Constrói tabs de responsáveis
        const buildTabs = () => {
          const ids = taskAssignees();
          const tabs = ids.length
            ? ids.map(uid => {
                // resolveUserName cobre: cache local, store, pending_* (deriva
                // email do slug), email-lookup. Nunca retorna "(usuário)" cru.
                const u = users.find(x => x.id === uid);
                const label = u?.name || resolveUserName(uid);
                return { id: uid, label };
              })
            : [{ id: SCOPE_USER, label: 'Tarefa (sem responsável)' }];

          // Default: ativa o primeiro
          if (!activeUserId || !tabs.some(t => t.id === activeUserId)) {
            activeUserId = tabs[0].id;
          }

          return tabs.map(t => {
            const isActive = t.id === activeUserId;
            const count = (task.metaLinks || []).filter(l => l.userId === t.id).length;
            // BUG fix: a paleta 'platinum' não define --accent-primary →
            // tab ativa ficava com fundo transparente + texto branco =
            // invisível. Trocado por --brand-gold que existe em todas as paletas.
            return `
              <button type="button" class="tm-goal-tab" data-uid="${esc(t.id)}"
                style="padding:6px 12px;border-radius:8px;cursor:pointer;font-size:0.8125rem;
                  background:${isActive ? 'var(--brand-gold)' : 'var(--bg-elevated)'};
                  border:1px solid ${isActive ? 'var(--brand-gold)' : 'var(--border-subtle)'};
                  color:${isActive ? '#fff' : 'var(--text-secondary)'};font-weight:${isActive ? '600' : '500'};
                  display:inline-flex;align-items:center;gap:6px;white-space:nowrap;">
                👤 ${esc(t.label)}
                ${count
                  ? `<span style="background:${isActive ? 'rgba(255,255,255,0.25)' : 'rgba(212,168,67,0.15)'};
                      color:${isActive ? '#fff' : 'var(--brand-gold)'};padding:1px 7px;border-radius:999px;
                      font-size:0.6875rem;font-weight:700;">${count}</span>`
                  : ''}
              </button>`;
          }).join('');
        };

        // ─── Abre modal dedicado para escolha das metas ─────────────
        const openMetaModal = () => {
          const totalMetas = Object.values(bySector).reduce((acc, goalsMap) =>
            acc + Object.values(goalsMap).reduce((n, gb) =>
              n + Object.values(gb.pilares).reduce((m, p) => m + p.items.length, 0), 0), 0);

          // Listas ordenadas p/ os dropdowns de filtro
          const respOpts = [...respSet.entries()]
            .sort((a, b) => (a[1] || '').localeCompare(b[1] || '', 'pt-BR'))
            .map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
          const gestorOpts = [...gestorSet.entries()]
            .sort((a, b) => (a[1] || '').localeCompare(b[1] || '', 'pt-BR'))
            .map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
          const squadOpts = [...squadSet.entries()]
            .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || '', 'pt-BR'))
            .map(([id, ws]) => `<option value="${esc(id)}">${esc((ws.icon || '◊') + ' ' + ws.name)}</option>`).join('');
          const scopeOpts = GOAL_SCOPES
            .map(s => `<option value="${s.value}">${s.icon} ${esc(s.label)}</option>`).join('');

          const selectCss = `padding:7px 10px;font-size:0.8125rem;background:var(--bg-elevated);
            border:1px solid var(--border-default);border-radius:7px;color:var(--text-primary);
            outline:none;min-width:130px;height:34px;`;

          // Define aba inicial: usa o primeiro assignee se houver
          if (!activeUserId) {
            const ids = taskAssignees();
            activeUserId = ids[0] || SCOPE_USER;
          }

          const ref = modal.open({
            title: `🎯 Vincular metas (${totalMetas} disponíveis)`,
            size: 'lg',
            closeable: true,
            content: `
              <div style="display:flex;flex-direction:column;gap:10px;min-height:400px;max-height:70vh;">
                <div id="tm-goal-tabs" style="display:flex;gap:6px;flex-wrap:wrap;
                  padding:4px 0 8px;border-bottom:1px solid var(--border-subtle);">
                  ${buildTabs()}
                </div>

                <div style="font-size:0.75rem;color:var(--text-muted);line-height:1.4;">
                  Marque as metas que este responsável irá evidenciar com a tarefa.
                  Use <strong>"+ Pilar inteiro"</strong> para selecionar um pilar inteiro de uma vez.
                </div>

                <input type="text" id="tm-goal-modal-search"
                  placeholder="Buscar por nome da meta, pilar, plano ou setor…"
                  style="width:100%;padding:10px 14px;font-size:0.9375rem;
                    background:var(--bg-elevated);border:1px solid var(--border-default);
                    border-radius:8px;color:var(--text-primary);outline:none;" />

                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                  <select id="tm-goal-fil-escopo" style="${selectCss}">
                    <option value="">Todos os escopos</option>${scopeOpts}
                  </select>
                  <select id="tm-goal-fil-resp" style="${selectCss}" ${respSet.size ? '' : 'disabled'}>
                    <option value="">Todos os responsáveis</option>${respOpts}
                  </select>
                  <select id="tm-goal-fil-gestor" style="${selectCss}" ${gestorSet.size ? '' : 'disabled'}>
                    <option value="">Todos os gestores</option>${gestorOpts}
                  </select>
                  <select id="tm-goal-fil-squad" style="${selectCss}" ${squadSet.size ? '' : 'disabled'}>
                    <option value="">Todos os squads</option>${squadOpts}
                  </select>
                  <button type="button" id="tm-goal-fil-clear" class="btn btn-ghost btn-sm"
                    style="height:34px;padding:0 12px;font-size:0.75rem;">↺ Limpar</button>
                  <span style="margin-left:auto;display:flex;gap:4px;">
                    <button type="button" id="tm-goal-expand-all" class="btn btn-ghost btn-sm"
                      style="height:34px;padding:0 10px;font-size:0.75rem;" title="Expandir tudo">▾ Expandir</button>
                    <button type="button" id="tm-goal-collapse-all" class="btn btn-ghost btn-sm"
                      style="height:34px;padding:0 10px;font-size:0.75rem;" title="Colapsar tudo">▸ Colapsar</button>
                  </span>
                </div>

                <div id="tm-goal-modal-list" style="flex:1;overflow-y:auto;padding:4px 2px 8px;">
                  ${buildListHtml('')}
                </div>

                <div style="display:flex;justify-content:space-between;align-items:center;
                  padding:8px 0 0;border-top:1px solid var(--border-subtle);">
                  <button type="button" id="tm-goal-clear-user" class="btn btn-ghost btn-sm"
                    style="font-size:0.75rem;color:var(--text-muted);">
                    🗑 Limpar metas deste responsável
                  </button>
                  <button type="button" id="tm-goal-clear-all" class="btn btn-ghost btn-sm"
                    style="font-size:0.75rem;color:var(--text-muted);">
                    Limpar TODAS
                  </button>
                </div>
              </div>`,
            footer: [
              { label: 'Concluir', class: 'btn-primary', closeOnClick: true },
            ],
          });

          const bodyEl   = ref.getBody();
          const tabsEl   = bodyEl.querySelector('#tm-goal-tabs');
          const searchEl = bodyEl.querySelector('#tm-goal-modal-search');
          const listEl   = bodyEl.querySelector('#tm-goal-modal-list');
          const escFil   = bodyEl.querySelector('#tm-goal-fil-escopo');
          const respFil  = bodyEl.querySelector('#tm-goal-fil-resp');
          const gestFil  = bodyEl.querySelector('#tm-goal-fil-gestor');
          const sqFil    = bodyEl.querySelector('#tm-goal-fil-squad');
          const clearBtn = bodyEl.querySelector('#tm-goal-fil-clear');
          const expAllBtn = bodyEl.querySelector('#tm-goal-expand-all');
          const colAllBtn = bodyEl.querySelector('#tm-goal-collapse-all');
          const clearUserBtn = bodyEl.querySelector('#tm-goal-clear-user');
          const clearAllBtn  = bodyEl.querySelector('#tm-goal-clear-all');

          setTimeout(() => searchEl?.focus(), 50);

          const refreshList = () => {
            listEl.innerHTML = buildListHtml(searchEl?.value || '');
          };
          const refreshTabs = () => {
            tabsEl.innerHTML = buildTabs();
          };

          searchEl?.addEventListener('input', refreshList);
          searchEl?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              const first = listEl.querySelector('.tm-goal-item');
              if (first) first.click();
            }
          });

          escFil?.addEventListener('change', () => { popupFilters.escopo = escFil.value; refreshList(); });
          respFil?.addEventListener('change', () => { popupFilters.resp   = respFil.value; refreshList(); });
          gestFil?.addEventListener('change', () => { popupFilters.gestor = gestFil.value; refreshList(); });
          sqFil?.addEventListener('change',   () => { popupFilters.squad  = sqFil.value;   refreshList(); });
          clearBtn?.addEventListener('click', () => {
            popupFilters.escopo = popupFilters.resp = popupFilters.gestor = popupFilters.squad = '';
            if (escFil)  escFil.value  = '';
            if (respFil) respFil.value = '';
            if (gestFil) gestFil.value = '';
            if (sqFil)   sqFil.value   = '';
            if (searchEl) searchEl.value = '';
            refreshList();
          });

          expAllBtn?.addEventListener('click', () => {
            Object.keys(sectorCollapsed).forEach(k => sectorCollapsed[k] = false);
            Object.keys(goalCollapsed).forEach(k => goalCollapsed[k] = false);
            refreshList();
          });
          colAllBtn?.addEventListener('click', () => {
            Object.keys(sectorCollapsed).forEach(k => sectorCollapsed[k] = true);
            Object.keys(goalCollapsed).forEach(k => goalCollapsed[k] = true);
            refreshList();
          });

          clearUserBtn?.addEventListener('click', () => {
            const uid = activeUserId;
            task.metaLinks = task.metaLinks.filter(l => l.userId !== uid);
            task._legacyPreserve = false;
            _isDirty = true;
            refreshList();
            refreshTabs();
            refreshBtnLabel();
            renderInfo();
          });
          clearAllBtn?.addEventListener('click', () => {
            if (!task.metaLinks.length) return;
            if (!confirm('Remover todas as vinculações de meta desta tarefa?')) return;
            task.metaLinks = [];
            task._legacyPreserve = false;
            _isDirty = true;
            refreshList();
            refreshTabs();
            refreshBtnLabel();
            renderInfo();
          });

          // Tabs (delegação)
          tabsEl.addEventListener('click', (e) => {
            const tab = e.target.closest('.tm-goal-tab');
            if (!tab) return;
            const uid = tab.getAttribute('data-uid');
            if (!uid) return;
            activeUserId = uid;
            refreshTabs();
            refreshList();
          });

          // Lista (delegação)
          listEl.addEventListener('click', (e) => {
            const sectorHeader = e.target.closest('.tm-goal-sector-header');
            if (sectorHeader) {
              const k = sectorHeader.getAttribute('data-sector');
              if (k != null) { sectorCollapsed[k] = !sectorCollapsed[k]; refreshList(); }
              return;
            }
            const goalHeader = e.target.closest('.tm-goal-goal-header');
            if (goalHeader) {
              const k = goalHeader.getAttribute('data-goal');
              if (k != null) { goalCollapsed[k] = !goalCollapsed[k]; refreshList(); }
              return;
            }
            // Pilar bulk
            const pilarBtn = e.target.closest('.tm-goal-pilar-bulk');
            if (pilarBtn) {
              const gid = pilarBtn.getAttribute('data-goal-id');
              const pIdx = parseInt(pilarBtn.getAttribute('data-pilar-idx'), 10);
              const pb = bySector[derivedSetorOfGoal(gid) || '__unknown__']?.[gid]?.pilares?.[pIdx];
              if (!pb) return;
              const uid = activeUserId || SCOPE_USER;
              const allChecked = pb.items.every(it => hasLink(uid, it.goalId, it.metaRef));
              if (allChecked) {
                // toggle off all
                pb.items.forEach(it => removeLink(uid, it.goalId, it.metaRef));
              } else {
                // add missing
                pb.items.forEach(it => addLink(uid, it.goalId, it.metaRef));
              }
              _isDirty = true;
              refreshList();
              refreshTabs();
              refreshBtnLabel();
              renderInfo();
              return;
            }
            // Item meta (toggle)
            const item = e.target.closest('.tm-goal-item');
            if (!item) return;
            const gid = item.getAttribute('data-goal-id');
            const mref = item.getAttribute('data-meta-ref');
            if (!gid || !mref) return;
            const uid = activeUserId || SCOPE_USER;
            if (hasLink(uid, gid, mref)) removeLink(uid, gid, mref);
            else addLink(uid, gid, mref);
            _isDirty = true;
            refreshList();
            refreshTabs();
            refreshBtnLabel();
            renderInfo();
          });
        };

        // Helper p/ encontrar setor de um goalId (usado no pilar-bulk)
        const _goalSectorIndex = {};
        Object.keys(bySector).forEach(sk => {
          Object.keys(bySector[sk] || {}).forEach(gid => { _goalSectorIndex[gid] = sk; });
        });
        function derivedSetorOfGoal(gid) { return _goalSectorIndex[gid] || ''; }

        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          openMetaModal();
        });

        // Estado inicial
        refreshBtnLabel();
        renderInfo();
      }).catch((e) => { console.warn('[taskModal] meta populate:', e?.message || e); });
    });
  });
}

function buildHTML(task, users, projects, tags, assignees, observers, isEdit, taskType = null, taskSector = null, absences = []) {
  const opt = (arr, valKey, labelKey, cur) => arr.map(x =>
    `<option value="${x[valKey]}" ${cur===x[valKey]?'selected':''}>${esc(x[labelKey])}</option>`
  ).join('');

  // Projeto: NÃO filtramos por sector aqui porque fetchProjects() já restringe
  // o que o usuário pode ver (visibleSectors + squads ativos). O filtro extra
  // por sector exato quebrava casos como tarefas importadas do Planner
  // (sector='Marketing' fixo) quando o projeto desejado tinha outro sector
  // ou quando todos os projetos do usuário estavam em sectors distintos.
  // Mantemos a tarefa atualmente vinculada SEMPRE listada (mesmo se filtros
  // mudarem e ela ficar fora do conjunto), pra não "perder" o vínculo no UI.
  const seenIds = new Set();
  const projectList = [];
  projects.forEach(p => {
    if (!p?.id || seenIds.has(p.id)) return;
    seenIds.add(p.id);
    projectList.push(p);
  });
  // Garante que o projeto vinculado apareça na lista (mesmo se ele não está
  // no fetchProjects por arquivamento ou filtro de squad/setor inacessível).
  if (task.projectId && !seenIds.has(task.projectId)) {
    const fallback = { id: task.projectId, name: '(projeto vinculado)', icon: '🔒' };
    projectList.unshift(fallback);
  }
  const projectOpts = `<option value="">— Sem projeto —</option>` +
    projectList
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

  // Observadores: mesmo visual dos chips de assignees mas sem alerta
  // de ausência (observador não trabalha na tarefa, só acompanha).
  const observerChips = (observers || []).map(uid => {
    const u = activeUsers.find(u=>u.id===uid);
    if (!u) return '';
    return `<div class="assignee-chip observer-chip" data-obs-uid="${uid}">
      <div class="avatar" style="background:${u.avatarColor||'#3B82F6'};width:20px;height:20px;font-size:0.5rem;">${getInitials(u.name)}</div>
      ${esc(u.name.split(' ')[0])}<span style="font-size:0.7rem;opacity:0.6;">✕</span></div>`;
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
        <label class="form-label">Link da entrega</label>
        <input type="url" id="tm-delivery-link" class="form-input"
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
            <span>Tarefa recorrente</span>
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
                <input type="date" id="tm-rec-start" class="form-input" required />
              </div>
              <div>
                <label class="form-label" style="font-size:0.75rem;">
                  Parar em <span style="color:#EF4444;">*</span>
                </label>
                <input type="date" id="tm-rec-end" class="form-input" required />
              </div>
            </div>
            <p style="font-size:0.7rem;color:var(--text-muted);margin-top:10px;margin-bottom:0;">
              ℹ As instâncias são geradas automaticamente quando alguém abrir a página de Tarefas. <strong>Defina sempre uma data de encerramento</strong> (limite de 24 meses); pode editar depois em Configurações › Tarefas recorrentes.
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
      <!-- Tipo de tarefa — picker custom com lista agrupada por setor -->
      <div class="task-detail-field">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
          <span class="task-detail-label" style="margin:0;">Tipo de tarefa</span>
        </div>
        <!-- Select escondido preserva o contrato de value pro handleSave;
             interação visual fica no botão custom abaixo. -->
        <select id="tm-type-id" style="display:none;">
          <option value="">— Padrão (sem tipo) —</option>
          ${(store.get('taskTypes')||[]).map(t =>
            `<option value="${t.id}" ${(task.typeId||task.type)===t.id?'selected':''}>${esc(t.icon||'')} ${esc(t.name)}</option>`
          ).join('')}
        </select>
        ${(() => {
          const types = store.get('taskTypes') || [];
          const selectedId = task.typeId || task.type || '';
          const selected = types.find(t => t.id === selectedId);
          const dotColor = selected?.color || 'var(--border-default)';
          const label = selected
            ? `<span style="font-size:1rem;flex-shrink:0;">${esc(selected.icon || '◈')}</span>
               <span style="flex:1;font-weight:500;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(selected.name)}</span>
               ${selected.sector ? `<span style="font-size:0.6875rem;color:var(--text-muted);font-weight:400;">${esc(selected.sector)}</span>` : ''}`
            : `<span style="flex:1;color:var(--text-muted);">— Padrão (sem tipo) —</span>`;
          return `
            <button type="button" id="tm-type-btn"
              style="width:100%;display:flex;align-items:center;gap:10px;
                padding:8px 12px;border-radius:var(--radius-md);cursor:pointer;
                background:var(--bg-surface);border:1px solid var(--border-default);
                font-family:inherit;font-size:0.875rem;text-align:left;
                transition:border-color 0.15s;">
              <span style="width:8px;height:8px;border-radius:50%;background:${dotColor};flex-shrink:0;"></span>
              ${label}
              <span style="font-size:0.625rem;color:var(--text-muted);flex-shrink:0;">▾</span>
            </button>
          `;
        })()}
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
        <!-- Select escondido: mantém o contrato do save (#tm-goal.value) -->
        <select id="tm-goal" style="display:none;">
          <option value="">Sem meta vinculada</option>
        </select>
        <!-- Trigger: cara de botão de ação (não de campo). Muda de estilo
             quando há meta vinculada (borda sólida + fundo leve da cor do escopo). -->
        <button type="button" id="tm-goal-btn" class="tm-goal-trigger tm-goal-empty"
          style="width:100%;display:flex;align-items:center;gap:10px;
            padding:10px 14px;border-radius:var(--radius-md);cursor:pointer;text-align:left;
            font-size:0.875rem;font-weight:500;transition:all .15s ease;
            background:transparent;border:1.5px dashed var(--border-default);color:var(--text-muted);">
          <span id="tm-goal-btn-icon" style="font-size:1rem;flex-shrink:0;">🎯</span>
          <span id="tm-goal-btn-label" style="flex:1;overflow:hidden;text-overflow:ellipsis;
            white-space:nowrap;">Vincular meta…</span>
          <span id="tm-goal-btn-action" style="font-size:0.6875rem;font-weight:700;
            letter-spacing:.05em;text-transform:uppercase;opacity:0.7;">Escolher</span>
        </button>
        <!-- Cartão com contexto da meta (escopo + identidade) -->
        <div id="tm-goal-info" style="margin-top:6px;display:none;
          padding:8px 10px;border-radius:6px;font-size:0.75rem;line-height:1.35;
          background:var(--bg-surface);border:1px solid var(--border-subtle);"></div>
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
        <div class="task-detail-label" style="display:flex;align-items:center;gap:6px;">
          Observadores
          <span title="Acompanham a tarefa por notificações, mas NÃO são responsáveis (não conta em metas/produtividade)"
            style="font-size:0.6875rem;color:var(--text-muted);font-weight:400;
            padding:1px 6px;background:var(--bg-surface);border-radius:8px;cursor:help;">
            ?
          </span>
        </div>
        <div class="assignee-picker" id="observer-picker">
          ${observerChips}
          <button class="assignee-add-btn" id="observer-add-btn" title="Adicionar observador">+</button>
        </div>
        <div id="observer-dropdown" style="display:none;margin-top:6px;">
          <div style="background:var(--bg-elevated);border:1px solid var(--border-default);border-radius:var(--radius-md);max-height:200px;overflow-y:auto;">
            ${activeUsers.length
              ? activeUsers.map(u => `
                <div class="dropdown-item" data-add-obs-uid="${u.id}"
                  style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 12px;">
                  <div class="avatar avatar-sm" style="background:${u.avatarColor||'#3B82F6'};flex-shrink:0;">${getInitials(u.name)}</div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:0.875rem;color:var(--text-primary);">${esc(u.name)}</div>
                    <div style="font-size:0.75rem;color:var(--text-muted);">${esc(u.department||u.role||'')}</div>
                  </div>
                </div>`).join('')
              : `<div style="padding:12px;color:var(--text-muted);font-size:0.875rem;">Nenhum usuário ativo.</div>`}
          </div>
        </div>
      </div>
      <div class="task-detail-field">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
          padding:8px 10px;background:var(--bg-surface);border-radius:var(--radius-sm);
          font-size:0.875rem;color:var(--text-primary);user-select:none;">
          <input type="checkbox" id="tm-partnership" ${task.isPartnership?'checked':''}
            style="width:16px;height:16px;cursor:pointer;accent-color:var(--brand-gold);" />
          <span style="flex:1;">🤝 Envolve parceria</span>
        </label>
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
        <!-- Banners auto-acionados pelas regras de SLA / calendário -->
        <div id="tm-sla-warn" style="display:none;margin-top:6px;padding:8px 10px;
          background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);
          border-radius:var(--radius-sm);font-size:0.75rem;color:#EF4444;">
        </div>
        <div id="tm-ooc-warn" style="display:none;margin-top:6px;padding:8px 10px;
          background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);
          border-radius:var(--radius-sm);font-size:0.75rem;color:#F59E0B;">
        </div>
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

function bindEvents(task, users, currentTags, currentAssignees, currentObservers, isEdit, absences = [], rootEl = null) {
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
    const recEnd    = document.getElementById('tm-rec-end');
    // Defaults: começa hoje; termina em 3 meses (default razoável,
    // user pode estender até 24 meses ou encurtar).
    const todayLocal = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    })();
    if (recStart && !recStart.value) recStart.value = todayLocal;
    if (recEnd && !recEnd.value) {
      const end = new Date();
      end.setMonth(end.getMonth() + 3);
      recEnd.value = `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`;
    }
    // Limita o máximo do endDate em 24 meses a partir do start
    const updateEndMax = () => {
      if (!recStart || !recEnd || !recStart.value) return;
      const startD = new Date(recStart.value + 'T12:00:00');
      const maxD = new Date(startD); maxD.setMonth(maxD.getMonth() + 24);
      recEnd.min = recStart.value;
      recEnd.max = `${maxD.getFullYear()}-${String(maxD.getMonth()+1).padStart(2,'0')}-${String(maxD.getDate()).padStart(2,'0')}`;
    };
    updateEndMax();
    recStart?.addEventListener('change', updateEndMax);
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

  // ── Picker custom de Tipo de tarefa ──
  // Botão custom (#tm-type-btn) abre popover com lista agrupada por setor +
  // busca. Ao selecionar, atualiza o <select> escondido e dispara `change`
  // pro pipeline existente (variations, dynamic fields, SLA badge) reagir.
  document.getElementById('tm-type-btn')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const select = document.getElementById('tm-type-id');
    if (!select) return;
    openTypePickerPopover(ev.currentTarget, select.value, (newId) => {
      select.value = newId;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      // Re-renderiza o próprio botão pra refletir o novo selected
      _refreshTypeButton(newId);
    });
  });

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
    enforceCalendarRules();   // re-checa data atual contra novo SLA
  });

  // ── Validação de SLA + calendário (auto-marca urgência / fora calendário) ──
  // Lógica: quando o user muda manualmente o due, verifica:
  //  1. Se existe variation com slaDays e data manual < hoje + SLA úteis →
  //     força priority = 'urgent' + banner explicativo
  //  2. Se o tipo tem scheduleSlots e a data não casa com nenhum slot ativo →
  //     força customFields.outOfCalendar = true + banner
  function enforceCalendarRules() {
    const dueEl    = document.getElementById('tm-due');
    const dueVal   = dueEl?.value;
    const slaWarn  = document.getElementById('tm-sla-warn');
    const oocWarn  = document.getElementById('tm-ooc-warn');
    if (!dueEl || !dueVal) {
      if (slaWarn) slaWarn.style.display = 'none';
      if (oocWarn) oocWarn.style.display = 'none';
      return;
    }
    const due = new Date(dueVal + 'T12:00:00');

    // 1) SLA da variação
    const varSel = document.getElementById('tm-variation');
    const varOpt = varSel?.selectedOptions?.[0];
    const days   = parseInt(varOpt?.dataset?.sla);
    if (varOpt?.value && !isNaN(days)) {
      // Calcula data mínima respeitando SLA (dias úteis a partir de hoje)
      const minDue = new Date(); minDue.setHours(0,0,0,0);
      let biz = days;
      while (biz > 0) {
        minDue.setDate(minDue.getDate() + 1);
        const dow = minDue.getDay();
        if (dow !== 0 && dow !== 6) biz--;
      }
      if (due < minDue) {
        // Decisão de UX (mai/2026): só FORÇA priority='urgent' quando:
        //   1) task nova (isEdit=false) — primeiro contato, alerta genuíno
        //   2) task existente já marcada como urgent (manter o estado)
        // Em task existente que NÃO é urgent (criada com cronograma,
        // tarefas pré-programadas no calendário editorial, recorrentes),
        // NÃO força urgent — só mostra um aviso informativo. Isso evita
        // fricção quando o user só está preenchendo uma tarefa que já
        // tinha um prazo planejado pelo criador.
        const prioElNow = document.getElementById('tm-priority');
        const isAlreadyUrgent = prioElNow?.value === 'urgent';
        const shouldForceUrgent = !isEdit || isAlreadyUrgent;

        // Override de urgência ativo? (gestor removeu manualmente com
        // justificativa). Nesse caso, NÃO força urgent — banner muda
        // pra info ("Urgência removida por X em Y · motivo").
        const override = task?.urgencyOverride;
        if (override?.active) {
          if (slaWarn) {
            // Parse defensivo do `at`: pode ser Date local (recém-aplicado pela
            // UI), Timestamp do Firestore (após snapshot — tem .toDate),
            // string ISO, número, ou sentinel não resolvido. Tenta cada caso
            // em ordem e usa now() como fallback se nada bater.
            const parseAt = (v) => {
              if (!v) return null;
              if (v instanceof Date && !isNaN(v.getTime())) return v;
              if (typeof v.toDate === 'function') {
                try { const d = v.toDate(); if (!isNaN(d.getTime())) return d; } catch {}
              }
              if (typeof v === 'object' && typeof v.seconds === 'number') {
                return new Date(v.seconds * 1000);
              }
              if (typeof v === 'string' || typeof v === 'number') {
                const d = new Date(v); if (!isNaN(d.getTime())) return d;
              }
              return null;
            };
            const overrideAt = parseAt(override.at);
            const dateStr = overrideAt ? overrideAt.toLocaleDateString('pt-BR') : '';
            slaWarn.style.display = 'block';
            slaWarn.style.background = 'rgba(59,130,246,0.08)';
            slaWarn.style.borderColor = 'rgba(59,130,246,0.3)';
            slaWarn.style.color = '#3B82F6';
            slaWarn.style.padding = '10px 12px';
            // Layout empilhado vertical (cabe na coluna estreita 235px sem
            // estourar): título → metadados → motivo (em quote) → botão full
            slaWarn.innerHTML = `
              <div style="display:flex;align-items:center;gap:6px;font-weight:600;font-size:0.8125rem;line-height:1.3;">
                <span style="font-size:0.875rem;flex-shrink:0;">ℹ</span>
                <span>Urgência removida</span>
              </div>
              ${override.byName || dateStr ? `
                <div style="margin-top:4px;font-size:0.6875rem;opacity:0.85;line-height:1.4;">
                  ${override.byName ? esc(override.byName) : ''}${override.byName && dateStr ? ' · ' : ''}${dateStr ? esc(dateStr) : ''}
                </div>
              ` : ''}
              ${override.reason ? `
                <div style="margin-top:6px;padding:6px 8px;background:rgba(59,130,246,0.06);
                  border-left:2px solid currentColor;border-radius:0 4px 4px 0;
                  font-size:0.6875rem;font-style:italic;line-height:1.45;
                  color:var(--text-secondary);word-break:break-word;">
                  "${esc(override.reason)}"
                </div>
              ` : ''}
              ${store.can('task_override_urgency') && task?.id ? `
                <button type="button" id="tm-urgency-restore-btn"
                  style="margin-top:8px;width:100%;background:transparent;
                  border:1px solid currentColor;color:inherit;padding:6px 10px;
                  border-radius:6px;font-size:0.6875rem;cursor:pointer;
                  font-weight:500;font-family:inherit;line-height:1.3;">
                  ↺ Restaurar urgência automática
                </button>
              ` : ''}
            `;
            // Bind botão restaurar
            slaWarn.querySelector('#tm-urgency-restore-btn')?.addEventListener('click', async () => {
              if (!confirm('Restaurar a urgência automática? A tarefa voltará a ser marcada como URGENTE pelo SLA breach.')) return;
              try {
                const { clearUrgencyOverride } = await import('../services/tasks.js');
                await clearUrgencyOverride(task.id);
                task.urgencyOverride = null;
                toast.success('Urgência automática restaurada.');
                enforceCalendarRules();
                const prioEl2 = document.getElementById('tm-priority');
                if (prioEl2) prioEl2.value = 'urgent';
              } catch (err) { toast.error(err.message); }
            });
          }
        } else {
          // Caminho normal: SLA breach detectado.
          // Só força priority='urgent' em (1) task nova ou (2) task que
          // JÁ ESTÁ urgent (mantém estado). Em task existente programada
          // que estava com priority=medium/high/etc, mantém o priority
          // original e mostra apenas aviso informativo (laranja, não vermelho).
          const prioEl = document.getElementById('tm-priority');
          if (shouldForceUrgent && prioEl && prioEl.value !== 'urgent') prioEl.value = 'urgent';
          if (slaWarn) {
            const fmt = d => d.toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit'});
            slaWarn.style.display = 'block';
            slaWarn.style.padding = '10px 12px';

            // Cor + texto variam conforme contexto:
            // - shouldForceUrgent (nova ou já-urgent): vermelho — alerta direto
            // - task editada não-urgent: laranja — aviso informativo
            if (shouldForceUrgent) {
              slaWarn.style.background = 'rgba(239,68,68,0.08)';
              slaWarn.style.borderColor = 'rgba(239,68,68,0.3)';
              slaWarn.style.color = '#EF4444';
            } else {
              slaWarn.style.background = 'rgba(245,158,11,0.08)';
              slaWarn.style.borderColor = 'rgba(245,158,11,0.3)';
              slaWarn.style.color = '#D97706';
            }

            // Botão aparece pra qualquer user com permissão. Se ainda não
            // salvou a task, openUrgencyOverrideModal mostra toast orientativo.
            // Em task editada não-urgent, NÃO mostra botão (não há urgência
            // forçada pra remover — priority continua o que o user definiu).
            const canOverride = store.can('task_override_urgency') && shouldForceUrgent;
            // Layout empilhado vertical: título → detalhe → botão full-width
            slaWarn.innerHTML = `
              <div style="display:flex;align-items:center;gap:6px;font-weight:600;font-size:0.8125rem;line-height:1.3;">
                <span style="font-size:0.875rem;flex-shrink:0;">⚠</span>
                <span>Prazo menor que SLA</span>
              </div>
              <div style="margin-top:4px;font-size:0.6875rem;opacity:0.9;line-height:1.45;">
                Variação exige <strong>${days} dia${days!==1?'s':''} úteis</strong>
                (mínimo ${fmt(minDue)}).${shouldForceUrgent
                  ? `<br>Prioridade marcada como <strong>URGENTE</strong> automaticamente.`
                  : `<br>Como a tarefa já estava programada, a prioridade <strong>não foi alterada</strong>.`}
              </div>
              ${canOverride ? `
                <button type="button" id="tm-urgency-remove-btn"
                  style="margin-top:8px;width:100%;background:transparent;
                  border:1px solid currentColor;color:inherit;padding:6px 10px;
                  border-radius:6px;font-size:0.6875rem;cursor:pointer;
                  font-weight:500;font-family:inherit;line-height:1.3;">
                  Remover urgência
                </button>
              ` : ''}
            `;
            // Bind botão remover urgência (abre modal de justificativa)
            slaWarn.querySelector('#tm-urgency-remove-btn')?.addEventListener('click', () => {
              openUrgencyOverrideModal(task, () => {
                // Após salvar override: re-renderiza banner pro modo "info"
                enforceCalendarRules();
                const prioEl3 = document.getElementById('tm-priority');
                if (prioEl3 && prioEl3.value === 'urgent') prioEl3.value = 'medium';
              });
            });
          }
        }
      } else if (slaWarn) {
        slaWarn.style.display = 'none';
      }
    } else if (slaWarn) {
      slaWarn.style.display = 'none';
    }

    // 2) Slots do tipo (busca dinâmica pra refletir mudança de tipo)
    const typeIdNow = document.getElementById('tm-type-id')?.value || '';
    const typeDocNow = typeIdNow
      ? (store.get('taskTypes') || []).find(t => t.id === typeIdNow)
      : null;
    const slots = typeDocNow?.scheduleSlots || [];
    const oocCb = document.getElementById('cf-outOfCalendar');
    if (slots.length > 0) {
      const dow = due.getDay();
      const dayOfMonth = due.getDate();
      const matchesSlot = slots.some(s => {
        if (s.active === false) return false;
        if (s.recurrence === 'weekly')        return s.weekDay === dow;
        if (s.recurrence === 'monthly_days')  return (s.monthDays || []).includes(dayOfMonth);
        if (s.recurrence === 'custom')        return (s.customDates || []).includes(dueVal);
        return false;
      });
      if (!matchesSlot) {
        // Marca outOfCalendar
        if (oocCb && !oocCb.checked) oocCb.checked = true;
        if (oocWarn) {
          oocWarn.style.display = 'block';
          oocWarn.innerHTML = `<strong>⚠ Fora do calendário editorial</strong> —
            esta data não corresponde a nenhum slot pré-definido do tipo
            "<strong>${esc(typeDocNow?.name||'')}</strong>". Marcada como
            <strong>fora do calendário</strong> automaticamente (não pode ser
            desmarcada).`;
        }
        // Trava o checkbox pro user não desfazer
        if (oocCb) oocCb.disabled = true;
      } else {
        if (oocCb) {
          oocCb.disabled = false;
          // Não desmarca se user já marcou manualmente, mas remove banner
        }
        if (oocWarn) oocWarn.style.display = 'none';
      }
    } else {
      if (oocCb) oocCb.disabled = false;
      if (oocWarn) oocWarn.style.display = 'none';
    }
  }
  document.getElementById('tm-due')?.addEventListener('change', enforceCalendarRules);
  document.getElementById('tm-type-id')?.addEventListener('change', () => {
    // Aguarda o renderTypeFields rodar antes de checar (cria o cf-outOfCalendar)
    setTimeout(enforceCalendarRules, 100);
  });
  // Estado inicial (caso edição de tarefa já exista com data)
  setTimeout(enforceCalendarRules, 200);

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

  // Observadores — mesma lógica dos assignees, sem checagem de ausência
  document.getElementById('observer-add-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = document.getElementById('observer-dropdown');
    if (dd) dd.style.display = dd.style.display==='none' ? 'block' : 'none';
  });
  document.getElementById('observer-dropdown')?.addEventListener('click', (e) => {
    const item = e.target.closest('[data-add-obs-uid]');
    if (!item) return;
    const uid = item.dataset.addObsUid;
    if (!currentObservers.includes(uid)) {
      currentObservers.push(uid);
      const u = users.find(x => x.id === uid);
      if (u) {
        const el = document.createElement('div');
        el.className = 'assignee-chip observer-chip';
        el.dataset.obsUid = uid;
        el.innerHTML = `<div class="avatar" style="background:${u.avatarColor||'#3B82F6'};width:20px;height:20px;font-size:0.5rem;">${getInitials(u.name)}</div>${esc(u.name.split(' ')[0])}<span style="font-size:0.7rem;opacity:0.6;">✕</span>`;
        const btn = document.getElementById('observer-add-btn');
        document.getElementById('observer-picker')?.insertBefore(el, btn);
      }
    }
    document.getElementById('observer-dropdown').style.display = 'none';
  });
  document.getElementById('observer-picker')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.assignee-chip[data-obs-uid]');
    if (chip) {
      const uid = chip.dataset.obsUid;
      const i = currentObservers.indexOf(uid);
      if (i > -1) currentObservers.splice(i, 1);
      chip.remove();
    }
  });
  document.addEventListener('click', () => { const dd=document.getElementById('observer-dropdown'); if(dd)dd.style.display='none'; });

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

/* ──────────────────────────────────────────────────────────
 * Modal de override de urgência por SLA
 *
 * Acionado pelo botão "Remover urgência" no banner de SLA breach
 * (visível só pra users com permissão `task_override_urgency`).
 * Pede justificativa obrigatória (mín. 10 chars), grava no doc da task,
 * audita (severity:warning, preservado além do TTL 90d) e notifica o
 * criador da task. Não-destrutivo (reversível via clearUrgencyOverride).
 * ────────────────────────────────────────────────────────── */
function openUrgencyOverrideModal(task, onApplied) {
  if (!task?.id) {
    toast.info('Salve a tarefa primeiro. Depois reabra ela e o botão "Remover urgência" estará disponível.');
    return;
  }
  const overlay = document.createElement('div');
  overlay.className = 'urgency-override-overlay';
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '10000',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.5)', padding: '16px',
  });
  overlay.innerHTML = `
    <div style="background:var(--bg-card);border:1px solid var(--border-default);
      border-radius:var(--radius-lg);padding:22px 24px;width:100%;max-width:480px;
      box-shadow:0 20px 50px rgba(0,0,0,0.4);font-family:var(--font-ui);">
      <h3 style="margin:0 0 8px;font-size:1rem;font-weight:600;color:var(--text-primary);">
        Remover urgência automática
      </h3>
      <p style="margin:0 0 14px;font-size:0.8125rem;color:var(--text-muted);line-height:1.5;">
        O sistema marcou esta tarefa como <strong>URGENTE</strong> porque o prazo está
        abaixo do SLA. Use esta opção apenas se a tarefa <strong>já está em andamento
        no fluxo correto</strong> e foi inserida tardiamente. <strong>A justificativa
        ficará registrada na tarefa, no log de auditoria, e o criador será notificado.</strong>
      </p>
      <label style="display:block;font-size:0.75rem;font-weight:600;color:var(--text-muted);
        text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">
        Justificativa <span style="color:#EF4444;">*</span>
      </label>
      <textarea id="urg-override-reason" rows="4" maxlength="500"
        placeholder="Ex: Tarefa já em produção há 3 semanas, foi cadastrada hoje no sistema apenas pra acompanhar conclusão."
        style="width:100%;padding:10px 12px;border:1px solid var(--border-default);
        border-radius:var(--radius-md);background:var(--bg-input);color:var(--text-primary);
        font-family:inherit;font-size:0.8125rem;resize:vertical;min-height:80px;
        box-sizing:border-box;outline:none;"></textarea>
      <div id="urg-override-err" style="display:none;font-size:0.75rem;color:#EF4444;
        margin-top:6px;"></div>
      <div style="margin-top:6px;font-size:0.6875rem;color:var(--text-muted);">
        Mínimo 10 caracteres. <span id="urg-override-counter">0</span>/500
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;">
        <button id="urg-override-cancel" type="button" class="btn btn-secondary btn-sm"
          style="font-size:0.8125rem;">Cancelar</button>
        <button id="urg-override-apply" type="button" class="btn btn-primary btn-sm"
          style="font-size:0.8125rem;background:#3B82F6;border-color:#3B82F6;">
          Confirmar e remover urgência
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const txt    = overlay.querySelector('#urg-override-reason');
  const cnt    = overlay.querySelector('#urg-override-counter');
  const errEl  = overlay.querySelector('#urg-override-err');
  const cancel = overlay.querySelector('#urg-override-cancel');
  const apply  = overlay.querySelector('#urg-override-apply');

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onEsc); };
  const onEsc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onEsc);
  cancel.addEventListener('click', close);

  txt.addEventListener('input', () => {
    cnt.textContent = String(txt.value.length);
    if (errEl) errEl.style.display = 'none';
  });
  setTimeout(() => txt.focus(), 50);

  apply.addEventListener('click', async () => {
    const reason = txt.value.trim();
    if (reason.length < 10) {
      errEl.style.display = 'block';
      errEl.textContent = 'Justificativa precisa de no mínimo 10 caracteres.';
      txt.focus();
      return;
    }
    apply.disabled = true; apply.textContent = 'Aplicando…';
    try {
      const { setUrgencyOverride } = await import('../services/tasks.js');
      const override = await setUrgencyOverride(task.id, reason);
      // Atualiza task em memória pra UI refletir sem aguardar snapshot
      task.urgencyOverride = override;
      toast.success('Urgência removida. Justificativa registrada.');
      close();
      onApplied?.(override);
    } catch (err) {
      apply.disabled = false; apply.textContent = 'Confirmar e remover urgência';
      errEl.style.display = 'block';
      errEl.textContent = err.message;
    }
  });
}

/* ──────────────────────────────────────────────────────────
 * Picker custom de Tipo de Tarefa
 *
 * Substitui o <select> nativo por um popover com cards visuais
 * agrupados por setor. Cada card mostra ícone + nome + variation count
 * com cor do tipo. Suporta busca por texto. Click seleciona e fecha.
 * Mantém o <select id="tm-type-id"> escondido como fonte de verdade
 * pro handleSave e listeners existentes.
 * ────────────────────────────────────────────────────────── */
function _refreshTypeButton(typeId) {
  const btn = document.getElementById('tm-type-btn');
  if (!btn) return;
  const types = store.get('taskTypes') || [];
  const sel = types.find(t => t.id === typeId);
  const dot = sel?.color || 'var(--border-default)';
  const inner = sel
    ? `<span style="font-size:1rem;flex-shrink:0;">${esc(sel.icon || '◈')}</span>
       <span style="flex:1;font-weight:500;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(sel.name)}</span>
       ${sel.sector ? `<span style="font-size:0.6875rem;color:var(--text-muted);font-weight:400;">${esc(sel.sector)}</span>` : ''}`
    : `<span style="flex:1;color:var(--text-muted);">— Padrão (sem tipo) —</span>`;
  btn.innerHTML = `
    <span style="width:8px;height:8px;border-radius:50%;background:${dot};flex-shrink:0;"></span>
    ${inner}
    <span style="font-size:0.625rem;color:var(--text-muted);flex-shrink:0;">▾</span>
  `;
}

function openTypePickerPopover(anchor, currentId, onSelect) {
  // Fecha popover anterior se existir
  document.querySelectorAll('.type-picker-popover').forEach(p => p.remove());

  const types = store.get('taskTypes') || [];
  // Squads do sistema (internamente chamados de "nucleos" no schema —
  // referenciados em t.nucleos[] de cada tipo). UI mostra "Squad" pra
  // alinhar com a nomenclatura do produto.
  const squads = store.get('nucleos') || [];
  const squadById = new Map(squads.map(s => [s.id, s]));

  // Agrupa: cada squad → tipos cuja `nucleos[]` inclui o squad.id.
  // Tipo em N squads aparece N vezes (uma por squad), conforme pedido.
  // Tipos sem nucleos[] vão pra "Geral" (visíveis a todos).
  const groups = new Map();
  squads.forEach(s => groups.set(s.id, { squad: s, items: [] }));
  const general = [];
  types.forEach(t => {
    const nucs = (t.nucleos || []).filter(Boolean);
    if (!nucs.length) {
      general.push(t);
      return;
    }
    nucs.forEach(squadId => {
      // Aceita id direto OU nome (legacy). Resolve.
      const sq = squadById.get(squadId) || squads.find(s => s.name === squadId);
      const key = sq?.id || squadId; // fallback caso seja id desconhecido
      if (!groups.has(key)) groups.set(key, { squad: sq || { id: key, name: squadId, color: '#6B7280' }, items: [] });
      groups.get(key).items.push(t);
    });
  });

  // Ordena squads alfabeticamente; "Geral" entra como grupo virtual no fim
  const orderedSquads = [...groups.values()]
    .filter(g => g.items.length > 0)
    .sort((a, b) => (a.squad.name || '').localeCompare(b.squad.name || '', 'pt-BR'));
  if (general.length) {
    orderedSquads.push({ squad: { id: '__general__', name: 'Geral', color: '#6B7280', icon: '◈' }, items: general });
  }

  const pop = document.createElement('div');
  pop.className = 'type-picker-popover';
  Object.assign(pop.style, {
    position:     'fixed',
    zIndex:       '10000',
    background:   'var(--bg-card)',
    border:       '1px solid var(--border-default)',
    borderRadius: 'var(--radius-md, 8px)',
    boxShadow:    '0 12px 32px rgba(0,0,0,0.45)',
    width:        '380px',
    maxWidth:     'calc(100vw - 32px)',
    maxHeight:    '420px',
    display:      'flex',
    flexDirection: 'column',
    fontFamily:   'var(--font-ui)',
    overflow:     'hidden',
  });
  pop.innerHTML = `
    <div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle);">
      <input type="text" class="type-picker-search" placeholder="Buscar tipo…"
        style="width:100%;padding:7px 10px;border:1px solid var(--border-default);
        border-radius:var(--radius-sm);background:var(--bg-surface);
        color:var(--text-primary);font-family:inherit;font-size:0.8125rem;outline:none;
        box-sizing:border-box;" />
    </div>
    <div class="type-picker-list" style="overflow-y:auto;flex:1;padding:4px 0;">
      <button type="button" class="type-picker-item" data-id=""
        style="width:100%;display:flex;align-items:center;gap:10px;
        padding:8px 14px;background:transparent;border:none;cursor:pointer;
        font-family:inherit;font-size:0.8125rem;text-align:left;
        color:${currentId === '' ? 'var(--brand-gold)' : 'var(--text-secondary)'};
        ${currentId === '' ? 'background:rgba(212,168,67,0.06);' : ''}">
        <span style="width:8px;height:8px;border-radius:50%;background:var(--border-default);flex-shrink:0;"></span>
        <span style="flex:1;font-weight:${currentId === '' ? '600' : '400'};">— Padrão (sem tipo) —</span>
        ${currentId === '' ? '<span style="color:var(--brand-gold);">✓</span>' : ''}
      </button>
      ${orderedSquads.map((g, gIdx) => {
        const sq = g.squad;
        const sqColor = sq.color || '#6366F1';
        // Cabeçalho clicável (acordeão). Default: todos expandidos. Click
        // toggle no atributo data-expanded e na visibilidade do conteúdo.
        return `
        <div class="type-picker-group" data-squad="${esc(sq.id)}" data-expanded="1">
          <button type="button" class="type-picker-group-header"
            style="width:100%;display:flex;align-items:center;gap:8px;
            padding:10px 14px 6px;background:transparent;border:none;
            border-top:1px solid var(--border-subtle);
            cursor:pointer;font-family:inherit;text-align:left;
            color:var(--text-secondary);${gIdx === 0 ? 'border-top:none;' : ''}">
            <span class="type-picker-group-chevron"
              style="font-size:0.625rem;color:var(--text-muted);transition:transform 0.15s;">▾</span>
            <span style="width:8px;height:8px;border-radius:50%;background:${sqColor};flex-shrink:0;"></span>
            <span style="font-size:0.6875rem;font-weight:600;text-transform:uppercase;
              letter-spacing:0.05em;flex:1;">
              ${esc(sq.icon || '')} ${esc(sq.name || 'Squad')}
            </span>
            <span style="font-size:0.6875rem;color:var(--text-muted);font-weight:400;text-transform:none;">
              ${g.items.length}
            </span>
          </button>
          <div class="type-picker-group-body">
            ${g.items.map(t => {
              const isSelected = t.id === currentId;
              const variationCount = (t.variations || []).length;
              const searchText = `${t.name} ${sq.name || ''}`.toLowerCase();
              return `<button type="button" class="type-picker-item"
                data-id="${esc(t.id)}"
                data-search="${esc(searchText)}"
                style="width:100%;display:flex;align-items:center;gap:10px;
                padding:8px 14px 8px 32px;background:${isSelected?'rgba(212,168,67,0.06)':'transparent'};
                border:none;cursor:pointer;font-family:inherit;font-size:0.8125rem;text-align:left;
                color:var(--text-primary);transition:background 0.1s;">
                <span style="width:28px;height:28px;border-radius:6px;
                  background:${(t.color || '#6B7280')}20;color:${t.color || '#6B7280'};
                  display:flex;align-items:center;justify-content:center;font-size:0.875rem;
                  flex-shrink:0;">${esc(t.icon || '◈')}</span>
                <span style="flex:1;min-width:0;">
                  <span style="display:block;font-weight:${isSelected?'600':'500'};
                    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                    ${esc(t.name)}
                  </span>
                  ${variationCount > 0 ? `
                    <span style="font-size:0.6875rem;color:var(--text-muted);">
                      ${variationCount} variaç${variationCount===1?'ão':'ões'}
                    </span>
                  ` : ''}
                </span>
                ${isSelected ? '<span style="color:var(--brand-gold);font-size:0.875rem;">✓</span>' : ''}
              </button>`;
            }).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>
  `;
  document.body.appendChild(pop);

  // Posicionamento: abaixo do anchor, alinhado pela esquerda. Clamp na viewport.
  const rect = anchor.getBoundingClientRect();
  let left = rect.left;
  let top  = rect.bottom + 6;
  const popRect = pop.getBoundingClientRect();
  const margin = 8;
  if (left + popRect.width > window.innerWidth - margin) {
    left = window.innerWidth - popRect.width - margin;
  }
  if (left < margin) left = margin;
  if (top + popRect.height > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - popRect.height - 6); // abre acima
  }
  pop.style.left = `${left}px`;
  pop.style.top  = `${top}px`;

  // Hover (mouseover destaca item)
  pop.querySelectorAll('.type-picker-item').forEach(item => {
    item.addEventListener('mouseenter', () => {
      if (item.dataset.id !== currentId) {
        item.style.background = 'rgba(212,168,67,0.04)';
      }
    });
    item.addEventListener('mouseleave', () => {
      if (item.dataset.id !== currentId) {
        item.style.background = 'transparent';
      }
    });
    item.addEventListener('click', () => {
      onSelect(item.dataset.id);
      cleanup();
    });
  });

  // Acordeão por squad: click no header expande/recolhe
  pop.querySelectorAll('.type-picker-group-header').forEach(header => {
    header.addEventListener('click', (e) => {
      e.stopPropagation();
      const group = header.closest('.type-picker-group');
      const expanded = group.dataset.expanded === '1';
      group.dataset.expanded = expanded ? '0' : '1';
      const body = group.querySelector('.type-picker-group-body');
      const chev = header.querySelector('.type-picker-group-chevron');
      if (body) body.style.display = expanded ? 'none' : '';
      if (chev) chev.style.transform = expanded ? 'rotate(-90deg)' : 'rotate(0deg)';
    });
  });

  // Busca: filtra items pelo texto. Quando há query, força grupos a
  // ficarem expandidos pra mostrar os matches.
  const search = pop.querySelector('.type-picker-search');
  search?.addEventListener('input', () => {
    const q = (search.value || '').toLowerCase().trim();
    pop.querySelectorAll('.type-picker-item').forEach(item => {
      if (!item.dataset.search) {
        // O item "Padrão" sempre visível
        item.style.display = '';
        return;
      }
      item.style.display = item.dataset.search.includes(q) ? '' : 'none';
    });
    // Esconde grupos vazios + força expansão dos grupos com match
    pop.querySelectorAll('.type-picker-group').forEach(g => {
      const visible = [...g.querySelectorAll('.type-picker-item')].some(i => i.style.display !== 'none');
      g.style.display = visible ? '' : 'none';
      if (q && visible) {
        // Força expansão pra busca evidenciar matches
        g.dataset.expanded = '1';
        const body = g.querySelector('.type-picker-group-body');
        const chev = g.querySelector('.type-picker-group-chevron');
        if (body) body.style.display = '';
        if (chev) chev.style.transform = 'rotate(0deg)';
      }
    });
  });
  setTimeout(() => search?.focus(), 30);

  // Cleanup: click fora, Esc, ou re-render
  function cleanup() {
    pop.remove();
    document.removeEventListener('click', outsideHandler, true);
    document.removeEventListener('keydown', escHandler);
  }
  function outsideHandler(e) {
    if (!pop.contains(e.target) && !anchor.contains(e.target)) cleanup();
  }
  function escHandler(e) {
    if (e.key === 'Escape') cleanup();
  }
  setTimeout(() => {
    document.addEventListener('click', outsideHandler, true);
    document.addEventListener('keydown', escHandler);
  }, 0);
}

async function handleSave(task, tags, assignees, observers, isEdit, close, onSave, ctx=document) {
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
    // metaLinks é a única fonte de verdade — tasks.js sincroniza goalId/goalMetaRef
    // a partir do primeiro link via syncLegacyFields().
    //
    // GUARDA: se a tarefa é legacy órfão (goalId sem goalMetaRef OU sem assignees)
    // e o picker NÃO foi tocado, NÃO enviamos metaLinks — caso contrário
    // syncLegacyFields zeraria o goalId silenciosamente. Preserva o vínculo
    // legacy até que alguém o edite de fato no picker.
    ...(task._legacyPreserve
      ? {}
      : { metaLinks: Array.isArray(task.metaLinks) ? task.metaLinks : [] }),
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
    observers,
    isPartnership: !!$('tm-partnership')?.checked,
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
      // Stale detection: passa o updatedAt que carregamos ao abrir o modal.
      // Se outro user editou no meio tempo (5 users hoje, 200 amanhã), o
      // updateTask aborta com STALE_DATA em vez de sobrescrever cegamente.
      try {
        await updateTask(task.id, data, { expectedUpdatedAt: task.updatedAt });
        toast.success('Tarefa atualizada!');
        savedTask = { id: task.id, ...data };
      } catch (saveErr) {
        if (saveErr.code === 'STALE_DATA') {
          // Outro user editou. Pergunta o que fazer em vez de assumir.
          const editorName = (() => {
            const editorUid = saveErr.staleInfo?.updatedBy;
            if (!editorUid) return 'outra pessoa';
            const u = (store.get('users')||[]).find(x => x.id === editorUid);
            return u?.name || 'outra pessoa';
          })();
          const { modal } = await import('./modal.js');
          const choice = await modal.confirm({
            title: '⚠ Conflito de edição',
            message: `<div style="font-size:0.875rem;line-height:1.5;">
              <p><strong>${editorName}</strong> atualizou esta tarefa enquanto você
              estava editando. Suas mudanças <strong>ainda não foram salvas</strong>.</p>
              <p style="margin-top:8px;color:var(--text-muted);">
                <strong>Recarregar:</strong> descarta suas mudanças e abre a versão atual.<br>
                <strong>Forçar salvar:</strong> sobrescreve as mudanças de ${editorName}.
              </p>
            </div>`,
            confirmText: 'Forçar salvar',
            cancelText:  'Recarregar',
            danger: true,
            icon: '⚠',
          });
          if (choice) {
            // Forçar: re-chama sem expectedUpdatedAt
            if(btn){btn.classList.remove('loading');btn.disabled=false;}
            await updateTask(task.id, data);
            toast.success('Tarefa salva (sobrescrita).');
            savedTask = { id: task.id, ...data };
          } else {
            // Recarregar: fecha modal, próxima abertura traz versão fresh
            toast.info('Modal fechado. Reabra a tarefa pra ver a versão atualizada.');
            if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
            const closeBtn = document.querySelector('.modal .modal-close, [data-modal-close]');
            if (closeBtn) closeBtn.click();
            return;
          }
        } else {
          throw saveErr;
        }
      }
    } else if (isRecurring) {
      // Criar template de recorrência em vez de tarefa pontual
      const { createTemplate, runDueRecurrenceGeneration } = await import('../services/recurringTasks.js');
      const freq       = $('tm-rec-frequency')?.value || 'weekly';
      const dueOffset  = parseInt($('tm-rec-due-offset')?.value || '0', 10) || 0;
      const startDate  = $('tm-rec-start')?.value || '';
      const endDate    = $('tm-rec-end')?.value || '';
      const weekdays   = Array.from(document.querySelectorAll('.tm-rec-weekday:checked'))
        .map(cb => Number(cb.dataset.day));
      const monthDay   = parseInt($('tm-rec-month-day')?.value || '1', 10) || 1;
      const intervalDays = parseInt($('tm-rec-interval')?.value || '7', 10) || 7;

      // Validações client-side (createTemplate também valida server-side)
      if (!startDate) {
        if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
        toast.error('Defina a data de início da recorrência.');
        return;
      }
      if (!endDate) {
        if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
        toast.error('Defina a data de encerramento da recorrência (obrigatório).');
        return;
      }

      // Remove campos incompatíveis do template (startDate/dueDate viram offsets)
      const templateTaskData = { ...data };
      delete templateTaskData.startDate;
      delete templateTaskData.dueDate;
      delete templateTaskData._prevStatus;

      try {
        await createTemplate({
          taskData: templateTaskData,
          frequency: freq,
          weekdays, monthDay, intervalDays,
          startDate, endDate,
          dueOffsetDays: dueOffset,
        });
      } catch (validationErr) {
        if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
        toast.error(validationErr.message || 'Erro ao criar recorrência.');
        return;
      }
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

  // Modelo novo: se task.metaLinks tem itens, evidenciamos TODOS de uma vez.
  // Modelo antigo (legado): pre-seleciona via goalId/goalMetaRef.
  const taskMetaLinks = Array.isArray(taskData.metaLinks) ? taskData.metaLinks : [];
  const hasMetaLinks  = taskMetaLinks.length > 0;

  // Find pre-selected meta if task already linked (legado)
  let preselectedValue = '';
  if (!hasMetaLinks) {
    if (hasMetaRef) {
      preselectedValue = `${taskData.goalId}:${taskData.goalMetaRef}`;
    } else if (taskData.goalId) {
      const first = metaOptions.find(m => m.goalId === taskData.goalId);
      if (first) preselectedValue = first.value;
    }
  } else {
    // Pega o primeiro link p/ derivar períodos disponíveis
    const first = taskMetaLinks[0];
    preselectedValue = `${first.goalId}:${first.metaRef}`;
  }

  // Load periods for pre-selected goal (usado tanto p/ legado quanto multi)
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
                  ${hasMetaLinks
                    ? `Esta tarefa evidencia <strong>${taskMetaLinks.length}</strong> vínculo${taskMetaLinks.length === 1 ? '' : 's'} de meta`
                    : activeMeta
                      ? `Meta: <strong>${esc2(activeMeta.metaName)}</strong> (Pilar: ${esc2(activeMeta.pilarName)})`
                      : hasMetas
                        ? 'Selecione a meta do pilar à qual esta tarefa é evidência'
                        : 'Nenhuma meta publicada no sistema'}
                </div>
              </div>
              ${(hasMetas || hasMetaLinks) ? `
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0;">
                  <input type="checkbox" id="dc-meta-check" ${(activeMeta || hasMetaLinks) ? 'checked' : ''}
                    style="width:16px;height:16px;cursor:pointer;">
                  <span style="font-size:0.8125rem;font-weight:500;">Registrar</span>
                </label>` : ''}
            </div>
            ${(hasMetas || hasMetaLinks) ? `
            <div id="dc-meta-body" style="padding:12px 16px;flex-direction:column;gap:10px;
              display:${(activeMeta || hasMetaLinks) ? 'flex' : 'none'};">
              ${hasMetaLinks ? `
                <div style="background:var(--bg-hover);border-radius:var(--radius-sm);padding:10px 12px;
                  font-size:0.75rem;color:var(--text-muted);">
                  <div style="font-weight:600;color:var(--text-secondary);margin-bottom:6px;">
                    Vínculos que serão registrados como evidência:
                  </div>
                  ${taskMetaLinks.map(l => {
                    const m = metaOptions.find(mo => mo.goalId === l.goalId && mo.value === `${l.goalId}:${l.metaRef}`);
                    if (!m) return `<div style="margin:2px 0;">• (meta ${esc2(l.goalId)})</div>`;
                    return `<div style="margin:2px 0;">
                      • <strong>${esc2(m.metaName)}</strong>
                      <span style="color:var(--text-muted);">· ${esc2(m.pilarName)}</span>
                    </div>`;
                  }).join('')}
                </div>
              ` : `
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
              `}
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
      if (regMeta) {
        if (hasMetaLinks) {
          // Modelo novo: todos os metaLinks já estão salvos. Só registramos
          // a evidência (período + link + flag), que vale para todos.
          updates.periodoRef = periodoRef || '';
          updates.linkComprovacao = link;
          updates.confirmadaEvidencia = true;
        } else if (selMeta) {
          // Legado: cria 1 link e deixa tasks.js sincronizar goalId/goalMetaRef.
          // Atribui aos assignees existentes (ou gestor se não houver).
          const assigneesArr = Array.isArray(taskData.assignees) ? taskData.assignees : [];
          const recipients = assigneesArr.length
            ? assigneesArr
            : (taskData.createdBy ? [taskData.createdBy] : []);
          updates.metaLinks = recipients.map(uid => ({
            userId: uid,
            goalId: selMeta.goalId,
            metaRef: `${selMeta.pilarIdx}:${selMeta.metaIdx}`,
          }));
          updates.periodoRef = periodoRef || '';
          updates.linkComprovacao = link;
          updates.confirmadaEvidencia = true;
        }
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
  const hasGoalId = !!taskData?.goalId || (Array.isArray(taskData?.metaLinks) && taskData.metaLinks.length > 0);

  let hasGoals = false;
  try {
    const { hasPublishedGoals } = await import('../services/goals.js');
    hasGoals = await hasPublishedGoals();
  } catch(e) { /* non-blocking */ }

  // Always show — user decides what to confirm
  await showEvidenceModal(taskId, taskData || {});
}
