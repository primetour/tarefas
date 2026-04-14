/**
 * PRIMETOUR — Audit Log
 * Registro completo de auditoria de todas as ações do sistema
 */

import {
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  getDocs,
  where,
  startAfter,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db }    from '../firebase.js';
import { store } from '../store.js';

// ─── Mapa de ações legíveis ────────────────────────────────
export const ACTION_LABELS = {
  // Auth
  'auth.login':              'Login realizado',
  'auth.logout':             'Logout realizado',
  'auth.login_failed':       'Falha no login',
  'auth.sso_failed':         'Falha no SSO',
  'auth.reset_pw':           'Redefinição de senha solicitada',
  // Usuários
  'users.create':            'Usuário criado',
  'users.recover':           'Usuário recuperado',
  'users.sso_auto_provision':'Usuário criado via SSO',
  'users.update':            'Usuário atualizado',
  'users.deactivate':        'Usuário desativado',
  'users.reactivate':        'Usuário reativado',
  'users.delete':            'Usuário excluído',
  // Tarefas
  'tasks.create':            'Tarefa criada',
  'tasks.update':            'Tarefa atualizada',
  'tasks.complete':          'Tarefa concluída',
  'tasks.rework':            'Tarefa reaberta (retrabalho)',
  'tasks.assign':            'Tarefa atribuída',
  'tasks.delete':            'Tarefa excluída',
  // Projetos
  'projects.create':         'Projeto criado',
  'projects.update':         'Projeto atualizado',
  'projects.archive':        'Projeto arquivado',
  'projects.unarchive':      'Projeto desarquivado',
  'projects.delete':         'Projeto excluído',
  // Squads / Workspaces
  'workspaces.create':       'Squad criado',
  'workspaces.update':       'Squad atualizado',
  'workspaces.archive':      'Squad arquivado',
  'workspaces.unarchive':    'Squad desarquivado',
  'workspaces.delete':       'Squad excluído',
  'workspaces.add_member':   'Membro adicionado ao squad',
  'workspaces.remove_member':'Membro removido do squad',
  'workspaces.promote_admin':'Membro promovido a admin',
  'workspaces.demote_admin': 'Admin rebaixado',
  'workspaces.invite':       'Convite de squad enviado',
  'workspaces.invite_accepted':'Convite de squad aceito',
  // CSAT
  'csat.create':             'Pesquisa CSAT criada',
  'csat.send':               'Pesquisa CSAT enviada',
  'csat.respond':            'Resposta CSAT recebida',
  'csat.cancel':             'Pesquisa CSAT cancelada',
  'csat.delete':             'Pesquisa CSAT excluída',
  'csat.send_digest':        'Digest CSAT enviado',
  // Goals / Metas
  'goals.create':            'Meta criada',
  'goals.update':            'Meta atualizada',
  'goals.delete':            'Meta excluída',
  // Feedbacks
  'feedback.create':         'Feedback criado',
  'feedback.update':         'Feedback atualizado',
  'feedback.delete':         'Feedback excluído',
  // Capacidade / Ausências
  'capacity.create':         'Ausência registrada',
  'capacity.update':         'Ausência atualizada',
  'capacity.delete':         'Ausência excluída',
  // Landing Pages
  'lp.create':               'LP criada',
  'lp.update':               'LP atualizada',
  'lp.publish':              'LP publicada',
  'lp.delete':               'LP excluída',
  // Artes
  'arts.generate':           'Arte gerada',
  // News Monitor
  'news.create':             'Notícia cadastrada',
  'news.update':             'Notícia atualizada',
  'news.delete':             'Notícia excluída',
  'clipping.create':         'Clipping criado',
  'clipping.update':         'Clipping atualizado',
  'clipping.delete':         'Clipping excluído',
  // Portal de Dicas
  'portal.tip_create':       'Dica criada',
  'portal.tip_update':       'Dica atualizada',
  'portal.tip_delete':       'Dica excluída',
  'portal.generate':         'Material gerado',
  // Tipos de Tarefa
  'task_types.create':       'Tipo de tarefa criado',
  'task_types.update':       'Tipo de tarefa atualizado',
  'task_types.delete':       'Tipo de tarefa excluído',
  // Roles / Perfis
  'roles.create':            'Perfil de acesso criado',
  'roles.update':            'Perfil de acesso atualizado',
  'roles.delete':            'Perfil de acesso excluído',
  // Solicitações
  'requests.status':         'Status de solicitação alterado',
  'requests.convert':        'Solicitação convertida em tarefa',
  'requests.delete':         'Solicitação excluída',
  // Integrações
  'integrations.save':       'Integração salva',
  'integrations.enable':     'Integração ativada',
  'integrations.disable':    'Integração desativada',
  'integrations.delete':     'Integração excluída',
  // Site Audits
  'site_audits.create_site': 'Site cadastrado para auditoria',
  'site_audits.delete_site': 'Site removido da auditoria',
  'site_audits.run':         'Auditoria de site executada',
  // Configurações
  'settings.update':         'Configurações atualizadas',
};

