/**
 * Setup completo de teste pra validar todos os modos de CSAT.
 *
 * Cria:
 *   - Atualiza tipo "Newsletter" (já periodic) com timeOfDay
 *   - Tipo "Apresentação Estratégica" (mode=individual, 2 perguntas)
 *   - Tipo "Marco de Projeto" (mode=milestone, 3 perguntas)
 *   - 3 tarefas Newsletter done (vão pro bolsão semanal)
 *   - 1 tarefa Apresentação done com csatPool null (CSAT individual)
 *   - 1 tarefa Marco done (CSAT milestone com multi-select)
 *
 * Cliente: rene.castro@primetour.com.br
 *
 * Idempotente: usa IDs determinísticos.
 *
 * Run:
 *   GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/application_default_credentials.json \
 *   GOOGLE_CLOUD_PROJECT=gestor-de-tarefas-primetour \
 *   node seed-csat-test-data.cjs
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const TEST_EMAIL = 'rene.castro@primetour.com.br';
const TEST_NAME  = 'Renê Castro';

const NEWSLETTER_ID = 'newsletter';
const PRESENTATION_ID = 'test_presentation_csat_individual';
const MILESTONE_ID = 'test_milestone_csat_project';

(async () => {
  console.log('🌱 Setup CSAT test data\n');

  // ─── 1. Atualiza Newsletter ─────────────────────────
  console.log('1️⃣  Newsletter: garantindo timeOfDay');
  const nlRef = db.doc(`task_types/${NEWSLETTER_ID}`);
  const nlSnap = await nlRef.get();
  if (nlSnap.exists) {
    const cur = nlSnap.data();
    await nlRef.update({
      'csatConfig.timeOfDay': '09:00',
      'csatConfig.dayOfWeek': cur.csatConfig?.dayOfWeek ?? 5,
      'csatConfig.customMessage': 'Avalie as newsletters desta semana, por favor.',
    });
    console.log('   ✓ atualizado\n');
  } else {
    console.log('   ⚠ não encontrado, pulando\n');
  }

  // ─── 2. Tipo Individual ─────────────────────────────
  console.log('2️⃣  Apresentação Estratégica (individual)');
  await db.doc(`task_types/${PRESENTATION_ID}`).set({
    name: 'Apresentação Estratégica',
    icon: '🎯',
    color: '#A78BFA',
    description: 'Apresentações pra leadership.',
    csatConfig: {
      enabled: true,
      mode: 'individual',
      period: 'weekly',
      dayOfWeek: 5,
      timeOfDay: '09:00',
      periodLabel: '',
      customMessage: 'Como foi a apresentação? Sua opinião nos ajuda a melhorar.',
      questions: [
        { id: 'q_clarity', label: 'A apresentação foi clara e objetiva?', type: 'score', required: true },
        { id: 'q_value',   label: 'O conteúdo agregou valor pra sua decisão?', type: 'score', required: true },
        { id: 'q_comments', label: 'Algum comentário adicional?', type: 'text', required: false },
      ],
    },
    active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log('   ✓ criado\n');

  // ─── 3. Tipo Milestone ──────────────────────────────
  console.log('3️⃣  Marco de Projeto (milestone)');
  await db.doc(`task_types/${MILESTONE_ID}`).set({
    name: 'Marco de Projeto',
    icon: '🏆',
    color: '#D4A843',
    description: 'Marco que encerra um conjunto de entregas relacionadas.',
    csatConfig: {
      enabled: true,
      mode: 'milestone',
      period: 'weekly',
      dayOfWeek: 5,
      timeOfDay: '09:00',
      periodLabel: '',
      customMessage: 'Como avalia o conjunto de entregas deste marco?',
      questions: [
        { id: 'q_overall', label: 'Avaliação geral do marco', type: 'score', required: true },
        { id: 'q_quality', label: 'A qualidade das entregas atendeu suas expectativas?', type: 'yesno', required: true },
        { id: 'q_feedback', label: 'O que podemos melhorar pra próximos marcos?', type: 'text', required: false },
      ],
    },
    active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log('   ✓ criado\n');

  // ─── 4. Tarefas Newsletter (3) — vão pro bolsão semanal ───
  console.log('4️⃣  3 tarefas Newsletter done → bolsão semanal');
  const winId = (() => {
    const d = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2,'0')}`;
  })();
  const poolKeyNewsletter = `pending:periodic:${NEWSLETTER_ID}:${winId}`;
  console.log(`   poolKey: ${poolKeyNewsletter}`);

  const newsletterTasks = [
    { id: 'test_csat_nl_1', title: 'Newsletter Trends Maio (semana 19)' },
    { id: 'test_csat_nl_2', title: 'Newsletter Madri Fashion Week' },
    { id: 'test_csat_nl_3', title: 'Newsletter Lazer Especial' },
  ];
  for (const t of newsletterTasks) {
    await db.doc(`tasks/${t.id}`).set({
      title:       t.title,
      description: `Tarefa de teste para CSAT periodic. ${t.title}`,
      typeId:      NEWSLETTER_ID,
      typeName:    'Newsletter',
      status:      'done',
      priority:    'medium',
      sector:      'Marketing',
      requestingArea: 'Comunicação',
      assignees:   [],
      tags:        ['teste-csat'],
      clientEmail: TEST_EMAIL,
      clientName:  TEST_NAME,
      csatPool:    poolKeyNewsletter,
      createdAt:   admin.firestore.Timestamp.fromDate(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)),
      completedAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)),
      createdBy:   'seed-test',
    }, { merge: false });
    console.log(`   + ${t.title}`);
  }
  console.log();

  // ─── 5. Tarefa Apresentação (individual) ───────────────
  console.log('5️⃣  1 tarefa Apresentação done — CSAT individual será disparado');
  const presentationTaskId = 'test_csat_presentation_1';
  await db.doc(`tasks/${presentationTaskId}`).set({
    title:       'Apresentação Q2: Plano Estratégico',
    description: 'Reunião de board, exposição de KPIs do trimestre + plano Q2.',
    typeId:      PRESENTATION_ID,
    typeName:    'Apresentação Estratégica',
    status:      'done',
    priority:    'high',
    sector:      'Marketing',
    requestingArea: 'Diretoria',
    assignees:   [],
    tags:        ['teste-csat'],
    clientEmail: TEST_EMAIL,
    clientName:  TEST_NAME,
    csatPool:    null,                       // individual: não vai pra bolsão
    createdAt:   admin.firestore.Timestamp.fromDate(new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)),
    completedAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 2 * 60 * 60 * 1000)),
    createdBy:   'seed-test',
  }, { merge: false });
  console.log(`   + Apresentação Q2: Plano Estratégico\n`);

  // ─── 6. Tarefas Marco + filhas ─────────────────────
  console.log('6️⃣  Marco + 2 filhas — CSAT milestone');
  const milestoneTaskId = 'test_csat_milestone_1';
  const projectId = 'test_csat_project';
  const childIds = ['test_csat_milestone_child_1', 'test_csat_milestone_child_2'];
  await db.doc(`tasks/${milestoneTaskId}`).set({
    title:       'Marco: Lançamento Campanha Verão 2026',
    description: 'Encerra o pacote de entregas da campanha de verão (briefing, criativos, posts, lançamento).',
    typeId:      MILESTONE_ID,
    typeName:    'Marco de Projeto',
    projectId,
    projectName: 'Campanha Verão 2026',
    status:      'done',
    priority:    'high',
    sector:      'Marketing',
    requestingArea: 'Comercial',
    assignees:   [],
    tags:        ['teste-csat', 'marco'],
    clientEmail: TEST_EMAIL,
    clientName:  TEST_NAME,
    csatPool:    null,
    createdAt:   admin.firestore.Timestamp.fromDate(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)),
    completedAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 1 * 60 * 60 * 1000)),
    createdBy:   'seed-test',
  }, { merge: false });
  console.log(`   + ${milestoneTaskId}: Marco`);

  // Tarefas filhas (mesmo projectId, status done) pra aparecer no multi-select
  const children = [
    { id: childIds[0], title: 'Brief campanha verão' },
    { id: childIds[1], title: 'Criativos verão (15 peças)' },
  ];
  for (const c of children) {
    await db.doc(`tasks/${c.id}`).set({
      title:       c.title,
      description: `Entrega da campanha verão.`,
      typeId:      'standard',
      projectId,
      projectName: 'Campanha Verão 2026',
      status:      'done',
      priority:    'medium',
      sector:      'Marketing',
      assignees:   [],
      tags:        ['teste-csat', 'verao-2026'],
      createdAt:   admin.firestore.Timestamp.fromDate(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)),
      completedAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)),
      createdBy:   'seed-test',
    }, { merge: false });
    console.log(`   + ${c.id}: ${c.title}`);
  }

  console.log('\n✓ Setup completo\n');
  console.log('📋 Próximos passos no /csat:');
  console.log('   1. Abra "📋 Aguardando envio" — verá 3 newsletters no bolsão semanal');
  console.log('   2. Clique "⚡ Disparar agora" → 1 email enviado pra rene.castro@');
  console.log('   3. Vá em /tarefas, abra "Apresentação Q2" e marque como concluída');
  console.log('      (toggle CSAT vem ativo, vai disparar individual)');
  console.log('   4. Idem pra "Marco: Lançamento Campanha Verão 2026"');
  console.log('      (multi-select aparece com as 2 filhas)\n');

  process.exit(0);
})().catch(e => { console.error('❌', e); process.exit(1); });
