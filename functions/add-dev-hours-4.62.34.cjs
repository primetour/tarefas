const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.34',
  releaseSlug: '20260527-gds-parser-fixes-iata-nome-sem-distribuir',
  title: 'Parser GDS: 4 fixes (IATA->nome, voo fake, sem chips, sem distribuir)',
  summary: 'Rene auditou parser GDS e apontou 4 problemas reais. (1) Modal de revisao mostrava ' +
           '"Sao Paulo / Dubai" mas no card de voo gravava "GRU / DXB" — fix: _openAirGdsModal usa ' +
           'p.originCity/p.destinationCity (nome formatado) em vez de IATA puro; IATAs ficam em ' +
           'campos auxiliares pra audit. (2) Parser criava 5o voo "fake" (US 3874) da linha de ' +
           'tarifa "1- USD3874.00..." porque heuristica aceitava 2-chars+digito+2-IATAs sem validar. ' +
           'Fix: NON_AIRPORT_CODES set (moedas + paxTypes + taxas + commands GDS), reject early ' +
           'em linha com USD\\d+ colado, data DDMMM agora OBRIGATORIA (sem data nao eh voo), validacao ' +
           'final que ambas IATAs existam no dicionario de aeroportos. (3) Chips de breakdown taxas ' +
           '(YQ/YR/BR/ZR/F6/SW/OI/TK) poluiam modal — Rene: "qual a utilidade?". Removidos dos 2 ' +
           'modals (_openAirGdsModal + _openFareReviewModal). Dados ainda salvos em pricing.' +
           'airFareDetails.breakdown pra audit/futuro export detalhado. (4) Distribuir total entre ' +
           'voos era matematicamente correto mas SEMANTICAMENTE FALSO — GDS quota o pacote inteiro ' +
           '(1 pax x 4 trechos = USD 6373.20), nao cada trecho separado. Removido radio "distribute" ' +
           'dos 2 modals. Default = metadata (salva total em pricing.airTotalFare). Opcional = ' +
           'single (atribui a 1 voo). _sumServicePrices ajustado pra incluir airTotalFare no total ' +
           'SE nenhum voo individual tem preco (evita dobrar). Badge no header: "total da cotacao" ' +
           'ou "em 1 voo" (era "distribuida"). Auditoria honesta do Rene rendeu UX limpa.',
  bucket: 'small', multiplierIds: ['investigation'], profile: 'bugfix',
  hoursByCategory: { refinamento: 0.4, desenvolvimento: 1.2, testes: 0.3, documentacao: 0.4, implantacao: 0.1 },
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
