/**
 * dev_hours v4.59.5 + v4.59.6 — auditoria Banco fechamento
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.59.5',
    releaseSlug: '20260526-banco-lazy-render-hero-priority',
    title: 'Banco — lazy render incremental + hero priorizado (CRÍTICO #4 auditoria)',
    summary: 'PAGE_SIZE=50 chunks via IntersectionObserver sentinel (rootMargin 200px). ' +
             'gridHTML renderiza só primeiros state.renderedCount; contador "Mostrando 50 de 236". ' +
             'Filtros chamam refreshGrid({resetPage:true}) → 1ª página. Hero auto-resolve PRIORIZA ' +
             'visíveis (filtered.slice(0, renderedCount)) antes do resto em background. Filtros ' +
             'continuam client-side; cursor-based Firestore adiado pra MAJOR. Cleanup observer ' +
             'no início de renderRoteiroBank (re-entrada).',
    bucket: 'trivial',
    multiplierIds: [],
    profile: 'bugfix',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 1.2, testes: 0.25, documentacao: 0.3, implantacao: 0.1 },
    module: 'banco-roteiros',
    modules: ['banco-roteiros'],
  },
  {
    releaseVersion: '4.59.6',
    releaseSlug: '20260526-banco-envisionraw-risks-polish',
    title: 'Banco — editor envisionRaw/services + risks (timezone, cron) + polish (SVG, CSS vars)',
    summary: '3 buckets restantes da auditoria em 1 release: ' +
             '(editor) renderServices read-only lista services[] Envision (name+cat+dia+desc+supplier+OPCIONAL) + ' +
             'renderEnvisionMeta com env.id/url/syncedAt + 4 blocos envisionRaw em iframe sandbox. ' +
             '(risk) isExpired() timezone (§12.a) — toLocaleDateString en-CA Sao_Paulo evita ±1 dia UTC-3. ' +
             'roteiroBankValidityCron filtro real (§13.f) — antes (u.role && true) listava TODOS = ' +
             'notif spam; agora isMaster OR admin_roles OR perms.portal_destinations_manage===true. ' +
             '(polish) emoji 📅⏳📍⏱🏨 → SVG Heroicons 14px (§11.m). statusBadge/expiredBadge hex ' +
             'hardcoded → CSS vars semânticas (§11.l). Placeholder gradient → bg-surface. ' +
             'saveRoteiroBank merge:true falso positivo após inspeção (schema sem maps dinâmicos).',
    bucket: 'small',
    multiplierIds: [],
    profile: 'bugfix',
    hoursByCategory: { refinamento: 0.4, desenvolvimento: 2.0, testes: 0.4, documentacao: 0.5, implantacao: 0.3 },
    module: 'banco-roteiros',
    modules: ['banco-roteiros', 'cloud-functions'],
  },
];

function computeHours(b, mids, ai) {
  const t = Object.values(b).reduce((a, x) => a + x, 0);
  const m = (mids || []).map(id => ({
    investigation: .3, migration: .2, pdf: .15, integration: .2,
    security: .25, pure_refactor: -.2,
  }[id] || 0)).reduce((a, x) => a + x, 0);
  return t * (1 + m) * ai;
}

(async () => {
  for (const ENTRY of ENTRIES) {
    const ex = await db.collection('dev_hours')
      .where('releaseVersion', '==', ENTRY.releaseVersion).limit(1).get();
    if (!ex.empty) { console.log(`= skip ${ENTRY.releaseVersion} (já existe)`); continue; }
    const h = computeHours(ENTRY.hoursByCategory, ENTRY.multiplierIds, AI_ASSIST);
    const now = FV.serverTimestamp();
    const doc = {
      entryType: 'release', ...ENTRY,
      aiAssistanceMultiplier: AI_ASSIST,
      hourlyRate: HOURLY_RATE,
      totalHours: Math.round(h * 100) / 100,
      totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
      status: 'approved',
      completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now,
    };
    const ref = await db.collection('dev_hours').add(doc);
    console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  }
  process.exit(0);
})();
