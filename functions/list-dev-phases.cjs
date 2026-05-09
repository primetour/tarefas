const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('dev_hours').where('entryType', '==', 'phase').get();
  const phases = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const ad = a.completedAt?.toDate?.() || new Date(0);
      const bd = b.completedAt?.toDate?.() || new Date(0);
      return ad - bd;
    });
  for (const p of phases) {
    const dt = p.completedAt?.toDate?.()?.toISOString().slice(0, 10) || '?';
    console.log(`${dt} | ${p.totalHours.toFixed(1)}h | R$${p.totalCost.toFixed(0)} | ${p.phaseLabel || p.title}`);
  }
  process.exit(0);
})();
