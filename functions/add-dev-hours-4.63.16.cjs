const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.63.16',
  releaseSlug: '20260528-r2-fallback-large-renders',
  title: 'Perf #2 R2 fallback >5MB pra renderTemplate (ultimo HIGH pos-audit)',
  summary: 'Pos-auditoria Sprint v4.63 parte 4 - ultimo HIGH critico atacado. Perf #2 HIGH: CF ' +
           'callable response limit ~10MB. Output renderTemplate e JSON com fileBase64 (overhead ' +
           '~33%) - PDFs >30 paginas + DOCX/PPTX hi-res estouravam. Antes CF so logava warn em ' +
           'sizeBytes>9MB sem fallback. Fix arquitetural: CF renderTemplate detecta sizeBytes>5MB ' +
           '(4MB de gordura), upload pro R2 worker renders/{uid}/{ts}-{templateId}.{ext} (mesmo ' +
           'padrao de uploadTemplate/duplicateTemplate, X-Upload-Token auth), retorna {downloadUrl, ' +
           'mime, filename, sizeBytes, via:r2-fallback} em vez de fileBase64. Audit log inclui via ' +
           'field. Graceful degradation: R2 upload falha -> cai pro path base64 (warn log). Cliente ' +
           'templates.js renderTemplate detecta r.downloadUrl, fetch+blob() com mime ajustado. ' +
           'Return shape uniforme {filename, sizeBytes, mime, blob, templateName, via}. TTL cleanup ' +
           'do dir renders/ ficou pra cron CF futuro. Custo R2 storage negligivel.',
  bucket: 'small', multiplierIds: ['integration', 'pdf'], profile: 'bugfix',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 1.2, testes: 0.3, documentacao: 0.4, implantacao: 0.3 },
  module: 'templates', modules: ['templates', 'portal', 'roteiros', 'banco-roteiros'],
};

function computeHours(b, mids, ai) {
  const t = Object.values(b).reduce((a, x) => a + x, 0);
  const m = (mids || []).map(id => ({ investigation: .3, migration: .2, pdf: .15, integration: .2, security: .25, pure_refactor: -.2 }[id] || 0)).reduce((a, x) => a + x, 0);
  return t * (1 + m) * ai;
}

(async () => {
  const ex = await db.collection('dev_hours').where('releaseVersion', '==', ENTRY.releaseVersion).limit(1).get();
  if (!ex.empty) { console.log('= skip'); process.exit(0); }
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
  process.exit(0);
})();
