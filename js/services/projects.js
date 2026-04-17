/**
 * PRIMETOUR — Projects Service
 * CRUD completo de projetos no Firestore
 */

import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  getDoc, getDocs, query, orderBy, where,
  serverTimestamp, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }       from '../firebase.js';
import { store }    from '../store.js';
import { auditLog } from '../auth/audit.js';

/* ─── Paleta de cores/ícones ─────────────────────────────── */
export const PROJECT_COLORS = [
  '#D4A843','#38BDF8','#A78BFA','#34D399',
  '#F97316','#EC4899','#6366F1','#14B8A6',
  '#EF4444','#F59E0B','#84CC16','#06B6D4',
];
export const PROJECT_ICONS = [
  '🚀','📦','🎯','💡','🌟','🔧','📊','🎨',
  '🏆','📱','🌐','⚡','🔑','📋','🛠','💼',
];
export const PROJECT_STATUSES = [
  { value: 'planning',    label: 'Planejamento', color: '#38BDF8' },
  { value: 'active',      label: 'Em andamento', color: '#22C55E' },
  { value: 'on_hold',     label: 'Em pausa',     color: '#F59E0B' },
  { value: 'completed',   label: 'Concluído',    color: '#A78BFA' },
  { value: 'cancelled',   label: 'Cancelado',    color: '#EF4444' },
];
export const PROJECT_STATUS_MAP = Object.fromEntries(
  PROJECT_STATUSES.map(s => [s.value, s])
);

/* ─── Helpers de squad (B5p — multi-squad) ──────────────────
 * O modelo passou de `workspaceId: string|null` para
 * `workspaceIds: string[]`. Mantemos `workspaceId` como campo
 * espelho (primeiro item) para retrocompatibilidade — código
 * legado lê workspaceId; filtros/escritas novas usam workspaceIds.
 */
export function getProjectSquadIds(p) {
  if (Array.isArray(p?.workspaceIds) && p.workspaceIds.length) return p.workspaceIds;
  return p?.workspaceId ? [p.workspaceId] : [];
}
export function projectIncludesSquad(p, squadId) {
  if (!squadId) return false;
  return getProjectSquadIds(p).includes(squadId);
}
export function projectMatchesAnySquad(p, squadIds) {
  if (!Array.isArray(squadIds) || !squadIds.length) return false;
  const ids = getProjectSquadIds(p);
  if (!ids.length) return false;
  return ids.some(id => squadIds.includes(id));
}

/* ─── Criar projeto ──────────────────────────────────────── */
export async function createProject(data) {
  if (!store.can('project_create')) throw new Error('Permissão negada.');
  const user      = store.get('currentUser');
  const workspace = store.get('currentWorkspace');

  // Normaliza squads: aceita workspaceIds[] (novo) ou workspaceId (legado).
  // Sempre grava ambos: workspaceIds[] (canônico) + workspaceId (espelho).
  const wsIds = Array.isArray(data.workspaceIds)
    ? data.workspaceIds.filter(Boolean)
    : (data.workspaceId ? [data.workspaceId] : (workspace?.id ? [workspace.id] : []));

  const projectDoc = {
    workspaceIds: wsIds,
    workspaceId: wsIds[0] || null,           // espelho p/ filtros legados
    sector:      data.sector || store.get('userSector') || null,
    name:        data.name?.trim() || 'Novo Projeto',
    description: data.description?.trim() || '',
    color:       data.color || PROJECT_COLORS[0],
    icon:        data.icon  || '📦',
    status:      data.status || 'planning',
    members:     data.members || [user.uid],
    startDate:   data.startDate || null,
    endDate:     data.endDate   || null,
    taskCount:   0,
    doneCount:   0,
    createdAt:   serverTimestamp(),
    createdBy:   user.uid,
    updatedAt:   serverTimestamp(),
    updatedBy:   user.uid,
    archived:    false,
  };

  const ref = await addDoc(collection(db, 'projects'), projectDoc);
  await auditLog('projects.create', 'project', ref.id, { name: projectDoc.name });

  // Notificar membros (exceto o próprio criador — notify() já pula o ator)
  const initialMembers = (projectDoc.members || []).filter(uid => uid && uid !== user.uid);
  if (initialMembers.length) {
    import('./notifications.js').then(({ notify }) => {
      notify('project.member_added', {
        entityType: 'project', entityId: ref.id,
        recipientIds: initialMembers,
        title: 'Você foi adicionado a um projeto',
        body: `Você faz parte do projeto "${projectDoc.name}"`,
        route: 'projects',
      });
    }).catch(() => {});
  }

  store.invalidateCache('projects');
  return { id: ref.id, ...projectDoc };
}

