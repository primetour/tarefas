/**
 * PRIMETOUR — Roteiros de Viagem: Motor de Geração PDF
 * Converte dados de roteiro + área em PDF profissional (jsPDF + autoTable)
 */

import { recordGeneration } from './roteiros.js';

/* ─── CDN libraries ───────────────────────────────────────── */
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

async function loadJsPDF() {
  if (window.jspdf) return;
  await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
  await loadScript('https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.3/dist/jspdf.plugin.autotable.min.js');
}

/* ─── Helpers ─────────────────────────────────────────────── */

/** Format a date string (YYYY-MM-DD) to "dd/MM" */
function fmtDateBR(dateStr) {
  if (!dateStr) return '';
  const parts = String(dateStr).split('-');
  if (parts.length < 3) return dateStr;
  return `${parts[2]}/${parts[1]}`;
}

/** Format a date string (YYYY-MM-DD) to full Brazilian date "23 de janeiro de 2025" */
function fmtDateFull(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return dateStr; }
}

/** Format currency value */
function formatCurrency(value, currency = 'USD') {
  if (value == null || value === '') return '—';
  const num = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^\d.,\-]/g, '').replace(',', '.'));
  if (isNaN(num)) return String(value);
  const symbols = { USD: 'US$', BRL: 'R$', EUR: '€', GBP: '£' };
  const sym = symbols[currency] || currency + ' ';
  return `${sym} ${num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Parse hex color to [r, g, b] */
function hexToRgb(hex) {
  hex = String(hex).replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* ─── PDF page helpers ────────────────────────────────────── */

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_L = 20;
const MARGIN_R = 20;
const MARGIN_T = 25;
const MARGIN_B = 25;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;

/**
 * Check if we need a page break; if so add new page and return reset Y.
 * @returns {number} the Y position to use
 */
function checkPageBreak(doc, y, needed = 40) {
  if (y + needed > PAGE_H - MARGIN_B) {
    doc.addPage();
    return MARGIN_T;
  }
  return y;
}

/** Add a section title with gold left accent bar */
function addSectionTitle(doc, y, title, gold, navy) {
  y = checkPageBreak(doc, y, 20);
  const [gr, gg, gb] = hexToRgb(gold);
  const [nr, ng, nb] = hexToRgb(navy);

  // Gold accent bar
  doc.setFillColor(gr, gg, gb);
  doc.rect(MARGIN_L, y, 3, 10, 'F');

  // Title text
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(nr, ng, nb);
  doc.text(title, MARGIN_L + 8, y + 7.5);

  // Underline
  doc.setDrawColor(gr, gg, gb);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_L, y + 13, PAGE_W - MARGIN_R, y + 13);

  return y + 18;
}

/** Add page number footer */
function addPageNumber(doc, pageNum, totalPages, gold) {
  const [r, g, b] = hexToRgb(gold);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(r, g, b);
  doc.text(`${pageNum} / ${totalPages}`, PAGE_W / 2, PAGE_H - 10, { align: 'center' });
}

/** Draw a thin gold separator line */
function addSeparator(doc, y, gold) {
  const [r, g, b] = hexToRgb(gold);
  doc.setDrawColor(r, g, b);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_L + 10, y, PAGE_W - MARGIN_R - 10, y);
  return y + 6;
}

/* ─── Main export ─────────────────────────────────────────── */

/**
 * Generate a complete travel itinerary PDF
 * @param {object} roteiro - Full roteiro object from Firestore
 * @param {object|null} area - Optional portal area { name, colors: { primary, secondary }, logoUrl }
 */
export async function generateRoteiroPDF(roteiro, area = null) {
  await loadJsPDF();

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const gold = area?.colors?.primary   || '#D4A843';
  const navy = area?.colors?.secondary || '#1A1A2E';
  const [goldR, goldG, goldB] = hexToRgb(gold);
  const [navyR, navyG, navyB] = hexToRgb(navy);
  const buName = area?.name || 'Primetour';

  /* ═══════════════════════════════════════════════════════════
     PAGE 1 — COVER
     ═══════════════════════════════════════════════════════════ */
  buildCoverPage(doc, roteiro, buName, gold, navy);

  /* ═══════════════════════════════════════════════════════════
     PAGES 2+ — DAY BY DAY
     ═══════════════════════════════════════════════════════════ */
  if (roteiro.days?.length) {
    doc.addPage();
    buildDayByDayPages(doc, roteiro, gold, navy);
  }

  /* ═══════════════════════════════════════════════════════════
     HOTELS TABLE
     ═══════════════════════════════════════════════════════════ */
  if (roteiro.hotels?.length) {
    doc.addPage();
    buildHotelsSection(doc, roteiro, gold, navy);
  }

  /* ═══════════════════════════════════════════════════════════
     PRICING SECTION
     ═══════════════════════════════════════════════════════════ */
  if (roteiro.pricing && (roteiro.pricing.perPerson || roteiro.pricing.perCouple || roteiro.pricing.customRows?.length)) {
    buildPricingSection(doc, roteiro, gold, navy);
  }

  /* ═══════════════════════════════════════════════════════════
     OPTIONALS
     ═══════════════════════════════════════════════════════════ */
  if (roteiro.optionals?.length) {
    buildOptionalsSection(doc, roteiro, gold, navy);
  }

  /* ═══════════════════════════════════════════════════════════
     INCLUDES / EXCLUDES
     ═══════════════════════════════════════════════════════════ */
  if (roteiro.includes?.length || roteiro.excludes?.length) {
    buildIncludesExcludes(doc, roteiro, gold, navy);
  }

  /* ═══════════════════════════════════════════════════════════
     PAYMENT TERMS
     ═══════════════════════════════════════════════════════════ */
  if (roteiro.payment && (roteiro.payment.deposit || roteiro.payment.installments || roteiro.payment.deadline || roteiro.payment.notes)) {
    buildPaymentSection(doc, roteiro, gold, navy);
  }

  /* ═══════════════════════════════════════════════════════════
     CANCELLATION POLICY
     ═══════════════════════════════════════════════════════════ */
  if (roteiro.cancellation?.length) {
    buildCancellationSection(doc, roteiro, gold, navy);
  }

  /* ═══════════════════════════════════════════════════════════
     IMPORTANT INFO
     ═══════════════════════════════════════════════════════════ */
  if (hasImportantInfo(roteiro.importantInfo)) {
    buildImportantInfoSection(doc, roteiro, gold, navy);
  }

  /* ═══════════════════════════════════════════════════════════
     CLOSING PAGE
     ═══════════════════════════════════════════════════════════ */
  buildClosingPage(doc, buName, gold, navy);

  /* ═══════════════════════════════════════════════════════════
     PAGE NUMBERS (retroactive)
     ═══════════════════════════════════════════════════════════ */
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 2; i <= totalPages - 1; i++) {
    doc.setPage(i);
    addPageNumber(doc, i - 1, totalPages - 2, gold);
  }

  /* ═══════════════════════════════════════════════════════════
     SAVE & RECORD
     ═══════════════════════════════════════════════════════════ */
  const filename = `roteiro_${(roteiro.title || 'viagem').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_')}.pdf`;
  doc.save(filename);

  try {
    await recordGeneration({
      roteiroId: roteiro.id,
      format: 'pdf',
      areaId: roteiro.areaId || '',
      destinations: roteiro.travel?.destinations?.map(d => d.city || d.country) || [],
    });
  } catch (e) {
    console.warn('Roteiro generation tracking failed:', e);
  }

  return { filename };
}

