const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.26',
  releaseSlug: '20260527-editor-pnr-parser-gds-amadeus-sabre-galileo',
  title: 'Parser PNR (Amadeus/Sabre/Galileo) integrado ao editor de Cotacoes',
  summary: 'Rene: copiar pnrreader.online → integrar no editor pra colar tarifa GDS direto e gerar voos. ' +
           'Analise (~400 linhas JS publico). Implementacao etica: parser proprio js/services/pnrParser.js ' +
           '(algoritmo generico: skip prefixo, 2 chars cia, digitos voo, DDMMM data, 2x IATA, 2x 4-digit ' +
           'horarios, detecta overnight). Reusa JSONs IATA publicos via fetch (codes standard ' +
           'internacional). Cache sessionStorage 30d. Suporta Amadeus, Sabre, Galileo + simplificado. ' +
           'UI: botao ✈ Codificar tarifa GDS no header Voos da sub-tab Aereo. Modal textarea monospace ' +
           'com parse debounced (250ms) + preview tabela (cia + cidade + horario + badge "+1" overnight). ' +
           'Inserir como voos append flights[] preservando existentes, price=null pra preencher depois. ' +
           'Metadata gdsImported:true, airlineFull, originFull, destinationFull rastrea origem. CSP ' +
           'expandida pra pnr-reader.vercel.app (acesso aos JSONs).',
  bucket: 'small', multiplierIds: ['integration'], profile: 'feature',
  hoursByCategory: { refinamento: 0.5, desenvolvimento: 2.0, testes: 0.5, documentacao: 0.5, implantacao: 0.2 },
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
