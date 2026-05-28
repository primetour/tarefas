const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  console.log('═══════ ESTADO ATUAL DA COLEÇÃO templates ═══════\n');

  // 1. Inventário geral
  const allSnap = await db.collection('templates').get();
  console.log(`Total templates: ${allSnap.size}`);
  const byModule = {}, byFormat = {}, byStatus = {}, byOwner = {};
  allSnap.docs.forEach(d => {
    const x = d.data();
    byModule[x.module || 'NULL'] = (byModule[x.module || 'NULL'] || 0) + 1;
    byFormat[x.format || 'NULL'] = (byFormat[x.format || 'NULL'] || 0) + 1;
    byStatus[x.status || 'NULL'] = (byStatus[x.status || 'NULL'] || 0) + 1;
    const o = x.areaId || x.ownerId || 'GLOBAL';
    byOwner[o] = (byOwner[o] || 0) + 1;
  });
  console.log('Por module:', JSON.stringify(byModule));
  console.log('Por format:', JSON.stringify(byFormat));
  console.log('Por status:', JSON.stringify(byStatus));
  console.log('Por owner:', JSON.stringify(byOwner));

  // 2. Templates por área (consumidores)
  console.log('\n═══════ ÁREAS COM templateRefs ═══════\n');
  const areasSnap = await db.collection('portal_areas').get();
  for (const a of areasSnap.docs) {
    const x = a.data();
    if (x.templateRefs && Object.keys(x.templateRefs).length > 0) {
      console.log(`Área "${x.name}":`, JSON.stringify(x.templateRefs));
    }
  }

  // 3. Templates archived que estão referenciados em alguma área (orphan risk)
  console.log('\n═══════ ORPHAN REFS (archived/missing templates referenciados) ═══════\n');
  const refIds = new Set();
  areasSnap.docs.forEach(a => {
    const refs = a.data().templateRefs || {};
    for (const mod of Object.keys(refs)) {
      for (const fmt of Object.keys(refs[mod] || {})) {
        if (refs[mod][fmt]) refIds.add(refs[mod][fmt]);
      }
    }
  });
  console.log(`Total IDs referenciados: ${refIds.size}`);
  for (const id of refIds) {
    const t = await db.collection('templates').doc(id).get();
    if (!t.exists) {
      console.log(`  ❌ ORPHAN ${id} — doc deletado mas área ainda refere`);
    } else if (t.data().status !== 'active') {
      console.log(`  ⚠️ ARCHIVED ${id} (${t.data().name}) — área refere mas tá ${t.data().status}`);
    }
  }

  // 4. Validation de schema obrigatórios
  console.log('\n═══════ SCHEMA VALIDATION ═══════\n');
  const fieldsRequired = ['name', 'module', 'format', 'status', 'fileUrl', 'uploadedBy', 'createdAt'];
  let bad = 0;
  allSnap.docs.forEach(d => {
    const x = d.data();
    const missing = fieldsRequired.filter(f => x[f] === undefined || x[f] === null);
    if (missing.length) {
      console.log(`  ⚠️ ${d.id} (${x.name || 'NO_NAME'}) faltam: ${missing.join(', ')}`);
      bad++;
    }
  });
  console.log(`Templates com schema incompleto: ${bad}/${allSnap.size}`);

  process.exit(0);
})();
