const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const APPLY = process.argv.includes('--apply');

(async () => {
  // 1. Pega uma cotação real qualquer (a primeira que achar) pra usar como base
  const cotSnap = await db.collection('roteiros').limit(1).get();
  if (cotSnap.empty) { console.log('Nenhuma cotação encontrada'); process.exit(1); }
  const cotDoc = cotSnap.docs[0];
  const cot = cotDoc.data();
  console.log(`Sample cotação: id=${cotDoc.id}, title=${cot.title || cot.cliente?.nome || 'sem nome'}`);

  // 2. Pega Lazer pra usar como área
  const lazerSnap = await db.collection('portal_areas').where('name', '==', 'Lazer').limit(1).get();
  const lazer = lazerSnap.docs[0].data();

  // 3. Simula o que generateRoteiroWebLink faria
  const token = `e2e-cotacao-web-${Date.now()}`;
  const doc = {
    token,
    format: 'web',
    data: cot,                      // shape esperado por roteiro-view.html
    area: { ...lazer, id: lazerSnap.docs[0].id },
    webTemplate: null,              // SEM template — fallback canônico
    webExports: { footerText: 'E2E test footer', headerText: '' },
    createdBy: { uid: 'e2e-test', name: 'E2E Test', email: '' },
    createdAt: FV.serverTimestamp(),
    viewCount: 0,
  };

  if (!APPLY) {
    console.log('\nDRY-RUN doc shape:');
    console.log('  token:', token);
    console.log('  format:', doc.format);
    console.log('  data keys:', Object.keys(cot).slice(0, 10));
    console.log('  area name:', doc.area.name);
    console.log('  webTemplate:', doc.webTemplate);
    console.log('\nDRY-RUN. Use --apply pra criar de verdade + testar render.');
    process.exit(0);
  }

  await db.collection('roteiro_web_links').doc(token).set(doc);
  console.log(`\n✓ Doc criado: roteiro_web_links/${token}`);
  console.log(`\nAbra essas URLs no browser:`);
  console.log(`  Canônico: https://primetour.github.io/tarefas/roteiro-view.html#${token}`);
  console.log(`  Template: https://primetour.github.io/tarefas/roteiro-view-tpl.html#${token} (vai redirecionar pra canônico — sem webTemplate)`);
  console.log(`\nCleanup: node /tmp/e2e-cotacao-weblink.cjs --cleanup ${token}`);

  process.exit(0);
})();
