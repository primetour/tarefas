/**
 * Apaga os 2 roteiros manuais existentes do roteiros_bank pra zerar antes
 * de popular via Envision. Lista dependências antes pra confirmar limpeza.
 *
 * Roteiros a apagar:
 *   - CLASSIC COLLECTION: CHINA E TIBETE
 *   - PERU COMPLETO: LIMA, AREQUIPA, PUNO, CUSCO, VALLE SAGRADO E MACHU PICCHU
 *
 * Rodar: cd functions && node delete-bank-docs-2-existing.cjs
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const TITLE_MATCHERS = [
  /classic collection.*china.*tibete/i,
  /peru completo.*lima.*arequipa.*puno.*cusco/i,
];

(async () => {
  console.log('[delete-bank-docs] scanning roteiros_bank...');
  const snap = await db.collection('roteiros_bank').get();
  const toDelete = [];
  snap.forEach(doc => {
    const data = doc.data();
    const title = data.title || '';
    if (TITLE_MATCHERS.some(rx => rx.test(title))) {
      toDelete.push({ id: doc.id, title, code: data.code, status: data.status });
    }
  });

  console.log(`[delete-bank-docs] matched ${toDelete.length} docs:`);
  toDelete.forEach(d => console.log(`  - ${d.id}  status=${d.status}  code=${d.code}  title="${d.title}"`));

  if (!toDelete.length) {
    console.log('[delete-bank-docs] nothing to delete. exit.');
    process.exit(0);
  }

  // Cleanup FK cross-collection (CLAUDE.md §13.a) — quem aponta pra esses bankDocs?
  console.log('\n[delete-bank-docs] checking FK dependencies...');

  // 1. roteiros (collection principal) — campo bankDocId?
  let roteirosDep = 0;
  for (const d of toDelete) {
    try {
      const rs = await db.collection('roteiros').where('bankDocId', '==', d.id).limit(50).get();
      if (!rs.empty) {
        console.log(`  ⚠ ${rs.size} roteiros apontam pra bankDocId=${d.id}`);
        rs.forEach(r => console.log(`    - roteiro ${r.id}  client=${r.data().client?.name}`));
        roteirosDep += rs.size;
      }
    } catch (e) { console.warn(`  query roteiros falhou: ${e.message}`); }
  }

  // 2. ai_usage_logs — campo bankDocId
  let aiLogsDep = 0;
  for (const d of toDelete) {
    try {
      const ls = await db.collection('ai_usage_logs').where('bankDocId', '==', d.id).limit(50).get();
      if (!ls.empty) {
        console.log(`  ⚠ ${ls.size} ai_usage_logs ref bankDocId=${d.id}`);
        aiLogsDep += ls.size;
      }
    } catch (e) { /* index pode não existir, OK */ }
  }

  console.log(`\n[delete-bank-docs] summary: ${toDelete.length} bank docs, ${roteirosDep} roteiros refs, ${aiLogsDep} ai_usage_logs refs`);
  console.log('[delete-bank-docs] deleting bank docs (FKs em roteiros viram bankDocId=null + flag bankDocDeleted)...\n');

  for (const d of toDelete) {
    // Soft cleanup em roteiros (não deleta o roteiro do consultor — só zera ref + flag)
    try {
      const rs = await db.collection('roteiros').where('bankDocId', '==', d.id).limit(500).get();
      if (!rs.empty) {
        const batch = db.batch();
        rs.forEach(r => batch.update(r.ref, {
          bankDocId: null,
          bankDocDeleted: true,
          bankDocDeletedAt: FV.serverTimestamp(),
          bankDocDeletedTitle: d.title,
        }));
        await batch.commit();
        console.log(`  ✓ zerou ref em ${rs.size} roteiros pra bankDocId=${d.id}`);
      }
    } catch (e) { console.warn(`  cleanup roteiros falhou: ${e.message}`); }

    // Audit log
    try {
      await db.collection('audit_logs').add({
        action: 'roteiros_bank.delete',
        actorId: 'system',
        actorName: 'Cleanup script (zerar banco pre-Envision)',
        targetType: 'roteiros_bank',
        targetId: d.id,
        details: { title: d.title, code: d.code, reason: 'wipe pre-envision-integration' },
        severity: 'info',
        timestamp: FV.serverTimestamp(),
      });
    } catch (e) { console.warn(`  audit_log falhou: ${e.message}`); }

    // Delete
    await db.collection('roteiros_bank').doc(d.id).delete();
    console.log(`  ✓ deletado bank ${d.id}  "${d.title}"`);
  }

  console.log(`\n[delete-bank-docs] DONE. ${toDelete.length} bank docs deleted.`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
