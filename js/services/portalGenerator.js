/**
 * PRIMETOUR — Portal de Dicas: Motor de Geração
 * Converte dados de dica + área em .docx, .pdf, .pptx ou link web
 *
 * Os imports de Firebase/portal/store são LAZY (dynamic await import dentro
 * das funções que precisam) pra permitir que generatePDF seja importável e
 * testável em Node (harness em tests/) sem trigger do firebase top-level.
 */

// SEGMENTS inline (cópia da fonte em portal.js) — evita import circular
// com módulo que carrega firebase. Se mudar lá, sincronizar aqui.
const SEGMENTS = [
  { key: 'informacoes_gerais',  label: 'Informações Gerais',                    mode: 'special_info' },
  { key: 'bairros',             label: 'Bairros',                               mode: 'simple_list'  },
  { key: 'atracoes',            label: 'Atrações',                              mode: 'place_list'   },
  { key: 'atracoes_criancas',   label: 'Atrações para Crianças',                mode: 'place_list'   },
  { key: 'restaurantes',        label: 'Restaurantes',                          mode: 'place_list'   },
  { key: 'vida_noturna',        label: 'Vida Noturna',                          mode: 'place_list'   },
  { key: 'espetaculos',         label: 'Casas de Espetáculos, Teatros e Cia.',  mode: 'place_list'   },
  { key: 'compras',             label: 'Compras',                               mode: 'place_list'   },
  { key: 'arredores',           label: 'Arredores',                             mode: 'simple_list'  },
  { key: 'highlights',          label: 'Highlights',                            mode: 'place_list'   },
  { key: 'agenda_cultural',     label: 'Agenda Cultural',                       mode: 'agenda'       },
];
const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

const esc = s => String(s||'').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ─── Text sanitizer ───────────────────────────────────────────
 * Remove invisíveis/zero-width que entram via copy-paste do Word/Docs e
 * fazem o jsPDF inserir espaços espúrios no meio das palavras
 * ("diver sas", "Da niel", "K yoto"). Aplica em qualquer string
 * antes de mandar pro renderer. Idempotente.
 */
