const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const areasSnap = await db.collection('portal_areas').get();
  console.log(`═══════ Auditando ${areasSnap.size} áreas ═══════\n`);

  let totalRefs = 0, healthyRefs = 0, brokenRefs = 0;
  const issues = [];

  for (const a of areasSnap.docs) {
    const area = a.data();
    const refs = area.templateRefs || {};
    if (!refs || Object.keys(refs).length === 0) continue;

    for (const mod of Object.keys(refs)) {
      for (const fmt of Object.keys(refs[mod] || {})) {
        const tplId = refs[mod][fmt];
        if (!tplId) continue;
        totalRefs++;
        const t = await db.collection('templates').doc(tplId).get();
        if (!t.exists) {
          issues.push({ area: area.name, mod, fmt, tplId, severity: 'CRITICAL', reason: 'template DELETADO (orphan ref)' });
          brokenRefs++;
        } else {
          const tplData = t.data();
          const isE2E = /^E2E /.test(tplData.name || '');
          const isArchived = tplData.status !== 'active';
          const modMismatch = tplData.module && tplData.module !== mod && !(mod === 'cotacoes' && tplData.module === 'roteiros');
          const fmtMismatch = tplData.format && tplData.format !== fmt;
          if (isE2E) {
            issues.push({ area: area.name, mod, fmt, tplId, severity: 'CRITICAL', reason: `template é "${tplData.name}" (E2E test em produção!)` });
            brokenRefs++;
          } else if (isArchived) {
            issues.push({ area: area.name, mod, fmt, tplId, severity: 'HIGH', reason: `archived: "${tplData.name}" status=${tplData.status}` });
            brokenRefs++;
          } else if (modMismatch || fmtMismatch) {
            issues.push({ area: area.name, mod, fmt, tplId, severity: 'HIGH', reason: `mismatch: template é ${tplData.module}/${tplData.format} mas atribuído como ${mod}/${fmt}` });
            brokenRefs++;
          } else {
            healthyRefs++;
          }
        }
      }
    }
  }

  console.log(`Refs totais: ${totalRefs}`);
  console.log(`Healthy: ${healthyRefs} ✓`);
  console.log(`Broken: ${brokenRefs} ✗\n`);

  if (issues.length === 0) {
    console.log('🎉 Nenhum problema! Todas templateRefs apontam pra templates ativos e compatíveis.\n');
  } else {
    console.log(`═══ ${issues.length} ISSUES ENCONTRADOS ═══\n`);
    issues.forEach(i => console.log(`  [${i.severity}] ${i.area} → ${i.mod}/${i.fmt} (${i.tplId.slice(0,12)}…)\n    → ${i.reason}\n`));
  }

  process.exit(0);
})();
