/**
 * Backfill dev_hours: v4.50.5 → v4.50.10 (hotfixes + UX do Banco de Roteiros)
 *
 * Todas entries marcadas com modules: ['banco-roteiros'] pra entrarem na
 * aba "Foco em Produto" do dev-hours-view automaticamente (sem heurística).
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
    releaseVersion: '4.50.5',
    releaseSlug: '20260523-fix-autotable-guard',
    title: 'Hotfix Banco PDF — guard granular autoTable em loadJsPDF',
    summary: 'Bug: doc.autoTable is not a function quando pdfKit.js (dashboard) já tinha ' +
             'carregado jspdf SEM o plugin autoTable. Fix: guard granular jspdf E autoTable separados.',
    bucket: 'trivial', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.2, testes: 0.15, documentacao: 0.05, implantacao: 0.05 },
  },
  {
    releaseVersion: '4.50.6',
    releaseSlug: '20260523-fix-autotable-polling',
    title: 'Hotfix Banco PDF — polling defensivo pós script.onload',
    summary: 'Após v4.50.5, erro persistia: script.onload disparava mas autoTable ainda não anexou ' +
             'ao prototype (race condition). Fix: polling 50ms × até 2s verificando jsPDF.API.autoTable.',
    bucket: 'trivial', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.15, desenvolvimento: 0.25, testes: 0.2, documentacao: 0.05, implantacao: 0.05 },
  },
  {
    releaseVersion: '4.50.7',
    releaseSlug: '20260523-banco-card-datas',
    title: 'Card banco — bloco meta com criação + validade (fallback "Indefinida")',
    summary: '1ª versão: createdAt + validity.endDate. Renê reclamou (corrigido em v4.50.8).',
    bucket: 'trivial', multiplierIds: [], profile: 'feature',
    hoursByCategory: { refinamento: 0.05, desenvolvimento: 0.2, testes: 0.05, documentacao: 0.0, implantacao: 0.05 },
  },
  {
    releaseVersion: '4.50.8',
    releaseSlug: '20260523-banco-card-validade-correta',
    title: 'Card banco — corrigido pra validity.startDate + validity.endDate (não createdAt)',
    summary: 'Renê: campos do schema validity são definidos pelo curador, semântica comercial. ' +
             'createdAt do doc era irrelevante (semântica de sistema). Trocado.',
    bucket: 'trivial', multiplierIds: [], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.05, desenvolvimento: 0.1, testes: 0.05, documentacao: 0.0, implantacao: 0.05 },
  },
  {
    releaseVersion: '4.50.9',
    releaseSlug: '20260523-fix-timezone-iso-date',
    title: 'Hotfix card banco — timezone YYYY-MM-DD voltava 1 dia em UTC-3',
    summary: 'Renê: "coloquei 01/01/2020 e sistema deixou 31/12/2019". Bug clássico: ' +
             'new Date("2020-01-01") é UTC midnight, em UTC-3 renderiza 21h do dia anterior. ' +
             'Fix: regex YYYY-MM-DD → reconstrói "DD/MM/YYYY" sem passar por Date(). ' +
             'Lição registrada em CLAUDE.md §12.a.',
    bucket: 'trivial', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.15, testes: 0.1, documentacao: 0.1, implantacao: 0.05 },
  },
  {
    releaseVersion: '4.50.10',
    releaseSlug: '20260523-fix-double-toast-listeners',
    title: 'Hotfix Banco — duplo toast por listeners empilhados (AbortController por render)',
    summary: 'Renê: "aperto salvar e aparece 2 banners de sucesso". Causa: cada navegação ao banco ' +
             'adicionava +1 listener delegado no container; innerHTML= não remove listeners do pai. ' +
             'Fix: AbortController por render() + signal em todos addEventListener. ' +
             'Removido também toast.info("Gerando PDF…") que sobrepunha ao toast.success final ' +
             '(usa botão disable+spinner inline agora). Lições registradas em CLAUDE.md §12.k+l.',
    bucket: 'small', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.5, testes: 0.2, documentacao: 0.2, implantacao: 0.05 },
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
    const finalHours = computeHours(e.hoursByCategory, e.multiplierIds, AI_ASSIST);
    const doc = {
      entryType: 'release',
      ...e,
      aiAssistanceMultiplier: AI_ASSIST,
      hourlyRate: HOURLY_RATE,
      finalHours: Math.round(finalHours * 100) / 100,
      finalCost: Math.round(finalHours * HOURLY_RATE * 100) / 100,
      status: 'approved',
      // module (singular) pra compat com queries antigas + modules (array) pro filtro novo
      module: 'banco-roteiros',
      modules: ['banco-roteiros'],
      createdAt: FV.serverTimestamp(), createdBy: RENE_UID, updatedAt: FV.serverTimestamp(),
    };
    const ref = await db.collection(COLLECTION).add(doc);
    console.log(`+ ${e.releaseVersion} (${doc.finalHours}h R$${doc.finalCost}) → ${ref.id}`);
  }
  process.exit(0);
})();
