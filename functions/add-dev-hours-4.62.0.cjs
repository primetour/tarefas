const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.62.0',
  releaseSlug: '20260527-bank-destinations-MN-link-normalize-cities',
  title: 'Banco — vinculação M:N roteiros↔destinations + normalize cidades (pergunta Renê)',
  summary: 'Renê questionou clareza da vinculação cross-module. Diagnóstico real: 0/236 roteiros tinham ' +
           'geo.destinationIds populado (vinculação NUNCA rodou). Decisões: ancoragem M:N, split trechos ' +
           'Envision + strip parênteses, backfill agora + adapter normaliza futuros. ' +
           'envisionAdapter ganha normalizeCityName exportada (split " - "/" / ", strip "(...)", strip ' +
           'sufixo país duplicado, dedup case-insens). deriveGeo aplica em cada Product → cidades atômicas. ' +
           'Backfill Admin SDK (functions/backfill-bank-destinationIds.cjs) idempotente: 236 atualizados, ' +
           '184/236 (78%) ancorados (52 sem = roteiros sem country Envision), 247/290 (85%) destinations ' +
           'referenciados (antes ZERO), 528 refs totais, 17 destinations pending novos, 12 cidades atômicas ' +
           'extras de splits. Filtros tipo "roteiros que passam por Cidade do Cabo" agora possíveis via ' +
           'where geo.destinationIds array-contains. IA recebe contexto geo coerente via destinationId.',
  bucket: 'medium',
  multiplierIds: ['integration', 'migration'],
  profile: 'feature',
  hoursByCategory: { refinamento: 1.0, desenvolvimento: 3.0, testes: 0.7, documentacao: 0.6, implantacao: 0.3 },
  module: 'banco-roteiros',
  modules: ['banco-roteiros', 'portal'],
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
  const doc = { entryType: 'release', ...ENTRY, aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE, totalHours: Math.round(h * 100) / 100, totalCost: Math.round(h * HOURLY_RATE * 100) / 100, status: 'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now };
  const ref = await db.collection('dev_hours').add(doc);
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  process.exit(0);
})();
