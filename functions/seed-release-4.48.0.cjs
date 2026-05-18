/**
 * dev_hours entry pra release 4.48.0 (Sprint 6b+c — area tokens SSO).
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const HOURLY_RATE = 150;
const AI_MULT = 0.50;

const REL = {
  releaseVersion: '4.48.0',
  releaseSlug:    '20260518-sprint6bc-area-tokens-sso',
  title:          'sprint 6b+c — templates de áreas evoluídos (fonts + editorial + module overrides)',
  summary:        'Resolve pedido "criar uma área de templates de areas que abasteça esses módulos de forma consistente, editável e escalável". Schema portal_areas expandido (backward-compat): fonts.{headline,body,accentScale}, editorial.{voice,sectionStyle,coverStyle,chromeAccent}, modules.{portal,roteiros}. Novo js/services/areaTokens.js como SSO: resolveAreaTokens (merge defaults+module overrides), applyAreaTheme (CSS vars + auto-load Google Fonts + chrome accent decoupled from brand color). UI /portal-areas com 4 tabs: Marca · Tipografia (dropdowns 6+5 fontes + preview live) · Editorial (radios c/ descrição) · Por módulo (accordion overrides). Consumers wired: portal-view e roteiro-view importam applyAreaTheme com moduleKey específico. Fix arquitetural: chrome do hero (overlines/lines) agora usa --area-chrome-accent independente da brand color — resolve bug do user "ROTEIRO DE VIAGEM em azul" quando primary da BU era azul-marinho.',
  bucket:         'large',
  multiplierIds: ['migration'],
  profile:        'feature',
  humanHours:     6.5,
  completedAt:    new Date('2026-05-19T04:30:00-03:00'),
  modules:        ['roteiros', 'portal'],
};

(async () => {
  const factor = 1 + REL.multiplierIds.reduce((s, id) => {
    const m = { investigation: 0.30, migration: 0.20, pdf: 0.15, integration: 0.20, security: 0.25, pure_refactor: -0.20 }[id];
    return s + (m ?? 0);
  }, 0);
  const humanEquivalentHours = +(REL.humanHours * factor).toFixed(2);
  const totalHours           = +(humanEquivalentHours * AI_MULT).toFixed(2);
  const totalCost            = +(totalHours * HOURLY_RATE).toFixed(2);

  const profileRatios = { refinamento: 0.20, desenvolvimento: 0.50, testes: 0.10, documentacao: 0.15, implantacao: 0.05 };
  const hoursByCategory = {};
  let allocated = 0;
  for (const k of Object.keys(profileRatios)) {
    hoursByCategory[k] = +(totalHours * profileRatios[k]).toFixed(2);
    allocated += hoursByCategory[k];
  }
  const diff = +(totalHours - allocated).toFixed(2);
  if (diff !== 0) hoursByCategory.desenvolvimento = +(hoursByCategory.desenvolvimento + diff).toFixed(2);

  const payload = {
    entryType:              'release',
    releaseVersion:         REL.releaseVersion,
    releaseSlug:            REL.releaseSlug,
    title:                  REL.title,
    summary:                REL.summary,
    bucket:                 REL.bucket,
    multiplierIds:          REL.multiplierIds,
    profile:                REL.profile,
    humanEquivalentHours,
    aiAssistanceMultiplier: AI_MULT,
    totalHours,
    totalCost,
    hourlyRate:             HOURLY_RATE,
    hoursByCategory,
    completedAt:            admin.firestore.Timestamp.fromDate(REL.completedAt),
    status:                 'approved',
    approvedAt:             admin.firestore.FieldValue.serverTimestamp(),
    approvedBy:             { uid: 'system-seed', name: 'Sistema' },
    createdAt:              admin.firestore.FieldValue.serverTimestamp(),
    createdBy:              { uid: 'system-seed', name: 'Sistema' },
    modules:                REL.modules,
  };

  const q = await db.collection('dev_hours').where('releaseVersion', '==', REL.releaseVersion).get();
  if (q.empty) {
    await db.collection('dev_hours').add(payload);
    console.log(`✅ Criada release ${REL.releaseVersion} (${totalHours}h · R$ ${totalCost})`);
  } else {
    await q.docs[0].ref.update(payload);
    console.log(`✓ Atualizada release ${REL.releaseVersion} (${totalHours}h · R$ ${totalCost})`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
