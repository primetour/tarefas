const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });

(async () => {
  const email = 'thais.yoshitomi@primetour.com.br';
  console.log('=== FIREBASE AUTH ===');
  try {
    const u = await admin.auth().getUserByEmail(email);
    console.log('Auth UID      :', u.uid);
    console.log('disabled      :', u.disabled);
    console.log('emailVerified :', u.emailVerified);
    console.log('providers     :', (u.providerData || []).map(p => p.providerId).join(', '));
    console.log('created       :', u.metadata?.creationTime);
    console.log('lastSignIn    :', u.metadata?.lastSignInTime);
    console.log('lastRefresh   :', u.metadata?.lastRefreshTime);
    console.log('');
    console.log('Firestore doc :', 'qZ3eIyrPo8YwbPstmgBFdLDrmcz2');
    console.log('MATCH?        :', u.uid === 'qZ3eIyrPo8YwbPstmgBFdLDrmcz2' ? 'SIM (uid bate)' : '*** NÃO — UID MUDOU ***');
  } catch (e) {
    console.log('getUserByEmail ERRO:', e.code || e.message);
    console.log('(se user-not-found → Auth record foi DELETADO; explica criar perfil novo)');
  }
})().catch(e => { console.error('ERR', e); process.exit(1); });
