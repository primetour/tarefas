/**
 * PRIMETOUR — CSAT Service (Etapa 4)
 * Gestão de pesquisas de satisfação via EmailJS
 */

import {
  collection, doc, addDoc, updateDoc, getDoc, getDocs,
  query, where, orderBy, limit, serverTimestamp, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }       from '../firebase.js';
import { store }    from '../store.js';
import { APP_CONFIG } from '../config.js';
import { auditLog } from '../auth/audit.js';

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

/* ─── EmailJS loader ─────────────────────────────────────── */
let _emailjsLoaded = false;
async function loadEmailJS() {
  if (window.emailjs) return window.emailjs;
  if (_emailjsLoaded) return window.emailjs;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js';
    s.onload = () => {
      _emailjsLoaded = true;
      window.emailjs.init(APP_CONFIG.emailjs.publicKey);
      resolve(window.emailjs);
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/* ─── Criar survey ───────────────────────────────────────── */
export async function createCsatSurvey({
  taskId,
  taskTitle,
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

  const workspace = store.get('currentWorkspace');
  const surveyDoc = {
    workspaceId:  workspace?.id || null,
    taskId,
    taskTitle:    taskTitle || 'Tarefa',
    projectId,
    projectName,
    clientEmail:  clientEmail.trim().toLowerCase(),
    clientName:   clientName.trim() || clientEmail.split('@')[0],
    assignedTo,
    customMessage,
    status:       'pending',
    score:        null,
    comment:      null,
    token:        generateToken(),
    createdAt:    serverTimestamp(),
    createdBy:    user.uid,
    sentAt:       null,
    respondedAt:  null,
    expiresAt:    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 dias
  };

  const ref = await addDoc(collection(db, 'csat_surveys'), surveyDoc);
  await auditLog('csat.create', 'survey', ref.id, { taskId, clientEmail });
  return { id: ref.id, ...surveyDoc };
}

/* ─── Enviar e-mail ──────────────────────────────────────── */
export async function sendCsatEmail(surveyId) {
  const snap = await getDoc(doc(db, 'csat_surveys', surveyId));
  if (!snap.exists()) throw new Error('Pesquisa não encontrada.');
  const survey = { id: snap.id, ...snap.data() };

  const cfg = APP_CONFIG.emailjs;
  if (!cfg.publicKey || cfg.publicKey.startsWith('SUA_')) {
    throw new Error('EmailJS não configurado. Configure as credenciais em js/config.js.');
  }

  const ejs = await loadEmailJS();

  // Aponta direto para csat-response.html (página pública, sem autenticação)
  const origin    = APP_CONFIG.csat.baseUrl || window.location.origin;
  const basePath  = window.location.pathname.replace(/\/[^/]*$/, '');
  const surveyUrl = `${origin}${basePath}/csat-response.html?token=${survey.token}&id=${surveyId}`;

  // Template params (customize os nomes conforme seu template EmailJS)
  const params = {
    to_email:      survey.clientEmail,
    to_name:       survey.clientName,
    task_title:    survey.taskTitle,
    project_name:  survey.projectName || 'PRIMETOUR',
    custom_message: survey.customMessage || 'Sua tarefa foi concluída! Gostaríamos de saber sua opinião.',
    survey_url:    surveyUrl,
    score_1_url:   `${surveyUrl}&score=1`,
    score_2_url:   `${surveyUrl}&score=2`,
    score_3_url:   `${surveyUrl}&score=3`,
    score_4_url:   `${surveyUrl}&score=4`,
    score_5_url:   `${surveyUrl}&score=5`,
    brand_color:   APP_CONFIG.csat.brandColor || 'D4A843',
    from_name:     APP_CONFIG.csat.fromName   || 'PRIMETOUR',
    year:          new Date().getFullYear(),
  };

  await ejs.send(cfg.serviceId, cfg.templateCsat, params);

  // Marcar como enviado
  await updateDoc(doc(db, 'csat_surveys', surveyId), {
    status:  'sent',
    sentAt:  serverTimestamp(),
  });
  await auditLog('csat.send', 'survey', surveyId, { clientEmail: survey.clientEmail });

  return survey;
}

/* ─── Registrar resposta ─────────────────────────────────── */
export async function respondCsatSurvey(surveyId, { score, comment = '' }) {
  if (!score || score < 1 || score > 5) throw new Error('Nota inválida (1–5).');

  await updateDoc(doc(db, 'csat_surveys', surveyId), {
    score,
    comment:     comment.trim(),
    status:      'responded',
    respondedAt: serverTimestamp(),
  });
  await auditLog('csat.respond', 'survey', surveyId, { score });
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

/* ─── Cancelar survey ────────────────────────────────────── */
export async function cancelSurvey(surveyId) {
  await updateDoc(doc(db, 'csat_surveys', surveyId), { status: 'cancelled' });
  await auditLog('csat.cancel', 'survey', surveyId, {});
}

/* ─── Reenviar survey ────────────────────────────────────── */
export async function resendSurvey(surveyId) {
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

  const distribution = {};
  for (let i = 1; i <= 5; i++) {
    distribution[i] = responded.filter(s => s.score === i).length;
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
export async function triggerCsatOnTaskComplete(task) {
  // Só dispara se a tarefa tiver e-mail do cliente configurado
  if (!task.clientEmail) return null;
  const existing = await fetchSurveys({ taskId: task.id, limitN: 1 });
  if (existing.length) return null; // Já existe uma survey para esta tarefa

  const survey = await createCsatSurvey({
    taskId:       task.id,
    taskTitle:    task.title,
    projectId:    task.projectId,
    clientEmail:  task.clientEmail,
    clientName:   task.clientName || '',
    assignedTo:   task.assignees?.[0] || null,
  });

  // Enviar com delay configurável
  const delayMs = (APP_CONFIG.csat.delayHours || 1) * 60 * 60 * 1000;
  if (delayMs <= 0) {
    await sendCsatEmail(survey.id);
  }
  // (se delayHours > 0, o envio é feito por um job externo ou manualmente)

  return survey;
}

/* ─── Mapa de surveys por taskId (para cruzamento com tarefas) */
export async function fetchSurveyMapByTaskIds(taskIds = []) {
  if (!taskIds.length) return {};
  // Firestore 'in' query supports max 30 items per call
  const map = {};
  const chunks = [];
  for (let i = 0; i < taskIds.length; i += 30) chunks.push(taskIds.slice(i, i + 30));
  for (const chunk of chunks) {
    const snap = await getDocs(query(
      collection(db, 'csat_surveys'),
      where('taskId', 'in', chunk)
    ));
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

  // Carrega os surveys criados para montar a lista
  const surveys = [];
  for (const id of surveyIds) {
    const snap = await getDoc(doc(db, 'csat_surveys', id));
    if (snap.exists()) surveys.push({ id: snap.id, ...snap.data() });
  }

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
