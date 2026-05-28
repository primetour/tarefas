/**
 * v4.63.17 — Seed do template HTML default do Portal de Dicas.
 *
 * Lê templates/seeds/portal-default-html.html → upload R2 → cria doc
 * Firestore com ownerType:'global', isDefault:true. Trigger extractPlaceholders
 * vai rodar automaticamente pós-create.
 *
 * Uso:
 *   firebase functions:secrets:access R2_UPLOAD_TOKEN > /tmp/r2.txt
 *   export R2_UPLOAD_TOKEN=$(cat /tmp/r2.txt)
 *   node seed-portal-default-template.cjs           # dry-run
 *   node seed-portal-default-template.cjs --apply   # write
 */
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

const TEMPLATE_FILE = path.join(__dirname, '..', 'templates', 'seeds', 'portal-default-html.html');
const TEMPLATE_NAME = 'PRIMETOUR Portal de Dicas — Default HTML';
const TEMPLATE_MODULE = 'portal';
const TEMPLATE_FORMAT = 'html';

(async () => {
  if (!R2_TOKEN) {
    console.error('ERRO: R2_UPLOAD_TOKEN não setado. Rodar:');
    console.error('  firebase functions:secrets:access R2_UPLOAD_TOKEN > /tmp/r2.txt');
    console.error('  export R2_UPLOAD_TOKEN=$(cat /tmp/r2.txt)');
    process.exit(1);
  }
  if (!fs.existsSync(TEMPLATE_FILE)) {
    console.error(`ERRO: ${TEMPLATE_FILE} não encontrado`);
    process.exit(1);
  }

  const htmlBuf = fs.readFileSync(TEMPLATE_FILE);
  const sha = crypto.createHash('sha256').update(htmlBuf).digest('hex');
  const sizeBytes = htmlBuf.length;

  // Idempotência: já existe template global pro portal-html?
  const existingSnap = await db.collection('templates')
    .where('ownerType', '==', 'global')
    .where('module', '==', TEMPLATE_MODULE)
    .where('format', '==', TEMPLATE_FORMAT)
    .where('isDefault', '==', true)
    .limit(1)
    .get();

  if (!existingSnap.empty) {
    const existing = existingSnap.docs[0];
    const existingSha = existing.data().fileSha256;
    if (existingSha === sha) {
      console.log(`= SKIP: template já existe com mesmo SHA: ${existing.id}`);
      console.log(`  Name: "${existing.data().name}"`);
      process.exit(0);
    }
    console.log(`⚠ Template global default já existe (id=${existing.id}, sha=${existingSha?.slice(0,12)}…)`);
    console.log(`  Vai criar VERSÃO NOVA (novo doc, isDefault=true; antigo vira isDefault=false)`);
  }

  const templateId = db.collection('templates').doc().id;
  const r2Path = `templates/${TEMPLATE_MODULE}/${templateId}.${TEMPLATE_FORMAT}`;
  const filename = `${templateId}.${TEMPLATE_FORMAT}`;
  const mime = 'text/html';

  console.log(`\nPLANO:`);
  console.log(`  templateId: ${templateId}`);
  console.log(`  R2 path:    ${r2Path}`);
  console.log(`  Size:       ${sizeBytes} bytes`);
  console.log(`  SHA256:     ${sha}`);
  console.log(`  Mode:       ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  if (!APPLY) {
    console.log(`\nDry-run completo. Rode com --apply pra subir.`);
    process.exit(0);
  }

  // 1. Upload R2
  console.log(`\n→ Upload R2...`);
  const fd = new FormData();
  fd.append('file', new Blob([htmlBuf], { type: mime }), filename);
  fd.append('path', r2Path);
  const r2Res = await fetch(R2_WORKER, {
    method: 'POST',
    headers: { 'X-Upload-Token': R2_TOKEN },
    body: fd,
  });
  if (!r2Res.ok) {
    const t = await r2Res.text().catch(() => '');
    console.error(`R2 upload falhou (${r2Res.status}): ${t.slice(0,200)}`);
    process.exit(1);
  }
  const fileUrl = `${R2_PUBLIC}/${r2Path}`;
  console.log(`  ✓ R2 OK → ${fileUrl}`);

  // 2. Cria doc Firestore (trigger extractPlaceholders roda async)
  console.log(`\n→ Cria doc Firestore...`);
  // Se já tinha default antigo, desmarca primeiro
  if (!existingSnap.empty) {
    await existingSnap.docs[0].ref.update({ isDefault: false, updatedAt: FV.serverTimestamp() });
    console.log(`  ✓ default antigo (${existingSnap.docs[0].id}) → isDefault=false`);
  }

  await db.collection('templates').doc(templateId).set({
    name: TEMPLATE_NAME,
    description: 'Template HTML legado portal de dicas (seed v4.63.17) — capa + sumário + destinos com hero + segmentos. Reproduz layout do generatePDF jsPDF. Honor brand.useExternalName via {{area.nome}} + cores em CSS vars. Footer/Header custom via {{customFooterText}}/{{customHeaderText}}.',
    module: TEMPLATE_MODULE,
    format: TEMPLATE_FORMAT,
    fileUrl,
    fileStoragePath: r2Path,
    fileStorageProvider: 'cloudflare-r2',
    fileSize: sizeBytes,
    fileSha256: sha,
    fileMime: mime,
    placeholders: [],   // trigger extractPlaceholders vai popular
    placeholdersExtractedAt: null,
    previewUrl: null,
    ownerType: 'global',
    ownerId: null,
    isDefault: true,
    status: 'active',
    version: 1,
    parentTemplateId: null,
    versionHistory: [{ version: 1, sha, uploadedAt: new Date() }],
    uploadedAt: FV.serverTimestamp(),
    uploadedBy: 'system',
    updatedAt: FV.serverTimestamp(),
    updatedBy: 'system',
    seedSource: 'portal-default-html.html v4.63.17',
  });
  console.log(`  ✓ Doc ${templateId} criado`);

  // 3. Audit log
  await db.collection('audit_logs').add({
    action: 'templates.seed',
    userId: 'system',
    entity: 'templates',
    entityId: templateId,
    details: { module: TEMPLATE_MODULE, format: TEMPLATE_FORMAT, name: TEMPLATE_NAME, sizeBytes, sha: sha.slice(0,16) },
    severity: 'info',
    timestamp: FV.serverTimestamp(),
  });

  console.log(`\n✓ SEED COMPLETO`);
  console.log(`Template global default: ${templateId}`);
  console.log(`Aguarde ~3-5s pro extractPlaceholders trigger popular placeholders[]`);
  process.exit(0);
})();