/* ═══════════════════════════════════════════════════════════════
   SECTION BUILDERS
   ═══════════════════════════════════════════════════════════════ */

/* ─── Cover Page ──────────────────────────────────────────── */
function buildCoverPage(doc, roteiro, buName, gold, navy) {
  const [goldR, goldG, goldB] = hexToRgb(gold);
  const [navyR, navyG, navyB] = hexToRgb(navy);

  // Full navy background
  doc.setFillColor(navyR, navyG, navyB);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

  // Top gold line
  doc.setFillColor(goldR, goldG, goldB);
  doc.rect(30, 40, PAGE_W - 60, 0.8, 'F');

  // BU name
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(goldR, goldG, goldB);
  doc.text(buName.toUpperCase(), PAGE_W / 2, 52, { align: 'center', charSpace: 3 });

  // "ROTEIRO" title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(36);
  doc.setTextColor(goldR, goldG, goldB);
  doc.text('ROTEIRO', PAGE_W / 2, 85, { align: 'center', charSpace: 4 });

  // Thin separator
  doc.setFillColor(goldR, goldG, goldB);
  doc.rect(70, 92, PAGE_W - 140, 0.4, 'F');

  // Destination names
  const destinations = roteiro.travel?.destinations || [];
  const destNames = destinations.map(d => d.city || d.country).filter(Boolean);
  const destText = destNames.join('  |  ').toUpperCase();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  const destLines = doc.splitTextToSize(destText, CONTENT_W + 20);
  let destY = 115;
  destLines.forEach(line => {
    doc.text(line, PAGE_W / 2, destY, { align: 'center' });
    destY += 10;
  });

  // Duration badge
  const nights = roteiro.travel?.nights || destinations.reduce((s, d) => s + (d.nights || 0), 0);
  const citiesStr = destNames.join(' e ');
  const badgeText = `${nights} NOITE${nights !== 1 ? 'S' : ''}  |  ${citiesStr}`;

  const badgeY = destY + 12;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(goldR, goldG, goldB);

  // Badge outline
  const badgeW = Math.min(doc.getTextWidth(badgeText) + 20, CONTENT_W + 20);
  const badgeX = (PAGE_W - badgeW) / 2;
  doc.setDrawColor(goldR, goldG, goldB);
  doc.setLineWidth(0.4);
  doc.roundedRect(badgeX, badgeY - 6, badgeW, 12, 2, 2, 'S');
  doc.text(badgeText, PAGE_W / 2, badgeY + 2, { align: 'center' });

  // Travel dates
  if (roteiro.travel?.startDate && roteiro.travel?.endDate) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(180, 180, 180);
    const dateStr = `${fmtDateFull(roteiro.travel.startDate)}  a  ${fmtDateFull(roteiro.travel.endDate)}`;
    doc.text(dateStr, PAGE_W / 2, badgeY + 20, { align: 'center' });
  }

  // Bottom gold line
  doc.setFillColor(goldR, goldG, goldB);
  doc.rect(30, PAGE_H - 60, PAGE_W - 60, 0.8, 'F');

  // Client info at bottom
  if (roteiro.client?.name) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(200, 200, 200);
    doc.text(`Preparado para ${roteiro.client.name}`, PAGE_W / 2, PAGE_H - 48, { align: 'center' });

    const paxParts = [];
    if (roteiro.client.adults) paxParts.push(`${roteiro.client.adults} adulto${roteiro.client.adults > 1 ? 's' : ''}`);
    if (roteiro.client.children) paxParts.push(`${roteiro.client.children} criança${roteiro.client.children > 1 ? 's' : ''}`);
    if (paxParts.length) {
      doc.setFontSize(9);
      doc.setTextColor(160, 160, 160);
      doc.text(paxParts.join(' + '), PAGE_W / 2, PAGE_H - 42, { align: 'center' });
    }
  }

  // Title at very bottom
  if (roteiro.title) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(roteiro.title, PAGE_W / 2, PAGE_H - 20, { align: 'center' });
  }
}

