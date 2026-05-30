const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.63.94',
    releaseSlug: '20260530-security-audit-xss-tokens',
    title: 'Auditoria de segurança banking-grade — lote 0 (Firestore rules) + lote 1 (camada cliente)',
    summary: 'Renê: "faça uma auditoria de segurança no sistema, visando uma auditoria de instituição bancária. ' +
             'Opere o que precisa operar para resolver, publique, teste." Lote 0 (rules, deployado PROD): lock de ' +
             'privilege-escalation no self-create/self-update de users (membro não seta role/isMaster/permissions/' +
             'sector/nucleos/visibleSectors via SDK); integrations read restrito a admin/system_manage_settings ' +
             '(fecha exfiltração de rawConfig); 3 collections *_dev world-open (read,write:if true) travadas em ' +
             'if false (confirmadas vazias); time_clock_audit create exige actorId==uid; csat_surveys update externo ' +
             'exige respondedAt==null; recurring_task_templates update exige manager||owner; portal_tips_stats ' +
             'write:if false. Lote 1 (cliente): XSS armazenado em csat-response.html (customMessage → escHtml, 2 ' +
             'pontos); normalizeUrl com allowlist de esquema em portal-view.html + portalGenerator.js (bloqueia ' +
             'javascript:/data:/vbscript:); signOut limpa ms/google access-tokens do sessionStorage. dev_hours read ' +
             'público preservado (design deliberado).',
    bucket: 'small', multiplierIds: ['security', 'investigation'], profile: 'phase',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.6, testes: 0.4, documentacao: 0.2, implantacao: 0.2 },
    module: 'security', modules: ['security'],
  },
  {
    releaseVersion: '4.63.95',
    releaseSlug: '20260530-security-audit-cf-hardening',
    title: 'Auditoria de segurança banking-grade — lote 2 (Cloud Functions)',
    summary: 'Descoberta crítica via Admin SDK: as 6 roles (admin/coordinator/manager/master/member/partner) têm ' +
             'isSystem===true — logo toda cláusula "|| isSystem===true" era bypass total de autorização (member/' +
             'partner passavam). Removido de 5 pontos: hasPermissionUid (helper central), deleteR2, ' +
             '_checkTemplatesPermission, importRoteiroBankPdf, roteiroBankValidityCron (master/admin seguem cobertos ' +
             'por nome de role/isMaster; manager mantém templates_manage). getAISecretsStatus: era requireAuth-only ' +
             '(vazava comprimento exato das API keys a qualquer membro) → gate ai_keys_manage + dica grosseira ' +
             '(empty/short/ok) no lugar do tamanho exato; consumer aiHub.js atualizado. getGitHubFile SSRF: gate ' +
             'system_manage_settings + allowlist de repo (primetour/tarefas) + validação branch/path (sem ..) + ' +
             'encodeURIComponent + allowlist download_url (raw.githubusercontent.com). callLLM: agentDailyCapUsd e ' +
             'maxTokens eram controlados pelo cliente (membro anulava cap diário) → tetos server-side (≤50 USD, ' +
             '≤32768 tokens). renderTemplate: templateId validado + cap 2MB no payload (anti-OOM Puppeteer). ' +
             'saveDestinationPhoto: destinationId validado (anti path-injection). Deployado em PROD us-central1 ' +
             '(8 functions). Flags pro Renê: getR2UploadUrl token compartilhado (Worker JWT), CSP unsafe-inline, ' +
             'headers HSTS/X-Frame (Cloudflare Sprint 4), tokens share adivinháveis.',
    bucket: 'small', multiplierIds: ['security', 'investigation'], profile: 'phase',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.7, testes: 0.4, documentacao: 0.3, implantacao: 0.25 },
    module: 'security', modules: ['security'],
  },
];

function computeHours(b, mids, ai) {
  const t = Object.values(b).reduce((a, x) => a + x, 0);
  const m = (mids || []).map(id => ({ investigation: .3, migration: .2, pdf: .15, integration: .2, security: .25, pure_refactor: -.2 }[id] || 0)).reduce((a, x) => a + x, 0);
  return t * (1 + m) * ai;
}

(async () => {
  for (const ENTRY of ENTRIES) {
    const ex = await db.collection('dev_hours').where('releaseVersion', '==', ENTRY.releaseVersion).limit(1).get();
    if (!ex.empty) { console.log(`= skip ${ENTRY.releaseVersion}`); continue; }
    const h = computeHours(ENTRY.hoursByCategory, ENTRY.multiplierIds, AI_ASSIST);
    const now = FV.serverTimestamp();
    const doc = { entryType: 'release', ...ENTRY, aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE,
      totalHours: Math.round(h * 100) / 100, totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
      status: 'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now };
    const ref = await db.collection('dev_hours').add(doc);
    console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  }
  process.exit(0);
})();
