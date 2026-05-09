/**
 * Adiciona 3 entradas de release dev_hours pras versões 4.35.1, 4.35.2, 4.35.3
 * (trabalho de hoje, 09/05/2026, após a phase consolidada do 4.35.0).
 *
 * Idempotente: chave por releaseVersion.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const HOURLY_RATE = 150;
const AI_MULT = 0.50;

const RELEASES = [
  {
    releaseVersion: '4.35.1',
    releaseSlug:    '20260509-hours-hhmm-format',
    title:          'Horas de desenvolvimento em formato HH:MM (em vez de decimal)',
    summary:        'User reportou: numeros como "6.67h" pareciam estar em base 100. Trocado o formatter de fmtH em dev-hours-view.html + devHoursPdf.js: agora retorna "6h 40min", "45min", "12h" conforme o caso. Edge cases tratados: zero (0min), sub-hora (so min), exato (so h), arredondamento que estoura 60 vira hora cheia. Tooltip de cat-bar tambem atualizado pra usar fmtH em vez de toFixed(2)+h.',
    bucket:         'trivial',
    multiplierIds: [],
    profile:        'bugfix',
    humanHours:     0.75,
    completedAt:    new Date('2026-05-09T08:30:00-03:00'),
  },
  {
    releaseVersion: '4.35.2',
    releaseSlug:    '20260509-dev-hours-summary-expand',
    title:          'Botao "Ver mais" pra ver descricoes truncadas em dev_hours',
    summary:        'User reportou: descricoes longas eram cortadas em 180 chars com "..." mas nao havia como ver o texto completo. Solucao: span_short com texto truncado + span_full escondido + button.sum-toggle que alterna entre os dois. Click handler bound apos cada render do tbody. Aplicado nas 17 entradas tipo phase + qualquer release com summary >180 chars. Sem modal, sem mudanca de pagina — toggle inline.',
    bucket:         'trivial',
    multiplierIds: [],
    profile:        'bugfix',
    humanHours:     0.5,
    completedAt:    new Date('2026-05-09T09:30:00-03:00'),
  },
  {
    releaseVersion: '4.35.3',
    releaseSlug:    '20260509-system-feedback-module',
    title:          'Modulo System Feedback: bug/sugestao com email automatico via Graph',
    summary:        'User notou que mencionavamos "Feedback no menu" na Governanca mas nao existia esse modulo (o /feedbacks atual eh gestao de pessoas, nao feedback do sistema). Modulo novo construido end-to-end: (1) service systemFeedback.js com createSystemFeedback + fetch + update + delete + tipos (bug/sugestao/duvida/elogio) + status (novo→em_analise→em_desenvolvimento→resolvido/rejeitado). (2) Modal compartilhado systemFeedbackModal.js que pode ser chamado de qualquer pagina. (3) Pagina admin /system-feedback com KPIs por status, filtros, cards de detalhe, troca de status, resposta interna. (4) Cloud Function onSystemFeedbackCreate (Firestore trigger v2 — primeira no projeto, exigiu provisioning Eventarc Service Agent) que envia email via Microsoft Graph pra rene.castro@primetour.com.br ao criar doc. (5) Template HTML do email com header navy + tipo destacado + metadata + CTA "Ver no sistema". (6) Sidebar entry em Administracao acima de Configuracoes. (7) Botao "Enviar sugestao" no TOC sidebar da Governanca. (8) Firestore rules: auth cria proprio, admin le/edita, master deleta. (9) Audit log (3 actions). Testado smoke + UI: 2 emails confirmados via Graph.',
    bucket:         'medium',
    multiplierIds: ['integration'], // Microsoft Graph + Cloud Function trigger v2
    profile:        'feature',
    humanHours:     8,
    completedAt:    new Date('2026-05-09T11:50:00-03:00'),
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
    : { refinamento: 0.20, desenvolvimento: 0.50, testes: 0.10, documentacao: 0.15, implantacao: 0.05 };
  const out = {}; let alloc = 0;
  for (const k of Object.keys(ratios)) { out[k] = +(totalHours * ratios[k]).toFixed(2); alloc += out[k]; }
  const diff = +(totalHours - alloc).toFixed(2);
  if (diff !== 0) out.desenvolvimento = +(out.desenvolvimento + diff).toFixed(2);
  return out;
}

(async () => {
  console.log(`🌱 Seeding ${RELEASES.length} releases (4.35.1-3)...\n`);
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
      console.log(`  ↻ ${r.releaseVersion}: ${totalHours}h · R$${totalCost.toFixed(2)} (atualizado)`);
    } else {
      await col.add(doc);
      created++;
      console.log(`  + ${r.releaseVersion}: ${totalHours}h · R$${totalCost.toFixed(2)} (criado)`);
    }
  }

  console.log(`\n✓ ${created} criadas · ${updated} atualizadas`);
  console.log(`📊 Soma: ${totalH.toFixed(2)}h · R$${totalC.toFixed(2)}`);
  process.exit(0);
})().catch(e => { console.error('❌', e); process.exit(1); });
