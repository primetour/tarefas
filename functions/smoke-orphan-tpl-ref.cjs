// Smoke v4.63.14 Bug #8/#9: cria/limpa orphan templateRef em area Lazer
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

(async () => {
  const mode = process.argv[2] || 'set';
  const areasSnap = await db.collection('portal_areas').where('name', '==', 'Lazer').limit(1).get();
  if (areasSnap.empty) { console.log('Lazer não encontrado'); process.exit(1); }
  const areaRef = areasSnap.docs[0].ref;
  const areaId = areasSnap.docs[0].id;
  const current = areasSnap.docs[0].data().templateRefs || {};

  if (mode === 'set') {
    // Adiciona refs órfãs (IDs inexistentes em diferentes módulos/formatos)
    const newRefs = JSON.parse(JSON.stringify(current));
    newRefs.cotacoes = newRefs.cotacoes || {};
    newRefs.cotacoes.docx = 'orphan-fake-docx-' + Date.now();  // ID nunca existiu
    newRefs.portal = newRefs.portal || {};
    newRefs.portal.pptx = 'orphan-fake-pptx-' + Date.now();
    await areaRef.update({ templateRefs: newRefs, updatedAt: FV.serverTimestamp() });
    console.log(`+ Adicionou orphan refs em Lazer (${areaId})`);
    console.log(`  cotacoes.docx = ${newRefs.cotacoes.docx}`);
    console.log(`  portal.pptx   = ${newRefs.portal.pptx}`);
    console.log(`Run cleanup: node smoke-orphan-tpl-ref.cjs cleanup`);
  } else if (mode === 'cleanup') {
    const cleaned = JSON.parse(JSON.stringify(current));
    let removed = 0;
    for (const mod of Object.keys(cleaned)) {
      for (const fmt of Object.keys(cleaned[mod] || {})) {
        if (typeof cleaned[mod][fmt] === 'string' && cleaned[mod][fmt].startsWith('orphan-fake-')) {
          delete cleaned[mod][fmt]; removed++;
        }
      }
      if (Object.keys(cleaned[mod] || {}).length === 0) delete cleaned[mod];
    }
    await areaRef.update({ templateRefs: cleaned, updatedAt: FV.serverTimestamp() });
    console.log(`- Removeu ${removed} orphan refs de Lazer`);
  }
  process.exit(0);
})();
