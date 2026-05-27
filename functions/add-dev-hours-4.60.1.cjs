const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.60.1',
  releaseSlug: '20260526-destinations-merge-duplicates-cityAliases',
  title: 'Destinos — merge 5 duplicatas + cityAliases pt-BR canônico (pergunta Renê)',
  summary: 'Pergunta Renê: "Cape Town vs Cidade do Cabo, Tokyo vs Tóquio, etc — como fazer?". ' +
           'Estratégia: pt-BR canônico vence (consistência com schema países); outras grafias viram ' +
           'cityAliases[]; preserva ID do manual approved (FKs históricos); FK cleanup defensivo ' +
           'cross-module (portal_images/tips/roteiros_bank.destinationIds redirecionam); deleta trash. ' +
           'functions/merge-destinations-duplicates.cjs com MERGE_PLAN (50+ pares en/pt hardcoded) + ' +
           'detecção literal de duplicação. Aplicado contra prod (5 grupos): Cidade do Cabo, Quioto, ' +
           'Marrakech (com alias Marraquexe), Fez (alias Fès), Lençóis Maranhenses dup literal. ' +
           'portal_destinations 289→284. geoResolver.findDestinationByLabel já checa cityAliases — ' +
           '"Cape Town"/"Tokyo" agora resolvem pro canônico automaticamente. Junk separado (11 docs) ' +
           'listado pra Renê decidir (3 vazios, 4 vagos city===country, 4 legítimos cidade-estado).',
  bucket: 'small',
  multiplierIds: ['migration'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.4, desenvolvimento: 1.6, testes: 0.3, documentacao: 0.4, implantacao: 0.1 },
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
