/**
 * dev_hours v4.57.46 — Banco de Imagens 3/5: perf category counts cache (I8)
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.57.46',
  releaseSlug: '20260525-banco-imagens-perf-category-counts-cache',
  title: 'Banco de Imagens — sprint 3/5: cache _categoryCounts entre trocas de pill (I8)',
  summary: 'I8: cada click em pill de categoria (Todas/Destinos/Logos/...) invalidava _categoryCounts ' +
           'e re-fetchava 1000 docs pra recalcular contadores. MAS contadores são globais — não mudam ' +
           'ao trocar pill. Fix mínimo: param loadImages({preserveCounts: true}) usado só no pill click. ' +
           'Outros callers (uploader/date filter, upload/delete success) continuam invalidando. Economia: ' +
           '~4000 reads salvos por user/sessão. I10 (allImages cache) descartado — já é estado em memória, ' +
           'sem re-fetch sem reset:true. Problema real era só I8.',
  bucket: 'small',
  multiplierIds: ['pure_refactor'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.4, testes: 0.1, documentacao: 0.3, implantacao: 0.1 },
  module: 'images',
  modules: ['images'],
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
