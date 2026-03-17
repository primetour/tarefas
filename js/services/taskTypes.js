/**
 * PRIMETOUR — Task Types Service (Fase 1)
 * Motor de tipos de tarefa com campos customizados, SLA e regras de negócio
 */

import {
  collection, doc, getDoc, getDocs, addDoc, setDoc,
  updateDoc, deleteDoc, query, where, orderBy,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }       from '../firebase.js';
import { store }    from '../store.js';
import { auditLog } from '../auth/audit.js';

/* ─── Tipos de campo disponíveis ─────────────────────────── */
export const FIELD_TYPES = [
  { value: 'text',        label: 'Texto livre',       icon: '✎',  info: 'Campo de texto simples, uma linha.' },
  { value: 'textarea',    label: 'Texto longo',        icon: '▤',  info: 'Campo de texto com múltiplas linhas.' },
  { value: 'checkbox',    label: 'Caixa de seleção',   icon: '☑',  info: 'Campo marcável sim/não.' },
  { value: 'select',      label: 'Lista de opções',    icon: '▾',  info: 'Seleção de uma opção de uma lista predefinida.' },
  { value: 'multiselect', label: 'Múltipla escolha',   icon: '▾▾', info: 'Seleção de várias opções de uma lista.' },
  { value: 'number',      label: 'Número',             icon: '#',  info: 'Campo numérico.' },
  { value: 'date',        label: 'Data',               icon: '◷',  info: 'Seletor de data.' },
];

/* ─── Tipo Newsletter padrão do sistema ───────────────────── */
export const NEWSLETTER_SYSTEM_TYPE = {
  id:          'newsletter',
  name:        'Newsletter',
  description: 'Produção de newsletters com fluxo editorial completo.',
  icon:        '📧',
  color:       '#D4A843',
  isSystem:    true,
  workspaceId: null,
  fields: [
    {
      id:             'f_newsletter_status',
      key:            'newsletterStatus',
      label:          'Etapa da Newsletter',
      type:           'select',
      options:        [
        'Pauta', 'Conteúdo técnico', 'Redação', 'Design',
        'Revisão', 'Tarifa e dispo', 'Agendado', 'Disparado', 'Análise de Dados',
      ],
      required:       false,
      showInList:     true,
      showInCalendar: false,
      showInKanban:   true,
      info:           'Etapa atual do fluxo editorial da newsletter.',
    },
    {
      id:             'f_out_of_calendar',
      key:            'outOfCalendar',
      label:          'Fora do calendário',
      type:           'checkbox',
      required:       false,
      showInList:     true,
      showInCalendar: true,
      showInKanban:   false,
      info:           'Marque quando esta newsletter não estava prevista no calendário editorial.',
    },
  ],
  steps: [
    { id: 's1', label: 'Pauta',             color: '#6B7280', order: 0 },
    { id: 's2', label: 'Produção',          color: '#38BDF8', order: 1 },
    { id: 's3', label: 'Revisão',           color: '#A78BFA', order: 2 },
    { id: 's4', label: 'Agendamento',       color: '#F59E0B', order: 3 },
    { id: 's5', label: 'Disparado',         color: '#22C55E', order: 4 },
    { id: 's6', label: 'Análise de Dados',  color: '#06B6D4', order: 5 },
  ],
  sla: {
    days:        2,
    label:       '2 dias úteis',
    warningDays: 1,
  },
  // rules removed — use variations with individual SLA instead
  variations: [
    { id: 'v_newsletter_std', name: 'Edição padrão', slaDays: 2 },
  ],
  deliveryStandard: 'Newsletter completa com pauta, redação, design e disparo.',
  nucleos: ['comunicacao'],
};

/* ─── Inicializar tipos padrão do sistema ─────────────────── */
export async function initSystemTaskTypes() {
  const ref  = doc(db, 'task_types', NEWSLETTER_SYSTEM_TYPE.id);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    // Create fresh with new schema
    await setDoc(ref, {
      ...NEWSLETTER_SYSTEM_TYPE,
      createdAt: serverTimestamp(),
      createdBy: 'system',
      updatedAt: serverTimestamp(),
    });
  } else {
    // Migrate: always sync system fields from code
    // This ensures old documents (with sla/rules) get updated to new schema
    const existing = snap.data();
    const needsMigration = existing.rules !== undefined || !existing.variations?.length;
    if (needsMigration) {
      const { rules, sla, ...rest } = existing; // strip deprecated fields
      await setDoc(ref, {
        ...rest,
        // Always overwrite these system fields
        name:             NEWSLETTER_SYSTEM_TYPE.name,
        description:      NEWSLETTER_SYSTEM_TYPE.description,
        icon:             NEWSLETTER_SYSTEM_TYPE.icon,
        color:            NEWSLETTER_SYSTEM_TYPE.color,
        isSystem:         true,
        fields:           NEWSLETTER_SYSTEM_TYPE.fields,
        steps:            NEWSLETTER_SYSTEM_TYPE.steps,
        variations:       NEWSLETTER_SYSTEM_TYPE.variations,
        deliveryStandard: NEWSLETTER_SYSTEM_TYPE.deliveryStandard,
        nucleos:          NEWSLETTER_SYSTEM_TYPE.nucleos,
        scheduleSlots:    existing.scheduleSlots || [], // preserve user-configured slots
        updatedAt:        serverTimestamp(),
        updatedBy:        'system',
      }, { merge: false }); // full overwrite to remove deprecated fields
    }
  }
}

