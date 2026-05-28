const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  const id = process.argv[2];
  if (!id) { console.log('Uso: node smoke-ssrf-cleanup.cjs <tplId>'); process.exit(1); }
  await db.collection('templates').doc(id).delete();
  console.log(`- Deleted ${id}`);
  process.exit(0);
})();
