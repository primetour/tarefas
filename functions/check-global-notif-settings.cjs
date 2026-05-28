// Diagnose: verifica settings/global pra ver se kill-switch de notifs tá ligado
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const doc = await db.collection('settings').doc('global').get();
  if (!doc.exists) {
    console.log('⚠ settings/global NÃO EXISTE — todas as flags caem no default (true)');
    process.exit(0);
  }
  const data = doc.data();
  const keys = [
    'notifyTaskAssigned', 'notifyTaskCompleted', 'notifyTaskStatusChanged',
    'notifyTaskRework', 'notifyValidation', 'notifyCsat', 'notifyRequest',
    'notifyGoal', 'notifyProject', 'notifyMention', 'notifyComment',
  ];
  console.log('=== settings/global notifs flags ===');
  keys.forEach(k => {
    const v = data[k];
    const flag = v === false ? '❌ DESLIGADO (BUG!)' : v === true ? '✓ ligado' : '⏳ undefined (default true)';
    console.log(`${k.padEnd(28)} = ${flag}`);
  });
  console.log('\n=== outros campos no doc ===');
  Object.keys(data).filter(k => !keys.includes(k)).forEach(k => {
    console.log(`${k} = ${JSON.stringify(data[k]).slice(0,100)}`);
  });
  process.exit(0);
})();
