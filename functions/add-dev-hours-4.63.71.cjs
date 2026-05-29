const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.63.71',
  releaseSlug: '20260529-editor-title-left-align',
  title: 'Editor de Cotações — título "Editar Cotação" alinhado à esquerda',
  summary: 'Ajuste visual no header do editor de cotações. O h1.page-title ("Editar Cotação" / ' +
           '"Nova Cotação" / "Cotação Gerada por IA") aparecia centralizado porque o .page-header ' +
           'usa flex com justify-content:space-between. Adicionado margin-right:auto ao h1 — a ' +
           'margem auto absorve o espaço livre à direita, empurrando o título pra esquerda (adjacente ' +
           'ao botão "← Voltar") e mantendo status-dropdown + autosave + Salvar à direita. Mudança ' +
           '100% CSS inline, zero risco funcional. E2E real Chrome MCP validado: titleLeft passou de ' +
           '577 (centralizado) pra 372 (adjacente ao Voltar em 360), computed margin-right 825px, ' +
           'console limpo.',
  bucket: 'trivial', multiplierIds: [], profile: 'bugfix',
  hoursByCategory: { refinamento: 0.05, desenvolvimento: 0.1, testes: 0.2, documentacao: 0.05, implantacao: 0.1 },
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
  const doc = { entryType: 'release', ...ENTRY, aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE,
    totalHours: Math.round(h * 100) / 100, totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
    status: 'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now };
  const ref = await db.collection('dev_hours').add(doc);
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  process.exit(0);
})();
