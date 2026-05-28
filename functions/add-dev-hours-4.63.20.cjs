const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.63.20',
  releaseSlug: '20260528-templates-manual-banco-seed',
  title: 'Manual de Templates + PLACEHOLDERS_SPEC enriquecido + Banco seed + UI',
  summary: 'Migracao 3/3 generators legados FECHADA. Atende pedido Rene: dicionario de itens por ' +
           'modulo + orientacoes Word/PPT + manual no modulo Biblioteca. NEW docs/TEMPLATES-' +
           'AUTHORING-GUIDE.md (~25KB): pipeline render Puppeteer/docxtemplater + R2 fallback, ' +
           'engines por formato (HTML Handlebars vs DOCX-PPTX Mustache), HTML+CSS A4 dimensions ' +
           'margins running header/footer @page, fontes Poppins Google Fonts no SSRF allowlist, ' +
           'cores brand CSS vars dinamicas, SSRF allowlist explicita (data: about: R2 google ' +
           'fonts), Handlebars syntax sem eq helper, DOCX passo-a-passo Word loops em tabelas ' +
           'condicionais Mustache, PPTX passo-a-passo, dicionario completo 3 modulos (Cotacoes ' +
           '60+ paths Portal 25+ Banco 12), patterns visuais legados (capa section headers dia-a-' +
           'dia tabelas), checklist final, anti-padroes. EXPANDED PLACEHOLDERS_SPEC: cada entry ' +
           'com type/category/required/example/desc. NEW PLACEHOLDER_CATEGORIES com label/icon/' +
           'order. NEW UI botao Manual no header Biblioteca abre modal tabs por modulo, tabelas ' +
           'por categoria com badges coloridos (Sempre verde/Comum azul/Opcional cinza/Calculado ' +
           'roxo), click-to-copy paths, link guia GitHub, Esc fecha. NEW templates/seeds/banco-' +
           'roteiros-default-html.html 7.2KB: Cover Colecao PRIMETOUR + titulo + destinos + ' +
           'noites, dia-a-dia simples, hospedagem tabela, inclui/exclui check/x. Seed: ' +
           'vz1kaf398LONdZGuAy71 global default banco-roteiros.html. Migracao FECHADA: 17 Portal ' +
           '/ 19 Cotacoes / 20 Banco+Manual.',
  bucket: 'large', multiplierIds: ['integration', 'pdf'], profile: 'feature',
  hoursByCategory: { refinamento: 0.5, desenvolvimento: 3.5, testes: 0.5, documentacao: 2.0, implantacao: 0.5 },
  module: 'templates', modules: ['templates', 'roteiros', 'portal', 'banco-roteiros'],
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
