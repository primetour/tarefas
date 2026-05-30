const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.63.93',
    releaseSlug: '20260530-pdf-cover-fullbleed-margins',
    title: 'Cotações/Banco PDF: capa full-bleed + respiro de topo nas páginas de conteúdo',
    summary: 'Renê pediu "Capa está cortada, textos estão começando no limite superior da folha... ' +
             'analise o pdf para realizar as melhorias visuais." Causa raiz: render via template ' +
             '(Puppeteer page.pdf) aplicava margens uniformes, mas Chromium só aplica margem de topo ' +
             'na 1ª página de cada fluxo (continuação colava no topo); e a capa 210×297mm era recortada ' +
             'por qualquer margem do page.pdf (moldura branca). Fix: CF _renderTemplateCore agora chama ' +
             'page.pdf({margin:0}) — controle de margem migra pro CSS @page de cada template. ' +
             'cotacoes-default-html: @page{margin:18mm 15mm} conteúdo + @page coverpage/closingpage{margin:0} ' +
             'full-bleed; .cover/.closing viram páginas nomeadas 210×297mm; linhas decorativas reposicionadas; ' +
             'largura preservada (31mm efetivo). banco-roteiros-default-html: mesma receita + removidas regras ' +
             'CSS Paged Media running(footer)/running(header) + @bottom-center/@top-right (Chromium não suporta ' +
             '→ footer caía solto no topo) + elemento .footer-area do body. Blast radius: só os 2 templates HTML ' +
             'ativos que passam por page.pdf (cotações + banco); portal ativo é formato web (intocado). ' +
             'Validado via harness Puppeteer real (Yamamoto 34pg + banco sample): capa full-bleed, página 2 ' +
             'com margem de topo, sem footer solto. Requer deploy CF + re-seed dos 2 templates no R2.',
    bucket: 'small', multiplierIds: ['investigation', 'pdf'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.5, testes: 0.35, documentacao: 0.1, implantacao: 0.15 },
    module: 'cotacoes', modules: ['cotacoes', 'banco-roteiros'],
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
