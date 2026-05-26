/**
 * dev_hours v4.57.31 — cleanup órfãos goals + csat surveys (sprint final)
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.57.31',
  releaseSlug: '20260525-delete-orphan-cleanup-goal-csat',
  title: 'Sistema — cleanup órfãos em deleteGoal + deleteCsatSurvey (sprint cleanup final)',
  summary: 'Completa o ciclo iniciado em v4.57.28. deleteGoal(force=true): v4.57.25 introduziu check + ' +
           'force mas quando forçado deixava tasks com metaLinks apontando pra meta fantasma. metaLinks ' +
           'é array de objetos {goalId, metaId} — não dá pra arrayRemove direto. Read-modify-write: ' +
           'scan 500, filtra array, batch update + flag goalDeleted. Espelho legado tasks.goalId ' +
           '(aponta pro 1o link) reescrito pro novo 1o ou zerado. deleteCsatSurvey: tasks com ' +
           'csatSurveyId ficavam com chip "Pesquisa enviada" fantasma; relinks/reenvios falhavam. ' +
           'Cleanup batch + flag. csatPool preservado pra histórico. Sprint cleanup completa (v4.57.28 ' +
           '→ 31): 8 caminhos de cleanup em FKs cross-collection (task/request/calendar/project/' +
           'workspace/tasktype/goal/csat). Padrão consolidado: query inversa + batch limit 500 + null ' +
           'FK + flag xxxDeleted + xxxDeletedAt + preservar metadata útil + try/catch defensivo.',
  bucket: 'small',
  multiplierIds: ['integration'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.5, testes: 0.15, documentacao: 0.3, implantacao: 0.05 },
  module: 'tasks',
  modules: ['tasks', 'goals', 'csat'],
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
