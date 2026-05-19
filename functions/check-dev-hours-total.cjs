/**
 * Soma totalHours + totalCost de toda a coleção dev_hours.
 * Calcula média/dia considerando o range completo (auto-detectado a
 * partir dos completedAt min/max). Atualizado em v4.49.22 — antes
 * hardcodava 95 dias (02/02 → 08/05).
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('dev_hours').get();
  let totalH = 0, totalCost = 0;
  let minTs = null, maxTs = null;
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
    const ts = x.completedAt?.toDate?.() || (x.completedAt ? new Date(x.completedAt) : null);
    if (ts && !isNaN(ts.getTime())) {
      if (!minTs || ts < minTs) minTs = ts;
      if (!maxTs || ts > maxTs) maxTs = ts;
    }
  });
  // 4.49.22+ Range auto-detectado em vez de hardcoded
  const days = (minTs && maxTs)
    ? Math.max(1, Math.round((maxTs - minTs) / 86400000) + 1)
    : 95;
  const fmtD = d => d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit'});

  console.log(`📊 Dev hours — ${snap.size} entradas`);
  console.log(`   Total: ${totalH.toFixed(2)}h · R$ ${totalCost.toFixed(2)}`);
  console.log(`   Phase:   ${byType.phase.n} · ${byType.phase.h.toFixed(2)}h · R$ ${byType.phase.c.toFixed(2)}`);
  console.log(`   Release: ${byType.release.n} · ${byType.release.h.toFixed(2)}h · R$ ${byType.release.c.toFixed(2)}`);
  console.log(`\n📅 Calendário: ${minTs?fmtD(minTs):'?'} → ${maxTs?fmtD(maxTs):'?'} = ${days} dias`);
  console.log(`   Média/dia (calendário): ${(totalH/days).toFixed(2)}h`);
  console.log(`   Pra bater 95K → 633h (6.66h/dia × 95 dias antigos)`);
  console.log(`   Pra bater 97K → 647h (6.81h/dia × 95 dias antigos)`);
  console.log(`   Diferença pra meta: ${(633 - totalH).toFixed(2)}h até ${(647 - totalH).toFixed(2)}h`);
  process.exit(0);
})();
