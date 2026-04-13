/**
 * PRIMETOUR — AI Automations Page
 * Gestão de automações de IA agendadas
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import {
  fetchAutomations, createAutomation, updateAutomation, deleteAutomation,
  executeAutomation, FREQUENCIES, AUTOMATION_TYPES,
} from '../services/aiAutomations.js';

const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let automations = [];

/* ─── Render principal ──────────────────────────────────── */
export async function renderAiAutomations(container) {
  if (!store.can('dashboard_view') && !store.isMaster()) {
    container.innerHTML = `<div class="empty-state"><span style="font-size:2rem;">🔒</span><p>Acesso restrito</p><p class="text-muted">Você não tem permissão para acessar Automações IA.</p></div>`;
    return;
  }
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">
          <span style="background:linear-gradient(135deg,var(--brand-gold),#F59E0B);-webkit-background-clip:text;
            -webkit-text-fill-color:transparent;font-weight:700;">⚡ Automações IA</span>
        </h1>
        <p class="page-subtitle">Tarefas automatizadas executadas pela inteligência artificial</p>
      </div>
      <div class="page-header-right">
        <button id="btn-new-automation" class="btn btn-primary" style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:1.1rem;">+</span> Nova Automação
        </button>
      </div>
    </div>

    <div id="automations-list" style="margin-top:20px;">
      <div class="card skeleton" style="height:200px;"></div>
    </div>

    <!-- Modal -->
    <div id="automation-modal" class="modal-overlay" style="display:none;">
      <div class="modal-container" style="max-width:620px;">
        <div class="modal-header">
          <h2 id="automation-modal-title" class="modal-title">Nova Automação</h2>
          <button class="modal-close" id="close-automation-modal">&times;</button>
        </div>
        <div class="modal-body" id="automation-modal-body"></div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="cancel-automation-modal">Cancelar</button>
          <button class="btn btn-primary" id="save-automation">Salvar</button>
        </div>
      </div>
    </div>
  `;

  // Event: new automation
  container.querySelector('#btn-new-automation').addEventListener('click', () => openModal());

  // Close modal events
  container.querySelector('#close-automation-modal').addEventListener('click', closeModal);
  container.querySelector('#cancel-automation-modal').addEventListener('click', closeModal);
  container.querySelector('#automation-modal').addEventListener('click', e => {
    if (e.target.id === 'automation-modal') closeModal();
  });

  // Save
  container.querySelector('#save-automation').addEventListener('click', handleSave);

  await loadAndRender();
}

/* ─── Load + render list ────────────────────────────────── */
async function loadAndRender() {
  try {
    automations = await fetchAutomations();
  } catch (e) {
    automations = [];
    toast('Erro ao carregar automações', 'error');
  }
  renderList();
}

function renderList() {
  const el = document.getElementById('automations-list');
  if (!el) return;

  if (!automations.length) {
    el.innerHTML = `
      <div class="card" style="padding:60px 24px;text-align:center;">
        <div style="font-size:3rem;margin-bottom:16px;opacity:0.3;">⚡</div>
        <div style="font-size:1.125rem;font-weight:600;color:var(--text-primary);margin-bottom:8px;">
          Nenhuma automação cadastrada
        </div>
        <div style="font-size:0.875rem;color:var(--text-muted);max-width:400px;margin:0 auto 20px;">
          Automações permitem que a IA execute tarefas periodicamente, como buscar notícias,
          monitorar clipping ou executar skills agendadas.
        </div>
        <button class="btn btn-primary" onclick="document.getElementById('btn-new-automation').click()">
          + Criar primeira automação
        </button>
      </div>
    `;
    return;
  }

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px;">
      ${automations.map(a => renderCard(a)).join('')}
    </div>
  `;

  // Attach card events
  el.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const action = btn.dataset.action;

      if (action === 'edit') {
        const auto = automations.find(a => a.id === id);
        if (auto) openModal(auto);
      } else if (action === 'toggle') {
        const auto = automations.find(a => a.id === id);
        if (auto) {
          await updateAutomation(id, { active: !auto.active });
          toast(auto.active ? 'Automação pausada' : 'Automação ativada', 'success');
          await loadAndRender();
        }
      } else if (action === 'run') {
        btn.disabled = true;
        btn.textContent = '⏳';
        toast('Executando automação...', 'info');
        const auto = automations.find(a => a.id === id);
        if (auto) {
          const result = await executeAutomation(auto);
          toast(result.success ? 'Automação executada com sucesso!' : `Erro: ${result.error}`,
                result.success ? 'success' : 'error');
          await loadAndRender();
        }
      } else if (action === 'delete') {
        if (!confirm('Deseja excluir esta automação?')) return;
        await deleteAutomation(id);
        toast('Automação excluída', 'success');
        await loadAndRender();
      }
    });
  });
}

