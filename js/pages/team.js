/**
 * PRIMETOUR — Team Page (Fase 2 revisado)
 * Membros da equipe + Capacidade (férias/ausências) unificados
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import {
  createAbsence, updateAbsence, deleteAbsence,
  fetchUserAbsences, fetchAllAbsences,
  getTeamAvailability, ABSENCE_TYPES,
} from '../services/capacity.js';
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
      const { collection, getDocs, query, orderBy } =
        await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const { db } = await import('../firebase.js');
      const snap = await getDocs(query(collection(db, 'users'), orderBy('name', 'asc')));
      store.set('users', snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch(e) { console.warn('Erro ao carregar usuários:', e.message); }
  }

  const users      = store.get('users') || [];
  const workspaces = store.get('userWorkspaces') || [];
  const canViewAll = store.can('system_manage_users') || store.can('system_view_all');

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
    <div style="display:flex;gap:0;margin-bottom:24px;border-bottom:1px solid var(--border-subtle);">
      ${[
        { id:'capacity', label:'Disponibilidade',   icon:'◐' },
        { id:'mine',     label:'Minhas ausências',  icon:'◌' },
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
              ${initials}
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
      const days    = Math.ceil((end - start) / (1000*60*60*24)) + 1;
      const canEdit = a.createdBy === uid || store.can('system_manage_users');
      return `<tr>
        <td><span style="display:inline-flex;align-items:center;gap:6px;">
          <span>${typeDef.icon}</span>
          <span class="badge" style="background:${typeDef.color}22;color:${typeDef.color};border:1px solid ${typeDef.color}44;">
            ${typeDef.label}
          </span>
        </span></td>
        <td>${fmtDate(a.startDate)}</td>
        <td>${fmtDate(a.endDate)}</td>
        <td style="color:var(--text-muted);">${days} dia${days!==1?'s':''}</td>
        <td style="color:var(--text-muted);font-size:0.8125rem;">${esc(a.note||'—')}</td>
        ${showActions && canEdit ? `<td class="col-actions"><div class="actions-group">
          <button class="btn btn-ghost btn-icon btn-sm absence-edit-btn" data-id="${a.id}" title="Editar">✎</button>
          <button class="btn btn-ghost btn-icon btn-sm absence-delete-btn" data-id="${a.id}" title="Excluir" style="color:var(--color-danger);">✕</button>
        </div></td>` : showActions ? '<td></td>' : ''}
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

/* ─── Tab: Disponibilidade da equipe ─────────────────────── */
async function renderTeamAvailability(container) {
  const users = (store.get('users') || []).filter(u => u.active !== false);
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const team  = await getTeamAvailability(users.map(u => u.id), start, end);
  const days  = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) days.push(new Date(d));

  const DAYS_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const monthLabel = new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(now);

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:220px 1fr;gap:20px;align-items:start;">
      <!-- Availability bars -->
      <div class="card">
        <div class="card-header"><div class="card-title">◐ ${monthLabel}</div></div>
        <div class="card-body" style="padding:8px 0;">
          ${team.map(u => `
            <div style="padding:8px 16px;border-bottom:1px solid var(--border-subtle);">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
                <div class="avatar avatar-sm" style="background:${u.avatarColor};flex-shrink:0;">
                  ${u.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()}
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
                    return `<td style="padding:2px 1px;text-align:center;">
                      <div style="width:22px;height:22px;border-radius:3px;margin:0 auto;
                        display:flex;align-items:center;justify-content:center;font-size:0.625rem;
                        background:${ab?td.color+'33':isWe?'var(--bg-elevated)':'transparent'};
                        color:${ab?td.color:'var(--text-muted)'};
                        border:1px solid ${ab?td.color+'55':'transparent'};"
                        title="${ab?td.label:isWe?'Fim de semana':'Disponível'}">
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
}

/* ─── Modal ausência ─────────────────────────────────────── */
async function openAbsenceModal(absence = null) {
  const isEdit  = !!absence;
  let users     = (store.get('users') || []).filter(u => u.active !== false);

  // Se store de users estiver vazio, carregar do Firestore
  if (!users.length) {
    try {
      const { collection, getDocs, query, orderBy } =
        await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const { db } = await import('../firebase.js');
      const snap = await getDocs(query(collection(db, 'users'), orderBy('name', 'asc')));
      const all  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      store.set('users', all);
      users = all.filter(u => u.active !== false);
    } catch(e) { console.warn('Erro ao carregar usuários:', e.message); }
  }

  const uid     = store.get('currentUser').uid;
  const canMgr  = store.can('system_manage_users');

  modal.open({
    title:   isEdit ? 'Editar ausência' : 'Registrar ausência',
    size:    'sm',
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
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">Início *</label>
            <input type="date" class="form-input" id="ab-start" value="${absence ? toISO(absence.startDate) : ''}" />
          </div>
          <div class="form-group">
            <label class="form-label">Fim *</label>
            <input type="date" class="form-input" id="ab-end" value="${absence ? toISO(absence.endDate) : ''}" />
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
          const endVal   = document.getElementById('ab-end')?.value;
          if (!startVal || !endVal) { toast.warning('Datas são obrigatórias.'); return; }
          const userId   = document.getElementById('ab-user')?.value || uid;
          const btn = document.querySelector('.modal-footer .btn-primary');
          if(btn){ btn.classList.add('loading'); btn.disabled=true; }
          try {
            const data = {
              type:      document.getElementById('ab-type')?.value,
              note:      document.getElementById('ab-note')?.value?.trim() || '',
              startDate: new Date(startVal + 'T00:00:00'),
              endDate:   new Date(endVal   + 'T23:59:59'),
            };
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
