/**
 * dev_hours v4.57.40 — Sprint Portal de Dicas 2/5: conflict + notifs
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.57.40',
  releaseSlug: '20260525-portal-dicas-conflict-notifs-status-destination',
  title: 'Portal de Dicas — sprint 2/5: conflict detection (PD5) + notifs granulares (PD12+PD13)',
  summary: 'PD5: conflict detection multi-aba/multi-user no editor de tips — espelho R5 (Roteiros ' +
           'v4.57.36). Editor marca _loadedAt no load, passa expectedUpdatedAt no save. saveTip ' +
           're-fetcha + compara (tolerância 1s). Throw CONFLICT, modal.confirm "Recarregar / Cancelar". ' +
           'PD12: notifs tip_created expandidas pra portal_manage OU portal_tips_manage (antes só ' +
           'hardcoded isMaster/admin/head). Status change detect prevStatus != data.status dispara ' +
           'tip_status_changed separado. PD13: notif destination_added pra portal_destinations_manage ' +
           'OU portal_manage — resolve assimetria com saveTip (curador criava destinos silenciosamente).',
  bucket: 'small',
  multiplierIds: ['integration'],
  profile: 'feature',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.9, testes: 0.2, documentacao: 0.3, implantacao: 0.1 },
  module: 'portal',
  modules: ['portal'],
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
