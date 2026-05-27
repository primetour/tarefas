/**
 * envisionAdapter — converte Itinerary do Envision (TravelAgent) pro shape
 * do roteiros_bank (PRIMETOUR).
 *
 * v4.58.0+ Sprint #93 Fase 1a.
 * v4.59.3+ Geographic SSOT — geo.countryCodes/continentCodes ISO inseridos
 *          via countryCodeFromLabel() (js/data/countries.js).
 *
 * Pure function. Sem dependência de auth/API/Firebase — recebe JSON,
 * retorna shape pronto pra gravar via saveRoteiroBank().
 *
 * INPUT:  resposta de POST /Services/SiteService.svc/GetItineraryDetails
 *         (estrutura: { TravelEngineItineraryDetailsRS: { Itinerary: {...} } })
 * OUTPUT: objeto compatível com emptyRoteiroBank() (mesmo shape do schema atual).
 *
 * Filosofia (CLAUDE.md §11.h):
 *   - Mapeamento direto onde shape bate
 *   - HTML bruto guardado em envisionRaw (fallback, sem parser frágil)
 *   - Curador pode editar/sobrepor depois (overlay editorial em fase futura)
 *
 * Doc completo do mapeamento campo-a-campo: docs/ENVISION-SCHEMA-AUDIT.md §3
 */

import { countryCodeFromLabel, countryContinent } from '../data/countries.js';

/**
 * Mapa de entidades HTML comuns (acentos pt-BR + HTML básico).
 * Usado tanto pra strip quanto pra decode preservando tags.
 */
const HTML_ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
  '&quot;': '"', '&#39;': "'", '&apos;': "'",
  '&ldquo;': '"', '&rdquo;': '"', '&lsquo;': "'", '&rsquo;': "'",
  '&ndash;': '–', '&mdash;': '—', '&hellip;': '…', '&middot;': '·',
  '&deg;': '°', '&copy;': '©', '&reg;': '®', '&trade;': '™',
  '&euro;': '€', '&pound;': '£', '&yen;': '¥',
  '&laquo;': '«', '&raquo;': '»', '&bull;': '•',
  // Acentos pt-BR (vistos nos fixtures Envision)
  '&aacute;': 'á', '&Aacute;': 'Á', '&eacute;': 'é', '&Eacute;': 'É',
  '&iacute;': 'í', '&Iacute;': 'Í', '&oacute;': 'ó', '&Oacute;': 'Ó',
  '&uacute;': 'ú', '&Uacute;': 'Ú', '&atilde;': 'ã', '&Atilde;': 'Ã',
  '&otilde;': 'õ', '&Otilde;': 'Õ', '&acirc;': 'â', '&Acirc;': 'Â',
  '&ecirc;': 'ê', '&Ecirc;': 'Ê', '&ocirc;': 'ô', '&Ocirc;': 'Ô',
  '&ccedil;': 'ç', '&Ccedil;': 'Ç', '&agrave;': 'à', '&Agrave;': 'À',
  '&ntilde;': 'ñ', '&Ntilde;': 'Ñ', '&uuml;': 'ü', '&Uuml;': 'Ü',
};

/**
 * Decode entidades HTML preservando tags. Usar pra HTML que vai ser
 * renderizado como HTML (ex: descrição rica que o renderer mostra com innerHTML).
 */
function decodeEntities(html) {
  if (!html || typeof html !== 'string') return '';
  return html.replace(/&[a-zA-Z]+;|&#?\d+;/g, m => {
    if (HTML_ENTITIES[m] !== undefined) return HTML_ENTITIES[m];
    // numeric entity (&#39; etc) — try parsing
    const num = m.match(/^&#(\d+);$/);
    if (num) {
      try { return String.fromCodePoint(parseInt(num[1], 10)); } catch {}
    }
    return m;  // unknown — keep raw
  });
}

