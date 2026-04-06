/**
 * PRIMETOUR — AI Panel (Chat + Skills)
 *
 * Componente universal de IA para todos os módulos.
 * Renderiza um chat interativo + atalhos de skills.
 * A IA recebe o contexto do módulo automaticamente e pode gerar conteúdo.
 *
 * Uso:
 *   import { mountAiPanel } from '../components/aiPanel.js';
 *   mountAiPanel(containerEl, 'tasks', () => ({ title, body, ... }));
 */

import { fetchSkillsForModule, runSkill, chatWithAI, MODULE_REGISTRY, getAIConfig } from '../services/ai.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Toast import (silencioso se falhar)
let _toast = () => {};
try { const m = await import('../components/toast.js'); _toast = m.toast?.success || m.toast || _toast; } catch {}

/**
 * Monta o painel de IA (chat + skills) em um container
 */
export async function mountAiPanel(container, moduleId, getContext, options = {}) {
  if (!container || !moduleId) return;

  // Verificar se há config de IA (global ou escopada)
  const [skills, config] = await Promise.all([
    fetchSkillsForModule(moduleId).catch(() => []),
    getAIConfig().catch(() => null),
  ]);

  // Se não há skills NEM config → não montar nada
  if (!skills.length && !config) return;

  const panelId = `ai-panel-${moduleId}-${Date.now()}`;
  const moduleMeta = MODULE_REGISTRY[moduleId] || { label: moduleId, icon: '◈' };
  const hasSkills = skills.length > 0;

  const panelHtml = `
    <div id="${panelId}" class="ai-panel" style="
      margin:12px 0;border:1px solid var(--border-subtle);border-radius:12px;
      overflow:hidden;background:var(--bg-card);
    ">
      <!-- Header -->
      <div class="ai-panel-header" style="
        display:flex;align-items:center;gap:8px;padding:10px 16px;cursor:pointer;
        background:linear-gradient(135deg,rgba(212,168,67,0.08),rgba(212,168,67,0.02));
        user-select:none;border-bottom:1px solid var(--border-subtle);
      ">
        <span style="font-size:1rem;color:var(--brand-gold);">◈</span>
        <span style="font-size:0.875rem;font-weight:600;color:var(--text-primary);">Assistente IA</span>
        <span style="font-size:0.6875rem;color:var(--text-muted);background:var(--bg-surface);
          padding:2px 8px;border-radius:8px;">${esc(moduleMeta.label)}</span>
        ${hasSkills ? `<span style="font-size:0.6875rem;color:var(--brand-gold);background:rgba(212,168,67,0.1);
          padding:2px 8px;border-radius:8px;">${skills.length} skill${skills.length>1?'s':''}</span>` : ''}
        <span class="ai-panel-chevron" style="margin-left:auto;color:var(--text-muted);font-size:0.75rem;
          transition:transform 0.2s;">▼</span>
      </div>

      <!-- Body -->
      <div class="ai-panel-body" style="display:none;">

        ${hasSkills ? `
        <!-- Skills rápidas -->
        <div style="padding:10px 16px;border-bottom:1px solid var(--border-subtle);background:var(--bg-surface);">
          <div style="font-size:0.6875rem;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Skills rápidas</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${skills.map(s => `
              <button class="ai-skill-btn" data-skill-id="${s.id}" title="${esc(s.description || '')}" style="
                padding:5px 12px;border-radius:20px;font-size:0.75rem;cursor:pointer;
                border:1px solid var(--brand-gold);background:transparent;color:var(--brand-gold);
                font-weight:500;transition:all 0.15s;white-space:nowrap;
              ">▶ ${esc(s.name)}</button>
            `).join('')}
          </div>
        </div>
        ` : ''}

        <!-- Chat area -->
        <div class="ai-chat-messages" id="${panelId}-messages" style="
          padding:16px;min-height:80px;max-height:400px;overflow-y:auto;
          display:flex;flex-direction:column;gap:12px;
        ">
          <!-- Welcome message -->
          <div class="ai-msg ai-msg-assistant" style="display:flex;gap:10px;align-items:flex-start;">
            <div style="min-width:28px;height:28px;border-radius:50%;background:var(--brand-gold);
              display:flex;align-items:center;justify-content:center;font-size:0.75rem;color:var(--bg-dark);font-weight:700;">IA</div>
            <div style="background:var(--bg-surface);border-radius:12px;padding:10px 14px;max-width:85%;
              font-size:0.8125rem;line-height:1.6;color:var(--text-primary);">
              Olá! Sou o assistente IA do módulo <strong>${esc(moduleMeta.label)}</strong>.
              ${hasSkills
                ? `Tenho ${skills.length} skill${skills.length>1?'s':''} prontas — use os atalhos acima ou me pergunte qualquer coisa sobre este módulo.`
                : 'Me pergunte qualquer coisa sobre este módulo e eu vou te ajudar.'
              }
            </div>
          </div>
        </div>

        <!-- Input -->
        <div style="padding:12px 16px;border-top:1px solid var(--border-subtle);display:flex;gap:8px;align-items:flex-end;">
          <textarea id="${panelId}-input" rows="1" placeholder="Pergunte algo ou peça para gerar conteúdo..."
            style="flex:1;resize:none;border:1px solid var(--border-subtle);border-radius:10px;
            padding:10px 14px;font-size:0.8125rem;background:var(--bg-surface);color:var(--text-primary);
            font-family:inherit;line-height:1.4;max-height:120px;overflow-y:auto;outline:none;
            transition:border-color 0.2s;"
            onfocus="this.style.borderColor='var(--brand-gold)'"
            onblur="this.style.borderColor='var(--border-subtle)'"
          ></textarea>
          <button id="${panelId}-send" style="
            padding:10px 16px;border-radius:10px;border:none;background:var(--brand-gold);
            color:var(--bg-dark);font-weight:600;font-size:0.8125rem;cursor:pointer;
            white-space:nowrap;transition:opacity 0.15s;min-height:40px;
          ">Enviar</button>
        </div>
      </div>
    </div>
  `;

  // Insert
  if (options.position === 'top') {
    container.insertAdjacentHTML('afterbegin', panelHtml);
  } else {
    container.insertAdjacentHTML('beforeend', panelHtml);
  }

  const panel = document.getElementById(panelId);
  if (!panel) return;

  // ── State ──
  const chatHistory = [];
  let isProcessing = false;

  // ── DOM refs ──
  const headerEl   = panel.querySelector('.ai-panel-header');
  const bodyEl     = panel.querySelector('.ai-panel-body');
  const chevronEl  = panel.querySelector('.ai-panel-chevron');
  const messagesEl = document.getElementById(`${panelId}-messages`);
  const inputEl    = document.getElementById(`${panelId}-input`);
  const sendBtn    = document.getElementById(`${panelId}-send`);
  let expanded = false;

  // ── Toggle collapse ──
  headerEl?.addEventListener('click', () => {
    expanded = !expanded;
    bodyEl.style.display = expanded ? 'block' : 'none';
    chevronEl.style.transform = expanded ? 'rotate(180deg)' : '';
    if (expanded) inputEl?.focus();
  });

  // ── Auto-resize textarea ──
  inputEl?.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });

  // ── Helper: add message to chat ──
  function addMessage(role, html, meta = '') {
    const isUser = role === 'user';
    const msgEl = document.createElement('div');
    msgEl.className = `ai-msg ai-msg-${role}`;
    msgEl.style.cssText = `display:flex;gap:10px;align-items:flex-start;${isUser ? 'flex-direction:row-reverse;' : ''}`;

    const avatar = isUser
      ? `<div style="min-width:28px;height:28px;border-radius:50%;background:var(--brand-primary,#3b82f6);
          display:flex;align-items:center;justify-content:center;font-size:0.7rem;color:#fff;font-weight:700;">EU</div>`
      : `<div style="min-width:28px;height:28px;border-radius:50%;background:var(--brand-gold);
          display:flex;align-items:center;justify-content:center;font-size:0.75rem;color:var(--bg-dark);font-weight:700;">IA</div>`;

    const bubbleBg = isUser ? 'var(--brand-gold)' : 'var(--bg-surface)';
    const bubbleColor = isUser ? 'var(--bg-dark)' : 'var(--text-primary)';

    msgEl.innerHTML = `
      ${avatar}
      <div style="max-width:85%;">
        <div style="background:${bubbleBg};border-radius:12px;padding:10px 14px;
          font-size:0.8125rem;line-height:1.6;color:${bubbleColor};white-space:pre-wrap;word-wrap:break-word;">${html}</div>
        ${meta ? `<div style="font-size:0.6875rem;color:var(--text-muted);margin-top:4px;${isUser?'text-align:right;':''}">${meta}</div>` : ''}
        ${!isUser ? `<div style="display:flex;gap:6px;margin-top:4px;">
          <button class="ai-copy-msg" style="font-size:0.6875rem;color:var(--text-muted);background:none;border:none;cursor:pointer;padding:2px 6px;border-radius:4px;transition:background 0.15s;"
            onmouseover="this.style.background='var(--bg-surface)'" onmouseout="this.style.background='none'">Copiar</button>
        </div>` : ''}
      </div>
    `;

    messagesEl.appendChild(msgEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Copy button handler
    msgEl.querySelector('.ai-copy-msg')?.addEventListener('click', () => {
      const text = msgEl.querySelector('div[style*="white-space"]')?.textContent || '';
      navigator.clipboard.writeText(text).then(() => _toast('Copiado!')).catch(() => {});
    });

    return msgEl;
  }

  // ── Helper: add loading indicator ──
  function addLoading() {
    const el = document.createElement('div');
    el.className = 'ai-msg ai-msg-loading';
    el.style.cssText = 'display:flex;gap:10px;align-items:flex-start;';
    el.innerHTML = `
      <div style="min-width:28px;height:28px;border-radius:50%;background:var(--brand-gold);
        display:flex;align-items:center;justify-content:center;font-size:0.75rem;color:var(--bg-dark);font-weight:700;">IA</div>
      <div style="background:var(--bg-surface);border-radius:12px;padding:10px 14px;
        font-size:0.8125rem;color:var(--text-muted);">
        <span class="ai-typing">Pensando</span>
        <style>.ai-typing::after{content:'...';animation:dots 1.5s infinite}@keyframes dots{0%{content:'.'}33%{content:'..'}66%{content:'...'}}</style>
      </div>
    `;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  // ── Send chat message ──
  async function sendMessage(text) {
    if (!text.trim() || isProcessing) return;
    isProcessing = true;
    sendBtn.disabled = true;
    sendBtn.style.opacity = '0.5';
    inputEl.disabled = true;

    // User message
    addMessage('user', esc(text));
    chatHistory.push({ role: 'user', text });

    // Loading indicator
    const loadingEl = addLoading();

    try {
      const context = typeof getContext === 'function' ? getContext() : {};
      const result = await chatWithAI(text, context, {
        moduleId,
        history: chatHistory.slice(-10), // últimas 10 mensagens para contexto
      });

      loadingEl.remove();

      const meta = `${result.provider || '?'} · ${result.model || '?'} · ${((result.inputTokens||0)+(result.outputTokens||0)).toLocaleString('pt-BR')} tokens`;
      addMessage('assistant', esc(result.text), meta);
      chatHistory.push({ role: 'assistant', text: result.text });
    } catch (err) {
      loadingEl.remove();
      addMessage('assistant', `<span style="color:var(--danger);">Erro: ${esc(err.message)}</span>`);
    }

    isProcessing = false;
    sendBtn.disabled = false;
    sendBtn.style.opacity = '1';
    inputEl.disabled = false;
    inputEl.value = '';
    inputEl.style.height = 'auto';
    inputEl.focus();
  }

  // ── Event: Send button ──
  sendBtn?.addEventListener('click', () => sendMessage(inputEl?.value || ''));

  // ── Event: Enter to send (Shift+Enter for newline) ──
  inputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputEl.value);
    }
  });

  // ── Event: Skill buttons ──
  panel.querySelectorAll('.ai-skill-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (isProcessing) return;
      const skillId = btn.dataset.skillId;
      const skill = skills.find(s => s.id === skillId);
      if (!skill) return;

      isProcessing = true;
      sendBtn.disabled = true;
      sendBtn.style.opacity = '0.5';

      // Disable skill buttons
      panel.querySelectorAll('.ai-skill-btn').forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });

      // User message (simulated)
      addMessage('user', `▶ <strong>${esc(skill.name)}</strong>`);
      chatHistory.push({ role: 'user', text: `[Skill: ${skill.name}]` });

      const loadingEl = addLoading();

      // Expand panel if collapsed
      if (!expanded) {
        expanded = true;
        bodyEl.style.display = 'block';
        chevronEl.style.transform = 'rotate(180deg)';
      }

      try {
        const context = typeof getContext === 'function' ? getContext() : {};
        const result = await runSkill(skillId, context);

        loadingEl.remove();

        const meta = `${result.isMock ? 'DEMO' : result.provider} · ${result.model} · ${((result.inputTokens||0)+(result.outputTokens||0)).toLocaleString('pt-BR')} tokens`;
        addMessage('assistant', esc(result.text), meta);
        chatHistory.push({ role: 'assistant', text: result.text });

        if (options.onResult) options.onResult(result, skill);
      } catch (err) {
        loadingEl.remove();
        addMessage('assistant', `<span style="color:var(--danger);">Erro: ${esc(err.message)}</span>`);
      }

      isProcessing = false;
      sendBtn.disabled = false;
      sendBtn.style.opacity = '1';
      panel.querySelectorAll('.ai-skill-btn').forEach(b => { b.disabled = false; b.style.opacity = '1'; });
    });
  });

  return panel;
}

/**
 * Remove o painel de IA de um container (cleanup)
 */
export function unmountAiPanel(container) {
  if (!container) return;
  container.querySelectorAll('.ai-panel').forEach(el => el.remove());
}
