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
  seedDefaultAgents, SYSTEM_SEED_AGENTS,
  AGENT_DEFAULTS,
} from '../services/agents.js?v=20260501dd2';
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
        { id:'connections',label:'Conexões',     icon:'🔌' },
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
  else if (_activeTab === 'connections') renderConnectionsTab(el);
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

  // Tool catalog (descoberta dinâmica — Fase 6)
  try {
    const aiActions = await import('../services/aiActions.js');
    window.__toolCatalogCache = aiActions.listAllTools();
  } catch {}

  // Cache de chaves escopadas (pra dropdown de Origem da API Key)
  try {
    window.__scopedKeysCache = await listAllScopedConfigs();
  } catch { window.__scopedKeysCache = []; }

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
            { id:'site',      label:'Site público',icon:'🌐' },
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
    else if (activeSubTab === 'site') el.innerHTML = subTabSite(agent);
    else if (activeSubTab === 'visibility') el.innerHTML = subTabVisibility(agent);

    // Bind specifics
    bindModelDropdown();
    bindAvatarUpload(agent);
    bindKnowledgeAdd(agent);
    bindAllowedSitesEditor(agent);
    bindToolToggles(agent);
    bindFewShotEditor(agent);
    bindSiteEditor(agent);
  }

  function bindSiteEditor(a) {
    a.site = a.site || {};
    document.getElementById('a-site-prompt-add')?.addEventListener('click', () => {
      applyFormToAgent();  // preserva campos digitados antes de re-render
      a.site.suggestedPrompts = a.site.suggestedPrompts || [];
      a.site.suggestedPrompts.push('');
      renderSubTab();
    });
    document.querySelectorAll('.a-site-prompt-del').forEach(btn =>
      btn.addEventListener('click', () => {
        applyFormToAgent();
        a.site.suggestedPrompts.splice(parseInt(btn.dataset.i), 1);
        renderSubTab();
      }));
    document.querySelectorAll('.a-site-prompt-input').forEach(inp =>
      inp.addEventListener('input', (e) => {
        a.site.suggestedPrompts[parseInt(inp.dataset.i)] = e.target.value;
      }));
    document.getElementById('a-site-copy-url')?.addEventListener('click', () => {
      const slug = a.triggers?.publicChat?.slug || '';
      const url = slug
        ? `${location.origin}/tarefas/agente.html?slug=${encodeURIComponent(slug)}`
        : `${location.origin}/tarefas/agente.html?id=${a.id}`;
      navigator.clipboard?.writeText(url).then(() => toast.success('URL copiada.'));
    });
    document.getElementById('a-site-copy-embed')?.addEventListener('click', () => {
      const slug = a.triggers?.publicChat?.slug || '';
      const url = slug
        ? `${location.origin}/tarefas/agente.html?slug=${encodeURIComponent(slug)}`
        : `${location.origin}/tarefas/agente.html?id=${a.id}`;
      const code = `<iframe src="${url}" width="100%" height="700" frameborder="0" allow="microphone"></iframe>`;
      navigator.clipboard?.writeText(code).then(() => toast.success('Embed copiado.'));
    });
  }

  function bindFewShotEditor(a) {
    document.getElementById('a-fs-add')?.addEventListener('click', () => {
      applyFormToAgent();
      a.fewShotExamples = a.fewShotExamples || [];
      a.fewShotExamples.push({ input: '', output: '' });
      renderSubTab();
    });
    document.querySelectorAll('.a-fs-del').forEach(btn =>
      btn.addEventListener('click', () => {
        applyFormToAgent();
        a.fewShotExamples.splice(parseInt(btn.dataset.i), 1);
        renderSubTab();
      }));
    document.querySelectorAll('.a-fs-input').forEach(ta =>
      ta.addEventListener('change', (e) => {
        const i = parseInt(ta.dataset.i);
        a.fewShotExamples[i][ta.dataset.field] = e.target.value;
      }));
  }

  function bindToolToggles(a) {
    document.getElementById('a-tools-mode')?.addEventListener('change', (e) => {
      a.toolsMode = e.target.value;
      renderSubTab();  // re-renderiza pra habilitar/desabilitar checkboxes
    });
    document.querySelectorAll('.a-tool-toggle').forEach(cb =>
      cb.addEventListener('change', (e) => {
        a.enabledTools = a.enabledTools || [];
        const name = cb.dataset.name;
        if (e.target.checked) {
          if (!a.enabledTools.includes(name)) a.enabledTools.push(name);
        } else {
          a.enabledTools = a.enabledTools.filter(x => x !== name);
        }
      }));
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
    if ($('a-apikey-ref')) {
      const refVal = v('a-apikey-ref', 'auto');
      if (refVal === 'auto') {
        agent.apiKeyRef = { scope: 'auto', scopeId: null, scopeLabel: 'Auto' };
      } else if (refVal.startsWith('scoped:')) {
        const id = refVal.slice(7);
        const k = (window.__scopedKeysCache||[]).find(x => x.id === id);
        if (k) agent.apiKeyRef = { scope: k.scope, scopeId: k.id, scopeLabel: k.scopeLabel || k.scopeId };
      }
    }

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

    // Site público
    agent.site = agent.site || {};
    if ($('a-site-welcome'))  agent.site.welcomeMessage = v('a-site-welcome', agent.site.welcomeMessage);
    if ($('a-site-tagline'))  agent.site.tagline        = v('a-site-tagline', agent.site.tagline);
    if ($('a-site-color'))    agent.site.brandColor     = v('a-site-color', agent.site.brandColor);
    if ($('a-site-footer'))   agent.site.footerText     = v('a-site-footer', agent.site.footerText);
    if ($('a-site-show-avatar'))  agent.site.showAvatar  = c('a-site-show-avatar');
    if ($('a-site-show-branding'))agent.site.showBranding = c('a-site-show-branding');
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
      applyFormToAgent();
      a.knowledgeSources = a.knowledgeSources || [];
      a.knowledgeSources.push({ type: 'url', url: '' });
      renderSubTab();
    });
    document.querySelectorAll('.a-kb-source-remove').forEach(btn =>
      btn.addEventListener('click', () => {
        applyFormToAgent();
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
    // Google Drive Picker (lista pasta raiz e copia ID)
    document.querySelectorAll('.a-kb-gdrive-pick').forEach(btn =>
      btn.addEventListener('click', async () => {
        try {
          const gd = await import('../services/googleDrive.js');
          if (!gd.isGoogleConnected()) {
            await gd.signInWithGoogle();
          }
          const files = await gd.listDriveFiles('root', { limit: 50 });
          // Modal simples de seleção
          const folders = files.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
          const docs = files.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');
          const html = `
            <p style="font-size:0.8125rem;color:var(--text-muted);margin:0 0 12px;">
              Click numa pasta ou arquivo pra usar como knowledge source. Ou cole o ID manualmente.
            </p>
            ${folders.length ? `<h4 style="font-size:0.75rem;margin:0 0 6px;">📁 PASTAS</h4>
              <div style="max-height:200px;overflow:auto;">${folders.map(f => `
                <div class="gd-pick-item" data-id="${esc(f.id)}" data-name="${esc(f.name)}" data-folder="1"
                  style="padding:6px 10px;cursor:pointer;border-radius:4px;font-size:0.8125rem;"
                  onmouseover="this.style.background='var(--bg-surface)'"
                  onmouseout="this.style.background=''">📁 ${esc(f.name)}</div>
              `).join('')}</div>` : ''}
            ${docs.length ? `<h4 style="font-size:0.75rem;margin:14px 0 6px;">📄 ARQUIVOS</h4>
              <div style="max-height:200px;overflow:auto;">${docs.slice(0,30).map(f => `
                <div class="gd-pick-item" data-id="${esc(f.id)}" data-name="${esc(f.name)}" data-mime="${esc(f.mimeType)}"
                  style="padding:6px 10px;cursor:pointer;border-radius:4px;font-size:0.8125rem;"
                  onmouseover="this.style.background='var(--bg-surface)'"
                  onmouseout="this.style.background=''">📄 ${esc(f.name)} <small style="color:var(--text-muted);">(${f.mimeType.split('.').pop()})</small></div>
              `).join('')}</div>` : ''}
          `;
          modal.open({
            title: '📁 Escolher do Google Drive',
            size: 'md',
            content: html,
            footer: [{ label: 'Fechar', class: 'btn-secondary' }],
          });
          setTimeout(() => {
            document.querySelectorAll('.gd-pick-item').forEach(el =>
              el.addEventListener('click', () => {
                const i = parseInt(btn.dataset.i);
                if (el.dataset.folder) {
                  a.knowledgeSources[i].folderId = el.dataset.id;
                  a.knowledgeSources[i].fileName = el.dataset.name;
                  delete a.knowledgeSources[i].fileId;
                } else {
                  a.knowledgeSources[i].fileId = el.dataset.id;
                  a.knowledgeSources[i].fileName = el.dataset.name;
                  a.knowledgeSources[i].mimeType = el.dataset.mime;
                  delete a.knowledgeSources[i].folderId;
                }
                modal.close();
                renderSubTab();
                toast.success(`Selecionado: ${el.dataset.name}`);
              }));
          }, 80);
        } catch (e) { toast.error(e.message); }
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
  const scopedKeys = window.__scopedKeysCache || [];
  const ref = a.apiKeyRef || { scope: 'global' };
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
      <label class="form-label">Origem da API Key</label>
      <select id="a-apikey-ref" class="form-select">
        <option value="auto" ${ref.scope==='global'||ref.scope==='auto'?'selected':''}>🌐 Cascata automática (user → núcleo → setor → global)</option>
        ${scopedKeys.map(k => `<option value="scoped:${esc(k.id)}" ${ref.scopeId===k.id?'selected':''}>
          🎯 ${esc(k.scope)} · ${esc(k.scopeLabel || k.scopeId)}
        </option>`).join('')}
      </select>
      <small style="color:var(--text-muted);font-size:0.6875rem;">
        ${scopedKeys.length ? scopedKeys.length + ' chave(s) escopada(s) disponível(eis). Configure em IA Hub → API Keys.' : 'Sem chaves escopadas. Configure em IA Hub → API Keys pra forçar escopo.'}
      </small>
    </div>
  `;
}

function subTabPrompt(a) {
  const examples = a.fewShotExamples || [];
  return `
    <h3 style="margin:0 0 12px;font-size:1.0625rem;">Prompt e Personalidade</h3>
    <div class="form-group">
      <label class="form-label">Prompt do sistema <span style="color:#EF4444;">*</span></label>
      <textarea id="a-system-prompt" class="form-textarea" rows="10"
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

    <h4 style="font-size:0.875rem;margin:18px 0 8px;display:flex;justify-content:space-between;align-items:center;">
      Exemplos few-shot (opcional)
      <button class="btn btn-secondary btn-sm" id="a-fs-add">+ Adicionar exemplo</button>
    </h4>
    <p style="font-size:0.6875rem;color:var(--text-muted);margin:0 0 8px;">
      Pares pergunta→resposta que ensinam o agente o estilo desejado. Bom pra padronizar formato.
    </p>
    <div id="a-fs-list" style="display:flex;flex-direction:column;gap:8px;">
      ${!examples.length ? '<p style="font-size:0.75rem;color:var(--text-muted);text-align:center;padding:12px;border:1px dashed var(--border-subtle);border-radius:6px;">Nenhum exemplo. Click + Adicionar pra criar.</p>'
        : examples.map((ex, i) => `
          <div style="border:1px solid var(--border-subtle);border-radius:6px;padding:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <small style="color:var(--text-muted);font-weight:600;">EXEMPLO ${i+1}</small>
              <button class="btn btn-ghost btn-sm a-fs-del" data-i="${i}" style="color:#EF4444;">✕</button>
            </div>
            <textarea class="form-textarea a-fs-input" data-i="${i}" data-field="input" rows="2"
              placeholder="Mensagem do usuário" style="font-size:0.75rem;margin-bottom:4px;">${esc(ex.input||'')}</textarea>
            <textarea class="form-textarea a-fs-input" data-i="${i}" data-field="output" rows="3"
              placeholder="Resposta ideal do agente" style="font-size:0.75rem;">${esc(ex.output||'')}</textarea>
          </div>
        `).join('')}
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
            <select class="a-kb-source-type form-select" data-i="${i}" style="width:140px;font-size:0.75rem;">
              <option value="url"        ${s.type==='url'?'selected':''}>🔗 URL</option>
              <option value="r2"         ${s.type==='r2'?'selected':''}>☁ R2 path</option>
              <option value="sharepoint" ${s.type==='sharepoint'?'selected':''}>Ⓜ SharePoint</option>
              <option value="gdrive"     ${s.type==='gdrive'?'selected':''}>📁 Google Drive</option>
              <option value="github"     ${s.type==='github'?'selected':''}>💻 GitHub</option>
              <option value="webhook"    ${s.type==='webhook'?'selected':''}>🪝 Webhook</option>
            </select>
            ${s.type === 'url' ? `<input type="url" class="a-kb-source-input form-input" data-i="${i}" data-field="url"
              value="${esc(s.url||'')}" placeholder="https://..." style="flex:1;font-size:0.8125rem;" />`
            : s.type === 'r2' ? `<input type="text" class="a-kb-source-input form-input" data-i="${i}" data-field="path"
              value="${esc(s.path||'')}" placeholder="docs/sla/" style="flex:1;font-size:0.8125rem;" />`
            : s.type === 'gdrive' ? `<input type="text" class="a-kb-source-input form-input" data-i="${i}" data-field="folderId"
                value="${esc(s.folderId || s.fileId || '')}" placeholder="ID da pasta ou arquivo (do Drive URL)" style="flex:1;font-size:0.8125rem;font-family:monospace;" />
              <button class="btn btn-secondary btn-sm a-kb-gdrive-pick" data-i="${i}" title="Escolher do Drive" style="font-size:0.75rem;">📁 Picker</button>`
            : s.type === 'github' ? `<div style="display:flex;flex-direction:column;gap:4px;flex:1;">
                <input type="text" class="a-kb-source-input form-input" data-i="${i}" data-field="repo"
                  value="${esc(s.repo||'')}" placeholder="owner/repo (ex: primetour/tarefas)" style="font-size:0.75rem;font-family:monospace;" />
                <div style="display:flex;gap:4px;">
                  <input type="text" class="a-kb-source-input form-input" data-i="${i}" data-field="path"
                    value="${esc(s.path||'')}" placeholder="path (ex: docs/) — vazio = raiz" style="font-size:0.75rem;flex:1;" />
                  <input type="text" class="a-kb-source-input form-input" data-i="${i}" data-field="branch"
                    value="${esc(s.branch||'main')}" placeholder="branch" style="font-size:0.75rem;width:80px;" />
                </div>
              </div>`
            : s.type === 'webhook' ? `<div style="display:flex;flex-direction:column;gap:4px;flex:1;">
                <div style="display:flex;gap:4px;">
                  <select class="a-kb-source-input form-select" data-i="${i}" data-field="method" style="font-size:0.75rem;width:80px;">
                    <option value="GET"  ${s.method==='GET'||!s.method?'selected':''}>GET</option>
                    <option value="POST" ${s.method==='POST'?'selected':''}>POST</option>
                  </select>
                  <input type="url" class="a-kb-source-input form-input" data-i="${i}" data-field="url"
                    value="${esc(s.url||'')}" placeholder="https://api.exemplo.com/data" style="font-size:0.75rem;flex:1;" />
                </div>
              </div>`
            : `<div style="display:flex;flex-direction:column;gap:4px;flex:1;">
                <input type="text" class="a-kb-source-input form-input" data-i="${i}" data-field="siteId"
                  value="${esc(s.siteId||'')}" placeholder="Site ID (Graph)" style="font-size:0.75rem;font-family:monospace;" />
                <input type="text" class="a-kb-source-input form-input" data-i="${i}" data-field="driveId"
                  value="${esc(s.driveId||'')}" placeholder="Drive ID" style="font-size:0.75rem;font-family:monospace;" />
                <input type="text" class="a-kb-source-input form-input" data-i="${i}" data-field="folderPath"
                  value="${esc(s.folderPath||s.folder||'')}" placeholder="Caminho da pasta (opcional)" style="font-size:0.75rem;" />
              </div>`}
            <button class="btn btn-ghost btn-sm a-kb-source-remove" data-i="${i}" title="Remover">✕</button>
          </div>
        `).join('')}
    </div>
  `;
}

function subTabTools(a) {
  // Descoberta dinâmica de tools (Fase 6)
  let toolCatalog = { global: [], byModule: {} };
  try {
    // Lazy import síncrono não funciona; fazemos placeholder e binding async em renderSubTab
    const sync = window.__toolCatalogCache;
    if (sync) toolCatalog = sync;
  } catch {}

  const moduleTools = toolCatalog.byModule[a.module] || [];
  const enabledSet = new Set(a.enabledTools || []);
  const showList = a.toolsMode === 'manual';

  const renderToolList = (tools, label) => `
    <div style="margin-top:12px;">
      <div style="font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;margin-bottom:6px;">${label} (${tools.length})</div>
      <div style="max-height:200px;overflow:auto;border:1px solid var(--border-subtle);border-radius:6px;padding:8px;">
        ${!tools.length ? '<p style="font-size:0.75rem;color:var(--text-muted);">Nenhuma tool disponível neste módulo.</p>'
          : tools.map(t => `
            <label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:0.8125rem;">
              <input type="checkbox" class="a-tool-toggle" data-name="${esc(t.name)}"
                ${enabledSet.has(t.name) ? 'checked' : ''} ${a.toolsMode!=='manual'?'disabled':''} />
              <code style="font-family:var(--font-mono,monospace);font-size:0.75rem;">${esc(t.name)}</code>
              <span style="color:var(--text-muted);font-size:0.75rem;">${esc(t.description||'')}</span>
            </label>
          `).join('')}
      </div>
    </div>
  `;

  return `
    <h3 style="margin:0 0 12px;font-size:1.0625rem;">Ferramentas (Tools)</h3>
    <div class="form-group">
      <label class="form-label">Modo</label>
      <select id="a-tools-mode" class="form-select">
        <option value="auto"   ${a.toolsMode==='auto'?'selected':''}>Auto (todas as tools do módulo)</option>
        <option value="manual" ${a.toolsMode==='manual'?'selected':''}>Manual (selecionar específicas)</option>
      </select>
    </div>
    <div id="a-tools-catalog">
      ${renderToolList(moduleTools, `Tools do módulo ${a.module}`)}
      ${renderToolList(toolCatalog.global, 'Tools globais')}
    </div>
    <div class="form-group" style="margin-top:16px;">
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

function subTabSite(a) {
  const s = a.site || {};
  const prompts = s.suggestedPrompts || [];
  const slug = a.triggers?.publicChat?.slug || '';
  const publicUrl = slug
    ? `${location.origin}/tarefas/agente.html?slug=${encodeURIComponent(slug)}`
    : `${location.origin}/tarefas/agente.html?id=${a.id || '<id>'}`;
  const embedCode = `<iframe src="${publicUrl}" width="100%" height="700" frameborder="0" allow="microphone"></iframe>`;

  const isPublicEnabled = a.triggers?.publicChat?.enabled;

  return `
    <h3 style="margin:0 0 12px;font-size:1.0625rem;">Site público do agente</h3>
    <p style="font-size:0.8125rem;color:var(--text-muted);margin:0 0 14px;">
      Cada agente pode ter uma página pública em formato microsite (hero + descrição +
      prompts sugeridos + chat). Ative em <strong>Triggers → Página de chat pública</strong>
      e configure aqui a aparência/conteúdo.
    </p>

    ${!isPublicEnabled ? `
      <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);
        padding:12px;border-radius:6px;margin-bottom:14px;font-size:0.8125rem;color:var(--text-secondary);">
        ⚠ <strong>Página pública desabilitada.</strong>
        Vá em <strong>Triggers</strong>, marque "🌐 Página de chat pública" e defina um slug.
      </div>
    ` : `
      <div style="background:var(--bg-surface);padding:12px;border-radius:6px;margin-bottom:14px;font-size:0.8125rem;">
        <div style="font-weight:600;margin-bottom:6px;">🔗 URL do site:</div>
        <code style="font-size:0.75rem;word-break:break-all;color:var(--brand-gold);">${esc(publicUrl)}</code>
        <div style="margin-top:8px;display:flex;gap:6px;">
          <a href="${esc(publicUrl)}" target="_blank" class="btn btn-primary btn-sm">⤢ Abrir</a>
          <button class="btn btn-secondary btn-sm" id="a-site-copy-url">📋 Copiar URL</button>
          <button class="btn btn-secondary btn-sm" id="a-site-copy-embed">&lt;&gt; Copiar embed</button>
        </div>
      </div>
    `}

    <div class="form-group">
      <label class="form-label">Mensagem de boas-vindas (mostrada no topo do chat)</label>
      <textarea id="a-site-welcome" class="form-textarea" rows="2"
        placeholder="Ex: Olá! Sou ${esc(a.name||'o agente')}. Posso te ajudar a planejar viagens, criar conteúdo etc.">${esc(s.welcomeMessage||'')}</textarea>
    </div>

    <div class="form-group">
      <label class="form-label">Tagline (subtítulo do hero)</label>
      <input type="text" id="a-site-tagline" class="form-input" value="${esc(s.tagline||'')}"
        placeholder="Ex: Seu assistente de viagens 24/7" />
    </div>

    <h4 style="font-size:0.875rem;margin:18px 0 8px;display:flex;justify-content:space-between;align-items:center;">
      Prompts sugeridos (botões clicáveis)
      <button class="btn btn-secondary btn-sm" id="a-site-prompt-add">+ Adicionar</button>
    </h4>
    <p style="font-size:0.6875rem;color:var(--text-muted);margin:0 0 8px;">
      Aparecem como botões abaixo da descrição. Click do user envia o prompt automaticamente.
    </p>
    <div id="a-site-prompts" style="display:flex;flex-direction:column;gap:6px;">
      ${prompts.length === 0 ? '<p style="font-size:0.75rem;color:var(--text-muted);text-align:center;padding:10px;border:1px dashed var(--border-subtle);border-radius:6px;">Nenhum prompt sugerido. Click + Adicionar.</p>'
        : prompts.map((p, i) => `
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="text" class="form-input a-site-prompt-input" data-i="${i}"
              value="${esc(p)}" placeholder="Ex: Como cancelar minha reserva?" style="flex:1;font-size:0.8125rem;" />
            <button class="btn btn-ghost btn-sm a-site-prompt-del" data-i="${i}" style="color:#EF4444;">✕</button>
          </div>
        `).join('')}
    </div>

    <div style="display:grid;grid-template-columns:140px 1fr;gap:12px;margin-top:18px;">
      <div class="form-group" style="margin:0;">
        <label class="form-label">Cor primária</label>
        <input type="color" id="a-site-color" class="form-input" value="${esc(s.brandColor||'#2563EB')}"
          style="height:42px;cursor:pointer;" />
      </div>
      <div class="form-group" style="margin:0;">
        <label class="form-label">Texto do rodapé</label>
        <input type="text" id="a-site-footer" class="form-input" value="${esc(s.footerText||'Powered by PRIMETOUR')}" />
      </div>
    </div>

    <div class="form-group" style="margin-top:14px;">
      <label style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg-surface);border-radius:6px;">
        <input type="checkbox" id="a-site-show-avatar" ${s.showAvatar!==false?'checked':''} />
        <span>Mostrar avatar no hero</span>
      </label>
    </div>
    <div class="form-group">
      <label style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg-surface);border-radius:6px;">
        <input type="checkbox" id="a-site-show-branding" ${s.showBranding!==false?'checked':''} />
        <span>Mostrar branding "Powered by PRIMETOUR" no rodapé</span>
      </label>
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
async function renderApiKeysTab(container) {
  const ai = await import('../services/ai.js');
  let global = null, scoped = [];
  try {
    global = await ai.getAIConfig() || {};
    scoped = await ai.listAllScopedConfigs();
  } catch (e) {
    container.innerHTML = `<p style="color:var(--color-danger);padding:24px;">Erro: ${esc(e.message)}</p>`;
    return;
  }

  const maskKey = (k) => {
    if (!k) return '—';
    if (k.length <= 12) return '••••••';
    return k.slice(0, 4) + '••••••••' + k.slice(-4);
  };
  const providerStatus = (cfg, provider) => {
    const k = cfg?.[provider + 'ApiKey'];
    return k ? { has: true, masked: maskKey(k), len: k.length } : { has: false };
  };
  const providers = ai.AI_PROVIDERS;

  function paint() {
    container.innerHTML = `
      <p style="color:var(--text-muted);font-size:0.8125rem;margin-bottom:16px;">
        Chaves usadas pelos agentes. Resolução em cascata:
        <strong>Usuário → Núcleo → Setor → Workspace → Global</strong>.
      </p>

      <div class="card" style="margin-bottom:16px;">
        <div class="card-header">
          <div class="card-title">🌐 Global (fallback padrão)</div>
          <button class="btn btn-secondary btn-sm" id="ak-edit-global">✎ Editar</button>
        </div>
        <div class="card-body" style="padding:0;">
          <table class="data-table" style="width:100%;font-size:0.8125rem;">
            <thead><tr><th>Provider</th><th>Status</th><th>Chave (mascarada)</th><th style="text-align:right;">Tamanho</th></tr></thead>
            <tbody>${providers.map(p => {
              const s = providerStatus(global, p.id);
              return `<tr style="${s.has?'':'opacity:0.55;'}">
                <td><strong>${esc(p.icon)} ${esc(p.label)}</strong></td>
                <td>${s.has ? '<span style="color:#22C55E;">✓ Configurada</span>' : '<span style="color:#9CA3AF;">— Vazia</span>'}</td>
                <td style="font-family:var(--font-mono,monospace);">${esc(s.masked || '—')}</td>
                <td style="text-align:right;">${s.len ? s.len + ' chars' : '—'}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">🎯 Chaves por escopo</div>
            <div class="card-subtitle" style="font-size:0.75rem;color:var(--text-muted);">
              ${scoped.length} configuração(ões). Override por usuário/núcleo/setor/workspace.
            </div>
          </div>
          <button class="btn btn-primary btn-sm" id="ak-new-scoped">+ Nova escopada</button>
        </div>
        <div class="card-body" style="padding:0;">
          ${!scoped.length ? '<div class="empty-state" style="padding:24px;"><div class="empty-state-title" style="font-size:0.875rem;">Sem chaves escopadas. Todos usam a global.</div></div>'
            : `<table class="data-table" style="width:100%;font-size:0.8125rem;">
              <thead><tr>
                <th>Escopo</th><th>Identificador</th><th>Providers</th>
                <th>Status</th><th style="text-align:right;">Ações</th>
              </tr></thead>
              <tbody>${scoped.map(s => {
                const provs = providers.filter(p => s[p.id + 'ApiKey']).map(p => p.label);
                return `<tr>
                  <td><strong>${esc(s.scope)}</strong></td>
                  <td>${esc(s.scopeLabel || s.scopeId || '—')}</td>
                  <td style="font-size:0.75rem;">${provs.length ? provs.join(', ') : '—'}</td>
                  <td>${s.active === false ? '<span style="color:#F59E0B;">⏸ Pausada</span>' : '<span style="color:#22C55E;">✓ Ativa</span>'}</td>
                  <td style="text-align:right;white-space:nowrap;">
                    <button class="btn btn-secondary btn-sm" data-act="ak-edit" data-id="${s.id}">✎</button>
                    <button class="btn btn-ghost btn-sm" data-act="ak-del" data-id="${s.id}" style="color:#EF4444;">🗑</button>
                  </td>
                </tr>`;
              }).join('')}</tbody>
            </table>`}
        </div>
      </div>
    `;

    document.getElementById('ak-edit-global')?.addEventListener('click', () => openKeyEditor(null, global, false, true));
    document.getElementById('ak-new-scoped')?.addEventListener('click', () => openKeyEditor(null, null, true));
    container.querySelectorAll('[data-act="ak-edit"]').forEach(b =>
      b.addEventListener('click', () => openKeyEditor(b.dataset.id, scoped.find(s => s.id === b.dataset.id))));
    container.querySelectorAll('[data-act="ak-del"]').forEach(b =>
      b.addEventListener('click', async () => {
        if (!confirm('Excluir esta configuração de chave? Agentes usando este escopo passarão a usar o fallback.')) return;
        try {
          await ai.deleteScopedApiConfig(b.dataset.id);
          toast.success('Excluída.');
          scoped = await ai.listAllScopedConfigs();
          paint();
        } catch (e) { toast.error(e.message); }
      }));
  }

  function openKeyEditor(scopedId, data, isNewScoped = false, isGlobal = false) {
    const d = data || {};
    modal.open({
      title: isGlobal ? '✎ Editar chaves globais' : (scopedId ? '✎ Editar chave escopada' : '+ Nova chave escopada'),
      size: 'lg',
      dedupeKey: 'ak-edit:' + (scopedId || (isGlobal ? 'global' : 'new')),
      content: `
        ${!isGlobal ? `
          <div style="display:grid;grid-template-columns:140px 1fr;gap:10px;margin-bottom:16px;">
            <div class="form-group" style="margin:0;">
              <label class="form-label">Escopo</label>
              <select id="ak-scope" class="form-select">
                <option value="user"      ${d.scope==='user'?'selected':''}>Usuário</option>
                <option value="nucleo"    ${d.scope==='nucleo'?'selected':''}>Núcleo</option>
                <option value="area"      ${d.scope==='area'?'selected':''}>Área/Setor</option>
                <option value="workspace" ${d.scope==='workspace'?'selected':''}>Workspace</option>
              </select>
            </div>
            <div class="form-group" style="margin:0;">
              <label class="form-label">Identificador (uid, nome de núcleo, setor, etc.)</label>
              <input type="text" id="ak-scope-id" class="form-input" value="${esc(d.scopeId||'')}" placeholder="Ex: Marketing" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Rótulo descritivo</label>
            <input type="text" id="ak-scope-label" class="form-input" value="${esc(d.scopeLabel||'')}" placeholder="Ex: Time de Marketing" />
          </div>
          <hr style="border-color:var(--border-subtle);margin:16px 0;" />
        ` : ''}

        ${providers.map(p => `
          <div class="form-group">
            <label class="form-label">${esc(p.icon)} ${esc(p.label)}${p.signupUrl ? ` <a href="${esc(p.signupUrl)}" target="_blank" style="font-weight:400;font-size:0.75rem;">obter chave →</a>` : ''}</label>
            <input type="password" id="ak-${p.id}" class="form-input" value="${esc(d[p.id+'ApiKey']||'')}"
              placeholder="${p.id === 'local' ? 'Endpoint, ex: http://localhost:11434' : 'sk-... / AIza... / gsk_...'}"
              style="font-family:var(--font-mono,monospace);font-size:0.8125rem;" autocomplete="new-password" />
          </div>
        `).join('')}

        <div class="form-group">
          <label class="form-label">⚙ Endpoint local (Ollama)</label>
          <input type="text" id="ak-local" class="form-input" value="${esc(d.localEndpoint||'')}" placeholder="http://localhost:11434" />
        </div>

        ${!isGlobal ? `
          <div class="form-group">
            <label style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg-surface);border-radius:6px;">
              <input type="checkbox" id="ak-active" ${d.active!==false?'checked':''} />
              <strong>Configuração ativa</strong>
            </label>
          </div>
        ` : ''}
      `,
      footer: [
        { label: 'Cancelar', class: 'btn-secondary' },
        { label: '💾 Salvar', class: 'btn-primary', closeOnClick: false, onClick: async (_, { close }) => {
          const payload = {};
          providers.forEach(p => {
            const v = document.getElementById('ak-' + p.id)?.value || '';
            if (v) payload[p.id + 'ApiKey'] = v;
          });
          const localEp = document.getElementById('ak-local')?.value || '';
          if (localEp) payload.localEndpoint = localEp;

          try {
            if (isGlobal) {
              await ai.saveAIConfig(payload);
              toast.success('Chaves globais atualizadas.');
              global = await ai.getAIConfig() || {};
            } else {
              const scope     = document.getElementById('ak-scope').value;
              const scopeId   = document.getElementById('ak-scope-id').value.trim();
              const scopeLabel = document.getElementById('ak-scope-label').value.trim() || scopeId;
              const active    = document.getElementById('ak-active')?.checked !== false;
              if (!scopeId) return toast.error('Informe o identificador do escopo.');
              await ai.saveScopedApiConfig(scope, scopeId, scopeLabel, { ...payload, active });
              toast.success('Chave escopada salva.');
              scoped = await ai.listAllScopedConfigs();
            }
            close();
            paint();
          } catch (e) { toast.error(e.message); }
        }},
      ],
    });
  }

  paint();
}

async function renderKnowledgeTab(container) {
  let docs = await fetchKnowledge().catch(() => []);

  function paint() {
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <p style="color:var(--text-muted);font-size:0.8125rem;margin:0;">
          ${docs.length} documento(s). Agentes referenciam estes docs em "Editor → Conhecimento".
        </p>
        <div style="display:flex;gap:8px;">
          <input type="file" id="kb-upload" accept=".md,.txt,.json,.csv" multiple style="display:none;" />
          <button class="btn btn-secondary btn-sm" id="kb-upload-btn">📎 Upload .md/.txt</button>
          <button class="btn btn-primary btn-sm" id="kb-new">+ Novo doc</button>
        </div>
      </div>

      ${!docs.length ? `<div class="empty-state" style="min-height:30vh;">
        <div class="empty-state-icon">📚</div>
        <div class="empty-state-title">Sem documentos ainda</div>
        <p class="text-sm text-muted">Crie um doc novo, faça upload de .md ou cole conteúdo.</p>
      </div>`
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">
        ${docs.map(d => `<div class="card" style="padding:14px;">
          <div style="display:flex;align-items:start;gap:8px;margin-bottom:8px;">
            <div style="font-size:1.25rem;">${d.type==='url'?'🔗':'📄'}</div>
            <div style="flex:1;min-width:0;">
              <strong style="font-size:0.9375rem;display:block;">${esc(d.title||'Sem título')}</strong>
              <small style="color:var(--text-muted);font-size:0.6875rem;">${d.charCount||0} chars · ${esc(d.folder||'sem pasta')}</small>
            </div>
          </div>
          <p style="font-size:0.75rem;color:var(--text-secondary);line-height:1.5;
            margin:0 0 10px;max-height:60px;overflow:hidden;
            display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;">
            ${esc((d.content || d.sourceUrl || '').slice(0, 200))}
          </p>
          <div style="display:flex;gap:4px;">
            <button class="btn btn-secondary btn-sm" data-act="kb-edit" data-id="${d.id}">✎</button>
            <button class="btn btn-ghost btn-sm" data-act="kb-del" data-id="${d.id}" style="color:#EF4444;">🗑</button>
          </div>
        </div>`).join('')}
      </div>`}
    `;

    container.querySelectorAll('[data-act="kb-edit"]').forEach(b =>
      b.addEventListener('click', () => openKnowledgeEditor(docs.find(x => x.id === b.dataset.id))));
    container.querySelectorAll('[data-act="kb-del"]').forEach(b =>
      b.addEventListener('click', async () => {
        if (!confirm('Excluir este doc? Agentes que o referenciam vão perdê-lo.')) return;
        try { await deleteKnowledgeDoc(b.dataset.id); docs = await fetchKnowledge(); paint(); toast.success('Excluído.'); }
        catch (e) { toast.error(e.message); }
      }));
    document.getElementById('kb-new')?.addEventListener('click', () => openKnowledgeEditor(null));
    document.getElementById('kb-upload-btn')?.addEventListener('click', () => document.getElementById('kb-upload').click());
    document.getElementById('kb-upload')?.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      for (const f of files) {
        try {
          const text = await f.text();
          await createKnowledgeDoc({
            title: f.name.replace(/\.[^.]+$/, ''),
            content: text,
            type: 'text',
            folder: 'Uploads',
          });
        } catch (err) { toast.error(`${f.name}: ${err.message}`); }
      }
      docs = await fetchKnowledge(); paint();
      toast.success(`${files.length} arquivo(s) importado(s).`);
    });
  }

  function openKnowledgeEditor(doc) {
    const isNew = !doc;
    const d = doc || { title: '', content: '', folder: '', type: 'text', sourceUrl: '' };
    modal.open({
      title: isNew ? '+ Novo documento' : '✎ Editar documento',
      size: 'lg',
      dedupeKey: 'kb:' + (doc?.id || 'new'),
      content: `
        <div class="form-group">
          <label class="form-label">Título</label>
          <input type="text" id="kb-f-title" class="form-input" value="${esc(d.title)}" placeholder="Ex: SLA por tipo de tarefa" />
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">Pasta (organização)</label>
            <input type="text" id="kb-f-folder" class="form-input" value="${esc(d.folder)}" placeholder="Ex: Procedimentos" />
          </div>
          <div class="form-group">
            <label class="form-label">Tipo</label>
            <select id="kb-f-type" class="form-select">
              <option value="text" ${d.type==='text'?'selected':''}>Texto</option>
              <option value="url"  ${d.type==='url'?'selected':''}>URL (snapshot)</option>
            </select>
          </div>
        </div>
        <div class="form-group" id="kb-url-group" style="${d.type==='url'?'':'display:none;'}">
          <label class="form-label">URL fonte</label>
          <input type="url" id="kb-f-url" class="form-input" value="${esc(d.sourceUrl)}" placeholder="https://..." />
        </div>
        <div class="form-group">
          <label class="form-label">Conteúdo (markdown ou texto)</label>
          <textarea id="kb-f-content" class="form-textarea" rows="12" style="font-family:var(--font-mono,monospace);font-size:0.8125rem;">${esc(d.content)}</textarea>
        </div>
      `,
      footer: [
        { label: 'Cancelar', class: 'btn-secondary' },
        { label: '💾 Salvar', class: 'btn-primary', closeOnClick: false, onClick: async (_, { close }) => {
          const data = {
            title: document.getElementById('kb-f-title').value,
            content: document.getElementById('kb-f-content').value,
            folder: document.getElementById('kb-f-folder').value,
            type: document.getElementById('kb-f-type').value,
            sourceUrl: document.getElementById('kb-f-url').value,
          };
          if (!data.title.trim()) return toast.error('Defina um título.');
          try {
            if (isNew) await createKnowledgeDoc(data);
            else await updateKnowledgeDoc(doc.id, data);
            toast.success('Salvo.');
            close();
            docs = await fetchKnowledge(); paint();
          } catch (e) { toast.error(e.message); }
        }},
      ],
    });
    setTimeout(() => {
      document.getElementById('kb-f-type')?.addEventListener('change', (e) => {
        document.getElementById('kb-url-group').style.display = e.target.value === 'url' ? 'block' : 'none';
      });
    }, 60);
  }

  paint();
}

async function renderLogsTab(container) {
  // Lê últimos 200 logs com filtro por agente
  const { collection, getDocs, query, orderBy, limit } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  const { db } = await import('../firebase.js');
  let agents = await fetchAgents();
  let logs = [];
  try {
    const snap = await getDocs(query(collection(db, 'ai_usage_logs'), limit(500)));
    logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    logs.sort((a, b) => {
      const ta = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : 0;
      const tb = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : 0;
      return tb - ta;
    });
  } catch (e) {
    container.innerHTML = `<p style="color:var(--color-danger);padding:24px;">Erro: ${esc(e.message)}</p>`;
    return;
  }
  let filterAgent = '';
  function paint() {
    const filtered = filterAgent ? logs.filter(l => l.agentId === filterAgent) : logs;
    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
        <label style="font-size:0.8125rem;color:var(--text-secondary);">Filtrar por agente:</label>
        <select class="form-select" id="logs-filter" style="width:auto;font-size:0.8125rem;">
          <option value="">Todos (${logs.length})</option>
          ${agents.map(a => `<option value="${esc(a.id)}" ${a.id===filterAgent?'selected':''}>${esc(a.name)}</option>`).join('')}
        </select>
        <span style="margin-left:auto;font-size:0.75rem;color:var(--text-muted);">${filtered.length} entradas</span>
      </div>
      <div class="card" style="padding:0;">
        <table class="data-table" style="width:100%;font-size:0.8125rem;">
          <thead><tr>
            <th>Quando</th><th>Agente</th><th>Provider</th>
            <th style="text-align:right;">In</th><th style="text-align:right;">Out</th>
            <th style="text-align:right;">≈ USD</th><th>Origem</th>
          </tr></thead>
          <tbody>${!filtered.length ? '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">Sem logs.</td></tr>'
            : filtered.slice(0, 200).map(l => {
              const cost = estimateCost(l.provider, l.model, l.inputTokens, l.outputTokens);
              const ts = l.timestamp?.toDate ? l.timestamp.toDate().toLocaleString('pt-BR') : '—';
              return `<tr>
                <td style="font-size:0.75rem;">${ts}</td>
                <td>${esc(l.agentName || l.skillName || '—')}</td>
                <td>${esc(l.provider||'')} · ${esc((l.model||'').slice(0,20))}</td>
                <td style="text-align:right;">${l.inputTokens||0}</td>
                <td style="text-align:right;">${l.outputTokens||0}</td>
                <td style="text-align:right;color:${cost>0.01?'#F59E0B':'var(--text-muted)'};">$${cost.toFixed(4)}</td>
                <td style="font-size:0.6875rem;color:var(--text-muted);">${esc(l.source||'app')}</td>
              </tr>`;
            }).join('')}</tbody>
        </table>
      </div>
    `;
    document.getElementById('logs-filter')?.addEventListener('change', (e) => {
      filterAgent = e.target.value; paint();
    });
  }
  paint();
}

async function renderCostsTab(container) {
  const { collection, getDocs, query, where, limit, Timestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  const { db } = await import('../firebase.js');
  // Últimos 30 dias
  const since = new Date(); since.setDate(since.getDate() - 30);
  let logs = [];
  try {
    const snap = await getDocs(query(collection(db, 'ai_usage_logs'),
      where('timestamp', '>=', Timestamp.fromDate(since)),
      limit(2000)));
    logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    container.innerHTML = `<p style="color:var(--color-danger);padding:24px;">Erro: ${esc(e.message)}</p>`;
    return;
  }

  let totalCost = 0, totalIn = 0, totalOut = 0;
  const byAgent = new Map();
  const byProvider = new Map();
  const byDay = new Map();
  logs.forEach(l => {
    const cost = estimateCost(l.provider, l.model, l.inputTokens, l.outputTokens);
    totalCost += cost; totalIn += l.inputTokens||0; totalOut += l.outputTokens||0;
    const aKey = l.agentName || l.skillName || '—';
    if (!byAgent.has(aKey)) byAgent.set(aKey, { calls:0, cost:0, inT:0, outT:0 });
    const a = byAgent.get(aKey); a.calls++; a.cost += cost; a.inT += l.inputTokens||0; a.outT += l.outputTokens||0;
    const pKey = l.provider || '—';
    if (!byProvider.has(pKey)) byProvider.set(pKey, { calls:0, cost:0 });
    const p = byProvider.get(pKey); p.calls++; p.cost += cost;
    const day = l.timestamp?.toDate ? l.timestamp.toDate().toISOString().slice(0,10) : '?';
    if (!byDay.has(day)) byDay.set(day, { calls:0, cost:0 });
    const d = byDay.get(day); d.calls++; d.cost += cost;
  });

  const topAgents = [...byAgent.entries()].sort((a,b) => b[1].cost - a[1].cost).slice(0,10);
  const days = [...byDay.entries()].sort((a,b) => a[0].localeCompare(b[0]));
  const maxDayCost = Math.max(0.001, ...days.map(d => d[1].cost));

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:24px;">
      ${[
        { l: 'Custo total (30d)', v: '$ ' + totalCost.toFixed(2), c: totalCost>1 ? '#F59E0B':'#22C55E' },
        { l: 'Chamadas', v: logs.length, c: '#3B82F6' },
        { l: 'Tokens entrada', v: totalIn.toLocaleString('pt-BR'), c: '#A78BFA' },
        { l: 'Tokens saída', v: totalOut.toLocaleString('pt-BR'), c: '#A78BFA' },
        { l: 'Agentes ativos', v: byAgent.size, c: '#06B6D4' },
      ].map(c => `<div class="card" style="padding:14px;border-left:3px solid ${c.c};">
        <div style="font-size:0.6875rem;color:var(--text-muted);text-transform:uppercase;">${c.l}</div>
        <div style="font-size:1.5rem;font-weight:700;color:${c.c};margin-top:4px;">${c.v}</div>
      </div>`).join('')}
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div class="card-header"><div class="card-title">📊 Custo diário (últimos 30d)</div></div>
      <div class="card-body" style="padding:16px;">
        <div style="display:flex;align-items:flex-end;gap:3px;height:140px;">
          ${days.map(([day, d]) => {
            const h = (d.cost / maxDayCost) * 100;
            return `<div title="${esc(day)}: $${d.cost.toFixed(3)} (${d.calls} calls)"
              style="flex:1;background:linear-gradient(to top,#2563EB,#60A5FA);height:${h}%;min-height:2px;border-radius:2px 2px 0 0;"></div>`;
          }).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;font-size:0.6875rem;color:var(--text-muted);margin-top:6px;">
          <span>${days[0]?.[0] || ''}</span><span>${days[days.length-1]?.[0] || ''}</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div class="card-title">🏆 Top agentes por custo</div></div>
      <div class="card-body" style="padding:0;">
        <table class="data-table" style="width:100%;font-size:0.8125rem;">
          <thead><tr><th>Agente</th><th style="text-align:right;">Calls</th><th style="text-align:right;">Tokens In/Out</th><th style="text-align:right;">≈ USD</th></tr></thead>
          <tbody>${topAgents.map(([name, a]) => `<tr>
            <td><strong>${esc(name)}</strong></td>
            <td style="text-align:right;">${a.calls}</td>
            <td style="text-align:right;">${a.inT.toLocaleString('pt-BR')} / ${a.outT.toLocaleString('pt-BR')}</td>
            <td style="text-align:right;color:${a.cost>0.5?'#F59E0B':'var(--text-secondary)'};font-weight:600;">$${a.cost.toFixed(3)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>
  `;
}

/* Estimativa simplificada de custo USD (preço por 1M tokens) */
function estimateCost(provider, model, inT, outT) {
  const PRICES = {
    // Anthropic (USD per 1M tokens)
    'claude-opus-4-6':   { in: 15,    out: 75 },
    'claude-sonnet-4-6': { in: 3,     out: 15 },
    'claude-haiku-4-5':  { in: 0.80,  out: 4 },
    // OpenAI
    'gpt-4o':            { in: 2.50,  out: 10 },
    'gpt-4o-mini':       { in: 0.15,  out: 0.60 },
    'gpt-4.1':           { in: 2.00,  out: 8 },
    'gpt-4.1-mini':      { in: 0.40,  out: 1.60 },
    'o4-mini':           { in: 1.10,  out: 4.40 },
    // Gemini (grátis dentro de quota)
    'gemini-2.5-flash':  { in: 0,     out: 0 },
    'gemini-2.5-pro':    { in: 0,     out: 0 },
    // Groq (grátis)
    'llama-3.3-70b-versatile': { in: 0, out: 0 },
    'llama-3.1-8b-instant':    { in: 0, out: 0 },
  };
  const p = PRICES[model] || { in: 1, out: 3 }; // default conservador
  return ((inT||0) * p.in + (outT||0) * p.out) / 1_000_000;
}

/* ═══════════════════════════════════════════════════════════
 * TAB: MIGRAÇÃO (skills + automações → agents, com backup)
 * ═══════════════════════════════════════════════════════════ */
function renderMigrationTab(container) {
  container.innerHTML = `
    <!-- Seed agentes do sistema -->
    <div class="card" style="padding:20px;margin-bottom:16px;border:1px solid rgba(34,197,94,0.4);background:rgba(34,197,94,0.04);">
      <h3 style="margin:0 0 12px;">🌱 Criar agentes pré-configurados do sistema</h3>
      <p style="font-size:0.875rem;color:var(--text-secondary);line-height:1.6;margin-bottom:14px;">
        O sistema já tinha funcionalidades de IA embutidas em várias páginas (Roteiros, Portal de
        Dicas, Calendário de Conteúdo, Tarefas). Estes <strong>${SYSTEM_SEED_AGENTS.length} agentes-seed</strong>
        replicam essas features no Hub pra você ver/editar/personalizar pelos prompts.
      </p>
      <ul style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.7;margin:0 0 14px 20px;">
        ${SYSTEM_SEED_AGENTS.map(s => `<li><strong>${esc(s.icon)} ${esc(s.name)}</strong> — ${esc(s.description)}</li>`).join('')}
      </ul>
      <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:14px;">
        ✓ Idempotente — clicar várias vezes não duplica.
      </p>
      <button class="btn btn-primary" id="seed-run">🌱 Criar agentes do sistema</button>
      <div id="seed-result" style="display:none;margin-top:14px;"></div>
    </div>

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

  document.getElementById('seed-run')?.addEventListener('click', async () => {
    const btn = document.getElementById('seed-run');
    btn.disabled = true; btn.textContent = '⏳ Criando...';
    try {
      const report = await seedDefaultAgents();
      const out = document.getElementById('seed-result');
      out.style.display = 'block';
      out.innerHTML = `
        <div style="background:var(--bg-surface);padding:12px;border-radius:6px;font-size:0.8125rem;line-height:1.6;">
          <strong>Resultado:</strong>
          <ul style="margin:6px 0 0 20px;">
            <li>Criados: <strong>${report.created}</strong></li>
            <li>Pulados (já existiam): <strong>${report.skipped}</strong></li>
            ${report.errors.length ? `<li style="color:#EF4444;">Erros:<pre style="font-size:0.75rem;">${esc(report.errors.join('\n'))}</pre></li>` : ''}
          </ul>
          ${report.created ? '<p style="color:#22C55E;margin-top:8px;">✓ Vá pra aba Agentes pra ver/editar.</p>' : ''}
        </div>
      `;
      btn.disabled = false; btn.textContent = '🌱 Criar agentes do sistema';
    } catch (e) {
      toast.error(e.message);
      btn.disabled = false; btn.textContent = '🌱 Criar agentes do sistema';
    }
  });

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

/* ═══════════════════════════════════════════════════════════
 * TAB: CONEXÕES (Microsoft 365 / Google Drive / outros)
 * ═══════════════════════════════════════════════════════════ */
async function renderConnectionsTab(container) {
  const { store } = await import('../store.js');
  const gd = await import('../services/googleDrive.js');

  function paint() {
    const msToken    = store.get('msAccessToken');
    const msExpires  = store.get('msAccessTokenExpiresAt') || 0;
    const msActive   = msToken && Date.now() < msExpires;
    const msExpiresIn = msActive ? Math.round((msExpires - Date.now()) / 60000) : 0;

    const gToken = gd.getStoredGoogleToken();
    const gActive = !!gToken;
    const clientId = gd.getGoogleClientId();
    const hasGoogleClientId = clientId && !clientId.includes('PLACEHOLDER');

    container.innerHTML = `
      <p style="color:var(--text-muted);font-size:0.8125rem;margin-bottom:16px;">
        Plataformas externas que os agentes podem ler como base de conhecimento.
        Tokens vivem na sessão (sobrevivem reload, expiram em logout).
      </p>

      <!-- Microsoft 365 / SharePoint (App-only — nivel sistema) -->
      <div class="card" style="margin-bottom:16px;">
        <div class="card-header">
          <div>
            <div class="card-title">Ⓜ Microsoft 365 / SharePoint</div>
            <div class="card-subtitle" style="font-size:0.75rem;color:var(--text-muted);">
              <strong>Conexão de sistema</strong> (app-only). Independe do usuário logado.
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" id="sp-config">⚙ Configurar app</button>
        </div>
        <div class="card-body">
          <p style="font-size:0.8125rem;color:var(--text-secondary);margin:0 0 12px;line-height:1.6;">
            A IA é serviço do sistema, não do usuário. Você precisa criar UMA app registration no
            Azure AD e dar permissão a pastas/sites específicos. Depois, todos os agentes acessam
            essas pastas (independente de quem está logado).
          </p>
          <div style="background:var(--bg-surface);padding:12px;border-radius:6px;font-size:0.75rem;line-height:1.6;">
            <strong>Setup (5min, admin Azure):</strong>
            <ol style="margin:6px 0 0 18px;">
              <li>Vá em <a href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank">portal.azure.com → App registrations</a></li>
              <li>+ New registration · "PRIMETOUR IA Hub" · single tenant</li>
              <li>API permissions → Microsoft Graph → <strong>Application permissions</strong> → <code>Sites.Selected</code> ou <code>Sites.Read.All</code> · Grant admin consent</li>
              <li>Certificates & secrets → New client secret · copia o valor</li>
              <li>Anote: <code>Tenant ID</code>, <code>Client ID</code>, <code>Client Secret</code></li>
              <li>Click "⚙ Configurar app" acima e cole as 3 strings</li>
            </ol>
          </div>
        </div>
      </div>

      <!-- Google Drive -->
      <div class="card" style="margin-bottom:16px;">
        <div class="card-header">
          <div>
            <div class="card-title">📁 Google Drive</div>
            <div class="card-subtitle" style="font-size:0.75rem;color:var(--text-muted);">
              Conexão OAuth2 com sua conta Google. Suporta Docs, Sheets, Slides, txt, md.
            </div>
          </div>
          ${gActive
            ? `<span style="font-size:0.8125rem;color:#22C55E;font-weight:600;">✓ Conectado</span>`
            : `<span style="font-size:0.8125rem;color:#9CA3AF;font-weight:600;">— Não conectado</span>`}
        </div>
        <div class="card-body">
          ${!hasGoogleClientId ? `
            <div style="background:rgba(245,158,11,0.08);padding:12px;border-radius:6px;margin-bottom:12px;font-size:0.8125rem;">
              <strong>⚠ Configuração necessária:</strong> admin precisa criar um
              <strong>OAuth Client ID</strong> no Google Cloud Console:
              <ol style="margin:8px 0 0 20px;line-height:1.6;">
                <li>Acesse <a href="https://console.cloud.google.com/apis/credentials" target="_blank">console.cloud.google.com/apis/credentials</a></li>
                <li>Habilite <strong>Google Drive API</strong> no projeto</li>
                <li>Criar Credentials → OAuth Client ID → Web application</li>
                <li>Authorized JS origins: <code>https://primetour.github.io</code></li>
                <li>Cole o Client ID abaixo:</li>
              </ol>
              <div style="display:flex;gap:6px;margin-top:10px;">
                <input type="text" id="gd-client-id" class="form-input" placeholder="123456-xxx.apps.googleusercontent.com" style="flex:1;font-size:0.75rem;font-family:monospace;" />
                <button class="btn btn-primary btn-sm" id="gd-save-id">Salvar</button>
              </div>
            </div>
          ` : `
            <p style="font-size:0.75rem;color:var(--text-muted);margin:0 0 8px;">
              Client ID: <code style="font-size:0.6875rem;">${esc(clientId.split('-')[0])}-...</code>
              <button class="btn btn-ghost btn-sm" id="gd-change-id" style="font-size:0.75rem;margin-left:6px;">trocar</button>
            </p>
          `}
          <div style="display:flex;gap:6px;">
            ${gActive ? `
              <button class="btn btn-secondary btn-sm" id="gd-test">▶ Testar (lista pasta raiz)</button>
              <button class="btn btn-ghost btn-sm" id="gd-disconnect" style="color:#EF4444;">✕ Desconectar</button>
            ` : `
              <button class="btn btn-primary btn-sm" id="gd-connect" ${!hasGoogleClientId?'disabled':''}>🔐 Conectar Google</button>
            `}
          </div>
          <div id="gd-test-result" style="margin-top:10px;"></div>
        </div>
      </div>

      <!-- GitHub -->
      <div class="card" style="margin-bottom:16px;">
        <div class="card-header">
          <div>
            <div class="card-title">💻 GitHub</div>
            <div class="card-subtitle" style="font-size:0.75rem;color:var(--text-muted);">
              Lê READMEs, docs (.md/.txt/.json/.yml) de repositórios públicos ou privados.
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" id="gh-config">⚙ Token PAT (repos privados)</button>
        </div>
        <div class="card-body">
          <p style="font-size:0.8125rem;color:var(--text-secondary);margin:0 0 8px;">
            Repos <strong>públicos</strong> funcionam sem configuração. Pra <strong>privados</strong>,
            cole um Personal Access Token (PAT) com escopo <code>repo</code>.
          </p>
          <p style="font-size:0.75rem;color:var(--text-muted);margin:0;">
            Como agente: tipo <strong>github</strong> · campos <code>repo</code> (owner/name),
            <code>path</code>, <code>branch</code>.
          </p>
        </div>
      </div>

      <!-- Webhook -->
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">🪝 Webhook genérico</div>
            <div class="card-subtitle" style="font-size:0.75rem;color:var(--text-muted);">
              Qualquer endpoint REST que retorne texto/JSON. Usa fetch direto (CORS aplica).
            </div>
          </div>
        </div>
        <div class="card-body">
          <p style="font-size:0.8125rem;color:var(--text-secondary);margin:0;line-height:1.6;">
            Suporta GET ou POST com headers + body customizáveis. JSON é auto-formatado.
            Limite: 12KB por resposta. Configurado direto no agente (Knowledge Sources → tipo
            <strong>webhook</strong>).
          </p>
        </div>
      </div>
    `;

    // SharePoint app config (system-level)
    document.getElementById('sp-config')?.addEventListener('click', async () => {
      const { doc, getDoc, setDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const { db } = await import('../firebase.js');
      const cfgSnap = await getDoc(doc(db, 'system_config', 'sharepoint-app'));
      const cfg = cfgSnap.exists() ? cfgSnap.data() : {};
      modal.open({
        title: '⚙ Microsoft 365 — App Credentials',
        size: 'md',
        dedupeKey: 'sp-config',
        content: `
          <p style="font-size:0.8125rem;color:var(--text-muted);margin:0 0 14px;">
            Credenciais da App Registration do Azure AD. Salvas em <code>system_config/sharepoint-app</code>.
          </p>
          <div class="form-group">
            <label class="form-label">Tenant ID</label>
            <input type="text" id="sp-tid" class="form-input" value="${esc(cfg.tenantId||'')}" placeholder="00000000-0000-0000-0000-000000000000" style="font-family:monospace;font-size:0.8125rem;" />
          </div>
          <div class="form-group">
            <label class="form-label">Client ID (Application ID)</label>
            <input type="text" id="sp-cid" class="form-input" value="${esc(cfg.clientId||'')}" placeholder="00000000-0000-0000-0000-000000000000" style="font-family:monospace;font-size:0.8125rem;" />
          </div>
          <div class="form-group">
            <label class="form-label">Client Secret (valor)</label>
            <input type="password" id="sp-sec" class="form-input" value="${esc(cfg.clientSecret||'')}" placeholder="copie o VALUE (não o ID) do secret recém criado" style="font-family:monospace;font-size:0.8125rem;" autocomplete="new-password" />
            <small style="color:var(--text-muted);font-size:0.6875rem;">Visível apenas na criação. Se perdeu, gere outro.</small>
          </div>
          <div id="sp-test-result" style="margin-top:10px;"></div>
        `,
        footer: [
          { label: 'Cancelar', class: 'btn-secondary' },
          { label: '▶ Testar conexão', class: 'btn-secondary', closeOnClick: false, onClick: async () => {
            const out = document.getElementById('sp-test-result');
            out.innerHTML = '<small style="color:var(--text-muted);">⏳ Obtendo token...</small>';
            try {
              const tid = document.getElementById('sp-tid').value.trim();
              const cid = document.getElementById('sp-cid').value.trim();
              const sec = document.getElementById('sp-sec').value;
              const url = `https://login.microsoftonline.com/${tid}/oauth2/v2.0/token`;
              const body = new URLSearchParams({ client_id: cid, client_secret: sec, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
              const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
              if (!r.ok) { const t = await r.text(); throw new Error(`${r.status}: ${t.slice(0,150)}`); }
              const data = await r.json();
              out.innerHTML = `<div style="background:rgba(34,197,94,0.08);padding:10px;border-radius:6px;font-size:0.75rem;color:#22C55E;">
                ✓ Token obtido (expira em ${data.expires_in}s)
              </div>`;
            } catch (e) { out.innerHTML = `<small style="color:#EF4444;">Erro: ${esc(e.message)}</small>`; }
          }},
          { label: '💾 Salvar', class: 'btn-primary', closeOnClick: false, onClick: async (_, { close }) => {
            const tid = document.getElementById('sp-tid').value.trim();
            const cid = document.getElementById('sp-cid').value.trim();
            const sec = document.getElementById('sp-sec').value;
            if (!tid || !cid || !sec) return toast.error('Preencha os 3 campos.');
            try {
              await setDoc(doc(db, 'system_config', 'sharepoint-app'), {
                tenantId: tid, clientId: cid, clientSecret: sec,
                updatedAt: serverTimestamp(),
                updatedBy: store.get('currentUser')?.uid || null,
              });
              toast.success('Credenciais salvas.');
              close(); paint();
            } catch (e) { toast.error(e.message); }
          }},
        ],
      });
    });

    // GitHub PAT (token de leitura)
    document.getElementById('gh-config')?.addEventListener('click', async () => {
      const { doc, getDoc, setDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const { db } = await import('../firebase.js');
      const cfgSnap = await getDoc(doc(db, 'system_config', 'github'));
      const cfg = cfgSnap.exists() ? cfgSnap.data() : {};
      modal.open({
        title: '⚙ GitHub Personal Access Token',
        size: 'md',
        dedupeKey: 'gh-config',
        content: `
          <p style="font-size:0.8125rem;color:var(--text-muted);margin:0 0 14px;">
            PAT com escopo <code>repo</code> (read). Crie em <a href="https://github.com/settings/tokens" target="_blank">github.com/settings/tokens</a>.
            Salvo em <code>system_config/github</code>.
          </p>
          <div class="form-group">
            <label class="form-label">Token</label>
            <input type="password" id="gh-token" class="form-input" value="${esc(cfg.token||'')}" placeholder="ghp_..." style="font-family:monospace;font-size:0.8125rem;" autocomplete="new-password" />
          </div>
        `,
        footer: [
          { label: 'Cancelar', class: 'btn-secondary' },
          { label: '💾 Salvar', class: 'btn-primary', closeOnClick: false, onClick: async (_, { close }) => {
            const token = document.getElementById('gh-token').value.trim();
            try {
              await setDoc(doc(db, 'system_config', 'github'), {
                token,
                updatedAt: serverTimestamp(),
                updatedBy: store.get('currentUser')?.uid || null,
              });
              toast.success('Token salvo.');
              close();
            } catch (e) { toast.error(e.message); }
          }},
        ],
      });
    });

    document.getElementById('gd-save-id')?.addEventListener('click', () => {
      try {
        const id = document.getElementById('gd-client-id').value.trim();
        gd.setGoogleClientId(id);
        toast.success('Client ID salvo. Recarregue pra usar.');
        setTimeout(paint, 600);
      } catch (e) { toast.error(e.message); }
    });
    document.getElementById('gd-change-id')?.addEventListener('click', () => {
      if (!confirm('Trocar Client ID? Você precisará reconectar.')) return;
      try { localStorage.removeItem('google-client-id'); } catch {}
      gd.clearGoogleToken();
      paint();
    });
    document.getElementById('gd-connect')?.addEventListener('click', async () => {
      try {
        await gd.signInWithGoogle();
        toast.success('Google Drive conectado.');
        paint();
      } catch (e) { toast.error(e.message); }
    });
    document.getElementById('gd-disconnect')?.addEventListener('click', () => {
      gd.clearGoogleToken();
      toast.info('Desconectado.');
      paint();
    });
    document.getElementById('gd-test')?.addEventListener('click', async () => {
      const out = document.getElementById('gd-test-result');
      out.innerHTML = '<small style="color:var(--text-muted);">⏳ Listando arquivos...</small>';
      try {
        const files = await gd.listDriveFiles('root', { limit: 10 });
        const info = await gd.getUserInfo();
        out.innerHTML = `<div style="background:var(--bg-surface);padding:10px;border-radius:6px;font-size:0.75rem;">
          <strong>Conta:</strong> ${esc(info?.email || '?')}<br>
          <strong>${files.length} arquivo(s) na raiz:</strong>
          <ul style="margin:6px 0 0 18px;">${files.slice(0,10).map(f => `<li>${esc(f.name)} <small style="color:var(--text-muted);">(${esc(f.mimeType.split('.').pop())})</small></li>`).join('')}</ul>
        </div>`;
      } catch (e) {
        out.innerHTML = `<small style="color:#EF4444;">Erro: ${esc(e.message)}</small>`;
      }
    });
  }
  paint();
}
