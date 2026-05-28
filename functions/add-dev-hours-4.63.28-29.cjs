const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.63.28',
    releaseSlug: '20260528-areas-exports-rename-cotacoes',
    title: 'Rename UI tab Exports + Por módulo: Roteiros → Cotações',
    summary: 'Fecha drift identificado pelo Renê na auditoria Chrome MCP: tab Exports ' +
             'ainda mostrava labels "Roteiros" + IDs area-exp-roteiros-* mesmo após rename ' +
             'canônico v4.62.50. UI ficou drift do schema canônico cotacoes. ' +
             'portalAreas.js mudanças: SUPPORTED_FMTS.roteiros → cotacoes (com 3 fmts ' +
             'temporariamente — web vem em v4.63.29). Migration on-read mods.roteiros → ' +
             'mods.cotacoes pra modal pre-carregar valores legacy. Labels e IDs UI todos ' +
             'rename: sub-tab "✈ Cotações" + area-exp-cotacoes-* + moduleOverrideBlock + ' +
             'exportsModuleBlock todos com key=cotacoes. Save grava SÓ cotacoes (chave ' +
             'canônica). Cleanup legacy via shallow merge do setDoc (modules.roteiros some ' +
             'após próximo save). Reader em areaDefaults.js:122 alias bidirectional desde ' +
             'v4.62.49 — backward compat 100%. E2E Chrome MCP validou: sub-tab "✈ Cotações" ' +
             'visível, 3 textareas area-exp-cotacoes-{pdf,docx,pptx}, zero leftover roteiros.',
    bucket: 'small', multiplierIds: ['pure_refactor'], profile: 'feature',
    hoursByCategory: { refinamento: 0.4, desenvolvimento: 0.8, testes: 0.5, documentacao: 0.2, implantacao: 0.2 },
    module: 'cotacoes', modules: ['cotacoes', 'portal'],
  },
  {
    releaseVersion: '4.63.29',
    releaseSlug: '20260528-cotacoes-web-link-runtime',
    title: 'Web Link runtime end-to-end para Cotações (paridade 100% Portal)',
    summary: 'Resposta ao Renê: "pq nao tem web link pra cotacao?" Implementação completa do ' +
             'caminho que faltava. Cotações agora exporta 4 formatos (PDF/DOCX/PPTX/Web) com ' +
             'paridade total ao Portal de Dicas. ' +
             'generateRoteiroWebLink() implementado em roteiroGenerator.js (espelha portal' +
             'Generator.generateWebLink): cria doc roteiro_web_links/{token}, shape ' +
             '{data, area, webTemplate, webExports} compatível com roteiro-view.html legacy. ' +
             'case "web" no generateRoteiro habilitado (antes throw "em desenvolvimento ' +
             'Sprint 5 Phase 4"). Token slug client-yyyy-mm-randHex. Lookup area.templateRefs ' +
             'com alias cotacoes→roteiros pra retrocompat. NÃO grava fileUrl em webTemplate ' +
             '(lição §16: anônimo não pode editar fileUrl via Firestore — CF getTemplateHtml ' +
             'busca via templateId). ' +
             'portalAreas.js: SUPPORTED_FMTS.cotacoes ganha "web" (4 formatos). SUPPORTED_FMTS_TPL.' +
             'cotacoes "web" re-habilitado (desabilitei v4.63.25). ' +
             'roteiro-view-tpl.html NOVO 9KB: template runtime análogo a portal-view-tpl.html. ' +
             'Lê roteiro_web_links, busca template via CF getTemplateHtml (reuso da mesma CF ' +
             'do Portal), renderiza Handlebars. Shape adaptado pra Cotação: cliente, viagem, ' +
             'dias[], hoteis[], voos[], services, pricing, includes. JS hooks Cotação: ' +
             'onDiaClick, onHotelClick, onPriceClick (vs Portal: destino/segment/map). Fallback ' +
             'graceful pra roteiro-view.html canônico. ' +
             'Firestore rules: roteiro_web_links já tinha lock list affectedKeys().hasOnly([' +
             'viewCount, lastViewedAt]) — lição §16.j aplicada desde antes. Sem mudança necessária. ' +
             'Validado via curl: roteiro-view-tpl.html publicado (HTTP 200), generateRoteiroWebLink ' +
             'presente em JS deployed. E2E real pendente (sessão Chrome MCP expirou). ' +
             'Backlog: seed template default Cotações Web Link, E2E real fim-a-fim com Renê logado.',
    bucket: 'medium', multiplierIds: ['integration'], profile: 'feature',
    hoursByCategory: { refinamento: 0.6, desenvolvimento: 3.5, testes: 0.6, documentacao: 0.6, implantacao: 0.3 },
    module: 'cotacoes', modules: ['cotacoes', 'templates'],
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
