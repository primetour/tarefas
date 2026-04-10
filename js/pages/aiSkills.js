/**
 * PRIMETOUR — IA Skills
 * Central de gestão de skills de inteligência artificial
 * Configuração de API, criação e edição de skills por módulo
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import {
  fetchSkills, createSkill, updateSkill, deleteSkill, getSkill,
  getAIConfig, saveAIConfig,
  getScopedApiConfig, saveScopedApiConfig, deleteScopedApiConfig, listAllScopedConfigs,
  fetchKnowledge, createKnowledgeDoc, updateKnowledgeDoc, deleteKnowledgeDoc,
  AI_PROVIDERS, AI_MODELS, MODULE_REGISTRY, OUTPUT_FORMATS, TRIGGER_TYPES,
  getModelsForProvider, runSkill,
} from '../services/ai.js';
import { REQUESTING_AREAS, NUCLEOS } from '../services/tasks.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let allSkills = [];
let allKnowledge = [];
let currentTab = 'skills'; // 'skills' | 'config' | 'knowledge' | 'hints' | 'logs'
let allModuleHints = [];

/* ─── Render ─────────────────────────────────────────────── */
export async function renderAiSkills(container) {
  if (!store.can('system_manage_settings') && !store.isMaster()) {
    container.innerHTML = `<div class="empty-state" style="min-height:50vh;">
      <div class="empty-state-icon">◈</div>
      <div class="empty-state-title">Acesso restrito</div>
      <p class="empty-state-sub">Apenas administradores podem gerenciar skills de IA.</p>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">
          <span style="background:linear-gradient(135deg,var(--brand-gold),#F59E0B);-webkit-background-clip:text;
            -webkit-text-fill-color:transparent;font-weight:700;">◈ IA Skills</span>
        </h1>
        <p class="page-subtitle">Configure inteligência artificial nos módulos do sistema</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary" id="new-skill-btn">+ Nova Skill</button>
      </div>
    </div>

    <!-- Tabs -->
    <div class="ai-tabs" style="display:flex;gap:0;border-bottom:1px solid var(--border-subtle);margin-bottom:24px;">
      <button class="ai-tab active" data-tab="skills" style="padding:10px 20px;background:none;border:none;
        border-bottom:2px solid var(--brand-gold);color:var(--text-primary);font-weight:600;cursor:pointer;
        font-size:0.875rem;">Skills</button>
      <button class="ai-tab" data-tab="config" style="padding:10px 20px;background:none;border:none;
        border-bottom:2px solid transparent;color:var(--text-muted);font-weight:500;cursor:pointer;
        font-size:0.875rem;">Configurar API</button>
      <button class="ai-tab" data-tab="knowledge" style="padding:10px 20px;background:none;border:none;
        border-bottom:2px solid transparent;color:var(--text-muted);font-weight:500;cursor:pointer;
        font-size:0.875rem;">Base de Conhecimento</button>
      <button class="ai-tab" data-tab="hints" style="padding:10px 20px;background:none;border:none;
        border-bottom:2px solid transparent;color:var(--text-muted);font-weight:500;cursor:pointer;
        font-size:0.875rem;">Prompts por Módulo</button>
      <button class="ai-tab" data-tab="logs" style="padding:10px 20px;background:none;border:none;
        border-bottom:2px solid transparent;color:var(--text-muted);font-weight:500;cursor:pointer;
        font-size:0.875rem;">Uso e Logs</button>
    </div>

    <!-- Tab content -->
    <div id="ai-tab-content"></div>
  `;

  // Tab switching
  container.querySelectorAll('.ai-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.ai-tab').forEach(t => {
        t.style.borderBottomColor = 'transparent';
        t.style.color = 'var(--text-muted)';
        t.style.fontWeight = '500';
        t.classList.remove('active');
      });
      btn.style.borderBottomColor = 'var(--brand-gold)';
      btn.style.color = 'var(--text-primary)';
      btn.style.fontWeight = '600';
      btn.classList.add('active');
      currentTab = btn.dataset.tab;
      // Botão "+ Nova Skill" só faz sentido na aba Skills
      const newBtn = document.getElementById('new-skill-btn');
      if (newBtn) newBtn.style.display = (currentTab === 'skills') ? '' : 'none';
      renderTab();
    });
  });

  document.getElementById('new-skill-btn')?.addEventListener('click', () => openSkillModal());

  await loadAll();
}

async function loadAll() {
  [allSkills, allKnowledge] = await Promise.all([fetchSkills(), fetchKnowledge()]);
  renderTab();
}

function renderTab() {
  const el = document.getElementById('ai-tab-content');
  if (!el) return;
  if (currentTab === 'config')    return renderConfigTab(el);
  if (currentTab === 'knowledge') return renderKnowledgeTab(el);
  if (currentTab === 'hints')     return renderHintsTab(el);
  if (currentTab === 'logs')      return renderLogsTab(el);
  renderSkillsTab(el);
}

/* ═══════════════════════════════════════════════════════════ *
 *  TAB: Skills list                                          *
 * ═══════════════════════════════════════════════════════════ */
function renderSkillsTab(el) {
  if (!allSkills.length) {
    el.innerHTML = `<div class="empty-state" style="min-height:35vh;">
      <div class="empty-state-icon">◈</div>
      <div class="empty-state-title">Nenhuma skill cadastrada</div>
      <p class="empty-state-sub">Crie sua primeira skill de IA para começar a usar inteligência artificial nos módulos.</p>
    </div>`;
    return;
  }

  // Group by module
  const grouped = {};
  for (const s of allSkills) {
    const mod = s.module || 'general';
    if (!grouped[mod]) grouped[mod] = [];
    grouped[mod].push(s);
  }

  el.innerHTML = Object.entries(grouped).map(([mod, skills]) => {
    const reg = MODULE_REGISTRY[mod] || { label: mod, icon: '◈' };
    return `
      <div style="margin-bottom:28px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
          <span style="font-size:1.125rem;">${reg.icon}</span>
          <span style="font-weight:600;color:var(--text-primary);font-size:0.9375rem;">${esc(reg.label)}</span>
          <span style="font-size:0.75rem;color:var(--text-muted);background:var(--bg-surface);
            padding:2px 8px;border-radius:10px;">${skills.length}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px;">
          ${skills.map(s => renderSkillCard(s)).join('')}
        </div>
      </div>
    `;
  }).join('');

  // Bind card actions
  el.querySelectorAll('.skill-edit-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const s = await getSkill(btn.dataset.id);
      if (s) openSkillModal(s);
    });
  });
  el.querySelectorAll('.skill-test-btn').forEach(btn => {
    btn.addEventListener('click', () => openTestModal(btn.dataset.id));
  });
  el.querySelectorAll('.skill-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const s = allSkills.find(x => x.id === btn.dataset.id);
      if (!s) return;
      await updateSkill(s.id, { active: !s.active });
      toast.success(s.active ? 'Skill desativada' : 'Skill ativada');
      await loadAll();
    });
  });
  el.querySelectorAll('.skill-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await modal.confirm({ title: 'Excluir skill', message: 'Tem certeza? Esta ação não pode ser desfeita.', danger: true });
      if (!ok) return;
      await deleteSkill(btn.dataset.id);
      toast.success('Skill excluída');
      await loadAll();
    });
  });
}

