const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  const doc = await db.collection('ai_agents').doc('roteiros-luxo-gen').get();
  if (!doc.exists) { console.log('NOT FOUND'); process.exit(1); }
  const x = doc.data();
  console.log('id:', doc.id);
  console.log('name:', x.name);
  console.log('model:', x.model);
  console.log('max_tokens:', x.maxTokens || x.max_tokens);
  console.log('temperature:', x.temperature);
  console.log('webSearch:', JSON.stringify(x.webSearch || x.web_search || null, null, 2));
  console.log('promptCache:', x.promptCache);
  console.log('disabled:', x.disabled);
  console.log('hasJsonSchema:', !!x.jsonSchema);
  console.log('---');
  console.log('systemPrompt LEN:', (x.systemPrompt || '').length);
  process.exit(0);
})();
