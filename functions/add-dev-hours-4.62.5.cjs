const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.5',
  releaseSlug: '20260527-destinations-country-standalone-remove-dica-col',
  title: 'Destinos — filtro país standalone + remoção coluna Dica (UX/CLAREZA)',
  summary: 'Renê: "poder filtrar por país" + "tirar coluna Dica, deixar essa info ao lado da coluna que ' +
           'já tem Dica, exibir em numeral igual fez na coluna roteiro". (1) updateCountryFilter sem ' +
           'dependência de continente — dropdown sempre populado com todos os países, restringe só se ' +
           'cont ativo. Auto-zera continente quando user escolhe país conflitante (evita zero results). ' +
           '(2) Tabela 5→4 colunas: remove "Dica" (info duplicada do botão de ação). Botão 💡 Dica vira ' +
           'mesmo padrão do 📋 Roteiro: badge numeral pill dourado "1" quando existe, opaco-cinza ' +
           'quando não. Zero perda funcional (link/handler preservados).',
  bucket: 'small',
  multiplierIds: [],
  profile: 'feature',
  hoursByCategory: { refinamento: 0.2, desenvolvimento: 1.0, testes: 0.3, documentacao: 0.2, implantacao: 0.1 },
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
