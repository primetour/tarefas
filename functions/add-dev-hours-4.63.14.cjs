const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.63.14',
  releaseSlug: '20260528-perf-progress-orphan-warn',
  title: 'Perf #1 progress + Zumbi #3 cleanup + Bug #8/#9 orphan warn',
  summary: 'Pos-auditoria Sprint v4.63 parte 3. Perf #1 HIGH UX progress indicator: antes 10s ' +
           'spinner mudo (CLAUDE.md §11.b violation). Agora toast.info persistent (90s) com 3 steps ' +
           'via novo toast.update(id,msg): Carregando template, Renderizando PDF/DOCX/PPTX, Baixando. ' +
           'Toast removido em success ou antes do fallback warn. Aplicado roteiroGenerator 3 branches ' +
           '+ portalGenerator. Zumbi #3 HIGH: templates.new_version phantom action e comentario ' +
           'createNewVersion removidos (funcao nunca existiu). Bug #8/#9 MEDIUM UX orphan template ' +
           'ref: detecta refs apontando pra template archived/deleted via Promise.all fetchTemplate, ' +
           'mostra option amarelo (rgb 245 158 11 = color-warning) com explicacao Template X esta ' +
           'arquivado ou nao existe ou mudou de owner + frase abaixo do select. User pode escolher ' +
           'novo OU explicitamente Usar padrao. E2E validado: 2 selects orfas detectadas, border ' +
           'amarelo aplicado, frase explicativa renderizada. Novo toast.update(id, message, title?) ' +
           'habilita progress em qualquer caller. SSRF lockdown v4.63.13 validado: render legitimo ' +
           '3.58s OK + smoke malicious URL (metadata server) rejeitado com failed-precondition.',
  bucket: 'small', multiplierIds: ['integration'], profile: 'bugfix',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 1.0, testes: 0.5, documentacao: 0.4, implantacao: 0.2 },
  module: 'portal', modules: ['portal', 'roteiros', 'banco-roteiros'],
};

function computeHours(b, mids, ai) {
  const t = Object.values(b).reduce((a, x) => a + x, 0);
  const m = (mids || []).map(id => ({ investigation: .3, migration: .2, pdf: .15, integration: .2, security: .25, pure_refactor: -.2 }[id] || 0)).reduce((a, x) => a + x, 0);
  return t * (1 + m) * ai;
}

(async () => {
  const ex = await db.collection('dev_hours').where('releaseVersion', '==', ENTRY.releaseVersion).limit(1).get();
  if (!ex.empty) { console.log('= skip'); process.exit(0); }
  const h = computeHours(ENTRY.hoursByCategory, ENTRY.multiplierIds, AI_ASSIST);
  const now = FV.serverTimestamp();
  const doc = {
    entryType: 'release', ...ENTRY,
    aiAssistanceMultiplier: AI_ASSIST,
    hourlyRate: HOURLY_RATE,
    totalHours: Math.round(h * 100) / 100,
    totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
    status: 'approved',
    completedAt: now, createdAt: now,
    createdBy: RENE_UID, updatedAt: now,
  };
  const ref = await db.collection('dev_hours').add(doc);
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  process.exit(0);
})();
