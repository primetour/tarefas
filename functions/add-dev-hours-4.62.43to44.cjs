const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.62.43',
    releaseSlug: '20260528-areas-templates-fase-e-ui-exports-tab',
    title: 'Templates Areas: Fase E (UI Exports tab + plug PDF roteiro)',
    summary: 'Fase E do plano de Templates de Areas. E.1 schema: areaDefaults.js ganha DEFAULT_EXPORTS ' +
             'por formato (pdf/docx/pptx/web) com {footerText, headerText, hideCover}. Helpers ' +
             'resolveExportTemplate(area,moduleKey,format) + formatExportText(text, ctx) com ' +
             'placeholders {areaName}/{today}/{clientName}/{title}. E.2 UI: nova aba "Exports" em ' +
             'portalAreas com 3 sub-tabs (Portal de Dicas / Roteiros / Banco de Roteiros) × 4 ' +
             'formatos (PDF/DOCX/PPTX/Web) em <details> collapse, badge "customizado" quando ha ' +
             'valores, sub-tab switcher separado pra nao conflitar com tab principal, collectExports ' +
             'coleta so campos nao-vazios (schema enxuto). Persiste via modules[modKey].exports.fmt. ' +
             'E.3 plug PDF roteiro: addFooter ganha customFooterText, generateRoteiroPDF resolve ' +
             'template + formatExportText e passa pra todos os footers. Banco de Roteiros herda ' +
             'auto (reusa generateRoteiroPDF). PORTAL_GENERATOR + DOCX/PPTX/Web footer ficam pra ' +
             'polish proxima release (TODO no codigo).',
    bucket: 'medium', multiplierIds: ['integration'], profile: 'feature',
    hoursByCategory: { refinamento: 0.5, desenvolvimento: 2.5, testes: 0.5, documentacao: 0.5, implantacao: 0.2 },
    module: 'portal', modules: ['portal', 'roteiros'],
  },
  {
    releaseVersion: '4.62.44',
    releaseSlug: '20260528-areas-templates-fase-f-business-units-foundation',
    title: 'Templates Areas: Fase F (business_units SSOT foundation)',
    summary: 'Fase F do plano — resolve D8 da auditoria (3 listas paralelas: portal_areas, sectors, ' +
             'REQUESTING_AREAS). F.1: js/services/businessUnits.js — nova collection business_units ' +
             'como SSOT unificado de BUs. Schema engloba marca + interno + solicitante via campo ' +
             'usedFor:[portal,roteiros,requests]. Helpers resolveBU(id) com FALLBACK pra portal_areas ' +
             '(compat 100% — callers legados continuam funcionando), saveBusinessUnit, ' +
             'fetchBusinessUnits, resolveBUTemplate. Cache 60s. F.2: backfill-business-units.cjs ' +
             'dry-run + apply, idempotente (skip se existe BU com legacyPortalAreaId), usa mesmo id ' +
             'da portal_area, marca migratedFrom/At + legacyIds, usedFor default [portal,roteiros]. ' +
             'APLICADO em PROD: 7 portal_areas migradas (BTG Partners, BTG Ultrablue, Centurion, ' +
             'ATravel, Lazer, Operadora, PTS Bradesco). firestore.rules: business_units herda regras ' +
             'de portal_areas (read=auth, write=admin), deployed. Callers NAO migrados nesta release ' +
             '— preserva compat 100%. Migracao gradual nas proximas releases.',
    bucket: 'medium', multiplierIds: ['investigation', 'migration'], profile: 'phase',
    hoursByCategory: { refinamento: 0.6, desenvolvimento: 2.0, testes: 0.4, documentacao: 0.7, implantacao: 0.3 },
    module: 'portal', modules: ['portal', 'roteiros', 'requests'],
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
    console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  }
  process.exit(0);
})();
