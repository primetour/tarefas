const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.63.8',
  releaseSlug: '20260528-templates-render-docx-pptx',
  title: 'Render engine multi-formato HTML+DOCX+PPTX (sprint 9/11)',
  summary: 'Estende CF renderTemplate pra suportar 3 formatos no mesmo endpoint. functions/index.js ' +
           'branches por format: html Puppeteer Chromium PDF A4; docx pizzip + docxtemplater buffer ' +
           'DOCX delimiters Mustache; pptx mesmo docxtemplater (XML Office Open) buffer PPTX. ' +
           'Response unificada {fileBase64, mime, filename, sizeBytes} + backwards-compat pdfBase64 ' +
           'quando html. paragraphLoop + linebreaks pra quebras de linha. js/services/templates.js ' +
           'renderTemplate: le fileBase64 (novo) ou pdfBase64 (legado), Blob com mime do CF. UI ' +
           'templatesLibrary.js: botao Testar ativo pra DOCX/PPTX label adapta. Erros docxtemplater ' +
           'detalhados via error.properties.errors[]. Dep nova: docxtemplater@^3.x. Performance ' +
           'DOCX/PPTX ~500ms-1s (JS puro). PDF continua ~2-3s warm. Regression HTML validado E2E ' +
           '(template zFebJ1oCUiG7JjIbh81I renderou em 10s cold, response shape novo {filename, ' +
           'sizeBytes, blob com mime application/pdf}).',
  bucket: 'medium', multiplierIds: ['integration', 'pdf'], profile: 'feature',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 1.8, testes: 0.4, documentacao: 0.3, implantacao: 0.2 },
  module: 'portal', modules: ['portal', 'roteiros', 'banco-roteiros'],
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
