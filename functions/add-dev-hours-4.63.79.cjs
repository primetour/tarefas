const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.63.79',
    releaseSlug: '20260529-briefing-dests-dicas-select',
    title: 'Briefing multi-select de destinos (auto-filtra Banco + Dicas) + seleção granular de conteúdo das Dicas',
    summary: 'Duas melhorias de UX do Renê no teste E2E de export. (#1) Briefing ganha botão ' +
             '"Selecionar destinos do banco" → multi-picker sobre portal_destinations (SSOT): marca ' +
             'várias cidades (busca + filtro continente, dedup cidade+país), confirma → viram ' +
             'travel.destinations[]. Painel dourado contextual com "Consultar Banco filtrado" + ' +
             '"Anexar dicas destes destinos". Ambos os modais (Consultar Banco + Anexar Dica) ganham ' +
             'toggle "Só destinos do briefing (N)" ligado por padrão, pré-filtrando por países/cidades ' +
             'do briefing (com escape "ver todos"). (#2) Ao anexar dica, sub-step de seleção granular: ' +
             'checkbox por segmento inteiro + expansão pra itens específicos (indeterminate, contador, ' +
             'selecionar tudo/limpar). snapshotTipForEmbed(tipId, selection) embeda só o escolhido; ' +
             'tudo marcado → null (snapshot completo, retrocompat). Respeita schema real ' +
             'portal_tips.segments (§16.v): objeto {items,info}, índices reais preservam subtitles, ' +
             'informacoes_gerais = 1 bloco. Sem mudança de schema. Validado via node --check + harness ' +
             'Node de _applyTipSelection (5 cenários). E2E visual pendente (requer relogin do Renê).',
    bucket: 'small', multiplierIds: ['integration'], profile: 'feature',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.6, testes: 0.25, documentacao: 0.15, implantacao: 0.05 },
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
    const doc = { entryType: 'release', ...ENTRY, aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE,
      totalHours: Math.round(h * 100) / 100, totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
      status: 'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now };
    const ref = await db.collection('dev_hours').add(doc);
    console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  }
  process.exit(0);
})();
