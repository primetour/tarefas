const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.63.69',
  releaseSlug: '20260529-editor-cotacoes-card-panels',
  title: 'Editor de Cotações — redesign card panels (Cliente + Serviços)',
  summary: 'Renê reclamou que o editor estava "tudo muito flat e muito junto... tenho que fixar o ' +
           'olhar pra entender onde as coisas começam e onde terminam, principalmente na aba ' +
           'cliente e briefing". Redesign visual em 2 releases. v4.63.68: aba Cliente e Briefing ' +
           'reorganizada em 4 painéis card (.re-briefing-card: bg-surface + border-subtle + ' +
           'radius 8px + padding) — Identificação, Viajantes, Briefing & Preferências, com ' +
           'separação visual clara entre blocos. v4.63.69: replicação do mesmo padrão de painel ' +
           'pra aba Serviços (que tinha seu próprio sistema .svc-block/.svc-card de v4.62.31). ' +
           '_servicosStyles() bumpado data-svc-css v4.62.31→v4.63.69. .svc-block reestilizado pra ' +
           'painel (bg-surface + border + radius). Layering de cor corrigido: .svc-block-count ' +
           '(count pill) e .svc-empty (empty-state) migrados de bg-surface→bg-card pra destacar do ' +
           'painel. Os 4 blocos (Voos / Hotéis / Opcionais / Resumo & exibição) agora renderizam ' +
           'como painéis unificados idênticos à aba Cliente. Mudança 100% CSS — zero HTML/handler ' +
           'tocado, zero risco funcional. E2E real Chrome MCP validado: add/remove de voo+hotel+ ' +
           'opcional (reversível, count pills aparecem/somem), empty-states em bg-card distintos do ' +
           'painel, auto-save dispara, console limpo. Aprendizado §12.g confirmado: cache-bust de ' +
           'app.js?v= não busta módulos static-imported (version.js, roteiroEditor.js) — fix via ' +
           'fetch(...,{cache:reload}) warming em vez de limpar caches/SW (que desloga do Firebase).',
  bucket: 'small', multiplierIds: [], profile: 'feature',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.8, testes: 0.6, documentacao: 0.2, implantacao: 0.2 },
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
