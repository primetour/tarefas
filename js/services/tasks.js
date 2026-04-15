/**
 * PRIMETOUR — Tasks Service
 * CRUD completo de tarefas no Firestore
 */

import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  getDoc, getDocs, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, arrayUnion, arrayRemove,
  writeBatch, increment,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }       from '../firebase.js';
import { store }    from '../store.js';
import { auditLog } from '../auth/audit.js';

/* ─── Som de conclusão de tarefa (Web Audio API) ─────────── */
// Navegadores modernos (Chrome, Safari, Firefox) bloqueiam áudio até o
// usuário interagir com a página. Pra garantir que o "plin" toque quando
// a tarefa for concluída, fazemos duas coisas:
//  1. Primer: no primeiro clique/teclada da sessão, criamos o
//     AudioContext dentro do gesto do usuário — isso o deixa em estado
//     "running" permanentemente.
//  2. resume(): sempre chamamos antes de tocar, caso o contexto tenha
//     sido suspenso em algum momento.
let _completionCtx = null;
let _audioPrimed   = false;

function _ensureAudioCtx() {
  if (_completionCtx) return _completionCtx;
  try {
    _completionCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch { /* navegador sem Web Audio */ }
  return _completionCtx;
}

if (typeof window !== 'undefined' && !_audioPrimed) {
  const primer = () => {
    if (_audioPrimed) return;
    _audioPrimed = true;
    const ctx = _ensureAudioCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    window.removeEventListener('click',   primer, true);
    window.removeEventListener('keydown', primer, true);
    window.removeEventListener('touchstart', primer, true);
  };
  window.addEventListener('click',     primer, true);
  window.addEventListener('keydown',   primer, true);
  window.addEventListener('touchstart', primer, true);
}

function playCompletionSound() {
  try {
    const ctx = _ensureAudioCtx();
    if (!ctx) { console.warn('[Audio] AudioContext indisponível neste navegador'); return; }
    const playTones = () => {
      const now = ctx.currentTime;
      // "Plin" — ascending triad: C6 → E6 → G6
      [1047, 1319, 1568].forEach((freq, i) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + i * 0.1);
        gain.gain.linearRampToValueAtTime(0.22, now + i * 0.1 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.35);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.4);
      });
      console.log('[Audio] Som de conclusão tocado (state=' + ctx.state + ')');
    };
    if (ctx.state === 'suspended') {
      // Chrome/Safari: resume() é assíncrono — aguarda antes de tocar
      ctx.resume().then(playTones).catch(err => {
        console.warn('[Audio] resume() falhou:', err.message);
      });
    } else {
      playTones();
    }
  } catch (e) {
    console.warn('[Audio] Erro ao tocar som:', e.message);
  }
}

/* ─── Banner global de edição pelo solicitante ───────────── */
// Key = `${taskId}:${editTimestamp}` so each edit (new timestamp) triggers a fresh banner
let _editBannerShownKeys = new Set();

