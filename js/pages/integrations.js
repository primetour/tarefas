/**
 * PRIMETOUR — Integrations Page (Etapa 5)
 * Gestão de todas as integrações externas
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import {
  INTEGRATION_CATALOG,
  fetchIntegrations, saveIntegration, toggleIntegration,
  deleteIntegration, testIntegration,
} from '../integrations/registry.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const CATEGORY_LABELS = {
  design:        { label:'Design',        icon:'🎨' },
  project:       { label:'Projetos',      icon:'📋' },
  crm:           { label:'CRM',           icon:'☁'  },
  communication: { label:'Comunicação',   icon:'💬' },
  development:   { label:'Dev',           icon:'🐙' },
  custom:        { label:'Personalizado', icon:'⚡' },
};

const FEATURE_LABELS = {
  import_files:       'Importar arquivos',
  import_comments:    'Importar comentários',
  webhook:            'Webhook',
  sync_tasks:         'Sincronizar tarefas',
  import_tasks:       'Importar tarefas',
  export_tasks:       'Exportar tarefas',
  link_cases:         'Vincular Cases',
  link_opportunities: 'Vincular Oportunidades',
  auto_tasks:         'Tarefas automáticas',
  notify_complete:    'Notif. conclusão',
  notify_overdue:     'Notif. atraso',
  notify_assigned:    'Notif. atribuição',
  link_issues:        'Vincular Issues',
  link_prs:           'Vincular PRs',
  auto_status:        'Status automático',
  events:             'Eventos',
};

let savedIntegrations = {};
let activeCategory    = 'all';

/* ─── Render ─────────────────────────────────────────────── */
export async function renderIntegrations(container) {
  if (!store.can('system_manage_settings')) {
    container.innerHTML = `
      <div class="empty-state" style="min-height:60vh;">
        <div class="empty-state-icon">🔒</div>
        <div class="empty-state-title">Acesso restrito</div>
        <p class="text-sm text-muted">Somente administradores podem gerenciar integrações.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Integrações</h1>
        <p class="page-subtitle">Conecte ferramentas externas ao PRIMETOUR</p>
      </div>
    </div>

    <!-- Stats -->
    <div id="integrations-stats" style="display:flex; gap:16px; margin-bottom:28px; flex-wrap:wrap;">
      ${[0,1,2].map(()=>'<div class="stat-card skeleton" style="height:80px; min-width:160px; flex:1;"></div>').join('')}
    </div>

    <!-- Category tabs -->
    <div class="integration-tabs" id="category-tabs">
      <span class="integration-tab active" data-cat="all">Todas</span>
      ${Object.entries(CATEGORY_LABELS).map(([k,v]) =>
        `<span class="integration-tab" data-cat="${k}">${v.icon} ${v.label}</span>`
      ).join('')}
    </div>

    <!-- Grid -->
    <div class="integrations-grid" id="integrations-grid">
      ${[0,1,2,3,4,5].map(()=>'<div class="integration-card skeleton" style="height:240px;"></div>').join('')}
    </div>

    <!-- Import panels (shown when integration is connected) -->
    <div id="import-panels"></div>
  `;

  // Category filter
  document.querySelectorAll('[data-cat]').forEach(tab => {
    tab.addEventListener('click', () => {
      activeCategory = tab.dataset.cat;
      document.querySelectorAll('[data-cat]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderGrid();
    });
  });

  await loadAndRender();
}

/* ─── Load data & render ──────────────────────────────────── */
async function loadAndRender() {
  try {
    const saved = await fetchIntegrations();
    savedIntegrations = Object.fromEntries(saved.map(i => [i.id, i]));
  } catch(e) {
    console.warn('Could not load integrations:', e.message);
    savedIntegrations = {};
  }
  renderStats();
  renderGrid();
  renderImportPanels();
}

/* ─── Stats ───────────────────────────────────────────────── */
function renderStats() {
  const el = document.getElementById('integrations-stats');
  if (!el) return;

  const connected = Object.values(savedIntegrations).filter(i => i.enabled).length;
  const total     = INTEGRATION_CATALOG.length;
  const categories = new Set(INTEGRATION_CATALOG.filter(i => savedIntegrations[i.id]?.enabled).map(i => i.category)).size;

  el.innerHTML = `
    <div class="stat-card" style="flex:1; min-width:160px;">
      <div class="stat-card-icon" style="background:rgba(212,168,67,0.12); color:var(--brand-gold);">⚡</div>
      <div class="stat-card-label">Conectadas</div>
      <div class="stat-card-value">${connected} <span style="font-size:1rem; color:var(--text-muted); font-weight:400;">/ ${total}</span></div>
    </div>
    <div class="stat-card" style="flex:1; min-width:160px;">
      <div class="stat-card-icon" style="background:rgba(34,197,94,0.12); color:#22C55E;">◎</div>
      <div class="stat-card-label">Categorias ativas</div>
      <div class="stat-card-value">${categories}</div>
    </div>
    <div class="stat-card" style="flex:1; min-width:160px;">
      <div class="stat-card-icon" style="background:rgba(56,189,248,0.12); color:#38BDF8;">🔧</div>
      <div class="stat-card-label">Disponíveis</div>
      <div class="stat-card-value">${total - connected}</div>
    </div>
  `;
}

/* ─── Cards grid ──────────────────────────────────────────── */
function renderGrid() {
  const grid = document.getElementById('integrations-grid');
  if (!grid) return;

  const filtered = activeCategory === 'all'
    ? INTEGRATION_CATALOG
    : INTEGRATION_CATALOG.filter(i => i.category === activeCategory);

  grid.innerHTML = filtered.map(def => {
    const saved     = savedIntegrations[def.id];
    const connected = saved?.enabled === true;
    const hasError  = saved?.lastTestOk === false;
    const status    = connected ? (hasError ? 'error' : 'connected') : 'disconnected';
    const statusLabel = { connected:'Conectada', error:'Erro', disconnected:'Não configurada' }[status];
    const dotClass  = { connected:'status-connected', error:'status-error', disconnected:'status-disconnected' }[status];

    return `
      <div class="integration-card ${connected?'connected':''}" data-int-id="${def.id}"
        style="--int-color:${def.color};">
        <div class="integration-card-header">
          <div class="integration-icon" style="background:${def.color}18; color:${def.color};">
            ${def.icon}
          </div>
          <div class="integration-meta">
            <div class="integration-name">${def.name}</div>
            <div class="integration-category">
              ${CATEGORY_LABELS[def.category]?.icon || ''} ${CATEGORY_LABELS[def.category]?.label || def.category}
            </div>
          </div>
          ${connected ? `
            <label class="toggle-switch" style="flex-shrink:0;" title="${connected?'Desabilitar':'Habilitar'}">
              <input type="checkbox" class="int-toggle" data-id="${def.id}" ${connected?'checked':''} />
              <span class="toggle-slider"></span>
            </label>
          ` : ''}
        </div>

        <p class="integration-desc">${def.description}</p>

        <div class="integration-features">
          ${def.features.map(f =>
            `<span class="integration-feature-badge">${FEATURE_LABELS[f]||f}</span>`
          ).join('')}
        </div>

        <div class="integration-card-footer">
          <div class="integration-status">
            <div class="integration-status-dot ${dotClass}"></div>
            <span style="color:var(--text-muted); font-size:0.8125rem;">${statusLabel}</span>
          </div>
          <div style="display:flex; gap:6px;">
            ${def.docsUrl ? `
              <a href="${def.docsUrl}" target="_blank" rel="noopener"
                class="btn btn-ghost btn-sm" title="Documentação" style="font-size:0.75rem;">
                Docs ↗
              </a>
            ` : ''}
            ${connected ? `
              <button class="btn btn-secondary btn-sm int-config-btn" data-id="${def.id}">Configurar</button>
              <button class="btn btn-ghost btn-sm int-delete-btn" data-id="${def.id}"
                style="color:var(--color-danger);" title="Remover">✕</button>
            ` : `
              <button class="btn btn-primary btn-sm int-connect-btn" data-id="${def.id}">
                + Conectar
              </button>
            `}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Events
  grid.querySelectorAll('.int-connect-btn, .int-config-btn').forEach(btn => {
    btn.addEventListener('click', () => openConfigModal(btn.dataset.id));
  });

  grid.querySelectorAll('.int-toggle').forEach(chk => {
    chk.addEventListener('change', async () => {
      const id = chk.dataset.id;
      try {
        await toggleIntegration(id, chk.checked);
        toast.success(chk.checked ? 'Integração habilitada.' : 'Integração desabilitada.');
        await loadAndRender();
      } catch(e) { toast.error(e.message); chk.checked = !chk.checked; }
    });
  });

  grid.querySelectorAll('.int-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const def = INTEGRATION_CATALOG.find(i => i.id === btn.dataset.id);
      const ok  = await modal.confirm({
        title:       `Remover ${def?.name}`,
        message:     `Remover a configuração de <strong>${def?.name}</strong>? Essa ação não pode ser desfeita.`,
        confirmText: 'Remover',
        danger:      true, icon: '✕',
      });
      if (ok) {
        try {
          await deleteIntegration(btn.dataset.id);
          toast.success(`${def?.name} removida.`);
          await loadAndRender();
        } catch(e) { toast.error(e.message); }
      }
    });
  });
}

/* ─── Config Modal ────────────────────────────────────────── */
function openConfigModal(integrationId) {
  const def    = INTEGRATION_CATALOG.find(i => i.id === integrationId);
  if (!def) return;
  const saved  = savedIntegrations[integrationId];
  const config = saved?.rawConfig || {};

  modal.open({
    title: `Configurar ${def.name}`,
    size:  'md',
    content: `
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:20px; padding-bottom:16px; border-bottom:1px solid var(--border-subtle);">
        <div style="width:40px;height:40px;border-radius:var(--radius-md);background:${def.color}18;color:${def.color};display:flex;align-items:center;justify-content:center;font-size:1.25rem;">
          ${def.icon}
        </div>
        <div>
          <div style="font-weight:600;color:var(--text-primary);">${def.name}</div>
          <div style="font-size:0.8125rem;color:var(--text-muted);">
            ${def.authType === 'token' ? '🔑 Token de acesso' : def.authType === 'oauth2' ? '🔐 OAuth 2.0' : '🔗 Webhook'}
          </div>
        </div>
        ${def.docsUrl ? `
          <a href="${def.docsUrl}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="margin-left:auto;">
            Documentação ↗
          </a>
        ` : ''}
      </div>

      ${def.fields.map(f => renderField(f, config)).join('')}

      <div id="test-result"></div>
    `,
    footer: [
      { label:'Cancelar', class:'btn-secondary', closeOnClick:true },
      {
        label:'Testar conexão', class:'btn-secondary', closeOnClick:false,
        onClick: async (_, ctx) => {
          const cfg = collectConfig(def);
          const btn = document.querySelector('.modal-footer .btn-secondary:last-of-type');
          if(btn){ btn.classList.add('loading'); btn.disabled=true; }
          const result = await testIntegration(integrationId, cfg).catch(e => ({ ok:false, message:e.message }));
          const el     = document.getElementById('test-result');
          if(el) {
            el.innerHTML = `<div class="integration-test-result ${result.ok?'test-ok':'test-error'}">
              <span>${result.ok ? '✓' : '✕'}</span>
              <span>${esc(result.message)}</span>
            </div>`;
          }
          if(btn){ btn.classList.remove('loading'); btn.disabled=false; }
        }
      },
      {
        label:'Salvar configuração', class:'btn-primary', closeOnClick:false,
        onClick: async (_, { close }) => {
          const cfg = collectConfig(def);

          // Basic validation
          const missing = def.fields.filter(f => f.required && !cfg[f.key]);
          if (missing.length) {
            toast.warning(`Preencha: ${missing.map(f=>f.label).join(', ')}`);
            return;
          }

          const btn = document.querySelector('.modal-footer .btn-primary');
          if(btn){ btn.classList.add('loading'); btn.disabled=true; }
          try {
            await saveIntegration(integrationId, cfg);
            toast.success(`${def.name} configurada com sucesso!`);
            close();
            await loadAndRender();
          } catch(e) { toast.error(e.message); }
          finally { if(btn){ btn.classList.remove('loading'); btn.disabled=false; } }
        }
      },
    ],
  });
}

/* ─── Field renderer ──────────────────────────────────────── */
function renderField(f, config) {
  const val = config[f.key] || '';

  if (f.type === 'checkboxes') {
    const selected = Array.isArray(config[f.key]) ? config[f.key] : [];
    return `
      <div class="form-group">
        <label class="form-label">${f.label}${f.required?' *':''}</label>
        <div class="events-checklist">
          ${f.options.map(opt => `
            <label>
              <input type="checkbox" name="field-${f.key}" value="${opt.value}"
                ${selected.includes(opt.value)?'checked':''} />
              ${opt.label}
            </label>
          `).join('')}
        </div>
        ${f.hint ? `<div class="integration-field-hint">${f.hint}</div>` : ''}
      </div>
    `;
  }

  if (f.type === 'checkbox') {
    return `
      <div style="display:flex; align-items:center; gap:10px; padding:8px 0;">
        <input type="checkbox" id="field-${f.key}" ${config[f.key]?'checked':''} />
        <label for="field-${f.key}" style="font-size:0.875rem; color:var(--text-secondary); cursor:pointer;">
          ${f.label}
        </label>
      </div>
    `;
  }

  return `
    <div class="form-group">
      <label class="form-label">${f.label}${f.required?' *':''}</label>
      <div class="form-input-wrapper">
        <input
          id="field-${f.key}"
          type="${f.type}"
          class="form-input"
          value="${esc(val === '••••••••' ? '' : val)}"
          placeholder="${esc(f.placeholder||'')}"
          autocomplete="${f.type==='password'?'new-password':'off'}" />
        ${f.type === 'password' ? `
          <button class="form-input-toggle" data-target="field-${f.key}" title="Mostrar">👁</button>
        ` : ''}
      </div>
      ${f.hint ? `<div class="integration-field-hint">ℹ ${f.hint}</div>` : ''}
    </div>
  `;
}

/* ─── Collect form config ─────────────────────────────────── */
function collectConfig(def) {
  const cfg = {};
  def.fields.forEach(f => {
    if (f.type === 'checkboxes') {
      cfg[f.key] = Array.from(
        document.querySelectorAll(`input[name="field-${f.key}"]:checked`)
      ).map(el => el.value);
    } else if (f.type === 'checkbox') {
      cfg[f.key] = document.getElementById(`field-${f.key}`)?.checked ?? false;
    } else {
      cfg[f.key] = document.getElementById(`field-${f.key}`)?.value?.trim() || '';
    }
  });
  return cfg;
}

/* ─── Import panels (Figma, GitHub) ──────────────────────── */
function renderImportPanels() {
  const el = document.getElementById('import-panels');
  if (!el) return;

  const panels = [];

  if (savedIntegrations.figma?.enabled) {
    panels.push(renderFigmaPanel());
  }
  if (savedIntegrations.github?.enabled) {
    panels.push(renderGitHubPanel());
  }

  el.innerHTML = panels.join('');

  // Bind Figma
  if (savedIntegrations.figma?.enabled) {
    document.getElementById('figma-load-files')?.addEventListener('click', loadFigmaFiles);
  }
  // Bind GitHub
  if (savedIntegrations.github?.enabled) {
    document.getElementById('github-load-issues')?.addEventListener('click', loadGitHubIssues);
    document.getElementById('github-load-prs')?.addEventListener('click', loadGitHubPRs);
  }

  // Password toggle inside modals
  document.querySelectorAll('.form-input-toggle[data-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = document.getElementById(btn.dataset.target);
      if(inp){ inp.type = inp.type==='password'?'text':'password'; btn.textContent = inp.type==='password'?'👁':'🙈'; }
    });
  });
}

function renderFigmaPanel() {
  const cfg  = savedIntegrations.figma?.rawConfig || {};
  return `
    <div class="import-panel" id="figma-panel">
      <div class="import-panel-header">
        <div class="import-panel-title">
          <span style="font-size:1.375rem;">🎨</span> Importar do Figma
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          ${cfg.teamId ? `<input type="text" class="form-input" id="figma-team-input" value="${esc(cfg.teamId)}"
            placeholder="Team ID" style="width:160px; padding:6px 10px; font-size:0.8125rem;" />` : ''}
          <button class="btn btn-secondary btn-sm" id="figma-load-files">
            ↺ Carregar projetos
          </button>
        </div>
      </div>
      <div id="figma-items">
        <p style="font-size:0.875rem; color:var(--text-muted);">
          Clique em "Carregar projetos" para ver seus arquivos Figma disponíveis.
        </p>
      </div>
      <div id="figma-import-actions" style="display:none; margin-top:16px; padding-top:16px; border-top:1px solid var(--border-subtle); justify-content:flex-end; gap:8px;">
        <button class="btn btn-primary btn-sm" id="figma-import-selected">
          + Importar selecionados como tarefas
        </button>
      </div>
    </div>
  `;
}

function renderGitHubPanel() {
  const cfg  = savedIntegrations.github?.rawConfig || {};
  return `
    <div class="import-panel" id="github-panel">
      <div class="import-panel-header">
        <div class="import-panel-title">
          <span style="font-size:1.375rem;">🐙</span> Importar do GitHub
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <input type="text" class="form-input" id="gh-owner" value="${esc(cfg.org||'')}"
            placeholder="owner / org" style="width:130px; padding:6px 10px; font-size:0.8125rem;" />
          <input type="text" class="form-input" id="gh-repo" value="${esc(cfg.repo||'')}"
            placeholder="repositório" style="width:150px; padding:6px 10px; font-size:0.8125rem;" />
          <button class="btn btn-secondary btn-sm" id="github-load-issues">Issues</button>
          <button class="btn btn-secondary btn-sm" id="github-load-prs">PRs</button>
        </div>
      </div>
      <div id="github-items">
        <p style="font-size:0.875rem; color:var(--text-muted);">
          Preencha o owner/repo e clique em Issues ou PRs para importar.
        </p>
      </div>
      <div id="github-import-actions" style="display:none; margin-top:16px; padding-top:16px; border-top:1px solid var(--border-subtle); justify-content:flex-end; gap:8px;">
        <button class="btn btn-primary btn-sm" id="github-import-selected">
          + Importar selecionados como tarefas
        </button>
      </div>
    </div>
  `;
}

/* ─── Figma loader ────────────────────────────────────────── */
async function loadFigmaFiles() {
  const btn = document.getElementById('figma-load-files');
  const el  = document.getElementById('figma-items');
  const cfg = savedIntegrations.figma?.rawConfig || {};
  const teamId = document.getElementById('figma-team-input')?.value?.trim() || cfg.teamId;

  if (!teamId) {
    toast.warning('Configure o Team ID nas configurações do Figma.');
    return;
  }

  if(btn){ btn.classList.add('loading'); btn.disabled=true; }
  try {
    const { getFigmaProjects, getFigmaFiles } = await import('../integrations/figma.js');
    el.innerHTML = '<div class="chart-loading"><div class="chart-loading-spinner"></div>Carregando...</div>';

    const projects = await getFigmaProjects(teamId);
    let allFiles   = [];

    for (const project of projects.slice(0, 5)) {
      const files = await getFigmaFiles(project.id);
      files.forEach(f => { f.projectName = project.name; f.projectId = project.id; });
      allFiles = allFiles.concat(files);
    }

    renderImportItems('figma-items', 'github-import-actions', allFiles.slice(0, 30), f => `
      <div class="import-item-icon">📄</div>
      <div class="import-item-info">
        <div class="import-item-name">${esc(f.name)}</div>
        <div class="import-item-meta">${esc(f.projectName||'')} · Modificado ${f.lastModified ? new Date(f.lastModified).toLocaleDateString('pt-BR') : '—'}</div>
      </div>
    `);

    document.getElementById('figma-import-actions').style.display = 'flex';
    document.getElementById('figma-import-selected')?.addEventListener('click', () => importFigmaSelected(allFiles));
  } catch(e) {
    toast.error('Erro ao carregar Figma: ' + e.message);
    if(el) el.innerHTML = `<p style="color:var(--color-danger); font-size:0.875rem;">Erro: ${esc(e.message)}</p>`;
  } finally {
    if(btn){ btn.classList.remove('loading'); btn.disabled=false; }
  }
}

async function importFigmaSelected(allFiles) {
  const selected = Array.from(document.querySelectorAll('.import-item.selected'))
    .map(el => el.dataset.itemId);

  if (!selected.length) { toast.warning('Selecione pelo menos um arquivo.'); return; }

  const btn = document.getElementById('figma-import-selected');
  if(btn){ btn.classList.add('loading'); btn.disabled=true; }
  try {
    const { importFigmaFileAsTask } = await import('../integrations/figma.js');
    let count = 0;
    for (const fileId of selected) {
      const file = allFiles.find(f => f.id === fileId);
      if (file) { await importFigmaFileAsTask(file); count++; }
    }
    toast.success(`${count} arquivo(s) Figma importados como tarefas!`);
    // Deselect
    document.querySelectorAll('.import-item.selected').forEach(el => el.classList.remove('selected'));
    document.querySelectorAll('.import-item .import-item-check').forEach(el => { el.textContent=''; });
  } catch(e) { toast.error(e.message); }
  finally { if(btn){ btn.classList.remove('loading'); btn.disabled=false; } }
}

/* ─── GitHub loader ───────────────────────────────────────── */
async function loadGitHubIssues() {
  await loadGitHubItems('issues');
}
async function loadGitHubPRs() {
  await loadGitHubItems('prs');
}

async function loadGitHubItems(type) {
  const owner = document.getElementById('gh-owner')?.value?.trim();
  const repo  = document.getElementById('gh-repo')?.value?.trim();
  const el    = document.getElementById('github-items');

  if (!owner || !repo) { toast.warning('Preencha o owner e repositório.'); return; }

  const btnId = type === 'issues' ? 'github-load-issues' : 'github-load-prs';
  const btn   = document.getElementById(btnId);
  if(btn){ btn.classList.add('loading'); btn.disabled=true; }
  try {
    const { getGitHubIssues, getGitHubPRs } = await import('../integrations/github.js');
    if(el) el.innerHTML = '<div class="chart-loading"><div class="chart-loading-spinner"></div>Carregando...</div>';

    const items = type === 'issues'
      ? await getGitHubIssues(owner, repo)
      : await getGitHubPRs(owner, repo);

    renderImportItems('github-items', 'github-import-actions', items.slice(0, 50), item => `
      <div class="import-item-icon">${type==='issues'?'🐛':'🔀'}</div>
      <div class="import-item-info">
        <div class="import-item-name">#${item.number} ${esc(item.title)}</div>
        <div class="import-item-meta">
          ${item.state==='open'?'🟢 Aberto':'🔴 Fechado'}
          ${item.labels?.length ? ' · ' + item.labels.slice(0,3).map(esc).join(', ') : ''}
          ${item.author ? ' · @' + esc(item.author) : ''}
        </div>
      </div>
    `);

    document.getElementById('github-import-actions').style.display = 'flex';
    document.getElementById('github-import-selected')?.addEventListener('click', () =>
      importGitHubSelected(items, type)
    );
  } catch(e) {
    toast.error('Erro ao carregar GitHub: ' + e.message);
    if(el) el.innerHTML = `<p style="color:var(--color-danger); font-size:0.875rem;">Erro: ${esc(e.message)}</p>`;
  } finally {
    if(btn){ btn.classList.remove('loading'); btn.disabled=false; }
  }
}

async function importGitHubSelected(items, type) {
  const selected = Array.from(document.querySelectorAll('.import-item.selected'))
    .map(el => el.dataset.itemId);

  if (!selected.length) { toast.warning('Selecione pelo menos um item.'); return; }

  const btn = document.getElementById('github-import-selected');
  if(btn){ btn.classList.add('loading'); btn.disabled=true; }
  try {
    const { importIssueAsTask, importPRAsTask } = await import('../integrations/github.js');
    let count = 0;
    for (const numStr of selected) {
      const item = items.find(i => String(i.number) === numStr);
      if (item) {
        type === 'issues' ? await importIssueAsTask(item) : await importPRAsTask(item);
        count++;
      }
    }
    toast.success(`${count} ${type==='issues'?'issue(s)':'PR(s)'} importado(s) como tarefas!`);
    document.querySelectorAll('.import-item.selected').forEach(el => el.classList.remove('selected'));
  } catch(e) { toast.error(e.message); }
  finally { if(btn){ btn.classList.remove('loading'); btn.disabled=false; } }
}

/* ─── Generic import list renderer ───────────────────────── */
function renderImportItems(containerId, actionsId, items, renderFn) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!items.length) {
    el.innerHTML = '<p style="font-size:0.875rem; color:var(--text-muted);">Nenhum item encontrado.</p>';
    return;
  }

  el.innerHTML = `
    <div style="max-height:300px; overflow-y:auto;">
      ${items.map(item => `
        <div class="import-item" data-item-id="${esc(String(item.id||item.number||item.key||''))}">
          ${renderFn(item)}
          <div class="import-item-check"></div>
        </div>
      `).join('')}
    </div>
    <div style="font-size:0.8125rem; color:var(--text-muted); margin-top:8px;">
      ${items.length} item(s) · Clique para selecionar
    </div>
  `;

  el.querySelectorAll('.import-item').forEach(item => {
    item.addEventListener('click', () => {
      item.classList.toggle('selected');
      const check = item.querySelector('.import-item-check');
      if(check) check.textContent = item.classList.contains('selected') ? '✓' : '';
    });
  });
}
