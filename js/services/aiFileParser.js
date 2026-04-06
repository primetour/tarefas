/**
 * PRIMETOUR — AI File Parser
 * Processamento client-side de arquivos anexados ao chat de IA.
 * Nenhum arquivo é enviado a servidores — parsing 100% no navegador.
 */

/* ─── Tipos suportados ────────────────────────────────────── */
export const SUPPORTED_TYPES = {
  // Documentos de texto
  'application/pdf':        { label: 'PDF',   icon: '📄', parser: 'pdf' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { label: 'DOCX', icon: '📝', parser: 'docx' },
  'text/plain':             { label: 'TXT',   icon: '📃', parser: 'text' },
  'text/markdown':          { label: 'MD',    icon: '📃', parser: 'text' },
  'application/json':       { label: 'JSON',  icon: '{ }', parser: 'json' },

  // Planilhas
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { label: 'XLSX', icon: '📊', parser: 'excel' },
  'application/vnd.ms-excel': { label: 'XLS', icon: '📊', parser: 'excel' },
  'text/csv':               { label: 'CSV',   icon: '📊', parser: 'csv' },

  // Imagens (descrição via visão ou OCR simples)
  'image/png':              { label: 'PNG',   icon: '🖼', parser: 'image' },
  'image/jpeg':             { label: 'JPEG',  icon: '🖼', parser: 'image' },
  'image/webp':             { label: 'WebP',  icon: '🖼', parser: 'image' },
};

/* ─── Limites ─────────────────────────────────────────────── */
const MAX_FILE_SIZE   = 10 * 1024 * 1024; // 10 MB
const MAX_FILES       = 5;
const MAX_TEXT_CHARS   = 15000; // limitar texto extraído p/ não estourar contexto
const MAX_EXCEL_ROWS   = 200;

/* ─── Extensão → MIME fallback ───────────────────────────── */
const EXT_MAP = {
  '.pdf':  'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc':  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls':  'application/vnd.ms-excel',
  '.csv':  'text/csv',
  '.txt':  'text/plain',
  '.md':   'text/markdown',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/* ─── Validar arquivo ────────────────────────────────────── */
export function validateFile(file) {
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Máximo: ${MAX_FILE_SIZE / 1024 / 1024} MB.` };
  }
  const mime = resolveType(file);
  if (!SUPPORTED_TYPES[mime]) {
    const ext = file.name.split('.').pop()?.toLowerCase();
    return { valid: false, error: `Tipo de arquivo não suportado (.${ext}). Suportados: PDF, DOCX, XLSX, CSV, TXT, JSON, imagens.` };
  }
  return { valid: true, mime, meta: SUPPORTED_TYPES[mime] };
}

function resolveType(file) {
  if (file.type && SUPPORTED_TYPES[file.type]) return file.type;
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  return EXT_MAP[ext] || file.type;
}

/* ─── Carregar CDNs sob demanda ──────────────────────────── */
const CDN_CACHE = {};

async function loadCDN(name, url, globalName) {
  if (CDN_CACHE[name]) return CDN_CACHE[name];
  if (window[globalName]) { CDN_CACHE[name] = window[globalName]; return CDN_CACHE[name]; }

  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => {
      CDN_CACHE[name] = window[globalName];
      resolve(CDN_CACHE[name]);
    };
    s.onerror = () => reject(new Error(`Falha ao carregar ${name}`));
    document.head.appendChild(s);
  });
}

async function loadPdfJs() {
  const lib = await loadCDN('pdfjs', 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'pdfjsLib');
  lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  return lib;
}

async function loadSheetJS() {
  return loadCDN('xlsx', 'https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js', 'XLSX');
}

async function loadMammoth() {
  return loadCDN('mammoth', 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js', 'mammoth');
}

/* ─── Parsers por tipo ───────────────────────────────────── */

async function parsePdf(file) {
  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = pdf.numPages;
  let text = '';

  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    text += `\n--- Página ${i} ---\n${pageText}`;
    if (text.length > MAX_TEXT_CHARS) {
      text = text.substring(0, MAX_TEXT_CHARS) + '\n[... texto truncado ...]';
      break;
    }
  }

  return {
    type: 'text',
    content: text.trim(),
    meta: { pages, chars: text.length },
    summary: `PDF com ${pages} página(s), ${text.length.toLocaleString()} caracteres extraídos.`,
  };
}

async function parseDocx(file) {
  const mammoth = await loadMammoth();
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  let text = result.value || '';

  if (text.length > MAX_TEXT_CHARS) {
    text = text.substring(0, MAX_TEXT_CHARS) + '\n[... texto truncado ...]';
  }

  return {
    type: 'text',
    content: text.trim(),
    meta: { chars: text.length },
    summary: `DOCX com ${text.length.toLocaleString()} caracteres extraídos.`,
  };
}

async function parseText(file) {
  let text = await file.text();
  if (text.length > MAX_TEXT_CHARS) {
    text = text.substring(0, MAX_TEXT_CHARS) + '\n[... texto truncado ...]';
  }
  return {
    type: 'text',
    content: text,
    meta: { chars: text.length },
    summary: `Texto com ${text.length.toLocaleString()} caracteres.`,
  };
}

async function parseJson(file) {
  const raw = await file.text();
  try {
    const obj = JSON.parse(raw);
    const pretty = JSON.stringify(obj, null, 2);
    const content = pretty.length > MAX_TEXT_CHARS
      ? pretty.substring(0, MAX_TEXT_CHARS) + '\n[... truncado ...]'
      : pretty;
    return {
      type: 'structured',
      content,
      meta: { keys: Array.isArray(obj) ? `Array[${obj.length}]` : Object.keys(obj).join(', ') },
      summary: `JSON: ${Array.isArray(obj) ? `array com ${obj.length} itens` : `objeto com ${Object.keys(obj).length} chaves`}.`,
    };
  } catch {
    return parseText(file);
  }
}

async function parseExcel(file) {
  const XLSX = await loadSheetJS();
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheets = workbook.SheetNames;
  let content = '';
  let totalRows = 0;

  for (const sheetName of sheets) {
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const rows = json.slice(0, MAX_EXCEL_ROWS);
    totalRows += json.length;

    if (rows.length === 0) continue;

    content += `\n=== Planilha: ${sheetName} (${json.length} linhas) ===\n`;
    content += `Colunas: ${Object.keys(rows[0]).join(', ')}\n\n`;

    // Formato tabular legível
    for (let i = 0; i < rows.length; i++) {
      content += `Linha ${i + 1}: ${JSON.stringify(rows[i])}\n`;
      if (content.length > MAX_TEXT_CHARS) {
        content += `[... truncado em ${i + 1} de ${json.length} linhas ...]\n`;
        break;
      }
    }
  }

  return {
    type: 'tabular',
    content: content.trim(),
    meta: { sheets: sheets.length, totalRows, sheetNames: sheets },
    summary: `Excel: ${sheets.length} aba(s), ${totalRows} linha(s) total.`,
  };
}

async function parseCsv(file) {
  const text = await file.text();
  const lines = text.split('\n').filter(l => l.trim());
  const header = lines[0] || '';
  const dataLines = lines.slice(1, MAX_EXCEL_ROWS + 1);

  let content = `Colunas: ${header}\n\n`;
  dataLines.forEach((line, i) => {
    content += `Linha ${i + 1}: ${line}\n`;
  });
  if (lines.length > MAX_EXCEL_ROWS + 1) {
    content += `[... truncado: ${lines.length - 1} linhas total ...]\n`;
  }

  if (content.length > MAX_TEXT_CHARS) {
    content = content.substring(0, MAX_TEXT_CHARS) + '\n[... truncado ...]';
  }

  return {
    type: 'tabular',
    content: content.trim(),
    meta: { rows: lines.length - 1, columns: header.split(',').length },
    summary: `CSV: ${lines.length - 1} linha(s), ${header.split(',').length} coluna(s).`,
  };
}

async function parseImage(file) {
  // Converter para base64 comprimido (max 512px para contexto)
  const base64 = await new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 512;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida')); };
    img.src = url;
  });

  return {
    type: 'image',
    content: `[Imagem anexada: ${file.name}, ${(file.size / 1024).toFixed(0)} KB]`,
    base64,
    meta: { size: file.size, name: file.name },
    summary: `Imagem: ${file.name} (${(file.size / 1024).toFixed(0)} KB).`,
  };
}

/* ─── Parser principal ───────────────────────────────────── */

const PARSERS = {
  pdf:   parsePdf,
  docx:  parseDocx,
  text:  parseText,
  json:  parseJson,
  excel: parseExcel,
  csv:   parseCsv,
  image: parseImage,
};

/**
 * Parse um arquivo e extrair conteúdo como texto.
 * @param {File} file
 * @returns {Promise<{type, content, base64?, meta, summary, fileName, fileSize}>}
 */
export async function parseFile(file) {
  const { valid, error, mime, meta } = validateFile(file);
  if (!valid) throw new Error(error);

  const parser = PARSERS[meta.parser];
  if (!parser) throw new Error(`Parser não implementado para ${meta.label}`);

  const result = await parser(file);
  return {
    ...result,
    fileName: file.name,
    fileSize: file.size,
    fileType: meta.label,
    fileIcon: meta.icon,
  };
}

/**
 * Parse múltiplos arquivos.
 * @param {FileList|File[]} files
 * @returns {Promise<Array>}
 */
export async function parseFiles(files) {
  const fileArray = Array.from(files).slice(0, MAX_FILES);
  const results = [];

  for (const file of fileArray) {
    try {
      const parsed = await parseFile(file);
      results.push(parsed);
    } catch (e) {
      results.push({
        type: 'error',
        content: '',
        fileName: file.name,
        fileSize: file.size,
        fileIcon: '⚠',
        fileType: 'Erro',
        summary: e.message,
        error: e.message,
      });
    }
  }

  return results;
}

/**
 * Formatar anexos como bloco de contexto para o prompt da IA.
 * @param {Array} parsedFiles — resultado de parseFiles()
 * @returns {string}
 */
export function formatFilesForPrompt(parsedFiles) {
  if (!parsedFiles?.length) return '';

  let block = '\n=== ARQUIVOS ANEXADOS ===\n';

  for (const f of parsedFiles) {
    if (f.error) {
      block += `\n[Erro ao ler ${f.fileName}: ${f.error}]\n`;
      continue;
    }
    block += `\n--- Arquivo: ${f.fileName} (${f.fileType}, ${(f.fileSize / 1024).toFixed(0)} KB) ---\n`;
    if (f.type === 'image') {
      block += `[Imagem anexada. Use os dados visuais se o modelo suportar visão, ou descreva com base no nome do arquivo.]\n`;
    } else {
      block += f.content + '\n';
    }
  }

  block += '\n=== FIM DOS ARQUIVOS ===\n';
  block += 'INSTRUÇÕES SOBRE ANEXOS: O usuário anexou arquivo(s). Analise o conteúdo e responda conforme solicitado. ';
  block += 'Se o usuário pedir para criar tarefas, solicitações ou outros registros a partir dos dados, gere os blocos <<<ACTION>>> correspondentes. ';
  block += 'Se for tabular (Excel/CSV), identifique colunas e linhas relevantes.\n';

  return block;
}

/**
 * Verificar se o accept string para o input file.
 */
export function getAcceptString() {
  return Object.keys(EXT_MAP).join(',');
}

export { MAX_FILES, MAX_FILE_SIZE };
