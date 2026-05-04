/**
 * PRIMETOUR — HTML Escape Utility
 *
 * Funções de sanitização pra prevenir XSS em innerHTML.
 *
 * USO:
 *   import { escHtml, escAttr } from '../util/escape.js';
 *   container.innerHTML = `<div title="${escAttr(user.name)}">${escHtml(user.bio)}</div>`;
 *
 * MOTIVAÇÃO: o codebase tem ~770 usos de innerHTML. Sem sanitização
 * consistente, qualquer campo de usuário (nome, descrição, comentário)
 * pode injetar `<img src=x onerror=...>` e roubar tokens. Em todas as
 * páginas que usam innerHTML, ENVOLVER strings de usuário com escHtml.
 *
 * ANTIPADRÃO HISTÓRICO: cada arquivo definia sua própria função `esc`
 * idêntica (~10 cópias). Isso aqui é a fonte única.
 *
 * EXCEÇÃO: campos COMPROVADAMENTE safe (já vieram do servidor sanitizados,
 * tipos numéricos, IDs internos) podem dispensar — mas SEMPRE validar.
 */

/**
 * Escapa caracteres HTML perigosos pra uso em innerHTML body.
 * Cobre: & < > " '
 *
 * @param {*} s - valor a sanitizar (será coerced pra string)
 * @returns {string} string segura pra interpolar em innerHTML
 */
export function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

/**
 * Alias semântico — usar em valores de atributo HTML.
 * Mesmo escape mas deixa claro a intenção:
 *   <div title="${escAttr(name)}">  ← escAttr
 *   <div>${escHtml(bio)}</div>      ← escHtml
 *
 * Tecnicamente faz o mesmo, mas separar ajuda na leitura/auditoria.
 */
export const escAttr = escHtml;

/**
 * Sanitiza URL pra src/href. Bloqueia javascript: e data: (exceto data:image/).
 *
 * @param {string} url
 * @returns {string} URL safe (ou '#' se bloqueada)
 */
export function safeUrl(url) {
  if (!url) return '#';
  const s = String(url).trim();
  // Bloqueia javascript:, vbscript:, etc.
  if (/^(javascript|vbscript|data:(?!image\/))/i.test(s)) {
    return '#';
  }
  return s;
}

// Default export pra import sem destructure
export default { escHtml, escAttr, safeUrl };
