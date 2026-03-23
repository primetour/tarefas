/**
 * PRIMETOUR — Portal de Dicas: Motor de Geração
 * Converte dados de dica + área em .docx, .pdf, .pptx ou link web
 */

import { SEGMENTS, MONTHS, recordGeneration, registerDownload, fetchImages } from './portal.js';
import { store } from '../store.js';
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
export async function generateTip({ tip, area, dest, segments, format, extraTips = [], imagesOverride = {} }) {
  const allTips  = [{ tip, dest }, ...extraTips];
  const areaName = area?.name || 'PRIMETOUR';
  const colors   = area?.colors || { primary: '#D4A843', secondary: '#1A1A2E' };
  const filename = buildFilename(allTips, format);

  // Resolve images for every format (not just web)
  const imagesByDest = {};
  for (const { dest: d } of allTips) {
    if (d?.id) {
      imagesByDest[d.id] = await resolveImages(d);
      // Apply manual overrides
      const overrides = imagesOverride[d.id] || {};
      if (Object.keys(overrides).length) {
        const ov = [];
        for (const [segKey, items] of Object.entries(overrides)) {
          for (const [idxStr, imgData] of Object.entries(items)) {
            ov.push({ url: imgData.url, name: imgData.name||'', placeName: `__override_${segKey}_${idxStr}`,
              tags: [], _override: true, _segKey: segKey, _itemIdx: Number(idxStr) });
          }
        }
        imagesByDest[d.id].gallery = [...ov, ...(imagesByDest[d.id].gallery||[])];
        imagesByDest[d.id]._overrides = overrides;
      }
    }
  }

  switch (format) {
    case 'docx': return generateDocx({ allTips, segments, areaName, area, colors, filename, imagesByDest });
    case 'pdf':  return generatePDF({ allTips, segments, areaName, area, colors, filename, imagesByDest });
    case 'pptx': return generatePptx({ allTips, segments, areaName, area, colors, filename, imagesByDest });
    case 'web':  return generateWebLink({ allTips, segments, areaName, area, colors, format, imagesOverride });
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

/* ─── Image picker helper (shared by all formats) ─────────── */
function pickImg(item, idx, imgs, segKey) {
  if (!imgs) return null;
  const overrides = imgs._overrides || {};
  const ovKey = segKey;
  if (ovKey && overrides[ovKey]) {
    const ov = overrides[ovKey][idx] || overrides[ovKey][String(idx)];
    if (ov?.url) return ov.url;
  }
  const gallery = imgs.gallery || [];
  const title   = (item?.titulo || item?.title || '').toLowerCase().trim();
  // placeName exact
  let m = gallery.find(g => g.placeName && g.placeName.toLowerCase().trim() === title);
  // placeName partial
  if (!m) m = gallery.find(g => g.placeName &&
    (title.includes(g.placeName.toLowerCase()) || g.placeName.toLowerCase().includes(title.slice(0,15))));
  // name/tag keywords
  if (!m) {
    const words = title.split(/\s+/).filter(w => w.length > 3);
    m = gallery.find(g => words.some(w => g.name?.toLowerCase().includes(w)));
  }
  // cyclic fallback
  if (!m) m = gallery[idx % Math.max(gallery.length, 1)];
  return m?.url || null;
}

/* Fetch image as base64 for embedding in docx/pdf/pptx */
async function imgToBase64(url) {
  if (!url) return null;
  try {
    // Route through R2 Worker to get CORS headers
    const R2_WORKER = 'https://primetour-images.rene-castro.workers.dev';
    const proxyUrl  = `${R2_WORKER}?url=${encodeURIComponent(url)}`;
    const res  = await fetch(proxyUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload  = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch { return null; }
}

function base64Data(dataUrl) {
  return dataUrl ? dataUrl.split(',')[1] : null;
}
function base64Ext(dataUrl) {
  const m = dataUrl?.match(/data:image\/([a-zA-Z+]+);/);
  return m ? m[1].replace('jpeg','jpg').replace('+xml','') : 'jpg';
}

async function generateDocx({ allTips, segments, areaName, area, colors, filename, imagesByDest = {} }) {
  await loadDocx();
  const { Document, Packer, Paragraph, TextRun, AlignmentType,
    ExternalHyperlink, BorderStyle, Table, TableRow, TableCell,
    WidthType, PageBreak, ImageRun } = window.docx;

  const gold = (colors.primary   || '#D4AF37').replace('#','');
  const navy = (colors.secondary || '#242362').replace('#','');
  const children = [];
  const date = new Date().toLocaleDateString('pt-BR',{year:'numeric',month:'long',day:'numeric'});

  // Helper: fetch image as ArrayBuffer for docx ImageRun
  const fetchImgBuffer = async (url) => {
    if (!url) return null;
    try {
      const res  = await fetch(url);
      const buf  = await res.arrayBuffer();
      return buf;
    } catch { return null; }
  };

  // Cover
  children.push(new Paragraph({children:[new TextRun({text:areaName.toUpperCase(),bold:true,size:52,color:gold,characterSpacing:200})],alignment:AlignmentType.CENTER,spacing:{before:2400,after:160}}));
  children.push(new Paragraph({children:[new TextRun({text:'PORTAL DE DICAS',size:18,color:'888888',characterSpacing:300})],alignment:AlignmentType.CENTER,spacing:{after:600}}));
  for(const{dest}of allTips) children.push(new Paragraph({children:[new TextRun({text:destLabel(dest),bold:true,size:28,color:navy})],alignment:AlignmentType.CENTER,spacing:{after:120}}));
  children.push(new Paragraph({children:[new TextRun({text:'─────────────────────────',color:gold,size:16})],alignment:AlignmentType.CENTER,spacing:{before:400,after:200}}));
  children.push(new Paragraph({children:[new TextRun({text:date,size:16,color:'AAAAAA'})],alignment:AlignmentType.CENTER}));
  children.push(new Paragraph({children:[new PageBreak()]}));

  for(const{tip,dest}of allTips){
    const imgs=imagesByDest[dest?.id]||{};
    const label=destLabel(dest);

    // Hero image if available
    const heroBuffer = await fetchImgBuffer(imgs.hero);
    if(heroBuffer){
      children.push(new Paragraph({
        children:[new ImageRun({data:heroBuffer,transformation:{width:530,height:250},type:'jpg'})],
        alignment:AlignmentType.CENTER,
        spacing:{before:0,after:200},
      }));
    }

    children.push(new Paragraph({children:[new TextRun({text:label.toUpperCase(),bold:true,size:32,color:navy,characterSpacing:120})],spacing:{before:heroBuffer?100:400,after:80},border:{bottom:{style:BorderStyle.SINGLE,size:12,color:gold}}}));
    children.push(new Paragraph({spacing:{after:200}}));

    const content=buildContent(tip,segments);
    for(const{segDef,data}of content){
      children.push(new Paragraph({children:[new TextRun({text:segDef.label.toUpperCase(),bold:true,size:16,color:gold,characterSpacing:250})],spacing:{before:360,after:40},border:{left:{style:BorderStyle.SINGLE,size:18,color:gold}},indent:{left:120}}));
      children.push(new Paragraph({spacing:{after:100}}));

      if(segDef.mode==='special_info'){
        const inf=data.info||{};
        const fields=[['Descrição',inf.descricao],['Dica',inf.dica],['População',inf.populacao],['Moeda',inf.moeda],['Língua oficial',inf.lingua],['Religião',inf.religiao],['Fuso horário',inf.fusoSinal&&inf.fusoHoras?`${inf.fusoSinal}${inf.fusoHoras}h de Brasília`:''],['Voltagem',inf.voltagem],['DDD',inf.ddd]].filter(([,v])=>v);
        if(fields.length){
          const rows=[];
          for(let i=0;i<fields.length;i+=2){
            const pair=fields.slice(i,i+2);
            rows.push(new TableRow({children:[...pair,...(pair.length<2?[null]:[])].map(f=>f?new TableCell({width:{size:4500,type:WidthType.DXA},borders:{top:{style:BorderStyle.NONE},bottom:{style:BorderStyle.SINGLE,size:4,color:'EEEEEE'},left:{style:BorderStyle.NONE},right:{style:BorderStyle.NONE}},children:[new Paragraph({children:[new TextRun({text:f[0].toUpperCase(),size:14,color:gold,bold:true,characterSpacing:150})],spacing:{after:20}}),new Paragraph({children:[new TextRun({text:f[1],size:18,color:navy})],spacing:{after:80}})]}):new TableCell({width:{size:4500,type:WidthType.DXA},borders:{top:{style:BorderStyle.NONE},bottom:{style:BorderStyle.NONE},left:{style:BorderStyle.NONE},right:{style:BorderStyle.NONE}},children:[]}))}));
          }
          children.push(new Table({rows,width:{size:9000,type:WidthType.DXA}}));
          children.push(new Paragraph({spacing:{after:160}}));
        }
        const rep=inf.representacao||{};
        if(rep.nome){
          children.push(new Paragraph({children:[new TextRun({text:'REPRESENTAÇÃO BRASILEIRA',size:14,bold:true,color:gold,characterSpacing:200})],spacing:{before:200,after:60}}));
          for(const[l,v]of[['Nome',rep.nome],['Endereço',rep.endereco],['Telefone',rep.telefone],['Site',rep.link]].filter(([,v])=>v)){
            if(l==='Site') children.push(new Paragraph({children:[new TextRun({text:`${l}: `,bold:true,size:18,color:navy}),new ExternalHyperlink({link:v,children:[new TextRun({text:v,size:18,style:'Hyperlink',color:gold})]})],spacing:{after:60}}));
            else children.push(new Paragraph({children:[new TextRun({text:`${l}: `,bold:true,size:18,color:navy}),new TextRun({text:v,size:18,color:'474650'})],spacing:{after:60}}));
          }
        }
      } else if(segDef.mode==='simple_list'){
        for(const item of(data.items||[])){
          if(!item.title)continue;
          children.push(new Paragraph({children:[new TextRun({text:item.title,bold:true,size:20,color:navy})],spacing:{before:160,after:40},bullet:{level:0}}));
          if(item.description) children.push(new Paragraph({children:[new TextRun({text:item.description,size:18,color:'474650'})],spacing:{after:80},indent:{left:360}}));
        }
      } else {
        if(data.themeDesc) children.push(new Paragraph({children:[new TextRun({text:data.themeDesc,size:18,italics:true,color:'474650'})],spacing:{after:160}}));

        for(let itemIdx=0;itemIdx<(data.items||[]).length;itemIdx++){
          const item=data.items[itemIdx];
          if(!item.titulo)continue;

          // Image
          const imgUrl=pickImg(item,itemIdx,imgs,segDef.key);
          const imgBuffer=await fetchImgBuffer(imgUrl);

          if(item.categoria) children.push(new Paragraph({children:[new TextRun({text:item.categoria.toUpperCase(),size:13,color:gold,bold:true,characterSpacing:200})],spacing:{before:240,after:20}}));
          children.push(new Paragraph({children:[new TextRun({text:item.titulo,bold:true,size:22,color:navy})],spacing:{after:imgBuffer?80:60}}));

          if(imgBuffer){
            children.push(new Paragraph({
              children:[new ImageRun({data:imgBuffer,transformation:{width:400,height:200},type:'jpg'})],
              spacing:{after:120},
            }));
          }

          if(item.descricao) children.push(new Paragraph({children:[new TextRun({text:item.descricao,size:18,color:'474650'})],spacing:{after:80}}));
          const det=[item.endereco&&`📍 ${item.endereco}`,item.telefone&&`📞 ${item.telefone}`].filter(Boolean);
          if(det.length) children.push(new Paragraph({children:[new TextRun({text:det.join('   '),size:16,color:'888888'})],spacing:{after:60}}));
          if(item.site) children.push(new Paragraph({children:[new TextRun({text:'🌐 ',size:16}),new ExternalHyperlink({link:item.site,children:[new TextRun({text:item.site,size:16,style:'Hyperlink',color:gold})]})],spacing:{after:60}}));
          if(item.observacoes) children.push(new Paragraph({children:[new TextRun({text:`💡 ${item.observacoes}`,size:16,italics:true,color:'AAAAAA'})],spacing:{after:80}}));
          children.push(new Paragraph({border:{bottom:{style:BorderStyle.SINGLE,size:2,color:'EEEEEE'}},spacing:{after:80}}));
        }
      }
    }
    children.push(new Paragraph({children:[new PageBreak()]}));
  }

  const doc = new Document({sections:[{properties:{},children}]});
  const blob = await Packer.toBlob(doc);
  triggerDownload(blob, filename, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  return { filename };
}

/* ─── PDF ─────────────────────────────────────────────────── */
async function generatePDF({ allTips, segments, areaName, area, colors, filename, imagesByDest = {} }) {
  await loadJsPDF();
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const primary=colors.primary||'#D4AF37', second=colors.secondary||'#242362';
  const PAGE_W=210,MARGIN=16,CONTENT=210-16*2;
  let y=MARGIN;
  const pR=hexToR(primary),pG=hexToG(primary),pB=hexToB(primary);
  const sR=hexToR(second), sG=hexToG(second), sB=hexToB(second);

  const addPage=()=>{doc.addPage();y=MARGIN;addFooter();};
  const checkPage=(n=10)=>{if(y+n>282)addPage();};
  const addFooter=()=>{
    const pg=doc.getNumberOfPages(); doc.setPage(pg);
    doc.setDrawColor(pR,pG,pB); doc.setLineWidth(0.3);
    doc.line(MARGIN,288,PAGE_W-MARGIN,288);
    doc.setFontSize(7); doc.setTextColor(180,180,180);
    doc.text(`${areaName.toUpperCase()}  ·  Portal de Dicas  ·  ${new Date().toLocaleDateString('pt-BR')}  ·  p.${pg}`,PAGE_W/2,293,{align:'center'});
  };

  // Cover
  doc.setFillColor(sR,sG,sB); doc.rect(0,0,PAGE_W,297,'F');
  doc.setFillColor(pR,pG,pB); doc.rect(MARGIN,108,CONTENT,0.8,'F');
  doc.setFontSize(28);doc.setFont('helvetica','bold');doc.setTextColor(pR,pG,pB);
  doc.text(areaName.toUpperCase(),PAGE_W/2,100,{align:'center',charSpace:3});
  doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(255,255,255);
  doc.text('PORTAL DE DICAS',PAGE_W/2,91,{align:'center',charSpace:2});
  let dY=124;
  for(const{dest}of allTips){
    doc.setFontSize(14);doc.setFont('helvetica','bold');doc.setTextColor(255,255,255);
    doc.text(destLabel(dest),PAGE_W/2,dY,{align:'center'});dY+=10;
  }
  doc.setFontSize(8);doc.setFont('helvetica','normal');doc.setTextColor(pR,pG,pB);
  doc.text(new Date().toLocaleDateString('pt-BR',{year:'numeric',month:'long'}),PAGE_W/2,dY+14,{align:'center'});
  doc.addPage();y=MARGIN;addFooter();

  for(const{tip,dest}of allTips){
    const imgs=imagesByDest[dest?.id]||{};

    // Hero image page if available
    const heroB64=await imgToBase64(imgs.hero);
    if(heroB64){
      doc.setFillColor(sR,sG,sB); doc.rect(0,0,PAGE_W,297,'F');
      try{doc.addImage(heroB64,'JPEG',0,0,PAGE_W,180,undefined,'FAST');}catch(e){}
      // Dark gradient overlay at bottom
      doc.setFillColor(sR,sG,sB); doc.setGState(doc.GState({opacity:.75}));
      doc.rect(0,155,PAGE_W,142,'F'); doc.setGState(doc.GState({opacity:1}));
      // Gold bar
      doc.setFillColor(pR,pG,pB); doc.rect(MARGIN,210,40,0.8,'F');
      doc.setFontSize(24);doc.setFont('helvetica','bold');doc.setTextColor(255,255,255);
      doc.text(destLabel(dest),MARGIN,225);
      doc.addPage();y=MARGIN;addFooter();
    }

    // Destination heading
    checkPage(24);
    doc.setFontSize(16);doc.setFont('helvetica','bold');doc.setTextColor(sR,sG,sB);
    doc.text(destLabel(dest).toUpperCase(),MARGIN,y);y+=2;
    doc.setFillColor(pR,pG,pB);doc.rect(MARGIN,y,CONTENT,0.6,'F');y+=8;

    const content=buildContent(tip,segments);
    for(const{segDef,data}of content){
      checkPage(18);
      // Segment heading
      doc.setFillColor(pR,pG,pB);doc.rect(MARGIN,y-4,2.5,8,'F');
      doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(pR,pG,pB);
      doc.text(segDef.label.toUpperCase(),MARGIN+5,y,{charSpace:1});y+=9;
      doc.setTextColor(40,40,40);

      if(segDef.mode==='special_info'){
        const inf=data.info||{};
        const pairs=[['Descrição',inf.descricao],['Dica',inf.dica],['População',inf.populacao],
          ['Moeda',inf.moeda],['Língua',inf.lingua],['Religião',inf.religiao],
          ['Fuso',inf.fusoSinal&&inf.fusoHoras?`${inf.fusoSinal}${inf.fusoHoras}h`:''],
          ['Voltagem',inf.voltagem],['DDD',inf.ddd]].filter(([,v])=>v);
        const cW=(CONTENT-4)/2;
        for(let i=0;i<pairs.length;i+=2){
          checkPage(14);
          const left=pairs[i],right=pairs[i+1];
          doc.setFillColor(248,247,244);doc.rect(MARGIN,y-3,cW,11,'F');
          doc.setFontSize(6);doc.setFont('helvetica','bold');doc.setTextColor(pR,pG,pB);
          doc.text(left[0].toUpperCase(),MARGIN+2,y,{charSpace:0.8});
          doc.setFontSize(8);doc.setFont('helvetica','normal');doc.setTextColor(sR,sG,sB);
          doc.text(String(left[1]).slice(0,45),MARGIN+2,y+4.5);
          if(right){
            doc.setFillColor(248,247,244);doc.rect(MARGIN+cW+4,y-3,cW,11,'F');
            doc.setFontSize(6);doc.setFont('helvetica','bold');doc.setTextColor(pR,pG,pB);
            doc.text(right[0].toUpperCase(),MARGIN+cW+6,y,{charSpace:0.8});
            doc.setFontSize(8);doc.setFont('helvetica','normal');doc.setTextColor(sR,sG,sB);
            doc.text(String(right[1]).slice(0,45),MARGIN+cW+6,y+4.5);
          }
          y+=13;
        }
        const rep=inf.representacao||{};
        if(rep.nome){
          checkPage(20);
          doc.setFontSize(6);doc.setFont('helvetica','bold');doc.setTextColor(pR,pG,pB);
          doc.text('REPRESENTAÇÃO BRASILEIRA',MARGIN+2,y,{charSpace:0.8});y+=5;
          for(const[l,v]of[['Nome',rep.nome],['Endereço',rep.endereco],['Telefone',rep.telefone]].filter(([,v])=>v)){
            doc.setFontSize(8);doc.setFont('helvetica','bold');doc.setTextColor(sR,sG,sB);
            doc.text(`${l}: `,MARGIN+2,y);
            doc.setFont('helvetica','normal');doc.setTextColor(70,70,80);
            doc.text(v,MARGIN+2+doc.getTextWidth(`${l}: `),y);y+=5;
          }
        }
      } else if(segDef.mode==='simple_list'){
        for(const item of(data.items||[])){
          checkPage(12);
          doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(sR,sG,sB);
          doc.setFillColor(pR,pG,pB);doc.circle(MARGIN+1.5,y-1,1,'F');
          doc.text(item.title||'',MARGIN+5,y);y+=5;
          if(item.description){doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(70,70,80);
            const lines=doc.splitTextToSize(item.description,CONTENT-8);checkPage(lines.length*4+2);
            doc.text(lines,MARGIN+8,y);y+=lines.length*4+2;}
        }
        y+=4;
      } else {
        if(data.themeDesc){doc.setFont('helvetica','italic');doc.setFontSize(8);doc.setTextColor(100,100,100);
          const lines=doc.splitTextToSize(data.themeDesc,CONTENT);doc.text(lines,MARGIN,y);y+=lines.length*4+4;}

        for(let itemIdx=0;itemIdx<(data.items||[]).length;itemIdx++){
          const item=data.items[itemIdx];
          if(!item.titulo)continue;

          // Try to embed image — up to 55mm wide on the right
          const imgUrl=pickImg(item,itemIdx,imgs,segDef.key);
          const imgB64=await imgToBase64(imgUrl);
          const IMG_W=55, IMG_H=38;
          const textW=imgB64 ? CONTENT-IMG_W-4 : CONTENT;
          checkPage(imgB64?IMG_H+6:22);

          const blockStartY=y;
          if(item.categoria){doc.setFontSize(6);doc.setFont('helvetica','bold');doc.setTextColor(pR,pG,pB);
            doc.text(item.categoria.toUpperCase(),MARGIN+2,y,{charSpace:0.8});y+=4;}
          doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(sR,sG,sB);
          doc.text(item.titulo,MARGIN+2,y);y+=5;
          if(item.descricao){doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(70,70,80);
            const lines=doc.splitTextToSize(item.descricao,textW-4);
            checkPage(lines.length*4+2);doc.text(lines,MARGIN+2,y);y+=lines.length*4+2;}
          const det=[item.endereco&&`📍 ${item.endereco}`,item.telefone&&`📞 ${item.telefone}`].filter(Boolean);
          if(det.length){doc.setFontSize(7.5);doc.setTextColor(130,130,130);doc.text(det.join('   '),MARGIN+2,y);y+=4;}
          if(item.site){doc.setFontSize(7.5);doc.setTextColor(pR,pG,pB);doc.textWithLink('🌐 '+item.site,MARGIN+2,y,{url:item.site});y+=4;}
          if(item.observacoes){doc.setFontSize(7.5);doc.setTextColor(160,160,160);doc.setFont('helvetica','italic');
            doc.text(`💡 ${item.observacoes}`,MARGIN+2,y);y+=4;}

          // Place image to the right of the block
          if(imgB64){
            const imgX=MARGIN+textW+2;
            const imgY=blockStartY-4;
            try{doc.addImage(imgB64,'JPEG',imgX,imgY,IMG_W,IMG_H,undefined,'FAST');}catch(e){}
            // Gold border
            doc.setDrawColor(pR,pG,pB);doc.setLineWidth(0.4);
            doc.rect(imgX,imgY,IMG_W,IMG_H);
            if(y < imgY+IMG_H+2) y=imgY+IMG_H+2;
          }

          doc.setDrawColor(235,235,235);doc.setLineWidth(0.2);
          doc.line(MARGIN+2,y,MARGIN+CONTENT-2,y);y+=4;
        }
      }
      y+=4;
    }
    doc.addPage();y=MARGIN;addFooter();
  }
  const pgCount=doc.getNumberOfPages();if(pgCount>1)doc.deletePage(pgCount);
  doc.save(filename);
  return { filename };
}

/* ─── PPTX ────────────────────────────────────────────────── */
async function generatePptx({ allTips, segments, areaName, area, colors, filename, imagesByDest = {} }) {
  await loadPptxGenJS();
  const pptx   = new window.PptxGenJS();
  const primary= colors.primary   || '#D4AF37';
  const bgColor= colors.secondary || '#242362';
  const pHex   = primary.replace('#','');
  const bgHex  = bgColor.replace('#','');
  const W=13.33, H=7.5;
  const date=new Date().toLocaleDateString('pt-BR',{year:'numeric',month:'long'});
  pptx.layout='LAYOUT_WIDE'; pptx.author='PRIMETOUR Portal de Dicas';

  // Cover
  const cover=pptx.addSlide(); cover.background={color:bgHex};
  cover.addShape(pptx.ShapeType.rect,{x:1.5,y:3.55,w:W-3,h:0.04,fill:{color:pHex},line:{type:'none'}});
  cover.addText('PORTAL DE DICAS',{x:0.5,y:1.7,w:W-1,h:0.4,fontSize:10,color:'AAAAAA',align:'center',charSpacing:3});
  cover.addText(areaName.toUpperCase(),{x:0.5,y:2.2,w:W-1,h:1.1,fontSize:38,bold:true,color:pHex,align:'center',charSpacing:4});
  cover.addText(allTips.map(({dest})=>destLabel(dest)).join('  ·  '),{x:0.5,y:3.8,w:W-1,h:0.6,fontSize:16,bold:true,color:'FFFFFF',align:'center'});
  cover.addText(date,{x:0.5,y:H-0.6,w:W-1,h:0.35,fontSize:9,color:pHex,align:'center'});

  for (const { tip, dest } of allTips) {
    const label = destLabel(dest);
    const imgs  = imagesByDest[dest?.id] || {};
    const [city] = label.split(',');

    // Destination slide — with hero image if available
    const heroUrl = imgs.hero;
    const heroB64 = await imgToBase64(heroUrl);
    const ds=pptx.addSlide(); ds.background={color:bgHex};
    if (heroB64) {
      ds.addImage({ data: heroB64, x:0, y:0, w:W, h:H, sizing:{type:'cover',w:W,h:H} });
      ds.addShape(pptx.ShapeType.rect,{x:0,y:H*0.5,w:W,h:H*0.5,fill:{color:bgHex,transparency:35},line:{type:'none'}});
    }
    ds.addShape(pptx.ShapeType.rect,{x:0,y:H-1.6,w:0.08,h:1.2,fill:{color:pHex},line:{type:'none'}});
    ds.addText(city.trim(),{x:0.22,y:H-1.6,w:W-0.5,h:0.9,fontSize:42,bold:true,color:'FFFFFF',charSpacing:1});
    if (label.includes(',')) ds.addText(label.split(',').slice(1).join(',').trim().toUpperCase(),
      {x:0.22,y:H-0.75,w:W-0.5,h:0.4,fontSize:10,color:pHex,charSpacing:3});

    const content = buildContent(tip, segments);

    for (const { segDef, data } of content) {
      const slide=pptx.addSlide(); slide.background={color:'FFFFFF'};
      // Header bar
      slide.addShape(pptx.ShapeType.rect,{x:0,y:0,w:W,h:0.72,fill:{color:bgHex},line:{type:'none'}});
      slide.addShape(pptx.ShapeType.rect,{x:0,y:0,w:0.08,h:0.72,fill:{color:pHex},line:{type:'none'}});
      slide.addText(segDef.label.toUpperCase(),{x:0.25,y:0.08,w:8,h:0.56,fontSize:13,bold:true,color:'FFFFFF',charSpacing:2});
      slide.addText(label,{x:8.5,y:0.08,w:4.5,h:0.56,fontSize:9,color:pHex,align:'right'});
      // Footer
      slide.addShape(pptx.ShapeType.rect,{x:0,y:H-0.3,w:W,h:0.3,fill:{color:'F8F7F4'},line:{type:'none'}});
      slide.addText(`PRIMETOUR  ·  Portal de Dicas  ·  ${date}`,{x:0.3,y:H-0.25,w:W-0.6,h:0.22,fontSize:7,color:'AAAAAA',align:'center'});

      if (segDef.mode==='special_info') {
        const inf=data.info||{};
        const pairs=[['Descrição',inf.descricao],['Moeda',inf.moeda],['Língua',inf.lingua],
          ['Fuso',inf.fusoSinal&&inf.fusoHoras?`${inf.fusoSinal}${inf.fusoHoras}h`:''],
          ['Voltagem',inf.voltagem],['DDD',inf.ddd],['Religião',inf.religiao],['População',inf.populacao]].filter(([,v])=>v);
        const cW=3.0,cH=1.4,gX=0.12,gY=0.12,sX=0.3,sY=0.9;
        pairs.slice(0,8).forEach(([l,v],i)=>{
          const col=i%4,row=Math.floor(i/4),x=sX+col*(cW+gX),y=sY+row*(cH+gY);
          slide.addShape(pptx.ShapeType.rect,{x,y,w:cW,h:cH,fill:{color:'F8F7F4'},line:{color:'EEEEEE',width:0.5}});
          slide.addText(l.toUpperCase(),{x:x+0.1,y:y+0.12,w:cW-0.2,h:0.28,fontSize:6,bold:true,color:pHex,charSpacing:1});
          slide.addText(String(v).slice(0,60),{x:x+0.1,y:y+0.42,w:cW-0.2,h:0.88,fontSize:9,color:bgHex,wrap:true,valign:'top'});
        });

      } else if (segDef.mode==='simple_list') {
        const items=(data.items||[]).slice(0,10);
        slide.addText(items.map(i=>({text:`${i.title||''}${i.description?'\n'+i.description.slice(0,80):''}`,
          options:{bullet:{type:'bullet'},fontSize:10,color:'333333',paraSpaceAfter:6}})),
          {x:0.3,y:0.9,w:W-0.6,h:H-1.4});

      } else {
        const items=(data.items||[]).slice(0,4);
        if(data.themeDesc) slide.addText(data.themeDesc.slice(0,180),
          {x:0.3,y:0.85,w:W-0.6,h:0.45,fontSize:8,italic:true,color:'888888'});

        const sY=data.themeDesc?1.38:0.88;
        const cols=items.length<=2?2:4;
        const cW=items.length<=2?(W-0.8)/2:(W-0.8)/4;
        const cH=H-sY-0.4;

        await Promise.all(items.map(async (item,i) => {
          const x=0.3+i*(cW+0.08);
          const imgUrl = pickImg(item, i, imgs, segDef.key);
          const imgB64 = await imgToBase64(imgUrl);

          if (imgB64) {
            // Image fills top ~55% of card
            const imgH = cH * 0.52;
            slide.addShape(pptx.ShapeType.rect,{x,y:sY,w:cW,h:cH,fill:{color:'FFFFFF'},line:{color:'E5E7EB',width:0.5}});
            slide.addImage({ data: imgB64, x, y:sY, w:cW, h:imgH, sizing:{type:'cover',w:cW,h:imgH} });
            // Gold top accent
            slide.addShape(pptx.ShapeType.rect,{x,y:sY,w:cW,h:0.05,fill:{color:pHex},line:{type:'none'}});
            const tY = sY + imgH + 0.1;
            if(item.categoria) slide.addText(item.categoria.toUpperCase(),
              {x:x+0.1,y:tY,w:cW-0.2,h:0.25,fontSize:5.5,bold:true,color:pHex,charSpacing:1});
            slide.addText(item.titulo,{x:x+0.1,y:tY+(item.categoria?0.27:0),w:cW-0.2,h:0.5,
              fontSize:cols===2?11:9.5,bold:true,color:bgHex,wrap:true});
            if(item.descricao){
              const dY=tY+(item.categoria?0.27:0)+0.52;
              slide.addText(item.descricao.slice(0,cols===2?130:70),
                {x:x+0.1,y:dY,w:cW-0.2,h:sY+cH-dY-0.35,fontSize:cols===2?8:7,color:'555555',wrap:true,valign:'top'});
            }
          } else {
            // No image — text-only card
            slide.addShape(pptx.ShapeType.rect,{x,y:sY,w:cW,h:cH,fill:{color:'F8F7F4'},line:{color:'E5E7EB',width:0.5}});
            slide.addShape(pptx.ShapeType.rect,{x,y:sY,w:cW,h:0.06,fill:{color:pHex},line:{type:'none'}});
            let iy=sY+0.16;
            if(item.categoria){slide.addText(item.categoria.toUpperCase(),{x:x+0.1,y:iy,w:cW-0.2,h:0.28,fontSize:6,bold:true,color:pHex,charSpacing:1});iy+=0.3;}
            slide.addText(item.titulo,{x:x+0.1,y:iy,w:cW-0.2,h:0.6,fontSize:cols===2?12:10,bold:true,color:bgHex,wrap:true});iy+=0.65;
            if(item.descricao) slide.addText(item.descricao.slice(0,cols===2?200:100),
              {x:x+0.1,y:iy,w:cW-0.2,h:cH-iy+sY-0.3,fontSize:cols===2?9:8,color:'555555',wrap:true,valign:'top'});
          }
          const det=[item.endereco&&`📍 ${item.endereco}`,item.telefone&&`📞 ${item.telefone}`].filter(Boolean);
          if(det.length) slide.addText(det.join('  '),{x:x+0.1,y:sY+cH-0.7,w:cW-0.2,h:0.35,fontSize:7,color:'888888',wrap:true});
          if(item.site) slide.addText(item.site,{x:x+0.1,y:sY+cH-0.38,w:cW-0.2,h:0.28,fontSize:7,color:pHex,hyperlink:{url:item.site}});
        }));
        if((data.items||[]).length>4) slide.addText(`+ ${data.items.length-4} itens adicionais`,
          {x:0.3,y:H-0.45,w:W-0.6,h:0.25,fontSize:8,italic:true,color:'AAAAAA',align:'center'});
      }
    }
  }
  await pptx.writeFile({ fileName: filename });
  return { filename };
}

/* ─── Web Link ────────────────────────────────────────────── */

/* ─── Image resolver ──────────────────────────────────────── */
/**
 * Resolves images for a destination from portal_images.
 * Returns { hero, gallery[], banners{} } with fallback nulls.
 */
async function resolveImages(dest) {
  if (!dest) return { hero: null, gallery: [], banners: {} };
  try {
    const imgs = await fetchImages({
      continent: dest.continent,
      country:   dest.country,
      city:      dest.city,
    });
    const byType = t => imgs.filter(i => i.type === t);
    const hero    = byType('destaque')[0]?.url   || byType('banner')[0]?.url || byType('galeria')[0]?.url || null;
    const gallery = byType('galeria').map(i => ({ url: i.url, name: i.name, placeName: i.placeName || '', tags: i.tags || [] }));
    // Map gallery images to segments by tag matching
    const banners = {};
    SEGMENTS.forEach(s => {
      const match = gallery.find(i => i.tags?.some(t =>
        t.toLowerCase().includes(s.key.replace(/_/g,' ').split(' ')[0])
      ));
      if (match) banners[s.key] = match.url;
    });
    return { hero, gallery, banners };
  } catch { return { hero: null, gallery: [], banners: {} }; }
}

async function generateWebLink({ allTips, segments, areaName, area, colors, format, imagesOverride = {} }) {
  const token  = generateToken();
  const ref    = doc(collection(db, 'portal_web_links'), token);

  // Resolve images for each destination
  const imagesByDest = {};
  for (const { dest } of allTips) {
    if (dest?.id) {
      imagesByDest[dest.id] = await resolveImages(dest);

      // Apply manual image overrides from the generation editor
      // imagesOverride format: { [destId]: { [segKey]: { [itemIdx]: { url, name } } } }
      const overrides = imagesOverride[dest.id] || {};
      if (Object.keys(overrides).length) {
        // Inject override images into gallery so getImg picks them up via placeName match
        const overrideGallery = [];
        for (const [segKey, items] of Object.entries(overrides)) {
          for (const [idxStr, imgData] of Object.entries(items)) {
            overrideGallery.push({
              url:       imgData.url,
              name:      imgData.name || '',
              placeName: `__override_${segKey}_${idxStr}`, // unique key
              tags:      [],
              _override: true,
              _segKey:   segKey,
              _itemIdx:  Number(idxStr),
            });
          }
        }
        // Prepend override images so they take priority
        imagesByDest[dest.id].gallery = [
          ...overrideGallery,
          ...(imagesByDest[dest.id].gallery || []),
        ];
        imagesByDest[dest.id]._overrides = overrides;
      }
    }
  }

  const profile = store.get('userProfile') || {};
  const uid     = store.get('currentUser')?.uid || null;

  try {
    await setDoc(ref, {
      token,
      format,
      allTips:      allTips.map(({ tip, dest }) => ({ tipId: tip?.id || null, destId: dest?.id || null })),
      tipData:      allTips.map(({ tip, dest }) => ({ tip, dest })),
      segments,
      areaName,
      areaLogoUrl:  area?.logoUrl || null,
      colors,
      imagesByDest,
      createdBy: {
        uid:   uid,
        name:  profile.name  || profile.displayName || 'Usuário',
        email: profile.email || '',
      },
      createdAt:    serverTimestamp(),
      views: 0,
    });
  } catch(e) {
    console.error('[PRIMETOUR] Erro ao salvar portal_web_links:', e);
    throw e;
  }

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
