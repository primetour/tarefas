const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.63.13',
  releaseSlug: '20260528-security-ssrf-lockdown',
  title: 'Security lockdown SSRF Puppeteer + fileUrl R2 allowlist',
  summary: 'Pos-auditoria Sprint v4.63 parte 2 — Security #2 + #5 HIGH/MEDIUM. Security #2 HIGH ' +
           'SSRF Puppeteer: templates HTML sao arbitrarios do uploader com templates_manage. ' +
           'Antes page.setContent sem intercepcao - atacante incluir <iframe src=metadata server> ' +
           'ou <img src=internal-svc> e exfiltrar via PDF. Fix page.setRequestInterception(true) ' +
           'allowlist data: about: R2 origin Google Fonts. Tudo o mais aborta com warn. networkidle0 ' +
           'segue funcionando. Security #5 MEDIUM fileUrl validation: _validateR2FileUrl(url) guard ' +
           'antes de cada fetch em extractPlaceholders renderTemplate duplicateTemplate. Aceita ' +
           'apenas https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/ sem path traversal (..) ou ' +
           'auth embebido (@). Defesa em profundidade mesmo se Firestore Rules forem alteradas. ' +
           'Deploy 3 CFs validados (extractPlaceholders, renderTemplate, duplicateTemplate).',
  bucket: 'small', multiplierIds: ['security'], profile: 'bugfix',
  hoursByCategory: { refinamento: 0.4, desenvolvimento: 1.0, testes: 0.4, documentacao: 0.4, implantacao: 0.3 },
  module: 'portal', modules: ['portal', 'roteiros', 'banco-roteiros'],
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
