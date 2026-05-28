const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.63.1',
    releaseSlug: '20260528-templates-cf-upload-r2',
    title: 'CF uploadTemplate + R2 prefix templates/ (sprint 2/11)',
    summary: 'Implementado: ALLOWED_PREFIXES ganha templates/. Nova CF uploadTemplate (512MB, 60s, ' +
             'max 10): valida nome <=120, modulo, formato, base64, ownerType. Permission check ' +
             '_checkTemplatesPermission (master OR templates_manage). Size check por formato ' +
             '(HTML 5MB DOCX 10MB PPTX 15MB). SHA-256 integridade. Rate limit 10/min IP + 5/min user. ' +
             'Upload PUT pro Worker R2 (Bearer R2_UPLOAD_TOKEN — depois ajustado pra POST FormData). ' +
             'Path templates/{module}/{templateId}.{ext}. Cria doc Firestore via Admin SDK + audit ' +
             'log. Helper client uploadTemplate(file, meta) FileReader base64 + httpsCallable. ' +
             'Deploy CF: firebase deploy --only functions:uploadTemplate sucesso.',
    bucket: 'small', multiplierIds: ['integration', 'security'], profile: 'feature',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 1.2, testes: 0.3, documentacao: 0.2, implantacao: 0.2 },
    module: 'portal', modules: ['portal', 'roteiros', 'banco-roteiros'],
  },
  {
    releaseVersion: '4.63.2',
    releaseSlug: '20260528-templates-r2-worker-mime-fix',
    title: 'Upload R2 end-to-end funcional + Worker mime fix (sprint 3/11)',
    summary: 'Bug em v4.63.1: Worker R2 rejeitava non-image com 415 Only image files accepted. ' +
             'Worker tinha check hardcoded. Fix (Worker atualizado por Rene no Cloudflare ' +
             'dashboard): bloco TEMPLATE_MIMES com 3 mimes HTML/DOCX/PPTX. Branch isTemplate no ' +
             'POST handler: path templates/ aceita os 3 mimes, senao mantem check image/* ' +
             '(backwards-compat 100%). Size guard variavel: HTML 5MB DOCX 10MB PPTX 15MB imagens ' +
             '10MB. contentType real (nao forca image/webp pra templates). customMetadata.kind ' +
             'template|image. CF uploadTemplate revertida pra R2 (pivot Firebase Storage rollback): ' +
             'fileStorageProvider cloudflare-r2. Removido import firebase-admin/storage. E2E ' +
             'validado: upload HTML 178 bytes -> R2 + doc Firestore criado + URL publica R2 serve ' +
             'HTML original + fetchTemplates({module: cotacoes}) lista template.',
    bucket: 'small', multiplierIds: ['investigation', 'integration'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.8, testes: 0.3, documentacao: 0.2, implantacao: 0.1 },
    module: 'portal', modules: ['portal', 'roteiros', 'banco-roteiros'],
  },
];

function computeHours(b, mids, ai) {
  const t = Object.values(b).reduce((a, x) => a + x, 0);
  const m = (mids || []).map(id => ({ investigation: .3, migration: .2, pdf: .15, integration: .2, security: .25, pure_refactor: -.2 }[id] || 0)).reduce((a, x) => a + x, 0);
  return t * (1 + m) * ai;
}

(async () => {
  for (const ENTRY of ENTRIES) {
    const ex = await db.collection('dev_hours').where('releaseVersion', '==', ENTRY.releaseVersion).limit(1).get();
    if (!ex.empty) { console.log(`= skip ${ENTRY.releaseVersion}`); continue; }
    const h = computeHours(ENTRY.hoursByCategory, ENTRY.multiplierIds, AI_ASSIST);
    const now = FV.serverTimestamp();
    const doc = {
      entryType: 'release', ...ENTRY,
      aiAssistanceMultiplier: AI_ASSIST,
      hourlyRate: HOURLY_RATE,
      totalHours: Math.round(h * 100) / 100,
      totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
      status: 'approved',
      completedAt: now, createdAt: now,
      createdBy: RENE_UID, updatedAt: now,
    };
    const ref = await db.collection('dev_hours').add(doc);
    console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  }
  process.exit(0);
})();
