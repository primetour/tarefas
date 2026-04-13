/**
 * PRIMETOUR — Planner Import Wizard
 * Importação detalhada de tarefas do Microsoft Planner (XLSX)
 * 5 etapas: Upload → Mapeamento → Usuários → Buckets → Importação
 */

import { store } from '../store.js';
import { modal } from './modal.js';
import { toast } from './toast.js';
import { createTask } from '../services/tasks.js';

/* ─── Constants ──────────────────────────────────────────── */
const PLANNER_COLUMNS = [
  'Identificação da tarefa','Nome da tarefa','Nome do Bucket','Progresso',
  'Prioridade','Atribuído a','Criado por','Criado em','Data de início',
  'Data de conclusão','É Recorrente','Atrasados','Concluído em',
  'Concluída por','Itens concluídos da lista de verificação',
  'Itens da lista de verificação','Rótulos','Descrição',
];

const PROGRESS_MAP = {
  'Não iniciado': 'not_started',
  'Em andamento': 'in_progress',
  'Concluída':    'done',
};

const PRIORITY_MAP = {
  'Urgente':    'urgent',
  'Importante': 'high',
  'Média':      'medium',
  'Baixa':      'low',
};

const esc = s => String(s||'').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ─── Wizard State ───────────────────────────────────────── */
let wizState = {
  step: 1,
  rawRows: [],
  headers: [],
  // Step 2 — field mapping
  fieldMap: {},
  // Step 3 — user mapping
  plannerUsers: [],      // unique names from Planner
  systemUsers: [],       // from store
  userMap: {},           // plannerName → { userId, userName } | null
  // Step 4 — bucket mapping
  plannerBuckets: [],
  bucketMap: {},         // bucketName → { projectId, projectName } | 'tag'
  // Step 5 — selection & import
  selectedRows: new Set(),
  importTag: '',
  importResults: null,
  modalRef: null,
};

/* ─── Entry Point ────────────────────────────────────────── */
export function openPlannerImportWizard() {
  wizState = {
    step: 1, rawRows: [], headers: [],
    fieldMap: {}, plannerUsers: [], systemUsers: [],
    userMap: {}, plannerBuckets: [], bucketMap: {},
    selectedRows: new Set(), importTag: 'planner-import',
    importResults: null, modalRef: null,
  };

  const ref = modal.open({
    title: '📋 Importar do Microsoft Planner',
    content: renderStep1(),
    size: 'xl',
    footer: buildFooter(),
    closeable: true,
  });
  wizState.modalRef = ref;
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
          background:var(--bg-surface);border-radius:8px;border:1px solid var(--border);">
        </div>
        <div id="pi-parse-error" style="margin-top:12px;display:none;padding:12px 16px;
          background:#FEF2F2;color:#DC2626;border-radius:8px;font-size:0.875rem;"></div>
      </div>
    </div>`;
}

function attachStep1Events() {
  const body = wizState.modalRef?.getBody();
  if (!body) return;
  const dropzone = body.querySelector('#pi-dropzone');
  const fileInput = body.querySelector('#pi-file');

  dropzone?.addEventListener('click', () => fileInput?.click());
  dropzone?.addEventListener('dragover', e => { e.preventDefault(); dropzone.style.borderColor = 'var(--brand-blue)'; });
  dropzone?.addEventListener('dragleave', () => { dropzone.style.borderColor = 'var(--border,#e5e7eb)'; });
  dropzone?.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--border,#e5e7eb)';
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  fileInput?.addEventListener('change', e => {
    if (e.target.files.length) handleFile(e.target.files[0]);
  });
}

async function handleFile(file) {
  const body = wizState.modalRef?.getBody();
  if (!body) return;
  const errDiv = body.querySelector('#pi-parse-error');
  const infoDiv = body.querySelector('#pi-file-info');

  if (!file.name.endsWith('.xlsx')) {
    errDiv.textContent = 'Formato inválido. Selecione um arquivo .xlsx exportado do Planner.';
    errDiv.style.display = 'block';
    return;
  }
  errDiv.style.display = 'none';
  infoDiv.style.display = 'block';
  infoDiv.innerHTML = `<span style="color:var(--text-muted);">Processando <strong>${esc(file.name)}</strong>...</span>`;

  try {
    // Load SheetJS from CDN
    if (!window.XLSX) {
      await loadScript('https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js');
    }
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array', cellDates: true });
    const sheetName = wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });

    if (!rows.length) throw new Error('Planilha vazia.');

    wizState.headers = Object.keys(rows[0]);
    wizState.rawRows = rows;

    // Auto-detect columns
    autoMapFields();
    extractPlannerUsers();
    extractBuckets();

    const totalTasks = rows.length;
    const withDates = rows.filter(r => r['Data de conclusão']).length;
    const completed = rows.filter(r => (r['Progresso']||'') === 'Concluída').length;

    infoDiv.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="font-size:1.5rem;">✅</span>
        <div>
          <strong>${esc(file.name)}</strong>
          <div style="font-size:0.8125rem;color:var(--text-muted);margin-top:2px;">
            ${totalTasks} tarefas · ${withDates} com prazo · ${completed} concluídas · ${wizState.plannerUsers.length} pessoas · ${wizState.plannerBuckets.length} buckets
          </div>
        </div>
      </div>`;

    // Enable next button
    updateFooter();
  } catch (err) {
    errDiv.textContent = 'Erro ao processar: ' + err.message;
    errDiv.style.display = 'block';
    infoDiv.style.display = 'none';
  }
}