function renderSkillCard(s) {
  const reg = MODULE_REGISTRY[s.module] || { label: s.module, icon: '◈' };
  const prov = AI_PROVIDERS.find(p => p.id === s.provider) || AI_PROVIDERS[0];
  const modelList = AI_MODELS[s.provider] || [];
  const modelInfo = modelList.find(m => m.id === s.model);

  return `
    <div class="card" style="padding:16px;position:relative;border-left:3px solid ${s.active ? 'var(--brand-gold)' : 'var(--border-subtle)'};">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
        <div style="font-weight:600;color:var(--text-primary);font-size:0.9375rem;">${esc(s.name)}</div>
        <div style="display:flex;gap:4px;">
          <button class="skill-test-btn" data-id="${s.id}" title="Testar"
            style="background:none;border:none;cursor:pointer;font-size:0.8125rem;color:var(--brand-gold);padding:2px 6px;">▶</button>
          <button class="skill-edit-btn" data-id="${s.id}" title="Editar"
            style="background:none;border:none;cursor:pointer;font-size:0.8125rem;color:var(--text-muted);padding:2px 6px;">✎</button>
          <button class="skill-toggle-btn" data-id="${s.id}" title="${s.active ? 'Desativar' : 'Ativar'}"
            style="background:none;border:none;cursor:pointer;font-size:0.8125rem;color:${s.active ? 'var(--success)' : 'var(--text-muted)'};padding:2px 6px;">●</button>
          <button class="skill-delete-btn" data-id="${s.id}" title="Excluir"
            style="background:none;border:none;cursor:pointer;font-size:0.8125rem;color:var(--text-muted);padding:2px 6px;">✕</button>
        </div>
      </div>
      ${s.description ? `<div style="font-size:0.8125rem;color:var(--text-secondary);margin-bottom:10px;line-height:1.5;">${esc(s.description)}</div>` : ''}
      <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:0.75rem;">
        <span style="background:var(--bg-surface);padding:2px 8px;border-radius:4px;color:var(--text-muted);">${esc(prov.label)}</span>
        ${modelInfo ? `<span style="background:var(--bg-surface);padding:2px 8px;border-radius:4px;color:var(--text-muted);">${esc(modelInfo.label)}</span>` : ''}
        <span style="background:var(--bg-surface);padding:2px 8px;border-radius:4px;color:var(--text-muted);">${s.outputFormat || 'text'}</span>
        ${s.voiceTone ? `<span style="background:var(--bg-surface);padding:2px 8px;border-radius:4px;color:var(--text-muted);">🎯 ${esc(s.voiceTone)}</span>` : ''}
        ${!s.active ? `<span style="background:var(--danger-bg,#3a1a1a);padding:2px 8px;border-radius:4px;color:var(--danger,#ef4444);">Inativa</span>` : ''}
      </div>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════ *
 *  TAB: Configurar API  (multi-escopo)                       *
 * ═══════════════════════════════════════════════════════════ */
let _cfgScope = 'global'; // 'global' | 'user' | 'nucleo' | 'area'
let _cfgScopeId = null;
let _cfgScopeLabel = null;
let _allScopedConfigs = [];

async function renderConfigTab(el) {
  el.innerHTML = `<div class="card skeleton" style="height:200px;"></div>`;

  // Carregar configs existentes em paralelo
  const [globalConfig, scopedConfigs] = await Promise.all([
    getAIConfig().then(c => c || {}),
    listAllScopedConfigs(),
  ]);
  _allScopedConfigs = scopedConfigs;

  const users   = store.get('users') || [];
  const nucleos = store.get('nucleos') || NUCLEOS;

  el.innerHTML = `
    <div style="max-width:760px;">

      <!-- ESCOPO SELECTOR -->
      <div class="card" style="padding:20px;margin-bottom:16px;">
        <div style="font-weight:600;font-size:1rem;color:var(--text-primary);margin-bottom:4px;">
          Escopo da Configuração
        </div>
        <p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:14px;">
          Defina API Keys por nível. A resolução segue a prioridade:
          <strong>Usuário → Núcleo → Área → Global</strong>.
        </p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;" id="ai-scope-tabs">
          <button class="btn ${_cfgScope==='global'?'btn-primary':'btn-ghost'} ai-scope-tab" data-scope="global" style="font-size:0.8125rem;">
            🌐 Global
          </button>
          <button class="btn ${_cfgScope==='user'?'btn-primary':'btn-ghost'} ai-scope-tab" data-scope="user" style="font-size:0.8125rem;">
            👤 Por Usuário
          </button>
          <button class="btn ${_cfgScope==='nucleo'?'btn-primary':'btn-ghost'} ai-scope-tab" data-scope="nucleo" style="font-size:0.8125rem;">
            ◎ Por Núcleo
          </button>
          <button class="btn ${_cfgScope==='area'?'btn-primary':'btn-ghost'} ai-scope-tab" data-scope="area" style="font-size:0.8125rem;">
            ◈ Por Área
          </button>
        </div>

        <!-- Selector de entidade (escondido quando Global) -->
        <div id="ai-scope-entity" style="display:${_cfgScope==='global'?'none':'block'};">
          <div id="ai-scope-entity-inner"></div>
        </div>
      </div>

      <!-- CARDS de configs existentes por escopo -->
      <div id="ai-scoped-list" style="margin-bottom:16px;"></div>

      <!-- PROVIDER KEYS FORM -->
      <div id="ai-cfg-form-area"></div>

      <!-- PADRÕES GLOBAIS (só aparece no escopo Global) -->
      <div id="ai-cfg-defaults-area"></div>

      <!-- BOTÃO SALVAR -->
      <button class="btn btn-primary" id="ai-cfg-save" style="width:100%;margin-top:8px;">
        Salvar configurações
      </button>
    </div>
  `;

  // ── Render helpers ─────────────────────────────────────
  function renderEntitySelector() {
    const inner = document.getElementById('ai-scope-entity-inner');
    const wrap  = document.getElementById('ai-scope-entity');
    if (!inner || !wrap) return;
    wrap.style.display = _cfgScope === 'global' ? 'none' : 'block';

    if (_cfgScope === 'user') {
      inner.innerHTML = `
        <label class="form-label" style="font-size:0.8125rem;">Selecione o Usuário</label>
        <select class="form-select" id="ai-scope-select" style="font-size:0.8125rem;">
          <option value="">-- Selecione --</option>
          ${users.filter(u => u.active !== false).map(u =>
            `<option value="${u.id}" ${_cfgScopeId===u.id?'selected':''}>${esc(u.name || u.email)}</option>`
          ).join('')}
        </select>`;
    } else if (_cfgScope === 'nucleo') {
      const nucleoList = Array.isArray(nucleos) ? nucleos : [];
      inner.innerHTML = `
        <label class="form-label" style="font-size:0.8125rem;">Selecione o Núcleo</label>
        <select class="form-select" id="ai-scope-select" style="font-size:0.8125rem;">
          <option value="">-- Selecione --</option>
          ${nucleoList.map(n => {
            const val = n.value || n.id || n.name;
            const lbl = n.label || n.name || val;
            return `<option value="${esc(val)}" ${_cfgScopeId===val?'selected':''}>${esc(lbl)}</option>`;
          }).join('')}
        </select>`;
    } else if (_cfgScope === 'area') {
      // Multi-select com checkboxes para áreas
      const selectedAreas = Array.isArray(_cfgScopeId) ? _cfgScopeId : (_cfgScopeId ? [_cfgScopeId] : []);
      inner.innerHTML = `
        <label class="form-label" style="font-size:0.8125rem;">Selecione as Áreas (múltiplas)</label>
        <div style="display:flex;gap:4px;margin-bottom:8px;">
          <button class="btn btn-ghost btn-sm" id="ai-area-select-all" style="font-size:0.6875rem;">Selecionar todas</button>
          <button class="btn btn-ghost btn-sm" id="ai-area-clear-all" style="font-size:0.6875rem;">Limpar</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px;
          max-height:180px;overflow-y:auto;padding:10px;border:1px solid var(--border-subtle);border-radius:8px;background:var(--bg-surface);">
          ${REQUESTING_AREAS.map(a => `
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.8125rem;color:var(--text-primary);
              padding:4px 8px;border-radius:6px;transition:background 0.15s;${selectedAreas.includes(a) ? 'background:var(--brand-gold-10,rgba(212,168,67,0.15));' : ''}"
              class="ai-area-chip">
              <input type="checkbox" class="ai-area-check" value="${esc(a)}" ${selectedAreas.includes(a) ? 'checked' : ''}
                style="accent-color:var(--brand-gold);" />
              ${esc(a)}
            </label>
          `).join('')}
        </div>
        <div id="ai-area-count" style="font-size:0.75rem;color:var(--text-muted);margin-top:6px;">
          ${selectedAreas.length} área(s) selecionada(s)
        </div>`;

      // Handlers para checkboxes
      const updateAreaSelection = () => {
        const checked = [...inner.querySelectorAll('.ai-area-check:checked')].map(cb => cb.value);
        _cfgScopeId = checked.length ? checked : null;
        _cfgScopeLabel = checked.length ? checked.join(', ') : null;
        const countEl = document.getElementById('ai-area-count');
        if (countEl) countEl.textContent = `${checked.length} área(s) selecionada(s)`;
        // Highlight checked chips
        inner.querySelectorAll('.ai-area-chip').forEach(chip => {
          const cb = chip.querySelector('.ai-area-check');
          chip.style.background = cb?.checked ? 'var(--brand-gold-10,rgba(212,168,67,0.15))' : '';
        });
        renderKeyForm();
      };
      inner.querySelectorAll('.ai-area-check').forEach(cb => cb.addEventListener('change', updateAreaSelection));
      document.getElementById('ai-area-select-all')?.addEventListener('click', () => {
        inner.querySelectorAll('.ai-area-check').forEach(cb => { cb.checked = true; });
        updateAreaSelection();
      });
      document.getElementById('ai-area-clear-all')?.addEventListener('click', () => {
        inner.querySelectorAll('.ai-area-check').forEach(cb => { cb.checked = false; });
        updateAreaSelection();
      });
      return; // skip single-select handler below
    }

    document.getElementById('ai-scope-select')?.addEventListener('change', (e) => {
      _cfgScopeId = e.target.value || null;
      _cfgScopeLabel = e.target.options[e.target.selectedIndex]?.textContent || _cfgScopeId;
      renderKeyForm();
    });
  }

  function renderScopedList() {
    const listEl = document.getElementById('ai-scoped-list');
    if (!listEl) return;
    const scopeConfigs = _cfgScope === 'global' ? [] : _allScopedConfigs.filter(c => c.scope === _cfgScope);
    if (!scopeConfigs.length) { listEl.innerHTML = ''; return; }

    listEl.innerHTML = `
      <div class="card" style="padding:16px;">
        <div style="font-weight:600;font-size:0.875rem;color:var(--text-primary);margin-bottom:10px;">
          Configurações existentes (${_cfgScope === 'user' ? 'Usuários' : _cfgScope === 'nucleo' ? 'Núcleos' : 'Áreas'})
        </div>
        ${scopeConfigs.map(c => {
          const provs = AI_PROVIDERS.filter(p => c[p.id + 'ApiKey']).map(p => p.icon + ' ' + p.label.split(' ')[0]);
          const areaIds = c.scopeIds || [];
          const displayLabel = _cfgScope === 'area' && areaIds.length
            ? areaIds.map(a => `<span style="display:inline-block;background:var(--bg-surface);padding:1px 6px;border-radius:4px;font-size:0.6875rem;margin:1px 2px;">${esc(a)}</span>`).join('')
            : esc(c.scopeLabel || c.scopeId);
          const editData = _cfgScope === 'area' && areaIds.length
            ? `data-ids='${JSON.stringify(areaIds)}'`
            : `data-id="${esc(c.scopeId)}"`;
          return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-subtle);flex-wrap:wrap;">
            <span style="font-weight:500;color:var(--text-primary);min-width:140px;flex:1;">${displayLabel}</span>
            <span style="font-size:0.75rem;color:var(--text-muted);">${provs.length ? provs.join(', ') : 'Nenhum provider'}</span>
            ${c.active === false ? '<span style="color:var(--danger);font-size:0.75rem;">Inativa</span>' : '<span style="color:var(--success);font-size:0.75rem;">Ativa</span>'}
            <button class="btn btn-ghost btn-sm ai-scope-edit" ${editData} data-label="${esc(c.scopeLabel||c.scopeId)}" style="font-size:0.75rem;">Editar</button>
            <button class="btn btn-ghost btn-sm ai-scope-del" data-doc="${c.id}" data-label="${esc(c.scopeLabel||c.scopeId)}" style="font-size:0.75rem;color:var(--danger);">Remover</button>
          </div>`;
        }).join('')}
      </div>
    `;

    listEl.querySelectorAll('.ai-scope-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        if (_cfgScope === 'area' && btn.dataset.ids) {
          // Restaurar seleção múltipla de áreas
          try { _cfgScopeId = JSON.parse(btn.dataset.ids); } catch { _cfgScopeId = [btn.dataset.id]; }
          _cfgScopeLabel = btn.dataset.label;
          renderEntitySelector(); // re-render checkboxes com seleção
        } else {
          _cfgScopeId = btn.dataset.id;
          _cfgScopeLabel = btn.dataset.label;
          const sel = document.getElementById('ai-scope-select');
          if (sel) sel.value = _cfgScopeId;
        }
        renderKeyForm();
      });
    });

    listEl.querySelectorAll('.ai-scope-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Remover configuração de "${btn.dataset.label}"?`)) return;
        try {
          await deleteScopedApiConfig(btn.dataset.doc);
          toast.success('Configuração removida.');
          _allScopedConfigs = await listAllScopedConfigs();
          renderScopedList();
        } catch (e) { toast.error('Erro: ' + e.message); }
      });
    });
  }

  async function renderKeyForm() {
    const formEl = document.getElementById('ai-cfg-form-area');
    const defEl  = document.getElementById('ai-cfg-defaults-area');
    if (!formEl) return;

    // Carregar config do escopo selecionado
    let config = {};
    if (_cfgScope === 'global') {
      config = globalConfig;
    } else if (_cfgScope === 'area') {
      // Área: _cfgScopeId é um array
      const areaArr = Array.isArray(_cfgScopeId) ? _cfgScopeId : (_cfgScopeId ? [_cfgScopeId] : []);
      if (!areaArr.length) {
        formEl.innerHTML = `<div class="card" style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.875rem;">
          Selecione ao menos uma área acima para configurar.
        </div>`;
        if (defEl) defEl.innerHTML = '';
        return;
      }
      // Busca config pela primeira área selecionada (todas compartilham a mesma config)
      const scoped = await getScopedApiConfig('area', areaArr[0]);
      config = scoped || {};
    } else if (_cfgScopeId) {
      const scoped = await getScopedApiConfig(_cfgScope, _cfgScopeId);
      config = scoped || {};
    } else {
      formEl.innerHTML = `<div class="card" style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.875rem;">
        Selecione ${_cfgScope === 'user' ? 'um usuário' : 'um núcleo'} acima para configurar.
      </div>`;
      if (defEl) defEl.innerHTML = '';
      return;
    }

    const areaCount = Array.isArray(_cfgScopeId) ? _cfgScopeId.length : 0;
    const scopeLabel = _cfgScope === 'global' ? 'Global (todos os usuários)'
      : _cfgScope === 'user' ? `Usuário: ${_cfgScopeLabel || _cfgScopeId}`
      : _cfgScope === 'nucleo' ? `Núcleo: ${_cfgScopeLabel || _cfgScopeId}`
      : `${areaCount} Área(s): ${(Array.isArray(_cfgScopeId) ? _cfgScopeId : [_cfgScopeId]).join(', ')}`;

    formEl.innerHTML = `
      <div class="card" style="padding:24px;margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <div style="font-weight:600;font-size:1rem;color:var(--text-primary);">API Keys</div>
          <span style="font-size:0.75rem;background:var(--bg-surface);padding:2px 10px;border-radius:10px;color:var(--brand-gold);">
            ${esc(scopeLabel)}
          </span>
        </div>
        <p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:20px;">
          ${_cfgScope === 'global'
            ? 'Chave padrão usada quando não há configuração específica para o usuário, núcleo ou área.'
            : 'Estas chaves terão prioridade sobre a configuração global para este escopo.'}
        </p>

        ${AI_PROVIDERS.map(p => `
          <div style="border:1px solid var(--border-subtle);border-radius:8px;padding:16px;margin-bottom:12px;
            ${config[p.id + 'ApiKey'] ? 'border-left:3px solid var(--success);' : ''}">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
              <span style="font-size:1rem;">${p.icon}</span>
              <span style="font-weight:600;color:var(--text-primary);">${esc(p.label)}</span>
              ${p.free ? `<span style="background:var(--success-bg,#1a3a1a);color:var(--success,#22c55e);
                font-size:0.6875rem;padding:2px 8px;border-radius:10px;font-weight:600;">GRÁTIS</span>` : ''}
              ${config[p.id + 'ApiKey'] ? `<span style="color:var(--success);font-size:0.75rem;margin-left:auto;">● Configurada</span>` : ''}
            </div>
            ${p.signupUrl ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:8px;">
              Obtenha sua key gratuita em: <a href="${p.signupUrl}" target="_blank" rel="noopener"
              style="color:var(--brand-gold);text-decoration:underline;">${p.signupUrl}</a>
            </div>` : ''}
            <div class="form-group" style="margin-bottom:${p.id === 'azure' ? '8' : '0'}px;">
              <label class="form-label" style="font-size:0.8125rem;">API Key</label>
              <input type="password" class="form-input ai-cfg-key" data-provider="${p.id}"
                value="${config[p.id + 'ApiKey'] ? '••••••••••••••••' : ''}"
                placeholder="Cole sua API Key aqui"
                style="font-family:monospace;font-size:0.8125rem;" />
            </div>
            ${p.id === 'azure' ? `
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label" style="font-size:0.8125rem;">Endpoint Azure</label>
                <input type="text" class="form-input" id="ai-cfg-azure-endpoint"
                  value="${esc(config.azureEndpoint || '')}"
                  placeholder="https://seu-recurso.openai.azure.com"
                  style="font-family:monospace;font-size:0.8125rem;" />
              </div>
            ` : ''}
            ${p.id === 'local' ? `
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label" style="font-size:0.8125rem;">Endpoint do servidor</label>
                <input type="text" class="form-input" id="ai-cfg-local-endpoint"
                  value="${esc(config.localEndpoint || 'http://localhost:11434')}"
                  placeholder="http://localhost:11434"
                  style="font-family:monospace;font-size:0.8125rem;" />
                <small style="font-size:0.6875rem;color:var(--text-muted);margin-top:4px;display:block;">
                  Ollama: porta 11434 · vLLM/TGI: porta 8000 · API Key opcional
                </small>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    `;

    // Padrões globais — só no escopo global
    if (defEl) {
      if (_cfgScope === 'global') {
        defEl.innerHTML = `
          <div class="card" style="padding:24px;margin-bottom:16px;">
            <div style="font-weight:600;font-size:1rem;color:var(--text-primary);margin-bottom:4px;">Padrões globais</div>
            <p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:16px;">
              Valores padrão usados quando a skill não define explicitamente.
            </p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group" style="margin:0;">
                <label class="form-label" style="font-size:0.8125rem;">Provider padrão</label>
                <select class="form-select" id="ai-cfg-provider" style="font-size:0.8125rem;">
                  ${AI_PROVIDERS.map(p => `<option value="${p.id}" ${config.provider === p.id ? 'selected' : ''}>${p.label}</option>`).join('')}
                </select>
              </div>
              <div class="form-group" style="margin:0;">
                <label class="form-label" style="font-size:0.8125rem;">Max tokens padrão</label>
                <input type="number" class="form-input" id="ai-cfg-max-tokens"
                  value="${config.defaultMaxTokens || 1024}" min="100" max="16000"
                  style="font-size:0.8125rem;" />
              </div>
            </div>
          </div>
          <div class="card" style="padding:24px;margin-bottom:16px;">
            <div style="font-weight:600;font-size:1rem;color:var(--text-primary);margin-bottom:4px;">🔍 Busca Web (Clipping / Notícias)</div>
            <p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:16px;">
              API para buscar menções na web. Configure ao menos uma opção.
            </p>

            <div style="border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:12px;">
              <div style="font-weight:600;font-size:0.875rem;color:var(--success,#22C55E);margin-bottom:8px;">
                ⭐ Opção 1: Serper.dev <span style="font-weight:400;color:var(--text-muted);">(recomendado — mais fácil)</span>
              </div>
              <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:8px;">
                Busca Google completa. 2.500 créditos gratuitos.
                <a href="https://serper.dev/" target="_blank" style="color:var(--primary);">Criar conta e obter API Key →</a>
              </p>
              <div class="form-group" style="margin:0;">
                <label class="form-label" style="font-size:0.8125rem;">Serper API Key</label>
                <input type="password" class="form-input" id="ai-cfg-serper-key"
                  value="${esc(config.serperApiKey || '')}"
                  placeholder="Cole sua API key aqui..."
                  style="font-family:monospace;font-size:0.8125rem;" />
              </div>
            </div>

            <div style="border:1px solid var(--border);border-radius:8px;padding:16px;">
              <div style="font-weight:600;font-size:0.875rem;color:var(--text-muted);margin-bottom:8px;">
                Opção 2: Google Custom Search <span style="font-weight:400;">(busca em sites específicos)</span>
              </div>
              <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:8px;">
                100 buscas/dia gratuitas. Requer criar Search Engine com sites configurados.
                <a href="https://programmablesearchengine.google.com/" target="_blank" style="color:var(--primary);">Criar →</a>
              </p>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div class="form-group" style="margin:0;">
                  <label class="form-label" style="font-size:0.8125rem;">API Key</label>
                  <input type="password" class="form-input" id="ai-cfg-google-search-key"
                    value="${esc(config.googleSearchApiKey || '')}"
                    placeholder="AIzaSy..."
                    style="font-family:monospace;font-size:0.8125rem;" />
                </div>
                <div class="form-group" style="margin:0;">
                  <label class="form-label" style="font-size:0.8125rem;">Search Engine ID (CX)</label>
                  <input type="text" class="form-input" id="ai-cfg-google-search-cx"
                    value="${esc(config.googleSearchCx || '')}"
                    placeholder="a1b2c3d4e5f6..."
                    style="font-family:monospace;font-size:0.8125rem;" />
                </div>
              </div>
            </div>
          </div>
        `;
      } else {
        defEl.innerHTML = '';
      }
    }
  }

  // ── Event: Scope tabs ──────────────────────────────────
  el.querySelectorAll('.ai-scope-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _cfgScope = btn.dataset.scope;
      _cfgScopeId = null;
      _cfgScopeLabel = null;
      el.querySelectorAll('.ai-scope-tab').forEach(b => b.classList.replace('btn-primary','btn-ghost'));
      btn.classList.replace('btn-ghost','btn-primary');
      renderEntitySelector();
      renderScopedList();
      renderKeyForm();
    });
  });

  // ── Event: Save ────────────────────────────────────────
  document.getElementById('ai-cfg-save')?.addEventListener('click', async () => {
    const data = {};

    // Coletar API keys (só salva se o campo foi alterado)
    document.querySelectorAll('.ai-cfg-key').forEach(input => {
      const pid = input.dataset.provider;
      const val = input.value.trim();
      if (val && !val.startsWith('••')) {
        data[pid + 'ApiKey'] = val;
      }
    });

    // Azure endpoint
    const azEndpoint = document.getElementById('ai-cfg-azure-endpoint')?.value?.trim();
    if (azEndpoint !== undefined) data.azureEndpoint = azEndpoint || '';

    // Local (Ollama/vLLM) endpoint
    const localEndpoint = document.getElementById('ai-cfg-local-endpoint')?.value?.trim();
    if (localEndpoint !== undefined) data.localEndpoint = localEndpoint || 'http://localhost:11434';

    // APIs de busca web (para clipping/notícias)
    const serperKey = document.getElementById('ai-cfg-serper-key')?.value?.trim();
    if (serperKey !== undefined && serperKey && !serperKey.startsWith('••')) data.serperApiKey = serperKey;
    const gSearchKey = document.getElementById('ai-cfg-google-search-key')?.value?.trim();
    const gSearchCx = document.getElementById('ai-cfg-google-search-cx')?.value?.trim();
    if (gSearchKey !== undefined && gSearchKey && !gSearchKey.startsWith('••')) data.googleSearchApiKey = gSearchKey;
    if (gSearchCx !== undefined) data.googleSearchCx = gSearchCx || '';

    try {
      if (_cfgScope === 'global') {
        // Salvar na config global (legado)
        data.provider         = document.getElementById('ai-cfg-provider')?.value || 'gemini';
        data.defaultMaxTokens = parseInt(document.getElementById('ai-cfg-max-tokens')?.value) || 1024;
        await saveAIConfig(data);
      } else {
        // Salvar na coleção de escopos
        const isEmpty = _cfgScope === 'area'
          ? (!Array.isArray(_cfgScopeId) || !_cfgScopeId.length)
          : !_cfgScopeId;
        if (isEmpty) {
          toast.error(_cfgScope === 'area' ? 'Selecione ao menos uma área.' : 'Selecione o escopo antes de salvar.');
          return;
        }
        await saveScopedApiConfig(_cfgScope, _cfgScopeId, _cfgScopeLabel || String(_cfgScopeId), data);
        _allScopedConfigs = await listAllScopedConfigs();
        renderScopedList();
      }
      toast.success('Configurações salvas!');
    } catch (e) {
      toast.error('Erro ao salvar: ' + e.message);
    }
  });

  // ── Initial render ─────────────────────────────────────
  renderEntitySelector();
  renderScopedList();
  renderKeyForm();
}

/* ═══════════════════════════════════════════════════════════ *
 *  TAB: Base de Conhecimento                                  *
 * ═══════════════════════════════════════════════════════════ */
function renderKnowledgeTab(el) {
  const totalChars = allKnowledge.reduce((s, d) => s + (d.charCount || d.content?.length || 0), 0);
  const totalTokensEst = Math.round(totalChars / 4);

  // Agrupar por pasta
  const grouped = {};
  for (const d of allKnowledge) {
    const folder = d.folder || 'Sem pasta';
    if (!grouped[folder]) grouped[folder] = [];
    grouped[folder].push(d);
  }
  // Ordenar: pastas nomeadas primeiro, "Sem pasta" por último
  const folderNames = Object.keys(grouped).sort((a, b) => {
    if (a === 'Sem pasta') return 1;
    if (b === 'Sem pasta') return -1;
    return a.localeCompare(b);
  });

  // Lista de pastas existentes para o datalist
  const existingFolders = [...new Set(allKnowledge.map(d => d.folder).filter(Boolean))].sort();

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div>
        <span style="font-size:0.8125rem;color:var(--text-muted);">
          ${allKnowledge.length} documento${allKnowledge.length !== 1 ? 's' : ''} ·
          ${folderNames.length} pasta${folderNames.length !== 1 ? 's' : ''} ·
          ~${totalTokensEst.toLocaleString('pt-BR')} tokens estimados
        </span>
      </div>
      <button class="btn btn-primary" id="new-knowledge-btn">+ Novo Documento</button>
    </div>

    ${!allKnowledge.length ? `
      <div class="empty-state" style="min-height:30vh;">
        <div class="empty-state-icon">📚</div>
        <div class="empty-state-title">Nenhum documento na base</div>
        <p class="empty-state-sub">Adicione documentos (manuais, guias, textos) para que as skills de IA possam consultá-los como referência.</p>
      </div>
    ` : folderNames.map(folder => {
      const docs = grouped[folder];
      const folderChars = docs.reduce((s, d) => s + (d.charCount || d.content?.length || 0), 0);
      const isDefaultFolder = folder === 'Sem pasta';
      return `
        <div style="margin-bottom:24px;">
          <div class="kb-folder-header" data-folder="${esc(folder)}" style="display:flex;align-items:center;gap:8px;margin-bottom:12px;cursor:pointer;user-select:none;">
            <span class="kb-folder-chevron" style="font-size:0.75rem;color:var(--text-muted);transition:transform 0.2s;">▼</span>
            <span style="font-size:1rem;">${isDefaultFolder ? '📄' : '📁'}</span>
            <span style="font-weight:600;color:var(--text-primary);font-size:0.9375rem;">${esc(folder)}</span>
            <span style="font-size:0.75rem;color:var(--text-muted);background:var(--bg-surface);
              padding:2px 8px;border-radius:10px;">${docs.length}</span>
            <span style="font-size:0.6875rem;color:var(--text-muted);">· ~${Math.round(folderChars / 4).toLocaleString('pt-BR')} tokens</span>
          </div>
          <div class="kb-folder-content" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px;">
            ${docs.map(d => renderKnowledgeCard(d)).join('')}
          </div>
        </div>
      `;
    }).join('')}
  `;

  document.getElementById('new-knowledge-btn')?.addEventListener('click', () => openKnowledgeModal(null, existingFolders));

  // Folder collapse/expand
  el.querySelectorAll('.kb-folder-header').forEach(header => {
    header.addEventListener('click', () => {
      const content = header.nextElementSibling;
      const chevron = header.querySelector('.kb-folder-chevron');
      if (content.style.display === 'none') {
        content.style.display = '';
        if (chevron) chevron.style.transform = '';
      } else {
        content.style.display = 'none';
        if (chevron) chevron.style.transform = 'rotate(-90deg)';
      }
    });
  });

  el.querySelectorAll('.kb-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = allKnowledge.find(x => x.id === btn.dataset.id);
      if (d) openKnowledgeModal(d, existingFolders);
    });
  });
  el.querySelectorAll('.kb-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await modal.confirm({ title: 'Excluir documento', message: 'Tem certeza? Skills que referenciam este documento perderão o acesso.', danger: true });
      if (!ok) return;
      await deleteKnowledgeDoc(btn.dataset.id);
      toast.success('Documento excluído');
      await loadAll();
    });
  });
}

