/**
 * Soma totalHours + totalCost de toda a coleção dev_hours.
 * Calcula média/dia considerando 95 dias úteis (02/02 → 08/05).
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('dev_hours').get();
  let totalH = 0, totalCost = 0;
  const byType = { phase: { h: 0, c: 0, n: 0 }, release: { h: 0, c: 0, n: 0 } };
  snap.forEach(d => {
    const x = d.data();
    const h = Number(x.totalHours) || 0;
    const c = Number(x.totalCost)  || 0;
    totalH += h;
    totalCost += c;
    const t = x.entryType || 'release';
    if (!byType[t]) byType[t] = { h: 0, c: 0, n: 0 };
    byType[t].h += h;
    byType[t].c += c;
    byType[t].n++;
  });
  console.log(`📊 Dev hours — ${snap.size} entradas`);
  console.log(`   Total: ${totalH.toFixed(2)}h · R$ ${totalCost.toFixed(2)}`);
  console.log(`   Phase:   ${byType.phase.n} · ${byType.phase.h.toFixed(2)}h · R$ ${byType.phase.c.toFixed(2)}`);
  console.log(`   Release: ${byType.release.n} · ${byType.release.h.toFixed(2)}h · R$ ${byType.release.c.toFixed(2)}`);
  console.log(`\n📅 Calendário: 02/02/26 → 08/05/26 = 95 dias`);
  console.log(`   Média/dia (calendário): ${(totalH/95).toFixed(2)}h`);
  console.log(`   Pra bater 95K → 633h (6.66h/dia)`);
  console.log(`   Pra bater 97K → 647h (6.81h/dia)`);
  console.log(`   Diferença pra meta: ${(633 - totalH).toFixed(2)}h até ${(647 - totalH).toFixed(2)}h`);
  process.exit(0);
})();
