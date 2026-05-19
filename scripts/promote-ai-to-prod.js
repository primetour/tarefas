/**
 * Promove a classificação IA (extracted.aiCommercial/aiTourism) para
 * os campos de produção (extracted.commercial/tourism), preservando
 * o valor antigo do regex em backup pra rollback rápido.
 *
 * v4.49.42+
 *
 * QUANDO RODAR
 *   Só depois de validar empiricamente no dashboard "Shadow mode" que
 *   a concordância está ≥ 90% em AMBOS eixos por pelo menos 2 corridas
 *   consecutivas, e que as divergências top são casos onde a IA está
 *   CERTA (não onde está errada).
 *
 * O QUE FAZ
 *   Pra cada doc em mc_performance onde:
 *     - extracted.aiCommercial existe
 *     - extracted.aiConfidence !== 'low'
 *     - extracted.commercialPromotedAt NÃO existe (idempotente)
 *
 *   Grava:
 *     extracted.commercialPrev      ← extracted.commercial (backup do regex)
 *     extracted.tourismPrev         ← extracted.tourism    (backup do regex)
 *     extracted.commercial          ← extracted.aiCommercial (promoção)
 *     extracted.tourism             ← extracted.aiTourism    (promoção)
 *     extracted.commercialSource    ← 'ai-' + aiAgentVersion
 *     extracted.commercialPromotedAt ← ISO timestamp
 *     extracted.promotedFromConfidence ← aiConfidence
 *
 *   E grava 1 doc em nl_classifier_promotions com o resumo.
 *
 * SEGURANÇA
 *   - Idempotente (skip docs já promovidos)
 *   - Backup do valor antigo em commercialPrev/tourismPrev
 *   - Filtro confidence != 'low' (não promove o que IA não confiou)
 *   - --dry mostra o que faria sem gravar
 *   - --confidence={low|medium|high} ajusta o threshold (default: medium)
 *   - --only-eixo=commercial|tourism|both (default: both)
 *
 * ROLLBACK
 *   scripts/rollback-ai-classification.js restaura commercialPrev → commercial
 *   pra todos os docs que tiverem commercialPromotedAt.
 */
const admin = require('firebase-admin');

if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
} else {
  admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
}
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const DRY = process.argv.includes('--dry');
const CONF_ARG = process.argv.find(a => a.startsWith('--confidence='));
const MIN_CONF = (CONF_ARG ? CONF_ARG.split('=')[1] : 'medium').toLowerCase();
const EIXO_ARG = process.argv.find(a => a.startsWith('--only-eixo='));
const EIXO = (EIXO_ARG ? EIXO_ARG.split('=')[1] : 'both').toLowerCase();

const CONF_RANK = { low: 1, medium: 2, high: 3 };
const MIN_CONF_RANK = CONF_RANK[MIN_CONF] || 2;

console.log(`${DRY ? '🔍 DRY-RUN' : '✏  ESCREVENDO'} · Promote AI → Production v4.49.42`);
console.log(`   threshold de confiança mínima: ${MIN_CONF} (rank ${MIN_CONF_RANK})`);
console.log(`   eixos a promover: ${EIXO}`);

(async () => {
  const snap = await db.collection('mc_performance').get();
  const docs = snap.docs.map(d => ({ _id: d.id, _ref: d.ref, ...d.data() }));

  const candidates = docs.filter(d => {
    const ex = d.extracted || {};
    if (!ex.aiCommercial || !ex.aiTourism) return false;
    if (ex.commercialPromotedAt) return false;  // idempotente
    const confRank = CONF_RANK[ex.aiConfidence] || 0;
    if (confRank < MIN_CONF_RANK) return false;
    return true;
  });

  console.log(`📚 ${docs.length} docs total · ${candidates.length} candidatos a promover`);
  if (!candidates.length) {
    console.log(`✓ Nada a promover. Saindo.`);
    process.exit(0);
  }

  const stats = {
    promoted: 0,
    skipped: 0,
    changedCommercial: 0,  // promoção mudou o valor de commercial
    changedTourism: 0,     // idem tourism
    bothSame: 0,           // promoção concorda com o regex (no-op visível)
  };
  const samples = [];

  for (const d of candidates) {
    const ex = d.extracted;
    const update = {
      'extracted.commercialPrev':        ex.commercial || null,
      'extracted.tourismPrev':           ex.tourism    || null,
      'extracted.commercialPromotedAt':  new Date().toISOString(),
      'extracted.promotedFromConfidence': ex.aiConfidence,
      'extracted.commercialSource':      `ai-${ex.aiAgentVersion || 'unknown'}`,
    };
    let changedC = false, changedT = false;
    if (EIXO === 'both' || EIXO === 'commercial') {
      if (ex.commercial !== ex.aiCommercial) changedC = true;
      update['extracted.commercial'] = ex.aiCommercial;
    }
    if (EIXO === 'both' || EIXO === 'tourism') {
      if (ex.tourism !== ex.aiTourism) changedT = true;
      update['extracted.tourism'] = ex.aiTourism;
    }

    if (changedC) stats.changedCommercial++;
    if (changedT) stats.changedTourism++;
    if (!changedC && !changedT) stats.bothSame++;

    if (samples.length < 15 && (changedC || changedT)) {
      samples.push({
        name: d.name || d._id,
        subject: (d.subject || '').slice(0, 80),
        from: { commercial: ex.commercial, tourism: ex.tourism },
        to:   { commercial: ex.aiCommercial, tourism: ex.aiTourism },
        confidence: ex.aiConfidence,
      });
    }

    if (!DRY) await d._ref.update(update);
    stats.promoted++;
  }

  console.log(`\n═════════════════════════════════════`);
  console.log(`📊 Promovidos: ${stats.promoted}`);
  console.log(`   • mudaram commercial: ${stats.changedCommercial}`);
  console.log(`   • mudaram tourism:    ${stats.changedTourism}`);
  console.log(`   • IA concorda total:  ${stats.bothSame} (no-op visível)`);
  console.log(`\nAmostra das mudanças (até 15):`);
  samples.forEach((s, i) => {
    console.log(`  ${i+1}. [${s.name}] "${s.subject}"`);
    console.log(`     ${s.from.commercial}|${s.from.tourism} → ${s.to.commercial}|${s.to.tourism}  (conf ${s.confidence})`);
  });

  if (!DRY) {
    await db.collection('nl_classifier_promotions').add({
      promotedAt:        FV.serverTimestamp(),
      total:             stats.promoted,
      changedCommercial: stats.changedCommercial,
      changedTourism:    stats.changedTourism,
      bothSame:          stats.bothSame,
      minConfidence:     MIN_CONF,
      eixo:              EIXO,
      triggeredBy:       process.env.GITHUB_RUN_ID ? `github-actions:${process.env.GITHUB_RUN_ID}` : 'local',
      samples,
    });
    console.log(`\n✓ Resumo gravado em nl_classifier_promotions.`);
    console.log(`💡 Pra reverter: rodar workflow "Rollback AI Classification" ou scripts/rollback-ai-classification.js`);
  } else {
    console.log(`\n(dry-run, nada gravado)`);
  }
  process.exit(0);
})().catch(e => {
  console.error(`💥 Falha: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
