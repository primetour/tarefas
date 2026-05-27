const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.62.17',
    releaseSlug: '20260527-editor-fase-b-imagens-banco-picker-badge',
    title: 'Editor Fase B — Imagens: picker Banco com contagem visível + visual padrão',
    summary: 'Picker do Banco JA existia (modal aba Banco do Portal em openImagePickerModal) mas user nao ' +
             'enxergava. Fix: botao "Trocar" -> "📚 Imagens" (banco default), badge dourado com CONTAGEM ' +
             'de imagens disponiveis no banco pro destino (pre-fetch _ensureBankImages + populate em ' +
             'queueMicrotask sem bloquear paint). Botoes alinhados com sistema (.btn .btn-secondary ' +
             '.btn-sm vs .re-add-btn custom — CLAUDE.md §4). Limpar vira .btn .btn-ghost btn-sm danger. ' +
             'Capa "do Roteiro" -> "da Cotacao".',
    bucket: 'small', multiplierIds: [], profile: 'feature',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 1.0, testes: 0.3, documentacao: 0.3, implantacao: 0.1 },
    module: 'roteiros', modules: ['roteiros', 'images'],
  },
  {
    releaseVersion: '4.62.18',
    releaseSlug: '20260527-editor-fase-c-dia-3-botoes-origem-badge',
    title: 'Editor Fase C — Dia a Dia: 3 botoes origem hibrida + badge por dia',
    summary: 'Header da aba ganha 3 botoes alinhados sistema: 📚 Consultar Banco (modal lista roteiros ' +
             'aprovados, click importa todos os dias como source=bank), + Adicionar manualmente (handler ' +
             'existente, agora seta source=manual), 🤖 Gerar por IA (modal escopo: Inteiro reusa ' +
             'aiGenerateFullRoteiro existente marcando source=ai; Adicionar proximo placeholder). Cada ' +
             'day card mostra badge canto: 📝 Manual / 📚 Banco / 🤖 IA (cores muted/blue/gold). Hint ' +
             'embaixo do header explica fluxo hibrido (CLAUDE.md instrucao Rene: "um pedaco manual, outro ' +
             'do banco, outro IA"). Schema days[].source novo + days[].bankRefId/bankRefTitle preserva ' +
             'origem do dia copiado.',
    bucket: 'small', multiplierIds: ['integration'], profile: 'feature',
    hoursByCategory: { refinamento: 0.5, desenvolvimento: 2.0, testes: 0.5, documentacao: 0.4, implantacao: 0.1 },
    module: 'roteiros', modules: ['roteiros', 'banco-roteiros'],
  },
  {
    releaseVersion: '4.62.19',
    releaseSlug: '20260527-editor-fase-d-servicos-consolidados-subtabs',
    title: 'Editor Fase D — Servicos consolidado (sub-tabs Aereo/Valores/Opcionais)',
    summary: 'Decisao Rene via AskUserQuestion: sub-tabs dentro de Servicos. 3 abas viram 1: Aereo+Hoteis, ' +
             'Valores, Opcionais ganham hidden:true (somem sidebar). Nova SECTION Servicos (index 14) ' +
             'switch case 14. renderServicosSection() expoe sub-tabs ✈/💰/⭐ que delegam pros renderers ' +
             'existentes (preserva schema). _servicosActiveSubtab module-scope. SIDEBAR_ORDER novo array ' +
             'define ordem visual (Cliente, Dia, Servicos, Inclui, Pagamento, Cancelamento, Info, ' +
             'Imagens, Dicas, Preview, IA) — indices originais do SECTIONS preservados. Click handler ' +
             'subtabs interceptado antes do [data-action] filter.',
    bucket: 'small', multiplierIds: [], profile: 'feature',
    hoursByCategory: { refinamento: 0.5, desenvolvimento: 1.5, testes: 0.5, documentacao: 0.3, implantacao: 0.1 },
    module: 'roteiros', modules: ['roteiros'],
  },
  {
    releaseVersion: '4.62.20',
    releaseSlug: '20260527-editor-fase-e-wizard-entry-cotacao-nova',
    title: 'Editor Fase E — Wizard de entrada pra cotacao nova',
    summary: 'Cotacao nova em branco (sem roteiroId + sem aiGenerated) ganha card de entrada no topo com ' +
             '3 atalhos: 📝 Em branco (dismissa, edita normal), 📚 Do Banco (navega Dia a Dia + abre ' +
             'modal Consultar Banco), 🤖 Gerar com IA (navega Cliente e Briefing + toast com instrucao ' +
             'pra preencher briefing antes da IA). Botao × pra dismissar e ir direto pras tabs. Cotacao ' +
             'existente abre direto nas tabs (Rene: wizard so pra nova, mantem edicao livre). Wizard ' +
             'formal multi-step fica pra futura iteracao se Rene pedir apos testar — esta versao e a ' +
             'rampa de entrada que entrega valor da escolha guiada sem refactor arquitetural pesado.',
    bucket: 'small', multiplierIds: [], profile: 'feature',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.6, testes: 0.3, documentacao: 0.2, implantacao: 0.1 },
    module: 'roteiros', modules: ['roteiros'],
  },
];

function computeHours(b, mids, ai) {
  const t = Object.values(b).reduce((a, x) => a + x, 0);
  const m = (mids || []).map(id => ({ investigation: .3, migration: .2, pdf: .15, integration: .2, security: .25, pure_refactor: -.2 }[id] || 0)).reduce((a, x) => a + x, 0);
  return t * (1 + m) * ai;
}

(async () => {
  for (const ENTRY of ENTRIES) {
    const ex = await db.collection('dev_hours').where('releaseVersion', '==', ENTRY.releaseVersion).limit(1).get();
    if (!ex.empty) { console.log(`= skip ${ENTRY.releaseVersion}`); continue; }
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
  }
  process.exit(0);
})();
