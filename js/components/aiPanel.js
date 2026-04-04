/**
 * PRIMETOUR — AI Panel
 * Componente universal que renderiza skills de IA em qualquer módulo
 *
 * Uso:
 *   import { mountAiPanel } from '../components/aiPanel.js';
 *   mountAiPanel(containerEl, 'portal-tips', () => ({ title, body, category }));
 *
 * O painel consulta Firestore por skills ativas do módulo e renderiza botões.
 * Se não houver skills, não renderiza nada (zero impacto visual).
 */

import { fetchSkillsForModule, runSkill, MODULE_REGISTRY } from '../services/ai.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/**
 * Monta o painel de IA em um container
 * @param {HTMLElement} container — onde inserir o painel
 * @param {string} moduleId — ex: 'portal-tips', 'tasks', 'dashboards'
 * @param {Function} getContext — função que retorna o contexto atual do módulo
 * @param {Object} [options]
 * @param {string} [options.position='bottom'] — 'bottom'|'top'|'inline'
 * @param {Function} [options.onResult] — callback(result, skill) chamado após execução
 */
export async function mountAiPanel(container, moduleId, getContext, options = {}) {
  if (!container || !moduleId) return;

  const skills = await fetchSkillsForModule(moduleId).catch(() => []);
  if (!skills.length) return; // Nenhuma skill → nada a mostrar

  const panelId = `ai-panel-${moduleId}-${Date.now()}`;

  const panelHtml = `
    <div id="${panelId}" class="ai-panel" style="
      margin:${options.position === 'top' ? '0 0 16px 0' : '16px 0 0 0'};
      border:1px solid var(--border-subtle);
      border-radius:10px;
      overflow:hidden;
      background:var(--bg-card);
    ">
      <!-- Header colapsável -->
      <div class="ai-panel-header" style="
        display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;
        background:linear-gradient(135deg,rgba(212,168,67,0.08),rgba(212,168,67,0.02));
        user-select:none;
      ">
        <span style="font-size:0.875rem;color:var(--brand-gold);font-weight:600;">◈</span>
        <span style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);">Assistente IA</span>
        <span style="font-size:0.6875rem;color:var(--text-muted);background:var(--bg-surface);
          padding:1px 6px;border-radius:8px;">${skills.length} skill${skills.length > 1 ? 's' : ''}</span>
        <span class="ai-panel-chevron" style="margin-left:auto;color:var(--text-muted);font-size:0.75rem;
          transition:transform 0.2s;">▼</span>
      </div>

      <!-- Body (colapsável) -->
      <div class="ai-panel-body" style="padding:12px 14px;display:none;">
        <!-- Skill buttons -->
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
          ${skills.map(s => `
            <button class="ai-skill-btn" data-skill-id="${s.id}" style="
              padding:6px 14px;border-radius:6px;font-size:0.8125rem;cursor:pointer;
              border:1px solid var(--brand-gold);background:transparent;color:var(--brand-gold);
              font-weight:500;transition:all 0.15s;
            " onmouseover="this.style.background='var(--brand-gold)';this.style.color='var(--bg-dark)';"
              onmouseout="this.style.background='transparent';this.style.color='var(--brand-gold)';">
              ▶ ${esc(s.name)}
            </button>
          `).join('')}
        </div>

        <!-- Result area -->
        <div class="ai-panel-result" id="${panelId}-result" style="display:none;">
          <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:6px;display:flex;align-items:center;gap:8px;">
            <span class="ai-result-label">Resultado</span>
            <span class="ai-result-meta" style="margin-left:auto;"></span>
          </div>
          <div class="ai-result-content" style="
            background:var(--bg-surface);border-radius:8px;padding:14px;
            font-size:0.875rem;line-height:1.7;white-space:pre-wrap;
            max-height:400px;overflow-y:auto;color:var(--text-primary);
          "></div>
          <div style="display:flex;gap:8px;margin-top:8px;">
            <button class="ai-copy-btn" style="
              padding:4px 12px;border-radius:4px;font-size:0.75rem;cursor:pointer;
              border:1px solid var(--border-subtle);background:transparent;color:var(--text-muted);
            ">Copiar</button>
            <button class="ai-apply-btn" style="
              padding:4px 12px;border-radius:4px;font-size:0.75rem;cursor:pointer;
              border:1px solid var(--brand-gold);background:transparent;color:var(--brand-gold);
              display:none;
            ">Aplicar ao campo</button>
          </div>
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

  // Toggle collapse
  const header = panel.querySelector('.ai-panel-header');
  const body   = panel.querySelector('.ai-panel-body');
  const chevron = panel.querySelector('.ai-panel-chevron');
  let expanded = false;

  header?.addEventListener('click', () => {
    expanded = !expanded;
    body.style.display = expanded ? 'block' : 'none';
    chevron.style.transform = expanded ? 'rotate(180deg)' : '';
  });

  // Auto-expand for 'auto' trigger skills
  if (skills.some(s => s.trigger === 'auto')) {
    expanded = true;
    body.style.display = 'block';
    chevron.style.transform = 'rotate(180deg)';
  }

  // Skill execution buttons
  panel.querySelectorAll('.ai-skill-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const skillId = btn.dataset.skillId;
      const resultArea = document.getElementById(`${panelId}-result`);
      const contentEl  = resultArea?.querySelector('.ai-result-content');
      const metaEl     = resultArea?.querySelector('.ai-result-meta');
      const labelEl    = resultArea?.querySelector('.ai-result-label');
      const applyBtn   = resultArea?.querySelector('.ai-apply-btn');
      if (!resultArea || !contentEl) return;

      // Disable all buttons
      panel.querySelectorAll('.ai-skill-btn').forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });
      btn.textContent = 'Processando...';

      resultArea.style.display = 'block';
      contentEl.textContent = 'Aguardando resposta da IA...';
      contentEl.style.opacity = '0.5';

      try {
        const context = typeof getContext === 'function' ? getContext() : {};
        const result = await runSkill(skillId, context);

        contentEl.style.opacity = '1';
        contentEl.textContent = result.text;
        if (labelEl) labelEl.textContent = result.skillName || 'Resultado';
        if (metaEl) metaEl.textContent = `${result.isMock ? 'DEMO' : result.provider} · ${result.model} · ${(result.inputTokens + result.outputTokens).toLocaleString('pt-BR')} tokens`;

        // Show apply button if onResult callback exists
        if (options.onResult && applyBtn) {
          applyBtn.style.display = '';
          applyBtn.onclick = () => options.onResult(result, skills.find(s => s.id === skillId));
        }
      } catch (err) {
        contentEl.style.opacity = '1';
        contentEl.style.color = 'var(--danger, #ef4444)';
        contentEl.textContent = 'Erro: ' + err.message;
      }

      // Re-enable buttons
      panel.querySelectorAll('.ai-skill-btn').forEach(b => { b.disabled = false; b.style.opacity = '1'; });
      const skill = skills.find(s => s.id === skillId);
      btn.textContent = `▶ ${skill?.name || 'Executar'}`;
    });
  });

  // Copy button
  panel.querySelector('.ai-copy-btn')?.addEventListener('click', () => {
    const text = panel.querySelector('.ai-result-content')?.textContent || '';
    navigator.clipboard.writeText(text).then(() => toast('Copiado!')).catch(() => {});
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

// Importar toast se disponível
let toast = (msg) => { /* fallback silencioso */ };
try {
  const m = await import('../components/toast.js');
  toast = m.toast?.success || m.toast || toast;
} catch {}
