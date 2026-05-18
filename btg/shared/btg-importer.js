/**
 * Importador de ofertas BTG a partir de Excel (.xlsx) ou Word (.docx).
 *
 * Port vanilla do `lib/import-oferta-parser.ts` do BTG Next.js.
 * Mantém o mesmo mapa de aliases (português + inglês + variações com/sem acento)
 * e os mesmos conversores por tipo (data, moeda, parcelamento, etc.).
 *
 * Diferenças vs original:
 * - xlsx e mammoth via CDN ESM (sem bundler).
 * - Constantes (TIPO_CARTAO, TIPO_OFERTA, CONCIERGE_SUBTIPO) inlined.
 * - Retorna `Promise<{ values, detected, warnings }>` em ambos os formatos.
 *
 * Uso:
 *   import { parseFile } from '/btg/shared/btg-importer.js';
 *   const { values, detected, warnings } = await parseFile(file);
 *   // values é um objeto parcial pronto pra saveOferta(values)
 */

import * as XLSX from 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';
import mammoth from 'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/+esm';

// ─── Constantes inlined do BTG Next.js ──────────────────────

const TIPO_CARTAO_VALUES = ['Partners', 'Ultrablue', 'Operadora'];
const isTipoCartao = (v) => TIPO_CARTAO_VALUES.includes(String(v).trim());

const TIPO_OFERTA_VALUES = [
  'Feriado', 'Destino', 'Cruzeiro', 'Hospedagem',
  'Aéreo & Transfers', 'Concierge',
];
const isTipoOferta = (v) =>
  TIPO_OFERTA_VALUES.some((t) => t.toLowerCase() === String(v).trim().toLowerCase());

const CONCIERGE_SUBTIPO_VALUES = [
  'Gastronomia', 'Eventos & Esportes', 'Shopping & Gifts', 'Lifestyle & Moda',
];
const isConciergeSubtipo = (v) =>
  CONCIERGE_SUBTIPO_VALUES.some((s) => s.toLowerCase() === String(v).trim().toLowerCase());

// ─── Mapa de aliases → chave canônica ───────────────────────

