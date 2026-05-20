/**
 * PRIMETOUR — Bulk Task Create Modal (4.39.0+)
 *
 * Tabela tipo Excel pra criar várias tarefas de uma vez.
 * Defaults no topo aplicam pra todas as linhas em branco.
 * Suporta paste do Excel (TSV) e adição/remoção de linhas dinâmica.
 */

import { store } from '../store.js';
import { modal } from './modal.js';
import { toast } from './toast.js';
import { bulkCreateTasks, PRIORITIES, STATUSES, REQUESTING_AREAS } from '../services/tasks.js';

const esc = s => String(s||'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// 4.39.0+ Estado interno: linhas + defaults (4.39.2+ usa requestingArea no lugar de sector)
let _rows = [];
let _defaults = { workspaceId: '', requestingArea: '', typeId: '', priority: 'medium' };
let _users = [];
let _projects = [];
let _types = [];
let _workspaces = [];

let _rowIdSeq = 0;
function newRowId() { return 'br-' + (++_rowIdSeq); }

function emptyRow() {
  return {
    id: newRowId(),
    title: '',
    assigneeId: '',
    projectId: '',
    dueDate: '',
    priority: '',
    typeId: '',
    tags: '',
  };
}

export async function openBulkTaskCreateModal({ projectId = null, workspaceId = null } = {}) {
  if (!store.can('task_create')) {
    toast.error('Sem permissão para criar tarefas.');
    return;
  }

  // Reset estado
  _rows = [emptyRow(), emptyRow(), emptyRow()];  // 3 linhas em branco pra começar
  _defaults = {
    workspaceId: workspaceId || '',
    requestingArea: '',
    typeId: '',
    priority: 'medium',
  };

  // 4.39.2+ Pre-load — Área usa REQUESTING_AREAS (canônico, mesmo do form single)
  try {
    const [usersMod, projsMod, typesMod, wsMod] = await Promise.all([
      import('../services/users.js'),
      import('../services/projects.js'),
      import('../services/taskTypes.js'),
      import('../services/workspaces.js'),
    ]);
    _users      = (await usersMod.fetchUsers({ active: true }).catch(() => store.get('users') || [])) || [];
    _projects   = (await projsMod.fetchProjects().catch(() => [])) || [];
    _types      = (await typesMod.fetchTaskTypes().catch(() => [])) || [];
    _workspaces = (await wsMod.fetchAllWorkspaces?.().catch(() => [])) || [];
  } catch (e) {
    console.warn('[bulkTaskCreate] erro pre-load:', e?.message);
  }

  // Se veio projectId, força nas linhas
  if (projectId) _rows.forEach(r => r.projectId = projectId);

  modal.open({
    title: '➕ Criar tarefas em lote',
    size: 'xl',
    dedupeKey: 'bulk-task-create',
    content: renderContent(),
    footer: [
      { label: 'Cancelar', class: 'btn-secondary' },
      {
        label: '▶ Criar tarefas',
        class: 'btn-primary',
        closeOnClick: false,
        onClick: handleSubmit,
      },
    ],
  });

  // Wire after modal opens
  setTimeout(() => wireEvents(), 60);
}

/* ─── Render ─────────────────────────────────────────────── */
function renderContent() {
  return `
    <div style="display:flex;flex-direction:column;gap:14px;max-height:70vh;overflow:auto;">
      <p style="margin:0;font-size:0.8125rem;color:var(--text-muted);line-height:1.5;">
        Preencha o título de cada tarefa (obrigatório). Os outros campos podem ser deixados em branco —
        usarão os valores padrão definidos abaixo. Você também pode <strong>colar do Excel</strong> uma
        seleção de células direto numa célula da tabela.
      </p>

      <!-- DEFAULTS aplicados a todas as linhas em branco -->
      <div style="background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.3);border-radius:8px;padding:14px 16px;">
        <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--brand-gold);margin-bottom:10px;">
          ⚙ Aplicar a todas (preenche o que ficar vazio na linha)
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;">
          <div>
            <label style="font-size:0.7rem;font-weight:600;display:block;margin-bottom:4px;">Squad</label>
            <select id="bdef-workspace" class="form-select" style="width:100%;font-size:0.8125rem;">
              <option value="">— Nenhum —</option>
              ${_workspaces.map(w => `<option value="${esc(w.id)}" ${_defaults.workspaceId===w.id?'selected':''}>${esc(w.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:0.7rem;font-weight:600;display:block;margin-bottom:4px;">Setor solicitante</label>
            <select id="bdef-area" class="form-select" style="width:100%;font-size:0.8125rem;">
              <option value="">— Nenhuma —</option>
              ${REQUESTING_AREAS.map(a => `<option value="${esc(a)}" ${_defaults.requestingArea===a?'selected':''}>${esc(a)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:0.7rem;font-weight:600;display:block;margin-bottom:4px;">Tipo</label>
            <select id="bdef-type" class="form-select" style="width:100%;font-size:0.8125rem;">
              <option value="">— Nenhum —</option>
              ${_types.map(t => `<option value="${esc(t.id)}" ${_defaults.typeId===t.id?'selected':''}>${esc(t.name || t.label)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:0.7rem;font-weight:600;display:block;margin-bottom:4px;">Prioridade</label>
            <select id="bdef-priority" class="form-select" style="width:100%;font-size:0.8125rem;">
              ${PRIORITIES.map(p => `<option value="${esc(p.value)}" ${_defaults.priority===p.value?'selected':''}>${esc(p.icon || '')} ${esc(p.label)}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <!-- 4.39.1+ TABELA com scrollbar SEMPRE visível + colunas mais largas -->
      <div style="border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden;">
        <div id="bulk-table-scroll" style="overflow-x:scroll;scrollbar-width:thin;
          scrollbar-color:var(--brand-gold) var(--bg-surface);">
          <table id="bulk-task-table" style="width:100%;border-collapse:separate;border-spacing:0;
            font-size:0.8125rem;min-width:1240px;">
            <thead style="background:var(--bg-surface);position:sticky;top:0;z-index:2;">
              <tr>
                <th style="padding:10px 8px;width:40px;text-align:center;font-weight:600;font-size:0.7rem;color:var(--text-muted);border-bottom:1px solid var(--border-default);">#</th>
                <th style="padding:10px 12px;text-align:left;font-weight:600;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid var(--border-default);min-width:220px;">Título *</th>
                <th style="padding:10px 12px;text-align:left;font-weight:600;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid var(--border-default);width:210px;">Responsável</th>
                <th style="padding:10px 12px;text-align:left;font-weight:600;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid var(--border-default);width:210px;">Projeto</th>
                <th style="padding:10px 12px;text-align:left;font-weight:600;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid var(--border-default);width:150px;">Prazo</th>
                <th style="padding:10px 12px;text-align:left;font-weight:600;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid var(--border-default);width:160px;">Prioridade</th>
                <th style="padding:10px 4px;width:40px;border-bottom:1px solid var(--border-default);"></th>
              </tr>
            </thead>
            <tbody id="bulk-task-rows">
              ${_rows.map((r, i) => renderRow(r, i)).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <style>
        /* 4.39.1+ Scrollbar SEMPRE visível (não some) */
        #bulk-table-scroll::-webkit-scrollbar { height: 10px; background: var(--bg-surface); }
        #bulk-table-scroll::-webkit-scrollbar-thumb { background: var(--brand-gold); border-radius: 5px; border: 2px solid var(--bg-surface); }
        #bulk-table-scroll::-webkit-scrollbar-thumb:hover { background: var(--brand-gold-dark, #B8902A); }
        /* Cells maiores pra não cortar texto */
        #bulk-task-table .bulk-cell { height: 36px !important; line-height: 1.4; padding: 4px 8px; }
      </style>

      <!-- Toolbar (add line + paste) -->
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <button id="bulk-add-row" class="btn btn-secondary btn-sm" style="font-size:0.8125rem;">+ Adicionar linha</button>
        <button id="bulk-paste-excel" class="btn btn-ghost btn-sm" style="font-size:0.8125rem;">📋 Colar do Excel</button>
        <span id="bulk-validation" style="margin-left:auto;font-size:0.75rem;color:var(--text-muted);"></span>
      </div>
    </div>
  `;
}

function renderRow(r, idx) {
  // 4.39.1+ Inputs maiores (36px), padding e borders mais visíveis
  const cellStyle = 'width:100%;font-size:0.8125rem;padding:6px 10px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-base);';
  return `
    <tr data-row-id="${r.id}" style="border-top:1px solid var(--border-subtle);">
      <td style="padding:8px 8px;text-align:center;color:var(--text-muted);font-size:0.75rem;vertical-align:middle;">${idx + 1}</td>
      <td style="padding:6px 8px;vertical-align:middle;">
        <input type="text" class="bulk-cell" data-field="title" data-row="${r.id}"
          value="${esc(r.title)}" placeholder="Título da tarefa…" style="${cellStyle}">
      </td>
      <td style="padding:6px 8px;vertical-align:middle;">
        <select class="bulk-cell" data-field="assigneeId" data-row="${r.id}" style="${cellStyle}">
          <option value="">— Padrão —</option>
          ${_users.map(u => `<option value="${esc(u.id)}" ${r.assigneeId===u.id?'selected':''}>${esc(u.name || u.email || u.id)}</option>`).join('')}
        </select>
      </td>
      <td style="padding:6px 8px;vertical-align:middle;">
        <select class="bulk-cell" data-field="projectId" data-row="${r.id}" style="${cellStyle}">
          <option value="">— Nenhum —</option>
          ${_projects.map(p => `<option value="${esc(p.id)}" ${r.projectId===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}
        </select>
      </td>
      <td style="padding:6px 8px;vertical-align:middle;">
        <input type="date" class="bulk-cell" data-field="dueDate" data-row="${r.id}"
          value="${esc(r.dueDate || '')}" style="${cellStyle}">
      </td>
      <td style="padding:6px 8px;vertical-align:middle;">
        <select class="bulk-cell" data-field="priority" data-row="${r.id}" style="${cellStyle}">
          <option value="">— Padrão —</option>
          ${PRIORITIES.map(p => `<option value="${esc(p.value)}" ${r.priority===p.value?'selected':''}>${esc(p.icon || '')} ${esc(p.label)}</option>`).join('')}
        </select>
      </td>
      <td style="padding:6px 4px;text-align:center;vertical-align:middle;">
        <button class="bulk-remove" data-row="${r.id}" title="Remover linha"
          style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:1rem;
          padding:6px 10px;border-radius:4px;transition:all .15s;">✕</button>
      </td>
    </tr>
  `;
}

/* ─── Wire events ───────────────────────────────────────── */
function wireEvents() {
  // Defaults
  ['bdef-workspace','bdef-area','bdef-type','bdef-priority'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      const k = id.replace('bdef-', '');
      const map = { workspace: 'workspaceId', area: 'requestingArea', type: 'typeId', priority: 'priority' };
      _defaults[map[k]] = el.value;
    });
  });

  // Cells
  rewireRowEvents();

  // Add row
  document.getElementById('bulk-add-row')?.addEventListener('click', () => {
    _rows.push(emptyRow());
    rerenderRows();
  });

  // Paste from Excel
  document.getElementById('bulk-paste-excel')?.addEventListener('click', () => openPasteModal());

  updateValidation();
}

function rewireRowEvents() {
  document.querySelectorAll('.bulk-cell').forEach(el => {
    el.addEventListener('input', (e) => {
      const rowId = el.dataset.row;
      const field = el.dataset.field;
      const row = _rows.find(r => r.id === rowId);
      if (row) {
        row[field] = el.value;
        updateValidation();
      }
    });
    el.addEventListener('change', (e) => {
      const rowId = el.dataset.row;
      const field = el.dataset.field;
      const row = _rows.find(r => r.id === rowId);
      if (row) row[field] = el.value;
      updateValidation();
    });
  });

  document.querySelectorAll('.bulk-remove').forEach(b => {
    b.addEventListener('click', () => {
      const rowId = b.dataset.row;
      _rows = _rows.filter(r => r.id !== rowId);
      if (_rows.length === 0) _rows.push(emptyRow());
      rerenderRows();
    });
  });
}

function rerenderRows() {
  const tbody = document.getElementById('bulk-task-rows');
  if (!tbody) return;
  tbody.innerHTML = _rows.map((r, i) => renderRow(r, i)).join('');
  rewireRowEvents();
  updateValidation();
}

function updateValidation() {
  const validRows = _rows.filter(r => r.title.trim().length > 0);
  const labelEl = document.getElementById('bulk-validation');
  if (labelEl) {
    if (validRows.length === 0) {
      labelEl.innerHTML = '<span style="color:var(--text-muted);">Preencha pelo menos um título</span>';
    } else {
      labelEl.innerHTML = `<strong style="color:var(--brand-gold);">${validRows.length}</strong> tarefa${validRows.length>1?'s':''} pronta${validRows.length>1?'s':''} pra criar`;
    }
  }
  // Atualiza label do botão "Criar"
  const createBtn = document.querySelector('.modal-footer .btn-primary');
  if (createBtn) {
    createBtn.textContent = validRows.length > 0
      ? `▶ Criar ${validRows.length} tarefa${validRows.length>1?'s':''}`
      : '▶ Criar tarefas';
    createBtn.disabled = validRows.length === 0;
  }
}

/* ─── Paste from Excel (TSV) ─────────────────────────── */
function openPasteModal() {
  modal.open({
    title: '📋 Colar do Excel',
    size: 'md',
    dedupeKey: 'bulk-paste',
    content: `
      <p style="font-size:0.8125rem;color:var(--text-secondary);margin-bottom:12px;line-height:1.5;">
        Cole abaixo as células copiadas do Excel (Ctrl+C). Cada linha vira uma tarefa.
        Aceita 1 a 6 colunas na ordem: <strong>Título · Responsável · Projeto · Prazo · Prioridade · Tags</strong>.
        Use o NOME do responsável/projeto exatamente como aparece no sistema.
      </p>
      <textarea id="bulk-paste-area" placeholder="Cole aqui (Ctrl+V)…"
        style="width:100%;height:200px;font-family:ui-monospace,Menlo,monospace;font-size:0.75rem;padding:10px;
        border:1px solid var(--border-subtle);border-radius:6px;resize:vertical;"></textarea>
    `,
    footer: [
      { label: 'Cancelar', class: 'btn-secondary' },
      {
        label: '↓ Preencher tabela',
        class: 'btn-primary',
        closeOnClick: false,
        onClick: () => {
          const raw = (document.getElementById('bulk-paste-area')?.value || '').trim();
          if (!raw) { toast.error('Cole conteúdo antes.'); return; }
          parseAndAppendPaste(raw);
          modal.close();
          toast.success('Linhas adicionadas.');
        },
      },
    ],
  });
}

function parseAndAppendPaste(raw) {
  // TSV (Excel padrão): linhas separadas por \n, células por \t
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return;

  // Se primeira linha começar com palavras-chave conhecidas (Título, etc), pula header
  const firstLineCells = lines[0].split('\t');
  const looksLikeHeader = /título|titulo|task|name/i.test(firstLineCells[0]);
  const dataLines = looksLikeHeader ? lines.slice(1) : lines;

  // Remove rows vazios existentes pra evitar duplicação
  _rows = _rows.filter(r => r.title.trim());

  for (const line of dataLines) {
    const cells = line.split('\t');
    const row = emptyRow();
    row.title    = (cells[0] || '').trim();
    // Tenta resolver responsável pelo nome
    if (cells[1]) {
      const name = cells[1].trim().toLowerCase();
      const u = _users.find(x => (x.name || '').toLowerCase().includes(name) || (x.email || '').toLowerCase() === name);
      if (u) row.assigneeId = u.id;
    }
    // Projeto pelo nome
    if (cells[2]) {
      const pname = cells[2].trim().toLowerCase();
      const p = _projects.find(x => (x.name || '').toLowerCase().includes(pname));
      if (p) row.projectId = p.id;
    }
    // Prazo
    if (cells[3]) {
      const d = parseDateLoose(cells[3]);
      if (d) row.dueDate = d;
    }
    // Prioridade
    if (cells[4]) {
      const pkey = cells[4].trim().toLowerCase();
      const map = { 'urgente': 'urgent', 'alta': 'high', 'média': 'medium', 'media': 'medium', 'baixa': 'low' };
      if (map[pkey]) row.priority = map[pkey];
      else if (['urgent','high','medium','low'].includes(pkey)) row.priority = pkey;
    }
    // Tags
    if (cells[5]) row.tags = cells[5].trim();

    if (row.title) _rows.push(row);
  }

  if (_rows.length === 0) _rows.push(emptyRow());
  rerenderRows();
}

function parseDateLoose(str) {
  const s = String(str || '').trim();
  if (!s) return '';
  // dd/mm/yyyy ou dd-mm-yyyy
  const br = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (br) {
    let [, d, m, y] = br;
    if (y.length === 2) y = '20' + y;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  // ISO yyyy-mm-dd direto
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return '';
}

/* ─── Submit ─────────────────────────────────────────── */
async function handleSubmit() {
  const validRows = _rows.filter(r => r.title.trim().length > 0);
  if (!validRows.length) { toast.error('Preencha pelo menos um título.'); return; }

  // Monta payloads aplicando defaults (4.39.2+ requestingArea no lugar de sector)
  const payloads = validRows.map(r => ({
    title:          r.title.trim(),
    priority:       r.priority || _defaults.priority || 'medium',
    typeId:         r.typeId || _defaults.typeId || null,
    workspaceId:    _defaults.workspaceId || null,
    requestingArea: _defaults.requestingArea || '',
    assignees:      r.assigneeId ? [r.assigneeId] : [],
    projectId:      r.projectId || null,
    dueDate:        r.dueDate || null,
    tags:           r.tags ? r.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    status:         'not_started',
  }));

  const btn = document.querySelector('.modal-footer .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = `⏳ Criando 0/${payloads.length}…`; }

  try {
    const result = await bulkCreateTasks(payloads, (done, total) => {
      if (btn) btn.textContent = `⏳ Criando ${done}/${total}…`;
    });
    if (result.failed.length) {
      toast.error(`${result.created.length} criadas, ${result.failed.length} falharam.`);
      console.warn('[bulkCreate] falhas:', result.failed);
    } else {
      toast.success(`${result.created.length} tarefa${result.created.length>1?'s':''} criada${result.created.length>1?'s':''}.`);
    }
    modal.close();
    // Reload tarefas pra refletir
    window.dispatchEvent(new CustomEvent('tasks:refresh'));
  } catch (e) {
    toast.error('Falha: ' + (e.message || 'erro desconhecido'));
    if (btn) { btn.disabled = false; btn.textContent = '▶ Criar tarefas'; }
  }
}
