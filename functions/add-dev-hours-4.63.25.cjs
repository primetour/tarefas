const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.63.25',
  releaseSlug: '20260528-web-link-audit-hotfix',
  title: 'Hotfix HIGH — auditoria Web Link (rule lock + size cap + 405 + audit log)',
  summary: 'Auditoria pós-sprint Web Link v4.63.22-24 (Agent paralelo + double-check manual). ' +
           '14 itens triados, 3 HIGHs atacados nesta release. ' +
           'HIGH#1 firestore.rules portal_web_links lock list anterior só checava token+content; ' +
           'anônimo trocava webTemplate.templateId → CF getTemplateHtml renderizava template ' +
           'de outra área com dados desta (info leak cross-área). Fix: lock list completa ' +
           'cobrindo webTemplate tipData imagesByDest webExports segments colors createdBy ' +
           'areaName areaLogoUrl/Alt fonts editorial modules. Anônimo só altera views. ' +
           'HIGH#2 getTemplateHtml sem Content-Length cap (DoS amplification). Template 50MB+ ' +
           'OOM CF 256MiB + custo egress R2 multiplicado. Fix: TEMPLATE_WEB_MAX_BYTES=8MB ' +
           'check content-length ANTES do .text() (early reject 413). Double-check html.length. ' +
           'HIGH#3 método HTTP não restrito (POST/PUT/DELETE retornavam 200). Fix: 405 ' +
           'Method Not Allowed + Allow: GET, OPTIONS header. ' +
           'MEDIUM bônus audit log fire-and-forget templates.serve_web (ip ua bytes timestamp) ' +
           'pra forense LGPD. ' +
           'HIGH cross-module bônus (pre-commit) Cotações declarava web em SUPPORTED_FMTS_TPL ' +
           'mas roteiroGenerator joga erro fatal + roteiro-view-tpl.html não existe. ' +
           'Removido cotacoes.web até runtime existir (backlog v4.63.27+). ' +
           'Regressão inline pega: admin.firestore.FieldValue não importado nesse escopo, ' +
           'troca pra FieldValue (firebase-admin/firestore). Lição §16.h re-audit imediato. ' +
           'CLAUDE.md +3 lições reusáveis §16.j/k/l: rule lock COMPLETA, CF method whitelist, ' +
           'CF fetch externo Content-Length cap. ' +
           'E2E real: curl 200 GET / 405 POST / 200 HEAD + audit_logs.templates.serve_web 2 docs ' +
           'gravados (IP + bytes + tplId) + Firestore PATCH anônimo retorna 403 + Chrome MCP ' +
           'continua renderizando template com 3 destinos.',
  bucket: 'medium', multiplierIds: ['security', 'investigation'], profile: 'bugfix',
  hoursByCategory: { refinamento: 1.5, desenvolvimento: 2.5, testes: 1.5, documentacao: 1.5, implantacao: 0.5 },
  module: 'templates', modules: ['templates', 'portal'],
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
  const doc = { entryType: 'release', ...ENTRY, aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE,
    totalHours: Math.round(h * 100) / 100, totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
    status: 'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now };
  const ref = await db.collection('dev_hours').add(doc);
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  process.exit(0);
})();
