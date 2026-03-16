/**
 * PRIMETOUR — Capacity Page (Fase 2)
 * Gestão de férias, ausências e disponibilidade da equipe
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import {
  createAbsence, updateAbsence, deleteAbsence,
  fetchUserAbsences, fetchAllAbsences,
  getTeamAvailability, isUserAvailable,
  ABSENCE_TYPES,
} from '../services/capacity.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' }).format(d);
}

function toISO(ts) {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toISOString().slice(0,10);
}

let allAbsences  = [];
let activeTab    = 'mine'; // 'mine' | 'team'

/* ─── Render ─────────────────────────────────────────────── */
export async function renderCapacity(container) {
  const canViewAll = store.can('system_manage_users') || store.can('system_view_all');

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Capacidade</h1>
        <p class="page-subtitle">Férias, ausências e disponibilidade da equipe</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary" id="new-absence-btn">+ Registrar ausência</button>
      </div>
    </div>

    <!-- Tabs -->
    <div style="display:flex;gap:8px;margin-bottom:24px;">
      <button class="btn ${activeTab==='mine'?'btn-primary':'btn-secondary'} btn-sm" id="tab-mine">
        Minhas ausências
      </button>
      ${canViewAll ? `
        <button class="btn ${activeTab==='team'?'btn-primary':'btn-secondary'} btn-sm" id="tab-team">
          Disponibilidade da equipe
        </button>
      ` : ''}
    </div>

    <div id="capacity-content">
      <div class="card skeleton" style="height:300px;"></div>
    </div>
  `;

  document.getElementById('new-absence-btn')?.addEventListener('click', () => openAbsenceModal());
  document.getElementById('tab-mine')?.addEventListener('click', () => switchTab('mine'));
  document.getElementById('tab-team')?.addEventListener('click', () => switchTab('team'));

  await loadAndRender();
}

async function loadAndRender() {
  try {
    const uid = store.get('currentUser').uid;
    if (activeTab === 'mine') {
      allAbsences = await fetchUserAbsences(uid);
    } else {
      allAbsences = await fetchAllAbsences();
    }
    renderContent();
  } catch(e) {
    toast.error('Erro ao carregar ausências: ' + e.message);
  }
}

function switchTab(tab) {
  activeTab = tab;
  // Update button styles
  document.getElementById('tab-mine')?.classList.toggle('btn-primary', tab==='mine');
  document.getElementById('tab-mine')?.classList.toggle('btn-secondary', tab!=='mine');
  document.getElementById('tab-team')?.classList.toggle('btn-primary', tab==='team');
  document.getElementById('tab-team')?.classList.toggle('btn-secondary', tab!=='team');
  loadAndRender();
}

/* ─── Render content ─────────────────────────────────────── */
function renderContent() {
  const el = document.getElementById('capacity-content');
  if (!el) return;

  if (activeTab === 'mine') renderMyAbsences(el);
  else renderTeamAvailability(el);
}

function renderMyAbsences(container) {
  const uid = store.get('currentUser').uid;

  if (!allAbsences.length) {
    container.innerHTML = `
      <div class="empty-state" style="min-height:40vh;">
        <div class="empty-state-icon">🏖</div>
        <div class="empty-state-title">Nenhuma ausência registrada</div>
        <p class="text-sm text-muted">Registre férias, licenças e outros afastamentos.</p>
        <button class="btn btn-primary mt-4" id="empty-new-absence">+ Registrar ausência</button>
      </div>`;
    document.getElementById('empty-new-absence')?.addEventListener('click', () => openAbsenceModal());
    return;
  }

  // Group by year
  const now   = new Date();
  const upcoming = allAbsences.filter(a => {
    const end = a.endDate?.toDate ? a.endDate.toDate() : new Date(a.endDate);
    return end >= now;
  });
  const past = allAbsences.filter(a => {
    const end = a.endDate?.toDate ? a.endDate.toDate() : new Date(a.endDate);
    return end < now;
  });

  container.innerHTML = `
    ${upcoming.length ? `
      <div class="card" style="margin-bottom:20px;">
        <div class="card-header">
          <div class="card-title">📅 Próximas ausências</div>
        </div>
        <div class="card-body" style="padding:0;">
          ${renderAbsenceTable(upcoming, uid, true)}
        </div>
      </div>
    ` : ''}
    ${past.length ? `
      <div class="card">
        <div class="card-header">
          <div class="card-title">◌ Histórico</div>
        </div>
        <div class="card-body" style="padding:0;">
          ${renderAbsenceTable(past, uid, false)}
        </div>
      </div>
    ` : ''}
  `;

  // Bind events
  container.querySelectorAll('.absence-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = allAbsences.find(x => x.id === btn.dataset.id);
      if (a) openAbsenceModal(a);
    });
  });
  container.querySelectorAll('.absence-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => confirmDelete(btn.dataset.id));
  });
}

function renderAbsenceTable(absences, uid, showActions) {
  return `
    <div class="data-table-wrapper">
      <table class="data-table">
        <thead><tr>
          <th>Tipo</th><th>Início</th><th>Fim</th><th>Duração</th><th>Observação</th>
          ${showActions ? '<th class="col-actions">Ações</th>' : ''}
        </tr></thead>
        <tbody>
          ${absences.map(a => {
            const typeDef = ABSENCE_TYPES.find(t => t.value === a.type) || ABSENCE_TYPES[5];
            const start   = a.startDate?.toDate ? a.startDate.toDate() : new Date(a.startDate);
            const end     = a.endDate?.toDate   ? a.endDate.toDate()   : new Date(a.endDate);
            const days    = Math.ceil((end - start) / (1000*60*60*24)) + 1;
            const canEdit = a.createdBy === uid || store.can('system_manage_users');
            return `
              <tr>
                <td>
                  <span style="display:inline-flex;align-items:center;gap:6px;">
                    <span style="font-size:1rem;">${typeDef.icon}</span>
                    <span class="badge" style="background:${typeDef.color}22;color:${typeDef.color};border:1px solid ${typeDef.color}44;">
                      ${typeDef.label}
                    </span>
                  </span>
                </td>
                <td>${fmtDate(a.startDate)}</td>
                <td>${fmtDate(a.endDate)}</td>
                <td style="color:var(--text-muted);">${days} dia${days!==1?'s':''}</td>
                <td style="color:var(--text-muted);font-size:0.8125rem;">${esc(a.note||'—')}</td>
                ${showActions && canEdit ? `
                  <td class="col-actions">
                    <div class="actions-group">
                      <button class="btn btn-ghost btn-icon btn-sm absence-edit-btn" data-id="${a.id}" title="Editar">✎</button>
                      <button class="btn btn-ghost btn-icon btn-sm absence-delete-btn" data-id="${a.id}" title="Excluir" style="color:var(--color-danger);">✕</button>
                    </div>
                  </td>
                ` : showActions ? '<td></td>' : ''}
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/* ─── Team availability view ─────────────────────────────── */
async function renderTeamAvailability(container) {
  container.innerHTML = `<div class="chart-loading"><div class="chart-loading-spinner"></div>Carregando disponibilidade...</div>`;

  try {
    const users   = store.get('users') || [];
    const now     = new Date();
    const start   = new Date(now.getFullYear(), now.getMonth(), 1);
    const end     = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const team    = await getTeamAvailability(users.filter(u=>u.active).map(u=>u.id), start, end);

    // Calendar grid for current month
    const days = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
      days.push(new Date(d));
    }

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:200px 1fr;gap:20px;align-items:start;">

        <!-- Team list with availability bars -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">📊 Disponibilidade — ${new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(now)}</div>
          </div>
          <div class="card-body" style="padding:8px 0;">
            ${team.map(u => `
              <div style="padding:8px 16px;border-bottom:1px solid var(--border-subtle);">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                  <div class="avatar avatar-sm" style="background:${u.avatarColor};flex-shrink:0;">
                    ${u.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()}
                  </div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:0.8125rem;font-weight:500;color:var(--text-primary);
                      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(u.name)}</div>
                    <div style="font-size:0.6875rem;color:var(--text-muted);">${u.available}/${u.total} dias</div>
                  </div>
                  <span style="font-size:0.8125rem;font-weight:700;
                    color:${u.rate>=80?'#22C55E':u.rate>=50?'#F59E0B':'#EF4444'};">
                    ${u.rate}%
                  </span>
                </div>
                <div style="height:4px;background:var(--bg-elevated);border-radius:2px;overflow:hidden;">
                  <div style="height:100%;width:${u.rate}%;
                    background:${u.rate>=80?'#22C55E':u.rate>=50?'#F59E0B':'#EF4444'};
                    border-radius:2px;transition:width 0.5s;"></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Calendar heatmap -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">📅 Calendário de ausências</div>
          </div>
          <div class="card-body" style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:0.75rem;">
              <thead>
                <tr>
                  <th style="padding:4px 8px;text-align:left;color:var(--text-muted);width:120px;">Membro</th>
                  ${days.map(d => {
                    const dow = d.getDay();
                    const isWeekend = dow===0||dow===6;
                    return `<th style="padding:4px 2px;text-align:center;
                      color:${isWeekend?'var(--border-default)':'var(--text-muted)'};
                      min-width:28px;">
                      ${d.getDate()}
                    </th>`;
                  }).join('')}
                </tr>
              </thead>
              <tbody>
                ${team.map(u => `
                  <tr>
                    <td style="padding:3px 8px;font-size:0.75rem;color:var(--text-secondary);
                      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px;">
                      ${esc(u.name.split(' ')[0])}
                    </td>
                    ${days.map(d => {
                      const dow     = d.getDay();
                      const weekend = dow===0||dow===6;
                      const absence = u.absences.find(a => {
                        const s = a.startDate?.toDate ? a.startDate.toDate() : new Date(a.startDate);
                        const e = a.endDate?.toDate   ? a.endDate.toDate()   : new Date(a.endDate);
                        s.setHours(0,0,0,0); e.setHours(23,59,59,999);
                        const dd = new Date(d); dd.setHours(12);
                        return dd>=s && dd<=e;
                      });
                      const typeDef = absence ? (ABSENCE_TYPES.find(t=>t.value===absence.type)||ABSENCE_TYPES[5]) : null;
                      return `<td style="padding:3px 2px;text-align:center;">
                        <div style="width:24px;height:24px;border-radius:4px;margin:0 auto;
                          display:flex;align-items:center;justify-content:center;
                          font-size:0.75rem;
                          background:${absence?typeDef.color+'33':weekend?'var(--bg-elevated)':'transparent'};
                          color:${absence?typeDef.color:'var(--text-muted)'};
                          border:1px solid ${absence?typeDef.color+'55':'transparent'};"
                          title="${absence?typeDef.label:weekend?'Fim de semana':'Disponível'}">
                          ${absence?typeDef.icon:weekend?'—':''}
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
            <div style="width:14px;height:14px;border-radius:3px;background:${t.color}33;
              border:1px solid ${t.color}55;display:flex;align-items:center;justify-content:center;
              font-size:0.625rem;">${t.icon}</div>
            ${t.label}
          </div>
        `).join('')}
      </div>
    `;
  } catch(e) {
    container.innerHTML = `<p style="color:var(--color-danger);">Erro ao carregar disponibilidade: ${esc(e.message)}</p>`;
  }
}

/* ─── Modal: criar / editar ausência ─────────────────────── */
function openAbsenceModal(absence = null) {
  const isEdit  = !!absence;
  const users   = store.get('users') || [];
  const uid     = store.get('currentUser').uid;
  const canManageOthers = store.can('system_manage_users');

  modal.open({
    title:   isEdit ? 'Editar ausência' : 'Registrar ausência',
    size:    'sm',
    content: `
      <div style="display:flex;flex-direction:column;gap:14px;">
        ${canManageOthers ? `
          <div class="form-group">
            <label class="form-label">Usuário</label>
            <select class="form-select" id="ab-user">
              ${users.filter(u=>u.active).map(u =>
                `<option value="${u.id}" ${(absence?.userId||uid)===u.id?'selected':''}>${esc(u.name)}</option>`
              ).join('')}
            </select>
          </div>
        ` : ''}
        <div class="form-group">
          <label class="form-label">Tipo de ausência *</label>
          <select class="form-select" id="ab-type">
            ${ABSENCE_TYPES.map(t =>
              `<option value="${t.value}" ${absence?.type===t.value?'selected':''}>${t.icon} ${t.label}</option>`
            ).join('')}
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">Data de início *</label>
            <input type="date" class="form-input" id="ab-start"
              value="${absence ? toISO(absence.startDate) : ''}" />
          </div>
          <div class="form-group">
            <label class="form-label">Data de fim *</label>
            <input type="date" class="form-input" id="ab-end"
              value="${absence ? toISO(absence.endDate) : ''}" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Observação</label>
          <input type="text" class="form-input" id="ab-note"
            value="${esc(absence?.note||'')}" maxlength="200"
            placeholder="Ex: Férias de verão, consulta médica..." />
        </div>
      </div>
    `,
    footer: [
      { label:'Cancelar', class:'btn-secondary', closeOnClick:true },
      {
        label: isEdit ? 'Salvar' : 'Registrar',
        class: 'btn-primary', closeOnClick: false,
        onClick: async (_, { close }) => {
          const type      = document.getElementById('ab-type')?.value;
          const startVal  = document.getElementById('ab-start')?.value;
          const endVal    = document.getElementById('ab-end')?.value;
          const userId    = document.getElementById('ab-user')?.value || uid;
          const note      = document.getElementById('ab-note')?.value?.trim() || '';

          if (!startVal || !endVal) { toast.warning('Datas são obrigatórias.'); return; }

          const btn = document.querySelector('.modal-footer .btn-primary');
          if(btn){ btn.classList.add('loading'); btn.disabled=true; }
          try {
            if (isEdit) {
              await updateAbsence(absence.id, {
                type, note,
                startDate: new Date(startVal + 'T00:00:00'),
                endDate:   new Date(endVal   + 'T23:59:59'),
              });
              toast.success('Ausência atualizada.');
            } else {
              await createAbsence({
                userId, type, note,
                startDate: new Date(startVal + 'T00:00:00'),
                endDate:   new Date(endVal   + 'T23:59:59'),
              });
              toast.success('Ausência registrada.');
            }
            close();
            await loadAndRender();
          } catch(e) { toast.error(e.message); }
          finally { if(btn){ btn.classList.remove('loading'); btn.disabled=false; } }
        },
      },
    ],
  });
}

async function confirmDelete(absenceId) {
  const ok = await modal.confirm({
    title:'Remover ausência', message:'Remover este registro de ausência?',
    confirmText:'Remover', danger:true, icon:'✕',
  });
  if (!ok) return;
  try {
    await deleteAbsence(absenceId);
    toast.success('Ausência removida.');
    await loadAndRender();
  } catch(e) { toast.error(e.message); }
}
