const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.62.50',
    releaseSlug: '20260528-hotfix-auditlog-dup-decl',
    title: 'HOTFIX CRITICO auditLog duplicate declaration travava boot',
    summary: 'v4.62.47 adicionou import { auditLog } no topo de portal.js mas linha 1019 ja ' +
             'tinha stub const auditLog = ... no escopo de modulo. node --check passou (escopo ' +
             'permite shadowing) mas browser dispara SyntaxError Identifier already declared ' +
             'bloqueando boot inteiro do app — sem __PRIMETOUR_VERSION__, sem qualquer pagina. ' +
             'Descoberto via E2E Chrome MCP (CLAUDE.md §1 reforcada). Fix: removido stub. ' +
             'Licao: node --check + curl + deploy NAO sao suficientes. Chrome MCP + console ' +
             'reader filtro error|SyntaxError ANTES de declarar pronto.',
    bucket: 'trivial', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.2, testes: 0.2, documentacao: 0.1, implantacao: 0.1 },
    module: 'portal', modules: ['portal'],
  },
  {
    releaseVersion: '4.62.51',
    releaseSlug: '20260528-fix-zumbis-audit-banco-roteiros-template',
    title: 'Fix zumbis HIGH+MED auditoria final pos-sprint (4 zumbis)',
    summary: 'Auditoria final delegada via Agent encontrou 4 zumbis remanescentes pos sprint ' +
             'Templates de Areas. HIGH Zumbi #2 banco-roteiros.pdf nao usava seu proprio template: ' +
             'generateRoteiroBankPDF chamava generateRoteiroPDF(shape, area) que hardcodava ' +
             'resolveExportTemplate(area, roteiros, pdf). Template gravado em area.modules. ' +
             'banco-roteiros.exports.pdf era ignorado silenciosamente — PDF do Banco lia ' +
             'footer/header de Cotacoes. Fix: shape._exportModuleKey + 3 callsites do ' +
             'roteiroGenerator (PDF/DOCX/PPTX) leem roteiro._exportModuleKey || roteiros. ' +
             'Zumbis #1/#3/#4 formatos nao implementados aparecem na UI: portalAreas SUPPORTED_FMTS ' +
             'filtra accordions por modulo (portal=4, roteiros=3, banco-roteiros=1). Estado pos: ' +
             'ZERO zumbis. 100% paridade UI↔backend.',
    bucket: 'small', multiplierIds: ['investigation', 'integration'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.8, testes: 0.3, documentacao: 0.2, implantacao: 0.1 },
    module: 'portal', modules: ['portal', 'roteiros', 'banco-roteiros'],
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
    console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  }
  process.exit(0);
})();
