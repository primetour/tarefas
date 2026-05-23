/**
 * Backfill dev_hours: v4.50.2 + v4.50.3 + v4.50.4
 *  - v4.50.2: hotfix filtro país (selects precisam de `id`)
 *  - v4.50.3: Banco — remover Importar PDF + Exportar PDF nos cards (mesmo layout Gerador)
 *  - v4.50.4: Sidebar cleanup (Dev Hours, Landing Pages, CMS / Site removidos)
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const HOURLY_RATE = 150;
const AI_ASSIST   = 0.50;
const COLLECTION  = 'dev_hours';
const RENE_UID    = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.50.2',
    releaseSlug: '20260522-fix-filter-pais-render',
    title: 'Hotfix Banco — filtro país: selects precisam de `id` (não `name`)',
    summary: 'renderFilterBar() do uiKit gera <select id="${s.id}">, mas roteiroBank passava `name`. ' +
             'Resultado: selects de Continente e País renderizavam com id="" e listeners não disparavam. ' +
             'Trocado pra id `rb-filter-continent`/`rb-filter-country` + listeners atualizados.',
    bucket: 'trivial',
    multiplierIds: ['investigation'],
    profile: 'bugfix',
    aiAssistanceMultiplier: AI_ASSIST,
    hoursByCategory: { refinamento: 0.05, desenvolvimento: 0.2, testes: 0.1, documentacao: 0.05, implantacao: 0.05 },
    status: 'approved',
    module: 'banco-roteiros',
  },
  {
    releaseVersion: '4.50.3',
    releaseSlug: '20260522-banco-export-pdf',
    title: 'Banco — remover Importar PDF (sem função) + Exportar PDF nos cards (layout do Gerador)',
    summary: '3 mudanças: (1) botão "Importar PDF" do header e empty state removidos (não tinham função); ' +
             '(2) ícone download SVG nos cards ao lado de duplicar/arquivar, visível pra todos; ' +
             '(3) novo arquivo roteiroBankGenerator.js com bankDocToRoteiroShape() que adapta schema bank → roteiro, ' +
             'reusando 100% do pipeline visual do generateRoteiroPDF (mesma capa, day-by-day, hotels, pricing, cancelamento, ' +
             'docs, Poppins, cores, rodapé). Filename: Banco-{titulo-slug}.pdf.',
    bucket: 'small',
    multiplierIds: ['pdf'],
    profile: 'feature',
    aiAssistanceMultiplier: AI_ASSIST,
    hoursByCategory: { refinamento: 0.15, desenvolvimento: 1.2, testes: 0.2, documentacao: 0.1, implantacao: 0.1 },
    status: 'approved',
    module: 'banco-roteiros',
  },
  {
    releaseVersion: '4.50.4',
    releaseSlug: '20260522-sidebar-cleanup',
    title: 'Sidebar cleanup — Dev Hours, Landing Pages e CMS/Site removidos',
    summary: 'Renê: Dev Hours não deve ser acessível via sistema, só por link externo; Landing Pages e ' +
             'CMS/Site removidos da sidebar. Rotas continuam funcionando via hash direto, só não aparecem ' +
             'no nav. dev-hours-view.html continua público pra auditoria externa.',
    bucket: 'trivial',
    multiplierIds: [],
    profile: 'cleanup',
    aiAssistanceMultiplier: AI_ASSIST,
    hoursByCategory: { refinamento: 0.05, desenvolvimento: 0.1, testes: 0.05, documentacao: 0.05, implantacao: 0.05 },
    status: 'approved',
    module: 'system-wide',
  },
];

function computeHours(buckets, multIds, aiAssist) {
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  const mults = (multIds || []).map(id => ({
    investigation: 0.30, migration: 0.20, pdf: 0.15,
    integration: 0.20, security: 0.25, pure_refactor: -0.20,
  })[id] || 0).reduce((a, b) => a + b, 0);
  return total * (1 + mults) * aiAssist;
}

(async () => {
  for (const e of ENTRIES) {
    const exists = await db.collection(COLLECTION).where('releaseVersion','==',e.releaseVersion).limit(1).get();
    if (!exists.empty) { console.log(`= skip ${e.releaseVersion}`); continue; }
    const finalHours = computeHours(e.hoursByCategory, e.multiplierIds, e.aiAssistanceMultiplier);
    const doc = {
      entryType: 'release', ...e,
      hourlyRate: HOURLY_RATE,
      finalHours: Math.round(finalHours * 100) / 100,
      finalCost: Math.round(finalHours * HOURLY_RATE * 100) / 100,
      createdAt: FV.serverTimestamp(), createdBy: RENE_UID, updatedAt: FV.serverTimestamp(),
    };
    const ref = await db.collection(COLLECTION).add(doc);
    console.log(`+ ${e.releaseVersion} (${doc.finalHours}h R$${doc.finalCost}) → ${ref.id}`);
  }
  process.exit(0);
})();
