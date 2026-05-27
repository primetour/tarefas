const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.62.24',
    releaseSlug: '20260527-editor-servicos-preco-inline-voos-hoteis-opcionais',
    title: 'Servicos — preco inline em voos/hoteis + moeda em opcionais',
    summary: 'Rene: aereo e valores conectados — preco do aereo junto do aereo, hotel junto do hotel. ' +
             'Cada item ganha preco + moeda inline (BRL/USD/EUR/GBP/CHF/CAD/ARS/CLP). renderFlightRow ' +
             'e renderHotelRow ganham 2 colunas; renderOpcionaisSection ganha coluna moeda (priceAdult/' +
             'Child ja existiam). _sumServicePrices agrupa por moeda, multi-currency safe sem converter. ' +
             '_renderServiceTotals: bloco dourado no fim de Aereo/Hoteis e Opcionais. collectFormData ' +
             'persiste price (number) + currency em flights, hotels, optionals. Validado E2E: voo USD ' +
             '2500.50 LATAM + hotel BRL 1800 Jaipur persistiram corretamente no Firestore (cotacao ' +
             'N6kEinnEJTJG8z5UGTCk).',
    bucket: 'small', multiplierIds: [], profile: 'feature',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 1.5, testes: 0.5, documentacao: 0.3, implantacao: 0.1 },
    module: 'roteiros', modules: ['roteiros'],
  },
  {
    releaseVersion: '4.62.25',
    releaseSlug: '20260527-editor-servicos-totals-realtime-recalc',
    title: 'Servicos — total real-time sem rerender (CLAUDE.md §11.g)',
    summary: 'Audit E2E v4.62.24 descobriu: voo USD 2500 + hotel BRL 1800 preenchidos mas totals so ' +
             'mostrava "US$ 2.500,50" (faltava BRL 1800). Causa: _renderServiceTotals rodava so no paint ' +
             'inicial, sub-tab nao re-renderizou apos digitar. Fix: (1) _sumServicePrices prioriza DOM ' +
             'live (rows visiveis), fallback state pra sub-tabs inativas. (2) _recalcServiceTotalsInPlace ' +
             'helper que atualiza so o span sem rerender section (CLAUDE.md §11.g preserva foco). ' +
             '(3) handleEditorChange detecta edicao em price/currency de voo/hotel/opcional e chama ' +
             'recalc. (4) Cria bloco se nao existir (primeiro preco) ou remove se totais zerados.',
    bucket: 'small', multiplierIds: [], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.7, testes: 0.3, documentacao: 0.2, implantacao: 0.1 },
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
  }
  process.exit(0);
})();
