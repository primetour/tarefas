/**
 * Backfill dev_hours: releases 4.49.13 → 4.49.22 (19/05/2026).
 *
 * Sprint denso de bugfixes operacionais + 1 feature (Meu Calendário).
 * Tudo entrou aprovado direto (rodando como master via ADC).
 *
 * Idempotente: usa releaseVersion como chave. Reaplica → faz upsert.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const HOURLY_RATE   = 150;
const AI_ASSIST     = 0.50;          // 4.35+ recalibragem (era 0.40)
const COLLECTION    = 'dev_hours';

// Mesma logic de calcHoursFromBucket em js/services/devHours.js
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
  // Aproximação dos ratios de suggestCategoryBreakdown
  // (refinamento, desenvolvimento, testes, documentacao, implantacao)
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
  // Implantação fecha a soma pra evitar drift de arredondamento
  const r5 = +(totalHours - r1 - r2 - r3 - r4).toFixed(2);
  return {
    refinamento: r1, desenvolvimento: r2, testes: r3,
    documentacao: r4, implantacao: r5,
  };
}

const ENTRIES = [
  // ───────────────────────────────────────────────
  // 4.49.13 — Portal de Dicas: pacote de fixes + DOCX import
  {
    releaseVersion: '4.49.13',
    releaseSlug:    '20260519-portal-tips-fixes',
    title:          'Portal de Dicas: 3 bugs + 2 features (categorias modal, themeDesc como conteúdo, PDF/DOCX import)',
    summary:        'B1: botão "🏷 Categorias" no header de cada painel (place_list/agenda) → modal CRUD dedicado, sem precisar adicionar item primeiro. B2: segHasContent passa a aceitar themeDesc/periodoAgenda como conteúdo válido (segmentos só-texto não sumiam mais ao salvar). B3: parser PDF dá erro claro quando filename foge do formato + aviso destacado na UI. F4: campo internalNotes na dica (futuro contexto IA). F5: import via .docx (mammoth.js on-demand, mesmo pipeline do PDF via linesToRows extraído como helper). Audit refinado: detecta store.can?.() e nav-data (perm/altPerm).',
    profile:        'feature',
    bucket:         'large',
    multiplierIds:  ['investigation', 'integration'],
    completedAt:    new Date('2026-05-19T13:00:00-03:00'),
    modules:        ['portal'],
  },
  // 4.49.14 — Analista ganha dashboard do Portal de Dicas
  {
    releaseVersion: '4.49.14',
    releaseSlug:    '20260519-analista-portal-dashboard',
    title:          'Libera dashboard_portal_view pro Analista (operação diária do consultor)',
    summary:        'rbac.js: member.dashboard_portal_view: false→true. Demais dashboards executivos (productivity, roteiros, csat) seguem restritos a coord+. Migração Firestore (functions/align-analista-portal-dashboard.cjs) — role tinha customizedPermissions=true, init não sobrescreve. Wiring já estava: store.canViewPortalDashboard(), sidebar gated, guard em portalDashboard.js, chip em dashboard.js.',
    profile:        'bugfix',
    bucket:         'small',
    multiplierIds:  ['migration'],
    completedAt:    new Date('2026-05-19T13:30:00-03:00'),
  },
  // 4.49.15 — Meu Calendário (versão inicial, mini-mês)
  {
    releaseVersion: '4.49.15',
    releaseSlug:    '20260519-meu-calendario-dashboard',
    title:          'Meu Calendário no Meu Painel — mini-mês com tarefas do user',
    summary:        'Bloco "📅 Meu Calendário" abaixo de Minhas Tarefas (coluna esquerda virou flex vertical). Mini-mês 6×7 com até 3 dots por dia (cores por status: a fazer/em andamento/revisão/retrabalho/concluída). Click no dia abre lista inline. Botões prev/today/next + link "Agenda completa →". Zero query extra: reusa myTasks já fetchado pelo render principal.',
    profile:        'feature',
    bucket:         'medium',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-19T14:00:00-03:00'),
  },
  // 4.49.16 — Meu Calendário virou agenda acionável
  {
    releaseVersion: '4.49.16',
    releaseSlug:    '20260519-meu-calendario-agenda',
    title:          'Meu Calendário reformulado: agenda primeiro, mini-mês colapsável',
    summary:        'Feedback: "só dots não diz o que eu tenho que fazer". Reformulação: card mostra primeiro lista de próximos 14 dias com TÍTULO de cada tarefa. Em atraso no topo (borda vermelha). Hoje/Amanhã em destaque. Click na tarefa → taskModal. Resumo no header. Mini-mês fica colapsado por padrão (lazy render). Empty state honesto sobre dependência de dueDate.',
    profile:        'feature',
    bucket:         'medium',
    multiplierIds:  ['investigation'],
    completedAt:    new Date('2026-05-19T14:30:00-03:00'),
  },
  // 4.49.17 — Calendário no topo + filtro tipo harmonizado
  {
    releaseVersion: '4.49.17',
    releaseSlug:    '20260519-calendar-up-filters-type',
    title:          'Meu Calendário sobe pro topo (sempre aberto) + filtro Tipo nas 4 views',
    summary:        'Layout: Meu Calendário antes de Minhas Tarefas, mini-mês sempre visível (toggle removido), tooltip nas células com títulos das tarefas do dia (até 5 + "+N"). Filtros: sentinel TYPE_NONE_SENTINEL ("Sem tipo") em filterBar.js (afeta kanban/calendar/timeline). tasks.js ganhou filtro tipo (estava ausente): picker com busca + opção "∅ Sem tipo", persiste em tasks.filterValues.v1, visível por padrão.',
    profile:        'feature',
    bucket:         'large',
    multiplierIds:  ['investigation'],
    completedAt:    new Date('2026-05-19T15:00:00-03:00'),
  },
  // 4.49.18 — Coerência dash produtividade ↔ #tasks
  {
    releaseVersion: '4.49.18',
    releaseSlug:    '20260519-dash-prod-coerencia',
    title:          'Dashboard ↔ #tasks: predicate "sem tipo" + filtro pending users + drill-down clicável',
    summary:        'User reportou: 122 sem tipo no dash vs 828 em #tasks. 2 fixes + 1 feature. Fix #1 (analytics.getProductivityByType): usava t.typeId || "__none__", ignorando legacy t.type. Agora t.typeId || t.type || "__none__" — mesmo critério do filtro __NONE__ em tasks.js. Fix #2 (getTasksByMember): filtra pendingSso:true e active:false por padrão. Aceita includeOrphans pra auditoria. Feature: dashboards.js torna rankings clicáveis (renderLeaderboard aceita href). tasks.js lê ?type, ?datePreset, ?from, ?to da URL.',
    profile:        'bugfix',
    bucket:         'large',
    multiplierIds:  ['investigation', 'integration'],
    completedAt:    new Date('2026-05-19T15:30:00-03:00'),
  },
  // 4.49.19 — Cola de coerência: activityInPeriod
  {
    releaseVersion: '4.49.19',
    releaseSlug:    '20260519-dash-prod-coerencia-fim',
    title:          'Cola de coerência: card BATE com lista (preset activityInPeriod)',
    summary:        'v4.49.18 trouxe deep-link mas usava datePreset=last30Days (semântica diferente de "ativa no período"). Novo preset activityInPeriod em tasks.js: filtra por createdAt OR completedAt no range — igual ao inPeriod() do dashboard. Deep-link envia ?datePreset=activityInPeriod&from=<ymd>&to=<ymd> com range exato do período ativo. URL params from/to reconhecidos no boot.',
    profile:        'bugfix',
    bucket:         'small',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-19T15:45:00-03:00'),
  },
  // 4.49.20 — Presets reorganizados: Em Jogo vs Atividade
  {
    releaseVersion: '4.49.20',
    releaseSlug:    '20260519-presets-atividade-vs-emjogo',
    title:          'Presets de prazo reorganizados em 3 famílias semânticas',
    summary:        'User: "Últimos 30 dias dá 825 em #tasks mas 129 no dash". Diagnóstico: o label engana — last30Days é "abertas + concluídas recentes" (workflow), não "atividade no período". Reorg em optgroup: 1) Por prazo (dueDate): hoje/amanhã/semana/mês/atrasadas/sem prazo. 2) Em jogo (workflow): "Em jogo · 30d/90d". 3) 📊 Atividade no período (KPI): 7d/30d/90d. Auto-range em activityIn{N}d (start = hoje - N+1 dias). Deep-link do dash usa preset nomeado.',
    profile:        'refactor',
    bucket:         'medium',
    multiplierIds:  ['investigation'],
    completedAt:    new Date('2026-05-19T16:30:00-03:00'),
  },
  // 4.49.21 — metaLinks segue responsável, não criador
  {
    releaseVersion: '4.49.21',
    releaseSlug:    '20260519-metalinks-segue-responsavel',
    title:          'BUG CRÍTICO: metaLinks segue o responsável, não o criador',
    summary:        'User (Diretoria): "quando crio tarefa, meta fica vinculada ao meu user, mesmo com outros como responsáveis". 3 causas combinadas: 1) auto-assign self pra TODO role (criador vira primeiro assignee → picker abre na aba dele); 2) trocar assignee não removia metaLinks órfãos; 3) prune ausente no save. Fix em 3 camadas: A) auto-assign condicional só pra member/partner; B) remover chip de assignee tira todos os links daquele uid; C) handleSave faz prune final (userId deve estar em assignees finais ou ser sentinel __task__). Testes: 14 unit + 2 end-to-end no Firestore real.',
    profile:        'bugfix',
    bucket:         'large',
    multiplierIds:  ['investigation'],
    completedAt:    new Date('2026-05-19T17:00:00-03:00'),
  },
  // 4.49.22 — Exports modulares: blocos vazios = ocultos
  {
    releaseVersion: '4.49.22',
    releaseSlug:    '20260519-exports-skip-vazios',
    title:          'Exports modulares: bloco vazio = oculto (Portal de Dicas + Roteiros)',
    summary:        'User: "vi roteiro com bloco vazio. Se está vazio, oculta. Idem portal — sistemas modulares". Portal (portalGenerator.js): buildContent ganha segHasContent — mesmo critério do editor v4.49.13 (place_list/agenda: items OU themeDesc OU periodoAgenda; simple_list: items OU themeDesc; special_info: qualquer campo do info). Afeta os 3 formatos (DOCX/PDF/PPTX). Roteiros (roteiroGenerator.js): 3 seções renderizavam título antes do check — VALORES (customRow com label sem value), SERVIÇOS OPCIONAIS (optionals com entries vazias), INFORMAÇÕES IMPORTANTES (customFields vazias). Fix: computa rows/sections primeiro, return cedo se vazio. 17 testes analíticos passando.',
    profile:        'bugfix',
    bucket:         'medium',
    multiplierIds:  ['pdf', 'investigation'],
    completedAt:    new Date('2026-05-19T17:30:00-03:00'),
    modules:        ['portal', 'roteiros'],
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
    approvedBy:     { uid: 'system-backfill', name: 'Backfill v4.49.22' },
    rejectedAt:     null,
    rejectedBy:     null,
    createdAt:      FV.serverTimestamp(),
    createdBy:      'system-backfill',
    updatedAt:      FV.serverTimestamp(),
    updatedBy:      'system-backfill',
  };
  // Remove undefined (Firestore não aceita)
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

  // Idempotência: busca por releaseVersion
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
  console.log(`\n📦 Backfill dev_hours: ${ENTRIES.length} releases (4.49.13 → 4.49.22)\n`);
  let totalH = 0, totalC = 0;
  for (const entry of ENTRIES) {
    const r = await upsert(entry);
    console.log(`  ${r.action === 'created' ? '+' : '~'} ${entry.releaseVersion.padEnd(8)} ${String(r.hrs).padStart(5)}h · R$ ${r.cost.toFixed(2).padStart(8)} · ${r.action}`);
    totalH += r.hrs;
    totalC += r.cost;
  }
  console.log(`\n  Total adicionado: ${totalH.toFixed(2)}h · R$ ${totalC.toFixed(2)}\n`);
  process.exit(0);
})();