function renderCard(a) {
  const typeInfo = AUTOMATION_TYPES.find(t => t.id === a.type) || {};
  const freqInfo = FREQUENCIES.find(f => f.id === a.frequency) || {};
  const statusColor = a.active ? '#22C55E' : '#64748B';
  const statusLabel = a.active ? 'Ativa' : 'Pausada';

  const lastRun = a.lastRunAt?.toDate
    ? a.lastRunAt.toDate().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : 'Nunca executada';

  const lastStatusIcon = a.lastRunStatus === 'success' ? '✓' : a.lastRunStatus === 'error' ? '✗' : '—';
  const lastStatusColor = a.lastRunStatus === 'success' ? '#22C55E' : a.lastRunStatus === 'error' ? '#EF4444' : 'var(--text-muted)';

  return `
    <div class="card" style="padding:20px;position:relative;border-left:3px solid ${statusColor};">
      <!-- Header -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px;">
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span style="font-size:1.25rem;">${typeInfo.icon || '⚡'}</span>
            <span style="font-size:1rem;font-weight:600;color:var(--text-primary);">${esc(a.name)}</span>
          </div>
          <div style="font-size:0.8125rem;color:var(--text-muted);">${esc(typeInfo.label || a.type)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${statusColor};"></span>
          <span style="font-size:0.75rem;color:${statusColor};font-weight:500;">${statusLabel}</span>
        </div>
      </div>

      <!-- Description -->
      ${a.description ? `<div style="font-size:0.8125rem;color:var(--text-secondary);margin-bottom:12px;line-height:1.5;">${esc(a.description)}</div>` : ''}

      <!-- Meta -->
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
        <span style="font-size:0.75rem;padding:3px 8px;border-radius:4px;background:var(--bg-surface);color:var(--text-muted);">
          ${freqInfo.icon || ''} ${esc(freqInfo.label || a.frequency)}
        </span>
        <span style="font-size:0.75rem;padding:3px 8px;border-radius:4px;background:var(--bg-surface);color:var(--text-muted);">
          ⏰ ${a.schedule?.time || '08:00'}
        </span>
        <span style="font-size:0.75rem;padding:3px 8px;border-radius:4px;background:var(--bg-surface);color:var(--text-muted);">
          ${a.runCount || 0} execuções
        </span>
      </div>

      <!-- Last run -->
      <div style="display:flex;align-items:center;gap:6px;font-size:0.75rem;color:var(--text-muted);margin-bottom:16px;">
        <span style="color:${lastStatusColor};font-weight:600;">${lastStatusIcon}</span>
        Última execução: ${lastRun}
      </div>

      <!-- Actions -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button data-action="run" data-id="${a.id}" class="btn btn-secondary" style="font-size:0.8125rem;padding:5px 12px;"
          title="Executar agora">▶ Executar</button>
        <button data-action="edit" data-id="${a.id}" class="btn btn-secondary" style="font-size:0.8125rem;padding:5px 12px;"
          title="Editar">✎ Editar</button>
        <button data-action="toggle" data-id="${a.id}" class="btn btn-secondary" style="font-size:0.8125rem;padding:5px 12px;"
          title="${a.active ? 'Pausar' : 'Ativar'}">${a.active ? '⏸ Pausar' : '▶ Ativar'}</button>
        <button data-action="delete" data-id="${a.id}" class="btn btn-secondary" style="font-size:0.8125rem;padding:5px 12px;color:#EF4444;"
          title="Excluir">✕</button>
      </div>
    </div>
  `;
}

/* ─── Modal ─────────────────────────────────────────────── */
let editingId = null;

