/**
 * dev_hours v4.57.44 — Banco de Imagens 1/5: REVERTE auto-delete + badge
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.57.44',
  releaseSlug: '20260525-banco-imagens-revert-autodelete-add-badge',
  title: 'Banco de Imagens — sprint 1/5: REVERSÃO auto-delete 30d + badge "Não usada"',
  summary: 'Renê corrigiu (2026-05-25): "a ideia do banco é ter os arquivos independente da quantidade ' +
           'de uso". Banco é REPOSITÓRIO, não cache. Reverti comportamento errado introduzido por mim em ' +
           'v4.57.42 (PD10): removido hard-delete >30d + marker em portal_images_pending_r2_delete + ' +
           'stat hardDeleted + var cutoff30d. CF agora APENAS sinaliza via flag unused — jamais deleta. ' +
           'Hard-delete é exclusivamente manual via botão Excluir. Gap #I5 (CF processor R2 markers) ' +
           'cancelado por consequência. Adicionado badge UI "Não usada" no card (azul informativo, ' +
           'tooltip explicativo) — curador vê contexto sem alarme. E2E: scanned:128, flaggedUnused:128, ' +
           '0 errors, campo hardDeleted ausente confirma reversão.',
  bucket: 'small',
  multiplierIds: ['pure_refactor'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.4, desenvolvimento: 0.5, testes: 0.2, documentacao: 0.4, implantacao: 0.15 },
  module: 'images',
  modules: ['images'],
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
