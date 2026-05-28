const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.30',
  releaseSlug: '20260527-editor-cliente-salesforce-opportunity-id',
  title: 'Campo Oportunidade (Salesforce) em Cliente e Briefing (passo 1 de 2)',
  summary: 'Rene: acrescentar campo Oportunidade (Salesforce) na secao Cliente e Briefing. Passo 2 ' +
           'futuro sera preencher esse ID e via API auto-popular nome/email/telefone/preferencias/ ' +
           'restricoes/viajantes/datas — mas ainda em maturacao. Passo 1 entrega so visibilidade: ' +
           'schema estendido + input texto + hint inline sobre futuro auto-fetch. Schema: ' +
           'client.salesforceOpportunityId em emptyRoteiro(). Doc antigo sem campo: fallback "" no ' +
           'render, sem migration on-read necessaria (setNested cria no save). UI: input texto largura ' +
           '520px posicionado logo abaixo do intro "Quem é o cliente..." e ANTES de Nome/Email/Tel, ' +
           'porque eh o identificador que vai linkar tudo no passo 2. Label "Oportunidade (Salesforce)" ' +
           '+ tag "opcional" cinza. Hint: "Cole o ID ou link da oportunidade no Salesforce. Em breve: ' +
           'ao preencher, sistema vai puxar cliente + briefing automaticamente via API". Persiste via ' +
           'data-field padrao (collectFormData ja recolhe via setNested generico). Sem integracao API ' +
           'nesta release — terreno preparado pro passo 2 quando Rene amadurecer requisitos.',
  bucket: 'trivial', multiplierIds: [], profile: 'feature',
  hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.3, testes: 0.1, documentacao: 0.2, implantacao: 0.1 },
  module: 'roteiros', modules: ['roteiros'],
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
