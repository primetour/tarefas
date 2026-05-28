const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.33',
  releaseSlug: '20260527-roteiros-fix-confirm-duplicado-listeners',
  title: 'Hotfix: confirm de excluir cotacao dispara 5-6x (listeners acumulando)',
  summary: 'Rene: quando tento deletar uma cotacao, banner de reconfirmacao aparece 5-6x. Causa raiz ' +
           'CLAUDE.md §11.k/§12.k: renderRoteiros(container) registrava 5 container.addEventListener ' +
           'sem AbortController. SPA reusa o mesmo container entre navegacoes — cada visita a Roteiros ' +
           'adicionava MAIS 5 listeners. 6 visitas = 6 confirm() em cascata pra cada delete. Mesmo bug ' +
           'escalava em filtros (2-6x re-render por click em pill), busca, sort, paginacao. Fix: ' +
           '_roteirosAbortCtrl module-scope; cada renderRoteiros aborta listeners da visita anterior ' +
           'antes de registrar novos; todos os 5 addEventListener ganham { signal: _sig }. Resultado: ' +
           '1 confirm() (era N visitas + 1), 1 reacao por click em filtro (era N reacoes), memory leak ' +
           'fechado. AbortController eh zero-overhead e idempotente. Auditoria pendente em outras pages: ' +
           'grep container.addEventListener pode revelar mais ocorrencias do mesmo bug.',
  bucket: 'trivial', multiplierIds: [], profile: 'bugfix',
  hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.3, testes: 0.1, documentacao: 0.2, implantacao: 0.1 },
  module: 'roteiros', modules: ['roteiros'],
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
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  process.exit(0);
})();
