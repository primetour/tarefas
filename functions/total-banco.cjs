const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
(async () => {
  const snap = await db.collection('dev_hours').get();
  const matches = [];
  for (const d of snap.docs) {
    const data = d.data();
    const arr = Array.isArray(data.modules) ? data.modules : [];
    if (arr.includes('banco-roteiros')) {
      matches.push({
        v: data.releaseVersion || '?',
        h: data.finalHours || 0,
        c: data.finalCost || 0,
        title: (data.title || '').slice(0, 50),
      });
    }
  }
  matches.sort((a,b) => a.v.localeCompare(b.v));
  let totalH = 0, totalC = 0;
  for (const m of matches) {
    console.log(`  ${m.v.padEnd(10)} ${String(m.h).padStart(5)}h  R$${String(m.c).padStart(7)}  ${m.title}`);
    totalH += m.h; totalC += m.c;
  }
  console.log(`\nTotal Banco de Roteiros: ${matches.length} entries · ${totalH.toFixed(2)}h · R$ ${totalC.toFixed(2)}`);
})();
