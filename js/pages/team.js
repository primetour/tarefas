/**
 * PRIMETOUR — Team Page (Fase 2 revisado)
 * Membros da equipe + Capacidade (férias/ausências) unificados
 */

import { store }  from '../store.js';
import { userAvatarInner } from '../components/userAvatar.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import {
  createAbsence, updateAbsence, deleteAbsence,
  fetchUserAbsences, fetchAllAbsences,
  getTeamAvailability, ABSENCE_TYPES,
} from '../services/capacity.js';
import {
  syncVacationPeriods, fetchVacationPeriods, fetchVacationRequests,
  subscribeVacationRequests, createVacationRequest,
  approveVacationRequest, rejectVacationRequest, cancelVacationRequest,
  computeBalance,
  VACATION_DAYS_PER_PERIOD, MIN_FRACTION_DAYS, MIN_LARGE_FRACTION,
  MAX_FRACTIONS, MAX_ABONO_DAYS,
} from '../services/vacation.js?v=20260501m';
import { userNucleos } from '../services/sectors.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}).format(d);
}
function toISO(ts) {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toISOString().slice(0,10);
}

let allAbsences = [];
let activeTab   = 'capacity'; // 'capacity' | 'mine' | 'members'

/* ─── Render ─────────────────────────────────────────────── */
export async function renderTeam(container) {
  // Garantir que users estejam carregados no store
  if (!(store.get('users') || []).length) {
    try {
      const { fetchUsers } = await import('../services/users.js');
      await fetchUsers();
    } catch(e) { console.warn('Erro ao carregar usuários:', e.message); }
  }

  const users      = store.get('users') || [];
  const workspaces = store.get('userWorkspaces') || [];
  const canViewAll = store.can('absence_manage_team') || store.can('system_manage_users') || store.can('system_view_all');

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Equipe</h1>
        <p class="page-subtitle">Membros, disponibilidade e gestão de ausências</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-secondary btn-sm" id="export-absences-btn">↓ Exportar</button>
        <button class="btn btn-primary" id="new-absence-btn">+ Registrar ausência</button>
      </div>
    </div>

    <!-- Tabs -->
    <div style="display:flex;gap:0;margin-bottom:24px;border-bottom:1px solid var(--border-subtle);overflow-x:auto;">
      ${[
        { id:'capacity', label:'Disponibilidade',   icon:'◐' },
        { id:'mine',     label:'Minhas ausências',  icon:'◌' },
        { id:'vacations', label:'Férias',           icon:'🏖' },
        { id:'members',  label:'Membros',           icon:'◉' },
      ].map(t => `
        <button class="team-tab-btn" data-tab="${t.id}"
          style="padding:8px 18px;border:none;background:none;cursor:pointer;font-size:0.875rem;
          color:${activeTab===t.id?'var(--brand-gold)':'var(--text-muted)'};
          border-bottom:2px solid ${activeTab===t.id?'var(--brand-gold)':'transparent'};
          transition:all 0.15s;">
          ${t.icon} ${t.label}
        </button>
      `).join('')}
    </div>

    <div id="team-content">
      <div class="card skeleton" style="height:300px;"></div>
    </div>
  `;

  document.getElementById('new-absence-btn')?.addEventListener('click', () => openAbsenceModal());
  document.getElementById('export-absences-btn')?.addEventListener('click', () => openExportModal());
  container.querySelectorAll('.team-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      container.querySelectorAll('.team-tab-btn').forEach(b => {
        b.style.color       = b.dataset.tab===activeTab ? 'var(--brand-gold)' : 'var(--text-muted)';
        b.style.borderColor = b.dataset.tab===activeTab ? 'var(--brand-gold)' : 'transparent';
      });
      loadTab();
    });
  });

  loadTab();
}

async function loadTab() {
  const el = document.getElementById('team-content');
  if (!el) return;
  el.innerHTML = '<div class="chart-loading"><div class="chart-loading-spinner"></div></div>';

  try {
    const uid = store.get('currentUser').uid;
    if (activeTab === 'members')  renderMembers(el);
    else if (activeTab === 'mine') {
      allAbsences = await fetchUserAbsences(uid);
      renderMyAbsences(el);
    } else if (activeTab === 'vacations') {
      await renderVacationsTab(el);
    } else {
      allAbsences = await fetchAllAbsences();
      await renderTeamAvailability(el);
    }
  } catch(e) {
    el.innerHTML = `<p style="color:var(--color-danger);padding:24px;">Erro: ${esc(e.message)}</p>`;
  }
}

/* ─── Tab: Membros ───────────────────────────────────────── */
function renderMembers(container) {
  const allUsers   = (store.get('users') || []).filter(u => u.active !== false);
  const workspaces = store.get('userWorkspaces') || [];

  // Filter by visible sectors
  const visibleSectors = store.get('visibleSectors') || [];
  const users = store.isMaster() || !visibleSectors.length
    ? allUsers
    : allUsers.filter(u => {
        const uSector = u.sector || u.department;
        return !uSector || visibleSectors.includes(uSector);
      });

  if (!users.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">◉</div>
      <div class="empty-state-title">Nenhum membro cadastrado</div></div>`;
    return;
  }

  // Group by sector
  const sectors = [...new Set(users.map(u => u.sector || u.department || 'Sem setor'))].sort();
  const allRoles = store.get('roles') || [];

  container.innerHTML = sectors.map(sector => {
    const sectorUsers = users.filter(u => (u.sector || u.department || 'Sem setor') === sector);

    const cards = sectorUsers.map(u => {
      const initials  = u.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
      const roleDoc   = allRoles.find(r => r.id === (u.roleId||u.role));
      const roleName  = roleDoc?.name || u.role || '—';
      const roleColor = roleDoc?.color || '#6B7280';
      const userWs    = workspaces.filter(ws => ws.members?.includes(u.id));

      const wsChips = userWs.slice(0,2).map(ws =>
        `<span style="font-size:0.6875rem;padding:2px 8px;border-radius:var(--radius-full);
          background:${ws.color||'#D4A843'}15;color:${ws.color||'#D4A843'};
          border:1px solid ${ws.color||'#D4A843'}33;">
          ${esc(ws.icon||'◈')} ${esc(ws.name)}
        </span>`
      ).join('');

      return `
        <div class="card" style="padding:16px;">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
            <div class="avatar" style="background:${u.avatarColor||'#3B82F6'};
              width:40px;height:40px;font-size:0.875rem;flex-shrink:0;">
              ${userAvatarInner(u)}
            </div>
            <div style="min-width:0;flex:1;">
              <div style="font-weight:600;color:var(--text-primary);
                overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(u.name)}</div>
              <div style="font-size:0.75rem;color:var(--text-muted);">${esc(userNucleos(u).join(', ') || u.email || '')}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-size:0.6875rem;padding:2px 8px;border-radius:var(--radius-full);
              background:${roleColor}22;color:${roleColor};border:1px solid ${roleColor}44;">
              ${esc(roleName)}
            </span>
            ${wsChips}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div style="margin-bottom:28px;">
        <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;
          color:var(--text-muted);margin-bottom:12px;padding-bottom:6px;
          border-bottom:1px solid var(--border-subtle);">
          ${esc(sector)} <span style="font-weight:400;opacity:0.6;">(${sectorUsers.length})</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;">
          ${cards}
        </div>
      </div>
    `;
  }).join('');
}

/* ─── Tab: Minhas ausências ──────────────────────────────── */
function renderMyAbsences(container) {
  const uid = store.get('currentUser').uid;

  if (!allAbsences.length) {
    container.innerHTML = `
      <div class="empty-state" style="min-height:30vh;">
        <div class="empty-state-icon">◌</div>
        <div class="empty-state-title">Nenhuma ausência registrada</div>
        <p class="text-sm text-muted">Registre férias, licenças e outros afastamentos.</p>
      </div>`;
    return;
  }

  const now      = new Date();
  const upcoming = allAbsences.filter(a => {
    const e = a.endDate?.toDate ? a.endDate.toDate() : new Date(a.endDate);
    return e >= now;
  });
  const past = allAbsences.filter(a => {
    const e = a.endDate?.toDate ? a.endDate.toDate() : new Date(a.endDate);
    return e < now;
  });

  container.innerHTML = `
    ${upcoming.length ? `
      <div class="card" style="margin-bottom:20px;">
        <div class="card-header"><div class="card-title">📅 Próximas</div></div>
        <div class="card-body" style="padding:0;">${absenceTable(upcoming, uid, true)}</div>
      </div>` : ''}
    ${past.length ? `
      <div class="card">
        <div class="card-header"><div class="card-title">◌ Histórico</div></div>
        <div class="card-body" style="padding:0;">${absenceTable(past, uid, false)}</div>
      </div>` : ''}
  `;

  container.querySelectorAll('.absence-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = allAbsences.find(x => x.id === btn.dataset.id);
      if (a) openAbsenceModal(a);
    });
  });
  container.querySelectorAll('.absence-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => confirmDeleteAbsence(btn.dataset.id));
  });
}