/* ─── Day by Day ──────────────────────────────────────────── */
function buildDayByDayPages(doc, roteiro, gold, navy) {
  const [goldR, goldG, goldB] = hexToRgb(gold);
  const [navyR, navyG, navyB] = hexToRgb(navy);

  let y = MARGIN_T;

  // Section header
  y = addSectionTitle(doc, y, 'ROTEIRO DIA A DIA', gold, navy);
  y += 4;

  for (let i = 0; i < roteiro.days.length; i++) {
    const day = roteiro.days[i];

    // Estimate space needed: header(15) + city(8) + narrative lines + overnight(10) + padding(10)
    const narrativeLines = day.narrative
      ? doc.splitTextToSize(day.narrative, CONTENT_W - 15).length
      : 0;
    const neededSpace = 20 + (narrativeLines * 5) + 15;

    y = checkPageBreak(doc, y, Math.min(neededSpace, 60));

    // Day number circle/badge
    doc.setFillColor(goldR, goldG, goldB);
    doc.circle(MARGIN_L + 5, y + 4, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(navyR, navyG, navyB);
    doc.text(String(day.dayNumber || i + 1), MARGIN_L + 5, y + 5.5, { align: 'center' });

    // "X° dia" label + date
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(navyR, navyG, navyB);
    const dayLabel = `${day.dayNumber || i + 1}° dia`;
    doc.text(dayLabel, MARGIN_L + 14, y + 5.5);

    if (day.date) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(130, 130, 130);
      doc.text(`— ${fmtDateBR(day.date)}`, MARGIN_L + 14 + doc.getTextWidth(dayLabel) + 3, y + 5.5);
    }

    y += 10;

    // City header
    if (day.city) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(goldR, goldG, goldB);
      doc.text(day.city.toUpperCase(), MARGIN_L + 14, y + 3, { charSpace: 1.5 });
      y += 8;
    }

    // Title (if different from city)
    if (day.title && day.title !== day.city) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(navyR, navyG, navyB);
      const titleLines = doc.splitTextToSize(day.title, CONTENT_W - 15);
      doc.text(titleLines, MARGIN_L + 14, y + 3);
      y += titleLines.length * 4.5 + 2;
    }

    // Narrative text
    if (day.narrative) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(60, 60, 60);
      const lines = doc.splitTextToSize(day.narrative, CONTENT_W - 15);

      // If the narrative is very long, we may need to split across pages
      let lineIdx = 0;
      while (lineIdx < lines.length) {
        const availableLines = Math.floor((PAGE_H - MARGIN_B - y) / 4.5);
        if (availableLines <= 0) {
          doc.addPage();
          y = MARGIN_T;
          continue;
        }
        const chunk = lines.slice(lineIdx, lineIdx + availableLines);
        doc.text(chunk, MARGIN_L + 14, y + 3);
        y += chunk.length * 4.5;
        lineIdx += chunk.length;

        if (lineIdx < lines.length) {
          doc.addPage();
          y = MARGIN_T;
        }
      }
      y += 2;
    }

    // Overnight city
    if (day.overnightCity) {
      y = checkPageBreak(doc, y, 10);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(goldR, goldG, goldB);
      doc.text(`Noite: ${day.overnightCity}`, MARGIN_L + 14, y + 3);
      y += 8;
    }

    // Separator between days (not after last)
    if (i < roteiro.days.length - 1) {
      y = checkPageBreak(doc, y, 8);
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.2);
      doc.line(MARGIN_L + 14, y, PAGE_W - MARGIN_R, y);
      y += 6;
    }
  }
}

