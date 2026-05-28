const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.63.30',
  releaseSlug: '20260528-cotacoes-web-audit-hotfix',
  title: 'Audit hotfix HIGH + seed template Cotações Web Link',
  summary: 'Auditoria delegada (Agent paralelo) sobre sprint v4.63.28-29 Cotações Web Link ' +
           'encontrou 20 itens (5 HIGH security/runtime, 8 MED, 7 LOW). 6 fixes nesta release. ' +
           'HIGH SECURITY #1 firestore.rules roteiro_web_links checava roteiroId==roteiroId em ' +
           'schema novo que NÃO tem esse campo → undefined==undefined falha silenciosa em ' +
           'Firestore rules → anônimo legítimo recebia 403 incrementando viewCount. Fix: rule ' +
           'simplificada pra affectedKeys().hasOnly([viewCount,lastViewedAt]). Já deployed. ' +
           'HIGH SECURITY #2 stripInternalFields era denylist (delete custos+IA metadata). ' +
           'Schema livre + denylist = qualquer campo novo (obs_interna, comissao, meta_admin) ' +
           'vazaria automatic. Fix: refactor pra PUBLIC_FIELDS allowlist explícita (40+ campos). ' +
           'Schema futuro: campo novo é INTERNAL by default. ' +
           'HIGH BUG #3 migration on-read portalAreas.js linha 376 era shallow copy → mods.roteiros ' +
           'e mods.cotacoes compartilhavam ref → edits no form mutavam ambos → estado inconsistente. ' +
           'Fix: deep clone JSON.parse/stringify. ' +
           'HIGH SECURITY DRIFT #5 portalGenerator gravava webTemplate.fileUrl mas roteiroGenerator ' +
           'NÃO grava (lição §16). Inconsistência. Fix: portalGenerator remove fileUrl, ' +
           'portal-view-tpl.html linha 75 checa templateId em vez de fileUrl. Paridade simétrica. ' +
           'MED PII LEAK #6 title fallback usava cliente.nome → vazava em document.title ' +
           '(browser tab) + slug + OG meta. Fix: fallback genérico "Cotação PRIMETOUR". ' +
           'MED AUDIT #12 generateRoteiroWebLink não logava criação. Fix: auditLog fire-and-forget ' +
           'cotacoes.web.generated com roteiroId, areaId, hasTemplate, templateId, clientName. ' +
           'MED PARIDADE #13 Cotação save NÃO incluía fonts/editorial/modules (Portal incluía). ' +
           'Fix: setDoc Cotação inclui esses 3 campos pra designer customizar dinamicamente. ' +
           'SEED template default Cotações Web Link entregue (cotacoes-web-default-html.html ' +
           '9.4KB Handlebars). Estrutura: hero cliente+período, dia a dia, aéreo, hospedagem, ' +
           'inclusos, pricing gradiente primary→gold. JS hooks onDiaClick/onHotelClick. ' +
           'Mobile responsive @640px. OG meta. Template ID rGGsJWE0XPdm7nIuWibz global default ' +
           'isDefault=true ownerType=global module=cotacoes format=web templateMode=full. ' +
           'E2E real Chrome MCP validado: roteiro-view-tpl.html#{token} renderizou cotação Paris ' +
           'João e Maria Silva 10 noites com hero+resumo+3 dias+2 voos AF+Le Bristol 5★+ ' +
           'footer "PRIMETOUR Lazer". Backlog: lock list explícita roteiro_web_links espelhando ' +
           'portal_web_links (#1.b), drift views vs viewCount cosmético (#4), previewLink CF pra ' +
           'Cotação OG rica (#8), modo slots redirect quebrado em Cotação (#18).',
  bucket: 'medium', multiplierIds: ['security', 'investigation'], profile: 'bugfix',
  hoursByCategory: { refinamento: 1.0, desenvolvimento: 2.5, testes: 1.5, documentacao: 0.8, implantacao: 0.5 },
  module: 'cotacoes', modules: ['cotacoes', 'templates', 'portal'],
};

function computeHours(b, mids, ai) {
  const t = Object.values(b).reduce((a, x) => a + x, 0);
  const m = (mids || []).map(id => ({ investigation: .3, migration: .2, pdf: .15, integration: .2, security: .25, pure_refactor: -.2 }[id] || 0)).reduce((a, x) => a + x, 0);
  return t * (1 + m) * ai;
}

(async () => {
  const ex = await db.collection('dev_hours').where('releaseVersion', '==', ENTRY.releaseVersion).limit(1).get();
  if (!ex.empty) { console.log('= skip'); process.exit(0); }
  const h = computeHours(ENTRY.hoursByCategory, ENTRY.multiplierIds, AI_ASSIST);
  const now = FV.serverTimestamp();
  const doc = { entryType: 'release', ...ENTRY, aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE,
    totalHours: Math.round(h * 100) / 100, totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
    status: 'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now };
  const ref = await db.collection('dev_hours').add(doc);
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  process.exit(0);
})();
