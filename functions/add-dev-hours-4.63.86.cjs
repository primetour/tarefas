const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.63.86',
    releaseSlug: '20260529-dica-editar-conteudo-curar',
    title: 'Dicas anexas: botão "Editar conteúdo" — re-curadoria granular da seleção',
    summary: 'Primeira metade do #227 (a curadoria; a edição inline do texto fica pra v4.63.87). ' +
             'Reporte do Renê: "eu nao consigo editar pra escolher o que eu quero da dica... só aparece ' +
             'um botão re-publicar que nao sei pra que serve". (1) Novo botão "✎ Editar conteúdo" na linha ' +
             'de cada dica anexada (roteiroEditor.js renderEmbeddedTipsSection) reabre o seletor granular ' +
             '(segmentos + itens, incl. informacoes_gerais) PRÉ-MARCADO com content.selection. Consultor ' +
             'desmarca o que não quer, confirma, e o conteúdo é re-filtrado sem mexer no Portal (canônico ' +
             'intacto). (2) _openTipSelectionModal reaproveitável: novo opts.initialSelection pré-marca os ' +
             'checkboxes (indeterminate + auto-expand de segmentos parciais), opts.titleVerb/confirmLabel ' +
             'adaptam copy anexo-vs-edição — zero duplicação de UI. (3) fetchTipById(tipId) em roteiros.js ' +
             'busca a dica ORIGINAL completa do Portal (snapshot só guarda os segmentos filtrados), com ' +
             'erro gracioso se removida. Ao confirmar, re-roda snapshotTipForEmbed(tipId, novaSeleção) ' +
             'preservando o id local → mesmo shape content.segments já consumido pelos 3 exports ' +
             '(HTML/jsPDF/web link), sem mudança nos consumidores. Pendente v4.63.87: edição inline do ' +
             'texto dos itens (override local) + honrar overrides nos 3 exports.',
    bucket: 'small', multiplierIds: [], profile: 'feature',
    hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.45, testes: 0.2, documentacao: 0.15, implantacao: 0.05 },
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
