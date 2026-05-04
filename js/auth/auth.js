/**
 * PRIMETOUR — Authentication Module
 * Login, logout, gerenciamento de sessão e perfil de usuário
 */

import {
  signInWithEmailAndPassword,
  signInWithPopup,
  linkWithCredential,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updatePassword,
  EmailAuthProvider,
  OAuthProvider,
  reauthenticateWithCredential,
  createUserWithEmailAndPassword,
  updateProfile,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  collection,
  serverTimestamp,
  onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { auth, secondaryAuth, db, microsoftProvider } from '../firebase.js';
import { getRole, initSystemRoles, SYSTEM_ROLES } from '../services/rbac.js';
import { loadUserWorkspaces }          from '../services/workspaces.js';
import { loadNucleos }                  from '../services/sectors.js';
import { loadCategories }              from '../services/taskCategories.js';
import { loadCardPrefs }               from '../services/cardPrefs.js';
import { initSystemTaskTypes, loadTaskTypes } from '../services/taskTypes.js';
import { store }   from '../store.js';
import { toast }   from '../components/toast.js';
import { APP_CONFIG, ALLOWED_SSO_DOMAINS, isAllowedSSODomain } from '../config.js';
import { auditLog } from './audit.js';

// ─── Observer de estado de autenticação ───────────────────

// Listener tempo-real do doc do user logado.
// Quando admin muda role/setor/permissões/active do user, isso propaga
// na hora pra todas as abas abertas (sem F5). Antes, mudanças só
// aplicavam no próximo login.
let _userProfileUnsub = null;

export function initAuthObserver(onReady) {
  let readyCalled = false;
  const callReady = () => {
    if (!readyCalled) { readyCalled = true; onReady && onReady(); }
  };

  // Restaura access token Microsoft (SharePoint/OneDrive) do sessionStorage
  try {
    const t = sessionStorage.getItem('ms-access-token');
    const exp = parseInt(sessionStorage.getItem('ms-token-expires') || '0');
    if (t && exp && Date.now() < exp) {
      store.set('msAccessToken', t);
      store.set('msAccessTokenExpiresAt', exp);
    } else if (t) {
      sessionStorage.removeItem('ms-access-token');
      sessionStorage.removeItem('ms-token-expires');
    }
  } catch {}

  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      try {
        let profile = await fetchUserProfile(firebaseUser.uid);

        // ── Auto-provisioning SSO Microsoft (domínios corporativos) ──
        if (!profile) {
          const email = (firebaseUser.email || '').toLowerCase();
          const isSSOPrimetour = isAllowedSSODomain(email)
            && firebaseUser.providerData?.some(p => p.providerId === 'microsoft.com');

          if (isSSOPrimetour) {
            // Extrair nome do Microsoft — displayName ou fallback formatado do email
            const msProvider = firebaseUser.providerData?.find(p => p.providerId === 'microsoft.com');
            const rawName = firebaseUser.displayName
              || msProvider?.displayName
              || email.split('@')[0];
            // Formatar "joao.silva" → "Joao Silva"
            const formattedName = rawName.includes('.')
              ? rawName.split('.').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
              : rawName;

            // ── 1) Tenta consolidar doc PENDENTE pré-cadastrado pelo admin ──
            // Quando admin cria usuário SSO via UI, o doc é gravado com
            // pendingSso: true e ID temporário (pending_email_dot_dot). Aqui
            // detectamos esse doc por email, copiamos role/setor/núcleos
            // pré-configurados, criamos o doc final keyed pelo UID do Firebase
            // Auth e apagamos o pendente.
            //
            // BUG FIX (04/05/26): a versão antiga usava
            //   where('email', '==', X) + where('pendingSso', '==', true)
            // que exige um composite index que NUNCA foi criado no Firestore.
            // Resultado: query falhava silenciosamente → mergedFromPending=null
            // → todos os pending users (9) viravam member padrão sem setor.
            // Gabrielle (master) ficou presa em "sem workspace" por isso.
            // Solução: query single-field + filter client-side. Idempotente e
            // sem dependência de index management.
            let mergedFromPending = null;
            try {
              const pendQ = query(
                collection(db, 'users'),
                where('email', '==', email),
              );
              const pendSnap = await getDocs(pendQ);
              const pendingDoc = pendSnap.docs.find(d => d.data().pendingSso === true);
              if (pendingDoc) {
                mergedFromPending = { id: pendingDoc.id, ...pendingDoc.data() };
              }
            } catch (lookupErr) {
              console.warn('[SSO] Falha ao buscar doc pendente:', lookupErr.message);
            }

            // ── 2) Monta o perfil final ──
            //   - Se existe doc pendente → usa role/setor/núcleos pré-cadastrados.
            //   - Caso contrário → defaults (role 'member', sem setor).
            const colorIdx = Math.floor(Math.random() * APP_CONFIG.avatarColors.length);
            const newProfile = {
              id:          firebaseUser.uid,
              name:        mergedFromPending?.name || formattedName,
              email:       email,
              phone:       msProvider?.phoneNumber || '',
              role:        mergedFromPending?.role   || 'member',
              roleId:      mergedFromPending?.roleId || mergedFromPending?.role || 'member',
              nucleo:      mergedFromPending?.nucleo || '',
              nucleos:     mergedFromPending?.nucleos || [],
              department:  mergedFromPending?.department || '',
              sector:      mergedFromPending?.sector || '',
              visibleSectors: mergedFromPending?.visibleSectors || [],
              avatarColor: mergedFromPending?.avatarColor || APP_CONFIG.avatarColors[colorIdx],
              active:      true,
              firstLogin:  true,
              deletedAt:   null,
              deletedBy:   null,
              createdAt:   mergedFromPending?.createdAt || serverTimestamp(),
              createdBy:   mergedFromPending?.createdBy || 'sso-microsoft',
              lastLogin:   serverTimestamp(),
            };

            try {
              await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);

              // ── Re-bind workspaces e tasks: pendingId → newUid ──
              // O migrateUserToSso/createUser deixaram o pendingId nos arrays
              // members/adminIds das squads que o admin já tinha atribuído.
              // Aqui consolidamos: troca o pendingId pelo UID definitivo do
              // Firebase Auth. Sem isso, o user entra mas a tela de Squads
              // não mostra os squads dele e cai em "sem workspace".
              if (mergedFromPending?.id) {
                const pendingId = mergedFromPending.id;
                const newUid    = firebaseUser.uid;
                try {
                  const fb = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                  const wsQ = query(collection(db, 'workspaces'),
                    where('members', 'array-contains', pendingId));
                  const wsSnap = await getDocs(wsQ);
                  await Promise.all(wsSnap.docs.map(async (wsDoc) => {
                    const data = wsDoc.data();
                    await updateDoc(wsDoc.ref, { members: fb.arrayRemove(pendingId) });
                    await updateDoc(wsDoc.ref, { members: fb.arrayUnion(newUid) });
                    if ((data.adminIds || []).includes(pendingId)) {
                      await updateDoc(wsDoc.ref, { adminIds: fb.arrayRemove(pendingId) });
                      await updateDoc(wsDoc.ref, { adminIds: fb.arrayUnion(newUid) });
                    }
                  }));
                  if (wsSnap.size > 0) {
                    console.log(`[SSO] Re-vinculou ${wsSnap.size} squads de ${pendingId} → ${newUid}`);
                  }
                } catch (rebindErr) {
                  console.warn('[SSO] Re-bind de squads falhou:', rebindErr.message);
                }
              }

              // Apaga o stub pendente (já consolidado no UID definitivo)
              if (mergedFromPending?.id) {
                await deleteDoc(doc(db, 'users', mergedFromPending.id)).catch(() => {});
              }
              console.log('[SSO] Perfil criado com sucesso:', formattedName, email,
                mergedFromPending ? '(consolidado de pré-cadastro admin)' : '(novo, defaults)');
            } catch (writeErr) {
              console.error('[SSO] Erro ao criar perfil no Firestore:', writeErr);
              toast.error('Erro ao criar perfil. Verifique as regras do Firestore (users create).');
              await signOut().catch(() => {});
              store.set('authLoading', false);
              callReady();
              return;
            }

            profile = { ...newProfile, id: firebaseUser.uid };

            // Audit log
            auditLog('users.sso_auto_provision', 'user', firebaseUser.uid, {
              name: newProfile.name, email,
              provider: 'microsoft.com',
              consolidatedFromPending: !!mergedFromPending,
              role: newProfile.role,
            }).catch(() => {});

            const welcome = mergedFromPending
              ? `Bem-vindo(a), ${newProfile.name}! Sua conta foi ativada com a role ${newProfile.role}.`
              : `Bem-vindo(a), ${newProfile.name}! Sua conta foi criada automaticamente via SSO Microsoft.`;
            toast.success(welcome);
          } else {
            await signOut().catch(() => {});
            toast.error('Perfil não encontrado. Contate o administrador.');
            store.set('authLoading', false);
            callReady();
            return;
          }
        }

        if (!profile.active) {
          await signOut().catch(() => {});
          toast.error('Conta desativada. Contate o administrador.');
          store.set('authLoading', false);
          callReady();
          return;
        }

        // Inicializar roles padrão se necessário (silencioso)
        initSystemRoles().catch(() => {});

        // Atualizar último login (silencioso)
        updateDoc(doc(db, 'users', firebaseUser.uid), {
          lastLogin: serverTimestamp()
        }).catch(() => {});

        store.set('currentUser',     firebaseUser);
        store.set('userProfile',     profile);

        // Carregar role + workspaces em paralelo (otimização de latência)
        const roleId = profile.roleId || profile.role || 'member';
        const [roleDoc, _ws] = await Promise.all([
          getRole(roleId).catch(() => null),
          loadUserWorkspaces().catch(() => {}),
        ]);
        const finalRole = roleDoc
          || SYSTEM_ROLES.find(r => r.id === roleId)
          || SYSTEM_ROLES.find(r => r.id === 'member');
        store.loadPermissions(finalRole);

        // ── Listener tempo-real do próprio perfil ──
        // Sem isto: mudança de role pelo admin só vale no próximo login (F5).
        // Com isto: quando admin promove/rebaixa, o user vê a UI se reconfigurar
        // imediatamente (toast + recarrega permissões).
        if (_userProfileUnsub) { try { _userProfileUnsub(); } catch {} }
        let lastKnownRoleId = profile.roleId || profile.role;
        let lastKnownActive = profile.active !== false;
        _userProfileUnsub = onSnapshot(
          doc(db, 'users', firebaseUser.uid),
          async (snap) => {
            if (!snap.exists()) return;
            const fresh = { id: snap.id, ...snap.data() };

            // Conta foi desativada enquanto user estava logado → forçar logout.
            if (fresh.active === false && lastKnownActive === true) {
              toast.error('Sua conta foi desativada pelo administrador.');
              await signOut().catch(() => {});
              return;
            }
            lastKnownActive = fresh.active !== false;

            // Sempre atualiza o profile no store (sector/núcleos/visibleSectors
            // mudam com frequência e a UI lê do store).
            store.set('userProfile', fresh);

            // Re-aplicar setor/visibleSectors caso admin tenha alterado
            const userSector = fresh.sector || fresh.department
              || (fresh.visibleSectors?.length === 1 ? fresh.visibleSectors[0] : null)
              || null;
            store.set('userSector', userSector);
            const newVisibleSectors = Array.isArray(fresh.visibleSectors) && fresh.visibleSectors.length > 0
              ? fresh.visibleSectors
              : (userSector ? [userSector] : []);
            store.set('visibleSectors', newVisibleSectors);

            // Role mudou? Recarrega permissões + avisa o usuário.
            const newRoleId = fresh.roleId || fresh.role;
            if (newRoleId && newRoleId !== lastKnownRoleId) {
              try {
                const newRoleDoc = await getRole(newRoleId).catch(() => null);
                const finalNewRole = newRoleDoc
                  || SYSTEM_ROLES.find(r => r.id === newRoleId)
                  || SYSTEM_ROLES.find(r => r.id === 'member');
                store.loadPermissions(finalNewRole);
                toast.info(`Sua role foi atualizada para: ${finalNewRole.name || newRoleId}`);
                // Re-render sidebar pra refletir items que viraram visíveis/ocultos
                document.dispatchEvent(new CustomEvent('user:role-changed', {
                  detail: { newRole: finalNewRole },
                }));
              } catch (e) {
                console.warn('Falha ao recarregar permissões:', e);
              }
              lastKnownRoleId = newRoleId;
            }
          },
          (err) => {
            // Listener falhou — não fatal, user continua com permissões antigas até F5
            console.warn('[Auth] userProfile snapshot listener err:', err.message);
          }
        );

        // Definir setor do usuário no store
        const userSector = profile.sector || profile.department
          || (profile.visibleSectors?.length === 1 ? profile.visibleSectors[0] : null)
          || null;
        store.set('userSector', userSector);
        // visibleSectors: Head pode ter array definido pela Diretoria
        // Fallback: usa userSector se não houver array explícito
        const rawVisibleSectors = Array.isArray(profile.visibleSectors) && profile.visibleSectors.length > 0
          ? profile.visibleSectors
          : (userSector ? [userSector] : []);
        store.set('visibleSectors', rawVisibleSectors);

        // Carregar núcleos, categorias e preferências de card
        Promise.all([
          loadNucleos().catch(() => {}),
          loadCategories().catch(() => {}),
          Promise.resolve(loadCardPrefs()).catch(() => {}),
        ]).catch(() => {});

        // Aplicar paleta de cores do perfil do usuário
        const savedPalette = profile.prefs?.palette || localStorage.getItem('primetour-palette') || 'portal';
        document.documentElement.dataset.palette = savedPalette;
        localStorage.setItem('primetour-palette', savedPalette);

        // Aplicar fonte do perfil do usuário
        const savedFont = profile.prefs?.font || localStorage.getItem('primetour-font') || 'outfit';
        if (savedFont && savedFont !== 'outfit') {
          document.documentElement.dataset.font = savedFont;
        } else {
          delete document.documentElement.dataset.font;
        }
        localStorage.setItem('primetour-font', savedFont);

        // Só agora libera o app — permissões e workspaces já estão no store
        store.set('isAuthenticated', true);
        store.set('authLoading', false);

        // Inicializar e carregar tipos de tarefa (silencioso)
        initSystemTaskTypes().catch(() => {});
        loadTaskTypes().catch(() => {});

        // Audit login (silencioso — não bloqueia)
        auditLog('auth.login', 'session', null, {
          userName: profile.name,
          email:    profile.email,
        }).catch(() => {});

        // Server-side audit (com IP/UA, detecção de IP novo)
        // Não bloqueia o login — fire and forget
        (async () => {
          try {
            const { app } = await import('../firebase.js');
            const fb = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
            const fn = fb.httpsCallable(fb.getFunctions(app, 'us-central1'), 'logUserLogin');
            const provider = firebaseUser.providerData?.[0]?.providerId || 'unknown';
            await fn({ provider, userAgent: navigator.userAgent });
          } catch {}
        })();

        // ─── Automation services (lazy, non-blocking) ───
        Promise.resolve().then(async () => {
          const [
            { checkSlaAlerts },
            { checkStaleTasks },
            { runAutoArchive },
            { generateDailySummary },
          ] = await Promise.all([
            import('../services/slaAlerts.js'),
            import('../services/staleTaskNudge.js'),
            import('../services/autoArchive.js'),
            import('../services/dailySummary.js'),
          ]);
          checkSlaAlerts().catch(() => {});
          checkStaleTasks().catch(() => {});
          runAutoArchive().catch(() => {});
          generateDailySummary().catch(() => {});
        }).catch(() => {});

      } catch (err) {
        console.error('Auth state error:', err);
        // Se for erro de permissão do Firestore, ainda assim redirecionar
        if (err.code === 'permission-denied' || err.code === 'unavailable') {
          store.set('currentUser',     firebaseUser);
          store.set('isAuthenticated', true);
          toast.warning('Aviso: problema ao carregar perfil. Verifique as regras do Firestore.');
        }
        store.set('authLoading', false);
      }
    } else {
      // Cleanup do listener de profile real-time pra não vazar memória/quota
      if (_userProfileUnsub) {
        try { _userProfileUnsub(); } catch {}
        _userProfileUnsub = null;
      }
      store.set('currentUser',     null);
      store.set('userProfile',     null);
      store.set('isAuthenticated', false);
      store.set('authLoading',     false);
    }

    callReady();
  });
}

