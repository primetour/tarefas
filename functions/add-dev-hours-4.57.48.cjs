/**
 * dev_hours v4.57.48 — Banco de Imagens 5/5 (final): polish
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.57.48',
  releaseSlug: '20260525-banco-imagens-polish-cascade-refresh-after-upload',
  title: 'Banco de Imagens — sprint 5/5 (final): polish I24 + descarte I21/I23',
  summary: 'I24: cascade allDests stale após upload — fix recarrega fetchDestinations antes do ' +
           'loadImages. Try/catch defensivo. I21 (Unsplash quota global) descartado — cooldown ' +
           'proativo já existe em functions/index.js:2639 (60min após rate limit hit). I23 (CSP inline ' +
           'handlers) descartado — sistema sem CSP strict. Sprint Banco de Imagens FECHADA (5 releases, ' +
           '8 fixes implementados + 4 falsos positivos descartados após verificação no código). I1 ' +
           '(R2 token security) fica pra próxima release dedicada com validação E2E.',
  bucket: 'small',
  multiplierIds: ['pure_refactor'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.3, testes: 0.1, documentacao: 0.4, implantacao: 0.1 },
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
