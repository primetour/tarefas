const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const ids = ['test_csat_nl_1', 'test_csat_nl_2', 'test_csat_nl_3', 'test_csat_presentation_1', 'test_csat_milestone_1'];
  for (const id of ids) {
    const d = await db.doc(`tasks/${id}`).get();
    if (d.exists) {
      const data = d.data();
      console.log(`✓ ${id}`);
      console.log(`   typeId: ${data.typeId}, status: ${data.status}, workspaceId: ${data.workspaceId || 'null'}`);
      console.log(`   csatPool: ${data.csatPool}, clientEmail: ${data.clientEmail}`);
    } else {
      console.log(`✗ ${id} NÃO EXISTE`);
    }
  }
  process.exit(0);
})();
