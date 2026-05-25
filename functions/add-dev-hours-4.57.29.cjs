/**
 * dev_hours v4.57.29 — follow-up integrações (#5 subtask + cleanup calendar)
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.57.29',
  releaseSlug: '20260525-integrations-followup-subtask-advance-calendar',
  title: 'Tarefas — follow-up integrações (#5 subtask auto-advance + cleanup content_calendar)',
  summary: 'Sequência da v4.57.28. Fix #5: subtask auto-advance em taskModal mostrava toast "status ' +
           'movido para Em Revisão" mas só alterava o select no DOM. Fechar modal sem Salvar = status ' +
           'voltava; toast mentia. Fix: isEdit + updateTask({status:suggested}) + rollback do DOM se ' +
           'persist falhar. Toast em create mode deixa explícito que aplica ao salvar. Fix integração ' +
           'estendido pro content_calendar: deleteTask agora limpa slots com taskId apontando pra task ' +
           'deletada (batch update zera taskId + flag taskDeleted). Antes, slot mostrava "Sem tarefa" ' +
           'silenciosamente (subscribeToTasksByIds filtrava ID inexistente sem warning). Princípio ' +
           'reforçado: toda relação one-way (slot→task, request→task) precisa cleanup quando destino ' +
           'é deletado. Cloud Function onDocumentDeleted continua sendo o padrão mais robusto.',
  bucket: 'small',
  multiplierIds: ['integration'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.4, testes: 0.15, documentacao: 0.2, implantacao: 0.05 },
  module: 'tasks',
  modules: ['tasks', 'content-calendar'],
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
