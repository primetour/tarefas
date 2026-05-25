/**
 * Backfill consolidado dev_hours: v4.57.14 → v4.57.27 (14 releases)
 *
 * Sprint 25/05/2026 — bugs UX/segurança + auditoria sistemática Tarefas.
 * Cobre desde fix do picker em paletas claras (v14) até erradicação de
 * 19 gaps no módulo de tarefas (v27).
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.57.14',
    releaseSlug: '20260525-date-picker-light-palettes',
    title: 'CSS — picker calendário visível em paletas claras (platinum, sand)',
    summary: 'v4.57.7 cobria só [data-theme="light"] (atributo do portal). App principal usa [data-palette="..."]. ' +
             'Palettes claras (platinum, sand) caíam no default color-scheme:dark → picker branco em fundo branco = invisível. ' +
             'Fix: color-scheme:light pros seletores :root[data-palette="platinum"] e [data-palette="sand"]. Validado via probe ' +
             'DOM nas 10 palettes do sistema (platinum/sand=light, outras 8=dark).',
    bucket: 'trivial', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.05, desenvolvimento: 0.15, testes: 0.1, documentacao: 0.05, implantacao: 0.05 },
    module: 'tasks', modules: ['system', 'theme'],
  },
  {
    releaseVersion: '4.57.15',
    releaseSlug: '20260525-portal-calendar-tz-shift-fix',
    title: 'Portal Calendar — erradica TZ shift (slot mostrava dia anterior)',
    summary: 'buildCalData fazia const dt = new Date(df) onde df era string YYYY-MM-DD. UTC midnight em UTC-3 ' +
             'voltava dia anterior. Task indexada em taskMap[25] em vez de [26], dateISO gravava UTC=26 → INCONSISTENTE. ' +
             'Click no slot do dia 25 visual abria modal com data 26. Fix: helpers _parseLocalSafe + _toLocalISO em ' +
             'portal.js (regex YYYY-MM-DD). Aplicado em buildCalData, buildRequestMap e notifyTeam email. CLAUDE.md §12.a.',
    bucket: 'small', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.5, testes: 0.3, documentacao: 0.2, implantacao: 0.05 },
    module: 'requests', modules: ['requests', 'portal'],
  },
  {
    releaseVersion: '4.57.16',
    releaseSlug: '20260525-portal-calendar-clarity-states',
    title: 'Portal Calendar — visual de slots por estado semântico (7 cores)',
    summary: 'Renê: "não está claro o que já está preenchido e o que ainda precisa ser feito". Cores sólidas com ' +
             'contraste alto + ícone por estado: VAZIO (dashed gold) · AGUARDA (⏳ amarelo) · EM PROD (▶ azul) · CONCLUÍDA ' +
             '(✓ verde) · RECUSADA (✕ vermelho) · NO LOTE (✦ lilás) · AGENDADA (●). Helpers _slotVisual + _slotStateFrom + ' +
             'legenda compacta. Aplicado em month/week/day views.',
    bucket: 'small', multiplierIds: [], profile: 'feature',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.7, testes: 0.2, documentacao: 0.15, implantacao: 0.05 },
    module: 'requests', modules: ['requests', 'portal'],
  },
  {
    releaseVersion: '4.57.17',
    releaseSlug: '20260525-wizard-calendar-clarity-states',
    title: 'Wizard Calendar — clareza visual + badges nos dias (Step 2)',
    summary: 'Renê pediu o mesmo do portal mas no wizard. _wizardCellVisual + WIZARD_CELL_STYLES (8 estados). Badge ' +
             'sólido AO LADO do número do dia + chip embaixo. Legenda nova. Status: SLOT VAZIO/AGUARDA/EM PROD/CONCLUÍDA/' +
             'RECUSADA/NO LOTE/HOJE/SELECIONADO.',
    bucket: 'small', multiplierIds: [], profile: 'feature',
    hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.6, testes: 0.2, documentacao: 0.15, implantacao: 0.05 },
    module: 'requests', modules: ['requests', 'portal'],
  },
  {
    releaseVersion: '4.57.18',
    releaseSlug: '20260525-wizard-calendar-minimal-esc-overlay-guard',
    title: 'Wizard — visual minimalista + Esc respeita overlay + CLAUDE.md §6 reforçada',
    summary: 'Renê: "alternativa visual nao tem nada a ver com design do sistema... titulos cortados... nao é melhor ' +
             'minimalista?" + bug Esc em modal voltava step. Refatorado pra visual estilo Linear/Asana (bolinha colorida + ' +
             'texto natural + barra lateral 3px só quando há status). _keyHandler checa _isAnyOverlayOpen ANTES de processar. ' +
             'CLAUDE.md §6 reforçada com matriz de 10 dimensões de cenários obrigatória ANTES de tocar arquivo do módulo + ' +
             'caso canônico ESC documentado + pattern de overlay guard.',
    bucket: 'medium', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.5, desenvolvimento: 1.0, testes: 0.5, documentacao: 0.6, implantacao: 0.1 },
    module: 'requests', modules: ['requests', 'portal', 'system'],
  },
  {
    releaseVersion: '4.57.19',
    releaseSlug: '20260525-wizard-recent-reqs-onsnapshot-realtime',
    title: 'Wizard — recentRequests via onSnapshot (real-time)',
    summary: 'Renê: "exclui a tarefa do dia 26 do sistema, mas o calendário nao atualizou". Causa raiz: ' +
             '_loadRecentRequests usava getDocs ONCE no boot. Quando coord deletava/mudava status no app principal, ' +
             'portal continuava com state stale. Fix: onSnapshot real-time + cleanup em destroyPortalWizard + ' +
             're-render calendar a cada mudança + fecha preview modal se request deletada externamente. Listei 17 ' +
             'cenários antes de tocar arquivo (§6 aplicada).',
    bucket: 'medium', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.5, desenvolvimento: 1.2, testes: 0.6, documentacao: 0.3, implantacao: 0.1 },
    module: 'requests', modules: ['requests', 'portal'],
  },
  {
    releaseVersion: '4.57.20',
    releaseSlug: '20260525-wizard-edit-race-snapshot-fallback',
    title: 'Wizard — fecha 4 buracos da matriz §6 (race edit, status changed, etc)',
    summary: 'Renê cobrou "se tem buracos, vc tem que resolver". 4 buracos: (A) race click "Editar" + delete externa ' +
             'simultânea — _enterEditMode valida _allRecentRequests (snapshot fresh) e aborta com alert. (B) User em ' +
             'edit mode + coord deleta — snapshot detecta editId ausente e força _exitEditMode. (C) Snapshot ' +
             're-renderizando step errado — checa _state.step. (E) Snapshot fail silencioso — toast vermelho 8s.',
    bucket: 'medium', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.4, desenvolvimento: 1.0, testes: 0.6, documentacao: 0.2, implantacao: 0.1 },
    module: 'requests', modules: ['requests', 'portal'],
  },
  {
    releaseVersion: '4.57.21',
    releaseSlug: '20260525-task-setor-solicitante-todos-setores',
    title: 'Tarefas — setor solicitante mostra TODOS setores (não só do user)',
    summary: 'Renê: "analista não consegue editar setor solicitante, só aparece o próprio setor". v4.52.0 ' +
             'corrigiu o <select> hidden mas DEIXOU 3 outros lugares com getUserSectorOptions (que filtra por ' +
             'visibility). Fix em 4 lugares: taskModal:2062 (picker visual), tasks.js:485 (filtro), tasks.js:1970 ' +
             '(picker filtro), filterBar.js:97 (areaOpts). Setor SOLICITANTE = qualquer setor pode pedir; setor ' +
             'EXECUTOR mantém filtro de visibility.',
    bucket: 'small', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.5, testes: 0.3, documentacao: 0.2, implantacao: 0.05 },
    module: 'tasks', modules: ['tasks'],
  },
  {
    releaseVersion: '4.57.22',
    releaseSlug: '20260525-tasks-audit-7-fixes',
    title: 'Auditoria Tarefas — 7 fixes (3 críticos + segurança + leaks)',
    summary: 'Auditoria sistemática (20 gaps mapeados via agent). Críticos: #1 re-render perde listeners (AbortController), ' +
             '#2 SLA ignora dueDate Timestamp (helper _normalizeToISODate), #3 flag delegação frágil (resolvido com #1). ' +
             'Segurança: #8 bulkUpdate filtra por permission, #9 moveTaskKanban getDoc+check antes do updateDoc. Leaks: ' +
             '#10 fallback users em validation notif, #11 Set cap 500 + LRU, #12 addComment inclui observers.',
    bucket: 'large', multiplierIds: ['investigation', 'security'], profile: 'bugfix',
    hoursByCategory: { refinamento: 1.0, desenvolvimento: 3.0, testes: 1.5, documentacao: 0.5, implantacao: 0.2 },
    module: 'tasks', modules: ['tasks'],
  },
  {
    releaseVersion: '4.57.23',
    releaseSlug: '20260525-tasks-popover-transitions-confirm',
    title: 'Tarefas — popover status filtra transições válidas + modal.confirm custom',
    summary: 'Fix #4 popover usa workflowEngine.getValidTransitions. Antes: 6 opções fixas, user pulava status ilegal ' +
             '(not_started → validation). Fix #6 confirm() nativo (anti-padrão §11.k) → modal.confirm Promise<boolean> ' +
             'estilizado.',
    bucket: 'small', multiplierIds: [], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.2, desenvolvimento: 0.5, testes: 0.2, documentacao: 0.15, implantacao: 0.05 },
    module: 'tasks', modules: ['tasks'],
  },
  {
    releaseVersion: '4.57.24',
    releaseSlug: '20260525-tasks-cancel-button-modal-confirm',
    title: 'Tarefas — botão Cancelar do taskModal também usa modal.confirm',
    summary: 'E2E MCP do v4.57.23 pegou 2º caminho de close (botão Cancelar linha 280) ainda com confirm() nativo. ' +
             'Agora ambos paths (X/Esc e botão Cancelar) usam modal.confirm Promise.',
    bucket: 'trivial', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.05, desenvolvimento: 0.1, testes: 0.1, documentacao: 0.05, implantacao: 0.05 },
    module: 'tasks', modules: ['tasks'],
  },
  {
    releaseVersion: '4.57.25',
    releaseSlug: '20260525-tasks-audit-4-more-fixes',
    title: 'Auditoria Tarefas — 4 fixes adicionais (#5 #7 #13 #17)',
    summary: '#5 Modal cleanup via AbortController (taskModal abre → 8 listeners no document SEM cleanup; reabrir 10x = ' +
             '80 handlers órfãos). #7 deleteGoal cascade (checkGoalDependencies + bloqueio se houver tasks vinculadas + ' +
             'flag force pra admin). #13 parseMentions ambíguo (2 "João" → notificava ambos; agora exige nome composto). ' +
             '#17 createTasksListener debounce órfão (clearTimeout no unsub pra evitar callback órfão após re-subscribe).',
    bucket: 'medium', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.5, desenvolvimento: 1.5, testes: 0.7, documentacao: 0.3, implantacao: 0.1 },
    module: 'tasks', modules: ['tasks', 'goals'],
  },
  {
    releaseVersion: '4.57.26',
    releaseSlug: '20260525-parsementions-refined-12-cases-pass',
    title: 'parseMentions refinado — 12 cenários E2E pass',
    summary: 'E2E MCP do v4.57.25 pegou 2 sub-bugs no fix do parseMentions: (A) "@joão silva" matchava u1 E u2 — ' +
             'tokenização com regex + comparação contra fullName/firstTwo/first; (B) "@maria e @ana" capturava "maria e" ' +
             '(regex pegava conjunção) — STOP set de conjunções pt-BR/en; (C) "@joão silva" com currentUid=u1 matchava ' +
             'u2 — se mention é nome COMPOSTO, NÃO adiciona first sozinho. 12/12 cenários pass.',
    bucket: 'small', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.6, testes: 0.5, documentacao: 0.15, implantacao: 0.05 },
    module: 'tasks', modules: ['tasks'],
  },
  {
    releaseVersion: '4.57.27',
    releaseSlug: '20260525-tasks-audit-final-5-fixes',
    title: 'Auditoria Tarefas final — 5 fixes (#14 #15 #18 #19 #20) — 19/20 gaps fechados',
    summary: '#14 bulkCreateTasks notif Promise.all paralelo. #15 slaFrozenAt limpa em done/cancelled mesmo sem ' +
             'vir de validation. #18 updateSubtaskAssignees prioriza title FRESH do snap recente. #19 deleteTask ' +
             'cleanup attachments Cloud Storage (best-effort). #20 REQUESTING_AREAS @deprecated comment (lista hardcoded ' +
             'como back-compat). Total auditoria: 19/20 gaps fechados em 6 releases (v22→27). #16 sem ação (design ' +
             'intencional).',
    bucket: 'medium', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.4, desenvolvimento: 1.0, testes: 0.4, documentacao: 0.3, implantacao: 0.1 },
    module: 'tasks', modules: ['tasks', 'goals'],
  },
];

function computeHours(b, mids, ai) {
  const t = Object.values(b).reduce((a,x)=>a+x,0);
  const m = (mids||[]).map(id=>({investigation:.3,migration:.2,pdf:.15,integration:.2,security:.25,pure_refactor:-.2}[id]||0)).reduce((a,x)=>a+x,0);
  return t*(1+m)*ai;
}

(async () => {
  let total = 0, created = 0, skipped = 0;
  for (const e of ENTRIES) {
    const ex = await db.collection('dev_hours').where('releaseVersion','==',e.releaseVersion).limit(1).get();
    if (!ex.empty) { console.log(`= skip ${e.releaseVersion}`); skipped++; continue; }
    const h = computeHours(e.hoursByCategory, e.multiplierIds, AI_ASSIST);
    const now = FV.serverTimestamp();
    const doc = {
      entryType:'release', ...e,
      aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE,
      totalHours: Math.round(h*100)/100, totalCost: Math.round(h*HOURLY_RATE*100)/100,
      status:'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now,
    };
    const ref = await db.collection('dev_hours').add(doc);
    console.log(`+ ${e.releaseVersion.padEnd(8)} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
    total += doc.totalHours;
    created++;
  }
  console.log(`\n📊 ${created} created, ${skipped} skipped — TOTAL: ${Math.round(total*100)/100}h / R$${Math.round(total*HOURLY_RATE*100)/100}`);
  process.exit(0);
})();