/* ─── Atualizar projeto ──────────────────────────────────── */
export async function updateProject(projectId, data) {
  if (!store.can('project_edit')) throw new Error('Permissão negada.');
  const user = store.get('currentUser');

  // Captura prev para diff de membros
  let prevData = null;
  try {
    const snap = await getDoc(doc(db, 'projects', projectId));
    if (snap.exists()) prevData = snap.data();
  } catch (_) {}

  // Mantém workspaceId espelhado quando workspaceIds[] for atualizado.
  const patch = { ...data };
  if (Array.isArray(data.workspaceIds)) {
    patch.workspaceIds = data.workspaceIds.filter(Boolean);
    patch.workspaceId  = patch.workspaceIds[0] || null;
  }

  await updateDoc(doc(db, 'projects', projectId), {
    ...patch, updatedAt: serverTimestamp(), updatedBy: user.uid,
  });
  await auditLog('projects.update', 'project', projectId, { fields: Object.keys(data) });
  store.invalidateCache('projects');

  // Notificar membros recém-adicionados e removidos (diff)
  if (Array.isArray(data.members) && prevData) {
    const prevMembers = Array.isArray(prevData.members) ? prevData.members : [];
    const added   = data.members.filter(uid => uid && !prevMembers.includes(uid));
    const removed = prevMembers.filter(uid => uid && !data.members.includes(uid));
    if (added.length) {
      import('./notifications.js').then(({ notify }) => {
        notify('project.member_added', {
          entityType: 'project', entityId: projectId,
          recipientIds: added,
          title: 'Você foi adicionado a um projeto',
          body: `Você agora faz parte do projeto "${data.name || prevData.name || 'Projeto'}"`,
          route: 'projects',
        });
      }).catch(() => {});
    }
    if (removed.length) {
      import('./notifications.js').then(({ notify }) => {
        notify('project.member_removed', {
          entityType: 'project', entityId: projectId,
          recipientIds: removed,
          title: 'Você foi removido de um projeto',
          body: `Você não faz mais parte do projeto "${data.name || prevData.name || 'Projeto'}"`,
          route: 'projects',
        });
      }).catch(() => {});
    }
  }
}

/* ─── Arquivar projeto ───────────────────────────────────── */
export async function archiveProject(projectId) {
  if (!store.can('project_delete')) throw new Error('Permissão negada.');
  const user = store.get('currentUser');
  await updateDoc(doc(db, 'projects', projectId), {
    archived: true, updatedAt: serverTimestamp(), updatedBy: user.uid,
  });
  await auditLog('projects.archive', 'project', projectId, {});
  store.invalidateCache('projects');
}

/* ─── Restaurar projeto arquivado ────────────────────────── */
export async function unarchiveProject(projectId) {
  if (!store.can('project_edit')) throw new Error('Permissão negada.');
  const user = store.get('currentUser');
  await updateDoc(doc(db, 'projects', projectId), {
    archived: false, updatedAt: serverTimestamp(), updatedBy: user.uid,
  });
  await auditLog('projects.unarchive', 'project', projectId, {});
  store.invalidateCache('projects');
}

