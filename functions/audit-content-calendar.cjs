/** Audit: lista slots de content_calendar agrupados por projectId
 *  pra identificar inconsistências (slots de newsletter no projeto
 *  Instagram, slots órfãos, etc).
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const [slotsSnap, projsSnap] = await Promise.all([
    db.collection('content_calendar').get(),
    db.collection('projects').get(),
  ]);

  const projects = {};
  projsSnap.forEach(d => { projects[d.id] = { id: d.id, ...d.data() }; });

  const byProj = {}; const byPlatform = {}; const byType = {};
  const orphans = []; const total = slotsSnap.size;

  slotsSnap.forEach(d => {
    const x = { id: d.id, ...d.data() };
    const pid = x.projectId || '(sem projeto)';
    const proj = projects[pid];
    const projName = proj ? proj.name : pid;
    if (!byProj[projName]) byProj[projName] = { count: 0, platforms: {}, types: {} };
    byProj[projName].count++;
    const plat = x.platform || '(sem plataforma)';
    const type = x.contentType || '(sem tipo)';
    byProj[projName].platforms[plat] = (byProj[projName].platforms[plat] || 0) + 1;
    byProj[projName].types[type]     = (byProj[projName].types[type]     || 0) + 1;
    byPlatform[plat] = (byPlatform[plat] || 0) + 1;
    byType[type]     = (byType[type]     || 0) + 1;
    if (x.projectId && !proj) orphans.push({ id: x.id, projectId: x.projectId, platform: plat, title: x.title });
  });

  console.log(`📊 Total slots: ${total}\n`);
  console.log(`📌 Por projeto:`);
  for (const [name, data] of Object.entries(byProj)) {
    console.log(`\n  ${name} (${data.count} slots)`);
    console.log(`    plataformas: ${JSON.stringify(data.platforms)}`);
    console.log(`    tipos:       ${JSON.stringify(data.types)}`);
  }

  console.log(`\n🌐 Distribuição global:`);
  console.log(`  Plataformas: ${JSON.stringify(byPlatform)}`);
  console.log(`  Tipos:       ${JSON.stringify(byType)}`);

  if (orphans.length) {
    console.log(`\n⚠ ${orphans.length} slots com projectId apontando pra projeto que não existe:`);
    orphans.slice(0, 10).forEach(o => console.log(`  ${o.id} → ${o.projectId} (${o.platform}) - ${o.title?.slice(0,60)}`));
  }
  process.exit(0);
})().catch(e => { console.error('❌', e); process.exit(1); });
