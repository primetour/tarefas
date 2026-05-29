const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.63.85',
    releaseSlug: '20260529-dicas-count-fix-republish-selection',
    title: 'Dicas anexas: contagem de itens corrigida + Re-publicar renomeado/preserva seleção',
    summary: 'Continuação do reporte do Renê sobre a dica embedada ("só aparece um botão re-publicar que ' +
             'nao sei pra que serve"). Dois defeitos isolados desta seção atacados (a UI de edição/curadoria ' +
             'pós-anexo segue design-sensitive, será co-desenhada). (1) Contagem de itens: cada linha de dica ' +
             'mostrava sempre "0 items" — cálculo tratava content.segments[key] como array, mas o schema ' +
             'canônico (§16.v) é OBJETO {items,info}. Agora conta itens reais por segmento (ignora subtitle) ' +
             '+ 1 bloco pra informacoes_gerais. Validado via harness Node contra dica real (Quioto: antes 0, ' +
             'agora 95). (2) "↻ Re-publicar" → "↻ Atualizar do Portal" + tooltip explicativo (Renê não sabia ' +
             'pra que servia). (3) Re-publicar preservava seleção: handler republish-tip re-snapshotava SEM ' +
             'passar selection, descurando silenciosamente o conteúdo filtrado (puxava tudo de novo). Agora ' +
             'passa tip.content.selection pro snapshotTipForEmbed. Pendente #227 (design-sensitive): botão ' +
             'Editar/Curar pós-anexo + edição inline do texto + honrar overrides nos 3 consumidores de export.',
    bucket: 'trivial', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.2, testes: 0.15, documentacao: 0.1, implantacao: 0.05 },
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
