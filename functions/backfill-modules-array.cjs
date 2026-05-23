/**
 * Backfill dev_hours.modules[] retroativo.
 *
 * Sintoma: na aba "Foco em produto" do dev-hours-view, Banco de Roteiros
 * aparece zerado mesmo com 11+ entries marcadas com `module: 'banco-roteiros'`.
 *
 * Causa: detectEntryModules() em devHours.js verifica `Array.isArray(entry.modules)`
 * (plural). Eu populei `module: 'banco-roteiros'` (singular). Heurística por
 * título tb não pega entries cujo título começa só com "Banco" (sem "de Roteiros"),
 * porque o regex exige a forma completa pra não conflitar com "Banco de Imagens".
 *
 * Fix:
 *  1. Para todo doc com `module === 'banco-roteiros'` sem `modules` setado, popular
 *     `modules: ['banco-roteiros']`.
 *  2. Idem pra outros módulos (`module === 'roteiros'`, `module === 'banco-imagens'`,
 *     etc.) caso existam casos paralelos.
 *
 * Idempotente: skip se já tem `modules` array com o mesmo valor.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const SINGULAR_TO_ARRAY = {
  'banco-roteiros':  ['banco-roteiros'],
  'roteiros':        ['roteiros'],
  'portal':          ['portal'],
  'images':          ['images'],
  'iahub':           ['iahub'],
};

(async () => {
  const snap = await db.collection('dev_hours').get();
  console.log(`Scanning ${snap.size} dev_hours docs...`);

  let updated = 0;
  let skipped = 0;
  let noModule = 0;

  for (const d of snap.docs) {
    const data = d.data();
    const singular = data.module;

    if (!singular) { noModule++; continue; }

    const expected = SINGULAR_TO_ARRAY[singular];
    if (!expected) {
      console.log(`  ⚠ ${d.id} module="${singular}" → não mapeado (skip)`);
      continue;
    }

    const current = Array.isArray(data.modules) ? data.modules : null;
    if (current && current.includes(singular)) {
      skipped++;
      continue;
    }

    // Mescla com modules existentes (se houver) sem duplicar
    const merged = Array.from(new Set([...(current || []), ...expected]));
    await d.ref.update({ modules: merged });
    console.log(`  + ${d.id} v${data.releaseVersion || '?'} "${(data.title || '').slice(0,50)}" → modules=[${merged.join(',')}]`);
    updated++;
  }

  console.log(`\nDone. ${updated} updated, ${skipped} already had array, ${noModule} sem campo module.`);
  process.exit(0);
})();
