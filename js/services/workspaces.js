/**
 * PRIMETOUR — Workspaces Service (Fase 0 Round B)
 * CRUD de workspaces, gestão de membros e convites
 */

import {
  collection, doc, getDoc, getDocs, setDoc, addDoc,
  updateDoc, deleteDoc, query, where, orderBy,
  arrayUnion, arrayRemove, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }       from '../firebase.js';
import { store }    from '../store.js';
import { auditLog } from '../auth/audit.js';

/* ─── Ícones disponíveis para workspace ─────────────────── */
export const WORKSPACE_ICONS = [
  '◈','★','◎','▤','◷','⊞','✦','◉','▣','◫',
  '🎯','📋','🚀','💡','🔧','📊','🎨','📣','🤝','⚡',
];

export const WORKSPACE_COLORS = [
  '#D4A843','#38BDF8','#22C55E','#A78BFA',
  '#F97316','#EC4899','#06B6D4','#EF4444',
  '#6366F1','#14B8A6',
];

/* ─── Criar workspace ────────────────────────────────────── */
export async function createWorkspace({ name, description = '', sector = '', color, icon, multiSector = false }) {
  if (!store.can('workspace_create')) throw new Error('Permissão negada.');
  const user = store.get('currentUser');

  const userSector = store.get('userSector');
  const wsDoc = {
    name:        name.trim(),
    description: description.trim(),
    sector:      sector.trim() || userSector || '',
    color:       color  || WORKSPACE_COLORS[0],
    icon:        icon   || WORKSPACE_ICONS[0],
    // Squad multissetor: permite membros de setores diferentes;
    // tasks/projects vinculados ao squad ficam visíveis para todos os membros
    // independente do setor de origem.
    multiSector: !!multiSector,
    ownerId:     user.uid,
    adminIds:    [user.uid],
    members:     [user.uid],
    createdAt:   serverTimestamp(),
    createdBy:   user.uid,
    updatedAt:   serverTimestamp(),
    archived:    false,
  };

  const ref = await addDoc(collection(db, 'workspaces'), wsDoc);
  await auditLog('workspaces.create', 'workspace', ref.id, { name });

  // Atualizar workspaces do usuário no store
  const ws = { id: ref.id, ...wsDoc };
  const current = store.get('userWorkspaces') || [];
  store.set('userWorkspaces', [...current, ws]);
  if (!store.get('currentWorkspace')) store.set('currentWorkspace', ws);

  return ws;
}

