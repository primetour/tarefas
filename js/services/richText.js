/**
 * v4.63.40+ — Markdown leve pro Portal de Dicas.
 *
 * Sintaxe suportada (mínimo viável que cobre os 5 casos pedidos pelo Renê):
 *   **negrito**          → bold
 *   _itálico_            → italic
 *   __sublinhado__       → underline
 *   [texto](url)         → link externo
 *   [texto](#seg-bairros) → âncora interna (v4.63.41 — segmentos da própria dica)
 *
 * Por que markdown e não contenteditable+HTML:
 *   - Schema continua plain string (sem migração)
 *   - Sem necessidade de sanitize HTML (zero XSS surface)
 *   - Funciona com <textarea> existente
 *   - Toolbar é só insert tokens em selection — sem execCommand quirks
 *   - Parser determinístico, fácil de re-implementar em outros formatos
 *
 * Não suportado (propositalmente):
 *   - Listas (não fazem sentido nos campos curtos da dica)
 *   - Headings (segmentos já têm hierarquia própria)
 *   - Imagens inline (image picker é apartado)
 *   - HTML literal (escapamos sempre)
 */

const _esc = (s) =>
  String(s || '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );

/**
 * Parseia string com markdown leve em array de segmentos.
 * Cada segmento tem { text, bold?, italic?, underline?, link?, anchor? }.
 *
 * Algoritmo: lookahead simples por token. Tokens não-emparelhados ficam como
 * texto literal. Aninhamento limitado — `**_combo_**` funciona, mas
 * `**_**_` não.
 */
export function parseRich(input) {
  if (!input) return [];
  const s = String(input);
  const out = [];
  let i = 0;
  const len = s.length;

  const pushText = (txt, fmt = {}) => {
    if (!txt) return;
    out.push({ text: txt, ...fmt });
  };

  // Tokens: '**' bold, '__' underline, '_' italic, '[' link
  while (i < len) {
    // Link: [texto](url) ou [texto](#anchor)
    if (s[i] === '[') {
      const closeBracket = s.indexOf(']', i + 1);
      if (closeBracket !== -1 && s[closeBracket + 1] === '(') {
        const closeParen = s.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const linkText = s.slice(i + 1, closeBracket);
          const url = s.slice(closeBracket + 2, closeParen).trim();
          if (linkText && url) {
            // Recursivo: o linkText pode ter bold/italic
            const inner = parseRich(linkText);
            const isAnchor = url.startsWith('#');
            inner.forEach((seg) => {
              pushText(seg.text, {
                ...seg,
                ...(isAnchor ? { anchor: url.slice(1) } : { link: url }),
              });
            });
            i = closeParen + 1;
            continue;
          }
        }
      }
    }

    // Bold **
    if (s[i] === '*' && s[i + 1] === '*') {
      const end = s.indexOf('**', i + 2);
      if (end !== -1) {
        const inner = parseRich(s.slice(i + 2, end));
        inner.forEach((seg) => pushText(seg.text, { ...seg, bold: true }));
        i = end + 2;
        continue;
      }
    }

    // Underline __
    if (s[i] === '_' && s[i + 1] === '_') {
      const end = s.indexOf('__', i + 2);
      if (end !== -1) {
        const inner = parseRich(s.slice(i + 2, end));
        inner.forEach((seg) => pushText(seg.text, { ...seg, underline: true }));
        i = end + 2;
        continue;
      }
    }

    // Italic _ (mas não __)
    if (s[i] === '_' && s[i + 1] !== '_') {
      // Não case se o anterior também é _
      const end = s.indexOf('_', i + 1);
      if (end !== -1 && s[end + 1] !== '_' && s[end - 1] !== '_') {
        const inner = parseRich(s.slice(i + 1, end));
        inner.forEach((seg) => pushText(seg.text, { ...seg, italic: true }));
        i = end + 1;
        continue;
      }
    }

    // Texto literal — acumula até próximo token
    let j = i;
    while (j < len) {
      const c = s[j];
      const c2 = s[j + 1];
      if (c === '[') break;
      if (c === '*' && c2 === '*') break;
      if (c === '_') break;
      j++;
    }
    if (j > i) {
      pushText(s.slice(i, j));
      i = j;
    } else {
      // Token solto (ex: * isolado) — emite como texto
      pushText(s[i]);
      i++;
    }
  }

  return out;
}

/**
 * Renderiza markdown → HTML safe (escaped). Pra Web link + template HTML.
 * Link externo abre em nova aba. Âncora interna usa #seg-{key}.
 */
export function richToHtml(input) {
  const segs = parseRich(input);
  return segs
    .map((s) => {
      let html = _esc(s.text);
      if (s.bold) html = `<strong>${html}</strong>`;
      if (s.italic) html = `<em>${html}</em>`;
      if (s.underline) html = `<u>${html}</u>`;
      if (s.link) {
        // v4.63.42+ HIGH H3: bloquear protocolos perigosos
        const protoOk = /^https?:\/\//i.test(s.link);
        const safeUrl = protoOk ? s.link : `https://${String(s.link).replace(/^[a-z]+:/i, '')}`;
        if (/^(javascript|data|vbscript):/i.test(safeUrl.replace(/^https?:\/\//i, ''))) {
          html = _esc(s.text);  // strip link, mantém texto
        } else {
          html = `<a href="${_esc(safeUrl)}" target="_blank" rel="noopener noreferrer">${html}</a>`;
        }
      } else if (s.anchor) {
        // Âncora interna: scroll suave pro segmento
        html = `<a href="#seg-${_esc(s.anchor)}" data-internal-link="1">${html}</a>`;
      }
      return html;
    })
    .join('');
}

/**
 * Renderiza markdown → texto plano. Pra PDF que cai no fallback antigo
 * E pra previews curtas. Strip tudo mas preserva texto.
 */
export function richToPlain(input) {
  return parseRich(input)
    .map((s) => s.text)
    .join('');
}

/**
 * Helper UI: insere/wrappa selection do textarea com tokens markdown.
 * Aceita el (textarea ou input) + token wrap ('**', '_', '__', ou objeto
 * { open, close } pra link).
 *
 * Se houver seleção: envolve com tokens.
 * Se não: insere tokens vazios + posiciona cursor entre eles.
 */
export function wrapSelection(el, token) {
  if (!el || (el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT')) return;
  const open = typeof token === 'string' ? token : token.open;
  const close = typeof token === 'string' ? token : token.close;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const before = el.value.slice(0, start);
  const selected = el.value.slice(start, end);
  const after = el.value.slice(end);
  el.value = `${before}${open}${selected}${close}${after}`;
  const newCursor = selected ? start + open.length + selected.length + close.length
                              : start + open.length;
  el.focus();
  el.setSelectionRange(newCursor, newCursor);
  // dispatch input event pra autosave/dirty marker
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Detecta se texto provavelmente contém markdown. Usado em renderers pra
 * decidir entre fast-path (plain text antigo) e parseRich (overhead).
 */
export function hasMarkdown(input) {
  if (!input) return false;
  const s = String(input);
  return /\*\*|__|_[^_]|\[[^\]]+\]\(/.test(s);
}