// ─── Login ────────────────────────────────────────────────
export async function signIn(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  return credential.user;
}

// ─── Login SSO Microsoft ──────────────────────────────────
export async function signInWithMicrosoft() {
  try {
    const result = await signInWithPopup(auth, microsoftProvider);
    const email  = (result.user.email || '').toLowerCase();

    // Dupla validação de domínio (segurança — tenant é 'organizations',
    // então a única barreira de domínio é esta verificação no app).
    if (!isAllowedSSODomain(email)) {
      await firebaseSignOut(auth);
      const allowed = ALLOWED_SSO_DOMAINS.map(d => '@' + d).join(', ');
      throw new Error(`SSO restrito aos domínios: ${allowed}`);
    }

    // Captura access token Microsoft pra usar em SharePoint/OneDrive
    // (precisa pra IA Hub agentes lerem knowledge desses serviços)
    try {
      const credential = OAuthProvider.credentialFromResult(result);
      const accessToken = credential?.accessToken;
      if (accessToken) {
        store.set('msAccessToken', accessToken);
        // Persiste em sessionStorage pra não perder ao recarregar
        try { sessionStorage.setItem('ms-access-token', accessToken); } catch {}
        // Salva expiração (~1h) pra refresh proativo
        const expiresAt = Date.now() + 50 * 60 * 1000;
        store.set('msAccessTokenExpiresAt', expiresAt);
        try { sessionStorage.setItem('ms-token-expires', String(expiresAt)); } catch {}
      }
    } catch (e) { console.warn('[auth] MS token capture err:', e?.message); }

    // O initAuthObserver cuida do resto (auto-provisioning + carregamento de perfil)
    return result.user;
  } catch (err) {
    // Conta já existe com email/senha — precisa vincular manualmente
    if (err.code === 'auth/account-exists-with-different-credential') {
      const pendingCred = OAuthProvider.credentialFromError(err);
      const email = err.customData?.email || '';
      // Propaga erro enriquecido para o login.js tratar com UI
      const linkError = new Error('LINK_REQUIRED');
      linkError.code = 'auth/account-exists-with-different-credential';
      linkError.pendingCredential = pendingCred;
      linkError.email = email;
      throw linkError;
    }
    throw err;
  }
}

