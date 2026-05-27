const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.8',
  releaseSlug: '20260527-images-upload-bug-destino-descartado-hotel',
  title: 'Upload em lote — destino descartado em categoria hotel/restaurant (CRÍTICO)',
  summary: 'Renê: user coloca destino para aplicação em lote, sistema faz upload, mas não exibe destinos ' +
           'na lista. Diagnóstico Admin SDK: 17 fotos (Plaza Atheneé Paris + Acqualina) salvas hoje com ' +
           'continent/country/city VAZIOS no Firestore. Causa raiz em portalImages.js:814-816 (introduzido ' +
           'v4.35.31): ternario requiresLoc forcava string vazia pra categorias com requiresLocation:false ' +
           '(hotel/restaurant/train) — MESMO que essas tenham showLocation:full (form EXIBE os campos pro ' +
           'user). User preenchia, save zerava silenciosamente. Fix: usa _locDisplayFor() pra decidir ' +
           'persistencia por showLocation. Backfill rodado: 17 fotos (Plaza→Paris/Franca, Acqualina→Miami/' +
           'Estados Unidos), nomes alinhados ao SSOT existente. CLAUDE.md §11.f — separar exibir campo de ' +
           'persistir valor via helpers dedicados.',
  bucket: 'small',
  multiplierIds: ['investigation'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.7, testes: 0.4, documentacao: 0.3, implantacao: 0.2 },
  module: 'images',
  modules: ['images', 'portal'],
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
  const doc = {
    entryType: 'release', ...ENTRY,
    aiAssistanceMultiplier: AI_ASSIST,
    hourlyRate: HOURLY_RATE,
    totalHours: Math.round(h * 100) / 100,
    totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
    status: 'approved',
    completedAt: now, createdAt: now,
    createdBy: RENE_UID, updatedAt: now,
  };
  const ref = await db.collection('dev_hours').add(doc);
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  process.exit(0);
})();