const FIELD_ALIASES = {
  // Visibilidade
  'tipo_cartao': 'tipo_cartao', 'tipo de cartao': 'tipo_cartao', 'tipo de cartão': 'tipo_cartao',
  'sites': 'tipo_cartao', 'marcas': 'tipo_cartao', 'cartao': 'tipo_cartao', 'cartão': 'tipo_cartao',
  'tipo_oferta': 'tipo_oferta', 'tipo de oferta': 'tipo_oferta', 'tipo': 'tipo_oferta',
  'concierge_subtipo': 'concierge_subtipo', 'subtipo concierge': 'concierge_subtipo',
  'area concierge': 'concierge_subtipo', 'área concierge': 'concierge_subtipo',
  'categoria concierge': 'concierge_subtipo',
  'oferta_destaque': 'oferta_destaque', 'destaque': 'oferta_destaque',
  'destacar': 'oferta_destaque', 'destacar na home': 'oferta_destaque',
  // Conteúdo
  'destino_rota': 'destino_rota', 'destino': 'destino_rota', 'rota': 'destino_rota', 'local': 'destino_rota',
  'nome_da_oferta': 'nome_da_oferta', 'nome da oferta': 'nome_da_oferta',
  'nome': 'nome_da_oferta', 'titulo': 'nome_da_oferta', 'título': 'nome_da_oferta',
  'descricao': 'descricao', 'descrição': 'descricao', 'resumo': 'descricao', 'sobre': 'descricao',
  'oferta_especial': 'oferta_especial', 'selo': 'oferta_especial', 'tag': 'oferta_especial',
  'destaque visual': 'oferta_especial',
  'nome_feriado': 'nome_feriado', 'feriado': 'nome_feriado', 'nome do feriado': 'nome_feriado',
  'nome_navio': 'nome_navio', 'navio': 'nome_navio', 'nome do navio': 'nome_navio',
  'companhia_aerea': 'companhia_aerea', 'companhia aerea': 'companhia_aerea',
  'companhia aérea': 'companhia_aerea', 'ciasaerea': 'companhia_aerea',
  'cia aerea': 'companhia_aerea', 'cia aérea': 'companhia_aerea',
  'cia. aerea': 'companhia_aerea', 'cia. aérea': 'companhia_aerea',
  'classe_aerea': 'classe_aerea', 'classe aerea': 'classe_aerea',
  'classe aérea': 'classe_aerea', 'classe': 'classe_aerea',
  'local_evento': 'local_evento', 'local do evento': 'local_evento',
  'venue': 'local_evento', 'estadio': 'local_evento', 'estádio': 'local_evento',
  'categoria_ingresso': 'categoria_ingresso', 'categoria do ingresso': 'categoria_ingresso',
  'ingresso': 'categoria_ingresso',
  // Detalhes
  'duracao_noites': 'duracao_noites', 'duracao': 'duracao_noites', 'duração': 'duracao_noites',
  'noites': 'duracao_noites', 'dias': 'duracao_noites',
  'tipo_acomodacao': 'tipo_acomodacao', 'tipo de acomodacao': 'tipo_acomodacao',
  'tipo de acomodação': 'tipo_acomodacao', 'acomodacao': 'tipo_acomodacao',
  'acomodação': 'tipo_acomodacao', 'quarto': 'tipo_acomodacao',
  'configuracao_hospedes': 'configuracao_hospedes',
  'configuracao de hospedes': 'configuracao_hospedes',
  'configuração de hóspedes': 'configuracao_hospedes',
  'hospedes': 'configuracao_hospedes', 'hóspedes': 'configuracao_hospedes',
  'nacional_internacional': 'nacional_internacional',
  'nacional/internacional': 'nacional_internacional',
  'ni': 'nacional_internacional', 'escopo': 'nacional_internacional',
  'estado_pais': 'estado_pais', 'estado': 'estado_pais', 'pais': 'estado_pais',
  'país': 'estado_pais', 'estado/pais': 'estado_pais', 'estado/país': 'estado_pais',
  // Datas
  'data_de_inicio': 'data_de_inicio', 'data de inicio': 'data_de_inicio',
  'data de início': 'data_de_inicio', 'inicio': 'data_de_inicio',
  'início': 'data_de_inicio', 'data inicio': 'data_de_inicio',
  'data_final': 'data_final', 'data final': 'data_final',
  'fim': 'data_final', 'data fim': 'data_final',
  'data_expiracao': 'data_expiracao', 'data de expiracao': 'data_expiracao',
  'data de expiração': 'data_expiracao', 'expiracao': 'data_expiracao',
  'expiração': 'data_expiracao', 'validade': 'data_expiracao',
  // Preço
  'preco_sob_consulta': 'preco_sob_consulta', 'preco sob consulta': 'preco_sob_consulta',
  'preço sob consulta': 'preco_sob_consulta', 'sob consulta': 'preco_sob_consulta',
  'preco': 'preco', 'preço': 'preco', 'valor': 'preco',
  'moeda': 'moeda', 'currency': 'moeda',
  'parcelamento': 'parcelamento', 'parcelas': 'parcelamento',
  'contexto_do_preco': 'contexto_do_preco', 'contexto do preco': 'contexto_do_preco',
  'contexto do preço': 'contexto_do_preco', 'contexto': 'contexto_do_preco',
  'taxas': 'taxas', 'impostos': 'taxas',
  // Pacote
  'incluso_no_pacote': 'incluso_no_pacote', 'incluso no pacote': 'incluso_no_pacote',
  'inclui no pacote': 'incluso_no_pacote', 'inclui': 'incluso_no_pacote',
  'incluso': 'incluso_no_pacote',
  'beneficios_marca': 'beneficios_marca', 'beneficios marca': 'beneficios_marca',
  'benefícios da marca': 'beneficios_marca', 'beneficios cartao': 'beneficios_marca',
  'benefícios do cartão': 'beneficios_marca',
  'beneficios': 'beneficios_marca', 'benefícios': 'beneficios_marca',
  'condicoes_observacoes': 'condicoes_observacoes',
  'condições e observações': 'condicoes_observacoes',
  'condicoes': 'condicoes_observacoes', 'condições': 'condicoes_observacoes',
  'observacoes': 'condicoes_observacoes', 'observações': 'condicoes_observacoes',
  // Mídia
  'texto_alternativo_alt': 'texto_alternativo_alt',
  'alt': 'texto_alternativo_alt', 'texto alternativo': 'texto_alternativo_alt',
};

const normalizeKey = (raw) => String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
const canonicalKey = (raw) => FIELD_ALIASES[normalizeKey(raw)] ?? null;

// ─── Conversores por tipo ───────────────────────────────────

const strVal = (v) => v == null ? '' : String(v).trim();
const boolVal = (v) => {
  if (typeof v === 'boolean') return v;
  const s = strVal(v).toLowerCase();
  return s === 'sim' || s === 'yes' || s === 'true' || s === '1';
};

function parseTipoCartao(v) {
  const s = strVal(v);
  if (!s) return [];
  return s.split(/[;,/|]/).map((p) => p.trim()).filter(isTipoCartao);
}

function parseDestaque(v) {
  return boolVal(v) ? 'Sim' : 'Não';
}

