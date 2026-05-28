// Smoke v4.63.17 — atribui o template seed à Lazer.templateRefs.portal.html
// (e cleanup com --cleanup)
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const TPL_ID = 'o4uOC40G2p0zdhqt0vsg';

(async () => {
  const mode = process.argv.includes('--cleanup') ? 'cleanup' : 'set';
  const areasSnap = await db.collection('portal_areas').where('name', '==', 'Lazer').limit(1).get();
  if (areasSnap.empty) { console.log('Lazer não encontrado'); process.exit(1); }
  const areaRef = areasSnap.docs[0].ref;
  const areaData = areasSnap.docs[0].data();
  const current = areaData.templateRefs || {};
  const newRefs = JSON.parse(JSON.stringify(current));

  if (mode === 'set') {
    newRefs.portal = newRefs.portal || {};
    const prev = newRefs.portal.html;
    newRefs.portal.html = TPL_ID;
    await areaRef.update({ templateRefs: newRefs, updatedAt: FV.serverTimestamp() });
    console.log(`+ Lazer.templateRefs.portal.html = ${TPL_ID} (anterior: ${prev || '<none>'})`);
    console.log('  Run cleanup: node smoke-attribute-portal-template.cjs --cleanup');
  } else {
    if (newRefs.portal?.html === TPL_ID) {
      delete newRefs.portal.html;
      if (Object.keys(newRefs.portal).length === 0) delete newRefs.portal;
    }
    await areaRef.update({ templateRefs: newRefs, updatedAt: FV.serverTimestamp() });
    console.log(`- Lazer.templateRefs.portal.html removido (${TPL_ID})`);
  }
  process.exit(0);
})();
