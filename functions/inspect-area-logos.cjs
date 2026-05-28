const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('portal_areas').get();
  console.log(`\n${snap.size} portal_areas:\n`);
  snap.forEach(d => {
    const a = d.data();
    const logoFields = Object.keys(a).filter(k => /logo|image|brand/i.test(k));
    console.log(`[${d.id}] ${a.name}`);
    console.log(`  category: ${a.category || '(standalone)'}`);
    console.log(`  logo fields: ${logoFields.join(', ') || '(none)'}`);
    logoFields.forEach(f => console.log(`    ${f}: ${String(a[f] || '').slice(0,80)}`));
    if (a.colors) console.log(`  colors: ${JSON.stringify(a.colors)}`);
    console.log('');
  });
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
