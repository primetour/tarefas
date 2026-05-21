const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  const snap = await db.collection('roles').get();
  const DKEYS = ['dashboard_home_view','dashboard_productivity_view','dashboard_portal_view','dashboard_roteiros_view','dashboard_csat_view','dashboard_view'];
  console.log('\nMATRIZ FINAL — Dashboards permissions em prod (v4.49.11)\n');
  console.log('Role'.padEnd(15) + ' | home | prod | portal | rotei | csat | LEGACY(dashboard_view)');
  console.log('-'.repeat(85));
  const order = ['master','admin','manager','coordinator','member','partner'];
  const docs = order.map(id => snap.docs.find(d => d.id === id)).filter(Boolean);
  for (const d of docs) {
    const data = d.data();
    const p = data.permissions || {};
    const cell = v => v === true ? '  ✓ ' : v === false ? '  ✗ ' : '  · ';
    console.log(
      (data.name || d.id).padEnd(15) + ' |' +
      cell(p.dashboard_home_view) + ' |' + cell(p.dashboard_productivity_view) +
      ' |' + cell(p.dashboard_portal_view) + '  |' + cell(p.dashboard_roteiros_view) +
      '  |' + cell(p.dashboard_csat_view) + ' |  ' +
      (p.dashboard_view === undefined ? '(removido ✓)' : `STILL HERE: ${p.dashboard_view}`)
    );
  }
  process.exit(0);
})();
