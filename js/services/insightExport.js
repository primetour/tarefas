/**
 * PRIMETOUR — Per-Insight Export
 *
 * Exporta UM insight individual com todo o contexto:
 *   - Conteúdo: título, observação, recomendação, tipo, impacto
 *   - Período coberto (analisado)
 *   - Dados observados (dataSnapshot — foto histórica)
 *   - Filtros aplicados na análise
 *   - Audit: autor, data, origem (manual/IA), agente IA (se IA)
 *
 * Diferente do export em batch do dashboard (que exporta TODOS os insights
 * agrupados), este export é por-insight e serve pra compartilhar/arquivar
 * uma análise específica como documento standalone.
 *
 * Formatos:
 *   - PDF single-page (relatório visual)
 *   - XLSX (3 sheets: Insight / Dados observados / Filtros)
 */

import {
  INSIGHT_TYPES, IMPACT_LEVELS, DASHBOARDS,
  formatInsightPeriod, formatDataSnapshot,
} from './insights.js?v=20260508r1';

const fmtDate = ts => {
  if (!ts) return '—';
  const d = ts?.toDate?.() || new Date(ts);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

const sourceLabel = (s) => s === 'ai-generated' ? '🤖 IA'
  : s === 'ai-edited' ? '🤖✎ IA editada'
  : '👤 Manual';

const sourceLabelPlain = (s) => s === 'ai-generated' ? 'IA'
  : s === 'ai-edited' ? 'IA editada'
  : 'Manual';

// Chaves técnicas escondidas em export legível
const TECHNICAL_KEYS = new Set(['color','colors','icon','value','key','id','href','url','avatarColor','colorClass','badgeClass']);

const isBreakdownArray = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  const f = arr[0];
  if (!f || typeof f !== 'object') return false;
  const hasLabel = 'label' in f || 'name' in f || 'area' in f;
  const hasMetric = 'count' in f || 'rate' in f || 'avg' in f || 'total' in f || 'done' in f;
  return hasLabel && hasMetric;
};

const breakdownLabel = (item) => item.label || item.name || item.area || 'item';
const breakdownValue = (item) => {
  if ('avg' in item && item.avg != null) {
    const others = [];
    if ('responseRate' in item) others.push(`${item.responseRate}%`);
    if ('total' in item) others.push(`n=${item.total}`);
    return `${item.avg}${others.length ? ' (' + others.join(', ') + ')' : ''}`;
  }
  if ('rate' in item && item.rate != null) {
    const extras = ('done' in item && 'total' in item) ? ` (${item.done}/${item.total})` : '';
    return `${item.rate}%${extras}`;
  }
  if ('count' in item && item.count != null) return String(item.count);
  if ('total' in item) {
    const done = 'done' in item ? `${item.done}/` : '';
    return `${done}${item.total}`;
  }
  // Fallback genérico: pega TODAS as métricas numéricas restantes do item
  // (ex: { done, created, ...} → "done: 12 · created: 14")
  const numerics = Object.entries(item)
    .filter(([k, v]) =>
      typeof v === 'number' &&
      !['id'].includes(k) &&
      !TECHNICAL_KEYS.has(k))
    .map(([k, v]) => `${k}: ${Number.isInteger(v) ? v : v.toFixed(2)}`);
  if (numerics.length) return numerics.join(' · ');
  return '-';
};

/** Achata snapshot em pares Indicador/Valor pra display em tabela.
 * SMART: arrays de breakdown viram linhas humanas ("Em Andamento" → "41")
 * ao invés de "statusDistribution[0]" → "label: ..., count: ..., color: #..."
 * Esconde chaves técnicas (color, icon, value, etc.)
 */
function snapshotToRows(snap) {
  if (!snap || typeof snap !== 'object') return [];
  const rows = [];

  const flatten = (obj, prefix = '') => {
    if (!obj || typeof obj !== 'object') return;
    Object.entries(obj).forEach(([k, v]) => {
      if (TECHNICAL_KEYS.has(k) || k === 'capturedAt' || k.startsWith('_')) return;
      const label = prefix ? `${prefix} · ${k}` : k;
      if (v == null) {
        rows.push({ chave: label, valor: '—' });
      } else if (Array.isArray(v)) {
        if (v.length === 0) return;
        if (isBreakdownArray(v)) {
          // Cada item vira UMA linha: chave=label do item, valor=métrica formatada
          v.slice(0, 30).forEach(item => {
            rows.push({ chave: `${label} · ${breakdownLabel(item)}`, valor: breakdownValue(item) });
          });
          if (v.length > 30) rows.push({ chave: `${label}`, valor: `(+${v.length - 30} itens)` });
        } else if (typeof v[0] === 'object') {
          rows.push({ chave: label, valor: `${v.length} itens` });
        } else {
          rows.push({ chave: label, valor: v.join(', ') });
        }
      } else if (typeof v === 'object') {
        flatten(v, label);
      } else {
        const val = (typeof v === 'number' && !Number.isInteger(v))
          ? v.toFixed(2)
          : String(v);
        rows.push({ chave: label, valor: val });
      }
    });
  };
  flatten(snap);
  return rows;
}