/* ─── Listar projetos arquivados ─────────────────────────── */
export async function fetchArchivedProjects() {
  const snap = await getDocs(query(collection(db, 'projects'), orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.archived);
}

/* ─── Verificar vínculos antes de excluir ────────────────── */
export async function checkProjectDependencies(projectId) {
  const deps = { tasks: 0, goalEvidence: 0, csatSurveys: 0 };

  // Tarefas vinculadas
  const taskSnap = await getDocs(query(
    collection(db, 'tasks'), where('projectId', '==', projectId)
  ));
  deps.tasks = taskSnap.size;

  // Dentre as tarefas, quantas são evidência de meta?
  taskSnap.docs.forEach(d => {
    if (d.data().goalId) deps.goalEvidence++;
  });

  // Pesquisas CSAT vinculadas
  try {
    const csatSnap = await getDocs(query(
      collection(db, 'csat_surveys'), where('projectId', '==', projectId)
    ));
    deps.csatSurveys = csatSnap.size;
  } catch (_) {}

  deps.total = deps.tasks + deps.csatSurveys;
  return deps;
}

/* ─── Excluir projeto (com verificação de vínculos) ──────── */
export async function deleteProject(projectId, { force = false } = {}) {
  if (!store.can('project_delete')) throw new Error('Permissão negada.');

  if (!force) {
    const deps = await checkProjectDependencies(projectId);
    if (deps.total > 0) {
      const parts = [];
      if (deps.tasks)       parts.push(`${deps.tasks} tarefa(s)`);
      if (deps.csatSurveys) parts.push(`${deps.csatSurveys} pesquisa(s) CSAT`);
      throw new Error(
        `Este projeto possui ${parts.join(' e ')} vinculado(s). ` +
        `Arquive o projeto ou remova os vínculos antes de excluir.`
      );
    }
  }

  await deleteDoc(doc(db, 'projects', projectId));
  await auditLog('projects.delete', 'project', projectId, {});
  store.invalidateCache('projects');
}

/* ─── Buscar projeto ─────────────────────────────────────── */
export async function getProject(projectId) {
  const snap = await getDoc(doc(db, 'projects', projectId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/* ─── Listar projetos ────────────────────────────────────── */
export async function fetchProjects({ includeArchived = false, workspaceIds = null } = {}) {
  // Cache: retorna dados em cache se < 5 min (evita re-fetch em cada navegação)
  const cached = store.getCached('projects');
  if (cached) return includeArchived ? cached : cached.filter(p => !p.archived);

  const q    = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  let all    = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Filtro por squad — projetos sem squad visíveis para todos pelo setor.
  // Suporta multi-squad (B5p): basta interseção entre squads do projeto e ativos.
  const activeIdsArr = workspaceIds ?? store.getActiveWorkspaceIds();
  const activeIdsSet = new Set(activeIdsArr ?? []);
  const isInActiveSquad = (p) => projectMatchesAnySquad(p, [...activeIdsSet]);

  if (activeIdsArr) {
    all = all.filter(p => {
      const ids = getProjectSquadIds(p);
      if (!ids.length) return true;                    // sem squad: visível
      return ids.some(id => activeIdsSet.has(id));     // qualquer squad ativo
    });
  }

  // Filtro por setor — pertencer a um squad ativo sobrescreve (squad multissetor)
  const visibleSectors = store.get('visibleSectors') || [];
  if (!store.isMaster() && visibleSectors.length > 0) {
    all = all.filter(p =>
      isInActiveSquad(p)
      || !p.sector
      || visibleSectors.includes(p.sector)
    );
  }

  store.setCache('projects', all);
  return includeArchived ? all : all.filter(p => !p.archived);
}

/* ─── Real-time listener ─────────────────────────────────── */
export function subscribeToProjects(callback) {
  const q = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => {
    let all = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Filtro por squad (multi)
    const activeIdsArr = store.getActiveWorkspaceIds();
    const activeIdsSet = new Set(activeIdsArr ?? []);
    const isInActiveSquad = (p) => projectMatchesAnySquad(p, [...activeIdsSet]);

    if (activeIdsArr) {
      all = all.filter(p => {
        const ids = getProjectSquadIds(p);
        if (!ids.length) return true;
        return ids.some(id => activeIdsSet.has(id));
      });
    }

    // Filtro por setor — squad ativo sobrescreve
    const visibleSectors = store.get('visibleSectors') || [];
    if (!store.isMaster() && visibleSectors.length > 0) {
      all = all.filter(p =>
        isInActiveSquad(p)
        || !p.sector
        || visibleSectors.includes(p.sector)
      );
    }

    callback(all.filter(p => !p.archived));
  });
}

/* ─── Atualizar contadores ───────────────────────────────── */
export async function recalcProjectStats(projectId, tasks) {
  const projectTasks = tasks.filter(t => t.projectId === projectId);
  await updateDoc(doc(db, 'projects', projectId), {
    taskCount: projectTasks.length,
    doneCount: projectTasks.filter(t => t.status === 'done').length,
  });
}
