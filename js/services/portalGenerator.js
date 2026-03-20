/**
 * PRIMETOUR — Portal de Dicas: Motor de Geração
 * Converte dados de dica + área em .docx, .pdf, .pptx ou link web
 */

import { SEGMENTS, MONTHS, recordGeneration, registerDownload } from './portal.js';
import { db } from '../firebase.js';
import {
  doc, collection, setDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const esc = s => String(s||'').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ─── CDN libraries ───────────────────────────────────────── */
async function loadDocx() {
  if (window.docx) return;
  await loadScript('https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js');
}
async function loadJsPDF() {
  if (window.jspdf) return;
  await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
  await loadScript('https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.3/dist/jspdf.plugin.autotable.min.js');
}
async function loadPptxGenJS() {
  if (window.PptxGenJS) return;
  await loadScript('https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js');
}
function loadScript(src) {
  return new Promise((res,rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

/* ─── Main entry ──────────────────────────────────────────── */
/**
 * @param {object} params
 * @param {object} params.tip        — Firestore tip document
 * @param {object} params.area       — Portal area document
 * @param {object} params.dest       — Destination document
 * @param {string[]} params.segments — selected segment keys
 * @param {string} params.format     — 'docx' | 'pdf' | 'pptx' | 'web'
 * @param {string[]} params.destIds  — for combined destinations
 * @returns {object} { url?, filename? }
 */
export async function generateTip({ tip, area, dest, segments, format, extraTips = [] }) {
  const allTips  = [{ tip, dest }, ...extraTips];
  const areaName = area?.name || 'PRIMETOUR';
  const colors   = area?.colors || { primary: '#D4A843', secondary: '#1A1A2E' };
  const filename = buildFilename(allTips, format);

  switch (format) {
    case 'docx': return generateDocx({ allTips, segments, areaName, area, colors, filename });
    case 'pdf':  return generatePDF({ allTips, segments, areaName, area, colors, filename });
    case 'pptx': return generatePptx({ allTips, segments, areaName, area, colors, filename });
    case 'web':  return generateWebLink({ allTips, segments, areaName, area, colors });
    default:     throw new Error(`Formato desconhecido: ${format}`);
  }
}

function buildFilename(allTips, format) {
  const labels = allTips.map(({ dest }) =>
    [dest?.city, dest?.country].filter(Boolean).join('-')
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-z0-9]+/g,'-')
  );
  const date = new Date().toISOString().slice(0,10);
  return `primetour_${labels.join('_')}_${date}.${format}`;
}

/* ─── Content builder ─────────────────────────────────────── */
function buildContent(tip, segments) {
  const segs = [];
  for (const segKey of segments) {
    const segDef = SEGMENTS.find(s => s.key === segKey);
    const data   = tip?.segments?.[segKey];
    if (!segDef || !data) continue;
    segs.push({ segDef, data });
  }
  return segs;
}

function destLabel(dest) {
  return [dest?.city, dest?.country, dest?.continent].filter(Boolean).join(', ');
}

/* ─── DOCX ────────────────────────────────────────────────── */
async function generateDocx({ allTips, segments, areaName, area, colors, filename }) {
  await loadDocx();
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow,
          TableCell, BorderStyle, WidthType, AlignmentType, ExternalHyperlink,
          ShadingType } = window.docx;

  const primary   = hexToDocxColor(colors.primary   || '#D4A843');
  const secondary = hexToDocxColor(colors.secondary || '#1A1A2E');

  const children = [];

  // Title
  children.push(new Paragraph({
    children: [new TextRun({ text: areaName.toUpperCase(), bold: true, size: 36, color: primary })],
    spacing: { after: 200 },
  }));

  for (const { tip, dest } of allTips) {
    const label = destLabel(dest);

    // Destination heading
    children.push(new Paragraph({
      children: [new TextRun({ text: label, bold: true, size: 28, color: secondary })],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: primary } },
    }));

    const content = buildContent(tip, segments);

    for (const { segDef, data } of content) {
      // Segment heading
      children.push(new Paragraph({
        children: [new TextRun({ text: segDef.label.toUpperCase(), bold: true, size: 22, color: primary })],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 320, after: 120 },
      }));

      if (segDef.mode === 'special_info') {
        const inf = data.info || {};
        const fields = [
          ['Descrição', inf.descricao],
          ['Dica', inf.dica],
          ['População', inf.populacao],
          ['Moeda', inf.moeda],
          ['Língua oficial', inf.lingua],
          ['Religião predominante', inf.religiao],
          ['Fuso horário', inf.fusoSinal && inf.fusoHoras ? `${inf.fusoSinal}${inf.fusoHoras}h em relação a Brasília` : ''],
          ['Voltagem', inf.voltagem],
          ['DDD do País', inf.ddd],
        ].filter(([,v]) => v);

        for (const [label, value] of fields) {
          children.push(new Paragraph({
            children: [
              new TextRun({ text: `${label}: `, bold: true, size: 18 }),
              new TextRun({ text: value, size: 18 }),
            ],
            spacing: { after: 80 },
          }));
        }

        // Representação brasileira
        const rep = inf.representacao || {};
        if (rep.nome) {
          children.push(new Paragraph({
            children: [new TextRun({ text: 'Representação Brasileira', bold: true, size: 20, color: primary })],
            spacing: { before: 200, after: 80 },
          }));
          for (const [l,v] of [['Nome',rep.nome],['Endereço',rep.endereco],['Telefone',rep.telefone],['Site',rep.link]].filter(([,v])=>v)) {
            if (l === 'Site' && v) {
              children.push(new Paragraph({
                children: [
                  new TextRun({ text: 'Site: ', bold: true, size: 18 }),
                  new ExternalHyperlink({ link: v, children: [new TextRun({ text: v, size: 18, style: 'Hyperlink' })] }),
                ],
                spacing: { after: 60 },
              }));
            } else {
              children.push(new Paragraph({
                children: [new TextRun({ text: `${l}: `, bold: true, size: 18 }), new TextRun({ text: v, size: 18 })],
                spacing: { after: 60 },
              }));
            }
          }
        }

      } else if (segDef.mode === 'simple_list') {
        for (const item of (data.items || [])) {
          if (item.title) {
            children.push(new Paragraph({
              children: [new TextRun({ text: `• ${item.title}`, bold: true, size: 18 })],
              spacing: { before: 120, after: 40 },
            }));
          }
          if (item.description) {
            children.push(new Paragraph({
              children: [new TextRun({ text: item.description, size: 18 })],
              indent: { left: 360 },
              spacing: { after: 80 },
            }));
          }
        }

      } else { // place_list or agenda
        if (data.themeDesc) {
          children.push(new Paragraph({
            children: [new TextRun({ text: data.themeDesc, size: 18, italics: true })],
            spacing: { after: 160 },
          }));
        }

        for (const item of (data.items || [])) {
          if (!item.titulo) continue;

          // Item title + category
          const titleParts = [new TextRun({ text: item.titulo, bold: true, size: 20 })];
          if (item.categoria) titleParts.push(new TextRun({ text: ` · ${item.categoria}`, size: 16, color: '888888' }));
          children.push(new Paragraph({ children: titleParts, spacing: { before: 200, after: 60 } }));

          if (item.descricao) {
            children.push(new Paragraph({
              children: [new TextRun({ text: item.descricao, size: 18 })],
              spacing: { after: 80 },
            }));
          }

          // Details line
          const details = [
            item.endereco   && `📍 ${item.endereco}`,
            item.telefone   && `📞 ${item.telefone}`,
            item.periodo    && `📅 ${item.periodo}`,
          ].filter(Boolean);

          if (details.length) {
            children.push(new Paragraph({
              children: [new TextRun({ text: details.join('   '), size: 16, color: '666666' })],
              spacing: { after: 60 },
            }));
          }

          if (item.site) {
            children.push(new Paragraph({
              children: [
                new TextRun({ text: '🌐 ', size: 16 }),
                new ExternalHyperlink({ link: item.site, children: [new TextRun({ text: item.site, size: 16, style: 'Hyperlink' })] }),
              ],
              spacing: { after: 80 },
            }));
          }

          if (item.observacoes) {
            children.push(new Paragraph({
              children: [new TextRun({ text: `💡 ${item.observacoes}`, size: 16, italics: true, color: '888888' })],
              spacing: { after: 80 },
            }));
          }
        }
      }
    }
  }

  // Footer
  children.push(new Paragraph({
    children: [new TextRun({ text: `Gerado por PRIMETOUR Portal de Dicas · ${new Date().toLocaleDateString('pt-BR')}`, size: 14, color: 'AAAAAA' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 600 },
  }));

  const doc = new Document({ sections: [{ properties: {}, children }] });
  const blob = await Packer.toBlob(doc);
  triggerDownload(blob, filename, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  return { filename };
}

/* ─── PDF ─────────────────────────────────────────────────── */
async function generatePDF({ allTips, segments, areaName, area, colors, filename }) {
  await loadJsPDF();
  const { jsPDF } = window.jspdf;
  const doc      = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const primary  = colors.primary   || '#D4A843';
  const PAGE_W   = 210;
  const MARGIN   = 18;
  const CONTENT  = PAGE_W - MARGIN * 2;
  let y = MARGIN;

  const addPage = () => {
    doc.addPage();
    y = MARGIN;
    addFooter();
  };
  const checkPage = (needed = 10) => { if (y + needed > 280) addPage(); };
  const addFooter = () => {
    const pg = doc.getNumberOfPages();
    doc.setPage(pg);
    doc.setFontSize(8); doc.setTextColor(180);
    doc.text(`PRIMETOUR Portal de Dicas · ${new Date().toLocaleDateString('pt-BR')} · p. ${pg}`,
      PAGE_W / 2, 290, { align: 'center' });
  };

  // Header with area name
  doc.setFillColor(hexToR(colors.secondary||'#1A1A2E'), hexToG(colors.secondary||'#1A1A2E'), hexToB(colors.secondary||'#1A1A2E'));
  doc.rect(0, 0, PAGE_W, 28, 'F');
  doc.setFontSize(16); doc.setFont('helvetica','bold');
  doc.setTextColor(hexToR(primary), hexToG(primary), hexToB(primary));
  doc.text(areaName.toUpperCase(), MARGIN, 17);
  y = 38; addFooter();

  for (const { tip, dest } of allTips) {
    // Destination heading
    checkPage(20);
    doc.setFontSize(14); doc.setFont('helvetica','bold');
    doc.setTextColor(hexToR(colors.secondary||'#1A1A2E'), hexToG(colors.secondary||'#1A1A2E'), hexToB(colors.secondary||'#1A1A2E'));
    doc.text(destLabel(dest), MARGIN, y); y += 5;
    doc.setDrawColor(hexToR(primary), hexToG(primary), hexToB(primary));
    doc.setLineWidth(0.8); doc.line(MARGIN, y, MARGIN + CONTENT, y); y += 8;

    const content = buildContent(tip, segments);

    for (const { segDef, data } of content) {
      checkPage(14);
      // Segment heading
      doc.setFillColor(hexToR(primary), hexToG(primary), hexToB(primary));
      doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
      doc.roundedRect(MARGIN, y - 5, CONTENT, 8, 1, 1, 'F');
      doc.text(segDef.label.toUpperCase(), MARGIN + 4, y); y += 10;
      doc.setTextColor(40,40,40);

      if (segDef.mode === 'special_info') {
        const inf = data.info || {};
        const pairs = [
          ['Descrição', inf.descricao], ['Dica', inf.dica],
          ['População', inf.populacao], ['Moeda', inf.moeda],
          ['Língua', inf.lingua], ['Religião', inf.religiao],
          ['Fuso', inf.fusoSinal && inf.fusoHoras ? `${inf.fusoSinal}${inf.fusoHoras}h` : ''],
          ['Voltagem', inf.voltagem], ['DDD', inf.ddd],
        ].filter(([,v]) => v);

        doc.autoTable({
          startY: y, margin: { left: MARGIN, right: MARGIN },
          head: [], body: pairs,
          styles: { fontSize: 8, cellPadding: 2 },
          columnStyles: { 0: { fontStyle: 'bold', cellWidth: 30 }, 1: { cellWidth: CONTENT - 30 } },
          theme: 'plain',
          didDrawPage: () => { y = doc.lastAutoTable.finalY + 4; addFooter(); },
        });
        y = doc.lastAutoTable.finalY + 6;

      } else if (segDef.mode === 'simple_list') {
        for (const item of (data.items || [])) {
          checkPage(12);
          doc.setFontSize(9); doc.setFont('helvetica','bold');
          doc.text(`• ${item.title||''}`, MARGIN + 3, y); y += 5;
          if (item.description) {
            doc.setFont('helvetica','normal'); doc.setFontSize(8);
            const lines = doc.splitTextToSize(item.description, CONTENT - 8);
            checkPage(lines.length * 4 + 2);
            doc.text(lines, MARGIN + 8, y); y += lines.length * 4 + 2;
          }
        }
        y += 4;

      } else {
        if (data.themeDesc) {
          doc.setFont('helvetica','italic'); doc.setFontSize(8);
          const lines = doc.splitTextToSize(data.themeDesc, CONTENT);
          doc.text(lines, MARGIN, y); y += lines.length * 4 + 4;
        }
        for (const item of (data.items || [])) {
          if (!item.titulo) continue;
          checkPage(20);
          // Item title
          doc.setFont('helvetica','bold'); doc.setFontSize(10);
          doc.setTextColor(hexToR(colors.secondary||'#1A1A2E'), hexToG(colors.secondary||'#1A1A2E'), hexToB(colors.secondary||'#1A1A2E'));
          doc.text(item.titulo, MARGIN + 2, y); y += 5;
          if (item.categoria) {
            doc.setFont('helvetica','italic'); doc.setFontSize(7); doc.setTextColor(120,120,120);
            doc.text(item.categoria, MARGIN + 2, y); y += 4;
          }
          doc.setTextColor(40,40,40);
          if (item.descricao) {
            doc.setFont('helvetica','normal'); doc.setFontSize(8);
            const lines = doc.splitTextToSize(item.descricao, CONTENT - 4);
            checkPage(lines.length * 4 + 2);
            doc.text(lines, MARGIN + 2, y); y += lines.length * 4 + 2;
          }
          const details = [item.endereco&&`📍 ${item.endereco}`, item.telefone&&`📞 ${item.telefone}`, item.periodo&&`📅 ${item.periodo}`].filter(Boolean);
          if (details.length) {
            doc.setFontSize(7.5); doc.setTextColor(100,100,100);
            doc.text(details.join('   '), MARGIN + 2, y); y += 4;
          }
          if (item.site) {
            doc.setFontSize(7.5); doc.setTextColor(hexToR(primary), hexToG(primary), hexToB(primary));
            doc.textWithLink(item.site, MARGIN + 2, y, { url: item.site }); y += 4;
          }
          if (item.observacoes) {
            doc.setFontSize(7.5); doc.setTextColor(130,130,130); doc.setFont('helvetica','italic');
            doc.text(`💡 ${item.observacoes}`, MARGIN + 2, y); y += 4;
          }
          y += 3;
          doc.setDrawColor(220,220,220); doc.line(MARGIN + 2, y, MARGIN + CONTENT - 2, y); y += 3;
        }
      }
    }
    y += 10;
  }

  doc.save(filename);
  return { filename };
}

/* ─── PPTX ────────────────────────────────────────────────── */
async function generatePptx({ allTips, segments, areaName, area, colors, filename }) {
  await loadPptxGenJS();
  const pptx    = new window.PptxGenJS();
  const primary = colors.primary   || '#D4A843';
  const bg      = colors.secondary || '#1A1A2E';

  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'PRIMETOUR Portal de Dicas';

  // Cover slide
  const cover = pptx.addSlide();
  cover.background = { color: bg.replace('#','') };
  cover.addText(areaName.toUpperCase(), {
    x:0.5, y:2.5, w:12, h:0.8,
    fontSize: 32, bold: true, color: primary.replace('#',''), align: 'center',
  });
  cover.addText('Portal de Dicas', {
    x:0.5, y:3.4, w:12, h:0.5,
    fontSize: 16, color: 'FFFFFF', align: 'center',
  });
  cover.addText(new Date().toLocaleDateString('pt-BR'), {
    x:0.5, y:6.8, w:12, h:0.3,
    fontSize: 10, color: '888888', align: 'center',
  });

  for (const { tip, dest } of allTips) {
    const label = destLabel(dest);

    // Destination slide
    const destSlide = pptx.addSlide();
    destSlide.background = { color: bg.replace('#','') };
    destSlide.addText(label, {
      x:0.5, y:2.8, w:12, h:1.2,
      fontSize: 36, bold: true, color: primary.replace('#',''), align: 'center',
    });

    const content = buildContent(tip, segments);

    for (const { segDef, data } of content) {
      const slide = pptx.addSlide();
      slide.background = { color: 'FFFFFF' };

      // Header bar
      slide.addShape(pptx.ShapeType.rect, {
        x:0, y:0, w:13.33, h:0.8,
        fill: { color: bg.replace('#','') },
      });
      slide.addText(segDef.label.toUpperCase(), {
        x:0.3, y:0.1, w:9, h:0.6,
        fontSize: 14, bold: true, color: 'FFFFFF',
      });
      slide.addText(label, {
        x:9.5, y:0.1, w:3.5, h:0.6,
        fontSize: 9, color: primary.replace('#',''), align: 'right',
      });

      let textContent = '';

      if (segDef.mode === 'special_info') {
        const inf = data.info || {};
        const pairs = [
          ['Descrição', inf.descricao], ['Moeda', inf.moeda],
          ['Língua', inf.lingua], ['Fuso', inf.fusoSinal && inf.fusoHoras ? `${inf.fusoSinal}${inf.fusoHoras}h` : ''],
          ['Voltagem', inf.voltagem], ['DDD', inf.ddd],
        ].filter(([,v]) => v);

        const rows = pairs.map(([l,v]) => [
          { text: l+':', options: { bold: true, fontSize: 10 } },
          { text: v, options: { fontSize: 10 } },
        ]);
        if (rows.length) {
          slide.addTable(rows, {
            x:0.3, y:1, w:12.7, h:5,
            colW:[2.5,10],
            border: { type:'none' },
            fill: { type:'none' },
          });
        }

      } else if (segDef.mode === 'simple_list') {
        const items = (data.items || []).slice(0, 8);
        textContent = items.map(i => `• ${i.title}${i.description ? '\n   ' + i.description.slice(0,100) : ''}`).join('\n');
        slide.addText(textContent, { x:0.3, y:1, w:12.7, h:5.5, fontSize: 11, valign: 'top', wrap: true });

      } else {
        const items = (data.items || []).slice(0, 4);
        if (data.themeDesc) {
          slide.addText(data.themeDesc.slice(0,200), { x:0.3, y:0.9, w:12.7, h:0.6, fontSize: 9, italic: true, color: '666666' });
        }
        const startY = data.themeDesc ? 1.6 : 1;
        const colW   = items.length <= 2 ? 6 : 3.1;
        const cols   = items.length <= 2 ? 2 : 4;
        items.forEach((item, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const x   = 0.3 + col * (colW + 0.2);
          const y   = startY + row * 2.4;
          slide.addShape(pptx.ShapeType.rect, {
            x, y, w:colW, h:2.2,
            fill: { color: 'F8F9FA' },
            line: { color: 'EEEEEE', width: 0.5 },
          });
          slide.addText(item.titulo, { x:x+0.1, y:y+0.1, w:colW-0.2, h:0.45, fontSize: 10, bold: true, color: bg.replace('#',''), wrap:true });
          if (item.categoria) slide.addText(item.categoria, { x:x+0.1, y:y+0.55, w:colW-0.2, h:0.25, fontSize: 7.5, italic:true, color:'999999' });
          if (item.descricao) slide.addText(item.descricao.slice(0,140), { x:x+0.1, y:y+0.8, w:colW-0.2, h:1.1, fontSize: 8, color:'444444', wrap:true });
          if (item.site) slide.addText(item.site, { x:x+0.1, y:y+1.92, w:colW-0.2, h:0.22, fontSize: 7, color: primary.replace('#',''), hyperlink:{ url:item.site } });
        });
        if (data.items?.length > 4) {
          slide.addText(`+ ${data.items.length - 4} itens adicionais`, {
            x:0.3, y:6.3, w:12.7, h:0.3, fontSize:9, italic:true, color:'888888', align:'center',
          });
        }
      }

      // Footer
      slide.addText(`PRIMETOUR Portal de Dicas · ${new Date().toLocaleDateString('pt-BR')}`, {
        x:0, y:7.15, w:13.33, h:0.35,
        fontSize: 8, color: 'AAAAAA', align: 'center',
      });
    }
  }

  await pptx.writeFile({ fileName: filename });
  return { filename };
}

/* ─── Web Link ────────────────────────────────────────────── */
async function generateWebLink({ allTips, segments, areaName, area, colors }) {
  const token  = generateToken();
  const ref    = doc(collection(db, 'portal_web_links'), token);
  await setDoc(ref, {
    token,
    allTips:   allTips.map(({ tip, dest }) => ({ tipId: tip?.id || null, destId: dest?.id || null })),
    tipData:   allTips.map(({ tip, dest }) => ({ tip, dest })),
    segments,
    areaName,
    areaLogoUrl: area?.logoUrl || null,
    colors,
    createdAt: serverTimestamp(),
    views: 0,
  });

  const baseUrl = window.location.origin + window.location.pathname.replace(/index\.html$/, '');
  const url     = `${baseUrl}portal-view.html#${token}`;
  return { url, token };
}

function generateToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => chars[b % chars.length]).join('');
}

function triggerDownload(blob, filename, mimeType) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ─── Color helpers ───────────────────────────────────────── */
function hexToDocxColor(hex) { return hex.replace('#',''); }
function hexToR(hex) { return parseInt(hex.replace('#','').slice(0,2), 16); }
function hexToG(hex) { return parseInt(hex.replace('#','').slice(2,4), 16); }
function hexToB(hex) { return parseInt(hex.replace('#','').slice(4,6), 16); }
