/**
 * Lista entries de dev_hours que casam com IA Hub e que aconteceram
 * a partir de 14/05/2026 (kickoff oficial da iniciativa de produto).
 *
 * Não modifica nada — só lista.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const IAHUB_PATTERN = /\b((?:ia|ai)[-_ ]?hub|iahub|aihub)\b/i;
const KICKOFF = new Date('2026-05-14T00:00:00-03:00');

(async () => {
  const snap = await db.collection('dev_hours').where('status', '==', 'approved').get();
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const matches = all.filter(e => {
    const hay = `${e.title||''} ${e.releaseSlug||''} ${e.phaseLabel||''}`;
    if (!IAHUB_PATTERN.test(hay)) return false;
    const dt = e.completedAt?.toDate?.() || (e.completedAt ? new Date(e.completedAt) : null);
    if (!dt || dt < KICKOFF) return false;
    return true;
  });
  console.log(`\n${matches.length} entries de IA Hub a partir de 14/05/2026:\n`);
  matches.forEach(e => {
    const dt = e.completedAt?.toDate?.();
    const label = e.releaseVersion || e.phaseLabel || '?';
    console.log(`  ${dt?.toLocaleString('pt-BR')} · ${label} · ${e.totalHours}h · ${e.title?.slice(0, 80)}`);
  });
  console.log('');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
