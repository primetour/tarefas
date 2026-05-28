const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  const tok = process.argv[2];
  const snap = await db.collection('portal_web_links').doc(tok).get();
  if (!snap.exists) { console.log('NOT FOUND'); process.exit(1); }
  const d = snap.data();
  console.log('webTemplate:', JSON.stringify(d.webTemplate, null, 2));
  console.log('areaName:', d.areaName);
  console.log('tipData count:', d.tipData?.length);
  console.log('hasColors:', !!d.colors);
  process.exit(0);
})();