/* ─── Hotels Table ────────────────────────────────────────── */
function buildHotelsSection(doc, roteiro, gold, navy) {
  const [goldR, goldG, goldB] = hexToRgb(gold);
  const [navyR, navyG, navyB] = hexToRgb(navy);

  let y = MARGIN_T;
  y = addSectionTitle(doc, y, 'HOTÉIS PREVISTOS', gold, navy);
  y += 2;

  const tableBody = roteiro.hotels.map(h => {
    const period = [h.checkIn, h.checkOut].filter(Boolean).map(fmtDateBR).join(' a ');
    return [
      h.city || '',
      period,
      h.nights != null ? String(h.nights) : '',
      h.hotelName || '',
      h.roomType || '',
      h.regime || '',
    ];
  });

  doc.autoTable({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Cidade', 'Período', 'Noites', 'Hotel', 'Acomodação', 'Regime']],
    body: tableBody,
    theme: 'grid',
    headStyles: {
      fillColor: [navyR, navyG, navyB],
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
      halign: 'center',
      cellPadding: 3,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [50, 50, 50],
      cellPadding: 2.5,
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245],
    },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 28, halign: 'center' },
      2: { cellWidth: 14, halign: 'center' },
      3: { cellWidth: 42 },
      4: { cellWidth: 30 },
      5: { cellWidth: 28 },
    },
    styles: {
      lineColor: [220, 220, 220],
      lineWidth: 0.3,
    },
  });
}

/* ─── Pricing ─────────────────────────────────────────────── */
function buildPricingSection(doc, roteiro, gold, navy) {
  const [goldR, goldG, goldB] = hexToRgb(gold);
  const [navyR, navyG, navyB] = hexToRgb(navy);
  const pricing = roteiro.pricing;
  const currency = pricing.currency || 'USD';

  let y = (doc.lastAutoTable?.finalY || doc.internal.getCurrentPageInfo().pageNumber > 1 ? doc.lastAutoTable?.finalY + 15 : MARGIN_T);
  if (!y || y > PAGE_H - 80) {
    doc.addPage();
    y = MARGIN_T;
  }

  y = addSectionTitle(doc, y, 'TARIFAS', gold, navy);
  y += 2;

  const rows = [];
  if (pricing.perPerson) {
    rows.push(['Valor por pessoa', formatCurrency(pricing.perPerson, currency)]);
  }
  if (pricing.perCouple) {
    rows.push(['Valor por casal', formatCurrency(pricing.perCouple, currency)]);
  }
  if (pricing.validUntil) {
    rows.push(['Validade da cotação', fmtDateFull(pricing.validUntil)]);
  }
  if (pricing.customRows?.length) {
    for (const cr of pricing.customRows) {
      if (cr.label) rows.push([cr.label, cr.value || '']);
    }
  }

  if (rows.length) {
    doc.autoTable({
      startY: y,
      margin: { left: MARGIN_L, right: MARGIN_R },
      body: rows,
      theme: 'plain',
      bodyStyles: {
        fontSize: 9,
        textColor: [50, 50, 50],
        cellPadding: 3,
      },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 55, textColor: [navyR, navyG, navyB] },
        1: { halign: 'left', cellWidth: CONTENT_W - 55 },
      },
      styles: {
        lineColor: [230, 230, 230],
        lineWidth: 0.2,
      },
      didDrawCell: (data) => {
        if (data.row.index === 0 && data.section === 'body') {
          // Top border gold accent
          doc.setDrawColor(goldR, goldG, goldB);
          doc.setLineWidth(0.5);
          doc.line(data.cell.x, data.cell.y, data.cell.x + data.cell.width, data.cell.y);
        }
      },
    });

    y = doc.lastAutoTable.finalY + 5;
  }

  // Disclaimer
  if (pricing.disclaimer) {
    y = checkPageBreak(doc, y, 25);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 120);
    const disclaimerLines = doc.splitTextToSize(pricing.disclaimer, CONTENT_W);
    doc.text(disclaimerLines, MARGIN_L, y + 3);
  }
}

