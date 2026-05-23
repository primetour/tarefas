/**
 * Backfill dev_hours: v4.51.0 + v4.51.1 — Portal de Solicitações fixes.
 * Marca `modules: ['requests']` se já existir, OU sem módulo (fica em "Geral").
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
    releaseVersion: '4.51.0',
    releaseSlug: '20260523-portal-solicitacoes-8-fixes',
    title: 'Portal de Solicitações — 8 fixes (UX + race + notif + governança)',
    summary: 'Renê listou 10 bugs; 8 cobertos em v4.51.0: ' +
             '(1) Sua área usa profile.sector || department (era só department legado = núcleo); ' +
             '(2) anti-double-submit GLOBAL via flag _submitInFlight no início da função (antes button.disabled era setado depois → 2 clicks <100ms criavam 2 tasks); ' +
             '(3) pop-up news virou MODAL bloqueante (full-screen overlay, sem auto-dismiss, ESC = não); ' +
             '(4) campo contentLink (URL opcional) após descrição; ' +
             '(5) reorder do form — título+desc+link agora logo após calendário (Renê: scroll pro final era ruim); ' +
             '(6) variação auto-preenche se só há 1 (dispatch change automático com SLA+due); ' +
             '(7) urgência MONOTÔNICA na edição (pode false→true, nunca true→false; defense-in-depth no save); ' +
             '(8) toast GLOBAL pra notifs novas via Set diff em subscribeNotifications (antes só badge+som, agora aparece em qualquer rota).',
    bucket: 'medium', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.4, desenvolvimento: 1.8, testes: 0.4, documentacao: 0.3, implantacao: 0.2 },
    module: 'requests', modules: ['requests'],
  },
  {
    releaseVersion: '4.51.1',
    releaseSlug: '20260523-portal-notif-criacao-inline',
    title: 'Portal — notif IN-APP na criação de solicitação (bypass do service)',
    summary: 'Renê: "Quando chega solicitação não tem notificação no sistema". ' +
             'Bug: portal/portal.js usava addDoc(requests,...) DIRETO, bypassando ' +
             'createRequest() do service que era o único lugar com notify("request.created"). ' +
             'Fix: replicado bloco inline no handleSubmit, non-blocking (try/catch), busca ' +
             'admins via query direta (active=true && isMaster||roleId em admin/head). ' +
             'Lição §12.n: 2 caminhos pra mesma operação criam side-effects esquecidos.',
    bucket: 'trivial', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.25, testes: 0.1, documentacao: 0.1, implantacao: 0.05 },
    module: 'requests', modules: ['requests'],
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
      // Use totalHours/totalCost (campo canônico que dev-hours-view lê)
      totalHours: Math.round(finalHours * 100) / 100,
      totalCost: Math.round(finalHours * HOURLY_RATE * 100) / 100,
      status: 'approved',
      // completedAt obrigatório pra entrar no orderBy
      completedAt: now,
      createdAt: now, createdBy: RENE_UID, updatedAt: now,
    };
    const ref = await db.collection(COLLECTION).add(doc);
    console.log(`+ ${e.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  }
  process.exit(0);
})();
