const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.62.21',
    releaseSlug: '20260527-editor-consultar-banco-checkboxes-por-dia',
    title: 'Editor — Consultar Banco com checkboxes por dia (refinamento Fase C)',
    summary: 'Refinamento da Fase C v4.62.18 que importava TODOS os dias. Agora _pickDaysFromBankRoteiro ' +
             'abre 2º step com lista de dias do roteiro escolhido + checkboxes. Default todos marcados. ' +
             'Bulk select/clear. Contador dinâmico "N/T selecionados". Botão Importar disable quando 0. ' +
             'Cada row mostra titulo + descricao truncada 200 chars pra user decidir. Highlight gold em ' +
             'rows checked. Schema preserva bankRefId + bankRefTitle + novo bankRefDayIdx (referencia ' +
             'ao dia original).',
    bucket: 'small', multiplierIds: [], profile: 'feature',
    hoursByCategory: { refinamento: 0.2, desenvolvimento: 1.2, testes: 0.3, documentacao: 0.2, implantacao: 0.1 },
    module: 'roteiros', modules: ['roteiros', 'banco-roteiros'],
  },
  {
    releaseVersion: '4.62.22',
    releaseSlug: '20260527-editor-ia-incremental-proximo-dia',
    title: 'Editor — IA incremental: gerar próximo dia individual',
    summary: 'Placeholder do modal Fase C "Adicionar próximo dia" vira função real _aiGenerateNextDay. ' +
             'Modal pequeno pede cidade (datalist destinos do briefing) + foco opcional. Chama ' +
             'chatWithAI direto (sem fila pesada, ~15s). Prompt focado: contexto = briefing + dia ' +
             'anterior. Output esperado JSON {title, narrative, activities[]}. Parse defensivo extrai ' +
             'bloco JSON mesmo com markdown fences. Fallback usa texto cru como narrative se parse ' +
             'falhar. Dia gerado: source=ai, data anterior+1, 3-6 atividades cronologicas. Completa ' +
             'fluxo hibrido (CLAUDE.md Rene: "um pedaco manual, outro do banco, outro IA") — agora os ' +
             '3 caminhos funcionam.',
    bucket: 'small', multiplierIds: ['integration'], profile: 'feature',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 1.5, testes: 0.3, documentacao: 0.2, implantacao: 0.1 },
    module: 'roteiros', modules: ['roteiros', 'iahub'],
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
