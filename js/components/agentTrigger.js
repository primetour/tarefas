/**
 * PRIMETOUR — Agent Trigger
 *
 * Renderiza botões dos agentes ativos no header de cada página.
 * Substitui o FAB flutuante único por N botões contextualmente
 * apropriados ao módulo da rota atual.
 *
 * Uso (chamado em app.js afterNavigation):
 *   import { mountAgentsForRoute } from './components/agentTrigger.js';
 *   mountAgentsForRoute(route);
 *
 * Como funciona:
 *   - Lê fetchAgentsForModule(module) — agentes do módulo + 'general'
 *   - Filtra por triggers.button.enabled e visibility (RBAC)
 *   - Injeta botões num container fixo no header (.page-header-actions)
 *   - Click abre painel lateral com chat (mesma UX do FAB antigo, mas
 *     escopado a UM agente específico)
 */
import { store } from '../store.js';
import { toast } from '../components/toast.js';
import { fetchAgentsForModule, runAgent } from '../services/agents.js?v=20260501ii2';

const ROUTE_TO_MODULE = {
  'tasks': 'tasks', 'kanban': 'kanban', 'calendar': 'calendar', 'timeline': 'tasks',
  'projects': 'projects', 'dashboard': 'dashboards', 'dashboards': 'dashboards',
  'tasks/edit': 'tasks', 'task-types': 'task-types', 'task-categories': 'task-categories',
  'portal-tips': 'portal-tips', 'portal-tip-editor': 'portal-tips', 'portal-areas': 'portal-tips',
  'portal-destinations': 'portal-tips', 'portal-images': 'portal-tips', 'portal-dashboard': 'portal-tips',
  'feedbacks': 'feedbacks', 'csat': 'csat', 'goals': 'goals',
  'roteiros': 'roteiros', 'roteiro-editor': 'roteiros', 'roteiro-dashboard': 'roteiros',
  'requests': 'requests', 'cms': 'cms', 'landing-pages': 'landing-pages',
  'arts-editor': 'arts-editor', 'capacity': 'capacity', 'team': 'capacity',
  'workspaces': 'workspaces', 'sectors': 'sectors',
  'content-calendar': 'content-calendar',
  'check-in': 'general', 'help': 'general', 'about': 'general',
  'audit': 'general', 'integrations': 'general', 'notifications': 'general',
  'ai-hub': 'general',
};

/* ─── Visibilidade (RBAC completo) ──────────────────────── */
function isAgentVisible(agent) {
  if (!agent.active) return false;
  const v = agent.visibility || { mode: 'all' };
  if (store.isMaster()) return true; // master vê tudo
  if (v.mode === 'all') return true;
  if (v.mode === 'admin') return store.can('system_manage_users');
  if (v.mode === 'sector') {
    const userSector = store.get('userSector') || '';
    const visible = (store.get('visibleSectors') || []).concat(userSector);
    return visible.includes(v.value);
  }
  if (v.mode === 'role') {
    const profile = store.get('userProfile') || {};
    return (profile.role === v.value || profile.roleId === v.value);
  }
  if (v.mode === 'workspace') {
    const workspaces = store.get('userWorkspaces') || [];
    return workspaces.some(w => w.id === v.value || w.name === v.value);
  }
  return false;
}

/* ─── Mount ────────────────────────────────────────────── */
let _mountedRoute = null;
let _mountedAgents = [];
let _mountId = 0;       // race guard — só o ÚLTIMO call ganha

