/**
 * PRIMETOUR — RBAC Service
 * Gestão de roles e permissões dinâmicas
 */

import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc,
  deleteDoc, query, orderBy, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }       from '../firebase.js';
import { store }    from '../store.js';
import { auditLog } from '../auth/audit.js';

/* ─── Catálogo de permissões disponíveis ─────────────────── */
export const PERMISSION_CATALOG = [
  {
    group: 'Sistema',
    permissions: [
      { key: 'system_view_all',      label: 'Ver todos os workspaces e dados',     info: 'Permite enxergar todos os workspaces, usuários e tarefas do sistema, independente de estar vinculado.' },
      { key: 'system_manage_users',  label: 'Gerenciar usuários',                  info: 'Criar, editar, ativar e desativar usuários do sistema.' },
      { key: 'system_manage_roles',  label: 'Gerenciar roles e permissões',        info: 'Criar, editar e excluir roles. Atenção: roles do sistema não podem ser excluídos.' },
      { key: 'system_manage_settings', label: 'Gerenciar configurações globais',   info: 'Acesso às configurações gerais, integrações e auditoria do sistema.' },
    ],
  },
  {
    group: 'Workspaces',
    permissions: [
      { key: 'workspace_create',     label: 'Criar workspaces',                    info: 'Permite criar novos workspaces. Quem cria vira automaticamente admin do workspace.' },
      { key: 'workspace_edit',       label: 'Editar workspaces que administra',    info: 'Editar nome, descrição, cor e ícone de workspaces onde é admin.' },
      { key: 'workspace_delete',     label: 'Excluir workspaces que administra',   info: 'Excluir workspaces onde é admin. Atenção: exclui todas as tarefas vinculadas.' },
      { key: 'workspace_invite',     label: 'Convidar membros para workspaces',    info: 'Enviar convites por e-mail para outros usuários entrarem em workspaces que administra.' },
    ],
  },
  {
    group: 'Tipos de Tarefa',
    permissions: [
      { key: 'task_type_create',     label: 'Criar tipos de tarefa',               info: 'Criar novos tipos de tarefa com campos customizados, SLA e regras de negócio.' },
      { key: 'task_type_edit',       label: 'Editar tipos de tarefa',              info: 'Editar tipos de tarefa existentes nos workspaces que administra.' },
      { key: 'task_type_delete',     label: 'Excluir tipos de tarefa',             info: 'Excluir tipos de tarefa. Tarefas existentes desse tipo não são excluídas.' },
    ],
  },
  {
    group: 'Tarefas',
    permissions: [
      { key: 'task_create',          label: 'Criar tarefas',                       info: 'Criar novas tarefas nos workspaces que faz parte.' },
      { key: 'task_edit_any',        label: 'Editar qualquer tarefa',              info: 'Editar tarefas de outros usuários. Sem essa permissão, só edita as próprias.' },
      { key: 'task_delete',          label: 'Excluir tarefas',                     info: 'Excluir tarefas permanentemente. Recomendado apenas para gerentes e admins.' },
      { key: 'task_view_all',        label: 'Ver tarefas de todos os membros',     info: 'Ver tarefas atribuídas a outros usuários nos workspaces que faz parte.' },
    ],
  },
  {
    group: 'Projetos',
    permissions: [
      { key: 'project_create',       label: 'Criar projetos',                      info: 'Criar novos projetos dentro dos workspaces.' },
      { key: 'project_edit',         label: 'Editar projetos',                     info: 'Editar projetos existentes.' },
      { key: 'project_delete',       label: 'Excluir projetos',                    info: 'Excluir projetos e desvincular tarefas.' },
    ],
  },
  {
    group: 'Dashboards e Relatórios',
    permissions: [
      { key: 'dashboard_view',       label: 'Ver dashboards',                      info: 'Acesso à página de dashboards e métricas.' },
      { key: 'dashboard_customize',  label: 'Personalizar dashboards',             info: 'Criar e editar configurações de dashboard por workspace.' },
      { key: 'report_export',        label: 'Exportar relatórios',                 info: 'Exportar dados em CSV ou TXT.' },
    ],
  },
  {
    group: 'CSAT',
    permissions: [
      { key: 'csat_send',            label: 'Enviar pesquisas CSAT',               info: 'Criar e enviar pesquisas de satisfação para clientes.' },
      { key: 'csat_view_all',        label: 'Ver CSAT de toda a equipe',           info: 'Ver pesquisas e respostas de outros usuários.' },
    ],
  },
];

