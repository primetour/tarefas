// Smoke test Security #5: criar doc temporário com fileUrl não-R2 e tentar render
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

(async () => {
  const tplId = `ssrf-smoke-${Date.now()}`;
  await db.collection('templates').doc(tplId).set({
    name: 'SSRF block smoke test',
    module: 'cotacoes',
    format: 'html',
    // fileUrl APONTANDO PRA NON-R2 (malicioso pretendido)
    fileUrl: 'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token',
    fileStoragePath: `templates/test/${tplId}.html`,
    fileSize: 100, fileMime: 'text/html', fileSha256: 'fake',
    fileStorageProvider: 'cloudflare-r2',
    placeholders: [],
    ownerType: 'global', ownerId: null,
    isDefault: false, status: 'active', version: 1,
    uploadedAt: FV.serverTimestamp(),
    uploadedBy: 'smoke-test',
    updatedAt: FV.serverTimestamp(),
    updatedBy: 'smoke-test',
  });
  console.log(`+ Criado tpl malicioso: ${tplId}`);
  console.log(`Run no browser console:`);
  console.log(`  const {renderTemplate}=await import('./js/services/templates.js?v=t');`);
  console.log(`  try { await renderTemplate('${tplId}', {}); } catch(e) { console.log('REJECT:', e.code, e.message); }`);
  console.log(`Depois cleanup: node smoke-ssrf-cleanup.cjs ${tplId}`);
  console.log(`tplId=${tplId}`);
  process.exit(0);
})();
