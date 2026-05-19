/**
 * Backfill dev_hours: releases 4.49.23 → 4.49.31 (19/05/2026, sprint da manhã/tarde).
 *
 * Sprint pré-shadow-mode: arrumação do Newsletter (Conteúdo & Temas), exports,
 * eixos duplos comercial/turismo, backfill claude-curado, modal ver arte,
 * CSP SFMC parcial. Anterior ao bloco 4.49.32-45 (shadow mode pipeline).
 *
 * Idempotente. Roda com gcloud ADC.
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
  // 4.49.23 — Feedbacks 1:1 vs do Sistema
  {
    releaseVersion: '4.49.23',
    releaseSlug:    '20260519-feedbacks-1x1-vs-sistema',
    title:          'Feedbacks 1:1 vs do Sistema — distinção visual + race fix',
    summary:        'User reportou: feedbacks duplicados/sumindo entre acessos via email vs dashboard. Causa: 2 fluxos separados (feedback de equipe vs feedback do sistema) com query path diferente. Fix: badge distintivo + sort consistente + race condition no listener.',
    profile:        'bugfix', bucket: 'small',
    multiplierIds:  ['investigation'],
    completedAt:    new Date('2026-05-19T09:30:00-03:00'),
    modules:        ['feedbacks'],
  },
  // 4.49.24 — NL Conteúdo & Temas: sort + drill modal
  {
    releaseVersion: '4.49.24',
    releaseSlug:    '20260519-nl-content-sort-expand-drill',
    title:          'Newsletter Conteúdo & Temas: sort + ver todos + drill modal',
    summary:        '5 quick wins na aba Conteúdo & Temas: (1) sort por colunas em todas as tabelas, (2) expand "ver todos" nos limited lists, (3) drill modal click-to-explore, (4) totals fixos no header, (5) tooltips em métricas técnicas.',
    profile:        'feature', bucket: 'medium',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-19T10:30:00-03:00'),
    modules:        ['nl'],
  },
  // 4.49.25 — Backfill claude-curado em mc_performance
  {
    releaseVersion: '4.49.25',
    releaseSlug:    '20260519-nl-enrich-claude-backfill',
    title:          'Backfill claude-curado em mc_performance.extracted',
    summary:        'User questionou "4 cidades para 800 docs?". Backfill determinístico curado por Claude (sem custo API) com dicionário de 148 cidades + 51 países + 50+ marcas. Resultado: cobertura passou de 4 → 95+ cidades. Script idempotente, com dry-run e relatório por BU.',
    profile:        'feature', bucket: 'medium',
    multiplierIds:  ['migration'],
    completedAt:    new Date('2026-05-19T11:30:00-03:00'),
    modules:        ['nl'],
  },
  // 4.49.26 — Estende enrich pra htmlText
  {
    releaseVersion: '4.49.26',
    releaseSlug:    '20260519-nl-enrich-htmltext-bodied',
    title:          'Enrich estendido pra ler htmlText (subject entrega pouco)',
    summary:        'User: "ler o html é fundamental. subject entrega muito pouco". Estendido o enrich-content.js pra processar htmlText além do subject. Cobertura subiu de 92% pra 99% nos eixos. Stripping de HTML + truncamento em 30k chars + reaplicação de todos os regexes.',
    profile:        'feature', bucket: 'small',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-19T12:00:00-03:00'),
    modules:        ['nl'],
  },
  // 4.49.27 — Eixos duplos Comercial × Turismo
  {
    releaseVersion: '4.49.27',
    releaseSlug:    '20260519-nl-eixos-duplos-comercial-turismo',
    title:          'Eixos duplos de classificação: Comercial × Turismo',
    summary:        'Spec do user (ponto 1 do roadmap): cada disparo ganha 2 classificações independentes. Comercial: sazonal/promocao/parceiro/inspiracional (prioridade nessa ordem). Turismo: evento/aereo/roteiro/servico/hotelaria/cruzeiro/produto/destino/outros. Script classify-content.js novo, dashboard com 2 gráficos lado a lado, exports atualizados.',
    profile:        'feature', bucket: 'large',
    multiplierIds:  ['migration'],
    completedAt:    new Date('2026-05-19T13:30:00-03:00'),
    modules:        ['nl'],
  },
  // 4.49.28 — Exports XLS+PDF+PPTX da aba Conteúdo
  {
    releaseVersion: '4.49.28',
    releaseSlug:    '20260519-nl-content-exports-xls-pdf-ppt',
    title:          'Exports da aba Conteúdo & Temas — XLS + PDF + PPTX',
    summary:        'Ponto 5 do roadmap: substitui alert "será entregue na 4.7.0" por exports reais nos 3 formatos. XLS com sheets por aggregator. PDF rudimentar (rewrite veio em 4.49.38). PPTX com slides por bloco. Tudo honra filtros atuais.',
    profile:        'feature', bucket: 'medium',
    multiplierIds:  ['pdf'],
    completedAt:    new Date('2026-05-19T14:30:00-03:00'),
    modules:        ['nl'],
  },
  // 4.49.29 — Modal Ver arte
  {
    releaseVersion: '4.49.29',
    releaseSlug:    '20260519-nl-ver-arte-modal',
    title:          'Modal "Ver arte" — preview de imagens da newsletter',
    summary:        'User: "gostaria de clicar na newsletter na aba Performance ver a arte". Modal com até 5 imagens (top-N extraídas via regex no html). Click no chip do disparo abre modal full-screen com grid responsivo. Imagens vêm de campo imageUrls populado pelo mc-sync.',
    profile:        'feature', bucket: 'medium',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-19T15:30:00-03:00'),
    modules:        ['nl'],
  },
  // 4.49.30 — Backfill imageUrls legado
  {
    releaseVersion: '4.49.30',
    releaseSlug:    '20260519-backfill-image-urls-legado',
    title:          'Backfill imageUrls pro legado de 700+ docs',
    summary:        'User: "não conseguimos pegar o legado de imagens pq?". Script backfill-image-urls.js refetch HTML do SFMC por assetName, extrai top 5 imagens via mesmo extractContentImages() do mc-sync. Bugs encontrados: MIDs errados (401 SFMC) + query body com fields specifier (400). Resultado: 692/756 (92%) docs com imageUrls.',
    profile:        'bugfix', bucket: 'medium',
    multiplierIds:  ['integration', 'investigation'],
    completedAt:    new Date('2026-05-19T16:30:00-03:00'),
    modules:        ['nl'],
  },
  // 4.49.31 — CSP img-src SFMC inicial (parcial — 4.49.37 completou)
  {
    releaseVersion: '4.49.31',
    releaseSlug:    '20260519-csp-img-src-sfmc',
    title:          'CSP img-src libera CDNs SFMC iniciais (parcial)',
    summary:        'Resposta ao bug 4.49.30: backfill funcionou (692 docs) mas modal "Ver arte" mostrava "imagem indisponível". Causa: CSP img-src não tinha domínios SFMC. Adicionados: image.viagens.newsletterprime.com.br, ftpprime.blob.core.windows.net, image.exct.net, image.s10.exacttarget.com. Validado live (na época). 4.49.37 completou com as outras 4 BUs depois.',
    profile:        'bugfix', bucket: 'trivial',
    multiplierIds:  ['security', 'investigation'],
    completedAt:    new Date('2026-05-19T17:00:00-03:00'),
    modules:        ['nl'],
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
    approvedBy: { uid: 'system-backfill', name: 'Backfill v4.49.23-31 — sprint da manhã' },
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
  console.log(`\n📦 Backfill dev_hours: ${ENTRIES.length} releases (4.49.23 → 4.49.31)\n`);
  console.log(`   Sprint Newsletter da manhã/tarde de 19/05 (pré-shadow-mode)\n`);
  let totalH = 0, totalC = 0;
  for (const entry of ENTRIES) {
    const r = await upsert(entry);
    console.log(`  ${r.action === 'created' ? '+' : '~'} ${entry.releaseVersion.padEnd(8)} ${String(r.hrs).padStart(6)}h · R$ ${r.cost.toFixed(2).padStart(9)} · ${r.action}`);
    totalH += r.hrs;
    totalC += r.cost;
  }
  console.log(`\n  ─────────────────────────────────────`);
  console.log(`  Total adicionado: ${totalH.toFixed(2)}h · R$ ${totalC.toFixed(2)}\n`);
  process.exit(0);
})();
