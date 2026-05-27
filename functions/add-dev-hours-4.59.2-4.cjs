/**
 * dev_hours v4.59.2 + v4.59.3 + v4.59.4 — Sprint Banco fixes continuação
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.59.2',
    releaseSlug: '20260526-banco-conflict-detection-editor',
    title: 'Banco — conflict detection multi-user no editor (CRÍTICO #3 auditoria, §13.c)',
    summary: 'saveRoteiroBank ganha opts.expectedUpdatedAt. Editor captura state._loadedAt no load. ' +
             'Auto-save passa expectedUpdatedAt; se conflict (serverUpdatedAt > expected + 1s tolerância), ' +
             'throw err.code=CONFLICT com server/expected timestamps. Auto-save em CONFLICT: SILENT ' +
             '(sem modal), indicador vermelho, pausa próximos saves até user agir. Backward compat 100%.',
    bucket: 'trivial',
    multiplierIds: [],
    profile: 'bugfix',
    hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.8, testes: 0.2, documentacao: 0.2, implantacao: 0.1 },
    module: 'banco-roteiros',
    modules: ['banco-roteiros'],
  },
  {
    releaseVersion: '4.59.3',
    releaseSlug: '20260526-banco-confirm-modal-saveindicator-dynamic',
    title: 'Banco — confirm() → modal custom (§11.k) + indicador "Salvando" dinâmico (§11.b)',
    summary: '3 confirm() nativos → modal.confirm com danger:true onde aplica (archive, remove ' +
             'categoria, remove categoria/coleção do catálogo). Indicador #rb-save-indicator agora ' +
             'dinâmico: "Salvo agora" → "Salvo há 12s" → "há 3 min" → "2h" via setInterval 10s. ' +
             'Cleanup do interval em destroyRoteiroBankEditor.',
    bucket: 'trivial',
    multiplierIds: [],
    profile: 'bugfix',
    hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.6, testes: 0.15, documentacao: 0.15, implantacao: 0.1 },
    module: 'banco-roteiros',
    modules: ['banco-roteiros'],
  },
  {
    releaseVersion: '4.59.4',
    releaseSlug: '20260526-banco-fix-search-status-handlers',
    title: 'Banco — HOTFIX search + status filter quebrados (drift uiKit vs caller, bug Renê)',
    summary: 'Bug crítico reportado: pesquisa por palavra e filtro por status pills NUNCA disparavam. ' +
             'Causa raiz: drift silencioso entre uiKit (gera <input type=text id=uikit-search> + ' +
             '<button class=uikit-status-pill data-filter-status=...>) e roteiroBank.js handlers ' +
             '(procurava input[name=search]/[type=search] + [data-status-value]). Sem match → handler ' +
             'nunca disparava (sem erro). Fix: search id=rb-search + handler e.target.id === rb-search; ' +
             'status: closest(.uikit-status-pill) + dataset.filterStatus. Padrão correto já em ' +
             'roteiros.js sibling. Auditoria global confirmou só roteiroBank tinha o bug. CLAUDE.md ' +
             '§14.k adicionado: drift uiKit silencioso + E2E precisa validar comportamento, não estática.',
    bucket: 'trivial',
    multiplierIds: [],
    profile: 'bugfix',
    hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.3, testes: 0.15, documentacao: 0.2, implantacao: 0.05 },
    module: 'banco-roteiros',
    modules: ['banco-roteiros'],
  },
];

function computeHours(b, mids, ai) {
  const t = Object.values(b).reduce((a, x) => a + x, 0);
  const m = (mids || []).map(id => ({
    investigation: .3, migration: .2, pdf: .15, integration: .2,
    security: .25, pure_refactor: -.2,
  }[id] || 0)).reduce((a, x) => a + x, 0);
  return t * (1 + m) * ai;
}

(async () => {
  for (const ENTRY of ENTRIES) {
    const ex = await db.collection('dev_hours')
      .where('releaseVersion', '==', ENTRY.releaseVersion).limit(1).get();
    if (!ex.empty) { console.log(`= skip ${ENTRY.releaseVersion} (já existe)`); continue; }
    const h = computeHours(ENTRY.hoursByCategory, ENTRY.multiplierIds, AI_ASSIST);
    const now = FV.serverTimestamp();
    const doc = {
      entryType: 'release', ...ENTRY,
      aiAssistanceMultiplier: AI_ASSIST,
      hourlyRate: HOURLY_RATE,
      totalHours: Math.round(h * 100) / 100,
      totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
      status: 'approved',
      completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now,
    };
    const ref = await db.collection('dev_hours').add(doc);
    console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  }
  process.exit(0);
})();
