const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.31',
  releaseSlug: '20260527-editor-servicos-form-unico-cards',
  title: 'Servicos refeito: form unico + cards (sem sub-tabs)',
  summary: 'Rene: eu nao pedi pra juntar em UM form so? layout esta quebrando lateralmente, campos ' +
           'pequenos, visibilidade ruim. Refazer tudo. Auditoria revelou 3 problemas: (1) sub-tabs ' +
           'Aereo+Hoteis/Valores/Opcionais da v4.62.19 violavam pedido original de "form unico", eu ' +
           'tinha interpretado errado; (2) tabelas com 10-11 colunas estouravam overflow lateral, ' +
           'inputs de width:90px ilegiveis (preco, hora, idade); (3) pos preco-inline v4.62.24 ficou ' +
           'pior porque adicionou +2 colunas (Preco + Moeda) sem reduzir as outras. Solucao: form ' +
           'unico, scroll vertical, 4 blocos sequenciais sem cliques (Voos, Hoteis, Opcionais, ' +
           'Resumo). Cards substituem tabelas — padding 14x16, labels em CIMA do input, grid CSS ' +
           'auto-fit minmax(160px,1fr) que quebra natural sem overflow. Empty states acolhedores. ' +
           'Total unico no rodape do Resumo (nao mais repetido por bloco). Warn legado: se cotacao ' +
           'tem pricing.services.{aereo|hoteis|...}[] populado mas voos/hoteis/opcionais vazios, ' +
           'banner laranja pede re-cadastro. Removido _servicosActiveSubtab module-scope + handler ' +
           'click .re-servicos-subtab + reset no destroy. Schema 100% inalterado: flights/hotels/ ' +
           'optionals/pricing iguais. renderHoteisSection/Valores/Opcionais legacy intactas (case ' +
           '2/3/4 hidden no SIDEBAR_ORDER mas funcionais). _recalcServiceTotalsInPlace adaptado pra ' +
           'suportar AMBOS layouts (novo .svc-totals + legado #re-svc-totals). CSS injetado inline ' +
           'via <style data-svc-css> com variaveis do design system. CLAUDE.md §10 aplicado: auditei ' +
           'o componente inteiro de uma vez, nao deixei detalhes pra depois.',
  bucket: 'medium', multiplierIds: ['pure_refactor'], profile: 'feature',
  hoursByCategory: { refinamento: 0.6, desenvolvimento: 2.8, testes: 0.5, documentacao: 0.6, implantacao: 0.1 },
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