/* ─── Optionals ───────────────────────────────────────────── */
function buildOptionalsSection(doc, roteiro, gold, navy) {
  const [goldR, goldG, goldB] = hexToRgb(gold);
  const [navyR, navyG, navyB] = hexToRgb(navy);

  let y = (doc.lastAutoTable?.finalY || 0) + 15;
  if (y > PAGE_H - 60) {
    doc.addPage();
    y = MARGIN_T;
  }

  y = addSectionTitle(doc, y, 'OPCIONAIS', gold, navy);
  y += 2;

  const tableBody = roteiro.optionals.map(o => [
    o.service || '',
    o.priceAdult != null ? formatCurrency(o.priceAdult, roteiro.pricing?.currency || 'USD') : '—',
    o.priceChild != null ? formatCurrency(o.priceChild, roteiro.pricing?.currency || 'USD') : '—',
  ]);

  doc.autoTable({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Serviço', 'Valor por Adulto', 'Valor por Criança']],
    body: tableBody,
    theme: 'grid',
    headStyles: {
      fillColor: [navyR, navyG, navyB],
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
      halign: 'center',
      cellPadding: 3,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [50, 50, 50],
      cellPadding: 2.5,
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245],
    },
    columnStyles: {
      0: { cellWidth: 90 },
      1: { cellWidth: 40, halign: 'center' },
      2: { cellWidth: 40, halign: 'center' },
    },
    styles: {
      lineColor: [220, 220, 220],
      lineWidth: 0.3,
    },
  });
}

/* ─── Includes / Excludes ─────────────────────────────────── */
function buildIncludesExcludes(doc, roteiro, gold, navy) {
  const [goldR, goldG, goldB] = hexToRgb(gold);
  const [navyR, navyG, navyB] = hexToRgb(navy);

  let y = (doc.lastAutoTable?.finalY || 0) + 15;
  if (y > PAGE_H - 80) {
    doc.addPage();
    y = MARGIN_T;
  }

  // INCLUDES
  if (roteiro.includes?.length) {
    y = addSectionTitle(doc, y, 'O ROTEIRO INCLUI', gold, navy);
    y += 3;

    for (const item of roteiro.includes) {
      y = checkPageBreak(doc, y, 8);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(34, 139, 34); // Green
      doc.text('✓', MARGIN_L + 3, y + 3);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(50, 50, 50);
      const lines = doc.splitTextToSize(item, CONTENT_W - 12);
      doc.text(lines, MARGIN_L + 10, y + 3);
      y += lines.length * 4.2 + 2;
    }
    y += 6;
  }

  // EXCLUDES
  if (roteiro.excludes?.length) {
    y = checkPageBreak(doc, y, 20);
    y = addSectionTitle(doc, y, 'O ROTEIRO NÃO INCLUI', gold, navy);
    y += 3;

    for (const item of roteiro.excludes) {
      y = checkPageBreak(doc, y, 8);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(200, 60, 60); // Red
      doc.text('✕', MARGIN_L + 3, y + 3);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(50, 50, 50);
      const lines = doc.splitTextToSize(item, CONTENT_W - 12);
      doc.text(lines, MARGIN_L + 10, y + 3);
      y += lines.length * 4.2 + 2;
    }
  }
}

/* ─── Payment Terms ───────────────────────────────────────── */
function buildPaymentSection(doc, roteiro, gold, navy) {
  const [goldR, goldG, goldB] = hexToRgb(gold);
  const [navyR, navyG, navyB] = hexToRgb(navy);
  const payment = roteiro.payment;

  let y = (doc.lastAutoTable?.finalY || 0) + 15;
  if (y > PAGE_H - 60) {
    doc.addPage();
    y = MARGIN_T;
  }

  y = addSectionTitle(doc, y, 'FORMA DE PAGAMENTO', gold, navy);
  y += 4;

  const entries = [
    { label: 'Sinal / Depósito', value: payment.deposit },
    { label: 'Parcelamento', value: payment.installments },
    { label: 'Prazo', value: payment.deadline },
    { label: 'Observações', value: payment.notes },
  ].filter(e => e.value);

  for (const entry of entries) {
    y = checkPageBreak(doc, y, 15);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(navyR, navyG, navyB);
    doc.text(entry.label + ':', MARGIN_L + 3, y + 3);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(60, 60, 60);
    const lines = doc.splitTextToSize(entry.value, CONTENT_W - 45);
    doc.text(lines, MARGIN_L + 42, y + 3);
    y += Math.max(lines.length * 4.2, 6) + 3;
  }
}

/* ─── Cancellation Policy ─────────────────────────────────── */
function buildCancellationSection(doc, roteiro, gold, navy) {
  const [goldR, goldG, goldB] = hexToRgb(gold);
  const [navyR, navyG, navyB] = hexToRgb(navy);

  let y = (doc.lastAutoTable?.finalY || 0) + 15;
  if (y > PAGE_H - 60) {
    doc.addPage();
    y = MARGIN_T;
  }

  y = addSectionTitle(doc, y, 'POLÍTICA DE CANCELAMENTO', gold, navy);
  y += 2;

  const tableBody = roteiro.cancellation.map(c => [
    c.period || '',
    c.penalty || '',
  ]);

  doc.autoTable({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Período', 'Penalidade']],
    body: tableBody,
    theme: 'grid',
    headStyles: {
      fillColor: [navyR, navyG, navyB],
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
      halign: 'center',
      cellPadding: 3,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [50, 50, 50],
      cellPadding: 2.5,
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245],
    },
    columnStyles: {
      0: { cellWidth: 85 },
      1: { cellWidth: 85 },
    },
    styles: {
      lineColor: [220, 220, 220],
      lineWidth: 0.3,
    },
  });
}

