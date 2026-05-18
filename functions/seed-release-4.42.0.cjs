/**
 * dev_hours entry pra release 4.42.0 (Sprint 3 — Portal de Dicas embed).
 * Marca com modules:['roteiros','portal'] pois toca ambos.
 * Idempotente: upserta por releaseVersion.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const HOURLY_RATE = 150;
const AI_MULT = 0.50;

const REL = {
  releaseVersion: '4.42.0',
  releaseSlug:    '20260518-roteiros-sprint3-tips-embed',
  title:          'roteiros: Sprint 3 — embed Portal de Dicas com snapshot + re-publish',
  summary:        'Sprint 3 do refactor do módulo de Roteiros: PORTAL DE DICAS EMBED. Schema novo: embeddedTips[] em cada roteiro com snapshot do conteúdo da dica (city, country, continent, segments + updatedAtSnapshot). Service helpers: snapshotTipForEmbed (busca dica atual + monta snapshot), isEmbeddedTipStale (compara updatedAt). UI nova seção "💡 Dicas anexas" (12ª aba) no editor com modal picker (filtros continent + busca + indicação visual de já anexadas). 3 handlers: open-tip-picker, republish-tip (re-snapshot com a versão atual), remove-tip. Auto-check de stale em background via queueMicrotask. Render: PDF nova seção "DICAS LOCAIS" via buildEmbeddedTipsSection (place_list + simple_list + humanizeSegmentKey); roteiro-view.html nova seção "Dicas Locais" com cards por dica, navegação sticky atualizada. Cliente recebe versão estável da dica — mudanças posteriores no Portal não afetam roteiros já enviados (previsibilidade) até user clicar Re-publicar.',
  bucket:         'large',
  multiplierIds: ['integration'],
  profile:        'feature',
  humanHours:     6.0,
  completedAt:    new Date('2026-05-18T23:30:00-03:00'),
  modules:        ['roteiros', 'portal'],  // toca ambos os módulos
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
