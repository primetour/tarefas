/**
 * PRIMETOUR — Requests Service (Fase 4)
 * Solicitações vindas do portal público
 */

import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, orderBy, where, limit, serverTimestamp, onSnapshot,
  getCountFromServer,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }       from '../firebase.js';
import { store }    from '../store.js';
import { auditLog } from '../auth/audit.js';
import { getBtgFirebase } from '../../btg/shared/btg-firebase.js';

/* ─── Solicitações BTG (staging) ──────────────────────────────
 * As "Solicitações de conteúdo e newsletter" geradas pela lista de
 * ofertas BTG são gravadas na coleção `btg_requests_dev` do projeto
 * Firebase de staging (gestor-btg-lp-builder-staging), separado do
 * projeto principal do Gestor. Aqui essas solicitações são mescladas
 * na lista de Solicitações pra ficarem visíveis no módulo de Tarefas.
 *
 * Isolamento: a mescla só acontece em staging/localhost — em produção
 * a página de Solicitações continua lendo só a coleção `requests`. */
const BTG_REQUESTS_COLLECTION = 'btg_requests_dev';
const BTG_REQUESTS_LOCAL_KEY  = 'btg-requests-dev';

function isBtgStagingHost() {
  const h = window.location.hostname;
  return h === 'gestor-btg-lp-builder-staging.web.app'
    || h === 'localhost'
    || h === '127.0.0.1';
}

/** Normaliza qualquer createdAt (Timestamp, {seconds}, ISO string) em ms. */
function requestTimeMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  const t = new Date(ts).getTime();
  return Number.isFinite(t) ? t : 0;
}

/* ─── Acesso à coleção de solicitações BTG (staging) ─────────── */
async function subscribeBtgRequests(callback) {
  try {
    const { db: btgDb, configured } = await getBtgFirebase();
    if (configured && btgDb) {
      const q = query(collection(btgDb, BTG_REQUESTS_COLLECTION), limit(200));
      return onSnapshot(
        q,
        (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data(), _btg: true }))),
        (err) => { console.warn('[requests] snapshot BTG indisponível:', err.code || err.message); callback([]); },
      );
    }
  } catch (e) {
    console.warn('[requests] subscribe BTG falhou:', e.message);
  }
  // Fallback localStorage (Firebase de staging não configurado)
  try {
    const list = JSON.parse(localStorage.getItem(BTG_REQUESTS_LOCAL_KEY) || '[]')
      .map((r) => ({ ...r, _btg: true }));
    callback(list);
  } catch { callback([]); }
  return () => {};
}

async function updateBtgRequest(docId, patch) {
  const data = { ...patch, updatedAt: new Date().toISOString() };
  const { db: btgDb, configured } = await getBtgFirebase();
  if (configured && btgDb) {
    await updateDoc(doc(btgDb, BTG_REQUESTS_COLLECTION, docId), data);
    return;
  }
  const list = JSON.parse(localStorage.getItem(BTG_REQUESTS_LOCAL_KEY) || '[]');
  const i = list.findIndex((r) => r.id === docId);
  if (i >= 0) {
    list[i] = { ...list[i], ...data };
    localStorage.setItem(BTG_REQUESTS_LOCAL_KEY, JSON.stringify(list));
  }
}

async function deleteBtgRequest(docId) {
  const { db: btgDb, configured } = await getBtgFirebase();
  if (configured && btgDb) {
    await deleteDoc(doc(btgDb, BTG_REQUESTS_COLLECTION, docId));
    return;
  }
  const list = JSON.parse(localStorage.getItem(BTG_REQUESTS_LOCAL_KEY) || '[]')
    .filter((r) => r.id !== docId);
  localStorage.setItem(BTG_REQUESTS_LOCAL_KEY, JSON.stringify(list));
}

/* ─── Status de solicitação ──────────────────────────────── */
export const REQUEST_STATUSES = [
  { value: 'pending',   label: 'Aguardando triagem', color: '#F59E0B', icon: '◌' },
  { value: 'converted', label: 'Convertida',         color: '#22C55E', icon: '✓' },
  { value: 'rejected',  label: 'Recusada',           color: '#EF4444', icon: '✕' },
];

export const REQUEST_STATUS_MAP = Object.fromEntries(
  REQUEST_STATUSES.map(s => [s.value, s])
);

