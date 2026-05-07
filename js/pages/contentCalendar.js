/**
 * PRIMETOUR — Content Calendar Page
 * Calendario de conteudo com visualizacoes Mes/Semana/Lista
 * Gestao de slots de conteudo para redes sociais
 */

import { store } from '../store.js';
import { toast } from '../components/toast.js';
import {
  PLATFORMS, CONTENT_TYPES, SLOT_STATUSES, CATEGORIES,
  fetchSlots, subscribeToSlots, subscribeToTasksByIds,
  createSlot, updateSlot, deleteSlot,
  suggestWeekContent, suggestDescription,
  ensureGeneralProjectAndMigrateOrphans,
} from '../services/contentCalendar.js';
import { fetchProjects } from '../services/projects.js';
import { openTaskModal } from '../components/taskModal.js';
import { renderPickerButton, bindOptionPicker } from '../components/optionPicker.js';
import { createDoc, loadJsPdf, COL, txt, withExportGuard } from '../components/pdfKit.js';

const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ── Constants ──────────────────────────────────────────── */

const PT_MONTHS = ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
                   'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const PT_DAYS_S = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];

const STATUS_COLORS = {
  idea:      '#94A3B8',
  draft:     '#38BDF8',
  review:    '#FB923C',
  approved:  '#22C55E',
  published: '#10B981',
};

const STATUS_LABELS = {
  idea:      'Ideia',
  draft:     'Rascunho',
  review:    'Revisão',
  approved:  'Aprovado',
  published: 'Publicado',
};

const TYPE_ICONS = {
  post:       '📸',
  reel:       '🎬',
  carrossel:  '📑',
  story:      '📱',
  artigo:     '📰',
  newsletter: '✉',
};

const PLATFORM_LIST = [
  { value: 'instagram',  label: 'Instagram' },
  { value: 'facebook',   label: 'Facebook' },
  { value: 'linkedin',   label: 'LinkedIn' },
  { value: 'newsletter', label: 'Newsletter' },
  { value: 'blog',       label: 'Blog' },
  { value: 'tiktok',     label: 'TikTok' },
];

const CONTENT_TYPE_LIST = [
  { value: 'post',       label: 'Post' },
  { value: 'reel',       label: 'Reel' },
  { value: 'carrossel',  label: 'Carrossel' },
  { value: 'story',      label: 'Story' },
  { value: 'artigo',     label: 'Artigo' },
  { value: 'newsletter', label: 'Newsletter' },
];

const CATEGORY_LIST = [
  { value: 'destinos',      label: 'Destinos' },
  { value: 'dicas',         label: 'Dicas' },
  { value: 'institucional', label: 'Institucional' },
  { value: 'promocional',   label: 'Promocional' },
  { value: 'engajamento',   label: 'Engajamento' },
  { value: 'bastidores',    label: 'Bastidores' },
];

/* SLOT_TIME_LIST removido — não mais usado */

const ACCOUNTS = [
  { value: 'primetourviagens',  label: '@primetourviagens' },
  { value: 'icsbyprimetour',    label: '@icsbyprimetour' },
];

/* ── Option configs (optionPicker visual) ───────────────── */

const PLATFORM_OPTIONS = [
  { id: 'instagram',  label: 'Instagram',  icon: '📷', color: '#E1306C' },
  { id: 'facebook',   label: 'Facebook',   icon: '◈',  color: '#1877F2' },
  { id: 'linkedin',   label: 'LinkedIn',   icon: '▤',  color: '#0A66C2' },
  { id: 'newsletter', label: 'Newsletter', icon: '✉',  color: '#D4A843' },
  { id: 'blog',       label: 'Blog',       icon: '✎',  color: '#64748B' },
  { id: 'tiktok',     label: 'TikTok',     icon: '▣',  color: '#94A3B8' },
];

const CONTENT_TYPE_OPTIONS = [
  { id: 'post',       label: 'Post',       icon: '📸', color: '#6366F1' },
  { id: 'reel',       label: 'Reel',       icon: '🎬', color: '#EC4899' },
  { id: 'carrossel',  label: 'Carrossel',  icon: '📑', color: '#8B5CF6' },
  { id: 'story',      label: 'Story',      icon: '📱', color: '#F59E0B' },
  { id: 'artigo',     label: 'Artigo',     icon: '📰', color: '#0EA5E9' },
  { id: 'newsletter', label: 'Newsletter', icon: '✉',  color: '#D4A843' },
];

const ACCOUNT_OPTIONS = [
  { id: 'primetourviagens', label: '@primetourviagens', icon: '✈', color: '#D4A843' },
  { id: 'icsbyprimetour',   label: '@icsbyprimetour',   icon: '◈', color: '#22C55E' },
];

const CATEGORY_OPTIONS = [
  { id: 'destinos',      label: 'Destinos',      icon: '🌍', color: '#0EA5E9' },
  { id: 'dicas',         label: 'Dicas',         icon: '💡', color: '#F59E0B' },
  { id: 'institucional', label: 'Institucional', icon: '🏢', color: '#6366F1' },
  { id: 'promocional',   label: 'Promocional',   icon: '🎯', color: '#EC4899' },
  { id: 'engajamento',   label: 'Engajamento',   icon: '💬', color: '#22C55E' },
  { id: 'bastidores',    label: 'Bastidores',    icon: '🎬', color: '#8B5CF6' },
];

const findOption = (list, id) => list.find(o => o.id === id) || null;

/* ── State ──────────────────────────────────────────────── */

let allSlots      = [];
let currentDate   = new Date();
let activeView    = 'month';   // 'month' | 'week' | 'list'
let activeAccount = '';        // '' = all
let activeStatus  = '';        // GAP fix: filtro por status
let activePlatform = '';       // GAP fix: filtro por plataforma
let activeContentType = '';    // GAP fix: filtro por tipo de conteúdo
let editingSlot   = null;      // null = new slot
let modalOpen     = false;
// 4.11+ — projeto agora é o scope principal do calendário
// 4.16+ — multi-projeto: array de IDs em vez de string única.
// `activeProjectId` mantido como espelho do primeiro pra retrocompat.
let activeProjectIds  = [];   // [] = nenhum projeto
let activeProjectId   = '';   // espelho do primeiro (legado)
let availableProjects = [];   // projetos visíveis ao user (cache local)
// 4.15+ — listener real-time pra ver mudanças concorrentes
let _slotsUnsub = null;
// 4.16+ — Map<taskId, task> live cache + unsub pra re-vincular ao mudar slots
let _linkedTasks = new Map();
let _tasksUnsub = null;

/* ── Helpers ────────────────────────────────────────────── */

function startOfWeek(d) {
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  dt.setDate(dt.getDate() + diff);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function endOfWeek(d) {
  const dt = startOfWeek(d);
  dt.setDate(dt.getDate() + 6);
  dt.setHours(23, 59, 59, 999);
  return dt;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateBR(d) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/**
 * 4.15+ — Parser robusto de scheduledDate.
 *
 * BUG ANTERIOR: `new Date('2026-05-08')` interpreta como UTC midnight.
 * No fuso UTC-3 (Brasil), virava `2026-05-07T21:00:00`. `getDate()` retornava 7.
 * User configurava dia 8 e via dia 7 → bug crítico.
 *
 * Fix: se for string 'YYYY-MM-DD' → constrói Date no fuso LOCAL (meio-dia
 * pra evitar edge case de DST). Se já for Date ou Timestamp Firestore, retorna
 * como-está (já tá no fuso certo).
 */
function parseLocalDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  // Firestore Timestamp
  if (typeof value?.toDate === 'function') {
    try { const d = value.toDate(); return isNaN(d.getTime()) ? null : d; } catch { return null; }
  }
  if (typeof value === 'string') {
    // Match YYYY-MM-DD ou YYYY-MM-DD T... (pega só a parte de data)
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      // Constrói no fuso local; meio-dia pra robustez contra DST
      return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0);
    }
    // Fallback: ISO completo (com Z ou offset). new Date funciona ok aqui.
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  // number (timestamp ms) ou objeto com .seconds
  if (typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000);
  }
  return null;
}

function getMonthDays(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  let day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1; // Monday-indexed
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
}

function slotsForDate(date) {
  return allSlots.filter(s => {
    if (!s.scheduledDate) return false;
    const sd = parseLocalDate(s.scheduledDate);
    if (!sd) return false;
    return isSameDay(sd, date);
  }).filter(s => !activeAccount || s.account === activeAccount);
}

function getStatusColor(status) {
  return STATUS_COLORS[status] || '#6B7280';
}

function getTypeIcon(type) {
  return TYPE_ICONS[type] || '📄';
}

/* ── Main render ────────────────────────────────────────── */

export async function renderContentCalendar(container) {
  const main = container || document.getElementById('page-content') || document.getElementById('main');
  if (!main) return;

  // ── Parse URL ──────────────────────────────────────────
  // Aceita:
  //   - #content-calendar?project=ABC          (legado, single)
  //   - #content-calendar?projects=A,B,C       (4.16+, multi-projeto CSV)
  // Multi tem precedência se ambos presentes.
  try {
    const hashQuery = (location.hash || '').split('?')[1] || '';
    const params = new URLSearchParams(hashQuery);
    const csv = params.get('projects');
    if (csv) {
      activeProjectIds = csv.split(',').map(s => s.trim()).filter(Boolean);
    } else {
      const single = params.get('project') || '';
      activeProjectIds = single ? [single] : [];
    }
    activeProjectId = activeProjectIds[0] || '';
  } catch {
    activeProjectIds = [];
    activeProjectId = '';
  }

  // Migração best-effort: garante projeto "Geral · Conteúdo" e atribui
  // slots órfãos (idempotente, só roda 1x por sessão de browser).
  ensureGeneralProjectAndMigrateOrphans().catch(e =>
    console.warn('[ContentCalendar] migration skipped:', e.message));

  // Carrega projetos visíveis ao user (com cache do store)
  try {
    availableProjects = await fetchProjects();
  } catch (e) {
    console.warn('[ContentCalendar] fetchProjects falhou:', e.message);
    availableProjects = [];
  }

  // Carrega slots do projeto ativo + assina real-time
  await _bindSlotsListener();

  renderPage(main);
}

/**
 * Inicia/reinicia listener real-time de slots conforme activeProjectIds.
 * Idempotente: cancela anterior antes de assinar de novo.
 * Também rebinda o listener de tasks vinculadas após receber novos slots.
 */
async function _bindSlotsListener() {
  if (_slotsUnsub) { try { _slotsUnsub(); } catch {} _slotsUnsub = null; }

  const filters = activeProjectIds.length ? { projectIds: activeProjectIds } : {};
  // Primeiro fetch sincrono pra mostrar dados imediatos
  allSlots = await fetchSlots(filters);
  _bindTasksListener(); // re-vincula tasks listener com novos slots

  // Assina listener pra updates concorrentes
  _slotsUnsub = subscribeToSlots((slots) => {
    allSlots = slots;
    _bindTasksListener();
    // Só re-renderiza se a página continua montada (cc-body presente)
    if (document.getElementById('cc-body')) {
      renderCalendarBody();
    }
  }, filters);
}

/**
 * 4.16+ — Vincula listener às tasks dos slots com taskId.
 * Coleta IDs únicos do allSlots e mantém um Map<taskId, task> via onSnapshot.
 * Idempotente; cancela listeners anteriores antes de re-subscribe.
 * Quando o set de IDs não muda, evita reinicializar (otimização).
 */
let _lastTaskIdsSig = '';
function _bindTasksListener() {
  const taskIds = [...new Set(allSlots.map(s => s.taskId).filter(Boolean))].sort();
  const sig = taskIds.join('|');
  if (sig === _lastTaskIdsSig && _tasksUnsub) return; // sem mudança, mantém listener

  if (_tasksUnsub) { try { _tasksUnsub(); } catch {} _tasksUnsub = null; }
  _lastTaskIdsSig = sig;

  if (!taskIds.length) {
    _linkedTasks = new Map();
    return;
  }

  _tasksUnsub = subscribeToTasksByIds(taskIds, (taskMap) => {
    _linkedTasks = taskMap;
    if (document.getElementById('cc-body')) {
      renderCalendarBody();
    }
  });
}

