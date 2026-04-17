/**
 * pdfKit.js — padrão visual de PDFs da PRIMETOUR
 *
 * Motivação: PDF não é cópia de XLS. É peça de apresentação com apelo visual.
 * Este módulo concentra paleta, helpers e sanitizadores para que todos os
 * exportadores compartilhem linguagem visual consistente.
 *
 * Nota sobre glyphs: jsPDF com Helvetica usa WinAnsi (CP1252) por padrão.
 * Caracteres UTF-8 como →, ▸, ↳, ✓, aspas curvas, reticências viram lixo.
 * O helper `txt()` sanitiza tudo que sai em `doc.text()`. Marcadores
 * decorativos devem ser desenhados com primitivas (circle/rect/line),
 * nunca com glyphs Unicode.
 */

/* ── Paleta oficial ─────────────────────────────────────────── */
export const COL = {
  brand:   [36,  35, 98],   // azul-marinho PRIMETOUR
  brand2:  [82,  79, 180],  // roxo apoio
  brandL:  [238, 238, 250], // tint brand (fundo card)
  gold:    [212, 168, 67],  // dourado logo
  goldL:   [253, 246, 229], // tint gold
  text:    [26,  26,  40],  // corpo de texto
  muted:   [120, 120, 135], // secundário
  soft:    [160, 160, 175], // terciário
  bg:      [248, 247, 244], // fundo geral
  subBg:   [252, 251, 248], // fundo alternado
  track:   [230, 230, 240], // trilho de barra
  border:  [222, 220, 230], // divisória sutil
  green:   [22,  163, 74],
  orange:  [217, 119, 6],
  red:     [220, 38,  38],
  blue:    [37,  99,  235],
  white:   [255, 255, 255],
};

/* ── Status comuns (tarefas, metas, projetos) ───────────────── */
export const STATUS_STYLE = {
  // Metas
  ativa:        { bg: COL.green,  label: 'ATIVA' },
  publicada:    { bg: COL.green,  label: 'PUBLICADA' },
  rascunho:     { bg: COL.orange, label: 'RASCUNHO' },
  concluida:    { bg: COL.blue,   label: 'CONCLUIDA' },
  'concluída':  { bg: COL.blue,   label: 'CONCLUIDA' },
  cancelada:    { bg: COL.red,    label: 'CANCELADA' },
  encerrada:    { bg: COL.muted,  label: 'ENCERRADA' },
  // Tarefas
  not_started: { bg: COL.muted,  label: 'NAO INICIADA' },
  in_progress: { bg: COL.blue,   label: 'EM ANDAMENTO' },
  paused:      { bg: COL.orange, label: 'PAUSADA' },
  done:        { bg: COL.green,  label: 'CONCLUIDA' },
  cancelled:   { bg: COL.red,    label: 'CANCELADA' },
  blocked:     { bg: COL.red,    label: 'BLOQUEADA' },
};

/* ── Sanitização Unicode → CP1252-safe ──────────────────────── */
export const txt = (s) => String(s ?? '')
  .replace(/→/g, ' a ')
  .replace(/←/g, '<-')
  .replace(/↳/g, '>')
  .replace(/▸/g, '>')
  .replace(/▪/g, '-')
  .replace(/●/g, '.')
  .replace(/○/g, 'o')
  .replace(/✓/g, '')
  .replace(/✗/g, 'x')
  .replace(/…/g, '...')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/[\u2022\u25CF]/g, '.');

/* ── Util: carrega jsPDF sob demanda ────────────────────────── */
export async function loadJsPdf() {
  if (window.jspdf) return window.jspdf;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  return window.jspdf;
}

/* ── Factory que decora o doc com helpers de estilo ─────────── */
/**
 * Cria uma "prancheta" de pintura. Retorna um objeto com:
 *   doc        — o jsPDF
 *   W, H, M    — largura, altura, margem (mm)
 *   CW         — largura de conteúdo (W - 2M)
 *   setFill/setText/setDraw — atalhos de cor
 *   drawBar(x, y, wMax, pct, col, h)
 *   drawChip(label, x, y, bg, fg, fs, padX, padY)  → { w, h }
 *   drawKV(k, v, x, labelW, indent, fs)
 *   wrap(text, maxW, fs)
 *   ensureSpace(needed, onNewPage)
 *   drawCover(opts) — capa brand-gold compacta
 *   drawPageHeader(title) — mini-header nas páginas 2+
 *   drawFooter()   — paginação + assinatura
 *   getY / setY / addY — acessores do cursor vertical
 */
