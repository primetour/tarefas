/**
 * Split bundle dev_hours 4.57.49+50+51 em 3 entries individuais
 * (filtros do dashboard buscam version exata).
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

// Total bundle: 3.68h. Distribuição proporcional ao trabalho real:
const ENTRIES = [
  {
    releaseVersion: '4.57.49',
    releaseSlug: '20260525-banco-imagens-r2-token-security-cf-cutover',
    title: 'Banco de Imagens — Security I1: R2 token migrado pra CF (cut-over)',
    summary: 'Fecha gap crítico #I1. R2_UPLOAD_TOKEN estava em código JS público (GH Pages) — qualquer ' +
             'um inspecionando JS extraía e fazia upload/delete arbitrário no R2. Cut-over: criada CF ' +
             'deleteR2 (espelho de getR2UploadUrl) com auth+perm+rate-limit+audit; refactor 3 services ' +
             '(portal, agents, luxuryTravel) pra chamar CFs em vez de Worker direto; constantes ' +
             'R2_UPLOAD_TOKEN/R2_WORKER_URL removidas do client. Token nunca mais aparece em JS público.',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 1.0, testes: 0.3, documentacao: 0.2, implantacao: 0.2 },
    multiplierIds: ['security', 'integration'],
  },
  {
    releaseVersion: '4.57.50',
    releaseSlug: '20260525-r2-cf-hotfix-app-explicit',
    title: 'Hotfix: getFunctions precisa de app explicit (descoberto E2E)',
    summary: 'Bug pego em validação E2E v4.57.49: getFunctions() sem argumento busca default app, mas ' +
             'firebase.js inicializa apps NOMEADOS (primetour-main + primetour-secondary). Sem default ' +
             '= erro "No Firebase App [DEFAULT] has been created". Fix em 4 chamadas (3 services): ' +
             'passar app explícito via getFunctions(app, "us-central1"). Espelho do padrão correto em ' +
             'ai.js:1245. Existem outros callsites latentes com mesmo bug (getSharePointToken etc) — ' +
             'fora do escopo deste hotfix.',
    hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.3, testes: 0.1, documentacao: 0.05, implantacao: 0.1 },
    multiplierIds: ['investigation'],
  },
  {
    releaseVersion: '4.57.51',
    releaseSlug: '20260526-cf-permissions-object-shape-fix',
    title: 'Hotfix: CF permissions check tratava objeto como array (descoberto E2E)',
    summary: 'Bug pego em validação E2E v4.57.50: CF deleteR2 + importRoteiroBankPdf falhavam pra user ' +
             'master com "permission-denied" mesmo Renê sendo master. Causa raiz (descoberta via Chrome ' +
             'MCP inspecionando Firestore): roles.{role}.permissions é OBJETO {key:bool}, NÃO array. ' +
             'Código fazia perms.includes() → sempre false. Também: users.{uid}.role pode ser "master" ' +
             'SEM flag isMaster boolean. Fix em 2 CFs. Validação E2E final: upload 200 OK, delete 404, ' +
             'logs CF auth+app VALID, tokens não expostos publicamente (curl confirma).',
    hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.4, testes: 0.5, documentacao: 0.15, implantacao: 0.05 },
    multiplierIds: ['investigation', 'security'],
  },
];

function computeHours(b, mids, ai) {
  const t = Object.values(b).reduce((a, x) => a + x, 0);
  const m = (mids || []).map(id => ({investigation:.3,migration:.2,pdf:.15,integration:.2,security:.25,pure_refactor:-.2}[id] || 0)).reduce((a, x) => a + x, 0);
  return t * (1 + m) * ai;
}

(async () => {
  // 1. Delete bundle entry se existir
  const bundleSnap = await db.collection('dev_hours').where('releaseVersion', '==', '4.57.49+50+51').get();
  for (const d of bundleSnap.docs) {
    console.log(`- removendo bundle ${d.id}`);
    await d.ref.delete();
  }

  // 2. Create 3 individual entries
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
      profile: 'bugfix',
      bucket: 'small',
      module: 'images',
      modules: ['images'],
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
