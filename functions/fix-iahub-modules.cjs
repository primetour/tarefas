/**
 * Fix módulos do IA Hub no dev_hours.
 *
 * Problemas detectados:
 *   1. Entries com `modules: ['ai-hub', ...]` (typo com hyphen) → o canônico é 'iahub'
 *   2. Entries com `modules: []` explícito mas IA Hub claramente mencionado no título
 *      → foram intencionalmente excluídas no passado, mas precisam reentrar agora
 *
 * Estratégia: pra cada entry cujo title/slug bata o regex IA Hub, garantir
 * que `modules` contenha 'iahub' (preservando outros módulos legítimos).
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

// Mesmo regex de devHours.js
const IAHUB_PAT = /\b((?:ia|ai)[-_ ]?hub|iahub|aihub)\b/i;
// Aliases incorretos que devem virar 'iahub'
const ALIAS_MAP = { 'ai-hub': 'iahub', 'aihub': 'iahub', 'ia-hub': 'iahub' };

(async () => {
  const snap = await db.collection('dev_hours').get();
  console.log(`Scanning ${snap.size} dev_hours docs...`);

  let updated = 0;
  let skipped = 0;

  for (const d of snap.docs) {
    const data = d.data();
    const hay = `${data.title || ''} ${data.releaseSlug || ''} ${data.phaseLabel || ''}`;
    const matches = IAHUB_PAT.test(hay);
    const currentModules = Array.isArray(data.modules) ? [...data.modules] : null;

    // Normaliza aliases (ai-hub → iahub) em entries que tem o array
    let normalized = currentModules?.map(m => ALIAS_MAP[m] || m);
    const hasIaHub = normalized?.includes('iahub');

    if (!matches) { skipped++; continue; }   // não menciona IA Hub
    if (hasIaHub && JSON.stringify(normalized) === JSON.stringify(currentModules)) {
      skipped++; continue;  // já correto
    }

    // Constrói novo modules: preserva outros legítimos + adiciona 'iahub'
    const others = (normalized || []).filter(m => m !== 'iahub');
    const newModules = [...new Set(['iahub', ...others])];
    await d.ref.update({ modules: newModules });
    console.log(`  + ${d.id} v${data.releaseVersion || '?'} "${(data.title || '').slice(0,50)}" → modules=[${newModules.join(',')}]`);
    updated++;
  }

  console.log(`\nDone. ${updated} updated, ${skipped} skipped.`);
  process.exit(0);
})();
