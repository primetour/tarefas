/**
 * v4.49.107 — Bump max_tokens no agente roteiros-luxo-gen:
 * 8000 → 16000. JSON parse falhou em position 23283 (truncamento).
 * Roteiros de luxo geram resposta rica (narrativa 200+ palavras/dia,
 * múltiplos destinos, hotéis com rationale) que estouram 8k facilmente.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const ref = db.collection('ai_agents').doc('roteiros-luxo-gen');
  const before = await ref.get();
  if (!before.exists) { console.error('NOT FOUND'); process.exit(1); }
  const x = before.data();
  console.log('Before maxTokensPerRun:', x.limits?.maxTokensPerRun);

  await ref.update({
    'limits.maxTokensPerRun': 16000,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const after = await ref.get();
  console.log('After maxTokensPerRun:', after.data().limits?.maxTokensPerRun);
  console.log('UPDATED ✓');
  process.exit(0);
})();
