const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.63.76',
    releaseSlug: '20260529-bank-import-days',
    title: 'Cotações — "Consultar Banco" importava dias VAZIOS (lia resumo de cidades)',
    summary: 'Bug previsto pelo Renê no teste E2E de export. _pickDaysFromBankRoteiro lia doc.geo.cities ' +
             '(resumo por cidade, sem narrativa) em vez de doc.days[] (dias reais com title/narrative/' +
             'overnightCity/flightLeg/activities), e mapeava c.description (campo inexistente). Num roteiro ' +
             'Envision de 13 dias, a modal mostrava só 5 "dias" placeholder com narrativa vazia. Fix: ler ' +
             'days[] com fallback geo.cities; modal mostra título+preview de narrativa; importa conteúdo real; ' +
             'label "N dias" corrigido. Validado por harness Node (id 3NdWRgM9ntRAYrreEFgw): 13 dias, 0 vazios.',
    bucket: 'small', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.4, testes: 0.3, documentacao: 0.15, implantacao: 0.1 },
    module: 'roteiros', modules: ['roteiros'],
  },
  {
    releaseVersion: '4.63.77',
    releaseSlug: '20260529-embedded-tips-render',
    title: 'Export — Dicas embedadas saíam VAZIAS em PDF/PPTX/DOCX/Web link',
    summary: 'Segundo módulo afetado no mesmo teste E2E (previsto pelo Renê). portal_tips guarda ' +
             'segments[key] como objeto { items, info } com chaves PT (titulo/endereco/descricao/observacoes), ' +
             'mais itens type:subtitle e o bloco especial informacoes_gerais.info. Os 4 caminhos de render ' +
             'tratavam segments[key] como array (Array.isArray sempre falso) e liam chaves EN ' +
             '(name/address/note/description) → 100% das Dicas curadas renderizavam vazias. Fix: helper ' +
             'flattenTipSegment + _tipStripHtml (espelhados) lê items nesting, trata informacoes_gerais, ' +
             'subtitle headings, chaves PT canônicas com fallback EN/legado, higieniza HTML. Aplicado em ' +
             'roteiroGenerator.js (PDF/PPTX/DOCX) e roteiro-view.html (Dicas + pins do mapa + hasMapData). ' +
             'Validado por harness Node contra cotação real 4bTybLbDGfarh3Rp5XSd (Quioto, 94 itens): 0 → 102 linhas.',
    bucket: 'small', multiplierIds: ['investigation', 'pdf'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.4, desenvolvimento: 0.5, testes: 0.4, documentacao: 0.2, implantacao: 0.1 },
    module: 'roteiros', modules: ['roteiros'],
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
    const doc = { entryType: 'release', ...ENTRY, aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE,
      totalHours: Math.round(h * 100) / 100, totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
      status: 'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now };
    const ref = await db.collection('dev_hours').add(doc);
    console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  }
  process.exit(0);
})();
