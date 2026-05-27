const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.61.1',
  releaseSlug: '20260526-destinations-country-datalist-ssot-validation',
  title: 'Destinos — input país vira datalist SSOT + validação + auto-fill continente (pergunta Renê)',
  summary: 'Renê: "deveria vir lista de paises + busca, assim nao permite escrever errado". Antes: input ' +
           'text livre permitia "Frnaça"/"France"/typos → grava silencioso → quebra SSOT. Agora: HTML5 ' +
           'datalist nativo com 196 países SSOT (pt canônico + en + aliases visíveis). Browser handle ' +
           'busca+dropdown. 3 camadas validação: (1) live com feedback ✓/⚠ verde/vermelho + border ' +
           'colorida; (2) bloqueante no save com resolveCountry; (3) auto-normalize "Brazil"→"Brasil". ' +
           'Auto-fill continente ao escolher país (se vazio). Impossível gravar país inválido via UI.',
  bucket: 'trivial',
  multiplierIds: ['security'],
  profile: 'feature',
  hoursByCategory: { refinamento: 0.2, desenvolvimento: 1.0, testes: 0.2, documentacao: 0.2, implantacao: 0.1 },
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
