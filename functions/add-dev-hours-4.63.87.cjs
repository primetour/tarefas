const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.63.87',
    releaseSlug: '20260529-render-stream-fix',
    title: 'Fix render `internal` de template de cotação — endpoint streaming substitui onCall 10MB',
    summary: 'Reporte do Renê: "tentei gerar 2x o pdf e o mesmo erro apareceu... Template configurado ' +
             'falhou (internal). Gerando com padrão do sistema." Diagnóstico empírico (probe do worker R2): ' +
             'a fix de secret (v4.63.84) resolveu o 401 mas expôs a causa real — PDF de cotação real (>7MB) ' +
             'estourava o limite de resposta (~10MB) do callable renderTemplate → "Response size too large" → ' +
             'erro internal → cliente caía pro jsPDF. O fallback R2 não salvava: o worker rejeita PDF em TODO ' +
             'path (HTTP 415 confirmado por probe) e a URL pub-*.r2.dev não tem CORS pro fetch do browser. ' +
             'Sem credenciais R2 S3 nem bucket Firebase Storage → única arquitetura viável é endpoint próprio. ' +
             '(1) Novo endpoint renderTemplateFile (onRequest/Cloud Run, limite ~32MiB) renderiza + STREAMA o ' +
             'binário direto com CORS (Access-Control-Allow-Origin: *). Domínio cloudfunctions.net já está no ' +
             'connect-src do CSP — fetch passa sem mudança. Auth via Bearer ID token (getAuth().verifyIdToken), ' +
             'rate-limit por uid, OPTIONS→204, não-POST→405, HttpsError.code→HTTP status. (2) Refator ' +
             '_renderTemplateCore(templateId, data) compartilhado entre o renderTemplate onCall legado ' +
             '(mantido) e o novo endpoint — zero duplicação da lógica de render + SSRF allowlist. (3) Cliente ' +
             'templates.js renderTemplate troca httpsCallable por fetch(POST) com Bearer token, lê res.blob() ' +
             'direto (sem base64, sem CORS de R2), extrai filename do Content-Disposition. Mesma assinatura de ' +
             'retorno {filename, sizeBytes, blob, mime} → consumidores roteiroGenerator.js/portalGenerator.js ' +
             'não mudam. Probe endpoint confirmado público (OPTIONS 204 + POST 401 Missing Bearer = código ' +
             'alcançado, não bloqueio IAM).',
    bucket: 'small', multiplierIds: ['investigation', 'integration'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.15, desenvolvimento: 0.5, testes: 0.2, documentacao: 0.1, implantacao: 0.1 },
    module: 'templates', modules: ['templates', 'roteiros'],
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
