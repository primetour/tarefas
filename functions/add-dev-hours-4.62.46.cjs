const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.46',
  releaseSlug: '20260528-hidecover-headertext-all-generators',
  title: 'Plug headerText + hideCover em 6 generators (pos-audit pt 2/6)',
  summary: 'Sequencia v4.62.45 (footerText). Auditoria pos-sprint achou ' +
           'UI aba Exports prometia hideCover + headerText mas backend dos ' +
           '6 generators ignorava silenciosamente. Plugs: (1) roteiroGenerator ' +
           'PDF addFooter ganha customHeaderText canto sup direito 6pt cinza ' +
           '160; hideCover pula buildCoverPage + 1a addPage. (2) roteiroGenerator ' +
           'DOCX hideCover pula bloco capa inteiro (logo + titulo + destinos ' +
           '+ periodo + hero + page break). (3) roteiroGenerator PPTX novo ' +
           'defineSlideMaster AREA_FOOTER + wrap pptx.addSlide espelhado do ' +
           'portalGenerator v4.62.45; hideCover pula slide 1 inteiro. (4) ' +
           'portalGenerator DOCX hideCover pula bloco capa. (5) portalGenerator ' +
           'PPTX hideCover pula slide capa. Total 5 plugs novos. Aba Exports ' +
           'em Areas agora 100% funcional pra PDF/DOCX/PPTX. Web link fica ' +
           'pra v4.62.47 (precisa mexer portal-view.html).',
  bucket: 'small', multiplierIds: ['integration'], profile: 'feature',
  hoursByCategory: { refinamento: 0.2, desenvolvimento: 1.0, testes: 0.2, documentacao: 0.2, implantacao: 0.1 },
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
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  process.exit(0);
})();