function showRequesterEditBanners(tasks) {
  const edited = tasks.filter(t => {
    if (!t.requesterEditFlag) return false;
    const ts = t.requesterEditAt?.toMillis ? t.requesterEditAt.toMillis() : 0;
    const key = `${t.id}:${ts}`;
    return !_editBannerShownKeys.has(key);
  });
  if (!edited.length) return;

  edited.forEach(t => {
    const ts = t.requesterEditAt?.toMillis ? t.requesterEditAt.toMillis() : 0;
    const key = `${t.id}:${ts}`;
    _editBannerShownKeys.add(key);
    const bannerId = `req-edit-banner-${t.id}-${ts}`;
    if (document.getElementById(bannerId)) return;

    const editDate = t.requesterEditAt?.toDate
      ? t.requesterEditAt.toDate().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';
    const fields = (t.requesterEditChanges || '').split(',').map(f => f.trim()).filter(Boolean).join(', ');

    const banner = document.createElement('div');
    banner.id = bannerId;
    banner.style.cssText = `
      position:fixed;top:12px;right:12px;z-index:10005;max-width:400px;
      background:#FEF3C7;border:1px solid #F59E0B;border-radius:10px;
      padding:14px 16px;box-shadow:0 8px 32px rgba(0,0,0,0.15);
      animation:slideUp 0.3s ease-out;font-family:var(--font-ui);
    `;
    banner.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <span style="font-size:1.25rem;flex-shrink:0;">📝</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.8125rem;font-weight:700;color:#92400E;">
            Solicitação alterada pelo solicitante
          </div>
          <div style="font-size:0.75rem;color:#92400E;margin-top:3px;line-height:1.5;">
            <strong>${t.title ? t.title.slice(0, 50) + (t.title.length > 50 ? '…' : '') : 'Tarefa'}</strong>
            ${fields ? '<br>Campos alterados: <strong>' + fields + '</strong>' : ''}
            ${editDate ? '<br>Alterado em: ' + editDate : ''}
          </div>
          <div style="font-size:0.6875rem;color:#B45309;margin-top:5px;">
            Confira as informações antes de prosseguir com a produção.
          </div>
        </div>
        <button style="background:none;border:none;color:#92400E;cursor:pointer;
          font-size:1rem;padding:0 4px;flex-shrink:0;line-height:1;" title="Fechar">✕</button>
      </div>
    `;
    document.body.appendChild(banner);

    // Close button
    banner.querySelector('button').addEventListener('click', () => {
      banner.style.animation = 'fadeOut 0.2s ease-out';
      setTimeout(() => banner.remove(), 200);
    });

    // Auto-dismiss after 15 seconds
    setTimeout(() => {
      if (banner.parentElement) {
        banner.style.animation = 'fadeOut 0.2s ease-out';
        setTimeout(() => banner.remove(), 200);
      }
    }, 15000);
  });

  // Stack multiple banners vertically
  setTimeout(() => {
    const banners = document.querySelectorAll('[id^="req-edit-banner-"]');
    let topOffset = 12;
    banners.forEach(b => {
      b.style.top = topOffset + 'px';
      topOffset += b.offsetHeight + 8;
    });
  }, 50);
}

/* ─── Constantes ─────────────────────────────────────────── */
export const STATUSES = [
  { value: 'not_started', label: 'Não iniciado',   color: '#38BDF8' },
  { value: 'in_progress', label: 'Em Andamento',   color: '#F59E0B' },
  { value: 'review',      label: 'Em Revisão',     color: '#A78BFA' },
  { value: 'rework',      label: 'Retrabalho',     color: '#F97316' },
  { value: 'done',        label: 'Concluída',      color: '#22C55E' },
  { value: 'cancelled',   label: 'Cancelada',      color: '#EF4444' },
];

// Sub-status para tarefas do tipo Newsletter
export const NEWSLETTER_STATUSES = [
  { value: 'pauta',           label: 'Pauta'            },
  { value: 'conteudo_tecnico',label: 'Conteúdo técnico' },
  { value: 'redacao',         label: 'Redação'          },
  { value: 'design',          label: 'Design'           },
  { value: 'revisao',         label: 'Revisão'          },
  { value: 'tarifa_dispo',    label: 'Tarifa e dispo'   },
  { value: 'agendado',        label: 'Agendado'         },
  { value: 'disparado',       label: 'Disparado'        },
  { value: 'analise_dados',   label: 'Análise de Dados' },
];

// Tipos de tarefa
export const TASK_TYPES = [
  { value: '',            label: '— Padrão —'    },
  { value: 'newsletter',  label: '📧 Newsletter' },
];

// Áreas solicitantes
export const REQUESTING_AREAS = [
  'BTG', 'C&P', 'Célula ICs', 'Centurion', 'CEP',
  'Concierge Bradesco', 'Contabilidade', 'Diretoria',
  'Eventos', 'Financeiro', 'Lazer', 'Marketing',
  'Operadora', 'Programa ICs', 'Projetos',
  'PTS Bradesco', 'Qualidade', 'Suppliers', 'TI',
];

// Núcleos de execução (multi-select)
export const NUCLEOS = [
  { value: 'design',         label: 'Design'         },
  { value: 'comunicacao',    label: 'Comunicação'    },
  { value: 'redes_sociais',  label: 'Redes Sociais'  },
  { value: 'dados',          label: 'Dados'          },
  { value: 'web',            label: 'Web'            },
  { value: 'sistemas',       label: 'Sistemas'       },
  { value: 'ia',             label: 'IA'             },
];

export const PRIORITIES = [
  { value: 'urgent', label: 'Urgente', color: '#EF4444', icon: '🔴' },
  { value: 'high',   label: 'Alta',    color: '#F97316', icon: '🟠' },
  { value: 'medium', label: 'Média',   color: '#F59E0B', icon: '🟡' },
  { value: 'low',    label: 'Baixa',   color: '#6B7280', icon: '⚪' },
];

export const STATUS_MAP    = Object.fromEntries(STATUSES.map(s => [s.value, s]));
export const PRIORITY_MAP  = Object.fromEntries(PRIORITIES.map(p => [p.value, p]));

/* ─── Criar tarefa ───────────────────────────────────────── */
export async function createTask(data) {
  if (!store.can('task_create')) throw new Error('Permissão negada.');
  // Validar regras de negócio do tipo de tarefa
  if (data.typeId) {
    const { validateTaskTypeRules, calcSla } = await import('./taskTypes.js');
    const validation = await validateTaskTypeRules(data.typeId, data).catch(() => ({ valid: true }));
    if (!validation.valid) throw new Error(validation.error || 'Regra de negócio violada.');
    // Auto-calcular dueDate via SLA se não fornecido
    if (!data.dueDate && data.startDate) {
      const sla = calcSla(data.typeId, data.startDate, data.variationId || null);
      if (sla) data.dueDate = sla.dueDate;
    }
  }

  const user = store.get('currentUser');
  const workspace = store.get('currentWorkspace');
  const taskDoc = {
    workspaceId:      data.workspaceId || workspace?.id || null,
    sector:           data.sector || store.get('userSector') || null,
    title:            data.title?.trim()        || 'Nova Tarefa',
    description:      data.description?.trim()  || '',
    status:           data.status               || 'not_started',
    priority:         data.priority             || 'medium',
    projectId:        data.projectId            || null,
    assignees:        data.assignees            || [],
    tags:             data.tags                 || [],
    startDate:        data.startDate            || null,
    dueDate:          data.dueDate              || null,
    typeId:           data.typeId             || null,
    variationId:      data.variationId        || null,
    variationName:    data.variationName      || '',
    variationSLADays: data.variationSLADays != null ? data.variationSLADays : null,
    customFields:     data.customFields        || {},
    // Legacy fields kept for backward compat and existing queries
    type:             data.type                 || '',
    newsletterStatus: data.newsletterStatus     || '',
    requestingArea:   data.requestingArea       || '',
    clientEmail:      data.clientEmail          || '',
    nucleos:          data.nucleos              || [],
    outOfCalendar:    data.outOfCalendar        || false,
    deliveryLink:     data.deliveryLink?.trim() || '',
    // Rastreabilidade para tarefas geradas por templates recorrentes
    recurringFromTemplateId: data.recurringFromTemplateId || null,
    recurringOccurrence:     data.recurringOccurrence     || null,
    subtasks:    Array.isArray(data.subtasks) ? data.subtasks : [],
    comments:    [],
    attachments: [],
    order:       data.order       ?? Date.now(),
    completedAt: null,
    // Meta / evidência
    goalId:               data.goalId               || null,
    periodoRef:           data.periodoRef            || '',
    linkComprovacao:      data.linkComprovacao       || '',
    confirmadaEvidencia:  data.confirmadaEvidencia   || false,
    // Rastreabilidade de origem (quando a task nasce de uma request ou notícia)
    sourceRequestId:      data.sourceRequestId       || null,
    sourceNewsId:         data.sourceNewsId          || null,
    // Flag de edição pelo solicitante — se a request foi editada antes da triagem,
    // a task já nasce com o banner para que produção veja a alteração
    requesterEditFlag:    data.requesterEditFlag    || false,
    requesterEditAt:      data.requesterEditAt      || null,
    requesterEditChanges: data.requesterEditChanges  || '',
    createdAt:   serverTimestamp(),
    createdBy:   user.uid,
    updatedAt:   serverTimestamp(),
    updatedBy:   user.uid,
  };

  const ref = await addDoc(collection(db, 'tasks'), taskDoc);
  await auditLog('tasks.create', 'task', ref.id, { title: taskDoc.title });

  // Notify assignees
  if (taskDoc.assignees?.length) {
    import('./notifications.js').then(({ notify }) => {
      console.log('[Notify] task.assigned → recipients:', taskDoc.assignees);
      return notify('task.assigned', {
        entityType: 'task', entityId: ref.id,
        recipientIds: taskDoc.assignees,
        title: 'Nova tarefa atribuída',
        body: `"${taskDoc.title}" foi atribuída a você`,
        route: 'tasks',
        priority: taskDoc.priority === 'urgent' ? 'high' : 'normal',
      });
    }).catch(e => console.warn('[Notify] task.assigned error:', e));
  }

  return { id: ref.id, ...taskDoc };
}

/* ─── Atualizar tarefa ───────────────────────────────────── */
export async function updateTask(taskId, data) {
  const user = store.get('currentUser');
  // Captura o snapshot prévio — usado tanto para permissão quanto para diff de assignees
  let prevSnap = null;
  try { prevSnap = await getDoc(doc(db, 'tasks', taskId)); } catch (_) {}
  const prevData = prevSnap?.exists() ? prevSnap.data() : null;

  // Permitir edição se tem permissão global OU é o criador da tarefa
  if (!store.can('task_edit_any')) {
    if (prevData && prevData.createdBy !== user.uid) {
      throw new Error('Permissão negada.');
    }
  }
  // Bloquear mudança para "done" sem permissão task_complete
  if (data.status === 'done' && data._prevStatus !== 'done' && !store.can('task_complete')) {
    throw new Error('Você não tem permissão para concluir tarefas. Peça a um coordenador para homologar.');
  }
  const updates = { ...data, updatedAt: serverTimestamp(), updatedBy: user.uid };

  // Se status mudou para rework, registrar no audit log
  if (data.status === 'rework' && data._prevStatus && data.status !== data._prevStatus) {
    await auditLog('tasks.rework', 'task', taskId, {
      prevStatus: data._prevStatus,
      taskTitle:  updates.title,
    }).catch(() => {});
  }

  // Se status mudou para done, salvar data de conclusão + som de conclusão
  if (data.status === 'done' && data.status !== data._prevStatus) {
    updates.completedAt = serverTimestamp();
    playCompletionSound();
  } else if (data.status && data.status !== 'done') {
    updates.completedAt = null;
  }
  delete updates._prevStatus;

  await updateDoc(doc(db, 'tasks', taskId), updates);
  await auditLog('tasks.update', 'task', taskId, { fields: Object.keys(data) });

  // Notify newly-added / removed assignees (diff prev vs new)
  if (Array.isArray(data.assignees) && prevData) {
    const prevAssignees = Array.isArray(prevData.assignees) ? prevData.assignees : [];
    const added   = data.assignees.filter(uid => uid && !prevAssignees.includes(uid));
    const removed = prevAssignees.filter(uid => uid && !data.assignees.includes(uid));
    if (added.length) {
      import('./notifications.js').then(({ notify }) => {
        notify('task.assigned', {
          entityType: 'task', entityId: taskId,
          recipientIds: added,
          title: 'Nova tarefa atribuída',
          body: `"${data.title || prevData.title || 'Tarefa'}" foi atribuída a você`,
          route: 'tasks',
          priority: data.priority === 'urgent' ? 'high' : 'normal',
        });
      }).catch(e => console.warn('[Notify] task.assigned (update) error:', e));
    }
    if (removed.length) {
      import('./notifications.js').then(({ notify }) => {
        notify('task.unassigned', {
          entityType: 'task', entityId: taskId,
          recipientIds: removed,
          title: 'Você foi removido de uma tarefa',
          body: `Você não é mais responsável por "${data.title || prevData.title || 'Tarefa'}"`,
          route: 'tasks',
        });
      }).catch(() => {});
    }
  }

  // Auto-send CSAT if task has clientEmail and is being completed
  if (data.status === 'done' && data.status !== data._prevStatus && data.clientEmail) {
    import('./csat.js').then(async ({ createCsatSurvey, sendCsatEmail }) => {
      try {
        const survey = await createCsatSurvey({
          taskId,
          taskTitle: data.title || 'Tarefa',
          clientEmail: data.clientEmail,
          clientName: data.clientName || '',
          projectName: data.projectName || '',
        });
        if (survey?.id) {
          await sendCsatEmail(survey.id).catch(() => {});
          console.log('[CSAT] Auto-sent for task:', taskId);
        }
      } catch (e) { console.warn('[CSAT] Auto-send failed:', e); }
    }).catch(() => {});
  }

  // Notify on status changes
  if (data.status && data.status !== data._prevStatus) {
    import('./notifications.js').then(({ notify }) => {
      if (data.status === 'done') {
        // Notify creator that task is done
        const recipients = [data.createdBy, ...(data.assignees || [])].filter(Boolean);
        notify('task.completed', {
          entityType: 'task', entityId: taskId,
          recipientIds: recipients,
          title: 'Tarefa concluída',
          body: `"${data.title || 'Tarefa'}" foi concluída`,
          route: 'tasks',
        });
      } else if (data.status === 'rework') {
        notify('task.rework', {
          entityType: 'task', entityId: taskId,
          recipientIds: data.assignees || [],
          title: 'Tarefa devolvida para retrabalho',
          body: `"${data.title || 'Tarefa'}" precisa de ajustes`,
          route: 'tasks',
          priority: 'high',
        });
      } else {
        // Generic status change → notify creator
        if (data.createdBy) {
          notify('task.status_changed', {
            entityType: 'task', entityId: taskId,
            recipientIds: [data.createdBy],
            title: 'Status alterado',
            body: `"${data.title || 'Tarefa'}" mudou para ${data.status}`,
            route: 'tasks',
          });
        }
      }
    }).catch(() => {});
  }
}

/* ─── Completar tarefa (toggle) ──────────────────────────── */
export async function toggleTaskComplete(taskId, isDone) {
  if (isDone && !store.can('task_complete')) {
    throw new Error('Você não tem permissão para concluir tarefas. Peça a um coordenador para homologar.');
  }
  const user = store.get('currentUser');
  await updateDoc(doc(db, 'tasks', taskId), {
    status:      isDone ? 'done' : 'not_started',
    completedAt: isDone ? serverTimestamp() : null,
    updatedAt:   serverTimestamp(),
    updatedBy:   user.uid,
  });
  await auditLog('tasks.complete', 'task', taskId, { done: isDone });
  if (isDone) playCompletionSound();
}

/* ─── Excluir tarefa ─────────────────────────────────────── */
export async function deleteTask(taskId) {
  if (!store.can('task_delete')) throw new Error('Permissão negada.');

  // Se a task veio de uma notícia, limpa o registro de conversão
  // pra não inflar KPIs de "utilização de notícias" (proteção contra erro
  // ou burla: criar→deletar em loop pra aumentar números).
  let sourceNewsId = null;
  try {
    const snap = await getDoc(doc(db, 'tasks', taskId));
    sourceNewsId = snap.exists() ? (snap.data().sourceNewsId || null) : null;
  } catch (_) { /* segue sem bloquear delete */ }

  await deleteDoc(doc(db, 'tasks', taskId));
  await auditLog('tasks.delete', 'task', taskId, { sourceNewsId });

  if (sourceNewsId) {
    try {
      const { removeNewsConversion } = await import('./newsMonitor.js');
      await removeNewsConversion(sourceNewsId, taskId);
    } catch (e) {
      console.warn('[Tasks] cleanup de conversão de notícia falhou:', e.message);
    }
  }
}

/* ─── Buscar tarefa ──────────────────────────────────────── */
export async function getTask(taskId) {
  const snap = await getDoc(doc(db, 'tasks', taskId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/* ─── Listar tarefas (filtros) ───────────────────────────── */
export async function fetchTasks({
  projectId    = null,
  assigneeId   = null,
  status       = null,
  priority     = null,
  workspaceIds = null,   // null = usa activeWorkspaces do store
  limitN       = 200,
} = {}) {
  // Otimização: filtrar por workspace no Firestore quando possível
  const constraints = [orderBy('order', 'asc'), limit(limitN)];
  const activeIds = workspaceIds ?? store.getActiveWorkspaceIds();
  if (activeIds && activeIds.length === 1) {
    constraints.unshift(where('workspaceId', '==', activeIds[0]));
  }
  const q = query(collection(db, 'tasks'), ...constraints);
  const snap = await getDocs(q);
  let tasks  = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Tarefas atribuídas ao usuário sempre são visíveis, independente de workspace/setor
  const currentUid = store.get('currentUser')?.uid;
  const isAssignee = (t) => currentUid && (t.assignees || []).includes(currentUid);

  // Filtro por workspace (squad) — documentos sem workspaceId são visíveis para todos
  const activeIdsSet = new Set(workspaceIds ?? store.getActiveWorkspaceIds() ?? []);
  const hasWsFilter  = activeIdsSet.size > 0 || workspaceIds != null;
  // Ser membro de um squad ativo cancela o filtro de setor para aquela task,
  // permitindo que squads multissetor funcionem: membros veem tudo do squad
  // mesmo se o setor da task não bate com o setor do usuário.
  const isInActiveSquad = (t) => !!t.workspaceId && activeIdsSet.has(t.workspaceId);

  if (hasWsFilter) {
    tasks = tasks.filter(t => isAssignee(t) || !t.workspaceId || activeIdsSet.has(t.workspaceId));
  }

  // Filtro por setor via getVisibleSectors()
  // null = master (sem filtro), [] = sem setor definido, [...] = setores visíveis
  const visibleSectors = store.getVisibleSectors();
  if (visibleSectors !== null) {
    if (visibleSectors.length === 0) {
      // Usuário sem setor definido — não filtra (mostra tudo para não quebrar a UX)
    } else {
      tasks = tasks.filter(t =>
        isAssignee(t)
        || isInActiveSquad(t)        // squad membership overrides sector filter
        || !t.sector
        || visibleSectors.includes(t.sector)
      );
    }
  }

  if (projectId)  tasks = tasks.filter(t => t.projectId === projectId);
  if (assigneeId) tasks = tasks.filter(t => (t.assignees||[]).includes(assigneeId));
  if (status)     tasks = tasks.filter(t => t.status === status);
  if (priority)   tasks = tasks.filter(t => t.priority === priority);

  return tasks;
}

/* ─── Fetch arquivadas ───────────────────────────────────────
 * Lê da coleção `tasks_archive` (populada por scripts/archive-tasks.js).
 * Use em páginas que precisam de histórico anual — ex: metas anuais,
 * dashboards de desempenho passado. Aplica os mesmos filtros de setor
 * e squad que fetchTasks() para respeitar permissões.
 * Retorna array vazio se a coleção não existir (coleção só surge na
 * primeira execução do archive-tasks). */
export async function fetchArchivedTasks({ limitN = 2000 } = {}) {
  try {
    const q = query(collection(db, 'tasks_archive'), limit(limitN));
    const snap = await getDocs(q);
    let tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const currentUid = store.get('currentUser')?.uid;
    const isAssignee = (t) => currentUid && (t.assignees || []).includes(currentUid);
    const activeIdsArr = store.getActiveWorkspaceIds();
    const activeIdsSet = new Set(activeIdsArr ?? []);
    const isInActiveSquad = (t) => !!t.workspaceId && activeIdsSet.has(t.workspaceId);

    if (activeIdsArr) {
      tasks = tasks.filter(t => isAssignee(t) || !t.workspaceId || activeIdsSet.has(t.workspaceId));
    }
    const visibleSectors = store.getVisibleSectors();
    if (visibleSectors !== null && visibleSectors.length > 0) {
      tasks = tasks.filter(t =>
        isAssignee(t) || isInActiveSquad(t) || !t.sector || visibleSectors.includes(t.sector)
      );
    }
    return tasks;
  } catch (e) {
    return [];
  }
}

/* ─── Real-time listener ─────────────────────────────────── */
export function subscribeToTasks(callback, filters = {}) {
  // Otimização: filtrar por workspace no Firestore quando possível
  const constraints = [orderBy('order', 'asc'), limit(200)];
  const activeIds = store.getActiveWorkspaceIds();
  if (activeIds && activeIds.length === 1) {
    constraints.unshift(where('workspaceId', '==', activeIds[0]));
  }
  const q = query(collection(db, 'tasks'), ...constraints);

  let debounceTimer = null;
  return onSnapshot(q, (snap) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      let tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Tarefas atribuídas ao usuário sempre são visíveis
      const currentUid = store.get('currentUser')?.uid;
      const isAssignee = (t) => currentUid && (t.assignees || []).includes(currentUid);

      // Filtro por workspace (squad)
      const activeIdsArr = store.getActiveWorkspaceIds();
      const activeIdsSet = new Set(activeIdsArr ?? []);
      const isInActiveSquad = (t) => !!t.workspaceId && activeIdsSet.has(t.workspaceId);

      if (activeIdsArr) {
        tasks = tasks.filter(t => isAssignee(t) || !t.workspaceId || activeIdsSet.has(t.workspaceId));
      }

      // Filtro por setor — squad membership sobrescreve (multissetor funcional)
      const visibleSectors = store.get('visibleSectors') || [];
      if (!store.isMaster() && visibleSectors.length > 0) {
        tasks = tasks.filter(t =>
          isAssignee(t)
          || isInActiveSquad(t)
          || !t.sector
          || visibleSectors.includes(t.sector)
        );
      }

      if (filters.projectId) tasks = tasks.filter(t => t.projectId === filters.projectId);

      // Check for tasks with requester edit flags → show global banner
      showRequesterEditBanners(tasks);

      callback(tasks);
    }, 300);
  }, (error) => {
    // Handle permission errors gracefully — fallback to empty array
    console.warn('subscribeToTasks error:', error.code, error.message);
    if (error.code === 'permission-denied') {
      // Try a one-time fetch instead
      fetchTasks(filters).then(callback).catch(() => callback([]));
    }
  });
}

/* ─── Mover task no kanban (atualiza order + status) ────── */
export async function moveTaskKanban(taskId, newStatus, newOrder) {
  if (newStatus === 'done' && !store.can('task_complete')) {
    throw new Error('Você não tem permissão para concluir tarefas. Peça a um coordenador para homologar.');
  }
  const user = store.get('currentUser');
  const updates = {
    status:    newStatus,
    order:     newOrder,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  };
  if (newStatus === 'done') {
    updates.completedAt = serverTimestamp();
    playCompletionSound();
  } else {
    updates.completedAt = null;
  }

  await updateDoc(doc(db, 'tasks', taskId), updates);
}

/* ─── Adicionar subtarefa ────────────────────────────────── */
export async function addSubtask(taskId, title) {
  const user = store.get('currentUser');
  const subtask = {
    id:        `sub_${Date.now()}`,
    title:     title.trim(),
    done:      false,
    assignees: [],
    createdAt: new Date().toISOString(),
    createdBy: user.uid,
  };
  await updateDoc(doc(db, 'tasks', taskId), {
    subtasks:  arrayUnion(subtask),
    updatedAt: serverTimestamp(),
  });
  return subtask;
}

/* ─── Toggle subtarefa ───────────────────────────────────── */
export async function toggleSubtask(taskId, subtaskId, currentSubtasks) {
  const updated = currentSubtasks.map(s =>
    s.id === subtaskId ? { ...s, done: !s.done } : s
  );
  await updateDoc(doc(db, 'tasks', taskId), {
    subtasks:  updated,
    updatedAt: serverTimestamp(),
  });
  return updated;
}

/* ─── Atualizar data de vencimento da subtarefa ──────────── */
export async function updateSubtaskDue(taskId, subtaskId, dueDate, currentSubtasks) {
  // dueDate: string 'YYYY-MM-DD' ou null para remover
  const updated = (currentSubtasks || []).map(s =>
    s.id === subtaskId ? { ...s, dueDate: dueDate || null } : s
  );
  await updateDoc(doc(db, 'tasks', taskId), {
    subtasks:  updated,
    updatedAt: serverTimestamp(),
  });
  return updated;
}

/* ─── Atualizar título da subtarefa ──────────────────────── */
export async function updateSubtaskTitle(taskId, subtaskId, title, currentSubtasks) {
  const trimmed = String(title || '').trim();
  if (!trimmed) throw new Error('Título não pode ficar vazio.');
  const updated = (currentSubtasks || []).map(s =>
    s.id === subtaskId ? { ...s, title: trimmed } : s
  );
  await updateDoc(doc(db, 'tasks', taskId), {
    subtasks:  updated,
    updatedAt: serverTimestamp(),
  });
  return updated;
}

/* ─── Atualizar responsáveis da subtarefa ────────────────── */
export async function updateSubtaskAssignees(taskId, subtaskId, assignees, currentSubtasks) {
  const clean = Array.isArray(assignees) ? [...new Set(assignees.filter(Boolean))] : [];
  const prev  = (currentSubtasks || []).find(s => s.id === subtaskId);
  const prevAssignees = Array.isArray(prev?.assignees) ? prev.assignees : [];
  const updated = (currentSubtasks || []).map(s =>
    s.id === subtaskId ? { ...s, assignees: clean } : s
  );
  await updateDoc(doc(db, 'tasks', taskId), {
    subtasks:  updated,
    updatedAt: serverTimestamp(),
  });

  // Notificar adicionados e removidos (diff)
  const added   = clean.filter(uid => !prevAssignees.includes(uid));
  const removed = prevAssignees.filter(uid => uid && !clean.includes(uid));
  if (added.length || removed.length) {
    try {
      const taskSnap = await getDoc(doc(db, 'tasks', taskId));
      const taskData = taskSnap.exists() ? taskSnap.data() : {};
      const taskTitle = taskData.title || 'Tarefa';
      const subTitle  = prev?.title || updated.find(s => s.id === subtaskId)?.title || 'Subtarefa';
      const mod = await import('./notifications.js');
      const notify = mod.notify;
      if (added.length) {
        notify('subtask.assigned', {
          entityType: 'task', entityId: taskId,
          recipientIds: added,
          title: 'Subtarefa atribuída',
          body: `"${subTitle}" (em "${taskTitle}") foi atribuída a você`,
          route: 'tasks',
        });
      }
      if (removed.length) {
        notify('subtask.unassigned', {
          entityType: 'task', entityId: taskId,
          recipientIds: removed,
          title: 'Você foi removido de uma subtarefa',
          body: `Você não é mais responsável por "${subTitle}" (em "${taskTitle}")`,
          route: 'tasks',
        });
      }
    } catch (_) { /* silent */ }
  }

  return updated;
}

/* ─── Remover subtarefa ──────────────────────────────────── */
export async function deleteSubtask(taskId, subtaskId, currentSubtasks) {
  const updated = (currentSubtasks || []).filter(s => s.id !== subtaskId);
  await updateDoc(doc(db, 'tasks', taskId), {
    subtasks:  updated,
    updatedAt: serverTimestamp(),
  });
  return updated;
}

/* ─── Reordenar subtarefas (drag and drop) ───────────────── */
export async function reorderSubtasks(taskId, orderedSubtasks) {
  // orderedSubtasks: array já na ordem desejada
  await updateDoc(doc(db, 'tasks', taskId), {
    subtasks:  orderedSubtasks,
    updatedAt: serverTimestamp(),
  });
  return orderedSubtasks;
}

/* ─── Adicionar comentário ───────────────────────────────── */
export async function addComment(taskId, text) {
  const user    = store.get('currentUser');
  const profile = store.get('userProfile');
  const comment = {
    id:          `cmt_${Date.now()}`,
    text:        text.trim(),
    authorId:    user.uid,
    authorName:  profile?.name  || user.email,
    authorColor: profile?.avatarColor || '#3B82F6',
    createdAt:   new Date().toISOString(),
  };
  await updateDoc(doc(db, 'tasks', taskId), {
    comments:  arrayUnion(comment),
    updatedAt: serverTimestamp(),
  });

  // Notify task participants about the comment + mentions
  import('./notifications.js').then(async ({ notify }) => {
    const taskSnap = await getDoc(doc(db, 'tasks', taskId));
    if (!taskSnap.exists()) return;
    const task = taskSnap.data();
    const recipients = [...new Set([
      task.createdBy,
      ...(task.assignees || []),
    ])].filter(Boolean);
    notify('task.commented', {
      entityType: 'task', entityId: taskId,
      recipientIds: recipients,
      title: 'Novo comentário',
      body: `${profile?.name || 'Alguém'} comentou em "${task.title || 'tarefa'}": ${text.slice(0, 80)}`,
      route: 'tasks',
    });
    // Parse @mentions → notify mentioned users (prioridade alta)
    const mentioned = parseMentions(text, store.get('users') || [], user.uid);
    if (mentioned.length) {
      notify('system.mention', {
        entityType: 'task', entityId: taskId,
        recipientIds: mentioned,
        title: 'Você foi mencionado',
        body: `${profile?.name || 'Alguém'} mencionou você em "${task.title || 'tarefa'}": ${text.slice(0, 80)}`,
        route: 'tasks',
        priority: 'high',
      });
    }
  }).catch(() => {});

  return comment;
}

/* ─── Parser de @mentions em texto ───────────────────────── */
function parseMentions(text, users, currentUid) {
  if (!text || !Array.isArray(users) || !users.length) return [];
  const lower = String(text).toLowerCase();
  // Só processa se houver pelo menos um '@'
  if (!lower.includes('@')) return [];
  const mentioned = new Set();
  for (const u of users) {
    if (!u || !u.id || u.id === currentUid) continue;
    const name = String(u.name || '').trim();
    if (!name) continue;
    const first = name.split(/\s+/)[0];
    const candidates = [
      '@' + name.toLowerCase(),
      '@' + first.toLowerCase(),
    ];
    for (const c of candidates) {
      if (c.length > 1 && lower.includes(c)) {
        mentioned.add(u.id);
        break;
      }
    }
  }
  return [...mentioned];
}