// ─── Vincular Microsoft a conta existente (email/senha) ───
export async function linkMicrosoftToExistingAccount(email, password, pendingCredential) {
  // 1. Login com email/senha
  const result = await signInWithEmailAndPassword(auth, email.trim(), password);

  // 2. Vincular o credential Microsoft à conta
  await linkWithCredential(result.user, pendingCredential);

  // 3. Retorna user — onAuthStateChanged cuida do resto
  return result.user;
}

// ─── Logout ───────────────────────────────────────────────
export async function signOut() {
  const user = store.get('userProfile');
  if (user) {
    await auditLog('auth.logout', 'session', null, {
      userName: user.name,
      email: user.email
    }).catch(() => {});
  }
  await firebaseSignOut(auth);
}

// ─── Recuperação de senha ──────────────────────────────────
export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email.trim());
}

// ─── Buscar perfil do Firestore ────────────────────────────
export async function fetchUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ─── Criar usuário (somente admins) ───────────────────────
/**
 * Cria um usuário no sistema.
 *
 * COMPORTAMENTO POR DOMÍNIO:
 *
 * 1) Email em domínio SSO autorizado (@primetour.com.br, @primetravel.tur.br,
 *    @primetouroperator.com.br):
 *    NÃO cria credencial Firebase Auth (email/senha). Cria apenas um doc
 *    Firestore "pendente" (flag pendingSso: true) com a role/setor/núcleos
 *    pré-configurados pelo admin. Quando o usuário entrar pela primeira vez
 *    via Microsoft SSO, o auto-provision em initAuthObserver consolida esse
 *    doc no UID definitivo do Firebase Auth (ver mergePendingSsoProfile).
 *
 *    Por que? Antes esta função criava credencial email/senha mesmo p/ users
 *    SSO. Resultado: Firebase Auth registrava o email, e na hora do SSO ele
 *    detectava colisão (auth/account-exists-with-different-credential) e
 *    forçava a tela de "Vincular conta Microsoft" pedindo a senha original
 *    — que o usuário nunca soube. Era exatamente o "senha incorreta no SSO"
 *    reportado pelos usuários.
 *
 * 2) Email em domínio externo (cliente, freelancer, etc):
 *    Mantém o fluxo legado — cria credencial email/senha + doc Firestore com
 *    UID gerado pelo Auth.
 *
 * @param {object} args - dados do usuário
 * @param {string} args.password - obrigatório só para domínios não-SSO
 */
