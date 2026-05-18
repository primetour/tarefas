/**
 * dev_hours entry pra release 4.44.0 (Sprint 5 Phase 1+2 — PPTX paridade).
 * Idempotente: upserta por releaseVersion.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const HOURLY_RATE = 150;
const AI_MULT = 0.50;

const REL = {
  releaseVersion: '4.44.0',
  releaseSlug:    '20260518-sprint5-pptx-parity-wrapper',
  title:          'roteiros: Sprint 5 Phase 1+2 — PPTX paridade c/ PDF + wrapper único',
  summary:        'Sprint 5 do refactor: EXPORT POLISH baseado nos patterns maduros do Portal de Dicas. Audit revelou PPTX 50% incompleto (5/10 seções), embeddedTips do Sprint 3 deferido. PHASE 1: novo wrapper generateRoteiro({roteiro,area,format}) espelhando generateTip() do Portal — switch case pra pdf/pptx/docx/web, strip defensivo aplicado antes da delegação. PHASE 2: 5 slides novos no PPTX antes do closing: OPCIONAIS (tabela serviço×preços×obs), PAGAMENTO (label+value vertical), CANCELAMENTO (tabela antecedência×penalidade), INFORMAÇÕES IMPORTANTES (layout 2-col alternado incl. customFields), DICAS LOCAIS (1 slide por dica anexada com título+subtitle+até 4 segmentos×5 items). Todos usam header bar com cor secondary da área — multi-marca preservado. Aprendido do Portal: wrapper único, lazy loading via window[key], helpers compartilhados (fetchImgData, compositeLogoOnBackground), portalTokens.js centraliza branding, fontes Poppins embedded. Phase 3 (DOCX) + Phase 4 (link web ativado) + Phase 5 (email Graph) ficam pra próximas releases reusando patterns do Portal.',
  bucket:         'large',
  multiplierIds: ['investigation'],
  profile:        'feature',
  humanHours:     6.5,
  completedAt:    new Date('2026-05-19T02:00:00-03:00'),
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
