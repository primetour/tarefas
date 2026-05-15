/**
 * Adiciona entradas de dev_hours pras releases 4.40.8 -> 4.40.18.
 * Trabalho concentrado em 2026-05-15.
 * Tema do dia: filtros stale, observers, hierarquia de acesso (analista),
 * notif duplication fix, portal-tips inline category, custom segments.
 * Idempotente: upserta por releaseVersion.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const HOURLY_RATE = 150;
const AI_MULT = 0.50;

const RELEASES = [
  {
    releaseVersion: '4.40.8',
    releaseSlug:    '20260515-goal-link-squad-sync',
    title:          'taskModal: filtros do goal-link sincronizam com squads atuais',
    summary:        'Bug reportado pelo user: dropdown "Todos os squads" no modal de Vincular Metas mostrava lista capturada em closure no momento que o taskModal era construído. Se uma squad fosse criada/renomeada/arquivada depois disso, a dropdown ficava desatualizada. Fix: respSet/gestorSet/squadSet viram let + função _rebuildFilterSets() que lê live de store.get(userWorkspaces) e store.get(users). openMetaModal() vira async com loadUserWorkspaces() pra refetch antes de abrir.',
    bucket:         'small',
    multiplierIds: ['investigation'],
    profile:        'bugfix',
    humanHours:     1.0,
    completedAt:    new Date('2026-05-15T10:00:00-03:00'),
  },
  {
    releaseVersion: '4.40.9',
    releaseSlug:    '20260515-goal-link-all-squads',
    title:          'task-modal: dropdown de squads no goal-link reflete TODAS as squads ativas',
    summary:        'Iteração do 4.40.8: comprovado via Chrome MCP que sistema tem 6 squads ativas mas dropdown mostrava só 2 (as que tinham goal escopo=squad vinculada). User esperava ver TODAS. Fix: _rebuildFilterSets() agora popula squadSet com TODAS as workspaces ativas (archived !== true) do store.userWorkspaces, antes de iterar goals. Goals com squadId órfão (squad arquivada com goal ativo) também entram.',
    bucket:         'small',
    multiplierIds: [],
    profile:        'feature',
    humanHours:     0.5,
    completedAt:    new Date('2026-05-15T10:45:00-03:00'),
  },
  {
    releaseVersion: '4.40.10',
    releaseSlug:    '20260515-stale-filters-sweep',
    title:          'sweep de filtros stale em projects/users/goals/feedbacks',
    summary:        'Após o fix do goal-link em taskModal, investigação revelou o mesmo anti-pattern de "lista capturada em closure ao boot, sem refresh na abertura do modal" em outros 4 lugares. (1) projects.js openProjectModal: squads + users só re-fetchados se store vazio → squad nova não aparecia. (2) users.js openUserModal: module-level users/availableRoles populados uma vez no mount, role nova em outra aba não aparecia (modal virou async). (3) goals.js openGoalForm: allUsers cacheado só se vazio, mudança de role analista→coordenador não refletia em dropdown de Gestor. (4) feedbacks.js ensureUsers: refetch sempre em vez de só-se-vazio. Padrão consistente: fetchUsers({force:true}) + loadUserWorkspaces() na abertura, com try/catch e fallback ao store.',
    bucket:         'medium',
    multiplierIds: ['investigation'],
    profile:        'bugfix',
    humanHours:     2.5,
    completedAt:    new Date('2026-05-15T12:30:00-03:00'),
  },
  {
    releaseVersion: '4.40.11',
    releaseSlug:    '20260515-tasks-observer-filter',
    title:          'tasks: filtro por observadores no toolbar de /tasks',
    summary:        'State filterObserver já existia (consumido via deep-link de Meu Painel) mas não tinha UI de toolbar. Adicionada como multi-select igual ao filtro de Responsável. Novo botão 👁 "Todos os observadores" entre Responsável e Prazo. bindMultiOptionPicker: usa lista de users.active com ícone 👁 e cor azul (#0EA5E9). applyFilters aceita filterObserver como string | string[]; lógica OR. Default visibility true; user pode ocultar via config modal.',
    bucket:         'small',
    multiplierIds: [],
    profile:        'feature',
    humanHours:     1.0,
    completedAt:    new Date('2026-05-15T13:15:00-03:00'),
  },
  {
    releaseVersion: '4.40.12',
    releaseSlug:    '20260515-notif-duplication-fix',
    title:          'notifs: para duplicação cross-user em scheduler client-side',
    summary:        'Diagnóstico via Chrome MCP no inbox do Renê: 50 notifs, TODAS corretamente endereçadas a ele (recipientId == uid), mas mesma tarefa aparecia 5x com 5 actorNames diferentes (Gabrielle, Rafaela, Vivian, Tamiris, Admin). Causa: notificationScheduler.js roda CLIENT-SIDE em cada browser. Cada user que abria o app iterava TODAS as tarefas visíveis e chamava notify(recipientIds=[creator, ...assignees]) — escrita N vezes no Firestore. Fix: checkDeadlines() filtra tasks onde myUid é creator/assignee/observer; recipientIds vira [myUid]. Scheduler de N users = N notifs (1 por user com skin in game). Outros schedulers já estavam OK.',
    bucket:         'medium',
    multiplierIds: ['investigation'],
    profile:        'bugfix',
    humanHours:     2.0,
    completedAt:    new Date('2026-05-15T14:30:00-03:00'),
  },
  {
    releaseVersion: '4.40.13',
    releaseSlug:    '20260515-observer-filter-everywhere',
    title:          'filterBar: filtro "observador" em Steps, Calendário e Timeline',
    summary:        'Estende o filtro de observers (4.40.11) pro componente compartilhado filterBar.js usado por kanban (steps), calendar e timeline. observerOpts() helper com ícone 👁 e cor azul; bindMultiOptionPicker pro fb-observer-btn; buildFilterFn aceita state.observer como string | string[] com lógica OR contra task.observers[]; EMPTY_LABELS + show array expandido. Ativado em cada page (kbFilterState, calFilterState, tlFilterState com observer:null + show array incluindo "observer").',
    bucket:         'small',
    multiplierIds: [],
    profile:        'feature',
    humanHours:     1.0,
    completedAt:    new Date('2026-05-15T15:30:00-03:00'),
  },
  {
    releaseVersion: '4.40.14',
    releaseSlug:    '20260515-popup-stacking-hierarchy-access',
    title:          'UX+RBAC: popup empilhado + hierarquia metas/feedbacks pra analista',
    summary:        'Duas frentes na mesma release. (1) POPUP STACKING: relato "fechar exige 2-3 cliques" comprovado via Chrome MCP — 3 cliques no "+ Novo" reminder criavam 6 backdrops. Fix tripla: modal.open dedupeKey, .onclick em vez de addEventListener (idempotente), showCompletionModal cleanup. (2) HIERARQUIA: /goals ganhou filtro hierárquico (master/goals_manage vê tudo; demais via getVisibleUserIds + gestorId/respIds/global). /feedbacks: botões edit/del gateados por feedback_create (analista vê só 👁); tabs dashboard/schedule/import só pra gestores. Role member: feedback_view: false → true.',
    bucket:         'medium',
    multiplierIds: ['security'],
    profile:        'feature',
    humanHours:     3.0,
    completedAt:    new Date('2026-05-15T17:00:00-03:00'),
  },
  {
    releaseVersion: '4.40.15',
    releaseSlug:    '20260515-goals-squad-membership',
    title:          'goals: analista vê metas de squad/núcleo/área onde é membro',
    summary:        'Extensão do filtro hierárquico (4.40.14): antes só pegava metas onde o user era gestor ou estava em respIds. Analista de squad "Comunicação" não via meta com escopo=squad da Comunicação se não estivesse listado em respIds explicitamente. Agora o filtro aceita: escopo=squad + g.squadId em myWorkspaceIds, escopo=nucleo + g.nucleo em myProfile.nucleos, escopo=area + g.setor em myVisibleSectors, escopo=global (já existia). Validado live com 4 analistas reais: 0→1 meta cada.',
    bucket:         'small',
    multiplierIds: [],
    profile:        'feature',
    humanHours:     1.0,
    completedAt:    new Date('2026-05-15T17:45:00-03:00'),
  },
  {
    releaseVersion: '4.40.16',
    releaseSlug:    '20260515-cc-virtuals-respect-type-filter',
    title:          'content-calendar: agenda prévia (virtuals) só com tipos selecionados',
    summary:        'Bug visual reportado: filtrando apenas por PROJETO (Instagram PRIMETOUR + ICs) sem selecionar tipos, o calendário mostrava slots virtuais de TODOS os tipos usados pelas tarefas dos projetos (Newsletter, Post etc) — user esperava nada (header diz "TIPOS: Nenhum — adicione pra ver agenda prévia"). Causa em generateVirtualSlots: fallback legacy "se !restricted, mostra tipos em usedTypeIds". Fix: virtuais APENAS quando há tipos explicitamente selecionados (return [] se visibleTaskTypes vazio/null). Alinha código com a promessa da UI.',
    bucket:         'trivial',
    multiplierIds: [],
    profile:        'bugfix',
    humanHours:     0.5,
    completedAt:    new Date('2026-05-15T18:30:00-03:00'),
  },
  {
    releaseVersion: '4.40.17',
    releaseSlug:    '20260515-portal-add-category-inline',
    title:          'portal-tips: "+ Nova categoria" inline no dropdown do segmento',
    summary:        'User pediu pra poder adicionar categorias inline no editor de Dicas (em vez de só usar categorias pré-cadastradas em Restaurantes/Atrações/etc). Opção "+ Nova categoria…" como última do <select>; click → prompt → cria via saveCategories (Firestore portal_categories) → adiciona na lista local + seleciona na hora. Compatibilidade com TODOS os 4 exporters (DOCX/PDF/PPTX/Web) já existia porque item.categoria é lido como string livre — sem allowlist. Validado E2E com criação + cleanup no Firestore real.',
    bucket:         'medium',
    multiplierIds: [],
    profile:        'feature',
    humanHours:     2.0,
    completedAt:    new Date('2026-05-15T20:00:00-03:00'),
  },
  {
    releaseVersion: '4.40.18',
    releaseSlug:    '20260515-portal-custom-segments',
    title:          'portal-tips: segmentos custom (admin cria além dos 11 builtin)',
    summary:        'Iteração do 4.40.17: agora user pode criar SEGMENTOS novos (não só categorias dentro de segmentos). Service: DEFAULT_SEGMENTS + portal_segments collection com CRUD (fetchCustomSegments, saveCustomSegment, deleteCustomSegment, slugifySegmentKey). getSegments({force}) async com cache 60s. Editor: _allSegments mutável, botão "+ Novo segmento" no fim do nav, modal com nome + modo (place_list/simple_list/agenda). Generators: SEGMENTS local virou let + _loadSegmentsAsync() chamado no entry de generateTip — DOCX/PDF/PPTX já dispatchavam por segDef.mode. Web view (portal-view.html): fetch de portal_segments no startup + renderSeg() agora dispatcha por mode (não key). Firestore rules: /portal_segments com read público + write admin (deployed). Validado E2E (create→merge→cleanup) + UI live.',
    bucket:         'large',
    multiplierIds: ['migration'],
    profile:        'feature',
    humanHours:     4.5,
    completedAt:    new Date('2026-05-15T22:00:00-03:00'),
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
  console.log(`Seeding ${RELEASES.length} releases (4.40.8-18)...\n`);
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
