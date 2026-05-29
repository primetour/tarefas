const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.63.70',
  releaseSlug: '20260529-editor-tabs-restantes-cards',
  title: 'Editor de Cotações — card panels nas 4 abas densas restantes',
  summary: 'Conclusão do redesign card-painel iniciado em v4.63.68 (Cliente/Briefing) e v4.63.69 ' +
           '(Serviços). As 4 abas que ainda renderizavam "flat" (só re-section-title + conteúdo ' +
           'solto) passam a usar o mesmo padrão .re-briefing-card das demais. Inclui/Não Inclui: ' +
           '2 painéis lado-a-lado (re-two-cols), cada um com header (✅ Inclui / 🚫 Não Inclui), ' +
           'contador de itens e botão "+ Padrão" movido pro head. Pagamento: painel único ' +
           '💳 Condições de Pagamento. Cancelamento: painel 📋 Política de Cancelamento com ' +
           'contador de regras + "+ Política padrão" no head. Informações Importantes: 2 painéis ' +
           '(ℹ️ Documentação & Logística com grid de 6 textareas + ➕ Campos Adicionais com ' +
           'contador e "+ Adicionar Campo" no head). Mudança 100% de marcação/CSS reusando classes ' +
           'existentes. IDs (#re-includes-list, #re-excludes-list, #re-canc-body, ' +
           '#re-info-custom-body) e data-action preservados — handlers delegados intactos, zero ' +
           'risco funcional. E2E real Chrome MCP validado nas 4 abas.',
  bucket: 'small', multiplierIds: [], profile: 'feature',
  hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.6, testes: 0.5, documentacao: 0.2, implantacao: 0.2 },
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
  const doc = { entryType: 'release', ...ENTRY, aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE,
    totalHours: Math.round(h * 100) / 100, totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
    status: 'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now };
  const ref = await db.collection('dev_hours').add(doc);
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  process.exit(0);
})();
