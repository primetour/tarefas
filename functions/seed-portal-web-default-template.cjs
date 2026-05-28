// v4.63.23 — Seed template Web Link default Portal (modo 'full')
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const APPLY = process.argv.includes('--apply');
const R2_TOKEN = process.env.R2_UPLOAD_TOKEN;
const R2_WORKER = 'https://primetour-images.rene-castro.workers.dev';
const R2_PUBLIC = 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev';
const TEMPLATE_FILE = path.join(__dirname, '..', 'templates', 'seeds', 'portal-web-default-html.html');
const TEMPLATE_NAME = 'PRIMETOUR Portal Web Link — Default (Full mode)';
const TEMPLATE_MODULE = 'portal';
const TEMPLATE_FORMAT = 'web';

(async () => {
  if (!R2_TOKEN) { console.error('R2_UPLOAD_TOKEN missing'); process.exit(1); }
  const htmlBuf = fs.readFileSync(TEMPLATE_FILE);
  const sha = crypto.createHash('sha256').update(htmlBuf).digest('hex');
  const sizeBytes = htmlBuf.length;

  const existingSnap = await db.collection('templates')
    .where('ownerType', '==', 'global')
    .where('module', '==', TEMPLATE_MODULE)
    .where('format', '==', TEMPLATE_FORMAT)
    .where('isDefault', '==', true).limit(1).get();

  if (!existingSnap.empty && existingSnap.docs[0].data().fileSha256 === sha) {
    console.log(`= SKIP same SHA: ${existingSnap.docs[0].id}`); process.exit(0);
  }

  const templateId = db.collection('templates').doc().id;
  const r2Path = `templates/${TEMPLATE_MODULE}/${templateId}.html`;
  console.log(`PLANO: ${TEMPLATE_NAME} → ${templateId} (${sizeBytes}B, sha ${sha.slice(0,12)}…) Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  if (!APPLY) { process.exit(0); }

  const fd = new FormData();
  fd.append('file', new Blob([htmlBuf], { type: 'text/html' }), `${templateId}.html`);
  fd.append('path', r2Path);
  const r2Res = await fetch(R2_WORKER, { method: 'POST', headers: { 'X-Upload-Token': R2_TOKEN }, body: fd });
  if (!r2Res.ok) { console.error(`R2 fail ${r2Res.status}`); process.exit(1); }
  const fileUrl = `${R2_PUBLIC}/${r2Path}`;
  console.log(`  ✓ ${fileUrl}`);

  if (!existingSnap.empty) {
    await existingSnap.docs[0].ref.update({
      isDefault: false, status: 'archived',
      archivedAt: FV.serverTimestamp(),
      archivedReason: 'Superseded by newer seed',
      updatedAt: FV.serverTimestamp(),
    });
    console.log(`  ✓ antigo (${existingSnap.docs[0].id}) → archived`);
  }

  await db.collection('templates').doc(templateId).set({
    name: TEMPLATE_NAME,
    description: 'Template HTML Web Link Portal de Dicas modo FULL — substituicao completa de portal-view.html. Cards responsivos por destino com hero+país+contagem dicas, header sticky brand, footer com créditos. JS hook PRIMETOUR.onDestinoClick wire em clique nos cards. Inclui OG meta dinamico pra crawlers WhatsApp/social.',
    module: TEMPLATE_MODULE, format: TEMPLATE_FORMAT,
    templateMode: 'full',  // v4.63.22+ schema novo
    fileUrl, fileStoragePath: r2Path, fileStorageProvider: 'cloudflare-r2',
    fileSize: sizeBytes, fileSha256: sha, fileMime: 'text/html',
    placeholders: [], placeholdersExtractedAt: null, previewUrl: null,
    ownerType: 'global', ownerId: null, isDefault: true, status: 'active',
    version: 1, parentTemplateId: null,
    versionHistory: [{ version: 1, sha, uploadedAt: new Date() }],
    uploadedAt: FV.serverTimestamp(), uploadedBy: 'system',
    updatedAt: FV.serverTimestamp(), updatedBy: 'system',
    seedSource: 'portal-web-default-html.html v4.63.23',
  });
  console.log(`  ✓ Doc ${templateId} criado`);

  await db.collection('audit_logs').add({
    action: 'templates.seed', userId: 'system', entity: 'templates', entityId: templateId,
    details: { module: TEMPLATE_MODULE, format: TEMPLATE_FORMAT, name: TEMPLATE_NAME, sizeBytes, sha: sha.slice(0,16), templateMode: 'full' },
    severity: 'info', timestamp: FV.serverTimestamp(),
  });

  console.log(`\n✓ SEED COMPLETO: ${templateId}`);
  process.exit(0);
})();
