const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.62.2',
    releaseSlug: '20260527-destinations-linked-roteiros-button-modal',
    title: 'Destinos — botão "Roteiro (N)" + double-check edição preserva vínculos',
    summary: 'Renê: "teste a funcionalidade disso, a edição dos destinos sem perder a vinculação com o ' +
             'roteiro... acrescente o botão roteiro, que vai exibir o que está vinculado, ajuda no UX". ' +
             'Implementado: _loadRoteiroLinks() constrói Map<destId, [{id,title,status}]> via fetchAllBank, ' +
             'icon SVG 📋 ao lado do 💡 dica quando count>0, _openLinkedRoteirosModal lista clicáveis ' +
             'cross-navegação Destinos → Banco. Validado: edição de destination NÃO toca em ' +
             'roteiros_bank.geo.destinationIds (vínculo M:N preservado).',
    bucket: 'small',
    multiplierIds: [],
    profile: 'feature',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 1.5, testes: 0.4, documentacao: 0.2, implantacao: 0.1 },
    module: 'portal',
    modules: ['portal', 'banco-roteiros'],
  },
  {
    releaseVersion: '4.62.3',
    releaseSlug: '20260527-destinations-pending-source-badge-sort-recent',
    title: 'Destinos pending — badge origem + sort recentes + breakdown banner',
    summary: 'Renê: "fiz várias correções em destinos sem geo, mas percebi que não espelhou para destinos ' +
             'pendentes. pode verificar? a fonte de informação é única (destinos)". Diagnóstico via Admin ' +
             'SDK confirmou que os 84 destinations criados via bolsão ESTAVAM lá (source=envision-auto), ' +
             'apenas misturados sem distinção visual com os 94 do populate inicial (source=banco-auto). ' +
             'Implementado: SOURCE_BADGES map (🌍 Bolsão / 📦 Banco / Manual) em cada linha pending com ' +
             'tooltip explicativo, sort por createdAt DESC quando filtro Pendentes ativo (recém-criados no ' +
             'topo), breakdown numérico no banner ("178 pendentes · 84 bolsão 🌍 · 94 banco 📦"). Materializa ' +
             'a filosofia "única fonte" — user agora vê espelho imediato do que faz no bolsão.',
    bucket: 'small',
    multiplierIds: [],
    profile: 'feature',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 1.2, testes: 0.5, documentacao: 0.2, implantacao: 0.1 },
    module: 'portal',
    modules: ['portal'],
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
