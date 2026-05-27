const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.23',
  releaseSlug: '20260527-editor-audit-fix-source-persist-state-reset',
  title: 'Editor audit E2E — fix source persist + badge sem cidade + state reset',
  summary: 'Rene: "quero o sistema em nivel de excelencia conforme CLAUDE.md". Audit E2E completo via ' +
           'Chrome MCP descobriu 3 bugs criticos na sprint v4.62.16-22: ' +
           '(1) CRITICO: collectFormData reconstruia days[] sem preservar campos meta (source, bankRefId, ' +
           'bankRefTitle, bankRefDayIdx). Badge UI mostrava "📚 Banco" mas Firestore salvava source=null. ' +
           'Validado lendo doc id=pph0aP34s7U3anfblWWz: sourcesPersisted=[null,null,null] apesar de adicionar ' +
           '2 dias via banco + 1 manual. Fix: spread ...existing antes dos overrides (linha ~2915). ' +
           '(2) Badge contagem Imagens nao aparecia em cotacao SEM destino (q=""). Fix: quando sem cidade ' +
           'mostra total do banco (209) como dica neutra cinza — incentiva user clicar mesmo sem briefing. ' +
           '(3) State contamination entre cotacoes: _servicosActiveSubtab module-scope persistia. Fix: ' +
           'destroyRoteiroEditor reseta pra "aereo". CLAUDE.md regra 1: testar SEMPRE em ambiente real ' +
           'antes de "feito" — sprint anterior nao validou persistencia, badges nem state cleanup.',
  bucket: 'small', multiplierIds: ['investigation'], profile: 'bugfix',
  hoursByCategory: { refinamento: 0.4, desenvolvimento: 0.8, testes: 1.0, documentacao: 0.4, implantacao: 0.1 },
  module: 'roteiros', modules: ['roteiros'],
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
