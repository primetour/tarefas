/**
 * PRIMETOUR — Sidebar Component
 * Navegação lateral principal
 */

import { store }  from '../store.js';
import { router } from '../router.js';
import { APP_CONFIG } from '../config.js';
import { saveWorkspaceSelection } from '../services/workspaces.js';
import { LABEL as APP_VERSION_LABEL, FULL as APP_VERSION_FULL } from '../version.js';

// ─── Coleção de Ícones SVG (estilo Lucide) ─────────────────
// Por que SVG inline em vez de Unicode/emoji?
//   • Unicode geométrico (◈ ◎ ◌ ▤) renderiza minimalista demais — todos
//     parecem o mesmo "círculo" e o usuário não distingue rotas no scan.
//   • Emoji (📱 📖 ✈) renderiza com tamanho/baseline diferentes em cada
//     OS, quebrando o alinhamento (problema reportado em "Calendário de
//     Conteúdo" e "Revista Luxury Travel").
//   • SVG inline: tamanho fixo (20×20), cor herdada via currentColor (segue
//     a paleta), zero requests HTTP, alta nitidez em qualquer DPI.
//
// Estilo: outline 2px, viewBox 24×24, linecap/linejoin round.
// Cada entry contém apenas o conteúdo INTERNO do <svg> — o wrapper é
// adicionado em renderIcon().
const ICONS = {
  // ─ Tarefas e Projetos ─
  'check-in':  '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'dashboard': '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  'tasks':     '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  'projects':  '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  'kanban':    '<rect x="3" y="3" width="6" height="18" rx="1"/><rect x="10" y="3" width="6" height="12" rx="1"/><rect x="17" y="3" width="4" height="8" rx="1"/>',
  'calendar':  '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  'timeline':  '<line x1="3" y1="12" x2="21" y2="12"/><circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/>',

  // ─ Gestão de Equipe ─
  'workspaces':    '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4"/><line x1="12" y1="11" x2="12" y2="21"/>',
  'requests':      '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  'notifications': '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  'team':          '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'feedbacks':     '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  'goals':         '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  'csat':          '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',

  // ─ Serviços ─
  'content-calendar': '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><polygon points="12 13 13.2 15.5 16 16 14 18 14.4 21 12 19.6 9.6 21 10 18 8 16 10.8 15.5"/>',
  'roteiros':         '<path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  'portal-tips':      '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>',
  'portal-areas':     '<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  'portal-images':    '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  'landing-pages':    '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  'cms':              '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>',
  'arts-editor':      '<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>',
  'luxury-travel':    '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  'news-monitor':     '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8z"/>',

  // ─ Análise de Dados ─
  'dashboards':       '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  'nl-performance':   '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  'meta-performance': '<rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>',
  'ga-performance':   '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  'portal-dashboard': '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  'roteiro-dashboard':'<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',

  // ─ Administração ─
  'users':     '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><circle cx="19" cy="11" r="2"/><path d="M19 8v1"/><path d="M19 13v1"/><path d="m21.6 9.5-.87.5"/><path d="m17.27 12-.87.5"/><path d="m21.6 12.5-.87-.5"/><path d="m17.27 10-.87-.5"/>',
  'sectors':   '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>',
  'task-types':'<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  'roles':     '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  'ai-hub':    '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.813 1.9a2 2 0 0 1 1.288 1.288L12 21l1.9-5.813a2 2 0 0 1 1.288-1.288L21 12l-5.813-1.9a2 2 0 0 1-1.287-1.288z"/><path d="M5 3v4"/><path d="M3 5h4"/><path d="M19 17v4"/><path d="M17 19h4"/>',
  'audit':     '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 12h6"/><path d="M9 16h6"/>',
  'settings':  '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/><circle cx="12" cy="12" r="3"/>',
  'about':     '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  'help':      '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',

  // ─ Squads (header expansível) ─
  'squads':    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
};

/**
 * Renderiza um ícone do conjunto SVG. Fallback: se a key não existir
 * no ICONS map, devolve o próprio valor — assim itens custom (ou Unicode
 * legados durante migração) continuam renderizando.
 */
function renderIcon(key) {
  const svgInner = ICONS[key];
  if (!svgInner) return key;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" `
       + `width="18" height="18" fill="none" stroke="currentColor" `
       + `stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">`
       + `${svgInner}</svg>`;
}

