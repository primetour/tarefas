const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.63.22',
  releaseSlug: '20260528-web-template-foundation',
  title: 'Web Link foundation (formato + schema + dropdown + manual section)',
  summary: 'Atende pedido Rene web link na biblioteca de templates. Foundation 1/3 da feature, ' +
           'completa em v4.63.23+24. CHANGES: TEMPLATE_FORMATS web como 4o formato distinto (vs ' +
           'html-PDF) mime text/html maxMB 8 exports [web]. WEB_TEMPLATE_MODES full vs slots ' +
           'constants. portalAreas SUPPORTED_FMTS_TPL web adicionado portal+cotacoes. ' +
           'generateWebLink detecta area.templateRefs.portal.web busca fetchTemplate grava ' +
           'webTemplate metadata portal_web_links templateId/Name/Mode/fileUrl. PLACEHOLDERS_SPEC ' +
           'portal +12 web-exclusive: webUrl previewUrl token webExports createdBy createdAt views ' +
           '+3 JS hooks PRIMETOUR.onDestinoClick/onSegmentFilter/onMapPinClick. PLACEHOLDER_CATEGORIES ' +
           'web nova label icon globe. Manual MD §14 NEW ~5KB: 14.1 modos full vs slots, 14.2 SSRF ' +
           'XSS concern sem allowlist, 14.3 tabela vars exclusive, 14.4 JS hooks doc, 14.5 passo-a-' +
           'passo criar template, 14.6 limitacoes v4.63.22. LIMITACOES declaradas: slots so schema ' +
           'nao runtime, portal-view-tpl.html renderer vem v4.63.23, esta release grava metadata ' +
           'ainda nao renderiza, cotacoes web vem v4.63.24+.',
  bucket: 'small', multiplierIds: ['integration'], profile: 'feature',
  hoursByCategory: { refinamento: 0.6, desenvolvimento: 1.3, testes: 0.2, documentacao: 1.0, implantacao: 0.2 },
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
  const doc = { entryType: 'release', ...ENTRY, aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE,
    totalHours: Math.round(h * 100) / 100, totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
    status: 'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now };
  const ref = await db.collection('dev_hours').add(doc);
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  process.exit(0);
})();
