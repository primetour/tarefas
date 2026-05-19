/**
 * PRIMETOUR — CSAT Service (Etapa 4)
 * Gestão de pesquisas de satisfação via EmailJS
 */

import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, where, orderBy, limit, serverTimestamp, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }       from '../firebase.js';
import { store }    from '../store.js';
import { APP_CONFIG } from '../config.js';
import { auditLog } from '../auth/audit.js';

/* ─── Helpers ────────────────────────────────────────────── */
const uid = () => store.get('currentUser')?.uid || null;
const userName = () => store.get('userProfile')?.name || store.get('currentUser')?.email || 'Sistema';

/* ─── Constants ──────────────────────────────────────────── */
export const CSAT_STATUS = {
  pending:   { label: 'Aguardando envio',  color: '#6B7280' },
  sent:      { label: 'Enviado',           color: '#38BDF8' },
  responded: { label: 'Respondido',        color: '#22C55E' },
  expired:   { label: 'Expirado',          color: '#EF4444' },
  cancelled: { label: 'Cancelado',         color: '#94A3B8' },
};

export const SCORE_LABELS = {
  1: { label: 'Muito insatisfeito', emoji: '😞', color: '#EF4444' },
  2: { label: 'Insatisfeito',       emoji: '😕', color: '#F97316' },
  3: { label: 'Neutro',             emoji: '😐', color: '#F59E0B' },
  4: { label: 'Satisfeito',         emoji: '🙂', color: '#22C55E' },
  5: { label: 'Muito satisfeito',   emoji: '😄', color: '#16A34A' },
};

// EmailJS removido do client. Envio agora vai por Cloud Function
// `sendCsatEmail` que mantém os secrets no Secret Manager (Google Cloud).
// Antes: SDK do EmailJS rodava no browser com publicKey/serviceId no
// config.js commitado em git → qualquer um abusava da conta.
// Vide functions/index.js sendCsatEmail.

/* ─── Criar survey ───────────────────────────────────────── */
/**
 * 4.31+ Aceita opcionalmente `taskTypeId` para snapshot do `csatConfig`
 * (perguntas + custom message). Se ausente ou tipo sem CSAT habilitado,
 * usa modelo legado (1 pergunta padrão).
 */
export async function createCsatSurvey({
  taskId,
  taskIds      = null,   // 4.32+ Milestone/periodic: covers vários taskIds
  taskTitle,
  taskTypeId   = null,
  projectId    = null,
  projectName  = null,
  clientEmail,
  clientName   = '',
  assignedTo   = null,   // uid do responsável principal
  customMessage = '',
}) {
  if (!store.can('csat_send')) throw new Error('Permissão negada.');
  const user = store.get('currentUser');
  if (!clientEmail) throw new Error('E-mail do cliente é obrigatório.');

  // 4.31+ Snapshot do csatConfig do tipo (se habilitado)
  let questionsSnapshot = [];
  let csatMode = 'individual';
  let resolvedCustomMessage = customMessage;
  if (taskTypeId) {
    const types = store.get('taskTypes') || [];
    const t = types.find(tt => tt.id === taskTypeId);
    const cfg = t?.csatConfig;
    if (cfg && cfg.enabled && Array.isArray(cfg.questions) && cfg.questions.length) {
      questionsSnapshot = cfg.questions.map(q => ({
        id: q.id, label: q.label, type: q.type || 'score',
        required: q.required !== false,
      }));
      csatMode = cfg.mode || 'individual';
      if (!resolvedCustomMessage && cfg.customMessage) resolvedCustomMessage = cfg.customMessage;
    }
  }

  const workspace = store.get('currentWorkspace');
  // 4.32+ Normalizar taskIds: se passado, usa; senão fallback pra [taskId]
  const finalTaskIds = Array.isArray(taskIds) && taskIds.length
    ? [...new Set(taskIds.filter(Boolean))]
    : (taskId ? [taskId] : []);
  const surveyDoc = {
    workspaceId:  workspace?.id || null,
    taskId,            // back-compat: primeiro taskId (ou único)
    taskIds:      finalTaskIds, // 4.32+ Milestone: lista completa
    taskTypeId,
    taskTitle:    taskTitle || 'Tarefa',
    projectId,
    projectName,
    clientEmail:  clientEmail.trim().toLowerCase(),
    clientName:   clientName.trim() || clientEmail.split('@')[0],
    assignedTo,
    customMessage: resolvedCustomMessage,
    status:       'pending',
    // Legado (single): score + comment. Mantido pra back-compat.
    score:        null,
    comment:      null,
    // 4.31+ Multi-pergunta. Vazio = single-question flow.
    questions:    questionsSnapshot,
    responses:    {}, // { [questionId]: value }
    csatMode,
    token:        generateToken(),
    createdAt:    serverTimestamp(),
    createdBy:    user.uid,
    sentAt:       null,
    respondedAt:  null,
    expiresAt:    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 dias
  };

  const ref = await addDoc(collection(db, 'csat_surveys'), surveyDoc);
  await auditLog('csat.create', 'survey', ref.id, { taskId, clientEmail, multiQ: questionsSnapshot.length });
  return { id: ref.id, ...surveyDoc };
}

