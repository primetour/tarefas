const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.63.26',
  releaseSlug: '20260528-templates-ux-audit-fixes',
  title: 'UX audit Templates — A21 + B11 + cleanup prod + E2E manual',
  summary: 'Auditoria UX delegada (Agent paralelo + Admin SDK) sobre Biblioteca + Áreas + ' +
           'consumidores. 14 itens triados, 2 fixes HIGH atacados + cleanup prod crítico. ' +
           'CRÍTICO produção: Lazer.cotacoes.html apontava pra zFebJ1oCUiG7JjIbh81I ' +
           '("E2E v4.63.3 — Trigger test") em produção. Renê gerava cotação Lazer → template ' +
           'de TESTE. Reapontado pro default real (XZzybZJ0GA4QVrDe6oEM "PRIMETOUR Cotações ' +
           '— Default HTML" global) via Admin SDK + audit log. ' +
           '7 templates zumbi E2E v4.63.x deletados da Biblioteca + audit logs cada um. ' +
           'A21 templatesLibrary.js:159 — filter área excluía globais silenciosamente (drift ' +
           'vs tab Templates área que inclui). Fix 1 linha: incluir ownerType==global junto ' +
           'com ownerId match. ' +
           'B11 portalAreas.js:965-986 — defensive merge pra preservar templateRefs se 0 ' +
           'selects renderizados (falso positivo Agent na prática — tab Templates renderiza ' +
           'junto com outras, não é lazy; mas fix mantém como defensive). ' +
           'E2E real Chrome MCP confirmou A21 fix funcional + B11 preserva templateRefs ' +
           'após save sem tocar tab. ' +
           'audit script novo: functions/audit-areas-templaterefs.cjs (patrimônio repo) ' +
           'roda checagem health pré-/pós-release. Rodou contra prod: 7 áreas, só Lazer com ' +
           'refs setado (2 healthy), outras 6 usam fallback default global — correto. ' +
           'Gaps confirmados NÃO atacados (backlog): A10 editar metadata UI, A13 desarquivar ' +
           'UI, A18 hard delete UI, B5 remove val=\'\', E5 cross-area policy, F5 limit(500) ' +
           'silencioso, A17 race isDefault, C1.5 trocar template sem cache invalidation, F6 ' +
           'dedup name, A25 empty text zumbi. v4.63.27+: features A10/A13 ou matriz C1-C3.',
  bucket: 'medium', multiplierIds: ['investigation'], profile: 'bugfix',
  hoursByCategory: { refinamento: 1.5, desenvolvimento: 1.5, testes: 2.5, documentacao: 1.0, implantacao: 0.5 },
  module: 'templates', modules: ['templates', 'portal'],
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
