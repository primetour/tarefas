// Backfill v4.63.x dev_hours: adiciona 'templates' em modules[] pras 12+ releases
// da Sprint v4.63 (upload de templates real, biblioteca, editor de áreas tab,
// generators honor refs, pós-audit safety-net, security lockdown, perf).
//
// Uso:
//   node backfill-templates-module.cjs           # dry-run
//   node backfill-templates-module.cjs --apply   # write
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const APPLY = process.argv.includes('--apply');

// Versions que tocaram Templates (Foco em Produto módulo `templates`):
// - 4.63.0 → 4.63.14+ : Sprint Biblioteca de Templates inteira (upload real,
//   biblioteca, editor tab, generators honor refs, audit fixes)
// - 4.62.39 → 4.62.49 : Sprint Templates de Áreas (Fases A-F, exports, BU sync)
// - 4.62.50, 4.62.51 : rename canônico cotacoes + audit zumbis
// - 4.48.0 : sprint 6b/6c templates evoluídos (fonts + editorial)
//
// Regex é MAIS estrita que /template/i — title precisa ter token específico
// ("Template", "Biblioteca", "templateRefs"), summary é IGNORADO.
const ALLOWED_VERSIONS = new Set([
  '4.48.0',
  '4.62.39', '4.62.40', '4.62.41', '4.62.42', '4.62.43', '4.62.44',
  '4.62.45', '4.62.46', '4.62.47', '4.62.48', '4.62.49', '4.62.50', '4.62.51',
  '4.63.0', '4.63.1', '4.63.2', '4.63.3', '4.63.4', '4.63.5', '4.63.6',
  '4.63.7', '4.63.8', '4.63.9', '4.63.10', '4.63.11', '4.63.12', '4.63.13',
  '4.63.14',
]);
// Backup heurístico title-only pra entries futuras (case-insensitive)
const TITLE_PATTERN = /\b(template|biblioteca de templates|template[-_ ]?refs|template[-_ ]?adapter)\b/i;

function shouldAdd(entry) {
  const v = entry.releaseVersion || '';
  if (ALLOWED_VERSIONS.has(v)) return true;
  return TITLE_PATTERN.test(entry.title || '');
}

(async () => {
  const snap = await db.collection('dev_hours').limit(500).get();
  let touched = 0, skipped = 0, added = 0;
  const batch = db.batch();
  for (const d of snap.docs) {
    const data = d.data();
    if (!shouldAdd(data)) continue;
    touched++;
    const cur = Array.isArray(data.modules) ? data.modules : [];
    if (cur.includes('templates')) { skipped++; continue; }
    const next = [...cur, 'templates'];
    console.log(`+ ${data.releaseVersion || '?'} | ${(data.title || '').slice(0,60)} | modules: [${cur.join(',')}] -> [${next.join(',')}]`);
    if (APPLY) batch.update(d.ref, { modules: next });
    added++;
  }
  if (APPLY) {
    await batch.commit();
    console.log(`\n✓ APPLY: ${added} docs updated, ${skipped} already had templates, ${touched} touched`);
  } else {
    console.log(`\n✓ DRY-RUN: ${added} docs would be updated, ${skipped} already have templates, ${touched} touched`);
    console.log(`Run with --apply to write.`);
  }
  process.exit(0);
})();
