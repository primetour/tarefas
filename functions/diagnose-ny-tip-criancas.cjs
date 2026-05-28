/**
 * Diagnose: ver se a dica Nova York tem atracoes_criancas populado.
 */
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  // Encontra destino Nova York
  const destSnap = await db.collection('portal_destinations')
    .where('city', '==', 'Nova York')
    .limit(5).get();
  if (destSnap.empty) {
    const destSnap2 = await db.collection('portal_destinations')
      .where('city', 'in', ['Nova York', 'New York', 'Nova Iorque']).get().catch(()=>({empty:true}));
    console.log('Nova York via "in" não encontrou. Vou tentar listar todas as cidades dos EUA…');
    const us = await db.collection('portal_destinations')
      .where('country', 'in', ['Estados Unidos', 'EUA', 'USA']).limit(20).get().catch(()=>null);
    if (us) us.docs.forEach(d => console.log('  -', d.id, d.data().city));
    process.exit(0);
  }
  for (const d of destSnap.docs) {
    console.log(`\n=== Destino ${d.id} (${d.data().city}, ${d.data().country}) ===`);
    const tipSnap = await db.collection('portal_tips')
      .where('destinationId', '==', d.id)
      .limit(3).get();
    if (tipSnap.empty) {
      console.log('  Sem dicas.');
      continue;
    }
    for (const t of tipSnap.docs) {
      const tip = t.data();
      console.log(`\n  Tip ${t.id}: status=${tip.status}, segs=`);
      const segs = tip.segments || {};
      const keys = Object.keys(segs);
      keys.forEach(k => {
        const data = segs[k];
        const itemCount = Array.isArray(data?.items) ? data.items.length : 0;
        const itemSample = itemCount > 0 ? (data.items[0]?.titulo || data.items[0]?.title || data.items[0]?.name || '?') : '';
        const hasInfo = !!data?.info && Object.keys(data.info).some(x => data.info[x]);
        console.log(`     ${k.padEnd(25)} items=${String(itemCount).padStart(2)} ${hasInfo ? '(+info)' : ''} sample=${itemSample}`);
      });
      // Foca em atracoes vs atracoes_criancas
      const at = segs.atracoes;
      const atc = segs.atracoes_criancas;
      if (at && Array.isArray(at.items)) {
        console.log(`\n     >>> atracoes (${at.items.length}):`);
        at.items.forEach((it, i) => console.log(`        ${i+1}. ${it.titulo || it.title || '?'} (cat=${it.categoria || '?'})`));
      }
      if (atc) {
        console.log(`\n     >>> atracoes_criancas:`, JSON.stringify(atc).slice(0, 300));
      } else {
        console.log(`\n     >>> atracoes_criancas: AUSENTE`);
      }
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
