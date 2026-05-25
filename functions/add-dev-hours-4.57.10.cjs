/**
 * dev_hours v4.57.10 — wizard edit mode abre no Step 3 (não Step 1)
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.57.10',
  releaseSlug: '20260525-portal-edit-opens-step3',
  title: 'Portal — edit mode abre direto no Step 3 (Detalhes)',
  summary: 'Renê: "qdo peço pra alterar uma solicitação já enviada o sistema volta para o passo 1... deveria ' +
           'abrir a descrição da tarefa". _enterEditMode setava _state.step = 1 (Setor+Tipo), forçando user a ' +
           're-clicar Próximo 2x até chegar na descrição. Setor + tipo + data já vêm pré-populados da request ' +
           'original — abrir direto no Step 3 (variação/título/descrição/link) elimina retrabalho. User pode ' +
           'usar "← Voltar" pra ajustar data ou setor se necessário.',
  bucket: 'trivial',
  multiplierIds: [],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.05, desenvolvimento: 0.1, testes: 0.05, documentacao: 0.1, implantacao: 0.05 },
  module: 'requests',
  modules: ['requests', 'portal'],
};

function computeHours(b, multIds, ai) {
  const t = Object.values(b).reduce((a,x)=>a+x,0);
  const m = (multIds||[]).map(id=>({investigation:.3,migration:.2,pdf:.15,integration:.2,security:.25,pure_refactor:-.2}[id]||0)).reduce((a,x)=>a+x,0);
  return t*(1+m)*ai;
}

(async () => {
  const ex = await db.collection('dev_hours').where('releaseVersion','==',ENTRY.releaseVersion).limit(1).get();
  if (!ex.empty) { console.log('= skip'); process.exit(0); }
  const h = computeHours(ENTRY.hoursByCategory, ENTRY.multiplierIds, AI_ASSIST);
  const now = FV.serverTimestamp();
  const doc = {
    entryType:'release', ...ENTRY,
    aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE,
    totalHours: Math.round(h*100)/100, totalCost: Math.round(h*HOURLY_RATE*100)/100,
    status:'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now,
  };
  const ref = await db.collection('dev_hours').add(doc);
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  process.exit(0);
})();
