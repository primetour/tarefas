/**
 * PRIMETOUR — Planner Import Wizard
 * Importação detalhada de tarefas do Microsoft Planner (XLSX)
 * 5 etapas: Upload → Mapeamento → Usuários → Buckets → Revisão/Edição/Importação
 */

import { store } from '../store.js';
import { modal } from './modal.js';
import { toast } from './toast.js';
import { createTask } from '../services/tasks.js';

/* ─── Constants ──────────────────────────────────────────── */
const PROGRESS_MAP = {
  'Não iniciado': 'not_started',
  'Em andamento': 'in_progress',
  'Concluída':    'done',
};
const PROGRESS_MAP_REV = Object.fromEntries(Object.entries(PROGRESS_MAP).map(([k,v]) => [v,k]));

const PRIORITY_MAP = {
  'Urgente':    'urgent',
  'Importante': 'high',
  'Média':      'medium',
  'Baixa':      'low',
};
const PRIORITY_MAP_REV = Object.fromEntries(Object.entries(PRIORITY_MAP).map(([k,v]) => [v,k]));

const STATUS_OPTIONS = [
  { value: 'not_started', label: 'Não iniciado', color: '#3B82F6' },
  { value: 'in_progress', label: 'Em andamento', color: '#F59E0B' },
  { value: 'done',        label: 'Concluída',    color: '#16A34A' },
];

const PRIO_OPTIONS = [
  { value: 'urgent', label: 'Urgente',    color: '#EF4444', icon: '🔴' },
  { value: 'high',   label: 'Alta',       color: '#F97316', icon: '🟠' },
  { value: 'medium', label: 'Média',      color: '#F59E0B', icon: '🟡' },
  { value: 'low',    label: 'Baixa',      color: '#6B7280', icon: '⚪' },
];

const esc = s => String(s||'').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ─── Wizard State ───────────────────────────────────────── */
let wiz = {
  step: 1,
  rawRows: [],
  headers: [],
  // Editable task data (built from rawRows with overrides)
  tasks: [],         // [{ _idx, title, status, priority, assigneeIds:[], bucket, dueDate, description, checklist, labels, ... }]
  // Step 2 — field mapping
  fieldMap: {},
  // Step 3 — user mapping
  plannerUsers: [],
  systemUsers: [],
  userMap: {},       // plannerName → { userId, userName } | null
  // Step 4 — bucket mapping
  plannerBuckets: [],
  bucketMap: {},
  // Step 5 — selection & import
  selectedRows: new Set(),
  importTag: '',
  importResults: null,
  modalRef: null,
  // Filters
  previewSearch: '',
  previewBucket: '',
  previewStatus: '',
};

/* ─── Entry Point ────────────────────────────────────────── */
export function openPlannerImportWizard() {
  wiz = {
    step: 1, rawRows: [], headers: [], tasks: [],
    fieldMap: {}, plannerUsers: [], systemUsers: [],
    userMap: {}, plannerBuckets: [], bucketMap: {},
    selectedRows: new Set(), importTag: 'planner-import',
    importResults: null, modalRef: null,
    previewSearch: '', previewBucket: '', previewStatus: '',
  };

  const ref = modal.open({
    title: '📋 Importar do Microsoft Planner',
    content: renderStep1(),
    size: 'xl',
    footer: buildFooter(),
    closeable: true,
  });
  wiz.modalRef = ref;
  attachStep1Events();
}

/* ═══════════════════════════════════════════════════════════
   STEP 1 — Upload
   ═══════════════════════════════════════════════════════════ */
function renderStep1() {
  return `
    <div class="pi-wizard">
      ${stepIndicator(1)}
      <div class="pi-step-body">
        <h3 style="margin:0 0 8px;">Enviar arquivo do Planner</h3>
        <p style="color:var(--text-muted);font-size:0.875rem;margin:0 0 20px;">
          Exporte suas tarefas do Microsoft Planner em formato <strong>.xlsx</strong>
          e selecione o arquivo abaixo.
        </p>
        <div id="pi-dropzone" style="border:2px dashed var(--border,#e5e7eb);border-radius:12px;
          padding:48px 24px;text-align:center;cursor:pointer;transition:all 0.2s;background:var(--bg-surface,#f9fafb);">
          <div style="font-size:3rem;margin-bottom:12px;opacity:0.4;">📁</div>
          <p style="color:var(--text-muted);margin:0 0 8px;">Arraste o arquivo aqui ou clique para selecionar</p>
          <p style="color:var(--text-muted);font-size:0.75rem;margin:0;">Formato aceito: .xlsx</p>
          <input type="file" id="pi-file" accept=".xlsx" style="display:none;" />
        </div>
        <div id="pi-file-info" style="margin-top:12px;display:none;padding:12px 16px;
          background:var(--bg-surface);border-radius:8px;border:1px solid var(--border);"></div>
        <div id="pi-parse-error" style="margin-top:12px;display:none;padding:12px 16px;
          background:#FEF2F2;color:#DC2626;border-radius:8px;font-size:0.875rem;"></div>
      </div>
    </div>`;
}

