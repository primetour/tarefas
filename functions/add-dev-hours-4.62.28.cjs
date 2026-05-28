const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.28',
  releaseSlug: '20260527-editor-air-fare-parser-gds-pricing',
  title: 'Parser tarifa aérea GDS (Amadeus/Sabre/Galileo pricing display)',
  summary: 'Rene: completar cycle GDS no editor — voos (v4.62.26) + hoteis (v4.62.27) + agora pricing ' +
           'aereo. parseAirFareGds em pnrParser.js: tolerante multi-formato (Amadeus FQD, Sabre WP, ' +
           'Galileo FQ). Extrai currency 3 chars, baseFare, taxesTotal (calc total-base), totalFare, ' +
           'paxType (ADT/CHD/INF/CNN/YTH/SRC), breakdown[] (XT/YQ/YR/BR/ZR/F6/SW/OI). Algoritmo dedupe ' +
           '+ skip moeda/paxType/palavras conhecidas (TOTAL/TAXAS/TARIFA/BASE/FOP/MAIS) pra nao capturar ' +
           'lixo. UI: 2 botoes no header dos voos — "Codificar tarifa GDS" + "Codificar precos". Modal ' +
           '_openFareDecodeModal: textarea monospace + parse debounced 250ms + preview luxury gold ' +
           '(TARIFA/TAXAS/TOTAL + classe pax + chips breakdown) + 3 radio modes: (1) distribuir entre ' +
           'voos rateado proporcionalmente com ultimo voo absorvendo cent drift, (2) voo unico via ' +
           'dropdown, (3) apenas metadata em pricing.airTotalFare + airTotalCurrency. Sempre salva ' +
           'pricing.airFareDetails com breakdown completo (audit + futuro PDF detalhado). Validado ' +
           'local com sample NYC do Rene: USD 3874 base + USD 2499.20 taxas = USD 6373.20 total / ' +
           'ADT / 8 codes breakdown corretos.',
  bucket: 'small', multiplierIds: ['integration'], profile: 'feature',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 1.6, testes: 0.4, documentacao: 0.4, implantacao: 0.1 },
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
