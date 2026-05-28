const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.63.15',
  releaseSlug: '20260528-templates-foco-produto',
  title: 'Templates virou 6° módulo de Foco em Produto + CLAUDE.md §16',
  summary: 'Rene pediu incluir Biblioteca de Templates e Template de Areas na aba Foco em Produto. ' +
           'Adicionado novo módulo templates em devHours.MODULES (id templates, aliases template-de-' +
           'areas/area-templates, label Biblioteca de Templates, color rosa, icon 📐). Pattern regex ' +
           'pra detecção heurística. Backfill script aplicado em 29 docs cross-sprint: v4.63.0 → v4.63.14 ' +
           '(Sprint Biblioteca de Templates inteira) + v4.62.39 → v4.62.51 (Sprint Templates Areas Fases ' +
           'A-F + audit) + v4.48.0 (sprint 6b/6c). Adicionada CLAUDE.md §16 com 8 lessons learned da ' +
           'sprint Templates v4.63.x + pos-auditoria: _validateXxxFileUrl helper pra SSRF, Puppeteer ' +
           'setRequestInterception allowlist, fallback graceful avisa via toast + audit log, orphan ' +
           'ref detection em UI, progress indicator toast.update >5s, drift PLACEHOLDERS_SPEC vs ' +
           'adapter, Agent paralelo pos-sprint (ROI 5 HIGH em 5h), re-audit pos-fix.',
  bucket: 'small', multiplierIds: ['integration'], profile: 'documentacao',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.5, testes: 0.2, documentacao: 0.8, implantacao: 0.2 },
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
