const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.63.21',
  releaseSlug: '20260528-audit-fixes-h1-h2-h3',
  title: 'Fix audit findings HIGH/MEDIUM (regressões silenciosas)',
  summary: 'Auditoria Agent pos-sessao entregou 5 HIGH + 7 MEDIUM. Esta release ataca 3 HIGH ' +
           'criticos (regressoes silenciosas dos proprios releases v4.63.12-20). H1 CRITICAL: ' +
           'logAction nao existe — audit.js exporta auditLog. portalGenerator + 3 branches ' +
           'roteiroGenerator chamavam undefined fn, try/catch silenciava TypeError, audit ' +
           'templates.fallback NUNCA gravou em prod (0 docs Firestore confirmado). Fix substituir ' +
           'em 4 callsites por auditLog(action, entity, entityId, details). H2 HIGH UX: toast.info ' +
           'ignorava 3o arg duration (assinatura era info(msg,title) sem duration). Progress toast ' +
           '90s sumia em 4s default, _progressId stale, toast.update silently fail. Render Puppeteer ' +
           '5-10s sem feedback ultimos 60%. Fix 4 metodos toast aceitam 4o arg duration propagado ' +
           'pro show. H3 HIGH: branches DOCX/PPTX nao passavam _adapterOpts, so PDF tinha ' +
           'imagesByCity+customFooter/Header+hideCover. Templates DOCX/PPTX uploaded perdiam hero ' +
           'per day, footer custom, hideCover. Fix extraido helper _buildAdapterOpts chamado nos 3 ' +
           'branches paridade total. M3 templates.render/seed action labels faltavam em audit.js. ' +
           'M4 orphan ref detector portalAreas refIds sem dedupe — N cells = N fetches. Fix ' +
           '[...new Set]. M5 modal Manual Esc handler vazava em close por click — listener so ' +
           'removia em case Esc. Fix extrair handler variavel + removeEventListener em close ' +
           'unificado. Nao atacados H4/H5/S1/S3/M1/M2/M6/M7/P1/P2/U1/U2/D1-D3 — polish/security ' +
           'deeper/perf — vao pra v4.64+. Padrao Agent paralelo pos-sprint validou ROI — captou ' +
           'regressoes que CI/tests nao pegaram (3 HIGH em features das proprias releases recentes).',
  bucket: 'small', multiplierIds: ['integration'], profile: 'bugfix',
  hoursByCategory: { refinamento: 0.4, desenvolvimento: 1.3, testes: 0.3, documentacao: 0.4, implantacao: 0.2 },
  module: 'templates', modules: ['templates', 'portal', 'roteiros'],
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
  const doc = { entryType: 'release', ...ENTRY, aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE,
    totalHours: Math.round(h * 100) / 100, totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
    status: 'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now };
  const ref = await db.collection('dev_hours').add(doc);
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  process.exit(0);
})();
