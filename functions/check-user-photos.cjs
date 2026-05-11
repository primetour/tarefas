/** Diagnóstico: lista users e indica quem tem photoURL preenchido. */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('users').get();
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const withPhoto    = all.filter(u => u.photoURL && u.photoURL.length > 50);
  const withoutPhoto = all.filter(u => !u.photoURL || u.photoURL.length <= 50);
  const ssoMs        = all.filter(u => u.provider === 'microsoft.com' || u.providers?.includes?.('microsoft.com'));
  const active       = all.filter(u => u.active !== false);

  console.log(`📊 ${all.length} usuários total · ${active.length} ativos\n`);
  console.log(`🖼  Com foto: ${withPhoto.length}`);
  withPhoto.forEach(u => console.log(`   ✓ ${u.name || u.email || u.id} (${u.email})`));

  console.log(`\n📭 Sem foto: ${withoutPhoto.length}`);
  withoutPhoto.forEach(u => {
    const lastLogin = u.lastLogin?.toDate?.()?.toISOString?.()?.slice(0,16) || 'nunca';
    const prov = u.provider || (Array.isArray(u.providers) ? u.providers.join(',') : 'n/a');
    console.log(`   ✗ ${u.name || u.email || u.id} (${u.email}) · provider=${prov} · lastLogin=${lastLogin}${u.active===false?' · INATIVO':''}`);
  });

  console.log(`\n🔍 SSO Microsoft: ${ssoMs.length} (somente esses podem capturar foto via Graph)`);
  process.exit(0);
})();
