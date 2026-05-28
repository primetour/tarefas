const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.45',
  releaseSlug: '20260528-exports-plug-footer-header-portal-roteiro',
  title: 'Plug exports.footerText+headerText em 4 generators zumbis (pos-audit)',
  summary: 'Auditoria pos-sprint v4.62.39-44 (delegada a Agent) achou 13 caminhos zumbis pra exports. ' +
           'UI salva mas backend ignora. Esta release plugou 4: (1) portalGenerator PDF addFooter() le ' +
           'exports.portal.pdf.footerText e renderiza 3 linhas max esquerda do rodape padrao, cinza ' +
           '160 fontsize 6pt; (2) portalGenerator DOCX usa section.footers + section.headers via ' +
           'window.docx.Footer/Header — padrao Word real em todas as paginas, parsed do exports.' +
           'portal.docx; (3) portalGenerator PPTX defineSlideMaster AREA_FOOTER + wrap pptx.addSlide ' +
           'pra aplicar master automatico em todos os slides; (4) roteiroGenerator DOCX section. ' +
           'footers/headers idem. Total: 4 generators × (footer + header) = 8 plugs. Em todos: ' +
           'resolveExportTemplate(area, moduleKey, format) + formatExportText com placeholders ' +
           '{areaName}/{today}/{clientName}/{title}. AINDA ZUMBI (proximas releases): portalGenerator ' +
           'Web link (precisa mexer portal-view.html), roteiroGenerator PPTX header, roteiroGenerator ' +
           'PDF headerText (so footer plugado v4.62.43), hideCover em qualquer formato.',
  bucket: 'small', multiplierIds: ['integration'], profile: 'feature',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 1.2, testes: 0.2, documentacao: 0.3, implantacao: 0.1 },
  module: 'portal', modules: ['portal', 'roteiros'],
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
