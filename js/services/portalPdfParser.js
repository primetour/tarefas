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

/* ─── PDF.js loader (CDN, on-demand) ─────────────────────── */
let _pdfjsPromise = null;
async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  if (_pdfjsPromise) return _pdfjsPromise;

  _pdfjsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => {
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      } catch (e) { reject(e); }
    };
    s.onerror = () => reject(new Error('Falha ao carregar pdf.js'));
    document.head.appendChild(s);
  });
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
  const base = name
    .replace(/\.[pP][dD][fF]$/, '')
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
  // Ordem importa: mais específicos antes
  { match: /^INFORMAÇÕES\s+GERAIS$/i,          key: 'informacoes_gerais' },
  { match: /^CLIMA$/i,                          key: '__clima' },
  { match: /^REPRESENTAÇÃO\s+BRASILEIRA/i,      key: '__representacao' },
  { match: /^BAIRROS$/i,                        key: 'bairros' },
  { match: /^ATRAÇÕES\s+PARA\s+CRIANÇAS$/i,     key: 'atracoes_criancas' },
  { match: /^ATRAÇÕES$/i,                       key: 'atracoes' },
  { match: /^RESTAURANTES$/i,                   key: 'restaurantes' },
  { match: /^VIDA\s+NOTURNA$/i,                 key: 'vida_noturna' },
  { match: /^CASAS?\s+DE\s+ESPETÁCULOS/i,       key: 'espetaculos' },
  { match: /^COMPRAS$/i,                        key: 'compras' },
  { match: /^ARREDORES$/i,                      key: 'arredores' },
  { match: /^HIGHLIGHTS$/i,                     key: 'highlights' },
  { match: /^AGENDA\s+CULTURAL$/i,              key: 'agenda_cultural' },
  { match: /^EVENTOS\s+ESPORTIVOS$/i,           key: '__eventos_esportivos' },
  { match: /^DICA$/i,                           key: '__dica' },
];

function detectTopSection(line) {
  const s = line.trim();
  for (const rule of TOP_SECTIONS) {
    if (rule.match.test(s)) return rule.key;
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
function extractContactFields(block) {
  // block = array of lines (primeira linha já é o título, ignoramos aqui)
  const body = block.slice(1);
  let telefone = '', site = '', endereco = '';
  const descLines = [];

  // Varre de trás para frente catando Tel./Link e endereço
  const tail = [];
  for (let i = body.length - 1; i >= 0; i--) {
    const l = body[i];
    if (/^tel\.?\s*[:]?/i.test(l)) {
      telefone = l.replace(/^tel\.?\s*[:]?\s*/i, '').trim();
    } else if (/^link\s*[:]/i.test(l)) {
      site = l.replace(/^link\s*[:]\s*/i, '').trim();
    } else if (!telefone && !site && !endereco && l && !descLines.length && tail.length === 0) {
      // linha imediatamente acima dos contatos (se ainda não pegou nada) é o endereço
      tail.unshift(l);
    } else {
      tail.unshift(l);
    }
  }

  // Se não achou tel/link, mas a última linha parece endereço, usa como endereço
  if (!telefone && !site && tail.length > 1) {
    const last = tail[tail.length - 1];
    if (/\d/.test(last) || /street|avenue|road|rue|strasse|rua|avenida/i.test(last)) {
      endereco = last;
      tail.pop();
    }
  } else if (tail.length) {
    // A "última linha útil" de tail é o endereço (linha acima de tel/link)
    // Se ainda não definiu, usa-a.
    if (!endereco) {
      endereco = tail[tail.length - 1];
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

function parsePlaceList(bodyLines, segKey, useSubcategories = false) {
  const blocks = splitBlocks(bodyLines);
  const rows = [];
  let currentCategoria = '';

  const subcatList = (segKey === 'atracoes' || segKey === 'atracoes_criancas')
    ? ATRACOES_SUBCATS
    : (SEGMENT_SUBCATS[segKey] || []);
  const subcatSet = new Set(subcatList.map(norm));

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

    // Item: primeira linha deve parecer um título
    if (!isAllCaps(firstLine) && !/^\d/.test(firstLine)) continue;

    const { descricao, endereco, telefone, site } = extractContactFields(block);
    rows.push({
      type: 'dica',
      segmento:  segLabel(segKey),
      categoria: currentCategoria,
      titulo:    firstLine.trim(),
      descricao,
      endereco,
      telefone,
      site,
      observacoes: '',
      periodo:    '',
    });
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
    const firstLine = block[0];
    if (!isAllCaps(firstLine)) continue;

    const descricao = block.slice(1).join(' ').replace(/\s+/g, ' ').trim();
    rows.push({
      type: 'dica',
      segmento:  segLabel(segKey),
      categoria: '',
      titulo:    firstLine.trim(),
      descricao,
      endereco:  '',
      telefone:  '',
      site:      '',
      observacoes: '',
      periodo:   '',
    });
  }

  return rows;
}

/* ─── Section splitter ───────────────────────────────────── */
// Agrupa linhas por seção top-level identificada
function splitIntoSections(lines) {
  const sections = [];
  let current = { key: '__header', lines: [] };

  for (const line of lines) {
    const top = detectTopSection(line);
    if (top) {
      sections.push(current);
      current = { key: top, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return sections;
}

/* ─── Main entry point ───────────────────────────────────── */
export async function parsePortalPdf(file) {
  if (!file || !/\.pdf$/i.test(file.name || '')) {
    throw new Error('Arquivo PDF inválido.');
  }

  const meta  = parseFileName(file.name);
  const lines = await extractText(file);
  if (!lines.length) throw new Error('PDF vazio ou ilegível.');

  const sections = splitIntoSections(lines);

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
