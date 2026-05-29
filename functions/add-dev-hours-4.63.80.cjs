const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.63.80',
    releaseSlug: '20260529-pdf-overflow-photos-fix',
    title: 'Fix export PDF de cotação: fotos repetidas + texto transbordando sobre o rodapé',
    summary: 'Bugs reportados pelo Renê no teste E2E de export ("repete fotos / embola textos ' +
             'pág 8 / das páginas 9 pra frente é puro caos"). (1) buildDayByDayPages desenhava ' +
             'o banner da cidade em TODO dia daquela cidade → 3 dias em Tóquio = mesma foto 3×. ' +
             'Fix: Set shownCityBanners, cada cidade mostra a imagem uma vez (1º dia). (2) ' +
             'Antipadrão checkPageBreak(reserva_fixa) seguido de draw de bloco multi-linha ' +
             'variável → texto longo perto do fim da página vazava sobre o rodapé e a próxima ' +
             'seção (pior com Dica de Quioto, 94 itens: 64 restaurantes + 22 atrações). Fix: ' +
             'computar altura REAL do bloco primeiro, depois checkPageBreak(altura_real). ' +
             'Aplicado em buildEmbeddedTipsSection (itens + headings), buildDayByDayPages ' +
             '(atividades) e buildPaymentSection (observações). Diagnose-first confirmou que ' +
             'preço/condições/inclusões vazios na cotação de teste é dado vazio no Firestore, ' +
             'não bug de render (gates de seção corretos). Validação: node --check + simulação ' +
             'determinística da paginação (old transbordava 4 itens @287mm > limite 281mm; new ' +
             'máx 272.5mm). Visual no PDF pendente (requer relogin do Renê).',
    bucket: 'small', multiplierIds: ['investigation', 'pdf'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.4, testes: 0.25, documentacao: 0.1, implantacao: 0.05 },
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
