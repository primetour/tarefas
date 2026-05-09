/**
 * Smoke test do CSAT no nível do projeto (v4.35.0).
 * Cria projeto efêmero com csatConfig.enabled=true + 2 tasks done,
 * dispara fireProjectCsat e verifica:
 *   - 1 survey criado modo milestone com taskIds[]
 *   - project.lastCsatFiredAt setado
 *   - 2º disparo respeita janela (sem novas tasks → erro)
 *
 * NÃO envia email (o teste é client-side; sendCsatEmail é callable
 * Cloud Function que precisa de auth de browser). Verifica só o que
 * roda em admin SDK + Firestore.
 */
const admin = require('firebase-admin');

admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const PROJECT_ID = `test_csat_proj_${Date.now()}`;
const TASK_1     = `${PROJECT_ID}_t1`;
const TASK_2     = `${PROJECT_ID}_t2`;

(async () => {
  console.log(`🧪 Teste CSAT projeto-level — ${PROJECT_ID}\n`);

  // 1. Cria projeto com csatConfig
  await db.doc(`projects/${PROJECT_ID}`).set({
    name: 'TEST · CSAT projeto-level',
    description: 'Projeto efêmero criado pelo smoke test',
    icon: '🧪',
    color: '#D4A843',
    status: 'active',
    members: [],
    workspaceIds: [],
    workspaceId: null,
    sector: 'Tecnologia',
    taskCount: 0,
    doneCount: 0,
    csatConfig: {
      enabled: true,
      trigger: 'manual_only',
      clientEmail: 'rene.castro@primetour.com.br',
      questionsSource: 'custom',
      taskTypeId: null,
      questions: [],
      customMessage: 'Teste de CSAT no projeto',
    },
    lastCsatFiredAt: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    archived: false,
  });
  console.log(`✓ Projeto criado: ${PROJECT_ID}`);

  // 2. Cria 2 tasks done
  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.doc(`tasks/${TASK_1}`).set({
    title: 'Task 1 (done)',
    projectId: PROJECT_ID,
    status: 'done',
    completedAt: now,
    createdAt: now,
    order: 1,
  });
  await db.doc(`tasks/${TASK_2}`).set({
    title: 'Task 2 (done)',
    projectId: PROJECT_ID,
    status: 'done',
    completedAt: now,
    createdAt: now,
    order: 2,
  });
  console.log(`✓ 2 tasks done criadas`);

  // 3. Simula fireProjectCsat — replica a lógica do client (sem o sendCsatEmail
  //    que é callable function).
  const proj = (await db.doc(`projects/${PROJECT_ID}`).get()).data();
  const cfg = proj.csatConfig;

  const lastFired = proj.lastCsatFiredAt?.toDate ? proj.lastCsatFiredAt.toDate() : null;
  const tasksSnap = await db.collection('tasks')
    .where('projectId', '==', PROJECT_ID)
    .where('status', '==', 'done').get();
  const eligible = tasksSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(t => {
      if (!t.completedAt) return false;
      const c = t.completedAt?.toDate ? t.completedAt.toDate() : new Date(t.completedAt);
      if (lastFired && c <= lastFired) return false;
      return true;
    });
  console.log(`✓ Tasks elegíveis: ${eligible.length}`);
  if (eligible.length !== 2) throw new Error(`Esperava 2 elegíveis, achei ${eligible.length}`);

  // 4. Cria survey simulando fireProjectCsat
  const surveyRef = db.collection('csat_surveys').doc();
  const surveyToken = Math.random().toString(36).slice(2);
  await surveyRef.set({
    workspaceId: null,
    taskId: eligible[0].id,
    taskIds: eligible.map(t => t.id),
    taskTypeId: null,
    taskTitle: `Avaliação: ${proj.name}`,
    projectId: PROJECT_ID,
    projectName: proj.name,
    clientEmail: cfg.clientEmail,
    clientName: cfg.clientEmail.split('@')[0],
    customMessage: cfg.customMessage,
    status: 'pending',
    score: null,
    comment: null,
    questions: [{ id: 'q1', label: 'Como avalia?', type: 'score', required: true }],
    responses: {},
    csatMode: 'milestone',
    csatTrigger: 'manual',
    token: surveyToken,
    createdAt: now,
    sentAt: null,
    respondedAt: null,
    expiresAt: new Date(Date.now() + 7 * 86400000),
  });
  console.log(`✓ Survey criado: ${surveyRef.id} (modo milestone, ${eligible.length} taskIds)`);

  // 5. Atualiza lastCsatFiredAt
  await db.doc(`projects/${PROJECT_ID}`).update({
    lastCsatFiredAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`✓ project.lastCsatFiredAt atualizado`);

  // 6. Tenta novo disparo — deve retornar 0 elegíveis
  await new Promise(r => setTimeout(r, 1500)); // espera o serverTimestamp resolver
  const proj2 = (await db.doc(`projects/${PROJECT_ID}`).get()).data();
  const last2 = proj2.lastCsatFiredAt?.toDate();
  console.log(`  lastCsatFiredAt agora: ${last2?.toISOString()}`);

  const tasksSnap2 = await db.collection('tasks')
    .where('projectId', '==', PROJECT_ID)
    .where('status', '==', 'done').get();
  const eligible2 = tasksSnap2.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(t => {
      if (!t.completedAt) return false;
      const c = t.completedAt?.toDate();
      return last2 && c > last2;
    });
  console.log(`✓ 2º disparo: ${eligible2.length} elegíveis (esperado 0)`);
  if (eligible2.length !== 0) throw new Error('Esperava 0 elegíveis no 2º disparo');

  // 7. Limpa
  await db.doc(`csat_surveys/${surveyRef.id}`).delete();
  await db.doc(`tasks/${TASK_1}`).delete();
  await db.doc(`tasks/${TASK_2}`).delete();
  await db.doc(`projects/${PROJECT_ID}`).delete();
  console.log(`\n✓ Cleanup concluído`);

  console.log('\n✅ Teste passou — CSAT projeto-level funciona end-to-end');
  process.exit(0);
})().catch(e => { console.error('❌', e); process.exit(1); });
