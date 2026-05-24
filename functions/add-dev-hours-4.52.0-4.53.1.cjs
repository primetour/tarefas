/**
 * Backfill dev_hours: v4.52.0 + v4.53.0 + v4.53.1
 * - v4.52.0: 5 bugs usuários (metas+áreas+status approval+notif)
 * - v4.53.0: fluxo de validation + SLA freeze (analista conclui → coordenador finaliza)
 * - v4.53.1: double-check cross-app (11 pontos com status approval/validation faltando)
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const HOURLY_RATE = 150;
const AI_ASSIST   = 0.50;
const COLLECTION  = 'dev_hours';
const RENE_UID    = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.52.0',
    releaseSlug: '20260524-bugs-usuarios-metas-areas-status-notif',
    title: '5 bugs usuários: metas, áreas solicitantes, status approval e notificações',
    summary: '5 fixes reportados por usuários: (1) metas squad agora filtra setor visível/responsável ' +
             'no taskModal:398, (2) área solicitante usa getActiveSectors(), (3) novo status "approval" ' +
             '(Em aprovação) adicionado a STATUSES com cor #0EA5E9 + transições, (4) notif de criação ' +
             'de tarefa propagada pra managers, (5) chip de status em search inclui approval. ' +
             'Toca tasks.js, workflowEngine.js, taskModal.js, requests.js.',
    bucket: 'medium', multiplierIds: ['integration'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.5, desenvolvimento: 2.0, testes: 0.8, documentacao: 0.3, implantacao: 0.2 },
    module: 'tasks', modules: ['tasks', 'requests', 'goals'],
  },
  {
    releaseVersion: '4.53.0',
    releaseSlug: '20260524-validation-flow-sla-freeze',
    title: 'Fluxo de validação obrigatória — analista conclui, coordenador finaliza (SLA congela)',
    summary: 'Mudança estrutural pedida pelo Renê: analista marca tarefa "Enviar pra validação" → ' +
             'cai numa nova aba do módulo Solicitações ("🔍 Aguardando validação"). Coordenador/gerente/' +
             'diretor faz double-check (CSAT + metas) e finaliza. Status novo "validation" (#EAB308) com ' +
             'SLA CONGELADO (isTaskOverdue retorna false) — evita que tarefa fique "atrasada" se gestor ' +
             'demorar. Workflow engine ampliado com validation. Nova função updateTaskStatus(taskId, ' +
             'newStatus) centraliza side-effects (notif managers, slaFrozenAt, validatedBy/At). ' +
             'toggleTaskComplete redireciona assignee sem task_complete pra validation. Nova aba em ' +
             'requests.js com badge dinâmica + ações validate-done/validate-rework/open-task.',
    bucket: 'medium', multiplierIds: ['integration'], profile: 'feature',
    hoursByCategory: { refinamento: 1.0, desenvolvimento: 3.0, testes: 1.2, documentacao: 0.5, implantacao: 0.3 },
    module: 'tasks', modules: ['tasks', 'requests', 'workflow'],
  },
  {
    releaseVersion: '4.53.1',
    releaseSlug: '20260524-validation-double-check-cross-app',
    title: 'Double-check cross-app: status approval/validation propagado em 11 pontos',
    summary: 'Renê: "faça double check em tudo, pq bugs e melhorias em tarefas tem muitas camadas". ' +
             'Auditoria sistemática via Explore agent encontrou 11 pontos onde os status approval ' +
             '(v4.52) e validation (v4.53) não estavam propagados — tarefas nesses estados ficariam ' +
             'invisíveis em queries Firestore, dashboards, IA tool schemas, dropdowns de transição e ' +
             'maps de cores/ícones. Fixes em: notificationScheduler activeSet, dailySummary query, ' +
             'slaAlerts query, goals statusIcons+Colors, roteiroEditor STATUS_COLORS, header ' +
             'STATUS_ICONS, cardPrefs S+L, dashboard STATUS_COLOR+legenda chart, taskModal fallback ' +
             'getValidTransitions, ai.js DEFAULT_MODULE_HINTS, aiActions.js 5 tool schemas. ' +
             'Lição §12.s incorporada ao CLAUDE.md: status novo = single source of truth + ' +
             'propagação em N lugares (grep checklist obrigatório).',
    bucket: 'medium', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.5, desenvolvimento: 2.5, testes: 1.0, documentacao: 0.6, implantacao: 0.2 },
    module: 'tasks', modules: ['tasks', 'requests', 'goals', 'dashboard', 'ai-hub'],
  },
];

function computeHours(buckets, multIds, aiAssist) {
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  const mults = (multIds || []).map(id => ({
    investigation: 0.30, migration: 0.20, pdf: 0.15,
    integration: 0.20, security: 0.25, pure_refactor: -0.20,
  })[id] || 0).reduce((a, b) => a + b, 0);
  return total * (1 + mults) * aiAssist;
}

(async () => {
  for (const e of ENTRIES) {
    const exists = await db.collection(COLLECTION).where('releaseVersion','==',e.releaseVersion).limit(1).get();
    if (!exists.empty) { console.log(`= skip ${e.releaseVersion}`); continue; }
    const finalHours = computeHours(e.hoursByCategory, e.multiplierIds, AI_ASSIST);
    const now = FV.serverTimestamp();
    const doc = {
      entryType: 'release', ...e,
      aiAssistanceMultiplier: AI_ASSIST,
      hourlyRate: HOURLY_RATE,
      totalHours: Math.round(finalHours * 100) / 100,
      totalCost: Math.round(finalHours * HOURLY_RATE * 100) / 100,
      status: 'approved',
      completedAt: now,
      createdAt: now, createdBy: RENE_UID, updatedAt: now,
    };
    const ref = await db.collection(COLLECTION).add(doc);
    console.log(`+ ${e.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  }
  process.exit(0);
})();
