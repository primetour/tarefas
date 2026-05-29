const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.63.82',
    releaseSlug: '20260529-cotacoes-html-template-overflow-fix',
    title: 'Fix export PDF via template Default HTML: capa e fechamento cortados (transbordo)',
    summary: 'Bug do Renê no E2E de export via template HTML: "capa e pág 2 com problema (fica ' +
             'cortado), o mesmo na 18 e 19". Caminho DIFERENTE dos fixes v4.63.79-81 (jsPDF) — é o ' +
             'template HTML renderizado por Puppeteer na CF. Causa raiz: a CF renderiza todos os ' +
             'templates com page.pdf A4 + margem 20/15mm (index.js:1130) = caixa de conteúdo 180×257mm, ' +
             'mas .cover e .closing do template estavam hardcoded 210×297mm (A4 cheia) → capa vazava ' +
             '~40mm pra pág 2, fechamento vazava pra pág seguinte. Além disso CSS running elements ' +
             '(position:running(footer) + @page @bottom-center) que Chromium NÃO suporta → .footer-area ' +
             'caía pra static e renderizava solto no topo da pág 1. Fix template/CSS apenas (não toca a ' +
             'margem compartilhada da CF): width 210mm→100%, height 297mm→256mm em .cover/.closing, ' +
             'paddings/linhas/logo recalculados; removido CSS+blocos mortos de running elements; footer ' +
             'movido pra dentro de .closing como .closing-footer-note. Validação: render local ' +
             'determinístico (puppeteer-core + Chrome for Testing) replicando page.pdf EXATO da CF; PDF ' +
             '10 páginas; rasterização confirmou capa/pág2/fechamento sem corte. Template re-seedado ' +
             'pro R2 + Firestore (doc RPt8FtHG8bPwPsmWWUpL, antigo arquivado).',
    bucket: 'trivial', multiplierIds: ['investigation', 'pdf'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.25, testes: 0.2, documentacao: 0.05, implantacao: 0.1 },
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