// ─── Mapa de ações reversíveis ────────────────────────────
export const REVERTIBLE_ACTIONS = {
  'tasks.complete':          { revertAction: 'tasks.rework',           label: 'Reabrir tarefa',          icon: '↩' },
  'tasks.delete':            { revertAction: 'tasks.restore',          label: 'Restaurar tarefa',        icon: '♻', note: 'Só se a tarefa tiver dados nos detalhes' },
  'projects.archive':        { revertAction: 'projects.unarchive',     label: 'Desarquivar projeto',     icon: '📤' },
  'projects.delete':         { revertAction: 'projects.restore',       label: 'Restaurar projeto',       icon: '♻', note: 'Dados podem estar incompletos' },
  'workspaces.archive':      { revertAction: 'workspaces.unarchive',   label: 'Desarquivar squad',       icon: '📤' },
  'workspaces.remove_member':{ revertAction: 'workspaces.add_member',  label: 'Re-adicionar membro',     icon: '↩' },
  'workspaces.add_member':   { revertAction: 'workspaces.remove_member',label:'Remover membro',          icon: '↩' },
  'users.deactivate':        { revertAction: 'users.reactivate',       label: 'Reativar usuário',        icon: '▶' },
  'users.reactivate':        { revertAction: 'users.deactivate',       label: 'Desativar usuário',       icon: '⏸' },
  'csat.cancel':             { revertAction: 'csat.reopen',            label: 'Reabrir pesquisa',        icon: '↩' },
  'capacity.delete':         { revertAction: 'capacity.restore',       label: 'Restaurar ausência',      icon: '♻' },
};

/**
 * Registra uma entrada de auditoria no Firestore
 */
export async function auditLog(action, entity, entityId, details = {}) {
  try {
    const user = store.get('currentUser');

    // Guard: se não há user autenticado, não tenta gravar no Firestore
    // (evita erro de permissão durante transição de auth, ex.: login SSO)
    if (!user?.uid) {
      console.debug('Audit log skipped: no authenticated user yet');
      return;
    }

    const profile = store.get('userProfile');

    const entry = {
      action,
      entity,
      entityId:   entityId || null,
      details,
      userId:     user?.uid    || 'system',
      userName:   profile?.name  || user?.email || 'Sistema',
      userEmail:  profile?.email || user?.email || '',
      userRole:   profile?.role  || 'unknown',
      timestamp:  serverTimestamp(),
      ip:         null, // IP só acessível via backend; deixar null no client
      userAgent:  navigator.userAgent.slice(0, 200),
    };

    await addDoc(collection(db, 'audit_logs'), entry);
  } catch (err) {
    // Auditoria nunca deve quebrar a operação principal
    console.warn('Audit log failed:', err.message);
  }
}

/**
 * Busca logs de auditoria com filtros e paginação
 */
export async function fetchAuditLogs({
  pageSize   = 50,
  lastDoc    = null,
  filterUser = null,
  filterAction = null,
  startDate  = null,
  endDate    = null,
} = {}) {
  let q = query(
    collection(db, 'audit_logs'),
    orderBy('timestamp', 'desc'),
    limit(pageSize)
  );

  if (filterUser)   q = query(q, where('userId', '==', filterUser));
  if (filterAction) q = query(q, where('action', '==', filterAction));
  if (startDate)    q = query(q, where('timestamp', '>=', startDate));
  if (endDate)      q = query(q, where('timestamp', '<=', endDate));
  if (lastDoc)      q = query(q, startAfter(lastDoc));

  const snap = await getDocs(q);
  return {
    logs:    snap.docs.map(d => ({ id: d.id, ...d.data() })),
    lastDoc: snap.docs[snap.docs.length - 1] || null,
    hasMore: snap.docs.length === pageSize,
  };
}
