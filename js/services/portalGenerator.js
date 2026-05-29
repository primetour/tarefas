/**
 * PRIMETOUR — Portal de Dicas: Motor de Geração
 * Converte dados de dica + área em .docx, .pdf, .pptx ou link web
 *
 * Os imports de Firebase/portal/store são LAZY (dynamic await import dentro
 * das funções que precisam) pra permitir que generatePDF seja importável e
 * testável em Node (harness em tests/) sem trigger do firebase top-level.
 */

// Tokens compartilhados com o portal web — defaults de cor, fontes etc.
// Importa só o que é puro (sem firebase). Mantém identidade unificada.
import { DEFAULT_COLORS as PORTAL_DEFAULT_COLORS, getPortalColors } from './portalTokens.js';
// v4.62.39+ Fase A.3 — SSOT defaults + brand toggle (D7).
// portalTokens.PORTAL_DEFAULT_COLORS legacy mantido pra compat (re-exporta
// os mesmos valores do SSOT agora). Imports diretos do areaDefaults daqui em
// diante. portalTokens.js fica como adapter de transição.
import { resolveAreaDefaults, resolveExternalBrandName, resolveExportTemplate, formatExportText } from './areaDefaults.js';
// v4.63.40+ Markdown leve nos campos de descrição/observações.
import { parseRich, richToPlain } from './richText.js';

/**
 * v4.63.40+ Converte texto markdown leve em runs do docx (TextRun/ExternalHyperlink).
 * baseOpts permite override do size/italic/color base — usado pra observações.
 */
function _richDescToDocxRuns(text, font, gold, ExternalHyperlink, TextRun, baseOpts = {}) {
  const segs = parseRich(text);
  if (!segs.length) {
    return [new TextRun({ font, text: '', size: baseOpts.size || 18, color: baseOpts.color || '474650' })];
  }
  const runs = [];
  for (const s of segs) {
    const runOpts = {
      font,
      text: s.text,
      size: baseOpts.size || 18,
      color: baseOpts.color || '474650',
      bold: !!s.bold,
      italics: !!(s.italic || baseOpts.italic),
      underline: s.underline ? { type: 'single' } : undefined,
    };
    if (s.link) {
      const safeUrl = /^https?:\/\//i.test(s.link) ? s.link : `https://${s.link}`;
      runs.push(new ExternalHyperlink({
        link: safeUrl,
        children: [new TextRun({ ...runOpts, color: gold, underline: { type: 'single' }, style: 'Hyperlink' })],
      }));
    } else {
      runs.push(new TextRun(runOpts));
    }
  }
  return runs;
}

// SEGMENTS defaults (hardcoded como fallback se fetch falhar) + dinâmicos
// (carregados de portal_segments quando user cria customs).
// 4.40.18+ Agora é `let` ao invés de `const` — sobrescrito por _loadSegmentsAsync()
// na entrada de generateTip(). Cópia local pra evitar import circular com
// módulo que carrega firebase.
let SEGMENTS = [
  { key: 'informacoes_gerais',  label: 'Informações Gerais',                    mode: 'special_info', builtin: true },
  { key: 'bairros',             label: 'Bairros',                               mode: 'simple_list',  builtin: true },
  { key: 'atracoes',            label: 'Atrações',                              mode: 'place_list',   builtin: true },
  { key: 'atracoes_criancas',   label: 'Atrações para Crianças',                mode: 'place_list',   builtin: true },
  { key: 'restaurantes',        label: 'Restaurantes',                          mode: 'place_list',   builtin: true },
  { key: 'vida_noturna',        label: 'Vida Noturna',                          mode: 'place_list',   builtin: true },
  { key: 'espetaculos',         label: 'Casas de Espetáculos, Teatros e Cia.',  mode: 'place_list',   builtin: true },
  { key: 'compras',             label: 'Compras',                               mode: 'place_list',   builtin: true },
  { key: 'arredores',           label: 'Arredores',                             mode: 'simple_list',  builtin: true },
  { key: 'highlights',          label: 'Highlights',                            mode: 'place_list',   builtin: true },
  { key: 'agenda_cultural',     label: 'Agenda Cultural',                       mode: 'agenda',       builtin: true },
];

// 4.40.18+ Carrega SEGMENTS atualizados (defaults + customs) antes de gerar.
// Sem await aqui pra não bloquear o module load. Chamada no entrypoint
// generateTip() abaixo. Falha silenciosa cai pros defaults.
async function _loadSegmentsAsync() {
  try {
    const portalMod = await import('./portal.js');
    if (typeof portalMod.getSegments === 'function') {
      SEGMENTS = await portalMod.getSegments({ force: false });
    }
  } catch (e) {
    console.warn('[portalGenerator] _loadSegmentsAsync failed:', e?.message);
  }
}
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
// Poppins agora vem EMBEDADA no bundle (base64 em portalFonts.js) — sem
// dependência de CDN externa. Tamanho extra do bundle: ~500KB. Vale a
// pena pra garantir consistência tipográfica em qualquer ambiente.
import {
  POPPINS_REGULAR_B64, POPPINS_BOLD_B64, POPPINS_ITALIC_B64,
} from './portalFonts.js';

export async function loadPoppinsOnDoc(doc) {
  doc.addFileToVFS('Poppins-Regular.ttf', POPPINS_REGULAR_B64);
  doc.addFont('Poppins-Regular.ttf', 'Poppins', 'normal');
  doc.addFileToVFS('Poppins-Bold.ttf', POPPINS_BOLD_B64);
  doc.addFont('Poppins-Bold.ttf', 'Poppins', 'bold');
  doc.addFileToVFS('Poppins-Italic.ttf', POPPINS_ITALIC_B64);
  doc.addFont('Poppins-Italic.ttf', 'Poppins', 'italic');
  doc.setFont('Poppins', 'normal');
  const fontList = doc.getFontList ? doc.getFontList() : {};
  if (!fontList.Poppins) throw new Error('Poppins não registrou no doc.getFontList()');
  console.info('[portalPdf] Poppins ativa:', Object.keys(fontList.Poppins).join(','));
}

/* ─── Helper: site válido? ─────────────────────────────────
 * Retorna true só se o item.site existe E não é apenas whitespace.
 * Usado pra controlar se a pill "Visitar site" aparece.
 */
function hasValidSite(item) {
  if (!item || !item.site) return false;
  return String(item.site).trim().length > 0;
}

/* Normaliza URL: adiciona https:// se não tiver protocolo.
 * Sem isso, doc.link() do jsPDF cria a annotation mas o PDF reader
 * não sabe como tratar — link aparece visualmente mas não abre. */
function normalizeUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u; // já tem protocolo (http, https, mailto, tel)
  return 'https://' + u;
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
    case 'phone': { // smartphone moderno: retângulo arredondado + tela + botão home
      doc.setFillColor(r,g,b); doc.setDrawColor(r,g,b);
      // Corpo do telefone (retângulo arredondado vertical)
      const w = size * 0.45;
      const h = size * 0.72;
      const x = cx - w/2;
      const y = cy - h/2;
      doc.setLineWidth(size * 0.06);
      doc.roundedRect(x, y, w, h, size*0.06, size*0.06, 'S');
      // Tela (retângulo interno menor)
      const sx = x + size*0.05;
      const sy = y + size*0.10;
      const sw = w - size*0.10;
      const sh = h - size*0.20;
      doc.setLineWidth(size * 0.03);
      doc.rect(sx, sy, sw, sh, 'S');
      // Speaker no topo (linha curta)
      doc.setLineWidth(size * 0.05);
      doc.line(cx - size*0.08, y + size*0.05, cx + size*0.08, y + size*0.05);
      // Botão home (círculo pequeno na base)
      doc.circle(cx, y + h - size*0.05, size*0.03, 'S');
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
/* ─── Cover crop (browser) ─────────────────────────────────
 * Recebe dataURL de uma imagem e retorna outra com tamanho EXATO
 * (em px @300dpi pra mm alvo) usando "cover fit" — preenche toda
 * a área alvo cortando o excesso centralizado, sem distorção.
 *
 * Usado pro hero do PDF: foto sempre full width, mesmo quando a
 * altura disponível é diferente do aspect ratio original.
 *
 * Em Node (harness), retorna a dataURL original.
 */
export async function coverCropImage({ dataUrl, finalWmm, finalHmm, dpi = 300 }) {
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    return dataUrl;
  }
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload  = () => resolve(im);
    im.onerror = reject;
    im.src = dataUrl;
  });
  // mm → px (1mm = dpi/25.4 px; @300dpi ≈ 11.81)
  const pxPerMm = dpi / 25.4;
  const wPx = Math.max(64, Math.round(finalWmm * pxPerMm));
  const hPx = Math.max(64, Math.round(finalHmm * pxPerMm));
  const canvas = document.createElement('canvas');
  canvas.width = wPx; canvas.height = hPx;
  const ctx = canvas.getContext('2d');
  // Calcula scale pra cover (preencher) e crop centralizado
  const scaleW = wPx / Math.max(img.naturalWidth, 1);
  const scaleH = hPx / Math.max(img.naturalHeight, 1);
  const scale = Math.max(scaleW, scaleH);
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const dx = (wPx - drawW) / 2;
  const dy = (hPx - drawH) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, dx, dy, drawW, drawH);
  return canvas.toDataURL('image/jpeg', 0.92);
}

/**
 * Compositа logo em canvas e retorna dataURL PNG + dimensões reais.
 * O canvas é dimensionado pelo aspect ratio NATURAL do logo (não pelo
 * bounds fixo) — assim o resultado fica do mesmo tamanho que o logo
 * original, sem áreas de fundo "vazias" ao redor que pareciam "card".
 *
 * @returns { dataUrl, widthMm, heightMm } — usar widthMm/heightMm direto no addImage
 */
export async function compositeLogoOnBackground({ logoDataUrl, bgColorHex, maxWmm, maxHmm, padPct = 0.04 }) {
  // Defaults backward-compat: aceita finalWmm/finalHmm também
  maxWmm = maxWmm ?? arguments[0]?.finalWmm ?? 80;
  maxHmm = maxHmm ?? arguments[0]?.finalHmm ?? 45;
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    // Node/harness — sem composite real, retorna dataURL + dims máximas
    return { dataUrl: logoDataUrl, widthMm: maxWmm, heightMm: maxHmm };
  }
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = logoDataUrl;
  });
  const naturalRatio = img.naturalWidth / Math.max(img.naturalHeight, 1);
  // Calcula dimensões finais respeitando aspect ratio + bounds máximos
  let finalWmm = maxWmm, finalHmm = finalWmm / naturalRatio;
  if (finalHmm > maxHmm) { finalHmm = maxHmm; finalWmm = finalHmm * naturalRatio; }
  // Canvas em pixels (300dpi → 1mm ≈ 11.81px)
  const wPx = Math.max(96, Math.round(finalWmm * 11.81));
  const hPx = Math.max(96, Math.round(finalHmm * 11.81));
  const canvas = document.createElement('canvas');
  canvas.width = wPx; canvas.height = hPx;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bgColorHex;
  ctx.fillRect(0, 0, wPx, hPx);
  // Logo preenche o canvas inteiro (com pad interno minimo)
  const drawW = wPx * (1 - padPct * 2);
  const drawH = hPx * (1 - padPct * 2);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, padPct * wPx, padPct * hPx, drawW, drawH);
  return { dataUrl: canvas.toDataURL('image/png'), widthMm: finalWmm, heightMm: finalHmm };
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
// v4.57.41 fix integração PD8: anti-double-submit. Click duplo rápido em
// "Gerar PDF/DOCX/PPTX/Web" disparava 2 generateTip() em paralelo. Memory
// spike (jsPDF tem race de prototype init via autoTable plugin), e cria 2
// entries duplicadas em portal_generations + portal_web_links. Flag por
// (tipId+format) — permite formatos diferentes em paralelo (PDF+DOCX OK).
// TTL 30s defensivo se promise pendurar.
const _genInFlight = new Map();  // key=`${tipId}::${format}` → timestamp

