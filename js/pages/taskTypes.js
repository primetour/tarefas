/**
 * PRIMETOUR — Task Types Page (rebuilt)
 * Tipos de tarefa com categorias, variações, núcleos e padrão de entrega
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import {
  fetchTaskTypes, createTaskType, updateTaskType, deleteTaskType, getTaskType,
} from '../services/taskTypes.js';
import {
  fetchCategories, createCategory, updateCategory, deleteCategory,
  CATEGORY_COLORS,
} from '../services/taskCategories.js';
import { loadNucleos } from '../services/sectors.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const TYPE_COLORS = ['#D4A843','#38BDF8','#22C55E','#A78BFA','#F97316','#EC4899','#EF4444','#14B8A6','#6366F1','#6B7280'];
const TYPE_ICONS  = ['📋','🎨','📣','📊','🌐','⚙','🤖','📧','📸','🎬','📝','🔗','📰','🗂','✅'];

let allTypes      = [];
let allCategories = [];
let allNucleos    = [];

/* ─── Render ─────────────────────────────────────────────── */
export async function renderTaskTypes(container) {
  const canCreate = store.can('task_type_create');
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Tipos de Tarefa</h1>
        <p class="page-subtitle">Configure os tipos de demandas com variações e padrões de entrega</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-secondary" id="manage-categories-btn">◈ Categorias</button>
        ${canCreate ? `<button class="btn btn-primary" id="new-type-btn">+ Novo Tipo</button>` : ''}
      </div>
    </div>
    <div id="types-grid">
      ${[0,1].map(()=>'<div class="card skeleton" style="height:160px;margin-bottom:12px;"></div>').join('')}
    </div>
  `;
  document.getElementById('manage-categories-btn')?.addEventListener('click', openCategoriesModal);
  document.getElementById('new-type-btn')?.addEventListener('click', () => openTypeModal());
  await loadAll();
}

async function loadAll() {
  const nucleosRaw = store.get('nucleos');
  [allTypes, allCategories, allNucleos] = await Promise.all([
    fetchTaskTypes().catch(() => []),
    fetchCategories().catch(() => []),
    nucleosRaw?.length ? Promise.resolve(nucleosRaw) : loadNucleos().catch(() => []),
  ]);
  renderGrid();
}

function renderGrid() {
  const grid = document.getElementById('types-grid');
  if (!grid) return;
  const canEdit = store.can('task_type_edit');
  if (!allTypes.length) {
    grid.innerHTML = `<div class="empty-state" style="min-height:35vh;">
      <div class="empty-state-icon">📋</div>
      <div class="empty-state-title">Nenhum tipo cadastrado</div>
    </div>`;
    return;
  }
  const grouped = {};
  allTypes.forEach(t => {
    const cat = t.categoryName || 'Sem categoria';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(t);
  });
  grid.innerHTML = Object.entries(grouped).map(([cat, types]) => `
    <div style="margin-bottom:28px;">
      <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;
        color:var(--text-muted);margin-bottom:12px;padding-bottom:6px;
        border-bottom:1px solid var(--border-subtle);">${esc(cat)}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;">
        ${types.map(t => renderTypeCard(t, canEdit)).join('')}
      </div>
    </div>
  `).join('');
  grid.querySelectorAll('.type-edit-btn').forEach(btn =>
    btn.addEventListener('click', async () => {
      const t = await getTaskType(btn.dataset.id).catch(() => allTypes.find(x=>x.id===btn.dataset.id));
      if (t) openTypeModal(t);
    })
  );
  grid.querySelectorAll('.type-delete-btn').forEach(btn =>
    btn.addEventListener('click', () => confirmDelete(btn.dataset.id))
  );
}

function renderTypeCard(t, canEdit) {
  const variations  = t.variations || [];
  const nucleoNames = (t.nucleos||[]).map(nid => {
    const n = allNucleos.find(x => x.id===nid || x.name===nid);
    return n?.name || nid;
  }).join(', ');
  return `
    <div class="card" style="border-left:3px solid ${t.color||'#6B7280'};">
      <div class="card-body" style="padding:14px 16px;">
        <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;">
          <div style="width:36px;height:36px;border-radius:var(--radius-md);flex-shrink:0;
            background:${t.color||'#6B7280'}22;display:flex;align-items:center;
            justify-content:center;font-size:1.125rem;">${t.icon||'📋'}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;color:var(--text-primary);">${esc(t.name)}</div>
            ${t.isSystem?`<span style="font-size:0.625rem;padding:1px 6px;border-radius:var(--radius-full);
              background:var(--bg-elevated);color:var(--text-muted);">Sistema</span>`:''}
            ${t.description?`<div style="font-size:0.8125rem;color:var(--text-muted);margin-top:2px;
              overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.description)}</div>`:''}
          </div>
          ${canEdit ? `<div style="display:flex;gap:4px;">
            <button class="btn btn-ghost btn-icon btn-sm type-edit-btn" data-id="${t.id}" title="Editar">✎</button>
            ${!t.isSystem?`<button class="btn btn-ghost btn-icon btn-sm type-delete-btn" data-id="${t.id}"
              style="color:var(--color-danger);" title="Excluir">✕</button>`:''}
          </div>` : ''}
        </div>
        ${variations.length ? `
          <div style="margin-bottom:8px;">
            <div style="font-size:0.6875rem;color:var(--text-muted);margin-bottom:4px;">Variações</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;">
              ${variations.map(v=>`<span style="font-size:0.75rem;padding:2px 8px;border-radius:var(--radius-full);
                background:${t.color||'#6B7280'}15;color:${t.color||'#6B7280'};
                border:1px solid ${t.color||'#6B7280'}33;">
                ${esc(v.name)} · ${v.slaDays===0?'mesmo dia':`${v.slaDays}d`}
              </span>`).join('')}
            </div>
          </div>
        ` : ''}
        <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:0.75rem;color:var(--text-muted);">
          ${nucleoNames?`<span>◈ ${esc(nucleoNames)}</span>`:''}
          ${(t.steps||[]).length?`<span>▶ ${t.steps.length} etapa${t.steps.length!==1?'s':''}</span>`:''}
          ${t.deliveryStandard?`<span title="${esc(t.deliveryStandard)}" style="cursor:help;">📄 Padrão definido</span>`:''}
        </div>
      </div>
    </div>
  `;
}

/* ─── Modal tipo ──────────────────────────────────────────── */
function openTypeModal(type = null) {
  const isEdit   = !!type;
  const nucleos  = allNucleos;
  let variations = type?.variations?.length ? [...type.variations] : [{ id:'_v1', name:'', slaDays:1 }];
  let steps      = [...(type?.steps || [])];

  function renderVarRow(v, i) {
    return `<div class="tt-var-row" data-idx="${i}"
      style="display:grid;grid-template-columns:1fr 100px 32px;gap:8px;align-items:center;">
      <input type="text" class="form-input tt-var-name" value="${esc(v.name)}"
        placeholder="Ex: Revisão de layout" style="font-size:0.875rem;" />
      <div style="display:flex;align-items:center;gap:4px;">
        <input type="number" class="form-input tt-var-sla" value="${v.slaDays}"
          min="0" max="90" style="font-size:0.875rem;text-align:center;padding:8px 6px;" />
        <span style="font-size:0.6875rem;color:var(--text-muted);white-space:nowrap;">d</span>
      </div>
      <button class="btn btn-ghost btn-icon btn-sm tt-var-del" style="color:var(--color-danger);">✕</button>
    </div>`;
  }

  function renderStepRow(s, i) {
    return `<div class="tt-step-row" data-idx="${i}"
      style="display:grid;grid-template-columns:1fr 36px 32px;gap:8px;align-items:center;">
      <input type="text" class="form-input tt-step-lbl" value="${esc(s.label)}"
        placeholder="Nome da etapa" style="font-size:0.875rem;" />
      <input type="color" class="tt-step-col" value="${s.color||'#6B7280'}"
        style="height:34px;width:36px;padding:2px;border:1px solid var(--border-subtle);
        border-radius:var(--radius-sm);background:var(--bg-surface);cursor:pointer;" />
      <button class="btn btn-ghost btn-icon btn-sm tt-step-del" style="color:var(--color-danger);">✕</button>
    </div>`;
  }

  function collectVars() {
    const rows = document.querySelectorAll('.tt-var-row');
    rows.forEach((row, i) => {
      if (variations[i]) {
        variations[i].name    = row.querySelector('.tt-var-name')?.value?.trim() || '';
        variations[i].slaDays = parseInt(row.querySelector('.tt-var-sla')?.value) || 0;
      }
    });
  }

  function collectSteps() {
    document.querySelectorAll('.tt-step-row').forEach((row, i) => {
      if (steps[i]) {
        steps[i].label = row.querySelector('.tt-step-lbl')?.value?.trim() || '';
        steps[i].color = row.querySelector('.tt-step-col')?.value || '#6B7280';
      }
    });
  }

  function rebuildVars() {
    const list = document.getElementById('tt-var-list');
    if (!list) return;
    list.innerHTML = variations.map((v,i) => renderVarRow(v, i)).join('');
    list.querySelectorAll('.tt-var-del').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        collectVars();
        variations.splice(i, 1);
        if (!variations.length) variations.push({ id:'_v', name:'', slaDays:1 });
        rebuildVars();
      });
    });
  }

  function rebuildSteps() {
    const list = document.getElementById('tt-step-list');
    if (!list) return;
    list.innerHTML = steps.map((s,i) => renderStepRow(s, i)).join('');
    list.querySelectorAll('.tt-step-del').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        collectSteps();
        steps.splice(i, 1);
        rebuildSteps();
      });
    });
  }

  modal.open({
    title:   isEdit ? `Editar — ${type.name}` : 'Novo Tipo de Tarefa',
    size:    'lg',
    content: `<div style="display:flex;flex-direction:column;gap:16px;">

      <!-- Nome + ícone + cor -->
      <div style="display:grid;grid-template-columns:1fr 80px 130px;gap:12px;align-items:end;">
        <div class="form-group" style="margin:0;">
          <label class="form-label">Nome *</label>
          <input type="text" class="form-input" id="tt-name" value="${esc(type?.name||'')}"
            maxlength="60" placeholder="Ex: Apresentações" />
          <span class="form-error-msg" id="tt-name-err"></span>
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label">Ícone</label>
          <select class="form-select" id="tt-icon">
            ${TYPE_ICONS.map(i=>`<option value="${i}" ${(type?.icon||'📋')===i?'selected':''}>${i}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label">Cor</label>
          <div style="display:flex;gap:4px;flex-wrap:wrap;">
            ${TYPE_COLORS.map(c=>`<div class="tt-color-btn" data-color="${c}" style="
              width:20px;height:20px;border-radius:50%;background:${c};cursor:pointer;
              border:2px solid ${(type?.color||TYPE_COLORS[0])===c?'white':'transparent'};
              box-shadow:${(type?.color||TYPE_COLORS[0])===c?`0 0 0 2px ${c}`:'none'};"></div>`).join('')}
          </div>
          <input type="hidden" id="tt-color" value="${type?.color||TYPE_COLORS[0]}" />
        </div>
      </div>

      <!-- Descrição -->
      <div class="form-group">
        <label class="form-label">Descrição</label>
        <input type="text" class="form-input" id="tt-desc" value="${esc(type?.description||'')}"
          maxlength="120" placeholder="Descreva brevemente este tipo..." />
      </div>

      <!-- Categoria -->
      <div class="form-group">
        <label class="form-label">Categoria</label>
        <div style="display:flex;gap:8px;">
          <select class="form-select" id="tt-cat" style="flex:1;">
            <option value="">— Sem categoria —</option>
            ${allCategories.map(c=>`<option value="${c.id}|${c.name}" ${type?.categoryId===c.id?'selected':''}>${esc(c.icon||'')} ${esc(c.name)}</option>`).join('')}
          </select>
          <button class="btn btn-ghost btn-sm" id="tt-new-cat-btn" type="button">+ Nova</button>
        </div>
      </div>

      <!-- Núcleos -->
      <div class="form-group">
        <label class="form-label">Núcleo(s) de produção</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${nucleos.length ? nucleos.map(n => {
            const nid = n.id || n.name;
            const sel = (type?.nucleos||[]).includes(nid) || (type?.nucleos||[]).includes(n.name);
            return `<label class="nucleo-chip-lbl" style="display:flex;align-items:center;gap:5px;
              cursor:pointer;padding:4px 10px;border-radius:var(--radius-full);font-size:0.8125rem;
              border:1px solid ${sel?'var(--brand-gold)':'var(--border-subtle)'};
              background:${sel?'rgba(212,168,67,0.12)':'var(--bg-surface)'};
              color:${sel?'var(--brand-gold)':'var(--text-secondary)'};transition:all 0.15s;">
              <input type="checkbox" value="${nid}" class="tt-nucleo-cb" ${sel?'checked':''}
                style="display:none;" />${esc(n.name)}
            </label>`;
          }).join('') : `<span style="font-size:0.8125rem;color:var(--text-muted);">Nenhum núcleo disponível. Cadastre em Setores e Núcleos.</span>`}
        </div>
      </div>

      <!-- Padrão de entrega -->
      <div class="form-group">
        <label class="form-label">Padrão de entrega
          <span title="O que se espera como entregável para este tipo." style="cursor:help;color:var(--text-muted);font-size:0.75rem;">ℹ</span>
        </label>
        <textarea class="form-textarea" id="tt-delivery" rows="2" style="resize:vertical;"
          placeholder="Ex: Apresentação de até 15 slides com identidade visual da marca...">${esc(type?.deliveryStandard||'')}</textarea>
      </div>

      <!-- Variações -->
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <label class="form-label" style="margin:0;">Variações do material
            <span title="Nome da variação + SLA em dias (0 = mesmo dia)." style="cursor:help;color:var(--text-muted);font-size:0.75rem;">ℹ</span>
          </label>
          <button class="btn btn-ghost btn-sm" id="tt-add-var-btn" type="button">+ Variação</button>
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:8px;display:flex;gap:0;">
          <span style="flex:1;">Nome da variação</span>
          <span style="width:100px;text-align:center;">SLA (dias)</span>
          <span style="width:32px;"></span>
        </div>
        <div id="tt-var-list" style="display:flex;flex-direction:column;gap:6px;">
          ${variations.map((v,i) => renderVarRow(v, i)).join('')}
        </div>
      </div>

      <!-- Steps (esteira) -->
      <details style="border:1px solid var(--border-subtle);border-radius:var(--radius-md);">
        <summary style="padding:10px 14px;cursor:pointer;font-size:0.875rem;font-weight:500;
          color:var(--text-secondary);user-select:none;">
          ▶ Esteira de produção (${steps.length} etapa${steps.length!==1?'s':''})
        </summary>
        <div style="padding:12px 14px;border-top:1px solid var(--border-subtle);">
          <div id="tt-step-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">
            ${steps.map((s,i) => renderStepRow(s, i)).join('')}
          </div>
          <button class="btn btn-ghost btn-sm" id="tt-add-step-btn" type="button">+ Etapa</button>
        </div>
      </details>
    </div>`,
    footer: [
      { label:'Cancelar', class:'btn-secondary', closeOnClick:true },
      {
        label: isEdit ? 'Salvar' : 'Criar tipo',
        class: 'btn-primary', closeOnClick: false,
        onClick: async (_, { close }) => {
          const name  = document.getElementById('tt-name')?.value?.trim();
          const errEl = document.getElementById('tt-name-err');
          if (!name) { if(errEl) errEl.textContent='Nome obrigatório.'; return; }
          if(errEl) errEl.textContent = '';
          collectVars(); collectSteps();
          const catRaw = document.getElementById('tt-cat')?.value || '';
          const [catId, catName] = catRaw.includes('|') ? catRaw.split('|') : [null,''];
          const nucleosSelected  = Array.from(document.querySelectorAll('.tt-nucleo-cb:checked')).map(cb => cb.value);
          const data = {
            name,
            description:      document.getElementById('tt-desc')?.value?.trim()     || '',
            icon:             document.getElementById('tt-icon')?.value              || '📋',
            color:            document.getElementById('tt-color')?.value             || TYPE_COLORS[0],
            categoryId:       catId   || null,
            categoryName:     catName || '',
            nucleos:          nucleosSelected,
            deliveryStandard: document.getElementById('tt-delivery')?.value?.trim()  || '',
            variations:       variations.filter(v => v.name?.trim()),
            steps,
            fields:           type?.fields?.filter(f=>!f.system) || [],
          };
          const btn = document.querySelector('.modal-footer .btn-primary');
          if(btn){ btn.classList.add('loading'); btn.disabled=true; }
          try {
            if (isEdit) { await updateTaskType(type.id, data); toast.success('Tipo atualizado!'); }
            else        { await createTaskType(data);           toast.success('Tipo criado!'); }
            close(); await loadAll();
          } catch(e) { toast.error(e.message); }
          finally { if(btn){ btn.classList.remove('loading'); btn.disabled=false; } }
        },
      },
    ],
  });

  setTimeout(() => {
    // Color swatches
    document.querySelectorAll('.tt-color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('tt-color').value = btn.dataset.color;
        document.querySelectorAll('.tt-color-btn').forEach(b => { b.style.borderColor='transparent'; b.style.boxShadow='none'; });
        btn.style.borderColor = 'white';
        btn.style.boxShadow   = `0 0 0 2px ${btn.dataset.color}`;
      });
    });
    // Nucleo chips
    document.querySelectorAll('.nucleo-chip-lbl').forEach(chip => {
      chip.addEventListener('click', () => {
        const cb = chip.querySelector('.tt-nucleo-cb');
        if (!cb) return;
        cb.checked             = !cb.checked;
        chip.style.borderColor = cb.checked ? 'var(--brand-gold)'     : 'var(--border-subtle)';
        chip.style.background  = cb.checked ? 'rgba(212,168,67,0.12)' : 'var(--bg-surface)';
        chip.style.color       = cb.checked ? 'var(--brand-gold)'     : 'var(--text-secondary)';
      });
    });
    // Add variation
    document.getElementById('tt-add-var-btn')?.addEventListener('click', () => {
      collectVars();
      variations.push({ id: 'v'+Date.now(), name:'', slaDays:1 });
      rebuildVars();
    });
    rebuildVars();
    // Add step
    document.getElementById('tt-add-step-btn')?.addEventListener('click', () => {
      collectSteps();
      steps.push({ id:'s'+Date.now(), label:'', color:'#6B7280', order:steps.length });
      rebuildSteps();
    });
    rebuildSteps();
    // Inline new category
    document.getElementById('tt-new-cat-btn')?.addEventListener('click', async () => {
      const name = prompt('Nome da nova categoria:');
      if (!name?.trim()) return;
      try {
        const cat = await createCategory({ name:name.trim(), color:CATEGORY_COLORS[0], icon:'📋' });
        allCategories.push(cat);
        const sel = document.getElementById('tt-cat');
        if (sel) {
          const opt = document.createElement('option');
          opt.value = `${cat.id}|${cat.name}`; opt.textContent = cat.name; opt.selected = true;
          sel.appendChild(opt);
        }
        toast.success('Categoria criada!');
      } catch(e) { toast.error(e.message); }
    });
  }, 60);
}

/* ─── Categories modal ──────────────────────────────────── */
function openCategoriesModal() {
  const render = () => `
    <div style="display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto;">
      ${!allCategories.length
        ? `<p style="font-size:0.875rem;color:var(--text-muted);">Nenhuma categoria.</p>`
        : allCategories.map(c => `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;
            border-radius:var(--radius-md);background:var(--bg-surface);border:1px solid var(--border-subtle);">
            <div style="width:8px;height:8px;border-radius:50%;background:${c.color||'#6B7280'};flex-shrink:0;"></div>
            <span style="font-size:0.875rem;flex:1;">${esc(c.name)}</span>
            <button class="btn btn-ghost btn-icon btn-sm cat-edit" data-id="${c.id}">✎</button>
            <button class="btn btn-ghost btn-icon btn-sm cat-del" data-id="${c.id}" style="color:var(--color-danger);">✕</button>
          </div>`).join('')}
    </div>`;

  modal.open({
    title:'Gerenciar Categorias', size:'sm',
    content:`
      <div style="display:flex;gap:8px;margin-bottom:14px;">
        <input type="text" class="form-input" id="new-cat-nm" placeholder="Nome da categoria" style="flex:1;" maxlength="40"/>
        <button class="btn btn-primary btn-sm" id="add-cat-btn">+ Criar</button>
      </div>
      <div id="cat-list">${render()}</div>`,
    footer:[{label:'Fechar',class:'btn-secondary',closeOnClick:true}],
  });

  setTimeout(() => {
    const refresh = () => {
      const el = document.getElementById('cat-list');
      if (el) el.innerHTML = render();
      bind(refresh);
    };
    bind(refresh);
    document.getElementById('add-cat-btn')?.addEventListener('click', async () => {
      const name = document.getElementById('new-cat-nm')?.value?.trim();
      if (!name) return;
      try {
        const cat = await createCategory({ name, color:CATEGORY_COLORS[0], icon:'📋' });
        allCategories.push(cat);
        document.getElementById('new-cat-nm').value = '';
        refresh(); toast.success('Categoria criada!');
      } catch(e) { toast.error(e.message); }
    });
  }, 60);

  function bind(refresh) {
    document.querySelectorAll('.cat-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Excluir esta categoria?')) return;
        await deleteCategory(btn.dataset.id).catch(e=>toast.error(e.message));
        allCategories = allCategories.filter(c=>c.id!==btn.dataset.id);
        refresh();
      });
    });
    document.querySelectorAll('.cat-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat  = allCategories.find(c=>c.id===btn.dataset.id);
        if (!cat) return;
        const name = prompt('Novo nome:', cat.name);
        if (!name?.trim()) return;
        updateCategory(cat.id, {name:name.trim()}).then(() => { cat.name=name.trim(); refresh(); }).catch(e=>toast.error(e.message));
      });
    });
  }
}

/* ─── Delete type ────────────────────────────────────────── */
async function confirmDelete(typeId) {
  const t = allTypes.find(x=>x.id===typeId);
  if (!t) return;
  const ok = await modal.confirm({
    title:`Excluir "${t.name}"`,message:'Tarefas existentes não serão afetadas.',
    confirmText:'Excluir',danger:true,icon:'✕',
  });
  if (!ok) return;
  try {
    await deleteTaskType(typeId);
    toast.success('Tipo excluído.');
    await loadAll();
  } catch(e) { toast.error(e.message); }
}
