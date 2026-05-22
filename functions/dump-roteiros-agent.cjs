const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  const doc = await db.collection('ai_agents').doc('roteiros-luxo-gen').get();
  const x = doc.data();
  console.log('=== ALL FIELDS ===');
  console.log(JSON.stringify(Object.keys(x).sort(), null, 2));
  console.log('=== FIELD VALUES (non-prompt) ===');
  for (const k of Object.keys(x).sort()) {
    if (k === 'systemPrompt' || k === 'userPromptTemplate') continue;
    const v = x[k];
    const repr = typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : String(v).slice(0, 200);
    console.log(`  ${k}: ${repr}`);
  }
  console.log('=== systemPrompt FULL ===');
  console.log(x.systemPrompt || '(empty)');
  process.exit(0);
})();