// ─── Definição de navegação ───────────────────────────────
const NAV_GROUPS = [
  {
    label: 'Tarefas e Projetos',
    items: [
      { route: 'check-in',   icon: 'check-in',   label: 'Check-in',     perm: 'dashboard_view' },
      { route: 'dashboard',  icon: 'dashboard',  label: 'Meu Painel',   perm: 'dashboard_view' },
      { route: 'tasks',      icon: 'tasks',      label: 'Tarefas',      perm: 'task_create' },
      { route: 'projects',   icon: 'projects',   label: 'Projetos',     perm: 'task_create',       altPerm: 'project_create' },
      { route: 'kanban',     icon: 'kanban',     label: 'Steps',        perm: 'task_create' },
      { route: 'calendar',   icon: 'calendar',   label: 'Calendário',   perm: 'task_create' },
      { route: 'timeline',   icon: 'timeline',   label: 'Timeline',     perm: 'task_edit_any' },
    ]
  },
  {
    label: 'Gestão de Equipe',
    items: [
      { route: 'workspaces',    icon: 'workspaces',    label: 'Squads',       perm: 'workspace_create', altPerm: 'system_view_all' },
      { route: 'requests',      icon: 'requests',      label: 'Solicitações', perm: 'task_create',      badge: true },
      { route: 'notifications', icon: 'notifications', label: 'Notificações', perm: 'dashboard_view',   badge: true },
      { route: 'team',          icon: 'team',          label: 'Equipe',       perm: 'task_view_all' },
      { route: 'feedbacks',     icon: 'feedbacks',     label: 'Feedbacks',    perm: 'feedback_view',    altPerm: 'feedback_create' },
      { route: 'goals',         icon: 'goals',         label: 'Metas',        perm: 'goals_view' },
      { route: 'csat',          icon: 'csat',          label: 'CSAT',         perm: 'csat_send',        altPerm: 'csat_view_all' },
    ]
  },
  {
    label: 'Serviços',
    items: [
      { route: 'content-calendar', icon: 'content-calendar', label: 'Calendário de Conteúdo', perm: 'content_calendar_view' },
      { route: 'roteiros',         icon: 'roteiros',         label: 'Gerador de Roteiros',    perm: 'roteiro_access' },
      { route: 'portal-tips',      icon: 'portal-tips',      label: 'Portal de Dicas',        perm: 'portal_access'  },
      { route: 'portal-areas',     icon: 'portal-areas',     label: 'Templates de áreas',     perm: 'portal_areas_manage', altPerm: 'portal_manage' },
      { route: 'portal-images',    icon: 'portal-images',    label: 'Banco de Imagens',       perm: 'portal_manage'  },
      { route: 'landing-pages',    icon: 'landing-pages',    label: 'Landing Pages',          perm: 'portal_manage'  },
      { route: 'cms',              icon: 'cms',              label: 'CMS / Site',             perm: 'portal_manage'  },
      { route: 'arts-editor',      icon: 'arts-editor',      label: 'Editor de Artes',        perm: 'portal_manage'  },
      { route: 'luxury-travel',    icon: 'luxury-travel',    label: 'Revista Luxury Travel' },
      { route: 'news-monitor',     icon: 'news-monitor',     label: 'Pautas e Clipping',      perm: 'dashboard_view' },
      // 'ai-automations' DEPRECADO em favor do IA Hub (triggers.schedule do agente).
    ]
  },
  {
    label: 'Análise de Dados',
    items: [
      { route: 'dashboards',        icon: 'dashboards',        label: 'Produtividade',     perm: 'analytics_view',  altPerm: 'dashboard_view' },
      { route: 'nl-performance',    icon: 'nl-performance',    label: 'Newsletters',       perm: 'analytics_view' },
      { route: 'meta-performance',  icon: 'meta-performance',  label: 'Instagram',         perm: 'analytics_view' },
      { route: 'ga-performance',    icon: 'ga-performance',    label: 'Google Analytics',  perm: 'analytics_view' },
      { route: 'portal-dashboard',  icon: 'portal-dashboard',  label: 'Portal de Dicas',   perm: 'portal_manage' },
      { route: 'roteiro-dashboard', icon: 'roteiro-dashboard', label: 'Roteiros',          perm: 'roteiro_manage' },
      // 'ai-dashboard' agora dentro do IA Hub (aba Custos)
    ]
  },
  {
    label: 'Administração',
    items: [
      { route: 'users',      icon: 'users',      label: 'Usuários',          perm: 'system_manage_users' },
      { route: 'sectors',    icon: 'sectors',    label: 'Setores e Núcleos', perm: 'system_manage_users' },
      { route: 'task-types', icon: 'task-types', label: 'Tipos de Tarefa',   perm: 'task_type_create',    altPerm: 'system_manage_users' },
      { route: 'roles',      icon: 'roles',      label: 'Roles e Acesso',    perm: 'system_manage_roles', altPerm: 'system_manage_users' },
      { route: 'ai-hub',     icon: 'ai-hub',     label: 'IA Hub',            perm: 'system_manage_settings' },
      // 'ai-skills' DEPRECADO em favor do IA Hub. Skills migradas viram agents.
      { route: 'audit',      icon: 'audit',      label: 'Auditoria',         perm: 'system_manage_settings' },
      { route: 'dev-hours',   icon: 'about',      label: 'Horas de Dev',       perm: '__master_only__' },
      { route: 'settings',   icon: 'settings',   label: 'Configurações',     perm: 'system_manage_settings' },
      { route: 'about',      icon: 'about',      label: 'Sobre o sistema',   perm: 'system_manage_users' },
      { route: 'help',       icon: 'help',       label: 'Ajuda',             perm: null }, // todos
    ]
  }
];