/* ─── Enviar e-mail (via Cloud Function — Microsoft Graph, 4.34.14+) ──── */
export async function sendCsatEmail(surveyId) {
  const snap = await getDoc(doc(db, 'csat_surveys', surveyId));
  if (!snap.exists()) throw new Error('Pesquisa não encontrada.');

  // 4.34.14+ A Cloud Function agora monta HTML server-side a partir do
  // doc da survey. Cliente só precisa passar o surveyId.
  try {
    const { app } = await import('../firebase.js');
    const fb = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
    const fn = fb.httpsCallable(fb.getFunctions(app, 'us-central1'), 'sendCsatEmail');
    await fn({ surveyId });
  } catch (err) {
    const msg = err?.message || JSON.stringify(err);
    throw new Error(`Falha ao enviar e-mail: ${msg}`);
  }

  // Marcar como enviado
  await updateDoc(doc(db, 'csat_surveys', surveyId), {
    status:  'sent',
    sentAt:  serverTimestamp(),
  });
  await auditLog('csat.send', 'survey', surveyId, { clientEmail: survey.clientEmail });

  return survey;
}

/* ─── Registrar resposta (multi-pergunta 4.31+) ──────────── */
/**
 * Aceita 2 modos:
 *   - Legado (single):  { score: 1-5, comment: '...' }
 *   - Multi (4.31+):    { responses: { [questionId]: value } }
 *
 * Para multi, calcula um `score` derivado (média dos scores das perguntas
 * type=score) — preserva back-compat com listagem que olha `score`.
 */
export async function respondCsatSurvey(surveyId, payload = {}) {
  // Fetch survey data before updating to get recipient info + questions snapshot
  const surveySnap = await getDoc(doc(db, 'csat_surveys', surveyId));
  if (!surveySnap.exists()) throw new Error('Pesquisa não encontrada.');
  const surveyData = surveySnap.data();

  const questions = Array.isArray(surveyData.questions) ? surveyData.questions : [];
  const isMulti = questions.length > 0;

  let updates;
  let scoreForAudit;
  if (isMulti) {
    // Multi-pergunta: payload.responses = { [qId]: value }
    const responses = payload.responses || {};
    // Valida required
    for (const q of questions) {
      if (!q.required) continue;
      const v = responses[q.id];
      if (q.type === 'score' && (!v || v < 1 || v > 5)) {
        throw new Error(`Pergunta obrigatória sem nota: "${q.label}"`);
      }
      if (q.type === 'text' && (!v || !String(v).trim())) {
        throw new Error(`Pergunta obrigatória sem resposta: "${q.label}"`);
      }
      if (q.type === 'yesno' && (v !== 'yes' && v !== 'no')) {
        throw new Error(`Pergunta obrigatória sem resposta: "${q.label}"`);
      }
    }
    // Score derivado: média dos scores
    const scoreVals = questions
      .filter(q => q.type === 'score')
      .map(q => responses[q.id])
      .filter(v => Number.isFinite(v) && v >= 1 && v <= 5);
    const avgScore = scoreVals.length
      ? Math.round(scoreVals.reduce((s,v)=>s+v,0) / scoreVals.length)
      : null;
    updates = {
      responses,
      score: avgScore, // back-compat
      // Comment derivado: concatena respostas type=text (não obrigatórias entram só se preenchidas)
      comment: questions
        .filter(q => q.type === 'text')
        .map(q => {
          const v = (responses[q.id] || '').toString().trim();
          return v ? `[${q.label}] ${v}` : '';
        })
        .filter(Boolean)
        .join('\n\n'),
      status:      'responded',
      respondedAt: serverTimestamp(),
    };
    scoreForAudit = avgScore;
  } else {
    // Legado: single score + comment
    const { score, comment = '' } = payload;
    if (!score || score < 1 || score > 5) throw new Error('Nota inválida (1–5).');
    updates = {
      score,
      comment: String(comment || '').trim(),
      status: 'responded',
      respondedAt: serverTimestamp(),
    };
    scoreForAudit = score;
  }

  await updateDoc(doc(db, 'csat_surveys', surveyId), updates);
  await auditLog('csat.respond', 'survey', surveyId, { score: scoreForAudit, multiQ: isMulti });

  const score = scoreForAudit;

  // Notify assignee + creator
  const recipients = [surveyData.assignedTo, surveyData.createdBy].filter(Boolean);
  if (recipients.length) {
    import('./notifications.js').then(({ notify }) => {
      const type = score <= 2 ? 'csat.low_score' : 'csat.responded';
      notify(type, {
        entityType: 'csat_survey', entityId: surveyId,
        recipientIds: recipients,
        title: score <= 2 ? 'CSAT crítico recebido' : 'Resposta CSAT recebida',
        body: `${surveyData.clientName || 'Cliente'} avaliou com ${'★'.repeat(score)}${comment ? ': ' + comment.slice(0, 60) : ''}`,
        route: 'csat',
        category: 'csat',
        priority: score <= 2 ? 'high' : 'normal',
      });
    }).catch(() => {});
  }
}

