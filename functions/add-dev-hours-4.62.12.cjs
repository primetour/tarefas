const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.12',
  releaseSlug: '20260527-roteiros-filtros-padrao-visual-uikit',
  title: 'Gerador roteiros — filtros area/destino/tipo/consultor padronizados (CLAUDE.md §4)',
  summary: 'Rene: gerador de roteiros - filtros de areas, destinos, tipo e consultores esta fora do padrao ' +
           'visual do sistema. Filtros usavam classes proprias (.rt-advanced-filters/label/body/select/' +
           'badge/clear) — selects rounded (border-radius:999px pill), label uppercase, badge dourado — ' +
           'divergindo do padrao .filter-select retangular usado em Banco/Destinos/Tasks. Fix: migrei 4 ' +
           'selects pro array selects: do renderFilterBar (uiKit), mesma API que Banco usa. Badge N ' +
           'ativos + Limpar simplificado pra .btn .btn-ghost .btn-sm. ~50 linhas de CSS .rt-advanced-* ' +
           'removidas. Handlers preservados (IDs mantidos). CLAUDE.md §4: leia o sistema antes de ' +
           'inventar UI.',
  bucket: 'small',
  multiplierIds: ['pure_refactor'],
  profile: 'feature',
  hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.5, testes: 0.3, documentacao: 0.3, implantacao: 0.1 },
  module: 'roteiros',
  modules: ['roteiros'],
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
