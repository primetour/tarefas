/**
 * dev_hours v4.57.49 + v4.57.50 + v4.57.51 — R2 token security (cut-over + 2 hotfixes)
 * Bundled em 1 entry pq todos pertencem ao mesmo deliverable: tirar token R2 do JS público.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.57.49+50+51',
  releaseSlug: '20260526-r2-token-security-full-cutover-with-e2e',
  title: 'Banco de Imagens — Security I1: R2 token migrado pra CF (cut-over + 2 hotfixes + validação E2E completa)',
  summary: 'Fecha gap crítico #I1 da auditoria. R2_UPLOAD_TOKEN estava em código JS público (GH Pages) — ' +
           'qualquer um extraía e fazia upload/delete arbitrário no R2. Cut-over em 3 releases: v4.57.49 ' +
           'remove constantes do client, refactor 3 services (portal, agents, luxuryTravel) pra chamar CFs ' +
           '(getR2UploadUrl existente + nova deleteR2 com perm check + audit). v4.57.50 hotfix: ' +
           'getFunctions() sem app explícito falhava porque firebase.js usa app nomeado primetour-main, ' +
           'não default. v4.57.51 hotfix: CF permission check tratava roles.permissions como Array.includes, ' +
           'mas estrutura é Objeto {key:bool} — descoberto inspecionando Firestore via Chrome MCP. ' +
           'Validação E2E completa: curl confirma token zerado em 3 arquivos públicos, upload via UI ' +
           'retorna URL R2 200 OK, delete via UI deixa URL 404, logs CF mostram auth:VALID + app:VALID. ' +
           'Worker hardening (rotação de token) fica pra próxima fase (requer alteração no painel CF).',
  bucket: 'medium',
  multiplierIds: ['security', 'investigation', 'integration'],
  profile: 'feature',
  hoursByCategory: { refinamento: 0.5, desenvolvimento: 1.8, testes: 1.0, documentacao: 0.5, implantacao: 0.4 },
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
