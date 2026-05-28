const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  const tplId = 'zFebJ1oCUiG7JjIbh81I';
  const snap = await db.collection('templates').doc(tplId).get();
  if (!snap.exists) { console.log('SKIP — template não existe.'); process.exit(0); }
  const tpl = snap.data();
  console.log(JSON.stringify({
    name: tpl.name, format: tpl.format, fileUrl: tpl.fileUrl?.slice(0, 90), status: tpl.status,
    isR2: /^https:\/\/pub-ad909dc0c977450a93ee5faa79c7374d\.r2\.dev\//.test(tpl.fileUrl),
  }, null, 2));
  process.exit(0);
})();
