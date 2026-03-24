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
      { key: 'system_view_all',        label: 'Visualizar todos os dados',           info: 'Permite enxergar todos os workspaces, usuários e tarefas do sistema.' },
      { key: 'system_manage_users',    label: 'Gerenciar usuários',                  info: 'Criar, editar, ativar e desativar usuários do sistema.' },
      { key: 'system_manage_roles',    label: 'Gerenciar roles e permissões',        info: 'Criar e editar roles. Atenção: roles do sistema não podem ser excluídos.' },
      { key: 'system_manage_settings', label: 'Gerenciar configurações globais',     info: 'Acesso às configurações gerais, integrações e auditoria do sistema.' },
    ],
  },
  {
    group: 'Workspaces',
    permissions: [
      { key: 'workspace_view',    label: 'Visualizar workspaces',               info: 'Ver workspaces que faz parte.' },
      { key: 'workspace_create',  label: 'Criar workspaces',                    info: 'Permite criar novos workspaces.' },
      { key: 'workspace_edit',    label: 'Editar workspaces',                   info: 'Editar nome, descrição, cor e ícone dos workspaces que administra.' },
      { key: 'workspace_delete',  label: 'Excluir workspaces',                  info: 'Excluir workspaces que administra. Exclui todas as tarefas vinculadas.' },
      { key: 'workspace_invite',  label: 'Convidar membros',                    info: 'Enviar convites por e-mail para outros usuários.' },
    ],
  },
  {
    group: 'Tipos de Tarefa',
    permissions: [
      { key: 'task_type_view',    label: 'Visualizar tipos de tarefa',          info: 'Ver tipos de tarefa disponíveis.' },
      { key: 'task_type_create',  label: 'Criar tipos de tarefa',               info: 'Criar novos tipos de tarefa com campos customizados.' },
      { key: 'task_type_edit',    label: 'Editar tipos de tarefa',              info: 'Editar tipos de tarefa existentes.' },
      { key: 'task_type_delete',  label: 'Excluir tipos de tarefa',             info: 'Excluir tipos de tarefa.' },
    ],
  },
  {
    group: 'Tarefas',
    permissions: [
      { key: 'task_view_all',     label: 'Visualizar tarefas de todos',         info: 'Ver tarefas atribuídas a outros usuários.' },
      { key: 'task_create',       label: 'Criar tarefas',                       info: 'Criar novas tarefas nos workspaces que faz parte.' },
      { key: 'task_edit_any',     label: 'Editar qualquer tarefa',              info: 'Editar tarefas de outros usuários.' },
      { key: 'task_delete',       label: 'Excluir tarefas',                     info: 'Excluir tarefas permanentemente.' },
    ],
  },
  {
    group: 'Projetos',
    permissions: [
      { key: 'project_view',      label: 'Visualizar projetos',                 info: 'Ver projetos disponíveis nos workspaces.' },
      { key: 'project_create',    label: 'Criar projetos',                      info: 'Criar novos projetos dentro dos workspaces.' },
      { key: 'project_edit',      label: 'Editar projetos',                     info: 'Editar projetos existentes.' },
      { key: 'project_delete',    label: 'Excluir projetos',                    info: 'Excluir projetos e desvincular tarefas.' },
    ],
  },
  {
    group: 'Dashboards e Relatórios',
    permissions: [
      { key: 'dashboard_view',       label: 'Visualizar dashboards',            info: 'Acesso à página de dashboards e métricas.' },
      { key: 'dashboard_customize',  label: 'Personalizar dashboards',          info: 'Criar e editar configurações de dashboard.' },
      { key: 'report_export',        label: 'Exportar relatórios',              info: 'Exportar dados em XLS, PDF ou CSV.' },
    ],
  },
  {
    group: 'CSAT',
    permissions: [
      { key: 'csat_view',         label: 'Visualizar pesquisas CSAT',           info: 'Ver pesquisas e respostas do próprio usuário.' },
      { key: 'csat_send',         label: 'Enviar pesquisas CSAT',               info: 'Criar e enviar pesquisas de satisfação para clientes.' },
      { key: 'csat_view_all',     label: 'Ver CSAT de toda a equipe',           info: 'Ver pesquisas e respostas de todos os usuários.' },
    ],
  },
  {
    group: 'Portal de Dicas',
    permissions: [
      { key: 'portal_access',              label: 'Visualizar e usar Portal',          info: 'Ver e gerar dicas de destinos.' },
      { key: 'portal_create',              label: 'Criar e editar dicas',              info: 'Criar, editar e excluir dicas de destinos no portal.' },
      { key: 'portal_manage',              label: 'Administrar Portal de Dicas',       info: 'Gerenciar áreas, destinos, banco de imagens e templates.' },
      { key: 'portal_download_unlimited',  label: 'Downloads ilimitados',              info: 'Gerar downloads sem limite diário.' },
    ],
  },
  {
    group: 'Hub de Marketing',
    permissions: [
      { key: 'landing_pages_view',     label: 'Visualizar Landing Pages',            info: 'Ver landing pages criadas.' },
      { key: 'landing_pages_manage',   label: 'Gerenciar Landing Pages',             info: 'Criar, editar, publicar e excluir landing pages de campanha.' },
      { key: 'cms_view',               label: 'Visualizar CMS',                      info: 'Ver páginas e posts do site oficial.' },
      { key: 'cms_manage',             label: 'Gerenciar CMS / Site',                info: 'Criar e editar páginas e posts do site oficial.' },
      { key: 'arts_view',              label: 'Visualizar Editor de Artes',          info: 'Ver templates disponíveis no editor.' },
      { key: 'arts_manage',            label: 'Usar Editor de Artes',                info: 'Criar artes usando os templates disponíveis.' },
      { key: 'arts_templates_manage',  label: 'Gerenciar templates de artes',        info: 'Criar, editar e excluir templates. Reservado para design.' },
      { key: 'news_view',              label: 'Visualizar Monitoramento de Notícias',info: 'Ver notícias cadastradas.' },
      { key: 'news_manage',            label: 'Gerenciar Monitoramento de Notícias', info: 'Cadastrar, editar e excluir notícias.' },
    ],
  },
];

