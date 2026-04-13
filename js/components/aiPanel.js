/**
 * PRIMETOUR — AI Panel (Chat Flutuante + Skills + Actions)
 *
 * Componente universal de IA para todos os módulos.
 * Renderiza um widget de chat flutuante no canto inferior direito.
 * Mostra provider ativo, permite trocar, mensagem personalizada por módulo.
 */

import { fetchSkillsForModule, runSkill, chatWithAI, MODULE_REGISTRY, getAIConfig } from '../services/ai.js';
import { parseActions, cleanActionBlocks, executeAction, getActionsForModule } from '../services/aiActions.js';
import { parseFiles, formatFilesForPrompt, validateFile, getAcceptString, MAX_FILES } from '../services/aiFileParser.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* Toast — lazy load para evitar top-level await (trava Chrome/Edge) */
let _toastFn = null;
function _toast(msg) {
  if (_toastFn) return _toastFn(msg);
  import('../components/toast.js')
    .then(m => { _toastFn = m.toast?.success || m.toast || (() => {}); _toastFn(msg); })
    .catch(() => {});
}

/* ─── Helpers: classificação automática de conteúdo ────── */
function guessContentType(title, snippet) {
  const text = ((title || '') + ' ' + (snippet || '')).toLowerCase();
  if (/evento|congresso|feira|summit|encontro|convenção/.test(text)) return 'Eventos';
  if (/análise|estudo|pesquisa|relatório|dados|números/.test(text)) return 'Análises';
  if (/tendência|futuro|perspectiva|previsão/.test(text)) return 'Tendências';
  if (/negócio|faturamento|receita|crescimento|resultado|lucro|mercado/.test(text)) return 'Negócios';
  if (/publieditorial|patrocinado|branded/.test(text)) return 'Publieditorial';
  return 'Novidades';
}

function guessCategory(title, snippet) {
  const text = ((title || '') + ' ' + (snippet || '')).toLowerCase();
  if (/hotel|resort|hospedagem|check-in|hotelaria/.test(text)) return 'Hotelaria';
  if (/cruzeiro|navio|msc|costa|royal caribbean/.test(text)) return 'Cruzeiros';
  if (/destino|viagem|turismo|roteiro/.test(text)) return 'Destinos';
  if (/aérea|voo|avião|latam|gol|azul|airline/.test(text)) return 'Companhias Aéreas';
  if (/sistema|tecnologia|plataforma|software/.test(text)) return 'Sistemas';
  if (/agência|operadora|consolidadora|primetour/.test(text)) return 'Agências e Operadoras';
  return 'Mercado';
}

