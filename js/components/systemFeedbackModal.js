/**
 * PRIMETOUR — Modal "Enviar Sugestão sobre o Sistema"
 *
 * Acessível de qualquer página via:
 *   import { openSystemFeedbackModal } from './systemFeedbackModal.js';
 *   openSystemFeedbackModal();
 *
 * Coleta tipo + mensagem. Página atual e dados do user vão automáticos.
 */

import { modal } from './modal.js';
import { toast } from './toast.js';
import { FEEDBACK_TYPES, createSystemFeedback } from '../services/systemFeedback.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function openSystemFeedbackModal({ initialType = 'suggestion' } = {}) {
  const m = modal.open({
    title: '💬 Enviar Sugestão sobre o Sistema',
    size: 'md',
    content: `
      <p style="margin:0 0 16px;font-size:0.875rem;color:var(--text-secondary);">
        Sua mensagem vai direto pra Diretoria por e-mail. Bugs são priorizados conforme impacto; sugestões alimentam o roadmap.
      </p>

      <div class="form-group">
        <label class="form-label">Tipo *</label>
        <div id="sf-type-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
          ${FEEDBACK_TYPES.map(t => `
            <label class="sf-type-card" data-type="${t.id}" style="
              display:flex;flex-direction:column;gap:4px;padding:12px;
              border-radius:var(--radius-md);cursor:pointer;
              border:1.5px solid ${t.id===initialType ? t.color : 'var(--border-default)'};
              background:${t.id===initialType ? t.color+'15' : 'var(--bg-surface)'};
              transition:all 0.15s;">
              <input type="radio" name="sf-type" value="${t.id}" ${t.id===initialType?'checked':''} style="display:none;">
              <div style="font-weight:600;font-size:0.875rem;color:${t.color};">${t.label}</div>
              <div style="font-size:0.7rem;color:var(--text-muted);line-height:1.4;">${t.desc}</div>
            </label>
          `).join('')}
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Mensagem *</label>
        <textarea id="sf-message" class="form-textarea" rows="6" maxlength="2000"
          placeholder="Descreva o que você está tentando fazer, o que aconteceu (ou o que gostaria que acontecesse), e onde no sistema. Quanto mais contexto, mais rápido conseguimos endereçar."></textarea>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
          <small style="font-size:0.7rem;color:var(--text-muted);">
            📎 Anexamos automaticamente a página atual + sua versão do app
          </small>
          <small id="sf-char-count" style="font-size:0.7rem;color:var(--text-muted);">0 / 2000</small>
        </div>
      </div>

      <div style="margin-top:14px;padding:10px 12px;background:var(--bg-surface);border-radius:6px;
        font-size:0.7rem;color:var(--text-muted);line-height:1.55;">
        <strong style="color:var(--text-secondary);">Dados que enviamos junto:</strong>
        Seu nome, e-mail e função no sistema · Página atual (${esc(location.hash || '#')}) · Versão do app · Browser
      </div>
    `,
    footer: [
      { label: 'Cancelar', class: 'btn-secondary', closeOnClick: true },
      {
        label: 'Enviar',
        class: 'btn-primary',
        closeOnClick: false,
        onClick: async (_, { close }) => {
          const type = document.querySelector('input[name="sf-type"]:checked')?.value;
          const message = document.getElementById('sf-message')?.value?.trim();
          if (!type) { toast.error('Selecione um tipo.'); return; }
          if (!message) { toast.error('Escreva sua mensagem.'); return; }

          const btn = document.querySelector('.modal-footer .btn-primary');
          if (btn) { btn.classList.add('loading'); btn.disabled = true; btn.textContent = '⏳ Enviando...'; }
          try {
            await createSystemFeedback({ type, message });
            toast.success('✓ Sugestão enviada! A Diretoria recebeu por e-mail.');
            close();
          } catch (e) {
            toast.error(e.message || 'Falha ao enviar.');
            if (btn) { btn.classList.remove('loading'); btn.disabled = false; btn.textContent = 'Enviar'; }
          }
        }
      }
    ],
  });

  // Type card selection (visual)
  setTimeout(() => {
    document.querySelectorAll('#sf-type-grid .sf-type-card').forEach(card => {
      card.addEventListener('click', (e) => {
        e.preventDefault();
        const t = card.dataset.type;
        const tInfo = FEEDBACK_TYPES.find(x => x.id === t);
        // Atualiza radio
        const radio = card.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
        // Visual de todos
        document.querySelectorAll('#sf-type-grid .sf-type-card').forEach(c => {
          const cInfo = FEEDBACK_TYPES.find(x => x.id === c.dataset.type);
          const isSelected = c.dataset.type === t;
          c.style.borderColor = isSelected ? cInfo.color : 'var(--border-default)';
          c.style.background  = isSelected ? cInfo.color + '15' : 'var(--bg-surface)';
        });
      });
    });

    // Character counter
    const ta = document.getElementById('sf-message');
    const counter = document.getElementById('sf-char-count');
    ta?.addEventListener('input', () => {
      counter.textContent = `${ta.value.length} / 2000`;
    });
    ta?.focus();
  }, 60);

  return m;
}
