/**
 * Backfill dev_hours: v4.50.1 — complemento Banco de Roteiros.
 *
 * Sprint sequencial após v4.50.0. Demandas Renê:
 *   1. CRUD inline pra todo tipo de categoria/coleção
 *   2. Thumb auto banco_imagens → Unsplash
 *   3. Filtro por país (cascata continente)
 *   4. Dashboard de roteiros atualizado
 *   5. IA Hub registra movimentação + custo
 *
 * Idempotente.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const HOURLY_RATE = 150;
const AI_ASSIST   = 0.50;
const COLLECTION  = 'dev_hours';
const RENE_UID    = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.50.1',
  releaseSlug: '20260522-banco-crud-thumbs-pais-dashboard',
  title: 'Banco de Roteiros — complemento (CRUD coleções/categorias + thumbs auto + filtro país + dashboard + IA Hub logs)',
  summary: '5 demandas Renê pós-v4.50.0: (1) CRUD inline pra coleções E categorias do banco com modal genérico ' +
           '(builtin lock); (2) hero auto-resolve banco_imagens → Unsplash fallback (helper resolveBankHero + ' +
           'ensureBankHero, backfill rodado nos 2 PDFs seed); (3) filtro país cascata continente→país no banco; ' +
           '(4) roteiroDashboard com 2 blocos novos (Banco com 6 KPIs + IA com 6 KPIs custo R$ estimado); ' +
           '(5) ai_usage_logs em processRoteiroQueue + importRoteiroBankPdf (aparece no IA Hub auto). ' +
           'Collection nova: roteiro_bank_collections. Custo Sonnet 4.5 calculado: $3/M in + $15/M out + $0.30/M cache_read, FX R$5,20.',
  bucket: 'medium',
  multiplierIds: ['integration'],
  profile: 'feature',
  aiAssistanceMultiplier: AI_ASSIST,
  hoursByCategory: {
    refinamento: 0.4, desenvolvimento: 3.5, testes: 0.4, documentacao: 0.3, implantacao: 0.3,
  },
  status: 'approved',
  module: 'banco-roteiros',
};

function computeHours(buckets, multIds, aiAssist) {
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  const mults = (multIds || []).map(id => ({
    investigation: 0.30, migration: 0.20, pdf: 0.15,
    integration: 0.20, security: 0.25, pure_refactor: -0.20,
  })[id] || 0).reduce((a, b) => a + b, 0);
  return total * (1 + mults) * aiAssist;
}

(async () => {
  const exists = await db.collection(COLLECTION).where('releaseVersion','==',ENTRY.releaseVersion).limit(1).get();
  if (!exists.empty) {
    console.log(`= skip ${ENTRY.releaseVersion} (already exists ${exists.docs[0].id})`);
    process.exit(0);
  }
  const finalHours = computeHours(ENTRY.hoursByCategory, ENTRY.multiplierIds, ENTRY.aiAssistanceMultiplier);
  const doc = {
    entryType: 'release',
    ...ENTRY,
    hourlyRate: HOURLY_RATE,
    finalHours: Math.round(finalHours * 100) / 100,
    finalCost: Math.round(finalHours * HOURLY_RATE * 100) / 100,
    createdAt: FV.serverTimestamp(),
    createdBy: RENE_UID,
    updatedAt: FV.serverTimestamp(),
  };
  const ref = await db.collection(COLLECTION).add(doc);
  console.log(`+ added ${ENTRY.releaseVersion} (${doc.finalHours}h R$${doc.finalCost}) → ${ref.id}`);
  process.exit(0);
})();
