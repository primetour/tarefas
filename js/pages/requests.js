/**
 * PRIMETOUR — Requests Page
 * Triagem: Aceitar (converter) ou Recusar (com motivo + e-mail)
 * Sem status "em análise"
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import { openTaskModal } from '../components/taskModal.js';
import {
  fetchRequests, subscribeRequests,
  updateRequestStatus, convertToTask,
  notifyRequesterRejected, deleteRequest,
  REQUEST_STATUSES, REQUEST_STATUS_MAP,
} from '../services/requests.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);
}

function fmtDateOnly(ts) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}).format(d);
}

let allRequests  = [];
let unsubscribe  = null;
let filterStatus = '';
let filterSector = '';

/* ─── Render ─────────────────────────────────────────────── */
export function destroyRequests() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}

export async function renderRequests(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Solicitações</h1>
        <p class="page-subtitle">Demandas recebidas pelo portal público</p>
      </div>
      <div class="page-header-actions">
        ${(() => {
          const sectors = store.getVisibleSectors();
          if (sectors === null || sectors.length > 1) {
            const opts = (sectors || ['BTG','C&P','Célula ICs','Centurion','CEP','Concierge Bradesco','Contabilidade','Diretoria','Eventos','Financeiro','Lazer','Marketing','Operadora','Programa ICs','Projetos','PTS Bradesco','Qualidade','Suppliers','TI'])
              .map(s=>`<option value="${esc(s)}" ${filterSector===s?'selected':''}>${esc(s)}</option>`).join('');
            return `<select class="filter-select" id="req-sector-filter" style="min-width:150px;">
              <option value="">Todos os setores</option>${opts}</select>`;
          }
          return sectors.length === 1
            ? `<span style="font-size:0.8125rem;padding:6px 12px;border-radius:var(--radius-md);background:rgba(212,168,67,.1);color:var(--brand-gold);border:1px solid rgba(212,168,67,.3);">🏢 ${esc(sectors[0])}</span>`
            : '';
        })()}
        <a href="solicitar.html" target="_blank" rel="noopener"
          class="btn btn-secondary btn-sm" style="display:flex;align-items:center;gap:6px;">
          ↗ Abrir portal
        </a>
      </div>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
      <button class="btn btn-ghost btn-sm req-filter-btn ${filterStatus===''?'active':''}" data-status="">
        Todas
      </button>
      ${REQUEST_STATUSES.map(s=>`
        <button class="btn btn-ghost btn-sm req-filter-btn ${filterStatus===s.value?'active':''}"
          data-status="${s.value}" style="color:${s.color};">
          ${s.icon} ${s.label}
        </button>
      `).join('')}
    </div>

    <div id="requests-list">
      <div class="empty-state"><div class="empty-state-icon">⟳</div></div>
    </div>
  `;

  container.querySelectorAll('.req-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      filterStatus = btn.dataset.status;
      renderList();
      container.querySelectorAll('.req-filter-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.status === filterStatus)
      );
    });
  });

  if (unsubscribe) unsubscribe();
  unsubscribe = subscribeRequests(reqs => {
    allRequests = reqs;
    renderList();
  });
}

function renderList() {
  const list = document.getElementById('requests-list');
  if (!list) return;

  let filtered = filterStatus
    ? allRequests.filter(r => r.status === filterStatus)
    : allRequests;

  // Apply sector filter
  const autoSectors = store.getVisibleSectors();
  if (!filterSector && autoSectors !== null && autoSectors.length === 1) {
    filtered = filtered.filter(r => !r.sector || autoSectors.includes(r.sector));
  } else if (filterSector) {
    filtered = filtered.filter(r => !r.sector || r.sector === filterSector);
  } else if (autoSectors !== null && autoSectors.length > 1) {
    filtered = filtered.filter(r => !r.sector || autoSectors.includes(r.sector));
  }

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">◌</div>
      <div class="empty-state-title">Nenhuma solicitação${filterStatus?' com este status':''}</div>
    </div>`;
    return;
  }

  list.innerHTML = filtered.map(req => {
    const statusInfo = REQUEST_STATUS_MAP[req.status] || REQUEST_STATUS_MAP.pending;
    const urgent = req.urgency;
    const outOfCal = req.outOfCalendar;

    return `
      <div class="card req-card" data-id="${req.id}" style="
        margin-bottom:10px;cursor:pointer;
        border-left:3px solid ${statusInfo.color};
        ${urgent?'background:rgba(239,68,68,0.04);':''}">
        <div class="card-body" style="padding:14px 16px;">
          <div style="display:flex;align-items:flex-start;gap:12px;">
            <div style="flex:1;min-width:0;">
              ${req.title?`<div style="font-weight:600;font-size:0.9375rem;color:var(--text-primary);margin-bottom:2px;">${esc(req.title)}</div>`:''}
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                <span style="font-weight:${req.title?'400':'600'};color:var(--text-${req.title?'secondary':'primary'});font-size:${req.title?'0.8125rem':'inherit'};">${esc(req.requesterName)}</span>
                <span style="font-size:0.75rem;color:var(--text-muted);">${esc(req.requesterEmail)}</span>
                ${urgent?`<span style="font-size:0.6875rem;padding:1px 6px;border-radius:var(--radius-full);
                  background:rgba(239,68,68,0.15);color:#EF4444;">🔴 Urgente</span>`:''}
                ${outOfCal?`<span style="font-size:0.6875rem;padding:1px 6px;border-radius:var(--radius-full);
                  background:rgba(56,189,248,0.12);color:#38BDF8;">📅 Fora do calendário</span>`:''}
                ${req.batchId?`<span style="font-size:0.6875rem;padding:1px 6px;border-radius:var(--radius-full);
                  background:rgba(167,139,250,0.12);color:#A78BFA;">📦 Lote ${(req.batchIndex||0)+1}/${req.batchTotal||'?'}</span>`:''}
              </div>
              <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:0.8125rem;color:var(--text-secondary);margin-bottom:6px;">
                ${req.typeName?`<span>📋 ${esc(req.typeName)}</span>`:''}
                ${req.variationName?`<span>🔀 ${esc(req.variationName)}</span>`:''}
                ${req.requestingArea?`<span>📍 ${esc(req.requestingArea)}</span>`:''}
                ${req.sector?`<span>🏢 ${esc(req.sector)}</span>`:''}
                ${req.nucleo?`<span>◈ ${esc(req.nucleo)}</span>`:''}
              </div>
              <div style="font-size:0.8125rem;color:var(--text-muted);
                overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:600px;">
                ${esc((req.description||'').slice(0,120))}${(req.description||'').length>120?'…':''}
              </div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">
              <span style="font-size:0.75rem;padding:2px 8px;border-radius:var(--radius-full);
                background:${statusInfo.color}18;color:${statusInfo.color};">
                ${statusInfo.icon} ${statusInfo.label}
              </span>
              <span style="font-size:0.6875rem;color:var(--text-muted);">
                ${fmtDate(req.createdAt)}
              </span>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.req-card').forEach(card => {
    card.addEventListener('click', () => {
      const req = allRequests.find(r => r.id === card.dataset.id);
      if (req) openRequestDetail(req);
    });
  });
}

