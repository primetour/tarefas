const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.13',
  releaseSlug: '20260527-rename-gerador-roteiros-para-cotacoes',
  title: 'Rename "Gerador de Roteiros" → "Gerador de Cotações" (sidebar+page+module)',
  summary: 'Rene: sidebar e pagina do modulo - gerador de roteiros passa a se chamar Gerador de Cotacoes. ' +
           'Aplicado em 8 arquivos: sidebar (label+comentario), header (title mapping), pages/roteiros (page-' +
           'header title+subtitle, botao primario "+ Nova Cotacao"), services/devHours (MODULES.label + 2 ' +
           'comentarios), agents (system prompt linha 728), bankClientGuard (modal text), devHoursPdf ' +
           '(subtitle), helpPanel (FAQ). Preservados (NAO renomeados): route=roteiros, MODULES.id=roteiros ' +
           '(138 dev_hours entries existentes), collection Firestore, permissions, classes CSS, Banco de ' +
           'Roteiros (modulo separado de catalogo curado). Auditoria final: grep "Gerador de Roteiros" → 0.',
  bucket: 'small',
  multiplierIds: [],
  profile: 'feature',
  hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.5, testes: 0.2, documentacao: 0.3, implantacao: 0.1 },
  module: 'roteiros',
  modules: ['roteiros'],
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
