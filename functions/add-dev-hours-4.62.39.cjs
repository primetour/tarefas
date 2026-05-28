const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.62.39',
  releaseSlug: '20260528-areas-templates-fase-a-ssot-defaults',
  title: 'Templates de Areas: Fase A (fix D1+D6 + SSOT defaults)',
  summary: 'Rene quer "transparencia e camada de gestao saindo do codigo e indo pro front end" pra ' +
           'templates de exports por area e por modulo. Auditoria via Agent achou 13 gaps. Esta fase ' +
           '(A) ataca FOUNDATION. GAP D1 (CRITICO): UI fake — fonts/editorial salvas em portal_areas ' +
           'mas generator do Portal de Dicas web link omitia no setDoc, portal-view.html lia null, ' +
           'caia em Poppins default. Fix: persistir fonts/editorial/modules no portal_web_links ' +
           '(espelha pattern roteiros.js:855 que ja funciona). GAP D6 (CRITICO): defaults invertidos ' +
           'no DOCX do roteiroGenerator (primary=0F172A/secondary=475569) vs PDF/PPTX (primary=475569/ ' +
           'secondary=0F172A). Drift silencioso — DOCX saia com cores trocadas quando area nao ' +
           'definida. SSOT areaDefaults.js (resolve E1/E2/E4): unica fonte de defaults pra colors/ ' +
           'fonts/editorial/brand. Helpers resolveAreaDefaults(area,moduleKey) + ' +
           'resolveExternalBrandName(area). Eliminados 60+ literais Poppins/hex de portalGenerator + ' +
           'roteiroGenerator (PDF/PPTX/DOCX). areaTokens.js + portalTokens.js viram re-export de SSOT ' +
           '(compat 100% preservada). BONUS Fase B (D7) antecipado: brand.useExternalName toggle ' +
           'implementado no schema/helper, generators ja respeitam (UI/backfill ficam pra v4.62.40).',
  bucket: 'small', multiplierIds: ['investigation', 'pure_refactor'], profile: 'bugfix',
  hoursByCategory: { refinamento: 0.4, desenvolvimento: 1.2, testes: 0.3, documentacao: 0.4, implantacao: 0.1 },
  module: 'portal', modules: ['portal', 'roteiros'],
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
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  process.exit(0);
})();
