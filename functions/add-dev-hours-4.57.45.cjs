/**
 * dev_hours v4.57.45 — Banco de Imagens 2/5: storage rollback + edit conflict
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.57.45',
  releaseSlug: '20260525-banco-imagens-storage-rollback-conflict-detection',
  title: 'Banco de Imagens — sprint 2/5: storage rollback (I6) + edit conflict (I16)',
  summary: 'I6: rollback R2 quando Firestore save falha. Antes: uploadImageToR2 OK + saveImageMeta ' +
           'falha = blob órfão invisível (CF de cleanup scaneia portal_images collection, doc nunca foi ' +
           'criado). Fix: try/catch volta saveImageMeta + dynamic import deleteFromR2 + tenta deletar ' +
           'blob recém-uploaded + re-throw. Log distingue rollback OK vs ambos falharam. I16: edit modal ' +
           'detecta delete concorrente. User A edita img X, User B deleta em outra aba, User A salva = ' +
           'erro generic "not-found". Agora: catch específico code="not-found" OU regex → toast amigável ' +
           '"Imagem foi excluída por outro usuário. Recarregando galeria..." + close + loadImages. I11 ' +
           '(cascade race) descartado: wireCascade é 100% síncrono (filtra allDests em memória).',
  bucket: 'small',
  multiplierIds: ['integration'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.7, testes: 0.15, documentacao: 0.3, implantacao: 0.1 },
  module: 'images',
  modules: ['images'],
};
function computeHours(b, mids, ai) { const t=Object.values(b).reduce((a,x)=>a+x,0); const m=(mids||[]).map(id=>({investigation:.3,migration:.2,pdf:.15,integration:.2,security:.25,pure_refactor:-.2}[id]||0)).reduce((a,x)=>a+x,0); return t*(1+m)*ai; }
(async () => {
  const ex = await db.collection('dev_hours').where('releaseVersion','==',ENTRY.releaseVersion).limit(1).get();
  if (!ex.empty) { console.log('= skip'); process.exit(0); }
  const h = computeHours(ENTRY.hoursByCategory, ENTRY.multiplierIds, AI_ASSIST);
  const now = FV.serverTimestamp();
  const doc = { entryType:'release', ...ENTRY, aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE, totalHours: Math.round(h*100)/100, totalCost: Math.round(h*HOURLY_RATE*100)/100, status:'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now };
  const ref = await db.collection('dev_hours').add(doc);
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  process.exit(0);
})();
