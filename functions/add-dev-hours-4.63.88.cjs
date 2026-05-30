const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.63.88',
    releaseSlug: '20260529-hotels-overlap-fix',
    title: 'Fix sobreposição AÉREO↔HOSPEDAGEM no PDF "padrão do sistema" (jsPDF fallback)',
    summary: 'Reporte do Renê: "segue o mesmo problema entre aéreo e hospedagem" — a seção ' +
             'HOSPEDAGEM desenhava POR CIMA da tabela AÉREO na mesma página. Causa (roteiroGenerator.js ' +
             'buildHotelsSection): quando havia voos, o orquestrador (v4.49.91) mantinha hotéis na mesma ' +
             'página mas a função resetava y=MARGIN sem addPage → título + tabela sobre o conteúdo do ' +
             'AÉREO. Fix: (1) orquestrador calcula hotelsStartY = doc.lastAutoTable.finalY + 12 quando há ' +
             'voos e passa como novo arg startY pra buildHotelsSection (sem voos mantém addPage anterior, ' +
             'startY=null). (2) buildHotelsSection usa let y = startY != null ? startY : MARGIN em vez de ' +
             'resetar pro topo, + header guard que calcula espaço necessário (título + faixa de thumbnails ' +
             '+ 1ª linha) e faz addPage ANTES de desenhar se não couber no rodapé — título e thumbs nunca ' +
             'ficam órfãos numa quebra. Single-caller confirmado pra buildFlightsSection e buildHotelsSection.',
    bucket: 'trivial', multiplierIds: ['investigation', 'pdf'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.2, testes: 0.1, documentacao: 0.05, implantacao: 0.05 },
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
