/**
 * dev_hours v4.57.30 — cleanup órfãos em 3 deletes (project/workspace/taskType)
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.57.30',
  releaseSlug: '20260525-delete-orphan-cleanup-project-workspace-tasktype',
  title: 'Sistema — cleanup tasks órfãs em 3 deletes (project/workspace/taskType)',
  summary: 'Extensão sistemática do padrão v4.57.28/29 pra 3 deletes que deixavam tasks órfãs ' +
           'silenciosamente. deleteProject(force=true) e deleteWorkspace(force=true): UI já avisava ' +
           '"vínculos ficarão órfãos" mas FK ficava apontando pra doc inexistente — filtros perdiam, ' +
           'agrupadores quebravam, store.getActiveWorkspaceIds excluía a task do view porque ID não ' +
           'casava squad real. Workspace tem 2 passes: tasks.workspaceId (zera) + projects.workspaceIds[] ' +
           '(arrayRemove, mantém demais squads multi-squad). deleteTaskType: pior caso, zero guard E ' +
           'zero cleanup antes — regras (blockDuplicate/maxPerDay), SLA do tipo, filtros e badge UI ' +
           'todos quebravam. Cleanup preserva typeDeletedName pra UI mostrar "ex-tipo: X". Padrão ' +
           'consolidado em CLAUDE.md §12.n: query inversa + batch 500 + null FK + flag xxxDeleted + ' +
           'timestamp + preservar metadata útil + try/catch defensivo. Cloud Function ' +
           'onDocumentDeleted segue sendo a meta de longo prazo.',
  bucket: 'small',
  multiplierIds: ['integration'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.7, testes: 0.2, documentacao: 0.3, implantacao: 0.1 },
  module: 'tasks',
  modules: ['tasks', 'projects', 'workspaces', 'task-types'],
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
