const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.63.81',
    releaseSlug: '20260529-pdf-overflow-includes-fix',
    title: 'Fix export PDF: hardening do antipadrão de transbordo em includes/excludes + disclaimer',
    summary: 'Continuação do fix v4.63.80 (texto transbordando sobre o rodapé). Auditoria dos ' +
             '17 callsites de checkPageBreak em roteiroGenerator.js achou 3 instâncias residuais ' +
             'do mesmo antipadrão reserva-fixa→bloco-multi-linha-variável que o fix anterior não ' +
             'cobriu: buildIncludesExcludes (loop INCLUI + loop NÃO INCLUI, item longo perto do ' +
             'rodapé vazava — seções que o Renê citou: "o que inclui, o que não inclui") e ' +
             'buildPricingSection (disclaimer jurídico longo 8+ linhas). Fix idêntico ao v4.63.80: ' +
             'computar lines/blockH via splitTextToSize PRIMEIRO, depois checkPageBreak(blockH+margem), ' +
             'desenhar, y += blockH. Demais 14 callsites confirmados saudáveis (títulos = altura ' +
             'fixa; pernoite/separador = linha única que cabe na reserva). node --check OK. Mesmo ' +
             'padrão determinístico já validado no v4.63.80. Visual no PDF pendente (requer relogin).',
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
