const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.63.91',
    releaseSlug: '20260530-avif-tiff-upload',
    title: 'Banco de Imagens: aceitar upload de AVIF e TIFF, convertendo pra WebP no mesmo pipeline',
    summary: 'Renê pediu "permitir upload de fotos avif e o tiff (dá pra converter pra webp esses formatos nos ' +
             'moldes que construímos?)". Implementado seguindo o mold existente de convert-to-WebP. convertToWebp ' +
             '(js/services/portal.js) refatorado pra helper compartilhado drawableToWebp(drawable, w, h). AVIF ' +
             'entra pelo caminho nativo de <img> — Chrome moderno decodifica AVIF nativamente, então já cai no ' +
             'canvas existente sem branch extra. TIFF (não-decodável via <img> fora do Safari) ganha branch ' +
             'dedicado: _tiffToCanvas(file) via decoder JS UTIF.js (lazy-load cdn.jsdelivr.net/npm/utif@3.1.0, já ' +
             'permitido no CSP script-src) → UTIF.decode/decodeImage/toRGBA8 → ImageData → canvas → drawableToWebp. ' +
             'Assinatura inalterada → beneficia todos os callers (batch do Banco, roteiroEditor). UI ' +
             '(js/pages/portalImages.js): ACCEPTED_MIMES expandido (image/avif, image/tiff, image/x-tiff) + ' +
             'ACCEPTED_EXTS regex; _validateFiles aceita por MIME OU extensão (TIFF costuma vir com type vazio); ' +
             'input accept="image/*,.avif,.tif,.tiff"; hint de formatos atualizado. Validado por node --check nos ' +
             '2 arquivos; E2E live de upload bloqueado por login SSO do Renê (não autentico).',
    bucket: 'trivial', multiplierIds: ['integration'], profile: 'feature',
    hoursByCategory: { refinamento: 0.15, desenvolvimento: 0.35, testes: 0.15, documentacao: 0.05, implantacao: 0.05 },
    module: 'images', modules: ['images'],
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
    const doc = { entryType: 'release', ...ENTRY, aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE,
      totalHours: Math.round(h * 100) / 100, totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
      status: 'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now };
    const ref = await db.collection('dev_hours').add(doc);
    console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  }
  process.exit(0);
})();
