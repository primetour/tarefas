const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  const usersSnap = await db.collection('users').where('role', '==', 'member').get();
  const memberMap = new Map();
  usersSnap.forEach(d => memberMap.set(d.id, d.data().name || d.id));
  console.log(`${memberMap.size} analistas no sistema.\n`);

  // Sem orderBy pra evitar precisar de index composto
  const tasksSnap = await db.collection('tasks').where('status', '==', 'done').get();
  console.log(`Total de tasks done no sistema: ${tasksSnap.size}\n`);

  const byMember = [];
  tasksSnap.forEach(d => {
    const t = { id: d.id, ...d.data() };
    if (memberMap.has(t.updatedBy) || memberMap.has(t.completedBy)) {
      byMember.push({
        id: t.id.slice(0,8),
        title: (t.title||'').slice(0, 45),
        by: memberMap.get(t.updatedBy) || memberMap.get(t.completedBy) || '?',
        completedAt: t.completedAt?.toDate?.()?.getTime() || 0,
      });
    }
  });
  byMember.sort((a,b) => b.completedAt - a.completedAt);
  console.log(`Done por analistas: ${byMember.length}\n\nÚltimas 15:`);
  byMember.slice(0, 15).forEach(t => {
    const date = t.completedAt ? new Date(t.completedAt).toISOString().slice(0,16) : '?';
    console.log(`  ${date} | ${t.by.padEnd(28)} | ${t.title}`);
  });
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