/* ─── Roles padrão do sistema ────────────────────────────── */
export const SYSTEM_ROLES = [
  {
    id:          'master',
    name:        'Master',
    description: 'Acesso total ao sistema. Não pode ser editado ou excluído.',
    isSystem:    true,
    color:       '#EF4444',
    // Master ignora permissions — store.isMaster() retorna true para tudo
    permissions: Object.fromEntries(
      PERMISSION_CATALOG.flatMap(g => g.permissions).map(p => [p.key, true])
    ),
  },
  {
    id:          'admin',
    name:        'Administrador',
    description: 'Gerencia usuários, roles e configurações do sistema.',
    isSystem:    true,
    color:       '#A78BFA',
    permissions: {
      system_view_all: true,  system_manage_users: true,
      system_manage_roles: false, system_manage_settings: true,
      workspace_create: true, workspace_edit: true,
      workspace_delete: true, workspace_invite: true,
      task_type_create: true, task_type_edit: true, task_type_delete: true,
      task_create: true,      task_edit_any: true,
      task_delete: true,      task_view_all: true,
      project_create: true,   project_edit: true,   project_delete: true,
      dashboard_view: true,   dashboard_customize: true, report_export: true,
      csat_send: true,        csat_view_all: true,
    },
  },
  {
    id:          'manager',
    name:        'Gerente',
    description: 'Cria e administra workspaces e tipos de tarefa.',
    isSystem:    true,
    color:       '#38BDF8',
    permissions: {
      system_view_all: false, system_manage_users: false,
      system_manage_roles: false, system_manage_settings: false,
      workspace_create: true, workspace_edit: true,
      workspace_delete: false, workspace_invite: true,
      task_type_create: true, task_type_edit: true, task_type_delete: false,
      task_create: true,      task_edit_any: true,
      task_delete: true,      task_view_all: true,
      project_create: true,   project_edit: true,   project_delete: false,
      dashboard_view: true,   dashboard_customize: true, report_export: true,
      csat_send: true,        csat_view_all: true,
    },
  },
  {
    id:          'member',
    name:        'Membro',
    description: 'Opera dentro dos workspaces que pertence.',
    isSystem:    true,
    color:       '#22C55E',
    permissions: {
      system_view_all: false, system_manage_users: false,
      system_manage_roles: false, system_manage_settings: false,
      workspace_create: false, workspace_edit: false,
      workspace_delete: false, workspace_invite: false,
      task_type_create: false, task_type_edit: false, task_type_delete: false,
      task_create: true,       task_edit_any: false,
      task_delete: false,      task_view_all: true,
      project_create: false,   project_edit: false,  project_delete: false,
      dashboard_view: true,    dashboard_customize: false, report_export: false,
      csat_send: false,        csat_view_all: false,
    },
  },
];

/* ─── Inicializar roles padrão no Firestore ──────────────── */
export async function initSystemRoles() {
  for (const role of SYSTEM_ROLES) {
    const ref  = doc(db, 'roles', role.id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ...role,
        createdAt:  serverTimestamp(),
        createdBy:  'system',
        updatedAt:  serverTimestamp(),
      });
    } else {
      // Always sync permissions from code — Firestore may have stale data
      await setDoc(ref, {
        ...snap.data(),
        permissions: role.permissions,
        updatedAt:   serverTimestamp(),
      }, { merge: true });
    }
  }
}

/* ─── Buscar todos os roles ──────────────────────────────── */
export async function fetchRoles() {
  const snap = await getDocs(query(collection(db, 'roles'), orderBy('createdAt', 'asc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ─── Buscar role por ID ─────────────────────────────────── */
export async function getRole(roleId) {
  const snap = await getDoc(doc(db, 'roles', roleId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/* ─── Criar role customizado ─────────────────────────────── */
export async function createRole({ name, description, color, permissions }) {
  if (!store.can('system_manage_roles')) throw new Error('Permissão negada.');
  const user = store.get('currentUser');

  // Gerar ID a partir do nome
  const id = name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  const existingIds = (await fetchRoles()).map(r => r.id);
  if (existingIds.includes(id)) throw new Error(`Já existe um role com o nome "${name}".`);

  const roleDoc = {
    id, name, description: description || '',
    color:       color || '#6B7280',
    isSystem:    false,
    permissions: permissions || {},
    createdAt:   serverTimestamp(),
    createdBy:   user.uid,
    updatedAt:   serverTimestamp(),
    updatedBy:   user.uid,
  };

  await setDoc(doc(db, 'roles', id), roleDoc);
  await auditLog('roles.create', 'role', id, { name });
  return roleDoc;
}

/* ─── Atualizar role ─────────────────────────────────────── */
export async function updateRole(roleId, { name, description, color, permissions }) {
  if (!store.can('system_manage_roles')) throw new Error('Permissão negada.');
  const role = await getRole(roleId);
  if (!role) throw new Error('Role não encontrado.');
  if (role.isSystem) throw new Error('Roles do sistema não podem ser editados.');

  const user = store.get('currentUser');
  await updateDoc(doc(db, 'roles', roleId), {
    name, description, color, permissions,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
  await auditLog('roles.update', 'role', roleId, { name });
}

/* ─── Excluir role ───────────────────────────────────────── */
export async function deleteRole(roleId) {
  if (!store.can('system_manage_roles')) throw new Error('Permissão negada.');
  const role = await getRole(roleId);
  if (!role) throw new Error('Role não encontrado.');
  if (role.isSystem) throw new Error('Roles do sistema não podem ser excluídos.');

  await deleteDoc(doc(db, 'roles', roleId));
  await auditLog('roles.delete', 'role', roleId, { name: role.name });
}