function openModal(automation = null) {
  editingId = automation?.id || null;
  const modal = document.getElementById('automation-modal');
  const title = document.getElementById('automation-modal-title');
  const body  = document.getElementById('automation-modal-body');

  title.textContent = editingId ? 'Editar Automação' : 'Nova Automação';

  const a = automation || {};

  body.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <!-- Nome -->
      <div>
        <label style="font-size:0.8125rem;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px;">Nome *</label>
        <input id="auto-name" class="form-input" type="text" value="${esc(a.name || '')}" placeholder="Ex: Busca diária de notícias de viagem">
      </div>

      <!-- Descrição -->
      <div>
        <label style="font-size:0.8125rem;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px;">Descrição</label>
        <textarea id="auto-desc" class="form-input" rows="2" placeholder="Descreva o que essa automação faz...">${esc(a.description || '')}</textarea>
      </div>

      <!-- Tipo -->
      <div>
        <label style="font-size:0.8125rem;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px;">Tipo de Automação *</label>
        <select id="auto-type" class="form-input">
          ${AUTOMATION_TYPES.map(t => `
            <option value="${t.id}" ${a.type === t.id ? 'selected' : ''}>${t.icon} ${t.label}</option>
          `).join('')}
        </select>
        <div id="auto-type-desc" style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;"></div>
      </div>

      <!-- Frequência -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="font-size:0.8125rem;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px;">Frequência</label>
          <select id="auto-freq" class="form-input">
            ${FREQUENCIES.map(f => `
              <option value="${f.id}" ${a.frequency === f.id ? 'selected' : ''}>${f.icon} ${f.label}</option>
            `).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px;">Horário</label>
          <input id="auto-time" class="form-input" type="time" value="${a.schedule?.time || '08:00'}">
        </div>
      </div>

      <!-- Dia da semana / mês (condicional) -->
      <div id="auto-schedule-extra" style="display:none;"></div>

      <!-- Config: Keywords -->
      <div>
        <label style="font-size:0.8125rem;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px;">
          Palavras-chave <span style="color:var(--text-muted);font-weight:400;">(separadas por vírgula)</span>
        </label>
        <input id="auto-keywords" class="form-input" type="text"
          value="${(a.config?.keywords || []).join(', ')}"
          placeholder="Ex: turismo, viagem, aviação, hotel">
      </div>

      <!-- Config: Prompt customizado (para skill_execution) -->
      <div id="auto-prompt-wrap">
        <label style="font-size:0.8125rem;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px;">
          Prompt / Instruções para a IA
        </label>
        <textarea id="auto-prompt" class="form-input" rows="3"
          placeholder="Instruções específicas para a IA executar...">${esc(a.config?.prompt || '')}</textarea>
      </div>

      <!-- Max results -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="font-size:0.8125rem;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px;">
            Máx. resultados
          </label>
          <input id="auto-max" class="form-input" type="number" min="1" max="20" value="${a.config?.maxResults || 5}">
        </div>
        <div style="display:flex;align-items:flex-end;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding-bottom:8px;">
            <input id="auto-active" type="checkbox" ${a.active !== false ? 'checked' : ''}>
            <span style="font-size:0.8125rem;color:var(--text-secondary);">Automação ativa</span>
          </label>
        </div>
      </div>
    </div>
  `;

  // Type description update
  const typeSelect = body.querySelector('#auto-type');
  const typeDesc   = body.querySelector('#auto-type-desc');
  const updateTypeDesc = () => {
    const info = AUTOMATION_TYPES.find(t => t.id === typeSelect.value);
    typeDesc.textContent = info?.desc || '';
  };
  typeSelect.addEventListener('change', updateTypeDesc);
  updateTypeDesc();

  // Frequency-dependent schedule fields
  const freqSelect = body.querySelector('#auto-freq');
  const schedExtra = body.querySelector('#auto-schedule-extra');
  const updateSchedExtra = () => {
    const freq = freqSelect.value;
    if (freq === 'weekly') {
      const days = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
      schedExtra.style.display = 'block';
      schedExtra.innerHTML = `
        <label style="font-size:0.8125rem;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px;">Dia da semana</label>
        <select id="auto-dow" class="form-input">
          ${days.map((d, i) => `<option value="${i}" ${a.schedule?.dayOfWeek === i ? 'selected' : ''}>${d}</option>`).join('')}
        </select>`;
    } else if (freq === 'monthly') {
      schedExtra.style.display = 'block';
      schedExtra.innerHTML = `
        <label style="font-size:0.8125rem;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px;">Dia do mês</label>
        <input id="auto-dom" class="form-input" type="number" min="1" max="31" value="${a.schedule?.dayOfMonth || 1}">`;
    } else {
      schedExtra.style.display = 'none';
      schedExtra.innerHTML = '';
    }
  };
  freqSelect.addEventListener('change', updateSchedExtra);
  updateSchedExtra();

  modal.style.display = 'flex';
}

function closeModal() {
  const modal = document.getElementById('automation-modal');
  if (modal) modal.style.display = 'none';
  editingId = null;
}

async function handleSave() {
  const name = document.getElementById('auto-name')?.value?.trim();
  if (!name) { toast('Informe o nome da automação', 'warning'); return; }

  const data = {
    name,
    description: document.getElementById('auto-desc')?.value?.trim() || '',
    type:        document.getElementById('auto-type')?.value || 'skill_execution',
    module:      AUTOMATION_TYPES.find(t => t.id === document.getElementById('auto-type')?.value)?.module || 'general',
    frequency:   document.getElementById('auto-freq')?.value || 'daily',
    active:      document.getElementById('auto-active')?.checked !== false,
    config: {
      prompt:     document.getElementById('auto-prompt')?.value?.trim() || '',
      keywords:   (document.getElementById('auto-keywords')?.value || '').split(',').map(k => k.trim()).filter(Boolean),
      maxResults: parseInt(document.getElementById('auto-max')?.value) || 5,
    },
    schedule: {
      time:       document.getElementById('auto-time')?.value || '08:00',
      dayOfWeek:  document.getElementById('auto-dow') ? parseInt(document.getElementById('auto-dow').value) : null,
      dayOfMonth: document.getElementById('auto-dom') ? parseInt(document.getElementById('auto-dom').value) : null,
    },
  };

  try {
    if (editingId) {
      await updateAutomation(editingId, data);
      toast('Automação atualizada!', 'success');
    } else {
      await createAutomation(data);
      toast('Automação criada!', 'success');
    }
    closeModal();
    await loadAndRender();
  } catch (e) {
    toast('Erro ao salvar: ' + e.message, 'error');
  }
}

export function destroyAiAutomations() {
  automations = [];
  editingId = null;
}
