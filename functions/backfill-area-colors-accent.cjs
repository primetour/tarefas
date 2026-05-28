/**
 * v4.63.33 — Backfill colors.accent em portal_areas.
 *
 * Antes: schema só tinha colors.primary + colors.secondary.
 *        Templates HTML hardcoded #D4A843 (gold PRIMETOUR).
 * Agora: colors.accent é 3ª cor configurável por área.
 *
 * Backfill: pra toda área que NÃO tem accent, define accent = primary
 * (fallback safe — comportamento idêntico ao reader em runtime).
 *
 * Reader em areaDefaults.js já faz esse fallback dinamicamente, então
 * o backfill é só pra UI mostrar o color picker pré-preenchido na
 * próxima edição em vez de mostrar default `#D4A843` chocante.
 *
 * Idempotente: re-rodar não muda nada (skip áreas já com accent).
 *
 * Uso:
 *   node functions/backfill-area-colors-accent.cjs           # dry-run
 *   node functions/backfill-area-colors-accent.cjs --apply   # aplica
 */
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const APPLY = process.argv.includes('--apply');

(async () => {
  console.log(`\n[backfill-accent] ${APPLY ? 'APPLY' : 'DRY-RUN'} iniciando...\n`);

  const snap = await db.collection('portal_areas').get();
  let updated = 0, skipped = 0;
  const batch = db.batch();

  for (const doc of snap.docs) {
    const d = doc.data();
    const colors = d.colors || {};
    if (colors.accent) { skipped++; continue; }

    // Fallback: accent = primary (compat 100%, generator faria o mesmo fallback)
    const accent = colors.primary || '#D4A843';
    console.log(`  • ${doc.id.padEnd(28)}  ${d.name?.padEnd(30) || ''}  → accent = ${accent}`);

    if (APPLY) {
      batch.update(doc.ref, { 'colors.accent': accent });
    }
    updated++;
  }

  if (APPLY && updated > 0) {
    await batch.commit();
    console.log(`\n✓ APPLY done. ${updated} áreas atualizadas, ${skipped} já tinham accent.\n`);
  } else if (!APPLY) {
    console.log(`\n✓ DRY-RUN. ${updated} áreas seriam atualizadas, ${skipped} já têm accent. Run com --apply.\n`);
  } else {
    console.log(`\n✓ Nada pra fazer. ${skipped} áreas já têm accent.\n`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
