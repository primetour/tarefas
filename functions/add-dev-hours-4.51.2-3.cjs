/**
 * Backfill dev_hours: v4.51.2 + v4.51.3 — hotfixes encontrados no double-check E2E.
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
    releaseVersion: '4.51.2',
    releaseSlug: '20260523-fix-notif-admin-filter-master',
    title: 'Hotfix portal — filter de admins ignorava roleId=master',
    summary: 'Double-check E2E mostrou Renê (master) com roleId="master" sem isMaster=true. ' +
             'Filter antigo: u.isMaster || roleId in [admin,head]. Sem master = 0 admins. ' +
             'Fix em portal/portal.js + services/requests.js: aceita master, admin, head em roleId E role.',
    bucket: 'trivial', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.05, desenvolvimento: 0.1, testes: 0.1, documentacao: 0.05, implantacao: 0.05 },
    module: 'requests', modules: ['requests'],
  },
  {
    releaseVersion: '4.51.3',
    releaseSlug: '20260523-notify-actor-override-portal',
    title: 'Hotfix notify() — actorId override pra portal (sem store.currentUser)',
    summary: 'Double-check v4.51.2 ainda 0 notifs. Log do batch revelou actor=undefined + ' +
             'permission-denied. Causa: notify() lia store.get("currentUser") mas portal/portal.js ' +
             'NÃO popula esse store (usa portalUser global). Sem actorId → Firestore rule ' +
             '(actorId == auth.uid) bloqueava batch. Fix: notify() aceita actorId/actorName ' +
             'via params; portal passa explícito. Defesa cedo (abort se ainda sem actorId). ' +
             'Lição §12.q sobre store-coupled services.',
    bucket: 'small', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.15, desenvolvimento: 0.3, testes: 0.2, documentacao: 0.15, implantacao: 0.05 },
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
