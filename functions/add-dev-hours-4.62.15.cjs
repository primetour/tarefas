const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.15',
  releaseSlug: '20260527-portal-new-request-handler-hotfix',
  title: 'Hotfix: solicitar.html cache-bust pinned em 4.57.52 (botao seguia inerte)',
  summary: 'Rene testou v4.62.14 e botao "Fazer nova solicitacao" SEGUIU sem funcionar. Diagnostico via ' +
           'Chrome MCP em prod: app principal carrega v4.62.14 correto, MAS solicitar.html (page standalone) ' +
           'tinha cache-bust hardcoded em portal.js?v=4.57.52 — versao antiga sem _wireNewRequestBtn. User ' +
           'pegava JS antigo via GH Pages max-age=600 + URL com versao pinned. Fix de processo, nao de ' +
           'codigo: bumpar ?v= no solicitar.html + comentario explicito acima do tag avisando pra futuras ' +
           'edicoes. Lição CLAUDE.md: pages standalone tem cache-bust INDEPENDENTE do app principal. ' +
           'Checklist de release pre-deploy precisa cobrir os 2 (index.html + solicitar.html quando mexe ' +
           'em portal.js/portalWizard.js).',
  bucket: 'trivial',
  multiplierIds: ['investigation'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.2, testes: 0.3, documentacao: 0.2, implantacao: 0.1 },
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
