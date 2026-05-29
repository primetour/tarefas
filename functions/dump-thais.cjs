const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  const d = await db.collection('users').doc('qZ3eIyrPo8YwbPstmgBFdLDrmcz2').get();
  console.log('exists:', d.exists);
  console.log(JSON.stringify(d.data(), (k, v) => {
    if (v && v._seconds !== undefined) return new Date(v._seconds * 1000).toISOString();
    return v;
  }, 2));
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