function renderKnowledgeCard(d) {
  const chars = d.charCount || d.content?.length || 0;
  const tokens = Math.round(chars / 4);
  const preview = (d.content || '').substring(0, 120).replace(/\n/g, ' ');
  const ts = d.updatedAt?.toDate ? d.updatedAt.toDate() : d.createdAt?.toDate ? d.createdAt.toDate() : null;
  const date = ts ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(ts) : '';

  // Count how many skills reference this doc
  const usedBy = allSkills.filter(s => s.knowledgeIds?.includes(d.id)).length;

  return `
    <div class="card" style="padding:16px;border-left:3px solid var(--brand-gold);">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px;">
        <div style="font-weight:600;color:var(--text-primary);font-size:0.9375rem;">📄 ${esc(d.title)}</div>
        <div style="display:flex;gap:4px;">
          <button class="kb-edit-btn" data-id="${d.id}" title="Editar"
            style="background:none;border:none;cursor:pointer;font-size:0.8125rem;color:var(--text-muted);padding:2px 6px;">✎</button>
          <button class="kb-delete-btn" data-id="${d.id}" title="Excluir"
            style="background:none;border:none;cursor:pointer;font-size:0.8125rem;color:var(--text-muted);padding:2px 6px;">✕</button>
        </div>
      </div>
      ${preview ? `<div style="font-size:0.8125rem;color:var(--text-secondary);margin-bottom:8px;line-height:1.5;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(preview)}...</div>` : ''}
      <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:0.75rem;">
        <span style="background:var(--bg-surface);padding:2px 8px;border-radius:4px;color:var(--text-muted);">
          ${chars.toLocaleString('pt-BR')} chars · ~${tokens.toLocaleString('pt-BR')} tokens
        </span>
        ${d.tags?.length ? d.tags.map(t => `<span style="background:var(--bg-surface);padding:2px 8px;border-radius:4px;color:var(--brand-gold);">${esc(t)}</span>`).join('') : ''}
        ${usedBy > 0 ? `<span style="background:rgba(34,197,94,0.1);padding:2px 8px;border-radius:4px;color:var(--success,#22c55e);">
          Usado por ${usedBy} skill${usedBy > 1 ? 's' : ''}
        </span>` : `<span style="background:var(--bg-surface);padding:2px 8px;border-radius:4px;color:var(--text-muted);">Não vinculado</span>`}
        ${date ? `<span style="background:var(--bg-surface);padding:2px 8px;border-radius:4px;color:var(--text-muted);">${date}</span>` : ''}
      </div>
    </div>
  `;
}

function openKnowledgeModal(doc = null, existingFolders = []) {
  const isEdit = !!doc;
  const folderListId = 'kb-folder-list-' + Date.now();

  modal.open({
    title: isEdit ? 'Editar Documento' : 'Novo Documento de Conhecimento',
    size: 'lg',
    content: `
      <div style="display:flex;flex-direction:column;gap:14px;max-height:70vh;overflow-y:auto;padding:4px;">
        <div class="form-group" style="margin:0;">
          <label class="form-label">Título *</label>
          <input type="text" class="form-input" id="kb-title" value="${esc(doc?.title || '')}"
            placeholder="Ex: Manual de Tom de Voz, Guia de Destinos, FAQ Interno" />
        </div>

        <div class="form-group" style="margin:0;">
          <label class="form-label">Pasta
            <span class="info-tip" title="Organize seus documentos em pastas. Digite o nome de uma pasta existente ou crie uma nova.">ℹ</span>
          </label>
          <input type="text" class="form-input" id="kb-folder" list="${folderListId}" value="${esc(doc?.folder || '')}"
            placeholder="Ex: Manuais, Destinos, Tom de Voz (deixe vazio para raiz)" />
          <datalist id="${folderListId}">
            ${existingFolders.map(f => `<option value="${esc(f)}">`).join('')}
          </datalist>
        </div>

        <div class="form-group" style="margin:0;">
          <label class="form-label">Conteúdo *
            <span class="info-tip" title="Cole aqui o texto completo do documento. Pode ser um manual, guia, FAQ, regras, etc. Quanto mais contexto, melhor a IA responde.">ℹ</span>
          </label>
          <textarea class="form-textarea" id="kb-content" rows="14"
            placeholder="Cole aqui o conteúdo do documento...&#10;&#10;Pode ser texto de um manual, guia, FAQ, regras internas, etc.&#10;O conteúdo será usado como referência pelas skills de IA."
            style="font-family:monospace;font-size:0.8125rem;line-height:1.6;">${esc(doc?.content || '')}</textarea>
          <div id="kb-char-count" style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;text-align:right;">
            ${(doc?.content || '').length} caracteres · ~${Math.round((doc?.content || '').length / 4)} tokens
          </div>
        </div>

        <div class="form-group" style="margin:0;">
          <label class="form-label">Tags (separar por vírgula)</label>
          <input type="text" class="form-input" id="kb-tags" value="${esc((doc?.tags || []).join(', '))}"
            placeholder="tom-de-voz, redação, destinos" />
        </div>

        <div class="form-group" style="margin:0;">
          <label class="form-label">URL de referência (opcional)</label>
          <input type="text" class="form-input" id="kb-source-url" value="${esc(doc?.sourceUrl || '')}"
            placeholder="Link para o documento original, se houver" />
        </div>
      </div>
    `,
    footer: [
      { label: 'Cancelar', class: 'btn-secondary' },
      { label: isEdit ? 'Salvar' : 'Criar Documento', class: 'btn-primary', onClick: async (e, { close }) => {
        const title   = document.getElementById('kb-title')?.value?.trim();
        const content = document.getElementById('kb-content')?.value?.trim();
        if (!title) { toast.error('Título é obrigatório'); return; }
        if (!content) { toast.error('Conteúdo é obrigatório'); return; }

        const tags      = (document.getElementById('kb-tags')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
        const sourceUrl = document.getElementById('kb-source-url')?.value?.trim() || '';
        const folder    = document.getElementById('kb-folder')?.value?.trim() || '';

        try {
          if (isEdit) {
            await updateKnowledgeDoc(doc.id, { title, content, tags, sourceUrl, folder });
            toast.success('Documento atualizado!');
          } else {
            await createKnowledgeDoc({ title, content, type: 'text', tags, sourceUrl, folder });
            toast.success('Documento criado!');
          }
          close();
          await loadAll();
        } catch (err) {
          toast.error('Erro: ' + err.message);
        }
      }},
    ],
    onOpen: () => {
      // Live char/token counter
      document.getElementById('kb-content')?.addEventListener('input', (e) => {
        const len = e.target.value.length;
        const counter = document.getElementById('kb-char-count');
        if (counter) counter.textContent = `${len.toLocaleString('pt-BR')} caracteres · ~${Math.round(len / 4).toLocaleString('pt-BR')} tokens`;
      });
    },
  });
}

/* ═══════════════════════════════════════════════════════════ *
 *  TAB: Uso e Logs                                           *
 * ═══════════════════════════════════════════════════════════ */
async function renderLogsTab(el) {
  el.innerHTML = `<div class="card skeleton" style="height:200px;"></div>`;

  // Fetch last 50 usage logs
  const { getDocs: gd, query: q, collection: col, orderBy: ob, limit: lim }
    = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  const { db: fbdb } = await import('../firebase.js');

  let logs = [];
  try {
    const snap = await gd(q(col(fbdb, 'ai_usage_logs'), ob('timestamp', 'desc'), lim(50)));
    logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { logs = []; }

  if (!logs.length) {
    el.innerHTML = `<div class="empty-state" style="min-height:30vh;">
      <div class="empty-state-icon">◌</div>
      <div class="empty-state-title">Nenhum uso registrado</div>
      <p class="empty-state-sub">Os logs aparecerão aqui quando skills forem executadas.</p>
    </div>`;
    return;
  }

  // Stats summary
  const totalIn  = logs.reduce((s, l) => s + (l.inputTokens || 0), 0);
  const totalOut = logs.reduce((s, l) => s + (l.outputTokens || 0), 0);

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:20px;">
      <div class="card" style="padding:16px;text-align:center;">
        <div style="font-size:1.5rem;font-weight:700;color:var(--brand-gold);">${logs.length}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">Chamadas recentes</div>
      </div>
      <div class="card" style="padding:16px;text-align:center;">
        <div style="font-size:1.5rem;font-weight:700;color:var(--text-primary);">${(totalIn + totalOut).toLocaleString('pt-BR')}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">Tokens totais</div>
      </div>
      <div class="card" style="padding:16px;text-align:center;">
        <div style="font-size:1.5rem;font-weight:700;color:var(--text-primary);">${totalIn.toLocaleString('pt-BR')}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">Tokens input</div>
      </div>
      <div class="card" style="padding:16px;text-align:center;">
        <div style="font-size:1.5rem;font-weight:700;color:var(--text-primary);">${totalOut.toLocaleString('pt-BR')}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">Tokens output</div>
      </div>
    </div>

    <div class="card" style="padding:0;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;font-size:0.8125rem;">
        <thead>
          <tr style="background:var(--bg-surface);color:var(--text-muted);text-align:left;">
            <th style="padding:10px 14px;">Skill</th>
            <th style="padding:10px 14px;">Módulo</th>
            <th style="padding:10px 14px;">Provider</th>
            <th style="padding:10px 14px;">Modelo</th>
            <th style="padding:10px 14px;text-align:right;">Tokens</th>
            <th style="padding:10px 14px;">Data</th>
          </tr>
        </thead>
        <tbody>
          ${logs.map(l => {
            const ts = l.timestamp?.toDate ? l.timestamp.toDate() : null;
            const date = ts ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(ts) : '—';
            const modReg = MODULE_REGISTRY[l.module] || {};
            return `<tr style="border-top:1px solid var(--border-subtle);">
              <td style="padding:8px 14px;color:var(--text-primary);font-weight:500;">${esc(l.skillName || '—')}</td>
              <td style="padding:8px 14px;color:var(--text-secondary);">${modReg.icon || ''} ${esc(modReg.label || l.module || '—')}</td>
              <td style="padding:8px 14px;color:var(--text-secondary);">${esc(l.provider || '—')}</td>
              <td style="padding:8px 14px;color:var(--text-muted);font-family:monospace;font-size:0.75rem;">${esc(l.model || '—')}</td>
              <td style="padding:8px 14px;text-align:right;color:var(--text-secondary);">${((l.inputTokens||0)+(l.outputTokens||0)).toLocaleString('pt-BR')}</td>
              <td style="padding:8px 14px;color:var(--text-muted);">${date}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════ *
 *  TAB: Prompts por Módulo                                   *
 * ═══════════════════════════════════════════════════════════ */
async function renderHintsTab(el) {
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;
      flex-wrap:wrap;margin-bottom:20px;">
      <div style="max-width:640px;">
        <h3 style="margin:0 0 6px;font-size:1rem;color:var(--text-primary);">Prompts por Módulo</h3>
        <p style="margin:0;font-size:0.8125rem;color:var(--text-muted);line-height:1.55;">
          Cada módulo do sistema tem um prompt próprio que orienta a IA sobre formatos de campo,
          enums válidos e fluxos corretos. Edite aqui sem precisar mexer em código — mudanças
          entram em vigor na próxima mensagem do chat. Se algo der errado, use
          <strong>Restaurar padrão</strong> para voltar ao default.
        </p>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost" id="hints-import-defaults" style="font-size:0.8125rem;">
          ⤓ Importar defaults
        </button>
        <button class="btn btn-ghost" id="hints-refresh" style="font-size:0.8125rem;">
          ↻ Atualizar
        </button>
      </div>
    </div>

    <div id="hints-list" style="display:grid;gap:12px;">
      <div style="padding:40px;text-align:center;color:var(--text-muted);font-size:0.875rem;">
        Carregando prompts…
      </div>
    </div>
  `;

  // Handlers dos botões do cabeçalho
  document.getElementById('hints-refresh')?.addEventListener('click', () => loadHintsList());
  document.getElementById('hints-import-defaults')?.addEventListener('click', async () => {
    const confirmed = await new Promise(resolve => {
      modal.open({
        title: 'Importar defaults do código?',
        size: 'sm',
        content: `
          <p style="margin:0 0 12px;font-size:0.875rem;line-height:1.55;">
            Isso criará um documento no Firestore para cada módulo com o prompt default atual,
            permitindo que você os edite livremente.
          </p>
          <p style="margin:0 0 12px;font-size:0.8125rem;color:var(--text-muted);">
            <strong>Módulos já customizados NÃO serão sobrescritos</strong> — apenas os novos serão importados.
          </p>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
            <button class="btn btn-ghost" id="imp-cancel">Cancelar</button>
            <button class="btn btn-primary" id="imp-confirm">Importar</button>
          </div>
        `,
        onOpen: () => {
          document.getElementById('imp-cancel')?.addEventListener('click', () => { modal.close(); resolve(false); });
          document.getElementById('imp-confirm')?.addEventListener('click', () => { modal.close(); resolve(true); });
        },
      });
    });
    if (!confirmed) return;

    try {
      const { importDefaultHints } = await import('../services/aiModuleHints.js');
      const result = await importDefaultHints({ overwrite: false });
      toast.success(`Importação concluída: ${result.imported} importado(s), ${result.skipped} já existiam.`);
      loadHintsList();
    } catch (e) {
      toast.error('Erro ao importar: ' + (e?.message || e));
    }
  });

  await loadHintsList();
}

async function loadHintsList() {
  const listEl = document.getElementById('hints-list');
  if (!listEl) return;
  try {
    const { listAllModuleHints, invalidateCache } = await import('../services/aiModuleHints.js');
    invalidateCache();
    allModuleHints = await listAllModuleHints();
  } catch (e) {
    listEl.innerHTML = `<div style="padding:20px;color:var(--danger);font-size:0.875rem;">
      Erro ao carregar: ${esc(e?.message || e)}
    </div>`;
    return;
  }

  if (!allModuleHints.length) {
    listEl.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-muted);font-size:0.875rem;">
      Nenhum módulo encontrado.
    </div>`;
    return;
  }

  listEl.innerHTML = allModuleHints.map(h => {
    const statusBadge = h.isCustom
      ? `<span style="font-size:0.6875rem;padding:2px 8px;border-radius:999px;
          background:rgba(16,185,129,0.15);color:#10b981;font-weight:600;">Customizado</span>`
      : (h.hasDefault
          ? `<span style="font-size:0.6875rem;padding:2px 8px;border-radius:999px;
              background:rgba(148,163,184,0.15);color:var(--text-muted);font-weight:600;">Default</span>`
          : `<span style="font-size:0.6875rem;padding:2px 8px;border-radius:999px;
              background:rgba(239,68,68,0.15);color:#ef4444;font-weight:600;">Sem prompt</span>`);
    const preview = (h.effectiveHint || '').substring(0, 140).replace(/\n/g, ' ');
    return `
      <div class="hint-card" data-module-id="${esc(h.moduleId)}"
        style="padding:14px 16px;background:var(--bg-surface);border:1px solid var(--border-subtle);
        border-radius:10px;cursor:pointer;transition:all 0.15s;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:10px;min-width:0;">
            <span style="font-size:1.125rem;">${esc(h.icon)}</span>
            <strong style="font-size:0.9375rem;color:var(--text-primary);">${esc(h.label)}</strong>
            <span style="font-size:0.6875rem;color:var(--text-muted);font-family:monospace;">${esc(h.moduleId)}</span>
          </div>
          ${statusBadge}
        </div>
        <div style="font-size:0.8125rem;color:var(--text-muted);line-height:1.5;">
          ${preview ? esc(preview) + (h.effectiveHint.length > 140 ? '…' : '') : '<em>(vazio)</em>'}
        </div>
      </div>
    `;
  }).join('');

  // Click → abrir editor
  listEl.querySelectorAll('.hint-card').forEach(card => {
    card.addEventListener('mouseenter', () => {
      card.style.borderColor = 'var(--brand-gold)';
      card.style.transform = 'translateY(-1px)';
    });
    card.addEventListener('mouseleave', () => {
      card.style.borderColor = 'var(--border-subtle)';
      card.style.transform = 'translateY(0)';
    });
    card.addEventListener('click', () => {
      const moduleId = card.dataset.moduleId;
      const hint = allModuleHints.find(h => h.moduleId === moduleId);
      if (hint) openHintEditor(hint);
    });
  });
}

