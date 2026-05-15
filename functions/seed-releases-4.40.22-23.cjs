/**
 * Adiciona dev_hours pras releases 4.40.22 → 4.40.23 (finalização audit).
 * - 4.40.22: docs DEV-HOURS + seed 4.40.19-21 + bump
 * - 4.40.23: B1 GCP API key restrictions aplicado via gcloud CLI +
 *            C3 refinement (remove user MS token fallback em agents.js)
 * Idempotente: upserta por releaseVersion.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const HOURLY_RATE = 150;
const AI_MULT = 0.50;

const RELEASES = [
  {
    releaseVersion: '4.40.22',
    releaseSlug:    '20260515-audit-docs-final',
    title:          'docs+hours: atualiza DEV-HOURS + seed 4.40.19-21 (audit sprint)',
    summary:        'DEV-HOURS.md atualizada (4.40.18→4.40.21, ~683→~691h, ~R$102.471→103.647), métricas-alvo, histórico ganha linha "AUDITORIA DE SEGURANÇA PRÉ-BANCÁRIA". seed-releases-4.40.19-21.cjs aplicado no Firestore (7,84h totalHours · R$ 1.176). Validação Chrome MCP comprovou A4 emit live: userEmailHash="h:e038fa8426c0e91d" + userAgent="Chrome/macOS".',
    bucket:         'trivial',
    multiplierIds: [],
    profile:        'docs',
    humanHours:     0.4,
    completedAt:    new Date('2026-05-15T23:50:00-03:00'),
  },
  {
    releaseVersion: '4.40.23',
    releaseSlug:    '20260515-b1-gcp-restrictions-c3-no-fallback',
    title:          'security: B1 (GCP API key restrictions) + C3 refinement',
    summary:        'B1 aplicado via gcloud services api-keys update: HTTP referrer restrictions na Firebase Web API key (8649818d-...) — allowed: primetour.github.io/*, *.primetour.com.br/*, primetour.com.br/*, localhost:8765/*. Comprovado E2E com 3 curls: empty referrer → HTTP 403 blocked, evil.example.com → HTTP 403 blocked, primetour.github.io → HTTP 400 (chegou ao endpoint, falha só no payload). App ao vivo continua lendo Firestore normalmente. C3 refinement: removido fallback de user MS token em agents.js _fetchSharePoint — antes, se app credentials falhassem, caía no token do user (sessionStorage, vulnerável XSS). Agora EXCLUSIVAMENTE app-only via Cloud Function getSharePointToken + server-side secrets. SECURITY-FOLLOWUPS.md atualizado marcando B1 como aplicado (com comprovação E2E inline). Em paralelo: photo sync no profile.js continua usando user MS token (operação user-iniciada, least-privilege).',
    bucket:         'small',
    multiplierIds: ['security'],
    profile:        'feature',
    humanHours:     1.2,
    completedAt:    new Date('2026-05-16T00:15:00-03:00'),
  },
];

const MULTIPLIERS = {
  investigation: 0.30, migration: 0.20, pdf: 0.15,
  integration: 0.20, security: 0.25, pure_refactor: -0.20,
};

function applyMultipliers(baseHours, ids = []) {
  let f = 1;
  for (const id of ids) f += (MULTIPLIERS[id] || 0);
  return Math.max(0.25, +(baseHours * f).toFixed(2));
}

function suggestBreakdown(totalHours, profile = 'feature') {
  const ratios = profile === 'bugfix'
    ? { refinamento: 0.30, desenvolvimento: 0.40, testes: 0.15, documentacao: 0.10, implantacao: 0.05 }
    : profile === 'docs'
    ? { refinamento: 0.10, desenvolvimento: 0.10, testes: 0.05, documentacao: 0.70, implantacao: 0.05 }
    : { refinamento: 0.20, desenvolvimento: 0.50, testes: 0.10, documentacao: 0.15, implantacao: 0.05 };
  const out = {}; let alloc = 0;
  for (const k of Object.keys(ratios)) { out[k] = +(totalHours * ratios[k]).toFixed(2); alloc += out[k]; }
  const diff = +(totalHours - alloc).toFixed(2);
  if (diff !== 0) out.desenvolvimento = +(out.desenvolvimento + diff).toFixed(2);
  return out;
}

(async () => {
  console.log(`Seeding ${RELEASES.length} releases (4.40.22-23)...\n`);
  const col = db.collection('dev_hours');
  let created = 0, updated = 0, totalH = 0, totalC = 0;

  for (const r of RELEASES) {
    const humanHours = applyMultipliers(r.humanHours, r.multiplierIds || []);
    const totalHours = Math.max(0.1, +(humanHours * AI_MULT).toFixed(2));
    const totalCost  = +(totalHours * HOURLY_RATE).toFixed(2);
    const breakdown  = suggestBreakdown(totalHours, r.profile);
    totalH += totalHours; totalC += totalCost;

    const doc = {
      entryType:              'release',
      releaseVersion:         r.releaseVersion,
      releaseSlug:            r.releaseSlug,
      title:                  r.title,
      summary:                r.summary,
      bucket:                 r.bucket,
      multiplierIds:          r.multiplierIds || [],
      profile:                r.profile,
      humanEquivalentHours:   humanHours,
      aiAssistanceMultiplier: AI_MULT,
      totalHours,
      totalCost,
      hourlyRate:             HOURLY_RATE,
      hoursByCategory:        breakdown,
      status:                 'approved',
      completedAt:            admin.firestore.Timestamp.fromDate(r.completedAt),
      approvedAt:             admin.firestore.FieldValue.serverTimestamp(),
      approvedBy:             { uid: 'seed-script', name: 'Seed (CLI)' },
      createdAt:              admin.firestore.FieldValue.serverTimestamp(),
      createdBy:              { uid: 'seed-script', name: 'Seed (CLI)' },
    };

    const existing = await col.where('releaseVersion', '==', r.releaseVersion).limit(1).get();
    if (!existing.empty) {
      await existing.docs[0].ref.update({ ...doc, createdAt: existing.docs[0].data().createdAt, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      updated++;
      console.log(`  ${r.releaseVersion}: ${totalHours}h, R$ ${totalCost.toFixed(2)} (atualizado)`);
    } else {
      await col.add(doc);
      created++;
      console.log(`  ${r.releaseVersion}: ${totalHours}h, R$ ${totalCost.toFixed(2)} (criado)`);
    }
  }

  console.log(`\n${created} criadas, ${updated} atualizadas`);
  console.log(`TOTAL: ${totalH.toFixed(2)}h, R$ ${totalC.toFixed(2)}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
