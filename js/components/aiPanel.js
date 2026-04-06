/**
 * PRIMETOUR — AI Panel (Chat Flutuante + Skills + Actions)
 *
 * Componente universal de IA para todos os módulos.
 * Renderiza um widget de chat flutuante no canto inferior direito.
 * Mostra provider ativo, permite trocar, mensagem personalizada por módulo.
 */

import { fetchSkillsForModule, runSkill, chatWithAI, MODULE_REGISTRY, getAIConfig } from '../services/ai.js';
import { parseActions, cleanActionBlocks, executeAction, getActionsForModule } from '../services/aiActions.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let _toast = () => {};
try { const m = await import('../components/toast.js'); _toast = m.toast?.success || m.toast || _toast; } catch {}

/* ─── Descrições de capacidades por módulo ─────────────────── */
const MODULE_CAPABILITIES = {
  tasks: {
    greeting: 'Posso te ajudar a gerenciar suas tarefas.',
    capabilities: ['Criar tarefas com todos os campos (tipo, variação, tags, projeto, datas, etc.)', 'Editar qualquer campo (descrição, customFields, status, fora do calendário...)', 'Listar e buscar tarefas por status/prioridade/texto', 'Marcar como concluída', 'Adicionar comentários e subtarefas', 'Atualizar várias tarefas de uma vez', 'Ver tipos de tarefa e campos personalizados'],
  },
  kanban: {
    greeting: 'Posso te ajudar a gerenciar o quadro Kanban.',
    capabilities: ['Criar e mover cards entre colunas', 'Editar cards (título, descrição, prioridade, responsáveis)', 'Buscar cards por título', 'Resumo do board por status'],
  },
  projects: {
    greeting: 'Posso te ajudar a gerenciar seus projetos.',
    capabilities: ['Criar e editar projetos (nome, datas, membros, status)', 'Excluir projetos', 'Ver tarefas e progresso de um projeto', 'Listar e buscar projetos'],
  },
  'portal-tips': {
    greeting: 'Posso te ajudar com o Portal de Dicas.',
    capabilities: ['Criar destinos e dicas de viagem', 'Listar destinos e dicas', 'Editar conteúdo de dicas', 'Destacar dicas prioritárias', 'Listar áreas/BUs e imagens'],
  },
  roteiros: {
    greeting: 'Posso te ajudar com Roteiros de Viagem.',
    capabilities: ['Criar e editar roteiros', 'Alterar status (rascunho → revisão → enviado)', 'Duplicar e excluir roteiros', 'Buscar clientes recentes', 'Estatísticas gerais'],
  },
  feedbacks: {
    greeting: 'Posso te ajudar com Feedbacks.',
    capabilities: ['Criar, editar e excluir feedbacks', 'Listar e ver detalhes', 'Resumo com rating médio por tipo'],
  },
  goals: {
    greeting: 'Posso te ajudar com Metas e OKRs.',
    capabilities: ['Criar, editar e publicar metas', 'Excluir metas', 'Ver detalhes e progresso', 'Resumo geral por status'],
  },
  csat: {
    greeting: 'Posso te ajudar com Pesquisas de Satisfação.',
    capabilities: ['Criar e enviar pesquisas CSAT', 'Reenviar e cancelar pesquisas', 'Encontrar tarefas sem CSAT', 'Calcular métricas (score, NPS, taxa de resposta)'],
  },
  requests: {
    greeting: 'Posso te ajudar com Solicitações.',
    capabilities: ['Listar e criar solicitações', 'Aprovar ou rejeitar', 'Converter em tarefa', 'Resumo por status'],
  },
  calendar: {
    greeting: 'Posso te ajudar com o Calendário.',
    capabilities: ['Listar eventos', 'Ver agenda de hoje'],
  },
  dashboards: {
    greeting: 'Posso te ajudar a analisar os dados do Dashboard.',
    capabilities: ['Capturar KPIs visíveis (GA, Instagram, Newsletter)', 'Visão geral de tarefas (por status, prioridade, atrasadas)'],
  },
  'news-monitor': {
    greeting: 'Posso te ajudar com Notícias e Clipping.',
    capabilities: ['Buscar notícias do setor de turismo na web', 'Cadastrar notícias no sistema', 'Rastrear menções da PRIMETOUR na internet', 'Cadastrar clippings', 'Listar e filtrar notícias e clippings'],
  },
  general: {
    greeting: 'Posso te ajudar com informações do sistema.',
    capabilities: ['Capturar dados da tela', 'Listar notificações', 'Navegar entre módulos'],
  },
  content: {
    greeting: 'Posso te ajudar a analisar performance de conteúdo.',
    capabilities: ['Capturar métricas de performance visíveis'],
  },
};