/* ─── Criar solicitação (chamado pelo portal público) ────── */
export async function createRequest({
  requesterName, requesterEmail,
  typeId, typeName,
  nucleo, requestingArea,
  sector,
  variationId, variationName,
  outOfCalendar,
  description, urgency,
  isPartnership,
  desiredDate,
}) {
  const reqDoc = {
    requesterName:  requesterName.trim(),
    requesterEmail: requesterEmail.trim().toLowerCase(),
    typeId:         typeId        || null,
    typeName:       typeName      || '',
    nucleo:         nucleo        || '',
    requestingArea: requestingArea|| '',
    sector:         sector        || '',
    variationId:    variationId   || null,
    variationName:  variationName || '',
    outOfCalendar:  outOfCalendar === true,
    isPartnership:  isPartnership === true,
    description:    description.trim(),
    urgency:        urgency === true,
    desiredDate:    desiredDate ? new Date(desiredDate) : null,
    status:         'pending',
    taskId:         null,
    workspaceId:    null,
    assignedTo:     null,
    internalNote:   '',
    rejectionNote:  '',
    createdAt:      serverTimestamp(),
    updatedAt:      serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'requests'), reqDoc);

  // Notify admins/managers about new request
  try {
    const { notify } = await import('./notifications.js');
    const { fetchUsers } = await import('./users.js');
    // Get admin/manager users to notify (cache 5min — economiza reads em alta concorrência)
    const allUsers = await fetchUsers({ active: true });
    const admins = allUsers
      .filter(u => u.isMaster || u.roleId === 'admin' || u.roleId === 'head')
      .map(u => u.id);
    if (admins.length) {
      notify('request.created', {
        entityType: 'request', entityId: ref.id,
        recipientIds: admins,
        title: 'Nova solicitação recebida',
        body: `${requesterName} — ${typeName || 'Solicitação'}${urgency ? ' (URGENTE)' : ''}`,
        route: 'requests',
        category: 'request',
        priority: urgency ? 'high' : 'normal',
      });
    }
  } catch { /* non-blocking */ }

  return { id: ref.id, ...reqDoc };
}

