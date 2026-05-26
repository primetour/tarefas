/**
 * dev_hours v4.57.35 — Sprint Roteiros 2/5: notifs + safety-net approve
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.57.35',
  releaseSlug: '20260525-roteiros-notif-status-collab-approve-safety',
  title: 'Roteiros — sprint 2/5: notif status/collab + safety-net approve',
  summary: 'Continuação sprint Roteiros. R10: updateRoteiroStatus mudava draft/em_revisao/aprovado/' +
           'enviado mas creator+collaborators não recebiam notif (só audit log invisível). Agora notif ' +
           'roteiro.status_change. R11: saveRoteiro com diff de collaboratorIds — novo collaborator ' +
           'recebe notif roteiro.shared. R14: ao abrir editor com status=approved+!tasksGeneratedAt+' +
           '!offline, dispara maybeOfferTaskGeneration após 1.5s — fix degenerated state (crash entre ' +
           'approve+gen, offline→online, restore archived). Pré-requisito infra: whitelist firestore.rules ' +
           'não incluía "roteiro.*" apesar de NOTIF_ICONS já ter — fix regex + deploy rules.',
  bucket: 'small',
  multiplierIds: ['integration', 'security'],
  profile: 'feature',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.8, testes: 0.25, documentacao: 0.3, implantacao: 0.15 },
  module: 'roteiros',
  modules: ['roteiros', 'notifications'],
};
function computeHours(b, mids, ai) { const t=Object.values(b).reduce((a,x)=>a+x,0); const m=(mids||[]).map(id=>({investigation:.3,migration:.2,pdf:.15,integration:.2,security:.25,pure_refactor:-.2}[id]||0)).reduce((a,x)=>a+x,0); return t*(1+m)*ai; }
(async () => {
  const ex = await db.collection('dev_hours').where('releaseVersion','==',ENTRY.releaseVersion).limit(1).get();
  if (!ex.empty) { console.log('= skip'); process.exit(0); }
  const h = computeHours(ENTRY.hoursByCategory, ENTRY.multiplierIds, AI_ASSIST);
  const now = FV.serverTimestamp();
  const doc = { entryType:'release', ...ENTRY, aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE, totalHours: Math.round(h*100)/100, totalCost: Math.round(h*HOURLY_RATE*100)/100, status:'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now };
  const ref = await db.collection('dev_hours').add(doc);
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  process.exit(0);
})();
