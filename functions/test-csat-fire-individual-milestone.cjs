/**
 * Dispara CSAT individual + milestone via Microsoft Graph (mesmo
 * caminho da Cloud Function, mas rodando local pra teste rápido).
 *
 * Pré-requisitos:
 *   - 2 tasks de teste já criadas: test_csat_presentation_1 (individual)
 *     e test_csat_milestone_1 + 2 filhas (milestone)
 *   - Graph credentials nos secrets
 *
 * Run:
 *   GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/application_default_credentials.json \
 *   GOOGLE_CLOUD_PROJECT=gestor-de-tarefas-primetour \
 *   node test-csat-fire-individual-milestone.cjs
 */
const admin = require('firebase-admin');
const { execSync } = require('child_process');

admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

function getSecret(name) {
  return execSync(`gcloud secrets versions access latest --secret=${name} --project=gestor-de-tarefas-primetour`, { encoding: 'utf-8' }).trim();
}

async function getGraphToken() {
  const tenantId = getSecret('GRAPH_TENANT_ID');
  const clientId = getSecret('GRAPH_CLIENT_ID');
  const clientSecret = getSecret('GRAPH_CLIENT_SECRET');
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Token fetch ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function sendViaGraph({ to, subject, html }) {
  const token = await getGraphToken();
  const senderId = getSecret('GRAPH_SENDER_ID');
  const url = `https://graph.microsoft.com/v1.0/users/${senderId}/sendMail`;
  const message = {
    subject,
    body: { contentType: 'HTML', content: html },
    toRecipients: [{ emailAddress: { address: to } }],
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  if (!res.ok) throw new Error(`Graph sendMail ${res.status}: ${await res.text()}`);
  console.log(`  ✓ enviado pra ${to}`);
}

function escHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

const PRIMETOUR_LOGO = 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/logos/lazer-alt-1777403810065.webp';

function buildHtml({ surveyId, token, taskTitle, taskList, customMessage, csatMode }) {
  const baseUrl = 'https://primetour.github.io/tarefas/csat-response.html';
  const ctaUrl = `${baseUrl}?id=${encodeURIComponent(surveyId)}&token=${encodeURIComponent(token)}`;

  const heading = csatMode === 'milestone'
    ? `Como avalia este marco?`
    : `Como avalia esta entrega?`;

  const intro = customMessage
    || (csatMode === 'milestone'
      ? `Concluímos um marco importante. Avalie em conjunto as entregas que fazem parte deste fechamento.`
      : `Concluímos a entrega "<strong>${escHtml(taskTitle || '')}</strong>" e gostaríamos da sua opinião.`);

  const tasksHtml = Array.isArray(taskList) && taskList.length > 1
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0F172A" style="background-color:#0F172A;border-radius:10px;margin:0 0 24px;">
         <tr><td style="padding:18px 20px;">
           <div style="font-size:11px;color:#D4A843;margin-bottom:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;">${csatMode === 'milestone' ? 'Entregas neste marco' : taskList.length + ' entregas'}</div>
           <ul style="margin:0;padding:0 0 0 18px;color:#FFFFFF;font-size:14px;line-height:1.7;">
             ${taskList.map(t => `<li style="color:#FFFFFF;">${escHtml(t.title)}</li>`).join('')}
           </ul>
         </td></tr>
       </table>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${heading}</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;border-radius:14px;overflow:hidden;border:1px solid rgba(127,127,127,0.2);">
<tr><td bgcolor="#0F172A" style="padding:32px;background-color:#0F172A;text-align:center;border-bottom:3px solid #D4A843;">
  <img src="${PRIMETOUR_LOGO}" alt="PRIMETOUR" width="200" style="display:inline-block;max-width:200px;height:auto;border:0;outline:none;">
  <div style="margin-top:14px;font-size:11px;color:#D4A843;letter-spacing:0.22em;text-transform:uppercase;font-weight:700;">Pesquisa de Satisfação</div>
</td></tr>
<tr><td style="padding:36px 32px 28px;">
  <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;line-height:1.35;">${heading}</h1>
  <p style="margin:0 0 20px;font-size:15px;line-height:1.65;">${intro}</p>
  ${tasksHtml}
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto 0;">
    <tr><td bgcolor="#D4A843" style="border-radius:10px;background-color:#D4A843;">
      <a href="${ctaUrl}" target="_blank" style="display:inline-block;padding:14px 36px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:10px;">⭐ Avaliar agora</a>
    </td></tr>
  </table>
  <p style="margin:14px 0 0;font-size:11px;text-align:center;line-height:1.55;opacity:0.7;">Ou copie: <a href="${ctaUrl}" style="color:#D4A843;text-decoration:none;word-break:break-all;">${ctaUrl}</a></p>
</td></tr>
<tr><td style="padding:20px 32px 24px;border-top:1px solid rgba(127,127,127,0.15);">
  <p style="margin:0;font-size:12px;line-height:1.6;opacity:0.85;">Email automático após uma entrega concluída. Sua resposta é confidencial.</p>
  <p style="margin:10px 0 0;font-size:10px;opacity:0.6;">© PRIMETOUR Viagens & Experiências</p>
</td></tr>
</table>
</td></tr></table></body></html>`;
}

async function createSurveyAndSend({ taskId, taskIds, csatMode, taskTypeId, customMessage, taskTitle, clientEmail }) {
  // Pega config do tipo
  const typeDoc = await db.doc(`task_types/${taskTypeId}`).get();
  const cfg = typeDoc.data().csatConfig;
  const questions = (cfg.questions || []).map(q => ({
    id: q.id, label: q.label, type: q.type, required: q.required !== false,
  }));

  const surveyRef = db.collection('csat_surveys').doc();
  const surveyToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
  await surveyRef.set({
    taskId,
    taskIds: taskIds || [taskId],
    taskTypeId,
    taskTitle,
    clientEmail,
    clientName: clientEmail.split('@')[0],
    questions,
    responses: {},
    status: 'pending',
    token: surveyToken,
    score: null,
    comment: null,
    customMessage: customMessage || cfg.customMessage,
    csatMode,
    createdBy: 'test-script',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    sentAt: null,
    respondedAt: null,
  });
  console.log(`✓ Survey criado: ${surveyRef.id} (mode=${csatMode})`);

  // Carrega títulos pra HTML
  let taskList = [];
  if (Array.isArray(taskIds) && taskIds.length > 1) {
    for (const tid of taskIds) {
      const td = await db.doc(`tasks/${tid}`).get();
      if (td.exists) taskList.push({ id: tid, title: td.data().title || 'Entrega' });
    }
  }

  const html = buildHtml({
    surveyId: surveyRef.id,
    token: surveyToken,
    taskTitle,
    taskList,
    customMessage: customMessage || cfg.customMessage,
    csatMode,
  });

  const subject = csatMode === 'milestone'
    ? `Avalie o marco: ${taskTitle}`
    : `Como foi a entrega: ${taskTitle}?`;

  await sendViaGraph({ to: clientEmail, subject, html });
  await surveyRef.update({ status: 'sent', sentAt: admin.firestore.FieldValue.serverTimestamp() });
}

(async () => {
  console.log('🧪 Teste de CSAT individual + milestone\n');

  // ── 1. Individual ─────────────────────────────────────
  console.log('1️⃣  CSAT Individual — Apresentação Q2');
  await createSurveyAndSend({
    taskId: 'test_csat_presentation_1',
    taskIds: ['test_csat_presentation_1'],
    csatMode: 'individual',
    taskTypeId: 'test_presentation_csat_individual',
    customMessage: 'Como foi a apresentação? Sua opinião nos ajuda a melhorar.',
    taskTitle: 'Apresentação Q2: Plano Estratégico',
    clientEmail: 'rene.castro@primetour.com.br',
  });

  // ── 2. Milestone ──────────────────────────────────────
  console.log('\n2️⃣  CSAT Milestone — Marco Campanha Verão + 2 filhas');
  await createSurveyAndSend({
    taskId: 'test_csat_milestone_1',
    taskIds: ['test_csat_milestone_1', 'test_csat_milestone_child_1', 'test_csat_milestone_child_2'],
    csatMode: 'milestone',
    taskTypeId: 'test_milestone_csat_project',
    customMessage: 'Como avalia o conjunto de entregas deste marco?',
    taskTitle: 'Marco: Lançamento Campanha Verão 2026',
    clientEmail: 'rene.castro@primetour.com.br',
  });

  console.log('\n✓ Os 2 emails foram disparados pra rene.castro@primetour.com.br');
  process.exit(0);
})().catch(e => { console.error('❌', e); process.exit(1); });