/* ─── Buscar todos os tipos disponíveis para o usuário ────── */
export async function fetchTaskTypes({ workspaceId = null } = {}) {
  const snap = await getDocs(query(collection(db, 'task_types'), orderBy('createdAt', 'asc')));
  let types  = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Tipos globais (workspaceId null) + tipos do workspace atual
  const wsId = workspaceId || store.get('currentWorkspace')?.id;
  types = types.filter(t => !t.workspaceId || t.workspaceId === wsId);

  return types;
}

/* ─── Buscar um tipo por ID ───────────────────────────────── */
export async function getTaskType(typeId) {
  if (!typeId) return null;
  // Checar cache primeiro
  const cached = (store.get('taskTypes') || []).find(t => t.id === typeId);
  if (cached) return injectStepField(cached);
  const snap = await getDoc(doc(db, 'task_types', typeId));
  if (!snap.exists()) return null;
  return injectStepField({ id: snap.id, ...snap.data() });
}

/* ─── Auto-injetar campo currentStep em tipos com steps ──── */
function injectStepField(type) {
  if (!type?.steps?.length) return type;
  const hasStepField = (type.fields||[]).some(f => f.key === 'currentStep');
  if (hasStepField) return type;
  // Não persiste no Firestore — só no uso em memória
  const steps = [...type.steps].sort((a,b)=>a.order-b.order);
  const stepField = {
    id:             'f_current_step',
    key:            'currentStep',
    label:          'Etapa atual',
    type:           'select',
    options:        steps.map(s => s.id), // IDs dos steps
    _stepLabels:    Object.fromEntries(steps.map(s => [s.id, s.label])),
    _stepColors:    Object.fromEntries(steps.map(s => [s.id, s.color])),
    required:       false,
    showInList:     false,
    showInKanban:   false,  // controlado pelo pipeline board
    showInCalendar: false,
    system:         true,   // não aparece no builder
  };
  return { ...type, fields: [...(type.fields||[]), stepField] };
}

