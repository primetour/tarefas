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
    group: 'Squads',
    permissions: [
      { key: 'workspace_create',     label: 'Criar squads',                    info: 'Permite criar novos squads. Quem cria vira automaticamente admin do squad.' },
      { key: 'workspace_edit',       label: 'Editar squads que administra',    info: 'Editar nome, descrição, cor e ícone de squads onde é admin.' },
      { key: 'workspace_delete',     label: 'Excluir squads que administra',   info: 'Excluir squads onde é admin. Atenção: exclui todas as tarefas vinculadas.' },
      { key: 'workspace_invite',     label: 'Convidar membros para squads',    info: 'Enviar convites por e-mail para outros usuários entrarem em squads que administra.' },
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
      { key: 'task_complete',        label: 'Concluir tarefas',                    info: 'Marcar tarefas como concluídas (status "done"). Sem essa permissão, o analista só move até "revisão"; um coordenador+ homologa a conclusão.' },
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
      { key: 'analytics_view',      label: 'Ver análises avançadas',              info: 'Acesso a módulos de análise: Newsletters, Instagram, produtividade.' },
    ],
  },
  {
    group: 'CSAT',
    permissions: [
      { key: 'csat_send',            label: 'Enviar pesquisas CSAT',               info: 'Criar e enviar pesquisas de satisfação para clientes.' },
      { key: 'csat_view_all',        label: 'Ver CSAT de toda a equipe',           info: 'Ver pesquisas e respostas de outros usuários.' },
      { key: 'csat_manage',          label: 'Excluir pesquisas CSAT',              info: 'Excluir pesquisas e respostas (permanente). Reservado a gestores e admins.' },
    ],
  },
  {
    group: 'Metas e Desempenho',
    permissions: [
      { key: 'goals_view',    label: 'Visualizar metas',          info: 'Ver o quadro de metas e avaliações.' },
      { key: 'goals_manage',  label: 'Gerenciar metas',           info: 'Criar, editar e publicar metas. Reservado para gestores.' },
      { key: 'goals_evaluate',label: 'Avaliar metas (gestor)',    info: 'Registrar e editar avaliações de KPIs. Apenas gestor vinculado à meta.' },
    ],
  },
  {
    group: 'Feedbacks',
    permissions: [
      { key: 'feedback_view',   label: 'Ver feedbacks',   info: 'Visualizar feedbacks registrados. Restrito a coordenadores, gerentes, heads e diretoria.' },
      { key: 'feedback_create', label: 'Criar feedbacks', info: 'Registrar novos feedbacks para colaboradores.' },
    ],
  },
  {
    group: 'Portal de Dicas',
    permissions: [
      { key: 'portal_access',        label: 'Acessar Portal de Dicas',             info: 'Ver e gerar dicas de destinos.' },
      { key: 'portal_create',        label: 'Criar e editar dicas',                info: 'Criar, editar e excluir dicas de destinos no portal.' },
      { key: 'portal_manage',        label: 'Administrar Portal de Dicas',         info: 'Gerenciar áreas, destinos, banco de imagens e templates.' },
      { key: 'portal_download_unlimited', label: 'Downloads ilimitados',           info: 'Gerar downloads sem limite diário. Parceiros têm limite de 5/dia.' },
    ],
  },
  {
    group: 'Roteiros de Viagem',
    permissions: [
      { key: 'roteiro_access',  label: 'Acessar Roteiros de Viagem',  info: 'Ver roteiros próprios e da equipe.' },
      { key: 'roteiro_create',  label: 'Criar e editar roteiros',     info: 'Criar roteiros, editar os próprios, gerar exports.' },
      { key: 'roteiro_manage',  label: 'Administrar Roteiros',        info: 'Ver todos os roteiros, editar de qualquer consultor, dashboard.' },
    ],
  },
  {
    group: 'Calendário de Conteúdo',
    permissions: [
      { key: 'content_calendar_view',   label: 'Visualizar calendário de conteúdo', info: 'Ver o calendário de conteúdo e slots de publicação.' },
      { key: 'content_calendar_create', label: 'Criar e editar slots de conteúdo',  info: 'Criar, editar e sugerir conteúdo com IA.' },
      { key: 'content_calendar_manage', label: 'Administrar calendário',            info: 'Ver todos os slots, aprovar conteúdos, gerar relatórios.' },
    ],
  },
  {
    group: 'Auditoria de Sites (Core Web Vitals)',
    permissions: [
      { key: 'site_audit_view',   label: 'Visualizar auditorias de sites', info: 'Ver o histórico de auditorias Core Web Vitals e SEO dos sites cadastrados.' },
      { key: 'site_audit_manage', label: 'Executar e gerenciar auditorias', info: 'Cadastrar sites, disparar auditorias via PageSpeed Insights API e remover sites/histórico.' },
    ],
  },
  {
    group: 'Solicitações',
    permissions: [
      { key: 'requests_manage',   label: 'Triagem de solicitações',         info: 'Aprovar, recusar e converter solicitações em tarefas. Reservado a coordenadores+.' },
    ],
  },
  {
    group: 'Equipe e Ausências',
    permissions: [
      { key: 'absence_view_team',   label: 'Ver ausências da equipe',       info: 'Ver calendário de ausências e disponibilidade dos colegas. Sem essa permissão, só vê as próprias.' },
      { key: 'absence_manage_team', label: 'Gerenciar ausências da equipe', info: 'Registrar, editar e excluir ausências de outros usuários. Reservado a gestores.' },
    ],
  },
  {
    group: 'Identidade Visual',
    permissions: [
      { key: 'branding_manage',   label: 'Gerenciar logo do sistema',       info: 'Trocar o logo global aplicado em sidebar, login, splash e outros pontos institucionais.' },
    ],
  },
  {
    group: 'IA e Automações',
    permissions: [
      { key: 'ai_skills_manage',  label: 'Gerenciar IA Skills',             info: 'Criar, editar e excluir skills (instruções) usadas pelo agente de IA.' },
      { key: 'ai_dashboard_view', label: 'Ver dashboard de IA',             info: 'Acesso ao painel de uso, custo e qualidade do agente de IA.' },
      { key: 'ai_keys_manage',    label: 'Gerenciar API keys de IA',        info: 'Configurar provedores LLM (Anthropic/OpenAI/Gemini/Groq). Keys ficam server-side via Secret Manager — esta permissão controla quem pode rotacionar via UI.' },
    ],
  },
  {
    group: 'Revista Luxury Travel',
    permissions: [
      { key: 'luxury_travel_manage', label: 'Administrar Revista Luxury Travel', info: 'Criar/editar edições, fazer upload de PDFs (PT/EN), gerenciar fontes customizadas, regenerar QR codes e configurações da revista.' },
    ],
  },
  {
    group: 'Segurança e Auditoria',
    permissions: [
      { key: 'audit_logs_view',      label: 'Ver logs de auditoria',         info: 'Acesso a audit_logs (TTL 180 dias) — login, mudanças de role, deletes, eventos de segurança.' },
      { key: 'security_digest_view', label: 'Ver digest de segurança',       info: 'Receber e visualizar relatório SIEM diário (anomalias, IPs suspeitos, custo IA, eventos críticos).' },
      { key: 'security_alerts_receive', label: 'Receber alertas de segurança', info: 'Notificações automáticas de novo IP suspeito no próprio login, secret expirando, backup falhou.' },
      { key: 'secrets_audit_view',   label: 'Ver auditoria de secrets',      info: 'Acesso ao relatório semanal de rotação de API keys (alerta secrets >90 dias).' },
    ],
  },
  {
    group: 'LGPD e Privacidade',
    permissions: [
      { key: 'lgpd_export_own',      label: 'Exportar próprios dados (LGPD Art. 18 V)', info: 'Direito de portabilidade — gera arquivo JSON com todos os dados pessoais do próprio usuário.' },
      { key: 'lgpd_erasure_own',     label: 'Solicitar exclusão dos próprios dados (LGPD Art. 18 VI)', info: 'Hard delete de dados não obrigatórios + anonimização do resto. Preserva CLT (5 anos).' },
      { key: 'lgpd_export_others',   label: 'Exportar dados de outros (DPO)',    info: 'Apenas DPO/admin — atender solicitações de titulares por dados de outros usuários.' },
      { key: 'lgpd_erasure_others',  label: 'Eliminar dados de outros (DPO)',    info: 'Apenas DPO/admin — executar eraseUserDataServer pra outros uids. Sempre auditado.' },
      { key: 'privacy_consent_manage', label: 'Gerenciar consents de IA do próprio usuário', info: 'Toggle on/off em "Privacidade e IA" — anonimização, salvamento de chat, etc.' },
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
      task_complete: true,
      project_create: true,   project_edit: true,   project_delete: true,
      dashboard_view: true,   dashboard_customize: true, report_export: true,
      csat_send: true,        csat_view_all: true,    csat_manage: true,
      goals_view: true,       goals_manage: true,   goals_evaluate: true,
      analytics_view: true,
      feedback_view: true, feedback_create: true,
      portal_access: true,  portal_create: true,  portal_manage: true,  portal_download_unlimited: true,
      roteiro_access: true, roteiro_create: true, roteiro_manage: true,
      content_calendar_view: true, content_calendar_create: true, content_calendar_manage: true,
      site_audit_view: true, site_audit_manage: true,
      requests_manage: true,
      absence_view_team: true, absence_manage_team: true,
      branding_manage: true,
      ai_skills_manage: true, ai_dashboard_view: true, ai_keys_manage: true,
      luxury_travel_manage: true,
      // Segurança: Head tem acesso quase total (mas master pode revogar)
      audit_logs_view: true, security_digest_view: true,
      security_alerts_receive: true, secrets_audit_view: true,
      // LGPD: Head é o DPO operacional — pode atender solicitações
      lgpd_export_own: true, lgpd_erasure_own: true,
      lgpd_export_others: true, lgpd_erasure_others: true,
      privacy_consent_manage: true,
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
      task_complete: true,
      project_create: true,   project_edit: true,   project_delete: false,
      dashboard_view: true,   dashboard_customize: true, report_export: true,
      csat_send: true,        csat_view_all: true,    csat_manage: true,
      goals_view: true,       goals_manage: true,   goals_evaluate: true,
      analytics_view: true,
      feedback_view: true, feedback_create: true,
      portal_access: true,  portal_create: true,  portal_manage: false, portal_download_unlimited: true,
      roteiro_access: true, roteiro_create: true, roteiro_manage: true,
      content_calendar_view: true, content_calendar_create: true, content_calendar_manage: true,
      site_audit_view: true, site_audit_manage: true,
      requests_manage: true,
      absence_view_team: true, absence_manage_team: true,
      branding_manage: false,
      ai_skills_manage: false, ai_dashboard_view: true, ai_keys_manage: false,
      luxury_travel_manage: false,
      // Segurança: Gerente vê audit logs do squad + recebe alertas
      audit_logs_view: true, security_digest_view: false,
      security_alerts_receive: true, secrets_audit_view: false,
      // LGPD: Gerente exporta apenas próprios dados
      lgpd_export_own: true, lgpd_erasure_own: true,
      lgpd_export_others: false, lgpd_erasure_others: false,
      privacy_consent_manage: true,
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
      task_complete: true,
      project_create: true,   project_edit: true,   project_delete: false,
      dashboard_view: true,   dashboard_customize: true, report_export: true,
      csat_send: true,        csat_view_all: true,    csat_manage: false,
      goals_view: true,       goals_manage: true,   goals_evaluate: false,
      analytics_view: true,
      feedback_view: true, feedback_create: true,
      portal_access: true,  portal_create: true,  portal_manage: false, portal_download_unlimited: true,
      roteiro_access: true, roteiro_create: true, roteiro_manage: false,
      content_calendar_view: true, content_calendar_create: true, content_calendar_manage: false,
      site_audit_view: true, site_audit_manage: false,
      requests_manage: true,
      absence_view_team: true, absence_manage_team: false,
      branding_manage: false,
      ai_skills_manage: false, ai_dashboard_view: false, ai_keys_manage: false,
      luxury_travel_manage: false,
      // Segurança: Coordenador recebe alertas mas não vê logs
      audit_logs_view: false, security_digest_view: false,
      security_alerts_receive: true, secrets_audit_view: false,
      // LGPD: básico de auto-serviço
      lgpd_export_own: true, lgpd_erasure_own: true,
      lgpd_export_others: false, lgpd_erasure_others: false,
      privacy_consent_manage: true,
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
      task_complete: false,
      project_create: false,   project_edit: false,  project_delete: false,
      dashboard_view: false,   dashboard_customize: false, report_export: false,
      csat_send: false,        csat_view_all: false,   csat_manage: false,
      goals_view: false,       goals_manage: false,   goals_evaluate: false,
      analytics_view: false,
      feedback_view: false, feedback_create: false,
      portal_access: true,     portal_create: false,
      portal_manage: false,    portal_download_unlimited: false,
      roteiro_access: false, roteiro_create: false, roteiro_manage: false,
      content_calendar_view: false, content_calendar_create: false, content_calendar_manage: false,
      site_audit_view: false, site_audit_manage: false,
      requests_manage: false,
      absence_view_team: false, absence_manage_team: false,
      branding_manage: false,
      ai_skills_manage: false, ai_dashboard_view: false, ai_keys_manage: false,
      luxury_travel_manage: false,
      // Parceiros (externos) não recebem alertas internos
      audit_logs_view: false, security_digest_view: false,
      security_alerts_receive: false, secrets_audit_view: false,
      // LGPD: parceiros têm direito de auto-serviço por exigência legal
      lgpd_export_own: true, lgpd_erasure_own: true,
      lgpd_export_others: false, lgpd_erasure_others: false,
      privacy_consent_manage: true,
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
      task_complete: false,
      project_create: false,   project_edit: false,  project_delete: false,
      dashboard_view: true,    dashboard_customize: false, report_export: false,
      csat_send: false,        csat_view_all: false,   csat_manage: false,
      goals_view: true,        goals_manage: false,  goals_evaluate: false,
      analytics_view: false,
      feedback_view: false, feedback_create: false,
      portal_access: true,  portal_create: true,  portal_manage: false, portal_download_unlimited: true,
      roteiro_access: true, roteiro_create: true, roteiro_manage: false,
      content_calendar_view: true, content_calendar_create: true, content_calendar_manage: false,
      site_audit_view: true, site_audit_manage: false,
      requests_manage: false,
      absence_view_team: false, absence_manage_team: false,
      branding_manage: false,
      ai_skills_manage: false, ai_dashboard_view: false, ai_keys_manage: false,
      luxury_travel_manage: false,
      // Analista: alertas no próprio login + auto-serviço LGPD
      audit_logs_view: false, security_digest_view: false,
      security_alerts_receive: true, secrets_audit_view: false,
      lgpd_export_own: true, lgpd_erasure_own: true,
      lgpd_export_others: false, lgpd_erasure_others: false,
      privacy_consent_manage: true,
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
      // Sync identidade do role (name/desc/color/isSystem) sempre.
      // Permissões: só sobrescreve se o role NÃO foi customizado pelo admin.
      // Se `customizedPermissions === true`, preserva as permissões editadas.
      const data = snap.data() || {};
      const customized = data.customizedPermissions === true;
      const update = {
        id:          role.id,
        name:        role.name,
        description: role.description,
        color:       role.color,
        isSystem:    true,
        updatedAt:   serverTimestamp(),
      };
      if (!customized) update.permissions = role.permissions;
      await setDoc(ref, update, { merge: true });
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
// Para roles de sistema: name/description/color/isSystem ficam intactos
// (são sempre re-sincronizados pelo código via initSystemRoles); só as
// PERMISSÕES podem ser ajustadas, e marcamos `customizedPermissions: true`
// pra impedir que initSystemRoles sobrescreva as escolhas do admin.
export async function updateRole(roleId, { name, description, color, permissions }) {
  if (!store.can('system_manage_roles')) throw new Error('Permissão negada.');
  const role = await getRole(roleId);
  if (!role) throw new Error('Role não encontrado.');

  const user = store.get('currentUser');
  const updates = { updatedAt: serverTimestamp(), updatedBy: user.uid };

  if (role.isSystem) {
    // Apenas permissões editáveis em roles de sistema
    if (permissions && typeof permissions === 'object') {
      updates.permissions = permissions;
      updates.customizedPermissions = true;
      updates.customizedAt = serverTimestamp();
      updates.customizedBy = user.uid;
    } else {
      throw new Error('Roles de sistema só permitem editar permissões.');
    }
  } else {
    // Roles customizados: tudo editável
    if (name)        updates.name = name;
    if (description !== undefined) updates.description = description;
    if (color)       updates.color = color;
    if (permissions) updates.permissions = permissions;
  }

  await updateDoc(doc(db, 'roles', roleId), updates);
  await auditLog('roles.update', 'role', roleId, {
    name: role.name,
    isSystem: !!role.isSystem,
    customized: role.isSystem ? true : undefined,
  });
}

/* ─── Resetar permissões de role de sistema ao default ──── */
export async function resetSystemRolePermissions(roleId) {
  if (!store.can('system_manage_roles')) throw new Error('Permissão negada.');
  const sysRole = SYSTEM_ROLES.find(r => r.id === roleId);
  if (!sysRole) throw new Error('Role de sistema não encontrado.');
  const user = store.get('currentUser');
  await updateDoc(doc(db, 'roles', roleId), {
    permissions: sysRole.permissions,
    customizedPermissions: false,
    customizedAt: null,
    customizedBy: null,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
  await auditLog('roles.reset', 'role', roleId, { name: sysRole.name });
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
