/**
 * Adiciona entradas de dev_hours pras releases 4.40.19 → 4.40.21 (15/05/2026).
 * - 4.40.19: docs + rbac info text + seed script anterior
 * - 4.40.20: help module — 9 FAQs cobrindo novidades 4.40.8-18 + auditoria 17 findings
 * - 4.40.21: security audit sprint (C2+C3, A1-A6, M1-M6, B1-B2 — 14 fixes + 3 docs)
 * Idempotente: upserta por releaseVersion.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const HOURLY_RATE = 150;
const AI_MULT = 0.50;

const RELEASES = [
  {
    releaseVersion: '4.40.19',
    releaseSlug:    '20260515-docs-and-hours-update',
    title:          'docs+rbac: atualiza DEV-HOURS + info text de goals + seed de horas',
    summary:        'Baseado nas 11 releases do dia (4.40.8-18). DEV-HOURS.md atualizada (98→101 dias, ~672→~683h, ~R$ 100.797→102.471, média 6,86→6,76h/dia, histórico ganha linha "Filtros & hierarquia dia"). rbac.js info text de goals_view/goals_manage reescrito explicando os 5 caminhos do filtro hierárquico (gestor, responsável, membro de squad/núcleo, área visível) + master/goals_manage como bypass. seed-releases-4.40.8-18.cjs aplicado no Firestore (11.16h totalHours, R$ 1.674).',
    bucket:         'small',
    multiplierIds: [],
    profile:        'docs',
    humanHours:     1.0,
    completedAt:    new Date('2026-05-15T22:30:00-03:00'),
  },
  {
    releaseVersion: '4.40.20',
    releaseSlug:    '20260515-help-module-updated',
    title:          'docs(help): 9 FAQs cobrindo novidades 4.40.8-18',
    summary:        'Atualização do módulo de ajuda (/help) com 9 FAQs novas explicando recentes mudanças aos users finais. Cobre: filtro de observador (tasks/steps/calendar/timeline), squads stale fix (modais sempre re-fetch), hierarquia analista em metas/feedbacks (escopo squad/núcleo/área), notif duplication fix, popup stacking fix, segmentos custom Portal de Dicas, + categoria inline. Tabs por categoria (início, tarefas, ia, segurança, privacidade, rh, marketing, sistema) + busca livre.',
    bucket:         'small',
    multiplierIds: [],
    profile:        'docs',
    humanHours:     1.5,
    completedAt:    new Date('2026-05-15T23:30:00-03:00'),
  },
  {
    releaseVersion: '4.40.21',
    releaseSlug:    '20260515-security-audit-sprint',
    title:          'security: audit sprint (14 findings resolvidos + 3 documentados)',
    summary:        'Pré-auditoria bancária. C1 deferido (Cloudflare migration); C2+C3+A1-A6+M1-M6+B1-B2 atacados. CRÍTICOS: C2 firestore.rules hardening em /projects/tasks/feedbacks/absences com checks de ownership/role (tasks: removida read pública pra status done/in_progress, info-leak vector); C3 MS token defense-in-depth (beforeunload + visibilitychange 30min auto-clear). ALTOS: A1 inline scripts → preload.js+splash.js; A2 CSP img-src wildcard → whitelist explícita; A3 rel=noopener em 13 arquivos via perl mass-fix; A4 audit_logs userEmail → SHA-256 hash truncado + userAgent → Browser/OS (24 chars); A5 console.log PII removido em SSO; A6a R2 token rate-limit apertado + audit log + TTL 60s; A6b SharePoint exige permission ai_use/system_view_all (era TODO permissivo). MÉDIOS: M2 connect-src wildcards → endpoints específicos; M3 csvSafe helper (prefixa neutralizando =/+/-/@/|/% formula injection) aplicado em team/users/checkin; M4 onNotificationCreate rate-limit grava audit_log + emailSkippedReason; M5 sendCsatEmail valida email com regex RFC5322-lite; M6 master email hardcoded → process.env.FEEDBACK_ADMIN_EMAIL com fallback. BAIXOS: B1 docs/SECURITY-FOLLOWUPS.md com passo-a-passo GCP Console; B2 GitHub PAT placeholder confirmado vazio em config.js. Validado E2E via Chrome MCP: audit_log emit gera userEmailHash="h:e038fa8426c0e91d" + userAgent="Chrome/macOS". Rules + 5 functions deployed.',
    bucket:         'mega',
    multiplierIds: ['security', 'investigation'],
    profile:        'feature',
    humanHours:     8.5,
    completedAt:    new Date('2026-05-15T23:59:00-03:00'),
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
  console.log(`Seeding ${RELEASES.length} releases (4.40.19-21)...\n`);
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
