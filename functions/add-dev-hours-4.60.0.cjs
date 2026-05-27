/**
 * dev_hours v4.60.0 — cross-module SSOT: 228 destinos pending + UI revisão
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.60.0',
  releaseSlug: '20260526-cross-module-ssot-destinations-pending-review',
  title: 'Cross-module SSOT — popula 228 destinos pending do banco + UI revisão (resposta pergunta Renê)',
  summary: 'Pergunta Renê: "como ficaram os outros módulos com a reforma de continentes/países/cidades? ' +
           'e vc nao deveria atualizar destinos com todos os lugares que ja existem em banco?". ' +
           'Auditoria pré: backfill v4.59.2 adicionou countryCode (99-100% cobertura) MAS readers ' +
           'continuavam consumindo label string — sem ganho cross-module real. portal_destinations 57 ' +
           'cidades únicas; banco referencia 248 → 228 ÓRFÃS (cidade em roteiro mas sem doc canônico). ' +
           'Step 1: populate-pending-destinations-from-bank.cjs (idempotente, dry-run+apply) cria 228 ' +
           'docs com source="banco-auto", reviewStatus="pending", countryCode+continentCode ISO, ' +
           'sampleBankIds[] e refCount (rastreabilidade+priorização). 0 unresolved. portal_destinations ' +
           '61→289. Step 2: fetchDestinations aceita continentCode/countryCode (ISO) + reviewStatus filter ' +
           'opt-in (default all preserva picker editor de roteiros). Step 3: portalDestinations UI com ' +
           'pills Aprovados/Pendentes/Todos, banner "N pendentes", background âmbar + badge ⏳ Pendente ' +
           '(banco) nas linhas pending, botão ✓ Aprovar (flip reviewStatus preservando source histórico). ' +
           'Cobertura banco→destinos: 5% → ~95%. Outros módulos (portal_images, portal_tips) já estavam ' +
           '100% alinhados (0 órfãs) — curador cadastra dest antes de upload.',
  bucket: 'medium',
  multiplierIds: ['integration', 'migration'],
  profile: 'feature',
  hoursByCategory: { refinamento: 0.8, desenvolvimento: 3.0, testes: 0.5, documentacao: 0.7, implantacao: 0.3 },
  module: 'banco-roteiros',
  modules: ['banco-roteiros', 'portal', 'images'],
};

function computeHours(b, mids, ai) {
  const t = Object.values(b).reduce((a, x) => a + x, 0);
  const m = (mids || []).map(id => ({
    investigation: .3, migration: .2, pdf: .15, integration: .2,
    security: .25, pure_refactor: -.2,
  }[id] || 0)).reduce((a, x) => a + x, 0);
  return t * (1 + m) * ai;
}

(async () => {
  const ex = await db.collection('dev_hours')
    .where('releaseVersion', '==', ENTRY.releaseVersion).limit(1).get();
  if (!ex.empty) { console.log(`= skip ${ENTRY.releaseVersion} (já existe)`); process.exit(0); }
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
  process.exit(0);
})();