/* ─── Helper: lê squadId atual da URL (?id=XXX) ──────────── */
function getCurrentSquadIdFromHash() {
  const hash = window.location.hash || '';
  const q = hash.split('?')[1] || '';
  const params = new URLSearchParams(q);
  return params.get('id') || null;
}

/* ─── Squads expansível (subitens do menu principal) ─────── */
function buildSquadsMenuItem() {
  const workspaces = store.get('userWorkspaces') || [];
  if (!workspaces.length) return '';

  const current       = store.get('currentWorkspace');
  const currentSquadId = getCurrentSquadIdFromHash();
  const isSquadRoute  = (store.get('currentRoute') || '').startsWith('squad');
  const collapsed     = store.get('sidebar_squads_collapsed') === true;

  const subItems = workspaces.map(ws => {
    const isOpen    = isSquadRoute && currentSquadId === ws.id;
    const isCurrent = current?.id === ws.id;
    return `
      <div class="nav-item nav-squad-subitem ${isOpen?'active':''}"
           data-squad-id="${ws.id}"
           data-tooltip="${esc(ws.name)}${ws.multiSector ? ' · multissetor' : ''}"
           title="Abrir workspace do squad${isCurrent ? ' (squad padrão)' : ''}"
           style="padding-left:32px;">
        <span class="nav-icon" style="color:${ws.color||'#D4A843'};font-size:0.875rem;">●</span>
        <span class="nav-label" style="font-size:0.8125rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">
          ${esc(ws.name)}
        </span>
        ${ws.multiSector ? `<span class="nav-label" title="Squad multissetor"
          style="font-size:0.625rem;color:var(--text-muted);margin-left:4px;">⇌</span>` : ''}
        <span class="nav-label ws-current-dot" data-wsid="${ws.id}"
          title="${isCurrent ? 'Squad padrão atual (onde novas tarefas são criadas)' : 'Definir como squad padrão'}"
          style="width:8px;height:8px;border-radius:50%;flex-shrink:0;cursor:pointer;margin-left:6px;
            background:${isCurrent?'var(--brand-gold)':'var(--border-subtle)'};
            box-shadow:${isCurrent?'0 0 0 2px rgba(212,168,67,0.25)':'none'};
            transition:all 0.15s;display:inline-block;"></span>
      </div>`;
  }).join('');

  return `
    <div class="nav-item nav-squads-parent ${isSquadRoute ? 'active' : ''}" data-squads-toggle>
      <span class="nav-icon">${renderIcon('squads')}</span>
      <span class="nav-label">Squads</span>
      <span class="nav-label" style="margin-left:auto;font-size:0.625rem;opacity:0.6;
        background:var(--bg-subtle);padding:1px 6px;border-radius:var(--radius-full);">${workspaces.length}</span>
      <span class="nav-label section-chevron" style="font-size:0.55rem;opacity:0.5;margin-left:6px;transition:transform 0.2s;
        transform:${collapsed?'rotate(-90deg)':'rotate(0deg)'};">▼</span>
    </div>
    <div class="nav-squads-children" style="display:${collapsed?'none':'block'};">
      ${subItems}
    </div>
  `;
}

