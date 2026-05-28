const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.37',
  releaseSlug: '20260527-notif-assignee-observer-safety-net',
  title: 'Fix notif assignee/observer (auditoria + 3 fixes + 2 CF safety-net)',
  summary: 'Rene: usuarios marcados como responsaveis/observadores nao recebem notif nem banner. ' +
           'Auditoria completa delegada a Agent em paralelo. Diagnose: settings/global.' +
           'notifyTaskAssigned esta LIGADO — bug nao era esse. Auditoria revelou 5 causas. (3 ' +
           'CRITICAS implementadas, 1 mediano + 1 baixo). GAP 3: bulkUpdateTasks nao chamava notify ' +
           '— fix: pre-fetch state anterior pra tasks que mexem em assignees/observers + diff added/ ' +
           'removed apos batch commit + dispara task.assigned/unassigned/observing pros adicionados, ' +
           'skip filter actorId === recipientId. GAP 5 + GAP 4: Portal de Solicitacoes (3 callers em ' +
           'portalWizard/portal/portalLegacy) + recurringTasksDailyCron criavam tasks SEM notify ' +
           '(CLAUDE.md §12.n recidivismo). Solucao §12.n option 3: 2 CFs novas — onTaskCreated + ' +
           'onTaskUpdated — cobrem QUALQUER caller (atual ou futuro). Idempotentes via query 5min ' +
           '(skip se caller UI ja criou notif). Admin SDK bypassa rules. GAP 1: task.observing nao ' +
           'tava em TYPE_TO_USER_PREF nem NOTIF_TYPE_LABELS — adicionado. Diagnostic script: ' +
           'functions/check-global-notif-settings.cjs. CFs deployadas com sucesso (firebase deploy ' +
           '--only functions:onTaskCreated,functions:onTaskUpdated).',
  bucket: 'medium', multiplierIds: ['investigation', 'integration'], profile: 'bugfix',
  hoursByCategory: { refinamento: 0.5, desenvolvimento: 2.0, testes: 0.5, documentacao: 0.6, implantacao: 0.4 },
  module: 'tasks', modules: ['tasks'],
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