/* ─── Important Info ──────────────────────────────────────── */
function hasImportantInfo(info) {
  if (!info) return false;
  return !!(info.passport || info.visa || info.vaccines || info.climate ||
            info.luggage || info.flights || info.customFields?.length);
}

function buildImportantInfoSection(doc, roteiro, gold, navy) {
  const [goldR, goldG, goldB] = hexToRgb(gold);
  const [navyR, navyG, navyB] = hexToRgb(navy);
  const info = roteiro.importantInfo;

  let y = (doc.lastAutoTable?.finalY || 0) + 15;
  if (y > PAGE_H - 60) {
    doc.addPage();
    y = MARGIN_T;
  }

  y = addSectionTitle(doc, y, 'INFORMAÇÕES IMPORTANTES', gold, navy);
  y += 4;

  const sections = [
    { label: 'DOCUMENTAÇÃO PARA EMBARQUE / PASSAPORTE', value: info.passport },
    { label: 'VISTO', value: info.visa },
    { label: 'VACINAS E SAÚDE', value: info.vaccines },
    { label: 'CLIMA E MELHOR ÉPOCA', value: info.climate },
    { label: 'BAGAGEM', value: info.luggage },
    { label: 'VOOS', value: info.flights },
  ].filter(s => s.value);

  // Add custom fields
  if (info.customFields?.length) {
    for (const cf of info.customFields) {
      if (cf.label && cf.value) {
        sections.push({ label: cf.label.toUpperCase(), value: cf.value });
      }
    }
  }

  for (const section of sections) {
    y = checkPageBreak(doc, y, 20);

    // Sub-section label
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(goldR, goldG, goldB);
    doc.text(section.label, MARGIN_L + 3, y + 3, { charSpace: 0.8 });
    y += 7;

    // Content
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(60, 60, 60);
    const lines = doc.splitTextToSize(section.value, CONTENT_W - 6);

    // Handle multi-page content
    let lineIdx = 0;
    while (lineIdx < lines.length) {
      const availableLines = Math.floor((PAGE_H - MARGIN_B - y) / 4.2);
      if (availableLines <= 0) {
        doc.addPage();
        y = MARGIN_T;
        continue;
      }
      const chunk = lines.slice(lineIdx, lineIdx + availableLines);
      doc.text(chunk, MARGIN_L + 3, y + 3);
      y += chunk.length * 4.2;
      lineIdx += chunk.length;

      if (lineIdx < lines.length) {
        doc.addPage();
        y = MARGIN_T;
      }
    }
    y += 5;
  }
}

/* ─── Closing Page ────────────────────────────────────────── */
function buildClosingPage(doc, buName, gold, navy) {
  const [goldR, goldG, goldB] = hexToRgb(gold);
  const [navyR, navyG, navyB] = hexToRgb(navy);

  doc.addPage();

  // Full navy background
  doc.setFillColor(navyR, navyG, navyB);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

  // Centered gold line
  doc.setFillColor(goldR, goldG, goldB);
  doc.rect(50, PAGE_H / 2 - 20, PAGE_W - 100, 0.6, 'F');

  // BU Name
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(goldR, goldG, goldB);
  doc.text(buName.toUpperCase(), PAGE_W / 2, PAGE_H / 2, { align: 'center', charSpace: 4 });

  // Tagline
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(180, 180, 180);
  doc.text('Experiências exclusivas de viagem', PAGE_W / 2, PAGE_H / 2 + 14, { align: 'center' });

  // Bottom gold line
  doc.setFillColor(goldR, goldG, goldB);
  doc.rect(50, PAGE_H / 2 + 22, PAGE_W - 100, 0.6, 'F');
}

/* ═══════════════════════════════════════════════════════════════
   PPTX GENERATION
   ═══════════════════════════════════════════════════════════════ */

async function loadPptxGenJS() {
  if (window.PptxGenJS) return;
  await loadScript('https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js');
}

/**
 * Generate travel itinerary as PowerPoint presentation
 */
