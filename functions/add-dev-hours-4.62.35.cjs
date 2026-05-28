const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.35',
  releaseSlug: '20260527-tarefa-compartilhar-link-deep-link',
  title: 'Compartilhar tarefa via link (respeitando hierarquia)',
  summary: 'Rene: usuario quer compartilhar tarefa via link, restricao critica eh que o link NAO ' +
           'pode ignorar a hierarquia de usuario existente. Auditei: deep-link #tasks?taskId=X ja ' +
           'existe (v4.49+) e respeita Firestore Rules + fetchTasks server-side filtering — sem ' +
           'permissao, tarefa nao vem no fetch e modal nao abre. Toast "Tarefa nao encontrada ou ' +
           'sem permissao de acesso" tambem ja existe (tasks.js:689). Faltava so o gesture UX de ' +
           'copiar. Adicionado botao icone link cinza com hover dourado no header do modal de tarefa, ' +
           'ANTES do X de fechar, aparece SO em modo edicao (precisa task.id). Click copia URL ' +
           'location.origin + location.pathname + #tasks?taskId=ID pro clipboard via navigator.' +
           'clipboard.writeText com fallback execCommand pra contexts sem clipboard API (HTTP/iframe). ' +
           'Toast confirmando: "Link copiado. So quem tem permissao na tarefa vai conseguir abrir.". ' +
           'try/catch envolve toda a injecao do botao — falha silenciosa se DOM mudar, nunca bloqueia ' +
           'abertura do modal. Zero mudanca em modal.js (sem touch em API compartilhada). Zero ' +
           'mudanca em Firestore Rules. Hierarquia 100% preservada — link nao bypassa rule alguma.',
  bucket: 'trivial', multiplierIds: ['security'], profile: 'feature',
  hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.4, testes: 0.2, documentacao: 0.2, implantacao: 0.1 },
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
