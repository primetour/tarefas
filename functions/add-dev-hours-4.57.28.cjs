/**
 * dev_hours v4.57.28 — auditoria integrações Tarefas <-> outros módulos (4 fixes)
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.57.28',
  releaseSlug: '20260525-integrations-cross-module-4-fixes',
  title: 'Tarefas — auditoria integrações cross-module (CSAT, Solicitações): 4 fixes críticos',
  summary: 'Renê pediu: "olhe agora para todas as functions em tarefas que envolvem outros módulos (metas, ' +
           'csat, projetos, squads, calendario de conteudo...)". Agent audit identificou 19 gaps de integração; ' +
           'esta release ataca os 4 críticos. Fix #1: toggleTaskComplete em tasks.js marcava status=done sem ' +
           'chamar triggerCsatOnTaskComplete — bug silencioso desde introdução do CSAT, completar via checkbox ' +
           'kanban/lista NUNCA disparou CSAT. Fix #2: deleteTask deixava request.taskId apontando pra doc ' +
           'inexistente — batch update zera + flag taskDeleted pra portal detectar. Fix #3 (espelho): ' +
           'deleteRequest agora limpa task.requestId + flag requestDeleted. Fix #11: trigger="every" em CSAT ' +
           'estava listado mas early-returnava em !isMilestone — agora dispara fireProjectCsat independente; ' +
           'console.info explícito quando projeto controla CSAT mas task não casa critério (debug antes era ' +
           'impossível). Lição arquitetural generalizada: side-effects entre módulos (task<->request, ' +
           'task<->goal, task<->csat) precisam de cleanup explícito em ambos os lados. Cloud Function ' +
           'onDocumentDeleted seria mais robusto (sobrevive a callers novos).',
  bucket: 'small',
  multiplierIds: ['investigation', 'integration'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.7, testes: 0.3, documentacao: 0.3, implantacao: 0.1 },
  module: 'tasks',
  modules: ['tasks', 'csat', 'requests'],
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
