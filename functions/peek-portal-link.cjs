/**
 * Pega 1 link público do Portal de Dicas pra comparar UX visual com Roteiros.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('portal_web_links').limit(3).get();
  if (snap.empty) { console.log('Sem links'); process.exit(0); }
  snap.docs.forEach(d => {
    const data = d.data();
    const title = (data.tipData?.[0]?.tip?.city) || (data.tipData?.[0]?.dest?.city) || '?';
    console.log(`${d.id}\t${data.format || '?'}\t${title}`);
  });
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
