const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.62.47',
    releaseSlug: '20260528-web-link-exports-audit-logs',
    title: 'Web link exports + audit logs (Fase E pos-audit pt 3/6)',
    summary: 'Encerra 14 caminhos zumbis pra exports. Ultimo era Web link: ' +
             'portalGenerator.generateWebLink persiste webExports.{footer,header} ' +
             'em portal_web_links/{token}. portal-view.html le no boot e renderiza ' +
             'headerText em faixa fixa topo + footerText sob logo footer. hideCover ' +
             'NO-OP pra Web. Bonus: audit logs em saveArea + deleteArea (severity ' +
             'critical) + saveBusinessUnit pra rastreabilidade de templates visuais.',
    bucket: 'small', multiplierIds: ['integration', 'security'], profile: 'feature',
    hoursByCategory: { refinamento: 0.2, desenvolvimento: 1.0, testes: 0.2, documentacao: 0.2, implantacao: 0.1 },
    module: 'portal', modules: ['portal', 'roteiros'],
  },
  {
    releaseVersion: '4.62.48',
    releaseSlug: '20260528-ux-exports-counter-copy-all-banco-override',
    title: 'UX Exports + buildModuleOverride banco-roteiros (Fase E pt 4/6)',
    summary: 'Polish UX da aba Exports: maxlength 300 footers / 200 headers + ' +
             'counter visual N/M (vermelho >90%). Botao "copiar pra todos formatos" ' +
             'que duplica footer/header em PDF+DOCX+PPTX+Web em 1 click (feedback ' +
             'inline). Esconde toggle hideCover em Web (NO-OP) + info explicativa. ' +
             'Extensao: buildModuleOverride aceita banco-roteiros (antes so portal ' +
             '+ roteiros recebiam override cor/fonte — banco-roteiros era zumbi).',
    bucket: 'small', multiplierIds: ['integration'], profile: 'feature',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.8, testes: 0.2, documentacao: 0.2, implantacao: 0.1 },
    module: 'portal', modules: ['portal', 'roteiros', 'banco-roteiros'],
  },
  {
    releaseVersion: '4.62.49',
    releaseSlug: '20260528-bu-sync-bidirectional-cotacoes-alias',
    title: 'BU<->Areas sync bidirectional + alias roteiros<->cotacoes (Fase E pt 5+6/6)',
    summary: 'Encerra sprint Templates de Areas (v4.62.39-49, 11 releases). ' +
             'BU<->Areas: saveArea (portal_areas) + saveBusinessUnit (business_units) ' +
             'agora escrevem em ambas as collections (mirror merge:true sem loop). ' +
             'resolveBU ja tinha fallback (v4.62.44). fetchAreas NAO muda (risco ' +
             'cross-page) — reader segue portal_areas fresh via mirror. Audit log ' +
             'marca mirroredBU:true. Alias roteiros<->cotacoes (Rene: cotacoes ' +
             'eh a nova nomenclatura): areaDefaults resolveAreaDefaults + ' +
             'resolveExportTemplate aceitam ambos keys, devHours MODULES.roteiros ' +
             'ganha aliases:[cotacoes], MODULE_MAP populate com alias, ' +
             'MODULE_PATTERNS regex aceita cotacao/cotacoes. IDs Firestore continuam ' +
             "'roteiros' (220+ docs preserve), UI exibe Cotacoes.",
    bucket: 'medium', multiplierIds: ['integration', 'migration'], profile: 'phase',
    hoursByCategory: { refinamento: 0.5, desenvolvimento: 2.0, testes: 0.5, documentacao: 0.5, implantacao: 0.2 },
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
