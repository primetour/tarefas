/**
 * Cria/atualiza pseudo-user "Sistema PRIMETOUR" pra atribuir actorId='system'
 * em notificações geradas por scheduled CFs.
 *
 * Roda uma vez. Idempotente — set merge:true.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

(async () => {
  const SYS_UID = 'system';
  const ref = db.collection('users').doc(SYS_UID);
  await ref.set({
    id: SYS_UID,
    name: 'Sistema PRIMETOUR',
    email: 'noreply@primetour.com.br',
    active: false,             // não pode logar
    isSystem: true,            // flag pra renderers detectarem
    roleId: null,
    sector: null,
    nucleos: [],
    workspaceIds: [],
    avatarColor: '#6B7280',    // cinza neutro
    createdAt: FV.serverTimestamp(),
    updatedAt: FV.serverTimestamp(),
    notes: 'Pseudo-user pra notifications geradas por scheduled CFs (SLA, stale, deadline, daily summary). Não loga, não recebe notifs. Vide CHANGELOG v4.57.33.',
  }, { merge: true });
  console.log(`+ users/${SYS_UID} criado/atualizado (Sistema PRIMETOUR)`);
  process.exit(0);
})();
