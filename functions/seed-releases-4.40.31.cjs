/**
 * dev_hours entry pra release 4.40.31 (Sprint 1 do refactor de Roteiros).
 * Marcada com modules:['roteiros'] pra aparecer no tab "Foco em produto".
 * Idempotente: upserta por releaseVersion.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const HOURLY_RATE = 150;
const AI_MULT = 0.50;

const RELEASES = [
  {
    releaseVersion: '4.40.31',
    releaseSlug:    '20260518-roteiros-sprint1-hardening',
    title:          'roteiros: Sprint 1 — hardening rules + 7 bug fixes + hierarquia',
    summary:        'Sprint 1 do refactor do módulo de Roteiros (audit revelou ~9k linhas pré-existentes). FIRESTORE RULES: update agora exige ownership (consultantId==self), collaborator (uid in collaboratorIds), ou manager+ — antes era allow update if isAuth (vetor de tampering pra audit bancária). Create exige consultantId==self. BUG FIXES: B01 idades de crianças truncadas pra count atualizado (collectFormData), B04 destinos sem cidade filtrados (sanitizeForSave novo), B05 preços negativos clamp 0 (pricing+optionals), B06 items vazios filtrados em optionals/cancellation/customRows/customFields, B07 dedup case-insensitive em presets includes/excludes. B02/B03 verificados — já resolvidos em iterações anteriores. HIERARQUIA: fetchRoteiros simplificada (sempre todos com orderBy server-side); filtragem aplicada na page via getVisibleUserIds (mesmo padrão de /goals e /feedbacks): master/roteiro_manage→todos, gerente→próprios+subordinados transitivos, analista→próprios+collaboratorIds. Field collaboratorIds[] preparado pro Sprint 2 (multi-colaborador via UI).',
    bucket:         'medium',
    multiplierIds: ['security', 'investigation'],
    profile:        'feature',
    humanHours:     5.5,
    completedAt:    new Date('2026-05-18T20:00:00-03:00'),
    modules:        ['roteiros'],  // → tab "Foco em produto"
  },
];

async function upsert(rel) {
  const factor = 1 + rel.multiplierIds.reduce((s, id) => {
    const m = { investigation: 0.30, migration: 0.20, pdf: 0.15, integration: 0.20, security: 0.25, pure_refactor: -0.20 }[id];
    return s + (m ?? 0);
  }, 0);
  const humanEquivalentHours = +(rel.humanHours * factor).toFixed(2);
  const totalHours           = +(humanEquivalentHours * AI_MULT).toFixed(2);
  const totalCost            = +(totalHours * HOURLY_RATE).toFixed(2);

  const profileRatios = {
    feature: { refinamento: 0.20, desenvolvimento: 0.50, testes: 0.10, documentacao: 0.15, implantacao: 0.05 },
    bugfix:  { refinamento: 0.30, desenvolvimento: 0.40, testes: 0.15, documentacao: 0.10, implantacao: 0.05 },
    phase:   { refinamento: 0.15, desenvolvimento: 0.55, testes: 0.10, documentacao: 0.10, implantacao: 0.10 },
  }[rel.profile] || { refinamento: 0.20, desenvolvimento: 0.50, testes: 0.10, documentacao: 0.15, implantacao: 0.05 };

  const hoursByCategory = {};
  let allocated = 0;
  for (const k of Object.keys(profileRatios)) {
    hoursByCategory[k] = +(totalHours * profileRatios[k]).toFixed(2);
    allocated += hoursByCategory[k];
  }
  const diff = +(totalHours - allocated).toFixed(2);
  if (diff !== 0) hoursByCategory.desenvolvimento = +(hoursByCategory.desenvolvimento + diff).toFixed(2);

  const payload = {
    entryType:               'release',
    releaseVersion:          rel.releaseVersion,
    releaseSlug:             rel.releaseSlug,
    title:                   rel.title,
    summary:                 rel.summary,
    bucket:                  rel.bucket,
    multiplierIds:           rel.multiplierIds,
    profile:                 rel.profile,
    humanEquivalentHours,
    aiAssistanceMultiplier:  AI_MULT,
    totalHours,
    totalCost,
    hourlyRate:              HOURLY_RATE,
    hoursByCategory,
    completedAt:             admin.firestore.Timestamp.fromDate(rel.completedAt),
    status:                  'approved',
    approvedAt:              admin.firestore.FieldValue.serverTimestamp(),
    approvedBy:              { uid: 'system-seed', name: 'Sistema' },
    createdAt:               admin.firestore.FieldValue.serverTimestamp(),
    createdBy:               { uid: 'system-seed', name: 'Sistema' },
    modules:                 rel.modules || [],
  };

  // Upsert por releaseVersion
  const q = await db.collection('dev_hours').where('releaseVersion', '==', rel.releaseVersion).get();
  if (q.empty) {
    await db.collection('dev_hours').add(payload);
    console.log(`✅ Criada release ${rel.releaseVersion} (${totalHours}h · R$ ${totalCost})`);
  } else {
    await q.docs[0].ref.update(payload);
    console.log(`✓ Atualizada release ${rel.releaseVersion} (${totalHours}h · R$ ${totalCost})`);
  }
}

(async () => {
  for (const r of RELEASES) await upsert(r);
  console.log('Done.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
