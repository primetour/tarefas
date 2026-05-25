/**
 * dev_hours v4.57.7 — 3 bugs reportados pelo Renê
 *
 * Bug 1: Modal de validação aparece em branco — chamada openTaskModal({task})
 *        mas espera {taskData}. Coordenador não conseguia validar histórico.
 * Bug 2: Popup evidência de meta — "Período de referência" custom era input
 *        text livre. Trocado por 2 date pickers (início+fim).
 * Bug 3: Lembrete Meu Painel — data registrava dia anterior (timezone UTC
 *        shift). Fix em 3 lugares (renderReminders, checkDueReminders,
 *        convert to task). Bonus: CSS pra input[type=date] visível em dark.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const HOURLY_RATE = 150;
const AI_ASSIST   = 0.50;
const RENE_UID    = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.57.7',
  releaseSlug: '20260525-validation-modal-periodo-datepickers-reminder-tz',
  title: 'Hotfix triplo: validation modal vazio + período sem calendário + lembrete TZ',
  summary: 'Renê reportou 3 bugs distintos: (1) Coordenador clica em tarefa pra validar, modal abre em branco — ' +
           'requests.js passava {task} mas openTaskModal espera {taskData}. (2) Popup de evidência de meta, ' +
           '"período de referência" custom era input text livre "Ex: Abril 2025" sem date picker — substituído ' +
           'por 2 <input type="date"> (início+fim) gerando label dd/mm/yyyy–dd/mm/yyyy consistente com periods ' +
           'predefinidos. (3) Meu Painel: data de lembrete registrava dia anterior (clássico bug §12.a CLAUDE.md, ' +
           'new Date(YYYY-MM-DD) em UTC-3 = UTC midnight = dia anterior). Fix em 3 caminhos: renderReminders ' +
           '(display), checkDueReminders (notif), convert to task (toISOString.slice). Bonus: CSS global pra ' +
           'input[type="date|datetime-local|time|month"] com color-scheme + cursor pointer + picker-indicator ' +
           'visível em dark mode (antes ficava preto-em-preto, user pensava ser input manual).',
  bucket: 'small',
  multiplierIds: ['investigation'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.8, testes: 0.3, documentacao: 0.3, implantacao: 0.1 },
  module: 'tasks',
  modules: ['tasks', 'requests', 'dashboard', 'goals'],
};

function computeHours(buckets, multIds, aiAssist) {
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  const mults = (multIds || []).map(id => ({
    investigation: 0.30, migration: 0.20, pdf: 0.15,
    integration: 0.20, security: 0.25, pure_refactor: -0.20,
  })[id] || 0).reduce((a, b) => a + b, 0);
  return total * (1 + mults) * aiAssist;
}

(async () => {
  const exists = await db.collection('dev_hours').where('releaseVersion','==',ENTRY.releaseVersion).limit(1).get();
  if (!exists.empty) { console.log(`= skip ${ENTRY.releaseVersion}`); process.exit(0); }
  const finalHours = computeHours(ENTRY.hoursByCategory, ENTRY.multiplierIds, AI_ASSIST);
  const now = FV.serverTimestamp();
  const doc = {
    entryType: 'release', ...ENTRY,
    aiAssistanceMultiplier: AI_ASSIST,
    hourlyRate: HOURLY_RATE,
    totalHours: Math.round(finalHours * 100) / 100,
    totalCost: Math.round(finalHours * HOURLY_RATE * 100) / 100,
    status: 'approved',
    completedAt: now,
    createdAt: now, createdBy: RENE_UID, updatedAt: now,
  };
  const ref = await db.collection('dev_hours').add(doc);
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  process.exit(0);
})();
