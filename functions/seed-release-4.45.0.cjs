/**
 * dev_hours entry pra release 4.45.0 (Sprint 5 Phase 4 — link web ativado).
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const HOURLY_RATE = 150;
const AI_MULT = 0.50;

const REL = {
  releaseVersion: '4.45.0',
  releaseSlug:    '20260518-sprint5-phase4-weblink-activated',
  title:          'roteiros: Sprint 5 Phase 4 — link web público ativado',
  summary:        'Phase 4 do Sprint 5: gen-link no editor (era "em breve" desde Sprint 4) agora gera link público real via createWebLink + modal de compartilhamento UX idêntica ao Portal de Dicas (URL + Abrir + Copiar + token visível). Bank guard preservado (cliente de banco vê alerta antes; pode forçar via callback). Privacy 100%: createWebLink já aplica stripInternalForPublicLink (Sprint 2/4) — costPricing zerado, collaboratorIds/workflowMode/aiPrompt/linkedTaskIds/tasksGeneratedAt removidos do snapshot público. Token UUID 16-char. URL formada client-side: {baseUrl}roteiro-view.html#{token}. Modal usa clipboard API c/ fallback document.execCommand. Foco em paridade UX com Portal — pattern testado e maduro.',
  bucket:         'medium',
  multiplierIds: [],
  profile:        'feature',
  humanHours:     2.0,
  completedAt:    new Date('2026-05-19T02:30:00-03:00'),
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