function openHintEditor(hint) {
  const { moduleId, label, icon, defaultHint, customHint, isCustom } = hint;
  const currentText = customHint || defaultHint || '';

  modal.open({
    title: `${icon} ${label}`,
    size: 'lg',
    content: `
      <div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div style="font-size:0.8125rem;color:var(--text-muted);">
          <span style="font-family:monospace;">${esc(moduleId)}</span>
          ${isCustom ? '<span style="margin-left:8px;color:#10b981;font-weight:600;">● Customizado</span>'
                    : '<span style="margin-left:8px;">usando default</span>'}
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-ghost" id="hint-preview-btn" style="font-size:0.75rem;">
            ⎋ Testar prompt
          </button>
          ${isCustom ? `<button class="btn btn-ghost" id="hint-reset-btn" style="font-size:0.75rem;color:#ef4444;">
            ⟲ Restaurar padrão
          </button>` : ''}
        </div>
      </div>

      <label style="display:block;font-size:0.75rem;color:var(--text-muted);margin-bottom:6px;font-weight:600;">
        Prompt do módulo (texto injetado no system prompt)
      </label>
      <textarea id="hint-textarea" rows="22"
        style="width:100%;padding:12px;background:var(--bg-base);border:1px solid var(--border-subtle);
        border-radius:8px;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:0.8125rem;
        color:var(--text-primary);line-height:1.55;resize:vertical;">${esc(currentText)}</textarea>

      ${!isCustom && defaultHint ? `
        <div style="margin-top:10px;padding:10px 12px;background:rgba(245,158,11,0.08);
          border-left:3px solid var(--brand-gold);border-radius:6px;font-size:0.75rem;color:var(--text-muted);line-height:1.55;">
          ⓘ Este módulo está usando o default hardcoded. Ao salvar, uma versão customizada será criada no Firestore
          e passará a ter prioridade sobre o default.
        </div>
      ` : ''}

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;padding-top:16px;border-top:1px solid var(--border-subtle);">
        <button class="btn btn-ghost" id="hint-cancel-btn">Cancelar</button>
        <button class="btn btn-primary" id="hint-save-btn">Salvar</button>
      </div>
    `,
    onOpen: () => {
      document.getElementById('hint-cancel-btn')?.addEventListener('click', () => modal.close());

      document.getElementById('hint-save-btn')?.addEventListener('click', async () => {
        const text = document.getElementById('hint-textarea')?.value || '';
        try {
          const { saveModuleHint } = await import('../services/aiModuleHints.js');
          await saveModuleHint(moduleId, text);
          toast.success(`Prompt de "${label}" salvo!`);
          modal.close();
          loadHintsList();
        } catch (e) {
          toast.error('Erro ao salvar: ' + (e?.message || e));
        }
      });

      document.getElementById('hint-reset-btn')?.addEventListener('click', async () => {
        if (!confirm(`Restaurar o prompt padrão de "${label}"? Sua versão customizada será apagada.`)) return;
        try {
          const { resetModuleHint } = await import('../services/aiModuleHints.js');
          await resetModuleHint(moduleId);
          toast.success('Prompt restaurado para o padrão!');
          modal.close();
          loadHintsList();
        } catch (e) {
          toast.error('Erro ao restaurar: ' + (e?.message || e));
        }
      });

      document.getElementById('hint-preview-btn')?.addEventListener('click', async () => {
        // Salvar temporariamente o texto do textarea para preview
        const currentText = document.getElementById('hint-textarea')?.value || '';
        try {
          const { previewSystemPrompt } = await import('../services/aiModuleHints.js');
          // Se o usuário editou mas não salvou, usar o texto do textarea como preview
          const preview = await previewSystemPrompt(moduleId);
          // Substituir a seção do hint pelo texto atual do textarea
          let fullPrompt = preview.fullPrompt;
          if (currentText && currentText !== (customHint || defaultHint)) {
            // Substituir pelo texto editado
            fullPrompt = fullPrompt.replace(
              (customHint || defaultHint || ''),
              currentText + '\n[⚠ ALTERAÇÃO NÃO SALVA — este preview reflete o texto atual do editor]'
            );
          }
          openPromptPreviewModal(label, preview.hintSource, fullPrompt);
        } catch (e) {
          toast.error('Erro no preview: ' + (e?.message || e));
        }
      });
    },
  });
}

