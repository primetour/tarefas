/**
 * PRIMETOUR — Portal de Dicas: Parser de PDFs
 *
 * Extrai texto de um PDF no padrão "[CONTINENTE] - [PAÍS] - [CIDADE] (Val. DD_MM_YYYY)_PTS.pdf"
 * e retorna linhas compatíveis com o fluxo de importação existente (normalizeRow/normalizeInfoRow).
 *
 * Uso:
 *   import { parsePortalPdf } from './portalPdfParser.js';
 *   const rows = await parsePortalPdf(file);   // File object
 *
 * O parser identifica seções top-level por cabeçalhos em CAIXA ALTA:
 *   DICA · INFORMAÇÕES GERAIS · CLIMA · REPRESENTAÇÃO BRASILEIRA
 *   BAIRROS · ATRAÇÕES · ATRAÇÕES PARA CRIANÇAS · RESTAURANTES
 *   VIDA NOTURNA · COMPRAS · ARREDORES · HIGHLIGHTS
 *   AGENDA CULTURAL · EVENTOS ESPORTIVOS
 *
 * O resultado é uma lista plana de rows prontos para alimentar `showReview()` /
 * `runImport()` de portalImport.js — exatamente o mesmo shape produzido por `parseXLSX`.
 */

import { SEGMENTS } from './portal.js';

/* ─── CDN loader resiliente (v4.49.64+) ─────────────────────
 * Tenta múltiplos CDNs em sequência. Resolve assim que um carrega
 * ou rejeita após esgotar todos. Trata bloqueio por
 * Tracking Prevention (Edge/Brave/Firefox) que silencia
 * carregamentos de jsdelivr/etc — daí o fallback pra cdnjs.
 * ───────────────────────────────────────────────────────────── */
function _loadScriptFromAny(urls, globalKey) {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (globalKey && window[globalKey]) return Promise.resolve(window[globalKey]);

  return urls.reduce((p, url) => p.catch(() => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = () => {
      if (globalKey && !window[globalKey]) {
        // Script carregou mas global não populou — algo bloqueou silenciosamente.
        reject(new Error(`Script ${url} loaded but window.${globalKey} is missing`));
        return;
      }
      resolve(globalKey ? window[globalKey] : true);
    };
    s.onerror = () => reject(new Error(`Falha ao carregar ${url}`));
    document.head.appendChild(s);
  })), Promise.reject(new Error('init')));
}

/* ─── PDF.js loader (CDN, on-demand, com fallback) ───────── */
let _pdfjsPromise = null;
async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  if (_pdfjsPromise) return _pdfjsPromise;

  _pdfjsPromise = (async () => {
    try {
      await _loadScriptFromAny([
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
        'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js',
      ], 'pdfjsLib');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      return window.pdfjsLib;
    } catch (e) {
      _pdfjsPromise = null; // permite retry futuro
      throw new Error(
        'Não foi possível carregar o parser de PDF. Pode ser bloqueio ' +
        'da proteção de rastreio do seu navegador (Edge: Prevenção de ' +
        'Rastreamento; Brave: Shields; Firefox: ETP). Adicione o site ' +
        'às exceções ou desative para esta página.'
      );
    }
  })();
  return _pdfjsPromise;
}

/* ─── Filename parsing ───────────────────────────────────── */
// Aceita: "EUA - Nova York - Nova York (Val. 31_07_2026)_PTS.pdf"
//         "Europa - França - Paris.pdf"
//         "Itália - Roma.pdf"
// Mapeia países conhecidos → continente (usado quando o arquivo vem sem continente)
const COUNTRY_TO_CONTINENT = {
  'eua': 'América do Norte', 'estados unidos': 'América do Norte',
  'canadá': 'América do Norte', 'canada': 'América do Norte', 'méxico': 'América do Norte', 'mexico': 'América do Norte',
  'brasil': 'Brasil',
  'argentina': 'América do Sul', 'chile': 'América do Sul', 'peru': 'América do Sul', 'uruguai': 'América do Sul', 'colômbia': 'América do Sul', 'colombia': 'América do Sul',
  'frança': 'Europa', 'franca': 'Europa', 'itália': 'Europa', 'italia': 'Europa',
  'espanha': 'Europa', 'portugal': 'Europa', 'alemanha': 'Europa',
  'reino unido': 'Europa', 'inglaterra': 'Europa', 'holanda': 'Europa',
  'bélgica': 'Europa', 'belgica': 'Europa', 'suíça': 'Europa', 'suica': 'Europa',
  'áustria': 'Europa', 'austria': 'Europa', 'grécia': 'Europa', 'grecia': 'Europa',
  'japão': 'Ásia', 'japao': 'Ásia', 'china': 'Ásia', 'tailândia': 'Ásia', 'tailandia': 'Ásia',
  'coreia do sul': 'Ásia', 'índia': 'Ásia', 'india': 'Ásia', 'vietnã': 'Ásia', 'vietna': 'Ásia',
  'emirados árabes unidos': 'Oriente Médio', 'dubai': 'Oriente Médio',
  'israel': 'Oriente Médio', 'turquia': 'Oriente Médio', 'egito': 'África',
  'áfrica do sul': 'África', 'africa do sul': 'África', 'marrocos': 'África',
  'austrália': 'Oceania', 'australia': 'Oceania', 'nova zelândia': 'Oceania', 'nova zelandia': 'Oceania',
};