/* ─── Buscar survey por token ────────────────────────────── */
export async function getSurveyByToken(token) {
  const q = query(
    collection(db, 'csat_surveys'),
    where('token', '==', token),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

/* ─── Listar surveys ─────────────────────────────────────── */
export async function fetchSurveys({ limitN = 100, status = null, taskId = null, workspaceIds = null } = {}) {
  let q = query(
    collection(db, 'csat_surveys'),
    orderBy('createdAt', 'desc'),
    limit(limitN)
  );
  if (taskId) q = query(q, where('taskId', '==', taskId));

  const snap = await getDocs(q);
  let surveys = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Filtro por workspace — documentos sem workspaceId visíveis para todos
  const activeIds = workspaceIds ?? store.getActiveWorkspaceIds();
  if (activeIds) {
    surveys = surveys.filter(s => !s.workspaceId || activeIds.includes(s.workspaceId));
  }

  if (status) surveys = surveys.filter(s => s.status === status);
  return surveys;
}

/* ─── Real-time listener ─────────────────────────────────── */
export function subscribeSurveys(callback) {
  const q = query(
    collection(db, 'csat_surveys'),
    orderBy('createdAt', 'desc'),
    limit(200)
  );
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

/* ─── Excluir survey permanentemente ─────────────────────── */
export async function deleteCsatSurvey(surveyId) {
  // 4.49.10+ SECURITY: bloqueia delete sem csat_manage.
  if (!store.isMaster?.() && !store.can('csat_manage')) {
    throw new Error('Você não tem permissão para excluir pesquisas CSAT.');
  }
  await deleteDoc(doc(db, 'csat_surveys', surveyId));
  await auditLog('csat.delete', 'survey', surveyId, {});
}

/* ─── Cancelar survey ────────────────────────────────────── */
export async function cancelSurvey(surveyId) {
  // 4.49.10+ SECURITY: cancelar é mudança destrutiva; requer csat_manage.
  if (!store.isMaster?.() && !store.can('csat_manage')) {
    throw new Error('Você não tem permissão para cancelar pesquisas CSAT.');
  }
  await updateDoc(doc(db, 'csat_surveys', surveyId), { status: 'cancelled' });
  await auditLog('csat.cancel', 'survey', surveyId, {});
}

/* ─── Reenviar survey ────────────────────────────────────── */
export async function resendSurvey(surveyId) {
  // 4.49.10+ SECURITY: reenvio requer csat_send (mesma perm de enviar pela 1ª vez).
  if (!store.isMaster?.() && !store.can('csat_send')) {
    throw new Error('Você não tem permissão para reenviar pesquisas CSAT.');
  }
  await updateDoc(doc(db, 'csat_surveys', surveyId), {
    status:    'pending',
    sentAt:    null,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  return sendCsatEmail(surveyId);
}

/* ─── Métricas CSAT ──────────────────────────────────────── */
export function calcCsatMetrics(surveys) {
  const responded = surveys.filter(s => s.status === 'responded' && s.score);
  const total     = surveys.length;
  const sent      = surveys.filter(s => ['sent','responded'].includes(s.status)).length;

  if (!responded.length) {
    return { avg: 0, nps: 0, total, sent, responded: 0, responseRate: 0, distribution: {} };
  }

  const avg = responded.reduce((a, s) => a + s.score, 0) / responded.length;

  // NPS-style: promotores (4-5) - detratores (1-2)
  const promoters  = responded.filter(s => s.score >= 4).length;
  const detractors = responded.filter(s => s.score <= 2).length;
  const nps        = Math.round(((promoters - detractors) / responded.length) * 100);

  // Distribuição: scores podem ser decimais (média de várias perguntas).
  // Agrupa por bucket arredondado — 4.5 conta no bucket 5.
  const distribution = {};
  for (let i = 1; i <= 5; i++) {
    distribution[i] = responded.filter(s => Math.round(s.score) === i).length;
  }

  return {
    avg:          Math.round(avg * 10) / 10,
    nps,
    total,
    sent,
    responded:    responded.length,
    responseRate: sent ? Math.round((responded.length / sent) * 100) : 0,
    distribution,
    promoters,
    detractors,
    neutrals:     responded.length - promoters - detractors,
  };
}

/* ─── Auto-disparo ao concluir tarefa ────────────────────── */
/**
 * 4.35+ Decide quem controla o CSAT desta tarefa:
 *  1. Se a task pertence a um projeto com csatConfig.enabled=true,
 *     o projeto OVERRIDE — task NÃO dispara CSAT individual.
 *     - Exceção: se trigger='custom_milestones' e task.isMilestone=true,
 *       dispara CSAT do projeto cobrindo as tarefas do intervalo.
 *  2. Caso contrário, fluxo legado (clientEmail-based individual CSAT).
 */
export async function triggerCsatOnTaskComplete(task) {
  // Override por projeto
  if (task.projectId) {
    try {
      const { getProject } = await import('./projects.js');
      const project = await getProject(task.projectId);
      if (project?.csatConfig?.enabled) {
        const trigger = project.csatConfig.trigger || 'on_close';
        if (trigger === 'custom_milestones' && task.isMilestone) {
          return fireProjectCsat(project, { reason: 'milestone', triggerTaskId: task.id });
        }
        // projeto controla — esse evento não dispara
        return null;
      }
    } catch (e) {
      console.warn('[CSAT] project override check failed:', e?.message || e);
    }
  }

  // Fluxo legado: task com clientEmail → individual CSAT
  if (!task.clientEmail) return null;
  const existing = await fetchSurveys({ taskId: task.id, limitN: 1 });
  if (existing.length) return null;

  const survey = await createCsatSurvey({
    taskId:       task.id,
    taskTitle:    task.title,
    projectId:    task.projectId,
    clientEmail:  task.clientEmail,
    clientName:   task.clientName || '',
    assignedTo:   task.assignees?.[0] || null,
  });

  const delayMs = (APP_CONFIG.csat.delayHours || 1) * 60 * 60 * 1000;
  if (delayMs <= 0) await sendCsatEmail(survey.id);

  return survey;
}

/* ─── 4.35+ Disparo de CSAT no nível do projeto ─────────────
 * Coleta tarefas elegíveis (concluídas desde o último disparo, ou todas
 * se nunca disparou), cria 1 survey modo 'milestone' com taskIds[],
 * envia, e atualiza project.lastCsatFiredAt.
 *
 * @param {Object} project - documento completo do projeto (com .csatConfig)
 * @param {Object} opts
 * @param {'close'|'milestone'|'manual'} opts.reason
 * @param {string} [opts.triggerTaskId] - id da task que disparou (custom_milestones)
 */
export async function fireProjectCsat(project, { reason, triggerTaskId = null } = {}) {
  const cfg = project?.csatConfig;
  if (!cfg?.enabled) throw new Error('CSAT do projeto não está habilitado.');
  if (!cfg.clientEmail) throw new Error('E-mail do cliente não configurado no CSAT do projeto.');

  // Janela: tarefas concluídas com completedAt > project.lastCsatFiredAt
  const lastFired = project.lastCsatFiredAt?.toDate
    ? project.lastCsatFiredAt.toDate()
    : (project.lastCsatFiredAt ? new Date(project.lastCsatFiredAt) : null);

  const tasksSnap = await getDocs(query(
    collection(db, 'tasks'),
    where('projectId', '==', project.id),
    where('status', '==', 'done'),
  ));

  const eligibleTasks = tasksSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(t => {
      if (!t.completedAt) return false;
      const completed = t.completedAt?.toDate ? t.completedAt.toDate() : new Date(t.completedAt);
      if (lastFired && completed <= lastFired) return false;
      return true;
    });

  if (!eligibleTasks.length) {
    throw new Error('Nenhuma tarefa elegível (nada concluído desde o último disparo).');
  }

  // Resolve perguntas: do tipo selecionado ou customizado
  let questions = [];
  if (cfg.questionsSource === 'task_type' && cfg.taskTypeId) {
    const types = store.get('taskTypes') || [];
    const t = types.find(tt => tt.id === cfg.taskTypeId);
    if (t?.csatConfig?.questions?.length) {
      questions = t.csatConfig.questions.map(q => ({
        id: q.id, label: q.label, type: q.type || 'score',
        required: q.required !== false,
      }));
    }
  } else if (cfg.questionsSource === 'custom' && Array.isArray(cfg.questions)) {
    questions = cfg.questions.map(q => ({
      id: q.id, label: q.label, type: q.type || 'score',
      required: q.required !== false,
    }));
  }
  // Fallback: pergunta única padrão (legacy)
  if (!questions.length) {
    questions = [{ id: 'q1', label: 'Como avalia o trabalho entregue?', type: 'score', required: true }];
  }

  const user = store.get('currentUser');
  const taskIds = eligibleTasks.map(t => t.id);
  const subjectTitle = reason === 'close'
    ? `Marco final: ${project.name}`
    : reason === 'milestone'
      ? `Marco do projeto: ${project.name}`
      : `Avaliação: ${project.name}`;

  // Cria survey modo 'milestone' (cobre vários taskIds)
  const surveyDoc = {
    workspaceId:  project.workspaceId || null,
    taskId:       triggerTaskId || taskIds[0],
    taskIds,
    taskTypeId:   cfg.taskTypeId || null,
    taskTitle:    subjectTitle,
    projectId:    project.id,
    projectName:  project.name,
    clientEmail:  cfg.clientEmail.trim().toLowerCase(),
    clientName:   cfg.clientEmail.split('@')[0],
    assignedTo:   null,
    customMessage: cfg.customMessage || '',
    status:       'pending',
    score:        null,
    comment:      null,
    questions,
    responses:    {},
    csatMode:     'milestone',
    csatTrigger:  reason, // 'close' | 'milestone' | 'manual'
    token:        generateToken(),
    createdAt:    serverTimestamp(),
    createdBy:    user?.uid || 'system',
    sentAt:       null,
    respondedAt:  null,
    expiresAt:    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };

  const ref = await addDoc(collection(db, 'csat_surveys'), surveyDoc);
  await auditLog('csat.project_fire', 'survey', ref.id, {
    projectId: project.id, reason, taskCount: taskIds.length,
  });

  // Envia o e-mail via Cloud Function
  await sendCsatEmail(ref.id).catch(e => {
    console.warn('[CSAT] project fire — sendCsatEmail falhou:', e?.message || e);
  });

  // Marca o lastCsatFiredAt no projeto e (se milestone) marca a task disparadora
  await updateDoc(doc(db, 'projects', project.id), {
    lastCsatFiredAt: serverTimestamp(),
  });
  if (triggerTaskId) {
    await updateDoc(doc(db, 'tasks', triggerTaskId), {
      csatFiredAt: serverTimestamp(),
    }).catch(() => {});
  }

  return { id: ref.id, ...surveyDoc, taskIds };
}

/* ─── 4.35+ Disparo manual (botão "Disparar CSAT agora") ──── */
export async function fireProjectCsatManual(projectId) {
  if (!store.can('csat_send')) throw new Error('Permissão negada.');
  const { getProject } = await import('./projects.js');
  const project = await getProject(projectId);
  if (!project) throw new Error('Projeto não encontrado.');
  return fireProjectCsat(project, { reason: 'manual' });
}

/* ─── Mapa de surveys por taskId (para cruzamento com tarefas) */
export async function fetchSurveyMapByTaskIds(taskIds = []) {
  if (!taskIds.length) return {};
  // Firestore 'in' query supports max 30 items per call
  const map = {};
  const chunks = [];
  for (let i = 0; i < taskIds.length; i += 30) chunks.push(taskIds.slice(i, i + 30));
  const results = await Promise.all(chunks.map(chunk =>
    getDocs(query(
      collection(db, 'csat_surveys'),
      where('taskId', 'in', chunk)
    ))
  ));
  for (const snap of results) {
    for (const d of snap.docs) {
      const data = { id: d.id, ...d.data() };
      if (!map[data.taskId]) map[data.taskId] = [];
      map[data.taskId].push(data);
    }
  }
  return map;
}

/* ─── Envio em lote (digest): agrupa por e-mail do cliente ── */
export async function sendBulkCsat(tasks, { customMessage = '', sendNow = true } = {}) {
  if (!store.can('csat_send')) throw new Error('Permissão negada.');

  // Agrupa tarefas por e-mail do cliente
  const byEmail = {};
  for (const task of tasks) {
    const email = (task.clientEmail || '').trim().toLowerCase();
    if (!email) continue;
    if (!byEmail[email]) byEmail[email] = { email, name: task.clientName || email.split('@')[0], tasks: [] };
    byEmail[email].tasks.push(task);
  }

  const groups = Object.values(byEmail);
  if (!groups.length) throw new Error('Nenhuma tarefa com e-mail de cliente.');

  const results = { created: 0, sent: 0, skipped: 0, errors: [] };

  for (const group of groups) {
    // Cria um survey por tarefa (cada uma precisa de nota individual)
    const surveyIds = [];
    for (const task of group.tasks) {
      // Verifica se já existe survey para esta tarefa
      const existing = await fetchSurveys({ taskId: task.id, limitN: 1 });
      if (existing.length) { results.skipped++; continue; }

      const survey = await createCsatSurvey({
        taskId:       task.id,
        taskTitle:    task.title,
        projectId:    task.projectId,
        projectName:  task.projectName || '',
        clientEmail:  group.email,
        clientName:   group.name,
        customMessage,
        assignedTo:   task.assignees?.[0] || null,
      });
      surveyIds.push(survey.id);
      results.created++;
    }

    if (!surveyIds.length) continue;

    // Envia UM e-mail digest para este cliente com todas as tarefas
    if (sendNow) {
      try {
        if (surveyIds.length === 1) {
          await sendCsatEmail(surveyIds[0]);
        } else {
          await sendDigestEmail(group, surveyIds);
        }
        results.sent++;
      } catch(e) {
        results.errors.push({ email: group.email, error: e.message });
      }
    }
  }

  return results;
}

/* ─── E-mail digest: múltiplas tarefas em 1 e-mail ────────── */
async function sendDigestEmail(group, surveyIds) {
  const cfg = APP_CONFIG.emailjs;
  if (!cfg.publicKey || cfg.publicKey.startsWith('SUA_')) {
    throw new Error('EmailJS não configurado.');
  }

  const ejs = await loadEmailJS();
  const origin   = APP_CONFIG.csat.baseUrl || window.location.origin;
  const basePath = window.location.pathname.replace(/\/[^/]*$/, '');

  // Carrega os surveys criados em PARALELO (era sequencial → 1 read por survey,
  // viranva N requests serializados em digests com 10+ surveys).
  const surveysSnaps = await Promise.all(
    surveyIds.map(id => getDoc(doc(db, 'csat_surveys', id)))
  );
  const surveys = surveysSnaps
    .filter(snap => snap.exists())
    .map(snap => ({ id: snap.id, ...snap.data() }));

  // URL digest: page shows all surveys for this client
  const digestToken = surveys[0]?.token || '';
  const digestUrl   = `${origin}${basePath}/csat-response.html?digest=${group.email}&token=${digestToken}`;

  // Monta lista de tarefas em HTML para o template
  const taskListHtml = surveys.map((s, i) => {
    const url = `${origin}${basePath}/csat-response.html?token=${s.token}&id=${s.id}`;
    return `${i + 1}. ${s.taskTitle}`;
  }).join(' | ');

  const params = {
    to_email:       group.email,
    to_name:        group.name,
    task_title:     `${surveys.length} entregas para avaliar`,
    project_name:   surveys[0]?.projectName || 'PRIMETOUR',
    custom_message: surveys[0]?.customMessage || `Concluímos ${surveys.length} tarefas para você! Avalie cada uma delas — leva menos de 1 minuto.`,
    survey_url:     digestUrl,
    score_1_url:    digestUrl,
    score_2_url:    digestUrl,
    score_3_url:    digestUrl,
    score_4_url:    digestUrl,
    score_5_url:    digestUrl,
    task_list:      taskListHtml,
    brand_color:    APP_CONFIG.csat.brandColor || 'D4A843',
    from_name:      APP_CONFIG.csat.fromName   || 'PRIMETOUR',
    year:           new Date().getFullYear(),
  };

  await ejs.send(cfg.serviceId, cfg.templateCsat, params);

  // Marcar todos como enviados
  for (const s of surveys) {
    await updateDoc(doc(db, 'csat_surveys', s.id), {
      status: 'sent',
      sentAt: serverTimestamp(),
      digestGroup: group.email,
    });
  }
  await auditLog('csat.send_digest', 'survey', surveyIds[0], {
    clientEmail: group.email, count: surveys.length,
  });
}

/* ─── Buscar tarefas pendentes de CSAT (para automação) ───── */
export async function findTasksWithoutCsat({ periodDays = 30 } = {}) {
  const since = new Date();
  since.setDate(since.getDate() - periodDays);

  // Busca TODAS as tarefas concluídas no período (com ou sem e-mail)
  const { fetchTasks } = await import('./tasks.js');
  const tasks = await fetchTasks();
  const doneTasks = tasks.filter(t => {
    if (t.status !== 'done') return false;
    // Tenta usar completedAt, updatedAt ou createdAt como referência
    const ref = t.completedAt || t.updatedAt || t.createdAt;
    if (!ref) return true; // Sem data = inclui (pode ser tarefa antiga)
    const date = ref?.toDate ? ref.toDate() : new Date(ref);
    return date >= since;
  });

  if (!doneTasks.length) return [];

  // Busca surveys existentes para essas tarefas
  const taskIds = doneTasks.map(t => t.id);
  const existingMap = await fetchSurveyMapByTaskIds(taskIds);

  // Retorna apenas tarefas que ainda não têm CSAT
  return doneTasks.filter(t => !existingMap[t.id]?.length);
}

/* ─── Helper: token único ────────────────────────────────── */
function generateToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map(b => b.toString(16).padStart(2,'0')).join('');
}

/* ════════════════════════════════════════════════════════════
   4.32+ F2 — CSAT periódico (modo `periodic` em taskType.csatConfig)
   ──────────────────────────────────────────────────────────────
   Sem Cloud Function: dispara client-side no boot do app.
   Estratégia:
   - Para cada taskType com csatConfig.mode='periodic' e enabled=true
   - Verifica se hoje é o `dayOfWeek` configurado E se ainda não rodamos
     pra esse período (chave: '<typeId>:<period-window-id>')
   - Coleta todas as tarefas done daquele tipo na janela do período,
     agrupadas por clientEmail
   - Cria 1 csat_survey por cliente com taskIds = [...todas as done]
   - Marca o run em localStorage pra evitar disparos duplicados na sessão

   Caveat: cliente fica responsável por abrir o app pra disparar. Pra
   produção, o ideal é Cloud Function cron — F2.1 numa próxima.
   ════════════════════════════════════════════════════════════ */

const PERIODIC_RUN_KEY = 'csat-periodic-runs';

function periodWindowId(period, dayOfWeek = 5) {
  // Identifica a janela atual do período. Ex: weekly = 'YYYY-WNN'
  const now = new Date();
  if (period === 'monthly') {
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  }
  if (period === 'biweekly') {
    // 2 janelas/mês: dias 1-15 e 16-fim
    const half = now.getDate() <= 15 ? 'a' : 'b';
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${half}`;
  }
  // weekly: ISO week
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2,'0')}`;
}

function periodWindowStart(period, now = new Date()) {
  // Início da janela atual (pra filtrar tarefas done dentro dela)
  if (period === 'monthly') {
    return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  }
  if (period === 'biweekly') {
    const day = now.getDate() <= 15 ? 1 : 16;
    return new Date(now.getFullYear(), now.getMonth(), day, 0, 0, 0);
  }
  // weekly: segunda-feira da semana atual
  const d = new Date(now);
  const dayOfWeek = d.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * 4.34.12+ Computa a chave do bolsão atual para um tipo periodic.
 * Format: "pending:periodic:{typeId}:{winId}"
 *   pending = aguardando envio
 *   sent    = já enviado (após trigger)
 * Usado pra marcar task.csatPool ao concluir tarefa do tipo periodic.
 *
 * @param {string} typeId
 * @param {Object} csatConfig
 * @returns {string} ex: 'pending:periodic:nl:2026-W19'
 */
export function computePeriodicPoolKey(typeId, csatConfig) {
  const winId = periodWindowId(csatConfig.period, csatConfig.dayOfWeek);
  return `pending:periodic:${typeId}:${winId}`;
}

/**
 * 4.34.12+ Lista tarefas aguardando entrar em algum bolsão (csatPool=pending:*)
 * Agrupa por bolsão. Cada bolsão = 1 entry com {typeId, winId, tasks[]}.
 * Usado pela aba "Aguardando envio" no /csat.
 *
 * @returns {Promise<Array<{poolKey, typeId, typeName, winId, period, dayOfWeek, timeOfDay, tasks: Task[], byClient: {email: tasks[]}}>>}
 */
export async function listPendingCsatPools() {
  const tasksMod = await import('./tasks.js');
  const allTasks = await tasksMod.fetchTasks();
  const taskTypes = store.get('taskTypes') || [];

  // 4.35+ Override: tasks em projetos com csatConfig.enabled NÃO entram em bolsão
  const projsMod = await import('./projects.js');
  const allProjs = await projsMod.fetchProjects().catch(() => []);
  const projsWithCsat = new Set(
    (allProjs || []).filter(p => p?.csatConfig?.enabled).map(p => p.id)
  );

  const byPool = {};
  for (const task of allTasks) {
    if (!task.csatPool) continue;
    if (!task.csatPool.startsWith('pending:periodic:')) continue;
    if (task.status !== 'done') continue;
    if (task.projectId && projsWithCsat.has(task.projectId)) continue; // override
    if (!byPool[task.csatPool]) byPool[task.csatPool] = [];
    byPool[task.csatPool].push(task);
  }

  return Object.entries(byPool).map(([poolKey, tasks]) => {
    const [, , typeId, winId] = poolKey.split(':');
    const t = taskTypes.find(tt => tt.id === typeId);
    const cfg = t?.csatConfig || {};
    // Agrupa por cliente
    const byClient = {};
    tasks.forEach(task => {
      if (!task.clientEmail) return;
      const email = String(task.clientEmail).toLowerCase();
      if (!byClient[email]) byClient[email] = [];
      byClient[email].push(task);
    });
    return {
      poolKey,
      typeId,
      typeName: t?.name || typeId,
      winId,
      period: cfg.period || 'weekly',
      dayOfWeek: cfg.dayOfWeek ?? 5,
      timeOfDay: cfg.timeOfDay || '09:00',
      cfg,
      tasks,
      byClient,
      clientCount: Object.keys(byClient).length,
      noEmailCount: tasks.filter(t => !t.clientEmail).length,
    };
  }).sort((a, b) => a.winId.localeCompare(b.winId));
}

/**
 * Processa todos os tipos com modo periodic. Chamado no boot do app
 * (auth.js após login) — silencioso, async, não bloqueia.
 * Também chamável manualmente (botão "Disparar agora" no /csat).
 *
 * 4.34.12+ Mudanças:
 * - Usa task.csatPool em vez de filtrar por completedAt (mais preciso, idempotente)
 * - Lock atômico via Firestore doc csat_periodic_runs/{typeId}_{winId}
 * - Ao final, marca tarefas como sent:periodic:{...} pra não pegar de novo
 *
 * @param {Object} opts
 * @param {boolean} [opts.force]  ignora dia/hora (manual)
 * @param {string}  [opts.poolKey] dispara só este bolsão específico
 *
 * Retorna { processed: N, surveys: [...] }
 */
export async function runPeriodicCsatTrigger(opts = {}) {
  // Permissão flexibilizada em 4.34.12: qualquer user logado pode disparar,
  // mas createCsatSurvey ainda verifica permissão server-side via Firestore rules.
  try {
    const taskTypes = store.get('taskTypes') || [];
    const periodicTypes = taskTypes.filter(t =>
      t.csatConfig?.enabled && t.csatConfig?.mode === 'periodic'
    );
    if (!periodicTypes.length) return { processed: 0, surveys: [] };

    const now = new Date();
    const todayDow = now.getDay();
    const created = [];

    // Tarefas done com csatPool=pending (uma vez só, reutiliza pra cada tipo)
    const tasksMod = await import('./tasks.js');
    const allTasks = await tasksMod.fetchTasks();

    // 4.35+ Override: tasks em projetos com csatConfig.enabled NÃO disparam periodic
    const projsMod = await import('./projects.js');
    const allProjs = await projsMod.fetchProjects().catch(() => []);
    const projsWithCsat = new Set(
      (allProjs || []).filter(p => p?.csatConfig?.enabled).map(p => p.id)
    );

    for (const t of periodicTypes) {
      const cfg = t.csatConfig;
      const winId = periodWindowId(cfg.period, cfg.dayOfWeek);
      const poolKey = `pending:periodic:${t.id}:${winId}`;

      // Filtro por bolsão (se opts.poolKey foi passado, ignora outros)
      if (opts.poolKey && opts.poolKey !== poolKey) continue;

      // Time gate (a menos que force OU manual via poolKey específico)
      if (!opts.force && !opts.poolKey) {
        if (cfg.dayOfWeek !== todayDow) continue;
        // Se passou da hora configurada
        const [hh, mm] = (cfg.timeOfDay || '09:00').split(':').map(Number);
        const target = new Date(now);
        target.setHours(hh, mm, 0, 0);
        if (now < target) continue;
      }

      // Lock atômico via Firestore — primeiro user/cron a chegar ganha
      const runDocRef = doc(db, 'csat_periodic_runs', `${t.id}_${winId}`);
      try {
        const existing = await getDoc(runDocRef);
        if (existing.exists() && !opts.force) continue; // já rodou
        // Cria lock ANTES de processar pra evitar race condition
        await setDoc(runDocRef, {
          typeId: t.id,
          winId,
          poolKey,
          startedAt: serverTimestamp(),
          startedBy: { uid: uid(), name: userName() },
          status: 'processing',
        }, { merge: false });
      } catch (lockErr) {
        // Outro processo já criou o doc no race window — pula
        console.log('[csat-periodic] lock conflict, outro processo está rodando:', t.id, winId);
        continue;
      }

      // Coleta tasks com csatPool == poolKey
      // 4.35+ Pula tasks em projetos com CSAT ativo (projeto controla)
      const candidates = allTasks.filter(task =>
        task.csatPool === poolKey
        && task.status === 'done'
        && task.clientEmail
        && !(task.projectId && projsWithCsat.has(task.projectId))
      );

      if (!candidates.length) {
        // Lock fica ativo mas marca como vazio
        await updateDoc(runDocRef, {
          status: 'empty',
          finishedAt: serverTimestamp(),
          surveysCreated: 0,
        }).catch(() => {});
        continue;
      }

      // Agrupa por clientEmail
      const byClient = {};
      candidates.forEach(task => {
        const email = String(task.clientEmail).toLowerCase();
        if (!byClient[email]) byClient[email] = [];
        byClient[email].push(task);
      });

      // Cria 1 survey por cliente, marca tarefas como sent
      const labelTpl = cfg.periodLabel || `${t.name} · ${winId}`;
      const sentPoolKey = `sent:periodic:${t.id}:${winId}`;
      const fb = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      for (const [email, tasks] of Object.entries(byClient)) {
        try {
          const survey = await createCsatSurvey({
            taskId: tasks[0].id, // back-compat
            taskIds: tasks.map(x => x.id),
            taskTypeId: t.id,
            taskTitle: `${labelTpl} (${tasks.length} entrega${tasks.length>1?'s':''})`,
            projectId: tasks[0].projectId || null,
            projectName: tasks[0].projectName || null,
            clientEmail: email,
            clientName: tasks[0].clientName || email.split('@')[0],
            assignedTo: (tasks[0].assignees||[])[0] || null,
            customMessage: cfg.customMessage || `Avalie as entregas desta ${cfg.period === 'weekly' ? 'semana' : cfg.period === 'biweekly' ? 'quinzena' : 'período'}.`,
          });
          await sendCsatEmail(survey.id);
          created.push(survey);
          // Marca cada tarefa: csatPool=sent + csatSurveyId
          await Promise.all(tasks.map(task =>
            fb.updateDoc(fb.doc(db, 'tasks', task.id), {
              csatPool: sentPoolKey,
              csatSurveyId: survey.id,
              csatSentAt: serverTimestamp(),
            }).catch(e => console.warn('[csat-periodic] mark task failed:', task.id, e.message))
          ));
        } catch (e) {
          console.warn('[csat-periodic] failed for', email, t.name, e.message);
        }
      }

      // Finaliza lock
      await updateDoc(runDocRef, {
        status: 'done',
        finishedAt: serverTimestamp(),
        surveysCreated: created.length,
        clientsCount: Object.keys(byClient).length,
        tasksCount: candidates.length,
      }).catch(() => {});
    }

    // Mantém localStorage como cache adicional pra evitar re-fetch (idempotência cross-session já é via Firestore)
    if (created.length) {
      console.log(`[csat-periodic] ${created.length} survey${created.length>1?'s':''} criada${created.length>1?'s':''}`);
    }
    return { processed: periodicTypes.length, surveys: created };
  } catch (e) {
    console.warn('[csat-periodic] erro geral:', e.message);
    return { processed: 0, surveys: [], error: e.message };
  }
}
