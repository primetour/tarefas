/**
 * dev_hours v4.57.42 — Sprint Portal de Dicas 4/5: CFs agendadas
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.57.42',
  releaseSlug: '20260525-portal-dicas-cf-cron-images-orphan-tips-stale',
  title: 'Portal de Dicas — sprint 4/5: 2 CFs agendadas (PD10 imagens órfãs + PD11 tips stale 90d)',
  summary: 'PD10: portalImagesOrphanCleanupCron (segundas 7h BRT). Pre-fetch refs em portal_tips + ' +
           'portal_destinations + roteiros, scan portal_images cap 1000, classifica orphans. Primeira ' +
           'deteccao: flag unused + timestamp. Após 30d: hard delete doc + marker em ' +
           'portal_images_pending_r2_delete (CF sem cred R2 — script offline limpa). PD11: ' +
           'portalTipsStaleCheckCron (segundas 8h BRT). Scan portal_tips updatedAt < now-90d (exclui ' +
           'archived), flag staleSince, notif sumária semanal pra curadores (portal_manage OU ' +
           'portal_tips_manage). Dedup deterministic ID por YYYY-Www. E2E trigger manual: "nenhuma ' +
           'tip stale" (correto, sistema novo). 2 CFs novas (~210 linhas).',
  bucket: 'small',
  multiplierIds: ['integration'],
  profile: 'feature',
  hoursByCategory: { refinamento: 0.5, desenvolvimento: 1.4, testes: 0.3, documentacao: 0.4, implantacao: 0.2 },
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
