const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.60.2',
  releaseSlug: '20260526-destinations-dup-prevent-merge-inline',
  title: 'Destinos — duplicate prevention + UI merge inline (pergunta Renê)',
  summary: 'Renê: "se eu aprovar um pendente igual ao aprovado, sistema vai permitir duplicada?". ' +
           'Antes: SIM. saveDestination ganha pre-save check (busca approveds mesma cidade/aliases ' +
           'mesmo país, match em qualquer direção → throw DUPLICATE com mergeTargetId). ' +
           'mergeDestinations helper novo: FK redirect cross-module (portal_images/tips/roteiros_bank ' +
           'que apontavam pro dup → keeper) + arrayUnion(dup.city + dup.cityAliases) em keeper + delete. ' +
           'UI handleApprove + showDestModal catch DUPLICATE → _handleDuplicateMergeFlow modal ' +
           'explicativo com 2 ações (Mesclar canônico/Cancelar). Backward compat 100% (opts opcional, ' +
           'default check ativo). Impossível criar duplicata silenciosa via UI agora.',
  bucket: 'small',
  multiplierIds: ['security'],
  profile: 'feature',
  hoursByCategory: { refinamento: 0.4, desenvolvimento: 2.0, testes: 0.4, documentacao: 0.4, implantacao: 0.1 },
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
