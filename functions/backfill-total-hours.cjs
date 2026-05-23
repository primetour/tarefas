/**
 * Backfill dev_hours: campos `totalHours`/`totalCost` (que a UI lê) a partir
 * de `finalHours`/`finalCost` (que meus seeds populavam por engano).
 *
 * Sintoma: aba "Foco em Produto" mostra Banco de Roteiros e IA Hub zerados,
 * apesar das entries existirem com modules:['banco-roteiros'].
 *
 * Causa: dev-hours-view.html lê `e.totalHours || 0`. Eu populei `finalHours`
 * em add-dev-hours-*.cjs scripts. Convenção do projeto é `totalHours`.
 *
 * Fix: pra todo doc com `finalHours` mas sem `totalHours`, copia.
 * Idempotente. Não mexe em docs que já têm `totalHours` correto.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('dev_hours').get();
  console.log(`Scanning ${snap.size} dev_hours docs...`);

  let updated = 0;
  let skipped = 0;

  for (const d of snap.docs) {
    const data = d.data();
    const hasTotal = typeof data.totalHours === 'number';
    const hasFinal = typeof data.finalHours === 'number';

    if (hasTotal) { skipped++; continue; }
    if (!hasFinal) { skipped++; continue; }

    const update = {
      totalHours: data.finalHours,
      totalCost:  data.finalCost || (data.finalHours * (data.hourlyRate || 150)),
    };
    await d.ref.update(update);
    console.log(`  + ${d.id} v${data.releaseVersion || '?'} "${(data.title || '').slice(0,50)}" → totalHours=${update.totalHours}h`);
    updated++;
  }

  console.log(`\nDone. ${updated} updated, ${skipped} skipped.`);
  process.exit(0);
})();