function openPromptPreviewModal(label, hintSource, fullPrompt) {
  modal.open({
    title: `Preview — ${label}`,
    size: 'xl',
    content: `
      <div style="margin-bottom:10px;font-size:0.75rem;color:var(--text-muted);">
        Fonte do hint: <strong>${esc(hintSource)}</strong> ·
        Tamanho total: <strong>${fullPrompt.length}</strong> chars ·
        <strong>${fullPrompt.split(/\s+/).length}</strong> tokens aprox.
      </div>
      <pre style="max-height:60vh;overflow:auto;padding:14px;background:var(--bg-base);
        border:1px solid var(--border-subtle);border-radius:8px;font-family:ui-monospace,Menlo,monospace;
        font-size:0.75rem;line-height:1.5;color:var(--text-primary);white-space:pre-wrap;word-wrap:break-word;">${esc(fullPrompt)}</pre>
      <div style="display:flex;justify-content:flex-end;margin-top:12px;">
        <button class="btn btn-ghost" id="preview-close">Fechar</button>
      </div>
    `,
    onOpen: () => {
      document.getElementById('preview-close')?.addEventListener('click', () => modal.close());
    },
  });
}

/* ═══════════════════════════════════════════════════════════ *
 *  Modal: Criar / Editar Skill                               *
 * ═══════════════════════════════════════════════════════════ */
