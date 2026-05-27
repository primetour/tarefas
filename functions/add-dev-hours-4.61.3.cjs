const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.61.3',
  releaseSlug: '20260526-destinations-cross-module-impact-fixes',
  title: 'Destinos — fix cross-module impact (9 consumers afetados + ensureDestination bypass crítico)',
  summary: 'Renê: "de novo, como ficaram outros modulos?". Auditoria 9 consumers de portal_destinations. ' +
           '3 fixes: (1) CRÍTICO ensureDestination (roteiroBank.js) bypassava duplicate check + match só ' +
           'por slug não-aliases + criava sem countryCode v4.59+ → cada save de roteiro do banco podia ' +
           'criar duplicata silenciosa (Cape Town ignorando alias "Cape Town" de Cidade do Cabo). Refactor ' +
           'usa findDestinationByLabel (bate aliases) + schema v4.59+ completo. (2) Pickers cross-module ' +
           'poluídos com 223 pending: passa reviewStatus:approved em portalDashboard count, portalImages ' +
           'picker, portalTipsList, portalTipEditor cascade (3), portalTips (7). Outros (roteiroEditor, ' +
           'destinationsImport, portalImport review, aiActions) mantém all intencional. (3) Bulk imports ' +
           'tratam DUPLICATE como skip: destinationsImport excel mostra "N importado · M já existia" ' +
           'reusando mergeTargetId; portalImport inline catch DUPLICATE → toast info + refaz review.',
  bucket: 'small',
  multiplierIds: ['integration', 'investigation'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 1.5, testes: 0.3, documentacao: 0.4, implantacao: 0.1 },
  module: 'banco-roteiros',
  modules: ['banco-roteiros', 'portal', 'images'],
};
function computeHours(b, mids, ai) {
  const t = Object.values(b).reduce((a, x) => a + x, 0);
  const m = (mids || []).map(id => ({ investigation: .3, migration: .2, pdf: .15, integration: .2, security: .25, pure_refactor: -.2 }[id] || 0)).reduce((a, x) => a + x, 0);
  return t * (1 + m) * ai;
}
(async () => {
  const ex = await db.collection('dev_hours').where('releaseVersion', '==', ENTRY.releaseVersion).limit(1).get();
  if (!ex.empty) { console.log('= skip'); process.exit(0); }
  const h = computeHours(ENTRY.hoursByCategory, ENTRY.multiplierIds, AI_ASSIST);
  const now = FV.serverTimestamp();
  const doc = { entryType: 'release', ...ENTRY, aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE, totalHours: Math.round(h * 100) / 100, totalCost: Math.round(h * HOURLY_RATE * 100) / 100, status: 'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now };
  const ref = await db.collection('dev_hours').add(doc);
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  process.exit(0);
})();
