const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.63.92',
    releaseSlug: '20260530-unsplash-fallback-choice',
    title: 'Cotações: fallback de imagens Unsplash visível e opcional antes da geração',
    summary: 'Renê pediu "fallback de imagens Unsplash deve ser visível para o usuário antes da geração, e não ' +
             'hardcoded padrão. Usuário pode escolher seguir com o fallback ou deixar o documento sem imagem." ' +
             'Decisões confirmadas: default por slot = deixar vazio (Unsplash só entra se o user optar), ' +
             'persistência efêmera (só por geração, sem schema novo), escopo começa por Cotações. ' +
             'roteiroGenerator.js: global de módulo _unsplashKeepPolicy (Set de slotKeys a manter, null=legado) ' +
             '+ exports setUnsplashKeepPolicy/clearUnsplashKeepPolicy; enrichRoteiroImages retorna {raw,sources} ' +
             'por slot e só dropa fonte unsplash fora do Set — override/banco nunca afetados. roteiroEditor.js: ' +
             'estado _keepUnsplashSlots resetado por load/destroy; populateAutoImagePreviews reescrito pra pintar ' +
             'cada slot com sua fonte; _applyUnsplashSlotUI pinta thumb esmaecida+overlay "SEM IMAGEM" quando ' +
             'vazio e botão toggle "✓ Usar Unsplash"/"Deixar vazio"; os 4 exports (PDF/DOCX/PPTX/Web Link) ' +
             'aplicam a política antes de gerar e limpam no finally. Validado por node --check nos 2 arquivos; ' +
             'E2E live bloqueado por login SSO do Renê (não autentico).',
    bucket: 'small', multiplierIds: ['integration'], profile: 'feature',
    hoursByCategory: { refinamento: 0.25, desenvolvimento: 0.7, testes: 0.2, documentacao: 0.1, implantacao: 0.05 },
    module: 'roteiros', modules: ['roteiros'],
  },
];

function computeHours(b, mids, ai) {
  const t = Object.values(b).reduce((a, x) => a + x, 0);
  const m = (mids || []).map(id => ({ investigation: .3, migration: .2, pdf: .15, integration: .2, security: .25, pure_refactor: -.2 }[id] || 0)).reduce((a, x) => a + x, 0);
  return t * (1 + m) * ai;
}

(async () => {
  for (const ENTRY of ENTRIES) {
    const ex = await db.collection('dev_hours').where('releaseVersion', '==', ENTRY.releaseVersion).limit(1).get();
    if (!ex.empty) { console.log(`= skip ${ENTRY.releaseVersion}`); continue; }
    const h = computeHours(ENTRY.hoursByCategory, ENTRY.multiplierIds, AI_ASSIST);
    const now = FV.serverTimestamp();
    const doc = { entryType: 'release', ...ENTRY, aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE,
      totalHours: Math.round(h * 100) / 100, totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
      status: 'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now };
    const ref = await db.collection('dev_hours').add(doc);
    console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  }
  process.exit(0);
})();
