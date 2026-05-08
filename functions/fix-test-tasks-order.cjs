const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const ids = ['test_csat_nl_1', 'test_csat_nl_2', 'test_csat_nl_3',
               'test_csat_presentation_1', 'test_csat_milestone_1',
               'test_csat_milestone_child_1', 'test_csat_milestone_child_2'];
  for (const id of ids) {
    const ref = db.doc(`tasks/${id}`);
    const snap = await ref.get();
    if (!snap.exists) { console.log(`✗ ${id} não existe`); continue; }
    if (snap.data().order !== undefined) { console.log(`↩ ${id} já tem order`); continue; }
    await ref.update({ order: Date.now() + Math.random() * 1000 });
    console.log(`✓ ${id} order added`);
  }
  process.exit(0);
})();
