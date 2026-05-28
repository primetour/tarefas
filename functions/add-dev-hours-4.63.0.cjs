const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.63.0',
  releaseSlug: '20260528-templates-foundation-schema-rules-role',
  title: 'Foundation Sprint Upload de Templates (1/11)',
  summary: 'Pos sprint v4.62.x (config textual footerText/hideCover), Rene pediu upload ' +
           'real de arquivos template — sistema atual so permite configuracao textual. ' +
           'Sprint v4.63 implementa biblioteca real de templates uploaded. Arquitetura ' +
           'multi-engine: HTML render PDF (Puppeteer) + Web link mesmo arquivo, DOCX ' +
           'via docxtemplater, PPTX via pptxtemplater. Placeholders Handlebars consistente. ' +
           'Nova role templates_manage (master+diretor default). Versionamento via nova ' +
           'versao com archived. Duplicacao copia Storage file. Preview so HTML em v1. ' +
           'Rollout Cotacoes primeiro. Foundation entregue: js/services/templates.js SSOT ' +
           'schema + CRUD + helpers + constantes; firestore.rules match /templates/ ' +
           'deployado; rbac.js perm + defaults 5 roles; audit.js 6 actions + severity.',
  bucket: 'small', multiplierIds: ['integration'], profile: 'phase',
  hoursByCategory: { refinamento: 0.5, desenvolvimento: 1.2, testes: 0.2, documentacao: 0.3, implantacao: 0.2 },
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
