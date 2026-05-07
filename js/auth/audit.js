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
  'auth.suspicious_login':   'Login suspeito (IP novo / device incomum)',
  // Usuários
  'users.create':            'Usuário criado',
  'users.recover':           'Usuário recuperado',
  'users.sso_auto_provision':'Usuário criado via SSO',
  'users.update':            'Usuário atualizado',
  'users.role_changed':      'Role do usuário alterada',
  'users.permission_changed':'Permissão individual alterada',
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
  'portal.export_pdf':       'Material exportado (PDF)',
  'portal.export_pptx':      'Material exportado (PPTX)',
  'portal.export_docx':      'Material exportado (DOCX)',
  // Templates de Áreas (BUs)
  'portal_areas.create':     'Área/BU criada',
  'portal_areas.update':     'Área/BU atualizada (cores, logo, template)',
  'portal_areas.delete':     'Área/BU excluída',
  // Banco de Imagens
  'portal_images.upload':    'Imagem enviada ao banco',
  'portal_images.update':    'Metadados de imagem atualizados',
  'portal_images.delete':    'Imagem removida do banco',
  'portal_images.autosync':  'Auto-fetch imagem (Unsplash/Wikipedia)',
  // Roteiros de Viagem
  'roteiro.create':          'Roteiro criado',
  'roteiro.update':          'Roteiro atualizado',
  'roteiro.delete':          'Roteiro excluído',
  'roteiro.duplicate':       'Roteiro duplicado',
  'roteiro.archive':         'Roteiro arquivado',
  'roteiro.restore':         'Roteiro restaurado',
  'roteiro.status_change':   'Status de roteiro alterado',
  'roteiro.export_pdf':      'Roteiro exportado (PDF)',
  'roteiro.export_pptx':     'Roteiro exportado (PPTX)',
  'roteiro.ai_generate':     'Roteiro gerado por IA',
  'roteiro.images_change':   'Imagens do roteiro alteradas',
  // Calendário de Conteúdo
  'content_calendar.slot_created':  'Slot de conteúdo criado',
  'content_calendar.slot_updated':  'Slot de conteúdo atualizado',
  'content_calendar.slot_deleted':  'Slot de conteúdo excluído',
  'content_calendar.ai_suggested':  'IA sugeriu conteúdo',
  'content_calendar.scheduled':     'Conteúdo agendado',
  'content_calendar.published':     'Conteúdo publicado',
  // Revista Luxury Travel
  'luxury_travel.edition_create':   'Edição da revista criada',
  'luxury_travel.edition_update':   'Edição da revista atualizada',
  'luxury_travel.edition_delete':   'Edição da revista excluída',
  'luxury_travel.pdf_upload':       'PDF da revista enviado',
  'luxury_travel.qr_regenerate':    'QR Code regenerado',
  'luxury_travel.font_upload':      'Fonte customizada enviada',
  'luxury_travel.settings_update':  'Configurações da revista atualizadas',
  // IA Hub / Agentes
  'agent.create':            'Agente IA criado',
  'agent.update':            'Agente IA atualizado (prompt/modelo/limits)',
  'agent.delete':            'Agente IA excluído',
  'agent.toggle':            'Agente IA ativado/desativado',
  'agent.run':               'Agente IA executado',
  'agent.knowledge_upload':  'Conhecimento do agente atualizado',
  'agent.api_key_rotated':   'API key de provider rotacionada',
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
  // Site Audits (Core Web Vitals)
  'site_audits.create_site': 'Site cadastrado para auditoria',
  'site_audits.delete_site': 'Site removido da auditoria',
  'site_audits.run':         'Auditoria de site executada',
  // LGPD
  'lgpd.export_request':     'Exportação LGPD solicitada',
  'lgpd.export_ready':       'Exportação LGPD concluída',
  'lgpd.erasure_request':    'Apagamento LGPD solicitado',
  'lgpd.erasure_completed':  'Apagamento LGPD concluído',
  'lgpd.consent_updated':    'Consentimento LGPD atualizado',
  // Configurações & Branding
  'settings.update':         'Configurações atualizadas',
  'branding.logo_change':    'Logo do sistema alterado',
};

