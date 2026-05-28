const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.63.6',
    releaseSlug: '20260528-templates-render-html-to-pdf',
    title: 'Render engine HTML→PDF Puppeteer (sprint 7/11)',
    summary: 'Pipeline ponta-a-ponta funcional pra HTML. CF renderTemplate (1GB, 90s, max 5): ' +
             'valida templateId + status, baixa template R2, compila Handlebars + interpola data, ' +
             'lanca Chromium serverless via @sparticuz/chromium + puppeteer-core, page.pdf A4 margens ' +
             '+ printBackground, audit templates.render, warn >9MB callable limit. js/services/' +
             'templates.js: renderTemplate(id, data) Blob, downloadBlob helper. UI: botao Testar PDF ' +
             'em cards HTML ativos, modal com JSON textarea pre-preenchido por modulo (cotacoes/' +
             'portal/banco-roteiros), sample data, status inline cold start ~5s, reporta ms + KB. ' +
             'Deps novas: puppeteer-core, @sparticuz/chromium, handlebars.',
    bucket: 'medium', multiplierIds: ['integration', 'pdf'], profile: 'feature',
    hoursByCategory: { refinamento: 0.5, desenvolvimento: 3.0, testes: 0.5, documentacao: 0.4, implantacao: 0.4 },
    module: 'portal', modules: ['portal', 'roteiros', 'banco-roteiros'],
  },
  {
    releaseVersion: '4.63.7',
    releaseSlug: '20260528-templates-hotfix-puppeteer-buffer',
    title: 'HOTFIX Puppeteer 25+ Uint8Array → Buffer pra base64',
    summary: 'Bug descoberto em E2E imediato pos v4.63.6: puppeteer-core@25+ retorna Uint8Array ' +
             '(nao Buffer) de page.pdf(). .toString(base64) em Uint8Array retornava CSV de decimais ' +
             '37,80,68,70 (bytes ASCII de PDF) em vez de base64 real JVBERi0xLj. Cliente atob() ' +
             'quebrava com InvalidCharacterError. Fix 1 linha: pdfBuf = Buffer.from(pdfBuf). ' +
             'E2E pos-fix validado: base64 valido, decoded com header %PDF-1.4, cold start ~10s, ' +
             'warm ~2.6s, PDF 27.4KB renderizado e disparado download via downloadBlob, template ' +
             'com 12 placeholders interpolou com dados corretos. Licao CLAUDE.md §12.b: API change ' +
             'em libs precisa validar SHAPE do retorno (Buffer.from cover) nao so funcionalidade.',
    bucket: 'trivial', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.2, testes: 0.2, documentacao: 0.1, implantacao: 0.1 },
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
