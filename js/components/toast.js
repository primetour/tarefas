/**
 * PRIMETOUR — Toast Notifications
 * Sistema de notificações toast
 *
 * 4.20+ — Ícones agora vêm do `icons.js` (single source of truth).
 * Antes eram glifos Unicode (✓✕⚠ℹ) que renderizavam fininhos e diferente
 * em cada OS. Agora são SVGs alinhados com sidebar/header.
 */

import { renderIcon } from './icons.js';

const ICON_KEYS = {
  success: 'check-circle',
  error:   'x-circle',
  warning: 'alert-triangle',
  info:    'info-circle',
};
const CLOSE_ICON = 'x';

const TITLES = {
  success: 'Sucesso',
  error:   'Erro',
  warning: 'Atenção',
  info:    'Informação',
};

const DURATION = {
  success: 3500,
  error:   5000,
  warning: 4500,
  info:    4000,
};

class ToastManager {
  constructor() {
    this.container = null;
    this.toasts    = new Map();
    this.counter   = 0;
  }

  _getContainer() {
    if (!this.container) {
      this.container = document.getElementById('toast-container');
      if (!this.container) {
        this.container = document.createElement('div');
        this.container.id = 'toast-container';
        document.body.appendChild(this.container);
      }
    }
    return this.container;
  }

  show(type, message, title = null, duration = null) {
    const id = ++this.counter;
    const container = this._getContainer();
    const ms = duration ?? DURATION[type] ?? 4000;

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', 'alert');
    el.innerHTML = `
      <div class="toast-icon">${renderIcon(ICON_KEYS[type] || 'info-circle', { size: 20 })}</div>
      <div class="toast-content">
        <div class="toast-title">${title || TITLES[type]}</div>
        ${message ? `<div class="toast-message">${message}</div>` : ''}
      </div>
      <button class="toast-close" aria-label="Fechar">${renderIcon(CLOSE_ICON, { size: 14 })}</button>
    `;

    el.querySelector('.toast-close').addEventListener('click', () => this.remove(id));
    container.appendChild(el);
    this.toasts.set(id, el);

    // Auto remove
    setTimeout(() => this.remove(id), ms);
    return id;
  }

  remove(id) {
    const el = this.toasts.get(id);
    if (!el) return;
    el.classList.add('removing');
    setTimeout(() => {
      el.remove();
      this.toasts.delete(id);
    }, 300);
  }

  // v4.63.21+ Fix H2 (audit pós-sprint): aceitar duration (4º arg).
  // Antes ignorava 3º arg silenciosamente → progress toast (90_000ms) sumia
  // em 4s e o `update` posterior virava no-op porque _progressId stale.
  success(message, title, duration)  { return this.show('success', message, title, duration); }
  error(message, title, duration)    { return this.show('error',   message, title, duration); }
  warning(message, title, duration)  { return this.show('warning', message, title, duration); }
  info(message, title, duration)     { return this.show('info',    message, title, duration); }

  /**
   * v4.63.14+ Atualiza mensagem de toast existente sem recriar — usado em
   * progress steps de operações longas (ex: gerar PDF via template ~10s).
   * Padrão Renê CLAUDE.md §11.b: feedback dinâmico em vez de "Gerando…"
   * estático que parece travado.
   */
  update(id, message, title = null) {
    const el = this.toasts.get(id);
    if (!el) return false;
    const msgNode = el.querySelector('.toast-message');
    if (msgNode) msgNode.textContent = message;
    if (title) {
      const titleNode = el.querySelector('.toast-title');
      if (titleNode) titleNode.textContent = title;
    }
    return true;
  }
}

export const toast = new ToastManager();
export default toast;
