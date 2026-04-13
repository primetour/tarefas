/**
 * PRIMETOUR — Content Calendar Page
 * Calendario de conteudo com visualizacoes Mes/Semana/Lista
 * Gestao de slots de conteudo para redes sociais
 */

import { store } from '../store.js';
import { toast } from '../components/toast.js';
import {
  PLATFORMS, CONTENT_TYPES, SLOT_STATUSES, CATEGORIES, SLOT_TIMES,
  fetchSlots, createSlot, updateSlot, deleteSlot,
  suggestWeekContent, suggestCaption,
} from '../services/contentCalendar.js';

const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ── Constants ──────────────────────────────────────────── */

const PT_MONTHS = ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
                   'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const PT_DAYS_S = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];

const STATUS_COLORS = {
  idea:      '#94A3B8',
  draft:     '#38BDF8',
  writing:   '#A78BFA',
  design:    '#F59E0B',
  review:    '#FB923C',
  approved:  '#22C55E',
  scheduled: '#2DD4BF',
  published: '#10B981',
  cancelled: '#EF4444',
};

const STATUS_LABELS = {
  idea:      'Ideia',
  draft:     'Rascunho',
  writing:   'Redação',
  design:    'Design',
  review:    'Revisão',
  approved:  'Aprovado',
  scheduled: 'Agendado',
  published: 'Publicado',
  cancelled: 'Cancelado',
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

const SLOT_TIME_LIST = [
  { value: 'manha', label: 'Manha' },
  { value: 'tarde', label: 'Tarde' },
  { value: 'noite', label: 'Noite' },
];

const ACCOUNTS = [
  { value: 'primetourviagens',  label: '@primetourviagens' },
  { value: 'icsbyprimetour',    label: '@icsbyprimetour' },
];

/* ── State ──────────────────────────────────────────────── */

let allSlots      = [];
let currentDate   = new Date();
let activeView    = 'month';   // 'month' | 'week' | 'list'
let activeAccount = '';        // '' = all
let editingSlot   = null;      // null = new slot
let modalOpen     = false;

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
    const sd = s.scheduledDate instanceof Date ? s.scheduledDate : new Date(s.scheduledDate);
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
  const main = container || document.getElementById('main');
  if (!main) return;

  // fetchSlots já retorna [] em caso de erro/collection vazia
  allSlots = await fetchSlots();

  renderPage(main);
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

  container.innerHTML = `
    <div style="padding:0;">
      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:24px;">
        <div>
          <h1 style="font-size:1.5rem;font-weight:700;color:var(--text-primary,#E8ECF1);margin:0 0 4px 0;">
            📱 Calendario de Conteudo
          </h1>
          <p style="font-size:0.8125rem;color:var(--text-muted,#5A6B7A);margin:0;">
            Planejamento e gestao de publicacoes
          </p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <!-- View toggle -->
          <div style="display:flex;border:1px solid var(--border-subtle,#1E2D3D);border-radius:8px;overflow:hidden;">
            ${[['month', 'Mes'], ['week', 'Semana'], ['list', 'Lista']].map(([v, l]) => `
              <button data-view="${v}" style="padding:6px 14px;border:none;cursor:pointer;font-size:0.8125rem;
                background:${activeView === v ? 'var(--brand-gold,#D4A843)' : 'var(--bg-surface,#16202C)'};
                color:${activeView === v ? '#000' : 'var(--text-muted,#5A6B7A)'};
                transition:all 0.15s;font-weight:${activeView === v ? '600' : '400'};">${l}</button>
            `).join('')}
          </div>

          <!-- Account selector -->
          <select id="cc-account-select" style="padding:6px 12px;border:1px solid var(--border-subtle,#1E2D3D);
            border-radius:8px;background:var(--bg-surface,#16202C);color:var(--text-primary,#E8ECF1);
            font-size:0.8125rem;cursor:pointer;outline:none;">
            <option value="">Todas as contas</option>
            ${ACCOUNTS.map(a => `<option value="${esc(a.value)}" ${activeAccount === a.value ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}
          </select>

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
            background:var(--brand-gold,#D4A843);color:#000;font-size:0.8125rem;font-weight:600;
            cursor:pointer;transition:opacity 0.15s;">+ Novo Slot</button>
          <button id="cc-suggest-week" style="padding:6px 16px;border:1px solid var(--brand-gold,#D4A843);
            border-radius:8px;background:transparent;color:var(--brand-gold,#D4A843);
            font-size:0.8125rem;font-weight:600;cursor:pointer;transition:opacity 0.15s;">
            IA: Sugerir Semana</button>
        </div>
      </div>

      <!-- Calendar body -->
      <div id="cc-body"></div>

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
    const sd = s.scheduledDate instanceof Date ? s.scheduledDate : new Date(s.scheduledDate);
    return sd.getFullYear() === y && sd.getMonth() === m;
  });

  if (activeAccount) {
    filtered = filtered.filter(s => s.account === activeAccount);
  }

  // Sort by date
  filtered.sort((a, b) => {
    const da = a.scheduledDate instanceof Date ? a.scheduledDate : new Date(a.scheduledDate);
    const db = b.scheduledDate instanceof Date ? b.scheduledDate : new Date(b.scheduledDate);
    return da - db;
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
        const sd = slot.scheduledDate instanceof Date ? slot.scheduledDate : new Date(slot.scheduledDate);
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

  if (mode === 'compact') {
    return `
      <div class="cc-slot-card" data-slot-id="${esc(slot.id)}"
        style="padding:3px 6px;border-radius:4px;font-size:0.6875rem;cursor:pointer;
          background:${statusColor}18;border-left:3px solid ${statusColor};
          transition:background 0.15s;display:flex;align-items:center;gap:3px;overflow:hidden;"
        onmouseover="this.style.background='${statusColor}30'"
        onmouseout="this.style.background='${statusColor}18'">
        <span style="flex-shrink:0;">${typeIcon}</span>
        <span style="color:var(--text-primary,#E8ECF1);overflow:hidden;text-overflow:ellipsis;
          white-space:nowrap;">${esc(title)}</span>
        <span style="width:5px;height:5px;border-radius:50%;background:${statusColor};flex-shrink:0;margin-left:auto;"></span>
      </div>
    `;
  }

  // Detailed mode (week view)
  const sd = slot.scheduledDate instanceof Date ? slot.scheduledDate : new Date(slot.scheduledDate);
  const time = slot.scheduledTime || '';
  const slotTime = SLOT_TIME_LIST.find(s => s.value === slot.slotTime);

  return `
    <div class="cc-slot-card" data-slot-id="${esc(slot.id)}"
      style="padding:8px 10px;border-radius:6px;cursor:pointer;
        background:${statusColor}12;border-left:3px solid ${statusColor};
        transition:background 0.15s;"
      onmouseover="this.style.background='${statusColor}25'"
      onmouseout="this.style.background='${statusColor}12'">
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
        <span style="font-size:0.8125rem;">${typeIcon}</span>
        <span style="font-size:0.75rem;font-weight:600;color:var(--text-primary,#E8ECF1);
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(title)}</span>
      </div>
      ${time ? `<div style="font-size:0.6875rem;color:var(--text-muted,#5A6B7A);margin-bottom:2px;">${esc(time)}</div>` : ''}
      ${slotTime ? `<div style="font-size:0.6875rem;color:var(--text-muted,#5A6B7A);margin-bottom:2px;">${esc(slotTime.label)}</div>` : ''}
      <div style="display:flex;align-items:center;gap:4px;margin-top:4px;">
        <span style="width:6px;height:6px;border-radius:50%;background:${statusColor};flex-shrink:0;"></span>
        <span style="font-size:0.6875rem;color:${statusColor};">${esc(STATUS_LABELS[slot.status] || '')}</span>
      </div>
      ${slot.brief ? `<div style="font-size:0.6875rem;color:var(--text-muted,#5A6B7A);margin-top:4px;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(truncate(slot.brief, 40))}</div>` : ''}
    </div>
  `;
}

/* ── Cell event binding ─────────────────────────────────── */

function bindCalendarCellEvents(container) {
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
}

/* ── Header event binding ───────────────────────────────── */

function bindHeaderEvents(container) {
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
    suggestBtn.addEventListener('click', () => handleSuggestWeek(container));
  }
}

/* ── Suggest week handler ───────────────────────────────── */

async function handleSuggestWeek(container) {
  const btn = document.getElementById('cc-suggest-week');
  if (!btn) return;

  const originalText = btn.textContent;
  btn.textContent = 'Gerando...';
  btn.disabled = true;
  btn.style.opacity = '0.6';

  try {
    const ws = startOfWeek(currentDate);
    const we = endOfWeek(currentDate);
    const account = activeAccount || 'primetourviagens';

    const suggestions = await suggestWeekContent({
      startDate: formatDate(ws),
      endDate: formatDate(we),
      account,
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
          scheduledTime: sug.time || '',
          slotTime: sug.slotTime || 'manha',
          category: sug.category || 'destinos',
          status: 'ideia',
          brief: sug.brief || sug.description || '',
          caption: sug.caption || '',
          hashtags: sug.hashtags || '',
          imageNotes: sug.imageNotes || '',
          campaign: sug.campaign || '',
        });
        if (newSlot) {
          allSlots.push(newSlot);
          created++;
        }
      } catch (e) {
        console.error('Erro ao criar slot sugerido:', e);
      }
    }

    toast.success(`${created} slot(s) criado(s) com sugestoes da IA`);
    renderPage(container);
  } catch (e) {
    console.error('Erro ao sugerir semana:', e);
    toast.error('Erro ao gerar sugestoes de conteudo');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
    btn.style.opacity = '1';
  }
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
    const sd = s.scheduledDate instanceof Date ? s.scheduledDate : new Date(s.scheduledDate);
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
            <select id="cc-f-platform" style="${inputStyle}cursor:pointer;">
              <option value="">Selecionar...</option>
              ${PLATFORM_LIST.map(p => `<option value="${p.value}" ${s.platform === p.value ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="${labelStyle}">Tipo de Conteudo</label>
            <select id="cc-f-contentType" style="${inputStyle}cursor:pointer;">
              <option value="">Selecionar...</option>
              ${CONTENT_TYPE_LIST.map(t => `<option value="${t.value}" ${s.contentType === t.value ? 'selected' : ''}>${getTypeIcon(t.value)} ${esc(t.label)}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- Account -->
        <div style="${fieldGroupStyle}">
          <label style="${labelStyle}">Conta</label>
          <select id="cc-f-account" style="${inputStyle}cursor:pointer;">
            <option value="">Selecionar...</option>
            ${ACCOUNTS.map(a => `<option value="${a.value}" ${s.account === a.value ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}
          </select>
        </div>

        <!-- Row: Date + Time + Slot -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;${fieldGroupStyle}">
          <div>
            <label style="${labelStyle}">Data Agendada</label>
            <input type="date" id="cc-f-date" value="${esc(dateVal)}" style="${inputStyle}" />
          </div>
          <div>
            <label style="${labelStyle}">Horario</label>
            <input type="time" id="cc-f-time" value="${esc(s.scheduledTime || '')}" style="${inputStyle}" />
          </div>
          <div>
            <label style="${labelStyle}">Slot</label>
            <select id="cc-f-slotTime" style="${inputStyle}cursor:pointer;">
              <option value="">Selecionar...</option>
              ${SLOT_TIME_LIST.map(t => `<option value="${t.value}" ${s.slotTime === t.value ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- Row: Category + Campaign -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;${fieldGroupStyle}">
          <div>
            <label style="${labelStyle}">Categoria</label>
            <select id="cc-f-category" style="${inputStyle}cursor:pointer;">
              <option value="">Selecionar...</option>
              ${CATEGORY_LIST.map(c => `<option value="${c.value}" ${s.category === c.value ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="${labelStyle}">Campanha (opcional)</label>
            <input type="text" id="cc-f-campaign" value="${esc(s.campaign || '')}" placeholder="Nome da campanha"
              style="${inputStyle}" />
          </div>
        </div>

        <!-- Status -->
        <div style="${fieldGroupStyle}">
          <label style="${labelStyle}">Status</label>
          <select id="cc-f-status" style="${inputStyle}cursor:pointer;">
            ${Object.entries(STATUS_LABELS).map(([k, v]) => `
              <option value="${k}" ${(s.status || 'ideia') === k ? 'selected' : ''}
                style="color:${STATUS_COLORS[k]};">
                ${esc(v)}
              </option>
            `).join('')}
          </select>
          <div id="cc-status-indicator" style="display:flex;align-items:center;gap:6px;margin-top:6px;">
            <span style="width:8px;height:8px;border-radius:50%;background:${getStatusColor(s.status || 'ideia')};"></span>
            <span style="font-size:0.75rem;color:${getStatusColor(s.status || 'ideia')};">
              ${esc(STATUS_LABELS[s.status || 'ideia'])}
            </span>
          </div>
        </div>

        <!-- Brief -->
        <div style="${fieldGroupStyle}">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <label style="${labelStyle}margin-bottom:0;">Brief</label>
            <button id="cc-ai-brief" style="padding:3px 10px;border:1px solid var(--brand-gold,#D4A843);
              border-radius:6px;background:transparent;color:var(--brand-gold,#D4A843);
              font-size:0.6875rem;cursor:pointer;font-weight:600;transition:opacity 0.15s;">
              &#9670; IA: Gerar Brief</button>
          </div>
          <textarea id="cc-f-brief" rows="3" placeholder="Descreva o objetivo e direcionamento do conteudo..."
            style="${inputStyle}resize:vertical;min-height:70px;">${esc(s.brief || '')}</textarea>
        </div>

        <!-- Caption -->
        <div style="${fieldGroupStyle}">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <label style="${labelStyle}margin-bottom:0;">Legenda</label>
            <button id="cc-ai-caption" style="padding:3px 10px;border:1px solid var(--brand-gold,#D4A843);
              border-radius:6px;background:transparent;color:var(--brand-gold,#D4A843);
              font-size:0.6875rem;cursor:pointer;font-weight:600;transition:opacity 0.15s;">
              &#9670; IA: Gerar Legenda</button>
          </div>
          <textarea id="cc-f-caption" rows="4" placeholder="Legenda para a publicacao..."
            style="${inputStyle}resize:vertical;min-height:90px;">${esc(s.caption || '')}</textarea>
        </div>

        <!-- Hashtags -->
        <div style="${fieldGroupStyle}">
          <label style="${labelStyle}">Hashtags (separadas por virgula)</label>
          <input type="text" id="cc-f-hashtags" value="${esc(s.hashtags || '')}"
            placeholder="#primetour, #viagem, #destinos"
            style="${inputStyle}" />
        </div>

        <!-- Image Notes -->
        <div style="${fieldGroupStyle}">
          <label style="${labelStyle}">Notas de Imagem</label>
          <textarea id="cc-f-imageNotes" rows="2" placeholder="Descricao da imagem ou referencia visual..."
            style="${inputStyle}resize:vertical;min-height:50px;">${esc(s.imageNotes || '')}</textarea>
        </div>
      </div>

      <!-- Modal footer -->
      <div style="display:flex;align-items:center;justify-content:${isNew ? 'flex-end' : 'space-between'};
        padding:16px 24px;border-top:1px solid var(--border-subtle,#1E2D3D);">
        ${!isNew ? `
          <button id="cc-modal-delete" style="padding:8px 18px;border:1px solid #EF4444;border-radius:8px;
            background:transparent;color:#EF4444;font-size:0.8125rem;font-weight:600;cursor:pointer;
            transition:all 0.15s;"
            onmouseover="this.style.background='#EF444415'"
            onmouseout="this.style.background='transparent'">Excluir</button>
        ` : ''}
        <div style="display:flex;gap:8px;">
          <button id="cc-modal-cancel" style="padding:8px 18px;border:1px solid var(--border-subtle,#1E2D3D);
            border-radius:8px;background:var(--bg-surface,#16202C);color:var(--text-primary,#E8ECF1);
            font-size:0.8125rem;cursor:pointer;transition:all 0.15s;">Cancelar</button>
          <button id="cc-modal-save" style="padding:8px 24px;border:none;border-radius:8px;
            background:var(--brand-gold,#D4A843);color:#000;font-size:0.8125rem;font-weight:600;
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

  // Close overlay on backdrop click
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
  }

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

  // Status indicator update
  const statusSelect = document.getElementById('cc-f-status');
  if (statusSelect) {
    statusSelect.addEventListener('change', () => {
      const indicator = document.getElementById('cc-status-indicator');
      if (indicator) {
        const color = getStatusColor(statusSelect.value);
        indicator.innerHTML = `
          <span style="width:8px;height:8px;border-radius:50%;background:${color};"></span>
          <span style="font-size:0.75rem;color:${color};">
            ${esc(STATUS_LABELS[statusSelect.value] || statusSelect.value)}
          </span>
        `;
      }
    });
  }

  // AI Brief
  const aiBriefBtn = document.getElementById('cc-ai-brief');
  if (aiBriefBtn) aiBriefBtn.addEventListener('click', handleAIBrief);

  // AI Caption
  const aiCaptionBtn = document.getElementById('cc-ai-caption');
  if (aiCaptionBtn) aiCaptionBtn.addEventListener('click', handleAICaption);

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
    scheduledTime: document.getElementById('cc-f-time')?.value || '',
    slotTime:      document.getElementById('cc-f-slotTime')?.value || '',
    category:      document.getElementById('cc-f-category')?.value || '',
    campaign:      document.getElementById('cc-f-campaign')?.value?.trim() || '',
    status:        document.getElementById('cc-f-status')?.value || 'ideia',
    brief:         document.getElementById('cc-f-brief')?.value?.trim() || '',
    caption:       document.getElementById('cc-f-caption')?.value?.trim() || '',
    hashtags:      document.getElementById('cc-f-hashtags')?.value?.trim() || '',
    imageNotes:    document.getElementById('cc-f-imageNotes')?.value?.trim() || '',
  };
}

/* ── Save handler ───────────────────────────────────────── */

async function handleSave() {
  const data = getFormData();

  if (!data.title) {
    toast.error('Titulo e obrigatorio');
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
      // Update existing
      const updated = await updateSlot(editingSlot.id, data);
      const idx = allSlots.findIndex(s => s.id === editingSlot.id);
      if (idx !== -1) {
        allSlots[idx] = { ...allSlots[idx], ...data, ...(updated || {}) };
      }
      toast.success('Slot atualizado com sucesso');
    } else {
      // Create new
      const created = await createSlot(data);
      if (created) {
        allSlots.push(created);
      } else {
        allSlots.push({ id: 'temp_' + Date.now(), ...data });
      }
      toast.success('Slot criado com sucesso');
    }

    closeModal();
    renderCalendarBody();
  } catch (e) {
    console.error('Erro ao salvar slot:', e);
    toast.error('Erro ao salvar slot');
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
    toast.error('Erro ao excluir slot');
    if (deleteBtn) {
      deleteBtn.textContent = 'Excluir';
      deleteBtn.disabled = false;
      deleteBtn.style.opacity = '1';
    }
  }
}

/* ── AI Brief handler ───────────────────────────────────── */

async function handleAIBrief() {
  const btn = document.getElementById('cc-ai-brief');
  const textarea = document.getElementById('cc-f-brief');
  if (!btn || !textarea) return;

  const data = getFormData();
  const originalText = btn.innerHTML;
  btn.innerHTML = 'Gerando...';
  btn.disabled = true;
  btn.style.opacity = '0.6';

  try {
    const result = await suggestCaption({
      type: 'brief',
      title: data.title,
      platform: data.platform,
      contentType: data.contentType,
      category: data.category,
      campaign: data.campaign,
      account: data.account,
    });

    if (result && result.text) {
      textarea.value = result.text;
      toast.success('Brief gerado pela IA');
    } else {
      toast.info('Nenhuma sugestao disponivel');
    }
  } catch (e) {
    console.error('Erro ao gerar brief:', e);
    toast.error('Erro ao gerar brief com IA');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}

/* ── AI Caption handler ─────────────────────────────────── */

async function handleAICaption() {
  const btn = document.getElementById('cc-ai-caption');
  const textarea = document.getElementById('cc-f-caption');
  if (!btn || !textarea) return;

  const data = getFormData();
  const originalText = btn.innerHTML;
  btn.innerHTML = 'Gerando...';
  btn.disabled = true;
  btn.style.opacity = '0.6';

  try {
    const result = await suggestCaption({
      type: 'caption',
      title: data.title,
      platform: data.platform,
      contentType: data.contentType,
      category: data.category,
      campaign: data.campaign,
      account: data.account,
      brief: data.brief,
    });

    if (result && result.text) {
      textarea.value = result.text;
      toast.success('Legenda gerada pela IA');
    } else {
      toast.info('Nenhuma sugestao disponivel');
    }
  } catch (e) {
    console.error('Erro ao gerar legenda:', e);
    toast.error('Erro ao gerar legenda com IA');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}
