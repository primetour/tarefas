/**
 * PRIMETOUR — IA Hub
 *
 * Página única que substitui IA Skills + Automações IA + Dashboard IA.
 * Conceito de Agente unificado.
 *
 * Tabs:
 *   Agentes      — CRUD + cards visuais com avatar
 *   API Keys     — chaves por escopo (global/workspace/setor/usuário)
 *   Conhecimento — base RAG (texto/url/R2/SharePoint/.md upload)
 *   Logs         — histórico de execuções por agente
 *   Custos       — dashboard de uso (tokens, custo estimado)
 *   Migração     — botão pra importar legado (skills + automações)
 */
import { store }   from '../store.js';
import { toast }   from '../components/toast.js';
import { modal }   from '../components/modal.js';
import {
  fetchAgents, subscribeAgents, getAgent, createAgent, updateAgent,
  deleteAgent, toggleAgent, uploadAgentAvatar, runAgent,
  migrateLegacyToAgents, purgeLegacyCollections,
  AGENT_DEFAULTS,
} from '../services/agents.js?v=20260501t';
import {
  AI_PROVIDERS, AI_MODELS, getModelsForProvider, MODULE_REGISTRY,
  fetchKnowledge, createKnowledgeDoc, updateKnowledgeDoc, deleteKnowledgeDoc,
  listAllScopedConfigs, saveScopedApiConfig, deleteScopedApiConfig,
} from '../services/ai.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let _activeTab = 'agents';
let _unsubAgents = null;

export async function renderAiHub(container) {
  if (!store.isMaster() && !store.can('system_manage_settings')) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
      <p class="text-sm text-muted">Apenas admin/master pode gerenciar a IA Hub.</p>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">◈ IA Hub</h1>
        <p class="page-subtitle">Agentes, conhecimento, automações e logs de IA — tudo num só lugar</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary" id="hub-new-agent">+ Novo agente</button>
      </div>
    </div>

    <div style="display:flex;gap:0;margin-bottom:24px;border-bottom:1px solid var(--border-subtle);overflow-x:auto;">
      ${[
        { id:'agents',     label:'Agentes',      icon:'◈' },
        { id:'apikeys',    label:'API Keys',     icon:'⚿' },
        { id:'knowledge',  label:'Conhecimento', icon:'📚' },
        { id:'logs',       label:'Logs',         icon:'⌚' },
        { id:'costs',      label:'Custos',       icon:'$' },
        { id:'migration',  label:'Migração',     icon:'↻' },
      ].map(t => `
        <button class="hub-tab-btn" data-tab="${t.id}" style="padding:10px 18px;border:none;
          background:none;cursor:pointer;font-size:0.875rem;
          color:${_activeTab===t.id?'var(--brand-gold)':'var(--text-muted)'};
          border-bottom:2px solid ${_activeTab===t.id?'var(--brand-gold)':'transparent'};
          transition:all .15s;white-space:nowrap;">
          ${t.icon} ${t.label}
        </button>
      `).join('')}
    </div>

    <div id="hub-content">
      <div class="card skeleton" style="height:300px;"></div>
    </div>
  `;

  container.querySelectorAll('.hub-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeTab = btn.dataset.tab;
      container.querySelectorAll('.hub-tab-btn').forEach(b => {
        b.style.color = b.dataset.tab === _activeTab ? 'var(--brand-gold)' : 'var(--text-muted)';
        b.style.borderColor = b.dataset.tab === _activeTab ? 'var(--brand-gold)' : 'transparent';
      });
      loadTab();
    });
  });
  document.getElementById('hub-new-agent')?.addEventListener('click', () => openAgentEditor(null));

  loadTab();
}

function loadTab() {
  const el = document.getElementById('hub-content');
  if (!el) return;
  if (_unsubAgents) { _unsubAgents(); _unsubAgents = null; }
  el.innerHTML = '<div class="chart-loading"><div class="chart-loading-spinner"></div></div>';
  if (_activeTab === 'agents')         renderAgentsTab(el);
  else if (_activeTab === 'apikeys')   renderApiKeysTab(el);
  else if (_activeTab === 'knowledge') renderKnowledgeTab(el);
  else if (_activeTab === 'logs')      renderLogsTab(el);
  else if (_activeTab === 'costs')     renderCostsTab(el);
  else if (_activeTab === 'migration') renderMigrationTab(el);
}

/* ═══════════════════════════════════════════════════════════
 * TAB: AGENTES (cards com avatar)
 * ═══════════════════════════════════════════════════════════ */
function renderAgentsTab(container) {
  _unsubAgents = subscribeAgents((agents, err) => {
    if (err) {
      container.innerHTML = `<p style="color:var(--color-danger);padding:24px;">Erro: ${esc(err.message)}</p>`;
      return;
    }
    if (!agents.length) {
      container.innerHTML = `
        <div class="empty-state" style="min-height:40vh;">
          <div class="empty-state-icon">◈</div>
          <div class="empty-state-title">Nenhum agente criado</div>
          <p class="text-sm text-muted">Crie seu primeiro agente clicando em "+ Novo agente" no topo.</p>
          <p class="text-sm text-muted" style="margin-top:8px;">
            Tem skills/automações antigas? Vá na aba <strong>Migração</strong> pra importar.
          </p>
        </div>`;
      return;
    }
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;">
        ${agents.map(a => renderAgentCard(a)).join('')}
      </div>
    `;
    container.querySelectorAll('[data-act="edit"]').forEach(btn =>
      btn.addEventListener('click', () => openAgentEditor(btn.dataset.id)));
    container.querySelectorAll('[data-act="toggle"]').forEach(btn =>
      btn.addEventListener('click', async () => {
        try {
          await toggleAgent(btn.dataset.id, btn.dataset.active === 'false');
          toast.success('Status alterado.');
        } catch (e) { toast.error(e.message); }
      }));
    container.querySelectorAll('[data-act="run"]').forEach(btn =>
      btn.addEventListener('click', () => openAgentRunModal(btn.dataset.id)));
    container.querySelectorAll('[data-act="delete"]').forEach(btn =>
      btn.addEventListener('click', async () => {
        if (!confirm('Excluir este agente? Logs ficam, mas o agente desaparece.')) return;
        try { await deleteAgent(btn.dataset.id); toast.success('Excluído.'); }
        catch (e) { toast.error(e.message); }
      }));
  });
}