export async function createUser({ name, email, password, role, roleId, department = '', nucleo = '', nucleos = [], sector = '' }) {
  if (!store.can('system_manage_users')) throw new Error('Permissão negada.');

  const cleanEmail = email.trim().toLowerCase();
  const isSsoUser = isAllowedSSODomain(cleanEmail);

  // Gerar cor de avatar (compartilhado entre os dois fluxos)
  const colorIdx = Math.floor(Math.random() * APP_CONFIG.avatarColors.length);
  const avatarColor = APP_CONFIG.avatarColors[colorIdx];

  const baseDoc = {
    name:         name.trim(),
    email:        cleanEmail,
    role:         role || roleId,    // mantido para compatibilidade
    roleId:       roleId || role,    // novo campo RBAC
    nucleo:       (nucleo || department).trim(),
    nucleos:      Array.isArray(nucleos) && nucleos.length
                    ? nucleos.map(n => String(n||'').trim()).filter(Boolean)
                    : ((nucleo || department).trim() ? [(nucleo || department).trim()] : []),
    department:   (nucleo || department).trim(),
    sector:       (sector || '').trim(),
    avatarColor:  avatarColor,
    active:       true,
    firstLogin:   true,
    deletedAt:    null,
    deletedBy:    null,
    createdAt:    serverTimestamp(),
    createdBy:    store.get('currentUser').uid,
    lastLogin:    null,
  };

  // ── FLUXO SSO: cria só o doc pendente (sem Auth credential) ──
  if (isSsoUser) {
    // Verifica se já existe outro doc (pendente ou consolidado) com o mesmo email
    // pra evitar duplicações silenciosas.
    const { getDocs, query, where, collection: col } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const dupQ = query(col(db, 'users'), where('email', '==', cleanEmail));
    const dupSnap = await getDocs(dupQ);
    if (!dupSnap.empty) {
      throw new Error(`Já existe um usuário cadastrado com ${cleanEmail}.`);
    }

    // Doc keyed pelo email-slug pra ser idempotente e fácil de querelar.
    // (Firestore aceita "/" no doc ID? Não — então sanitiza @ e . pra _)
    const docKey = `pending_${cleanEmail.replace(/[@.]/g, '_')}`;
    const pendingDoc = {
      ...baseDoc,
      id:         docKey,
      pendingSso: true,
      authProvider: 'microsoft.com',
    };
    await setDoc(doc(db, 'users', docKey), pendingDoc);

    await auditLog('users.create', 'user', docKey, {
      name, email: cleanEmail, role: role || roleId,
      sector: (sector || '').trim(), nucleos: pendingDoc.nucleos,
      pendingSso: true,
    });

    try {
      const { invalidateUsersCache } = await import('../services/users.js');
      invalidateUsersCache();
    } catch {}

    return pendingDoc;
  }

  // ── FLUXO NÃO-SSO (legado): cria Auth credential + doc com UID do Auth ──
  if (!password || password.length < 6) {
    throw new Error('Senha de no mínimo 6 caracteres é obrigatória para usuários externos (não SSO).');
  }

  let uid;
  let isRecovery = false;

  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth, cleanEmail, password
    );
    uid = credential.user.uid;
    await updateProfile(credential.user, { displayName: name }).catch(() => {});
    await firebaseSignOut(secondaryAuth);
  } catch (authErr) {
    if (authErr.code === 'auth/email-already-in-use') {
      try {
        const cred = await signInWithEmailAndPassword(secondaryAuth, cleanEmail, password);
        uid = cred.user.uid;
        await updateProfile(cred.user, { displayName: name }).catch(() => {});
        await firebaseSignOut(secondaryAuth);
        isRecovery = true;
      } catch (loginErr) {
        await firebaseSignOut(secondaryAuth).catch(() => {});
        throw new Error(
          'Não foi possível criar a conta. Verifique os dados ou contate o administrador.'
        );
      }
    } else {
      throw authErr;
    }
  }

  const userDoc = { ...baseDoc, id: uid };
  await setDoc(doc(db, 'users', uid), userDoc);

  await auditLog(isRecovery ? 'users.recover' : 'users.create', 'user', uid, {
    name, email: cleanEmail,
    role: role || roleId,
    sector: (sector || '').trim(),
    nucleos: userDoc.nucleos,
    isRecovery,
  });

  try {
    const { invalidateUsersCache } = await import('../services/users.js');
    invalidateUsersCache();
  } catch {}

  return userDoc;
}