function normalizeCountry(name) {
  const n = (name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (n === 'eua') return 'Estados Unidos';
  return name;
}

function parseFileName(name) {
  // v4.49.73+ Tira extensão .pdf, .docx e .doc (era só .pdf — DOCX
  // ficava com "Cape Town.docx" como cidade, não batia em destino cadastrado).
  const base = name
    .replace(/\.(pdf|docx?|xlsx?)$/i, '')
    .replace(/_PTS$/i, '')
    .replace(/\s*\(Val\..*?\)\s*/i, '')
    .trim();

  const parts = base.split(/\s*-\s*/).map(s => s.trim()).filter(Boolean);

  let continente = '', pais = '', cidade = '';
  if (parts.length >= 3) {
    // Formato: CONTINENTE - PAÍS - CIDADE
    // Mas alguns arquivos antigos usam PAÍS - ESTADO - CIDADE (ex.: "EUA - Nova York - Nova York")
    const [a, b, c] = parts;
    const aNorm = a.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (COUNTRY_TO_CONTINENT[aNorm]) {
      // primeiro campo é país
      continente = COUNTRY_TO_CONTINENT[aNorm];
      pais       = normalizeCountry(a);
      cidade     = c;
    } else {
      continente = a;
      pais       = normalizeCountry(b);
      cidade     = c;
    }
  } else if (parts.length === 2) {
    pais   = normalizeCountry(parts[0]);
    cidade = parts[1];
    const n = parts[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (COUNTRY_TO_CONTINENT[n]) continente = COUNTRY_TO_CONTINENT[n];
  } else if (parts.length === 1) {
    cidade = parts[0];
  }

  return { continente, pais, cidade };
}

/* ─── Text extraction ────────────────────────────────────── */
async function extractText(file) {
  const pdfjsLib = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf  = await pdfjsLib.getDocument({ data }).promise;

  const allLines = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();

    // Agrupa items pela coordenada Y (linha)
    const byLine = new Map();
    for (const it of content.items) {
      if (!it.str) continue;
      // Ignora strings puramente vazias/espaços de posicionamento
      if (!it.str.trim() && !it.hasEOL) continue;
      const y = Math.round(it.transform[5]);
      if (!byLine.has(y)) byLine.set(y, []);
      byLine.get(y).push(it);
    }

    // Ordena Y desc (topo → base)
    const ySorted = [...byLine.keys()].sort((a, b) => b - a);

    // Calcula line-height típico (mediana dos gaps) para detectar quebras de parágrafo
    const gaps = [];
    for (let k = 1; k < ySorted.length; k++) gaps.push(ySorted[k - 1] - ySorted[k]);
    gaps.sort((a, b) => a - b);
    const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 20;
    const paragraphGap = Math.max(medianGap * 1.6, medianGap + 5);

    let prevY = null;
    for (const y of ySorted) {
      if (prevY !== null && (prevY - y) > paragraphGap) {
        // Inserir linha em branco para marcar quebra de parágrafo
        allLines.push('');
      }
      const items = byLine.get(y).sort((a, b) => a.transform[4] - b.transform[4]);
      let text = items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
      // Conserta hifens que o join inseriu espaço ao redor (ex.: "guarda - roupa" → "guarda-roupa")
      text = text.replace(/([A-Za-zÀ-ÿ0-9])\s+-\s+([A-Za-zÀ-ÿ0-9])/g, '$1-$2');
      if (text) allLines.push(text);
      prevY = y;
    }

    // NÃO insere blank entre páginas — um item pode quebrar no meio da página
    // e o blank artificial dividiria o bloco. Continuidade do texto será tratada
    // pelos detectores de parágrafo da próxima página.
  }

  return allLines;
}

/* ─── Heading detection ──────────────────────────────────── */
const TOP_SECTIONS = [
  // Ordem importa: mais específicos antes.
  // v4.63.36+ Regex tolerantes a:
  //   - whitespace trailing/leading (\s* nas pontas)
  //   - pontuação final opcional (\s*[:.\-–—]?\s*$)
  //   - artigos no meio (AS/OS opcional pra "para [as] crianças")
  //   - acento ausente (cri[aá]nças)
  { match: /^\s*INFORMAÇÕES\s+GERAIS\s*[:.\-–—]?\s*$/i,            key: 'informacoes_gerais' },
  { match: /^\s*CLIMA\s*[:.\-–—]?\s*$/i,                            key: '__clima' },
  { match: /^\s*REPRESENTAÇÃO\s+BRASILEIRA/i,                       key: '__representacao' },
  { match: /^\s*BAIRROS\s*[:.\-–—]?\s*$/i,                          key: 'bairros' },
  // v4.63.36+ Fortalecido: aceita "ATRAÇÕES PARA (AS|OS) CRIANÇAS" e variações.
  { match: /^\s*ATRA[ÇC][ÕO]ES\s+PARA(?:\s+(?:AS|OS))?\s+CRIAN[ÇC]AS\s*[:.\-–—]?\s*$/i, key: 'atracoes_criancas' },
  // v4.63.36+ Variações comuns: "ATRAÇÕES INFANTIS", "PARA CRIANÇAS" sozinho
  { match: /^\s*ATRA[ÇC][ÕO]ES\s+INFANT[IÍ]S\s*[:.\-–—]?\s*$/i,     key: 'atracoes_criancas' },
  { match: /^\s*PARA\s+(?:AS\s+)?CRIAN[ÇC]AS\s*[:.\-–—]?\s*$/i,     key: 'atracoes_criancas' },
  { match: /^\s*ATRA[ÇC][ÕO]ES\s*[:.\-–—]?\s*$/i,                  key: 'atracoes' },
  { match: /^\s*RESTAURANTES\s*[:.\-–—]?\s*$/i,                     key: 'restaurantes' },
  { match: /^\s*VIDA\s+NOTURNA\s*[:.\-–—]?\s*$/i,                   key: 'vida_noturna' },
  { match: /^\s*CASAS?\s+DE\s+ESPET[ÁA]CULOS/i,                     key: 'espetaculos' },
  { match: /^\s*COMPRAS\s*[:.\-–—]?\s*$/i,                          key: 'compras' },
  { match: /^\s*ARREDORES\s*[:.\-–—]?\s*$/i,                        key: 'arredores' },
  { match: /^\s*HIGHLIGHTS\s*[:.\-–—]?\s*$/i,                       key: 'highlights' },
  { match: /^\s*AGENDA\s+CULTURAL\s*[:.\-–—]?\s*$/i,                key: 'agenda_cultural' },
  { match: /^\s*EVENTOS\s+ESPORTIVOS\s*[:.\-–—]?\s*$/i,             key: '__eventos_esportivos' },
  { match: /^\s*DICA\s*[:.\-–—]?\s*$/i,                             key: '__dica' },
];

/* ─── v4.49.66+ Mapeamento subtítulo → segment key por palavras-chave
 * Usado quando o subtítulo do arquivo não bate exato com TOP_SECTIONS
 * (ex: "Restaurante" em vez de "RESTAURANTES", "Onde comer" em vez de
 * "GASTRONOMIA"). Heurística determinística, sem LLM.
 *
 * Algoritmo:
 *   1. Normaliza o subtítulo (lowercase, sem acento, sem pontuação).
 *   2. Procura qual conjunto de keywords tem maior match.
 *   3. Vence o segment com o keyword mais longo casado.
 *   4. Se nenhum casar, retorna __unclassified (vai pra revisão manual
 *      do usuário no fluxo de import).
 * ──────────────────────────────────────────────────────────────────── */
const SEGMENT_KEYWORDS = [
  { key: 'informacoes_gerais', kws: ['informacoes gerais', 'informacoes', 'info geral', 'dados gerais', 'sobre a cidade', 'sobre o destino'] },
  { key: '__clima',            kws: ['clima', 'temperatura', 'tempo', 'estacoes'] },
  { key: '__representacao',    kws: ['representacao brasileira', 'consulado', 'embaixada brasileira'] },
  { key: 'bairros',            kws: ['bairros', 'regioes', 'neighborhoods', 'distritos'] },
  { key: 'arredores',          kws: ['arredores', 'ao redor', 'around', 'day trip', 'bate volta', 'proximidades'] },
  { key: 'atracoes_criancas',  kws: ['atracoes para criancas', 'atracoes infantis', 'com criancas', 'para criancas', 'kids', 'familia'] },
  { key: 'atracoes',           kws: ['atracoes', 'pontos turisticos', 'o que fazer', 'passeios', 'tours', 'sightseeing', 'imperdivel', 'imperdiveis', 'visitar'] },
  { key: 'restaurantes',       kws: ['restaurantes', 'restaurante', 'gastronomia', 'onde comer', 'comida', 'food', 'culinaria', 'bares e restaurantes'] },
  { key: 'vida_noturna',       kws: ['vida noturna', 'noturna', 'bares', 'baladas', 'night', 'drinks', 'pubs', 'clubs'] },
  { key: 'espetaculos',        kws: ['casas de espetaculos', 'espetaculos', 'teatros', 'shows', 'broadway', 'west end', 'opera'] },
  { key: 'compras',            kws: ['compras', 'shopping', 'shoppings', 'lojas', 'mercados', 'feiras'] },
  { key: 'highlights',         kws: ['highlights', 'destaques', 'recomendado', 'top picks', 'must see'] },
  { key: 'agenda_cultural',    kws: ['agenda cultural', 'agenda', 'eventos culturais', 'calendario cultural', 'festivais'] },
  { key: '__eventos_esportivos', kws: ['eventos esportivos', 'esportes', 'esporte', 'sports', 'football', 'futebol'] },
];

function _normKw(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Match fuzzy do subtítulo contra SEGMENT_KEYWORDS.
 *  Retorna { key, confidence: 'high'|'medium' } ou null. */
function detectByKeywords(line) {
  const rawLine = String(line || '').trim();
  const norm = _normKw(line);
  if (!norm || norm.length > 80) return null;
  // O subtítulo deve ser "curto" (até ~4 palavras) pra evitar falso match
  // em parágrafos longos que mencionem a palavra de passagem.
  // v4.49.71+ Reduzido de 6 → 4 palavras (descrições começando com "Restaurante moderno..." casavam).
  if (norm.split(' ').length > 4) return null;
  // v4.49.71+ Linha que termina com pontuação é parágrafo, não subtítulo.
  if (/[.!?,;]$/.test(rawLine)) return null;
  // v4.49.71+ Linha com URL/telefone/email/endereço óbvio NÃO é subtítulo.
  if (/^https?:\/\//i.test(rawLine)) return null;
  if (/\d{4,}/.test(rawLine)) return null; // dígitos longos sugerem telefone/CEP

  let best = null;
  for (const { key, kws } of SEGMENT_KEYWORDS) {
    for (const kw of kws) {
      // v4.49.71+ Match mais restrito: EXATO ou linha curta começando com kw.
      // Antes aceitava startsWith(kw+' ') que casava "restaurante moderno..."
      // (descrição) como subtítulo "restaurantes". Agora startsWith só vale
      // se a linha tiver ≤ 1 palavra extra após o kw.
      const matched = norm === kw
                   || (norm.startsWith(kw + ' ') && norm.split(' ').length - kw.split(' ').length <= 1)
                   || norm.endsWith(' ' + kw)
                   || (norm.length === kw.length && norm === kw);
      if (matched) {
        const conf = norm === kw ? 'high' : 'medium';
        if (!best || kw.length > best.kwLen) {
          best = { key, confidence: conf, kwLen: kw.length };
        }
      }
    }
  }
  return best ? { key: best.key, confidence: best.confidence } : null;
}

/** Heurística adicional: linha "parece" um subtítulo?
 *  Critérios cumulativos:
 *   - curta (3..80 chars)
 *   - sem ponto final
 *   - 1ª letra maiúscula OU toda maiúscula
 *   - NÃO contém URL/telefone/endereço óbvio
 *   - cercada por linha em branco (callsite valida) */
function looksLikeHeading(line) {
  const s = String(line || '').trim();
  if (s.length < 3 || s.length > 80) return false;
  if (/[.!?]$/.test(s)) return false;
  if (/^https?:\/\//i.test(s)) return false;
  if (/\bTel\b|\bend\b|\bSite\b|\bLink\b/i.test(s)) return false;
  if (/\d{2,}[-/]\d{2}/.test(s)) return false;          // datas
  if (/\+?\d{2}\s*\(\d/.test(s)) return false;          // telefone formatado
  const firstLetter = s.match(/\p{L}/u)?.[0];
  if (!firstLetter) return false;
  return firstLetter === firstLetter.toUpperCase();
}

function detectTopSection(line) {
  const s = line.trim();
  for (const rule of TOP_SECTIONS) {
    if (rule.match.test(s)) return { key: rule.key, confidence: 'high', source: 'exact' };
  }
  return null;
}

/** v4.49.66+ Detector de subtítulo em 2 estágios:
 *   1. Match exato em TOP_SECTIONS (confidence: high)
 *   2. Match fuzzy por SEGMENT_KEYWORDS (confidence: high/medium)
 *
 *  `surrounding` é { prev, next } pra checar se a linha está cercada
 *  por linhas em branco (sinal forte de subtítulo). */
function detectSection(line, surrounding = {}) {
  const exact = detectTopSection(line);
  if (exact) return exact;

  const kw = detectByKeywords(line);
  if (kw) {
    // Reforça confidence se a linha "parece" subtítulo no formato
    // (caps/short/sem ponto) E está cercada por blank lines.
    const formatScore = looksLikeHeading(line) ? 1 : 0;
    const isolatedScore = ((surrounding.prev ?? '').trim() === '' &&
                           (surrounding.next ?? '').trim() === '') ? 1 : 0;
    const score = formatScore + isolatedScore;
    return {
      key: kw.key,
      confidence: score >= 1 ? kw.confidence : 'low',
      source: 'keyword',
    };
  }
  return null;
}

function isAllCaps(line, { minLen = 3, maxLen = 80 } = {}) {
  const s = line.trim();
  if (s.length < minLen || s.length > maxLen) return false;
  const letters = s.match(/\p{L}/gu) || [];
  if (letters.length < 2) return false;
  const upper = letters.filter(c => c === c.toUpperCase() && c.toLowerCase() !== c).length;
  return upper / letters.length >= 0.9;
}

/* ─── Block splitting ────────────────────────────────────── */
// Divide o corpo de uma seção em "blocos" separados por linhas em branco.
function splitBlocks(lines) {
  const blocks = [];
  let cur = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) {
      if (cur.length) { blocks.push(cur); cur = []; }
    } else {
      cur.push(l);
    }
  }
  if (cur.length) blocks.push(cur);
  return blocks;
}

/* ─── INFORMAÇÕES GERAIS ─────────────────────────────────── */
const INFO_KEY_MAP = [
  [/^popula[cç][aã]o\s*[:：]?/i,              'populacao'],
  [/^moeda\s*[:：]?/i,                         'moeda'],
  [/^l[ií]ngua(?:\s*oficial)?\s*[:：]?/i,      'lingua'],
  [/^religi[aã]o(?:\s+predominante)?\s*[:：]?/i,'religiao'],
  [/^fuso\s*hor[aá]rio\s*[:：]?/i,             'fuso'],
  [/^voltagem\s*[:：]?/i,                      'voltagem'],
  [/^ddi(?:\s*do\s*pa[ií]s)?\s*[:：]?/i,       'ddd'],
  [/^ddd\s*[:：]?/i,                           'ddd'],
];

function parseInfoGerais(lines) {
  const info = {};
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    for (const [re, key] of INFO_KEY_MAP) {
      if (re.test(line)) {
        info[key] = line.replace(re, '').trim();
        break;
      }
    }
  }
  return info;
}

/* ─── CLIMA ──────────────────────────────────────────────── */
function parseClima(lines) {
  const text = lines.join(' ').replace(/\s+/g, ' ');
  // Captura blocos MAX e MIN (12 números cada, com ou sem °C)
  const maxMatch = text.match(/MAX[^\d\-]*((?:-?\d+[^0-9\-]*){12})/i);
  const minMatch = text.match(/MIN[^\d\-]*((?:-?\d+[^0-9\-]*){12})/i);
  if (!maxMatch && !minMatch) return null;
  const extract = (s) => (s.match(/-?\d+/g) || []).slice(0, 12).map(Number);
  return {
    max: maxMatch ? extract(maxMatch[1]) : [],
    min: minMatch ? extract(minMatch[1]) : [],
  };
}

/* ─── Description / location parsing for items ──────────── */
// Para place_list (ATRAÇÕES/RESTAURANTES/...), detecta endereço/telefone/link
/** v4.49.68+ Regexes de prefix expandidas. Antes só pegava "Tel:" e
 *  "Link:". Agora reconhece Telefone/Phone/Fone/WhatsApp/Site/Website/
 *  URL/Endereço/End./Address/Email — incluindo variações com acento
 *  e Title Case. */
const CONTACT_PREFIXES = {
  telefone: /^(?:tel(?:efone|\.|\b)|fone|phone|telephone|whatsapp|wpp)\s*[:.\-–]?\s*/i,
  site:     /^(?:site|website|url|link|web)\s*[:.\-–]?\s*/i,
  endereco: /^(?:endere[cç]o|address|end\.|location|local)\s*[:.\-–]?\s*/i,
  email:    /^(?:e-?mail|email|correio)\s*[:.\-–]?\s*/i,
};

function _stripPrefix(line, regex) {
  return line.replace(regex, '').trim();
}

function extractContactFields(block) {
  // block = array of lines (primeira linha já é o título, ignoramos aqui)
  const body = block.slice(1);
  let telefone = '', site = '', endereco = '';
  const tail = [];

  // v4.49.68+ Varre na ORDEM (start → end) pra preservar a sequência natural
  // do texto. Antes varria backwards pra agarrar tel/link no fim, mas com os
  // prefixes explícitos não precisa.
  for (const l of body) {
    if (!l || !l.trim()) continue;

    if (CONTACT_PREFIXES.telefone.test(l)) {
      telefone = _stripPrefix(l, CONTACT_PREFIXES.telefone);
    } else if (CONTACT_PREFIXES.site.test(l)) {
      site = _stripPrefix(l, CONTACT_PREFIXES.site);
    } else if (CONTACT_PREFIXES.endereco.test(l)) {
      endereco = _stripPrefix(l, CONTACT_PREFIXES.endereco);
    } else if (CONTACT_PREFIXES.email.test(l)) {
      // sem campo dedicado pra email — concatena no telefone se vazio,
      // senão deixa no descricao
      if (!telefone) telefone = _stripPrefix(l, CONTACT_PREFIXES.email);
      else tail.push(l);
    } else {
      tail.push(l);
    }
  }

  // Fallback: se não encontrou endereco via prefix, e a última linha de
  // tail tem dígitos OU palavras-chave de rua, usa como endereço.
  if (!endereco && tail.length > 1) {
    const last = tail[tail.length - 1];
    if (/\d/.test(last) || /street|avenue|road|rue|strasse|rua|avenida|boulevard|av\./i.test(last)) {
      endereco = last;
      tail.pop();
    }
  }

  const descricao = tail.join(' ').replace(/\s+/g, ' ').trim();
  return { descricao, endereco: endereco.trim(), telefone, site };
}

/* ─── place_list / atracoes parser ───────────────────────── */
// Categorias conhecidas para detecção de subcabeçalhos dentro de ATRAÇÕES.
const ATRACOES_SUBCATS = [
  'EDIFÍCIOS E CONSTRUÇÕES URBANAS',
  'GALERIAS DE ARTE',
  'IGREJAS E TEMPLOS',
  'PARQUES E JARDINS',
  'PARQUES',
  'MUSEUS E CENTROS CULTURAIS',
  'MUSEUS',
  'COMPLEXOS ESPORTIVOS',
];

// Categorias conhecidas de outros segmentos (restaurantes/vida_noturna/compras/highlights)
const SEGMENT_SUBCATS = {
  restaurantes: [
    'CAFÉS E BISTRÔS', 'VEGETARIANO E VEGANO', 'ASIÁTICO',
    'CULINÁRIA INTERNACIONAL', 'MEDITERRÂNEO', 'INFANTIL',
  ],
  vida_noturna: ['BALADA', 'BARES E LOUNGES', 'VINHOS'],
  compras: [
    'ANTIGUIDADES', 'ITENS EM COURO', 'BOUTIQUES', 'BRINQUEDOS',
    'COSMÉTICOS', 'DECORAÇÃO', 'GOURMET', 'JOIAS E RELÓGIOS',
    'LIVRARIAS', 'LOJAS DE DEPARTAMENTO', 'MODA FEMININA',
    'MODA INFANTIL', 'MODA MASCULINA', 'SAPATOS FEMININOS',
    'OUTLET', 'ELETRÔNICOS', 'VARIADOS', 'VINHOS', 'VINTAGE',
  ],
  highlights: ['ARQUITETURA', 'ATIVIDADES DE VERÃO', 'PASSEIO DE HELICÓPTERO'],
  espetaculos: ['TEATRO', 'SHOWS'],
};

const AGENDA_SUBCATS = [
  'CONCERTOS', 'DANÇA', 'ESPETÁCULOS DE VARIEDADES',
  'EVENTOS ESPORTIVOS', 'EXPOSIÇÕES', 'FESTIVAIS',
  'MUSICAIS', 'ÓPERAS', 'OPERAS', 'SHOWS',
  // Eventos esportivos sub-types
  'BASEBALL', 'BASQUETEBOL', 'FUTEBOL', 'HÓQUEI', 'HOQUEI',
];

function norm(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

function segLabel(key) {
  return (SEGMENTS.find(s => s.key === key) || {}).label || key;
}

/** v4.49.67+ Detecta se uma linha "parece" começo de novo item dentro
 *  de um bloco (heurística pra dividir items quando não há blank line):
 *   - curta (≤ 60 chars)
 *   - sem ponto final / interrogação / exclamação
 *   - NÃO é endereço/telefone/site/link/etc (qualquer CONTACT_PREFIX completo)
 *   - começa com maiúscula
 *   - tem ≥ 1 letra
 *
 *  v4.49.68+ Usa CONTACT_PREFIXES completos (incluindo "Telefone:",
 *  "Endereço:", "Site:") em vez de regex curto que só pegava "Tel:". */
function _looksLikeItemTitle(line) {
  const s = String(line || '').trim();
  if (!s || s.length > 60) return false;
  if (/[.!?]$/.test(s)) return false;
  // Linhas que são prefixes de contato NUNCA são título de item.
  if (CONTACT_PREFIXES.telefone.test(s)) return false;
  if (CONTACT_PREFIXES.site.test(s))     return false;
  if (CONTACT_PREFIXES.endereco.test(s)) return false;
  if (CONTACT_PREFIXES.email.test(s))    return false;
  // Outros padrões que NÃO são título de item
  if (/^(?:hor[aá]rio|metr[oô]|valor|pre[cç]o|categoria|tipo|estilo)\s*[:.\-–]/i.test(s)) return false;
  if (/^https?:\/\//i.test(s)) return false;
  if (/^\+?\d/.test(s) && /\d{4,}/.test(s)) return false; // telefone/codigo
  const first = s.match(/\p{L}/u)?.[0];
  if (!first) return false;
  return first === first.toUpperCase();
}

function parsePlaceList(bodyLines, segKey, useSubcategories = false) {
  const blocks = splitBlocks(bodyLines);
  const rows = [];
  let currentCategoria = '';

  const subcatList = (segKey === 'atracoes' || segKey === 'atracoes_criancas')
    ? ATRACOES_SUBCATS
    : (SEGMENT_SUBCATS[segKey] || []);
  const subcatSet = new Set(subcatList.map(norm));

  // v4.49.67+ Pra cada block, sub-divide em items por linhas que "parecem título".
  // Antes assumia 1 block = 1 item, mas DOCX Title Case com parágrafos contíguos
  // junta vários items em 1 só block.
  const splitBlockIntoItems = (block) => {
    const items = [];
    let cur = [];
    for (let i = 0; i < block.length; i++) {
      const line = block[i];
      const isFirstLine = cur.length === 0;
      // Início de NOVO item: linha parece título (curta, capitalizada, sem
      // prefix de endereço/tel/etc) E não é a primeira linha do block atual
      // (a primeira sempre vira título do item em curso).
      if (!isFirstLine && _looksLikeItemTitle(line)) {
        items.push(cur);
        cur = [line];
      } else {
        cur.push(line);
      }
    }
    if (cur.length) items.push(cur);
    return items;
  };

  for (const block of blocks) {
    const firstLine = block[0];
    if (!firstLine) continue;

    // Subcabeçalho: bloco tem apenas 1 linha e ela está em CAIXA ALTA
    if (useSubcategories && block.length === 1 && isAllCaps(firstLine)) {
      const key = norm(firstLine);
      if (subcatSet.has(key) || /^[A-ZÀ-Ý0-9\s.·&,()'–-]+$/.test(firstLine)) {
        currentCategoria = firstLine.trim();
        continue;
      }
    }

    // v4.49.67+ Divide o block em items individuais (suporta Title Case)
    const items = splitBlockIntoItems(block);
    for (const itemLines of items) {
      const itemFirst = itemLines[0];
      if (!itemFirst) continue;
      // Aceita: ALL CAPS (legacy), começa com dígito (numbered), OU Title Case
      // que pareça título (heurística nova).
      const isValid = isAllCaps(itemFirst)
                   || /^\d/.test(itemFirst)
                   || _looksLikeItemTitle(itemFirst);
      if (!isValid) continue;

      const { descricao, endereco, telefone, site } = extractContactFields(itemLines);
      rows.push({
        type: 'dica',
        segmento:  segLabel(segKey),
        categoria: currentCategoria,
        titulo:    itemFirst.trim(),
        descricao,
        endereco,
        telefone,
        site,
        observacoes: '',
        periodo:    '',
      });
    }
  }

  return rows;
}

/* ─── Agenda cultural parser ─────────────────────────────── */
// Item em agenda: TITLE / venue / site / description... / período
function parseAgenda(bodyLines, segKey = 'agenda_cultural') {
  const blocks = splitBlocks(bodyLines);
  const rows = [];
  let currentCategoria = '';

  const subcatSet = new Set(AGENDA_SUBCATS.map(norm));

  for (const block of blocks) {
    const firstLine = block[0];
    if (!firstLine) continue;

    // Subcabeçalho (CONCERTOS, DANÇA, etc.)
    if (block.length === 1 && isAllCaps(firstLine)) {
      if (subcatSet.has(norm(firstLine))) {
        currentCategoria = firstLine.trim();
        continue;
      }
    }

    // Pula DICA (disclaimer) dentro de AGENDA
    if (/^DICA$/i.test(firstLine)) continue;

    if (!isAllCaps(firstLine)) continue;

    // Estrutura típica: [0]=title, [1]=venue, [2]=site, [3..n-2]=desc, [n-1]=período
    const body = block.slice(1);
    let endereco = '';
    let site     = '';
    let periodo  = '';
    let descLines = [...body];

    if (body.length >= 2) {
      endereco = body[0];
      // Detecta linha de site: sem espaços, contém ponto e é predominantemente minúscula
      if (body[1] && /^[\w.\-/?=&%]+\.(com|org|net|gov|br|us|fr|it|uk|ly)/i.test(body[1]) && !body[1].includes(' ')) {
        site = body[1];
        descLines = body.slice(2);
      } else {
        descLines = body.slice(1);
      }
      // Última linha tende a ser o período
      if (descLines.length >= 1) {
        const last = descLines[descLines.length - 1];
        if (/^(de\s|a\s|até|temporada|\d|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez|\w+\s+\d+)/i.test(last)) {
          periodo = last;
          descLines = descLines.slice(0, -1);
        }
      }
    }

    rows.push({
      type: 'dica',
      segmento:  segLabel(segKey),
      categoria: currentCategoria,
      titulo:    firstLine.trim(),
      descricao: descLines.join(' ').replace(/\s+/g, ' ').trim(),
      endereco,
      telefone:  '',
      site,
      observacoes: '',
      periodo,
    });
  }

  return rows;
}

/* ─── Simple list parser (BAIRROS, ARREDORES) ────────────── */
function parseSimpleList(bodyLines, segKey) {
  const blocks = splitBlocks(bodyLines);
  const rows = [];

  for (const block of blocks) {
    if (!block.length) continue;

    // v4.49.67+ Cada linha do block que "pareça título" vira um item.
    // Para parseSimpleList (Bairros/Arredores), padrão típico no Word:
    //   "Habous: medina nova construída pelos franceses."
    //   "Anfa: bairro residencial de elite."
    // Aceita: ALL CAPS (legacy) ou linha com ":" (padrão Title Case + descrição).
    for (const rawLine of block) {
      const line = rawLine.trim();
      if (!line) continue;

      let titulo = '', descricao = '';
      if (isAllCaps(line)) {
        titulo = line;
      } else if (line.includes(':')) {
        // "Nome do Bairro: descrição livre"
        const [t, ...rest] = line.split(':');
        titulo = t.trim();
        descricao = rest.join(':').trim();
        if (!titulo || !_looksLikeItemTitle(titulo)) continue;
      } else if (_looksLikeItemTitle(line)) {
        titulo = line;
      } else {
        // Linha de continuação da descrição do item anterior
        if (rows.length) rows[rows.length - 1].descricao =
          (rows[rows.length - 1].descricao + ' ' + line).trim();
        continue;
      }

      rows.push({
        type: 'dica',
        segmento:  segLabel(segKey),
        categoria: '',
        titulo,
        descricao,
        endereco:  '',
        telefone:  '',
        site:      '',
        observacoes: '',
        periodo:   '',
      });
    }
  }

  return rows;
}

/* ─── Section splitter ───────────────────────────────────── */
// Agrupa linhas por seção top-level identificada
/** v4.49.66+ Divide o documento em seções usando 3 estratégias em ordem:
 *   1. Linha é heading marcado pelo Word (DOCX h1/h2/h3) — confidence: high
 *      mesmo em Title Case, porque o style do Word é signal forte.
 *   2. Match exato em TOP_SECTIONS (legado) — confidence: high.
 *   3. Match fuzzy por SEGMENT_KEYWORDS — confidence: high/medium/low
 *      dependendo do quão "subtítulo" a linha parece.
 *
 *  `headingHints` (opcional) é um Set<number> com índices de linhas que
 *  vieram de tags <h1-h6> do DOCX. Quando presente, eleva a confidence
 *  do match por keyword.
 *
 *  Linhas que parecem heading (looksLikeHeading) mas não batem com
 *  nenhuma keyword viram seção `__unclassified` — vai pra UI de revisão. */
function splitIntoSections(lines, { headingHints = null } = {}) {
  const sections = [];
  let current = { key: '__header', confidence: 'high', source: 'header', lines: [] };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isWordHeading = headingHints?.has(i) === true;

    const det = detectSection(line, {
      prev: lines[i - 1],
      next: lines[i + 1],
    });

    if (det) {
      // Se o Word marcou como heading, eleva confidence pra high
      const confidence = isWordHeading ? 'high' : det.confidence;
      sections.push(current);
      current = {
        key: det.key,
        confidence,
        source: isWordHeading ? `${det.source}+word-heading` : det.source,
        title: line.trim(),
        lines: [],
      };
      continue;
    }

    // Linha marcada como heading pelo Word mas não casou em nenhum keyword:
    // cria seção __unclassified com o título original (UI pede vinculação).
    if (isWordHeading && looksLikeHeading(line)) {
      sections.push(current);
      current = {
        key: '__unclassified',
        confidence: 'low',
        source: 'word-heading-unmapped',
        title: line.trim(),
        lines: [],
      };
      continue;
    }

    current.lines.push(line);
  }
  sections.push(current);
  return sections;
}

/* ─── Main entry point ───────────────────────────────────── */
// v4.57.43 PD17: error classification helper. Espelho R3 (Roteiros v4.57.38).
// Classifica falhas em códigos pra UI distinguir transiente (rate_limit,
// timeout, network) vs permanente (invalid_file, empty_content, parse_fail).
// Erros lançados desta função carregam err.code + err.isRetryable.
function _portalParseError(message, code, isRetryable = false) {
  const e = new Error(message);
  e.code = code;
  e.isRetryable = isRetryable;
  return e;
}

export async function parsePortalPdf(file, overrideMeta = null) {
  if (!file || !/\.pdf$/i.test(file.name || '')) {
    throw _portalParseError('Arquivo PDF inválido.', 'invalid_file', false);
  }

  // 4.49.13+ Permite override do destino quando o nome do arquivo não casa
  // com o formato esperado "Continente - País - Cidade.pdf".
  // Resolve relato: "não reconhecia o nome do destino, apesar de estar tudo certinho".
  const meta = overrideMeta || parseFileName(file.name);

  // Valida: se NÃO veio override E parseFileName não conseguiu inferir país/cidade,
  // lança erro com instrução clara em vez de processar com dados vazios.
  if (!overrideMeta && (!meta.pais || !meta.cidade)) {
    throw _portalParseError(
      `Não foi possível identificar país/cidade pelo nome do arquivo "${file.name}". ` +
      `Renomeie pra "Continente - País - Cidade.pdf" ` +
      `(ex.: "Europa - França - Paris.pdf") OU use o seletor de destino na UI antes de subir.`,
      'invalid_filename', false,
    );
  }

  let lines;
  try {
    lines = await extractText(file);
  } catch (e) {
    // pdf.js falha — geralmente PDF corrompido, criptografado ou formato desconhecido
    const msg = String(e?.message || e || '');
    if (/password|encrypt/i.test(msg)) {
      throw _portalParseError('PDF protegido por senha. Remova a proteção e tente novamente.', 'pdf_encrypted', false);
    }
    throw _portalParseError(`Falha ao extrair texto do PDF: ${msg}`, 'pdf_corrupted', false);
  }
  if (!lines.length) {
    throw _portalParseError('PDF vazio ou ilegível.', 'empty_content', false);
  }
  return linesToRows(lines, meta);
}

/* ─── 4.49.13+ Pipeline interno: lines + meta → rows ────────
 * Extraído pra reuso entre parsePortalPdf e parsePortalDocx.
 * Aceita um array de strings (linhas do documento) + meta com
 * continente/pais/cidade, e retorna o array de rows pronto pro
 * fluxo do portalImport.
 */
function linesToRows(lines, meta, { headingHints = null } = {}) {
  const sections = splitIntoSections(lines, { headingHints });

  // ─── Montagem do resultado ───
  const rows       = [];
  const infoRow    = {
    type: 'info_geral',
    continente: meta.continente,
    pais:       meta.pais,
    cidade:     meta.cidade,
    descricao:  '',
    populacao:  '', moeda: '', lingua: '', religiao: '',
    fuso: '', voltagem: '', ddd: '',
  };

  // Guarda textos de CLIMA/REPRESENTAÇÃO para anexar na "descricao" do info
  let climaBlock        = '';
  let representacaoBlock = '';

  // Header: o que vem antes de qualquer seção = intro + nome do destino + parágrafo "A cidade é..."
  const header = sections.find(s => s.key === '__header');
  if (header) {
    // Remove linhas tipo "NOVA YORK" (nome do destino em caixa alta sozinho)
    const clean = header.lines.filter(l => {
      const s = l.trim();
      if (!s) return false;
      if (isAllCaps(s)) return false; // nome do destino
      return true;
    });
    infoRow.descricao = clean.join(' ').replace(/\s+/g, ' ').trim();
  }

  for (const sec of sections) {
    if (!sec.lines.length) continue;

    switch (sec.key) {
      case 'informacoes_gerais': {
        Object.assign(infoRow, parseInfoGerais(sec.lines));
        break;
      }
      case '__clima': {
        const clima = parseClima(sec.lines);
        if (clima) {
          const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
          const parts = [];
          if (clima.max.length) parts.push('Máx: ' + clima.max.map((v, i) => `${MONTHS[i]} ${v}°C`).join(' · '));
          if (clima.min.length) parts.push('Mín: ' + clima.min.map((v, i) => `${MONTHS[i]} ${v}°C`).join(' · '));
          climaBlock = 'CLIMA — TEMPERATURA ANUAL (MÉDIAS)\n' + parts.join('\n');
        } else {
          climaBlock = 'CLIMA\n' + sec.lines.join(' ').replace(/\s+/g, ' ').trim();
        }
        break;
      }
      case '__representacao': {
        representacaoBlock = 'REPRESENTAÇÃO BRASILEIRA\n' +
          sec.lines.join(' ').replace(/\s+/g, ' ').trim();
        break;
      }
      case 'bairros':
      case 'arredores': {
        const items = parseSimpleList(sec.lines, sec.key);
        rows.push(...items.map(r => ({ ...r, ...meta })));
        break;
      }
      case 'atracoes':
      case 'atracoes_criancas':
      case 'restaurantes':
      case 'vida_noturna':
      case 'compras':
      case 'highlights':
      case 'espetaculos': {
        const items = parsePlaceList(sec.lines, sec.key, /* useSubcategories */ true);
        // Filtra itens vazios (cabeçalhos isolados)
        const kept = items.filter(it => it.descricao || it.endereco || it.telefone || it.site);
        rows.push(...kept.map(r => ({ ...r, ...meta })));
        break;
      }
      case 'agenda_cultural': {
        const items = parseAgenda(sec.lines, 'agenda_cultural');
        const kept = items.filter(it => it.descricao || it.endereco || it.site || it.periodo);
        rows.push(...kept.map(r => ({ ...r, ...meta })));
        break;
      }
      case '__eventos_esportivos': {
        // EVENTOS ESPORTIVOS vira parte de agenda_cultural com categoria "Eventos Esportivos"
        const items = parseAgenda(sec.lines, 'agenda_cultural');
        const kept = items.filter(it => it.descricao || it.endereco || it.site || it.periodo);
        for (const it of kept) {
          if (!it.categoria) it.categoria = 'Eventos Esportivos';
          rows.push({ ...it, ...meta });
        }
        break;
      }
      case '__unclassified': {
        // v4.49.66+ Bloco com heading reconhecido pelo Word mas que não
        // bateu em nenhuma keyword. Cria rows tipo place_list marcadas
        // como precisando de vinculação manual de segmento (UI exibe
        // dropdown "Mover pra segmento…").
        const items = parsePlaceList(sec.lines, 'atracoes', /* useSubcategories */ false);
        const kept = items.filter(it => it.descricao || it.endereco || it.telefone || it.site || it.titulo);
        for (const it of kept) {
          rows.push({
            ...it,
            ...meta,
            __needsReview: true,
            __originalHeading: sec.title || '(sem título)',
            segmento: '', // user precisa atribuir
          });
        }
        break;
      }
      default:
        break;
    }
  }

  // Concatena clima + representação no campo descricao do infoRow (fallback,
  // pois o editor de dicas hoje não tem campos dedicados para esses dados).
  const extras = [climaBlock, representacaoBlock].filter(Boolean).join('\n\n');
  if (extras) {
    infoRow.descricao = (infoRow.descricao ? infoRow.descricao + '\n\n' : '') + extras;
  }

  rows.push(infoRow);

  // Garante que todas as rows de dica tenham continente/pais/cidade (usados no agrupamento)
  return rows.map(r => ({
    ...r,
    continente: r.continente || meta.continente,
    pais:       r.pais       || meta.pais,
    cidade:     r.cidade     || meta.cidade,
  }));
}

/* ─── 4.49.13+ Parser DOCX ────────────────────────────────────
 * Aceita .docx pelo mesmo fluxo do PDF. Usa mammoth (CDN) pra
 * extrair raw text, divide em linhas, aplica o pipeline interno.
 *
 * Convenção de nome do arquivo igual ao PDF:
 *   "Continente - País - Cidade.docx"
 *   (ex: "Europa - França - Paris.docx")
 *
 * Estrutura de conteúdo igual ao PDF (seções: INFORMAÇÕES GERAIS,
 * GASTRONOMIA, etc) — usa os mesmos splitters/parsers do PDF.
 */
let _mammothLoading = null;
function loadMammoth() {
  if (window.mammoth) return Promise.resolve(window.mammoth);
  if (_mammothLoading) return _mammothLoading;
  // v4.49.64+ Tracking Prevention do Edge/Brave bloqueia jsdelivr
  // silenciosamente. Ordem preferencial: cdnjs (mais permitido) →
  // jsdelivr → unpkg. Se todos falharem, mostra mensagem clara.
  _mammothLoading = (async () => {
    try {
      return await _loadScriptFromAny([
        'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js',
        'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js',
        'https://unpkg.com/mammoth@1.6.0/mammoth.browser.min.js',
      ], 'mammoth');
    } catch (e) {
      _mammothLoading = null; // permite retry futuro
      throw new Error(
        'Não foi possível carregar o parser DOCX. Provavelmente a ' +
        'proteção de rastreio do navegador bloqueou a biblioteca ' +
        '(Edge: Prevenção de Rastreamento; Brave: Shields; ' +
        'Firefox: ETP). Soluções: (a) adicione este site às ' +
        'exceções, (b) use o Chrome, ou (c) converta o .docx em ' +
        '.xlsx pelo modelo de planilha.'
      );
    }
  })();
  return _mammothLoading;
}

async function extractDocxLines(file) {
  const mammoth = await loadMammoth();
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  const raw = result?.value || '';
  // Split em linhas + remove linhas só de espaço, preservando blanks (que
  // mammoth gera entre parágrafos — usado pelo splitIntoSections pra detectar
  // quebras de bloco).
  return raw.split(/\r?\n/).map(l => l.trimEnd());
}

/** v4.49.66+ Extrai linhas do DOCX preservando indicadores de heading
 *  (h1, h2, h3 do estilo do Word). Linhas que vinham de headings ficam
 *  marcadas com '​' no fim — sentinela invisível usada pelo
 *  detector pra elevar confidence sem afetar o texto visível.
 *
 *  Fallback: se convertToHtml falhar, cai pro extractRawText (legado).
 *  ─────────────────────────────────────────────────────────────────── */
const HEADING_MARKER = '​'; // zero-width space — invisível
async function extractDocxLinesWithHeadings(file) {
  const mammoth = await loadMammoth();
  const arrayBuffer = await file.arrayBuffer();
  let html;
  try {
    const result = await mammoth.convertToHtml({ arrayBuffer });
    html = result?.value || '';
  } catch (e) {
    console.warn('[parser] convertToHtml falhou, usando raw text:', e?.message);
    return extractDocxLines(file);
  }
  if (!html) return extractDocxLines(file);

  // Parse no DOM e expande em linhas, marcando headings.
  // v4.49.67+ NÃO adiciona blank line após cada <p> — mammoth retira <p>
  // vazios, então emitir blank após cada parágrafo faria splitBlocks criar
  // 1 block por linha (quebrando items que têm título + descrição + endereço
  // em parágrafos sucessivos). Blank line só envolta de headings/listas.
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const lines = [];
  for (const child of tmp.children) {
    const tag = child.tagName?.toLowerCase();
    const text = (child.textContent || '').trim();
    if (!text) {
      lines.push(''); // preserva quebras explícitas
      continue;
    }
    if (/^h[1-6]$/.test(tag)) {
      // Garante blank antes (se a linha anterior não for blank)
      if (lines.length && lines[lines.length - 1] !== '') lines.push('');
      lines.push(text + HEADING_MARKER);
      lines.push('');
    } else if (tag === 'p') {
      // Cada <p> é UMA linha (sem blank após — preserva continuidade do item)
      const inner = child.innerHTML.split(/<br\s*\/?>/i);
      for (const part of inner) {
        const t = part.replace(/<[^>]+>/g, '').trim();
        if (t) lines.push(t);
      }
    } else if (tag === 'ul' || tag === 'ol') {
      if (lines.length && lines[lines.length - 1] !== '') lines.push('');
      for (const li of child.querySelectorAll('li')) {
        const t = (li.textContent || '').trim();
        if (t) lines.push(t);
      }
      lines.push('');
    } else {
      lines.push(text);
    }
  }
  return lines;
}

export async function parsePortalDocx(file, overrideMeta = null) {
  if (!file || !/\.docx$/i.test(file.name || '')) {
    throw new Error('Arquivo DOCX inválido.');
  }
  const meta = overrideMeta || parseFileName(file.name);
  if (!overrideMeta && (!meta.pais || !meta.cidade)) {
    throw new Error(
      `Não foi possível identificar país/cidade pelo nome do arquivo "${file.name}". ` +
      `Renomeie pra "Continente - País - Cidade.docx" ` +
      `(ex.: "Europa - França - Paris.docx").`
    );
  }
  // v4.49.66+ Usa extractor com marker de heading (Word styles h1/h2/h3)
  // pra ajudar o detector a identificar subtítulos mesmo em Title Case.
  const lines = await extractDocxLinesWithHeadings(file);
  if (!lines.length) throw new Error('DOCX vazio ou ilegível.');
  return linesToRows(lines.map(l => l.replace(/​$/, '')), meta, {
    headingHints: new Set(lines
      .map((l, i) => l.endsWith(HEADING_MARKER) ? i : null)
      .filter(i => i !== null)),
  });
}
