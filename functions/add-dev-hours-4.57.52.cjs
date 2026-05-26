/**
 * dev_hours v4.57.52 — Tasks legacy #59 + #60
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.57.52',
  releaseSlug: '20260526-tasks-59-60-dedupe-hierarchical-quickadd',
  title: 'Pendências legacy: dedupe portal_destinations + quick-add do banco + helper hierárquico',
  summary: 'Fecha 2 pendências legacy (pre-sessão maio). #60: ensureDestination() já existia em ' +
           'roteiroBank.js mas nunca era chamada. UI prometia auto-criar destinos mas nunca foi wired. ' +
           'Agora roteiroBankEditor.autosave() dispara _syncDestinationsBackground() pós-save — itera ' +
           'geo.cities[], ensureDestination pra cada, coleta em geo.destinationIds, update pontual ' +
           'sem re-trigger autosave. Toast com count de novos. Flag _destSyncing previne re-entrada. ' +
           '#59 (opção A escolhida): cleanup mínimo + helper hierárquico SEM migrar schema. Script ' +
           'Admin SDK detectou + mergeou 2 grupos dups (Lisboa, Kyoto) → 64→62 docs, 0 dupes, FK ' +
           'reapointed 0 (perdedores órfãos). fetchDestinationsHierarchical() retorna estrutura ' +
           'aninhada agregada em memória — schema Firestore continua FLAT, UI pode drill-down sem ' +
           'N queries. Ordenação CONTINENTS canônica + pt-BR fallback.',
  bucket: 'small',
  multiplierIds: ['migration', 'integration'],
  profile: 'feature',
  hoursByCategory: { refinamento: 0.4, desenvolvimento: 0.9, testes: 0.25, documentacao: 0.3, implantacao: 0.15 },
  module: 'portal',
  modules: ['portal', 'banco-roteiros'],
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
