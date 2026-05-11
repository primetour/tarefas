/**
 * PRIMETOUR — Emoji Picker
 *
 * Biblioteca curada de emojis pra escolher ícone em formulários
 * (Tipos de tarefa, plataformas, tipos de conteúdo, projetos, etc).
 *
 * Uso:
 *   import { renderEmojiPicker, bindEmojiPicker } from '../components/emojiPicker.js';
 *
 *   // No HTML do form:
 *   <input id="meu-icon" value="📋" />
 *   ${renderEmojiPicker('meu-icon')}
 *
 *   // No JS após render:
 *   bindEmojiPicker('meu-icon');
 *
 * O componente injeta um grid clicável abaixo do input. Click no emoji
 * substitui o valor do input.
 */

export const EMOJI_LIBRARY = {
  'Mídia & Conteúdo': ['📷','📹','🎬','📱','🎵','🎙','📺','📰','📓','📝','✎','🎨','🖼','📸'],
  'Comunicação':      ['✉','💬','📞','📢','🔔','📨','📬','📭','💌','🗨','📩'],
  'Plataformas':      ['◈','▤','▣','🌐','🔗','🎯','#','▶','🎮','📡'],
  'Negócios':         ['💼','📊','📈','📉','💰','💵','🏆','🎖','🏅','📋','📑','🗂','📁'],
  'Marketing':        ['🚀','⚡','🔥','✨','💡','🎉','🎊','🌟','⭐','💎','🎁','🎈'],
  'Pessoas & Equipe': ['👥','🤝','👤','👔','🧑','👨','👩','💼','🎓','🏢'],
  'Tempo & Datas':    ['📅','🗓','📆','⏰','⏱','⏳','🕐','📌','📍'],
  'Símbolos':         ['✅','⛔','🔒','🔓','🔑','⚙','🔧','🛠','🔍','📎','🔖'],
  'Decoração':        ['🌍','🌎','🌏','🌴','🌊','☀','🌙','🌈','❄','🎄','🎀','🏖','✈','🛫'],
};

/**
 * Retorna HTML do picker pra ser concatenado no innerHTML do form.
 * @param {string} inputId - id do <input> que receberá o emoji
 * @param {Object} [opts]
 * @param {number} [opts.maxPerRow=12] tamanho da grid
 */
export function renderEmojiPicker(inputId, { maxPerRow = 12 } = {}) {
  const id = `emp-${inputId}`;
  return `
    <div id="${id}" class="emoji-picker" style="margin-top:6px;
      background:var(--bg-surface);border:1px solid var(--border-subtle);
      border-radius:var(--radius-md);padding:8px;max-height:180px;overflow-y:auto;">
      ${Object.entries(EMOJI_LIBRARY).map(([cat, emojis]) => `
        <div style="margin-bottom:6px;">
          <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;
            letter-spacing:.08em;color:var(--text-muted);padding:3px 2px;">
            ${cat}
          </div>
          <div style="display:grid;grid-template-columns:repeat(${maxPerRow},1fr);gap:2px;">
            ${emojis.map(e => `
              <button type="button" class="emp-btn" data-emoji="${e}" data-input="${inputId}"
                title="${e}"
                style="background:none;border:1px solid transparent;border-radius:4px;
                  cursor:pointer;font-size:1.125rem;padding:4px 0;
                  transition:all 0.1s;line-height:1;">
                ${e}
              </button>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

/**
 * Bind dos clicks: cada emoji setá o input target.
 * Idempotente — pode chamar várias vezes sem efeito colateral.
 */
export function bindEmojiPicker(inputId) {
  const id = `emp-${inputId}`;
  const wrap = document.getElementById(id);
  if (!wrap) return;
  wrap.querySelectorAll('.emp-btn').forEach(btn => {
    if (btn._empBound) return;
    btn._empBound = true;
    btn.addEventListener('mouseover', () => {
      btn.style.background = 'rgba(212,168,67,0.15)';
      btn.style.borderColor = 'rgba(212,168,67,0.4)';
    });
    btn.addEventListener('mouseout', () => {
      btn.style.background = 'none';
      btn.style.borderColor = 'transparent';
    });
    btn.addEventListener('click', () => {
      const tid = btn.dataset.input;
      const target = document.getElementById(tid);
      if (target) {
        target.value = btn.dataset.emoji;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        // Feedback visual rápido — flash dourado
        target.style.transition = 'background-color 0.3s';
        target.style.backgroundColor = 'rgba(212,168,67,0.2)';
        setTimeout(() => { target.style.backgroundColor = ''; }, 350);
      }
    });
  });
}