function absenceTable(absences, uid, showActions) {
  return `<div class="data-table-wrapper"><table class="data-table">
    <thead><tr>
      <th>Tipo</th><th>Início</th><th>Fim</th><th>Duração</th><th>Observação</th>
      ${showActions ? '<th class="col-actions">Ações</th>' : ''}
    </tr></thead>
    <tbody>${absences.map(a => {
      const typeDef = ABSENCE_TYPES.find(t => t.value === a.type) || ABSENCE_TYPES[5];
      const start   = a.startDate?.toDate ? a.startDate.toDate() : new Date(a.startDate);
      const end     = a.endDate?.toDate   ? a.endDate.toDate()   : new Date(a.endDate);
      const isPartial = !!a.partial;
      // Duração: dias inteiros OU horas (parcial)
      let durationLabel;
      if (isPartial) {
        const hrs = Math.max(0, Math.round(((end - start) / 3600000) * 10) / 10);
        durationLabel = `${hrs}h`;
      } else {
        const days = Math.ceil((end - start) / 86400000) + 1;
        durationLabel = `${days} dia${days!==1?'s':''}`;
      }
      const fmtH = (d) => formatTimePart(d);
      const startDisplay = isPartial
        ? `${fmtDate(a.startDate)} <span style="color:var(--text-muted);font-size:0.75rem;">${fmtH(a.startDate)}</span>`
        : fmtDate(a.startDate);
      const endDisplay = isPartial
        ? `<span style="color:var(--text-muted);font-size:0.75rem;">${fmtH(a.endDate)}</span>`
        : fmtDate(a.endDate);
      const canEdit = a.createdBy === uid || store.can('absence_manage_team') || store.can('system_manage_users');
      return `<tr>
        <td><span style="display:inline-flex;align-items:center;gap:6px;">
          <span>${typeDef.icon}</span>
          <span class="badge" style="background:${typeDef.color}22;color:${typeDef.color};border:1px solid ${typeDef.color}44;">
            ${typeDef.label}${isPartial ? ' · parcial' : ''}
          </span>
        </span></td>
        <td>${startDisplay}</td>
        <td>${endDisplay}</td>
        <td style="color:var(--text-muted);">${durationLabel}</td>
        <td style="color:var(--text-muted);font-size:0.8125rem;">${esc(a.note||'—')}</td>
        ${showActions && canEdit ? `<td class="col-actions"><div class="actions-group">
          <button class="btn btn-ghost btn-icon btn-sm absence-edit-btn" data-id="${a.id}" title="Editar">✎</button>
          <button class="btn btn-ghost btn-icon btn-sm absence-delete-btn" data-id="${a.id}" title="Excluir" style="color:var(--color-danger);">✕</button>
        </div></td>` : showActions ? '<td></td>' : ''}
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

// 4.35.9+ Mês visualizado no calendário da equipe. Persistido em closure
// pra permitir navegação prev/next sem perder estado.
let _teamAvailMonth = null;

/* ─── Tab: Disponibilidade da equipe ─────────────────────── */
async function renderTeamAvailability(container) {
  const users = (store.get('users') || []).filter(u => u.active !== false);
  // 4.35.9+ Default = mês corrente; user pode navegar pra meses futuros via prev/next
  if (!_teamAvailMonth) _teamAvailMonth = new Date();
  const ref   = _teamAvailMonth;
  const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const end   = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);

  // 4.35.9+ Busca TODAS as ausências (sem filtro) pra calcular contador
  // de futuras → permite indicar visualmente que há ausências fora da view
  const allAbsForCount = await (await import('../services/capacity.js')).fetchAllAbsences();
  const futureAbsCount = allAbsForCount.filter(a => {
    const aStart = a.startDate?.toDate ? a.startDate.toDate() : new Date(a.startDate);
    return aStart > end;
  }).length;

  const team  = await getTeamAvailability(users.map(u => u.id), start, end);
  const days  = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) days.push(new Date(d));

  const DAYS_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const monthLabel = new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(ref);
  const isCurrentMonth = ref.getFullYear() === new Date().getFullYear() && ref.getMonth() === new Date().getMonth();

  container.innerHTML = `
    <!-- 4.35.9+ Navegação prev/next + indicador de ausências futuras -->
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="btn btn-secondary btn-sm" id="team-avail-prev" title="Mês anterior">‹</button>
        <span style="font-weight:600;font-size:0.9375rem;text-transform:capitalize;min-width:160px;text-align:center;">${monthLabel}</span>
        <button class="btn btn-secondary btn-sm" id="team-avail-next" title="Próximo mês">›</button>
        ${!isCurrentMonth ? `<button class="btn btn-ghost btn-sm" id="team-avail-today" style="font-size:0.75rem;">↻ Mês atual</button>` : ''}
      </div>
      ${futureAbsCount > 0 ? `
        <span style="font-size:0.75rem;color:var(--text-muted);">
          📌 ${futureAbsCount} ausência${futureAbsCount>1?'s':''} agendada${futureAbsCount>1?'s':''} pra meses futuros
        </span>` : ''}
    </div>

    <div style="display:grid;grid-template-columns:220px 1fr;gap:20px;align-items:start;">
      <!-- Availability bars -->
      <div class="card">
        <div class="card-header"><div class="card-title">◐ ${monthLabel}</div></div>
        <div class="card-body" style="padding:8px 0;">
          ${team.map(u => `
            <div style="padding:8px 16px;border-bottom:1px solid var(--border-subtle);">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
                <div class="avatar avatar-sm" style="background:${u.avatarColor};flex-shrink:0;">
                  ${userAvatarInner(u)}
                </div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:0.8125rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(u.name.split(' ')[0])}</div>
                  <div style="font-size:0.6875rem;color:var(--text-muted);">${u.available}/${u.total}d</div>
                </div>
                <span style="font-size:0.8125rem;font-weight:700;color:${u.rate>=80?'#22C55E':u.rate>=50?'#F59E0B':'#EF4444'};">${u.rate}%</span>
              </div>
              <div style="height:4px;background:var(--bg-elevated);border-radius:2px;overflow:hidden;">
                <div style="height:100%;width:${u.rate}%;background:${u.rate>=80?'#22C55E':u.rate>=50?'#F59E0B':'#EF4444'};border-radius:2px;"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Calendar -->
      <div class="card">
        <div class="card-header"><div class="card-title">📅 Calendário de ausências</div></div>
        <div class="card-body" style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.75rem;">
            <thead><tr>
              <th style="padding:4px 8px;text-align:left;color:var(--text-muted);min-width:80px;">Membro</th>
              ${days.map(d => {
                const isWe = d.getDay()===0||d.getDay()===6;
                return `<th style="padding:4px 2px;text-align:center;color:${isWe?'var(--border-default)':'var(--text-muted)'};min-width:26px;">${d.getDate()}</th>`;
              }).join('')}
            </tr></thead>
            <tbody>
              ${team.map(u => `
                <tr>
                  <td style="padding:3px 8px;font-size:0.75rem;color:var(--text-secondary);
                    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80px;">
                    ${esc(u.name.split(' ')[0])}
                  </td>
                  ${days.map(d => {
                    const isWe = d.getDay()===0||d.getDay()===6;
                    const ab   = u.absences.find(a => {
                      const s = a.startDate?.toDate ? a.startDate.toDate() : new Date(a.startDate);
                      const e = a.endDate?.toDate   ? a.endDate.toDate()   : new Date(a.endDate);
                      s.setHours(0,0,0,0); e.setHours(23,59,59,999);
                      const dd = new Date(d); dd.setHours(12);
                      return dd>=s && dd<=e;
                    });
                    const td = ab ? (ABSENCE_TYPES.find(t=>t.value===ab.type)||ABSENCE_TYPES[5]) : null;
                    // Indica se ausência é parcial (icon + tooltip diferenciado)
                    const isPartial = !!ab?.partial;
                    const tooltip = ab
                      ? (isPartial
                          ? `${td.label} · parcial (${formatTimePart(ab.startDate)}-${formatTimePart(ab.endDate)})`
                          : td.label)
                      : (isWe ? 'Fim de semana' : 'Disponível');
                    return `<td style="padding:2px 1px;text-align:center;">
                      <div style="width:22px;height:22px;border-radius:3px;margin:0 auto;
                        display:flex;align-items:center;justify-content:center;font-size:0.625rem;
                        background:${ab?(isPartial?td.color+'1A':td.color+'33'):isWe?'var(--bg-elevated)':'transparent'};
                        color:${ab?td.color:'var(--text-muted)'};
                        border:1px solid ${ab?td.color+'55':'transparent'};
                        ${isPartial ? 'background-image:linear-gradient(135deg,'+td.color+'33 50%,transparent 50%);' : ''}"
                        title="${esc(tooltip)}">
                        ${ab?td.icon:isWe?'—':''}
                      </div>
                    </td>`;
                  }).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Legend -->
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px;">
      ${ABSENCE_TYPES.map(t => `
        <div style="display:flex;align-items:center;gap:6px;font-size:0.75rem;color:var(--text-muted);">
          <div style="width:14px;height:14px;border-radius:3px;background:${t.color}33;border:1px solid ${t.color}55;
            display:flex;align-items:center;justify-content:center;font-size:0.625rem;">${t.icon}</div>
          ${t.label}
        </div>
      `).join('')}
    </div>
  `;

  // 4.35.9+ Navegação de mês: ferias/ausencias futuras agora visíveis
  document.getElementById('team-avail-prev')?.addEventListener('click', () => {
    _teamAvailMonth = new Date(_teamAvailMonth.getFullYear(), _teamAvailMonth.getMonth() - 1, 1);
    renderTeamAvailability(container);
  });
  document.getElementById('team-avail-next')?.addEventListener('click', () => {
    _teamAvailMonth = new Date(_teamAvailMonth.getFullYear(), _teamAvailMonth.getMonth() + 1, 1);
    renderTeamAvailability(container);
  });
  document.getElementById('team-avail-today')?.addEventListener('click', () => {
    _teamAvailMonth = new Date();
    renderTeamAvailability(container);
  });
}

/* ─── Modal ausência ─────────────────────────────────────── */
async function openAbsenceModal(absence = null) {
  const isEdit  = !!absence;
  let users     = (store.get('users') || []).filter(u => u.active !== false);

  // Se store de users estiver vazio, carregar do Firestore
  if (!users.length) {
    try {
      const { fetchUsers } = await import('../services/users.js');
      const all = await fetchUsers();
      users = all.filter(u => u.active !== false);
    } catch(e) { console.warn('Erro ao carregar usuários:', e.message); }
  }

  const uid     = store.get('currentUser').uid;
  const canMgr  = store.can('absence_manage_team') || store.can('system_manage_users');

  // Pre-extrai horários se ausência existente já é parcial
  const initialPartial = !!absence?.partial;
  const initialStartTime = initialPartial && absence?.startDate
    ? formatTimePart(absence.startDate) : '09:00';
  const initialEndTime = initialPartial && absence?.endDate
    ? formatTimePart(absence.endDate) : '18:00';

  modal.open({
    title:   isEdit ? 'Editar ausência' : 'Registrar ausência',
    size:    'sm',
    dedupeKey: isEdit ? `absence:${absence.id}` : 'absence:new',
    content: `
      <div style="display:flex;flex-direction:column;gap:14px;">
        ${canMgr ? `
          <div class="form-group">
            <label class="form-label">Usuário</label>
            <select class="form-select" id="ab-user">
              ${users.map(u => `<option value="${u.id}" ${(absence?.userId||uid)===u.id?'selected':''}>${esc(u.name)}</option>`).join('')}
            </select>
          </div>` : ''}
        <div class="form-group">
          <label class="form-label">Tipo *</label>
          <select class="form-select" id="ab-type">
            ${ABSENCE_TYPES.map(t => `<option value="${t.value}" ${absence?.type===t.value?'selected':''}>${t.icon} ${t.label}</option>`).join('')}
          </select>
        </div>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
          font-size:0.875rem;color:var(--text-primary);user-select:none;
          padding:8px 10px;background:var(--bg-surface);border-radius:var(--radius-sm);">
          <input type="checkbox" id="ab-partial" ${initialPartial ? 'checked' : ''}
            style="width:16px;height:16px;cursor:pointer;accent-color:var(--brand-gold);" />
          Ausência parcial (por horas, não dia inteiro)
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">Início *</label>
            <input type="date" class="form-input" id="ab-start" value="${absence ? toISO(absence.startDate) : ''}" />
          </div>
          <div class="form-group" id="ab-end-group">
            <label class="form-label">Fim *</label>
            <input type="date" class="form-input" id="ab-end" value="${absence ? toISO(absence.endDate) : ''}" />
          </div>
        </div>
        <div id="ab-time-group" style="display:${initialPartial?'grid':'none'};
          grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">Hora início *</label>
            <input type="time" class="form-input" id="ab-start-time" value="${initialStartTime}" />
          </div>
          <div class="form-group">
            <label class="form-label">Hora fim *</label>
            <input type="time" class="form-input" id="ab-end-time" value="${initialEndTime}" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Observação</label>
          <input type="text" class="form-input" id="ab-note" value="${esc(absence?.note||'')}" maxlength="200"
            placeholder="Ex: Férias de verão..." />
        </div>
      </div>
    `,
    footer: [
      { label:'Cancelar', class:'btn-secondary', closeOnClick:true },
      {
        label: isEdit ? 'Salvar' : 'Registrar',
        class: 'btn-primary', closeOnClick: false,
        onClick: async (_, { close }) => {
          const startVal = document.getElementById('ab-start')?.value;
          let endVal     = document.getElementById('ab-end')?.value;
          const isPartial = document.getElementById('ab-partial')?.checked;
          if (!startVal) { toast.warning('Data de início é obrigatória.'); return; }
          // Em parcial: força end = start (mesmo dia, intervalo é só de horas)
          if (isPartial) endVal = startVal;
          else if (!endVal) { toast.warning('Data de fim é obrigatória.'); return; }
          const userId   = document.getElementById('ab-user')?.value || uid;
          const btn = document.querySelector('.modal-footer .btn-primary');
          if(btn){ btn.classList.add('loading'); btn.disabled=true; }
          try {
            const startTime = isPartial ? (document.getElementById('ab-start-time')?.value || '09:00') : '00:00';
            const endTime   = isPartial ? (document.getElementById('ab-end-time')?.value   || '18:00') : '23:59';
            const data = {
              type:      document.getElementById('ab-type')?.value,
              note:      document.getElementById('ab-note')?.value?.trim() || '',
              startDate: new Date(startVal + 'T' + startTime + ':00'),
              endDate:   new Date(endVal   + 'T' + endTime   + ':59'),
              partial:   isPartial,
            };
            if (isPartial && data.endDate <= data.startDate) {
              toast.warning('Hora de fim deve ser depois da hora de início.');
              if(btn){ btn.classList.remove('loading'); btn.disabled=false; }
              return;
            }
            if (isEdit) await updateAbsence(absence.id, data);
            else        await createAbsence({ userId, ...data });
            toast.success(isEdit ? 'Ausência atualizada.' : 'Ausência registrada.');
            close();
            await loadTab();
          } catch(e) { toast.error(e.message); }
          finally { if(btn){ btn.classList.remove('loading'); btn.disabled=false; } }
        },
      },
    ],
  });

  // Toggle visual: parcial → mostra time inputs e esconde campo "Fim"
  setTimeout(() => {
    const cb = document.getElementById('ab-partial');
    const timeGroup = document.getElementById('ab-time-group');
    const endGroup  = document.getElementById('ab-end-group');
    cb?.addEventListener('change', () => {
      const on = cb.checked;
      if (timeGroup) timeGroup.style.display = on ? 'grid' : 'none';
      if (endGroup)  endGroup.style.display  = on ? 'none' : '';
    });
    // Estado inicial: se partial já marcado ao abrir
    if (cb?.checked && endGroup) endGroup.style.display = 'none';
  }, 50);
}

// Helper: formata Date|Timestamp pra "HH:MM" (input type=time)
function formatTimePart(d) {
  const dt = d?.toDate ? d.toDate() : (d instanceof Date ? d : new Date(d));
  if (isNaN(dt)) return '09:00';
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

async function confirmDeleteAbsence(id) {
  const ok = await modal.confirm({
    title:'Remover ausência', message:'Remover este registro?',
    confirmText:'Remover', danger:true, icon:'✕',
  });
  if (!ok) return;
  try {
    await deleteAbsence(id);
    toast.success('Ausência removida.');
    await loadTab();
  } catch(e) { toast.error(e.message); }
}

/* ─── Export ──────────────────────────────────────────────── */
function openExportModal() {
  modal.open({
    title:   'Exportar ausências',
    size:    'sm',
    content: `
      <p style="font-size:0.875rem;color:var(--text-secondary);margin-bottom:16px;line-height:1.5;">
        Escolha o formato de exportação. Serão exportadas as ausências visíveis na aba atual.
      </p>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button class="btn btn-secondary" id="export-csv-btn"
          style="display:flex;align-items:center;gap:10px;justify-content:flex-start;padding:12px 16px;">
          <span style="font-size:1.25rem;">📄</span>
          <div style="text-align:left;">
            <div style="font-weight:600;">CSV</div>
            <div style="font-size:0.75rem;color:var(--text-muted);">Compatível com Excel e Google Sheets</div>
          </div>
        </button>
        <button class="btn btn-secondary" id="export-pdf-btn"
          style="display:flex;align-items:center;gap:10px;justify-content:flex-start;padding:12px 16px;">
          <span style="font-size:1.25rem;">📋</span>
          <div style="text-align:left;">
            <div style="font-weight:600;">PDF</div>
            <div style="font-size:0.75rem;color:var(--text-muted);">Relatório formatado para impressão</div>
          </div>
        </button>
      </div>
    `,
    footer: [{ label:'Fechar', class:'btn-secondary', closeOnClick:true }],
  });

  setTimeout(() => {
    document.getElementById('export-csv-btn')?.addEventListener('click', () => {
      exportCSV();
      document.querySelector('.modal-overlay')?.click();
    });
    document.getElementById('export-pdf-btn')?.addEventListener('click', () => {
      exportPDF();
      document.querySelector('.modal-overlay')?.click();
    });
  }, 50);
}

function getExportData() {
  const users = store.get('users') || [];
  return allAbsences.map(a => {
    const typeDef = ABSENCE_TYPES.find(t => t.value === a.type) || ABSENCE_TYPES[5];
    const user    = users.find(u => u.id === a.userId);
    const start   = a.startDate?.toDate ? a.startDate.toDate() : new Date(a.startDate);
    const end     = a.endDate?.toDate   ? a.endDate.toDate()   : new Date(a.endDate);
    const days    = Math.ceil((end - start) / (1000*60*60*24)) + 1;
    return {
      nome:      user?.name || a.userId,
      tipo:      typeDef.label,
      inicio:    fmtDate(a.startDate),
      fim:       fmtDate(a.endDate),
      dias:      days,
      observacao: a.note || '',
    };
  });
}

function exportCSV() {
  const rows   = getExportData();
  if (!rows.length) { toast.warning('Nenhuma ausência para exportar.'); return; }

  const headers = ['Nome','Tipo','Início','Fim','Duração (dias)','Observação'];
  const lines   = [
    headers.join(';'),
    ...rows.map(r => [
      `"${r.nome}"`, `"${r.tipo}"`, r.inicio, r.fim, r.dias, `"${r.observacao}"`,
    ].join(';')),
  ];

  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: `ausencias-${new Date().toISOString().slice(0,10)}.csv`,
  });
  a.click();
  URL.revokeObjectURL(url);
  toast.success('CSV exportado!');
}

