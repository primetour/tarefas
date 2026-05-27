/**
 * dev_hours v4.59.7 + v4.59.8 — fechamento sprint Auditoria Banco
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.59.7',
    releaseSlug: '20260526-banco-adapter-cleanup-clientguard-modal',
    title: 'Banco — adapter schema cleanup + bankClientGuard modal + cancelRow rótulo (3 itens auditoria)',
    summary: '(schema) envisionAdapter: _envisionCurrency (debug com prefixo _ que vazou pra prod) → ' +
             'envision.currency canônico; envisionRaw.imageUuids removido (URLs CDN já em images.gallery ' +
             'desde v4.58.2). 236/236 docs migrados via functions/cleanup-bank-envision-schema.cjs ' +
             'idempotente. (UX) bankClientGuard confirm() nativo (último spot do módulo) → modal.confirm ' +
             'danger com texto contratual rico. (polish) cancelRowHTML "Até X dias antes" (confuso — ' +
             'fromDays é limite SUPERIOR da faixa) → "Cancelando até N dias antes da viagem" + ' +
             'title explicativo + placeholders + hex → CSS var.',
    bucket: 'trivial',
    multiplierIds: [],
    profile: 'bugfix',
    hoursByCategory: { refinamento: 0.2, desenvolvimento: 1.0, testes: 0.2, documentacao: 0.3, implantacao: 0.2 },
    module: 'banco-roteiros',
    modules: ['banco-roteiros'],
  },
  {
    releaseVersion: '4.59.8',
    releaseSlug: '20260526-banco-editor-images-picker-gallery',
    title: 'Banco — editor section Imagens enriquecida (último item auditoria — sprint v4.59 completa)',
    summary: 'Antes: renderCapa tinha 1 input URL pra images.hero; gallery[] no schema mas inutilizada. ' +
             'Agora: renderImages() section nova após Capa com (hero) preview thumb 160x100 + picker ' +
             'visual do banco + botão limpar; (galeria) grid 4:3 responsivo + remove por thumb + ' +
             'multi-select picker do banco + add URL externa via modal. _openImagePicker({multi}) ' +
             'cascata de filtros country+city → country → all, checkmark dourado pra multi-select, ' +
             'empty state link pro Banco de Imagens. Sync com input legado da Capa (retrocompat). ' +
             'Sprint v4.59 completa: 5 críticos + 8 médios + 8 polish + 10 risk = 31 itens fechados ' +
             '(33 mapeados, 2 falsos positivos confirmados na inspeção).',
    bucket: 'small',
    multiplierIds: [],
    profile: 'feature',
    hoursByCategory: { refinamento: 0.5, desenvolvimento: 2.5, testes: 0.5, documentacao: 0.5, implantacao: 0.2 },
    module: 'banco-roteiros',
    modules: ['banco-roteiros', 'images'],
  },
];

function computeHours(b, mids, ai) {
  const t = Object.values(b).reduce((a, x) => a + x, 0);
  const m = (mids || []).map(id => ({
    investigation: .3, migration: .2, pdf: .15, integration: .2,
    security: .25, pure_refactor: -.2,
  }[id] || 0)).reduce((a, x) => a + x, 0);
  return t * (1 + m) * ai;
}

(async () => {
  for (const ENTRY of ENTRIES) {
    const ex = await db.collection('dev_hours')
      .where('releaseVersion', '==', ENTRY.releaseVersion).limit(1).get();
    if (!ex.empty) { console.log(`= skip ${ENTRY.releaseVersion} (já existe)`); continue; }
    const h = computeHours(ENTRY.hoursByCategory, ENTRY.multiplierIds, AI_ASSIST);
    const now = FV.serverTimestamp();
    const doc = {
      entryType: 'release', ...ENTRY,
      aiAssistanceMultiplier: AI_ASSIST,
      hourlyRate: HOURLY_RATE,
      totalHours: Math.round(h * 100) / 100,
      totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
      status: 'approved',
      completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now,
    };
    const ref = await db.collection('dev_hours').add(doc);
    console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  }
  process.exit(0);
})();
