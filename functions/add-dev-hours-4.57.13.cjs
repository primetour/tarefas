/**
 * dev_hours v4.57.13 — off-by-one ausências/férias
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.57.13',
  releaseSlug: '20260525-vacation-absences-off-by-one',
  title: 'Equipe — off-by-one em ausências (1h virava 2 dias) e férias (10 virava 11)',
  summary: 'Renê (relato usuário): "fiquei fora por 1h e o sistema contou como se fossem 2 dias... e as ' +
           'ferias tb, que são 10 dias, ele marca 11". Auditoria achou 4 ocorrências de (end-start)/86400000 ' +
           '+ 1 espalhadas: vacation.js:226 (createVacationRequest), team.js:285 (render), :942 (export), :1393 ' +
           '(hint modal). O +1 foi copy/pasted assumindo "inclusivo dos 2 lados" mas: (a) ausência full o ' +
           'endDate é 23:59:59 → diff≈0.999, ceil=1, +1=2 ❌. (b) férias 10/06 a 20/06: diff=10, +1=11. Fix: ' +
           'remover +1 em todos, adicionar Math.max(1,...) defensivo, export respeita partial (1h vira "1h" ' +
           'com dias fracionário 0.04). UI: hint dinâmico no modal de férias explicando que end é exclusivo. ' +
           'Registros antigos no Firestore mantêm valor — só novos/edições usam fórmula nova.',
  bucket: 'small',
  multiplierIds: ['investigation'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.4, testes: 0.2, documentacao: 0.3, implantacao: 0.05 },
  module: 'team',
  modules: ['team', 'vacation', 'absences'],
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
