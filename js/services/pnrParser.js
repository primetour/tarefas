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
function _parseOneLine(rawLine, airlines, airports) {
  let line = String(rawLine || '').toUpperCase().trim();
  if (!line) return null;

  // Skip prefixo até primeira letra
  const firstLetter = line.search(/[A-Z]/);
  if (firstLetter < 0) return null;
  line = line.slice(firstLetter);

  // Código cia: 2 chars
  const airlineCode = line.slice(0, 2);
  if (!/^[A-Z0-9]{2}$/.test(airlineCode)) return null;

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