/* ─── Detail modal ───────────────────────────────────────── */
async function openRequestDetail(req) {
  const workspaces = store.get('userWorkspaces') || [];
  const statusInfo = REQUEST_STATUS_MAP[req.status] || REQUEST_STATUS_MAP.pending;

  modal.open({
    title:  `Solicitação — ${req.typeName || 'Demanda'}`,
    size:   'lg',
    content: `
      <div style="display:flex;flex-direction:column;gap:14px;">

        <!-- Status badge -->
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="padding:3px 12px;border-radius:var(--radius-full);font-size:0.8125rem;
            background:${statusInfo.color}18;color:${statusInfo.color};font-weight:600;">
            ${statusInfo.icon} ${statusInfo.label}
          </span>
          ${req.urgency?`<span style="padding:3px 10px;border-radius:var(--radius-full);
            font-size:0.8125rem;background:rgba(239,68,68,0.12);color:#EF4444;">🔴 Urgente</span>`:''}
          ${req.outOfCalendar?`<span style="padding:3px 10px;border-radius:var(--radius-full);
            font-size:0.8125rem;background:rgba(56,189,248,0.12);color:#38BDF8;">📅 Fora do calendário</span>`:''}
        </div>

        <!-- Requester info -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <div style="font-size:0.6875rem;color:var(--text-muted);margin-bottom:2px;">Solicitante</div>
            <div style="font-size:0.9375rem;font-weight:600;">${esc(req.requesterName)}</div>
            <div style="font-size:0.8125rem;color:var(--text-muted);">${esc(req.requesterEmail)}</div>
          </div>
          <div>
            <div style="font-size:0.6875rem;color:var(--text-muted);margin-bottom:2px;">Área solicitante</div>
            <div style="font-size:0.875rem;">${esc(req.requestingArea||'—')}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);">Recebido: ${fmtDate(req.createdAt)}</div>
          </div>
        </div>

        <!-- Title -->
        ${req.title?`
        <div style="padding:10px 14px;background:var(--bg-surface);border-radius:var(--radius-md);
          border-left:3px solid var(--brand-gold);">
          <div style="font-size:0.6875rem;color:var(--text-muted);margin-bottom:2px;">Título da demanda</div>
          <div style="font-size:1rem;font-weight:600;color:var(--text-primary);">${esc(req.title)}</div>
        </div>
        `:''}

        <!-- Demand info -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;
          padding:12px;background:var(--bg-surface);border-radius:var(--radius-md);">
          <div>
            <div style="font-size:0.6875rem;color:var(--text-muted);margin-bottom:2px;">Setor responsável</div>
            <div style="font-size:0.875rem;">🏢 ${esc(req.sector||'—')}</div>
          </div>
          <div>
            <div style="font-size:0.6875rem;color:var(--text-muted);margin-bottom:2px;">Tipo de demanda</div>
            <div style="font-size:0.875rem;">📋 ${esc(req.typeName||'—')}</div>
          </div>
          <div>
            <div style="font-size:0.6875rem;color:var(--text-muted);margin-bottom:2px;">Variação do material</div>
            <div style="font-size:0.875rem;">🔀 ${esc(req.variationName||'—')}</div>
          </div>
          <div>
            <div style="font-size:0.6875rem;color:var(--text-muted);margin-bottom:2px;">Núcleo</div>
            <div style="font-size:0.875rem;">◈ ${esc(req.nucleo||'—')}</div>
          </div>
          ${req.desiredDate?`<div>
            <div style="font-size:0.6875rem;color:var(--text-muted);margin-bottom:2px;">Data desejada</div>
            <div style="font-size:0.875rem;">📅 ${fmtDateOnly(req.desiredDate)}</div>
          </div>`:''}
        </div>

        <!-- Description -->
        <div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:6px;">Descrição da demanda</div>
          <div style="font-size:0.9375rem;color:var(--text-secondary);line-height:1.7;
            padding:12px;background:var(--bg-surface);border-radius:var(--radius-md);">
            ${esc(req.description)}
          </div>
        </div>

        ${req.status === 'rejected' && req.rejectionReason ? `
          <div style="padding:10px 14px;background:rgba(239,68,68,0.08);
            border:1px solid rgba(239,68,68,0.25);border-radius:var(--radius-md);">
            <div style="font-size:0.6875rem;color:#EF4444;margin-bottom:4px;">Motivo da recusa</div>
            <div style="font-size:0.875rem;color:var(--text-secondary);">${esc(req.rejectionReason)}</div>
          </div>
        ` : ''}

        ${req.status === 'converted' && req.taskId ? `
          <div style="padding:10px 14px;background:rgba(34,197,94,0.08);
            border:1px solid rgba(34,197,94,0.25);border-radius:var(--radius-md);
            font-size:0.875rem;color:#22C55E;">
            ✓ Convertida em tarefa
          </div>
        ` : ''}

        <!-- Internal note -->
        <div class="form-group">
          <label class="form-label">Nota interna (visível só para o time)</label>
          <textarea class="form-textarea" id="req-internal-note" rows="2"
            placeholder="Adicione observações internas...">${esc(req.internalNote||'')}</textarea>
        </div>

        <!-- Squad / Workspace (for conversion) -->
        ${req.status === 'pending' ? `
          <div class="form-group">
            <label class="form-label">
              Squad / Workspace para conversão
              <span style="font-weight:400;color:var(--text-muted);font-size:0.75rem;margin-left:6px;">
                — onde a tarefa gerada será agrupada
              </span>
            </label>
            <select class="form-select" id="req-workspace">
              <option value="" ${!store.get('currentWorkspace')?.id ? 'selected' : ''}>— Sem squad (apenas por setor)</option>
              ${workspaces.map(w => `
                <option value="${w.id}" ${store.get('currentWorkspace')?.id === w.id ? 'selected' : ''}>
                  ${esc(w.icon||'◈')} ${esc(w.name)}${w.multiSector ? ' · multissetor' : ''}
                </option>
              `).join('')}
            </select>
          </div>
        ` : ''}
      </div>
    `,
    footer: [
      { label:'Fechar', class:'btn-secondary', closeOnClick:true },

      // Excluir — admin only
      ...(store.can('system_manage_settings') ? [{
        label: '🗑 Excluir', class: 'btn-secondary btn-sm', closeOnClick: false,
        style: 'color:#EF4444;border-color:#EF4444;margin-right:auto;',
        onClick: async (_, { close }) => {
          if (!confirm(`Deseja excluir permanentemente esta solicitação de ${req.requesterName}?\n\nEssa ação não pode ser desfeita.`)) return;
          try {
            await deleteRequest(req.id);
            toast.success('Solicitação excluída.');
            close();
          } catch(e) { toast.error('Erro ao excluir: ' + e.message); }
        },
      }] : []),

      // Recusar — only when pending
      ...(req.status === 'pending' ? [{
        label: '✕ Recusar', class: 'btn-secondary btn-sm', closeOnClick: false,
        style: 'color:var(--color-danger);border-color:var(--color-danger);',
        onClick: async (_, { close }) => {
          // Ask for rejection reason inline
          const reason = await askRejectionReason();
          if (reason === null) return; // cancelled
          const note = document.getElementById('req-internal-note')?.value || '';
          try {
            await updateRequestStatus(req.id, 'rejected', {
              internalNote:    note,
              rejectionReason: reason,
            });
            // Send email to requester
            await notifyRequesterRejected({
              requesterName:   req.requesterName,
              requesterEmail:  req.requesterEmail,
              typeName:        req.typeName || 'sua demanda',
              rejectionReason: reason,
              requestId:       req.id,
            }).catch(() => {}); // non-blocking
            toast.success('Solicitação recusada. E-mail enviado ao solicitante.');
            close();
          } catch(e) { toast.error(e.message); }
        },
      }] : []),

      // Converter em tarefa — only when pending
      ...(req.status === 'pending' ? [{
        label: '✓ Converter em tarefa', class: 'btn-primary', closeOnClick: false,
        onClick: async (_, { close }) => {
          const wsId = document.getElementById('req-workspace')?.value || null;
          const note = document.getElementById('req-internal-note')?.value || '';
          close();
          openTaskModal({
            typeId: req.typeId || null,
            onSave: async (taskId) => {
              await updateRequestStatus(req.id, 'converted', {
                taskId,
                workspaceId:  wsId,
                internalNote: note,
              }).catch(() => {});
              toast.success('Solicitação convertida em tarefa!');
            },
            taskData: {
              title:          req.title || `[Solicitação] ${req.typeName||'Demanda'} — ${req.requesterName}`,
              description:    req.description   || '',
              requestingArea: req.requestingArea || '',
              sector:         req.sector         || '',
              typeId:         req.typeId         || null,
              type:           req.typeName?.toLowerCase() || '',
              variationId:    req.variationId    || null,
              variationName:  req.variationName  || '',
              nucleos:        req.nucleo ? [req.nucleo] : [],
              outOfCalendar:  req.outOfCalendar  || false,
              customFields: {
                outOfCalendar:   req.outOfCalendar || false,
                variationId:     req.variationId   || null,
                variationName:   req.variationName || '',
              },
              clientEmail:    req.requesterEmail || '',
              dueDate:        req.desiredDate    || null,
              workspaceId:    wsId || store.get('currentWorkspace')?.id || null,
              status:         'not_started',
              priority:       req.urgency ? 'urgent' : 'medium',
              tags:           ['solicitação'],
              assignees:      [],
              subtasks:       [],
              comments:       [],
            },
          });
        },
      }] : []),
    ],
  });
}

/* ─── Ask rejection reason (inline mini-modal) ───────────── */
async function askRejectionReason() {
  return new Promise(resolve => {
    modal.open({
      title: 'Motivo da recusa',
      size:  'sm',
      content: `
        <p style="font-size:0.875rem;color:var(--text-secondary);margin-bottom:12px;">
          Informe o motivo da recusa. Este texto será enviado por e-mail ao solicitante.
        </p>
        <div class="form-group">
          <label class="form-label">Motivo <span class="required">*</span></label>
          <textarea class="form-textarea" id="rejection-reason-input" rows="3"
            placeholder="Ex: A demanda está fora do escopo do calendário editorial deste mês..."></textarea>
          <span class="form-error-msg" id="rejection-reason-err"></span>
        </div>
      `,
      footer: [
        { label:'Cancelar', class:'btn-secondary', closeOnClick:false,
          onClick:(_, {close}) => { close(); resolve(null); }
        },
        { label:'Confirmar recusa', class:'btn-primary', closeOnClick:false,
          onClick:(_, {close}) => {
            const val = document.getElementById('rejection-reason-input')?.value?.trim();
            const err = document.getElementById('rejection-reason-err');
            if (!val) { if(err) err.textContent='Informe o motivo.'; return; }
            close();
            resolve(val);
          }
        },
      ],
      onClose: () => resolve(null),
    });
  });
}

/* ─── Time ago helper ────────────────────────────────────── */
function timeAgo(ts) {
  if (!ts) return '';
  const d    = ts?.toDate ? ts.toDate() : new Date(ts);
  const diff = Date.now() - d.getTime();
  const m    = Math.floor(diff/60000);
  if (m < 1)   return 'agora';
  if (m < 60)  return `${m}min atrás`;
  const h = Math.floor(m/60);
  if (h < 24)  return `${h}h atrás`;
  return `${Math.floor(h/24)}d atrás`;
}