export async function mountAgentsForRoute(route) {
  // Fecha painel anterior se rota mudou
  if (_mountedRoute && _mountedRoute !== route) closeAgentPanel();
  _mountedRoute = route;
  // Race guard: cada call recebe id único; ao terminar fetch só renderiza
  // se ainda for o último call (evita 4 botoes em paralelo)
  const myId = ++_mountId;

  const moduleId = ROUTE_TO_MODULE[route] || 'general';
  let agents = [];
  try {
    agents = await fetchAgentsForModule(moduleId);
  } catch (e) {
    console.warn('[agentTrigger] fetch err:', e?.message);
    return;
  }
  // Se houve outra chamada mais recente, abandona esta
  if (myId !== _mountId) return;

  agents = agents.filter(a => a.triggers?.button?.enabled && isAgentVisible(a));
  _mountedAgents = agents;

  // Limpa AGORA (depois do await, antes do append) — só os botões antigos
  document.querySelectorAll('.agent-trigger-btn').forEach(b => b.remove());

  if (!agents.length) return;

  // Encontra o container do header
  const headerActions = document.querySelector('.page-header-actions');
  if (headerActions) {
    agents.forEach(agent => {
      const btn = buildAgentButton(agent);
      headerActions.insertBefore(btn, headerActions.firstChild);
    });
  } else {
    const pageHeader = document.querySelector('.page-header');
    if (pageHeader) {
      const grp = document.createElement('div');
      grp.className = 'agent-trigger-group page-header-actions';
      grp.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
      agents.forEach(a => grp.appendChild(buildAgentButton(a)));
      pageHeader.appendChild(grp);
    }
  }
}

function buildAgentButton(agent) {
  const btn = document.createElement('button');
  btn.className = 'btn btn-secondary btn-sm agent-trigger-btn';
  btn.dataset.agentId = agent.id;
  btn.title = agent.description || agent.name;
  btn.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:6px 12px;';
  const avatar = agent.avatarUrl
    ? `<img src="${esc(agent.avatarUrl)}" alt="" style="width:20px;height:20px;border-radius:50%;object-fit:cover;" />`
    : `<span style="font-size:1rem;">${esc(agent.icon || '◈')}</span>`;
  btn.innerHTML = `${avatar} <span>${esc(agent.triggers?.button?.label || agent.name)}</span>`;
  btn.addEventListener('click', () => openAgentPanel(agent));
  return btn;
}

