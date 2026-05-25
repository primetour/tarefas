/**
 * PRIMETOUR — Tasks Service
 * CRUD completo de tarefas no Firestore
 */

import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  getDoc, getDocs, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, arrayUnion, arrayRemove,
  writeBatch, increment,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }       from '../firebase.js';
import { store }    from '../store.js';
import { auditLog } from '../auth/audit.js';
import { syncLegacyFields, migrateLegacyToMetaLinks } from './metaLinks.js';

/* ─── Som de conclusão (4.34+) ──────────────────────────
 * AudioContext + primer movidos pra js/services/sounds.js.
 * Som agora é configurável por usuário via prefs.completionSoundId. */

/**
 * Toca o som de conclusão escolhido pelo usuário (4.34+).
 * Delega ao service `sounds.js`. Se prefs.completionSoundId não existe ou
 * é inválido, cai no default 'plin' (compat).
 */
function playCompletionSound() {
  try {
    const profile = store.get('userProfile') || {};
    const soundId = profile.prefs?.completionSoundId;  // pode ser undefined → default
    // Lazy import pra não inflar boot — sounds.js é leve mas só carrega quando precisa
    import('./sounds.js')
      .then(m => m.playSound(soundId || m.DEFAULT_SOUND_ID))
      .catch(e => console.warn('[Audio] sounds.js falhou:', e.message));
  } catch (e) {
    console.warn('[Audio] Erro ao tocar som:', e.message);
  }
}

/* ─── Banner global de edição pelo solicitante ─────────────
 * v4.49.61+ Banner com botão "Estou ciente" que PERSISTE o ack no
 * doc da task (campo `requesterEditAckBy[uid]: ts`). Banner só
 * aparece pra users SEM ack pra aquele edit. Resolve 2 dores:
 *   1. Banner não some até user confirmar (antes auto-dismiss 15s →
 *      user ocupado perdia)
 *   2. Banner reaparecia em F5 (Set in-memory) → agora persistido
 *      no Firestore, cross-session e cross-device
 *
 * Estado in-memory continua como CACHE local de banners já mostrados
 * na sessão (evita re-render flicker quando snapshot reaplica).
 */
let _editBannerShownKeys = new Set();
// v4.57.22 fix #11: cap em 500 + eviction LRU pra evitar leak indefinido.
// Antes: Set crescia infinitamente — task que recebe edit + reload → +1 key/sempre.
const _EDIT_BANNER_KEYS_MAX = 500;
function _trimEditBannerKeys() {
  if (_editBannerShownKeys.size <= _EDIT_BANNER_KEYS_MAX) return;
  // Remove os mais antigos (insertion order do Set)
  const excess = _editBannerShownKeys.size - _EDIT_BANNER_KEYS_MAX;
  const it = _editBannerShownKeys.values();
  for (let i = 0; i < excess; i++) _editBannerShownKeys.delete(it.next().value);
}

function _isAckedByMe(task) {
  const me = store.get('currentUser')?.uid;
  if (!me) return true; // sem user logado, não mostra
  const ackBy = task.requesterEditAckBy;
  if (!ackBy || typeof ackBy !== 'object') return false;
  const myAck = ackBy[me];
  if (!myAck) return false;
  // Ack é válido se TS do ack >= TS do edit (cobre múltiplas edições)
  const editTs = task.requesterEditAt?.toMillis ? task.requesterEditAt.toMillis() : 0;
  const ackTs  = myAck?.toMillis ? myAck.toMillis() : (typeof myAck === 'number' ? myAck : 0);
  return ackTs >= editTs;
}

async function _ackRequesterEdit(taskId, bannerEl) {
  const me = store.get('currentUser')?.uid;
  if (!me) return;
  // Disable botões durante o save
  bannerEl.querySelectorAll('button').forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });
  const ackBtn = bannerEl.querySelector('[data-ack="1"]');
  if (ackBtn) ackBtn.textContent = 'Salvando…';

  try {
    const { withRetry } = await import('./retry.js');
    await withRetry(
      () => updateDoc(doc(db, 'tasks', taskId), {
        [`requesterEditAckBy.${me}`]: serverTimestamp(),
      }),
      { label: 'task.requesterEdit.ack', maxAttempts: 3 },
    );
    // Sucesso — fade out
    bannerEl.style.animation = 'fadeOut 0.2s ease-out';
    setTimeout(() => bannerEl.remove(), 200);
  } catch (e) {
    console.error('[ack] falha após retry:', e);
    if (ackBtn) ackBtn.textContent = 'Estou ciente';
    bannerEl.querySelectorAll('button').forEach(b => { b.disabled = false; b.style.opacity = ''; });
    // Toast com erro vai pelo connection (já sinalizado dentro do withRetry)
    const { toast } = await import('../components/toast.js');
    toast.error('Falha ao confirmar ciência — tente novamente.');
  }
}

