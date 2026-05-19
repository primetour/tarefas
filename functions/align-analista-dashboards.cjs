const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
(async () => {
  await db.collection('roles').doc('member').update({
    'permissions.dashboard_home_view':         true,
    'permissions.dashboard_productivity_view': false,
    'permissions.dashboard_portal_view':       false,
    'permissions.dashboard_roteiros_view':     false,
    'permissions.dashboard_csat_view':         false,
    updatedAt: FV.serverTimestamp(),
  });
  console.log('Analista alinhado: só dashboard_home_view=true');
  process.exit(0);
})();
