const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  const snap = await db.collection('dev_hours').orderBy('completedAt', 'desc').limit(2000).get();
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const releases = all.filter(e => e.entryType === 'release').map(e => e.releaseVersion).filter(Boolean);
  const totalH = all.reduce((s, e) => s + (e.totalHours || 0), 0);
  const totalC = all.reduce((s, e) => s + (e.totalCost || 0), 0);
  // Versões 4.40.28+, 4.48.x, 4.49.x
  const recent = releases.filter(v => /^4\.(40\.(2[7-9]|[3-9]\d)|4[1-9]|5\d)/.test(v));
  console.log(JSON.stringify({
    total_entries: all.length,
    phases: all.filter(e => e.entryType === 'phase').length,
    releases_count: releases.length,
    total_hrs: totalH.toFixed(2),
    total_cost: totalC.toFixed(2),
    recent_4_40_27plus: recent.sort(),
    latest_15: [...new Set(releases)].sort().slice(-20),
  }, null, 2));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
