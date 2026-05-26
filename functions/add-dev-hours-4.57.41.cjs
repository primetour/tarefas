/**
 * dev_hours v4.57.41 — Sprint Portal de Dicas 3/5: race conditions
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.57.41',
  releaseSlug: '20260525-portal-dicas-race-export-import-upload',
  title: 'Portal de Dicas — sprint 3/5: race conditions (PD7 import + PD8 export + PD9 upload)',
  summary: 'PD7: import PDF anti-double-submit. Flag _portalImportInFlight em runImport — evita parse ' +
           'duplo se user clicar 2x ou confirmModal disparar callback 2x. PD8: export anti-double-submit ' +
           'no generateTip. Map _genInFlight por (tipId+format) TTL 30s — permite formatos paralelos ' +
           '(PDF+DOCX OK), bloqueia mesma combo. Espelho R8 (Roteiros v4.57.36). PD9: upload em lote no ' +
           'portalImages anti-double-submit. Flag _uploadBatchInFlight — 2 cliques rapidos faziam ' +
           '2 Promise.all paralelos = duplicatas R2 + dobro de banda. PD14 (listeners cleanup) removido ' +
           'do escopo — grep confirmou 0 listeners globais em portalTipEditor (todos container-scoped).',
  bucket: 'small',
  multiplierIds: ['integration'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.7, testes: 0.15, documentacao: 0.25, implantacao: 0.1 },
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
