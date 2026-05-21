/**
 * Rollback do promote-ai-to-prod.js — restaura commercialPrev/tourismPrev
 * para commercial/tourism, removendo os marcadores de promoção.
 *
 * v4.49.42+
 *
 * QUANDO RODAR
 *   Se após o promote-ai-to-prod.js você identificar regressão (categoria
 *   errada generalizada, dashboard mostrando números esquisitos, etc.).
 *
 *   Tempo entre promote e rollback: idealmente < 24h (antes que novos
 *   docs cheguem e fiquem só com classificação IA sem backup do regex).
 *   Se passou mais tempo, considerar antes rodar o regex
 *   classify-content.js de novo pra ter um baseline.
 *
 * O QUE FAZ
 *   Pra cada doc onde extracted.commercialPromotedAt existe:
 *     - commercial    ← commercialPrev   (restaura regex)
 *     - tourism       ← tourismPrev      (restaura regex)
 *     - apaga: commercialPrev, tourismPrev, commercialPromotedAt,
 *              promotedFromConfidence, commercialSource
 *     - mantém: aiCommercial, aiTourism, aiConfidence, aiReasoning,
 *               aiModel, aiAgentVersion, aiClassifiedAt (shadow mode
 *               permanece — só a promoção foi revertida)
 *
 *   Grava 1 doc em nl_classifier_rollbacks com o resumo.
 *
 * FLAGS
 *   --dry          mostra o que faria sem gravar
 *   --since=<ISO>  só reverte docs promovidos depois desta data
 *                  (ex: --since=2026-05-20T00:00:00Z)
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
const SINCE_ARG = process.argv.find(a => a.startsWith('--since='));
const SINCE_ISO = SINCE_ARG ? SINCE_ARG.split('=')[1] : null;
const sinceMs = SINCE_ISO ? new Date(SINCE_ISO).getTime() : null;

console.log(`${DRY ? '🔍 DRY-RUN' : '⏪  REVERTENDO'} · Rollback AI Classification v4.49.42`);
if (SINCE_ISO) console.log(`   filtro: só docs promovidos depois de ${SINCE_ISO}`);

(async () => {
  const snap = await db.collection('mc_performance').get();
  const docs = snap.docs.map(d => ({ _id: d.id, _ref: d.ref, ...d.data() }));

  const candidates = docs.filter(d => {
    const ex = d.extracted || {};
    if (!ex.commercialPromotedAt) return false;
    if (sinceMs) {
      const promotedAt = new Date(ex.commercialPromotedAt).getTime();
      if (promotedAt < sinceMs) return false;
    }
    return true;
  });

  console.log(`📚 ${docs.length} docs total · ${candidates.length} candidatos a reverter`);
  if (!candidates.length) {
    console.log(`✓ Nada a reverter. Saindo.`);
    process.exit(0);
  }

  const stats = { reverted: 0, errors: 0, missingBackup: 0 };
  const samples = [];

  for (const d of candidates) {
    const ex = d.extracted;
    // Defesa: se commercialPrev é null/undefined significa que NÃO havia
    // valor de regex antes (doc só foi classificado pela IA). Nesse caso
    // limpar commercial/tourism deixaria o doc "sem classificação" — pior
    // que manter a IA. Pulamos esses docs e logamos.
    if (ex.commercialPrev == null && ex.tourismPrev == null) {
      stats.missingBackup++;
      continue;
    }
    try {
      const update = {
        'extracted.commercialPromotedAt':     FV.delete(),
        'extracted.promotedFromConfidence':   FV.delete(),
        'extracted.commercialSource':         FV.delete(),
        'extracted.commercialPrev':           FV.delete(),
        'extracted.tourismPrev':              FV.delete(),
      };
      if (ex.commercialPrev != null) update['extracted.commercial'] = ex.commercialPrev;
      if (ex.tourismPrev    != null) update['extracted.tourism']    = ex.tourismPrev;
      if (samples.length < 15) {
        samples.push({
          name: d.name || d._id,
          subject: (d.subject || '').slice(0, 80),
          restored: { commercial: ex.commercialPrev, tourism: ex.tourismPrev },
          undid:    { commercial: ex.commercial,     tourism: ex.tourism },
        });
      }
      if (!DRY) await d._ref.update(update);
      stats.reverted++;
    } catch (e) {
      stats.errors++;
      console.error(`  ✗ ${d.name || d._id}: ${e.message}`);
    }
  }

  console.log(`\n═════════════════════════════════════`);
  console.log(`📊 Revertidos:        ${stats.reverted}`);
  console.log(`   Erros:              ${stats.errors}`);
  console.log(`   Sem backup (skip):  ${stats.missingBackup}`);
  console.log(`\nAmostra das reversões (até 15):`);
  samples.forEach((s, i) => {
    console.log(`  ${i+1}. [${s.name}] "${s.subject}"`);
    console.log(`     ${s.undid.commercial}|${s.undid.tourism} → ${s.restored.commercial}|${s.restored.tourism}`);
  });

  if (!DRY) {
    await db.collection('nl_classifier_rollbacks').add({
      rolledBackAt:  FV.serverTimestamp(),
      total:         stats.reverted,
      errors:        stats.errors,
      missingBackup: stats.missingBackup,
      sinceFilter:   SINCE_ISO,
      triggeredBy:   process.env.GITHUB_RUN_ID ? `github-actions:${process.env.GITHUB_RUN_ID}` : 'local',
      samples,
    });
    console.log(`\n✓ Resumo gravado em nl_classifier_rollbacks.`);
  } else {
    console.log(`\n(dry-run, nada gravado)`);
  }
  process.exit(0);
})().catch(e => {
  console.error(`💥 Falha: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
