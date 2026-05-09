/**
 * PRIMETOUR — Dev Hours PDF Export (4.3.0)
 *
 * Gera PDF do histórico de horas de desenvolvimento usando pdfKit padrão.
 * Estrutura:
 *   - Capa brand-gold com totais
 *   - Disclaimer ético
 *   - Tabela paginada de entradas (data, tipo, versão/fase, horas, custo)
 *   - Resumo por categoria (barras horizontais)
 *   - Footer com paginação
 *
 * Filtra apenas entradas APROVADAS (mesma regra do link público).
 *
 * Usa: js/components/pdfKit.js (createDoc, loadJsPdf, withExportGuard, txt, COL)
 */

import { loadJsPdf, createDoc, withExportGuard, txt, COL } from '../components/pdfKit.js';
import { CATEGORIES, sumEntries } from './devHours.js';

const fmtBR = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
// 4.35.1+ Formato HH:MM (ex: "6h 40min") em vez de decimal "6.67h"
const fmtH = (n) => {
  const total = +n || 0;
  const h = Math.floor(total);
  let m = Math.round((total - h) * 60);
  if (m === 60) return `${h + 1}h`;
  if (h === 0 && m === 0) return '0min';
  if (h === 0)            return `${m}min`;
  if (m === 0)            return `${h}h`;
  return `${h}h ${m}min`;
};
const fmtDate = (ts) => {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('pt-BR');
};

// Cores das categorias mapeadas para tuplas RGB compatíveis com pdfKit
const CAT_COLORS = {
  refinamento:     [139, 92, 246],
  desenvolvimento: [59, 130, 246],
  testes:          [16, 185, 129],
  documentacao:    [245, 158, 11],
  implantacao:     [239, 68, 68],
};

/**
 * @param {Array} entries — entradas filtradas (já filtradas por status='approved' externamente)
 * @param {Object} opts   — { periodLabel, fileSuffix }
 */
