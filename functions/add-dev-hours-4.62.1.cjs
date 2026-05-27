const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.62.1',
  releaseSlug: '20260527-bank-triage-no-geo-bolsao-fix-modal',
  title: 'Banco — bolsão triagem geo (filosofia Envision raw → PRIMETOUR trata)',
  summary: 'Renê filosofia explícita: "envision é fonte da verdade dos roteiros, mas nosso sistema é ' +
           'responsável por tratar dados que não estão bacanas... casos sem âncora precisam de bolsão que ' +
           'a gente corrija". Implementado: pill especial "⚠ Sem âncora geo (N)" no Banco, applyFilters ' +
           'trata como filtro virtual qualidade, badge âmbar no card, botão 🌍 Corrigir geo (canEdit) que ' +
           'abre modal dedicado: país (datalist SSOT + validação live) + cidades (textarea 1/linha dedup) ' +
           '→ resolveCountry rejeita typo, findDestinationByLabel (alias-aware) reusa, OR ' +
           'createPendingDestination, popula geo completa. Validado E2E: corrigi Riyad (sem país Envision) ' +
           '→ atribuí Arábia Saudita → 2 destinations criados (Riyadh+Al Ula) → bolsão 52→51 automaticamente.',
  bucket: 'small',
  multiplierIds: ['integration'],
  profile: 'feature',
  hoursByCategory: { refinamento: 0.5, desenvolvimento: 2.5, testes: 0.5, documentacao: 0.5, implantacao: 0.2 },
  module: 'banco-roteiros',
  modules: ['banco-roteiros', 'portal'],
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
  const doc = { entryType: 'release', ...ENTRY, aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE, totalHours: Math.round(h * 100) / 100, totalCost: Math.round(h * HOURLY_RATE * 100) / 100, status: 'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now };
  const ref = await db.collection('dev_hours').add(doc);
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  process.exit(0);
})();