/* ─── Buscar todas as solicitações ───────────────────────── */
export async function fetchRequests({ status = null, limitN = 200 } = {}) {
  let q = query(collection(db, 'requests'), orderBy('createdAt', 'desc'), limit(limitN));
  if (status) q = query(collection(db, 'requests'), where('status', '==', status), orderBy('createdAt', 'desc'), limit(limitN));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ─── Real-time listener ───────────────────────────────────
 * Mescla a coleção `requests` (projeto principal) com as solicitações
 * BTG de staging (`btg_requests_dev`). Em produção só a primeira é lida.
 * Resiliente: se um dos snapshots falhar (ex.: sem auth no staging),
 * ainda entrega o que o outro retornou. */
export function subscribeRequests(callback) {
  let mainReqs = [];
  let btgReqs  = [];
  let stopped  = false;

  const emit = () => {
    if (stopped) return;
    callback([...mainReqs, ...btgReqs].sort(
      (a, b) => requestTimeMs(b.createdAt) - requestTimeMs(a.createdAt),
    ));
  };

  const q = query(collection(db, 'requests'), orderBy('createdAt', 'desc'), limit(200));
  const unsubMain = onSnapshot(
    q,
    (snap) => { mainReqs = snap.docs.map((d) => ({ id: d.id, ...d.data() })); emit(); },
    (err)  => { console.warn('[requests] snapshot principal indisponível:', err.code || err.message); mainReqs = []; emit(); },
  );

  let unsubBtg = () => {};
  if (isBtgStagingHost()) {
    subscribeBtgRequests((list) => { btgReqs = list; emit(); })
      .then((fn) => { if (stopped) fn(); else unsubBtg = fn; });
  }

  return () => { stopped = true; unsubMain(); unsubBtg(); };
}

/* ─── Refresh badge de pendentes (chamado após mudança de status) ── */
async function refreshRequestsBadge() {
  try {
    const count = await countPendingRequests();
    store.set('pendingRequests', count);
    // Atualizar badge na sidebar
    const badge = document.querySelector('[data-route="requests"] .sidebar-badge');
    if (badge) {
      badge.textContent = count > 0 ? (count > 99 ? '99+' : count) : '';
      badge.style.display = count > 0 ? 'flex' : 'none';
    }
  } catch (e) { /* non-blocking */ }
}

/* ─── Atualizar status ───────────────────────────────────────
 * `source === 'btg'` → a solicitação vive na coleção de staging
 * `btg_requests_dev`; grava lá em vez de `requests`. */
export async function updateRequestStatus(reqId, status, extra = {}, source) {
  if (source === 'btg') {
    await updateBtgRequest(reqId, { status, ...extra });
    return;
  }

  const user = store.get('currentUser');
  await updateDoc(doc(db, 'requests', reqId), {
    status,
    ...extra,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
  await auditLog('requests.status', 'request', reqId, { status });

  // Atualizar badge de pendentes imediatamente
  refreshRequestsBadge();
}

/* ─── Converter em tarefa ────────────────────────────────── */
export async function convertToTask(reqId, taskData) {
  const { createTask } = await import('./tasks.js');
  const task = await createTask(taskData);
  await updateRequestStatus(reqId, 'converted', { taskId: task.id });
  await auditLog('requests.convert', 'request', reqId, { taskId: task.id });
  return task;
}

/* ─── Excluir solicitação (admin only) ──────────────────── */
export async function deleteRequest(reqId, source) {
  if (source === 'btg') {
    await deleteBtgRequest(reqId);
    return;
  }
  await deleteDoc(doc(db, 'requests', reqId));
  await auditLog('requests.delete', 'request', reqId, {});
}

/* ─── Contar pendentes (para badge) ─────────────────────────
 * Usa aggregation getCountFromServer: conta no servidor sem baixar docs.
 * Cobra apenas 1 read independentemente do total (ou 0 quando bate cache).
 * Antes (getDocs com limit 99): até 99 reads por chamada.
 */
export async function countPendingRequests() {
  try {
    const agg = await getCountFromServer(query(
      collection(db, 'requests'),
      where('status', '==', 'pending'),
    ));
    return agg.data().count;
  } catch (e) {
    // Fallback (ex.: navegador sem suporte ao aggregation): query leve
    const snap = await getDocs(query(
      collection(db, 'requests'),
      where('status', '==', 'pending'),
      limit(99),
    ));
    return snap.size;
  }
}

/* ─── Notificar solicitante sobre recusa ─────────────────── */
export async function notifyRequesterRejected({ requesterName, requesterEmail, typeName, rejectionReason, requestId }) {
  const { APP_CONFIG } = await import('../config.js');
  const cfg = APP_CONFIG.emailjs;
  if (!cfg?.publicKey || cfg.publicKey === 'SUA_EMAILJS_PUBLIC_KEY') return;

  if (!window.emailjs) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js';
      s.onload = () => { window.emailjs.init(cfg.publicKey); res(); };
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  // Use templateInternal as fallback if no requester template configured
  const templateId = cfg.templateRequester || cfg.templateInternal;
  if (!templateId) return;

  await window.emailjs.send(cfg.serviceId, templateId, {
    to_email:        requesterEmail,
    to_name:         requesterName,
    subject:         `Solicitação recusada: ${typeName}`,
    requester_name:  requesterName,
    type_name:       typeName,
    rejection_reason: rejectionReason || 'Não informado.',
    message:         `Olá ${requesterName}, sua solicitação do tipo "${typeName}" foi analisada pela equipe e não pôde ser aceita neste momento. Motivo: ${rejectionReason || 'Não informado.'}. Em caso de dúvidas, entre em contato com a equipe.`,
  }).catch(e => console.warn('EmailJS rejection notify error:', e));
}

/* ─── Notificar equipe via EmailJS ───────────────────────── */
/* ─── Sugestão de tarefa via IA ──────────────────────────── */
/**
 * Uses AI to analyze a request and suggest task creation fields.
 * Returns { title, description, priority, suggestedTypeId, requestingArea, reasoning }
 */
export async function suggestTaskFromRequest(request) {
  const { getAIConfig } = await import('./ai.js');
  const cfg = await getAIConfig() || {};
  const apiKey = cfg.apiKey || cfg[cfg.provider + 'ApiKey'] || '';
  const provider = cfg.provider || 'groq';

  if (!apiKey) return null;

  // Load available task types for context
  const { fetchTaskTypes } = await import('./taskTypes.js');
  const taskTypes = await fetchTaskTypes().catch(() => []);
  const typesSummary = taskTypes.map(t => `${t.id}: ${t.name} (setor: ${t.sector || 'geral'})`).join('\n');

  const systemPrompt = `Você é um assistente que analisa solicitações internas e sugere como criar uma tarefa.
Tipos de tarefa disponíveis:
${typesSummary}

Analise a solicitação e retorne APENAS JSON válido (sem markdown) com:
{
  "title": "título curto e claro para a tarefa",
  "description": "descrição detalhada baseada na solicitação",
  "priority": "urgent|high|medium|low",
  "suggestedTypeId": "ID do tipo mais adequado ou vazio",
  "requestingArea": "área solicitante se identificável",
  "reasoning": "1 frase explicando sua escolha"
}`;

  const userContent = `Solicitação:
Nome: ${request.requesterName || ''}
Tipo: ${request.typeName || ''}
Área: ${request.requestingArea || ''}
Descrição: ${request.description || ''}
Urgência: ${request.urgency ? 'SIM' : 'não'}
Data desejada: ${request.desiredDate || 'não informada'}`;

  try {
    let url, headers, body;

    if (provider === 'groq') {
      url = 'https://api.groq.com/openai/v1/chat/completions';
      headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
      body = JSON.stringify({ model: cfg.model || 'llama-3.3-70b-versatile', messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ], temperature: 0.2, max_tokens: 500, response_format: { type: 'json_object' } });
    } else if (provider === 'gemini') {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model || 'gemini-2.5-flash'}:generateContent?key=${apiKey}`;
      headers = { 'Content-Type': 'application/json' };
      body = JSON.stringify({ contents: [{ parts: [{ text: systemPrompt + '\n\n' + userContent }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 500, responseMimeType: 'application/json' } });
    } else if (provider === 'openai' || provider === 'azure') {
      const base = provider === 'azure' && cfg.azureEndpoint ? cfg.azureEndpoint : 'https://api.openai.com/v1';
      url = `${base}/chat/completions`;
      headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
      body = JSON.stringify({ model: cfg.model || 'gpt-4o-mini', messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ], temperature: 0.2, max_tokens: 500, response_format: { type: 'json_object' } });
    } else if (provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages';
      headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true' };
      body = JSON.stringify({ model: cfg.model || 'claude-sonnet-4-6', max_tokens: 500,
        system: systemPrompt, messages: [{ role: 'user', content: userContent }] });
    } else {
      return null;
    }

    const resp = await fetch(url, { method: 'POST', headers, body });
    if (!resp.ok) return null;
    const data = await resp.json();

    let jsonText = '';
    if (provider === 'gemini') {
      jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else if (provider === 'anthropic') {
      jsonText = data.content?.[0]?.text || '';
    } else {
      jsonText = data.choices?.[0]?.message?.content || '';
    }

    jsonText = jsonText.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(jsonText);
  } catch (e) {
    console.warn('[AI] Request suggestion failed:', e);
    return null;
  }
}

export async function notifyTeamByEmail({ requesterName, requesterEmail, typeName, nucleo, urgency, requestId }) {
  const { APP_CONFIG } = await import('../config.js');
  const cfg = APP_CONFIG.emailjs;
  if (!cfg.publicKey || cfg.publicKey === 'SUA_EMAILJS_PUBLIC_KEY') return;
  if (!cfg.templateInternal) return;

  // Load EmailJS
  if (!window.emailjs) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js';
      s.onload = () => { window.emailjs.init(cfg.publicKey); res(); };
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  await window.emailjs.send(cfg.serviceId, cfg.templateInternal, {
    to_email:        cfg.fromEmail,
    subject:         `${urgency ? '🔴 URGENTE — ' : ''}Nova solicitação: ${typeName}`,
    requester_name:  requesterName,
    requester_email: requesterEmail,
    type_name:       typeName,
    nucleo,
    urgency:         urgency ? 'Sim — marcada como urgente' : 'Não',
    request_url:     `${window.location.origin}/tarefas/#requests?id=${requestId}`,
  }).catch(e => console.warn('EmailJS notify error:', e));
}