function openSkillModal(skill = null) {
  const isEdit = !!skill;
  const provider = skill?.provider || 'gemini';
  const models = getModelsForProvider(provider);

  modal.open({
    title: isEdit ? 'Editar Skill' : 'Nova Skill de IA',
    size: 'lg',
    content: buildSkillForm(skill),
    footer: [
      { label: 'Cancelar', class: 'btn-secondary' },
      { label: isEdit ? 'Salvar' : 'Criar Skill', class: 'btn-primary', onClick: async (e, { close }) => {
        try {
          const data = collectSkillForm();
          if (!data.name) { toast.error('Nome é obrigatório'); return; }
          if (!data.module) { toast.error('Selecione um módulo'); return; }
          if (!data.systemPrompt && !data.userPromptTemplate) { toast.error('Preencha ao menos o System Prompt ou Template do Prompt'); return; }

          if (isEdit) {
            await updateSkill(skill.id, data);
            toast.success('Skill atualizada!');
          } else {
            await createSkill(data);
            toast.success('Skill criada!');
          }
          close();
          await loadAll();
        } catch (err) {
          toast.error('Erro: ' + err.message);
        }
      }},
    ],
    onOpen: () => bindSkillFormEvents(),
  });
}

/* Explicações amigáveis para cada variável de contexto */
const VAR_EXPLANATIONS = {
  title:         'Título do item (tarefa, dica, projeto...)',
  description:   'Descrição ou texto principal do item',
  body:          'Corpo/conteúdo completo do texto',
  type:          'Tipo ou categoria do item',
  typeName:      'Nome do tipo de tarefa',
  status:        'Status atual (aberto, em andamento, concluído...)',
  assignee:      'Pessoa responsável pelo item',
  deadline:      'Data limite / prazo de entrega',
  sector:        'Setor responsável',
  priority:      'Nível de prioridade',
  variationName: 'Nome da variação do tipo de tarefa',
  nucleo:        'Núcleo responsável dentro do setor',
  category:      'Categoria do item',
  destination:   'Destino turístico (Portal de Dicas)',
  area:          'Área ou departamento',
  lastUpdated:   'Data da última atualização',
  metrics:       'Dados numéricos e métricas do período',
  period:        'Período de análise selecionado',
  chartData:     'Dados dos gráficos exibidos',
  filters:       'Filtros ativos no momento',
  summary:       'Resumo geral dos dados',
  card:          'Dados do card no kanban',
  column:        'Coluna atual no kanban',
  project:       'Projeto vinculado',
  requester:     'Nome de quem solicitou',
  desiredDate:   'Data desejada para entrega',
  topic:         'Tema ou assunto da busca',
  sources:       'Fontes de informação configuradas',
  currentFeed:   'Conteúdo atual do feed',
  keywords:      'Palavras-chave para busca',
  feedbackText:  'Texto do feedback recebido',
  audioUrl:      'URL do áudio anexado',
  rating:        'Nota ou avaliação dada',
  customer:      'Cliente que deu o feedback',
  surveyData:    'Dados da pesquisa CSAT',
  responses:     'Respostas coletadas',
  score:         'Pontuação/score calculado',
  goal:          'Objetivo ou meta definida',
  keyResults:    'Resultados-chave da meta (OKR)',
  progress:      'Percentual de progresso',
  name:          'Nome do item',
  tasks:         'Lista de tarefas vinculadas',
  members:       'Membros da equipe',
  channel:       'Canal de publicação (Instagram, blog, e-mail...)',
  audience:      'Público-alvo do conteúdo',
  brief:         'Briefing ou instruções do conteúdo',
  previousPosts: 'Últimas publicações feitas',
  calendar:      'Calendário editorial',
  objectives:    'Objetivos de comunicação',
  events:        'Eventos no calendário',
  page:          'Página ou seção do site',
  content:       'Conteúdo da página',
  seo:           'Dados de SEO (título, meta, keywords)',
  images:        'Imagens vinculadas',
  cta:           'Call-to-action da página',
  design:        'Dados do design/layout',
  template:      'Template selecionado',
  text:          'Texto do elemento',
  brand:         'Identidade visual / marca',
  input:         'Texto livre digitado pelo usuário',
};

