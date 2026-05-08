/**
 * Inspeciona task_types existentes e mostra csatConfig.
 * Útil pra escolher onde criar tarefas de teste.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('task_types').get();
  console.log(`\n📋 ${snap.size} task_types\n`);
  snap.forEach(d => {
    const data = d.data();
    const cfg = data.csatConfig;
    if (cfg?.enabled) {
      console.log(`✓ ${data.name} (${d.id})`);
      console.log(`   mode: ${cfg.mode} · period: ${cfg.period || '-'} · dow: ${cfg.dayOfWeek || '-'} · time: ${cfg.timeOfDay || '-'}`);
      console.log(`   questions: ${(cfg.questions||[]).length}`);
    } else {
      console.log(`◌ ${data.name} (${d.id}) — sem CSAT`);
    }
  });
  process.exit(0);
})();