function renderAgentCard(a) {
  const provider = AI_PROVIDERS.find(p => p.id === a.provider)?.label || a.provider;
  const moduleLabel = MODULE_REGISTRY[a.module]?.label || a.module;
  const triggers = [];
  if (a.triggers?.button?.enabled)    triggers.push('▶ Botão');
  if (a.triggers?.context?.enabled)   triggers.push('⊞ Contexto');
  if (a.triggers?.schedule?.enabled)  triggers.push(`⏰ ${a.triggers.schedule.preset || 'cron'}`);
  if (a.triggers?.publicChat?.enabled)triggers.push('🌐 Público');

  const avatar = a.avatarUrl
    ? `<img src="${esc(a.avatarUrl)}" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:2px solid var(--border-subtle);" />`
    : `<div style="width:48px;height:48px;border-radius:50%;background:var(--bg-surface);display:flex;align-items:center;justify-content:center;font-size:1.5rem;border:2px solid var(--border-subtle);">${esc(a.icon || '◈')}</div>`;

  return `<div class="card" style="padding:14px;${a.active===false?'opacity:0.55;':''}">
    <div style="display:flex;gap:12px;align-items:start;margin-bottom:10px;">
      ${avatar}
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;">
          <strong style="font-size:0.9375rem;color:var(--text-primary);">${esc(a.name||'')}</strong>
          ${a.active===false?'<span style="font-size:0.6875rem;color:#F59E0B;">⏸ pausado</span>':''}
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);">${esc(moduleLabel)} · ${esc(provider)} · ${esc(a.model||'')}</div>
      </div>
    </div>
    <p style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.4;margin:0 0 10px;min-height:34px;">
      ${esc(a.description || 'Sem descrição.')}
    </p>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;font-size:0.6875rem;color:var(--text-muted);">
      ${triggers.map(t => `<span style="padding:2px 8px;background:var(--bg-surface);border-radius:10px;">${t}</span>`).join('')}
    </div>
    <div style="display:flex;gap:4px;">
      <button class="btn btn-primary btn-sm" data-act="run" data-id="${a.id}">▶ Testar</button>
      <button class="btn btn-secondary btn-sm" data-act="edit" data-id="${a.id}">✎ Editar</button>
      <button class="btn btn-ghost btn-sm" data-act="toggle" data-id="${a.id}" data-active="${a.active!==false}"
        title="${a.active===false?'Ativar':'Pausar'}">${a.active===false?'▶':'⏸'}</button>
      <button class="btn btn-ghost btn-sm" data-act="delete" data-id="${a.id}" title="Excluir" style="color:#EF4444;margin-left:auto;">🗑</button>
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════════
 * EDITOR DE AGENTE (modal grande com sub-tabs)
 * ═══════════════════════════════════════════════════════════ */
async function openAgentEditor(agentId) {
  let agent = agentId ? await getAgent(agentId) : { ...AGENT_DEFAULTS };
  if (!agent) { toast.error('Agente não encontrado.'); return; }

  // Knowledge disponível
  const allKnowledge = await fetchKnowledge().catch(() => []);

  let activeSubTab = 'identity';

  modal.open({
    title: agentId ? `✎ Editar Agente: ${esc(agent.name||'sem nome')}` : '+ Novo Agente',
    size: 'xl',
    dedupeKey: 'agent-edit:' + (agentId || 'new'),
    content: `
      <div style="display:flex;gap:16px;height:70vh;">
        <!-- Sidebar de sub-tabs -->
        <div style="width:180px;flex-shrink:0;border-right:1px solid var(--border-subtle);padding-right:12px;">
          ${[
            { id:'identity',  label:'Identidade',  icon:'◈' },
            { id:'model',     label:'Modelo',      icon:'⊚' },
            { id:'prompt',    label:'Prompt',      icon:'✎' },
            { id:'knowledge', label:'Conhecimento',icon:'📚' },
            { id:'tools',     label:'Tools',       icon:'⚙' },
            { id:'limits',    label:'Limites',     icon:'⏱' },
            { id:'triggers',  label:'Triggers',    icon:'⚡' },
            { id:'visibility',label:'Visibilidade',icon:'◎' },
          ].map(st => `
            <button class="agent-subtab" data-subtab="${st.id}" style="display:block;width:100%;text-align:left;
              padding:8px 12px;border:none;background:none;cursor:pointer;font-size:0.8125rem;
              color:${st.id===activeSubTab?'var(--brand-gold)':'var(--text-secondary)'};
              border-left:3px solid ${st.id===activeSubTab?'var(--brand-gold)':'transparent'};
              border-radius:0 4px 4px 0;margin-bottom:2px;">
              ${st.icon} ${st.label}
            </button>
          `).join('')}
        </div>
        <!-- Conteúdo -->
        <div id="agent-subtab-content" style="flex:1;overflow:auto;padding-right:8px;">
          <!-- Renderizado por renderSubTab -->
        </div>
      </div>
    `,
    footer: [
      { label: 'Cancelar', class: 'btn-secondary' },
      { label: '▶ Testar', class: 'btn-secondary', closeOnClick: false, onClick: () => {
        applyFormToAgent();
        // Salva temporário e abre teste
        if (!agent.name) { toast.error('Defina um nome antes de testar.'); return; }
        openAgentRunModal(null, agent);
      }},
      {
        label: agentId ? '💾 Salvar' : '+ Criar agente', class: 'btn-primary', closeOnClick: false,
        onClick: async (_, { close }) => {
          applyFormToAgent();
          if (!agent.name?.trim()) return toast.error('Dê um nome ao agente.');
          if (!agent.systemPrompt?.trim()) return toast.error('Defina o prompt do sistema.');
          try {
            if (agentId) {
              await updateAgent(agentId, agent);
              toast.success('Agente atualizado.');
            } else {
              await createAgent(agent);
              toast.success('Agente criado.');
            }
            close();
          } catch (e) { toast.error(e.message); }
        },
      },
    ],
  });

  // Sub-tab navigation
  setTimeout(() => {
    document.querySelectorAll('.agent-subtab').forEach(btn => {
      btn.addEventListener('click', () => {
        // Persiste valores do form atual antes de trocar de tab
        applyFormToAgent();
        activeSubTab = btn.dataset.subtab;
        document.querySelectorAll('.agent-subtab').forEach(b => {
          b.style.color = b.dataset.subtab === activeSubTab ? 'var(--brand-gold)' : 'var(--text-secondary)';
          b.style.borderLeftColor = b.dataset.subtab === activeSubTab ? 'var(--brand-gold)' : 'transparent';
        });
        renderSubTab();
      });
    });
    renderSubTab();
  }, 80);

  function renderSubTab() {
    const el = document.getElementById('agent-subtab-content');
    if (!el) return;
    if (activeSubTab === 'identity')   el.innerHTML = subTabIdentity(agent);
    else if (activeSubTab === 'model') el.innerHTML = subTabModel(agent);
    else if (activeSubTab === 'prompt') el.innerHTML = subTabPrompt(agent);
    else if (activeSubTab === 'knowledge') el.innerHTML = subTabKnowledge(agent, allKnowledge);
    else if (activeSubTab === 'tools')  el.innerHTML = subTabTools(agent);
    else if (activeSubTab === 'limits') el.innerHTML = subTabLimits(agent);
    else if (activeSubTab === 'triggers') el.innerHTML = subTabTriggers(agent);
    else if (activeSubTab === 'visibility') el.innerHTML = subTabVisibility(agent);

    // Bind specifics
    bindModelDropdown();
    bindAvatarUpload(agent);
    bindKnowledgeAdd(agent);
    bindAllowedSitesEditor(agent);
  }

  function applyFormToAgent() {
    const $ = (id) => document.getElementById(id);
    const v = (id, def) => $(id) ? $(id).value : def;
    const c = (id) => $(id) ? $(id).checked : undefined;

    if ($('a-name'))        agent.name        = v('a-name', agent.name);
    if ($('a-icon'))        agent.icon        = v('a-icon', agent.icon);
    if ($('a-description')) agent.description = v('a-description', agent.description);
    if ($('a-module'))      agent.module      = v('a-module', agent.module);
    if ($('a-active'))      agent.active      = c('a-active');

    if ($('a-provider')) agent.provider = v('a-provider', agent.provider);
    if ($('a-model'))    agent.model    = v('a-model', agent.model);

    if ($('a-system-prompt')) agent.systemPrompt  = v('a-system-prompt', agent.systemPrompt);
    if ($('a-output-format')) agent.outputFormat  = v('a-output-format', agent.outputFormat);

    if ($('a-tools-mode'))   agent.toolsMode   = v('a-tools-mode', agent.toolsMode);
    if ($('a-allow-web'))    agent.allowWebSearch = c('a-allow-web');

    if ($('a-max-tokens'))    agent.limits.maxTokensPerRun = parseInt(v('a-max-tokens')) || 2048;
    if ($('a-temperature'))   agent.limits.temperature     = parseFloat(v('a-temperature')) || 0.3;
    if ($('a-max-cost'))      agent.limits.maxCostPerDayUsd = parseFloat(v('a-max-cost')) || 5;
    if ($('a-rate-max'))      agent.limits.rateLimit.max    = parseInt(v('a-rate-max')) || 10;
    if ($('a-rate-window'))   agent.limits.rateLimit.window = parseInt(v('a-rate-window')) || 60;

    if ($('a-trig-button'))   agent.triggers.button.enabled    = c('a-trig-button');
    if ($('a-trig-btn-label'))agent.triggers.button.label      = v('a-trig-btn-label', agent.triggers.button.label);
    if ($('a-trig-context'))  agent.triggers.context.enabled   = c('a-trig-context');
    if ($('a-trig-sched'))    agent.triggers.schedule.enabled  = c('a-trig-sched');
    if ($('a-trig-sched-mode'))   agent.triggers.schedule.mode   = v('a-trig-sched-mode', agent.triggers.schedule.mode);
    if ($('a-trig-sched-preset')) agent.triggers.schedule.preset = v('a-trig-sched-preset', agent.triggers.schedule.preset);
    if ($('a-trig-sched-cron'))   agent.triggers.schedule.cron   = v('a-trig-sched-cron', agent.triggers.schedule.cron);
    if ($('a-trig-sched-hour'))   agent.triggers.schedule.hour   = parseInt(v('a-trig-sched-hour')) || 9;
    if ($('a-trig-sched-min'))    agent.triggers.schedule.minute = parseInt(v('a-trig-sched-min')) || 0;
    if ($('a-trig-public'))   agent.triggers.publicChat.enabled = c('a-trig-public');
    if ($('a-trig-public-slug')) agent.triggers.publicChat.slug = v('a-trig-public-slug', agent.triggers.publicChat.slug);

    if ($('a-vis-mode')) agent.visibility.mode = v('a-vis-mode', agent.visibility.mode);
    if ($('a-vis-value')) agent.visibility.value = v('a-vis-value', agent.visibility.value);
  }

  function bindModelDropdown() {
    const provSel = document.getElementById('a-provider');
    const modelSel = document.getElementById('a-model');
    if (!provSel || !modelSel) return;
    const refillModels = () => {
      const models = getModelsForProvider(provSel.value);
      modelSel.innerHTML = models.map(m => `<option value="${esc(m.id)}" ${m.id===agent.model?'selected':''}>${esc(m.label)}</option>`).join('');
    };
    provSel.addEventListener('change', () => { agent.provider = provSel.value; refillModels(); });
  }

  function bindAvatarUpload(a) {
    const input = document.getElementById('a-avatar-input');
    const preview = document.getElementById('a-avatar-preview');
    if (!input) return;
    input.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      preview.innerHTML = '<div style="color:var(--text-muted);font-size:0.75rem;">Enviando...</div>';
      try {
        const url = await uploadAgentAvatar(file, agentId || 'new');
        a.avatarUrl = url;
        preview.innerHTML = `<img src="${esc(url)}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid var(--brand-gold);" />`;
        toast.success('Avatar enviado.');
      } catch (err) {
        preview.innerHTML = `<div style="color:#EF4444;font-size:0.75rem;">${esc(err.message)}</div>`;
      }
    });
  }

  function bindKnowledgeAdd(a) {
    document.getElementById('a-kb-add-source')?.addEventListener('click', () => {
      a.knowledgeSources = a.knowledgeSources || [];
      a.knowledgeSources.push({ type: 'url', url: '' });
      renderSubTab();
    });
    document.querySelectorAll('.a-kb-source-remove').forEach(btn =>
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.i);
        a.knowledgeSources.splice(i, 1);
        renderSubTab();
      }));
    document.querySelectorAll('.a-kb-source-input').forEach(inp =>
      inp.addEventListener('change', (e) => {
        const i = parseInt(inp.dataset.i);
        const f = inp.dataset.field;
        a.knowledgeSources[i][f] = e.target.value;
      }));
    document.querySelectorAll('.a-kb-source-type').forEach(sel =>
      sel.addEventListener('change', (e) => {
        const i = parseInt(sel.dataset.i);
        a.knowledgeSources[i].type = e.target.value;
        renderSubTab();
      }));
    document.querySelectorAll('.a-kb-doc-toggle').forEach(cb =>
      cb.addEventListener('change', (e) => {
        a.knowledgeIds = a.knowledgeIds || [];
        const id = cb.dataset.id;
        if (e.target.checked) {
          if (!a.knowledgeIds.includes(id)) a.knowledgeIds.push(id);
        } else {
          a.knowledgeIds = a.knowledgeIds.filter(x => x !== id);
        }
      }));
  }

  function bindAllowedSitesEditor(a) {
    const ta = document.getElementById('a-allowed-sites');
    if (!ta) return;
    ta.addEventListener('change', () => {
      a.allowedSites = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
    });
  }
}

/* ─── Sub-tabs (HTML helpers) ───────────────────────────── */
function subTabIdentity(a) {
  return `
    <h3 style="margin:0 0 12px;font-size:1.0625rem;">Identidade</h3>
    <div style="display:flex;gap:16px;align-items:start;margin-bottom:16px;">
      <div id="a-avatar-preview" style="flex-shrink:0;">
        ${a.avatarUrl
          ? `<img src="${esc(a.avatarUrl)}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid var(--brand-gold);" />`
          : `<div style="width:64px;height:64px;border-radius:50%;background:var(--bg-surface);display:flex;align-items:center;justify-content:center;font-size:1.75rem;border:2px dashed var(--border-default);">${esc(a.icon||'◈')}</div>`}
      </div>
      <div style="flex:1;">
        <label class="form-label">Avatar (foto, hospedada no R2)</label>
        <input type="file" id="a-avatar-input" accept="image/*" class="form-input" />
        <small style="color:var(--text-muted);font-size:0.6875rem;">Até 2MB. PNG/JPG/WebP. Quadrada de preferência.</small>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 100px;gap:12px;">
      <div class="form-group">
        <label class="form-label">Nome <span style="color:#EF4444;">*</span></label>
        <input type="text" id="a-name" class="form-input" value="${esc(a.name||'')}" placeholder="Ex: Triagem de Tarefas" />
      </div>
      <div class="form-group">
        <label class="form-label">Ícone</label>
        <input type="text" id="a-icon" class="form-input" value="${esc(a.icon||'◈')}" maxlength="2" style="text-align:center;font-size:1.25rem;" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Descrição</label>
      <input type="text" id="a-description" class="form-input" value="${esc(a.description||'')}" placeholder="Pra que serve este agente?" />
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group">
        <label class="form-label">Módulo onde atua</label>
        <select id="a-module" class="form-select">
          ${Object.entries(MODULE_REGISTRY).map(([id, m]) =>
            `<option value="${esc(id)}" ${id===a.module?'selected':''}>${esc(m.icon)} ${esc(m.label)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Status</label>
        <label style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg-surface);border-radius:6px;">
          <input type="checkbox" id="a-active" ${a.active!==false?'checked':''} />
          Agente ativo
        </label>
      </div>
    </div>
  `;
}

function subTabModel(a) {
  const models = getModelsForProvider(a.provider);
  return `
    <h3 style="margin:0 0 12px;font-size:1.0625rem;">Modelo de IA</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group">
        <label class="form-label">Provider</label>
        <select id="a-provider" class="form-select">
          ${AI_PROVIDERS.map(p =>
            `<option value="${esc(p.id)}" ${p.id===a.provider?'selected':''}>${esc(p.icon)} ${esc(p.label)}${p.free?' · Grátis':''}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Modelo</label>
        <select id="a-model" class="form-select">
          ${models.map(m => `<option value="${esc(m.id)}" ${m.id===a.model?'selected':''}>${esc(m.label)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">API Key</label>
      <div style="padding:12px;background:var(--bg-surface);border-radius:6px;font-size:0.8125rem;color:var(--text-secondary);">
        Usa a chave configurada em <strong>API Keys</strong> (resolução automática:
        usuário → núcleo → setor → workspace → global).
        ${a.apiKeyRef?.scope==='global' ? '' : `<br><small>Override: ${esc(a.apiKeyRef?.scopeLabel||'')}</small>`}
      </div>
    </div>
  `;
}

function subTabPrompt(a) {
  return `
    <h3 style="margin:0 0 12px;font-size:1.0625rem;">Prompt e Personalidade</h3>
    <div class="form-group">
      <label class="form-label">Prompt do sistema <span style="color:#EF4444;">*</span></label>
      <textarea id="a-system-prompt" class="form-textarea" rows="14"
        placeholder="Você é um assistente especialista em [área]. Sua missão é..."
        style="font-family:var(--font-mono,monospace);font-size:0.8125rem;line-height:1.6;">${esc(a.systemPrompt||'')}</textarea>
      <small style="color:var(--text-muted);font-size:0.6875rem;">
        Define como o agente se comporta. Seja específico sobre tom, formato e regras.
      </small>
    </div>
    <div class="form-group">
      <label class="form-label">Formato da resposta</label>
      <select id="a-output-format" class="form-select">
        <option value="text"     ${a.outputFormat==='text'?'selected':''}>Texto livre</option>
        <option value="markdown" ${a.outputFormat==='markdown'?'selected':''}>Markdown</option>
        <option value="json"     ${a.outputFormat==='json'?'selected':''}>JSON estruturado</option>
        <option value="html"     ${a.outputFormat==='html'?'selected':''}>HTML</option>
      </select>
    </div>
  `;
}

function subTabKnowledge(a, allKnowledge) {
  const sources = a.knowledgeSources || [];
  return `
    <h3 style="margin:0 0 12px;font-size:1.0625rem;">Base de Conhecimento</h3>
    <p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:12px;">
      Conteúdo extra que o agente consulta antes de responder. RAG simples — vai dentro do prompt.
    </p>

    <h4 style="font-size:0.875rem;margin:16px 0 8px;">Documentos internos</h4>
    <div style="max-height:160px;overflow:auto;border:1px solid var(--border-subtle);border-radius:6px;padding:10px;">
      ${!allKnowledge.length ? '<p style="font-size:0.75rem;color:var(--text-muted);">Nenhum doc cadastrado. Vá na aba Conhecimento pra criar.</p>'
        : allKnowledge.map(k => `
          <label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:0.8125rem;">
            <input type="checkbox" class="a-kb-doc-toggle" data-id="${esc(k.id)}"
              ${(a.knowledgeIds||[]).includes(k.id) ? 'checked' : ''} />
            <span style="flex:1;">${esc(k.title)}</span>
            <small style="color:var(--text-muted);">${k.charCount||0} chars</small>
          </label>
        `).join('')}
    </div>

    <h4 style="font-size:0.875rem;margin:20px 0 8px;display:flex;justify-content:space-between;align-items:center;">
      Fontes externas
      <button class="btn btn-secondary btn-sm" id="a-kb-add-source">+ Adicionar fonte</button>
    </h4>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${sources.length === 0 ? '<p style="font-size:0.75rem;color:var(--text-muted);">Nenhuma fonte externa.</p>'
        : sources.map((s, i) => `
          <div style="display:flex;gap:6px;align-items:center;padding:8px;border:1px solid var(--border-subtle);border-radius:6px;">
            <select class="a-kb-source-type form-select" data-i="${i}" style="width:130px;font-size:0.75rem;">
              <option value="url"        ${s.type==='url'?'selected':''}>🔗 URL</option>
              <option value="r2"         ${s.type==='r2'?'selected':''}>☁ R2 path</option>
              <option value="sharepoint" ${s.type==='sharepoint'?'selected':''}>Ⓜ SharePoint</option>
            </select>
            ${s.type === 'url' ? `<input type="url" class="a-kb-source-input form-input" data-i="${i}" data-field="url"
              value="${esc(s.url||'')}" placeholder="https://..." style="flex:1;font-size:0.8125rem;" />`
            : s.type === 'r2' ? `<input type="text" class="a-kb-source-input form-input" data-i="${i}" data-field="path"
              value="${esc(s.path||'')}" placeholder="docs/sla/" style="flex:1;font-size:0.8125rem;" />`
            : `<input type="text" class="a-kb-source-input form-input" data-i="${i}" data-field="folder"
              value="${esc(s.folder||'')}" placeholder="Procedimentos > Marketing" style="flex:1;font-size:0.8125rem;" />`}
            <button class="btn btn-ghost btn-sm a-kb-source-remove" data-i="${i}" title="Remover">✕</button>
          </div>
        `).join('')}
    </div>
  `;
}

function subTabTools(a) {
  return `
    <h3 style="margin:0 0 12px;font-size:1.0625rem;">Ferramentas (Tools)</h3>
    <div class="form-group">
      <label class="form-label">Modo</label>
      <select id="a-tools-mode" class="form-select">
        <option value="auto"   ${a.toolsMode==='auto'?'selected':''}>Auto (todas as tools do módulo)</option>
        <option value="manual" ${a.toolsMode==='manual'?'selected':''}>Manual (selecionar específicas)</option>
      </select>
      <small style="color:var(--text-muted);font-size:0.6875rem;">
        Lista detalhada virá na Fase 6 (descoberta dinâmica). Por ora, "auto" libera tudo do módulo.
      </small>
    </div>
    <div class="form-group">
      <label style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg-surface);border-radius:6px;">
        <input type="checkbox" id="a-allow-web" ${a.allowWebSearch?'checked':''} />
        <div>
          <strong>Habilitar busca na web</strong>
          <div style="font-size:0.75rem;color:var(--text-muted);">Agente pode pesquisar conteúdo atualizado online.</div>
        </div>
      </label>
    </div>
    <div class="form-group">
      <label class="form-label">Sites permitidos (1 por linha — vazio = web toda)</label>
      <textarea id="a-allowed-sites" class="form-textarea" rows="5" placeholder="https://exemplo.com&#10;https://outro.com">${esc((a.allowedSites||[]).join('\n'))}</textarea>
    </div>
  `;
}

function subTabLimits(a) {
  const l = a.limits || AGENT_DEFAULTS.limits;
  return `
    <h3 style="margin:0 0 12px;font-size:1.0625rem;">Limites operacionais</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group">
        <label class="form-label">Max tokens por execução</label>
        <input type="number" id="a-max-tokens" class="form-input" value="${l.maxTokensPerRun}" min="128" max="32000" />
      </div>
      <div class="form-group">
        <label class="form-label">Temperatura (0-1)</label>
        <input type="number" id="a-temperature" class="form-input" value="${l.temperature}" min="0" max="1" step="0.05" />
      </div>
      <div class="form-group">
        <label class="form-label">Custo máximo / dia (USD)</label>
        <input type="number" id="a-max-cost" class="form-input" value="${l.maxCostPerDayUsd}" min="0" step="0.50" />
      </div>
      <div class="form-group">
        <label class="form-label">Rate limit</label>
        <div style="display:flex;gap:6px;align-items:center;">
          <input type="number" id="a-rate-max" class="form-input" value="${l.rateLimit?.max||10}" min="1" style="width:80px;" />
          <span style="font-size:0.8125rem;color:var(--text-muted);">chamadas a cada</span>
          <input type="number" id="a-rate-window" class="form-input" value="${l.rateLimit?.window||60}" min="1" style="width:80px;" />
          <span style="font-size:0.8125rem;color:var(--text-muted);">segundos</span>
        </div>
      </div>
    </div>
  `;
}

function subTabTriggers(a) {
  const t = a.triggers || AGENT_DEFAULTS.triggers;
  return `
    <h3 style="margin:0 0 12px;font-size:1.0625rem;">Triggers — como o agente é acionado</h3>

    <div class="form-group" style="padding:14px;border:1px solid var(--border-subtle);border-radius:6px;margin-bottom:12px;">
      <label style="display:flex;align-items:center;gap:8px;font-weight:600;">
        <input type="checkbox" id="a-trig-button" ${t.button?.enabled?'checked':''} />
        ▶ Botão na página (header do módulo)
      </label>
      <div style="margin-top:8px;display:flex;gap:6px;align-items:center;">
        <span style="font-size:0.75rem;color:var(--text-muted);">Label:</span>
        <input type="text" id="a-trig-btn-label" class="form-input" value="${esc(t.button?.label||'✨ IA')}" style="font-size:0.8125rem;" />
      </div>
    </div>

    <div class="form-group" style="padding:14px;border:1px solid var(--border-subtle);border-radius:6px;margin-bottom:12px;">
      <label style="display:flex;align-items:center;gap:8px;font-weight:600;">
        <input type="checkbox" id="a-trig-context" ${t.context?.enabled?'checked':''} />
        ⊞ Menu de contexto (botão direito)
      </label>
    </div>

    <div class="form-group" style="padding:14px;border:1px solid var(--border-subtle);border-radius:6px;margin-bottom:12px;">
      <label style="display:flex;align-items:center;gap:8px;font-weight:600;">
        <input type="checkbox" id="a-trig-sched" ${t.schedule?.enabled?'checked':''} />
        ⏰ Agendamento (cron)
      </label>
      <div style="margin-top:10px;display:grid;grid-template-columns:120px 1fr;gap:8px;align-items:center;">
        <span style="font-size:0.75rem;color:var(--text-muted);">Modo:</span>
        <select id="a-trig-sched-mode" class="form-select" style="font-size:0.8125rem;">
          <option value="preset" ${t.schedule?.mode==='preset'?'selected':''}>Preset (simples)</option>
          <option value="cron"   ${t.schedule?.mode==='cron'?'selected':''}>Cron (avançado)</option>
        </select>
        <span style="font-size:0.75rem;color:var(--text-muted);">Preset:</span>
        <select id="a-trig-sched-preset" class="form-select" style="font-size:0.8125rem;">
          <option value="hourly"  ${t.schedule?.preset==='hourly'?'selected':''}>A cada hora</option>
          <option value="daily"   ${t.schedule?.preset==='daily'?'selected':''}>Diário</option>
          <option value="weekly"  ${t.schedule?.preset==='weekly'?'selected':''}>Semanal</option>
          <option value="monthly" ${t.schedule?.preset==='monthly'?'selected':''}>Mensal</option>
        </select>
        <span style="font-size:0.75rem;color:var(--text-muted);">Cron:</span>
        <input type="text" id="a-trig-sched-cron" class="form-input" value="${esc(t.schedule?.cron||'')}" placeholder="0 9 * * 1-5" style="font-size:0.8125rem;font-family:monospace;" />
        <span style="font-size:0.75rem;color:var(--text-muted);">Hora:</span>
        <div style="display:flex;gap:6px;">
          <input type="number" id="a-trig-sched-hour" class="form-input" value="${t.schedule?.hour??9}" min="0" max="23" style="width:70px;font-size:0.8125rem;" />
          <span style="align-self:center;">:</span>
          <input type="number" id="a-trig-sched-min" class="form-input" value="${t.schedule?.minute??0}" min="0" max="59" style="width:70px;font-size:0.8125rem;" />
        </div>
      </div>
    </div>

    <div class="form-group" style="padding:14px;border:1px solid var(--border-subtle);border-radius:6px;">
      <label style="display:flex;align-items:center;gap:8px;font-weight:600;">
        <input type="checkbox" id="a-trig-public" ${t.publicChat?.enabled?'checked':''} />
        🌐 Página de chat pública
      </label>
      <div style="margin-top:8px;display:flex;gap:6px;align-items:center;">
        <span style="font-size:0.75rem;color:var(--text-muted);">URL:</span>
        <code style="font-size:0.75rem;color:var(--text-muted);">/agente.html?slug=</code>
        <input type="text" id="a-trig-public-slug" class="form-input" value="${esc(t.publicChat?.slug||'')}" placeholder="meu-agente" style="font-size:0.8125rem;flex:1;" />
      </div>
      <small style="color:var(--text-muted);font-size:0.6875rem;display:block;margin-top:6px;">
        Disponibiliza o agente como chat livre num link compartilhável (Fase 3).
      </small>
    </div>
  `;
}

function subTabVisibility(a) {
  const v = a.visibility || { mode: 'all', value: '' };
  return `
    <h3 style="margin:0 0 12px;font-size:1.0625rem;">Visibilidade</h3>
    <div class="form-group">
      <label class="form-label">Quem pode usar este agente?</label>
      <select id="a-vis-mode" class="form-select">
        <option value="all"    ${v.mode==='all'?'selected':''}>Todos os usuários</option>
        <option value="admin"  ${v.mode==='admin'?'selected':''}>Apenas admin/master</option>
        <option value="sector" ${v.mode==='sector'?'selected':''}>Setor específico</option>
        <option value="role"   ${v.mode==='role'?'selected':''}>Role específico</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Valor (se setor/role)</label>
      <input type="text" id="a-vis-value" class="form-input" value="${esc(v.value||'')}" placeholder="Ex: Marketing, manager" />
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
 * MODAL DE TESTE/EXECUÇÃO
 * ═══════════════════════════════════════════════════════════ */
async function openAgentRunModal(agentId, agentObj = null) {
  const agent = agentId ? await getAgent(agentId) : agentObj;
  if (!agent) return toast.error('Agente não encontrado.');

  modal.open({
    title: `▶ Testar: ${esc(agent.name)}`,
    size: 'lg',
    dedupeKey: 'agent-run:' + (agentId || 'new'),
    content: `
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:14px;padding:10px;background:var(--bg-surface);border-radius:6px;">
        ${agent.avatarUrl
          ? `<img src="${esc(agent.avatarUrl)}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;" />`
          : `<div style="width:40px;height:40px;border-radius:50%;background:var(--bg-card);display:flex;align-items:center;justify-content:center;">${esc(agent.icon||'◈')}</div>`}
        <div style="flex:1;min-width:0;">
          <strong>${esc(agent.name)}</strong>
          <div style="font-size:0.75rem;color:var(--text-muted);">${esc(agent.provider)} · ${esc(agent.model)}</div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Mensagem</label>
        <textarea id="run-input" class="form-textarea" rows="4" placeholder="Digite uma mensagem pra testar o agente..."></textarea>
      </div>
      <div id="run-output" style="display:none;margin-top:12px;padding:14px;background:var(--bg-surface);border-radius:6px;
        font-size:0.875rem;line-height:1.6;white-space:pre-wrap;max-height:300px;overflow:auto;"></div>
      <div id="run-meta" style="display:none;margin-top:8px;font-size:0.6875rem;color:var(--text-muted);"></div>
    `,
    footer: [
      { label: 'Fechar', class: 'btn-secondary' },
      { label: '▶ Executar', class: 'btn-primary', closeOnClick: false, onClick: async () => {
        const input = document.getElementById('run-input').value.trim();
        if (!input) return toast.error('Digite uma mensagem.');
        const out = document.getElementById('run-output');
        const meta = document.getElementById('run-meta');
        out.style.display = 'block';
        out.textContent = '⏳ Executando...';
        meta.style.display = 'none';
        try {
          const t0 = Date.now();
          let result;
          if (agentId) {
            result = await runAgent(agentId, input);
          } else {
            // Agente ainda não salvo — usa chatWithAI direto com o prompt
            const ai = await import('../services/ai.js');
            result = await ai.chatWithAI(input, {}, {
              moduleId: agent.module,
              provider: agent.provider, model: agent.model,
              maxTokens: agent.limits?.maxTokensPerRun || 2048,
              temperature: agent.limits?.temperature ?? 0.3,
              systemPromptOverride: agent.systemPrompt,
            });
          }
          const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
          out.textContent = result.text || '(resposta vazia)';
          meta.style.display = 'block';
          meta.textContent = `${elapsed}s · ${result.inputTokens||0} → ${result.outputTokens||0} tokens · ${result.model||'?'}`;
        } catch (e) {
          out.textContent = `❌ Erro: ${e.message}`;
        }
      }},
    ],
  });
}

/* ═══════════════════════════════════════════════════════════
 * TABS RÁPIDAS (versão inicial — placeholders informativos)
 * Cada uma vai ser expandida em fases posteriores
 * ═══════════════════════════════════════════════════════════ */
function renderApiKeysTab(container) {
  container.innerHTML = `
    <div class="card" style="padding:20px;">
      <h3 style="margin:0 0 8px;">⚿ API Keys</h3>
      <p style="color:var(--text-muted);font-size:0.875rem;line-height:1.6;margin-bottom:14px;">
        Gerenciamento de chaves por escopo (global / workspace / setor / usuário) — em construção.
        Por enquanto, configure em <a href="#ai-skills">IA Skills antiga → Configurar API</a>.
        A migração para esta aba virá na Fase 7.
      </p>
    </div>
  `;
}

function renderKnowledgeTab(container) {
  container.innerHTML = `
    <div class="card" style="padding:20px;">
      <h3 style="margin:0 0 8px;">📚 Base de Conhecimento</h3>
      <p style="color:var(--text-muted);font-size:0.875rem;line-height:1.6;">
        Cadastro de docs (texto, URL, .md, R2, SharePoint) — em construção (Fase 4).
        Por enquanto, use <a href="#ai-skills">IA Skills antiga → Base de Conhecimento</a>.
        Os agentes já podem referenciar docs daquela aba (no editor → Conhecimento).
      </p>
    </div>
  `;
}

function renderLogsTab(container) {
  container.innerHTML = `
    <div class="card" style="padding:20px;">
      <h3 style="margin:0 0 8px;">⌚ Logs</h3>
      <p style="color:var(--text-muted);font-size:0.875rem;line-height:1.6;">
        Histórico por agente — em construção (Fase 7).
        Hoje os logs vão pra collection <code>ai_usage_logs</code> com campo <code>agentId</code>.
      </p>
    </div>
  `;
}

function renderCostsTab(container) {
  container.innerHTML = `
    <div class="card" style="padding:20px;">
      <h3 style="margin:0 0 8px;">$ Custos</h3>
      <p style="color:var(--text-muted);font-size:0.875rem;line-height:1.6;">
        Dashboard de uso (tokens, USD estimado, top agentes) — em construção (Fase 7).
        Por enquanto: <a href="#ai-dashboard">Dashboard IA antigo</a>.
      </p>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
 * TAB: MIGRAÇÃO (skills + automações → agents, com backup)
 * ═══════════════════════════════════════════════════════════ */
function renderMigrationTab(container) {
  container.innerHTML = `
    <div class="card" style="padding:20px;margin-bottom:16px;">
      <h3 style="margin:0 0 12px;">↻ Migrar legado para Agentes</h3>
      <p style="font-size:0.875rem;color:var(--text-secondary);line-height:1.6;margin-bottom:16px;">
        Importa todas as <strong>Skills</strong> (collection <code>ai_skills</code>) e
        <strong>Automações IA</strong> (collection <code>ai_automations</code>) como agentes equivalentes.
      </p>
      <div style="background:var(--bg-surface);padding:14px;border-radius:6px;margin-bottom:16px;font-size:0.8125rem;line-height:1.7;">
        <strong>🛡 Anti-perda:</strong>
        <ul style="margin:6px 0 0 20px;color:var(--text-secondary);">
          <li>Cada skill/automação é <strong>copiada integralmente</strong> pra <code>ai_skills_archive</code> ou <code>ai_automations_archive</code> antes de qualquer alteração.</li>
          <li>Migração é <strong>idempotente</strong>: se você rodar duas vezes, não duplica.</li>
          <li>As collections originais <strong>NÃO são apagadas</strong> nesta etapa — só depois que você confirmar manualmente que está tudo ok.</li>
        </ul>
      </div>
      <button class="btn btn-primary" id="mig-run">▶ Migrar agora</button>
      <div id="mig-result" style="display:none;margin-top:14px;"></div>
    </div>

    <div class="card" style="padding:20px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.04);">
      <h3 style="margin:0 0 12px;color:#EF4444;">⚠ Apagar collections legadas</h3>
      <p style="font-size:0.875rem;color:var(--text-secondary);line-height:1.6;margin-bottom:14px;">
        Após validar a migração, remove <code>ai_skills</code> e <code>ai_automations</code> originais.
        Os backups em <code>ai_skills_archive</code> e <code>ai_automations_archive</code> permanecem.
      </p>
      <p style="font-size:0.8125rem;color:#EF4444;margin-bottom:10px;">
        Digite <strong>APAGAR LEGADO</strong> para liberar o botão:
      </p>
      <input type="text" id="mig-confirm" class="form-input" placeholder='APAGAR LEGADO' style="margin-bottom:10px;" />
      <button class="btn btn-danger" id="mig-purge" disabled>🗑 Apagar legado</button>
      <div id="mig-purge-result" style="display:none;margin-top:14px;"></div>
    </div>
  `;

  document.getElementById('mig-run')?.addEventListener('click', async () => {
    const btn = document.getElementById('mig-run');
    btn.disabled = true; btn.textContent = '⏳ Migrando...';
    try {
      const report = await migrateLegacyToAgents();
      const out = document.getElementById('mig-result');
      out.style.display = 'block';
      out.innerHTML = `
        <div style="background:var(--bg-surface);padding:12px;border-radius:6px;font-size:0.8125rem;line-height:1.6;">
          <strong>Relatório:</strong>
          <ul style="margin:6px 0 0 20px;">
            <li>Skills: ${report.skillsTotal} encontradas · ${report.skillsMigrated} migradas · ${report.skillsSkipped} já existiam · ${report.skillsFailed} falharam</li>
            <li>Automações: ${report.automationsTotal} encontradas · ${report.automationsMigrated} migradas · ${report.automationsSkipped} já existiam · ${report.automationsFailed} falharam</li>
            ${report.errors.length ? `<li style="color:#EF4444;">Erros:<pre style="font-size:0.75rem;margin:4px 0 0;white-space:pre-wrap;">${esc(report.errors.join('\n'))}</pre></li>` : ''}
          </ul>
        </div>
      `;
      btn.disabled = false; btn.textContent = '▶ Migrar agora';
    } catch (e) {
      toast.error(e.message);
      btn.disabled = false; btn.textContent = '▶ Migrar agora';
    }
  });

  const confirmInput = document.getElementById('mig-confirm');
  const purgeBtn = document.getElementById('mig-purge');
  confirmInput?.addEventListener('input', () => {
    purgeBtn.disabled = confirmInput.value.trim() !== 'APAGAR LEGADO';
  });
  purgeBtn?.addEventListener('click', async () => {
    if (!confirm('CERTEZA? Apaga ai_skills e ai_automations originais (backups ficam em *_archive).')) return;
    purgeBtn.disabled = true; purgeBtn.textContent = '⏳ Apagando...';
    try {
      const report = await purgeLegacyCollections({ confirmText: confirmInput.value.trim() });
      const out = document.getElementById('mig-purge-result');
      out.style.display = 'block';
      out.innerHTML = `
        <div style="background:var(--bg-surface);padding:12px;border-radius:6px;font-size:0.8125rem;line-height:1.6;">
          <strong>Apagado:</strong> ${report.skillsPurged} skills, ${report.automationsPurged} automações.
          ${report.errors.length ? `<div style="color:#EF4444;margin-top:6px;">Erros:<pre style="font-size:0.75rem;">${esc(report.errors.join('\n'))}</pre></div>` : ''}
        </div>
      `;
      purgeBtn.textContent = '🗑 Apagar legado';
    } catch (e) {
      toast.error(e.message);
      purgeBtn.disabled = false; purgeBtn.textContent = '🗑 Apagar legado';
    }
  });
}
