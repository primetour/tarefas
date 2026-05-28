const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.63.4',
  releaseSlug: '20260528-templates-library-ui',
  title: 'UI Biblioteca de Templates (sprint 5/11)',
  summary: 'Nova page #templates-library na sidebar abaixo de Templates de areas. Lista templates ' +
           'uploaded com cards informativos, filtros e modal upload inline. Implementado: ' +
           'templatesLibrary.js com uiKit header (gated por templates_manage), filter bar status ' +
           'pills + selects modulo/formato/area + search com debounce 220ms, grid responsivo ' +
           'auto-fill minmax(320px), cards com badges modulo/formato/status/default, owner global ' +
           'ou area, tamanho, versao, preview 5 placeholders + +N, mensagem extracao pending/erro, ' +
           'acoes Abrir arquivo R2 publico e Arquivar gated, empty state amigavel, count X de Y, ' +
           'modal upload v1 com nome/modulo/formato/area/file + validateTemplateFile + ' +
           'uploadTemplateService. AbortController cleanup CLAUDE.md §11.k. Sidebar: novo item ' +
           'Biblioteca de Templates perm portal_areas_view OR templates_manage. App: rota ' +
           'templates-library com dynamic import. Padrao visual CLAUDE.md §4 respeitado: ' +
           'renderPageHeader, renderFilterBar, variaveis CSS, btn padrao.',
  bucket: 'small', multiplierIds: ['integration'], profile: 'feature',
  hoursByCategory: { refinamento: 0.4, desenvolvimento: 2.0, testes: 0.3, documentacao: 0.3, implantacao: 0.2 },
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
