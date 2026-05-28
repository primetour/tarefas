const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.32',
  releaseSlug: '20260527-editor-revisar-tarifa-redistribuir',
  title: 'Revisar/Redistribuir tarifa (reabre modal sem colar de novo)',
  summary: 'Rene: a revisao das tarifas so aparece na primeira vez que insere o codigo. Se errei e ' +
           'quero redistribuir, nao consigo. Bug latente desde v4.62.28 (pricing parse). Adicionado ' +
           'badge no header de Voos mostrando tarifa salva + modo (ex "Tarifa: US$ 6.373,20 · ' +
           'distribuida"). Botao "Revisar tarifa" aparece SO quando pricing.airFareDetails existe — ' +
           'invisivel ate codificar a primeira vez. Botao Codificar muda label pra "Codificar nova" ' +
           'quando ja tem tarifa (sinaliza substituicao). Novo _openFareReviewModal: display read-only ' +
           'da tarifa salva (base/taxas/total + chips de breakdown) + 4 radios (distribuir entre voos ' +
           'atuais, voo unico, metadata, limpar) + pre-marca modo current pra user ver o que ' +
           'esta aplicado + link "Colar nova tarifa GDS" leva pro _openAirGdsModal pleno. ' +
           'Distribuicao idempotente: cada apply recalcula proporcao pelo total / N voos ATUAIS ' +
           '(ultimo voo absorve cent drift). Se user adicionou/removeu voos depois, "Revisar -> ' +
           'distribuir" re-rateia certinho. Modo "limpar" novo: remove airFareDetails sem mexer no ' +
           'preco dos voos (caso user quer "esquecer" a tarifa salva). Schema preservado: ' +
           'pricing.airFareDetails.mode + importedAt atualizam a cada re-apply pra rastreio.',
  bucket: 'small', multiplierIds: [], profile: 'feature',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 1.0, testes: 0.3, documentacao: 0.3, implantacao: 0.1 },
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
