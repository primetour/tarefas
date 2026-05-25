/**
 * dev_hours v4.57.8 — Portal: remove campo "Squad responsável" do Step 2.
 *
 * Renê: usuário externo não conhece fluxo interno do setor; coordenadores
 * finalizam preenchimento no app principal.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.57.8',
  releaseSlug: '20260525-portal-remove-squad-field',
  title: 'Portal Step 2 — remove campo "Squad responsável (opcional)"',
  summary: 'Renê: "usuário que pede algo nao sabe do fluxo interno do setor... entao é melhor só deixar o ' +
           'setor e, no portal de solicitações, coordenadores finalizam preenchimento da tarefa". Remove ' +
           'bloco <div id="pw-nucleo-wrap"> + handler nucleoSel.change + chamada _loadSquadsForSector. ' +
           'Compat: _state.data.nucleo segue como "" inicial; _buildRequestDoc continua serializando; ' +
           'summary do Step 4 + recent cards renderizam squad condicional (se request legado tiver). ' +
           'Coordenadores atribuem squad no app principal pós-validação. WIZARD_VERSION bumped (§12.t).',
  bucket: 'trivial',
  multiplierIds: [],
  profile: 'feature',
  hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.2, testes: 0.1, documentacao: 0.1, implantacao: 0.05 },
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