/* ─── Buscar workspace por ID ────────────────────────────── */
export async function getWorkspace(wsId) {
  const snap = await getDoc(doc(db, 'workspaces', wsId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/* ─── Buscar todos os workspaces do usuário ──────────────── */
export async function fetchUserWorkspaces(uid) {
  const q    = query(collection(db, 'workspaces'), where('members', 'array-contains', uid), orderBy('createdAt', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ─── Buscar todos os workspaces (master/admin) ──────────── */
export async function fetchAllWorkspaces() {
  const snap = await getDocs(query(collection(db, 'workspaces'), orderBy('createdAt', 'asc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ─── Atualizar workspace ────────────────────────────────── */
export async function updateWorkspace(wsId, { name, description, sector, color, icon, multiSector }) {
  const user = store.get('currentUser');
  const ws   = await getWorkspace(wsId);
  if (!ws) throw new Error('Workspace não encontrado.');

  const isWsAdmin = ws.adminIds?.includes(user.uid);
  if (!store.can('system_view_all') && !isWsAdmin) throw new Error('Permissão negada.');

  const patch = {
    name, description, sector, color, icon,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  };
  if (typeof multiSector === 'boolean') patch.multiSector = multiSector;

  await updateDoc(doc(db, 'workspaces', wsId), patch);
  await auditLog('workspaces.update', 'workspace', wsId, { name });

  // Atualizar store
  const updated = store.get('userWorkspaces').map(w =>
    w.id === wsId ? { ...w, name, description, sector, color, icon, ...(typeof multiSector === 'boolean' ? { multiSector } : {}) } : w
  );
  store.set('userWorkspaces', updated);
}

/* ─── Arquivar workspace ─────────────────────────────────── */
export async function archiveWorkspace(wsId) {
  const user = store.get('currentUser');
  const ws   = await getWorkspace(wsId);
  if (!ws) throw new Error('Workspace não encontrado.');

  const isWsAdmin = ws.adminIds?.includes(user.uid);
  if (!store.can('system_view_all') && !isWsAdmin) throw new Error('Permissão negada.');

  await updateDoc(doc(db, 'workspaces', wsId), { archived: true, updatedAt: serverTimestamp() });
  await auditLog('workspaces.archive', 'workspace', wsId, {});

  const updated = store.get('userWorkspaces').filter(w => w.id !== wsId);
  store.set('userWorkspaces', updated);
}

/* ─── Adicionar membro ───────────────────────────────────── */
export async function addMember(wsId, uid) {
  const user = store.get('currentUser');
  const ws   = await getWorkspace(wsId);
  if (!ws) throw new Error('Workspace não encontrado.');

  const isWsAdmin = ws.adminIds?.includes(user.uid);
  if (!store.can('system_view_all') && !isWsAdmin) throw new Error('Permissão negada.');

  await updateDoc(doc(db, 'workspaces', wsId), {
    members:   arrayUnion(uid),
    updatedAt: serverTimestamp(),
  });
  await auditLog('workspaces.add_member', 'workspace', wsId, { uid });
}

/* ─── Remover membro ─────────────────────────────────────── */
export async function removeMember(wsId, uid) {
  const user = store.get('currentUser');
  const ws   = await getWorkspace(wsId);
  if (!ws) throw new Error('Workspace não encontrado.');

  const isWsAdmin = ws.adminIds?.includes(user.uid);
  if (!store.can('system_view_all') && !isWsAdmin) throw new Error('Permissão negada.');
  if (uid === ws.ownerId) throw new Error('O dono do workspace não pode ser removido.');

  await updateDoc(doc(db, 'workspaces', wsId), {
    members:   arrayRemove(uid),
    adminIds:  arrayRemove(uid),
    updatedAt: serverTimestamp(),
  });
  await auditLog('workspaces.remove_member', 'workspace', wsId, { uid });
}

/* ─── Promover/rebaixar admin do workspace ───────────────── */
export async function toggleWorkspaceAdmin(wsId, uid, makeAdmin) {
  const user = store.get('currentUser');
  const ws   = await getWorkspace(wsId);
  if (!ws) throw new Error('Workspace não encontrado.');

  const isWsAdmin = ws.adminIds?.includes(user.uid);
  if (!store.can('system_view_all') && !isWsAdmin) throw new Error('Permissão negada.');
  if (uid === ws.ownerId && !makeAdmin) throw new Error('O dono não pode ser rebaixado.');

  await updateDoc(doc(db, 'workspaces', wsId), {
    adminIds:  makeAdmin ? arrayUnion(uid) : arrayRemove(uid),
    updatedAt: serverTimestamp(),
  });
  await auditLog(makeAdmin ? 'workspaces.promote_admin' : 'workspaces.demote_admin', 'workspace', wsId, { uid });
}

/* ─── Criar convite ──────────────────────────────────────── */
export async function createInvite(wsId, email) {
  const user = store.get('currentUser');
  const ws   = await getWorkspace(wsId);
  if (!ws) throw new Error('Workspace não encontrado.');

  const isWsAdmin = ws.adminIds?.includes(user.uid);
  if (!store.can('workspace_invite') && !isWsAdmin) throw new Error('Permissão negada.');

  // Verificar se já existe convite pendente
  const existing = await getDocs(query(
    collection(db, 'workspace_invites'),
    where('workspaceId', '==', wsId),
    where('email', '==', email.toLowerCase()),
    where('status', '==', 'pending'),
  ));
  if (!existing.empty) throw new Error('Já existe um convite pendente para este e-mail.');

  const token  = crypto.randomUUID();
  const invite = {
    workspaceId:   wsId,
    workspaceName: ws.name,
    email:         email.toLowerCase().trim(),
    token,
    status:        'pending',
    createdBy:     user.uid,
    createdAt:     serverTimestamp(),
    expiresAt:     new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };

  const ref = await addDoc(collection(db, 'workspace_invites'), invite);
  await auditLog('workspaces.invite', 'workspace', wsId, { email });
  return { id: ref.id, ...invite };
}

/* ─── Aceitar convite por token ──────────────────────────── */
export async function acceptInvite(token) {
  const user = store.get('currentUser');
  if (!user) throw new Error('Usuário não autenticado.');

  const inviteSnap = await getDocs(query(
    collection(db, 'workspace_invites'),
    where('token', '==', token),
    where('status', '==', 'pending'),
  ));

  if (inviteSnap.empty) throw new Error('Convite não encontrado ou já utilizado.');
  const invite = { id: inviteSnap.docs[0].id, ...inviteSnap.docs[0].data() };

  // Verificar expiração
  const expires = invite.expiresAt?.toDate ? invite.expiresAt.toDate() : new Date(invite.expiresAt);
  if (new Date() > expires) {
    await updateDoc(doc(db, 'workspace_invites', invite.id), { status: 'expired' });
    throw new Error('Este convite expirou.');
  }

  // Adicionar usuário ao workspace
  await updateDoc(doc(db, 'workspaces', invite.workspaceId), {
    members:   arrayUnion(user.uid),
    updatedAt: serverTimestamp(),
  });

  // Marcar convite como aceito
  await updateDoc(doc(db, 'workspace_invites', invite.id), {
    status:     'accepted',
    acceptedBy: user.uid,
    acceptedAt: serverTimestamp(),
  });

  await auditLog('workspaces.invite_accepted', 'workspace', invite.workspaceId, { uid: user.uid });
  return invite;
}

/* ─── Buscar convites de um workspace ────────────────────── */
export async function fetchInvites(wsId) {
  const snap = await getDocs(query(
    collection(db, 'workspace_invites'),
    where('workspaceId', '==', wsId),
    orderBy('createdAt', 'desc'),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ─── Carregar workspaces do usuário no boot ─────────────── */
export async function loadUserWorkspaces() {
  const user    = store.get('currentUser');
  const profile = store.get('userProfile');
  if (!user) return [];

  let workspaces;
  if (store.can('system_view_all')) {
    workspaces = await fetchAllWorkspaces();
  } else {
    workspaces = await fetchUserWorkspaces(user.uid);
  }

  const active = workspaces.filter(w => !w.archived);
  store.set('userWorkspaces', active);

  // Restaurar seleção ativa do localStorage
  const savedActive = JSON.parse(localStorage.getItem(`ws_active_${user.uid}`) || 'null');
  if (savedActive && savedActive.length) {
    const validIds = active.map(w => w.id);
    const filtered = savedActive.filter(id => validIds.includes(id));
    store.set('activeWorkspaces', filtered.length ? filtered : active.map(w => w.id));
  } else {
    store.set('activeWorkspaces', active.map(w => w.id));
  }

  // currentWorkspace: último usado ou o primeiro
  const savedCurrent = localStorage.getItem(`ws_current_${user.uid}`);
  const current = active.find(w => w.id === savedCurrent) || active[0] || null;
  store.set('currentWorkspace', current);

  return active;
}

/* ─── Persistir seleção ativa ────────────────────────────── */
export function saveWorkspaceSelection(activeIds, currentId) {
  const uid = store.get('currentUser')?.uid;
  if (!uid) return;
  localStorage.setItem(`ws_active_${uid}`, JSON.stringify(activeIds));
  if (currentId) localStorage.setItem(`ws_current_${uid}`, currentId);
}