function autoMapFields() {
  wizState.fieldMap = {
    title:       'Nome da tarefa',
    description: 'Descrição',
    status:      'Progresso',
    priority:    'Prioridade',
    assignees:   'Atribuído a',
    startDate:   'Data de início',
    dueDate:     'Data de conclusão',
    bucket:      'Nome do Bucket',
    labels:      'Rótulos',
    checklist:   'Itens da lista de verificação',
    checklistDone: 'Itens concluídos da lista de verificação',
    createdAt:   'Criado em',
    createdBy:   'Criado por',
    isRecurring: 'É Recorrente',
    completedAt: 'Concluído em',
    completedBy: 'Concluída por',
    plannerId:   'Identificação da tarefa',
  };
}

function extractPlannerUsers() {
  const nameSet = new Set();
  wizState.rawRows.forEach(r => {
    const assigned = r['Atribuído a'] || '';
    assigned.split(';').map(n => n.trim()).filter(Boolean).forEach(n => nameSet.add(n));
    const createdBy = (r['Criado por'] || '').trim();
    if (createdBy) nameSet.add(createdBy);
  });
  wizState.plannerUsers = [...nameSet].sort((a,b) => a.localeCompare(b, 'pt-BR'));
}

function extractBuckets() {
  const bucketSet = new Set();
  wizState.rawRows.forEach(r => {
    const b = (r['Nome do Bucket'] || '').trim();
    if (b) bucketSet.add(b);
  });
  wizState.plannerBuckets = [...bucketSet].sort((a,b) => a.localeCompare(b, 'pt-BR'));
}

/* ═══════════════════════════════════════════════════════════
   STEP 2 — Field Mapping
   ═══════════════════════════════════════════════════════════ */
