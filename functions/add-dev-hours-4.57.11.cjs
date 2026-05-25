/**
 * dev_hours v4.57.11 — auditoria + fix de roteamento de notif de edição
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.57.11',
  releaseSlug: '20260525-portal-edit-notify-routing',
  title: 'Portal — auditoria de notif edit: roteamento dirigido (assignees/observers/coords)',
  summary: 'Renê: "ta funcionando na camada do sistema principal, com aviso de alteracao? pra quais users ta ' +
           'indo o aviso? pra todos do setor? se eu atualizo a tarefa e destino um ou mais responsaveis, ' +
           'acrescendo observador... o aviso de alteracao continua indo pro setor todo?". Auditoria via agente ' +
           'descobriu 3 bugs: (1) edit chamava notify(request.created) pra todos admins globais (spam de outros ' +
           'setores), (2) updateDoc(tasks/{id}, requesterEditFlag:true) não disparava notif — assignees/observers ' +
           'só viam banner ao abrir, (3) _notifyTeam email recebia isEdit:true mas backend não diferenciava. ' +
           'Fix: roteamento novo. CREATE mantém _notifyAdmins. EDIT+taskId chama _notifyTaskOnRequesterEdit ' +
           '(notify task.requesterEdit só pra assignees+observers via Set dedup, exclui ator). EDIT pending chama ' +
           '_notifySectorCoordsOnEdit (notify request.updated só pra coords do setor; fallback admins se setor ' +
           'sem coord). Email pulado em edit. +getDoc import. +2 funções (~100 LOC). Garantias: ator não recebe ' +
           'self-notif, dedup assignees+observers, route/category/priority corretos.',
  bucket: 'medium',
  multiplierIds: ['investigation', 'security'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.5, desenvolvimento: 1.5, testes: 0.5, documentacao: 0.4, implantacao: 0.1 },
  module: 'requests',
  modules: ['requests', 'portal', 'notifications', 'tasks'],
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
    entryType:'release', ...ENTRY,
    aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE,
    totalHours: Math.round(h*100)/100, totalCost: Math.round(h*HOURLY_RATE*100)/100,
    status:'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now,
  };
  const ref = await db.collection('dev_hours').add(doc);
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  process.exit(0);
})();
