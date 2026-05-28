const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.63.23',
    releaseSlug: '20260528-web-template-runtime',
    title: 'Web Link runtime — portal-view-tpl.html + seed template HTML',
    summary: 'Foundation 2/3 da feature Web Link. NEW portal-view-tpl.html ~150 LOC: lê token de ' +
             'hash/?t=, fetch portal_web_links/{token}, checa webTemplate metadata, redirect ' +
             'canônico se ausente, mode slots redireciona portal-view.html?slots=1, mode full ' +
             'carrega Handlebars CDN renderiza e document.open/write/close. Setup window.PRIMETOUR ' +
             'JS hooks noop default. NEW templates/seeds/portal-web-default-html.html ~280 LOC: ' +
             'cards responsivos por destino + hero + cidade + país + tips count, header sticky ' +
             'brand, footer com créditos, OG meta dinâmico, JS hook onclick cards, mobile resp. ' +
             'NEW functions/seed-portal-web-default-template.cjs cria template Mavn... (mode full). ' +
             'NEW functions/smoke-attribute-web-template.cjs atribui pra Lazer.templateRefs.portal.' +
             'web e cria portal_web_links smoke-web-... pra E2E.',
    bucket: 'medium', multiplierIds: ['integration', 'security'], profile: 'feature',
    hoursByCategory: { refinamento: 0.5, desenvolvimento: 3.2, testes: 0.6, documentacao: 0.4, implantacao: 0.3 },
    module: 'templates', modules: ['templates', 'portal'],
  },
  {
    releaseVersion: '4.63.24',
    releaseSlug: '20260528-web-template-cors-proxy',
    title: 'Hotfix CORS R2 — CF getTemplateHtml proxy',
    summary: 'Hotfix do runtime Web Link (v4.63.23). E2E real pegou bloqueio CORS no último 1%: ' +
             'bucket pub-r2.dev NÃO envia Access-Control-Allow-Origin header, browser bloqueou ' +
             'fetch direto portal-view-tpl.html linha 91 com TypeError Failed to fetch, fallback ' +
             'redirecionava canônico — visualmente parecia template não atribuído. FIX nova CF ' +
             'getTemplateHtml (onRequest us-central1 256MiB 10s timeout cors:true). GET ?tplId=XXX ' +
             'valida regex [a-zA-Z0-9_-]+, busca templates/{tplId}, exige status=active, re-valida ' +
             '_validateR2FileUrl (anti-SSRF), fetch R2 server-side, retorna HTML com Allow-Origin * ' +
             'e Cache-Control max-age 300 CDN. portal-view-tpl.html linhas 89-95 substituídas. ' +
             'Por que CF e não habilitar CORS no R2: bucket pub r2.dev é dev/preview Cloudflare ' +
             'não permite configurar headers, worker exigia X-Upload-Token (não pode ir client). ' +
             'CF re-valida tplId/status, evita fetch arbitrário, mantém cache CDN. E2E validado: ' +
             'curl Origin GH Pages → 200, ACAO *, content-type text/html; Chrome MCP 3 destinos ' +
             'rendered Galápagos/Ushuaia/Destino + header Lazer City Guides + footer correct.',
    bucket: 'small', multiplierIds: ['security'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.6, testes: 0.4, documentacao: 0.3, implantacao: 0.2 },
    module: 'templates', modules: ['templates', 'portal'],
  },
];

function computeHours(b, mids, ai) {
  const t = Object.values(b).reduce((a, x) => a + x, 0);
  const m = (mids || []).map(id => ({ investigation: .3, migration: .2, pdf: .15, integration: .2, security: .25, pure_refactor: -.2 }[id] || 0)).reduce((a, x) => a + x, 0);
  return t * (1 + m) * ai;
}

(async () => {
  for (const E of ENTRIES) {
    const ex = await db.collection('dev_hours').where('releaseVersion', '==', E.releaseVersion).limit(1).get();
    if (!ex.empty) { console.log(`= skip ${E.releaseVersion}`); continue; }
    const h = computeHours(E.hoursByCategory, E.multiplierIds, AI_ASSIST);
    const now = FV.serverTimestamp();
    const doc = { entryType: 'release', ...E, aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE,
      totalHours: Math.round(h * 100) / 100, totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
      status: 'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now };
    const ref = await db.collection('dev_hours').add(doc);
    console.log(`+ ${E.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  }
  process.exit(0);
})();