/** Atualiza projetos ativos, sincroniza URL e recarrega slots. */
async function setActiveProjects(projectIds) {
  activeProjectIds = Array.isArray(projectIds) ? [...new Set(projectIds.filter(Boolean))] : [];
  activeProjectId  = activeProjectIds[0] || '';
  // Atualiza URL sem disparar router (history.replaceState)
  let newHash = '#content-calendar';
  if (activeProjectIds.length === 1) {
    newHash += `?project=${encodeURIComponent(activeProjectIds[0])}`;
  } else if (activeProjectIds.length > 1) {
    newHash += `?projects=${activeProjectIds.map(encodeURIComponent).join(',')}`;
  }
  try { history.replaceState(null, '', newHash); } catch {}
  // Re-bind listener com novo scope
  await _bindSlotsListener();
  const main = document.getElementById('page-content') || document.getElementById('main');
  if (main) renderPage(main);
}

/** Compat: setActiveProject (single) — usa o novo setActiveProjects. */
async function setActiveProject(projectId) {
  return setActiveProjects(projectId ? [projectId] : []);
}

/**
 * 4.16+ — Popover pra adicionar projeto à seleção multi.
 * Lista projetos disponíveis (excluindo os já ativos), permite filtrar e clicar.
 */
function _openAddProjectPopover(anchor) {
  // Remove popover anterior se existir
  document.querySelectorAll('.cc-project-popover').forEach(el => el.remove());

  const candidates = availableProjects.filter(p =>
    !activeProjectIds.includes(p.id) && !p.archived
  );
  if (!candidates.length) {
    toast.info('Todos os projetos disponíveis já estão no calendário.');
    return;
  }

  const pop = document.createElement('div');
  pop.className = 'cc-project-popover';
  pop.style.cssText = `
    position:fixed; z-index:9999;
    background:var(--bg-card,#111B27); border:1px solid var(--border-subtle,#1E2D3D);
    border-radius:10px; box-shadow:0 12px 40px rgba(0,0,0,0.5);
    padding:8px; min-width:260px; max-width:340px;
  `;
  pop.innerHTML = `
    <div style="font-size:0.6875rem;color:var(--text-muted);padding:6px 10px 8px;
      border-bottom:1px solid var(--border-subtle);margin-bottom:6px;
      text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">
      Adicionar projeto ao calendário
    </div>
    <input type="text" id="cc-add-search" placeholder="Buscar..." autofocus
      style="width:calc(100% - 20px);margin:0 10px 8px;padding:6px 10px;
      border:1px solid var(--border-subtle);border-radius:6px;
      background:var(--bg-surface);color:var(--text-primary);outline:none;
      font-family:inherit;font-size:0.8125rem;box-sizing:border-box;">
    <div id="cc-add-list" style="max-height:280px;overflow-y:auto;padding:0 4px;">
      ${candidates.map(p => `
        <div class="cc-add-item" data-pid="${esc(p.id)}" data-name="${esc((p.name||'').toLowerCase())}"
          style="display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;
          border-radius:6px;font-size:0.8125rem;color:var(--text-primary);">
          <span style="font-size:1rem;">${esc(p.icon || '📦')}</span>
          <span style="flex:1;">${esc(p.name)}</span>
          <span style="width:8px;height:8px;border-radius:50%;background:${p.color || '#D4A843'};"></span>
        </div>
      `).join('')}
    </div>
  `;
  document.body.appendChild(pop);

  // Posiciona abaixo do anchor
  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let left = r.right - pr.width;
  if (left < 8) left = 8;
  let top = r.bottom + 6;
  if (top + pr.height > window.innerHeight - 8) top = r.top - pr.height - 6;
  pop.style.left = `${left}px`;
  pop.style.top  = `${top}px`;

  // Hover effect
  pop.querySelectorAll('.cc-add-item').forEach(el => {
    el.addEventListener('mouseenter', () => el.style.background = 'var(--bg-elevated)');
    el.addEventListener('mouseleave', () => el.style.background = 'transparent');
    el.addEventListener('click', () => {
      const pid = el.dataset.pid;
      pop.remove();
      setActiveProjects([...activeProjectIds, pid]);
    });
  });

  // Search filter
  const search = pop.querySelector('#cc-add-search');
  search?.focus();
  search?.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    pop.querySelectorAll('.cc-add-item').forEach(el => {
      el.style.display = el.dataset.name.includes(q) ? '' : 'none';
    });
  });

  // Close on outside click / ESC
  // ATENÇÃO: NÃO renomear `escHandler` pra `esc` — `esc` é a função global
  // de escape HTML do módulo (linha 21). Shadow + TDZ causam ReferenceError
  // em qualquer uso de esc() acima nesta função (bug 4.16.0 fix).
  const close = () => { pop.remove(); document.removeEventListener('click', outside, true); document.removeEventListener('keydown', escHandler); };
  const outside = (ev) => { if (!pop.contains(ev.target) && ev.target !== anchor) close(); };
  const escHandler = (ev) => { if (ev.key === 'Escape') close(); };
  setTimeout(() => {
    document.addEventListener('click', outside, true);
    document.addEventListener('keydown', escHandler);
  }, 0);
}

/** Cleanup quando sai da página. Chamado pelo router em destroy. */
export function destroyContentCalendar() {
  if (_slotsUnsub) { try { _slotsUnsub(); } catch {} _slotsUnsub = null; }
  if (_tasksUnsub) { try { _tasksUnsub(); } catch {} _tasksUnsub = null; }
  _lastTaskIdsSig = '';
  _linkedTasks = new Map();
}

