const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.16',
  releaseSlug: '20260527-editor-fase-a-rename-visual-esconde-avancado',
  title: 'Editor Fase A — rename Roteiro→Cotação + visual + esconde Avançado',
  summary: 'Rene apontou via print: editor precisa rename + alinhamento design system + esconder Avancado. ' +
           'Briefing inclui plano maior (wizard, Servicos consolidado, Imagens com Banco picker) — discutido ' +
           'via AskUserQuestion e fechado roadmap em 5 fases. Esta release entrega Fase A (baixo risco): ' +
           '(1) SECTIONS Avancado ganha hidden:true, filtra sidebar mas preserva indice 11 do switch case. ' +
           '(2) Renames editor inteiro: Novo Roteiro→Nova Cotacao, Editar Roteiro→Editar Cotacao, Roteiro ' +
           'Gerado por IA→Cotacao Gerada por IA, banner, autosave "Nova cotacao", Resumo do Roteiro→Resumo ' +
           'da Cotacao. (3) Visual identidade PRIMETOUR: nav active/hover brand-blue→brand-gold (CLAUDE.md ' +
           '§11.f luxury), inputs light-first (fallback dark hardcoded #1a1a2e estourava no light theme ' +
           'default v4.55.7+), focus dourado consistente. Schema/route/code preservados.',
  bucket: 'small',
  multiplierIds: [],
  profile: 'feature',
  hoursByCategory: { refinamento: 0.5, desenvolvimento: 1.0, testes: 0.3, documentacao: 0.5, implantacao: 0.1 },
  module: 'roteiros',
  modules: ['roteiros'],
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