export async function generateRoteiroPPTX(roteiro, area = null) {
  await loadPptxGenJS();

  const gold = area?.colors?.primary || '#D4A843';
  const navy = area?.colors?.secondary || '#1A1A2E';
  const buName = area?.name || 'Primetour';

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = buName;
  pptx.title = roteiro.title || 'Roteiro de Viagem';

  const W = 10, H = 5.625; // inches (16:9)

  // ─── Slide 1: Cover ───────────────────────────────────────
  const cover = pptx.addSlide();
  cover.background = { color: navy.replace('#', '') };

  // Gold line
  cover.addShape(pptx.ShapeType.rect, { x: 1, y: 1.2, w: W - 2, h: 0.02, fill: { color: gold.replace('#', '') } });

  // BU name
  cover.addText(buName.toUpperCase(), { x: 0, y: 1.4, w: W, h: 0.4, align: 'center', fontSize: 10, color: gold.replace('#', ''), charSpacing: 4 });

  // ROTEIRO
  cover.addText('ROTEIRO', { x: 0, y: 2, w: W, h: 0.7, align: 'center', fontSize: 36, bold: true, color: gold.replace('#', ''), charSpacing: 5 });

  // Destinations
  const destNames = (roteiro.travel?.destinations || []).map(d => d.city || d.country).filter(Boolean);
  cover.addText(destNames.join('  |  ').toUpperCase(), { x: 0.5, y: 2.8, w: W - 1, h: 0.5, align: 'center', fontSize: 18, bold: true, color: 'FFFFFF' });

  // Duration badge
  const nights = roteiro.travel?.nights || roteiro.days?.length || 0;
  cover.addText(`${nights} NOITES | ${destNames.join(' e ')}`, { x: 0, y: 3.5, w: W, h: 0.35, align: 'center', fontSize: 11, color: gold.replace('#', '') });

  // Bottom gold line
  cover.addShape(pptx.ShapeType.rect, { x: 1, y: 4.2, w: W - 2, h: 0.02, fill: { color: gold.replace('#', '') } });

  // ─── Day-by-day slides ─────────────────────────────────────
  const days = roteiro.days || [];
  for (let i = 0; i < days.length; i += 2) {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };

    // Header bar
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.6, fill: { color: navy.replace('#', '') } });
    slide.addText('ROTEIRO SUGERIDO', { x: 0.5, y: 0.05, w: W - 1, h: 0.5, fontSize: 14, bold: true, color: gold.replace('#', '') });

    // Two days per slide
    for (let j = 0; j < 2 && (i + j) < days.length; j++) {
      const d = days[i + j];
      const yBase = 0.8 + j * 2.3;

      // Day number badge
      slide.addShape(pptx.ShapeType.ellipse, { x: 0.4, y: yBase, w: 0.45, h: 0.45, fill: { color: gold.replace('#', '') } });
      slide.addText(`${d.dayNumber || i + j + 1}`, { x: 0.4, y: yBase, w: 0.45, h: 0.45, align: 'center', valign: 'middle', fontSize: 12, bold: true, color: navy.replace('#', '') });

      // Date + city
      const dateText = d.date ? fmtDateBR(d.date) : '';
      slide.addText(`${dateText} - ${d.city || ''}`, { x: 1, y: yBase, w: 3, h: 0.35, fontSize: 11, bold: true, color: navy.replace('#', '') });

      // Title
      if (d.title) {
        slide.addText(d.title, { x: 1, y: yBase + 0.3, w: 8.5, h: 0.3, fontSize: 10, bold: true, color: '333333' });
      }

      // Narrative (truncated for slide)
      const narrative = (d.narrative || '').substring(0, 500);
      if (narrative) {
        slide.addText(narrative, { x: 1, y: yBase + 0.6, w: 8.5, h: 1.5, fontSize: 8.5, color: '555555', valign: 'top', wrap: true });
      }

      // Overnight
      if (d.overnightCity) {
        slide.addText(`Noite: ${d.overnightCity}`, { x: 1, y: yBase + 2.0, w: 4, h: 0.25, fontSize: 8, italic: true, color: gold.replace('#', '') });
      }
    }
  }

  // ─── Hotels slide ──────────────────────────────────────────
  if (roteiro.hotels?.length) {
    const hSlide = pptx.addSlide();
    hSlide.background = { color: 'FFFFFF' };
    hSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.6, fill: { color: navy.replace('#', '') } });
    hSlide.addText('HOTÉIS PREVISTOS', { x: 0.5, y: 0.05, w: W - 1, h: 0.5, fontSize: 14, bold: true, color: gold.replace('#', '') });

    const rows = [
      [{ text: 'Cidade', options: { bold: true, color: 'FFFFFF', fill: { color: navy.replace('#', '') } } },
       { text: 'Hotel', options: { bold: true, color: 'FFFFFF', fill: { color: navy.replace('#', '') } } },
       { text: 'Quarto', options: { bold: true, color: 'FFFFFF', fill: { color: navy.replace('#', '') } } },
       { text: 'Regime', options: { bold: true, color: 'FFFFFF', fill: { color: navy.replace('#', '') } } },
       { text: 'Noites', options: { bold: true, color: 'FFFFFF', fill: { color: navy.replace('#', '') } } }],
    ];
    roteiro.hotels.forEach(h => {
      rows.push([h.city || '', h.hotelName || '', h.roomType || '', h.regime || '', String(h.nights || '')]);
    });
    hSlide.addTable(rows, { x: 0.5, y: 0.8, w: W - 1, fontSize: 9, border: { pt: 0.5, color: 'CCCCCC' }, colW: [1.8, 2.5, 2, 1.5, 1] });
  }

  // ─── Pricing slide ─────────────────────────────────────────
  if (roteiro.pricing?.perPerson || roteiro.pricing?.perCouple) {
    const pSlide = pptx.addSlide();
    pSlide.background = { color: 'FFFFFF' };
    pSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.6, fill: { color: navy.replace('#', '') } });
    pSlide.addText('TARIFAS', { x: 0.5, y: 0.05, w: W - 1, h: 0.5, fontSize: 14, bold: true, color: gold.replace('#', '') });

    let y = 1;
    const cur = roteiro.pricing.currency || 'USD';
    if (roteiro.pricing.perCouple) {
      pSlide.addText(`DUPLO: ${formatCurrency(roteiro.pricing.perCouple, cur)}`, { x: 1, y, w: 8, h: 0.5, fontSize: 20, bold: true, color: navy.replace('#', '') });
      y += 0.6;
    }
    if (roteiro.pricing.perPerson) {
      pSlide.addText(`POR PESSOA: ${formatCurrency(roteiro.pricing.perPerson, cur)}`, { x: 1, y, w: 8, h: 0.5, fontSize: 20, bold: true, color: navy.replace('#', '') });
      y += 0.6;
    }
    if (roteiro.pricing.disclaimer) {
      pSlide.addText(roteiro.pricing.disclaimer, { x: 1, y: y + 0.3, w: 8, h: 2, fontSize: 8, color: '888888', italic: true, wrap: true });
    }
  }

  // ─── Includes/Excludes slide ───────────────────────────────
  if (roteiro.includes?.length || roteiro.excludes?.length) {
    const ieSlide = pptx.addSlide();
    ieSlide.background = { color: 'FFFFFF' };
    ieSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.6, fill: { color: navy.replace('#', '') } });
    ieSlide.addText('INCLUI / NÃO INCLUI', { x: 0.5, y: 0.05, w: W - 1, h: 0.5, fontSize: 14, bold: true, color: gold.replace('#', '') });

    if (roteiro.includes?.length) {
      ieSlide.addText('INCLUI:', { x: 0.5, y: 0.8, w: 4.5, h: 0.35, fontSize: 11, bold: true, color: '22C55E' });
      const incText = roteiro.includes.map(t => `✓  ${t}`).join('\n');
      ieSlide.addText(incText, { x: 0.5, y: 1.2, w: 4.5, h: 3.5, fontSize: 8.5, color: '333333', valign: 'top', wrap: true });
    }
    if (roteiro.excludes?.length) {
      ieSlide.addText('NÃO INCLUI:', { x: 5.2, y: 0.8, w: 4.5, h: 0.35, fontSize: 11, bold: true, color: 'EF4444' });
      const excText = roteiro.excludes.map(t => `✕  ${t}`).join('\n');
      ieSlide.addText(excText, { x: 5.2, y: 1.2, w: 4.5, h: 3.5, fontSize: 8.5, color: '333333', valign: 'top', wrap: true });
    }
  }

  // ─── Closing slide ─────────────────────────────────────────
  const closing = pptx.addSlide();
  closing.background = { color: navy.replace('#', '') };
  closing.addShape(pptx.ShapeType.rect, { x: 2, y: 2.2, w: W - 4, h: 0.02, fill: { color: gold.replace('#', '') } });
  closing.addText(buName.toUpperCase(), { x: 0, y: 2.4, w: W, h: 0.6, align: 'center', fontSize: 24, bold: true, color: gold.replace('#', ''), charSpacing: 4 });
  closing.addText('Experiências exclusivas de viagem', { x: 0, y: 3, w: W, h: 0.4, align: 'center', fontSize: 10, color: 'AAAAAA' });
  closing.addShape(pptx.ShapeType.rect, { x: 2, y: 3.5, w: W - 4, h: 0.02, fill: { color: gold.replace('#', '') } });

  // ─── Save & record ─────────────────────────────────────────
  const filename = `roteiro_${(roteiro.title || 'viagem').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_')}.pptx`;
  await pptx.writeFile({ fileName: filename });

  try {
    await recordGeneration({
      roteiroId: roteiro.id,
      format: 'pptx',
      areaId: roteiro.areaId || '',
      destinations: roteiro.travel?.destinations?.map(d => d.city || d.country) || [],
    });
  } catch (e) {
    console.warn('Roteiro PPTX generation tracking failed:', e);
  }

  return { filename };
}