/** Achata filtros em rows. */
function filtersToRows(filters) {
  if (!filters || typeof filters !== 'object') return [];
  return Object.entries(filters)
    .filter(([k]) => !k.startsWith('_'))
    .map(([chave, valor]) => ({
      chave,
      valor: valor == null || valor === '' ? '— (todos)' : String(valor),
    }));
}

/* ════════════════════════════════════════════════════════════
   PDF SINGLE-PAGE
   ════════════════════════════════════════════════════════════ */

async function loadJsPdf() {
  if (window.jspdf) return window.jspdf;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  if (!window.jspdf?.jsPDF?.API?.autoTable) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  return window.jspdf;
}

// Remove TUDO que está fora de Latin-1 (CP1252) que jsPDF default não renderiza.
// Cobre: emojis, geometric shapes (◎ ◇ ◈ ▲ ●), arrows, dingbats, box-drawing,
// block elements, miscellaneous symbols, supplemental arrows, etc.
// Preserva acentos latinos comuns (á é í ó ú ã ç).
const stripEmoji = s => String(s ?? '')
  // Substitutions ANTES da remoção (preserva semântica)
  .replace(/→/g, ' a ').replace(/←/g, '<-').replace(/↔/g, '<->').replace(/↳/g, '>')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...')
  .replace(/[—–]/g, '-')   // em-dash + en-dash (estavam em General Punctuation U+2000-206F removido)
  .replace(/●/g, '.').replace(/○/g, 'o').replace(/■/g, '#').replace(/□/g, '[]')
  .replace(/▸/g, '>').replace(/◂/g, '<').replace(/▴/g, '^').replace(/▾/g, 'v')
  // Remove ranges não-Latin-1
  .replace(/[\u{2000}-\u{206F}]/gu, '')   // General Punctuation
  .replace(/[\u{2200}-\u{22FF}]/gu, '')   // Mathematical Operators
  .replace(/[\u{2300}-\u{23FF}]/gu, '')   // Misc Technical
  .replace(/[\u{2400}-\u{27BF}]/gu, '')   // Box Drawing, Block, Geometric Shapes, Misc Symbols, Dingbats
  .replace(/[\u{2900}-\u{29FF}]/gu, '')   // Supplemental Arrows-B / Math
  .replace(/[\u{2B00}-\u{2BFF}]/gu, '')   // Misc Symbols and Arrows
  .replace(/[\u{1F000}-\u{1FFFF}]/gu, '') // Emojis (todos)
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Exporta um insight como PDF single-page.
 * @param {Object} insight - documento dashboard_insights
 * @param {Object} opts
 * @param {Object} opts.widgetLabels - mapa indexKey -> label legível
 */
