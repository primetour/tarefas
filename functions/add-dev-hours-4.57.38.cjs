/**
 * dev_hours v4.57.38 — Sprint Roteiros 5/5 (final): polish
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.57.38',
  releaseSlug: '20260525-roteiros-polish-modal-vars-cap-errorcode',
  title: 'Roteiros — sprint 5/5 (final): polish (R16 modal + R17 vars + R18 cap + R3 errorCode)',
  summary: 'Release final da sprint Gerador de Roteiros. R16: 2 confirm() em handleStatusChange + 1 em ' +
           'maybeOfferTaskGeneration migrados pra modal.confirm com layout HTML rico. R17: 6 hex hardcoded ' +
           '(color:#F59E0B/#EF4444) substituídos por var(--color-warning/danger) via sed. R18: dashboard ' +
           'ai_usage_logs query agora filtra timestamp >= now-90d com fallback client-side se índice ' +
           'composto faltar. R3: CF processRoteiroQueue catch classifica erro em 8 códigos ' +
           '(rate_limit/token_limit/timeout/network/invalid_output/auth/agent_config/unknown) + flag ' +
           'isRetryable pra client decidir "tentar de novo" vs "editar prompt". Sprint Roteiros FECHADA: ' +
           '5 releases (v4.57.34→38), 15 fixes, 4 CFs criadas/atualizadas, regra Firestore expandida.',
  bucket: 'small',
  multiplierIds: ['pure_refactor', 'integration'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.9, testes: 0.2, documentacao: 0.4, implantacao: 0.1 },
  module: 'roteiros',
  modules: ['roteiros', 'cloud-functions'],
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
