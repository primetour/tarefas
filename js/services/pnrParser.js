/**
 * PRIMETOUR — Parser de PNR (Amadeus / Sabre / Travelport Galileo) (v4.62.26+)
 *
 * Decodifica formatos de tarifa aérea de GDS pra estrutura interna
 * { airline, flightNumber, originCity, originIata, destinationCity,
 *   destinationIata, departureDate, departureTime, arrivalDate, arrivalTime }.
 *
 * Inspirado em pnrreader.online (open na web, lógica algoritmo genérico).
 * Reusa JSONs IATA públicos (códigos IATA são standard internacional).
 *
 * Exemplos suportados:
 *
 *   Amadeus:  1 EK 262O 10APR 6 GRUDXB*SS1  0135  2300  /DCEK /E
 *   Sabre:    1 LA8064 N 23MAR 7 GIGGRU SS1   0700  0815  /DCLA*VYJDFC /E
 *   Galileo:  1. IB271 Y 23MAR MADGRU SS1   1140  1735
 *   Simples:  IB271 23MAR MADGRU 1140 1735
 *
 * Output formato schema flights[]:
 *   { airline, flightNumber, originCity, originIata, destinationCity,
 *     destinationIata, departureDate (ISO YYYY-MM-DD), departureTime (HH:MM),
 *     arrivalDate (ISO), arrivalTime (HH:MM) }
 */

const IATA_AIRLINES_URL  = 'https://pnr-reader.vercel.app/airline_codes.json';
const IATA_AIRPORTS_URL  = 'https://pnr-reader.vercel.app/airport_codes.json';

let _airlinesCache = null;
let _airportsCache = null;

/**
 * Carrega códigos IATA de cia + aeroporto (cache em sessionStorage, 30 dias).
 * Tolerante a falha — fallback retorna IATA puro em vez de nome.
 */
async function _loadIataData() {
  if (_airlinesCache && _airportsCache) return { airlines: _airlinesCache, airports: _airportsCache };

  // Tenta sessionStorage primeiro
  try {
    const cached = sessionStorage.getItem('pnr.iata.v1');
    if (cached) {
      const { airlines, airports, savedAt } = JSON.parse(cached);
      if (Date.now() - savedAt < 30 * 24 * 60 * 60 * 1000) {
        _airlinesCache = airlines;
        _airportsCache = airports;
        return { airlines, airports };
      }
    }
  } catch {}

  // Fetch fresh
  try {
    const [airlines, airports] = await Promise.all([
      fetch(IATA_AIRLINES_URL).then(r => r.json()),
      fetch(IATA_AIRPORTS_URL).then(r => r.json()),
    ]);
    _airlinesCache = airlines;
    _airportsCache = airports;
    try {
      sessionStorage.setItem('pnr.iata.v1', JSON.stringify({ airlines, airports, savedAt: Date.now() }));
    } catch {/* over quota */}
    return { airlines, airports };
  } catch (e) {
    console.warn('[pnrParser] fetch IATA falhou:', e?.message);
    _airlinesCache = {};
    _airportsCache = {};
    return { airlines: {}, airports: {} };
  }
}

