// v4.63.20 — Seed template HTML banco-roteiros (Migração 3/3 final)
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
const TEMPLATE_FILE = path.join(__dirname, '..', 'templates', 'seeds', 'banco-roteiros-default-html.html');
const TEMPLATE_NAME = 'PRIMETOUR Banco de Roteiros — Default HTML';
const TEMPLATE_MODULE = 'banco-roteiros';
const TEMPLATE_FORMAT = 'html';

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
  const r2Path = `templates/${TEMPLATE_MODULE}/${templateId}.${TEMPLATE_FORMAT}`;
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
    // v4.63.20+ Achado audit: arquivar (não só desmarcar default). Antes,
    // antigo ficava status=active mas isDefault=false → usuario podia atribuir
    // versão velha em vez da nova.
    await existingSnap.docs[0].ref.update({
      isDefault: false, status: 'archived',
      archivedAt: FV.serverTimestamp(),
      archivedReason: 'Superseded by newer seed (auto via re-seed script)',
      updatedAt: FV.serverTimestamp(),
    });
    console.log(`  ✓ antigo (${existingSnap.docs[0].id}) → archived + isDefault=false`);
  }

  await db.collection('templates').doc(templateId).set({
    name: TEMPLATE_NAME,
    description: 'Template HTML legado Banco de Roteiros (Classic Collection PRIMETOUR) seed v4.63.20 — capa com título coleção destinos noites, dia-a-dia simples cidade+narrativa, hospedagem sugerida em tabela cidade/hotel/regime/noites, inclui/exclui com check/x. Reproduz visual minimalista do roteiro modelo (vs cotação cliente).',
    module: TEMPLATE_MODULE, format: TEMPLATE_FORMAT,
    fileUrl, fileStoragePath: r2Path, fileStorageProvider: 'cloudflare-r2',
    fileSize: sizeBytes, fileSha256: sha, fileMime: 'text/html',
    placeholders: [], placeholdersExtractedAt: null, previewUrl: null,
    ownerType: 'global', ownerId: null, isDefault: true, status: 'active',
    version: 1, parentTemplateId: null,
    versionHistory: [{ version: 1, sha, uploadedAt: new Date() }],
    uploadedAt: FV.serverTimestamp(), uploadedBy: 'system',
    updatedAt: FV.serverTimestamp(), updatedBy: 'system',
    seedSource: 'banco-roteiros-default-html.html v4.63.20',
  });
  console.log(`  ✓ Doc ${templateId} criado`);

  await db.collection('audit_logs').add({
    action: 'templates.seed', userId: 'system', entity: 'templates', entityId: templateId,
    details: { module: TEMPLATE_MODULE, format: TEMPLATE_FORMAT, name: TEMPLATE_NAME, sizeBytes, sha: sha.slice(0,16) },
    severity: 'info', timestamp: FV.serverTimestamp(),
  });

  console.log(`\n✓ SEED COMPLETO: ${templateId}`);
  process.exit(0);
})();