function renderPage(container) {
  const y = currentDate.getFullYear();
  const m = currentDate.getMonth();

  const navLabel = activeView === 'week'
    ? (() => {
        const ws = startOfWeek(currentDate);
        const we = endOfWeek(currentDate);
        return `${String(ws.getDate()).padStart(2, '0')}/${String(ws.getMonth() + 1).padStart(2, '0')} - ${String(we.getDate()).padStart(2, '0')}/${String(we.getMonth() + 1).padStart(2, '0')}/${we.getFullYear()}`;
      })()
    : `${PT_MONTHS[m]} ${y}`;

  // 4.16+ — Multi-projeto: lista de projetos ativos, deduplicados e validados
  const activeProjectsResolved = activeProjectIds
    .map(id => availableProjects.find(p => p.id === id))
    .filter(Boolean);
  const hasProjectSelected = activeProjectsResolved.length > 0;
  const projectGoneFromList = activeProjectIds.length > 0 && activeProjectsResolved.length === 0;
  const isMulti = activeProjectsResolved.length > 1;
  const activeProject = activeProjectsResolved[0] || null; // primeiro pra header label

  container.innerHTML = `
    <div style="padding:0;">
      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:8px;">
        <div>
          <h1 style="font-size:1.5rem;font-weight:700;color:var(--text-primary,#E8ECF1);margin:0 0 4px 0;">
            📱 Calendário de Conteúdo
            ${isMulti
              ? `<span style="margin-left:8px;font-size:0.875rem;font-weight:500;color:var(--brand-gold);">· ${activeProjectsResolved.length} projetos</span>`
              : (activeProject
                  ? `<span style="margin-left:8px;font-size:0.875rem;font-weight:500;color:${activeProject.color || 'var(--brand-gold)'};">· ${esc(activeProject.icon || '📦')} ${esc(activeProject.name)}</span>`
                  : '')}
          </h1>
          <p style="font-size:0.8125rem;color:var(--text-muted,#5A6B7A);margin:0;">
            ${hasProjectSelected
              ? (isMulti
                  ? 'Visualizando múltiplos projetos. Cores dos cards = cor do projeto.'
                  : 'Calendário deste projeto. Adicione mais projetos pra ver vários ao mesmo tempo.')
              : 'Selecione um projeto pra ver/criar conteúdo.'}
          </p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          ${hasProjectSelected ? `
          <!-- View toggle -->
          <div style="display:flex;border:1px solid var(--border-subtle,#1E2D3D);border-radius:8px;overflow:hidden;">
            ${[['month', 'Mes'], ['week', 'Semana'], ['list', 'Lista']].map(([v, l]) => `
              <button data-view="${v}" style="padding:6px 14px;border:none;cursor:pointer;font-size:0.8125rem;
                background:${activeView === v ? 'var(--brand-gold,#D4A843)' : 'var(--bg-surface,#16202C)'};
                color:${activeView === v ? '#FFFFFF' : 'var(--text-muted,#5A6B7A)'};
                transition:all 0.15s;font-weight:${activeView === v ? '600' : '400'};">${l}</button>
            `).join('')}
          </div>` : ''}

          ${hasProjectSelected ? `
          <!-- Account selector (secondary — handle social) -->
          <select id="cc-account-select" style="padding:6px 12px;border:1px solid var(--border-subtle,#1E2D3D);
            border-radius:8px;background:var(--bg-surface,#16202C);color:var(--text-primary,#E8ECF1);
            font-size:0.8125rem;cursor:pointer;outline:none;">
            <option value="">Todas as contas</option>
            ${ACCOUNTS.map(a => `<option value="${esc(a.value)}" ${activeAccount === a.value ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}
          </select>` : ''}

          ${hasProjectSelected ? `
          <!-- Navigation -->
          <div style="display:flex;align-items:center;gap:4px;">
            <button id="cc-prev" style="padding:6px 10px;border:1px solid var(--border-subtle,#1E2D3D);
              border-radius:8px;background:var(--bg-surface,#16202C);color:var(--text-primary,#E8ECF1);
              cursor:pointer;font-size:0.875rem;" title="Anterior">&#9664;</button>
            <span style="font-size:0.875rem;font-weight:600;color:var(--text-primary,#E8ECF1);
              min-width:180px;text-align:center;">${esc(navLabel)}</span>
            <button id="cc-next" style="padding:6px 10px;border:1px solid var(--border-subtle,#1E2D3D);
              border-radius:8px;background:var(--bg-surface,#16202C);color:var(--text-primary,#E8ECF1);
              cursor:pointer;font-size:0.875rem;" title="Proximo">&#9654;</button>
          </div>

          <!-- Action buttons -->
          <button id="cc-new-slot" style="padding:6px 16px;border:none;border-radius:8px;
            background:var(--brand-gold,#D4A843);color:#FFFFFF;font-size:0.8125rem;font-weight:600;
            cursor:pointer;transition:opacity 0.15s;">+ Novo Slot</button>
          <button id="cc-suggest-week" style="padding:6px 16px;border:1px solid var(--brand-gold,#D4A843);
            border-radius:8px;background:transparent;color:var(--brand-gold,#D4A843);
            font-size:0.8125rem;font-weight:600;cursor:pointer;transition:opacity 0.15s;">
            IA: Sugerir Semana</button>` : ''}
          ${hasProjectSelected ? `
          <!-- Split-button Export (consolida XLS+PDF) -->
          <div class="uikit-export-wrap" style="position:relative;display:inline-block;">
            <button class="uikit-export-trigger" data-export-trigger="1"
              style="padding:6px 12px;border:1px solid var(--border-subtle,#1E2D3D);border-radius:8px;
              background:var(--bg-surface,#16202C);color:var(--text-primary,#E8ECF1);
              font-size:0.8125rem;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px;">
              <span>↓</span><span>Exportar</span><span style="font-size:0.6em;">▾</span>
            </button>
            <div class="uikit-export-menu" style="display:none;position:absolute;top:100%;right:0;margin-top:4px;
              background:var(--bg-card,#0F1923);border:1px solid var(--border-subtle,#1E2D3D);border-radius:8px;
              min-width:180px;box-shadow:0 4px 12px rgba(0,0,0,0.4);z-index:100;padding:4px;">
              <button class="uikit-export-item" id="cc-export-xls"
                style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 12px;
                background:transparent;border:none;cursor:pointer;font-size:0.8125rem;color:var(--text-primary);
                border-radius:6px;font-family:inherit;">
                <span style="font-size:0.7em;color:var(--text-muted);">↓</span><span>Excel (.xlsx)</span>
              </button>
              <button class="uikit-export-item" id="cc-export-pdf"
                style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 12px;
                background:transparent;border:none;cursor:pointer;font-size:0.8125rem;color:var(--text-primary);
                border-radius:6px;font-family:inherit;">
                <span style="font-size:0.7em;color:var(--text-muted);">↓</span><span>PDF</span>
              </button>
            </div>
          </div>` : ''}
        </div>
      </div>

      <!-- 4.16+: Chips de projetos ativos (multi-select) -->
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:16px;
        padding:8px 12px;background:var(--bg-surface,#16202C);border-radius:8px;
        border:1px solid var(--border-subtle,#1E2D3D);">
        <span style="font-size:0.6875rem;color:var(--text-muted);text-transform:uppercase;
          letter-spacing:0.05em;font-weight:600;margin-right:4px;">Projetos:</span>
        ${activeProjectsResolved.length === 0 ? `
          <span style="font-size:0.8125rem;color:var(--text-muted);font-style:italic;">
            Nenhum selecionado
          </span>
        ` : activeProjectsResolved.map(p => `
          <span class="cc-project-chip" data-pid="${esc(p.id)}"
            style="display:inline-flex;align-items:center;gap:4px;padding:3px 6px 3px 10px;
            background:${p.color || '#D4A843'}22;border:1px solid ${p.color || '#D4A843'};
            border-radius:99px;font-size:0.75rem;font-weight:500;color:var(--text-primary);">
            <span style="font-size:0.875rem;">${esc(p.icon || '📦')}</span>
            <span>${esc(p.name)}</span>
            <button class="cc-chip-remove" data-pid="${esc(p.id)}" title="Remover do calendário"
              style="background:none;border:none;color:var(--text-muted);cursor:pointer;
              padding:0 4px;font-size:0.875rem;line-height:1;">✕</button>
          </span>
        `).join('')}
        <button id="cc-add-project" title="Adicionar projeto ao calendário"
          style="padding:6px 14px;border:none;border-radius:99px;
          background:var(--brand-gold,#D4A843);color:#FFFFFF;font-size:0.75rem;font-weight:600;
          cursor:pointer;margin-left:auto;transition:opacity 0.15s;"
          onmouseover="this.style.opacity='0.85'"
          onmouseout="this.style.opacity='1'">+ Adicionar projeto</button>
      </div>

      ${hasProjectSelected ? `
      <!-- Sub-toolbar de filtros (apenas na view "lista") — GAP fix: status/plataforma/categoria -->
      <div id="cc-filter-bar" style="display:${activeView === 'list' ? 'flex' : 'none'};
        gap:8px;flex-wrap:wrap;padding:0 12px 12px;align-items:center;">
        <select id="cc-filter-status" style="padding:5px 10px;border:1px solid var(--border-subtle,#1E2D3D);
          border-radius:6px;background:var(--bg-surface,#16202C);color:var(--text-primary,#E8ECF1);
          font-size:0.75rem;cursor:pointer;">
          <option value="">Todos status</option>
          <option value="idea">Ideia</option>
          <option value="draft">Rascunho</option>
          <option value="review">Revisão</option>
          <option value="approved">Aprovado</option>
          <option value="published">Publicado</option>
        </select>
        <select id="cc-filter-platform" style="padding:5px 10px;border:1px solid var(--border-subtle,#1E2D3D);
          border-radius:6px;background:var(--bg-surface,#16202C);color:var(--text-primary,#E8ECF1);
          font-size:0.75rem;cursor:pointer;">
          <option value="">Todas plataformas</option>
        </select>
        <select id="cc-filter-content-type" style="padding:5px 10px;border:1px solid var(--border-subtle,#1E2D3D);
          border-radius:6px;background:var(--bg-surface,#16202C);color:var(--text-primary,#E8ECF1);
          font-size:0.75rem;cursor:pointer;">
          <option value="">Todos tipos</option>
        </select>
      </div>

      <!-- Calendar body -->
      <div id="cc-body"></div>
      ` : `
      <!-- Empty state: nenhum projeto selecionado -->
      <div style="text-align:center;padding:80px 24px;color:var(--text-muted,#5A6B7A);">
        <div style="font-size:4rem;margin-bottom:16px;">📂</div>
        <h2 style="font-size:1.25rem;font-weight:700;color:var(--text-primary,#E8ECF1);margin:0 0 8px 0;">
          ${projectGoneFromList ? 'Projeto não encontrado' : 'Selecione um projeto pra começar'}
        </h2>
        <p style="font-size:0.875rem;line-height:1.6;max-width:520px;margin:0 auto 24px;">
          ${projectGoneFromList
            ? 'O projeto deste link foi arquivado, removido ou você não tem acesso. Escolha outro no seletor acima.'
            : 'O calendário de conteúdo agora é organizado por <strong>projeto</strong>. Cada projeto tem seu próprio calendário com slots, ideias e cronograma.'}
        </p>
        ${availableProjects.length === 0 ? `
        <p style="font-size:0.8125rem;color:var(--text-muted);max-width:520px;margin:0 auto 16px;">
          Você ainda não tem projetos. Crie um pra começar!
        </p>` : ''}
        <div style="display:flex;justify-content:center;gap:12px;flex-wrap:wrap;">
          <button id="cc-empty-go-projects" style="padding:10px 20px;border:1px solid var(--brand-gold,#D4A843);
            border-radius:8px;background:transparent;color:var(--brand-gold,#D4A843);font-size:0.875rem;
            font-weight:600;cursor:pointer;">
            ${availableProjects.length === 0 ? '+ Criar primeiro projeto' : '↗ Ver todos os projetos'}
          </button>
        </div>
      </div>
      `}

      <!-- Modal overlay -->
      <div id="cc-modal-overlay" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;
        background:rgba(0,0,0,0.6);z-index:9999;justify-content:center;align-items:flex-start;
        padding:40px 16px;overflow-y:auto;"></div>
    </div>
  `;

  renderCalendarBody();
  bindHeaderEvents(container);
}

/* ── Calendar body renderers ────────────────────────────── */

function renderCalendarBody() {
  const body = document.getElementById('cc-body');
  if (!body) return;

  if (activeView === 'month') renderMonthView(body);
  else if (activeView === 'week') renderWeekView(body);
  else renderListView(body);
}

/* ── Month View ─────────────────────────────────────────── */

function renderMonthView(container) {
  const y = currentDate.getFullYear();
  const m = currentDate.getMonth();
  const totalDays = getMonthDays(y, m);
  const firstDay = getFirstDayOfMonth(y, m);
  const today = new Date();

  // Previous month trailing days
  const prevMonthDays = getMonthDays(y, m - 1 < 0 ? 11 : m - 1);
  const cells = [];

  // Leading empty cells from previous month
  for (let i = 0; i < firstDay; i++) {
    const dayNum = prevMonthDays - firstDay + 1 + i;
    cells.push({ day: dayNum, currentMonth: false, date: null });
  }

  // Current month days
  for (let d = 1; d <= totalDays; d++) {
    cells.push({ day: d, currentMonth: true, date: new Date(y, m, d) });
  }

  // Trailing cells to fill last row
  const remaining = 7 - (cells.length % 7);
  if (remaining < 7) {
    for (let i = 1; i <= remaining; i++) {
      cells.push({ day: i, currentMonth: false, date: null });
    }
  }

  container.innerHTML = `
    <div style="background:var(--bg-card,#111B27);border:1px solid var(--border-subtle,#1E2D3D);
      border-radius:12px;overflow:hidden;">
      <!-- Day headers -->
      <div style="display:grid;grid-template-columns:repeat(7,1fr);border-bottom:1px solid var(--border-subtle,#1E2D3D);">
        ${PT_DAYS_S.map(d => `
          <div style="padding:10px 8px;text-align:center;font-size:0.75rem;font-weight:600;
            color:var(--text-muted,#5A6B7A);text-transform:uppercase;letter-spacing:0.05em;">${d}</div>
        `).join('')}
      </div>
      <!-- Day cells -->
      <div style="display:grid;grid-template-columns:repeat(7,1fr);">
        ${cells.map((cell, idx) => {
          const isToday = cell.date && isSameDay(cell.date, today);
          const slots = cell.date ? slotsForDate(cell.date) : [];
          const borderRight = (idx + 1) % 7 !== 0 ? 'border-right:1px solid var(--border-subtle,#1E2D3D);' : '';
          const borderBottom = idx < cells.length - 7 ? 'border-bottom:1px solid var(--border-subtle,#1E2D3D);' : '';

          return `
            <div class="cc-day-cell" data-date="${cell.date ? formatDate(cell.date) : ''}"
              style="min-height:110px;padding:6px;${borderRight}${borderBottom}
                background:${isToday ? 'rgba(212,168,67,0.06)' : 'transparent'};
                opacity:${cell.currentMonth ? '1' : '0.35'};
                cursor:${cell.date ? 'pointer' : 'default'};transition:background 0.15s;">
              <div style="font-size:0.8125rem;font-weight:${isToday ? '700' : '500'};
                color:${isToday ? 'var(--brand-gold,#D4A843)' : 'var(--text-primary,#E8ECF1)'};
                margin-bottom:4px;display:flex;align-items:center;gap:4px;">
                ${isToday ? `<span style="width:6px;height:6px;border-radius:50%;background:var(--brand-gold,#D4A843);"></span>` : ''}
                ${cell.day}
              </div>
              <div style="display:flex;flex-direction:column;gap:3px;">
                ${slots.slice(0, 3).map(slot => renderSlotCard(slot, 'compact')).join('')}
                ${slots.length > 3 ? `<div style="font-size:0.6875rem;color:var(--text-muted,#5A6B7A);padding:2px 4px;">+${slots.length - 3} mais</div>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  bindCalendarCellEvents(container);
}

/* ── Week View ──────────────────────────────────────────── */

function renderWeekView(container) {
  const ws = startOfWeek(currentDate);
  const today = new Date();
  const days = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(ws);
    d.setDate(ws.getDate() + i);
    days.push(d);
  }

  container.innerHTML = `
    <div style="background:var(--bg-card,#111B27);border:1px solid var(--border-subtle,#1E2D3D);
      border-radius:12px;overflow:hidden;">
      <div style="display:grid;grid-template-columns:repeat(7,1fr);">
        ${days.map((day, idx) => {
          const isToday = isSameDay(day, today);
          const slots = slotsForDate(day);
          const borderRight = idx < 6 ? 'border-right:1px solid var(--border-subtle,#1E2D3D);' : '';
          const dayName = PT_DAYS_S[idx];

          return `
            <div class="cc-day-cell" data-date="${formatDate(day)}"
              style="min-height:400px;padding:10px 8px;${borderRight}
                background:${isToday ? 'rgba(212,168,67,0.06)' : 'transparent'};
                cursor:pointer;transition:background 0.15s;">
              <!-- Day header -->
              <div style="text-align:center;margin-bottom:10px;padding-bottom:8px;
                border-bottom:1px solid var(--border-subtle,#1E2D3D);">
                <div style="font-size:0.6875rem;font-weight:600;text-transform:uppercase;
                  letter-spacing:0.05em;color:var(--text-muted,#5A6B7A);margin-bottom:2px;">${dayName}</div>
                <div style="font-size:1.125rem;font-weight:${isToday ? '700' : '500'};
                  color:${isToday ? 'var(--brand-gold,#D4A843)' : 'var(--text-primary,#E8ECF1)'};">
                  ${day.getDate()}
                </div>
              </div>
              <!-- Slots -->
              <div style="display:flex;flex-direction:column;gap:6px;">
                ${slots.map(slot => renderSlotCard(slot, 'detailed')).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  bindCalendarCellEvents(container);
}

/* ── List View ──────────────────────────────────────────── */

function renderListView(container) {
  const y = currentDate.getFullYear();
  const m = currentDate.getMonth();

  let filtered = allSlots.filter(s => {
    if (!s.scheduledDate) return false;
    const sd = parseLocalDate(s.scheduledDate);
    if (!sd) return false;
    return sd.getFullYear() === y && sd.getMonth() === m;
  });

  if (activeAccount)     filtered = filtered.filter(s => s.account === activeAccount);
  if (activeStatus)      filtered = filtered.filter(s => s.status === activeStatus);
  if (activePlatform)    filtered = filtered.filter(s => s.platform === activePlatform);
  if (activeContentType) filtered = filtered.filter(s => s.contentType === activeContentType);

  // Sort by date
  filtered.sort((a, b) => {
    const da = parseLocalDate(a.scheduledDate);
    const db = parseLocalDate(b.scheduledDate);
    return (da?.getTime() || 0) - (db?.getTime() || 0);
  });

  container.innerHTML = `
    <div style="background:var(--bg-card,#111B27);border:1px solid var(--border-subtle,#1E2D3D);
      border-radius:12px;overflow:hidden;">
      <!-- Table header -->
      <div style="display:grid;grid-template-columns:100px 1fr 110px 100px 100px 130px 80px;
        gap:0;border-bottom:1px solid var(--border-subtle,#1E2D3D);padding:12px 16px;
        background:var(--bg-surface,#16202C);">
        ${['Data', 'Titulo', 'Plataforma', 'Tipo', 'Status', 'Conta', 'Acoes'].map(h => `
          <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;
            letter-spacing:0.08em;color:var(--text-muted,#5A6B7A);">${h}</div>
        `).join('')}
      </div>
      <!-- Rows -->
      ${filtered.length === 0 ? `
        <div style="padding:40px;text-align:center;color:var(--text-muted,#5A6B7A);font-size:0.875rem;">
          Nenhum slot para este periodo
        </div>
      ` : filtered.map(slot => {
        const sd = parseLocalDate(slot.scheduledDate) || new Date();
        const statusColor = getStatusColor(slot.status);
        const typeIcon = getTypeIcon(slot.contentType);
        const account = ACCOUNTS.find(a => a.value === slot.account);

        return `
          <div class="cc-list-row" data-slot-id="${esc(slot.id)}"
            style="display:grid;grid-template-columns:100px 1fr 110px 100px 100px 130px 80px;
              gap:0;padding:10px 16px;border-bottom:1px solid var(--border-subtle,#1E2D3D);
              cursor:pointer;transition:background 0.15s;align-items:center;"
            onmouseover="this.style.background='var(--bg-surface,#16202C)'"
            onmouseout="this.style.background='transparent'">
            <div style="font-size:0.8125rem;color:var(--text-primary,#E8ECF1);">${formatDateBR(sd)}</div>
            <div style="font-size:0.8125rem;color:var(--text-primary,#E8ECF1);font-weight:500;
              overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:12px;">
              ${esc(slot.title || 'Sem titulo')}
            </div>
            <div style="font-size:0.8125rem;color:var(--text-muted,#5A6B7A);">
              ${esc(slot.platform || '-')}
            </div>
            <div style="font-size:0.8125rem;color:var(--text-muted,#5A6B7A);">
              ${typeIcon} ${esc(slot.contentType || '-')}
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="width:8px;height:8px;border-radius:50%;background:${statusColor};flex-shrink:0;"></span>
              <span style="font-size:0.75rem;color:${statusColor};font-weight:500;">
                ${esc(STATUS_LABELS[slot.status] || slot.status || '-')}
              </span>
            </div>
            <div style="font-size:0.8125rem;color:var(--text-muted,#5A6B7A);">
              ${esc(account ? account.label : slot.account || '-')}
            </div>
            <div>
              <button class="cc-edit-btn" data-slot-id="${esc(slot.id)}"
                style="padding:4px 10px;border:1px solid var(--border-subtle,#1E2D3D);
                  border-radius:6px;background:var(--bg-surface,#16202C);color:var(--text-primary,#E8ECF1);
                  font-size:0.75rem;cursor:pointer;">Editar</button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Bind list row clicks
  container.querySelectorAll('.cc-list-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.cc-edit-btn')) return;
      const slotId = row.dataset.slotId;
      const slot = allSlots.find(s => s.id === slotId);
      if (slot) openSlotModal(slot);
    });
  });

  container.querySelectorAll('.cc-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const slotId = btn.dataset.slotId;
      const slot = allSlots.find(s => s.id === slotId);
      if (slot) openSlotModal(slot);
    });
  });
}

/* ── Slot card renderer ─────────────────────────────────── */

function renderSlotCard(slot, mode) {
  const statusColor = getStatusColor(slot.status);
  const typeIcon = getTypeIcon(slot.contentType);
  const title = truncate(slot.title || 'Sem titulo', mode === 'compact' ? 20 : 35);

  // 4.16+ — Cor do projeto (border-left) quando multi-projeto ativo
  const project = slot.projectId
    ? availableProjects.find(p => p.id === slot.projectId)
    : null;
  const isMulti = activeProjectIds.length > 1;
  const projectColor = (isMulti && project?.color) ? project.color : statusColor;

  // 4.16+ — Badge dinâmico baseado no status REAL da task vinculada (live lookup)
  // Estados:
  //  - sem taskId → nada
  //  - taskId + task.status === 'done' → ✓ Concluída (verde sólido)
  //  - taskId + task.status === 'cancelled' → ✕ Cancelada (cinza)
  //  - taskId + outros → Tarefa (amarelo, em andamento)
  let taskBadge = '';
  if (slot.taskId) {
    const task = _linkedTasks.get(slot.taskId);
    if (task?.status === 'done') {
      taskBadge = `<span style="font-size:0.5625rem;background:rgba(34,197,94,0.25);color:#22C55E;padding:1px 6px;border-radius:4px;margin-left:4px;font-weight:600;">✓ Concluída</span>`;
    } else if (task?.status === 'cancelled') {
      taskBadge = `<span style="font-size:0.5625rem;background:rgba(107,114,128,0.18);color:#9AA5B5;padding:1px 6px;border-radius:4px;margin-left:4px;text-decoration:line-through;">Cancelada</span>`;
    } else if (task) {
      taskBadge = `<span style="font-size:0.5625rem;background:rgba(245,158,11,0.18);color:#F59E0B;padding:1px 6px;border-radius:4px;margin-left:4px;">Tarefa</span>`;
    } else {
      // Task ainda não chegou pelo listener — placeholder neutro
      taskBadge = `<span style="font-size:0.5625rem;background:rgba(107,114,128,0.12);color:var(--text-muted);padding:1px 6px;border-radius:4px;margin-left:4px;">Tarefa</span>`;
    }
  }

  // Mini badge (compact) só com ✓ verde se concluída — economiza espaço
  let compactTaskMark = '';
  if (slot.taskId) {
    const task = _linkedTasks.get(slot.taskId);
    compactTaskMark = task?.status === 'done'
      ? `<span title="Tarefa concluída" style="color:#22C55E;font-weight:700;font-size:0.625rem;flex-shrink:0;">✓</span>`
      : `<span title="Vinculada a tarefa" style="color:#F59E0B;font-size:0.625rem;flex-shrink:0;">●</span>`;
  }

  if (mode === 'compact') {
    return `
      <div class="cc-slot-card" draggable="true" data-slot-id="${esc(slot.id)}"
        style="padding:3px 6px;border-radius:4px;font-size:0.6875rem;cursor:pointer;
          background:${statusColor}18;border-left:3px solid ${projectColor};
          transition:background 0.15s;display:flex;align-items:center;gap:3px;overflow:hidden;"
        onmouseover="this.style.background='${statusColor}30'"
        onmouseout="this.style.background='${statusColor}18'">
        <span style="flex-shrink:0;">${typeIcon}</span>
        <span style="color:var(--text-primary,#E8ECF1);overflow:hidden;text-overflow:ellipsis;
          white-space:nowrap;">${esc(title)}</span>
        ${compactTaskMark}
        <span style="width:5px;height:5px;border-radius:50%;background:${statusColor};flex-shrink:0;margin-left:auto;"></span>
      </div>
    `;
  }

  // Detailed mode (week view)
  const sd = parseLocalDate(slot.scheduledDate) || new Date();
  const desc = slot.description || slot.brief || '';

  return `
    <div class="cc-slot-card" draggable="true" data-slot-id="${esc(slot.id)}"
      style="padding:8px 10px;border-radius:6px;cursor:pointer;
        background:${statusColor}12;border-left:3px solid ${projectColor};
        transition:background 0.15s;"
      onmouseover="this.style.background='${statusColor}25'"
      onmouseout="this.style.background='${statusColor}12'">
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
        <span style="font-size:0.8125rem;">${typeIcon}</span>
        <span style="font-size:0.75rem;font-weight:600;color:var(--text-primary,#E8ECF1);
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(title)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:4px;margin-top:4px;flex-wrap:wrap;">
        <span style="width:6px;height:6px;border-radius:50%;background:${statusColor};flex-shrink:0;"></span>
        <span style="font-size:0.6875rem;color:${statusColor};">${esc(STATUS_LABELS[slot.status] || '')}</span>
        ${taskBadge}
        ${isMulti && project ? `<span style="font-size:0.625rem;color:${project.color || 'var(--text-muted)'};opacity:0.85;">· ${esc(project.icon || '📦')} ${esc(project.name)}</span>` : ''}
      </div>
      ${desc ? `<div style="font-size:0.6875rem;color:var(--text-muted,#5A6B7A);margin-top:4px;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(truncate(desc, 40))}</div>` : ''}
    </div>
  `;
}

/* ── Cell event binding ─────────────────────────────────── */

/**
 * Injeta CSS pra drag-drop (idempotente).
 * Não temos css/contentCalendar.css; injetamos uma vez via <style>.
 */
function ensureCalendarStyles() {
  if (document.getElementById('cc-styles')) return;
  const styleEl = document.createElement('style');
  styleEl.id = 'cc-styles';
  styleEl.textContent = `
    .cc-slot-card[draggable="true"] { user-select: none; }
    .cc-slot-card.cc-dragging {
      opacity: 0.4; cursor: grabbing;
      transform: rotate(1deg) scale(1.02);
    }
    .cc-day-cell.cc-drag-over {
      background: rgba(212, 168, 67, 0.18) !important;
      box-shadow: inset 0 0 0 2px var(--brand-gold, #D4A843);
    }
  `;
  document.head.appendChild(styleEl);
}

function bindCalendarCellEvents(container) {
  ensureCalendarStyles();
  // Click on empty area of day cell = new slot with date
  container.querySelectorAll('.cc-day-cell').forEach(cell => {
    cell.addEventListener('click', (e) => {
      if (e.target.closest('.cc-slot-card')) return;
      const dateStr = cell.dataset.date;
      if (!dateStr) return;
      openSlotModal(null, dateStr);
    });
  });

  // Click on slot card = edit that slot
  container.querySelectorAll('.cc-slot-card').forEach(card => {
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      const slotId = card.dataset.slotId;
      const slot = allSlots.find(s => s.id === slotId);
      if (slot) openSlotModal(slot);
    });
  });

  // 4.15+ — Drag-and-drop: arrasta um slot pra outro dia/cell pra mudar data
  let _dragSlotId = null;
  container.querySelectorAll('.cc-slot-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      _dragSlotId = card.dataset.slotId;
      card.classList.add('cc-dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', _dragSlotId); } catch {}
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('cc-dragging');
      container.querySelectorAll('.cc-day-cell.cc-drag-over').forEach(c => c.classList.remove('cc-drag-over'));
      _dragSlotId = null;
    });
  });
  container.querySelectorAll('.cc-day-cell').forEach(cell => {
    cell.addEventListener('dragover', (e) => {
      if (!cell.dataset.date) return; // padding cells
      e.preventDefault(); // necessário pra permitir drop
      e.dataTransfer.dropEffect = 'move';
      cell.classList.add('cc-drag-over');
    });
    cell.addEventListener('dragleave', () => {
      cell.classList.remove('cc-drag-over');
    });
    cell.addEventListener('drop', async (e) => {
      e.preventDefault();
      cell.classList.remove('cc-drag-over');
      const slotId = _dragSlotId || (e.dataTransfer?.getData('text/plain') || '');
      const newDate = cell.dataset.date;
      if (!slotId || !newDate) return;
      const slot = allSlots.find(s => s.id === slotId);
      if (!slot) return;
      // Sem mudança real
      const currIso = slot.scheduledDate
        ? formatDate(parseLocalDate(slot.scheduledDate) || new Date())
        : '';
      if (currIso === newDate) return;
      try {
        await updateSlot(slot.id, { scheduledDate: newDate });
        slot.scheduledDate = newDate;
        toast.success(`Movido para ${newDate.split('-').reverse().join('/')}`);
        renderCalendarBody();
      } catch (err) {
        console.error('Drag-drop falhou:', err);
        toast.error(err?.message || 'Erro ao mover slot');
      }
    });
  });
}

/* ── Header event binding ───────────────────────────────── */

function bindHeaderEvents(container) {
  // 4.16+ — Chips de projetos ativos: remoção e adição via popover
  container.querySelectorAll('.cc-chip-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pid = btn.dataset.pid;
      setActiveProjects(activeProjectIds.filter(id => id !== pid));
    });
  });
  const addProjBtn = document.getElementById('cc-add-project');
  if (addProjBtn) {
    addProjBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _openAddProjectPopover(addProjBtn);
    });
  }
  // 4.16.2: botão "+ Novo projeto" removido — usar página /projects.
  // Empty-state CTA
  const goProjectsBtn = document.getElementById('cc-empty-go-projects');
  if (goProjectsBtn) {
    goProjectsBtn.addEventListener('click', () => {
      location.hash = '#projects';
    });
  }

  // View toggle
  container.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeView = btn.dataset.view;
      renderPage(container);
    });
  });

  // Account selector
  const accountSelect = document.getElementById('cc-account-select');
  if (accountSelect) {
    accountSelect.addEventListener('change', () => {
      activeAccount = accountSelect.value;
      renderCalendarBody();
    });
  }

  // GAP fix: filtros status/platform/contentType (somente list view)
  const statusEl = document.getElementById('cc-filter-status');
  if (statusEl) {
    statusEl.value = activeStatus;
    statusEl.addEventListener('change', () => {
      activeStatus = statusEl.value;
      renderCalendarBody();
    });
  }
  const platformEl = document.getElementById('cc-filter-platform');
  if (platformEl) {
    // Popular plataformas únicas dos slots
    const set = new Set(allSlots.map(s => s.platform).filter(Boolean));
    platformEl.innerHTML = `<option value="">Todas plataformas</option>` +
      [...set].sort().map(p => `<option value="${esc(p)}" ${p === activePlatform ? 'selected' : ''}>${esc(p)}</option>`).join('');
    platformEl.addEventListener('change', () => {
      activePlatform = platformEl.value;
      renderCalendarBody();
    });
  }
  const contentTypeEl = document.getElementById('cc-filter-content-type');
  if (contentTypeEl) {
    const set = new Set(allSlots.map(s => s.contentType).filter(Boolean));
    contentTypeEl.innerHTML = `<option value="">Todos tipos</option>` +
      [...set].sort().map(t => `<option value="${esc(t)}" ${t === activeContentType ? 'selected' : ''}>${esc(t)}</option>`).join('');
    contentTypeEl.addEventListener('change', () => {
      activeContentType = contentTypeEl.value;
      renderCalendarBody();
    });
  }

  // Ativa dropdown do split-button Export
  import('../components/uiKit.js').then(m => m.wireUiKitMenus(container));

  // Navigation
  const prevBtn = document.getElementById('cc-prev');
  const nextBtn = document.getElementById('cc-next');

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (activeView === 'week') {
        currentDate.setDate(currentDate.getDate() - 7);
      } else {
        currentDate.setMonth(currentDate.getMonth() - 1);
      }
      renderPage(container);
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (activeView === 'week') {
        currentDate.setDate(currentDate.getDate() + 7);
      } else {
        currentDate.setMonth(currentDate.getMonth() + 1);
      }
      renderPage(container);
    });
  }

  // New slot
  const newSlotBtn = document.getElementById('cc-new-slot');
  if (newSlotBtn) {
    newSlotBtn.addEventListener('click', () => openSlotModal(null));
  }

  // Suggest week
  const suggestBtn = document.getElementById('cc-suggest-week');
  if (suggestBtn) {
    suggestBtn.addEventListener('click', () => openSuggestWeekModal(container));
  }

  // Export XLS
  const xlsBtn = document.getElementById('cc-export-xls');
  if (xlsBtn) {
    xlsBtn.addEventListener('click', () => exportSlotsXls(getExportableSlots()));
  }

  // Export PDF
  const pdfBtn = document.getElementById('cc-export-pdf');
  if (pdfBtn) {
    pdfBtn.addEventListener('click', () => exportSlotsPdf(getExportableSlots()));
  }
}

/* ── Suggest week handler ───────────────────────────────── */

function openSuggestWeekModal(container) {
  const ws = startOfWeek(currentDate);
  const we = endOfWeek(currentDate);
  const weekLabel = `${formatDate(ws)} a ${formatDate(we)}`;

  const overlay = document.getElementById('cc-modal-overlay');
  if (!overlay) return;

  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div style="background:var(--bg-card,#1A2332);border-radius:12px;width:100%;max-width:520px;
      box-shadow:0 20px 60px rgba(0,0,0,0.5);border:1px solid var(--border-subtle,#1E2D3D);
      overflow:hidden;margin:auto;">
      <div style="padding:20px 24px;border-bottom:1px solid var(--border-subtle,#1E2D3D);
        display:flex;align-items:center;justify-content:space-between;">
        <div>
          <h3 style="margin:0;font-size:1rem;color:var(--text-primary,#E8ECF1);">IA: Sugerir Conteudo Semanal</h3>
          <p style="margin:4px 0 0;font-size:0.75rem;color:var(--text-muted,#6B7B8D);">Semana ${weekLabel}</p>
        </div>
        <button id="cc-suggest-close" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1.25rem;">✕</button>
      </div>
      <div style="padding:20px 24px;display:flex;flex-direction:column;gap:16px;">
        <div>
          <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-secondary,#A0AEC0);margin-bottom:6px;">
            O que voce quer? (opcional)
          </label>
          <textarea id="cc-suggest-prompt" rows="4" placeholder="Ex: Quero focar em destinos europeus para o verao, com pelo menos 2 reels e 1 carrossel. Tons leves e inspiradores..."
            style="width:100%;padding:10px 12px;border:1px solid var(--border-subtle,#1E2D3D);
            border-radius:8px;background:var(--bg-surface,#16202C);color:var(--text-primary,#E8ECF1);
            font-size:0.8125rem;resize:vertical;min-height:80px;font-family:inherit;
            box-sizing:border-box;"></textarea>
          <p style="margin:6px 0 0;font-size:0.6875rem;color:var(--text-muted,#6B7B8D);line-height:1.5;">
            Descreva o tema, tom, tipos de conteudo ou qualquer direcao criativa.
            Se deixar vazio, a IA analisa performance passada e sugere automaticamente.
          </p>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="display:block;font-size:0.75rem;font-weight:600;color:var(--text-muted,#6B7B8D);margin-bottom:4px;">Quantidade</label>
            <select id="cc-suggest-count" style="width:100%;padding:8px 10px;border:1px solid var(--border-subtle,#1E2D3D);
              border-radius:8px;background:var(--bg-surface,#16202C);color:var(--text-primary,#E8ECF1);font-size:0.8125rem;">
              <option value="3">3 sugestoes</option>
              <option value="5" selected>5 sugestoes</option>
              <option value="7">7 sugestoes</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:0.75rem;font-weight:600;color:var(--text-muted,#6B7B8D);margin-bottom:4px;">Conta</label>
            <select id="cc-suggest-account" style="width:100%;padding:8px 10px;border:1px solid var(--border-subtle,#1E2D3D);
              border-radius:8px;background:var(--bg-surface,#16202C);color:var(--text-primary,#E8ECF1);font-size:0.8125rem;">
              <option value="primetourviagens" ${(activeAccount||'primetourviagens')==='primetourviagens'?'selected':''}>@primetourviagens</option>
              <option value="icsbyprimetour" ${activeAccount==='icsbyprimetour'?'selected':''}>@icsbyprimetour</option>
            </select>
          </div>
        </div>
      </div>
      <div style="padding:16px 24px;border-top:1px solid var(--border-subtle,#1E2D3D);
        display:flex;justify-content:flex-end;gap:10px;">
        <button id="cc-suggest-cancel" style="padding:8px 18px;border:1px solid var(--border-subtle,#1E2D3D);
          border-radius:8px;background:transparent;color:var(--text-secondary,#A0AEC0);font-size:0.8125rem;
          cursor:pointer;">Cancelar</button>
        <button id="cc-suggest-go" style="padding:8px 22px;border:none;border-radius:8px;
          background:var(--brand-gold,#D4A843);color:#FFFFFF;font-size:0.8125rem;font-weight:600;
          cursor:pointer;">Gerar Sugestoes</button>
      </div>
    </div>`;

  document.getElementById('cc-suggest-close')?.addEventListener('click', () => { overlay.style.display = 'none'; overlay.innerHTML = ''; });
  document.getElementById('cc-suggest-cancel')?.addEventListener('click', () => { overlay.style.display = 'none'; overlay.innerHTML = ''; });
  // Sem backdrop-close — apenas X / Cancelar (comportamento global)

  document.getElementById('cc-suggest-go')?.addEventListener('click', async () => {
    const userPrompt = document.getElementById('cc-suggest-prompt')?.value || '';
    const count = parseInt(document.getElementById('cc-suggest-count')?.value || '5', 10);
    const account = document.getElementById('cc-suggest-account')?.value || 'primetourviagens';

    const goBtn = document.getElementById('cc-suggest-go');
    if (goBtn) { goBtn.textContent = 'Gerando...'; goBtn.disabled = true; goBtn.style.opacity = '0.6'; }

    try {
      const suggestions = await suggestWeekContent({
        startDate: formatDate(ws),
        endDate: formatDate(we),
        account,
        count,
        userPrompt,
      });

      if (!suggestions || !suggestions.length) {
        toast.info('Nenhuma sugestao gerada pela IA');
        return;
      }

      let created = 0;
      for (const sug of suggestions) {
        try {
          const newSlot = await createSlot({
            title: sug.title || 'Sugestao IA',
            platform: sug.platform || 'instagram',
            contentType: sug.contentType || 'post',
            account: account,
            scheduledDate: sug.date || sug.scheduledDate,
            category: sug.category || 'destinos',
            status: 'idea',
            description: sug.description || sug.brief || '',
          });
          if (newSlot) { allSlots.push(newSlot); created++; }
        } catch (e) { console.error('Erro ao criar slot sugerido:', e); }
      }

      overlay.style.display = 'none';
      overlay.innerHTML = '';
      toast.success(`${created} slot(s) criado(s) com sugestoes da IA`);
      renderPage(container);
    } catch (e) {
      console.error('Erro ao sugerir semana:', e);
      toast.error('Erro ao gerar sugestoes de conteudo');
    } finally {
      if (goBtn) { goBtn.textContent = 'Gerar Sugestoes'; goBtn.disabled = false; goBtn.style.opacity = '1'; }
    }
  });

  // Focus no campo de texto
  setTimeout(() => document.getElementById('cc-suggest-prompt')?.focus(), 100);
}

/* ── Slot Modal ─────────────────────────────────────────── */

function openSlotModal(slot, prefillDate) {
  editingSlot = slot || null;
  modalOpen = true;

  const overlay = document.getElementById('cc-modal-overlay');
  if (!overlay) return;

  overlay.style.display = 'flex';

  const isNew = !editingSlot;
  const s = editingSlot || {};

  // Pre-fill date
  let dateVal = '';
  if (s.scheduledDate) {
    const sd = parseLocalDate(s.scheduledDate) || new Date();
    dateVal = formatDate(sd);
  } else if (prefillDate) {
    dateVal = prefillDate;
  }

  const inputStyle = `padding:8px 12px;border:1px solid var(--border-subtle,#1E2D3D);
    border-radius:8px;background:var(--bg-surface,#16202C);color:var(--text-primary,#E8ECF1);
    font-size:0.8125rem;width:100%;box-sizing:border-box;outline:none;
    transition:border-color 0.15s;font-family:inherit;`;

  const labelStyle = `font-size:0.75rem;font-weight:600;color:var(--text-muted,#5A6B7A);
    margin-bottom:4px;display:block;text-transform:uppercase;letter-spacing:0.04em;`;

  const fieldGroupStyle = `margin-bottom:14px;`;

  overlay.innerHTML = `
    <div id="cc-modal" style="background:var(--bg-card,#111B27);border:1px solid var(--border-subtle,#1E2D3D);
      border-radius:12px;width:100%;max-width:620px;max-height:90vh;overflow-y:auto;
      box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <!-- Modal header -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px;
        border-bottom:1px solid var(--border-subtle,#1E2D3D);">
        <h2 style="font-size:1.125rem;font-weight:700;color:var(--text-primary,#E8ECF1);margin:0;">
          ${isNew ? 'Novo Slot de Conteudo' : 'Editar Slot'}
        </h2>
        <button id="cc-modal-close" style="background:none;border:none;color:var(--text-muted,#5A6B7A);
          font-size:1.25rem;cursor:pointer;padding:4px 8px;border-radius:4px;
          transition:background 0.15s;"
          onmouseover="this.style.background='var(--bg-surface,#16202C)'"
          onmouseout="this.style.background='none'">&times;</button>
      </div>

      <!-- Modal body -->
      <div style="padding:24px;">
        ${(() => {
          // Mostra o projeto vinculado ao slot (read-only — pra trocar, redirect)
          const slotProjId = s.projectId || activeProjectId;
          const slotProj = availableProjects.find(p => p.id === slotProjId);
          if (!slotProj) {
            return `<div style="${fieldGroupStyle}padding:10px 12px;border-radius:8px;
              background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.4);
              color:#F59E0B;font-size:0.8125rem;">
              ⚠ Sem projeto vinculado. Selecione um projeto antes de criar slots.
            </div>`;
          }
          return `<div style="${fieldGroupStyle}padding:10px 12px;border-radius:8px;
            background:${slotProj.color || '#D4A843'}18;border-left:3px solid ${slotProj.color || '#D4A843'};
            display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div style="font-size:0.8125rem;color:var(--text-primary,#E8ECF1);">
              <span style="font-size:0.6875rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">Projeto</span><br>
              <span style="font-weight:600;">${esc(slotProj.icon || '📦')} ${esc(slotProj.name)}</span>
            </div>
            <a href="#projects" style="font-size:0.6875rem;color:var(--brand-gold,#D4A843);text-decoration:none;">
              Trocar de projeto →
            </a>
          </div>`;
        })()}
        <!-- Title -->
        <div style="${fieldGroupStyle}">
          <label style="${labelStyle}">Titulo</label>
          <input type="text" id="cc-f-title" value="${esc(s.title || '')}" placeholder="Titulo do conteudo"
            style="${inputStyle}" />
        </div>

        <!-- Row: Platform + Content Type -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;${fieldGroupStyle}">
          <div>
            <label style="${labelStyle}">Plataforma</label>
            <select id="cc-f-platform" style="display:none;">
              <option value="">Selecionar...</option>
              ${PLATFORM_LIST.map(p => `<option value="${p.value}" ${s.platform === p.value ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
            </select>
            ${renderPickerButton({ btnId: 'cc-f-platform-btn', selected: findOption(PLATFORM_OPTIONS, s.platform), emptyLabel: '— Plataforma —' })}
          </div>
          <div>
            <label style="${labelStyle}">Tipo de Conteudo</label>
            <select id="cc-f-contentType" style="display:none;">
              <option value="">Selecionar...</option>
              ${CONTENT_TYPE_LIST.map(t => `<option value="${t.value}" ${s.contentType === t.value ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
            </select>
            ${renderPickerButton({ btnId: 'cc-f-contentType-btn', selected: findOption(CONTENT_TYPE_OPTIONS, s.contentType), emptyLabel: '— Tipo —' })}
          </div>
        </div>

        <!-- Row: Account + Date -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;${fieldGroupStyle}">
          <div>
            <label style="${labelStyle}">Conta</label>
            <select id="cc-f-account" style="display:none;">
              <option value="">Selecionar...</option>
              ${ACCOUNTS.map(a => `<option value="${a.value}" ${s.account === a.value ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}
            </select>
            ${renderPickerButton({ btnId: 'cc-f-account-btn', selected: findOption(ACCOUNT_OPTIONS, s.account), emptyLabel: '— Conta —' })}
          </div>
          <div>
            <label style="${labelStyle}">Data Agendada</label>
            <input type="date" id="cc-f-date" value="${esc(dateVal)}" style="${inputStyle}" />
          </div>
        </div>

        <!-- Category -->
        <div style="${fieldGroupStyle}">
          <label style="${labelStyle}">Categoria</label>
          <select id="cc-f-category" style="display:none;">
            <option value="">Selecionar...</option>
            ${CATEGORY_LIST.map(c => `<option value="${c.value}" ${s.category === c.value ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
          </select>
          ${renderPickerButton({ btnId: 'cc-f-category-btn', selected: findOption(CATEGORY_OPTIONS, s.category), emptyLabel: '— Categoria —' })}
        </div>

        <!-- Description (unified brief + caption) -->
        <div style="${fieldGroupStyle}">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <label style="${labelStyle}margin-bottom:0;">Descricao</label>
            <button id="cc-ai-desc-toggle" style="padding:3px 10px;border:1px solid var(--brand-gold,#D4A843);
              border-radius:6px;background:transparent;color:var(--brand-gold,#D4A843);
              font-size:0.6875rem;cursor:pointer;font-weight:600;transition:opacity 0.15s;">
              &#9670; IA: Gerar Descricao</button>
          </div>
          <div id="cc-ai-desc-input" style="display:none;margin-bottom:8px;padding:10px;
            border:1px solid var(--brand-gold,#D4A843);border-radius:8px;
            background:rgba(212,168,67,0.05);">
            <input type="text" id="cc-ai-desc-prompt" placeholder="Ex: Foco em experiencias gastronomicas, tom sofisticado..."
              style="${inputStyle}margin-bottom:6px;font-size:0.8125rem;" />
            <div style="display:flex;gap:6px;justify-content:flex-end;">
              <button id="cc-ai-desc-cancel" style="padding:4px 12px;border:1px solid var(--border-subtle,#1E2D3D);
                border-radius:6px;background:transparent;color:var(--text-muted);font-size:0.75rem;cursor:pointer;">Cancelar</button>
              <button id="cc-ai-desc-gen" style="padding:4px 14px;border:none;border-radius:6px;
                background:var(--brand-gold,#D4A843);color:#FFFFFF;font-size:0.75rem;font-weight:600;cursor:pointer;">Gerar</button>
            </div>
          </div>
          <textarea id="cc-f-description" rows="5" placeholder="Descreva o objetivo, direcionamento, legenda e abordagem do conteudo..."
            style="${inputStyle}resize:vertical;min-height:100px;">${esc(s.description || s.brief || s.caption || '')}</textarea>
        </div>

        <!-- Image Notes -->
        <div style="${fieldGroupStyle}">
          <label style="${labelStyle}">Notas de Imagem</label>
          <textarea id="cc-f-imageNotes" rows="2" placeholder="Descricao da imagem ou referencia visual..."
            style="${inputStyle}resize:vertical;min-height:50px;">${esc(s.imageNotes || '')}</textarea>
        </div>

        ${!isNew && s.taskId ? (() => {
          // 4.16+ — Snapshot live da task vinculada (não replica campos do slot).
          // Lê do _linkedTasks (Map populado pelo subscribeToTasksByIds).
          const task = _linkedTasks.get(s.taskId);
          const isDone = task?.status === 'done';
          const isCancelled = task?.status === 'cancelled';
          const isInProgress = task && !isDone && !isCancelled;
          const headerColor = isDone ? '#22C55E' : (isCancelled ? '#9AA5B5' : '#F59E0B');
          const headerLabel = !task ? '🔄 Tarefa vinculada (carregando…)'
            : isDone ? '✓ Tarefa vinculada · Concluída'
            : isCancelled ? '✕ Tarefa vinculada · Cancelada'
            : '🔄 Tarefa vinculada · Em andamento';
          const taskDue = task?.dueDate
            ? (task.dueDate?.toDate?.() || new Date(task.dueDate))
            : null;
          const taskDueStr = taskDue && !isNaN(taskDue.getTime()) ? formatDateBR(taskDue) : null;
          const completedAt = task?.completedAt?.toDate?.() || (task?.completedAt ? new Date(task.completedAt) : null);
          const completedStr = completedAt && !isNaN(completedAt?.getTime()) ? formatDateBR(completedAt) : null;
          // Lookup de assignees nos users do store
          const users = store.get('users') || [];
          const assignees = (task?.assignees || []).slice(0, 4).map(uid => {
            const u = users.find(x => x.id === uid);
            return u ? { name: u.name || u.email, color: u.avatarColor || '#3B82F6' } : null;
          }).filter(Boolean);
          const moreAssignees = (task?.assignees || []).length > 4 ? (task.assignees.length - 4) : 0;

          return `
        <div style="padding:10px 14px;border-radius:8px;
          background:${headerColor}12;border:1px solid ${headerColor}50;margin-bottom:14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;
            font-size:0.75rem;color:${headerColor};font-weight:600;margin-bottom:${task ? '8px' : '0'};">
            <span>${headerLabel}</span>
            ${task ? `<a href="#tasks" data-open-task="${esc(task.id)}"
              style="color:${headerColor};text-decoration:none;font-weight:500;font-size:0.6875rem;">
              Abrir tarefa →
            </a>` : ''}
          </div>
          ${task ? `
          <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:0.75rem;
            color:var(--text-secondary,#9AA5B5);">
            <span style="color:var(--text-muted);">Título:</span>
            <span style="color:var(--text-primary);font-weight:500;">${esc(task.title || '—')}</span>
            <span style="color:var(--text-muted);">Status:</span>
            <span style="color:${headerColor};font-weight:500;">${esc(task.status || '—')}</span>
            ${taskDueStr ? `<span style="color:var(--text-muted);">Prazo:</span>
            <span>${esc(taskDueStr)}</span>` : ''}
            ${completedStr ? `<span style="color:var(--text-muted);">Concluída em:</span>
            <span style="color:#22C55E;font-weight:500;">${esc(completedStr)}</span>` : ''}
            ${assignees.length ? `<span style="color:var(--text-muted);">Responsáveis:</span>
            <span style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
              ${assignees.map(a => `<span style="display:inline-flex;align-items:center;gap:3px;padding:1px 7px;border-radius:99px;background:${a.color}25;color:${a.color};font-size:0.625rem;font-weight:600;">
                ${esc(a.name)}
              </span>`).join('')}
              ${moreAssignees > 0 ? `<span style="font-size:0.625rem;color:var(--text-muted);">+${moreAssignees}</span>` : ''}
            </span>` : ''}
          </div>` : ''}
        </div>`;
        })() : ''}
      </div>

      <!-- Modal footer -->
      <div style="display:flex;align-items:center;justify-content:${isNew ? 'flex-end' : 'space-between'};
        padding:16px 24px;border-top:1px solid var(--border-subtle,#1E2D3D);">
        ${!isNew ? `
          <div style="display:flex;gap:8px;">
            <button id="cc-modal-delete" style="padding:8px 18px;border:1px solid #EF4444;border-radius:8px;
              background:transparent;color:#EF4444;font-size:0.8125rem;font-weight:600;cursor:pointer;
              transition:all 0.15s;"
              onmouseover="this.style.background='#EF444415'"
              onmouseout="this.style.background='transparent'">Excluir</button>
            ${!s.taskId ? `<button id="cc-modal-to-task" style="padding:8px 18px;border:1px solid #22C55E;border-radius:8px;
              background:transparent;color:#22C55E;font-size:0.8125rem;font-weight:600;cursor:pointer;
              transition:all 0.15s;"
              onmouseover="this.style.background='#22C55E15'"
              onmouseout="this.style.background='transparent'">Converter em Tarefa</button>` : ''}
          </div>
        ` : ''}
        <div style="display:flex;gap:8px;">
          <button id="cc-modal-cancel" style="padding:8px 18px;border:1px solid var(--border-subtle,#1E2D3D);
            border-radius:8px;background:var(--bg-surface,#16202C);color:var(--text-primary,#E8ECF1);
            font-size:0.8125rem;cursor:pointer;transition:all 0.15s;">Cancelar</button>
          <button id="cc-modal-save" style="padding:8px 24px;border:none;border-radius:8px;
            background:var(--brand-gold,#D4A843);color:#FFFFFF;font-size:0.8125rem;font-weight:600;
            cursor:pointer;transition:opacity 0.15s;">Salvar</button>
        </div>
      </div>
    </div>
  `;

  bindModalEvents();
}

/* ── Modal event binding ────────────────────────────────── */

function bindModalEvents() {
  const overlay = document.getElementById('cc-modal-overlay');
  const modal = document.getElementById('cc-modal');

  // Nao fecha por clique no backdrop — apenas pelo X (comportamento global)

  // 4.16+ — Link "Abrir tarefa" no snapshot da tarefa vinculada.
  // Usa o cache _linkedTasks pra abrir o taskModal direto sem fetch.
  modal?.querySelectorAll('[data-open-task]').forEach(link => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      const taskId = link.dataset.openTask;
      const cached = _linkedTasks.get(taskId);
      closeModal();
      try {
        const { openTaskModal } = await import('../components/taskModal.js');
        // Se já temos a task no cache live, abre direto. Senão, busca.
        if (cached) {
          openTaskModal({ taskData: cached, onSave: () => {} });
        } else {
          const fb = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
          const { db } = await import('../firebase.js');
          const snap = await fb.getDoc(fb.doc(db, 'tasks', taskId));
          if (snap.exists()) {
            openTaskModal({ taskData: { id: snap.id, ...snap.data() }, onSave: () => {} });
          } else {
            toast.error('Tarefa não encontrada (pode ter sido excluída).');
          }
        }
      } catch (err) {
        console.warn('[cc] failed to open task modal:', err);
        location.hash = '#tasks';
      }
    });
  });

  // Close button
  const closeBtn = document.getElementById('cc-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);

  // Cancel button
  const cancelBtn = document.getElementById('cc-modal-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  // Save button
  const saveBtn = document.getElementById('cc-modal-save');
  if (saveBtn) saveBtn.addEventListener('click', handleSave);

  // Delete button
  const deleteBtn = document.getElementById('cc-modal-delete');
  if (deleteBtn) deleteBtn.addEventListener('click', handleDelete);

  // Convert to task button
  const toTaskBtn = document.getElementById('cc-modal-to-task');
  if (toTaskBtn) toTaskBtn.addEventListener('click', handleConvertToTask);

  // Option pickers (visual unificado)
  bindOptionPicker({
    btnId: 'cc-f-platform-btn',
    selectId: 'cc-f-platform',
    buildConfig: () => ({
      options: PLATFORM_OPTIONS,
      empty: { id: '', label: '— Sem plataforma —' },
      searchPlaceholder: 'Buscar plataforma…',
    }),
    findSelected: (id) => findOption(PLATFORM_OPTIONS, id),
    emptyLabel: '— Plataforma —',
  });
  bindOptionPicker({
    btnId: 'cc-f-contentType-btn',
    selectId: 'cc-f-contentType',
    buildConfig: () => ({
      options: CONTENT_TYPE_OPTIONS,
      empty: { id: '', label: '— Sem tipo —' },
      searchPlaceholder: 'Buscar tipo…',
    }),
    findSelected: (id) => findOption(CONTENT_TYPE_OPTIONS, id),
    emptyLabel: '— Tipo —',
  });
  bindOptionPicker({
    btnId: 'cc-f-account-btn',
    selectId: 'cc-f-account',
    buildConfig: () => ({
      options: ACCOUNT_OPTIONS,
      empty: { id: '', label: '— Sem conta —' },
      searchPlaceholder: 'Buscar conta…',
    }),
    findSelected: (id) => findOption(ACCOUNT_OPTIONS, id),
    emptyLabel: '— Conta —',
  });
  bindOptionPicker({
    btnId: 'cc-f-category-btn',
    selectId: 'cc-f-category',
    buildConfig: () => ({
      options: CATEGORY_OPTIONS,
      empty: { id: '', label: '— Sem categoria —' },
      searchPlaceholder: 'Buscar categoria…',
    }),
    findSelected: (id) => findOption(CATEGORY_OPTIONS, id),
    emptyLabel: '— Categoria —',
  });

  // AI Description — toggle input + generate
  document.getElementById('cc-ai-desc-toggle')?.addEventListener('click', () => {
    const panel = document.getElementById('cc-ai-desc-input');
    if (panel) { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; }
    document.getElementById('cc-ai-desc-prompt')?.focus();
  });
  document.getElementById('cc-ai-desc-cancel')?.addEventListener('click', () => {
    const panel = document.getElementById('cc-ai-desc-input');
    if (panel) panel.style.display = 'none';
  });
  document.getElementById('cc-ai-desc-gen')?.addEventListener('click', handleAIDescription);

  // Keyboard: Escape to close
  const escHandler = (e) => {
    if (e.key === 'Escape' && modalOpen) {
      closeModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

function closeModal() {
  const overlay = document.getElementById('cc-modal-overlay');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.innerHTML = '';
  }
  editingSlot = null;
  modalOpen = false;
}

/* ── Modal form helpers ─────────────────────────────────── */

function getFormData() {
  return {
    title:         document.getElementById('cc-f-title')?.value?.trim() || '',
    platform:      document.getElementById('cc-f-platform')?.value || '',
    contentType:   document.getElementById('cc-f-contentType')?.value || '',
    account:       document.getElementById('cc-f-account')?.value || '',
    scheduledDate: document.getElementById('cc-f-date')?.value || '',
    category:      document.getElementById('cc-f-category')?.value || '',
    description:   document.getElementById('cc-f-description')?.value?.trim() || '',
    imageNotes:    document.getElementById('cc-f-imageNotes')?.value?.trim() || '',
    // 4.11+ — projeto é o scope canônico do calendário. Se editando um
    // slot existente, mantém o projectId original (não muda só por estar
    // num filtro diferente). Se criando novo, usa o projeto ativo.
    projectId:     editingSlot?.projectId || activeProjectId || null,
  };
}

/* ── Save handler ───────────────────────────────────────── */

async function handleSave() {
  const data = getFormData();

  if (!data.title) {
    toast.error('Titulo e obrigatório');
    return;
  }
  // Novo slot sem projeto — bloqueia (todo slot precisa ser de um projeto)
  if (!editingSlot && !data.projectId) {
    toast.error('Selecione um projeto antes de criar slots.');
    return;
  }

  const saveBtn = document.getElementById('cc-modal-save');
  if (saveBtn) {
    saveBtn.textContent = 'Salvando...';
    saveBtn.disabled = true;
    saveBtn.style.opacity = '0.6';
  }

  try {
    if (editingSlot) {
      // Update existing — preserve status
      const updated = await updateSlot(editingSlot.id, data);
      const idx = allSlots.findIndex(s => s.id === editingSlot.id);
      if (idx !== -1) {
        allSlots[idx] = { ...allSlots[idx], ...data, ...(updated || {}) };
      }
      toast.success('Slot atualizado com sucesso');
    } else {
      // Create new — default status = idea
      data.status = 'idea';
      const created = await createSlot(data);
      if (created) {
        allSlots.push({ id: created, ...data });
      } else {
        allSlots.push({ id: 'temp_' + Date.now(), ...data });
      }
      toast.success('Slot criado com sucesso');
    }

    closeModal();
    renderCalendarBody();
  } catch (e) {
    console.error('Erro ao salvar slot:', e);
    // 4.15+: mostra a mensagem real do erro (antes era opaco "Erro ao salvar")
    toast.error(e?.message || 'Erro ao salvar slot');
  } finally {
    if (saveBtn) {
      saveBtn.textContent = 'Salvar';
      saveBtn.disabled = false;
      saveBtn.style.opacity = '1';
    }
  }
}

/* ── Delete handler ─────────────────────────────────────── */

async function handleDelete() {
  if (!editingSlot) return;

  const confirmed = confirm('Tem certeza que deseja excluir este slot?');
  if (!confirmed) return;

  const deleteBtn = document.getElementById('cc-modal-delete');
  if (deleteBtn) {
    deleteBtn.textContent = 'Excluindo...';
    deleteBtn.disabled = true;
    deleteBtn.style.opacity = '0.6';
  }

  try {
    await deleteSlot(editingSlot.id);
    allSlots = allSlots.filter(s => s.id !== editingSlot.id);
    toast.success('Slot excluido');
    closeModal();
    renderCalendarBody();
  } catch (e) {
    console.error('Erro ao excluir slot:', e);
    toast.error(e?.message || 'Erro ao excluir slot');
    if (deleteBtn) {
      deleteBtn.textContent = 'Excluir';
      deleteBtn.disabled = false;
      deleteBtn.style.opacity = '1';
    }
  }
}

/* ── AI Brief handler ───────────────────────────────────── */

async function handleAIDescription() {
  const btn = document.getElementById('cc-ai-desc-gen');
  const textarea = document.getElementById('cc-f-description');
  if (!btn || !textarea) return;

  const data = getFormData();
  const userPrompt = document.getElementById('cc-ai-desc-prompt')?.value || '';
  const originalText = btn.innerHTML;
  btn.innerHTML = 'Gerando...';
  btn.disabled = true;
  btn.style.opacity = '0.6';

  try {
    const result = await suggestDescription({
      title: data.title,
      description: data.description,
      platform: data.platform,
      category: data.category,
      account: data.account,
      userPrompt,
    });

    if (result && result.text) {
      textarea.value = result.text;
      toast.success('Descricao gerada pela IA');
      const panel = document.getElementById('cc-ai-desc-input');
      if (panel) panel.style.display = 'none';
    } else {
      toast.info('Nenhuma sugestao disponível');
    }
  } catch (e) {
    console.error('Erro ao gerar descricao:', e);
    toast.error('Erro ao gerar descricao com IA');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}

/* ── Convert to Task handler ──────────────────────────────── */

async function handleConvertToTask() {
  if (!editingSlot) return;

  const slot = editingSlot;
  const data = getFormData();

  // Build due date from scheduledDate
  let dueDate = null;
  if (data.scheduledDate) {
    dueDate = new Date(data.scheduledDate + 'T12:00:00');
  }

  closeModal();

  // Vincula a tarefa ao mesmo projeto do slot (caminho canônico em 4.11+).
  // Slots herdam projectId via getFormData() — `data.projectId` preenchido.
  const taskProjectId = data.projectId || slot.projectId || activeProjectId || null;

  openTaskModal({
    taskData: {
      title: data.title || slot.title || '',
      description: data.description || slot.description || '',
      sector: 'Marketing',
      requestingArea: 'Redes Sociais',
      projectId: taskProjectId,
      dueDate,
      status: 'not_started',
      tags: ['conteudo', data.platform || '', data.contentType || ''].filter(Boolean),
    },
    onSave: async (taskId) => {
      try {
        await updateSlot(slot.id, { taskId, status: 'approved' });
        const idx = allSlots.findIndex(s => s.id === slot.id);
        if (idx !== -1) { allSlots[idx].taskId = taskId; allSlots[idx].status = 'approved'; }
        renderCalendarBody();
        toast.success('Ideia convertida em tarefa!');
      } catch (e) {
        console.error('Erro ao vincular tarefa ao slot:', e);
      }
    },
  });
}

/* ════════════════════════════════════════════════════════════
   Exportações: XLS e PDF
   ════════════════════════════════════════════════════════════ */

function getExportableSlots() {
  // Respeita o filtro de conta + mês/semana visível.
  // - List/Month view: slots do mês corrente
  // - Week view: slots da semana corrente
  const y = currentDate.getFullYear();
  const m = currentDate.getMonth();

  let list = allSlots.slice();
  if (activeAccount) list = list.filter(s => s.account === activeAccount);

  if (activeView === 'week') {
    const ws = startOfWeek(currentDate);
    const we = endOfWeek(currentDate);
    list = list.filter(s => {
      if (!s.scheduledDate) return false;
      const sd = parseLocalDate(s.scheduledDate) || new Date();
      return sd >= ws && sd <= we;
    });
  } else {
    list = list.filter(s => {
      if (!s.scheduledDate) return false;
      const sd = parseLocalDate(s.scheduledDate) || new Date();
      return sd.getFullYear() === y && sd.getMonth() === m;
    });
  }

  // Ordena por data
  list.sort((a, b) => {
    const da = parseLocalDate(a.scheduledDate);
    const db = parseLocalDate(b.scheduledDate);
    return da - db;
  });

  return list;
}

function _periodLabel() {
  if (activeView === 'week') {
    const ws = startOfWeek(currentDate);
    const we = endOfWeek(currentDate);
    return `${formatDateBR(ws)} a ${formatDateBR(we)}`;
  }
  return `${PT_MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
}

function _accountLabel(val) {
  return ACCOUNTS.find(a => a.value === val)?.label || val || '';
}

function _platformLabel(val) {
  return PLATFORM_LIST.find(p => p.value === val)?.label || val || '';
}

function _typeLabel(val) {
  return CONTENT_TYPE_LIST.find(t => t.value === val)?.label || val || '';
}

function _categoryLabel(val) {
  return CATEGORY_LIST.find(c => c.value === val)?.label || val || '';
}

function _buildSlotRows(list) {
  return list.map(s => {
    const sd = parseLocalDate(s.scheduledDate);
    return {
      date: sd ? formatDateBR(sd) : '',
      weekday: sd ? PT_DAYS_S[((sd.getDay() + 6) % 7)] : '',
      title: s.title || '',
      status: STATUS_LABELS[s.status] || s.status || '',
      statusKey: s.status || 'idea',
      platform: _platformLabel(s.platform),
      contentType: _typeLabel(s.contentType),
      category: _categoryLabel(s.category),
      account: _accountLabel(s.account),
      description: s.description || '',
      imageNotes: s.imageNotes || '',
      hasTask: s.taskId ? 'Sim' : '',
    };
  });
}

async function exportSlotsXls(list) {
  if (!list?.length) { toast.error('Nenhum slot para exportar.'); return; }
  if (!window.XLSX) await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });

  const headers = ['Data', 'Dia', 'Título', 'Status', 'Plataforma', 'Tipo',
    'Categoria', 'Conta', 'Descrição', 'Notas de imagem', 'Tarefa'];
  const rows = _buildSlotRows(list).map(r => [
    r.date, r.weekday, r.title, r.status, r.platform, r.contentType,
    r.category, r.account, r.description, r.imageNotes, r.hasTask,
  ]);

  const wb = window.XLSX.utils.book_new();
  const ws = window.XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [11, 5, 32, 11, 12, 11, 13, 22, 50, 30, 7].map(w => ({ wch: w }));
  window.XLSX.utils.book_append_sheet(wb, ws, 'Calendario');
  window.XLSX.writeFile(wb, `primetour_calendario_${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast.success('XLS exportado.');
}

const exportSlotsPdf = withExportGuard(async function exportSlotsPdf(list) {
  if (!list?.length) { toast.error('Nenhum slot para exportar.'); return; }
  await loadJsPdf();

  const kit = createDoc({ orientation: 'portrait', margin: 14 });
  const { doc, W, H, M, CW, setFill, setText, setDraw, drawChip, wrap } = kit;

  const STATUS_PDF = {
    idea:      { bg: COL.muted,  label: 'IDEIA' },
    draft:     { bg: COL.blue,   label: 'RASCUNHO' },
    review:    { bg: COL.orange, label: 'REVISAO' },
    approved:  { bg: COL.green,  label: 'APROVADO' },
    published: { bg: COL.brand2, label: 'PUBLICADO' },
  };

  const total = list.length;
  const byStatus = list.reduce((acc, s) => {
    const k = s.status || 'idea';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  kit.drawCover({
    title: 'Calendário de Conteúdo',
    subtitle: `PRIMETOUR  ·  ${_periodLabel()}${activeAccount ? '  ·  ' + _accountLabel(activeAccount) : ''}`,
    meta: `${total} ${total === 1 ? 'slot' : 'slots'}  ·  ${new Date().toLocaleDateString('pt-BR')}`,
    compact: false,
  });

  // Strip de estatísticas por status
  const statEntries = [
    { key: 'idea',      label: 'Ideia',     col: COL.muted },
    { key: 'draft',     label: 'Rascunho',  col: COL.blue },
    { key: 'review',    label: 'Revisão',   col: COL.orange },
    { key: 'approved',  label: 'Aprovado',  col: COL.green },
    { key: 'published', label: 'Publicado', col: COL.brand2 },
  ];
  const boxW = (CW - 8) / statEntries.length;
  statEntries.forEach((s, i) => {
    const n = byStatus[s.key] || 0;
    const x = M + i * (boxW + 2);
    setFill(COL.bg); doc.roundedRect(x, kit.y, boxW, 18, 1.8, 1.8, 'F');
    setFill(s.col);  doc.rect(x, kit.y, boxW, 1.6, 'F');

    setText(COL.text); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text(String(n), x + 4, kit.y + 11);

    setText(s.col); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6);
    doc.text(txt(s.label.toUpperCase()), x + 4, kit.y + 15.5);
  });
  kit.addY(24);

  // Cards agrupados por data
  const rows = _buildSlotRows(list);

  const PAD_L = 5.5;
  const PAD_T = 3.5;
  const PAD_B = 3.8;
  const CHIP_FS = 6.4;
  const CHIP_H = CHIP_FS * 0.55 + 2.4;
  const CHIP_TO_TITLE = 4;
  const TITLE_TO_META = 2.5;
  const META_TO_DESC = 2.2;
  const TITLE_FS = 9.5;
  const META_FS = 7.6;
  const DESC_FS = 7.8;
  const TITLE_LH = TITLE_FS * 0.45;
  const META_LH  = META_FS * 0.5;
  const DESC_LH  = DESC_FS * 0.5;
  const CARD_GAP = 3;
  const GROUP_GAP = 4.5;

  let currentDateLabel = '';

  list.forEach((s, i) => {
    const row = rows[i];

    // Quebra de grupo por data
    if (row.date && row.date !== currentDateLabel) {
      currentDateLabel = row.date;
      kit.ensureSpace(12);
      if (i > 0) kit.addY(GROUP_GAP);
      setText(COL.brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      doc.text(txt(`${row.weekday ? row.weekday.toUpperCase() + '  ·  ' : ''}${row.date}`), M, kit.y + 3);
      setDraw(COL.gold); doc.setLineWidth(0.6);
      doc.line(M, kit.y + 5, W - M, kit.y + 5);
      kit.addY(9);
    }

    const stKey = (s.status || 'idea').toLowerCase();
    const stStyle = STATUS_PDF[stKey] || { bg: COL.muted, label: stKey.toUpperCase() };

    const titleLines = wrap(row.title || '(sem titulo)', CW - PAD_L * 2, TITLE_FS).slice(0, 2);

    const metaParts = [row.platform, row.contentType, row.category, row.account]
      .filter(x => x && String(x).trim());
    const metaStr = metaParts.join(' · ');
    const metaLines = metaStr ? wrap(metaStr, CW - PAD_L * 2, META_FS).slice(0, 1) : [];

    const descLines = row.description
      ? wrap(row.description, CW - PAD_L * 2, DESC_FS).slice(0, 3)
      : [];

    const chipBlockH = CHIP_H;
    const titleBlockH = titleLines.length * TITLE_LH;
    const metaBlockH  = metaLines.length ? (TITLE_TO_META + metaLines.length * META_LH) : 0;
    const descBlockH  = descLines.length ? (META_TO_DESC + descLines.length * DESC_LH) : 0;

    const cardH = PAD_T + chipBlockH + CHIP_TO_TITLE + titleBlockH + metaBlockH + descBlockH + PAD_B;

    kit.ensureSpace(cardH + CARD_GAP);

    setFill(COL.white); setDraw(COL.border); doc.setLineWidth(0.2);
    doc.roundedRect(M, kit.y, CW, cardH, 1.8, 1.8, 'FD');
    setFill(stStyle.bg); doc.rect(M, kit.y, 1.8, cardH, 'F');

    const cardTop = kit.y;

    // Status chip + flag "vira tarefa"
    const chipY = cardTop + PAD_T;
    const stCh = drawChip(stStyle.label, M + PAD_L, chipY, stStyle.bg, COL.white, CHIP_FS, 2.2, 1.2);
    let chipX = M + PAD_L + stCh.w + 2.2;
    if (s.taskId) {
      const gw = drawChip('TAREFA', chipX, chipY, COL.gold, COL.white, CHIP_FS, 2.2, 1.2);
      chipX += gw.w + 2.2;
    }

    // Título
    const titleY = chipY + chipBlockH + CHIP_TO_TITLE;
    setText(COL.text); doc.setFont('helvetica', 'bold'); doc.setFontSize(TITLE_FS);
    doc.text(titleLines, M + PAD_L, titleY);

    // Meta
    let cursorY = titleY + titleBlockH;
    if (metaLines.length) {
      cursorY += TITLE_TO_META - 1.2;
      setText(COL.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(META_FS);
      doc.text(metaLines, M + PAD_L, cursorY);
      cursorY += metaLines.length * META_LH;
    }

    // Descrição
    if (descLines.length) {
      cursorY += META_TO_DESC;
      setText(COL.text); doc.setFont('helvetica', 'normal'); doc.setFontSize(DESC_FS);
      doc.text(descLines, M + PAD_L, cursorY);
    }

    kit.y = cardTop + cardH + CARD_GAP;
  });

  kit.drawFooter('PRIMETOUR  ·  Calendário de Conteúdo');
  doc.save(`primetour_calendario_${new Date().toISOString().slice(0, 10)}.pdf`);
  toast.success('PDF exportado.');
});
