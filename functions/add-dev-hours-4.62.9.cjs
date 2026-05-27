const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.9',
  releaseSlug: '20260527-tip-editor-load-via-sessionstorage',
  title: 'Clique em Dica de destino com tip leva pra tip (era abrindo nova)',
  summary: 'Renê: se destino possui dica, clicar deveria levar pra dica existente, nao pra modulo de ' +
           'criacao de nova. Bug reproduzido via Chrome MCP E2E: navegar direto pra ' +
           '#portal-tip-editor?destId=XXX (Cape Town com tip) abria com title=Editor de Dica (generico) + ' +
           'selector visivel (modo NOVA). Mesma URL via hashchange runtime funcionava — boot race com ' +
           'query param na hash. Fix pragmatico via sessionStorage como canal robusto: botao Dica vira ' +
           '<button> com handler que faz sessionStorage.setItem + location.hash, editor le URL OR ' +
           'sessionStorage como fallback, consome e remove. URL param mantido pra backward compat de ' +
           'outras pages que ja apontam pra ?destId=.',
  bucket: 'small',
  multiplierIds: ['investigation'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.4, desenvolvimento: 0.5, testes: 0.5, documentacao: 0.3, implantacao: 0.1 },
  module: 'portal',
  modules: ['portal'],
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
  const doc = {
    entryType: 'release', ...ENTRY,
    aiAssistanceMultiplier: AI_ASSIST,
    hourlyRate: HOURLY_RATE,
    totalHours: Math.round(h * 100) / 100,
    totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
    status: 'approved',
    completedAt: now, createdAt: now,
    createdBy: RENE_UID, updatedAt: now,
  };
  const ref = await db.collection('dev_hours').add(doc);
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  process.exit(0);
})();
