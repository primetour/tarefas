/**
 * PRIMETOUR — CSAT Page (Etapa 4)
 * Gestão completa de pesquisas de satisfação
 */

import { store }   from '../store.js';
import { toast }   from '../components/toast.js';
import { modal }   from '../components/modal.js';
import {
  subscribeSurveys, createCsatSurvey, sendCsatEmail,
  cancelSurvey, resendSurvey, calcCsatMetrics,
  fetchSurveys, CSAT_STATUS, SCORE_LABELS,
} from '../services/csat.js';
import { fetchTasks }    from '../services/tasks.js';
import { fetchProjects } from '../services/projects.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let allSurveys   = [];
let allTasks     = [];
let allProjects  = [];
let filterStatus = 'all';
let searchTerm   = '';
let unsubscribe  = null;

/* ─── Render ─────────────────────────────────────────────── */
export async function renderCsat(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">CSAT</h1>
        <p class="page-subtitle">Pesquisas de satisfação do cliente</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-secondary btn-sm" id="csat-export-btn">↓ Exportar CSV</button>
        ${store.isManager() ? `<button class="btn btn-primary" id="csat-new-btn">+ Nova Pesquisa</button>` : ''}
      </div>
    </div>

    <!-- KPI row -->
    <div class="csat-stat-row" id="csat-kpis">
      ${[0,1,2,3,4].map(()=>'<div class="stat-card skeleton" style="height:90px;"></div>').join('')}
    </div>

    <!-- Toolbar -->
    <div class="toolbar" style="margin-bottom:16px;">
      <div class="toolbar-search">
        <span class="toolbar-search-icon">🔍</span>
        <input type="text" class="toolbar-search-input" id="csat-search"
          placeholder="Buscar por tarefa, cliente, e-mail..." />
      </div>
      <div class="csat-status-filter" id="csat-status-filter">
        ${['all','pending','sent','responded','expired','cancelled'].map(s => `
          <span class="csat-status-pill ${s==='all'?'active':''}" data-status="${s}">
            ${ s==='all' ? 'Todas' : CSAT_STATUS[s]?.label || s }
          </span>
        `).join('')}
      </div>
      <div style="margin-left:auto; display:flex; align-items:center; gap:8px;">
        <label style="font-size:0.8125rem; color:var(--text-muted);">Visualizar:</label>
        <div class="view-toggle">
          <button class="view-btn active" data-view="cards">⊞ Cards</button>
          <button class="view-btn" data-view="table">☰ Tabela</button>
        </div>
      </div>
    </div>

    <!-- Content -->
    <div id="csat-content">
      <div class="task-empty"><div class="task-empty-icon">⟳</div><div class="task-empty-title">Carregando pesquisas...</div></div>
    </div>

    <!-- Distribution + Comments -->
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-top:24px;" id="csat-bottom">
    </div>
  `;

  // Events
  document.getElementById('csat-new-btn')?.addEventListener('click', () => openNewSurveyModal());
  document.getElementById('csat-export-btn')?.addEventListener('click', exportCSV);

  let timer;
  document.getElementById('csat-search')?.addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { searchTerm = e.target.value; applyFilters(); }, 250);
  });

  document.querySelectorAll('[data-status]').forEach(el => {
    el.addEventListener('click', () => {
      filterStatus = el.dataset.status;
      document.querySelectorAll('[data-status]').forEach(e => e.classList.remove('active'));
      el.classList.add('active');
      applyFilters();
    });
  });

  document.querySelectorAll('.view-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn[data-view]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderList(btn.dataset.view);
    });
  });

  // Load static data
  try {
    [allTasks, allProjects] = await Promise.all([
      fetchTasks().catch(() => []),
      fetchProjects().catch(() => []),
    ]);
  } catch(e) {}

  // Real-time surveys
  unsubscribe = subscribeSurveys(surveys => {
    allSurveys = surveys;
    renderKPIs(calcCsatMetrics(surveys));
    applyFilters();
    renderBottom(surveys);
  });
}

/* ─── KPIs ────────────────────────────────────────────────── */
function renderKPIs(m) {
  const kpisEl = document.getElementById('csat-kpis');
  if (!kpisEl) return;

  const scoreColor = m.avg >= 4 ? '#22C55E' : m.avg >= 3 ? '#F59E0B' : '#EF4444';
  const npsColor   = m.nps >= 50 ? '#22C55E' : m.nps >= 0 ? '#F59E0B' : '#EF4444';

  kpisEl.innerHTML = `
    ${kpiCard('Média de Satisfação',
      m.responded ? `<span style="color:${scoreColor};">${m.avg.toFixed(1)}</span><span style="font-size:1rem;color:var(--text-muted);">/5</span>` : '—',
      '★', 'rgba(245,158,11,0.12)', '#F59E0B')}
    ${kpiCard('NPS Score',
      m.responded ? `<span style="color:${npsColor};">${m.nps > 0?'+':''}${m.nps}</span>` : '—',
      '◎', 'rgba(212,168,67,0.12)', 'var(--brand-gold)')}
    ${kpiCard('Taxa de Resposta',
      `${m.responseRate}%`, '↩', 'rgba(56,189,248,0.12)', '#38BDF8')}
    ${kpiCard('Total Enviado', m.sent, '✉', 'rgba(167,139,250,0.12)', '#A78BFA')}
    ${kpiCard('Respondidas', m.responded, '✓', 'rgba(34,197,94,0.12)', '#22C55E')}
  `;

  setTimeout(() => {
    document.querySelectorAll('.kpi-bar-fill[data-pct]').forEach(el => {
      el.style.width = el.dataset.pct + '%';
    });
  }, 80);
}

function kpiCard(label, valueHtml, icon, ibg, ic) {
  const rawVal = parseInt(String(valueHtml).replace(/<[^>]+>/g,'')) || 0;
  const pct    = Math.min(100, rawVal * 10);
  return `<div class="stat-card">
    <div class="stat-card-icon" style="background:${ibg}; color:${ic};">${icon}</div>
    <div class="stat-card-label">${label}</div>
    <div class="stat-card-value">${valueHtml}</div>
    <div class="kpi-bar" style="margin-top:8px;">
      <div class="kpi-bar-fill" data-pct="${pct}"
        style="width:0%; background:${ic}; transition:width 0.8s ease;"></div>
    </div>
  </div>`;
}

/* ─── Filters & render ────────────────────────────────────── */
function applyFilters() {
  const view = document.querySelector('.view-btn.active')?.dataset.view || 'cards';
  renderList(view);
}

function getFiltered() {
  let list = [...allSurveys];
  if (filterStatus !== 'all') list = list.filter(s => s.status === filterStatus);
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    list = list.filter(s =>
      s.taskTitle?.toLowerCase().includes(q) ||
      s.clientEmail?.toLowerCase().includes(q) ||
      s.clientName?.toLowerCase().includes(q) ||
      s.projectName?.toLowerCase().includes(q)
    );
  }
  return list;
}

/* ─── Cards view ─────────────────────────────────────────── */
function renderList(view = 'cards') {
  const content = document.getElementById('csat-content');
  if (!content) return;

  const list = getFiltered();

  if (list.length === 0) {
    content.innerHTML = `
      <div class="task-empty">
        <div class="task-empty-icon">📧</div>
        <div class="task-empty-title">${allSurveys.length === 0 ? 'Nenhuma pesquisa criada ainda' : 'Nenhuma pesquisa encontrada'}</div>
        ${allSurveys.length === 0 && store.isManager() ? `
          <p class="text-sm text-muted mt-2">Crie pesquisas de satisfação para coletar feedback dos seus clientes.</p>
          <button class="btn btn-primary mt-4" id="empty-csat-btn">+ Criar primeira pesquisa</button>
        ` : ''}
      </div>
    `;
    document.getElementById('empty-csat-btn')?.addEventListener('click', () => openNewSurveyModal());
    return;
  }

  if (view === 'table') {
    renderTableView(content, list);
  } else {
    renderCardsView(content, list);
  }
}

function renderCardsView(container, list) {
  container.innerHTML = `<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px,1fr)); gap:16px;">
    ${list.map(s => renderSurveyCard(s)).join('')}
  </div>`;
  bindSurveyActions(container);
}

function renderTableView(container, list) {
  container.innerHTML = `
    <div class="card" style="overflow:hidden;">
      <div style="display:grid; grid-template-columns:2fr 1fr 1fr 120px 100px 120px;
        gap:12px; padding:10px 16px; font-size:0.6875rem; font-weight:600;
        text-transform:uppercase; letter-spacing:0.08em; color:var(--text-muted);
        border-bottom:1px solid var(--border-subtle); background:var(--bg-surface);">
        <div>Tarefa / Cliente</div>
        <div>Projeto</div>
        <div>Status</div>
        <div>Nota</div>
        <div>Enviado</div>
        <div>Ações</div>
      </div>
      ${list.map(s => {
        const statusInfo  = CSAT_STATUS[s.status] || {};
        const scoreInfo   = s.score ? SCORE_LABELS[s.score] : null;
        const sentDate    = s.sentAt ? fmtDate(s.sentAt) : '—';
        return `<div style="display:grid; grid-template-columns:2fr 1fr 1fr 120px 100px 120px;
          gap:12px; padding:11px 16px; font-size:0.8125rem;
          border-bottom:1px solid var(--border-subtle); align-items:center;"
          class="survey-table-row">
          <div>
            <div style="font-weight:500; color:var(--text-primary); margin-bottom:2px;">
              ${esc(s.taskTitle)}
            </div>
            <div style="font-size:0.75rem; color:var(--text-muted);">
              ${esc(s.clientName)} · ${esc(s.clientEmail)}
            </div>
          </div>
          <div style="color:var(--text-muted); font-size:0.8125rem;">
            ${s.projectName ? esc(s.projectName) : '—'}
          </div>
          <div>
            <span class="badge" style="background:${statusInfo.color}18; color:${statusInfo.color}; border:1px solid ${statusInfo.color}30; font-size:0.6875rem;">
              ${statusInfo.label||s.status}
            </span>
          </div>
          <div>
            ${scoreInfo ? `<span style="font-size:1.125rem;">${scoreInfo.emoji}</span>
              <strong style="color:${scoreInfo.color}; margin-left:4px;">${s.score}</strong>` : '—'}
          </div>
          <div style="color:var(--text-muted); font-size:0.75rem;">${sentDate}</div>
          <div>${renderActionBtns(s, 'sm')}</div>
        </div>`;
      }).join('')}
    </div>
  `;
  bindSurveyActions(container);
}

function renderSurveyCard(s) {
  const statusInfo = CSAT_STATUS[s.status] || {};
  const scoreInfo  = s.score ? SCORE_LABELS[s.score] : null;
  const starsHtml  = s.score ? [1,2,3,4,5].map(i =>
    `<span class="score-star ${i<=s.score?'filled':'empty'}">★</span>`
  ).join('') : '';

  return `
    <div class="survey-card" data-survey-id="${s.id}">
      <div class="survey-card-header">
        <div class="survey-card-title">${esc(s.taskTitle)}</div>
        <span class="badge" style="background:${statusInfo.color}18; color:${statusInfo.color}; border:1px solid ${statusInfo.color}30; font-size:0.6875rem; flex-shrink:0;">
          ${statusInfo.label||s.status}
        </span>
      </div>

      <div class="survey-card-meta">
        <span>✉ ${esc(s.clientEmail)}</span>
        ${s.projectName ? `<span>📦 ${esc(s.projectName)}</span>` : ''}
        ${s.sentAt ? `<span>📅 ${fmtDate(s.sentAt)}</span>` : ''}
      </div>

      ${scoreInfo ? `
        <div style="display:flex; align-items:center; gap:8px; margin-top:10px;">
          <span style="font-size:1.5rem;">${scoreInfo.emoji}</span>
          <div>
            <div class="score-display">${starsHtml}
              <span class="score-value">${s.score}/5</span>
            </div>
            <div style="font-size:0.75rem; color:${scoreInfo.color}; font-weight:500;">
              ${scoreInfo.label}
            </div>
          </div>
        </div>
      ` : ''}

      ${s.comment ? `
        <div class="survey-card-comment">"${esc(s.comment)}"</div>
      ` : ''}

      <div class="survey-actions">
        ${renderActionBtns(s, 'sm')}
      </div>
    </div>
  `;
}

function renderActionBtns(s, size = '') {
  const cls = `btn btn-secondary btn-${size||'sm'}`;
  const actions = [];

  if (s.status === 'pending' && store.isManager()) {
    actions.push(`<button class="${cls}" data-action="send" data-sid="${s.id}">✉ Enviar</button>`);
  }
  if (['sent','expired'].includes(s.status) && store.isManager()) {
    actions.push(`<button class="${cls}" data-action="resend" data-sid="${s.id}">↺ Reenviar</button>`);
  }
  if (['pending','sent'].includes(s.status) && store.isManager()) {
    actions.push(`<button class="${cls} btn-ghost" data-action="cancel" data-sid="${s.id}" style="color:var(--color-danger);">✕</button>`);
  }
  if (s.status === 'responded') {
    actions.push(`<button class="${cls} btn-ghost" data-action="view" data-sid="${s.id}">👁 Ver resposta</button>`);
  }
  return actions.join('');
}

function bindSurveyActions(container) {
  container.querySelectorAll('[data-action][data-sid]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { action, sid } = btn.dataset;
      const survey = allSurveys.find(s => s.id === sid);
      if (!survey) return;

      if (action === 'send')   await handleSend(sid, btn);
      if (action === 'resend') await handleResend(sid, btn);
      if (action === 'cancel') await handleCancel(sid, survey);
      if (action === 'view')   openResponseModal(survey);
    });
  });
}

/* ─── Actions ─────────────────────────────────────────────── */
async function handleSend(sid, btn) {
  btn.classList.add('loading'); btn.disabled = true;
  try {
    await sendCsatEmail(sid);
    toast.success('Pesquisa enviada com sucesso!');
  } catch(e) {
    toast.error(e.message);
  } finally {
    btn.classList.remove('loading'); btn.disabled = false;
  }
}

async function handleResend(sid, btn) {
  btn.classList.add('loading'); btn.disabled = true;
  try {
    await resendSurvey(sid);
    toast.success('Pesquisa reenviada!');
  } catch(e) {
    toast.error(e.message);
  } finally {
    btn.classList.remove('loading'); btn.disabled = false;
  }
}

async function handleCancel(sid, survey) {
  const ok = await modal.confirm({
    title:       'Cancelar pesquisa',
    message:     `Cancelar a pesquisa para <strong>${esc(survey.clientEmail)}</strong>?`,
    confirmText: 'Cancelar pesquisa',
    danger:      true, icon: '✕',
  });
  if (ok) {
    try {
      await cancelSurvey(sid);
      toast.success('Pesquisa cancelada.');
    } catch(e) { toast.error(e.message); }
  }
}

function openResponseModal(survey) {
  const scoreInfo = SCORE_LABELS[survey.score];
  modal.open({
    title: 'Resposta do cliente',
    size:  'sm',
    content: `
      <div style="text-align:center; padding:8px 0 16px;">
        <div style="font-size:3rem; margin-bottom:8px;">${scoreInfo?.emoji||'★'}</div>
        <div style="font-size:2rem; font-weight:700; color:${scoreInfo?.color||'var(--brand-gold)'};">
          ${survey.score}/5 — ${scoreInfo?.label||''}
        </div>
        <div style="font-size:0.875rem; color:var(--text-muted); margin-top:4px;">
          ${fmtDate(survey.respondedAt)}
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <div class="task-detail-label">Tarefa</div>
        <div class="task-detail-value">${esc(survey.taskTitle)}</div>
      </div>
      <div style="margin-bottom:12px;">
        <div class="task-detail-label">Cliente</div>
        <div class="task-detail-value">${esc(survey.clientName)} · ${esc(survey.clientEmail)}</div>
      </div>
      ${survey.comment ? `
        <div>
          <div class="task-detail-label">Comentário</div>
          <div class="survey-card-comment" style="font-style:normal;">${esc(survey.comment)}</div>
        </div>
      ` : '<div style="color:var(--text-muted); font-size:0.875rem;">Nenhum comentário.</div>'}
    `,
    footer: [{ label:'Fechar', class:'btn-secondary', closeOnClick:true }],
  });
}

/* ─── New Survey Modal ────────────────────────────────────── */
function openNewSurveyModal(presetTask = null) {
  const completedTasks = allTasks.filter(t => t.status === 'done');

  modal.open({
    title: 'Nova Pesquisa de Satisfação',
    size:  'md',
    content: `
      <div class="form-group">
        <label class="form-label">Tarefa *</label>
        <select class="form-select" id="ns-task" style="padding:8px 32px 8px 12px;">
          <option value="">— Selecionar tarefa concluída —</option>
          ${completedTasks.map(t =>
            `<option value="${t.id}" ${presetTask?.id===t.id?'selected':''}
              data-project="${allProjects.find(p=>p.id===t.projectId)?.name||''}">
              ${esc(t.title)}
            </option>`
          ).join('')}
        </select>
        <span class="form-error-msg" id="ns-task-err"></span>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div class="form-group">
          <label class="form-label">E-mail do cliente *</label>
          <input type="email" class="form-input" id="ns-email"
            value="${esc(presetTask?.clientEmail||'')}"
            placeholder="cliente@empresa.com" />
          <span class="form-error-msg" id="ns-email-err"></span>
        </div>
        <div class="form-group">
          <label class="form-label">Nome do cliente</label>
          <input type="text" class="form-input" id="ns-name"
            value="${esc(presetTask?.clientName||'')}"
            placeholder="Nome ou empresa" maxlength="80" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Mensagem personalizada <span style="color:var(--text-muted); font-weight:400;">(opcional)</span></label>
        <textarea class="form-textarea" id="ns-message" rows="3" maxlength="500"
          placeholder="Sua tarefa foi concluída! Gostaríamos de saber sua opinião sobre nosso trabalho..."></textarea>
      </div>

      <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:12px 14px; margin-top:4px;">
        <div style="font-size:0.75rem; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:6px;">
          Prévia do e-mail
        </div>
        <div style="font-size:0.8125rem; color:var(--text-secondary); line-height:1.7;">
          O cliente receberá um e-mail com 5 botões de avaliação (😞 a 😄).<br>
          Ao clicar em qualquer botão, ele será direcionado para uma página de confirmação onde poderá deixar um comentário.<br>
          <span style="color:var(--brand-gold);">✓ Link expira em 7 dias.</span>
        </div>
      </div>

      <label class="flex items-center gap-2 mt-4" style="cursor:pointer; display:flex; gap:10px; align-items:center; margin-top:16px;">
        <input type="checkbox" id="ns-send-now" checked />
        <span style="font-size:0.875rem; color:var(--text-primary);">Enviar e-mail imediatamente após criar</span>
      </label>
    `,
    footer: [
      { label:'Cancelar', class:'btn-secondary', closeOnClick:true },
      {
        label: 'Criar pesquisa', class:'btn-primary', closeOnClick:false,
        onClick: async (_, { close }) => {
          const taskId  = document.getElementById('ns-task')?.value;
          const email   = document.getElementById('ns-email')?.value?.trim();
          const taskErr = document.getElementById('ns-task-err');
          const emailErr= document.getElementById('ns-email-err');

          let valid = true;
          if (!taskId)    { if(taskErr)  taskErr.textContent='Selecione uma tarefa.'; valid=false; } else if(taskErr)  taskErr.textContent='';
          if (!email)     { if(emailErr) emailErr.textContent='E-mail é obrigatório.'; valid=false; }
          else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            if(emailErr) emailErr.textContent='E-mail inválido.'; valid=false;
          } else if(emailErr) emailErr.textContent='';

          if (!valid) return;

          const btn = document.querySelector('.modal-footer .btn-primary');
          if(btn){ btn.classList.add('loading'); btn.disabled=true; }

          try {
            const task    = allTasks.find(t=>t.id===taskId);
            const project = allProjects.find(p=>p.id===task?.projectId);
            const survey  = await createCsatSurvey({
              taskId,
              taskTitle:    task?.title || taskId,
              projectId:    task?.projectId || null,
              projectName:  project?.name   || null,
              clientEmail:  email,
              clientName:   document.getElementById('ns-name')?.value?.trim() || '',
              customMessage: document.getElementById('ns-message')?.value?.trim() || '',
              assignedTo:   task?.assignees?.[0] || null,
            });

            const sendNow = document.getElementById('ns-send-now')?.checked;
            if (sendNow) {
              try {
                await sendCsatEmail(survey.id);
                toast.success('Pesquisa criada e enviada!');
              } catch(sendErr) {
                toast.warning(`Pesquisa criada, mas erro ao enviar: ${sendErr.message}`);
              }
            } else {
              toast.success('Pesquisa criada! Envie quando desejar.');
            }
            close();
          } catch(e) {
            toast.error(e.message);
          } finally {
            if(btn){ btn.classList.remove('loading'); btn.disabled=false; }
          }
        }
      }
    ],
  });
}

/* ─── Bottom widgets ──────────────────────────────────────── */
function renderBottom(surveys) {
  const container = document.getElementById('csat-bottom');
  if (!container) return;

  const m   = calcCsatMetrics(surveys);
  const recent = surveys
    .filter(s => s.status === 'responded' && s.comment)
    .slice(0, 5);

  container.innerHTML = `
    <!-- Distribution -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">★ Distribuição de Notas</div>
        ${m.responded ? `<span class="badge badge-neutral">${m.responded} respondidas</span>` : ''}
      </div>
      <div class="card-body">
        ${m.responded === 0
          ? `<div class="empty-state" style="padding:24px;"><div class="empty-state-icon">📊</div>
              <div class="empty-state-title">Sem respostas ainda</div></div>`
          : [5,4,3,2,1].map(score => {
              const cnt = m.distribution[score] || 0;
              const pct = m.responded ? Math.round(cnt/m.responded*100) : 0;
              const si  = SCORE_LABELS[score];
              return `<div class="dist-bar-row" style="margin-bottom:8px;">
                <span class="dist-bar-label" style="color:${si.color};">${si.emoji}</span>
                <div class="dist-bar-track">
                  <div class="dist-bar-fill" style="width:${pct}%; background:${si.color};"></div>
                </div>
                <span class="dist-bar-count">${cnt}</span>
              </div>`;
            }).join('')
        }
        ${m.responded ? `
          <div style="display:flex; gap:12px; margin-top:16px; padding-top:12px; border-top:1px solid var(--border-subtle);">
            <div style="flex:1; text-align:center;">
              <div style="font-size:1.5rem; font-weight:700; color:#22C55E;">${m.promoters}</div>
              <div style="font-size:0.75rem; color:var(--text-muted);">Promotores (4-5)</div>
            </div>
            <div style="flex:1; text-align:center;">
              <div style="font-size:1.5rem; font-weight:700; color:var(--text-muted);">${m.neutrals}</div>
              <div style="font-size:0.75rem; color:var(--text-muted);">Neutros (3)</div>
            </div>
            <div style="flex:1; text-align:center;">
              <div style="font-size:1.5rem; font-weight:700; color:#EF4444;">${m.detractors}</div>
              <div style="font-size:0.75rem; color:var(--text-muted);">Detratores (1-2)</div>
            </div>
          </div>
        ` : ''}
      </div>
    </div>

    <!-- Recent comments -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">💬 Comentários Recentes</div>
      </div>
      <div class="card-body" style="max-height:340px; overflow-y:auto; padding:0 16px 8px;">
        ${recent.length === 0
          ? `<div class="empty-state" style="padding:24px;">
              <div class="empty-state-icon">💬</div>
              <div class="empty-state-title">Sem comentários ainda</div>
            </div>`
          : recent.map(s => {
              const si = SCORE_LABELS[s.score];
              return `<div style="padding:12px 0; border-bottom:1px solid var(--border-subtle);">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                  <span style="font-size:1.125rem;">${si?.emoji||'★'}</span>
                  <strong style="font-size:0.875rem; color:var(--text-primary);">${esc(s.clientName || s.clientEmail)}</strong>
                  <span style="font-size:0.75rem; color:var(--text-muted); margin-left:auto;">${fmtDate(s.respondedAt)}</span>
                </div>
                <div style="font-size:0.8125rem; color:var(--text-secondary); font-style:italic;">
                  "${esc(s.comment)}"
                </div>
                <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">
                  ↳ ${esc(s.taskTitle)}
                </div>
              </div>`;
            }).join('')
        }
      </div>
    </div>
  `;

  // Animate distribution bars
  setTimeout(() => {
    document.querySelectorAll('.dist-bar-fill').forEach(el => {
      const w = el.style.width;
      el.style.width = '0%';
      requestAnimationFrame(() => { el.style.width = w; });
    });
  }, 80);
}

/* ─── CSV Export ─────────────────────────────────────────── */
function exportCSV() {
  const list = getFiltered();
  const headers = ['Tarefa','Projeto','Cliente','E-mail','Status','Nota','Comentário','Criado','Enviado','Respondido'];
  const rows = list.map(s => [
    s.taskTitle||'', s.projectName||'', s.clientName||'', s.clientEmail||'',
    CSAT_STATUS[s.status]?.label||s.status,
    s.score||'',
    s.comment||'',
    s.createdAt   ? fmtDate(s.createdAt)   : '',
    s.sentAt      ? fmtDate(s.sentAt)      : '',
    s.respondedAt ? fmtDate(s.respondedAt) : '',
  ]);
  const csv = [headers,...rows]
    .map(r => r.map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'})),
    download: `csat_${new Date().toISOString().slice(0,10)}.csv`,
  });
  a.click();
  toast.success(`${list.length} pesquisas exportadas!`);
}

/* ─── Helpers ─────────────────────────────────────────────── */
function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d);
}

/* ─── Cleanup ─────────────────────────────────────────────── */
export function destroyCsat() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}