function attachStep1Events() {
  const body = wiz.modalRef?.getBody();
  if (!body) return;
  const dropzone = body.querySelector('#pi-dropzone');
  const fileInput = body.querySelector('#pi-file');
  dropzone?.addEventListener('click', () => fileInput?.click());
  dropzone?.addEventListener('dragover', e => { e.preventDefault(); dropzone.style.borderColor = 'var(--brand-blue)'; });
  dropzone?.addEventListener('dragleave', () => { dropzone.style.borderColor = 'var(--border,#e5e7eb)'; });
  dropzone?.addEventListener('drop', e => {
    e.preventDefault(); dropzone.style.borderColor = 'var(--border,#e5e7eb)';
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  fileInput?.addEventListener('change', e => { if (e.target.files.length) handleFile(e.target.files[0]); });
}

async function handleFile(file) {
  const body = wiz.modalRef?.getBody();
  if (!body) return;
  const errDiv = body.querySelector('#pi-parse-error');
  const infoDiv = body.querySelector('#pi-file-info');

  if (!file.name.endsWith('.xlsx')) {
    errDiv.textContent = 'Formato inválido. Selecione um arquivo .xlsx exportado do Planner.';
    errDiv.style.display = 'block'; return;
  }
  errDiv.style.display = 'none';
  infoDiv.style.display = 'block';
  infoDiv.innerHTML = `<span style="color:var(--text-muted);">Processando <strong>${esc(file.name)}</strong>...</span>`;

  try {
    if (!window.XLSX) await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array', cellDates: true });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    if (!rows.length) throw new Error('Planilha vazia.');

    wiz.headers = Object.keys(rows[0]);
    wiz.rawRows = rows;
    autoMapFields();
    extractPlannerUsers();
    extractBuckets();
    buildEditableTasks();

    const total = rows.length;
    const withDates = rows.filter(r => r['Data de conclusão']).length;
    const completed = rows.filter(r => (r['Progresso']||'') === 'Concluída').length;

    infoDiv.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="font-size:1.5rem;">✅</span>
        <div>
          <strong>${esc(file.name)}</strong>
          <div style="font-size:0.8125rem;color:var(--text-muted);margin-top:2px;">
            ${total} tarefas · ${withDates} com prazo · ${completed} concluídas · ${wiz.plannerUsers.length} pessoas · ${wiz.plannerBuckets.length} buckets
          </div>
        </div>
      </div>`;
    updateFooter();
  } catch (err) {
    errDiv.textContent = 'Erro ao processar: ' + err.message;
    errDiv.style.display = 'block'; infoDiv.style.display = 'none';
  }
}

function autoMapFields() {
  wiz.fieldMap = {
    title: 'Nome da tarefa', description: 'Descrição', status: 'Progresso',
    priority: 'Prioridade', assignees: 'Atribuído a', startDate: 'Data de início',
    dueDate: 'Data de conclusão', bucket: 'Nome do Bucket', labels: 'Rótulos',
    checklist: 'Itens da lista de verificação', checklistDone: 'Itens concluídos da lista de verificação',
    createdAt: 'Criado em', createdBy: 'Criado por', isRecurring: 'É Recorrente',
    completedAt: 'Concluído em', completedBy: 'Concluída por', plannerId: 'Identificação da tarefa',
  };
}

function extractPlannerUsers() {
  const nameSet = new Set();
  wiz.rawRows.forEach(r => {
    (r['Atribuído a'] || '').split(';').map(n => n.trim()).filter(Boolean).forEach(n => nameSet.add(n));
    const cb = (r['Criado por'] || '').trim();
    if (cb) nameSet.add(cb);
  });
  wiz.plannerUsers = [...nameSet].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function extractBuckets() {
  const set = new Set();
  wiz.rawRows.forEach(r => { const b = (r['Nome do Bucket']||'').trim(); if (b) set.add(b); });
  wiz.plannerBuckets = [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/** Build editable task objects from raw rows */
function buildEditableTasks() {
  wiz.tasks = wiz.rawRows.map((r, i) => {
    const progress = (r['Progresso'] || '').trim();
    const prio = (r['Prioridade'] || '').trim();
    const assignedRaw = (r['Atribuído a'] || '').split(';').map(n => n.trim()).filter(Boolean);
    return {
      _idx: i,
      title: (r['Nome da tarefa'] || '').trim() || 'Sem título',
      status: PROGRESS_MAP[progress] || 'not_started',
      priority: PRIORITY_MAP[prio] || 'medium',
      assigneeNames: assignedRaw,
      bucket: (r['Nome do Bucket'] || '').trim(),
      dueDate: r['Data de conclusão'] || null,
      startDate: r['Data de início'] || null,
      description: (r['Descrição'] || '').trim(),
      labels: (r['Rótulos'] || '').split(';').map(l => l.trim()).filter(Boolean),
      checklistItems: (r['Itens da lista de verificação'] || '').split(';').map(s => s.trim()).filter(Boolean),
      checklistDone: r['Itens concluídos da lista de verificação'] || '',
      isRecurring: (r['É Recorrente'] || '').toLowerCase() === 'sim',
      plannerId: (r['Identificação da tarefa'] || '').trim(),
      plannerCreatedBy: (r['Criado por'] || '').trim(),
      plannerCreatedAt: (r['Criado em'] || '').toString(),
    };
  });
}

/* ═══════════════════════════════════════════════════════════
   STEP 2 — Field Mapping
   ═══════════════════════════════════════════════════════════ */
function renderStep2() {
  const fields = [
    { key: 'title',       sys: 'title',          type: 'exact',   info: '' },
    { key: 'description', sys: 'description',    type: 'exact',   info: '' },
    { key: 'status',      sys: 'status',         type: 'convert', info: 'Não iniciado → not_started, Em andamento → in_progress, Concluída → done' },
    { key: 'priority',    sys: 'priority',       type: 'convert', info: 'Urgente → urgent, Importante → high, Média → medium, Baixa → low' },
    { key: 'assignees',   sys: 'assignees',      type: 'convert', info: 'Nomes do Planner → IDs de usuários (Etapa 3)' },
    { key: 'startDate',   sys: 'startDate',      type: 'exact',   info: '' },
    { key: 'dueDate',     sys: 'dueDate',        type: 'exact',   info: '' },
    { key: 'bucket',      sys: 'tags / projeto', type: 'convert', info: 'Bucket → tag ou ignorado (Etapa 4)' },
    { key: 'labels',      sys: 'tags',           type: 'exact',   info: 'Rótulos do Planner viram tags' },
    { key: 'checklist',   sys: 'subtasks',       type: 'convert', info: 'Itens ";" → subtasks com status de conclusão' },
    { key: 'createdAt',   sys: 'metadados',      type: 'info',    info: 'Preservado em customFields' },
    { key: 'createdBy',   sys: 'metadados',      type: 'info',    info: 'Preservado em customFields' },
    { key: 'isRecurring', sys: 'tags',           type: 'convert', info: '"Sim" → tag recorrente-planner' },
    { key: 'plannerId',   sys: 'customFields',   type: 'exact',   info: 'ID original preservado para rastreabilidade' },
  ];

  const stats = {};
  fields.forEach(f => {
    const col = wiz.fieldMap[f.key]; if (!col) return;
    stats[f.key] = wiz.rawRows.filter(r => r[col] !== '' && r[col] != null).length;
  });

  return `
    <div class="pi-wizard">
      ${stepIndicator(2)}
      <div class="pi-step-body">
        <h3 style="margin:0 0 4px;">Mapeamento de campos</h3>
        <p style="color:var(--text-muted);font-size:0.8125rem;margin:0 0 16px;">
          Como cada coluna do Planner será convertida.
          <span class="pi-badge-exact">Verde = direto</span>
          <span class="pi-badge-convert">Amarelo = conversão</span>
          <span class="pi-badge-info">Cinza = informativo</span>
        </p>
        <div style="overflow-x:auto;">
          <table class="pi-table">
            <thead>
              <tr>
                <th>Coluna Planner</th>
                <th>Campo no Sistema</th>
                <th style="text-align:center;">Tipo</th>
                <th style="text-align:right;">Preenchidos</th>
                <th>Conversão</th>
              </tr>
            </thead>
            <tbody>
              ${fields.map(f => {
                const col = wiz.fieldMap[f.key] || '—';
                const found = wiz.headers.includes(col);
                const count = stats[f.key] || 0;
                const pct = wiz.rawRows.length ? Math.round(count / wiz.rawRows.length * 100) : 0;
                const tc = f.type === 'exact' ? '#16A34A' : f.type === 'convert' ? '#D97706' : '#6B7280';
                const tl = f.type === 'exact' ? 'Direto' : f.type === 'convert' ? 'Conversão' : 'Info';
                return `<tr>
                  <td><strong>${esc(col)}</strong>${!found && col !== '—' ? ' <span style="color:#EF4444;font-size:0.7rem;">(ausente)</span>' : ''}</td>
                  <td>${esc(f.sys)}</td>
                  <td style="text-align:center;"><span class="pi-type-badge" style="--tc:${tc};">${tl}</span></td>
                  <td style="text-align:right;"><strong>${count}</strong><span class="text-muted"> / ${wiz.rawRows.length} (${pct}%)</span></td>
                  <td class="text-muted" style="font-size:0.75rem;max-width:240px;">${f.info || '—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   STEP 3 — User Resolution
   ═══════════════════════════════════════════════════════════ */
function renderStep3() {
  const sysUsers = store.get('users') || [];
  wiz.systemUsers = sysUsers.filter(u => u.active !== false);

  if (!Object.keys(wiz.userMap).length) {
    wiz.plannerUsers.forEach(pName => { wiz.userMap[pName] = findBestUserMatch(pName, wiz.systemUsers); });
  }

  const matched = wiz.plannerUsers.filter(n => wiz.userMap[n]?.userId).length;
  const unmatched = wiz.plannerUsers.length - matched;
  const taskCounts = {};
  wiz.rawRows.forEach(r => {
    (r['Atribuído a'] || '').split(';').map(n => n.trim()).filter(Boolean).forEach(n => { taskCounts[n] = (taskCounts[n] || 0) + 1; });
  });

  return `
    <div class="pi-wizard">
      ${stepIndicator(3)}
      <div class="pi-step-body">
        <h3 style="margin:0 0 4px;">Resolução de usuários</h3>
        <p style="color:var(--text-muted);font-size:0.8125rem;margin:0 0 12px;">
          Conecte cada pessoa do Planner a um usuário cadastrado no sistema.
        </p>
        <div style="display:flex;gap:12px;margin-bottom:16px;">
          <div class="pi-stat-card" style="--bg:#F0FDF4;--bc:#BBF7D0;--tc:#16A34A;">
            <strong>${matched}</strong> conectados
          </div>
          <div class="pi-stat-card" style="--bg:${unmatched ? '#FEF3C7' : '#F0FDF4'};--bc:${unmatched ? '#FDE68A' : '#BBF7D0'};--tc:${unmatched ? '#D97706' : '#16A34A'};">
            <strong>${unmatched}</strong> sem correspondência
          </div>
        </div>
        <div style="overflow-x:auto;">
          <table class="pi-table">
            <thead>
              <tr>
                <th>Pessoa no Planner</th>
                <th style="text-align:center;">Tarefas</th>
                <th style="text-align:center;">Match</th>
                <th>Usuário no Sistema</th>
              </tr>
            </thead>
            <tbody>
              ${wiz.plannerUsers.map(pName => {
                const map = wiz.userMap[pName];
                const isM = !!map?.userId;
                return `<tr data-puser="${esc(pName)}">
                  <td><strong>${esc(pName)}</strong></td>
                  <td style="text-align:center;">${taskCounts[pName] || 0}</td>
                  <td style="text-align:center;">
                    <span class="pi-match-dot" style="--c:${isM ? '#16A34A' : '#D97706'};">${isM ? '✓' : '?'}</span>
                  </td>
                  <td>
                    <select class="pi-user-sel form-input" data-pname="${esc(pName)}"
                      style="height:32px;font-size:0.8125rem;min-width:240px;
                      border-color:${isM ? '#16A34A' : '#D97706'};">
                      <option value="">— Sem responsável (tag para filtrar depois) —</option>
                      ${wiz.systemUsers.map(u => `<option value="${esc(u.id)}" ${map?.userId === u.id ? 'selected' : ''}>${esc(u.name)}${u.email ? ` (${esc(u.email)})` : u.sector ? ` (${esc(u.sector)})` : ''}</option>`).join('')}
                    </select>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div class="pi-note">
          <strong>Nota:</strong> Pessoas sem correspondência receberão a tag
          <code>planner-sem-responsavel</code> para fácil localização e atualização posterior.
        </div>
      </div>
    </div>`;
}

function attachStep3Events() {
  const body = wiz.modalRef?.getBody(); if (!body) return;
  body.querySelectorAll('.pi-user-sel').forEach(sel => {
    sel.addEventListener('change', e => {
      const pn = e.target.dataset.pname, uid = e.target.value;
      if (uid) {
        const u = wiz.systemUsers.find(u => u.id === uid);
        wiz.userMap[pn] = { userId: uid, userName: u?.name || '' };
        e.target.style.borderColor = '#16A34A';
      } else {
        wiz.userMap[pn] = null;
        e.target.style.borderColor = '#D97706';
      }
      const dot = e.target.closest('tr')?.querySelector('.pi-match-dot');
      if (dot) { dot.style.setProperty('--c', uid ? '#16A34A' : '#D97706'); dot.textContent = uid ? '✓' : '?'; }
    });
  });
}

function findBestUserMatch(plannerName, systemUsers) {
  if (!plannerName || !systemUsers.length) return null;
  const pn = norm(plannerName);
  let m = systemUsers.find(u => norm(u.name) === pn);
  if (m) return { userId: m.id, userName: m.name };
  const pp = pn.split(/\s+/);
  if (pp.length >= 2) {
    m = systemUsers.find(u => { const sp = norm(u.name).split(/\s+/); return sp[0] === pp[0] && sp[sp.length-1] === pp[pp.length-1]; });
    if (m) return { userId: m.id, userName: m.name };
  }
  if (pp.length >= 1) {
    const fm = systemUsers.filter(u => norm(u.name).split(/\s+/)[0] === pp[0]);
    if (fm.length === 1) return { userId: fm[0].id, userName: fm[0].name };
  }
  return null;
}

function norm(s) { return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim(); }

/* ═══════════════════════════════════════════════════════════
   STEP 4 — Bucket Mapping
   ═══════════════════════════════════════════════════════════ */
function renderStep4() {
  const counts = {};
  wiz.rawRows.forEach(r => { const b = (r['Nome do Bucket']||'').trim(); if (b) counts[b] = (counts[b]||0) + 1; });
  if (!Object.keys(wiz.bucketMap).length) wiz.plannerBuckets.forEach(b => { wiz.bucketMap[b] = 'tag'; });

  return `
    <div class="pi-wizard">
      ${stepIndicator(4)}
      <div class="pi-step-body">
        <h3 style="margin:0 0 4px;">Mapeamento de Buckets</h3>
        <p style="color:var(--text-muted);font-size:0.8125rem;margin:0 0 16px;">
          Cada Bucket do Planner pode virar uma <strong>tag</strong> no sistema ou ser ignorado.
        </p>
        <div style="overflow-x:auto;">
          <table class="pi-table">
            <thead><tr><th>Bucket</th><th style="text-align:center;">Tarefas</th><th>Ação</th></tr></thead>
            <tbody>
              ${wiz.plannerBuckets.map(b => `<tr>
                <td><strong>${esc(b)}</strong></td>
                <td style="text-align:center;">${counts[b]||0}</td>
                <td><select class="pi-bucket-sel form-input" data-bucket="${esc(b)}" style="height:32px;font-size:0.8125rem;">
                  <option value="tag" ${wiz.bucketMap[b]==='tag'?'selected':''}>Converter em Tag</option>
                  <option value="ignore" ${wiz.bucketMap[b]==='ignore'?'selected':''}>Ignorar</option>
                </select></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div style="margin-top:16px;padding:12px 16px;background:var(--bg-surface);border-radius:8px;border:1px solid var(--border);">
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">Tag de importação (aplicada a todas):</label>
          <input type="text" id="pi-import-tag" class="form-input" value="${esc(wiz.importTag)}"
            style="height:32px;font-size:0.8125rem;max-width:300px;" placeholder="ex: planner-import" />
          <p style="color:var(--text-muted);font-size:0.75rem;margin:4px 0 0;">
            Facilita filtrar todas as tarefas importadas.
          </p>
        </div>
      </div>
    </div>`;
}

function attachStep4Events() {
  const body = wiz.modalRef?.getBody(); if (!body) return;
  body.querySelectorAll('.pi-bucket-sel').forEach(sel => {
    sel.addEventListener('change', e => { wiz.bucketMap[e.target.dataset.bucket] = e.target.value; });
  });
  body.querySelector('#pi-import-tag')?.addEventListener('input', e => { wiz.importTag = e.target.value.trim(); });
}

/* ═══════════════════════════════════════════════════════════
   STEP 5 — Preview, Edit & Import
   ═══════════════════════════════════════════════════════════ */
function renderStep5() {
  if (wiz.importResults) return renderImportResults();

  const tasks = wiz.tasks;
  const total = tasks.length;
  const byStatus = { not_started: 0, in_progress: 0, done: 0 };
  tasks.forEach(t => { byStatus[t.status] = (byStatus[t.status] || 0) + 1; });

  // Pre-select non-completed on first visit
  if (wiz.selectedRows.size === 0 && !wiz.importResults) {
    tasks.forEach((t, i) => { if (t.status !== 'done') wiz.selectedRows.add(i); });
  }

  const filtered = getFilteredTasks();

  return `
    <div class="pi-wizard">
      ${stepIndicator(5)}
      <div class="pi-step-body">
        <h3 style="margin:0 0 4px;">Revisão e edição</h3>
        <p style="color:var(--text-muted);font-size:0.8125rem;margin:0 0 12px;">
          Edite qualquer campo diretamente na tabela antes de importar.
          Clique no valor para alterar.
        </p>

        <!-- Summary cards -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-bottom:14px;">
          ${summaryCard(total, 'Total', 'var(--bg-surface)', 'var(--border)', 'var(--text-primary)')}
          ${summaryCard(byStatus.not_started, 'Não iniciadas', '#EFF6FF', '#BFDBFE', '#3B82F6')}
          ${summaryCard(byStatus.in_progress, 'Em andamento', '#FFFBEB', '#FDE68A', '#D97706')}
          ${summaryCard(byStatus.done, 'Concluídas', '#F0FDF4', '#BBF7D0', '#16A34A')}
          ${summaryCard(wiz.selectedRows.size, 'Selecionadas', '#F5F3FF', '#DDD6FE', '#7C3AED')}
        </div>

        <!-- Filters & quick selection -->
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;align-items:center;">
          <span style="font-size:0.8125rem;font-weight:600;">Selecionar:</span>
          <button class="pi-qsel btn btn-sm" data-sel="all">Todas</button>
          <button class="pi-qsel btn btn-sm" data-sel="none">Nenhuma</button>
          <button class="pi-qsel btn btn-sm" data-sel="not_started">Não inic.</button>
          <button class="pi-qsel btn btn-sm" data-sel="in_progress">Em andam.</button>
          <button class="pi-qsel btn btn-sm" data-sel="done">Concluídas</button>
          <span style="border-left:1px solid var(--border);height:20px;margin:0 4px;"></span>
          <select id="pi-filter-bucket" class="form-input" style="height:30px;font-size:0.75rem;max-width:160px;">
            <option value="">Todos os buckets</option>
            ${wiz.plannerBuckets.map(b => `<option value="${esc(b)}" ${wiz.previewBucket===b?'selected':''}>${esc(b)}</option>`).join('')}
          </select>
          <select id="pi-filter-status" class="form-input" style="height:30px;font-size:0.75rem;max-width:140px;">
            <option value="">Todos status</option>
            ${STATUS_OPTIONS.map(s => `<option value="${s.value}" ${wiz.previewStatus===s.value?'selected':''}>${s.label}</option>`).join('')}
          </select>
          <input type="text" id="pi-search" class="form-input" placeholder="Buscar..."
            style="height:30px;font-size:0.75rem;width:180px;margin-left:auto;" value="${esc(wiz.previewSearch)}" />
        </div>

        <!-- Editable tasks table -->
        <div style="max-height:420px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;" id="pi-table-wrap">
          <table class="pi-table pi-edit-table" id="pi-edit-table">
            <thead style="position:sticky;top:0;z-index:2;">
              <tr>
                <th style="width:30px;text-align:center;"><input type="checkbox" id="pi-sel-all" /></th>
                <th style="min-width:200px;">Tarefa</th>
                <th style="min-width:100px;">Status</th>
                <th style="min-width:90px;">Prioridade</th>
                <th style="min-width:150px;">Responsável</th>
                <th style="min-width:100px;">Bucket</th>
                <th style="min-width:100px;">Prazo</th>
              </tr>
            </thead>
            <tbody id="pi-edit-tbody">
              ${filtered.map(t => renderEditRow(t)).join('')}
            </tbody>
          </table>
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:6px;">
          Mostrando ${filtered.length} de ${total} tarefas
          ${wiz.selectedRows.size > 0 ? ` · <strong style="color:#7C3AED;">${wiz.selectedRows.size} selecionadas para importar</strong>` : ''}
        </div>
      </div>
    </div>`;
}

function summaryCard(n, label, bg, border, color) {
  return `<div style="padding:8px 12px;border-radius:8px;background:${bg};border:1px solid ${border};text-align:center;">
    <div style="font-size:1.15rem;font-weight:700;color:${color};">${n}</div>
    <div style="font-size:0.7rem;color:${color};">${label}</div>
  </div>`;
}

function getFilteredTasks() {
  let list = wiz.tasks;
  if (wiz.previewBucket) list = list.filter(t => t.bucket === wiz.previewBucket);
  if (wiz.previewStatus) list = list.filter(t => t.status === wiz.previewStatus);
  if (wiz.previewSearch) {
    const q = wiz.previewSearch.toLowerCase();
    list = list.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.bucket.toLowerCase().includes(q) ||
      t.assigneeNames.some(n => n.toLowerCase().includes(q))
    );
  }
  return list;
}

function renderEditRow(t) {
  const i = t._idx;
  const checked = wiz.selectedRows.has(i);

  // Resolve assignees
  const resolvedNames = t.assigneeNames.map(n => {
    const m = wiz.userMap[n];
    return m?.userId ? { name: m.userName || n, resolved: true } : { name: n, resolved: false };
  });
  const allResolved = resolvedNames.length === 0 || resolvedNames.every(r => r.resolved);
  const hasUnresolved = resolvedNames.some(r => !r.resolved);

  // Status info
  const st = STATUS_OPTIONS.find(s => s.value === t.status) || STATUS_OPTIONS[0];
  // Priority info
  const pr = PRIO_OPTIONS.find(p => p.value === t.priority) || PRIO_OPTIONS[2];

  // Due date formatting
  const dueFmt = t.dueDate ? fmtDate(t.dueDate) : '';
  const isOverdue = t.dueDate && t.status !== 'done' && new Date(t.dueDate) < new Date();

  // Row background color
  let rowBg = '';
  if (!checked) rowBg = 'opacity:0.5;';
  else if (hasUnresolved) rowBg = 'background:rgba(217,119,6,0.04);';
  else if (t.status === 'done') rowBg = 'background:rgba(22,163,74,0.04);';

  return `
    <tr class="pi-erow" data-idx="${i}" style="${rowBg}">
      <td style="text-align:center;"><input type="checkbox" class="pi-rcb" data-idx="${i}" ${checked ? 'checked' : ''} /></td>
      <td>
        <input type="text" class="pi-inline-input pi-ed-title" data-idx="${i}" value="${esc(t.title)}"
          style="width:100%;font-weight:600;" />
      </td>
      <td>
        <select class="pi-inline-select pi-ed-status" data-idx="${i}" style="color:${st.color};font-weight:600;">
          ${STATUS_OPTIONS.map(s => `<option value="${s.value}" ${s.value===t.status?'selected':''}
            style="color:${s.color};">${s.label}</option>`).join('')}
        </select>
      </td>
      <td>
        <select class="pi-inline-select pi-ed-prio" data-idx="${i}">
          ${PRIO_OPTIONS.map(p => `<option value="${p.value}" ${p.value===t.priority?'selected':''}>${p.icon} ${p.label}</option>`).join('')}
        </select>
      </td>
      <td>
        ${resolvedNames.length ? resolvedNames.map(r => `
          <span class="pi-user-chip" style="--chip-c:${r.resolved ? '#16A34A' : '#D97706'};">
            ${r.resolved ? '✓' : '?'} ${esc(r.name.split(' ')[0])}
          </span>
        `).join(' ') : '<span class="text-muted" style="font-size:0.75rem;">— sem resp.</span>'}
      </td>
      <td style="font-size:0.75rem;">${esc(t.bucket)}</td>
      <td>
        <input type="date" class="pi-inline-input pi-ed-date" data-idx="${i}"
          value="${t.dueDate ? toISODate(t.dueDate) : ''}"
          style="font-size:0.75rem;${isOverdue ? 'color:#EF4444;font-weight:600;' : ''}" />
      </td>
    </tr>`;
}

function attachStep5Events() {
  const body = wiz.modalRef?.getBody(); if (!body) return;

  // Inline editing — title
  body.addEventListener('input', e => {
    if (e.target.classList.contains('pi-ed-title')) {
      const idx = parseInt(e.target.dataset.idx);
      wiz.tasks[idx].title = e.target.value;
    }
  });

  // Inline editing — status
  body.addEventListener('change', e => {
    if (e.target.classList.contains('pi-ed-status')) {
      const idx = parseInt(e.target.dataset.idx);
      wiz.tasks[idx].status = e.target.value;
      const st = STATUS_OPTIONS.find(s => s.value === e.target.value);
      if (st) e.target.style.color = st.color;
    }
    if (e.target.classList.contains('pi-ed-prio')) {
      const idx = parseInt(e.target.dataset.idx);
      wiz.tasks[idx].priority = e.target.value;
    }
    if (e.target.classList.contains('pi-ed-date')) {
      const idx = parseInt(e.target.dataset.idx);
      wiz.tasks[idx].dueDate = e.target.value || null;
    }
  });

  // Checkboxes
  body.addEventListener('change', e => {
    if (e.target.classList.contains('pi-rcb')) {
      const idx = parseInt(e.target.dataset.idx);
      if (e.target.checked) wiz.selectedRows.add(idx); else wiz.selectedRows.delete(idx);
      // Update row opacity
      const row = e.target.closest('tr');
      if (row) row.style.opacity = e.target.checked ? '1' : '0.5';
      updateSelectedCount();
    }
  });

  // Select all
  body.querySelector('#pi-sel-all')?.addEventListener('change', e => {
    const checked = e.target.checked;
    body.querySelectorAll('#pi-edit-tbody .pi-rcb').forEach(cb => {
      const idx = parseInt(cb.dataset.idx);
      cb.checked = checked;
      if (checked) wiz.selectedRows.add(idx); else wiz.selectedRows.delete(idx);
      const row = cb.closest('tr');
      if (row) row.style.opacity = checked ? '1' : '0.5';
    });
    updateSelectedCount();
  });

  // Quick selection buttons
  body.querySelectorAll('.pi-qsel').forEach(btn => {
    btn.addEventListener('click', () => {
      const sel = btn.dataset.sel;
      wiz.selectedRows.clear();
      if (sel === 'all') wiz.tasks.forEach((_, i) => wiz.selectedRows.add(i));
      else if (sel !== 'none') wiz.tasks.forEach((t, i) => { if (t.status === sel) wiz.selectedRows.add(i); });
      refreshTable();
    });
  });

  // Filters
  body.querySelector('#pi-filter-bucket')?.addEventListener('change', e => { wiz.previewBucket = e.target.value; refreshTable(); });
  body.querySelector('#pi-filter-status')?.addEventListener('change', e => { wiz.previewStatus = e.target.value; refreshTable(); });
  let timer;
  body.querySelector('#pi-search')?.addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { wiz.previewSearch = e.target.value; refreshTable(); }, 250);
  });
}

function refreshTable() {
  const body = wiz.modalRef?.getBody(); if (!body) return;
  const tbody = body.querySelector('#pi-edit-tbody');
  if (!tbody) return;
  const filtered = getFilteredTasks();
  tbody.innerHTML = filtered.map(t => renderEditRow(t)).join('');
  updateSelectedCount();
}

function updateSelectedCount() {
  const body = wiz.modalRef?.getBody(); if (!body) return;
  // Update the purple summary card if visible
  const cards = body.querySelectorAll('.pi-step-body > div:first-of-type > div');
  // Update footer button text
  updateFooter();
}

/* ─── Import Execution ───────────────────────────────────── */
async function executeImport() {
  const indices = [...wiz.selectedRows].sort((a, b) => a - b);
  if (!indices.length) { toast.warning('Selecione ao menos uma tarefa.'); return; }

  const ok = await modal.confirm({
    title: 'Confirmar importação',
    message: `Importar <strong>${indices.length}</strong> tarefas do Planner?<br>
      <span style="font-size:0.8125rem;color:var(--text-muted);">Novas tarefas serão criadas. Nada existente será alterado.</span>`,
    confirmText: `Importar ${indices.length} tarefas`,
    icon: '📋',
  });
  if (!ok) return;

  const body = wiz.modalRef?.getBody(); if (!body) return;
  body.innerHTML = `
    <div class="pi-wizard">
      ${stepIndicator(5)}
      <div class="pi-step-body" style="text-align:center;padding:40px 20px;">
        <div style="font-size:3rem;margin-bottom:16px;">⏳</div>
        <h3 id="pi-prog-title">Importando tarefas...</h3>
        <div style="max-width:400px;margin:16px auto;">
          <div style="background:var(--border);border-radius:999px;height:8px;overflow:hidden;">
            <div id="pi-prog-bar" style="width:0%;height:100%;background:var(--brand-blue,#3B82F6);border-radius:999px;transition:width 0.3s;"></div>
          </div>
          <p id="pi-prog-text" style="color:var(--text-muted);font-size:0.8125rem;margin:8px 0 0;">0 / ${indices.length}</p>
        </div>
        <div id="pi-prog-log" style="text-align:left;max-height:200px;overflow-y:auto;font-size:0.75rem;
          color:var(--text-muted);margin-top:20px;padding:12px;background:var(--bg-surface);border-radius:8px;border:1px solid var(--border);"></div>
      </div>
    </div>`;

  const bar = body.querySelector('#pi-prog-bar');
  const txt = body.querySelector('#pi-prog-text');
  const log = body.querySelector('#pi-prog-log');
  let success = 0, errors = 0;
  const errDetails = [];

  for (let x = 0; x < indices.length; x++) {
    const t = wiz.tasks[indices[x]];
    try {
      const data = buildTaskPayload(t);
      await createTask(data);
      success++;
      log.innerHTML += `<div style="color:#16A34A;">✓ ${esc(t.title)}</div>`;
    } catch (err) {
      errors++;
      errDetails.push({ title: t.title, error: err.message });
      log.innerHTML += `<div style="color:#EF4444;">✗ ${esc(t.title)}: ${esc(err.message)}</div>`;
    }
    const pct = Math.round(((x + 1) / indices.length) * 100);
    bar.style.width = pct + '%';
    txt.textContent = `${x + 1} / ${indices.length}`;
    log.scrollTop = log.scrollHeight;
    if ((x + 1) % 10 === 0) await sleep(50);
  }

  wiz.importResults = { success, errors, errDetails, total: indices.length };
  body.innerHTML = renderImportResults();
  updateFooter();
}

function buildTaskPayload(t) {
  const tags = [];
  if (wiz.importTag) tags.push(wiz.importTag);
  if (t.bucket && wiz.bucketMap[t.bucket] === 'tag') tags.push(`planner:${t.bucket}`);
  t.labels.forEach(l => tags.push(l));
  if (t.isRecurring) tags.push('recorrente-planner');

  const assignees = [];
  let hasUnresolved = false;
  t.assigneeNames.forEach(name => {
    const m = wiz.userMap[name];
    if (m?.userId) assignees.push(m.userId);
    else hasUnresolved = true;
  });
  if (hasUnresolved) tags.push('planner-sem-responsavel');

  const subtasks = t.checklistItems.map((title, i) => {
    const doneMatch = (t.checklistDone || '').match(/^(\d+)/);
    const doneCount = doneMatch ? parseInt(doneMatch[1]) : 0;
    return { title, done: i < doneCount };
  });

  let desc = t.description;
  if (t.plannerId) { desc += (desc ? '\n\n' : '') + `[Importado do Planner — ID: ${t.plannerId}]`; }

  return {
    title: t.title || 'Sem título',
    description: desc,
    status: t.status,
    priority: t.priority,
    assignees,
    tags,
    startDate: parseDate(t.startDate),
    dueDate: parseDate(t.dueDate),
    subtasks,
    customFields: {
      plannerId: t.plannerId || null,
      plannerBucket: t.bucket || null,
      plannerCreatedBy: t.plannerCreatedBy || null,
      plannerCreatedAt: t.plannerCreatedAt || null,
    },
  };
}

function renderImportResults() {
  const r = wiz.importResults; if (!r) return '';
  return `
    <div class="pi-wizard">
      ${stepIndicator(5)}
      <div class="pi-step-body" style="text-align:center;padding:30px 20px;">
        <div style="font-size:4rem;margin-bottom:16px;">${r.errors ? '⚠️' : '🎉'}</div>
        <h3 style="margin:0 0 8px;">Importação concluída!</h3>
        <div style="display:flex;gap:16px;justify-content:center;margin:20px 0;">
          <div style="padding:14px 24px;border-radius:10px;background:#F0FDF4;border:1px solid #BBF7D0;">
            <div style="font-size:1.75rem;font-weight:700;color:#16A34A;">${r.success}</div>
            <div style="font-size:0.8125rem;color:#16A34A;">Importadas</div>
          </div>
          ${r.errors ? `<div style="padding:14px 24px;border-radius:10px;background:#FEF2F2;border:1px solid #FECACA;">
            <div style="font-size:1.75rem;font-weight:700;color:#EF4444;">${r.errors}</div>
            <div style="font-size:0.8125rem;color:#EF4444;">Com erro</div>
          </div>` : ''}
        </div>
        ${r.errors && r.errDetails.length ? `<div style="text-align:left;max-height:200px;overflow-y:auto;font-size:0.75rem;
          padding:12px;background:var(--bg-surface);border-radius:8px;border:1px solid var(--border);margin-top:12px;">
          ${r.errDetails.map(e => `<div style="color:#EF4444;margin-bottom:4px;">✗ <strong>${esc(e.title)}</strong>: ${esc(e.error)}</div>`).join('')}
        </div>` : ''}
        <p style="color:var(--text-muted);font-size:0.8125rem;margin-top:20px;">
          ${wiz.importTag ? `Filtre por <code style="background:#EFF6FF;padding:2px 6px;border-radius:4px;">${esc(wiz.importTag)}</code> para ver todas.` : ''}
        </p>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   Navigation & Footer
   ═══════════════════════════════════════════════════════════ */
function stepIndicator(cur) {
  const steps = [{n:1,l:'Upload'},{n:2,l:'Campos'},{n:3,l:'Usuários'},{n:4,l:'Buckets'},{n:5,l:'Revisar'}];
  return `<div style="display:flex;gap:4px;margin-bottom:24px;justify-content:center;">
    ${steps.map(s => {
      const act = s.n === cur, done = s.n < cur;
      const bg = act ? 'var(--brand-blue,#3B82F6)' : done ? '#16A34A' : 'var(--border,#e5e7eb)';
      const tc = (act || done) ? '#fff' : 'var(--text-muted)';
      return `<div style="display:flex;align-items:center;gap:4px;">
        <div style="width:28px;height:28px;border-radius:50%;background:${bg};color:${tc};
          display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;">
          ${done ? '✓' : s.n}</div>
        <span style="font-size:0.75rem;font-weight:600;color:${act ? 'var(--text-primary)' : 'var(--text-muted)'};
          ${s.n<5?'margin-right:12px;':''}">${s.l}</span>
        ${s.n<5 ? '<div style="width:24px;height:2px;background:var(--border,#e5e7eb);margin-right:4px;"></div>' : ''}
      </div>`;
    }).join('')}
  </div>`;
}

function buildFooter() {
  const step = wiz.step;
  const hasData = wiz.rawRows.length > 0;
  const isRes = !!wiz.importResults;
  const btns = [];

  if (isRes) return [{ label: 'Fechar', class: 'btn-primary', closeOnClick: true, onClick: () => {} }];

  if (step > 1) btns.push({ label: '← Voltar', class: 'btn-secondary', closeOnClick: false, onClick: () => goToStep(step - 1) });

  if (step < 5) btns.push({
    label: 'Avançar →',
    class: 'btn-primary' + (!hasData && step === 1 ? ' disabled' : ''),
    closeOnClick: false,
    onClick: () => { if (!hasData && step === 1) { toast.warning('Selecione um arquivo.'); return; } goToStep(step + 1); },
  });

  if (step === 5 && !isRes) btns.push({
    label: `Importar ${wiz.selectedRows.size} tarefas`,
    class: 'btn-primary',
    closeOnClick: false,
    onClick: () => executeImport(),
  });

  return btns;
}

function updateFooter() {
  const el = wiz.modalRef?.getElement(); if (!el) return;
  const footerEl = el.querySelector('.modal-footer'); if (!footerEl) return;
  const btns = buildFooter();
  footerEl.innerHTML = btns.map((b, i) => `<button class="btn ${b.class||''}" data-fi="${i}">${b.label}</button>`).join('');
  footerEl.querySelectorAll('button').forEach(btn => {
    const cfg = btns[parseInt(btn.dataset.fi)];
    btn.addEventListener('click', async (e) => {
      if (cfg.onClick) await cfg.onClick(e, { close: () => wiz.modalRef?.close() });
      if (cfg.closeOnClick) wiz.modalRef?.close();
    });
  });
}

function goToStep(step) {
  wiz.step = step;
  const body = wiz.modalRef?.getBody(); if (!body) return;
  switch (step) {
    case 1: body.innerHTML = renderStep1(); attachStep1Events(); break;
    case 2: body.innerHTML = renderStep2(); break;
    case 3: body.innerHTML = renderStep3(); attachStep3Events(); break;
    case 4: body.innerHTML = renderStep4(); attachStep4Events(); break;
    case 5: body.innerHTML = renderStep5(); attachStep5Events(); break;
  }
  updateFooter();
}

/* ─── Utilities ──────────────────────────────────────────── */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v)) return v;
  const d = new Date(v); return isNaN(d.getTime()) ? null : d;
}
function fmtDate(v) {
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' });
}
function toISODate(v) {
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

/* ─── Styles ─────────────────────────────────────────────── */
(function injectStyles() {
  if (document.getElementById('pi-wiz-css')) return;
  const s = document.createElement('style');
  s.id = 'pi-wiz-css';
  s.textContent = `
    .pi-wizard { max-width:100%; }
    .pi-step-body { min-height:200px; }

    .pi-table { width:100%; border-collapse:collapse; font-size:0.8125rem; }
    .pi-table th { padding:8px 10px; text-align:left; white-space:nowrap; background:var(--bg-surface);
      border-bottom:2px solid var(--border); font-weight:700; font-size:0.75rem;
      text-transform:uppercase; letter-spacing:0.03em; color:var(--text-muted); }
    .pi-table td { padding:7px 10px; border-bottom:1px solid var(--border,#f3f4f6); vertical-align:middle; }
    .pi-table tbody tr:hover { background:var(--bg-surface,#f9fafb); }

    .pi-type-badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:0.6875rem;
      font-weight:600; background:color-mix(in srgb, var(--tc) 12%, transparent);
      color:var(--tc); border:1px solid color-mix(in srgb, var(--tc) 25%, transparent); }

    .pi-badge-exact, .pi-badge-convert, .pi-badge-info {
      display:inline-block; padding:1px 8px; border-radius:999px; font-size:0.6875rem; font-weight:600; margin:0 2px; }
    .pi-badge-exact   { background:#F0FDF4; color:#16A34A; border:1px solid #BBF7D0; }
    .pi-badge-convert { background:#FEF3C7; color:#D97706; border:1px solid #FDE68A; }
    .pi-badge-info    { background:#F3F4F6; color:#6B7280; border:1px solid #E5E7EB; }

    .pi-stat-card { padding:8px 16px; border-radius:8px; font-size:0.8125rem;
      background:var(--bg); border:1px solid var(--bc); color:var(--tc); }

    .pi-match-dot { display:inline-flex; align-items:center; justify-content:center;
      width:24px; height:24px; border-radius:50%; font-size:0.75rem; font-weight:700;
      background:color-mix(in srgb, var(--c) 12%, transparent); color:var(--c); }

    .pi-note { margin-top:16px; padding:12px 16px; background:var(--bg-surface); border-radius:8px;
      border:1px solid var(--border); font-size:0.8125rem; }
    .pi-note code { background:#FEF3C7; padding:1px 6px; border-radius:4px; font-size:0.75rem; }

    .pi-user-chip { display:inline-block; padding:1px 7px; border-radius:999px; font-size:0.6875rem;
      font-weight:600; background:color-mix(in srgb, var(--chip-c) 10%, transparent);
      color:var(--chip-c); border:1px solid color-mix(in srgb, var(--chip-c) 20%, transparent);
      margin:1px 2px; white-space:nowrap; }

    /* Inline edit fields */
    .pi-inline-input { background:transparent; border:1px solid transparent; border-radius:4px;
      padding:3px 6px; font-size:0.75rem; color:var(--text-primary);
      transition:border-color 0.15s; outline:none; }
    .pi-inline-input:hover { border-color:var(--border); }
    .pi-inline-input:focus { border-color:var(--brand-blue,#3B82F6); background:var(--bg-card,#fff); }

    .pi-inline-select { background:transparent; border:1px solid transparent; border-radius:4px;
      padding:3px 4px; font-size:0.75rem; cursor:pointer; outline:none;
      transition:border-color 0.15s; -webkit-appearance:none; appearance:none; }
    .pi-inline-select:hover { border-color:var(--border); }
    .pi-inline-select:focus { border-color:var(--brand-blue,#3B82F6); }

    .pi-edit-table tbody tr { transition:opacity 0.15s; }
    .pi-erow td { padding:5px 8px !important; }

    .pi-qsel { padding:3px 10px !important; font-size:0.75rem !important; }
    .btn.disabled { opacity:0.5; pointer-events:none; }
    .text-muted { color:var(--text-muted); }

    @media (max-width:768px) {
      .pi-edit-table { font-size:0.7rem; }
      .pi-inline-input, .pi-inline-select { font-size:0.7rem; }
    }
  `;
  document.head.appendChild(s);
})();