function esc(s) { return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ─── Painel lateral de chat ───────────────────────────── */
let _activePanel = null;
let _agentChatHistory = []; // [{role, text}]

function injectStyles() {
  if (document.getElementById('agent-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'agent-panel-styles';
  style.textContent = `
    .agent-side-panel {
      position: fixed; top: 0; right: 0; bottom: 0; width: 420px; max-width: 90vw;
      background: var(--bg-elevated, #FFFFFF);
      box-shadow: -8px 0 32px rgba(0,0,0,0.18);
      z-index: 99997;
      display: flex; flex-direction: column;
      transform: translateX(0%); transition: transform 0.25s ease;
      font-family: var(--font-sans, system-ui);
    }
    .agent-side-panel.closing { transform: translateX(100%); }
    .agent-side-panel-header {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border-subtle);
      display: flex; align-items: center; gap: 10px;
    }
    .agent-side-panel-body {
      flex: 1; overflow-y: auto; padding: 12px 14px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .agent-msg {
      padding: 10px 12px; border-radius: 10px; font-size: 0.875rem;
      line-height: 1.55; max-width: 90%;
      white-space: pre-wrap;
    }
    .agent-msg-user { background: var(--bg-surface); align-self: flex-end; color: var(--text-primary); }
    .agent-msg-assistant { background: rgba(96,165,250,0.10); color: var(--text-primary); border:1px solid rgba(96,165,250,0.25); align-self: flex-start; }
    .agent-msg-loading { color: var(--text-muted); font-style: italic; align-self: flex-start; }
    .agent-side-panel-footer {
      padding: 10px 14px; border-top: 1px solid var(--border-subtle);
      display: flex; gap: 8px; align-items: flex-end;
    }
    .agent-input {
      flex: 1; padding: 10px 12px; border-radius: 8px;
      border: 1px solid var(--border-default); resize: none;
      font-family: inherit; font-size: 0.875rem; min-height: 40px; max-height: 140px;
      background: var(--bg-surface); color: var(--text-primary);
    }
    .agent-input:focus { outline: none; border-color: #2563EB; }
    .agent-send {
      background: #2563EB; color: white; border: none; border-radius: 8px;
      padding: 8px 14px; cursor: pointer; font-weight: 600; font-size: 0.875rem;
      align-self: stretch;
    }
    .agent-send:disabled { opacity: 0.5; cursor: not-allowed; }
  `;
  document.head.appendChild(style);
}

export function openAgentPanel(agent) {
  injectStyles();
  closeAgentPanel();
  _agentChatHistory = [];

  const avatar = agent.avatarUrl
    ? `<img src="${esc(agent.avatarUrl)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid var(--brand-gold);" />`
    : `<div style="width:36px;height:36px;border-radius:50%;background:var(--bg-surface);display:flex;align-items:center;justify-content:center;font-size:1.25rem;">${esc(agent.icon||'◈')}</div>`;

  const panel = document.createElement('div');
  panel.className = 'agent-side-panel';
  panel.innerHTML = `
    <div class="agent-side-panel-header">
      ${avatar}
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:0.9375rem;color:var(--text-primary);">${esc(agent.name)}</div>
        <div style="font-size:0.6875rem;color:var(--text-muted);">${esc(agent.provider)} · ${esc(agent.model)}</div>
      </div>
      ${agent.triggers?.publicChat?.enabled ? `<a href="agente.html?slug=${encodeURIComponent(agent.triggers.publicChat.slug||'')}" target="_blank" class="btn btn-ghost btn-sm" title="Abrir em página dedicada">⤢</a>` : ''}
      <button class="btn btn-ghost btn-sm" id="agent-close" title="Fechar (ESC)" style="font-size:1.25rem;line-height:1;">×</button>
    </div>
    <div class="agent-side-panel-body" id="agent-body">
      ${agent.description ? `<div style="font-size:0.75rem;color:var(--text-muted);text-align:center;padding:8px;border-bottom:1px dashed var(--border-subtle);margin-bottom:6px;">${esc(agent.description)}</div>` : ''}
    </div>
    <div class="agent-side-panel-footer">
      <textarea id="agent-input" class="agent-input" placeholder="Digite uma mensagem..." rows="1"></textarea>
      <button id="agent-send" class="agent-send">Enviar</button>
    </div>
  `;
  document.body.appendChild(panel);
  _activePanel = panel;

  // Bindings
  const input = panel.querySelector('#agent-input');
  const send = panel.querySelector('#agent-send');
  const close = panel.querySelector('#agent-close');
  close.addEventListener('click', () => closeAgentPanel());

  const sendMsg = async () => {
    const text = input.value.trim();
    if (!text) return;
    appendMsg('user', text);
    input.value = '';
    input.style.height = 'auto';
    send.disabled = true;
    const loadingEl = appendMsg('loading', '⏳ Pensando...');
    try {
      const ctx = collectPageContext();
      const result = await runAgent(agent.id, text, ctx);
      loadingEl.remove();
      appendMsg('assistant', result.text || '(resposta vazia)');
      _agentChatHistory.push({ role: 'user', text });
      _agentChatHistory.push({ role: 'assistant', text: result.text });
    } catch (e) {
      loadingEl.remove();
      appendMsg('assistant', `❌ Erro: ${e.message}`);
    } finally {
      send.disabled = false;
      input.focus();
    }
  };
  send.addEventListener('click', sendMsg);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMsg();
    }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(140, input.scrollHeight) + 'px';
  });

  // ESC fecha
  panel._keyHandler = (e) => { if (e.key === 'Escape') closeAgentPanel(); };
  window.addEventListener('keydown', panel._keyHandler);

  setTimeout(() => input.focus(), 100);
}

function appendMsg(role, text) {
  const body = document.getElementById('agent-body');
  if (!body) return null;
  const div = document.createElement('div');
  div.className = `agent-msg agent-msg-${role}`;
  div.textContent = text;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
  return div;
}

function collectPageContext() {
  const ctx = {
    currentRoute: location.hash.replace('#', '').split('/')[0],
    pageTitle: document.querySelector('.page-title')?.textContent?.trim() || '',
    user: store.get('currentUser')?.email || '',
    sector: store.get('userSector') || '',
  };
  return ctx;
}

export function closeAgentPanel() {
  if (!_activePanel) return;
  const p = _activePanel;
  p.classList.add('closing');
  if (p._keyHandler) window.removeEventListener('keydown', p._keyHandler);
  setTimeout(() => p.remove(), 250);
  _activePanel = null;
}

/* Cleanup quando rota muda fora */
export function detachAgents() {
  document.querySelectorAll('.agent-trigger-btn').forEach(b => b.remove());
  closeAgentPanel();
  _mountedAgents = [];
}
