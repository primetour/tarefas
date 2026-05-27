/**
 * Cleanup schema lixo v4.59.7 — roteiros_bank
 *
 * Remove:
 *   - `_envisionCurrency` (top-level _-prefixed, era debug) → migra pra envision.currency
 *   - `envisionRaw.imageUuids` (redundante — URLs CDN já em images.gallery)
 *
 * Idempotente: docs sem esses campos são skipped.
 * Dry-run por default; passar --apply pra escrever.
 *
 * Uso:
 *   cd functions && node cleanup-bank-envision-schema.cjs           # dry-run
 *   cd functions && node cleanup-bank-envision-schema.cjs --apply   # execute
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV  = admin.firestore.FieldValue;
const APPLY = process.argv.includes('--apply');

console.log(`\n[cleanup-envision-schema] Modo: ${APPLY ? '🟢 APPLY' : '🟡 DRY-RUN'}\n`);

(async () => {
  const snap = await db.collection('roteiros_bank').get();
  let totalSeen = 0, withCurrency = 0, withImageUuids = 0, migrated = 0, skipped = 0;

  let batch = db.batch();
  let ops = 0;

  for (const docSnap of snap.docs) {
    totalSeen++;
    const data = docSnap.data();
    const hasOldCurrency  = data._envisionCurrency !== undefined;
    const hasImageUuids   = data.envisionRaw && Object.prototype.hasOwnProperty.call(data.envisionRaw, 'imageUuids');
    if (!hasOldCurrency && !hasImageUuids) { skipped++; continue; }

    const update = {};
    if (hasOldCurrency) {
      withCurrency++;
      // Migra valor pra envision.currency só se ainda não tiver
      const existingEnvCurrency = data.envision?.currency;
      if (data._envisionCurrency && !existingEnvCurrency) {
        update['envision.currency'] = data._envisionCurrency;
      }
      update._envisionCurrency = FV.delete();
    }
    if (hasImageUuids) {
      withImageUuids++;
      update['envisionRaw.imageUuids'] = FV.delete();
    }

    if (APPLY) {
      batch.update(docSnap.ref, update);
      ops++;
      if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
    }
    migrated++;
  }
  if (APPLY && ops > 0) await batch.commit();

  console.log(`Total docs: ${totalSeen}`);
  console.log(`  com _envisionCurrency: ${withCurrency}`);
  console.log(`  com envisionRaw.imageUuids: ${withImageUuids}`);
  console.log(`  migrated (write/delete): ${migrated}`);
  console.log(`  skipped (já limpo): ${skipped}`);
  console.log(APPLY ? '\n✓ Cleanup APLICADO em produção.' : '\n✓ DRY-RUN OK. Re-rode com --apply pra aplicar.');
  process.exit(0);
})().catch(e => { console.error('[cleanup] ERRO:', e); process.exit(1); });
