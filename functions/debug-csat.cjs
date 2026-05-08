const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  console.log('=== Locks ===');
  const locks = await db.collection('csat_periodic_runs').get();
  locks.forEach(d => console.log(`  ${d.id}: ${JSON.stringify(d.data())}`));

  console.log('\n=== Test tasks csatPool ===');
  const tasks = await db.collection('tasks').where('csatPool', '==', 'pending:periodic:newsletter:2026-W19').get();
  console.log(`  ${tasks.size} matching pending`);
  tasks.forEach(d => console.log(`  ${d.id}: status=${d.data().status} email=${d.data().clientEmail}`));

  console.log('\n=== Surveys recém criados ===');
  const since = new Date(Date.now() - 10 * 60 * 1000);
  const surveys = await db.collection('csat_surveys').where('createdAt', '>=', since).get();
  console.log(`  ${surveys.size} surveys nos últimos 10min`);
  surveys.forEach(d => console.log(`  ${d.id}: ${d.data().clientEmail} · ${d.data().taskTitle} · status=${d.data().status}`));
  process.exit(0);
})();
