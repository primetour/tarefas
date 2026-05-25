/**
 * dev_hours v4.57.6 — Portal CSS isolation fix
 *
 * Renê (3ª vez no mesmo sprint): "os botões seguem fora do padrão de
 * design do sistema. o botão 'hoje', no calendário, está na mesma
 * situação".
 *
 * Causa raiz descoberta: solicitar.html carrega APENAS css/portal.css.
 * Classes .btn vivem em css/components.css que o portal não importa.
 * Resultado: <button class="btn btn-secondary"> renderiza como botão
 * default do browser (cinza outset, fonte 400, padding 0).
 *
 * Fix (v4.57.6):
 * 1. portal.css define .btn + .btn-primary/-secondary/-sm/-icon/-ghost
 *    /-danger/-segment usando SÓ tokens do portal (--brand-gold,
 *    --border-subtle, etc.)
 * 2. Calendar prev/next/Hoje + granularity refatorados pra usar essas
 *    classes (antes eram inline com var(--border-default) inexistente)
 * 3. Aliases defensivos no :root: --border-default, --border-accent,
 *    --bg-hover
 *
 * Lição registrada no CLAUDE.md §12.w.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const HOURLY_RATE = 150;
const AI_ASSIST   = 0.50;
const RENE_UID    = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.57.6',
  releaseSlug: '20260525-portal-btn-classes-in-portal-css',
  title: 'Portal CSS — .btn classes definidas no portal.css (isolation fix)',
  summary: 'Renê reportou 3x no sprint que botões do wizard estavam "fora do padrão". Cada tentativa anterior eu ' +
           'trocava style="..." por class="btn btn-secondary btn-sm" — mas continuava renderizando como botão ' +
           'default do browser (cinza outset). Causa raiz descoberta: solicitar.html carrega APENAS css/portal.css; ' +
           'classes .btn vivem em css/components.css que o portal NÃO importa. Trocar style por classe inexistente ' +
           '= trocar botão custom feio por botão browser feio. Fix: portal.css ganha .btn + .btn-primary (gold ' +
           'filled, igual .portal-submit) + .btn-secondary (transparent + border-subtle, igual .portal-submit-alt) ' +
           '+ .btn-sm + .btn-icon + .btn-ghost + .btn-danger + .btn-segment, usando SÓ tokens do portal. Calendar ' +
           'prev/next/Hoje + granularity refatorados pra usar as classes (antes eram inline com var(--border-default) ' +
           'inexistente). Aliases defensivos no :root: --border-default, --border-accent, --bg-hover. Lição CLAUDE.md §12.w.',
  bucket: 'small',
  multiplierIds: ['investigation'],
  profile: 'bugfix',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.6, testes: 0.3, documentacao: 0.3, implantacao: 0.1 },
  module: 'requests',
  modules: ['requests', 'portal'],
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