/* ─── Criar tipo customizado ──────────────────────────────── */
export async function createTaskType({
  name, description, icon, color,
  categoryId, categoryName,
  nucleos,
  deliveryStandard,
  variations,
  fields, steps,
  scheduleSlots,
  workspaceId,
}) {
  if (!store.can('task_type_create')) throw new Error('Permissão negada.');
  const user = store.get('currentUser');
  const ws   = workspaceId || store.get('currentWorkspace')?.id || null;

  // Validar nome único no workspace
  const existing = await fetchTaskTypes({ workspaceId: ws });
  if (existing.some(t => t.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Já existe um tipo de tarefa com o nome "${name}".`);
  }

  const typeDoc = {
    name:             name.trim(),
    description:      description?.trim() || '',
    icon:             icon  || '📋',
    color:            color || '#6B7280',
    isSystem:         false,
    workspaceId:      ws,
    // Categoria
    categoryId:       categoryId   || null,
    categoryName:     categoryName || '',
    // Núcleos de produção
    nucleos:          Array.isArray(nucleos) ? nucleos : [],
    // Padrão de entrega
    deliveryStandard: deliveryStandard?.trim() || '',
    // Variações (cada uma com nome e SLA próprio)
    variations:       (variations || []).map(v => ({
      id:      v.id || crypto.randomUUID().slice(0,8),
      name:    v.name?.trim() || '',
      slaDays: Number(v.slaDays) || 1,
    })).filter(v => v.name),
    // Campos customizados, esteira e agenda prévia
    fields:           (fields || []).map(f => ({ ...f, id: f.id || crypto.randomUUID() })),
    steps:            (steps  || []).map((s, i) => ({ ...s, id: s.id || crypto.randomUUID(), order: i })),
    scheduleSlots:    (scheduleSlots || []).filter(s => s.title?.trim()).map(s => ({ ...s, id: s.id || crypto.randomUUID().slice(0,8) })),
    createdAt:        serverTimestamp(),
    createdBy:        user.uid,
    updatedAt:        serverTimestamp(),
    updatedBy:        user.uid,
  };

  const ref = await addDoc(collection(db, 'task_types'), typeDoc);
  await auditLog('task_types.create', 'task_type', ref.id, { name });

  const newType = { id: ref.id, ...typeDoc };
  // Atualizar cache
  store.set('taskTypes', [...(store.get('taskTypes') || []), newType]);
  return newType;
}

/* ─── Atualizar tipo ──────────────────────────────────────── */
export async function updateTaskType(typeId, data) {
  if (!store.can('task_type_edit')) throw new Error('Permissão negada.');
  const type = await getTaskType(typeId);
  if (!type) throw new Error('Tipo de tarefa não encontrado.');
  if (type.isSystem && data.name && data.name !== type.name) {
    throw new Error('O nome de tipos do sistema não pode ser alterado.');
  }

  const user = store.get('currentUser');
  const updates = {
    ...data,
    fields: (data.fields || type.fields || []).map(f => ({
      ...f, id: f.id || crypto.randomUUID(),
    })),
    steps: (data.steps || type.steps || []).map((s, i) => ({
      ...s, id: s.id || crypto.randomUUID(), order: i,
    })),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  };

  await updateDoc(doc(db, 'task_types', typeId), updates);
  await auditLog('task_types.update', 'task_type', typeId, { name: data.name });

  // Atualizar cache
  const types = (store.get('taskTypes') || []).map(t =>
    t.id === typeId ? { ...t, ...updates } : t
  );
  store.set('taskTypes', types);
}

/* ─── Excluir tipo ────────────────────────────────────────── */
export async function deleteTaskType(typeId) {
  if (!store.can('task_type_delete')) throw new Error('Permissão negada.');
  const type = await getTaskType(typeId);
  if (!type) throw new Error('Tipo de tarefa não encontrado.');
  if (type.isSystem) throw new Error('Tipos do sistema não podem ser excluídos.');

  await deleteDoc(doc(db, 'task_types', typeId));
  await auditLog('task_types.delete', 'task_type', typeId, { name: type.name });

  store.set('taskTypes', (store.get('taskTypes') || []).filter(t => t.id !== typeId));
}

/* ─── Validar regras de negócio ao criar tarefa ──────────── */
export async function validateTaskTypeRules(typeId, taskData) {
  if (!typeId) return { valid: true };
  const type = await getTaskType(typeId);
  if (!type || !type.rules) return { valid: true };

  const { rules } = type;
  if (!rules.blockDuplicate && !rules.maxPerDay) return { valid: true };

  // Buscar tarefas do mesmo tipo no mesmo dia, no mesmo workspace
  const { fetchTasks } = await import('./tasks.js');
  const wsIds  = taskData.workspaceId ? [taskData.workspaceId] : null;
  const all    = await fetchTasks({ workspaceIds: wsIds });

  const today     = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow  = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

  const targetDate = taskData.startDate
    ? new Date(taskData.startDate)
    : new Date();
  targetDate.setHours(0, 0, 0, 0);
  const targetEnd = new Date(targetDate); targetEnd.setDate(targetEnd.getDate() + 1);

  const sameTypeToday = all.filter(t => {
    if (t.typeId !== typeId && t.type !== type.name.toLowerCase()) return false;
    const tDate = t.startDate?.toDate
      ? t.startDate.toDate()
      : t.startDate ? new Date(t.startDate) : null;
    if (!tDate) return false;
    tDate.setHours(0, 0, 0, 0);
    return tDate.getTime() === targetDate.getTime();
  });

  // Verificar blockDuplicate
  if (rules.blockDuplicate && sameTypeToday.length > 0) {
    return {
      valid:   false,
      error:   `Já existe uma tarefa do tipo "${type.name}" para esse dia neste workspace.`,
      warning: false,
    };
  }

  // Verificar maxPerDay
  if (rules.maxPerDay > 0 && sameTypeToday.length >= rules.maxPerDay) {
    return {
      valid:   false,
      error:   `Limite de ${rules.maxPerDay} tarefa(s) do tipo "${type.name}" por dia atingido.`,
      warning: false,
    };
  }

  // Verificar maxPerDayPerNucleo
  if (rules.maxPerDayPerNucleo > 0 && taskData.customFields?.nucleo) {
    const nucleoId = taskData.customFields.nucleo;
    const sameNucleo = sameTypeToday.filter(t =>
      (t.customFields?.nucleo || t.nucleos?.includes(nucleoId))
    );
    if (sameNucleo.length >= rules.maxPerDayPerNucleo) {
      return {
        valid:   false,
        error:   `Limite de ${rules.maxPerDayPerNucleo} tarefa(s) deste tipo por dia neste núcleo atingido.`,
        warning: false,
      };
    }
  }

  return { valid: true };
}

/* ─── Calcular SLA de uma tarefa ─────────────────────────── */
export function calcSla(typeId, startDate) {
  const types   = store.get('taskTypes') || [];
  const type    = types.find(t => t.id === typeId);
  if (!type?.sla || !startDate) return null;

  const start   = startDate instanceof Date ? startDate : new Date(startDate);
  const due     = new Date(start);
  let   daysAdded = 0;
  let   days    = type.sla.days || 1;

  // Contar apenas dias úteis (seg-sex)
  while (daysAdded < days) {
    due.setDate(due.getDate() + 1);
    const dow = due.getDay();
    if (dow !== 0 && dow !== 6) daysAdded++;
  }

  return {
    dueDate:     due,
    label:       type.sla.label,
    warningDate: new Date(due.getTime() - (type.sla.warningDays || 0) * 24 * 60 * 60 * 1000),
  };
}

/* ─── Carregar tipos no boot ─────────────────────────────── */
export async function loadTaskTypes() {
  try {
    const types = await fetchTaskTypes();
    store.set('taskTypes', types);
    return types;
  } catch(e) {
    console.warn('Could not load task types:', e.message);
    return [];
  }
}
