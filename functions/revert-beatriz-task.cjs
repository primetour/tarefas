const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  // Procura task "News AG893" concluída
  const snap = await db.collection('tasks').where('status', '==', 'done').get();
  const target = snap.docs.find(d => /News\s*AG893/i.test(d.data().title || ''));
  if (!target) { console.log('Task não encontrada.'); process.exit(0); }
  const t = target.data();
  console.log(`Achou: "${t.title}" | id=${target.id} | by=${t.updatedBy} | completedAt=${t.completedAt?.toDate?.()}`);
  await target.ref.update({
    status:      'not_started',
    completedAt: null,
    updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
    updatedBy:   'system-rbac-fix',
    revertedBy:  'Renê Castro (master) — bypass v4.49.10',
    revertedAt:  admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`Status revertido pra not_started. Beatriz pode pedir homologação a um coord+ agora.`);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