// ─── Atualizar perfil ─────────────────────────────────────
export async function updateUserProfile(uid, data) {
  const currentUser = store.get('currentUser');
  const isOwner = currentUser?.uid === uid;

  if (!store.can('system_manage_users') && !isOwner) {
    throw new Error('Permissão negada.');
  }

  // Campos permitidos para update (owner ou admin)
  const allowedFields = [
    'name', 'department', 'phone', 'jobTitle', 'bio',
    'avatarColor', 'prefs', 'firstLogin',
    'admissionDate', 'hireDate',  // data de admissão pra cálculo de férias
    'toursCompleted',             // tours guiados que o user já fez
  ];
  const adminFields = [
    'role', 'roleId', 'active',
    'nucleo', 'nucleos', 'sector', 'visibleSectors',
  ];

  const updateData = {};
  allowedFields.forEach(f => { if (data[f] !== undefined) updateData[f] = data[f]; });

  if (store.can('system_manage_users')) {
    adminFields.forEach(f => { if (data[f] !== undefined) updateData[f] = data[f]; });
  }

  updateData.updatedAt = serverTimestamp();
  updateData.updatedBy = currentUser.uid;

  // Update com fallback robusto: se o doc com `uid` não existe (caso comum
  // após migração SSO — UI tinha pending_email_dot_dot stale enquanto o
  // doc real foi consolidado pra UID novo), procura por email e tenta de
  // novo no doc encontrado. Sem isso, admin via tela "FirebaseError: No
  // document to update" e ficava preso editando users migrados.
  let actualDocId = uid;
  try {
    await updateDoc(doc(db, 'users', uid), updateData);
  } catch (err) {
    const isMissing = err.code === 'not-found'
      || /no document to update/i.test(err.message || '');
    if (!isMissing) throw err;

    // Lookup alternativo: o user em memória tem email; buscamos por ele
    // pra encontrar o ID atual real (que pode ser diferente do stale).
    const cachedProfile = (store.get('users') || []).find(u => u.id === uid);
    const lookupEmail = (cachedProfile?.email || '').toLowerCase();
    if (!lookupEmail) {
      throw new Error('Usuário não encontrado (doc ausente e sem email pra lookup).');
    }

    const altQ = query(collection(db, 'users'), where('email', '==', lookupEmail));
    const altSnap = await getDocs(altQ);
    if (altSnap.empty) {
      throw new Error(`Usuário com email ${lookupEmail} não encontrado em nenhum doc.`);
    }
    // Prefere doc consolidado (não-pending) se houver mais de um
    const target = altSnap.docs.find(d => !d.id.startsWith('pending_'))
      || altSnap.docs[0];
    actualDocId = target.id;
    await updateDoc(target.ref, updateData);
  }

  // Se atualizou o próprio perfil, sincronizar no store
  if (isOwner) {
    const updated = { ...store.get('userProfile'), ...updateData };
    store.set('userProfile', updated);
  }

  await auditLog('users.update', 'user', actualDocId, updateData);

  try {
    const { invalidateUsersCache } = await import('../services/users.js');
    invalidateUsersCache();
  } catch {}
}

