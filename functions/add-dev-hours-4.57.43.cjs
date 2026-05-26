/**
 * dev_hours v4.57.43 — Sprint Portal de Dicas 5/5 (final): polish
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.57.43',
  releaseSlug: '20260525-portal-dicas-polish-confirm-errorcode-vars',
  title: 'Portal de Dicas — sprint 5/5 (final): polish (PD17 errorCode + PD18 modal + PD19 vars)',
  summary: 'Release final da sprint Portal de Dicas. PD18: 3 confirm() nativos substituídos por ' +
           'modal.confirm em portalTipsList (delete tip + delete material) e portalImages (delete img). ' +
           'PD19: 6 hex hardcoded em portalImages substituídos por var(--color-danger/warning/success) ' +
           'com fallback. PD17: portalPdfParser ganha helper _portalParseError(msg, code, isRetryable) ' +
           'classificando 5 códigos de erro (invalid_file, invalid_filename, pdf_encrypted, pdf_corrupted, ' +
           'empty_content). Espelho R3 (Roteiros v4.57.38). Falsos positivos descartados: PD6 (auto-save) ' +
           'JÁ EXISTE no editor:1225 com 4s debounce; PD14 (listeners) tem 0 listeners globais. Sprint ' +
           'Portal de Dicas FECHADA (v4.57.39→43): 5 releases, 16 fixes + 2 falsos positivos, 10 cleanup ' +
           'FK paths, 2 CFs novas, 3 confirm()->modal, 6 hex->vars.',
  bucket: 'small',
  multiplierIds: ['pure_refactor', 'integration'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.7, testes: 0.15, documentacao: 0.4, implantacao: 0.1 },
  module: 'portal',
  modules: ['portal'],
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
