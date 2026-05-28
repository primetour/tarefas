const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.63.11',
  releaseSlug: '20260528-templates-generators-honor-refs',
  title: 'Generators honram templateRefs — ENCERRA SPRINT (12/12)',
  summary: 'Pipeline ponta-a-ponta funcional: user sobe template, atribui a area, sistema usa o ' +
           'template uploaded em vez do layout codado. NEW templateAdapter.js: ' +
           'roteiroToTemplateData / portalToTemplateData / bancoToTemplateData mantem sincronia ' +
           'com PLACEHOLDERS_SPEC, helpers _fmtDateBr CLAUDE.md §12.a sem timezone, _today, ' +
           '_formatCurrency, _resolveAreaName brand.useExternalName. roteiroGenerator.js 3 ' +
           'branches PDF/DOCX/PPTX: checa area.templateRefs[cotacoes][fmt] -> renderTemplate -> ' +
           'downloadBlob, respeita _exportModuleKey banco-roteiros path. portalGenerator.js ' +
           'generateMaterial branch antes do switch: templateRefs.portal[fmt] -> renderTemplate, ' +
           'format=pdf mapeia pra template html, format=web sempre via generateWebLink (canonico). ' +
           'roteiroBankGenerator.js comentario documenta _exportModuleKey redirecionamento. ' +
           'Principio fallback graceful: todo try {render} catch {warn + pipeline antigo}. Zero ' +
           'risco breakage, migracao progressiva, template ruim nao derruba area. Sprint encerrada ' +
           '12 releases 19h dev: 4 CFs novas (upload, extract trigger, render, duplicate), 1 page ' +
           'nova (Biblioteca), 1 tab nova (Templates no editor), 4 generators atualizados, ' +
           'adapter centralizado pra consistencia.',
  bucket: 'medium', multiplierIds: ['integration', 'pdf'], profile: 'phase',
  hoursByCategory: { refinamento: 0.6, desenvolvimento: 2.5, testes: 0.6, documentacao: 0.6, implantacao: 0.3 },
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
