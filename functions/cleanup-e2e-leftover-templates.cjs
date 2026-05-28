const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const APPLY = process.argv.includes('--apply');

(async () => {
  const snap = await db.collection('templates').get();
  const zumbis = snap.docs.filter(d => /^E2E /.test(d.data().name || ''));
  console.log(`Encontrados ${zumbis.length} templates E2E leftover`);

  // 1. Confirm nenhum está referenciado em portal_areas.templateRefs
  const areasSnap = await db.collection('portal_areas').get();
  const refSet = new Set();
  areasSnap.docs.forEach(a => {
    const refs = a.data().templateRefs || {};
    for (const mod of Object.keys(refs)) {
      for (const fmt of Object.keys(refs[mod] || {})) {
        if (refs[mod][fmt]) refSet.add(refs[mod][fmt]);
      }
    }
  });
  const blocked = zumbis.filter(d => refSet.has(d.id));
  if (blocked.length) {
    console.log(`⚠️ ${blocked.length} estão referenciados em áreas — não podem deletar sem cleanup:`);
    blocked.forEach(d => console.log(`  ${d.id} — ${d.data().name}`));
    process.exit(1);
  }
  console.log('✓ Nenhum referenciado em portal_areas');

  // 2. Log audit antes de deletar + delete batch
  for (const d of zumbis) {
    const x = d.data();
    console.log(`  ${APPLY ? '✗ DELETE' : '○ DRY'}: ${d.id} — ${x.name} (status=${x.status})`);
    if (APPLY) {
      await db.collection('audit_logs').add({
        action: 'templates.cleanup_e2e_leftover',
        entityType: 'templates',
        entityId: d.id,
        actorId: 'system',
        actorName: 'Sistema PRIMETOUR (audit cleanup v4.63.25)',
        details: {
          templateName: x.name, module: x.module, format: x.format, status: x.status,
          fileUrl: x.fileUrl, reason: 'leftover de testes E2E v4.63.x, sem refs ativas',
        },
        severity: 'info',
        timestamp: FV.serverTimestamp(),
      });
      await db.collection('templates').doc(d.id).delete();
    }
  }

  console.log(APPLY ? `\n✓ ${zumbis.length} templates deletados + audit logs.` : `\nDRY-RUN. Use --apply pra executar.`);
  process.exit(0);
})();
