/**
 * PRIMETOUR — Authentication Module
 * Login, logout, gerenciamento de sessão e perfil de usuário
 */

import {
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  createUserWithEmailAndPassword,
  updateProfile,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
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
import { APP_CONFIG } from '../config.js';
import { auditLog } from './audit.js';

// ─── Observer de estado de autenticação ───────────────────
export function initAuthObserver(onReady) {
  let readyCalled = false;
  const callReady = () => {
    if (!readyCalled) { readyCalled = true; onReady && onReady(); }
  };

  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      try {
        let profile = await fetchUserProfile(firebaseUser.uid);

        // ── Auto-provisioning SSO Microsoft (@primetour.com.br) ──
        if (!profile) {
          const email = (firebaseUser.email || '').toLowerCase();
          const isSSOPrimetour = email.endsWith('@primetour.com.br')
            && firebaseUser.providerData?.some(p => p.providerId === 'microsoft.com');

          if (isSSOPrimetour) {
            // Criar perfil automaticamente com role 'member'
            const colorIdx = Math.floor(Math.random() * APP_CONFIG.avatarColors.length);
            const newProfile = {
              id:          firebaseUser.uid,
              name:        firebaseUser.displayName || email.split('@')[0],
              email:       email,
              role:        'member',
              roleId:      'member',
              nucleo:      '',
              department:  '',
              sector:      '',
              avatarColor: APP_CONFIG.avatarColors[colorIdx],
              active:      true,
              firstLogin:  true,
              deletedAt:   null,
              deletedBy:   null,
              createdAt:   serverTimestamp(),
              createdBy:   'sso-microsoft',
              lastLogin:   serverTimestamp(),
            };
            await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
            profile = { ...newProfile, id: firebaseUser.uid };

            // Audit log
            auditLog('users.sso_auto_provision', 'user', firebaseUser.uid, {
              name: newProfile.name, email, provider: 'microsoft.com',
            }).catch(() => {});

            toast.success(`Bem-vindo(a), ${newProfile.name}! Sua conta foi criada automaticamente via SSO Microsoft.`);
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

        // Carregar role e permissões ANTES de liberar o app
        const roleId  = profile.roleId || profile.role || 'member';
        const roleDoc = await getRole(roleId).catch(() => null)
          || SYSTEM_ROLES.find(r => r.id === roleId)
          || SYSTEM_ROLES.find(r => r.id === 'member');
        store.loadPermissions(roleDoc);

        // Carregar workspaces ANTES de liberar o app
        await loadUserWorkspaces().catch(() => {});

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
        loadNucleos().catch(() => {});
        loadCategories().catch(() => {});
        loadCardPrefs();

        // Aplicar paleta de cores do perfil do usuário
        const savedPalette = profile.prefs?.palette || localStorage.getItem('primetour-palette') || 'midnight';
        document.documentElement.dataset.palette = savedPalette;
        localStorage.setItem('primetour-palette', savedPalette);

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
  const result = await signInWithPopup(auth, microsoftProvider);
  const email  = (result.user.email || '').toLowerCase();

  // Dupla validação de domínio (segurança — tenant param já restringe)
  if (!email.endsWith('@primetour.com.br')) {
    await firebaseSignOut(auth);
    throw new Error('SSO restrito a contas @primetour.com.br');
  }

  // O initAuthObserver cuida do resto (auto-provisioning + carregamento de perfil)
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
export async function createUser({ name, email, password, role, roleId, department = '', nucleo = '', sector = '' }) {
  if (!store.can('system_manage_users')) throw new Error('Permissão negada.');

  let uid;
  let isRecovery = false;

  try {
    // Tenta criar no Firebase Auth via instância secundária
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth, email.trim(), password
    );
    uid = credential.user.uid;

    // Atualizar displayName no Auth
    await updateProfile(credential.user, { displayName: name }).catch(() => {});

    // Deslogar instância secundária imediatamente
    await firebaseSignOut(secondaryAuth);

  } catch (authErr) {
    // Se e-mail já existe no Auth, tenta fazer login para recuperar o UID
    if (authErr.code === 'auth/email-already-in-use') {
      try {
        const cred = await signInWithEmailAndPassword(secondaryAuth, email.trim(), password);
        uid = cred.user.uid;
        await updateProfile(cred.user, { displayName: name }).catch(() => {});
        await firebaseSignOut(secondaryAuth);
        isRecovery = true;
      } catch (loginErr) {
        // Senha diferente ou conta desabilitada — não consegue recuperar
        await firebaseSignOut(secondaryAuth).catch(() => {});
        throw new Error(
          'Este e-mail já existe no sistema de autenticação. ' +
          'Para reativar, use a mesma senha anterior ou redefina a senha pelo Firebase Console.'
        );
      }
    } else {
      throw authErr;
    }
  }

  // Gerar cor de avatar
  const colorIdx = Math.floor(Math.random() * APP_CONFIG.avatarColors.length);
  const avatarColor = APP_CONFIG.avatarColors[colorIdx];

  // Criar/recriar documento no Firestore
  const userDoc = {
    id:           uid,
    name:         name.trim(),
    email:        email.trim().toLowerCase(),
    role:         role || roleId,    // mantido para compatibilidade
    roleId:       roleId || role,    // novo campo RBAC
    nucleo:       (nucleo || department).trim(),
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

  await setDoc(doc(db, 'users', uid), userDoc);

  // Auditoria
  await auditLog(isRecovery ? 'users.recover' : 'users.create', 'user', uid, {
    name, email, role: role || roleId, department: nucleo || department, isRecovery,
  });

  return { id: uid, ...userDoc };
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
  ];
  const adminFields = [
    'role', 'roleId', 'active',
    'nucleo', 'sector', 'visibleSectors',
  ];

  const updateData = {};
  allowedFields.forEach(f => { if (data[f] !== undefined) updateData[f] = data[f]; });

  if (store.can('system_manage_users')) {
    adminFields.forEach(f => { if (data[f] !== undefined) updateData[f] = data[f]; });
  }

  updateData.updatedAt = serverTimestamp();
  updateData.updatedBy = currentUser.uid;

  await updateDoc(doc(db, 'users', uid), updateData);

  // Se atualizou o próprio perfil, sincronizar no store
  if (isOwner) {
    const updated = { ...store.get('userProfile'), ...updateData };
    store.set('userProfile', updated);
  }

  await auditLog('users.update', 'user', uid, updateData);
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
