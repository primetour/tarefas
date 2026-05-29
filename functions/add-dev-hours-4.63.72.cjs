const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.63.72',
  releaseSlug: '20260529-editor-tab-active-fix',
  title: 'Editor de Cotações — fix aba errada destacada na sidebar',
  summary: 'Bug: ao clicar numa aba da sidebar do editor de cotações, o conteúdo abria correto mas ' +
           'o destaque (.active) caía em OUTRA aba. Causa raiz: switchSection() destacava o nav-item ' +
           'comparando a POSIÇÃO no NodeList (forEach index i) contra o índice da seção, mas ' +
           'SIDEBAR_ORDER = [0,1,14,5,6,7,8,9,10,12,13] reordena as seções (ex: Serviços=14 renderiza ' +
           'na 3ª posição), então posição DOM != data-section-idx. Fix: comparar contra ' +
           'parseInt(item.dataset.sectionIdx). O conteúdo renderizado já usava o índice correto ' +
           '(switchSection recebia data-section-idx via click handler) — só o highlight estava errado. ' +
           'E2E real Chrome MCP validado: clicar cada aba destaca a aba certa.',
  bucket: 'trivial', multiplierIds: [], profile: 'bugfix',
  hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.1, testes: 0.2, documentacao: 0.05, implantacao: 0.1 },
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
