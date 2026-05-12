/**
 * Adiciona entradas de dev_hours pras releases 4.35.4 -> 4.35.23.
 * Trabalho concentrado entre 2026-05-09 e 2026-05-11.
 * Idempotente: upserta por releaseVersion.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const HOURLY_RATE = 150;
const AI_MULT = 0.50;

const RELEASES = [
  {
    releaseVersion: '4.35.4',
    releaseSlug:    '20260509-docs-update',
    title:          'Atualizacao do doc tecnico com 4.35.x e sistema de horas dev',
    summary:        'Atualizacao retroativa do ARCHITECTURE.md, DEV-HOURS.md e ONBOARDING.md cobrindo as 4 releases do dia (4.35.0-3): CSAT projeto-level, Governanca, formato HH:MM, "Ver mais" em descricoes e modulo System Feedback. Inclui novos diagramas de fluxo do trigger Eventarc + Microsoft Graph email.',
    bucket:         'trivial',
    multiplierIds: [],
    profile:        'docs',
    humanHours:     1.0,
    completedAt:    new Date('2026-05-09T15:00:00-03:00'),
  },
  {
    releaseVersion: '4.35.5',
    releaseSlug:    '20260511-dashboards-filter-fix',
    title:          'Filtro por periodo realmente filtra tudo no dashboard',
    summary:        'Bug: filtro de periodo no /dashboards aplicava apenas em alguns cards (tarefas concluidas) mas KPIs de tempo medio, ranking e graficos ignoravam. Refator do calculo pra passar dateRange consistente em todas as queries. Adicionado fallback pra "ultimos 30 dias" quando sem filtro.',
    bucket:         'small',
    multiplierIds: [],
    profile:        'bugfix',
    humanHours:     1.2,
    completedAt:    new Date('2026-05-11T08:30:00-03:00'),
  },
  {
    releaseVersion: '4.35.6',
    releaseSlug:    '20260511-photos-upload-manual',
    title:          'Logs verbose + upload manual de fotos no /profile',
    summary:        'Investigacao + fix: fotos SSO Microsoft as vezes nao sincronizavam por falha de scope Graph. Adicionado upload manual no /profile (drag&drop + crop) como fallback + logs verbose no fetch Graph pra diagnostico.',
    bucket:         'small',
    multiplierIds: ['investigation'],
    profile:        'bugfix',
    humanHours:     1.0,
    completedAt:    new Date('2026-05-11T09:30:00-03:00'),
  },
  {
    releaseVersion: '4.35.7',
    releaseSlug:    '20260511-portal-tips-fix',
    title:          'Fix updatePreview() ReferenceError em portal-tips',
    summary:        'Erro inline: funcao updatePreview() chamada mas declarada fora de escopo apos refactor de modulos. Movido pra IIFE compartilhada + binding correto.',
    bucket:         'trivial',
    multiplierIds: [],
    profile:        'bugfix',
    humanHours:     0.3,
    completedAt:    new Date('2026-05-11T10:00:00-03:00'),
  },
  {
    releaseVersion: '4.35.8',
    releaseSlug:    '20260511-goals-cc-presets-cross-squad',
    title:          'Metas visiveis em tarefas + CC presets + projetos cross-squad',
    summary:        'Tres pedidos do user em uma release: (1) metas do user agora sao visiveis no contexto da tarefa pra dar feedback no momento. (2) Calendario de Conteudo ganhou presets de tipo (Reels, Carrossel, Story) salvos por usuario. (3) Projetos agora podem ter setores multiplos (cross-squad) — antes era 1:1.',
    bucket:         'medium',
    multiplierIds: [],
    profile:        'feature',
    humanHours:     2.5,
    completedAt:    new Date('2026-05-11T11:00:00-03:00'),
  },
  {
    releaseVersion: '4.35.9',
    releaseSlug:    '20260511-team-availability-nav',
    title:          'Disponibilidade da equipe: navegacao prev/next month',
    summary:        'Pagina /team-availability so mostrava o mes corrente. Adicionado botoes < > pra navegar prev/next month + indicador "Mes X de Y". Query re-fetch ao trocar.',
    bucket:         'trivial',
    multiplierIds: [],
    profile:        'feature',
    humanHours:     0.5,
    completedAt:    new Date('2026-05-11T11:30:00-03:00'),
  },
  {
    releaseVersion: '4.35.10',
    releaseSlug:    '20260511-cc-types-by-category',
    title:          'CC: tipos por categoria + scheduleSlots-only',
    summary:        'Calendario de Conteudo: tipos de conteudo agora sao filtrados pela categoria selecionada (Reels e Story so em "videos", carrossel em "fotos"). Listagem agora consulta apenas scheduleSlots (removida coleca legacy contentItems).',
    bucket:         'small',
    multiplierIds: [],
    profile:        'feature',
    humanHours:     0.8,
    completedAt:    new Date('2026-05-11T12:00:00-03:00'),
  },
  {
    releaseVersion: '4.35.11',
    releaseSlug:    '20260511-cc-home-by-type',
    title:          'CC home: eixo-TIPO com cards por categoria',
    summary:        'Reorganizacao da home do Calendario de Conteudo: em vez de listar slots por data, agora mostra cards agrupados por tipo de conteudo (videos, fotos, copy) com KPIs e ultimos slots. Click expande pra view detalhada.',
    bucket:         'medium',
    multiplierIds: [],
    profile:        'feature',
    humanHours:     2.0,
    completedAt:    new Date('2026-05-11T12:45:00-03:00'),
  },
  {
    releaseVersion: '4.35.12',
    releaseSlug:    '20260511-cc-chips-no-accounts',
    title:          'CC: chips removiveis + sem accounts no header + sem projeto na home',
    summary:        'Tres polishes no CC: (1) chips de filtro agora tem botao X pra remover individualmente. (2) Header simplificado: removido seletor de account (irrelevante pra maioria). (3) Home nao exige projeto selecionado pra renderizar (antes travava com aviso).',
    bucket:         'small',
    multiplierIds: [],
    profile:        'bugfix',
    humanHours:     0.6,
    completedAt:    new Date('2026-05-11T13:15:00-03:00'),
  },
  {
    releaseVersion: '4.35.13',
    releaseSlug:    '20260511-cc-dynamic-meta',
    title:          'CC Fase 2: meta dinamica com CRUD Firestore',
    summary:        'Metas do Calendario de Conteudo agora sao configuraveis: coleca content_meta_settings com docs por projeto + setor + ano-mes. CRUD na UI (modal). Calculo de progress KPI usa meta efetiva (override > setor > default). Migration script pra preencher 3 meses retroativos.',
    bucket:         'medium',
    multiplierIds: ['migration'],
    profile:        'feature',
    humanHours:     3.5,
    completedAt:    new Date('2026-05-11T14:30:00-03:00'),
  },
  {
    releaseVersion: '4.35.14',
    releaseSlug:    '20260511-modal-z-index',
    title:          'Fix z-index stacking pra modais aninhados',
    summary:        'Modal dentro de modal (ex: editar slot CC dentro do modal de projeto) ficava atras do backdrop pai. Refator do z-index manager: cada modal abre com z atual+10 + restaura on close. Tooltip Portal/dropdowns tambem subiram pra ficar sempre top.',
    bucket:         'small',
    multiplierIds: ['investigation'],
    profile:        'bugfix',
    humanHours:     0.8,
    completedAt:    new Date('2026-05-11T15:00:00-03:00'),
  },
  {
    releaseVersion: '4.35.15',
    releaseSlug:    '20260511-emoji-picker-shared',
    title:          'Picker de emoji compartilhado',
    summary:        'Componente emojiPicker.js: grid de 200+ emojis + busca + recent. Reusado em (1) campos de notas de tarefa, (2) titulos de projeto, (3) presets CC, (4) reactions de feedback. Persistencia de recent no localStorage por user.',
    bucket:         'small',
    multiplierIds: [],
    profile:        'feature',
    humanHours:     1.2,
    completedAt:    new Date('2026-05-11T15:45:00-03:00'),
  },
  {
    releaseVersion: '4.35.16',
    releaseSlug:    '20260511-cc-dynamic-categories',
    title:          'CC: categorias dinamicas + projeto no form + layout',
    summary:        'Categorias do CC saem da coleca content_categories (CRUD admin) em vez de hardcoded. Form de criacao agora exige seleca de projeto (estava opcional, causando orfaos). Layout do header reorganizado.',
    bucket:         'medium',
    multiplierIds: ['migration'],
    profile:        'feature',
    humanHours:     2.5,
    completedAt:    new Date('2026-05-11T16:30:00-03:00'),
  },
  {
    releaseVersion: '4.35.17',
    releaseSlug:    '20260511-cc-subtitle-fullwidth',
    title:          'CC: subtitle em linha propria full-width',
    summary:        'Polish layout: subtitle "Calendario por projeto / setor" tava colado em um lado e cortava em viewports medias. Movido pra row propria full-width abaixo do title.',
    bucket:         'trivial',
    multiplierIds: [],
    profile:        'bugfix',
    humanHours:     0.25,
    completedAt:    new Date('2026-05-11T16:45:00-03:00'),
  },
  {
    releaseVersion: '4.35.18',
    releaseSlug:    '20260511-cc-header-5-rows',
    title:          'CC: header em 5 linhas separadas',
    summary:        'Reorganizacao final do header CC apos iteracoes 16-17: 5 rows distintas (title, subtitle, toolbar, projetos-row, filtros-row). CSS grid limpo, sem overflow.',
    bucket:         'trivial',
    multiplierIds: [],
    profile:        'bugfix',
    humanHours:     0.4,
    completedAt:    new Date('2026-05-11T17:00:00-03:00'),
  },
  {
    releaseVersion: '4.35.19',
    releaseSlug:    '20260511-cc-types-inline-projects-toolbar',
    title:          'CC: tipos inline + projetos acima da toolbar + sync chips',
    summary:        'Mais polishes do CC: (1) selecao de tipos de conteudo agora aparece inline no card em vez de modal. (2) Lista de projetos movida pra acima da toolbar. (3) Chips de filtro sincronizam com URL params pra deep-link.',
    bucket:         'small',
    multiplierIds: [],
    profile:        'feature',
    humanHours:     1.0,
    completedAt:    new Date('2026-05-11T17:30:00-03:00'),
  },
  {
    releaseVersion: '4.35.20',
    releaseSlug:    '20260511-cc-remove-no-project-warning',
    title:          'CC: remove aviso "sem projeto", projeto fica obrigatorio',
    summary:        'Aviso "selecione projeto" era ruido — agora o campo projeto e required no form de criar slot e o aviso some. Validacao client + Firestore rule.',
    bucket:         'trivial',
    multiplierIds: [],
    profile:        'bugfix',
    humanHours:     0.3,
    completedAt:    new Date('2026-05-11T17:45:00-03:00'),
  },
  {
    releaseVersion: '4.35.21',
    releaseSlug:    '20260511-hierarchy-manager-feedbacks',
    title:          'Hierarchy: managerId em users + filtro hierarquico em feedbacks',
    summary:        'Estrutura organizacional formalizada: campo managerId no doc user. Helpers getDirectReports, getSubordinatesTree, getVisibleUserIds, isValidManagerAssignment (evita ciclos). UI no /users com dropdown pra atribuir manager. Pagina /feedbacks agora filtra por hierarquia: manager ve apenas feedbacks de subordinados diretos+indiretos. Audit log das mudancas.',
    bucket:         'large',
    multiplierIds: ['security'],
    profile:        'feature',
    humanHours:     5.0,
    completedAt:    new Date('2026-05-11T19:30:00-03:00'),
  },
  {
    releaseVersion: '4.35.22',
    releaseSlug:    '20260511-csat-setor-overrides-guards-diff',
    title:          'CSAT por setor + permission overrides por user + route-guards + audit diff',
    summary:        'Quatro entregas na mesma release: (1) CSAT agora filtra por SETOR (nao user) usando getVisibleSectors — manager ve surveys dos setores que reportam pra ele. (2) Sistema de permission overrides por user: 192 botoes (64 perms x 3 estados allow/deny/inherit) na UI de /users, persistido em user.permissionOverrides, store.can() respeita override. (3) RouteGuard() helper aplicado em 5 paginas (tasks, kanban, timeline, calendar, requests) pra blindar deep-link sem permissao. (4) Audit log com diff before/after no user.update.',
    bucket:         'large',
    multiplierIds: ['security'],
    profile:        'feature',
    humanHours:     6.0,
    completedAt:    new Date('2026-05-11T21:00:00-03:00'),
  },
  {
    releaseVersion: '4.35.23',
    releaseSlug:    '20260511-anthropic-server-side-vision-web',
    title:          'IA Hub: Anthropic server-side via Cloud Function + vision + web search nativo',
    summary:        'IA Hub elevado a padrao exemplar e seguro. (1) Key Anthropic movida pro Secret Manager do GCP — browser nunca ve a key. Cloud Function callLLM e a unica porta de entrada. Removido o header anthropic-dangerous-direct-browser-access do caminho produtivo. (2) Vision multimodal: callAnthropic aceita attachments (image blocks ou data-URI base64), aiPanel agora envia imagens anexadas como image blocks pros modelos. (3) Web search nativo Anthropic (web_search_20250305) habilitado via flag webSearch — substitui pre-fetch Serper quando provider=anthropic. (4) runAgent propaga attachments+webSearch ate a Cloud Function. (5) resolveApiKey ignora checagem de key local pra anthropic em todos os caminhos. (6) Smoke tests CLI (text + vision + web search) + smoke tests browser via runAgent: todos verde. (7) CHANGELOG + version bump 4.35.23.',
    bucket:         'large',
    multiplierIds: ['security', 'integration'],
    profile:        'feature',
    humanHours:     7.0,
    completedAt:    new Date('2026-05-11T23:30:00-03:00'),
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
  console.log(`Seeding ${RELEASES.length} releases (4.35.4-23)...\n`);
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
