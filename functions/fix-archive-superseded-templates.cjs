// Achado v4.63.20 double-check: templates antigos virados isDefault=false
// (substituídos por seed novo) ainda têm status=active. Usuário pode atribuir
// versão velha em vez da nova. Fix: arquivar (status=archived) os que foram
// substituídos por seed mais recente.
//
// Uso:
//   node fix-archive-superseded-templates.cjs         # dry-run
//   node fix-archive-superseded-templates.cjs --apply # write
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const APPLY = process.argv.includes('--apply');

(async () => {
  // Pra cada (ownerType=global, module, format), pega o doc com isDefault=true atual
  // e os outros com isDefault=false (substituídos). Arquiva esses outros.
  const modules = ['cotacoes', 'portal', 'banco-roteiros'];
  const formats = ['html'];
  let totalToArchive = 0;

  for (const mod of modules) {
    for (const fmt of formats) {
      const snap = await db.collection('templates')
        .where('ownerType', '==', 'global')
        .where('module', '==', mod)
        .where('format', '==', fmt)
        .where('status', '==', 'active')
        .get();
      const def = snap.docs.find(d => d.data().isDefault === true);
      const superseded = snap.docs.filter(d => d.data().isDefault !== true);
      if (!def || !superseded.length) continue;
      console.log(`\n## ${mod}/${fmt}`);
      console.log(`  ★ default atual: ${def.id} "${def.data().name}"`);
      for (const s of superseded) {
        // Confere se é mais antigo que o default (uploadedAt timestamp)
        const sUp = s.data().uploadedAt?.toMillis?.() || 0;
        const dUp = def.data().uploadedAt?.toMillis?.() || 0;
        if (sUp >= dUp) {
          console.log(`  ⚠ ${s.id} é MAIS RECENTE que default (sUp=${sUp} dUp=${dUp}) — SKIP, suspeito`);
          continue;
        }
        console.log(`  - ${s.id} "${s.data().name}" (older, vai arquivar)`);
        if (APPLY) {
          await s.ref.update({
            status: 'archived',
            archivedAt: FV.serverTimestamp(),
            archivedReason: 'Superseded by newer seed v4.63.17-20 (auto-cleanup pós-audit)',
            updatedAt: FV.serverTimestamp(),
            updatedBy: 'system',
          });
          await db.collection('audit_logs').add({
            action: 'templates.archive',
            userId: 'system',
            entity: 'templates',
            entityId: s.id,
            details: { reason: 'Superseded by newer seed', name: s.data().name },
            severity: 'info',
            timestamp: FV.serverTimestamp(),
          });
        }
        totalToArchive++;
      }
    }
  }

  console.log(`\n${APPLY ? '✓ APPLIED' : '✓ DRY-RUN'}: ${totalToArchive} templates ${APPLY ? 'archived' : 'would be archived'}`);
  process.exit(0);
})();
