const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('dev_hours').where('status','==','approved').get();
  const dates = [];
  snap.forEach(d => {
    const data = d.data();
    const dt = data.completedAt?.toDate ? data.completedAt.toDate() : (data.completedAt ? new Date(data.completedAt) : null);
    if (dt) dates.push({ date: dt, label: data.releaseVersion || data.phaseLabel || d.id, hours: data.totalHours });
  });
  dates.sort((a,b)=>a.date - b.date);
  console.log(`📅 ${dates.length} entradas aprovadas\n`);
  console.log(`Mais antiga: ${dates[0]?.date.toISOString().slice(0,10)} — ${dates[0]?.label}`);
  console.log(`Mais recente: ${dates[dates.length-1]?.date.toISOString().slice(0,10)} — ${dates[dates.length-1]?.label}`);
  const today = new Date();
  const ms = today - dates[0].date;
  const days = Math.ceil(ms / (1000*60*60*24)) + 1;
  console.log(`Span atual: ${days} dias\n`);

  console.log(`Primeiras 10 entradas:`);
  dates.slice(0, 10).forEach(e => console.log(`  ${e.date.toISOString().slice(0,10)}  ${e.label.padEnd(50)}  ${e.hours}h`));
  process.exit(0);
})();
