/**
 * dev_hours v4.57.36 — Sprint Roteiros 3/5: race conditions
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';
const ENTRY = {
  releaseVersion: '4.57.36',
  releaseSlug: '20260525-roteiros-race-conditions-conflict-debounce-lock',
  title: 'Roteiros — sprint 3/5: race conditions (conflict multi-aba + PDF debounce + import lock)',
  summary: 'Continuação sprint Roteiros. R5: conflict detection multi-aba/multi-user — antes overwrite ' +
           'silencioso last-write-wins. Editor grava _loadedAt no boot; saveRoteiro re-fetcha + compara ' +
           'updatedAt (tolerância 1s). Throw CONFLICT. handleSave trata: auto-save pausa retries, ' +
           'manual save abre modal "Recarregar (descartar) / Cancelar". R8: anti-double-submit no ' +
           'generateRoteiro — Map _generateInFlight por (roteiroId+format) TTL 30s. Permite formatos ' +
           'paralelos, bloqueia mesma combo. R9: distributed lock no importRoteiroBankPdf — ' +
           'import_locks/{pdf_<sha256-fingerprint>} via runTransaction. Antes: UI retry = parse duplo + ' +
           '2 docs no banco. TTL 10min, libera via lockRef.delete (best-effort).',
  bucket: 'small',
  multiplierIds: ['investigation', 'integration'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.4, desenvolvimento: 1.0, testes: 0.3, documentacao: 0.3, implantacao: 0.15 },
  module: 'roteiros',
  modules: ['roteiros', 'cloud-functions'],
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
