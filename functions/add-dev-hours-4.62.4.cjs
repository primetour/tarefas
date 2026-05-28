const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.4',
  releaseSlug: '20260527-deletedestination-fk-cleanup-roteiros-bank',
  title: 'deleteDestination — FK cleanup roteiros_bank (CRÍTICO pós M:N v4.62.0)',
  summary: 'Gap latente desde v4.62.0 (M:N anchoring, 528 refs ativas em 184 roteiros). ' +
           'deleteDestination cobria cleanup de portal_tips + portal_images mas não existia quando ' +
           'roteiros_bank.geo.destinationIds[] foi introduzido. Deletar destination deixaria refs órfãs ' +
           '(filtro array-contains retorna FK morta, modal "Roteiros vinculados (N)" cita doc inexistente). ' +
           'Implementado: 3º bloco try/catch em deleteDestination com query array-contains + ' +
           'arrayRemove(id) atomic + audit trail em geo.deletedDestRefs[] + flag hasDeletedRefs. Backfill ' +
           'idempotente em functions/cleanup-orphan-destinationIds.cjs (dry-run + apply) — rodado em prod: ' +
           '0 órfãs (374 dest válidos vs 528 refs, 100% consistente). Simulação E2E validou caminho com 16 ' +
           'refs (Maldivas): todos 16 roteiros cairiam no bolsão "Sem âncora geo" corretamente.',
  bucket: 'small',
  multiplierIds: ['migration'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.5, desenvolvimento: 1.5, testes: 1.0, documentacao: 0.5, implantacao: 0.2 },
  module: 'portal',
  modules: ['portal', 'banco-roteiros'],
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
