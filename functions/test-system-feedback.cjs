/** Smoke test: cria doc em system_feedback e confere se trigger envia email. */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const ref = db.collection('system_feedback').doc();
  const doc = {
    type: 'suggestion',
    message: 'Teste automático do módulo de System Feedback (v4.35.3). Verificando se o email vai pra rene.castro@primetour.com.br via Microsoft Graph.\n\nSe você está lendo isso por email, o trigger funcionou ponto-a-ponto: Firestore onCreate → Cloud Function → Graph sendMail.',
    page: '#system-feedback',
    userAgent: 'TestRunner/1.0',
    appVersion: '4.35.3+20260509-system-feedback-module',
    authorUid: 'test-script',
    authorName: 'Renê Castro (smoke test)',
    authorEmail: 'rene.castro@primetour.com.br',
    authorRole: 'master',
    status: 'new',
    adminResponse: '',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    resolvedAt: null,
  };
  await ref.set(doc);
  console.log(`✓ Doc criado: ${ref.id}`);
  console.log(`  Trigger onSystemFeedbackCreate deve disparar em <30s`);
  console.log(`  Verificar inbox de rene.castro@primetour.com.br`);
  console.log(`  Limpeza: o doc fica pra você ver na UI /system-feedback`);
  process.exit(0);
})().catch(e => { console.error('❌', e); process.exit(1); });
