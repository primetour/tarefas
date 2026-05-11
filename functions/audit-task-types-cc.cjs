/** Audit: task types usados no calendário de conteúdo
 *  Foca em: scheduleSlots, categoryId, e relação com slots em content_calendar.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const [typesSnap, tasksSnap, ccSnap] = await Promise.all([
    db.collection('task_types').get(),
    db.collection('tasks').get(),
    db.collection('content_calendar').get(),
  ]);

  // 1. Lista tipos focados em conteúdo (nome contém Instagram, Newsletter, etc)
  const targets = ['instagram', 'newsletter', 'reel', 'post', 'ics', 'meta'];
  console.log('📌 Tipos relacionados a conteúdo:\n');
  typesSnap.docs.forEach(d => {
    const t = { id: d.id, ...d.data() };
    const name = (t.name || '').toLowerCase();
    if (!targets.some(k => name.includes(k))) return;
    const slots = Array.isArray(t.scheduleSlots) ? t.scheduleSlots : [];
    console.log(`  ${t.name} (${t.id})`);
    console.log(`    icon=${t.icon} categoryId=${t.categoryId} categoryName=${t.categoryName}`);
    console.log(`    scheduleSlots: ${slots.length}`);
    slots.slice(0, 5).forEach(s => {
      console.log(`      - ${s.title || 'sem título'} · ${s.recurrence} · ${s.weekDay !== undefined ? 'dow=' + s.weekDay : ''} ${s.active === false ? '(INATIVO)' : ''}`);
    });
  });

  // 2. Conta tasks por typeId
  console.log('\n📊 Distribuição de tarefas por tipo (top 15):');
  const byType = {};
  tasksSnap.forEach(d => {
    const tid = d.data().typeId || '__no_type__';
    byType[tid] = (byType[tid] || 0) + 1;
  });
  const sorted = Object.entries(byType).sort((a,b) => b[1] - a[1]);
  for (const [tid, count] of sorted.slice(0, 15)) {
    const type = typesSnap.docs.find(d => d.id === tid);
    const name = type ? type.data().name : '(órfão)';
    console.log(`  ${count}× ${name} (${tid})`);
  }

  // 3. Slots de content_calendar com seus typeIds (que tipo de tarefa eles referenciam?)
  console.log('\n🗓 content_calendar slots:');
  ccSnap.forEach(d => {
    const s = d.data();
    console.log(`  ${s.title} · platform=${s.platform} · contentType=${s.contentType} · projectId=${s.projectId} · account=${s.account || '(sem)'}`);
  });

  // 4. Categorias (task_categories) existentes
  const catsSnap = await db.collection('task_categories').get();
  console.log(`\n📁 Categorias de tipo de tarefa: ${catsSnap.size}`);
  catsSnap.forEach(d => console.log(`  ${d.data().name} (${d.id})`));

  process.exit(0);
})();
