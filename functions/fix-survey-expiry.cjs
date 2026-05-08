const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  const id = 'EKlauvln6tbXBe2H6mYc';
  const ref = db.doc(`csat_surveys/${id}`);
  const snap = await ref.get();
  if (!snap.exists) { console.log('survey not found'); process.exit(1); }
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await ref.update({ expiresAt });
  console.log(`✓ ${id} expiresAt set to ${expiresAt.toISOString()}`);
  process.exit(0);
})();
