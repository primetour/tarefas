/**
 * PRIMETOUR — Requests Service (Fase 4)
 * Solicitações vindas do portal público
 */

import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, orderBy, where, limit, serverTimestamp, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }       from '../firebase.js';
import { store }    from '../store.js';
import { auditLog } from '../auth/audit.js';

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
    // Get admin/manager users to notify
    const usersSnap = await getDocs(query(collection(db, 'users'), where('active', '==', true), limit(500)));
    const admins = usersSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => u.active !== false && (u.isMaster || u.roleId === 'admin' || u.roleId === 'head'))
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

/* ─── Real-time listener ─────────────────────────────────── */
export function subscribeRequests(callback) {
  const q = query(collection(db, 'requests'), orderBy('createdAt', 'desc'), limit(200));
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
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

/* ─── Atualizar status ───────────────────────────────────── */
export async function updateRequestStatus(reqId, status, extra = {}) {
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
export async function deleteRequest(reqId) {
  await deleteDoc(doc(db, 'requests', reqId));
  await auditLog('requests.delete', 'request', reqId, {});
}

/* ─── Contar pendentes (para badge) ─────────────────────── */
export async function countPendingRequests() {
  const snap = await getDocs(query(
    collection(db, 'requests'),
    where('status', '==', 'pending'),
    limit(99),
  ));
  return snap.size;
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
