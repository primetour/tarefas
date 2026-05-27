const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.7',
  releaseSlug: '20260527-destinations-hastip-real-lookup-portal-tips',
  title: 'Destinos — coluna Dica conectada ao portal_tips (BUGFIX latente)',
  summary: 'Renê: "a coluna de dicas não está conectada com o módulo de dicas, todas aparecem sem dicas, ' +
           'sendo que temos dicas cadastradas. precisamos conectar via destinos, lembra?". Diagnóstico Admin ' +
           'SDK: 11 portal_tips em prod (Quênia, Casablanca, Berlim, Fez, Punta del Este, +6) todos com ' +
           'destinationId válido. Mas d.hasTip no código era REFERENCIADO mas NUNCA populado (zero writers, ' +
           'zero readers que setassem). Sempre falsy → 100% dos 355 destinos mostravam "sem dica". Bug ' +
           'latente desde v4.61.2. Fix: _loadTipLinks() paralelo a _loadRoteiroLinks via Promise.all no ' +
           'boot, popula tipsByDestId Map<destId, [{id,title}]>. Filtro e badge usam lookup real ' +
           '(tipsByDestId.has(d.id) + .length pra badge numeral). CLAUDE.md §11.f — persistência ≠ UI.',
  bucket: 'small',
  multiplierIds: ['investigation'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.7, testes: 0.4, documentacao: 0.3, implantacao: 0.1 },
  module: 'portal',
  modules: ['portal'],
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
