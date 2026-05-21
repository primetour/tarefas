const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  const evidence = {
    test_csat_nl_1: 'https://drive.google.com/file/d/EXAMPLE-newsletter-trends-maio',
    test_csat_nl_2: 'https://drive.google.com/file/d/EXAMPLE-newsletter-madri',
    test_csat_nl_3: 'https://drive.google.com/file/d/EXAMPLE-newsletter-lazer',
  };
  for (const [id, url] of Object.entries(evidence)) {
    await db.doc(`tasks/${id}`).update({ linkComprovacao: url });
    console.log(`✓ ${id} evidência setada`);
  }
  process.exit(0);
})();
