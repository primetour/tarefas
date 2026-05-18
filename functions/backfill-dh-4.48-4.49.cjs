/**
 * Backfill dev_hours entries pras releases 4.48.1 → 4.49.8 (12 releases).
 * Idempotente: usa findByVersion (skip se já existe).
 * Estimativas baseadas em bucket SemVer convencional + assistência IA × 0.5.
 *
 * Run: node functions/backfill-dh-4.48-4.49.cjs
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

const AI_MULT = 0.50;
const RATE = 150;

// helper: distribui horas em categorias por profile
function breakdown(totalHrs, profile = 'feature') {
  const ratios = {
    feature:  { refinamento: 0.20, desenvolvimento: 0.50, testes: 0.10, documentacao: 0.15, implantacao: 0.05 },
    bugfix:   { refinamento: 0.30, desenvolvimento: 0.40, testes: 0.15, documentacao: 0.10, implantacao: 0.05 },
    refactor: { refinamento: 0.15, desenvolvimento: 0.65, testes: 0.10, documentacao: 0.05, implantacao: 0.05 },
  };
  const r = ratios[profile] || ratios.feature;
  const out = {};
  let acc = 0;
  for (const k of Object.keys(r)) {
    out[k] = +(totalHrs * r[k]).toFixed(2);
    acc += out[k];
  }
  const diff = +(totalHrs - acc).toFixed(2);
  if (diff !== 0) out.desenvolvimento = +(out.desenvolvimento + diff).toFixed(2);
  return out;
}

// 18/05/2026 — fim do dia (commits foram durante o dia inteiro)
const COMPLETED = new Date('2026-05-18T22:00:00-03:00');

const ENTRIES = [
  {
    v: '4.48.1', slug: '20260518-jsdoc-fix',
    title: 'fix(areaTokens): jsdoc inline block comment quebrava parsing',
    summary: 'Correção crítica de parsing — comentário `/* */` dentro de `/** */` no js/services/areaTokens.js gerava SyntaxError "Unexpected token \'}\'" e travava o boot do app inteiro. Substituído por texto sem delimitadores.',
    bucket: 'trivial', basePoint: 0.4, profile: 'bugfix', modules: [],
  },
  {
    v: '4.48.2', slug: '20260518-dynamic-import-portalAreas',
    title: 'fix(app): dynamic import portalAreas pra parar loop de login',
    summary: 'Cascata de static imports quebrava boot quando portalAreas.js (cache stale) falhava. Conversão pra dynamic import isola a falha — initAuthObserver continua rodando mesmo se portalAreas não carregar.',
    bucket: 'small', basePoint: 1.0, profile: 'bugfix', modules: [],
  },
  {
    v: '4.48.3', slug: '20260518-cache-loop-prevention',
    title: 'fix(cache): prevenção definitiva de loop pós-deploy',
    summary: 'Meta http-equiv Cache-Control + Pragma no index.html + auto-reload version detector em preload.js. Browser sempre busca index.html fresh pós-deploy, e se versão mudou recentemente, força location.reload(true) UMA vez pra purgar cache stale dos módulos.',
    bucket: 'small', basePoint: 1.5, profile: 'feature', modules: [],
  },
  {
    v: '4.49.0', slug: '20260518-sprint7-tasks-filters-slots-dedup',
    title: 'Sprint 7 — 6 frentes: dedup user + filtros + tipos + persistência + slots conversion',
    summary: 'Sprint denso resolvendo 6 frentes simultâneas:\n• Item 6 (CRÍTICO): duplicação user SSO — firestore rule self-delete pending_* por email match + cleanup retroativo em todo login (auth.js). 5 docs (Bruno/Letícia/João/Thaís/Beatriz) limpos em prod.\n• Item 1: coluna Tipo/Etapa vazia — pageTaskTypes lookup por typeId/type/name com fallback legacy.\n• Item 3: tipos sumindo — removido filtro workspaceId em fetchTaskTypes (8 tipos voltam).\n• Item 2: busca no filtro de Projetos — bindOptionPicker em tasks.js.\n• Item 4: persistência de filtros — localStorage por página (tarefas/steps/calendario/timeline).\n• Item 5: Slots → Produtividade — fromSlot:{typeId,slotId,date} + widget "Conversão de Slots" no dashboard.',
    bucket: 'large', basePoint: 12, profile: 'feature', modules: [],
  },
  {
    v: '4.49.1', slug: '20260518-notif-deeplinks',
    title: 'feat(notifications): deep-link clicável → abre entity direto',
    summary: 'Notificações agora navegam pra entity específica em vez de só pra lista genérica. Helper deriveRouteForEntity(entityType,entityId) → rota fundo (ex: task → tasks?taskId=X auto-abre modal; project → projects?id=X auto-abre detalhe; goal → goals?id=X). Suporte a 12 entityTypes. URL params limpos via history.replaceState após abrir.',
    bucket: 'medium', basePoint: 5, profile: 'feature', modules: [],
  },
  {
    v: '4.49.2', slug: '20260518-roles-audit-destinos-perm',
    title: 'feat(roles): nova perm portal_destinations_manage + audit de permissions órfãs',
    summary: 'Auditoria completa do catálogo RBAC. Nova perm portal_destinations_manage (granular, liberada pro Analista) sem dar portal_manage. Wire de 23 perms órfãs (portal_areas_view/manage, requests_manage, ai_skills_manage, ai_dashboard_view) que estavam no catálogo mas não eram checadas no código. 3 novos helpers em store.js: canManageDestinations / canViewPortalAreas / canManagePortalAreas.',
    bucket: 'medium', basePoint: 4, profile: 'feature', modules: ['portal_dicas'],
  },
  {
    v: '4.49.3', slug: '20260518-filters-show-all-types-projects',
    title: 'fix(filters): filtros mostram TODOS os tipos e projetos',
    summary: 'Vários fixes simultâneos nos filtros: (1) removido filtro sector que escondia tipos no dropdown (timeline/kanban/calendar); (2) calendar usa fetchProjects local em vez de store.get vazio; (3) fetchProjects({allWorkspaces:true}) em tarefas/steps/timeline/calendar pra mostrar projetos cross-squad; (4) listing de tarefas continua filtrado por escopo do user.',
    bucket: 'medium', basePoint: 3, profile: 'bugfix', modules: [],
  },
  {
    v: '4.49.4', slug: '20260518-calendar-slot-filter-fix',
    title: 'fix(calendar): slots virtuais respeitam filtro de tipo + renderDay aplica buildFilterFn',
    summary: 'Bug em #calendar: ao selecionar tipo no filtro, slots virtuais (cards tracejados de scheduleSlots) ignoravam — mostrava de TODOS os tipos. Fix: getSlotsForDate(date,{typeId,sector}) recebe filtros do toolbar. Também: renderDay não aplicava buildFilterFn em modo standard (só checava pipelineTypeId). Validado live: 300→55 cards (-82%) com filtro Newsletter.',
    bucket: 'small', basePoint: 1.5, profile: 'bugfix', modules: [],
  },
  {
    v: '4.49.5', slug: '20260518-content-calendar-type-filter',
    title: 'fix(content-calendar): slots reais (do banco) respeitam filtro de tipo',
    summary: '3 slots fantasma ("Dia Nacional do Museu", "Dia dos Namorados", "Notícia") vazavam quando filtro de tipo estava ativo, porque slot real não tinha typeId direto. Fix: slotsForDate + renderListView agora checam visibleTaskTypes via task vinculada (_linkedTasks.get(slot.taskId).typeId).',
    bucket: 'small', basePoint: 1.0, profile: 'bugfix', modules: [],
  },
  {
    v: '4.49.6', slug: '20260518-segments-categories-perm',
    title: 'feat(roles): perm portal_segments_manage — Analista cria segmentos/categorias',
    summary: 'Nova perm portal_segments_manage liberada pro Analista (mesmo padrão de destinos). Wire em portal.js (saveCategories, saveCustomSegment, deleteCustomSegment) e portalTipEditor.js (botão "+ Novo segmento"). Helper canManagePortalSegments() no store. Propagada nos 6 roles em prod via updateDoc live.',
    bucket: 'small', basePoint: 1.0, profile: 'feature', modules: ['portal_dicas'],
  },
  {
    v: '4.49.7', slug: '20260518-destinations-bulk-import',
    title: 'feat(destinos): bulk import via Excel — wizard XLSX/CSV com preview',
    summary: 'Novo componente destinationsImport.js: wizard XLSX/XLS/CSV com lazy-load XLSX@0.18.5, preview tabular (✓ novo/⚠ duplicado/✗ erro), dedup automático via slug (mesmo algoritmo de saveDestination), download de template Excel modelo, tolerância a aliases de coluna (Continente/Continent, País/Country, etc.), checkbox por linha + selecionar todos. Importação em lote via saveDestination. Botão "📤 Importar Excel" em #portal-destinations, gated por canManageDestinations.',
    bucket: 'medium', basePoint: 5, profile: 'feature', modules: ['portal_dicas'],
  },
  {
    v: '4.49.8', slug: '20260518-roles-reorg-office',
    title: 'refactor(roles): office_view reorganizado (Portal de Dicas → Equipe, Ausências e Presença)',
    summary: 'Reorganização do catálogo de RBAC: office_view saiu do grupo "Portal de Dicas" (errado) pro grupo "Equipe, Ausências e Presença" (renomeado). Coordenador agora tem office_view explícito (estava undefined). Garante coerência semântica na UI de Editar Role.',
    bucket: 'small', basePoint: 1.5, profile: 'refactor', modules: [],
  },
];

(async () => {
  let created = 0, skipped = 0;
  for (const e of ENTRIES) {
    // Skip se já existe (idempotente)
    const dup = await db.collection('dev_hours')
      .where('releaseVersion', '==', e.v).limit(1).get();
    if (!dup.empty) {
      console.log(`SKIP ${e.v} (já existe)`);
      skipped++;
      continue;
    }
    const humanH = e.basePoint;
    const totalH = +(humanH * AI_MULT).toFixed(2);
    const totalC = +(totalH * RATE).toFixed(2);
    const hoursByCategory = breakdown(totalH, e.profile === 'bugfix' ? 'bugfix' : e.profile === 'refactor' ? 'refactor' : 'feature');

    const payload = {
      entryType: 'release',
      releaseVersion: e.v,
      releaseSlug: e.slug,
      title: e.title,
      summary: e.summary,
      commits: [],
      phaseCommitsCount: null,
      filesChanged: 0, linesAdded: 0, linesRemoved: 0,
      startedAt: null,
      completedAt: Timestamp.fromDate(COMPLETED),
      bucket: e.bucket,
      basePoint: e.basePoint,
      multipliers: [],
      humanEquivalentHours: humanH,
      aiAssistanceMultiplier: AI_MULT,
      totalHours: totalH,
      hourlyRate: RATE,
      totalCost: totalC,
      hoursByCategory,
      modules: e.modules || [],   // 4.40.28+ campo opcional
      notes: '',
      confidenceLevel: 'medium',
      profile: e.profile,
      status: 'approved',          // marca como approved pq foram efetivamente shipped
      approvedAt: Timestamp.fromDate(COMPLETED),
      approvedBy: { uid: 'system', name: 'Backfill 4.48-4.49' },
      rejectedAt: null,
      rejectedBy: null,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: 'system',
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'system',
    };
    await db.collection('dev_hours').add(payload);
    console.log(`OK   ${e.v}  ${humanH}h human → ${totalH}h ajustado (R$ ${totalC})`);
    created++;
  }

  // Totais novos
  const all = await db.collection('dev_hours').get();
  let totalH = 0, totalC = 0;
  all.forEach(d => { totalH += d.data().totalHours || 0; totalC += d.data().totalCost || 0; });
  console.log(`\n─── Resultado ───`);
  console.log(`Criadas: ${created}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total entries agora: ${all.size}`);
  console.log(`Total horas: ${totalH.toFixed(2)}h`);
  console.log(`Total custo: R$ ${totalC.toFixed(2)}`);
  process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
