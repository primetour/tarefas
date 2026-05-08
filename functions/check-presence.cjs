const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  // Pega últimos 14 dias de presence_daily
  const fromDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const fromStr = fromDate.toISOString().slice(0, 10);

  const snap = await db.collection('presence_daily')
    .where('date', '>=', fromStr)
    .orderBy('date', 'desc')
    .get();

  console.log(`📊 ${snap.size} docs presence_daily desde ${fromStr}\n`);
  const byUser = {};
  snap.forEach(d => {
    const data = d.data();
    if (!byUser[data.uid]) {
      byUser[data.uid] = {
        name: data.userName || '?',
        email: data.email || '?',
        days: 0,
        totalMs: 0,
      };
    }
    byUser[data.uid].days++;
    byUser[data.uid].totalMs += data.totalMs || 0;
  });

  const list = Object.entries(byUser)
    .map(([uid, d]) => ({
      uid: uid.slice(0, 12) + '...',
      name: d.name,
      email: d.email,
      days: d.days,
      hours: (d.totalMs / 3_600_000).toFixed(1) + 'h',
    }))
    .sort((a, b) => parseFloat(b.hours) - parseFloat(a.hours));

  console.table(list);

  // Verifica entradas do Rene especificamente (sem orderBy pra evitar índice)
  const reneSnap = await db.collection('presence_daily')
    .where('email', '==', 'rene.castro@primetour.com.br')
    .get();
  console.log(`\n🔎 Renê presence_daily total: ${reneSnap.size}`);
  const reneList = [];
  reneSnap.forEach(d => {
    const data = d.data();
    reneList.push({
      date: data.date,
      totalMin: ((data.totalMs||0)/60000).toFixed(0),
      activeMin: ((data.activeMs||0)/60000).toFixed(0),
      idleMin: ((data.idleMs||0)/60000).toFixed(0),
    });
  });
  reneList.sort((a, b) => b.date.localeCompare(a.date));
  console.table(reneList.slice(0, 10));

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
