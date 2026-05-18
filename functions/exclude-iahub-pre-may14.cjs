/**
 * Exclui entries de IA Hub anteriores a 14/05/2026 do tab "Foco em produto".
 *
 * Marca com modules:[] (sentinel de exclusão) pra que o heurístico no client
 * NÃO as capture. Mantém os dados originais — só remove do escopo de produtos.
 *
 * Idempotente: roda quantas vezes quiser, converge pro mesmo estado.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const IAHUB_PATTERN = /\b((?:ia|ai)[-_ ]?hub|iahub|aihub)\b/i;
const KICKOFF = new Date('2026-05-14T00:00:00-03:00');

(async () => {
  const snap = await db.collection('dev_hours').where('status', '==', 'approved').get();
  const all = snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));

  const candidates = all.filter(e => {
    const hay = `${e.title||''} ${e.releaseSlug||''} ${e.phaseLabel||''}`;
    if (!IAHUB_PATTERN.test(hay)) return false;
    const dt = e.completedAt?.toDate?.() || (e.completedAt ? new Date(e.completedAt) : null);
    if (!dt) return true; // sem data → considerar pré-kickoff (excluir)
    return dt < KICKOFF;
  });

  console.log(`\n${candidates.length} entries IA Hub pré-14/05 pra excluir:\n`);
  for (const e of candidates) {
    const dt = e.completedAt?.toDate?.();
    const label = e.releaseVersion || e.phaseLabel || '?';
    const already = Array.isArray(e.modules) && e.modules.length === 0;
    console.log(`  ${dt?.toLocaleDateString('pt-BR') || 'sem data'} · ${label} · ${e.totalHours}h · ${e.title?.slice(0, 60)}${already ? ' [já excluído]' : ''}`);
    if (already) continue;
    await e.ref.update({
      modules: [],
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: 'system-exclude-iahub-pre-may14',
    });
  }
  console.log(`\nDONE: ${candidates.length} processadas.\n`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