function getVarExplanation(field) {
  return VAR_EXPLANATIONS[field] || 'Dado do módulo';
}

function buildSkillForm(s = null) {
  const moduleOptions = Object.entries(MODULE_REGISTRY)
    .map(([id, m]) => `<option value="${id}" ${s?.module === id ? 'selected' : ''}>${m.icon} ${m.label}</option>`)
    .join('');

  const providerOptions = AI_PROVIDERS
    .map(p => `<option value="${p.id}" ${(s?.provider || 'gemini') === p.id ? 'selected' : ''}>${p.label}${p.free ? ' (grátis)' : ''}</option>`)
    .join('');

  const currentProvider = s?.provider || 'gemini';
  const modelOptions = getModelsForProvider(currentProvider)
    .map(m => `<option value="${m.id}" ${s?.model === m.id ? 'selected' : ''}>${m.label} — ${m.desc}</option>`)
    .join('');

  const outputOptions = OUTPUT_FORMATS
    .map(f => `<option value="${f.id}" ${(s?.outputFormat || 'text') === f.id ? 'selected' : ''}>${f.label}</option>`)
    .join('');

  const triggerOptions = TRIGGER_TYPES
    .map(t => `<option value="${t.id}" ${(s?.trigger || 'button') === t.id ? 'selected' : ''}>${t.label}</option>`)
    .join('');

  // Context fields for selected module
  const modFields = s?.module ? (MODULE_REGISTRY[s.module]?.contextFields || []) : [];

  return `
    <div style="display:flex;flex-direction:column;gap:16px;max-height:70vh;overflow-y:auto;padding:4px;">
      <!-- Identificação -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group" style="margin:0;">
          <label class="form-label">Nome da Skill *</label>
          <input type="text" class="form-input" id="sk-name" value="${esc(s?.name || '')}"
            placeholder="Ex: Sugerir texto para dica" />
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label">Módulo *</label>
          <select class="form-select" id="sk-module">
            <option value="">Selecione...</option>
            ${moduleOptions}
          </select>
        </div>
      </div>

      <div class="form-group" style="margin:0;">
        <label class="form-label">Descrição</label>
        <input type="text" class="form-input" id="sk-description" value="${esc(s?.description || '')}"
          placeholder="Breve descrição do que esta skill faz" />
      </div>

      <!-- Provider & Model -->
      <div style="border:1px solid var(--border-subtle);border-radius:8px;padding:14px;">
        <div style="font-weight:600;font-size:0.8125rem;color:var(--text-muted);margin-bottom:10px;">PROVIDER E MODELO</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group" style="margin:0;">
            <label class="form-label">Provider</label>
            <select class="form-select" id="sk-provider">
              ${providerOptions}
            </select>
          </div>
          <div class="form-group" style="margin:0;">
            <label class="form-label">Modelo</label>
            <select class="form-select" id="sk-model">
              ${modelOptions}
            </select>
          </div>
        </div>
      </div>

      <!-- Prompt Engineering -->
      <div style="border:1px solid var(--border-subtle);border-radius:8px;padding:14px;">
        <div style="font-weight:600;font-size:0.8125rem;color:var(--text-muted);margin-bottom:10px;">ENGENHARIA DE PROMPT</div>

        <div class="form-group" style="margin:0 0 12px 0;">
          <label class="form-label">System Prompt
            <span class="info-tip" title="Instruções gerais para a IA: persona, regras, limites. Este texto é enviado como contexto do sistema e define o comportamento da IA.">ℹ</span>
          </label>
          <textarea class="form-textarea" id="sk-system-prompt" rows="5"
            placeholder="Ex: Você é um redator profissional de turismo da Primetour. Escreva textos engajadores, informativos e com tom acolhedor."
            style="font-family:monospace;font-size:0.8125rem;line-height:1.6;">${esc(s?.systemPrompt || '')}</textarea>
        </div>

        <div class="form-group" style="margin:0 0 12px 0;">
          <label class="form-label">Template do Prompt
            <span class="info-tip" title="Monte a instrução que será enviada à IA. Use as variáveis abaixo para puxar dados automaticamente do módulo.">ℹ</span>
          </label>
          <textarea class="form-textarea" id="sk-user-prompt" rows="4"
            placeholder="Ex: Reescreva o texto abaixo mantendo as informações, mas com linguagem mais engajadora:&#10;&#10;{{body}}"
            style="font-family:monospace;font-size:0.8125rem;line-height:1.6;">${esc(s?.userPromptTemplate || '')}</textarea>
        </div>

        <!-- Variáveis do módulo com explicação -->
        <div id="sk-context-hint" style="font-size:0.75rem;color:var(--text-muted);background:var(--bg-surface);
          padding:10px 12px;border-radius:6px;margin-bottom:12px;${modFields.length ? '' : 'display:none;'}">
          <div style="font-weight:600;margin-bottom:6px;color:var(--text-secondary);">Variáveis disponíveis (clique para inserir no template):</div>
          <div id="sk-vars-list" style="display:flex;flex-wrap:wrap;gap:4px;">
            ${modFields.map(f => `<code class="sk-var-btn" data-var="${f}" style="background:var(--bg-dark);padding:3px 8px;border-radius:4px;cursor:pointer;
              border:1px solid var(--border-subtle);transition:all 0.15s;"
              title="${getVarExplanation(f)}">{{${f}}}</code>`).join('')}
          </div>
        </div>

        <!-- Tom de voz vinculado à base de conhecimento -->
        <div class="form-group" style="margin:0 0 12px 0;">
          <label class="form-label">Tom de voz / Manual de redação
            <span class="info-tip" title="Selecione um documento da Base de Conhecimento que define o tom de voz, estilo e regras de redação. A IA usará como referência obrigatória.">ℹ</span>
          </label>
          <select class="form-select" id="sk-voice-doc">
            <option value="">Nenhum (sem referência de tom)</option>
            ${allKnowledge.map(d => `<option value="${d.id}" ${s?.voiceDocId === d.id ? 'selected' : ''}>📄 ${esc(d.title)}</option>`).join('')}
          </select>
          ${!allKnowledge.length ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;font-style:italic;">
            Nenhum documento disponível. Crie um manual de redação na aba "Base de Conhecimento".
          </div>` : ''}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group" style="margin:0;">
            <label class="form-label">Temperatura
              <span class="info-tip" title="Controla a criatividade da IA.&#10;&#10;0.0 = Respostas mais previsíveis e consistentes. Ideal para análise de dados, classificação e respostas factuais.&#10;&#10;0.5 = Equilíbrio entre criatividade e consistência. Bom para a maioria dos casos.&#10;&#10;1.0 = Respostas mais criativas e variadas. Ideal para redação criativa, brainstorming e geração de ideias.&#10;&#10;Dica: comece com 0.5 e ajuste conforme o resultado.">ℹ</span>
            </label>
            <input type="number" class="form-input" id="sk-temperature" value="${s?.temperature ?? ''}"
              placeholder="0.0 a 1.0 (padrão: 0.5)" min="0" max="1" step="0.1" />
          </div>
          <div class="form-group" style="margin:0;">
            <label class="form-label">Max tokens
              <span class="info-tip" title="Limite máximo de tokens na resposta da IA. 1 token ≈ 4 caracteres. Ex: 1024 tokens ≈ 4000 caracteres (~1 página).">ℹ</span>
            </label>
            <input type="number" class="form-input" id="sk-max-tokens" value="${s?.maxTokens || ''}"
              placeholder="Padrão: 1024" min="100" max="16000" />
          </div>
        </div>
      </div>

      <!-- Comportamento -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group" style="margin:0;">
          <label class="form-label">Formato de saída</label>
          <select class="form-select" id="sk-output-format">${outputOptions}</select>
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label">Gatilho</label>
          <select class="form-select" id="sk-trigger">${triggerOptions}</select>
        </div>
      </div>

      <!-- Base de Conhecimento -->
      <div style="border:1px solid var(--border-subtle);border-radius:8px;padding:14px;">
        <div style="font-weight:600;font-size:0.8125rem;color:var(--text-muted);margin-bottom:10px;">BASE DE CONHECIMENTO</div>
        <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:10px;">
          Selecione documentos que serão injetados como contexto quando esta skill for executada.
        </p>
        ${allKnowledge.length ? `
          <div id="sk-knowledge-list" style="display:flex;flex-direction:column;gap:6px;max-height:180px;overflow-y:auto;">
            ${allKnowledge.map(d => {
              const checked = s?.knowledgeIds?.includes(d.id) ? 'checked' : '';
              const chars = d.charCount || d.content?.length || 0;
              return `<label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;
                cursor:pointer;background:var(--bg-surface);font-size:0.8125rem;">
                <input type="checkbox" class="sk-kb-check" value="${d.id}" ${checked} />
                <span style="flex:1;color:var(--text-primary);">📄 ${esc(d.title)}</span>
                <span style="font-size:0.6875rem;color:var(--text-muted);">~${Math.round(chars/4).toLocaleString('pt-BR')} tokens</span>
              </label>`;
            }).join('')}
          </div>
        ` : `<div style="font-size:0.8125rem;color:var(--text-muted);font-style:italic;">
          Nenhum documento disponível. Crie documentos na aba "Base de Conhecimento".
        </div>`}
      </div>

      <!-- Busca na Web (Gemini Grounding) -->
      <div style="border:1px solid var(--border-subtle);border-radius:8px;padding:14px;">
        <div style="font-weight:600;font-size:0.8125rem;color:var(--text-muted);margin-bottom:10px;">BUSCA NA WEB</div>
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
          <input type="checkbox" id="sk-web-search" ${s?.webSearch ? 'checked' : ''} />
          <div>
            <div style="font-size:0.875rem;color:var(--text-primary);">Habilitar Gemini Grounding</div>
            <div style="font-size:0.75rem;color:var(--text-muted);">A IA pesquisa no Google antes de responder. Funciona apenas com provider Gemini. As fontes são citadas automaticamente.</div>
          </div>
        </label>
      </div>

      <!-- Fontes autorizadas -->
      <div class="form-group" style="margin:0;">
        <label class="form-label">Fontes autorizadas
          <span class="info-tip" title="Lista de fontes que a IA pode referenciar. Deixe vazio para não restringir.">ℹ</span>
        </label>
        <input type="text" class="form-input" id="sk-sources" value="${esc((s?.allowedSources || []).join(', '))}"
          placeholder="site-primetour.com.br, embratur.com.br (separar por vírgula)" />
      </div>

      <!-- Status -->
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
        <input type="checkbox" id="sk-active" ${s?.active !== false ? 'checked' : ''} />
        <span style="font-size:0.875rem;color:var(--text-primary);">Skill ativa</span>
      </label>
    </div>
  `;
}

function bindSkillFormEvents() {
  // Provider change → update model list
  document.getElementById('sk-provider')?.addEventListener('change', (e) => {
    const models = getModelsForProvider(e.target.value);
    const modelSelect = document.getElementById('sk-model');
    if (modelSelect) {
      modelSelect.innerHTML = models.map(m =>
        `<option value="${m.id}">${m.label} — ${m.desc}</option>`
      ).join('');
    }
  });

  // Module change → show context fields with explanations
  document.getElementById('sk-module')?.addEventListener('change', (e) => {
    const hint = document.getElementById('sk-context-hint');
    const varsList = document.getElementById('sk-vars-list');
    const fields = MODULE_REGISTRY[e.target.value]?.contextFields || [];
    if (hint) {
      if (fields.length) {
        hint.style.display = '';
        if (varsList) {
          varsList.innerHTML = fields.map(f =>
            `<code class="sk-var-btn" data-var="${f}" style="background:var(--bg-dark);padding:3px 8px;border-radius:4px;cursor:pointer;
              border:1px solid var(--border-subtle);transition:all 0.15s;"
              title="${getVarExplanation(f)}">{{${f}}}</code>`
          ).join('');
          bindVarButtons();
        }
      } else {
        hint.style.display = 'none';
      }
    }
  });

  // Bind initial variable buttons
  bindVarButtons();
}

function bindVarButtons() {
  document.querySelectorAll('.sk-var-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const textarea = document.getElementById('sk-user-prompt');
      if (!textarea) return;
      const varName = btn.dataset.var;
      const pos = textarea.selectionStart || textarea.value.length;
      const before = textarea.value.substring(0, pos);
      const after = textarea.value.substring(pos);
      textarea.value = before + `{{${varName}}}` + after;
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = pos + varName.length + 4;
    });
    // Hover effect
    btn.addEventListener('mouseenter', () => { btn.style.borderColor = 'var(--brand-gold)'; btn.style.color = 'var(--brand-gold)'; });
    btn.addEventListener('mouseleave', () => { btn.style.borderColor = 'var(--border-subtle)'; btn.style.color = ''; });
  });
}

function collectSkillForm() {
  const temperature = parseFloat(document.getElementById('sk-temperature')?.value);
  const maxTokens = parseInt(document.getElementById('sk-max-tokens')?.value);
  const sources = document.getElementById('sk-sources')?.value?.trim();

  return {
    name:               document.getElementById('sk-name')?.value?.trim() || '',
    module:             document.getElementById('sk-module')?.value || '',
    description:        document.getElementById('sk-description')?.value?.trim() || '',
    provider:           document.getElementById('sk-provider')?.value || 'gemini',
    model:              document.getElementById('sk-model')?.value || '',
    systemPrompt:       document.getElementById('sk-system-prompt')?.value?.trim() || '',
    userPromptTemplate: document.getElementById('sk-user-prompt')?.value?.trim() || '',
    voiceDocId:         document.getElementById('sk-voice-doc')?.value || '',
    temperature:        isNaN(temperature) ? null : temperature,
    maxTokens:          isNaN(maxTokens) ? null : maxTokens,
    outputFormat:       document.getElementById('sk-output-format')?.value || 'text',
    trigger:            document.getElementById('sk-trigger')?.value || 'button',
    allowedSources:     sources ? sources.split(',').map(s => s.trim()).filter(Boolean) : [],
    knowledgeIds:       [...document.querySelectorAll('.sk-kb-check:checked')].map(cb => cb.value),
    webSearch:          document.getElementById('sk-web-search')?.checked || false,
    active:             document.getElementById('sk-active')?.checked !== false,
  };
}

/* ═══════════════════════════════════════════════════════════ *
 *  Modal: Testar Skill                                       *
 * ═══════════════════════════════════════════════════════════ */
function openTestModal(skillId) {
  const skill = allSkills.find(s => s.id === skillId);
  if (!skill) return;

  const fields = MODULE_REGISTRY[skill.module]?.contextFields || ['input'];

  modal.open({
    title: `Testar: ${skill.name}`,
    size: 'lg',
    content: `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div style="font-size:0.8125rem;color:var(--text-muted);">
          Preencha os campos de contexto e clique em "Executar" para testar a skill.
        </div>
        ${fields.map(f => `
          <div class="form-group" style="margin:0;">
            <label class="form-label" style="font-size:0.8125rem;">{{${f}}}</label>
            <textarea class="form-textarea sk-test-field" data-field="${f}" rows="2"
              placeholder="Valor para {{${f}}}"
              style="font-size:0.8125rem;"></textarea>
          </div>
        `).join('')}
        <button class="btn btn-primary" id="sk-test-run" style="align-self:flex-start;">
          ▶ Executar skill
        </button>
        <div id="sk-test-result" style="display:none;border:1px solid var(--border-subtle);
          border-radius:8px;padding:16px;background:var(--bg-surface);
          font-size:0.875rem;line-height:1.7;white-space:pre-wrap;max-height:400px;overflow-y:auto;">
        </div>
        <div id="sk-test-meta" style="display:none;font-size:0.75rem;color:var(--text-muted);"></div>
      </div>
    `,
    footer: [{ label: 'Fechar', class: 'btn-secondary' }],
    onOpen: () => {
      document.getElementById('sk-test-run')?.addEventListener('click', async () => {
        const btn = document.getElementById('sk-test-run');
        const resultEl = document.getElementById('sk-test-result');
        const metaEl = document.getElementById('sk-test-meta');
        if (!btn || !resultEl) return;

        // Collect context
        const context = {};
        document.querySelectorAll('.sk-test-field').forEach(el => {
          context[el.dataset.field] = el.value;
        });

        btn.disabled = true;
        btn.textContent = 'Processando...';
        resultEl.style.display = 'block';
        resultEl.textContent = 'Aguardando resposta da IA...';
        resultEl.style.opacity = '0.5';

        try {
          const result = await runSkill(skillId, context);
          resultEl.style.opacity = '1';
          resultEl.textContent = result.text;
          if (metaEl) {
            metaEl.style.display = 'block';
            metaEl.textContent = `${result.isMock ? 'MOCK' : result.provider} · ${result.model} · ${result.inputTokens + result.outputTokens} tokens`;
          }
        } catch (err) {
          resultEl.style.opacity = '1';
          resultEl.style.color = 'var(--danger, #ef4444)';
          resultEl.textContent = 'Erro: ' + err.message;
        }

        btn.disabled = false;
        btn.textContent = '▶ Executar skill';
      });
    },
  });
}

export function destroyAiSkills() { /* cleanup if needed */ }
