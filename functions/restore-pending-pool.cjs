const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  // Restaura csatPool das 3 newsletters de teste pra pending de novo
  const ids = ['test_csat_nl_1', 'test_csat_nl_2', 'test_csat_nl_3'];
  for (const id of ids) {
    await db.doc(`tasks/${id}`).update({
      csatPool: 'pending:periodic:newsletter:2026-W19',
      csatSurveyId: admin.firestore.FieldValue.delete(),
      csatSentAt: admin.firestore.FieldValue.delete(),
    });
    console.log(`✓ ${id} → pending`);
  }
  process.exit(0);
})();
