/**
 * dev_hours v4.57.32 — recurringTasksDailyCron (gap #4)
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.57.32',
  releaseSlug: '20260525-recurring-tasks-cf-cron',
  title: 'Tarefas — gap #4: geração de recorrentes via Cloud Function agendada (6h BRT)',
  summary: 'Fecha o gap #4 da auditoria de integrações. Antes: runDueRecurrenceGeneration era 100% lazy ' +
           'client-side. Final de semana/férias do power-user = tarefas acumulavam até alguém abrir. ' +
           'Agora: CF recurringTasksDailyCron roda 6h BRT todo dia (onSchedule v2). Lógica mirrors ' +
           'client-side com Admin SDK. Idempotência hard via ID determinístico rec_{tplId}_{occISO} — ' +
           'mesmo ID que client usa, então CF + client lazy não colidem. Limite 30 instâncias/template/run. ' +
           'Flag recurringSource=cf-cron diferencia no Firestore. Audit log agregado por run com stats. ' +
           'Client-side runDueRecurrenceGeneration continua funcionando como fallback (cinto-e-suspensório). ' +
           'Trade-off: CF não tem store de taskTypes, então dueDate=null quando template tem dueOffsetDays=0 ' +
           '— cliente recalcula via SLA na primeira render. E2E: 7 templates escaneados, 2 instâncias criadas ' +
           'no primeiro run, 0 em runs subsequentes (idempotência confirmada).',
  bucket: 'small',
  multiplierIds: ['integration'],
  profile: 'feature',
  hoursByCategory: { refinamento: 0.4, desenvolvimento: 1.0, testes: 0.4, documentacao: 0.3, implantacao: 0.2 },
  module: 'tasks',
  modules: ['tasks', 'cloud-functions', 'infra'],
};
function computeHours(b, mids, ai) { const t=Object.values(b).reduce((a,x)=>a+x,0); const m=(mids||[]).map(id=>({investigation:.3,migration:.2,pdf:.15,integration:.2,security:.25,pure_refactor:-.2}[id]||0)).reduce((a,x)=>a+x,0); return t*(1+m)*ai; }
(async () => {
  const ex = await db.collection('dev_hours').where('releaseVersion','==',ENTRY.releaseVersion).limit(1).get();
  if (!ex.empty) { console.log('= skip'); process.exit(0); }
  const h = computeHours(ENTRY.hoursByCategory, ENTRY.multiplierIds, AI_ASSIST);
  const now = FV.serverTimestamp();
  const doc = { entryType:'release', ...ENTRY, aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE, totalHours: Math.round(h*100)/100, totalCost: Math.round(h*HOURLY_RATE*100)/100, status:'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now };
  const ref = await db.collection('dev_hours').add(doc);
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  process.exit(0);
})();