// ─── Severidade da ação (info|warn|critical) ──────────────
// Crítico: deletes, mudanças de role/perm, exports, falhas de auth, LGPD.
// Warning: changes em seeds, reativação, falhas leves.
// Info: criações/updates rotineiros.
export const ACTION_SEVERITY = {
  // Critical (segurança/dados sensíveis)
  'auth.login_failed': 'critical',
  'auth.sso_failed':   'critical',
  'auth.suspicious_login': 'critical',
  'users.delete':      'critical',
  'users.role_changed': 'critical',
  'users.permission_changed': 'critical',
  'roles.delete':      'critical',
  'roles.update':      'critical',
  'tasks.delete':      'critical',
  'projects.delete':   'critical',
  'workspaces.delete': 'critical',
  'csat.delete':       'critical',
  'goals.delete':      'critical',
  'feedback.delete':   'critical',
  'lp.delete':         'critical',
  'news.delete':       'critical',
  'clipping.delete':   'critical',
  'portal.tip_delete': 'critical',
  'portal_areas.delete': 'critical',
  'portal_images.delete': 'critical',
  'roteiro.delete':    'critical',
  'content_calendar.slot_deleted': 'critical',
  'luxury_travel.edition_delete':  'critical',
  'agent.delete':      'critical',
  'agent.api_key_rotated': 'critical',
  'integrations.delete': 'critical',
  'site_audits.delete_site': 'critical',
  'lgpd.export_request': 'critical',
  'lgpd.export_ready':   'critical',
  'lgpd.erasure_request':'critical',
  'lgpd.erasure_completed':'critical',
  'lgpd.consent_updated':'critical',
  'branding.logo_change': 'critical',
  // Warning
  'users.deactivate':  'warn',
  'users.reactivate':  'warn',
  'tasks.rework':      'warn',
  'projects.archive':  'warn',
  'workspaces.archive':'warn',
  'workspaces.remove_member': 'warn',
  'workspaces.demote_admin':  'warn',
  'roteiro.archive':   'warn',
  'agent.toggle':      'warn',
  'integrations.disable': 'warn',
  // Default = 'info' pra todo o resto
};

// ─── Módulo da ação (pra agrupar/filtrar) ─────────────────
// Derivado do prefix da action (auth., users., tasks., etc.)
export function moduleFromAction(action) {
  if (!action) return 'unknown';
  return action.split('.')[0];
}

export function severityFromAction(action) {
  return ACTION_SEVERITY[action] || 'info';
}

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
export async function auditLog(action, entity, entityId, details = {}, opts = {}) {
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
    // Severity opcional (ex: 'warning', 'critical'). Quando setada,
    // pruneOldAuditLogs respeita pra preservação além do TTL 90d.
    if (opts.severity) entry.severity = opts.severity;

    await addDoc(collection(db, 'audit_logs'), entry);
  } catch (err) {
    // Auditoria nunca deve quebrar a operação principal.
    // permission-denied em actions server-side (auth.*/security.*/lgpd.*/system.*)
    // é ESPERADO — Firestore rules bloqueiam o client; quem grava esses eventos
    // são as Cloud Functions via Admin SDK. Suprime o warning pra não poluir console.
    const isExpected = (err.code === 'permission-denied' || /permission/i.test(err.message || ''))
      && /^(auth|security|lgpd|system)\./.test(action);
    if (!isExpected) {
      console.warn('Audit log failed:', err.message);
    }
  }
}

/**
 * Busca logs de auditoria com filtros e paginação.
 *
 * Filtros server-side (Firestore where):
 *   - startDate, endDate (mesmo campo do orderBy → não exige composite index)
 *
 * Filtros client-side (post-fetch):
 *   - filterUser, filterAction, filterModule, filterSeverity
 *
 * Por que tudo client-side menos data?
 *   - `where('userId', '==', X) + orderBy('timestamp', 'desc')` exige um
 *     composite index `(userId ASC, timestamp DESC)` que precisa ser criado
 *     manualmente no Firebase Console — quando ele falta o app quebra com
 *     "FirebaseError: The query requires an index" (bug reportado).
 *   - O mesmo vale pra `where('action', ...)`. Pra evitar a dependência de
 *     index management, filtramos em memória; e quando algum desses filtros
 *     está ativo fazemos over-fetch agressivo pra ainda termos páginas
 *     razoáveis após o filtro.
 *   - Date range usa o mesmo campo do orderBy (timestamp), então NÃO exige
 *     composite index — pode ficar server-side e reduzir payload.
 */
