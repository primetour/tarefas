const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  const snap = await db.collection('goals').get();
  for (const d of snap.docs) {
    const g = d.data();
    if ((g.nome || g.titulo || '').includes('Pautas')) {
      console.log(`Meta: ${g.nome || g.titulo}`);
      (g.pilares || []).forEach((p, i) => {
        console.log(`  Pilar ${i}: "${p.titulo}" · visibleInTasks=${p.visibleInTasks}`);
        (p.metas || []).forEach((m, mi) => {
          console.log(`    Meta ${mi}: "${m.titulo}" · visibleInTasks=${m.visibleInTasks}`);
        });
      });
    }
  }
  process.exit(0);
})();
