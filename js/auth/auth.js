/**
 * PRIMETOUR — Authentication Module
 * Login, logout, gerenciamento de sessão e perfil de usuário
 */

import {
  signInWithEmailAndPassword,
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

import { auth, secondaryAuth, db } from '../firebase.js';
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
        const profile = await fetchUserProfile(firebaseUser.uid);

        if (!profile) {
          await signOut().catch(() => {});
          toast.error('Perfil não encontrado. Contate o administrador.');
          store.set('authLoading', false);
          callReady();
          return;
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
        store.set('isAuthenticated', true);

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

        // Só agora libera o app — permissões e workspaces já estão no store
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
export async function createUser({ name, email, password, role, department = '' }) {
  if (!store.can('system_manage_users')) throw new Error('Permissão negada.');

  // Cria no Firebase Auth via instância secundária
  const credential = await createUserWithEmailAndPassword(
    secondaryAuth, email.trim(), password
  );

  const uid = credential.user.uid;

  // Atualizar displayName no Auth
  await updateProfile(credential.user, { displayName: name }).catch(() => {});

  // Deslogar instância secundária imediatamente
  await firebaseSignOut(secondaryAuth);

  // Gerar cor de avatar
  const colorIdx = Math.floor(Math.random() * APP_CONFIG.avatarColors.length);
  const avatarColor = APP_CONFIG.avatarColors[colorIdx];

  // Criar documento no Firestore
  const userDoc = {
    id:           uid,
    name:         name.trim(),
    email:        email.trim().toLowerCase(),
    role:         role,         // mantido para compatibilidade
    roleId:       role,         // novo campo RBAC
    nucleo:       department.trim(),     // núcleo do usuário (ex: Design)
    department:   department.trim(),     // mantido por compatibilidade
    sector:       '',                    // setor preenchido separadamente
    avatarColor:  avatarColor,
    active:       true,
    firstLogin:   true,
    createdAt:    serverTimestamp(),
    createdBy:    store.get('currentUser').uid,
    lastLogin:    null,
  };

  await setDoc(doc(db, 'users', uid), userDoc);

  // Auditoria
  await auditLog('users.create', 'user', uid, {
    name, email, role, department
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
  };
  return messages[code] || 'Erro inesperado. Tente novamente.';
}
