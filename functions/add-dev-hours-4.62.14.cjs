const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.14',
  releaseSlug: '20260527-portal-link-overflow-e-new-request-handler',
  title: 'Portal — link overflow no resumo + botao Fazer nova sem handler (2 bugs)',
  summary: 'Rene reportou via screenshot 2 bugs no Portal de Solicitacoes. ' +
           'Bug 1: <a> com URL longa no Step 4 (Resumo) estourava grid 120px/1fr sem quebra natural. ' +
           'Fix: cell value ganha min-width:0 + overflow-wrap:anywhere; anchor do Link tem word-break:' +
           'break-all explicito. Defesa em 2 camadas (grid permite shrink + anchor quebra qualquer char). ' +
           'Bug 2 (LATENTE desde v4.54.0 wizard intro): handler do #new-request-btn vivia DENTRO de ' +
           'bindFormEvents que SO eh chamada no fallback legacy. Path wizard padrao (99% dos casos) nunca ' +
           'wireava handler → user clicava "Fazer nova solicitacao" e nada acontecia. Fix: extrai ' +
           '_wireNewRequestBtn, chama logo apos renderPortalWizard. Clone+replace pro listener ser ' +
           'idempotente entre ciclos. Handler legado em bindFormEvents mantido pra fallback (paths ' +
           'mutuamente exclusivos).',
  bucket: 'small',
  multiplierIds: ['investigation'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.5, testes: 0.3, documentacao: 0.3, implantacao: 0.1 },
  module: 'requests',
  modules: ['requests'],
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
