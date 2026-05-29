const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.63.74',
  releaseSlug: '20260529-sso-cache-false-negative-fix',
  title: 'Login SSO — fix falso-negativo de cache que trancava usuário existente fora',
  summary: 'Bug reportado pela Thais Yoshitomi: "não consigo mais entrar / Erro ao criar perfil. ' +
           'Verifique as regras do Firestore (users create)". Conta existente + ativa + Auth UID batendo ' +
           'com o doc Firestore. Diagnóstico via Admin SDK (check-thais.cjs, check-thais-auth.cjs, ' +
           'dump-thais.cjs): cadeia de 1 gatilho + 2 defeitos latentes. (Gatilho) App Check (reCAPTCHA ' +
           'Enterprise) falhando no browser dela nega o read do Firestore no servidor. (Defeito A) Com ' +
           'persistentLocalCache (IndexedDB) e o doc dela NÃO cacheado (device novo/storage limpo), getDoc ' +
           'resolve exists()===false a PARTIR DO CACHE em vez de lançar → fetchUserProfile retorna null → ' +
           'cai no auto-provision SSO. Falso-negativo de cache tratado como "user não existe". (Defeito B) ' +
           'O lookup por email exclui o próprio uid (único doc dela) → mergedFromPending null → monta ' +
           'newProfile com DEFAULTS (setor/núcleos/visibleSectors vazios) → setDoc cai no doc existente como ' +
           'UPDATE → self-update rule bloqueia membro mudar role/sector/nucleos/visibleSectors → ' +
           'permission-denied → "Erro ao criar perfil". Fix cirúrgico (só caminho profile===null): re-read ' +
           'autoritativo via getDocFromServer antes de provisionar. Doc existe no servidor → usa ele (evita ' +
           'overwrite destrutivo + lockout). Read do servidor falha → erro claro + signOut, sem setDoc ' +
           'destrutivo. Logins normais e usuários genuinamente novos intactos.',
  bucket: 'small', multiplierIds: ['investigation'], profile: 'bugfix',
  hoursByCategory: { refinamento: 0.3, desenvolvimento: 0.2, testes: 0.2, documentacao: 0.15, implantacao: 0.1 },
  module: 'infra', modules: ['infra'],
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
