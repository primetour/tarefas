/**
 * Recalibra entradas existentes em dev_hours aplicando o fator
 * AI_ASSISTANCE_MULTIPLIER = 0.40.
 *
 * Para cada entrada:
 *   - Se humanEquivalentHours já existe → idempotente, pula
 *   - Senão → guarda totalHours atual como humanEquivalentHours,
 *     recalcula totalHours = humanEquivalentHours × 0.40
 *     totalCost = totalHours × hourlyRate
 *     hoursByCategory: ajusta proporcionalmente (mesma proporção × 0.40)
 *
 * Run:
 *   GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/application_default_credentials.json \
 *   GOOGLE_CLOUD_PROJECT=gestor-de-tarefas-primetour \
 *   node recalibrate-hours.cjs
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const AI_MULTIPLIER = 0.40;

(async () => {
  console.log(`🔧 Recalibrando dev_hours com fator ${AI_MULTIPLIER}\n`);
  const snap = await db.collection('dev_hours').get();
  let updated = 0, skipped = 0, totalBefore = 0, totalAfter = 0;

  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.humanEquivalentHours != null) {
      skipped++;
      console.log(`  ↩ ${d.releaseVersion || d.phaseLabel || doc.id}: já calibrado`);
      continue;
    }
    const humanHrs = +(d.totalHours || 0);
    const newHrs   = Math.max(0.1, +(humanHrs * AI_MULTIPLIER).toFixed(2));
    const rate     = +(d.hourlyRate || 150);
    const newCost  = +(newHrs * rate).toFixed(2);

    // Recalcula breakdown proporcional
    const newCats = {};
    if (d.hoursByCategory) {
      for (const k of Object.keys(d.hoursByCategory)) {
        newCats[k] = +((d.hoursByCategory[k] || 0) * AI_MULTIPLIER).toFixed(2);
      }
    }

    await doc.ref.update({
      humanEquivalentHours:   humanHrs,
      aiAssistanceMultiplier: AI_MULTIPLIER,
      totalHours:             newHrs,
      totalCost:              newCost,
      hoursByCategory:        Object.keys(newCats).length ? newCats : d.hoursByCategory,
      recalibratedAt:         admin.firestore.FieldValue.serverTimestamp(),
    });

    totalBefore += humanHrs;
    totalAfter  += newHrs;
    updated++;
    console.log(`  ✓ ${d.releaseVersion || d.phaseLabel || doc.id}: ${humanHrs}h → ${newHrs}h (R$ ${(humanHrs*rate).toFixed(2)} → R$ ${newCost})`);
  }

  console.log(`\n✓ ${updated} atualizados · ${skipped} já calibrados`);
  console.log(`📉 Total: ${totalBefore.toFixed(2)}h → ${totalAfter.toFixed(2)}h (×${AI_MULTIPLIER})`);
  console.log(`💰 Custo: R$ ${(totalBefore*150).toFixed(2)} → R$ ${(totalAfter*150).toFixed(2)}`);
  process.exit(0);
})().catch(e => { console.error('❌', e); process.exit(1); });
