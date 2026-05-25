/**
 * dev_hours v4.57.12 — 3 bugs encontrados via E2E MCP
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.57.12',
  releaseSlug: '20260525-e2e-bugs-reminder-overdue-esc-fs-pwnew-reset',
  title: 'E2E MCP — 3 bugs descobertos clicando o fluxo real',
  summary: 'Renê pediu validação via MCP. Fiz E2E completo logado como Renê. Confirmados funcionando: edit Step 3 ' +
           '(v4.57.10), squad removido Step 2 (v4.57.8), tela cheia (v4.57.9), notif routing (v4.57.11) — log capturado ' +
           'mostra type=request.updated, recipients=[1 só, coord Marketing]. Mas E2E descobriu 3 bugs novos: (A) Lembrete ' +
           'pra HOJE renderizava "vencido" porque overdue = d < new Date() — d=00:00, new Date()=17h. Fix: overdue = diff<0. ' +
           '(B) Esc na tela cheia também voltava o step do wizard porque _keyHandler global colidia com escHandler do ' +
           'fullscreen. Fix: capture:true + stopImmediatePropagation. (C) "Fazer nova solicitação" no _renderSuccess interno ' +
           'do wizard não resetava editMode/editId nem chamava showNewsletterPrompt — banner Editando persistia + popup ' +
           'newsletter não vinha. Fix: reset completo + novo opt onNewRequest callback exposto pro portal.',
  bucket: 'medium',
  multiplierIds: ['investigation'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.8, testes: 1.5, documentacao: 0.4, implantacao: 0.1 },
  module: 'requests',
  modules: ['requests', 'portal', 'dashboard'],
};

function computeHours(b, multIds, ai) {
  const t = Object.values(b).reduce((a,x)=>a+x,0);
  const m = (multIds||[]).map(id=>({investigation:.3,migration:.2,pdf:.15,integration:.2,security:.25,pure_refactor:-.2}[id]||0)).reduce((a,x)=>a+x,0);
  return t*(1+m)*ai;
}
(async () => {
  const ex = await db.collection('dev_hours').where('releaseVersion','==',ENTRY.releaseVersion).limit(1).get();
  if (!ex.empty) { console.log('= skip'); process.exit(0); }
  const h = computeHours(ENTRY.hoursByCategory, ENTRY.multiplierIds, AI_ASSIST);
  const now = FV.serverTimestamp();
  const doc = {
    entryType:'release', ...ENTRY, aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE,
    totalHours: Math.round(h*100)/100, totalCost: Math.round(h*HOURLY_RATE*100)/100,
    status:'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now,
  };
  const ref = await db.collection('dev_hours').add(doc);
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  process.exit(0);
})();
