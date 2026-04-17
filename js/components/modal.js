/**
 * PRIMETOUR — Modal System
 * Gerenciamento de modais (dialogs)
 */

class ModalManager {
  constructor() {
    this.stack   = [];
    this.counter = 0;
  }

  _getContainer() {
    let c = document.getElementById('modal-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'modal-container';
      document.body.appendChild(c);
    }
    return c;
  }

  /**
   * Abre um modal genérico
   * @param {Object} options
   * @param {string} options.title       - Título do modal
   * @param {string} options.content     - HTML do corpo
   * @param {string} options.size        - 'sm' | '' | 'lg' | 'xl'
   * @param {Array}  options.footer      - Array de botões { label, class, onClick, closeOnClick }
   * @param {Function} options.onClose     - Callback ao fechar
   * @param {boolean} options.closeOnBackdrop - Fecha ao clicar fora? (default: false)
   * @param {boolean} options.closeOnEsc     - Fecha ao pressionar ESC? (default: false)
   * @param {boolean} options.closeable    - (DEPRECATED) alias que ativa backdrop+ESC.
   *                                         Mantido pra compat com chamadas antigas.
   */
  open({ title, content, size = '', footer = [], onClose,
         closeable, closeOnBackdrop, closeOnEsc } = {}) {
    // Defaults restritivos: só o X fecha. Quem quiser permissivo opta explicitamente.
    // Se a chamada antiga passar `closeable`, replica para os dois novos flags.
    if (typeof closeOnBackdrop === 'undefined') closeOnBackdrop = closeable === true;
    if (typeof closeOnEsc      === 'undefined') closeOnEsc      = closeable === true;

    const id = ++this.counter;
    const container = this._getContainer();

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.setAttribute('data-modal-id', id);

    const footerHTML = footer.length ? `
      <div class="modal-footer">
        ${footer.map((btn, i) => `
          <button class="btn ${btn.class || 'btn-secondary'}" data-btn-index="${i}">
            ${btn.label}
          </button>
        `).join('')}
      </div>
    ` : '';

    backdrop.innerHTML = `
      <div class="modal ${size ? 'modal-' + size : ''}">
        <div class="modal-header">
          <h3 class="modal-title">${title}</h3>
          <button class="modal-close" aria-label="Fechar">✕</button>
        </div>
        <div class="modal-body">${content}</div>
        ${footerHTML}
      </div>
    `;

    const close = () => this.close(id);

    // Fechar ao clicar no backdrop (opt-in)
    if (closeOnBackdrop) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) close();
      });
    }

    // Fechar botão X (sempre)
    backdrop.querySelector('.modal-close').addEventListener('click', close);

    // Footer buttons
    footer.forEach((btn, i) => {
      const btnEl = backdrop.querySelector(`[data-btn-index="${i}"]`);
      if (btnEl) {
        btnEl.addEventListener('click', (e) => {
          if (btn.onClick) btn.onClick(e, { close, modalId: id });
          if (btn.closeOnClick !== false) close();
        });
      }
    });

    // ESC para fechar (opt-in)
    const handleKeydown = (e) => {
      if (e.key === 'Escape' && closeOnEsc) close();
    };
    document.addEventListener('keydown', handleKeydown);

    container.appendChild(backdrop);
    this.stack.push({ id, backdrop, onClose, handleKeydown });
    document.body.style.overflow = 'hidden';

    return {
      id,
      close,
      getBody: () => backdrop.querySelector('.modal-body'),
      getElement: () => backdrop,
    };
  }

  close(id) {
    const idx = this.stack.findIndex(m => m.id === id);
    if (idx === -1) return;

    const { backdrop, onClose, handleKeydown } = this.stack[idx];
    document.removeEventListener('keydown', handleKeydown);

    backdrop.style.opacity = '0';
    setTimeout(() => {
      backdrop.remove();
      this.stack.splice(idx, 1);
      if (this.stack.length === 0) {
        document.body.style.overflow = '';
      }
      if (onClose) onClose();
    }, 200);
  }

  closeAll() {
    [...this.stack].reverse().forEach(m => this.close(m.id));
  }

  /**
   * Dialog de confirmação
   */
  confirm({
    title       = 'Confirmar ação',
    message     = 'Tem certeza que deseja continuar?',
    confirmText = 'Confirmar',
    cancelText  = 'Cancelar',
    danger      = false,
    icon        = '⚠️',
  } = {}) {
    return new Promise((resolve) => {
      let confirmed = false;

      this.open({
        title,
        size: 'sm',
        closeOnEsc: true,  // confirm: ESC = cancelar (expectativa padrão)
        content: `
          <div class="confirm-dialog">
            <div class="confirm-icon">${icon}</div>
            <p class="confirm-message">${message}</p>
          </div>
        `,
        footer: [
          {
            label: cancelText,
            class: 'btn-secondary',
            onClick: () => { confirmed = false; },
          },
          {
            label: confirmText,
            class: danger ? 'btn-danger' : 'btn-primary',
            onClick: () => { confirmed = true; },
          },
        ],
        onClose: () => resolve(confirmed),
      });
    });
  }

  /**
   * Modal de alerta simples
   */
  alert({ title = 'Aviso', message, icon = 'ℹ️' } = {}) {
    return new Promise((resolve) => {
      this.open({
        title,
        size: 'sm',
        closeOnEsc: true,  // alert: ESC fecha (dialog simples)
        content: `
          <div class="confirm-dialog">
            <div class="confirm-icon">${icon}</div>
            <p class="confirm-message">${message}</p>
          </div>
        `,
        footer: [
          { label: 'OK', class: 'btn-primary' },
        ],
        onClose: resolve,
      });
    });
  }
}

export const modal = new ModalManager();
export default modal;
