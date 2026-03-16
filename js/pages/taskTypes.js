/**
 * PRIMETOUR — Task Types Page (Fase 1 Round C)
 * Gestão de tipos de tarefa com builder de campos customizados
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import {
  fetchTaskTypes, createTaskType, updateTaskType, deleteTaskType,
  FIELD_TYPES,
} from '../services/taskTypes.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let allTypes = [];

/* ─── Render ─────────────────────────────────────────────── */
export async function renderTaskTypes(container) {
  const canCreate = store.can('task_type_create');
  const canEdit   = store.can('task_type_edit');

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Tipos de Tarefa</h1>
        <p class="page-subtitle">Configure fluxos, campos e regras por tipo</p>
      </div>
      <div class="page-header-actions">
        ${canCreate ? `<button class="btn btn-primary" id="new-type-btn">+ Novo Tipo</button>` : ''}
      </div>
    </div>

    <div style="display:flex;align-items:flex-start;gap:12px;
      background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);
      border-radius:var(--radius-md);padding:12px 16px;margin-bottom:24px;
      font-size:0.8125rem;color:var(--text-secondary);line-height:1.6;">
      <span style="font-size:1rem;flex-shrink:0;">ℹ</span>
      <span>
        Tipos de tarefa definem fluxos específicos com campos customizados, SLA e regras de negócio.
        <strong>Newsletter</strong> é o tipo padrão do sistema. Você pode criar tipos adicionais
        para outros fluxos editoriais ou operacionais do workspace atual.
      </span>
    </div>

    <div id="types-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:20px;">
      ${[0,1].map(()=>'<div class="card skeleton" style="height:220px;"></div>').join('')}
    </div>
  `;

  document.getElementById('new-type-btn')?.addEventListener('click', () => openTypeModal());
  await loadTypes();
}

async function loadTypes() {
  try {
    allTypes = await fetchTaskTypes();
    store.set('taskTypes', allTypes);
    renderGrid();
  } catch(e) { toast.error('Erro ao carregar tipos: ' + e.message); }
}

function renderGrid() {
  const grid = document.getElementById('types-grid');
  if (!grid) return;

  grid.innerHTML = allTypes.map(type => {
    const fieldCount = type.fields?.length || 0;
    const stepCount  = type.steps?.length  || 0;

    return `
      <div class="card" style="border-top:3px solid ${esc(type.color||'#6B7280')};">
        <div class="card-header" style="padding-bottom:12px;">
          <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
            <div style="width:40px;height:40px;border-radius:var(--radius-md);flex-shrink:0;
              background:${esc(type.color||'#6B7280')}22;color:${esc(type.color||'#6B7280')};
              display:flex;align-items:center;justify-content:center;font-size:1.25rem;">
              ${esc(type.icon||'📋')}
            </div>
            <div style="min-width:0;">
              <div style="font-weight:600;color:var(--text-primary);font-size:0.9375rem;">
                ${esc(type.name)}
                ${type.isSystem ? `<span style="font-size:0.6875rem;margin-left:6px;padding:1px 6px;
                  border-radius:var(--radius-full);background:rgba(255,255,255,0.06);
                  color:var(--text-muted);border:1px solid var(--border-subtle);">Sistema</span>` : ''}
              </div>
              <div style="font-size:0.75rem;color:var(--text-muted);">${esc(type.description||'')}</div>
            </div>
          </div>
          ${store.can('task_type_edit') ? `
            <div style="display:flex;gap:4px;">
              <button class="btn btn-ghost btn-icon btn-sm type-edit-btn" data-id="${type.id}" title="Editar">✎</button>
              ${!type.isSystem && store.can('task_type_delete') ? `
                <button class="btn btn-ghost btn-icon btn-sm type-delete-btn" data-id="${type.id}"
                  title="Excluir" style="color:var(--color-danger);">✕</button>
              ` : ''}
            </div>
          ` : ''}
        </div>
        <div class="card-body" style="padding-top:0;">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;">
            ${[
              ['Campos',  fieldCount, '◈'],
              ['Steps',   stepCount,  '▶'],
              ['SLA',     type.sla?.label||'—', '⏱'],
            ].map(([label, val, icon]) => `
              <div style="background:var(--bg-surface);border-radius:var(--radius-md);padding:8px;text-align:center;">
                <div style="font-size:0.75rem;color:var(--text-muted);">${icon} ${label}</div>
                <div style="font-size:0.9375rem;font-weight:600;color:var(--text-primary);margin-top:2px;">${val}</div>
              </div>
            `).join('')}
          </div>
          ${type.rules?.blockDuplicate || type.rules?.maxPerDay > 0 ? `
            <div style="font-size:0.75rem;color:var(--brand-gold);padding:4px 8px;
              background:rgba(212,168,67,0.08);border-radius:var(--radius-sm);">
              ⚠ ${type.rules.blockDuplicate ? 'Apenas 1 por dia' : `Máx. ${type.rules.maxPerDay}/dia`}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.type-edit-btn').forEach(btn =>
    btn.addEventListener('click', () => openTypeModal(allTypes.find(t => t.id === btn.dataset.id)))
  );
  grid.querySelectorAll('.type-delete-btn').forEach(btn =>
    btn.addEventListener('click', () => confirmDelete(btn.dataset.id))
  );
}

/* ─── Modal: criar / editar tipo ────────────────────────── */
function openTypeModal(type = null) {
  const isEdit  = !!type;
  let   fields  = JSON.parse(JSON.stringify(type?.fields || []));
  let   steps   = JSON.parse(JSON.stringify(type?.steps  || []));

  const ICONS   = ['📋','📧','🚀','🎯','📊','🎨','📣','🔧','💡','⚡','🌟','◈'];
  const COLORS  = ['#D4A843','#38BDF8','#22C55E','#A78BFA','#F97316','#EC4899','#06B6D4','#EF4444'];

  function renderFieldsBuilder() {
    return `
      <div id="fields-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px;">
        ${fields.map((f, i) => `
          <div class="field-item" data-idx="${i}" style="
            display:flex;align-items:center;gap:8px;padding:8px 10px;
            background:var(--bg-surface);border-radius:var(--radius-md);
            border:1px solid var(--border-subtle);">
            <span style="font-size:0.875rem;flex-shrink:0;cursor:grab;">⠿</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:0.875rem;font-weight:500;color:var(--text-primary);">${esc(f.label)}</div>
              <div style="font-size:0.75rem;color:var(--text-muted);">
                ${FIELD_TYPES.find(ft=>ft.value===f.type)?.label||f.type}
                ${f.required?' · Obrigatório':''}
                ${f.showInList?' · Exibir na lista':''}
              </div>
            </div>
            <button class="btn btn-ghost btn-icon btn-sm field-edit-btn" data-idx="${i}" title="Editar campo">✎</button>
            <button class="btn btn-ghost btn-icon btn-sm field-remove-btn" data-idx="${i}"
              title="Remover campo" style="color:var(--color-danger);">✕</button>
          </div>
        `).join('')}
      </div>
      <button class="btn btn-secondary btn-sm" id="add-field-btn" style="width:100%;">+ Adicionar campo</button>
    `;
  }

  modal.open({
    title:   isEdit ? `Editar — ${type.name}` : 'Novo Tipo de Tarefa',
    size:    'lg',
    content: `
      <div style="display:flex;flex-direction:column;gap:0;">
        <!-- Tabs -->
        <div style="display:flex;gap:0;margin-bottom:20px;border-bottom:1px solid var(--border-subtle);">
          ${['Geral','Campos','Steps','SLA e Regras'].map((tab, i) => `
            <button class="type-modal-tab ${i===0?'active':''}" data-tab="${i}"
              style="padding:8px 16px;border:none;background:none;cursor:pointer;font-size:0.875rem;
              color:${i===0?'var(--brand-gold)':'var(--text-muted)'};
              border-bottom:2px solid ${i===0?'var(--brand-gold)':'transparent'};
              transition:all 0.15s;">
              ${tab}
            </button>
          `).join('')}
        </div>

        <!-- Tab 0: Geral -->
        <div id="type-tab-0">
          <div class="form-group" style="margin-bottom:14px;">
            <label class="form-label">Nome *</label>
            <input type="text" class="form-input" id="tt-name"
              value="${esc(type?.name||'')}" placeholder="Ex: Post de Blog"
              ${isEdit && type.isSystem ? 'disabled' : ''} maxlength="50" />
            <span class="form-error-msg" id="tt-name-error"></span>
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label class="form-label">Descrição</label>
            <input type="text" class="form-input" id="tt-desc"
              value="${esc(type?.description||'')}" maxlength="120"
              placeholder="Descreva quando este tipo é usado..." />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
            <div class="form-group">
              <label class="form-label">Ícone</label>
              <div style="display:flex;flex-wrap:wrap;gap:6px;">
                ${ICONS.map(icon => `
                  <div class="tt-icon-btn" data-icon="${icon}" style="
                    width:36px;height:36px;border-radius:var(--radius-md);cursor:pointer;
                    display:flex;align-items:center;justify-content:center;font-size:1.1rem;
                    border:2px solid ${(type?.icon||ICONS[0])===icon?'var(--brand-gold)':'var(--border-subtle)'};
                    background:${(type?.icon||ICONS[0])===icon?'rgba(212,168,67,0.12)':'var(--bg-surface)'};
                    transition:all 0.15s;">${icon}</div>
                `).join('')}
              </div>
              <input type="hidden" id="tt-icon" value="${esc(type?.icon||ICONS[0])}" />
            </div>
            <div class="form-group">
              <label class="form-label">Cor</label>
              <div style="display:flex;flex-wrap:wrap;gap:8px;">
                ${COLORS.map(c => `
                  <div class="tt-color-btn" data-color="${c}" style="
                    width:28px;height:28px;border-radius:50%;background:${c};cursor:pointer;
                    border:3px solid ${(type?.color||COLORS[0])===c?'white':'transparent'};
                    box-shadow:${(type?.color||COLORS[0])===c?'0 0 0 2px '+c:'none'};
                    transition:all 0.15s;"></div>
                `).join('')}
              </div>
              <input type="hidden" id="tt-color" value="${esc(type?.color||COLORS[0])}" />
            </div>
          </div>
        </div>

        <!-- Tab 1: Campos customizados -->
        <div id="type-tab-1" style="display:none;">
          <p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:14px;line-height:1.6;">
            Campos adicionais que aparecem no formulário de tarefa quando este tipo é selecionado.
            Campos marcados como "Exibir na lista" aparecem como coluna na página de Tarefas.
          </p>
          <div id="fields-builder">${renderFieldsBuilder()}</div>
        </div>

        <!-- Tab 2: Steps do workflow -->
        <div id="type-tab-2" style="display:none;">
          <p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:14px;line-height:1.6;">
            Steps definem as etapas do fluxo de produção (esteira). Cada step é uma coluna no Kanban personalizado deste tipo.
          </p>
          <div id="steps-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px;">
            ${steps.map((s, i) => `
              <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;
                background:var(--bg-surface);border-radius:var(--radius-md);
                border:1px solid var(--border-subtle);">
                <div style="width:10px;height:10px;border-radius:50%;flex-shrink:0;background:${s.color||'#6B7280'};"></div>
                <span style="flex:1;font-size:0.875rem;color:var(--text-primary);">${esc(s.label)}</span>
                <button class="btn btn-ghost btn-icon btn-sm step-remove-btn" data-idx="${i}"
                  style="color:var(--color-danger);">✕</button>
              </div>
            `).join('')}
          </div>
          <div style="display:flex;gap:8px;">
            <input type="text" class="form-input" id="new-step-input" placeholder="Nome do step..." maxlength="40" style="flex:1;" />
            <button class="btn btn-secondary btn-sm" id="add-step-btn">+ Adicionar</button>
          </div>
        </div>

        <!-- Tab 3: SLA e Regras -->
        <div id="type-tab-3" style="display:none;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
            <div class="form-group">
              <label class="form-label">
                SLA — Dias úteis para entrega
                <span title="Prazo de produção padrão. 0 = mesmo dia." style="cursor:help;color:var(--text-muted);margin-left:4px;">ℹ</span>
              </label>
              <select class="form-select" id="tt-sla-days">
                ${[
                  [0,'Mesmo dia'],[1,'1 dia útil'],[2,'2 dias úteis'],
                  [3,'3 dias úteis'],[5,'5 dias úteis'],[7,'7 dias'],[14,'14 dias'],
                ].map(([v,l]) =>
                  `<option value="${v}" ${(type?.sla?.days??1)===v?'selected':''}>${l}</option>`
                ).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">
                Alerta antecipado (dias)
                <span title="Quantos dias antes do vencimento exibir alerta." style="cursor:help;color:var(--text-muted);margin-left:4px;">ℹ</span>
              </label>
              <input type="number" class="form-input" id="tt-sla-warning"
                value="${type?.sla?.warningDays ?? 1}" min="0" max="7" />
            </div>
          </div>
          <div style="border-top:1px solid var(--border-subtle);padding-top:16px;">
            <div style="font-size:0.875rem;font-weight:600;color:var(--text-primary);margin-bottom:14px;">
              Regras de agendamento
            </div>
            <div style="display:flex;flex-direction:column;gap:12px;">
              ${[
                ['tt-rule-duplicate', 'blockDuplicate', 'Impedir 2 tarefas deste tipo no mesmo dia/workspace',
                 'O sistema bloqueará a criação de uma segunda tarefa deste tipo para o mesmo dia no workspace ativo.',
                 type?.rules?.blockDuplicate],
                ['tt-rule-maxday-check', '_useMaxPerDay', 'Definir limite máximo por dia',
                 'Permite definir um número máximo de tarefas deste tipo criadas por dia.',
                 (type?.rules?.maxPerDay || 0) > 0],
              ].map(([id, key, label, info, checked]) => `
                <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:8px;
                  border-radius:var(--radius-md);background:var(--bg-surface);">
                  <input type="checkbox" id="${id}" ${checked?'checked':''}
                    style="margin-top:2px;accent-color:var(--brand-gold);" />
                  <div>
                    <div style="font-size:0.875rem;color:var(--text-secondary);">${label}</div>
                    <div style="font-size:0.75rem;color:var(--text-muted);margin-top:3px;">${info}</div>
                  </div>
                </label>
              `).join('')}
              <div id="max-per-day-input" style="display:${(type?.rules?.maxPerDay||0)>0?'flex':'none'};align-items:center;gap:10px;padding:0 8px;">
                <span style="font-size:0.875rem;color:var(--text-secondary);">Máximo por dia:</span>
                <input type="number" class="form-input" id="tt-rule-maxday"
                  value="${type?.rules?.maxPerDay||1}" min="1" max="99"
                  style="width:80px;padding:6px 10px;" />
              </div>
            </div>
          </div>
        </div>
      </div>
    `,
    footer: [
      { label:'Cancelar', class:'btn-secondary', closeOnClick:true },
      {
        label: isEdit ? 'Salvar alterações' : 'Criar tipo',
        class: 'btn-primary', closeOnClick: false,
        onClick: async (_, { close }) => {
          const name  = document.getElementById('tt-name')?.value?.trim();
          const errEl = document.getElementById('tt-name-error');
          if (!name && !type?.isSystem) {
            if(errEl) errEl.textContent='Nome é obrigatório.'; return;
          }
          if(errEl) errEl.textContent='';

          const slaDay  = parseInt(document.getElementById('tt-sla-days')?.value) || 1;
          const slaWarn = parseInt(document.getElementById('tt-sla-warning')?.value) || 0;
          const SLA_LABELS = {0:'Mesmo dia',1:'1 dia útil',2:'2 dias úteis',3:'3 dias úteis',5:'5 dias úteis',7:'7 dias',14:'14 dias'};

          const blockDup   = document.getElementById('tt-rule-duplicate')?.checked || false;
          const useMax     = document.getElementById('tt-rule-maxday-check')?.checked || false;
          const maxPerDay  = useMax ? (parseInt(document.getElementById('tt-rule-maxday')?.value)||1) : 0;

          const data = {
            name:        name || type.name,
            description: document.getElementById('tt-desc')?.value?.trim() || '',
            icon:        document.getElementById('tt-icon')?.value  || ICONS[0],
            color:       document.getElementById('tt-color')?.value || COLORS[0],
            fields,
            steps,
            sla:  { days: slaDay, label: SLA_LABELS[slaDay]||`${slaDay} dias`, warningDays: slaWarn },
            rules: { blockDuplicate: blockDup, maxPerDay, maxPerDayPerNucleo: 0 },
          };

          const btn = document.querySelector('.modal-footer .btn-primary');
          if(btn){ btn.classList.add('loading'); btn.disabled=true; }
          try {
            if (isEdit) {
              await updateTaskType(type.id, data);
              toast.success('Tipo atualizado!');
            } else {
              await createTaskType(data);
              toast.success(`Tipo "${data.name}" criado!`);
            }
            close();
            await loadTypes();
          } catch(e) { toast.error(e.message); }
          finally { if(btn){ btn.classList.remove('loading'); btn.disabled=false; } }
        },
      },
    ],
  });

  // Bind tabs, icons, colors, fields, steps
  setTimeout(() => {
    // Tabs
    document.querySelectorAll('.type-modal-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.type-modal-tab').forEach(t => {
          t.classList.remove('active');
          t.style.color       = 'var(--text-muted)';
          t.style.borderColor = 'transparent';
        });
        tab.classList.add('active');
        tab.style.color       = 'var(--brand-gold)';
        tab.style.borderBottom = '2px solid var(--brand-gold)';
        const idx = tab.dataset.tab;
        document.querySelectorAll('[id^="type-tab-"]').forEach(p => p.style.display='none');
        document.getElementById(`type-tab-${idx}`).style.display='block';
      });
    });

    // Icons
    document.querySelectorAll('.tt-icon-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('tt-icon').value = btn.dataset.icon;
        document.querySelectorAll('.tt-icon-btn').forEach(b => {
          b.style.borderColor = 'var(--border-subtle)';
          b.style.background  = 'var(--bg-surface)';
        });
        btn.style.borderColor = 'var(--brand-gold)';
        btn.style.background  = 'rgba(212,168,67,0.12)';
      });
    });

    // Colors
    document.querySelectorAll('.tt-color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('tt-color').value = btn.dataset.color;
        document.querySelectorAll('.tt-color-btn').forEach(b => {
          b.style.borderColor = 'transparent'; b.style.boxShadow='none';
        });
        btn.style.borderColor = 'white';
        btn.style.boxShadow   = `0 0 0 2px ${btn.dataset.color}`;
      });
    });

    // Fields builder events
    bindFieldsBuilder();

    // Steps events
    document.getElementById('add-step-btn')?.addEventListener('click', () => {
      const input = document.getElementById('new-step-input');
      const label = input?.value?.trim();
      if (!label) return;
      const STEP_COLORS = ['#6B7280','#38BDF8','#A78BFA','#F59E0B','#22C55E','#06B6D4'];
      steps.push({ id: crypto.randomUUID(), label, color: STEP_COLORS[steps.length % STEP_COLORS.length], order: steps.length });
      input.value = '';
      refreshStepsList();
    });

    // Max per day toggle
    document.getElementById('tt-rule-maxday-check')?.addEventListener('change', (e) => {
      document.getElementById('max-per-day-input').style.display = e.target.checked ? 'flex' : 'none';
    });
  }, 80);

  function bindFieldsBuilder() {
    document.getElementById('add-field-btn')?.addEventListener('click', () => openFieldModal());
    document.querySelectorAll('.field-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openFieldModal(parseInt(btn.dataset.idx)));
    });
    document.querySelectorAll('.field-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        fields.splice(parseInt(btn.dataset.idx), 1);
        refreshFieldsBuilder();
      });
    });
  }

  function refreshFieldsBuilder() {
    const el = document.getElementById('fields-builder');
    if (el) { el.innerHTML = renderFieldsBuilder(); bindFieldsBuilder(); }
  }

  function refreshStepsList() {
    const el = document.getElementById('steps-list');
    if (!el) return;
    el.innerHTML = steps.map((s, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;
        background:var(--bg-surface);border-radius:var(--radius-md);
        border:1px solid var(--border-subtle);">
        <div style="width:10px;height:10px;border-radius:50%;flex-shrink:0;background:${s.color||'#6B7280'};"></div>
        <span style="flex:1;font-size:0.875rem;color:var(--text-primary);">${esc(s.label)}</span>
        <button class="btn btn-ghost btn-icon btn-sm step-remove-btn" data-idx="${i}"
          style="color:var(--color-danger);">✕</button>
      </div>
    `).join('');
    el.querySelectorAll('.step-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => { steps.splice(parseInt(btn.dataset.idx), 1); refreshStepsList(); });
    });
  }

  function openFieldModal(editIdx = null) {
    const isFieldEdit = editIdx !== null;
    const f = isFieldEdit ? { ...fields[editIdx] } : {
      key: '', label: '', type: 'text', options: [], required: false,
      showInList: false, showInCalendar: false, showInKanban: false, info: '',
    };

    modal.open({
      title:   isFieldEdit ? 'Editar Campo' : 'Novo Campo',
      size:    'sm',
      content: `
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div class="form-group">
            <label class="form-label">Rótulo do campo *
              <span title="Nome que aparece para o usuário no formulário." style="cursor:help;color:var(--text-muted);margin-left:4px;">ℹ</span>
            </label>
            <input type="text" class="form-input" id="ff-label" value="${esc(f.label)}" maxlength="50" />
          </div>
          <div class="form-group">
            <label class="form-label">Tipo de campo *
              <span title="Como o usuário vai preencher este campo." style="cursor:help;color:var(--text-muted);margin-left:4px;">ℹ</span>
            </label>
            <select class="form-select" id="ff-type">
              ${FIELD_TYPES.map(ft =>
                `<option value="${ft.value}" ${f.type===ft.value?'selected':''}>${ft.icon} ${ft.label}</option>`
              ).join('')}
            </select>
          </div>
          <div id="ff-options-group" style="display:${['select','multiselect'].includes(f.type)?'block':'none'};">
            <div class="form-group">
              <label class="form-label">Opções (uma por linha) *
                <span title="Liste as opções disponíveis, uma por linha." style="cursor:help;color:var(--text-muted);margin-left:4px;">ℹ</span>
              </label>
              <textarea class="form-textarea" id="ff-options" rows="4"
                placeholder="Opção 1&#10;Opção 2&#10;Opção 3">${(f.options||[]).join('\n')}</textarea>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Tooltip / ajuda
              <span title="Texto de ajuda que aparece ao passar o mouse no campo." style="cursor:help;color:var(--text-muted);margin-left:4px;">ℹ</span>
            </label>
            <input type="text" class="form-input" id="ff-info" value="${esc(f.info||'')}" maxlength="200"
              placeholder="Ex: Selecione a etapa atual do fluxo..." />
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${[
              ['ff-required',        'Obrigatório',            'O usuário deve preencher antes de salvar.',                  f.required],
              ['ff-show-list',       'Exibir na lista',        'Aparece como coluna na página de Tarefas.',                  f.showInList],
              ['ff-show-calendar',   'Filtro no calendário',   'Disponível como filtro na visão de calendário.',             f.showInCalendar],
              ['ff-show-kanban',     'Exibir no card kanban',  'Aparece no card da tarefa no Kanban.',                       f.showInKanban],
            ].map(([id, label, info, checked]) => `
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:6px 8px;
                border-radius:var(--radius-sm);background:var(--bg-surface);">
                <input type="checkbox" id="${id}" ${checked?'checked':''}
                  style="accent-color:var(--brand-gold);" />
                <div>
                  <div style="font-size:0.875rem;color:var(--text-secondary);">${label}</div>
                  <div style="font-size:0.75rem;color:var(--text-muted);">${info}</div>
                </div>
              </label>
            `).join('')}
          </div>
        </div>
      `,
      footer: [
        { label:'Cancelar', class:'btn-secondary', closeOnClick:true },
        {
          label: isFieldEdit ? 'Salvar campo' : 'Adicionar campo',
          class: 'btn-primary', closeOnClick: false,
          onClick: (_, { close }) => {
            const label = document.getElementById('ff-label')?.value?.trim();
            if (!label) { toast.warning('Rótulo é obrigatório.'); return; }

            const type   = document.getElementById('ff-type')?.value || 'text';
            const key    = label.toLowerCase()
              .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
              .replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
            const options = ['select','multiselect'].includes(type)
              ? (document.getElementById('ff-options')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean)
              : [];

            const newField = {
              id:             f.id || crypto.randomUUID(),
              key:            isFieldEdit ? f.key : key,
              label,
              type,
              options,
              info:           document.getElementById('ff-info')?.value?.trim() || '',
              required:       document.getElementById('ff-required')?.checked    || false,
              showInList:     document.getElementById('ff-show-list')?.checked   || false,
              showInCalendar: document.getElementById('ff-show-calendar')?.checked || false,
              showInKanban:   document.getElementById('ff-show-kanban')?.checked   || false,
            };

            if (isFieldEdit) fields[editIdx] = newField;
            else fields.push(newField);

            close();
            refreshFieldsBuilder();
          },
        },
      ],
    });

    setTimeout(() => {
      document.getElementById('ff-type')?.addEventListener('change', (e) => {
        const show = ['select','multiselect'].includes(e.target.value);
        document.getElementById('ff-options-group').style.display = show ? 'block' : 'none';
      });
    }, 50);
  }
}

async function confirmDelete(typeId) {
  const type = allTypes.find(t => t.id === typeId);
  if (!type) return;
  const ok = await modal.confirm({
    title:       `Excluir "${type.name}"`,
    message:     `Excluir este tipo de tarefa? Tarefas existentes deste tipo não serão excluídas, mas perderão o vínculo.`,
    confirmText: 'Excluir', danger: true, icon: '✕',
  });
  if (!ok) return;
  try {
    await deleteTaskType(typeId);
    toast.success(`Tipo "${type.name}" excluído.`);
    await loadTypes();
  } catch(e) { toast.error(e.message); }
}
