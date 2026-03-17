/**
 * PRIMETOUR — Requests Page (Fase 4)
 * Triagem de solicitações e conversão em tarefas
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import { openTaskModal } from '../components/taskModal.js';
import {
  fetchRequests, subscribeRequests,
  updateRequestStatus, convertToTask,
  REQUEST_STATUSES, REQUEST_STATUS_MAP,
} from '../services/requests.js';
import { NUCLEOS, REQUESTING_AREAS } from '../services/tasks.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);
}

function fmtShort(ts) {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit'}).format(d);
}

let allRequests = [];
let unsubscribe = null;
let filterStatus = '';

/* ─── Render ─────────────────────────────────────────────── */
export async function renderRequests(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Solicitações</h1>
        <p class="page-subtitle">Demandas recebidas pelo portal público</p>
      </div>
      <div class="page-header-actions">
        <a href="solicitar.html" target="_blank" rel="noopener"
          class="btn btn-secondary btn-sm" style="display:flex;align-items:center;gap:6px;">
          ↗ Abrir portal
        </a>
      </div>
    </div>

    <!-- Filters -->
    <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;">
      ${[{value:'',label:'Todas'},  ...REQUEST_STATUSES].map(s => `
        <button class="btn btn-sm req-filter-btn ${filterStatus===s.value?'btn-primary':'btn-secondary'}"
          data-status="${s.value}">
          ${s.icon||'◈'} ${s.label}
        </button>
      `).join('')}
    </div>

    <!-- Stats row -->
    <div id="req-stats" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:24px;">
      ${REQUEST_STATUSES.map(s => `
        <div class="dash-widget" style="min-height:unset;padding:14px 16px;">
          <div style="font-size:0.75rem;color:var(--text-muted);">${s.icon} ${s.label}</div>
          <div id="stat-${s.value}" style="font-size:1.5rem;font-weight:700;color:${s.color};margin-top:4px;">—</div>
        </div>
      `).join('')}
    </div>

    <!-- List -->
    <div id="req-list">
      ${[0,1,2].map(()=>'<div class="card skeleton" style="height:100px;margin-bottom:12px;"></div>').join('')}
    </div>
  `;

  // Filter buttons
  container.querySelectorAll('.req-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      filterStatus = btn.dataset.status;
      container.querySelectorAll('.req-filter-btn').forEach(b => {
        b.classList.toggle('btn-primary', b.dataset.status === filterStatus);
        b.classList.toggle('btn-secondary', b.dataset.status !== filterStatus);
      });
      renderList();
    });
  });

  _subscribe();
}

function _subscribe() {
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribeRequests(requests => {
    allRequests = requests;
    updateStats();
    renderList();
  });
}

function updateStats() {
  REQUEST_STATUSES.forEach(s => {
    const el = document.getElementById(`stat-${s.value}`);
    if (el) el.textContent = allRequests.filter(r => r.status === s.value).length;
  });
}

function renderList() {
  const el = document.getElementById('req-list');
  if (!el) return;

  const filtered = filterStatus
    ? allRequests.filter(r => r.status === filterStatus)
    : allRequests;

  if (!filtered.length) {
    el.innerHTML = `
      <div class="empty-state" style="min-height:30vh;">
        <div class="empty-state-icon">◌</div>
        <div class="empty-state-title">
          ${filterStatus ? 'Nenhuma solicitação com este status' : 'Nenhuma solicitação ainda'}
        </div>
        <p class="text-sm text-muted">As solicitações do portal aparecerão aqui em tempo real.</p>
      </div>`;
    return;
  }

  el.innerHTML = filtered.map(req => renderRequestCard(req)).join('');

  el.querySelectorAll('.req-open-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const req = allRequests.find(r => r.id === btn.dataset.id);
      if (req) openRequestModal(req);
    });
  });
}

function renderRequestCard(req) {
  const status   = REQUEST_STATUS_MAP[req.status] || REQUEST_STATUSES[0];
  const nucleo   = NUCLEOS.find(n => n.value === req.nucleo)?.label || req.nucleo || '—';
  const taskTypes = store.get('taskTypes') || [];
  const typeName  = req.typeName || taskTypes.find(t => t.id === req.typeId)?.name || '—';
  const ago       = timeAgo(req.createdAt);

  return `
    <div class="card req-card" style="
      margin-bottom:12px;cursor:pointer;transition:border-color 0.15s;
      border-left:3px solid ${req.urgency?'#EF4444':status.color};">
      <div class="card-body" style="padding:14px 18px;">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <!-- Left: info -->
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
              ${req.urgency ? `
                <span style="font-size:0.6875rem;padding:2px 8px;border-radius:var(--radius-full);
                  background:rgba(239,68,68,0.15);color:#EF4444;border:1px solid rgba(239,68,68,0.3);
                  font-weight:600;">🔴 URGENTE</span>
              ` : ''}
              <span style="font-size:0.6875rem;padding:2px 8px;border-radius:var(--radius-full);
                background:${status.color}22;color:${status.color};border:1px solid ${status.color}44;">
                ${status.icon} ${status.label}
              </span>
              <span style="font-size:0.75rem;color:var(--text-muted);">${ago}</span>
            </div>

            <div style="font-weight:600;color:var(--text-primary);margin-bottom:4px;
              overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${esc(req.description?.slice(0,80))}${req.description?.length>80?'…':''}
            </div>

            <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:0.8125rem;color:var(--text-muted);">
              <span>👤 ${esc(req.requesterName)}</span>
              <span>◈ ${esc(nucleo)}</span>
              <span>📋 ${esc(typeName)}</span>
              ${req.requestingArea ? `<span>📍 ${esc(req.requestingArea)}</span>` : ''}
              ${req.desiredDate ? `<span>📅 ${fmtShort(req.desiredDate)}</span>` : ''}
            </div>
          </div>

          <!-- Right: actions -->
          <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
            <button class="btn btn-primary btn-sm req-open-btn" data-id="${req.id}">
              Ver detalhes
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* ─── Request detail modal ───────────────────────────────── */
function openRequestModal(req) {
  const status    = REQUEST_STATUS_MAP[req.status] || REQUEST_STATUSES[0];
  const nucleo    = NUCLEOS.find(n => n.value === req.nucleo)?.label || req.nucleo || '—';
  const taskTypes = store.get('taskTypes') || [];
  const typeData  = taskTypes.find(t => t.id === req.typeId);
  const typeName  = req.typeName || typeData?.name || '—';
  const workspaces = store.get('userWorkspaces') || [];

  modal.open({
    title: `Solicitação — ${esc(req.requesterName)}`,
    size:  'lg',
    content: `
      <div style="display:flex;flex-direction:column;gap:16px;">

        <!-- Status + urgency -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <span style="padding:4px 12px;border-radius:var(--radius-full);font-size:0.8125rem;
            background:${status.color}22;color:${status.color};border:1px solid ${status.color}44;">
            ${status.icon} ${status.label}
          </span>
          ${req.urgency ? `
            <span style="padding:4px 12px;border-radius:var(--radius-full);font-size:0.8125rem;
              background:rgba(239,68,68,0.15);color:#EF4444;border:1px solid rgba(239,68,68,0.3);font-weight:600;">
              🔴 URGENTE
            </span>
          ` : ''}
          <span style="font-size:0.8125rem;color:var(--text-muted);margin-left:auto;">
            Recebido em ${fmtDate(req.createdAt)}
          </span>
        </div>

        <!-- Requester info -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;
          padding:14px;background:var(--bg-surface);border-radius:var(--radius-md);">
          ${[
            ['Solicitante', req.requesterName],
            ['E-mail',      req.requesterEmail],
            ['Área',        req.requestingArea || '—'],
            ['Núcleo',      nucleo],
            ['Tipo',        typeName],
            ['Data desejada', req.desiredDate ? fmtShort(req.desiredDate) : '—'],
          ].map(([label, val]) => `
            <div>
              <div style="font-size:0.75rem;color:var(--text-muted);">${label}</div>
              <div style="font-size:0.875rem;color:var(--text-primary);font-weight:500;">${esc(val)}</div>
            </div>
          `).join('')}
        </div>

        <!-- Variation + OutOfCalendar badges -->
        ${(req.variationName||req.outOfCalendar) ? `
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${req.variationName ? `<span style="padding:3px 10px;border-radius:var(--radius-full);
              background:rgba(212,168,67,0.1);border:1px solid rgba(212,168,67,0.3);
              font-size:0.8125rem;color:var(--brand-gold);">
              🔀 ${esc(req.variationName)}
            </span>` : ''}
            ${req.outOfCalendar ? `<span style="padding:3px 10px;border-radius:var(--radius-full);
              background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);
              font-size:0.8125rem;color:#EF4444;">
              ⚠ Fora do calendário
            </span>` : ''}
          </div>
        ` : ''}

        <!-- Description -->
        <div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:6px;">Descrição da demanda</div>
          <div style="font-size:0.9375rem;color:var(--text-secondary);line-height:1.7;
            padding:12px;background:var(--bg-surface);border-radius:var(--radius-md);">
            ${esc(req.description)}
          </div>
        </div>

        <!-- Internal note -->
        <div class="form-group">
          <label class="form-label">Nota interna (visível só para o time)</label>
          <textarea class="form-textarea" id="req-internal-note" rows="2"
            placeholder="Adicione observações internas...">${esc(req.internalNote||'')}</textarea>
        </div>

        <!-- Workspace assignment (for conversion) -->
        ${req.status === 'pending' ? `
          <div class="form-group">
            <label class="form-label">Workspace para conversão</label>
            <select class="form-select" id="req-workspace">
              <option value="">— Selecione o workspace —</option>
              ${workspaces.map(w => `<option value="${w.id}">${esc(w.icon||'◈')} ${esc(w.name)}</option>`).join('')}
            </select>
          </div>
        ` : ''}

        ${req.taskId ? `
          <div style="padding:10px 14px;background:rgba(34,197,94,0.08);
            border:1px solid rgba(34,197,94,0.25);border-radius:var(--radius-md);
            font-size:0.875rem;color:#22C55E;">
            ✓ Convertida em tarefa — ID: ${req.taskId}
          </div>
        ` : ''}
      </div>
    `,
    footer: [
      { label:'Fechar', class:'btn-secondary', closeOnClick:true },

      ...(req.status !== 'rejected' && req.status !== 'converted' ? [{
        label: 'Recusar', class: 'btn-secondary btn-sm', closeOnClick: false,
        onClick: async (_, { close }) => {
          close();
          openRejectModal(req);
        },
      }] : []),

      ...(req.status !== 'converted' ? [{
        label: '✓ Converter em tarefa', class: 'btn-primary', closeOnClick: false,
        onClick: async (_, { close }) => {
          const wsId = document.getElementById('req-workspace')?.value;
          const note = document.getElementById('req-internal-note')?.value || '';
          close();
          // Open task modal pre-filled with request data
          openTaskModal({
            typeId:    req.typeId || null,
            status:    'not_started',
            onSave:    async (taskId) => {
              await updateRequestStatus(req.id, 'converted', {
                taskId:       taskId || null,
                workspaceId:  wsId   || null,
                internalNote: note,
              }).catch(() => {});
              toast.success('Solicitação convertida em tarefa!');
            },
            taskData: {
              title:          `[Solicitação] ${req.typeName || 'Demanda'} — ${req.requesterName}`,
              description:    req.description,
              requestingArea: req.requestingArea,
              sector:         req.sector        || '',
              typeId:         req.typeId        || null,
              type:           req.typeName?.toLowerCase() || '',
              variationId:    req.variationId   || null,
              variationName:  req.variationName || '',
              nucleos:        req.nucleo ? [req.nucleo] : [],
              clientEmail:    req.requesterEmail,
              dueDate:        req.desiredDate   || null,
              outOfCalendar:  req.outOfCalendar === true,
              workspaceId:    wsId || store.get('currentWorkspace')?.id || null,
              status:         'not_started',
              priority:       req.urgency ? 'urgent' : 'medium',
              assignees:      [],
              tags:           ['solicitação'],
              customFields:   {
                outOfCalendar: req.outOfCalendar === true,
              },
              subtasks:       [],
              comments:       [],
            },
          });
        },
      }] : []),
    ],
  });
}

/* ─── Reject modal with reason + email ──────────────────── */
async function openRejectModal(req) {
  modal.open({
    title:   'Recusar solicitação',
    size:    'sm',
    content: `
      <p style="font-size:0.875rem;color:var(--text-secondary);margin-bottom:14px;line-height:1.6;">
        Informe o motivo da recusa. Um e-mail será enviado para
        <strong>${esc(req.requesterEmail)}</strong> com a justificativa.
      </p>
      <div class="form-group">
        <label class="form-label">Motivo da recusa <span class="required">*</span></label>
        <textarea class="form-textarea" id="reject-reason" rows="4"
          placeholder="Ex: A demanda não se encaixa no escopo atual do time. Sugerimos..."></textarea>
        <span class="form-error-msg" id="reject-reason-err"></span>
      </div>
    `,
    footer: [
      { label:'Cancelar', class:'btn-secondary', closeOnClick:true },
      {
        label:'Recusar e notificar', class:'btn-danger', closeOnClick: false,
        onClick: async (_, { close }) => {
          const reason = document.getElementById('reject-reason')?.value?.trim();
          if (!reason) {
            const err = document.getElementById('reject-reason-err');
            if (err) err.textContent = 'Informe o motivo da recusa.';
            return;
          }
          const btn = document.querySelector('.modal-footer .btn-danger');
          if (btn) { btn.classList.add('loading'); btn.disabled = true; }
          try {
            await updateRequestStatus(req.id, 'rejected', {
              internalNote:  reason,
              rejectionNote: reason,
            });
            await sendRejectionEmail(req, reason).catch(e =>
              console.warn('Rejection email failed:', e.message)
            );
            toast.success('Solicitação recusada e solicitante notificado.');
            close();
          } catch(e) {
            toast.error(e.message);
          } finally {
            if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
          }
        },
      },
    ],
  });
}

async function sendRejectionEmail(req, reason) {
  const { APP_CONFIG } = await import('../config.js').catch(() => ({ APP_CONFIG: null }));
  const cfg = APP_CONFIG?.emailjs;
  if (!cfg?.serviceId || !cfg?.publicKey) return;

  if (!window.emailjs) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js';
      s.onload = () => { window.emailjs.init(cfg.publicKey); res(); };
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  const templateId = cfg.templateRejection || cfg.templateId || cfg.template;
  await window.emailjs.send(cfg.serviceId, templateId, {
    to_email:       req.requesterEmail,
    to_name:        req.requesterName,
    type_name:      req.typeName || 'Demanda',
    rejection_note: reason,
    team_name:      'PRIMETOUR',
  });
}

/* ─── Time ago helper ────────────────────────────────────── */
function timeAgo(ts) {
  if (!ts) return '';
  const d    = ts?.toDate ? ts.toDate() : new Date(ts);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60)   return 'agora mesmo';
  if (diff < 3600) return `${Math.floor(diff/60)}min atrás`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h atrás`;
  return `${Math.floor(diff/86400)}d atrás`;
}

export function destroyRequests() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}