// ─── Alterar senha ────────────────────────────────────────
export async function changePassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user) throw new Error('Não autenticado.');

  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
  
  toast.success('Senha alterada com sucesso!');
}

// ─── Desativar usuário ────────────────────────────────────
export async function deactivateUser(uid) {
  if (!store.can('system_manage_users')) throw new Error('Permissão negada.');
  
  const currentUser = store.get('currentUser');
  if (uid === currentUser.uid) throw new Error('Não é possível desativar sua própria conta.');

  await updateDoc(doc(db, 'users', uid), {
    active: false,
    deactivatedAt: serverTimestamp(),
    deactivatedBy: currentUser.uid
  });

  await auditLog('users.deactivate', 'user', uid, {});

  try {
    const { invalidateUsersCache } = await import('../services/users.js');
    invalidateUsersCache();
  } catch {}
}

// ─── Reativar usuário ─────────────────────────────────────
export async function reactivateUser(uid) {
  if (!store.can('system_manage_users')) throw new Error('Permissão negada.');

  await updateDoc(doc(db, 'users', uid), {
    active: true,
    reactivatedAt: serverTimestamp(),
    reactivatedBy: store.get('currentUser').uid
  });

  await auditLog('users.reactivate', 'user', uid, {});

  try {
    const { invalidateUsersCache } = await import('../services/users.js');
    invalidateUsersCache();
  } catch {}
}

// ─── Helpers ──────────────────────────────────────────────
export function getErrorMessage(code) {
  const messages = {
    'auth/user-not-found':       'E-mail não encontrado.',
    'auth/wrong-password':       'Senha incorreta.',
    'auth/invalid-email':        'E-mail inválido.',
    'auth/user-disabled':        'Conta desativada.',
    'auth/too-many-requests':    'Muitas tentativas. Tente mais tarde.',
    'auth/email-already-in-use': 'Este e-mail já está em uso.',
    'auth/weak-password':        'Senha muito fraca (mínimo 6 caracteres).',
    'auth/network-request-failed': 'Erro de conexão. Verifique sua internet.',
    'auth/invalid-credential':   'E-mail ou senha incorretos.',
    'auth/popup-closed-by-user': 'Login cancelado. A janela foi fechada.',
    'auth/popup-blocked':        'Pop-up bloqueado pelo navegador. Permita pop-ups e tente novamente.',
    'auth/account-exists-with-different-credential': 'Este e-mail já possui conta com outro método de login. Tente e-mail/senha.',
    'auth/cancelled-popup-request': 'Outra janela de login já está aberta.',
  };
  return messages[code] || 'Erro inesperado. Tente novamente.';
}
