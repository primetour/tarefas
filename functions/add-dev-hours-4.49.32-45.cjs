/**
 * Backfill dev_hours: releases 4.49.32 → 4.49.45 (19/05/2026, sprint denso noturno).
 *
 * Sprint do CLASSIFICADOR IA DE NEWSLETTERS — pipeline shadow mode completo:
 *   - 4.49.32-37: arrumação do legado (waves, CSP, IA desacoplada)
 *   - 4.49.38: PDF Conteúdo & Temas (rewrite padrão Produtividade)
 *   - 4.49.39-40: seed do agente nl-content-classifier (Claude Haiku)
 *   - 4.49.41-42: pipeline shadow mode + cutover/rollback completos
 *   - 4.49.43: test harness (61 testes)
 *   - 4.49.44: security audit bank-grade (2 CRITICAL + 2 HIGH fixed)
 *   - 4.49.45: regression review pra não quebrar login
 *
 * Idempotente: usa releaseVersion como chave. Reaplica → faz upsert.
 *
 * Como rodar:
 *   cd functions
 *   gcloud auth application-default login  # se não autenticou
 *   node add-dev-hours-4.49.32-45.cjs
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const HOURLY_RATE = 150;
const AI_ASSIST   = 0.50;
const COLLECTION  = 'dev_hours';

const BUCKETS = {
  trivial: [0.25, 0.5],
  small:   [0.5,  1.5],
  medium:  [1.5,  4],
  large:   [4,    8],
  epic:    [8,    16],
  mega:    [16,   80],
};
const MULTIPLIERS = {
  investigation: 0.30,
  migration:     0.20,
  pdf:           0.15,
  integration:   0.20,
  security:      0.25,
  pure_refactor: -0.20,
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
  return {
    refinamento: r1, desenvolvimento: r2, testes: r3,
    documentacao: r4, implantacao: r5,
  };
}

const ENTRIES = [
  // ───────────────────────────────────────────────
  // 4.49.32 — Categorização IA-no-art + UI cleanup
  {
    releaseVersion: '4.49.32',
    releaseSlug:    '20260519-categorize-no-art-100pct',
    title:          '3 itens em paralelo: legado removido + info modal + 100% categorizado',
    summary:        'Resposta ao Renê: "trabalho com excelência... 100% das imagens das news, e não 90%". (1) Bloco "Tipo de newsletter (legado)" REMOVIDO do dashboard (redundante após 4.49.27), exports XLS e PPT limpos. (2) Tooltips ilegíveis viraram modal estruturado (INFO_MODAL_DEFINITIONS com categorias, prioridade, exemplos). (3) scripts/categorize-no-art.js categoriza honestamente os 64 docs sem imageUrls em csat/warmup/test/pending — 55 marcados, 9 pendentes por asset deletado.',
    profile:        'feature',
    bucket:         'medium',
    multiplierIds:  ['investigation', 'migration'],
    completedAt:    new Date('2026-05-19T19:00:00-03:00'),
    modules:        ['nl'],
  },
  // 4.49.33 — UI honesta no modal Ver Arte
  {
    releaseVersion: '4.49.33',
    releaseSlug:    '20260519-nl-ui-no-art-honest-contexto',
    title:          'UI honesta no modal "Ver arte" — contexto por noArtReason',
    summary:        'Em vez de "imagem indisponível" genérico, mostra contexto específico por noArtReason: csat (📋 pesquisa de satisfação), warmup (🔥 disparo de warm-up), test (🧪 teste interno), pending (⚠ asset deletado/sem html). Casa com o output do categorize-no-art.js (4.49.32).',
    profile:        'bugfix',
    bucket:         'small',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-19T19:30:00-03:00'),
    modules:        ['nl'],
  },
  // 4.49.34 — Circuit breaker Gemini (mitigação imediata)
  {
    releaseVersion: '4.49.34',
    releaseSlug:    '20260519-circuit-breaker-gemini',
    title:          'Circuit breaker contra quota Gemini estourada no mc-sync',
    summary:        'Mitigação imediata enquanto 4.49.35 desacoplava por completo: após N falhas consecutivas de quota Gemini, desativa chamadas IA até o final da run e termina com warning em vez de timeout. Resposta ao "pq o sync parou em 06/05?" — gap 07/05 → 19/05 causado por retry loop em quota estourada.',
    profile:        'bugfix',
    bucket:         'small',
    multiplierIds:  ['investigation'],
    completedAt:    new Date('2026-05-19T20:00:00-03:00'),
    modules:        ['nl'],
  },
  // 4.49.35 — Desacopla IA do mc-sync (arquitetural)
  {
    releaseVersion: '4.49.35',
    releaseSlug:    '20260519-desacopla-ia-mc-sync',
    title:          'Desacopla IA do mc-sync: cada workflow com 1 responsabilidade',
    summary:        'Resposta ao Renê: "o que tem a ver IA com o sync?". Crítica arquitetural válida — mc-sync.js chamava extractEntitiesViaAgent em loop → quota Gemini estourava no meio da sync → retry loop infinito → timeout 15min → sync parou em 06/05 (gap 07/05 → 19/05). Fix: mc-sync.js SÓ sincroniza performance + imagens (zero IA), enrich-content.js faz enriquecimento determinístico, classify-content.js faz classificação dupla, extractEntitiesViaAgent wrapped em dead-code. Cada feature ganha workflow+cron próprio. Falhas isoladas.',
    profile:        'refactor',
    bucket:         'medium',
    multiplierIds:  ['pure_refactor'],
    completedAt:    new Date('2026-05-19T20:30:00-03:00'),
    modules:        ['nl'],
  },
  // 4.49.36 — Fix merge de waves
  {
    releaseVersion: '4.49.36',
    releaseSlug:    '20260519-fix-merge-waves-imageurls',
    title:          'Fix merge de waves: imageUrls de QUALQUER wave do grupo',
    summary:        'Resposta ao Renê: "tem a ver com o disparo ter feito em ondas e vc condensar em um resultado só?" — acertou em cheio. dedupContentByCampaign + mergeWaves consolidavam waves (P0209_1/_2/_3 = 1 campanha) pegando o base alfabético. Se P0209_1 não tinha imageUrls e P0209_2 tinha 5, o merge cuspia o doc do _1 → modal sem imagens. Fix em ambas funções: const waveWithImgs = group.find(d => Array.isArray(d.imageUrls) && d.imageUrls.length > 0); mergedImageUrls = waveWithImgs?.imageUrls || base.imageUrls.',
    profile:        'bugfix',
    bucket:         'small',
    multiplierIds:  ['investigation'],
    completedAt:    new Date('2026-05-19T20:45:00-03:00'),
    modules:        ['nl'],
  },
  // 4.49.37 — CSP libera 5 BUs SFMC
  {
    releaseVersion: '4.49.37',
    releaseSlug:    '20260519-csp-libera-todas-bus-sfmc',
    title:          'CSP img-src libera as 5 CDNs SFMC BU completas',
    summary:        'Resposta ao Renê: "U0225, U0224, P0224, P0220, U0223, P0222... está percebendo o padrão?". Diagnóstico real: Firestore tinha imageUrls=5 em todos os 6 docs. Falha era CSP — só liberava image.viagens.newsletterprime.com.br. Faltavam 4 CDNs: partnersbtgpactual.com.br, ultrabtgpactual.tur.br, mktpts.tur.br, centurion.mktpts.tur.br. Padrão de erro registrado no commit: "funcionou pra mim => liberei só o que testei". Validação live: U0225 com 5/5 imagens.',
    profile:        'bugfix',
    bucket:         'trivial',
    multiplierIds:  ['security', 'investigation'],
    completedAt:    new Date('2026-05-19T21:00:00-03:00'),
    modules:        ['nl'],
  },
  // 4.49.38 — PDF Conteudo & Temas rewrite
  {
    releaseVersion: '4.49.38',
    releaseSlug:    '20260519-pdf-conteudo-rewrite',
    title:          'Rewrite do PDF Conteúdo & Temas seguindo padrão Produtividade',
    summary:        'Resposta ao Renê: "a exportacao para pdf ainda carece de melhorias. faltam graficos, padronizacao, retirada de caracteres especiais...". Antes: jsPDF cru sem pdfKit, títulos com emojis (💼 ✈️ 🌍 viram caixinhas no Helvetica/WinAnsi), sem capa/footer/gráficos, 7 tabelas empilhadas. Agora (landscape, espelha Produtividade): capa branded, linha de filtros sanitizada, KPI strip de 6 blocos com semáforo, 8 gráficos de barras horizontais nativas em grade 2×4 (Comercial × Turismo / Países × Cidades / Hotéis × Marcas / Cruzeiros × Temas) com cores por categoria, tabela final com pintura semafórica, footer paginado, sanitização total (txt + stripEmoji), withExportGuard.',
    profile:        'feature',
    bucket:         'large',
    multiplierIds:  ['pdf'],
    completedAt:    new Date('2026-05-19T21:30:00-03:00'),
    modules:        ['nl'],
  },
  // 4.49.39 — Agente seed Classificador NL (Gemini inicial, DESATIVADO)
  {
    releaseVersion: '4.49.39',
    releaseSlug:    '20260519-agente-classificador-newsletters-seed',
    title:          'Agente-seed Classificador de Newsletters no IA Hub (DESATIVADO)',
    summary:        'Resposta ao Renê: "precisamos deixar ele pronto no IA Hub, mas sem ativá-lo ainda. faça algo criterioso, com o mesmo padrão que vc utilizou para fazer as categorizações". Novo seed nl-content-classifier em SYSTEM_SEED_AGENTS espelha 1:1 as regras de scripts/classify-content.js: prioridade sazonal > promocao > parceiro > inspiracional (Comercial) e evento > aereo > roteiro > servico > hotelaria > cruzeiro > produto > outros > destino (Turismo), trigger rule 1-match-subject OU 2+-match-htmlText, CSAT bypass, regra especial de BU, 7 anti-padrões, 2 few-shot. Defaults conservadores (temp 0.1, maxTokens 512, visibility admin, todos triggers off). Side fix: nl em MODULE_REGISTRY pra label "Newsletters" no card.',
    profile:        'feature',
    bucket:         'medium',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-19T22:00:00-03:00'),
    modules:        ['ai-hub', 'nl'],
  },
  // 4.49.40 — Switch Gemini → Claude Haiku
  {
    releaseVersion: '4.49.40',
    releaseSlug:    '20260519-classificador-newsletters-claude-haiku',
    title:          'Seed Classificador NL muda de Gemini para Anthropic Claude Haiku 4.5',
    summary:        'Resposta ao Renê: "nao vou usar gemini. vou usar api claude. esta pronto para migrar o provedor de IA sem problemas, certo?". Code-path validado: runAgent pula validação de key local quando provider==="anthropic" → callLLMSecure → Cloud Function callLLM → Secret Manager → api.anthropic.com. Prompt caching automático ≥1024 chars (nosso prompt tem ~7k → cache hit cobra ~10% do input).',
    profile:        'bugfix',
    bucket:         'trivial',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-19T22:15:00-03:00'),
    modules:        ['ai-hub', 'nl'],
  },
  // 4.49.41 — Shadow mode pipeline completo (CORE FEATURE da noite)
  {
    releaseVersion: '4.49.41',
    releaseSlug:    '20260519-classificador-newsletters-shadow-mode',
    title:          'Shadow mode do agente Classificador NL — pipeline completo',
    summary:        'Resposta ao Renê: "quero o caminho da excelencia". Princípio arquitetural: cada agente vive no seu módulo (não há agentScheduler genérico). IA Hub = registry + governança. Entregue: (a) scripts/classify-content-ai.js (330 linhas) — lê agente do Firestore (single source of truth), kill switch soft, idempotência por hash model+prompt, cache_control ~10% do input, campos paralelos extracted.ai*, concorrência 3 + backoff, resumo em nl_ai_classifier_runs. (b) .github/workflows/classify-content-ai.yml — cron 45 6 * * * + manual com flags. (c) Dashboard NL → Conteúdo & Temas → bloco shadow mode com empty state, KPIs com semáforo, tabelas top 10 de divergências. (d) Doc scripts/SHADOW-MODE-NL-CLASSIFIER.md.',
    profile:        'feature',
    bucket:         'large',
    multiplierIds:  ['integration', 'investigation'],
    completedAt:    new Date('2026-05-19T23:30:00-03:00'),
    modules:        ['ai-hub', 'nl'],
  },
  // 4.49.42 — Pipeline 100% (cost cap + audit + promote + rollback + UI)
  {
    releaseVersion: '4.49.42',
    releaseSlug:    '20260519-nl-classifier-pipeline-100pct',
    title:          'Pipeline 100% operacional do classificador IA (cutover + rollback + UI)',
    summary:        'Resposta ao Renê: "faça o que tem de fazer pra ele funcionar 100%. nao quero o caminho mais curto". Reforços no classify-content-ai.js: COST CAP DIÁRIO (lê nl_ai_classifier_runs, exit 2 se estourado), AUDIT PER-DOC em ai_usage_logs, EXIT CODES SEMÂNTICOS (0/1/2/3). NOVO promote-ai-to-prod.js + workflow: cutover idempotente, filtro de confiança, backup automático em commercialPrev, confirmação "PROMOVER". NOVO rollback-ai-classification.js + workflow: reverte cutover, defesa missingBackup, filtro --since=, confirmação "REVERTER". Dashboard ganha sparkline temporal (3 linhas vs meta 90%), painel admin (3 botões pros workflows com semáforo), botões de decisão por divergência ("IA certa" / "regex certo" → grava extracted.humanDecision*). Concurrency lock em classify-content-ai.yml.',
    profile:        'feature',
    bucket:         'large',
    multiplierIds:  ['integration'],
    completedAt:    new Date('2026-05-20T00:30:00-03:00'),
    modules:        ['ai-hub', 'nl'],
  },
  // 4.49.43 — Test harness (61 testes)
  {
    releaseVersion: '4.49.43',
    releaseSlug:    '20260519-nl-classifier-test-harness',
    title:          'Test harness pra classify-content-ai (61 testes, 0 falhas)',
    summary:        'Resposta ao Renê: "testou a operacao dele (sem ativar a API, apenas verificando se ele trabalha, de fato)?" — não tinha testado além de node --check. Refatoração: gate IS_CLI separa execução CLI de require pra testes; exporta helpers puros. Test harness classify-content-ai.test.js (61 testes em 8 áreas): parseClaudeJson (6), validateOutput (8), buildPayload (7), shouldClassify (5), agentVersion (5), estimateRunCostUsd (5), fluxo integrado (4), E2E simulado (4). Workflow CI ganha step "Run smoke tests" ANTES da chamada Claude — se algum refactor quebrar helpers, falha rápido sem queimar tokens. Edge cases manuais validados (aspas curvas, emoji, multi-linha).',
    profile:        'feature',
    bucket:         'medium',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-20T01:15:00-03:00'),
    modules:        ['ai-hub', 'nl'],
  },
  // 4.49.44 — Security audit bank-grade
  {
    releaseVersion: '4.49.44',
    releaseSlug:    '20260519-security-audit-fixes',
    title:          'Security audit bank-grade — 2 CRITICAL + 2 HIGH corrigidos',
    summary:        'Resposta ao Renê: "acho prudente fazer uma auditoria em segurança pra cobrir possiveis, com nivel de exigencia de um banco". 10 findings (2 CRITICAL, 2 HIGH, 3 MEDIUM, 3 INFO). 🔴 CRITICAL #1: Firestore rules ausentes pra nl_ai_classifier_runs/promotions/rollbacks — default-deny travaria sparkline. Fix: regras append-only via Admin SDK. 🔴 CRITICAL #6: shell injection em 3 workflows via inputs limit/since/confirmar interpolados em bash → exfiltração de FIREBASE_PRIVATE_KEY e ANTHROPIC_API_KEY. Fix em 4 camadas: inputs via env, set -euo pipefail, allowlist regex, bash arrays. 🟠 HIGH #2: decision buttons sem gate de permissão. 🟠 HIGH #5: workflows sem permissions: contents: read. 🟡 MEDIUMs (PII htmlText, prompt injection insider, pinning @v4) documentados em SECURITY-AUDIT-2026-05-19.md.',
    profile:        'security',
    bucket:         'medium',
    multiplierIds:  ['security', 'investigation'],
    completedAt:    new Date('2026-05-20T02:00:00-03:00'),
    modules:        ['nl', 'security'],
  },
  // 4.49.45 — Regression review (não quebrar login)
  {
    releaseVersion: '4.49.45',
    releaseSlug:    '20260519-regression-defensiveness',
    title:          'Regression review — blindar shadow block contra erros locais',
    summary:        'Resposta ao Renê: "vc testou se tudo isso nao prejudicou alguma funcionalidade do sistema? da ultima vez travou o login...". 8 verificações sistemáticas: node --check em 5 módulos, imports resolvidos (6/6), store.isMaster() e store.can() confirmados, firestore.rules com braces balanceadas (226=226) e users/roles intactos, CSP só adicionou hosts, seedDefaultAgents com try/catch isola falhas, MODULE_REGISTRY com fallback, test harness 61/61. 1 risco real encontrado: renderShadowModeBlock dentro de template literal sem try/catch local — se exception, root.innerHTML inteiro falharia → toda aba "Conteúdo & Temas" vazia. Fix em 2 camadas: IIFE try/catch no template + .catch() em wireShadowModeDrill() async. Login verificado intacto.',
    profile:        'bugfix',
    bucket:         'small',
    multiplierIds:  ['investigation'],
    completedAt:    new Date('2026-05-20T02:30:00-03:00'),
    modules:        ['nl'],
  },
];

async function upsert(entry) {
  const humanHrs = calcHumanHours(entry.bucket, entry.multiplierIds);
  const adjusted = Math.max(0.1, +(humanHrs * AI_ASSIST).toFixed(2));
  const cost     = +(adjusted * HOURLY_RATE).toFixed(2);
  const breakdown = suggestBreakdown(adjusted, entry.profile);

  const payload = {
    entryType:      'release',
    releaseVersion: entry.releaseVersion,
    releaseSlug:    entry.releaseSlug,
    phaseLabel:     null,
    title:          entry.title,
    summary:        entry.summary,
    commits:        [],
    phaseCommitsCount: null,
    filesChanged:   0,
    linesAdded:     0,
    linesRemoved:   0,
    startedAt:      null,
    completedAt:    admin.firestore.Timestamp.fromDate(entry.completedAt),
    bucket:         entry.bucket,
    basePoint:      null,
    multipliers:    entry.multiplierIds.map(id => ({ id, value: MULTIPLIERS[id] })),
    humanEquivalentHours: humanHrs,
    aiAssistanceMultiplier: AI_ASSIST,
    totalHours:     adjusted,
    hourlyRate:     HOURLY_RATE,
    totalCost:      cost,
    hoursByCategory: breakdown,
    notes:          '',
    confidenceLevel:'medium',
    profile:        entry.profile,
    modules:        entry.modules || undefined,
    status:         'approved',
    approvedAt:     FV.serverTimestamp(),
    approvedBy:     { uid: 'system-backfill', name: 'Backfill v4.49.45 — sprint shadow mode IA' },
    rejectedAt:     null,
    rejectedBy:     null,
    createdAt:      FV.serverTimestamp(),
    createdBy:      'system-backfill',
    updatedAt:      FV.serverTimestamp(),
    updatedBy:      'system-backfill',
  };
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

  const snap = await db.collection(COLLECTION)
    .where('releaseVersion', '==', entry.releaseVersion)
    .where('entryType', '==', 'release')
    .limit(1).get();

  if (!snap.empty) {
    const id = snap.docs[0].id;
    await db.collection(COLLECTION).doc(id).set(payload, { merge: false });
    return { action: 'updated', id, hrs: adjusted, cost };
  }
  const ref = await db.collection(COLLECTION).add(payload);
  return { action: 'created', id: ref.id, hrs: adjusted, cost };
}

(async () => {
  console.log(`\n📦 Backfill dev_hours: ${ENTRIES.length} releases (4.49.32 → 4.49.45)\n`);
  console.log(`   Sprint do classificador IA de newsletters (shadow mode pipeline)\n`);
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