export const exportDevHoursPdf = withExportGuard(async function exportDevHoursPdf(entries, opts = {}) {
  await loadJsPdf();
  const D = createDoc({ orientation: 'portrait', margin: 14 });
  const { doc, W, M, CW, setFill, setText, setDraw, wrap, ensureSpace } = D;

  const totals = sumEntries(entries);
  const periodLabel = opts.periodLabel || 'Histórico completo';
  const phaseCount   = entries.filter(e => e.entryType === 'phase').length;
  const releaseCount = entries.filter(e => e.entryType === 'release').length;

  /* ── Capa ──────────────────────────────────────────────── */
  D.drawCover({
    title: 'Horas de Desenvolvimento',
    subtitle: 'PRIMETOUR  ·  Sistema de Gestão de Tarefas',
    meta: new Date().toLocaleDateString('pt-BR'),
  });

  // Linha de meta abaixo da capa
  setText(COL.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(txt(`Período: ${periodLabel}  ·  ${entries.length} entrada${entries.length !== 1 ? 's' : ''} aprovada${entries.length !== 1 ? 's' : ''}`), M, D.y);
  D.addY(8);

  /* ── Card de totais (4 KPIs grandes) ───────────────────── */
  const cardW = (CW - 6) / 4;
  const cardH = 24;

  const drawKpi = (i, label, value, sub, color) => {
    const x = M + i * (cardW + 2);
    setFill(COL.subBg); doc.rect(x, D.y, cardW, cardH, 'F');
    setFill(color);     doc.rect(x, D.y, cardW, 1.5, 'F');
    setText(COL.muted); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5);
    doc.text(txt(label.toUpperCase()), x + 3, D.y + 6);
    setText(COL.text); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text(txt(value), x + 3, D.y + 14);
    setText(COL.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    doc.text(txt(sub), x + 3, D.y + 20);
  };

  drawKpi(0, 'Horas trabalhadas', fmtH(totals.hours),       'no período',     COL.gold);
  drawKpi(1, 'Custo total',       fmtBR.format(totals.cost),'@ R$ 150/h',     COL.green);
  drawKpi(2, 'Releases',          String(releaseCount),     'granulares 3.x+',COL.blue);
  drawKpi(3, 'Fases',             String(phaseCount),       'agregadas 1/2.x',COL.brand2);
  D.addY(cardH + 6);

  /* ── Disclaimer ético ──────────────────────────────────── */
  setFill(COL.goldL); doc.rect(M, D.y, CW, 14, 'F');
  setFill(COL.gold);  doc.rect(M, D.y, 1.5, 14, 'F');
  setText(COL.text); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
  doc.text(txt('Estimativa equivalente, nao cronometragem'), M + 4, D.y + 5);
  setText(COL.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  const discText = wrap('Os valores refletem o tempo que um sr full-stack dev com conhecimento do codebase levaria pra entregar o mesmo escopo. Cada entrada usa metodologia transparente (bucket de complexidade x multiplicadores aplicaveis).', CW - 8, 7);
  doc.text(discText, M + 4, D.y + 9);
  D.addY(18);

  /* ── Resumo por categoria (barras horizontais) ─────────── */
  D.drawSectionCard('Distribuicao por categoria', 'horas absolutas e percentual do total', () => {
    setText(COL.text);
    const totalH = totals.hours || 1;
    const barMaxW = CW - 70; // sobra 70mm para label + valores

    for (const c of CATEGORIES) {
      const v = totals.byCategory[c.value] || 0;
      const pct = (v / totalH) * 100;
      ensureSpace(8);

      // Label da categoria
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); setText(COL.text);
      doc.text(txt(c.label), M, D.y + 4);

      // Barra
      const barX = M + 38;
      setFill(COL.track); doc.rect(barX, D.y + 1.5, barMaxW, 3, 'F');
      const fillW = (pct / 100) * barMaxW;
      setFill(CAT_COLORS[c.value] || COL.brand); doc.rect(barX, D.y + 1.5, fillW, 3, 'F');

      // Horas + %
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setText(COL.muted);
      doc.text(txt(`${fmtH(v)}  ·  ${pct.toFixed(1)}%`), W - M, D.y + 4, { align: 'right' });

      D.addY(7);
    }
  });
  D.addY(6);

  /* ── Tabela de entradas paginada ───────────────────────── */
  D.drawSectionCard('Entradas detalhadas', 'ordem cronologica decrescente', () => {});

  // Header da tabela
  const colX = {
    date:    M,
    type:    M + 22,
    version: M + 38,
    title:   M + 78,
    hours:   W - M - 38,
    cost:    W - M,
  };

  const drawTableHeader = () => {
    setFill(COL.brand); doc.rect(M, D.y, CW, 7, 'F');
    setText(COL.white); doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
    doc.text(txt('DATA'),    colX.date,    D.y + 5);
    doc.text(txt('TIPO'),    colX.type,    D.y + 5);
    doc.text(txt('VERSAO / FASE'), colX.version, D.y + 5);
    doc.text(txt('TITULO'),  colX.title,   D.y + 5);
    doc.text(txt('HORAS'),   colX.hours,   D.y + 5, { align: 'right' });
    doc.text(txt('CUSTO'),   colX.cost,    D.y + 5, { align: 'right' });
    D.addY(7);
  };

  drawTableHeader();

  // Ordena por completedAt desc
  const sorted = [...entries].sort((a, b) => {
    const da = a.completedAt?.toDate ? a.completedAt.toDate() : new Date(a.completedAt || 0);
    const db = b.completedAt?.toDate ? b.completedAt.toDate() : new Date(b.completedAt || 0);
    return db - da;
  });

  let altRow = false;
  for (const e of sorted) {
    const titleLines = wrap(e.title || '', CW - 78 - 40, 7.5);
    const rowH = Math.max(7, titleLines.length * 3.2 + 4);

    ensureSpace(rowH, () => { D.drawPageHeader('Horas de Desenvolvimento'); drawTableHeader(); });

    if (altRow) { setFill(COL.subBg); doc.rect(M, D.y, CW, rowH, 'F'); }
    altRow = !altRow;

    setText(COL.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    doc.text(txt(fmtDate(e.completedAt)), colX.date, D.y + 4.5);

    // Tipo (chip)
    const isPhase = e.entryType === 'phase';
    setFill(isPhase ? COL.brand2 : COL.blue);
    doc.roundedRect(colX.type, D.y + 1.5, 13, 4, 1, 1, 'F');
    setText(COL.white); doc.setFont('helvetica', 'bold'); doc.setFontSize(5.5);
    doc.text(txt(isPhase ? 'FASE' : 'RELEASE'), colX.type + 6.5, D.y + 4.5, { align: 'center' });

    // Versão / Fase
    setText(COL.text); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    const verText = isPhase
      ? (e.phaseLabel || '—').slice(0, 30)
      : (e.releaseVersion || '—');
    doc.text(txt(verText), colX.version, D.y + 4.5);

    // Título (multi-linha)
    setText(COL.text); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.text(titleLines, colX.title, D.y + 4.5);

    // Horas
    setText(COL.text); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text(txt(fmtH(e.totalHours)), colX.hours, D.y + 4.5, { align: 'right' });

    // Custo
    setText(COL.green); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text(txt(fmtBR.format(e.totalCost || 0)), colX.cost, D.y + 4.5, { align: 'right' });

    D.addY(rowH);
  }

  // Linha de total
  ensureSpace(10);
  setFill(COL.brand); doc.rect(M, D.y, CW, 8, 'F');
  setText(COL.white); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text(txt(`TOTAL  ·  ${entries.length} entrada${entries.length !== 1 ? 's' : ''}`), colX.date, D.y + 5.5);
  doc.text(txt(fmtH(totals.hours)), colX.hours, D.y + 5.5, { align: 'right' });
  setText(COL.gold);
  doc.text(txt(fmtBR.format(totals.cost)), colX.cost, D.y + 5.5, { align: 'right' });
  D.addY(10);

  /* ── Footer + paginação ────────────────────────────────── */
  D.drawFooter('PRIMETOUR · Horas de Desenvolvimento');

  /* ── Salvar ───────────────────────────────────────────── */
  const today = new Date().toISOString().slice(0, 10);
  const fname = `horas-desenvolvimento-primetour-${today}${opts.fileSuffix || ''}.pdf`;
  doc.save(fname);
});
