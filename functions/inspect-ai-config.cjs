const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  const snap = await db.doc('system_config/ai-config').get();
  const data = snap.exists ? snap.data() : null;
  console.log('exists:', snap.exists);
  if (data) {
    const keys = Object.keys(data);
    console.log('keys:', keys);
    for (const k of keys) {
      const v = data[k];
      console.log(' ', k, '→', typeof v === 'string' ? `string len=${v.length} preview=${v.slice(0,8)}...` : v);
    }
  }
})();
