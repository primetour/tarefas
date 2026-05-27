/**
 * dev_hours v4.59.0 + v4.59.1 — Sprint Geographic SSOT + Banco audit fixes
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.59.0',
    releaseSlug: '20260526-geography-ssot-foundation',
    title: 'Sprint Geography SSOT — foundation (continents+countries hardcoded, geoResolver, backfill cross-modules)',
    summary: 'Criou Single Source of Truth geográfico hardcoded em js/data/{continents,countries}.js ' +
             '(7 continents + 196 ISO 3166-1 alpha-2 + 4 UK constituents + aliases). Helper centralizado ' +
             'js/services/geoResolver.js com resolveCountry, findDestinationByLabel, createPendingDestination ' +
             '+ batchResolveDestinations. Schema extension não-destrutivo em portal_destinations (+countryCode, ' +
             'continentCode, source, reviewStatus, cityAliases, envisionLocationId), roteiros_bank (+geo.' +
             'countryCodes/continentCodes), portal_images/tips (+countryCode/continentCode). saveDestination ' +
             'auto-resolve códigos. envisionAdapter.deriveGeo() popula códigos ISO automaticamente. Backfill ' +
             'cross-modules (functions/backfill-geo-codes.cjs --apply): 61/61 destinations, 236/236 roteiros, ' +
             '190/192 images, 9/9 tips. Audit (functions/audit-geography-ssot.cjs) confirma 100% match. ' +
             'Foundations isoladas — só são importadas em adapter e (fallback) saveDestination. Risco zero ' +
             'pra outros módulos: apenas ADIÇÃO de campos. E2E validado via Chrome MCP: 0 erros console, ' +
             'cross-module funcional.',
    bucket: 'small',
    multiplierIds: ['integration', 'migration'],
    profile: 'phase',
    hoursByCategory: { refinamento: 1.5, desenvolvimento: 3.0, testes: 0.8, documentacao: 1.2, implantacao: 0.3 },
    module: 'banco-roteiros',
    modules: ['banco-roteiros', 'portal', 'images', 'infra'],
  },
  {
    releaseVersion: '4.59.1',
    releaseSlug: '20260526-banco-audit-fixes-envision-help',
    title: 'Banco de Roteiros — audit fixes 5 críticos + UI Envision sync help',
    summary: 'Primeira rodada de fixes da auditoria Banco (5 CRÍTICOS + 8 médios identificados): ' +
             '(1) limpa código morto filtro continente pós v4.58.2; (2) FK cleanup em deleteRoteiroBank ' +
             'aplicando CLAUDE.md §13.a (notifications/ai_usage_logs/tasks com writeBatch isolado); ' +
             '(5) hero auto-resolve PARALELO via Promise.allSettled batch 5 — antes loop sequencial ' +
             'travava 5+min em 50 docs, agora 5-10s; (+sort dropdown 4 modos + filtro coleção). Audit §7.8: ' +
             'duplicateRoteiroBank zera envision.id pra evitar 2 docs apontando mesma itinerary. UI: ' +
             'botão "Como atualizar via Envision" no header banco abre modal com 4 passos + link guia ' +
             'completo. Doc nova: docs/ENVISION-SYNC-GUIDE.md (~300 linhas) — procedimento operacional ' +
             'permanente, troubleshooting, arquitetura, roadmap, comandos copy-paste.',
    bucket: 'small',
    multiplierIds: ['integration'],
    profile: 'bugfix',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 1.8, testes: 0.4, documentacao: 0.8, implantacao: 0.2 },
    module: 'banco-roteiros',
    modules: ['banco-roteiros'],
  },
];

function computeHours(b, mids, ai) {
  const t = Object.values(b).reduce((a, x) => a + x, 0);
  const m = (mids || []).map(id => ({
    investigation: .3, migration: .2, pdf: .15, integration: .2,
    security: .25, pure_refactor: -.2,
  }[id] || 0)).reduce((a, x) => a + x, 0);
  return t * (1 + m) * ai;
}

(async () => {
  for (const ENTRY of ENTRIES) {
    const ex = await db.collection('dev_hours')
      .where('releaseVersion', '==', ENTRY.releaseVersion).limit(1).get();
    if (!ex.empty) { console.log(`= skip ${ENTRY.releaseVersion} (já existe)`); continue; }
    const h = computeHours(ENTRY.hoursByCategory, ENTRY.multiplierIds, AI_ASSIST);
    const now = FV.serverTimestamp();
    const doc = {
      entryType: 'release', ...ENTRY,
      aiAssistanceMultiplier: AI_ASSIST,
      hourlyRate: HOURLY_RATE,
      totalHours: Math.round(h * 100) / 100,
      totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
      status: 'approved',
      completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now,
    };
    const ref = await db.collection('dev_hours').add(doc);
    console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  }
  process.exit(0);
})();
