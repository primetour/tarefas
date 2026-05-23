const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  const snap = await db.collection('users').where('email', '==', 'rene.castro@primetour.com.br').limit(1).get();
  if (snap.empty) { console.log('NOT_FOUND'); return; }
  console.log(snap.docs[0].id);
})();
