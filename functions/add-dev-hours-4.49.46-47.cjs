/**
 * Backfill dev_hours: 4.49.46 (backfill do CHANGELOG + dev_hours) e
 * 4.49.47 (double-check do CHANGELOG).
 *
 * Auto-meta entries — trabalho de documentação. Idempotente.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const HOURLY_RATE = 150;
const AI_ASSIST   = 0.50;
const COLLECTION  = 'dev_hours';

const BUCKETS = {
  trivial: [0.25, 0.5], small: [0.5, 1.5], medium: [1.5, 4],
  large: [4, 8], epic: [8, 16], mega: [16, 80],
};
const MULTIPLIERS = {
  investigation: 0.30, migration: 0.20, pdf: 0.15,
  integration: 0.20, security: 0.25, pure_refactor: -0.20,
};

function calcHumanHours(bucket, multIds = []) {
  const [mn, mx] = BUCKETS[bucket];
  const base = (mn + mx) / 2;
  let factor = 1;
  for (const id of multIds) factor += (MULTIPLIERS[id] || 0);
  return Math.max(0.25, +(base * factor).toFixed(2));
}
function suggestBreakdown(totalHours, profile) {
  const RATIOS = {
    feature:  [0.15, 0.55, 0.15, 0.10, 0.05],
    bugfix:   [0.10, 0.50, 0.25, 0.05, 0.10],
    refactor: [0.15, 0.55, 0.15, 0.10, 0.05],
    security: [0.20, 0.40, 0.20, 0.10, 0.10],
    docs:     [0.05, 0.05, 0.05, 0.80, 0.05],
  };
  const r = RATIOS[profile] || RATIOS.feature;
  const r1 = +(totalHours * r[0]).toFixed(2);
  const r2 = +(totalHours * r[1]).toFixed(2);
  const r3 = +(totalHours * r[2]).toFixed(2);
  const r4 = +(totalHours * r[3]).toFixed(2);
  const r5 = +(totalHours - r1 - r2 - r3 - r4).toFixed(2);
  return { refinamento: r1, desenvolvimento: r2, testes: r3, documentacao: r4, implantacao: r5 };
}

const ENTRIES = [
  {
    releaseVersion: '4.49.46',
    releaseSlug:    '20260520-changelog-devhours-sprint-completo',
    title:          'Backfill CHANGELOG + dev_hours: sprint completo 19-20/05',
    summary:        'Resposta ao Renê: "atualize o doc técnico e o horas dev → eu não rodo nada manualmente. quem faz as coisas é vc. quero pronto". CHANGELOG ganha 23 entradas (4.49.23 → 4.49.45). Criados e executados via Admin SDK: functions/add-dev-hours-4.49.23-31.cjs (+13,09h / R$ 1.963,50) e functions/add-dev-hours-4.49.32-45.cjs (+22,53h / R$ 3.379,50). DEV-HOURS.md header atualizado (788h 11min / R$ 118.227 / 180 releases + 17 phases / 7h 22min/dia). Recalibragem em v4.49.41 e v4.49.42 de mega pra large (mega irrealista numa release única).',
    profile:        'docs', bucket: 'medium',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-20T03:00:00-03:00'),
    modules:        ['docs'],
  },
  {
    releaseVersion: '4.49.47',
    releaseSlug:    '20260520-changelog-doublecheck',
    title:          'Double-check do CHANGELOG + DEV-HOURS (100% accuracy)',
    summary:        'Resposta ao Renê: "vamos de double check no doc técnico? preciso disso 100%". 6 verificações: (1) ordem/completude 23 entradas OK, (2) cross-check slugs vs git log 14/14 batem, (3) fatos técnicos — 1 discrepância corrigida (texto dizia "330 linhas" do classify-content-ai.js mas hoje são ~556; reescrito como "escopo inicial ~330 linhas; cresceu pra ~560"), (4) markdown sintaxe sem dups/code fences abertas, (5) cross-check dev_hours Firestore vs CHANGELOG: 23 approved, sem ghosts/missing, (6) totais DEV-HOURS.md batem com Firestore (197 entries / 788h 11min / R$ 118.227 / subtotais 13,09h + 22,53h = 35,62h).',
    profile:        'docs', bucket: 'small',
    multiplierIds:  ['investigation'],
    completedAt:    new Date('2026-05-20T03:30:00-03:00'),
    modules:        ['docs'],
  },
];

async function upsert(entry) {
  const humanHrs = calcHumanHours(entry.bucket, entry.multiplierIds);
  const adjusted = Math.max(0.1, +(humanHrs * AI_ASSIST).toFixed(2));
  const cost     = +(adjusted * HOURLY_RATE).toFixed(2);
  const breakdown = suggestBreakdown(adjusted, entry.profile);
  const payload = {
    entryType: 'release',
    releaseVersion: entry.releaseVersion, releaseSlug: entry.releaseSlug,
    phaseLabel: null, title: entry.title, summary: entry.summary,
    commits: [], phaseCommitsCount: null,
    filesChanged: 0, linesAdded: 0, linesRemoved: 0,
    startedAt: null,
    completedAt: admin.firestore.Timestamp.fromDate(entry.completedAt),
    bucket: entry.bucket, basePoint: null,
    multipliers: entry.multiplierIds.map(id => ({ id, value: MULTIPLIERS[id] })),
    humanEquivalentHours: humanHrs, aiAssistanceMultiplier: AI_ASSIST,
    totalHours: adjusted, hourlyRate: HOURLY_RATE, totalCost: cost,
    hoursByCategory: breakdown, notes: '', confidenceLevel: 'medium',
    profile: entry.profile, modules: entry.modules || undefined,
    status: 'approved',
    approvedAt: FV.serverTimestamp(),
    approvedBy: { uid: 'system-backfill', name: 'Backfill v4.49.47 — auto-meta docs' },
    rejectedAt: null, rejectedBy: null,
    createdAt: FV.serverTimestamp(), createdBy: 'system-backfill',
    updatedAt: FV.serverTimestamp(), updatedBy: 'system-backfill',
  };
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
  const snap = await db.collection(COLLECTION)
    .where('releaseVersion', '==', entry.releaseVersion)
    .where('entryType', '==', 'release').limit(1).get();
  if (!snap.empty) {
    const id = snap.docs[0].id;
    await db.collection(COLLECTION).doc(id).set(payload, { merge: false });
    return { action: 'updated', id, hrs: adjusted, cost };
  }
  const ref = await db.collection(COLLECTION).add(payload);
  return { action: 'created', id: ref.id, hrs: adjusted, cost };
}

(async () => {
  console.log(`\n📦 Backfill dev_hours: ${ENTRIES.length} releases meta (4.49.46-47)\n`);
  let totalH=0, totalC=0;
  for (const entry of ENTRIES) {
    const r = await upsert(entry);
    console.log(`  ${r.action==='created'?'+':'~'} ${entry.releaseVersion.padEnd(8)} ${String(r.hrs).padStart(6)}h · R$ ${r.cost.toFixed(2).padStart(9)} · ${r.action}`);
    totalH += r.hrs; totalC += r.cost;
  }
  console.log(`\n  ─────────────────────────────────────`);
  console.log(`  Total adicionado: ${totalH.toFixed(2)}h · R$ ${totalC.toFixed(2)}\n`);
  process.exit(0);
})();