export async function exportInsightToPdf(insight, opts = {}) {
  const { widgetLabels = {} } = opts;
  const { jsPDF } = await loadJsPdf();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 18;
  let y = 20;

  // Cores (PRIMETOUR brand)
  const BRAND = [26, 42, 74];      // navy
  const GOLD  = [212, 168, 67];
  const TEXT  = [33, 33, 33];
  const MUTED = [120, 120, 120];

  const dashInfo = DASHBOARDS[insight.dashboard] || { label: insight.dashboard, icon: '' };
  const widgetLabel = insight.indexKey
    ? (widgetLabels[insight.indexKey] || insight.indexKey)
    : 'Análise Geral do Dashboard';
  const type = INSIGHT_TYPES.find(t => t.key === insight.type) || INSIGHT_TYPES[4];
  const impact = IMPACT_LEVELS.find(x => x.key === insight.impact) || IMPACT_LEVELS[1];

  // ═══ HEADER ═══
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, W, 14, 'F');
  doc.setTextColor(...GOLD);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('PRIMETOUR  ·  INSIGHT', M, 9);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  const headerRight = `${stripEmoji(dashInfo.label)}  ·  ${stripEmoji(widgetLabel)}`;
  doc.text(headerRight, W - M, 9, { align: 'right' });

  y = 22;

  // ═══ BADGES (tipo/impacto/origem) ═══
  doc.setFontSize(8); doc.setFont('helvetica', 'bold');
  const badges = [
    { label: stripEmoji(type.label).toUpperCase(), color: hexToRgb(type.color) },
    { label: `IMPACTO ${stripEmoji(impact.label).toUpperCase()}`, color: hexToRgb(impact.color) },
    { label: sourceLabelPlain(insight.source).toUpperCase(), color: insight.source === 'manual' ? [100, 116, 139] : [167, 139, 250] },
  ];
  let bx = M;
  badges.forEach(b => {
    const text = b.label;
    const tw = doc.getTextWidth(text) + 6;
    doc.setFillColor(...b.color);
    doc.roundedRect(bx, y - 4, tw, 6, 1.5, 1.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.text(text, bx + 3, y);
    bx += tw + 4;
  });
  y += 8;

  // ═══ TÍTULO ═══
  doc.setTextColor(...BRAND);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  const titleLines = doc.splitTextToSize(stripEmoji(insight.title || ''), W - M * 2);
  doc.text(titleLines, M, y);
  y += titleLines.length * 6 + 4;

  // ═══ OBSERVAÇÃO ═══
  if (insight.observation) {
    doc.setTextColor(...MUTED); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text('OBSERVACAO', M, y);
    y += 4;
    doc.setTextColor(...TEXT); doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    const obsLines = doc.splitTextToSize(stripEmoji(insight.observation), W - M * 2);
    doc.text(obsLines, M, y);
    y += obsLines.length * 4.5 + 4;
  }

  // ═══ RECOMENDAÇÃO ═══
  if (insight.recommendation) {
    doc.setFillColor(240, 253, 244);
    const recLines = doc.splitTextToSize(stripEmoji(insight.recommendation), W - M * 2 - 6);
    const recHeight = recLines.length * 4.5 + 8;
    doc.roundedRect(M, y - 1, W - M * 2, recHeight, 1.5, 1.5, 'F');
    doc.setTextColor(34, 197, 94); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text('RECOMENDACAO', M + 3, y + 3);
    doc.setTextColor(...TEXT); doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    doc.text(recLines, M + 3, y + 8);
    y += recHeight + 4;
  }

  // ═══ DIVIDER ═══
  doc.setDrawColor(...MUTED); doc.setLineWidth(0.2);
  doc.line(M, y, W - M, y);
  y += 5;

  // ═══ PERÍODO ANALISADO ═══
  const periodCovered = formatInsightPeriod(insight);
  doc.setTextColor(...BRAND); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
  doc.text('PERIODO ANALISADO', M, y);
  y += 4;
  doc.setTextColor(...TEXT); doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(periodCovered ? stripEmoji(periodCovered) : 'Sem periodo especifico (insight permanente)', M, y);
  y += 6;

  // ═══ GRÁFICO (imagem do canvas, se capturado) ═══
  if (insight.chartImage && insight.chartImage.startsWith('data:image/')) {
    try {
      doc.setTextColor(...BRAND); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      doc.text('GRAFICO  (foto do widget no momento da analise)', M, y);
      y += 3;
      // Detecta formato real (JPEG ou PNG) pra passar a addImage
      const fmt = insight.chartImage.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG';
      // Calcula dimensões via Image (await pra ter w/h reais).
      // Timeout 5s pra evitar PDF travado se data URL malformada.
      const img = await new Promise((res, rej) => {
        const i = new Image();
        const timer = setTimeout(() => rej(new Error('Image load timeout (5s)')), 5000);
        i.onload = () => { clearTimeout(timer); res(i); };
        i.onerror = (e) => { clearTimeout(timer); rej(new Error('Image load error')); };
        i.src = insight.chartImage;
      });
      const imgMaxW = W - M * 2;
      const imgMaxH = 80;
      const ratio = img.width / img.height;
      let imgW, imgH;
      if (ratio > imgMaxW / imgMaxH) {
        imgW = imgMaxW;
        imgH = imgMaxW / ratio;
      } else {
        imgH = imgMaxH;
        imgW = imgMaxH * ratio;
      }
      // Compressão FAST: usa zlib comprimido (vs raw uncompressed default).
      // Pra JPEG é ignorado (já vem comprimido); pra PNG reduz drasticamente.
      doc.addImage(insight.chartImage, fmt, M, y, imgW, imgH, undefined, 'FAST');
      y += imgH + 5;
    } catch (e) {
      console.warn('[exportInsightToPdf] addImage falhou:', e.message);
      doc.setTextColor(...MUTED); doc.setFontSize(7); doc.setFont('helvetica', 'italic');
      doc.text('(Imagem do grafico nao pode ser renderizada neste PDF)', M, y);
      y += 5;
    }
  }

  // ═══ DADOS OBSERVADOS (snapshot) ═══
  if (insight.dataSnapshot) {
    const snapRows = snapshotToRows(insight.dataSnapshot);
    if (snapRows.length) {
      doc.setTextColor(...BRAND); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      doc.text('DADOS OBSERVADOS  (foto historica imutavel)', M, y);
      y += 3;
      doc.autoTable({
        startY: y,
        margin: { left: M, right: M },
        head: [['Indicador', 'Valor']],
        body: snapRows.slice(0, 30).map(r => [stripEmoji(r.chave), stripEmoji(String(r.valor).slice(0, 100))]),
        styles: { fontSize: 8, cellPadding: 1.8, overflow: 'linebreak' },
        headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold', fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 80, fontStyle: 'bold', textColor: BRAND },
          1: { cellWidth: W - M * 2 - 80 },
        },
        didDrawPage: (data) => { y = data.cursor.y; },
      });
      y = doc.lastAutoTable.finalY + 4;
      if (snapRows.length > 30) {
        doc.setTextColor(...MUTED); doc.setFontSize(7); doc.setFont('helvetica', 'italic');
        doc.text(`(+${snapRows.length - 30} indicadores omitidos por espaco)`, M, y);
        y += 4;
      }
      // Captured at
      if (insight.dataSnapshot.capturedAt) {
        doc.setTextColor(...MUTED); doc.setFontSize(7); doc.setFont('helvetica', 'italic');
        doc.text(`Dados capturados em ${new Date(insight.dataSnapshot.capturedAt).toLocaleString('pt-BR')}`, M, y);
        y += 5;
      }
    }
  } else if (!insight.chartImage) {
    doc.setTextColor(...MUTED); doc.setFontSize(8); doc.setFont('helvetica', 'italic');
    doc.text('Sem snapshot de dados associado a este insight.', M, y);
    y += 5;
  }

  // ═══ FILTROS APLICADOS ═══
  const filterRows = filtersToRows(insight.filters);
  if (filterRows.length) {
    doc.setTextColor(...BRAND); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text('FILTROS APLICADOS NA ANALISE', M, y);
    y += 3;
    doc.autoTable({
      startY: y,
      margin: { left: M, right: M },
      head: [['Filtro', 'Valor']],
      body: filterRows.map(r => [stripEmoji(r.chave), stripEmoji(r.valor)]),
      styles: { fontSize: 7.5, cellPadding: 1.5, overflow: 'linebreak' },
      headStyles: { fillColor: [80, 80, 80], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
      columnStyles: { 0: { cellWidth: 50, fontStyle: 'bold' } },
    });
    y = doc.lastAutoTable.finalY + 4;
  }

  // ═══ TAGS ═══
  if ((insight.tags || []).length) {
    doc.setTextColor(...BRAND); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text('TAGS', M, y);
    y += 4;
    doc.setTextColor(...TEXT); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(insight.tags.map(stripEmoji).join('  ·  '), M, y);
    y += 6;
  }

  // ═══ FOOTER (audit) ═══
  const footerY = H - 18;
  doc.setDrawColor(...MUTED); doc.setLineWidth(0.2);
  doc.line(M, footerY, W - M, footerY);

  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  const author = insight.createdBy?.name || '—';
  const writtenAt = fmtDate(insight.createdAt);
  doc.text(`Escrito por ${stripEmoji(author)}  em  ${writtenAt}`, M, footerY + 4);

  if (insight.aiOriginal?.agentName) {
    doc.text(`Agente IA: ${stripEmoji(insight.aiOriginal.agentName)}`, M, footerY + 8);
  }
  if (insight.source === 'ai-edited') {
    doc.text('Insight originalmente gerado por IA, editado por humano.', M, footerY + 12);
  }

  doc.setTextColor(...BRAND); doc.setFont('helvetica', 'bold');
  doc.text('PRIMETOUR · BI', W - M, footerY + 4, { align: 'right' });
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'italic');
  doc.text(`Insight ID ${insight.id}`, W - M, footerY + 8, { align: 'right' });

  // ═══ SAVE ═══
  const filename = `insight_${(insight.title || 'sem_titulo').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').slice(0, 50)}_${insight.id?.slice(0, 8) || ''}.pdf`;
  doc.save(filename);
  return filename;
}

