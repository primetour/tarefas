/**
 * 4.40.30 — Ajusta baseline do tab "Foco em produto" no dev-hours-view.
 *
 * Decisão do user (18/05/2026):
 *   - A iniciativa de produto (Portal de Dicas / Banco de Imagens /
 *     Gerador de Roteiros) começa OFICIALMENTE em 14/05/2026.
 *   - Phase legacy "Portal de Solicitações + Roteiros + Pesquisas externas"
 *     (43h45min, 18/04/2026) NÃO conta — era trabalho genérico, não a
 *     iniciativa focada (e "Portal de Solicitações" é módulo diferente do
 *     "Portal de Dicas").
 *   - Releases 4.40.1, 4.40.5-7 e 4.35.7 (datadas 11-12/05) ficam realocadas
 *     pra 14/05 — alinhando ao kickoff da iniciativa.
 *   - Releases 4.40.17 e 4.40.18 (15/05) ficam onde estão.
 *
 * Idempotente: roda quantas vezes quiser, sempre converge pro mesmo estado.
 *
 * Como rodar:
 *   cd functions && node fix-products-tab-baseline.cjs
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

// ─── 1) Excluir phase legacy de abril via modules:[] ───────
const EXCLUDED_PHASE_LABEL = 'Portal de Solicitações + Roteiros + Pesquisas externas';

// ─── 2) Realocação de datas (releases pre-14/05 → 14/05) ───
// Distribuídas ao longo do dia 14/05 mantendo a ORDEM ORIGINAL.
const DATE_REASSIGNMENTS = [
  { releaseVersion: '4.35.7', newDate: new Date('2026-05-14T09:00:00-03:00') },
  { releaseVersion: '4.40.1', newDate: new Date('2026-05-14T10:00:00-03:00') },
  { releaseVersion: '4.40.5', newDate: new Date('2026-05-14T11:00:00-03:00') },
  { releaseVersion: '4.40.6', newDate: new Date('2026-05-14T14:00:00-03:00') },
  { releaseVersion: '4.40.7', newDate: new Date('2026-05-14T15:00:00-03:00') },
];

async function run() {
  console.log('═══ fix-products-tab-baseline ═══\n');

  // ─── (1) Excluir phase legacy ───────────────────────────
  const phaseQ = await db.collection('dev_hours')
    .where('phaseLabel', '==', EXCLUDED_PHASE_LABEL)
    .get();
  if (phaseQ.empty) {
    console.warn(`⚠ Phase "${EXCLUDED_PHASE_LABEL}" não encontrada — pulando.`);
  } else {
    for (const doc of phaseQ.docs) {
      const cur = doc.data();
      if (Array.isArray(cur.modules) && cur.modules.length === 0) {
        console.log(`✓ Phase "${cur.phaseLabel}" já está com modules:[] — sem mudança.`);
        continue;
      }
      await doc.ref.update({
        modules: [],  // sentinel: "explicitamente excluído da view de produtos"
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'system-fix-products-baseline',
      });
      console.log(`✅ Excluída do produtos: phase "${cur.phaseLabel}" (${cur.totalHours}h)`);
    }
  }

  // ─── (2) Realocação de datas pré-14/05 ──────────────────
  console.log('\n--- Realocação de datas ---');
  for (const { releaseVersion, newDate } of DATE_REASSIGNMENTS) {
    const q = await db.collection('dev_hours')
      .where('releaseVersion', '==', releaseVersion)
      .get();
    if (q.empty) {
      console.warn(`⚠ Release ${releaseVersion} não encontrada — pulando.`);
      continue;
    }
    for (const doc of q.docs) {
      const cur = doc.data();
      const curDate = cur.completedAt?.toDate
        ? cur.completedAt.toDate()
        : (cur.completedAt ? new Date(cur.completedAt) : null);
      if (curDate && Math.abs(curDate.getTime() - newDate.getTime()) < 60_000) {
        console.log(`✓ ${releaseVersion} já está em ${newDate.toLocaleDateString('pt-BR')} — sem mudança.`);
        continue;
      }
      await doc.ref.update({
        completedAt: admin.firestore.Timestamp.fromDate(newDate),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'system-fix-products-baseline',
      });
      const oldStr = curDate ? curDate.toLocaleString('pt-BR') : 'sem data';
      console.log(`✅ ${releaseVersion}: ${oldStr} → ${newDate.toLocaleString('pt-BR')}`);
    }
  }

  console.log('\n═══ DONE ═══');
  process.exit(0);
}

run().catch(err => {
  console.error('Falhou:', err);
  process.exit(1);
});
