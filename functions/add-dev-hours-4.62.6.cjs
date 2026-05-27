const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.6',
  releaseSlug: '20260527-aliases-tab-autosave-on-enter',
  title: 'Aba Variações — autosave on Enter + indicador status (CLAUDE.md §11.b)',
  summary: 'Renê: "aba variações de nome - aplicar autosave ao inserir a tag alias". Antes user digitava + ' +
           'Enter, chip aparecia, botão Salvar HABILITAVA mas precisava clicar (fricção, esquecia, perdia ' +
           'alias). Agora: Enter dispara save imediato silencioso. Botão Salvar substituído por <span> ' +
           'indicador inline com 4 estados (CLAUDE.md §11.b): ⟳ Salvando… (cinza), ✓ Salvo (verde, fade ' +
           '2.5s), ⚠ Erro (vermelho persistente), idle (invisível). _saveAliasesForId aceita {silent:true} ' +
           '— manual fica pronto pra voltar se precisar, hoje toda chamada é silent. Remove alias também ' +
           'silent (sem poluição toast). Helper text azul abaixo do título explica autosave pro user.',
  bucket: 'small',
  multiplierIds: [],
  profile: 'feature',
  hoursByCategory: { refinamento: 0.2, desenvolvimento: 1.0, testes: 0.4, documentacao: 0.2, implantacao: 0.1 },
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
