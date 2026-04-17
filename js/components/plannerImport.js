/**
 * PRIMETOUR — Planner Import Wizard
 * Importação detalhada de tarefas do Microsoft Planner (XLSX)
 * 5 etapas: Upload → Mapeamento → Usuários → Buckets/Setores → Revisão/Edição/Importação
 */

import { store } from '../store.js';
import { modal } from './modal.js';
import { toast } from './toast.js';
import { createTask, REQUESTING_AREAS } from '../services/tasks.js';

/* ─── Constants ──────────────────────────────────────────── */
const PROGRESS_MAP = { 'Não iniciado': 'not_started', 'Em andamento': 'in_progress', 'Concluída': 'done' };
const PRIORITY_MAP = { 'Urgente': 'urgent', 'Importante': 'high', 'Média': 'medium', 'Baixa': 'low' };

const STATUS_OPTS = [
  { value: 'not_started', label: 'Não iniciado', color: '#3B82F6' },
  { value: 'in_progress', label: 'Em andamento', color: '#F59E0B' },
  { value: 'done',        label: 'Concluída',    color: '#16A34A' },
];
const PRIO_OPTS = [
  { value: 'urgent', label: 'Urgente', color: '#EF4444', icon: '🔴' },
  { value: 'high',   label: 'Alta',    color: '#F97316', icon: '🟠' },
  { value: 'medium', label: 'Média',   color: '#F59E0B', icon: '🟡' },
  { value: 'low',    label: 'Baixa',   color: '#6B7280', icon: '⚪' },
];

const SYSTEM_SECTORS = [...REQUESTING_AREAS];

const esc = s => String(s || '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ─── State ──────────────────────────────────────────────── */
let wiz = {};

function resetState() {
  wiz = {
    step: 1, rawRows: [], headers: [], tasks: [],
    plannerUsers: [], systemUsers: [], userMap: {},
    plannerBuckets: [], bucketMap: {},
    selectedRows: new Set(), importTag: 'planner-import',
    importResults: null, modalRef: null,
    previewSearch: '', previewBucket: '', previewStatus: '',
  };
}

/* ─── Entry Point ────────────────────────────────────────── */
export function openPlannerImportWizard() {
  resetState();
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
  return `<div class="pi-wiz">
    ${stepBar(1)}
    <div class="pi-body">
      <h3 style="margin:0 0 8px;">Enviar arquivo do Planner</h3>
      <p class="pi-muted" style="margin:0 0 20px;">
        Exporte suas tarefas do Microsoft Planner como <strong>.xlsx</strong> e selecione o arquivo abaixo.
      </p>
      <div id="pi-drop" class="pi-dropzone">
        <div style="font-size:3rem;margin-bottom:12px;opacity:0.4;">📁</div>
        <p class="pi-muted" style="margin:0 0 8px;">Arraste o arquivo aqui ou clique para selecionar</p>
        <p class="pi-muted" style="font-size:0.75rem;margin:0;">Formato aceito: .xlsx</p>
        <input type="file" id="pi-file" accept=".xlsx" style="display:none;" />
      </div>
      <div id="pi-file-info" style="margin-top:12px;display:none;" class="pi-infobox"></div>
      <div id="pi-error" style="margin-top:12px;display:none;padding:12px 16px;background:#FEF2F2;color:#DC2626;border-radius:8px;font-size:0.875rem;"></div>
    </div>
  </div>`;
}

function attachStep1Events() {
  const body = wiz.modalRef?.getBody(); if (!body) return;
  const drop = body.querySelector('#pi-drop');
  const input = body.querySelector('#pi-file');
  drop?.addEventListener('click', () => input?.click());
  drop?.addEventListener('dragover', e => { e.preventDefault(); drop.style.borderColor = 'var(--brand-blue)'; });
  drop?.addEventListener('dragleave', () => { drop.style.borderColor = 'var(--border,#e5e7eb)'; });
  drop?.addEventListener('drop', e => { e.preventDefault(); drop.style.borderColor = 'var(--border,#e5e7eb)'; if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); });
  input?.addEventListener('change', e => { if (e.target.files.length) handleFile(e.target.files[0]); });
}

async function handleFile(file) {
  const body = wiz.modalRef?.getBody(); if (!body) return;
  const err = body.querySelector('#pi-error');
  const info = body.querySelector('#pi-file-info');

  if (!file.name.endsWith('.xlsx')) {
    err.textContent = 'Formato inválido. Selecione um arquivo .xlsx.';
    err.style.display = 'block'; return;
  }
  err.style.display = 'none';
  info.style.display = 'block';
  info.innerHTML = `<span class="pi-muted">Processando <strong>${esc(file.name)}</strong>...</span>`;

  try {
    if (!window.XLSX) await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array', cellDates: true });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    if (!rows.length) throw new Error('Planilha vazia.');

    wiz.headers = Object.keys(rows[0]);
    wiz.rawRows = rows;
    extractPlannerUsers();
    extractBuckets();
    buildEditableTasks();

    const total = rows.length;
    const completed = rows.filter(r => (r['Progresso'] || '') === 'Concluída').length;
    info.innerHTML = `<div style="display:flex;align-items:center;gap:12px;">
      <span style="font-size:1.5rem;">✅</span>
      <div><strong>${esc(file.name)}</strong>
        <div style="font-size:0.8125rem;color:var(--text-muted);margin-top:2px;">
          ${total} tarefas · ${completed} concluídas · ${wiz.plannerUsers.length} pessoas · ${wiz.plannerBuckets.length} buckets
        </div>
      </div>
    </div>`;
    updateFooter();
  } catch (e) {
    err.textContent = 'Erro: ' + e.message;
    err.style.display = 'block'; info.style.display = 'none';
  }
}