/**
 * Monta o painel de IA flutuante
 */
export async function mountAiPanel(container, moduleId, getContext, options = {}) {
  if (!container || !moduleId) return;

  const [skills, config] = await Promise.all([
    fetchSkillsForModule(moduleId).catch(() => []),
    getAIConfig().catch(() => null),
  ]);

  const moduleActions = getActionsForModule(moduleId);
  const hasModuleActions = moduleActions.length > 3;
  if (!skills.length && (!config || !hasModuleActions)) return;

  const panelId = `ai-panel-${moduleId}-${Date.now()}`;
  const moduleMeta = MODULE_REGISTRY[moduleId] || { label: moduleId, icon: '◈' };
  const hasSkills = skills.length > 0;
  const caps = MODULE_CAPABILITIES[moduleId] || MODULE_CAPABILITIES.general;

  // Mensagem de boas-vindas personalizada
  const capsList = caps.capabilities.map(c => `<div style="padding:1px 0;">• ${esc(c)}</div>`).join('');
  const welcomeHtml = `
    <strong>${esc(caps.greeting)}</strong>
    <div style="margin-top:6px;font-size:0.6875rem;color:var(--text-muted);">
      <div style="margin-bottom:3px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px;">O que posso fazer:</div>
      ${capsList}
    </div>
    ${hasSkills ? `<div style="margin-top:8px;font-size:0.6875rem;color:var(--brand-gold,#D4A843);">
      ⚡ Você também tem ${skills.length} skill${skills.length>1?'s':''} especializada${skills.length>1?'s':''} — use os atalhos acima.
    </div>` : ''}
  `;

  const panelHtml = `
    <div id="${panelId}" class="ai-panel-floating">
      <button class="ai-fab" title="Assistente IA — ${esc(moduleMeta.label)}">
        <span class="ai-fab-icon">◈</span>
        <span class="ai-fab-label">IA</span>
      </button>

      <div class="ai-chat-window" style="display:none;">
        <!-- Header -->
        <div class="ai-chat-header">
          <span class="ai-chat-header-icon">◈</span>
          <div style="flex:1;min-width:0;">
            <div class="ai-chat-header-title">Assistente IA</div>
            <div class="ai-chat-header-subtitle">${esc(moduleMeta.label)}</div>
          </div>
          ${hasSkills ? `<span class="ai-chat-badge">${skills.length} skill${skills.length>1?'s':''}</span>` : ''}
          <button class="ai-chat-close" title="Minimizar">✕</button>
        </div>

        ${hasSkills ? `
        <div class="ai-skills-bar">
          ${skills.map(s => `
            <button class="ai-skill-btn" data-skill-id="${s.id}" title="${esc(s.description || '')}">▶ ${esc(s.name)}</button>
          `).join('')}
        </div>` : ''}

        <!-- Messages -->
        <div class="ai-chat-messages" id="${panelId}-messages">
          <div class="ai-msg ai-msg-assistant">
            <div class="ai-avatar ai-avatar-bot">IA</div>
            <div class="ai-bubble ai-bubble-bot">${welcomeHtml}</div>
          </div>
        </div>

        <!-- Input -->
        <div class="ai-chat-input-area">
          <textarea id="${panelId}-input" rows="1" placeholder="Pergunte algo ou peça uma ação..."></textarea>
          <button id="${panelId}-send" class="ai-send-btn">Enviar</button>
        </div>
      </div>

      <style>
        .ai-panel-floating { position:relative;display:inline-block; }
        .ai-fab {
          display:flex;align-items:center;gap:6px;
          padding:10px 18px;border-radius:28px;border:none;cursor:pointer;
          background:linear-gradient(135deg,#D4A843,#B8922F);color:#0C1926;
          font-weight:700;font-size:0.8125rem;font-family:inherit;
          box-shadow:0 4px 20px rgba(212,168,67,0.3),0 2px 8px rgba(0,0,0,0.2);
          transition:all 0.2s;
        }
        .ai-fab:hover { transform:scale(1.05);box-shadow:0 6px 24px rgba(212,168,67,0.4); }
        .ai-fab-icon { font-size:1.125rem; }

        .ai-chat-window {
          position:fixed;bottom:24px;right:24px;
          width:420px;max-width:calc(100vw - 40px);max-height:min(580px, calc(100vh - 48px));
          background:var(--bg-card,#111B27);border:1px solid var(--border-subtle,#1E2D3D);
          border-radius:16px;overflow:hidden;
          box-shadow:0 12px 40px rgba(0,0,0,0.4),0 4px 12px rgba(0,0,0,0.2);
          display:flex;flex-direction:column;
        }
        .ai-chat-header {
          display:flex;align-items:center;gap:8px;padding:12px 16px;
          background:linear-gradient(135deg,rgba(212,168,67,0.1),rgba(212,168,67,0.03));
          border-bottom:1px solid var(--border-subtle,#1E2D3D);
        }
        .ai-chat-header-icon { font-size:1.25rem;color:var(--brand-gold,#D4A843); }
        .ai-chat-header-title { font-size:0.875rem;font-weight:600;color:var(--text-primary,#E8ECF1);line-height:1.2; }
        .ai-chat-header-subtitle { font-size:0.6875rem;color:var(--text-muted,#5A6B7A); }
        .ai-chat-badge {
          font-size:0.625rem;color:var(--brand-gold,#D4A843);background:rgba(212,168,67,0.1);
          padding:2px 8px;border-radius:8px;white-space:nowrap;
        }
        .ai-chat-close {
          background:none;border:none;color:var(--text-muted,#5A6B7A);cursor:pointer;
          font-size:0.875rem;padding:4px 8px;border-radius:6px;transition:all 0.15s;
        }
        .ai-chat-close:hover { background:var(--bg-surface,#16202C);color:var(--text-primary,#E8ECF1); }

        .ai-skills-bar {
          padding:8px 12px;border-bottom:1px solid var(--border-subtle,#1E2D3D);
          background:var(--bg-surface,#16202C);display:flex;flex-wrap:wrap;gap:6px;
          max-height:72px;overflow-y:auto;
        }
        .ai-skill-btn {
          padding:4px 10px;border-radius:16px;font-size:0.6875rem;cursor:pointer;
          border:1px solid var(--brand-gold,#D4A843);background:transparent;
          color:var(--brand-gold,#D4A843);font-weight:500;transition:all 0.15s;
          white-space:nowrap;font-family:inherit;
        }
        .ai-skill-btn:hover { background:rgba(212,168,67,0.1); }
        .ai-skill-btn:disabled { opacity:0.4;cursor:default; }

        .ai-chat-messages {
          flex:1;padding:12px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;
          min-height:120px;max-height:320px;
        }
        .ai-msg { display:flex;gap:8px;align-items:flex-start; }
        .ai-msg-user { flex-direction:row-reverse; }
        .ai-avatar {
          min-width:26px;height:26px;border-radius:50%;
          display:flex;align-items:center;justify-content:center;
          font-size:0.625rem;font-weight:700;flex-shrink:0;
        }
        .ai-avatar-bot { background:var(--brand-gold,#D4A843);color:var(--bg-dark,#0C1926); }
        .ai-avatar-user { background:var(--brand-primary,#3b82f6);color:#fff; }
        .ai-bubble {
          max-width:82%;border-radius:12px;padding:8px 12px;
          font-size:0.8125rem;line-height:1.55;white-space:pre-wrap;word-wrap:break-word;
        }
        .ai-bubble-bot { background:var(--bg-surface,#16202C);color:var(--text-primary,#E8ECF1); }
        .ai-bubble-user { background:var(--brand-gold,#D4A843);color:var(--bg-dark,#0C1926); }
        .ai-msg-meta { font-size:0.625rem;color:var(--text-muted,#5A6B7A);margin-top:3px; }
        .ai-msg-actions { display:flex;gap:4px;margin-top:3px; }
        .ai-copy-btn {
          font-size:0.625rem;color:var(--text-muted,#5A6B7A);background:none;
          border:none;cursor:pointer;padding:2px 6px;border-radius:4px;
          font-family:inherit;transition:background 0.15s;
        }
        .ai-copy-btn:hover { background:var(--bg-surface,#16202C); }
        .ai-action-block {
          margin:0 8px;padding:6px 10px;border-radius:8px;font-size:0.6875rem;
          background:rgba(212,168,67,0.06);border:1px solid rgba(212,168,67,0.15);
          color:var(--text-secondary,#9BA8B7);display:flex;align-items:center;gap:6px;
        }
        .ai-chat-input-area {
          padding:10px 12px;border-top:1px solid var(--border-subtle,#1E2D3D);
          display:flex;gap:8px;align-items:flex-end;
        }
        .ai-chat-input-area textarea {
          flex:1;resize:none;border:1px solid var(--border-subtle,#1E2D3D);border-radius:10px;
          padding:8px 12px;font-size:0.8125rem;background:var(--bg-surface,#16202C);
          color:var(--text-primary,#E8ECF1);font-family:inherit;line-height:1.4;
          max-height:100px;overflow-y:auto;outline:none;transition:border-color 0.2s;
        }
        .ai-chat-input-area textarea:focus { border-color:var(--brand-gold,#D4A843); }
        .ai-send-btn {
          padding:8px 14px;border-radius:10px;border:none;
          background:var(--brand-gold,#D4A843);color:var(--bg-dark,#0C1926);
          font-weight:600;font-size:0.8125rem;cursor:pointer;font-family:inherit;
          white-space:nowrap;transition:opacity 0.15s;min-height:36px;
        }
        .ai-send-btn:hover { opacity:0.9; }
        .ai-send-btn:disabled { opacity:0.4;cursor:default; }
        .ai-typing::after { content:'...';animation:ai-dots 1.5s infinite; }
        @keyframes ai-dots { 0%{content:'.'} 33%{content:'..'} 66%{content:'...'} }
        @media (max-width:480px) {
          .ai-chat-window { width:calc(100vw - 16px);right:8px;bottom:8px;max-height:calc(100vh - 16px); }
          .ai-fab-label { display:none; }
        }
      </style>
    </div>
  `;

  container.insertAdjacentHTML('beforeend', panelHtml);

  const panel = document.getElementById(panelId);
  if (!panel) return;

  // ── State ──
  const chatHistory = [];
  let isProcessing = false;
  let expanded = false;

  // ── DOM refs ──
  const fabBtn       = panel.querySelector('.ai-fab');
  const chatWindow   = panel.querySelector('.ai-chat-window');
  const closeBtn     = panel.querySelector('.ai-chat-close');
  const messagesEl   = document.getElementById(`${panelId}-messages`);
  const inputEl      = document.getElementById(`${panelId}-input`);
  const sendBtn      = document.getElementById(`${panelId}-send`);

  // ── Toggle open/close ──
  function toggleChat(open) {
    expanded = open !== undefined ? open : !expanded;
    chatWindow.style.display = expanded ? 'flex' : 'none';
    fabBtn.style.display = expanded ? 'none' : 'flex';
    if (expanded) inputEl?.focus();
  }
  fabBtn?.addEventListener('click', () => toggleChat(true));
  closeBtn?.addEventListener('click', () => toggleChat(false));

  // ── Auto-resize textarea ──
  inputEl?.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
  });

  // ── Data actions set (for follow-up) ──
  const DATA_ACTIONS = new Set([
    'list_tasks','list_task_types','list_projects','list_roteiros','list_feedbacks','list_goals','list_events',
    'list_requests','list_destinations','list_tips','list_areas','list_images','list_surveys',
    'list_recent_clients','list_notifications','list_news','list_clippings',
    'get_task_summary','get_board_summary','get_project_tasks','get_project_progress','get_dashboard_summary',
    'get_csat_dom_summary','get_csat_metrics','get_current_user','find_tasks_without_csat',
    'get_roteiro','get_roteiro_stats','get_tip_detail','get_feedback','get_feedback_summary',
    'get_goal','get_goals_summary','get_today_agenda','get_tasks_overview',
    'get_system_overview','get_content_metrics','get_requests_summary',
    'search_web_news','search_web_clipping',
  ]);

  // ── Helper: add message ──
  function addMessage(role, html, meta = '') {
    const isUser = role === 'user';
    const isAction = role === 'action';
    const msgEl = document.createElement('div');

    if (isAction) {
      msgEl.className = 'ai-action-block';
      msgEl.innerHTML = `<span style="font-size:0.875rem;">⚡</span><span>${html}</span>`;
      messagesEl.appendChild(msgEl);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return msgEl;
    }

    msgEl.className = `ai-msg ai-msg-${role}`;
    const avatarClass = isUser ? 'ai-avatar-user' : 'ai-avatar-bot';
    const avatarText = isUser ? 'EU' : 'IA';
    const bubbleClass = isUser ? 'ai-bubble-user' : 'ai-bubble-bot';

    msgEl.innerHTML = `
      <div class="ai-avatar ${avatarClass}">${avatarText}</div>
      <div style="max-width:82%;">
        <div class="ai-bubble ${bubbleClass}">${html}</div>
        ${meta ? `<div class="ai-msg-meta" style="${isUser?'text-align:right;':''}">${meta}</div>` : ''}
        ${!isUser ? `<div class="ai-msg-actions"><button class="ai-copy-btn">Copiar</button></div>` : ''}
      </div>
    `;
    messagesEl.appendChild(msgEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    msgEl.querySelector('.ai-copy-btn')?.addEventListener('click', () => {
      const text = msgEl.querySelector('.ai-bubble')?.textContent || '';
      navigator.clipboard.writeText(text).then(() => _toast('Copiado!')).catch(() => {});
    });
    return msgEl;
  }

  function addLoading(label = 'Pensando') {
    const el = document.createElement('div');
    el.className = 'ai-msg ai-msg-assistant';
    el.innerHTML = `
      <div class="ai-avatar ai-avatar-bot">IA</div>
      <div class="ai-bubble ai-bubble-bot" style="color:var(--text-muted);"><span class="ai-typing">${esc(label)}</span></div>
    `;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  // ── Format action data ──
  function formatActionData(actionName, data) {
    if (!data) return '';
    if (Array.isArray(data) && data.length > 0) {
      const items = data.slice(0, 5);
      let html = '<div style="margin-top:4px;font-size:0.6875rem;">';
      items.forEach(item => {
        const label = item.title || item.name || item.clientName || item.label || JSON.stringify(item).substring(0, 50);
        const badge = item.status ? ` <span style="opacity:0.6;">[${item.status}]</span>` : '';
        html += `<div style="padding:1px 0;">• ${esc(label)}${badge}</div>`;
      });
      if (data.length > 5) html += `<div style="opacity:0.5;">... +${data.length - 5}</div>`;
      html += '</div>';
      return html;
    }
    if (typeof data === 'object' && !Array.isArray(data)) {
      let html = '<div style="margin-top:4px;font-size:0.6875rem;">';
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'object' && value !== null) {
          html += `<div><strong>${esc(key)}:</strong></div>`;
          for (const [k2, v2] of Object.entries(value)) {
            html += `<div style="padding-left:8px;">• ${esc(k2)}: ${esc(String(v2))}</div>`;
          }
        } else {
          html += `<div>• ${esc(key)}: ${esc(String(value))}</div>`;
        }
      }
      html += '</div>';
      return html;
    }
    return '';
  }

  // ── Process AI response ──
  async function processAIResponse(rawText, meta, getContextFn) {
    const actions = parseActions(rawText);
    const cleanText = cleanActionBlocks(rawText);

    if (cleanText) {
      addMessage('assistant', esc(cleanText), meta);
      chatHistory.push({ role: 'assistant', text: cleanText });
    }

    if (actions.length === 0) return;

    const dataResults = [];

    for (const actionBlock of actions) {
      const { action, params } = actionBlock;
      addMessage('action', `Executando: <strong>${esc(action)}</strong>...`);
      try {
        const result = await executeAction(moduleId, action, params || {});
        if (result.success) {
          const dp = formatActionData(action, result.data);
          addMessage('action', `✅ ${esc(result.message || 'Sucesso')}${dp}`);
          if (DATA_ACTIONS.has(action) && result.data) {
            dataResults.push({ action, data: result.data, message: result.message });
          }
          // Montar histórico com IDs bem destacados para a IA reutilizar
          const dataStr = result.data != null ? JSON.stringify(result.data) : '';
          const createdId = result.data?.taskId || result.data?.newsId || result.data?.clippingId
                         || result.data?.tipId || result.data?.destinationId || result.data?.id
                         || result.taskId || '';
          const idHint = createdId ? ` >>> ID_CRIADO="${createdId}" <<<` : '';
          chatHistory.push({
            role: 'assistant',
            text: `[Resultado de ${action}]: ${result.message || 'OK'}${idHint}${dataStr ? '. Dados: ' + dataStr.substring(0, 800) : ''}`,
          });
        } else {
          addMessage('action', `❌ ${esc(result.message || 'Erro')}`);
          chatHistory.push({ role: 'assistant', text: `[Erro em ${action}]: ${result.message}` });
        }
      } catch (err) {
        addMessage('action', `❌ Erro: ${esc(err.message)}`);
      }
    }

    // Follow-up: se ações de leitura retornaram dados, chamar IA para analisar/agir
    if (dataResults.length > 0) {
      const loadingEl = addLoading('Analisando');
      try {
        const dataContext = dataResults.map(r =>
          `Ação "${r.action}" retornou: ${r.message}\nDados:\n${JSON.stringify(r.data ?? {}, null, 1).substring(0, 1500)}`
        ).join('\n\n');

        const followUpMsg = `Resultados das ações:\n\n${dataContext}\n\nCom base nesses dados, responda ao pedido original. Se envolvia modificar algo e agora você tem o ID, EXECUTE a ação com <<<ACTION>>>. Se era consulta, analise de forma concisa.`;
        chatHistory.push({ role: 'user', text: followUpMsg });

        const context = typeof getContextFn === 'function' ? getContextFn() : {};
        const followUpResult = await chatWithAI(followUpMsg, context, {
          moduleId,
          history: chatHistory.slice(-12),
        });

        loadingEl.remove();

        const followActions = parseActions(followUpResult.text);
        const followClean = cleanActionBlocks(followUpResult.text);
        if (followClean) {
          addMessage('assistant', esc(followClean));
          chatHistory.push({ role: 'assistant', text: followClean });
        }
        for (const fa of followActions) {
          try {
            addMessage('action', `Executando: <strong>${esc(fa.action)}</strong>...`);
            const r = await executeAction(moduleId, fa.action, fa.params || {});
            const dp = formatActionData(fa.action, r.data);
            addMessage('action', `${r.success ? '✅' : '❌'} ${esc(r.message || '')}${dp}`);
          } catch {}
        }
      } catch (err) {
        loadingEl.remove();
        addMessage('assistant', `<span style="color:var(--danger,#EF4444);">Erro: ${esc(err.message)}</span>`);
      }
    }
  }

  // ── Send message ──
  async function sendMessage(text) {
    if (!text.trim() || isProcessing) return;
    isProcessing = true;
    sendBtn.disabled = true;
    inputEl.disabled = true;

    addMessage('user', esc(text));
    chatHistory.push({ role: 'user', text });

    const loadingEl = addLoading();

    try {
      const context = typeof getContext === 'function' ? getContext() : {};
      const result = await chatWithAI(text, context, {
        moduleId,
        history: chatHistory.slice(-10),
      });

      loadingEl.remove();
      await processAIResponse(result.text, '', getContext);
    } catch (err) {
      loadingEl.remove();
      addMessage('assistant', `<span style="color:var(--danger,#EF4444);">Erro: ${esc(err.message)}</span>`);
    }

    isProcessing = false;
    sendBtn.disabled = false;
    inputEl.disabled = false;
    inputEl.value = '';
    inputEl.style.height = 'auto';
    inputEl.focus();
  }

  sendBtn?.addEventListener('click', () => sendMessage(inputEl?.value || ''));
  inputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(inputEl.value); }
  });

  // ── Skill buttons ──
  panel.querySelectorAll('.ai-skill-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (isProcessing) return;
      const skillId = btn.dataset.skillId;
      const skill = skills.find(s => s.id === skillId);
      if (!skill) return;

      isProcessing = true;
      sendBtn.disabled = true;
      panel.querySelectorAll('.ai-skill-btn').forEach(b => { b.disabled = true; });

      addMessage('user', `▶ <strong>${esc(skill.name)}</strong>`);
      chatHistory.push({ role: 'user', text: `[Skill: ${skill.name}]` });
      if (!expanded) toggleChat(true);

      const loadingEl = addLoading();
      try {
        const context = typeof getContext === 'function' ? getContext() : {};
        const result = await runSkill(skillId, context);
        loadingEl.remove();
        await processAIResponse(result.text, '', getContext);
        if (options.onResult) options.onResult(result, skill);
      } catch (err) {
        loadingEl.remove();
        addMessage('assistant', `<span style="color:var(--danger,#EF4444);">Erro: ${esc(err.message)}</span>`);
      }

      isProcessing = false;
      sendBtn.disabled = false;
      panel.querySelectorAll('.ai-skill-btn').forEach(b => { b.disabled = false; });
    });
  });

  return panel;
}

export function unmountAiPanel(container) {
  if (!container) return;
  container.querySelectorAll('.ai-panel-floating').forEach(el => el.remove());
}
