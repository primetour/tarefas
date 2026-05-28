const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const allSnap = await db.collection('templates').get();

  // ✅ Schema validation com NOMES CORRETOS
  const fieldsRequired = ['name', 'module', 'format', 'status', 'fileUrl', 'uploadedBy', 'uploadedAt'];
  let bad = 0;
  allSnap.docs.forEach(d => {
    const x = d.data();
    const missing = fieldsRequired.filter(f => x[f] === undefined || x[f] === null);
    if (missing.length) {
      console.log(`  ⚠️ ${d.id} (${x.name}) faltam: ${missing.join(', ')}`);
      bad++;
    }
  });
  console.log(`\nTemplates com schema incompleto: ${bad}/${allSnap.size}\n`);

  // 🔴 ZUMBI #1: templates E2E leftover
  console.log('═══════ ZUMBI: Templates E2E leftover (sujeira de testes) ═══════');
  const e2eLeftover = allSnap.docs.filter(d => /^E2E /.test(d.data().name || ''));
  console.log(`Encontrados: ${e2eLeftover.length}`);
  e2eLeftover.forEach(d => {
    const x = d.data();
    console.log(`  ${d.id} — ${x.name} — status=${x.status}, module=${x.module}, format=${x.format}, uploadedBy=${x.uploadedBy?.slice(0,8)}`);
  });

  // 🔴 Múltiplos "PRIMETOUR Cotações — Default HTML" (deveria ter 1 só)
  console.log('\n═══════ Templates default duplicados ═══════');
  const dedup = {};
  allSnap.docs.forEach(d => {
    const x = d.data();
    if (x.isDefault) {
      const key = `${x.module}|${x.format}|${x.ownerType || 'global'}|${x.ownerId || ''}`;
      if (!dedup[key]) dedup[key] = [];
      dedup[key].push({ id: d.id, name: x.name, status: x.status });
    }
  });
  Object.entries(dedup).forEach(([key, list]) => {
    if (list.length > 1) {
      console.log(`  ${key}: ${list.length} candidatos`);
      list.forEach(t => console.log(`    - ${t.id} "${t.name}" status=${t.status}`));
    }
  });

  process.exit(0);
})();