export function createDoc({ orientation = 'portrait', margin = 14 } = {}) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const W = orientation === 'portrait' ? 210 : 297;
  const H = orientation === 'portrait' ? 297 : 210;
  const M = margin;
  const CW = W - M * 2;

  let y = M;

  const setFill = (c) => doc.setFillColor(...c);
  const setText = (c) => doc.setTextColor(...c);
  const setDraw = (c) => doc.setDrawColor(...c);

  const wrap = (s, maxW, fs) => {
    doc.setFontSize(fs);
    return doc.splitTextToSize(txt(s), maxW);
  };

  const drawBar = (x, yy, wMax, pct, fillCol = COL.brand2, h = 1.6) => {
    setFill(COL.track); doc.rect(x, yy, wMax, h, 'F');
    const p = Math.min(Math.max(Number(pct) || 0, 0), 100);
    if (p > 0) {
      setFill(fillCol);
      doc.rect(x, yy, wMax * p / 100, h, 'F');
    }
  };

  const drawChip = (label, x, yy, bg, fg = COL.white, fs = 7, padX = 3, padY = 1.6) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(fs);
    const lbl = txt(label);
    const w = doc.getTextWidth(lbl) + padX * 2;
    const h = fs * 0.55 + padY * 2;
    setFill(bg); doc.roundedRect(x, yy, w, h, 1.2, 1.2, 'F');
    setText(fg); doc.text(lbl, x + padX, yy + h - padY - 0.4);
    return { w, h };
  };

  const drawKV = (k, v, xStart = M, labelW = 32, indent = 0, fs = 8.5) => {
    if (v === '' || v == null) return;
    const lines = wrap(v, CW - labelW - indent - 2, fs);
    ensureSpace(lines.length * 3.8 + 1);
    doc.setFont('helvetica', 'bold'); setText(COL.muted); doc.setFontSize(fs - 1.5);
    doc.text(txt(k.toUpperCase()), xStart + indent, y);
    doc.setFont('helvetica', 'normal'); setText(COL.text); doc.setFontSize(fs);
    doc.text(lines, xStart + indent + labelW, y);
    y += Math.max(4, lines.length * 3.8);
  };

  const drawPageHeader = (title = 'PRIMETOUR') => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); setText(COL.muted);
    doc.text(txt(title), M, 9);
    setDraw(COL.border); doc.setLineWidth(0.15);
    doc.line(M, 11, W - M, 11);
    y = 17;
  };

  const ensureSpace = (needed, onNewPage) => {
    if (y + needed > H - 14) {
      doc.addPage();
      if (typeof onNewPage === 'function') onNewPage();
      else drawPageHeader();
    }
  };

  /**
   * Capa compacta. Para relatórios com 1 item só, usa `compact: true`
   * (banner 28mm no topo e conteúdo entra logo abaixo). Para multi-item,
   * banner 46mm ocupa topo da pg.1 com título grande.
   */
  const drawCover = ({
    title,
    subtitle = 'PRIMETOUR  ·  Gestão',
    meta = '',
    compact = false,
  } = {}) => {
    const bh = compact ? 28 : 46;
    setFill(COL.brand); doc.rect(0, 0, W, bh, 'F');
    setFill(COL.gold);  doc.rect(0, bh, W, 1.6, 'F');

    setText(COL.white);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(compact ? 15 : 20);
    doc.text(txt(title), M, compact ? 14 : 20);

    doc.setFont('helvetica', 'normal'); doc.setFontSize(compact ? 8 : 9);
    doc.text(txt(subtitle), M, compact ? 20 : 28);

    if (meta) {
      setText(COL.gold); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      doc.text(txt(meta), W - M, compact ? 14 : 20, { align: 'right' });
    }
    y = bh + 8;
  };

  const drawFooter = (label = 'PRIMETOUR') => {
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); setText(COL.muted);
      doc.text(txt(`Pagina ${i} de ${pageCount}`), W - M, H - 6, { align: 'right' });
      doc.text(txt(`${label}  ·  ${new Date().toLocaleDateString('pt-BR')}`), M, H - 6);
    }
  };

  /**
   * Cartão com barra lateral brand. Retorna a altura renderizada. Útil como
   * container de seção. Você pinta o conteúdo dentro passando uma render fn.
   */
  const drawSectionCard = (title, subtitle, renderBody) => {
    const headerH = 14;
    ensureSpace(headerH + 6);
    setFill(COL.brand); doc.rect(M, y, CW, headerH, 'F');
    setFill(COL.gold);  doc.rect(M, y, 2.5, headerH, 'F');

    setText(COL.goldL); doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
    if (subtitle) doc.text(txt(subtitle.toUpperCase()), M + 5.5, y + 5);

    setText(COL.white); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text(txt(title), M + 5.5, y + (subtitle ? 11 : 9));

    y += headerH + 4;
    if (typeof renderBody === 'function') renderBody();
  };

  return {
    doc, W, H, M, CW,
    setFill, setText, setDraw,
    wrap, drawBar, drawChip, drawKV,
    drawPageHeader, drawFooter, drawCover, drawSectionCard,
    ensureSpace,
    get y() { return y; },
    set y(v) { y = v; },
    addY(n) { y += n; },
  };
}

/* ── Guard de reentrância para exportadores ─────────────────── */
/**
 * Retorna uma função que envolve `fn` com guarda. Se chamada enquanto
 * ainda executa, retorna silenciosamente (evita duplo arquivo por
 * double-fire, duplo clique ou listener registrado 2x).
 */
export function withExportGuard(fn) {
  let busy = false;
  return async function guarded(...args) {
    if (busy) return;
    busy = true;
    try { return await fn.apply(this, args); }
    finally { busy = false; }
  };
}

/* ── Utils ──────────────────────────────────────────────────── */
export const fmtDateBR = (d) => {
  if (!d) return '';
  try {
    const dt = d?.toDate ? d.toDate() : (d instanceof Date ? d : new Date(d));
    if (isNaN(dt?.getTime?.())) return '';
    return dt.toLocaleDateString('pt-BR');
  } catch { return ''; }
};