export async function fetchAuditLogs({
  pageSize   = 50,
  lastDoc    = null,
  filterUser = null,
  filterAction = null,
  filterModule = null,
  filterSeverity = null,
  startDate  = null,
  endDate    = null,
} = {}) {
  // Over-fetch quando há filtros client-side restritivos.
  // user/action são MUITO restritivos → multiplicador alto (10×).
  // module/severity menos → 3×.
  const hasUserOrAction = !!(filterUser || filterAction);
  const hasOtherClient  = !!(filterModule || filterSeverity);
  let fetchLimit = pageSize;
  if (hasUserOrAction) fetchLimit = Math.min(pageSize * 10, 500);
  else if (hasOtherClient) fetchLimit = Math.min(pageSize * 3, 300);

  let q = query(
    collection(db, 'audit_logs'),
    orderBy('timestamp', 'desc'),
    limit(fetchLimit)
  );

  // Apenas date range fica server-side (mesmo campo do orderBy → safe)
  if (startDate)    q = query(q, where('timestamp', '>=', startDate));
  if (endDate)      q = query(q, where('timestamp', '<=', endDate));
  if (lastDoc)      q = query(q, startAfter(lastDoc));

  const snap = await getDocs(q);
  let logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Client-side filters
  if (filterUser)   logs = logs.filter(l => l.userId === filterUser);
  if (filterAction) logs = logs.filter(l => l.action === filterAction);
  if (filterModule) logs = logs.filter(l => moduleFromAction(l.action) === filterModule);
  if (filterSeverity) {
    logs = logs.filter(l => severityFromAction(l.action) === filterSeverity);
  }

  // Pagination cursor sempre vem do último doc do snap original (não filtrado),
  // senão pulamos páginas. Trade-off: com filtros muito restritivos pode haver
  // gap entre lastDoc e logs.length === pageSize.
  return {
    logs:    logs.slice(0, pageSize),
    lastDoc: snap.docs[snap.docs.length - 1] || null,
    hasMore: snap.docs.length === fetchLimit,
  };
}

/**
 * Histórico de uma entidade específica (ex: tarefa).
 * Query server-side por (entity, entityId) — exige composite index
 * (entity ASC, entityId ASC, timestamp DESC) ou cai pra client-side filter.
 *
 * 4.23+ — adicionado pra exibir histórico de alterações DENTRO do card da tarefa.
 *
 * @param {string} entity   — ex: 'task', 'project'
 * @param {string} entityId — id do documento
 * @param {number} max      — limite de registros (default 50)
 */
export async function fetchEntityHistory(entity, entityId, max = 50) {
  if (!entity || !entityId) return [];
  try {
    // Tenta query composta primeiro (precisa do índice)
    const q = query(
      collection(db, 'audit_logs'),
      where('entity', '==', entity),
      where('entityId', '==', entityId),
      orderBy('timestamp', 'desc'),
      limit(max),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    // Sem índice → fallback client-side: busca os últimos N por entityId
    // (limit baixo pra não estourar quota; tarefas raramente passam de 50 changes)
    if (err?.code === 'failed-precondition' || /index/i.test(err?.message || '')) {
      console.debug('[audit] composite index missing, using client-side filter');
      try {
        const fallbackLimit = 500;
        const q2 = query(
          collection(db, 'audit_logs'),
          where('entityId', '==', entityId),
          orderBy('timestamp', 'desc'),
          limit(fallbackLimit),
        );
        const snap2 = await getDocs(q2);
        return snap2.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(l => l.entity === entity)
          .slice(0, max);
      } catch (err2) {
        console.warn('[audit] fetchEntityHistory fallback failed:', err2.message);
        return [];
      }
    }
    console.warn('[audit] fetchEntityHistory failed:', err.message);
    return [];
  }
}

/**
 * Lista de módulos catalogados (pra popular dropdown de filtro).
 * Derivada das ACTION_LABELS — sempre em sync.
 */
export function listAuditModules() {
  const set = new Set();
  Object.keys(ACTION_LABELS).forEach(action => set.add(moduleFromAction(action)));
  return Array.from(set).sort();
}
