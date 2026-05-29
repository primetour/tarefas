const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('users').get();
  const hits = [];
  snap.forEach(d => {
    const x = d.data();
    const blob = `${d.id} ${x.name || ''} ${x.displayName || ''} ${x.email || ''}`.toLowerCase();
    if (blob.includes('yoshitomi') || blob.includes('thais') || blob.includes('thaís')) {
      hits.push({ id: d.id, x });
    }
  });
  if (!hits.length) { console.log('NENHUM doc encontrado p/ thais/yoshitomi'); process.exit(0); }
  for (const h of hits) {
    const x = h.x;
    console.log('─────────────────────────────────────────');
    console.log('docId       :', h.id);
    console.log('name        :', x.name || x.displayName);
    console.log('email       :', x.email);
    console.log('role        :', x.role, '| roleId:', x.roleId, '| isMaster:', x.isMaster);
    console.log('active      :', x.active, '| firstLogin:', x.firstLogin);
    console.log('pendingSso  :', x.pendingSso, '| pending:', x.pending);
    console.log('deletedAt   :', x.deletedAt, '| deleted:', x.deleted);
    console.log('createdBy   :', x.createdBy);
    console.log('lastLogin   :', x.lastLogin && x.lastLogin.toDate ? x.lastLogin.toDate().toISOString() : x.lastLogin);
    console.log('createdAt   :', x.createdAt && x.createdAt.toDate ? x.createdAt.toDate().toISOString() : x.createdAt);
    console.log('provider    :', x.provider, '| authProvider:', x.authProvider);
  }
  console.log('─────────────────────────────────────────');
  console.log('TOTAL hits  :', hits.length);
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