/* ─── Roles padrão do sistema ────────────────────────────── */
export const SYSTEM_ROLES = [
  {
    id:          'master',
    name:        'Diretoria',
    description: 'Acesso total ao sistema. Vê todos os setores. Não pode ser editado ou excluído.',
    isSystem:    true,
    color:       '#EF4444',
    permissions: Object.fromEntries(
      PERMISSION_CATALOG.flatMap(g => g.permissions).map(p => [p.key, true])
    ),
  },
  {
    id:          'admin',
    name:        'Head',
    description: 'Gerencia usuários e configurações. Visibilidade de setor definida pela Diretoria.',
    isSystem:    true,
    color:       '#A78BFA',
    permissions: {
      system_view_all: false, system_manage_users: true,
      system_manage_roles: false, system_manage_settings: true,
      workspace_create: true, workspace_edit: true,
      workspace_delete: true, workspace_invite: true,
      task_type_create: true, task_type_edit: true, task_type_delete: true,
      task_create: true,      task_edit_any: true,
      task_delete: true,      task_view_all: true,
      project_create: true,   project_edit: true,   project_delete: true,
      dashboard_view: true,   dashboard_customize: true, report_export: true,
      csat_send: true,        csat_view_all: true,
      portal_access: true,  portal_create: true,  portal_manage: true,  portal_download_unlimited: true,
    },
  },
  {
    id:          'manager',
    name:        'Gerente',
    description: 'Cria e administra workspaces e tipos de tarefa dentro do seu setor.',
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
      portal_access: true,  portal_create: true,  portal_manage: false, portal_download_unlimited: true,
    },
  },
  {
    id:          'coordinator',
    name:        'Coordenador',
    description: 'Coordena tarefas e projetos dentro do seu núcleo e setor.',
    isSystem:    true,
    color:       '#F97316',
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
      portal_access: true,  portal_create: true,  portal_manage: false, portal_download_unlimited: true,
    },
  },
  {
    id:          'partner',
    name:        'Parceiro',
    description: 'Acesso exclusivo ao Portal de Dicas. Pode gerar e baixar dicas com limite de 5 downloads/dia.',
    isSystem:    true,
    color:       '#D4A843',
    permissions: {
      system_view_all: false, system_manage_users: false,
      system_manage_roles: false, system_manage_settings: false,
      workspace_create: false, workspace_edit: false,
      workspace_delete: false, workspace_invite: false,
      task_type_create: false, task_type_edit: false, task_type_delete: false,
      task_create: false,      task_edit_any: false,
      task_delete: false,      task_view_all: false,
      project_create: false,   project_edit: false,  project_delete: false,
      dashboard_view: false,   dashboard_customize: false, report_export: false,
      csat_send: false,        csat_view_all: false,
      portal_access: true,     portal_create: false,
      portal_manage: false,    portal_download_unlimited: false,
    },
  },
  {
    id:          'member',
    name:        'Analista',
    description: 'Opera dentro dos workspaces e núcleos que pertence.',
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
      portal_access: true,  portal_create: true,  portal_manage: false, portal_download_unlimited: true,
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
      // Always force-sync ALL system role fields — name, desc, color, permissions
      // This guarantees Firestore stays in sync with code regardless of when it was last updated
      await setDoc(ref, {
        ...snap.data(),
        id:          role.id,
        name:        role.name,
        description: role.description,
        color:       role.color,
        isSystem:    true,
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
  // System roles can have permissions edited, but cannot be deleted

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