/* ─── HTML-escape local para o selector ──────────────────── */
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

export class Sidebar {
  constructor() {
    this.el        = null;
    this.overlay   = null;
    this.collapsed = false;
    this._unsubRoute = null;
  }

  render() {
    const profile = store.get('userProfile');
    const role    = profile?.role || 'member';
    const initials = store.getUserInitials();
    const avatarColor = profile?.avatarColor || '#3B82F6';

    const navGroupsHTML = NAV_GROUPS.map(group => {
      const items = group.items.filter(item => {
        // Master always sees everything
        if (store.isMaster()) return true;
        // All items now use permission-based checks
        if (item.perm) return store.can(item.perm) || (item.altPerm && store.can(item.altPerm));
        return true;
      });
      if (!items.length) return '';

      // Montar HTML de itens, injetando o bloco de Squads após "projects"
      // no grupo Principal quando o usuário tiver squads.
      const renderNavItem = (item) => `
        <div
          class="nav-item ${router.isActive(item.route) ? 'active' : ''}"
          data-route="${item.route}"
          data-tooltip="${item.label}"
        >
          <span class="nav-icon">${renderIcon(item.icon)}</span>
          <span class="nav-label">${item.label}</span>
          ${item.badge ? `<span class="sidebar-badge" style="
            display:none;min-width:18px;height:18px;padding:0 4px;
            border-radius:var(--radius-full);background:var(--color-danger);
            color:#fff;font-size:0.625rem;font-weight:700;
            align-items:center;justify-content:center;margin-left:auto;"></span>` : ''}
        </div>
      `;

      let itemsHTML = '';
      const userWorkspaces = store.get('userWorkspaces') || [];
      const showSquadsHere = group.label === 'Principal' && userWorkspaces.length > 0;
      if (showSquadsHere) {
        // Injeta "Squads" logo após "projects"
        for (const item of items) {
          itemsHTML += renderNavItem(item);
          if (item.route === 'projects') {
            itemsHTML += buildSquadsMenuItem();
          }
        }
      } else {
        itemsHTML = items.map(renderNavItem).join('');
      }

      const isCollapsed = store.get(`sidebar_section_${group.label}`) === true;
      return `
        <div class="sidebar-section" data-section="${group.label}">
          <div class="sidebar-section-label sidebar-section-toggle" data-section="${group.label}"
            style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;user-select:none;">
            <span>${group.label}</span>
            <span class="section-chevron nav-label" style="font-size:0.6rem;opacity:0.5;transition:transform 0.2s;
              transform:${isCollapsed?'rotate(-90deg)':'rotate(0deg)'};">▼</span>
          </div>
          <div class="sidebar-section-items" style="display:${isCollapsed?'none':'block'}">
            ${itemsHTML}
          </div>
        </div>
      `;
    }).join('');

    const allRoles  = store.get('roles') || [];
    const roleDoc   = allRoles.find(r => r.id === (profile?.roleId||role));
    const ROLE_FALLBACKS = {
      master: 'Diretoria', admin: 'Head', manager: 'Gerente',
      coordinator: 'Coordenador', member: 'Analista',
    };
    const roleLabel = roleDoc?.name || APP_CONFIG.roles[role]?.label || ROLE_FALLBACKS[role] || role;

    // ── Logo do sidebar: mapping EXPLÍCITO por paleta ──────────
    // PALETAS COM SIDEBAR ESCURA (usa logo BRANCO/light):
    //   midnight, charcoal, ocean, forest, royal, sunset, rose, portal
    // PALETAS COM SIDEBAR CLARA (usa logo NAVY/dark):
    //   platinum, sand
    // SEMPRE usa as URLs hardcoded direto. Sem cropped, sem fallback
    // cruzado, sem dependência de Firestore/localStorage. Garantia
    // 100% determinística — qualquer paleta puxa o logo correto.
    const palette = document.documentElement.getAttribute('data-palette') || 'midnight';
    const LIGHT_PALETTES = ['platinum', 'sand'];
    const useDarkLogo = LIGHT_PALETTES.includes(palette);

    const LIGHT_LOGO = 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/logos/lazer-1777390896671.webp';
    const DARK_LOGO  = 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/logos/lazer-alt-1777403810065.webp';
    const logoUrl = useDarkLogo ? DARK_LOGO : LIGHT_LOGO;

    const html = `
      <div class="sidebar-brand">
        <img src="${logoUrl}" alt="Logo">
        <button class="sidebar-toggle" id="sidebar-toggle-btn" aria-label="Recolher menu">
          ◀
        </button>
      </div>

      <nav class="sidebar-nav">
        ${navGroupsHTML}
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-user" id="sidebar-user-btn">
          <div class="avatar avatar-sm sidebar-user-avatar"
               style="background:${avatarColor}"
          >${initials}</div>
          <div class="sidebar-user-info">
            <div class="sidebar-user-name">${profile?.name || 'Usuário'}</div>
            <div class="sidebar-user-role">${roleLabel}</div>
          </div>
          <button class="sidebar-user-menu-btn">⋯</button>
        </div>
        <!-- Versão + acesso à documentação técnica.
             Single source of truth: js/version.js
             docs.html é público (auditoria externa autorizada) — ver
             docs/UI-COMPONENTS.md "Acesso público (3.0.0)". -->
        <a class="sidebar-version" href="docs.html" target="_blank" rel="noopener"
          title="Documentação técnica · Build: ${APP_VERSION_FULL}"
          style="display:flex;align-items:center;justify-content:center;gap:6px;
            padding:8px 14px 10px;font-size:0.6875rem;color:var(--text-muted);
            text-align:center;letter-spacing:0.04em;font-variant-numeric:tabular-nums;
            border-top:1px solid var(--border-subtle);margin-top:4px;opacity:0.7;
            text-decoration:none;transition:opacity 0.15s,color 0.15s;"
          onmouseover="this.style.opacity='1';this.style.color='var(--brand-gold)';"
          onmouseout="this.style.opacity='0.7';this.style.color='var(--text-muted)';"
        ><span>PRIMETOUR · ${APP_VERSION_LABEL}</span><span style="font-size:0.625rem;">📚</span></a>
      </div>
    `;

    // Criar elemento sidebar
    this.el = document.createElement('aside');
    this.el.className = 'sidebar';
    if (this.collapsed) this.el.classList.add('collapsed');
    this.el.innerHTML = html;

    // Criar overlay mobile
    this.overlay = document.createElement('div');
    this.overlay.className = 'sidebar-overlay';
    this.overlay.addEventListener('click', () => this.closeMobile());

    this._attachEvents();
    this._watchPaletteChange();
    return this.el;
  }

  _watchPaletteChange() {
    // Observa mudanças em <html data-palette>. Quando user troca paleta
    // em runtime (settings/profile), re-aplica o logo correto sem
    // precisar re-renderizar a sidebar inteira.
    if (this._paletteObserver) this._paletteObserver.disconnect();
    const LIGHT_PALETTES = ['platinum', 'sand'];
    const LIGHT_LOGO = 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/logos/lazer-1777390896671.webp';
    const DARK_LOGO  = 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/logos/lazer-alt-1777403810065.webp';
    const updateLogo = () => {
      const palette = document.documentElement.getAttribute('data-palette') || 'midnight';
      const useDark = LIGHT_PALETTES.includes(palette);
      const url = useDark ? DARK_LOGO : LIGHT_LOGO;
      const img = this.el?.querySelector('.sidebar-brand > img');
      if (img && img.src !== url) img.src = url;
    };
    this._paletteObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'data-palette') {
          updateLogo();
          break;
        }
      }
    });
    this._paletteObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-palette'],
    });
  }

  _attachEvents() {
    // Toggle collapse
    const toggleBtn = this.el.querySelector('#sidebar-toggle-btn');
    toggleBtn?.addEventListener('click', () => this.toggleCollapse());

    // Nav items (com data-route) — navegação padrão
    this.el.querySelectorAll('.nav-item[data-route]').forEach(item => {
      item.addEventListener('click', () => {
        const route = item.dataset.route;
        router.navigate(route);
        this.setActive(route);
        this.closeMobile();
      });
    });

    // User menu
    const userBtn = this.el.querySelector('#sidebar-user-btn');
    userBtn?.addEventListener('click', () => this._showUserMenu());

    // Subscribe to route changes
    this._unsubRoute = store.subscribe('currentRoute', (route) => {
      this.setActive(route);
      // Re-render squads para marcar subitem ativo conforme ?id=XXX
      this._rerenderSquadsBlock();
    });

    // Accordion section toggles
    this.el?.querySelectorAll('.sidebar-section-toggle').forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const section   = toggle.dataset.section;
        const items     = toggle.closest('.sidebar-section')?.querySelector('.sidebar-section-items');
        const chevron   = toggle.querySelector('.section-chevron');
        const collapsed = items?.style.display === 'none';
        if (items)   items.style.display   = collapsed ? 'block' : 'none';
        if (chevron) chevron.style.transform = collapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
        store.set(`sidebar_section_${section}`, !collapsed);
      });
    });

    // Subscribe to workspace changes — re-render Squads block
    this._unsubWs = store.subscribe('userWorkspaces', () => {
      this._rerenderSquadsBlock(true);
    });

    this._attachSquadEvents();
  }

  /**
   * Re-renderiza o bloco "Squads" (item pai + subitens) sem perder
   * estado do resto do sidebar. Se `structural=true`, pode ter
   * havido mudança no número de squads (ou vazio), então reconstrói
   * todo o sidebar via re-render parcial do nav.
   */
  _rerenderSquadsBlock(structural = false) {
    if (!this.el) return;
    const parent   = this.el.querySelector('.nav-squads-parent');
    const children = this.el.querySelector('.nav-squads-children');
    const workspaces = store.get('userWorkspaces') || [];

    // Caso estrutural: criar do zero se não existia, remover se ficou vazio
    if (structural) {
      // Remover antigos
      if (parent)   parent.remove();
      if (children) children.remove();
      if (workspaces.length) {
        // Inserir após o item "projects"
        const projectsItem = this.el.querySelector('.nav-item[data-route="projects"]');
        if (projectsItem) {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = buildSquadsMenuItem();
          // Insere cada filho do wrapper após projectsItem, na ordem
          const nodes = [...wrapper.children];
          let anchor = projectsItem;
          for (const n of nodes) {
            anchor.after(n);
            anchor = n;
          }
        }
      }
    } else if (parent || children) {
      // Apenas atualiza classes/ativo dos subitens existentes
      const html = buildSquadsMenuItem();
      if (html && parent && children) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        const newParent   = wrapper.querySelector('.nav-squads-parent');
        const newChildren = wrapper.querySelector('.nav-squads-children');
        if (newParent)   parent.replaceWith(newParent);
        if (newChildren) children.replaceWith(newChildren);
      }
    }
    this._attachSquadEvents();
  }

  _attachSquadEvents() {
    // Toggle expandir/colapsar lista de squads
    const parent = this.el?.querySelector('.nav-squads-parent[data-squads-toggle]');
    if (parent) {
      // Clique no chevron → apenas toggle expandir/colapsar
      const chevron = parent.querySelector('.section-chevron');
      if (chevron) {
        chevron.addEventListener('click', (e) => {
          e.stopPropagation();
          const children = this.el.querySelector('.nav-squads-children');
          const collapsed = children?.style.display === 'none';
          if (children) children.style.display = collapsed ? 'block' : 'none';
          chevron.style.transform = collapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
          store.set('sidebar_squads_collapsed', !collapsed);
        });
      }
      // Clique no item pai → navega para lista de squads
      parent.addEventListener('click', (e) => {
        if (e.target.closest('.section-chevron')) return; // ignora se clicou no chevron
        e.stopPropagation();
        // Expande os subitens se estavam colapsados
        const children = this.el.querySelector('.nav-squads-children');
        if (children?.style.display === 'none') {
          children.style.display = 'block';
          const chev = parent.querySelector('.section-chevron');
          if (chev) chev.style.transform = 'rotate(0deg)';
          store.set('sidebar_squads_collapsed', false);
        }
        router.navigate('workspaces');
        this.setActive('workspaces');
        this.closeMobile();
      });
    }

    // Click em subitem → ativa squad + navega para página dedicada
    this.el?.querySelectorAll('.nav-squad-subitem').forEach(sub => {
      sub.addEventListener('click', (e) => {
        // Clique no dot de "squad padrão" não navega
        if (e.target.closest('.ws-current-dot')) return;
        e.stopPropagation();
        const wsId = sub.dataset.squadId;
        const ws   = (store.get('userWorkspaces') || []).find(w => w.id === wsId);
        if (!ws) return;
        // ORDEM CRÍTICA: navegar PRIMEIRO (muda hash síncrono) e só depois
        // setar activeWorkspaces. Caso contrário, o subscribe de
        // activeWorkspaces re-renderiza a rota antiga (dashboard) antes
        // do navigate disparar — race condition que fazia o 1º clique
        // não responder.
        router.navigate(`squad?id=${encodeURIComponent(wsId)}`);
        store.set('activeWorkspaces', [wsId]);
        store.set('currentWorkspace', ws);
        saveWorkspaceSelection([wsId], wsId);
        this.closeMobile();
        // Atualiza estado visual (ativo / dot)
        this._rerenderSquadsBlock();
      });
    });

    // Dot de "squad padrão" — apenas define currentWorkspace sem navegar
    this.el?.querySelectorAll('.nav-squad-subitem .ws-current-dot').forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        const wsId = dot.dataset.wsid;
        const ws   = (store.get('userWorkspaces') || []).find(w => w.id === wsId);
        if (!ws) return;
        store.set('currentWorkspace', ws);
        saveWorkspaceSelection(store.get('activeWorkspaces') || [], wsId);
        this._rerenderSquadsBlock();
      });
    });
  }

  setActive(route) {
    if (!this.el) return;
    // Mapear rotas filhas para o item pai no sidebar
    const routeAliases = {
      'portal-tips-list': 'portal-tips',
      'portal-import':    'portal-tips',
      'portal-tip-editor':'portal-tips',
      'portal-import-manual':'portal-tips',
    };
    const effectiveRoute = routeAliases[route] || route;
    this.el.querySelectorAll('.nav-item').forEach(item => {
      const itemRoute = item.dataset.route;
      item.classList.toggle('active',
        effectiveRoute === itemRoute || effectiveRoute.startsWith(itemRoute + '/') ||
        route === itemRoute || route.startsWith(itemRoute + '/')
      );
    });
  }

  toggleCollapse() {
    this.collapsed = !this.collapsed;
    this.el?.classList.toggle('collapsed', this.collapsed);
    store.set('sidebarCollapsed', this.collapsed);

    // Ajustar main-content
    const main = document.querySelector('.main-content');
    if (main) {
      main.style.transition = 'margin-left var(--transition-normal)';
    }
  }

  openMobile() {
    this.el?.classList.add('mobile-open');
    this.overlay?.classList.add('visible');
    document.body.style.overflow = 'hidden';
  }

  closeMobile() {
    this.el?.classList.remove('mobile-open');
    this.overlay?.classList.remove('visible');
    document.body.style.overflow = '';
  }

  _showUserMenu() {
    import('./userMenu.js')
      .then(m => m.showUserMenu())
      .catch(() => {
        // Fallback inline
        const { signOut } = import('../auth/auth.js');
      });
  }

  mount(container) {
    const sidebarEl = this.render();
    container.appendChild(this.overlay);
    container.appendChild(sidebarEl);
    return this;
  }

  destroy() {
    // Cleanup robusto: cada item em try/catch pra que falha de um não impeça
    // os outros (antes: se _unsubRoute lançasse, _unsubWs ficava como leak).
    [
      () => this._unsubRoute?.(),
      () => this._unsubWs?.(),
      () => this._paletteObserver?.disconnect(),
      () => this.el?.remove(),
      () => this.overlay?.remove(),
    ].forEach(fn => { try { fn(); } catch (e) { console.warn('[sidebar] cleanup falhou:', e.message); } });
  }
}

export default Sidebar;