function hexToRgb(hex) {
  const m = String(hex || '').replace('#', '').match(/.{1,2}/g);
  if (!m || m.length < 3) return [100, 100, 100];
  return m.slice(0, 3).map(h => parseInt(h, 16));
}

/* ════════════════════════════════════════════════════════════
   XLSX MULTI-SHEET
   ════════════════════════════════════════════════════════════ */

async function loadXlsx() {
  if (window.XLSX) return window.XLSX;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  return window.XLSX;
}

/**
 * Exporta um insight como XLSX com 3 sheets:
 *   1. Insight        — chave/valor com todos os campos
 *   2. Dados observados — snapshot achatado em tabela
 *   3. Filtros        — filtros aplicados
 */
export async function exportInsightToXlsx(insight, opts = {}) {
  const { widgetLabels = {} } = opts;
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();

  const dashInfo = DASHBOARDS[insight.dashboard] || { label: insight.dashboard, icon: '' };
  const widgetLabel = insight.indexKey
    ? (widgetLabels[insight.indexKey] || insight.indexKey)
    : '— Análise Geral —';
  const type = INSIGHT_TYPES.find(t => t.key === insight.type) || INSIGHT_TYPES[4];
  const impact = IMPACT_LEVELS.find(x => x.key === insight.impact) || IMPACT_LEVELS[1];

  // Sheet 1: Insight (KV)
  const insightRows = [
    { Campo: 'Dashboard', Valor: `${dashInfo.icon} ${dashInfo.label}` },
    { Campo: 'Widget', Valor: widgetLabel },
    { Campo: 'Tipo', Valor: type.label },
    { Campo: 'Impacto', Valor: impact.label },
    { Campo: 'Título', Valor: insight.title || '' },
    { Campo: 'Observação', Valor: insight.observation || '' },
    { Campo: 'Recomendação', Valor: insight.recommendation || '' },
    { Campo: 'Período coberto', Valor: formatInsightPeriod(insight) || 'Sem período específico' },
    { Campo: 'Tags', Valor: (insight.tags || []).join(', ') },
    { Campo: 'Origem', Valor: sourceLabelPlain(insight.source) },
    { Campo: 'Autor', Valor: insight.createdBy?.name || '—' },
    { Campo: 'Escrito em', Valor: fmtDate(insight.createdAt) },
  ];
  if (insight.aiOriginal?.agentName) {
    insightRows.push({ Campo: 'Agente IA', Valor: insight.aiOriginal.agentName });
  }
  if (insight.dataSnapshot?.capturedAt) {
    insightRows.push({ Campo: 'Snapshot capturado em', Valor: new Date(insight.dataSnapshot.capturedAt).toLocaleString('pt-BR') });
  }
  insightRows.push({ Campo: 'ID do insight', Valor: insight.id });

  const ws1 = XLSX.utils.json_to_sheet(insightRows);
  ws1['!cols'] = [{ wch: 22 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Insight');

  // Sheet 2: Dados observados
  const snapRows = snapshotToRows(insight.dataSnapshot);
  if (snapRows.length) {
    const ws2 = XLSX.utils.json_to_sheet(snapRows.map(r => ({ Indicador: r.chave, Valor: r.valor })));
    ws2['!cols'] = [{ wch: 40 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Dados observados');
  } else {
    const ws2 = XLSX.utils.json_to_sheet([{ Aviso: 'Insight sem dataSnapshot associado.' }]);
    ws2['!cols'] = [{ wch: 60 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Dados observados');
  }

  // Sheet 3: Filtros
  const filterRows = filtersToRows(insight.filters);
  if (filterRows.length) {
    const ws3 = XLSX.utils.json_to_sheet(filterRows.map(r => ({ Filtro: r.chave, Valor: r.valor })));
    ws3['!cols'] = [{ wch: 25 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws3, 'Filtros aplicados');
  }

  const filename = `insight_${(insight.title || 'sem_titulo').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').slice(0, 50)}_${insight.id?.slice(0, 8) || ''}.xlsx`;
  XLSX.writeFile(wb, filename);
  return filename;
}
