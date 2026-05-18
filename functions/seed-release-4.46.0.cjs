/**
 * dev_hours entry pra release 4.46.0 (Sprint 5 Phase 3 — DOCX).
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const HOURLY_RATE = 150;
const AI_MULT = 0.50;

const REL = {
  releaseVersion: '4.46.0',
  releaseSlug:    '20260518-sprint5-phase3-docx',
  title:          'roteiros: Sprint 5 Phase 3 — DOCX export (Word)',
  summary:        'Conclui Sprint 5 (paridade c/ Portal de Dicas): agora todos os 4 formatos. Nova função generateRoteiroDOCX(roteiro, area) usando lib docx@8.5.0 (mesmo CDN/versão do Portal). Pattern espelha portalGenerator.generateDocx — loadDocx lazy + Document/sections/children + helpers tr/p/hdr/sub/body/cell. Estrutura completa: capa (BU + título + cliente + destinos + período), dia a dia (header + narrative + activities), hospedagem (tabela), valores + customRows + disclaimer, opcionais (tabela), inclui/não inclui (2 listas com ✓/✗), pagamento, cancelamento (tabela), info importantes incl. customFields, dicas locais embedded (max 10 items/segmento), closing. Wrapper único generateRoteiro({format}) agora completo c/ pdf/pptx/docx/web — defensivo stripInternalFields aplicado antes da delegação. Botão "Exportar DOCX" wirado no editor Preview & Export entre PPTX e Gerar Link.',
  bucket:         'medium',
  multiplierIds: ['pdf'],
  profile:        'feature',
  humanHours:     3.5,
  completedAt:    new Date('2026-05-19T03:30:00-03:00'),
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