// Cobertura ampla: soft-hyphen, zero-width, BiDi marks, line/paragraph
// separators, word-joiner, BOM, embedding/override, isolate.
const INVISIBLE_RE = /[\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;
// Vários espaços tipográficos (NBSP, en/em quad, hair space, etc.)
const SPACE_LIKE_RE = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const cleanText = s => String(s ?? '')
  .replace(INVISIBLE_RE, '')
  .replace(SPACE_LIKE_RE, ' ')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n');
export { cleanText };

/* ─── Poppins font loader ──────────────────────────────
 * Substitui Helvetica por Poppins (Regular + Bold + Italic). 1× por
 * sessão via jsDelivr → injeta na VFS do doc.
 */
let _poppinsCache = null;
// Múltiplas URLs candidatas — algumas falham por CORS/404 dependendo do
// browser. Tenta em ordem até uma funcionar. Mais resiliente que single CDN.
const POPPINS_SOURCES = [
  // jsDelivr → unpkg gh raw (bypass cache)
  {
    regular: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/poppins/Poppins-Regular.ttf',
    bold:    'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/poppins/Poppins-Bold.ttf',
    italic:  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/poppins/Poppins-Italic.ttf',
  },
  // Fallback: github raw via codetabs (CORS proxy genérico)
  {
    regular: 'https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Regular.ttf',
    bold:    'https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Bold.ttf',
    italic:  'https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Italic.ttf',
  },
];
async function _fetchAsBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = ''; const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return (typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64'));
}
async function _tryFetchSource(src) {
  const [regular, bold, italic] = await Promise.all([
    _fetchAsBase64(src.regular),
    _fetchAsBase64(src.bold),
    _fetchAsBase64(src.italic),
  ]);
  return { regular, bold, italic };
}
export async function loadPoppinsOnDoc(doc) {
  if (!_poppinsCache) {
    let lastErr = null;
    for (const src of POPPINS_SOURCES) {
      try {
        _poppinsCache = await _tryFetchSource(src);
        console.info('[portalPdf] Poppins carregada de', src.regular);
        break;
      } catch (e) {
        lastErr = e;
        console.warn('[portalPdf] Source falhou:', src.regular, '-', e.message);
      }
    }
    if (!_poppinsCache) throw lastErr || new Error('Todas as fontes falharam');
  }
  doc.addFileToVFS('Poppins-Regular.ttf', _poppinsCache.regular);
  doc.addFont('Poppins-Regular.ttf', 'Poppins', 'normal');
  doc.addFileToVFS('Poppins-Bold.ttf', _poppinsCache.bold);
  doc.addFont('Poppins-Bold.ttf', 'Poppins', 'bold');
  doc.addFileToVFS('Poppins-Italic.ttf', _poppinsCache.italic);
  doc.addFont('Poppins-Italic.ttf', 'Poppins', 'italic');
  doc.setFont('Poppins', 'normal');
  // Sanity check: verifica se a fonte foi de fato registrada
  const fontList = doc.getFontList ? doc.getFontList() : {};
  if (!fontList.Poppins) {
    throw new Error('Poppins não foi registrada no doc.getFontList()');
  }
  console.info('[portalPdf] Poppins ativa no doc:', Object.keys(fontList.Poppins));
}

/* ─── Parser de DESCRIÇÃO ──────────────────────────────────
 * Conteúdo legado tem CLIMA e REPRESENTAÇÃO BRASILEIRA colados como
 * texto cru dentro de info.descricao. Resultado: visual feio + duplica
 * com a seção própria de REPRESENTAÇÃO. Esta função:
 *   1. Extrai bloco CLIMA → { maxByMonth[12], minByMonth[12] }
 *   2. Remove "REPRESENTAÇÃO BRASILEIRA ..." se já houver objeto rep
 *   3. Devolve descrição "limpa" + dados estruturados pro renderer
 */
const MONTH_TOKEN_RE = /(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\D{0,3}(-?\d+)/gi;
const MONTH_INDEX = { jan:0,fev:1,mar:2,abr:3,mai:4,jun:5,jul:6,ago:7,set:8,out:9,nov:10,dez:11 };
export function parseDescricao(rawText, hasRepresentacaoObj = false) {
  let txt = String(rawText || '');
  let climate = null;

  // CLIMA: capturar bloco até quebra dupla, "REPRESENTAÇÃO" ou fim
  const climaRe = /\n*\s*CLIMA[\s\S]*?(?=\n\n|REPRESENTA[ÇC][ÃA]O|$)/i;
  const climaMatch = txt.match(climaRe);
  if (climaMatch) {
    const block = climaMatch[0];
    // Estratégia robusta: itera linha-por-linha procurando "Máx" e "Mín"
    // (admite quebra de linha OU separadores diferentes entre Max e Min).
    const lines = block.split(/[\n\r]+/);
    let maxLine = '', minLine = '';
    for (const ln of lines) {
      if (/m[áa]x/i.test(ln) && !maxLine) maxLine = ln;
      else if (/m[íi]n/i.test(ln) && !minLine) minLine = ln;
    }
    // Fallback: se Max e Min estão na MESMA linha (sem \n entre), tenta
    // separar pela primeira ocorrência de "Mín:" no texto.
    if (maxLine && !minLine && /m[íi]n[^:]*:/i.test(maxLine)) {
      const parts = maxLine.split(/m[íi]n[^:]*:/i);
      maxLine = parts[0];
      minLine = 'Min: ' + (parts[1] || '');
    }
    const parseLine = (line) => {
      const out = Array(12).fill(null);
      // Reset regex state pra não vazar entre chamadas (RE com flag /g)
      const re = new RegExp(MONTH_TOKEN_RE.source, 'gi');
      let m;
      while ((m = re.exec(line)) !== null) {
        const idx = MONTH_INDEX[m[1].toLowerCase()];
        if (idx !== undefined) out[idx] = parseInt(m[2], 10);
      }
      return out;
    };
    const max = parseLine(maxLine), min = parseLine(minLine);
    if (max.some(v=>v!==null) || min.some(v=>v!==null)) {
      climate = { max, min };
      txt = txt.replace(climaMatch[0], '\n').trim();
    }
  }

  // REPRESENTAÇÃO BRASILEIRA: remover bloco se já temos o objeto separado
  if (hasRepresentacaoObj) {
    txt = txt.replace(/\n*\s*REPRESENTA[ÇC][ÃA]O\s+BRASILEIRA[\s\S]*$/i, '').trim();
  }

  return { descricao: txt, climate };
}

/* ─── Ícones vetoriais simples (sem fonte de ícones) ─────────
 * Helvetica/Poppins não tem glyphs Unicode pra ícones; desenhar com
 * primitivas (line/circle/rect) é resoluton-independent e leve.
 * Cada ícone fica num quadrado de SIZE mm centralizado em (x,y).
 */
export function drawIcon(doc, kind, x, y, size, color) {
  const cx = x + size/2, cy = y + size/2;
  const [r,g,b] = color;
  doc.setDrawColor(r,g,b); doc.setFillColor(r,g,b);
  doc.setLineWidth(Math.max(0.5, size * 0.09));
  switch (kind) {
    case 'people': // 2 cabeças (maiores) + ombros conectados em arco
      doc.circle(cx - size*0.22, cy - size*0.12, size*0.14, 'F');
      doc.circle(cx + size*0.22, cy - size*0.12, size*0.14, 'F');
      // ombros como arcos achatados
      doc.setFillColor(r,g,b);
      doc.ellipse(cx - size*0.22, cy + size*0.30, size*0.18, size*0.10, 'F');
      doc.ellipse(cx + size*0.22, cy + size*0.30, size*0.18, size*0.10, 'F');
      break;
    case 'currency': // cifrão $ em fonte grande, na cor do ícone
      doc.setFontSize(size * 3.2);
      doc.setTextColor(r,g,b);
      doc.text('$', cx, cy + size*0.38, {align:'center'});
      break;
    case 'language': // globo: círculo + meridiano vertical + 2 paralelos
      doc.setLineWidth(size * 0.07);
      doc.circle(cx, cy, size*0.38, 'S');
      // meridiano (oval estreito)
      doc.ellipse(cx, cy, size*0.13, size*0.38, 'S');
      // 2 paralelos
      doc.line(cx - size*0.36, cy - size*0.14, cx + size*0.36, cy - size*0.14);
      doc.line(cx - size*0.36, cy + size*0.14, cx + size*0.36, cy + size*0.14);
      break;
    case 'religion': // cruz com proporção mais clara
      doc.setLineWidth(size*0.13);
      doc.line(cx, cy - size*0.38, cx, cy + size*0.38);
      doc.line(cx - size*0.22, cy - size*0.10, cx + size*0.22, cy - size*0.10);
      break;
    case 'clock': // círculo grosso + 2 ponteiros
      doc.setLineWidth(size*0.08);
      doc.circle(cx, cy, size*0.38, 'S');
      doc.setLineWidth(size*0.07);
      doc.line(cx, cy, cx, cy - size*0.26);     // ponteiro vertical (hora)
      doc.line(cx, cy, cx + size*0.20, cy);     // ponteiro horizontal (min)
      // ponto central
      doc.circle(cx, cy, size*0.04, 'F');
      break;
    case 'voltage': { // raio: 6 vértices, polígono fechado
      // Coordenadas do raio em forma de "Z" estilizado
      const pts = [
        [cx + size*0.08, cy - size*0.38],   // topo
        [cx - size*0.20, cy + size*0.04],   // esquerda
        [cx - size*0.02, cy + size*0.04],   // meio-esq
        [cx - size*0.08, cy + size*0.38],   // base
        [cx + size*0.20, cy - size*0.04],   // direita
        [cx + size*0.02, cy - size*0.04],   // meio-dir
      ];
      doc.setFillColor(r,g,b);
      // Desenha como triangulações (jsPDF não tem polygon, usar lines)
      // Stroke simples contornando os 6 pontos
      doc.setLineWidth(size*0.08);
      for (let i=0; i<pts.length; i++) {
        const a = pts[i], b2 = pts[(i+1) % pts.length];
        doc.line(a[0], a[1], b2[0], b2[1]);
      }
      break;
    }
    case 'phone': { // handset clássico (linha curva)
      doc.setLineWidth(size*0.13);
      // Forma de C girado: 2 segmentos de linha + 1 arco
      // Topo do handset (ear piece)
      doc.line(cx - size*0.32, cy - size*0.25, cx - size*0.10, cy - size*0.32);
      // diagonal central
      doc.line(cx - size*0.10, cy - size*0.32, cx + size*0.32, cy + size*0.10);
      // base (mouth piece)
      doc.line(cx + size*0.32, cy + size*0.10, cx + size*0.25, cy + size*0.32);
      break;
    }
    case 'pin': // marcador de mapa
      doc.setLineWidth(size*0.08);
      doc.circle(cx, cy - size*0.08, size*0.20, 'S');
      doc.line(cx, cy + size*0.12, cx, cy + size*0.34);
      break;
    default:
      doc.circle(cx, cy, size*0.30, 'S');
  }
}

/* ─── Logo composite (browser) ──────────────────────────
 * jsPDF + 'FAST' converte PNG pra JPEG, perdendo alpha → área
 * transparente vira preta. Solucão: composite em canvas em alta
 * resolucão (~300dpi) pintado com a cor de fundo correta. Alpha-blend
 * no canvas, resultado vira JPEG sólido — sem card branco visível.
 * Em Node (harness), retorna a dataURL original pra teste de layout.
 */
export async function compositeLogoOnBackground({ logoDataUrl, bgColorHex, finalWmm, finalHmm, padPct = 0.10 }) {
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    return logoDataUrl;
  }
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = logoDataUrl;
  });
  // 1mm ≈ 11.81px @ 300dpi
  const wPx = Math.max(64, Math.round(finalWmm * 11.81));
  const hPx = Math.max(64, Math.round(finalHmm * 11.81));
  const canvas = document.createElement('canvas');
  canvas.width = wPx; canvas.height = hPx;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bgColorHex;
  ctx.fillRect(0, 0, wPx, hPx);
  const ratio = img.naturalWidth / Math.max(img.naturalHeight, 1);
  const usableW = wPx * (1 - padPct * 2);
  const usableH = hPx * (1 - padPct * 2);
  let lw = usableW, lh = lw / ratio;
  if (lh > usableH) { lh = usableH; lw = lh * ratio; }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (wPx - lw) / 2, (hPx - lh) / 2, lw, lh);
  // PNG (lossless) — JPEG distorcia ligeiramente a cor de fundo, fazendo
  // o composite ficar visível como "card" sutil sobre a capa monocromática.
  return canvas.toDataURL('image/png');
}

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
export async function generateTip({ tip, area, dest, segments, format, extraTips = [], imagesOverride = {}, clientName = '' }) {
  const allTips  = [{ tip, dest }, ...extraTips];
  const areaName = area?.name || 'PRIMETOUR';
  const colors   = {
    primary:   area?.colors?.primary   || '#475569',
    secondary: area?.colors?.secondary || '#1F2937',
  };
  const filename = buildFilename(allTips, format);

  const imagesByDest = {};
  for (const { dest: d } of allTips) {
    if (d?.id) {
      imagesByDest[d.id] = await resolveImages(d);
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
    case 'web':  return generateWebLink({ allTips, segments, areaName, area, colors, format, imagesOverride, clientName });
    default:     throw new Error(`Formato desconhecido: ${format}`);
  }
}

/* Função pública chamável diretamente (harness de teste).
 * Aceita injeção de deps para rodar fora do browser:
 *   - _jsPDFCtor:  construtor jsPDF (no browser cai pro window.jspdf)
 *   - _imgFetcher: alternativa ao imgToBase64 (no Node, mock local)
 *   - _fontLoader: alternativa ao loadPoppinsOnDoc (no Node, no-op)
 *   - _saveOverride: callback (blob, filename) → void; no Node grava em disco
 */
export async function generatePdfStandalone(opts) {
  return generatePDF(opts);
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
  const title = (item?.titulo || item?.title || '').toLowerCase().trim();

  // OVERRIDES: tenta 3 estratégias em ordem
  // 1. match por idx exato (caminho original)
  // 2. match por título (caso a lista de items tenha sido reordenada)
  // 3. match por placeName parcial dentro dos overrides
  if (segKey && overrides[segKey]) {
    const segOv = overrides[segKey];
    // (1) idx
    const ovByIdx = segOv[idx] || segOv[String(idx)];
    if (ovByIdx?.url) return ovByIdx.url;
    // (2) por título (override pode ter campo `name` ou `placeName`)
    if (title) {
      for (const k of Object.keys(segOv)) {
        const o = segOv[k];
        const oName = (o?.name || o?.placeName || '').toLowerCase().trim();
        if (oName && (oName === title || oName.includes(title.slice(0,12)) || title.includes(oName.slice(0,12)))) {
          if (o.url) return o.url;
        }
      }
    }
  }
  const gallery = imgs.gallery || [];
  if (!title) return null;
  // placeName exact
  let m = gallery.find(g => g.placeName && g.placeName.toLowerCase().trim() === title);
  // placeName partial — exige >= 6 chars de overlap
  if (!m) m = gallery.find(g => g.placeName && g.placeName.length >= 6 &&
    (title.includes(g.placeName.toLowerCase()) || g.placeName.toLowerCase().includes(title.slice(0,15))));
  // name/tag keywords — exige palavras com >=4 chars
  if (!m) {
    const words = title.split(/\s+/).filter(w => w.length > 3);
    m = gallery.find(g => words.some(w => g.name?.toLowerCase().includes(w)));
  }
  // SEM fallback cíclico (antes pegava gallery[idx % N], gerando looping
  // visual ruim de 5 fotos rotativas em 30 itens).
  return m?.url || null;
}

const R2_PROXY = 'https://primetour-images.rene-castro.workers.dev';

/* Fetch image via CORS-safe proxy, return { dataUrl, mimeType, ext, arrayBuffer } */
async function fetchImgData(url) {
  if (!url) return null;
  try {
    const proxyUrl = `${R2_PROXY}?url=${encodeURIComponent(url)}`;
    const res      = await fetch(proxyUrl);
    if (!res.ok) return null;
    const blob     = await res.blob();
    const mime     = blob.type || 'image/jpeg';
    // Normalise extension
    const extMap   = { 'image/jpeg':'jpg','image/jpg':'jpg','image/png':'png',
                       'image/webp':'png','image/gif':'gif' };
    const ext      = extMap[mime] || 'jpg';
    // dataUrl for PDF/PPTX
    const dataUrl  = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload  = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
    // ArrayBuffer for DOCX
    const arrayBuffer = await blob.arrayBuffer();
    return { dataUrl, mimeType: mime, ext, arrayBuffer };
  } catch { return null; }
}

/* Convenience wrappers */
async function imgToBase64(url) {
  const d = await fetchImgData(url);
  return d?.dataUrl || null;
}

function base64Data(dataUrl) { return dataUrl ? dataUrl.split(',')[1] : null; }
function base64Ext(dataUrl) {
  const m = dataUrl?.match(/data:image\/([a-zA-Z+]+);/);
  return m ? m[1].replace('jpeg','jpg').replace('webp','png').replace('+xml','') : 'jpg';
}

async function generateDocx({ allTips, segments, areaName, area, colors, filename, imagesByDest = {} }) {
  await loadDocx();
  const { Document, Packer, Paragraph, TextRun, AlignmentType,
    ExternalHyperlink, BorderStyle, Table, TableRow, TableCell,
    WidthType, PageBreak, ImageRun } = window.docx;

  // Vars mantêm os nomes legados (gold/navy) por compatibilidade com o
  // restante do generator, mas defaults agora são cinzas neutros — sem dourado.
  const gold = (colors.primary   || '#475569').replace('#','');
  const navy = (colors.secondary || '#1F2937').replace('#','');
  const children = [];
  const date = new Date().toLocaleDateString('pt-BR',{year:'numeric',month:'long',day:'numeric'});

  // Use shared fetchImgData (CORS-safe, returns arrayBuffer + mimeType)

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
    const heroData = await fetchImgData(imgs.hero);
    if(heroData?.arrayBuffer){
      try {
        children.push(new Paragraph({
          children:[new ImageRun({data:heroData.arrayBuffer,transformation:{width:530,height:250},type:heroData.ext})],
          alignment:AlignmentType.CENTER,
          spacing:{before:0,after:200},
        }));
      } catch(e) { console.warn('Hero image skip:', e.message); }
    }

    children.push(new Paragraph({children:[new TextRun({text:label.toUpperCase(),bold:true,size:32,color:navy,characterSpacing:120})],spacing:{before:heroData?.arrayBuffer?100:400,after:80},border:{bottom:{style:BorderStyle.SINGLE,size:12,color:gold}}}));
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
          const imgData=await fetchImgData(imgUrl);

          if(item.categoria) children.push(new Paragraph({children:[new TextRun({text:item.categoria.toUpperCase(),size:13,color:gold,bold:true,characterSpacing:200})],spacing:{before:240,after:20}}));
          children.push(new Paragraph({children:[new TextRun({text:item.titulo,bold:true,size:22,color:navy})],spacing:{after:imgData?.arrayBuffer?80:60}}));

          if(imgData?.arrayBuffer){
            try {
              children.push(new Paragraph({
                children:[new ImageRun({data:imgData.arrayBuffer,transformation:{width:420,height:220},type:imgData.ext})],
                spacing:{after:120},
              }));
            } catch(e) { console.warn('Item image skip:', e.message); }
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
async function generatePDF({
  allTips, segments, areaName, area, colors, filename, imagesByDest = {},
  // Injeções pra harness/teste — em browser usam os defaults
  _jsPDFCtor    = null,
  _imgFetcher   = imgToBase64,
  _fontLoader   = loadPoppinsOnDoc,
  _compositeLogo = compositeLogoOnBackground,
  _saveOverride = null,
}={}) {
  let JsPDFCtor = _jsPDFCtor;
  if (!JsPDFCtor) {
    await loadJsPDF();
    JsPDFCtor = window.jspdf.jsPDF;
  }
  const doc=new JsPDFCtor({orientation:'portrait',unit:'mm',format:'a4'});

  // Carrega Poppins (substitui Helvetica). Se falhar (offline), segue helvetica.
  const FONT_OK = await _fontLoader(doc).then(()=>true).catch((e)=>{
    console.warn('[portalPdf] Poppins não carregada, usando helvetica:', e?.message); return false;
  });
  const FONT = FONT_OK ? 'Poppins' : 'helvetica';
  const setF = (style='normal') => doc.setFont(FONT, style);

  const primary=colors.primary||'#475569', second=colors.secondary||'#1F2937';
  const PAGE_W=210,MARGIN=16,CONTENT=210-16*2;
  let y=MARGIN;
  const pR=hexToR(primary),pG=hexToG(primary),pB=hexToB(primary);
  const sR=hexToR(second), sG=hexToG(second), sB=hexToB(second);

  // Pré-carrega logo + dimensões reais (pra aspect-ratio)
  const loadLogoMeta = async (url) => {
    if (!url) return null;
    const b64 = await _imgFetcher(url);
    if (!b64) return null;
    if (typeof Image === 'undefined') return { dataUrl: b64, w: 400, h: 120 };
    try {
      const dims = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload  = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
        im.onerror = () => reject();
        im.src = b64;
      });
      return { dataUrl: b64, ...dims };
    } catch { return { dataUrl: b64, w: 400, h: 120 }; }
  };
  // Carrega logo principal (capa, fundo escuro) + logo alternativo
  // (rodapé, fundo claro). Composite resolve TRANSPARÊNCIA (PNG → fundo
  // sólido), mas NÃO resolve "logo branco em fundo branco" — pra isso
  // precisa o cliente enviar versão escura via area.logoUrlAlt.
  const logoMeta    = await loadLogoMeta(area?.logoUrl);
  const logoAltMeta = await loadLogoMeta(area?.logoUrlAlt);

  let logoCoverDataUrl  = null;
  let logoFooterDataUrl = null;
  if (logoMeta) {
    logoCoverDataUrl = await _compositeLogo({
      logoDataUrl: logoMeta.dataUrl, bgColorHex: second,
      finalWmm: 80, finalHmm: 45, padPct: 0.05,
    }).catch(() => logoMeta.dataUrl);
  }
  // Rodapé: prefere logoAlt (designed pra fundo claro). Se não houver,
  // usa o principal compositado em branco (funciona pra logos coloridos).
  const footerSourceMeta = logoAltMeta || logoMeta;
  if (footerSourceMeta) {
    logoFooterDataUrl = await _compositeLogo({
      logoDataUrl: footerSourceMeta.dataUrl, bgColorHex: '#FFFFFF',
      finalWmm: 30, finalHmm: 8, padPct: 0.05,
    }).catch(() => footerSourceMeta.dataUrl);
  }

  const addPage=()=>{doc.addPage();y=MARGIN;addFooter();};
  const checkPage=(n=10)=>{if(y+n>275)addPage();};
  // Rodapé: logo composite (sem card branco) — fundo branco da página
  // já é a cor de composite. Texto ABAIXO do logo, com altura segura.
  const addFooter=()=>{
    const pg=doc.getNumberOfPages(); doc.setPage(pg);
    doc.setDrawColor(220,220,220); doc.setLineWidth(0.2);
    doc.line(MARGIN, 280, PAGE_W-MARGIN, 280);
    if (logoFooterDataUrl) {
      const LOGO_W=24, LOGO_H=7;
      const lx=(PAGE_W-LOGO_W)/2, ly=282.5;
      try {
        // PNG lossless — preserva cor exata do fundo, sem "card" visível
        doc.addImage(logoFooterDataUrl, 'PNG', lx, ly, LOGO_W, LOGO_H, undefined, 'NONE');
      } catch (e) { /* silencioso */ }
    }
    doc.setFontSize(7); setF('normal'); doc.setTextColor(140,140,140);
    doc.text(
      `Portal de Dicas  ·  ${new Date().toLocaleDateString('pt-BR')}  ·  p.${pg}`,
      PAGE_W/2, 293, { align:'center' }
    );
  };

  // ── COVER ───────────────────────────────────────────────────────
  doc.setFillColor(sR,sG,sB); doc.rect(0,0,PAGE_W,297,'F');
  if (logoCoverDataUrl) {
    // Logo composite ocupa o centro da capa, sem card branco visível.
    // Composite já garantiu fundo sólido na cor secundária.
    const MAX_W=80, MAX_H=45;
    const ratio = logoMeta ? (logoMeta.w / Math.max(logoMeta.h, 1)) : (16/9);
    let lw=MAX_W, lh=lw/ratio;
    if (lh > MAX_H) { lh=MAX_H; lw=lh*ratio; }
    const lx=(PAGE_W - lw)/2;
    const ly=100;
    try {
      doc.addImage(logoCoverDataUrl, 'PNG', lx, ly, lw, lh, undefined, 'NONE');
    } catch(e) { /* segue sem logo */ }
  } else {
    // Sem logo: nome da área em destaque
    doc.setFillColor(pR,pG,pB); doc.rect(MARGIN, 108, CONTENT, 0.8, 'F');
    doc.setFontSize(28); setF('bold'); doc.setTextColor(255,255,255);
    doc.text(cleanText(areaName).toUpperCase(), PAGE_W/2, 100, {align:'center', charSpace:3});
  }
  // Linha + destinos + data (sempre embaixo do logo)
  const coverDivY = 162;
  doc.setFillColor(pR,pG,pB); doc.rect(MARGIN, coverDivY, CONTENT, 0.5, 'F');
  let dY = coverDivY + 16;
  for (const { dest } of allTips) {
    doc.setFontSize(14); setF('bold'); doc.setTextColor(255,255,255);
    doc.text(cleanText(destLabel(dest)), PAGE_W/2, dY, {align:'center'});
    dY += 10;
  }
  // Data: BRANCO (alto contraste sobre navy/cinza-escuro)
  doc.setFontSize(9); setF('normal'); doc.setTextColor(255,255,255);
  doc.text(new Date().toLocaleDateString('pt-BR',{year:'numeric',month:'long'}),
    PAGE_W/2, dY+10, {align:'center'});
  doc.addPage(); y=MARGIN; addFooter();

  // ── CAPAS DE SEÇÃO (apenas pros 4 principais) + TOC ─────────────
  // Pros 4 segmentos "principais", inserimos uma página-divisória antes do
  // conteúdo. Os demais segmentos vão inline normal. O TOC é construído
  // ao final num re-pass: anotamos as páginas conforme renderiza.
  const COVER_SEGMENTS = new Set(['highlights','arredores','agenda_cultural','compras']);
  const tocEntries = []; // { title, pageNum }
  let coverChapterNum = 0; // numera só os COVER segments (1..N)

  // RESERVA página em branco pro TOC (será preenchida no fim)
  // Inserida APÓS o hero do primeiro destino se houver, ou após capa.
  let tocPageIdx = null;

  for(const{tip,dest}of allTips){
    const imgs=imagesByDest[dest?.id]||{};

    // ── HERO ──────────────────────────────────────────────────────
    const heroB64 = await _imgFetcher(imgs.hero);
    if (heroB64) {
      doc.setFillColor(255,255,255); doc.rect(0,0,PAGE_W,297,'F');
      let heroH = 180;
      if (typeof Image !== 'undefined') {
        try {
          heroH = await new Promise((resolve) => {
            const im = new Image();
            im.onload  = () => resolve(Math.min(220, PAGE_W * (im.naturalHeight / Math.max(im.naturalWidth,1))));
            im.onerror = () => resolve(180);
            im.src = heroB64;
          });
        } catch { heroH = 180; }
      }
      try { doc.addImage(heroB64, 'JPEG', 0, 0, PAGE_W, heroH, undefined, 'SLOW'); } catch(e) {}
      const titleY = heroH + 25;
      doc.setFillColor(pR,pG,pB); doc.rect(MARGIN, titleY-10, 40, 0.8, 'F');
      doc.setFontSize(22); setF('bold'); doc.setTextColor(sR,sG,sB);
      doc.text(cleanText(destLabel(dest)), MARGIN, titleY);
      doc.addPage(); y=MARGIN; addFooter();
    }

    // RESERVA página do TOC (1ª iteração só)
    if (tocPageIdx === null) {
      tocPageIdx = doc.getNumberOfPages();
      // Mantém esta página em branco — preenchida no fim
      doc.addPage(); y=MARGIN; addFooter();
    }

    // ── DESTINATION HEADING ───────────────────────────────────────
    checkPage(24);
    doc.setFontSize(16); setF('bold'); doc.setTextColor(sR,sG,sB);
    doc.text(cleanText(destLabel(dest)).toUpperCase(), MARGIN, y); y+=2;
    doc.setFillColor(pR,pG,pB); doc.rect(MARGIN, y, CONTENT, 0.6, 'F'); y+=8;

    const content = buildContent(tip, segments);
    for (let segIdx=0; segIdx<content.length; segIdx++) {
      const { segDef, data } = content[segIdx];

      // CAPA DE SEÇÃO pros 4 principais
      if (COVER_SEGMENTS.has(segDef.key)) {
        coverChapterNum += 1;
        doc.addPage();
        // Fundo na cor secundária ocupando toda página
        doc.setFillColor(sR,sG,sB); doc.rect(0,0,PAGE_W,297,'F');
        // Numeração discreta no topo (só conta caps de COVER, não índice geral)
        doc.setFontSize(8); setF('normal'); doc.setTextColor(180,180,180);
        const num = String(coverChapterNum).padStart(2,'0');
        doc.text(`CAPÍTULO ${num}`, PAGE_W/2, 100, {align:'center', charSpace:3});
        // Linha + nome do segmento gigante (centralizada por geometria)
        const lineW = 60;
        doc.setFillColor(pR,pG,pB); doc.rect((PAGE_W-lineW)/2, 115, lineW, 0.6, 'F');
        doc.setFontSize(28); setF('bold'); doc.setTextColor(255,255,255);
        doc.text(cleanText(segDef.label).toUpperCase(), PAGE_W/2, 138, {align:'center'});
        // Subtitle do destino — SEM charSpace pra não estourar a margem.
        // Wrap manual se necessário (cabe em 1 linha pra strings normais).
        doc.setFontSize(11); setF('normal'); doc.setTextColor(220,220,220);
        const subLines = doc.splitTextToSize(cleanText(destLabel(dest)), CONTENT);
        doc.text(subLines, PAGE_W/2, 152, {align:'center'});
        // Anota TOC apontando pra página DEPOIS da capa (conteúdo real)
        doc.addPage(); y=MARGIN; addFooter();
        tocEntries.push({ title: segDef.label, pageNum: doc.getNumberOfPages() });
      } else {
        // Segmento inline — anota TOC no início
        tocEntries.push({ title: segDef.label, pageNum: doc.getNumberOfPages() });
      }

      checkPage(18);
      // Segment heading (sempre, capa ou inline)
      doc.setFillColor(pR,pG,pB); doc.rect(MARGIN, y-4, 2.5, 8, 'F');
      doc.setFontSize(10); setF('bold'); doc.setTextColor(pR,pG,pB);
      doc.text(cleanText(segDef.label).toUpperCase(), MARGIN+5, y, {charSpace:1}); y+=9;
      doc.setTextColor(40,40,40);

      if (segDef.mode === 'special_info') {
        const inf = data.info || {};
        const rep = inf.representacao || {};
        // Parser: separa CLIMA + remove REPRESENTAÇÃO duplicada do descricao
        const { descricao: descClean, climate } = parseDescricao(inf.descricao, !!rep.nome);

        // ── DESCRIÇÃO em largura total ──────────────────────────────
        if (descClean) {
          checkPage(8);
          doc.setFontSize(6); setF('bold'); doc.setTextColor(pR,pG,pB);
          doc.text('DESCRIÇÃO', MARGIN, y, {charSpace:0.8}); y+=5;
          doc.setFontSize(9); setF('normal'); doc.setTextColor(60,60,60);
          const lines = doc.splitTextToSize(cleanText(descClean), CONTENT);
          checkPage(lines.length*4.5+2);
          doc.text(lines, MARGIN, y); y+=lines.length*4.5+5;
        }

        // ── DICA em callout ─────────────────────────────────────────
        if (inf.dica) {
          doc.setFontSize(9); setF('normal');
          const dicaLines = doc.splitTextToSize(cleanText(inf.dica), CONTENT-10);
          const calloutH = dicaLines.length*4.5 + 8;
          checkPage(calloutH+2);
          doc.setFillColor(248,247,244); doc.rect(MARGIN, y, CONTENT, calloutH, 'F');
          doc.setFillColor(pR,pG,pB);    doc.rect(MARGIN, y, 1.5, calloutH, 'F');
          doc.setFontSize(6); setF('bold'); doc.setTextColor(pR,pG,pB);
          doc.text('DICA', MARGIN+5, y+5, {charSpace:0.8});
          doc.setFontSize(9); setF('normal'); doc.setTextColor(60,60,60);
          doc.text(dicaLines, MARGIN+5, y+11);
          y += calloutH + 6;
        }

        // ── CHIPS HORIZONTAIS com ícones (substitui grid 2-col cinza) ─
        const chips = [
          ['people',   'POPULAÇÃO', inf.populacao],
          ['currency', 'MOEDA',     inf.moeda],
          ['language', 'LÍNGUA',    inf.lingua],
          ['religion', 'RELIGIÃO',  inf.religiao],
          ['clock',    'FUSO',      (inf.fusoSinal&&inf.fusoHoras)?`${inf.fusoSinal}${inf.fusoHoras}h`:''],
          ['voltage',  'VOLTAGEM',  inf.voltagem],
          ['phone',    'DDD',       inf.ddd],
        ].filter(([,,v])=>v);
        if (chips.length) {
          // 4 chips por linha (cada chip ~44mm de largura)
          const COLS=4, GAP=3, CHIP_H=18;
          const chipW=(CONTENT - GAP*(COLS-1))/COLS;
          const ICON=8;
          for (let i=0; i<chips.length; i++) {
            const col = i % COLS, row = Math.floor(i / COLS);
            if (col === 0) checkPage(CHIP_H+2);
            const cx = MARGIN + col*(chipW+GAP);
            const cy = y + row*(CHIP_H+GAP);
            // Card sutil
            doc.setFillColor(252,252,251); doc.rect(cx, cy, chipW, CHIP_H, 'F');
            doc.setDrawColor(225,225,222); doc.setLineWidth(0.2); doc.rect(cx, cy, chipW, CHIP_H, 'S');
            // Ícone à esquerda
            drawIcon(doc, chips[i][0], cx+3, cy+(CHIP_H-ICON)/2, ICON, [pR,pG,pB]);
            // Label + valor à direita do ícone
            doc.setFontSize(6); setF('bold'); doc.setTextColor(pR,pG,pB);
            doc.text(chips[i][1], cx+ICON+6, cy+6, {charSpace:0.7});
            doc.setFontSize(9); setF('bold'); doc.setTextColor(sR,sG,sB);
            const vLines = doc.splitTextToSize(cleanText(String(chips[i][2])), chipW-ICON-9);
            doc.text(vLines.slice(0,2), cx+ICON+6, cy+12);
          }
          const totalRows = Math.ceil(chips.length/COLS);
          y += totalRows*(CHIP_H+GAP) + 2;
        }

        // ── CLIMA: grid 12 meses (se conseguimos parsear) ───────────
        if (climate && (climate.max.some(v=>v!==null) || climate.min.some(v=>v!==null))) {
          checkPage(38);
          doc.setFontSize(6); setF('bold'); doc.setTextColor(pR,pG,pB);
          doc.text('CLIMA — TEMPERATURA ANUAL (MÉDIAS)', MARGIN, y, {charSpace:0.8}); y+=5;
          const COLS=12, GAP=1;
          const colW=(CONTENT - GAP*(COLS-1))/COLS;
          const ROW_H=22;
          // Range pra colorir intensidade (só max)
          const allTemps = [...climate.max, ...climate.min].filter(v=>v!==null);
          const tMin=Math.min(...allTemps), tMax=Math.max(...allTemps);
          const tRange=Math.max(tMax-tMin, 1);
          for (let m=0; m<12; m++) {
            const cx = MARGIN + m*(colW+GAP);
            // Cor de fundo proporcional ao max do mês (azul frio → cinza quente)
            const v = climate.max[m];
            let bgR=245,bgG=246,bgB=247;
            if (v !== null) {
              const t = (v - tMin) / tRange; // 0..1
              // Interpola: azul clarinho (220,235,245) → bege quente (250,235,215)
              bgR = Math.round(220 + (250-220)*t);
              bgG = Math.round(235 + (235-235)*t);
              bgB = Math.round(245 + (215-245)*t);
            }
            doc.setFillColor(bgR,bgG,bgB); doc.rect(cx, y, colW, ROW_H, 'F');
            // Mês
            doc.setFontSize(6); setF('bold'); doc.setTextColor(pR,pG,pB);
            doc.text(MONTHS[m].toUpperCase(), cx+colW/2, y+4, {align:'center', charSpace:0.5});
            // Max
            doc.setFontSize(8); setF('bold'); doc.setTextColor(sR,sG,sB);
            doc.text(climate.max[m]!==null?`${climate.max[m]}°`:'—', cx+colW/2, y+11, {align:'center'});
            // Min
            doc.setFontSize(7); setF('normal'); doc.setTextColor(120,120,120);
            doc.text(climate.min[m]!==null?`${climate.min[m]}°`:'—', cx+colW/2, y+17, {align:'center'});
          }
          // Legenda discreta
          y += ROW_H + 3;
          doc.setFontSize(6); setF('italic'); doc.setTextColor(140,140,140);
          doc.text('Linha superior: máx · Linha inferior: mín', MARGIN, y); y+=5;
        }

        // ── REPRESENTAÇÃO BRASILEIRA (estruturada, dedup já feito) ──
        if (rep.nome) {
          checkPage(24);
          doc.setFontSize(6); setF('bold'); doc.setTextColor(pR,pG,pB);
          doc.text('REPRESENTAÇÃO BRASILEIRA', MARGIN, y, {charSpace:0.8}); y+=5;
          for (const [l,v] of [['Nome',rep.nome],['Endereço',rep.endereco],['Telefone',rep.telefone],['Site',rep.link]].filter(([,v])=>v)) {
            doc.setFontSize(8); setF('bold'); doc.setTextColor(sR,sG,sB);
            doc.text(`${l}:`, MARGIN, y);
            const labelW = doc.getTextWidth(`${l}:`) + 2;
            setF('normal'); doc.setTextColor(70,70,80);
            doc.text(cleanText(v), MARGIN+labelW, y); y+=5;
          }
          y+=2;
        }
        // INFORMAÇÕES GERAIS sempre fica sozinha na página — quebra antes
        // do próximo segmento pra dar respiro visual e não emendar com Bairros.
        doc.addPage(); y=MARGIN; addFooter();
      } else if (segDef.mode === 'simple_list') {
        // simple_list AGORA suporta imagem via overrides (Bairros/Arredores).
        for (let itemIdx=0; itemIdx<(data.items||[]).length; itemIdx++) {
          const item = data.items[itemIdx];
          const imgUrl = pickImg({ titulo: item.title, title: item.title }, itemIdx, imgs, segDef.key);
          const imgB64 = await _imgFetcher(imgUrl);
          const IMG_W=42, IMG_H=28;
          const textW = imgB64 ? CONTENT-IMG_W-4 : CONTENT-8;
          checkPage(imgB64 ? IMG_H+4 : 14);

          const blockStartY = y;
          doc.setFontSize(9); setF('bold'); doc.setTextColor(sR,sG,sB);
          doc.setFillColor(pR,pG,pB); doc.circle(MARGIN+1.5, y-1, 1, 'F');
          doc.text(cleanText(item.title||''), MARGIN+5, y); y+=5;
          if (item.description) {
            setF('normal'); doc.setFontSize(8); doc.setTextColor(70,70,80);
            const lines = doc.splitTextToSize(cleanText(item.description), textW-4);
            checkPage(lines.length*4+2); doc.text(lines, MARGIN+8, y); y+=lines.length*4+2;
          }
          if (imgB64) {
            const imgX = MARGIN + textW + 4;
            const imgY = blockStartY - 4;
            try { doc.addImage(imgB64, 'JPEG', imgX, imgY, IMG_W, IMG_H, undefined, 'FAST'); } catch(e) {}
            // SEM borda azul.
            if (y < imgY+IMG_H+2) y = imgY+IMG_H+2;
          }
        }
        y+=4;
      } else {
        if (data.themeDesc) {
          setF('italic'); doc.setFontSize(8); doc.setTextColor(100,100,100);
          const lines = doc.splitTextToSize(cleanText(data.themeDesc), CONTENT);
          doc.text(lines, MARGIN, y); y+=lines.length*4+4;
        }

        let lastCategoria = null;
        for (let itemIdx=0; itemIdx<(data.items||[]).length; itemIdx++) {
          const item = data.items[itemIdx];
          if (!item.titulo) continue;

          const catNorm = cleanText(item.categoria || '').trim();
          if (catNorm && catNorm !== lastCategoria) {
            checkPage(14);
            doc.setFillColor(pR,pG,pB); doc.rect(MARGIN, y-2, 1.5, 5, 'F');
            doc.setFontSize(8); setF('bold'); doc.setTextColor(pR,pG,pB);
            doc.text(catNorm.toUpperCase(), MARGIN+4, y+2, {charSpace:1.2});
            y += 8;
            lastCategoria = catNorm;
          }

          const imgUrl = pickImg(item, itemIdx, imgs, segDef.key);
          const imgB64 = await _imgFetcher(imgUrl);
          const IMG_W=55, IMG_H=38;
          const textW = imgB64 ? CONTENT-IMG_W-4 : CONTENT;
          checkPage(imgB64 ? IMG_H+6 : 22);

          const blockStartY = y;
          setF('bold'); doc.setFontSize(10); doc.setTextColor(sR,sG,sB);
          const titleLines = doc.splitTextToSize(cleanText(item.titulo), textW-4);
          checkPage(titleLines.length*5+2);
          doc.text(titleLines, MARGIN+2, y); y+=titleLines.length*5;
          if (item.descricao) {
            setF('normal'); doc.setFontSize(8); doc.setTextColor(70,70,80);
            const lines = doc.splitTextToSize(cleanText(item.descricao), textW-4);
            checkPage(lines.length*4+2); doc.text(lines, MARGIN+2, y); y+=lines.length*4+2;
          }
          const det = [
            item.endereco && `End. ${cleanText(item.endereco)}`,
            item.telefone && `Tel. ${cleanText(item.telefone)}`,
          ].filter(Boolean);
          if (det.length) {
            doc.setFontSize(7.5); doc.setTextColor(130,130,130);
            const detLines = doc.splitTextToSize(det.join('   ·   '), textW-4);
            checkPage(detLines.length*4+1); doc.text(detLines, MARGIN+2, y); y+=detLines.length*4;
          }
          // Link: pill clicável com seta. Padding interno e externo balanceados.
          if (item.site) {
            const linkText = 'Visitar site';
            doc.setFontSize(8); setF('bold');
            const padX = 5, arrowW = 5.5, gap = 3;
            const txtW = doc.getTextWidth(linkText);
            const pillW = padX + txtW + gap + arrowW + padX;
            const pillH = 6.5;
            const pillX = MARGIN+2;
            const pillY = y;       // pill começa em y, não y-3.8
            doc.setFillColor(pR,pG,pB);
            doc.roundedRect(pillX, pillY, pillW, pillH, 1.5, 1.5, 'F');
            doc.setTextColor(255,255,255);
            // baseline: pillY + (pillH/2) + ajusteFonte
            doc.text(linkText, pillX + padX, pillY + pillH/2 + 1.5);
            // Setinha "↗" — desenhada com 3 linhas
            const ax = pillX + padX + txtW + gap + arrowW/2;
            const ay = pillY + pillH/2;
            doc.setDrawColor(255,255,255); doc.setLineWidth(0.5);
            doc.line(ax-1.6, ay+1.6, ax+1.2, ay-1.2);   // diagonal
            doc.line(ax+1.2, ay-1.2, ax-0.4, ay-1.2);   // topo da seta
            doc.line(ax+1.2, ay-1.2, ax+1.2, ay+0.4);   // lado da seta
            try { doc.link(pillX, pillY, pillW, pillH, { url: item.site }); } catch(e) {}
            y += pillH + 2; // gap externo após pill
          }
          if (item.observacoes) {
            doc.setFontSize(7.5); doc.setTextColor(160,160,160); setF('italic');
            const obsLines = doc.splitTextToSize('Obs. '+cleanText(item.observacoes), textW-4);
            checkPage(obsLines.length*4+1); doc.text(obsLines, MARGIN+2, y); y+=obsLines.length*4;
          }

          if (imgB64) {
            const imgX = MARGIN + textW + 2;
            const imgY = blockStartY - 4;
            try { doc.addImage(imgB64, 'JPEG', imgX, imgY, IMG_W, IMG_H, undefined, 'FAST'); } catch(e) {}
            // SEM borda azul ao redor da foto.
            if (y < imgY+IMG_H+2) y = imgY+IMG_H+2;
          }

          doc.setDrawColor(235,235,235); doc.setLineWidth(0.2);
          doc.line(MARGIN+2, y, MARGIN+CONTENT-2, y); y+=4;
        }
      }
      y+=4;
    }
    doc.addPage(); y=MARGIN; addFooter();
  }

  // ── RENDER TOC na página reservada ─────────────────────────────
  // Volta na página guardada e desenha o sumário completo.
  if (tocPageIdx !== null && tocEntries.length) {
    doc.setPage(tocPageIdx);
    let ty = MARGIN + 8;
    doc.setFontSize(18); setF('bold'); doc.setTextColor(sR,sG,sB);
    doc.text('SUMÁRIO', MARGIN, ty); ty+=4;
    doc.setFillColor(pR,pG,pB); doc.rect(MARGIN, ty, 30, 0.6, 'F'); ty+=10;
    // Lista de entradas com leader dots
    doc.setFontSize(10); setF('normal');
    for (const entry of tocEntries) {
      const title = cleanText(entry.title);
      const pageStr = String(entry.pageNum);
      doc.setTextColor(50,50,50); setF('normal');
      doc.text(title, MARGIN, ty);
      doc.setTextColor(pR,pG,pB); setF('bold');
      doc.text(pageStr, PAGE_W-MARGIN, ty, {align:'right'});
      // Leader dots no meio
      doc.setFontSize(10); setF('normal'); doc.setTextColor(200,200,200);
      const titleW = doc.getTextWidth(title);
      const pageW  = doc.getTextWidth(pageStr);
      const dotsStart = MARGIN + titleW + 2;
      const dotsEnd   = PAGE_W - MARGIN - pageW - 2;
      const dotsAvail = dotsEnd - dotsStart;
      const dotW = doc.getTextWidth(' . ');
      const dotsCount = Math.max(0, Math.floor(dotsAvail / dotW));
      if (dotsCount > 0) {
        doc.text(' . '.repeat(dotsCount), dotsStart, ty);
      }
      // Hyperlink interno (clica e vai pra página)
      try { doc.link(MARGIN, ty-4, PAGE_W-2*MARGIN, 6, { pageNumber: entry.pageNum }); } catch(e){}
      ty += 8;
      if (ty > 270) break; // segurança: TOC cabe em 1 página
    }
  }

  const pgCount = doc.getNumberOfPages();
  if (pgCount > 1) doc.deletePage(pgCount);

  if (_saveOverride) {
    // Harness: callback recebe blob (ou Buffer) + filename
    const blob = doc.output('arraybuffer');
    await _saveOverride(blob, filename);
  } else {
    doc.save(filename);
  }
  return { filename };
}

/* ─── PPTX ────────────────────────────────────────────────── */
async function generatePptx({ allTips, segments, areaName, area, colors, filename, imagesByDest = {} }) {
  await loadPptxGenJS();
  const pptx   = new window.PptxGenJS();
  const primary= colors.primary   || '#475569';
  const bgColor= colors.secondary || '#1F2937';
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
    const heroImgData = await fetchImgData(heroUrl);
    const ds=pptx.addSlide(); ds.background={color:bgHex};
    if (heroImgData?.dataUrl) {
      try { ds.addImage({ data: heroImgData.dataUrl, x:0, y:0, w:W, h:H,
        sizing:{type:'cover',w:W,h:H} }); } catch(e) { console.warn('PPTX hero img:', e.message); }
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
          const imgDataP = await fetchImgData(imgUrl);
          const imgB64 = imgDataP?.dataUrl || null;

          if (imgB64) {
            // Image fills top ~55% of card
            const imgH = cH * 0.52;
            slide.addShape(pptx.ShapeType.rect,{x,y:sY,w:cW,h:cH,fill:{color:'FFFFFF'},line:{color:'E5E7EB',width:0.5}});
            try { slide.addImage({ data: imgB64, x, y:sY, w:cW, h:imgH,
              sizing:{type:'cover',w:cW,h:imgH} }); } catch(e) { console.warn('PPTX item img:', e.message); }
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
    const { fetchImages } = await import('./portal.js');
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

async function generateWebLink({ allTips, segments, areaName, area, colors, format, imagesOverride = {}, clientName = '' }) {
  // Lazy imports — só carrega firebase quando função é efetivamente chamada
  const { doc, collection, setDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  const { db }    = await import('../firebase.js');
  const { store } = await import('../store.js');

  const token  = await buildUniqueWebLinkSlug({ clientName, allTips });
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

/* ─── Slug builder for portal_web_links ──────────────────── */
// Gera tokens amigáveis tipo "joao-e-maria-nova-york-jan-2026"
// com fallback para "nova-york-jan-2026" / "nova-york" / "nova-york-2" em colisões.
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function buildSlugCandidates({ clientName, allTips }) {
  const MONTHS_SHORT = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const d    = new Date();
  const ym   = MONTHS_SHORT[d.getMonth()] + '-' + d.getFullYear();

  // Destino principal = primeiro destino da lista (cidade + opc. país)
  const first = allTips.find(({ dest }) => dest)?.dest || {};
  const destParts = [first.city, first.country].filter(Boolean).join(' ');
  const destSlug  = slugify(destParts) || slugify(first.continent || 'destino');

  const clientSlug = slugify(clientName);

  const candidates = [];
  if (clientSlug && destSlug) candidates.push(`${clientSlug}-${destSlug}-${ym}`);
  if (destSlug)               candidates.push(`${destSlug}-${ym}`);
  if (destSlug)               candidates.push(destSlug);
  // Fallback absoluto
  candidates.push(`link-${ym}`);
  return candidates;
}

async function slugExists(token) {
  const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  const { db } = await import('../firebase.js');
  try {
    const snap = await getDoc(doc(db, 'portal_web_links', token));
    return snap.exists();
  } catch {
    return false;
  }
}

async function buildUniqueWebLinkSlug({ clientName, allTips }) {
  const candidates = buildSlugCandidates({ clientName, allTips });

  for (const base of candidates) {
    if (!base) continue;
    if (!(await slugExists(base))) return base;
    // Colisão — tenta sufixos numéricos -2, -3, ...
    for (let n = 2; n <= 20; n++) {
      const alt = `${base}-${n}`;
      if (!(await slugExists(alt))) return alt;
    }
  }
  // Último recurso — token aleatório
  return generateToken();
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