/* ─── Log de ações executadas pela IA ────────────────────── */
async function logAction(moduleId, actionName, success, params) {
  try {
    const { collection, addDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const { db } = await import('../firebase.js');
    const { store } = await import('../store.js');
    const user = store.get('currentUser');
    await addDoc(collection(db, 'ai_action_logs'), {
      action: actionName,
      module: moduleId,
      success,
      params: params ? JSON.stringify(params).substring(0, 500) : '',
      userId: user?.uid || null,
      timestamp: serverTimestamp(),
    });
  } catch { /* silencioso */ }
}

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

        <!-- Attachment preview -->
        <div class="ai-attach-preview" id="${panelId}-attach-preview" style="display:none;"></div>

        <!-- Input -->
        <div class="ai-chat-input-area">
          <button class="ai-attach-btn" id="${panelId}-attach" title="Anexar arquivo (PDF, Excel, CSV, DOCX, TXT, imagem)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          </button>
          <input type="file" id="${panelId}-file-input" multiple accept="${getAcceptString()}" style="display:none;">
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
        /* Attachment button */
        .ai-attach-btn {
          display:flex;align-items:center;justify-content:center;
          width:36px;height:36px;min-width:36px;border-radius:10px;border:1px solid var(--border-subtle,#1E2D3D);
          background:var(--bg-surface,#16202C);color:var(--text-secondary,#9BA8B7);
          cursor:pointer;transition:all 0.15s;flex-shrink:0;
        }
        .ai-attach-btn:hover { border-color:var(--brand-gold,#D4A843);color:var(--brand-gold,#D4A843); }
        .ai-attach-btn.has-files { border-color:var(--brand-gold,#D4A843);color:var(--brand-gold,#D4A843);background:rgba(212,168,67,0.1); }

        /* Attachment preview bar */
        .ai-attach-preview {
          padding:6px 12px;border-top:1px solid var(--border-subtle,#1E2D3D);
          display:flex;flex-wrap:wrap;gap:4px;align-items:center;
          background:rgba(212,168,67,0.03);
        }
        .ai-attach-chip {
          display:inline-flex;align-items:center;gap:4px;
          padding:3px 8px;border-radius:6px;font-size:0.6875rem;
          background:rgba(212,168,67,0.1);border:1px solid rgba(212,168,67,0.2);
          color:var(--text-secondary,#9BA8B7);max-width:180px;
        }
        .ai-attach-chip-name {
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        }
        .ai-attach-chip-remove {
          cursor:pointer;opacity:0.6;font-size:0.75rem;line-height:1;
          margin-left:2px;transition:opacity 0.15s;
        }
        .ai-attach-chip-remove:hover { opacity:1;color:var(--danger,#EF4444); }
        .ai-attach-status {
          font-size:0.625rem;color:var(--text-muted,#5A6B7A);margin-left:auto;
        }

        /* File content in chat bubble */
        .ai-file-badge {
          display:inline-flex;align-items:center;gap:4px;
          padding:2px 8px;border-radius:4px;font-size:0.6875rem;
          background:rgba(212,168,67,0.1);border:1px solid rgba(212,168,67,0.15);
          margin-bottom:4px;
        }

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
  let pendingFiles = []; // File objects aguardando envio
  let parsedAttachments = []; // Resultados do parsing

  // ── DOM refs ──
  const fabBtn         = panel.querySelector('.ai-fab');
  const chatWindow     = panel.querySelector('.ai-chat-window');
  const closeBtn       = panel.querySelector('.ai-chat-close');
  const messagesEl     = document.getElementById(`${panelId}-messages`);
  const inputEl        = document.getElementById(`${panelId}-input`);
  const sendBtn        = document.getElementById(`${panelId}-send`);
  const attachBtn      = document.getElementById(`${panelId}-attach`);
  const fileInput      = document.getElementById(`${panelId}-file-input`);
  const attachPreview  = document.getElementById(`${panelId}-attach-preview`);

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

  // ── File attachment logic ──
  attachBtn?.addEventListener('click', () => fileInput?.click());

  fileInput?.addEventListener('change', () => {
    const files = Array.from(fileInput.files || []);
    if (!files.length) return;

    // Validar e adicionar (até MAX_FILES total)
    for (const file of files) {
      if (pendingFiles.length >= MAX_FILES) {
        _toast(`Máximo de ${MAX_FILES} arquivos.`);
        break;
      }
      const check = validateFile(file);
      if (!check.valid) {
        _toast(check.error);
        continue;
      }
      // Evitar duplicatas
      if (pendingFiles.some(f => f.name === file.name && f.size === file.size)) continue;
      pendingFiles.push(file);
    }

    fileInput.value = ''; // reset input
    renderAttachPreview();
  });

  // Drag & drop no chat
  const chatBody = panel.querySelector('.ai-chat-window');
  if (chatBody) {
    chatBody.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); chatBody.style.outline = '2px dashed var(--brand-gold)'; });
    chatBody.addEventListener('dragleave', () => { chatBody.style.outline = ''; });
    chatBody.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      chatBody.style.outline = '';
      const files = Array.from(e.dataTransfer?.files || []);
      for (const file of files) {
        if (pendingFiles.length >= MAX_FILES) break;
        const check = validateFile(file);
        if (!check.valid) continue;
        if (pendingFiles.some(f => f.name === file.name && f.size === file.size)) continue;
        pendingFiles.push(file);
      }
      renderAttachPreview();
    });
  }

  function renderAttachPreview() {
    if (!attachPreview) return;
    if (!pendingFiles.length) {
      attachPreview.style.display = 'none';
      attachBtn?.classList.remove('has-files');
      return;
    }

    attachBtn?.classList.add('has-files');
    attachPreview.style.display = 'flex';
    attachPreview.innerHTML = pendingFiles.map((f, i) => {
      const ext = f.name.split('.').pop()?.toUpperCase() || '?';
      const size = f.size < 1024 ? `${f.size} B` : `${(f.size / 1024).toFixed(0)} KB`;
      return `<span class="ai-attach-chip">
        <span style="font-size:0.75rem;">${ext === 'PDF' ? '📄' : ext === 'XLSX' || ext === 'XLS' || ext === 'CSV' ? '📊' : ext === 'DOCX' ? '📝' : '🖼'}</span>
        <span class="ai-attach-chip-name" title="${esc(f.name)}">${esc(f.name)}</span>
        <span class="ai-attach-chip-remove" data-idx="${i}" title="Remover">✕</span>
      </span>`;
    }).join('') + `<span class="ai-attach-status">${pendingFiles.length}/${MAX_FILES}</span>`;

    // Remove handlers
    attachPreview.querySelectorAll('.ai-attach-chip-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        pendingFiles.splice(idx, 1);
        renderAttachPreview();
      });
    });
  }

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
        ${meta ? `<div class="ai-msg-meta" style="${isUser?'text-align:right;':''}">${esc(meta)}</div>` : ''}
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
    let cleanText = cleanActionBlocks(rawText);
    cleanText = cleanText.replace(/<<<ACTION>>>?/g, '').replace(/<<<END_ACTION>>>?/g, '').trim();

    if (cleanText) {
      addMessage('assistant', esc(cleanText), meta);
      chatHistory.push({ role: 'assistant', text: cleanText });
    }

    if (actions.length === 0) return;

    // ── Passo 1: executar todas as ações da resposta da IA ──
    const results = await executeActionBatch(actions, getContextFn);

    // ── Passo 2: decidir follow-up baseado nos resultados ──
    const WEB_ACTIONS = new Set(['search_web_news', 'search_web_clipping']);
    const webResults = results.filter(r => r.success && WEB_ACTIONS.has(r.action) && Array.isArray(r.data) && r.data.length > 0);
    const listResults = results.filter(r => r.success && /^list_/.test(r.action) && r.data);
    const hasWriteActions = actions.some(a => !DATA_ACTIONS.has(a.action));
    const dataResults = results.filter(r => r.success && DATA_ACTIONS.has(r.action) && r.data);
    const allDataEmpty = dataResults.length === 0 || dataResults.every(r => Array.isArray(r.data) && r.data.length === 0);

    // Cenário 1: Busca web retornou resultados → cadastrar diretamente (sem pedir à IA para buscar de novo)
    if (webResults.length > 0) {
      const loadingEl = addLoading('Filtrando duplicatas e cadastrando');
      try {
        // Montar lista de resultados web
        const webData = webResults
          .map(r => r.data.filter(d => d.url && !d.title?.includes('indisponível')))  // filtrar fallbacks
          .flat();

        if (webData.length === 0) {
          loadingEl.remove();
          addMessage('assistant', 'A busca web não retornou resultados válidos. Tente novamente ou use termos diferentes.');
          return;
        }

        // ══ DEDUPLICAÇÃO PROGRAMÁTICA (não depende da IA) ══
        // Coletar títulos e URLs dos itens já cadastrados
        const existingItems = listResults
          .map(r => (Array.isArray(r.data) ? r.data : []))
          .flat();

        const existingTitlesLower = new Set(
          existingItems.map(d => (d.title || '').toLowerCase().trim()).filter(Boolean)
        );
        const existingUrls = new Set(
          existingItems.map(d => (d.sourceUrl || d.url || '').replace(/https?:\/\/(www\.)?/, '').replace(/\/+$/, '').toLowerCase()).filter(Boolean)
        );

        // Filtrar: só manter resultados que NÃO existem no banco
        const newItems = webData.filter(item => {
          const titleLower = (item.title || '').toLowerCase().trim();
          const urlClean = (item.url || '').replace(/https?:\/\/(www\.)?/, '').replace(/\/+$/, '').toLowerCase();
          // Verificar por título (similaridade parcial — se o título existente CONTÉM ou É CONTIDO no novo)
          for (const existing of existingTitlesLower) {
            if (!existing || !titleLower) continue;
            if (existing === titleLower) return false; // título idêntico
            // Títulos com >60% de sobreposição
            const shorter = existing.length < titleLower.length ? existing : titleLower;
            const longer = existing.length < titleLower.length ? titleLower : existing;
            if (longer.includes(shorter) && shorter.length > 15) return false; // um contém o outro
          }
          // Verificar por URL
          if (urlClean && existingUrls.has(urlClean)) return false;
          return true;
        });

        if (newItems.length === 0) {
          loadingEl.remove();
          const totalFound = webData.length;
          addMessage('assistant', `Busca encontrou ${totalFound} resultado(s), mas todos já estão cadastrados no banco. Nenhuma novidade para adicionar. ✅`);
          return;
        }

        const skippedCount = webData.length - newItems.length;

        // ══ CADASTRO DIRETO (sem depender da IA — mais rápido e confiável) ══
        const wasClippingSearch = webResults.some(r => r.action === 'search_web_clipping');
        const createAction = wasClippingSearch ? 'create_clipping' : 'create_news';
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        let created = 0;
        let errors = 0;
        const createdTitles = [];

        for (const item of newItems.slice(0, 10)) {
          try {
            const params = {
              title: item.title || 'Sem título',
              description: item.snippet || '',
              sourceUrl: item.url || '',
              sourceName: item.source || '',
              publishedAt: today,
            };

            // Campos específicos por tipo
            if (createAction === 'create_clipping') {
              params.mediaType = 'Digital';
              params.contentType = guessContentType(item.title, item.snippet);
              params.sentiment = 'neutral';
            } else {
              params.category = guessCategory(item.title, item.snippet);
              params.subcategory = 'Notícias';
            }

            const result = await executeAction(moduleId, createAction, params);
            if (result.success) {
              created++;
              createdTitles.push(item.title);
              addMessage('system', `⚡ ✅ ${createAction === 'create_clipping' ? 'Clipping' : 'Notícia'} cadastrado: <strong>${esc(item.title)}</strong>`
                + (item.url ? `<br><a href="${esc(item.url)}" target="_blank" style="color:var(--primary);font-size:0.8rem;">${esc(item.source || item.url)}</a>` : ''));
            } else {
              errors++;
            }
          } catch (e) {
            errors++;
            console.warn('[cadastro direto] Erro:', e.message);
          }
        }

        loadingEl.remove();

        // Resumo final
        const resumo = [];
        if (created > 0) resumo.push(`✅ ${created} novo(s) cadastrado(s)`);
        if (skippedCount > 0) resumo.push(`⏭️ ${skippedCount} já existente(s) ignorado(s)`);
        if (errors > 0) resumo.push(`❌ ${errors} erro(s)`);
        addMessage('assistant', resumo.join(' · '));
        chatHistory.push({ role: 'assistant', text: `Cadastro concluído: ${resumo.join(', ')}. Itens: ${createdTitles.join('; ')}` });
      } catch (err) {
        loadingEl.remove();
        addMessage('assistant', `<span style="color:var(--danger,#EF4444);">Erro: ${esc(err.message)}</span>`);
      }
      return; // FIM — não encadear mais nada
    }

    // Cenário 2: Só ações de escrita sem dados → sem follow-up
    if (hasWriteActions && dataResults.length === 0) return;

    // Cenário 3: Dados de listagem sem busca web → análise ou encaminhamento
    if (dataResults.length > 0) {
      const loadingEl = addLoading('Analisando dados');
      try {
        const dataContext = dataResults.map(r =>
          `Ação "${r.action}" retornou: ${r.message}\nDados:\n${JSON.stringify(r.data ?? {}, null, 1).substring(0, 1500)}`
        ).join('\n\n');

        let followUpMsg;

        // Se banco vazio no módulo de notícias e não teve busca web → pedir busca web
        const isNewsModule = moduleId === 'news-monitor';
        if (isNewsModule && allDataEmpty) {
          const originalMsg = chatHistory.find(h => h.role === 'user')?.text || '';
          followUpMsg = `O banco interno está vazio. O usuário pediu: "${originalMsg}".\n`
            + `TAREFA: Busque na INTERNET usando search_web_news (query: termos do pedido) e/ou search_web_clipping.\n`
            + `NÃO use list_news ou list_clippings. Execute APENAS busca web AGORA.`;
        } else if (hasWriteActions) {
          // Dados + ações de escrita pendentes → usar IDs
          followUpMsg = `Resultados:\n${dataContext}\n\nAgora execute a ação necessária com os IDs encontrados.`;
        } else {
          // Dados puros → análise
          followUpMsg = `Dados obtidos:\n${dataContext}\n\n`
            + `TAREFA: Analise estes dados em profundidade. Forneça:\n`
            + `1. RESUMO: visão geral dos números e estado atual\n`
            + `2. DESTAQUES: pontos positivos e negativos\n`
            + `3. SUGESTÕES: 3-5 recomendações práticas\n`
            + `4. ALERTAS: problemas urgentes ou tendências preocupantes\n`
            + `Seja específico, use os dados reais. NÃO execute ações — apenas analise em texto.`;
        }

        chatHistory.push({ role: 'user', text: followUpMsg });
        const ctx = typeof getContextFn === 'function' ? getContextFn() : {};
        const followResult = await chatWithAI(followUpMsg, ctx, { moduleId, history: chatHistory.slice(-8) });
        loadingEl.remove();

        const followActions = parseActions(followResult.text);
        let followClean = cleanActionBlocks(followResult.text);
        followClean = followClean.replace(/<<<ACTION>>>?/g, '').replace(/<<<END_ACTION>>>?/g, '').trim();
        if (followClean) {
          addMessage('assistant', esc(followClean));
          chatHistory.push({ role: 'assistant', text: followClean });
        }

        // Executar ações do follow-up (ex: search_web após banco vazio, ou write com IDs)
        const followBatchResults = await executeActionBatch(followActions, getContextFn);

        // Se o follow-up gerou busca web com resultados → cadastrar (1 nível extra apenas)
        const followWebResults = followBatchResults.filter(r =>
          r.success && WEB_ACTIONS.has(r.action) && Array.isArray(r.data) && r.data.length > 0
        );
        if (followWebResults.length > 0) {
          const chainLoading = addLoading('Filtrando duplicatas e cadastrando');
          try {
            const webData = followWebResults
              .map(r => r.data.filter(d => d.url && !d.title?.includes('indisponível')))
              .flat();
            if (webData.length > 0) {
              // Deduplicação programática (mesmo padrão do cenário 1)
              const chainExisting = listResults.map(r => (Array.isArray(r.data) ? r.data : [])).flat();
              const chainExistTitles = new Set(chainExisting.map(d => (d.title || '').toLowerCase().trim()).filter(Boolean));
              const chainExistUrls = new Set(chainExisting.map(d => (d.sourceUrl || d.url || '').replace(/https?:\/\/(www\.)?/, '').replace(/\/+$/, '').toLowerCase()).filter(Boolean));

              const chainNewItems = webData.filter(item => {
                const tl = (item.title || '').toLowerCase().trim();
                const uc = (item.url || '').replace(/https?:\/\/(www\.)?/, '').replace(/\/+$/, '').toLowerCase();
                for (const et of chainExistTitles) {
                  if (!et || !tl) continue;
                  if (et === tl) return false;
                  const shorter = et.length < tl.length ? et : tl;
                  const longer = et.length < tl.length ? tl : et;
                  if (longer.includes(shorter) && shorter.length > 15) return false;
                }
                if (uc && chainExistUrls.has(uc)) return false;
                return true;
              });

              if (chainNewItems.length === 0) {
                chainLoading.remove();
                addMessage('assistant', `Todos os resultados da busca já estão cadastrados. Nenhuma novidade. ✅`);
                return;
              }

              // CADASTRO DIRETO (mesmo padrão do cenário 1)
              const chainWasClipping = followWebResults.some(r => r.action === 'search_web_clipping');
              const chainCreateAction = chainWasClipping ? 'create_clipping' : 'create_news';
              const chainToday = new Date().toISOString().split('T')[0];
              let chainCreated = 0, chainErrors = 0;

              for (const item of chainNewItems.slice(0, 10)) {
                try {
                  const p = {
                    title: item.title || 'Sem título',
                    description: item.snippet || '',
                    sourceUrl: item.url || '',
                    sourceName: item.source || '',
                    publishedAt: chainToday,
                  };
                  if (chainCreateAction === 'create_clipping') {
                    p.mediaType = 'Digital';
                    p.contentType = guessContentType(item.title, item.snippet);
                    p.sentiment = 'neutral';
                  } else {
                    p.category = guessCategory(item.title, item.snippet);
                    p.subcategory = 'Notícias';
                  }
                  const res = await executeAction(moduleId, chainCreateAction, p);
                  if (res.success) {
                    chainCreated++;
                    addMessage('system', `⚡ ✅ Cadastrado: <strong>${esc(item.title)}</strong>`
                      + (item.url ? `<br><a href="${esc(item.url)}" target="_blank" style="color:var(--primary);font-size:0.8rem;">${esc(item.source || item.url)}</a>` : ''));
                  } else { chainErrors++; }
                } catch { chainErrors++; }
              }
              chainLoading.remove();
              const chainSkipped = webData.length - chainNewItems.length;
              const cR = [];
              if (chainCreated > 0) cR.push(`✅ ${chainCreated} cadastrado(s)`);
              if (chainSkipped > 0) cR.push(`⏭️ ${chainSkipped} já existente(s)`);
              if (chainErrors > 0) cR.push(`❌ ${chainErrors} erro(s)`);
              addMessage('assistant', cR.join(' · '));
            }
          } catch (err) {
            chainLoading.remove();
            addMessage('assistant', `<span style="color:var(--danger,#EF4444);">Erro: ${esc(err.message)}</span>`);
          }
        }
      } catch (err) {
        loadingEl.remove();
        addMessage('assistant', `<span style="color:var(--danger,#EF4444);">Erro: ${esc(err.message)}</span>`);
      }
    }
  }

  /**
   * Executa um lote de ações e retorna os resultados.
   * Sem follow-up — apenas executa e registra no histórico.
   */
  async function executeActionBatch(actionList, getContextFn) {
    const batchResults = [];
    for (const actionBlock of actionList) {
      const { action, params } = actionBlock;
      addMessage('action', `⚡Executando: <strong>${esc(action)}</strong>...`);
      try {
        const result = await executeAction(moduleId, action, params || {});
        logAction(moduleId, action, result.success, params);
        const dp = formatActionData(action, result.data);
        addMessage('action', `${result.success ? '✅' : '❌'} ${esc(result.message || 'OK')}${dp}`);

        const dataStr = result.data != null ? JSON.stringify(result.data) : '';
        const createdId = result.data?.taskId || result.data?.newsId || result.data?.clippingId
                       || result.data?.tipId || result.data?.destinationId || result.data?.id
                       || result.taskId || '';
        const idHint = createdId ? ` >>> ID_CRIADO="${createdId}" <<<` : '';
        chatHistory.push({
          role: 'assistant',
          text: `[${result.success ? 'OK' : 'Erro'} ${action}]: ${result.message || ''}${idHint}${dataStr ? '. Dados: ' + dataStr.substring(0, 800) : ''}`,
        });

        batchResults.push({ action, success: result.success, data: result.data, message: result.message });
      } catch (err) {
        addMessage('action', `❌ Erro: ${esc(err.message)}`);
        chatHistory.push({ role: 'assistant', text: `[Erro ${action}]: ${err.message}` });
        batchResults.push({ action, success: false, data: null, message: err.message });
      }
    }
    return batchResults;
  }

  // ── Send message ──
  async function sendMessage(text) {
    const hasFiles = pendingFiles.length > 0;
    if (!text.trim() && !hasFiles) return;
    if (isProcessing) return;
    isProcessing = true;
    sendBtn.disabled = true;
    inputEl.disabled = true;
    if (attachBtn) attachBtn.disabled = true;

    // Montar mensagem visual do usuário
    let userHtml = '';
    if (hasFiles) {
      userHtml += pendingFiles.map(f => {
        const ext = f.name.split('.').pop()?.toUpperCase() || '?';
        return `<div class="ai-file-badge">${ext === 'PDF' ? '📄' : ext === 'XLSX' || ext === 'XLS' || ext === 'CSV' ? '📊' : ext === 'DOCX' ? '📝' : '🖼'} ${esc(f.name)}</div>`;
      }).join('');
    }
    if (text.trim()) userHtml += esc(text);
    else if (hasFiles) userHtml += '<em style="opacity:0.6;">Analise este(s) arquivo(s)</em>';

    addMessage('user', userHtml);
    chatHistory.push({ role: 'user', text: text || '[Arquivos anexados]' });

    // Parse dos arquivos (se houver)
    let fileContextBlock = '';
    if (hasFiles) {
      const parsingEl = addLoading('Processando arquivo(s)');
      try {
        parsedAttachments = await parseFiles(pendingFiles);
        fileContextBlock = formatFilesForPrompt(parsedAttachments);
        // Mostrar resumo do parsing
        for (const p of parsedAttachments) {
          if (p.error) {
            addMessage('action', `⚠ ${esc(p.fileName)}: ${esc(p.error)}`);
          } else {
            addMessage('action', `${p.fileIcon} ${esc(p.fileName)} — ${esc(p.summary)}`);
          }
        }
      } catch (err) {
        addMessage('action', `⚠ Erro ao processar arquivos: ${esc(err.message)}`);
      }
      parsingEl.remove();
      // Limpar anexos
      pendingFiles = [];
      renderAttachPreview();
    }

    const loadingEl = addLoading();

    try {
      const context = typeof getContext === 'function' ? getContext() : {};
      // Injetar conteúdo dos arquivos no contexto
      if (fileContextBlock) {
        context.__fileContext = fileContextBlock;
      }
      const result = await chatWithAI(text || 'Analise os arquivos anexados e descreva o conteúdo.', context, {
        moduleId,
        history: chatHistory.slice(-6),
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
    if (attachBtn) attachBtn.disabled = false;
    inputEl.value = '';
    inputEl.style.height = 'auto';
    parsedAttachments = [];
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
