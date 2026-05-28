const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.63.17',
  releaseSlug: '20260528-portal-default-template-seed',
  title: 'Portal PDF legacy -> template HTML Handlebars seed (Migracao 1/3)',
  summary: 'Migracao 1/3 generators legados para templates uploaded (Rene 28/05: nao posso perder ' +
           'aquilo de forma alguma). Preserva inteligencia do generatePDF portalGenerator.js como ' +
           'template HTML+CSS Handlebars que Puppeteer renderiza igual. NEW templates/seeds/' +
           'portal-default-html.html 10.6KB: cover (logo fundo --secondary lista destinos data), TOC ' +
           'sumario, por destino hero+titulo+11 segmentos iteraveis, segmentos com heading dourado ' +
           'border-left narrative+items, Info Gerais como callout com chips populacao/moeda/lingua/' +
           'etc, Footer page-number+customFooterText, Header customHeaderText, hideCover support. ' +
           'EXPANDED portalToTemplateData: heroUrl per dest (imagesByDest), area.corPrimary/' +
           'corSecondary CSS vars, customFooterText/customHeaderText/hideCover, destinos.segmentos ' +
           'iteravel em ordem DEFAULT_SEGMENTS (11 segs), skip vazios. portalGenerator.generateMaterial ' +
           'passa context extra via resolveExportTemplate. Seed script idempotente via SHA256, upload ' +
           'R2 + Firestore doc ownerType:global isDefault:true. Template global criado em prod: ' +
           'o4uOC40G2p0zdhqt0vsg. E2E render real: PDF 46.5KB em 3.3s via:base64. Plano: 17 Portal / ' +
           '18 refinos / 19 Cotacoes / 20 Banco. DOCX/PPTX legados mantidos fallback eterno.',
  bucket: 'medium', multiplierIds: ['integration', 'pdf'], profile: 'feature',
  hoursByCategory: { refinamento: 0.5, desenvolvimento: 3.0, testes: 0.7, documentacao: 0.8, implantacao: 0.4 },
  module: 'templates', modules: ['templates', 'portal'],
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
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  process.exit(0);
})();
