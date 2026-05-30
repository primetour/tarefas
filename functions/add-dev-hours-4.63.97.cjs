const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.63.97',
    releaseSlug: '20260530-cotacoes-capa-linha-logo',
    title: 'Fix visual: linha do frame decorativo cortando o logo BTG na capa/contracapa do PDF de cotação',
    summary: 'Renê reportou "existe uma linha meio do lado" na capa e contracapa do PDF de cotação. ' +
             'Causa raiz: no template HTML (renderizado via Puppeteer/Chromium na CF renderTemplateFile), ' +
             'as linhas-topo do frame decorativo ficavam em cima dos logos — capa .cover-line-top em top:40mm ' +
             'cortava o logo BTG (imagem começa ~34mm, layout top-anchored); contracapa .closing-line-top em ' +
             'top:110mm cortava o logo centralizado (~102-140mm). Fix: subir cada linha-topo pra acima do logo ' +
             '(capa 40mm→24mm, contracapa 110mm→88mm), mantendo as linhas-base (257mm/187mm). Template re-seedado ' +
             'no R2 (novo templateId ativo/default, antigo arquivado). Validação: diagnose via render 150dpi + ' +
             'pixel math; correção confirmada por render real da CF (Skia/PDF m149, 14MB, 35 páginas) com inspeção ' +
             'a 150dpi da pg1 (capa) e pg35 (contracapa) — ambos limpos, nenhuma linha cruza o logo. Resolvido o ' +
             'stale-cache do _defaultCotacoesTplCache (SPA hash-route não reseta state de módulo; só full reload).',
    bucket: 'trivial', multiplierIds: ['pdf', 'investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.15, testes: 0.25, documentacao: 0.05, implantacao: 0.1 },
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
