const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.36',
  releaseSlug: '20260527-tarefa-copiar-link-no-rodape',
  title: 'Mover Copiar link pro rodape do modal de tarefa',
  summary: 'Rene: nao gostei do botao no header (ficou centralizado no topo). Mover pra junto de ' +
           'Cancelar/Salvar/Excluir no rodape. Removido o inject DOM no .modal-header (~70 linhas) e ' +
           'adicionado como item nativo do array `footer` do modal.open(). Aparece como btn-secondary ' +
           'btn-sm "Copiar link" entre Excluir e Cancelar. Mesma logica (clipboard API + fallback ' +
           'execCommand + toast confirmando). Mesma garantia de hierarquia (deep-link #tasks?taskId=X ' +
           'respeita Firestore Rules — sem permissao, modal nao abre). closeOnClick:false pra nao ' +
           'fechar o modal ao copiar. Reduz codigo em 45 linhas (era injecao DOM verbose com hover ' +
           'handlers inline, agora eh apenas item de array seguindo padrao do framework). UX ' +
           'consistente com Excluir (rodape, ao lado esquerdo das acoes neutras/destrutivas).',
  bucket: 'trivial', multiplierIds: [], profile: 'feature',
  hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.2, testes: 0.1, documentacao: 0.2, implantacao: 0.1 },
  module: 'tasks', modules: ['tasks'],
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
