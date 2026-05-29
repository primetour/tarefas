const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.63.84',
    releaseSlug: '20260529-cotacoes-dicas-premium-entity-decode',
    title: 'Cotações: dicas embedadas premium + decode entidades + capa mais escura + fix secret R2',
    summary: 'Reportado pelo Renê após gerar PDF de cotação real (Bradesco/Yamamoto): "deu msg de erro ao ' +
             'gerar o template puppeteer e falou que ia usar outro modelo... na capa precisa ser mais ' +
             'escuro... na pagina 10 tem problema nos titulos. toda a parte das dicas precisa de atenção, ' +
             'está muito cru". (1) Render de erro corrigido na raiz: CF renderTemplate tem fallback R2 pra ' +
             'PDFs >5MB (upload pro worker com X-Upload-Token), mas o secret R2_UPLOAD_TOKEN não estava ' +
             'bindado no onCall({secrets}) → value() lançava, upload falhava, base64 gigante estourava ' +
             '"Response size too large" → cliente caía pro jsPDF (o "outro modelo"). Bind + deploy + log. ' +
             '(2) Dicas embedadas → cards premium: templateAdapter roteiroToTemplateData mapeia embeddedTips ' +
             '→ dicas via helper compartilhado shapeTipSegmentos (reusa shaping provado do ' +
             'portalToTemplateData); nova seção {{#if dicas.length}} no seed + CSS dedicado ' +
             '(.dica-block/.dica-seg/.dica-item/.dica-chips); Informações Gerais vira chips, place_list ' +
             'vira itens nome+categoria+desc+endereço+site; break-inside/after:avoid (resolve tb títulos ' +
             'pág.10, artefato do jsPDF fallback). (3) _decodeEntities + _NAMED_ENTITIES: dados Envision ' +
             'guardam entidade literal (&amp;) que Handlebars re-escapava → user via &amp; cru; ' +
             'decode-primeiro-reescapa. (4) Capa: scrim ainda mais escuro (preto 0.86→0.66→0.90 + flat ' +
             '0.30 + cor secundária) + text-shadow reforçado. Validação: render local determinístico ' +
             '(puppeteer-core + Chrome for Testing, opções EXATAS do page.pdf da CF) contra cotação real ' +
             'Bradesco (13 dias, 4 voos, 4 hotéis, dica Quioto 5 segmentos/94 itens). PDF 26 páginas ' +
             'inspecionado: capa legível, dicas como cards (chips + restaurantes/atrações/compras), zero ' +
             'título órfão; pdftotext grep de entidades = ZERO; & renderiza literal. Template re-seedado ' +
             '(R2 + Firestore DXKW7JzJ6ijQiJO09ydF isDefault, antigo arquivado). Pendente design-sensitive ' +
             '(não nesta release): UI editor pra editar dica embedada + selecionar segmentos/itens (hook ' +
             'selection já pronto em shapeTipSegmentos; UI será apresentada antes de construída).',
    bucket: 'small', multiplierIds: ['investigation', 'pdf', 'integration'], profile: 'feature',
    hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.7, testes: 0.5, documentacao: 0.2, implantacao: 0.2 },
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