function exportPDF() {
  const rows = getExportData();
  if (!rows.length) { toast.warning('Nenhuma ausência para exportar.'); return; }

  const dateStr = new Intl.DateTimeFormat('pt-BR', {
    day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit',
  }).format(new Date());

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <title>Relatório de Ausências — PRIMETOUR</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family: Arial, sans-serif; color:#1a1a1a; padding:32px; font-size:13px; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:28px; padding-bottom:16px; border-bottom:2px solid #D4A843; }
    .brand  { font-size:20px; font-weight:700; color:#D4A843; letter-spacing:0.05em; }
    .report-title { font-size:16px; font-weight:600; color:#1a1a1a; margin-top:4px; }
    .meta   { font-size:11px; color:#666; text-align:right; }
    table   { width:100%; border-collapse:collapse; margin-top:8px; }
    th      { background:#f5f5f5; padding:8px 10px; text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#555; border-bottom:2px solid #ddd; }
    td      { padding:8px 10px; border-bottom:1px solid #eee; vertical-align:top; }
    tr:nth-child(even) td { background:#fafafa; }
    .badge  { display:inline-block; padding:2px 8px; border-radius:99px; font-size:11px; background:#f0e6c8; color:#8a6a00; }
    .footer { margin-top:28px; padding-top:12px; border-top:1px solid #ddd; font-size:11px; color:#999; text-align:center; }
    @media print { body { padding:16px; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">PRIMETOUR</div>
      <div class="report-title">Relatório de Ausências</div>
    </div>
    <div class="meta">Gerado em: ${dateStr}<br>Total: ${rows.length} registro${rows.length!==1?'s':''}</div>
  </div>
  <table>
    <thead><tr>
      <th>Nome</th><th>Tipo</th><th>Início</th><th>Fim</th><th>Dias</th><th>Observação</th>
    </tr></thead>
    <tbody>
      ${rows.map(r => `<tr>
        <td><strong>${esc(r.nome)}</strong></td>
        <td><span class="badge">${esc(r.tipo)}</span></td>
        <td>${r.inicio}</td>
        <td>${r.fim}</td>
        <td style="text-align:center;">${r.dias}</td>
        <td style="color:#555;">${esc(r.observacao||'—')}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  <div class="footer">PRIMETOUR — Sistema de Gestão de Tarefas</div>
  <script>window.onload = () => { window.print(); }</script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) { toast.error('Permita pop-ups para exportar PDF.'); return; }
  win.document.write(html);
  win.document.close();
}

/* ═══════════════════════════════════════════════════════════
 * Tab: FÉRIAS (Benner-style)
 *  - Próprio: períodos aquisitivos + saldo + nova solicitação +
 *    histórico de solicitações
 *  - Gestor: lista todos os colaboradores com saldo + aprovar/rejeitar
 * ═══════════════════════════════════════════════════════════ */
let _unsubVacations = null;

async function renderVacationsTab(container) {
  if (_unsubVacations) { _unsubVacations(); _unsubVacations = null; }
  const cu = store.get('currentUser');
  const profile = store.get('userProfile') || {};
  const isMgr = store.can('absence_manage_team') || store.can('system_manage_users') || store.isMaster();

  // Acha admissionDate do usuário (campo opcional no doc users)
  const myUser = (store.get('users') || []).find(u => u.id === cu.uid) || {};
  const admDate = profile.admissionDate || profile.hireDate || myUser.admissionDate || myUser.hireDate;

  if (!admDate) {
    // Fluxo de cadastro: usuário sem admissão informa pra calcular
    container.innerHTML = `
      <div class="card" style="padding:32px;text-align:center;max-width:540px;margin:24px auto;">
        <div style="font-size:3rem;margin-bottom:12px;">🏖</div>
        <h3 style="margin:0 0 8px;color:var(--text-primary);">Informe sua data de admissão</h3>
        <p style="color:var(--text-muted);font-size:0.875rem;margin-bottom:18px;line-height:1.5;">
          Pra calcular seu saldo de férias (períodos aquisitivos),
          precisamos saber a data em que você foi admitido(a) na empresa.
        </p>
        <div class="form-group" style="text-align:left;">
          <label class="form-label">Data de admissão</label>
          <input type="date" class="form-input" id="adm-date-input" max="${new Date().toISOString().slice(0,10)}" />
        </div>
        <button class="btn btn-primary" id="adm-date-save">💾 Salvar</button>
      </div>
    `;
    document.getElementById('adm-date-save')?.addEventListener('click', async () => {
      const v = document.getElementById('adm-date-input').value;
      if (!v) return toast.error('Informe a data.');
      try {
        const { updateUserProfile } = await import('../auth/auth.js');
        await updateUserProfile(cu.uid, { admissionDate: v });
        toast.success('Data salva! Calculando saldo...');
        loadTab();
      } catch (e) { toast.error(e.message); }
    });
    return;
  }

  // Sincroniza períodos aquisitivos
  let periods = [];
  try {
    periods = await syncVacationPeriods(cu.uid, admDate);
  } catch (e) {
    container.innerHTML = `<p style="color:var(--color-danger);padding:24px;">Erro ao calcular períodos: ${esc(e.message)}</p>`;
    return;
  }

  paint();
  // Real-time pra solicitações
  _unsubVacations = subscribeVacationRequests(() => paint());

  async function paint() {
    const requests = await fetchVacationRequests(isMgr ? null : cu.uid);
    const myRequests = requests.filter(r => r.userId === cu.uid);
    const balance = computeBalance(periods, myRequests);

    const pendingOthers = isMgr ? requests.filter(r => r.status === 'pending') : [];

    container.innerHTML = `
      <!-- Header com saldo -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:24px;">
        <div class="card" style="padding:14px 16px;background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.3);">
          <div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;">Disponível</div>
          <div style="font-size:1.75rem;font-weight:700;color:#22C55E;">${balance.available}</div>
          <div style="font-size:0.6875rem;color:var(--text-muted);">dias para usar</div>
        </div>
        <div class="card" style="padding:14px 16px;">
          <div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;">Total adquirido</div>
          <div style="font-size:1.75rem;font-weight:700;color:var(--text-primary);">${balance.entitled}</div>
          <div style="font-size:0.6875rem;color:var(--text-muted);">dias (não expirados)</div>
        </div>
        <div class="card" style="padding:14px 16px;">
          <div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;">Já gozado</div>
          <div style="font-size:1.75rem;font-weight:700;color:var(--text-secondary);">${balance.used}</div>
          <div style="font-size:0.6875rem;color:var(--text-muted);">dias usufruídos</div>
        </div>
        ${balance.abono > 0 ? `<div class="card" style="padding:14px 16px;">
          <div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;">Abono pago</div>
          <div style="font-size:1.75rem;font-weight:700;color:#A78BFA;">${balance.abono}</div>
          <div style="font-size:0.6875rem;color:var(--text-muted);">dias convertidos em $</div>
        </div>`:''}
        ${balance.pending > 0 ? `<div class="card" style="padding:14px 16px;background:rgba(245,158,11,0.06);">
          <div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;">Em aprovação</div>
          <div style="font-size:1.75rem;font-weight:700;color:#F59E0B;">${balance.pending}</div>
          <div style="font-size:0.6875rem;color:var(--text-muted);">dias aguardando</div>
        </div>`:''}
      </div>

      <div style="display:flex;justify-content:flex-end;margin-bottom:14px;">
        <button class="btn btn-primary" id="vac-new" ${balance.available <= 0 ? 'disabled' : ''}>
          + Solicitar férias
        </button>
      </div>

      <!-- Períodos aquisitivos -->
      <div class="card" style="margin-bottom:24px;">
        <div class="card-header">
          <div class="card-title">📅 Períodos aquisitivos</div>
          <div class="card-subtitle" style="font-size:0.75rem;color:var(--text-muted);">
            Admissão: ${fmtDate(new Date(admDate))} · Cada período = 12 meses, 30 dias de direito
          </div>
        </div>
        <div class="card-body" style="padding:0;">
          <table class="data-table" style="width:100%;font-size:0.8125rem;">
            <thead><tr>
              <th>Período</th><th>Status</th>
              <th style="text-align:right;">Dias</th>
              <th style="text-align:right;">Usados</th>
              <th style="text-align:right;">Abono</th>
              <th style="text-align:right;">Saldo</th>
              <th>Limite p/ usar</th>
            </tr></thead>
            <tbody>${periods.map(p => {
              const ps = p.periodStart?.toDate ? p.periodStart.toDate() : new Date(p.periodStart);
              const pe = p.periodEnd?.toDate ? p.periodEnd.toDate() : new Date(p.periodEnd);
              const dl = p.deadlineAt?.toDate ? p.deadlineAt.toDate() : new Date(p.deadlineAt);
              const saldo = (p.entitledDays||0) - (p.daysUsed||0) - (p.abonoDays||0);
              const statusBadge = {
                inProgress: '<span style="color:#38BDF8;">⏳ Em aquisição</span>',
                available:  '<span style="color:#22C55E;font-weight:600;">✅ Disponível</span>',
                expired:    '<span style="color:#EF4444;">❌ Expirado</span>',
              }[p.status] || p.status;
              return `<tr ${p.status==='expired'?'style="opacity:0.55;"':''}>
                <td>${fmtDate(ps)} → ${fmtDate(pe)}</td>
                <td>${statusBadge}</td>
                <td style="text-align:right;">${p.entitledDays||0}</td>
                <td style="text-align:right;">${p.daysUsed||0}</td>
                <td style="text-align:right;color:#A78BFA;">${p.abonoDays||0}</td>
                <td style="text-align:right;font-weight:600;color:${saldo>0?'#22C55E':'var(--text-muted)'};">${saldo}</td>
                <td style="font-size:0.75rem;color:${p.status==='expired'?'#EF4444':'var(--text-muted)'};">${fmtDate(dl)}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>

      <!-- Minhas solicitações -->
      <div class="card" style="margin-bottom:24px;">
        <div class="card-header">
          <div class="card-title">📝 Minhas solicitações de férias</div>
        </div>
        <div class="card-body" style="padding:0;">
          ${!myRequests.length ? `<div class="empty-state" style="padding:24px;">
            <div class="empty-state-title" style="font-size:0.875rem;">Nenhuma solicitação até agora.</div>
          </div>` : `<table class="data-table" style="width:100%;font-size:0.8125rem;">
            <thead><tr>
              <th>Período</th><th>Dias</th><th>Abono</th>
              <th>Status</th><th>Decisão</th><th></th>
            </tr></thead>
            <tbody>${myRequests.map(r => {
              const sd = r.startDate?.toDate ? r.startDate.toDate() : new Date(r.startDate);
              const ed = r.endDate?.toDate ? r.endDate.toDate() : new Date(r.endDate);
              const status = {
                pending:  '<span style="color:#F59E0B;font-weight:600;">⏳ Pendente</span>',
                approved: '<span style="color:#22C55E;font-weight:600;">✅ Aprovado</span>',
                rejected: '<span style="color:#EF4444;font-weight:600;">❌ Rejeitado</span>',
              }[r.status] || r.status;
              const decision = r.decidedByName
                ? `por <strong>${esc(r.decidedByName)}</strong>${r.decideReason?': "'+esc(r.decideReason)+'"':''}`
                : '—';
              return `<tr>
                <td>${fmtDate(sd)} → ${fmtDate(ed)}</td>
                <td><strong>${r.days}d</strong></td>
                <td>${r.abonoDays||0}d</td>
                <td>${status}</td>
                <td style="font-size:0.75rem;color:var(--text-muted);">${decision}</td>
                <td style="text-align:right;">
                  ${r.status==='pending' ? `<button class="btn btn-ghost btn-sm vac-cancel" data-id="${r.id}">✕ Cancelar</button>` : ''}
                </td>
              </tr>`;
            }).join('')}</tbody>
          </table>`}
        </div>
      </div>

      ${isMgr ? `
        <!-- Aprovações pendentes -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">✋ Solicitações pendentes da equipe
              ${pendingOthers.length ? `<span style="background:#EF4444;color:white;border-radius:10px;padding:1px 8px;font-size:0.6875rem;margin-left:6px;">${pendingOthers.length}</span>` : ''}
            </div>
          </div>
          <div class="card-body" style="padding:0;">
            ${!pendingOthers.length ? `<div class="empty-state" style="padding:24px;">
              <div class="empty-state-title" style="font-size:0.875rem;">Nenhuma solicitação pendente.</div>
            </div>` : `<table class="data-table" style="width:100%;font-size:0.8125rem;">
              <thead><tr>
                <th>Colaborador</th><th>Setor</th><th>Período</th>
                <th>Dias</th><th>Abono</th><th>Justificativa</th>
                <th style="text-align:right;">Ações</th>
              </tr></thead>
              <tbody>${pendingOthers.filter(r=>r.userId !== cu.uid).map(r => {
                const sd = r.startDate?.toDate ? r.startDate.toDate() : new Date(r.startDate);
                const ed = r.endDate?.toDate ? r.endDate.toDate() : new Date(r.endDate);
                return `<tr>
                  <td><strong>${esc(r.userName)}</strong></td>
                  <td>${esc(r.sector||'')}</td>
                  <td>${fmtDate(sd)} → ${fmtDate(ed)}</td>
                  <td>${r.days}d</td>
                  <td>${r.abonoDays||0}d</td>
                  <td style="max-width:240px;font-size:0.75rem;">${esc(r.reason||'')}</td>
                  <td style="text-align:right;white-space:nowrap;">
                    <button class="btn btn-primary btn-sm vac-appr-ok" data-id="${r.id}">✓ Aprovar</button>
                    <button class="btn btn-secondary btn-sm vac-appr-no" data-id="${r.id}">✗ Rejeitar</button>
                  </td>
                </tr>`;
              }).join('')}</tbody>
            </table>`}
          </div>
        </div>
      ` : ''}
    `;

    // Bindings
    document.getElementById('vac-new')?.addEventListener('click', () => {
      openVacationRequestModal({ periods, balance });
    });
    container.querySelectorAll('.vac-cancel').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Cancelar esta solicitação?')) return;
        try {
          await cancelVacationRequest(btn.dataset.id);
          toast.success('Solicitação cancelada.');
        } catch (e) { toast.error(e.message); }
      });
    });
    container.querySelectorAll('.vac-appr-ok').forEach(btn => {
      btn.addEventListener('click', async () => {
        const reason = prompt('Comentário da aprovação (opcional):') ?? null;
        if (reason === null) return;
        btn.disabled = true; btn.textContent = '⏳';
        try {
          await approveVacationRequest(btn.dataset.id, reason);
          toast.success('Férias aprovadas e adicionadas ao calendário.');
        } catch (e) { toast.error(e.message); btn.disabled = false; btn.textContent = '✓ Aprovar'; }
      });
    });
    container.querySelectorAll('.vac-appr-no').forEach(btn => {
      btn.addEventListener('click', async () => {
        const reason = prompt('Motivo da rejeição (obrigatório):');
        if (!reason || reason.trim().length < 3) return toast.error('Motivo obrigatório.');
        btn.disabled = true; btn.textContent = '⏳';
        try {
          await rejectVacationRequest(btn.dataset.id, reason.trim());
          toast.success('Solicitação rejeitada.');
        } catch (e) { toast.error(e.message); btn.disabled = false; btn.textContent = '✗ Rejeitar'; }
      });
    });
  }
}

function openVacationRequestModal({ periods, balance }) {
  const usable = periods.filter(p => p.status !== 'expired' && (p.entitledDays - p.daysUsed - p.abonoDays) > 0);
  if (!usable.length) {
    toast.warning('Você não tem saldo de férias disponível.');
    return;
  }
  const today = new Date().toISOString().slice(0,10);

  modal.open({
    title: '🏖 Solicitar férias',
    size: 'md',
    dedupeKey: 'vac-request',
    content: `
      <div style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:14px;line-height:1.5;">
        Saldo disponível: <strong style="color:#22C55E;">${balance.available} dias</strong>.
        Mínimo por fração: ${MIN_FRACTION_DAYS} dias. Pode dividir em até ${MAX_FRACTIONS} períodos
        (sendo 1 com no mínimo ${MIN_LARGE_FRACTION} dias). Abono pecuniário: até ${MAX_ABONO_DAYS} dias.
      </div>

      <div class="form-group">
        <label class="form-label">Período aquisitivo</label>
        <select class="form-select" id="vac-period">
          ${usable.map(p => {
            const ps = p.periodStart?.toDate ? p.periodStart.toDate() : new Date(p.periodStart);
            const pe = p.periodEnd?.toDate ? p.periodEnd.toDate() : new Date(p.periodEnd);
            const saldo = (p.entitledDays||0) - (p.daysUsed||0) - (p.abonoDays||0);
            return `<option value="${p.id}">
              ${fmtDate(ps)} → ${fmtDate(pe)} · ${saldo} dias disponíveis
            </option>`;
          }).join('')}
        </select>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group">
          <label class="form-label">Início</label>
          <input type="date" class="form-input" id="vac-start" min="${today}" />
        </div>
        <div class="form-group">
          <label class="form-label">Fim</label>
          <input type="date" class="form-input" id="vac-end" min="${today}" />
        </div>
      </div>

      <div id="vac-days-info" style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:12px;"></div>

      <div class="form-group">
        <label class="form-label">Abono pecuniário (dias convertidos em $)</label>
        <input type="number" class="form-input" id="vac-abono" min="0" max="${MAX_ABONO_DAYS}" value="0" />
        <small style="color:var(--text-muted);font-size:0.6875rem;">
          Até ${MAX_ABONO_DAYS} dias podem ser convertidos em remuneração ao invés de descanso.
        </small>
      </div>

      <div class="form-group">
        <label class="form-label">Justificativa / Observações</label>
        <textarea class="form-textarea" id="vac-reason" rows="2" maxlength="500"
          placeholder="Ex: viagem de família planejada"></textarea>
      </div>
    `,
    footer: [
      { label: 'Cancelar', class: 'btn-secondary' },
      {
        label: '📨 Enviar solicitação', class: 'btn-primary', closeOnClick: false,
        onClick: async (_, { close }) => {
          const periodId = document.getElementById('vac-period').value;
          const start    = document.getElementById('vac-start').value;
          const end      = document.getElementById('vac-end').value;
          const abono    = parseInt(document.getElementById('vac-abono').value) || 0;
          const reason   = document.getElementById('vac-reason').value.trim();
          if (!start || !end) return toast.error('Informe início e fim.');
          try {
            await createVacationRequest({ periodId, startDate: start, endDate: end, abonoDays: abono, reason });
            toast.success('Solicitação enviada! Aguarde aprovação do gestor.');
            close();
            loadTab();
          } catch (e) { toast.error(e.message); }
        },
      },
    ],
  });

  // Cálculo de dias dinâmico
  const updateDaysInfo = () => {
    const s = document.getElementById('vac-start').value;
    const e = document.getElementById('vac-end').value;
    const ab = parseInt(document.getElementById('vac-abono').value) || 0;
    const info = document.getElementById('vac-days-info');
    if (!s || !e || !info) return;
    const sd = new Date(s), ed = new Date(e);
    if (ed < sd) { info.innerHTML = '<span style="color:#EF4444;">⚠ Fim deve ser após o início.</span>'; return; }
    const days = Math.round((ed - sd) / 86400000) + 1;
    const total = days + ab;
    const status = days >= MIN_FRACTION_DAYS
      ? (days >= MIN_LARGE_FRACTION ? '✅ Período válido (>= 14 dias).' : `⚠ Período < ${MIN_LARGE_FRACTION} dias — só permitido se outro período for >= ${MIN_LARGE_FRACTION}.`)
      : `❌ Mínimo ${MIN_FRACTION_DAYS} dias.`;
    info.innerHTML = `📅 <strong>${days}</strong> dias de descanso${ab?` + <strong>${ab}</strong> dias de abono = <strong>${total}</strong> dias do saldo`:''}. ${status}`;
  };
  setTimeout(() => {
    document.getElementById('vac-start')?.addEventListener('change', updateDaysInfo);
    document.getElementById('vac-end')?.addEventListener('change', updateDaysInfo);
    document.getElementById('vac-abono')?.addEventListener('input', updateDaysInfo);
  }, 80);
}