function showRequesterEditBanners(tasks) {
  const edited = tasks.filter(t => {
    if (!t.requesterEditFlag) return false;
    // v4.49.61+ Skip se eu já dei ack pra este edit
    if (_isAckedByMe(t)) return false;
    const ts = t.requesterEditAt?.toMillis ? t.requesterEditAt.toMillis() : 0;
    const key = `${t.id}:${ts}`;
    return !_editBannerShownKeys.has(key);
  });
  if (!edited.length) return;

  edited.forEach(t => {
    const ts = t.requesterEditAt?.toMillis ? t.requesterEditAt.toMillis() : 0;
    const key = `${t.id}:${ts}`;
    _editBannerShownKeys.add(key);
    _trimEditBannerKeys();   // v4.57.22: previne leak (cap em 500)
    const bannerId = `req-edit-banner-${t.id}-${ts}`;
    if (document.getElementById(bannerId)) return;

    const editDate = t.requesterEditAt?.toDate
      ? t.requesterEditAt.toDate().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';
    const fields = (t.requesterEditChanges || '').split(',').map(f => f.trim()).filter(Boolean).join(', ');

    const banner = document.createElement('div');
    banner.id = bannerId;
    banner.style.cssText = `
      position:fixed;top:12px;right:12px;z-index:10005;max-width:420px;
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
          <div style="display:flex;gap:6px;margin-top:10px;align-items:center;">
            <button data-ack="1" style="background:#92400E;color:#FEF3C7;border:none;
              padding:6px 12px;border-radius:6px;font-size:0.75rem;font-weight:600;cursor:pointer;
              transition:opacity 0.15s;">
              Estou ciente
            </button>
            <button data-snooze="1" style="background:transparent;color:#92400E;border:1px solid #92400E;
              padding:6px 10px;border-radius:6px;font-size:0.75rem;cursor:pointer;"
              title="Fecha agora mas reaparece no próximo carregamento">
              Depois
            </button>
          </div>
        </div>
        <button data-close="1" style="background:none;border:none;color:#92400E;cursor:pointer;
          font-size:1rem;padding:0 4px;flex-shrink:0;line-height:1;align-self:flex-start;"
          title="Fechar (volta no próximo refresh)">✕</button>
      </div>
    `;
    document.body.appendChild(banner);

    // Ack persistente (salva no Firestore)
    banner.querySelector('[data-ack="1"]').addEventListener('click', () => _ackRequesterEdit(t.id, banner));
    // Snooze + close = só fecha visualmente nessa sessão (cache in-memory já marcou)
    banner.querySelectorAll('[data-snooze="1"], [data-close="1"]').forEach(b => {
      b.addEventListener('click', () => {
        banner.style.animation = 'fadeOut 0.2s ease-out';
        setTimeout(() => banner.remove(), 200);
      });
    });

    // v4.49.61+ SEM auto-dismiss — banner persiste até ack ou snooze manual.
    // Antes desaparecia em 15s, user ocupado perdia o aviso.
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
// v4.52.0+ Status "approval" (Em aprovação) adicionado entre review e done.
// v4.53.0+ Status "validation" (Aguardando validação) — fila pré-done pra
// double-check de coordenador. Quando analista assignee clica "concluir":
// se NÃO tem perm `task_complete` → vai pra `validation` (SLA congela aqui,
// não vira atraso). Manager valida CSAT + metas e finaliza como `done`.
// Renê: "analista 'conclui' tarefa, mas quem finaliza é coordenador. tudo
// que é concluido vai pra um lugar de double check + encaminhamento."
export const STATUSES = [
  { value: 'not_started', label: 'Não iniciado',         color: '#38BDF8' },
  { value: 'in_progress', label: 'Em Andamento',         color: '#F59E0B' },
  { value: 'review',      label: 'Em Revisão',           color: '#A78BFA' },
  { value: 'approval',    label: 'Em Aprovação',         color: '#0EA5E9' },
  { value: 'validation',  label: 'Aguardando validação', color: '#EAB308' },
  { value: 'rework',      label: 'Retrabalho',           color: '#F97316' },
  { value: 'done',        label: 'Concluída',            color: '#22C55E' },
  { value: 'cancelled',   label: 'Cancelada',            color: '#EF4444' },
];

/**
 * Status VIRTUAL "atrasada" — não é persistido no Firestore, é derivado.
 * Tarefa está atrasada quando: tem dueDate, dueDate < hoje (00:00),
 * e o status não é finalizado (done/cancelled).
 *
 * Por que virtual e não um campo real:
 *   - Estado temporal — muda sozinho ao passar da meia-noite, sem rewrite
 *   - Idempotente — não precisa cron pra "marcar atrasadas"
 *   - Não conflita com workflow (tarefa atrasada ainda está in_progress, review, etc.)
 *
 * Onde aparece como coluna/filtro:
 *   - Kanban groupBy='status': vira coluna virtual no início
 *   - Toolbar filter-status: opção "⚠ Atrasada"
 *   - filterBar (Calendar/Kanban/Timeline): mesma opção
 *
 * Detalhes em RULES-AND-AUTOMATIONS.md § 10.1.
 */
export const STATUS_OVERDUE = {
  value: 'overdue', label: '⚠ Atrasada', color: '#EF4444', virtual: true,
};

export function isTaskOverdue(t) {
  if (!t || !t.dueDate) return false;
  if (t.status === 'done' || t.status === 'cancelled') return false;
  // v4.53.0+ Renê: "ao 'concluir' [pra validation], precisa fechar o SLA,
  // pra nao cair no erro do coordenador demorar para finalizar e a tarefa
  // ficar 'em atraso'". `validation` é checkpoint do analista — SLA pausa.
  if (t.status === 'validation') return false;
  const due = t.dueDate?.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
  if (isNaN(due)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

/**
 * Tarefa concluída APÓS o prazo (status='done' && completedAt > dueDate).
 * Diferente de isTaskOverdue() — aquela é pra tarefas ainda ABERTAS depois
 * do prazo. Esta é pra tarefas JÁ FECHADAS mas que demoraram além do prazo.
 *
 * @returns {{late: boolean, daysLate: number}} — daysLate=0 se on-time
 */
export function wasTaskCompletedLate(t) {
  if (!t || t.status !== 'done' || !t.dueDate || !t.completedAt) {
    return { late: false, daysLate: 0 };
  }
  const due = t.dueDate?.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
  const done = t.completedAt?.toDate ? t.completedAt.toDate() : new Date(t.completedAt);
  if (isNaN(due) || isNaN(done)) return { late: false, daysLate: 0 };

  // Normaliza ambas para 00:00 do dia pra contar dias inteiros
  const dDue  = new Date(due);  dDue.setHours(0, 0, 0, 0);
  const dDone = new Date(done); dDone.setHours(0, 0, 0, 0);

  if (dDone <= dDue) return { late: false, daysLate: 0 };
  const daysLate = Math.floor((dDone - dDue) / 86400000);
  return { late: true, daysLate };
}

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
// @deprecated v4.57.27 — usar `getActiveSectors()` de `services/sectors.js`.
// Esta lista hardcoded permanece SÓ como fallback técnico pra tasks legadas com
// `requestingArea` = string que pode não existir mais no módulo Setores
// (back-compat de migração). Toda UI nova lê via getActiveSectors() pra evitar
// drift entre código e collection Firestore `sectors`. §7 do CLAUDE.md.
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
  // 4.49.10+ SECURITY: bloqueia criar tarefa JÁ "done" sem ter task_complete.
  // Bypass anterior: chamar createTask({ status:'done', ...}) direto criava
  // a task como concluída sem passar pelas guards de status-transition.
  if (data?.status === 'done' && !store.can('task_complete')) {
    throw new Error('Você não tem permissão para criar tarefas já concluídas. Crie como "Não iniciado" e peça homologação.');
  }
  // Sandbox: simula sucesso sem persistir no Firestore
  const { sandboxGuard } = await import('./sandbox.js');
  if (sandboxGuard('criar tarefa')) {
    return { id: '__sandbox_' + Date.now(), ...data };
  }
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
  // workspaceId: respeita valor EXPLÍCITO (incluindo null para "sem squad").
  // Antes, `data.workspaceId || workspace?.id` fazia null cair no fallback —
  // o que jogava todas as tarefas importadas no squad ativo do gestor (B11b).
  const wsId = ('workspaceId' in data) ? (data.workspaceId || null) : (workspace?.id || null);
  const taskDoc = {
    workspaceId:      wsId,
    sector:           data.sector || store.get('userSector') || null,
    title:            data.title?.trim()        || 'Nova Tarefa',
    description:      data.description?.trim()  || '',
    status:           data.status               || 'not_started',
    priority:         data.priority             || 'medium',
    projectId:        data.projectId            || null,
    assignees:        data.assignees            || [],
    observers:        Array.isArray(data.observers) ? data.observers : [],
    isPartnership:    !!data.isPartnership,
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
    // Respeita completedAt explícito (ex.: import do Planner com tarefas já concluídas).
    // Se status=done sem data, usa serverTimestamp; se status≠done, sempre null.
    completedAt: data.status === 'done'
      ? (data.completedAt || serverTimestamp())
      : null,
    // Meta / evidência — modelo novo: metaLinks[] (vários por task, vários por user)
    // Mantemos goalId/goalMetaRef sincronizados com o PRIMEIRO link (back-compat).
    metaLinks:            [],
    goalId:               data.goalId               || null,
    goalMetaRef:          data.goalMetaRef          || null,
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

  // Normaliza metaLinks: aceita formato novo (data.metaLinks) ou migra
  // automaticamente de goalId/goalMetaRef + assignees (formato legado).
  // syncLegacyFields garante que goalId/goalMetaRef refletem o 1º link.
  {
    const incoming = Array.isArray(data.metaLinks) && data.metaLinks.length
      ? data.metaLinks
      : migrateLegacyToMetaLinks({
          goalId:      data.goalId,
          goalMetaRef: data.goalMetaRef,
          assignees:   taskDoc.assignees,
        });
    const normalized = syncLegacyFields({ metaLinks: incoming });
    taskDoc.metaLinks   = normalized.metaLinks;
    taskDoc.goalId      = normalized.goalId;
    taskDoc.goalMetaRef = normalized.goalMetaRef;
  }

  // Suporte a ID determinístico (usado por recurring tasks pra garantir
  // idempotência hard: 2 sessions concorrentes acabam num único doc, com
  // setDoc sobrescrevendo ao invés de duplicar — conteúdo é idêntico
  // porque vem do mesmo template). Se _deterministicId não for passado,
  // mantém comportamento original (addDoc com id auto-gerado).
  let ref;
  if (data._deterministicId) {
    const detId = String(data._deterministicId);
    const detRef = doc(db, 'tasks', detId);
    // Idempotência: se já existe, retorna sem sobrescrever (preserva edits
    // posteriores do user — ex: subtarefas adicionadas, status mudado).
    const existing = await getDoc(detRef).catch(() => null);
    if (existing?.exists?.()) {
      return { id: existing.id, ...existing.data() };
    }
    await setDoc(detRef, taskDoc);
    ref = { id: detId };
  } else {
    ref = await addDoc(collection(db, 'tasks'), taskDoc);
  }
  invalidateTasksCache();
  await auditLog('tasks.create', 'task', ref.id, { title: taskDoc.title });

  // 4.39.0+ Bulk create suprime notifications individuais (1 toast resumo é enviado pelo orquestrador)
  const suppressNotifs = data._suppressNotifications === true;

  // Notify assignees
  if (!suppressNotifs && taskDoc.assignees?.length) {
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

  // Notify observers (acompanham, mas não são responsáveis)
  if (!suppressNotifs && taskDoc.observers?.length) {
    import('./notifications.js').then(({ notify }) => {
      return notify('task.observing', {
        entityType: 'task', entityId: ref.id,
        recipientIds: taskDoc.observers,
        title: 'Você está acompanhando uma tarefa',
        body: `"${taskDoc.title}" foi criada — você está como observador`,
        route: 'tasks',
      });
    }).catch(() => {});
  }

  return { id: ref.id, ...taskDoc };
}

/* ─── 4.39.0+ Bulk create — N tarefas de uma vez ──────────────
 * @param {Array} rows  — array de objetos no formato esperado por createTask
 * @param {Function} onProgress — callback (done, total) — opcional
 * @returns {Promise<{ created:Array, failed:Array }>}
 *
 * Suprime notificações individuais; envia 1 notification resumo por user
 * que recebeu tarefas (agrupadas).
 */
export async function bulkCreateTasks(rows, onProgress = null) {
  if (!store.can('task_create')) throw new Error('Sem permissão pra criar tarefas.');
  if (!Array.isArray(rows) || !rows.length) return { created: [], failed: [] };

  const created = [];
  const failed  = [];
  // Mapa uid → array de títulos atribuídos (pra resumo)
  const assignmentsByUid = new Map();
  const observationsByUid = new Map();

  for (let i = 0; i < rows.length; i++) {
    try {
      const t = await createTask({ ...rows[i], _suppressNotifications: true });
      created.push(t);
      (t.assignees || []).forEach(uid => {
        if (!assignmentsByUid.has(uid)) assignmentsByUid.set(uid, []);
        assignmentsByUid.get(uid).push(t.title);
      });
      (t.observers || []).forEach(uid => {
        if (!observationsByUid.has(uid)) observationsByUid.set(uid, []);
        observationsByUid.get(uid).push(t.title);
      });
    } catch (e) {
      failed.push({ index: i, row: rows[i], error: e.message });
    }
    if (onProgress) onProgress(i + 1, rows.length);
  }

  // v4.57.27 fix #14: Promise.all em vez de await sequencial.
  // Antes: 100 users → 100 await sequenciais (200+ requests). 500 tasks ficavam
  // lentas. Agora paraleliza por user. Cada notify continua independente —
  // erro de 1 não atrapalha os outros (catch interno).
  try {
    const { notify } = await import('./notifications.js');
    const buildBody = (titles) => {
      const bodyTitles = titles.slice(0, 3).map(t => `• ${t}`).join('\n');
      return bodyTitles + (titles.length > 3 ? `\n…e mais ${titles.length - 3}` : '');
    };
    const assignmentPromises = [...assignmentsByUid].map(([uid, titles]) =>
      notify('task.assigned', {
        entityType: 'task', recipientIds: [uid],
        title: titles.length === 1 ? 'Nova tarefa atribuída' : `${titles.length} tarefas atribuídas`,
        body: buildBody(titles), route: 'tasks',
      }).catch(e => console.warn(`[bulkCreate] notify assigned ${uid} falhou:`, e?.message))
    );
    const observationPromises = [...observationsByUid].map(([uid, titles]) =>
      notify('task.observing', {
        entityType: 'task', recipientIds: [uid],
        title: titles.length === 1 ? 'Você está acompanhando uma tarefa' : `Acompanhando ${titles.length} tarefas novas`,
        body: buildBody(titles), route: 'tasks',
      }).catch(e => console.warn(`[bulkCreate] notify observing ${uid} falhou:`, e?.message))
    );
    await Promise.all([...assignmentPromises, ...observationPromises]);
  } catch (e) {
    console.warn('[bulkCreateTasks] notif resumo falhou:', e?.message);
  }

  return { created, failed };
}

/* ─── Atualizar tarefa ───────────────────────────────────── */
/**
 * @param {string} taskId
 * @param {object} data - campos a atualizar
 * @param {object} [opts]
 * @param {Date|number|object} [opts.expectedUpdatedAt] - se fornecido,
 *   compara com o updatedAt atual no Firestore. Se diferente, lança
 *   um erro com code='STALE_DATA' contendo o updatedBy + diff hint.
 *   Usado pelo TaskModal pra detectar edição concorrente: se A abriu
 *   o modal e B salvou antes, A não sobrescreve cegamente — recebe
 *   stale e pode decidir se recarrega ou força.
 */
export async function updateTask(taskId, data, opts = {}) {
  const user = store.get('currentUser');
  // Sandbox: simula sucesso sem persistir
  const { sandboxGuard } = await import('./sandbox.js');
  if (sandboxGuard('editar tarefa')) return;
  // Captura o snapshot prévio — usado tanto para permissão quanto para diff de assignees
  let prevSnap = null;
  try { prevSnap = await getDoc(doc(db, 'tasks', taskId)); } catch (_) {}
  const prevData = prevSnap?.exists() ? prevSnap.data() : null;

  // ── Stale detection: se chamador passou expectedUpdatedAt e o doc
  //    foi alterado por outro user no meio tempo, abortar pra evitar
  //    sobrescrita cega. Cliente decide: descartar / recarregar / forçar.
  if (opts.expectedUpdatedAt && prevData?.updatedAt) {
    const expected = opts.expectedUpdatedAt?.toMillis?.()
      ?? opts.expectedUpdatedAt?.getTime?.()
      ?? Number(opts.expectedUpdatedAt);
    const actual = prevData.updatedAt?.toMillis?.()
      ?? prevData.updatedAt?.getTime?.()
      ?? Number(prevData.updatedAt);
    // Tolerância de 100ms p/ evitar falso positivo de relógio.
    if (actual && expected && actual - expected > 100) {
      const err = new Error('Esta tarefa foi atualizada por outra pessoa enquanto você editava.');
      err.code = 'STALE_DATA';
      err.staleInfo = {
        updatedBy: prevData.updatedBy,
        updatedAt: prevData.updatedAt,
        currentData: prevData,
      };
      throw err;
    }
  }

  // Permitir edição se:
  //   - tem permissão global (task_edit_any) — diretoria/head/manager/coordinator
  //   - é o criador da tarefa
  //   - é assignee (responsável) — pessoa envolvida pode atualizar (check de
  //     subtarefa, status, etc) sem precisar pedir pro criador.
  //   - é observer — mesma lógica: já está envolvido, então pode editar.
  // Antes do fix de mai/2026: só criador + permissão global → causava
  // "Permissão negada" ao salvar modal pra assignee/observer (incl. ao
  // marcar subtarefa como concluída).
  if (!store.can('task_edit_any') && prevData) {
    const me = user.uid;
    const isCreator  = prevData.createdBy === me;
    const isAssignee = Array.isArray(prevData.assignees) && prevData.assignees.includes(me);
    const isObserver = Array.isArray(prevData.observers) && prevData.observers.includes(me);
    if (!isCreator && !isAssignee && !isObserver) {
      throw new Error('Permissão negada. Apenas criador, responsável, observador ou hierarquia podem editar esta tarefa.');
    }
  }
  // Bloquear mudança para "done" sem permissão task_complete
  if (data.status === 'done' && data._prevStatus !== 'done' && !store.can('task_complete')) {
    throw new Error('Você não tem permissão para concluir tarefas. Peça a um coordenador para homologar.');
  }
  const updates = { ...data, updatedAt: serverTimestamp(), updatedBy: user.uid };

  // Se a chamada toca em metaLinks (formato novo) OU goalId/goalMetaRef
  // (formato legado), normaliza tudo e re-sincroniza os campos legados.
  if ('metaLinks' in data || 'goalId' in data || 'goalMetaRef' in data) {
    const baseAssignees = Array.isArray(data.assignees)
      ? data.assignees
      : (Array.isArray(prevData?.assignees) ? prevData.assignees : []);
    const incoming = Array.isArray(data.metaLinks)
      ? data.metaLinks
      : migrateLegacyToMetaLinks({
          goalId:      'goalId'      in data ? data.goalId      : prevData?.goalId,
          goalMetaRef: 'goalMetaRef' in data ? data.goalMetaRef : prevData?.goalMetaRef,
          assignees:   baseAssignees,
        });
    const normalized = syncLegacyFields({ metaLinks: incoming });
    updates.metaLinks   = normalized.metaLinks;
    updates.goalId      = normalized.goalId;
    updates.goalMetaRef = normalized.goalMetaRef;
  }

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
  invalidateTasksCache();

  // ── Audit sampling: pula updates triviais pra reduzir volume ──
  // Sem isso, cada caractere digitado em descrição (autosave, etc) gera
  // 1 doc em audit_logs. Em 200 users = milhares de logs irrelevantes/dia.
  // FIELDS RELEVANTES (sempre logam):
  //   - status, assignees, observers, dueDate, priority, projectId,
  //     workspaceId, completedAt, completedBy
  //   - mudanças que entram pro audit completo
  // FIELDS TRIVIAIS (logam só se for o ÚNICO field alterado e for "creep"):
  //   - title (sem mudar mais nada) → skip se diff < 3 chars
  //   - description, subtasks (autosave) → skip
  //   - updatedAt, updatedBy (metadata) → skip
  const RELEVANT_FIELDS = new Set([
    'status', 'assignees', 'observers', 'dueDate', 'startDate',
    'priority', 'projectId', 'workspaceId', 'completedAt',
    'completedBy', 'tags', 'sector', 'metaLinks', 'goalId',
    'archived', 'taskTypeId', 'requesterEditFlag',
  ]);
  const SILENT_FIELDS = new Set(['updatedAt', 'updatedBy', '_prevStatus']);

  const changedFields = Object.keys(data).filter(k => !SILENT_FIELDS.has(k));
  const hasRelevant = changedFields.some(f => RELEVANT_FIELDS.has(f));
  const isStatusChange = data.status && data._prevStatus && data.status !== data._prevStatus;
  const isOnlyDescription = changedFields.length === 1 && changedFields[0] === 'description';
  const isOnlyTitle = changedFields.length === 1 && changedFields[0] === 'title'
    && Math.abs((data.title || '').length - (prevData?.title || '').length) < 3;

  // Skip se: só descrição autosave, OU só correção pequena de título
  const shouldSkip = !hasRelevant && (isOnlyDescription || isOnlyTitle);

  if (!shouldSkip) {
    const auditTitle = updates.title || prevData?.title || '';
    await auditLog('tasks.update', 'task', taskId, {
      title:  auditTitle,
      fields: changedFields,
      ...(isStatusChange
        ? { statusFrom: data._prevStatus, statusTo: data.status }
        : {}),
    });
  }

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

  // 4.35+ Auto-CSAT centralizado em triggerCsatOnTaskComplete (decide
  // entre projeto-level / task-type-level / individual). Não dispara mais
  // direto aqui — passa pra função que conhece o override do projeto.
  if (data.status === 'done' && data.status !== data._prevStatus) {
    import('./csat.js').then(async ({ triggerCsatOnTaskComplete }) => {
      try {
        const merged = {
          id: taskId,
          ...prevData,
          ...data,
        };
        await triggerCsatOnTaskComplete(merged);
      } catch (e) { console.warn('[CSAT] trigger failed:', e?.message || e); }
    }).catch(() => {});
  }

  // Notify on status changes (assignees + observers + creator)
  if (data.status && data.status !== data._prevStatus) {
    // Observadores acompanham TODAS as mudanças de status (criador + assignees + observers)
    const observers = Array.isArray(data.observers)
      ? data.observers
      : (Array.isArray(prevData?.observers) ? prevData.observers : []);
    const assignees = Array.isArray(data.assignees)
      ? data.assignees
      : (Array.isArray(prevData?.assignees) ? prevData.assignees : []);
    const creator   = data.createdBy || prevData?.createdBy;

    import('./notifications.js').then(({ notify }) => {
      // Une todos sem duplicatas
      const allRecipients = (...lists) =>
        Array.from(new Set(lists.flat().filter(Boolean)));

      if (data.status === 'done') {
        notify('task.completed', {
          entityType: 'task', entityId: taskId,
          recipientIds: allRecipients(creator, assignees, observers),
          title: 'Tarefa concluída',
          body: `"${data.title || 'Tarefa'}" foi concluída`,
          route: 'tasks',
        });
      } else if (data.status === 'rework') {
        notify('task.rework', {
          entityType: 'task', entityId: taskId,
          recipientIds: allRecipients(assignees, observers),
          title: 'Tarefa devolvida para retrabalho',
          body: `"${data.title || 'Tarefa'}" precisa de ajustes`,
          route: 'tasks',
          priority: 'high',
        });
      } else {
        // Generic status change → notifica criador + observadores
        const recipients = allRecipients(creator, observers);
        if (recipients.length) {
          notify('task.status_changed', {
            entityType: 'task', entityId: taskId,
            recipientIds: recipients,
            title: 'Status alterado',
            body: `"${data.title || 'Tarefa'}" mudou para ${data.status}`,
            route: 'tasks',
          });
        }
      }
    }).catch(() => {});
  }

  // Notifica observers adicionados/removidos (diff)
  if (Array.isArray(data.observers) && prevData) {
    const prevObs = Array.isArray(prevData.observers) ? prevData.observers : [];
    const addedObs = data.observers.filter(uid => uid && !prevObs.includes(uid));
    if (addedObs.length) {
      import('./notifications.js').then(({ notify }) => {
        notify('task.observing', {
          entityType: 'task', entityId: taskId,
          recipientIds: addedObs,
          title: 'Você está acompanhando uma tarefa',
          body: `Você foi adicionado como observador em "${data.title || prevData.title || 'Tarefa'}"`,
          route: 'tasks',
        });
      }).catch(() => {});
    }
  }
}

/**
 * v4.53.0+ Atualiza status da tarefa via updateTask + side-effects do `validation`.
 *   - validation: grava `slaFrozenAt = now` + notifica managers (request.validation_needed)
 *   - sair de validation: limpa `slaFrozenAt`
 *   - done a partir de validation: grava `validatedBy`/`validatedAt` (trilha auditoria)
 *
 * Usado pelo botão "Enviar pra validação" no header da tarefa e pelo dropdown
 * de status quando user é assignee sem perm task_complete.
 */
export async function updateTaskStatus(taskId, newStatus) {
  const prev = await getTask(taskId).catch(() => null);
  if (!prev) throw new Error('Tarefa não encontrada');
  const wasValidation = prev.status === 'validation';
  const me = store.get('currentUser');

  const updates = { status: newStatus };

  if (newStatus === 'validation') {
    updates.slaFrozenAt = serverTimestamp();
    updates.slaFrozenBy = me?.uid || null;
  }
  if (wasValidation && newStatus !== 'validation') {
    // Saiu de validation: limpa freeze
    updates.slaFrozenAt = null;
    updates.slaFrozenBy = null;
    if (newStatus === 'done') {
      updates.validatedBy = me?.uid || null;
      updates.validatedAt = serverTimestamp();
    }
  }
  // v4.57.27 fix #15: status FINAIS (done/cancelled) limpam slaFrozenAt
  // mesmo quando NÃO vieram de validation (ex: master pula direto pra done).
  // Antes: slaFrozenAt podia ficar setado em task done — afeta relatórios SLA.
  if (['done', 'cancelled'].includes(newStatus) && prev.slaFrozenAt) {
    updates.slaFrozenAt = null;
    updates.slaFrozenBy = null;
  }

  await updateTask(taskId, updates);

  // Notifica managers/admins quando entra em validation
  if (newStatus === 'validation' && prev.status !== 'validation') {
    try {
      const { notify } = await import('./notifications.js');
      // v4.57.22 fix #10: fallback Firestore se store.users estiver vazio
      // (acontece em páginas standalone tipo kanban portal/cron jobs).
      // Antes: managers vazio → ninguém notificado → task fica em validation
      // sem alguém saber, indefinidamente.
      let users = store.get('users') || [];
      if (!users.length) {
        try {
          const usersSnap = await getDocs(query(collection(db, 'users'), where('active', '==', true)));
          users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (fe) { console.warn('[updateTaskStatus] fallback users fetch falhou:', fe.message); }
      }
      const managers = users
        .filter(u => u.isMaster
                  || ['master','admin','head'].includes(u.roleId)
                  || ['master','admin','head'].includes(u.role)
                  || u.permissions?.includes?.('task_complete'))
        .map(u => u.id)
        .filter(id => id !== me?.uid);   // não notifica o próprio analista
      if (managers.length) {
        await notify('task.validation_needed', {
          entityType: 'task', entityId: taskId,
          recipientIds: managers,
          title: 'Tarefa aguardando validação',
          body: `${me?.name || 'Analista'} concluiu "${prev.title || 'tarefa'}" — aguardando double-check.`,
          route: 'requests?tab=validation',
          category: 'task',
          priority: 'high',
        });
      }
    } catch (e) { console.warn('[updateTaskStatus] notify validation falhou:', e.message); }
  }

  return { taskId, status: newStatus };
}

/* ─── Completar tarefa (toggle) ──────────────────────────── */
export async function toggleTaskComplete(taskId, isDone) {
  const user = store.get('currentUser');
  // v4.53.0+ Renê: "analista 'conclui' tarefa, mas quem finaliza é coordenador".
  // Se user NÃO tem task_complete mas É assignee, redireciona pra fila de
  // validação (SLA congela). Sem erro — UX fluida em vez de bloquear.
  if (isDone && !store.can('task_complete')) {
    let prevTask = null;
    try {
      const snap = await getDoc(doc(db, 'tasks', taskId));
      if (snap.exists()) prevTask = snap.data();
    } catch (_) {}
    const isAssignee = Array.isArray(prevTask?.assignees) && prevTask.assignees.includes(user?.uid);
    if (isAssignee) {
      // Redireciona pra validation flow (delega side-effects pra updateTaskStatus)
      await updateTaskStatus(taskId, 'validation');
      playCompletionSound();
      return;
    }
    throw new Error('Você não tem permissão para concluir tarefas. Peça a um coordenador para homologar.');
  }
  // Lê título antes do update pra incluir no audit (rotular humano-friendly)
  let taskTitle = '';
  try {
    const snap = await getDoc(doc(db, 'tasks', taskId));
    if (snap.exists()) taskTitle = snap.data().title || '';
  } catch (_) {}

  await updateDoc(doc(db, 'tasks', taskId), {
    status:      isDone ? 'done' : 'not_started',
    completedAt: isDone ? serverTimestamp() : null,
    // v4.53.0+ Limpa freeze ao concluir oficialmente (caso vinha de validation)
    slaFrozenAt: isDone ? null : undefined,
    updatedAt:   serverTimestamp(),
    updatedBy:   user.uid,
  });
  invalidateTasksCache();
  await auditLog('tasks.complete', 'task', taskId, { done: isDone, title: taskTitle });
  if (isDone) playCompletionSound();

  // v4.57.28 fix integração #1: dispara CSAT igual updateTask (caminho do modal).
  // Antes: checkbox da lista bypassa CSAT. Causa: 2 paths pra "concluir tarefa"
  // (modal salva via updateTask que aciona CSAT; checkbox da lista via
  // toggleTaskComplete que NÃO acionava). UX inconsistente. CLAUDE.md §12.n
  // (caminhos múltiplos pra mesma operação precisam paridade de side-effects).
  if (isDone) {
    try {
      const fresh = await getDoc(doc(db, 'tasks', taskId));
      if (fresh.exists()) {
        const merged = { id: taskId, ...fresh.data() };
        const csatMod = await import('./csat.js');
        if (csatMod.triggerCsatOnTaskComplete) {
          await csatMod.triggerCsatOnTaskComplete(merged);
        }
      }
    } catch (e) { console.warn('[toggleTaskComplete] CSAT trigger falhou:', e?.message); }
  }
}

/* ─── Excluir tarefa ─────────────────────────────────────── */
export async function deleteTask(taskId) {
  if (!store.can('task_delete')) throw new Error('Permissão negada.');
  const { sandboxGuard } = await import('./sandbox.js');
  if (sandboxGuard('excluir tarefa')) return;

  // Se a task veio de uma notícia, limpa o registro de conversão
  // pra não inflar KPIs de "utilização de notícias" (proteção contra erro
  // ou burla: criar→deletar em loop pra aumentar números).
  // Também captura título pra audit log antes de deletar (humano-friendly).
  let sourceNewsId = null;
  let taskTitle = '';
  let attachments = [];   // v4.57.27 fix #19: captura attachments pra cleanup Storage
  try {
    const snap = await getDoc(doc(db, 'tasks', taskId));
    if (snap.exists()) {
      const d = snap.data();
      sourceNewsId = d.sourceNewsId || null;
      taskTitle    = d.title || '';
      attachments  = Array.isArray(d.attachments) ? d.attachments : [];
    }
  } catch (_) { /* segue sem bloquear delete */ }

  await deleteDoc(doc(db, 'tasks', taskId));

  // v4.57.27 fix #19: cleanup files do Cloud Storage (best-effort, não bloqueia)
  // Antes: comments somem com o doc mas anexos no Storage ficavam órfãos.
  // Custo: lixo digital acumulado em produção.
  if (attachments.length > 0) {
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js')
      .then(({ getStorage, ref, deleteObject }) => {
        const storage = getStorage();
        attachments.forEach(att => {
          if (!att?.storagePath) return;
          deleteObject(ref(storage, att.storagePath))
            .catch(e => console.warn(`[deleteTask] cleanup attachment ${att.storagePath} falhou:`, e?.code));
        });
      })
      .catch(e => console.warn('[deleteTask] storage import falhou:', e?.message));
  }
  invalidateTasksCache();
  await auditLog('tasks.delete', 'task', taskId, { sourceNewsId, title: taskTitle });

  if (sourceNewsId) {
    try {
      const { removeNewsConversion } = await import('./newsMonitor.js');
      await removeNewsConversion(sourceNewsId, taskId);
    } catch (e) {
      console.warn('[Tasks] cleanup de conversão de notícia falhou:', e.message);
    }
  }

  // v4.57.28 fix integração #2: limpa request.taskId se houver request linkada.
  // Antes: deletar task deixava request órfã apontando pra doc inexistente —
  // banner "veio de solicitação" no UI da request virava 404 ao clicar.
  // Agora: query inversa + updateDoc clear (best-effort, não bloqueia delete).
  try {
    const reqSnap = await getDocs(query(
      collection(db, 'requests'),
      where('taskId', '==', taskId),
      limit(5),  // theoretically 1, mas defensivo
    ));
    if (!reqSnap.empty) {
      const batch = writeBatch(db);
      reqSnap.forEach(d => {
        batch.update(d.ref, {
          taskId: null,
          taskDeleted: true,
          taskDeletedAt: serverTimestamp(),
          // mantém status='converted' pra histórico; quem fez delete pode reabrir manualmente
        });
      });
      await batch.commit();
    }
  } catch (e) {
    console.warn('[deleteTask] cleanup request.taskId falhou:', e?.message);
  }
}

/* ─── Buscar tarefa ──────────────────────────────────────── */
export async function getTask(taskId) {
  const snap = await getDoc(doc(db, 'tasks', taskId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/* ─── Bulk update (writeBatch) ─────────────────────────────
 * Atualiza N tarefas em lotes de 400 (limite do Firestore = 500/batch).
 * Cada item: { id, data }. Não roda migrateLegacyToMetaLinks/syncLegacyFields
 * — use apenas para campos simples (projectId, sector, etc.). Para fields
 * que tocam metaLinks/goalId, use updateTask por item.
 *
 * Retorna { total, updated, failed }.
 *
 * IMPORTANTE: como não passa por updateTask, não faz checagem de permissão
 * por documento — chame apenas em fluxos onde a permissão já foi validada
 * no nível da página (ex.: bulk-orphan-fix, só visível pra admin/master).
 */
export async function bulkUpdateTasks(items, onProgress) {
  const user = store.get('currentUser');
  if (!user?.uid) throw new Error('Usuário não autenticado.');
  if (!Array.isArray(items) || !items.length) return { total: 0, updated: 0, failed: 0 };

  // 4.49.10+ SECURITY: bloqueia conclusão em massa sem permissão.
  const wantsDone = items.some(it => it?.data?.status === 'done');
  if (wantsDone && !store.can('task_complete')) {
    throw new Error('Você não tem permissão para concluir tarefas em massa. Peça a um coordenador para homologar.');
  }

  // v4.57.22 fix #8: filtra items pra tasks que user PODE editar.
  // Antes: comentário "não faz checagem por documento" — qualquer user com
  // task_create podia alterar sector/projectId/assignees/tags de TODAS as
  // tasks selecionadas via bulkActionBar, mesmo as que não eram dele.
  // Agora: master/admin/head/coord (com task_edit_any) processa tudo.
  // Demais users: só processa tasks onde é criador/assignee/observer.
  if (!store.can('task_edit_any')) {
    const allowedIds = new Set();
    const checks = await Promise.all(items.map(async ({ id }) => {
      try {
        const snap = await getDoc(doc(db, 'tasks', id));
        if (!snap.exists()) return null;
        const t = snap.data();
        const isOwn = t.createdBy === user.uid
          || (Array.isArray(t.assignees) && t.assignees.includes(user.uid))
          || (Array.isArray(t.observers) && t.observers.includes(user.uid));
        return isOwn ? id : null;
      } catch { return null; }
    }));
    checks.forEach(id => id && allowedIds.add(id));
    const blocked = items.length - allowedIds.size;
    items = items.filter(it => allowedIds.has(it.id));
    if (blocked > 0 && items.length === 0) {
      throw new Error(`Você não tem permissão pra editar nenhuma das ${blocked} tarefas selecionadas.`);
    }
    if (blocked > 0) {
      console.warn(`[bulkUpdate] ${blocked} de ${blocked + items.length} tarefas filtradas por permissão.`);
    }
  }

  const total = items.length;
  let   updated = 0;
  let   failed  = 0;
  const BATCH = 400;

  for (let i = 0; i < total; i += BATCH) {
    const slice = items.slice(i, i + BATCH);
    const batch = writeBatch(db);
    slice.forEach(({ id, data }) => {
      if (!id || !data) return;
      // 4.49.10+ Quando trocar pra 'done' em batch, seta completedAt automatico
      // (mesma semantica de updateTask). Sem isso o card ficava "concluído" mas
      // sem data — quebrava analytics e os filtros de "concluídas hoje/no prazo".
      const isCompleting = data.status === 'done';
      const updates = {
        ...data,
        ...(isCompleting && !data.completedAt ? { completedAt: serverTimestamp() } : {}),
        ...(data.status && data.status !== 'done' ? { completedAt: null } : {}),
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      };
      batch.update(doc(db, 'tasks', id), updates);
    });
    try {
      await batch.commit();
      updated += slice.length;
    } catch (e) {
      console.warn('[bulkUpdateTasks] batch falhou:', e?.message);
      failed += slice.length;
    }
    if (typeof onProgress === 'function') onProgress(updated + failed, total);
  }

  invalidateTasksCache();
  await auditLog('tasks.bulkUpdate', 'tasks', null, { count: updated, failed }).catch(() => {});
  return { total, updated, failed };
}

/* ─── Excluir várias tarefas selecionadas (bulk delete) ─────
 * Apaga em batches de 400. Para uso na bulk-action-bar.
 * Cada user pode excluir apenas tarefas que tem permissão (caller filtra).
 */
export async function bulkDeleteTasks(ids, onProgress) {
  const user = store.get('currentUser');
  if (!user?.uid) throw new Error('Usuário não autenticado.');
  // 4.49.10+ SECURITY: bloqueia delete em massa sem task_delete.
  // Antes: bulk action bar permitia "Excluir" → bulkDeleteTasks SEM guard.
  // Análogo ao gap de bulkUpdateTasks descoberto no mesmo audit.
  if (!store.can('task_delete')) {
    throw new Error('Você não tem permissão para excluir tarefas em massa.');
  }
  if (!Array.isArray(ids) || !ids.length) return { total: 0, deleted: 0, failed: 0 };

  const total = ids.length;
  let   deleted = 0;
  let   failed  = 0;
  const BATCH = 400;

  for (let i = 0; i < total; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const batch = writeBatch(db);
    slice.forEach(id => {
      if (id) batch.delete(doc(db, 'tasks', id));
    });
    try {
      await batch.commit();
      deleted += slice.length;
    } catch (e) {
      console.warn('[bulkDeleteTasks] batch falhou:', e?.message);
      failed += slice.length;
    }
    if (typeof onProgress === 'function') onProgress(deleted + failed, total);
  }

  invalidateTasksCache();
  await auditLog('tasks.bulkDelete', 'tasks', null, { count: deleted, failed }).catch(() => {});
  return { total, deleted, failed };
}

/* ─── Excluir TODAS as tarefas (master-only / danger zone) ──
 * Apaga em lotes (batches de 400, abaixo do limite de 500 do Firestore).
 * Não faz backup automático — o usuário deve confirmar que tem backup.
 * Retorna { total, deleted }.
 */
export async function deleteAllTasks(onProgress) {
  if (!store.isMaster()) throw new Error('Apenas master pode executar esta operação.');

  const snap  = await getDocs(collection(db, 'tasks'));
  const total = snap.docs.length;
  let   done  = 0;
  const BATCH = 400;

  for (let i = 0; i < total; i += BATCH) {
    const slice = snap.docs.slice(i, i + BATCH);
    const batch = writeBatch(db);
    slice.forEach(d => batch.delete(d.ref));
    await batch.commit();
    done += slice.length;
    if (typeof onProgress === 'function') onProgress(done, total);
  }

  invalidateTasksCache();
  await auditLog('tasks.deleteAll', 'tasks', null, { count: done });
  return { total, deleted: done };
}

/* ─── Cache do snapshot bruto de tasks ─────────────────────
 * Páginas (dashboard, profile, capacity, csat, goals, calendar,
 * portalDashboard, etc.) chamam fetchTasks() repetidamente em poucos
 * segundos durante navegação. Sem cache: cada chamada baixa até 5000 docs.
 * Com cache TTL de 90s + invalidação em mutations, navegação repetida
 * dentro da janela serve do cache local (0 reads).
 *
 * Cuidado: cacheamos só o array bruto (snap.docs). Os filtros por user/
 * setor/squad rodam SEMPRE no resultado cacheado — assim, mudanças de
 * contexto (workspace ativo, setor visível) refletem imediatamente sem
 * precisar refetchar.
 */
const _tasksRawCache = new Map(); // key=limitN -> { ts, items }
const TASKS_RAW_TTL  = 90 * 1000;

export function invalidateTasksCache() {
  _tasksRawCache.clear();
}

async function _getRawTasks(limitN) {
  const cached = _tasksRawCache.get(limitN);
  if (cached && (Date.now() - cached.ts) < TASKS_RAW_TTL) return cached.items;
  const constraints = [orderBy('order', 'asc'), limit(limitN)];
  const q = query(collection(db, 'tasks'), ...constraints);
  const snap = await getDocs(q);
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  _tasksRawCache.set(limitN, { ts: Date.now(), items });
  return items;
}

/* ─── Listar tarefas (filtros) ───────────────────────────── */
export async function fetchTasks({
  projectId    = null,
  assigneeId   = null,
  status       = null,
  priority     = null,
  workspaceIds = null,   // null = usa activeWorkspaces do store
  limitN       = 5000,
  force        = false,
} = {}) {
  // Estratégia: baixar TODAS as tarefas (até limitN) e filtrar client-side
  // para garantir que tarefas atribuídas em outros workspaces apareçam.
  // Ver comentário em subscribeToTasks() para detalhes.
  if (force) _tasksRawCache.delete(limitN);
  let tasks = await _getRawTasks(limitN);

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
export async function fetchArchivedTasks({ limitN = 5000 } = {}) {
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
  // Estratégia: baixar TODAS as tarefas (até 5000) e filtrar client-side.
  // Por quê não filtrar server-side por workspaceId?
  //   1. Tarefas atribuídas ao usuário em OUTROS workspaces deixariam de
  //      aparecer (o filtro server-side as exclui antes do client poder
  //      resgatá-las pelo isAssignee()).
  //   2. where('workspaceId') + orderBy('order') exige índice composto.
  // Para bases até ~10k tarefas isso ainda é tranquilo; acima disso, refatorar
  // para duas queries paralelas (workspaceId OR assignees).
  const constraints = [orderBy('order', 'asc'), limit(5000)];
  const q = query(collection(db, 'tasks'), ...constraints);

  // v4.53.3+ Auto-reconnect quando aba volta de hidden por >5min OU
  // quando network volta de offline. Fix: relato de "preciso F5 pra ver
  // tarefa nova" quando a aba ficou aberta horas em background — Firestore
  // SDK pode pausar listener em economia de bateria, e em alguns browsers
  // não re-subscribe automaticamente quando volta.
  let innerUnsub = null;
  let lastHiddenAt = 0;
  const abortCtrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const setupListener = () => {
    if (innerUnsub) { try { innerUnsub(); } catch {} innerUnsub = null; }
    innerUnsub = createTasksListener(q, callback, filters);
  };
  setupListener();

  if (typeof document !== 'undefined' && abortCtrl) {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        lastHiddenAt = Date.now();
      } else if (lastHiddenAt) {
        const hiddenForMs = Date.now() - lastHiddenAt;
        if (hiddenForMs > 5 * 60 * 1000) {
          console.log('[tasks] aba voltou após', Math.round(hiddenForMs/1000), 's hidden — re-subscribe');
          setupListener();
        }
        lastHiddenAt = 0;
      }
    }, { signal: abortCtrl.signal });

    window.addEventListener('online', () => {
      console.log('[tasks] network voltou online — re-subscribe');
      setupListener();
    }, { signal: abortCtrl.signal });
  }

  return () => {
    if (abortCtrl) abortCtrl.abort();
    if (innerUnsub) { try { innerUnsub(); } catch {} innerUnsub = null; }
  };
}

/* Lógica interna do snapshot — extraída pra ser reaproveitada em re-subscribe.
 * Idempotente: cada chamada cria um novo listener. Quem chamou descarta o
 * anterior antes (ver setupListener acima).
 */
function createTasksListener(q, callback, filters = {}) {
  // v4.57.25 fix #17: clearTimeout no unsub — antes, ao re-subscribe
  // (visibilitychange / online), o debounceTimer de 300ms do snapshot
  // antigo podia disparar callback órfão sobrescrevendo render novo.
  let debounceTimer = null;
  const innerUnsub = onSnapshot(q, (snap) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      let tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Aproveita o snapshot do listener para popular o cache do fetchTasks,
      // evitando getDocs redundante quando outras páginas pedem a mesma coleção.
      _tasksRawCache.set(5000, { ts: Date.now(), items: tasks });

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
      // IMPORTANTE: usa store.getVisibleSectors() (mesmo que fetchTasks),
      // NÃO store.get('visibleSectors'). Diferença crítica:
      //   getVisibleSectors() → null p/ master, [userSector] p/ usuário comum
      //   get('visibleSectors') → raw _state (geralmente [] p/ não-Head)
      // Bug pré-3.7.1: usava o raw, fazendo `length > 0` falhar p/ todo
      // usuário não-Head — listener NÃO filtrava por setor → dashboard
      // (que usa fetchTasks) mostrava 860, lista (que usa este listener)
      // mostrava 1039 do sistema todo, atravessando setores.
      const visibleSectors = store.getVisibleSectors();
      if (visibleSectors !== null && visibleSectors.length > 0) {
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
    // v4.49.61+ Handler aprimorado:
    //   - permission-denied / failed-precondition: fallback p/ fetch direto
    //   - unavailable / aborted / network: sinaliza connection.markNetworkError
    //     (indicador UI mostra "Reconectando…") + agenda re-subscribe em 5s
    //   - outros: log + fallback
    console.warn('subscribeToTasks error:', error.code, error.message);
    import('./connection.js').then(({ markNetworkError, isFirestoreError }) => {
      if (isFirestoreError(error)) markNetworkError('subscribeToTasks', error);
    }).catch(() => {});

    if (error.code === 'permission-denied' || error.code === 'failed-precondition') {
      fetchTasks(filters).then(callback).catch(() => callback([]));
    } else {
      // Network/transient: tenta fetch direto pra não deixar UI vazia,
      // e o cliente refaz subscribe na próxima ação que provocar mount.
      fetchTasks(filters).then(callback).catch(() => callback([]));
    }
  });
  // v4.57.25 fix #17: retorna wrapper que clearTimeout do debounce ao unsub.
  // Evita callback órfão disparar 300ms depois do unsub com snap antigo.
  return () => {
    clearTimeout(debounceTimer);
    try { innerUnsub(); } catch {}
  };
}

/* ─── Mover task no kanban (atualiza order + status) ────── */
export async function moveTaskKanban(taskId, newStatus, newOrder) {
  if (newStatus === 'done' && !store.can('task_complete')) {
    throw new Error('Você não tem permissão para concluir tarefas. Peça a um coordenador para homologar.');
  }
  const user = store.get('currentUser');
  // v4.57.22 fix #9: valida permissão de EDIT por doc (criador/assignee/observer ou
  // task_edit_any). Antes: bypass via drag — qualquer user com acesso ao kanban
  // arrastava tarefa de outro sem ter permissão.
  if (!store.can('task_edit_any')) {
    try {
      const snap = await getDoc(doc(db, 'tasks', taskId));
      if (!snap.exists()) throw new Error('Tarefa não encontrada.');
      const t = snap.data();
      const isOwn = t.createdBy === user.uid
        || (Array.isArray(t.assignees) && t.assignees.includes(user.uid))
        || (Array.isArray(t.observers) && t.observers.includes(user.uid));
      if (!isOwn) {
        throw new Error('Você não pode mover tarefas que não são suas (e onde não é observador).');
      }
    } catch (e) {
      if (e.message?.startsWith('Você não pode')) throw e;
      // erro de fetch: deixa o updateDoc abaixo lidar (rules vão validar)
    }
  }
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
  invalidateTasksCache();
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
      // v4.57.27 fix #18: prioriza title FRESH (do snap recente) sobre `prev`
      // cacheado. Antes: se subtask foi renomeada no mesmo update batch, notif
      // saía com title antigo. Edge rara mas frágil — agora consistente.
      const freshSub = (Array.isArray(taskData.subtasks) ? taskData.subtasks : []).find(s => s.id === subtaskId);
      const subTitle  = freshSub?.title || prev?.title || updated.find(s => s.id === subtaskId)?.title || 'Subtarefa';
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
    // v4.57.22 fix #12: inclui observers (consistência com status_changed).
    // Antes: observer não recebia notif de comment — quem acompanha
    // deveria ser notificado de qualquer movimentação relevante.
    const recipients = [...new Set([
      task.createdBy,
      ...(task.assignees || []),
      ...(task.observers || []),
    ])].filter(Boolean).filter(uid => uid !== user.uid);   // exclui o autor do comment
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
// v4.57.25 fix #13 (refinado): tokeniza o texto pra evitar substring match
// errado. Antes: '@joão silva' → matchava u1 (full) E u2 (first 'joão').
// Agora: extrai tokens '@palavra1 palavra2' do texto e compara contra
// (full name) ou (first name único) dos users.
function parseMentions(text, users, currentUid) {
  if (!text || !Array.isArray(users) || !users.length) return [];
  if (!String(text).includes('@')) return [];
  // Mapa de firstName → count (pra detectar ambiguidade)
  const firstCount = new Map();
  for (const u of users) {
    if (!u || !u.id || u.id === currentUid) continue;
    const first = String(u.name || '').trim().split(/\s+/)[0]?.toLowerCase();
    if (!first) continue;
    firstCount.set(first, (firstCount.get(first) || 0) + 1);
  }
  // Extrai todas as menções do texto. Regex: @palavra (opcionalmente seguida
  // de outra palavra). Captura "@joão silva" inteiro OU "@maria" sozinho.
  // Pega ATÉ 2 palavras (suficiente pros nomes pt-BR mais comuns).
  // Stopwords pt-BR + en — não fazem parte de nome próprio
  const STOP = new Set(['e','ou','o','a','os','as','de','da','do','das','dos','para','pra','que','com','um','uma','no','na','em','&','and','or','to','that']);
  const mentions = new Set();
  const re = /@([a-zà-ú]+)(?:\s+([a-zà-ú]+))?/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const first = m[1].toLowerCase();
    const second = m[2]?.toLowerCase();
    if (second && !STOP.has(second)) {
      // Menção de NOME COMPOSTO — só adiciona o composto. Não cai pra first
      // isolado (evita match cruzado com outro user de mesmo first name).
      mentions.add(`${first} ${second}`);
    } else {
      // Menção de NOME ÚNICO — adiciona só first
      mentions.add(first);
    }
  }
  if (!mentions.size) return [];

  const mentioned = new Set();
  for (const u of users) {
    if (!u || !u.id || u.id === currentUid) continue;
    const fullName = String(u.name || '').trim().toLowerCase();
    if (!fullName) continue;
    const first = fullName.split(/\s+/)[0];

    // Match por full name (sempre OK — usa palavra-chave única)
    if (mentions.has(fullName)) { mentioned.add(u.id); continue; }
    // Match por "first second" do user (ex: user "João Silva" mencionado como "@joão silva")
    const firstTwo = fullName.split(/\s+/).slice(0, 2).join(' ');
    if (mentions.has(firstTwo)) { mentioned.add(u.id); continue; }
    // Match por primeiro nome — só se NÃO houver duplicata
    if (mentions.has(first) && firstCount.get(first) === 1) {
      mentioned.add(u.id);
    }
  }
  return [...mentioned];
}

/* ════════════════════════════════════════════════════════════
 * setUrgencyOverride / clearUrgencyOverride
 *
 * Permite que usuários autorizados (master/admin/manager/coordinator)
 * removam manualmente a marcação automática de "urgência por SLA breach"
 * em uma tarefa específica, com justificativa obrigatória.
 *
 * Caso de uso: tarefa já em andamento há tempos foi inserida tardiamente
 * no sistema. O `enforceCalendarRules()` em taskModal força priority='urgent'
 * porque dueDate < hoje + SLA, mas isso é falso na prática (a tarefa não
 * está atrasada — só foi cadastrada tarde).
 *
 * Pra cada override: audit log com severity:warning, notificação ao
 * criador da task, e o flag `urgencyOverride.active=true` impede o
 * `enforceCalendarRules` de re-forçar urgent em edições futuras.
 *
 * É reversível via clearUrgencyOverride (também auditado).
 * ════════════════════════════════════════════════════════════ */

/** Aplica override de urgência. `reason` obrigatório (mín. 10 chars). */
export async function setUrgencyOverride(taskId, reason) {
  if (!store.can('task_override_urgency')) {
    throw new Error('Permissão negada: você não pode remover urgência automática.');
  }
  const trimmed = String(reason || '').trim();
  if (trimmed.length < 10) {
    throw new Error('Justificativa muito curta (mínimo 10 caracteres).');
  }

  const user = store.get('currentUser');
  const profile = store.get('userProfile') || {};
  const taskSnap = await getDoc(doc(db, 'tasks', taskId));
  if (!taskSnap.exists()) throw new Error('Tarefa não encontrada.');
  const prev = taskSnap.data();

  const overrideForDb = {
    active:  true,
    reason:  trimmed,
    by:      user.uid,
    byName:  profile.name || user.email || 'Usuário',
    at:      serverTimestamp(),
  };

  // Reduz priority de urgent → medium ao aplicar override (mantém o efeito
  // visual esperado). Se já está em outro priority, não toca.
  const updates = { urgencyOverride: overrideForDb, updatedAt: serverTimestamp(), updatedBy: user.uid };
  if (prev.priority === 'urgent') updates.priority = 'medium';

  await updateDoc(doc(db, 'tasks', taskId), updates);

  // Versão pra UI imediata: substitui sentinel `serverTimestamp()` por Date
  // local. Snapshot listener vai trocar pelo timestamp real do servidor depois.
  const overrideForUi = { ...overrideForDb, at: new Date() };

  // Audit log preservado (severity:warning sai do TTL 90d)
  await auditLog('tasks.urgency_override', 'task', taskId, {
    taskTitle: prev.title || '',
    reason:    trimmed,
    prevPriority: prev.priority || 'medium',
  }, { severity: 'warning' }).catch(() => {});

  // Notifica o criador da task (se não for ele mesmo aplicando)
  try {
    if (prev.createdBy && prev.createdBy !== user.uid) {
      const { notify } = await import('./notifications.js');
      await notify('task.urgency_override', {
        entityType:   'task',
        entityId:     taskId,
        recipientIds: [prev.createdBy],
        title:        'Urgência removida da sua tarefa',
        body:         `${profile.name || 'Um gestor'} removeu a urgência automática de "${prev.title || 'tarefa'}". Motivo: ${trimmed.slice(0, 120)}`,
        route:        'tasks',
        priority:     'normal',
      });
    }
  } catch (e) { console.warn('[urgency-override] notify failed:', e?.message); }

  return overrideForUi;
}

/** Restaura urgência automática (apaga o override). Reversível. */
export async function clearUrgencyOverride(taskId) {
  if (!store.can('task_override_urgency')) {
    throw new Error('Permissão negada.');
  }
  const user = store.get('currentUser');
  const taskSnap = await getDoc(doc(db, 'tasks', taskId));
  if (!taskSnap.exists()) throw new Error('Tarefa não encontrada.');
  const prev = taskSnap.data();
  if (!prev.urgencyOverride?.active) return; // idempotente

  await updateDoc(doc(db, 'tasks', taskId), {
    urgencyOverride: null,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });

  await auditLog('tasks.urgency_override_revoked', 'task', taskId, {
    taskTitle:   prev.title || '',
    prevReason:  prev.urgencyOverride?.reason || '',
    prevBy:      prev.urgencyOverride?.byName || '',
  }, { severity: 'warning' }).catch(() => {});
}
