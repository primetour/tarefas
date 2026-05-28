const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
admin.firestore().collection('templates').get().then(snap => {
  console.log(`Total: ${snap.size}`);
  snap.forEach(d => {
    const x = d.data();
    console.log(`- ${d.id}: "${x.name}" [${x.module}/${x.format}] owner=${x.ownerType}:${x.ownerId || '-'} placeholders=${x.placeholders?.length || 0} status=${x.status} bytes=${x.fileSize}`);
  });
  process.exit(0);
});
