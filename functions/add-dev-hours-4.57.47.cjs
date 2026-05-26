/**
 * dev_hours v4.57.47 — Banco de Imagens 4/5: UX lightbox + upload progress
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.57.47',
  releaseSlug: '20260525-banco-imagens-ux-lightbox-guard-upload-progress',
  title: 'Banco de Imagens — sprint 4/5: I15 lightbox guard + I17 upload progress per-file',
  summary: 'I15: handleLightboxKey era global em document. Edit modal aberto sobre lightbox = ' +
           'ArrowLeft/Right navegavam galeria atrás. Fix: early return se #img-edit-modal existe. ' +
           'I17: upload mostrava "enviando..." travado 5-30s. Agora uploadImageToR2 aceita callback ' +
           'opcional onProgress. Sem callback: fetch (compat 100%). Com callback: XHR com upload.' +
           'onprogress calcula pct. uploadBatch passa callback que atualiza statusEl "WebP X MB — Y%" ' +
           'em tempo real. onerror/ontimeout mapeados pra Error.',
  bucket: 'small',
  multiplierIds: ['integration'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.7, testes: 0.15, documentacao: 0.3, implantacao: 0.1 },
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