function renderStep2() {
  const fields = [
    { key: 'title',       label: 'Título',             sys: 'title',       type: 'exact',   required: true },
    { key: 'description', label: 'Descrição',           sys: 'description', type: 'exact' },
    { key: 'status',      label: 'Status / Progresso',  sys: 'status',      type: 'convert', convertInfo: 'Não iniciado → not_started, Em andamento → in_progress, Concluída → done' },
    { key: 'priority',    label: 'Prioridade',          sys: 'priority',    type: 'convert', convertInfo: 'Urgente → urgent, Importante → high, Média → medium, Baixa → low' },
    { key: 'assignees',   label: 'Responsáveis',        sys: 'assignees',   type: 'convert', convertInfo: 'Nomes → IDs de usuário (resolução na Etapa 3)' },
    { key: 'startDate',   label: 'Data de início',      sys: 'startDate',   type: 'exact' },
    { key: 'dueDate',     label: 'Data de conclusão',   sys: 'dueDate',     type: 'exact' },
    { key: 'bucket',      label: 'Bucket',              sys: 'tags / projeto', type: 'convert', convertInfo: 'Mapeamento na Etapa 4' },
    { key: 'labels',      label: 'Rótulos',             sys: 'tags',        type: 'exact' },
    { key: 'checklist',   label: 'Checklist',           sys: 'subtasks',    type: 'convert', convertInfo: 'Itens separados por ";" → subtasks [{title, done}]' },
    { key: 'createdAt',   label: 'Criado em',           sys: 'metadata',    type: 'info' },
    { key: 'createdBy',   label: 'Criado por',          sys: 'metadata',    type: 'info' },
    { key: 'completedAt', label: 'Concluído em',        sys: 'metadata',    type: 'info' },
    { key: 'isRecurring', label: 'Recorrente',          sys: 'tags',        type: 'convert', convertInfo: '"Sim" → tag "recorrente-planner"' },
    { key: 'plannerId',   label: 'ID Planner',          sys: 'customFields', type: 'exact',  convertInfo: 'Salvo em customFields.plannerId' },
  ];

  // Count values for each field
  const stats = {};
  fields.forEach(f => {
    const col = wizState.fieldMap[f.key];
    if (!col) return;
    const filled = wizState.rawRows.filter(r => r[col] !== '' && r[col] != null).length;
    stats[f.key] = filled;
  });

  return `
    <div class="pi-wizard">
      ${stepIndicator(2)}
      <div class="pi-step-body">
        <h3 style="margin:0 0 4px;">Mapeamento de campos</h3>
        <p style="color:var(--text-muted);font-size:0.8125rem;margin:0 0 16px;">
          Veja como cada coluna do Planner será convertida para o sistema. Campos em
          <span style="color:#16A34A;font-weight:600;">verde</span> são diretos,
          <span style="color:#D97706;font-weight:600;">amarelo</span> precisam de conversão e
          <span style="color:#6B7280;font-weight:600;">cinza</span> são apenas informativos.
        </p>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.8125rem;">
            <thead>
              <tr style="background:var(--bg-surface);border-bottom:2px solid var(--border);">
                <th style="padding:8px 12px;text-align:left;">Coluna Planner</th>
                <th style="padding:8px 12px;text-align:left;">Campo Sistema</th>
                <th style="padding:8px 12px;text-align:center;">Tipo</th>
                <th style="padding:8px 12px;text-align:right;">Preenchidos</th>
                <th style="padding:8px 12px;text-align:left;">Observação</th>
              </tr>
            </thead>
            <tbody>
              ${fields.map(f => {
                const col = wizState.fieldMap[f.key] || '—';
                const found = wizState.headers.includes(col);
                const count = stats[f.key] || 0;
                const pct = wizState.rawRows.length ? Math.round(count / wizState.rawRows.length * 100) : 0;
                let typeColor, typeLabel;
                if (f.type === 'exact')   { typeColor = '#16A34A'; typeLabel = 'Direto'; }
                else if (f.type === 'convert') { typeColor = '#D97706'; typeLabel = 'Conversão'; }
                else { typeColor = '#6B7280'; typeLabel = 'Info'; }
                return `
                  <tr style="border-bottom:1px solid var(--border,#e5e7eb);">
                    <td style="padding:8px 12px;">
                      <span style="font-weight:600;">${esc(col)}</span>
                      ${!found && col !== '—' ? '<span style="color:#EF4444;font-size:0.75rem;"> (não encontrado)</span>' : ''}
                    </td>
                    <td style="padding:8px 12px;color:var(--text-primary);">${esc(f.sys)}</td>
                    <td style="padding:8px 12px;text-align:center;">
                      <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:0.6875rem;
                        font-weight:600;background:${typeColor}15;color:${typeColor};border:1px solid ${typeColor}30;">
                        ${typeLabel}
                      </span>
                    </td>
                    <td style="padding:8px 12px;text-align:right;">
                      <span style="font-weight:600;">${count}</span>
                      <span style="color:var(--text-muted);"> / ${wizState.rawRows.length} (${pct}%)</span>
                    </td>
                    <td style="padding:8px 12px;color:var(--text-muted);font-size:0.75rem;max-width:220px;">
                      ${f.convertInfo ? esc(f.convertInfo) : '—'}
                    </td>
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
  wizState.systemUsers = sysUsers.filter(u => u.active !== false);

  // Auto-suggest matches (fuzzy name match)
  if (!Object.keys(wizState.userMap).length) {
    wizState.plannerUsers.forEach(pName => {
      const match = findBestUserMatch(pName, wizState.systemUsers);
      wizState.userMap[pName] = match;
    });
  }

  const matched = wizState.plannerUsers.filter(n => wizState.userMap[n]?.userId).length;
  const unmatched = wizState.plannerUsers.length - matched;

  // Count tasks per user
  const taskCounts = {};
  wizState.rawRows.forEach(r => {
    const names = (r['Atribuído a'] || '').split(';').map(n => n.trim()).filter(Boolean);
    names.forEach(n => { taskCounts[n] = (taskCounts[n] || 0) + 1; });
  });

  return `
    <div class="pi-wizard">
      ${stepIndicator(3)}
      <div class="pi-step-body">
        <h3 style="margin:0 0 4px;">Resolução de usuários</h3>
        <p style="color:var(--text-muted);font-size:0.8125rem;margin:0 0 4px;">
          Conecte cada pessoa do Planner a um usuário cadastrado no sistema.
        </p>
        <div style="display:flex;gap:16px;margin-bottom:16px;">
          <div style="padding:8px 16px;border-radius:8px;background:#F0FDF4;border:1px solid #BBF7D0;">
            <span style="font-weight:700;color:#16A34A;">${matched}</span>
            <span style="color:#16A34A;font-size:0.8125rem;"> conectados</span>
          </div>
          <div style="padding:8px 16px;border-radius:8px;background:${unmatched ? '#FEF3C7' : '#F0FDF4'};border:1px solid ${unmatched ? '#FDE68A' : '#BBF7D0'};">
            <span style="font-weight:700;color:${unmatched ? '#D97706' : '#16A34A'};">${unmatched}</span>
            <span style="color:${unmatched ? '#D97706' : '#16A34A'};font-size:0.8125rem;"> sem correspondência</span>
          </div>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.8125rem;">
            <thead>
              <tr style="background:var(--bg-surface);border-bottom:2px solid var(--border);">
                <th style="padding:8px 12px;text-align:left;">Pessoa no Planner</th>
                <th style="padding:8px 12px;text-align:center;">Tarefas</th>
                <th style="padding:8px 12px;text-align:center;">Status</th>
                <th style="padding:8px 12px;text-align:left;">Usuário no Sistema</th>
              </tr>
            </thead>
            <tbody>
              ${wizState.plannerUsers.map(pName => {
                const map = wizState.userMap[pName];
                const isMatched = !!map?.userId;
                const count = taskCounts[pName] || 0;
                return `
                  <tr style="border-bottom:1px solid var(--border);" data-planner-user="${esc(pName)}">
                    <td style="padding:8px 12px;font-weight:600;">${esc(pName)}</td>
                    <td style="padding:8px 12px;text-align:center;">${count}</td>
                    <td style="padding:8px 12px;text-align:center;">
                      ${isMatched
                        ? '<span style="color:#16A34A;font-weight:600;">✓ Conectado</span>'
                        : '<span style="color:#D97706;font-weight:600;">? Pendente</span>'}
                    </td>
                    <td style="padding:8px 12px;">
                      <select class="pi-user-select form-input" data-planner="${esc(pName)}"
                        style="height:32px;font-size:0.8125rem;min-width:220px;${isMatched ? 'border-color:#16A34A;' : 'border-color:#D97706;'}">
                        <option value="">— Sem responsável (tag para atualizar depois) —</option>
                        ${wizState.systemUsers.map(u => `
                          <option value="${esc(u.id)}" ${map?.userId === u.id ? 'selected' : ''}>
                            ${esc(u.name)} (${esc(u.email || u.sector || '')})
                          </option>
                        `).join('')}
                      </select>
                    </td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div style="margin-top:16px;padding:12px 16px;background:var(--bg-surface);border-radius:8px;border:1px solid var(--border);font-size:0.8125rem;">
          <strong>Nota:</strong> Pessoas sem correspondência serão importadas sem responsável e receberão a tag
          <code style="background:#FEF3C7;padding:1px 6px;border-radius:4px;font-size:0.75rem;">planner-sem-responsavel</code>
          para que você possa filtrar e atualizar facilmente depois.
        </div>
      </div>
    </div>`;
}

function attachStep3Events() {
  const body = wizState.modalRef?.getBody();
  if (!body) return;
  body.querySelectorAll('.pi-user-select').forEach(sel => {
    sel.addEventListener('change', e => {
      const plannerName = e.target.dataset.planner;
      const userId = e.target.value;
      if (userId) {
        const user = wizState.systemUsers.find(u => u.id === userId);
        wizState.userMap[plannerName] = { userId, userName: user?.name || '' };
        e.target.style.borderColor = '#16A34A';
      } else {
        wizState.userMap[plannerName] = null;
        e.target.style.borderColor = '#D97706';
      }
      // Update status cell
      const row = e.target.closest('tr');
      const statusCell = row?.querySelectorAll('td')[2];
      if (statusCell) {
        statusCell.innerHTML = userId
          ? '<span style="color:#16A34A;font-weight:600;">✓ Conectado</span>'
          : '<span style="color:#D97706;font-weight:600;">? Pendente</span>';
      }
    });
  });
}

function findBestUserMatch(plannerName, systemUsers) {
  if (!plannerName || !systemUsers.length) return null;
  const pNorm = normalize(plannerName);

  // 1. Exact name match
  let match = systemUsers.find(u => normalize(u.name) === pNorm);
  if (match) return { userId: match.id, userName: match.name };

  // 2. First+last name match (Planner often has "Firstname Lastname")
  const pParts = pNorm.split(/\s+/);
  if (pParts.length >= 2) {
    match = systemUsers.find(u => {
      const sParts = normalize(u.name).split(/\s+/);
      return sParts[0] === pParts[0] && sParts[sParts.length - 1] === pParts[pParts.length - 1];
    });
    if (match) return { userId: match.id, userName: match.name };
  }

  // 3. First name only match (if unique)
  if (pParts.length >= 1) {
    const firstMatches = systemUsers.filter(u => normalize(u.name).split(/\s+/)[0] === pParts[0]);
    if (firstMatches.length === 1) return { userId: firstMatches[0].id, userName: firstMatches[0].name };
  }

  return null;
}

function normalize(s) {
  return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
}

/* ═══════════════════════════════════════════════════════════
   STEP 4 — Bucket / Sector Mapping
   ═══════════════════════════════════════════════════════════ */
function renderStep4() {
  // Count tasks per bucket
  const bucketCounts = {};
  wizState.rawRows.forEach(r => {
    const b = (r['Nome do Bucket'] || '').trim();
    if (b) bucketCounts[b] = (bucketCounts[b] || 0) + 1;
  });

  // Default: map all buckets as tags
  if (!Object.keys(wizState.bucketMap).length) {
    wizState.plannerBuckets.forEach(b => { wizState.bucketMap[b] = 'tag'; });
  }

  return `
    <div class="pi-wizard">
      ${stepIndicator(4)}
      <div class="pi-step-body">
        <h3 style="margin:0 0 4px;">Mapeamento de Buckets</h3>
        <p style="color:var(--text-muted);font-size:0.8125rem;margin:0 0 16px;">
          Defina como cada Bucket do Planner será tratado no sistema.
          Você pode converter em <strong>tag</strong> (recomendado) ou ignorar.
        </p>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.8125rem;">
            <thead>
              <tr style="background:var(--bg-surface);border-bottom:2px solid var(--border);">
                <th style="padding:8px 12px;text-align:left;">Bucket no Planner</th>
                <th style="padding:8px 12px;text-align:center;">Tarefas</th>
                <th style="padding:8px 12px;text-align:left;">Ação no Sistema</th>
              </tr>
            </thead>
            <tbody>
              ${wizState.plannerBuckets.map(b => {
                const count = bucketCounts[b] || 0;
                const action = wizState.bucketMap[b] || 'tag';
                return `
                  <tr style="border-bottom:1px solid var(--border);">
                    <td style="padding:8px 12px;font-weight:600;">${esc(b)}</td>
                    <td style="padding:8px 12px;text-align:center;">${count}</td>
                    <td style="padding:8px 12px;">
                      <select class="pi-bucket-action form-input" data-bucket="${esc(b)}"
                        style="height:32px;font-size:0.8125rem;min-width:200px;">
                        <option value="tag" ${action === 'tag' ? 'selected' : ''}>Converter em Tag</option>
                        <option value="ignore" ${action === 'ignore' ? 'selected' : ''}>Ignorar (não importar tag)</option>
                      </select>
                    </td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div style="margin-top:16px;padding:12px 16px;background:var(--bg-surface);border-radius:8px;border:1px solid var(--border);">
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">
            Tag de importação (aplicada a todas as tarefas):
          </label>
          <input type="text" id="pi-import-tag" class="form-input" value="${esc(wizState.importTag)}"
            style="height:32px;font-size:0.8125rem;max-width:300px;"
            placeholder="ex: planner-import" />
          <p style="color:var(--text-muted);font-size:0.75rem;margin:4px 0 0;">
            Facilita filtrar todas as tarefas importadas do Planner.
          </p>
        </div>
      </div>
    </div>`;
}

function attachStep4Events() {
  const body = wizState.modalRef?.getBody();
  if (!body) return;
  body.querySelectorAll('.pi-bucket-action').forEach(sel => {
    sel.addEventListener('change', e => {
      wizState.bucketMap[e.target.dataset.bucket] = e.target.value;
    });
  });
  const tagInput = body.querySelector('#pi-import-tag');
  tagInput?.addEventListener('input', e => { wizState.importTag = e.target.value.trim(); });
}

/* ═══════════════════════════════════════════════════════════
   STEP 5 — Preview & Import
   ═══════════════════════════════════════════════════════════ */
function renderStep5() {
  const rows = wizState.rawRows;
  const total = rows.length;
  const completed = rows.filter(r => (r['Progresso']||'') === 'Concluída').length;
  const inProgress = rows.filter(r => (r['Progresso']||'') === 'Em andamento').length;
  const notStarted = total - completed - inProgress;

  // Pre-select: only not completed by default
  if (wizState.selectedRows.size === 0 && !wizState.importResults) {
    rows.forEach((r, i) => {
      if ((r['Progresso']||'') !== 'Concluída') wizState.selectedRows.add(i);
    });
  }

  const selected = wizState.selectedRows.size;

  if (wizState.importResults) return renderImportResults();

  return `
    <div class="pi-wizard">
      ${stepIndicator(5)}
      <div class="pi-step-body">
        <h3 style="margin:0 0 4px;">Revisão e importação</h3>
        <p style="color:var(--text-muted);font-size:0.8125rem;margin:0 0 12px;">
          Revise e selecione as tarefas que deseja importar.
        </p>

        <!-- Summary cards -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:16px;">
          <div style="padding:10px 14px;border-radius:8px;background:var(--bg-surface);border:1px solid var(--border);text-align:center;">
            <div style="font-size:1.25rem;font-weight:700;">${total}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);">Total</div>
          </div>
          <div style="padding:10px 14px;border-radius:8px;background:#EFF6FF;border:1px solid #BFDBFE;text-align:center;">
            <div style="font-size:1.25rem;font-weight:700;color:#3B82F6;">${notStarted}</div>
            <div style="font-size:0.75rem;color:#3B82F6;">Não iniciadas</div>
          </div>
          <div style="padding:10px 14px;border-radius:8px;background:#FFFBEB;border:1px solid #FDE68A;text-align:center;">
            <div style="font-size:1.25rem;font-weight:700;color:#D97706;">${inProgress}</div>
            <div style="font-size:0.75rem;color:#D97706;">Em andamento</div>
          </div>
          <div style="padding:10px 14px;border-radius:8px;background:#F0FDF4;border:1px solid #BBF7D0;text-align:center;">
            <div style="font-size:1.25rem;font-weight:700;color:#16A34A;">${completed}</div>
            <div style="font-size:0.75rem;color:#16A34A;">Concluídas</div>
          </div>
          <div style="padding:10px 14px;border-radius:8px;background:#F5F3FF;border:1px solid #DDD6FE;text-align:center;">
            <div style="font-size:1.25rem;font-weight:700;color:#7C3AED;">${selected}</div>
            <div style="font-size:0.75rem;color:#7C3AED;">Selecionadas</div>
          </div>
        </div>

        <!-- Quick filters -->
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;align-items:center;">
          <span style="font-size:0.8125rem;font-weight:600;">Selecionar:</span>
          <button class="pi-sel-btn btn btn-sm" data-sel="all" style="font-size:0.75rem;">Todas</button>
          <button class="pi-sel-btn btn btn-sm" data-sel="none" style="font-size:0.75rem;">Nenhuma</button>
          <button class="pi-sel-btn btn btn-sm" data-sel="not_started" style="font-size:0.75rem;">Não iniciadas</button>
          <button class="pi-sel-btn btn btn-sm" data-sel="in_progress" style="font-size:0.75rem;">Em andamento</button>
          <button class="pi-sel-btn btn btn-sm" data-sel="completed" style="font-size:0.75rem;">Concluídas</button>
          <span style="margin-left:auto;">
            <input type="text" id="pi-preview-search" class="form-input" placeholder="Buscar tarefa..."
              style="height:30px;font-size:0.8125rem;width:200px;" />
          </span>
        </div>

        <!-- Tasks table -->
        <div style="max-height:400px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">
          <table style="width:100%;border-collapse:collapse;font-size:0.75rem;" id="pi-preview-table">
            <thead style="position:sticky;top:0;background:var(--bg-surface);z-index:1;">
              <tr style="border-bottom:2px solid var(--border);">
                <th style="padding:6px 8px;width:30px;text-align:center;">
                  <input type="checkbox" id="pi-select-all" ${selected === total ? 'checked' : ''} />
                </th>
                <th style="padding:6px 8px;text-align:left;">Tarefa</th>
                <th style="padding:6px 8px;text-align:left;">Bucket</th>
                <th style="padding:6px 8px;text-align:center;">Status</th>
                <th style="padding:6px 8px;text-align:center;">Prioridade</th>
                <th style="padding:6px 8px;text-align:left;">Responsável</th>
                <th style="padding:6px 8px;text-align:center;">Prazo</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((r, i) => renderPreviewRow(r, i)).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function renderPreviewRow(r, i) {
  const title = r['Nome da tarefa'] || 'Sem título';
  const bucket = r['Nome do Bucket'] || '';
  const progress = r['Progresso'] || '';
  const priority = r['Prioridade'] || '';
  const assigned = r['Atribuído a'] || '';
  const dueDate = r['Data de conclusão'];
  const checked = wizState.selectedRows.has(i);

  let statusColor = '#6B7280';
  if (progress === 'Concluída') statusColor = '#16A34A';
  else if (progress === 'Em andamento') statusColor = '#D97706';
  else statusColor = '#3B82F6';

  const dueFmt = dueDate ? formatDate(dueDate) : '—';

  // Check if assignees are resolved
  const assigneeNames = assigned.split(';').map(n => n.trim()).filter(Boolean);
  const resolvedCount = assigneeNames.filter(n => wizState.userMap[n]?.userId).length;
  const assigneeHtml = assigneeNames.length
    ? `<span style="color:${resolvedCount === assigneeNames.length ? '#16A34A' : '#D97706'};">
        ${esc(assigneeNames.map(n => (wizState.userMap[n]?.userName || n).split(' ')[0]).join(', '))}
      </span>`
    : '<span style="color:var(--text-muted);">—</span>';

  return `
    <tr style="border-bottom:1px solid var(--border,#f3f4f6);" class="pi-preview-row" data-idx="${i}">
      <td style="padding:6px 8px;text-align:center;">
        <input type="checkbox" class="pi-row-cb" data-idx="${i}" ${checked ? 'checked' : ''} />
      </td>
      <td style="padding:6px 8px;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
        title="${esc(title)}">${esc(title)}</td>
      <td style="padding:6px 8px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${esc(bucket)}</td>
      <td style="padding:6px 8px;text-align:center;">
        <span style="color:${statusColor};font-weight:600;font-size:0.6875rem;">${esc(progress || 'Não iniciado')}</span>
      </td>
      <td style="padding:6px 8px;text-align:center;font-size:0.6875rem;">${esc(priority || '—')}</td>
      <td style="padding:6px 8px;font-size:0.6875rem;">${assigneeHtml}</td>
      <td style="padding:6px 8px;text-align:center;font-size:0.6875rem;">${dueFmt}</td>
    </tr>`;
}

function attachStep5Events() {
  const body = wizState.modalRef?.getBody();
  if (!body) return;

  // Select all checkbox
  body.querySelector('#pi-select-all')?.addEventListener('change', e => {
    const checked = e.target.checked;
    const visibleRows = body.querySelectorAll('.pi-preview-row:not([style*="display: none"]) .pi-row-cb');
    visibleRows.forEach(cb => {
      const idx = parseInt(cb.dataset.idx);
      cb.checked = checked;
      if (checked) wizState.selectedRows.add(idx); else wizState.selectedRows.delete(idx);
    });
    updateSelectedCount();
  });

  // Individual row checkboxes
  body.addEventListener('change', e => {
    if (!e.target.classList.contains('pi-row-cb')) return;
    const idx = parseInt(e.target.dataset.idx);
    if (e.target.checked) wizState.selectedRows.add(idx); else wizState.selectedRows.delete(idx);
    updateSelectedCount();
  });

  // Quick selection buttons
  body.querySelectorAll('.pi-sel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sel = btn.dataset.sel;
      wizState.selectedRows.clear();
      if (sel === 'all') {
        wizState.rawRows.forEach((_, i) => wizState.selectedRows.add(i));
      } else if (sel === 'not_started') {
        wizState.rawRows.forEach((r, i) => { if ((r['Progresso']||'') === 'Não iniciado' || !r['Progresso']) wizState.selectedRows.add(i); });
      } else if (sel === 'in_progress') {
        wizState.rawRows.forEach((r, i) => { if ((r['Progresso']||'') === 'Em andamento') wizState.selectedRows.add(i); });
      } else if (sel === 'completed') {
        wizState.rawRows.forEach((r, i) => { if ((r['Progresso']||'') === 'Concluída') wizState.selectedRows.add(i); });
      }
      // Update all checkboxes
      body.querySelectorAll('.pi-row-cb').forEach(cb => {
        cb.checked = wizState.selectedRows.has(parseInt(cb.dataset.idx));
      });
      updateSelectedCount();
    });
  });

  // Search filter
  const searchInput = body.querySelector('#pi-preview-search');
  let timer;
  searchInput?.addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const term = e.target.value.toLowerCase();
      body.querySelectorAll('.pi-preview-row').forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(term) ? '' : 'none';
      });
    }, 200);
  });
}

function updateSelectedCount() {
  // Update the purple card
  const body = wizState.modalRef?.getBody();
  if (!body) return;
  const cards = body.querySelectorAll('[style*="F5F3FF"]');
  if (cards.length) {
    const numEl = cards[0].querySelector('div');
    if (numEl) numEl.textContent = wizState.selectedRows.size;
  }
  updateFooter();
}

/* ─── Import Execution ───────────────────────────────────── */
async function executeImport() {
  const selectedIndices = [...wizState.selectedRows].sort((a,b) => a - b);
  if (!selectedIndices.length) { toast.warning('Selecione ao menos uma tarefa.'); return; }

  const confirmed = await modal.confirm({
    title: 'Confirmar importação',
    message: `Importar <strong>${selectedIndices.length}</strong> tarefas do Planner para o sistema?<br><br>
      <span style="font-size:0.8125rem;color:var(--text-muted);">
        Esta ação criará novas tarefas. Nenhuma tarefa existente será alterada.
      </span>`,
    confirmText: `Importar ${selectedIndices.length} tarefas`,
    icon: '📋',
  });
  if (!confirmed) return;

  // Show progress
  const body = wizState.modalRef?.getBody();
  if (!body) return;
  body.innerHTML = `
    <div class="pi-wizard">
      ${stepIndicator(5)}
      <div class="pi-step-body" style="text-align:center;padding:40px 20px;">
        <div style="font-size:3rem;margin-bottom:16px;">⏳</div>
        <h3 id="pi-progress-title">Importando tarefas...</h3>
        <div style="max-width:400px;margin:16px auto;">
          <div style="background:var(--border);border-radius:999px;height:8px;overflow:hidden;">
            <div id="pi-progress-bar" style="width:0%;height:100%;background:var(--brand-blue,#3B82F6);
              border-radius:999px;transition:width 0.3s;"></div>
          </div>
          <p id="pi-progress-text" style="color:var(--text-muted);font-size:0.8125rem;margin:8px 0 0;">
            0 / ${selectedIndices.length}
          </p>
        </div>
        <div id="pi-progress-log" style="text-align:left;max-height:200px;overflow-y:auto;
          font-size:0.75rem;color:var(--text-muted);margin-top:20px;padding:12px;
          background:var(--bg-surface);border-radius:8px;border:1px solid var(--border);"></div>
      </div>
    </div>`;

  const progressBar = body.querySelector('#pi-progress-bar');
  const progressText = body.querySelector('#pi-progress-text');
  const progressTitle = body.querySelector('#pi-progress-title');
  const progressLog = body.querySelector('#pi-progress-log');

  let success = 0, errors = 0;
  const errorDetails = [];

  for (let idx = 0; idx < selectedIndices.length; idx++) {
    const rowIdx = selectedIndices[idx];
    const row = wizState.rawRows[rowIdx];

    try {
      const taskData = buildTaskData(row);
      await createTask(taskData);
      success++;
      progressLog.innerHTML += `<div style="color:#16A34A;">✓ ${esc(row['Nome da tarefa'] || 'Sem título')}</div>`;
    } catch (err) {
      errors++;
      errorDetails.push({ title: row['Nome da tarefa'], error: err.message });
      progressLog.innerHTML += `<div style="color:#EF4444;">✗ ${esc(row['Nome da tarefa'] || 'Sem título')}: ${esc(err.message)}</div>`;
    }

    const pct = Math.round(((idx + 1) / selectedIndices.length) * 100);
    progressBar.style.width = pct + '%';
    progressText.textContent = `${idx + 1} / ${selectedIndices.length}`;
    progressLog.scrollTop = progressLog.scrollHeight;

    // Small delay to avoid UI freezing
    if ((idx + 1) % 10 === 0) await sleep(50);
  }

  wizState.importResults = { success, errors, errorDetails, total: selectedIndices.length };
  progressTitle.textContent = 'Importação concluída!';
  progressBar.style.background = errors ? '#D97706' : '#16A34A';

  body.innerHTML = renderImportResults();
  updateFooter();
}

function buildTaskData(row) {
  const tags = [];

  // Import tag
  if (wizState.importTag) tags.push(wizState.importTag);

  // Bucket → tag
  const bucket = (row['Nome do Bucket'] || '').trim();
  if (bucket && wizState.bucketMap[bucket] === 'tag') {
    tags.push(`planner:${bucket}`);
  }

  // Labels → tags
  const labels = (row['Rótulos'] || '').split(';').map(l => l.trim()).filter(Boolean);
  labels.forEach(l => tags.push(l));

  // Recurring → tag
  if ((row['É Recorrente'] || '').toLowerCase() === 'sim') {
    tags.push('recorrente-planner');
  }

  // Assignees resolution
  const assigneeNames = (row['Atribuído a'] || '').split(';').map(n => n.trim()).filter(Boolean);
  const assignees = [];
  let hasUnresolved = false;
  assigneeNames.forEach(name => {
    const map = wizState.userMap[name];
    if (map?.userId) {
      assignees.push(map.userId);
    } else {
      hasUnresolved = true;
    }
  });
  if (hasUnresolved) tags.push('planner-sem-responsavel');

  // Status
  const progress = (row['Progresso'] || '').trim();
  const status = PROGRESS_MAP[progress] || 'not_started';

  // Priority
  const prio = (row['Prioridade'] || '').trim();
  const priority = PRIORITY_MAP[prio] || 'medium';

  // Dates
  const startDate = parseDate(row['Data de início']);
  const dueDate = parseDate(row['Data de conclusão']);

  // Subtasks from checklist
  const subtasks = parseChecklist(
    row['Itens da lista de verificação'] || '',
    row['Itens concluídos da lista de verificação'] || ''
  );

  // Description
  let description = (row['Descrição'] || '').trim();
  // Append Planner metadata
  const plannerId = (row['Identificação da tarefa'] || '').trim();
  if (plannerId) {
    description += description ? '\n\n' : '';
    description += `[Importado do Planner — ID: ${plannerId}]`;
  }

  return {
    title: (row['Nome da tarefa'] || 'Sem título').trim(),
    description,
    status,
    priority,
    assignees,
    tags,
    startDate,
    dueDate,
    subtasks,
    customFields: {
      plannerId: plannerId || null,
      plannerBucket: bucket || null,
      plannerCreatedBy: (row['Criado por'] || '').trim() || null,
      plannerCreatedAt: (row['Criado em'] || '').toString() || null,
    },
  };
}

function parseChecklist(itemsStr, doneStr) {
  if (!itemsStr) return [];
  const items = itemsStr.split(';').map(s => s.trim()).filter(Boolean);
  // doneStr can be "3/5" or similar — we parse completed count
  const doneMatch = (doneStr || '').match(/^(\d+)/);
  const doneCount = doneMatch ? parseInt(doneMatch[1]) : 0;

  return items.map((title, i) => ({
    title,
    done: i < doneCount,
  }));
}

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val)) return val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(val) {
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/* ─── Import Results ──────────────────────────────────────── */
function renderImportResults() {
  const r = wizState.importResults;
  if (!r) return '';
  return `
    <div class="pi-wizard">
      ${stepIndicator(5)}
      <div class="pi-step-body" style="text-align:center;padding:30px 20px;">
        <div style="font-size:4rem;margin-bottom:16px;">${r.errors ? '⚠️' : '🎉'}</div>
        <h3 style="margin:0 0 8px;">Importação concluída!</h3>
        <div style="display:flex;gap:16px;justify-content:center;margin:20px 0;">
          <div style="padding:14px 24px;border-radius:10px;background:#F0FDF4;border:1px solid #BBF7D0;">
            <div style="font-size:1.75rem;font-weight:700;color:#16A34A;">${r.success}</div>
            <div style="font-size:0.8125rem;color:#16A34A;">Importadas com sucesso</div>
          </div>
          ${r.errors ? `
            <div style="padding:14px 24px;border-radius:10px;background:#FEF2F2;border:1px solid #FECACA;">
              <div style="font-size:1.75rem;font-weight:700;color:#EF4444;">${r.errors}</div>
              <div style="font-size:0.8125rem;color:#EF4444;">Com erro</div>
            </div>
          ` : ''}
        </div>
        ${r.errors && r.errorDetails.length ? `
          <div style="text-align:left;max-height:200px;overflow-y:auto;font-size:0.75rem;
            padding:12px;background:var(--bg-surface);border-radius:8px;border:1px solid var(--border);margin-top:12px;">
            ${r.errorDetails.map(e => `<div style="color:#EF4444;margin-bottom:4px;">✗ <strong>${esc(e.title)}</strong>: ${esc(e.error)}</div>`).join('')}
          </div>
        ` : ''}
        <p style="color:var(--text-muted);font-size:0.8125rem;margin-top:20px;">
          ${wizState.importTag ? `Filtre por <code style="background:#EFF6FF;padding:2px 6px;border-radius:4px;">${esc(wizState.importTag)}</code> para ver todas as tarefas importadas.` : ''}
        </p>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   Navigation & Footer
   ═══════════════════════════════════════════════════════════ */
function stepIndicator(current) {
  const steps = [
    { n: 1, label: 'Upload' },
    { n: 2, label: 'Campos' },
    { n: 3, label: 'Usuários' },
    { n: 4, label: 'Buckets' },
    { n: 5, label: 'Importar' },
  ];
  return `
    <div style="display:flex;gap:4px;margin-bottom:24px;justify-content:center;">
      ${steps.map(s => {
        const isActive = s.n === current;
        const isDone = s.n < current;
        const bg = isActive ? 'var(--brand-blue,#3B82F6)' : isDone ? '#16A34A' : 'var(--border,#e5e7eb)';
        const textColor = (isActive || isDone) ? '#fff' : 'var(--text-muted)';
        return `
          <div style="display:flex;align-items:center;gap:4px;">
            <div style="width:28px;height:28px;border-radius:50%;background:${bg};color:${textColor};
              display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;">
              ${isDone ? '✓' : s.n}
            </div>
            <span style="font-size:0.75rem;font-weight:600;color:${isActive ? 'var(--text-primary)' : 'var(--text-muted)'};
              ${s.n < 5 ? 'margin-right:12px;' : ''}">${s.label}</span>
            ${s.n < 5 ? '<div style="width:24px;height:2px;background:var(--border,#e5e7eb);margin-right:4px;"></div>' : ''}
          </div>`;
      }).join('')}
    </div>`;
}

function buildFooter() {
  const step = wizState.step;
  const hasData = wizState.rawRows.length > 0;
  const isResults = !!wizState.importResults;
  const btns = [];

  if (isResults) {
    btns.push({
      label: 'Fechar',
      class: 'btn-primary',
      closeOnClick: true,
      onClick: () => {},
    });
    return btns;
  }

  if (step > 1) {
    btns.push({
      label: '← Voltar',
      class: 'btn-secondary',
      closeOnClick: false,
      onClick: () => goToStep(step - 1),
    });
  }

  if (step < 5) {
    btns.push({
      label: 'Avançar →',
      class: 'btn-primary' + (!hasData && step === 1 ? ' disabled' : ''),
      closeOnClick: false,
      onClick: () => {
        if (!hasData && step === 1) { toast.warning('Selecione um arquivo primeiro.'); return; }
        goToStep(step + 1);
      },
    });
  }

  if (step === 5 && !isResults) {
    btns.push({
      label: `Importar ${wizState.selectedRows.size} tarefas`,
      class: 'btn-primary',
      closeOnClick: false,
      onClick: () => executeImport(),
    });
  }

  return btns;
}

function updateFooter() {
  // Re-render footer by updating the modal
  const el = wizState.modalRef?.getElement();
  if (!el) return;
  const footerEl = el.querySelector('.modal-footer');
  if (!footerEl) return;

  const btns = buildFooter();
  footerEl.innerHTML = btns.map((b, i) => `
    <button class="btn ${b.class || ''}" data-footer-idx="${i}">${b.label}</button>
  `).join('');

  footerEl.querySelectorAll('button').forEach(btn => {
    const idx = parseInt(btn.dataset.footerIdx);
    const config = btns[idx];
    btn.addEventListener('click', async (e) => {
      if (config.onClick) await config.onClick(e, { close: () => wizState.modalRef?.close() });
      if (config.closeOnClick) wizState.modalRef?.close();
    });
  });
}

function goToStep(step) {
  wizState.step = step;
  const body = wizState.modalRef?.getBody();
  if (!body) return;

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

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/* ─── Injected Styles ────────────────────────────────────── */
(function injectStyles() {
  if (document.getElementById('pi-wizard-styles')) return;
  const style = document.createElement('style');
  style.id = 'pi-wizard-styles';
  style.textContent = `
    .pi-wizard { max-width: 100%; }
    .pi-step-body { min-height: 200px; }
    .pi-step-body table th { white-space: nowrap; }
    .pi-step-body table td { vertical-align: middle; }
    .pi-preview-row:hover { background: var(--bg-surface, #f9fafb); }
    .pi-sel-btn { padding: 3px 10px !important; }
    .btn.disabled { opacity: 0.5; pointer-events: none; }
  `;
  document.head.appendChild(style);
})();