export async function generateTip({ tip, area, dest, segments, format, extraTips = [], imagesOverride = {}, heroImageOverride = {}, clientName = '' }) {
  const tipId = tip?.id || dest?.id || 'standalone';
  const inflightKey = `${tipId}::${format}`;
  const startedAt = _genInFlight.get(inflightKey);
  if (startedAt && (Date.now() - startedAt) < 30_000) {
    throw new Error(`Já existe uma exportação ${String(format || 'pdf').toUpperCase()} em andamento desta dica. Aguarde.`);
  }
  _genInFlight.set(inflightKey, Date.now());
  // v4.63.61 B2: try/finally garante release do lock. Antes vazava em TODOS
  // os paths (sucesso E erro). User pegava "Já existe exportação em andamento"
  // por 30s após cada geração bem-sucedida. Auditoria pós-incidente.
  try {
  // 4.40.18+ Garante que SEGMENTS está atualizado (incl. customs) antes de
  // qualquer iteração. Sem isso, segmentos customs sumiam dos exports.
  await _loadSegmentsAsync();

  const allTips  = [{ tip, dest }, ...extraTips];
  // v4.62.40 Fase B (D7): brand name respeita area.brand.useExternalName toggle.
  // Antes: sempre area.name || 'PRIMETOUR' (sem opção de forçar guarda-chuva).
  const areaName = resolveExternalBrandName(area);
  // v4.62.39+ Fase A.3: cores via SSOT (resolve overrides por módulo + global)
  const _tpl = resolveAreaDefaults(area, 'portal');
  // v4.63.33+ accent é 3ª cor configurável. Fallback: accent → primary.
  const colors = {
    primary: _tpl.colors.primary,
    secondary: _tpl.colors.secondary,
    accent: _tpl.colors.accent || _tpl.colors.primary,
  };
  const filename = buildFilename(allTips, format);

  const imagesByDest = {};
  for (const { dest: d } of allTips) {
    if (d?.id) {
      imagesByDest[d.id] = await resolveImages(d);
      // Override de FOTO DE CAPA (hero) por destino — feature de UX
      // que permite escolher na hora de gerar, sem mexer no banco.
      const heroOv = heroImageOverride[d.id];
      if (heroOv?.url) {
        imagesByDest[d.id].hero = heroOv.url;
      }
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

  // v4.63.11+ Se área tem template configurado pra este formato, usa
  // renderTemplate em vez do pipeline jsPDF/docx/pptxgenjs. Fallback graceful
  // em qualquer falha. Web continua sempre via generateWebLink (templates
  // de Web não fazem sentido — portal-view.html é a "view" canônica).
  if (format !== 'web') {
    const _tplFmtKey = format === 'pdf' ? 'html' : format;  // PDF é renderizado a partir de HTML
    const _tplId = area?.templateRefs?.portal?.[_tplFmtKey];
    if (_tplId) {
      // v4.63.14+ Perf #1: progress indicator dinâmico
      let _progressId = null;
      let _toast = null;
      try {
        _toast = (await import('../components/toast.js')).toast;
        _progressId = _toast.info('Carregando template…', `Gerando ${format.toUpperCase()}`, 90_000);
      } catch {}
      try {
        const { renderTemplate, downloadBlob } = await import('./templates.js');
        const { portalToTemplateData } = await import('./templateAdapter.js');
        try { if (_progressId && _toast) _toast.update(_progressId, format === 'pdf' ? 'Renderizando PDF (Puppeteer ~5-10s)…' : `Renderizando ${format.toUpperCase()} (docxtemplater ~3s)…`); } catch {}
        // v4.63.17+ Passa imagesByDest + customFooter/Header + hideCover pro
        // template HTML seed "PRIMETOUR Portal Default" reproduzir o jsPDF.
        const _exportTpl = resolveExportTemplate(area, 'portal', format === 'pdf' ? 'pdf' : format);
        const _customFooter = formatExportText(_exportTpl.footerText || '', { areaName, title: 'Portal de Dicas' });
        const _customHeader = formatExportText(_exportTpl.headerText || '', { areaName, title: 'Portal de Dicas' });
        const data = portalToTemplateData({
          allTips, area, segments, areaName,
          imagesByDest,
          customFooterText: _customFooter,
          customHeaderText: _customHeader,
          hideCover: !!_exportTpl.hideCover,
        });
        const result = await renderTemplate(_tplId, data);
        try { if (_progressId && _toast) _toast.update(_progressId, 'Baixando arquivo…'); } catch {}
        downloadBlob(result.blob, result.filename);
        try { if (_progressId && _toast) _toast.remove(_progressId); } catch {}
        return { filename: result.filename };
      } catch (e) {
        try { if (_progressId && _toast) _toast.remove(_progressId); } catch {}
        // v4.63.12+ Fix HIGH Bug #7/#8/#9 (audit pós-sprint): fallback graceful
        // antes silencioso. Avisa user + audit log pra triagem ("achei que minha
        // marca tava aplicada mas saiu o padrão").
        console.warn(`[portalGenerator] template ${format} falhou, fallback pipeline:`, e?.message || e);
        try {
          const { toast } = await import('../components/toast.js');
          toast.warning(`Template ${format.toUpperCase()} falhou (${e?.message?.slice(0,80) || 'erro desconhecido'}). Gerando com padrão do sistema. Verifique no Editor de Áreas → Templates.`);
        } catch {}
        try {
          // v4.63.21+ Fix H1 (audit pós-sprint): era `logAction` (undefined export).
          // Signature real: auditLog(action, entity, entityId, details).
          const { auditLog } = await import('../auth/audit.js');
          await auditLog('templates.fallback', 'templates', _tplId, {
            module: 'portal', format,
            areaId: area?.id || '',
            reason: String(e?.message || e).slice(0, 200),
          });
        } catch (auditErr) { console.warn('[portalGenerator] auditLog fallback falhou:', auditErr?.message); }
      }
    }
  }

  // v4.63.34+ Bug fix: enrichGalleryWithAutoPhotos antes ROUVAVA SÓ
  // em generateWebLink (linha ~2431). PDFs/DOCX/PPTX caíam direto no
  // pickImg conservador (só match exato placeName) → sem fotos.
  // Renê reportou Centurion PDF: "o sistema fala que vai definir
  // automaticamente as fotos para os segmentos, mas nenhuma foto aparece".
  // Move pra ANTES do switch — TODOS os formatos ganham auto-photos.
  // Skip pro web (generateWebLink já chama internamente — não duplicar).
  if (format !== 'web') {
    try {
      await enrichGalleryWithAutoPhotos(imagesByDest, allTips, segments);
    } catch (e) {
      console.warn('[portalGenerator] enrichGallery falhou (nao-blocker):', e?.message || e);
    }
  }

  // v4.63.61 B2: await garante release do lock SÓ depois que a geração termina.
  // Antes: `return generateDocx(...)` retornava Promise pending → finally
  // disparava imediatamente, lock liberava no início da geração (defeito não fix).
  switch (format) {
    case 'docx': return await generateDocx({ allTips, segments, areaName, area, colors, filename, imagesByDest });
    case 'pdf':  return await generatePDF({ allTips, segments, areaName, area, colors, filename, imagesByDest });
    case 'pptx': return await generatePptx({ allTips, segments, areaName, area, colors, filename, imagesByDest });
    case 'web':  return await generateWebLink({ allTips, segments, areaName, area, colors, format, imagesOverride, heroImageOverride, clientName });
    default:     throw new Error(`Formato desconhecido: ${format}`);
  }
  } finally {
    _genInFlight.delete(inflightKey);
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
// 4.49.22+ Helper pra detectar segmentos efetivamente VAZIOS.
// Antes: buildContent só checava `!data`. Resultado: se um segmento
// existia no doc mas com `items=[]` e sem texto, o exporter renderizava
// o HEADING ("RESTAURANTES") seguido de espaço em branco.
// User reportou: "vi um roteiro/dica que carregava um bloco vazio. Se
// está vazio, precisaria ocultar". Esta função aplica o mesmo critério
// do segHasContent() do editor (v4.49.13+).
function segHasContent(segDef, data) {
  if (!data) return false;
  // special_info (Informações Gerais): considera qualquer campo do info preenchido
  if (segDef.mode === 'special_info') {
    const info = data.info || {};
    if (info.descricao || info.dica) return true;
    if (info.populacao || info.moeda || info.lingua || info.religiao) return true;
    if (info.voltagem  || info.ddd   || info.fusoSinal || info.fusoHoras) return true;
    if (info.representacao?.nome) return true;
    const cli = info.clima || {};
    for (let i = 0; i < 12; i++) {
      if (cli[`max_${i}`] != null || cli[`min_${i}`] != null) return true;
    }
    return false;
  }
  // simple_list (Bairros, Arredores): items + (themeDesc opcional)
  if (segDef.mode === 'simple_list') {
    if (Array.isArray(data.items) && data.items.some(it =>
      (it?.title || it?.titulo || it?.description))) return true;
    if (typeof data.themeDesc === 'string' && data.themeDesc.trim()) return true;
    return false;
  }
  // place_list (Atrações, Restaurantes, Compras…) e agenda
  // v4.63.39+ Ignora subtitles (type='subtitle') na contagem de conteúdo —
  // segment com SÓ subtitles vazios não conta como ter conteúdo.
  if (Array.isArray(data.items) && data.items.some(it =>
    it?.type !== 'subtitle' && (it?.titulo || it?.title || it?.descricao || it?.description))) return true;
  if (typeof data.themeDesc === 'string' && data.themeDesc.trim()) return true;
  if (typeof data.periodoAgenda === 'string' && data.periodoAgenda.trim()) return true;
  return false;
}

function buildContent(tip, segments) {
  const segs = [];
  for (const segKey of segments) {
    const segDef = SEGMENTS.find(s => s.key === segKey);
    const data   = tip?.segments?.[segKey];
    if (!segDef || !data) continue;
    // 4.49.22+ Skip silencioso de segmento vazio — sem isso renderizava
    // só o cabeçalho do segmento e ficava feio no PDF/Word/PPT.
    if (!segHasContent(segDef, data)) continue;
    segs.push({ segDef, data });
  }
  return segs;
}

// Label de destino: cidade + país. SEM continente (era ruído visual,
// "América do Norte" não agrega informação útil pro cliente).
function destLabel(dest) {
  return [dest?.city, dest?.country].filter(Boolean).join(', ');
}

/* ─── DOCX ────────────────────────────────────────────────── */

/* ─── Image picker helper (shared by all formats) ─────────── */
function pickImg(item, idx, imgs, segKey) {
  if (!imgs) return null;
  const overrides = imgs._overrides || {};
  const title = (item?.titulo || item?.title || '').toLowerCase().trim();

  // ESTRATÉGIA CONSERVADORA: só retorna foto se houver match EXPLÍCITO.
  // Antes a galeria automática "casava por keyword" e mostrava fotos
  // aleatórias (ex: foto de Central Park aparecia em Restaurantes).
  // Agora: 1) override explícito por idx, 2) override por título exato,
  // 3) gallery match por placeName EXATO. Sem mais matching por keyword.

  // (1) Override por idx
  if (segKey && overrides[segKey]) {
    const segOv = overrides[segKey];
    const ovByIdx = segOv[idx] || segOv[String(idx)];
    if (ovByIdx?.url) return ovByIdx.url;
    // (2) Override por título: só match exato ou containment forte
    if (title && title.length >= 4) {
      for (const k of Object.keys(segOv)) {
        const o = segOv[k];
        const oName = (o?.name || o?.placeName || '').toLowerCase().trim();
        if (!oName || oName.length < 4) continue;
        if (oName === title) return o.url || null;
      }
    }
  }
  // (3) Gallery: APENAS placeName EXATO (não mais partial/keywords)
  const gallery = imgs.gallery || [];
  if (!title || title.length < 4) return null;
  const m = gallery.find(g => g.placeName && g.placeName.toLowerCase().trim() === title);
  return m?.url || null;
}

const R2_PROXY = 'https://primetour-images.rene-castro.workers.dev';

// v4.63.38+ Origins que servem CORS-safe direto (sem precisar do proxy R2).
// O proxy R2 retorna 403 pra URLs externas — só serve pub-*.r2.dev.
// Renê reportou: "fallback do unsplash nao funciona — exportei dica de Orlando
// sem fotos no banco e o PDF saiu sem nenhuma foto". Causa raiz: TODAS as URLs
// passavam pelo proxy, incluindo Unsplash/Wikipedia que falhavam.
const DIRECT_FETCH_ORIGINS = [
  'https://images.unsplash.com/',
  'https://upload.wikimedia.org/',
  'https://en.wikipedia.org/',
  'https://pt.wikipedia.org/',
  'https://i.imgur.com/',
  'https://image.viagens.', // partner image servers (newsletter etc — viagens.*)
  'https://image.centurion.',
  'https://image.exct.net/',
  'https://image.s10.exacttarget.com/',
  'https://ftpprime.blob.core.windows.net/',
  'https://storage.googleapis.com/',
  'https://lh3.googleusercontent.com/',
];

function _shouldUseProxy(url) {
  // Proxy SÓ pra R2 bucket (pub-*.r2.dev) ou worker direto
  if (url.includes('pub-') && url.includes('.r2.dev/')) return true;
  if (url.startsWith(R2_PROXY)) return false; // já é proxy
  // Origin direto?
  if (DIRECT_FETCH_ORIGINS.some(o => url.startsWith(o))) return false;
  // Default conservador: proxy. (Bucket próprio + fallback safe pra orgs novas)
  return true;
}

/* Fetch image via CORS-safe proxy OU direto se origem suporta CORS,
   return { dataUrl, mimeType, ext, arrayBuffer } */
async function fetchImgData(url) {
  if (!url) return null;
  try {
    // v4.63.38+ Decide entre proxy (R2 próprio) e fetch direto (Unsplash/Wiki CORS-*).
    const useProxy = _shouldUseProxy(url);
    const targetUrl = useProxy ? `${R2_PROXY}?url=${encodeURIComponent(url)}` : url;
    const res = await fetch(targetUrl);
    if (!res.ok) {
      // Fallback: se proxy falhou (403/etc), tenta direto (Unsplash CORS-safe).
      if (useProxy) {
        console.warn(`[fetchImgData] proxy falhou ${res.status} — tentando direto: ${url.slice(0, 80)}`);
        try {
          const direct = await fetch(url);
          if (!direct.ok) return null;
          return _processImageResponse(direct);
        } catch (e) {
          console.warn('[fetchImgData] fetch direto também falhou:', e?.message);
          return null;
        }
      }
      return null;
    }
    return _processImageResponse(res);
  } catch (e) {
    console.warn('[fetchImgData] erro inesperado:', e?.message);
    return null;
  }
}

// v4.63.38+ Helper extraído: processa Response → { dataUrl, mimeType, ext, arrayBuffer }
// Permite reuso entre fetch via proxy E fetch direto (fallback).
async function _processImageResponse(res) {
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
  let arrayBuffer = await blob.arrayBuffer();
  let outDataUrl  = dataUrl;
  let outExt      = ext;
  let outMime     = mime;
  // WebP não é suportado por docx ImageRun NEM por pptxgenjs. Converte
  // pra PNG via canvas antes de devolver — tanto arrayBuffer (DOCX) quanto
  // dataUrl (PDF/PPTX) usam a versão PNG. PDF do jsPDF aceita webp mas
  // como já normalizamos, mantém consistente.
  if (mime === 'image/webp' && typeof Image !== 'undefined' && typeof document !== 'undefined') {
    try {
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = dataUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      const pngBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      if (pngBlob) {
        arrayBuffer = await pngBlob.arrayBuffer();
        outDataUrl  = canvas.toDataURL('image/png');
        outExt      = 'png';
        outMime     = 'image/png';
      }
    } catch(e) { console.warn('[portalGen] webp→png conversion failed:', e?.message); }
  }
  return { dataUrl: outDataUrl, mimeType: outMime, ext: outExt, arrayBuffer };
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

  // v4.62.41 Fase C: fonte dinâmica derivada de area.fonts (SSOT).
  // Antes: 'Poppins' hardcoded em 30+ TextRun. Agora Word respeita escolha
  // de tipografia da BU (Cormorant Garamond, Playfair, etc.). Renderização
  // depende da fonte instalada no SO do cliente — Word substitui graciosamente
  // se ausente (comportamento padrão).
  const _DOCX_TPL = resolveAreaDefaults(area, 'portal');
  const _DOCX_FONT = _DOCX_TPL.fonts.body || 'Poppins';

  // Vars mantêm os nomes legados (gold/navy) por compatibilidade com o
  // restante do generator. v4.63.33+ `gold` agora prioriza colors.accent
  // (a 3ª cor configurável). Antes era hardcoded em primary, que confundia
  // áreas com primary escuro (texto invisível) ou áreas que queriam um tom
  // de destaque diferente do primary.
  const gold = (colors.accent || colors.primary || PORTAL_DEFAULT_COLORS.primary).replace('#','');
  const navy = (colors.secondary || PORTAL_DEFAULT_COLORS.secondary).replace('#','');
  const children = [];
  const date = new Date().toLocaleDateString('pt-BR',{year:'numeric',month:'long',day:'numeric'});

  // Use shared fetchImgData (CORS-safe, returns arrayBuffer + mimeType)

  // v4.62.46+ resolve template cedo p/ hideCover (template completo é reusado linha ~871)
  const _docxExportTplEarly = resolveExportTemplate(area, 'portal', 'docx');

  // Cover — logo (se houver) + nome da área + destinos + data
  // Padrão alinhado com o PDF: logo grande no topo, depois título.
  if (!_docxExportTplEarly.hideCover) {
    const coverLogoData = await fetchImgData(area?.logoUrl);
    if (coverLogoData?.arrayBuffer) {
      try {
        children.push(new Paragraph({
          children:[new ImageRun({data:coverLogoData.arrayBuffer,
            transformation:{width:280,height:140},type:coverLogoData.ext})],
          alignment:AlignmentType.CENTER,
          spacing:{before:1800,after:200},
        }));
      } catch(e) { console.warn('DOCX cover logo skip:', e.message); }
    }
    children.push(new Paragraph({children:[new TextRun({font:_DOCX_FONT,text:areaName.toUpperCase(),bold:true,size:52,color:gold,characterSpacing:200})],alignment:AlignmentType.CENTER,spacing:{before:coverLogoData?.arrayBuffer?0:2400,after:160}}));
    children.push(new Paragraph({children:[new TextRun({font:_DOCX_FONT,text:'PORTAL DE DICAS',size:18,color:'888888',characterSpacing:300})],alignment:AlignmentType.CENTER,spacing:{after:600}}));
    for(const{dest}of allTips) children.push(new Paragraph({children:[new TextRun({font:_DOCX_FONT,text:destLabel(dest),bold:true,size:28,color:navy})],alignment:AlignmentType.CENTER,spacing:{after:120}}));
    children.push(new Paragraph({children:[new TextRun({font:_DOCX_FONT,text:'─────────────────────────',color:gold,size:16})],alignment:AlignmentType.CENTER,spacing:{before:400,after:200}}));
    children.push(new Paragraph({children:[new TextRun({font:_DOCX_FONT,text:date,size:16,color:'AAAAAA'})],alignment:AlignmentType.CENTER}));
    children.push(new Paragraph({children:[new PageBreak()]}));
  }

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

    children.push(new Paragraph({children:[new TextRun({font:_DOCX_FONT,text:label.toUpperCase(),bold:true,size:32,color:navy,characterSpacing:120})],spacing:{before:heroData?.arrayBuffer?100:400,after:80},border:{bottom:{style:BorderStyle.SINGLE,size:12,color:gold}}}));
    children.push(new Paragraph({spacing:{after:200}}));

    const content=buildContent(tip,segments);
    for(const{segDef,data}of content){
      // Heading do segmento — respiro generoso antes (separa do bloco anterior)
      children.push(new Paragraph({children:[new TextRun({font:_DOCX_FONT,text:segDef.label.toUpperCase(),bold:true,size:16,color:gold,characterSpacing:250})],spacing:{before:600,after:120},border:{left:{style:BorderStyle.SINGLE,size:18,color:gold}},indent:{left:120}}));
      children.push(new Paragraph({spacing:{after:200}}));

      if(segDef.mode==='special_info'){
        const inf=data.info||{};
        // Limpa CLIMA + REPRESENTAÇÃO da descrição (renderizadas como blocos próprios)
        const repObj=inf.representacao||{};
        const { descricao: descClean, climate } = parseDescricao(inf.descricao, !!repObj.nome);

        // ── DESCRIÇÃO em parágrafo (largura total) ──
        // v4.63.52: usa _richDescToDocxRuns pra renderizar bold/italic/link
        // (markdown leve da toolbar do editor — antes saía literal "**texto**").
        if (descClean) {
          children.push(new Paragraph({
            children:[new TextRun({font:_DOCX_FONT,text:'DESCRIÇÃO',size:13,bold:true,color:gold,characterSpacing:200})],
            spacing:{before:120,after:120},
          }));
          children.push(new Paragraph({
            children:_richDescToDocxRuns(descClean, _DOCX_FONT, gold, ExternalHyperlink, TextRun, { size: 20, color: '474650' }),
            spacing:{after:400, line:320},
          }));
        }
        // ── DICA em callout (texto destacado) ──
        if (inf.dica) {
          children.push(new Paragraph({
            children:[new TextRun({font:_DOCX_FONT,text:'DICA DO CONCIERGE',size:13,bold:true,color:gold,characterSpacing:200})],
            spacing:{before:300,after:120},
          }));
          children.push(new Paragraph({
            children:_richDescToDocxRuns(inf.dica, _DOCX_FONT, gold, ExternalHyperlink, TextRun, { size: 20, italics: true, color: '474650' }),
            spacing:{after:400, line:320},
            indent:{left:200},
          }));
        }
        // ── DADOS BÁSICOS em flow (label: value, um por linha) ──
        const dataRows = [
          ['População',  inf.populacao],
          ['Moeda',      inf.moeda],
          ['Língua oficial', inf.lingua],
          ['Religião',   inf.religiao],
          ['Fuso horário', inf.fusoSinal&&inf.fusoHoras?`${inf.fusoSinal}${inf.fusoHoras}h de Brasília`:''],
          ['Voltagem',   inf.voltagem],
          ['DDD',        inf.ddd],
        ].filter(([,v])=>v);
        if (dataRows.length) {
          children.push(new Paragraph({
            children:[new TextRun({font:_DOCX_FONT,text:'DADOS BÁSICOS',size:13,bold:true,color:gold,characterSpacing:200})],
            spacing:{before:300,after:160},
          }));
          for (const [label, value] of dataRows) {
            children.push(new Paragraph({
              children:[
                new TextRun({font:_DOCX_FONT,text:label+': ',size:20,bold:true,color:navy}),
                new TextRun({font:_DOCX_FONT,text:String(value),size:20,color:'474650'}),
              ],
              spacing:{after:120},
            }));
          }
          children.push(new Paragraph({spacing:{after:240}}));
        }
        // CLIMA — tabela 13 col (°C + 12 meses) com linhas Máx/Mín
        // Aceita formato web (cli.max_0..max_11) ou parsed (climate.max[])
        const cli = inf.clima || {};
        const monthsArr = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        const maxArr = climate?.max || monthsArr.map((_,i)=>cli[`max_${i}`] ?? null);
        const minArr = climate?.min || monthsArr.map((_,i)=>cli[`min_${i}`] ?? null);
        const hasClimate = maxArr.some(v=>v!=null) || minArr.some(v=>v!=null);
        if (hasClimate) {
          children.push(new Paragraph({children:[new TextRun({font:_DOCX_FONT,text:'CLIMA',size:13,bold:true,color:gold,characterSpacing:200})],spacing:{before:400,after:160}}));
          const climaCell = (txt, bold=false) => new TableCell({
            width:{size:660,type:WidthType.DXA},
            borders:{top:{style:BorderStyle.SINGLE,size:2,color:'EEEEEE'},bottom:{style:BorderStyle.SINGLE,size:2,color:'EEEEEE'},left:{style:BorderStyle.SINGLE,size:2,color:'EEEEEE'},right:{style:BorderStyle.SINGLE,size:2,color:'EEEEEE'}},
            children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({font:_DOCX_FONT,text:String(txt),size:14,bold,color:bold?gold:'474650'})]})],
          });
          const headerRow = new TableRow({children:[climaCell('°C',true), ...monthsArr.map(m=>climaCell(m,true))]});
          const maxRow    = new TableRow({children:[climaCell('Máx ↑',true), ...maxArr.map(v=>climaCell(v??'—'))]});
          const minRow    = new TableRow({children:[climaCell('Mín ↓',true), ...minArr.map(v=>climaCell(v??'—'))]});
          children.push(new Table({rows:[headerRow, maxRow, minRow], width:{size:9240,type:WidthType.DXA}}));
          children.push(new Paragraph({spacing:{after:300}}));
        }
        const rep=inf.representacao||{};
        if(rep.nome){
          children.push(new Paragraph({children:[new TextRun({font:_DOCX_FONT,text:'REPRESENTAÇÃO BRASILEIRA',size:13,bold:true,color:gold,characterSpacing:200})],spacing:{before:400,after:160}}));
          for(const[l,v]of[['Nome',rep.nome],['Endereço',rep.endereco],['Telefone',rep.telefone],['Site',rep.link]].filter(([,v])=>v)){
            if(l==='Site') children.push(new Paragraph({children:[new TextRun({font:_DOCX_FONT,text:`${l}: `,bold:true,size:18,color:navy}),new ExternalHyperlink({link:normalizeUrl(v),children:[new TextRun({font:_DOCX_FONT,text:normalizeUrl(v),size:18,style:'Hyperlink',color:gold})]})],spacing:{after:120}}));
            else children.push(new Paragraph({children:[new TextRun({font:_DOCX_FONT,text:`${l}: `,bold:true,size:18,color:navy}),new TextRun({font:_DOCX_FONT,text:v,size:18,color:'474650'})],spacing:{after:120}}));
          }
        }
      } else if(segDef.mode==='simple_list'){
        // Dedupe por título (data legada vinda de import PDF pode ter
        // duplicatas que causariam todos os bairros aparecerem 2x)
        const seenTitles = new Set();
        const uniqueItems = (data.items||[]).filter(it => {
          if (!it.title) return false;
          const k = it.title.trim().toLowerCase();
          if (seenTitles.has(k)) return false;
          seenTitles.add(k);
          return true;
        });
        for(const item of uniqueItems){
          children.push(new Paragraph({children:[new TextRun({font:_DOCX_FONT,text:item.title,bold:true,size:22,color:navy})],spacing:{before:360,after:120}}));
          if(item.description) children.push(new Paragraph({children:_richDescToDocxRuns(item.description, _DOCX_FONT, gold, ExternalHyperlink, TextRun, { size: 20, color: '474650' }),spacing:{after:240, line:320}}));
        }
      } else {
        if(data.themeDesc) children.push(new Paragraph({children:_richDescToDocxRuns(data.themeDesc, _DOCX_FONT, gold, ExternalHyperlink, TextRun, { size: 18, italics: true, color: '474650' }),spacing:{after:160}}));

        // Dedupe + ordena por categoria pra agrupar (heading da categoria
        // só uma vez por grupo, não em cada item).
        // v4.63.39+ Subtítulos PRESERVAM ordem original (sem dedup nem sort)
        // pra que o agrupamento que o consultor definiu seja respeitado.
        const seenItemTitles = new Set();
        const hasSubtitles = (data.items || []).some(it => it?.type === 'subtitle');
        const uniqueItems = (data.items||[]).filter(it => {
          if (it?.type === 'subtitle') return !!it.text;  // mantém subtitles com texto
          if (!it.titulo) return false;
          const k = it.titulo.trim().toLowerCase();
          if (seenItemTitles.has(k)) return false;
          seenItemTitles.add(k);
          return true;
        });
        // Estável: ordena por (categoria, índice original).
        // SE houver subtitle, mantém ordem do consultor (sort iria misturar grupos).
        const indexed = uniqueItems.map((it,i)=>({it,i}));
        if (!hasSubtitles) {
          indexed.sort((a,b)=>{
            const ca=(a.it.categoria||'').toLowerCase();
            const cb=(b.it.categoria||'').toLowerCase();
            return ca.localeCompare(cb) || a.i - b.i;
          });
        }
        let lastCategoria = null;

        for(const {it: item, i: itemIdx} of indexed){
          // v4.63.39+ Subtítulo inline ANTES de qualquer pre-load — não tem
          // imagem nem categoria, é só uma faixa de heading. Reseta cat tracker.
          if (item?.type === 'subtitle') {
            if (item.text) {
              children.push(new Paragraph({
                children: [new TextRun({ font:_DOCX_FONT, text:String(item.text).toUpperCase(), bold:true, size:18, color:gold, characterSpacing:200 })],
                spacing: { before: 300, after: 120 },
                border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: gold } },
              }));
              lastCategoria = null;  // força reprint da categoria após subtitle
            }
            continue;
          }

          // Image
          const imgUrl=pickImg(item,itemIdx,imgs,segDef.key);
          const imgData=await fetchImgData(imgUrl);

          // Categoria heading SÓ quando muda (agrupa)
          const cat = (item.categoria||'').trim();
          if(cat && cat !== lastCategoria){
            children.push(new Paragraph({children:[new TextRun({font:_DOCX_FONT,text:cat.toUpperCase(),size:13,color:gold,bold:true,characterSpacing:200})],spacing:{before:240,after:20}}));
            lastCategoria = cat;
          }

          children.push(new Paragraph({children:[new TextRun({font:_DOCX_FONT,text:item.titulo,bold:true,size:22,color:navy})],spacing:{after:imgData?.arrayBuffer?80:60}}));

          // v4.63.37+ Tags inline (chips visuais em texto separado por · e em itálico colorido)
          if (Array.isArray(item.tags) && item.tags.length) {
            children.push(new Paragraph({children:[new TextRun({font:_DOCX_FONT,text:item.tags.map(t => `· ${t}`).join('  '),size:14,italics:true,color:gold})],spacing:{after:60}}));
          }

          if(imgData?.arrayBuffer){
            try {
              children.push(new Paragraph({
                children:[new ImageRun({data:imgData.arrayBuffer,transformation:{width:420,height:220},type:imgData.ext})],
                spacing:{after:120},
              }));
            } catch(e) { console.warn('Item image skip:', e.message); }
          }

          // v4.63.40+ Rich text: parse markdown e mapeia pra TextRuns com bold/italics/underline + ExternalHyperlink
          if (item.descricao) {
            const runs = _richDescToDocxRuns(item.descricao, _DOCX_FONT, gold, ExternalHyperlink, TextRun);
            children.push(new Paragraph({ children: runs, spacing: { after: 80 } }));
          }
          const det=[item.endereco&&`📍 ${item.endereco}`,item.telefone&&`📞 ${item.telefone}`].filter(Boolean);
          if(det.length) children.push(new Paragraph({children:[new TextRun({font:_DOCX_FONT,text:det.join('   '),size:16,color:'888888'})],spacing:{after:60}}));
          if(hasValidSite(item)) children.push(new Paragraph({children:[new TextRun({font:_DOCX_FONT,text:'🌐 ',size:16}),new ExternalHyperlink({link:normalizeUrl(item.site),children:[new TextRun({font:_DOCX_FONT,text:normalizeUrl(item.site),size:18,style:'Hyperlink',color:gold})]})],spacing:{after:60}}));
          if (item.observacoes) {
            // v4.63.40+ Rich text nas observações também
            const obsRuns = [new TextRun({ font: _DOCX_FONT, text: '💡 ', size: 16 })];
            const obsContent = _richDescToDocxRuns(item.observacoes, _DOCX_FONT, gold, ExternalHyperlink, TextRun, { size: 16, italic: true, color: 'AAAAAA' });
            obsRuns.push(...obsContent);
            children.push(new Paragraph({ children: obsRuns, spacing: { after: 80 } }));
          }
          children.push(new Paragraph({border:{bottom:{style:BorderStyle.SINGLE,size:2,color:'EEEEEE'}},spacing:{after:80}}));
        }
      }
    }
    children.push(new Paragraph({children:[new PageBreak()]}));
  }

  // v4.62.45+ Fase E pós-audit: footerText/headerText custom da BU em DOCX.
  // headerText vira parágrafo de pré-rodapé. footerText vai como Section
  // footer real do docx (cabeçalho/rodapé fixo em todas as páginas).
  const _docxExportTpl = _docxExportTplEarly; // reusa do hideCover
  const _docxCustomFooter = formatExportText(_docxExportTpl.footerText || '', { areaName, title: 'Portal de Dicas' });
  const _docxCustomHeader = formatExportText(_docxExportTpl.headerText || '', { areaName, title: 'Portal de Dicas' });

  const _Header = window.docx.Header;
  const _Footer = window.docx.Footer;
  const sectionProps = { properties: {}, children };
  if (_docxCustomFooter && _Footer) {
    sectionProps.footers = {
      default: new _Footer({
        children: _docxCustomFooter.split('\n').slice(0, 3).map(line =>
          new Paragraph({ children: [new TextRun({ font: _DOCX_FONT, text: line, size: 14, color: '8E8E93' })], alignment: AlignmentType.CENTER })
        ),
      }),
    };
  }
  if (_docxCustomHeader && _Header) {
    sectionProps.headers = {
      default: new _Header({
        children: [new Paragraph({ children: [new TextRun({ font: _DOCX_FONT, text: _docxCustomHeader, size: 14, color: '8E8E93' })], alignment: AlignmentType.RIGHT })],
      }),
    };
  }

  // Document com Poppins como fonte padrão pra TODOS os runs (sem
  // precisar passar `font: 'Poppins'` em cada TextRun individualmente)
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Poppins' } },
      },
    },
    sections: [sectionProps],
  });
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

  const primary=colors.primary||PORTAL_DEFAULT_COLORS.primary;
  let second=colors.secondary||PORTAL_DEFAULT_COLORS.secondary;

  // v4.63.32+ Defensive fix — se secondary é muito claro (perto de branco),
  // força navy escuro hardcoded #0A1628. Áreas como Centurion configuradas
  // com `secondary=#ffffff` quebravam TUDO: capa branca, títulos invisíveis,
  // TOC sem cabeçalho. jsPDF foi desenhado assumindo navy escuro como
  // secondary (cor de "tinta" pra títulos sobre fundo claro + cor de
  // "fundo" pra capa sobre logo branca). Branco quebra os 2 usos.
  // Renê reportou "capa em branco + bairros sem títulos" — esse era o motivo.
  const _luma = (hex) => {
    const r = hexToR(hex), g = hexToG(hex), b = hexToB(hex);
    return (0.299*r + 0.587*g + 0.114*b) / 255;
  };
  if (_luma(second) > 0.85) {
    console.warn(`[portalPdf] area.colors.secondary=${second} muito claro pra PDF — forçando navy escuro #0A1628`);
    second = '#0A1628';
  }

  const PAGE_W=210,MARGIN=16,CONTENT=210-16*2;
  let y=MARGIN;
  const pR=hexToR(primary),pG=hexToG(primary),pB=hexToB(primary);
  const sR=hexToR(second), sG=hexToG(second), sB=hexToB(second);
  // v4.63.33+ accent (3ª cor) — usado em separadores, overlines, marcadores
  // de destaque. Fallback: accent → primary (compat com áreas pré-v4.63.33
  // que só tinham primary+secondary).
  const accent = colors.accent || primary;
  const aR=hexToR(accent), aG=hexToG(accent), aB=hexToB(accent);

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

  // Composite retorna { dataUrl, widthMm, heightMm } com aspect ratio real.
  // Capa: logo bem maior (até 130×80mm), centralizado.
  // Rodapé: discreto (~30×10mm). Capa de seção: maior que rodapé (~50×16mm).
  let logoCover  = null;   // { dataUrl, widthMm, heightMm }
  let logoFooter = null;
  let logoSectionCover = null; // logo branco pra rodapé das capas internas
  if (logoMeta) {
    logoCover = await _compositeLogo({
      logoDataUrl: logoMeta.dataUrl, bgColorHex: second,
      maxWmm: 130, maxHmm: 80, padPct: 0.02,
    }).catch(() => ({ dataUrl: logoMeta.dataUrl, widthMm: 80, heightMm: 45 }));
    // Versão pra rodapé das capas de seção (fundo escuro). Maior que
    // o rodapé tradicional, próximo do tamanho da capa principal.
    logoSectionCover = await _compositeLogo({
      logoDataUrl: logoMeta.dataUrl, bgColorHex: second,
      maxWmm: 90, maxHmm: 50, padPct: 0.03,
    }).catch(() => ({ dataUrl: logoMeta.dataUrl, widthMm: 90, heightMm: 50 }));
  }
  const footerSourceMeta = logoAltMeta || logoMeta;
  if (footerSourceMeta) {
    logoFooter = await _compositeLogo({
      logoDataUrl: footerSourceMeta.dataUrl, bgColorHex: '#FFFFFF',
      maxWmm: 30, maxHmm: 10, padPct: 0.04,
    }).catch(() => ({ dataUrl: footerSourceMeta.dataUrl, widthMm: 30, heightMm: 10 }));
  }

  // v4.62.45+ Fase E pós-audit: resolve template do export pra footerText
  // custom da área (Áreas → Exports → PDF). Aparece como pequena linha à
  // esquerda do rodapé padrão. Suporta placeholders {areaName}/{today}/etc.
  // v4.62.46+ headerText + hideCover plugados também.
  const _pdfExportTpl = resolveExportTemplate(area, 'portal', 'pdf');
  const _pdfCustomFooter = formatExportText(_pdfExportTpl.footerText || '', {
    areaName,
    title: 'Portal de Dicas',
  });
  const _pdfCustomHeader = formatExportText(_pdfExportTpl.headerText || '', {
    areaName,
    title: 'Portal de Dicas',
  });

  const addPage=()=>{doc.addPage();y=MARGIN;addFooter();};
  const checkPage=(n=10)=>{if(y+n>275)addPage();};
  // Rodapé: logo composite (sem card branco) — fundo branco da página
  // já é a cor de composite. Texto ABAIXO do logo, com altura segura.
  const addFooter=()=>{
    const pg=doc.getNumberOfPages(); doc.setPage(pg);
    doc.setDrawColor(220,220,220); doc.setLineWidth(0.2);
    doc.line(MARGIN, 280, PAGE_W-MARGIN, 280);
    if (logoFooter) {
      const lw = logoFooter.widthMm, lh = logoFooter.heightMm;
      const lx = (PAGE_W-lw)/2, ly = 282.5;
      try {
        doc.addImage(logoFooter.dataUrl, 'PNG', lx, ly, lw, lh, undefined, 'NONE');
      } catch (e) { /* silencioso */ }
    }
    doc.setFontSize(7); setF('normal'); doc.setTextColor(140,140,140);
    doc.text(
      `City Guides  ·  ${new Date().toLocaleDateString('pt-BR')}  ·  p.${pg}`,
      PAGE_W/2, 293, { align:'center' }
    );
    // v4.62.45+ footerText custom da BU (máx 3 linhas, à esquerda do rodapé padrão)
    if (_pdfCustomFooter) {
      doc.setFontSize(6); setF('normal'); doc.setTextColor(160,160,160);
      const lines = String(_pdfCustomFooter).split('\n').slice(0, 3);
      let yy = 285;
      for (const line of lines) { doc.text(line, MARGIN, yy); yy += 2.5; }
    }
    // v4.62.46+ headerText custom (canto superior direito, 1 linha)
    if (_pdfCustomHeader) {
      doc.setFontSize(6); setF('normal'); doc.setTextColor(160,160,160);
      doc.text(_pdfCustomHeader, PAGE_W - MARGIN, 8, { align: 'right' });
    }
  };

  // ── COVER (extraído em função pra reuso na última página) ───────
  const drawCover = () => {
    doc.setFillColor(sR,sG,sB); doc.rect(0,0,PAGE_W,297,'F');
    if (logoCover) {
      const lw = logoCover.widthMm, lh = logoCover.heightMm;
      const lx = (PAGE_W - lw) / 2;
      const ly = 75;
      try {
        doc.addImage(logoCover.dataUrl, 'PNG', lx, ly, lw, lh, undefined, 'NONE');
      } catch(e) {}
    } else {
      doc.setFillColor(pR,pG,pB); doc.rect(MARGIN, 108, CONTENT, 0.8, 'F');
      doc.setFontSize(28); setF('bold'); doc.setTextColor(255,255,255);
      doc.text(cleanText(areaName).toUpperCase(), PAGE_W/2, 100, {align:'center', charSpace:3});
    }
    const coverDivY = 162;
    doc.setFillColor(255,255,255); doc.rect(MARGIN, coverDivY, CONTENT, 0.5, 'F');
    let dY = coverDivY + 16;
    for (const { dest } of allTips) {
      doc.setFontSize(14); setF('bold'); doc.setTextColor(255,255,255);
      doc.text(cleanText(destLabel(dest)), PAGE_W/2, dY, {align:'center'});
      dY += 10;
    }
    doc.setFontSize(9); setF('normal'); doc.setTextColor(255,255,255);
    doc.text(new Date().toLocaleDateString('pt-BR',{year:'numeric',month:'long'}),
      PAGE_W/2, dY+10, {align:'center'});
  };
  // v4.62.46+ hideCover: se ligado, pula a capa (PDF compacto sem cover)
  if (!_pdfExportTpl.hideCover) {
    drawCover();
    doc.addPage(); y=MARGIN; addFooter();
  } else {
    // Sem cover, mas precisa pelo menos 1 página com footer
    addFooter();
  }

  // ── CAPAS DE SEÇÃO (apenas pros 4 principais) + TOC ─────────────
  // Pros 4 segmentos "principais", inserimos uma página-divisória antes do
  // conteúdo. Os demais segmentos vão inline normal. O TOC é construído
  // ao final num re-pass: anotamos as páginas conforme renderiza.
  // Critério de capa: TODOS os segmentos de conteúdo (não apenas 4).
  // Informações Gerais é técnica (não tem capa). Os demais ganham capa
  // pra dar respiro visual + sensação de "capítulo" por temática.
  const COVER_SEGMENTS = new Set([
    'bairros','atracoes','atracoes_criancas','restaurantes','vida_noturna',
    'espetaculos','compras','arredores','highlights','agenda_cultural',
  ]);
  const tocEntries = []; // { title, pageNum }
  let coverChapterNum = 0;

  // RESERVA página do SUMÁRIO em pag 2 (logo após a capa, antes de tudo)
  // Será preenchida no fim do render quando todas as páginas forem conhecidas.
  const tocPageIdx = doc.getNumberOfPages(); // página atual = pag 2 (vazia, reservada)
  doc.addPage(); y=MARGIN; addFooter();      // pula pra pag 3 (conteúdo)

  // Estimador de altura do bloco INFO GERAIS — usado pra dimensionar
  // o hero dinamicamente. Mede tudo (descrição, dica, chips, clima,
  // representação) usando o próprio doc.splitTextToSize com as fontes
  // que serão usadas. Retorna altura em mm.
  const estimateInfoGeraisH = (info, hasClimate, hasRep) => {
    if (!info) return 0;
    // v4.63.52: richToPlain strip de markdown leve (B/I/U/link) caso user
    // tenha usado a toolbar nos campos info.descricao/info.dica.
    const descClean = info._descClean ?? richToPlain(cleanText(info.descricao || ''));
    let h = 14; // segment heading "INFORMAÇÕES GERAIS" + margin
    // DESCRIÇÃO
    if (descClean) {
      doc.setFontSize(9); setF('normal');
      const lines = doc.splitTextToSize(descClean, CONTENT);
      h += 5 + lines.length * 4.5 + 5;
    }
    // DICA (callout)
    if (info.dica) {
      doc.setFontSize(9); setF('normal');
      const dicaLines = doc.splitTextToSize(richToPlain(cleanText(info.dica)), CONTENT - 10);
      h += dicaLines.length * 4.5 + 8 + 6;
    }
    // CHIPS (4 por linha, 18mm + 3mm gap)
    const chipsCount = ['populacao','moeda','lingua','religiao','fuso','voltagem','ddd']
      .filter(k => k === 'fuso' ? info.fusoSinal && info.fusoHoras : info[k]).length;
    if (chipsCount) h += Math.ceil(chipsCount / 4) * (18 + 3) + 2;
    // CLIMA grid (22mm) + label (5) + legenda (5)
    if (hasClimate) h += 5 + 22 + 3 + 5;
    // REPRESENTAÇÃO (label + até 4 linhas)
    if (hasRep) h += 5 + 4 * 5 + 2;
    return h;
  };

  for(const{tip,dest}of allTips){
    const imgs=imagesByDest[dest?.id]||{};

    // ── HERO DINÂMICO baseado no conteúdo de INFO GERAIS ─────────
    // Calcula altura necessária pro INFO antes de desenhar o hero.
    // Hero recebe o espaço RESTANTE da página (com mínimo de 50mm e
    // máximo de 130mm pra não ficar minúsculo nem dominante demais).
    const heroB64 = await _imgFetcher(imgs.hero);
    let heroH = 0;
    if (heroB64) {
      let imgRatio = 16/9;
      if (typeof Image !== 'undefined') {
        try {
          imgRatio = await new Promise((resolve) => {
            const im = new Image();
            im.onload  = () => resolve(im.naturalWidth / Math.max(im.naturalHeight,1));
            im.onerror = () => resolve(16/9);
            im.src = heroB64;
          });
        } catch { imgRatio = 16/9; }
      }
      // Estima INFO GERAIS pra calcular hero
      const infoSeg = (tip?.segments?.informacoes_gerais?.info) || null;
      const repObj  = infoSeg?.representacao || {};
      const parsed  = infoSeg ? parseDescricao(infoSeg.descricao, !!repObj.nome) : { descricao: '', climate: null };
      const infoEst = infoSeg ? {
        ...infoSeg,
        _descClean: parsed.descricao,
      } : null;
      const infoH = estimateInfoGeraisH(infoEst, !!parsed.climate, !!repObj.nome);
      // Espaço útil = página total - rodapé - margem extra de segurança
      const PAGE_USABLE = 297 - 17 - 5;
      const heroByImg   = PAGE_W / imgRatio;
      const heroByFit   = PAGE_USABLE - infoH - 14;
      heroH = Math.max(50, Math.min(130, heroByImg, heroByFit));
      // FULL WIDTH sempre — cover crop centraliza e corta o excesso
      // sem distorcer. Resultado: foto edge-to-edge na largura, com
      // altura proporcional ao volume de texto da info gerais.
      let imgForPdf = heroB64;
      if (heroH !== heroByImg) {
        // Só crop se a altura final for diferente da natural
        try {
          imgForPdf = await coverCropImage({
            dataUrl: heroB64, finalWmm: PAGE_W, finalHmm: heroH,
          });
        } catch (e) { /* fallback original */ }
      }
      try { doc.addImage(imgForPdf, 'JPEG', 0, 0, PAGE_W, heroH, undefined, 'SLOW'); } catch(e) {}
      y = heroH + 14;
    }

    const content = buildContent(tip, segments);
    for (let segIdx=0; segIdx<content.length; segIdx++) {
      const { segDef, data } = content[segIdx];

      // CAPA DE SEÇÃO — sem "CAPÍTULO XX" (era ruído visual)
      if (COVER_SEGMENTS.has(segDef.key)) {
        doc.addPage();
        doc.setFillColor(sR,sG,sB); doc.rect(0,0,PAGE_W,297,'F');
        // Linha decorativa em BRANCO (era na cor primária — invisível)
        const lineW = 60;
        doc.setFillColor(255,255,255); doc.rect((PAGE_W-lineW)/2, 130, lineW, 0.6, 'F');
        // Nome do segmento gigante
        doc.setFontSize(28); setF('bold'); doc.setTextColor(255,255,255);
        doc.text(cleanText(segDef.label).toUpperCase(), PAGE_W/2, 150, {align:'center'});
        // Subtitle do destino
        doc.setFontSize(11); setF('normal'); doc.setTextColor(220,220,220);
        const subLines = doc.splitTextToSize(cleanText(destLabel(dest)), CONTENT);
        doc.text(subLines, PAGE_W/2, 162, {align:'center'});
        // Logo no rodapé das capas internas — reduzido 20% (era 70mm,
        // agora 56mm) e deslocado mais pra baixo (margem inferior 12mm
        // em vez de 22mm).
        if (logoSectionCover) {
          const ratio = logoSectionCover.widthMm / Math.max(logoSectionCover.heightMm, 1);
          const targetW = 56;
          const lw = Math.min(targetW, 90);
          const lh = lw / ratio;
          try {
            doc.addImage(logoSectionCover.dataUrl, 'PNG', (PAGE_W-lw)/2, 297-lh-12, lw, lh, undefined, 'NONE');
          } catch (e) {}
        }
        // Conteúdo real na próxima página
        doc.addPage(); y=MARGIN; addFooter();
        tocEntries.push({ title: segDef.label, pageNum: doc.getNumberOfPages() });
      } else {
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
        // v4.63.52: richToPlain strip de markdown (Fase 1 — PDF rich render
        // virá em release futura). DOCX já renderiza bold/italic real.
        if (descClean) {
          checkPage(8);
          doc.setFontSize(6); setF('bold'); doc.setTextColor(pR,pG,pB);
          doc.text('DESCRIÇÃO', MARGIN, y, {charSpace:0.8}); y+=5;
          doc.setFontSize(9); setF('normal'); doc.setTextColor(60,60,60);
          const lines = doc.splitTextToSize(richToPlain(cleanText(descClean)), CONTENT);
          checkPage(lines.length*4.5+2);
          doc.text(lines, MARGIN, y); y+=lines.length*4.5+5;
        }

        // ── DICA em callout ─────────────────────────────────────────
        if (inf.dica) {
          doc.setFontSize(9); setF('normal');
          const dicaLines = doc.splitTextToSize(richToPlain(cleanText(inf.dica)), CONTENT-10);
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
        // INFO GERAIS já fica sozinha porque o próximo segmento (Bairros)
        // tem capa que abre nova página. Sem addPage explícito aqui pra
        // não gerar página em branco.
      } else if (segDef.mode === 'simple_list') {
        // simple_list (Bairros, Arredores) — texto + foto opcional à direita.
        // Layout: calcula altura de TEXTO e FOTO, usa max(...) como altura
        // do bloco, pra não ter sobreposição nem espaço sobrando entre items.
        const IMG_W = 50, IMG_H = 35;
        for (let itemIdx=0; itemIdx<(data.items||[]).length; itemIdx++) {
          const item = data.items[itemIdx];
          const imgUrl = pickImg({ titulo: item.title, title: item.title }, itemIdx, imgs, segDef.key);
          const imgB64 = await _imgFetcher(imgUrl);
          const textW = imgB64 ? CONTENT - IMG_W - 6 : CONTENT - 8;

          // Pre-calcula altura do bloco texto pra alinhar com foto
          setF('bold'); doc.setFontSize(10);
          const titleLines = doc.splitTextToSize(cleanText(item.title||''), textW - 4);
          let descLines = [];
          // v4.63.52: richToPlain strip markdown leve (sem mutar item)
          const descPlain = item.description ? richToPlain(item.description) : '';
          if (descPlain) {
            setF('normal'); doc.setFontSize(8.5);
            descLines = doc.splitTextToSize(cleanText(descPlain), textW - 4);
          }
          const TITLE_LH=5.2, DESC_LH=4.2, GAP_TITLE_DESC=1;
          const textH = titleLines.length*TITLE_LH + (descLines.length ? GAP_TITLE_DESC + descLines.length*DESC_LH : 0);
          const blockH = Math.max(textH, imgB64 ? IMG_H : 0) + 4;
          checkPage(blockH + 2);

          const blockStartY = y;
          // Bullet decorativo
          doc.setFillColor(pR,pG,pB); doc.circle(MARGIN+1.6, y+1.5, 1.2, 'F');
          // Título
          setF('bold'); doc.setFontSize(10); doc.setTextColor(sR,sG,sB);
          doc.text(titleLines, MARGIN+5, y+3);
          // Descrição
          if (descLines.length) {
            setF('normal'); doc.setFontSize(8.5); doc.setTextColor(70,70,80);
            doc.text(descLines, MARGIN+5, y + titleLines.length*TITLE_LH + 3 + GAP_TITLE_DESC + 2);
          }
          // Foto à direita (top alinhado com o bullet)
          if (imgB64) {
            const imgX = MARGIN + textW + 6;
            const imgY = blockStartY;
            try { doc.addImage(imgB64, 'JPEG', imgX, imgY, IMG_W, IMG_H, undefined, 'FAST'); } catch(e) {}
          }
          y = blockStartY + blockH + 2;
        }
        y+=2;
      } else {
        if (data.themeDesc) {
          setF('italic'); doc.setFontSize(8); doc.setTextColor(100,100,100);
          const lines = doc.splitTextToSize(richToPlain(cleanText(data.themeDesc)), CONTENT);
          doc.text(lines, MARGIN, y); y+=lines.length*4+4;
        }

        let lastCategoria = null;
        for (let itemIdx=0; itemIdx<(data.items||[]).length; itemIdx++) {
          const item = data.items[itemIdx];
          // v4.63.39+ Subtítulo inline — renderiza como faixa dourada + reseta lastCategoria
          if (item?.type === 'subtitle') {
            if (!item.text) continue;
            checkPage(12);
            y += 2;
            doc.setFillColor(aR, aG, aB);
            doc.rect(MARGIN, y, CONTENT, 0.4, 'F');
            doc.setFontSize(9); setF('bold'); doc.setTextColor(aR, aG, aB);
            doc.text(cleanText(item.text).toUpperCase(), MARGIN, y + 4, { charSpace: 1.5 });
            y += 8;
            lastCategoria = null;  // força reprint da categoria depois do subtítulo
            continue;
          }
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

          // PRÉ-CÁLCULO da altura total do bloco-item — evita orphan title
          // (título sozinho no fim de uma página, texto na próxima).
          // Mede tudo ANTES de pintar e força addPage se não couber.
          setF('bold'); doc.setFontSize(10);
          const titleLines = doc.splitTextToSize(cleanText(item.titulo), textW-4);
          let descLines = [];
          if (item.descricao) {
            setF('normal'); doc.setFontSize(8);
            // v4.63.40+ Rich text: PDF renderiza como plain text (markdown stripped).
            // Bold/italic/underline/link se perdem no PDF — usuário tem cobertura
            // no Word + Web link (formatos rich). Próxima iteração pode fazer
            // segmented rendering aqui se Renê precisar.
            descLines = doc.splitTextToSize(richToPlain(cleanText(item.descricao)), textW-4);
          }
          const det = [
            item.endereco && `End. ${cleanText(item.endereco)}`,
            item.telefone && `Tel. ${cleanText(item.telefone)}`,
          ].filter(Boolean);
          let detLines = [];
          if (det.length) {
            doc.setFontSize(7.5);
            detLines = doc.splitTextToSize(det.join('   ·   '), textW-4);
          }
          let obsLines = [];
          if (item.observacoes) {
            doc.setFontSize(7.5);
            obsLines = doc.splitTextToSize('Obs. '+cleanText(item.observacoes), textW-4);
          }
          const TITLE_LH=5, DESC_LH=4, DET_LH=4, OBS_LH=4, PILL_H=6.5, PILL_GAP=5;
          const textBlockH =
            titleLines.length*TITLE_LH +
            (descLines.length ? descLines.length*DESC_LH + 2 : 0) +
            (detLines.length  ? detLines.length*DET_LH        : 0) +
            (hasValidSite(item)? PILL_H + PILL_GAP             : 0) +
            (obsLines.length  ? obsLines.length*OBS_LH        : 0);
          const blockH = Math.max(textBlockH, imgB64 ? IMG_H : 0) + 6;
          // Se não couber na página atual, pula pra próxima ANTES do título
          if (y + blockH > 275) { addPage(); }

          const blockStartY = y;
          // Título
          setF('bold'); doc.setFontSize(10); doc.setTextColor(sR,sG,sB);
          doc.text(titleLines, MARGIN+2, y); y+=titleLines.length*TITLE_LH;
          // v4.63.37+ Tags inline depois do título (itálico cinza pequeno)
          if (Array.isArray(item.tags) && item.tags.length) {
            setF('italic'); doc.setFontSize(7); doc.setTextColor(aR, aG, aB);
            const tagsLine = item.tags.map(t => `· ${t}`).join('  ');
            const tagLines = doc.splitTextToSize(cleanText(tagsLine), CONTENT-4);
            doc.text(tagLines, MARGIN+2, y);
            y += tagLines.length*3.6 + 1;
          }
          // Descrição
          if (descLines.length) {
            setF('normal'); doc.setFontSize(8); doc.setTextColor(70,70,80);
            doc.text(descLines, MARGIN+2, y); y+=descLines.length*DESC_LH+2;
          }
          // End/Tel
          if (detLines.length) {
            doc.setFontSize(7.5); doc.setTextColor(130,130,130);
            doc.text(detLines, MARGIN+2, y); y+=detLines.length*DET_LH;
          }
          // Link pill — só se site cadastrado de verdade (não vazio/whitespace)
          if (hasValidSite(item)) {
            const siteUrl = normalizeUrl(item.site);
            const linkText = 'Visitar site';
            doc.setFontSize(8); setF('bold');
            const padX = 5, arrowW = 5.5, gap = 3;
            const txtW = doc.getTextWidth(linkText);
            const pillW = padX + txtW + gap + arrowW + padX;
            const pillX = MARGIN+2;
            const pillY = y;
            doc.setFillColor(pR,pG,pB);
            doc.roundedRect(pillX, pillY, pillW, PILL_H, 1.5, 1.5, 'F');
            doc.setTextColor(255,255,255);
            doc.text(linkText, pillX + padX, pillY + PILL_H/2 + 1.5);
            const ax = pillX + padX + txtW + gap + arrowW/2;
            const ay = pillY + PILL_H/2;
            doc.setDrawColor(255,255,255); doc.setLineWidth(0.5);
            doc.line(ax-1.6, ay+1.6, ax+1.2, ay-1.2);
            doc.line(ax+1.2, ay-1.2, ax-0.4, ay-1.2);
            doc.line(ax+1.2, ay-1.2, ax+1.2, ay+0.4);
            try { doc.link(pillX, pillY, pillW, PILL_H, { url: siteUrl }); } catch(e) {}
            y += PILL_H + PILL_GAP;
          }
          // Obs
          if (obsLines.length) {
            doc.setFontSize(7.5); doc.setTextColor(160,160,160); setF('italic');
            doc.text(obsLines, MARGIN+2, y); y+=obsLines.length*OBS_LH;
          }
          // Foto à direita do bloco
          if (imgB64) {
            const imgX = MARGIN + textW + 2;
            const imgY = blockStartY - 4;
            try { doc.addImage(imgB64, 'JPEG', imgX, imgY, IMG_W, IMG_H, undefined, 'FAST'); } catch(e) {}
            if (y < imgY+IMG_H+2) y = imgY+IMG_H+2;
          }
          // Linha divisória discreta
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

  // Remove página em branco no final (vinda do addPage do último loop)
  const pgCountBeforeBack = doc.getNumberOfPages();
  if (pgCountBeforeBack > 1) {
    // Verifica se a última página é branca: se tiver só o footer, deleta
    doc.deletePage(pgCountBeforeBack);
  }

  // Última página: REPETE a capa (acabamento estilo livro/revista)
  doc.addPage();
  drawCover();

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
  const primary= colors.primary   || PORTAL_DEFAULT_COLORS.primary;
  const bgColor= colors.secondary || PORTAL_DEFAULT_COLORS.secondary;
  const pHex   = primary.replace('#','');
  const bgHex  = bgColor.replace('#','');
  const W=13.33, H=7.5;
  const date=new Date().toLocaleDateString('pt-BR',{year:'numeric',month:'long'});
  pptx.layout='LAYOUT_WIDE'; pptx.author='PRIMETOUR Portal de Dicas';

  // v4.62.41 Fase C: fonte dinâmica via SSOT (area.fonts.body).
  // Antes: 'Poppins' hardcoded. Agora PowerPoint usa fonte da BU
  // (Cormorant Garamond/Playfair/Inter/etc.) — fallback Arial preserva
  // legibilidade se SO do cliente não tem a fonte instalada.
  const _PPTX_TPL = resolveAreaDefaults(area, 'portal');
  const FONT = _PPTX_TPL.fonts.body || 'Poppins';
  const FONT_FALLBACK = 'Arial';
  const F = (extra={}) => ({ fontFace: `${FONT}, ${FONT_FALLBACK}, sans-serif`, ...extra });

  // v4.62.45+ Fase E pós-audit: slide master com footerText custom da BU.
  // PptxGenJS define slide master — todos os slides criados depois herdam
  // o objeto. headerText/footerText aparecem em TODOS os slides.
  const _pptxExportTpl = resolveExportTemplate(area, 'portal', 'pptx');
  const _pptxCustomFooter = formatExportText(_pptxExportTpl.footerText || '', { areaName, title: 'Portal de Dicas' });
  const _pptxCustomHeader = formatExportText(_pptxExportTpl.headerText || '', { areaName, title: 'Portal de Dicas' });
  const _pptxHideCover    = !!_pptxExportTpl.hideCover;
  if (_pptxCustomFooter || _pptxCustomHeader) {
    const masterObjs = [];
    if (_pptxCustomFooter) {
      const lines = String(_pptxCustomFooter).split('\n').slice(0, 3);
      masterObjs.push({ text: {
        text: lines.join('\n'),
        options: { x: 0.3, y: H - 0.4, w: W - 0.6, h: 0.35,
          fontSize: 8, color: '888888', fontFace: `${FONT}, ${FONT_FALLBACK}, sans-serif`,
          align: 'center', valign: 'top' },
      }});
    }
    if (_pptxCustomHeader) {
      masterObjs.push({ text: {
        text: _pptxCustomHeader,
        options: { x: 0.3, y: 0.15, w: W - 0.6, h: 0.25,
          fontSize: 8, color: '888888', fontFace: `${FONT}, ${FONT_FALLBACK}, sans-serif`,
          align: 'right', valign: 'top' },
      }});
    }
    try {
      pptx.defineSlideMaster({ title: 'AREA_FOOTER', objects: masterObjs });
    } catch (e) { console.warn('[portalPptx] slide master falhou:', e?.message); }
  }
  // v4.62.45+ Wrap addSlide pra aplicar master AREA_FOOTER automaticamente.
  // Pattern usado em vários lugares (cover, section, content slides) — wrap
  // garante que todos herdem footer/header sem mexer em cada chamada.
  const _origAddSlide = pptx.addSlide.bind(pptx);
  if (_pptxCustomFooter || _pptxCustomHeader) {
    pptx.addSlide = (opts = {}) => _origAddSlide({ masterName: 'AREA_FOOTER', ...opts });
  }

  // ── COVER (espelhada do PDF) ────────────────────────────────
  // bg = secondary (escuro). Logo grande no centro (compositado com
  // bg pra resolver transparência). Texto BRANCO em cima (não primary
  // sobre bg — antes ficava azul sobre azul, invisível).
  const coverLogoData = await fetchImgData(area?.logoUrl);
  let coverLogoComposite = null;
  if (coverLogoData?.dataUrl) {
    try {
      const r = await compositeLogoOnBackground({
        logoDataUrl: coverLogoData.dataUrl, bgColorHex: bgColor,
        maxWmm: 130, maxHmm: 80, padPct: 0.02,
      });
      // Converte mm→inch (1 inch = 25.4mm) pra PPTX
      coverLogoComposite = {
        dataUrl: r.dataUrl,
        wIn: r.widthMm / 25.4,
        hIn: r.heightMm / 25.4,
      };
    } catch(e) { console.warn('[PPTX] composite cover logo failed:', e?.message); }
  }
  // v4.62.46+ hideCover: pula capa inteira se template ligou
  if (!_pptxHideCover) {
  const cover = pptx.addSlide(); cover.background={color:bgHex};
  // Logo grande centralizado (ocupa metade superior da capa)
  if (coverLogoComposite) {
    const aspect = coverLogoComposite.wIn / coverLogoComposite.hIn;
    const maxW = 7, maxH = 3.5;
    let lw = maxW, lh = lw / aspect;
    if (lh > maxH) { lh = maxH; lw = lh * aspect; }
    try {
      cover.addImage({ data: coverLogoComposite.dataUrl,
        x: (W - lw)/2, y: 1.6, w: lw, h: lh });
    } catch(e) { console.warn('[PPTX] cover logo skip:', e.message); }
  }
  // Linha divisória branca discreta abaixo do logo
  cover.addShape(pptx.ShapeType.rect,{x:(W-3)/2,y:5.4,w:3,h:0.02,fill:{color:'FFFFFF'},line:{type:'none'}});
  // Destinos centralizados (sem "PORTAL DE DICAS" nem nome da área)
  const destLines = allTips.map(({dest})=>destLabel(dest));
  if (destLines.length <= 4) {
    cover.addText(destLines.join('  ·  '), {
      x:0.5, y:5.7, w:W-1, h:0.5,
      ...F({fontSize:16, bold:true, color:'FFFFFF', align:'center', charSpacing:2}),
    });
  } else {
    cover.addText(destLines.map(d=>({text:d, options:{breakLine:true}})), {
      x:0.5, y:5.6, w:W-1, h:1.2,
      ...F({fontSize:13, bold:true, color:'FFFFFF', align:'center'}),
    });
  }
  cover.addText(date, {
    x:0.5, y:H-0.5, w:W-1, h:0.3,
    ...F({fontSize:9, color:'FFFFFF', align:'center', transparency:60}),
  });
  } // end if (!_pptxHideCover)

  for (const { tip, dest } of allTips) {
    const label = destLabel(dest);
    const imgs  = imagesByDest[dest?.id] || {};
    const [city] = label.split(',');

    // ── DESTINATION INTRO (hero full bleed + cidade gigante) ─────
    const heroUrl = imgs.hero;
    const heroImgData = await fetchImgData(heroUrl);
    const ds = pptx.addSlide(); ds.background={color:bgHex};
    if (heroImgData?.dataUrl) {
      try {
        ds.addImage({ data: heroImgData.dataUrl, x:0, y:0, w:W, h:H,
          sizing:{type:'cover', w:W, h:H} });
      } catch(e) { console.warn('[PPTX] hero img:', e.message); }
      // Faixa sólida preta inferior (com transparência leve) — texto fica
      // legível sem "efeito gradient feio" da metade do slide. Ocupa só
      // altura do bloco de texto (1.4in), não metade do slide.
      ds.addShape(pptx.ShapeType.rect,{
        x:0, y:H-1.6, w:W, h:1.6,
        fill:{color:'000000', transparency:55}, line:{type:'none'},
      });
    }
    // Faixa primary fina à esquerda + nome cidade BRANCO grande
    ds.addShape(pptx.ShapeType.rect,{x:0.5,y:H-1.4,w:0.06,h:1.0,fill:{color:pHex},line:{type:'none'}});
    ds.addText(String(city||'').trim(), {
      x:0.7, y:H-1.4, w:W-1.2, h:0.85,
      ...F({fontSize:46, bold:true, color:'FFFFFF', charSpacing:1, valign:'top'}),
    });
    if (label.includes(',')) {
      const sub = label.split(',').slice(1).join(',').trim().toUpperCase();
      ds.addText(sub, {
        x:0.7, y:H-0.55, w:W-1.2, h:0.35,
        ...F({fontSize:12, color:'FFFFFF', charSpacing:4, transparency:25}),
      });
    }

    const content = buildContent(tip, segments);

    // Helper: cria slide com header/footer padronizados
    const buildSegmentSlide = (titleText, subtitle = '') => {
      const sl = pptx.addSlide(); sl.background={color:'FFFFFF'};
      sl.addShape(pptx.ShapeType.rect,{x:0,y:0,w:W,h:0.72,fill:{color:bgHex},line:{type:'none'}});
      sl.addShape(pptx.ShapeType.rect,{x:0,y:0,w:0.08,h:0.72,fill:{color:pHex},line:{type:'none'}});
      sl.addText(titleText, {
        x:0.25, y:0.08, w:8, h:0.56,
        ...F({fontSize:13, bold:true, color:'FFFFFF', charSpacing:2}),
      });
      sl.addText(subtitle || label, {
        x:8.5, y:0.08, w:4.5, h:0.56,
        ...F({fontSize:9, color:'FFFFFF', align:'right', transparency:30}),
      });
      sl.addShape(pptx.ShapeType.rect,{x:0,y:H-0.3,w:W,h:0.3,fill:{color:'F8F7F4'},line:{type:'none'}});
      sl.addText(`PRIMETOUR  ·  Portal de Dicas  ·  ${date}`, {
        x:0.3, y:H-0.25, w:W-0.6, h:0.22,
        ...F({fontSize:7, color:'AAAAAA', align:'center'}),
      });
      return sl;
    };

    for (const { segDef, data } of content) {
      const slide = buildSegmentSlide(segDef.label.toUpperCase());

      if (segDef.mode==='special_info') {
        // Layout linear (sem cards) — mesmo padrão visual do PDF
        const inf=data.info||{};
        const repObj=inf.representacao||{};
        const { descricao: descClean, climate } = parseDescricao(inf.descricao, !!repObj.nome);
        let yy = 0.95;
        const LEFT = 0.4, COLW = W - 0.8;

        // ── DESCRIÇÃO em parágrafo
        // v4.63.52: richToPlain strip markdown (PPTX rich virá em release futura).
        if (descClean) {
          slide.addText('DESCRIÇÃO', {
            x:LEFT, y:yy, w:COLW, h:0.3,
            ...F({fontSize:10, bold:true, color:pHex, charSpacing:2}),
          });
          yy += 0.32;
          slide.addText(richToPlain(String(descClean)), {
            x:LEFT, y:yy, w:COLW, h:1.6,
            ...F({fontSize:11, color:'474650', valign:'top'}),
          });
          yy += 1.7;
        }
        // ── DICA callout
        if (inf.dica) {
          slide.addShape(pptx.ShapeType.rect,{x:LEFT, y:yy, w:COLW, h:0.7,
            fill:{color:'F8F7F4'}, line:{color:pHex, width:0.5}});
          slide.addShape(pptx.ShapeType.rect,{x:LEFT, y:yy, w:0.06, h:0.7,
            fill:{color:pHex}, line:{type:'none'}});
          slide.addText([
            {text:'DICA DO CONCIERGE  ', options:F({bold:true,color:pHex,fontSize:9,charSpacing:2})},
            {text:richToPlain(String(inf.dica)), options:F({color:'474650',fontSize:10,italic:true})},
          ], {x:LEFT+0.12, y:yy+0.05, w:COLW-0.2, h:0.6});
          yy += 0.85;
        }

        // ── DADOS BÁSICOS em flow horizontal (label · value · sep)
        const dataPairs = [
          ['População',  inf.populacao],
          ['Moeda',      inf.moeda],
          ['Língua',     inf.lingua],
          ['Religião',   inf.religiao],
          ['Fuso',       inf.fusoSinal&&inf.fusoHoras?`${inf.fusoSinal}${inf.fusoHoras}h de Brasília`:''],
          ['Voltagem',   inf.voltagem],
          ['DDD',        inf.ddd],
        ].filter(([,v])=>v);
        if (dataPairs.length) {
          slide.addText('DADOS BÁSICOS', {
            x:LEFT, y:yy, w:COLW, h:0.3,
            ...F({fontSize:10, bold:true, color:pHex, charSpacing:2}),
          });
          yy += 0.32;
          // Render como linhas (cada par numa linha) — leitura fácil
          dataPairs.forEach(([l,v]) => {
            slide.addText([
              {text:l+': ', options:F({bold:true,color:bgHex,fontSize:10})},
              {text:String(v), options:F({color:'474650',fontSize:10})},
            ], {x:LEFT, y:yy, w:COLW, h:0.28});
            yy += 0.28;
          });
          yy += 0.15;
        }

        // ── CLIMA + REPRESENTAÇÃO podem ir num 2º slide se não couber
        const cli = inf.clima || {};
        const monthsArr = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        const maxArr = climate?.max || monthsArr.map((_,i)=>cli[`max_${i}`] ?? null);
        const minArr = climate?.min || monthsArr.map((_,i)=>cli[`min_${i}`] ?? null);
        const hasClimate = maxArr.some(v=>v!=null) || minArr.some(v=>v!=null);
        const rep = inf.representacao||{};

        // Se passou de y=6.0 já é hora de novo slide pra clima/rep
        let target = slide;
        if (yy > 5.8 && (hasClimate || rep.nome)) {
          target = buildSegmentSlide(segDef.label.toUpperCase() + ' — CLIMA & REPRESENTAÇÃO');
          yy = 0.95;
        }
        if (hasClimate) {
          target.addText('CLIMA', {
            x:LEFT, y:yy, w:COLW, h:0.3,
            ...F({fontSize:10, bold:true, color:pHex, charSpacing:2}),
          });
          yy += 0.32;
          const tableData = [
            [{text:'°C', options:F({bold:true, color:pHex, fill:{color:'F8F7F4'}})},
              ...monthsArr.map(m=>({text:m, options:F({bold:true, color:pHex, fill:{color:'F8F7F4'}})}))],
            [{text:'Máx ↑', options:F({bold:true, color:bgHex})},
              ...maxArr.map(v=>({text:String(v??'—'), options:F({color:'474650'})}))],
            [{text:'Mín ↓', options:F({bold:true, color:bgHex})},
              ...minArr.map(v=>({text:String(v??'—'), options:F({color:'474650'})}))],
          ];
          target.addTable(tableData, {
            x:LEFT, y:yy, w:COLW,
            ...F({fontSize:9, align:'center'}),
            border:{type:'solid', pt:0.5, color:'EEEEEE'},
          });
          yy += 1.4;
        }
        if (rep.nome) {
          target.addText('REPRESENTAÇÃO BRASILEIRA', {
            x:LEFT, y:yy, w:COLW, h:0.3,
            ...F({fontSize:10, bold:true, color:pHex, charSpacing:2}),
          });
          yy += 0.32;
          const lines = [
            ['Nome:',rep.nome],['Endereço:',rep.endereco],
            ['Telefone:',rep.telefone],['Site:',rep.link],
          ].filter(([,v])=>v);
          lines.forEach(([l,v])=>{
            target.addText([
              {text:l+' ', options:F({bold:true,color:bgHex,fontSize:10})},
              {text:String(v), options:F({color:'474650',fontSize:10,
                hyperlink: l==='Site:' ? {url:normalizeUrl(v)} : undefined})},
            ], {x:LEFT, y:yy, w:COLW, h:0.3});
            yy += 0.3;
          });
        }

      } else if (segDef.mode==='simple_list') {
        // Bairros/Arredores: 3 itens por slide (texto + foto à esquerda)
        // pra ter respiro entre cards. Foto vem da galeria via pickImg.
        const seenT = new Set();
        const allItems = (data.items||[]).filter(it => {
          if (!it.title) return false;
          const k = it.title.trim().toLowerCase();
          if (seenT.has(k)) return false;
          seenT.add(k); return true;
        });
        const PER_PAGE_LIST = 3;
        const totalPagesL = Math.max(1, Math.ceil(allItems.length / PER_PAGE_LIST));
        for (let pg = 0; pg < totalPagesL; pg++) {
          const pageSlide = pg === 0 ? slide : buildSegmentSlide(
            segDef.label.toUpperCase(),
            `${label}  ·  pág. ${pg+1}/${totalPagesL}`,
          );
          const pageItems = allItems.slice(pg*PER_PAGE_LIST, (pg+1)*PER_PAGE_LIST);

          // Cada item ocupa um "card horizontal": foto à esquerda + texto à direita
          // 3 itens cabem em altura ~5.7" (de y=0.9 até y=6.6, deixando 0.9" de footer)
          const ITEM_TOP = 0.95;
          const ITEM_GAP = 0.25;
          const AVAIL_H  = H - ITEM_TOP - 0.45 - (pageItems.length-1) * ITEM_GAP;
          const ITEM_H   = AVAIL_H / pageItems.length;
          const IMG_W    = 3.0;
          const TXT_X    = 0.4 + IMG_W + 0.25;
          const TXT_W    = W - TXT_X - 0.4;

          await Promise.all(pageItems.map(async (it, i) => {
            const yTop = ITEM_TOP + i * (ITEM_H + ITEM_GAP);
            // Tenta foto pelo título do bairro (placeName na galeria)
            const imgUrl = pickImg(
              { titulo: it.title, title: it.title }, i + pg*PER_PAGE_LIST, imgs, segDef.key,
            );
            const imgDataP = imgUrl ? await fetchImgData(imgUrl) : null;
            const imgB64 = imgDataP?.dataUrl || null;

            if (imgB64) {
              try {
                pageSlide.addImage({ data: imgB64, x:0.4, y:yTop,
                  w:IMG_W, h:ITEM_H, sizing:{type:'cover', w:IMG_W, h:ITEM_H} });
              } catch(e) { console.warn('[PPTX] bairro img:', e.message); }
            } else {
              // Placeholder cinza com título do bairro
              pageSlide.addShape(pptx.ShapeType.rect,{x:0.4, y:yTop, w:IMG_W, h:ITEM_H,
                fill:{color:'F1F5F9'}, line:{color:'E5E7EB', width:0.5}});
              pageSlide.addText(String(it.title||'').toUpperCase(), {
                x:0.4, y:yTop+ITEM_H/2-0.2, w:IMG_W, h:0.4,
                ...F({fontSize:9, color:'AAAAAA', align:'center', charSpacing:2}),
              });
            }
            // Faixa de cor primary acima da foto
            pageSlide.addShape(pptx.ShapeType.rect,{x:0.4, y:yTop, w:IMG_W, h:0.06,
              fill:{color:pHex}, line:{type:'none'}});

            // Bloco de texto à direita
            pageSlide.addText(String(it.title||''), {
              x:TXT_X, y:yTop, w:TXT_W, h:0.5,
              ...F({fontSize:18, bold:true, color:bgHex, valign:'top'}),
            });
            if (it.description) {
              // v4.63.61 G1: richToPlain strip markdown rich (negrito **, itálico _).
              // Antes ia literal — "**Texto**" aparecia como caractere em vez de bold.
              pageSlide.addText(richToPlain(String(it.description)), {
                x:TXT_X, y:yTop+0.55, w:TXT_W, h:ITEM_H-0.55,
                ...F({fontSize:10.5, color:'474650', valign:'top', shrinkText:true,
                  paraSpaceAfter:6}),
              });
            }
          }));
        }

      } else {
        // place_list: dedupe + ordena por categoria + pagina (4 itens/slide).
        // v4.63.43+ HIGH H2: subtitles incluídos no filter + ordenação ignorada
        // se há subtitles (preserva ordem do consultor).
        const seenT2 = new Set();
        const allItems = (data.items||[]).filter(it => {
          if (it?.type === 'subtitle') return !!(it.text && it.text.trim());
          if (!it.titulo) return false;
          const k = it.titulo.trim().toLowerCase();
          if (seenT2.has(k)) return false;
          seenT2.add(k); return true;
        });
        const _pptxHasSubtitles = allItems.some(it => it?.type === 'subtitle');
        const indexed = allItems.map((it,i)=>({it,origIdx:i}));
        if (!_pptxHasSubtitles) {
          indexed.sort((a,b)=>{
            const ca=(a.it.categoria||'').toLowerCase();
            const cb=(b.it.categoria||'').toLowerCase();
            return ca.localeCompare(cb) || a.origIdx - b.origIdx;
          });
        }

        // v4.63.43+ HIGH H2: subtitles em PPTX ainda não têm render visual
        // (layout posicionado complexo). Filtramos pra não quebrar o slot grid.
        // Pra próxima iteração: renderizar subtitle como banner full-width
        // entre páginas (quebra na transição).
        const indexedNoSubs = indexed.filter(({ it }) => it?.type !== 'subtitle');
        const PER_PAGE = 4;
        const totalPages = Math.max(1, Math.ceil(indexedNoSubs.length / PER_PAGE));

        for (let pg = 0; pg < totalPages; pg++) {
          const pageSlide = pg === 0 ? slide : buildSegmentSlide(
            segDef.label.toUpperCase(),
            `${label}  ·  pág. ${pg+1}/${totalPages}`,
          );
          const pageItems = indexedNoSubs.slice(pg*PER_PAGE, (pg+1)*PER_PAGE);

          // Themedesc só na primeira página
          if (pg === 0 && data.themeDesc) {
            pageSlide.addText(richToPlain(String(data.themeDesc)).slice(0,180),
              {x:0.3,y:0.85,w:W-0.6,h:0.45,
                ...F({fontSize:9, italic:true, color:'888888'})});
          }
          const sY = (pg === 0 && data.themeDesc) ? 1.38 : 0.88;
          const cols = pageItems.length<=2 ? 2 : 4;
          const cW = pageItems.length<=2 ? (W-0.8)/2 : (W-0.8)/4;
          const cH = H - sY - 0.5;

          await Promise.all(pageItems.map(async ({it: item, origIdx}, i) => {
            const x=0.3+i*(cW+0.08);
            const imgUrl = pickImg(item, origIdx, imgs, segDef.key);
            const imgDataP = await fetchImgData(imgUrl);
            const imgB64 = imgDataP?.dataUrl || null;

            if (imgB64) {
              const imgH = cH * 0.45;
              pageSlide.addShape(pptx.ShapeType.rect,{x,y:sY,w:cW,h:cH,
                fill:{color:'FFFFFF'}, line:{color:'E5E7EB',width:0.5}});
              try {
                pageSlide.addImage({ data: imgB64, x, y:sY, w:cW, h:imgH,
                  sizing:{type:'cover', w:cW, h:imgH} });
              } catch(e) { console.warn('[PPTX] item img:', e.message); }
              // Faixa de cor primary no topo
              pageSlide.addShape(pptx.ShapeType.rect,{x, y:sY, w:cW, h:0.05,
                fill:{color:pHex}, line:{type:'none'}});
              const tY = sY + imgH + 0.12;
              if (item.categoria) {
                pageSlide.addText(String(item.categoria).toUpperCase(), {
                  x:x+0.1, y:tY, w:cW-0.2, h:0.25,
                  ...F({fontSize:6.5, bold:true, color:pHex, charSpacing:1}),
                });
              }
              pageSlide.addText(String(item.titulo), {
                x:x+0.1, y:tY+(item.categoria?0.26:0), w:cW-0.2, h:0.5,
                ...F({fontSize:cols===2?12:10, bold:true, color:bgHex, valign:'top'}),
              });
              if (item.descricao) {
                const dY = tY + (item.categoria?0.26:0) + 0.5;
                // v4.63.61 G1: richToPlain (PPTX não interpreta markdown)
                pageSlide.addText(richToPlain(String(item.descricao)), {
                  x:x+0.1, y:dY, w:cW-0.2, h:sY+cH-dY-0.45,
                  ...F({fontSize:cols===2?9:8, color:'555555', valign:'top', shrinkText:true}),
                });
              }
            } else {
              pageSlide.addShape(pptx.ShapeType.rect,{x, y:sY, w:cW, h:cH,
                fill:{color:'F8F7F4'}, line:{color:'E5E7EB', width:0.5}});
              pageSlide.addShape(pptx.ShapeType.rect,{x, y:sY, w:cW, h:0.06,
                fill:{color:pHex}, line:{type:'none'}});
              let iy=sY+0.18;
              if (item.categoria) {
                pageSlide.addText(String(item.categoria).toUpperCase(), {
                  x:x+0.1, y:iy, w:cW-0.2, h:0.28,
                  ...F({fontSize:7, bold:true, color:pHex, charSpacing:1}),
                });
                iy += 0.32;
              }
              pageSlide.addText(String(item.titulo), {
                x:x+0.1, y:iy, w:cW-0.2, h:0.6,
                ...F({fontSize:cols===2?12:10, bold:true, color:bgHex, valign:'top'}),
              });
              iy += 0.7;
              if (item.descricao) {
                // v4.63.61 G1: richToPlain (PPTX não interpreta markdown)
                pageSlide.addText(richToPlain(String(item.descricao)), {
                  x:x+0.1, y:iy, w:cW-0.2, h:cH-iy+sY-0.4,
                  ...F({fontSize:cols===2?10:9, color:'555555', valign:'top', shrinkText:true}),
                });
              }
            }
            // Endereço/telefone na base do card
            const det=[item.endereco&&`📍 ${item.endereco}`, item.telefone&&`📞 ${item.telefone}`].filter(Boolean);
            if (det.length) {
              pageSlide.addText(det.join('  '), {
                x:x+0.1, y:sY+cH-0.4, w:cW-0.2, h:0.28,
                ...F({fontSize:7.5, color:'888888'}),
              });
            }
            if (hasValidSite(item)) {
              pageSlide.addText(String(item.site), {
                x:x+0.1, y:sY+cH-0.18, w:cW-0.2, h:0.18,
                ...F({fontSize:7, color:pHex, hyperlink:{url:normalizeUrl(item.site)}}),
              });
            }
          }));
        }
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

/**
 * Enriquece imagesByDest.gallery buscando foto Unsplash pra cada item
 * dos segmentos cujo placeName ainda não existe na galeria. Concorrência
 * limitada a 8 chamadas paralelas pra não estourar rate limit.
 *
 * Mutates imagesByDest in place.
 */
async function enrichGalleryWithAutoPhotos(imagesByDest, allTips, segments) {
  const { httpsCallable, getFunctions } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
  const { app } = await import('../firebase.js');
  const fnPhoto = httpsCallable(getFunctions(app, 'us-central1'), 'fetchDestinationPhoto');

  // Mapping seg → query genérica fallback (quando item específico não acha foto)
  const SEG_GENERIC = {
    bairros:           'neighborhood street',
    atracoes:          'tourist attraction',
    atracoes_criancas: 'family attraction',
    restaurantes:      'restaurant interior',
    vida_noturna:      'nightlife bar',
    espetaculos:       'theater performance',
    compras:           'shopping street',
    arredores:         'countryside',
    highlights:        'landmark',
    agenda_cultural:   'cultural event',
  };

  // Coleta itens que precisam de foto
  const tasks = [];
  const MAX_ITEMS = 80;

  // v4.63.44+ HERO TASKS: destinos sem foto de capa (hero) recebem busca
  // automática separada antes dos items dos segmentos. Renê reportou:
  // "exportei Orlando (sem fotos no banco) e a foto de capa não apareceu".
  // Causa raiz: resolveImages só populava hero a partir do banco_imagens.
  // Quando banco vazio, hero=null. Sem foto de capa no PDF.
  const heroTasks = [];
  for (const { dest } of allTips) {
    if (!dest?.id) continue;
    const imgs = imagesByDest[dest.id];
    if (!imgs || imgs.hero) continue;  // já tem hero — skip
    const cityForHero = dest.city || dest.country || '';
    if (!cityForHero) continue;
    heroTasks.push({
      destId: dest.id,
      query: `${cityForHero} skyline landmark`,
      queryFallback: cityForHero,
    });
  }
  if (heroTasks.length) {
    console.log(`[autoPhotos] Buscando ${heroTasks.length} hero(s) auto…`);
    const heroResults = await Promise.allSettled(
      heroTasks.map(t =>
        fnPhoto({ query: t.query, count: 1 })
          .then(r => ({ ...t, photo: r.data }))
          .catch(() => fnPhoto({ query: t.queryFallback, count: 1 })
            .then(r => ({ ...t, photo: r.data }))
            .catch(() => ({ ...t, err: true })))
      )
    );
    for (const res of heroResults) {
      const v = res.value;
      if (res.status !== 'fulfilled' || v.err || !v.photo) continue;
      const url = v.photo.url || (Array.isArray(v.photo.urls) ? v.photo.urls[0] : null);
      if (!url) continue;
      imagesByDest[v.destId].hero = url;
    }
  }

  for (const { tip, dest } of allTips) {
    if (!dest?.id) continue;
    const imgs = imagesByDest[dest.id];
    if (!imgs) continue;
    if (!imgs.gallery) imgs.gallery = [];

    // Itens já com foto na gallery (cadastro manual em "Banco de Imagens")
    const haveByTitle = new Set(
      imgs.gallery
        .filter(g => g.placeName && !g.placeName.startsWith('__override_'))
        .map(g => g.placeName.toLowerCase().trim())
    );

    // Itens que têm OVERRIDE manual selecionado no editor de geração.
    // Override vence sempre na renderização — não desperdiçar chamada Unsplash aqui.
    // Override schema: imagesByDest[destId]._overrides[segKey][itemIdx] = { url, name }
    const overrideKeys = imgs._overrides || {};
    const hasOverride = (segKey, itemIdx) => {
      const seg = overrideKeys[segKey];
      if (!seg) return false;
      const o = seg[itemIdx] || seg[String(itemIdx)];
      return !!(o && o.url);
    };

    const cityCtx = dest.city || dest.country || '';

    for (const segKey of segments) {
      const data = tip?.segments?.[segKey];
      if (!data?.items) continue;

      data.items.forEach((item, itemIdx) => {
        if (tasks.length >= MAX_ITEMS) return;
        // BUG FIX: simple_list segments (bairros, arredores) usam .title (sem 'u')
        // enquanto place_list usa .titulo. Suportar ambos.
        const titulo = item?.titulo || item?.title;
        if (!titulo) return;
        const t = titulo.toLowerCase().trim();
        if (haveByTitle.has(t)) return;          // já tem foto na gallery cadastrada
        if (hasOverride(segKey, itemIdx)) return; // user escolheu manualmente — pula

        const querySpecific = cityCtx ? `${titulo} ${cityCtx}` : titulo;
        const queryGeneric  = SEG_GENERIC[segKey]
          ? `${SEG_GENERIC[segKey]} ${cityCtx}`.trim()
          : cityCtx;
        tasks.push({ destId: dest.id, titulo, segKey, querySpecific, queryGeneric });
      });
      if (tasks.length >= MAX_ITEMS) break;
    }
    if (tasks.length >= MAX_ITEMS) break;
  }

  if (!tasks.length) return;
  console.log(`[autoPhotos] Buscando ${tasks.length} fotos (Unsplash → Wikipedia → fallback genérico)…`);

  // 4.46.2+ DEDUP GLOBAL: rastreia URLs já alocadas (qualquer dest, qualquer stage).
  // Pre-popula com URLs JÁ na gallery (cadastro manual + overrides) pra evitar
  // que Unsplash retorne a mesma foto que já está cadastrada.
  // Resolve report: "fallback nao pode repetir foto no export".
  const usedUrls = new Set();
  for (const destId of Object.keys(imagesByDest)) {
    (imagesByDest[destId]?.gallery || []).forEach(g => { if (g.url) usedUrls.add(g.url); });
    if (imagesByDest[destId]?.hero) usedUrls.add(imagesByDest[destId].hero);
  }

  // Stage 1: query específica em batches de 8 paralelo. Agora pede count=5
  // pra ter alternativas se a top foto já foi usada por outro item.
  const BATCH = 8;
  const fallbackNeeded = [];
  let addedSpecific = 0;
  for (let i = 0; i < tasks.length; i += BATCH) {
    const batch = tasks.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(t =>
        fnPhoto({ query: t.querySpecific, count: 5 }).then(r => ({ ...t, photo: r.data })).catch(() => ({ ...t, err: true }))
      )
    );
    for (const res of results) {
      const v = res.value;
      if (res.status !== 'fulfilled' || v.err || !v.photo) {
        fallbackNeeded.push(v);
        continue;
      }
      // Pega 1ª URL não-usada do array retornado
      const urls = v.photo.urls || (v.photo.url ? [v.photo.url] : []);
      const sources = v.photo.sources || (v.photo.source ? [v.photo.source] : []);
      const attrs = v.photo.attributions || (v.photo.attribution ? [v.photo.attribution] : []);
      let pickedIdx = -1;
      for (let j = 0; j < urls.length; j++) {
        if (!usedUrls.has(urls[j])) { pickedIdx = j; break; }
      }
      if (pickedIdx === -1) {
        // TODAS as URLs deste query já em uso — tenta fallback genérico
        fallbackNeeded.push(v);
        continue;
      }
      const pickedUrl = urls[pickedIdx];
      usedUrls.add(pickedUrl);  // marca como usada
      imagesByDest[v.destId].gallery.push({
        url:              pickedUrl,
        placeName:        v.titulo,
        name:             v.titulo,
        tags:             [],
        _autoFetched:     true,
        _photoSource:     sources[pickedIdx] || sources[0],
        _attribution:     attrs[pickedIdx] || attrs[0] || '',
        _attributionUrl:  v.photo.attributionUrl || '',
      });
      addedSpecific++;
    }
  }

  // Stage 2: pra itens que não acharam, query genérica AGRUPADA por queryGeneric.
  // Faz 1 fetch por grupo pedindo count=5, depois cicla as fotos entre os items
  // (evita todos os items do mesmo segmento+cidade ficarem com a mesma foto).
  let addedGeneric = 0;
  if (fallbackNeeded.length > 0) {
    // Agrupa por queryGeneric (ex: 'nightlife bar Paris' → [item1, item2, item3])
    const groups = new Map();
    for (const t of fallbackNeeded) {
      if (!groups.has(t.queryGeneric)) groups.set(t.queryGeneric, []);
      groups.get(t.queryGeneric).push(t);
    }
    console.log(`[autoPhotos] ${fallbackNeeded.length} sem foto específica → ${groups.size} groups (count=5 por group, cycling)…`);

    // 1 fetch por group com count=5 (Unsplash retorna top 5, cache armazena todas)
    const groupResults = await Promise.allSettled(
      [...groups.entries()].map(([queryGeneric, items]) =>
        fnPhoto({ query: queryGeneric, count: 5 })
          .then(r => ({ items, photoData: r.data }))
          .catch(() => ({ items, err: true }))
      )
    );

    for (const res of groupResults) {
      if (res.status !== 'fulfilled') continue;
      const { items, photoData, err } = res.value;
      if (err || !photoData) continue;
      const urls = photoData.urls || (photoData.url ? [photoData.url] : []);
      const sources = photoData.sources || (photoData.source ? [photoData.source] : []);
      const attrs = photoData.attributions || (photoData.attribution ? [photoData.attribution] : []);
      if (!urls.length) continue;

      // 4.46.2+ Filtra URLs já usadas globalmente. Se sobrar 0, pula este
      // group (não enche gallery com fotos repetidas). Se sobrar 1+, cicla
      // round-robin entre as disponíveis.
      const availableUrls = urls.map((u, i) => ({ url: u, idx: i }))
        .filter(o => !usedUrls.has(o.url));
      if (!availableUrls.length) return;  // todas duplicatas — desiste deste group

      items.forEach((v, idx) => {
        const pick = availableUrls[idx % availableUrls.length];
        usedUrls.add(pick.url);  // marca como usada (afeta próximos groups)
        imagesByDest[v.destId].gallery.push({
          url:             pick.url,
          placeName:       v.titulo,
          name:            v.titulo,
          tags:            [],
          _autoFetched:    true,
          _photoSource:    sources[pick.idx] || sources[0],
          _photoFallback:  true,
          _attribution:    attrs[pick.idx] || attrs[0] || '',
        });
        addedGeneric++;
      });
    }
  }
  const totalAdded = addedSpecific + addedGeneric;
  console.log(`[autoPhotos] ${totalAdded}/${tasks.length} fotos no gallery (${addedSpecific} específicas + ${addedGeneric} genéricas com cycling).`);
}

async function generateWebLink({ allTips, segments, areaName, area, colors, format, imagesOverride = {}, heroImageOverride = {}, clientName = '' }) {
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

      // Hero override (foto de capa escolhida pelo usuário no editor)
      const heroOv = heroImageOverride[dest.id];
      if (heroOv?.url) {
        imagesByDest[dest.id].hero = heroOv.url;
      }

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

  // ═══ ENRIQUECIMENTO AUTOMATICO COM UNSPLASH ═══
  // Pra cada item dos segmentos selecionados que NAO tem imagem,
  // busca foto via Cloud Function fetchDestinationPhoto (Unsplash + fallback Wikipedia).
  // Adiciona ao gallery com placeName=titulo pra que portal-view/PDF/PPTX
  // peguem automaticamente.
  await enrichGalleryWithAutoPhotos(imagesByDest, allTips, segments).catch(e => {
    console.warn('[PRIMETOUR] enrichGallery falhou (nao-blocker):', e.message);
  });

  const profile = store.get('userProfile') || {};
  const uid     = store.get('currentUser')?.uid || null;

  // v4.62.47+ Fase E pós-audit (Web link): persiste exports.web pra
  // portal-view.html ler. Antes: UI Áreas → Exports → Web salvava mas
  // backend ignorava (último zumbi de exports). headerText vira faixa
  // superior na page renderizada; footerText vira texto sob o logo footer;
  // hideCover é NO-OP pra Web (não existe slide de capa em página HTML).
  const _webExportTpl = resolveExportTemplate(area, 'portal', 'web');
  const _webFooterText = formatExportText(_webExportTpl.footerText || '', { areaName, title: 'Portal de Dicas' });
  const _webHeaderText = formatExportText(_webExportTpl.headerText || '', { areaName, title: 'Portal de Dicas' });

  // v4.63.22+ Detecta template uploaded pra Web Link (formato 'web').
  // Se setado, grava templateId + templateMode no doc; portal-view.html
  // (ou portal-view-tpl.html v4.63.23+) lê e renderiza Handlebars conforme
  // o mode ('full' substitui página, 'slots' injeta partes).
  let _webTemplateMeta = null;
  const _webTplId = area?.templateRefs?.portal?.web;
  if (_webTplId) {
    try {
      const { fetchTemplate } = await import('./templates.js');
      const _tpl = await fetchTemplate(_webTplId);
      if (_tpl && _tpl.status === 'active') {
        // v4.63.30+ Drift fix: NÃO grava fileUrl (paridade com generateRoteiroWebLink).
        // CF getTemplateHtml busca via templateId — anônimo editando fileUrl
        // via PATCH no Firestore não consegue redirecionar pra outro lugar.
        _webTemplateMeta = {
          templateId:   _tpl.id,
          templateName: _tpl.name,
          templateMode: _tpl.templateMode || 'full',
        };
      } else if (_tpl) {
        console.warn(`[portalGenerator web] template ${_webTplId} status=${_tpl.status} (não-active) — ignorado`);
      } else {
        console.warn(`[portalGenerator web] template ${_webTplId} não encontrado — ignorado`);
      }
    } catch (e) {
      console.warn('[portalGenerator web] fetchTemplate falhou:', e?.message);
    }
  }

  try {
    await setDoc(ref, {
      token,
      format,
      allTips:      allTips.map(({ tip, dest }) => ({ tipId: tip?.id || null, destId: dest?.id || null })),
      tipData:      allTips.map(({ tip, dest }) => ({ tip, dest })),
      segments,
      areaName,
      areaLogoUrl:    area?.logoUrl    || null,
      areaLogoUrlAlt: area?.logoUrlAlt || null,
      colors,
      // v4.63.22+ Template Web Link metadata (null se sem template configurado)
      webTemplate: _webTemplateMeta,
      // v4.62.39 (Fase A.1 — fix D1): persiste fonts/editorial/modules pra
      // portal-view.html ler. Antes: UI salvava em portal_areas.fonts mas
      // generator omitia aqui → portal-view fallback Poppins/defaults.
      // Modelo copiado de roteiros.js:855 que já salva area inteira.
      fonts:     area?.fonts     || null,
      editorial: area?.editorial || null,
      modules:   area?.modules   || null,
      // v4.62.47+ exports.web ja resolvido (placeholders formatados) — só ler em portal-view
      webExports: {
        footerText: _webFooterText,
        headerText: _webHeaderText,
      },
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

  // URL final: usa previewLink Cloud Function pra que crawlers (WhatsApp, Slack,
  // Facebook, LinkedIn, Telegram) vejam OG meta correto (foto do destino + titulo)
  // antes de redirecionar pra portal-view real. URL antiga continua funcionando.
  // v4.63.23+ Se há webTemplate configurado, URL aponta pra portal-view-tpl.html
  // (renderer client-side de templates). Modo slots ainda usa portal-view.html
  // canônico com flag ?slots=1.
  const baseUrl = window.location.origin + window.location.pathname.replace(/index\.html$/, '');
  const directUrl  = _webTemplateMeta
    ? `${baseUrl}portal-view-tpl.html#${token}`
    : `${baseUrl}portal-view.html#${token}`;
  const previewUrl = `https://us-central1-gestor-de-tarefas-primetour.cloudfunctions.net/previewLink?t=${encodeURIComponent(token)}`;

  return {
    url:        previewUrl,    // URL pra compartilhar (com OG meta dinamica)
    directUrl,                  // URL direta (legacy / debug)
    token,
  };
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
