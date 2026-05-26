/**
 * dev_hours sprint Analytics v4.57.53-55 — 3 entries individuais.
 * Filtros do dashboard buscam version exata.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.57.53',
    releaseSlug: '20260526-analytics-antipadrao-confirm-alert',
    title: 'Analytics #1/5: anti-padrões §11.k — confirm()/alert() nativos → modal/notice',
    summary: '5× confirm() em aiHub.js → modal.confirm({ danger:true }) com título/CTA contextuais ' +
             '(excluir agente · purge keys legadas · excluir doc KB · purge ai_skills/ai_automations · ' +
             'trocar Client ID). 2× alert() em dev-hours-view.html (standalone) → showNotice() helper ' +
             'inline próprio (stack fixed top-right, 4s auto-dismiss, kind=info|error). CSS isolado, ' +
             'sem dep de toast component da app. Anti-double-submit (§12.o) no Export PDF.',
    hoursByCategory: { refinamento: 0.15, desenvolvimento: 0.4, testes: 0.15, documentacao: 0.2, implantacao: 0.1 },
    multiplierIds: ['pure_refactor'],
    profile: 'refactor',
    bucket: 'small',
    module: 'analytics',
    modules: ['analytics', 'dashboard'],
  },
  {
    releaseVersion: '4.57.54',
    releaseSlug: '20260526-analytics-listener-cleanup-state-reset',
    title: 'Analytics #2/5: listener cleanup destroyDashboard + nlPerf state reset',
    summary: 'destroyDashboard (singular, dashboard home) existia mas nunca era invocado — wire em ' +
             'app.js beforeNavigation alinhado ao pattern dos outros destroyXxx (Kanban, TasksPage, ' +
             'Csat). nlPerformance.js: hiddenRows = new Set() em cada render — antes Set module-scoped ' +
             'persistia entre visitas, user navegava away com jobs ocultos e ao voltar continuavam ' +
             'sumidos sem indicação visual. Defesa-em-profundidade vs leak de subscription.',
    hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.2, testes: 0.1, documentacao: 0.1, implantacao: 0.05 },
    multiplierIds: [],
    profile: 'bugfix',
    bucket: 'trivial',
    module: 'analytics',
    modules: ['analytics', 'dashboard'],
  },
  {
    releaseVersion: '4.57.55',
    releaseSlug: '20260526-analytics-query-orderby-truncation-warn',
    title: 'Analytics #3/5: aiHub queries orderBy timestamp desc + banner truncamento',
    summary: 'renderCostsTab: query ai_usage_logs com orderBy(timestamp,desc) + limit 2000→5000. ' +
             'renderLogsTab: orderBy server-side substitui sort client-side de docs em ordem arbitrária ' +
             'do Firestore (risco real de exibir antigos enquanto recentes ficavam fora do snapshot). ' +
             'Banners UI quando snap.size===limit avisam truncamento. UX: admin sabe quando totais ' +
             'estão subestimando, em vez de só console.warn invisível.',
    hoursByCategory: { refinamento: 0.15, desenvolvimento: 0.3, testes: 0.1, documentacao: 0.15, implantacao: 0.05 },
    multiplierIds: ['investigation'],
    profile: 'bugfix',
    bucket: 'small',
    module: 'analytics',
    modules: ['analytics', 'iahub'],
  },
];

function computeHours(b, mids, ai) {
  const t = Object.values(b).reduce((a, x) => a + x, 0);
  const m = (mids || []).map(id => ({investigation:.3,migration:.2,pdf:.15,integration:.2,security:.25,pure_refactor:-.2}[id] || 0)).reduce((a, x) => a + x, 0);
  return t * (1 + m) * ai;
}

(async () => {
  for (const ENTRY of ENTRIES) {
    const ex = await db.collection('dev_hours').where('releaseVersion', '==', ENTRY.releaseVersion).limit(1).get();
    if (!ex.empty) { console.log(`= ${ENTRY.releaseVersion} já existe, skip`); continue; }
    const h = computeHours(ENTRY.hoursByCategory, ENTRY.multiplierIds, AI_ASSIST);
    const now = FV.serverTimestamp();
    const doc = {
      entryType: 'release',
      ...ENTRY,
      aiAssistanceMultiplier: AI_ASSIST,
      hourlyRate: HOURLY_RATE,
      totalHours: Math.round(h * 100) / 100,
      totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
      status: 'approved',
      completedAt: now,
      createdAt: now,
      createdBy: RENE_UID,
      updatedAt: now,
    };
    const ref = await db.collection('dev_hours').add(doc);
    console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  }
  process.exit(0);
})();
