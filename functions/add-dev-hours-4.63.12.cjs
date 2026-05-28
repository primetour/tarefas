const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.63.12',
  releaseSlug: '20260528-post-audit-safetynet-zumbis',
  title: 'Post-audit Sprint v4.63 — safety-net UX + zumbis fáceis',
  summary: 'Pos-auditoria Sprint v4.63 (Agent retornou 30+ achados em zumbis/security/perf/bugs). ' +
           'Esta release ataca 3 HIGH UX/correctness + 1 zumbi MEDIUM latent. Bug #7/#8/#9 HIGH UX: ' +
           'fallback graceful nos generators era silencioso. Agora roteiroGenerator PDF/DOCX/PPTX e ' +
           'portalGenerator avisam via toast.warning + audit_logs templates.fallback. Bug #11 HIGH ' +
           'semantico: portalToTemplateData mapeava 1:1 cada {tip,dest} - 2 tips na mesma cidade ' +
           'viravam 2 destinos duplicados. Agora agrupa via Map por dest.id, N tips em 1 destino com ' +
           'tips[] array, segments mergeados. Zumbi #1 MEDIUM latent: portalAreas SUPPORTED_FMTS_TPL ' +
           'usava key roteiros mas TEMPLATE_MODULES.id e cotacoes (rename v4.62.50). audit.js add ' +
           'action templates.fallback. Nao atacado (v4.63.13+): Security SSRF, Perf indicators, ' +
           'Zumbi createNewVersion phantom.',
  bucket: 'small', multiplierIds: ['integration'], profile: 'bugfix',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 1.2, testes: 0.3, documentacao: 0.4, implantacao: 0.2 },
  module: 'portal', modules: ['portal', 'roteiros', 'banco-roteiros'],
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
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  process.exit(0);
})();