function excelDateToISO(serial) {
  const utcDays = Math.floor(serial - 25569);
  const date = new Date(utcDays * 86400 * 1000);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function parseDate(v) {
  if (typeof v === 'number') return excelDateToISO(v);
  const s = strVal(v);
  if (!s) return '';
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return '';
}

function parseMoeda(v) {
  const s = strVal(v).toUpperCase();
  if (s.includes('US') || s === '$') return 'US$';
  if (s.includes('EUR') || s === '€') return 'EUR';
  return 'R$';
}

function parseParcelamento(v) {
  const m = strVal(v).match(/(\d{1,2})/);
  if (!m) return '1';
  return String(Math.max(1, Math.min(10, Number.parseInt(m[1], 10))));
}

function parseConciergeSubtipo(v) {
  const s = strVal(v);
  if (isConciergeSubtipo(s)) {
    // Retorna no formato canônico (case sensitive)
    return CONCIERGE_SUBTIPO_VALUES.find((sub) => sub.toLowerCase() === s.toLowerCase()) || '';
  }
  for (const sub of CONCIERGE_SUBTIPO_VALUES) {
    if (s.toLowerCase().includes(sub.toLowerCase())) return sub;
  }
  return '';
}

function parseNacInter(v) {
  const s = strVal(v).toLowerCase();
  if (s.startsWith('inter')) return 'Internacional';
  if (s.startsWith('nac')) return 'Nacional';
  return '';
}

function applyValue(acc, canonical, rawValue) {
  switch (canonical) {
    case 'tipo_cartao':         acc.tipo_cartao = parseTipoCartao(rawValue); break;
    case 'oferta_destaque':     acc.oferta_destaque = parseDestaque(rawValue); break;
    case 'preco_sob_consulta':  acc.preco_sob_consulta = boolVal(rawValue); break;
    case 'moeda':               acc.moeda = parseMoeda(rawValue); break;
    case 'parcelamento':        acc.parcelamento = parseParcelamento(rawValue); break;
    case 'data_de_inicio':
    case 'data_final':
    case 'data_expiracao':      acc[canonical] = parseDate(rawValue); break;
    case 'concierge_subtipo':   acc.concierge_subtipo = parseConciergeSubtipo(rawValue); break;
    case 'nacional_internacional': acc.nacional_internacional = parseNacInter(rawValue); break;
    case 'tipo_oferta': {
      const s = strVal(rawValue);
      if (isTipoOferta(s)) {
        acc.tipo_oferta = TIPO_OFERTA_VALUES.find((t) => t.toLowerCase() === s.toLowerCase());
      }
      break;
    }
    default: acc[canonical] = strVal(rawValue);
  }
}

// ─── Parser Excel ───────────────────────────────────────────

export function parseXlsxBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) throw new Error('Planilha sem abas.');
  const sheet = wb.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1, blankrows: false, defval: '',
  });

  if (rows.length === 0) {
    return { values: {}, detected: [], warnings: ['Planilha vazia.'] };
  }

  const acc = {};
  const detected = [];
  const warnings = [];

  const firstRow = rows[0];
  const looksLikeKeyValue =
    rows.length >= 2 &&
    firstRow.length <= 2 &&
    typeof firstRow[0] === 'string' &&
    canonicalKey(String(firstRow[0])) !== null;

  if (looksLikeKeyValue || (rows.length > 1 && rows[0].length === 2 && !firstRow[1])) {
    // Layout A: key-value (cada linha: campo, valor)
    for (const row of rows) {
      const [k, v] = row;
      if (!k) continue;
      const canon = canonicalKey(String(k));
      if (!canon) {
        warnings.push(`Coluna desconhecida ignorada: "${k}"`);
        continue;
      }
      applyValue(acc, canon, v);
      detected.push(canon);
    }
  } else {
    // Layout B: headers + 1 linha de dados
    const headers = rows[0];
    const dataRow = rows[1];
    if (!dataRow) {
      return { values: {}, detected: [], warnings: ['Planilha sem linha de dados.'] };
    }
    for (let i = 0; i < headers.length; i++) {
      const k = headers[i];
      if (!k) continue;
      const canon = canonicalKey(String(k));
      if (!canon) {
        warnings.push(`Coluna desconhecida ignorada: "${k}"`);
        continue;
      }
      applyValue(acc, canon, dataRow[i]);
      detected.push(canon);
    }
  }

  return { values: acc, detected, warnings };
}

// ─── Parser Word (.docx) ────────────────────────────────────

export async function parseDocxBuffer(buffer) {
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  const text = result.value || '';
  const acc = {};
  const detected = [];
  const warnings = [];

  const lines = text.split(/\r?\n/);
  let currentCanon = null;
  let currentBuf = [];

  const flush = () => {
    if (currentCanon && currentBuf.length > 0) {
      const value = currentBuf.join('\n').trim();
      if (value) {
        applyValue(acc, currentCanon, value);
        if (!detected.includes(currentCanon)) detected.push(currentCanon);
      }
    }
    currentBuf = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([^:]+):\s*(.+)?$/);
    if (m) {
      const k = m[1];
      const v = m[2] ?? '';
      const canon = canonicalKey(k);
      if (canon) {
        flush();
        currentCanon = canon;
        currentBuf = v ? [v] : [];
        continue;
      }
    }
    if (currentCanon) currentBuf.push(line);
    else warnings.push(`Linha ignorada: "${line.slice(0, 60)}..."`);
  }
  flush();

  return { values: acc, detected, warnings };
}

// ─── Entry point: detecta formato e parseia ─────────────────

export async function parseFile(file) {
  const name = file.name.toLowerCase();
  const buffer = await file.arrayBuffer();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return parseXlsxBuffer(buffer);
  }
  if (name.endsWith('.docx')) {
    return await parseDocxBuffer(buffer);
  }
  throw new Error(`Formato não suportado: ${name}. Use .xlsx ou .docx.`);
}

export { TIPO_OFERTA_VALUES, TIPO_CARTAO_VALUES, CONCIERGE_SUBTIPO_VALUES };
