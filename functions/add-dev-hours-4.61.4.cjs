const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.61.4',
  releaseSlug: '20260527-hotfix-geoResolver-firebase-sdk-version-mismatch',
  title: 'HOTFIX — geoResolver Firebase SDK version mismatch (E2E pego pelo "teste!" Renê)',
  summary: 'Renê: "teste!". Bateria E2E real via Chrome MCP pegou bug crítico: geoResolver.js importava ' +
           'firebase-firestore@10.13.2 mas resto do sistema usa @10.12.2. collection(db,...) falha silente ' +
           '(captured try/catch ensureDestination) → fallback slugify-sem-aliases criava duplicata. ' +
           'Reproduzido: ensureDestination({city:Cape Town}) criou doc novo mesmo já existindo Cidade do ' +
           'Cabo com alias Cape Town. Fix 1 linha (10.13.2 → 10.12.2). Re-test passou: REUSED canonical. ' +
           'Auditoria preventiva grep js/ confirma TODAS 47 ocorrências firebase-firestore.js agora em ' +
           '10.12.2. Lição CLAUDE.md §14.l: mismatch SDK silencioso é traiçoeiro porque try/catch mascara; ' +
           'node --check + curl + E2E UI principal NÃO cobrem (helper só chamado por service não-UI); ' +
           'pattern preventivo FB_SDK_BASE central em firebase.js pra futuros. Bateria E2E adicional ' +
           'validou: dashboard count approved=196 vs all=273 (filtro v4.61.3 funciona), bulk DUPLICATE ' +
           'detect (saveDestination Kyoto → throw DUPLICATE com mergeTargetCity=Quioto).',
  bucket: 'trivial',
  multiplierIds: ['investigation'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.3, testes: 0.7, documentacao: 0.3, implantacao: 0.1 },
  module: 'banco-roteiros',
  modules: ['banco-roteiros', 'portal'],
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
