/**
 * dev_hours entry pra release 4.41.0 (Sprint 2 — schema evolution Roteiros).
 * Marca com modules:['roteiros'] pra entrar no tab "Foco em produto".
 * Idempotente: upserta por releaseVersion.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const HOURLY_RATE = 150;
const AI_MULT = 0.50;

const REL = {
  releaseVersion: '4.41.0',
  releaseSlug:    '20260518-roteiros-sprint2-schema-evolution',
  title:          'roteiros: Sprint 2 — schema evolution (travelers, colab, workflow, cost)',
  summary:        'Sprint 2 do refactor do módulo de Roteiros: SCHEMA EVOLUTION. (1) travelers[] substitui agregado adults/children/childrenAges — cada viajante com nome+idade+doc+papel(responsável). Migration on-read deriva travelers automaticamente de docs antigos. (2) collaboratorIds[] populado via UI nova de pills clicáveis na seção "Avançado" — já reconhecido pelas firestore.rules do Sprint 1. (3) workflowMode (system|offline) — user escolhe se segue fluxo no sistema ou fora. (4) costPricing (custo interno + margem comercial) com nova permission roteiro_view_cost — só renderiza pra autorizados; gated em 3 camadas: rules + stripInternalFields em PDF/PPTX export + stripInternalForPublicLink em createWebLink (snapshot do link público também é limpo). sanitizeForSave estendido pra novos campos: filtra travelers vazios, garante 1 lead, clamp custos negativos, dedup collaboratorIds. Nova seção "Avançado" (12ª aba ⚙) no editor agrupa todos os controles internos.',
  bucket:         'large',
  multiplierIds: ['migration', 'security'],
  profile:        'feature',
  humanHours:     8.0,
  completedAt:    new Date('2026-05-18T22:30:00-03:00'),
  modules:        ['roteiros'],
};

(async () => {
  const factor = 1 + REL.multiplierIds.reduce((s, id) => {
    const m = { investigation: 0.30, migration: 0.20, pdf: 0.15, integration: 0.20, security: 0.25, pure_refactor: -0.20 }[id];
    return s + (m ?? 0);
  }, 0);
  const humanEquivalentHours = +(REL.humanHours * factor).toFixed(2);
  const totalHours           = +(humanEquivalentHours * AI_MULT).toFixed(2);
  const totalCost            = +(totalHours * HOURLY_RATE).toFixed(2);

  const profileRatios = { refinamento: 0.20, desenvolvimento: 0.50, testes: 0.10, documentacao: 0.15, implantacao: 0.05 };
  const hoursByCategory = {};
  let allocated = 0;
  for (const k of Object.keys(profileRatios)) {
    hoursByCategory[k] = +(totalHours * profileRatios[k]).toFixed(2);
    allocated += hoursByCategory[k];
  }
  const diff = +(totalHours - allocated).toFixed(2);
  if (diff !== 0) hoursByCategory.desenvolvimento = +(hoursByCategory.desenvolvimento + diff).toFixed(2);

  const payload = {
    entryType:              'release',
    releaseVersion:         REL.releaseVersion,
    releaseSlug:            REL.releaseSlug,
    title:                  REL.title,
    summary:                REL.summary,
    bucket:                 REL.bucket,
    multiplierIds:          REL.multiplierIds,
    profile:                REL.profile,
    humanEquivalentHours,
    aiAssistanceMultiplier: AI_MULT,
    totalHours,
    totalCost,
    hourlyRate:             HOURLY_RATE,
    hoursByCategory,
    completedAt:            admin.firestore.Timestamp.fromDate(REL.completedAt),
    status:                 'approved',
    approvedAt:             admin.firestore.FieldValue.serverTimestamp(),
    approvedBy:             { uid: 'system-seed', name: 'Sistema' },
    createdAt:              admin.firestore.FieldValue.serverTimestamp(),
    createdBy:              { uid: 'system-seed', name: 'Sistema' },
    modules:                REL.modules,
  };

  const q = await db.collection('dev_hours').where('releaseVersion', '==', REL.releaseVersion).get();
  if (q.empty) {
    await db.collection('dev_hours').add(payload);
    console.log(`✅ Criada release ${REL.releaseVersion} (${totalHours}h · R$ ${totalCost})`);
  } else {
    await q.docs[0].ref.update(payload);
    console.log(`✓ Atualizada release ${REL.releaseVersion} (${totalHours}h · R$ ${totalCost})`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
