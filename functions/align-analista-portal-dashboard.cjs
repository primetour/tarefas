/**
 * v4.49.14 — Libera dashboard_portal_view pro Analista.
 * Role member tem customizedPermissions=true (alinhado em scripts prévios),
 * então o initSystemRoles do front-end NÃO sobrescreve mais. Precisamos
 * patch direto no Firestore.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

(async () => {
  await db.collection('roles').doc('member').update({
    'permissions.dashboard_portal_view': true,
    updatedAt: FV.serverTimestamp(),
  });
  console.log('✓ role member: dashboard_portal_view = true');

  // Sanity check
  const snap = await db.collection('roles').doc('member').get();
  const perms = snap.data()?.permissions || {};
  console.log('  dashboard_home_view        =', perms.dashboard_home_view);
  console.log('  dashboard_productivity_view=', perms.dashboard_productivity_view);
  console.log('  dashboard_portal_view      =', perms.dashboard_portal_view);
  console.log('  dashboard_roteiros_view    =', perms.dashboard_roteiros_view);
  console.log('  dashboard_csat_view        =', perms.dashboard_csat_view);

  process.exit(0);
})();
