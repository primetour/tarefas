/**
 * dev_hours v4.57.39 — Sprint Portal de Dicas 1/5: cleanup FK
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.57.39',
  releaseSlug: '20260525-portal-dicas-cleanup-fk-area-dest-tip-image',
  title: 'Portal de Dicas — sprint 1/5: cleanup FK em deleteArea/Destination/Tip/ImageMeta',
  summary: 'Inicia sprint Portal de Dicas (5 releases planejadas) espelhando padrão consolidado em ' +
           'Tarefas v4.57.28-31 + Roteiros v4.57.34. PD1: deleteArea limpa portal_destinations.areaId. ' +
           'PD2: deleteDestination limpa em 2 passes (portal_tips.destinationId + portal_images.' +
           'destinationId). PD3: deleteTip limpa roteiros.embeddedTips[] (read-modify-write, marca ' +
           'tipDeleted preserva snapshot - complemento de onPortalTipUpdated v4.57.37 R13 que só cobria ' +
           'updates). PD4: deleteImageMeta limpa em 2 passes (portal_destinations.heroImage.imageId + ' +
           'portal_tips.segments[].items[].image.imageId via scan). Total: 10 caminhos de cleanup FK ' +
           'cross-collection adicionados ao módulo. Padrão: query inversa + batch 500 + null FK + flag ' +
           'xxxDeleted + timestamp + preservar metadata útil (nome/label/título) + try/catch defensivo.',
  bucket: 'small',
  multiplierIds: ['integration'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.9, testes: 0.2, documentacao: 0.3, implantacao: 0.15 },
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
