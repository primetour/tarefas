/**
 * dev_hours entry pra release 4.43.0 (Sprint 4 — Roteiros × Tasks integration).
 * Idempotente: upserta por releaseVersion.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const HOURLY_RATE = 150;
const AI_MULT = 0.50;

const REL = {
  releaseVersion: '4.43.0',
  releaseSlug:    '20260518-roteiros-sprint4-tasks-integration',
  title:          'roteiros: Sprint 4 — integração com módulo de tarefas (auto-geração)',
  summary:        'Sprint 4 do refactor do módulo de Roteiros: INTEGRAÇÃO COM TAREFAS. Quando user salva com status=approved e workflowMode=system (default), sistema oferece gerar N tarefas operacionais via confirm(): reservar voos (14d antes), confirmar hotéis (1 por hotel, 14d antes), organizar transfers (10d antes), seguro viagem (7d antes), enviar materiais (7d antes), emitir vouchers (3d antes). Schema: linkedTaskIds[] + tasksGeneratedAt em roteiro. Novo service js/services/roteiroTasks.js (300 linhas) com generateOperationalTasksForRoteiro (IDempotente via _deterministicId roteiro-{id}-{op}-{suffix?}), fetchLinkedTasksLite (chunked getDoc pra 30+ tasks), calcLinkedTasksProgress. handleSave captura prevStatus, dispara maybeOfferTaskGeneration na transição draft/review→approved. Nova subseção "🔗 Tarefas vinculadas" em Avançado: lista async com progress bar, status badges coloridas, ícone por operação (✈🏨🚐🛡📦🎟), flag overdue, link pra módulo /tasks. Listagem /roteiros: badge "🔗 N" ao lado do título. Tasks tem tags=["roteiro","operacional"] + customFields={roteiroId, roteiroOperation} pra rastreabilidade. Assignees herdam consultantId + collaboratorIds[] do Sprint 2. workflowMode=offline → no-op explícito. stripInternalFields + stripInternalForPublicLink agora removem linkedTaskIds + tasksGeneratedAt (não vazam pra cliente).',
  bucket:         'large',
  multiplierIds: ['integration'],
  profile:        'feature',
  humanHours:     7.5,
  completedAt:    new Date('2026-05-19T00:30:00-03:00'),
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