function extractPlannerUsers() {
  const set = new Set();
  wiz.rawRows.forEach(r => {
    (r['Atribuído a'] || '').split(';').map(n => n.trim()).filter(Boolean).forEach(n => set.add(n));
  });
  wiz.plannerUsers = [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function extractBuckets() {
  const set = new Set();
  wiz.rawRows.forEach(r => { const b = (r['Nome do Bucket'] || '').trim(); if (b) set.add(b); });
  wiz.plannerBuckets = [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function buildEditableTasks() {
  wiz.tasks = wiz.rawRows.map((r, i) => ({
    _idx: i,
    title: (r['Nome da tarefa'] || '').trim() || 'Sem título',
    status: PROGRESS_MAP[(r['Progresso'] || '').trim()] || 'not_started',
    priority: PRIORITY_MAP[(r['Prioridade'] || '').trim()] || 'medium',
    assigneeNames: (r['Atribuído a'] || '').split(';').map(n => n.trim()).filter(Boolean),
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
  }));
}

/* ═══════════════════════════════════════════════════════════
   STEP 2 — Field Mapping (visual, com exemplos reais)
   ═══════════════════════════════════════════════════════════ */
function renderStep2() {
  // Pegar exemplos reais do arquivo
  const sample = wiz.rawRows[0] || {};
  const sampleRow2 = wiz.rawRows[1] || {};

  const mappings = [
    {
      planner: 'Nome da tarefa', sistema: 'Título da tarefa',
      exemplo: sample['Nome da tarefa'] || '',
      resultado: sample['Nome da tarefa'] || '',
      color: 'green',
    },
    {
      planner: 'Progresso', sistema: 'Status',
      exemplo: sample['Progresso'] || 'Não iniciado',
      resultado: statusLabel(PROGRESS_MAP[(sample['Progresso'] || '').trim()] || 'not_started'),
      color: 'yellow',
    },
    {
      planner: 'Prioridade', sistema: 'Prioridade',
      exemplo: sample['Prioridade'] || 'Média',
      resultado: prioLabel(PRIORITY_MAP[(sample['Prioridade'] || '').trim()] || 'medium'),
      color: 'yellow',
    },
    {
      planner: 'Atribuído a', sistema: 'Responsáveis',
      exemplo: sample['Atribuído a'] || '',
      resultado: '→ IDs do sistema (Etapa 3)',
      color: 'yellow',
    },
    {
      planner: 'Data de conclusão', sistema: 'Prazo',
      exemplo: sample['Data de conclusão'] ? fmtDate(sample['Data de conclusão']) : '—',
      resultado: sample['Data de conclusão'] ? fmtDate(sample['Data de conclusão']) : '—',
      color: 'green',
    },
    {
      planner: 'Data de início', sistema: 'Data de início',
      exemplo: sample['Data de início'] ? fmtDate(sample['Data de início']) : '—',
      resultado: sample['Data de início'] ? fmtDate(sample['Data de início']) : '—',
      color: 'green',
    },
    {
      planner: 'Nome do Bucket', sistema: 'Setor / Tag',
      exemplo: sample['Nome do Bucket'] || '',
      resultado: '→ Setor ou tag (Etapa 4)',
      color: 'yellow',
    },
    {
      planner: 'Rótulos', sistema: 'Tags',
      exemplo: sample['Rótulos'] || '—',
      resultado: sample['Rótulos'] ? (sample['Rótulos'] || '').split(';').map(s => s.trim()).filter(Boolean).join(', ') : '—',
      color: 'green',
    },
    {
      planner: 'Descrição', sistema: 'Descrição',
      exemplo: (sample['Descrição'] || '').slice(0, 60) + ((sample['Descrição'] || '').length > 60 ? '...' : '') || '—',
      resultado: 'Mantido como está',
      color: 'green',
    },
    {
      planner: 'Lista de verificação', sistema: 'Subtarefas',
      exemplo: (sample['Itens da lista de verificação'] || '').split(';').filter(Boolean).length + ' itens',
      resultado: '→ Subtarefas com status',
      color: 'yellow',
    },
    {
      planner: 'Identificação', sistema: 'customFields.plannerId',
      exemplo: (sample['Identificação da tarefa'] || '').slice(0, 20) + '...',
      resultado: 'Salvo para rastreabilidade',
      color: 'gray',
    },
  ];

  const total = wiz.rawRows.length;
  const counts = {
    comTitulo: wiz.rawRows.filter(r => r['Nome da tarefa']).length,
    comPrazo: wiz.rawRows.filter(r => r['Data de conclusão']).length,
    comResp: wiz.rawRows.filter(r => r['Atribuído a']).length,
    comDesc: wiz.rawRows.filter(r => r['Descrição']).length,
    comChecklist: wiz.rawRows.filter(r => r['Itens da lista de verificação']).length,
  };

  return `<div class="pi-wiz">
    ${stepBar(2)}
    <div class="pi-body">
      <h3 style="margin:0 0 4px;">Como seus dados serão importados</h3>
      <p class="pi-muted" style="margin:0 0 16px;">
        Veja abaixo como cada campo do Planner será convertido. Os valores da primeira tarefa são usados como exemplo.
      </p>

      <!-- Resumo de preenchimento -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
        ${miniStat(counts.comTitulo, total, 'Com título')}
        ${miniStat(counts.comPrazo, total, 'Com prazo')}
        ${miniStat(counts.comResp, total, 'Com responsável')}
        ${miniStat(counts.comDesc, total, 'Com descrição')}
        ${miniStat(counts.comChecklist, total, 'Com checklist')}
      </div>

      <div style="overflow-x:auto;">
        <table class="pi-table">
          <thead>
            <tr>
              <th style="width:30px;"></th>
              <th>Campo no Planner</th>
              <th>Exemplo do arquivo</th>
              <th style="width:30px;text-align:center;">→</th>
              <th>Campo no Sistema</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            ${mappings.map(m => {
              const dot = m.color === 'green' ? '#16A34A' : m.color === 'yellow' ? '#D97706' : '#9CA3AF';
              const bg = m.color === 'green' ? 'rgba(22,163,74,0.06)' : m.color === 'yellow' ? 'rgba(217,119,6,0.06)' : 'transparent';
              return `<tr style="background:${bg};">
                <td style="text-align:center;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${dot};"></span></td>
                <td><strong>${esc(m.planner)}</strong></td>
                <td class="pi-muted" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(m.exemplo)}">${esc(m.exemplo)}</td>
                <td style="text-align:center;color:var(--text-muted);">→</td>
                <td><strong>${esc(m.sistema)}</strong></td>
                <td style="font-size:0.8rem;">${esc(m.resultado)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div class="pi-note" style="margin-top:16px;">
        <strong>Legenda:</strong>
        <span style="display:inline-flex;align-items:center;gap:4px;margin:0 12px;"><span style="width:10px;height:10px;border-radius:50%;background:#16A34A;display:inline-block;"></span> Transferência direta</span>
        <span style="display:inline-flex;align-items:center;gap:4px;margin:0 12px;"><span style="width:10px;height:10px;border-radius:50%;background:#D97706;display:inline-block;"></span> Precisa de ajuste (próximas etapas)</span>
        <span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:50%;background:#9CA3AF;display:inline-block;"></span> Metadado (preservado internamente)</span>
      </div>
    </div>
  </div>`;
}

function miniStat(count, total, label) {
  const pct = total ? Math.round(count / total * 100) : 0;
  const color = pct > 80 ? '#16A34A' : pct > 40 ? '#D97706' : '#9CA3AF';
  return `<div style="padding:6px 12px;border-radius:6px;background:var(--bg-surface);border:1px solid var(--border);font-size:0.75rem;">
    <strong style="color:${color};">${pct}%</strong> <span class="pi-muted">${label}</span>
  </div>`;
}

function statusLabel(val) {
  const s = STATUS_OPTS.find(o => o.value === val);
  return s ? s.label : val;
}

function prioLabel(val) {
  const p = PRIO_OPTS.find(o => o.value === val);
  return p ? `${p.icon} ${p.label}` : val;
}

/* ═══════════════════════════════════════════════════════════
   STEP 3 — User Resolution (com fetch do Firestore)
   ═══════════════════════════════════════════════════════════ */
async function loadSystemUsers() {
  let users = store.get('users');
  if (!users || !users.length) {
    try {
      const { collection, getDocs, query, orderBy } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const { db } = await import('../firebase.js');
      const snap = await getDocs(query(collection(db, 'users'), orderBy('name', 'asc')));
      users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      store.set('users', users);
    } catch (e) {
      console.warn('Erro ao carregar usuários:', e.message);
      users = [];
    }
  }
  wiz.systemUsers = users.filter(u => u.active !== false);
}

function autoMatchUsers() {
  wiz.plannerUsers.forEach(pName => {
    if (wiz.userMap[pName]) return; // já mapeado
    wiz.userMap[pName] = findBestUserMatch(pName, wiz.systemUsers);
  });
}

function findBestUserMatch(plannerName, sysUsers) {
  if (!plannerName || !sysUsers.length) return null;
  const pn = norm(plannerName);

  // 1. Exact
  let m = sysUsers.find(u => norm(u.name) === pn);
  if (m) return { userId: m.id, userName: m.name, confidence: 'exato' };

  // 2. First + Last name
  const pp = pn.split(/\s+/);
  if (pp.length >= 2) {
    m = sysUsers.find(u => {
      const sp = norm(u.name).split(/\s+/);
      return sp[0] === pp[0] && sp[sp.length - 1] === pp[pp.length - 1];
    });
    if (m) return { userId: m.id, userName: m.name, confidence: 'nome+sobrenome' };
  }

  // 3. First name only (unique match)
  if (pp.length >= 1) {
    const fm = sysUsers.filter(u => norm(u.name).split(/\s+/)[0] === pp[0]);
    if (fm.length === 1) return { userId: fm[0].id, userName: fm[0].name, confidence: 'primeiro nome' };
  }

  // 4. Contains match
  m = sysUsers.find(u => norm(u.name).includes(pn) || pn.includes(norm(u.name)));
  if (m) return { userId: m.id, userName: m.name, confidence: 'parcial' };

  // 5. Email username match (e.g. "joao.silva" in email)
  if (pp.length >= 1) {
    m = sysUsers.find(u => {
      if (!u.email) return false;
      const emailName = u.email.split('@')[0].toLowerCase().replace(/[._-]/g, ' ');
      return emailName.includes(pp[0]) || pp.some(p => emailName.includes(p));
    });
    if (m) return { userId: m.id, userName: m.name, confidence: 'email' };
  }

  return null;
}

function norm(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }

function renderStep3() {
  const matched = wiz.plannerUsers.filter(n => wiz.userMap[n]?.userId).length;
  const unmatched = wiz.plannerUsers.length - matched;

  // Count tasks per user
  const counts = {};
  wiz.rawRows.forEach(r => {
    (r['Atribuído a'] || '').split(';').map(n => n.trim()).filter(Boolean).forEach(n => { counts[n] = (counts[n] || 0) + 1; });
  });

  return `<div class="pi-wiz">
    ${stepBar(3)}
    <div class="pi-body">
      <h3 style="margin:0 0 4px;">Conectar pessoas do Planner aos usuários do sistema</h3>
      <p class="pi-muted" style="margin:0 0 12px;">
        O sistema tentou identificar automaticamente cada pessoa. Revise e corrija se necessário.
      </p>

      <div style="display:flex;gap:12px;margin-bottom:16px;">
        <div class="pi-stat-card" style="background:#F0FDF4;border-color:#BBF7D0;color:#16A34A;">
          <strong>${matched}</strong> identificados automaticamente
        </div>
        ${unmatched ? `<div class="pi-stat-card" style="background:#FEF3C7;border-color:#FDE68A;color:#D97706;">
          <strong>${unmatched}</strong> precisam de atenção
        </div>` : `<div class="pi-stat-card" style="background:#F0FDF4;border-color:#BBF7D0;color:#16A34A;">
          Todos conectados!
        </div>`}
      </div>

      <div style="overflow-x:auto;">
        <table class="pi-table">
          <thead>
            <tr>
              <th>Pessoa no Planner</th>
              <th style="text-align:center;">Tarefas</th>
              <th style="text-align:center;">Match</th>
              <th>Usuário no Sistema</th>
              <th>Confiança</th>
            </tr>
          </thead>
          <tbody>
            ${wiz.plannerUsers.map(pName => {
              const map = wiz.userMap[pName];
              const isM = !!map?.userId;
              const count = counts[pName] || 0;
              const conf = map?.confidence || '';
              const confColor = conf === 'exato' ? '#16A34A' : conf ? '#D97706' : '#EF4444';
              return `<tr>
                <td><strong>${esc(pName)}</strong></td>
                <td style="text-align:center;">${count}</td>
                <td style="text-align:center;">
                  <span class="pi-dot" style="background:${isM ? '#16A34A' : '#D97706'}20;color:${isM ? '#16A34A' : '#D97706'};">
                    ${isM ? '✓' : '?'}
                  </span>
                </td>
                <td>
                  <select class="pi-user-sel form-input" data-pname="${esc(pName)}"
                    style="height:32px;font-size:0.8125rem;min-width:240px;border-color:${isM ? '#16A34A' : '#D97706'};">
                    <option value="">— Sem responsável —</option>
                    ${wiz.systemUsers.map(u => `<option value="${esc(u.id)}" ${map?.userId === u.id ? 'selected' : ''}>
                      ${esc(u.name)}${u.email ? ` (${esc(u.email)})` : u.sector ? ` · ${esc(u.sector)}` : ''}
                    </option>`).join('')}
                  </select>
                </td>
                <td style="font-size:0.75rem;">
                  ${conf ? `<span style="color:${confColor};font-weight:600;">${esc(conf)}</span>` : '<span style="color:#9CA3AF;">—</span>'}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div class="pi-note" style="margin-top:16px;">
        <strong>Pessoas sem conexão</strong> terão suas tarefas importadas sem responsável,
        com a tag <code>planner-sem-responsavel</code> para fácil localização e atualização posterior.
      </div>
    </div>
  </div>`;
}

function attachStep3Events() {
  const body = wiz.modalRef?.getBody(); if (!body) return;
  body.querySelectorAll('.pi-user-sel').forEach(sel => {
    sel.addEventListener('change', e => {
      const pn = e.target.dataset.pname;
      const uid = e.target.value;
      if (uid) {
        const u = wiz.systemUsers.find(u => u.id === uid);
        wiz.userMap[pn] = { userId: uid, userName: u?.name || '', confidence: 'manual' };
        e.target.style.borderColor = '#16A34A';
      } else {
        wiz.userMap[pn] = null;
        e.target.style.borderColor = '#D97706';
      }
      // Update dot
      const dot = e.target.closest('tr')?.querySelector('.pi-dot');
      if (dot) {
        dot.style.background = uid ? '#16A34A20' : '#D9770620';
        dot.style.color = uid ? '#16A34A' : '#D97706';
        dot.textContent = uid ? '✓' : '?';
      }
      // Update confidence
      const confCell = e.target.closest('tr')?.querySelectorAll('td')[4];
      if (confCell) confCell.innerHTML = uid
        ? '<span style="color:#3B82F6;font-weight:600;">manual</span>'
        : '<span style="color:#9CA3AF;">—</span>';
    });
  });
}

/* ═══════════════════════════════════════════════════════════
   STEP 4 — Bucket → Setor / Tag mapping
   ═══════════════════════════════════════════════════════════ */
function renderStep4() {
  const counts = {};
  wiz.rawRows.forEach(r => { const b = (r['Nome do Bucket'] || '').trim(); if (b) counts[b] = (counts[b] || 0) + 1; });

  // Auto-match buckets to sectors on first visit
  if (!Object.keys(wiz.bucketMap).length) {
    wiz.plannerBuckets.forEach(b => {
      const match = findBestSectorMatch(b);
      wiz.bucketMap[b] = match ? { action: 'sector', sector: match.sector } : { action: 'tag' };
    });
  }

  return `<div class="pi-wiz">
    ${stepBar(4)}
    <div class="pi-body">
      <h3 style="margin:0 0 4px;">Mapeamento de Buckets → Setores</h3>
      <p class="pi-muted" style="margin:0 0 16px;">
        Os Buckets do Planner geralmente correspondem a setores/áreas do sistema.
        O sistema já tentou conectar automaticamente. Revise e ajuste.
      </p>

      <div style="overflow-x:auto;">
        <table class="pi-table">
          <thead>
            <tr>
              <th>Bucket no Planner</th>
              <th style="text-align:center;">Tarefas</th>
              <th style="text-align:center;">Match</th>
              <th>Destino no Sistema</th>
            </tr>
          </thead>
          <tbody>
            ${wiz.plannerBuckets.map(b => {
              const count = counts[b] || 0;
              const map = wiz.bucketMap[b] || { action: 'tag' };
              const isSector = map.action === 'sector' && map.sector;
              return `<tr>
                <td><strong>${esc(b)}</strong></td>
                <td style="text-align:center;">${count}</td>
                <td style="text-align:center;">
                  <span class="pi-dot" style="background:${isSector ? '#16A34A20' : map.action === 'tag' ? '#3B82F620' : '#9CA3AF20'};
                    color:${isSector ? '#16A34A' : map.action === 'tag' ? '#3B82F6' : '#9CA3AF'};">
                    ${isSector ? '✓' : map.action === 'tag' ? 'T' : '—'}
                  </span>
                </td>
                <td>
                  <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                    <select class="pi-bucket-action form-input" data-bucket="${esc(b)}"
                      style="height:32px;font-size:0.8125rem;width:130px;">
                      <option value="sector" ${map.action === 'sector' ? 'selected' : ''}>Setor</option>
                      <option value="tag" ${map.action === 'tag' ? 'selected' : ''}>Tag</option>
                      <option value="ignore" ${map.action === 'ignore' ? 'selected' : ''}>Ignorar</option>
                    </select>
                    <select class="pi-bucket-sector form-input" data-bucket="${esc(b)}"
                      style="height:32px;font-size:0.8125rem;min-width:180px;${map.action !== 'sector' ? 'display:none;' : ''}
                      border-color:${isSector ? '#16A34A' : '#D97706'};">
                      <option value="">— Selecionar setor —</option>
                      ${SYSTEM_SECTORS.map(s => `<option value="${esc(s)}" ${map.sector === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
                    </select>
                  </div>
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
        <input type="text" id="pi-import-tag" class="form-input" value="${esc(wiz.importTag)}"
          style="height:32px;font-size:0.8125rem;max-width:300px;" placeholder="ex: planner-import" />
        <p class="pi-muted" style="font-size:0.75rem;margin:4px 0 0;">
          Facilita filtrar todas as tarefas importadas do Planner.
        </p>
      </div>
    </div>
  </div>`;
}

function findBestSectorMatch(bucketName) {
  if (!bucketName) return null;
  const bn = norm(bucketName);

  // Exact match
  let m = SYSTEM_SECTORS.find(s => norm(s) === bn);
  if (m) return { sector: m, confidence: 'exato' };

  // Contains match
  m = SYSTEM_SECTORS.find(s => norm(s).includes(bn) || bn.includes(norm(s)));
  if (m) return { sector: m, confidence: 'parcial' };

  // Special mappings
  const specialMap = {
    'pts/centurion': 'Centurion',
    'pts centurion': 'Centurion',
    'social media': 'Marketing',
    'redes sociais': 'Marketing',
    'institucional/mkt': 'Marketing',
    'institucional': 'Marketing',
    'ics': 'Célula ICs',
    'city guides & agendas culturais': 'Marketing',
    'city guides': 'Marketing',
    'sites & hotsites': 'TI',
    'sites': 'TI',
    'concierge': 'Concierge Bradesco',
    'areas de suporte': null,
    'sustentabilidade': 'Qualidade',
  };

  for (const [key, val] of Object.entries(specialMap)) {
    if (bn.includes(key) || key.includes(bn)) {
      if (val) return { sector: val, confidence: 'sugerido' };
      return null;
    }
  }

  return null;
}

function attachStep4Events() {
  const body = wiz.modalRef?.getBody(); if (!body) return;

  // Action type change (sector/tag/ignore)
  body.querySelectorAll('.pi-bucket-action').forEach(sel => {
    sel.addEventListener('change', e => {
      const bucket = e.target.dataset.bucket;
      const action = e.target.value;
      const sectorSel = e.target.closest('td')?.querySelector('.pi-bucket-sector');

      if (action === 'sector') {
        if (sectorSel) sectorSel.style.display = '';
        const prevMap = wiz.bucketMap[bucket];
        wiz.bucketMap[bucket] = { action: 'sector', sector: prevMap?.sector || '' };
      } else {
        if (sectorSel) sectorSel.style.display = 'none';
        wiz.bucketMap[bucket] = { action };
      }

      // Update dot
      const dot = e.target.closest('tr')?.querySelector('.pi-dot');
      if (dot) {
        const isSector = action === 'sector' && wiz.bucketMap[bucket]?.sector;
        dot.style.background = isSector ? '#16A34A20' : action === 'tag' ? '#3B82F620' : '#9CA3AF20';
        dot.style.color = isSector ? '#16A34A' : action === 'tag' ? '#3B82F6' : '#9CA3AF';
        dot.textContent = isSector ? '✓' : action === 'tag' ? 'T' : '—';
      }
    });
  });

  // Sector selection
  body.querySelectorAll('.pi-bucket-sector').forEach(sel => {
    sel.addEventListener('change', e => {
      const bucket = e.target.dataset.bucket;
      wiz.bucketMap[bucket] = { action: 'sector', sector: e.target.value };
      e.target.style.borderColor = e.target.value ? '#16A34A' : '#D97706';

      const dot = e.target.closest('tr')?.querySelector('.pi-dot');
      if (dot) {
        dot.style.background = e.target.value ? '#16A34A20' : '#D9770620';
        dot.style.color = e.target.value ? '#16A34A' : '#D97706';
        dot.textContent = e.target.value ? '✓' : '?';
      }
    });
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
  if (wiz.selectedRows.size === 0) {
    tasks.forEach((t, i) => { if (t.status !== 'done') wiz.selectedRows.add(i); });
  }

  const filtered = getFilteredTasks();

  // Squad-picker: lista os squads do usuário (gestor) — primeira vez selecionado fica null = sem squad
  const userWorkspaces = (store.get('userWorkspaces') || []).filter(w => !w.archived);
  if (typeof wiz.targetSquadId === 'undefined') wiz.targetSquadId = '';   // '' = sem squad

  return `<div class="pi-wiz">
    ${stepBar(5)}
    <div class="pi-body">
      <h3 style="margin:0 0 4px;">Revisão final e edição</h3>
      <p class="pi-muted" style="margin:0 0 12px;">
        Edite título, status, prioridade e prazo diretamente na tabela antes de importar.
      </p>

      <!-- Squad de destino (B11b — sempre explícito; antes ia silenciosamente para o currentWorkspace) -->
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;
        padding:10px 12px;margin-bottom:12px;
        background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;">
        <label style="font-size:0.8125rem;font-weight:600;white-space:nowrap;">
          Squad de destino:
        </label>
        <select id="pi-target-squad" class="form-input" style="height:32px;font-size:0.8125rem;flex:1;min-width:180px;">
          <option value="" ${wiz.targetSquadId === '' ? 'selected' : ''}>— Sem squad (visível por setor)</option>
          ${userWorkspaces.map(w => `
            <option value="${esc(w.id)}" ${wiz.targetSquadId === w.id ? 'selected' : ''}>
              ${esc(w.icon || '◈')} ${esc(w.name)}${w.multiSector ? ' · multissetor' : ''}
            </option>
          `).join('')}
        </select>
        <span style="font-size:0.75rem;color:var(--text-muted);">
          Aplica-se a todas as ${wiz.selectedRows.size} tarefas selecionadas.
        </span>
      </div>

      <!-- Summary -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px;margin-bottom:14px;">
        ${sCard(total, 'Total', 'var(--bg-surface)', 'var(--border)', 'var(--text-primary)')}
        ${sCard(byStatus.not_started, 'Não inic.', '#EFF6FF', '#BFDBFE', '#3B82F6')}
        ${sCard(byStatus.in_progress, 'Em andam.', '#FFFBEB', '#FDE68A', '#D97706')}
        ${sCard(byStatus.done, 'Concluídas', '#F0FDF4', '#BBF7D0', '#16A34A')}
        ${sCard(wiz.selectedRows.size, 'Selecionadas', '#F5F3FF', '#DDD6FE', '#7C3AED')}
      </div>

      <!-- Filters -->
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;align-items:center;">
        <span style="font-size:0.8125rem;font-weight:600;">Selecionar:</span>
        <button class="pi-qsel btn btn-sm" data-sel="all">Todas</button>
        <button class="pi-qsel btn btn-sm" data-sel="none">Nenhuma</button>
        <button class="pi-qsel btn btn-sm" data-sel="not_started">Não inic.</button>
        <button class="pi-qsel btn btn-sm" data-sel="in_progress">Em andam.</button>
        <button class="pi-qsel btn btn-sm" data-sel="done">Concluídas</button>
        <span style="border-left:1px solid var(--border);height:20px;margin:0 4px;"></span>
        <select id="pi-fbucket" class="form-input" style="height:30px;font-size:0.75rem;max-width:160px;">
          <option value="">Todos buckets</option>
          ${wiz.plannerBuckets.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('')}
        </select>
        <select id="pi-fstatus" class="form-input" style="height:30px;font-size:0.75rem;max-width:140px;">
          <option value="">Todos status</option>
          ${STATUS_OPTS.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}
        </select>
        <input type="text" id="pi-fsearch" class="form-input" placeholder="Buscar..."
          style="height:30px;font-size:0.75rem;width:180px;margin-left:auto;" />
      </div>

      <!-- Table -->
      <div style="max-height:400px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">
        <table class="pi-table pi-etable" id="pi-etable">
          <thead style="position:sticky;top:0;z-index:2;">
            <tr>
              <th style="width:30px;text-align:center;"><input type="checkbox" id="pi-selall" /></th>
              <th style="min-width:180px;">Tarefa</th>
              <th style="min-width:95px;">Status</th>
              <th style="min-width:85px;">Prioridade</th>
              <th style="min-width:130px;">Responsável</th>
              <th style="min-width:90px;">Setor</th>
              <th style="min-width:100px;">Prazo</th>
            </tr>
          </thead>
          <tbody id="pi-ebody">${filtered.map(t => editRow(t)).join('')}</tbody>
        </table>
      </div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-top:6px;">
        ${filtered.length} de ${total} tarefas
        · <strong style="color:#7C3AED;">${wiz.selectedRows.size} para importar</strong>
      </div>
    </div>
  </div>`;
}

function sCard(n, label, bg, bc, color) {
  return `<div style="padding:7px 10px;border-radius:8px;background:${bg};border:1px solid ${bc};text-align:center;">
    <div style="font-size:1.1rem;font-weight:700;color:${color};">${n}</div>
    <div style="font-size:0.65rem;color:${color};">${label}</div>
  </div>`;
}

function getFilteredTasks() {
  let list = wiz.tasks;
  if (wiz.previewBucket) list = list.filter(t => t.bucket === wiz.previewBucket);
  if (wiz.previewStatus) list = list.filter(t => t.status === wiz.previewStatus);
  if (wiz.previewSearch) {
    const q = wiz.previewSearch.toLowerCase();
    list = list.filter(t => t.title.toLowerCase().includes(q) || t.bucket.toLowerCase().includes(q) || t.assigneeNames.some(n => n.toLowerCase().includes(q)));
  }
  return list;
}

function editRow(t) {
  const i = t._idx;
  const chk = wiz.selectedRows.has(i);
  const st = STATUS_OPTS.find(s => s.value === t.status) || STATUS_OPTS[0];
  const pr = PRIO_OPTS.find(p => p.value === t.priority) || PRIO_OPTS[2];

  // Resolve assignees
  const names = t.assigneeNames.map(n => {
    const m = wiz.userMap[n];
    return m?.userId ? { name: m.userName || n, ok: true } : { name: n, ok: false };
  });
  const hasUnresolved = names.some(r => !r.ok);

  // Sector from bucket mapping
  const bMap = wiz.bucketMap[t.bucket];
  const sector = bMap?.action === 'sector' && bMap.sector ? bMap.sector : '';

  // Overdue check
  const isOverdue = t.dueDate && t.status !== 'done' && new Date(t.dueDate) < new Date();

  // Row color
  let rowStyle = '';
  if (!chk) rowStyle = 'opacity:0.4;';
  else if (hasUnresolved) rowStyle = 'background:rgba(217,119,6,0.05);';

  return `<tr class="pi-erow" data-idx="${i}" style="${rowStyle}">
    <td style="text-align:center;"><input type="checkbox" class="pi-rcb" data-idx="${i}" ${chk ? 'checked' : ''} /></td>
    <td><input type="text" class="pi-iinput pi-ed-t" data-idx="${i}" value="${esc(t.title)}" style="width:100%;font-weight:600;" /></td>
    <td><select class="pi-isel pi-ed-s" data-idx="${i}" style="color:${st.color};font-weight:600;">
      ${STATUS_OPTS.map(s => `<option value="${s.value}" ${s.value === t.status ? 'selected' : ''} style="color:${s.color};">${s.label}</option>`).join('')}
    </select></td>
    <td><select class="pi-isel pi-ed-p" data-idx="${i}">
      ${PRIO_OPTS.map(p => `<option value="${p.value}" ${p.value === t.priority ? 'selected' : ''}>${p.icon} ${p.label}</option>`).join('')}
    </select></td>
    <td>${names.length ? names.map(r => `<span class="pi-chip" style="--cc:${r.ok ? '#16A34A' : '#D97706'};">
      ${r.ok ? '✓' : '?'} ${esc(r.name.split(' ')[0])}</span>`).join(' ')
      : '<span class="pi-muted" style="font-size:0.7rem;">—</span>'}</td>
    <td style="font-size:0.75rem;${sector ? 'color:var(--text-primary);font-weight:500;' : 'color:var(--text-muted);'}">${esc(sector || t.bucket)}</td>
    <td><input type="date" class="pi-iinput pi-ed-d" data-idx="${i}" value="${t.dueDate ? toISO(t.dueDate) : ''}"
      style="font-size:0.75rem;${isOverdue ? 'color:#EF4444;font-weight:600;' : ''}" /></td>
  </tr>`;
}

function attachStep5Events() {
  const body = wiz.modalRef?.getBody(); if (!body) return;

  // Inline edits
  body.addEventListener('input', e => {
    if (e.target.classList.contains('pi-ed-t')) {
      wiz.tasks[parseInt(e.target.dataset.idx)].title = e.target.value;
    }
  });
  body.addEventListener('change', e => {
    const idx = parseInt(e.target.dataset.idx);
    if (e.target.classList.contains('pi-ed-s')) {
      wiz.tasks[idx].status = e.target.value;
      const st = STATUS_OPTS.find(s => s.value === e.target.value);
      if (st) e.target.style.color = st.color;
    }
    if (e.target.classList.contains('pi-ed-p')) wiz.tasks[idx].priority = e.target.value;
    if (e.target.classList.contains('pi-ed-d')) wiz.tasks[idx].dueDate = e.target.value || null;

    // Checkboxes
    if (e.target.classList.contains('pi-rcb')) {
      if (e.target.checked) wiz.selectedRows.add(idx); else wiz.selectedRows.delete(idx);
      const row = e.target.closest('tr');
      if (row) row.style.opacity = e.target.checked ? '1' : '0.4';
      updateFooter();
    }
  });

  // Select all
  body.querySelector('#pi-selall')?.addEventListener('change', e => {
    body.querySelectorAll('#pi-ebody .pi-rcb').forEach(cb => {
      const idx = parseInt(cb.dataset.idx);
      cb.checked = e.target.checked;
      if (e.target.checked) wiz.selectedRows.add(idx); else wiz.selectedRows.delete(idx);
      const row = cb.closest('tr'); if (row) row.style.opacity = e.target.checked ? '1' : '0.4';
    });
    updateFooter();
  });

  // Quick select
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
  body.querySelector('#pi-fbucket')?.addEventListener('change', e => { wiz.previewBucket = e.target.value; refreshTable(); });
  body.querySelector('#pi-fstatus')?.addEventListener('change', e => { wiz.previewStatus = e.target.value; refreshTable(); });
  let timer;
  body.querySelector('#pi-fsearch')?.addEventListener('input', e => {
    clearTimeout(timer); timer = setTimeout(() => { wiz.previewSearch = e.target.value; refreshTable(); }, 250);
  });

  // Squad de destino (B11b)
  body.querySelector('#pi-target-squad')?.addEventListener('change', e => {
    wiz.targetSquadId = e.target.value || '';
  });
}

function refreshTable() {
  const body = wiz.modalRef?.getBody(); if (!body) return;
  const tbody = body.querySelector('#pi-ebody'); if (!tbody) return;
  tbody.innerHTML = getFilteredTasks().map(t => editRow(t)).join('');
  updateFooter();
}

/* ─── Import Execution ────────────────────────────────────── */
async function executeImport() {
  const indices = [...wiz.selectedRows].sort((a, b) => a - b);
  if (!indices.length) { toast.warning('Selecione ao menos uma tarefa.'); return; }

  const ok = await modal.confirm({
    title: 'Confirmar importação',
    message: `Importar <strong>${indices.length}</strong> tarefas do Planner para o sistema?<br>
      <span style="font-size:0.8125rem;color:var(--text-muted);">Novas tarefas serão criadas. Nada existente será alterado.</span>`,
    confirmText: `Importar ${indices.length} tarefas`,
    icon: '📋',
  });
  if (!ok) return;

  const body = wiz.modalRef?.getBody(); if (!body) return;
  body.innerHTML = `<div class="pi-wiz">${stepBar(5)}
    <div class="pi-body" style="text-align:center;padding:40px 20px;">
      <div style="font-size:3rem;margin-bottom:16px;">⏳</div>
      <h3 id="pi-ptitle">Importando tarefas...</h3>
      <div style="max-width:400px;margin:16px auto;">
        <div style="background:var(--border);border-radius:999px;height:8px;overflow:hidden;">
          <div id="pi-pbar" style="width:0%;height:100%;background:var(--brand-blue,#3B82F6);border-radius:999px;transition:width 0.3s;"></div>
        </div>
        <p id="pi-ptxt" class="pi-muted" style="margin:8px 0 0;">0 / ${indices.length}</p>
      </div>
      <div id="pi-plog" style="text-align:left;max-height:200px;overflow-y:auto;font-size:0.75rem;
        color:var(--text-muted);margin-top:20px;padding:12px;background:var(--bg-surface);border-radius:8px;border:1px solid var(--border);"></div>
    </div>
  </div>`;

  const bar = body.querySelector('#pi-pbar');
  const txt = body.querySelector('#pi-ptxt');
  const log = body.querySelector('#pi-plog');
  let success = 0, errors = 0;
  const errList = [];

  for (let x = 0; x < indices.length; x++) {
    const t = wiz.tasks[indices[x]];
    try {
      await createTask(buildPayload(t));
      success++;
      log.innerHTML += `<div style="color:#16A34A;">✓ ${esc(t.title)}</div>`;
    } catch (err) {
      errors++;
      errList.push({ title: t.title, error: err.message });
      log.innerHTML += `<div style="color:#EF4444;">✗ ${esc(t.title)}: ${esc(err.message)}</div>`;
    }
    bar.style.width = Math.round(((x + 1) / indices.length) * 100) + '%';
    txt.textContent = `${x + 1} / ${indices.length}`;
    log.scrollTop = log.scrollHeight;
    if ((x + 1) % 10 === 0) await sleep(50);
  }

  wiz.importResults = { success, errors, errList, total: indices.length };
  body.innerHTML = renderImportResults();
  updateFooter();
}

function buildPayload(t) {
  const tags = [];
  if (wiz.importTag) tags.push(wiz.importTag);

  // Bucket → tag or sector
  const bMap = wiz.bucketMap[t.bucket];
  let sector = null;
  if (bMap?.action === 'sector' && bMap.sector) {
    sector = bMap.sector;
  } else if (bMap?.action === 'tag' && t.bucket) {
    tags.push(`planner:${t.bucket}`);
  }

  // Labels → tags
  t.labels.forEach(l => tags.push(l));
  if (t.isRecurring) tags.push('recorrente-planner');

  // Assignees
  const assignees = [];
  let hasUnresolved = false;
  t.assigneeNames.forEach(name => {
    const m = wiz.userMap[name];
    if (m?.userId) assignees.push(m.userId);
    else hasUnresolved = true;
  });
  if (hasUnresolved) tags.push('planner-sem-responsavel');

  // Subtasks
  const subtasks = t.checklistItems.map((title, i) => {
    const dm = (t.checklistDone || '').match(/^(\d+)/);
    return { title, done: i < (dm ? parseInt(dm[1]) : 0) };
  });

  let desc = t.description;
  if (t.plannerId) desc += (desc ? '\n\n' : '') + `[Importado do Planner — ID: ${t.plannerId}]`;

  return {
    title: t.title || 'Sem título',
    description: desc,
    status: t.status,
    priority: t.priority,
    sector,
    assignees,
    tags,
    startDate: parseDate(t.startDate),
    dueDate: parseDate(t.dueDate),
    subtasks,
    // B11b: squad de destino EXPLÍCITO. Antes, createTask caía no fallback
    // store.get('currentWorkspace')?.id, jogando todas as tarefas no squad
    // ativo do gestor no momento do import.
    workspaceId: wiz.targetSquadId || null,
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
  return `<div class="pi-wiz">${stepBar(5)}
    <div class="pi-body" style="text-align:center;padding:30px 20px;">
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
      ${r.errors && r.errList.length ? `<div style="text-align:left;max-height:200px;overflow-y:auto;font-size:0.75rem;
        padding:12px;background:var(--bg-surface);border-radius:8px;border:1px solid var(--border);margin-top:12px;">
        ${r.errList.map(e => `<div style="color:#EF4444;margin-bottom:4px;">✗ <strong>${esc(e.title)}</strong>: ${esc(e.error)}</div>`).join('')}
      </div>` : ''}
      <p class="pi-muted" style="margin-top:20px;">
        ${wiz.importTag ? `Filtre por <code style="background:#EFF6FF;padding:2px 6px;border-radius:4px;">${esc(wiz.importTag)}</code> para ver todas as tarefas importadas.` : ''}
      </p>
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════════
   Navigation & Footer
   ═══════════════════════════════════════════════════════════ */
function stepBar(cur) {
  const steps = [{ n: 1, l: 'Upload' }, { n: 2, l: 'Campos' }, { n: 3, l: 'Pessoas' }, { n: 4, l: 'Setores' }, { n: 5, l: 'Importar' }];
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
          ${s.n < 5 ? 'margin-right:12px;' : ''}">${s.l}</span>
        ${s.n < 5 ? '<div style="width:24px;height:2px;background:var(--border,#e5e7eb);margin-right:4px;"></div>' : ''}
      </div>`;
    }).join('')}
  </div>`;
}

function buildFooter() {
  const { step } = wiz;
  const hasData = wiz.rawRows.length > 0;
  if (wiz.importResults) return [{ label: 'Fechar', class: 'btn-primary', closeOnClick: true, onClick: () => {} }];
  const btns = [];
  if (step > 1) btns.push({ label: '← Voltar', class: 'btn-secondary', closeOnClick: false, onClick: () => goToStep(step - 1) });
  if (step < 5) btns.push({
    label: 'Avançar →', class: 'btn-primary' + (!hasData && step === 1 ? ' disabled' : ''),
    closeOnClick: false, onClick: () => { if (!hasData && step === 1) { toast.warning('Selecione um arquivo.'); return; } goToStep(step + 1); },
  });
  if (step === 5) btns.push({
    label: `Importar ${wiz.selectedRows.size} tarefas`, class: 'btn-primary',
    closeOnClick: false, onClick: () => executeImport(),
  });
  return btns;
}

function updateFooter() {
  const el = wiz.modalRef?.getElement(); if (!el) return;
  const f = el.querySelector('.modal-footer'); if (!f) return;
  const btns = buildFooter();
  f.innerHTML = btns.map((b, i) => `<button class="btn ${b.class || ''}" data-fi="${i}">${b.label}</button>`).join('');
  f.querySelectorAll('button').forEach(btn => {
    const cfg = btns[parseInt(btn.dataset.fi)];
    btn.addEventListener('click', async e => {
      if (cfg.onClick) await cfg.onClick(e, { close: () => wiz.modalRef?.close() });
      if (cfg.closeOnClick) wiz.modalRef?.close();
    });
  });
}

async function goToStep(step) {
  wiz.step = step;
  const body = wiz.modalRef?.getBody(); if (!body) return;

  // Step 3 needs to load users first
  if (step === 3) {
    body.innerHTML = `<div class="pi-wiz">${stepBar(3)}<div class="pi-body" style="text-align:center;padding:40px;">
      <p class="pi-muted">Carregando usuários do sistema...</p></div></div>`;
    await loadSystemUsers();
    autoMatchUsers();
  }

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
function parseDate(v) { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return isNaN(d.getTime()) ? null : d; }
function fmtDate(v) { const d = v instanceof Date ? v : new Date(v); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }); }
function toISO(v) { const d = v instanceof Date ? v : new Date(v); return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); }
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
}

/* ─── CSS ────────────────────────────────────────────────── */
(function injectCSS() {
  if (document.getElementById('pi-css')) return;
  const s = document.createElement('style');
  s.id = 'pi-css';
  s.textContent = `
    .pi-wiz { max-width:100%; }
    .pi-body { min-height:200px; }
    .pi-muted { color:var(--text-muted); font-size:0.8125rem; }

    .pi-dropzone { border:2px dashed var(--border,#e5e7eb); border-radius:12px; padding:48px 24px;
      text-align:center; cursor:pointer; transition:all 0.2s; background:var(--bg-surface,#f9fafb); }
    .pi-dropzone:hover { border-color:var(--brand-blue,#3B82F6); }

    .pi-infobox { padding:12px 16px; background:var(--bg-surface); border-radius:8px; border:1px solid var(--border); }

    .pi-table { width:100%; border-collapse:collapse; font-size:0.8125rem; }
    .pi-table th { padding:8px 10px; text-align:left; white-space:nowrap; background:var(--bg-surface);
      border-bottom:2px solid var(--border); font-weight:700; font-size:0.7rem;
      text-transform:uppercase; letter-spacing:0.03em; color:var(--text-muted); }
    .pi-table td { padding:7px 10px; border-bottom:1px solid var(--border,#f3f4f6); vertical-align:middle; }
    .pi-table tbody tr:hover { background:var(--bg-surface,#f9fafb); }

    .pi-stat-card { padding:8px 16px; border-radius:8px; font-size:0.8125rem; border:1px solid; }

    .pi-dot { display:inline-flex; align-items:center; justify-content:center;
      width:24px; height:24px; border-radius:50%; font-size:0.75rem; font-weight:700; }

    .pi-note { padding:12px 16px; background:var(--bg-surface); border-radius:8px;
      border:1px solid var(--border); font-size:0.8125rem; }
    .pi-note code { background:#FEF3C7; padding:1px 6px; border-radius:4px; font-size:0.75rem; }

    .pi-chip { display:inline-block; padding:1px 7px; border-radius:999px; font-size:0.6875rem;
      font-weight:600; margin:1px 2px; white-space:nowrap;
      background:color-mix(in srgb, var(--cc) 10%, transparent);
      color:var(--cc); border:1px solid color-mix(in srgb, var(--cc) 20%, transparent); }

    .pi-iinput { background:transparent; border:1px solid transparent; border-radius:4px;
      padding:3px 6px; font-size:0.75rem; color:var(--text-primary); transition:border-color 0.15s; outline:none; }
    .pi-iinput:hover { border-color:var(--border); }
    .pi-iinput:focus { border-color:var(--brand-blue,#3B82F6); background:var(--bg-card,#fff); }

    .pi-isel { background:transparent; border:1px solid transparent; border-radius:4px;
      padding:3px 4px; font-size:0.75rem; cursor:pointer; outline:none;
      transition:border-color 0.15s; -webkit-appearance:none; appearance:none; }
    .pi-isel:hover { border-color:var(--border); }
    .pi-isel:focus { border-color:var(--brand-blue,#3B82F6); }

    .pi-erow td { padding:5px 8px !important; }
    .pi-erow { transition:opacity 0.15s; }
    .pi-qsel { padding:3px 10px !important; font-size:0.75rem !important; }
    .btn.disabled { opacity:0.5; pointer-events:none; }

    @media (max-width:768px) {
      .pi-etable { font-size:0.7rem; }
      .pi-iinput, .pi-isel { font-size:0.7rem; }
    }
  `;
  document.head.appendChild(s);
})();
