const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.63.19',
  releaseSlug: '20260528-cotacoes-default-template-seed',
  title: 'Cotacoes PDF legacy -> template HTML seed (Migracao 2/3 mais usado)',
  summary: 'Migracao 2/3 generators legados. Reescreve generateRoteiroPDF do roteiroGenerator.js ' +
           '(~3302 LOC MODULO MAIS USADO) como template HTML+CSS Handlebars. NEW templates/seeds/' +
           'cotacoes-default-html.html ~14KB: Cover com brand/logo destinos uppercase ROTEIRO DE ' +
           'VIAGEM badge noites datas cliente+pax linhas decorativas brancas. Dia-a-dia com numero ' +
           'circle primary hero per day narrative atividades pernoite. Aereo/Hospedagem em tabelas. ' +
           'Valores com casal/pessoa/customRows disclaimer validity. Opcionais tabela. Inclui/Exclui ' +
           'com check verde/x vermelho. Pagamento KV layout. Cancelamento periodos x penalidades. ' +
           'Info importante passaporte/visto/vacinas/clima/bagagem/voos + custom. Closing page boa ' +
           'viagem. EXPANDED roteiroToTemplateData adapter: area.corAccent fallback primary, ' +
           'customFooter/Header/hideCover via opts, contact, hasIncExc flag, dias.heroUrl via ' +
           'imagesByCity normalized lookup, precos.hasData/customRows/validUntil, pagamento.hasData, ' +
           'informacoes.hasData. Cliente/Viagem precomputed labels (no Handlebars eq builtin): ' +
           'cliente.adultsLabel/childrenLabel/paxLabel, viagem.noitesLabel. roteiroGenerator passa ' +
           'context: enrichRoteiroImages dentro do template branch, byCity normalizado, ' +
           'resolveExportTemplate. Seed: XZzybZJ0GA4QVrDe6oEM global default cotacoes.html (antigo ' +
           'ed9WZeVghfFMbhANeZGV virou isDefault=false apos hotfix). E2E: 85.7KB PDF 4.6s.',
  bucket: 'large', multiplierIds: ['integration', 'pdf'], profile: 'feature',
  hoursByCategory: { refinamento: 0.6, desenvolvimento: 4.0, testes: 1.0, documentacao: 0.8, implantacao: 0.5 },
  module: 'templates', modules: ['templates', 'roteiros', 'portal'],
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
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  process.exit(0);
})();