const MONTHS_3_LETTER = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/** Resolve data DDMMM (ex: "23MAR") → ISO YYYY-MM-DD. Se mês já passou, assume próximo ano. */
function _parseGdsDate(ddmmm) {
  const m = /^(\d{2})([A-Z]{3})$/.exec(ddmmm);
  if (!m) return '';
  const day = parseInt(m[1], 10);
  const month = MONTHS_3_LETTER[m[2]];
  if (month == null) return '';
  const now = new Date();
  let year = now.getFullYear();
  const candidate = new Date(year, month, day);
  // Se candidata é >180 dias atrás, assume próximo ano (típico de PNR future-dated)
  if (candidate.getTime() < now.getTime() - 180 * 86400000) year++;
  const d = new Date(year, month, day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Adiciona N dias a uma ISO date. */
function _addDays(iso, n) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');   // T12 evita timezone shift (CLAUDE.md §12.a)
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Formata 4 dígitos "0135" → "01:35". */
function _fmtTime(hhmm) {
  if (!hhmm || hhmm.length !== 4) return '';
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`;
}

/**
 * Resolve IATA airport code → "Cidade, País (XXX)" via dicionário público.
 * Fallback: retorna o próprio IATA se não encontrado.
 */
export function formatAirport(iata, airports) {
  if (!iata) return '';
  const data = airports?.[iata];
  return data || iata;
}

/**
 * Resolve IATA airline code → "Nome da Companhia" via dicionário público.
 * Fallback: retorna IATA se não encontrado.
 */
export function formatAirline(iata, airlines) {
  if (!iata) return iata || '';
  return airlines?.[iata] || iata;
}

/**
 * Parse de UMA linha de PNR. Retorna objeto ou null se não conseguiu extrair.
 * Heurística (independente de GDS específico — algoritmo genérico):
 *   - Pula prefixo até primeira letra (remove "1 ", "1.", " 1 ", etc)
 *   - 2 letras iniciais = código IATA cia
 *   - Próximos dígitos = número do voo (ignora chars não-numéricos depois — classe tarifária etc)
 *   - Busca primeiro DDMMM (data) no resto
 *   - Busca 2 sequências consecutivas de 3 letras IATA = origem + destino
 *   - Busca 2 sequências de 4 dígitos consecutivos = saída + chegada
 *   - Se chegada < saída, assume overnight (+1 dia na chegada)
 */
/**
 * v4.62.34: blacklist de códigos que NUNCA são IATA de aeroporto.
 * Cobre moedas + paxTypes + códigos de taxas GDS + commands. Evita que
 * linhas de tarifa (ex: "1- USD3874.00 USD2499.20 XT USD6373.20 ADT") sejam
 * confundidas com voos quando heurística de 2-letras+digitos aceita "USD" /
 * "ADT" / "XT" como IATA.
 */
const NON_AIRPORT_CODES = new Set([
  // Moedas ISO 4217 mais comuns em GDS
  'USD','EUR','BRL','GBP','CHF','CAD','ARS','CLP','JPY','CNY','MXN','AUD','NZD','HKD','SGD','THB','INR','ZAR',
  // Pax types IATA
  'ADT','CHD','INF','CNN','YTH','SRC','STU','MIL','SEN','JNF',
  // Códigos de taxa comuns (não-exaustivo — aparecem em pricing display)
  'XT','YQ','YR','BR','ZR','SW','OI','TK','AY','US','UH','XF','XA','AA','XG','XY','SC','OY','OG','RA','RC',
  // Commands / keywords GDS
  'NCB','WPN','NUC','FOP','TOTAL','TARIFA','BASE','TAXAS','MAIS','PAX','BAG','SEG','OSI','SSR','APIS',
]);

function _parseOneLine(rawLine, airlines, airports) {
  let line = String(rawLine || '').toUpperCase().trim();
  if (!line) return null;

  // v4.62.34: linha de pricing display GDS começa frequentemente com moeda
  // colada em valor (ex: USD3874.00) — rejeita preventivamente.
  if (/\b(USD|EUR|BRL|GBP|CHF|CAD|ARS|CLP|JPY|CNY|AUD|NZD|HKD|SGD|THB|INR|ZAR|MXN)\d/.test(line)) return null;
  // Linhas que começam com "1-" ou similar e contém XT/TOTAL/TARIFA = pricing, não PNR
  if (/^[\d.\-\s]+[A-Z]{3}\d+(\.\d+)?/.test(line)) return null;

  // Skip prefixo até primeira letra
  const firstLetter = line.search(/[A-Z]/);
  if (firstLetter < 0) return null;
  line = line.slice(firstLetter);

  // Código cia: 2 chars
  const airlineCode = line.slice(0, 2);
  if (!/^[A-Z0-9]{2}$/.test(airlineCode)) return null;
  // v4.62.34: rejeita se "cia" é começo de palavra suspeita (USD, ADT, etc)
  const first3 = line.slice(0, 3);
  if (NON_AIRPORT_CODES.has(first3)) return null;

  // Número do voo: dígitos consecutivos após cia (até hit em char não-numérico após começar)
  let flightNumber = '';
  let foundDigit = false;
  let i = 2;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c >= '0' && c <= '9') {
      flightNumber += c;
      foundDigit = true;
    } else if (foundDigit) {
      break;
    }
  }
  if (!flightNumber) return null;

  let rest = line.slice(i).trim();

  // Extrair data DDMMM (1ª ocorrência de 2 dígitos + 3 letras)
  const dateMatch = /(\d{2})([A-Z]{3})/.exec(rest);
  const dateStr = dateMatch ? dateMatch[1] + dateMatch[2] : '';
  const isoDate = dateStr ? _parseGdsDate(dateStr) : '';

  // v4.62.34: data é OBRIGATÓRIA. Linhas de tarifa/comando sem DDMMM viram lixo
  // (5º "voo fake" reportado pelo Renê em "1- USD3874.00 USD2499.20 XT USD6373.20 ADT").
  if (!isoDate) return null;

  // Extrair origem + destino: 2 sequências consecutivas de 3 letras
  // Busca depois da data (se houver) pra evitar pegar mês como código
  const restAfterDate = dateMatch ? rest.slice(dateMatch.index + 5) : rest;
  const iataPairMatch = /([A-Z]{3})([A-Z]{3})/.exec(restAfterDate);
  let origin = '', destination = '';
  if (iataPairMatch) {
    origin = iataPairMatch[1];
    destination = iataPairMatch[2];
  } else {
    // Fallback: 2 IATA separados por chars
    const iatas = restAfterDate.match(/[A-Z]{3}/g);
    if (iatas && iatas.length >= 2) {
      origin = iatas[0];
      destination = iatas[1];
    }
  }
  if (!origin || !destination) return null;
  // v4.62.34: rejeita IATAs que estão na blacklist (USD, ADT, XT, etc)
  if (NON_AIRPORT_CODES.has(origin) || NON_AIRPORT_CODES.has(destination)) return null;
  // v4.62.34: se dicionário de aeroportos carregado, AMBAS IATAs precisam existir nele
  // (defesa final contra IATAs inventadas). Tolerante: se dict vazio (offline), aceita.
  const dictReady = airports && Object.keys(airports).length > 100;
  if (dictReady && (!airports[origin] || !airports[destination])) return null;

  // Horários: 2 sequências de exatamente 4 dígitos
  const timeMatches = restAfterDate.match(/(?:^|[^\d])(\d{4})(?=[^\d]|$)/g) || [];
  const times = timeMatches.map(t => t.replace(/[^\d]/g, ''));
  const departureTime = _fmtTime(times[0] || '');
  let arrivalTime = _fmtTime(times[1] || '');

  // Detecta overnight (chegada < saída em minutos)
  let arrivalDate = isoDate;
  if (departureTime && arrivalTime) {
    const [dh, dm] = departureTime.split(':').map(Number);
    const [ah, am] = arrivalTime.split(':').map(Number);
    if (ah * 60 + am < dh * 60 + dm) {
      arrivalDate = _addDays(isoDate, 1);
    }
  }

  return {
    airline:         formatAirline(airlineCode, airlines),
    airlineCode,
    flightNumber,
    originCity:      formatAirport(origin, airports),
    originIata:      origin,
    destinationCity: formatAirport(destination, airports),
    destinationIata: destination,
    departureDate:   isoDate,
    departureTime,
    arrivalDate,
    arrivalTime,
  };
}

/**
 * Parse PNR multi-linha. Cada linha é um trecho. Retorna array de objetos.
 * Linhas inválidas são silenciosamente puladas.
 */
export async function parsePNR(text) {
  if (!text || typeof text !== 'string') return [];
  const { airlines, airports } = await _loadIataData();
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  return lines
    .map(line => _parseOneLine(line, airlines, airports))
    .filter(Boolean);
}

/**
 * Versão sync (sem await) — usa cache já carregado. Se cache vazio retorna
 * fallback com IATA puro nos nomes (não bonito mas funciona).
 */
export function parsePNRSync(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  return lines
    .map(line => _parseOneLine(line, _airlinesCache || {}, _airportsCache || {}))
    .filter(Boolean);
}

/** Pre-load (chame no boot do editor de cotação pra ter cache pronto). */
export function preloadIata() {
  return _loadIataData().catch(() => null);
}

/* ──────────────────────────────────────────────────────────────────────
 * PARSER DE HOTEL — Amadeus/Sabre/Galileo
 * v4.62.27+
 *
 * Formatos típicos:
 *
 *   Amadeus:
 *     1 HHL HK1 GRU 23MAR-26MAR/3NT/HYATT REGENCY GUARULHOS/DBL
 *     1 HK HYATT REGENCY GRU IN23MAR OUT26MAR/DBL/NRF
 *
 *   Sabre:
 *     01 HHL HK1 GRU IN23MAR OUT26MAR/HYATT REGENCY GUARULHOS/DBL
 *
 *   Galileo:
 *     1. HTL HK1 GRU IN23MAR OUT26MAR HYATT REGENCY GUARULHOS DBL
 *
 *   Simples (texto livre — booking confirmation copy/paste):
 *     Hyatt Regency Guarulhos · GRU · Check-in 23/03 · Check-out 26/03 · Standard Room
 *
 * Output formato schema hotels[]:
 *   { city, hotelName, roomType, regime, checkIn (ISO), checkOut (ISO),
 *     nights, originIata?, gdsImported }
 * ────────────────────────────────────────────────────────────────────── */

const ROOM_TYPE_MAP = {
  'DBL': 'Duplo', 'SGL': 'Single', 'TWN': 'Twin', 'TPL': 'Triplo',
  'QUAD': 'Quádruplo', 'STD': 'Standard', 'DLX': 'Deluxe', 'STE': 'Suíte',
  'JST': 'Junior Suíte', 'EXE': 'Executive', 'CLB': 'Club',
};

const REGIME_MAP = {
  'BB':  'Café da manhã',
  'HB':  'Meia pensão',
  'FB':  'Pensão completa',
  'AI':  'All-inclusive',
  'EP':  'Sem refeições',
  'CP':  'Café continental',
  'AP':  'Pensão completa (American Plan)',
  'MAP': 'Meia pensão (Modified American Plan)',
};

/** Diff de dias entre 2 ISO dates. */
function _diffNights(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  const d1 = new Date(checkIn + 'T12:00:00');
  const d2 = new Date(checkOut + 'T12:00:00');
  return Math.max(0, Math.round((d2 - d1) / 86400000));
}

/**
 * Parse de UMA linha de reserva hotel. Retorna objeto ou null se inválido.
 *
 * Heurística:
 *   - 2 datas DDMMM consecutivas (com qualquer separador) = check-in + check-out
 *   - Padrão IN<DDMMM>OUT<DDMMM> ou IN<DDMMM> OUT<DDMMM> ou DDMMM-DDMMM
 *   - IATA 3 letras isolado (não dentro de palavra) = cidade
 *   - Resto = hotel name (sanitizado de tags HHL/HTL/HK/SS/segmentos)
 *   - Sigla DBL/SGL/STD/DLX detectada vira roomType
 *   - Sigla BB/HB/FB/AI detectada vira regime
 */
function _parseOneHotelLine(rawLine, airports) {
  let line = String(rawLine || '').toUpperCase().trim();
  if (!line) return null;

  // Skip prefixo numérico tipo "1 ", "01 ", "1.", " 1.1 "
  line = line.replace(/^[\d.\s]+/, '');
  if (!line) return null;

  // Extrai datas em qualquer formato:
  //   IN23MAR / OUT26MAR
  //   IN23MAR OUT26MAR
  //   IN 23MAR OUT 26MAR
  //   23MAR-26MAR
  //   23MAR/26MAR
  //   23/03 ... 26/03
  let checkIn = '', checkOut = '';
  const inMatch = /\bIN\s*(\d{2}[A-Z]{3})/i.exec(line);
  const outMatch = /\bOUT\s*(\d{2}[A-Z]{3})/i.exec(line);
  if (inMatch && outMatch) {
    checkIn = _parseGdsDate(inMatch[1].toUpperCase());
    checkOut = _parseGdsDate(outMatch[1].toUpperCase());
  } else {
    // Tenta achar 2 datas DDMMM consecutivas
    const allDates = [...line.matchAll(/\b(\d{2}[A-Z]{3})\b/g)].map(m => m[1]);
    if (allDates.length >= 2) {
      checkIn = _parseGdsDate(allDates[0]);
      checkOut = _parseGdsDate(allDates[1]);
    } else {
      // Tenta formato DD/MM (Booking-style)
      const slashDates = [...line.matchAll(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g)];
      if (slashDates.length >= 2) {
        const [d1, d2] = slashDates;
        const year = new Date().getFullYear();
        const toIso = (dd, mm, yy) => `${yy || year}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
        checkIn = toIso(parseInt(d1[1]), parseInt(d1[2]), d1[3] ? (parseInt(d1[3]) < 100 ? 2000 + parseInt(d1[3]) : parseInt(d1[3])) : null);
        checkOut = toIso(parseInt(d2[1]), parseInt(d2[2]), d2[3] ? (parseInt(d2[3]) < 100 ? 2000 + parseInt(d2[3]) : parseInt(d2[3])) : null);
      }
    }
  }
  if (!checkIn || !checkOut) return null;

  // Cidade: 1ª sequência 3 letras IATA isolada (não meio de palavra)
  // Procura primeiro depois das tags de segmento, antes do nome do hotel
  let cityIata = '';
  const cleanLine = line.replace(/\b(HHL|HTL|HK\d?|SS\d?|HX|HN|HRG|RG)\b/g, ' ');
  const iataMatch = cleanLine.match(/\b([A-Z]{3})\b/);
  if (iataMatch) cityIata = iataMatch[1];
  const cityName = cityIata
    ? (airports?.[cityIata] || cityIata)
    : '';

  // Room type: 1º tenta sigla IATA (DBL, STE, etc); fallback palavras pt-BR/EN
  let roomType = '';
  for (const code of Object.keys(ROOM_TYPE_MAP)) {
    if (new RegExp(`\\b${code}\\b`).test(line)) {
      roomType = ROOM_TYPE_MAP[code];
      break;
    }
  }
  if (!roomType) {
    const named = /\b(DELUXE|STANDARD|SUITE|JUNIOR\s*SUITE|EXECUTIVE|CLUB|PRESIDENTIAL|SUPERIOR|PREMIUM|ROYAL)\b/i.exec(line);
    if (named) {
      const norm = named[1].toLowerCase().replace(/\s+/g, ' ').trim();
      roomType = norm.charAt(0).toUpperCase() + norm.slice(1);
    }
  }

  // Regime
  let regime = '';
  for (const code of Object.keys(REGIME_MAP)) {
    if (new RegExp(`\\b${code}\\b`).test(line)) {
      regime = REGIME_MAP[code];
      break;
    }
  }

  // Hotel name: remove datas, sigla IATA, segmentos, room codes, regime codes,
  // separadores e palavras de booking livre. O que sobra é o nome.
  // Room type names em português (Standard, Duplo, etc) também removidos.
  const roomTypeNames = Object.values(ROOM_TYPE_MAP).join('|');
  let hotelName = line
    .replace(/\bIN\s*\d{2}[A-Z]{3}/gi, ' ')
    .replace(/\bOUT\s*\d{2}[A-Z]{3}/gi, ' ')
    .replace(/\b\d{2}[A-Z]{3}\b/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
    .replace(/\b(HHL|HTL|HK\d?|SS\d?|HX|HN|HRG|RG|NRF|RF)\b/g, ' ')
    .replace(/\b(\d+NT|\dNT|NIGHTS?)\b/gi, ' ')
    // Palavras livres de Booking-style (case-insensitive):
    .replace(/\b(CHECK[\s-]?IN|CHECK[\s-]?OUT|CHECKIN|CHECKOUT|ROOM|QUARTO|HOTEL|HOSPEDAGEM|RESERVA)\b/gi, ' ')
    .replace(new RegExp(`\\b(${Object.keys(ROOM_TYPE_MAP).join('|')})\\b`, 'g'), ' ')
    .replace(new RegExp(`\\b(${Object.keys(REGIME_MAP).join('|')})\\b`, 'g'), ' ')
    .replace(new RegExp(`\\b(${roomTypeNames})\\b`, 'gi'), ' ')
    .replace(/[\/\-·•|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Remove IATA isolado (já capturado em cityIata)
  if (cityIata) hotelName = hotelName.replace(new RegExp(`\\b${cityIata}\\b`, 'g'), '').replace(/\s+/g, ' ').trim();
  // Converte CAPS LOCK em Title Case (Amadeus retorna tudo upper)
  hotelName = hotelName.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

  if (!hotelName) return null;

  return {
    city: cityName || cityIata,
    cityIata,
    hotelName,
    roomType,
    regime,
    checkIn,
    checkOut,
    nights: _diffNights(checkIn, checkOut),
    gdsImported: true,
  };
}

/**
 * Parse PNR de hotel multi-linha. Cada linha = uma reserva.
 */
export async function parseHotelPNR(text) {
  if (!text || typeof text !== 'string') return [];
  const { airports } = await _loadIataData();
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  return lines
    .map(line => _parseOneHotelLine(line, airports))
    .filter(Boolean);
}

/** Sync version (cache only). */
export function parseHotelPNRSync(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  return lines
    .map(line => _parseOneHotelLine(line, _airportsCache || {}))
    .filter(Boolean);
}

/* ──────────────────────────────────────────────────────────────────────
 * PARSER DE TARIFA AÉREA — Amadeus/Sabre/Galileo pricing display
 * v4.62.28+
 *
 * Formato típico (FQ/FXP/FXR/etc):
 *
 *   TARIFA BASE              TAXAS/IMPOSTOS/ENCARGOS
 *   1-   USD3874.00          USD2499.20  XT  USD6373.20  ADT
 *   XT   2420.00  YQ  10.00  YR  12.90  BR  2.80  ZR
 *        27.20  F6  18.60  SW  1.40  OI  6.30  TK
 *        3874.00             2499.20
 *   MAIS TARIFAS DISPONÍVEIS
 *   TOTAL:USD6373.20
 *
 * Decompõe em: moeda, tarifa base, total taxas, total geral, tipo passageiro
 * (ADT/CHD/INF), breakdown de cada código de taxa (YQ, YR, BR, ZR, etc).
 *
 * Códigos comuns:
 *   YQ — surcharge combustível
 *   YR — surcharge segurança/yield
 *   BR — taxa Brasil embarque/desembarque
 *   ZR — taxa aeroporto
 *   F6 — taxa cobrança/serviço
 *   SW — Switzerland tax
 *   OI — Italy tax
 *   TK — Turkey tax
 *   XT — agregador "outros impostos"
 *
 * Output:
 *   {
 *     currency: 'USD',
 *     baseFare:    3874.00,
 *     taxesTotal:  2499.20,
 *     totalFare:   6373.20,
 *     paxType:     'ADT' | 'CHD' | 'INF' | null,
 *     breakdown:   [{ code: 'YQ', value: 10.00 }, ...]
 *   }
 * ────────────────────────────────────────────────────────────────────── */

const PAX_TYPES = ['ADT', 'CHD', 'INF', 'CNN', 'YTH', 'SRC'];

/**
 * Parse de uma tarifa aérea completa (multi-linha) do display GDS.
 * Retorna objeto ou null se nada foi reconhecido.
 *
 * Heurística:
 *   - Pega moeda da 1ª ocorrência de 3 letras maiúsculas grudadas em número
 *     (USD3874, EUR1200, etc)
 *   - Tarifa base = 1º número que vem grudado na moeda
 *   - Total = `TOTAL:XXX9999` no fim OU último número precedido por XT
 *   - Taxes = total - base (mais robusto que tentar extrair direto)
 *   - Pax type = ADT/CHD/INF detectado em qualquer lugar do texto
 *   - Breakdown = todos os pares [A-Z0-9]{2,3} + número (excluindo moeda)
 */
export function parseAirFareGds(text) {
  if (!text || typeof text !== 'string') return null;
  const upper = text.toUpperCase().replace(/\r/g, '');

  // Moeda + base: USD3874.00 (sem espaço)
  const moneyMatch = /\b([A-Z]{3})(\d+(?:\.\d{1,2})?)/.exec(upper);
  if (!moneyMatch) return null;
  const currency = moneyMatch[1];
  const baseFare = parseFloat(moneyMatch[2]);

  // Total: prefere TOTAL:XXX9999 explícito; senão último USDXXX antes de ADT/CHD/INF
  let totalFare = null;
  const totalLine = /TOTAL\s*:?\s*[A-Z]{3}?\s*(\d+(?:\.\d{1,2})?)/.exec(upper);
  if (totalLine) {
    totalFare = parseFloat(totalLine[1]);
  } else {
    // Pega o MAIOR valor com a moeda — costuma ser o total
    const allMoneyMatches = [...upper.matchAll(new RegExp(`\\b${currency}(\\d+(?:\\.\\d{1,2})?)`, 'g'))];
    if (allMoneyMatches.length) {
      const values = allMoneyMatches.map(m => parseFloat(m[1]));
      totalFare = Math.max(...values);
    }
  }

  // Taxes total = total - base se ambos conhecidos; senão tenta extrair
  let taxesTotal = (totalFare != null && baseFare != null)
    ? Math.round((totalFare - baseFare) * 100) / 100
    : null;
  // Validação: se o segundo USD<n> grudado bate com o cálculo, OK
  const allMonies = [...upper.matchAll(new RegExp(`\\b${currency}(\\d+(?:\\.\\d{1,2})?)`, 'g'))].map(m => parseFloat(m[1]));
  if (allMonies.length >= 2 && taxesTotal == null) {
    taxesTotal = allMonies[1];
  }

  // Pax type
  let paxType = null;
  for (const t of PAX_TYPES) {
    if (new RegExp(`\\b${t}\\b`).test(upper)) { paxType = t; break; }
  }

  // Breakdown: pares CODE + NUMBER (excluindo moeda detectada)
  // Padrão: 2 ou 3 letras (não a moeda) seguido de espaço(s) e número decimal
  const breakdown = [];
  const seen = new Set();
  const breakdownRegex = /\b([A-Z][A-Z0-9])\b\s+(\d+(?:\.\d{1,2})?)/g;
  let bm;
  while ((bm = breakdownRegex.exec(upper)) !== null) {
    const code = bm[1];
    const value = parseFloat(bm[2]);
    // Skip moeda, pax types, palavras conhecidas que não são código tax
    if (code === currency) continue;
    if (PAX_TYPES.includes(code)) continue;
    if (['MAIS', 'TOTAL', 'TAXAS', 'TARIFA', 'BASE', 'FOP'].includes(code)) continue;
    // Skip se for o valor da base/total/taxes já capturado
    if (value === baseFare || value === totalFare || value === taxesTotal) {
      // Mas SE for XT (agregador), ainda quero ver
      if (code !== 'XT') continue;
    }
    // Dedupe (mesmo code aparece 2x = ignora 2ª ocorrência)
    if (seen.has(code)) continue;
    seen.add(code);
    breakdown.push({ code, value });
  }

  if (baseFare == null && totalFare == null) return null;

  return {
    currency,
    baseFare,
    taxesTotal,
    totalFare,
    paxType,
    breakdown,
  };
}