/** Strip tags HTML mantendo só texto inline. Para textos curtos sem estrutura. */
function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return decodeEntities(
    html.replace(/<\/?[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  );
}

/**
 * Converte HTML em texto puro PRESERVANDO ESTRUTURA (parágrafos, quebras).
 * v4.58.5: pra campos que vão em <textarea> (longDescription, days.narrative,
 * services.descriptionHtml) — evita ver `<p>...</p>` literal no editor.
 *
 *   <p>foo</p><p>bar</p>  →  "foo\n\nbar"
 *   <br>                  →  "\n"
 *   <li>item</li>         →  "• item\n"
 */
function htmlToPlainText(html) {
  if (!html || typeof html !== 'string') return '';
  return decodeEntities(html)
    .replace(/<\/(p|div|h[1-6])>\s*/gi, '\n\n')      // bloco fim → 2 quebras
    .replace(/<br\s*\/?>/gi, '\n')                    // <br> → 1 quebra
    .replace(/<li[^>]*>/gi, '\n• ')                   // bullet
    .replace(/<\/li>/gi, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')                 // strip resto das tags
    .replace(/[ \t]+/g, ' ')                          // collapse spaces (mantém \n)
    .replace(/\n{3,}/g, '\n\n')                       // max 2 quebras consecutivas
    .replace(/^\s+|\s+$/g, '')                        // trim
    .trim();
}

/**
 * Parser básico do `Globalization.Includes` (HTML organizado em seções).
 * Envision usa pattern: `<strong>SEÇÃO</strong><br />\nitem1<br />\nitem2<br /><br />\n<strong>OUTRA</strong>...`
 *
 * Retorna { hospedagem[], traslados[], passeios[], assistencia[], aereoInterno[], trem[], outros[] }.
 * Bullets vazias e duplicatas removidas. Fallback: tudo cai em `outros` se não bate header.
 */
function parseIncludes(html) {
  const out = { hospedagem:[], traslados:[], passeios:[], assistencia:[], aereoInterno:[], trem:[], outros:[] };
  if (!html) return out;

  const decoded = decodeEntities(html);

  // Map de headers Envision → bucket nosso
  const headerMap = [
    [/hospedagem|hotel/i,                    'hospedagem'],
    [/translad|transfer/i,                   'traslados'],
    [/passeio|tour|visita/i,                 'passeios'],
    [/assist[êe]ncia|seguro|suporte/i,       'assistencia'],
    [/a[ée]reo|voo|cia\.?\s*a[ée]rea/i,      'aereoInterno'],
    [/trem|train/i,                          'trem'],
  ];

  // Split por <strong>...</strong> blocks
  // Estratégia: trata cada `<strong>HEADER</strong>` como divisor
  const re = /<strong[^>]*>([^<]+)<\/strong>([\s\S]*?)(?=<strong|$)/gi;
  let m, foundAny = false;
  while ((m = re.exec(decoded))) {
    foundAny = true;
    const headerRaw = m[1].trim();
    const bodyHtml = m[2] || '';
    // Identifica bucket
    const bucketEntry = headerMap.find(([rx]) => rx.test(headerRaw));
    const bucket = bucketEntry ? bucketEntry[1] : 'outros';
    // Extrai bullets: cada <br>, <p>, ou linha vira 1 item
    const items = bodyHtml
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?p[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .split('\n')
      .map(s => decodeEntities(s).replace(/^\s*[•·\-*]\s*/, '').trim())
      .filter(s => s.length > 1 && s.length < 250);
    out[bucket].push(...items);
  }
  // Se não achou nenhum <strong>, joga tudo em outros (texto plano)
  if (!foundAny) {
    const text = stripHtml(html);
    if (text) out.outros.push(text.slice(0, 500));
  }
  // Dedup
  for (const k of Object.keys(out)) {
    out[k] = [...new Set(out[k])];
  }
  return out;
}

/**
 * Parser básico de cancellation policy escalonada.
 * Padrão Envision: "Entre X e Y dias antes da viagem: multa no valor de Z%"
 * Extrai array [{ fromDays, multaPercent, notes }].
 */
function parseCancellation(html) {
  if (!html) return [];
  const decoded = stripHtml(html);
  const out = [];
  const seen = new Set();

  const addDegree = (fromDays, raw) => {
    const notes = raw.trim().replace(/^[.,;:]/, '').trim();
    if (!notes || notes.length < 3) return;
    const multaMatch = notes.match(/(\d{1,3})\s*%/);
    const multaPercent = multaMatch ? +multaMatch[1] : null;
    const key = `${fromDays}-${multaPercent}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ fromDays, multaPercent, notes });
  };

  // Pattern 1: "Entre X e Y dias antes da viagem: ..."
  let m;
  const re1 = /entre\s+(\d+)\s*(?:e|ou)\s*(\d+)\s*dias[^:]*:\s*([^.\n<]{5,200})/gi;
  while ((m = re1.exec(decoded))) {
    const fromDays = Math.max(+m[1], +m[2]);
    addDegree(fromDays, m[3]);
  }

  // Pattern 2: "A partir de X dias antes da viagem: ..."  (degrau mais próximo da viagem)
  const re2 = /a\s+partir\s+de\s+(\d+)\s*dias\s+antes[^:]*:\s*([^.\n<]{5,200})/gi;
  while ((m = re2.exec(decoded))) {
    addDegree(+m[1], m[2]);
  }

  // Pattern 3: "Até X dias antes da viagem: ..." OU "a partir da confirmação até X dias antes..."
  const re3 = /at[ée]\s+(\d+)\s*dias\s+antes[^:]*:\s*([^.\n<]{5,200})/gi;
  while ((m = re3.exec(decoded))) {
    addDegree(+m[1], m[2]);
  }

  // Pattern 4: "menos de X dias" / "0 a X dias"
  const re4 = /(?:menos\s+de\s+|menor\s+que\s+|0\s+(?:a|ou)\s+)(\d+)\s*dias[^:]*:\s*([^.\n<]{5,200})/gi;
  while ((m = re4.exec(decoded))) {
    addDegree(+m[1], m[2]);
  }

  return out.sort((a,b) => b.fromDays - a.fromDays);
}

/**
 * Parser básico de FormOfPayment.
 * Envision tem seções marcadas com <strong>PARTE TERRESTRE</strong>, <strong>PARTE AÉREA</strong>, etc.
 */
function parsePayment(html) {
  const out = { terrestrial: '', aerial: '', deposit: { amount: 0, currency: 'USD', perPerson: true, notes: '' }, settlement: '' };
  if (!html) return out;

  const decoded = decodeEntities(html);
  const re = /<strong[^>]*>([^<]+)<\/strong>([\s\S]*?)(?=<strong|$)/gi;
  let m;
  while ((m = re.exec(decoded))) {
    const header = m[1].trim().toLowerCase();
    const body = stripHtml(m[2]).trim().slice(0, 800);
    if (/terrestre/.test(header)) out.terrestrial = body;
    else if (/a[ée]rea|aviao|voo/.test(header)) out.aerial = body;
    else if (/sinal|dep[óo]sito/.test(header))  out.deposit.notes = body;
    else if (/parcel|saldo|pagamento\s+final/.test(header)) out.settlement = body;
  }
  // Tenta extrair valor de sinal (ex: "USD 1.000" ou "R$ 5.000")
  if (out.deposit.notes) {
    const valMatch = out.deposit.notes.match(/(USD|R\$|BRL|EUR)\s*([\d.,]+)/i);
    if (valMatch) {
      const cur = valMatch[1].toUpperCase().replace('R$','BRL');
      const num = parseFloat(valMatch[2].replace(/\./g,'').replace(',','.'));
      if (!isNaN(num)) {
        out.deposit.currency = cur;
        out.deposit.amount = num;
      }
    }
  }
  return out;
}

/**
 * v4.58.8: Normaliza nome de país Envision pra forma canônica pt-BR.
 * Mapa de exceções pra casos reais detectados:
 *   - 'Australia' → 'Austrália' (sem acento original)
 *   - 'Tanzania' → 'Tanzânia'
 *   - 'Suiça' → 'Suíça' (typo Envision)
 *   - 'Coréia do Sul' → 'Coreia do Sul' (ortografia atualizada)
 * Mantém outros nomes como estão (trim + dedupe via Set caller).
 */
const COUNTRY_NORMALIZATIONS = {
  'australia': 'Austrália',
  'tanzania': 'Tanzânia',
  'suiça': 'Suíça',
  'suiça ': 'Suíça',
  'colombia': 'Colômbia',
  'mexico': 'México',
  'panama': 'Panamá',
  'paraguai': 'Paraguai',
  'inglaterra': 'Inglaterra',
  'escocia': 'Escócia',
  'irlanda': 'Irlanda',
  'india': 'Índia',
  // v4.58.8: Envision retorna "África" sozinho (com acento) em 3 docs — typo
  // "África do Sul". Mapa precisa key COM acento (toLowerCase preserva acentos).
  'áfrica': 'África do Sul',
  'africa': 'África do Sul',
  'sri lanka': 'Sri Lanka',
};
function normalizeCountry(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  const key = trimmed.toLowerCase();
  return COUNTRY_NORMALIZATIONS[key] || trimmed;
}

/** Normaliza nome de categoria Envision pra slug consistente. */
function normalizeCategory(envisionCategoryName) {
  if (!envisionCategoryName) return 'outro';
  const s = String(envisionCategoryName).toLowerCase().trim();
  // Mapeamento de categorias observadas nos fixtures
  if (s.includes('passeio')) return 'passeio';
  if (s.includes('transfer') || s.includes('translad')) return 'transfer';
  if (s.includes('ingresso') || s.includes('ticket')) return 'ingresso';
  if (s.includes('trem') || s.includes('train')) return 'trem';
  if (s.includes('mini') && s.includes('roteiro')) return 'mini-roteiro';
  if (s.includes('cruzeiro') || s.includes('cruise')) return 'cruzeiro';
  if (s.includes('seguro') || s.includes('insurance')) return 'seguro';
  if (s.includes('refei') || s.includes('meal')) return 'refeicao';
  return 'outro';
}

/** Best-effort: nome em pt-BR > nome inglês > FullName. */
function bestLocationName(loc) {
  if (!loc) return '';
  if (typeof loc === 'string') return loc;
  return loc.NamePortuguese || loc.Name || loc.FullName || '';
}

/**
 * v4.62.0 — normaliza nome de cidade vindo do Envision em cidade(s) atômica(s).
 *
 * Envision frequentemente retorna trechos descritivos no `Location.Name`:
 *   - "Coyhaique - Cerro Castillo"           → ["Coyhaique", "Cerro Castillo"]
 *   - "Cochrane (Explora Parque Nacional)"   → ["Cochrane"]
 *   - "Cerro Castillo - Cochrane (Explora)"  → ["Cerro Castillo", "Cochrane"]
 *   - "Mnemba Island, Zanzibar - Tanzânia"   → ["Mnemba Island", "Zanzibar"]
 *   - "Sapporo (e arredores)"                → ["Sapporo"]
 *   - "Pongwe, Zanzibar - Tanzânia"          → ["Pongwe", "Zanzibar"]
 *
 * Estratégia:
 *   1. Strip parênteses (propriedade, hotel, arredores): `"X (Y)"` → `"X"`.
 *   2. Strip sufixo país duplicado: `"X, Y - País"` → `"X, Y"`.
 *   3. Split por " - " (trecho/transferência).
 *   4. Split por ", " quando contiver vírgula (cidade + ilha/região).
 *   5. Trim cada parte, descartar vazios e duplicatas.
 *
 * @returns {string[]} 1 ou N cidades atômicas
 */
export function normalizeCityName(raw) {
  if (!raw || typeof raw !== 'string') return [];
  let s = raw.trim();
  if (!s) return [];

  // 1. Strip parênteses (incluindo conteúdo)
  s = s.replace(/\s*\([^)]*\)/g, '').trim();
  if (!s) return [];

  // 2. Strip sufixo país duplicado "- Tanzânia", "- Brasil" etc no final
  // (caso "X, Y - Tanzânia" vire só "X, Y")
  s = s.replace(/\s*[-–]\s*(Tanzânia|Brasil|Argentina|Chile|Peru|Bolívia|África do Sul|Egito|Quênia|Marrocos|Tailândia|Vietnã|Camboja|Laos|China|Japão|Índia|Indonésia|Austrália|Nova Zelândia|Polinésia Francesa|Maldivas)$/i, '').trim();

  // 3. Split trecho/transferência por " - " ou " – "
  const trechoParts = s.split(/\s+[-–]\s+/).map(p => p.trim()).filter(Boolean);

  // 4. Pra cada parte do trecho, split adicional por vírgula
  const atomic = [];
  for (const part of trechoParts) {
    // Split por vírgula só se for cidade composta (heurística: max 2 partes)
    const commaParts = part.split(',').map(p => p.trim()).filter(Boolean);
    if (commaParts.length <= 2) {
      atomic.push(...commaParts);
    } else {
      // 3+ partes = provavelmente endereço, pega só a primeira
      atomic.push(commaParts[0]);
    }
  }

  // 5. Dedup case-insens (preserva ordem + grafia original do primeiro)
  const seen = new Set();
  const out = [];
  for (const c of atomic) {
    const key = c.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (key && !seen.has(key)) { seen.add(key); out.push(c); }
  }
  return out;
}

/**
 * Converte 1 Hotel Envision (Product com ProductType=2) pro shape
 * categories[].hotels[].* enriquecido (v4.58.0+).
 */
function mapHotel(product) {
  const hotel = product.Hotel || {};
  const address = hotel.Address || {};
  const loc = hotel.Location || (typeof product.Location === 'object' ? product.Location : null);

  return {
    // legacy minimal (já existia no schema antigo)
    city:        bestLocationName(loc) || (typeof product.Location === 'string' ? product.Location : ''),
    name:        product.ProductName || hotel.Name || '',
    roomType:    '',                                       // não vem no detail — vem depois via fares
    nights:      product.NumberOfNights || 0,
    supplierUrl: '',                                       // não vem
    notes:       stripHtml(product.Description || '').slice(0, 200),

    // v4.58.0+ enriched
    address: {
      street:     address.Street || '',
      number:     address.Number || '',
      district:   address.District || '',
      postalCode: address.PostalCode || '',
      complement: address.Complement || '',
    },
    phone:    hotel.Phone || '',
    email:    hotel.Email || '',
    chainCode: product.HotelChainCode || hotel.ChainCode || '',
    rating:   typeof hotel.Rating === 'number' ? hotel.Rating : null,
    coords:   {
      lat: address.Latitude  ?? loc?.Latitude  ?? null,
      lng: address.Longitude ?? loc?.Longitude ?? null,
    },
    iata:              loc?.IATA || '',
    locationId:        product.LocationId || loc?.Id || null,
    distanceToCenter:  typeof address.DistanceToCenterCity   === 'number' ? address.DistanceToCenterCity   : null,
    distanceToAirport: typeof address.DistanceToNearestAirport === 'number' ? address.DistanceToNearestAirport : null,
    nearestAirport:    address.NearestAirport || hotel.NearestAirport || '',
    envisionProductId: product.ProductId || null,
    envisionRoomId:    (product.ProductFareCategories || [])[0]?.RoomId || null,
    optional:          !!product.Optional,
  };
}

/**
 * Converte 1 Service Envision (Product com ProductType=1) pro shape
 * services[] (v4.58.0+ ADD).
 */
function mapService(product) {
  const service = product.Service || {};
  const category = service.Category || {};
  const catLabel = category.Name || '';
  // Service name fallback chain: ProductName → Service.Name → 1ª linha do description (sem HTML)
  let name = product.ProductName || service.Name || '';
  if (!name && service.Description) {
    const firstLine = stripHtml(service.Description).split(/[.!?\n]/)[0] || '';
    name = firstLine.slice(0, 80).trim();
  }
  return {
    category:        normalizeCategory(catLabel),
    categoryLabel:   catLabel,
    name,
    // v4.58.5: htmlToPlainText pra textarea-friendly. Manter descriptionHtml
    // como NAME pra retrocompat schema, mas conteúdo já vai limpo (sem tags).
    descriptionHtml: htmlToPlainText(service.Description || product.Description || ''),
    day:             product.Day || null,
    consumableDays:  service.ConsumableDays ?? product.NumberOfDays ?? null,
    optional:        !!product.Optional,
    ageGroups:       Array.isArray(service.AgeGroups) ? service.AgeGroups : [],
    cancellationPolicyHtml: service.CancellationPolicy || '',
    supplier:        product.ProductSupplier || '',
    locationId:      product.LocationId || null,
    locationName:    typeof product.Location === 'string' ? product.Location : bestLocationName(product.Location),
    envisionProductId: product.ProductId || null,
    online:          !!product.Online,
    maxQuantity:     product.MaxQuantity ?? null,
  };
}

/**
 * Agrupa hotéis nas categorias comerciais (Envision FareCategories — "Opção 1/2/3").
 * Usa ProductFareCategories pra mapear: produto → categoria.
 */
function buildCategories(itinerary) {
  const fareCats = itinerary.FareCategories || [];
  const productFareCats = itinerary.ProductFareCategories || [];
  const hotels = (itinerary.Products || []).filter(p => p.ProductType === 2);

  // Index: ProductId → FareCategoryId (1 produto pode estar em N categorias)
  const productToCategories = new Map();
  productFareCats.forEach(pfc => {
    if (!productToCategories.has(pfc.ItineraryProductId)) {
      productToCategories.set(pfc.ItineraryProductId, new Set());
    }
    productToCategories.get(pfc.ItineraryProductId).add(pfc.ItineraryFareCategoryId);
  });

  return fareCats.map((fc, idx) => {
    const catHotels = hotels
      .filter(h => productToCategories.get(h.ProductId)?.has(fc.Id))
      .map(mapHotel);

    return {
      key:     `envision-${fc.Id}`,           // chave única (compatibilidade com legado)
      label:   fc.Name || `Opção ${idx + 1}`,
      hotels:  catHotels,
      pricing: [],                            // Fase 2 — vem de CalculateItineraryFareEstimate
      notes:   '',
      envisionFareCategoryId: fc.Id,
    };
  });
}

/**
 * Geo derivada dos Products + DayByDay.
 * Envision não popula `Locations` no top-level — extraímos de produtos e dias.
 */
function deriveGeo(itinerary) {
  const cities = new Set();
  const countries = new Set();
  const cityList = [];      // [{city, country, continent, nights, locationId}]

  // v4.58.8: normalizeCountry aplicado em todos os country values
  // (acentos, typos, exceções como "África" sozinho).

  // v4.62.0 — normaliza cidade em ATÔMICAS antes de adicionar. Envision trechos
  // tipo "Coyhaique - Cerro Castillo" viram 2 entries; "(Explora Parque)" some.
  // Preserva originalCity pra audit/rastreabilidade.

  // Extrair de Products
  for (const p of (itinerary.Products || [])) {
    const loc = typeof p.Location === 'object' ? p.Location
              : p.Hotel?.Location || null;
    if (!loc) continue;
    const rawCityName = bestLocationName(loc);
    if (!rawCityName) continue;
    const country = normalizeCountry(loc.Country || '');
    const atomicCities = normalizeCityName(rawCityName);
    if (!atomicCities.length) continue;
    for (const cityName of atomicCities) {
      const key = `${cityName}|${country}`;
      if (cities.has(key)) continue;
      cities.add(key);
      if (country) countries.add(country);
      cityList.push({
        city: cityName,
        country,
        continent: '',
        // v4.62.0: nights atribuído apenas à PRIMEIRA cidade atômica do trecho
        // (Envision não diferencia noites por cidade dentro de trecho).
        nights: (atomicCities[0] === cityName) ? (p.NumberOfNights || 0) : 0,
        locationId: loc.Id || p.LocationId || null,
        iata: loc.IATA || '',
        originalCity: rawCityName !== cityName ? rawCityName : null,   // audit
      });
    }
  }

  // Fallback: extrair de DayByDay se Products vazio
  if (!cityList.length) {
    for (const d of (itinerary.DayByDay || [])) {
      if (!d.Name) continue;
      const atomicCities = normalizeCityName(d.Name);
      for (const cityName of atomicCities) {
        if (cities.has(cityName)) continue;
        cities.add(cityName);
        cityList.push({
          city: cityName,
          country: '',
          continent: '',
          nights: 0,
          locationId: null,
          iata: '',
          originalCity: d.Name !== cityName ? d.Name : null,
        });
      }
    }
  }

  // v4.58.8: se countries vazio MAS cityList tem entries com country, infere
  // (caso de roteiro onde 1 Product não tem Country mas outros têm).
  if (!countries.size && cityList.some(c => c.country)) {
    for (const c of cityList) if (c.country) countries.add(c.country);
  }

  // v4.59.3 — Geographic SSOT: resolve countryCodes (ISO 3166-1) + continentCodes
  // a partir dos labels Envision. js/data/countries.js cobre 100% dos 53 países
  // observados em produção (validado via functions/audit-geography-ssot.cjs).
  const countryCodes = [];
  for (const label of countries) {
    const code = countryCodeFromLabel(label);
    if (code && !countryCodes.includes(code)) countryCodes.push(code);
  }
  const continentCodes = [...new Set(countryCodes.map(countryContinent).filter(Boolean))];

  // Enriquece cityList com countryCode (pra resolveOrCreatePendingDestination
  // downstream usar). Não toca cityList.continent (legado, sempre '').
  for (const c of cityList) {
    if (c.country) c.countryCode = countryCodeFromLabel(c.country) || null;
  }

  return {
    continents:     [],            // legado — sempre vazio em Envision
    countries:      [...countries], // legado — labels pt-BR
    countryCodes,                   // v4.59.3+ ISO 3166-1 (preferido)
    continentCodes,                 // v4.59.3+ UN M.49 (AF/EU/AS/NA/SA/OC/AN)
    cities:         cityList,
    destinationIds: [],             // preenchido por backfill ou _syncDestinationsBackground
  };
}

/**
 * Imagens: Envision retorna `UUID.png` (sem URL completa).
 * Adapter recebe `imageBaseUrl` opcional pra construir URL completa.
 * Sem prefix, deixa filename → cliente decide depois.
 */
// v4.58.2: URL CDN Envision descoberta via Chrome MCP (inspeção DOM no
// v2.travelagent.com.br). Bucket público Google Cloud Storage. Confirmado
// HTTP 200 sem auth pra UUIDs do Japão.
const ENVISION_CDN_BASE = 'https://storage.googleapis.com/envision-ets-upload';

function mapImages(itinerary, opts = {}) {
  const images = itinerary.Images || [];
  if (!images.length) return { hero: null, gallery: [], overrides: {} };

  // Default: usa CDN Envision conhecido. Override via opts.imageBaseUrl
  // pra futuro mirror R2 (opts.imageBaseUrl substitui o bucket original).
  const baseUrl = opts.imageBaseUrl || ENVISION_CDN_BASE;
  const buildUrl = (filename) => {
    if (!filename) return null;
    if (filename.startsWith('http')) return filename;            // URL completa OK
    // v4.58.3: Envision às vezes retorna paths com backslashes Windows
    // (ex: "roteiros\primetour\xxx.jpg"). Normaliza pra forward slash
    // e encode pra URL-safe.
    const clean = filename.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
    return `${baseUrl.replace(/\/$/, '')}/${clean}`;
  };

  return {
    hero:    buildUrl(images[0].UrlImage),
    gallery: images.slice(1).map(img => buildUrl(img.UrlImage)).filter(Boolean),
    overrides: {},
  };
}

/**
 * Days do roteiro a partir do Envision DayByDay[].
 */
function mapDays(itinerary) {
  return (itinerary.DayByDay || []).map(d => ({
    dayNumber:     d.Day || null,
    city:          d.Name || '',
    title:         d.Name || '',                                  // pode ser cidade ou tema do dia
    // v4.58.5: htmlToPlainText pra textarea-friendly (preserva quebras de parágrafo)
    narrative:     htmlToPlainText(d.Description || ''),
    overnightCity: stripHtml(d.NightDescription || ''),
    flightLeg:     null,
  }));
}

/**
 * Validity: Envision tem `AvailabilityDates[]` mas vem vazio nos fixtures.
 * Por ora deixamos vazio — preenchido manualmente OU via Fase 2 (fare estimate).
 */
function mapValidity() {
  return {
    startDate: '',
    endDate:   '',
    notes:     '',
  };
}

/**
 * Converte Envision Itinerary → shape roteiros_bank.
 *
 * @param {object} envisionJson - Resposta completa de GetItineraryDetails
 *                                 (espera {TravelEngineItineraryDetailsRS:{Itinerary:{...}}})
 *                                 OU já o Itinerary direto.
 * @param {object} [opts]
 * @param {string} [opts.imageBaseUrl] - prefix CDN pra UrlImage (ex: 'https://api.travelagent.com.br/Files')
 * @param {string} [opts.importedBy]   - uid do user que disparou import
 * @param {string} [opts.collectionLabel] - default 'Envision' (pode ser sobrescrito)
 * @returns {object} doc compatível com saveRoteiroBank()
 */
export function envisionItineraryToBank(envisionJson, opts = {}) {
  // Aceita resposta completa OU itinerary direto
  const it = envisionJson?.TravelEngineItineraryDetailsRS?.Itinerary
          || envisionJson?.Itinerary
          || envisionJson;
  if (!it || typeof it !== 'object' || !it.Id) {
    throw new Error('envisionItineraryToBank: input inválido — sem Itinerary.Id');
  }

  const g = it.Globalization || {};
  const products = it.Products || [];
  const services = products.filter(p => p.ProductType === 1).map(mapService);

  return {
    // ─── Identidade ───
    title:        it.Name || g.Name || '',
    subtitle:     '',                                             // não vem
    code:         '',                                             // gerado on-save
    slug:         '',                                             // gerado on-save
    collectionLabel: opts.collectionLabel || 'Envision',

    // ─── Status ───
    // v4.58.7: roteiros Envision JÁ são publicados oficialmente pela equipe
    // de produtos PrimeTour (Active=true no Envision). Importamos como
    // 'approved' por default. Curador ainda pode mover pra review/draft.
    status:       'approved',

    // ─── Validade ───
    validity:     mapValidity(),

    // ─── Narrativa ───
    // v4.58.5: htmlToPlainText pra textarea-friendly (preserva quebras de
    // parágrafo mas tira tags HTML). envisionRaw mantém HTML original pra
    // renderers que aceitam (preview/PDF).
    shortDescription: stripHtml(g.ShortDescription || '').slice(0, 300),
    longDescription:  htmlToPlainText(g.Description || it.Description || ''),

    // ─── Geo (derivado de Products + DayByDay) ───
    geo:          deriveGeo(it),

    // ─── Duração ───
    durationDays:   it.NumberOfDays   || 0,
    durationNights: it.NumberOfNights || 0,

    // ─── Dias ───
    days:         mapDays(it),

    // ─── Categorias + hotéis ───
    categories:   buildCategories(it),

    // ─── Services estruturados ───
    services,

    // ─── Includes / Excludes ───
    // v4.58.1: adapter parseia HTML Envision em bullets estruturados.
    // envisionRaw.includes continua disponível pra UI fallback OU pra curador re-extrair manualmente.
    includes:     parseIncludes(g.Includes),
    excludes:     [],

    // ─── Pagamento ───
    // v4.58.1: parser extrai PARTE TERRESTRE / PARTE AÉREA / SINAL automaticamente.
    payment:      parsePayment(g.FormOfPayment),

    // ─── Cancelamento ───
    // v4.58.1: parser extrai degraus escalonados ({fromDays, multaPercent, notes}).
    cancellation: parseCancellation(g.CancellationPolicy),

    // ─── Documentação + travel notes ───
    // Idem: HTML único em envisionRaw.generalInfo. GeneralInfo struct fica vazio
    // — curador preenche conforme caso de uso real (Fase 4).
    documentation: { passport: '', minors: '', visas: [], vaccines: '' },
    generalInfo:   {
      timezone: '', currency: '', climate: '', gratuities: '',
      voltage: '', gastronomy: '', telecom: '', tips: '',
    },
    travelNotes:   [],

    // ─── Imagens ───
    images:       mapImages(it, opts),

    // ─── Source ───
    source: {
      type:         'envision',
      originalFile: '',
      importedAt:   new Date().toISOString(),
      importedBy:   opts.importedBy || '',
      llmTokens:    { input: 0, output: 0 },
    },

    // ─── Curadoria ───
    tags:         [],
    aiUsable:     true,

    // ─── Envision metadata ───
    // v4.59.7: currency movido pra envision.currency (antes era _envisionCurrency
    // com prefixo _, schema lixo no Firestore). Limpa em backfill futuro.
    envision: {
      id:                  it.Id,
      url:                 it.Url || null,
      loginInformationId:  it.LoginInformationId || null,
      supplierId:          it.SupplierId || null,
      currency:            it.Currency || null,
      syncedAt:            new Date().toISOString(),
    },

    // ─── Envision RAW (HTML fallback — não renderizado por default) ───
    // v4.58.1: decodeEntities aplicado pra mostrar legível se UI renderizar como HTML.
    // v4.59.7: imageUuids removido — desde v4.58.2 adapter constrói URL CDN
    // (storage.googleapis.com/envision-ets-upload/{uuid}) em mapImages(). UUIDs
    // ficam embutidos nas URLs em images.gallery, sem precisar de cópia separada.
    envisionRaw: {
      includes:           decodeEntities(g.Includes           || ''),
      generalInfo:        decodeEntities(g.GeneralInfo        || ''),
      cancellationPolicy: decodeEntities(g.CancellationPolicy || ''),
      formOfPayment:      decodeEntities(g.FormOfPayment      || ''),
    },

    // Auditoria — preenchido por saveRoteiroBank()
    createdAt: null, createdBy: '',
    updatedAt: null, updatedBy: '',
    approvedAt: null, approvedBy: '',
  };
}

/**
 * Sanity check: dado um doc convertido, retorna lista de warnings (não fatais).
 * Útil pro test runner reportar coverage.
 */
export function validateAdapterOutput(bankDoc) {
  const warnings = [];
  if (!bankDoc.title) warnings.push('Sem title');
  if (!bankDoc.envision?.id) warnings.push('Sem envisionId');
  if (!bankDoc.days?.length) warnings.push('Sem days (DayByDay vazio?)');
  if (!bankDoc.categories?.length) warnings.push('Sem categories (FareCategories vazio?)');
  if (bankDoc.categories && bankDoc.categories.every(c => !c.hotels?.length)) {
    warnings.push('Nenhuma categoria tem hotéis (Products[ProductType=2] vazio ou desassociado)');
  }
  if (!bankDoc.geo?.cities?.length) warnings.push('geo.cities vazio (não conseguiu derivar de Products/DayByDay)');
  if (!bankDoc.images?.hero) warnings.push('Sem hero image');
  return warnings;
}
